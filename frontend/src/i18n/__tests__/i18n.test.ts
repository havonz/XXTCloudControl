import { afterEach, describe, expect, it, vi } from 'vitest';
import zhCN from '../locales/zh-CN.json';
import zhTW from '../locales/zh-TW.json';
import enUS from '../locales/en-US.json';
import jaJP from '../locales/ja-JP.json';
import koKR from '../locales/ko-KR.json';
import viVN from '../locales/vi-VN.json';
import esES from '../locales/es-ES.json';
import ptBR from '../locales/pt-BR.json';
import ruRU from '../locales/ru-RU.json';
import frFR from '../locales/fr-FR.json';
import deDE from '../locales/de-DE.json';
import {
  defaultLocale,
  getBrowserLocale,
  getInitialLocale,
  localeOptions,
  normalizeLocale,
  readStoredLocale,
  supportedLocales,
  translate,
  type Locale,
} from '../index';

const localeMessages: Record<Locale, unknown> = {
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  'en-US': enUS,
  'ja-JP': jaJP,
  'ko-KR': koKR,
  'vi-VN': viVN,
  'es-ES': esES,
  'pt-BR': ptBR,
  'ru-RU': ruRU,
  'fr-FR': frFR,
  'de-DE': deDE,
};

const pluralCategories = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);

function isPluralLeaf(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value as Record<string, unknown>);
  return entries.length > 0
    && entries.every(([key, message]) => pluralCategories.has(key) && typeof message === 'string')
    && typeof (value as Record<string, unknown>).other === 'string';
}

function flattenMessages(value: unknown, prefix = '', result = new Map<string, string[]>()): Map<string, string[]> {
  if (typeof value === 'string') {
    result.set(prefix, [value]);
    return result;
  }
  if (isPluralLeaf(value)) {
    result.set(prefix, Object.values(value));
    return result;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    flattenMessages(child, prefix ? `${prefix}.${key}` : key, result);
  }
  return result;
}

function placeholders(message: string): string[] {
  return Array.from(message.matchAll(/\{\{?([A-Za-z0-9_]+)\}?\}/g), match => match[1]).sort();
}

