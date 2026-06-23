import type { AiStatus } from './ai-os-api';

export type AiActivityKind = 'job' | 'tool' | 'benchmark' | 'backup' | 'generation' | 'research';
export type AiActivityState = 'running' | 'queued' | 'paused' | 'success' | 'failed' | 'cancelled' | 'info';

export interface AiActivityItem {
  id: string;
  kind: AiActivityKind;
  title: string;
  detail: string;
  state: AiActivityState;
  occurredAt: string;
  route: string;
}

export function buildAiActivityItems(status: AiStatus | null | undefined, limit = 8): AiActivityItem[] {
  if (!status) return [];
  const items = [
    ...(status.jobs ?? []).map((job) => ({
      id: `job:${job.id}`,
      kind: 'job' as const,
      title: `${titleCase(job.primitive)} job ${job.status}`,
      detail: job.error || jobProgress(job),
      state: jobState(job.status),
      occurredAt: job.updated_at || job.created_at,
      route: `/ai-os?job=${encodeURIComponent(job.id)}`
    })),
    ...(status.tool_calls ?? []).map((call) => ({
      id: `tool:${call.id}`,
      kind: 'tool' as const,
      title: `Tool call: ${call.tool_id}`,
      detail: call.error || toolCallDetail(call),
      state: call.ok ? ('success' as const) : ('failed' as const),
      occurredAt: call.created_at,
      route: `/ai-os?activity=tool&id=${encodeURIComponent(call.id)}`
    })),
    ...(status.benchmark_runs ?? []).map((run) => ({
      id: `benchmark:${run.id}`,
      kind: 'benchmark' as const,
      title: `${titleCase(run.kind)} benchmark`,
      detail: run.error || benchmarkDetail(run),
      state: run.ok ? ('success' as const) : ('failed' as const),
      occurredAt: run.created_at,
      route: `/ai-os?activity=benchmark&id=${encodeURIComponent(run.id)}`
    })),
    ...(status.backups ?? []).map((backup) => ({
      id: `backup:${backup.id}`,
      kind: 'backup' as const,
      title: backup.reason ? `Backup: ${backup.reason}` : 'Backup',
      detail: backup.error || `${formatBytes(backup.size_bytes)} verified by manifest and SQLite checks.`,
      state: backup.ok ? ('success' as const) : ('failed' as const),
      occurredAt: backup.created_at,
      route: `/ai-os?activity=backup&id=${encodeURIComponent(backup.id)}`
    })),
    ...(status.generation_assets ?? []).map((asset) => ({
      id: `generation:${asset.id}`,
      kind: 'generation' as const,
      title: `${titleCase(asset.kind)} generated`,
      detail: generationDetail(asset),
      state: 'success' as const,
      occurredAt: asset.created_at,
      route: `/ai-os?activity=generation&id=${encodeURIComponent(asset.id)}`
    })),
    ...(status.research_runs ?? []).map((run) => ({
      id: `research:${run.id}`,
      kind: 'research' as const,
      title: `${titleCase(run.mode)} ${researchStatusLabel(run.status)}`,
      detail: run.error || researchDetail(run),
      state: researchState(run.status),
      occurredAt: run.updated_at || run.created_at,
      route: `/research?run=${encodeURIComponent(run.id)}`
    }))
  ];

  return items
    .filter((item) => item.occurredAt)
    .sort((a, b) => dateValue(b.occurredAt) - dateValue(a.occurredAt) || a.title.localeCompare(b.title))
    .slice(0, limit);
}

export function aiActivityStateLabel(state: AiActivityState): string {
  if (state === 'success') return 'ok';
  return state;
}

function jobState(status: string): AiActivityState {
  if (status === 'running') return 'running';
  if (status === 'queued') return 'queued';
  if (status === 'paused') return 'paused';
  if (status === 'succeeded') return 'success';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'failed') return 'failed';
  return 'info';
}

function researchState(status: string): AiActivityState {
  return jobState(status);
}

function jobProgress(job: NonNullable<AiStatus['jobs']>[number]): string {
  const total = Number.isFinite(job.total) ? job.total : 0;
  const completed = Number.isFinite(job.completed) ? job.completed : 0;
  const failed = Number.isFinite(job.failed) ? job.failed : 0;
  if (total > 0) {
    const failedText = failed ? `, ${failed} failed` : '';
    return `${completed}/${total} items complete${failedText}.`;
  }
  return 'Job is tracked by the AI OS queue.';
}

function toolCallDetail(call: NonNullable<AiStatus['tool_calls']>[number]): string {
  const safety = call.requires_confirmation ? `${call.safety}, confirmation gated` : call.safety;
  return `${safety} action in ${Math.round(call.latency_ms)} ms.`;
}

function benchmarkDetail(run: NonNullable<AiStatus['benchmark_runs']>[number]): string {
  const provider = [run.provider, run.model].filter(Boolean).join('/');
  const speed = typeof run.tokens_per_second === 'number' ? `, ${run.tokens_per_second.toFixed(1)} tokens/sec` : '';
  return `${provider || 'auto route'} completed in ${Math.round(run.latency_ms)} ms${speed}.`;
}

function generationDetail(asset: NonNullable<AiStatus['generation_assets']>[number]): string {
  const provider = [asset.provider, asset.model].filter(Boolean).join('/');
  return [provider || 'generation adapter', asset.asset_path || asset.content_type || 'metadata logged'].join(' - ');
}

function researchDetail(run: NonNullable<AiStatus['research_runs']>[number]): string {
  const provider = [run.provider, run.model].filter(Boolean).join('/');
  const sourceText = `${run.sources.length} source${run.sources.length === 1 ? '' : 's'}`;
  const cachedText = run.cached_pages ? `, ${run.cached_pages} cached` : '';
  const progressText = run.status === 'running' || run.status === 'queued' || run.status === 'paused'
    ? `, ${Math.round((run.progress ?? 0) * 100)}%`
    : '';
  const runtimeText = run.runtime_ms ? `, ${Math.round(run.runtime_ms)} ms` : '';
  return `${sourceText}${cachedText}${progressText}${runtimeText}${provider ? `, ${provider}` : ', extractive'}.`;
}

function researchStatusLabel(status: string): string {
  if (status === 'succeeded') return 'saved';
  return status.replace('_', ' ');
}

function titleCase(value: string): string {
  return value
    .replace(/[_-]/gu, ' ')
    .replace(/\b\w/gu, (match) => match.toUpperCase())
    .trim();
}

function dateValue(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
