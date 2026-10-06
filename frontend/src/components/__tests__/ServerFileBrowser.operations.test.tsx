// @vitest-environment happy-dom
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider, translate } from '../../i18n';
import { authFetch } from '../../services/httpAuth';
import ServerFileBrowser, { type ServerFileItem } from '../ServerFileBrowser';

const feedback = vi.hoisted(() => ({ alert: vi.fn(async (_message: string) => {}), showSuccess: vi.fn() }));
vi.mock('../DialogContext', () => ({ useDialog: () => feedback }));
vi.mock('../ToastContext', () => ({ useToast: () => feedback }));
vi.mock('../../services/httpAuth', () => ({ authFetch: vi.fn(), appendAuthQuery: (url: string) => url }));

const file = (name: string, type: ServerFileItem['type'] = 'file'): ServerFileItem => ({ name, type, size: 20, modTime: '' });
function button(key: string) {
  const label = translate('en-US', key);
  const node = [...document.querySelectorAll<HTMLButtonElement>('button')].find(element => element.textContent?.trim() === label);
  expect(node, label).toBeTruthy();
  return node!;
}
function fileLabel(name: string) {
  const node = [...document.querySelectorAll('span')].find(element => element.textContent === name);
  expect(node, name).toBeTruthy();
  return node!;
}
function contextAction(name: string, action: string) {
  fileLabel(name).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 }));
  button(action).click();
}

