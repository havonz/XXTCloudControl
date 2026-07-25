/**
 * WebRTC 信令服务
 * 通过 control/xxtouch 代理调用设备端 WebRTC API
 */

import type { WebSocketService } from './WebSocketService';
import { ControlHttpClient } from './ControlHttpClient';
import { debugLog, debugWarn } from '../utils/debugLogger';
import type { RemoteWheelSettings } from '../utils/remoteWheel';

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
  onClipboard?: (contentType: 'text' | 'image', content: string) => void;
  onClipboardError?: (error: string) => void;
  onDataChannelOpen?: () => void;
  onHardwareKeyboardState?: (state: HardwareKeyboardState) => void;
}

export interface HardwareKeyboardState {
  action: 'status' | 'connect' | 'disconnect';
  supported: boolean;
  ok: boolean;
  connected: boolean;
  message?: string;
}

interface ClipboardChunkMessage {
  messageId: string;
  chunkIndex: number;
  totalChunks: number;
  data: string;
  contentType: string;
}

interface ClipboardChunkState {
  chunks: string[];
  total: number;
  received: number;
}

export class WebRTCService {
  private deviceUdid: string;
  private httpPort?: number;
  private events: WebRTCServiceEvents;
  private httpClient: ControlHttpClient;
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private isPolling = false;
  private pollTimer: number | null = null;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private isDestroyed = false;
  private loggedIceCandidateWarnings: Set<string> = new Set();

  constructor(
    wsService: WebSocketService,
    deviceUdid: string,
    password: string,
    events: WebRTCServiceEvents = {},
    httpPort?: number
  ) {
    this.deviceUdid = deviceUdid;
    this.events = events;
    this.httpPort = httpPort;
    this.httpClient = new ControlHttpClient({
      wsService,
      password,
      requestIdPrefix: 'webrtc',
      defaultTimeoutMs: 30000,
      responseFilter: (message) => message.udid === this.deviceUdid,
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
    if (this.isDestroyed) {
      throw new Error('Service destroyed');
    }

    const response = await this.httpClient.send({
      devices: [this.deviceUdid],
      method,
      path,
      query,
      body,
      port: this.httpPort,
    });

    if (response.statusCode >= 200 && response.statusCode < 300) {
      return response.body;
    }

    throw response.body?.error || `HTTP ${response.statusCode}`;
  }

  /**
   * 启动 WebRTC 流
   */
  async startStream(options: WebRTCStartOptions = {}): Promise<void> {
    if (this.isDestroyed) {
      return;
    }

    this.loggedIceCandidateWarnings.clear();

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
          debugLog('webrtc', '[WebRTC] Received remote track:', {
            kind: track.kind,
            id: track.id,
            enabled: track.enabled,
            muted: track.muted,
            readyState: track.readyState,
            streamCount: streams.length
          });

          if (track.kind === 'video') {
            if (event.receiver && 'playoutDelayHint' in event.receiver) {
              try {
                event.receiver.playoutDelayHint = 0;
              } catch (error) {
                debugWarn('webrtc', '[WebRTC] 设置播放延迟提示失败:', error);
              }
            }
            if (event.receiver && 'jitterBufferTarget' in event.receiver) {
              try {
                event.receiver.jitterBufferTarget = 0;
              } catch (error) {
                debugWarn('webrtc', '[WebRTC] 设置抖动缓冲目标失败:', error);
              }
            }
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

        this.peerConnection.onicecandidateerror = (event) => {
          const detail = {
            errorCode: event.errorCode,
            errorText: event.errorText,
            url: event.url
          };

          // 常见 STUN 解析/联通失败（701）在受限网络环境下并不影响功能，避免刷屏报错
          if (event.errorCode === 701) {
            const warningKey = `${event.errorCode}:${event.url || ''}`;
            if (!this.loggedIceCandidateWarnings.has(warningKey)) {
              this.loggedIceCandidateWarnings.add(warningKey);
              debugWarn('webrtc', '[WebRTC] ICE candidate warning:', detail);
            }
            return;
          }

          console.error('[WebRTC] ICE candidate error:', detail);
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
      if (this.isDestroyed) {
        return;
      }
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
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
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
        this.schedulePoll(100);
      }
    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      // 如果不是因为服务销毁导致的错误，记录到控制台
      if (
        this.isPolling &&
        errorMessage !== 'Service destroyed' &&
        errorMessage !== 'Request timeout'
      ) {
        console.error('[WebRTC] Polling error:', error);
      }
      
      // 错误后稍等重试
      if (this.isPolling && this.peerConnection) {
        this.schedulePoll(1000);
      }
    }
  }

  private schedulePoll(delayMs: number): void {
    if (!this.isPolling || !this.peerConnection || this.isDestroyed) {
      return;
    }

    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
    }

    // 轮询请求本身可能长挂，下一轮必须可被 stopPolling/cleanup 明确取消。
    this.pollTimer = window.setTimeout(() => {
      this.pollTimer = null;
      void this.pollForCandidates();
    }, delayMs);
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

      case 'disconnected':
      case 'disconnect':
        this.stopPolling();
        break;

      case 'kicked':
        debugWarn('webrtc', '[WebRTC] Kicked by another connection');
        this.stopPolling();
        this.events.onError?.('Connection kicked by another user');
        break;
    }
  }

