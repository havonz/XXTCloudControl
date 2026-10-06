// @vitest-environment happy-dom
import { Show } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { I18nProvider } from '../i18n';
import { authFetch } from '../services/httpAuth';
import { FileTransferService } from '../services/FileTransferService';
import type { DeviceFileBrowserProps } from '../components/DeviceFileBrowser';

const session = vi.hoisted(() => ({
  messages: new Set<(message: any) => void>(),
  statuses: new Set<(status: string) => void>(),
  showError: vi.fn(),
}));
vi.mock('../components/ToastContext', () => ({ useToast: () => ({ showError: session.showError, showSuccess: vi.fn() }) }));
vi.mock('../components/ThemeContext', () => ({ useTheme: () => ({ themeMode: () => 'system', cycleTheme: vi.fn() }) }));
vi.mock('../components/LoginForm', () => ({ default: (props: any) => <button data-testid="login" onClick={() => props.onLogin({ server: 'server-a', port: '46980', password: 'test-only' })}>Log in</button> }));
vi.mock('../components/DeviceList', () => ({ default: (props: any) => <button data-testid="open-files" onClick={() => props.onOpenFileBrowser('device-a', 'Device A')}>Open files</button> }));
vi.mock('../components/GroupList', () => ({ default: () => null }));
vi.mock('../components/DeviceFileBrowser', () => ({ default: (props: DeviceFileBrowserProps) => <Show when={props.isOpen}>
  <button data-testid="download" onClick={() => props.onDownloadLargeFile?.('device-a', '/res/source.bin', 'original name.bin')}>Download</button>
</Show> }));
vi.mock('../services/httpAuth', () => ({ authFetch: vi.fn(), setApiBaseUrl: vi.fn() }));
vi.mock('../services/WebSocketService', () => ({
  WebSocketService: class {
    auth?: (success: boolean) => void;
    devices?: (devices: any[]) => void;
    onAuthResult(callback: (success: boolean) => void) { this.auth = callback; }
    onDeviceUpdate(callback: (devices: any[]) => void) { this.devices = callback; }
    onMessage(callback: (message: any) => void) { session.messages.add(callback); return () => session.messages.delete(callback); }
    onStatusChange(callback: (status: string) => void) { session.statuses.add(callback); return () => session.statuses.delete(callback); }
    connect() { this.auth?.(true); this.devices?.([{ udid: 'device-a', system: { name: 'Device A' } }]); }
    disconnect() { session.statuses.forEach(callback => callback('disconnected')); }
    getConnectionStatus() { return 'connected'; }
  },
}));

describe('App browser download integration', () => {
  let dispose: (() => void) | undefined;
  let uploadRequest: Record<string, any>;
  let resolveRequest: (response: Response) => void;
  let downloaded: Array<{ href: string; name: string }>;

  beforeEach(() => {
    session.messages.clear();
    session.statuses.clear();
    session.showError.mockClear();
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ version: 'test' })));
    downloaded = [];
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test-download');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloaded.push({ href: this.href, name: this.download });
    });
    vi.mocked(authFetch).mockImplementation(async (url, options) => {
      if (String(url).includes('/pull-from-device')) {
        uploadRequest = JSON.parse(options!.body as string);
        return new Promise<Response>(resolve => { resolveRequest = resolve; });
      }
      if (String(url).includes('/api/transfer/download/')) return new Response('downloaded contents');
      return Response.json({ success: true, groups: [], settings: {} });
    });
  });

  afterEach(() => {
    dispose?.();
    FileTransferService.getInstance().setBaseUrl('');
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  async function startDownload() {
    const host = document.createElement('div');
    document.body.appendChild(host);
    dispose = render(() => <I18nProvider defaultLocale="en-US"><App /></I18nProvider>, host);
    await vi.waitFor(() => expect(document.querySelector('[data-testid="login"]')).toBeTruthy());
    document.querySelector<HTMLButtonElement>('[data-testid="login"]')!.click();
    await vi.waitFor(() => expect(document.querySelector('[data-testid="open-files"]')).toBeTruthy());
    document.querySelector<HTMLButtonElement>('[data-testid="open-files"]')!.click();
    await vi.waitFor(() => expect(document.querySelector('[data-testid="download"]')).toBeTruthy());
    document.querySelector<HTMLButtonElement>('[data-testid="download"]')!.click();
    await vi.waitFor(() => expect(uploadRequest?.path).toBeTruthy());
  }

  it('实际应用在早到完成消息后下载原始文件名，并释放 Blob URL', async () => {
    await startDownload();
    const message = { type: 'transfer/send/complete', udid: 'device-a', body: { success: true, savePath: uploadRequest.path } };
    session.messages.forEach(callback => callback(message));
    expect(downloaded).toHaveLength(0);
    resolveRequest(Response.json({ success: true, token: 'upload-token', downloadToken: 'download-token' }));
    await vi.waitFor(() => expect(downloaded).toEqual([{ href: 'blob:test-download', name: 'original name.bin' }]));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-download');
    session.messages.forEach(callback => callback(message));
    expect(downloaded).toHaveLength(1);
    expect(session.showError).not.toHaveBeenCalled();
  });

  it('退出页面后迟到的完成消息不会弹出下载', async () => {
    await startDownload();
    dispose?.();
    dispose = undefined;
    const message = { type: 'transfer/send/complete', udid: 'device-a', body: { success: true, savePath: uploadRequest.path } };
    session.messages.forEach(callback => callback(message));
    resolveRequest(Response.json({ success: true, token: 'upload-token', downloadToken: 'download-token' }));
    await Promise.resolve();
    await Promise.resolve();
    expect(downloaded).toHaveLength(0);
    expect(session.showError).not.toHaveBeenCalled();
  });
});
