import { describe, expect, it } from 'vitest';
import type { ClientDataState } from './client-data';
import { analyticsViewMessage, analyticsViewState, buildAnalyticsMetricRows, buildStudyMinutesTrend } from './analytics-view';

function state(partial: Partial<ClientDataState> = {}): ClientDataState {
  return {
    initialized: true,
    isOnline: true,
    deviceId: 'web_test',
    workspaceId: 'personal',
    cursor: '',
    lastSyncedAt: '',
    status: 'idle',
    error: '',
    jobs: [],
    studySessions: [],
    careerActions: [],
    gameRuns: [],
    settings: null,
    gameStates: [],
    ...partial
  };
}

describe('analytics view helpers', () => {
  it('builds metric rows from real local cache collections', () => {
    const rows = buildAnalyticsMetricRows(
      state({
        jobs: [{ id: 'job_1' }, { id: 'job_2' }] as ClientDataState['jobs'],
        careerActions: [{ id: 'action_1' }, { id: 'action_2', completedAt: '2026-06-23T12:00:00.000Z' }] as ClientDataState['careerActions'],
        studySessions: [{ id: 'study_1' }] as ClientDataState['studySessions'],
        gameRuns: [{ id: 'run_1' }, { id: 'run_2' }, { id: 'run_3' }] as ClientDataState['gameRuns']
      })
    );

    expect(rows).toEqual([
      { label: 'Career jobs', value: 2 },
      { label: 'Open career actions', value: 1 },
      { label: 'Study sessions', value: 1 },
      { label: 'Game runs', value: 3 }
    ]);
  });

  it('builds a seven-day study minutes trend from logged sessions', () => {
    const trend = buildStudyMinutesTrend(
      [
        { loggedAt: '2026-06-20T10:00:00.000Z', minutes: 25 },
        { loggedAt: '2026-06-20T13:00:00.000Z', minutes: 15 },
        { loggedAt: '2026-06-23T09:00:00.000Z', minutes: 50 }
      ] as ClientDataState['studySessions'],
      7,
      new Date('2026-06-23T12:00:00')
    );

    expect(trend).toEqual([0, 0, 0, 40, 0, 0, 50]);
  });

  it('distinguishes loading, empty, offline, error, and ready states', () => {
    expect(analyticsViewState(state({ initialized: false }))).toBe('loading');
    expect(analyticsViewState(state())).toBe('empty');
    expect(analyticsViewState(state({ status: 'offline-readonly' }))).toBe('offline');
    expect(analyticsViewState(state({ status: 'error', error: 'PGlite unavailable' }))).toBe('error');
    expect(analyticsViewState(state({ jobs: [{ id: 'job_1' }] as ClientDataState['jobs'] }))).toBe('ready');
    expect(analyticsViewMessage(state({ status: 'syncing', jobs: [{ id: 'job_1' }] as ClientDataState['jobs'] }))).toContain('sync refreshes');
  });
});
