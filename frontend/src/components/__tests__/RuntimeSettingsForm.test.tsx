// @vitest-environment happy-dom
import { createSignal } from 'solid-js';
import RuntimeSettingsModal from '../RuntimeSettingsModal';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n';
import RuntimeSettingsForm from '../RuntimeSettingsForm';
import { RuntimeSettingsService } from '../../services/runtimeSettingsService';
import { RuntimeStatus, RuntimeSettingsError, prepareRuntimeChange } from '../../services/runtimeSettingsProtocol';

const initial = (id: string, port = 46952): RuntimeStatus => ({
  ok: true, deviceid: id, ready: true, revision: 4, profile_generation: 1,
  document_path: '/var/mobile/Media/1ferver', configuration_path: '/var/mobile/Media/1ferver/1ferver.conf',
  active: { port, udp_port: port + 1, webdav_port: 0, log_port: port + 5 },
});
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const disposers: Array<() => void> = [];
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key), clear: () => values.clear() });
});
afterEach(() => { disposers.splice(0).forEach(dispose => dispose()); document.body.innerHTML = ''; vi.useRealTimers(); vi.unstubAllGlobals(); });
const serviceFor = (adapter: ConstructorParameters<typeof RuntimeSettingsService>[1]) => {
  const service = new RuntimeSettingsService(adapter);
  disposers.push(() => service.dispose());
  return service;
};
const click = (label: string) => {
  const button = Array.from(document.querySelectorAll('button')).find(element => element.textContent === label)!;
  expect(button, label).toBeTruthy(); button.click();
};

describe('runtime settings submission', () => {
  it('finishes after sending once without polling or saving a pending operation', async () => {
    const apply = vi.fn(); const read = vi.fn();
    const service = serviceFor({ apply, read });
    await service.submit(prepareRuntimeChange('one', initial('one'), { log_port: 0 }));
    expect(apply).toHaveBeenCalledTimes(1);
    expect(service.get('one')?.state).toBe('submitted');
    expect(read).not.toHaveBeenCalled();
    expect(localStorage.getItem('runtime-test')).toBeNull();
  });
  it('ignores old pending records when the service is recreated', async () => {
    const change = prepareRuntimeChange('one', initial('one'), { log_port: 0 });
    localStorage.setItem('runtime-test', JSON.stringify([{ ...change, state: 'querying' }]));
    const apply = vi.fn(); const read = vi.fn();
    const service = serviceFor({ apply, read });
    await flush();
    expect(apply).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
    await service.submit(change);
    expect(service.get('one')?.state).toBe('submitted');
    expect(apply).toHaveBeenCalledTimes(1);
  });
  it('reports send errors without starting a retry or confirmation timer', async () => {
    vi.useFakeTimers();
    const apply = vi.fn(() => { throw new Error('WebSocket disconnected'); });
    const read = vi.fn();
    const service = serviceFor({ apply, read });
    await service.submit(prepareRuntimeChange('one', initial('one'), { log_port: 0 }));
    expect(service.get('one')).toMatchObject({ state: 'failed', error: 'WebSocket disconnected' });
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(300001);
    expect(read).not.toHaveBeenCalled(); expect(apply).toHaveBeenCalledTimes(1);
  });
  it('prevents duplicate sends for the same device while other devices can submit', async () => {
    let finish!: () => void;
    const apply = vi.fn((id: string) => id === 'one' ? new Promise<void>(resolve => finish = resolve) : undefined);
    const service = serviceFor({ apply, read: vi.fn() });
    const change = prepareRuntimeChange('one', initial('one'), { log_port: 0 });
    const pending = service.submit(change);
    await expect(service.submit(change)).rejects.toBeInstanceOf(RuntimeSettingsError);
    await service.submit(prepareRuntimeChange('two', initial('two'), { log_port: 0 }));
    expect(service.get('two')?.state).toBe('submitted');
    finish(); await pending;
    expect(service.get('one')?.state).toBe('submitted');
    expect(apply).toHaveBeenCalledTimes(2);
  });
});

