import { getHealth } from './api';
import { getAiStatus, type AiCapabilityStatus, type AiProviderStatus, type AiStatus } from './ai-os-api';
import { getMacroStatus, type MacroStatus } from './macro-lab-api';
import { getPassiveSnapshot } from './passive-tasks-api';
import type { PassiveSnapshot } from '@mini-hub/core';

export type CapabilityState = 'ready' | 'running' | 'degraded' | 'needs_setup' | 'offline' | 'blocked';
export type CapabilityService = 'hub' | 'productivity' | 'ai-os' | 'macro-lab' | 'passive-tasks' | 'browser';
export type CapabilityLocality = 'local' | 'cloud' | 'hybrid' | 'browser';
export type CapabilityCost = 'free' | 'paid' | 'mixed' | 'unknown';
export type CapabilitySafety = 'read' | 'write' | 'system' | 'destructive';

export interface CapabilityRegistryEntry {
  id: string;
  label: string;
  description: string;
  service: CapabilityService;
  state: CapabilityState;
  available: boolean;
  locality: CapabilityLocality;
  cost: CapabilityCost;
  safety: CapabilitySafety;
  route: string;
  requiredService?: string;
  lastError?: string;
  metrics?: Record<string, string | number | boolean>;
  tags?: string[];
}

export interface CapabilityRegistrySnapshot {
  checkedAt: string;
  capabilities: CapabilityRegistryEntry[];
  summary: {
    total: number;
    ready: number;
    running: number;
    degraded: number;
    needsSetup: number;
    offline: number;
    blocked: number;
    localReady: number;
    paidReady: number;
  };
}

export interface CompactCapabilityRegistryContext {
  checkedAt: string;
  summary: CapabilityRegistrySnapshot['summary'];
  ready: Array<Pick<CapabilityRegistryEntry, 'id' | 'label' | 'service' | 'locality' | 'cost' | 'route'>>;
  issues: Array<Pick<CapabilityRegistryEntry, 'id' | 'label' | 'service' | 'state' | 'route' | 'requiredService' | 'lastError'>>;
}

export interface CapabilityRegistryInput {
  checkedAt?: string;
  isOnline: boolean;
  syncStatus: 'idle' | 'syncing' | 'offline-readonly' | 'error';
  syncError?: string;
  googleConnected: boolean;
  hubHealth?: { ok: boolean; service: string };
  hubError?: string;
  aiStatus?: AiStatus;
  aiError?: string;
  macroStatus?: MacroStatus;
  macroError?: string;
  passiveSnapshot?: PassiveSnapshot;
  passiveError?: string;
}

export interface LoadCapabilityRegistryInput {
  isOnline: boolean;
  syncStatus: CapabilityRegistryInput['syncStatus'];
  syncError?: string;
  googleConnected: boolean;
  machineMode?: string;
}

export async function loadCapabilityRegistry(input: LoadCapabilityRegistryInput): Promise<CapabilityRegistrySnapshot> {
  const [hub, ai, macro, passive] = await Promise.allSettled([
    getHealth(),
    getAiStatus(input.machineMode),
    getMacroStatus(),
    getPassiveSnapshot()
  ]);
  return buildCapabilityRegistry({
    ...input,
    hubHealth: hub.status === 'fulfilled' ? hub.value : undefined,
    hubError: hub.status === 'rejected' ? errorMessage(hub.reason) : undefined,
    aiStatus: ai.status === 'fulfilled' ? ai.value : undefined,
    aiError: ai.status === 'rejected' ? errorMessage(ai.reason) : undefined,
    macroStatus: macro.status === 'fulfilled' ? macro.value : undefined,
    macroError: macro.status === 'rejected' ? errorMessage(macro.reason) : undefined,
    passiveSnapshot: passive.status === 'fulfilled' ? passive.value : undefined,
    passiveError: passive.status === 'rejected' ? errorMessage(passive.reason) : undefined
  });
}

