import { describe, expect, it } from 'vitest';
import zhCN from '../locales/zh-CN.json';
import enUS from '../locales/en-US.json';
import { defaultLocale, normalizeLocale, translate } from '../index';

function flattenKeys(value: unknown, prefix = ''): string[] {
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      return flattenKeys(child, nextKey);
    }
    return [nextKey];
  });
}

describe('i18n helpers', () => {
  it('normalizes supported locale aliases', () => {
    expect(normalizeLocale('zh')).toBe('zh-CN');
    expect(normalizeLocale('zh_Hans')).toBe('zh-CN');
    expect(normalizeLocale('en')).toBe('en-US');
    expect(normalizeLocale('en_GB')).toBe('en-US');
    expect(normalizeLocale('fr-FR')).toBeNull();
  });

  it('interpolates values and falls back to zh-CN', () => {
    expect(translate('en-US', 'login.server_version', { version: '1.2.3' })).toBe('Server version: 1.2.3');
    expect(translate('en-US', 'missing.key')).toBe('missing.key');
    expect(translate(defaultLocale, 'app.update.completed', { version: '1.2.3' })).toBe('更新完成，当前版本 1.2.3');
  });

  it('keeps zh-CN and en-US locale keys in sync', () => {
    expect(flattenKeys(enUS).sort()).toEqual(flattenKeys(zhCN).sort());
  });
});
