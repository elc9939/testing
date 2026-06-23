import { getAiStatus, cancelAiJob, cancelResearchRun, resumeResearchRun } from './ai-os-api';
import { getPassiveSnapshot, runPassiveTask } from './passive-tasks-api';
import { listMacroRuns } from './macro-lab-api';
import { activityHasActiveWork, buildActivityRecords, type ActivityRecord } from './activity';

const activityCacheKey = 'miniHub.activity.snapshot.v1';
const activityDismissedKey = 'miniHub.activity.dismissed.v1';

export interface ActivitySourceState {
  id: string;
  label: string;
  ok: boolean;
  state: 'ok' | 'error' | 'timeout';
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

export function readActivityCache(): ActivitySnapshot | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(activityCacheKey) ?? 'null') as Partial<ActivityCache> | null;
    if (!parsed || parsed.version !== 1 || !parsed.cachedAt || !parsed.snapshot || !Array.isArray(parsed.snapshot.records)) return null;
    return { ...parsed.snapshot, cachedAt: parsed.cachedAt, stale: true };
  } catch {
    return null;
  }
}

function writeActivityCache(snapshot: ActivitySnapshot): string {
  const cachedAt = new Date().toISOString();
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(activityCacheKey, JSON.stringify({ version: 1, cachedAt, snapshot } satisfies ActivityCache));
  }
  return cachedAt;
}

export function readDismissedActivityIds(): Set<string> {
  if (typeof localStorage === 'undefined') return new Set();
  try {
    const parsed = JSON.parse(localStorage.getItem(activityDismissedKey) ?? 'null') as Partial<ActivityDismissedCache> | null;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.ids)) return new Set();
    return new Set(parsed.ids.filter((id): id is string => typeof id === 'string' && id.length > 0));
  } catch {
    return new Set();
  }
}

function writeDismissedActivityIds(ids: Set<string>): Set<string> {
  const next = new Set(Array.from(ids).filter(Boolean).slice(-200));
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(activityDismissedKey, JSON.stringify({ version: 1, ids: Array.from(next) } satisfies ActivityDismissedCache));
  }
  return next;
}

export function dismissActivityRecord(recordId: string): Set<string> {
  const ids = readDismissedActivityIds();
  if (recordId) ids.add(recordId);
  return writeDismissedActivityIds(ids);
}

export function clearDismissedActivityRecords(): Set<string> {
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(activityDismissedKey);
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

function errorMessage(error: unknown): string {
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
  const timeoutMs = options.sourceTimeoutMs ?? 6_000;
  const [ai, passive, macro] = await Promise.all([
    settleActivitySource('AI OS activity source', getAiStatus(), timeoutMs),
    settleActivitySource('Passive Tasks activity source', getPassiveSnapshot(), timeoutMs),
    settleActivitySource('Macro Lab activity source', listMacroRuns(30), timeoutMs)
  ]);

  const aiStatus = ai.status === 'fulfilled' ? ai.value : null;
  const passiveSnapshot = passive.status === 'fulfilled' ? passive.value : null;
  const macroRuns = macro.status === 'fulfilled' ? macro.value : [];
  const errors = [
    ai.status === 'rejected' ? `AI OS: ${errorMessage(ai.reason)}` : '',
    passive.status === 'rejected' ? `Passive Tasks: ${errorMessage(passive.reason)}` : '',
    macro.status === 'rejected' ? `Macro Lab: ${errorMessage(macro.reason)}` : ''
  ].filter(Boolean);
  const records = buildActivityRecords({ aiStatus, passiveSnapshot, macroRuns }, limit);
  const snapshot: ActivitySnapshot = {
    checkedAt,
    stale: false,
    partial: errors.length > 0,
    active: activityHasActiveWork(records),
    records,
    sources: [
      source('ai-os', 'AI OS', ai.status === 'fulfilled', records.filter((record) => record.source === 'ai-os' || record.source === 'research').length, ai.status === 'rejected' ? errorMessage(ai.reason) : undefined),
      source('passive', 'Passive Tasks', passive.status === 'fulfilled', records.filter((record) => record.source === 'passive').length, passive.status === 'rejected' ? errorMessage(passive.reason) : undefined),
      source('macro-lab', 'Macro Lab', macro.status === 'fulfilled', records.filter((record) => record.source === 'macro-lab').length, macro.status === 'rejected' ? errorMessage(macro.reason) : undefined)
    ],
    errors
  };

  const cached = errors.length && records.length === 0 ? readActivityCache() : null;
  if (cached?.records.length) {
    return {
      ...snapshot,
      cachedAt: cached.cachedAt,
      stale: true,
      partial: true,
      active: activityHasActiveWork(cached.records),
      records: cached.records,
      errors: [...errors, 'Showing cached Activity records because live sources are unavailable.']
    };
  }

  snapshot.cachedAt = writeActivityCache(snapshot);
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