export function buildCapabilityRegistry(input: CapabilityRegistryInput): CapabilityRegistrySnapshot {
  const capabilities: CapabilityRegistryEntry[] = [];

  capabilities.push({
    id: 'browser.offline-cache',
    label: 'Offline cache',
    description: input.isOnline ? 'Browser cache is available for local-first reads.' : 'Browser is offline; cached records stay visible read-only.',
    service: 'browser',
    state: input.syncStatus === 'error' ? 'degraded' : ['offline-readonly', 'syncing'].includes(input.syncStatus) ? 'running' : 'ready',
    available: input.syncStatus !== 'error',
    locality: 'browser',
    cost: 'free',
    safety: 'read',
    route: '/settings',
    requiredService: 'PGlite',
    lastError: input.syncError || undefined,
    tags: ['local-first', 'sync']
  });

  capabilities.push({
    id: 'hub.api',
    label: 'Mini Hub API',
    description: 'Personal data, sync, career/study records, game state, and Google integration API.',
    service: 'hub',
    state: input.hubHealth?.ok ? 'ready' : 'offline',
    available: Boolean(input.hubHealth?.ok),
    locality: 'local',
    cost: 'free',
    safety: 'write',
    route: '/settings',
    requiredService: 'Mini Hub API',
    lastError: input.hubError,
    tags: ['sync', 'data']
  });

  capabilities.push({
    id: 'productivity.google',
    label: 'Google productivity',
    description: 'Calendar and Gmail workflows for agenda, mail triage, and timeline signals.',
    service: 'productivity',
    state: input.googleConnected ? 'ready' : 'needs_setup',
    available: input.googleConnected,
    locality: 'cloud',
    cost: 'free',
    safety: 'write',
    route: '/productivity',
    requiredService: 'Mini Hub API + Google OAuth',
    tags: ['calendar', 'gmail']
  });

  addAiCapabilities(capabilities, input.aiStatus, input.aiError);
  addMacroCapabilities(capabilities, input.macroStatus, input.macroError);
  addPassiveTaskCapabilities(capabilities, input.passiveSnapshot, input.passiveError);

  return summarizeCapabilities(input.checkedAt ?? new Date().toISOString(), capabilities);
}

export function selectCapabilityIssues(snapshot: CapabilityRegistrySnapshot | null, limit = 5): CapabilityRegistryEntry[] {
  if (!snapshot) return [];
  return snapshot.capabilities
    .filter((capability) => capability.state !== 'ready' && capability.state !== 'running')
    .sort((a, b) => stateIssueRank(b.state) - stateIssueRank(a.state) || a.label.localeCompare(b.label))
    .slice(0, limit);
}

export function capabilityStateLabel(state: CapabilityState): string {
  if (state === 'needs_setup') return 'needs setup';
  return state.replace('_', ' ');
}

export function capabilityServiceLabel(service: CapabilityService): string {
  if (service === 'hub') return 'Mini Hub API';
  if (service === 'productivity') return 'Productivity';
  if (service === 'ai-os') return 'AI OS';
  if (service === 'macro-lab') return 'Macro Lab';
  if (service === 'passive-tasks') return 'Passive Tasks';
  return 'Browser Cache';
}

export function compactCapabilityRegistryContext(snapshot: CapabilityRegistrySnapshot, limit = 8): CompactCapabilityRegistryContext {
  return {
    checkedAt: snapshot.checkedAt,
    summary: snapshot.summary,
    ready: snapshot.capabilities
      .filter((capability) => capability.available && ['ready', 'running'].includes(capability.state))
      .sort((a, b) => readyCapabilityRank(b) - readyCapabilityRank(a) || a.label.localeCompare(b.label))
      .slice(0, limit)
      .map((capability) => ({
        id: capability.id,
        label: capability.label,
        service: capability.service,
        locality: capability.locality,
        cost: capability.cost,
        route: capability.route
      })),
    issues: selectCapabilityIssues(snapshot, limit).map((capability) => ({
      id: capability.id,
      label: capability.label,
      service: capability.service,
      state: capability.state,
      route: capability.route,
      requiredService: capability.requiredService,
      lastError: capability.lastError
    }))
  };
}

