// @vitest-environment happy-dom
import { createSignal, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider, translate } from '../../i18n';
import { scanEntries } from '../../utils/fileUpload';
import DeviceFileBrowser, { type DeviceFileBrowserProps, type FileItem } from '../DeviceFileBrowser';
import type { SendToCloudModalProps } from '../SendToCloudModal';

const feedback = vi.hoisted(() => ({
  alert: vi.fn(async (_message: string) => {}),
  confirm: vi.fn(async (_message: string) => true),
  prompt: vi.fn(async () => ''),
  showSuccess: vi.fn(), showWarning: vi.fn(), showError: vi.fn(),
}));
vi.mock('../DialogContext', () => ({ useDialog: () => feedback }));
vi.mock('../ToastContext', () => ({ useToast: () => feedback }));
vi.mock('../../utils/fileUpload', () => ({ scanEntries: vi.fn() }));
vi.mock('../SendToCloudModal', () => ({
  default: (props: SendToCloudModalProps) => <Show when={props.isOpen}>
    <div data-testid="send-dialog">
      <span data-testid="scan-count">{props.itemCount}</span>
      <button data-testid="confirm-send" disabled={props.isScanning || !props.itemCount} onClick={() => props.onConfirm('files', 'backup')}>Send</button>
      <button data-testid="cancel-send" onClick={props.onClose}>Cancel send</button>
    </div>
  </Show>,
}));

const file = (name: string, type: FileItem['type'] = 'file'): FileItem => ({ name, type, size: 20 });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function button(key: string) {
  const label = translate('en-US', key);
  const node = [...document.querySelectorAll<HTMLButtonElement>('button')].find(element => element.textContent?.trim() === label);
  expect(node, `button: ${label}`).toBeTruthy();
  return node!;
}

function selectAndPrepareSend() {
  button('common.select_mode').click();
  button('common.select_all').click();
  button('files.send_to_cloud').click();
}

