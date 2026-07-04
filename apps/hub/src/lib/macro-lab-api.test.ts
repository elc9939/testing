import { describe, expect, it, vi } from 'vitest';
import {
  readCachedMacroLabDashboardSnapshot,
  writeMacroLabDashboardCache,
  type MacroDefinition,
  type MacroLabDashboardSnapshot,
  type MacroRun,
  type MacroStatus
} from './macro-lab-api';

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

function macroStatus(): MacroStatus {
  return {
    ok: true,
    version: 'macro-lab-test',
    engine: { panic: false, running: 0, action_count: 1 },
    triggers: { enabled: true },
    capabilities: [{ id: 'keyboard', available: true, detail: 'Keyboard input available' }],
    integrity: { ok: true }
  };
}

function macroDefinition(): MacroDefinition {
  return {
    id: 'macro-cache-test',
    name: 'Cache Test Macro',
    group: 'Tests',
    enabled: true,
    armed: false,
    dry_run_default: true,
    variables: {},
    actions: [{ id: 'action-cache-test', type: 'shell.run', label: 'Echo', enabled: true, config: { command: 'echo ok' } }],
    triggers: [],
    created_at: '2026-07-03T18:00:00.000Z',
    updated_at: '2026-07-03T18:05:00.000Z'
  };
}

function macroRun(): MacroRun {
  return {
    id: 'macro-run-cache-test',
    macro_id: 'macro-cache-test',
    macro_name: 'Cache Test Macro',
    status: 'dry_run',
    dry_run: true,
    started_at: '2026-07-03T18:06:00.000Z',
    finished_at: '2026-07-03T18:06:01.000Z',
    steps: [{ action: 'shell.run', status: 'preview' }]
  };
}

describe('Macro Lab API helpers', () => {
  it('persists a dashboard snapshot for warm Macro Lab route rehydration', () => {
    vi.stubGlobal('localStorage', storageStub());
    const snapshot: MacroLabDashboardSnapshot = {
      checkedAt: '2026-07-03T18:10:00.000Z',
      status: macroStatus(),
      actions: [
        {
          type: 'shell.run',
          label: 'Run shell command',
          safety: 'confirm',
          description: 'Run a local command through Macro Lab.',
          config_example: { command: 'echo ok' }
        }
      ],
      macros: [macroDefinition()],
      runs: [macroRun()]
    };

    const write = writeMacroLabDashboardCache(snapshot);
    const cached = readCachedMacroLabDashboardSnapshot();

    expect(write.cachedAt).toBeTruthy();
    expect(cached?.cachedAt).toBe(write.cachedAt);
    expect(cached?.snapshot.checkedAt).toBe(snapshot.checkedAt);
    expect(cached?.snapshot.status?.version).toBe('macro-lab-test');
    expect(cached?.snapshot.macros[0]?.id).toBe('macro-cache-test');
    expect(cached?.snapshot.runs[0]?.id).toBe('macro-run-cache-test');
  });
});
