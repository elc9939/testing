import { env as publicEnv } from '$env/dynamic/public';
import type { ActionLedgerEntry } from '@mini-hub/core';
import { requestServiceJson, resolveServiceUrl } from './service-config';

export function getApiUrl(): string {
  return resolveServiceUrl('hubApi', publicEnv.PUBLIC_API_URL || import.meta.env.VITE_PUBLIC_API_URL, 'http://127.0.0.1:8787');
}

export const apiUrl = getApiUrl();

export interface HubHealth {
  ok: boolean;
  service: string;
  checkedAt?: string;
  network?: {
    lanIpv4: string[];
    hubPublicUrl?: string;
  };
  bridgeAuth?: {
    required: boolean;
    accepted: boolean;
  };
  storage?: {
    coreData?: {
      enabled: boolean;
      status: 'persistent' | 'memory_only' | 'missing' | 'error';
      path?: string;
      exists: boolean;
      bytes?: number;
      updatedAt?: string;
      detail: string;
      recordCounts: {
        workspaces: number;
        members: number;
        jobs: number;
        studySessions: number;
        careerActions: number;
        careerScoutCandidates: number;
        gameRuns: number;
        gameStates: number;
        settings: number;
        achievements: number;
        notes: number;
        syncEvents: number;
      };
    };
  };
}

export async function requestApiJson<T>(
  path: string,
  init: RequestInit = {},
  options: { timeoutMs?: number } = {}
): Promise<T> {
  return requestServiceJson<T>('hubApi', getApiUrl(), path, init, {
    credentials: 'include',
    timeoutMs: options.timeoutMs
  });
}

export async function requestApiJsonWithTimeout<T>(path: string, init: RequestInit = {}, timeoutMs = 8_000): Promise<T> {
  return requestApiJson<T>(path, init, { timeoutMs });
}

export async function getHealth(): Promise<HubHealth> {
  return requestApiJson<HubHealth>('/api/health');
}

export async function getHubActionLedger(limit = 50): Promise<ActionLedgerEntry[]> {
  const result = await requestApiJson<{ actions: ActionLedgerEntry[] }>(`/api/action-ledger?limit=${limit}`);
  return result.actions;
}

export async function getUnifiedActionLedger(limit = 50): Promise<{
  checkedAt: string;
  actions: ActionLedgerEntry[];
  errors: string[];
  sources: Array<{ id: string; label: string; ok: boolean; count: number; error?: string }>;
}> {
  return requestApiJson<{
    checkedAt: string;
    actions: ActionLedgerEntry[];
    errors: string[];
    sources: Array<{ id: string; label: string; ok: boolean; count: number; error?: string }>;
  }>(`/api/action-ledger/unified?limit=${limit}`);
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
