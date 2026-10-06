// @vitest-environment happy-dom
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider, translate } from '../../i18n';
import { authFetch } from '../../services/httpAuth';
import { scanEntries, type ScannedFile } from '../../utils/fileUpload';
import ServerFileBrowser from '../ServerFileBrowser';

const feedback = vi.hoisted(() => ({ alert: vi.fn(async (_message: string) => {}), showSuccess: vi.fn(), showError: vi.fn() }));
vi.mock('../DialogContext', () => ({ useDialog: () => feedback }));
vi.mock('../ToastContext', () => ({ useToast: () => feedback }));
vi.mock('../../services/httpAuth', () => ({ authFetch: vi.fn(), appendAuthQuery: (url: string) => url }));
vi.mock('../../utils/fileUpload', () => ({ scanEntries: vi.fn() }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function button(key: string) {
  const label = translate('en-US', key);
  const node = [...document.querySelectorAll<HTMLButtonElement>('button')].find(element => element.textContent?.trim() === label);
  expect(node, label).toBeTruthy();
  return node!;
}
function drop(host: HTMLElement) {
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { items: [] } });
  host.querySelector('[class*="mainFileList"]')!.dispatchEvent(event);
}

describe('ServerFileBrowser upload batches', () => {
  let dispose: (() => void) | undefined;
  let uploads: Array<{ server: string; category: FormDataEntryValue | null; path: FormDataEntryValue | null; name: string }>;
  let archiveCalls: Array<{ url: URL; method: string }>;
  let uploadResponse: () => Promise<Response>;
  let inspectResponse: () => Promise<Response>;
  let installResponse: () => Promise<Response>;

  beforeEach(() => {
    vi.clearAllMocks();
    uploads = [];
    archiveCalls = [];
    uploadResponse = async () => Response.json({ success: true });
    inspectResponse = async () => Response.json({ meta: { name: 'Package' }, installName: 'Package', exists: false });
    installResponse = async () => Response.json({ success: true, name: 'Package' });
    vi.mocked(scanEntries).mockResolvedValue([
      { file: new File(['one'], 'one.txt'), relativePath: 'nested/one.txt' },
      { file: new File(['two'], 'two.txt'), relativePath: 'two.txt' },
    ]);
    vi.mocked(authFetch).mockImplementation(async (url, options) => {
      const parsed = new URL(String(url));
      if (parsed.pathname === '/api/config') return Response.json({ ui: { isLocal: false } });
      if (parsed.pathname === '/api/server-files/list') return Response.json({ files: parsed.searchParams.get('path')
        ? [{ name: 'existing.txt', type: 'file', size: 1 }, { name: 'Package.xxtlca', type: 'file', size: 20 }]
        : [{ name: 'base', type: 'dir', size: 0 }] });
      if (parsed.pathname === '/api/server-files/upload') {
        const form = options!.body as FormData;
        uploads.push({ server: parsed.hostname, category: form.get('category'), path: form.get('path'), name: (form.get('file') as File).name });
        return uploadResponse();
      }
      if (parsed.pathname.includes('/lancontrol-archive/') || parsed.pathname === '/api/server-files/delete') {
        archiveCalls.push({ url: parsed, method: options?.method || 'GET' });
        if (parsed.pathname.endsWith('/inspect')) return inspectResponse();
        if (parsed.pathname.endsWith('/install')) return installResponse();
        return Response.json({ success: true });
      }
      throw new Error(`Unexpected endpoint: ${parsed.pathname}`);
    });
  });
  afterEach(() => {
    dispose?.();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  async function mount() {
    const host = document.createElement('div');
    document.body.append(host);
    const [server, setServer] = createSignal('http://server-a');
    const [open, setOpen] = createSignal(true);
    dispose = render(() => <I18nProvider defaultLocale="en-US"><ServerFileBrowser isOpen={open()} onClose={() => setOpen(false)} serverBaseUrl={server()} /></I18nProvider>, host);
    await vi.waitFor(() => expect(host.textContent).toContain('base'));
    [...host.querySelectorAll('span')].find(node => node.textContent === 'base')!.click();
    await vi.waitFor(() => expect(host.textContent).toContain('existing.txt'));
    return { host, setServer, setOpen };
  }

  it('拖拽扫描前固定服务器和目录，并阻止扫描期间重复提交', async () => {
    const pending = deferred<ScannedFile[]>();
    vi.mocked(scanEntries).mockReturnValueOnce(pending.promise);
    const { host, setServer } = await mount();
    drop(host);
    drop(host);
    expect(scanEntries).toHaveBeenCalledOnce();
    button('files.files_root').click();
    setServer('http://server-b');
    pending.resolve([{ file: new File(['x'], 'file.txt'), relativePath: 'child/file.txt' }]);
    await vi.waitFor(() => expect(uploads).toHaveLength(1));
    expect(uploads[0]).toEqual({ server: 'server-a', category: 'scripts', path: 'base/child', name: 'file.txt' });
  });

  it.each(['category', 'server'])('等待首个上传时切换 %s，后续文件仍发送到原位置', async change => {
    const pending = deferred<Response>();
    uploadResponse = async () => uploads.length === 1 ? pending.promise : Response.json({ success: true });
    const { host, setServer } = await mount();
    drop(host);
    await vi.waitFor(() => expect(uploads).toHaveLength(1));
    if (change === 'category') button('files.files_root').click();
    else setServer('http://server-b');
    const requestCount = vi.mocked(authFetch).mock.calls.length;
    pending.resolve(Response.json({ success: true }));
    await vi.waitFor(() => expect(uploads).toHaveLength(2));
    expect(uploads).toEqual([
      { server: 'server-a', category: 'scripts', path: 'base/nested', name: 'one.txt' },
      { server: 'server-a', category: 'scripts', path: 'base', name: 'two.txt' },
    ]);
    await vi.waitFor(() => expect(host.querySelector('[class*="uploadingOverlay"]')).toBeNull());
    expect(vi.mocked(authFetch).mock.calls.slice(requestCount).filter(([url]) => String(url).includes('/list?'))).toHaveLength(0);
  });

  it('扫描失败显示错误并解除上传状态，之后可以重试', async () => {
    vi.mocked(scanEntries).mockRejectedValueOnce(new Error('directory unavailable'));
    const { host } = await mount();
    drop(host);
    await vi.waitFor(() => expect(feedback.alert).toHaveBeenCalledWith('Upload failed: directory unavailable'));
    await vi.waitFor(() => expect(host.querySelector('[class*="uploadingOverlay"]')).toBeNull());
    drop(host);
    await vi.waitFor(() => expect(uploads).toHaveLength(2));
  });

  it('组件退出后不再派发未开始的文件，也不把旧失败弹到新界面', async () => {
    const pending = deferred<Response>();
    uploadResponse = () => pending.promise;
    const { host } = await mount();
    drop(host);
    await vi.waitFor(() => expect(uploads).toHaveLength(1));
    dispose!();
    dispose = undefined;
    pending.resolve(Response.json({ error: 'old failure' }, { status: 500 }));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(uploads).toHaveLength(1);
    expect(feedback.alert).not.toHaveBeenCalled();
  });

  it('混合安装包与普通文件的批次在安装等待期间也保留原目录', async () => {
    const inspecting = deferred<Response>();
    inspectResponse = () => inspecting.promise;
    vi.mocked(scanEntries).mockResolvedValueOnce([
      { file: new File(['archive'], 'Package.xxtlca'), relativePath: 'Package.xxtlca' },
      { file: new File(['extra'], 'extra.txt'), relativePath: 'extra.txt' },
    ]);
    const { host } = await mount();
    drop(host);
    await vi.waitFor(() => expect(archiveCalls).toHaveLength(1));
    button('files.files_root').click();
    inspecting.resolve(Response.json({ meta: { name: 'Package' }, installName: 'Package' }));
    await vi.waitFor(() => expect(button('archive.install')).toBeTruthy());
    button('archive.install').click();
    await vi.waitFor(() => expect(uploads).toHaveLength(1));
    expect(archiveCalls.map(call => call.url.hostname)).toEqual(['server-a', 'server-a']);
    expect(uploads[0]).toEqual({ server: 'server-a', category: 'scripts', path: 'base', name: 'extra.txt' });
  });

  it('关闭浏览器后迟到的安装包检查不会重新打开安装弹窗', async () => {
    const inspecting = deferred<Response>();
    inspectResponse = () => inspecting.promise;
    vi.mocked(scanEntries).mockResolvedValueOnce([{ file: new File(['archive'], 'Package.xxtlca'), relativePath: 'Package.xxtlca' }]);
    const { host, setOpen } = await mount();
    drop(host);
    await vi.waitFor(() => expect(archiveCalls).toHaveLength(1));
    setOpen(false);
    setOpen(true);
    inspecting.resolve(Response.json({ meta: { name: 'Package' }, installName: 'Package' }));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(host.querySelector('[class*="archiveModal"]')).toBeNull();
    expect(archiveCalls).toHaveLength(1);
  });

  it('安装已提交后切换服务器，删除安装包仍使用原服务器和路径', async () => {
    const installing = deferred<Response>();
    installResponse = () => installing.promise;
    const { host, setServer } = await mount();
    [...host.querySelectorAll('span')].find(node => node.textContent === 'Package.xxtlca')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await vi.waitFor(() => expect(button('archive.install')).toBeTruthy());
    button('archive.install').click();
    await vi.waitFor(() => expect(archiveCalls).toHaveLength(2));
    setServer('http://server-b');
    installing.resolve(Response.json({ success: true, name: 'Package' }));
    await vi.waitFor(() => expect(archiveCalls).toHaveLength(3));
    expect(archiveCalls.every(call => call.url.hostname === 'server-a')).toBe(true);
    expect(archiveCalls[2].url.searchParams.get('path')).toBe('base/Package.xxtlca');
    expect(feedback.showSuccess).not.toHaveBeenCalled();
  });
});
