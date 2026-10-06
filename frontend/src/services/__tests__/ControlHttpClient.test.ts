import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ControlHttpClient, type ControlHttpClientOptions } from '../ControlHttpClient';
import { WebSocketService } from '../WebSocketService';

function createSocket() {
  const listeners = new Set<(message: any) => void>();
  const statusListeners = new Set<(status: 'connecting' | 'connected' | 'disconnected') => void>();
  const sent: any[] = [];
  const service = {
    onMessage: vi.fn((listener: (message: any) => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    }),
    onStatusChange: vi.fn((listener: (status: 'connecting' | 'connected' | 'disconnected') => void) => {
      statusListeners.add(listener);
      return () => { statusListeners.delete(listener); };
    }),
    send: vi.fn((message: any) => { sent.push(message); return true; }),
  };
  return {
    service: service as unknown as WebSocketService,
    listeners,
    statusListeners,
    sent,
    emit(message: any) { for (const listener of [...listeners]) listener(message); },
    status(status: 'connecting' | 'connected' | 'disconnected') {
      for (const listener of [...statusListeners]) listener(status);
    },
  };
}

function httpResponse(requestId: string, udid = 'device-1', body: unknown = { ok: true }) {
  return {
    type: 'http/response',
    udid,
    body: { requestId, statusCode: 200, body: btoa(unescape(encodeURIComponent(JSON.stringify(body)))) },
  };
}

