import type { ApiErrorTranslator, LocalizedApiError } from './apiError';

export interface UpdateErrorState {
  lastError?: string;
  lastErrorCode?: string;
  lastErrorParams?: Record<string, unknown>;
  lastErrorDetail?: string;
}

export function localizeUpdateError(
  state: UpdateErrorState | null | undefined,
  t: ApiErrorTranslator,
): LocalizedApiError {
  const code = state?.lastErrorCode;
  const translated = code ? t(code, state?.lastErrorParams) : '';
  return {
    message: translated && translated !== code ? translated : (state?.lastError || ''),
    ...(code ? { code } : {}),
    ...(state?.lastErrorParams ? { params: state.lastErrorParams } : {}),
    ...(state?.lastErrorDetail ? { detail: state.lastErrorDetail } : {}),
  };
}