describe('runtime settings batch preview', () => {
  it('retains unselected per-device fields, skips unsupported devices, and preserves the input node', async () => {
    const apply = vi.fn(async () => {});
    const service = serviceFor({ apply, read: async id => {
      if (id === 'old') throw new RuntimeSettingsError('unsupported', 'unsupported');
      return initial(id, id === 'one' ? 46952 : 50152);
    } });
    const host = document.createElement('div'); document.body.appendChild(host);
    disposers.push(render(() => <I18nProvider defaultLocale="zh-CN"><RuntimeSettingsForm
      targets={[{ id: 'one', name: '第一台' }, { id: 'two', name: '第二台' }, { id: 'old', name: '旧设备' }]}
      service={service} concurrency={2} onClose={() => {}}
    /></I18nProvider>, host));
    await flush();
    expect(host.textContent).toContain('不支持此功能');
    expect(host.textContent).not.toContain('恢复默认端口');
    const selected = host.querySelector('input[type=checkbox][aria-label="日志端口"]') as HTMLInputElement;
    selected.checked = true; selected.dispatchEvent(new Event('change', { bubbles: true }));
    const input = host.querySelector('#runtime-log_port') as HTMLInputElement;
    input.focus(); input.value = '0'; input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(host.querySelector('#runtime-log_port')).toBe(input); expect(document.activeElement).toBe(input);
    click('应用'); await flush();
    expect(apply).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain('已发起');
    expect(host.textContent).not.toContain('继续查询');
    expect(host.textContent).not.toContain('等待设备恢复');
    const calls = apply.mock.calls as unknown as Array<[string, any]>;
    expect(calls[0][1].settings).toEqual({ port: 46952, udp_port: 46953, webdav_port: 0, log_port: 0 });
    expect(calls[1][1].settings).toEqual({ port: 50152, udp_port: 50153, webdav_port: 0, log_port: 0 });
    expect(calls.every(([, request]) => request.expected_revision === 4 && !('use_device_directory' in request))).toBe(true);
  });
  it('allows a corrected port preview after validation failed', async () => {
    const service = serviceFor({ apply: async () => {}, read: async id => initial(id) });
    const host = document.createElement('div'); document.body.appendChild(host);
    disposers.push(render(() => <I18nProvider defaultLocale="zh-CN"><RuntimeSettingsForm targets={[{ id: 'one', name: '第一台' }]} service={service} concurrency={1} onClose={() => {}} /></I18nProvider>, host));
    await flush();
    const input = host.querySelector('#runtime-port') as HTMLInputElement;
    input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })); click('预览变化');
    expect(host.textContent).toContain('端口无效');
    input.value = '50152'; input.dispatchEvent(new Event('input', { bubbles: true })); click('预览变化');
    expect(host.textContent).not.toContain('端口无效');
    expect(host.textContent).toContain('46952 → 50152');
  });
});

