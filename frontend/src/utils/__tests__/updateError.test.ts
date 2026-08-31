import { describe, expect, it } from 'vitest';
import { translate } from '../../i18n';
import { localizeUpdateError } from '../updateError';

describe('update state errors', () => {
  it('同一状态可随当前语言重新翻译并保留详情', () => {
    const state = {
      lastError: '下载更新失败',
      lastErrorCode: 'error.update.download_failed',
      lastErrorDetail: 'upstream timeout',
    };

    expect(localizeUpdateError(state, (key, vars) => translate('zh-CN', key, vars))).toEqual({
      message: '下载更新失败',
      code: 'error.update.download_failed',
      detail: 'upstream timeout',
    });
    expect(localizeUpdateError(state, (key, vars) => translate('en-US', key, vars)).message)
      .toBe('Failed to download the update');
  });

  it('本地缺少键时兼容旧 lastError', () => {
    expect(localizeUpdateError({
      lastError: 'Legacy error',
      lastErrorCode: 'error.legacy',
    }, key => key).message).toBe('Legacy error');
  });
});
