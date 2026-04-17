import { AuthService } from './AuthService';
import { debugLog } from '../utils/debugLogger';
import type { RemoteWheelSettings } from '../utils/remoteWheel';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export interface ScriptStartState {
  active: boolean;
  cancelable: boolean;
  phase?: string;
}

export interface Device {
  udid: string;
  system?: any;
  scriptStart?: ScriptStartState;
  [key: string]: any;
}

type RemoteWheelCommandPayload = RemoteWheelSettings & {
  deltaY: number;
  rotateQuarter: number;
};

type DeviceLogWatcher = (chunk: string) => void;
type LastLogUpdateCallback = (udid: string, lastLine: string) => void;

// Pending file list request callback type
type FileListCallback = (files: Array<{name: string; type: 'file' | 'directory'; size?: number}>) => void;

// Pending request for requestId-based matching
interface PendingRequest<T = any> {
  resolve: (value: T) => void;
  reject: (reason?: any) => void;
  timeout: ReturnType<typeof setTimeout>;
  type: string; // The expected response type
}

interface SendAuthenticatedMessageOptions {
  body?: any;
  requireOpenConnection?: boolean;
  missingPasswordMessage?: string;
  connectionErrorMessage?: string;
  errorMessage: string;
}

interface SendDeviceCommandOptions {
  body?: any;
  requireOpenConnection?: boolean;
  missingPasswordMessage?: string;
  missingDevicesMessage: string;
  errorMessage: string;
}

export class WebSocketService {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectInterval = 3000;
  private reconnectTimer: number | null = null;
  private shouldReconnect = true;
  private statusCallbacks: ((status: ConnectionStatus) => void)[] = [];
  private messageCallbacks: ((message: any) => void)[] = [];
  private deviceCallbacks: ((devices: Device[]) => void)[] = [];
  private authCallbacks: ((success: boolean, error?: string) => void)[] = [];
  
  // Pending file list requests by deviceUdid (legacy, kept for compatibility)
  private pendingFileListCallbacks: Map<string, FileListCallback[]> = new Map();
  
  // Pending requests by requestId for precise request-response matching
  private pendingRequestsById: Map<string, PendingRequest> = new Map();
  
  private devices: Device[] = [];
  private deviceIndexByUdid: Map<string, number> = new Map();
  private logWatchersByUdid: Map<string, Set<DeviceLogWatcher>> = new Map();
  private lastLogCallbacks: LastLogUpdateCallback[] = [];
  private scriptStartStatesByUdid: Map<string, ScriptStartState> = new Map();
  private password: string = '';
  private isAuthenticating = false;
  private isInitialLogin = true; // 区分首次登录和重连
  private hasReceivedDeviceList = false; // 是否已收到设备列表响应
  private deviceUpdateTimer: number | null = null;
  private deviceUpdateQueued = false;

  constructor(url: string, password: string = '') {
    this.url = url;
    this.password = password;
  }

  connect(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }

    this.shouldReconnect = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.notifyStatusChange('connecting');
    
