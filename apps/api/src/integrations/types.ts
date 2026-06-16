import type { CalendarEvent, ConnectorCapability, ConnectorKind, TimelineItem } from '@mini-hub/core';

export interface ConnectorActionResult {
  ok: true;
  id?: string;
  url?: string;
}

export interface ConnectorCatalogEntry {
  id: ConnectorKind | 'gmail' | 'google_drive' | 'google_docs' | 'google_sheets' | 'brightspace';
  label: string;
  status: 'implemented' | 'planned' | 'read-only' | 'blocked';
  auth: 'oauth2' | 'ical' | 'manual';
  capabilities: ConnectorCapability[];
  notes: string;
}

export interface CalendarEventInput {
  calendarId: string;
  title: string;
  description?: string;
  location?: string;
  start: string;
  end: string;
  timeZone: string;
  recurrence?: string[];
  reminders?: {
    useDefault: boolean;
    overrides?: Array<{ method: string; minutes: number }>;
  };
}

export interface CalendarEventPatch extends Partial<Omit<CalendarEventInput, 'calendarId'>> {
  calendarId: string;
  eventId: string;
}

export interface CalendarConnector {
  listCalendars(): Promise<Array<{ id: string; summary: string; primary?: boolean; timeZone?: string }>>;
  listEvents(input: {
    calendarId: string;
    timeMin?: string;
    timeMax?: string;
    q?: string;
    singleEvents?: boolean;
  }): Promise<CalendarEvent[]>;
  getEvent(calendarId: string, eventId: string): Promise<CalendarEvent>;
  createEvent(input: CalendarEventInput): Promise<CalendarEvent>;
  updateEvent(input: CalendarEventPatch): Promise<CalendarEvent>;
  deleteEvent(calendarId: string, eventId: string): Promise<ConnectorActionResult>;
  moveEvent(calendarId: string, eventId: string, destinationCalendarId: string): Promise<CalendarEvent>;
  timeline(input: { timeMin?: string; timeMax?: string }): Promise<TimelineItem[]>;
}

export interface ConnectorProvider {
  catalog(): ConnectorCatalogEntry;
}
