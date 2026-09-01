import { describe, expect, it } from 'vitest';
import { buildBatchSnapshotFeedback } from '../batchSnapshotFeedback';
import { translate } from '../../i18n';

describe('buildBatchSnapshotFeedback', () => {
  it('全部成功时返回 success 汇总和保存消息', () => {
    const feedback = buildBatchSnapshotFeedback(
      ['a', 'b'],
      [
        { udid: 'a', ok: true, path: 'files/snapshots/A.png' },
        { udid: 'b', ok: true },
      ],
    );

    expect(feedback.successCount).toBe(2);
    expect(feedback.failureCount).toBe(0);
    expect(feedback.toastType).toBe('success');
    expect(feedback.toastMessage).toBe('Saved screenshots for 2 device(s)');
    expect(feedback.perDeviceMessages).toEqual({
      a: 'Screenshot saved: files/snapshots/A.png',
      b: 'Screenshot saved',
    });
  });

  it('部分失败时返回 warning 汇总并保留失败原因', () => {
    const feedback = buildBatchSnapshotFeedback(
      ['a', 'b'],
      [
        { udid: 'a', ok: true, path: 'files/snapshots/A.png' },
        { udid: 'b', ok: false, error: 'request timeout' },
      ],
    );

    expect(feedback.successCount).toBe(1);
    expect(feedback.failureCount).toBe(1);
    expect(feedback.toastType).toBe('warning');
    expect(feedback.toastMessage).toBe('Saved screenshots for 1 device(s), 1 failed');
    expect(feedback.perDeviceMessages.b).toBe('Screenshot failed: request timeout');
  });

  it('全部失败且缺失返回项时使用默认错误文案', () => {
    const feedback = buildBatchSnapshotFeedback(
      ['a', 'b'],
      [
        { udid: 'a', ok: false, error: 'device is offline' },
      ],
    );

    expect(feedback.successCount).toBe(0);
    expect(feedback.failureCount).toBe(2);
    expect(feedback.toastType).toBe('error');
    expect(feedback.toastMessage).toBe('Batch screenshot failed (2 device(s))');
    expect(feedback.perDeviceMessages).toEqual({
      a: 'Screenshot failed: device is offline',
      b: 'Screenshot failed: No result returned',
    });
  });

  it('优先使用结构化错误并附加 detail，按当前语言渲染', () => {
    const feedback = buildBatchSnapshotFeedback(
      ['a'],
      [{
        udid: 'a',
        ok: false,
        error: 'Device is offline',
        errorCode: 'error.device.offline',
        errorParams: {},
        detail: 'connection lost',
      }],
      (key) => key === 'error.device.offline' ? '设备离线' : key,
    );

    expect(feedback.perDeviceMessages.a).toBe('设备离线: connection lost');
    expect(feedback.perDeviceMessageDescriptors.a).toEqual({
      code: 'error.device.offline',
      params: {},
      fallback: 'Device is offline',
      detail: 'connection lost',
    });
  });

  it('结构化错误没有本地翻译时回退旧 error 字符串', () => {
    const feedback = buildBatchSnapshotFeedback(
      ['a'],
      [{
        udid: 'a',
        ok: false,
        error: 'legacy device error',
        errorCode: 'error.from_newer_server',
        detail: 'request id: 7',
      }],
      key => key,
    );

    expect(feedback.perDeviceMessages.a).toBe('legacy device error: request id: 7');
    expect(feedback.perDeviceMessageDescriptors.a).toEqual({
      code: 'error.from_newer_server',
      params: undefined,
      fallback: 'legacy device error',
      detail: 'request id: 7',
    });
  });

  it('使用实际词典按当前语言渲染结构化错误', () => {
    const feedback = buildBatchSnapshotFeedback(
      ['a'],
      [{ udid: 'a', ok: false, error: 'Device is offline', errorCode: 'error.device.offline' }],
      (key, params) => translate('zh-CN', key, params),
    );

    expect(feedback.perDeviceMessages.a).toBe('设备离线');
  });
});
