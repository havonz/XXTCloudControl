import { createContext, createEffect, createSignal, JSX, onCleanup, Show, useContext } from 'solid-js';
import enUS from './locales/en-US.json';
import LoadingState from '../components/LoadingState';

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

export const defaultLocale: Locale = 'en-US';
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
  setLocale: (locale: Locale) => Promise<void>;
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

const dictionaries: Partial<Record<Locale, Messages>> = {
  'en-US': enUS as Messages,
};

export const localeLoaders = {
  'zh-CN': () => import('./locales/zh-CN.json'),
  'zh-TW': () => import('./locales/zh-TW.json'),
  'ja-JP': () => import('./locales/ja-JP.json'),
  'ko-KR': () => import('./locales/ko-KR.json'),
  'vi-VN': () => import('./locales/vi-VN.json'),
  'es-ES': () => import('./locales/es-ES.json'),
  'pt-BR': () => import('./locales/pt-BR.json'),
  'ru-RU': () => import('./locales/ru-RU.json'),
  'fr-FR': () => import('./locales/fr-FR.json'),
  'de-DE': () => import('./locales/de-DE.json'),
};
const pendingLocaleLoads = new Map<Locale, Promise<void>>();

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

export async function loadLocaleMessages(locale: Locale): Promise<void> {
  await Promise.all([locale, ...fallbackLocales[locale]].map((candidate) => {
    if (dictionaries[candidate]) return;
    let pending = pendingLocaleLoads.get(candidate);
    if (!pending && candidate !== 'en-US') {
      pending = localeLoaders[candidate]()
        .then((module) => { dictionaries[candidate] = module.default; })
        .finally(() => { pendingLocaleLoads.delete(candidate); });
      pendingLocaleLoads.set(candidate, pending);
    }
    return pending;
  }));
}

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
    const messages = dictionaries[candidate];
    if (!messages) continue;
    const message = resolveMessage(getValue(messages, key), candidate, vars);
    if (message !== null) return interpolate(message, vars);
  }
  return key;
}

export function getCurrentLocale(): Locale {
  return activeLocale ?? readStoredLocale() ?? getBrowserLocale() ?? defaultLocale;
}

export function I18nProvider(props: { defaultLocale?: Locale; children: JSX.Element }) {
  const storedLocale = props.defaultLocale === undefined ? readStoredLocale() : null;
  const initialLocale = props.defaultLocale ?? storedLocale ?? getBrowserLocale() ?? defaultLocale;
  const [locale, setLocaleState] = createSignal<Locale>(initialLocale);
  const [ready, setReady] = createSignal(
    [initialLocale, ...fallbackLocales[initialLocale]].every(candidate => !!dictionaries[candidate]),
  );
  const [initialLoadFailed, setInitialLoadFailed] = createSignal(false);
  const t = (key: string, vars?: Record<string, unknown>) => translate(locale(), key, vars);
  let hasManualPreference = props.defaultLocale !== undefined || storedLocale !== null;
  let localeRequest = 0;
  let pendingManualRequest: number | null = null;
  let disposed = false;
  activeLocale = locale();

  const activateLocale = async (nextLocale: Locale, persist: boolean) => {
    const request = ++localeRequest;
    if (persist) pendingManualRequest = request;
    try {
      await loadLocaleMessages(nextLocale);
      if (disposed || request !== localeRequest) return;
      // 语言包齐备后再切换和保存，加载期间保留现有界面及用户正在编辑的内容。
      activeLocale = nextLocale;
      setLocaleState(nextLocale);
      setReady(true);
      if (persist) {
        hasManualPreference = true;
        try {
          window.localStorage.setItem(localeStorageKey, nextLocale);
        } catch {
          // 存储不可用时仍保留本次会话的语言选择。
        }
      }
    } catch (error) {
      if (disposed || request !== localeRequest) return;
      if (!ready()) setInitialLoadFailed(true);
      throw error;
    } finally {
      if (pendingManualRequest === request) pendingManualRequest = null;
    }
  };

  const setLocale = (nextLocale: Locale) => activateLocale(normalizeLocale(nextLocale) ?? defaultLocale, true);

  const handleLanguageChange = () => {
    if (hasManualPreference || pendingManualRequest !== null) return;
    const detectedLocale = getBrowserLocale() ?? defaultLocale;
    void activateLocale(detectedLocale, false).catch(() => {});
  };

  if (!ready()) void activateLocale(initialLocale, false).catch(() => {});
  window.addEventListener('languagechange', handleLanguageChange);

  createEffect(() => {
    const current = locale();
    activeLocale = current;
    document.documentElement.setAttribute('lang', current);
  });

  onCleanup(() => {
    disposed = true;
    localeRequest++;
    window.removeEventListener('languagechange', handleLanguageChange);
    if (activeLocale === locale()) {
      activeLocale = null;
    }
  });

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      <Show when={ready()} fallback={
        <LoadingState
          error={initialLoadFailed()}
          message={translate(defaultLocale, initialLoadFailed() ? 'common.load_failed' : 'common.loading')}
          refreshLabel={translate(defaultLocale, 'common.refresh')}
        />
      }>
        {props.children}
      </Show>
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
