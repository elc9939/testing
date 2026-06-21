import type { ActionLedgerEntry, ActionLedgerRisk, ActionLedgerStatus, ActionRecoverability } from '@mini-hub/core';
import { getHubActionLedger } from './api';
import { getAiActionLedger, type AiActionLedgerEntry } from './ai-os-api';
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
  errors?: string[];
  limit?: number;
}

export async function loadActionLedger(limit = 12): Promise<ActionLedgerSnapshot> {
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
    errors,
    limit
  });
}

export function buildActionLedgerSnapshot(input: ActionLedgerInput): ActionLedgerSnapshot {
  const actions = [
    ...(input.hubActions ?? []),
    ...(input.aiActions ?? []).map(normalizeAiAction),
    ...(input.macroRuns ?? []).map(macroRunToAction)
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
  if (['succeeded', 'failed', 'running', 'queued', 'cancelled', 'dry_run', 'blocked', 'info'].includes(status)) {
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
  return run.steps
    .map((step, index) => {
      const label = step.label ?? step.action_label ?? step.action_type ?? step.type;
      return typeof label === 'string' && label.trim() ? label : `step:${index + 1}`;
    })
    .slice(0, 6);
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
  return {
    kind: 'none',
    route: '/macro-lab',
    description: 'Macro run history is recorded, but no automatic rollback artifact is attached.',
    reversible: false
  };
}

function dateValue(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
