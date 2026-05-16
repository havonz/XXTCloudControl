import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DeviceControlService } from '../DeviceControlService';
import type { WebSocketService } from '../WebSocketService';

const setWindow = () => {
  Object.defineProperty(globalThis, 'window', {
    value: globalThis,
    configurable: true,
  });
};

const encodeJsonBody = (value: any) => {
  return btoa(unescape(encodeURIComponent(JSON.stringify(value))));
};

const createWebSocketService = () => {
  const listeners: Array<(message: any) => void> = [];
  const statusListeners: Array<(status: 'connecting' | 'connected' | 'disconnected') => void> = [];
  const sentMessages: any[] = [];
  const wsService = {
    onMessage: vi.fn((callback: (message: any) => void) => {
      listeners.push(callback);
      return () => {
        const index = listeners.indexOf(callback);
        if (index >= 0) {
          listeners.splice(index, 1);
        }
      };
    }),
    onStatusChange: vi.fn((callback: (status: 'connecting' | 'connected' | 'disconnected') => void) => {
      statusListeners.push(callback);
      return () => {
        const index = statusListeners.indexOf(callback);
        if (index >= 0) {
          statusListeners.splice(index, 1);
        }
      };
    }),
    send: vi.fn((message: any) => {
      sentMessages.push(message);
      return true;
    }),
  } as unknown as WebSocketService;

  return { listeners, statusListeners, sentMessages, wsService };
};

describe('DeviceControlService control/http requests', () => {
  beforeAll(() => {
    setWindow();
  });

  afterAll(() => {
    delete (globalThis as any).window;
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('解析 control/http 成功响应并保持 DeviceControlResult 结构', async () => {
    vi.useFakeTimers();

    const { listeners, sentMessages, wsService } = createWebSocketService();
    const service = new DeviceControlService(wsService, 'password');
    const request = service.lockScreen(['device-1']);

    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].type).toBe('control/http');
    expect(sentMessages[0].body.path).toBe('/lock_screen');

    listeners[0]({
      type: 'http/response',
      body: {
        requestId: sentMessages[0].body.requestId,
        statusCode: 200,
        body: encodeJsonBody({ ok: true }),
      },
    });

    await expect(request).resolves.toEqual({
      success: true,
      detail: { ok: true },
    });

    service.destroy();
  });

  it('请求超时仍 resolve 为失败结果', async () => {
    vi.useFakeTimers();

    const { wsService } = createWebSocketService();
    const service = new DeviceControlService(wsService, 'password');
    const request = service.setVolume(['device-1'], 50);

    vi.advanceTimersByTime(15000);

    await expect(request).resolves.toEqual({
      success: false,
      error: 'Request timeout',
    });

    service.destroy();
  });

  it('WebSocket 断开时立即结束待处理请求', async () => {
    vi.useFakeTimers();

    const { statusListeners, wsService } = createWebSocketService();
    const service = new DeviceControlService(wsService, 'password');
    const request = service.unlockScreen(['device-1']);

    statusListeners[0]('disconnected');

    await expect(request).resolves.toEqual({
      success: false,
      error: 'WebSocket连接已断开',
    });
    expect(vi.getTimerCount()).toBe(0);

    service.destroy();
  });
});
