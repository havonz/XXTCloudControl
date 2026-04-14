export type BatchScreenshotSaveResult = {
  udid: string;
  ok: boolean;
  path?: string;
  error?: string;
};

export type BatchSnapshotToastType = 'success' | 'warning' | 'error';

export type BatchSnapshotFeedback = {
  successCount: number;
  failureCount: number;
  perDeviceMessages: Record<string, string>;
  toastType: BatchSnapshotToastType;
  toastMessage: string;
};

export function buildBatchSnapshotFeedback(
  deviceIds: string[],
  results: BatchScreenshotSaveResult[],
): BatchSnapshotFeedback {
  const resultMap = new Map<string, BatchScreenshotSaveResult>();
  for (const item of results) {
    if (item?.udid) {
      resultMap.set(item.udid, item);
    }
  }

  const perDeviceMessages: Record<string, string> = {};
  let successCount = 0;
  let failureCount = 0;

  for (const udid of deviceIds) {
    const result = resultMap.get(udid);
    if (result?.ok) {
      successCount += 1;
      perDeviceMessages[udid] = result.path ? `截图已保存: ${result.path}` : '截图已保存';
      continue;
    }

    failureCount += 1;
    const reason = result?.error?.trim() || '未返回结果';
    perDeviceMessages[udid] = `截图失败: ${reason}`;
  }

  if (failureCount === 0) {
    return {
      successCount,
      failureCount,
      perDeviceMessages,
      toastType: 'success',
      toastMessage: `已保存 ${successCount} 台设备截图`,
    };
  }

  if (successCount > 0) {
    return {
      successCount,
      failureCount,
      perDeviceMessages,
      toastType: 'warning',
      toastMessage: `已保存 ${successCount} 台设备截图，${failureCount} 台失败`,
    };
  }

  return {
    successCount,
    failureCount,
    perDeviceMessages,
    toastType: 'error',
    toastMessage: `批量截图失败（${failureCount} 台）`,
  };
}
