import type { CalendarEvent, GmailDraft, GmailLabel, GmailMessage, GmailThread, TimelineItem } from '@mini-hub/core';
import {
  calendarEventSchema,
  gmailDraftSchema,
  gmailLabelSchema,
  gmailMessageSchema,
  gmailThreadSchema,
  personalWorkspaceId,
  timelineItemSchema
} from '@mini-hub/core';
import { env } from '../env';
import { persistIntegrationConnections, type MemoryStore } from '../store';
import type {
  CalendarConnector,
  CalendarEventInput,
  CalendarEventPatch,
  ConnectorActionResult,
  ConnectorCatalogEntry,
  GmailComposeInput,
  GmailConnector,
  GmailModifyInput,
  GmailReplyInput,
  GmailThreadList,
  GmailThreadQuery
} from './types';
import {
  createOAuthState,
  decryptTokenSet,
  encryptTokenSet,
  getConnection,
  upsertConnection,
  verifyOAuthState,
  type OAuthTokenSet
} from './token-vault';

export const googleScopes = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/spreadsheets'
];

type CalendarSummary = { id: string; summary: string; primary?: boolean; timeZone?: string };

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
}

interface GoogleUserInfo {
  email?: string;
  name?: string;
}

interface GmailApiHeader {
  name?: string;
  value?: string;
}

interface GmailApiPartBody {
  data?: string;
  size?: number;
}

interface GmailApiPart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailApiHeader[];
  body?: GmailApiPartBody;
  parts?: GmailApiPart[];
}

interface GmailApiMessage {
  id?: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailApiPart;
}

interface GmailApiThread {
  id?: string;
  historyId?: string;
  snippet?: string;
  messages?: GmailApiMessage[];
}

interface GmailApiDraft {
  id?: string;
  message?: GmailApiMessage;
}

const gmailBaseUrl = 'https://gmail.googleapis.com';

function requireGoogleConfig(): void {
  if (!env.googleClientId || !env.googleClientSecret || !env.googleRedirectUri) {
    throw new Error('Google OAuth is not configured');
  }
}