export function formatCapabilityRegistrySummary(snapshot: CapabilityRegistrySnapshot): string {
  const context = compactCapabilityRegistryContext(snapshot, 6);
  const usable = snapshot.summary.ready + snapshot.summary.running;
  const lines = [
    `Capability registry: ${usable}/${snapshot.summary.total} usable now. Local ready: ${snapshot.summary.localReady}. Paid/API ready: ${snapshot.summary.paidReady}.`
  ];

  if (context.ready.length) {
    lines.push(
      `Ready now:\n${context.ready
        .map((capability) => `- ${capability.label} (${capability.locality}, ${capability.cost})`)
        .join('\n')}`
    );
  }

  if (context.issues.length) {
    lines.push(
      `Needs attention:\n${context.issues
        .map((capability) => {
          const detail = capability.lastError || capability.requiredService || capability.route;
          return `- ${capability.label}: ${capabilityStateLabel(capability.state)}${detail ? ` - ${detail}` : ''}`;
        })
        .join('\n')}`
    );
  } else {
    lines.push('No capability blockers are currently visible from the hub.');
  }

  return lines.join('\n\n');
}

function addAiCapabilities(capabilities: CapabilityRegistryEntry[], status: AiStatus | undefined, error: string | undefined): void {
  const providers = status?.providers ?? [];
  const localProviders = providers.filter((provider) => provider.local);
  const paidProviders = providers.filter((provider) => provider.paid);
  const availableLocal = localProviders.filter((provider) => provider.available);
  const availablePaid = paidProviders.filter((provider) => provider.available);
  const runningJobs = status?.jobs.filter((job) => ['queued', 'running'].includes(job.status)).length ?? 0;
  const profile = status?.machine_profile;
  const pressure = profile?.autotune?.resource_pressure?.level ?? 'unknown';
  const bestRoute = profile?.autotune?.best_text_route ?? profile?.benchmarks?.best_text_route ?? null;
  const bestRouteLabel = routeLabel(bestRoute);
  const bestRouteSpeed = routeTokensPerSecond(bestRoute);

  capabilities.push({
    id: 'ai-os.service',
    label: 'AI OS API',
    description: 'Model routing, jobs, memory, agents, media generation, backups, and telemetry.',
    service: 'ai-os',
    state: status ? 'ready' : 'offline',
    available: Boolean(status),
    locality: 'local',
    cost: 'free',
    safety: 'system',
    route: '/ai-os',
    requiredService: 'AI OS API',
    lastError: error,
    metrics: status
      ? {
          providers: providers.length,
          tools: status.tools.length,
          jobs: status.jobs.length
        }
      : undefined,
    tags: ['ai', 'service']
  });

  capabilities.push({
    id: 'ai.local-llm',
    label: 'Local LLM route',
    description: 'Private/free local inference through Ollama or compatible local model servers.',
    service: 'ai-os',
    state: status ? (availableLocal.length ? 'ready' : localProviders.length ? 'degraded' : 'needs_setup') : 'offline',
    available: Boolean(availableLocal.length),
    locality: 'local',
    cost: 'free',
    safety: 'read',
    route: '/ai-os',
    requiredService: 'Ollama or local OpenAI-compatible server',
    lastError: firstProviderError(localProviders),
    metrics: {
      ready: availableLocal.length,
      configured: localProviders.length,
      ...(bestRouteLabel ? { bestRoute: bestRouteLabel } : {}),
      ...(bestRouteSpeed !== undefined ? { bestTokensPerSecond: bestRouteSpeed } : {})
    },
    tags: ['ai', 'local']
  });

  capabilities.push({
    id: 'ai.paid-fallback',
    label: 'Paid API fallback',
    description: 'Optional frontier/provider API routes for harder or longer-context requests.',
    service: 'ai-os',
    state: status ? (availablePaid.length ? 'ready' : paidProviders.length ? 'needs_setup' : 'needs_setup') : 'offline',
    available: Boolean(availablePaid.length),
    locality: 'cloud',
    cost: 'paid',
    safety: 'read',
    route: '/ai-os',
    requiredService: 'OpenAI/Anthropic/specialist API key',
    lastError: firstProviderError(paidProviders),
    metrics: { ready: availablePaid.length, configured: paidProviders.length },
    tags: ['ai', 'fallback']
  });

  capabilities.push({
    id: 'ai.jobs',
    label: 'AI job queue',
    description: 'Long-running and many-call jobs for map, retry, summarize, benchmark, and background work.',
    service: 'ai-os',
    state: status ? (runningJobs ? 'running' : 'ready') : 'offline',
    available: Boolean(status),
    locality: 'local',
    cost: 'mixed',
    safety: 'system',
    route: '/ai-os',
    requiredService: 'AI OS API',
    metrics: { running: runningJobs, total: status?.jobs.length ?? 0 },
    tags: ['queue', 'background']
  });

  capabilities.push({
    id: 'machine.profile',
    label: 'Machine profile',
    description: 'OS, hardware, providers, local services, benchmark history, health, and autotune summary.',
    service: 'ai-os',
    state: status ? (profile ? 'ready' : 'degraded') : 'offline',
    available: Boolean(profile),
    locality: 'local',
    cost: 'free',
    safety: 'read',
    route: '/ai-os',
    requiredService: 'AI OS machine profile',
    lastError: status && !profile ? 'AI OS status did not include a machine profile.' : error,
    metrics: profile
      ? {
          pressure,
          textSamples: numberMetric(profile.benchmarks?.text_samples) ?? 0,
          suggestedConcurrency: profile.autotune?.suggested_max_job_concurrency ?? 0,
          ...(bestRouteLabel ? { bestRoute: bestRouteLabel } : {})
        }
      : undefined,
    tags: ['machine', 'autotune']
  });

  const memory = findAiCapability(status, 'memory.embedding');
  capabilities.push(
    aiCapabilityEntry(
      'ai.memory',
      'Semantic memory',
      'Local RAG ingest, embeddings, and semantic search for personal data.',
      memory,
      Boolean(status),
      '/ai-os'
    )
  );

  const research = findAiCapability(status, 'research.web_intelligence');
  capabilities.push(
    aiCapabilityEntry(
      'ai.research',
      'Research engine',
      'Search, scrape, crawl, cite, and archive web intelligence reports through AI OS.',
      research,
      Boolean(status),
      '/research'
    )
  );

  const image = findAiCapability(status, 'multimodal.image');
  const audio = findAiCapability(status, 'multimodal.audio');
  const video = findAiCapability(status, 'multimodal.video');
  const anyMedia = [image, audio, video].filter(Boolean) as AiCapabilityStatus[];
  const mediaReady = anyMedia.some((capability) => capability.available);
  capabilities.push({
    id: 'ai.media',
    label: 'Media generation',
    description: 'Image, audio, and video generation adapters behind one AI OS interface.',
    service: 'ai-os',
    state: status ? (mediaReady ? 'ready' : 'needs_setup') : 'offline',
    available: mediaReady,
    locality: 'hybrid',
    cost: 'mixed',
    safety: 'write',
    route: '/ai-os',
    requiredService: 'AI OS media adapter',
    lastError: firstCapabilityError(anyMedia),
    metrics: { ready: anyMedia.filter((capability) => capability.available).length, configured: anyMedia.length },
    tags: ['media', 'multimodal']
  });

  const hardware = status?.hardware;
  const telemetryReady = Boolean(
    hardware &&
      !hardware.error &&
      (typeof hardware.cpu_percent === 'number' || typeof hardware.memory_percent === 'number' || hardware.gpus.length)
  );
  capabilities.push({
    id: 'machine.telemetry',
    label: 'Machine telemetry',
    description: 'CPU, RAM, GPU, VRAM, loaded model, and token-speed signals for routing and benchmarks.',
    service: 'ai-os',
    state: status ? (telemetryReady ? 'ready' : 'degraded') : 'offline',
    available: telemetryReady,
    locality: 'local',
    cost: 'free',
    safety: 'read',
    route: '/ai-os',
    requiredService: 'AI OS telemetry',
    lastError: hardware?.error,
    metrics: {
      gpus: hardware?.gpus.length ?? 0,
      loadedModels: hardware?.loaded_models?.length ?? 0,
      pressure,
      suggestedConcurrency: profile?.autotune?.suggested_max_job_concurrency ?? 0
    },
    tags: ['machine', 'gpu']
  });
}

