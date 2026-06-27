import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import type { GameState, JobRecord, PersonalSettings, StudySession, SyncEvent } from '@mini-hub/core';

const requestApiJsonMock = vi.hoisted(() => vi.fn());

vi.mock('./api', () => ({
  requestApiJson: requestApiJsonMock
}));

import { canAutoSave, createClientDataStore } from './client-data';

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, String(value));
  }
}

const job: JobRecord = {
  id: 'job_1',
  workspaceId: 'personal',
  company: 'Cache Labs',
  role: 'Reliability Analyst',
  status: 'lead',
  applicationUrl: '',
  fitScore: 82,
  notes: 'Synced from API',
  deviceId: 'api',
  updatedAt: '2026-06-26T10:00:00.000Z'
};

const studySession: StudySession = {
  id: 'study_1',
  workspaceId: 'personal',
  subject: 'Usability QA',
  minutes: 45,
  source: 'manual',
  loggedAt: '2026-06-26T11:00:00.000Z',
  deviceId: 'api',
  updatedAt: '2026-06-26T11:00:00.000Z'
};

const settings: PersonalSettings = {
  workspaceId: 'personal',
  theme: 'dark',
  highScores: {},
  recentState: { selectedRoute: '/activity' },
  preferences: { machineMode: 'balanced' },
  deviceId: 'api',
  updatedAt: '2026-06-26T12:00:00.000Z'
};

const gameState: GameState = {
  id: 'personal:stick-arena-lab',
  workspaceId: 'personal',
  gameId: 'stick-arena-lab',
  state: { highScore: 1234 },
  deviceId: 'api',
  updatedAt: '2026-06-26T13:00:00.000Z'
};

function syncEvent(entityType: SyncEvent['entityType'], entityId: string, payload: Record<string, unknown>): SyncEvent {
  return {
    id: `sync_${entityId}`,
    workspaceId: 'personal',
    entityType,
    entityId,
    operation: 'insert',
    payload,
    deviceId: 'api',
    createdAt: `2026-06-26T14:00:0${entityId.length % 10}.000Z`
  };
}

describe('client data sync state', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', new MemoryStorage());
    vi.stubGlobal('navigator', { onLine: true });
    localStorage.setItem('miniHub.localCacheFallback.v1', 'memory');
    requestApiJsonMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('allows auto-save whenever the browser is online', () => {
    expect(canAutoSave({ isOnline: true })).toBe(true);
    expect(canAutoSave({ isOnline: false })).toBe(false);
  });

  it('pulls server changes into the local readable cache and exposes saved state after sync', async () => {
    requestApiJsonMock.mockResolvedValue({
      cursor: '2026-06-26T14:00:09.000Z',
      changes: [
        syncEvent('job', job.id, job),
        syncEvent('study_session', studySession.id, studySession),
        syncEvent('settings', settings.workspaceId, settings),
        syncEvent('game_state', gameState.id, gameState)
      ]
    });

    const store = createClientDataStore();
    await store.syncNow();
    const state = get(store);

    expect(requestApiJsonMock).toHaveBeenCalledWith('/api/sync/pull?since=');
    expect(state.status).toBe('idle');
    expect(state.cursor).toBe('2026-06-26T14:00:09.000Z');
    expect(state.jobs).toContainEqual(expect.objectContaining({ id: 'job_1', company: 'Cache Labs' }));
    expect(state.studySessions).toContainEqual(expect.objectContaining({ id: 'study_1', subject: 'Usability QA' }));
    expect(state.settings).toMatchObject({ theme: 'dark', preferences: { machineMode: 'balanced' } });
    expect(state.gameStates).toContainEqual(expect.objectContaining({ gameId: 'stick-arena-lab', state: { highScore: 1234 } }));
  });

  it('updates local state after successful Career and Study saves', async () => {
    requestApiJsonMock
      .mockResolvedValueOnce({ job })
      .mockResolvedValueOnce({ session: studySession });

    const store = createClientDataStore();
    await store.saveJob({
      company: job.company,
      role: job.role,
      status: job.status,
      notes: job.notes
    });
    await store.saveStudySession({
      subject: studySession.subject,
      minutes: studySession.minutes,
      source: studySession.source
    });

    const state = get(store);
    expect(state.jobs).toContainEqual(expect.objectContaining({ id: job.id, role: job.role }));
    expect(state.studySessions).toContainEqual(expect.objectContaining({ id: studySession.id, minutes: studySession.minutes }));
    expect(requestApiJsonMock).toHaveBeenNthCalledWith(
      1,
      '/api/jobs',
      expect.objectContaining({ method: 'POST' })
    );
    expect(requestApiJsonMock).toHaveBeenNthCalledWith(
      2,
      '/api/study',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('blocks write calls before the API when the browser is offline', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const store = createClientDataStore();

    await expect(
      store.saveJob({
        company: job.company,
        role: job.role,
        status: job.status,
        notes: job.notes
      })
    ).rejects.toThrow('Offline read-only mode');
    expect(requestApiJsonMock).not.toHaveBeenCalled();
    expect(get(store).status).toBe('offline-readonly');
  });
});
