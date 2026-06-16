import type {
  CalendarEvent,
  ConnectorCapability,
  ConnectorKind,
  GmailDraft,
  GmailLabel,
  GmailMessage,
  GmailThread,
  TimelineItem
} from '@mini-hub/core';

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

export interface GmailThreadQuery {
  q?: string;
  labelIds?: string[];
  pageToken?: string;
  maxResults?: number;
}

export interface GmailThreadList {
  threads: GmailThread[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

export interface GmailComposeInput {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  bodyText: string;
}

export interface GmailReplyInput {
  threadId: string;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  bodyText: string;
}

export interface GmailModifyInput {
  addLabelIds?: string[];
  removeLabelIds?: string[];
}

export interface GmailConnector {
  listLabels(): Promise<GmailLabel[]>;
  listThreads(input: GmailThreadQuery): Promise<GmailThreadList>;
  getThread(threadId: string): Promise<GmailThread>;
  getMessage(messageId: string): Promise<GmailMessage>;
  sendMessage(input: GmailComposeInput): Promise<GmailMessage>;
  createDraft(input: GmailComposeInput | GmailReplyInput): Promise<GmailDraft>;
  sendDraft(draftId: string): Promise<GmailMessage>;
  deleteDraft(draftId: string): Promise<ConnectorActionResult>;
  reply(input: GmailReplyInput): Promise<GmailMessage>;
  modifyThread(threadId: string, input: GmailModifyInput): Promise<GmailThread>;
  archiveThread(threadId: string): Promise<GmailThread>;
  markThreadRead(threadId: string): Promise<GmailThread>;
  markThreadUnread(threadId: string): Promise<GmailThread>;
  timeline(input: { maxResults?: number }): Promise<TimelineItem[]>;
}

export interface ConnectorProvider {
  catalog(): ConnectorCatalogEntry;
}
