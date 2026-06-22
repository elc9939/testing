import type { ActionLedgerEntry, ActionLedgerRisk, ActionLedgerStatus, ActionRecoverability } from '@mini-hub/core';
import { getHubActionLedger, getUnifiedActionLedger } from './api';
import { getAiActionLedger, type AiActionLedgerEntry } from './ai-os-api';
import { listBrowserActionLedger } from './browser-action-ledger';
import { listMacroRuns, type MacroRun } from './macro-lab-api';

export interface ActionLedgerSnapshot {
  checkedAt: string;
  actions: ActionLedgerEntry[];
  errors: string[];
}

export interface ActionLedgerInput {
  hubActions?: ActionLedgerEntry[];
  aiActions?: AiActionLedgerEntry[];
  macroRuns?: MacroRun[];
  browserActions?: ActionLedgerEntry[];
  errors?: string[];
  limit?: number;
}

export async function loadActionLedger(limit = 12): Promise<ActionLedgerSnapshot> {
  try {
    const unified = await getUnifiedActionLedger(Math.max(limit * 2, 20));
    return buildActionLedgerSnapshot({
      hubActions: unified.actions,
      browserActions: listBrowserActionLedger(limit),
      errors: unified.errors,
      limit
    });
  } catch {
    // Older API deployments do not have the federated endpoint yet, so keep the
    // browser-side federation path as the compatibility layer.
  }

  const [hub, ai, macro] = await Promise.allSettled([
    getHubActionLedger(limit),
    getAiActionLedger(limit),
    listMacroRuns(limit)
  ]);
  const errors = [hub, ai, macro]
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map((result) => (result.reason instanceof Error ? result.reason.message : String(result.reason)));

  return buildActionLedgerSnapshot({
    hubActions: hub.status === 'fulfilled' ? hub.value : [],
    aiActions: ai.status === 'fulfilled' ? ai.value : [],
    macroRuns: macro.status === 'fulfilled' ? macro.value : [],
    browserActions: listBrowserActionLedger(limit),
    errors,
    limit
  });
}

export function buildActionLedgerSnapshot(input: ActionLedgerInput): ActionLedgerSnapshot {
  const actions = [
    ...(input.hubActions ?? []),
    ...(input.aiActions ?? []).map(normalizeAiAction),
    ...(input.macroRuns ?? []).map(macroRunToAction),
    ...(input.browserActions ?? [])
  ];

  return {
    checkedAt: new Date().toISOString(),
    actions: actions
      .filter((action) => action.occurredAt)
      .sort((a, b) => dateValue(b.occurredAt) - dateValue(a.occurredAt) || a.id.localeCompare(b.id))
      .slice(0, Math.max(1, Math.min(input.limit ?? 12, 200))),
    errors: input.errors ?? []
  };
}

export function normalizeAiAction(action: AiActionLedgerEntry): ActionLedgerEntry {
  return {
    id: action.id,
    occurredAt: action.occurred_at,
    system: action.system,
    source: action.source,
    actionType: action.action_type,
    summary: action.summary,
    status: action.status,
    risk: action.risk,
    mode: action.mode,
    changed: action.changed ?? [],
    recoverability: {
      kind: action.recoverability?.kind ?? 'none',
      referenceId: action.recoverability?.reference_id,
      route: action.recoverability?.route,
      description: action.recoverability?.description ?? '',
      reversible: action.recoverability?.reversible ?? false
    },
    rawRef: action.raw_ref ?? {},
    metadata: action.metadata ?? {}
  };
}

export function macroRunToAction(run: MacroRun): ActionLedgerEntry {
  const status = run.dry_run ? 'dry_run' : normalizeStatus(run.status);
  const risk = macroRunRisk(run);
  return {
    id: `macro-lab-run:${run.id}`,
    occurredAt: run.finished_at || run.started_at,
    system: 'macro-lab',
    source: 'run_history',
    actionType: 'macro.run',
    summary: `${run.dry_run ? 'Dry-run' : 'Ran'} ${run.macro_name}`,
    status,
    risk,
    changed: macroRunChanged(run),
    recoverability: macroRecoverability(run),
    rawRef: {
      kind: 'macro_run',
      id: run.id,
      macroId: run.macro_id,
      triggerId: (run as { trigger_id?: string }).trigger_id
    },
    metadata: {
      error: run.error,
      step_count: run.steps.length
    }
  };
}

export function actionLedgerStatusLabel(status: ActionLedgerStatus): string {
  if (status === 'succeeded') return 'ok';
  if (status === 'dry_run') return 'dry run';
  return status.replace('_', ' ');
}

export function actionLedgerRiskLabel(risk: ActionLedgerRisk): string {
  if (risk === 'read') return 'read';
  if (risk === 'write') return 'write';
  if (risk === 'system') return 'system';
  return 'destructive';
}

