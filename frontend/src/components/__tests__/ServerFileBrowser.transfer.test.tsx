// @vitest-environment happy-dom
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider, translate } from '../../i18n';
import { authFetch } from '../../services/httpAuth';
import type { Device } from '../../services/WebSocketService';
import ServerFileBrowser, { type ServerFileItem } from '../ServerFileBrowser';

const feedback = vi.hoisted(() => ({ alert: vi.fn(async (_message: string) => {}), showSuccess: vi.fn() }));
vi.mock('../DialogContext', () => ({ useDialog: () => ({ alert: feedback.alert }) }));
vi.mock('../ToastContext', () => ({ useToast: () => ({ showSuccess: feedback.showSuccess }) }));
vi.mock('../../services/httpAuth', () => ({ authFetch: vi.fn(), appendAuthQuery: (url: string) => url }));

const file = (name: string, type: 'file' | 'dir' = 'file', isSymlink = false): ServerFileItem => ({ name, type, size: 20, modTime: '', isSymlink });
const devices = ['a', 'b'].map(udid => ({ udid, system: { name: `Device ${udid}` } } as Device));

function button(key: string, vars?: Record<string, unknown>) {
  const label = translate('en-US', key, vars);
  const element = [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === label);
  expect(element, `button: ${label}`).toBeTruthy();
  return element!;
}

describe('ServerFileBrowser file transfers', () => {
  let dispose: (() => void) | undefined;
  let rootFiles: ServerFileItem[];
  let directories: Map<string, ServerFileItem[] | Error>;
  let pushed: Array<{ url: string; body: Record<string, string> }>;
  let respondToPush: (body: Record<string, string>) => Promise<Response>;

  beforeEach(() => {
    vi.clearAllMocks();
    rootFiles = [file('sample.bin')];
    directories = new Map();
    pushed = [];
    respondToPush = async () => Response.json({ success: true, token: 'download-token' });
    vi.mocked(authFetch).mockImplementation(async (url, options) => {
      const parsed = new URL(String(url), 'http://localhost');
      if (parsed.pathname === '/api/config') return Response.json({ ui: { isLocal: false } });
      if (parsed.pathname === '/api/server-files/list') {
        const path = parsed.searchParams.get('path') || '';
        const contents = path ? directories.get(path) : rootFiles;
        if (contents instanceof Error) return Response.json({ error: contents.message }, { status: 500 });
        return Response.json({ files: contents || [] });
      }
      if (parsed.pathname === '/api/transfer/push-to-device') {
        const body = JSON.parse(options!.body as string);
        pushed.push({ url: String(url), body });
        return respondToPush(body);
      }
      throw new Error(`Unexpected request: ${parsed.pathname}`);
    });
  });

  afterEach(() => {
    dispose?.();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  async function mountAndSend() {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const [baseUrl, setBaseUrl] = createSignal('http://server-a');
    dispose = render(() => <I18nProvider defaultLocale="en-US">
      <ServerFileBrowser isOpen onClose={() => {}} serverBaseUrl={baseUrl()} selectedDevices={devices} />
    </I18nProvider>, host);
    await vi.waitFor(() => expect(host.textContent).toContain(rootFiles[0].name));
    button('common.select_mode').click();
    button('common.select_all').click();
    button('files.send_to_devices', { count: 2 }).click();
    button('common.send').click();
    return { setBaseUrl };
  }

  it.each(['http', 'rejected', 'invalid-json', 'network'])('不把 %s 失败计为成功，并能再次发起发送', async kind => {
    respondToPush = async () => {
      if (kind === 'network') throw new Error('network interrupted');
      if (kind === 'invalid-json') return new Response('<html>not JSON</html>');
      return Response.json({ success: false, error: 'device offline' }, { status: kind === 'http' ? 400 : 200 });
    };
    await mountAndSend();
    await vi.waitFor(() => expect(feedback.alert).toHaveBeenCalledOnce());
    expect(feedback.alert.mock.calls[0][0]).toContain('Failed to send 2 file request(s)');
    expect(feedback.alert.mock.calls[0][0]).toContain('/lua/scripts/sample.bin');
    expect(feedback.showSuccess).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(button('files.send_to_devices', { count: 2 }).disabled).toBe(false));
  });

  it('部分设备失败时保留成功数量和失败原因，并继续后续文件', async () => {
    rootFiles = [file('first.bin'), file('second.bin')];
    respondToPush = async body => body.deviceSN === 'a'
      ? Response.json({ success: true })
      : Response.json({ success: false, error: 'device offline' }, { status: 400 });
    await mountAndSend();
    await vi.waitFor(() => expect(feedback.alert).toHaveBeenCalledOnce());
    expect(feedback.alert.mock.calls[0][0]).toContain('Sent 2 file request(s); 2 failed');
    expect(feedback.alert.mock.calls[0][0]).toContain('Device b');
    expect(feedback.alert.mock.calls[0][0]).toContain('device offline');
    expect(pushed.map(request => request.body.path)).toEqual(['first.bin', 'first.bin', 'second.bin', 'second.bin']);
    expect(feedback.showSuccess).not.toHaveBeenCalled();
  });

  it('全部成功时报告实际数量，执行中切换服务器不会改变当前批次', async () => {
    rootFiles = [file('first.bin'), file('second.bin')];
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    respondToPush = async body => {
      if (body.path === 'first.bin') await pending;
      return Response.json({ success: true });
    };
    const { setBaseUrl } = await mountAndSend();
    await vi.waitFor(() => expect(pushed).toHaveLength(2));
    setBaseUrl('http://server-b');
    release();
    await vi.waitFor(() => expect(feedback.showSuccess).toHaveBeenCalledWith('Sent 4 file request(s)'));
    expect(pushed.every(request => request.url.startsWith('http://server-a/') && request.body.serverBaseUrl === 'http://server-a')).toBe(true);
    expect(feedback.alert).not.toHaveBeenCalled();
  });

  it('目录读取失败时显示目录和原因，并在下发前停止', async () => {
    rootFiles = [file('folder', 'dir'), file('loose.bin')];
    directories.set('folder', [file('inside.bin'), file('blocked', 'dir')]);
    directories.set('folder/blocked', new Error('permission denied'));
    await mountAndSend();
    await vi.waitFor(() => expect(feedback.alert).toHaveBeenCalledOnce());
    expect(feedback.alert.mock.calls[0][0]).toContain('folder/blocked');
    expect(feedback.alert.mock.calls[0][0]).toContain('permission denied');
    expect(pushed).toHaveLength(0);
    expect(feedback.showSuccess).not.toHaveBeenCalled();
  });

  it('保留目录相对路径及符号链接规则', async () => {
    rootFiles = [file('folder', 'dir')];
    directories.set('folder', [file('file-link.bin', 'file', true), file('nested', 'dir'), file('dir-link', 'dir', true)]);
    directories.set('folder/nested', [file('deep.bin')]);
    await mountAndSend();
    await vi.waitFor(() => expect(feedback.showSuccess).toHaveBeenCalledWith('Sent 4 file request(s)'));
    expect(pushed.map(request => request.body.targetPath)).toEqual([
      '/lua/scripts/folder/file-link.bin', '/lua/scripts/folder/file-link.bin',
      '/lua/scripts/folder/nested/deep.bin', '/lua/scripts/folder/nested/deep.bin',
    ]);
    expect(vi.mocked(authFetch).mock.calls.some(([url]) => String(url).includes('dir-link'))).toBe(false);
    expect(feedback.alert).not.toHaveBeenCalled();
  });
});