describe('runtime settings modal interactions', () => {
  function mountModal(service: RuntimeSettingsService, onClose = vi.fn()) {
    const host = document.createElement('div'); document.body.appendChild(host);
    const trigger = document.createElement('button'); document.body.appendChild(trigger); trigger.focus();
    function Fixture() {
      const [open, setOpen] = createSignal(true);
      return <I18nProvider defaultLocale="zh-CN"><RuntimeSettingsModal
        open={open()} targets={[{ id: 'one', name: '第一台' }]} service={service}
        onClose={() => { onClose(); setOpen(false); }}
      /></I18nProvider>;
    }
    disposers.push(render(() => <Fixture />, host));
    return { host, trigger, onClose };
  }

  it('dismisses with Escape and returns focus without submitting', async () => {
    const apply = vi.fn(async () => {});
    const service = serviceFor({ apply, read: async id => initial(id) });
    const { host, trigger, onClose } = mountModal(service);
    await flush();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[role=dialog]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(apply).not.toHaveBeenCalled();
  });

  it('dismisses only when a pointer press starts and ends on the backdrop', async () => {
    const service = serviceFor({ apply: async () => {}, read: async id => initial(id) });
    const { host, onClose } = mountModal(service);
    await flush();
    const dialog = host.querySelector('[role=dialog]')!;
    const backdrop = dialog.parentElement!;
    const pointer = (element: Element, type: string) => element.dispatchEvent(new MouseEvent(type, { bubbles: true }));
    pointer(dialog, 'mousedown'); pointer(backdrop, 'mouseup');
    expect(onClose).not.toHaveBeenCalled();
    pointer(backdrop, 'mousedown'); pointer(dialog, 'mouseup');
    expect(onClose).not.toHaveBeenCalled();
    pointer(backdrop, 'mousedown'); pointer(backdrop, 'mouseup');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps Tab focus within the dialog', async () => {
    const service = serviceFor({ apply: async () => {}, read: async id => initial(id) });
    const { host } = mountModal(service);
    await flush();
    const dialog = host.querySelector('[role=dialog]')!;
    const first = dialog.querySelector('button') as HTMLButtonElement;
    const last = Array.from(dialog.querySelectorAll('button:not(:disabled)')).at(-1) as HTMLButtonElement;
    first.focus(); first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(last);
    last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(first);
  });

  it('finishes sending after the dialog closes without waiting for the device', async () => {
    const before = initial('one');
    let finishApply: () => void = () => {};
    const apply = vi.fn(() => new Promise<void>(resolve => { finishApply = resolve; }));
    const service = serviceFor({ apply, read: async () => apply.mock.calls.length ? { ...before, revision: 5 } : before });
    const { host } = mountModal(service);
    await flush(); click('预览变化'); click('应用'); await flush();
    expect(apply).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(host.querySelector('[role=dialog]')).toBeNull();
    finishApply(); await flush();
    expect(service.get('one')?.state).toBe('submitted');
    expect(apply).toHaveBeenCalledTimes(1);
  });
});

