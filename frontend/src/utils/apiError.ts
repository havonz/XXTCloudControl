export type ApiErrorTranslator = (key: string, vars?: Record<string, unknown>) => string;

export interface LocalizedApiError {
  message: string;
  code?: string;
  params?: Record<string, unknown>;
  detail?: string;
}

export function localizeApiError(
  payload: unknown,
  t: ApiErrorTranslator,
  fallback: string,
): LocalizedApiError {
  const body = payload && typeof payload === 'object'
    ? payload as Record<string, unknown>
    : {};
  const code = typeof body.errorCode === 'string' && body.errorCode.trim()
    ? body.errorCode.trim()
    : undefined;
  const params = body.errorParams && typeof body.errorParams === 'object' && !Array.isArray(body.errorParams)
    ? body.errorParams as Record<string, unknown>
    : undefined;
  const translated = code ? t(code, params) : '';
  const legacyMessage = typeof body.error === 'string' && body.error.trim()
    ? body.error.trim()
    : '';
  const detail = typeof body.detail === 'string' && body.detail.trim()
    ? body.detail.trim()
    : undefined;

  return {
    message: translated && translated !== code ? translated : (legacyMessage || fallback),
    ...(code ? { code } : {}),
    ...(params ? { params } : {}),
    ...(detail ? { detail } : {}),
  };
}

export function localizeApiErrorItems(
  payload: unknown,
  t: ApiErrorTranslator,
  fallback: string,
): string[] {
  const body = payload && typeof payload === 'object'
    ? payload as Record<string, unknown>
    : {};
  const errorItems = Array.isArray(body.errorItems) ? body.errorItems : [];
  const localizedItems = errorItems
    .map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return '';
      }

      const record = item as Record<string, unknown>;
      const itemName = typeof record.item === 'string' ? record.item.trim() : '';
      const localized = localizeApiError(record, t, fallback);
      if (!localized.message.trim()) {
        return itemName;
      }

      const detail = localized.detail && localized.detail !== localized.message
        ? ` (${localized.detail})`
        : '';
      const message = `${localized.message}${detail}`;
      return itemName ? `${itemName}: ${message}` : message;
    })
    .filter((message): message is string => message.length > 0);

  if (localizedItems.length > 0) {
    return localizedItems;
  }

  return Array.isArray(body.errors)
    ? body.errors.filter((error): error is string => typeof error === 'string' && error.trim().length > 0)
    : [];
}
