import { env as publicEnv } from '$env/dynamic/public';

export const aiOsApiUrl =
  publicEnv.PUBLIC_AI_OS_API_URL || import.meta.env.VITE_PUBLIC_AI_OS_API_URL || 'http://127.0.0.1:8791';

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

export interface AiStatus {
  providers: AiProviderStatus[];
  capabilities: AiCapabilityStatus[];
  hardware: AiHardwareStatus;
  jobs: AiJobSnapshot[];
  background: AiBackgroundUnit[];
  tools: AiToolSpec[];
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
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${aiOsApiUrl}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init.headers ?? {})
    }
  });
  if (!response.ok) {
    let message = `AI OS request failed with ${response.status}`;
    try {
      const body = (await response.json()) as { detail?: unknown; error?: unknown };
      if (typeof body.detail === 'string') message = body.detail;
      else if (typeof body.error === 'string') message = body.error;
    } catch {
      // Preserve the status fallback.
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

export async function getAiStatus(): Promise<AiStatus> {
  return requestJson<AiStatus>('/api/ai/status');
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
  const response = await fetch(`${aiOsApiUrl}/api/ai/infer/stream`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(toInferencePayload({ ...input, stream: true } as AiInferenceInput))
  });
  if (!response.ok || !response.body) throw new Error(`AI OS stream failed with ${response.status}`);
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

export async function invokeMultimodal(kind: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await requestJson<{ result: Record<string, unknown> }>(`/api/ai/multimodal/${kind}/invoke`, {
    method: 'POST',
    body: JSON.stringify(input)
  });
  return result.result;
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
    local_first: input.local_first ?? true
  };
}