describe('runtime settings direct apply', () => {
  function mountForm(service: RuntimeSettingsService) {
    const host = document.createElement('div'); document.body.appendChild(host);
    disposers.push(render(() => <I18nProvider defaultLocale="zh-CN"><RuntimeSettingsForm
      targets={[{ id: 'one', name: '第一台' }]} service={service} concurrency={1} onClose={() => {}}
    /></I18nProvider>, host));
    const button = Array.from(host.querySelectorAll('button')).find(element => element.textContent === '应用')!;
    return { host, button };
  }

  it('applies valid ports including disabled optional services without previewing', async () => {
    const apply = vi.fn(async () => undefined);
    const service = serviceFor({ apply, read: async id => ({ ...initial(id), profile_generation: 2 }) });
    const { host, button } = mountForm(service);
    await flush();
    for (const [key, value] of Object.entries({ port: 56952, udp_port: 0, webdav_port: 0, log_port: 0 })) {
      const input = host.querySelector(`#runtime-${key}`) as HTMLInputElement;
      input.value = String(value); input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    expect(button.disabled).toBe(false);
    button.click(); await flush();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith('one', {
      expected_revision: 4, settings: { port: 56952, udp_port: 0, webdav_port: 0, log_port: 0 },
    });
  });

  it('submits the current input after editing an earlier preview', async () => {
    const apply = vi.fn(async () => undefined);
    const service = serviceFor({ apply, read: async id => initial(id) });
    const { host, button } = mountForm(service);
    await flush(); click('预览变化');
    const input = host.querySelector('#runtime-port') as HTMLInputElement;
    input.value = '56952'; input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(button.disabled).toBe(false);
    button.click(); await flush();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith('one', {
      expected_revision: 4, settings: { ...initial('one').active, port: 56952 },
    });
  });

  it.each(['', '0', '9999', '65536', '46957'])('rejects invalid API port %j and enables apply as soon as it is corrected', async invalid => {
    const apply = vi.fn(async () => undefined);
    const service = serviceFor({ apply, read: async id => initial(id) });
    const { host, button } = mountForm(service);
    await flush();
    const input = host.querySelector('#runtime-port') as HTMLInputElement;
    input.value = invalid; input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(button.disabled).toBe(true);
    expect(host.textContent).toContain('端口无效');
    button.click(); expect(apply).not.toHaveBeenCalled();
    input.value = '56952'; input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(button.disabled).toBe(false);
    expect(host.textContent).not.toContain('端口无效');
    button.click(); await flush();
    expect(apply).toHaveBeenCalledTimes(1);
  });


  it.each([1, 2])('restores only ports for directory mode %i and waits for Apply', async profileGeneration => {
    const before = { ...initial('one', 50152), profile_generation: profileGeneration,
      active: { port: 50152, udp_port: 0, webdav_port: 0, log_port: 0 } };
    const apply = vi.fn(async () => undefined);
    const service = serviceFor({ apply, read: async () => before });
    const { host, button } = mountForm(service);
    await flush(); click('预览变化');
    expect(host.textContent).toContain('→');
    click('恢复默认端口');
    const settings = { port: 46952, udp_port: 46953, webdav_port: 46953, log_port: 46957 };
    for (const [key, value] of Object.entries(settings)) {
      expect((host.querySelector(`#runtime-${key}`) as HTMLInputElement).value).toBe(String(value));
    }
    expect(host.textContent).not.toContain('→');
    expect(button.disabled).toBe(false);
    expect(apply).not.toHaveBeenCalled();
    button.click(); await flush();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith('one', { expected_revision: 4, settings });
  });

  it('clears invalid ports on restore and submits edits made afterwards', async () => {
    const apply = vi.fn(async () => undefined);
    const service = serviceFor({ apply, read: async id => initial(id) });
    const { host, button } = mountForm(service);
    await flush();
    const input = host.querySelector('#runtime-port') as HTMLInputElement;
    input.value = '0'; input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(host.textContent).toContain('端口无效');
    expect(button.disabled).toBe(true);
    click('恢复默认端口');
    expect(host.textContent).not.toContain('端口无效');
    expect(button.disabled).toBe(false);
    expect(apply).not.toHaveBeenCalled();
    expect(host.querySelector('#runtime-port')).toBe(input);
    input.value = '56952'; input.dispatchEvent(new Event('input', { bubbles: true }));
    button.click(); await flush();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith('one', { expected_revision: 4,
      settings: { port: 56952, udp_port: 46953, webdav_port: 46953, log_port: 46957 } });
  });

  it('blocks apply during loading and submitting and sends only once for repeated clicks', async () => {
    let finishRead!: (status: RuntimeStatus) => void;
    let finishApply!: () => void;
    const read = vi.fn(async (id: string) => initial(id));
    read.mockImplementationOnce(() => new Promise<RuntimeStatus>(resolve => { finishRead = resolve; }));
    const apply = vi.fn(async () => { await new Promise<void>(resolve => { finishApply = resolve; }); return undefined; });
    const service = serviceFor({ apply, read });
    const { host, button } = mountForm(service);
    const restore = Array.from(host.querySelectorAll('button')).find(element => element.textContent === '恢复默认端口')!;
    expect(button.disabled).toBe(true);
    expect(restore.disabled).toBe(true);
    finishRead(initial('one')); await flush();
    expect(button.disabled).toBe(false);
    expect(restore.disabled).toBe(false);
    button.click(); button.click(); await flush();
    expect(button.disabled).toBe(true);
    expect(restore.disabled).toBe(true);
    expect(apply).toHaveBeenCalledTimes(1);
    finishApply(); await flush();
    expect(button.disabled).toBe(false);
    expect(restore.disabled).toBe(false);
    read.mockImplementationOnce(() => new Promise<RuntimeStatus>(resolve => { finishRead = resolve; }));
    click('刷新');
    expect(button.disabled).toBe(true);
    expect(restore.disabled).toBe(true);
    finishRead({ ...initial('one'), busy: true }); await flush();
    expect(button.disabled).toBe(true);
    expect(host.textContent).toContain('设备正在更新配置');
  });
});
