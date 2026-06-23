import {
  passiveEngineSettingsSchema,
  passiveNotificationSchema,
  passiveResultCardSchema,
  passiveRunSchema,
  passiveSnapshotSchema,
  passiveSourceStatusSchema,
  passiveTaskSchema,
  passiveWatcherSchema,
  routeMap,
  type AttentionAction,
  type AttentionItem,
  type PassiveEngineSettings,
  type PassiveNotification,
  type PassiveResultCard,
  type PassiveRun,
  type PassiveRunStatus,
  type PassiveSnapshot,
  type PassiveSourceRef,
  type PassiveSourceStatus,
  type PassiveTask,
  type PassiveTaskFamily,
  type PassiveTaskStatus,
  type PassiveTriggerKind,
  type PassiveWatcher
} from '@mini-hub/core';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { env } from './env';
import { appendActionLedgerEvent, persistPassiveTasks, type MemoryStore } from './store';

type FetchLike = typeof fetch;

export interface PassiveRunInput {
  idle?: boolean;
  reason?: string;
  eventName?: string;
}

interface FamilyRunResult {
  status: PassiveRunStatus;
  cards: PassiveResultCard[];
  changed?: string[];
  metadata?: Record<string, unknown>;
  error?: string;
}

interface DefaultTaskDefinition {
  family: PassiveTaskFamily;
  taskId: string;
  watcherId: string;
  title: string;
  description: string;
  detail: string;
  triggerKind?: PassiveTriggerKind;
  triggerLabel?: string;
  intervalMinutes?: number;
  eventName?: string;
  priority: number;
  idleOnly?: boolean;
  route: string;
  offsetMinutes?: number;
}

const dayMs = 24 * 60 * 60 * 1000;
const minuteMs = 60 * 1000;
const passiveSnapshotDirName = 'passive-snapshots';
const passiveDigestUrgency = 58;
const attentionUrgency = 65;

const familyLabels: Record<PassiveTaskFamily, string> = {
  app_health: 'App Health Watchdog',
  backup_snapshot: 'Backup + Snapshot Watcher',
  idle_compute: 'Idle Compute Queue',
  research_monitor: 'Background Research Monitor',
  career_radar: 'Career Radar',
  file_intelligence: 'Local File Intelligence',
  project_drift: 'Project Drift Detector'
};

const defaultTaskDefinitions: DefaultTaskDefinition[] = [
  {
    family: 'app_health',
    taskId: 'passive-task:app-health',
    watcherId: 'passive-watcher:app-health',
    title: 'Check local app foundations',
    description: 'Checks Mini Hub, AI OS, Macro Lab, Ollama, data directories, and backup freshness.',
    detail: 'Runs lightweight service and storage checks.',
    intervalMinutes: 30,
    priority: 90,
    route: routeMap.settings,
    offsetMinutes: 2
  },
  {
    family: 'app_health',
    taskId: 'passive-task:app-health-startup',
    watcherId: 'passive-watcher:app-health',
    title: 'Check app startup readiness',
    description: 'Runs the app health watchdog when Mini Hub receives a startup or reconnect event.',
    detail: 'Event-triggered readiness check for local services, integrations, backups, and model availability.',
    triggerKind: 'event',
    triggerLabel: 'Startup event',
    eventName: 'app.startup',
    priority: 95,
    route: routeMap.settings
  },
  {
    family: 'backup_snapshot',
    taskId: 'passive-task:backup-snapshot',
    watcherId: 'passive-watcher:backup-snapshot',
    title: 'Create Mini Hub restore snapshot',
    description: 'Creates local JSON restore points for Mini Hub personal data and asks AI OS for its own backup when available.',
    detail: 'Writes non-destructive snapshots under the configured Mini Hub data directory.',
    intervalMinutes: 24 * 60,
    priority: 82,
    route: routeMap.aiOs,
    offsetMinutes: 10
  },
  {
    family: 'idle_compute',
    taskId: 'passive-task:idle-compute',
    watcherId: 'passive-watcher:idle-compute',
    title: 'Run idle-only compute checks',
    description: 'Runs heavier benchmarks and queued compute only when the machine is marked idle.',
    detail: 'Defers unless the tick or manual run is explicitly idle.',
    intervalMinutes: 6 * 60,
    priority: 64,
    idleOnly: true,
    route: routeMap.aiOs,
    offsetMinutes: 20
  },
  {
    family: 'research_monitor',
    taskId: 'passive-task:research-monitor',
    watcherId: 'passive-watcher:research-monitor',
    title: 'Sweep due research monitors',
    description: 'Checks saved AI OS research monitors and queues due runs.',
    detail: 'Uses AI OS research monitor state.',
    intervalMinutes: 2 * 60,
    priority: 72,
    route: routeMap.research,
    offsetMinutes: 30
  },
  {
    family: 'career_radar',
    taskId: 'passive-task:career-radar',
    watcherId: 'passive-watcher:career-radar',
    title: 'Scan career follow-ups',
    description: 'Looks at saved jobs and career actions for deadlines, interviews, and stale follow-ups.',
    detail: 'Uses Career Desk jobs and actions only.',
    intervalMinutes: 4 * 60,
    priority: 76,
    route: routeMap.careerDesk,
    offsetMinutes: 40
  },
  {
    family: 'file_intelligence',
    taskId: 'passive-task:file-intelligence',
    watcherId: 'passive-watcher:file-intelligence',
    title: 'Inspect configured folders',
    description: 'Watches configured folders for new documents, screenshots, downloads, and cleanup candidates.',
    detail: 'Only reads configured folder metadata and small filenames.',
    intervalMinutes: 6 * 60,
    priority: 58,
    route: routeMap.passiveTasks,
    offsetMinutes: 50
  },
  {
    family: 'project_drift',
    taskId: 'passive-task:project-drift',
    watcherId: 'passive-watcher:project-drift',
    title: 'Scan configured projects for drift',
    description: 'Checks configured local project folders for stale READMEs, TODO buildup, and missing test scripts.',
    detail: 'Uses file metadata and small project manifests in configured folders.',
    intervalMinutes: 12 * 60,
    priority: 66,
    route: routeMap.passiveTasks,
    offsetMinutes: 60
  }
];

function nowIso(date = new Date()): string {
  return date.toISOString();
}

function addMinutes(date: Date, minutes: number): string {
  return new Date(date.getTime() + minutes * minuteMs).toISOString();
}

