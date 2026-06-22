import { describe, expect, it } from 'vitest';
import type { CalendarEvent, GmailThread } from '@mini-hub/core';
import { buildCalendarWeek, eventBlockStyle, summarizeEmailThread } from './productivity-view';

function event(partial: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: 'event-1',
    calendarId: 'primary',
    provider: 'google',
    title: 'Algorithms lecture',
    description: '',
    location: '',
    start: '2026-06-22T15:00:00.000Z',
    end: '2026-06-22T16:30:00.000Z',
    timeZone: 'UTC',
    status: 'confirmed',
    recurrence: [],
    reminders: { useDefault: true, overrides: [] },
    raw: {},
    ...partial
  };
}

function thread(partial: Partial<GmailThread>): GmailThread {
  return {
    id: 'thread-1',
    historyId: '',
    snippet: 'Fallback snippet',
    labelIds: ['INBOX', 'UNREAD'],
    subject: 'Course update',
    from: 'professor@example.edu',
    date: '2026-06-22T12:00:00.000Z',
    unread: true,
    messages: [
      {
        id: 'message-1',
        threadId: 'thread-1',
        labelIds: ['INBOX', 'UNREAD'],
        snippet: 'Short snippet',
        subject: 'Course update',
        from: 'professor@example.edu',
        to: 'me@example.com',
        cc: '',
        date: 'Mon, 22 Jun 2026 12:00:00 +0000',
        internalDate: '',
        messageIdHeader: '',
        references: '',
        inReplyTo: '',
        bodyText: 'The assignment deadline moved to Friday. Please review the updated rubric before section.',
        bodyHtml: '',
        headers: {}
      }
    ],
    ...partial
  };
}

describe('productivity view helpers', () => {
  it('groups real calendar events into a seven day local week', () => {
    const week = buildCalendarWeek(
      [
        event({ id: 'lecture', start: '2026-06-22T15:00:00.000Z' }),
        event({ id: 'lab', start: '2026-06-24T20:00:00.000Z' })
      ],
      new Date('2026-06-22T07:00:00.000Z'),
      new Date('2026-06-22T12:00:00.000Z')
    );

    expect(week).toHaveLength(7);
    expect(week[0]?.events.map((item) => item.id)).toEqual(['lecture']);
    expect(week[2]?.events.map((item) => item.id)).toEqual(['lab']);
    expect(week.some((day) => day.isToday)).toBe(true);
  });

  it('creates bounded event block styles for visual timelines', () => {
    const style = eventBlockStyle(event({ start: '2026-06-22T12:00:00.000Z', end: '2026-06-22T13:00:00.000Z' }));

    expect(style).toContain('--event-top:');
    expect(style).toContain('--event-height:');
  });

  it('summarizes email bodies before falling back to snippets', () => {
    expect(summarizeEmailThread(thread({}), 64)).toBe('The assignment deadline moved to Friday. Please review the up...');
    expect(summarizeEmailThread(thread({ messages: [] }))).toBe('Fallback snippet');
  });
});
