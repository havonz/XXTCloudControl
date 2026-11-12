// @vitest-environment happy-dom
import { render } from 'solid-js/web';
import { expect, it, vi } from 'vitest';
import { I18nProvider, getCurrentLocale, translate } from '../../i18n';
import { authFetch } from '../../services/httpAuth';
import MCPAccessModal from '../MCPAccessModal';

vi.mock('../../services/httpAuth', () => ({ authFetch: vi.fn() }));

it('copies the current Bearer configuration and clears it on close or revocation', async () => {
  let enabled = false;
  let generation = 0;
  vi.mocked(authFetch).mockImplementation(async (_url, options) => {
    if (options?.method === 'POST') {
      enabled = true;
      return Response.json({ enabled, token: `test-secret-${++generation}` });
    }
    if (options?.method === 'DELETE') enabled = false;
    return Response.json({ enabled });
  });
  const host = document.createElement('div');
  const open = () => render(() => <I18nProvider><MCPAccessModal endpoint="https://test.example/mcp" onClose={() => {}} /></I18nProvider>, host);
  const button = (key: string) => [...document.querySelectorAll<HTMLButtonElement>('section button')]
    .find(node => node.textContent === translate(getCurrentLocale(), key));
  const config = () => document.querySelector<HTMLTextAreaElement>('#mcp-config');
  const clipboard = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  let dispose = open();
  try {
    await vi.waitFor(() => expect(button('mcp.generate')?.disabled).toBe(false));
    expect(config()).toBeNull();
    button('mcp.generate')!.click();
    await vi.waitFor(() => expect(document.querySelector<HTMLInputElement>('#mcp-secret')?.value).toBe('test-secret-1'));
    button('mcp.copy_config')!.click();
    const copied = clipboard.mock.calls[0][0];
    expect(copied).toBe(config()?.value);
    expect(JSON.parse(copied)).toEqual({
      mcpServers: { XXTCloudControl: {
        type: 'http', url: 'https://test.example/mcp', headers: { Authorization: 'Bearer test-secret-1' },
      } },
    });
    dispose();
    dispose = open();
    await vi.waitFor(() => expect(button('mcp.rotate')?.disabled).toBe(false));
    expect(document.querySelector('#mcp-secret')).toBeNull();
    expect(config()).toBeNull();
    button('mcp.rotate')!.click();
    await vi.waitFor(() => expect(config()?.value).toContain('Bearer test-secret-2'));
    button('mcp.revoke')!.click();
    await vi.waitFor(() => expect(config()).toBeNull());
    expect(enabled).toBe(false);
  } finally {
    clipboard.mockRestore();
    dispose();
  }
});
