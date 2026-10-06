import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileTransferService } from '../FileTransferService';
import { authFetch } from '../httpAuth';
import type { ConnectionStatus, WebSocketService } from '../WebSocketService';

vi.mock('../httpAuth', () => ({ authFetch: vi.fn() }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(accept => { resolve = accept; });
  return { promise, resolve };
}

function connection() {
  const messages = new Set<(message: any) => void>();
  const statuses = new Set<(status: ConnectionStatus) => void>();
  const service: Pick<WebSocketService, 'onMessage' | 'onStatusChange' | 'getConnectionStatus'> = {
    onMessage: callback => { messages.add(callback); return () => messages.delete(callback); },
    onStatusChange: callback => { statuses.add(callback); return () => statuses.delete(callback); },
    getConnectionStatus: () => 'connected',
  };
  return { service, messages, statuses, emit: (message: any) => messages.forEach(callback => callback(message)) };
}

describe('FileTransferService browser downloads', () => {
  const transfer = FileTransferService.getInstance();
  let ws: ReturnType<typeof connection>;
  let requests: Array<{ url: string; method: string; body?: Record<string, any> }>;
  let pull: ReturnType<typeof deferred<Response>>;
  let readFile: () => Promise<Response>;

  beforeEach(() => {
    transfer.setBaseUrl('http://server-a');
    ws = connection();
    requests = [];
    pull = deferred<Response>();
    readFile = async () => new Response('verified file');
    vi.mocked(authFetch).mockImplementation(async (url, options) => {
      const method = options?.method || 'GET';
      const body = method === 'POST' ? JSON.parse(options!.body as string) : undefined;
      requests.push({ url: String(url), method, body });
      if (method === 'POST') return pull.promise;
      if (method === 'DELETE') return Response.json({ success: true });
      return readFile();
    });
  });

  afterEach(() => {
    transfer.setBaseUrl('');
    vi.useRealTimers();
    vi.resetAllMocks();
  });

  function complete(device = 'device-a', body: Record<string, unknown> = {}) {
    ws.emit({ type: 'transfer/send/complete', udid: device, body: { savePath: requests[0].body!.path, success: true, ...body } });
  }

  it('完成消息早于 HTTP 回应时仍准确下载一次', async () => {
    const result = transfer.downloadFileFromDevice('device-a', '/res/source.bin', ws.service);
    expect(requests[0].body?.temporary).toBe(true);
    complete();
    complete();
    expect(requests.filter(request => request.method === 'GET')).toHaveLength(0);
    pull.resolve(Response.json({ success: true, token: 'upload-token', downloadToken: 'download-token' }));
    const received = await result;
    expect(received.success).toBe(true);
    expect(await received.blob!.text()).toBe('verified file');
    expect(requests.filter(request => request.method === 'GET').map(request => request.url)).toEqual(['http://server-a/api/transfer/download/download-token']);
    expect(requests.filter(request => request.method === 'DELETE')).toHaveLength(1);
    expect(ws.messages.size).toBe(0);
    expect(ws.statuses.size).toBe(0);
  });

  it('只消费当前设备与当前临时路径的完成消息', async () => {
    const result = transfer.downloadFileFromDevice('device-a', '/res/source.bin', ws.service);
    pull.resolve(Response.json({ success: true, token: 'upload-token', downloadToken: 'download-token' }));
    complete('device-b');
    complete('device-a', { savePath: '_temp/another-file' });
    await Promise.resolve();
    await Promise.resolve();
    expect(requests.filter(request => request.method === 'GET')).toHaveLength(0);
    complete();
    expect((await result).success).toBe(true);
    expect(requests.filter(request => request.method === 'GET')).toHaveLength(1);
  });

  it.each(['device', 'dispatch', 'download', 'body'])('%s 失败后解除监听并清理临时目录', async kind => {
    if (kind === 'download') readFile = async () => Response.json({ error: 'read rejected' }, { status: 500 });
    if (kind === 'body') readFile = async () => ({ ok: true, blob: async () => { throw new Error('body interrupted'); } } as unknown as Response);
    const result = transfer.downloadFileFromDevice('device-a', '/res/source.bin', ws.service);
    if (kind === 'dispatch') {
      pull.resolve(Response.json({ success: false, error: 'dispatch rejected' }, { status: 409 }));
    } else {
      pull.resolve(Response.json({ success: true, token: 'upload-token', downloadToken: 'download-token' }));
      complete('device-a', kind === 'device' ? { success: false, error: 'device rejected' } : {});
    }
    expect((await result).success).toBe(false);
    expect(ws.messages.size).toBe(0);
    expect(ws.statuses.size).toBe(0);
    expect(requests.filter(request => request.method === 'DELETE')).toHaveLength(1);
  });

  it('断线取消等待，迟到的回应不会触发下载', async () => {
    const result = transfer.downloadFileFromDevice('device-a', '/res/source.bin', ws.service);
    ws.statuses.forEach(callback => callback('disconnected'));
    expect((await result).success).toBe(false);
    pull.resolve(Response.json({ success: true, token: 'upload-token', downloadToken: 'download-token' }));
    complete();
    await Promise.resolve();
    expect(requests.filter(request => request.method === 'GET')).toHaveLength(0);
    expect(requests.filter(request => request.method === 'DELETE')).toHaveLength(1);
    expect(ws.messages.size).toBe(0);
  });

  it('超时后释放任务和计时器，不留下待下载项', async () => {
    vi.useFakeTimers();
    const result = transfer.downloadFileFromDevice('device-a', '/res/source.bin', ws.service);
    pull.resolve(Response.json({ success: true, token: 'upload-token', downloadToken: 'download-token' }));
    await vi.advanceTimersByTimeAsync(330_000);
    expect((await result).success).toBe(false);
    expect(ws.messages.size).toBe(0);
    expect(ws.statuses.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(requests.filter(request => request.method === 'GET')).toHaveLength(0);
    expect(requests.filter(request => request.method === 'DELETE')).toHaveLength(1);
  });

  it('切换服务器时取消旧下载，清理请求仍指向原服务器', async () => {
    const result = transfer.downloadFileFromDevice('device-a', '/res/source.bin', ws.service);
    transfer.setBaseUrl('http://server-b');
    expect((await result).success).toBe(false);
    pull.resolve(Response.json({ success: true, token: 'upload-token', downloadToken: 'download-token' }));
    complete();
    await Promise.resolve();
    expect(requests.every(request => request.url.startsWith('http://server-a/'))).toBe(true);
    expect(requests.filter(request => request.method === 'GET')).toHaveLength(0);
    expect(ws.messages.size).toBe(0);
  });

  it('兼容尚未返回下载令牌的服务端，并清理自己的唯一临时目录', async () => {
    const result = transfer.downloadFileFromDevice('device-a', '/res/含空格 #?.bin', ws.service);
    pull.resolve(Response.json({ success: true, token: 'legacy-upload-token' }));
    complete();
    const received = await result;
    expect(received.success).toBe(true);
    expect(requests[0].body!.sourcePath).toBe('/res/含空格 #?.bin');
    expect(requests[0].body!.path).toMatch(/^_temp\/download-[\d]+_[a-f\d]{32}\/payload$/);
    expect(requests.find(request => request.method === 'GET')!.url).toBe(`http://server-a/api/server-files/download/files/${requests[0].body!.path}`);
    const cleanup = new URL(requests.find(request => request.method === 'DELETE')!.url);
    expect(cleanup.searchParams.get('path') + '/payload').toBe(requests[0].body!.path);
  });

  it('设备立即拒绝命令时不用等到传输超时', async () => {
    const result = transfer.downloadFileFromDevice('device-a', '/res/missing.bin', ws.service);
    ws.emit({ type: 'transfer/send', udid: 'device-a', error: 'file missing', body: { savePath: requests[0].body!.path } });
    expect(await result).toEqual({ success: false, error: 'file missing' });
    expect(ws.messages.size).toBe(0);
    pull.resolve(Response.json({ success: true, token: 'upload-token', downloadToken: 'download-token' }));
  });

  it('两台设备的完成消息乱序到达也不会混淆下载文件', async () => {
    const pending = new Map<string, ReturnType<typeof deferred<Response>>>();
    vi.mocked(authFetch).mockImplementation(async (url, options) => {
      const method = options?.method || 'GET';
      const body = method === 'POST' ? JSON.parse(options!.body as string) : undefined;
      requests.push({ url: String(url), method, body });
      if (method === 'POST') {
        const request = deferred<Response>();
        pending.set(body.deviceSN, request);
        return request.promise;
      }
      if (method === 'DELETE') return Response.json({ success: true });
      return new Response(String(url).endsWith('download-a') ? 'contents A' : 'contents B');
    });
    const first = transfer.downloadFileFromDevice('device-a', '/res/same.bin', ws.service);
    const second = transfer.downloadFileFromDevice('device-b', '/res/same.bin', ws.service);
    const sourceRequests = requests.filter(request => request.method === 'POST');
    expect(new Set(sourceRequests.map(request => request.body!.path)).size).toBe(2);
    for (const request of [...sourceRequests].reverse()) {
      ws.emit({ type: 'transfer/send/complete', udid: request.body!.deviceSN, body: { savePath: request.body!.path, success: true } });
    }
    pending.get('device-b')!.resolve(Response.json({ success: true, token: 'upload-b', downloadToken: 'download-b' }));
    pending.get('device-a')!.resolve(Response.json({ success: true, token: 'upload-a', downloadToken: 'download-a' }));
    expect(await (await first).blob!.text()).toBe('contents A');
    expect(await (await second).blob!.text()).toBe('contents B');
    expect(requests.filter(request => request.method === 'DELETE')).toHaveLength(2);
    expect(ws.messages.size).toBe(0);
    expect(ws.statuses.size).toBe(0);
  });
});
