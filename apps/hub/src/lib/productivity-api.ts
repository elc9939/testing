import { get } from 'svelte/store';
import type { CalendarEvent, TimelineItem } from '@mini-hub/core';
import { apiUrl } from './api';
import { clientData } from './client-data';

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

function syncHeaders(): HeadersInit {
  const { syncKey } = get(clientData);
  return {
    'content-type': 'application/json',
    'x-mini-hub-sync-key': syncKey
  };
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...syncHeaders(),
      ...(init.headers ?? {})
    }
  });
  if (!response.ok) {
    let message = `Request ${path} failed with ${response.status}`;
    try {
      const body = (await response.json()) as { error?: unknown };
      if (typeof body.error === 'string' && body.error.trim()) message = body.error;
    } catch {
      // Preserve the status-based fallback when the server did not return JSON.
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

export async function getCatalog(): Promise<ConnectorCatalogEntry[]> {
  const result = await requestJson<{ connectors: ConnectorCatalogEntry[] }>('/api/integrations/catalog');
  return result.connectors;
}

export async function getConnections(): Promise<PublicConnection[]> {
  const result = await requestJson<{ connections: PublicConnection[] }>('/api/integrations/connections');
  return result.connections;
}

export async function getGoogleOAuthUrl(): Promise<string> {
  const result = await requestJson<{ url: string }>('/api/integrations/google/oauth/start');
  return result.url;
}

export async function revokeGoogle(): Promise<void> {
  await requestJson<{ ok: true }>('/api/integrations/google/revoke', { method: 'POST' });
}

export async function listCalendars(): Promise<CalendarSummary[]> {
  const result = await requestJson<{ calendars: CalendarSummary[] }>('/api/productivity/calendar/calendars');
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
  const result = await requestJson<{ events: CalendarEvent[] }>(`/api/productivity/calendar/events?${params}`);
  return result.events;
}

export async function createEvent(input: CalendarEventDraft): Promise<CalendarEvent> {
  const result = await requestJson<{ event: CalendarEvent }>('/api/productivity/calendar/events', {
    method: 'POST',
    body: JSON.stringify(input)
  });
  return result.event;
}

export async function updateEvent(input: CalendarEventDraft): Promise<CalendarEvent> {
  const result = await requestJson<{ event: CalendarEvent }>('/api/productivity/calendar/events', {
    method: 'PATCH',
    body: JSON.stringify(input)
  });
  return result.event;
}

export async function deleteEvent(calendarId: string, eventId: string): Promise<void> {
  await requestJson<{ ok: true }>('/api/productivity/calendar/events', {
    method: 'DELETE',
    body: JSON.stringify({ calendarId, eventId })
  });
}

export async function moveEvent(calendarId: string, eventId: string, destinationCalendarId: string): Promise<CalendarEvent> {
  const result = await requestJson<{ event: CalendarEvent }>('/api/productivity/calendar/events/move', {
    method: 'POST',
    body: JSON.stringify({ calendarId, eventId, destinationCalendarId })
  });
  return result.event;
}

export async function getTimeline(input: { timeMin?: string; timeMax?: string }): Promise<TimelineItem[]> {
  const params = new URLSearchParams();
  if (input.timeMin) params.set('timeMin', input.timeMin);
  if (input.timeMax) params.set('timeMax', input.timeMax);
  const result = await requestJson<{ items: TimelineItem[] }>(`/api/productivity/timeline?${params}`);
  return result.items;
}