function addMacroCapabilities(capabilities: CapabilityRegistryEntry[], status: MacroStatus | undefined, error: string | undefined): void {
  capabilities.push({
    id: 'macro-lab.service',
    label: 'Macro Lab API',
    description: 'Local Windows automation daemon for macros, triggers, input, windows, files, clipboard, and shell actions.',
    service: 'macro-lab',
    state: status ? (status.engine.panic ? 'blocked' : 'ready') : 'offline',
    available: Boolean(status && !status.engine.panic),
    locality: 'local',
    cost: 'free',
    safety: 'system',
    route: '/macro-lab',
    requiredService: 'Macro Lab API',
    lastError: error,
    metrics: status ? { running: status.engine.running, actions: status.engine.action_count } : undefined,
    tags: ['automation', 'windows']
  });

  capabilities.push({
    id: 'macro.automation',
    label: 'Local automation',
    description: 'Run and dry-run macros with panic protection, confirmations, trigger plumbing, and run history.',
    service: 'macro-lab',
    state: status ? (status.engine.panic ? 'blocked' : status.engine.running ? 'running' : 'ready') : 'offline',
    available: Boolean(status && !status.engine.panic),
    locality: 'local',
    cost: 'free',
    safety: 'system',
    route: '/macro-lab',
    requiredService: 'Macro Lab API',
    metrics: status ? { running: status.engine.running, capabilities: status.capabilities.filter((item) => item.available).length } : undefined,
    tags: ['automation', 'macros']
  });

  for (const capability of status?.capabilities ?? []) {
    capabilities.push({
      id: `macro.platform.${capability.id}`,
      label: `Macro ${capability.id}`,
      description: capability.detail,
      service: 'macro-lab',
      state: capability.available ? 'ready' : 'degraded',
      available: capability.available,
      locality: 'local',
      cost: 'free',
      safety: 'system',
      route: '/macro-lab',
      requiredService: 'Macro Lab platform adapter',
      tags: ['automation', capability.id]
    });
  }
}

