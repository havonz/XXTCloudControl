export type RemoteWheelSettingKey =
  | 'stepPx'
  | 'coalesceMs'
  | 'amp'
  | 'durBaseMs'
  | 'releaseDelayMs'
  | 'brakeReversePx';

export type RemoteWheelSettings = {
  enabled: boolean;
  natural: boolean;
  brakeEnabled: boolean;
  stepPx: number;
  coalesceMs: number;
  amp: number;
  durBaseMs: number;
  releaseDelayMs: number;
  brakeReversePx: number;
};

export type RemoteWheelSettingsInput = Partial<Record<keyof RemoteWheelSettings, unknown>>;

export type RemoteWheelPayload = {
  targets?: string[];
  nx: number;
  ny: number;
  deltaY: number;
  rotateQuarter: number;
  settings: RemoteWheelSettings;
  mergeKey?: string;
};

export interface RemoteWheelBatcher {
  hasPending: () => boolean;
  schedule: (payload: RemoteWheelPayload) => void;
  flush: () => void;
  clear: () => void;
}

const REMOTE_WHEEL_LIMITS: Record<RemoteWheelSettingKey, readonly [number, number]> = {
  stepPx: [5, 1000],
  coalesceMs: [0, 200],
  amp: [0, 5],
  durBaseMs: [0, 800],
  releaseDelayMs: [0, 500],
  brakeReversePx: [2, 20],
};

export const REMOTE_WHEEL_DEFAULTS: Readonly<RemoteWheelSettings> = Object.freeze({
  enabled: false,
  natural: true,
  brakeEnabled: false,
  stepPx: 48,
  coalesceMs: 60,
  amp: 0.18,
  durBaseMs: 50,
  releaseDelayMs: 120,
  brakeReversePx: 5,
});

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function clampRemoteWheelSetting(key: RemoteWheelSettingKey, value: number): number {
  const [min, max] = REMOTE_WHEEL_LIMITS[key];
  return clamp(value, min, max);
}

export function parseRemoteWheelBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0') return false;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value !== 0;
  return fallback;
}

export function parseRemoteWheelSetting(
  key: RemoteWheelSettingKey,
  value: unknown,
  fallback = REMOTE_WHEEL_DEFAULTS[key],
): number {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  if (!Number.isFinite(parsed)) return fallback;
  return clampRemoteWheelSetting(key, parsed);
}

export function normalizeRemoteWheelSettings(
  partial?: RemoteWheelSettingsInput | null,
): RemoteWheelSettings {
  return {
    enabled: parseRemoteWheelBoolean(partial?.enabled, REMOTE_WHEEL_DEFAULTS.enabled),
    natural: parseRemoteWheelBoolean(partial?.natural, REMOTE_WHEEL_DEFAULTS.natural),
    brakeEnabled: parseRemoteWheelBoolean(partial?.brakeEnabled, REMOTE_WHEEL_DEFAULTS.brakeEnabled),
    stepPx: parseRemoteWheelSetting('stepPx', partial?.stepPx),
    coalesceMs: Math.round(parseRemoteWheelSetting('coalesceMs', partial?.coalesceMs)),
    amp: parseRemoteWheelSetting('amp', partial?.amp),
    durBaseMs: Math.round(parseRemoteWheelSetting('durBaseMs', partial?.durBaseMs)),
    releaseDelayMs: Math.round(parseRemoteWheelSetting('releaseDelayMs', partial?.releaseDelayMs)),
    brakeReversePx: Math.round(parseRemoteWheelSetting('brakeReversePx', partial?.brakeReversePx)),
  };
}

export function normalizeWheelDeltaY(
  deltaY: number,
  deltaMode: number,
  pageHeightPx: number,
  lineHeightPx = 16,
): number {
  if (!Number.isFinite(deltaY)) return 0;
  if (deltaMode === 1) return deltaY * lineHeightPx;
  if (deltaMode === 2) return deltaY * Math.max(pageHeightPx, lineHeightPx);
  return deltaY;
}

export function canHandleRemoteWheel(options: {
  enabled: boolean;
  pointerActive: boolean;
  deltaY: number;
}): boolean {
  return options.enabled && !options.pointerActive && Number.isFinite(options.deltaY) && Math.abs(options.deltaY) > 0.01;
}

export function createRemoteWheelBatcher(
  send: (payload: Omit<RemoteWheelPayload, 'mergeKey'>) => void,
  options?: {
    requestFrame?: typeof requestAnimationFrame;
    cancelFrame?: typeof cancelAnimationFrame;
  },
): RemoteWheelBatcher {
  const requestFrame = options?.requestFrame ?? requestAnimationFrame;
  const cancelFrame = options?.cancelFrame ?? cancelAnimationFrame;

  let pending: RemoteWheelPayload | undefined;
  let rafId: number | undefined;

  const emitPending = () => {
    if (!pending) return;
    const current = pending;
    pending = undefined;
    const { mergeKey: _mergeKey, ...payload } = current;
    send(payload);
  };

  const flush = () => {
    if (rafId !== undefined) {
      cancelFrame(rafId);
      rafId = undefined;
    }
    emitPending();
  };

  return {
    hasPending: () => pending !== undefined,
    schedule: (payload) => {
      if (!pending) {
        pending = payload;
      } else if ((pending.mergeKey ?? '') === (payload.mergeKey ?? '')) {
        pending = {
          ...payload,
          deltaY: pending.deltaY + payload.deltaY,
        };
      } else {
        flush();
        pending = payload;
      }

      if (rafId !== undefined) return;
      rafId = requestFrame(() => {
        rafId = undefined;
        emitPending();
      });
    },
    flush,
    clear: () => {
      pending = undefined;
      if (rafId !== undefined) {
        cancelFrame(rafId);
        rafId = undefined;
      }
    },
  };
}
