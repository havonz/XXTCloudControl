import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { authFetch } from '../httpAuth';
import { createGroupStore } from '../GroupStore';

vi.mock('../httpAuth', () => ({
  authFetch: vi.fn(),
}));

function makeJsonResponse(value: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: vi.fn().mockResolvedValue(value),
  } as unknown as Response;
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

describe('GroupStore device removal', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('DELETE 成功后立即更新本地成员且不依赖二次刷新', async () => {
    const authFetchMock = vi.mocked(authFetch);
    authFetchMock.mockResolvedValueOnce(makeJsonResponse({ success: true }));

    let dispose!: () => void;
    const store = createRoot((rootDispose) => {
      dispose = rootDispose;
      return createGroupStore();
    });
    store.setGroups([
      { id: 'group-a', name: 'A', deviceIds: ['device-a', 'device-b'], sortOrder: 0, scriptPath: 'a.lua' },
      { id: 'group-b', name: 'B', deviceIds: ['device-c'], sortOrder: 1 },
    ]);
    store.setCheckedGroups(new Set(['group-a']));

    await expect(store.removeDevicesFromGroup('group-a', ['device-a'])).resolves.toBe(true);

    expect(store.groups()).toEqual([
      { id: 'group-a', name: 'A', deviceIds: ['device-b'], sortOrder: 0, scriptPath: 'a.lua' },
      { id: 'group-b', name: 'B', deviceIds: ['device-c'], sortOrder: 1 },
    ]);
    expect(store.visibleDeviceIds()).toEqual(new Set(['device-b']));
    expect(authFetchMock).toHaveBeenNthCalledWith(1, '/api/groups/group-a/devices', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceIds: ['device-a'] }),
    });
    expect(authFetchMock).toHaveBeenCalledOnce();
    dispose();
  });

  it('较早发起的分组加载不会覆盖已确认的移除', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const staleLoad = deferred<Response>();
    const authFetchMock = vi.mocked(authFetch);
    authFetchMock
      .mockReturnValueOnce(staleLoad.promise)
      .mockResolvedValueOnce(makeJsonResponse({ success: true }));

    let dispose!: () => void;
    const store = createRoot((rootDispose) => {
      dispose = rootDispose;
      return createGroupStore();
    });
    const initialGroups = [
      { id: 'group-a', name: 'A', deviceIds: ['device-a', 'device-b'], sortOrder: 0 },
    ];
    store.setGroups(initialGroups);

    const pendingLoad = store.loadGroups();
    await expect(store.removeDevicesFromGroup('group-a', ['device-a'])).resolves.toBe(true);

    staleLoad.resolve(makeJsonResponse({ groups: initialGroups }));
    await expect(pendingLoad).resolves.toBe(true);
    expect(store.groups()[0].deviceIds).toEqual(['device-b']);
    dispose();
  });

  it('后发加载失败时仍采用较早的有效响应', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const earlierLoad = deferred<Response>();
    const authFetchMock = vi.mocked(authFetch);
    authFetchMock
      .mockReturnValueOnce(earlierLoad.promise)
      .mockRejectedValueOnce(new Error('newer load failed'));

    let dispose!: () => void;
    const store = createRoot((rootDispose) => {
      dispose = rootDispose;
      return createGroupStore();
    });

    const earlierRequest = store.loadGroups();
    await expect(store.loadGroups()).resolves.toBe(false);

    earlierLoad.resolve(makeJsonResponse({
      groups: [{ id: 'group-a', name: 'A', deviceIds: ['device-a'], sortOrder: 0 }],
    }));
    await expect(earlierRequest).resolves.toBe(true);
    expect(store.groups()[0].deviceIds).toEqual(['device-a']);
    dispose();
  });

  it('DELETE 失败时不修改本地成员', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(authFetch).mockRejectedValueOnce(new Error('delete failed'));

    let dispose!: () => void;
    const store = createRoot((rootDispose) => {
      dispose = rootDispose;
      return createGroupStore();
    });
    store.setGroups([
      { id: 'group-a', name: 'A', deviceIds: ['device-a'], sortOrder: 0 },
    ]);

    await expect(store.removeDevicesFromGroup('group-a', ['device-a'])).resolves.toBe(false);
    expect(store.groups()[0].deviceIds).toEqual(['device-a']);
    dispose();
  });
});