    try {
      this.ws = new WebSocket(this.url);
      
      this.ws.onopen = () => {

        this.reconnectAttempts = 0;
        this.notifyStatusChange('connected');
        
        // 连接成功后，立即发送设备列表请求来验证认证
        this.isAuthenticating = true;
        this.hasReceivedDeviceList = false;
        
        // 立即发送设备列表请求
        this.requestDeviceList();
        
        // 设置超时，如果5秒内没有收到设备列表响应，认为认证失败
        setTimeout(() => {
          if (this.isAuthenticating && !this.hasReceivedDeviceList) {

            this.isAuthenticating = false;
            this.notifyAuthResult(false, '认证超时，请检查密码是否正确');
            this.disconnect();
          }
        }, 5000);
      };

      this.ws.onmessage = (event) => {

        try {
          const message = JSON.parse(event.data);
          this.handleMessage(message);
        } catch (error) {
          console.error('解析消息失败:', error);
          this.notifyMessage(event.data);
        }
      };

      this.ws.onclose = (event) => {

        this.notifyStatusChange('disconnected');
        
        // 如果在认证期间被关闭，认为是密码错误或连接被拒绝
        if (this.isAuthenticating) {
          this.isAuthenticating = false;
          
          // 如果是首次登录且未收到设备列表响应，清除密码并踢回登录界面
          if (this.isInitialLogin && !this.hasReceivedDeviceList) {

            this.clearStoredPasswordAndReturnToLogin();
            this.notifyAuthResult(false, '认证失败，请重新登录');
          } else {
            this.notifyAuthResult(false, '密码错误或连接被拒绝');
          }
          return;
        }
        
        // 只有在成功认证后才尝试重连
        if (event.code !== 1000 && this.hasReceivedDeviceList && this.reconnectAttempts < this.maxReconnectAttempts) {

          this.scheduleReconnect();
        } else if (!this.hasReceivedDeviceList) {

        }
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket 错误:', error);
        this.notifyStatusChange('disconnected');
        
        if (this.isAuthenticating) {
          this.isAuthenticating = false;
          this.notifyAuthResult(false, '连接失败');
        }
      };

    } catch (error) {
      console.error('WebSocket 连接失败:', error);
      this.notifyStatusChange('disconnected');
      if (this.isAuthenticating) {
        this.isAuthenticating = false;
        this.notifyAuthResult(false, '连接失败');
      }
      this.scheduleReconnect();
    }
  }

  disconnect(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close(1000, 'User disconnected');
      this.ws = null;
    }
    this.notifyStatusChange('disconnected');
    this.devices = [];
    this.deviceIndexByUdid.clear();
    this.clearDeviceUpdateTimer();
    this.notifyDeviceUpdate([]);
  }

  send(message: string | object): boolean {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        const messageStr = typeof message === 'string' ? message : JSON.stringify(message);
        this.ws.send(messageStr);
        return true;
      } catch (error) {
        console.error('发送消息失败:', error);
        return false;
      }
    }
    console.warn('WebSocket 未连接，无法发送消息');
    return false;
  }

  private sendAuthenticatedMessage(messageType: string, options: SendAuthenticatedMessageOptions): void {
    const {
      body,
      requireOpenConnection = false,
      missingPasswordMessage = '未设置密码',
      connectionErrorMessage = 'WebSocket未连接或未认证',
      errorMessage,
    } = options;

    if (requireOpenConnection) {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.password) {
        console.error(connectionErrorMessage);
        return;
      }
    } else if (!this.password) {
      console.error(missingPasswordMessage);
      return;
    }

    try {
      const message = AuthService.getInstance().createControlMessage(
        this.password,
        messageType,
        body,
      );
      this.send(message);
    } catch (error) {
      console.error(errorMessage, error);
    }
  }

  private sendDeviceCommand(
    deviceUdids: string[],
    commandType: string,
    options: SendDeviceCommandOptions,
  ): void {
    const {
      body,
      requireOpenConnection = false,
      missingPasswordMessage = '未设置密码',
      missingDevicesMessage,
      errorMessage,
    } = options;

    if (!deviceUdids || deviceUdids.length === 0) {
      console.error(missingDevicesMessage);
      return;
    }

    this.sendAuthenticatedMessage('control/command', {
      body: body === undefined
        ? {
            devices: deviceUdids,
            type: commandType,
          }
        : {
            devices: deviceUdids,
            type: commandType,
            body,
          },
      requireOpenConnection,
      missingPasswordMessage,
      connectionErrorMessage: 'WebSocket未连接或未认证',
      errorMessage,
    });
  }

  async requestDeviceList(): Promise<void> {
    this.sendAuthenticatedMessage('control/devices', {
      missingPasswordMessage: '未设置密码，无法请求设备列表',
      errorMessage: '请求设备列表失败:',
    });
  }

  async refreshDeviceStates(): Promise<void> {
    this.sendAuthenticatedMessage('control/refresh', {
      missingPasswordMessage: '未设置密码，无法刷新设备状态',
      errorMessage: '刷新设备状态失败:',
    });
  }

  async subscribeDeviceLogs(deviceUdids: string[]): Promise<void> {
    if (!deviceUdids || deviceUdids.length === 0) {
      console.error('未选择设备，无法订阅日志');
      return;
    }

    this.sendAuthenticatedMessage('control/log/subscribe', {
      body: { devices: deviceUdids },
      missingPasswordMessage: '未设置密码，无法订阅日志',
      errorMessage: '订阅日志失败:',
    });
  }

  async unsubscribeDeviceLogs(deviceUdids: string[]): Promise<void> {
    if (!deviceUdids || deviceUdids.length === 0) {
      console.error('未选择设备，无法取消订阅日志');
      return;
    }

    this.sendAuthenticatedMessage('control/log/unsubscribe', {
      body: { devices: deviceUdids },
      missingPasswordMessage: '未设置密码，无法取消订阅日志',
      errorMessage: '取消订阅日志失败:',
    });
  }

  /**
   * 发送命令并等待响应（基于 requestId 匹配）
   * @param deviceUdids 目标设备列表
   * @param commandType 命令类型，如 'file/list', 'script/run' 等
   * @param body 命令参数
   * @param timeoutMs 超时时间（毫秒），默认 10000
   * @returns Promise 解析为响应消息
   */
  async sendCommandAsync(
    deviceUdids: string[],
    commandType: string,
    body?: any,
    timeoutMs: number = 10000
  ): Promise<any> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.password) {
      throw new Error('WebSocket未连接或未认证');
    }

    return new Promise((resolve, reject) => {
      const message = AuthService.getInstance().createControlMessage(
        this.password,
        'control/command',
        {
          devices: deviceUdids,
          type: commandType,
          body: body
        }
      );

      const requestId = message.body?.requestId;
      if (!requestId) {
        reject(new Error('未能生成 requestId'));
        return;
      }

      // 设置超时
      const timeout = setTimeout(() => {
        this.pendingRequestsById.delete(requestId);
        reject(new Error(`命令超时: ${commandType}`));
      }, timeoutMs);

      // 注册 pending request
      this.pendingRequestsById.set(requestId, {
        resolve,
        reject,
        timeout,
        type: commandType
      });

      // 发送消息
      if (!this.send(message)) {
        clearTimeout(timeout);
        this.pendingRequestsById.delete(requestId);
        reject(new Error('发送消息失败'));
      }
    });
  }

  async startScript(deviceUdids: string[], scriptName: string): Promise<void> {
    this.sendDeviceCommand(deviceUdids, 'script/run', {
      body: { name: scriptName || '' },
      missingPasswordMessage: '未设置密码，无法启动脚本',
      missingDevicesMessage: '未选择设备，无法启动脚本',
      errorMessage: '启动脚本失败:',
    });
  }

  async stopScript(deviceUdids: string[]): Promise<void> {
    this.sendDeviceCommand(deviceUdids, 'script/stop', {
      missingPasswordMessage: '未设置密码，无法停止脚本',
      missingDevicesMessage: '未选择设备，无法停止脚本',
      errorMessage: '停止脚本失败:',
    });
  }

  async pauseScript(deviceUdids: string[]): Promise<void> {
    this.sendDeviceCommand(deviceUdids, 'script/pause', {
      missingPasswordMessage: '未设置密码，无法暂停脚本',
      missingDevicesMessage: '未选择设备，无法暂停脚本',
      errorMessage: '暂停脚本失败:',
    });
  }

  async resumeScript(deviceUdids: string[]): Promise<void> {
    this.sendDeviceCommand(deviceUdids, 'script/resume', {
      missingPasswordMessage: '未设置密码，无法继续脚本',
      missingDevicesMessage: '未选择设备，无法继续脚本',
      errorMessage: '继续脚本失败:',
    });
  }

  async respringDevices(deviceUdids: string[]): Promise<void> {
    this.sendDeviceCommand(deviceUdids, 'system/respring', {
      missingPasswordMessage: '未设置密码，无法注销设备',
      missingDevicesMessage: '未选择设备，无法注销设备',
      errorMessage: '注销设备失败:',
    });
  }

  async rebootDevices(deviceUdids: string[]): Promise<void> {
    this.sendDeviceCommand(deviceUdids, 'system/reboot', {
      missingPasswordMessage: '未设置密码，无法重启设备',
      missingDevicesMessage: '未选择设备，无法重启设备',
      errorMessage: '重启设备失败:',
    });
  }

  async uploadFile(deviceUdids: string[], filePath: string, fileData: string): Promise<void> {
    if (!deviceUdids || deviceUdids.length === 0) {
      console.error('未选择设备，无法上传文件');
      return;
    }

    if (!filePath || !filePath.trim()) {
      console.error('未指定文件路径，无法上传文件');
      return;
    }

    if (fileData === undefined || fileData === null) {
      console.error('文件数据为空，无法上传文件');
      return;
    }

    this.sendDeviceCommand(deviceUdids, 'file/put', {
      body: {
        path: filePath.trim(),
        data: fileData,
      },
      missingPasswordMessage: '未设置密码，无法上传文件',
      missingDevicesMessage: '未选择设备，无法上传文件',
      errorMessage: '上传文件失败:',
    });
  }

  // 列出文件目录
  async listFiles(deviceUdid: string, path: string): Promise<void> {
    this.sendDeviceCommand([deviceUdid], 'file/list', {
      body: { path: path.trim() },
      requireOpenConnection: true,
      missingDevicesMessage: '未选择设备，无法获取文件列表',
      errorMessage: '获取文件列表失败:',
    });
  }

  // 列出文件目录 (Promise 版本，用于递归扫描)
  // 使用 sendCommandAsync 实现精确的 requestId 匹配
  async listFilesAsync(deviceUdid: string, path: string): Promise<Array<{name: string; type: 'file' | 'directory'; size?: number}>> {
    try {
      const response = await this.sendCommandAsync(
        [deviceUdid],
        'file/list',
        { path: path.trim() },
        10000
      );
      
      // 转换文件类型格式
      if (response.body && Array.isArray(response.body)) {
        return response.body.map((f: any) => ({
          name: f.name,
          type: f.type === 'dir' ? 'directory' as const : 'file' as const,
          size: f.size
        }));
      }
      
      // 如果有错误，返回空数组
      if (response.error) {
        console.warn(`listFilesAsync 失败: ${response.error}`);
      }
      return [];
    } catch (error) {
      console.error('获取文件列表失败:', error);
      return [];
    }
  }

  // 删除文件
  async deleteFile(deviceUdid: string, path: string): Promise<void> {
    this.sendDeviceCommand([deviceUdid], 'file/delete', {
      body: { path: path.trim() },
      requireOpenConnection: true,
      missingDevicesMessage: '未选择设备，无法删除文件',
      errorMessage: '删除文件失败:',
    });
  }

  // 创建目录
  async createDirectory(deviceUdid: string, path: string): Promise<void> {
    this.sendDeviceCommand([deviceUdid], 'file/put', {
      body: {
        path: path.trim(),
        directory: true,
      },
      requireOpenConnection: true,
      missingDevicesMessage: '未选择设备，无法创建目录',
      errorMessage: '创建目录失败:',
    });
  }

  // 下载文件
  async downloadFile(udid: string, path: string): Promise<void> {
    this.sendDeviceCommand([udid], 'file/get', {
      body: { path: path.trim() },
      missingPasswordMessage: '未设置密码，无法下载文件',
      missingDevicesMessage: '未选择设备，无法下载文件',
      errorMessage: '下载文件失败:',
    });
  }

  // 移动/重命名文件
  async moveFile(deviceUdid: string, fromPath: string, toPath: string): Promise<void> {
    this.sendDeviceCommand([deviceUdid], 'file/move', {
      body: {
        from: fromPath.trim(),
        to: toPath.trim(),
      },
      requireOpenConnection: true,
      missingDevicesMessage: '未选择设备，无法移动文件',
      errorMessage: '移动文件失败:',
    });
  }

  // 复制文件
  async copyFile(deviceUdid: string, fromPath: string, toPath: string): Promise<void> {
    this.sendDeviceCommand([deviceUdid], 'file/copy', {
      body: {
        from: fromPath.trim(),
        to: toPath.trim(),
      },
      requireOpenConnection: true,
      missingDevicesMessage: '未选择设备，无法复制文件',
      errorMessage: '复制文件失败:',
    });
  }

  // 读取文本文件内容
  async readFile(deviceUdid: string, path: string): Promise<void> {
    this.sendDeviceCommand([deviceUdid], 'file/get', {
      body: { path: path.trim() },
      requireOpenConnection: true,
      missingDevicesMessage: '未选择设备，无法读取文件',
      errorMessage: '读取文件失败:',
    });
  }

  // 读取剪贴板
  async readClipboard(deviceUdids: string[]): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.password) {
      console.error('WebSocket未连接或未认证');
      return;
    }

    try {
      const message = AuthService.getInstance().createControlMessage(
        this.password,
        'control/command',
        {
          devices: deviceUdids,
          type: 'pasteboard/read'
        }
      );
      
      this.send(message);

    } catch (error) {
      console.error('读取剪贴板失败:', error);
    }
  }

  // 写入剪贴板
  async writeClipboard(deviceUdids: string[], uti: string, data: string): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.password) {
      console.error('WebSocket未连接或未认证');
      return;
    }

    try {
      const message = AuthService.getInstance().createControlMessage(
        this.password,
        'control/command',
        {
          devices: deviceUdids,
          type: 'pasteboard/write',
          body: {
            uti: uti,
            data: data
          }
        }
      );
      
      this.send(message);

    } catch (error) {
      console.error('写入剪贴板失败:', error);
    }
  }

  // 屏幕截图
  async takeScreenshot(deviceUdid: string, scale: number = 30): Promise<void> {
    this.sendDeviceCommand([deviceUdid], 'screen/snapshot', {
      body: {
        format: 'png',
        scale,
      },
      requireOpenConnection: true,
      missingDevicesMessage: '未选择设备，无法屏幕截图',
      errorMessage: '屏幕截图失败:',
    });
  }

  private handleMessage(message: any): void {

    // 首先检查是否有匹配的 pending request（基于 requestId）
    if (message.requestId) {
      const pending = this.pendingRequestsById.get(message.requestId);
      if (pending) {
        // 清除超时
        clearTimeout(pending.timeout);
        this.pendingRequestsById.delete(message.requestId);
        // 解析 Promise
        pending.resolve(message);
        // 继续处理消息（如更新设备状态等）
      }
    }
    
    // 处理设备断开连接消息
    if (message.type === 'device/disconnect' && message.body) {
      const udid = message.body;

      this.removeDevice(udid);
      return;
    }

    if (message.type === 'script/start/state' && message.body?.udid) {
      this.updateScriptStartState(message.body.udid, message.body);
      this.notifyMessage(message);
      return;
    }
    
    // 处理脚本运行消息
    if (message.type === 'script/run' && message.body?.name && message.udid) {

      this.updateDeviceScriptStatus(message.udid, true);
      return;
    }
    
    // 处理脚本停止消息
    if (message.type === 'script/stop' && message.udid) {

      this.updateDeviceScriptStatus(message.udid, false);
      return;
    }
    
    // 处理脚本选中消息
    if (message.type === 'script/selected/put' && message.body?.name && message.udid) {
      this.updateDeviceSelectedScript(message.udid, message.body.name);
      return;
    }

    // 处理实时日志推送
    if (message.type === 'system/log/push' && message.udid && message.body?.chunk) {
      const chunk = typeof message.body.chunk === 'string' ? message.body.chunk : '';
      if (!chunk) {
        return;
      }

      this.notifyDeviceLogWatchers(message.udid, chunk);

      const lastLine = this.extractLastLogLine(chunk);
      if (lastLine !== null) {
        this.notifyLastLogUpdate(message.udid, lastLine);
      }
      return;
    }
    
    // 处理设备状态消息 - 实时更新设备数据
    if (message.type === 'app/state' && message.body?.system?.udid) {
      this.updateDevice(message.body);
      return;
    }

    // 处理传输进度
    if (message.type === 'transfer/progress' && message.body) {
      this.handleTransferProgress(message.body);
      return;
    }

    // 处理设备状态消息 (来自服务端的广播)
    if (message.type === 'device/message' && message.body?.udid) {
      this.updateDeviceMessage(message.body.udid, message.body.message);
      return;
    }

    // 处理传输完成
    if (message.type === 'transfer/fetch/complete' || message.type === 'transfer/send/complete') {
      this.handleTransferComplete(message);
      // Do NOT return here - App.tsx onMessage handler needs this message
      // to trigger browser download for large file transfers
    }

    // 处理设备列表响应
    if (message.type === 'control/devices' && message.body && typeof message.body === 'object') {
      debugLog('ws', '收到设备列表响应');
      
      // 标记已收到设备列表响应
      this.hasReceivedDeviceList = true;
      
      // 如果正在认证中，认为认证成功
      if (this.isAuthenticating) {
        debugLog('ws', '认证成功，收到设备列表响应');
        this.isAuthenticating = false;
        this.isInitialLogin = false; // 标记为非首次登录
        this.notifyAuthResult(true);
      }
      
      // 后端返回的格式是 {udid: deviceData, udid2: deviceData2, ...}
      // 这里尽量复用未变化设备的引用，避免一次快照把整张表都变成“全量更新”
      const deviceArray: Device[] = [];
      for (const [udid, deviceData] of Object.entries(message.body)) {
        if (deviceData && typeof deviceData === 'object') {
          const existingIndex = this.getDeviceIndex(udid);
          const existingDevice = existingIndex >= 0 ? this.devices[existingIndex] : undefined;
          deviceArray.push(this.buildDeviceFromPayload(udid, deviceData, existingDevice, false));
        }
      }

      const deviceListChanged = this.hasDeviceListChanged(deviceArray);
      if (deviceListChanged) {
        this.devices = deviceArray;
        this.rebuildDeviceIndex();
      }
      this.syncActiveLogSubscriptions();
      if (deviceListChanged) {
        this.flushDeviceUpdate();
      }
      return;
    }

    // 处理文件操作响应
    if (message.type === 'file/list' || message.type === 'file/put' || message.type === 'file/delete') {
      debugLog('ws', '文件操作响应:', message);
      
      // 处理 file/list 的异步回调
      if (message.type === 'file/list' && message.udid) {
        const callbacks = this.pendingFileListCallbacks.get(message.udid);
        if (callbacks && callbacks.length > 0) {
          const callback = callbacks.shift();
          if (callbacks.length === 0) {
            this.pendingFileListCallbacks.delete(message.udid);
          }
          if (callback) {
            // 清除超时
            if ((callback as any)._timeout) {
              clearTimeout((callback as any)._timeout);
            }
            // 转换文件类型
            const files = (message.body && Array.isArray(message.body)) 
              ? message.body.map((f: any) => ({
                  name: f.name,
                  type: f.type === 'dir' ? 'directory' as const : 'file' as const,
                  size: f.size
                }))
              : [];
            callback(files);
          }
        }
      }
      
      // 文件操作响应转发给回调处理
      this.notifyMessage(message);
      return;
    }

    // 其他消息转发给回调
    this.notifyMessage(message);
  }

  private clearStoredPasswordAndReturnToLogin(): void {
    // 清除存储的密码hash
    localStorage.removeItem('xxt_password_hash');
    debugLog('ws', '已清除存储的密码hash');
    
    // 重置认证状态
    this.isInitialLogin = true;
    this.hasReceivedDeviceList = false;
    
    // 可以在这里添加额外的逻辑，比如通知上层组件返回登录界面
  }

  private isStructuredObject(value: unknown): value is Record<string, any> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  private mergeStructuredValue<T>(current: T, next: T): T {
    if (current === next) {
      return current;
    }

    if (Array.isArray(current) && Array.isArray(next)) {
      if (current.length !== next.length) {
        return next.map((item, index) => this.mergeStructuredValue(current[index], item)) as T;
      }

      let changed = false;
      const merged = next.map((item, index) => {
        const mergedItem = this.mergeStructuredValue(current[index], item);
        if (mergedItem !== current[index]) {
          changed = true;
        }
        return mergedItem;
      });

      return changed ? merged as T : current;
    }

    if (this.isStructuredObject(current) && this.isStructuredObject(next)) {
      const currentKeys = Object.keys(current);
      const nextKeys = Object.keys(next);

      let changed = currentKeys.length !== nextKeys.length;
      const merged: Record<string, any> = {};

      for (const key of nextKeys) {
        if (!changed && !Object.prototype.hasOwnProperty.call(current, key)) {
          changed = true;
        }
        const mergedValue = this.mergeStructuredValue(current[key], next[key]);
        merged[key] = mergedValue;
        if (!changed && mergedValue !== current[key]) {
          changed = true;
        }
      }

      return changed ? merged as T : current;
    }

    return next;
  }

  private buildDeviceFromPayload(
    udid: string,
    rawDevice: any,
    existingDevice?: Device,
    preserveTransientSystemFields: boolean = false,
  ): Device {
    const nextDevice: Device = {
      ...(rawDevice as Record<string, any>),
      udid,
    };

    if (this.isStructuredObject(nextDevice.script)) {
      nextDevice.script = { ...nextDevice.script };
    }

    let nextSystem = this.isStructuredObject(nextDevice.system)
      ? { ...nextDevice.system }
      : undefined;

    if (preserveTransientSystemFields && existingDevice?.system) {
      if (existingDevice.system.message !== undefined && nextSystem?.message === undefined) {
        nextSystem = { ...(nextSystem || {}), message: existingDevice.system.message };
      }

      if (existingDevice.system.log !== undefined && nextSystem?.log === undefined) {
        nextSystem = { ...(nextSystem || {}), log: existingDevice.system.log };
      }
    }

    if (this.isStructuredObject(nextDevice.script)) {
      nextSystem = {
        ...(nextSystem || {}),
        running: nextDevice.script.running === true,
        paused: nextDevice.script.paused === true,
      };
      nextDevice.tempOldSelect = nextDevice.script.select;
    }

    if (nextSystem) {
      nextDevice.system = nextSystem;
    } else {
      delete nextDevice.system;
    }

    const scriptStartState = this.scriptStartStatesByUdid.get(udid);
    if (scriptStartState) {
      nextDevice.scriptStart = { ...scriptStartState };
    } else {
      delete nextDevice.scriptStart;
    }

    return existingDevice
      ? this.mergeStructuredValue(existingDevice, nextDevice)
      : nextDevice;
  }

  private hasDeviceListChanged(nextDevices: Device[]): boolean {
    if (nextDevices.length !== this.devices.length) {
      return true;
    }

    for (let i = 0; i < nextDevices.length; i++) {
      if (nextDevices[i] !== this.devices[i]) {
        return true;
      }
    }

    return false;
  }

  private updateDevice(deviceData: any): void {
    const udid = deviceData.system?.udid;
    if (!udid) return;

    const existingIndex = this.getDeviceIndex(udid);
    if (existingIndex >= 0) {
      const currentDevice = this.devices[existingIndex];
      const nextDevice = this.buildDeviceFromPayload(udid, deviceData, currentDevice, true);
      if (nextDevice === currentDevice) {
        return;
      }

      this.devices[existingIndex] = nextDevice;
      debugLog('ws', `设备 ${udid} 状态已更新`);
    } else {
      // 新设备，添加到列表
      const newDevice = this.buildDeviceFromPayload(udid, deviceData);
      this.devices.push(newDevice);
      this.deviceIndexByUdid.set(udid, this.devices.length - 1);
      debugLog('ws', `新设备 ${udid} 已添加`);
    }
    
    // 通知界面更新
    this.scheduleDeviceUpdate();
  }

  private removeDevice(udid: string): void {
    if (!udid) return;

    this.scriptStartStatesByUdid.delete(udid);

    const existingIndex = this.getDeviceIndex(udid);
    if (existingIndex >= 0) {
      // 从设备列表中移除设备
      this.devices.splice(existingIndex, 1);
      this.deviceIndexByUdid.delete(udid);
      for (let i = existingIndex; i < this.devices.length; i++) {
        this.deviceIndexByUdid.set(this.devices[i].udid, i);
      }
      debugLog('ws', `设备 ${udid} 已从列表中移除`);
      
      // 通知界面更新
      this.scheduleDeviceUpdate();
    } else {
      debugLog('ws', `设备 ${udid} 不在列表中，无需移除`);
    }
  }

  private updateDeviceScriptStatus(udid: string, isRunning: boolean): void {
    if (!udid) return;

    const existingIndex = this.getDeviceIndex(udid);
    if (existingIndex >= 0) {
      const device = this.devices[existingIndex];

      const nextSystem = device.system ? { ...device.system } : {};
      let changed = !device.script || !device.system;

      if (nextSystem.running !== isRunning) {
        nextSystem.running = isRunning;
        changed = true;
      }
      if (nextSystem.paused !== false) {
        nextSystem.paused = false;
        changed = true;
      }

      if (!changed) {
        return;
      }

      this.devices[existingIndex] = {
        ...device,
        ...(device.script ? {} : { script: {} }),
        system: nextSystem,
      };
      
      debugLog('ws', `设备 ${udid} 脚本状态已更新: ${isRunning ? '运行中' : '已停止'}`);
      
      // 通知界面更新
      this.scheduleDeviceUpdate();
    } else {
      debugLog('ws', `设备 ${udid} 不在列表中，无法更新脚本状态`);
    }
  }

  private updateDeviceSelectedScript(udid: string, scriptName: string): void {
    if (!udid) return;

    const existingIndex = this.getDeviceIndex(udid);
    if (existingIndex >= 0) {
      const device = this.devices[existingIndex];

      const scriptChanged = device.script?.select !== scriptName;
      const tempChanged = device.tempOldSelect !== scriptName;
      if (!scriptChanged && !tempChanged) {
        return;
      }

      this.devices[existingIndex] = {
        ...device,
        ...(scriptChanged ? { script: { ...(device.script || {}), select: scriptName } } : {}),
        tempOldSelect: scriptName,
      };
      
      debugLog('ws', `设备 ${udid} 选中脚本已通过消息回复更新: ${scriptName}`);
      
      // 通知界面更新
      this.scheduleDeviceUpdate();
    }
  }

  public updateDeviceMessage(udid: string, msg: string): void {
    if (!udid) return;

    const existingIndex = this.getDeviceIndex(udid);
    if (existingIndex >= 0) {
      const device = this.devices[existingIndex];
      const system = { ...(device.system || {}) };
      if (system.message === msg) {
        return;
      }
      system.message = msg;
      this.devices[existingIndex] = {
        ...device,
        system,
      };
      
      this.scheduleDeviceUpdate();
    }
  }

  private handleTransferProgress(body: any): void {
    const { percent, deviceSN } = body;
    if (deviceSN) {
      this.updateDeviceMessage(deviceSN, `传输中 ${percent.toFixed(0)}%`);
    }
  }

  private handleTransferComplete(message: any): void {
    const deviceSN = message.body?.deviceSN || message.udid;
    if (deviceSN) {
      if (message.error) {
        this.updateDeviceMessage(deviceSN, '传输失败');
      } else {
        this.updateDeviceMessage(deviceSN, '传输完成');
      }
    }
  }

  onStatusChange(callback: (status: ConnectionStatus) => void): () => void {
    this.statusCallbacks.push(callback);
    return () => {
      this.statusCallbacks = this.statusCallbacks.filter(cb => cb !== callback);
    };
  }

  onMessage(callback: (message: any) => void): () => void {
    this.messageCallbacks.push(callback);
    return () => {
      this.messageCallbacks = this.messageCallbacks.filter(cb => cb !== callback);
    };
  }

  watchDeviceLog(udid: string, callback: DeviceLogWatcher): () => void {
    if (!udid) {
      return () => {};
    }

    let watchers = this.logWatchersByUdid.get(udid);
    const shouldSubscribe = !watchers || watchers.size === 0;
    if (!watchers) {
      watchers = new Set<DeviceLogWatcher>();
      this.logWatchersByUdid.set(udid, watchers);
    }
    watchers.add(callback);

    if (shouldSubscribe) {
      this.ensureLogSubscription(udid, true);
    }

    return () => {
      const currentWatchers = this.logWatchersByUdid.get(udid);
      if (!currentWatchers) {
        return;
      }

      currentWatchers.delete(callback);
      if (currentWatchers.size > 0) {
        return;
      }

      this.logWatchersByUdid.delete(udid);
      this.ensureLogSubscription(udid, false);
    };
  }

  onDeviceUpdate(callback: (devices: Device[]) => void): void {
    this.deviceCallbacks.push(callback);
  }

  onLastLogUpdate(callback: LastLogUpdateCallback): () => void {
    this.lastLogCallbacks.push(callback);
    return () => {
      this.lastLogCallbacks = this.lastLogCallbacks.filter(cb => cb !== callback);
    };
  }

  replaceScriptStartStates(states: Record<string, ScriptStartState>): void {
    const nextStates = new Map<string, ScriptStartState>();
    if (states && typeof states === 'object') {
      for (const [udid, rawState] of Object.entries(states)) {
        const state = this.normalizeScriptStartState(rawState);
        if (!state || !state.active) {
          continue;
        }
        nextStates.set(udid, state);
      }
    }

    this.scriptStartStatesByUdid = nextStates;

    let changed = false;
    for (let index = 0; index < this.devices.length; index++) {
      if (this.applyScriptStartStateToDevice(index)) {
        changed = true;
      }
    }
    if (changed) {
      this.scheduleDeviceUpdate();
    }
  }

  onAuthResult(callback: (success: boolean, error?: string) => void): void {
    this.authCallbacks.push(callback);
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect) return;
    this.reconnectAttempts++;
    debugLog('ws', `尝试重连 (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    this.reconnectTimer = window.setTimeout(() => {
      if (this.reconnectAttempts <= this.maxReconnectAttempts) {
        this.connect();
      }
    }, this.reconnectInterval);
  }

  private notifyStatusChange(status: ConnectionStatus): void {
    this.statusCallbacks.forEach(callback => callback(status));
  }

  private notifyMessage(message: any): void {
    this.messageCallbacks.forEach(callback => callback(message));
  }

  private notifyDeviceLogWatchers(udid: string, chunk: string): void {
    const watchers = this.logWatchersByUdid.get(udid);
    if (!watchers || watchers.size === 0) {
      return;
    }

    watchers.forEach((callback) => callback(chunk));
  }

  private notifyLastLogUpdate(udid: string, lastLine: string): void {
    this.lastLogCallbacks.forEach((callback) => callback(udid, lastLine));
  }

  private notifyDeviceUpdate(devices: Device[]): void {
    this.deviceCallbacks.forEach(callback => callback(devices));
  }

  private normalizeScriptStartState(rawState: any): ScriptStartState | null {
    if (!rawState || typeof rawState !== 'object') {
      return null;
    }

    return {
      active: rawState.active === true,
      cancelable: rawState.cancelable === true,
      phase: typeof rawState.phase === 'string' ? rawState.phase : '',
    };
  }

  private updateScriptStartState(udid: string, rawState: any): void {
    if (!udid) {
      return;
    }

    const state = this.normalizeScriptStartState(rawState);
    if (!state || !state.active) {
      this.scriptStartStatesByUdid.delete(udid);
    } else {
      this.scriptStartStatesByUdid.set(udid, state);
    }

    const existingIndex = this.getDeviceIndex(udid);
    if (existingIndex < 0) {
      return;
    }

    if (this.applyScriptStartStateToDevice(existingIndex)) {
      this.scheduleDeviceUpdate();
    }
  }

  private applyScriptStartStateToDevice(index: number): boolean {
    const device = this.devices[index];
    const state = this.scriptStartStatesByUdid.get(device.udid);

    if (state) {
      const current = device.scriptStart;
      if (
        current &&
        current.active === state.active &&
        current.cancelable === state.cancelable &&
        current.phase === state.phase
      ) {
        return false;
      }

      this.devices[index] = {
        ...device,
        scriptStart: { ...state },
      };
      return true;
    }

    if (device.scriptStart === undefined) {
      return false;
    }

    const nextDevice = { ...device };
    delete nextDevice.scriptStart;
    this.devices[index] = nextDevice;
    return true;
  }

  private ensureLogSubscription(udid: string, subscribe: boolean): void {
    if (!udid || !this.password || !this.ws || this.ws.readyState !== WebSocket.OPEN || !this.hasReceivedDeviceList) {
      return;
    }

    if (subscribe) {
      void this.subscribeDeviceLogs([udid]);
      return;
    }

    void this.unsubscribeDeviceLogs([udid]);
  }

  private scheduleDeviceUpdate(immediate: boolean = false): void {
    if (immediate) {
      this.flushDeviceUpdate();
      return;
    }
    if (this.deviceUpdateQueued) return;
    this.deviceUpdateQueued = true;
    this.deviceUpdateTimer = window.setTimeout(() => {
      this.deviceUpdateQueued = false;
      this.deviceUpdateTimer = null;
      this.notifyDeviceUpdate([...this.devices]);
    }, 50);
  }

  private flushDeviceUpdate(): void {
    if (this.deviceUpdateTimer) {
      clearTimeout(this.deviceUpdateTimer);
      this.deviceUpdateTimer = null;
    }
    this.deviceUpdateQueued = false;
    this.notifyDeviceUpdate([...this.devices]);
  }

  private clearDeviceUpdateTimer(): void {
    if (this.deviceUpdateTimer) {
      clearTimeout(this.deviceUpdateTimer);
      this.deviceUpdateTimer = null;
    }
    this.deviceUpdateQueued = false;
  }

  private rebuildDeviceIndex(): void {
    this.deviceIndexByUdid.clear();
    for (let i = 0; i < this.devices.length; i++) {
      this.deviceIndexByUdid.set(this.devices[i].udid, i);
    }
  }

  private getDeviceIndex(udid: string): number {
    const index = this.deviceIndexByUdid.get(udid);
    return index === undefined ? -1 : index;
  }

  private syncActiveLogSubscriptions(): void {
    if (!this.password || !this.ws || this.ws.readyState !== WebSocket.OPEN || !this.hasReceivedDeviceList) {
      return;
    }

    const activeUdids = [...this.logWatchersByUdid.keys()];
    if (activeUdids.length === 0) {
      return;
    }

    void this.subscribeDeviceLogs(activeUdids);
  }

  private extractLastLogLine(chunk: string): string | null {
    let end = chunk.length;
    while (end > 0) {
      const ch = chunk.charCodeAt(end - 1);
      if (ch === 10 || ch === 13) {
        end--;
        continue;
      }
      break;
    }
    if (end === 0) {
      return null;
    }

    const lastLF = chunk.lastIndexOf('\n', end - 1);
    const lastCR = chunk.lastIndexOf('\r', end - 1);
    const start = Math.max(lastLF, lastCR) + 1;
    const lastLine = chunk.slice(start, end);
    return lastLine === '' ? null : lastLine;
  }

  private notifyAuthResult(success: boolean, error?: string): void {
    this.authCallbacks.forEach(callback => callback(success, error));
  }

  getConnectionStatus(): ConnectionStatus {
    if (!this.ws) return 'disconnected';
    
    switch (this.ws.readyState) {
      case WebSocket.CONNECTING:
        return 'connecting';
      case WebSocket.OPEN:
        return 'connected';
      default:
        return 'disconnected';
    }
  }

  getDevices(): Device[] {
    return [...this.devices];
  }

  setPassword(password: string): void {
    this.password = password;
  }

  // 发送触控命令（支持多设备）
  async sendTouchCommand(
    deviceUdids: string[],
    touchType: 'touch/down' | 'touch/move' | 'touch/up',
    x: number,
    y: number,
    finger?: number
  ): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.password) {
      console.error('WebSocket未连接或未认证');
      return;
    }

    if (deviceUdids.length === 0) {
      console.warn('没有指定目标设备');
      return;
    }

    try {
      const body: {
        x: number;
        y: number;
        finger?: number;
      } = {
        x: x,
        y: y
      };
      if (Number.isInteger(finger)) {
        body.finger = finger;
      }

      const message = AuthService.getInstance().createControlMessage(
        this.password,
        'control/command',
        {
          devices: deviceUdids,
          type: touchType,
          body
        }
      );
      
      this.send(message);
      // console.log(`已发送触控命令: ${touchType} (${x}, ${y}) 设备: ${deviceUdids.join(', ')}`);
    } catch (error) {
      console.error('发送触控命令失败:', error);
    }
  }

  // 触控按下（单设备）
  async touchDown(deviceUdid: string, x: number, y: number, finger?: number): Promise<void> {
    return this.sendTouchCommand([deviceUdid], 'touch/down', x, y, finger);
  }

  // 触控移动（单设备）
  async touchMove(deviceUdid: string, x: number, y: number, finger?: number): Promise<void> {
    return this.sendTouchCommand([deviceUdid], 'touch/move', x, y, finger);
  }

  // 触控抬起（单设备）
  async touchUp(deviceUdid: string, x: number, y: number, finger?: number): Promise<void> {
    return this.sendTouchCommand([deviceUdid], 'touch/up', x, y, finger);
  }

  // 触控按下（多设备）
  async touchDownMultiple(deviceUdids: string[], x: number, y: number, finger?: number): Promise<void> {
    return this.sendTouchCommand(deviceUdids, 'touch/down', x, y, finger);
  }

  // 触控移动（多设备）
  async touchMoveMultiple(deviceUdids: string[], x: number, y: number, finger?: number): Promise<void> {
    return this.sendTouchCommand(deviceUdids, 'touch/move', x, y, finger);
  }

  // 触控抬起（多设备）
  async touchUpMultiple(deviceUdids: string[], x: number, y: number, finger?: number): Promise<void> {
    return this.sendTouchCommand(deviceUdids, 'touch/up', x, y, finger);
  }

  private groupDevicesByNormalizedCoordinates(
    deviceUdids: string[],
    nx: number,
    ny: number
  ): Array<{ devices: string[]; x: number; y: number }> {
    const grouped = new Map<string, { devices: string[]; x: number; y: number }>();

    for (const udid of deviceUdids) {
      const idx = this.deviceIndexByUdid.get(udid);
      if (idx === undefined) {
        continue;
      }
      const device = this.devices[idx];
      const scrw = Number(device?.system?.scrw);
      const scrh = Number(device?.system?.scrh);
      if (!Number.isFinite(scrw) || !Number.isFinite(scrh) || scrw <= 0 || scrh <= 0) {
        continue;
      }

      const x = Math.floor(nx * scrw);
      const y = Math.floor(ny * scrh);
      const key = `${x}:${y}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.devices.push(udid);
      } else {
        grouped.set(key, { devices: [udid], x, y });
      }
    }

    return Array.from(grouped.values());
  }

  // 触控按下（多设备 - 使用归一化坐标）
  async touchDownMultipleNormalized(deviceUdids: string[], nx: number, ny: number, finger?: number): Promise<void> {
    const grouped = this.groupDevicesByNormalizedCoordinates(deviceUdids, nx, ny);
    await Promise.all(grouped.map(group => this.sendTouchCommand(group.devices, 'touch/down', group.x, group.y, finger)));
  }

  // 触控移动（多设备 - 使用归一化坐标）
  async touchMoveMultipleNormalized(deviceUdids: string[], nx: number, ny: number, finger?: number): Promise<void> {
    const grouped = this.groupDevicesByNormalizedCoordinates(deviceUdids, nx, ny);
    await Promise.all(grouped.map(group => this.sendTouchCommand(group.devices, 'touch/move', group.x, group.y, finger)));
  }

  // 触控抬起（多设备 - 使用归一化坐标）
  async touchUpMultipleNormalized(deviceUdids: string[], finger?: number): Promise<void> {
    if (deviceUdids.length === 0) return;
    await this.sendTouchCommand(deviceUdids, 'touch/up', 0, 0, finger);
  }

  async sendWheelCommandMultipleNormalized(
    deviceUdids: string[],
    nx: number,
    ny: number,
    payload: RemoteWheelCommandPayload
  ): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.password) {
      console.error('WebSocket未连接或未认证');
      return;
    }

    if (deviceUdids.length === 0) {
      return;
    }

    const grouped = this.groupDevicesByNormalizedCoordinates(deviceUdids, nx, ny);
    if (grouped.length === 0) {
      return;
    }

    try {
      for (const group of grouped) {
        const message = AuthService.getInstance().createControlMessage(
          this.password,
          'control/command',
          {
            devices: group.devices,
            type: 'touch/wheel-async',
            body: {
              x: group.x,
              y: group.y,
              ...payload,
            }
          }
        );

        this.send(message);
      }
    } catch (error) {
      console.error('发送滚轮命令失败:', error);
    }
  }

  // 发送按键命令（支持多设备）
  async sendKeyCommand(deviceUdids: string[], keyType: 'key/down' | 'key/up', keyCode: string): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.password) {
      console.error('WebSocket未连接或未认证');
      return;
    }

    if (deviceUdids.length === 0) {
      console.warn('没有指定目标设备');
      return;
    }

    try {
      const message = AuthService.getInstance().createControlMessage(
        this.password,
        'control/command',
        {
          devices: deviceUdids,
          type: keyType,
          body: {
            code: keyCode
          }
        }
      );
      
      this.send(message);
      debugLog('ws', `已发送按键命令: ${keyType} ${keyCode} 设备: ${deviceUdids.join(', ')}`);
    } catch (error) {
      console.error('发送按键命令失败:', error);
    }
  }

  // 按键按下（单设备）
  async keyDown(deviceUdid: string, keyCode: string): Promise<void> {
    return this.sendKeyCommand([deviceUdid], 'key/down', keyCode);
  }

  // 按键抬起（单设备）
  async keyUp(deviceUdid: string, keyCode: string): Promise<void> {
    return this.sendKeyCommand([deviceUdid], 'key/up', keyCode);
  }

  // 按键按下（多设备）
  async keyDownMultiple(deviceUdids: string[], keyCode: string): Promise<void> {
    return this.sendKeyCommand(deviceUdids, 'key/down', keyCode);
  }

  // 按键抬起（多设备）
  async keyUpMultiple(deviceUdids: string[], keyCode: string): Promise<void> {
    return this.sendKeyCommand(deviceUdids, 'key/up', keyCode);
  }

  // 模拟Home键（单设备）
  async pressHomeButton(deviceUdid: string): Promise<void> {
    await this.pressKey(deviceUdid, 'HOMEBUTTON');
  }

  // 模拟Home键（多设备）
  async pressHomeButtonMultiple(deviceUdids: string[]): Promise<void> {
    await this.pressKeyMultiple(deviceUdids, 'HOMEBUTTON');
  }

  async pressKey(deviceUdid: string, keyCode: string): Promise<void> {
    await this.pressKeyMultiple([deviceUdid], keyCode);
  }

  async pressKeyMultiple(deviceUdids: string[], keyCode: string): Promise<void> {
    if (deviceUdids.length === 0) {
      return;
    }

    await this.keyDownMultiple(deviceUdids, keyCode);
    window.setTimeout(() => {
      void this.keyUpMultiple(deviceUdids, keyCode);
    }, 50);
  }

  // 设置词典值
  async setProcValue(deviceUdids: string[], key: string, value: string): Promise<void> {
    if (!deviceUdids || deviceUdids.length === 0) {
      console.error('未选择设备，无法设置词典值');
      return;
    }

    if (!key || !value) {
      console.error('键名和值不能为空');
      return;
    }

    this.sendDeviceCommand(deviceUdids, 'proc-value/put', {
      body: { key, value },
      missingPasswordMessage: '未设置密码，无法设置词典值',
      missingDevicesMessage: '未选择设备，无法设置词典值',
      errorMessage: '设置词典值失败:',
    });
    debugLog('ws', `已发送设置词典值请求: ${key}=${value} 到设备:`, deviceUdids);
  }

  // 推送值到队列
  async pushToQueue(deviceUdids: string[], key: string, value: string): Promise<void> {
    if (!deviceUdids || deviceUdids.length === 0) {
      console.error('未选择设备，无法推送到队列');
      return;
    }

    if (!key || !value) {
      console.error('键名和值不能为空');
      return;
    }

    this.sendDeviceCommand(deviceUdids, 'proc-queue/push', {
      body: { key, value },
      missingPasswordMessage: '未设置密码，无法推送到队列',
      missingDevicesMessage: '未选择设备，无法推送到队列',
      errorMessage: '推送到队列失败:',
    });
    debugLog('ws', `已发送推送到队列请求: ${key}=${value} 到设备:`, deviceUdids);
  }

  // 选择脚本
  async selectScript(deviceUdids: string[], scriptName: string): Promise<void> {
    this.sendDeviceCommand(deviceUdids, 'script/selected/put', {
      body: { name: scriptName || '' },
      requireOpenConnection: true,
      missingDevicesMessage: '未选择设备，无法选择脚本',
      errorMessage: '选择脚本失败:',
    });
    debugLog('ws', `已发送选择脚本请求: ${scriptName} 到设备:`, deviceUdids);
  }
}
