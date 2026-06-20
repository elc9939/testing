import { describe, expect, it } from 'vitest';
import type { AiStatus } from './ai-os-api';
import type { MacroStatus } from './macro-lab-api';
import {
  buildCapabilityRegistry,
  capabilityServiceLabel,
  compactCapabilityRegistryContext,
  formatCapabilityRegistrySummary,
  selectCapabilityIssues
} from './capability-registry';

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
        available: false,
        local: false,
        paid: true,
        models: [],
        capabilities: ['text.inference'],
        error: 'missing api key'
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
        available: false,
        enabled: true,
        safety: 'write',
        adapters: [],
        description: 'Image adapter',
        error: 'no image provider configured'
      }
    ],
    hardware: {
      cpu_percent: 12,
      memory_percent: 42,
      memory_used_gb: 13,
      memory_total_gb: 32,
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

function macroStatus(partial: Partial<MacroStatus> = {}): MacroStatus {
  return {
    ok: true,
    version: '0.1.0',
    engine: { panic: false, running: 0, action_count: 12 },
    triggers: {},
    capabilities: [
      { id: 'clipboard', available: true, detail: 'Clipboard access is available.' },
      { id: 'window', available: false, detail: 'Window control module unavailable.' }
    ],
    integrity: {},
    ...partial
  };
}

describe('capability registry', () => {
  it('summarizes ready local capabilities across hub, AI OS, Macro Lab, Google, and cache', () => {
    const snapshot = buildCapabilityRegistry({
      checkedAt: '2026-06-20T16:00:00.000Z',
      isOnline: true,
      syncStatus: 'idle',
      googleConnected: true,
      hubHealth: { ok: true, service: 'mini-hub-api' },
      aiStatus: aiStatus(),
      macroStatus: macroStatus()
    });

    expect(snapshot.summary.ready).toBeGreaterThan(5);
    expect(snapshot.summary.localReady).toBeGreaterThan(4);
    expect(snapshot.capabilities.find((capability) => capability.id === 'ai.local-llm')?.state).toBe('ready');
    expect(snapshot.capabilities.find((capability) => capability.id === 'macro.automation')?.state).toBe('ready');
    expect(snapshot.capabilities.find((capability) => capability.id === 'productivity.google')?.state).toBe('ready');
    expect(capabilityServiceLabel('ai-os')).toBe('AI OS');
  });

  it('keeps setup needs separate from offline service failures', () => {
    const snapshot = buildCapabilityRegistry({
      isOnline: false,
      syncStatus: 'offline-readonly',
      googleConnected: false,
      hubError: 'network failed',
      aiError: 'connection refused',
      macroError: 'connection refused'
    });

    expect(snapshot.capabilities.find((capability) => capability.id === 'browser.offline-cache')?.state).toBe('running');
    expect(snapshot.capabilities.find((capability) => capability.id === 'hub.api')?.state).toBe('offline');
    expect(snapshot.capabilities.find((capability) => capability.id === 'productivity.google')?.state).toBe('needs_setup');
    expect(selectCapabilityIssues(snapshot, 2).map((capability) => capability.state)).toEqual(['offline', 'offline']);
  });

  it('marks Macro Lab as blocked when panic is active', () => {
    const snapshot = buildCapabilityRegistry({
      isOnline: true,
      syncStatus: 'idle',
      googleConnected: false,
      macroStatus: macroStatus({ engine: { panic: true, running: 0, action_count: 12 } })
    });

    expect(snapshot.capabilities.find((capability) => capability.id === 'macro-lab.service')?.state).toBe('blocked');
    expect(selectCapabilityIssues(snapshot, 20).some((capability) => capability.id === 'macro-lab.service')).toBe(true);
  });

  it('formats a compact assistant-friendly capability context', () => {
    const snapshot = buildCapabilityRegistry({
      checkedAt: '2026-06-20T16:00:00.000Z',
      isOnline: true,
      syncStatus: 'idle',
      googleConnected: true,
      hubHealth: { ok: true, service: 'mini-hub-api' },
      aiStatus: aiStatus(),
      macroStatus: macroStatus()
    });

    const context = compactCapabilityRegistryContext(snapshot, 4);
    const summary = formatCapabilityRegistrySummary(snapshot);

    expect(context.ready.length).toBeGreaterThan(0);
    expect(context.issues.length).toBeGreaterThan(0);
    expect(summary).toContain('Capability registry:');
    expect(summary).toContain('Ready now:');
    expect(summary).toContain('Needs attention:');
  });
});