function addPassiveTaskCapabilities(
  capabilities: CapabilityRegistryEntry[],
  snapshot: PassiveSnapshot | undefined,
  error: string | undefined
): void {
  const activeWatchers = snapshot?.watchers.filter((watcher) => watcher.enabled).length ?? 0;
  const failures = snapshot?.runs.filter((run) => ['failed', 'blocked'].includes(run.status)).length ?? 0;
  const enabled = snapshot?.settings.enabled;
  const worker = snapshot?.worker;
  capabilities.push({
    id: 'passive-tasks.engine',
    label: 'Passive task engine',
    description: 'Scheduled, idle, and event-style watchers that surface source-backed background work into Today.',
    service: 'passive-tasks',
    state: snapshot ? (enabled ? (failures ? 'degraded' : activeWatchers ? 'running' : 'needs_setup') : 'needs_setup') : error ? 'offline' : 'needs_setup',
    available: Boolean(snapshot && enabled),
    locality: 'local',
    cost: 'free',
    safety: 'system',
    route: '/passive-tasks',
    requiredService: 'Mini Hub API passive task store',
    lastError: error || snapshot?.errors[0],
    metrics: snapshot
      ? {
          watchers: snapshot.watchers.length,
          activeWatchers,
          triggers: snapshot.triggers.length,
          workerRunning: worker?.running ?? false,
          workerStarted: Boolean(worker?.startedAt),
          activeFileWatchers: worker?.activeFileWatchCount ?? 0,
          recentRuns: snapshot.runs.length,
          results: snapshot.results.length,
          digest: snapshot.digest.length,
          failures
        }
      : undefined,
    tags: ['background', 'scheduler']
  });
}