describe('i18n helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('normalizes exact, script, region, and base-language aliases', () => {
    const aliases: Array<[string, Locale]> = [
      ['zh', 'zh-CN'],
      ['zh-cn', 'zh-CN'],
      ['zh-hans', 'zh-CN'],
      ['zh-chs', 'zh-CN'],
      ['zh-sg', 'zh-CN'],
      ['cn', 'zh-CN'],
      ['zh-tw', 'zh-TW'],
      ['zh-hant', 'zh-TW'],
      ['zh-cht', 'zh-TW'],
      ['zh-hk', 'zh-TW'],
      ['zh-mo', 'zh-TW'],
      ['tw', 'zh-TW'],
      ['en', 'en-US'],
      ['en-us', 'en-US'],
      ['en-gb', 'en-US'],
      ['ja', 'ja-JP'],
      ['jp', 'ja-JP'],
      ['ko', 'ko-KR'],
      ['kr', 'ko-KR'],
      ['vi', 'vi-VN'],
      ['vn', 'vi-VN'],
      ['es', 'es-ES'],
      ['pt', 'pt-BR'],
      ['pt-br', 'pt-BR'],
      ['br', 'pt-BR'],
      ['ru', 'ru-RU'],
      ['fr', 'fr-FR'],
      ['de', 'de-DE'],
    ];
    for (const [alias, locale] of aliases) {
      expect(normalizeLocale(alias), alias).toBe(locale);
    }
    expect(normalizeLocale('zh_Hans_HK')).toBe('zh-CN');
    expect(normalizeLocale('zh-Hant-CN')).toBe('zh-TW');
    expect(normalizeLocale('zh-HK')).toBe('zh-TW');
    expect(normalizeLocale('en_GB')).toBe('en-US');
    expect(normalizeLocale('ja')).toBe('ja-JP');
    expect(normalizeLocale('es-MX')).toBe('es-ES');
    expect(normalizeLocale('pt-PT')).toBe('pt-BR');
    expect(normalizeLocale('fr-CA')).toBe('fr-FR');
    expect(normalizeLocale('de-AT')).toBe('de-DE');
    expect(normalizeLocale('ar-SA')).toBeNull();
  });

  it('lists each supported locale once with display metadata', () => {
    expect(supportedLocales).toHaveLength(11);
    expect(localeOptions.map(option => option.value)).toEqual([...supportedLocales]);
    expect(new Set(localeOptions.map(option => option.nativeLabel)).size).toBe(11);
    expect(new Set(localeOptions.map(option => option.shortLabel)).size).toBe(11);
  });

  it('prefers stored locale, then browser locale, then the default', () => {
    vi.stubGlobal('window', {
      localStorage: { getItem: () => 'ru-RU' },
      navigator: { languages: ['fr-CA'], language: 'fr-CA' },
    });
    expect(readStoredLocale()).toBe('ru-RU');
    expect(getBrowserLocale()).toBe('fr-FR');
    expect(getInitialLocale()).toBe('ru-RU');

    vi.stubGlobal('window', {
      localStorage: { getItem: () => 'unsupported' },
      navigator: { languages: ['ko-KR'], language: 'en-US' },
    });
    expect(getInitialLocale()).toBe('ko-KR');

    vi.stubGlobal('window', {
      localStorage: { getItem: () => null },
      navigator: { languages: [], language: 'unsupported' },
    });
    expect(getInitialLocale()).toBe(defaultLocale);
  });

  it('interpolates values and returns the key when no locale has a message', () => {
    expect(translate('en-US', 'login.server_version', { version: '1.2.3' })).toBe('Server version: 1.2.3');
    expect(translate('en-US', 'missing.key')).toBe('missing.key');
    expect(translate(defaultLocale, 'app.update.completed', { version: '1.2.3' })).toBe('更新完成，当前版本 1.2.3');
    expect(translate('zh-CN', 'error.update.download_failed')).toBe('下载更新失败');
    expect(translate('zh-CN', 'error.device.offline')).toBe('设备离线');
  });

  it('falls back from non-Chinese locales to English and from Traditional to Simplified Chinese', () => {
    const esCommon = (esES as { common: Record<string, unknown> }).common;
    const zhTWCommon = (zhTW as { common: Record<string, unknown> }).common;
    const savedSpanish = esCommon.add;
    const savedTraditional = zhTWCommon.add;

    try {
      delete esCommon.add;
      delete zhTWCommon.add;
      expect(translate('es-ES', 'common.add')).toBe('Add');
      expect(translate('zh-TW', 'common.add')).toBe('添加');
    } finally {
      esCommon.add = savedSpanish;
      zhTWCommon.add = savedTraditional;
    }
  });

  it('selects plural leaf messages with Intl.PluralRules', () => {
    const group = (ruRU as { group: Record<string, unknown> }).group;
    const saved = group.device_count;
    group.device_count = {
      one: '{count} устройство',
      few: '{count} устройства',
      many: '{count} устройств',
      other: '{count} устройства',
    };

    try {
      expect(translate('ru-RU', 'group.device_count', { count: 1 })).toBe('1 устройство');
      expect(translate('ru-RU', 'group.device_count', { count: 2 })).toBe('2 устройства');
      expect(translate('ru-RU', 'group.device_count', { count: 5 })).toBe('5 устройств');
    } finally {
      group.device_count = saved;
    }
  });

  it('translates representative server device message codes in every locale', () => {
    const codes = [
      'device.command.script_run',
      'device.script.upload_summary',
      'device.script.waiting_for_transfers',
      'device.transfer.send_file',
      'error.device.not_connected',
      'error.device.named_not_connected',
      'error.request.failed',
    ];

    for (const locale of supportedLocales) {
      for (const code of codes) {
        expect(translate(locale, code, {
          small: 2,
          large: 1,
          count: 1,
          name: 'main.lua',
          device: 'demo',
        }), `${locale}:${code}`).not.toBe(code);
      }
    }
  });

  it('keeps every locale complete, non-empty, and placeholder-compatible', () => {
    const baseline = flattenMessages(enUS);
    const baselineKeys = [...baseline.keys()].sort();

    for (const locale of supportedLocales) {
      const messages = flattenMessages(localeMessages[locale]);
      expect([...messages.keys()].sort(), `${locale} keys`).toEqual(baselineKeys);

      for (const key of baselineKeys) {
        const expectedPlaceholders = placeholders(baseline.get(key)![0]);
        for (const message of messages.get(key) || []) {
          expect(message.trim().length, `${locale}:${key} must not be empty`).toBeGreaterThan(0);
          expect(placeholders(message), `${locale}:${key} placeholders`).toEqual(expectedPlaceholders);
        }
      }
    }
  });

  it('does not ship a locale as an English dictionary copy', () => {
    const english = flattenMessages(enUS);
    for (const locale of supportedLocales.filter(locale => locale !== 'en-US')) {
      const messages = flattenMessages(localeMessages[locale]);
      const identical = [...english.keys()].filter(key => {
        const source = english.get(key)?.[0];
        return messages.get(key)?.every(message => message === source);
      });
      expect(identical.length / english.size, `${locale} English-copy ratio`).toBeLessThan(0.65);
    }
  });
});
