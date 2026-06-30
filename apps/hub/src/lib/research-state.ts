import type { ResearchMode, ResearchRun } from './ai-os-api';
import { compactServiceIssueLine, isLikelyServiceIssue } from './service-issues';

export interface ResearchDraftState {
  mode: ResearchMode;
  goal: string;
  seedUrlsText: string;
  includeDomainsText: string;
  excludeDomainsText: string;
  depth: number;
  maxPages: number;
  perDomainLimit: number;
  timeBudget: number;
  dateRangeStart: string;
  dateRangeEnd: string;
  useAi: boolean;
  useCloudAi: boolean;
  saveToMemory: boolean;
  screenshot: boolean;
  provider: string;
  model: string;
  advancedOpen: boolean;
  monitorName: string;
  monitorSchedule: 'manual' | 'daily' | 'weekly';
  selectedRunId: string;
  selectedMonitorId: string;
}

export const researchDraftStorageKey = 'miniHub.research.draft.v1';

export function isResearchRunActive(run: Pick<ResearchRun, 'status'>): boolean {
  return run.status === 'queued' || run.status === 'running' || run.status === 'paused';
}

export function selectRecoverableResearchRun(
  runs: ResearchRun[],
  input: { requestedRunId?: string | null; currentRunId?: string | null } = {}
): ResearchRun | null {
  if (!runs.length) return null;
  const requested = input.requestedRunId ? runs.find((run) => run.id === input.requestedRunId) : undefined;
  if (requested) return requested;
  const current = input.currentRunId ? runs.find((run) => run.id === input.currentRunId) : undefined;
  if (current) return current;
  const active = [...runs]
    .filter(isResearchRunActive)
    .sort((a, b) => dateValue(b.updated_at || b.created_at) - dateValue(a.updated_at || a.created_at))[0];
  return active ?? runs[0] ?? null;
}

export function researchRunListState(input: { loading: boolean; error?: string; runCount: number; apiLabel?: string }): string {
  if (input.loading) return 'Checking saved research runs.';
  if (input.error) return `${input.apiLabel ?? 'AI OS'} unavailable: ${input.error}`;
  if (input.runCount === 0) return 'No archived research yet. New runs will stay here after you leave or refresh.';
  return '';
}

export function isResearchServiceError(value: string): boolean {
  return isLikelyServiceIssue(value);
}

export function compactResearchServiceIssue(errors: string[]): string {
  const serviceError = errors.map((item) => item.trim()).find((item) => item && isResearchServiceError(item));
  return serviceError ? compactServiceIssueLine(serviceError, 'AI OS') : '';
}

export function normalizeResearchDraft(value: unknown, fallback: ResearchDraftState): ResearchDraftState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
  const record = value as Partial<ResearchDraftState>;
  return {
    ...fallback,
    mode: isMode(record.mode) ? record.mode : fallback.mode,
    goal: stringValue(record.goal, fallback.goal),
    seedUrlsText: stringValue(record.seedUrlsText, fallback.seedUrlsText),
    includeDomainsText: stringValue(record.includeDomainsText, fallback.includeDomainsText),
    excludeDomainsText: stringValue(record.excludeDomainsText, fallback.excludeDomainsText),
    depth: boundedNumber(record.depth, 1, 5, fallback.depth),
    maxPages: boundedNumber(record.maxPages, 1, 50, fallback.maxPages),
    perDomainLimit: boundedNumber(record.perDomainLimit, 1, 20, fallback.perDomainLimit),
    timeBudget: boundedNumber(record.timeBudget, 5, 900, fallback.timeBudget),
    dateRangeStart: stringValue(record.dateRangeStart, fallback.dateRangeStart),
    dateRangeEnd: stringValue(record.dateRangeEnd, fallback.dateRangeEnd),
    useAi: booleanValue(record.useAi, fallback.useAi),
    useCloudAi: booleanValue(record.useCloudAi, fallback.useCloudAi),
    saveToMemory: booleanValue(record.saveToMemory, fallback.saveToMemory),
    screenshot: booleanValue(record.screenshot, fallback.screenshot),
    provider: stringValue(record.provider, fallback.provider),
    model: stringValue(record.model, fallback.model),
    advancedOpen: booleanValue(record.advancedOpen, fallback.advancedOpen),
    monitorName: stringValue(record.monitorName, fallback.monitorName),
    monitorSchedule: isSchedule(record.monitorSchedule) ? record.monitorSchedule : fallback.monitorSchedule,
    selectedRunId: idValue(record.selectedRunId, fallback.selectedRunId),
    selectedMonitorId: idValue(record.selectedMonitorId, fallback.selectedMonitorId)
  };
}

function isMode(value: unknown): value is ResearchMode {
  return ['quick_search', 'deep_research', 'url_scrape', 'site_crawl', 'compare_sources', 'monitor_topic'].includes(String(value));
}

function isSchedule(value: unknown): value is ResearchDraftState['monitorSchedule'] {
  return value === 'manual' || value === 'daily' || value === 'weekly';
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function idValue(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return /^[\w:.-]{1,120}$/u.test(trimmed) ? trimmed : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function boundedNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function dateValue(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
