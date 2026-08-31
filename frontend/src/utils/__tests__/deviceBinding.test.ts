import { describe, expect, it } from 'vitest';
import { getBindingScriptDownloadUrl, getBindingScriptFileName } from '../deviceBinding';

describe('device binding URLs', () => {
  it('uses an ASCII-only script name', () => {
    expect(getBindingScriptFileName('2001:db8::1')).toBe('XXTCloudControl-bind-2001_db8__1.lua');
    expect(getBindingScriptFileName('[2001:db8::1]')).toBe('XXTCloudControl-bind-2001_db8__1.lua');
    expect(getBindingScriptFileName('云控.example')).toMatch(/^XXTCloudControl-bind-[\x00-\x7F]+\.lua$/);
  });

  it('includes the selected locale in the download URL', () => {
    const raw = getBindingScriptDownloadUrl(
      'https://cloud.example',
      'cloud.example',
      '443',
      'wss',
      'pt-BR',
    );
    const url = new URL(raw);

    expect(url.pathname).toBe('/api/download-bind-script');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      host: 'cloud.example',
      port: '443',
      proto: 'wss',
      locale: 'pt-BR',
    });
  });
});
