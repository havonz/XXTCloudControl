import { createRoot } from 'solid-js';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { authFetch } from '../../services/httpAuth';
import { useScriptConfigManager } from '../useScriptConfigManager';

vi.mock('../../services/httpAuth', () => ({
  authFetch: vi.fn(),
}));

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

function makeJsonResponse(value: any, ok = true): Response {
  return {
    ok,
    json: vi.fn().mockResolvedValue(value),
  } as unknown as Response;
}

describe('useScriptConfigManager async state', () => {
  const alertSpy = vi.fn();

  beforeAll(() => {
    Object.defineProperty(globalThis, 'alert', {
      value: alertSpy,
      configurable: true,
    });
  });

  afterAll(() => {
    delete (globalThis as any).alert;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('后发起的配置请求不会被先发起的慢请求覆盖', async () => {
    const slow = deferred<Response>();
    const fast = deferred<Response>();
    const authFetchMock = vi.mocked(authFetch);
    authFetchMock.mockImplementation((url) => {
      const requestUrl = String(url);
      if (requestUrl.includes('slow.lua')) {
        return slow.promise;
      }
      if (requestUrl.includes('fast.lua')) {
        return fast.promise;
      }
      return Promise.reject(new Error(`Unexpected url: ${requestUrl}`));
    });

    let dispose!: () => void;
    const manager = createRoot((rootDispose) => {
      dispose = rootDispose;
      return useScriptConfigManager();
    });

    const slowRequest = manager.openGlobalConfig('slow.lua');
    const fastRequest = manager.openGlobalConfig('fast.lua');

    fast.resolve(makeJsonResponse({
      UI: [{ type: 'Edit', caption: 'Fast', id: 'value' }],
      Config: { value: 'fast' },
      ScriptInfo: { Name: 'fast.lua' },
    }));
    await fastRequest;

    expect(manager.configTitle()).toBe('Global Config: fast.lua');
    expect(manager.initialValues()).toEqual({ value: 'fast' });

    slow.resolve(makeJsonResponse({
      UI: [{ type: 'Edit', caption: 'Slow', id: 'value' }],
      Config: { value: 'slow' },
      ScriptInfo: { Name: 'slow.lua' },
    }));
    await slowRequest;

    expect(manager.configTitle()).toBe('Global Config: fast.lua');
    expect(manager.initialValues()).toEqual({ value: 'fast' });
    expect(alertSpy).not.toHaveBeenCalled();

    dispose();
  });

  it('关闭弹窗后未完成的打开请求不会重新打开配置', async () => {
    const slow = deferred<Response>();
    vi.mocked(authFetch).mockReturnValue(slow.promise);

    let dispose!: () => void;
    const manager = createRoot((rootDispose) => {
      dispose = rootDispose;
      return useScriptConfigManager();
    });

    const request = manager.openGlobalConfig('slow.lua');
    manager.closeConfig();

    slow.resolve(makeJsonResponse({
      UI: [{ type: 'Edit', caption: 'Slow', id: 'value' }],
      Config: { value: 'slow' },
    }));
    await request;

    expect(manager.isOpen()).toBe(false);
    expect(manager.configTitle()).toBe('');
    expect(alertSpy).not.toHaveBeenCalled();

    dispose();
  });

  it('promptBeforeRun 会打开启动前配置并在提交后继续', async () => {
    const authFetchMock = vi.mocked(authFetch);
    authFetchMock
      .mockResolvedValueOnce(makeJsonResponse({
        RunOptions: { promptBeforeRun: true },
        UI: [{ type: 'Edit', caption: '账号' }],
        Config: { 账号: 'abc' },
      }))
      .mockResolvedValueOnce(makeJsonResponse({ success: true }));

    let dispose!: () => void;
    const manager = createRoot((rootDispose) => {
      dispose = rootDispose;
      return useScriptConfigManager();
    });

    const pending = manager.ensureGlobalLaunchConfig('demo');
    await Promise.resolve();
    await Promise.resolve();

    expect(manager.isOpen()).toBe(true);
    expect(manager.submitLabel()).toBe('Submit and Start');

    await manager.submitConfig({ 账号: 'abc' });

    await expect(pending).resolves.toBe(true);
    expect(authFetchMock).toHaveBeenLastCalledWith('/api/scripts/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'demo', config: { 账号: 'abc' } }),
    });

    dispose();
  });
});
