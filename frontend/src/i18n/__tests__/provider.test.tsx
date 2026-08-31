// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { I18nProvider, localeStorageKey, useI18n } from '../index';

const LocaleProbe = () => {
  const { locale, setLocale, t } = useI18n();
  return (
    <button type="button" onClick={() => setLocale('zh-TW')}>
      {locale()}|{t('login.button')}
    </button>
  );
};

describe('I18nProvider', () => {
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

  it('re-renders translated text and persists the locale without remounting', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const dispose = render(() => (
      <I18nProvider defaultLocale="en-US">
        <LocaleProbe />
      </I18nProvider>
    ), host);

    const button = host.querySelector('button')!;
    expect(button.textContent).toBe('en-US|Log In');

    button.click();

    expect(button.textContent).toBe('zh-TW|登入');
    expect(document.documentElement.lang).toBe('zh-TW');
    expect(window.localStorage.getItem(localeStorageKey)).toBe('zh-TW');
    dispose();
    host.remove();
  });
});
