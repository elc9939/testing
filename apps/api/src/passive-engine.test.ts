import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { personalWorkspaceId, type IntegrationConnection } from '@mini-hub/core';
import {
  buildPassiveDigest,
  buildPassiveSnapshot,
  collectPassiveAttentionItems,
  dismissPassiveNotification,
  duePassiveTasks,
  ensurePassiveDefaults,
  startPassiveTaskWorker,
  runPassiveTask,
  setPassiveWatcherEnabled,
  updatePassiveCardTriage,
  updatePassiveSettings,
  updatePassiveTaskStatus
} from './passive-engine';
import { env } from './env';
import {
  actionLedgerPath,
  appendActionLedgerEvent,
  createMemoryStore,
  enableActionLedgerPersistence,
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
      return jsonResponse({
        jobs: [],
        backups: [{ id: 'backup-1', ok: true }],
        machine_profile: {
          mode: 'balanced',
          created_at: '2026-06-20T10:00:00.000Z',
          provider_summary: { total: 1, available: 1, local_configured: 1, local_available: 1 },
          ai_os_health: { integrity_ok: true, jobs_count: 0, background_units: 0, background_enabled: 0 },
          capability_readiness: { total: 1, available: 1, unavailable: 0 },
          benchmarks: { text_samples: 1 },
          autotune: {
            resource_pressure: { level: 'low', drivers: [], cpu_percent: 12, memory_percent: 36 },
            suggested_max_job_concurrency: 2,
            best_text_route: {
              provider: 'ollama',
              model: 'llama3.1:8b',
              tokens_per_second: 18,
              latency_ms: 500,
              local: true,
              paid: false,
              measured_at: '2026-06-20T10:00:00.000Z'
            },
            confidence: 'measured',
            routing_notes: ['Best measured text route is ollama/llama3.1:8b at 18.0 tokens/sec.']
          }
        }
      });
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

function setMachineMode(store: ReturnType<typeof createMemoryStore>, machineMode: string): void {
  store.settings = {
    workspaceId: personalWorkspaceId,
    highScores: {},
    recentState: {},
    preferences: { machineMode },
    deviceId: 'test',
    updatedAt: '2026-06-20T10:00:00.000Z'
  };
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
    expect(snapshot.triggers.map((trigger) => trigger.id)).toContain('passive-trigger:app_health');
    expect(snapshot.triggers.some((trigger) => trigger.kind === 'event')).toBe(true);
    expect(snapshot.triggers.some((trigger) => trigger.kind === 'idle')).toBe(true);
    expect(snapshot.tasks.some((task) => task.idleOnly)).toBe(true);
    expect(snapshot.results).toEqual([]);
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

  it('uses enabled family settings to gate due tasks and watcher state', () => {
    const store = createMemoryStore();
    const now = new Date('2026-06-20T10:00:00.000Z');
    ensurePassiveDefaults(store, now);
    store.passiveTasks = store.passiveTasks.map((task) => ({
      ...task,
      nextRunAt: '2026-06-20T09:00:00.000Z',
      trigger: { ...task.trigger, nextRunAt: '2026-06-20T09:00:00.000Z' }
    }));

    updatePassiveSettings(store, { enabledFamilies: { research_monitor: false } });
    expect(store.passiveWatchers.find((watcher) => watcher.family === 'research_monitor')?.enabled).toBe(false);
    expect(buildPassiveSnapshot(store).triggers.find((trigger) => trigger.id === 'passive-trigger:research_monitor')?.enabled).toBe(false);
    expect(duePassiveTasks(store, now, { idle: true }).some((task) => task.family === 'research_monitor')).toBe(false);

    updatePassiveSettings(store, { enabledFamilies: { research_monitor: true } });
    expect(store.passiveWatchers.find((watcher) => watcher.family === 'research_monitor')?.enabled).toBe(true);
    expect(buildPassiveSnapshot(store).triggers.find((trigger) => trigger.id === 'passive-trigger:research_monitor')?.enabled).toBe(true);
    expect(duePassiveTasks(store, now, { idle: true }).some((task) => task.family === 'research_monitor')).toBe(true);
  });

  it('applies machine mode policy to due passive tasks', () => {
    const store = createMemoryStore();
    const now = new Date('2026-06-20T10:00:00.000Z');
    ensurePassiveDefaults(store, now);
    store.passiveTasks = store.passiveTasks.map((task) => ({
      ...task,
      nextRunAt: '2026-06-20T09:00:00.000Z',
      trigger: { ...task.trigger, nextRunAt: '2026-06-20T09:00:00.000Z' }
    }));

    setMachineMode(store, 'quiet');
    const quietFamilies = duePassiveTasks(store, now, { idle: true }).map((task) => task.family);
    expect(quietFamilies).toContain('app_health');
    expect(quietFamilies).toContain('backup_snapshot');
    expect(quietFamilies).toContain('career_radar');
    expect(quietFamilies).not.toContain('idle_compute');
    expect(quietFamilies).not.toContain('research_monitor');
    expect(quietFamilies).not.toContain('file_intelligence');
    expect(quietFamilies).not.toContain('project_drift');

    setMachineMode(store, 'offline');
    const offlineFamilies = duePassiveTasks(store, now, { idle: true }).map((task) => task.family);
    expect(offlineFamilies).not.toContain('research_monitor');
    expect(offlineFamilies).toContain('file_intelligence');

    store.passiveTasks = store.passiveTasks.map((task) =>
      task.family === 'project_drift' ? { ...task, machineMode: 'night' } : task
    );
    setMachineMode(store, 'balanced');
    expect(duePassiveTasks(store, now, { idle: true }).some((task) => task.family === 'project_drift')).toBe(false);
    setMachineMode(store, 'night');
    expect(duePassiveTasks(store, now, { idle: true }).some((task) => task.family === 'project_drift')).toBe(true);
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

  it('exposes passive worker lifecycle, idle, and tick state in snapshots', async () => {
    const store = createMemoryStore();
    ensurePassiveDefaults(store);
    store.passiveTasks = store.passiveTasks.map((task) => ({
      ...task,
      nextRunAt: '2099-06-20T10:00:00.000Z',
      trigger: { ...task.trigger, nextRunAt: task.trigger.kind === 'event' ? undefined : '2099-06-20T10:00:00.000Z' }
    }));

    const stop = startPassiveTaskWorker(store, {
      externalFetch: healthyServiceFetch(),
      intervalMs: 50,
      startupEventName: false,
      idleDetector: async (thresholdMinutes) => ({
        idle: true,
        thresholdMinutes,
        checkedAt: '2026-06-20T10:00:00.000Z',
        source: 'test-idle',
        idleMinutes: thresholdMinutes + 1
      })
    });

    try {
      await waitForCondition(() => Boolean(buildPassiveSnapshot(store).worker.lastTickFinishedAt));
      const snapshot = buildPassiveSnapshot(store);
      expect(snapshot.worker).toMatchObject({
        id: 'passive-worker',
        enabled: true,
        running: false,
        intervalMs: 50,
        activeFileWatchCount: 0,
        pendingFileEvent: false,
        lastEventName: 'tick',
        lastIdle: {
          idle: true,
          source: 'test-idle'
        }
      });
      expect(snapshot.worker.startedAt).toBeTruthy();
      expect(snapshot.worker.lastTickAt).toBeTruthy();
      expect(snapshot.worker.lastTickFinishedAt).toBeTruthy();
      expect(snapshot.worker.nextTickAt).toBeTruthy();
    } finally {
      stop();
    }

    const stopped = buildPassiveSnapshot(store).worker;
    expect(stopped.running).toBe(false);
    expect(stopped.stoppedAt).toBeTruthy();
    expect(stopped.activeFileWatchCount).toBe(0);
  });

  it('keeps disabled engine worker ticks quiet without idle probes or due runs', async () => {
    const store = createMemoryStore();
    ensurePassiveDefaults(store);
    updatePassiveSettings(store, { enabled: false });
    store.passiveTasks = store.passiveTasks.map((task) => ({
      ...task,
      nextRunAt: '2026-06-20T09:00:00.000Z',
      trigger: { ...task.trigger, nextRunAt: task.trigger.kind === 'event' ? undefined : '2026-06-20T09:00:00.000Z' }
    }));
    let idleProbeCount = 0;
    const stop = startPassiveTaskWorker(store, {
      externalFetch: healthyServiceFetch(),
      intervalMs: 50,
      startupEventName: false,
      idleDetector: async (thresholdMinutes) => {
        idleProbeCount += 1;
        return {
          idle: true,
          thresholdMinutes,
          checkedAt: '2026-06-20T10:00:00.000Z',
          source: 'should-not-run',
          idleMinutes: thresholdMinutes + 1
        };
      }
    });

    try {
      await waitForCondition(() => buildPassiveSnapshot(store).worker.lastIdle?.source === 'engine-disabled');
    } finally {
      stop();
    }

    const snapshot = buildPassiveSnapshot(store);
    expect(idleProbeCount).toBe(0);
    expect(store.passiveRuns).toEqual([]);
    expect(snapshot.worker.enabled).toBe(false);
    expect(snapshot.worker.pendingFileEvent).toBe(false);
    expect(snapshot.worker.lastIdle).toMatchObject({
      idle: false,
      source: 'engine-disabled'
    });
  });

  it('surfaces missing configured Ollama models with endpoint port metadata', async () => {
    const previousModel = env.ollamaChatModel;
    try {
      env.ollamaChatModel = 'llama3.1:8b';
      const store = createMemoryStore();
      ensurePassiveDefaults(store);
      const task = store.passiveTasks.find((item) => item.family === 'app_health')!;
      const fetchWithDifferentModel = (async (input: unknown) => {
        const href = String(input);
        if (href.includes('/api/ai/status')) {
          return jsonResponse({ jobs: [], backups: [{ id: 'backup-1', ok: true }] });
        }
        if (href.includes('/api/macro-lab/status')) {
          return jsonResponse({ ok: true, engine: { panic: false } });
        }
        if (href.includes('/api/tags')) {
          return jsonResponse({ models: [{ name: 'mistral:7b' }] });
        }
        return jsonResponse({ ok: true });
      }) as typeof fetch;

      const run = await runPassiveTask(store, task.id, {
        externalFetch: fetchWithDifferentModel,
        force: true,
        input: { reason: 'model-health-test' }
      });

      const modelCard = run.cards.find((card) => card.title === 'Configured Ollama model is not installed');
      expect(run.status).toBe('succeeded');
      expect(modelCard?.summary).toContain('llama3.1:8b');
      expect(modelCard?.sourceRefs[0]?.metadata).toMatchObject({
        host: '127.0.0.1',
        port: '11434',
        configuredModel: 'llama3.1:8b',
        modelCount: 1,
        models: ['mistral:7b']
      });
      expect(run.metadata).toMatchObject({
        configuredOllamaModel: 'llama3.1:8b',
        ollamaModels: ['mistral:7b'],
        ollamaModelCount: 1
      });
      expect(run.metadata.serviceEndpoints).toMatchObject({
        miniHubApi: { port: String(env.port) },
        ollama: { port: '11434' }
      });
    } finally {
      env.ollamaChatModel = previousModel;
    }
  });

  it('surfaces measured AI OS machine profile pressure in app health', async () => {
    const store = createMemoryStore();
    ensurePassiveDefaults(store);
    const task = store.passiveTasks.find((item) => item.family === 'app_health')!;
    const fetchWithPressure = (async (input: unknown) => {
      const href = String(input);
      if (href.includes('/api/ai/status')) {
        return jsonResponse({
          jobs: [],
          backups: [{ id: 'backup-1', ok: true }],
          machine_profile: {
            mode: 'beast',
            created_at: '2026-06-20T10:00:00.000Z',
            provider_summary: { total: 3, available: 1, local_configured: 1, local_available: 1 },
            ai_os_health: { integrity_ok: true, jobs_count: 4, background_units: 2, background_enabled: 1 },
            capability_readiness: { total: 8, available: 6, unavailable: 2 },
            benchmarks: { text_samples: 3 },
            autotune: {
              resource_pressure: {
                level: 'high',
                drivers: ['gpu', 'vram'],
                cpu_percent: 42,
                memory_percent: 64,
                gpu_utilization_percent: 97,
                vram_percent: 91
              },
              suggested_max_job_concurrency: 1,
              best_text_route: {
                provider: 'ollama',
                model: 'llama3.1:8b',
                tokens_per_second: 18.5,
                latency_ms: 420,
                local: true,
                paid: false,
                measured_at: '2026-06-20T09:55:00.000Z'
              },
              confidence: 'measured',
              routing_notes: ['Resource pressure is high; new local AI work should stay conservative until utilization drops.']
            }
          }
        });
      }
      if (href.includes('/api/macro-lab/status')) {
        return jsonResponse({ ok: true, engine: { panic: false } });
      }
      if (href.includes('/api/tags')) {
        return jsonResponse({ models: [{ name: 'llama3.1:8b' }] });
      }
      return jsonResponse({ ok: true });
    }) as typeof fetch;

    const run = await runPassiveTask(store, task.id, {
      externalFetch: fetchWithPressure,
      force: true,
      input: { reason: 'machine-profile-pressure-test' }
    });

    const pressureCard = run.cards.find((card) => card.title === 'AI OS resource pressure is high');
    expect(run.status).toBe('succeeded');
    expect(pressureCard?.summary).toContain('gpu, vram');
    expect(pressureCard?.summary).toContain('Suggested max job concurrency is 1');
    expect(pressureCard?.sourceRefs[0]?.metadata.machineProfile).toMatchObject({
      mode: 'beast',
      aiOsIntegrityOk: true,
      textBenchmarkSamples: 3,
      suggestedMaxJobConcurrency: 1,
      resourcePressure: {
        level: 'high',
        drivers: ['gpu', 'vram'],
        gpuUtilizationPercent: 97,
        vramPercent: 91
      },
      bestTextRoute: {
        label: 'ollama/llama3.1:8b',
        tokensPerSecond: 18.5,
        local: true
      }
    });
    expect(run.metadata.aiOsMachineProfile).toMatchObject({
      available: true,
      source: 'status.machine_profile',
      resourcePressure: { level: 'high', drivers: ['gpu', 'vram'] },
      bestTextRoute: { label: 'ollama/llama3.1:8b' }
    });
  });

  it('scopes integration health findings to configured watched accounts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mini-hub-account-scope-'));
    const previousDataDir = env.dataDir;
    try {
      env.dataDir = dir;
      const store = createMemoryStore();
      ensurePassiveDefaults(store);
      store.passiveSettings = { ...store.passiveSettings!, watchedAccounts: ['school@example.edu'] };
      const now = '2026-06-20T10:00:00.000Z';
      const personalConnection = {
        id: 'google-personal',
        workspaceId: personalWorkspaceId,
        provider: 'google',
        accountLabel: 'personal@example.com',
        scopes: [],
        encryptedTokenSet: '',
        status: 'needs_reauth',
        createdAt: now,
        updatedAt: now
      } satisfies IntegrationConnection;
      const schoolConnection = {
        id: 'google-school',
        workspaceId: personalWorkspaceId,
        provider: 'google',
        accountLabel: 'school@example.edu',
        scopes: [],
        encryptedTokenSet: '',
        status: 'error',
        error: 'refresh failed',
        createdAt: now,
        updatedAt: now
      } satisfies IntegrationConnection;
      store.integrationConnections.set(personalConnection.id, personalConnection);
      store.integrationConnections.set(schoolConnection.id, schoolConnection);
      const task = store.passiveTasks.find((item) => item.family === 'app_health')!;

      const run = await runPassiveTask(store, task.id, {
        externalFetch: healthyServiceFetch(),
        force: true,
        input: { reason: 'account-scope-test' }
      });

      const connectionCard = run.cards.find((card) => card.title === '1 integration connection need attention');
      expect(run.status).toBe('succeeded');
      expect(connectionCard?.summary).toContain('school@example.edu');
      expect(connectionCard?.summary).not.toContain('personal@example.com');
      expect(connectionCard?.sourceRefs).toHaveLength(1);
      expect(connectionCard?.sourceRefs[0]?.metadata).toMatchObject({
        provider: 'google',
        status: 'error',
        accountLabel: 'school@example.edu',
        watchedAccountScoped: true
      });
      expect(run.metadata).toMatchObject({
        watchedAccounts: ['school@example.edu'],
        totalIntegrationConnectionIssues: 2,
        integrationConnectionIssues: 1,
        ignoredIntegrationConnectionIssues: 1
      });
    } finally {
      env.dataDir = previousDataDir;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('creates read-verified Mini Hub restore snapshots with redacted integration tokens', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mini-hub-backup-'));
    const previousDataDir = env.dataDir;
    try {
      env.dataDir = dir;
      const store = createMemoryStore();
      ensurePassiveDefaults(store);
      store.jobs.push({
        id: 'job-1',
        workspaceId: personalWorkspaceId,
        company: 'Acme',
        role: 'Data Analyst',
        status: 'lead',
        applicationUrl: '',
        notes: '',
        deviceId: 'test',
        updatedAt: '2026-06-20T10:00:00.000Z'
      });
      store.integrationConnections.set('google-personal', {
        id: 'google-personal',
        workspaceId: personalWorkspaceId,
        provider: 'google',
        accountLabel: 'personal@example.com',
        scopes: ['gmail.readonly'],
        encryptedTokenSet: 'secret-token-payload',
        status: 'connected',
        createdAt: '2026-06-20T10:00:00.000Z',
        updatedAt: '2026-06-20T10:00:00.000Z'
      });
      appendActionLedgerEvent(store, {
        system: 'mini-hub',
        source: 'passive-tasks',
        actionType: 'passive.file_intelligence',
        summary: 'Local File Intelligence succeeded',
        status: 'succeeded',
        risk: 'read',
        changed: ['file:C:\\Users\\Edward\\Downloads\\notes.md'],
        recoverability: {
          kind: 'artifact',
          route: '/passive-tasks',
          description: 'Passive run history records outputs and source references.',
          reversible: false
        },
        rawRef: { kind: 'passive_run', authorization: 'Bearer secret-bearer-token' },
        metadata: { workspaceId: personalWorkspaceId, refreshToken: 'secret-ledger-token' }
      });
      const task = store.passiveTasks.find((item) => item.family === 'backup_snapshot')!;
      const backupFetch = (async (input: unknown, init?: RequestInit) => {
        const href = String(input);
        if (href.endsWith('/api/ai/backups')) return jsonResponse({ backup: { id: 'backup-1', ok: true } });
        return healthyServiceFetch()(input as Parameters<typeof fetch>[0], init as Parameters<typeof fetch>[1]);
      }) as typeof fetch;

      const run = await runPassiveTask(store, task.id, {
        externalFetch: backupFetch,
        force: true,
        input: { reason: 'backup-verification-test' }
      });

      const snapshotPath = String(run.metadata.snapshotPath);
      const snapshotText = readFileSync(snapshotPath, 'utf8');
      const snapshot = JSON.parse(snapshotText) as {
        jobs: unknown[];
        integrationConnections: Array<{ encryptedTokenSet: string }>;
        syncEvents: unknown[];
        actionEvents: Array<{ metadata?: { refreshToken?: string }; rawRef?: { authorization?: string } }>;
        passiveTasks: unknown[];
        passiveResults: unknown[];
      };
      const snapshotRef = run.cards[0]?.sourceRefs[0];
      expect(run.status).toBe('succeeded');
      expect(existsSync(snapshotPath)).toBe(true);
      expect(run.changed).toContain(`snapshot:${snapshotPath}`);
      expect(run.metadata).toMatchObject({
        snapshotVerified: true,
        snapshotBytes: snapshotText.length,
        redactedTokenSets: 1,
        snapshotSummary: {
          jobs: 1,
          integrationConnections: 1,
          actionEvents: 1
        },
        aiBackup: {
          requested: true,
          id: 'backup-1'
        }
      });
      expect(String(run.metadata.snapshotSha256)).toMatch(/^[a-f0-9]{64}$/u);
      expect(snapshot.jobs).toHaveLength(1);
      expect(snapshot.passiveTasks.length).toBeGreaterThan(0);
      expect(snapshot.passiveResults).toHaveLength(0);
      expect(snapshot.actionEvents[0]?.metadata?.refreshToken).toBe('[redacted]');
      expect(snapshot.actionEvents[0]?.rawRef?.authorization).toBe('[redacted]');
      expect(snapshot.integrationConnections[0]?.encryptedTokenSet).toBe('[encrypted-redacted]');
      expect(snapshotText).not.toContain('secret-token-payload');
      expect(snapshotText).not.toContain('secret-ledger-token');
      expect(snapshotText).not.toContain('secret-bearer-token');
      expect(snapshotRef?.metadata).toMatchObject({
        verified: true,
        redactedTokenSets: 1
      });
      expect(snapshotRef?.metadata.sha256).toBe(run.metadata.snapshotSha256);
    } finally {
      env.dataDir = previousDataDir;
      rmSync(dir, { recursive: true, force: true });
    }
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

  it('queues bounded AI OS summaries of passive digest cards during idle compute', async () => {
    const store = createMemoryStore();
    ensurePassiveDefaults(store, new Date('2026-06-20T10:00:00.000Z'));
    store.jobs.push({
      id: 'job-summary-source',
      workspaceId: personalWorkspaceId,
      company: 'Summary Co',
      role: 'Data Analyst',
      status: 'lead',
      applicationUrl: '',
      notes: '',
      deviceId: 'test',
      updatedAt: '2026-05-01T10:00:00.000Z'
    });
    const careerTask = store.passiveTasks.find((item) => item.family === 'career_radar')!;
    await runPassiveTask(store, careerTask.id, {
      externalFetch: healthyServiceFetch(),
      force: true,
      input: { reason: 'idle-summary-source' }
    });
    const sourceCardId = store.passiveResults[0]!.id;

    const jobBodies: Array<Record<string, unknown>> = [];
    const idleFetch = (async (input: unknown, init?: RequestInit) => {
      const href = String(input);
      if (href.includes('/api/ai/jobs')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        jobBodies.push(body);
        return jsonResponse({
          job: {
            id: 'job-idle-summary-1',
            primitive: 'chunk_summarize',
            status: 'queued',
            created_at: '2026-06-20T10:00:00.000Z',
            updated_at: '2026-06-20T10:00:00.000Z',
            total: 1,
            completed: 0,
            failed: 0,
            progress: 0,
            metadata: body.metadata
          }
        });
      }
      if (href.includes('/api/ai/benchmarks')) {
        return jsonResponse({ benchmark: { id: 'benchmark-idle-summary-1', tokens_per_second: 32.5 } });
      }
      return healthyServiceFetch()(input as Parameters<typeof fetch>[0], init as Parameters<typeof fetch>[1]);
    }) as typeof fetch;
    const idleTask = store.passiveTasks.find((item) => item.family === 'idle_compute')!;

    const run = await runPassiveTask(store, idleTask.id, {
      externalFetch: idleFetch,
      force: true,
      input: { idle: true, reason: 'idle-summary-test' }
    });

    const request = jobBodies[0]?.request as Record<string, unknown> | undefined;
    const metadata = jobBodies[0]?.metadata as Record<string, unknown> | undefined;
    expect(run.status).toBe('succeeded');
    expect(jobBodies).toHaveLength(1);
    expect(jobBodies[0]).toMatchObject({
      primitive: 'chunk_summarize',
      chunk_size: 2200,
      metadata: {
        source: 'passive-task',
        task_id: idleTask.id,
        local_ai_preference: 'local_first',
        card_count: 1
      }
    });
    expect(String(jobBodies[0]?.text)).toContain('Summary Co - Data Analyst');
    expect(request).toMatchObject({
      task_type: 'summarize',
      local_first: true,
      allow_fallback: false,
      cost_ceiling_usd: 0
    });
    expect(metadata?.source_card_ids).toEqual([sourceCardId]);
    expect(run.changed).toContain('ai-job:job-idle-summary-1');
    expect(run.metadata.idleSummary).toMatchObject({
      queued: true,
      jobId: 'job-idle-summary-1',
      cardCount: 1,
      localFirst: true,
      allowFallback: false
    });
    expect(run.cards.some((card) => card.title === 'Idle passive digest summary queued')).toBe(true);
  });

  it('defers idle AI jobs when recent machine profile pressure is high', async () => {
    const store = createMemoryStore();
    ensurePassiveDefaults(store, new Date('2026-06-20T10:00:00.000Z'));
    const appHealthTask = store.passiveTasks.find((item) => item.family === 'app_health')!;
    const idleTask = store.passiveTasks.find((item) => item.family === 'idle_compute')!;
    let aiJobCalls = 0;
    let benchmarkCalls = 0;
    const pressureFetch = (async (input: unknown, init?: RequestInit) => {
      const href = String(input);
      if (href.includes('/api/ai/status')) {
        return jsonResponse({
          jobs: [],
          backups: [{ id: 'backup-1', ok: true }],
          machine_profile: {
            mode: 'beast',
            created_at: '2026-06-20T10:00:00.000Z',
            provider_summary: { total: 1, available: 1, local_configured: 1, local_available: 1 },
            ai_os_health: { integrity_ok: true, jobs_count: 0 },
            capability_readiness: { total: 4, available: 4, unavailable: 0 },
            benchmarks: { text_samples: 2 },
            autotune: {
              resource_pressure: {
                level: 'high',
                drivers: ['gpu', 'vram'],
                gpu_utilization_percent: 98,
                vram_percent: 93
              },
              suggested_max_job_concurrency: 1,
              best_text_route: {
                provider: 'ollama',
                model: 'llama3.1:8b',
                tokens_per_second: 22,
                local: true,
                paid: false
              },
              confidence: 'measured'
            }
          }
        });
      }
      if (href.includes('/api/ai/jobs')) {
        aiJobCalls += 1;
      }
      if (href.includes('/api/ai/benchmarks')) {
        benchmarkCalls += 1;
      }
      return healthyServiceFetch()(input as Parameters<typeof fetch>[0], init as Parameters<typeof fetch>[1]);
    }) as typeof fetch;

    await runPassiveTask(store, appHealthTask.id, {
      externalFetch: pressureFetch,
      force: true,
      input: { reason: 'pressure-source' }
    });

    const run = await runPassiveTask(store, idleTask.id, {
      externalFetch: pressureFetch,
      force: true,
      input: { idle: true, reason: 'pressure-gate-test' }
    });

    expect(run.status).toBe('succeeded');
    expect(aiJobCalls).toBe(0);
    expect(benchmarkCalls).toBe(0);
    expect(run.cards[0]?.title).toBe('Idle local AI work deferred by machine pressure');
    expect(run.metadata.resourceDecision).toMatchObject({
      source: 'app-health-run',
      profileFresh: true,
      heavyAiAllowed: false,
      resourcePressureLevel: 'high',
      resourcePressureDrivers: ['gpu', 'vram'],
      suggestedMaxJobConcurrency: 1
    });
    expect(run.metadata.idleSummary).toMatchObject({
      queued: false,
      reason: 'resource-policy'
    });
    expect(run.metadata.benchmark).toMatchObject({
      queued: false,
      reason: 'resource-policy'
    });
  });

  it('uses the measured local route for Beast Mode idle AI jobs', async () => {
    const store = createMemoryStore();
    ensurePassiveDefaults(store, new Date('2026-06-20T10:00:00.000Z'));
    setMachineMode(store, 'beast');
    const appHealthTask = store.passiveTasks.find((item) => item.family === 'app_health')!;
    await runPassiveTask(store, appHealthTask.id, {
      externalFetch: healthyServiceFetch(),
      force: true,
      input: { reason: 'beast-route-source' }
    });
    store.careerActions.push({
      id: 'career-action-beast-route',
      workspaceId: personalWorkspaceId,
      jobId: undefined,
      label: 'Review measured local route',
      dueAt: '2026-06-19T10:00:00.000Z',
      deviceId: 'test',
      updatedAt: '2026-06-20T10:00:00.000Z'
    });
    const careerTask = store.passiveTasks.find((item) => item.family === 'career_radar')!;
    await runPassiveTask(store, careerTask.id, {
      externalFetch: healthyServiceFetch(),
      force: true,
      input: { reason: 'beast-digest-source' }
    });

    const jobBodies: Array<Record<string, unknown>> = [];
    const benchmarkBodies: Array<Record<string, unknown>> = [];
    const idleFetch = (async (input: unknown, init?: RequestInit) => {
      const href = String(input);
      if (href.includes('/api/ai/jobs')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        jobBodies.push(body);
        return jsonResponse({
          job: {
            id: 'job-beast-route',
            primitive: 'chunk_summarize',
            status: 'queued',
            created_at: '2026-06-20T10:00:00.000Z',
            updated_at: '2026-06-20T10:00:00.000Z',
            total: 1,
            completed: 0,
            failed: 0,
            progress: 0,
            metadata: body.metadata
          }
        });
      }
      if (href.includes('/api/ai/benchmarks')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        benchmarkBodies.push(body);
        return jsonResponse({ benchmark: { id: 'benchmark-beast-route', tokens_per_second: 34, provider: body.provider, model: body.model } });
      }
      return healthyServiceFetch()(input as Parameters<typeof fetch>[0], init as Parameters<typeof fetch>[1]);
    }) as typeof fetch;
    const idleTask = store.passiveTasks.find((item) => item.family === 'idle_compute')!;

    const run = await runPassiveTask(store, idleTask.id, {
      externalFetch: idleFetch,
      force: true,
      input: { idle: true, reason: 'beast-route-test' }
    });

    expect(run.status).toBe('succeeded');
    expect(jobBodies[0]).toMatchObject({
      concurrency: 2,
      request: {
        provider: 'ollama',
        model: 'llama3.1:8b'
      }
    });
    expect(benchmarkBodies[0]).toMatchObject({
      provider: 'ollama',
      model: 'llama3.1:8b'
    });
    expect(run.metadata.resourceDecision).toMatchObject({
      mode: 'beast',
      heavyAiAllowed: true,
      preferredLocalRoute: {
        provider: 'ollama',
        model: 'llama3.1:8b',
        label: 'ollama/llama3.1:8b'
      },
      suggestedMaxJobConcurrency: 2
    });
    expect(run.metadata.idleSummary).toMatchObject({
      concurrency: 2,
      preferredRoute: {
        provider: 'ollama',
        model: 'llama3.1:8b',
        source: 'ai-os-machine-profile'
      }
    });
    expect(run.metadata.benchmark).toMatchObject({
      queued: true,
      preferredRoute: {
        provider: 'ollama',
        model: 'llama3.1:8b',
        source: 'ai-os-machine-profile'
      }
    });
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

  it('drops watched-folder events after the passive engine is disabled', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mini-hub-disabled-watch-'));
    try {
      const watchedFile = join(dir, 'quiet-notes.md');
      writeFileSync(watchedFile, '# Quiet\n\nThis should not queue while disabled.', 'utf8');
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
        const listener = listeners.get(watchedFolder)!;
        updatePassiveSettings(store, { enabled: false });
        listener('rename', 'quiet-notes.md');
        await waitForCondition(() => !listeners.has(watchedFolder));
      } finally {
        stop();
      }

      const snapshot = buildPassiveSnapshot(store);
      expect(store.passiveRuns.some((run) => run.taskId === 'passive-task:file-intelligence-event')).toBe(false);
      expect(snapshot.worker).toMatchObject({
        enabled: false,
        activeFileWatchCount: 0,
        pendingFileEvent: false,
        lastEventName: 'file.changed'
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('extracts source-backed metadata for PDFs, docs, and screenshots without indexing binary files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mini-hub-file-metadata-'));
    try {
      const pdfPath = join(dir, 'assignment-report.pdf');
      const pngPath = join(dir, 'screenshot-capture.png');
      const docxPath = join(dir, 'course-notes.docx');
      writeFileSync(
        pdfPath,
        '%PDF-1.7\n1 0 obj << /Type /Page >> endobj\n2 0 obj << /Type /Pages >> endobj\n3 0 obj << /Type /Page >> endobj\n%%EOF',
        'latin1'
      );
      writeFileSync(
        pngPath,
        Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', 'base64')
      );
      writeFileSync(docxPath, Buffer.from('PK\u0003\u0004word/document.xml docProps/core.xml word/media/image1.png', 'utf8'));
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
        if (href.includes('/api/ai/memory/ingest')) ingestCount += 1;
        return healthyServiceFetch()(input as Parameters<typeof fetch>[0]);
      }) as typeof fetch;
      const task = store.passiveTasks.find((item) => item.family === 'file_intelligence')!;

      const run = await runPassiveTask(store, task.id, {
        externalFetch: fetchWithIngestCount,
        force: true,
        input: { reason: 'binary-metadata-test' }
      });

      const refs = run.cards.flatMap((card) => card.sourceRefs);
      const pdfRef = refs.find((ref) => ref.filePath === pdfPath);
      const pngRef = refs.find((ref) => ref.filePath === pngPath);
      const docxRef = refs.find((ref) => ref.filePath === docxPath);
      expect(run.status).toBe('succeeded');
      expect(pdfRef?.metadata).toMatchObject({
        extension: '.pdf',
        kind: 'document',
        pdfVersion: '1.7',
        pageCountApprox: 2
      });
      expect(pdfRef?.metadata.tags).toContain('study');
      expect(pngRef?.metadata).toMatchObject({
        extension: '.png',
        kind: 'image',
        width: 1,
        height: 1,
        likelyScreenshot: true
      });
      expect(pngRef?.metadata.tags).toContain('screenshot');
      expect(docxRef?.metadata).toMatchObject({
        extension: '.docx',
        kind: 'document',
        officePackage: true
      });
      expect(docxRef?.metadata.docxParts).toEqual(expect.arrayContaining(['document', 'core-properties', 'embedded-media']));
      expect(run.metadata.fileKinds).toEqual(expect.arrayContaining(['document', 'image']));
      expect(run.metadata.fileCount).toBe(3);
      expect(run.metadata.indexedFiles).toBe(0);
      expect(ingestCount).toBe(0);
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

  it('skips unchanged files that were already indexed in a persisted passive run', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mini-hub-file-dedupe-'));
    try {
      const passivePath = passiveTasksPath(dir);
      const watchedDir = join(dir, 'watched');
      mkdirSync(watchedDir, { recursive: true });
      const notePath = join(watchedDir, 'repeat-notes.md');
      writeFileSync(notePath, '# Repeat\n\nOnly index this unchanged note once.', 'utf8');

      const first = createMemoryStore();
      enablePassiveTaskPersistence(first, passivePath);
      ensurePassiveDefaults(first);
      first.passiveSettings = { ...first.passiveSettings!, watchedFolders: [watchedDir], resourceLimit: 'light' };
      let ingestCount = 0;
      const fetchWithIngestCount = (async (input: unknown) => {
        const href = String(input);
        if (href.includes('/api/ai/memory/ingest')) {
          ingestCount += 1;
          return jsonResponse({ result: { document_id: `memory-repeat-${ingestCount}`, chunks: 1 } });
        }
        return jsonResponse({ ok: true });
      }) as typeof fetch;
      const firstTask = first.passiveTasks.find((item) => item.family === 'file_intelligence' && item.trigger.kind !== 'event')!;

      const firstRun = await runPassiveTask(first, firstTask.id, {
        externalFetch: fetchWithIngestCount,
        force: true,
        input: { reason: 'file-dedupe-first' }
      });
      persistPassiveTasks(first);

      const second = createMemoryStore();
      enablePassiveTaskPersistence(second, passivePath);
      ensurePassiveDefaults(second);
      const secondTask = second.passiveTasks.find((item) => item.family === 'file_intelligence' && item.trigger.kind !== 'event')!;
      const secondRun = await runPassiveTask(second, secondTask.id, {
        externalFetch: fetchWithIngestCount,
        force: true,
        input: { reason: 'file-dedupe-second' }
      });

      writeFileSync(notePath, '# Repeat\n\nThe note changed and should index again.', 'utf8');
      const changedDate = new Date('2026-06-22T10:00:00.000Z');
      utimesSync(notePath, changedDate, changedDate);
      const thirdRun = await runPassiveTask(second, secondTask.id, {
        externalFetch: fetchWithIngestCount,
        force: true,
        input: { reason: 'file-dedupe-after-edit' }
      });

      expect(firstRun.metadata).toMatchObject({
        indexedFiles: 1,
        skippedAlreadyIndexedFiles: 0
      });
      expect(secondRun.metadata).toMatchObject({
        indexedFiles: 0,
        skippedAlreadyIndexedFiles: 1
      });
      expect(thirdRun.metadata).toMatchObject({
        indexedFiles: 1,
        skippedAlreadyIndexedFiles: 0
      });
      expect(ingestCount).toBe(2);
      expect(firstRun.changed).toContain('memory:memory-repeat-1');
      expect(secondRun.changed).not.toContain('memory:memory-repeat-2');
      expect(thirdRun.changed).toContain('memory:memory-repeat-2');
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
      expect(second.passiveTriggers.find((item) => item.watcherId === watcher.id)?.enabled).toBe(false);
      expect(second.actionEvents).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('persists passive worker state while clearing stale runtime handles after restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mini-hub-passive-worker-'));
    try {
      const watchedFolder = join(dir, 'watched');
      mkdirSync(watchedFolder);
      const path = passiveTasksPath(dir);
      const first = createMemoryStore();
      enablePassiveTaskPersistence(first, path);
      ensurePassiveDefaults(first);
      first.passiveSettings = { ...first.passiveSettings!, watchedFolders: [watchedFolder] };
      persistPassiveTasks(first);

      const stop = startPassiveTaskWorker(first, {
        externalFetch: healthyServiceFetch(),
        intervalMs: 60_000,
        startupEventName: false,
        idleDetector: (thresholdMinutes) => ({
          idle: false,
          thresholdMinutes,
          checkedAt: '2026-06-20T10:00:00.000Z',
          source: 'test-active-detector'
        }),
        folderWatcher: () => ({ close: () => {} })
      });
      let persisted = {} as { worker?: Record<string, unknown> };
      try {
        await waitForCondition(() => {
          persisted = JSON.parse(readFileSync(path, 'utf8')) as { worker?: Record<string, unknown> };
          return persisted.worker?.running === true || persisted.worker?.activeFileWatchCount === 1;
        });
        expect(persisted.worker).toMatchObject({
          activeFileWatchCount: 1,
          pendingFileEvent: false
        });
      } finally {
        stop();
      }

      writeFileSync(
        path,
        JSON.stringify(
          {
            ...persisted,
            worker: {
              ...persisted.worker,
              running: true,
              activeFileWatchCount: 2,
              pendingFileEvent: true
            }
          },
          null,
          2
        ),
        'utf8'
      );

      const second = createMemoryStore();
      enablePassiveTaskPersistence(second, path);

      expect(second.passiveWorker).toMatchObject({
        running: false,
        activeFileWatchCount: 0,
        pendingFileEvent: false
      });
      expect(second.passiveWorker?.stoppedAt).toBeTruthy();
      expect(buildPassiveSnapshot(second).worker.running).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('updates first-class trigger run state after a passive task fires', async () => {
    const store = createMemoryStore();
    ensurePassiveDefaults(store);
    const task = store.passiveTasks.find((item) => item.family === 'app_health' && item.trigger.kind === 'schedule')!;

    const run = await runPassiveTask(store, task.id, {
      externalFetch: healthyServiceFetch(),
      force: true,
      input: { reason: 'trigger-state-test' }
    });

    const trigger = buildPassiveSnapshot(store).triggers.find((item) => item.id === task.trigger.id);
    expect(run.status).toBe('succeeded');
    expect(store.passiveResults.map((result) => result.id)).toEqual(run.cards.map((card) => card.id));
    expect(trigger).toMatchObject({
      id: task.trigger.id,
      watcherId: task.watcherId,
      taskIds: [task.id],
      lastRunId: run.id,
      lastStatus: 'succeeded',
      lastFiredAt: run.finishedAt,
      nextRunAt: run.nextRunAt
    });
  });

  it('records manual runs on a manual trigger without moving the schedule trigger', async () => {
    const store = createMemoryStore();
    ensurePassiveDefaults(store);
    const task = store.passiveTasks.find((item) => item.family === 'app_health' && item.trigger.kind === 'schedule')!;
    const scheduledAt = '2026-06-21T10:00:00.000Z';
    store.passiveTasks = store.passiveTasks.map((item) =>
      item.id === task.id ? { ...item, nextRunAt: scheduledAt, trigger: { ...item.trigger, nextRunAt: scheduledAt } } : item
    );
    store.passiveTriggers = store.passiveTriggers.map((trigger) =>
      trigger.id === task.trigger.id ? { ...trigger, nextRunAt: scheduledAt } : trigger
    );
    const beforeScheduleTrigger = buildPassiveSnapshot(store).triggers.find((item) => item.id === task.trigger.id)!;

    const run = await runPassiveTask(store, task.id, {
      externalFetch: healthyServiceFetch(),
      input: { reason: 'manual-trigger-test', manual: true }
    });
    const snapshot = buildPassiveSnapshot(store);
    const scheduleTrigger = snapshot.triggers.find((item) => item.id === task.trigger.id)!;
    const manualTrigger = snapshot.triggers.find((item) => item.id === `passive-trigger:manual:${task.id}`)!;
    const watcher = snapshot.watchers.find((item) => item.id === task.watcherId)!;
    const updatedTask = snapshot.tasks.find((item) => item.id === task.id)!;

    expect(run.status).toBe('succeeded');
    expect(run.metadata).toMatchObject({ reason: 'manual-trigger-test', triggerKind: 'manual' });
    expect(scheduleTrigger).toMatchObject({
      id: beforeScheduleTrigger.id,
      kind: 'schedule',
      nextRunAt: scheduledAt
    });
    expect(scheduleTrigger.lastRunId).toBeUndefined();
    expect(manualTrigger).toMatchObject({
      kind: 'manual',
      watcherId: task.watcherId,
      taskIds: [task.id],
      lastRunId: run.id,
      lastStatus: 'succeeded',
      lastFiredAt: run.finishedAt
    });
    expect(manualTrigger.nextRunAt).toBeUndefined();
    expect(watcher.triggerIds).toContain(manualTrigger.id);
    expect(updatedTask.nextRunAt).toBe(scheduledAt);
  });

  it('persists passive action ledger events across store restarts without writing secret fields', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mini-hub-action-ledger-'));
    try {
      const path = actionLedgerPath(dir);
      const first = createMemoryStore();
      enableActionLedgerPersistence(first, path);
      appendActionLedgerEvent(first, {
        system: 'mini-hub',
        source: 'passive-tasks',
        actionType: 'passive.app_health',
        summary: 'App Health Watchdog succeeded',
        status: 'succeeded',
        risk: 'system',
        changed: ['passive-run:run-1'],
        recoverability: {
          kind: 'artifact',
          referenceId: 'run-1',
          route: '/passive-tasks',
          description: 'Passive run history records outputs and source references.',
          reversible: false
        },
        rawRef: { kind: 'passive_run', id: 'run-1', accessToken: 'secret-access-token' },
        metadata: {
          workspaceId: personalWorkspaceId,
          refreshToken: 'secret-refresh-token',
          tokens_per_second: 42
        }
      });

      const persisted = readFileSync(path, 'utf8');
      expect(persisted).not.toContain('secret-access-token');
      expect(persisted).not.toContain('secret-refresh-token');
      expect(persisted).toContain('tokens_per_second');

      const second = createMemoryStore();
      enableActionLedgerPersistence(second, path);

      expect(second.actionEvents).toHaveLength(1);
      expect(second.actionEvents[0]).toMatchObject({
        source: 'passive-tasks',
        actionType: 'passive.app_health',
        metadata: {
          workspaceId: personalWorkspaceId,
          refreshToken: '[redacted]',
          tokens_per_second: 42
        },
        rawRef: {
          accessToken: '[redacted]'
        }
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('persists first-class passive results and backfills them from run cards', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mini-hub-passive-results-'));
    try {
      const first = createMemoryStore();
      const path = passiveTasksPath(dir);
      enablePassiveTaskPersistence(first, path);
      ensurePassiveDefaults(first);
      const task = first.passiveTasks.find((item) => item.family === 'career_radar')!;
      first.careerActions.push({
        id: 'career-action-result',
        workspaceId: personalWorkspaceId,
        jobId: 'job-result',
        label: 'Follow up with Clay',
        dueAt: '2026-06-18T10:00:00.000Z',
        deviceId: 'test',
        updatedAt: '2026-06-20T10:00:00.000Z'
      });

      const run = await runPassiveTask(first, task.id, {
        externalFetch: healthyServiceFetch(),
        force: true,
        input: { reason: 'result-persistence-test' }
      });
      persistPassiveTasks(first);

      const second = createMemoryStore();
      enablePassiveTaskPersistence(second, path);
      expect(second.passiveResults.map((result) => result.id)).toEqual(run.cards.map((card) => card.id));

      second.passiveResults = [];
      ensurePassiveDefaults(second);
      expect(second.passiveResults.map((result) => result.id)).toEqual(run.cards.map((card) => card.id));
      expect(buildPassiveSnapshot(second).results[0]?.runId).toBe(run.id);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('records retry/backoff state and a durable error log after a failing passive run', async () => {
    const store = createMemoryStore();
    ensurePassiveDefaults(store);
    const task = store.passiveTasks.find((item) => item.family === 'idle_compute')!;
    const failingFetch = (() => Promise.reject(new Error('AI OS benchmark offline'))) as typeof fetch;

    const run = await runPassiveTask(store, task.id, {
      externalFetch: failingFetch,
      force: true,
      input: { idle: true, reason: 'retry-log-test' }
    });
    const updated = store.passiveTasks.find((item) => item.id === task.id)!;

    expect(run.status).toBe('failed');
    expect(run.nextRunAt).toBe(updated.retry.nextRetryAt);
    expect(updated.status).toBe('failed');
    expect(updated.retry.attempts).toBe(1);
    expect(updated.retry.nextRetryAt).toBeTruthy();
    expect(updated.lastRunAt).toBeTruthy();
    expect(updated.lastError).toContain('AI OS benchmark offline');
    expect(updated.errorLog).toHaveLength(1);
    expect(updated.errorLog[0]).toMatchObject({
      runId: run.id,
      status: 'failed',
      message: 'AI OS benchmark offline',
      attempt: 1,
      nextRetryAt: updated.retry.nextRetryAt
    });
    expect(store.passiveRuns[0]?.id).toBe(run.id);
    expect(store.actionEvents[0]?.source).toBe('passive-tasks');
  });

  it('preserves cancellation requested while a passive run is executing', async () => {
    const store = createMemoryStore();
    ensurePassiveDefaults(store);
    const task = store.passiveTasks.find((item) => item.family === 'app_health')!;
    const healthyFetch = healthyServiceFetch();
    let releaseFirstFetch = () => {};
    let firstFetchStarted = false;
    const firstFetchGate = new Promise<void>((resolve) => {
      releaseFirstFetch = resolve;
    });
    const delayedFetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      if (!firstFetchStarted) {
        firstFetchStarted = true;
        await firstFetchGate;
      }
      return healthyFetch(input, init);
    }) as typeof fetch;

    const runPromise = runPassiveTask(store, task.id, {
      externalFetch: delayedFetch,
      force: true,
      input: { reason: 'cancel-during-run-test' }
    });
    await waitForCondition(() => firstFetchStarted && store.passiveTasks.find((item) => item.id === task.id)?.status === 'running');

    const cancelled = updatePassiveTaskStatus(store, task.id, 'cancelled');
    releaseFirstFetch();
    const run = await runPromise;
    const updated = store.passiveTasks.find((item) => item.id === task.id)!;

    expect(cancelled.status).toBe('cancelled');
    expect(run.status).toBe('cancelled');
    expect(run.error).toContain('cancelled');
    expect(run.nextRunAt).toBeUndefined();
    expect(run.metadata.cancelledDuringRun).toBe(true);
    expect(updated.status).toBe('cancelled');
    expect(updated.nextRunAt).toBeUndefined();
    expect(store.passiveNotifications).toEqual([]);
    expect(store.actionEvents.map((event) => event.actionType)).toContain('passive.task.cancelled');
    expect(store.actionEvents.at(-1)).toMatchObject({
      source: 'passive-tasks',
      actionType: 'passive.app_health',
      status: 'cancelled'
    });
  });

  it('records the effective machine mode on passive runs and action ledger events', async () => {
    const store = createMemoryStore();
    ensurePassiveDefaults(store);
    setMachineMode(store, 'maintenance');
    const task = store.passiveTasks.find((item) => item.family === 'app_health')!;

    const run = await runPassiveTask(store, task.id, {
      externalFetch: healthyServiceFetch(),
      force: true,
      input: { reason: 'machine-mode-test' }
    });

    expect(run.metadata.machineMode).toBe('maintenance');
    expect(run.metadata.machineModeSource).toBe('settings');
    expect(store.actionEvents.at(-1)).toMatchObject({
      source: 'passive-tasks',
      actionType: 'passive.app_health',
      mode: 'maintenance'
    });
    expect(buildPassiveSnapshot(store).sources.find((source) => source.id === 'app_health')?.details).toMatchObject({
      machineMode: 'maintenance',
      machineModeSource: 'settings',
      modePolicy: 'allowed'
    });
  });

  it('marks passive source status as overdue when scheduled work silently misses its window', () => {
    const store = createMemoryStore();
    ensurePassiveDefaults(store);
    const task = store.passiveTasks.find((item) => item.family === 'app_health' && item.trigger.kind === 'schedule')!;
    const overdueAt = new Date(Date.now() - 45 * 60 * 1000).toISOString();
    store.passiveTasks = store.passiveTasks.map((item) =>
      item.id === task.id ? { ...item, nextRunAt: overdueAt, trigger: { ...item.trigger, nextRunAt: overdueAt } } : item
    );
    store.passiveTriggers = store.passiveTriggers.map((trigger) =>
      trigger.id === task.trigger.id ? { ...trigger, nextRunAt: overdueAt } : trigger
    );

    const source = buildPassiveSnapshot(store).sources.find((item) => item.details.taskId === task.id)!;

    expect(source.status).toBe('error');
    expect(source.error).toContain('overdue');
    expect(source.details).toMatchObject({
      scheduleState: 'overdue',
      nextRunAt: overdueAt
    });
    expect(Number(source.details.scheduleLagMinutes)).toBeGreaterThanOrEqual(40);
  });

  it('keeps idle-only overdue sources quiet while the machine is active', () => {
    const store = createMemoryStore();
    ensurePassiveDefaults(store);
    const task = store.passiveTasks.find((item) => item.family === 'idle_compute')!;
    const overdueAt = new Date(Date.now() - 90 * 60 * 1000).toISOString();
    const checkedAt = new Date().toISOString();
    store.passiveWorker = {
      id: 'passive-worker',
      enabled: true,
      running: false,
      intervalMs: 5 * 60 * 1000,
      lastIdle: {
        idle: false,
        thresholdMinutes: 30,
        checkedAt,
        source: 'test-active-window',
        idleMinutes: 0
      },
      activeFileWatchCount: 0,
      pendingFileEvent: false,
      updatedAt: checkedAt
    };
    store.passiveTasks = store.passiveTasks.map((item) =>
      item.id === task.id ? { ...item, nextRunAt: overdueAt, trigger: { ...item.trigger, nextRunAt: overdueAt } } : item
    );

    const source = buildPassiveSnapshot(store).sources.find((item) => item.details.taskId === task.id)!;

    expect(source.status).toBe('ok');
    expect(source.error).toBeUndefined();
    expect(source.details).toMatchObject({
      scheduleState: 'waiting_for_idle',
      lastIdle: false,
      lastIdleSource: 'test-active-window'
    });
    expect(Number(source.details.scheduleLagMinutes)).toBeGreaterThanOrEqual(80);
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

  it('surfaces submitted applications that have gone quiet without a next action', async () => {
    const store = createMemoryStore();
    ensurePassiveDefaults(store);
    store.jobs.push({
      id: 'job-submitted-quiet',
      workspaceId: personalWorkspaceId,
      company: 'Pipeline Co',
      role: 'Quant Research Intern',
      status: 'applied',
      applicationUrl: 'https://jobs.example.com/pipeline-co',
      notes: '',
      deviceId: 'test',
      updatedAt: '2020-01-01T10:00:00.000Z'
    });
    const task = store.passiveTasks.find((item) => item.family === 'career_radar')!;

    const run = await runPassiveTask(store, task.id, {
      externalFetch: healthyServiceFetch(),
      force: true,
      input: { reason: 'submitted-application-follow-up-test' }
    });

    const applicationCard = run.cards.find((card) => card.title === '1 submitted application need status review');
    expect(run.status).toBe('succeeded');
    expect(applicationCard?.summary).toContain('Pipeline Co - Quant Research Intern (applied)');
    expect(applicationCard?.urgency).toBeGreaterThanOrEqual(68);
    expect(applicationCard?.sourceRefs[0]).toMatchObject({
      id: 'job-submitted-quiet',
      route: '/desk/career',
      metadata: {
        status: 'applied',
        reason: 'quiet-submitted-application',
        thresholdDays: 14,
        applicationUrl: 'https://jobs.example.com/pipeline-co'
      }
    });
    expect(Number(applicationCard?.sourceRefs[0]?.metadata.daysSinceUpdate)).toBeGreaterThan(14);
    expect(run.metadata).toMatchObject({
      leadFollowUps: 0,
      submittedApplicationFollowUps: 1
    });
    expect(buildPassiveDigest(store)[0]?.id).toBe(applicationCard?.id);
  });

  it('dedupes repeated non-urgent passive notifications while keeping run history', async () => {
    const store = createMemoryStore();
    ensurePassiveDefaults(store);
    store.jobs.push({
      id: 'job-1',
      workspaceId: personalWorkspaceId,
      company: 'Acme',
      role: 'Data Analyst',
      status: 'lead',
      applicationUrl: '',
      notes: '',
      deviceId: 'test',
      updatedAt: '2026-05-01T10:00:00.000Z'
    });
    const task = store.passiveTasks.find((item) => item.family === 'career_radar')!;

    await runPassiveTask(store, task.id, {
      externalFetch: healthyServiceFetch(),
      force: true,
      input: { reason: 'notification-dedupe-a' }
    });
    await runPassiveTask(store, task.id, {
      externalFetch: healthyServiceFetch(),
      force: true,
      input: { reason: 'notification-dedupe-b' }
    });

    expect(store.passiveRuns.filter((run) => run.taskId === task.id)).toHaveLength(2);
    expect(store.passiveNotifications).toHaveLength(1);
    expect(store.passiveNotifications[0]).toMatchObject({
      family: 'career_radar',
      level: 'info',
      title: '1 career lead need follow-up'
    });
  });

  it('honors passive notification style settings while keeping run history', async () => {
    const quietStore = createMemoryStore();
    ensurePassiveDefaults(quietStore);
    quietStore.passiveSettings = { ...quietStore.passiveSettings!, notificationStyle: 'urgent_only' };
    quietStore.jobs.push({
      id: 'job-routine',
      workspaceId: personalWorkspaceId,
      company: 'Routine Co',
      role: 'Analyst',
      status: 'lead',
      applicationUrl: '',
      notes: '',
      deviceId: 'test',
      updatedAt: '2026-05-01T10:00:00.000Z'
    });
    const quietTask = quietStore.passiveTasks.find((item) => item.family === 'career_radar')!;

    await runPassiveTask(quietStore, quietTask.id, {
      externalFetch: healthyServiceFetch(),
      force: true,
      input: { reason: 'urgent-only-routine-test' }
    });

    expect(quietStore.passiveRuns).toHaveLength(1);
    expect(quietStore.passiveRuns[0]?.cards[0]?.urgency).toBeLessThan(85);
    expect(quietStore.passiveNotifications).toEqual([]);

    quietStore.careerActions.push({
      id: 'career-action-urgent',
      workspaceId: personalWorkspaceId,
      jobId: undefined,
      label: 'Reply to recruiter today',
      dueAt: '2026-06-01T10:00:00.000Z',
      deviceId: 'test',
      updatedAt: '2026-06-20T10:00:00.000Z'
    });

    await runPassiveTask(quietStore, quietTask.id, {
      externalFetch: healthyServiceFetch(),
      force: true,
      input: { reason: 'urgent-only-urgent-test' }
    });

    expect(quietStore.passiveRuns).toHaveLength(2);
    expect(quietStore.passiveNotifications).toHaveLength(1);
    expect(quietStore.passiveNotifications[0]).toMatchObject({
      family: 'career_radar',
      level: 'urgent',
      title: '1 overdue and 0 upcoming career action'
    });

    const offStore = createMemoryStore();
    ensurePassiveDefaults(offStore);
    offStore.passiveSettings = { ...offStore.passiveSettings!, notificationStyle: 'off' };
    offStore.careerActions.push({
      id: 'career-action-off',
      workspaceId: personalWorkspaceId,
      jobId: undefined,
      label: 'Urgent but muted',
      dueAt: '2026-06-01T10:00:00.000Z',
      deviceId: 'test',
      updatedAt: '2026-06-20T10:00:00.000Z'
    });
    const offTask = offStore.passiveTasks.find((item) => item.family === 'career_radar')!;

    await runPassiveTask(offStore, offTask.id, {
      externalFetch: healthyServiceFetch(),
      force: true,
      input: { reason: 'notifications-off-test' }
    });

    expect(offStore.passiveRuns).toHaveLength(1);
    expect(offStore.passiveRuns[0]?.cards[0]?.urgency).toBeGreaterThanOrEqual(85);
    expect(offStore.passiveNotifications).toEqual([]);
  });

  it('audits and persists passive notification dismissals', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mini-hub-notification-dismiss-'));
    try {
      const passivePath = passiveTasksPath(dir);
      const ledgerPath = actionLedgerPath(dir);
      const first = createMemoryStore();
      enablePassiveTaskPersistence(first, passivePath);
      enableActionLedgerPersistence(first, ledgerPath);
      ensurePassiveDefaults(first);
      first.jobs.push({
        id: 'job-dismiss',
        workspaceId: personalWorkspaceId,
        company: 'Quiet Co',
        role: 'Research Analyst',
        status: 'lead',
        applicationUrl: '',
        notes: '',
        deviceId: 'test',
        updatedAt: '2026-05-01T10:00:00.000Z'
      });
      const task = first.passiveTasks.find((item) => item.family === 'career_radar')!;

      await runPassiveTask(first, task.id, {
        externalFetch: healthyServiceFetch(),
        force: true,
        input: { reason: 'notification-dismiss-test' }
      });

      const notificationId = first.passiveNotifications[0]!.id;
      const dismissed = dismissPassiveNotification(first, notificationId);

      expect(dismissed.dismissedAt).toBeTruthy();
      expect(first.passiveNotifications[0]).toMatchObject({
        id: notificationId,
        dismissedAt: dismissed.dismissedAt
      });
      expect(first.actionEvents.at(-1)).toMatchObject({
        source: 'passive-tasks',
        actionType: 'passive.notification.dismiss',
        risk: 'write',
        changed: expect.arrayContaining([`passive-notification:${notificationId}`]),
        metadata: {
          family: 'career_radar',
          taskId: task.id,
          runId: dismissed.runId,
          dismissedAt: dismissed.dismissedAt
        }
      });

      const persistedLedger = JSON.parse(readFileSync(ledgerPath, 'utf8')) as { events: Array<{ actionType?: string }> };
      expect(persistedLedger.events.at(-1)?.actionType).toBe('passive.notification.dismiss');

      const second = createMemoryStore();
      enablePassiveTaskPersistence(second, passivePath);
      enableActionLedgerPersistence(second, ledgerPath);

      expect(second.passiveNotifications.find((item) => item.id === notificationId)?.dismissedAt).toBe(dismissed.dismissedAt);
      expect(second.actionEvents.at(-1)?.actionType).toBe('passive.notification.dismiss');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
    expect(run.cards[0]?.title).toContain('research domain monitor');
    expect(run.metadata.watchedDomains).toEqual(['example.com', 'docs.example.org']);
    expect(run.metadata.resourceLimit).toBe('light');
  });

  it('prepares research monitors from active saved career job URLs', async () => {
    const store = createMemoryStore();
    ensurePassiveDefaults(store);
    store.passiveSettings = {
      ...store.passiveSettings!,
      watchedDomains: [],
      localAiPreference: 'local_first',
      resourceLimit: 'light'
    };
    store.jobs.push(
      {
        id: 'job-career-research',
        workspaceId: personalWorkspaceId,
        company: 'Clay Labs',
        role: 'GTM Data Analyst',
        status: 'lead',
        applicationUrl: 'https://www.clay.com/careers/gtm-data-analyst',
        notes: '',
        deviceId: 'test',
        updatedAt: '2026-06-20T10:00:00.000Z'
      },
      {
        id: 'job-inactive-research',
        workspaceId: personalWorkspaceId,
        company: 'Old Co',
        role: 'Analyst',
        status: 'rejected',
        applicationUrl: 'https://old.example.com/jobs/analyst',
        notes: '',
        deviceId: 'test',
        updatedAt: '2026-06-20T10:00:00.000Z'
      }
    );
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
      input: { reason: 'career-domain-monitor-test' }
    });

    expect(run.status).toBe('succeeded');
    expect(createdBodies).toHaveLength(1);
    expect(createdBodies[0]).toMatchObject({
      name: 'Passive career watch: clay.com',
      metadata: {
        source: 'mini-hub-passive',
        watched_domain: 'clay.com',
        watched_domain_source: 'career_job',
        source_job_ids: ['job-career-research']
      }
    });
    expect(createdBodies[0]?.request).toMatchObject({
      seed_urls: ['https://www.clay.com/careers/gtm-data-analyst'],
      include_domains: ['clay.com'],
      metadata: {
        watched_domain: 'clay.com',
        watched_domain_source: 'career_job',
        source_labels: ['Clay Labs - GTM Data Analyst']
      }
    });
    expect(run.metadata).toMatchObject({
      watchedDomains: ['clay.com'],
      watchedDomainSources: { 'clay.com': 'career_job' },
      careerJobDomains: ['clay.com']
    });
  });

  it('surfaces completed AI OS research monitor runs as source-backed passive cards', async () => {
    const store = createMemoryStore();
    ensurePassiveDefaults(store);
    const researchFetch = (async (input: unknown) => {
      const href = String(input);
      if (href.includes('/api/ai/research/monitors?limit=50')) {
        return jsonResponse({ monitors: [{ id: 'monitor-clay', metadata: { watched_domain: 'clay.com' } }] });
      }
      if (href.includes('/api/ai/research/runs?limit=10')) {
        return jsonResponse({
          runs: [
            {
              id: 'research-clay-1',
              mode: 'monitor_topic',
              goal: 'Monitor clay.com for GTM data analyst updates.',
              status: 'succeeded',
              report: {
                title: 'Clay GTM update',
                tldr: 'Clay published a new GTM data workflow note relevant to saved data analyst leads.',
                key_facts: ['New workflow mentions enrichment QA.', 'The post links to a public product update.']
              },
              sources: [
                {
                  id: 'source-clay-1',
                  url: 'https://clay.com/blog/gtm-data-update',
                  canonical_url: 'https://clay.com/blog/gtm-data-update',
                  title: 'GTM data update',
                  description: 'A public Clay product note.',
                  fetched_at: '2026-06-20T10:00:00.000Z',
                  score: 0.88,
                  rank: 1
                }
              ],
              options: {
                metadata: {
                  source: 'mini-hub-passive',
                  watched_domain: 'clay.com'
                }
              },
              runtime_ms: 1200,
              cost_usd: 0,
              total_tokens: 0
            }
          ]
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
      input: { reason: 'completed-monitor-test' }
    });

    const card = run.cards.find((item) => item.title === 'Clay GTM update');
    expect(run.status).toBe('succeeded');
    expect(run.changed).toContain('research-run:research-clay-1');
    expect(card).toMatchObject({
      family: 'research_monitor',
      summary: expect.stringContaining('Clay published a new GTM data workflow note'),
      suggestedAction: 'Review research update',
      why: expect.stringContaining('clay.com')
    });
    expect(card?.sourceRefs[0]).toMatchObject({
      kind: 'record',
      id: 'research-clay-1',
      route: '/research',
      metadata: {
        researchRunId: 'research-clay-1',
        watchedDomain: 'clay.com',
        sourceCount: 1
      }
    });
    expect(card?.sourceRefs[1]).toMatchObject({
      kind: 'url',
      url: 'https://clay.com/blog/gtm-data-update',
      metadata: {
        title: 'GTM data update',
        rank: 1
      }
    });
    expect(run.metadata.recentResearch).toMatchObject({
      recentRunsChecked: 1,
      monitorRunsChecked: 1,
      skippedAlreadySurfaced: 0,
      surfacedResearchRuns: 1
    });

    const secondRun = await runPassiveTask(store, task.id, {
      externalFetch: researchFetch,
      force: true,
      input: { reason: 'completed-monitor-repeat-test' }
    });

    expect(secondRun.cards.some((item) => item.title === 'Clay GTM update')).toBe(false);
    expect(secondRun.changed).not.toContain('research-run:research-clay-1');
    expect(secondRun.metadata.recentResearch).toMatchObject({
      recentRunsChecked: 1,
      monitorRunsChecked: 1,
      skippedAlreadySurfaced: 1,
      surfacedResearchRuns: 0
    });
  });

  it('surfaces failing project health artifacts without running project scripts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mini-hub-project-health-'));
    try {
      const readmePath = join(dir, 'README.md');
      const packagePath = join(dir, 'package.json');
      const logPath = join(dir, '.tmp-check.err.log');
      writeFileSync(readmePath, '# Project\n\nHealth checked project.', 'utf8');
      writeFileSync(packagePath, JSON.stringify({ scripts: { check: 'echo should-not-run' } }), 'utf8');
      writeFileSync(logPath, 'Mini Hub check output\nTests failed: 1 failed, 2 passed\n', 'utf8');
      const store = createMemoryStore();
      ensurePassiveDefaults(store);
      store.passiveSettings = {
        ...store.passiveSettings!,
        watchedFolders: [dir],
        resourceLimit: 'light'
      };
      const task = store.passiveTasks.find((item) => item.family === 'project_drift')!;

      const run = await runPassiveTask(store, task.id, {
        externalFetch: healthyServiceFetch(),
        force: true,
        input: { reason: 'project-health-artifact-test' }
      });

      const card = run.cards.find((item) => item.title.includes('may be drifting'));
      const artifactRef = card?.sourceRefs.find((ref) => ref.filePath === logPath);
      expect(run.status).toBe('succeeded');
      expect(card?.summary).toContain('1 failing health check artifact');
      expect(artifactRef?.metadata).toMatchObject({
        matched: 'Tests failed: 1 failed, 2 passed'
      });
      expect(run.changed).toContain(`health-check:${logPath}`);
      expect(run.metadata.projectBudget).toMatchObject({
        healthArtifactCount: 1
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('surfaces README drift when source files are newer than project docs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mini-hub-project-doc-drift-'));
    try {
      const readmePath = join(dir, 'README.md');
      const packagePath = join(dir, 'package.json');
      const sourcePath = join(dir, 'src', 'feature.ts');
      mkdirSync(join(dir, 'src'), { recursive: true });
      writeFileSync(readmePath, '# Project\n\nOld setup notes.', 'utf8');
      writeFileSync(packagePath, JSON.stringify({ scripts: { test: 'vitest run' } }), 'utf8');
      writeFileSync(sourcePath, 'export const freshFeature = true;\n', 'utf8');
      const readmeDate = new Date('2026-01-01T10:00:00.000Z');
      const sourceDate = new Date('2026-03-01T10:00:00.000Z');
      utimesSync(readmePath, readmeDate, readmeDate);
      utimesSync(packagePath, readmeDate, readmeDate);
      utimesSync(sourcePath, sourceDate, sourceDate);
      const store = createMemoryStore();
      ensurePassiveDefaults(store);
      store.passiveSettings = {
        ...store.passiveSettings!,
        watchedFolders: [dir],
        resourceLimit: 'light'
      };
      const task = store.passiveTasks.find((item) => item.family === 'project_drift')!;

      const run = await runPassiveTask(store, task.id, {
        externalFetch: healthyServiceFetch(),
        force: true,
        input: { reason: 'project-doc-drift-test' }
      });

      const card = run.cards.find((item) => item.title.includes('may be drifting'));
      const readmeRef = card?.sourceRefs.find((ref) => ref.filePath === readmePath);
      const sourceRef = card?.sourceRefs.find((ref) => ref.filePath === sourcePath);
      expect(run.status).toBe('succeeded');
      expect(card?.summary).toContain('README trails feature.ts by');
      expect(readmeRef).toBeTruthy();
      expect(sourceRef?.metadata).toMatchObject({
        reason: 'newer-than-readme',
        daysNewerThanReadme: 59
      });
      expect(run.changed).toContain(`doc-drift:${sourcePath}`);
      expect(run.metadata.projectBudget).toMatchObject({
        docDriftCount: 1
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
      changed: expect.arrayContaining([`passive-card:${cardId}`, expect.stringMatching(/^passive-card-key:/u)])
    });

    updatePassiveCardTriage(store, cardId, 'clear');
    expect(buildPassiveDigest(store).some((card) => card.id === cardId)).toBe(true);

    updatePassiveCardTriage(store, cardId, 'snoozed', { snoozedUntil: new Date(Date.now() + 60_000).toISOString() });
    expect(buildPassiveDigest(store).some((card) => card.id === cardId)).toBe(false);
  });

  it('expires stale routine passive digest cards while preserving intentionally retained cards', async () => {
    const store = createMemoryStore();
    ensurePassiveDefaults(store);
    store.jobs.push({
      id: 'job-stale-digest',
      workspaceId: personalWorkspaceId,
      company: 'Routine Co',
      role: 'Data Analyst',
      status: 'lead',
      applicationUrl: '',
      notes: '',
      deviceId: 'test',
      updatedAt: '2026-05-01T10:00:00.000Z'
    });
    const task = store.passiveTasks.find((item) => item.family === 'career_radar')!;

    await runPassiveTask(store, task.id, {
      externalFetch: healthyServiceFetch(),
      force: true,
      input: { reason: 'stale-digest-test' }
    });
    const card = buildPassiveDigest(store)[0]!;
    expect(card.title).toBe('1 career lead need follow-up');
    expect(card.urgency).toBeLessThan(85);

    const staleCreatedAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    store.passiveResults = store.passiveResults.map((item) => (item.id === card.id ? { ...item, createdAt: staleCreatedAt } : item));
    expect(buildPassiveDigest(store).some((item) => item.id === card.id)).toBe(false);

    updatePassiveCardTriage(store, card.id, 'important', { reason: 'still-relevant' });
    expect(buildPassiveDigest(store).some((item) => item.id === card.id)).toBe(true);

    updatePassiveCardTriage(store, card.id, 'clear');
    store.passiveRuns = store.passiveRuns.map((run) =>
      run.id === card.runId ? { ...run, status: 'blocked' as const, error: 'still unresolved' } : run
    );
    expect(buildPassiveDigest(store).some((item) => item.id === card.id)).toBe(true);
  });

  it('applies passive card triage to repeated source-equivalent findings', async () => {
    const store = createMemoryStore();
    ensurePassiveDefaults(store);
    store.careerActions.push({
      id: 'career-action-repeat',
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
      input: { reason: 'stable-triage-first' }
    });
    const firstCard = buildPassiveDigest(store)[0]!;

    updatePassiveCardTriage(store, firstCard.id, 'dismissed', { reason: 'recurring-low-value' });
    const triageEvent = store.actionEvents.at(-1);

    await runPassiveTask(store, task.id, {
      externalFetch: healthyServiceFetch(),
      force: true,
      input: { reason: 'stable-triage-repeat' }
    });

    const repeatedCards = store.passiveResults.filter(
      (card) => card.title === firstCard.title && card.summary === firstCard.summary
    );
    expect(repeatedCards.length).toBeGreaterThanOrEqual(2);
    expect(buildPassiveDigest(store).some((card) => card.title === firstCard.title && card.summary === firstCard.summary)).toBe(false);
    expect(Object.keys(store.passiveSettings!.cardTriage).some((key) => key.startsWith('passive-card-key:'))).toBe(true);
    expect(triageEvent?.metadata).toEqual(expect.objectContaining({ stableKey: expect.stringMatching(/^passive-card-key:/u) }));
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

  it('clears next-run surfaces when a passive task is cancelled', () => {
    const store = createMemoryStore();
    ensurePassiveDefaults(store);
    const task = store.passiveTasks.find((item) => item.family === 'project_drift')!;
    const dueAt = '2026-06-20T09:00:00.000Z';
    store.passiveTasks = store.passiveTasks.map((item) =>
      item.id === task.id ? { ...item, nextRunAt: dueAt, trigger: { ...item.trigger, nextRunAt: dueAt } } : item
    );
    const cancelled = updatePassiveTaskStatus(store, task.id, 'cancelled');
    const snapshot = buildPassiveSnapshot(store);
    const trigger = snapshot.triggers.find((item) => item.id === task.trigger.id)!;
    const watcher = snapshot.watchers.find((item) => item.id === task.watcherId)!;

    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.nextRunAt).toBeUndefined();
    expect(cancelled.trigger.nextRunAt).toBeUndefined();
    expect(cancelled.retry.nextRetryAt).toBeUndefined();
    expect(trigger.enabled).toBe(false);
    expect(trigger.nextRunAt).toBeUndefined();
    expect(watcher.nextRunAt).toBeUndefined();
    expect(duePassiveTasks(store, new Date('2026-06-20T10:00:00.000Z')).some((item) => item.id === task.id)).toBe(false);
  });
});
