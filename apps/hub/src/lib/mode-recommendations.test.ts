import { describe, expect, it } from 'vitest';
import type { AiStatus } from './ai-os-api';
import { buildCapabilityRegistry } from './capability-registry';
import { machineModeDefinition } from './machine-mode';
import { buildModeRecommendations } from './mode-recommendations';

function aiStatus(partial: Partial<AiStatus> = {}): AiStatus {
  return {
    providers: [
      {
        id: 'ollama',
        label: 'Ollama',
        available: true,
        local: true,
        paid: false,
        models: ['llama3.1:8b'],
        capabilities: ['text.inference']
      },
      {
        id: 'openai',
        label: 'OpenAI',
        available: true,
        local: false,
        paid: true,
        models: ['gpt-4.1-mini'],
        capabilities: ['text.inference']
      }
    ],
    capabilities: [
      {
        id: 'memory.embedding',
        label: 'Embeddings',
        kind: 'memory',
        available: true,
        enabled: true,
        safety: 'read',
        adapters: ['ollama'],
        description: 'Local embeddings'
      },
      {
        id: 'multimodal.image',
        label: 'Image generation',
        kind: 'multimodal',
        available: true,
        enabled: true,
        safety: 'write',
        adapters: ['builtin-image'],
        description: 'Image adapter'
      }
    ],
    hardware: {
      cpu_percent: 12,
      memory_percent: 42,
      gpus: [{ name: 'AMD Radeon RX 6600', utilization_percent: 18 }],
      loaded_models: [{ name: 'llama3.1:8b' }],
      recent_tokens_per_second: 24
    },
    jobs: [],
    background: [],
    tools: [],
    ...partial
  };
}

function readySnapshot() {
  return buildCapabilityRegistry({
    checkedAt: '2026-06-20T16:00:00.000Z',
    isOnline: true,
    syncStatus: 'idle',
    googleConnected: true,
    hubHealth: { ok: true, service: 'mini-hub-api' },
    aiStatus: aiStatus()
  });
}

describe('buildModeRecommendations', () => {
  it('uses real attention and capability issues in balanced mode', () => {
    const snapshot = buildCapabilityRegistry({
      isOnline: true,
      syncStatus: 'idle',
      googleConnected: false,
      hubHealth: { ok: true, service: 'mini-hub-api' },
      aiError: 'AI OS offline'
    });

    const recommendations = buildModeRecommendations({
      mode: machineModeDefinition('balanced'),
      capabilitySnapshot: snapshot,
      attentionCount: 2
    });

    expect(recommendations[0].id).toBe('balanced:attention');
    expect(recommendations.some((item) => item.label.includes('Resolve'))).toBe(true);
  });

  it('surfaces local compute work in beast mode only when local AI is ready', () => {
    const recommendations = buildModeRecommendations({
      mode: machineModeDefinition('beast'),
      capabilitySnapshot: readySnapshot()
    });

    const benchmark = recommendations.find((item) => item.id === 'beast:benchmark');
    expect(benchmark?.action?.kind).toBe('run_text_benchmark');
    expect(recommendations.map((item) => item.id)).toContain('beast:media');
  });

  it('uses Auto mode to work locally when idle capacity is available', () => {
    const recommendations = buildModeRecommendations({
      mode: machineModeDefinition('auto'),
      capabilitySnapshot: readySnapshot(),
      attentionCount: 1
    });

    expect(recommendations.find((item) => item.id === 'auto:idle-local-work')?.action?.kind).toBe('queue_local_summary_batch');
    expect(recommendations.map((item) => item.id)).toContain('auto:attention-first');
  });

  it('uses Auto mode to keep background work light under high measured pressure', () => {
    const snapshot = buildCapabilityRegistry({
      isOnline: true,
      syncStatus: 'idle',
      googleConnected: true,
      hubHealth: { ok: true, service: 'mini-hub-api' },
      aiStatus: aiStatus({
        machine_profile: {
          created_at: '2026-06-20T16:00:00.000Z',
          source: 'status',
          mode: 'auto',
          host: {},
          hardware: {
            gpus: [{ name: 'AMD Radeon RX 6600', utilization_percent: 96 }],
            loaded_models: [{ name: 'llama3.1:8b' }]
          },
          providers: [],
          provider_summary: {},
          loaded_models: [{ name: 'llama3.1:8b' }],
          local_services: {},
          ai_os_health: {},
          capabilities: [],
          capability_readiness: {},
          benchmarks: { recent: [] },
          autotune: {
            mode: 'auto',
            suggested_max_job_concurrency: 1,
            resource_pressure: { level: 'high', drivers: ['gpu', 'vram'] },
            best_text_route: {
              provider: 'ollama',
              model: 'llama3.1:8b',
              label: 'Ollama llama3.1:8b',
              local: true,
              tokens_per_second: 28
            }
          }
        }
      })
    });
    const recommendations = buildModeRecommendations({
      mode: machineModeDefinition('auto'),
      capabilitySnapshot: snapshot
    });

    expect(recommendations[0].id).toBe('auto:lighten-up');
    expect(recommendations.some((item) => item.id === 'auto:idle-local-work')).toBe(false);
  });

  it('marks night shift batch and backup work as executable when local foundations are ready', () => {
    const recommendations = buildModeRecommendations({
      mode: machineModeDefinition('night'),
      capabilitySnapshot: readySnapshot()
    });

    expect(recommendations.find((item) => item.id === 'night:batch')?.action?.kind).toBe('queue_local_summary_batch');
    expect(recommendations.find((item) => item.id === 'night:backup')?.action?.kind).toBe('run_foundation_check');
  });

  it('makes offline mode explicit about local-only and cache behavior', () => {
    const recommendations = buildModeRecommendations({
      mode: machineModeDefinition('offline'),
      capabilitySnapshot: readySnapshot()
    });

    expect(recommendations.map((item) => item.id)).toContain('offline:local-ai');
    expect(recommendations.map((item) => item.id)).toContain('offline:cache');
    expect(recommendations.map((item) => item.id)).toContain('offline:paid-skipped');
  });

  it('prioritizes actual blockers in maintenance mode', () => {
    const snapshot = buildCapabilityRegistry({
      isOnline: true,
      syncStatus: 'idle',
      googleConnected: false,
      macroStatus: {
        ok: true,
        version: '0.1.0',
        engine: { panic: true, running: 0, action_count: 1 },
        triggers: {},
        capabilities: [],
        integrity: {}
      }
    });

    const recommendations = buildModeRecommendations({
      mode: machineModeDefinition('maintenance'),
      capabilitySnapshot: snapshot
    });

    expect(recommendations[0].id.startsWith('maintenance:issue:')).toBe(true);
    expect(recommendations.some((item) => item.id === 'maintenance:macro-panic')).toBe(true);
  });

  it('marks maintenance foundation checks as confirm-gated actions', () => {
    const recommendations = buildModeRecommendations({
      mode: machineModeDefinition('maintenance'),
      capabilitySnapshot: readySnapshot()
    });

    const foundation = recommendations.find((item) => item.id === 'maintenance:foundation');
    expect(foundation?.action?.kind).toBe('run_foundation_check');
    expect(foundation?.action?.confirm).toContain('restore test');
  });
});
