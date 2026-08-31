import type { Locale } from '../i18n';

export function getBindingScriptFileName(host: string): string {
  const filenameHost = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  const safeHost = filenameHost.replace(/[^A-Za-z0-9.-]/g, '_') || 'server';
  return `XXTCloudControl-bind-${safeHost}.lua`;
}

export function getBindingScriptDownloadUrl(
  baseUrl: string,
  host: string,
  port: string,
  proto: 'ws' | 'wss',
  locale: Locale,
): string {
  const params = new URLSearchParams({ host, port, proto, locale });
  return `${baseUrl}/api/download-bind-script?${params.toString()}`;
}
