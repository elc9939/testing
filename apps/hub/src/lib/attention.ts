import type { CalendarEvent, CareerActionRecord, JobRecord, StudySession } from '@mini-hub/core';
import type { GmailThreadInsight } from './productivity-api';

const dayMs = 24 * 60 * 60 * 1000;

export type AttentionKind = 'calendar' | 'mail' | 'career' | 'study' | 'service' | 'setup';
export type AttentionSyncStatus = 'idle' | 'syncing' | 'offline-readonly' | 'error';

export interface AttentionItem {
  id: string;
  kind: AttentionKind;
  title: string;
  detail: string;
  route: string;
  source: string;
  priority: number;
  dueAt?: string;
  actionId?: string;
}

export interface BuildAttentionItemsInput {
  now?: Date;
  googleConnected: boolean;
  dashboardError?: string;
  syncStatus?: AttentionSyncStatus;
  syncError?: string;
  events: CalendarEvent[];
  importantMail: GmailThreadInsight[];
  jobs: JobRecord[];
  careerActions: CareerActionRecord[];
  studySessions: StudySession[];
}

export function attentionKindLabel(kind: AttentionKind): string {
  if (kind === 'calendar') return 'Calendar';
  if (kind === 'mail') return 'Mail';
  if (kind === 'career') return 'Career';
  if (kind === 'study') return 'Study';
  if (kind === 'service') return 'Service';
  return 'Setup';
}

export function buildAttentionItems(input: BuildAttentionItemsInput): AttentionItem[] {
  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  const items: AttentionItem[] = [];

  if (input.syncStatus === 'offline-readonly') {
    items.push({
      id: 'service:offline-readonly',
      kind: 'service',
      title: 'Offline: saves are paused',
      detail: 'Cached data stays visible. Edits resume after the hub reconnects.',
      route: '/settings',
      source: 'sync',
      priority: 100
    });
  }

  if (input.syncStatus === 'error' || input.syncError) {
    items.push({
      id: 'service:sync-error',
      kind: 'service',
      title: 'Local sync needs attention',
      detail: input.syncError || 'The local cache or sync service reported an error.',
      route: '/settings',
      source: 'sync',
      priority: 96
    });
  }

  if (input.dashboardError) {
    items.push({
      id: 'service:productivity-error',
      kind: 'service',
      title: 'Productivity services did not refresh',
      detail: input.dashboardError,
      route: '/settings',
      source: 'productivity',
      priority: 94
    });
  }

  if (!input.googleConnected) {
    items.push({
      id: 'setup:google',
      kind: 'setup',
      title: 'Connect Google calendar and mail',
      detail: 'Today becomes much more useful once calendar and Gmail signals are available.',
      route: '/productivity',
      source: 'google',
      priority: 70
    });
  }

  const activeEvents = input.events
    .filter((event) => event.status.toLowerCase() !== 'cancelled')
    .filter(isAttentionWorthyEvent)
    .sort((a, b) => timeValue(a.start) - timeValue(b.start));
  const nextEvent = activeEvents.find((event) => timeValue(event.start) >= nowMs - 15 * 60 * 1000);
  if (nextEvent) {
    const eventMs = timeValue(nextEvent.start);
    items.push({
      id: `calendar:${nextEvent.calendarId}:${nextEvent.id}`,
      kind: 'calendar',
      title: nextEvent.title,
      detail: eventDetail(nextEvent),
      route: '/productivity',
      source: 'google_calendar',
      priority: eventMs <= nowMs + dayMs ? 92 : 70,
      dueAt: nextEvent.start
    });
  }

  for (const insight of input.importantMail.filter(isAttentionWorthyMail).slice(0, 1)) {
    items.push({
      id: `mail:${insight.thread.id}`,
      kind: 'mail',
      title: insight.thread.subject,
      detail: [insight.thread.from, insight.reason, insight.deadlineHint].filter(Boolean).join(' - '),
      route: '/productivity',
      source: 'gmail',
      priority: mailPriority(insight),
      dueAt: insight.thread.date || insight.deadlineHint,
      actionId: insight.thread.id
    });
  }

  const openCareerActions = input.careerActions
    .filter((action) => !action.completedAt)
    .filter((action) => isActionDueSoon(action.dueAt, nowMs))
    .filter((action) => !isMaintenanceCareerAction(action.label))
    .sort((a, b) => nullableTime(a.dueAt ?? a.updatedAt) - nullableTime(b.dueAt ?? b.updatedAt));
  for (const action of uniqueCareerActions(openCareerActions).slice(0, 2)) {
    items.push({
      id: `career-action:${action.id}`,
      kind: 'career',
      title: action.label,
      detail: action.jobId ? 'Career action linked to an application.' : 'Career action waiting in Career Desk.',
      route: '/desk/career',
      source: 'career_action',
      priority: datedPriority(action.dueAt, nowMs, 84, 76, 52),
      dueAt: action.dueAt
    });
  }

  const activeJobs = input.jobs
    .filter((job) => ['lead', 'saved', 'watching'].includes(job.status))
    .filter((job) => isActionDueSoon(job.nextActionAt, nowMs))
    .sort((a, b) => nullableTime(a.nextActionAt ?? a.updatedAt) - nullableTime(b.nextActionAt ?? b.updatedAt));
  for (const job of activeJobs.slice(0, 2)) {
    items.push({
      id: `job:${job.id}`,
      kind: 'career',
      title: [job.company, job.role].filter(Boolean).join(' - '),
      detail: `Application status: ${job.status}`,
      route: '/desk/career',
      source: 'job',
      priority: datedPriority(job.nextActionAt, nowMs, 82, 72, 46),
      dueAt: job.nextActionAt
    });
  }

  const hasCareerFocus = openCareerActions.length > 0 || activeJobs.length > 0;
  if (hasCareerFocus) {
    const recentStudyMinutes = input.studySessions
      .filter((session) => timeValue(session.loggedAt) >= nowMs - 7 * dayMs)
      .reduce((total, session) => total + session.minutes, 0);
    if (recentStudyMinutes === 0) {
      items.push({
        id: 'study:no-recent-sessions',
        kind: 'study',
        title: 'No study logged this week',
        detail: 'Tie a short study block to your current career targets.',
        route: '/desk/study',
        source: 'study_session',
        priority: 58
      });
    } else if (recentStudyMinutes < 90) {
      items.push({
        id: 'study:light-week',
        kind: 'study',
        title: 'Light study week',
        detail: `${recentStudyMinutes} minutes logged in the last 7 days.`,
        route: '/desk/study',
        source: 'study_session',
        priority: 44
      });
    }
  }

  return items.sort(compareAttentionItems);
}

