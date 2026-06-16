import type { CalendarEvent, TimelineItem } from '@mini-hub/core';
import { calendarEventSchema, personalWorkspaceId, timelineItemSchema } from '@mini-hub/core';
import { env } from '../env';
import type { MemoryStore } from '../store';
import type {
  CalendarConnector,
  CalendarEventInput,
  CalendarEventPatch,
  ConnectorActionResult,
  ConnectorCatalogEntry
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

function requireGoogleConfig(): void {
  if (!env.googleClientId || !env.googleClientSecret || !env.googleRedirectUri) {
    throw new Error('Google OAuth is not configured');
  }
}

function encodePath(value: string): string {
  return encodeURIComponent(value);
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

async function parseResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const body = text ? (JSON.parse(text) as unknown) : {};
  if (!response.ok) {
    const message =
      body && typeof body === 'object' && 'error_description' in body
        ? String((body as { error_description: unknown }).error_description)
        : body && typeof body === 'object' && 'error' in body
          ? String((body as { error: unknown }).error)
          : `Google request failed with ${response.status}`;
    throw new Error(message);
  }
  return body as T;
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
      status: 'planned',
      auth: 'oauth2',
      notes: 'OAuth scopes are requested now; message/thread/draft/label actions are the next connector adapter.',
      capabilities: [
        { id: 'gmail.read', label: 'Read/search threads and messages', access: 'read', status: 'planned' },
        { id: 'gmail.send', label: 'Compose, draft, reply, send', access: 'write', status: 'planned' },
        { id: 'gmail.actions', label: 'Label, archive, read/unread', access: 'action', status: 'planned' }
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
}

export class GoogleCalendarConnector implements CalendarConnector {
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
      throw new Error('Google connection needs reauthorization');
    }

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
    return tokenSet.accessToken;
  }

  private async google<T>(path: string, init: RequestInit = {}): Promise<T> {
    const accessToken = await this.token();
    const response = await fetch(`https://www.googleapis.com${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
        ...(init.headers ?? {})
      }
    });
    return parseResponse<T>(response);
  }

  async listCalendars(): Promise<CalendarSummary[]> {
    const result = await this.google<{ items?: Array<{ id: string; summary: string; primary?: boolean; timeZone?: string }> }>(
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
    const result = await this.google<{ items?: Array<Record<string, unknown>> }>(
      `/calendar/v3/calendars/${encodePath(input.calendarId)}/events?${params}`
    );
    return (result.items ?? []).map((event) => normalizeEvent(input.calendarId, event));
  }

  async getEvent(calendarId: string, eventId: string): Promise<CalendarEvent> {
    const event = await this.google<Record<string, unknown>>(
      `/calendar/v3/calendars/${encodePath(calendarId)}/events/${encodePath(eventId)}`
    );
    return normalizeEvent(calendarId, event);
  }

  async createEvent(input: CalendarEventInput): Promise<CalendarEvent> {
    const event = await this.google<Record<string, unknown>>(`/calendar/v3/calendars/${encodePath(input.calendarId)}/events`, {
      method: 'POST',
      body: JSON.stringify(toGoogleEvent(input))
    });
    return normalizeEvent(input.calendarId, event);
  }

  async updateEvent(input: CalendarEventPatch): Promise<CalendarEvent> {
    const event = await this.google<Record<string, unknown>>(
      `/calendar/v3/calendars/${encodePath(input.calendarId)}/events/${encodePath(input.eventId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(toGooglePatch(input))
      }
    );
    return normalizeEvent(input.calendarId, event);
  }

  async deleteEvent(calendarId: string, eventId: string): Promise<ConnectorActionResult> {
    await this.google<Record<string, unknown>>(
      `/calendar/v3/calendars/${encodePath(calendarId)}/events/${encodePath(eventId)}`,
      { method: 'DELETE' }
    );
    return { ok: true, id: eventId };
  }

  async moveEvent(calendarId: string, eventId: string, destinationCalendarId: string): Promise<CalendarEvent> {
    const event = await this.google<Record<string, unknown>>(
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
