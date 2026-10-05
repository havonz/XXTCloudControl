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

  it('并行上传的同名文件独占源目录，失败批次不会删除其他批次', async () => {
    const sources = new Map<string, string>();
    const transfers: Array<{ path: string; targetPath: string }> = [];
    vi.mocked(authFetch).mockImplementation(async (url, options) => {
      if (String(url).endsWith('/upload')) {
        const form = options!.body as FormData;
        const file = form.get('file') as File;
        const path = `${form.get('path')}/${file.name}`;
        sources.set(path, await file.text());
        return jsonResponse({ success: true, path });
      }
      if (String(url).includes('/delete')) {
        const path = new URL(String(url), 'http://localhost').searchParams.get('path')!;
        for (const source of sources.keys()) {
          if (source === path || source.startsWith(`${path}/`)) sources.delete(source);
        }
        return jsonResponse({ success: true });
      }
      const request = JSON.parse(options!.body as string);
      if (request.deviceSN === 'offline') return jsonResponse({ error: 'offline' }, false);
      transfers.push(request);
      return jsonResponse({ success: true, token: `token-${transfers.length}` });
    });
    const service = FileTransferService.getInstance();
    await Promise.all([
      service.uploadFileToDevices(['a'], new File(['first'], 'same.bin'), '/res/a/same.bin'),
      service.uploadFileToDevices(['b'], new File(['second'], 'same.bin'), '/res/b/same.bin'),
    ]);
    expect(sources.size).toBe(2);
    expect(transfers.map(({ path, targetPath }) => ({ content: sources.get(path), targetPath }))
      .sort((a, b) => a.targetPath.localeCompare(b.targetPath))).toEqual([
      { content: 'first', targetPath: '/res/a/same.bin' },
      { content: 'second', targetPath: '/res/b/same.bin' },
    ]);
    expect(transfers.every(({ path }) => /^_temp\/upload-[^/]+\/same\.bin$/.test(path))).toBe(true);

    await service.uploadFileToDevices(['offline'], new File(['third'], 'same.bin'), '/res/c/same.bin');
    expect([...sources.values()].sort()).toEqual(['first', 'second']);
    expect(vi.mocked(authFetch).mock.calls.filter(([url]) => String(url).includes('/delete'))).toHaveLength(1);
  });

  it('上传失败和不需要下载令牌的小文件传输会回收各自的临时目录', async () => {
    const directories: string[] = [];
    vi.mocked(authFetch).mockImplementation(async (url, options) => {
      if (String(url).endsWith('/upload')) {
        const form = options!.body as FormData;
        const dir = String(form.get('path'));
        directories.push(dir);
        if (directories.length === 1) return jsonResponse({ error: 'upload interrupted' }, false);
        return jsonResponse({ success: true, path: `${dir}/small.txt` });
      }
      return jsonResponse({ success: true });
    });
    const service = FileTransferService.getInstance();
    const file = new File(['content'], 'small.txt');
    const failed = await service.uploadFileToDevices(['a'], file, '/res/small.txt');
    expect(failed[0].success).toBe(false);
    const sent = await service.uploadFileToDevices(['a', 'b'], file, '/res/small.txt');
    expect(sent.every(result => result.success)).toBe(true);
    const removed = vi.mocked(authFetch).mock.calls.filter(([url]) => String(url).includes('/delete'))
      .map(([url]) => new URL(String(url), 'http://localhost').searchParams.get('path'));
    expect(removed).toEqual(directories);
  });
});
