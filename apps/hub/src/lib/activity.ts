import type { ActionLedgerEntry, PassiveRun, PassiveSnapshot } from '@mini-hub/core';
import type {
  AiBackupSummary,
  AiBenchmarkRun,
  AiGenerationAsset,
  AiJobSnapshot,
  AiStatus,
  AiToolCallEntry,
  ResearchRun
} from './ai-os-api';
import type { MacroRun } from './macro-lab-api';

export type ActivityStatus = 'queued' | 'running' | 'paused' | 'succeeded' | 'failed' | 'cancelled' | 'blocked' | 'skipped' | 'info';
export type ActivitySource = 'research' | 'ai-os' | 'passive' | 'macro-lab' | 'mini-hub';
export type ActivityActionKind = 'open' | 'resume' | 'cancel' | 'retry' | 'dismiss' | 'view_logs';

export interface ActivityAction {
  kind: ActivityActionKind;
  label: string;
  enabled: boolean;
  route?: string;
}

export interface ActivityRecord {
  id: string;
  source: ActivitySource;
  sourceLabel: string;
  title: string;
  detail: string;
  status: ActivityStatus;
  startedAt: string;
  updatedAt: string;
  progress?: number;
  error?: string;
  route: string;
  actions: ActivityAction[];
  metadata: Record<string, unknown>;
}

export interface ActivityBuildInput {
  aiStatus?: AiStatus | null;
  passiveSnapshot?: PassiveSnapshot | null;
  macroRuns?: MacroRun[];
  hubActions?: ActionLedgerEntry[];
}

export function buildActivityRecords(input: ActivityBuildInput, limit = 40): ActivityRecord[] {
  const records = [
    ...researchRecords(input.aiStatus?.research_runs ?? []),
    ...aiJobRecords(input.aiStatus?.jobs ?? []),
    ...toolCallRecords(input.aiStatus?.tool_calls ?? []),
    ...benchmarkRecords(input.aiStatus?.benchmark_runs ?? []),
    ...backupRecords(input.aiStatus?.backups ?? []),
    ...generationAssetRecords(input.aiStatus?.generation_assets ?? []),
    ...hubActionRecords(input.hubActions ?? []),
    ...passiveRecords(input.passiveSnapshot?.runs ?? []),
    ...macroRecords(input.macroRuns ?? [])
  ];

  return records
    .filter((record) => record.updatedAt || record.startedAt)
    .sort((a, b) => dateValue(b.updatedAt || b.startedAt) - dateValue(a.updatedAt || a.startedAt) || a.title.localeCompare(b.title))
    .slice(0, limit);
}

export function activityStatusLabel(status: ActivityStatus): string {
  if (status === 'succeeded') return 'ok';
  return status.replace('_', ' ');
}

export function activityHasActiveWork(records: ActivityRecord[]): boolean {
  return records.some((record) => ['queued', 'running', 'paused'].includes(record.status));
}

function researchRecords(runs: ResearchRun[]): ActivityRecord[] {
  return runs.map((run) => {
    const route = `/research?run=${encodeURIComponent(run.id)}`;
    const status = normalizeStatus(run.status);
    const controls = [
      action('open', 'Open', true, route),
      ...(status === 'paused' ? [action('resume', 'Resume', true)] : []),
      ...(status === 'queued' || status === 'running' || status === 'paused' ? [action('cancel', 'Cancel', true)] : []),
      action('view_logs', 'View Logs', true, route)
    ];
    return {
      id: `research:${run.id}`,
      source: 'research',
      sourceLabel: 'Research Desk',
      title: run.report?.title || `${titleCase(run.mode)} research`,
      detail: run.error || researchDetail(run),
      status,
      startedAt: run.created_at,
      updatedAt: run.updated_at || run.created_at,
      progress: progressValue(run.progress),
      error: run.error,
      route,
      actions: dismissibleActions(status, controls),
      metadata: { runId: run.id, mode: run.mode, goal: run.goal }
    };
  });
}

function aiJobRecords(jobs: AiJobSnapshot[]): ActivityRecord[] {
  return jobs.map((job) => {
    const route = `/ai-os?job=${encodeURIComponent(job.id)}`;
    const status = normalizeStatus(job.status);
    return {
      id: `ai-job:${job.id}`,
      source: 'ai-os',
      sourceLabel: 'AI OS',
      title: `${titleCase(job.primitive)} job`,
      detail: job.error || aiJobDetail(job),
      status,
      startedAt: job.created_at,
      updatedAt: job.updated_at || job.created_at,
      progress: progressValue(job.progress),
      error: job.error,
      route,
      actions: dismissibleActions(status, [
        action('open', 'Open', true, route),
        action('cancel', 'Cancel', status === 'queued' || status === 'running')
      ]),
      metadata: { jobId: job.id, primitive: job.primitive }
    };
  });
}

