import { AuthService } from './AuthService';

type AuthPayload = {
  ts: number;
  sign: string;
};

let apiBaseUrl = '';

export const setApiBaseUrl = (baseUrl: string) => {
  apiBaseUrl = baseUrl.trim().replace(/\/+$/, '');
};

const isAbsoluteUrl = (url: string): boolean => {
  return /^https?:\/\//i.test(url) || url.startsWith('//');
};

const resolveUrl = (url: string): string => {
  if (isAbsoluteUrl(url) || !apiBaseUrl) return url;
  if (url.startsWith('/')) return `${apiBaseUrl}${url}`;
  return `${apiBaseUrl}/${url}`;
};

const getAuthPayload = (): AuthPayload | null => {
  const authService = AuthService.getInstance();
  const credentials = authService.getCurrentCredentials();
  if (!credentials?.password) {
    return null;
  }
  const ts = Math.floor(Date.now() / 1000);
  const sign = authService.generateSignature(credentials.password, ts);
  return { ts, sign };
};

export const withAuthHeaders = (headers?: HeadersInit): Headers => {
  const result = new Headers(headers);
  const payload = getAuthPayload();
  if (payload) {
    result.set('X-XXT-TS', String(payload.ts));
    result.set('X-XXT-Sign', payload.sign);
  }
  return result;
};

export const authFetch = (url: string, options: RequestInit = {}) => {
  const headers = withAuthHeaders(options.headers);
  return fetch(resolveUrl(url), { ...options, headers });
};

export const appendAuthQuery = (url: string): string => {
  const payload = getAuthPayload();
  if (!payload) {
    return resolveUrl(url);
  }
  const finalUrl = new URL(resolveUrl(url), window.location.origin);
  finalUrl.searchParams.set('ts', String(payload.ts));
  finalUrl.searchParams.set('sign', payload.sign);
  return finalUrl.toString();
};
