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

interface ServerUploadResult {
  success: boolean;
  path?: string;
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

  private splitServerPath(path: string): { dir: string; name: string } {
    const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
    const idx = normalized.lastIndexOf('/');
    if (idx < 0) {
      return { dir: '', name: normalized };
    }
    return {
      dir: normalized.slice(0, idx),
      name: normalized.slice(idx + 1),
    };
  }

  private joinServerPath(dir: string, name: string): string {
    const cleanDir = dir.replace(/\/+$/, '');
    return cleanDir ? `${cleanDir}/${name}` : name;
  }

  private createFanoutBatchId(): string {
    const randomBytes = new Uint8Array(4);
    crypto.getRandomValues(randomBytes);
    const suffix = Array.from(randomBytes).map((b) => b.toString(16).padStart(2, '0')).join('');
    return `${Date.now()}_${suffix}`;
  }

  async uploadFileToServer(
    file: File,
    category: string = 'files',
    path: string = '_temp'
  ): Promise<ServerUploadResult> {
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('category', category);
      formData.append('path', path);

      const uploadResponse = await authFetch(`${this.baseUrl}/api/server-files/upload`, {
        method: 'POST',
        body: formData,
      });

      const result = await uploadResponse.json().catch(() => ({}));
      if (!uploadResponse.ok) {
        return { success: false, error: result.error || 'Server upload failed' };
      }

      return {
        success: true,
        path: result.path || this.joinServerPath(path, file.name),
      };
    } catch (e) {
      return {
        success: false,
        error: (e as Error).message,
      };
    }
  }

  private async copyServerFile(
    category: string,
    sourcePath: string,
    destinationDir: string
  ): Promise<ServerUploadResult> {
    const { dir: srcDir, name: srcName } = this.splitServerPath(sourcePath);
    if (!srcName) {
      return { success: false, error: 'Invalid source file path' };
    }

    try {
      const response = await authFetch(`${this.baseUrl}/api/server-files/batch-copy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          srcCategory: category,
          dstCategory: category,
          srcPath: srcDir,
          dstPath: destinationDir,
          items: [srcName],
        }),
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.success) {
        const firstError = Array.isArray(result.errors) ? result.errors[0] : undefined;
        return { success: false, error: result.error || firstError || 'Server copy failed' };
      }

      return {
        success: true,
        path: this.joinServerPath(destinationDir, srcName),
      };
    } catch (e) {
      return {
        success: false,
        error: (e as Error).message,
      };
    }
  }

  /**
   * Upload a file from browser to server once, then push to multiple devices.
   * To keep per-device transfer behavior unchanged, this creates one server-side temp copy per device.
   */
  async uploadFileToDevices(
    deviceSNs: string[],
    file: File,
    deviceTargetPath: string
  ): Promise<PushFileResult[]> {
    if (deviceSNs.length === 0) {
      return [];
    }

    const uploadResult = await this.uploadFileToServer(file, 'files', '_temp');
    if (!uploadResult.success || !uploadResult.path) {
      const error = uploadResult.error || 'Server upload failed';
      return deviceSNs.map(() => ({ success: false, error }));
    }

    const sourcePath = uploadResult.path;
    const preparedPathByDevice = new Map<string, string>();
    const prepareErrorByDevice = new Map<string, string>();

    if (deviceSNs.length === 1) {
      preparedPathByDevice.set(deviceSNs[0], sourcePath);
    } else {
      const batchId = this.createFanoutBatchId();
      const copyResults = await Promise.all(
        deviceSNs.map(async (deviceSN, idx) => {
          const destinationDir = `_temp/_fanout/${batchId}/${idx}`;
          const copied = await this.copyServerFile('files', sourcePath, destinationDir);
          return { deviceSN, copied };
        })
      );

      for (const { deviceSN, copied } of copyResults) {
        if (copied.success && copied.path) {
          preparedPathByDevice.set(deviceSN, copied.path);
        } else {
          prepareErrorByDevice.set(deviceSN, copied.error || 'Server copy failed');
        }
      }

      // Remove the template file after per-device copies are created.
      await this.deleteTempFile('files', sourcePath);
    }

    const pushResults = await Promise.all(
      deviceSNs.map(async (deviceSN) => {
        const preparedPath = preparedPathByDevice.get(deviceSN);
        if (!preparedPath) {
          return {
            success: false,
            error: prepareErrorByDevice.get(deviceSN) || 'Failed to prepare server file',
          };
        }
        return this.pushToDevice(deviceSN, 'files', preparedPath, deviceTargetPath);
      })
    );

    if (deviceSNs.length > 1) {
      await Promise.all(
        deviceSNs.map(async (deviceSN, idx) => {
          if (pushResults[idx]?.success) {
            return;
          }
          const preparedPath = preparedPathByDevice.get(deviceSN);
          if (preparedPath) {
            await this.deleteTempFile('files', preparedPath);
          }
        })
      );
    }

    return pushResults;
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
    const [result] = await this.uploadFileToDevices([deviceSN], file, deviceTargetPath);
    return result || { success: false, error: 'Upload failed' };
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
