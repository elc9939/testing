import { describe, expect, it } from 'vitest';
import type { PassiveSnapshot } from '@mini-hub/core';
import { visiblePassiveNotifications } from './passive-tasks-api';

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
