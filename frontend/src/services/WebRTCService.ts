/**
 * WebRTC 信令服务
 * 通过 control/xxtouch 代理调用设备端 WebRTC API
 */

import type { WebSocketService } from './WebSocketService';
import { AuthService } from './AuthService';

export interface WebRTCStartOptions {
  resolution?: number; // 0.25 - 1.0, default 0.6
  fps?: number;        // 1 - 60, default 20
  force?: boolean;     // 强制连接（踢掉现有连接）
}

export interface WebRTCStartResponse {
  type: 'offer';
  sdp: string;
  iceServers?: RTCIceServer[];
  iceTransportPolicy?: 'all' | 'relay';
  error?: string;
}

export interface ICECandidateMessage {
  type: 'ice';
  candidate: string;
  sdpMid: string;
  sdpMLineIndex: number;
}

export interface WebRTCServiceEvents {
  onOffer?: (sdp: RTCSessionDescriptionInit, iceServers: RTCIceServer[], iceTransportPolicy?: 'all' | 'relay') => void;
  onIceCandidate?: (candidate: RTCIceCandidateInit) => void;
  onConnected?: () => void;
  onDisconnected?: () => void;
  onKicked?: () => void;
  onError?: (error: string) => void;
  onTrack?: (stream: MediaStream) => void;
}

// 生成唯一请求ID
let requestIdCounter = 0;
function generateRequestId(): string {
  return `webrtc-${Date.now()}-${++requestIdCounter}`;
}

// Base64 编解码
function encodeBody(data: string): string {
  return btoa(unescape(encodeURIComponent(data)));
}

function decodeBody(base64: string): string {
  try {
    return decodeURIComponent(escape(atob(base64)));
  } catch {
    return atob(base64);
  }
}

export class WebRTCService {
  private wsService: WebSocketService;
  private deviceUdid: string;
  private password: string;
  private events: WebRTCServiceEvents;
  private pendingRequests: Map<string, {
    resolve: (value: any) => void;
    reject: (reason: any) => void;
    timeout: number;
  }> = new Map();
  private unsubscribe: (() => void) | null = null;
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;

  constructor(wsService: WebSocketService, deviceUdid: string, password: string, events: WebRTCServiceEvents = {}) {
    this.wsService = wsService;
    this.deviceUdid = deviceUdid;
    this.password = password;
    this.events = events;
    this.setupMessageHandler();
  }

  private setupMessageHandler() {
    this.unsubscribe = this.wsService.onMessage((message) => {
      // 调试：显示所有收到的消息
      if (message.type?.includes('http') || message.type?.includes('webrtc')) {
        console.log('[WebRTC] Received message:', message.type, message);
      }
      
      // 处理 http/response 消息
      if (message.type === 'http/response') {
        console.log('[WebRTC] http/response received:', {
          udid: message.udid,
          expectedUdid: this.deviceUdid,
          body: message.body
        });
        
        // 检查 UDID 匹配
        if (message.udid !== this.deviceUdid) {
          console.log('[WebRTC] UDID mismatch, ignoring');
          return;
        }
        
        const body = message.body;
        if (!body || !body.requestId) {
          console.log('[WebRTC] No body or requestId');
          return;
        }

        const pending = this.pendingRequests.get(body.requestId);
        if (pending) {
          console.log('[WebRTC] Found pending request:', body.requestId);
          clearTimeout(pending.timeout);
          this.pendingRequests.delete(body.requestId);

          // 解码响应体
          let responseBody: any = null;
          if (body.body) {
            try {
              const decoded = decodeBody(body.body);
              console.log('[WebRTC] Decoded body:', decoded);
              responseBody = JSON.parse(decoded);
            } catch (e) {
              console.log('[WebRTC] Body decode/parse error:', e);
              responseBody = body.body;
            }
          }

          if (body.statusCode >= 200 && body.statusCode < 300) {
            console.log('[WebRTC] Request success:', responseBody);
            pending.resolve(responseBody);
          } else {
            console.log('[WebRTC] Request error:', body.statusCode, responseBody);
            pending.reject(responseBody?.error || `HTTP ${body.statusCode}`);
          }
        } else {
          console.log('[WebRTC] No pending request for:', body.requestId);
        }
      }
    });
  }

