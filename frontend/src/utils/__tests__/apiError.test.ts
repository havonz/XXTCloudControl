import { describe, expect, it } from 'vitest';
import { localizeApiError, localizeApiErrorItems } from '../apiError';

describe('structured API errors', () => {
  it('prefers a locally translated error code and keeps detail separate', () => {
    const result = localizeApiError({
      error: '服务端旧文案',
      errorCode: 'error.sample',
      errorParams: { name: 'demo.lua' },
      detail: 'disk I/O',
    }, (key, vars) => key === 'error.sample' ? `Failed: ${vars?.name}` : key, 'Fallback');

    expect(result).toEqual({
      message: 'Failed: demo.lua',
      code: 'error.sample',
      params: { name: 'demo.lua' },
      detail: 'disk I/O',
    });
  });

  it('falls back to the legacy message when a local key is unavailable', () => {
    const result = localizeApiError({
      error: 'Localized by server',
      errorCode: 'error.not_in_frontend',
    }, key => key, 'Fallback');

    expect(result.message).toBe('Localized by server');
    expect(result.detail).toBeUndefined();
  });

  it('localizes structured batch items and keeps their detail visible', () => {
    const errors = localizeApiErrorItems({
      errorItems: [{
        item: 'demo.lua',
        error: '旧服务端文案',
        errorCode: 'error.sample',
        errorParams: { name: 'demo.lua' },
        detail: 'permission denied',
      }],
      errors: ['demo.lua: old error'],
    }, (key, vars) => key === 'error.sample' ? `Failed: ${vars?.name}` : key, 'Fallback');

    expect(errors).toEqual(['demo.lua: Failed: demo.lua (permission denied)']);
  });

  it('falls back to legacy batch errors when structured items are absent', () => {
    expect(localizeApiErrorItems({ errors: ['a: old error', 'b: old error'] }, () => 'unused', 'Fallback'))
      .toEqual(['a: old error', 'b: old error']);
  });
});
