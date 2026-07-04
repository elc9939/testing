import { describe, expect, it, vi } from 'vitest';
import {
  readCachedAiOsDashboardSnapshot,
  writeAiOsDashboardCache,
  type AiOsDashboardSnapshot,
  type AiStatus
} from './ai-os-api';

function storageStub(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, value)
  } as Storage;
}

function aiStatus(): AiStatus {
  return {
    providers: [
      {
        id: 'ollama',
        label: 'Ollama',
        available: true,
        local: true,
        paid: false,
        models: ['llama3.1:8b'],
        capabilities: ['chat']
      }
    ],
    capabilities: [],
    hardware: {
      cpu_percent: 12,
      memory_percent: 42,
      gpus: [{ name: 'RX 6600', utilization_percent: 18, vram_percent: 34 }],
      loaded_models: [{ name: 'llama3.1:8b' }]
    },
    jobs: [],
    background: [],
    tools: []
  };
}

describe('AI OS API helpers', () => {
  it('persists a dashboard snapshot for warm AI OS route rehydration', () => {
    vi.stubGlobal('localStorage', storageStub());
    const snapshot: AiOsDashboardSnapshot = {
      checkedAt: '2026-07-03T18:30:00.000Z',
      status: aiStatus(),
      usage: [],
      jobs: [],
      toolCalls: [],
      generationAssets: [],
      designPatches: [],
      benchmarkRuns: [],
      machineProfileFallback: null,
      machineSnapshots: []
    };

    const write = writeAiOsDashboardCache(snapshot);
    const cached = readCachedAiOsDashboardSnapshot();

    expect(write.cachedAt).toBeTruthy();
    expect(cached?.cachedAt).toBe(write.cachedAt);
    expect(cached?.snapshot.checkedAt).toBe(snapshot.checkedAt);
    expect(cached?.snapshot.status?.providers[0]?.id).toBe('ollama');
    expect(cached?.snapshot.status?.hardware.gpus[0]?.name).toBe('RX 6600');
  });
});