function parseTime(value: string | undefined): number {
  if (!value) return Number.NaN;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function id(prefix: string): string {
  return `${prefix}:${crypto.randomUUID()}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function describeError(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error || 'Unknown error');
}

function defaultTriggerId(definition: DefaultTaskDefinition): string {
  if (definition.triggerKind === 'event' && definition.eventName) {
    return `passive-trigger:${definition.family}:${definition.eventName}`;
  }
  return `passive-trigger:${definition.family}`;
}

function stableSourceRef(kind: PassiveSourceRef['kind'], label: string, values: Partial<PassiveSourceRef>): PassiveSourceRef {
  return {
    kind,
    id: values.id ?? label.toLowerCase().replace(/[^a-z0-9]+/gu, '-'),
    label,
    ...(values.route ? { route: values.route } : {}),
    ...(values.url ? { url: values.url } : {}),
    ...(values.filePath ? { filePath: values.filePath } : {}),
    metadata: values.metadata ?? {}
  };
}

function card(
  input: Omit<PassiveResultCard, 'createdAt' | 'metadata'> & Partial<Pick<PassiveResultCard, 'createdAt' | 'metadata'>>
): PassiveResultCard {
  return passiveResultCardSchema.parse({
    ...input,
    createdAt: input.createdAt ?? nowIso()
  });
}

function notificationFromRun(run: PassiveRun, cardItems: PassiveResultCard[]): PassiveNotification | null {
  const notable = cardItems.filter((item) => item.urgency >= passiveDigestUrgency);
  if (!notable.length) return null;
  const highest = notable.reduce((best, item) => (item.urgency > best.urgency ? item : best), notable[0]!);
  const level: PassiveNotification['level'] =
    highest.urgency >= 85 ? 'urgent' : highest.urgency >= 72 ? 'warning' : run.status === 'failed' ? 'error' : 'info';
  return passiveNotificationSchema.parse({
    id: id('passive-notification'),
    runId: run.id,
    taskId: run.taskId,
    family: run.family,
    title: highest.title,
    body: highest.summary,
    level,
    route: highest.route,
    cardIds: notable.map((item) => item.id),
    createdAt: nowIso()
  });
}

export function defaultPassiveSettings(date = new Date()): PassiveEngineSettings {
  return passiveEngineSettingsSchema.parse({
    enabled: true,
    notificationStyle: 'digest',
    idleOnly: false,
    resourceLimit: 'balanced',
    localAiPreference: 'local_first',
    maxRunsPerTick: 3,
    watchedFolders: [],
    watchedDomains: [],
    watchedAccounts: [],
    enabledFamilies: Object.fromEntries(defaultTaskDefinitions.map((definition) => [definition.family, true])),
    updatedAt: nowIso(date)
  });
}

function defaultWatcher(definition: DefaultTaskDefinition, date: Date): PassiveWatcher {
  const nextRunAt = definition.triggerKind === 'event' ? undefined : addMinutes(date, definition.offsetMinutes ?? 0);
  return passiveWatcherSchema.parse({
    id: definition.watcherId,
    family: definition.family,
    title: familyLabels[definition.family],
    description: definition.description,
    enabled: true,
    triggerIds: [defaultTriggerId(definition)],
    taskIds: [definition.taskId],
    createdAt: nowIso(date),
    updatedAt: nowIso(date),
    ...(nextRunAt ? { nextRunAt } : {})
  });
}

function defaultTask(definition: DefaultTaskDefinition, date: Date): PassiveTask {
  const triggerKind = definition.triggerKind ?? (definition.idleOnly ? 'idle' : 'schedule');
  const nextRunAt = triggerKind === 'event' ? undefined : addMinutes(date, definition.offsetMinutes ?? 0);
  return passiveTaskSchema.parse({
    id: definition.taskId,
    watcherId: definition.watcherId,
    family: definition.family,
    title: definition.title,
    detail: definition.detail,
    trigger: {
      id: defaultTriggerId(definition),
      kind: triggerKind,
      label: definition.triggerLabel ?? (definition.idleOnly ? 'Idle window' : 'Scheduled check'),
      ...(definition.intervalMinutes ? { intervalMinutes: definition.intervalMinutes } : {}),
      ...(definition.eventName ? { eventName: definition.eventName } : {}),
      ...(definition.idleOnly ? { idleMinutes: 20 } : {}),
      ...(nextRunAt ? { nextRunAt } : {})
    },
    priority: definition.priority,
    idleOnly: Boolean(definition.idleOnly),
    status: 'active',
    retry: {
      maxAttempts: 3,
      attempts: 0,
      backoffMinutes: 15
    },
    route: definition.route,
    ...(nextRunAt ? { nextRunAt } : {}),
    createdAt: nowIso(date),
    updatedAt: nowIso(date),
    settings: {}
  });
}

export function ensurePassiveDefaults(store: MemoryStore, date = new Date()): void {
  let changed = false;
  if (!store.passiveSettings) {
    store.passiveSettings = defaultPassiveSettings(date);
    changed = true;
  }

  const watcherIds = new Set(store.passiveWatchers.map((watcher) => watcher.id));
  const taskIds = new Set(store.passiveTasks.map((task) => task.id));
  for (const definition of defaultTaskDefinitions) {
    if (!watcherIds.has(definition.watcherId)) {
      store.passiveWatchers.push(defaultWatcher(definition, date));
      changed = true;
    }
    if (!taskIds.has(definition.taskId)) {
      store.passiveTasks.push(defaultTask(definition, date));
      changed = true;
    }
  }

  store.passiveWatchers = store.passiveWatchers.map((watcher) => {
    const definitions = defaultTaskDefinitions.filter((definition) => definition.watcherId === watcher.id);
    if (!definitions.length) return watcher;
    const triggerIds = [...new Set([...watcher.triggerIds, ...definitions.map(defaultTriggerId)])];
    const mergedTaskIds = [...new Set([...watcher.taskIds, ...definitions.map((definition) => definition.taskId)])];
    const nextRunCandidates = store.passiveTasks
      .filter((task) => mergedTaskIds.includes(task.id))
      .map((task) => task.nextRunAt)
      .filter((value): value is string => Boolean(value))
      .sort((a, b) => parseTime(a) - parseTime(b));
    const nextRunAt = nextRunCandidates[0];
    if (
      triggerIds.length === watcher.triggerIds.length &&
      mergedTaskIds.length === watcher.taskIds.length &&
      watcher.nextRunAt === nextRunAt
    ) {
      return watcher;
    }
    changed = true;
    return passiveWatcherSchema.parse({
      ...watcher,
      triggerIds,
      taskIds: mergedTaskIds,
      ...(nextRunAt ? { nextRunAt } : { nextRunAt: undefined }),
      updatedAt: nowIso(date)
    });
  });

  store.passiveWatchers = store.passiveWatchers.map((watcher) => passiveWatcherSchema.parse(watcher));
  store.passiveTasks = store.passiveTasks.map((task) => passiveTaskSchema.parse(task));
  store.passiveRuns = store.passiveRuns.map((run) => passiveRunSchema.parse(run));
  store.passiveNotifications = store.passiveNotifications.map((notification) => passiveNotificationSchema.parse(notification));

  if (changed) persistPassiveTasks(store);
}

export function computeNextRunAt(task: PassiveTask, date = new Date()): string | undefined {
  if (task.status === 'cancelled') return undefined;
  if (task.status === 'paused') return task.nextRunAt;
  if (task.trigger.kind === 'event' || task.trigger.kind === 'manual') return undefined;
  const intervalMinutes = task.trigger.intervalMinutes ?? 60;
  return addMinutes(date, intervalMinutes);
}

function retryDelayMinutes(task: PassiveTask): number {
  const attempts = Math.max(1, task.retry.attempts);
  return task.retry.backoffMinutes * 2 ** Math.min(4, attempts - 1);
}

export function applyRunOutcomeToTask(task: PassiveTask, run: PassiveRun, date = new Date()): PassiveTask {
  if (run.status === 'failed' || run.status === 'blocked') {
    const attempts = task.retry.attempts + 1;
    const retryExhausted = attempts >= task.retry.maxAttempts;
    const retryAt = addMinutes(date, retryDelayMinutes({ ...task, retry: { ...task.retry, attempts } }));
    return passiveTaskSchema.parse({
      ...task,
      status: retryExhausted ? 'blocked' : 'failed',
      lastRunAt: run.finishedAt ?? nowIso(date),
      nextRunAt: retryExhausted ? undefined : retryAt,
      lastError: run.error ?? 'Task failed.',
      retry: {
        ...task.retry,
        attempts,
        nextRetryAt: retryExhausted ? undefined : retryAt
      },
      trigger: { ...task.trigger, nextRunAt: retryExhausted ? undefined : retryAt },
      updatedAt: nowIso(date)
    });
  }

  const nextRunAt = computeNextRunAt(task, date);
  return passiveTaskSchema.parse({
    ...task,
    status: task.status === 'cancelled' ? 'cancelled' : 'active',
    lastRunAt: run.finishedAt ?? nowIso(date),
    nextRunAt,
    lastError: undefined,
    retry: {
      ...task.retry,
      attempts: 0,
      nextRetryAt: undefined
    },
    trigger: { ...task.trigger, nextRunAt },
    updatedAt: nowIso(date)
  });
}

function watcherEnabled(store: MemoryStore, task: PassiveTask): boolean {
  const watcher = store.passiveWatchers.find((item) => item.id === task.watcherId);
  if (!watcher?.enabled) return false;
  const familyEnabled = store.passiveSettings?.enabledFamilies[task.family];
  return familyEnabled !== false;
}

function taskMatchesEvent(task: PassiveTask, eventName: string): boolean {
  if (task.trigger.kind !== 'event') return false;
  const directName = task.trigger.eventName?.trim();
  if (directName === eventName || directName === '*') return true;
  const aliases = Array.isArray(task.trigger.metadata.eventNames) ? task.trigger.metadata.eventNames : [];
  return aliases.some((value) => typeof value === 'string' && value.trim() === eventName);
}

export function duePassiveTasks(store: MemoryStore, date = new Date(), input: PassiveRunInput = {}): PassiveTask[] {
  ensurePassiveDefaults(store, date);
  const nowMs = date.getTime();
  const eventName = input.eventName?.trim();
  if (!store.passiveSettings?.enabled) return [];
  return store.passiveTasks
    .filter((task) => ['active', 'failed'].includes(task.status))
    .filter((task) => watcherEnabled(store, task))
    .filter((task) => !task.idleOnly || Boolean(input.idle))
    .filter((task) => (eventName ? taskMatchesEvent(task, eventName) : task.trigger.kind !== 'event'))
    .filter((task) => {
      const retryAt = parseTime(task.retry.nextRetryAt);
      if (Number.isFinite(retryAt) && retryAt > nowMs) return false;
      if (eventName) return true;
      const nextRun = parseTime(task.nextRunAt ?? task.trigger.nextRunAt);
      return !Number.isFinite(nextRun) || nextRun <= nowMs;
    })
    .sort((a, b) => b.priority - a.priority || a.title.localeCompare(b.title));
}

async function fetchJsonWithTimeout(
  fetchImpl: FetchLike,
  url: URL,
  label: string,
  init: RequestInit = {},
  timeoutMs = 2500
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      ...init,
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(init.headers ?? {})
      }
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`${label} returned ${response.status}: ${text.slice(0, 180) || response.statusText}`);
    }
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function latestRunForTask(store: MemoryStore, taskId: string): PassiveRun | undefined {
  return store.passiveRuns
    .filter((run) => run.taskId === taskId)
    .sort((a, b) => parseTime(b.startedAt) - parseTime(a.startedAt))[0];
}

function sourceStatus(input: {
  id: string;
  label: string;
  status: PassiveSourceStatus['status'];
  fetchedAt?: string;
  error?: string;
  details?: Record<string, unknown>;
}): PassiveSourceStatus {
  return passiveSourceStatusSchema.parse({
    id: input.id,
    label: input.label,
    status: input.status,
    fetchedAt: input.fetchedAt,
    error: input.error,
    details: input.details ?? {}
  });
}

function serviceIssueCard(task: PassiveTask, runId: string, title: string, summary: string, urgency: number, ref: PassiveSourceRef): PassiveResultCard {
  return card({
    id: id('passive-card'),
    taskId: task.id,
    runId,
    family: task.family,
    title,
    summary,
    urgency,
    confidence: 0.9,
    route: task.route,
    sourceRefs: [ref],
    suggestedAction: 'Inspect service',
    actionKind: 'inspect',
    why: 'A real service check failed or reported a blocked state.'
  });
}

async function runAppHealth(store: MemoryStore, task: PassiveTask, runId: string, fetchImpl: FetchLike): Promise<FamilyRunResult> {
  const cards: PassiveResultCard[] = [];
  const dataDir = resolve(env.dataDir);
  if (!existsSync(dataDir)) {
    cards.push(
      serviceIssueCard(
        task,
        runId,
        'Mini Hub data directory is missing',
        `Expected data directory was not found at ${dataDir}.`,
        88,
        stableSourceRef('file', 'Mini Hub data directory', { id: 'mini-hub-data-dir', filePath: dataDir })
      )
    );
  }

  const disconnected = Array.from(store.integrationConnections.values()).filter((connection) =>
    ['needs_reauth', 'revoked', 'error'].includes(connection.status)
  );
  if (disconnected.length) {
    cards.push(
      card({
        id: id('passive-card'),
        taskId: task.id,
        runId,
        family: task.family,
        title: `${disconnected.length} integration connection${disconnected.length === 1 ? '' : 's'} need attention`,
        summary: disconnected.map((connection) => `${connection.provider}: ${connection.status}`).join('; '),
        urgency: 78,
        confidence: 0.95,
        route: routeMap.productivity,
        sourceRefs: disconnected.slice(0, 5).map((connection) =>
          stableSourceRef('record', connection.accountLabel, {
            id: connection.id,
            route: routeMap.productivity,
            metadata: { provider: connection.provider, status: connection.status }
          })
        ),
        suggestedAction: 'Reconnect provider',
        actionKind: 'inspect',
        why: 'An existing integration connection is not connected.'
      })
    );
  }

  try {
    const status = await fetchJsonWithTimeout(fetchImpl, new URL('/api/ai/status', env.aiOsApiUrl), 'AI OS');
    const jobs = isRecord(status) && Array.isArray(status.jobs) ? status.jobs : [];
    const failedJobs = jobs.filter((job) => isRecord(job) && ['failed', 'blocked'].includes(String(job.status ?? '')));
    if (failedJobs.length) {
      cards.push(
        serviceIssueCard(
          task,
          runId,
          `${failedJobs.length} AI OS job${failedJobs.length === 1 ? '' : 's'} failed`,
          'AI OS reported failed or blocked job records.',
          78,
          stableSourceRef('service', 'AI OS jobs', { id: 'ai-os-jobs', route: routeMap.aiOs })
        )
      );
    }
    const backups = isRecord(status) && Array.isArray(status.backups) ? status.backups : [];
    const latestBackup = backups.find(isRecord);
    if (!latestBackup) {
      cards.push(
        serviceIssueCard(
          task,
          runId,
          'AI OS has no visible backup',
          'AI OS status did not report any recent backup artifact.',
          70,
          stableSourceRef('service', 'AI OS backups', { id: 'ai-os-backups', route: routeMap.aiOs })
        )
      );
    } else if (latestBackup.ok === false) {
      cards.push(
        serviceIssueCard(
          task,
          runId,
          'Latest AI OS backup did not verify',
          String(latestBackup.error ?? 'AI OS reported the latest backup as not ok.'),
          86,
          stableSourceRef('service', 'AI OS backups', { id: String(latestBackup.id ?? 'latest'), route: routeMap.aiOs })
        )
      );
    }
  } catch (error) {
    cards.push(
      serviceIssueCard(
        task,
        runId,
        'AI OS is unavailable',
        describeError(error),
        82,
        stableSourceRef('service', 'AI OS API', { id: 'ai-os-api', route: routeMap.aiOs, url: env.aiOsApiUrl })
      )
    );
  }

  try {
    const status = await fetchJsonWithTimeout(fetchImpl, new URL('/api/macro-lab/status', env.macroLabApiUrl), 'Macro Lab');
    const engine = isRecord(status) && isRecord(status.engine) ? status.engine : {};
    if (engine.panic === true) {
      cards.push(
        serviceIssueCard(
          task,
          runId,
          'Macro Lab panic is active',
          'Local automation is blocked until panic mode is cleared.',
          92,
          stableSourceRef('service', 'Macro Lab', { id: 'macro-lab', route: routeMap.macroLab })
        )
      );
    }
  } catch (error) {
    cards.push(
      serviceIssueCard(
        task,
        runId,
        'Macro Lab is unavailable',
        describeError(error),
        74,
        stableSourceRef('service', 'Macro Lab API', { id: 'macro-lab-api', route: routeMap.macroLab, url: env.macroLabApiUrl })
      )
    );
  }

  try {
    await fetchJsonWithTimeout(fetchImpl, new URL('/api/tags', env.ollamaBaseUrl), 'Ollama', {}, 1600);
  } catch (error) {
    cards.push(
      serviceIssueCard(
        task,
        runId,
        'Ollama model server is unavailable',
        describeError(error),
        62,
        stableSourceRef('service', 'Ollama', { id: 'ollama', route: routeMap.aiOs, url: env.ollamaBaseUrl })
      )
    );
  }

  if (!cards.length) {
    cards.push(
      card({
        id: id('passive-card'),
        taskId: task.id,
        runId,
        family: task.family,
        title: 'App health checks passed',
        summary: 'Mini Hub data directory exists and local service checks did not surface blockers.',
        urgency: 22,
        confidence: 0.82,
        route: routeMap.settings,
        sourceRefs: [stableSourceRef('service', 'Mini Hub API', { id: 'mini-hub-api', route: routeMap.settings })],
        suggestedAction: 'No action',
        actionKind: 'inspect',
        why: 'A scheduled service health run completed without high-urgency findings.'
      })
    );
  }

  return { status: cards.some((item) => item.urgency >= 85) ? 'blocked' : 'succeeded', cards };
}

function sanitizedMiniHubSnapshot(store: MemoryStore): Record<string, unknown> {
  return {
    createdAt: nowIso(),
    workspaces: Array.from(store.workspaces.values()),
    members: store.members,
    jobs: store.jobs,
    studySessions: store.studySessions,
    careerActions: store.careerActions,
    gameRuns: store.gameRuns,
    settings: store.settings,
    gameStates: Array.from(store.gameStates.values()),
    achievements: store.achievements,
    notes: store.notes,
    integrationConnections: Array.from(store.integrationConnections.values()).map((connection) => ({
      ...connection,
      encryptedTokenSet: connection.encryptedTokenSet ? '[encrypted-redacted]' : ''
    })),
    syncEventCount: store.syncEvents.length,
    actionEventCount: store.actionEvents.length
  };
}

async function runBackupSnapshot(store: MemoryStore, task: PassiveTask, runId: string, fetchImpl: FetchLike): Promise<FamilyRunResult> {
  const createdAt = nowIso();
  const snapshotRoot = join(resolve(env.dataDir), passiveSnapshotDirName);
  mkdirSync(snapshotRoot, { recursive: true });
  const snapshotId = `${createdAt.replace(/[:.]/gu, '-')}_${crypto.randomUUID().slice(0, 8)}`;
  const snapshotPath = join(snapshotRoot, `${snapshotId}.json`);
  writeFileSync(snapshotPath, JSON.stringify(sanitizedMiniHubSnapshot(store), null, 2), 'utf8');

  const cards: PassiveResultCard[] = [
    card({
      id: id('passive-card'),
      taskId: task.id,
      runId,
      family: task.family,
      title: 'Mini Hub restore snapshot created',
      summary: `Wrote ${basename(snapshotPath)} under ${snapshotRoot}.`,
      urgency: 48,
      confidence: 0.95,
      route: routeMap.settings,
      sourceRefs: [stableSourceRef('file', 'Mini Hub restore snapshot', { id: snapshotId, filePath: snapshotPath })],
      suggestedAction: 'Inspect snapshot',
      actionKind: 'inspect',
      why: 'A scheduled non-destructive backup watcher created a restore point.'
    })
  ];
  const changed = [`snapshot:${snapshotPath}`];

  try {
    const payload = await fetchJsonWithTimeout(
      fetchImpl,
      new URL('/api/ai/backups', env.aiOsApiUrl),
      'AI OS backup',
      {
        method: 'POST',
        body: JSON.stringify({ reason: 'passive-task' })
      },
      10000
    );
    const backup = isRecord(payload) && isRecord(payload.backup) ? payload.backup : null;
    if (backup?.id) changed.push(`ai-backup:${String(backup.id)}`);
  } catch (error) {
    cards.push(
      serviceIssueCard(
        task,
        runId,
        'AI OS backup request failed',
        describeError(error),
        66,
        stableSourceRef('service', 'AI OS backups', { id: 'ai-os-backups', route: routeMap.aiOs })
      )
    );
  }

  return { status: 'succeeded', cards, changed, metadata: { snapshotPath } };
}

async function runIdleCompute(task: PassiveTask, runId: string, fetchImpl: FetchLike, input: PassiveRunInput): Promise<FamilyRunResult> {
  if (!input.idle) {
    return {
      status: 'skipped',
      cards: [
        card({
          id: id('passive-card'),
          taskId: task.id,
          runId,
          family: task.family,
          title: 'Idle compute deferred',
          summary: 'The idle compute queue only runs when the scheduler tick is marked idle.',
          urgency: 28,
          confidence: 0.95,
          route: routeMap.aiOs,
          sourceRefs: [stableSourceRef('service', 'Machine mode', { id: 'machine-idle-state', route: routeMap.aiOs })],
          suggestedAction: 'Run during idle window',
          actionKind: 'inspect',
          why: 'This task is configured as idle-only to avoid stealing active desktop resources.'
        })
      ],
      metadata: { idle: false }
    };
  }

  try {
    const payload = await fetchJsonWithTimeout(
      fetchImpl,
      new URL('/api/ai/benchmarks', env.aiOsApiUrl),
      'AI OS benchmark',
      {
        method: 'POST',
        body: JSON.stringify({
          kind: 'text',
          prompt: 'Passive idle benchmark. Reply in one short sentence with the active local AI route capability.',
          iterations: 1,
          max_tokens: 96,
          local_first: true,
          metadata: { source: 'passive-task', task_id: task.id }
        })
      },
      45000
    );
    const benchmark = isRecord(payload) && isRecord(payload.benchmark) ? payload.benchmark : {};
    const speed = typeof benchmark.tokens_per_second === 'number' ? ` at ${benchmark.tokens_per_second.toFixed(1)} tokens/sec` : '';
    return {
      status: 'succeeded',
      cards: [
        card({
          id: id('passive-card'),
          taskId: task.id,
          runId,
          family: task.family,
          title: 'Idle benchmark completed',
          summary: `AI OS logged a text benchmark${speed}.`,
          urgency: 42,
          confidence: 0.86,
          route: routeMap.aiOs,
          sourceRefs: [
            stableSourceRef('record', 'AI OS benchmark', {
              id: String(benchmark.id ?? runId),
              route: routeMap.aiOs,
              metadata: benchmark
            })
          ],
          suggestedAction: 'Inspect route',
          actionKind: 'inspect',
          why: 'The machine was marked idle, so the idle compute queue ran a bounded local benchmark.'
        })
      ],
      changed: benchmark.id ? [`benchmark:${String(benchmark.id)}`] : []
    };
  } catch (error) {
    return {
      status: 'failed',
      error: describeError(error),
      cards: [
        serviceIssueCard(
          task,
          runId,
          'Idle benchmark failed',
          describeError(error),
          70,
          stableSourceRef('service', 'AI OS benchmark', { id: 'ai-os-benchmark', route: routeMap.aiOs })
        )
      ]
    };
  }
}

async function runResearchMonitor(task: PassiveTask, runId: string, fetchImpl: FetchLike): Promise<FamilyRunResult> {
  try {
    const duePayload = await fetchJsonWithTimeout(
      fetchImpl,
      new URL('/api/ai/research/monitors/due?limit=10', env.aiOsApiUrl),
      'Research monitors'
    );
    const due = isRecord(duePayload) && Array.isArray(duePayload.monitors) ? duePayload.monitors.filter(isRecord) : [];
    if (!due.length) {
      return {
        status: 'succeeded',
        cards: [
          card({
            id: id('passive-card'),
            taskId: task.id,
            runId,
            family: task.family,
            title: 'No research monitors are due',
            summary: 'AI OS did not report any due saved research monitors.',
            urgency: 24,
            confidence: 0.85,
            route: routeMap.research,
            sourceRefs: [stableSourceRef('service', 'Research monitors', { id: 'research-monitors', route: routeMap.research })],
            suggestedAction: 'No action',
            actionKind: 'inspect',
            why: 'The monitor sweep checked real saved monitor state.'
          })
        ]
      };
    }

    const sweep = await fetchJsonWithTimeout(
      fetchImpl,
      new URL('/api/ai/research/monitors/run-due', env.aiOsApiUrl),
      'Run due research monitors',
      {
        method: 'POST',
        body: JSON.stringify({ limit: Math.min(5, due.length), dry_run: false, include_manual: false })
      },
      10000
    );
    const queued = isRecord(sweep) && Array.isArray(sweep.runs) ? sweep.runs.filter(isRecord) : [];
    return {
      status: 'succeeded',
      cards: [
        card({
          id: id('passive-card'),
          taskId: task.id,
          runId,
          family: task.family,
          title: `${due.length} research monitor${due.length === 1 ? '' : 's'} due`,
          summary: queued.length ? `Queued ${queued.length} AI OS research run${queued.length === 1 ? '' : 's'}.` : 'Due monitors were found; AI OS returned no run records.',
          urgency: queued.length ? 62 : 70,
          confidence: 0.82,
          route: routeMap.research,
          sourceRefs: due.slice(0, 8).map((monitor) =>
            stableSourceRef('record', String(monitor.name ?? monitor.id ?? 'Research monitor'), {
              id: String(monitor.id ?? crypto.randomUUID()),
              route: routeMap.research,
              metadata: monitor
            })
          ),
          suggestedAction: 'Inspect research runs',
          actionKind: 'inspect',
          why: 'AI OS reported saved research monitors whose schedules are due.'
        })
      ],
      changed: queued.map((run) => `research-run:${String(run.id ?? '')}`).filter((value) => !value.endsWith(':'))
    };
  } catch (error) {
    return {
      status: 'failed',
      error: describeError(error),
      cards: [
        serviceIssueCard(
          task,
          runId,
          'Research monitor sweep failed',
          describeError(error),
          68,
          stableSourceRef('service', 'AI OS research', { id: 'ai-os-research', route: routeMap.research })
        )
      ]
    };
  }
}

function runCareerRadar(store: MemoryStore, task: PassiveTask, runId: string): FamilyRunResult {
  const now = Date.now();
  const soonMs = now + 14 * dayMs;
  const overdueActions = store.careerActions.filter((item) => !item.completedAt && item.dueAt && parseTime(item.dueAt) <= now);
  const dueActions = store.careerActions.filter((item) => !item.completedAt && item.dueAt && parseTime(item.dueAt) > now && parseTime(item.dueAt) <= soonMs);
  const staleJobs = store.jobs.filter((job) => {
    if (!['lead', 'saved', 'watching', 'applied', 'interview'].includes(job.status)) return false;
    const nextAction = parseTime(job.nextActionAt);
    if (Number.isFinite(nextAction)) return nextAction <= soonMs;
    return parseTime(job.updatedAt) <= now - 21 * dayMs;
  });
  const cards: PassiveResultCard[] = [];

  if (overdueActions.length || dueActions.length) {
    cards.push(
      card({
        id: id('passive-card'),
        taskId: task.id,
        runId,
        family: task.family,
        title: `${overdueActions.length} overdue and ${dueActions.length} upcoming career action${overdueActions.length + dueActions.length === 1 ? '' : 's'}`,
        summary: [...overdueActions, ...dueActions].slice(0, 4).map((item) => item.label).join('; '),
        urgency: overdueActions.length ? 86 : 70,
        confidence: 0.92,
        route: routeMap.careerDesk,
        sourceRefs: [...overdueActions, ...dueActions].slice(0, 8).map((item) =>
          stableSourceRef('record', item.label, {
            id: item.id,
            route: routeMap.careerDesk,
            metadata: { dueAt: item.dueAt, jobId: item.jobId }
          })
        ),
        suggestedAction: 'Complete or reschedule',
        actionKind: 'inspect',
        why: 'Career Desk actions have due dates within the radar window.'
      })
    );
  }

  if (staleJobs.length) {
    cards.push(
      card({
        id: id('passive-card'),
        taskId: task.id,
        runId,
        family: task.family,
        title: `${staleJobs.length} career lead${staleJobs.length === 1 ? '' : 's'} need follow-up`,
        summary: staleJobs.slice(0, 4).map((job) => `${job.company} - ${job.role}`).join('; '),
        urgency: staleJobs.some((job) => Number.isFinite(parseTime(job.nextActionAt)) && parseTime(job.nextActionAt) <= now) ? 80 : 62,
        confidence: 0.78,
        route: routeMap.careerDesk,
        sourceRefs: staleJobs.slice(0, 8).map((job) =>
          stableSourceRef('record', `${job.company} - ${job.role}`, {
            id: job.id,
            route: routeMap.careerDesk,
            metadata: { status: job.status, nextActionAt: job.nextActionAt }
          })
        ),
        suggestedAction: 'Review job status',
        actionKind: 'inspect',
        why: 'Saved job records have overdue next-action dates or have gone stale without a next action.'
      })
    );
  }

  if (!cards.length) {
    cards.push(
      card({
        id: id('passive-card'),
        taskId: task.id,
        runId,
        family: task.family,
        title: 'Career radar is quiet',
        summary: 'No overdue career actions or stale saved jobs were found.',
        urgency: 24,
        confidence: 0.86,
        route: routeMap.careerDesk,
        sourceRefs: [stableSourceRef('record', 'Career Desk', { id: 'career-desk', route: routeMap.careerDesk })],
        suggestedAction: 'No action',
        actionKind: 'inspect',
        why: 'The radar used current Career Desk records and found no urgent follow-up.'
      })
    );
  }

  return { status: 'succeeded', cards };
}

function safeConfiguredFolders(settings: PassiveEngineSettings): string[] {
  return Array.from(new Set(settings.watchedFolders.map((folder) => folder.trim()).filter(Boolean))).slice(0, 16);
}

function recentInterestingFiles(folder: string): Array<{ path: string; size: number; mtimeMs: number }> {
  const extensions = new Set(['.pdf', '.doc', '.docx', '.txt', '.md', '.png', '.jpg', '.jpeg', '.webp']);
  const entries: Array<{ path: string; size: number; mtimeMs: number }> = [];
  const cutoff = Date.now() - 7 * dayMs;
  for (const entry of readdirSync(folder, { withFileTypes: true }).slice(0, 500)) {
    if (!entry.isFile()) continue;
    const fullPath = join(folder, entry.name);
    const extension = extname(entry.name).toLowerCase();
    if (!extensions.has(extension)) continue;
    const stat = statSync(fullPath);
    if (stat.mtimeMs < cutoff) continue;
    entries.push({ path: fullPath, size: stat.size, mtimeMs: stat.mtimeMs });
  }
  return entries.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 20);
}

function runFileIntelligence(store: MemoryStore, task: PassiveTask, runId: string): FamilyRunResult {
  const settings = store.passiveSettings ?? defaultPassiveSettings();
  const folders = safeConfiguredFolders(settings);
  if (!folders.length) {
    return {
      status: 'succeeded',
      cards: [
        card({
          id: id('passive-card'),
          taskId: task.id,
          runId,
          family: task.family,
          title: 'No folders configured for file intelligence',
          summary: 'Add watched folders in Settings or Passive Tasks before this watcher reads local files.',
          urgency: 38,
          confidence: 0.95,
          route: routeMap.passiveTasks,
          sourceRefs: [stableSourceRef('record', 'Passive settings', { id: 'passive-settings', route: routeMap.passiveTasks })],
          suggestedAction: 'Configure folders',
          actionKind: 'inspect',
          why: 'The file watcher respects configured folders only.'
        })
      ]
    };
  }

  const cards: PassiveResultCard[] = [];
  for (const folder of folders) {
    try {
      const resolved = resolve(folder);
      if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
        cards.push(
          serviceIssueCard(
            task,
            runId,
            'Configured watched folder is unavailable',
            resolved,
            64,
            stableSourceRef('file', basename(resolved) || resolved, { id: resolved, filePath: resolved })
          )
        );
        continue;
      }
      const files = recentInterestingFiles(resolved);
      if (files.length) {
        cards.push(
          card({
            id: id('passive-card'),
            taskId: task.id,
            runId,
            family: task.family,
            title: `${files.length} recent file${files.length === 1 ? '' : 's'} in ${basename(resolved) || resolved}`,
            summary: files.slice(0, 5).map((file) => basename(file.path)).join('; '),
            urgency: files.length >= 8 ? 60 : 46,
            confidence: 0.72,
            route: routeMap.passiveTasks,
            sourceRefs: files.slice(0, 10).map((file) =>
              stableSourceRef('file', basename(file.path), {
                id: file.path,
                filePath: file.path,
                metadata: { size: file.size, modifiedAt: new Date(file.mtimeMs).toISOString() }
              })
            ),
            suggestedAction: 'Inspect files',
            actionKind: 'inspect',
            why: 'Configured folder metadata shows recently changed document or image files.'
          })
        );
      }
    } catch (error) {
      cards.push(
        serviceIssueCard(
          task,
          runId,
          'Folder scan failed',
          describeError(error),
          64,
          stableSourceRef('file', folder, { id: folder, filePath: folder })
        )
      );
    }
  }

  if (!cards.length) {
    cards.push(
      card({
        id: id('passive-card'),
        taskId: task.id,
        runId,
        family: task.family,
        title: 'Watched folders are quiet',
        summary: 'No recently changed document or image files were found in configured folders.',
        urgency: 20,
        confidence: 0.76,
        route: routeMap.passiveTasks,
        sourceRefs: folders.map((folder) => stableSourceRef('file', basename(folder) || folder, { id: folder, filePath: folder })),
        suggestedAction: 'No action',
        actionKind: 'inspect',
        why: 'The scan found no new local files matching the configured watcher scope.'
      })
    );
  }

  return { status: cards.some((item) => item.urgency >= 80) ? 'blocked' : 'succeeded', cards };
}

function countTodos(folder: string): number {
  let count = 0;
  const stack = [folder];
  const ignored = new Set(['node_modules', '.git', 'dist', 'build', '.svelte-kit', 'coverage']);
  while (stack.length && count < 100) {
    const current = stack.pop()!;
    for (const entry of readdirSync(current, { withFileTypes: true }).slice(0, 400)) {
      if (entry.isDirectory()) {
        if (!ignored.has(entry.name)) stack.push(join(current, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      const extension = extname(entry.name).toLowerCase();
      if (!['.ts', '.js', '.svelte', '.py', '.md', '.txt'].includes(extension)) continue;
      const text = readFileSync(join(current, entry.name), 'utf8').slice(0, 200_000);
      count += (text.match(/\b(TODO|FIXME)\b/giu) ?? []).length;
    }
  }
  return count;
}

function runProjectDrift(store: MemoryStore, task: PassiveTask, runId: string): FamilyRunResult {
  const settings = store.passiveSettings ?? defaultPassiveSettings();
  const folders = safeConfiguredFolders(settings);
  if (!folders.length) {
    return {
      status: 'succeeded',
      cards: [
        card({
          id: id('passive-card'),
          taskId: task.id,
          runId,
          family: task.family,
          title: 'No project folders configured',
          summary: 'Project Drift Detector only scans folders you configure.',
          urgency: 36,
          confidence: 0.95,
          route: routeMap.passiveTasks,
          sourceRefs: [stableSourceRef('record', 'Passive settings', { id: 'passive-settings', route: routeMap.passiveTasks })],
          suggestedAction: 'Configure project folders',
          actionKind: 'inspect',
          why: 'The project watcher respects configured folders only.'
        })
      ]
    };
  }

  const cards: PassiveResultCard[] = [];
  for (const folder of folders) {
    try {
      const resolved = resolve(folder);
      if (!existsSync(resolved) || !statSync(resolved).isDirectory()) continue;
      const readme = ['README.md', 'readme.md'].map((name) => join(resolved, name)).find((path) => existsSync(path));
      const packagePath = join(resolved, 'package.json');
      const sourceRefs: PassiveSourceRef[] = [stableSourceRef('file', basename(resolved) || resolved, { id: resolved, filePath: resolved })];
      const issues: string[] = [];

      if (!readme) {
        issues.push('missing README');
      } else {
        sourceRefs.push(stableSourceRef('file', 'README', { id: readme, filePath: readme }));
        const readmeAgeDays = Math.round((Date.now() - statSync(readme).mtimeMs) / dayMs);
        if (readmeAgeDays > 90) issues.push(`README stale for ${readmeAgeDays} days`);
      }

      if (existsSync(packagePath)) {
        sourceRefs.push(stableSourceRef('file', 'package.json', { id: packagePath, filePath: packagePath }));
        const parsed = JSON.parse(readFileSync(packagePath, 'utf8')) as unknown;
        const scripts = isRecord(parsed) && isRecord(parsed.scripts) ? parsed.scripts : {};
        if (!('test' in scripts) && !('check' in scripts)) issues.push('no test/check script');
      }

      const todos = countTodos(resolved);
      if (todos >= 20) issues.push(`${todos} TODO/FIXME markers`);

      if (issues.length) {
        cards.push(
          card({
            id: id('passive-card'),
            taskId: task.id,
            runId,
            family: task.family,
            title: `${basename(resolved) || resolved} may be drifting`,
            summary: issues.join('; '),
            urgency: issues.length >= 2 ? 74 : 58,
            confidence: 0.68,
            route: routeMap.passiveTasks,
            sourceRefs,
            suggestedAction: 'Inspect project',
            actionKind: 'inspect',
            why: 'Configured project metadata shows stale docs, TODO buildup, or missing health scripts.'
          })
        );
      }
    } catch (error) {
      cards.push(
        serviceIssueCard(
          task,
          runId,
          'Project drift scan failed',
          describeError(error),
          64,
          stableSourceRef('file', folder, { id: folder, filePath: folder })
        )
      );
    }
  }

  if (!cards.length) {
    cards.push(
      card({
        id: id('passive-card'),
        taskId: task.id,
        runId,
        family: task.family,
        title: 'Configured projects look steady',
        summary: 'No README, TODO, or package health drift was detected in configured folders.',
        urgency: 22,
        confidence: 0.7,
        route: routeMap.passiveTasks,
        sourceRefs: folders.map((folder) => stableSourceRef('file', basename(folder) || folder, { id: folder, filePath: folder })),
        suggestedAction: 'No action',
        actionKind: 'inspect',
        why: 'The project scan found no configured-folder drift signals.'
      })
    );
  }

  return { status: 'succeeded', cards };
}

async function executeFamily(
  store: MemoryStore,
  task: PassiveTask,
  runId: string,
  fetchImpl: FetchLike,
  input: PassiveRunInput
): Promise<FamilyRunResult> {
  if (task.family === 'app_health') return runAppHealth(store, task, runId, fetchImpl);
  if (task.family === 'backup_snapshot') return runBackupSnapshot(store, task, runId, fetchImpl);
  if (task.family === 'idle_compute') return runIdleCompute(task, runId, fetchImpl, input);
  if (task.family === 'research_monitor') return runResearchMonitor(task, runId, fetchImpl);
  if (task.family === 'career_radar') return runCareerRadar(store, task, runId);
  if (task.family === 'file_intelligence') return runFileIntelligence(store, task, runId);
  return runProjectDrift(store, task, runId);
}

function updateWatcherAfterRun(store: MemoryStore, task: PassiveTask, run: PassiveRun): void {
  const watcherIndex = store.passiveWatchers.findIndex((watcher) => watcher.id === task.watcherId);
  if (watcherIndex < 0) return;
  const watcher = store.passiveWatchers[watcherIndex]!;
  store.passiveWatchers[watcherIndex] = passiveWatcherSchema.parse({
    ...watcher,
    lastRunAt: run.finishedAt,
    nextRunAt: run.nextRunAt,
    error: run.status === 'failed' || run.status === 'blocked' ? run.error : undefined,
    updatedAt: nowIso()
  });
}

export async function runPassiveTask(
  store: MemoryStore,
  taskId: string,
  options: { externalFetch?: FetchLike; input?: PassiveRunInput; force?: boolean } = {}
): Promise<PassiveRun> {
  ensurePassiveDefaults(store);
  const taskIndex = store.passiveTasks.findIndex((item) => item.id === taskId);
  if (taskIndex < 0) throw new Error('Passive task not found.');
  const task = store.passiveTasks[taskIndex]!;
  if (!options.force && (!store.passiveSettings?.enabled || !watcherEnabled(store, task))) {
    throw new Error('Passive task is disabled.');
  }
  if (!options.force && ['paused', 'cancelled', 'running'].includes(task.status)) {
    throw new Error(`Passive task is ${task.status}.`);
  }

  const fetchImpl = options.externalFetch ?? fetch;
  const startedAt = nowIso();
  const runId = id('passive-run');
  const attempt = task.retry.attempts + 1;
  store.passiveTasks[taskIndex] = passiveTaskSchema.parse({ ...task, status: 'running', updatedAt: startedAt });
  persistPassiveTasks(store);

  let result: FamilyRunResult;
  try {
    result = await executeFamily(store, task, runId, fetchImpl, options.input ?? {});
  } catch (error) {
    result = {
      status: 'failed',
      error: describeError(error),
      cards: [
        card({
          id: id('passive-card'),
          taskId: task.id,
          runId,
          family: task.family,
          title: `${familyLabels[task.family]} failed`,
          summary: describeError(error),
          urgency: 76,
          confidence: 0.8,
          route: task.route,
          sourceRefs: [stableSourceRef('record', task.title, { id: task.id, route: task.route })],
          suggestedAction: 'Inspect failure',
          actionKind: 'inspect',
          why: 'The passive task runner raised an exception.'
        })
      ]
    };
  }

  const finished = new Date();
  const run = passiveRunSchema.parse({
    id: runId,
    taskId: task.id,
    watcherId: task.watcherId,
    family: task.family,
    status: result.status,
    startedAt,
    finishedAt: nowIso(finished),
    durationMs: Math.max(0, finished.getTime() - parseTime(startedAt)),
    attempt,
    error: result.error,
    cards: result.cards,
    changed: result.changed ?? [],
    nextRunAt: computeNextRunAt(task, finished),
    metadata: {
      reason: options.input?.reason ?? 'scheduled',
      eventName: options.input?.eventName,
      idle: Boolean(options.input?.idle),
      ...(result.metadata ?? {})
    }
  });
  store.passiveRuns.unshift(run);
  store.passiveRuns = store.passiveRuns.slice(0, 200);

  const nextTask = applyRunOutcomeToTask(task, run, finished);
  store.passiveTasks[taskIndex] = nextTask;
  updateWatcherAfterRun(store, nextTask, run);

  const notification = notificationFromRun(run, result.cards);
  const notificationStyle = store.passiveSettings?.notificationStyle ?? 'digest';
  if (notification && notificationStyle !== 'off' && (notificationStyle !== 'urgent_only' || notification.level === 'urgent')) {
    store.passiveNotifications.unshift(notification);
    store.passiveNotifications = store.passiveNotifications.slice(0, 200);
  }

  appendActionLedgerEvent(store, {
    system: 'mini-hub',
    source: 'passive-tasks',
    actionType: `passive.${task.family}`,
    summary: `${familyLabels[task.family]} ${run.status}`,
    status:
      run.status === 'succeeded' || run.status === 'skipped'
        ? 'succeeded'
        : run.status === 'cancelled'
          ? 'cancelled'
          : run.status === 'blocked'
            ? 'blocked'
            : 'failed',
    risk: task.family === 'backup_snapshot' || task.family === 'idle_compute' || task.family === 'research_monitor' ? 'system' : 'read',
    mode: task.machineMode,
    changed: run.changed,
    recoverability: {
      kind: task.family === 'backup_snapshot' ? 'backup' : run.changed.length ? 'artifact' : 'none',
      referenceId: run.changed[0],
      route: task.route,
      description: task.family === 'backup_snapshot' ? 'Passive backup/snapshot run created non-destructive restore artifacts.' : 'Passive run history records outputs and source references.',
      reversible: task.family === 'backup_snapshot'
    },
    rawRef: { kind: 'passive_run', id: run.id, taskId: task.id, family: task.family },
    metadata: { cards: run.cards.length, error: run.error, reason: run.metadata.reason }
  });
  persistPassiveTasks(store);
  return run;
}

export async function runDuePassiveTasks(
  store: MemoryStore,
  options: { externalFetch?: FetchLike; input?: PassiveRunInput; limit?: number } = {}
): Promise<PassiveRun[]> {
  ensurePassiveDefaults(store);
  const limit = options.limit ?? store.passiveSettings?.maxRunsPerTick ?? 3;
  const tasks = duePassiveTasks(store, new Date(), options.input).slice(0, Math.max(1, limit));
  const runs: PassiveRun[] = [];
  for (const task of tasks) {
    const runOptions: { externalFetch?: FetchLike; input?: PassiveRunInput; force?: boolean } = {};
    if (options.externalFetch) runOptions.externalFetch = options.externalFetch;
    if (options.input) runOptions.input = options.input;
    runs.push(await runPassiveTask(store, task.id, runOptions));
  }
  return runs;
}

export async function runPassiveEvent(
  store: MemoryStore,
  eventName: string,
  options: { externalFetch?: FetchLike; input?: Omit<PassiveRunInput, 'eventName'>; limit?: number } = {}
): Promise<PassiveRun[]> {
  const input: PassiveRunInput = {
    ...(options.input ?? {}),
    eventName,
    reason: options.input?.reason ?? `event:${eventName}`
  };
  const runOptions: { externalFetch?: FetchLike; input: PassiveRunInput; limit?: number } = { input };
  if (options.externalFetch) runOptions.externalFetch = options.externalFetch;
  if (options.limit !== undefined) runOptions.limit = options.limit;
  return runDuePassiveTasks(store, runOptions);
}

export function startPassiveTaskWorker(
  store: MemoryStore,
  options: { externalFetch?: FetchLike; intervalMs?: number } = {}
): () => void {
  const intervalMs = options.intervalMs ?? 5 * minuteMs;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const tickOptions: { externalFetch?: FetchLike; input?: PassiveRunInput } = {
        input: { reason: 'worker-tick', idle: false }
      };
      if (options.externalFetch) tickOptions.externalFetch = options.externalFetch;
      await runDuePassiveTasks(store, tickOptions);
    } catch (error) {
      console.warn(`Passive task worker tick failed: ${describeError(error)}`);
    } finally {
      running = false;
    }
  };
  const interval = setInterval(() => {
    void tick();
  }, intervalMs);
  void tick();
  return () => clearInterval(interval);
}

export function updatePassiveTaskStatus(store: MemoryStore, taskId: string, status: PassiveTaskStatus): PassiveTask {
  ensurePassiveDefaults(store);
  const index = store.passiveTasks.findIndex((task) => task.id === taskId);
  if (index < 0) throw new Error('Passive task not found.');
  const existing = store.passiveTasks[index]!;
  const now = nowIso();
  const nextRunAt = status === 'active' && !existing.nextRunAt ? computeNextRunAt(existing) : existing.nextRunAt;
  const next = passiveTaskSchema.parse({
    ...existing,
    status,
    nextRunAt,
    trigger: { ...existing.trigger, nextRunAt },
    retry: status === 'active' ? { ...existing.retry, attempts: 0, nextRetryAt: undefined } : existing.retry,
    updatedAt: now
  });
  store.passiveTasks[index] = next;
  appendActionLedgerEvent(store, {
    system: 'mini-hub',
    source: 'passive-tasks',
    actionType: `passive.task.${status}`,
    summary: `${next.title} ${status}`,
    status: status === 'cancelled' ? 'cancelled' : status === 'paused' ? 'paused' : 'succeeded',
    risk: 'write',
    changed: [`passive-task:${next.id}`],
    recoverability: {
      kind: 'snapshot',
      route: routeMap.passiveTasks,
      description: 'Task state can be changed again from the Passive Tasks dashboard.',
      reversible: true
    },
    rawRef: { kind: 'passive_task', id: next.id },
    metadata: { status }
  });
  persistPassiveTasks(store);
  return next;
}

export function setPassiveWatcherEnabled(store: MemoryStore, watcherId: string, enabled: boolean): PassiveWatcher {
  ensurePassiveDefaults(store);
  const index = store.passiveWatchers.findIndex((watcher) => watcher.id === watcherId);
  if (index < 0) throw new Error('Passive watcher not found.');
  const existing = store.passiveWatchers[index]!;
  const next = passiveWatcherSchema.parse({
    ...existing,
    enabled,
    pausedAt: enabled ? undefined : nowIso(),
    updatedAt: nowIso()
  });
  store.passiveWatchers[index] = next;
  if (store.passiveSettings) {
    store.passiveSettings = passiveEngineSettingsSchema.parse({
      ...store.passiveSettings,
      enabledFamilies: {
        ...store.passiveSettings.enabledFamilies,
        [next.family]: enabled
      },
      updatedAt: nowIso()
    });
  }
  appendActionLedgerEvent(store, {
    system: 'mini-hub',
    source: 'passive-tasks',
    actionType: enabled ? 'passive.watcher.enable' : 'passive.watcher.disable',
    summary: `${next.title} ${enabled ? 'enabled' : 'disabled'}`,
    status: 'succeeded',
    risk: 'write',
    changed: [`passive-watcher:${next.id}`],
    recoverability: {
      kind: 'snapshot',
      route: routeMap.passiveTasks,
      description: 'Watcher enablement is persisted and can be toggled again.',
      reversible: true
    },
    rawRef: { kind: 'passive_watcher', id: next.id },
    metadata: { enabled }
  });
  persistPassiveTasks(store);
  return next;
}

export function updatePassiveSettings(
  store: MemoryStore,
  patch: Partial<Omit<PassiveEngineSettings, 'updatedAt'>>
): PassiveEngineSettings {
  ensurePassiveDefaults(store);
  const existing = store.passiveSettings ?? defaultPassiveSettings();
  const next = passiveEngineSettingsSchema.parse({
    ...existing,
    ...patch,
    enabledFamilies: {
      ...existing.enabledFamilies,
      ...(patch.enabledFamilies ?? {})
    },
    watchedFolders: patch.watchedFolders ?? existing.watchedFolders,
    watchedDomains: patch.watchedDomains ?? existing.watchedDomains,
    watchedAccounts: patch.watchedAccounts ?? existing.watchedAccounts,
    updatedAt: nowIso()
  });
  store.passiveSettings = next;
  store.passiveWatchers = store.passiveWatchers.map((watcher) =>
    passiveWatcherSchema.parse({
      ...watcher,
      enabled: next.enabledFamilies[watcher.family] !== false,
      updatedAt: nowIso()
    })
  );
  appendActionLedgerEvent(store, {
    system: 'mini-hub',
    source: 'passive-tasks',
    actionType: 'passive.settings.update',
    summary: 'Passive task settings updated',
    status: 'succeeded',
    risk: 'write',
    changed: ['passive-settings'],
    recoverability: {
      kind: 'snapshot',
      route: routeMap.passiveTasks,
      description: 'Settings are persisted in the local passive task state file.',
      reversible: true
    },
    rawRef: { kind: 'passive_settings' },
    metadata: { patch: Object.keys(patch) }
  });
  persistPassiveTasks(store);
  return next;
}

export function buildPassiveDigest(store: MemoryStore, limit = 12): PassiveResultCard[] {
  const seen = new Set<string>();
  const cards: PassiveResultCard[] = [];
  for (const run of store.passiveRuns) {
    for (const item of run.cards) {
      const key = `${item.family}:${item.title}:${item.summary}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (item.urgency >= passiveDigestUrgency || run.status === 'failed' || run.status === 'blocked') cards.push(item);
    }
  }
  return cards.sort((a, b) => b.urgency - a.urgency || parseTime(b.createdAt) - parseTime(a.createdAt)).slice(0, limit);
}

