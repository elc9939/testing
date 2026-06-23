import {
  attentionActionKindSchema,
  attentionItemSchema,
  attentionSnapshotSchema,
  attentionSourceStatusSchema,
  attentionTriageStateSchema,
  personalSettingsSchema,
  personalWorkspaceId,
  type AttentionAction,
  type AttentionActionKind,
  type AttentionItem,
  type AttentionSnapshot,
  type AttentionSource,
  type AttentionSourceStatus,
  type AttentionTriageState,
  type CalendarEvent,
  type GmailThread,
  type PersonalSettings
} from '@mini-hub/core';
import { Hono } from 'hono';
import { z } from 'zod';
import { requireUser, type AppBindings } from '../context';
import { env } from '../env';
import { triageGmailThreads } from '../integrations/email-triage';
import { GoogleCalendarConnector, GoogleGmailConnector } from '../integrations/google';
import { getConnections as getStoredConnections } from '../integrations/token-vault';
import type { CalendarConnector } from '../integrations/types';
import { buildPassiveSourceStatuses, collectPassiveAttentionItems, runPassiveTask, updatePassiveCardTriage } from '../passive-engine';
import {
  appendSyncEvent,
  ensurePersonalWorkspace,
  userWorkspaceIds,
  withBeforeSnapshot,
  type MemoryStore
} from '../store';

type FetchLike = typeof fetch;

interface AttentionRouteOptions {
  externalFetch?: FetchLike;
}

interface SourceResult {
  items: AttentionItem[];
  source: AttentionSourceStatus;
  error?: string;
}

interface CalendarSummary {
  id: string;
  summary: string;
  primary?: boolean;
  timeZone?: string;
}

interface AiStatusPayload {
  jobs?: Array<Record<string, unknown>>;
  integrity?: Record<string, unknown>;
  backups?: Array<Record<string, unknown>>;
  benchmark_runs?: Array<Record<string, unknown>>;
  research_runs?: Array<Record<string, unknown>>;
}

interface ResearchMonitorPayload {
  id?: string;
  name?: string;
  enabled?: boolean;
  schedule?: string;
  request?: Record<string, unknown>;
  last_run_at?: string;
  last_status?: string;
  last_error?: string;
  run_count?: number;
}

interface MacroStatusPayload {
  ok?: boolean;
  engine?: {
    panic?: boolean;
    running?: number;
    action_count?: number;
  };
}

interface MacroRunPayload {
  id?: string;
  macro_id?: string;
  macro_name?: string;
  status?: string;
  dry_run?: boolean;
  started_at?: string;
  finished_at?: string;
  error?: string;
  steps?: Array<Record<string, unknown>>;
}

const dayMs = 24 * 60 * 60 * 1000;
const attentionTriagePreferenceKey = 'attentionTriage';
const manualAttentionPreferenceKey = 'attentionManualItems';

const actionBody = z.object({
  action: attentionActionKindSchema,
  snoozedUntil: z.string().optional()
});

function sourceStatus(input: {
  id: AttentionSource;
  label: string;
  status: AttentionSourceStatus['status'];
  itemCount?: number;
  error?: string;
  fetchedAt?: string;
}): AttentionSourceStatus {
  return attentionSourceStatusSchema.parse({
    id: input.id,
    label: input.label,
    status: input.status,
    itemCount: input.itemCount ?? 0,
    fetchedAt: input.fetchedAt,
    error: input.error
  });
}