function toolCallRecords(calls: AiToolCallEntry[]): ActivityRecord[] {
  return calls.map((call) => {
    const route = `/ai-os?activity=tool&id=${encodeURIComponent(call.id)}`;
    const status: ActivityStatus = call.ok ? 'succeeded' : 'failed';
    return {
      id: `ai-tool:${call.id}`,
      source: 'ai-os',
      sourceLabel: 'AI OS',
      title: `Tool call: ${call.tool_id}`,
      detail: call.error || toolCallDetail(call),
      status,
      startedAt: call.created_at,
      updatedAt: call.created_at,
      error: call.error,
      route,
      actions: dismissibleActions(status, [
        action('open', 'Open', true, route),
        action('view_logs', 'View Logs', true, route)
      ]),
      metadata: { toolCallId: call.id, toolId: call.tool_id, safety: call.safety }
    };
  });
}

function benchmarkRecords(runs: AiBenchmarkRun[]): ActivityRecord[] {
  return runs.map((run) => {
    const route = `/ai-os?activity=benchmark&id=${encodeURIComponent(run.id)}`;
    return {
      id: `ai-benchmark:${run.id}`,
      source: 'ai-os',
      sourceLabel: 'AI OS',
      title: `${titleCase(run.kind)} benchmark`,
      detail: run.error || benchmarkDetail(run),
      status: run.ok ? 'succeeded' : 'failed',
      startedAt: run.created_at,
      updatedAt: run.created_at,
      error: run.error,
      route,
      actions: dismissibleActions('succeeded', [action('open', 'Open', true, route)]),
      metadata: { benchmarkId: run.id, provider: run.provider, model: run.model }
    };
  });
}

function backupRecords(backups: AiBackupSummary[]): ActivityRecord[] {
  return backups.map((backup) => {
    const route = `/ai-os?activity=backup&id=${encodeURIComponent(backup.id)}`;
    return {
      id: `ai-backup:${backup.id}`,
      source: 'ai-os',
      sourceLabel: 'AI OS',
      title: backup.reason ? `Backup: ${backup.reason}` : 'AI OS backup',
      detail: backup.error || `${formatBytes(backup.size_bytes)} stored at ${backup.path || 'backup manifest'}.`,
      status: backup.ok ? 'succeeded' : 'failed',
      startedAt: backup.created_at,
      updatedAt: backup.created_at,
      error: backup.error,
      route,
      actions: dismissibleActions(backup.ok ? 'succeeded' : 'failed', [
        action('open', 'Open', true, route),
        action('view_logs', 'View Logs', true, route)
      ]),
      metadata: { backupId: backup.id, path: backup.path }
    };
  });
}

function generationAssetRecords(assets: AiGenerationAsset[]): ActivityRecord[] {
  return assets.map((asset) => {
    const route = `/ai-os?activity=generation&id=${encodeURIComponent(asset.id)}`;
    return {
      id: `ai-generation:${asset.id}`,
      source: 'ai-os',
      sourceLabel: 'AI OS',
      title: `${titleCase(asset.kind)} generated`,
      detail: generationAssetDetail(asset),
      status: 'succeeded',
      startedAt: asset.created_at,
      updatedAt: asset.created_at,
      route,
      actions: dismissibleActions('succeeded', [
        action('open', 'Open', true, route),
        action('view_logs', 'View Logs', true, route)
      ]),
      metadata: { assetId: asset.id, kind: asset.kind, provider: asset.provider, model: asset.model }
    };
  });
}

function hubActionRecords(actions: ActionLedgerEntry[]): ActivityRecord[] {
  return actions.map((entry) => {
    const route = entry.recoverability.route || '/settings#action-ledger';
    const status = normalizeStatus(entry.status);
    return {
      id: `hub-action:${entry.id}`,
      source: 'mini-hub',
      sourceLabel: 'Mini Hub',
      title: entry.summary,
      detail: hubActionDetail(entry),
      status,
      startedAt: entry.occurredAt,
      updatedAt: entry.occurredAt,
      route,
      actions: dismissibleActions(status, [
        action('open', 'Open', true, route),
        action('view_logs', 'View Logs', true, '/settings#action-ledger')
      ]),
      metadata: {
        actionId: entry.id,
        actionType: entry.actionType,
        source: entry.source,
        risk: entry.risk,
        changed: entry.changed
      }
    };
  });
}

function passiveRecords(runs: PassiveRun[]): ActivityRecord[] {
  return runs.map((run) => {
    const route = `/passive-tasks?run=${encodeURIComponent(run.id)}`;
    const status = normalizeStatus(run.status);
    return {
      id: `passive:${run.id}`,
      source: 'passive',
      sourceLabel: 'Passive Tasks',
      title: `${titleCase(String(run.family))} run`,
      detail: run.error || passiveDetail(run),
      status,
      startedAt: run.startedAt,
      updatedAt: run.finishedAt || run.startedAt,
      error: run.error,
      route,
      actions: dismissibleActions(status, [
        action('open', 'Open', true, route),
        action('retry', 'Retry', status === 'failed' || status === 'blocked'),
        action('view_logs', 'View Logs', true, route)
      ]),
      metadata: { runId: run.id, taskId: run.taskId, family: run.family }
    };
  });
}

