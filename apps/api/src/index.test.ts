import { describe, expect, it } from 'vitest';
import { createApp, createMemoryStore } from './index';

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
});