export function buildPassiveSourceStatuses(store: MemoryStore): PassiveSourceStatus[] {
  return store.passiveTasks.map((task) => {
    const run = latestRunForTask(store, task.id);
    const fetchedAt = run?.finishedAt ?? task.lastRunAt;
    const error = task.lastError ?? run?.error;
    const status: PassiveSourceStatus['status'] =
      task.status === 'blocked' || run?.status === 'failed' || run?.status === 'blocked'
        ? 'error'
        : watcherEnabled(store, task)
          ? 'ok'
          : 'unavailable';
    return sourceStatus({
      id: task.family,
      label: familyLabels[task.family],
      status,
      ...(fetchedAt ? { fetchedAt } : {}),
      ...(error ? { error } : {}),
      details: {
        taskId: task.id,
        watcherId: task.watcherId,
        nextRunAt: task.nextRunAt,
        status: task.status,
        lastRunStatus: run?.status
      }
    });
  });
}

export function buildPassiveSnapshot(store: MemoryStore): PassiveSnapshot {
  ensurePassiveDefaults(store);
  const errors = store.passiveTasks
    .filter((task) => task.lastError)
    .map((task) => `${familyLabels[task.family]}: ${task.lastError}`)
    .slice(0, 12);
  return passiveSnapshotSchema.parse({
    checkedAt: nowIso(),
    settings: store.passiveSettings ?? defaultPassiveSettings(),
    watchers: store.passiveWatchers,
    tasks: store.passiveTasks,
    runs: store.passiveRuns.slice(0, 50),
    notifications: store.passiveNotifications.slice(0, 50),
    digest: buildPassiveDigest(store),
    sources: buildPassiveSourceStatuses(store),
    errors
  });
}

