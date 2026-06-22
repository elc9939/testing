import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, createMemoryStore } from './index';
import { triageGmailThreads } from './integrations/email-triage';
import { GoogleGmailConnector } from './integrations/google';
import { decryptTokenSet, encryptTokenSet, upsertConnection } from './integrations/token-vault';
import { enableIntegrationPersistence, integrationConnectionsPath } from './store';

describe('mini hub api', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' }
    });
  }

  function connectedGoogleStore() {
    const store = createMemoryStore();
    upsertConnection(store, {
      workspaceId: 'personal',
      provider: 'google',
      accountLabel: 'tester@example.com',
      scopes: ['https://www.googleapis.com/auth/gmail.modify'],
      encryptedTokenSet: encryptTokenSet({
        accessToken: 'fresh-access-token',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        tokenType: 'Bearer'
      }),
      status: 'connected'
    });
    return store;
  }

  function gmailThreadResponse(labelIds = ['INBOX', 'UNREAD']) {
    return {
      id: 'thread-1',
      historyId: 'history-1',
      messages: [
        {
          id: 'message-1',
          threadId: 'thread-1',
          labelIds,
          snippet: 'Project deadline',
          internalDate: '1781572800000',
          payload: {
            mimeType: 'multipart/alternative',
            headers: [
              { name: 'Subject', value: 'Project deadline' },
              { name: 'From', value: 'Ada <ada@example.com>' },
              { name: 'To', value: 'me@example.com' },
              { name: 'Date', value: 'Tue, 16 Jun 2026 12:00:00 +0000' },
              { name: 'Message-ID', value: '<message-1@example.com>' }
            ],
            parts: [
              {
                mimeType: 'text/plain',
                body: {
                  data: Buffer.from('Please reply before the deadline.', 'utf8')
                    .toString('base64')
                    .replace(/\+/g, '-')
                    .replace(/\//g, '_')
                    .replace(/=+$/u, '')
                }
              }
            ]
          }
        }
      ]
    };
  }

  it('serves health checks', async () => {
    const app = createApp({ useLogger: false, store: createMemoryStore() });
    const response = await app.request('/api/health');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, service: 'mini-hub-api' });
  });

  it('serves assistant chat through the Mini Hub Ollama fallback', async () => {
    let generateBody: { model?: string; options?: { num_ctx?: number } } | undefined;
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/tags')) return jsonResponse({ models: [{ name: 'llama3.1:8b' }] });
      if (url.endsWith('/api/generate')) {
        generateBody = JSON.parse(String(init?.body ?? '{}'));
        return jsonResponse({ response: 'Calendar first. Email stays in the side rail.' });
      }
      return jsonResponse({ error: 'unexpected request' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    const app = createApp({ useLogger: false, store: createMemoryStore() });
    const response = await app.request('/api/assistant/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'what should the homepage focus on?' })
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      text: 'Calendar first. Email stays in the side rail.',
      provider: 'ollama',
      model: 'llama3.1:8b',
      fallback: 'mini-hub-api'
    });
    expect(generateBody).toMatchObject({
      model: 'llama3.1:8b',
      options: { num_ctx: 8192 }
    });
  });

  it('allows common fallback Vite dev origins for local import flows', async () => {
    const app = createApp({ useLogger: false, store: createMemoryStore() });
    const response = await app.request('/api/health', {
      headers: { Origin: 'http://127.0.0.1:5174' }
    });

    expect(response.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:5174');
  });

  it('accepts protected personal routes in local mode', async () => {
    const app = createApp({ useLogger: false, store: createMemoryStore() });
    const response = await app.request('/api/workspaces');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { workspaces: Array<{ id: string }> };
    expect(body.workspaces[0]?.id).toBe('personal');
  });

  it('saves user-facing entities and exposes sync changes by cursor', async () => {
    const app = createApp({ useLogger: false, store: createMemoryStore() });
    const authHeaders = { 'content-type': 'application/json' };

    const jobResponse = await app.request('/api/jobs', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        workspaceId: 'personal',
        company: 'Acme',
        role: 'Analyst',
        status: 'lead',
        applicationUrl: 'https://example.com/apply'
      })
    });
    expect(jobResponse.status).toBe(201);
    expect(await jobResponse.clone().json()).toMatchObject({ job: { applicationUrl: 'https://example.com/apply' } });

    const studyResponse = await app.request('/api/study', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ workspaceId: 'personal', subject: 'Exam P', minutes: 45 })
    });
    expect(studyResponse.status).toBe(201);

    const careerActionResponse = await app.request('/api/career-actions', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        workspaceId: 'personal',
        label: 'Apply to Acme',
        completedAt: '2026-06-05T12:00:00.000Z'
      })
    });
    expect(careerActionResponse.status).toBe(201);

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

    const pullResponse = await app.request('/api/sync/pull');
    expect(pullResponse.status).toBe(200);
    const pull = (await pullResponse.json()) as { changes: Array<{ entityType: string }>; cursor: string };
    expect(pull.changes.map((change) => change.entityType)).toEqual(
      expect.arrayContaining(['job', 'study_session', 'career_action', 'game_run', 'game_state', 'settings'])
    );

    const secondPullResponse = await app.request(`/api/sync/pull?since=${encodeURIComponent(pull.cursor)}`);
    const secondPull = (await secondPullResponse.json()) as { changes: unknown[] };
    expect(secondPull.changes).toHaveLength(0);
  });

  it('updates and deletes desk entities with sync events', async () => {
    const app = createApp({ useLogger: false, store: createMemoryStore() });
    const authHeaders = { 'content-type': 'application/json' };

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
        applicationUrl: 'https://example.com/acme-labs',
        notes: 'Panel scheduled',
        nextActionAt: '2026-07-01'
      })
    });
    expect(patchedJobResponse.status).toBe(200);
    const patchedJob = (await patchedJobResponse.json()) as { job: { company: string; applicationUrl: string; nextActionAt?: string } };
    expect(patchedJob.job.company).toBe('Acme Labs');
    expect(patchedJob.job.applicationUrl).toBe('https://example.com/acme-labs');
    expect(patchedJob.job.nextActionAt).toBe('2026-07-01');

    const deleteJobResponse = await app.request(`/api/jobs/${job.id}`, {
      method: 'DELETE'
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
      method: 'DELETE'
    });
    expect(deleteStudyResponse.status).toBe(200);

    const careerActionResponse = await app.request('/api/career-actions', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ workspaceId: 'personal', label: 'Prep interview', dueAt: '2026-07-02T12:00:00.000Z' })
    });
    const { action } = (await careerActionResponse.json()) as { action: { id: string } };

    const patchedActionResponse = await app.request(`/api/career-actions/${action.id}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ label: 'Prep technical interview', completedAt: '2026-07-01T19:00:00.000Z' })
    });
    expect(patchedActionResponse.status).toBe(200);
    const patchedAction = (await patchedActionResponse.json()) as { action: { label: string; completedAt?: string } };
    expect(patchedAction.action.label).toBe('Prep technical interview');
    expect(patchedAction.action.completedAt).toBe('2026-07-01T19:00:00.000Z');

    const deleteActionResponse = await app.request(`/api/career-actions/${action.id}`, {
      method: 'DELETE'
    });
    expect(deleteActionResponse.status).toBe(200);

    const pullResponse = await app.request('/api/sync/pull');
    const pull = (await pullResponse.json()) as {
      changes: Array<{ entityType: string; entityId: string; operation: string }>;
    };
    expect(pull.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entityType: 'job', entityId: job.id, operation: 'update' }),
        expect.objectContaining({ entityType: 'job', entityId: job.id, operation: 'delete' }),
        expect.objectContaining({ entityType: 'study_session', entityId: session.id, operation: 'update' }),
        expect.objectContaining({ entityType: 'study_session', entityId: session.id, operation: 'delete' }),
        expect.objectContaining({ entityType: 'career_action', entityId: action.id, operation: 'update' }),
        expect.objectContaining({ entityType: 'career_action', entityId: action.id, operation: 'delete' })
      ])
    );
  });

  it('exposes sync writes through the action ledger with recoverability metadata', async () => {
    const app = createApp({ useLogger: false, store: createMemoryStore() });
    const authHeaders = { 'content-type': 'application/json' };

    const jobResponse = await app.request('/api/jobs', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ workspaceId: 'personal', company: 'Acme', role: 'Analyst', status: 'lead' })
    });
    const { job } = (await jobResponse.json()) as { job: { id: string } };

    const deleteResponse = await app.request(`/api/jobs/${job.id}`, { method: 'DELETE' });
    expect(deleteResponse.status).toBe(200);

    const response = await app.request('/api/action-ledger?limit=10');
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      actions: Array<{
        id: string;
        actionType: string;
        changed: string[];
        recoverability: { kind: string; description: string; reversible: boolean };
        risk: string;
        status: string;
      }>;
    };

    expect(body.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: expect.stringContaining('mini-hub-sync:'),
          actionType: 'job.insert',
          changed: [`job:${job.id}`],
          recoverability: expect.objectContaining({ kind: 'snapshot' }),
          risk: 'write',
          status: 'succeeded'
        }),
        expect.objectContaining({
          actionType: 'job.delete',
          changed: [`job:${job.id}`],
          recoverability: expect.objectContaining({ kind: 'snapshot', reversible: true }),
          risk: 'destructive',
          status: 'succeeded'
        })
      ])
    );
  });

  it('federates Mini Hub, AI OS, and Macro Lab actions through the unified ledger', async () => {
    const externalFetch = vi.fn(async (input: string | URL | Request) => {
      const href = String(input);
      if (href.includes('/api/ai/action-ledger')) {
        return jsonResponse({
          actions: [
            {
              id: 'ai-benchmark:bench-1',
              occurred_at: '2026-06-20T14:00:00.000Z',
              system: 'ai-os',
              source: 'benchmark',
              action_type: 'benchmark.text',
              summary: 'Measured local text inference',
              status: 'succeeded',
              risk: 'read',
              mode: 'beast',
              changed: ['benchmark:bench-1'],
              recoverability: {
                kind: 'artifact',
                reference_id: 'bench-1',
                route: '/ai-os',
                description: 'Benchmark sample is recorded.',
                reversible: false
              },
              raw_ref: { kind: 'benchmark', id: 'bench-1' },
              metadata: { provider: 'ollama' }
            }
          ]
        });
      }
      if (href.includes('/api/macro-lab/runs')) {
        return jsonResponse({
          runs: [
            {
              id: 'run-1',
              macro_id: 'macro-1',
              macro_name: 'Study Mode',
              status: 'succeeded',
              dry_run: true,
              started_at: '2026-06-20T13:00:00.000Z',
              finished_at: '2026-06-20T13:01:00.000Z',
              steps: [{ label: 'Open notes', safety: 'write' }]
            }
          ]
        });
      }
      return jsonResponse({ error: `Unexpected URL ${href}` }, 500);
    });
    const app = createApp({ externalFetch, useLogger: false, store: createMemoryStore() });
    const authHeaders = { 'content-type': 'application/json' };
    await app.request('/api/jobs', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ workspaceId: 'personal', company: 'Acme', role: 'Analyst', status: 'lead' })
    });

    const response = await app.request('/api/action-ledger/unified?limit=10');
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      actions: Array<{
        system: string;
        source: string;
        actionType: string;
        status: string;
        risk: string;
        recoverability: { kind: string; referenceId?: string };
      }>;
      errors: string[];
      sources: Array<{ id: string; ok: boolean; count: number }>;
    };

    expect(body.errors).toEqual([]);
    expect(body.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'mini-hub', ok: true, count: 1 }),
        expect.objectContaining({ id: 'ai-os', ok: true, count: 1 }),
        expect.objectContaining({ id: 'macro-lab', ok: true, count: 1 })
      ])
    );
    expect(body.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ system: 'mini-hub', actionType: 'job.insert' }),
        expect.objectContaining({
          system: 'ai-os',
          actionType: 'benchmark.text',
          recoverability: expect.objectContaining({ kind: 'artifact', referenceId: 'bench-1' })
        }),
        expect.objectContaining({
          system: 'macro-lab',
          source: 'run_history',
          actionType: 'macro.run',
          status: 'dry_run',
          risk: 'write',
          recoverability: expect.objectContaining({ kind: 'dry_run', referenceId: 'run-1' })
        })
      ])
    );
  });

  it('keeps the unified ledger usable when a federated service is unavailable', async () => {
    const externalFetch = vi.fn(async (input: string | URL | Request) => {
      const href = String(input);
      if (href.includes('/api/ai/action-ledger')) {
        return jsonResponse({
          actions: [
            {
              id: 'ai-tool:call-1',
              occurred_at: '2026-06-20T14:00:00.000Z',
              system: 'ai-os',
              source: 'tool_call',
              action_type: 'tool.call',
              summary: 'Checked status',
              status: 'succeeded',
              risk: 'read',
              changed: [],
              recoverability: { kind: 'none', description: '', reversible: false },
              raw_ref: {},
              metadata: {}
            }
          ]
        });
      }
      if (href.includes('/api/macro-lab/runs')) throw new Error('connection refused');
      return jsonResponse({ error: `Unexpected URL ${href}` }, 500);
    });
    const app = createApp({ externalFetch, useLogger: false, store: createMemoryStore() });

    const response = await app.request('/api/action-ledger/unified?limit=10');
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      actions: Array<{ system: string; actionType: string }>;
      errors: string[];
      sources: Array<{ id: string; ok: boolean; error?: string }>;
    };

    expect(body.actions).toEqual([expect.objectContaining({ system: 'ai-os', actionType: 'tool.call' })]);
    expect(body.errors[0]).toContain('Macro Lab: connection refused');
    expect(body.sources).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'macro-lab', ok: false })]));
  });

  it('restores Mini Hub data from action ledger before-state snapshots', async () => {
    const store = createMemoryStore();
    const app = createApp({ useLogger: false, store });
    const authHeaders = { 'content-type': 'application/json' };

    const jobResponse = await app.request('/api/jobs', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        workspaceId: 'personal',
        company: 'Acme',
        role: 'Analyst',
        status: 'lead',
        notes: 'restore me'
      })
    });
    const { job } = (await jobResponse.json()) as { job: { id: string; notes: string } };
    await app.request(`/api/jobs/${job.id}`, { method: 'DELETE' });

    const ledgerResponse = await app.request('/api/action-ledger?limit=5');
    const ledger = (await ledgerResponse.json()) as {
      actions: Array<{ id: string; actionType: string; recoverability: { kind: string; reversible: boolean } }>;
    };
    const deleteAction = ledger.actions.find((action) => action.actionType === 'job.delete');
    expect(deleteAction).toMatchObject({
      recoverability: { kind: 'snapshot', reversible: true }
    });

    const blockedRestore = await app.request(`/api/action-ledger/${encodeURIComponent(deleteAction?.id ?? '')}/restore`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ confirm: false })
    });
    expect(blockedRestore.status).toBe(409);
    let restoreLedgerResponse = await app.request('/api/action-ledger?limit=10');
    let restoreLedger = (await restoreLedgerResponse.json()) as {
      actions: Array<{
        actionType: string;
        status: string;
        summary: string;
        recoverability: { kind: string; reversible: boolean };
      }>;
    };
    expect(restoreLedger.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actionType: 'action_ledger.restore',
          status: 'blocked',
          recoverability: expect.objectContaining({ kind: 'dry_run', reversible: true })
        })
      ])
    );

    const restoreResponse = await app.request(`/api/action-ledger/${encodeURIComponent(deleteAction?.id ?? '')}/restore`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ confirm: true })
    });
    expect(restoreResponse.status).toBe(200);
    const restore = (await restoreResponse.json()) as {
      restored: { id: string; company: string; notes: string };
      syncEvent: { operation: string; payload: Record<string, unknown> };
      action: { actionType: string; status: string; changed: string[]; recoverability: { kind: string; referenceId?: string } };
    };
    expect(restore.restored).toMatchObject({ id: job.id, company: 'Acme', notes: 'restore me' });
    expect(restore.syncEvent.operation).toBe('insert');
    expect(restore.action).toMatchObject({
      actionType: 'action_ledger.restore',
      status: 'succeeded',
      changed: [`job:${job.id}`],
      recoverability: { kind: 'artifact', referenceId: expect.any(String) }
    });
    expect(store.jobs).toEqual([expect.objectContaining({ id: job.id, notes: 'restore me' })]);

    const jobsResponse = await app.request('/api/jobs');
    const jobs = (await jobsResponse.json()) as { jobs: Array<{ id: string }> };
    expect(jobs.jobs.map((row) => row.id)).toContain(job.id);

    restoreLedgerResponse = await app.request('/api/action-ledger?limit=10');
    restoreLedger = (await restoreLedgerResponse.json()) as {
      actions: Array<{
        actionType: string;
        status: string;
        summary: string;
        recoverability: { kind: string; reversible: boolean };
      }>;
    };
    expect(restoreLedger.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actionType: 'action_ledger.restore',
          status: 'succeeded',
          summary: 'Restored Job snapshot'
        })
      ])
    );
  });

  it('records failed Mini Hub restore attempts for non-restorable actions', async () => {
    const store = createMemoryStore();
    const app = createApp({ useLogger: false, store });
    const authHeaders = { 'content-type': 'application/json' };

    const jobResponse = await app.request('/api/jobs', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        workspaceId: 'personal',
        company: 'Acme',
        role: 'Analyst',
        status: 'lead'
      })
    });
    const { job } = (await jobResponse.json()) as { job: { id: string } };
    const ledgerResponse = await app.request('/api/action-ledger?limit=5');
    const ledger = (await ledgerResponse.json()) as {
      actions: Array<{ id: string; actionType: string }>;
    };
    const insertAction = ledger.actions.find((action) => action.actionType === 'job.insert');

    const restoreResponse = await app.request(`/api/action-ledger/${encodeURIComponent(insertAction?.id ?? '')}/restore`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ confirm: true })
    });
    expect(restoreResponse.status).toBe(409);
    expect(store.jobs.map((row) => row.id)).toContain(job.id);

    const afterResponse = await app.request('/api/action-ledger?limit=10');
    const after = (await afterResponse.json()) as {
      actions: Array<{ actionType: string; status: string; summary: string; changed: string[] }>;
    };
    expect(after.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actionType: 'action_ledger.restore',
          status: 'failed',
          summary: 'Restore Job snapshot failed',
          changed: [`job:${job.id}`]
        })
      ])
    );
  });

  it('upserts legacy imports by id without duplicating desk rows', async () => {
    const store = createMemoryStore();
    const app = createApp({ useLogger: false, store });
    const authHeaders = { 'content-type': 'application/json' };

    const legacyJob = {
      id: 'legacy-career-job:job-a',
      workspaceId: 'personal',
      company: 'Acme',
      role: 'Quant Analyst',
      status: 'interview',
      notes: 'Imported from Career Desk',
      nextActionAt: '2026-07-01',
      deviceId: 'web:test',
      updatedAt: '2026-06-02T12:00:00.000Z'
    };
    const firstJob = await app.request('/api/jobs', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(legacyJob)
    });
    const secondJob = await app.request('/api/jobs', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ ...legacyJob, notes: 'Imported again' })
    });

    expect(firstJob.status).toBe(201);
    expect(secondJob.status).toBe(200);
    expect(store.jobs).toHaveLength(1);
    expect(store.jobs[0]).toMatchObject({ id: legacyJob.id, notes: 'Imported again' });

    const legacySession = {
      id: 'legacy-study-session:study-a',
      workspaceId: 'personal',
      subject: 'Exam P: Bayes review',
      minutes: 35,
      source: 'legacy-study-desk:examP',
      loggedAt: '2026-06-03T10:00:00.000Z',
      deviceId: 'web:test',
      updatedAt: '2026-06-03T10:00:00.000Z'
    };
    const firstSession = await app.request('/api/study', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(legacySession)
    });
    const secondSession = await app.request('/api/study', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ ...legacySession, minutes: 45 })
    });

    expect(firstSession.status).toBe(201);
    expect(secondSession.status).toBe(200);
    expect(store.studySessions).toHaveLength(1);
    expect(store.studySessions[0]).toMatchObject({ id: legacySession.id, minutes: 45 });

    const legacyAction = {
      id: 'legacy-study-career-action:2026-06-04:career-a',
      workspaceId: 'personal',
      label: 'Apply: Submitted Acme follow-up',
      completedAt: '2026-06-04T18:30:00.000Z',
      deviceId: 'web:test',
      updatedAt: '2026-06-04T18:30:00.000Z'
    };
    const firstAction = await app.request('/api/career-actions', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(legacyAction)
    });
    const secondAction = await app.request('/api/career-actions', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ ...legacyAction, label: 'Apply: Submitted again' })
    });

    expect(firstAction.status).toBe(201);
    expect(secondAction.status).toBe(200);
    expect(store.careerActions).toHaveLength(1);
    expect(store.careerActions[0]).toMatchObject({ id: legacyAction.id, label: 'Apply: Submitted again' });
  });

  it('serves the integration catalog in personal local mode', async () => {
    const app = createApp({ useLogger: false, store: createMemoryStore() });

    const accepted = await app.request('/api/integrations/catalog');
    expect(accepted.status).toBe(200);
    const body = (await accepted.json()) as { connectors: Array<{ id: string; status: string }> };
    expect(body.connectors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'google', status: 'implemented' }),
        expect.objectContaining({ id: 'gmail', status: 'implemented' })
      ])
    );
  });

  it('returns a clean provider auth error before Google is connected', async () => {
    const app = createApp({ useLogger: false, store: createMemoryStore() });
    const response = await app.request('/api/productivity/calendar/calendars');

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: 'Google is not connected' });
  });

  it('returns a clean Gmail auth error before Google is connected', async () => {
    const app = createApp({ useLogger: false, store: createMemoryStore() });
    const response = await app.request('/api/productivity/gmail/threads');

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: 'Google is not connected' });
  });

  it('lists and normalizes Gmail labels and threads through the connector', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes('/gmail/v1/users/me/labels')) {
        return jsonResponse({ labels: [{ id: 'INBOX', name: 'INBOX', type: 'system' }] });
      }
      if (href.includes('/gmail/v1/users/me/threads?')) {
        return jsonResponse({ threads: [{ id: 'thread-1' }], resultSizeEstimate: 1 });
      }
      if (href.includes('/gmail/v1/users/me/threads/thread-1?')) {
        return jsonResponse(gmailThreadResponse());
      }
      return jsonResponse({ error: { message: `Unexpected URL ${href}` } }, 500);
    });
    vi.stubGlobal('fetch', fetchMock);

    const connector = new GoogleGmailConnector(connectedGoogleStore());
    const labels = await connector.listLabels();
    const threads = await connector.listThreads({ q: 'from:ada@example.com', maxResults: 1 });

    expect(labels[0]).toMatchObject({ id: 'INBOX', name: 'INBOX' });
    expect(threads.threads[0]).toMatchObject({
      id: expect.stringContaining('thread-1'),
      subject: 'Project deadline',
      unread: true
    });
    expect(threads.threads[0]?.messages[0]?.bodyText).toContain('Please reply');
  });

  it('sends Gmail MIME messages and performs thread label actions', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (href.includes('/gmail/v1/users/me/messages/send')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as { raw?: string };
        const raw = Buffer.from((body.raw ?? '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
        expect(raw).toContain('To: ada@example.com');
        expect(raw).toContain('Subject: Test send');
        expect(raw).toContain('Body from Mini Hub');
        return jsonResponse({ id: 'sent-1', threadId: 'thread-1' });
      }
      if (href.includes('/gmail/v1/users/me/messages/sent-1?')) {
        return jsonResponse({
          ...gmailThreadResponse(['SENT']).messages[0],
          id: 'sent-1',
          labelIds: ['SENT'],
          snippet: 'Body from Mini Hub'
        });
      }
      if (href.includes('/gmail/v1/users/me/threads/thread-1/modify')) {
        return jsonResponse({ id: 'thread-1' });
      }
      if (href.includes('/gmail/v1/users/me/threads/thread-1?')) {
        return jsonResponse(gmailThreadResponse(['UNREAD']));
      }
      return jsonResponse({ error: { message: `Unexpected URL ${href}` } }, 500);
    });
    vi.stubGlobal('fetch', fetchMock);

    const connector = new GoogleGmailConnector(connectedGoogleStore());
    const sent = await connector.sendMessage({
      to: ['ada@example.com'],
      subject: 'Test send',
      bodyText: 'Body from Mini Hub'
    });
    await connector.archiveThread('thread-1');
    await connector.markThreadRead('thread-1');

    const modifyBodies = fetchMock.mock.calls
      .filter(([url]) => String(url).includes('/threads/thread-1/modify'))
      .map(([, init]) => JSON.parse(String((init as RequestInit | undefined)?.body ?? '{}')));

    expect(sent.id).toBe('sent-1');
    expect(modifyBodies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ removeLabelIds: ['INBOX'] }),
        expect.objectContaining({ removeLabelIds: ['UNREAD'] })
      ])
    );
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

  it('persists encrypted integration connections across store instances', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'mini-hub-integrations-'));
    try {
      const path = integrationConnectionsPath(tempDir);
      const firstStore = createMemoryStore();
      enableIntegrationPersistence(firstStore, path);
      const connection = upsertConnection(firstStore, {
        workspaceId: 'personal',
        provider: 'google',
        accountLabel: 'tester@example.com',
        scopes: ['https://www.googleapis.com/auth/calendar'],
        encryptedTokenSet: encryptTokenSet({
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
          tokenType: 'Bearer'
        }),
        status: 'connected'
      });

      const secondStore = createMemoryStore();
      enableIntegrationPersistence(secondStore, path);

      expect(secondStore.integrationConnections.get(connection.id)).toMatchObject({
        accountLabel: 'tester@example.com',
        provider: 'google',
        status: 'connected'
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('keeps separate Google grants for different account labels', () => {
    const store = createMemoryStore();
    const personal = upsertConnection(store, {
      workspaceId: 'personal',
      provider: 'google',
      accountLabel: 'personal@example.com',
      scopes: ['gmail'],
      encryptedTokenSet: encryptTokenSet({ accessToken: 'personal-token' }),
      status: 'connected'
    });
    const school = upsertConnection(store, {
      workspaceId: 'personal',
      provider: 'google',
      accountLabel: 'school@example.edu',
      scopes: ['gmail'],
      encryptedTokenSet: encryptTokenSet({ accessToken: 'school-token' }),
      status: 'connected'
    });

    expect(personal.id).not.toBe(school.id);
    expect(store.integrationConnections.size).toBe(2);
  });

  it('prioritizes action/deadline email above low-signal marketing', async () => {
    const baseMessage = {
      id: 'message-1',
      threadId: 'urgent-thread',
      labelIds: ['INBOX', 'UNREAD'],
      snippet: 'Please reply before Friday about the interview schedule.',
      subject: 'Interview schedule deadline',
      from: 'Recruiter <recruiter@example.com>',
      to: 'me@example.com',
      cc: '',
      date: 'Wed, 17 Jun 2026 12:00:00 +0000',
      internalDate: '1781712000000',
      messageIdHeader: '<message-1@example.com>',
      references: '',
      inReplyTo: '',
      bodyText: 'Please reply before Friday about the interview schedule.',
      bodyHtml: '',
      headers: {}
    };
    const threads = [
      {
        id: 'urgent-thread',
        historyId: 'h1',
        snippet: 'Please reply before Friday about the interview schedule.',
        labelIds: ['INBOX', 'UNREAD'],
        subject: 'Interview schedule deadline',
        from: 'Recruiter <recruiter@example.com>',
        date: 'Wed, 17 Jun 2026 12:00:00 +0000',
        unread: true,
        messages: [baseMessage]
      },
      {
        id: 'promo-thread',
        historyId: 'h2',
        snippet: 'Sale discount promo newsletter view web version.',
        labelIds: ['CATEGORY_PROMOTIONS'],
        subject: 'Huge sale today',
        from: 'Shop <shop@example.com>',
        date: 'Wed, 17 Jun 2026 11:00:00 +0000',
        unread: false,
        messages: [
          {
            ...baseMessage,
            id: 'promo-message',
            threadId: 'promo-thread',
            labelIds: ['CATEGORY_PROMOTIONS'],
            subject: 'Huge sale today',
            from: 'Shop <shop@example.com>',
            snippet: 'Sale discount promo newsletter view web version.',
            bodyText: 'Sale discount promo newsletter view web version.'
          }
        ]
      }
    ];

    const insights = await triageGmailThreads(threads, { maxResults: 2, minPriority: 0 });

    expect(insights[0]).toMatchObject({
      category: expect.stringMatching(/deadline|career|reply/),
      thread: expect.objectContaining({ id: 'urgent-thread' })
    });
    expect(insights[0]?.priority ?? 0).toBeGreaterThan(insights[1]?.priority ?? 0);
  });

  it('does not let Gmail IMPORTANT promote promotional mail into the home list', async () => {
    const promoMessage = {
      id: 'promo-message',
      threadId: 'promo-thread',
      labelIds: ['INBOX', 'IMPORTANT', 'CATEGORY_PROMOTIONS'],
      snippet: 'Limited time discount sale newsletter view web version.',
      subject: 'Important limited time sale',
      from: 'Shop <shop@example.com>',
      to: 'me@example.com',
      cc: '',
      date: 'Wed, 17 Jun 2026 11:00:00 +0000',
      internalDate: '1781708400000',
      messageIdHeader: '<promo-message@example.com>',
      references: '',
      inReplyTo: '',
      bodyText: 'Limited time discount sale newsletter unsubscribe view web version.',
      bodyHtml: '',
      headers: {}
    };

    const insights = await triageGmailThreads(
      [
        {
          id: 'promo-thread',
          historyId: 'h2',
          snippet: promoMessage.snippet,
          labelIds: promoMessage.labelIds,
          subject: promoMessage.subject,
          from: promoMessage.from,
          date: promoMessage.date,
          unread: true,
          messages: [promoMessage]
        }
      ],
      { maxResults: 1, minPriority: 0 }
    );

    expect(insights[0]).toMatchObject({ category: 'noise' });
    expect(insights[0]?.priority ?? 100).toBeLessThan(45);
  });
});
