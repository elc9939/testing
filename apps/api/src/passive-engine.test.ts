import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
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
  updatePassiveTaskStatus
} from './passive-engine';
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
    const unrelatedDue = duePassiveTasks(store, now, { eventName: 'file.changed' });

    expect(scheduledDue.some((task) => task.trigger.kind === 'event')).toBe(false);
    expect(startupDue).toHaveLength(1);
    expect(startupDue[0]?.id).toBe('passive-task:app-health-startup');
    expect(reconnectDue[0]?.id).toBe('passive-task:app-health-startup');
    expect(oauthDue[0]?.id).toBe('passive-task:app-health-startup');
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