function encodePath(value: string): string {
  return encodeURIComponent(value);
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

function base64UrlDecode(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  return Buffer.from(padded, 'base64').toString('utf8');
}

function sanitizeHeader(value: string): string {
  return value.replace(/[\r\n]+/gu, ' ').trim();
}

function addressList(values: string[] | undefined): string {
  return (values ?? []).map(sanitizeHeader).filter(Boolean).join(', ');
}

function headerRecord(headers: GmailApiHeader[] | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  for (const header of headers ?? []) {
    if (!header.name || header.value === undefined) continue;
    result[header.name.toLowerCase()] = header.value;
  }
  return result;
}

function extractBodies(part: GmailApiPart | undefined): { bodyText: string; bodyHtml: string } {
  if (!part) return { bodyText: '', bodyHtml: '' };
  let bodyText = '';
  let bodyHtml = '';
  const data = part.body?.data;
  if (data && part.mimeType === 'text/plain') bodyText += base64UrlDecode(data);
  if (data && part.mimeType === 'text/html') bodyHtml += base64UrlDecode(data);
  for (const child of part.parts ?? []) {
    const extracted = extractBodies(child);
    if (extracted.bodyText) bodyText += `${bodyText ? '\n' : ''}${extracted.bodyText}`;
    if (extracted.bodyHtml) bodyHtml += extracted.bodyHtml;
  }
  return { bodyText, bodyHtml };
}

function rawMime(input: GmailComposeInput, reply?: { inReplyTo?: string; references?: string }): string {
  const headers: string[] = [];
  headers.push(`To: ${addressList(input.to)}`);
  const cc = addressList(input.cc);
  const bcc = addressList(input.bcc);
  if (cc) headers.push(`Cc: ${cc}`);
  if (bcc) headers.push(`Bcc: ${bcc}`);
  headers.push(`Subject: ${sanitizeHeader(input.subject)}`);
  if (reply?.inReplyTo) headers.push(`In-Reply-To: ${sanitizeHeader(reply.inReplyTo)}`);
  if (reply?.references) headers.push(`References: ${sanitizeHeader(reply.references)}`);
  headers.push('MIME-Version: 1.0');
  headers.push('Content-Type: text/plain; charset="UTF-8"');
  headers.push('Content-Transfer-Encoding: 8bit');
  const body = input.bodyText.replace(/\r?\n/gu, '\r\n');
  return `${headers.join('\r\n')}\r\n\r\n${body}`;
}

function normalizeGmailMessage(message: GmailApiMessage): GmailMessage {
  const headers = headerRecord(message.payload?.headers);
  const bodies = extractBodies(message.payload);
  return gmailMessageSchema.parse({
    id: String(message.id ?? ''),
    threadId: String(message.threadId ?? ''),
    labelIds: message.labelIds ?? [],
    snippet: message.snippet ?? '',
    subject: headers.subject ?? '(no subject)',
    from: headers.from ?? '',
    to: headers.to ?? '',
    cc: headers.cc ?? '',
    date: headers.date ?? '',
    internalDate: message.internalDate ?? '',
    messageIdHeader: headers['message-id'] ?? '',
    references: headers.references ?? '',
    inReplyTo: headers['in-reply-to'] ?? '',
    bodyText: bodies.bodyText,
    bodyHtml: bodies.bodyHtml,
    headers
  });
}

function normalizeGmailThread(thread: GmailApiThread): GmailThread {
  const messages = (thread.messages ?? []).map(normalizeGmailMessage);
  const first = messages[0];
  const latest = messages[messages.length - 1] ?? first;
  const labelIds = Array.from(new Set(messages.flatMap((message) => message.labelIds)));
  return gmailThreadSchema.parse({
    id: String(thread.id ?? ''),
    historyId: String(thread.historyId ?? ''),
    snippet: thread.snippet ?? first?.snippet ?? '',
    labelIds,
    subject: first?.subject ?? '(no subject)',
    from: latest?.from ?? first?.from ?? '',
    date: latest?.date ?? first?.date ?? '',
    unread: labelIds.includes('UNREAD'),
    messages
  });
}

function normalizeGmailDraft(draft: GmailApiDraft): GmailDraft {
  return gmailDraftSchema.parse({
    id: String(draft.id ?? ''),
    message: draft.message ? normalizeGmailMessage(draft.message) : undefined
  });
}

function timelineWhen(thread: GmailThread): string {
  const latest = thread.messages[thread.messages.length - 1];
  const internalDate = latest?.internalDate ? Number(latest.internalDate) : Number.NaN;
  if (Number.isFinite(internalDate)) return new Date(internalDate).toISOString();
  const parsed = latest?.date ? Date.parse(latest.date) : Number.NaN;
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}

function toGoogleEvent(input: Omit<CalendarEventInput, 'calendarId'>): Record<string, unknown> {
  return {
    summary: input.title,
    description: input.description ?? '',
    location: input.location ?? '',
    start: { dateTime: input.start, timeZone: input.timeZone },
    end: { dateTime: input.end, timeZone: input.timeZone },
    recurrence: input.recurrence?.length ? input.recurrence : undefined,
    reminders: input.reminders ?? { useDefault: true }
  };
}

function toGooglePatch(input: Partial<Omit<CalendarEventInput, 'calendarId'>>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (input.title !== undefined) patch.summary = input.title;
  if (input.description !== undefined) patch.description = input.description;
  if (input.location !== undefined) patch.location = input.location;
  if (input.start !== undefined) {
    patch.start = { dateTime: input.start, timeZone: input.timeZone };
  }
  if (input.end !== undefined) {
    patch.end = { dateTime: input.end, timeZone: input.timeZone };
  }
  if (input.recurrence !== undefined) patch.recurrence = input.recurrence.length ? input.recurrence : [];
  if (input.reminders !== undefined) patch.reminders = input.reminders;
  return patch;
}

function normalizeEvent(calendarId: string, event: Record<string, unknown>): CalendarEvent {
  const start = event.start as { dateTime?: string; date?: string; timeZone?: string } | undefined;
  const end = event.end as { dateTime?: string; date?: string; timeZone?: string } | undefined;
  return calendarEventSchema.parse({
    id: String(event.id ?? ''),
    calendarId,
    provider: 'google',
    title: String(event.summary ?? 'Untitled event'),
    description: String(event.description ?? ''),
    location: String(event.location ?? ''),
    start: start?.dateTime ?? start?.date ?? '',
    end: end?.dateTime ?? end?.date ?? '',
    timeZone: start?.timeZone ?? end?.timeZone ?? 'UTC',
    status: String(event.status ?? 'confirmed'),
    htmlLink: typeof event.htmlLink === 'string' ? event.htmlLink : undefined,
    recurringEventId: typeof event.recurringEventId === 'string' ? event.recurringEventId : undefined,
    recurrence: Array.isArray(event.recurrence) ? event.recurrence : [],
    reminders:
      event.reminders && typeof event.reminders === 'object'
        ? event.reminders
        : { useDefault: true, overrides: [] },
    raw: event
  });
}

export async function parseResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const body = text ? (JSON.parse(text) as unknown) : {};
  if (!response.ok) {
    const message =
      body && typeof body === 'object' && 'error_description' in body
        ? String((body as { error_description: unknown }).error_description)
        : body && typeof body === 'object' && 'error' in body
          ? typeof (body as { error: unknown }).error === 'object' &&
            (body as { error: { message?: unknown } }).error?.message
            ? String((body as { error: { message: unknown } }).error.message)
            : String((body as { error: unknown }).error)
          : `Google request failed with ${response.status}`;
    throw new Error(message);
  }
  return body as T;
}

