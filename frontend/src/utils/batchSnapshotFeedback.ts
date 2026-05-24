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

type Translate = (key: string, vars?: Record<string, unknown>) => string;

const fallbackTranslate: Translate = (key, vars) => {
  const messages: Record<string, string> = {
    'device_list.screenshot_saved': '截图已保存',
    'device_list.screenshot_saved_path': '截图已保存: {path}',
    'device_list.screenshot_failed': '截图失败: {msg}',
    'device_list.no_result': '未返回结果',
    'device_list.batch_snapshot_saved': '已保存 {count} 台设备截图',
    'device_list.batch_snapshot_partial': '已保存 {success} 台设备截图，{fail} 台失败',
    'device_list.batch_snapshot_failed_count': '批量截图失败（{count} 台）',
  };
  const template = messages[key] ?? key;
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (match, name) => String(vars?.[name] ?? match));
};

export function buildBatchSnapshotFeedback(
  deviceIds: string[],
  results: BatchScreenshotSaveResult[],
  t: Translate = fallbackTranslate,
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
      perDeviceMessages[udid] = result.path
        ? t('device_list.screenshot_saved_path', { path: result.path })
        : t('device_list.screenshot_saved');
      continue;
    }

    failureCount += 1;
    const reason = result?.error?.trim() || t('device_list.no_result');
    perDeviceMessages[udid] = t('device_list.screenshot_failed', { msg: reason });
  }

  if (failureCount === 0) {
    return {
      successCount,
      failureCount,
      perDeviceMessages,
      toastType: 'success',
      toastMessage: t('device_list.batch_snapshot_saved', { count: successCount }),
    };
  }

  if (successCount > 0) {
    return {
      successCount,
      failureCount,
      perDeviceMessages,
      toastType: 'warning',
      toastMessage: t('device_list.batch_snapshot_partial', { success: successCount, fail: failureCount }),
    };
  }

  return {
    successCount,
    failureCount,
    perDeviceMessages,
    toastType: 'error',
    toastMessage: t('device_list.batch_snapshot_failed_count', { count: failureCount }),
  };
}
