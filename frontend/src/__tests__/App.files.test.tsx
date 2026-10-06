// @vitest-environment happy-dom
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { I18nProvider, translate } from '../i18n';
import { authFetch } from '../services/httpAuth';

const feedback = vi.hoisted(() => ({ showError: vi.fn(), alert: vi.fn(async (_message: string) => {}) }));
vi.mock('../components/ToastContext', () => ({ useToast: () => ({ showError: feedback.showError, showSuccess: vi.fn(), showWarning: vi.fn() }) }));
vi.mock('../components/DialogContext', () => ({ useDialog: () => ({ alert: feedback.alert, confirm: vi.fn(async () => false) }) }));
vi.mock('../components/ThemeContext', () => ({ useTheme: () => ({ themeMode: () => 'system', cycleTheme: vi.fn() }) }));
vi.mock('../components/LoginForm', () => ({ default: (props: any) => <button data-testid="login" onClick={() => props.onLogin({ server: 'server-a', port: '46980', password: 'test-only' })}>Log in</button> }));
vi.mock('../components/DeviceList', () => ({ default: (props: any) => <>
  <button data-testid="open-a" onClick={() => props.onOpenFileBrowser('device-a', 'Device A')}>Open A</button>
  <button data-testid="open-b" onClick={() => props.onOpenFileBrowser('device-b', 'Device B')}>Open B</button>
</> }));
vi.mock('../components/GroupList', () => ({ default: () => null }));
vi.mock('../services/httpAuth', () => ({ authFetch: vi.fn(), setApiBaseUrl: vi.fn() }));

class Socket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;
  static instances: Socket[] = [];
  readyState = Socket.CONNECTING;
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  onclose?: (event: { code: number }) => void;
  sent: any[] = [];

  constructor() {
    Socket.instances.push(this);
    queueMicrotask(() => { this.readyState = Socket.OPEN; this.onopen?.(); });
  }

  send(data: string) {
    const message = JSON.parse(data);
    this.sent.push(message);
    if (message.type === 'control/devices') queueMicrotask(() => this.receive({ type: 'control/devices', body: {
      'device-a': { system: { name: 'Device A' } }, 'device-b': { system: { name: 'Device B' } },
    } }));
  }

  receive(message: any) { this.onmessage?.({ data: JSON.stringify(message) }); }
  close(code = 1000) { this.readyState = Socket.CLOSED; this.onclose?.({ code }); }
}

const file = (name: string, type = 'file') => ({ name, type, size: 20 });

function button(key: string) {
  const label = translate('en-US', key);
  const node = [...document.querySelectorAll<HTMLButtonElement>('button')].find(element => element.textContent?.trim() === label);
  expect(node, `button: ${label}`).toBeTruthy();
  return node!;
}

