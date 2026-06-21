import type { ActionLedgerEntry } from '@mini-hub/core';

const storageKey = 'mini-hub:browser-action-ledger:v1';
const maxEntries = 120;

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type BrowserActionInput = Omit<ActionLedgerEntry, 'id' | 'occurredAt' | 'system'> & {
  id?: string;
  occurredAt?: string;
};

export function listBrowserActionLedger(limit = 50, storage = browserStorage()): ActionLedgerEntry[] {
  if (!storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(storageKey) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isBrowserLedgerEntry).slice(0, Math.max(1, Math.min(limit, maxEntries)));
  } catch {
    return [];
  }
}

export function recordBrowserAction(input: BrowserActionInput, storage = browserStorage()): ActionLedgerEntry | null {
  if (!storage) return null;
  const entry: ActionLedgerEntry = {
    id: input.id ?? `browser:${Date.now().toString(36)}:${randomId()}`,
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    system: 'browser',
    source: input.source,
    actionType: input.actionType,
    summary: input.summary,
    status: input.status,
    risk: input.risk,
    mode: input.mode,
    changed: input.changed ?? [],
    recoverability: input.recoverability ?? { kind: 'none', description: '', reversible: false },
    rawRef: input.rawRef ?? {},
    metadata: input.metadata ?? {}
  };

  const entries = [entry, ...listBrowserActionLedger(maxEntries, storage)]
    .filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index)
    .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt) || a.id.localeCompare(b.id))
    .slice(0, maxEntries);
  storage.setItem(storageKey, JSON.stringify(entries));
  return entry;
}

function browserStorage(): StorageLike | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function randomId(): string {
  const cryptoValue = globalThis.crypto?.randomUUID?.();
  if (cryptoValue) return cryptoValue;
  return Math.random().toString(36).slice(2);
}

function isBrowserLedgerEntry(value: unknown): value is ActionLedgerEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as Partial<ActionLedgerEntry>;
  return (
    typeof entry.id === 'string' &&
    typeof entry.occurredAt === 'string' &&
    entry.system === 'browser' &&
    typeof entry.source === 'string' &&
    typeof entry.actionType === 'string' &&
    typeof entry.summary === 'string' &&
    typeof entry.status === 'string' &&
    typeof entry.risk === 'string' &&
    Boolean(entry.recoverability)
  );
}