describe('DeviceFileBrowser operation targets', () => {
  let dispose: (() => void) | undefined;

  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    dispose?.();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  async function mount(files: FileItem[], overrides: Partial<DeviceFileBrowserProps> = {}) {
    const [device, setDevice] = createSignal('device-a');
    const [open, setOpen] = createSignal(true);
    const [entries, setEntries] = createSignal(files);
    const props = {
      onListFiles: vi.fn(), onDeleteFile: vi.fn(), onCreateDirectory: vi.fn(),
      onUploadFile: vi.fn(), onDownloadFile: vi.fn(), onMoveFile: vi.fn(),
      onCopyFile: vi.fn(), onReadFile: vi.fn(), onSelectScript: vi.fn(),
      ...overrides,
    };
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <I18nProvider defaultLocale="en-US">
      <DeviceFileBrowser {...props} deviceUdid={device()} deviceName={device()} isOpen={open()}
        onClose={() => setOpen(false)} selectedScript={null} files={entries()} isLoading={false} />
    </I18nProvider>, host);
    await vi.waitFor(() => expect(host.textContent).toContain(files[0].name));
    return { setDevice, setOpen, setEntries, props, host };
  }

  it('已提交的批量回传在切换设备和目录后仍使用原来的六个源路径', async () => {
    const pending = deferred<{ success: boolean }>();
    const pull = vi.fn(() => pending.promise);
    const { setDevice } = await mount(Array.from({ length: 6 }, (_, i) => file(`item-${i}.txt`)), { onPullFileFromDevice: pull });
    selectAndPrepareSend();
    document.querySelector<HTMLButtonElement>('[data-testid="confirm-send"]')!.click();
    expect(pull).toHaveBeenCalledTimes(4);
    button('files.files_root').click();
    setDevice('device-b');
    pending.resolve({ success: true });
    await vi.waitFor(() => expect(pull).toHaveBeenCalledTimes(6));
    expect(pull.mock.calls).toEqual(Array.from({ length: 6 }, (_, i) => ['device-a', `/lua/scripts/item-${i}.txt`, 'files', `backup/item-${i}.txt`]));
  });

  it('确认发送前导航目录仍保留打开对话框时的源目录', async () => {
    const pull = vi.fn(async () => ({ success: true }));
    await mount([file('selected.txt')], { onPullFileFromDevice: pull });
    selectAndPrepareSend();
    button('files.files_root').click();
    document.querySelector<HTMLButtonElement>('[data-testid="confirm-send"]')!.click();
    await vi.waitFor(() => expect(pull).toHaveBeenCalledWith('device-a', '/lua/scripts/selected.txt', 'files', 'backup/selected.txt'));
  });

  it('设备切换后旧目录扫描不能覆盖新设备的待发送内容', async () => {
    const pending = deferred<FileItem[]>();
    const list = vi.fn(() => pending.promise);
    const pull = vi.fn(async () => ({ success: true }));
    const { setDevice, setEntries } = await mount([file('old-folder', 'directory')], { onListFilesAsync: list, onPullFileFromDevice: pull });
    selectAndPrepareSend();
    expect(list).toHaveBeenCalledWith('device-a', '/lua/scripts/old-folder');
    setDevice('device-b');
    setEntries([file('new.txt')]);
    await vi.waitFor(() => expect(document.querySelector('[data-testid="send-dialog"]')).toBeNull());
    selectAndPrepareSend();
    pending.resolve([file('late.txt'), file('nested', 'directory')]);
    await Promise.resolve();
    await Promise.resolve();
    expect(list).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-testid="scan-count"]')?.textContent).toBe('1');
    document.querySelector<HTMLButtonElement>('[data-testid="confirm-send"]')!.click();
    await vi.waitFor(() => expect(pull).toHaveBeenCalledWith('device-b', '/lua/scripts/new.txt', 'files', 'backup/new.txt'));
    expect(pull).toHaveBeenCalledTimes(1);
  });

  it('拖拽扫描及大文件上传等待期间切换设备不改变上传目标', async () => {
    const scan = deferred<Array<{ file: File; relativePath: string }>>();
    const uploading = deferred<void>();
    vi.mocked(scanEntries).mockReturnValue(scan.promise);
    const upload = vi.fn(() => uploading.promise);
    const { setDevice, props, host } = await mount([file('existing.txt')], { onUploadLargeFile: upload });
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { items: [] } });
    host.querySelector('[class*="mainFileList"]')!.dispatchEvent(event);
    setDevice('device-b');
    button('files.files_root').click();
    const first = new File([new Uint8Array(128 * 1024 + 1)], 'same.bin');
    const second = new File(['small'], 'second.txt');
    scan.resolve([{ file: first, relativePath: 'left/same.bin' }, { file: second, relativePath: 'second.txt' }]);
    await vi.waitFor(() => expect(upload).toHaveBeenCalledOnce());
    uploading.resolve();
    await vi.waitFor(() => expect(props.onUploadFile).toHaveBeenCalledOnce());
    expect(upload).toHaveBeenCalledWith('device-a', '/lua/scripts/left/same.bin', first);
    expect(props.onUploadFile).toHaveBeenCalledWith('device-a', '/lua/scripts/second.txt', second);
  });

  it('批量删除确认期间切换设备不会删除新设备的选择项', async () => {
    const pending = deferred<boolean>();
    feedback.confirm.mockReturnValueOnce(pending.promise);
    const { setDevice, setEntries, props } = await mount([file('old.txt')]);
    button('common.select_mode').click();
    button('common.select_all').click();
    button('common.delete').click();
    setDevice('device-b');
    setEntries([file('new.txt')]);
    button('common.select_mode').click();
    button('common.select_all').click();
    pending.resolve(true);
    await vi.waitFor(() => expect(props.onDeleteFile).toHaveBeenCalledOnce());
    expect(props.onDeleteFile).toHaveBeenCalledWith('device-a', '/lua/scripts/old.txt');
    expect(button('files.unselect_all')).toBeTruthy();
  });

  it('保留递归目录结构，导航不会改变后续目录扫描的起点', async () => {
    const pending = deferred<FileItem[]>();
    const list = vi.fn(async (_device: string, path: string) => {
      if (path === '/lua/scripts/first') return pending.promise;
      return [file(path.endsWith('/nested') ? 'deep.txt' : 'last.txt')];
    });
    const pull = vi.fn(async () => ({ success: true }));
    await mount([file('first', 'directory'), file('second', 'directory'), file('loose.txt')], { onListFilesAsync: list, onPullFileFromDevice: pull });
    selectAndPrepareSend();
    button('files.files_root').click();
    pending.resolve([file('nested', 'directory'), file('inside.txt')]);
    await vi.waitFor(() => expect(document.querySelector('[data-testid="scan-count"]')?.textContent).toBe('4'));
    document.querySelector<HTMLButtonElement>('[data-testid="confirm-send"]')!.click();
    await vi.waitFor(() => expect(pull).toHaveBeenCalledTimes(4));
    expect(list.mock.calls).toEqual([
      ['device-a', '/lua/scripts/first'], ['device-a', '/lua/scripts/first/nested'], ['device-a', '/lua/scripts/second'],
    ]);
    expect(pull.mock.calls).toEqual(['loose.txt', 'first/nested/deep.txt', 'first/inside.txt', 'second/last.txt'].map(name => [
      'device-a', `/lua/scripts/${name}`, 'files', `backup/${name}`,
    ]));
  });

  it('取消扫描后迟到结果不能复活对话框或覆盖下一次发送', async () => {
    const pending = deferred<FileItem[]>();
    const list = vi.fn(() => pending.promise);
    const pull = vi.fn(async () => ({ success: true }));
    const { setEntries } = await mount([file('folder', 'directory')], { onListFilesAsync: list, onPullFileFromDevice: pull });
    selectAndPrepareSend();
    document.querySelector<HTMLButtonElement>('[data-testid="cancel-send"]')!.click();
    setEntries([file('new.txt')]);
    button('common.clear_selection').click();
    button('common.select_all').click();
    button('files.send_to_cloud').click();
    pending.resolve([file('nested', 'directory')]);
    await Promise.resolve();
    await Promise.resolve();
    expect(list).toHaveBeenCalledOnce();
    expect(document.querySelector('[data-testid="scan-count"]')?.textContent).toBe('1');
    document.querySelector<HTMLButtonElement>('[data-testid="confirm-send"]')!.click();
    await vi.waitFor(() => expect(pull).toHaveBeenCalledWith('device-a', '/lua/scripts/new.txt', 'files', 'backup/new.txt'));
  });

  it.each(['common.new_file', 'common.new_folder'])('%s 的输入对话框固定创建位置', async action => {
    const pending = deferred<string>();
    feedback.prompt.mockReturnValueOnce(pending.promise);
    const { setDevice, setEntries, props } = await mount([file('existing.txt')]);
    button(action).click();
    setDevice('device-b');
    setEntries([file('created.txt')]);
    button('files.files_root').click();
    pending.resolve('created.txt');
    if (action === 'common.new_file') {
      await vi.waitFor(() => expect(props.onUploadFile).toHaveBeenCalledWith('device-a', '/lua/scripts/created.txt', expect.any(File)));
    } else {
      await vi.waitFor(() => expect(props.onCreateDirectory).toHaveBeenCalledWith('device-a', '/lua/scripts/created.txt'));
    }
  });

  it('重命名对话框固定设备与源目录', async () => {
    const pending = deferred<string>();
    feedback.prompt.mockReturnValueOnce(pending.promise);
    const { setDevice, props, host } = await mount([file('old.txt')]);
    host.querySelector('[class*="fileName"]')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 }));
    button('common.rename').click();
    setDevice('device-b');
    button('files.files_root').click();
    pending.resolve('renamed.txt');
    await vi.waitFor(() => expect(props.onMoveFile).toHaveBeenCalledWith('device-a', '/lua/scripts/old.txt', '/lua/scripts/renamed.txt'));
  });

  it('右键发送单个目录也使用固定目标，并阻止重复提交', async () => {
    const pending = deferred<{ success: boolean }>();
    const pull = vi.fn(() => pending.promise);
    const list = vi.fn(async () => [file('child.txt')]);
    const { host } = await mount([file('folder', 'directory')], { onListFilesAsync: list, onPullFileFromDevice: pull });
    host.querySelector('[class*="fileName"]')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    button('files.send_to_cloud').click();
    await vi.waitFor(() => expect(document.querySelector('[data-testid="scan-count"]')?.textContent).toBe('1'));
    const confirm = document.querySelector<HTMLButtonElement>('[data-testid="confirm-send"]')!;
    confirm.click();
    confirm.click();
    expect(pull).toHaveBeenCalledOnce();
    expect(pull).toHaveBeenCalledWith('device-a', '/lua/scripts/folder/child.txt', 'files', 'backup/folder/child.txt');
    pending.resolve({ success: true });
    await vi.waitFor(() => expect(feedback.showSuccess).toHaveBeenCalledOnce());
  });

  it('拖拽扫描失败会解除忙状态，下一次可以正常上传', async () => {
    vi.mocked(scanEntries).mockRejectedValueOnce(new Error('scan interrupted'));
    const { props, host } = await mount([file('existing.txt')]);
    const drop = () => {
      const event = new Event('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { value: { items: [] } });
      host.querySelector('[class*="mainFileList"]')!.dispatchEvent(event);
    };
    drop();
    await vi.waitFor(() => expect(feedback.showError).toHaveBeenCalledWith('Upload failed: scan interrupted'));
    const content = new File(['retry'], 'retry.txt');
    vi.mocked(scanEntries).mockResolvedValueOnce([{ file: content, relativePath: 'retry.txt' }]);
    drop();
    await vi.waitFor(() => expect(props.onUploadFile).toHaveBeenCalledWith('device-a', '/lua/scripts/retry.txt', content));
  });
});