describe('ServerFileBrowser clipboard and download paths', () => {
  let dispose: (() => void) | undefined;
  let entries: ServerFileItem[];
  let requests: Array<{ url: URL; body: any }>;
  let respond: (body: any) => Promise<Response>;

  beforeEach(() => {
    vi.clearAllMocks();
    entries = [file('first.txt'), file('second.txt')];
    requests = [];
    respond = async body => Response.json({ success: true, successCount: body.items.length, totalCount: body.items.length, errorItems: [] });
    vi.mocked(authFetch).mockImplementation(async (url, options) => {
      const parsed = new URL(String(url));
      if (parsed.pathname === '/api/config') return Response.json({ ui: { isLocal: false } });
      if (parsed.pathname === '/api/server-files/list') return Response.json({ files: entries });
      if (parsed.pathname === '/api/server-files/batch-copy' || parsed.pathname === '/api/server-files/batch-move') {
        const body = JSON.parse(options!.body as string);
        requests.push({ url: parsed, body });
        return respond(body);
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
    dispose = render(() => <I18nProvider defaultLocale="en-US"><ServerFileBrowser isOpen onClose={() => {}} serverBaseUrl={server()} /></I18nProvider>, host);
    await vi.waitFor(() => expect(host.textContent).toContain(entries[0].name));
    return { host, setServer };
  }

  async function cutAllAndNavigate() {
    button('common.select_mode').click();
    button('common.select_all').click();
    button('common.cut').click();
    button('files.files_root').click();
    await vi.waitFor(() => expect(fileLabel(entries[0].name)).toBeTruthy());
    button('common.select_mode').click();
  }

  it.each(['http', 'network', 'invalid-json', 'invalid-results'])('%s 失败保留完整剪切项供重试', async mode => {
    await mount();
    await cutAllAndNavigate();
    const successful = respond;
    respond = async () => {
      if (mode === 'network') throw new Error('connection lost');
      if (mode === 'invalid-json') return new Response('not JSON');
      if (mode === 'invalid-results') return Response.json({ success: true, successCount: 1, totalCount: 2, errorItems: [] });
      return Response.json({ error: 'permission denied' }, { status: 403 });
    };
    button('common.paste').click();
    await vi.waitFor(() => expect(feedback.alert).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(button('common.paste').disabled).toBe(false));
    respond = successful;
    button('common.paste').click();
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1].body.items).toEqual(['first.txt', 'second.txt']);
    await vi.waitFor(() => expect(button('common.paste').disabled).toBe(true));
  });

  it('部分移动失败时只保留失败项，重试不重复移动成功项', async () => {
    await mount();
    await cutAllAndNavigate();
    const successful = respond;
    respond = async () => Response.json({ success: false, successCount: 1, totalCount: 2,
      errorItems: [{ item: 'second.txt', error: 'permission denied' }] });
    button('common.paste').click();
    await vi.waitFor(() => expect(feedback.alert).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(button('common.paste').disabled).toBe(false));
    respond = successful;
    button('common.paste').click();
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1].body.items).toEqual(['second.txt']);
  });

  it('旧粘贴完成不能清除新剪切项，也不能刷新用户当前的其它目录', async () => {
    await mount();
    await cutAllAndNavigate();
    let finish!: (response: Response) => void;
    respond = () => new Promise(resolve => { finish = resolve; });
    button('common.paste').click();
    fileLabel('second.txt').click();
    button('common.cut').click();
    button('files.scripts_root').click();
    await vi.waitFor(() => expect(fileLabel('second.txt')).toBeTruthy());
    button('common.select_mode').click();
    const listCount = vi.mocked(authFetch).mock.calls.filter(([url]) => String(url).includes('/list?')).length;
    finish(Response.json({ success: true, successCount: 2, totalCount: 2, errorItems: [] }));
    await new Promise(resolve => setTimeout(resolve, 0));
    await vi.waitFor(() => expect(button('common.paste').disabled).toBe(false));
    expect(vi.mocked(authFetch).mock.calls.filter(([url]) => String(url).includes('/list?'))).toHaveLength(listCount);
    button('common.paste').click();
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1].body).toMatchObject({ srcCategory: 'files', dstCategory: 'scripts', items: ['second.txt'] });
    finish(Response.json({ success: true, successCount: 1, totalCount: 1, errorItems: [] }));
  });

  it('粘贴期间禁止重复提交，复制成功后保留剪贴板供再次粘贴', async () => {
    await mount();
    button('common.select_mode').click();
    button('common.select_all').click();
    button('common.copy').click();
    button('files.files_root').click();
    await vi.waitFor(() => expect(fileLabel('first.txt')).toBeTruthy());
    button('common.select_mode').click();
    let finish!: (response: Response) => void;
    respond = () => new Promise(resolve => { finish = resolve; });
    const paste = button('common.paste');
    paste.click();
    paste.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(requests).toHaveLength(1);
    expect(paste.disabled).toBe(true);
    finish(Response.json({ success: true, successCount: 2, totalCount: 2, errorItems: [] }));
    await vi.waitFor(() => expect(button('common.paste').disabled).toBe(false));
    expect(requests[0].url.pathname).toBe('/api/server-files/batch-copy');
  });

  it('切换服务器后旧剪贴板不在新服务器粘贴', async () => {
    const { setServer } = await mount();
    await cutAllAndNavigate();
    setServer('http://server-b');
    await vi.waitFor(() => expect(fileLabel('first.txt')).toBeTruthy());
    button('common.select_mode').click();
    expect(button('common.paste').disabled).toBe(true);
    expect(requests).toHaveLength(0);
  });

  it.each(['report#1.txt', '报告 ? 50%+雪.txt', 'literal%23.txt'])('下载路径逐段编码且不改变文件名：%s', async name => {
    const directory = 'folder #?%+';
    entries = [file(directory, 'dir')];
    await mount();
    entries = [file(name)];
    fileLabel(directory).click();
    await vi.waitFor(() => expect(fileLabel(name)).toBeTruthy());
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    contextAction(name, 'common.download');
    const url = new URL(String(open.mock.calls[0][0]));
    expect(url.hash).toBe('');
    expect(url.search).toBe('');
    expect(url.pathname).toBe(`/api/server-files/download/scripts/${encodeURIComponent(directory)}/${encodeURIComponent(name)}`);
    expect(decodeURIComponent(url.pathname.split('/').at(-1)!)).toBe(name);
  });

  it('图片预览与下载使用同样的完整文件名编码', async () => {
    const name = '图片 #? 20%.png';
    entries = [file(name)];
    const { host } = await mount();
    contextAction(name, 'files.preview');
    const image = host.querySelector<HTMLImageElement>('img[class*="previewImage"]')!;
    expect(image).toBeTruthy();
    const url = new URL(image.src);
    expect(url.hash).toBe('');
    expect(url.search).toBe('');
    expect(decodeURIComponent(url.pathname.split('/').at(-1)!)).toBe(name);
  });
});
