// @vitest-environment happy-dom
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n';
import BatchRenameModal, {
  type BatchRenameModalProps,
  type BatchRenameTarget,
} from '../BatchRenameModal';

const flushAsync = () => new Promise(resolve => setTimeout(resolve, 0));

function target(
  udid: string,
  index1: number,
  overrides: Partial<BatchRenameTarget> = {},
): BatchRenameTarget {
  return {
    udid,
    index1,
    devname: `原设备-${index1}`,
    ip: `192.168.1.${20 + index1}`,
    sysversion: '16.7',
    zeversion: '1.2.3',
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(resolver => {
    resolve = resolver;
  });
  return { promise, resolve };
}

function mountModal(overrides: Partial<BatchRenameModalProps> = {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const props: BatchRenameModalProps = {
    open: true,
    targets: [target('modal-default-1', 1)],
    onClose: vi.fn(),
    loadDeviceType: vi.fn(async () => ({ success: true, devtype: 'iPhone15,2' })),
    onSubmit: vi.fn(async () => true),
    ...overrides,
  };
  const dispose = render(() => (
    <I18nProvider defaultLocale="zh-CN">
      <BatchRenameModal {...props} />
    </I18nProvider>
  ), host);

  return {
    props,
    dispose: () => {
      dispose();
      host.remove();
    },
  };
}

function patternInput() {
  return document.querySelector('#batch-rename-pattern') as HTMLInputElement;
}

function submitButton() {
  return document.querySelector('button[type="submit"]') as HTMLButtonElement;
}

function clickButton(text: string) {
  const button = [...document.querySelectorAll('button')]
    .find(candidate => candidate.textContent?.includes(text));
  expect(button, `button containing ${text}`).toBeTruthy();
  button!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return button as HTMLButtonElement;
}

function submitForm() {
  const form = document.querySelector('form');
  expect(form).toBeTruthy();
  form!.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
}

describe('BatchRenameModal', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('默认规则实时更新预览，未使用 devtype 时不读取型号', async () => {
    const loadDeviceType = vi.fn(async () => ({ success: true, devtype: '不应读取' }));
    const { dispose } = mountModal({
      targets: [target('modal-preview-1', 7, { devname: '测试设备', ip: '10.0.0.88' })],
      loadDeviceType,
    });

    await flushAsync();
    expect(patternInput().value).toBe('{devname}');
    expect(document.body.textContent).toContain('测试设备→测试设备');

    patternInput().value = '{devname}-{ip:4}-{index}';
    patternInput().dispatchEvent(new InputEvent('input', { bubbles: true }));
    await flushAsync();

    expect(document.body.textContent).toContain('测试设备→测试设备-88-7');
    expect(loadDeviceType).not.toHaveBeenCalled();
    dispose();
  });

  it('切换示例后按需读取型号，并在读取期间禁用提交', async () => {
    const deviceTypeResult = deferred<{ success: boolean; devtype?: string }>();
    const loadDeviceType = vi.fn(() => deviceTypeResult.promise);
    const { dispose } = mountModal({
      targets: [target('modal-load-1', 2, { ip: '172.16.0.42' })],
      loadDeviceType,
    });

    await flushAsync();
    clickButton('示例');
    await flushAsync();

    expect(patternInput().value).toBe('{devtype}-{ip:4}');
    expect(loadDeviceType).toHaveBeenCalledTimes(1);
    expect(loadDeviceType).toHaveBeenCalledWith('modal-load-1');
    expect(submitButton().disabled).toBe(true);
    expect(submitButton().textContent).toContain('正在读取型号');

    deviceTypeResult.resolve({ success: true, devtype: 'iPhone15,4' });
    await flushAsync();
    await flushAsync();

    expect(submitButton().disabled).toBe(false);
    expect(document.body.textContent).toContain('原设备-2→iPhone15,4-42');
    dispose();
  });

  it('型号读取失败的行会跳过，其他行仍提交', async () => {
    const loadDeviceType = vi.fn(async (udid: string) => udid === 'modal-skip-bad'
      ? { success: false, error: '设备离线' }
      : { success: true, devtype: 'iPad13,18' });
    const onSubmit = vi.fn(async () => false);
    const { dispose } = mountModal({
      targets: [
        target('modal-skip-bad', 3, { ip: '10.0.0.53' }),
        target('modal-skip-good', 4, { ip: '10.0.0.54' }),
      ],
      loadDeviceType,
      onSubmit,
    });

    await flushAsync();
    clickButton('示例');
    await flushAsync();
    await flushAsync();

    expect(document.body.textContent).toContain('设备离线');
    expect(submitButton().disabled).toBe(false);
    submitForm();
    await flushAsync();

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(
      [{ udid: 'modal-skip-good', name: 'iPad13,18-54' }],
      [{ udid: 'modal-skip-bad', name: '-53', error: '设备离线' }],
    );
    dispose();
  });

  it('提交期间忽略关闭、Escape 和重复提交，完成后按回调结果关闭', async () => {
    const submitResult = deferred<boolean>();
    const onSubmit = vi.fn(() => submitResult.promise);
    const onClose = vi.fn();
    const { dispose } = mountModal({
      targets: [target('modal-submit-1', 1)],
      onClose,
      onSubmit,
    });

    await flushAsync();
    submitForm();
    await flushAsync();

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(patternInput().disabled).toBe(true);
    expect(submitButton().disabled).toBe(true);

    const closeButton = document.querySelector('button[aria-label="关闭"]') as HTMLButtonElement;
    expect(closeButton).toBeTruthy();
    closeButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    submitForm();
    await flushAsync();

    expect(onClose).not.toHaveBeenCalled();
    expect(onSubmit).toHaveBeenCalledTimes(1);

    submitResult.resolve(true);
    await flushAsync();
    await flushAsync();

    expect(onClose).toHaveBeenCalledTimes(1);
    dispose();
  });
});
