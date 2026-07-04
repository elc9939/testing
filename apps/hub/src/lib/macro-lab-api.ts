import { env as publicEnv } from '$env/dynamic/public';
import { getBrowserStorage } from './browser-storage';
import { requestServiceJson, resolveServiceUrl } from './service-config';

export function getMacroLabApiUrl(): string {
  return resolveServiceUrl(
    'macroLab',
    publicEnv.PUBLIC_MACRO_LAB_API_URL || import.meta.env.VITE_PUBLIC_MACRO_LAB_API_URL,
    'http://127.0.0.1:8792'
  );
}

export const macroLabApiUrl = getMacroLabApiUrl();

export interface MacroAction {
  id: string;
  type: string;
  label: string;
  enabled: boolean;
  config: Record<string, unknown>;
}

export interface MacroTrigger {
  id: string;
  type: string;
  label: string;
  enabled: boolean;
  config: Record<string, unknown>;
}

export interface MacroDefinition {
  id: string;
  name: string;
  group: string;
  enabled: boolean;
  armed: boolean;
  dry_run_default: boolean;
  variables: Record<string, unknown>;
  actions: MacroAction[];
  triggers: MacroTrigger[];
  created_at: string;
  updated_at: string;
}

export interface MacroRun {
  id: string;
  macro_id: string;
  macro_name: string;
  status: string;
  dry_run: boolean;
  started_at: string;
  finished_at?: string;
  error?: string;
  steps: Array<Record<string, unknown>>;
}

export interface MacroStatus {
  ok: boolean;
  version: string;
  engine: { panic: boolean; running: number; action_count: number };
  triggers: Record<string, unknown>;
  capabilities: Array<{ id: string; available: boolean; detail: string }>;
  integrity: Record<string, unknown>;
}

export interface ActionSpec {
  type: string;
  label: string;
  safety: string;
  description: string;
  config_example: Record<string, unknown>;
}

export const macroLabDashboardCacheKey = 'miniHub.macroLab.dashboard.v1';

export interface MacroLabDashboardSnapshot {
  checkedAt: string;
  status: MacroStatus | null;
  actions: ActionSpec[];
  macros: MacroDefinition[];
  runs: MacroRun[];
}

interface MacroLabDashboardCache {
  version: 1;
  cachedAt: string;
  snapshot: MacroLabDashboardSnapshot;
}

function validMacroLabDashboardSnapshot(value: Partial<MacroLabDashboardSnapshot> | null | undefined): value is MacroLabDashboardSnapshot {
  return Boolean(
    value &&
      typeof value.checkedAt === 'string' &&
      (value.status === null || typeof value.status === 'object') &&
      Array.isArray(value.actions) &&
      Array.isArray(value.macros) &&
      Array.isArray(value.runs)
  );
}

export function readCachedMacroLabDashboardSnapshot(): { cachedAt: string; snapshot: MacroLabDashboardSnapshot } | null {
  const storage = getBrowserStorage();
  if (!storage) return null;
  try {
    const parsed = JSON.parse(storage.getItem(macroLabDashboardCacheKey) ?? 'null') as Partial<MacroLabDashboardCache> | null;
    if (!parsed || parsed.version !== 1 || typeof parsed.cachedAt !== 'string') return null;
    if (!validMacroLabDashboardSnapshot(parsed.snapshot)) return null;
    return { cachedAt: parsed.cachedAt, snapshot: parsed.snapshot };
  } catch {
    return null;
  }
}

export function writeMacroLabDashboardCache(snapshot: MacroLabDashboardSnapshot): { cachedAt?: string; error?: string } {
  const storage = getBrowserStorage();
  if (!storage) {
    return { error: 'Browser Macro Lab cache is unavailable; live automation state is visible but may not survive refresh.' };
  }
  const cachedAt = new Date().toISOString();
  try {
    storage.setItem(macroLabDashboardCacheKey, JSON.stringify({ version: 1, cachedAt, snapshot } satisfies MacroLabDashboardCache));
    return { cachedAt };
  } catch {
    return { error: 'Browser Macro Lab cache could not be updated; live automation state is visible but may not survive refresh.' };
  }
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  return requestServiceJson<T>('macroLab', getMacroLabApiUrl(), path, init);
}

export async function getMacroStatus(): Promise<MacroStatus> {
  return requestJson<MacroStatus>('/api/macro-lab/status');
}

export async function listMacroActions(): Promise<ActionSpec[]> {
  const result = await requestJson<{ actions: ActionSpec[] }>('/api/macro-lab/actions');
  return result.actions;
}

export async function listMacros(): Promise<MacroDefinition[]> {
  const result = await requestJson<{ macros: MacroDefinition[] }>('/api/macro-lab/macros');
  return result.macros;
}

export async function saveMacro(macro: MacroDefinition): Promise<MacroDefinition> {
  const result = await requestJson<{ macro: MacroDefinition }>(`/api/macro-lab/macros/${encodeURIComponent(macro.id)}`, {
    method: 'PUT',
    body: JSON.stringify(macro)
  });
  return result.macro;
}

export async function patchMacro(macroId: string, patch: Partial<MacroDefinition>): Promise<MacroDefinition> {
  const result = await requestJson<{ macro: MacroDefinition }>(`/api/macro-lab/macros/${encodeURIComponent(macroId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch)
  });
  return result.macro;
}

export async function createMacro(macro: MacroDefinition): Promise<MacroDefinition> {
  const result = await requestJson<{ macro: MacroDefinition }>('/api/macro-lab/macros', {
    method: 'POST',
    body: JSON.stringify(macro)
  });
  return result.macro;
}

export async function runMacro(macroId: string, dryRun: boolean, confirm = false): Promise<MacroRun> {
  const result = await requestJson<{ run: MacroRun }>(`/api/macro-lab/macros/${encodeURIComponent(macroId)}/run`, {
    method: 'POST',
    body: JSON.stringify({ dry_run: dryRun, confirm })
  });
  return result.run;
}

export async function listMacroRuns(limit = 30): Promise<MacroRun[]> {
  const result = await requestJson<{ runs: MacroRun[] }>(`/api/macro-lab/runs?limit=${limit}`);
  return result.runs;
}

export async function restoreMacroRun(runId: string): Promise<{ restore: Record<string, unknown>; run: MacroRun }> {
  return requestJson<{ restore: Record<string, unknown>; run: MacroRun }>(
    `/api/macro-lab/runs/${encodeURIComponent(runId)}/restore`,
    {
      method: 'POST',
      body: JSON.stringify({ confirm: true })
    }
  );
}

export async function panicMacroLab(): Promise<Record<string, unknown>> {
  return requestJson<Record<string, unknown>>('/api/macro-lab/panic', { method: 'POST' });
}

export async function resetMacroPanic(): Promise<Record<string, unknown>> {
  return requestJson<Record<string, unknown>>('/api/macro-lab/panic/reset', { method: 'POST' });
}

export async function reloadMacroTriggers(): Promise<Record<string, unknown>> {
  return requestJson<Record<string, unknown>>('/api/macro-lab/triggers/reload', { method: 'POST' });
}

export async function startRecording(): Promise<Record<string, unknown>> {
  return requestJson<Record<string, unknown>>('/api/macro-lab/recording/start', { method: 'POST', body: JSON.stringify({ keyboard: true, mouse: true }) });
}

export async function stopRecording(): Promise<Record<string, unknown>> {
  return requestJson<Record<string, unknown>>('/api/macro-lab/recording/stop', { method: 'POST' });
}
