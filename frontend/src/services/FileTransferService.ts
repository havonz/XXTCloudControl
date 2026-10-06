import { authFetch } from './httpAuth';
import { getCurrentLocale, translate } from '../i18n';
import { localizeApiError } from '../utils/apiError';
import { runWithConcurrency } from '../utils/runWithConcurrency';
import type { WebSocketService } from './WebSocketService';

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
  downloadToken?: string;
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
  private browserDownloads = new Set<AbortController>();
  public baseUrl: string = '';
  
  private constructor() {}
  
  static getInstance(): FileTransferService {
    if (!FileTransferService.instance) {
      FileTransferService.instance = new FileTransferService();
    }
    return FileTransferService.instance;
  }
  
  setBaseUrl(url: string) {
    if (url !== this.baseUrl) {
      for (const download of this.browserDownloads) {
        download.abort(new Error(translate(getCurrentLocale(), 'websocket.disconnected')));
      }
    }
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

  private joinServerPath(dir: string, name: string): string {
    const cleanDir = dir.replace(/\/+$/, '');
    return cleanDir ? `${cleanDir}/${name}` : name;
  }

  private createTransferId(): string {
    const randomBytes = new Uint8Array(16);
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
        return {
          success: false,
          error: localizeApiError(
            result,
            (key, vars) => translate(getCurrentLocale(), key, vars),
            translate(getCurrentLocale(), 'transfer.server_upload_failed'),
          ).message,
        };
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

  /**
   * Upload a file from browser to server once, then push to multiple devices.
   * Multi-device fanout shares one source file and lets backend ref-count cleanup.
   */
  async uploadFileToDevices(
    deviceSNs: string[],
    file: File,
    deviceTargetPath: string
  ): Promise<PushFileResult[]> {
    if (deviceSNs.length === 0) {
      return [];
    }

    const batchId = this.createTransferId();
    // 不同目录可能含有同名文件，每次上传独占源目录，直到所有设备完成下载。
    const tempDir = `_temp/upload-${batchId}`;
    const uploadResult = await this.uploadFileToServer(file, 'files', tempDir);
    if (!uploadResult.success || !uploadResult.path) {
      await this.deleteTempFile('files', tempDir);
      const error = uploadResult.error || translate(getCurrentLocale(), 'transfer.server_upload_failed');
      return deviceSNs.map(() => ({ success: false, error }));
    }

    const sourcePath = uploadResult.path;
    const sharedSourceId = deviceSNs.length > 1 ? batchId : undefined;

    const pushResults = await runWithConcurrency(deviceSNs, 6, (deviceSN) => (
      this.pushToDevice(
        deviceSN, 'files', sourcePath, deviceTargetPath, undefined,
        sharedSourceId, sharedSourceId ? deviceSNs.length : undefined,
      )
    ));

    // 小文件已通过 WebSocket 发完；只有持有下载令牌的设备还需要源文件。
    if (!pushResults.some((result) => result.success && result.token)) {
      await this.deleteTempFile('files', tempDir);
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
    timeout?: number,
    sharedSourceId?: string,
    sharedSourceTotal?: number,
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
          sharedSourceId,
          sharedSourceTotal,
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
          error: localizeApiError(
            result,
            (key, vars) => translate(getCurrentLocale(), key, vars),
            translate(getCurrentLocale(), 'transfer.push_failed'),
          ).message,
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
    timeout?: number,
    options: { temporary?: boolean; baseUrl?: string; signal?: AbortSignal } = {},
  ): Promise<PullFileResult> {
    const baseUrl = options.baseUrl ?? this.baseUrl;
    try {
      const response = await authFetch(`${baseUrl}/api/transfer/pull-from-device`, {
        method: 'POST',
        signal: options.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceSN,
          sourcePath,
          category,
          path: savePath,
          serverBaseUrl: baseUrl,
          timeout: timeout || 300,
          temporary: options.temporary,
        }),
      });
      
      const result = await response.json();
      
      if (response.ok && result.success) {
        return {
          success: true,
          token: result.token,
          downloadToken: result.downloadToken,
        };
      } else {
        return {
          success: false,
          error: localizeApiError(
            result,
            (key, vars) => translate(getCurrentLocale(), key, vars),
            translate(getCurrentLocale(), 'transfer.pull_failed'),
          ).message,
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
    return result || { success: false, error: translate(getCurrentLocale(), 'transfer.upload_failed') };
  }
  
  /**
   * Download a file from device to browser
   * For files > 128KB, pulls to server first then downloads from server
   */
  async downloadFileFromDevice(
    deviceSN: string,
    deviceSourcePath: string,
    connection: Pick<WebSocketService, 'onMessage' | 'onStatusChange' | 'getConnectionStatus'>,
  ): Promise<{ success: boolean; error?: string; blob?: Blob }> {
    if (connection.getConnectionStatus() !== 'connected') {
      return { success: false, error: translate(getCurrentLocale(), 'websocket.disconnected') };
    }
    const baseUrl = this.baseUrl;
    const tempDir = `_temp/download-${this.createTransferId()}`;
    const savePath = `${tempDir}/payload`;
    const controller = new AbortController();
    this.browserDownloads.add(controller);
    let resolveCompletion!: () => void;
    let rejectCompletion!: (error: Error) => void;
    const completed = new Promise<void>((resolve, reject) => {
      resolveCompletion = resolve;
      rejectCompletion = reject;
    });
    const onAbort = () => rejectCompletion(controller.signal.reason || new Error(translate(getCurrentLocale(), 'websocket.disconnected')));
    controller.signal.addEventListener('abort', onAbort, { once: true });
    // 设备回执可能先于 HTTP 响应，必须在下发请求前按设备和独占路径登记监听。
    const unsubscribeMessage = connection.onMessage(message => {
      if (message.udid !== deviceSN || message.body?.savePath !== savePath) return;
      if (message.type !== 'transfer/send/complete' && !(message.type === 'transfer/send' && message.error)) return;
      if (message.error || message.body?.success !== true || message.body?.error) {
        const error = message.error || message.body?.error;
        rejectCompletion(new Error(typeof error === 'string' && error ? error : translate(getCurrentLocale(), 'websocket.transfer_failed')));
      } else {
        resolveCompletion();
      }
    });
    const unsubscribeStatus = connection.onStatusChange(status => {
      if (status === 'disconnected') controller.abort(new Error(translate(getCurrentLocale(), 'websocket.disconnected')));
    });
    const timer = setTimeout(() => {
      controller.abort(new Error(translate(getCurrentLocale(), 'websocket.request_timeout')));
    }, 330_000);
    try {
      const [pullResult] = await Promise.all([
        this.pullFromDevice(deviceSN, deviceSourcePath, 'files', savePath, 300, {
          temporary: true, baseUrl, signal: controller.signal,
        }).then(result => {
          if (!result.success || !result.token) throw new Error(result.error || translate(getCurrentLocale(), 'transfer.pull_failed'));
          return result;
        }),
        completed,
      ]);
      clearTimeout(timer);
      if (controller.signal.aborted) throw controller.signal.reason;
      const downloadPath = pullResult.downloadToken
        ? `/api/transfer/download/${encodeURIComponent(pullResult.downloadToken)}`
        : `/api/server-files/download/files/${savePath.split('/').map(encodeURIComponent).join('/')}`;
      const response = await authFetch(`${baseUrl}${downloadPath}`, { method: 'GET', signal: controller.signal });
      if (!response.ok) {
        throw new Error(localizeApiError(
          await response.json().catch(() => ({})),
          (key, vars) => translate(getCurrentLocale(), key, vars),
          translate(getCurrentLocale(), 'transfer.pull_failed'),
        ).message);
      }
      const blob = await response.blob();
      if (controller.signal.aborted) throw controller.signal.reason;
      return { success: true, blob };
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : translate(getCurrentLocale(), 'transfer.pull_failed'),
      };
    } finally {
      clearTimeout(timer);
      controller.abort();
      controller.signal.removeEventListener('abort', onAbort);
      unsubscribeMessage();
      unsubscribeStatus();
      this.browserDownloads.delete(controller);
      // 前端尽快清理，浏览器退出或清理请求失败时由服务端令牌到期兜底。
      void this.deleteTempFile('files', tempDir, baseUrl);
    }
  }
  
  /**
   * Delete a temporary file from server after successful download
   */
  async deleteTempFile(category: string, path: string, baseUrl = this.baseUrl): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const params = new URLSearchParams({
        category,
        path,
      });
      const response = await authFetch(`${baseUrl}/api/server-files/delete?${params.toString()}`, {
        method: 'DELETE',
        signal: controller.signal,
      });
      if (!response.ok && response.status !== 404) console.warn('Failed to delete temp file:', response.status);
    } catch (e) {
      console.warn('Failed to delete temp file:', e);
    } finally {
      clearTimeout(timer);
    }
  }
}

export default FileTransferService;
