import { getCurrentLocale, translate } from '../i18n';
import { resolveLocalDeviceMessage, type LocalDeviceMessage } from './deviceMessage';

export type BatchScreenshotSaveResult = {
  udid: string;
  ok: boolean;
  path?: string;
  error?: string;
  errorCode?: string;
  errorParams?: Record<string, unknown>;
  detail?: string;
};

export type BatchSnapshotToastType = 'success' | 'warning' | 'error';

export type BatchSnapshotFeedback = {
  successCount: number;
  failureCount: number;
  perDeviceMessages: Record<string, string>;
  perDeviceMessageDescriptors: Record<string, LocalDeviceMessage>;
  toastType: BatchSnapshotToastType;
  toastMessage: string;
};

type Translate = (key: string, vars?: Record<string, unknown>) => string;

const fallbackTranslate: Translate = (key, vars) => translate(getCurrentLocale(), key, vars);

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
  const perDeviceMessageDescriptors: Record<string, LocalDeviceMessage> = {};
  let successCount = 0;
  let failureCount = 0;

  for (const udid of deviceIds) {
    const result = resultMap.get(udid);
    if (result?.ok) {
      successCount += 1;
      perDeviceMessages[udid] = result.path
        ? t('device_list.screenshot_saved_path', { path: result.path })
        : t('device_list.screenshot_saved');
      perDeviceMessageDescriptors[udid] = result.path
        ? { code: 'device_list.screenshot_saved_path', params: { path: result.path } }
        : { code: 'device_list.screenshot_saved' };
      continue;
    }

    failureCount += 1;
    const errorCode = result?.errorCode?.trim();
    const error = result?.error?.trim();
    const detail = result?.detail?.trim();
    if (errorCode) {
      const descriptor: LocalDeviceMessage = {
        code: errorCode,
        params: result?.errorParams,
        fallback: error,
        detail,
      };
      perDeviceMessageDescriptors[udid] = descriptor;
      perDeviceMessages[udid] = resolveLocalDeviceMessage(descriptor, t) || t('device_list.no_result');
      continue;
    }

    const reason = error || t('device_list.no_result');
    perDeviceMessages[udid] = t('device_list.screenshot_failed', { msg: reason });
    perDeviceMessageDescriptors[udid] = error
      ? { code: 'device_list.screenshot_failed', params: { msg: error } }
      : { code: 'device_list.screenshot_failed_no_result' };
  }

  if (failureCount === 0) {
    return {
      successCount,
      failureCount,
      perDeviceMessages,
      perDeviceMessageDescriptors,
      toastType: 'success',
      toastMessage: t('device_list.batch_snapshot_saved', { count: successCount }),
    };
  }

  if (successCount > 0) {
    return {
      successCount,
      failureCount,
      perDeviceMessages,
      perDeviceMessageDescriptors,
      toastType: 'warning',
      toastMessage: t('device_list.batch_snapshot_partial', { success: successCount, fail: failureCount }),
    };
  }

  return {
    successCount,
    failureCount,
    perDeviceMessages,
    perDeviceMessageDescriptors,
    toastType: 'error',
    toastMessage: t('device_list.batch_snapshot_failed_count', { count: failureCount }),
  };
}
