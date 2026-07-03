import { getAiStatus, cancelAiJob, cancelResearchRun, resumeResearchRun } from './ai-os-api';
import { getPassiveSnapshot, runPassiveTask } from './passive-tasks-api';
import { listMacroRuns } from './macro-lab-api';
import { activityHasActiveWork, buildActivityRecords, type ActivityRecord } from './activity';
import { compactServiceIssueIfRecognized } from './service-issues';

const activityCacheKey = 'miniHub.activity.snapshot.v1';
const activityDismissedKey = 'miniHub.activity.dismissed.v1';
const defaultActivitySourceTimeoutMs = 12_000;

export interface ActivitySourceState {
  id: string;
  label: string;
  ok: boolean;
  state: 'ok' | 'error' | 'timeout' | 'checking';
  error?: string;
  count: number;
}

export interface ActivitySnapshot {
  checkedAt: string;
  cachedAt?: string;
  stale: boolean;
  partial: boolean;
  active: boolean;
  records: ActivityRecord[];
  sources: ActivitySourceState[];
  errors: string[];
}

interface ActivityCache {
  version: 1;
  cachedAt: string;
  snapshot: ActivitySnapshot;
}

interface ActivityDismissedCache {
  version: 1;
  ids: string[];
}

function getBrowserStorage(): Storage | null {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}

export function readActivityCache(): ActivitySnapshot | null {
  const storage = getBrowserStorage();
  if (!storage) return null;
  try {
    const parsed = JSON.parse(storage.getItem(activityCacheKey) ?? 'null') as Partial<ActivityCache> | null;
    if (!parsed || parsed.version !== 1 || !parsed.cachedAt || !parsed.snapshot || !Array.isArray(parsed.snapshot.records)) return null;
    return { ...parsed.snapshot, cachedAt: parsed.cachedAt, stale: true };
  } catch {
    return null;
  }
}

function writeActivityCache(snapshot: ActivitySnapshot): { cachedAt?: string; error?: string } {
  const cachedAt = new Date().toISOString();
  const storage = getBrowserStorage();
  if (!storage) {
    return {
      error: 'Browser Activity cache is unavailable; live records are visible but may not survive refresh.'
    };
  }
  try {
    storage.setItem(activityCacheKey, JSON.stringify({ version: 1, cachedAt, snapshot } satisfies ActivityCache));
    return { cachedAt };
  } catch {
    return {
      error: 'Browser Activity cache could not be updated; live records are visible but may not survive refresh.'
    };
  }
}

export function readDismissedActivityIds(): Set<string> {
  const storage = getBrowserStorage();
  if (!storage) return new Set();
  try {
    const parsed = JSON.parse(storage.getItem(activityDismissedKey) ?? 'null') as Partial<ActivityDismissedCache> | null;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.ids)) return new Set();
    return new Set(parsed.ids.filter((id): id is string => typeof id === 'string' && id.length > 0));
  } catch {
    return new Set();
  }
}

function writeDismissedActivityIds(ids: Set<string>): Set<string> {
  const next = new Set(Array.from(ids).filter(Boolean).slice(-200));
  const storage = getBrowserStorage();
  if (!storage) return next;
  try {
    storage.setItem(activityDismissedKey, JSON.stringify({ version: 1, ids: Array.from(next) } satisfies ActivityDismissedCache));
  } catch {
    // Dismiss still applies for the current page session even when browser storage is blocked.
  }
  return next;
}

export function dismissActivityRecord(recordId: string): Set<string> {
  const ids = readDismissedActivityIds();
  if (recordId) ids.add(recordId);
  return writeDismissedActivityIds(ids);
}

export function clearDismissedActivityRecords(): Set<string> {
  const storage = getBrowserStorage();
  if (storage) {
    try {
      storage.removeItem(activityDismissedKey);
    } catch {
      // Restore dismissed records for the current page even if browser storage is blocked.
    }
  }
  return new Set();
}

function source(id: string, label: string, ok: boolean, count: number, error?: string): ActivitySourceState {
  return {
    id,
    label,
    ok,
    state: ok ? 'ok' : error && /timed out/iu.test(error) ? 'timeout' : 'error',
    count,
    ...(error ? { error } : {})
  };
}

function errorMessage(error: unknown, label = 'Activity source'): string {
  const raw = rawErrorMessage(error);
  return compactServiceIssueIfRecognized(raw, label) || raw;
}

function rawErrorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Request failed.';
}

export async function settleActivitySource<T>(
  label: string,
  promise: Promise<T>,
  timeoutMs = 6_000
): Promise<PromiseSettledResult<T>> {
  let settled = false;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ status: 'rejected', reason: new Error(`${label} timed out after ${timeoutMs} ms.`) });
    }, timeoutMs);

    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ status: 'fulfilled', value });
      },
      (reason) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ status: 'rejected', reason });
      }
    );
  });
}

