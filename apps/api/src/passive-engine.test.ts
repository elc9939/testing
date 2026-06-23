import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { personalWorkspaceId, type IntegrationConnection } from '@mini-hub/core';
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
  updatePassiveSettings,
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
    expect(duePassiveTasks(store, now, { idle: true }).some((task) => task.family === 'research_monitor')).toBe(false);

    updatePassiveSettings(store, { enabledFamilies: { research_monitor: true } });
    expect(store.passiveWatchers.find((watcher) => watcher.family === 'research_monitor')?.enabled).toBe(true);
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
      const snapshot = JSON.parse(snapshotText) as { jobs: unknown[]; integrationConnections: Array<{ encryptedTokenSet: string }> };
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
          integrationConnections: 1
        },
        aiBackup: {
          requested: true,
          id: 'backup-1'
        }
      });
      expect(String(run.metadata.snapshotSha256)).toMatch(/^[a-f0-9]{64}$/u);
      expect(snapshot.jobs).toHaveLength(1);
      expect(snapshot.integrationConnections[0]?.encryptedTokenSet).toBe('[encrypted-redacted]');
      expect(snapshotText).not.toContain('secret-token-payload');
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
