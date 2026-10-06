// @vitest-environment happy-dom
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider, translate } from '../../i18n';
import { authFetch } from '../../services/httpAuth';
import ServerFileBrowser from '../ServerFileBrowser';

const feedback = vi.hoisted(() => ({ alert: vi.fn(async (_message: string) => {}), showSuccess: vi.fn() }));
vi.mock('../DialogContext', () => ({ useDialog: () => feedback }));
vi.mock('../ToastContext', () => ({ useToast: () => feedback }));
vi.mock('../../services/httpAuth', () => ({ authFetch: vi.fn(), appendAuthQuery: (url: string) => url }));

function button(key: string) {
  const label = translate('en-US', key);
  const node = [...document.querySelectorAll<HTMLButtonElement>('button')].find(element => element.textContent?.trim() === label);
  expect(node, label).toBeTruthy();
  return node!;
}

function edit(name: string) {
  const node = [...document.querySelectorAll('span')].find(element => element.textContent === name)!;
  expect(node).toBeTruthy();
  node.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 }));
  button('common.edit').click();
}

describe('ServerFileBrowser editor ownership', () => {
  let dispose: (() => void) | undefined;
  let reads: Array<{ url: URL; resolve: (response: Response) => void }>;
  let saves: Array<{ url: URL; body: any; resolve: (response: Response) => void }>;

  beforeEach(() => {
    vi.clearAllMocks();
    reads = [];
    saves = [];
    vi.mocked(authFetch).mockImplementation(async (url, options) => {
      const parsed = new URL(String(url));
      if (parsed.pathname === '/api/config') return Response.json({ ui: { isLocal: false } });
      if (parsed.pathname === '/api/server-files/list') return Response.json({ files: ['first.lua', 'second.lua'].map(name => ({ name, type: 'file', size: 20, modTime: '' })) });
      if (parsed.pathname === '/api/server-files/read') return new Promise(resolve => reads.push({ url: parsed, resolve }));
      if (parsed.pathname === '/api/server-files/save') return new Promise(resolve => saves.push({ url: parsed, body: JSON.parse(options!.body as string), resolve }));
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
    dispose = render(() => <I18nProvider defaultLocale="en-US">
      <ServerFileBrowser isOpen={open()} onClose={() => setOpen(false)} serverBaseUrl={server()} />
    </I18nProvider>, host);
    await vi.waitFor(() => expect(host.textContent).toContain('first.lua'));
    return { host, setServer, setOpen };
  }

  it('读取期间导航到其它目录后，旧内容不能在新目录打开或保存', async () => {
    const { host } = await mount();
    edit('first.lua');
    button('files.files_root').click();
    reads[0].resolve(Response.json({ success: true, content: 'old scripts contents' }));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(host.querySelector('textarea')).toBeNull();
    expect(saves).toHaveLength(0);
    edit('first.lua');
    reads[1].resolve(Response.json({ success: true, content: 'current files contents' }));
    await vi.waitFor(() => expect(host.querySelector('textarea')?.value).toBe('current files contents'));
    button('common.save').click();
    await vi.waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0].body).toEqual({ category: 'files', path: 'first.lua', content: 'current files contents' });
    saves[0].resolve(Response.json({ success: true }));
  });

  it('连续编辑时，旧读取结果不能替换当前草稿或重建输入节点', async () => {
    const { host } = await mount();
    edit('first.lua');
    if (host.querySelector('textarea')) button('common.cancel').click();
    edit('second.lua');
    reads[1].resolve(Response.json({ content: 'second contents' }));
    await vi.waitFor(() => expect(host.querySelector('textarea')?.value).toBe('second contents'));
    const editor = host.querySelector('textarea')!;
    editor.value = 'unsaved second draft';
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    reads[0].resolve(Response.json({ content: 'late first contents' }));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(host.querySelector('textarea')).toBe(editor);
    expect(editor.value).toBe('unsaved second draft');
  });

  it('加载期间不能保存占位内容，空文件读取成功后可以保存', async () => {
    const { host } = await mount();
    edit('first.lua');
    expect(host.querySelector('textarea')?.readOnly).toBe(true);
    expect(button('common.save').disabled).toBe(true);
    reads[0].resolve(Response.json({ content: '' }));
    await vi.waitFor(() => expect(host.querySelector('textarea')?.readOnly).toBe(false));
    expect(host.querySelector('textarea')?.value).toBe('');
    button('common.save').click();
    await vi.waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0].body.content).toBe('');
    saves[0].resolve(Response.json({ success: true }));
  });

  it('保存失败保留草稿，重试期间冻结输入且禁止重复保存', async () => {
    const { host } = await mount();
    edit('first.lua');
    reads[0].resolve(Response.json({ content: 'draft' }));
    await vi.waitFor(() => expect(host.querySelector('textarea')?.value).toBe('draft'));
    const save = button('common.save');
    save.click();
    save.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(saves).toHaveLength(1);
    expect(host.querySelector('textarea')?.readOnly).toBe(true);
    saves[0].resolve(Response.json({ error: 'permission denied' }, { status: 403 }));
    await vi.waitFor(() => expect(feedback.alert).toHaveBeenCalledWith('Save failed: permission denied'));
    await vi.waitFor(() => expect(host.querySelector('textarea')?.readOnly).toBe(false));
    expect(host.querySelector('textarea')?.value).toBe('draft');
    button('common.save').click();
    saves[1].resolve(Response.json({ success: true }));
    await vi.waitFor(() => expect(host.querySelector('textarea')).toBeNull());
  });

  it.each([true, false])('旧保存结果 success=%s 不关闭或干扰新编辑器', async success => {
    const { host } = await mount();
    edit('first.lua');
    reads[0].resolve(Response.json({ content: 'first draft' }));
    await vi.waitFor(() => expect(host.querySelector('textarea')?.value).toBe('first draft'));
    button('common.save').click();
    button('common.cancel').click();
    edit('second.lua');
    reads[1].resolve(Response.json({ content: 'second draft' }));
    await vi.waitFor(() => expect(host.querySelector('textarea')?.value).toBe('second draft'));
    saves[0].resolve(Response.json(success ? { success: true } : { error: 'old save failed' }, { status: success ? 200 : 500 }));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(host.querySelector('textarea')?.value).toBe('second draft');
    expect(feedback.alert).not.toHaveBeenCalled();
    expect(button('common.save').disabled).toBe(false);
  });

  it.each(['close', 'server'])('%s 变化使旧读取失效，同名文件重新打开不受干扰', async change => {
    const { host, setOpen, setServer } = await mount();
    edit('first.lua');
    if (change === 'close') { setOpen(false); setOpen(true); } else setServer('http://server-b');
    await vi.waitFor(() => expect(host.querySelector('textarea')).toBeNull());
    await vi.waitFor(() => expect([...host.querySelectorAll('span')].some(node => node.textContent === 'first.lua')).toBe(true));
    edit('first.lua');
    reads[1].resolve(Response.json({ content: 'new session' }));
    await vi.waitFor(() => expect(host.querySelector('textarea')?.value).toBe('new session'));
    reads[0].resolve(Response.json({ error: 'old read failed' }, { status: 500 }));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(host.querySelector('textarea')?.value).toBe('new session');
    expect(feedback.alert).not.toHaveBeenCalled();
  });
});
