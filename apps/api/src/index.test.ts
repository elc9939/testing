import { describe, expect, it } from 'vitest';
import { createApp, createMemoryStore } from './index';
import { decryptTokenSet, encryptTokenSet } from './integrations/token-vault';

describe('mini hub api', () => {
  const syncKey = 'test-sync-key';

  it('serves health checks', async () => {
    const app = createApp({ personalSyncKey: syncKey, useLogger: false, store: createMemoryStore() });
    const response = await app.request('/api/health');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, service: 'mini-hub-api' });
  });

  it('rejects protected routes without the personal sync key', async () => {
    const app = createApp({ personalSyncKey: syncKey, useLogger: false, store: createMemoryStore() });
    const response = await app.request('/api/workspaces');
    expect(response.status).toBe(401);
  });

  it('accepts protected routes with the personal sync key', async () => {
    const app = createApp({ personalSyncKey: syncKey, useLogger: false, store: createMemoryStore() });
    const response = await app.request('/api/workspaces', {
      headers: { 'x-mini-hub-sync-key': syncKey }
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { workspaces: Array<{ id: string }> };
    expect(body.workspaces[0]?.id).toBe('personal');
  });

  it('saves user-facing entities and exposes sync changes by cursor', async () => {
    const app = createApp({ personalSyncKey: syncKey, useLogger: false, store: createMemoryStore() });
    const authHeaders = { 'content-type': 'application/json', 'x-mini-hub-sync-key': syncKey };

    const jobResponse = await app.request('/api/jobs', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ workspaceId: 'personal', company: 'Acme', role: 'Analyst', status: 'lead' })
    });
    expect(jobResponse.status).toBe(201);

    const studyResponse = await app.request('/api/study', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ workspaceId: 'personal', subject: 'Exam P', minutes: 45 })
    });
    expect(studyResponse.status).toBe(201);

    const gameRunResponse = await app.request('/api/game-runs', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ workspaceId: 'personal', gameId: 'stick-arena-lab', score: 1, durationMs: 100 })
    });
    expect(gameRunResponse.status).toBe(201);

    const gameStateResponse = await app.request('/api/game-state/stick-arena-lab', {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({ state: { highScore: 1 } })
    });
    expect(gameStateResponse.status).toBe(200);

    const settingsResponse = await app.request('/api/settings', {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({ preferences: { density: 'comfortable' } })
    });
    expect(settingsResponse.status).toBe(200);

    const pullResponse = await app.request('/api/sync/pull', {
      headers: { 'x-mini-hub-sync-key': syncKey }
    });
    expect(pullResponse.status).toBe(200);
    const pull = (await pullResponse.json()) as { changes: Array<{ entityType: string }>; cursor: string };
    expect(pull.changes.map((change) => change.entityType)).toEqual(
      expect.arrayContaining(['job', 'study_session', 'game_run', 'game_state', 'settings'])
    );

    const secondPullResponse = await app.request(`/api/sync/pull?since=${encodeURIComponent(pull.cursor)}`, {
      headers: { 'x-mini-hub-sync-key': syncKey }
    });
    const secondPull = (await secondPullResponse.json()) as { changes: unknown[] };
    expect(secondPull.changes).toHaveLength(0);
  });

  it('updates and deletes desk entities with sync events', async () => {
    const app = createApp({ personalSyncKey: syncKey, useLogger: false, store: createMemoryStore() });
    const authHeaders = { 'content-type': 'application/json', 'x-mini-hub-sync-key': syncKey };

    const jobResponse = await app.request('/api/jobs', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ workspaceId: 'personal', company: 'Acme', role: 'Analyst', status: 'lead' })
    });
    const { job } = (await jobResponse.json()) as { job: { id: string } };

    const patchedJobResponse = await app.request(`/api/jobs/${job.id}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({
        company: 'Acme Labs',
        role: 'Senior Analyst',
        status: 'interview',
        notes: 'Panel scheduled',
        nextActionAt: '2026-07-01'
      })
    });
    expect(patchedJobResponse.status).toBe(200);
    const patchedJob = (await patchedJobResponse.json()) as { job: { company: string; nextActionAt?: string } };
    expect(patchedJob.job.company).toBe('Acme Labs');
    expect(patchedJob.job.nextActionAt).toBe('2026-07-01');

    const deleteJobResponse = await app.request(`/api/jobs/${job.id}`, {
      method: 'DELETE',
      headers: { 'x-mini-hub-sync-key': syncKey }
    });
    expect(deleteJobResponse.status).toBe(200);

    const studyResponse = await app.request('/api/study', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ workspaceId: 'personal', subject: 'Exam P', minutes: 30 })
    });
    const { session } = (await studyResponse.json()) as { session: { id: string } };

    const patchedStudyResponse = await app.request(`/api/study/${session.id}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ subject: 'Exam FM', minutes: 45 })
    });
    expect(patchedStudyResponse.status).toBe(200);
    const patchedStudy = (await patchedStudyResponse.json()) as { session: { subject: string; minutes: number } };
    expect(patchedStudy.session.subject).toBe('Exam FM');
    expect(patchedStudy.session.minutes).toBe(45);

    const deleteStudyResponse = await app.request(`/api/study/${session.id}`, {
      method: 'DELETE',
      headers: { 'x-mini-hub-sync-key': syncKey }
    });
    expect(deleteStudyResponse.status).toBe(200);

    const pullResponse = await app.request('/api/sync/pull', {
      headers: { 'x-mini-hub-sync-key': syncKey }
    });
    const pull = (await pullResponse.json()) as {
      changes: Array<{ entityType: string; entityId: string; operation: string }>;
    };
    expect(pull.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entityType: 'job', entityId: job.id, operation: 'update' }),
        expect.objectContaining({ entityType: 'job', entityId: job.id, operation: 'delete' }),
        expect.objectContaining({ entityType: 'study_session', entityId: session.id, operation: 'update' }),
        expect.objectContaining({ entityType: 'study_session', entityId: session.id, operation: 'delete' })
      ])
    );
  });

  it('protects the integration catalog behind the personal sync key', async () => {
    const app = createApp({ personalSyncKey: syncKey, useLogger: false, store: createMemoryStore() });

    const rejected = await app.request('/api/integrations/catalog');
    expect(rejected.status).toBe(401);

    const accepted = await app.request('/api/integrations/catalog', {
      headers: { 'x-mini-hub-sync-key': syncKey }
    });
    expect(accepted.status).toBe(200);
    const body = (await accepted.json()) as { connectors: Array<{ id: string; status: string }> };
    expect(body.connectors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'google', status: 'implemented' }),
        expect.objectContaining({ id: 'gmail', status: 'planned' })
      ])
    );
  });

  it('returns a clean provider auth error before Google is connected', async () => {
    const app = createApp({ personalSyncKey: syncKey, useLogger: false, store: createMemoryStore() });
    const response = await app.request('/api/productivity/calendar/calendars', {
      headers: { 'x-mini-hub-sync-key': syncKey }
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: 'Google is not connected' });
  });

  it('encrypts OAuth token sets before storage', () => {
    const encrypted = encryptTokenSet({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: '2026-06-16T12:00:00.000Z',
      scope: 'calendar',
      tokenType: 'Bearer'
    });

    expect(encrypted).not.toContain('access-token');
    expect(decryptTokenSet(encrypted)).toMatchObject({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      scope: 'calendar'
    });
  });
});
