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

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.httpClient.destroy();
  }
}
