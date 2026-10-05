// @vitest-environment happy-dom
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider, translate } from '../../i18n';
import { authFetch } from '../../services/httpAuth';
import ServerFileBrowser, { type ServerFileItem } from '../ServerFileBrowser';

const feedback = vi.hoisted(() => ({
  confirm: vi.fn(async (_message: string) => true),
  alert: vi.fn(async (_message: string) => {}),
  showSuccess: vi.fn(),
}));
vi.mock('../DialogContext', () => ({ useDialog: () => feedback }));
vi.mock('../ToastContext', () => ({ useToast: () => feedback }));
vi.mock('../../services/httpAuth', () => ({ authFetch: vi.fn(), appendAuthQuery: (url: string) => url }));

interface DeleteRequest {
  category: string;
  path: string;
  items: string[];
}

function button(key: string) {
  const label = translate('en-US', key);
  const found = [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === label);
  expect(found, `button ${label}`).toBeTruthy();
  return found!;
}

function fileRow(name: string) {
  const label = [...document.querySelectorAll('span')].find(node => node.textContent === name);
  expect(label, `file row ${name}`).toBeTruthy();
  return label!.parentElement!.parentElement!;
}

describe('ServerFileBrowser deletion', () => {
  let dispose: (() => void) | undefined;
  let listings: Map<string, ServerFileItem[]>;
  let requests: Array<{ server: string; body: DeleteRequest }>;
  let respondToDelete: (server: string, body: DeleteRequest) => Promise<Response>;

  beforeEach(() => {
    vi.clearAllMocks();
    feedback.confirm.mockResolvedValue(true);
    listings = new Map([['server-a/scripts/', ['first.txt', 'second.txt'].map(name => ({ name, type: 'file', size: 10, modTime: '' }))]]);
    requests = [];
    respondToDelete = async (server, body) => {
      const key = `${server}/${body.category}/${body.path}`;
      listings.set(key, (listings.get(key) || []).filter(file => !body.items.includes(file.name)));
      return Response.json({ success: true, successCount: body.items.length, totalCount: body.items.length, errorItems: [] });
    };
    vi.mocked(authFetch).mockImplementation(async (url, options) => {
      const parsed = new URL(String(url));
      if (parsed.pathname === '/api/config') return Response.json({ ui: { isLocal: false } });
      if (parsed.pathname === '/api/server-files/list') {
        return Response.json({ files: listings.get(`${parsed.hostname}/${parsed.searchParams.get('category')}/${parsed.searchParams.get('path') || ''}`) || [] });
      }
      if (parsed.pathname === '/api/server-files/batch-delete') {
        const body = JSON.parse(options!.body as string) as DeleteRequest;
        requests.push({ server: parsed.hostname, body });
        return respondToDelete(parsed.hostname, body);
      }
      throw new Error(`Unexpected endpoint: ${parsed.pathname}`);
    });
  });

  afterEach(() => {
    dispose?.();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  async function mountBrowser() {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const [baseUrl, setBaseUrl] = createSignal('http://server-a');
    dispose = render(() => <I18nProvider defaultLocale="en-US">
      <ServerFileBrowser isOpen onClose={() => {}} serverBaseUrl={baseUrl()} />
    </I18nProvider>, host);
    await vi.waitFor(() => expect(host.textContent).toContain(listings.get('server-a/scripts/')![0].name));
    return { host, setBaseUrl };
  }

  function selectAll() {
    button('common.select_mode').click();
    button('common.select_all').click();
  }

  it('删除 100 项只提交一次请求，并在完成后刷新列表', async () => {
    const names = Array.from({ length: 100 }, (_, index) => `file-${index}.txt`);
    listings.set('server-a/scripts/', names.map(name => ({ name, type: 'file', size: 10, modTime: '' })));
    const { host } = await mountBrowser();
    selectAll();
    button('common.delete').click();
    await vi.waitFor(() => expect(host.textContent).not.toContain('file-0.txt'));
    expect(requests).toEqual([{ server: 'server-a', body: { category: 'scripts', path: '', items: names } }]);
    expect(feedback.confirm).toHaveBeenCalledOnce();
    expect(feedback.alert).not.toHaveBeenCalled();
    expect(button('common.delete').disabled).toBe(true);
  });

  it('部分失败会保留失败项，重试只发送尚未删除的选择', async () => {
    const succeed = respondToDelete;
    respondToDelete = async () => {
      listings.set('server-a/scripts/', listings.get('server-a/scripts/')!.filter(file => file.name === 'second.txt'));
      return Response.json({
        success: false, successCount: 1, totalCount: 2,
        errorItems: [{ item: 'second.txt', error: 'permission denied' }],
      });
    };
    const { host } = await mountBrowser();
    selectAll();
    button('common.delete').click();
    await vi.waitFor(() => expect(host.textContent).not.toContain('first.txt'));
    expect(feedback.alert.mock.calls[0][0]).toContain('(1/2)');
    expect(feedback.alert.mock.calls[0][0]).toContain('second.txt: permission denied');
    expect(fileRow('second.txt').querySelector<HTMLInputElement>('input')!.checked).toBe(true);
    respondToDelete = succeed;
    button('common.delete').click();
    await vi.waitFor(() => expect(host.textContent).not.toContain('second.txt'));
    expect(requests[1].body.items).toEqual(['second.txt']);
  });

  it.each(['http', 'network', 'invalid-json', 'incomplete-results', 'all-failed'])('%s 失败会提示且不清空选择', async kind => {
    respondToDelete = async () => {
      if (kind === 'network') throw new Error('network interrupted');
      if (kind === 'invalid-json') return new Response('<html>error</html>');
      if (kind === 'incomplete-results') return Response.json({ success: true });
      if (kind === 'all-failed') return Response.json({
        success: false, successCount: 0, totalCount: 2,
        errorItems: ['first.txt', 'second.txt'].map(item => ({ item, error: 'permission denied' })),
      });
      return Response.json({ error: 'permission denied' }, { status: 403 });
    };
    await mountBrowser();
    selectAll();
    button('common.delete').click();
    await vi.waitFor(() => expect(feedback.alert).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(button('common.delete').disabled).toBe(false));
    expect(requests).toHaveLength(1);
    expect(feedback.alert.mock.calls[0][0]).toContain('Delete failed');
    for (const name of ['first.txt', 'second.txt']) {
      expect(fileRow(name).querySelector<HTMLInputElement>('input')!.checked).toBe(true);
    }
  });

  it('确认期间切换目录不会改变已确认的删除目标或新目录选择', async () => {
    listings.set('server-a/files/', [{ name: 'other.txt', type: 'file', size: 10, modTime: '' }]);
    let confirm!: (value: boolean) => void;
    feedback.confirm.mockImplementationOnce(() => new Promise(resolve => { confirm = resolve; }));
    const { host } = await mountBrowser();
    selectAll();
    button('common.delete').click();
    button('files.files_root').click();
    await vi.waitFor(() => expect(host.textContent).toContain('other.txt'));
    selectAll();
    confirm(true);
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    await vi.waitFor(() => expect(button('common.delete').disabled).toBe(false));
    expect(requests[0].body).toEqual({ category: 'scripts', path: '', items: ['first.txt', 'second.txt'] });
    expect(fileRow('other.txt').querySelector<HTMLInputElement>('input')!.checked).toBe(true);
    expect(host.textContent).not.toContain('first.txt');
  });

  it('请求进行中切换服务器不会清除新服务器的同名选择', async () => {
    listings.set('server-b/scripts/', [...listings.get('server-a/scripts/')!]);
    let complete!: (value: Response) => void;
    respondToDelete = () => new Promise(resolve => { complete = resolve; });
    const { host, setBaseUrl } = await mountBrowser();
    selectAll();
    button('common.delete').click();
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    setBaseUrl('http://server-b');
    await vi.waitFor(() => expect(button('common.select_mode')).toBeTruthy());
    await vi.waitFor(() => expect(vi.mocked(authFetch).mock.calls.some(([url]) => String(url).startsWith('http://server-b/api/server-files/list'))).toBe(true));
    selectAll();
    complete(Response.json({ success: true, successCount: 2, totalCount: 2, errorItems: [] }));
    await vi.waitFor(() => expect(button('common.delete').disabled).toBe(false));
    expect(requests[0].server).toBe('server-a');
    expect(host.textContent).toContain('first.txt');
    expect(fileRow('first.txt').querySelector<HTMLInputElement>('input')!.checked).toBe(true);
  });

  it('等待确认时不能重复提交，取消后保留选择', async () => {
    let confirm!: (value: boolean) => void;
    feedback.confirm.mockImplementationOnce(() => new Promise(resolve => { confirm = resolve; }));
    await mountBrowser();
    selectAll();
    const remove = button('common.delete');
    remove.click();
    remove.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(feedback.confirm).toHaveBeenCalledOnce();
    expect(remove.disabled).toBe(true);
    confirm(false);
    await vi.waitFor(() => expect(remove.disabled).toBe(false));
    expect(requests).toHaveLength(0);
    expect(fileRow('first.txt').querySelector<HTMLInputElement>('input')!.checked).toBe(true);
  });

  it('右键删除目录符号链接保留原确认提示并只提交该项', async () => {
    listings.set('server-a/scripts/', [{ name: 'linked-dir', type: 'dir', size: 0, modTime: '', isSymlink: true }]);
    const { host } = await mountBrowser();
    fileRow('linked-dir').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }));
    button('common.delete').click();
    await vi.waitFor(() => expect(host.textContent).not.toContain('linked-dir'));
    expect(feedback.confirm).toHaveBeenCalledWith(translate('en-US', 'files.delete_dir_symlink_confirm', { name: 'linked-dir' }));
    expect(requests[0].body.items).toEqual(['linked-dir']);
    expect(feedback.alert).not.toHaveBeenCalled();
  });
});
