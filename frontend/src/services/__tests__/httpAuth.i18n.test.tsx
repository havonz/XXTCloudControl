// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { I18nProvider } from '../../i18n';
import { appendAuthQuery, withAuthHeaders } from '../httpAuth';

function mountLocale(locale: 'fr-FR' | 'vi-VN') {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const dispose = render(() => (
    <I18nProvider defaultLocale={locale}>
      <span />
    </I18nProvider>
  ), host);
  return () => {
    dispose();
    host.remove();
  };
}

describe('localized HTTP requests', () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
    });
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it('adds the active locale while preserving an explicit language header', async () => {
    const dispose = mountLocale('fr-FR');
    const localized = await withAuthHeaders('/api/groups');
    const explicit = await withAuthHeaders('/api/groups', {
      headers: { 'Accept-Language': 'vi-VN' },
    });

    expect(localized.get('Accept-Language')).toBe('fr-FR');
    expect(explicit.get('Accept-Language')).toBe('vi-VN');
    dispose();
  });

  it('adds locale before direct-download authentication query parameters', () => {
    const dispose = mountLocale('vi-VN');
    const url = new URL(appendAuthQuery('/api/server-files/download?category=files'), window.location.origin);

    expect(url.searchParams.get('locale')).toBe('vi-VN');
    expect(url.searchParams.get('category')).toBe('files');
    dispose();
  });
});
