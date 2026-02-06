import { authFetch } from './httpAuth';

const LARGE_FILE_THRESHOLD = 128 * 1024; // 128KB

export interface TransferProgress {
  token: string;
  deviceSN: string;
  type: 'download' | 'upload';
  targetPath: string;
  totalBytes: number;
  currentBytes: number;
  percent: number;
}

export interface PushFileResult {
  success: boolean;
  token?: string;
  totalBytes?: number;
  md5?: string;
  error?: string;
}

export interface PullFileResult {
  success: boolean;
  token?: string;
  error?: string;
}

/**
 * FileTransferService handles large file transfers using HTTP with temporary tokens.
 * For files > 128KB, this is more efficient than WebSocket + Base64.
 */
export class FileTransferService {
  private static instance: FileTransferService;
  public baseUrl: string = '';
  
  private constructor() {}
  
  static getInstance(): FileTransferService {
    if (!FileTransferService.instance) {
      FileTransferService.instance = new FileTransferService();
    }
    return FileTransferService.instance;
  }
  
  setBaseUrl(url: string) {
    this.baseUrl = url;
  }
  
  /**
   * Check if a file should use large file transfer (HTTP) instead of WebSocket
   */
  static shouldUseLargeFileTransfer(file: File): boolean {
    return file.size > LARGE_FILE_THRESHOLD;
  }
  
  static shouldUseLargeFileTransferForBytes(size: number): boolean {
    return size > LARGE_FILE_THRESHOLD;
  }
  
  /**
   * Push a file from server to device
   */
  async pushToDevice(
    deviceSN: string, 
    category: string, 
    path: string, 
    targetPath: string,
    timeout?: number
  ): Promise<PushFileResult> {
    try {
      const response = await authFetch(`${this.baseUrl}/api/transfer/push-to-device`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceSN,
          category,
          path,
          targetPath,
          serverBaseUrl: this.baseUrl,
          timeout: timeout || 300,
        }),
      });
      
      const result = await response.json();
      
      if (response.ok && result.success) {
        return {
          success: true,
          token: result.token,
          totalBytes: result.totalBytes,
          md5: result.md5,
        };
      } else {
        return {
          success: false,
          error: result.error || 'Push failed',
        };
      }
    } catch (e) {
      return {
        success: false,
        error: (e as Error).message,
      };
    }
  }
  
  /**
   * Pull a file from device to server
   */
  async pullFromDevice(
    deviceSN: string,
    sourcePath: string,
    category: string,
    savePath: string,
    timeout?: number
  ): Promise<PullFileResult> {
    try {
      const response = await authFetch(`${this.baseUrl}/api/transfer/pull-from-device`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceSN,
          sourcePath,
          category,
          path: savePath,
          serverBaseUrl: this.baseUrl,
          timeout: timeout || 300,
        }),
      });
      
      const result = await response.json();
      
      if (response.ok && result.success) {
        return {
          success: true,
          token: result.token,
        };
      } else {
        return {
          success: false,
          error: result.error || 'Pull failed',
        };
      }
    } catch (e) {
      return {
        success: false,
        error: (e as Error).message,
      };
    }
  }
  
  /**
   * Upload a file from browser to server, then push to device
   * For files > 128KB, uploads to server first then triggers device download
   */
  async uploadFileToDevice(
    deviceSN: string,
    file: File,
    deviceTargetPath: string
  ): Promise<PushFileResult> {
    try {
      // Upload to server's "files" category in _temp folder
      const formData = new FormData();
      formData.append('file', file);
      formData.append('category', 'files');
      formData.append('path', '_temp');
      
      const uploadResponse = await authFetch(`${this.baseUrl}/api/server-files/upload`, {
        method: 'POST',
        body: formData,
      });
      
      if (!uploadResponse.ok) {
        const err = await uploadResponse.json();
        return { success: false, error: err.error || 'Server upload failed' };
      }
      
      const uploadResult = await uploadResponse.json();
      const serverPath = uploadResult.path || `_temp/${file.name}`;
      
      // Now push from server to device
      const pushResult = await this.pushToDevice(
        deviceSN,
        'files',
        serverPath,
        deviceTargetPath
      );
      
      return pushResult;
      
    } catch (e) {
      return {
        success: false,
        error: (e as Error).message,
      };
    }
  }
  
  /**
   * Download a file from device to browser
   * For files > 128KB, pulls to server first then downloads from server
   */
  async downloadFileFromDevice(
    deviceSN: string,
    deviceSourcePath: string,
    fileName: string
  ): Promise<{ success: boolean; error?: string; token?: string; savePath?: string }> {
    try {
      // Pull file from device to server's "files" category
      // 使用兼容非安全上下文的 UUID 生成方式
      const uuidBytes = new Uint8Array(4);
      crypto.getRandomValues(uuidBytes);
      const uuid = Array.from(uuidBytes).map(b => b.toString(16).padStart(2, '0')).join('');
      const savePath = `_temp/${fileName}_${uuid}`;
      
      const pullResult = await this.pullFromDevice(
        deviceSN,
        deviceSourcePath,
        'files',
        savePath
      );
      
      if (!pullResult.success) {
        return { success: false, error: pullResult.error };
      }
      
      // Return the token and save path
      // The caller should listen for file/upload/complete WebSocket message
      // then download from server via GET /api/server-files/download/files/{savePath}
      return { 
        success: true, 
        token: pullResult.token,
        savePath,
      };
      
    } catch (e) {
      return {
        success: false,
        error: (e as Error).message,
      };
    }
  }
  
  /**
   * Download a file from server with authentication
   * Returns the Response object for streaming or blob conversion
   */
  async downloadFromServer(path: string): Promise<Response> {
    return authFetch(`${this.baseUrl}${path}`, {
      method: 'GET',
    });
  }
  
  /**
   * Delete a temporary file from server after successful download
   */
  async deleteTempFile(category: string, path: string): Promise<void> {
    try {
      const params = new URLSearchParams({
        category,
        path,
      });
      await authFetch(`${this.baseUrl}/api/server-files/delete?${params.toString()}`, {
        method: 'DELETE',
      });
    } catch (e) {
      console.warn('Failed to delete temp file:', e);
    }
  }
}

export default FileTransferService;
