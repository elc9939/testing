import { env as publicEnv } from '$env/dynamic/public';
import type { ActionLedgerEntry } from '@mini-hub/core';
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

export async function getHubActionLedger(limit = 50): Promise<ActionLedgerEntry[]> {
  const result = await requestApiJson<{ actions: ActionLedgerEntry[] }>(`/api/action-ledger?limit=${limit}`);
  return result.actions;
}

export async function restoreHubActionLedgerEntry(
  actionId: string
): Promise<{ restored: unknown; syncEvent: unknown; action: ActionLedgerEntry }> {
  return requestApiJson<{ restored: unknown; syncEvent: unknown; action: ActionLedgerEntry }>(
    `/api/action-ledger/${encodeURIComponent(actionId)}/restore`,
    {
      method: 'POST',
      body: JSON.stringify({ confirm: true })
    }
  );
}
