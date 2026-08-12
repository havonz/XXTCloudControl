/**
 * Device Control Service
 * Sends control/http messages via WebSocket to proxy HTTP requests to device OpenAPI
 */

import type { WebSocketService } from './WebSocketService';
import { ControlHttpClient } from './ControlHttpClient';

export interface DeviceControlResult {
  success: boolean;
  error?: string;
  detail?: any;
}

export interface DeviceInfoResult {
  success: boolean;
  data?: Record<string, any>;
  error?: string;
}

export interface DeviceRenameItem {
  udid: string;
  name: string;
}

export interface DeviceRenameResult extends DeviceRenameItem {
  success: boolean;
  error?: string;
}

export class DeviceControlService {
  private httpClient: ControlHttpClient;

  constructor(wsService: WebSocketService, password: string) {
    this.httpClient = new ControlHttpClient({
      wsService,
      password,
      requestIdPrefix: 'ctrl',
      defaultTimeoutMs: 15000,
    });
  }

  /**
   * Send HTTP request to devices via control/http
   */
  private async sendRequest(
    devices: string[],
    method: string,
    path: string,
    query?: Record<string, string | number | boolean>,
    body?: any
  ): Promise<DeviceControlResult> {
    try {
      const response = await this.httpClient.send({
        devices,
        method,
        path,
        query,
        body,
      });

      if (response.statusCode >= 200 && response.statusCode < 300) {
        return { success: true, detail: response.body };
      }

      return {
        success: false,
        error: response.body?.error || `HTTP ${response.statusCode}`,
        detail: response.body,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  }

  /**
   * Lock screen on devices
   */
  async lockScreen(devices: string[]): Promise<DeviceControlResult> {
    return this.sendRequest(devices, 'POST', '/lock_screen');
  }

  /**
   * Unlock screen on devices
   */
  async unlockScreen(devices: string[]): Promise<DeviceControlResult> {
    return this.sendRequest(devices, 'POST', '/unlock_screen');
  }

  /**
   * Set screen brightness on devices
   * @param brightness 0-100 percentage
   */
  async setBrightness(devices: string[], brightness: number): Promise<DeviceControlResult> {
    // Convert 0-100 to 0-1 and use 'level' as the key per device OpenAPI
    const level = Math.max(0, Math.min(100, brightness)) / 100;
    return this.sendRequest(devices, 'POST', '/set_brightness', undefined, { level });
  }

  /**
   * Set volume on devices
   * @param volume 0-100 percentage
   */
  async setVolume(devices: string[], volume: number): Promise<DeviceControlResult> {
    // Convert 0-100 to 0-1 and use 'level' as the key per device OpenAPI
    const level = Math.max(0, Math.min(100, volume)) / 100;
    return this.sendRequest(devices, 'POST', '/set_volume', undefined, { level });
  }

  async getDeviceInfo(udid: string): Promise<DeviceInfoResult> {
    try {
      const response = await this.httpClient.send({
        devices: [udid],
        method: 'GET',
        path: '/deviceinfo',
      });

      if (response.statusCode < 200 || response.statusCode >= 300) {
        return {
          success: false,
          error: response.body?.message
            || response.body?.error
            || response.rawBody?.error
            || `HTTP ${response.statusCode}`,
        };
      }

      const body = response.body;
      if (body?.code !== 0) {
        return {
          success: false,
          error: body?.message || body?.error || '设备信息响应无效',
        };
      }
      if (
        body.data === null ||
        typeof body.data !== 'object' ||
        Array.isArray(body.data)
      ) {
        return {
          success: false,
          error: '设备信息响应无效',
        };
      }

      return { success: true, data: body.data };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async renameDevices(items: DeviceRenameItem[]): Promise<DeviceRenameResult[]> {
    const results = new Array<DeviceRenameResult>(items.length);
    let nextIndex = 0;

    const worker = async (): Promise<void> => {
      while (nextIndex < items.length) {
        const index = nextIndex++;
        const item = items[index];

        try {
          const response = await this.httpClient.send({
            devices: [item.udid],
            method: 'POST',
            path: '/set_device_name',
            body: { name: item.name },
          });

          if (response.statusCode < 200 || response.statusCode >= 300) {
            results[index] = {
              ...item,
              success: false,
              error: response.body?.message
                || response.body?.error
                || response.rawBody?.error
                || `HTTP ${response.statusCode}`,
            };
            continue;
          }

          if (response.body?.code !== 0) {
            results[index] = {
              ...item,
              success: false,
              error: response.body?.message || response.body?.error || '设备返回错误',
            };
            continue;
          }

          results[index] = { ...item, success: true };
        } catch (error) {
          results[index] = {
            ...item,
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(5, items.length) }, () => worker()),
    );
    return results;
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.httpClient.destroy();
  }
}