export class GoogleApiClient {
  constructor(private readonly store: MemoryStore) {}

  private async token(): Promise<string> {
    const connection = getConnection(this.store, 'google');
    if (!connection || connection.status !== 'connected') throw new Error('Google is not connected');
    let tokenSet = decryptTokenSet(connection.encryptedTokenSet);
    const expiresAt = tokenSet.expiresAt ? Date.parse(tokenSet.expiresAt) : 0;
    if (expiresAt && expiresAt > Date.now() + 60_000) return tokenSet.accessToken;
    if (!tokenSet.refreshToken) {
      this.store.integrationConnections.set(connection.id, {
        ...connection,
        status: 'needs_reauth',
        error: 'Missing refresh token',
        updatedAt: new Date().toISOString()
      });
      persistIntegrationConnections(this.store);
      throw new Error('Google connection needs reauthorization');
    }

    requireGoogleConfig();
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.googleClientId ?? '',
        client_secret: env.googleClientSecret ?? '',
        refresh_token: tokenSet.refreshToken,
        grant_type: 'refresh_token'
      })
    });
    const body = await parseResponse<GoogleTokenResponse>(response);
    const refreshedTokenSet: OAuthTokenSet = {
      ...tokenSet,
      accessToken: body.access_token
    };
    if (body.expires_in !== undefined) {
      refreshedTokenSet.expiresAt = new Date(Date.now() + body.expires_in * 1000).toISOString();
    }
    if (body.scope !== undefined) refreshedTokenSet.scope = body.scope;
    if (body.token_type !== undefined) refreshedTokenSet.tokenType = body.token_type;
    tokenSet = refreshedTokenSet;
    this.store.integrationConnections.set(connection.id, {
      ...connection,
      encryptedTokenSet: encryptTokenSet(tokenSet),
      status: 'connected',
      error: undefined,
      updatedAt: new Date().toISOString()
    });
    persistIntegrationConnections(this.store);
    return tokenSet.accessToken;
  }

  async request<T>(path: string, init: RequestInit = {}, baseUrl = 'https://www.googleapis.com'): Promise<T> {
    const accessToken = await this.token();
    const url = path.startsWith('https://') ? path : `${baseUrl}${path}`;
    const response = await fetch(url, {
      ...init,
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
        ...(init.headers ?? {})
      }
    });
    return parseResponse<T>(response);
  }
}