function defaultSettings(): PersonalSettings {
  const now = new Date().toISOString();
  return personalSettingsSchema.parse({
    workspaceId: personalWorkspaceId,
    highScores: {},
    recentState: {},
    preferences: {},
    deviceId: 'api',
    updatedAt: now
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function describeError(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error || 'Unknown error');
}

function dateValue(value: string | undefined): number {
  if (!value) return Number.POSITIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function timeValue(value: string | undefined): number {
  if (!value) return Number.NaN;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function compactText(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function action(
  kind: AttentionActionKind,
  label: string,
  input: Partial<Omit<AttentionAction, 'kind' | 'label'>> = {}
): AttentionAction {
  return {
    kind,
    label,
    available: input.available ?? true,
    requiresOnline: input.requiresOnline ?? false,
    risk: input.risk ?? 'read',
    ...(input.reason ? { reason: input.reason } : {}),
    ...(input.route ? { route: input.route } : {})
  };
}

function parseAttentionItem(input: Omit<AttentionItem, 'status'> & Partial<Pick<AttentionItem, 'status'>>): AttentionItem {
  return attentionItemSchema.parse(input);
}

function compareItems(a: AttentionItem, b: AttentionItem): number {
  if (a.status !== b.status) {
    if (a.status === 'blocked') return -1;
    if (b.status === 'blocked') return 1;
  }
  if (a.priority !== b.priority) return b.priority - a.priority;
  const aDue = dateValue(a.dueAt);
  const bDue = dateValue(b.dueAt);
  if (aDue !== bDue) return aDue - bDue;
  return a.title.localeCompare(b.title);
}

function connectedGoogleConnections(store: MemoryStore) {
  return getStoredConnections(store, 'google').filter((connection) => connection.status === 'connected');
}

function passiveCalendar(calendar: CalendarSummary): boolean {
  return /\b(holiday|birthdays?|contacts|moon|weather)\b/iu.test(calendar.summary);
}

function selectCalendarTargets(items: CalendarSummary[]): CalendarSummary[] {
  const targets = new Map<string, CalendarSummary>();
  for (const calendar of items.filter((item) => item.primary)) targets.set(calendar.id, calendar);
  for (const calendar of items.filter((item) => !passiveCalendar(item))) targets.set(calendar.id, calendar);
  return Array.from(targets.values()).slice(0, 8);
}

function isAttentionWorthyEvent(event: CalendarEvent): boolean {
  const title = event.title.toLowerCase();
  const transparency = typeof event.raw.transparency === 'string' ? event.raw.transparency.toLowerCase() : '';
  if (event.status.toLowerCase() === 'cancelled') return false;
  if (transparency === 'transparent' && !event.start.includes('T')) return false;
  if (/\b(birthday|holiday|moon phase|weather)\b/u.test(title)) return false;
  return true;
}

function eventPriority(event: CalendarEvent, nowMs: number): number {
  const start = timeValue(event.start);
  if (!Number.isFinite(start)) return 48;
  if (start < nowMs - 30 * 60 * 1000) return 54;
  if (start <= nowMs + 90 * 60 * 1000) return 94;
  if (start <= nowMs + dayMs) return 82;
  if (start <= nowMs + 3 * dayMs) return 66;
  return 42;
}

function calendarItem(event: CalendarEvent, nowMs: number, calendarLabel: string): AttentionItem {
  return parseAttentionItem({
    id: `calendar:${event.calendarId}:${event.id}`,
    source: 'google_calendar',
    sourceId: `${event.calendarId}:${event.id}`,
    title: event.title,
    detail: [calendarLabel, event.location].filter(Boolean).join(' - '),
    route: event.htmlLink ?? '/productivity',
    dueAt: event.start,
    priority: eventPriority(event, nowMs),
    actionKind: 'open',
    actions: [
      action('open', event.htmlLink ? 'Open in Google' : 'Open calendar', { route: event.htmlLink ?? '/productivity' }),
      action('inspect', 'Inspect', { route: '/productivity' }),
      action('snooze', 'Snooze', { requiresOnline: true, risk: 'write' }),
      action('dismiss', 'Dismiss', { requiresOnline: true, risk: 'write' }),
      action('complete', 'Complete', {
        available: false,
        reason: 'Calendar events do not have a supported complete action. Open the source event to edit it.',
        route: '/productivity'
      })
    ],
    recoverability: {
      kind: 'snapshot',
      route: '/settings',
      description: 'Dismiss and snooze choices are stored in synced personal settings.',
      reversible: true
    },
    readOnly: false,
    writable: true,
    metadata: {
      calendarId: event.calendarId,
      eventId: event.id,
      end: event.end,
      status: event.status,
      htmlLink: event.htmlLink
    }
  });
}

async function collectCalendarItems(store: MemoryStore, now: Date): Promise<SourceResult> {
  const fetchedAt = new Date().toISOString();
  const connections = connectedGoogleConnections(store);
  if (!connections.length) {
    return {
      items: [],
      source: sourceStatus({
        id: 'google_calendar',
        label: 'Google Calendar',
        status: 'unavailable',
        fetchedAt,
        error: 'No connected Google account.'
      })
    };
  }

  const calendarResults = await Promise.allSettled(
    connections.map((connection) => new GoogleCalendarConnector(store, connection.id).listCalendars())
  );
  const calendars = calendarResults.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
  const calendarErrors = calendarResults
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map((result) => describeError(result.reason));
  if (!calendars.length && calendarErrors.length) {
    const error = calendarErrors[0] ?? 'Google Calendar failed to load.';
    return {
      items: [],
      source: sourceStatus({ id: 'google_calendar', label: 'Google Calendar', status: 'error', fetchedAt, error }),
      error: `Google Calendar: ${error}`
    };
  }

  const rangeEnd = new Date(now.getTime() + 14 * dayMs);
  const targets = selectCalendarTargets(calendars);
  const labels = new Map(calendars.map((calendar) => [calendar.id, calendar.summary]));
  const connector: CalendarConnector = new GoogleCalendarConnector(store);
  const eventResults = await Promise.allSettled(
    targets.map((calendar) =>
      connector.listEvents({
        calendarId: calendar.id,
        timeMin: now.toISOString(),
        timeMax: rangeEnd.toISOString()
      })
    )
  );
  const eventErrors = eventResults
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map((result) => describeError(result.reason));
  const byKey = new Map<string, CalendarEvent>();
  for (const event of eventResults.flatMap((result) => (result.status === 'fulfilled' ? result.value : []))) {
    byKey.set(`${event.calendarId}:${event.id}`, event);
  }
  const items = Array.from(byKey.values())
    .filter(isAttentionWorthyEvent)
    .sort((a, b) => dateValue(a.start) - dateValue(b.start))
    .slice(0, 24)
    .map((event) => calendarItem(event, now.getTime(), labels.get(event.calendarId) ?? 'Google Calendar'));
  const error = [...calendarErrors, ...eventErrors][0];
  return {
    items,
    source: sourceStatus({
      id: 'google_calendar',
      label: 'Google Calendar',
      status: error ? 'error' : 'ok',
      fetchedAt,
      itemCount: items.length,
      ...(error ? { error } : {})
    }),
    ...(error ? { error: `Google Calendar: ${error}` } : {})
  };
}

function priorityMailQuery(): string {
  return [
    'in:inbox is:unread newer_than:14d',
    '-category:promotions',
    '-category:social',
    '-category:forums',
    '-newsletter',
    '-unsubscribe',
    '(deadline OR due OR "action required" OR "please reply" OR rsvp OR interview OR flight OR exam OR assignment OR "security alert" OR verification OR "payment failed" OR invoice)'
  ].join(' ');
}

function threadTime(thread: GmailThread): number {
  const latest = thread.messages.at(-1);
  const internalDate = latest?.internalDate ? Number(latest.internalDate) : Number.NaN;
  if (Number.isFinite(internalDate)) return internalDate;
  return timeValue(latest?.date || thread.date) || 0;
}

function gmailItem(input: {
  thread: GmailThread;
  reason: string;
  category: string;
  priority: number;
  deadlineHint?: string;
}): AttentionItem {
  const manuallyImportant = input.thread.labelIds.includes('IMPORTANT');
  const priority = Math.min(96, Math.max(50, Math.round(input.priority)) + (manuallyImportant ? 7 : 0));
  return parseAttentionItem({
    id: `gmail:${input.thread.id}`,
    source: 'gmail',
    sourceId: input.thread.id,
    title: input.thread.subject,
    detail: [input.thread.from, input.reason, input.deadlineHint].filter(Boolean).join(' - '),
    route: '/productivity',
    dueAt: input.deadlineHint || input.thread.date,
    priority,
    actionKind: 'inspect',
    actions: [
      action('open', 'Open', { route: '/productivity' }),
      action('mark_read', 'Read', { requiresOnline: true, risk: 'write' }),
      action('archive', 'Archive', { requiresOnline: true, risk: 'write' }),
      action('mark_important', manuallyImportant ? 'Important' : 'Important', {
        requiresOnline: true,
        risk: 'write',
        available: !manuallyImportant,
        ...(manuallyImportant ? { reason: 'This Gmail thread is already marked important.' } : {})
      }),
      action('snooze', 'Snooze', { requiresOnline: true, risk: 'write' }),
      action('dismiss', 'Dismiss', { requiresOnline: true, risk: 'write' })
    ],
    recoverability: {
      kind: 'snapshot',
      route: '/settings',
      description: 'Attention triage state is synced; Gmail label changes can be manually changed again from Gmail.',
      reversible: true
    },
    readOnly: false,
    writable: true,
    metadata: {
      threadId: input.thread.id,
      from: input.thread.from,
      unread: input.thread.unread,
      labelIds: input.thread.labelIds,
      category: input.category,
      reason: input.reason,
      deadlineHint: input.deadlineHint
    }
  });
}

async function collectGmailItems(store: MemoryStore): Promise<SourceResult> {
  const fetchedAt = new Date().toISOString();
  const connections = connectedGoogleConnections(store);
  if (!connections.length) {
    return {
      items: [],
      source: sourceStatus({
        id: 'gmail',
        label: 'Gmail',
        status: 'unavailable',
        fetchedAt,
        error: 'No connected Google account.'
      })
    };
  }

  const results = await Promise.allSettled(
    connections.map((connection) =>
      new GoogleGmailConnector(store, connection.id).listThreads({
        q: priorityMailQuery(),
        maxResults: 20
      })
    )
  );
  const errors = results
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map((result) => describeError(result.reason));
  const threads = results
    .flatMap((result) => (result.status === 'fulfilled' ? result.value.threads : []))
    .sort((a, b) => threadTime(b) - threadTime(a));
  if (!threads.length && errors.length) {
    const error = errors[0] ?? 'Gmail failed to load.';
    return {
      items: [],
      source: sourceStatus({ id: 'gmail', label: 'Gmail', status: 'error', fetchedAt, error }),
      error: `Gmail: ${error}`
    };
  }

  const insights = await triageGmailThreads(threads, { maxResults: 10, minPriority: 65 });
  const items = insights.map((insight) =>
    gmailItem({
      thread: insight.thread,
      reason: insight.reason,
      category: insight.category,
      priority: insight.priority,
      ...(insight.deadlineHint ? { deadlineHint: insight.deadlineHint } : {})
    })
  );
  const error = errors[0];
  return {
    items,
    source: sourceStatus({
      id: 'gmail',
      label: 'Gmail',
      status: error ? 'error' : 'ok',
      fetchedAt,
      itemCount: items.length,
      ...(error ? { error } : {})
    }),
    ...(error ? { error: `Gmail: ${error}` } : {})
  };
}

function duePriority(value: string | undefined, nowMs: number, overdue: number, soon: number, later: number): number {
  const due = timeValue(value);
  if (!Number.isFinite(due)) return later;
  if (due < nowMs) return overdue;
  if (due <= nowMs + 3 * dayMs) return soon;
  if (due <= nowMs + 14 * dayMs) return Math.max(later, soon - 14);
  return later;
}

function collectCareerItems(store: MemoryStore, workspaceIds: Set<string>, now: Date): SourceResult {
  const fetchedAt = new Date().toISOString();
  const nowMs = now.getTime();
  const items: AttentionItem[] = [];
  const actions = store.careerActions
    .filter((item) => workspaceIds.has(item.workspaceId) && !item.completedAt)
    .filter((item) => !item.dueAt || timeValue(item.dueAt) <= nowMs + 14 * dayMs)
    .sort((a, b) => dateValue(a.dueAt ?? a.updatedAt) - dateValue(b.dueAt ?? b.updatedAt))
    .slice(0, 8);

  for (const item of actions) {
    items.push(
      parseAttentionItem({
        id: `career-action:${item.id}`,
        source: 'career_action',
        sourceId: item.id,
        title: item.label,
        detail: item.jobId ? 'Linked career action waiting in Career Desk.' : 'Career action waiting in Career Desk.',
        route: '/desk/career',
        dueAt: item.dueAt,
        priority: duePriority(item.dueAt, nowMs, 86, 75, 48),
        actionKind: 'complete',
        actions: [
          action('open', 'Open', { route: '/desk/career' }),
          action('complete', 'Complete', { requiresOnline: true, risk: 'write' }),
          action('snooze', 'Snooze', { requiresOnline: true, risk: 'write' }),
          action('dismiss', 'Dismiss', { requiresOnline: true, risk: 'write' })
        ],
        recoverability: {
          kind: 'snapshot',
          route: '/settings',
          description: 'Completing a career action records a synced before-state snapshot.',
          reversible: true
        },
        readOnly: false,
        writable: true,
        metadata: {
          jobId: item.jobId,
          updatedAt: item.updatedAt
        }
      })
    );
  }

  const jobs = store.jobs
    .filter((job) => workspaceIds.has(job.workspaceId))
    .filter((job) => ['lead', 'saved', 'watching', 'applied', 'interview', 'offer'].includes(job.status))
    .filter((job) => job.nextActionAt && timeValue(job.nextActionAt) <= nowMs + 14 * dayMs)
    .sort((a, b) => dateValue(a.nextActionAt ?? a.updatedAt) - dateValue(b.nextActionAt ?? b.updatedAt))
    .slice(0, 6);

  for (const job of jobs) {
    items.push(
      parseAttentionItem({
        id: `career-job:${job.id}`,
        source: 'career_job',
        sourceId: job.id,
        title: `${job.company} - ${job.role}`,
        detail: `Status: ${job.status}${job.notes ? ` - ${job.notes.slice(0, 96)}` : ''}`,
        route: '/desk/career',
        dueAt: job.nextActionAt,
        priority: duePriority(job.nextActionAt, nowMs, 80, 70, 45),
        actionKind: 'inspect',
        actions: [
          action('open', 'Open', { route: '/desk/career' }),
          action('inspect', 'Inspect', { route: '/desk/career' }),
          action('snooze', 'Snooze', { requiresOnline: true, risk: 'write' }),
          action('dismiss', 'Dismiss', { requiresOnline: true, risk: 'write' }),
          action('complete', 'Complete', {
            available: false,
            reason: 'Jobs do not have a direct complete action. Update the job status in Career Desk.',
            route: '/desk/career'
          })
        ],
        recoverability: {
          kind: 'snapshot',
          route: '/settings',
          description: 'Dismiss and snooze choices are stored in synced personal settings.',
          reversible: true
        },
        readOnly: false,
        writable: true,
        metadata: {
          status: job.status,
          applicationUrl: job.applicationUrl
        }
      })
    );
  }

  return {
    items: items.sort(compareItems).slice(0, 10),
    source: sourceStatus({
      id: 'career_action',
      label: 'Career Desk',
      status: 'ok',
      fetchedAt,
      itemCount: items.length
    })
  };
}

function collectStudyItems(store: MemoryStore, workspaceIds: Set<string>, now: Date, careerItems: AttentionItem[]): SourceResult {
  const fetchedAt = new Date().toISOString();
  const nowMs = now.getTime();
  const sessions = store.studySessions.filter((session) => workspaceIds.has(session.workspaceId));
  const recentMinutes = sessions
    .filter((session) => timeValue(session.loggedAt) >= nowMs - 7 * dayMs)
    .reduce((total, session) => total + session.minutes, 0);
  const hasStudyHistory = sessions.length > 0;
  const hasCareerFocus = careerItems.some((item) => ['career_job', 'career_action'].includes(item.source));
  const items: AttentionItem[] = [];

  if (hasCareerFocus && (hasStudyHistory || sessions.length === 0) && recentMinutes === 0) {
    items.push(
      parseAttentionItem({
        id: 'study-signal:no-recent-sessions',
        source: 'study_signal',
        sourceId: 'no-recent-sessions',
        title: 'No study logged this week',
        detail: 'Career items are active; queue a focused study block if this is still relevant.',
        route: '/desk/study',
        priority: 54,
        actionKind: 'inspect',
        actions: [
          action('open', 'Open', { route: '/desk/study' }),
          action('snooze', 'Snooze', { requiresOnline: true, risk: 'write' }),
          action('dismiss', 'Dismiss', { requiresOnline: true, risk: 'write' }),
          action('complete', 'Complete', {
            available: false,
            reason: 'Study signals are cleared by logging real study time or dismissing the signal.',
            route: '/desk/study'
          })
        ],
        recoverability: {
          kind: 'snapshot',
          route: '/settings',
          description: 'Dismiss and snooze choices are stored in synced personal settings.',
          reversible: true
        },
        readOnly: false,
        writable: true,
        metadata: {
          recentMinutes,
          sessionCount: sessions.length
        }
      })
    );
  } else if (hasCareerFocus && recentMinutes > 0 && recentMinutes < 90) {
    items.push(
      parseAttentionItem({
        id: 'study-signal:light-week',
        source: 'study_signal',
        sourceId: 'light-week',
        title: 'Light study week',
        detail: `${recentMinutes} minutes logged in the last 7 days.`,
        route: '/desk/study',
        priority: 42,
        actionKind: 'inspect',
        actions: [
          action('open', 'Open', { route: '/desk/study' }),
          action('snooze', 'Snooze', { requiresOnline: true, risk: 'write' }),
          action('dismiss', 'Dismiss', { requiresOnline: true, risk: 'write' })
        ],
        recoverability: {
          kind: 'snapshot',
          route: '/settings',
          description: 'Dismiss and snooze choices are stored in synced personal settings.',
          reversible: true
        },
        readOnly: false,
        writable: true,
        metadata: {
          recentMinutes,
          sessionCount: sessions.length
        }
      })
    );
  }

  return {
    items,
    source: sourceStatus({
      id: 'study_session',
      label: 'Study Desk',
      status: 'ok',
      fetchedAt,
      itemCount: items.length
    })
  };
}

async function fetchJsonWithTimeout(fetchImpl: FetchLike, url: URL, label: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.actionLedgerFederationTimeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: { accept: 'application/json' },
      signal: controller.signal
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${label} returned ${response.status}: ${text.slice(0, 160) || response.statusText}`);
    if (text.trimStart().startsWith('<')) throw new Error(`${label} returned HTML instead of JSON.`);
    return JSON.parse(text) as unknown;
  } finally {
    clearTimeout(timer);
  }
}

function aiJobItem(job: Record<string, unknown>): AttentionItem | null {
  const id = compactText(job.id);
  if (!id) return null;
  const status = compactText(job.status, 'unknown');
  if (!['queued', 'running', 'failed', 'cancelled'].includes(status)) return null;
  const primitive = compactText(job.primitive, 'AI job');
  const failed = status === 'failed' || status === 'cancelled';
  return parseAttentionItem({
    id: `ai-job:${id}`,
    source: 'ai_os',
    sourceId: id,
    title: `${primitive} job ${status}`,
    detail: compactText(job.error, failed ? 'AI OS job needs inspection.' : 'AI OS job is active.'),
    route: '/ai-os',
    dueAt: compactText(job.updated_at, compactText(job.created_at)) || undefined,
    priority: failed ? 84 : 64,
    status: failed ? 'blocked' : 'active',
    actionKind: 'inspect',
    actions: [action('inspect', 'Inspect', { route: '/ai-os' }), action('dismiss', 'Dismiss', { requiresOnline: true, risk: 'write' })],
    recoverability: {
      kind: 'artifact',
      referenceId: id,
      route: '/ai-os',
      description: 'AI OS job history is the inspection and recovery artifact.',
      reversible: false
    },
    readOnly: false,
    writable: true,
    metadata: job
  });
}

function aiBackupItem(backup: Record<string, unknown>): AttentionItem | null {
  if (backup.ok !== false) return null;
  const id = compactText(backup.id);
  if (!id) return null;
  return parseAttentionItem({
    id: `ai-backup:${id}`,
    source: 'ai_os',
    sourceId: id,
    title: 'AI OS backup failed',
    detail: compactText(backup.error, compactText(backup.reason, 'Backup needs inspection.')),
    route: '/ai-os',
    dueAt: compactText(backup.created_at) || undefined,
    priority: 88,
    status: 'blocked',
    actionKind: 'inspect',
    actions: [action('inspect', 'Inspect', { route: '/ai-os' }), action('dismiss', 'Dismiss', { requiresOnline: true, risk: 'write' })],
    recoverability: {
      kind: 'artifact',
      referenceId: id,
      route: '/ai-os',
      description: 'Backup records remain in AI OS for inspection.',
      reversible: false
    },
    readOnly: false,
    writable: true,
    metadata: backup
  });
}

function benchmarkItem(run: Record<string, unknown>): AttentionItem | null {
  if (run.ok !== false) return null;
  const id = compactText(run.id);
  if (!id) return null;
  return parseAttentionItem({
    id: `ai-benchmark:${id}`,
    source: 'ai_os',
    sourceId: id,
    title: 'AI benchmark failed',
    detail: compactText(run.error, 'Benchmark run needs inspection.'),
    route: '/ai-os',
    dueAt: compactText(run.created_at) || undefined,
    priority: 62,
    status: 'blocked',
    actionKind: 'inspect',
    actions: [action('inspect', 'Inspect', { route: '/ai-os' }), action('dismiss', 'Dismiss', { requiresOnline: true, risk: 'write' })],
    recoverability: {
      kind: 'artifact',
      referenceId: id,
      route: '/ai-os',
      description: 'Benchmark records remain in AI OS.',
      reversible: false
    },
    readOnly: false,
    writable: true,
    metadata: run
  });
}

async function collectAiOsItems(fetchImpl: FetchLike): Promise<SourceResult> {
  const fetchedAt = new Date().toISOString();
  const url = new URL('/api/ai/status', env.aiOsApiUrl);
  try {
    const payload = await fetchJsonWithTimeout(fetchImpl, url, 'AI OS');
    if (!isRecord(payload)) throw new Error('AI OS status response is invalid.');
    const status = payload as AiStatusPayload;
    const items = [
      ...(status.jobs ?? []).map(aiJobItem),
      ...(status.backups ?? []).map(aiBackupItem),
      ...(status.benchmark_runs ?? []).map(benchmarkItem)
    ].filter((item): item is AttentionItem => Boolean(item));
    if (status.integrity && status.integrity.ok === false) {
      items.push(
        parseAttentionItem({
          id: 'ai-os:integrity',
          source: 'ai_os',
          sourceId: 'integrity',
          title: 'AI OS integrity check needs review',
          detail: 'Database or artifact integrity reported a failure.',
          route: '/ai-os',
          priority: 90,
          status: 'blocked',
          actionKind: 'inspect',
          actions: [action('inspect', 'Inspect', { route: '/ai-os' }), action('dismiss', 'Dismiss', { requiresOnline: true, risk: 'write' })],
          recoverability: {
            kind: 'artifact',
            route: '/ai-os',
            description: 'AI OS health details identify the failed integrity checks.',
            reversible: false
          },
          readOnly: false,
          writable: true,
          metadata: status.integrity
        })
      );
    }
    return {
      items: items.sort(compareItems).slice(0, 8),
      source: sourceStatus({ id: 'ai_os', label: 'AI OS', status: 'ok', fetchedAt, itemCount: items.length })
    };
  } catch (error) {
    const message = describeError(error);
    const item = parseAttentionItem({
      id: 'service:ai-os-unavailable',
      source: 'ai_os',
      sourceId: 'service',
      title: 'AI OS is unavailable',
      detail: message,
      route: '/ai-os',
      priority: 76,
      status: 'blocked',
      actionKind: 'inspect',
      actions: [action('inspect', 'Inspect', { route: '/ai-os' }), action('dismiss', 'Dismiss', { requiresOnline: true, risk: 'write' })],
      recoverability: {
        kind: 'none',
        route: '/ai-os',
        description: 'Service availability must be restored outside the attention queue.',
        reversible: false
      },
      readOnly: false,
      writable: true,
      metadata: { error: message }
    });
    return {
      items: [item],
      source: sourceStatus({ id: 'ai_os', label: 'AI OS', status: 'error', fetchedAt, itemCount: 1, error: message }),
      error: `AI OS: ${message}`
    };
  }
}

function researchRunItem(run: Record<string, unknown>): AttentionItem | null {
  const id = compactText(run.id);
  if (!id) return null;
  const status = compactText(run.status, 'unknown');
  if (!['queued', 'running', 'paused', 'failed'].includes(status)) return null;
  const failed = status === 'failed';
  return parseAttentionItem({
    id: `research-run:${id}`,
    source: 'research',
    sourceId: id,
    title: `Research ${compactText(run.mode, 'run')} ${status}`,
    detail: compactText(run.error, compactText(run.goal, 'Research run needs inspection.')),
    route: '/research',
    dueAt: compactText(run.updated_at, compactText(run.created_at)) || undefined,
    priority: failed ? 78 : 58,
    status: failed ? 'blocked' : 'active',
    actionKind: 'inspect',
    actions: [action('inspect', 'Inspect', { route: '/research' }), action('dismiss', 'Dismiss', { requiresOnline: true, risk: 'write' })],
    recoverability: {
      kind: 'artifact',
      referenceId: id,
      route: '/research',
      description: 'Research run logs and reports are retained by AI OS.',
      reversible: false
    },
    readOnly: false,
    writable: true,
    metadata: run
  });
}

function researchMonitorItem(monitor: ResearchMonitorPayload): AttentionItem | null {
  const id = compactText(monitor.id);
  if (!id) return null;
  const status = compactText(monitor.last_status);
  const failed = status === 'failed';
  const goal = isRecord(monitor.request) ? compactText(monitor.request.goal) : '';
  return parseAttentionItem({
    id: `research-monitor:${id}`,
    source: 'research',
    sourceId: id,
    title: failed ? `${compactText(monitor.name, 'Research monitor')} failed` : `${compactText(monitor.name, 'Research monitor')} is due`,
    detail: compactText(monitor.last_error, goal || 'A saved monitor is ready to run.'),
    route: '/research',
    dueAt: compactText(monitor.last_run_at) || undefined,
    priority: failed ? 82 : 68,
    status: failed ? 'blocked' : 'active',
    actionKind: 'run',
    actions: [
      action('run', 'Run', { requiresOnline: true, risk: 'system' }),
      action('inspect', 'Inspect', { route: '/research' }),
      action('snooze', 'Snooze', { requiresOnline: true, risk: 'write' }),
      action('dismiss', 'Dismiss', { requiresOnline: true, risk: 'write' })
    ],
    recoverability: {
      kind: 'artifact',
      referenceId: id,
      route: '/research',
      description: 'Research monitor runs create persisted reports and logs.',
      reversible: false
    },
    readOnly: false,
    writable: true,
    metadata: monitor as Record<string, unknown>
  });
}

async function collectResearchItems(fetchImpl: FetchLike): Promise<SourceResult> {
  const fetchedAt = new Date().toISOString();
  try {
    const [duePayload, runsPayload] = await Promise.all([
      fetchJsonWithTimeout(fetchImpl, new URL('/api/ai/research/monitors/due?limit=10', env.aiOsApiUrl), 'Research monitors'),
      fetchJsonWithTimeout(fetchImpl, new URL('/api/ai/research/runs?limit=10', env.aiOsApiUrl), 'Research runs')
    ]);
    const due = isRecord(duePayload) && Array.isArray(duePayload.monitors) ? duePayload.monitors : [];
    const runs = isRecord(runsPayload) && Array.isArray(runsPayload.runs) ? runsPayload.runs : [];
    const items = [
      ...due.map((monitor) => researchMonitorItem(monitor as ResearchMonitorPayload)),
      ...runs.map((run) => (isRecord(run) ? researchRunItem(run) : null))
    ].filter((item): item is AttentionItem => Boolean(item));
    return {
      items: items.sort(compareItems).slice(0, 8),
      source: sourceStatus({ id: 'research', label: 'Research', status: 'ok', fetchedAt, itemCount: items.length })
    };
  } catch (error) {
    const message = describeError(error);
    return {
      items: [],
      source: sourceStatus({ id: 'research', label: 'Research', status: 'error', fetchedAt, error: message }),
      error: `Research: ${message}`
    };
  }
}

function macroRunItem(run: MacroRunPayload): AttentionItem | null {
  const id = compactText(run.id);
  if (!id) return null;
  const status = compactText(run.status);
  if (!['running', 'failed', 'blocked', 'cancelled'].includes(status)) return null;
  const failed = status !== 'running';
  return parseAttentionItem({
    id: `macro-run:${id}`,
    source: 'macro_lab',
    sourceId: id,
    title: `${compactText(run.macro_name, 'Macro')} ${status}`,
    detail: compactText(run.error, failed ? 'Macro run needs inspection.' : 'Macro is currently running.'),
    route: '/macro-lab',
    dueAt: compactText(run.finished_at, compactText(run.started_at)) || undefined,
    priority: failed ? 86 : 64,
    status: failed ? 'blocked' : 'active',
    actionKind: 'inspect',
    actions: [
      action('inspect', 'Inspect', { route: '/macro-lab' }),
      action('restore', 'Restore', {
        requiresOnline: true,
        risk: 'destructive',
        available: failed,
        reason: failed ? undefined : 'Only completed macro runs can expose restore metadata.'
      }),
      action('dismiss', 'Dismiss', { requiresOnline: true, risk: 'write' })
    ],
    recoverability: {
      kind: run.dry_run ? 'dry_run' : 'artifact',
      referenceId: id,
      route: '/macro-lab',
      description: run.dry_run ? 'Dry-run had no side effects.' : 'Macro Lab run history may include recovery metadata.',
      reversible: Boolean(run.dry_run || failed)
    },
    readOnly: false,
    writable: true,
    metadata: run as Record<string, unknown>
  });
}

async function collectMacroItems(fetchImpl: FetchLike): Promise<SourceResult> {
  const fetchedAt = new Date().toISOString();
  try {
    const [statusPayload, runsPayload] = await Promise.all([
      fetchJsonWithTimeout(fetchImpl, new URL('/api/macro-lab/status', env.macroLabApiUrl), 'Macro Lab'),
      fetchJsonWithTimeout(fetchImpl, new URL('/api/macro-lab/runs?limit=10', env.macroLabApiUrl), 'Macro Lab runs')
    ]);
    const status = isRecord(statusPayload) ? (statusPayload as MacroStatusPayload) : {};
    const runs = isRecord(runsPayload) && Array.isArray(runsPayload.runs) ? runsPayload.runs : [];
    const items = runs
      .map((run) => (isRecord(run) ? macroRunItem(run as MacroRunPayload) : null))
      .filter((item): item is AttentionItem => Boolean(item));
    if (status.engine?.panic) {
      items.unshift(
        parseAttentionItem({
          id: 'macro-lab:panic',
          source: 'macro_lab',
          sourceId: 'panic',
          title: 'Macro Lab panic is active',
          detail: 'Automation is blocked until panic state is cleared.',
          route: '/macro-lab',
          priority: 96,
          status: 'blocked',
          actionKind: 'inspect',
          actions: [action('inspect', 'Inspect', { route: '/macro-lab' }), action('dismiss', 'Dismiss', { requiresOnline: true, risk: 'write' })],
          recoverability: {
            kind: 'none',
            route: '/macro-lab',
            description: 'Panic state must be resolved in Macro Lab.',
            reversible: false
          },
          readOnly: false,
          writable: true,
          metadata: status as Record<string, unknown>
        })
      );
    } else if ((status.engine?.running ?? 0) > 0) {
      items.unshift(
        parseAttentionItem({
          id: 'macro-lab:running',
          source: 'macro_lab',
          sourceId: 'running',
          title: `${status.engine?.running ?? 0} macro run${status.engine?.running === 1 ? '' : 's'} active`,
          detail: 'Inspect Macro Lab before starting overlapping automation.',
          route: '/macro-lab',
          priority: 58,
          actionKind: 'inspect',
          actions: [action('inspect', 'Inspect', { route: '/macro-lab' }), action('dismiss', 'Dismiss', { requiresOnline: true, risk: 'write' })],
          recoverability: {
            kind: 'artifact',
            route: '/macro-lab',
            description: 'Macro Lab run history records active and completed runs.',
            reversible: false
          },
          readOnly: false,
          writable: true,
          metadata: status as Record<string, unknown>
        })
      );
    }
    return {
      items: items.sort(compareItems).slice(0, 8),
      source: sourceStatus({ id: 'macro_lab', label: 'Macro Lab', status: 'ok', fetchedAt, itemCount: items.length })
    };
  } catch (error) {
    const message = describeError(error);
    const item = parseAttentionItem({
      id: 'service:macro-lab-unavailable',
      source: 'macro_lab',
      sourceId: 'service',
      title: 'Macro Lab is unavailable',
      detail: message,
      route: '/macro-lab',
      priority: 72,
      status: 'blocked',
      actionKind: 'inspect',
      actions: [action('inspect', 'Inspect', { route: '/macro-lab' }), action('dismiss', 'Dismiss', { requiresOnline: true, risk: 'write' })],
      recoverability: {
        kind: 'none',
        route: '/macro-lab',
        description: 'Service availability must be restored outside the attention queue.',
        reversible: false
      },
      readOnly: false,
      writable: true,
      metadata: { error: message }
    });
    return {
      items: [item],
      source: sourceStatus({ id: 'macro_lab', label: 'Macro Lab', status: 'error', fetchedAt, itemCount: 1, error: message }),
      error: `Macro Lab: ${message}`
    };
  }
}

function readTriageState(store: MemoryStore): Record<string, AttentionTriageState> {
  const raw = store.settings?.preferences[attentionTriagePreferenceKey];
  if (!isRecord(raw)) return {};
  const records: Record<string, AttentionTriageState> = {};
  for (const [itemId, value] of Object.entries(raw)) {
    const parsed = attentionTriageStateSchema.safeParse(value);
    if (parsed.success && parsed.data.itemId === itemId) records[itemId] = parsed.data;
  }
  return records;
}

function manualItems(store: MemoryStore): SourceResult {
  const fetchedAt = new Date().toISOString();
  const raw = store.settings?.preferences[manualAttentionPreferenceKey];
  const values = Array.isArray(raw) ? raw : [];
  const items = values
    .filter(isRecord)
    .map((value) => {
      const route = typeof value.route === 'string' && value.route.trim() ? value.route : '/';
      return attentionItemSchema.safeParse({
        ...value,
        source: 'manual',
        route,
        actions: [
          action('open', 'Open', { route }),
          action('complete', 'Complete', { requiresOnline: true, risk: 'write' }),
          action('snooze', 'Snooze', { requiresOnline: true, risk: 'write' }),
          action('dismiss', 'Dismiss', { requiresOnline: true, risk: 'write' })
        ],
        recoverability: {
          kind: 'snapshot',
          route: '/settings',
          description: 'Manual attention items are stored in synced personal settings.',
          reversible: true
        }
      });
    })
    .filter((parsed): parsed is { success: true; data: AttentionItem } => parsed.success)
    .map((parsed) => parsed.data);
  return {
    items,
    source: sourceStatus({ id: 'manual', label: 'Manual Items', status: 'ok', fetchedAt, itemCount: items.length })
  };
}

function collectPassiveTaskItems(store: MemoryStore): SourceResult {
  const sourceStatuses = buildPassiveSourceStatuses(store);
  const fetchedAt =
    sourceStatuses
      .map((source) => source.fetchedAt)
      .filter((value): value is string => Boolean(value))
      .sort((a, b) => timeValue(b) - timeValue(a))[0] ?? new Date().toISOString();
  const firstError = sourceStatuses.find((source) => source.status === 'error')?.error;
  const allUnavailable = sourceStatuses.length > 0 && sourceStatuses.every((source) => source.status === 'unavailable');
  const items = collectPassiveAttentionItems(store);
  return {
    items,
    source: sourceStatus({
      id: 'passive_task',
      label: 'Passive Tasks',
      status: firstError ? 'error' : allUnavailable ? 'unavailable' : 'ok',
      fetchedAt,
      itemCount: items.length,
      ...(firstError ? { error: firstError } : allUnavailable ? { error: 'Passive task engine is disabled.' } : {})
    }),
    ...(firstError ? { error: `Passive Tasks: ${firstError}` } : {})
  };
}

function applyTriage(items: AttentionItem[], triage: Record<string, AttentionTriageState>, now: Date): AttentionItem[] {
  const nowMs = now.getTime();
  return items
    .map((item) => {
      const state = triage[item.id];
      if (!state) return item;
      let status = state.status ?? item.status;
      if (state.snoozedUntil) {
        const snoozedUntil = timeValue(state.snoozedUntil);
        status = Number.isFinite(snoozedUntil) && snoozedUntil > nowMs ? 'snoozed' : item.status;
      }
      return {
        ...item,
        status,
        priority: state.manuallyImportant ? Math.min(100, item.priority + 12) : item.priority,
        metadata: {
          ...item.metadata,
          triageUpdatedAt: state.updatedAt,
          snoozedUntil: state.snoozedUntil,
          manuallyImportant: state.manuallyImportant
        }
      };
    })
    .filter((item) => item.status === 'active' || item.status === 'blocked')
    .sort(compareItems);
}

async function buildAttentionSnapshot(
  store: MemoryStore,
  workspaceIds: Set<string>,
  externalFetch: FetchLike
): Promise<AttentionSnapshot> {
  const checkedAt = new Date().toISOString();
  const now = new Date();
  const errors: string[] = [];

  const career = collectCareerItems(store, workspaceIds, now);
  const study = collectStudyItems(store, workspaceIds, now, career.items);
  const manual = manualItems(store);
  const passive = collectPassiveTaskItems(store);
  const [calendar, gmail, ai, research, macro] = await Promise.all([
    collectCalendarItems(store, now),
    collectGmailItems(store),
    collectAiOsItems(externalFetch),
    collectResearchItems(externalFetch),
    collectMacroItems(externalFetch)
  ]);

  for (const result of [calendar, gmail, career, study, ai, research, macro, passive, manual]) {
    if (result.error) errors.push(result.error);
  }

  const triageState = readTriageState(store);
  const items = applyTriage(
    [calendar, gmail, career, study, ai, research, macro, passive, manual].flatMap((result) => result.items),
    triageState,
    now
  );
  const serviceHealth = sourceStatus({
    id: 'service_health',
    label: 'Mini Hub Sync',
    status: 'ok',
    fetchedAt: checkedAt,
    itemCount: 0
  });

  return attentionSnapshotSchema.parse({
    checkedAt,
    items,
    sources: [
      serviceHealth,
      calendar.source,
      gmail.source,
      career.source,
      study.source,
      ai.source,
      research.source,
      macro.source,
      passive.source,
      manual.source
    ],
    triageState,
    errors
  });
}

function updateSettingsPreferences(
  store: MemoryStore,
  update: (preferences: Record<string, unknown>) => Record<string, unknown>
): PersonalSettings {
  ensurePersonalWorkspace(store);
  const existing = store.settings ?? defaultSettings();
  const next = personalSettingsSchema.parse({
    ...existing,
    preferences: update(existing.preferences),
    workspaceId: personalWorkspaceId,
    deviceId: 'api',
    updatedAt: new Date().toISOString()
  });
  store.settings = next;
  appendSyncEvent(store, {
    workspaceId: next.workspaceId,
    entityType: 'settings',
    entityId: next.workspaceId,
    operation: 'update',
    payload: withBeforeSnapshot(next, existing, 'attention-triage'),
    deviceId: next.deviceId
  });
  return next;
}

function setTriageState(store: MemoryStore, itemId: string, patch: Partial<AttentionTriageState>): void {
  const now = new Date().toISOString();
  updateSettingsPreferences(store, (preferences) => {
    const existing = readTriageState(store);
    const current = existing[itemId];
    const next = attentionTriageStateSchema.parse({
      ...(current ?? {}),
      ...patch,
      itemId,
      updatedAt: now
    });
    return {
      ...preferences,
      [attentionTriagePreferenceKey]: {
        ...existing,
        [itemId]: next
      }
    };
  });
}

function clearTriageState(store: MemoryStore, itemId: string): void {
  updateSettingsPreferences(store, (preferences) => {
    const existing = readTriageState(store);
    const { [itemId]: _removed, ...rest } = existing;
    return {
      ...preferences,
      [attentionTriagePreferenceKey]: rest
    };
  });
}

function markCareerActionComplete(store: MemoryStore, workspaceIds: Set<string>, actionId: string): void {
  const index = store.careerActions.findIndex((actionRecord) => actionRecord.id === actionId);
  const existing = index >= 0 ? store.careerActions[index] : undefined;
  if (!existing || !workspaceIds.has(existing.workspaceId)) throw new Error('Career action not found.');
  const next = {
    ...existing,
    completedAt: new Date().toISOString(),
    deviceId: 'api',
    updatedAt: new Date().toISOString()
  };
  store.careerActions[index] = next;
  appendSyncEvent(store, {
    workspaceId: next.workspaceId,
    entityType: 'career_action',
    entityId: next.id,
    operation: 'update',
    payload: withBeforeSnapshot(next, existing, 'attention-complete'),
    deviceId: next.deviceId
  });
}

async function runResearchMonitor(fetchImpl: FetchLike, monitorId: string): Promise<void> {
  const url = new URL(`/api/ai/research/monitors/${encodeURIComponent(monitorId)}/run`, env.aiOsApiUrl);
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { accept: 'application/json' }
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Research monitor run failed with ${response.status}: ${text.slice(0, 160) || response.statusText}`);
  }
}

async function restoreMacroRun(fetchImpl: FetchLike, runId: string): Promise<void> {
  const url = new URL(`/api/macro-lab/runs/${encodeURIComponent(runId)}/restore`, env.macroLabApiUrl);
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ confirm: true })
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Macro restore failed with ${response.status}: ${text.slice(0, 160) || response.statusText}`);
  }
}

async function runPassiveAttentionTask(store: MemoryStore, externalFetch: FetchLike, itemId: string): Promise<void> {
  const cardId = itemId.slice('passive-task:'.length);
  const match = store.passiveRuns.flatMap((run) => run.cards).find((card) => card.id === cardId);
  if (!match) throw new Error('Passive task card not found.');
  await runPassiveTask(store, match.taskId, {
    externalFetch,
    force: true,
    input: { reason: 'attention-run', idle: false }
  });
}

async function performAttentionAction(input: {
  store: MemoryStore;
  workspaceIds: Set<string>;
  externalFetch: FetchLike;
  itemId: string;
  actionKind: AttentionActionKind;
  snoozedUntil?: string;
}): Promise<void> {
  const { store, workspaceIds, externalFetch, itemId, actionKind } = input;
  if (itemId.startsWith('passive-task:')) {
    const cardId = itemId.slice('passive-task:'.length);
    if (actionKind === 'snooze') {
      const snoozedUntil = input.snoozedUntil ?? new Date(Date.now() + dayMs).toISOString();
      updatePassiveCardTriage(store, cardId, 'snoozed', { snoozedUntil, reason: 'attention-snooze' });
      return;
    }
    if (actionKind === 'dismiss') {
      updatePassiveCardTriage(store, cardId, 'dismissed', { reason: 'attention-dismiss' });
      return;
    }
    if (actionKind === 'mark_important') {
      updatePassiveCardTriage(store, cardId, 'important', { reason: 'attention-important' });
      return;
    }
  }
  if (actionKind === 'snooze') {
    const snoozedUntil = input.snoozedUntil ?? new Date(Date.now() + dayMs).toISOString();
    setTriageState(store, itemId, { status: 'snoozed', snoozedUntil });
    return;
  }
  if (actionKind === 'dismiss') {
    setTriageState(store, itemId, { status: 'dismissed', dismissedAt: new Date().toISOString() });
    return;
  }
  if (actionKind === 'restore') {
    if (itemId.startsWith('macro-run:')) {
      await restoreMacroRun(externalFetch, itemId.slice('macro-run:'.length));
      setTriageState(store, itemId, { status: 'done', completedAt: new Date().toISOString() });
      return;
    }
    clearTriageState(store, itemId);
    return;
  }
  if (actionKind === 'mark_read' && itemId.startsWith('gmail:')) {
    await new GoogleGmailConnector(store).markThreadRead(itemId.slice('gmail:'.length));
    setTriageState(store, itemId, { status: 'done', completedAt: new Date().toISOString() });
    return;
  }
  if (actionKind === 'mark_important' && itemId.startsWith('gmail:')) {
    await new GoogleGmailConnector(store).modifyThread(itemId.slice('gmail:'.length), { addLabelIds: ['IMPORTANT'] });
    setTriageState(store, itemId, { manuallyImportant: true });
    return;
  }
  if (actionKind === 'archive' && itemId.startsWith('gmail:')) {
    await new GoogleGmailConnector(store).archiveThread(itemId.slice('gmail:'.length));
    setTriageState(store, itemId, { status: 'archived', archivedAt: new Date().toISOString() });
    return;
  }
  if (actionKind === 'complete') {
    if (itemId.startsWith('career-action:')) {
      markCareerActionComplete(store, workspaceIds, itemId.slice('career-action:'.length));
      setTriageState(store, itemId, { status: 'done', completedAt: new Date().toISOString() });
      return;
    }
    if (itemId.startsWith('manual:')) {
      setTriageState(store, itemId, { status: 'done', completedAt: new Date().toISOString() });
      return;
    }
  }
  if (actionKind === 'run' && itemId.startsWith('research-monitor:')) {
    await runResearchMonitor(externalFetch, itemId.slice('research-monitor:'.length));
    setTriageState(store, itemId, { status: 'done', completedAt: new Date().toISOString() });
    return;
  }
  if (actionKind === 'run' && itemId.startsWith('passive-task:')) {
    await runPassiveAttentionTask(store, externalFetch, itemId);
    clearTriageState(store, itemId);
    return;
  }
  if (actionKind === 'open' || actionKind === 'inspect') return;
  throw new Error(`Action ${actionKind} is not supported for ${itemId}.`);
}

export function attentionRoutes(store: MemoryStore, options: AttentionRouteOptions = {}): Hono<AppBindings> {
  const app = new Hono<AppBindings>();
  const externalFetch = options.externalFetch ?? fetch;

  app.get('/snapshot', async (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    ensurePersonalWorkspace(store);
    const workspaceIds = userWorkspaceIds(store, user.id);
    const snapshot = await buildAttentionSnapshot(store, workspaceIds, externalFetch);
    return c.json(snapshot);
  });

  app.post('/items/:id/actions', async (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    ensurePersonalWorkspace(store);
    const parsed = actionBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400);
    const workspaceIds = userWorkspaceIds(store, user.id);
    const itemId = c.req.param('id');
    try {
      await performAttentionAction({
        store,
        workspaceIds,
        externalFetch,
        itemId,
        actionKind: parsed.data.action,
        ...(parsed.data.snoozedUntil ? { snoozedUntil: parsed.data.snoozedUntil } : {})
      });
      const snapshot = await buildAttentionSnapshot(store, workspaceIds, externalFetch);
      return c.json({ ok: true, snapshot });
    } catch (error) {
      const message = describeError(error);
      setTriageState(store, itemId, { status: 'blocked' });
      return c.json({ error: message, blocked: { itemId, action: parsed.data.action, reason: message } }, 409);
    }
  });

  return app;
}
