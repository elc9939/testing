import { syncEventSchema, type SyncEvent } from '@mini-hub/core';

export interface ConflictComparable {
  updatedAt: string;
  deviceId: string;
}

export function compareMutationOrder(a: ConflictComparable, b: ConflictComparable): number {
  const updatedDelta = Date.parse(a.updatedAt) - Date.parse(b.updatedAt);
  if (updatedDelta !== 0) return updatedDelta;
  return a.deviceId.localeCompare(b.deviceId);
}

export function resolveEntityConflict<T extends ConflictComparable>(local: T, remote: T): T {
  return compareMutationOrder(local, remote) >= 0 ? local : remote;
}

export function validateSyncEvents(events: unknown[]): SyncEvent[] {
  return events.map((event) => syncEventSchema.parse(event));
}

export async function pushSyncEvents(
  fetcher: typeof fetch,
  apiUrl: string,
  events: SyncEvent[]
): Promise<{ accepted: number; cursor: string }> {
  const response = await fetcher(`${apiUrl}/api/sync/push`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ events })
  });
  if (!response.ok) throw new Error(`Sync push failed with ${response.status}`);
  return (await response.json()) as { accepted: number; cursor: string };
}