describe('ControlHttpClient response routing', () => {
  const clients: ControlHttpClient[] = [];

  const createClient = (socket: ReturnType<typeof createSocket>, options: Partial<ControlHttpClientOptions> = {}) => {
    const client = new ControlHttpClient({
      wsService: socket.service,
      password: 'test-only',
      requestIdPrefix: 'route',
      defaultTimeoutMs: 5000,
      ...options,
    });
    clients.push(client);
    return client;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('localStorage', { getItem: () => null });
  });

  afterEach(() => {
    for (const client of clients.splice(0)) client.destroy();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('400 个客户端的响应只筛选所属请求，共用一组连接监听', async () => {
    const socket = createSocket();
    const filters = Array.from({ length: 400 }, (_, index) => vi.fn(message => message.udid === `device-${index}`));
    const activeClients = filters.map(responseFilter => createClient(socket, { responseFilter }));
    const requests = activeClients.map((client, index) => client.send({ devices: [`device-${index}`], method: 'GET', path: '/api/webrtc/poll' }));
    socket.sent.forEach((message, index) => socket.emit(httpResponse(message.body.requestId, `device-${index}`)));
    const responses = await Promise.all(requests);
    expect(responses).toHaveLength(400);
    expect(filters.reduce((total, filter) => total + filter.mock.calls.length, 0)).toBe(400);
    expect(socket.listeners.size).toBe(1);
    expect(socket.statusListeners.size).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('乱序回包保持请求对应，错误设备和无关消息不能消费请求', async () => {
    const socket = createSocket();
    const filterA = vi.fn(message => message.udid === 'a');
    const filterB = vi.fn(message => message.udid === 'b');
    const a = createClient(socket, { responseFilter: filterA });
    const b = createClient(socket, { responseFilter: filterB });
    const first = a.send({ devices: ['a'], method: 'GET', path: '/first' });
    const second = b.send({ devices: ['b'], method: 'GET', path: '/second' });
    const firstId = socket.sent[0].body.requestId;
    const secondId = socket.sent[1].body.requestId;

    socket.emit(httpResponse(firstId, 'b'));
    socket.emit(httpResponse('unknown', 'a'));
    socket.emit({ type: 'app/state', body: { requestId: firstId } });
    socket.emit({ type: 'http/response', body: null });
    socket.emit(null);
    expect(vi.getTimerCount()).toBe(2);
    expect(filterA).toHaveBeenCalledTimes(1);
    expect(filterB).not.toHaveBeenCalled();

    socket.emit(httpResponse(secondId, 'b', { name: '设备乙' }));
    socket.emit(httpResponse(secondId, 'b', { name: 'duplicate' }));
    socket.emit(httpResponse(firstId, 'a', { name: '设备甲' }));
    const responses = await Promise.all([first, second]);
    expect(responses.map(response => ({ id: response.requestId, udid: response.udid, body: response.body }))).toEqual([
      { id: firstId, udid: 'a', body: { name: '设备甲' } },
      { id: secondId, udid: 'b', body: { name: '设备乙' } },
    ]);
    expect(filterA).toHaveBeenCalledTimes(2);
    expect(filterB).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('不同 WebSocket 的回包和断线通知相互隔离', async () => {
    const firstSocket = createSocket();
    const secondSocket = createSocket();
    const first = createClient(firstSocket);
    const second = createClient(secondSocket);
    const firstRequest = first.send({ devices: ['a'], method: 'GET', path: '/first' });
    const secondRequest = second.send({ devices: ['b'], method: 'GET', path: '/second' });
    secondSocket.emit(httpResponse(firstSocket.sent[0].body.requestId, 'a'));
    expect(vi.getTimerCount()).toBe(2);

    const disconnected = expect(firstRequest).rejects.toThrow('WebSocket disconnected');
    firstSocket.status('disconnected');
    await disconnected;
    expect(vi.getTimerCount()).toBe(1);
    secondSocket.emit(httpResponse(secondSocket.sent[0].body.requestId, 'b', { value: 'still connected' }));
    await expect(secondRequest).resolves.toMatchObject({ body: { value: 'still connected' } });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('销毁一个客户端不影响其他客户端，最后退出时释放共享监听并可重新建立', async () => {
    const socket = createSocket();
    const firstFilter = vi.fn(() => true);
    const secondFilter = vi.fn(() => true);
    const first = createClient(socket, { responseFilter: firstFilter });
    const second = createClient(socket, { responseFilter: secondFilter });
    const observer = vi.fn();
    const unsubscribeObserver = socket.service.onMessage(observer);
    const firstRequest = first.send({ devices: ['a'], method: 'GET', path: '/first' });
    const secondRequest = second.send({ devices: ['b'], method: 'GET', path: '/second' });
    const reason = new Error('closed owner');
    const rejected = expect(firstRequest).rejects.toBe(reason);
    first.destroy(reason);
    first.destroy(reason);
    await rejected;
    expect(vi.getTimerCount()).toBe(1);
    expect(socket.listeners.size).toBe(2);
    expect(socket.statusListeners.size).toBe(1);

    socket.emit(httpResponse(socket.sent[0].body.requestId, 'a'));
    expect(firstFilter).not.toHaveBeenCalled();
    expect(secondFilter).not.toHaveBeenCalled();
    socket.emit(httpResponse(socket.sent[1].body.requestId, 'b'));
    await expect(secondRequest).resolves.toMatchObject({ body: { ok: true } });
    second.destroy();
    expect(socket.listeners.size).toBe(1);
    expect(socket.statusListeners.size).toBe(0);
    socket.emit({ type: 'system/log/push', body: 'still observed' });
    expect(observer).toHaveBeenCalledTimes(3);

    const replacement = createClient(socket);
    const request = replacement.send({ devices: ['c'], method: 'GET', path: '/replacement' });
    expect(socket.listeners.size).toBe(2);
    expect(socket.statusListeners.size).toBe(1);
    socket.emit(httpResponse(socket.sent[2].body.requestId, 'c'));
    await expect(request).resolves.toMatchObject({ udid: 'c' });
    replacement.destroy();
    unsubscribeObserver();
    expect(socket.listeners.size).toBe(0);
    expect(socket.statusListeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('超时、发送失败和发送异常都会清理请求索引和定时器', async () => {
    const socket = createSocket();
    const filter = vi.fn(() => true);
    const client = createClient(socket, { responseFilter: filter });
    const request = { devices: ['a'], method: 'GET', path: '/test', timeoutMs: 20 };
    const pending = client.send(request);
    const expired = expect(pending).rejects.toThrow('Request timed out');
    vi.advanceTimersByTime(20);
    await expired;
    socket.emit(httpResponse(socket.sent[0].body.requestId, 'a'));
    expect(filter).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);

    const send = vi.mocked(socket.service.send);
    send.mockReturnValueOnce(false);
    await expect(client.send(request)).rejects.toThrow('Failed to send');
    const failedId = send.mock.calls.at(-1)![0].body.requestId;
    socket.emit(httpResponse(failedId, 'a'));
    expect(filter).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);

    const sendError = new Error('transport threw');
    send.mockImplementationOnce(() => { throw sendError; });
    await expect(client.send(request)).rejects.toBe(sendError);
    const thrownId = send.mock.calls.at(-1)![0].body.requestId;
    socket.emit(httpResponse(thrownId, 'a'));
    expect(filter).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('断开共享连接会结束全部请求，重连后仍可继续使用现有客户端', async () => {
    const socket = createSocket();
    const filter = vi.fn(() => true);
    const first = createClient(socket, { responseFilter: filter });
    const second = createClient(socket, { responseFilter: filter });
    const requests = [first, second].map(client => client.send({ devices: ['a'], method: 'GET', path: '/test' }));
    const results = Promise.allSettled(requests);
    socket.status('disconnected');
    expect((await results).map(result => result.status)).toEqual(['rejected', 'rejected']);
    expect(vi.getTimerCount()).toBe(0);
    for (const message of socket.sent) socket.emit(httpResponse(message.body.requestId));
    expect(filter).not.toHaveBeenCalled();

    socket.status('connected');
    const next = first.send({ devices: ['a'], method: 'GET', path: '/after-reconnect' });
    socket.emit(httpResponse(socket.sent[2].body.requestId));
    await expect(next).resolves.toMatchObject({ body: { ok: true } });
    expect(socket.listeners.size).toBe(1);
    expect(socket.statusListeners.size).toBe(1);
  });

  it('只发送不等待的请求不创建回包路由或定时器', () => {
    const socket = createSocket();
    const filter = vi.fn(() => true);
    const client = createClient(socket, { responseFilter: filter });
    client.dispatch({ devices: ['a'], method: 'POST', path: '/runtime_settings/apply', body: { port: 50000 } });
    expect(socket.sent).toHaveLength(1);
    expect(socket.sent[0]).toMatchObject({ type: 'control/http', body: { path: '/runtime_settings/apply' } });
    socket.emit(httpResponse(socket.sent[0].body.requestId));
    expect(filter).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('接入实际 WebSocketService 后仍保留普通消息回调和断线取消', async () => {
    const service = new WebSocketService('ws://127.0.0.1:46980');
    const socket = { ...createSocket(), service };
    const sent: any[] = [];
    vi.spyOn(service, 'send').mockImplementation(message => { sent.push(message); return true; });
    const first = createClient(socket, { responseFilter: message => message.udid === 'a' });
    const second = createClient(socket, { responseFilter: message => message.udid === 'b' });
    const observer = vi.fn();
    const unsubscribeObserver = service.onMessage(observer);
    const firstRequest = first.send({ devices: ['a'], method: 'GET', path: '/api/webrtc/poll' });
    const secondRequest = second.send({ devices: ['b'], method: 'GET', path: '/deviceinfo' });
    const incoming = httpResponse(sent[1].body.requestId, 'b', { code: 0, data: { name: '设备乙' } });
    (service as any).handleMessage(incoming);
    await expect(secondRequest).resolves.toMatchObject({ body: { code: 0, data: { name: '设备乙' } } });
    expect(observer).toHaveBeenCalledWith(incoming, false);

    const disconnected = expect(firstRequest).rejects.toThrow('WebSocket disconnected');
    (service as any).notifyStatusChange('disconnected');
    await disconnected;
    expect(vi.getTimerCount()).toBe(0);
    unsubscribeObserver();
  });
});
