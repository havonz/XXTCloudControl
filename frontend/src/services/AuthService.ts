export interface LoginCredentials {
  server: string;
  port: string;
  password: string;
}

export interface Device {
  udid: string;
  system?: any;
  script?: {
    running?: boolean;
    paused?: boolean;
    select?: string;
    [key: string]: any;
  };
  [key: string]: any;
}

export class AuthService {
  private static instance: AuthService;
  private isAuthenticated: boolean = false;
  private currentCredentials: LoginCredentials | null = null;

  static getInstance(): AuthService {
    if (!AuthService.instance) {
      AuthService.instance = new AuthService();
    }
    return AuthService.instance;
  }

  private constructor() {}

  /**
   * 纯JavaScript SHA-256实现（完全不依赖crypto API）
   */
  private sha256(message: Uint8Array): Uint8Array {
    // SHA-256常量
    const K = new Uint32Array([
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ]);
    
    // 初始哈希值
    let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
    let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
    
    // 预处理消息
    const msgLen = message.length;
    const bitLen = msgLen * 8;
    
    // 添加填充
    const paddedLen = Math.ceil((msgLen + 9) / 64) * 64;
    const padded = new Uint8Array(paddedLen);
    padded.set(message);
    padded[msgLen] = 0x80;
    
    // 添加长度（大端序64位）
    const view = new DataView(padded.buffer);
    view.setUint32(paddedLen - 4, bitLen & 0xffffffff, false);
    view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000), false);
    
    // 处理每个512位块
    for (let i = 0; i < paddedLen; i += 64) {
      const w = new Uint32Array(64);
      
      // 拷贝数据
      for (let j = 0; j < 16; j++) {
        w[j] = view.getUint32(i + j * 4, false);
      }
      
      // 扩展
      for (let j = 16; j < 64; j++) {
        const s0 = this.rotr(w[j - 15], 7) ^ this.rotr(w[j - 15], 18) ^ (w[j - 15] >>> 3);
        const s1 = this.rotr(w[j - 2], 17) ^ this.rotr(w[j - 2], 19) ^ (w[j - 2] >>> 10);
        w[j] = (w[j - 16] + s0 + w[j - 7] + s1) >>> 0;
      }
      
      // 初始化工作变量
      let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
      
      // 主循环
      for (let j = 0; j < 64; j++) {
        const S1 = this.rotr(e, 6) ^ this.rotr(e, 11) ^ this.rotr(e, 25);
        const ch = (e & f) ^ (~e & g);
        const temp1 = (h + S1 + ch + K[j] + w[j]) >>> 0;
        const S0 = this.rotr(a, 2) ^ this.rotr(a, 13) ^ this.rotr(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const temp2 = (S0 + maj) >>> 0;
        
        h = g; g = f; f = e; e = (d + temp1) >>> 0;
        d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
      }
      
      // 更新哈希值
      h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
      h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
    }
    
    // 输出结果
    const result = new Uint8Array(32);
    const resultView = new DataView(result.buffer);
    resultView.setUint32(0, h0, false); resultView.setUint32(4, h1, false);
    resultView.setUint32(8, h2, false); resultView.setUint32(12, h3, false);
    resultView.setUint32(16, h4, false); resultView.setUint32(20, h5, false);
    resultView.setUint32(24, h6, false); resultView.setUint32(28, h7, false);
    
    return result;
  }
  
  /**
   * 右旋转函数
   */
  private rotr(n: number, b: number): number {
    return (n >>> b) | (n << (32 - b));
  }
  
  /**
   * HMAC-SHA256 实现
   */
  public hmacSHA256(key: string, message: string): string {
    // 将字符串转换为字节数组
    const keyBytes = new TextEncoder().encode(key);
    const messageBytes = new TextEncoder().encode(message);
    
    // HMAC算法常量
    const blockSize = 64; // SHA-256的块大小
    const opad = 0x5c;
    const ipad = 0x36;
    
    // 如果key长度大于块大小，先哈希key
    let keyArray: Uint8Array;
    if (keyBytes.length > blockSize) {
      keyArray = this.sha256(keyBytes);
    } else {
      keyArray = new Uint8Array(keyBytes);
    }
    
    // 将key填充到块大小
    const paddedKey = new Uint8Array(blockSize);
    paddedKey.set(keyArray);
    
    // 创建内部和外部填充
    const innerPadding = new Uint8Array(blockSize);
    const outerPadding = new Uint8Array(blockSize);
    
    for (let i = 0; i < blockSize; i++) {
      innerPadding[i] = paddedKey[i] ^ ipad;
      outerPadding[i] = paddedKey[i] ^ opad;
    }
    
    // 内部哈希: SHA-256(key ⊕ ipad || message)
    const innerData = new Uint8Array(blockSize + messageBytes.length);
    innerData.set(innerPadding);
    innerData.set(messageBytes, blockSize);
    const innerHash = this.sha256(innerData);
    
    // 外部哈希: SHA-256(key ⊕ opad || innerHash)
    const outerData = new Uint8Array(blockSize + 32); // SHA-256输出32字节
    outerData.set(outerPadding);
    outerData.set(innerHash, blockSize);
    const finalHash = this.sha256(outerData);
    
    // 转换为十六进制字符串
    const hashArray = Array.from(finalHash);
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    
    return hashHex;
  }

  /**
   * 生成控制命令的签名
   */
  generateSignature(password: string, timestamp: number): string {
    let passhash: string;
    
    // 检查是否是预计算的密码hash
    if (password.startsWith('__STORED_PASSHASH__')) {
      // 直接使用存储的passhash，不再重新计算
      passhash = password.substring('__STORED_PASSHASH__'.length);

    } else {
      // passhash = hmacSHA256("XXTouch", password)
      passhash = this.hmacSHA256("XXTouch", password);

    }
    
    // sign = hmacSHA256(passhash, 秒级时间戳转换成字符串)
    const sign = this.hmacSHA256(passhash, timestamp.toString());
    

    return sign;
  }

  /**
   * 创建控制命令消息
   * 对于 control/command 类型的消息，会自动生成 requestId 用于请求-响应匹配
   */
  createControlMessage(password: string, type: string, body?: any): any {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = this.generateSignature(password, timestamp);
    
    // 对于 control/command 消息，自动生成 requestId
    let finalBody = body;
    if (type === 'control/command' && body && typeof body === 'object') {
      finalBody = {
        ...body,
        requestId: body.requestId || crypto.randomUUID()
      };
    }
    
    return {
      ts: timestamp,
      sign: signature,
      type: type,
      body: finalBody
    };
  }

  /**
   * 获取 WebSocket URL
   */
  getWebSocketUrl(server: string, port: string): string {
    const schemeHint = this.getSchemeHint(server);
    const wsScheme = schemeHint
      ? (schemeHint === 'https' ? 'wss' : 'ws')
      : (this.getDefaultHttpScheme() === 'https' ? 'wss' : 'ws');
    const host = this.stripProtocolAndPath(server);
    return `${wsScheme}://${host}:${port}/api/ws`;
  }

  /**
   * 获取 HTTP Base URL
   */
  getHttpBaseUrl(server: string, port: string): string {
    const scheme = this.getSchemeHint(server) || this.getDefaultHttpScheme();
    const host = this.stripProtocolAndPath(server);
    return `${scheme}://${host}:${port}`;
  }

  /**
   * 清理服务器地址（去掉协议与路径）
   */
  getServerHost(server: string): string {
    return this.stripProtocolAndPath(server);
  }

  /**
   * 验证登录凭据格式
   */
  validateCredentials(credentials: LoginCredentials): { valid: boolean; error?: string } {
    if (!credentials.server.trim()) {
      return { valid: false, error: '请输入服务器地址' };
    }
    
    if (!credentials.port.trim()) {
      return { valid: false, error: '请输入端口号' };
    }
    
    const portNum = parseInt(credentials.port);
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
      return { valid: false, error: '端口号必须是 1-65535 之间的数字' };
    }
    
    if (!credentials.password.trim()) {
      return { valid: false, error: '请输入密码' };
    }
    
    return { valid: true };
  }

  /**
   * 设置认证状态
   */
  setAuthenticated(authenticated: boolean, credentials?: LoginCredentials) {
    this.isAuthenticated = authenticated;
    if (authenticated && credentials) {
      this.currentCredentials = credentials;
    } else {
      this.currentCredentials = null;
    }
  }

  /**
   * 获取认证状态
   */
  getIsAuthenticated(): boolean {
    return this.isAuthenticated;
  }

  /**
   * 获取当前凭据
   */
  getCurrentCredentials(): LoginCredentials | null {
    return this.currentCredentials;
  }

  /**
   * 登出
   */
  respring() {
    this.setAuthenticated(false);
  }

  private getDefaultHttpScheme(): 'http' | 'https' {
    return window.location.protocol === 'https:' ? 'https' : 'http';
  }

  private getSchemeHint(server: string): 'http' | 'https' | null {
    const trimmed = server.trim();
    if (/^https:\/\//i.test(trimmed)) return 'https';
    if (/^http:\/\//i.test(trimmed)) return 'http';
    if (/^wss:\/\//i.test(trimmed)) return 'https';
    if (/^ws:\/\//i.test(trimmed)) return 'http';
    return null;
  }

  private stripProtocolAndPath(server: string): string {
    const trimmed = server.trim();
    if (!trimmed) return trimmed;
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) {
      try {
        const url = new URL(trimmed);
        if (!url.hostname) return trimmed;
        return url.hostname.includes(':') ? `[${url.hostname}]` : url.hostname;
      } catch {
        // fall through
      }
    }
    const withoutProtocol = trimmed.replace(/^(https?:\/\/|wss?:\/\/)/i, '');
    const withoutPath = withoutProtocol.replace(/[/?#].*$/, '');
    // IPv6 in brackets: [::1]:46980
    if (withoutPath.startsWith('[')) {
      const endIndex = withoutPath.indexOf(']');
      if (endIndex !== -1) {
        return withoutPath.slice(0, endIndex + 1);
      }
      return withoutPath;
    }
    const hostPortMatch = withoutPath.match(/^(.+):(\d{1,5})$/);
    if (hostPortMatch && hostPortMatch[1].indexOf(':') === -1) {
      return hostPortMatch[1];
    }
    return withoutPath;
  }
}
