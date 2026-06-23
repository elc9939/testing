import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { personalWorkspaceId } from '@mini-hub/core';
import {
  buildPassiveDigest,
  buildPassiveSnapshot,
  collectPassiveAttentionItems,
  duePassiveTasks,
  ensurePassiveDefaults,
  startPassiveTaskWorker,
  runPassiveTask,
  setPassiveWatcherEnabled,
  updatePassiveCardTriage,
  updatePassiveTaskStatus
} from './passive-engine';
import { env } from './env';
import {
  createMemoryStore,
  enablePassiveTaskPersistence,
  passiveTasksPath,
  persistPassiveTasks
} from './store';

function jsonResponse(value: unknown, ok = true): Response {
  return new Response(JSON.stringify(value), {
    status: ok ? 200 : 500,
    headers: { 'content-type': 'application/json' }
  });
}

function healthyServiceFetch(): typeof fetch {
  return (async (input: unknown) => {
    const href = String(input);
    if (href.includes('/api/ai/status')) {
      return jsonResponse({ jobs: [], backups: [{ id: 'backup-1', ok: true }] });
    }
    if (href.includes('/api/macro-lab/status')) {
      return jsonResponse({ ok: true, engine: { panic: false, running: 0, action_count: 0 } });
    }
    if (href.includes('/api/ai/memory/ingest')) {
      return jsonResponse({ result: { document_id: 'memory-doc-1', chunks: 1, embedding_dimensions: 256 } });
    }
    if (href.includes('/api/tags')) {
      return jsonResponse({ models: [{ name: 'llama3.1:8b' }] });
    }
    return jsonResponse({ ok: true });
  }) as typeof fetch;
}

async function waitForCondition(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Timed out waiting for passive test condition.');
}

