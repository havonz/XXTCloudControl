import { describe, expect, it } from 'vitest';
import { buildBatchSnapshotFeedback } from '../batchSnapshotFeedback';

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
    expect(feedback.toastMessage).toBe('已保存 2 台设备截图');
    expect(feedback.perDeviceMessages).toEqual({
      a: '截图已保存: files/snapshots/A.png',
      b: '截图已保存',
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
    expect(feedback.toastMessage).toBe('已保存 1 台设备截图，1 台失败');
    expect(feedback.perDeviceMessages.b).toBe('截图失败: request timeout');
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
    expect(feedback.toastMessage).toBe('批量截图失败（2 台）');
    expect(feedback.perDeviceMessages).toEqual({
      a: '截图失败: device is offline',
      b: '截图失败: 未返回结果',
    });
  });
});
