import type { CalendarEvent, GmailDraft, GmailLabel, GmailMessage, GmailThread, TimelineItem } from '@mini-hub/core';
import { requestApiJsonWithTimeout } from './api';

export const productivityReadTimeoutMs = 8_000;
export const productivityOAuthTimeoutMs = 12_000;
export const productivityActionTimeoutMs = 20_000;

export interface ConnectorCatalogEntry {
  id: string;
  label: string;
  status: 'implemented' | 'planned' | 'read-only' | 'blocked';
  auth: 'oauth2' | 'ical' | 'manual';
  notes: string;
  capabilities: Array<{ id: string; label: string; access: string; status: string; reason?: string }>;
}

export interface PublicConnection {
  id: string;
  provider: string;
  accountLabel: string;
  scopes: string[];
  status: string;
  lastSyncAt?: string;
  error?: string;
  updatedAt: string;
}

export interface CalendarSummary {
  id: string;
  summary: string;
  primary?: boolean;
  timeZone?: string;
}

export interface CalendarEventDraft {
  calendarId: string;
  eventId?: string;
  title: string;
  description?: string;
  location?: string;
  start: string;
  end: string;
  timeZone: string;
  recurrence?: string[];
  reminders: {
    useDefault: boolean;
    overrides: Array<{ method: string; minutes: number }>;
  };
}

