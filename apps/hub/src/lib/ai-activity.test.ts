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
  it('normalizes AI OS jobs, tools, benchmarks, backups, and generations by recency', () => {
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
        ]
      })
    );

    expect(items.map((item) => item.kind)).toEqual(['generation', 'backup', 'benchmark', 'tool', 'job']);
    expect(items[2].detail).toContain('18.5 tokens/sec');
    expect(items[4].state).toBe('running');
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
