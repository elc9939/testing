import { env as publicEnv } from '$env/dynamic/public';
import { requestServiceJson, resolveServiceUrl } from './service-config';

export function getAiOsApiUrl(): string {
  return resolveServiceUrl(
    'aiOs',
    publicEnv.PUBLIC_AI_OS_API_URL || import.meta.env.VITE_PUBLIC_AI_OS_API_URL,
    'http://127.0.0.1:8791'
  );
}

export const aiOsApiUrl = getAiOsApiUrl();

export interface AiProviderStatus {
  id: string;
  label: string;
  available: boolean;
  local: boolean;
  paid: boolean;
  models: string[];
  capabilities: string[];
  error?: string;
  latency_ms?: number;
}

export interface AiCapabilityStatus {
  id: string;
  label: string;
  kind: string;
  available: boolean;
  enabled: boolean;
  safety: string;
  adapters: string[];
  description: string;
  error?: string;
}

export interface AiHardwareStatus {
  cpu_percent?: number;
  memory_percent?: number;
  memory_used_gb?: number;
  memory_total_gb?: number;
  gpus: Array<Record<string, unknown>>;
  loaded_models?: Array<Record<string, unknown>>;
  recent_tokens_per_second?: number;
  error?: string;
}

export interface AiJobSnapshot {
  id: string;
  primitive: string;
  status: string;
  created_at: string;
  updated_at: string;
  total: number;
  completed: number;
  failed: number;
  progress: number;
  cancel_requested: boolean;
  error?: string;
  metadata: Record<string, unknown>;
}

export interface AiBackgroundUnit {
  id: string;
  label: string;
  trigger: string;
  enabled: boolean;
  destructive: boolean;
  demo: boolean;
  description: string;
  last_run_at?: string;
  last_result?: Record<string, unknown>;
}

export interface AiToolSpec {
  id: string;
  label: string;
  description: string;
  input_schema: Record<string, unknown>;
  safety: 'read' | 'write' | 'destructive';
  requires_confirmation: boolean;
}

export interface AiUsageEntry {
  id: string;
  created_at: string;
  provider: string;
  model: string;
  task_type: string;
  ok: boolean;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_usd: number;
  latency_ms: number;
  error?: string;
  metadata: Record<string, unknown>;
}

export interface AiBackupSummary {
  id: string;
  path: string;
  created_at: string;
  ok: boolean;
  reason: string;
  size_bytes: number;
  error?: string;
}

export interface AiIntegrityStatus {
  ok: boolean;
  schema_version: number;
  expected_schema_version: number;
  integrity: string[];
  foreign_key_errors: Array<Record<string, unknown>>;
  json_errors: Array<Record<string, unknown>>;
  counts: Record<string, number>;
  database_path: string;
}

export interface AiMetrics {
  usage: Record<string, unknown>;
  queue: Record<string, unknown>;
  database: Record<string, number>;
  hardware?: AiHardwareStatus;
}

export interface AiToolCallEntry {
  id: string;
  created_at: string;
  tool_id: string;
  ok: boolean;
  safety: 'read' | 'write' | 'destructive';
  requires_confirmation: boolean;
  arguments: Record<string, unknown>;
  result: Record<string, unknown>;
  error?: string;
  latency_ms: number;
  run_id?: string;
}

export interface AiGenerationAsset {
  id: string;
  created_at: string;
  kind: string;
  provider: string;
  model?: string;
  prompt?: string;
  content_type?: string;
  asset_path?: string;
  metadata: Record<string, unknown>;
}

export interface AiDesignPatch {
  id: string;
  created_at: string;
  instruction: string;
  target_files: string[];
  patch: string;
  status: 'proposed' | 'applied' | 'reverted' | 'failed';
  applied_at?: string;
  reverted_at?: string;
  error?: string;
  metadata: Record<string, unknown>;
}

export interface AiBenchmarkRun {
  id: string;
  created_at: string;
  kind: string;
  provider?: string;
  model?: string;
  prompt: string;
  latency_ms: number;
  tokens_per_second?: number;
  hardware_before: Record<string, unknown>;
  hardware_after: Record<string, unknown>;
  result: Record<string, unknown>;
  ok: boolean;
  error?: string;
}

