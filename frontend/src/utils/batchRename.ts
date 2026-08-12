export interface BatchRenamePatternDevice {
  ip?: string | null;
  devname?: string | null;
  devtype?: string | null;
  sysversion?: string | null;
  zeversion?: string | null;
}

export function formatBatchRenameName(
  pattern: string,
  device: BatchRenamePatternDevice,
  index1: number,
): string {
  const ip = device.ip || '';
  const ipParts = ip.split('.');
  let result = pattern;

  result = result.replace(/\{ip(?::([1-4](?:\.\.[1-4])?))?\}/g, (_, range: string | undefined) => {
    if (!ipParts.length) return '';
    if (!range) return ip;

    const segments = range.split('..');
    let indices: number[] = [];

    if (segments.length === 1) {
      const index = Number(segments[0]);
      if (Number.isFinite(index) && index >= 1 && index <= 4) indices = [index];
    } else if (segments.length === 2) {
      const start = Number(segments[0]);
      const end = Number(segments[1]);
      if (Number.isFinite(start) && Number.isFinite(end)) {
        const lower = Math.max(1, Math.min(start, end));
        const upper = Math.min(4, Math.max(start, end));
        for (let index = lower; index <= upper; index++) indices.push(index);
      }
    }

    if (!indices.length) return '';
    return indices.map(index => ipParts[index - 1] ?? '').join('.');
  });

  result = result.replace(
    /\{index(?::(-?\d+)?(?::(-?\d+)?)?)?\}/g,
    (_match: string, startRaw: string | undefined, endRaw: string | undefined) => {
      const value = String(index1);
      const start = startRaw ? Number(startRaw) : 0;
      const end = endRaw ? Number(endRaw) : undefined;
      const length = value.length;
      const normalize = (position: number | undefined, fallback: number) => {
        if (typeof position !== 'number' || Number.isNaN(position)) return fallback;
        if (position < 0) return Math.max(0, length + position);
        return Math.min(length, position);
      };

      return value.slice(normalize(start, 0), normalize(end, length));
    },
  );

  result = result.replace(/\{devname(?::([^}]+))?\}/g, (_match: string, spec: string | undefined) => {
    const source = (device.devname || '').toString();
    if (!spec) return source;

    const [startRaw, endRaw] = spec.split(',').map(part => part?.trim());
    if (!startRaw || !endRaw) return source;

    const characters = Array.from(source);
    const length = characters.length;
    if (!length) return '';

    const start = Number(startRaw);
    const end = Number(endRaw);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return source;

    const normalize = (value: number) => {
      const integer = Math.trunc(value);
      if (integer > 0) return Math.min(length - 1, Math.max(0, integer - 1));
      return Math.min(length - 1, Math.max(0, length + integer));
    };
    const startIndex = normalize(start);
    const endIndex = normalize(end);

    return characters
      .slice(Math.min(startIndex, endIndex), Math.max(startIndex, endIndex) + 1)
      .join('');
  });

  result = result.replace(/\{devtype\}/g, device.devtype || '');
  result = result.replace(/\{sysversion\}/g, device.sysversion || '');
  result = result.replace(/\{zeversion\}/g, device.zeversion || '');

  return result;
}
