import { createContext, createEffect, createMemo, createSignal, JSX, onCleanup, useContext } from 'solid-js';
import zhCN from './locales/zh-CN.json';
import zhTW from './locales/zh-TW.json';
import enUS from './locales/en-US.json';
import jaJP from './locales/ja-JP.json';
import koKR from './locales/ko-KR.json';
import viVN from './locales/vi-VN.json';
import esES from './locales/es-ES.json';
import ptBR from './locales/pt-BR.json';
import ruRU from './locales/ru-RU.json';
import frFR from './locales/fr-FR.json';
import deDE from './locales/de-DE.json';

export const supportedLocales = [
  'zh-CN',
  'zh-TW',
  'en-US',
  'ja-JP',
  'ko-KR',
  'vi-VN',
  'es-ES',
  'pt-BR',
  'ru-RU',
  'fr-FR',
  'de-DE',
] as const;

export type Locale = typeof supportedLocales[number];
type Messages = Record<string, unknown>;

export interface LocaleOption {
  value: Locale;
  nativeLabel: string;
  shortLabel: string;
}

export const defaultLocale: Locale = 'zh-CN';
export const localeStorageKey = 'xxt-cloud-locale';
export const localeOptions: readonly LocaleOption[] = [
  { value: 'zh-CN', nativeLabel: '简体中文', shortLabel: '简' },
  { value: 'zh-TW', nativeLabel: '繁體中文', shortLabel: '繁' },
  { value: 'en-US', nativeLabel: 'English', shortLabel: 'EN' },
  { value: 'ja-JP', nativeLabel: '日本語', shortLabel: '日' },
  { value: 'ko-KR', nativeLabel: '한국어', shortLabel: '한' },
  { value: 'vi-VN', nativeLabel: 'Tiếng Việt', shortLabel: 'VI' },
  { value: 'es-ES', nativeLabel: 'Español', shortLabel: 'ES' },
  { value: 'pt-BR', nativeLabel: 'Português (Brasil)', shortLabel: 'PT' },
  { value: 'ru-RU', nativeLabel: 'Русский', shortLabel: 'RU' },
  { value: 'fr-FR', nativeLabel: 'Français', shortLabel: 'FR' },
  { value: 'de-DE', nativeLabel: 'Deutsch', shortLabel: 'DE' },
];

type I18nContextValue = {
  locale: () => Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, vars?: Record<string, unknown>) => string;
};

const localeAliases: Record<string, Locale> = {
  zh: 'zh-CN',
  'zh-cn': 'zh-CN',
  'zh-hans': 'zh-CN',
  'zh-chs': 'zh-CN',
  'zh-sg': 'zh-CN',
  cn: 'zh-CN',
  'zh-tw': 'zh-TW',
  'zh-hant': 'zh-TW',
  'zh-cht': 'zh-TW',
  'zh-hk': 'zh-TW',
  'zh-mo': 'zh-TW',
  tw: 'zh-TW',
  en: 'en-US',
  'en-us': 'en-US',
  'en-gb': 'en-US',
  ja: 'ja-JP',
  jp: 'ja-JP',
  ko: 'ko-KR',
  kr: 'ko-KR',
  vi: 'vi-VN',
  vn: 'vi-VN',
  es: 'es-ES',
  pt: 'pt-BR',
  'pt-br': 'pt-BR',
  br: 'pt-BR',
  ru: 'ru-RU',
  fr: 'fr-FR',
  de: 'de-DE',
};

const baseLanguageLocales: Record<string, Locale> = {
  zh: 'zh-CN',
  en: 'en-US',
  ja: 'ja-JP',
  ko: 'ko-KR',
  vi: 'vi-VN',
  es: 'es-ES',
  pt: 'pt-BR',
  ru: 'ru-RU',
  fr: 'fr-FR',
  de: 'de-DE',
};

const dictionaries: Record<Locale, Messages> = {
  'zh-CN': zhCN as Messages,
  'zh-TW': zhTW as Messages,
  'en-US': enUS as Messages,
  'ja-JP': jaJP as Messages,
  'ko-KR': koKR as Messages,
  'vi-VN': viVN as Messages,
  'es-ES': esES as Messages,
  'pt-BR': ptBR as Messages,
  'ru-RU': ruRU as Messages,
  'fr-FR': frFR as Messages,
  'de-DE': deDE as Messages,
};

const fallbackLocales: Record<Locale, readonly Locale[]> = {
  'zh-CN': [],
  'zh-TW': ['zh-CN'],
  'en-US': [],
  'ja-JP': ['en-US'],
  'ko-KR': ['en-US'],
  'vi-VN': ['en-US'],
  'es-ES': ['en-US'],
  'pt-BR': ['en-US'],
  'ru-RU': ['en-US'],
  'fr-FR': ['en-US'],
  'de-DE': ['en-US'],
};

const pluralCategories = new Set<Intl.LDMLPluralRule>([
  'zero',
  'one',
  'two',
  'few',
  'many',
  'other',
]);
const pluralRules = new Map<Locale, Intl.PluralRules>();

const I18nContext = createContext<I18nContextValue>();
let activeLocale: Locale | null = null;

export function normalizeLocale(input: string | null | undefined): Locale | null {
  const normalized = (input || '').trim().replace(/_/g, '-').toLowerCase();
  if (!normalized) return null;
  if (localeAliases[normalized]) return localeAliases[normalized];
  const supported = supportedLocales.find(locale => locale.toLowerCase() === normalized);
  if (supported) return supported;

  const parts = normalized.split('-');
  if (parts[0] === 'zh') {
    if (parts.includes('hans')) return 'zh-CN';
    if (parts.includes('hant')) return 'zh-TW';
    return parts.some(part => part === 'tw' || part === 'hk' || part === 'mo') ? 'zh-TW' : 'zh-CN';
  }
  return baseLanguageLocales[parts[0]] ?? null;
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

function isPluralLeaf(value: unknown): value is Partial<Record<Intl.LDMLPluralRule, string>> & { other: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value as Record<string, unknown>);
  return entries.length > 0
    && entries.every(([category, message]) => pluralCategories.has(category as Intl.LDMLPluralRule) && typeof message === 'string')
    && typeof (value as Record<string, unknown>).other === 'string';
}

function resolveMessage(value: unknown, locale: Locale, vars?: Record<string, unknown>): string | null {
  if (typeof value === 'string') return value;
  if (!isPluralLeaf(value)) return null;

  const rawCount = vars?.count;
  const count = typeof rawCount === 'number' ? rawCount : Number(rawCount);
  if (!Number.isFinite(count)) return value.other;

  let rules = pluralRules.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    pluralRules.set(locale, rules);
  }
  return value[rules.select(count)] ?? value.other;
}

export function translate(locale: Locale, key: string, vars?: Record<string, unknown>): string {
  for (const candidate of [locale, ...fallbackLocales[locale]]) {
    const message = resolveMessage(getValue(dictionaries[candidate], key), candidate, vars);
    if (message !== null) return interpolate(message, vars);
  }
  return key;
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

  onCleanup(() => {
    if (activeLocale === locale()) {
      activeLocale = null;
    }
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
