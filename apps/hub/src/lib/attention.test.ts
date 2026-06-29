import { describe, expect, it } from 'vitest';
import type { CalendarEvent, CareerActionRecord, JobRecord, StudySession } from '@mini-hub/core';
import type { GmailThreadInsight } from './productivity-api';
import { buildAttentionItems } from './attention';

const now = new Date('2026-06-20T16:00:00.000Z');

function event(partial: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: 'event-1',
    calendarId: 'primary',
    provider: 'google',
    title: 'Interview prep',
    description: '',
    location: '',
    start: '2026-06-20T18:00:00.000Z',
    end: '2026-06-20T19:00:00.000Z',
    timeZone: 'UTC',
    status: 'confirmed',
    recurrence: [],
    reminders: { useDefault: true, overrides: [] },
    raw: {},
    ...partial
  };
}

function mail(partial: Partial<GmailThreadInsight>): GmailThreadInsight {
  return {
    priority: 78,
    category: 'reply',
    reason: 'Looks like it needs a reply.',
    source: 'heuristic',
    thread: {
      id: 'thread-1',
      historyId: '',
      snippet: '',
      labelIds: ['INBOX'],
      subject: 'Follow-up needed',
      from: 'recruiter@example.com',
      date: '2026-06-20T12:00:00.000Z',
      unread: true,
      messages: []
    },
    ...partial
  };
}

function job(partial: Partial<JobRecord>): JobRecord {
  return {
    id: 'job-1',
    workspaceId: 'personal',
    company: 'Example Co',
    role: 'Software Intern',
    status: 'lead',
    applicationUrl: '',
    notes: '',
    nextActionAt: '2026-06-21T16:00:00.000Z',
    deviceId: 'web-test',
    updatedAt: '2026-06-20T15:00:00.000Z',
    ...partial
  };
}

function action(partial: Partial<CareerActionRecord>): CareerActionRecord {
  return {
    id: 'action-1',
    workspaceId: 'personal',
    label: 'Send follow-up',
    dueAt: '2026-06-19T16:00:00.000Z',
    deviceId: 'web-test',
    updatedAt: '2026-06-18T16:00:00.000Z',
    ...partial
  };
}

function study(partial: Partial<StudySession>): StudySession {
  return {
    id: 'study-1',
    workspaceId: 'personal',
    subject: 'Algorithms',
    minutes: 60,
    source: 'manual',
    loggedAt: '2026-06-20T10:00:00.000Z',
    deviceId: 'web-test',
    updatedAt: '2026-06-20T10:00:00.000Z',
    ...partial
  };
}

describe('buildAttentionItems', () => {
  it('surfaces service and setup problems before normal work', () => {
    const items = buildAttentionItems({
      now,
      googleConnected: false,
      dashboardError: 'API did not return JSON.',
      syncStatus: 'offline-readonly',
      events: [],
      importantMail: [],
      jobs: [],
      careerActions: [],
      studySessions: []
    });

    expect(items.map((item) => item.id).slice(0, 3)).toEqual([
      'service:offline-readonly',
      'service:productivity-error',
      'setup:google'
    ]);
    expect(items.find((item) => item.id === 'service:offline-readonly')?.route).toBe('/settings#data-recovery');
    expect(items.find((item) => item.id === 'service:productivity-error')?.route).toBe('/settings#feature-wiring');
  });

  it('uses real calendar, mail, and career data to build the queue', () => {
    const items = buildAttentionItems({
      now,
      googleConnected: true,
      syncStatus: 'idle',
      events: [event({ id: 'standup' })],
      importantMail: [
        mail({
          priority: 92,
          deadlineHint: 'Friday',
          thread: { ...mail({}).thread, id: 'mail-1' }
        })
      ],
      jobs: [job({ id: 'job-soon' })],
      careerActions: [action({ id: 'overdue-action' })],
      studySessions: []
    });

    expect(items.some((item) => item.id === 'calendar:primary:standup')).toBe(true);
    expect(items.some((item) => item.id === 'mail:mail-1')).toBe(true);
    expect(items.some((item) => item.id === 'career-action:overdue-action')).toBe(true);
    expect(items.some((item) => item.id === 'study:no-recent-sessions')).toBe(true);
  });

  it('keeps normal unread mail and raw lead jobs out of the main attention queue', () => {
    const items = buildAttentionItems({
      now,
      googleConnected: true,
      syncStatus: 'idle',
      events: [],
      importantMail: [mail({ priority: 78, category: 'reply' })],
      jobs: [job({ id: 'lead-job', status: 'lead', nextActionAt: '2026-06-20T16:00:00.000Z' })],
      careerActions: [],
      studySessions: []
    });

    expect(items.some((item) => item.id === 'mail:thread-1')).toBe(false);
    expect(items.some((item) => item.id === 'job:lead-job')).toBe(false);
  });

  it('does not create a study attention item when recent study exists', () => {
    const items = buildAttentionItems({
      now,
      googleConnected: true,
      syncStatus: 'idle',
      events: [],
      importantMail: [],
      jobs: [job({ id: 'job-soon' })],
      careerActions: [],
      studySessions: [study({ minutes: 120 })]
    });

    expect(items.some((item) => item.kind === 'study')).toBe(false);
  });

  it('keeps passive calendar, passive money mail, stale jobs, and cleanup actions out of Today', () => {
    const items = buildAttentionItems({
      now,
      googleConnected: true,
      syncStatus: 'idle',
      events: [
        event({
          id: 'birthday',
          title: 'Friend Birthday',
          start: '2026-06-21',
          end: '2026-06-22',
          raw: { transparency: 'transparent' }
        })
      ],
      importantMail: [
        mail({
          priority: 92,
          category: 'finance',
          reason: 'passive account notification',
          thread: {
            ...mail({}).thread,
            id: 'zelle',
            subject: 'You received money with Zelle',
            snippet: 'You received money transfer from someone.',
            from: 'Bank <alerts@example.com>'
          }
        })
      ],
      jobs: [job({ id: 'old-lead', nextActionAt: '2026-06-01T16:00:00.000Z' })],
      careerActions: [action({ id: 'archive-sweep', label: 'Archive stale application confirmations' })],
      studySessions: []
    });

    expect(items.some((item) => item.id.includes('birthday'))).toBe(false);
    expect(items.some((item) => item.id === 'mail:zelle')).toBe(false);
    expect(items.some((item) => item.id === 'job:old-lead')).toBe(false);
    expect(items.some((item) => item.id === 'career-action:archive-sweep')).toBe(false);
  });
});
