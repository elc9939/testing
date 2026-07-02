import { get, writable } from 'svelte/store';
import type {
  AttentionActionKind,
  AttentionItem,
  AttentionSnapshot,
  AttentionSource,
  AttentionSourceStatus
} from '@mini-hub/core';
import { requestApiJsonWithTimeout } from './api';
import { compactServiceIssueIfRecognized } from './service-issues';

const attentionCacheKey = 'miniHub.attention.snapshot.v1';
const refreshIntervalMs = 90_000;
export const attentionSnapshotTimeoutMs = 30_000;
export const attentionActionTimeoutMs = 40_000;

interface AttentionCache {
  version: 1;
  cachedAt: string;
  snapshot: AttentionSnapshot;
}

export interface AttentionStoreState {
  initialized: boolean;
  loading: boolean;
  refreshing: boolean;
  readOnly: boolean;
  error: string;
  cachedAt: string;
  snapshot: AttentionSnapshot | null;
  pendingActionId: string;
}

export interface AttentionActionInput {
  action: AttentionActionKind;
  snoozedUntil?: string;
}

function browserOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}

function getBrowserStorage(): Storage | null {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}

function readCachedSnapshot(): AttentionCache | null {
  const storage = getBrowserStorage();
  if (!storage) return null;
  try {
    const parsed = JSON.parse(storage.getItem(attentionCacheKey) ?? 'null') as Partial<AttentionCache> | null;
    if (!parsed || parsed.version !== 1 || !parsed.cachedAt || !parsed.snapshot) return null;
    if (!Array.isArray(parsed.snapshot.items) || !Array.isArray(parsed.snapshot.sources)) return null;
    return parsed as AttentionCache;
  } catch {
    return null;
  }
}

