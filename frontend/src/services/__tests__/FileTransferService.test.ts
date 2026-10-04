import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileTransferService } from '../FileTransferService';
import { authFetch } from '../httpAuth';

vi.mock('../httpAuth', () => ({ authFetch: vi.fn() }));

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: async () => body } as Response;
}

describe('FileTransferService batch fanout', () => {
  afterEach(() => {
    vi.resetAllMocks();
    FileTransferService.getInstance().setBaseUrl('');
  });

  it('只上传一次，以最多六个请求分发，并保留设备结果顺序', async () => {
    const devices = Array.from({ length: 14 }, (_, index) => `device-${index}`);
    const releases = new Map<string, (response: Response) => void>();
    const pushed: Array<Record<string, any>> = [];
    let active = 0;
    let peak = 0;
    vi.mocked(authFetch).mockImplementation(async (url, options) => {
      if (String(url).endsWith('/api/server-files/upload')) {
        return jsonResponse({ path: '_temp/payload.bin' });
      }
      const body = JSON.parse(options?.body as string);
      pushed.push(body);
      active++;
      peak = Math.max(peak, active);
      try {
        return await new Promise<Response>((resolve) => { releases.set(body.deviceSN, resolve); });
      } finally {
        active--;
      }
    });
    const service = FileTransferService.getInstance();
    const pending = service.uploadFileToDevices(devices, new File([new Uint8Array(128 * 1024 + 1)], 'payload.bin'), '/res/payload.bin');
    await vi.waitFor(() => expect(pushed).toHaveLength(6));
    releases.get('device-5')!(jsonResponse({ error: 'device failed' }, false));
    await vi.waitFor(() => expect(pushed).toHaveLength(7));
    for (const id of devices) {
      if (id === 'device-5') continue;
      await vi.waitFor(() => expect(releases.has(id)).toBe(true));
      releases.get(id)!(jsonResponse({ success: true, token: `token-${id}` }));
    }
    const results = await pending;
    expect(peak).toBe(6);
    expect(results.map((result, index) => result.success ? result.token : `failed-${devices[index]}`))
      .toEqual(devices.map(id => id === 'device-5' ? `failed-${id}` : `token-${id}`));
    expect(pushed.every(body => body.sharedSourceTotal === devices.length && body.targetPath === '/res/payload.bin')).toBe(true);
    expect(new Set(pushed.map(body => body.sharedSourceId)).size).toBe(1);
    expect(pushed[0].sharedSourceId).toBeTruthy();
    expect(vi.mocked(authFetch).mock.calls.filter(([url]) => String(url).endsWith('/api/server-files/upload'))).toHaveLength(1);
    expect(vi.mocked(authFetch).mock.calls.some(([url]) => String(url).includes('/delete'))).toBe(false);
  });

  it('全部失败后清理源文件，空设备列表不发送请求', async () => {
    vi.mocked(authFetch).mockImplementation(async (url) => {
      if (String(url).endsWith('/api/server-files/upload')) return jsonResponse({ path: '_temp/payload.bin' });
      if (String(url).includes('/delete')) return jsonResponse({ success: true });
      return jsonResponse({ error: 'device offline' }, false);
    });
    const service = FileTransferService.getInstance();
    const file = new File([new Uint8Array(128 * 1024 + 1)], 'payload.bin');
    await expect(service.uploadFileToDevices([], file, '/res/payload.bin')).resolves.toEqual([]);
    expect(authFetch).not.toHaveBeenCalled();
    const result = await service.uploadFileToDevices(['a', 'b'], file, '/res/payload.bin');
    expect(result.map(value => value.success)).toEqual([false, false]);
    expect(vi.mocked(authFetch).mock.calls.filter(([url]) => String(url).includes('/delete'))).toHaveLength(1);
  });
});