export interface GmailThreadList {
  threads: GmailThread[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

export interface GmailThreadInsight {
  thread: GmailThread;
  priority: number;
  category: 'deadline' | 'reply' | 'career' | 'school' | 'finance' | 'travel' | 'personal' | 'notification' | 'noise';
  reason: string;
  deadlineHint?: string;
  source: 'ollama' | 'heuristic';
}

export interface GmailComposeDraft {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  bodyText: string;
}

export interface GmailReplyDraft {
  threadId: string;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  bodyText: string;
}

export interface GoogleOAuthExchangeResult {
  ok: boolean;
  status: string;
  redirectUrl: string;
  message?: string;
}

function requestProductivityRead<T>(path: string): Promise<T> {
  return requestApiJsonWithTimeout<T>(path, {}, productivityReadTimeoutMs);
}

function requestProductivityOAuth<T>(path: string, init: RequestInit = {}): Promise<T> {
  return requestApiJsonWithTimeout<T>(path, init, productivityOAuthTimeoutMs);
}

function requestProductivityAction<T>(path: string, init: RequestInit = {}): Promise<T> {
  return requestApiJsonWithTimeout<T>(path, init, productivityActionTimeoutMs);
}

export async function getCatalog(): Promise<ConnectorCatalogEntry[]> {
  const result = await requestProductivityRead<{ connectors: ConnectorCatalogEntry[] }>('/api/integrations/catalog');
  return result.connectors;
}

export async function getConnections(): Promise<PublicConnection[]> {
  const result = await requestProductivityRead<{ connections: PublicConnection[] }>('/api/integrations/connections');
  return result.connections;
}

export async function getGoogleOAuthUrl(
  returnTo?: string,
  mode: 'redirect' | 'popup' = 'redirect',
  callback: 'api' | 'hub' = 'api',
  loginHint?: string
): Promise<string> {
  const params = new URLSearchParams();
  if (returnTo) params.set('returnTo', returnTo);
  if (mode !== 'redirect') params.set('mode', mode);
  if (callback !== 'api') params.set('callback', callback);
  if (loginHint) params.set('loginHint', loginHint);
  const suffix = params.toString() ? `?${params}` : '';
  const result = await requestProductivityOAuth<{ url: string }>(`/api/integrations/google/oauth/start${suffix}`, {
    headers: returnTo ? { 'X-Mini-Hub-Return-To': returnTo } : undefined
  });
  return result.url;
}

export async function exchangeGoogleOAuthCode(input: { code: string; state: string }): Promise<GoogleOAuthExchangeResult> {
  return requestProductivityOAuth<GoogleOAuthExchangeResult>('/api/integrations/google/oauth/exchange', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export async function revokeGoogle(connectionId?: string): Promise<void> {
  await requestProductivityAction<{ ok: true }>('/api/integrations/google/revoke', {
    method: 'POST',
    body: JSON.stringify(connectionId ? { connectionId } : {})
  });
}

export async function listCalendars(): Promise<CalendarSummary[]> {
  const result = await requestProductivityRead<{ calendars: CalendarSummary[] }>('/api/productivity/calendar/calendars');
  return result.calendars;
}

export async function listEvents(input: {
  calendarId: string;
  timeMin?: string;
  timeMax?: string;
  q?: string;
}): Promise<CalendarEvent[]> {
  const params = new URLSearchParams({ calendarId: input.calendarId });
  if (input.timeMin) params.set('timeMin', input.timeMin);
  if (input.timeMax) params.set('timeMax', input.timeMax);
  if (input.q) params.set('q', input.q);
  const result = await requestProductivityRead<{ events: CalendarEvent[] }>(`/api/productivity/calendar/events?${params}`);
  return result.events;
}

export async function createEvent(input: CalendarEventDraft): Promise<CalendarEvent> {
  const result = await requestProductivityAction<{ event: CalendarEvent }>('/api/productivity/calendar/events', {
    method: 'POST',
    body: JSON.stringify(input)
  });
  return result.event;
}

export async function updateEvent(input: CalendarEventDraft): Promise<CalendarEvent> {
  const result = await requestProductivityAction<{ event: CalendarEvent }>('/api/productivity/calendar/events', {
    method: 'PATCH',
    body: JSON.stringify(input)
  });
  return result.event;
}

export async function deleteEvent(calendarId: string, eventId: string): Promise<void> {
  await requestProductivityAction<{ ok: true }>('/api/productivity/calendar/events', {
    method: 'DELETE',
    body: JSON.stringify({ calendarId, eventId })
  });
}

export async function moveEvent(calendarId: string, eventId: string, destinationCalendarId: string): Promise<CalendarEvent> {
  const result = await requestProductivityAction<{ event: CalendarEvent }>('/api/productivity/calendar/events/move', {
    method: 'POST',
    body: JSON.stringify({ calendarId, eventId, destinationCalendarId })
  });
  return result.event;
}

export async function getTimeline(input: { timeMin?: string; timeMax?: string }): Promise<TimelineItem[]> {
  const params = new URLSearchParams();
  if (input.timeMin) params.set('timeMin', input.timeMin);
  if (input.timeMax) params.set('timeMax', input.timeMax);
  const result = await requestProductivityRead<{ items: TimelineItem[] }>(`/api/productivity/timeline?${params}`);
  return result.items;
}

export async function listGmailLabels(): Promise<GmailLabel[]> {
  const result = await requestProductivityRead<{ labels: GmailLabel[] }>('/api/productivity/gmail/labels');
  return result.labels;
}

export async function listGmailThreads(input: {
  q?: string;
  labelIds?: string[];
  pageToken?: string;
  maxResults?: number;
}): Promise<GmailThreadList> {
  const params = new URLSearchParams();
  if (input.q) params.set('q', input.q);
  if (input.pageToken) params.set('pageToken', input.pageToken);
  if (input.maxResults) params.set('maxResults', String(input.maxResults));
  for (const labelId of input.labelIds ?? []) params.append('labelIds', labelId);
  return requestProductivityRead<GmailThreadList>(`/api/productivity/gmail/threads?${params}`);
}

export async function listPriorityGmailThreads(input: {
  q?: string;
  labelIds?: string[];
  maxResults?: number;
}): Promise<GmailThreadInsight[]> {
  const params = new URLSearchParams();
  if (input.q) params.set('q', input.q);
  if (input.maxResults) params.set('maxResults', String(input.maxResults));
  for (const labelId of input.labelIds ?? []) params.append('labelIds', labelId);
  const result = await requestProductivityRead<{ threads: GmailThreadInsight[] }>(`/api/productivity/gmail/priority?${params}`);
  return result.threads;
}

export async function getGmailThread(threadId: string): Promise<GmailThread> {
  const result = await requestProductivityRead<{ thread: GmailThread }>(
    `/api/productivity/gmail/threads/${encodeURIComponent(threadId)}`
  );
  return result.thread;
}

export async function sendGmailMessage(input: GmailComposeDraft): Promise<GmailMessage> {
  const result = await requestProductivityAction<{ message: GmailMessage }>('/api/productivity/gmail/messages/send', {
    method: 'POST',
    body: JSON.stringify(input)
  });
  return result.message;
}

export async function createGmailDraft(input: GmailComposeDraft | GmailReplyDraft): Promise<GmailDraft> {
  const result = await requestProductivityAction<{ draft: GmailDraft }>('/api/productivity/gmail/drafts', {
    method: 'POST',
    body: JSON.stringify(input)
  });
  return result.draft;
}

export async function sendGmailDraft(draftId: string): Promise<GmailMessage> {
  const result = await requestProductivityAction<{ message: GmailMessage }>(
    `/api/productivity/gmail/drafts/${encodeURIComponent(draftId)}/send`,
    { method: 'POST' }
  );
  return result.message;
}

export async function deleteGmailDraft(draftId: string): Promise<void> {
  await requestProductivityAction<{ ok: true }>(`/api/productivity/gmail/drafts/${encodeURIComponent(draftId)}`, {
    method: 'DELETE'
  });
}

export async function replyGmailThread(input: GmailReplyDraft): Promise<GmailMessage> {
  const result = await requestProductivityAction<{ message: GmailMessage }>(
    `/api/productivity/gmail/threads/${encodeURIComponent(input.threadId)}/reply`,
    {
      method: 'POST',
      body: JSON.stringify(input)
    }
  );
  return result.message;
}

export async function modifyGmailThread(
  threadId: string,
  input: { addLabelIds?: string[]; removeLabelIds?: string[] }
): Promise<GmailThread> {
  const result = await requestProductivityAction<{ thread: GmailThread }>(
    `/api/productivity/gmail/threads/${encodeURIComponent(threadId)}/modify`,
    {
      method: 'POST',
      body: JSON.stringify(input)
    }
  );
  return result.thread;
}

export async function archiveGmailThread(threadId: string): Promise<GmailThread> {
  const result = await requestProductivityAction<{ thread: GmailThread }>(
    `/api/productivity/gmail/threads/${encodeURIComponent(threadId)}/archive`,
    { method: 'POST' }
  );
  return result.thread;
}

export async function markGmailThreadRead(threadId: string): Promise<GmailThread> {
  const result = await requestProductivityAction<{ thread: GmailThread }>(
    `/api/productivity/gmail/threads/${encodeURIComponent(threadId)}/read`,
    { method: 'POST' }
  );
  return result.thread;
}

export async function markGmailThreadUnread(threadId: string): Promise<GmailThread> {
  const result = await requestProductivityAction<{ thread: GmailThread }>(
    `/api/productivity/gmail/threads/${encodeURIComponent(threadId)}/unread`,
    { method: 'POST' }
  );
  return result.thread;
}
