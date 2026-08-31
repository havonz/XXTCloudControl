import { describe, expect, it } from 'vitest';
import {
  DEVICE_SELECTED_SCRIPT,
  LEGACY_DEVICE_SELECTED_SCRIPT,
  isDeviceSelectedScript,
  normalizeDeviceSelectedScript,
} from '../scriptSelection';

describe('device-selected script sentinel', () => {
  it('recognizes the stable and legacy values', () => {
    expect(isDeviceSelectedScript(DEVICE_SELECTED_SCRIPT)).toBe(true);
    expect(isDeviceSelectedScript(LEGACY_DEVICE_SELECTED_SCRIPT)).toBe(true);
    expect(isDeviceSelectedScript('main.lua')).toBe(false);
  });

  it('migrates the legacy value without changing script names', () => {
    expect(normalizeDeviceSelectedScript(LEGACY_DEVICE_SELECTED_SCRIPT)).toBe(DEVICE_SELECTED_SCRIPT);
    expect(normalizeDeviceSelectedScript('main.lua')).toBe('main.lua');
    expect(normalizeDeviceSelectedScript(undefined)).toBe('');
  });
});