export interface AiAutotuneSummary {
  mode?: string;
  resource_pressure?: {
    level?: string;
    drivers?: string[];
    cpu_percent?: number;
    memory_percent?: number;
    gpu_utilization_percent?: number;
    vram_percent?: number;
  };
  best_text_route?: Record<string, unknown> | null;
  measured_providers?: Array<Record<string, unknown>>;
  suggested_max_job_concurrency?: number;
  routing_notes?: string[];
  confidence?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface AiMachineProfile {
  created_at: string;
  source: string;
  mode: string;
  host: Record<string, unknown>;
  hardware: AiHardwareStatus;
  providers: AiProviderStatus[];
  provider_summary: Record<string, number>;
  loaded_models: Array<Record<string, unknown>>;
  local_services: Record<string, Record<string, unknown>>;
  ai_os_health: Record<string, unknown>;
  capabilities: AiCapabilityStatus[];
  capability_readiness: Record<string, unknown>;
  benchmarks: {
    recent: AiBenchmarkRun[];
    best_text_route?: Record<string, unknown> | null;
    measured_providers?: Array<Record<string, unknown>>;
    text_samples?: number;
    [key: string]: unknown;
  };
  autotune: AiAutotuneSummary;
}

export interface AiMachineProfileSnapshot {
  id: string;
  created_at: string;
  source: string;
  profile: AiMachineProfile;
  autotune: AiAutotuneSummary;
}

export interface AiActionLedgerEntry {
  id: string;
  occurred_at: string;
  system: 'mini-hub' | 'ai-os' | 'macro-lab' | 'browser';
  source: string;
  action_type: string;
  summary: string;
  status: 'succeeded' | 'failed' | 'running' | 'queued' | 'cancelled' | 'dry_run' | 'blocked' | 'info';
  risk: 'read' | 'write' | 'system' | 'destructive';
  mode?: string;
  changed: string[];
  recoverability: {
    kind: 'none' | 'backup' | 'snapshot' | 'dry_run' | 'patch' | 'restore_test' | 'artifact';
    reference_id?: string;
    route?: string;
    description: string;
    reversible: boolean;
  };
  raw_ref: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export interface AiAutotuneResult {
  ok: boolean;
  benchmark?: AiBenchmarkRun | null;
  error?: string | null;
  profile: AiMachineProfile;
  snapshot?: AiMachineProfileSnapshot | null;
}

export interface AiStatus {
  providers: AiProviderStatus[];
  capabilities: AiCapabilityStatus[];
  hardware: AiHardwareStatus;
  jobs: AiJobSnapshot[];
  background: AiBackgroundUnit[];
  tools: AiToolSpec[];
  tool_calls?: AiToolCallEntry[];
  generation_assets?: AiGenerationAsset[];
  benchmark_runs?: AiBenchmarkRun[];
  machine_profile?: AiMachineProfile;
  integrity?: AiIntegrityStatus;
  backups?: AiBackupSummary[];
  metrics?: AiMetrics;
}

export interface AiInferenceInput {
  prompt: string;
  provider?: string;
  model?: string;
  task_type?: string;
  temperature?: number;
  max_tokens?: number;
  allow_fallback?: boolean;
  local_first?: boolean;
  metadata?: Record<string, unknown>;
}

export type ResearchMode = 'quick_search' | 'deep_research' | 'url_scrape' | 'site_crawl' | 'compare_sources' | 'monitor_topic';

export interface ResearchRunInput {
  mode: ResearchMode;
  goal: string;
  seed_urls?: string[];
  depth?: number;
  max_pages?: number;
  per_domain_limit?: number;
  time_budget_s?: number;
  date_range_start?: string;
  date_range_end?: string;
  include_domains?: string[];
  exclude_domains?: string[];
  use_ai?: boolean;
  use_cloud_ai?: boolean;
  local_first?: boolean;
  provider?: string;
  model?: string;
  screenshot?: boolean;
  save_to_memory?: boolean;
  metadata?: Record<string, unknown>;
}

export interface ResearchSource {
  id: string;
  url: string;
  canonical_url: string;
  title: string;
  author?: string;
  published_at?: string;
  description: string;
  text: string;
  text_length: number;
  links: Array<Record<string, string>>;
  tables: Array<Record<string, unknown>>;
  metadata: Record<string, unknown>;
  score: number;
  rank: number;
  cached: boolean;
  fetched_at: string;
}

export interface ResearchCitation {
  id: string;
  claim: string;
  source_ids: string[];
  quote?: string;
}

export interface ResearchReport {
  title: string;
  tldr: string;
  detailed_summary: string;
  key_facts: string[];
  disagreements: string[];
  source_table: Array<Record<string, unknown>>;
  open_questions: string[];
  next_research_suggestions: string[];
  reliability_notes: string[];
  timeline: Array<Record<string, unknown>>;
}

export interface ResearchRun {
  id: string;
  created_at: string;
  updated_at: string;
  mode: ResearchMode;
  goal: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  query_plan: Record<string, unknown>;
  sources: ResearchSource[];
  report: ResearchReport;
  citations: ResearchCitation[];
  logs: Array<Record<string, unknown>>;
  progress: number;
  total_steps: number;
  completed_steps: number;
  current_step: string;
  cancel_requested: boolean;
  memory_document_id?: string;
  memory_chunks: number;
  provider?: string;
  model?: string;
  total_tokens: number;
  cost_usd: number;
  runtime_ms: number;
  cached_pages: number;
  error?: string;
  options: Record<string, unknown>;
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  return requestServiceJson<T>('aiOs', getAiOsApiUrl(), path, init);
}

export async function getAiStatus(mode?: string): Promise<AiStatus> {
  const query = mode ? `?mode=${encodeURIComponent(mode)}` : '';
  return requestJson<AiStatus>(`/api/ai/status${query}`);
}

export async function getAiUsage(limit = 50): Promise<AiUsageEntry[]> {
  const result = await requestJson<{ usage: AiUsageEntry[] }>(`/api/ai/usage?limit=${limit}`);
  return result.usage;
}

export async function getAiFullHealth(): Promise<Record<string, unknown>> {
  return requestJson<Record<string, unknown>>('/api/ai/health/full');
}

export async function getAiMetrics(): Promise<AiMetrics> {
  return requestJson<AiMetrics>('/api/ai/metrics');
}

export async function listAiBackups(): Promise<AiBackupSummary[]> {
  const result = await requestJson<{ backups: AiBackupSummary[] }>('/api/ai/backups');
  return result.backups;
}

export async function createAiBackup(reason = 'dashboard'): Promise<Record<string, unknown>> {
  const result = await requestJson<{ backup: Record<string, unknown> }>('/api/ai/backups', {
    method: 'POST',
    body: JSON.stringify({ reason })
  });
  return result.backup;
}

export async function verifyAiBackup(backupId: string): Promise<Record<string, unknown>> {
  const result = await requestJson<{ verification: Record<string, unknown> }>(
    `/api/ai/backups/${encodeURIComponent(backupId)}/verify`,
    { method: 'POST' }
  );
  return result.verification;
}

export async function restoreTestAiBackup(backupId: string): Promise<Record<string, unknown>> {
  const result = await requestJson<{ restore: Record<string, unknown> }>(
    `/api/ai/backups/${encodeURIComponent(backupId)}/restore-test`,
    { method: 'POST' }
  );
  return result.restore;
}

export async function cleanupAiOs(): Promise<Record<string, unknown>> {
  return requestJson<Record<string, unknown>>('/api/ai/maintenance/cleanup', { method: 'POST' });
}

export async function runInference(input: AiInferenceInput): Promise<Record<string, unknown>> {
  const result = await requestJson<{ result: Record<string, unknown> }>('/api/ai/infer', {
    method: 'POST',
    body: JSON.stringify(toInferencePayload(input))
  });
  return result.result;
}

export async function streamInference(
  input: AiInferenceInput,
  onEvent: (event: string, data: Record<string, unknown>) => void
): Promise<void> {
  const baseUrl = getAiOsApiUrl();
  const response = await fetch(`${baseUrl}/api/ai/infer/stream`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream, application/json' },
    body: JSON.stringify(toInferencePayload({ ...input, stream: true } as AiInferenceInput))
  });
  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '');
    if (text.trimStart().startsWith('<')) {
      throw new Error(`AI OS stream returned the web app HTML instead of events. Set AI OS API URL in Settings to the desktop service, usually ${baseUrl}.`);
    }
    throw new Error(`AI OS stream failed with ${response.status}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      const lines = frame.split('\n');
      const event = lines.find((line) => line.startsWith('event:'))?.slice(6).trim() || 'message';
      const dataLine = lines.find((line) => line.startsWith('data:'));
      if (!dataLine) continue;
      onEvent(event, JSON.parse(dataLine.slice(5).trim()) as Record<string, unknown>);
    }
  }
}

export async function createAiJob(input: Record<string, unknown>): Promise<AiJobSnapshot> {
  const result = await requestJson<{ job: AiJobSnapshot }>('/api/ai/jobs', {
    method: 'POST',
    body: JSON.stringify(input)
  });
  return result.job;
}

export async function listAiJobs(): Promise<AiJobSnapshot[]> {
  const result = await requestJson<{ jobs: AiJobSnapshot[] }>('/api/ai/jobs');
  return result.jobs;
}

export async function cancelAiJob(jobId: string): Promise<AiJobSnapshot> {
  const result = await requestJson<{ job: AiJobSnapshot }>(`/api/ai/jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: 'POST'
  });
  return result.job;
}

