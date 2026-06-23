import { describe, expect, it } from 'vitest';
import type { PassiveSnapshot } from '@mini-hub/core';
import type { AiStatus, ResearchRun } from './ai-os-api';
import { activityHasActiveWork, buildActivityRecords } from './activity';
import type { MacroRun } from './macro-lab-api';

function status(partial: Partial<AiStatus>): AiStatus {
  return {
    providers: [],
    capabilities: [],
    hardware: { gpus: [] },
    jobs: [],
    background: [],
    tools: [],
    ...partial
  };
}

function researchRun(partial: Partial<ResearchRun>): ResearchRun {
  return {
    id: 'research_1',
    created_at: '2026-06-20T10:00:00.000Z',
    updated_at: '2026-06-20T10:05:00.000Z',
    mode: 'deep_research',
    goal: 'durable research',
    status: 'running',
    query_plan: {},
    sources: [],
    report: {
      title: 'Deep Research: durable research',
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
    progress: 0.35,
    total_steps: 8,
    completed_steps: 3,
    current_step: 'Fetching sources',
    cancel_requested: false,
    memory_chunks: 0,
    total_tokens: 0,
    cost_usd: 0,
    runtime_ms: 1200,
    cached_pages: 0,
    options: {},
    ...partial
  };
}

describe('buildActivityRecords', () => {
  it('links durable work back to owning feature routes', () => {
    const records = buildActivityRecords({
      aiStatus: status({
        research_runs: [researchRun({ id: 'research_active' })],
        jobs: [
          {
            id: 'job_1',
            primitive: 'map',
            status: 'queued',
            created_at: '2026-06-20T10:03:00.000Z',
            updated_at: '2026-06-20T10:04:00.000Z',
            total: 3,
            completed: 0,
            failed: 0,
            progress: 0,
            cancel_requested: false,
            metadata: {}
          }
        ],
        tool_calls: [
          {
            id: 'call_1',
            created_at: '2026-06-20T10:03:30.000Z',
            tool_id: 'study.add_session',
            ok: true,
            safety: 'write',
            requires_confirmation: true,
            arguments: { subject: 'Algorithms' },
            result: { ok: true },
            latency_ms: 42
          }
        ],
        benchmark_runs: [
          {
            id: 'bench_1',
            created_at: '2026-06-20T10:02:00.000Z',
            kind: 'text',
            provider: 'ollama',
            model: 'llama3.1:8b',
            prompt: 'bench',
            latency_ms: 1000,
            tokens_per_second: 22,
            hardware_before: {},
            hardware_after: {},
            result: {},
            ok: true
          }
        ],
        generation_assets: [
          {
            id: 'asset_1',
            created_at: '2026-06-20T10:00:30.000Z',
            kind: 'image',
            provider: 'comfyui',
            model: 'sdxl',
            prompt: 'cat',
            content_type: 'image/png',
            asset_path: 'generated/cat.png',
            metadata: {}
          }
        ]
      }),
      passiveSnapshot: {
        runs: [
          {
            id: 'passive_1',
            taskId: 'task_1',
            watcherId: 'watcher_1',
            family: 'research_monitor',
            status: 'failed',
            startedAt: '2026-06-20T10:01:00.000Z',
            cards: [],
            changed: [],
            metadata: { indexedFiles: 2, fileCount: 5 }
          }
        ]
      } as unknown as PassiveSnapshot,
      macroRuns: [
        {
          id: 'macro_1',
          macro_id: 'macro_definition',
          macro_name: 'Study Mode',
          status: 'succeeded',
          dry_run: false,
          started_at: '2026-06-20T09:59:00.000Z',
          finished_at: '2026-06-20T10:00:00.000Z',
          steps: []
        } satisfies MacroRun
      ]
    });

    expect(records.map((record) => record.id)).toEqual([
      'research:research_active',
      'ai-job:job_1',
      'ai-tool:call_1',
      'ai-benchmark:bench_1',
      'passive:passive_1',
      'ai-generation:asset_1',
      'macro:macro_1'
    ]);
    expect(records.find((record) => record.id === 'research:research_active')?.route).toBe('/research?run=research_active');
    expect(records.find((record) => record.id === 'ai-tool:call_1')?.route).toBe('/ai-os?activity=tool&id=call_1');
    expect(records.find((record) => record.id === 'ai-generation:asset_1')?.route).toBe('/ai-os?activity=generation&id=asset_1');
    expect(records.find((record) => record.id === 'passive:passive_1')?.actions.find((action) => action.kind === 'retry')?.enabled).toBe(true);
    expect(records.find((record) => record.id === 'passive:passive_1')?.detail).toContain('indexed file');
    expect(records.find((record) => record.id === 'ai-job:job_1')?.actions.find((action) => action.kind === 'cancel')?.enabled).toBe(true);
    expect(records.find((record) => record.id === 'ai-tool:call_1')?.actions.find((action) => action.kind === 'view_logs')?.enabled).toBe(true);
    expect(records.find((record) => record.id === 'ai-generation:asset_1')?.detail).toContain('generated/cat.png');
    expect(records.find((record) => record.id === 'research:research_active')?.actions.some((action) => action.kind === 'dismiss')).toBe(false);
    expect(records.find((record) => record.id === 'macro:macro_1')?.actions.find((action) => action.kind === 'dismiss')?.enabled).toBe(true);
    expect(activityHasActiveWork(records)).toBe(true);
  });

  it('keeps paused research resumable and cancellable', () => {
    const records = buildActivityRecords({
      aiStatus: status({
        research_runs: [researchRun({ id: 'research_paused', status: 'paused', progress: 0.5 })]
      })
    });

    const record = records[0];
    expect(record.status).toBe('paused');
    expect(record.progress).toBe(0.5);
    expect(record.actions.find((action) => action.kind === 'resume')?.enabled).toBe(true);
    expect(record.actions.find((action) => action.kind === 'cancel')?.enabled).toBe(true);
  });
});
