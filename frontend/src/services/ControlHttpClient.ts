import { AuthService } from './AuthService';
import type { WebSocketService } from './WebSocketService';
import { getCurrentLocale, translate } from '../i18n';

let requestIdCounter = 0;

function generateRequestId(prefix: string): string {
  return `${prefix}-${Date.now()}-${++requestIdCounter}`;
}

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

interface ControlHttpMessageBody {
  devices: string[];
  requestId: string;
  method: string;
  path: string;
  query: Record<string, string | number | boolean>;
  headers: Record<string, string>;
  body?: string;
  port?: number;
}

export interface ControlHttpClientOptions {
  wsService: WebSocketService;
  password: string;
  requestIdPrefix: string;
  defaultTimeoutMs: number;
  responseFilter?: (message: any) => boolean;
}

export interface ControlHttpRequestOptions {
  devices: string[];
  method: string;
  path: string;
  query?: Record<string, string | number | boolean>;
  body?: any;
  port?: number;
  timeoutMs?: number;
}

export interface ControlHttpResponse<T = any> {
  requestId: string;
  statusCode: number;
  body: T | null;
  rawBody: any;
  message: any;
  udid?: string;
}

interface PendingRequest {
  resolve: (value: ControlHttpResponse) => void;
  reject: (reason: any) => void;
  timeout: number;
}

export class ControlHttpClient {
  private wsService: WebSocketService;
  private password: string;
  private requestIdPrefix: string;
  private defaultTimeoutMs: number;
  private responseFilter?: (message: any) => boolean;
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private unsubscribe: (() => void) | null = null;
  private unsubscribeStatus: (() => void) | null = null;
  private isDestroyed = false;

  constructor(options: ControlHttpClientOptions) {
    this.wsService = options.wsService;
    this.password = options.password;
    this.requestIdPrefix = options.requestIdPrefix;
    this.defaultTimeoutMs = options.defaultTimeoutMs;
    this.responseFilter = options.responseFilter;

    this.unsubscribe = this.wsService.onMessage((message) => {
      this.handleMessage(message);
    });
    if (typeof this.wsService.onStatusChange === 'function') {
      this.unsubscribeStatus = this.wsService.onStatusChange((status) => {
        if (status === 'disconnected') {
          this.rejectAllPendingRequests(new Error(translate(getCurrentLocale(), 'websocket.disconnected')));
        }
      });
    }
  }

  send<T = any>(options: ControlHttpRequestOptions): Promise<ControlHttpResponse<T>> {
    if (this.isDestroyed) {
      return Promise.reject(new Error(translate(getCurrentLocale(), 'websocket.service_destroyed')));
    }

    const requestId = generateRequestId(this.requestIdPrefix);
    const requestBody = this.buildRequestBody(requestId, options);

    return new Promise((resolve, reject) => {
      let message: any;
      try {
        message = AuthService.getInstance().createControlMessage(
          this.password,
          'control/http',
          requestBody,
        );
      } catch (error) {
        reject(error);
        return;
      }

      const timeout = window.setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(translate(getCurrentLocale(), 'websocket.request_timeout')));
      }, options.timeoutMs ?? this.defaultTimeoutMs);

      this.pendingRequests.set(requestId, { resolve, reject, timeout });

      if (!this.wsService.send(message)) {
        this.rejectPendingRequest(requestId, new Error(translate(getCurrentLocale(), 'websocket.send_failed')));
      }
    });
  }

  private buildRequestBody(requestId: string, options: ControlHttpRequestOptions): ControlHttpMessageBody {
    return {
      devices: options.devices,
      requestId,
      method: options.method,
      path: options.path,
      query: options.query || {},
      headers: { 'Content-Type': 'application/json' },
      body: options.body ? encodeBody(JSON.stringify(options.body)) : undefined,
      port: options.port,
    };
  }

  destroy(reason: Error = new Error(translate(getCurrentLocale(), 'websocket.service_destroyed'))): void {
    if (this.isDestroyed) {
      return;
    }

    this.isDestroyed = true;

    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    if (this.unsubscribeStatus) {
      this.unsubscribeStatus();
      this.unsubscribeStatus = null;
    }

    this.rejectAllPendingRequests(reason);
  }

  private handleMessage(message: any): void {
    if (this.isDestroyed || message.type !== 'http/response') {
      return;
    }

    if (this.responseFilter && !this.responseFilter(message)) {
      return;
    }

    const body = message.body;
    if (!body || !body.requestId) {
      return;
    }

    const pending = this.pendingRequests.get(body.requestId);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(body.requestId);

    pending.resolve({
      requestId: body.requestId,
      statusCode: body.statusCode,
      body: this.parseResponseBody(body),
      rawBody: body,
      message,
      udid: message.udid,
    });
  }

  private parseResponseBody(body: any): any {
    if (!body.body) {
      return null;
    }

    try {
      const decoded = decodeBody(body.body);
      return JSON.parse(decoded);
    } catch {
      return body.body;
    }
  }

  private rejectPendingRequest(requestId: string, reason: Error): void {
    const pending = this.pendingRequests.get(requestId);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(requestId);
    pending.reject(reason);
  }

  private rejectAllPendingRequests(reason: Error): void {
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(reason);
    }
    this.pendingRequests.clear();
  }
}
