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

    expect(recommendations.map((item) => item.id)).toContain('beast:benchmark');
    expect(recommendations.map((item) => item.id)).toContain('beast:media');
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
});
