type DebugValue = string | boolean | null | undefined;

const parseDebugFlag = (value: DebugValue): boolean => {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value !== 'string') {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') {
    return true;
  }
  if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') {
    return false;
  }
  return true;
};

const readStorageFlag = (key: string): boolean => {
  if (typeof localStorage === 'undefined') {
    return false;
  }
  try {
    return parseDebugFlag(localStorage.getItem(key));
  } catch {
    return false;
  }
};

const env = (import.meta as any)?.env ?? {};
const globalEnvDebug = parseDebugFlag(env.VITE_XXT_DEBUG);
const globalStorageDebug = readStorageFlag('xxt_debug');

const scopeEnvDebug: Record<string, boolean> = {
  ws: parseDebugFlag(env.VITE_XXT_WS_DEBUG),
  transfer: parseDebugFlag(env.VITE_XXT_TRANSFER_DEBUG),
  webrtc: parseDebugFlag(env.VITE_XXT_WEBRTC_DEBUG),
  batch_remote: parseDebugFlag(env.VITE_XXT_BATCH_REMOTE_DEBUG),
  ui: parseDebugFlag(env.VITE_XXT_UI_DEBUG),
  auth: parseDebugFlag(env.VITE_XXT_AUTH_DEBUG),
};

const scopeStorageCache = new Map<string, boolean>();

const normalizeScope = (scope: string): string => (
  scope.trim().toLowerCase().replace(/\s+/g, '_')
);

export const isDebugLogEnabled = (scope?: string): boolean => {
  if (globalEnvDebug || globalStorageDebug) {
    return true;
  }

  if (!scope) {
    return false;
  }

  const normalizedScope = normalizeScope(scope);
  if (scopeEnvDebug[normalizedScope]) {
    return true;
  }

  const cached = scopeStorageCache.get(normalizedScope);
  if (cached !== undefined) {
    return cached;
  }

  const enabled = readStorageFlag(`xxt_debug_${normalizedScope}`);
  scopeStorageCache.set(normalizedScope, enabled);
  return enabled;
};

export const debugLog = (scope: string, ...args: unknown[]) => {
  if (!isDebugLogEnabled(scope)) {
    return;
  }
  console.log(...args);
};

export const debugWarn = (scope: string, ...args: unknown[]) => {
  if (!isDebugLogEnabled(scope)) {
    return;
  }
  console.warn(...args);
};
