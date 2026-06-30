import { describe, expect, it } from 'vitest';
import type { ResearchRun } from './ai-os-api';
import {
  compactResearchServiceIssue,
  isResearchRunActive,
  isResearchServiceError,
  normalizeResearchDraft,
  researchRunListState,
  selectRecoverableResearchRun,
  type ResearchDraftState
} from './research-state';

const fallbackDraft: ResearchDraftState = {
  mode: 'quick_search',
  goal: '',
  seedUrlsText: '',
  includeDomainsText: '',
  excludeDomainsText: '',
  depth: 1,
  maxPages: 6,
  perDomainLimit: 4,
  timeBudget: 90,
  dateRangeStart: '',
  dateRangeEnd: '',
  useAi: false,
  useCloudAi: false,
  saveToMemory: false,
  screenshot: false,
  provider: '',
  model: '',
  advancedOpen: false,
  monitorName: '',
  monitorSchedule: 'manual',
  selectedRunId: '',
  selectedMonitorId: ''
};

function run(id: string, status: ResearchRun['status'], updatedAt: string): ResearchRun {
  return {
    id,
    created_at: '2026-06-20T09:00:00.000Z',
    updated_at: updatedAt,
    mode: 'quick_search',
    goal: id,
    status,
    query_plan: {},
    sources: [],
    report: {
      title: id,
      tldr: '',
      detailed_summary: '',
      key_facts: [],
      disagreements: [],
      source_table: [],
      open_questions: [],
      next_research_suggestions: [],
      reliability_notes: [],
      timeline: []
    },
    citations: [],
    logs: [],
    progress: 0,
    total_steps: 0,
    completed_steps: 0,
    current_step: '',
    cancel_requested: false,
    memory_chunks: 0,
    total_tokens: 0,
    cost_usd: 0,
    runtime_ms: 0,
    cached_pages: 0,
    options: {}
  };
}

describe('selectRecoverableResearchRun', () => {
  it('treats queued, running, and paused runs as active handoffs', () => {
    expect(isResearchRunActive(run('queued', 'queued', '2026-06-20T10:00:00.000Z'))).toBe(true);
    expect(isResearchRunActive(run('running', 'running', '2026-06-20T10:00:00.000Z'))).toBe(true);
    expect(isResearchRunActive(run('paused', 'paused', '2026-06-20T10:00:00.000Z'))).toBe(true);
    expect(isResearchRunActive(run('done', 'succeeded', '2026-06-20T10:00:00.000Z'))).toBe(false);
  });

  it('prefers deep links, then current selection, then active work, then latest run', () => {
    const runs = [
      run('done_latest', 'succeeded', '2026-06-20T10:03:00.000Z'),
      run('active_old', 'running', '2026-06-20T10:01:00.000Z'),
      run('paused_new', 'paused', '2026-06-20T10:02:00.000Z')
    ];

    expect(selectRecoverableResearchRun(runs, { requestedRunId: 'active_old' })?.id).toBe('active_old');
    expect(selectRecoverableResearchRun(runs, { currentRunId: 'done_latest' })?.id).toBe('done_latest');
    expect(selectRecoverableResearchRun(runs)?.id).toBe('paused_new');
    expect(selectRecoverableResearchRun([run('only_done', 'succeeded', '2026-06-20T11:00:00.000Z')])?.id).toBe('only_done');
  });
});

describe('research draft and state helpers', () => {
  it('normalizes persisted draft state without trusting bad values', () => {
    const draft = normalizeResearchDraft(
      {
        mode: 'deep_research',
        goal: 'persist this question',
        seedUrlsText: 'https://example.com',
        depth: 99,
        maxPages: -5,
        timeBudget: 120,
        useAi: true,
        monitorSchedule: 'weekly',
        selectedRunId: 'run_123',
        selectedMonitorId: '<script>'
      },
      fallbackDraft
    );

    expect(draft).toMatchObject({
      mode: 'deep_research',
      goal: 'persist this question',
      seedUrlsText: 'https://example.com',
      depth: 5,
      maxPages: 1,
      timeBudget: 120,
      useAi: true,
      monitorSchedule: 'weekly',
      selectedRunId: 'run_123',
      selectedMonitorId: ''
    });
  });

  it('distinguishes loading, unavailable, and healthy-empty run states', () => {
    expect(researchRunListState({ loading: true, runCount: 0 })).toBe('Checking saved research runs.');
    expect(researchRunListState({ loading: false, error: 'connection refused', runCount: 0 })).toContain('AI OS unavailable');
    expect(researchRunListState({ loading: false, runCount: 0 })).toContain('New runs will stay here');
  });

  it('collapses repeated AI OS service failures without treating form validation as service outage', () => {
    expect(isResearchServiceError('AI OS API unavailable at http://127.0.0.1:8791: Failed to fetch.')).toBe(true);
    expect(isResearchServiceError('Type a research goal before running.')).toBe(false);
    expect(
      compactResearchServiceIssue([
        '',
        'Type a research goal before running.',
        'AI OS API route /api/ai/research/runs was not found at http://127.0.0.1:8791.'
      ])
    ).toBe('AI OS is pointed at the wrong endpoint or a missing route. Open Settings Feature Wiring and check the saved service URL.');
  });
});
