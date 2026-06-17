import { describe, expect, it } from 'vitest';
import { legacyStorageKeys } from '@mini-hub/core';
import { createLegacyEntityImport, inspectLegacyStorage } from './migration';

function storageFrom(values: Record<string, string>): Pick<Storage, 'getItem' | 'key' | 'length'> {
  const keys = Object.keys(values);
  return {
    getItem: (key: string) => values[key] ?? null,
    key: (index: number) => keys[index] ?? null,
    length: keys.length
  };
}

describe('legacy storage migration', () => {
  it('counts the actual legacy Study Desk daily map and session list', () => {
    const storage = storageFrom({
      [legacyStorageKeys.studyState]: JSON.stringify({
        sessions: [
          { id: 'study-a', track: 'examP', minutes: 30, notes: 'Bayes', date: '2026-06-01' },
          { id: 'study-b', track: 'coding', minutes: 45, notes: 'Trees', date: '2026-06-02' }
        ],
        daily: {
          '2026-06-01': { careerActions: [{ kind: 'Apply', at: '2026-06-01T15:00:00.000Z' }] },
          '2026-06-02': { careerActions: [] }
        }
      })
    });

    expect(inspectLegacyStorage(storage)).toMatchObject({
      studyDays: 2,
      studySessions: 2,
      studyCareerActions: 1
    });
  });

  it('imports legacy shell high scores, recent apps, theme, and Stick Arena map state', () => {
    const storage = storageFrom({
      [legacyStorageKeys.theme]: 'dark',
      [legacyStorageKeys.highScores]: JSON.stringify({ snake: 17 }),
      [legacyStorageKeys.recentState]: JSON.stringify(['study-desk', 'stickrun']),
      [legacyStorageKeys.stickArenaMap]: 'forest',
      arcade_twenty48: '4096',
      arcade_ttt_w: '3'
    });

    expect(inspectLegacyStorage(storage)).toMatchObject({
      highScoreGames: 3,
      hasTheme: true,
      hasStickArenaMap: true
    });

    const result = createLegacyEntityImport(storage, {
      workspaceId: 'personal',
      deviceId: 'web:test',
      importedAt: '2026-06-04T00:00:00.000Z'
    });

    expect(result.theme).toBe('dark');
    expect(result.highScores).toEqual({
      snake: 17,
      twenty48: 4096,
      ttt_w: 3
    });
    expect(result.recentState).toEqual({ legacyRecents: ['study-desk', 'stickrun'] });
    expect(result.gameStates).toEqual([
      {
        gameId: 'stick-arena-lab',
        state: {
          legacySelectedMap: 'forest',
          selectedMap: 'forest',
          source: 'legacy-stick-arena'
        }
      }
    ]);
    expect(result.snapshot).toMatchObject({
      [legacyStorageKeys.recentState]: JSON.stringify(['study-desk', 'stickrun']),
      [legacyStorageKeys.stickArenaMap]: 'forest',
      arcade_twenty48: '4096',
      arcade_ttt_w: '3'
    });
    expect(result.linkedState).toMatchObject({
      legacyShell: {
        theme: 'dark',
        highScores: { twenty48: 4096 },
        recentState: { legacyRecents: ['study-desk', 'stickrun'] }
      },
      stickArena: {
        selectedMap: 'forest',
        gameStateLinked: true
      }
    });
  });

  it('converts Career and Study records into synced Mini Hub entities with stable ids', () => {
    const storage = storageFrom({
      [legacyStorageKeys.careerJobs]: JSON.stringify([
        {
          id: 'job-a',
          company: 'Acme',
          title: 'Quant Analyst',
          stage: 'interviewing',
          priority: 'High',
          location: 'New York',
          link: 'https://example.com/job',
          nextAction: 'Prep probability questions',
          nextActionDate: '2026-07-01',
          dateApplied: '2026-06-05',
          notes: 'Good fit',
          history: [{ at: '2026-06-01T12:00:00.000Z', text: 'Created' }],
          updatedAt: '2026-06-02T12:00:00.000Z'
        }
      ]),
      [legacyStorageKeys.studyState]: JSON.stringify({
        sessions: [{ id: 'study-a', track: 'quant', minutes: 50, notes: 'EV drills', createdAt: '2026-06-03T10:00:00.000Z' }],
        daily: {
          '2026-06-04': {
            careerActions: [{ id: 'career-a', kind: 'Apply', notes: 'Submitted Acme follow-up', at: '2026-06-04T18:30:00.000Z' }]
          }
        },
        settings: { examDate: '2026-09-01', weeklyGoal: 600 },
        topics: { examP: [{ id: 'bayes', title: 'Bayes', done: true, updatedAt: '2026-06-04T00:00:00.000Z' }] },
        github: { repo: 'elc9939/neetcode-submissions', submissions: 42 }
      })
    });

    const result = createLegacyEntityImport(storage, {
      workspaceId: 'personal',
      deviceId: 'web:test',
      importedAt: '2026-06-04T00:00:00.000Z'
    });

    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]).toMatchObject({
      id: 'legacy-career-job:job-a',
      company: 'Acme',
      role: 'Quant Analyst',
      status: 'interview',
      nextActionAt: '2026-07-01'
    });
    expect(result.jobs[0]?.notes).toContain('Legacy Career Desk details');
    expect(result.jobs[0]?.notes).toContain('Link: https://example.com/job');

    expect(result.studySessions).toHaveLength(1);
    expect(result.studySessions[0]).toMatchObject({
      id: 'legacy-study-session:study-a',
      subject: 'Quant Prep: EV drills',
      minutes: 50,
      source: 'legacy-study-desk:quant',
      loggedAt: '2026-06-03T10:00:00.000Z'
    });

    expect(result.careerActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'legacy-study-career-action:2026-06-04:career-a',
          label: 'Apply: Submitted Acme follow-up',
          completedAt: '2026-06-04T18:30:00.000Z'
        }),
        expect.objectContaining({
          id: 'legacy-career-action:applied:job-a',
          jobId: 'legacy-career-job:job-a',
          label: 'Applied: Quant Analyst at Acme',
          completedAt: '2026-06-05T12:00:00.000Z'
        }),
        expect.objectContaining({
          id: 'legacy-career-action:next:job-a',
          jobId: 'legacy-career-job:job-a',
          label: 'Next: Prep probability questions',
          dueAt: '2026-07-01T12:00:00.000Z'
        }),
        expect.objectContaining({
          id: 'legacy-career-action:history:job-a:1:2026-06-01T12:00:00.000Z',
          jobId: 'legacy-career-job:job-a',
          label: 'Created',
          completedAt: '2026-06-01T12:00:00.000Z'
        })
      ])
    );
    expect(result.linkedState).toMatchObject({
      careerDesk: {
        jobs: [
          expect.objectContaining({
            id: 'legacy-career-job:job-a',
            legacyId: 'job-a',
            title: 'Quant Analyst',
            company: 'Acme',
            priority: 'High',
            link: 'https://example.com/job',
            historyCount: 1
          })
        ]
      },
      studyDesk: {
        settings: { examDate: '2026-09-01', weeklyGoal: 600 },
        github: { submissions: 42 }
      }
    });
  });

  it('preserves the legacy Study Desk session date as the logged day', () => {
    const storage = storageFrom({
      [legacyStorageKeys.studyState]: JSON.stringify({
        sessions: [
          {
            id: 'backfilled',
            track: 'coding',
            minutes: 75,
            notes: 'Backfilled graph review',
            date: '2026-06-01',
            createdAt: '2026-06-05T23:15:00.000Z'
          }
        ]
      })
    });

    const result = createLegacyEntityImport(storage, {
      workspaceId: 'personal',
      deviceId: 'web:test',
      importedAt: '2026-06-07T00:00:00.000Z'
    });

    expect(result.studySessions).toEqual([
      expect.objectContaining({
        id: 'legacy-study-session:backfilled',
        subject: 'Coding Practice: Backfilled graph review',
        loggedAt: '2026-06-01T12:00:00.000Z',
        updatedAt: '2026-06-05T23:15:00.000Z'
      })
    ]);
  });
});
