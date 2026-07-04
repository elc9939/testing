import { describe, expect, it, vi } from 'vitest';
import type { PassiveSnapshot } from '@mini-hub/core';
import { readCachedPassiveSnapshot, visiblePassiveNotifications, writePassiveSnapshotCache } from './passive-tasks-api';

function passiveSnapshot(input: Partial<PassiveSnapshot>): PassiveSnapshot {
  return {
    checkedAt: '2026-07-02T08:00:00.000Z',
    settings: null,
    watchers: [],
    triggers: [],
    tasks: [],
    worker: null,
    runs: [],
    results: [],
    notifications: [],
    digest: [],
    sources: [],
    errors: [],
    ...input
  } as unknown as PassiveSnapshot;
}

describe('passive task API helpers', () => {
  it('persists a browser passive snapshot for warm route rehydration', () => {
    const values = new Map<string, string>();
    const storage = {
      get length() {
        return values.size;
      },
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      key: (index: number) => Array.from(values.keys())[index] ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value)
    } as Storage;
    vi.stubGlobal('localStorage', storage);
    const snapshot = passiveSnapshot({
      checkedAt: '2026-07-02T08:15:00.000Z',
      runs: [
        {
          id: 'passive-run-cache',
          taskId: 'passive-task:app-health',
          watcherId: 'passive-watcher:app-health',
          family: 'app_health',
          status: 'succeeded',
          startedAt: '2026-07-02T08:10:00.000Z',
          finishedAt: '2026-07-02T08:10:02.000Z',
          durationMs: 2000,
          attempt: 1,
          cards: [],
          changed: [],
          metadata: {}
        }
      ] as PassiveSnapshot['runs']
    });

    const write = writePassiveSnapshotCache(snapshot);
    const cached = readCachedPassiveSnapshot();

    expect(write.cachedAt).toBeTruthy();
    expect(cached?.cachedAt).toBe(write.cachedAt);
    expect(cached?.snapshot.checkedAt).toBe(snapshot.checkedAt);
    expect(cached?.snapshot.runs[0]?.id).toBe('passive-run-cache');
  });

  it('hides resolved service notifications after a newer ok source-health row', () => {
    const snapshot = passiveSnapshot({
      notifications: [
        {
          id: 'passive-notification:old-ai-os',
          runId: 'passive-run:old',
          taskId: 'passive-task:app-health',
          family: 'app_health',
          title: 'AI OS is unavailable',
          body: 'This operation was aborted',
          level: 'warning',
          route: '/settings',
          cardIds: [],
          createdAt: '2026-07-02T06:00:00.000Z'
        },
        {
          id: 'passive-notification:current-ai-os',
          runId: 'passive-run:current',
          taskId: 'passive-task:app-health',
          family: 'app_health',
          title: 'AI OS is unavailable',
          body: 'The service is still offline',
          level: 'warning',
          route: '/settings',
          cardIds: [],
          createdAt: '2026-07-02T08:05:00.000Z'
        }
      ],
      sources: [
        {
          id: 'app_health',
          label: 'App Health Watchdog',
          status: 'ok',
          fetchedAt: '2026-07-02T07:00:00.000Z',
          details: {}
        }
      ]
    });

    expect(visiblePassiveNotifications(snapshot).map((notification) => notification.id)).toEqual([
      'passive-notification:current-ai-os'
    ]);
  });
});
