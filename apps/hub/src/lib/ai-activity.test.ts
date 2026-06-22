import { describe, expect, it } from 'vitest';
import type { AiStatus } from './ai-os-api';
import { aiActivityStateLabel, buildAiActivityItems } from './ai-activity';

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

describe('buildAiActivityItems', () => {
  it('normalizes AI OS jobs, tools, benchmarks, backups, generations, and research by recency', () => {
    const items = buildAiActivityItems(
      status({
        jobs: [
          {
            id: 'job_1',
            primitive: 'map',
            status: 'running',
            created_at: '2026-06-20T10:00:00.000Z',
            updated_at: '2026-06-20T10:05:00.000Z',
            total: 3,
            completed: 1,
            failed: 0,
            progress: 0.33,
            cancel_requested: false,
            metadata: {}
          }
        ],
        tool_calls: [
          {
            id: 'tool_1',
            created_at: '2026-06-20T10:06:00.000Z',
            tool_id: 'web.scrape',
            ok: true,
            safety: 'read',
            requires_confirmation: false,
            arguments: {},
            result: {},
            latency_ms: 42
          }
        ],
        benchmark_runs: [
          {
            id: 'bench_1',
            created_at: '2026-06-20T10:07:00.000Z',
            kind: 'text',
            provider: 'ollama',
            model: 'llama3.1:8b',
            prompt: 'bench',
            latency_ms: 1234,
            tokens_per_second: 18.5,
            hardware_before: {},
            hardware_after: {},
            result: {},
            ok: true
          }
        ],
        backups: [
          {
            id: 'backup_1',
            path: 'C:/testing/backups/backup_1',
            created_at: '2026-06-20T10:08:00.000Z',
            ok: true,
            reason: 'today-maintenance',
            size_bytes: 2048
          }
        ],
        generation_assets: [
          {
            id: 'asset_1',
            created_at: '2026-06-20T10:09:00.000Z',
            kind: 'image',
            provider: 'builtin-image',
            content_type: 'image/png',
            metadata: {}
          }
        ],
        research_runs: [
          {
            id: 'research_1',
            created_at: '2026-06-20T10:04:00.000Z',
            updated_at: '2026-06-20T10:10:00.000Z',
            mode: 'deep_research',
            goal: 'research status visibility',
            status: 'paused',
            query_plan: {},
            sources: [
              {
                id: 'source_1',
                url: 'https://example.com',
                canonical_url: 'https://example.com',
                title: 'Example source',
                description: '',
                text: 'Example source text',
                text_length: 19,
                fetched_at: '2026-06-20T10:04:00.000Z',
                links: [],
                tables: [],
                metadata: {},
                score: 0.8,
                rank: 1,
                cached: true
              }
            ],
            report: {
              title: 'Deep Research: status visibility',
              tldr: 'Paused research can be resumed.',
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
            progress: 0.45,
            total_steps: 8,
            completed_steps: 3,
            current_step: 'Paused',
            cancel_requested: false,
            memory_chunks: 0,
            total_tokens: 0,
            cost_usd: 0,
            runtime_ms: 321,
            cached_pages: 1,
            options: {}
          }
        ]
      })
    );

    expect(items.map((item) => item.kind)).toEqual(['research', 'generation', 'backup', 'benchmark', 'tool', 'job']);
    expect(items[0]).toMatchObject({ state: 'paused', route: '/research' });
    expect(items[0].detail).toContain('1 source, 1 cached, 45%');
    expect(items[3].detail).toContain('18.5 tokens/sec');
    expect(items[5].state).toBe('running');
  });

  it('surfaces failed records with errors before generic detail text', () => {
    const items = buildAiActivityItems(
      status({
        tool_calls: [
          {
            id: 'tool_failed',
            created_at: '2026-06-20T11:00:00.000Z',
            tool_id: 'macro.run',
            ok: false,
            safety: 'destructive',
            requires_confirmation: true,
            arguments: {},
            result: {},
            error: 'panic stop is armed',
            latency_ms: 12
          }
        ]
      })
    );

    expect(items[0].state).toBe('failed');
    expect(items[0].detail).toBe('panic stop is armed');
    expect(aiActivityStateLabel(items[0].state)).toBe('failed');
  });
});