export function actionLedgerSystemLabel(system: ActionLedgerEntry['system']): string {
  if (system === 'mini-hub') return 'Mini Hub';
  if (system === 'ai-os') return 'AI OS';
  if (system === 'macro-lab') return 'Macro Lab';
  return 'Browser';
}

export function actionLedgerDetail(action: ActionLedgerEntry): string {
  const parts = [actionLedgerSystemLabel(action.system), action.mode ? `${action.mode} mode` : '', action.recoverability.description]
    .filter(Boolean)
    .map(String);
  return parts.join(' - ');
}

function normalizeStatus(status: string): ActionLedgerStatus {
  if (['succeeded', 'failed', 'running', 'queued', 'paused', 'cancelled', 'dry_run', 'blocked', 'info'].includes(status)) {
    return status as ActionLedgerStatus;
  }
  if (status === 'success' || status === 'ok') return 'succeeded';
  if (status === 'error') return 'failed';
  return 'info';
}

function macroRunRisk(run: MacroRun): ActionLedgerRisk {
  const safety = run.steps.map((step) => String(step.safety ?? step.action_safety ?? '')).join(' ');
  if (/\bdestructive\b/iu.test(safety)) return 'destructive';
  if (/\bwrite\b/iu.test(safety)) return 'write';
  return 'system';
}

function macroRunChanged(run: MacroRun): string[] {
  const changed: string[] = [];
  for (const [index, step] of run.steps.entries()) {
    const before = changed.length;
    changed.push(...macroStepChangedPaths(step));
    if (changed.length === before) {
      const label = step.label ?? step.action_label ?? step.action_type ?? step.type;
      changed.push(typeof label === 'string' && label.trim() ? label : `step:${index + 1}`);
    }
  }
  return unique(changed).slice(0, 6);
}

function macroRecoverability(run: MacroRun): ActionRecoverability {
  if (run.dry_run) {
    return {
      kind: 'dry_run',
      referenceId: run.id,
      route: '/macro-lab',
      description: 'Dry-run recorded the planned steps without side effects.',
      reversible: true
    };
  }
  const artifacts = run.steps.map(macroStepRecoverability).filter((item): item is Record<string, unknown> => Boolean(item));
  if (artifacts.length) {
    const snapshots = artifacts.flatMap((artifact) => (Array.isArray(artifact.snapshots) ? artifact.snapshots : []));
    const inverseOperations = artifacts.flatMap((artifact) => (Array.isArray(artifact.inverse_operations) ? artifact.inverse_operations : []));
    const hasSnapshot = artifacts.some((artifact) => artifact.kind === 'snapshot') || snapshots.length > 0;
    const reversible = artifacts.some((artifact) => artifact.reversible === true);
    const noun = artifacts.length === 1 ? 'step' : 'steps';
    return {
      kind: hasSnapshot ? 'snapshot' : 'artifact',
      referenceId: run.id,
      route: '/macro-lab',
      description: `Macro Lab recorded recovery metadata for ${artifacts.length} ${noun}: ${snapshots.length} snapshot(s), ${inverseOperations.length} inverse operation(s).`,
      reversible
    };
  }
  return {
    kind: 'none',
    route: '/macro-lab',
    description: 'Macro run history is recorded, but no automatic rollback artifact is attached.',
    reversible: false
  };
}

function macroStepRecoverability(step: Record<string, unknown>): Record<string, unknown> | null {
  const detail = step.detail;
  if (!isRecord(detail)) return null;
  const recoverability = detail.recoverability;
  return isRecord(recoverability) ? recoverability : null;
}

function macroStepChangedPaths(step: Record<string, unknown>): string[] {
  const detail = step.detail;
  if (!isRecord(detail)) return [];
  const paths: string[] = [];
  for (const key of ['path', 'source', 'target']) {
    const value = detail[key];
    if (typeof value === 'string' && value.trim()) paths.push(value);
  }
  for (const collectionKey of ['operations', 'applied']) {
    const operations = detail[collectionKey];
    if (!Array.isArray(operations)) continue;
    for (const operation of operations) {
      if (!isRecord(operation)) continue;
      for (const key of ['path', 'source', 'target']) {
        const value = operation[key];
        if (typeof value === 'string' && value.trim()) paths.push(value);
      }
    }
  }
  const preRestoreSnapshots = detail.pre_restore_snapshots;
  if (Array.isArray(preRestoreSnapshots)) {
    for (const snapshot of preRestoreSnapshots) {
      if (!isRecord(snapshot)) continue;
      const target = snapshot.target;
      if (typeof target === 'string' && target.trim()) paths.push(target);
    }
  }
  const recoverability = macroStepRecoverability(step);
  const snapshots = recoverability?.snapshots;
  if (Array.isArray(snapshots)) {
    for (const snapshot of snapshots) {
      if (!isRecord(snapshot)) continue;
      const target = snapshot.target;
      if (typeof target === 'string' && target.trim()) paths.push(target);
    }
  }
  return paths;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim()))];
}

function dateValue(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
