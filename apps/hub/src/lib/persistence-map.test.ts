import { routeMap } from '@mini-hub/core';
import { describe, expect, it } from 'vitest';
import { persistenceOwnerLabel, persistenceRows, persistenceSummary, type PersistenceRow } from './persistence-map';

describe('persistence map', () => {
  it('documents recovery routes for the major Mini Hub surfaces', () => {
    expect(persistenceRows.map((row) => row.id)).toEqual([
      'today',
      'activity',
      'career',
      'study',
      'analytics',
      'productivity',
      'research',
      'ai-os',
      'macro-lab',
      'passive-tasks',
      'settings',
      'ai-lab',
      'games'
    ]);

    expect(persistenceRows.find((row) => row.id === 'activity')?.recoveryRoute).toBe(routeMap.activity);
    expect(persistenceRows.find((row) => row.id === 'analytics')?.savedWhere).toContain('does not keep a separate dataset');
    expect(persistenceRows.find((row) => row.id === 'research')?.savedWhere).toContain('AI OS storage');
    expect(persistenceRows.find((row) => row.id === 'ai-lab')?.crossDevice).toBe(false);
    expect(persistenceRows.find((row) => row.id === 'career')?.crossDevice).toBe(true);
    expect(persistenceRows.find((row) => row.id === 'career')?.savedWhere).toContain('core-data snapshot');
    expect(persistenceRows.find((row) => row.id === 'study')?.reloadBehavior).toContain('local API restart');
    expect(persistenceRows.find((row) => row.id === 'settings')?.offlineBehavior).toContain('explain the missing service');
    expect(persistenceRows.find((row) => row.id === 'games')?.savedWhere).toContain('core-data snapshot');
  });

  it('keeps every visible hub route represented by a recovery destination', () => {
    const representedRoutes = new Set(persistenceRows.map((row) => row.recoveryRoute));
    const requiredRoutes = [
      routeMap.today,
      routeMap.activity,
      routeMap.productivity,
      routeMap.careerDesk,
      routeMap.studyDesk,
      routeMap.analytics,
      routeMap.research,
      routeMap.aiLab,
      routeMap.aiOs,
      routeMap.macroLab,
      routeMap.passiveTasks,
      routeMap.settings,
      routeMap.games
    ];

    expect(representedRoutes.size).toBe(persistenceRows.length);
    for (const route of requiredRoutes) {
      expect(representedRoutes.has(route), `${route} should have a Data & Recovery row`).toBe(true);
    }
  });

  it('keeps each persistence row explicit about save, reload, offline, and recovery behavior', () => {
    const ids = new Set<string>();
    for (const row of persistenceRows as readonly PersistenceRow[]) {
      expect(ids.has(row.id), `${row.id} should be unique`).toBe(false);
      ids.add(row.id);
      expect(row.feature.trim().length, `${row.id} needs a visible feature label`).toBeGreaterThan(0);
      expect(row.savedWhere.trim().length, `${row.id} needs savedWhere copy`).toBeGreaterThan(30);
      expect(row.reloadBehavior.trim().length, `${row.id} needs reloadBehavior copy`).toBeGreaterThan(30);
      expect(row.offlineBehavior.trim().length, `${row.id} needs offlineBehavior copy`).toBeGreaterThan(30);
      expect(row.recoveryRoute, `${row.id} needs an app route`).toMatch(/^\/(?:$|[a-z0-9/-]+)/);
      expect(row.recoveryLabel, `${row.id} needs a recovery label`).toMatch(/^Open /);
      expect(typeof row.crossDevice, `${row.id} must classify cross-device behavior`).toBe('boolean');
    }
  });

  it('summarizes browser-local and service-backed durability clearly', () => {
    expect(persistenceOwnerLabel('hub-api')).toBe('Hub API');
    expect(persistenceOwnerLabel('browser')).toBe('Browser');

    const summary = persistenceSummary(persistenceRows);
    expect(summary.total).toBe(persistenceRows.length);
    expect(summary.browserLocal).toBeGreaterThan(0);
    expect(summary.serviceBacked).toBeGreaterThan(summary.browserLocal);
    expect(summary.crossDevice).toBeGreaterThan(0);
  });
});