function macroRecords(runs: MacroRun[]): ActivityRecord[] {
  return runs.map((run) => {
    const route = `/macro-lab?run=${encodeURIComponent(run.id)}`;
    const status = normalizeStatus(run.status);
    return {
      id: `macro:${run.id}`,
      source: 'macro-lab',
      sourceLabel: 'Macro Lab',
      title: run.macro_name || 'Macro run',
      detail: run.error || `${run.steps.length} step${run.steps.length === 1 ? '' : 's'}${run.dry_run ? ', dry-run' : ''}.`,
      status,
      startedAt: run.started_at,
      updatedAt: run.finished_at || run.started_at,
      error: run.error,
      route,
      actions: dismissibleActions(status, [action('open', 'Open', true, route), action('view_logs', 'View Logs', true, route)]),
      metadata: { runId: run.id, macroId: run.macro_id, dryRun: run.dry_run }
    };
  });
}

function action(kind: ActivityActionKind, label: string, enabled: boolean, route?: string): ActivityAction {
  return { kind, label, enabled, ...(route ? { route } : {}) };
}

function dismissibleActions(status: ActivityStatus, actions: ActivityAction[]): ActivityAction[] {
  if (['queued', 'running', 'paused'].includes(status)) return actions;
  return [...actions, action('dismiss', 'Dismiss', true)];
}

function normalizeStatus(status: string): ActivityStatus {
  if (status === 'success' || status === 'saved' || status === 'ok') return 'succeeded';
  if (status === 'active') return 'running';
  if (['queued', 'running', 'paused', 'succeeded', 'failed', 'cancelled', 'blocked', 'skipped'].includes(status)) {
    return status as ActivityStatus;
  }
  return 'info';
}

function progressValue(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(1, value));
}

function researchDetail(run: ResearchRun): string {
  const progress = ['queued', 'running', 'paused'].includes(run.status) ? `, ${Math.round((run.progress ?? 0) * 100)}%` : '';
  const step = run.current_step ? `, ${run.current_step}` : '';
  const provider = [run.provider, run.model].filter(Boolean).join('/');
  return `${run.sources.length} source${run.sources.length === 1 ? '' : 's'}${progress}${step}${provider ? `, ${provider}` : ''}.`;
}

function aiJobDetail(job: AiJobSnapshot): string {
  if (job.total > 0) return `${job.completed}/${job.total} items complete${job.failed ? `, ${job.failed} failed` : ''}.`;
  return 'Tracked by the AI OS queue.';
}

function toolCallDetail(call: AiToolCallEntry): string {
  const gate = call.requires_confirmation ? ', confirmation gated' : '';
  return `${call.safety}${gate} action in ${Math.round(call.latency_ms)} ms.`;
}

function benchmarkDetail(run: AiBenchmarkRun): string {
  const provider = [run.provider, run.model].filter(Boolean).join('/');
  const speed = typeof run.tokens_per_second === 'number' ? `, ${run.tokens_per_second.toFixed(1)} tokens/sec` : '';
  return `${provider || 'auto route'} in ${Math.round(run.latency_ms)} ms${speed}.`;
}

function generationAssetDetail(asset: AiGenerationAsset): string {
  const provider = [asset.provider, asset.model].filter(Boolean).join('/');
  const location = asset.asset_path || asset.content_type || 'metadata logged';
  return `${provider || 'generation adapter'} - ${location}.`;
}

function hubActionDetail(entry: ActionLedgerEntry): string {
  const changed = entry.changed.length ? `, ${entry.changed.length} changed` : '';
  const reversible = entry.recoverability.reversible ? ', reversible' : '';
  return `${entry.source} ${entry.actionType}${changed}${reversible}.`;
}

function passiveDetail(run: PassiveRun): string {
  const parts = [
    run.cards.length ? `${run.cards.length} card${run.cards.length === 1 ? '' : 's'}` : '',
    run.changed.length ? `${run.changed.length} change${run.changed.length === 1 ? '' : 's'}` : '',
    run.metadata.snapshotVerified === true ? 'snapshot verified' : '',
    countDetail(run.metadata.cleanupCandidates, 'cleanup candidate'),
    countDetail(run.metadata.indexedFiles, 'indexed file'),
    countDetail(run.metadata.fileCount, 'file scanned'),
    countDetail(run.metadata.ignoredIntegrationConnectionIssues, 'ignored account issue')
  ].filter(Boolean);
  return parts.length ? `${parts.join(', ')}.` : 'No cards or changed artifacts.';
}

function countDetail(value: unknown, label: string): string {
  const count = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 0;
  if (count <= 0) return '';
  return `${count} ${label}${count === 1 ? '' : 's'}`;
}

function dateValue(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function titleCase(value: string): string {
  return value
    .replace(/[_-]/gu, ' ')
    .replace(/\b\w/gu, (match) => match.toUpperCase())
    .trim();
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
