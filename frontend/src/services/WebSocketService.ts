import { AuthService } from './AuthService';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export interface Device {
  udid: string;
  system?: any;
  [key: string]: any;
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
  
  private devices: Device[] = [];
  private password: string = '';
  private isAuthenticating = false;
  private isInitialLogin = true; // 区分首次登录和重连
  private hasReceivedDeviceList = false; // 是否已收到设备列表响应

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

  async requestDeviceList(): Promise<void> {
    if (!this.password) {
      console.error('未设置密码，无法请求设备列表');
      return;
    }

    try {
      const { AuthService } = await import('./AuthService');
      const authService = AuthService.getInstance();
      
      const message = authService.createControlMessage(
        this.password,
        'control/devices'
      );
      
      this.send(message);
    } catch (error) {
      console.error('请求设备列表失败:', error);
    }
  }

  async refreshDeviceStates(): Promise<void> {
    if (!this.password) {
      console.error('未设置密码，无法刷新设备状态');
      return;
    }

    try {
      const { AuthService } = await import('./AuthService');
      const authService = AuthService.getInstance();
      
      const message = authService.createControlMessage(
        this.password,
        'control/refresh'
      );
      
      this.send(message);

    } catch (error) {
      console.error('刷新设备状态失败:', error);
    }
  }

  async startScript(deviceUdids: string[], scriptName: string): Promise<void> {
    if (!this.password) {
      console.error('未设置密码，无法启动脚本');
      return;
    }

    if (!deviceUdids || deviceUdids.length === 0) {
      console.error('未选择设备，无法启动脚本');
      return;
    }

    // 允许空脚本名称，直接发送请求

    try {
      const { AuthService } = await import('./AuthService');
      const authService = AuthService.getInstance();
      
      const message = authService.createControlMessage(
        this.password,
        'control/command',
        {
          devices: deviceUdids,
          type: 'script/run',
          body: {
            name: scriptName || ''
          }
        }
      );
      
      this.send(message);

    } catch (error) {
      console.error('启动脚本失败:', error);
    }
  }

  async stopScript(deviceUdids: string[]): Promise<void> {
    if (!this.password) {
      console.error('未设置密码，无法停止脚本');
      return;
    }

    if (!deviceUdids || deviceUdids.length === 0) {
      console.error('未选择设备，无法停止脚本');
      return;
    }

    try {
      const { AuthService } = await import('./AuthService');
      const authService = AuthService.getInstance();
      
      const message = authService.createControlMessage(
        this.password,
        'control/command',
        {
          devices: deviceUdids,
          type: 'script/stop'
        }
      );
      
      this.send(message);

    } catch (error) {
      console.error('停止脚本失败:', error);
    }
  }

  async respringDevices(deviceUdids: string[]): Promise<void> {
    if (!this.password) {
      console.error('未设置密码，无法注销设备');
      return;
    }

    if (!deviceUdids || deviceUdids.length === 0) {
      console.error('未选择设备，无法注销设备');
      return;
    }

    try {
      const { AuthService } = await import('./AuthService');
      const authService = AuthService.getInstance();
      
      const message = authService.createControlMessage(
        this.password,
        'control/command',
        {
          devices: deviceUdids,
          type: 'system/respring'
        }
      );
      
      this.send(message);

    } catch (error) {
      console.error('注销设备失败:', error);
    }
  }

  async rebootDevices(deviceUdids: string[]): Promise<void> {
    if (!this.password) {
      console.error('未设置密码，无法重启设备');
      return;
    }

    if (!deviceUdids || deviceUdids.length === 0) {
      console.error('未选择设备，无法重启设备');
      return;
    }

    try {
      const { AuthService } = await import('./AuthService');
      const authService = AuthService.getInstance();
      
      const message = authService.createControlMessage(
        this.password,
        'control/command',
        {
          devices: deviceUdids,
          type: 'system/reboot'
        }
      );
      
      this.send(message);

    } catch (error) {
      console.error('重启设备失败:', error);
    }
  }

  async uploadFile(deviceUdids: string[], filePath: string, fileData: string): Promise<void> {
    if (!this.password) {
      console.error('未设置密码，无法上传文件');
      return;
    }

    if (!deviceUdids || deviceUdids.length === 0) {
      console.error('未选择设备，无法上传文件');
      return;
    }

    if (!filePath || !filePath.trim()) {
      console.error('未指定文件路径，无法上传文件');
      return;
    }

    if (!fileData) {
      console.error('文件数据为空，无法上传文件');
      return;
    }

    try {
      const { AuthService } = await import('./AuthService');
      const authService = AuthService.getInstance();
      
      const message = authService.createControlMessage(
        this.password,
        'control/command',
        {
          devices: deviceUdids,
          type: 'file/put',
          body: {
            path: filePath.trim(),
            data: fileData
          }
        }
      );
      
      this.send(message);

    } catch (error) {
      console.error('上传文件失败:', error);
    }
  }

  // 列出文件目录
  async listFiles(deviceUdid: string, path: string): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.password) {
      console.error('WebSocket未连接或未认证');
      return;
    }

    try {
      const message = AuthService.getInstance().createControlMessage(
        this.password,
        'control/command',
        {
          devices: [deviceUdid],
          type: 'file/list',
          body: {
            path: path.trim()
          }
        }
      );
      
      this.send(message);

    } catch (error) {
      console.error('获取文件列表失败:', error);
    }
  }

  // 删除文件
  async deleteFile(deviceUdid: string, path: string): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.password) {
      console.error('WebSocket未连接或未认证');
      return;
    }

    try {
      const message = AuthService.getInstance().createControlMessage(
        this.password,
        'control/command',
        {
          devices: [deviceUdid],
          type: 'file/delete',
          body: {
            path: path.trim()
          }
        }
      );
      
      this.send(message);

    } catch (error) {
      console.error('删除文件失败:', error);
    }
  }

  // 创建目录
  async createDirectory(deviceUdid: string, path: string): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.password) {
      console.error('WebSocket未连接或未认证');
      return;
    }

    try {
      const message = AuthService.getInstance().createControlMessage(
        this.password,
        'control/command',
        {
          devices: [deviceUdid],
          type: 'file/put',
          body: {
            path: path.trim(),
            directory: true
          }
        }
      );
      
      this.send(message);

    } catch (error) {
      console.error('创建目录失败:', error);
    }
  }

  // 下载文件
  async downloadFile(udid: string, path: string): Promise<void> {
    try {
      const message = AuthService.getInstance().createControlMessage(
        this.password,
        'control/command',
        {
          devices: [udid],
          type: 'file/get',
          body: {
            path: path.trim()
          }
        }
      );
      
      this.send(message);

    } catch (error) {
      console.error('下载文件失败:', error);
    }
  }

  // 移动/重命名文件
  async moveFile(deviceUdid: string, fromPath: string, toPath: string): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.password) {
      console.error('WebSocket未连接或未认证');
      return;
    }

    try {
      const message = AuthService.getInstance().createControlMessage(
        this.password,
        'control/command',
        {
          devices: [deviceUdid],
          type: 'file/move',
          body: {
            from: fromPath.trim(),
            to: toPath.trim()
          }
        }
      );
      
      this.send(message);

    } catch (error) {
      console.error('移动文件失败:', error);
    }
  }

  // 读取文本文件内容
  async readFile(deviceUdid: string, path: string): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.password) {
      console.error('WebSocket未连接或未认证');
      return;
    }

    try {
      const message = AuthService.getInstance().createControlMessage(
        this.password,
        'control/command',
        {
          devices: [deviceUdid],
          type: 'file/get',
          body: {
            path: path.trim()
          }
        }
      );
      
      this.send(message);

    } catch (error) {
      console.error('读取文件失败:', error);
    }
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
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.password) {
      console.error('WebSocket未连接或未认证');
      return;
    }

    try {
      const message = AuthService.getInstance().createControlMessage(
        this.password,
        'control/command',
        {
          devices: [deviceUdid],
          type: 'screen/snapshot',
          body: {
            format: 'png',
            scale: scale
          }
        }
      );
      
      this.send(message);

    } catch (error) {
      console.error('屏幕截图失败:', error);
    }
  }

  private handleMessage(message: any): void {

    
    // 处理设备断开连接消息
    if (message.type === 'device/disconnect' && message.body) {
      const udid = message.body;

      this.removeDevice(udid);
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
    
    // 处理设备状态消息 - 实时更新设备数据
    if (message.type === 'app/state' && message.body?.system?.udid) {

      this.updateDevice(message.body);
      return;
    }

    // 处理设备列表响应
    if (message.type === 'control/devices' && message.body && typeof message.body === 'object') {
      console.log('收到设备列表响应');
      
      // 标记已收到设备列表响应
      this.hasReceivedDeviceList = true;
      
      // 如果正在认证中，认为认证成功
      if (this.isAuthenticating) {
        console.log('认证成功，收到设备列表响应');
        this.isAuthenticating = false;
        this.isInitialLogin = false; // 标记为非首次登录
        this.notifyAuthResult(true);
      }
      
      // 后端返回的格式是 {udid: deviceData, udid2: deviceData2, ...}
      // 需要转换为数组格式
      const deviceArray: Device[] = [];
      
      for (const [udid, deviceData] of Object.entries(message.body)) {
        if (deviceData && typeof deviceData === 'object') {
          deviceArray.push({
            udid: udid,
            ...deviceData as any
          });
        }
      }
      
      this.devices = deviceArray;
      this.notifyDeviceUpdate(this.devices);
      return;
    }

    // 处理文件操作响应
    if (message.type === 'file/list' || message.type === 'file/put' || message.type === 'file/delete') {
      console.log('文件操作响应:', message);
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
    console.log('已清除存储的密码hash');
    
    // 重置认证状态
    this.isInitialLogin = true;
    this.hasReceivedDeviceList = false;
    
    // 可以在这里添加额外的逻辑，比如通知上层组件返回登录界面
  }

  private updateDevice(deviceData: any): void {
    const udid = deviceData.system?.udid;
    if (!udid) return;

    const existingIndex = this.devices.findIndex(d => d.udid === udid);
    if (existingIndex >= 0) {
      // 更新现有设备的数据，保持原有的 udid 字段
      this.devices[existingIndex] = { 
        udid: this.devices[existingIndex].udid,
        ...deviceData 
      };
      
      // 同步脚本状态到 system 中，以便界面正确显示
      if (deviceData.script) {
        if (!this.devices[existingIndex].system) {
          this.devices[existingIndex].system = {};
        }
        this.devices[existingIndex].system.running = deviceData.script.running || false;
        this.devices[existingIndex].system.paused = deviceData.script.paused || false;
      }
      
      console.log(`设备 ${udid} 状态已更新`);
    } else {
      // 新设备，添加到列表
      const newDevice = { udid, ...deviceData };
      
      // 同步脚本状态到 system 中
      if (deviceData.script) {
        if (!newDevice.system) {
          newDevice.system = {};
        }
        newDevice.system.running = deviceData.script.running || false;
        newDevice.system.paused = deviceData.script.paused || false;
      }
      
      this.devices.push(newDevice);
      console.log(`新设备 ${udid} 已添加`);
    }
    
    // 通知界面更新
    this.notifyDeviceUpdate([...this.devices]);
  }

  private removeDevice(udid: string): void {
    if (!udid) return;

    const existingIndex = this.devices.findIndex(d => d.udid === udid);
    if (existingIndex >= 0) {
      // 从设备列表中移除设备
      this.devices.splice(existingIndex, 1);
      console.log(`设备 ${udid} 已从列表中移除`);
      
      // 通知界面更新
      this.notifyDeviceUpdate([...this.devices]);
    } else {
      console.log(`设备 ${udid} 不在列表中，无需移除`);
    }
  }

  private updateDeviceScriptStatus(udid: string, isRunning: boolean): void {
    if (!udid) return;

    const existingIndex = this.devices.findIndex(d => d.udid === udid);
    if (existingIndex >= 0) {
      const device = this.devices[existingIndex];
      
      // 更新脚本状态
      if (!device.script) {
        device.script = {};
      }
      
      // 更新运行状态
      if (!device.system) {
        device.system = {};
      }
      device.system.running = isRunning;
      device.system.paused = false; // 脚本开始运行时不是暂停状态
      
      console.log(`设备 ${udid} 脚本状态已更新: ${isRunning ? '运行中' : '已停止'}`);
      
      // 通知界面更新
      this.notifyDeviceUpdate([...this.devices]);
    } else {
      console.log(`设备 ${udid} 不在列表中，无法更新脚本状态`);
    }
  }

  onStatusChange(callback: (status: ConnectionStatus) => void): void {
    this.statusCallbacks.push(callback);
  }

  onMessage(callback: (message: any) => void): () => void {
    this.messageCallbacks.push(callback);
    return () => {
      this.messageCallbacks = this.messageCallbacks.filter(cb => cb !== callback);
    };
  }

  onDeviceUpdate(callback: (devices: Device[]) => void): void {
    this.deviceCallbacks.push(callback);
  }

  onAuthResult(callback: (success: boolean, error?: string) => void): void {
    this.authCallbacks.push(callback);
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect) return;
    this.reconnectAttempts++;
    console.log(`尝试重连 (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);

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

  private notifyDeviceUpdate(devices: Device[]): void {
    this.deviceCallbacks.forEach(callback => callback(devices));
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
  async sendTouchCommand(deviceUdids: string[], touchType: 'touch/down' | 'touch/move' | 'touch/up', x: number, y: number): Promise<void> {
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
          type: touchType,
          body: {
            x: x,
            y: y
          }
        }
      );
      
      this.send(message);
      // console.log(`已发送触控命令: ${touchType} (${x}, ${y}) 设备: ${deviceUdids.join(', ')}`);
    } catch (error) {
      console.error('发送触控命令失败:', error);
    }
  }

  // 触控按下（单设备）
  async touchDown(deviceUdid: string, x: number, y: number): Promise<void> {
    return this.sendTouchCommand([deviceUdid], 'touch/down', x, y);
  }

  // 触控移动（单设备）
  async touchMove(deviceUdid: string, x: number, y: number): Promise<void> {
    return this.sendTouchCommand([deviceUdid], 'touch/move', x, y);
  }

  // 触控抬起（单设备）
  async touchUp(deviceUdid: string, x: number, y: number): Promise<void> {
    return this.sendTouchCommand([deviceUdid], 'touch/up', x, y);
  }

  // 触控按下（多设备）
  async touchDownMultiple(deviceUdids: string[], x: number, y: number): Promise<void> {
    return this.sendTouchCommand(deviceUdids, 'touch/down', x, y);
  }

  // 触控移动（多设备）
  async touchMoveMultiple(deviceUdids: string[], x: number, y: number): Promise<void> {
    return this.sendTouchCommand(deviceUdids, 'touch/move', x, y);
  }

  // 触控抬起（多设备）
  async touchUpMultiple(deviceUdids: string[], x: number, y: number): Promise<void> {
    return this.sendTouchCommand(deviceUdids, 'touch/up', x, y);
  }

  // 触控按下（多设备 - 使用归一化坐标）
  async touchDownMultipleNormalized(deviceUdids: string[], nx: number, ny: number): Promise<void> {
    for (const udid of deviceUdids) {
      const device = this.devices.find(d => d.udid === udid);
      if (device?.system?.scrw && device?.system?.scrh) {
        const x = Math.floor(nx * device.system.scrw);
        const y = Math.floor(ny * device.system.scrh);
        this.touchDown(udid, x, y);
      }
    }
  }

  // 触控移动（多设备 - 使用归一化坐标）
  async touchMoveMultipleNormalized(deviceUdids: string[], nx: number, ny: number): Promise<void> {
    for (const udid of deviceUdids) {
      const device = this.devices.find(d => d.udid === udid);
      if (device?.system?.scrw && device?.system?.scrh) {
        const x = Math.floor(nx * device.system.scrw);
        const y = Math.floor(ny * device.system.scrh);
        this.touchMove(udid, x, y);
      }
    }
  }

  // 触控抬起（多设备 - 使用归一化坐标）
  async touchUpMultipleNormalized(deviceUdids: string[]): Promise<void> {
    for (const udid of deviceUdids) {
      this.touchUp(udid, 0, 0); // touch/up 不需要坐标，传 0 即可
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
      console.log(`已发送按键命令: ${keyType} ${keyCode} 设备: ${deviceUdids.join(', ')}`);
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
    await this.keyDown(deviceUdid, 'HOMEBUTTON');
    // 稍微延迟后抬起，模拟真实按键操作
    setTimeout(() => {
      this.keyUp(deviceUdid, 'HOMEBUTTON');
    }, 50);
  }

  // 模拟Home键（多设备）
  async pressHomeButtonMultiple(deviceUdids: string[]): Promise<void> {
    await this.keyDownMultiple(deviceUdids, 'HOMEBUTTON');
    // 稍微延迟后抬起，模拟真实按键操作
    setTimeout(() => {
      this.keyUpMultiple(deviceUdids, 'HOMEBUTTON');
    }, 50);
  }

  // 设置词典值
  async setProcValue(deviceUdids: string[], key: string, value: string): Promise<void> {
    if (!this.password) {
      console.error('未设置密码，无法设置词典值');
      return;
    }

    if (!deviceUdids || deviceUdids.length === 0) {
      console.error('未选择设备，无法设置词典值');
      return;
    }

    if (!key || !value) {
      console.error('键名和值不能为空');
      return;
    }

    try {
      const { AuthService } = await import('./AuthService');
      const authService = AuthService.getInstance();
      
      const message = authService.createControlMessage(
        this.password,
        'control/command',
        {
          devices: deviceUdids,
          type: 'proc-value/put',
          body: {
            key: key,
            value: value
          }
        }
      );
      
      this.send(message);
      console.log(`已发送设置词典值请求: ${key}=${value} 到设备:`, deviceUdids);
    } catch (error) {
      console.error('设置词典值失败:', error);
    }
  }

  // 推送值到队列
  async pushToQueue(deviceUdids: string[], key: string, value: string): Promise<void> {
    if (!this.password) {
      console.error('未设置密码，无法推送到队列');
      return;
    }

    if (!deviceUdids || deviceUdids.length === 0) {
      console.error('未选择设备，无法推送到队列');
      return;
    }

    if (!key || !value) {
      console.error('键名和值不能为空');
      return;
    }

    try {
      const { AuthService } = await import('./AuthService');
      const authService = AuthService.getInstance();
      
      const message = authService.createControlMessage(
        this.password,
        'control/command',
        {
          devices: deviceUdids,
          type: 'proc-queue/push',
          body: {
            key: key,
            value: value
          }
        }
      );
      
      this.send(message);
      console.log(`已发送推送到队列请求: ${key}=${value} 到设备:`, deviceUdids);
    } catch (error) {
      console.error('推送到队列失败:', error);
    }
  }

  // 选择脚本
  async selectScript(deviceUdids: string[], scriptName: string): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.password) {
      console.error('WebSocket未连接或未认证');
      return;
    }

    if (!deviceUdids || deviceUdids.length === 0) {
      console.error('未选择设备，无法选择脚本');
      return;
    }

    try {
      const message = AuthService.getInstance().createControlMessage(
        this.password,
        'control/command',
        {
          devices: deviceUdids,
          type: 'script/selected/put',
          body: {
            name: scriptName || ''
          }
        }
      );
      
      this.send(message);
      console.log(`已发送选择脚本请求: ${scriptName} 到设备:`, deviceUdids);
    } catch (error) {
      console.error('选择脚本失败:', error);
    }
  }
}