export function googleCatalog(): ConnectorCatalogEntry[] {
  return [
    {
      id: 'google',
      label: 'Google Calendar',
      status: 'implemented',
      auth: 'oauth2',
      notes: 'Implemented end-to-end with OAuth, token refresh, list/view/create/update/delete/move, reminders, recurrence pass-through, and IANA timezones.',
      capabilities: [
        { id: 'calendar.list', label: 'List calendars and events', access: 'read', status: 'implemented' },
        { id: 'calendar.write', label: 'Create/edit/delete/move events', access: 'write', status: 'implemented' },
        { id: 'calendar.reminders', label: 'Set reminders', access: 'action', status: 'implemented' }
      ]
    },
    {
      id: 'gmail',
      label: 'Gmail',
      status: 'implemented',
      auth: 'oauth2',
      notes: 'Implemented with thread search/read, full message normalization, compose/reply, drafts, send, labels, archive, and read/unread actions.',
      capabilities: [
        { id: 'gmail.read', label: 'Read/search threads and messages', access: 'read', status: 'implemented' },
        { id: 'gmail.send', label: 'Compose, draft, reply, send', access: 'write', status: 'implemented' },
        { id: 'gmail.actions', label: 'Label, archive, read/unread', access: 'action', status: 'implemented' }
      ]
    },
    {
      id: 'google_drive',
      label: 'Google Drive / Docs / Sheets',
      status: 'planned',
      auth: 'oauth2',
      notes: 'OAuth scopes are requested now; file browse/search/create/rename and Docs/Sheets content actions are adapter-ready.',
      capabilities: [
        { id: 'drive.files', label: 'Browse/search/create/rename files', access: 'write', status: 'planned' },
        { id: 'docs.edit', label: 'Read and batch-update Docs', access: 'write', status: 'planned' },
        { id: 'sheets.edit', label: 'Read and update spreadsheet values', access: 'write', status: 'planned' }
      ]
    },
    {
      id: 'brightspace',
      label: 'Brightspace / D2L',
      status: env.brightspaceBaseUrl ? 'planned' : 'read-only',
      auth: env.brightspaceBaseUrl ? 'oauth2' : 'ical',
      notes: 'Valence OAuth depends on institution app/scopes. If unavailable to a student account, use the Brightspace iCal feed as read-only deadline ingestion.',
      capabilities: [
        { id: 'brightspace.courses', label: 'Course list', access: 'read', status: 'planned' },
        { id: 'brightspace.grades', label: 'Grades', access: 'read', status: 'planned' },
        {
          id: 'brightspace.deadlines',
          label: 'Deadlines via Valence calendar or iCal',
          access: 'read',
          status: env.brightspaceIcalUrl ? 'read-only' : 'planned',
          reason: 'Student accounts commonly lack write permission for LMS-managed due dates.'
        }
      ]
    }
  ];
}

export function googleAuthUrl(): string {
  requireGoogleConfig();
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', env.googleClientId ?? '');
  url.searchParams.set('redirect_uri', env.googleRedirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', googleScopes.join(' '));
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('state', createOAuthState('google'));
  return url.toString();
}

export async function handleGoogleCallback(store: MemoryStore, code: string, stateValue: string): Promise<void> {
  requireGoogleConfig();
  const state = verifyOAuthState(stateValue, 'google');
  const params = new URLSearchParams({
    code,
    client_id: env.googleClientId ?? '',
    client_secret: env.googleClientSecret ?? '',
    redirect_uri: env.googleRedirectUri,
    grant_type: 'authorization_code'
  });
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: params
  });
  const tokenBody = await parseResponse<GoogleTokenResponse>(tokenResponse);
  const expiresAt = tokenBody.expires_in
    ? new Date(Date.now() + tokenBody.expires_in * 1000).toISOString()
    : undefined;
  const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { authorization: `Bearer ${tokenBody.access_token}` }
  });
  const userInfo = await parseResponse<GoogleUserInfo>(userInfoResponse);
  const tokenSet: OAuthTokenSet = {
    accessToken: tokenBody.access_token
  };
  if (tokenBody.refresh_token !== undefined) tokenSet.refreshToken = tokenBody.refresh_token;
  if (expiresAt !== undefined) tokenSet.expiresAt = expiresAt;
  if (tokenBody.scope !== undefined) tokenSet.scope = tokenBody.scope;
  if (tokenBody.token_type !== undefined) tokenSet.tokenType = tokenBody.token_type;

  upsertConnection(store, {
    workspaceId: state.workspaceId,
    provider: 'google',
    accountLabel: userInfo.email ?? userInfo.name ?? 'Google Account',
    scopes: (tokenBody.scope ?? googleScopes.join(' ')).split(' ').filter(Boolean),
    encryptedTokenSet: encryptTokenSet(tokenSet),
    status: 'connected'
  });
}

