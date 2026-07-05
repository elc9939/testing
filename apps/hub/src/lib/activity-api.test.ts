import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getAiStatusMock = vi.hoisted(() => vi.fn());
const cancelAiJobMock = vi.hoisted(() => vi.fn());
const cancelResearchRunMock = vi.hoisted(() => vi.fn());
const resumeResearchRunMock = vi.hoisted(() => vi.fn());
const getPassiveSnapshotMock = vi.hoisted(() => vi.fn());
const runPassiveTaskMock = vi.hoisted(() => vi.fn());
const listMacroRunsMock = vi.hoisted(() => vi.fn());
const getUnifiedActionLedgerMock = vi.hoisted(() => vi.fn());

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

vi.mock('./api', () => ({
  getUnifiedActionLedger: getUnifiedActionLedgerMock
}));

import { clearDismissedActivityRecords, dismissActivityRecord, loadActivitySnapshot, readDismissedActivityIds, settleActivitySource } from './activity-api';

describe('activity source loading', () => {
  beforeEach(() => {
    getUnifiedActionLedgerMock.mockResolvedValue({ checkedAt: '2026-06-23T10:00:00.000Z', actions: [], errors: [], sources: [] });
  });

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

  it('compacts aborted Activity source failures before they reach Today', async () => {
    getAiStatusMock.mockRejectedValue(new Error('This operation was aborted'));
    getPassiveSnapshotMock.mockResolvedValue({ runs: [] });
    listMacroRunsMock.mockResolvedValue([]);

    const snapshot = await loadActivitySnapshot(20, { sourceTimeoutMs: 2 });

    expect(snapshot.errors[0]).toBe('AI OS timed out. Cached data stays visible when available; retry after the service settles.');
    expect(snapshot.sources.find((source) => source.id === 'ai-os')).toMatchObject({
      ok: false,
      state: 'timeout',
      error: 'AI OS timed out. Cached data stays visible when available; retry after the service settles.'
    });
  });

  it('falls back to cached Activity records when all live sources fail', async () => {
    installLocalStorage();
    writeActivityCache([
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
    ]);
    getAiStatusMock.mockRejectedValue(new Error('AI OS offline'));
    getPassiveSnapshotMock.mockRejectedValue(new Error('Passive offline'));
    listMacroRunsMock.mockRejectedValue(new Error('Macro offline'));
    getUnifiedActionLedgerMock.mockRejectedValue(new Error('Mini Hub actions offline'));

    const snapshot = await loadActivitySnapshot(20, { sourceTimeoutMs: 2 });

    expect(snapshot.stale).toBe(true);
    expect(snapshot.partial).toBe(true);
    expect(snapshot.records.map((record) => record.id)).toEqual(['research:cached']);
    expect(snapshot.errors.at(-1)).toContain('cached Activity records');
  });

  it('merges cached records only for live sources that failed', async () => {
    installLocalStorage();
    writeActivityCache([
      {
        id: 'research:cached-ai',
        source: 'research',
        sourceLabel: 'Research Desk',
        title: 'Cached AI research',
        detail: 'Cached AI OS work stays recoverable.',
        status: 'running',
        startedAt: '2026-06-23T09:50:00.000Z',
        updatedAt: '2026-06-23T10:00:00.000Z',
        route: '/research?run=cached-ai',
        actions: [],
        metadata: {}
      },
      {
        id: 'macro:stale-macro',
        source: 'macro-lab',
        sourceLabel: 'Macro Lab',
        title: 'Stale macro',
        detail: 'Should not appear because Macro Lab answered live.',
        status: 'succeeded',
        startedAt: '2026-06-23T09:40:00.000Z',
        updatedAt: '2026-06-23T09:41:00.000Z',
        route: '/macro-lab?run=stale-macro',
        actions: [],
        metadata: {}
      }
    ]);
    getAiStatusMock.mockRejectedValue(new Error('AI OS offline'));
    getPassiveSnapshotMock.mockResolvedValue({
      runs: [
        {
          id: 'passive_live',
          taskId: 'task_live',
          watcherId: 'watcher_live',
          family: 'app_health',
          status: 'succeeded',
          startedAt: '2026-06-23T10:04:00.000Z',
          finishedAt: '2026-06-23T10:05:00.000Z',
          cards: [],
          changed: [],
          metadata: {}
        }
      ]
    });
    listMacroRunsMock.mockResolvedValue([]);

    const snapshot = await loadActivitySnapshot(20, { sourceTimeoutMs: 2 });

    expect(snapshot.stale).toBe(true);
    expect(snapshot.partial).toBe(true);
    expect(snapshot.records.map((record) => record.id)).toEqual(['passive:passive_live', 'research:cached-ai']);
    expect(snapshot.sources.find((source) => source.id === 'ai-os')).toMatchObject({
      ok: false,
      count: 1
    });
    expect(snapshot.sources.find((source) => source.id === 'passive')).toMatchObject({
      ok: true,
      count: 1
    });
    expect(snapshot.sources.find((source) => source.id === 'macro-lab')).toMatchObject({
      ok: true,
      count: 0
    });
    expect(snapshot.errors.at(-1)).toContain('sources that failed live refresh');
  });

  it('returns source failures instead of healthy-empty when all sources fail without cache', async () => {
    getAiStatusMock.mockRejectedValue(new Error('AI OS offline'));
    getPassiveSnapshotMock.mockRejectedValue(new Error('Passive offline'));
    listMacroRunsMock.mockRejectedValue(new Error('Macro offline'));
    getUnifiedActionLedgerMock.mockRejectedValue(new Error('Mini Hub actions offline'));

    const snapshot = await loadActivitySnapshot(20, { sourceTimeoutMs: 2 });

    expect(snapshot.partial).toBe(true);
    expect(snapshot.stale).toBe(false);
    expect(snapshot.records).toEqual([]);
    expect(snapshot.sources.every((source) => !source.ok)).toBe(true);
    expect(snapshot.errors.slice(0, 4)).toEqual([
      expect.stringContaining('AI OS'),
      expect.stringContaining('Passive Tasks'),
      expect.stringContaining('Macro Lab'),
      expect.stringContaining('Mini Hub actions')
    ]);
    expect(snapshot.errors.at(-1)).toContain('Browser Activity cache is unavailable');
  });

  it('keeps live Activity usable when the browser cache cannot be written', async () => {
    installThrowingLocalStorage();
    getAiStatusMock.mockResolvedValue({ providers: [], capabilities: [], hardware: { gpus: [] }, jobs: [], background: [], tools: [] });
    getPassiveSnapshotMock.mockResolvedValue({
      runs: [
        {
          id: 'passive_live',
          taskId: 'task_live',
          watcherId: 'watcher_live',
          family: 'app_health',
          status: 'succeeded',
          startedAt: '2026-06-23T10:04:00.000Z',
          finishedAt: '2026-06-23T10:05:00.000Z',
          cards: [],
          changed: [],
          metadata: {}
        }
      ]
    });
    listMacroRunsMock.mockResolvedValue([]);

    const snapshot = await loadActivitySnapshot(20, { sourceTimeoutMs: 2 });

    expect(snapshot.records.map((record) => record.id)).toEqual(['passive:passive_live']);
    expect(snapshot.sources.find((source) => source.id === 'passive')).toMatchObject({
      ok: true,
      count: 1
    });
    expect(snapshot.errors.at(-1)).toContain('Browser Activity cache could not be updated');
  });

  it('keeps live Activity usable when browser storage access is blocked', async () => {
    installBlockedLocalStorageAccess();
    getAiStatusMock.mockResolvedValue({ providers: [], capabilities: [], hardware: { gpus: [] }, jobs: [], background: [], tools: [] });
    getPassiveSnapshotMock.mockResolvedValue({ runs: [] });
    listMacroRunsMock.mockResolvedValue([]);

    const snapshot = await loadActivitySnapshot(20, { sourceTimeoutMs: 2 });

    expect(snapshot.partial).toBe(false);
    expect(snapshot.records).toEqual([]);
    expect(snapshot.errors.at(-1)).toContain('Browser Activity cache is unavailable');
  });

  it('persists and clears locally dismissed Activity record ids', () => {
    installLocalStorage();

    expect(Array.from(readDismissedActivityIds())).toEqual([]);

    const dismissed = dismissActivityRecord('macro:finished');
    expect(Array.from(dismissed)).toEqual(['macro:finished']);
    expect(Array.from(readDismissedActivityIds())).toEqual(['macro:finished']);

    expect(Array.from(clearDismissedActivityRecords())).toEqual([]);
    expect(Array.from(readDismissedActivityIds())).toEqual([]);
  });

  it('keeps dismiss usable for the current page when browser storage rejects writes', () => {
    installThrowingLocalStorage();

    const dismissed = dismissActivityRecord('macro:finished');

    expect(Array.from(dismissed)).toEqual(['macro:finished']);
  });

  it('keeps dismiss and restore usable when browser storage access is blocked', () => {
    installBlockedLocalStorageAccess();

    const dismissed = dismissActivityRecord('macro:finished');

    expect(Array.from(dismissed)).toEqual(['macro:finished']);
    expect(Array.from(readDismissedActivityIds())).toEqual([]);
    expect(Array.from(clearDismissedActivityRecords())).toEqual([]);
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

function writeActivityCache(records: Array<Record<string, unknown>>): void {
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
        records,
        sources: [],
        errors: []
      }
    })
  );
}

function installThrowingLocalStorage(): void {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded');
      },
      removeItem: () => undefined
    }
  });
}

function installBlockedLocalStorageAccess(): void {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get: () => {
      throw new Error('Browser storage blocked');
    }
  });
}
