import { describe, expect, it } from 'vitest';
import { legacyStorageKeys } from '@mini-hub/core';
import { createLegacyEntityImport, inspectLegacyStorage } from './migration';

function storageFrom(values: Record<string, string>): Pick<Storage, 'getItem'> {
  return {
    getItem: (key: string) => values[key] ?? null
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
      studyDesk: {
        settings: { examDate: '2026-09-01', weeklyGoal: 600 },
        github: { submissions: 42 }
      }
    });
  });
});
