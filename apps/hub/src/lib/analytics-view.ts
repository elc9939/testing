import type { MetricRow } from '@mini-hub/db/analytics';
import type { ClientDataState } from './client-data';

export type AnalyticsViewState = 'loading' | 'ready' | 'empty' | 'offline' | 'error';

type AnalyticsInput = Pick<ClientDataState, 'initialized' | 'status' | 'error' | 'jobs' | 'studySessions' | 'careerActions' | 'gameRuns'>;

export function buildAnalyticsMetricRows(state: Pick<AnalyticsInput, 'jobs' | 'studySessions' | 'careerActions' | 'gameRuns'>): MetricRow[] {
  return [
    { label: 'Career jobs', value: state.jobs.length },
    { label: 'Open career actions', value: state.careerActions.filter((action) => !action.completedAt).length },
    { label: 'Study sessions', value: state.studySessions.length },
    { label: 'Game runs', value: state.gameRuns.length }
  ];
}

export function buildStudyMinutesTrend(
  sessions: AnalyticsInput['studySessions'],
  days = 7,
  now = new Date()
): number[] {
  const dayKeys = recentDayKeys(days, now);
  const totals = new Map(dayKeys.map((key) => [key, 0]));
  for (const session of sessions) {
    const key = localDayKey(new Date(session.loggedAt));
    if (totals.has(key)) totals.set(key, (totals.get(key) ?? 0) + Number(session.minutes || 0));
  }
  return dayKeys.map((key) => totals.get(key) ?? 0);
}

export function analyticsViewState(state: AnalyticsInput, rows = buildAnalyticsMetricRows(state)): AnalyticsViewState {
  if (!state.initialized) return 'loading';
  if (state.status === 'error') return 'error';
  if (state.status === 'offline-readonly') return 'offline';
  if (rows.every((row) => row.value === 0)) return 'empty';
  return 'ready';
}

export function analyticsViewMessage(state: AnalyticsInput, rows = buildAnalyticsMetricRows(state)): string {
  const viewState = analyticsViewState(state, rows);
  if (viewState === 'loading') return 'Opening the local analytics cache.';
  if (viewState === 'error') return state.error || 'Analytics cannot read the local browser cache right now.';
  if (viewState === 'offline') return 'Offline: showing the last browser-cached Career, Study, and game data.';
  if (viewState === 'empty') return 'No local analytics data yet. Add career jobs, study sessions, or game runs and this page will populate.';
  if (state.status === 'syncing') return 'Rendering cached local data while sync refreshes in the background.';
  return 'Rendering real data from the local Mini Hub cache.';
}

function recentDayKeys(days: number, now: Date): string[] {
  const count = Math.max(1, days);
  const end = startOfLocalDay(now);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(end);
    date.setDate(end.getDate() - (count - index - 1));
    return localDayKey(date);
  });
}

function localDayKey(date: Date): string {
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