describe('passive task engine', () => {
  it('registers default watchers without creating fake digest items', () => {
    const store = createMemoryStore();
    ensurePassiveDefaults(store, new Date('2026-06-20T10:00:00.000Z'));

    const snapshot = buildPassiveSnapshot(store);

    expect(snapshot.watchers.map((watcher) => watcher.family)).toContain('app_health');
    expect(snapshot.tasks.some((task) => task.idleOnly)).toBe(true);
    expect(snapshot.digest).toEqual([]);
  });

  it('orders due tasks by priority and respects idle-only gating', () => {
    const store = createMemoryStore();
    const now = new Date('2026-06-20T10:00:00.000Z');
    ensurePassiveDefaults(store, now);
    store.passiveTasks = store.passiveTasks.map((task) => ({
      ...task,
      nextRunAt: '2026-06-20T09:00:00.000Z',
      trigger: { ...task.trigger, nextRunAt: '2026-06-20T09:00:00.000Z' }
    }));

    const activeDue = duePassiveTasks(store, now);
    const idleDue = duePassiveTasks(store, now, { idle: true });

    expect(activeDue[0]?.family).toBe('app_health');
    expect(activeDue.some((task) => task.family === 'idle_compute')).toBe(false);
    expect(idleDue.some((task) => task.family === 'idle_compute')).toBe(true);

    store.passiveSettings = { ...store.passiveSettings!, idleOnly: true };
    expect(duePassiveTasks(store, now)).toEqual([]);
    expect(duePassiveTasks(store, now, { idle: true }).length).toBeGreaterThan(0);
  });

  it('keeps event tasks out of scheduled ticks and runs them only for matching events', () => {
    const store = createMemoryStore();
    const now = new Date('2026-06-20T10:00:00.000Z');
    ensurePassiveDefaults(store, now);
    store.passiveTasks = store.passiveTasks.map((task) => {
      if (task.trigger.kind === 'event') {
        const taskWithoutNextRun = { ...task };
        delete taskWithoutNextRun.nextRunAt;
        return taskWithoutNextRun;
      }
      return {
        ...task,
        nextRunAt: '2026-06-20T09:00:00.000Z',
        trigger: { ...task.trigger, nextRunAt: '2026-06-20T09:00:00.000Z' }
      };
    });

    const scheduledDue = duePassiveTasks(store, now);
    const startupDue = duePassiveTasks(store, now, { eventName: 'app.startup' });
    const reconnectDue = duePassiveTasks(store, now, { eventName: 'app.reconnect' });
    const oauthDue = duePassiveTasks(store, now, { eventName: 'google.oauth.connected' });
    const fileDue = duePassiveTasks(store, now, { eventName: 'file.changed' });
    const unrelatedDue = duePassiveTasks(store, now, { eventName: 'not.real' });

    expect(scheduledDue.some((task) => task.trigger.kind === 'event')).toBe(false);
    expect(startupDue).toHaveLength(1);
    expect(startupDue[0]?.id).toBe('passive-task:app-health-startup');
    expect(reconnectDue[0]?.id).toBe('passive-task:app-health-startup');
    expect(oauthDue[0]?.id).toBe('passive-task:app-health-startup');
    expect(fileDue).toHaveLength(1);
    expect(fileDue[0]?.id).toBe('passive-task:file-intelligence-event');
    expect(unrelatedDue).toEqual([]);
  });

  it('emits a startup event run automatically when the worker starts', async () => {
    const store = createMemoryStore();
    ensurePassiveDefaults(store);
    const stop = startPassiveTaskWorker(store, {
      externalFetch: healthyServiceFetch(),
      intervalMs: 60_000
    });
    try {
      await waitForCondition(() => store.passiveRuns.some((run) => run.metadata.eventName === 'app.startup'));
    } finally {
      stop();
    }

    const run = store.passiveRuns.find((item) => item.metadata.eventName === 'app.startup');
    expect(run).toMatchObject({
      taskId: 'passive-task:app-health-startup',
      status: 'succeeded',
      metadata: { reason: 'worker-startup', eventName: 'app.startup' }
    });
  });

  it('uses worker idle detection to run idle-only scheduled tasks', async () => {
    const store = createMemoryStore();
    ensurePassiveDefaults(store, new Date('2026-06-20T10:00:00.000Z'));
    store.passiveTasks = store.passiveTasks.map((task) => ({
      ...task,
      nextRunAt: task.family === 'idle_compute' ? '2026-06-20T09:00:00.000Z' : '2099-06-21T09:00:00.000Z',
      trigger: {
        ...task.trigger,
        nextRunAt: task.family === 'idle_compute' ? '2026-06-20T09:00:00.000Z' : '2099-06-21T09:00:00.000Z'
      }
    }));
    const stop = startPassiveTaskWorker(store, {
      externalFetch: healthyServiceFetch(),
      intervalMs: 60_000,
      startupEventName: false,
      idleDetector: (thresholdMinutes) => ({
        idle: true,
        idleMinutes: thresholdMinutes + 5,
        thresholdMinutes,
        checkedAt: '2026-06-20T10:00:00.000Z',
        source: 'test-idle-detector'
      })
    });
    try {
      await waitForCondition(() => store.passiveRuns.some((run) => run.taskId === 'passive-task:idle-compute'));
    } finally {
      stop();
    }

    const run = store.passiveRuns.find((item) => item.taskId === 'passive-task:idle-compute');
    expect(run).toMatchObject({
      status: 'succeeded',
      metadata: {
        reason: 'worker-tick',
        idle: true,
        idleMinutes: 25,
        idleSource: 'test-idle-detector'
      }
    });
  });

  it('plans stale Mini Hub cleanup during idle compute without deleting files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mini-hub-cleanup-'));
    const previousDataDir = env.dataDir;
    try {
      env.dataDir = dir;
      const snapshotDir = join(dir, 'passive-snapshots');
      mkdirSync(snapshotDir, { recursive: true });
      const oldSnapshot = join(snapshotDir, 'old-snapshot.json');
      const oldLog = join(dir, 'old-api.log');
      writeFileSync(oldSnapshot, JSON.stringify({ ok: true }), 'utf8');
      writeFileSync(oldLog, 'old log line\n', 'utf8');
      const oldDate = new Date('2026-04-01T10:00:00.000Z');
      utimesSync(oldSnapshot, oldDate, oldDate);
      utimesSync(oldLog, oldDate, oldDate);

      const store = createMemoryStore();
      ensurePassiveDefaults(store, new Date('2026-06-20T10:00:00.000Z'));
      const task = store.passiveTasks.find((item) => item.family === 'idle_compute')!;

      const run = await runPassiveTask(store, task.id, {
        externalFetch: healthyServiceFetch(),
        force: true,
        input: { idle: true, reason: 'cleanup-test' }
      });

      expect(run.status).toBe('succeeded');
      expect(run.metadata.cleanupCandidates).toBeGreaterThanOrEqual(2);
      expect(run.changed).toContain(`cleanup-candidate:${oldSnapshot}`);
      expect(run.changed).toContain(`cleanup-candidate:${oldLog}`);
      expect(run.cards.some((card) => card.title.includes('idle cleanup candidate'))).toBe(true);
      expect(run.cards.some((card) => card.sourceRefs.some((ref) => ref.filePath === oldSnapshot))).toBe(true);
      expect(run.cards.some((card) => card.sourceRefs.some((ref) => ref.filePath === oldLog))).toBe(true);
      expect(existsSync(oldSnapshot)).toBe(true);
      expect(existsSync(oldLog)).toBe(true);
    } finally {
      env.dataDir = previousDataDir;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('runs local file intelligence from configured folder watch events', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mini-hub-watch-'));
    try {
      const watchedFile = join(dir, 'study-notes.md');
      writeFileSync(watchedFile, '# Study notes\n\nMatrix review and assignment checklist.', 'utf8');
      const store = createMemoryStore();
      ensurePassiveDefaults(store);
      store.passiveSettings = { ...store.passiveSettings!, watchedFolders: [dir] };
      const listeners = new Map<string, (eventType: string, fileName?: string) => void>();
      const stop = startPassiveTaskWorker(store, {
        externalFetch: healthyServiceFetch(),
        intervalMs: 60_000,
        startupEventName: false,
        fileEventDebounceMs: 1,
        idleDetector: (thresholdMinutes) => ({
          idle: false,
          thresholdMinutes,
          checkedAt: '2026-06-20T10:00:00.000Z',
          source: 'test-active-detector'
        }),
        folderWatcher: (folder, listener) => {
          listeners.set(folder, listener);
          return { close: () => listeners.delete(folder) };
        }
      });
      try {
        const watchedFolder = resolve(dir);
        await waitForCondition(() => listeners.has(watchedFolder));
        listeners.get(watchedFolder)?.('rename', 'study-notes.md');
        await waitForCondition(() => store.passiveRuns.some((run) => run.taskId === 'passive-task:file-intelligence-event'));
      } finally {
        stop();
      }

      const run = store.passiveRuns.find((item) => item.taskId === 'passive-task:file-intelligence-event');
      expect(run).toMatchObject({
        status: 'succeeded',
        metadata: {
          eventName: 'file.changed',
          eventFolder: resolve(dir),
          eventFileName: 'study-notes.md',
          eventFilePath: watchedFile,
          eventKind: 'rename',
          indexedFiles: 1
        }
      });
      expect(run?.changed).toContain(`file:${watchedFile}`);
      expect(run?.changed).toContain('memory:memory-doc-1');
      expect(run?.cards.some((card) => card.sourceRefs.some((ref) => ref.filePath === watchedFile))).toBe(true);
      const fileRef = run?.cards.flatMap((card) => card.sourceRefs).find((ref) => ref.filePath === watchedFile);
      expect(fileRef?.metadata.preview).toContain('Matrix review');
      expect(fileRef?.metadata.tags).toContain('study');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('uses light resource limits to cap passive file memory indexing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mini-hub-file-budget-'));
    try {
      writeFileSync(join(dir, 'alpha-notes.md'), '# Alpha\n\nStudy and project notes.', 'utf8');
      writeFileSync(join(dir, 'beta-notes.md'), '# Beta\n\nMore study and project notes.', 'utf8');
      writeFileSync(join(dir, 'gamma-notes.md'), '# Gamma\n\nEven more study and project notes.', 'utf8');
      const store = createMemoryStore();
      ensurePassiveDefaults(store);
      store.passiveSettings = {
        ...store.passiveSettings!,
        watchedFolders: [dir],
        resourceLimit: 'light'
      };
      let ingestCount = 0;
      const fetchWithIngestCount = (async (input: unknown) => {
        const href = String(input);
        if (href.includes('/api/ai/memory/ingest')) {
          ingestCount += 1;
          return jsonResponse({ result: { document_id: `memory-doc-${ingestCount}`, chunks: 1 } });
        }
        return jsonResponse({ ok: true });
      }) as typeof fetch;
      const task = store.passiveTasks.find((item) => item.family === 'file_intelligence' && item.trigger.kind !== 'event')!;

      const run = await runPassiveTask(store, task.id, {
        externalFetch: fetchWithIngestCount,
        force: true,
        input: { reason: 'file-budget-test' }
      });

      expect(run.status).toBe('succeeded');
      expect(ingestCount).toBe(1);
      expect(run.metadata.indexedFiles).toBe(1);
      expect(run.metadata.fileBudget).toMatchObject({
        filesPerFolder: 8,
        directoryEntriesPerFolder: 200,
        indexableFiles: 1,
        indexedFileChars: 30000
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('persists watcher state across store instances', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mini-hub-passive-'));
    try {
      const first = createMemoryStore();
      const path = passiveTasksPath(dir);
      enablePassiveTaskPersistence(first, path);
      ensurePassiveDefaults(first);
      const watcher = first.passiveWatchers[0]!;
      setPassiveWatcherEnabled(first, watcher.id, false);
      persistPassiveTasks(first);

      const second = createMemoryStore();
      enablePassiveTaskPersistence(second, path);

      expect(second.passiveWatchers.find((item) => item.id === watcher.id)?.enabled).toBe(false);
      expect(second.actionEvents).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('applies retry/backoff state after a failing passive run', async () => {
    const store = createMemoryStore();
    ensurePassiveDefaults(store);
    const task = store.passiveTasks.find((item) => item.family === 'app_health')!;
    const failingFetch = (() => Promise.reject(new Error('service offline'))) as typeof fetch;

    const run = await runPassiveTask(store, task.id, {
      externalFetch: failingFetch,
      force: true,
      input: { reason: 'test' }
    });
    const updated = store.passiveTasks.find((item) => item.id === task.id)!;

    expect(['failed', 'blocked', 'succeeded']).toContain(run.status);
    expect(updated.lastRunAt).toBeTruthy();
    expect(store.passiveRuns[0]?.id).toBe(run.id);
    expect(store.actionEvents[0]?.source).toBe('passive-tasks');
  });

  it('builds source-backed career digest and attention items from real records', async () => {
    const store = createMemoryStore();
    ensurePassiveDefaults(store);
    store.careerActions.push({
      id: 'career-action-1',
      workspaceId: personalWorkspaceId,
      jobId: undefined,
      label: 'Follow up with recruiter',
      dueAt: '2026-06-19T10:00:00.000Z',
      deviceId: 'test',
      updatedAt: '2026-06-20T10:00:00.000Z'
    });
    const task = store.passiveTasks.find((item) => item.family === 'career_radar')!;

    await runPassiveTask(store, task.id, {
      externalFetch: (() => Promise.resolve(jsonResponse({ ok: true }))) as typeof fetch,
      force: true,
      input: { reason: 'test' }
    });

    const digest = buildPassiveDigest(store);
    const attention = collectPassiveAttentionItems(store);

    expect(digest[0]?.sourceRefs[0]?.id).toBe('career-action-1');
    expect(attention[0]?.source).toBe('passive_task');
    expect(attention[0]?.title).toContain('career action');
  });

  it('prepares AI OS research monitors from configured watched domains', async () => {
    const store = createMemoryStore();
    ensurePassiveDefaults(store);
    store.passiveSettings = {
      ...store.passiveSettings!,
      watchedDomains: ['Example.com/news', 'https://docs.example.org/updates', 'https://extra.example.net'],
      localAiPreference: 'local_only',
      resourceLimit: 'light'
    };
    const createdBodies: Array<Record<string, unknown>> = [];
    const researchFetch = (async (input: unknown, init?: RequestInit) => {
      const href = String(input);
      if (href.includes('/api/ai/research/monitors?limit=50')) {
        return jsonResponse({ monitors: [] });
      }
      if (href.endsWith('/api/ai/research/monitors')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        createdBodies.push(body);
        const metadata = body.metadata as Record<string, unknown>;
        return jsonResponse({
          monitor: {
            id: `monitor-${metadata.watched_domain}`,
            name: body.name,
            metadata,
            request: body.request
          }
        });
      }
      if (href.includes('/api/ai/research/monitors/due')) {
        return jsonResponse({ monitors: [] });
      }
      return jsonResponse({ ok: true });
    }) as typeof fetch;

    const task = store.passiveTasks.find((item) => item.family === 'research_monitor')!;
    const run = await runPassiveTask(store, task.id, {
      externalFetch: researchFetch,
      force: true,
      input: { reason: 'watched-domain-test' }
    });

    expect(run.status).toBe('succeeded');
    expect(createdBodies).toHaveLength(2);
    expect(createdBodies[0]).toMatchObject({
      enabled: true,
      schedule: 'daily',
      metadata: { source: 'mini-hub-passive', watched_domain: 'example.com' }
    });
    expect(createdBodies[0]?.request).toMatchObject({
      mode: 'monitor_topic',
      seed_urls: ['https://example.com/'],
      include_domains: ['example.com'],
      max_pages: 3,
      per_domain_limit: 2,
      time_budget_s: 45,
      use_ai: false,
      use_cloud_ai: false,
      metadata: { source: 'mini-hub-passive', watched_domain: 'example.com' }
    });
    expect(run.changed).toContain('research-monitor:monitor-example.com');
    expect(run.cards[0]?.title).toContain('watched domain monitor');
    expect(run.metadata.watchedDomains).toEqual(['example.com', 'docs.example.org']);
    expect(run.metadata.resourceLimit).toBe('light');
  });

  it('persists passive result card triage and filters the source digest', async () => {
    const store = createMemoryStore();
    ensurePassiveDefaults(store);
    store.careerActions.push({
      id: 'career-action-1',
      workspaceId: personalWorkspaceId,
      jobId: undefined,
      label: 'Follow up with recruiter',
      dueAt: '2026-06-19T10:00:00.000Z',
      deviceId: 'test',
      updatedAt: '2026-06-20T10:00:00.000Z'
    });
    const task = store.passiveTasks.find((item) => item.family === 'career_radar')!;
    await runPassiveTask(store, task.id, {
      externalFetch: healthyServiceFetch(),
      force: true,
      input: { reason: 'triage-test' }
    });
    const cardId = buildPassiveDigest(store)[0]!.id;

    updatePassiveCardTriage(store, cardId, 'dismissed', { reason: 'test-dismiss' });
    expect(store.passiveSettings?.cardTriage[cardId]).toMatchObject({ status: 'dismissed', reason: 'test-dismiss' });
    expect(buildPassiveDigest(store).some((card) => card.id === cardId)).toBe(false);
    expect(store.actionEvents.at(-1)).toMatchObject({
      source: 'passive-tasks',
      actionType: 'passive.card.dismissed',
      changed: [`passive-card:${cardId}`]
    });

    updatePassiveCardTriage(store, cardId, 'clear');
    expect(buildPassiveDigest(store).some((card) => card.id === cardId)).toBe(true);

    updatePassiveCardTriage(store, cardId, 'snoozed', { snoozedUntil: new Date(Date.now() + 60_000).toISOString() });
    expect(buildPassiveDigest(store).some((card) => card.id === cardId)).toBe(false);
  });

  it('records pause and resume state transitions', () => {
    const store = createMemoryStore();
    ensurePassiveDefaults(store);
    const task = store.passiveTasks[0]!;

    const paused = updatePassiveTaskStatus(store, task.id, 'paused');
    const resumed = updatePassiveTaskStatus(store, task.id, 'active');

    expect(paused.status).toBe('paused');
    expect(resumed.status).toBe('active');
    expect(store.actionEvents.map((event) => event.actionType)).toEqual(['passive.task.paused', 'passive.task.active']);
  });
});
