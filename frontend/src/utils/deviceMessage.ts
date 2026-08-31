export type MessageTranslator = (key: string, vars?: Record<string, unknown>) => string;

export interface DeviceSystemMessage {
  message?: string;
  messageCode?: string;
  messageParams?: Record<string, unknown>;
}

export interface LocalDeviceMessage {
  code?: string;
  params?: Record<string, unknown>;
  fallback?: string;
  detail?: string;
}

export function resolveLocalDeviceMessage(message: LocalDeviceMessage, t: MessageTranslator): string {
  const detail = message.detail?.trim();
  if (message.code) {
    const localized = t(message.code, message.params);
    if (localized !== message.code) return detail ? `${localized}: ${detail}` : localized;
  }
  const fallback = message.fallback || '';
  return detail && fallback ? `${fallback}: ${detail}` : fallback;
}

export function resolveDeviceSystemMessage(
  system: DeviceSystemMessage | null | undefined,
  t: MessageTranslator,
): string {
  return resolveLocalDeviceMessage({
    code: system?.messageCode,
    params: system?.messageParams,
    fallback: typeof system?.message === 'string' ? system.message : undefined,
  }, t);
}