export function writeAttentionSnapshotCache(snapshot: AttentionSnapshot): { cachedAt?: string; error?: string } {
  const cachedAt = new Date().toISOString();
  const storage = getBrowserStorage();
  if (!storage) {
    return {
      error: 'Browser attention cache is unavailable; live Today data is visible but may not survive refresh.'
    };
  }
  try {
    storage.setItem(attentionCacheKey, JSON.stringify({ version: 1, cachedAt, snapshot } satisfies AttentionCache));
    return { cachedAt };
  } catch {
    return {
      error: 'Browser attention cache could not be updated; live Today data is visible but may not survive refresh.'
    };
  }
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function attentionRefreshError(error: unknown, hasSnapshot: boolean): string {
  const message = errorMessage(error, 'Attention snapshot failed to refresh.');
  return hasSnapshot ? `${message} Showing cached attention until the hub responds.` : message;
}

function nextSnoozeUntil(hours = 24): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function emptySourceLabel(source: AttentionSource): string {
  if (source === 'google_calendar') return 'Google Calendar';
  if (source === 'gmail') return 'Gmail';
  if (source === 'career_action' || source === 'career_job') return 'Career Desk';
  if (source === 'study_session' || source === 'study_signal') return 'Study Desk';
  if (source === 'ai_os') return 'AI OS';
  if (source === 'macro_lab') return 'Macro Lab';
  if (source === 'research') return 'Research';
  if (source === 'passive_task') return 'Passive Tasks';
  if (source === 'service_health') return 'Service Health';
  return 'Manual';
}

export function attentionSourceLabel(source: AttentionSource): string {
  return emptySourceLabel(source);
}

export function attentionSourceStatusLine(source: AttentionSourceStatus): string {
  if (source.status === 'ok') return `${source.itemCount} active`;
  if (source.status === 'unavailable') return attentionSourceIssueText(source, 'not connected');
  return attentionSourceIssueText(source, 'failed to refresh');
}

function attentionSourceIssueText(source: AttentionSourceStatus, fallback: string): string {
  const compact = compactServiceIssueIfRecognized(source.error ?? fallback, source.label);
  const labelWithSpace = `${source.label} `;
  const labelWithColon = `${source.label}: `;
  if (compact.startsWith(labelWithSpace)) return compact.slice(labelWithSpace.length);
  if (compact.startsWith(labelWithColon)) return compact.slice(labelWithColon.length);
  return compact;
}

export function attentionActionLabel(kind: AttentionActionKind): string {
  if (kind === 'mark_read') return 'Read';
  if (kind === 'mark_important') return 'Important';
  if (kind === 'archive') return 'Archive';
  if (kind === 'complete') return 'Complete';
  if (kind === 'snooze') return 'Snooze';
  if (kind === 'dismiss') return 'Dismiss';
  if (kind === 'restore') return 'Restore';
  if (kind === 'inspect') return 'Inspect';
  if (kind === 'run') return 'Run';
  return 'Open';
}

export function itemSupportsAction(item: AttentionItem, kind: AttentionActionKind): boolean {
  return item.actions.some((action) => action.kind === kind && action.available);
}

export function createAttentionStore() {
  let initPromise: Promise<void> | null = null;
  let intervalId: number | null = null;
  let listenersBound = false;

  const store = writable<AttentionStoreState>({
    initialized: false,
    loading: false,
    refreshing: false,
    readOnly: !browserOnline(),
    error: '',
    cachedAt: '',
    snapshot: null,
    pendingActionId: ''
  });

  function setPartial(partial: Partial<AttentionStoreState>): void {
    store.update((state) => ({ ...state, ...partial }));
  }

  function hydrateCache(): void {
    const cached = readCachedSnapshot();
    if (!cached) return;
    setPartial({
      cachedAt: cached.cachedAt,
      snapshot: cached.snapshot,
      readOnly: !browserOnline()
    });
  }

  async function refresh(options: { background?: boolean } = {}): Promise<AttentionSnapshot | null> {
    const background = options.background === true;
    const online = browserOnline();
    if (!online) {
      setPartial({ readOnly: true, refreshing: false, loading: false, error: '' });
      return get(store).snapshot;
    }

    setPartial(background ? { refreshing: true, readOnly: false, error: '' } : { loading: true, readOnly: false, error: '' });
    try {
      const snapshot = await requestApiJsonWithTimeout<AttentionSnapshot>('/api/attention/snapshot', {}, attentionSnapshotTimeoutMs);
      const cacheWrite = writeAttentionSnapshotCache(snapshot);
      setPartial({
        snapshot,
        ...(cacheWrite.cachedAt ? { cachedAt: cacheWrite.cachedAt } : {}),
        error: cacheWrite.error ?? '',
        readOnly: false
      });
      return snapshot;
    } catch (error) {
      setPartial({
        error: attentionRefreshError(error, Boolean(get(store).snapshot)),
        readOnly: true
      });
      return get(store).snapshot;
    } finally {
      setPartial(background ? { refreshing: false } : { loading: false });
    }
  }

  async function performAction(itemId: string, input: AttentionActionInput): Promise<AttentionSnapshot | null> {
    if (!browserOnline()) {
      setPartial({ readOnly: true, error: 'Offline read-only mode: reconnect before changing attention items.' });
      return get(store).snapshot;
    }

    const body = {
      action: input.action,
      snoozedUntil: input.action === 'snooze' ? input.snoozedUntil ?? nextSnoozeUntil() : input.snoozedUntil
    };
    setPartial({ pendingActionId: `${itemId}:${input.action}`, error: '', readOnly: false });
    try {
      const result = await requestApiJsonWithTimeout<{ ok: true; snapshot: AttentionSnapshot }>(
        `/api/attention/items/${encodeURIComponent(itemId)}/actions`,
        {
          method: 'POST',
          body: JSON.stringify(body)
        },
        attentionActionTimeoutMs
      );
      const cacheWrite = writeAttentionSnapshotCache(result.snapshot);
      setPartial({
        snapshot: result.snapshot,
        ...(cacheWrite.cachedAt ? { cachedAt: cacheWrite.cachedAt } : {}),
        error: cacheWrite.error ?? ''
      });
      return result.snapshot;
    } catch (error) {
      setPartial({ error: errorMessage(error, 'Attention action failed.') });
      void refresh({ background: true });
      return get(store).snapshot;
    } finally {
      setPartial({ pendingActionId: '' });
    }
  }

  function refreshIfVisible(): void {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    if (get(store).loading || get(store).refreshing) return;
    void refresh({ background: true });
  }

  async function init(): Promise<void> {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      hydrateCache();
      setPartial({ initialized: true, readOnly: !browserOnline() });

      if (typeof window !== 'undefined' && !listenersBound) {
        listenersBound = true;
        window.addEventListener('online', () => {
          setPartial({ readOnly: false });
          void refresh({ background: true });
        });
        window.addEventListener('offline', () => {
          setPartial({ readOnly: true });
        });
        window.addEventListener('focus', refreshIfVisible);
        document.addEventListener('visibilitychange', refreshIfVisible);
        intervalId = window.setInterval(refreshIfVisible, refreshIntervalMs);
      }

      await refresh({ background: Boolean(get(store).snapshot) });
    })();
    return initPromise;
  }

  function invalidate(): void {
    void refresh({ background: true });
  }

  function destroy(): void {
    if (intervalId !== null && typeof window !== 'undefined') window.clearInterval(intervalId);
  }

  return {
    subscribe: store.subscribe,
    init,
    refresh,
    performAction,
    invalidate,
    destroy
  };
}

export const attentionStore = createAttentionStore();
