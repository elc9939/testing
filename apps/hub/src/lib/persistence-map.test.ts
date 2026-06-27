import { routeMap } from '@mini-hub/core';
import { describe, expect, it } from 'vitest';
import { persistenceOwnerLabel, persistenceRows, persistenceSummary } from './persistence-map';

describe('persistence map', () => {
  it('documents recovery routes for the major Mini Hub surfaces', () => {
    expect(persistenceRows.map((row) => row.id)).toEqual([
      'today',
      'activity',
      'career',
      'study',
      'productivity',
      'research',
      'ai-os',
      'macro-lab',
      'passive-tasks',
      'ai-lab',
      'games'
    ]);

    expect(persistenceRows.find((row) => row.id === 'activity')?.recoveryRoute).toBe(routeMap.activity);
    expect(persistenceRows.find((row) => row.id === 'research')?.savedWhere).toContain('AI OS storage');
    expect(persistenceRows.find((row) => row.id === 'ai-lab')?.crossDevice).toBe(false);
    expect(persistenceRows.find((row) => row.id === 'career')?.crossDevice).toBe(true);
    expect(persistenceRows.find((row) => row.id === 'career')?.savedWhere).toContain('core-data snapshot');
    expect(persistenceRows.find((row) => row.id === 'study')?.reloadBehavior).toContain('local API restart');
    expect(persistenceRows.find((row) => row.id === 'games')?.savedWhere).toContain('core-data snapshot');
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