function compareAttentionItems(a: AttentionItem, b: AttentionItem): number {
  if (a.priority !== b.priority) return b.priority - a.priority;
  const aTime = nullableTime(a.dueAt);
  const bTime = nullableTime(b.dueAt);
  if (aTime !== bTime) return aTime - bTime;
  return a.title.localeCompare(b.title);
}

function eventDetail(event: CalendarEvent): string {
  return [event.provider === 'google' ? 'Google Calendar' : event.provider, event.location].filter(Boolean).join(' - ');
}

function isAttentionWorthyEvent(event: CalendarEvent): boolean {
  const title = event.title.toLowerCase();
  const transparency = typeof event.raw.transparency === 'string' ? event.raw.transparency.toLowerCase() : '';
  if (transparency === 'transparent' && !event.start.includes('T')) return false;
  if (/\b(birthday|holiday|moon phase|weather)\b/u.test(title)) return false;
  return true;
}

function isAttentionWorthyMail(insight: GmailThreadInsight): boolean {
  if (!insight.thread.unread) return false;
  if (insight.category === 'noise' || insight.category === 'notification' || insight.category === 'personal') return false;
  if (isLowSignalNotification(insight)) return false;
  return insight.priority >= 74 || Boolean(insight.deadlineHint);
}

function isLowSignalNotification(insight: GmailThreadInsight): boolean {
  const text = [insight.thread.subject, insight.thread.from, insight.thread.snippet, insight.reason]
    .join(' ')
    .toLowerCase();
  const passiveMoney = /\b(received money|you received money|money transfer received|payment received|receipt|statement available)\b/u;
  const actionWords = /\b(action required|verify|verification|security alert|failed|declined|overdue|due|deadline|reply|respond)\b/u;
  if (passiveMoney.test(text) && !actionWords.test(text)) return true;
  if (/\b(unsubscribe|newsletter|promotion|sale|discount|reward points|points balance)\b/u.test(text)) return true;
  return false;
}

function mailPriority(insight: GmailThreadInsight): number {
  let priority = Math.max(50, Math.min(78, Math.round(insight.priority)));
  if (insight.deadlineHint) priority += 6;
  if (insight.category === 'reply') priority += 4;
  if (insight.category === 'deadline') priority += 5;
  return Math.min(84, priority);
}

function datedPriority(value: string | undefined, nowMs: number, overdue: number, soon: number, undated: number): number {
  if (!value) return undated;
  const parsed = timeValue(value);
  if (!Number.isFinite(parsed)) return undated;
  if (parsed < nowMs) return overdue;
  if (parsed <= nowMs + 3 * dayMs) return soon;
  return Math.max(undated, soon - 18);
}

function isActionDueSoon(value: string | undefined, nowMs: number): boolean {
  if (!value) return false;
  const parsed = timeValue(value);
  if (!Number.isFinite(parsed)) return false;
  return parsed >= nowMs - 14 * dayMs && parsed <= nowMs + 14 * dayMs;
}

function isMaintenanceCareerAction(label: string): boolean {
  return /\b(archive|dedupe|cleanup|sweep|import)\b/iu.test(label);
}

function uniqueCareerActions(actions: CareerActionRecord[]): CareerActionRecord[] {
  const seen = new Set<string>();
  const unique: CareerActionRecord[] = [];
  for (const action of actions) {
    const key = `${action.jobId ?? 'general'}:${action.label.trim().toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(action);
  }
  return unique;
}

function nullableTime(value: string | undefined): number {
  if (!value) return Number.POSITIVE_INFINITY;
  const parsed = timeValue(value);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function timeValue(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}