function attentionAction(kind: AttentionAction['kind'], label: string, route: string, available = true, reason?: string): AttentionAction {
  return {
    kind,
    label,
    route,
    available,
    reason,
    requiresOnline: kind !== 'open' && kind !== 'inspect',
    risk: kind === 'run' ? 'system' : kind === 'dismiss' || kind === 'snooze' ? 'write' : 'read'
  };
}

export function collectPassiveAttentionItems(store: MemoryStore): AttentionItem[] {
  ensurePassiveDefaults(store);
  return buildPassiveDigest(store, 8)
    .filter((item) => item.urgency >= attentionUrgency)
    .map((item) => ({
      id: `passive-task:${item.id}`,
      source: 'passive_task' as const,
      sourceId: item.id,
      title: item.title,
      detail: item.summary,
      route: item.route,
      dueAt: item.createdAt,
      priority: Math.min(100, Math.max(0, Math.round(item.urgency))),
      status: item.urgency >= 85 ? ('blocked' as const) : ('active' as const),
      actionKind: item.actionKind ?? 'inspect',
      actions: [
        attentionAction('inspect', 'Inspect', item.route),
        attentionAction('run', 'Run watcher', routeMap.passiveTasks, true),
        attentionAction('snooze', 'Snooze', routeMap.passiveTasks),
        attentionAction('dismiss', 'Dismiss', routeMap.passiveTasks)
      ],
      recoverability: {
        kind: 'artifact' as const,
        referenceId: item.runId,
        route: routeMap.passiveTasks,
        description: 'Passive task cards are backed by persisted run history and source references.',
        reversible: false
      },
      readOnly: false,
      writable: true,
      metadata: {
        taskId: item.taskId,
        runId: item.runId,
        family: item.family,
        confidence: item.confidence,
        why: item.why,
        sourceRefs: item.sourceRefs
      }
    }));
}
