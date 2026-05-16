import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { WebRTCService } from '../WebRTCService';
import type { WebSocketService } from '../WebSocketService';

const setWindow = () => {
  Object.defineProperty(globalThis, 'window', {
    value: globalThis,
    configurable: true,
  });
};

const createWebSocketService = (unsubscribe = vi.fn()) => {
  return {
    onMessage: vi.fn(() => unsubscribe),
    send: vi.fn(() => true),
  } as unknown as WebSocketService;
};

describe('WebRTCService polling lifecycle', () => {
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
});