  /**
   * 停止 WebRTC 流
   */
  async stopStream(): Promise<void> {
    if (this.isDestroyed) {
      return;
    }

    try {
      await this.sendRequest('POST', '/api/webrtc/stop');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage !== 'Service destroyed' && errorMessage !== 'Request timeout') {
        console.error('Failed to stop WebRTC stream:', error);
      }
    } finally {
      this.cleanup();
    }
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
  sendTouchCommand(action: 'down' | 'move' | 'up', x: number, y: number, fingerId?: number): void {
    if (!this.isDataChannelOpen()) {
      return;
    }

    const command: {
      type: 'touch';
      action: 'down' | 'move' | 'up';
      x: number;
      y: number;
      fingerId?: number;
    } = {
      type: 'touch',
      action,
      x: Number(x.toFixed(4)),
      y: Number(y.toFixed(4))
    };
    if (Number.isInteger(fingerId)) {
      command.fingerId = fingerId;
    }
    this.sendDataChannelCommand(command);
  }

  /**
   * 通过 DataChannel 发送按键命令
   * @param action 动作类型: 'press', 'down', 'up'，默认为 'press'
   */
  sendKeyCommand(key: string, action: 'press' | 'down' | 'up' = 'press'): void {
    this.sendDataChannelCommand({
      type: 'key',
      key,
      action
    });
  }

  sendHardwareKeyboardCommand(action: 'status' | 'connect' | 'disconnect'): void {
    this.sendDataChannelCommand({
      type: 'hardware_keyboard',
      action
    });
  }

  /**
   * 通过 DataChannel 发送粘贴命令
   */
  sendPasteCommand(text: string): void {
    this.sendDataChannelCommand({
      type: 'paste',
      text
    });
  }

  /**
   * 通过 DataChannel 发送剪贴板请求（拷贝或剪切）
   * @param operation 'copy' 或 'cut'
   */
  sendClipboardRequest(operation: 'copy' | 'cut'): void {
    this.sendDataChannelCommand({
      type: 'clipboard_request',
      operation
    });
  }

  /**
   * 通过 DataChannel 发送滚轮命令
   */
  sendWheelCommand(payload: {
    x: number;
    y: number;
    deltaY: number;
    rotateQuarter: number;
    settings: RemoteWheelSettings;
  }): void {
    if (!this.isDataChannelOpen()) {
      return;
    }

    this.sendDataChannelCommand({
      type: 'wheel',
      x: Number(payload.x.toFixed(4)),
      y: Number(payload.y.toFixed(4)),
      norm: true,
      deltaY: payload.deltaY,
      rotateQuarter: payload.rotateQuarter,
      ...payload.settings,
    });
  }

  private isDataChannelOpen(): boolean {
    return this.dataChannel?.readyState === 'open';
  }

  private sendDataChannelCommand(command: object): void {
    const channel = this.dataChannel;
    if (channel?.readyState === 'open') {
      channel.send(JSON.stringify(command));
    }
  }

  private setupDataChannel(): void {
    if (!this.dataChannel) return;

    this.dataChannel.onopen = () => {
      this.events.onDataChannelOpen?.();
    };

    this.dataChannel.onerror = (error) => {
      console.error('DataChannel error:', error);
    };

    this.dataChannel.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'clipboard') {
          // 剪贴板内容响应
          this.events.onClipboard?.(data.contentType, data.content || '');
        } else if (data.type === 'clipboard_chunk') {
          // 分块剪贴板数据处理
          this.handleClipboardChunk(data);
        } else if (data.type === 'clipboard_error') {
          // 剪贴板错误
          this.events.onClipboardError?.(data.error || '未知错误');
        } else if (
          data.type === 'hardware_keyboard_state' &&
          (data.action === 'status' || data.action === 'connect' || data.action === 'disconnect') &&
          typeof data.ok === 'boolean' &&
          typeof data.connected === 'boolean'
        ) {
          this.events.onHardwareKeyboardState?.({
            action: data.action,
            supported: true,
            ok: data.ok,
            connected: data.connected,
            message: typeof data.message === 'string' ? data.message : undefined,
          });
        }
      } catch (e) {
        console.error('DataChannel message parse error:', e);
      }
    };
  }

  private clipboardChunks: Map<string, ClipboardChunkState> = new Map();

  private handleClipboardChunk(data: ClipboardChunkMessage): void {
    const { messageId, chunkIndex, totalChunks, data: chunkData, contentType } = data;
    
    if (!this.clipboardChunks.has(messageId)) {
      this.clipboardChunks.set(messageId, { chunks: new Array(totalChunks).fill(''), total: totalChunks, received: 0 });
    }
    
    const entry = this.clipboardChunks.get(messageId)!;
    if (entry.chunks[chunkIndex] === '' && chunkData !== '') {
      entry.received++;
    }
    entry.chunks[chunkIndex] = chunkData;
    
    if (entry.received === entry.total) {
      const fullContent = entry.chunks.join('');
      this.clipboardChunks.delete(messageId);
      this.events.onClipboard?.(contentType as 'text' | 'image', fullContent);
    }
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
  cleanup(): void {
    if (this.isDestroyed) {
      return;
    }
    this.isDestroyed = true;

    // 停止轮询
    this.stopPolling();
    this.pendingCandidates = [];
    this.loggedIceCandidateWarnings.clear();

    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }

    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }

    this.httpClient.destroy(new Error('Service destroyed'));
  }
}