  /**
   * 发送 HTTP 请求到设备
   */
  private async sendRequest(
    method: string,
    path: string,
    body?: any,
    query?: Record<string, string | number | boolean>
  ): Promise<any> {
    const requestId = generateRequestId();
    const authService = AuthService.getInstance();

    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        console.log('[WebRTC] Request timeout:', requestId, path);
        this.pendingRequests.delete(requestId);
        reject(new Error('Request timeout'));
      }, 30000);

      this.pendingRequests.set(requestId, { resolve, reject, timeout });

      const message = authService.createControlMessage(
        this.password,
        'control/http',
        {
          devices: [this.deviceUdid],
          requestId,
          method,
          path,
          query: query || {},
          headers: { 'Content-Type': 'application/json' },
          body: body ? encodeBody(JSON.stringify(body)) : undefined
        }
      );

      console.log('[WebRTC] Sending request:', {
        requestId,
        method,
        path,
        query,
        deviceUdid: this.deviceUdid
      });
      
      this.wsService.send(message);
    });
  }

  /**
   * 启动 WebRTC 流
   */
  async startStream(options: WebRTCStartOptions = {}): Promise<void> {
    try {
      const query: Record<string, string | number | boolean> = {};
      if (options.resolution !== undefined) query.resolution = options.resolution;
      if (options.fps !== undefined) query.fps = options.fps;
      if (options.force !== undefined) query.force = options.force;

      const response = await this.sendRequest('POST', '/api/webrtc/start', null, query) as WebRTCStartResponse;

      if (response.error) {
        this.events.onError?.(response.error);
        return;
      }

      if (response.type === 'offer' && response.sdp) {
        // 配置 ICE 服务器
        const iceServers = response.iceServers || [
          { urls: 'stun:stun.l.google.com:19302' }
        ];

        // 创建 PeerConnection
        const config: RTCConfiguration = {
          iceServers,
          iceTransportPolicy: response.iceTransportPolicy || 'all'
        };

        this.peerConnection = new RTCPeerConnection(config);

        // 设置事件处理器
        this.peerConnection.onicecandidate = (event) => {
          if (event.candidate) {
            this.sendIceCandidate({
              candidate: event.candidate.candidate,
              sdpMid: event.candidate.sdpMid || '',
              sdpMLineIndex: event.candidate.sdpMLineIndex || 0
            });
          }
        };

        this.peerConnection.ontrack = (event) => {
          const track = event.track;
          const streams = event.streams;
          console.log('[WebRTC] Received remote track:', {
            kind: track.kind,
            id: track.id,
            enabled: track.enabled,
            muted: track.muted,
            readyState: track.readyState,
            streamCount: streams.length
          });

          if (track.kind === 'video') {
            let stream = streams[0];
            if (!stream) {
              console.warn('[WebRTC] No stream found in ontrack, creating a new MediaStream');
              stream = new MediaStream([track]);
            }
            console.log('[WebRTC] Notifying onTrack with stream:', stream.id);
            (this.events as any).onTrack?.(stream);
          }
        };

        this.peerConnection.onconnectionstatechange = () => {
          const state = this.peerConnection?.connectionState;
          console.log('Connection state:', state);
          if (state === 'connected') {
            this.events.onConnected?.();
          } else if (state === 'disconnected' || state === 'failed' || state === 'closed') {
            this.events.onDisconnected?.();
          }
        };

        this.peerConnection.ondatachannel = (event) => {
          this.dataChannel = event.channel;
          this.setupDataChannel();
        };

        // 设置远程 offer
        await this.peerConnection.setRemoteDescription({
          type: 'offer',
          sdp: response.sdp
        });

        // 创建 answer
        const answer = await this.peerConnection.createAnswer();
        await this.peerConnection.setLocalDescription(answer);

        // 发送 answer 到设备
        await this.sendAnswer(answer.sdp!);
      }
    } catch (error: any) {
      this.events.onError?.(error.message || String(error));
    }
  }

  /**
   * 发送 Answer SDP
   */
  private async sendAnswer(sdp: string): Promise<void> {
    await this.sendRequest('POST', '/api/webrtc/answer', { sdp });
  }

  /**
   * 发送 ICE 候选
   */
  private async sendIceCandidate(candidate: {
    candidate: string;
    sdpMid: string;
    sdpMLineIndex: number;
  }): Promise<void> {
    await this.sendRequest('POST', '/api/webrtc/ice', candidate);
  }

  /**
   * 停止 WebRTC 流
   */
  async stopStream(): Promise<void> {
    try {
      await this.sendRequest('POST', '/api/webrtc/stop');
    } catch (error) {
      console.error('Failed to stop WebRTC stream:', error);
    }
    this.cleanup();
  }

  /**
   * 设置帧率
   */
  async setFrameRate(fps: number): Promise<void> {
    await this.sendRequest('POST', '/api/webrtc/set-frame-rate', { fps });
  }

  /**
   * 设置分辨率
   */
  async setResolution(resolution: number): Promise<void> {
    await this.sendRequest('POST', '/api/webrtc/set-resolution', { resolution });
  }

  /**
   * 通过 DataChannel 发送触控命令
   * @param x 相对宽度比例 (0.0 - 1.0)
   * @param y 相对高度比例 (0.0 - 1.0)
   */
  sendTouchCommand(action: 'down' | 'move' | 'up', x: number, y: number) {
    if (this.dataChannel?.readyState === 'open') {
      const command = {
        type: 'touch',
        action,
        x: Number(x.toFixed(4)),
        y: Number(y.toFixed(4))
      };
      console.log('[WebRTC] Sending touch command:', command);
      this.dataChannel.send(JSON.stringify(command));
    }
  }

  /**
   * 通过 DataChannel 发送按键命令
   * @param action 动作类型: 'press', 'down', 'up'，默认为 'press'
   */
  sendKeyCommand(key: string, action: 'press' | 'down' | 'up' = 'press') {
    if (this.dataChannel?.readyState === 'open') {
      const command = {
        type: 'key',
        key,
        action
      };
      console.log('[WebRTC] Sending key command:', command);
      this.dataChannel.send(JSON.stringify(command));
    }
  }

  private setupDataChannel() {
    if (!this.dataChannel) return;

    this.dataChannel.onopen = () => {
      console.log('DataChannel opened');
    };

    this.dataChannel.onclose = () => {
      console.log('DataChannel closed');
    };

    this.dataChannel.onerror = (error) => {
      console.error('DataChannel error:', error);
    };
  }

  /**
   * 获取 PeerConnection（供外部获取视频流）
   */
  getPeerConnection(): RTCPeerConnection | null {
    return this.peerConnection;
  }

  /**
   * 清理资源
   */
  cleanup() {
    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }

    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }

    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }

    // 清理待处理请求
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Service destroyed'));
    }
    this.pendingRequests.clear();
  }
}
