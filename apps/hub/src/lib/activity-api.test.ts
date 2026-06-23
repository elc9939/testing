import { afterEach, describe, expect, it, vi } from 'vitest';

const getAiStatusMock = vi.hoisted(() => vi.fn());
const cancelAiJobMock = vi.hoisted(() => vi.fn());
const cancelResearchRunMock = vi.hoisted(() => vi.fn());
const resumeResearchRunMock = vi.hoisted(() => vi.fn());
const getPassiveSnapshotMock = vi.hoisted(() => vi.fn());
const runPassiveTaskMock = vi.hoisted(() => vi.fn());
const listMacroRunsMock = vi.hoisted(() => vi.fn());

vi.mock('./ai-os-api', () => ({
  getAiStatus: getAiStatusMock,
  cancelAiJob: cancelAiJobMock,
  cancelResearchRun: cancelResearchRunMock,
  resumeResearchRun: resumeResearchRunMock
}));

vi.mock('./passive-tasks-api', () => ({
  getPassiveSnapshot: getPassiveSnapshotMock,
  runPassiveTask: runPassiveTaskMock
}));

vi.mock('./macro-lab-api', () => ({
  listMacroRuns: listMacroRunsMock
}));

import { loadActivitySnapshot, settleActivitySource } from './activity-api';

describe('activity source loading', () => {
  afterEach(() => {
    vi.clearAllMocks();
    Reflect.deleteProperty(globalThis, 'localStorage');
  });

  it('settles a hung source as a timeout instead of blocking the caller', async () => {
    const result = await settleActivitySource('Slow source', new Promise<string>(() => undefined), 2);

    expect(result.status).toBe('rejected');
    expect(result.status === 'rejected' ? result.reason.message : '').toContain('timed out');
  });

  it('keeps other Activity sources visible when one source times out', async () => {
    getAiStatusMock.mockReturnValue(new Promise(() => undefined));
    getPassiveSnapshotMock.mockResolvedValue({ runs: [] });
    listMacroRunsMock.mockResolvedValue([]);

    const snapshot = await loadActivitySnapshot(20, { sourceTimeoutMs: 2 });

    expect(snapshot.partial).toBe(true);
    expect(snapshot.errors[0]).toContain('AI OS');
    expect(snapshot.sources.find((source) => source.id === 'ai-os')).toMatchObject({
      ok: false,
      state: 'timeout'
    });
    expect(snapshot.sources.find((source) => source.id === 'passive')).toMatchObject({
      ok: true,
      state: 'ok'
    });
    expect(snapshot.sources.find((source) => source.id === 'macro-lab')).toMatchObject({
      ok: true,
      state: 'ok'
    });
  });

  it('falls back to cached Activity records when all live sources fail', async () => {
    installLocalStorage();
    localStorage.setItem(
      'miniHub.activity.snapshot.v1',
      JSON.stringify({
        version: 1,
        cachedAt: '2026-06-23T10:00:00.000Z',
        snapshot: {
          checkedAt: '2026-06-23T09:59:00.000Z',
          stale: false,
          partial: false,
          active: true,
          records: [
            {
              id: 'research:cached',
              source: 'research',
              sourceLabel: 'Research Desk',
              title: 'Cached research',
              detail: 'Still recoverable from cache.',
              status: 'running',
              startedAt: '2026-06-23T09:50:00.000Z',
              updatedAt: '2026-06-23T09:55:00.000Z',
              route: '/research?run=cached',
              actions: [],
              metadata: {}
            }
          ],
          sources: [],
          errors: []
        }
      })
    );
    getAiStatusMock.mockRejectedValue(new Error('AI OS offline'));
    getPassiveSnapshotMock.mockRejectedValue(new Error('Passive offline'));
    listMacroRunsMock.mockRejectedValue(new Error('Macro offline'));

    const snapshot = await loadActivitySnapshot(20, { sourceTimeoutMs: 2 });

    expect(snapshot.stale).toBe(true);
    expect(snapshot.partial).toBe(true);
    expect(snapshot.records.map((record) => record.id)).toEqual(['research:cached']);
    expect(snapshot.errors.at(-1)).toContain('cached Activity records');
  });
});

function installLocalStorage(): void {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      }
    }
  });
}