export async function loadActivitySnapshot(
  limit = 40,
  options: { sourceTimeoutMs?: number } = {}
): Promise<ActivitySnapshot> {
  const checkedAt = new Date().toISOString();
  const timeoutMs = options.sourceTimeoutMs ?? defaultActivitySourceTimeoutMs;
  const [ai, passive, macro] = await Promise.all([
    settleActivitySource('AI OS activity source', getAiStatus(), timeoutMs),
    settleActivitySource('Passive Tasks activity source', getPassiveSnapshot(), timeoutMs),
    settleActivitySource('Macro Lab activity source', listMacroRuns(30), timeoutMs)
  ]);

  const aiStatus = ai.status === 'fulfilled' ? ai.value : null;
  const passiveSnapshot = passive.status === 'fulfilled' ? passive.value : null;
  const macroRuns = macro.status === 'fulfilled' ? macro.value : [];
  const errors = [
    ai.status === 'rejected' ? errorMessage(ai.reason, 'AI OS') : '',
    passive.status === 'rejected' ? errorMessage(passive.reason, 'Passive Tasks') : '',
    macro.status === 'rejected' ? errorMessage(macro.reason, 'Macro Lab') : ''
  ].filter(Boolean);
  const liveRecords = buildActivityRecords({ aiStatus, passiveSnapshot, macroRuns }, limit);
  const snapshot: ActivitySnapshot = {
    checkedAt,
    stale: false,
    partial: errors.length > 0,
    active: activityHasActiveWork(liveRecords),
    records: liveRecords,
    sources: [
      source('ai-os', 'AI OS', ai.status === 'fulfilled', 0, ai.status === 'rejected' ? errorMessage(ai.reason, 'AI OS') : undefined),
      source('passive', 'Passive Tasks', passive.status === 'fulfilled', 0, passive.status === 'rejected' ? errorMessage(passive.reason, 'Passive Tasks') : undefined),
      source('macro-lab', 'Macro Lab', macro.status === 'fulfilled', 0, macro.status === 'rejected' ? errorMessage(macro.reason, 'Macro Lab') : undefined)
    ],
    errors
  };

  const cached = errors.length ? readActivityCache() : null;
  const failedSourceIds = new Set([
    ai.status === 'rejected' ? 'ai-os' : '',
    passive.status === 'rejected' ? 'passive' : '',
    macro.status === 'rejected' ? 'macro-lab' : ''
  ].filter(Boolean));
  const cachedFallbackRecords = cached?.records.filter((record) => failedSourceIds.has(activitySourceId(record))) ?? [];
  if (cachedFallbackRecords.length) {
    snapshot.records = mergeActivityRecords(liveRecords, cachedFallbackRecords, limit);
    snapshot.cachedAt = cached?.cachedAt;
    snapshot.stale = true;
    snapshot.partial = true;
    snapshot.active = activityHasActiveWork(snapshot.records);
    snapshot.errors = [...errors, 'Showing cached Activity records for sources that failed live refresh.'];
  } else {
    snapshot.active = activityHasActiveWork(snapshot.records);
  }

  snapshot.sources = snapshot.sources.map((item) => ({
    ...item,
    count: snapshot.records.filter((record) => activitySourceId(record) === item.id).length
  }));

  const cacheWrite = writeActivityCache(snapshot);
  if (cacheWrite.cachedAt) {
    snapshot.cachedAt = cacheWrite.cachedAt;
  }
  if (cacheWrite.error) {
    snapshot.errors = [...snapshot.errors, cacheWrite.error];
  }
  return snapshot;
}

export async function performActivityAction(record: ActivityRecord, actionKind: string): Promise<void> {
  if (actionKind === 'cancel' && record.id.startsWith('research:')) {
    await cancelResearchRun(String(record.metadata.runId ?? ''));
    return;
  }
  if (actionKind === 'resume' && record.id.startsWith('research:')) {
    await resumeResearchRun(String(record.metadata.runId ?? ''));
    return;
  }
  if (actionKind === 'cancel' && record.id.startsWith('ai-job:')) {
    await cancelAiJob(String(record.metadata.jobId ?? ''));
    return;
  }
  if (actionKind === 'retry' && record.id.startsWith('passive:')) {
    await runPassiveTask(String(record.metadata.taskId ?? ''), { manual: true, reason: 'activity-retry' });
  }
}

function activitySourceId(record: ActivityRecord): 'ai-os' | 'passive' | 'macro-lab' {
  if (record.source === 'research' || record.source === 'ai-os') return 'ai-os';
  if (record.source === 'passive') return 'passive';
  return 'macro-lab';
}

function mergeActivityRecords(liveRecords: ActivityRecord[], cachedRecords: ActivityRecord[], limit: number): ActivityRecord[] {
  const liveIds = new Set(liveRecords.map((record) => record.id));
  return [...liveRecords, ...cachedRecords.filter((record) => !liveIds.has(record.id))]
    .sort((a, b) => dateValue(b.updatedAt || b.startedAt) - dateValue(a.updatedAt || a.startedAt) || a.title.localeCompare(b.title))
    .slice(0, limit);
}

function dateValue(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
