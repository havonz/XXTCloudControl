import type { Device } from '../services/AuthService';

function parsePort(value: unknown): number | undefined {
  const numericValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numericValue)) {
    return undefined;
  }

  if (numericValue <= 0 || numericValue > 65535) {
    return undefined;
  }

  return numericValue;
}

export function getDeviceHttpPort(device: Device | null | undefined): number | undefined {
  if (!device) {
    return undefined;
  }

  const candidates = [
    device.system?.port,
    device.system?.httpPort,
    device.system?.http_port,
    device.port,
    device.httpPort,
    device.http_port,
  ];

  for (const candidate of candidates) {
    const port = parsePort(candidate);
    if (port !== undefined) {
      return port;
    }
  }

  return undefined;
}
