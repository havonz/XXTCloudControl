import { createContext, createEffect, createMemo, createSignal, JSX, useContext } from 'solid-js';
import zhCN from './locales/zh-CN.json';
import enUS from './locales/en-US.json';

export type Locale = 'zh-CN' | 'en-US';
type Messages = Record<string, unknown>;

export const defaultLocale: Locale = 'zh-CN';
export const supportedLocales = ['zh-CN', 'en-US'] as const;
export const localeStorageKey = 'xxt-cloud-locale';

type I18nContextValue = {
  locale: () => Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, vars?: Record<string, unknown>) => string;
};

const localeAliases: Record<string, Locale> = {
  zh: 'zh-CN',
  'zh-cn': 'zh-CN',
  'zh-hans': 'zh-CN',
  'zh-sg': 'zh-CN',
  en: 'en-US',
  'en-us': 'en-US',
  'en-gb': 'en-US',
};

const dictionaries: Record<Locale, Messages> = {
  'zh-CN': zhCN as Messages,
  'en-US': enUS as Messages,
};

const I18nContext = createContext<I18nContextValue>();
let activeLocale: Locale | null = null;

export function normalizeLocale(input: string | null | undefined): Locale | null {
  const normalized = (input || '').trim().replace(/_/g, '-').toLowerCase();
  if (!normalized) return null;
  if (localeAliases[normalized]) return localeAliases[normalized];
  return supportedLocales.find(locale => locale.toLowerCase() === normalized) ?? null;
}

export function readStoredLocale(): Locale | null {
  try {
    return normalizeLocale(window.localStorage.getItem(localeStorageKey));
  } catch {
    return null;
  }
}

export function getBrowserLocale(): Locale | null {
  try {
    const candidates = [
      ...(Array.isArray(window.navigator.languages) ? window.navigator.languages : []),
      window.navigator.language,
    ];
    for (const candidate of candidates) {
      const locale = normalizeLocale(candidate);
      if (locale) return locale;
    }
  } catch {
    // ignore browser API failures
  }
  return null;
}

export function getInitialLocale(): Locale {
  return readStoredLocale() ?? getBrowserLocale() ?? defaultLocale;
}

function getValue(messages: Messages, key: string): unknown {
  return key.split('.').reduce<unknown>((current, part) => {
    if (current && typeof current === 'object' && part in current) {
      return (current as Record<string, unknown>)[part];
    }
    return undefined;
  }, messages);
}

function interpolate(template: string, vars?: Record<string, unknown>): string {
  if (!vars) return template;
  return template.replace(/\{\{?([A-Za-z0-9_]+)\}?\}/g, (match, rawKey: string) => {
    if (!(rawKey in vars)) return match;
    return String(vars[rawKey] ?? '');
  });
}

export function translate(locale: Locale, key: string, vars?: Record<string, unknown>): string {
  const value = getValue(dictionaries[locale] || dictionaries[defaultLocale], key)
    ?? getValue(dictionaries[defaultLocale], key);
  if (typeof value !== 'string') return key;
  return interpolate(value, vars);
}

export function getCurrentLocale(): Locale {
  return activeLocale ?? readStoredLocale() ?? getBrowserLocale() ?? defaultLocale;
}

export function I18nProvider(props: { defaultLocale?: Locale; children: JSX.Element }) {
  const [locale, setLocaleState] = createSignal<Locale>(props.defaultLocale ?? getInitialLocale());
  const t = createMemo(() => (key: string, vars?: Record<string, unknown>) => translate(locale(), key, vars));
  activeLocale = locale();

  const setLocale = (nextLocale: Locale) => {
    const normalized = normalizeLocale(nextLocale) ?? defaultLocale;
    activeLocale = normalized;
    setLocaleState(normalized);
    try {
      window.localStorage.setItem(localeStorageKey, normalized);
    } catch {
      // ignore storage failures; the in-memory locale still updates
    }
  };

  createEffect(() => {
    const current = locale();
    activeLocale = current;
    document.documentElement.setAttribute('lang', current);
  });

  return (
    <I18nContext.Provider value={{ locale, setLocale, t: t() }}>
      {props.children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within I18nProvider');
  }
  return context;
}
