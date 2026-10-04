// @vitest-environment happy-dom
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  I18nProvider, getCurrentLocale, loadLocaleMessages, localeLoaders,
  localeStorageKey, useI18n, type Locale,
} from '../index';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}

function mountLocaleProbe(locale?: Locale) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const state = { context: undefined as ReturnType<typeof useI18n> | undefined, mounts: 0 };
  const Probe = () => {
    state.mounts++;
    const context = useI18n();
    state.context = context;
    const [draft, setDraft] = createSignal('');
    return <>
      <input aria-label="Draft" value={draft()} onInput={event => setDraft(event.currentTarget.value)} />
      <span data-locale>{context.locale()}|{context.t('login.button')}</span>
    </>;
  };
  const dispose = render(() => <I18nProvider defaultLocale={locale}><Probe /></I18nProvider>, host);
  return { host, state, dispose: () => { dispose(); host.remove(); } };
}

describe('locale loading', () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    vi.stubGlobal('navigator', { languages: ['en-US'], language: 'en-US' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('首次语言加载完成前不挂载表单，并合并重复加载请求', async () => {
    const messages = await import('../locales/vi-VN.json');
    const pending = deferred<typeof messages>();
    const loader = vi.spyOn(localeLoaders, 'vi-VN').mockReturnValue(pending.promise);
    const mounted = mountLocaleProbe('vi-VN');
    try {
      const duplicate = loadLocaleMessages('vi-VN');
      expect(loader).toHaveBeenCalledTimes(1);
      expect(mounted.host.querySelector('[role="status"]')?.textContent).toBe('Loading...');
      expect(mounted.state.mounts).toBe(0);
      pending.resolve(messages);
      await duplicate;
      await vi.waitFor(() => expect(mounted.state.mounts).toBe(1));
      expect(mounted.host.querySelector('[data-locale]')?.textContent).toBe('vi-VN|Đăng nhập');
      expect(window.localStorage.getItem(localeStorageKey)).toBeNull();
    } finally {
      mounted.dispose();
    }
  });

  it('切换期间保留草稿，较晚完成的旧请求不能覆盖最新选择', async () => {
    const japanese = await import('../locales/ja-JP.json');
    const korean = await import('../locales/ko-KR.json');
    const pendingJapanese = deferred<typeof japanese>();
    const pendingKorean = deferred<typeof korean>();
    vi.spyOn(localeLoaders, 'ja-JP').mockReturnValue(pendingJapanese.promise);
    vi.spyOn(localeLoaders, 'ko-KR').mockReturnValue(pendingKorean.promise);
    const mounted = mountLocaleProbe('en-US');
    try {
      const input = mounted.host.querySelector('input')!;
      input.value = 'keep this draft';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
      const first = mounted.state.context!.setLocale('ja-JP');
      const second = mounted.state.context!.setLocale('ko-KR');
      expect(mounted.state.context!.locale()).toBe('en-US');
      expect(window.localStorage.getItem(localeStorageKey)).toBeNull();

      pendingKorean.resolve(korean);
      await second;
      pendingJapanese.resolve(japanese);
      await first;
      expect(mounted.state.context!.locale()).toBe('ko-KR');
      expect(getCurrentLocale()).toBe('ko-KR');
      expect(document.documentElement.lang).toBe('ko-KR');
      expect(window.localStorage.getItem(localeStorageKey)).toBe('ko-KR');
      expect(mounted.host.querySelector('input')).toBe(input);
      expect(input.value).toBe('keep this draft');
      expect(document.activeElement).toBe(input);
      expect(mounted.state.mounts).toBe(1);
    } finally {
      mounted.dispose();
    }
  });

  it('加载失败时保留当前语言和偏好，失败请求可以重新发起', async () => {
    const german = await import('../locales/de-DE.json');
    const loader = vi.spyOn(localeLoaders, 'de-DE')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(german);
    const mounted = mountLocaleProbe('en-US');
    try {
      const input = mounted.host.querySelector('input');
      await expect(mounted.state.context!.setLocale('de-DE')).rejects.toThrow('offline');
      expect(mounted.state.context!.locale()).toBe('en-US');
      expect(window.localStorage.getItem(localeStorageKey)).toBeNull();
      await mounted.state.context!.setLocale('de-DE');
      expect(loader).toHaveBeenCalledTimes(2);
      expect(mounted.host.querySelector('input')).toBe(input);
      expect(mounted.host.querySelector('[data-locale]')?.textContent).toBe('de-DE|Anmelden');
    } finally {
      mounted.dispose();
    }
  });

  it('等待手动选择期间不被浏览器语言变化抢先覆盖', async () => {
    const french = await import('../locales/fr-FR.json');
    const pending = deferred<typeof french>();
    vi.spyOn(localeLoaders, 'fr-FR').mockReturnValue(pending.promise);
    const spanishLoader = vi.spyOn(localeLoaders, 'es-ES');
    const mounted = mountLocaleProbe();
    try {
      const change = mounted.state.context!.setLocale('fr-FR');
      vi.stubGlobal('navigator', { languages: ['es-ES'], language: 'es-ES' });
      window.dispatchEvent(new Event('languagechange'));
      expect(spanishLoader).not.toHaveBeenCalled();
      pending.resolve(french);
      await change;
      expect(mounted.state.context!.locale()).toBe('fr-FR');
      expect(window.localStorage.getItem(localeStorageKey)).toBe('fr-FR');
    } finally {
      mounted.dispose();
    }
  });

  it('组件卸载后不再提交迟到的语言选择', async () => {
    const portuguese = await import('../locales/pt-BR.json');
    const pending = deferred<typeof portuguese>();
    vi.spyOn(localeLoaders, 'pt-BR').mockReturnValue(pending.promise);
    const mounted = mountLocaleProbe('en-US');
    const change = mounted.state.context!.setLocale('pt-BR');
    mounted.dispose();
    pending.resolve(portuguese);
    await change;
    expect(window.localStorage.getItem(localeStorageKey)).toBeNull();
    expect(getCurrentLocale()).toBe('en-US');
  });

  it('繁体中文会等待目标语言和回退语言都加载完成', async () => {
    const traditional = await import('../locales/zh-TW.json');
    const simplified = await import('../locales/zh-CN.json');
    const pendingTraditional = deferred<typeof traditional>();
    const pendingSimplified = deferred<typeof simplified>();
    const traditionalLoader = vi.spyOn(localeLoaders, 'zh-TW').mockReturnValue(pendingTraditional.promise);
    const simplifiedLoader = vi.spyOn(localeLoaders, 'zh-CN').mockReturnValue(pendingSimplified.promise);
    const mounted = mountLocaleProbe('zh-TW');
    try {
      expect(traditionalLoader).toHaveBeenCalledTimes(1);
      expect(simplifiedLoader).toHaveBeenCalledTimes(1);
      pendingTraditional.resolve(traditional);
      await pendingTraditional.promise;
      expect(mounted.state.mounts).toBe(0);
      pendingSimplified.resolve(simplified);
      await vi.waitFor(() => expect(mounted.state.mounts).toBe(1));
      expect(mounted.host.querySelector('[data-locale]')?.textContent).toBe('zh-TW|登入');
    } finally {
      mounted.dispose();
    }
  });

  it('首次加载失败时显示刷新入口，不渲染缺失翻译的表单', async () => {
    vi.spyOn(localeLoaders, 'ru-RU').mockRejectedValue(new Error('offline'));
    const mounted = mountLocaleProbe('ru-RU');
    try {
      await vi.waitFor(() => expect(mounted.host.querySelector('[role="alert"]')).toBeTruthy());
      expect(mounted.host.textContent).toContain('Refresh');
      expect(mounted.state.mounts).toBe(0);
    } finally {
      mounted.dispose();
    }
  });
});
