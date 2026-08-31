export const DEVICE_SELECTED_SCRIPT = '__device_selected__';
export const LEGACY_DEVICE_SELECTED_SCRIPT = '<设备端已选中>';

export function isDeviceSelectedScript(value: string | null | undefined): boolean {
  return value === DEVICE_SELECTED_SCRIPT || value === LEGACY_DEVICE_SELECTED_SCRIPT;
}

export function normalizeDeviceSelectedScript(value: string | null | undefined): string {
  return isDeviceSelectedScript(value) ? DEVICE_SELECTED_SCRIPT : (value || '');
}