export async function revokeGoogleConnection(store: MemoryStore): Promise<void> {
  const connection = getConnection(store, 'google');
  if (!connection) return;
  const tokenSet = decryptTokenSet(connection.encryptedTokenSet);
  const token = tokenSet.refreshToken ?? tokenSet.accessToken;
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' }
  });
  store.integrationConnections.set(connection.id, {
    ...connection,
    status: 'revoked',
    updatedAt: new Date().toISOString()
  });
  persistIntegrationConnections(store);
}

export class GoogleCalendarConnector implements CalendarConnector {
  private readonly googleClient: GoogleApiClient;

  constructor(store: MemoryStore) {
    this.googleClient = new GoogleApiClient(store);
  }

  async listCalendars(): Promise<CalendarSummary[]> {
    const result = await this.googleClient.request<{ items?: Array<{ id: string; summary: string; primary?: boolean; timeZone?: string }> }>(
      '/calendar/v3/users/me/calendarList'
    );
    return (result.items ?? []).map((calendar) => {
      const summary: CalendarSummary = {
        id: calendar.id,
        summary: calendar.summary
      };
      if (calendar.primary !== undefined) summary.primary = calendar.primary;
      if (calendar.timeZone !== undefined) summary.timeZone = calendar.timeZone;
      return summary;
    });
  }

  async listEvents(input: {
    calendarId: string;
    timeMin?: string;
    timeMax?: string;
    q?: string;
    singleEvents?: boolean;
  }): Promise<CalendarEvent[]> {
    const params = new URLSearchParams();
    if (input.timeMin) params.set('timeMin', input.timeMin);
    if (input.timeMax) params.set('timeMax', input.timeMax);
    if (input.q) params.set('q', input.q);
    params.set('singleEvents', String(input.singleEvents ?? true));
    params.set('orderBy', 'startTime');
    const result = await this.googleClient.request<{ items?: Array<Record<string, unknown>> }>(
      `/calendar/v3/calendars/${encodePath(input.calendarId)}/events?${params}`
    );
    return (result.items ?? []).map((event) => normalizeEvent(input.calendarId, event));
  }

  async getEvent(calendarId: string, eventId: string): Promise<CalendarEvent> {
    const event = await this.googleClient.request<Record<string, unknown>>(
      `/calendar/v3/calendars/${encodePath(calendarId)}/events/${encodePath(eventId)}`
    );
    return normalizeEvent(calendarId, event);
  }

  async createEvent(input: CalendarEventInput): Promise<CalendarEvent> {
    const event = await this.googleClient.request<Record<string, unknown>>(`/calendar/v3/calendars/${encodePath(input.calendarId)}/events`, {
      method: 'POST',
      body: JSON.stringify(toGoogleEvent(input))
    });
    return normalizeEvent(input.calendarId, event);
  }

