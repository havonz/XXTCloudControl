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
  timeoutMs?: number;
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

interface ControlHttpResponseRouter {
  clients: Set<ControlHttpClient>;
  pendingOwners: Map<string, ControlHttpClient>;
  unsubscribeMessage?: () => void;
  unsubscribeStatus?: () => void;
}

const responseRouters = new WeakMap<WebSocketService, ControlHttpResponseRouter>();

export class ControlHttpClient {
  private wsService: WebSocketService;
  private password: string;
  private requestIdPrefix: string;
  private defaultTimeoutMs: number;
  private responseFilter?: (message: any) => boolean;
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private responseRouter: ControlHttpResponseRouter;
  private isDestroyed = false;

  constructor(options: ControlHttpClientOptions) {
    this.wsService = options.wsService;
    this.password = options.password;
    this.requestIdPrefix = options.requestIdPrefix;
    this.defaultTimeoutMs = options.defaultTimeoutMs;
    this.responseFilter = options.responseFilter;

    let router = responseRouters.get(this.wsService);
    if (!router) {
      const shared: ControlHttpResponseRouter = {
        clients: new Set(),
        pendingOwners: new Map(),
      };
      // 多路远控复用一条 WebSocket，回包只交给对应请求，避免逐个遍历所有客户端。
      shared.unsubscribeMessage = this.wsService.onMessage((message) => {
        if (message?.type !== 'http/response') return;
        const owner = shared.pendingOwners.get(message.body?.requestId);
        owner?.handleMessage(message);
      });
      if (typeof this.wsService.onStatusChange === 'function') {
        shared.unsubscribeStatus = this.wsService.onStatusChange((status) => {
          if (status !== 'disconnected') return;
          for (const client of shared.clients) {
            client.rejectAllPendingRequests(new Error(translate(getCurrentLocale(), 'websocket.disconnected')));
          }
        });
      }
      responseRouters.set(this.wsService, shared);
      router = shared;
    }
    this.responseRouter = router;
    router.clients.add(this);
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
        this.rejectPendingRequest(requestId, new Error(translate(getCurrentLocale(), 'websocket.request_timeout')));
      }, options.timeoutMs ?? this.defaultTimeoutMs);

      this.pendingRequests.set(requestId, { resolve, reject, timeout });
      this.responseRouter.pendingOwners.set(requestId, this);

      try {
        if (!this.wsService.send(message)) {
          this.rejectPendingRequest(requestId, new Error(translate(getCurrentLocale(), 'websocket.send_failed')));
        }
      } catch (error) {
        this.rejectPendingRequest(requestId, error);
      }
    });
  }

  dispatch(options: ControlHttpRequestOptions): void {
    if (this.isDestroyed) throw new Error(translate(getCurrentLocale(), 'websocket.service_destroyed'));
    const requestBody = this.buildRequestBody(generateRequestId(this.requestIdPrefix), options);
    const message = AuthService.getInstance().createControlMessage(this.password, 'control/http', requestBody);
    if (!this.wsService.send(message)) throw new Error(translate(getCurrentLocale(), 'websocket.send_failed'));
  }

  private buildRequestBody(requestId: string, options: ControlHttpRequestOptions): ControlHttpMessageBody {
    return {
      devices: options.devices,
      requestId,
      method: options.method,
      path: options.path,
      query: options.query || {},
      headers: {
        'Content-Type': 'application/json',
        'Accept-Language': getCurrentLocale(),
      },
      body: options.body ? encodeBody(JSON.stringify(options.body)) : undefined,
      port: options.port,
      timeoutMs: options.timeoutMs ?? this.defaultTimeoutMs,
    };
  }

  destroy(reason: Error = new Error(translate(getCurrentLocale(), 'websocket.service_destroyed'))): void {
    if (this.isDestroyed) {
      return;
    }

    this.isDestroyed = true;

    this.rejectAllPendingRequests(reason);
    this.responseRouter.clients.delete(this);
    if (this.responseRouter.clients.size === 0) {
      this.responseRouter.unsubscribeMessage?.();
      this.responseRouter.unsubscribeStatus?.();
      responseRouters.delete(this.wsService);
    }
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
    this.responseRouter.pendingOwners.delete(body.requestId);

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

  private rejectPendingRequest(requestId: string, reason: unknown): void {
    const pending = this.pendingRequests.get(requestId);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(requestId);
    this.responseRouter.pendingOwners.delete(requestId);
    pending.reject(reason);
  }

  private rejectAllPendingRequests(reason: Error): void {
    for (const [requestId, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      this.responseRouter.pendingOwners.delete(requestId);
      pending.reject(reason);
    }
    this.pendingRequests.clear();
  }
}