export async function ingestMemory(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await requestJson<{ result: Record<string, unknown> }>('/api/ai/memory/ingest', {
    method: 'POST',
    body: JSON.stringify(input)
  });
  return result.result;
}

export async function queryMemory(input: Record<string, unknown>): Promise<Array<Record<string, unknown>>> {
  const result = await requestJson<{ hits: Array<Record<string, unknown>> }>('/api/ai/memory/query', {
    method: 'POST',
    body: JSON.stringify(input)
  });
  return result.hits;
}

export async function runAgent(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await requestJson<{ result: Record<string, unknown> }>('/api/ai/agents/run', {
    method: 'POST',
    body: JSON.stringify(input)
  });
  return result.result;
}

export async function runCommand(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  return requestJson<Record<string, unknown>>('/api/ai/command', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export async function listToolCalls(limit = 50): Promise<AiToolCallEntry[]> {
  const result = await requestJson<{ tool_calls: AiToolCallEntry[] }>(`/api/ai/tool-calls?limit=${limit}`);
  return result.tool_calls;
}

export async function invokeMultimodal(kind: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await requestJson<{ result: Record<string, unknown> }>(`/api/ai/multimodal/${kind}/invoke`, {
    method: 'POST',
    body: JSON.stringify(input)
  });
  return result.result;
}

export async function listGenerationAssets(limit = 50): Promise<AiGenerationAsset[]> {
  const result = await requestJson<{ assets: AiGenerationAsset[] }>(`/api/ai/generation-assets?limit=${limit}`);
  return result.assets;
}

export async function listDesignPatches(limit = 25): Promise<AiDesignPatch[]> {
  const result = await requestJson<{ patches: AiDesignPatch[] }>(`/api/ai/design/patches?limit=${limit}`);
  return result.patches;
}

export async function proposeDesignPatch(input: Record<string, unknown>): Promise<AiDesignPatch> {
  const result = await requestJson<{ patch: AiDesignPatch }>('/api/ai/design/patches', {
    method: 'POST',
    body: JSON.stringify(input)
  });
  return result.patch;
}

export async function applyDesignPatch(patchId: string, confirm: boolean): Promise<AiDesignPatch> {
  const result = await requestJson<{ patch: AiDesignPatch }>(
    `/api/ai/design/patches/${encodeURIComponent(patchId)}/apply`,
    {
      method: 'POST',
      body: JSON.stringify({ confirm })
    }
  );
  return result.patch;
}

export async function revertDesignPatch(patchId: string, confirm: boolean): Promise<AiDesignPatch> {
  const result = await requestJson<{ patch: AiDesignPatch }>(
    `/api/ai/design/patches/${encodeURIComponent(patchId)}/revert`,
    {
      method: 'POST',
      body: JSON.stringify({ confirm })
    }
  );
  return result.patch;
}

export async function runBenchmark(input: Record<string, unknown>): Promise<AiBenchmarkRun> {
  const result = await requestJson<{ benchmark: AiBenchmarkRun }>('/api/ai/benchmarks', {
    method: 'POST',
    body: JSON.stringify(input)
  });
  return result.benchmark;
}

export async function getMachineProfile(mode?: string, snapshots = 10): Promise<{ profile: AiMachineProfile; snapshots: AiMachineProfileSnapshot[] }> {
  const params = new URLSearchParams();
  if (mode) params.set('mode', mode);
  params.set('snapshots', String(snapshots));
  return requestJson<{ profile: AiMachineProfile; snapshots: AiMachineProfileSnapshot[] }>(
    `/api/ai/machine-profile?${params.toString()}`
  );
}

export async function snapshotMachineProfile(source = 'hub'): Promise<AiMachineProfileSnapshot> {
  const result = await requestJson<{ snapshot: AiMachineProfileSnapshot }>('/api/ai/machine-profile/snapshots', {
    method: 'POST',
    body: JSON.stringify({ source })
  });
  return result.snapshot;
}

export async function runAutotune(input: Record<string, unknown>): Promise<AiAutotuneResult> {
  return requestJson<AiAutotuneResult>('/api/ai/autotune', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export async function listBenchmarks(limit = 25): Promise<AiBenchmarkRun[]> {
  const result = await requestJson<{ benchmarks: AiBenchmarkRun[] }>(`/api/ai/benchmarks?limit=${limit}`);
  return result.benchmarks;
}

export async function listResearchRuns(limit = 25): Promise<ResearchRun[]> {
  const result = await requestJson<{ runs: ResearchRun[] }>(`/api/ai/research/runs?limit=${limit}`);
  return result.runs;
}

export async function getResearchRun(runId: string): Promise<ResearchRun> {
  const result = await requestJson<{ run: ResearchRun }>(`/api/ai/research/runs/${encodeURIComponent(runId)}`);
  return result.run;
}

export async function createResearchRun(input: ResearchRunInput): Promise<ResearchRun> {
  const result = await requestJson<{ run: ResearchRun }>('/api/ai/research/runs', {
    method: 'POST',
    body: JSON.stringify(input)
  });
  return result.run;
}

export async function cancelResearchRun(runId: string): Promise<ResearchRun> {
  const result = await requestJson<{ run: ResearchRun }>(
    `/api/ai/research/runs/${encodeURIComponent(runId)}/cancel`,
    { method: 'POST' }
  );
  return result.run;
}

export function researchExportUrl(runId: string, format: 'markdown' | 'html' | 'json' = 'markdown'): string {
  return `${getAiOsApiUrl()}/api/ai/research/runs/${encodeURIComponent(runId)}/export?format=${encodeURIComponent(format)}`;
}

export async function getAiActionLedger(limit = 50): Promise<AiActionLedgerEntry[]> {
  const result = await requestJson<{ actions: AiActionLedgerEntry[] }>(`/api/ai/action-ledger?limit=${limit}`);
  return result.actions;
}

export async function restoreAiActionSnapshot(snapshotId: string): Promise<Record<string, unknown>> {
  const result = await requestJson<{ restore: Record<string, unknown> }>(
    `/api/ai/action-snapshots/${encodeURIComponent(snapshotId)}/restore`,
    {
      method: 'POST',
      body: JSON.stringify({ confirm: true })
    }
  );
  return result.restore;
}

export async function toggleBackgroundUnit(unitId: string, enabled: boolean): Promise<AiBackgroundUnit> {
  const result = await requestJson<{ unit: AiBackgroundUnit }>(
    `/api/ai/background/units/${encodeURIComponent(unitId)}/toggle`,
    {
      method: 'POST',
      body: JSON.stringify({ enabled })
    }
  );
  return result.unit;
}

export async function runBackgroundUnit(unitId: string): Promise<AiBackgroundUnit> {
  const result = await requestJson<{ unit: AiBackgroundUnit }>(
    `/api/ai/background/units/${encodeURIComponent(unitId)}/run`,
    { method: 'POST', body: JSON.stringify({}) }
  );
  return result.unit;
}

function toInferencePayload(input: AiInferenceInput): Record<string, unknown> {
  return {
    task_type: input.task_type || 'ad_hoc',
    prompt: input.prompt,
    provider: input.provider || undefined,
    model: input.model || undefined,
    temperature: input.temperature ?? 0.2,
    max_tokens: input.max_tokens ?? 512,
    allow_fallback: input.allow_fallback ?? true,
    local_first: input.local_first ?? true,
    metadata: input.metadata ?? {}
  };
}