  async updateEvent(input: CalendarEventPatch): Promise<CalendarEvent> {
    const event = await this.googleClient.request<Record<string, unknown>>(
      `/calendar/v3/calendars/${encodePath(input.calendarId)}/events/${encodePath(input.eventId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(toGooglePatch(input))
      }
    );
    return normalizeEvent(input.calendarId, event);
  }

  async deleteEvent(calendarId: string, eventId: string): Promise<ConnectorActionResult> {
    await this.googleClient.request<Record<string, unknown>>(
      `/calendar/v3/calendars/${encodePath(calendarId)}/events/${encodePath(eventId)}`,
      { method: 'DELETE' }
    );
    return { ok: true, id: eventId };
  }

  async moveEvent(calendarId: string, eventId: string, destinationCalendarId: string): Promise<CalendarEvent> {
    const event = await this.googleClient.request<Record<string, unknown>>(
      `/calendar/v3/calendars/${encodePath(calendarId)}/events/${encodePath(eventId)}/move?destination=${encodePath(destinationCalendarId)}`,
      { method: 'POST' }
    );
    return normalizeEvent(destinationCalendarId, event);
  }

  async timeline(input: { timeMin?: string; timeMax?: string }): Promise<TimelineItem[]> {
    const calendars = await this.listCalendars();
    const primary = calendars.find((calendar) => calendar.primary) ?? calendars[0];
    if (!primary) return [];
    const query: { calendarId: string; timeMin?: string; timeMax?: string } = { calendarId: primary.id };
    if (input.timeMin !== undefined) query.timeMin = input.timeMin;
    if (input.timeMax !== undefined) query.timeMax = input.timeMax;
    const events = await this.listEvents(query);
    return events.map((event) =>
      timelineItemSchema.parse({
        id: `google:${event.calendarId}:${event.id}`,
        source: 'google_calendar',
        sourceId: event.id,
        kind: 'event',
        title: event.title,
        when: event.start,
        end: event.end,
        timeZone: event.timeZone,
        actionUrl: event.htmlLink,
        canEdit: true,
        canComplete: false,
        metadata: {
          calendarId: event.calendarId,
          status: event.status,
          recurringEventId: event.recurringEventId
        }
      })
    );
  }
}

export class GoogleGmailConnector implements GmailConnector {
  private readonly googleClient: GoogleApiClient;

  constructor(store: MemoryStore) {
    this.googleClient = new GoogleApiClient(store);
  }

  private gmail<T>(path: string, init: RequestInit = {}): Promise<T> {
    return this.googleClient.request<T>(`/gmail/v1/users/me${path}`, init, gmailBaseUrl);
  }

  private async sendRaw(raw: string, threadId?: string): Promise<GmailMessage> {
    const message: { raw: string; threadId?: string } = { raw: base64UrlEncode(raw) };
    if (threadId !== undefined) message.threadId = threadId;
    const result = await this.gmail<GmailApiMessage>('/messages/send', {
      method: 'POST',
      body: JSON.stringify(message)
    });
    return this.getMessage(String(result.id ?? ''));
  }

  private async replyDraft(input: GmailReplyInput): Promise<{ raw: string; threadId: string }> {
    const thread = await this.getThread(input.threadId);
    const latest = thread.messages[thread.messages.length - 1];
    if (!latest) throw new Error('Cannot reply to an empty Gmail thread');
    const to = input.to?.length ? input.to : [latest.headers['reply-to'] || latest.from];
    const subject = latest.subject.toLowerCase().startsWith('re:') ? latest.subject : `Re: ${latest.subject}`;
    const references = [latest.references, latest.messageIdHeader].filter(Boolean).join(' ');
    const compose: GmailComposeInput = {
      to,
      subject,
      bodyText: input.bodyText
    };
    if (input.cc?.length) compose.cc = input.cc;
    if (input.bcc?.length) compose.bcc = input.bcc;
    return {
      threadId: thread.id,
      raw: rawMime(
        compose,
        {
          inReplyTo: latest.messageIdHeader || latest.inReplyTo,
          references
        }
      )
    };
  }

  async listLabels(): Promise<GmailLabel[]> {
    const result = await this.gmail<{ labels?: Array<Record<string, unknown>> }>('/labels');
    return (result.labels ?? []).map((label) =>
      gmailLabelSchema.parse({
        id: String(label.id ?? ''),
        name: String(label.name ?? ''),
        type: String(label.type ?? 'user'),
        messageListVisibility:
          typeof label.messageListVisibility === 'string' ? label.messageListVisibility : undefined,
        labelListVisibility: typeof label.labelListVisibility === 'string' ? label.labelListVisibility : undefined
      })
    );
  }

  async listThreads(input: GmailThreadQuery): Promise<GmailThreadList> {
    const params = new URLSearchParams();
    if (input.q) params.set('q', input.q);
    if (input.pageToken) params.set('pageToken', input.pageToken);
    params.set('maxResults', String(Math.min(Math.max(input.maxResults ?? 10, 1), 25)));
    for (const labelId of input.labelIds ?? []) params.append('labelIds', labelId);
    const result = await this.gmail<{
      threads?: Array<{ id?: string }>;
      nextPageToken?: string;
      resultSizeEstimate?: number;
    }>(`/threads?${params}`);
    const ids = (result.threads ?? []).map((thread) => thread.id).filter((id): id is string => Boolean(id));
    const threads = await Promise.all(ids.map((id) => this.getThread(id)));
    const list: GmailThreadList = { threads };
    if (result.nextPageToken !== undefined) list.nextPageToken = result.nextPageToken;
    if (result.resultSizeEstimate !== undefined) list.resultSizeEstimate = result.resultSizeEstimate;
    return list;
  }

  async getThread(threadId: string): Promise<GmailThread> {
    const params = new URLSearchParams({ format: 'full' });
    const thread = await this.gmail<GmailApiThread>(`/threads/${encodePath(threadId)}?${params}`);
    return normalizeGmailThread(thread);
  }

  async getMessage(messageId: string): Promise<GmailMessage> {
    const params = new URLSearchParams({ format: 'full' });
    const message = await this.gmail<GmailApiMessage>(`/messages/${encodePath(messageId)}?${params}`);
    return normalizeGmailMessage(message);
  }

  async sendMessage(input: GmailComposeInput): Promise<GmailMessage> {
    return this.sendRaw(rawMime(input));
  }

  async createDraft(input: GmailComposeInput | GmailReplyInput): Promise<GmailDraft> {
    const draft =
      'threadId' in input
        ? await this.replyDraft(input)
        : {
            raw: rawMime(input),
            threadId: undefined
          };
    const message: { raw: string; threadId?: string } = { raw: base64UrlEncode(draft.raw) };
    if (draft.threadId !== undefined) message.threadId = draft.threadId;
    const result = await this.gmail<GmailApiDraft>('/drafts', {
      method: 'POST',
      body: JSON.stringify({ message })
    });
    return normalizeGmailDraft(result);
  }

  async sendDraft(draftId: string): Promise<GmailMessage> {
    const result = await this.gmail<GmailApiMessage>(`/drafts/${encodePath(draftId)}/send`, {
      method: 'POST',
      body: JSON.stringify({ id: draftId })
    });
    return this.getMessage(String(result.id ?? ''));
  }

  async deleteDraft(draftId: string): Promise<ConnectorActionResult> {
    await this.gmail<Record<string, unknown>>(`/drafts/${encodePath(draftId)}`, { method: 'DELETE' });
    return { ok: true, id: draftId };
  }

  async reply(input: GmailReplyInput): Promise<GmailMessage> {
    const draft = await this.replyDraft(input);
    return this.sendRaw(draft.raw, draft.threadId);
  }

  async modifyThread(threadId: string, input: GmailModifyInput): Promise<GmailThread> {
    await this.gmail<GmailApiThread>(`/threads/${encodePath(threadId)}/modify`, {
      method: 'POST',
      body: JSON.stringify({
        addLabelIds: input.addLabelIds ?? [],
        removeLabelIds: input.removeLabelIds ?? []
      })
    });
    return this.getThread(threadId);
  }

  archiveThread(threadId: string): Promise<GmailThread> {
    return this.modifyThread(threadId, { removeLabelIds: ['INBOX'] });
  }

  markThreadRead(threadId: string): Promise<GmailThread> {
    return this.modifyThread(threadId, { removeLabelIds: ['UNREAD'] });
  }

  markThreadUnread(threadId: string): Promise<GmailThread> {
    return this.modifyThread(threadId, { addLabelIds: ['UNREAD'] });
  }

  async timeline(input: { maxResults?: number }): Promise<TimelineItem[]> {
    const result = await this.listThreads({
      q: 'in:inbox newer_than:30d (deadline OR due OR "action required" OR "please reply")',
      maxResults: input.maxResults ?? 5
    });
    return result.threads.map((thread) =>
      timelineItemSchema.parse({
        id: `gmail:${thread.id}`,
        source: 'gmail',
        sourceId: thread.id,
        kind: 'email_action',
        title: thread.subject,
        when: timelineWhen(thread),
        timeZone: 'UTC',
        actionUrl: `https://mail.google.com/mail/u/0/#inbox/${thread.id}`,
        canEdit: true,
        canComplete: true,
        metadata: {
          from: thread.from,
          unread: thread.unread,
          labels: thread.labelIds
        }
      })
    );
  }
}
