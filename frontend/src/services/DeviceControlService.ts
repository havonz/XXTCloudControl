/**
 * Device Control Service
 * Sends control/http messages via WebSocket to proxy HTTP requests to device OpenAPI
 */

import type { WebSocketService } from './WebSocketService';
import { AuthService } from './AuthService';

// Generate unique request ID
let requestIdCounter = 0;
function generateRequestId(): string {
  return `ctrl-${Date.now()}-${++requestIdCounter}`;
}

// Base64 encode/decode helpers
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

export interface DeviceControlResult {
  success: boolean;
  error?: string;
  detail?: any;
}

export class DeviceControlService {
  private wsService: WebSocketService;
  private password: string;
  private pendingRequests: Map<string, {
    resolve: (value: DeviceControlResult) => void;
    reject: (reason: any) => void;
    timeout: number;
  }> = new Map();
  private unsubscribe: (() => void) | null = null;

  constructor(wsService: WebSocketService, password: string) {
    this.wsService = wsService;
    this.password = password;
    this.setupMessageHandler();
  }

  private setupMessageHandler() {
    this.unsubscribe = this.wsService.onMessage((message) => {
      // Handle http/response messages
      if (message.type === 'http/response') {
        const body = message.body;
        if (!body || !body.requestId) return;

        const pending = this.pendingRequests.get(body.requestId);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingRequests.delete(body.requestId);

          // Decode response body
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
            pending.resolve({ success: true, detail: responseBody });
          } else {
            pending.resolve({ 
              success: false, 
              error: responseBody?.error || `HTTP ${body.statusCode}`,
              detail: responseBody
            });
          }
        }
      }
    });
  }

  /**
   * Send HTTP request to devices via control/http
   */
  private sendRequest(
    devices: string[],
    method: string,
    path: string,
    query?: Record<string, string | number | boolean>,
    body?: any
  ): Promise<DeviceControlResult> {
    const requestId = generateRequestId();
    const authService = AuthService.getInstance();

    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.pendingRequests.delete(requestId);
        resolve({ success: false, error: 'Request timeout' });
      }, 15000);

      this.pendingRequests.set(requestId, { resolve, reject, timeout });

      const message = authService.createControlMessage(
        this.password,
        'control/http',
        {
          devices,
          requestId,
          method,
          path,
          query: query || {},
          headers: { 'Content-Type': 'application/json' },
          body: body ? encodeBody(JSON.stringify(body)) : undefined
        }
      );

      this.wsService.send(message);
    });
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
  destroy() {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }

    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
    }
    this.pendingRequests.clear();
  }
}