function aiCapabilityEntry(
  id: string,
  label: string,
  description: string,
  capability: AiCapabilityStatus | undefined,
  serviceReachable: boolean,
  route: string
): CapabilityRegistryEntry {
  return {
    id,
    label,
    description,
    service: 'ai-os',
    state: serviceReachable ? (capability?.available ? 'ready' : 'needs_setup') : 'offline',
    available: Boolean(capability?.available),
    locality: 'local',
    cost: 'free',
    safety: 'read',
    route,
    requiredService: 'AI OS capability adapter',
    lastError: capability?.error,
    metrics: capability ? { adapters: capability.adapters.length, enabled: capability.enabled } : undefined,
    tags: ['ai']
  };
}

function summarizeCapabilities(checkedAt: string, capabilities: CapabilityRegistryEntry[]): CapabilityRegistrySnapshot {
  const summary = {
    total: capabilities.length,
    ready: capabilities.filter((capability) => capability.state === 'ready').length,
    running: capabilities.filter((capability) => capability.state === 'running').length,
    degraded: capabilities.filter((capability) => capability.state === 'degraded').length,
    needsSetup: capabilities.filter((capability) => capability.state === 'needs_setup').length,
    offline: capabilities.filter((capability) => capability.state === 'offline').length,
    blocked: capabilities.filter((capability) => capability.state === 'blocked').length,
    localReady: capabilities.filter((capability) => capability.available && capability.locality === 'local').length,
    paidReady: capabilities.filter((capability) => capability.available && capability.cost === 'paid').length
  };
  return { checkedAt, capabilities: capabilities.sort(compareCapabilities), summary };
}

function compareCapabilities(a: CapabilityRegistryEntry, b: CapabilityRegistryEntry): number {
  const serviceOrder: Record<CapabilityService, number> = {
    hub: 0,
    browser: 1,
    productivity: 2,
    'ai-os': 3,
    'macro-lab': 4,
    'passive-tasks': 5
  };
  return serviceOrder[a.service] - serviceOrder[b.service] || a.label.localeCompare(b.label);
}

function stateIssueRank(state: CapabilityState): number {
  if (state === 'offline') return 6;
  if (state === 'blocked') return 5;
  if (state === 'degraded') return 4;
  if (state === 'needs_setup') return 3;
  if (state === 'running') return 2;
  return 1;
}

function readyCapabilityRank(capability: CapabilityRegistryEntry): number {
  let rank = 0;
  if (capability.locality === 'local') rank += 4;
  if (capability.state === 'running') rank += 3;
  if (capability.service === 'ai-os') rank += 2;
  if (capability.service === 'macro-lab') rank += 1;
  return rank;
}

function findAiCapability(status: AiStatus | undefined, id: string): AiCapabilityStatus | undefined {
  return status?.capabilities.find((capability) => capability.id === id);
}

function firstProviderError(providers: AiProviderStatus[]): string | undefined {
  return providers.find((provider) => provider.error)?.error;
}

function firstCapabilityError(capabilities: AiCapabilityStatus[]): string | undefined {
  return capabilities.find((capability) => capability.error)?.error;
}

function routeLabel(route: Record<string, unknown> | null | undefined): string | undefined {
  if (!route) return undefined;
  const provider = stringMetric(route.provider);
  const model = stringMetric(route.model);
  if (!provider) return undefined;
  return model ? `${provider}/${model}` : provider;
}

function routeTokensPerSecond(route: Record<string, unknown> | null | undefined): number | undefined {
  const value = numberMetric(route?.tokens_per_second);
  return value === undefined ? undefined : Math.round(value * 10) / 10;
}

function stringMetric(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function numberMetric(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value || 'unavailable');
}
