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
  private httpPort?: number;
  private events: WebRTCServiceEvents;
  private pendingRequests: Map<string, {
    resolve: (value: any) => void;
    reject: (reason: any) => void;
    timeout: number;
  }> = new Map();
  private unsubscribe: (() => void) | null = null;
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private isPolling = false;
  private pendingCandidates: RTCIceCandidateInit[] = [];

  constructor(
    wsService: WebSocketService,
    deviceUdid: string,
    password: string,
    events: WebRTCServiceEvents = {},
    httpPort?: number
  ) {
    this.wsService = wsService;
    this.deviceUdid = deviceUdid;
    this.password = password;
    this.events = events;
    this.httpPort = httpPort;
    this.setupMessageHandler();
  }

  private setupMessageHandler() {
    this.unsubscribe = this.wsService.onMessage((message) => {
      
      // 处理 http/response 消息
      if (message.type === 'http/response') {
        // 检查 UDID 匹配
        if (message.udid !== this.deviceUdid) {
          return;
        }
        
        const body = message.body;
        if (!body || !body.requestId) {
          return;
        }

        const pending = this.pendingRequests.get(body.requestId);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingRequests.delete(body.requestId);

          // 解码响应体
          let responseBody: any = null;
          if (body.body) {
            try {
              const decoded = decodeBody(body.body);
              responseBody = JSON.parse(decoded);
            } catch {
              responseBody = body.body;
            }
          }

          if (body.statusCode >= 200 && body.statusCode < 300) {
            pending.resolve(responseBody);
          } else {
            pending.reject(responseBody?.error || `HTTP ${body.statusCode}`);
          }
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
          body: body ? encodeBody(JSON.stringify(body)) : undefined,
          port: this.httpPort
        }
      );

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
              stream = new MediaStream([track]);
            }
            (this.events as any).onTrack?.(stream);
          }
        };

        this.peerConnection.onconnectionstatechange = () => {
          const state = this.peerConnection?.connectionState;
          if (state === 'connected') {
            this.events.onConnected?.();
          } else if (state === 'disconnected' || state === 'failed' || state === 'closed') {
            this.stopPolling();
            this.events.onDisconnected?.();
          }
        };

        this.peerConnection.oniceconnectionstatechange = () => {
          const iceState = this.peerConnection?.iceConnectionState;
          if (iceState === 'failed') {
            console.error('[WebRTC] ICE connection failed');
          }
        };

        this.peerConnection.onicegatheringstatechange = () => {};

        this.peerConnection.onicecandidateerror = (event) => {
          console.error('[WebRTC] ICE candidate error:', {
            errorCode: event.errorCode,
            errorText: event.errorText,
            url: event.url
          });
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

        // 处理缓存的 ICE candidates
        for (const candidate of this.pendingCandidates) {
          try {
            await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (e) {
            console.error('[WebRTC] Failed to add pending ICE candidate:', e);
          }
        }
        this.pendingCandidates = [];

        // 创建 answer
        const answer = await this.peerConnection.createAnswer();
        await this.peerConnection.setLocalDescription(answer);

        // 发送 answer 到设备
        await this.sendAnswer(answer.sdp!);

        // 开始轮询设备端的 ICE candidates
        this.startPolling();
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
   * 开始轮询设备端的 ICE candidates
   */
  private startPolling(): void {
    if (this.isPolling) return;
    this.isPolling = true;
    this.pollForCandidates();
  }

  /**
   * 停止轮询
   */
  private stopPolling(): void {
    this.isPolling = false;
  }

  /**
   * 轮询设备端的 ICE candidates
   */
  private async pollForCandidates(): Promise<void> {
    if (!this.isPolling || !this.peerConnection) {
      return;
    }

    try {
      // 异步HTTP客户端已在Lua端实现，不再需要短超时
      const messages = await this.sendRequest('GET', '/api/webrtc/poll', null, { timeout: 25 }) as any[];
      
      if (Array.isArray(messages)) {
        for (const msg of messages) {
          await this.handlePollMessage(msg);
        }
      }

      // 继续轮询
      if (this.isPolling && this.peerConnection && this.peerConnection.connectionState !== 'closed') {
        // 使用 setTimeout 而不是立即递归，避免堆栈溢出
        setTimeout(() => this.pollForCandidates(), 100);
      }
    } catch (error: any) {
      // 如果不是因为服务销毁导致的错误，记录到控制台
      if (this.isPolling && error?.message !== 'Service destroyed') {
        console.error('[WebRTC] Polling error:', error);
      }
      
      // 错误后稍等重试
      if (this.isPolling && this.peerConnection) {
        setTimeout(() => this.pollForCandidates(), 1000);
      }
    }
  }

  /**
   * 处理轮询消息
   */
  private async handlePollMessage(msg: any): Promise<void> {
    if (!msg || !msg.type) return;

    switch (msg.type) {
      case 'ice':
        // 收到设备端的 ICE candidate
        const candidateInit: RTCIceCandidateInit = {
          candidate: msg.candidate,
          sdpMid: msg.sdpMid,
          sdpMLineIndex: msg.sdpMLineIndex
        };
        
        if (this.peerConnection?.remoteDescription) {
          try {
            await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidateInit));
          } catch (e) {
            console.error('[WebRTC] Failed to add ICE candidate:', e);
          }
        } else {
          // 如果远程描述还没设置，先缓存
          this.pendingCandidates.push(candidateInit);
        }
        break;

      case 'connected':
        break;

      case 'disconnected':
      case 'disconnect':
        this.stopPolling();
        break;

      case 'kicked':
        console.warn('[WebRTC] Kicked by another connection');
        this.stopPolling();
        this.events.onError?.('Connection kicked by another user');
        break;
    }
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
      this.dataChannel.send(JSON.stringify(command));
    }
  }

  /**
   * 通过 DataChannel 发送粘贴命令
   */
  sendPasteCommand(text: string) {
    if (this.dataChannel?.readyState === 'open') {
      const command = {
        type: 'paste',
        text
      };
      this.dataChannel.send(JSON.stringify(command));
    }
  }

  private setupDataChannel() {
    if (!this.dataChannel) return;

    this.dataChannel.onopen = () => {};

    this.dataChannel.onclose = () => {};

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
    // 停止轮询
    this.stopPolling();
    this.pendingCandidates = [];

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
