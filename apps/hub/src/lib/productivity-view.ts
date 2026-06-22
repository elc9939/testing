import type { CalendarEvent, GmailThread } from '@mini-hub/core';

const dayMs = 24 * 60 * 60 * 1000;

export interface CalendarDayBucket {
  key: string;
  label: string;
  dateLabel: string;
  isToday: boolean;
  events: CalendarEvent[];
}

export function startOfLocalDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

export function addDays(value: Date, days: number): Date {
  const next = startOfLocalDay(value);
  next.setDate(next.getDate() + days);
  return next;
}

export function localDateKey(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function eventDateKey(event: CalendarEvent): string {
  if (/^\d{4}-\d{2}-\d{2}$/u.test(event.start)) return event.start;
  return localDateKey(new Date(event.start));
}

export function buildCalendarWeek(events: CalendarEvent[], cursor: Date, now = new Date()): CalendarDayBucket[] {
  const start = startOfLocalDay(cursor);
  const todayKey = localDateKey(now);
  return Array.from({ length: 7 }, (_, index) => {
    const date = addDays(start, index);
    const key = localDateKey(date);
    return {
      key,
      label: new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(date),
      dateLabel: new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date),
      isToday: key === todayKey,
      events: events.filter((event) => eventDateKey(event) === key)
    };
  });
}

export function eventStartMinutes(event: CalendarEvent): number {
  if (!event.start.includes('T')) return 0;
  const date = new Date(event.start);
  if (Number.isNaN(date.getTime())) return 0;
  return date.getHours() * 60 + date.getMinutes();
}

export function eventDurationMinutes(event: CalendarEvent): number {
  if (!event.start.includes('T')) return 24 * 60;
  const start = Date.parse(event.start);
  const end = Date.parse(event.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 45;
  return Math.max(20, Math.round((end - start) / 60_000));
}

export function eventBlockStyle(event: CalendarEvent): string {
  const top = Math.max(0, Math.min(94, (eventStartMinutes(event) / (24 * 60)) * 100));
  const height = Math.max(7, Math.min(42, (eventDurationMinutes(event) / (24 * 60)) * 100));
  return `--event-top: ${top.toFixed(2)}%; --event-height: ${height.toFixed(2)}%;`;
}

export function summarizeEmailThread(thread: GmailThread, maxLength = 220): string {
  const latest = thread.messages[thread.messages.length - 1];
  const source = latest?.bodyText || latest?.snippet || thread.snippet || '';
  const withoutQuotedTail = source.split(/\nOn .+ wrote:\n/u)[0] ?? source;
  const normalized = withoutQuotedTail
    .replace(/https?:\/\/\S+/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
  if (!normalized) return 'No message preview available.';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}
