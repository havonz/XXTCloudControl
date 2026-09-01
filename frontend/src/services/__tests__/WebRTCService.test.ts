import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { WebRTCService } from '../WebRTCService';
import type { WebSocketService } from '../WebSocketService';
import { localeStorageKey } from '../../i18n';

const localeStorage = new Map<string, string>();

function setWindow(): void {
  Object.defineProperty(globalThis, 'window', {
    value: globalThis,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (key: string) => localeStorage.get(key) ?? null,
      setItem: (key: string, value: string) => localeStorage.set(key, value),
      removeItem: (key: string) => localeStorage.delete(key),
      clear: () => localeStorage.clear(),
    },
    configurable: true,
  });
}

function createWebSocketService(unsubscribe = vi.fn()): WebSocketService {
  return {
    onMessage: vi.fn(() => unsubscribe),
    send: vi.fn(() => true),
  } as unknown as WebSocketService;
}

describe('WebRTCService polling lifecycle', () => {
  beforeAll(() => {
    setWindow();
  });

  afterAll(() => {
    delete (globalThis as any).window;
    delete (globalThis as any).localStorage;
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    localeStorage.clear();
  });

  it('WebRTC HTTP 请求通过公共客户端携带当前前端语言', async () => {
    vi.useFakeTimers();

    let listener: ((message: any) => void) | undefined;
    const sentMessages: any[] = [];
    const wsService = {
      onMessage: vi.fn((callback: (message: any) => void) => {
        listener = callback;
        return vi.fn();
      }),
      send: vi.fn((message: any) => {
        sentMessages.push(message);
        return true;
      }),
    } as unknown as WebSocketService;
    const service = new WebRTCService(wsService, 'device-1', 'password');

    window.localStorage.setItem(localeStorageKey, 'pt-BR');
    const request = (service as any).sendRequest('GET', '/api/webrtc/poll');

    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]).toMatchObject({
      type: 'control/http',
      body: {
        devices: ['device-1'],
        path: '/api/webrtc/poll',
        headers: {
          'Content-Type': 'application/json',
          'Accept-Language': 'pt-BR',
        },
      },
    });

    listener!({
      type: 'http/response',
      udid: 'device-1',
      body: {
        requestId: sentMessages[0].body.requestId,
        statusCode: 200,
        body: btoa(JSON.stringify({ events: [] })),
      },
    });

    await expect(request).resolves.toEqual({ events: [] });
    service.cleanup();
  });

  it('stopPolling 会清理已排队的 poll timer', async () => {
    vi.useFakeTimers();

    const service = new WebRTCService(createWebSocketService(), 'device-1', 'password');
    const sendRequest = vi.fn().mockResolvedValue([]);
    (service as any).sendRequest = sendRequest;
    (service as any).peerConnection = {
      connectionState: 'connected',
      close: vi.fn(),
    };

    (service as any).startPolling();
    await Promise.resolve();

    expect(sendRequest).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);

    (service as any).stopPolling();

    expect(vi.getTimerCount()).toBe(0);

    service.cleanup();
  });

  it('cleanup 会清理 poll timer 并取消消息订阅', async () => {
    vi.useFakeTimers();

    const unsubscribe = vi.fn();
    const service = new WebRTCService(createWebSocketService(unsubscribe), 'device-1', 'password');
    (service as any).sendRequest = vi.fn().mockResolvedValue([]);
    (service as any).peerConnection = {
      connectionState: 'connected',
      close: vi.fn(),
    };

    (service as any).startPolling();
    await Promise.resolve();

    expect(vi.getTimerCount()).toBe(1);

    service.cleanup();

    expect(vi.getTimerCount()).toBe(0);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('hardware_keyboard_state 不要求设备端返回 supported 字段', () => {
    vi.useFakeTimers();
    const onHardwareKeyboardState = vi.fn();
    const service = new WebRTCService(
      createWebSocketService(),
      'device-1',
      'password',
      { onHardwareKeyboardState }
    );
    const channel: any = {
      readyState: 'open',
      send: vi.fn(),
      close: vi.fn(),
      onopen: null,
      onerror: null,
      onmessage: null,
    };
    (service as any).dataChannel = channel;
    (service as any).setupDataChannel();

    channel.onmessage?.({
      data: JSON.stringify({
        type: 'hardware_keyboard_state',
        action: 'status',
        ok: true,
        connected: false,
      }),
    });

    expect(onHardwareKeyboardState).toHaveBeenCalledWith({
      action: 'status',
      supported: true,
      ok: true,
      connected: false,
      message: undefined,
    });
    service.cleanup();
  });
});
