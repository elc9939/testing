import { env as publicEnv } from '$env/dynamic/public';
import { requestServiceJson, resolveServiceUrl } from './service-config';

export function getApiUrl(): string {
  return resolveServiceUrl('hubApi', publicEnv.PUBLIC_API_URL || import.meta.env.VITE_PUBLIC_API_URL, 'http://127.0.0.1:8787');
}

export const apiUrl = getApiUrl();

export async function requestApiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  return requestServiceJson<T>('hubApi', getApiUrl(), path, init, { credentials: 'include' });
}

export async function getHealth(): Promise<{ ok: boolean; service: string }> {
  return requestApiJson<{ ok: boolean; service: string }>('/api/health');
}