describe('App device file responses', () => {
  let dispose: (() => void) | undefined;
  let downloads: Array<{ name: string; blob: Blob }>;
  let latestBlob: Blob;

  beforeEach(() => {
    Socket.instances = [];
    downloads = [];
    feedback.showError.mockClear();
    feedback.alert.mockClear();
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
    vi.stubGlobal('WebSocket', Socket);
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ version: 'test' })));
    vi.mocked(authFetch).mockResolvedValue(Response.json({ success: true, groups: [], settings: {} }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { latestBlob = blob as Blob; return 'blob:test-file'; });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push({ name: this.download, blob: latestBlob });
    });
  });

  afterEach(() => {
    dispose?.();
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  function requests(type: string) {
    return Socket.instances[0].sent.filter(message => message.type === 'control/command' && message.body.type === type);
  }

  function reply(request: any, body: unknown, error?: string) {
    Socket.instances[0].receive({ type: request.body.type, requestId: request.body.requestId, udid: request.body.devices[0], body, error });
  }

  async function open() {
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <I18nProvider defaultLocale="en-US"><App /></I18nProvider>, host);
    await vi.waitFor(() => expect(document.querySelector('[data-testid="login"]')).toBeTruthy());
    document.querySelector<HTMLButtonElement>('[data-testid="login"]')!.click();
    await vi.waitFor(() => expect(document.querySelector('[data-testid="open-a"]')).toBeTruthy());
    document.querySelector<HTMLButtonElement>('[data-testid="open-a"]')!.click();
    await vi.waitFor(() => expect(requests('file/list')).toHaveLength(1));
    return host;
  }

  async function contextAction(name: string, action: string) {
    await vi.waitFor(() => expect([...document.querySelectorAll('span')].some(node => node.textContent === name)).toBe(true));
    [...document.querySelectorAll('span')].find(node => node.textContent === name)!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 }));
    button(action).click();
  }

  it('目录请求乱序返回时只显示最后导航的目录', async () => {
    const host = await open();
    button('files.files_root').click();
    button('files.logs_root').click();
    const lists = requests('file/list');
    reply(lists[2], [file('latest.txt')]);
    await vi.waitFor(() => expect(host.textContent).toContain('latest.txt'));
    reply(lists[1], [file('old-res.txt')]);
    reply(lists[0], [file('old-scripts.txt')]);
    await Promise.resolve();
    expect(host.textContent).toContain('latest.txt');
    expect(host.textContent).not.toContain('old-res.txt');
    expect(host.textContent).not.toContain('old-scripts.txt');
  });

  it('切换设备后旧设备回包不能覆盖当前文件列表', async () => {
    const host = await open();
    const old = requests('file/list')[0];
    document.querySelector<HTMLButtonElement>('[data-testid="open-b"]')!.click();
    const latest = requests('file/list').at(-1);
    reply(latest, [file('device-b.txt')]);
    await vi.waitFor(() => expect(host.textContent).toContain('device-b.txt'));
    reply(old, [file('device-a.txt')]);
    await Promise.resolve();
    expect(host.textContent).toContain('device-b.txt');
    expect(host.textContent).not.toContain('device-a.txt');
  });

  it('后台目录扫描不替换可见列表，读取失败会中止发送', async () => {
    const host = await open();
    reply(requests('file/list')[0], [file('folder', 'dir'), file('loose.txt')]);
    await vi.waitFor(() => expect(host.textContent).toContain('folder'));
    button('common.select_mode').click();
    button('common.select_all').click();
    button('files.send_to_cloud').click();
    reply(requests('file/list').at(-1), [file('nested', 'dir'), file('child.txt')]);
    await vi.waitFor(() => expect(requests('file/list')).toHaveLength(3));
    expect(host.querySelector('[class*="mainFileList"]')!.textContent).toContain('folder');
    expect(host.querySelector('[class*="mainFileList"]')!.textContent).not.toContain('child.txt');
    reply(requests('file/list').at(-1), undefined, 'permission denied');
    await vi.waitFor(() => expect(feedback.alert).toHaveBeenCalledWith('Load failed: permission denied'));
    expect(vi.mocked(authFetch).mock.calls.some(([url]) => String(url).includes('pull-from-device'))).toBe(false);
  });

  it('编辑和小文件下载乱序回包时不互换文件内容', async () => {
    const host = await open();
    reply(requests('file/list')[0], [file('edit.lua'), file('download.bin')]);
    await contextAction('download.bin', 'common.download');
    await contextAction('edit.lua', 'common.edit');
    const [download, edit] = requests('file/get');
    reply(edit, btoa('return 42\n'));
    reply(download, btoa('binary payload'));
    await vi.waitFor(() => expect(host.querySelector('textarea')?.value).toBe('return 42\n'));
    expect(downloads).toHaveLength(1);
    expect(downloads[0].name).toBe('download.bin');
    expect(await downloads[0].blob.text()).toBe('binary payload');
  });

  it('同一文件关闭重开后旧读取不能覆盖新编辑内容', async () => {
    const host = await open();
    reply(requests('file/list')[0], [file('edit.lua')]);
    await contextAction('edit.lua', 'common.edit');
    const first = requests('file/get')[0];
    button('common.cancel').click();
    await contextAction('edit.lua', 'common.edit');
    reply(requests('file/get').at(-1), btoa('current text'));
    await vi.waitFor(() => expect(host.querySelector('textarea')?.value).toBe('current text'));
    const editor = host.querySelector('textarea')!;
    editor.value = 'user changed text';
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    reply(first, btoa('obsolete text'));
    await Promise.resolve();
    expect(host.querySelector('textarea')).toBe(editor);
    expect(editor.value).toBe('user changed text');
  });

  it('空文件正常打开，加载期间不允许保存占位文本', async () => {
    const host = await open();
    reply(requests('file/list')[0], [file('empty.lua')]);
    await contextAction('empty.lua', 'common.edit');
    expect(button('common.save').disabled).toBe(true);
    reply(requests('file/get')[0], '');
    await vi.waitFor(() => expect(host.querySelector('textarea')?.value).toBe(''));
    expect(button('common.save').disabled).toBe(false);
  });

  it('目录读取失败显示错误并结束加载状态', async () => {
    const host = await open();
    reply(requests('file/list')[0], undefined, 'permission denied');
    await vi.waitFor(() => expect(feedback.showError).toHaveBeenCalledWith('Load failed: permission denied'));
    expect(host.querySelector('[class*="loading"]')).toBeNull();
  });

  it('大文件上传完成后刷新当前目录，不猜测不存在的文件路径字段', async () => {
    await open();
    button('files.files_root').click();
    reply(requests('file/list').at(-1), [file('existing.bin')]);
    Socket.instances[0].receive({ type: 'transfer/fetch/complete', udid: 'device-a', body: { success: true, targetPath: '/res/new.bin' } });
    expect(requests('file/list').at(-1).body.body.path).toBe('/res');
  });

  it('浏览器关闭重开后同一设备的旧目录请求也会失效', async () => {
    const host = await open();
    const old = requests('file/list')[0];
    host.querySelector<HTMLButtonElement>('button[class*="closeButton"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-testid="open-a"]')!.click();
    reply(requests('file/list').at(-1), [file('new-session.txt')]);
    await vi.waitFor(() => expect(host.textContent).toContain('new-session.txt'));
    reply(old, [file('old-session.txt')]);
    await Promise.resolve();
    expect(host.textContent).toContain('new-session.txt');
    expect(host.textContent).not.toContain('old-session.txt');
  });

  it('两台设备同一路径的编辑请求不会互相覆盖', async () => {
    const host = await open();
    reply(requests('file/list')[0], [file('shared.lua')]);
    await contextAction('shared.lua', 'common.edit');
    const old = requests('file/get')[0];
    document.querySelector<HTMLButtonElement>('[data-testid="open-b"]')!.click();
    reply(requests('file/list').at(-1), [file('shared.lua')]);
    await contextAction('shared.lua', 'common.edit');
    reply(requests('file/get').at(-1), btoa('device B content'));
    await vi.waitFor(() => expect(host.querySelector('textarea')?.value).toBe('device B content'));
    reply(old, btoa('device A content'));
    await Promise.resolve();
    expect(host.querySelector('textarea')?.value).toBe('device B content');
  });

  it('其它控制端的 file/get 回包不能消费本地下载请求', async () => {
    const host = await open();
    reply(requests('file/list')[0], [file('small.bin')]);
    await contextAction('small.bin', 'common.download');
    const requested = requests('file/get')[0];
    Socket.instances[0].receive({ type: 'file/get', udid: 'device-a', requestId: 'another-controller', body: btoa('unrelated') });
    await Promise.resolve();
    expect(downloads).toHaveLength(0);
    reply(requested, btoa('correct payload'));
    await vi.waitFor(() => expect(downloads).toHaveLength(1));
    expect(await downloads[0].blob.text()).toBe('correct payload');
    expect(host.querySelector('textarea')).toBeNull();
  });

  it('编辑读取失败关闭占位编辑器，之后可以重新打开', async () => {
    const host = await open();
    reply(requests('file/list')[0], [file('edit.lua')]);
    await contextAction('edit.lua', 'common.edit');
    reply(requests('file/get')[0], undefined, 'file unavailable');
    await vi.waitFor(() => expect(feedback.alert).toHaveBeenCalledWith('Read failed: file unavailable'));
    expect(host.querySelector('textarea')).toBeNull();
    await contextAction('edit.lua', 'common.edit');
    reply(requests('file/get').at(-1), btoa(unescape(encodeURIComponent('中文内容\n'))));
    await vi.waitFor(() => expect(host.querySelector('textarea')?.value).toBe('中文内容\n'));
    expect(button('common.save').disabled).toBe(false);
  });

  it('旧保存成功回执不会关闭后来打开的编辑器', async () => {
    const host = await open();
    reply(requests('file/list')[0], [file('first.lua'), file('second.lua')]);
    await contextAction('first.lua', 'common.edit');
    reply(requests('file/get')[0], btoa('first version'));
    await vi.waitFor(() => expect(host.querySelector('textarea')?.value).toBe('first version'));
    const editor = host.querySelector('textarea')!;
    editor.value = 'saved contents';
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    button('common.save').click();
    await vi.waitFor(() => expect(requests('file/put')).toHaveLength(1));
    expect(requests('file/put')[0].body.body).toEqual({ path: '/lua/scripts/first.lua', data: btoa('saved contents') });
    button('common.cancel').click();
    await contextAction('second.lua', 'common.edit');
    reply(requests('file/get').at(-1), btoa('second contents'));
    await vi.waitFor(() => expect(host.querySelector('textarea')?.value).toBe('second contents'));
    reply(requests('file/put')[0], { path: '/lua/scripts/first.lua' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(host.querySelector('textarea')?.value).toBe('second contents');
    expect(button('common.save').disabled).toBe(false);
  });

  it('保存被拒绝后保留可编辑草稿，重试成功才关闭', async () => {
    const host = await open();
    reply(requests('file/list')[0], [file('edit.lua')]);
    await contextAction('edit.lua', 'common.edit');
    reply(requests('file/get')[0], btoa('original text'));
    await vi.waitFor(() => expect(host.querySelector('textarea')?.value).toBe('original text'));
    const editor = host.querySelector('textarea')!;
    editor.value = 'unsaved draft';
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    button('common.save').click();
    await vi.waitFor(() => expect(requests('file/put')).toHaveLength(1));
    const put = requests('file/put')[0];
    Socket.instances[0].receive({ type: 'file/put', udid: 'device-a', requestId: put.body.requestId,
      body: { path: put.body.body.path }, error: 'file transfer already in progress', errorCode: 'error.transfer.file_busy' });
    await vi.waitFor(() => expect(feedback.showError).toHaveBeenCalledTimes(1));
    expect(feedback.showError).toHaveBeenCalledWith(expect.stringContaining('Save failed:'));
    await new Promise(resolve => setTimeout(resolve, 850));
    expect(host.querySelector('textarea')).toBe(editor);
    expect(editor.value).toBe('unsaved draft');
    expect(editor.readOnly).toBe(false);
    expect(button('common.save').disabled).toBe(false);
    editor.value = 'corrected draft';
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    button('common.save').click();
    await vi.waitFor(() => expect(requests('file/put')).toHaveLength(2));
    const retry = requests('file/put')[1];
    expect(atob(retry.body.body.data)).toBe('corrected draft');
    reply(retry, { path: '/lua/scripts/edit.lua' });
    await vi.waitFor(() => expect(host.querySelector('textarea')).toBeNull());
    expect(feedback.showError).toHaveBeenCalledTimes(1);
  });

  it('保存等待超过原来的关闭延迟，且不接受其它设备和请求的成功回包', async () => {
    const host = await open();
    reply(requests('file/list')[0], [file('edit.lua')]);
    await contextAction('edit.lua', 'common.edit');
    reply(requests('file/get')[0], btoa('keep until saved'));
    await vi.waitFor(() => expect(host.querySelector('textarea')?.readOnly).toBe(false));
    button('common.save').click();
    await vi.waitFor(() => expect(requests('file/put')).toHaveLength(1));
    const put = requests('file/put')[0];
    Socket.instances[0].receive({ type: 'file/put', udid: 'device-b', requestId: put.body.requestId, body: put.body.body });
    Socket.instances[0].receive({ type: 'file/put', udid: 'device-a', requestId: 'another-save', body: put.body.body });
    await new Promise(resolve => setTimeout(resolve, 850));
    expect(host.querySelector('textarea')?.value).toBe('keep until saved');
    expect(host.querySelector('textarea')?.readOnly).toBe(true);
    expect(button('files.saving').disabled).toBe(true);
    expect(requests('file/list')).toHaveLength(1);
    reply(put, { path: '/lua/scripts/edit.lua' });
    await vi.waitFor(() => expect(host.querySelector('textarea')).toBeNull());
  });

  it('保存期间断线会保留草稿并解除保存状态', async () => {
    const host = await open();
    reply(requests('file/list')[0], [file('edit.lua')]);
    await contextAction('edit.lua', 'common.edit');
    reply(requests('file/get')[0], btoa('draft on disconnect'));
    await vi.waitFor(() => expect(host.querySelector('textarea')?.readOnly).toBe(false));
    button('common.save').click();
    await vi.waitFor(() => expect(requests('file/put')).toHaveLength(1));
    Socket.instances[0].close();
    await vi.waitFor(() => expect(feedback.showError).toHaveBeenCalledWith(expect.stringContaining('Save failed:')));
    expect(host.querySelector('textarea')?.value).toBe('draft on disconnect');
    expect(host.querySelector('textarea')?.readOnly).toBe(false);
    expect(button('common.save').disabled).toBe(false);
  });

  it('旧保存失败不会干扰重开的编辑器，未关联的文件操作失败仍提示', async () => {
    const host = await open();
    reply(requests('file/list')[0], [file('edit.lua')]);
    await contextAction('edit.lua', 'common.edit');
    reply(requests('file/get')[0], btoa('old draft'));
    await vi.waitFor(() => expect(host.querySelector('textarea')?.readOnly).toBe(false));
    button('common.save').click();
    await vi.waitFor(() => expect(requests('file/put')).toHaveLength(1));
    const put = requests('file/put')[0];
    button('common.cancel').click();
    await contextAction('edit.lua', 'common.edit');
    reply(requests('file/get').at(-1), btoa('new draft'));
    await vi.waitFor(() => expect(host.querySelector('textarea')?.value).toBe('new draft'));
    reply(put, { path: '/lua/scripts/edit.lua' }, 'permission denied');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(feedback.showError).not.toHaveBeenCalled();
    expect(host.querySelector('textarea')?.value).toBe('new draft');
    for (const type of ['file/put', 'file/delete', 'file/move', 'file/copy']) {
      Socket.instances[0].receive({ type, udid: 'device-a', body: { path: '/res/busy.bin' }, error: 'file transfer already in progress', errorCode: 'error.transfer.file_busy' });
    }
    expect(feedback.showError).toHaveBeenCalledTimes(4);
  });
});
