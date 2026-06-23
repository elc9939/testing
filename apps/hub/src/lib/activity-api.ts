import { getAiStatus, cancelAiJob, cancelResearchRun, resumeResearchRun } from './ai-os-api';
import { getPassiveSnapshot, runPassiveTask } from './passive-tasks-api';
import { listMacroRuns } from './macro-lab-api';
import { activityHasActiveWork, buildActivityRecords, type ActivityRecord } from './activity';

const activityCacheKey = 'miniHub.activity.snapshot.v1';

export interface ActivitySourceState {
  id: string;
  label: string;
  ok: boolean;
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

function source(id: string, label: string, ok: boolean, count: number, error?: string): ActivitySourceState {
  return { id, label, ok, count, ...(error ? { error } : {}) };
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Request failed.';
}

export async function loadActivitySnapshot(limit = 40): Promise<ActivitySnapshot> {
  const checkedAt = new Date().toISOString();
  const [ai, passive, macro] = await Promise.allSettled([getAiStatus(), getPassiveSnapshot(), listMacroRuns(30)]);

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
