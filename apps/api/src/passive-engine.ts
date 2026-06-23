import {
  passiveEngineSettingsSchema,
  passiveCardTriageStateSchema,
  passiveNotificationSchema,
  passiveResultSchema,
  passiveResultCardSchema,
  passiveRunSchema,
  passiveSnapshotSchema,
  passiveSourceStatusSchema,
  passiveTaskErrorLogEntrySchema,
  passiveTaskSchema,
  passiveTriggerSchema,
  passiveWorkerStateSchema,
  passiveWatcherSchema,
  routeMap,
  type AttentionAction,
  type AttentionItem,
  type IntegrationConnection,
  type PassiveEngineSettings,
  type PassiveCardTriageStatus,
  type PassiveNotification,
  type PassiveResult,
  type PassiveResultCard,
  type PassiveRun,
  type PassiveRunStatus,
  type PassiveSnapshot,
  type PassiveSourceRef,
  type PassiveSourceStatus,
  type PassiveTask,
  type PassiveTaskFamily,
  type PassiveTaskStatus,
  type PassiveTrigger,
  type PassiveTriggerKind,
  type PassiveWorkerState,
  type PassiveWatcher
} from '@mini-hub/core';
import {
  existsSync,
  closeSync,
  type FSWatcher,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
  watch as watchFs,
  writeFileSync
} from 'node:fs';
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { platform } from 'node:os';
import { promisify } from 'node:util';
import { env } from './env';
import { appendActionLedgerEvent, persistPassiveTasks, redactActionLedgerEvent, type MemoryStore } from './store';

type FetchLike = typeof fetch;
type PassiveMachineMode = 'balanced' | 'beast' | 'quiet' | 'offline' | 'night' | 'maintenance';
const execFileAsync = promisify(execFile);

interface FileInsight {
  path: string;
  size: number;
  mtimeMs: number;
  extension: string;
  kind: 'document' | 'image' | 'data' | 'note' | 'other';
  tags: string[];
  cleanupHints: string[];
  metadata: Record<string, unknown>;
  preview?: string;
  indexableText?: string;
}

interface CleanupCandidate {
  path: string;
  kind: 'snapshot' | 'log' | 'temp';
  size: number;
  mtimeMs: number;
  reason: string;
}

interface SnapshotVerification {
  ok: boolean;
  bytes: number;
  sha256: string;
  summary: Record<string, number>;
  redactedTokenSets: number;
  error?: string;
}

interface ProjectHealthArtifact {
  path: string;
  summary: string;
  matched: string;
  mtimeMs: number;
}

interface ProjectDocDrift {
  path: string;
  mtimeMs: number;
  readmeMtimeMs: number;
  daysNewerThanReadme: number;
}

interface PassiveResourceBudget {
  watchedFolderLimit: number;
  filesPerFolder: number;
  directoryEntriesPerFolder: number;
  indexableFiles: number;
  indexedFileChars: number;
  idleSummaryCards: number;
  idleSummaryChars: number;
  projectDirectoryEntries: number;
  projectTodoCap: number;
  projectFileChars: number;
  researchMonitorCreateLimit: number;
  researchMonitorRunLimit: number;
  researchMaxPages: number;
  researchPerDomainLimit: number;
  researchTimeBudgetSeconds: number;
}

interface PassiveResourceDecision {
  checked: boolean;
  source: 'app-health-run' | 'none';
  mode: PassiveMachineMode;
  profileFresh: boolean;
  heavyAiAllowed: boolean;
  summaryAllowed: boolean;
  benchmarkAllowed: boolean;
  resourcePressureLevel?: string;
  resourcePressureDrivers: string[];
  suggestedMaxJobConcurrency?: number;
  skipReason?: string;
  profileRunId?: string;
  profileFinishedAt?: string;
  profileAgeMinutes?: number;
  preferredLocalRoute?: Record<string, unknown>;
}

export interface PassiveRunInput {
  idle?: boolean;
  reason?: string;
  eventName?: string;
  idleMinutes?: number;
  idleSource?: string;
  idleError?: string;
  eventFolder?: string;
  eventFileName?: string;
  eventFilePath?: string;
  eventKind?: string;
}

export interface PassiveIdleState {
  idle: boolean;
  thresholdMinutes: number;
  checkedAt: string;
  source: string;
  idleMinutes?: number;
  error?: string;
}

export type PassiveIdleDetector = (thresholdMinutes: number) => PassiveIdleState | Promise<PassiveIdleState>;
export type PassiveFolderWatchListener = (eventType: string, fileName?: string) => void;
export type PassiveFolderWatchFactory = (folder: string, listener: PassiveFolderWatchListener) => Pick<FSWatcher, 'close'>;

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
  eventNames?: string[];
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
const maxTaskErrorLogEntries = 12;
const passiveNotificationDedupeMs = dayMs;
const passiveMachineProfileFreshMs = 60 * minuteMs;
const windowsIdleScript = `
$ErrorActionPreference = "Stop"
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class MiniHubIdleState {
  [StructLayout(LayoutKind.Sequential)]
  public struct LASTINPUTINFO {
    public uint cbSize;
    public uint dwTime;
  }
  [DllImport("user32.dll")]
  public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
  public static uint GetIdleMilliseconds() {
    LASTINPUTINFO info = new LASTINPUTINFO();
    info.cbSize = (uint)System.Runtime.InteropServices.Marshal.SizeOf(typeof(LASTINPUTINFO));
    if (!GetLastInputInfo(ref info)) {
      return 0;
    }
    return ((uint)Environment.TickCount - info.dwTime);
  }
}
"@
$idleMs = [MiniHubIdleState]::GetIdleMilliseconds()
[pscustomobject]@{ idleMs = $idleMs; source = "windows-last-input" } | ConvertTo-Json -Compress
`;

const familyLabels: Record<PassiveTaskFamily, string> = {
  app_health: 'App Health Watchdog',
  backup_snapshot: 'Backup + Snapshot Watcher',
  idle_compute: 'Idle Compute Queue',
  research_monitor: 'Background Research Monitor',
  career_radar: 'Career Radar',
  file_intelligence: 'Local File Intelligence',
  project_drift: 'Project Drift Detector'
};

const passiveResourceBudgets: Record<PassiveEngineSettings['resourceLimit'], PassiveResourceBudget> = {
  light: {
    watchedFolderLimit: 6,
    filesPerFolder: 8,
    directoryEntriesPerFolder: 200,
    indexableFiles: 1,
    indexedFileChars: 30_000,
    idleSummaryCards: 4,
    idleSummaryChars: 6_000,
    projectDirectoryEntries: 150,
    projectTodoCap: 50,
    projectFileChars: 80_000,
    researchMonitorCreateLimit: 2,
    researchMonitorRunLimit: 2,
    researchMaxPages: 3,
    researchPerDomainLimit: 2,
    researchTimeBudgetSeconds: 45
  },
  balanced: {
    watchedFolderLimit: 16,
    filesPerFolder: 20,
    directoryEntriesPerFolder: 500,
    indexableFiles: 3,
    indexedFileChars: 80_000,
    idleSummaryCards: 8,
    idleSummaryChars: 12_000,
    projectDirectoryEntries: 400,
    projectTodoCap: 100,
    projectFileChars: 200_000,
    researchMonitorCreateLimit: 5,
    researchMonitorRunLimit: 5,
    researchMaxPages: 6,
    researchPerDomainLimit: 4,
    researchTimeBudgetSeconds: 90
  },
  heavy: {
    watchedFolderLimit: 24,
    filesPerFolder: 40,
    directoryEntriesPerFolder: 900,
    indexableFiles: 5,
    indexedFileChars: 120_000,
    idleSummaryCards: 12,
    idleSummaryChars: 20_000,
    projectDirectoryEntries: 700,
    projectTodoCap: 180,
    projectFileChars: 300_000,
    researchMonitorCreateLimit: 8,
    researchMonitorRunLimit: 8,
    researchMaxPages: 10,
    researchPerDomainLimit: 6,
    researchTimeBudgetSeconds: 150
  }
};

function resourceBudget(settings: PassiveEngineSettings): PassiveResourceBudget {
  return passiveResourceBudgets[settings.resourceLimit] ?? passiveResourceBudgets.balanced;
}

const passiveMachineModes = new Set<PassiveMachineMode>(['balanced', 'beast', 'quiet', 'offline', 'night', 'maintenance']);
const quietDeferredFamilies = new Set<PassiveTaskFamily>(['idle_compute', 'research_monitor', 'file_intelligence', 'project_drift']);

function passiveMachineMode(value: unknown): PassiveMachineMode | null {
  return typeof value === 'string' && passiveMachineModes.has(value as PassiveMachineMode) ? (value as PassiveMachineMode) : null;
}

function currentPassiveMachineMode(store: MemoryStore): PassiveMachineMode {
  const preferences = store.settings?.preferences;
  if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) return 'balanced';
  return passiveMachineMode((preferences as Record<string, unknown>).machineMode) ?? 'balanced';
}

function taskMachineMode(store: MemoryStore, task: PassiveTask): { mode: PassiveMachineMode; source: 'task' | 'settings' } {
  const explicit = passiveMachineMode(task.machineMode);
  if (explicit) return { mode: explicit, source: 'task' };
  return { mode: currentPassiveMachineMode(store), source: 'settings' };
}

function passiveModePolicy(
  task: PassiveTask,
  currentMode: PassiveMachineMode
): { allowed: boolean; priorityDelta: number; reason?: string } {
  const explicitMode = passiveMachineMode(task.machineMode);
  if (explicitMode && explicitMode !== currentMode) {
    return {
      allowed: false,
      priorityDelta: 0,
      reason: `Task is pinned to ${explicitMode} mode.`
    };
  }

  if (currentMode === 'quiet' && quietDeferredFamilies.has(task.family)) {
    return {
      allowed: false,
      priorityDelta: 0,
      reason: 'Quiet Mode defers heavier passive work.'
    };
  }

  if (currentMode === 'offline' && task.family === 'research_monitor') {
    return {
      allowed: false,
      priorityDelta: 0,
      reason: 'Offline Mode skips web-backed research monitor sweeps.'
    };
  }

  if (currentMode === 'beast' && ['idle_compute', 'research_monitor', 'file_intelligence'].includes(task.family)) {
    return { allowed: true, priorityDelta: 8 };
  }

  if (currentMode === 'maintenance' && ['app_health', 'backup_snapshot', 'project_drift', 'idle_compute'].includes(task.family)) {
    return { allowed: true, priorityDelta: 10 };
  }

  if (currentMode === 'night' && ['backup_snapshot', 'idle_compute', 'file_intelligence', 'project_drift'].includes(task.family)) {
    return { allowed: true, priorityDelta: 6 };
  }

  return { allowed: true, priorityDelta: 0 };
}

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
    eventNames: ['app.startup', 'app.reconnect', 'service.reconnect', 'google.oauth.connected', 'google.oauth.revoked'],
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
    family: 'file_intelligence',
    taskId: 'passive-task:file-intelligence-event',
    watcherId: 'passive-watcher:file-intelligence',
    title: 'Inspect changed watched folder',
    description: 'Runs local file intelligence when a configured folder reports a file change.',
    detail: 'Event-triggered scan for configured watched folders only.',
    triggerKind: 'event',
    triggerLabel: 'Folder event',
    eventName: 'file.changed',
    eventNames: ['file.changed', 'file.created', 'folder.changed'],
    priority: 74,
    route: routeMap.passiveTasks
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

function addMilliseconds(date: Date, ms: number): string {
  return new Date(date.getTime() + ms).toISOString();
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

function passiveIdleThresholdMinutes(store: MemoryStore): number {
  const configured = store.passiveTasks
    .filter((task) => task.idleOnly)
    .map((task) => task.trigger.idleMinutes)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);
  return configured.length ? Math.min(...configured) : 20;
}

function idleState(input: Omit<PassiveIdleState, 'checkedAt'> & Partial<Pick<PassiveIdleState, 'checkedAt'>>): PassiveIdleState {
  return {
    ...input,
    checkedAt: input.checkedAt ?? nowIso()
  };
}

function parseIdlePayload(value: unknown): { idleMs?: number; source?: string } {
  if (!isRecord(value)) return {};
  const idleMs = typeof value.idleMs === 'number' ? value.idleMs : Number(value.idleMs);
  return {
    ...(Number.isFinite(idleMs) ? { idleMs } : {}),
    ...(typeof value.source === 'string' ? { source: value.source } : {})
  };
}

export async function detectPassiveIdleState(thresholdMinutes = 20): Promise<PassiveIdleState> {
  const normalizedThreshold = Math.max(1, Math.round(thresholdMinutes));
  if (platform() !== 'win32') {
    return idleState({
      idle: false,
      thresholdMinutes: normalizedThreshold,
      source: 'unsupported',
      error: 'Passive idle detection is currently available only on Windows.'
    });
  }

  try {
    const { stdout } = await execFileAsync(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', windowsIdleScript],
      { timeout: 3000 }
    );
    const payload = parseIdlePayload(JSON.parse(stdout.trim()) as unknown);
    const idleMinutes = payload.idleMs === undefined ? undefined : Math.max(0, payload.idleMs / minuteMs);
    return idleState({
      idle: idleMinutes !== undefined && idleMinutes >= normalizedThreshold,
      thresholdMinutes: normalizedThreshold,
      source: payload.source ?? 'windows-last-input',
      ...(idleMinutes !== undefined ? { idleMinutes: Math.round(idleMinutes * 10) / 10 } : {}),
      ...(idleMinutes === undefined ? { error: 'Windows idle probe returned no idle duration.' } : {})
    });
  } catch (error) {
    return idleState({
      idle: false,
      thresholdMinutes: normalizedThreshold,
      source: 'windows-last-input',
      error: describeError(error)
    });
  }
}

function createNodeFolderWatcher(folder: string, listener: PassiveFolderWatchListener): Pick<FSWatcher, 'close'> {
  return watchFs(folder, { persistent: false }, (eventType, fileName) => {
    listener(eventType, fileName ?? undefined);
  });
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

function endpointMetadata(value: string | URL): Record<string, unknown> {
  try {
    const url = value instanceof URL ? value : new URL(value);
    const port = url.port || (url.protocol === 'https:' ? '443' : '80');
    return {
      url: url.toString(),
      origin: url.origin,
      protocol: url.protocol.replace(/:$/u, ''),
      host: url.hostname,
      port
    };
  } catch {
    return { url: String(value) };
  }
}

function ollamaModelNames(payload: unknown): string[] {
  if (!isRecord(payload) || !Array.isArray(payload.models)) return [];
  return payload.models
    .filter(isRecord)
    .map((model) => model.name ?? model.model)
    .filter((name): name is string => typeof name === 'string' && Boolean(name.trim()))
    .map((name) => name.trim());
}

function optionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function optionalStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => optionalString(item)).filter((item): item is string => Boolean(item))
    : [];
}

function compactRecord(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}

function normalizeWatchedDomain(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    const host = url.hostname.replace(/^www\./u, '');
    if (!host || host === 'localhost' || /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(host)) return null;
    return host;
  } catch {
    const host = trimmed
      .replace(/^https?:\/\//u, '')
      .split('/')[0]
      ?.replace(/^www\./u, '');
    if (!host || !/^[a-z0-9.-]+\.[a-z]{2,}$/iu.test(host)) return null;
    return host;
  }
}

function safeConfiguredDomains(settings: PassiveEngineSettings, budget = resourceBudget(settings)): string[] {
  return Array.from(new Set(settings.watchedDomains.map(normalizeWatchedDomain).filter((item): item is string => Boolean(item)))).slice(
    0,
    Math.max(budget.researchMonitorCreateLimit, budget.researchMonitorRunLimit)
  );
}

function normalizeWatchedAccount(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

function safeConfiguredAccounts(settings: PassiveEngineSettings): string[] {
  return Array.from(new Set(settings.watchedAccounts.map(normalizeWatchedAccount).filter((item): item is string => Boolean(item)))).slice(
    0,
    50
  );
}

function connectionMatchesWatchedAccount(connection: IntegrationConnection, watchedAccounts: string[]): boolean {
  if (!watchedAccounts.length) return true;
  const label = normalizeWatchedAccount(connection.accountLabel);
  const idValue = normalizeWatchedAccount(connection.id);
  const provider = normalizeWatchedAccount(connection.provider);
  const labelDomain = label?.includes('@') ? label.split('@').at(1) ?? '' : '';
  const keys = new Set(
    [label, idValue, provider && label ? `${provider}:${label}` : '', provider && idValue ? `${provider}:${idValue}` : ''].filter(Boolean)
  );

  return watchedAccounts.some((account) => {
    if (keys.has(account)) return true;
    if (label && account.startsWith('@') && label.endsWith(account)) return true;
    if (labelDomain && account === labelDomain) return true;
    return false;
  });
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
  if (run.status === 'cancelled') return null;
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

function passiveNotificationKey(notification: Pick<PassiveNotification, 'family' | 'level' | 'title' | 'body'>): string {
  return `${notification.family}:${notification.level}:${notification.title}:${notification.body}`;
}

function shouldStorePassiveNotification(store: MemoryStore, notification: PassiveNotification, date = new Date()): boolean {
  if (notification.level === 'urgent') return true;
  const cutoff = date.getTime() - passiveNotificationDedupeMs;
  const key = passiveNotificationKey(notification);
  return !store.passiveNotifications.some((existing) => passiveNotificationKey(existing) === key && parseTime(existing.createdAt) >= cutoff);
}

function notificationAllowedByStyle(notification: PassiveNotification, style: PassiveEngineSettings['notificationStyle']): boolean {
  if (style === 'off') return false;
  if (style === 'urgent_only') return notification.level === 'urgent';
  return true;
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
    cardTriage: {},
    updatedAt: nowIso(date)
  });
}

function defaultPassiveWorkerState(store: MemoryStore, date = new Date()): PassiveWorkerState {
  const settings = store.passiveSettings ?? defaultPassiveSettings(date);
  return passiveWorkerStateSchema.parse({
    id: 'passive-worker',
    enabled: settings.enabled,
    running: false,
    intervalMs: 0,
    activeFileWatchCount: 0,
    pendingFileEvent: false,
    updatedAt: nowIso(date)
  });
}

function setPassiveWorkerState(store: MemoryStore, patch: Partial<PassiveWorkerState>, date = new Date()): PassiveWorkerState {
  const existing = store.passiveWorker ?? defaultPassiveWorkerState(store, date);
  const settings = store.passiveSettings ?? defaultPassiveSettings(date);
  const next = passiveWorkerStateSchema.parse({
    ...existing,
    ...patch,
    enabled: patch.enabled ?? settings.enabled,
    updatedAt: nowIso(date)
  });
  store.passiveWorker = next;
  return next;
}

function passiveWorkerSnapshot(store: MemoryStore, date = new Date()): PassiveWorkerState {
  return passiveWorkerStateSchema.parse({
    ...defaultPassiveWorkerState(store, date),
    ...(store.passiveWorker ?? {}),
    enabled: store.passiveSettings?.enabled ?? store.passiveWorker?.enabled ?? true,
    updatedAt: store.passiveWorker?.updatedAt ?? nowIso(date)
  });
}

function defaultTrigger(definition: DefaultTaskDefinition, date: Date): PassiveTrigger {
  const triggerKind = definition.triggerKind ?? (definition.idleOnly ? 'idle' : 'schedule');
  const nextRunAt = triggerKind === 'event' ? undefined : addMinutes(date, definition.offsetMinutes ?? 0);
  return passiveTriggerSchema.parse({
    id: defaultTriggerId(definition),
    kind: triggerKind,
    label: definition.triggerLabel ?? (definition.idleOnly ? 'Idle window' : 'Scheduled check'),
    watcherId: definition.watcherId,
    taskIds: [definition.taskId],
    enabled: true,
    ...(definition.intervalMinutes ? { intervalMinutes: definition.intervalMinutes } : {}),
    ...(definition.eventName ? { eventName: definition.eventName } : {}),
    ...(definition.idleOnly ? { idleMinutes: 20 } : {}),
    ...(nextRunAt ? { nextRunAt } : {}),
    createdAt: nowIso(date),
    updatedAt: nowIso(date),
    metadata: {
      ...(definition.eventNames?.length ? { eventNames: definition.eventNames } : {}),
      family: definition.family,
      priority: definition.priority
    }
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
      ...(nextRunAt ? { nextRunAt } : {}),
      ...(definition.eventNames?.length ? { metadata: { eventNames: definition.eventNames } } : {})
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

function sameStringList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function syncPassiveTriggersFromTasks(store: MemoryStore, date = new Date()): boolean {
  let changed = false;
  const existingIds = new Set(store.passiveTriggers.map((trigger) => trigger.id));
  for (const task of store.passiveTasks) {
    if (existingIds.has(task.trigger.id)) continue;
    store.passiveTriggers.push(
      passiveTriggerSchema.parse({
        ...task.trigger,
        watcherId: task.watcherId,
        taskIds: [task.id],
        enabled: watcherEnabled(store, task) && !['paused', 'cancelled'].includes(task.status),
        createdAt: task.createdAt,
        updatedAt: nowIso(date)
      })
    );
    existingIds.add(task.trigger.id);
    changed = true;
  }

  store.passiveTriggers = store.passiveTriggers.map((trigger) => {
    const tasks = store.passiveTasks.filter((task) => task.trigger.id === trigger.id);
    if (!tasks.length) return passiveTriggerSchema.parse(trigger);
    const primary = tasks[0]!;
    const taskTrigger = primary.trigger;
    const taskIds = tasks.map((task) => task.id).sort();
    const nextRunCandidates = tasks
      .map((task) => task.nextRunAt ?? task.trigger.nextRunAt)
      .filter((value): value is string => Boolean(value))
      .sort((a, b) => parseTime(a) - parseTime(b));
    const nextRunAt = nextRunCandidates[0];
    const enabled = tasks.some((task) => watcherEnabled(store, task) && !['paused', 'cancelled'].includes(task.status));
    const metadata = {
      ...trigger.metadata,
      ...taskTrigger.metadata,
      taskCount: taskIds.length
    };
    const same =
      trigger.kind === taskTrigger.kind &&
      trigger.label === taskTrigger.label &&
      trigger.watcherId === primary.watcherId &&
      sameStringList(trigger.taskIds, taskIds) &&
      trigger.enabled === enabled &&
      trigger.intervalMinutes === taskTrigger.intervalMinutes &&
      trigger.eventName === taskTrigger.eventName &&
      trigger.idleMinutes === taskTrigger.idleMinutes &&
      trigger.nextRunAt === nextRunAt &&
      JSON.stringify(trigger.metadata) === JSON.stringify(metadata);
    if (same) return passiveTriggerSchema.parse(trigger);
    changed = true;
    return passiveTriggerSchema.parse({
      ...trigger,
      kind: taskTrigger.kind,
      label: taskTrigger.label,
      watcherId: primary.watcherId,
      taskIds,
      enabled,
      intervalMinutes: taskTrigger.intervalMinutes,
      eventName: taskTrigger.eventName,
      idleMinutes: taskTrigger.idleMinutes,
      nextRunAt,
      metadata,
      updatedAt: nowIso(date)
    });
  });
  return changed;
}

function syncPassiveResultsFromRuns(store: MemoryStore): boolean {
  let changed = false;
  const resultsById = new Map<string, PassiveResult>();
  for (const result of store.passiveResults) {
    const parsed = passiveResultSchema.safeParse(result);
    if (parsed.success) resultsById.set(parsed.data.id, parsed.data);
  }
  for (const run of store.passiveRuns) {
    for (const result of run.cards) {
      if (!resultsById.has(result.id)) {
        resultsById.set(result.id, passiveResultSchema.parse(result));
        changed = true;
      }
    }
  }
  const nextResults = Array.from(resultsById.values())
    .sort((a, b) => parseTime(b.createdAt) - parseTime(a.createdAt) || a.title.localeCompare(b.title))
    .slice(0, 500);
  if (nextResults.length !== store.passiveResults.length) changed = true;
  store.passiveResults = nextResults;
  return changed;
}

export function ensurePassiveDefaults(store: MemoryStore, date = new Date()): void {
  let changed = false;
  if (!store.passiveSettings) {
    store.passiveSettings = defaultPassiveSettings(date);
    changed = true;
  }

  const watcherIds = new Set(store.passiveWatchers.map((watcher) => watcher.id));
  const triggerIds = new Set(store.passiveTriggers.map((trigger) => trigger.id));
  const taskIds = new Set(store.passiveTasks.map((task) => task.id));
  for (const definition of defaultTaskDefinitions) {
    if (!watcherIds.has(definition.watcherId)) {
      store.passiveWatchers.push(defaultWatcher(definition, date));
      changed = true;
    }
    if (!triggerIds.has(defaultTriggerId(definition))) {
      store.passiveTriggers.push(defaultTrigger(definition, date));
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
  if (syncPassiveTriggersFromTasks(store, date)) changed = true;
  store.passiveTriggers = store.passiveTriggers.map((trigger) => passiveTriggerSchema.parse(trigger));
  store.passiveTasks = store.passiveTasks.map((task) => passiveTaskSchema.parse(task));
  store.passiveRuns = store.passiveRuns.map((run) => passiveRunSchema.parse(run));
  store.passiveResults = store.passiveResults.map((result) => passiveResultSchema.parse(result));
  if (syncPassiveResultsFromRuns(store)) changed = true;
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

function retryDelayMinutesFor(task: PassiveTask, attempts: number): number {
  const normalizedAttempts = Math.max(1, attempts);
  return task.retry.backoffMinutes * 2 ** Math.min(4, normalizedAttempts - 1);
}

function retryScheduleFor(task: PassiveTask, attempts: number, date: Date): { exhausted: boolean; nextRetryAt?: string } {
  const exhausted = attempts >= task.retry.maxAttempts;
  return {
    exhausted,
    ...(exhausted ? {} : { nextRetryAt: addMinutes(date, retryDelayMinutesFor(task, attempts)) })
  };
}

function nextRunAfterResult(task: PassiveTask, status: PassiveRunStatus, date: Date): string | undefined {
  if (status === 'cancelled') return undefined;
  if (status === 'failed' || status === 'blocked') {
    return retryScheduleFor(task, task.retry.attempts + 1, date).nextRetryAt;
  }
  return computeNextRunAt(task, date);
}

function errorLogMessage(run: PassiveRun): string {
  return (
    run.error ??
    run.cards.find((item) => item.urgency >= 72)?.summary ??
    run.cards[0]?.summary ??
    `${familyLabels[run.family]} ${run.status}`
  );
}

function appendTaskErrorLog(task: PassiveTask, run: PassiveRun, nextRetryAt: string | undefined, date: Date): PassiveTask['errorLog'] {
  const entry = passiveTaskErrorLogEntrySchema.parse({
    id: id('passive-task-error'),
    runId: run.id,
    status: run.status,
    message: errorLogMessage(run),
    at: run.finishedAt ?? nowIso(date),
    attempt: run.attempt,
    ...(nextRetryAt ? { nextRetryAt } : {})
  });
  return [entry, ...(task.errorLog ?? [])].slice(0, maxTaskErrorLogEntries);
}

export function applyRunOutcomeToTask(task: PassiveTask, run: PassiveRun, date = new Date()): PassiveTask {
  if (run.status === 'cancelled') {
    return passiveTaskSchema.parse({
      ...task,
      status: 'cancelled',
      lastRunAt: run.finishedAt ?? nowIso(date),
      nextRunAt: undefined,
      lastError: run.error,
      retry: {
        ...task.retry,
        attempts: 0,
        nextRetryAt: undefined
      },
      trigger: { ...task.trigger, nextRunAt: undefined },
      updatedAt: nowIso(date)
    });
  }

  if (run.status === 'failed' || run.status === 'blocked') {
    const attempts = task.retry.attempts + 1;
    const retry = retryScheduleFor(task, attempts, date);
    return passiveTaskSchema.parse({
      ...task,
      status: retry.exhausted ? 'blocked' : 'failed',
      lastRunAt: run.finishedAt ?? nowIso(date),
      nextRunAt: retry.nextRetryAt,
      lastError: run.error ?? 'Task failed.',
      errorLog: appendTaskErrorLog(task, run, retry.nextRetryAt, date),
      retry: {
        ...task.retry,
        attempts,
        nextRetryAt: retry.nextRetryAt
      },
      trigger: { ...task.trigger, nextRunAt: retry.nextRetryAt },
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
  const mode = currentPassiveMachineMode(store);
  if (!store.passiveSettings?.enabled) return [];
  if (store.passiveSettings.idleOnly && !input.idle && !eventName) return [];
  return store.passiveTasks
    .filter((task) => ['active', 'failed'].includes(task.status))
    .filter((task) => watcherEnabled(store, task))
    .filter((task) => !task.idleOnly || Boolean(input.idle))
    .filter((task) => (eventName ? taskMatchesEvent(task, eventName) : task.trigger.kind !== 'event'))
    .map((task) => ({ task, policy: passiveModePolicy(task, mode) }))
    .filter((item) => item.policy.allowed)
    .filter((task) => {
      const retryAt = parseTime(task.task.retry.nextRetryAt);
      if (Number.isFinite(retryAt) && retryAt > nowMs) return false;
      if (eventName) return true;
      const nextRun = parseTime(task.task.nextRunAt ?? task.task.trigger.nextRunAt);
      return !Number.isFinite(nextRun) || nextRun <= nowMs;
    })
    .sort(
      (a, b) =>
        b.task.priority + b.policy.priorityDelta - (a.task.priority + a.policy.priorityDelta) ||
        a.task.title.localeCompare(b.task.title)
    )
    .map((item) => item.task);
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

type AiOsMachineProfileRead =
  | { profile: Record<string, unknown>; source: string; error?: undefined }
  | { profile?: undefined; source: string; error: string };

function extractAiOsMachineProfile(payload: unknown): Record<string, unknown> | undefined {
  if (!isRecord(payload)) return undefined;
  if (isRecord(payload.machine_profile)) return payload.machine_profile;
  if (isRecord(payload.profile)) return payload.profile;
  return undefined;
}

async function readAiOsMachineProfile(status: unknown, fetchImpl: FetchLike): Promise<AiOsMachineProfileRead> {
  const statusProfile = extractAiOsMachineProfile(status);
  if (statusProfile) return { profile: statusProfile, source: 'status.machine_profile' };

  try {
    const payload = await fetchJsonWithTimeout(fetchImpl, new URL('/api/ai/machine-profile', env.aiOsApiUrl), 'AI OS machine profile');
    const profile = extractAiOsMachineProfile(payload);
    if (profile) return { profile, source: 'machine-profile.endpoint' };
    return { source: 'machine-profile.endpoint', error: 'AI OS machine profile endpoint returned no profile payload.' };
  } catch (error) {
    return { source: 'machine-profile.endpoint', error: describeError(error) };
  }
}

function summarizeAiOsMachineProfile(profile: Record<string, unknown>, source: string): Record<string, unknown> {
  const autotune = isRecord(profile.autotune) ? profile.autotune : {};
  const benchmarks = isRecord(profile.benchmarks) ? profile.benchmarks : {};
  const pressure = isRecord(autotune.resource_pressure) ? autotune.resource_pressure : {};
  const bestRoute = isRecord(autotune.best_text_route)
    ? autotune.best_text_route
    : isRecord(benchmarks.best_text_route)
      ? benchmarks.best_text_route
      : undefined;
  const health = isRecord(profile.ai_os_health) ? profile.ai_os_health : {};
  const providerSummary = isRecord(profile.provider_summary) ? profile.provider_summary : {};
  const capabilityReadiness = isRecord(profile.capability_readiness) ? profile.capability_readiness : {};
  const routeProvider = optionalString(bestRoute?.provider);
  const routeModel = optionalString(bestRoute?.model);
  const routeLabel = routeProvider && routeModel ? `${routeProvider}/${routeModel}` : routeProvider ?? routeModel;

  return compactRecord({
    checked: true,
    available: true,
    source,
    mode: optionalString(profile.mode),
    createdAt: optionalString(profile.created_at),
    providerSummary,
    capabilityReadiness,
    aiOsIntegrityOk: typeof health.integrity_ok === 'boolean' ? health.integrity_ok : undefined,
    jobsCount: optionalNumber(health.jobs_count),
    backgroundUnits: optionalNumber(health.background_units),
    backgroundEnabled: optionalNumber(health.background_enabled),
    textBenchmarkSamples: optionalNumber(benchmarks.text_samples),
    autotuneConfidence: optionalString(autotune.confidence),
    suggestedMaxJobConcurrency: optionalNumber(autotune.suggested_max_job_concurrency),
    routingNotes: optionalStringArray(autotune.routing_notes),
    resourcePressure: compactRecord({
      level: optionalString(pressure.level),
      drivers: optionalStringArray(pressure.drivers),
      cpuPercent: optionalNumber(pressure.cpu_percent),
      memoryPercent: optionalNumber(pressure.memory_percent),
      gpuUtilizationPercent: optionalNumber(pressure.gpu_utilization_percent),
      vramPercent: optionalNumber(pressure.vram_percent)
    }),
    bestTextRoute: bestRoute
      ? compactRecord({
          provider: routeProvider,
          model: routeModel,
          label: routeLabel,
          tokensPerSecond: optionalNumber(bestRoute.tokens_per_second),
          latencyMs: optionalNumber(bestRoute.latency_ms),
          measuredAt: optionalString(bestRoute.measured_at),
          local: typeof bestRoute.local === 'boolean' ? bestRoute.local : undefined,
          paid: typeof bestRoute.paid === 'boolean' ? bestRoute.paid : undefined
        })
      : undefined
  });
}

function buildAiOsMachineProfileCards(
  task: PassiveTask,
  runId: string,
  endpoints: Record<string, unknown>,
  summary: Record<string, unknown>
): PassiveResultCard[] {
  const pressure = isRecord(summary.resourcePressure) ? summary.resourcePressure : {};
  const level = optionalString(pressure.level);
  const drivers = optionalStringArray(pressure.drivers);
  const cards: PassiveResultCard[] = [];
  const sourceRef = stableSourceRef('service', 'AI OS machine profile', {
    id: 'ai-os-machine-profile',
    route: routeMap.aiOs,
    url: env.aiOsApiUrl,
    metadata: { ...endpoints, machineProfile: summary }
  });

  if (summary.aiOsIntegrityOk === false) {
    cards.push(
      serviceIssueCard(
        task,
        runId,
        'AI OS data integrity check failed',
        'AI OS machine profile reports that its storage integrity check is not currently passing.',
        90,
        sourceRef
      )
    );
  }

  if (level === 'high') {
    const concurrency = optionalNumber(summary.suggestedMaxJobConcurrency);
    const route = isRecord(summary.bestTextRoute) ? optionalString(summary.bestTextRoute.label) : undefined;
    const tokensPerSecond = isRecord(summary.bestTextRoute) ? optionalNumber(summary.bestTextRoute.tokensPerSecond) : undefined;
    cards.push(
      serviceIssueCard(
        task,
        runId,
        'AI OS resource pressure is high',
        [
          `AI OS reports high resource pressure${drivers.length ? ` from ${drivers.join(', ')}` : ''}.`,
          concurrency !== undefined ? `Suggested max job concurrency is ${concurrency}.` : '',
          route ? `Best measured text route is ${route}${tokensPerSecond !== undefined ? ` at ${tokensPerSecond} tokens/sec` : ''}.` : ''
        ]
          .filter(Boolean)
          .join(' '),
        78,
        sourceRef
      )
    );
  }

  return cards;
}

function latestAiOsMachineProfileSummary(
  store: MemoryStore,
  date = new Date()
): { profile: Record<string, unknown>; run: PassiveRun; ageMs: number } | undefined {
  const nowMs = date.getTime();
  for (const run of store.passiveRuns) {
    const profile = isRecord(run.metadata.aiOsMachineProfile) ? run.metadata.aiOsMachineProfile : undefined;
    if (!profile || profile.available !== true) continue;
    const finishedAt = parseTime(run.finishedAt ?? run.startedAt);
    if (!Number.isFinite(finishedAt)) continue;
    const ageMs = Math.max(0, nowMs - finishedAt);
    if (ageMs > passiveMachineProfileFreshMs) continue;
    return { profile, run, ageMs };
  }
  return undefined;
}

function passiveResourceDecision(store: MemoryStore, date = new Date()): PassiveResourceDecision {
  const mode = currentPassiveMachineMode(store);
  const latest = latestAiOsMachineProfileSummary(store, date);
  if (!latest) {
    return {
      checked: true,
      source: 'none',
      mode,
      profileFresh: false,
      heavyAiAllowed: mode !== 'offline',
      summaryAllowed: mode !== 'offline',
      benchmarkAllowed: mode !== 'offline',
      resourcePressureDrivers: [],
      ...(mode === 'offline' ? { skipReason: 'Offline Mode avoids AI OS model calls.' } : {})
    };
  }

  const pressure = isRecord(latest.profile.resourcePressure) ? latest.profile.resourcePressure : {};
  const route = isRecord(latest.profile.bestTextRoute) ? latest.profile.bestTextRoute : undefined;
  const provider = optionalString(route?.provider);
  const model = optionalString(route?.model);
  const label = optionalString(route?.label) ?? (provider && model ? `${provider}/${model}` : provider ?? model);
  const level = optionalString(pressure.level);
  const drivers = optionalStringArray(pressure.drivers);
  const highPressure = level === 'high';
  const offline = mode === 'offline';
  const heavyAiAllowed = !highPressure && !offline;
  const suggestedMaxJobConcurrency = optionalNumber(latest.profile.suggestedMaxJobConcurrency);
  const preferredLocalRoute =
    mode === 'beast' && route?.local === true && provider
      ? compactRecord({
          provider,
          model,
          label,
          tokensPerSecond: optionalNumber(route.tokensPerSecond),
          latencyMs: optionalNumber(route.latencyMs),
          measuredAt: optionalString(route.measuredAt)
        })
      : undefined;

  const decision: PassiveResourceDecision = {
    checked: true,
    source: 'app-health-run',
    mode,
    profileFresh: true,
    heavyAiAllowed,
    summaryAllowed: heavyAiAllowed,
    benchmarkAllowed: heavyAiAllowed,
    resourcePressureDrivers: drivers,
    profileRunId: latest.run.id,
    profileAgeMinutes: Math.round((latest.ageMs / minuteMs) * 10) / 10
  };
  if (level) decision.resourcePressureLevel = level;
  if (suggestedMaxJobConcurrency !== undefined) decision.suggestedMaxJobConcurrency = suggestedMaxJobConcurrency;
  if (highPressure) {
    decision.skipReason = `AI OS machine profile reports high resource pressure${drivers.length ? ` from ${drivers.join(', ')}` : ''}.`;
  } else if (offline) {
    decision.skipReason = 'Offline Mode avoids AI OS model calls.';
  }
  if (latest.run.finishedAt) decision.profileFinishedAt = latest.run.finishedAt;
  if (preferredLocalRoute) decision.preferredLocalRoute = preferredLocalRoute;
  return decision;
}

async function runAppHealth(store: MemoryStore, task: PassiveTask, runId: string, fetchImpl: FetchLike): Promise<FamilyRunResult> {
  const cards: PassiveResultCard[] = [];
  const settings = store.passiveSettings ?? defaultPassiveSettings();
  const watchedAccounts = safeConfiguredAccounts(settings);
  const dataDir = resolve(env.dataDir);
  const endpoints = {
    hub: endpointMetadata(env.hubPublicUrl),
    miniHubApi: endpointMetadata(`http://127.0.0.1:${env.port}`),
    aiOs: endpointMetadata(env.aiOsApiUrl),
    macroLab: endpointMetadata(env.macroLabApiUrl),
    ollama: endpointMetadata(env.ollamaBaseUrl)
  };
  let ollamaModels: string[] = [];
  let aiOsMachineProfile: Record<string, unknown> = { checked: false, available: false, reason: 'not checked yet' };
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

  const disconnectedConnections = Array.from(store.integrationConnections.values()).filter((connection) =>
    ['needs_reauth', 'revoked', 'error'].includes(connection.status)
  );
  const disconnected = disconnectedConnections.filter((connection) => connectionMatchesWatchedAccount(connection, watchedAccounts));
  const ignoredDisconnected = disconnectedConnections.length - disconnected.length;
  if (disconnected.length) {
    cards.push(
      card({
        id: id('passive-card'),
        taskId: task.id,
        runId,
        family: task.family,
        title: `${disconnected.length} integration connection${disconnected.length === 1 ? '' : 's'} need attention`,
        summary: disconnected.map((connection) => `${connection.provider} ${connection.accountLabel}: ${connection.status}`).join('; '),
        urgency: 78,
        confidence: 0.95,
        route: routeMap.productivity,
        sourceRefs: disconnected.slice(0, 5).map((connection) =>
          stableSourceRef('record', connection.accountLabel, {
            id: connection.id,
            route: routeMap.productivity,
            metadata: {
              provider: connection.provider,
              status: connection.status,
              accountLabel: connection.accountLabel,
              watchedAccountScoped: watchedAccounts.length > 0
            }
          })
        ),
        suggestedAction: 'Reconnect provider',
        actionKind: 'inspect',
        why: watchedAccounts.length
          ? 'A watched integration account is not connected.'
          : 'An existing integration connection is not connected.'
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
          stableSourceRef('service', 'AI OS jobs', {
            id: 'ai-os-jobs',
            route: routeMap.aiOs,
            metadata: endpoints.aiOs
          })
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
          stableSourceRef('service', 'AI OS backups', {
            id: 'ai-os-backups',
            route: routeMap.aiOs,
            metadata: endpoints.aiOs
          })
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
          stableSourceRef('service', 'AI OS backups', {
            id: String(latestBackup.id ?? 'latest'),
            route: routeMap.aiOs,
            metadata: endpoints.aiOs
          })
        )
      );
    }

    const profileRead = await readAiOsMachineProfile(status, fetchImpl);
    if (profileRead.profile) {
      aiOsMachineProfile = summarizeAiOsMachineProfile(profileRead.profile, profileRead.source);
      cards.push(...buildAiOsMachineProfileCards(task, runId, endpoints.aiOs, aiOsMachineProfile));
    } else {
      aiOsMachineProfile = {
        checked: true,
        available: false,
        source: profileRead.source,
        error: profileRead.error
      };
    }
  } catch (error) {
    aiOsMachineProfile = {
      checked: false,
      available: false,
      reason: 'ai-os-status-unavailable',
      error: describeError(error)
    };
    cards.push(
      serviceIssueCard(
        task,
        runId,
        'AI OS is unavailable',
        describeError(error),
        82,
        stableSourceRef('service', 'AI OS API', {
          id: 'ai-os-api',
          route: routeMap.aiOs,
          url: env.aiOsApiUrl,
          metadata: endpoints.aiOs
        })
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
          stableSourceRef('service', 'Macro Lab', {
            id: 'macro-lab',
            route: routeMap.macroLab,
            metadata: endpoints.macroLab
          })
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
        stableSourceRef('service', 'Macro Lab API', {
          id: 'macro-lab-api',
          route: routeMap.macroLab,
          url: env.macroLabApiUrl,
          metadata: endpoints.macroLab
        })
      )
    );
  }

  try {
    const tags = await fetchJsonWithTimeout(fetchImpl, new URL('/api/tags', env.ollamaBaseUrl), 'Ollama', {}, 1600);
    ollamaModels = ollamaModelNames(tags);
    if (!ollamaModels.length) {
      cards.push(
        serviceIssueCard(
          task,
          runId,
          'Ollama has no local models installed',
          'Ollama responded, but /api/tags did not list any model names.',
          78,
          stableSourceRef('service', 'Ollama models', {
            id: 'ollama-models',
            route: routeMap.aiOs,
            url: env.ollamaBaseUrl,
            metadata: { ...endpoints.ollama, configuredModel: env.ollamaChatModel, modelCount: 0 }
          })
        )
      );
    } else if (!ollamaModels.includes(env.ollamaChatModel)) {
      cards.push(
        serviceIssueCard(
          task,
          runId,
          'Configured Ollama model is not installed',
          `${env.ollamaChatModel} is configured, but Ollama reported: ${ollamaModels.slice(0, 5).join(', ')}.`,
          72,
          stableSourceRef('service', 'Ollama models', {
            id: 'ollama-models',
            route: routeMap.aiOs,
            url: env.ollamaBaseUrl,
            metadata: {
              ...endpoints.ollama,
              configuredModel: env.ollamaChatModel,
              modelCount: ollamaModels.length,
              models: ollamaModels.slice(0, 12)
            }
          })
        )
      );
    }
  } catch (error) {
    cards.push(
      serviceIssueCard(
        task,
        runId,
        'Ollama model server is unavailable',
        describeError(error),
        62,
        stableSourceRef('service', 'Ollama', {
          id: 'ollama',
          route: routeMap.aiOs,
          url: env.ollamaBaseUrl,
          metadata: { ...endpoints.ollama, configuredModel: env.ollamaChatModel }
        })
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
        sourceRefs: [
          stableSourceRef('service', 'Mini Hub API', {
            id: 'mini-hub-api',
            route: routeMap.settings,
            metadata: endpoints.miniHubApi
          }),
          stableSourceRef('service', 'Ollama models', {
            id: 'ollama-models',
            route: routeMap.aiOs,
            url: env.ollamaBaseUrl,
            metadata: {
              ...endpoints.ollama,
              configuredModel: env.ollamaChatModel,
              modelCount: ollamaModels.length,
              models: ollamaModels.slice(0, 12)
            }
          })
        ],
        suggestedAction: 'No action',
        actionKind: 'inspect',
        why: 'A scheduled service health run completed without high-urgency findings.'
      })
    );
  }

  return {
    status: cards.some((item) => item.urgency >= 85) ? 'blocked' : 'succeeded',
    cards,
    metadata: {
      serviceEndpoints: endpoints,
      watchedAccounts,
      totalIntegrationConnectionIssues: disconnectedConnections.length,
      integrationConnectionIssues: disconnected.length,
      ignoredIntegrationConnectionIssues: ignoredDisconnected,
      aiOsMachineProfile,
      configuredOllamaModel: env.ollamaChatModel,
      ollamaModels: ollamaModels.slice(0, 24),
      ollamaModelCount: ollamaModels.length
    }
  };
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
    syncEvents: store.syncEvents,
    actionEvents: store.actionEvents.map(redactActionLedgerEvent),
    passiveSettings: store.passiveSettings,
    passiveWatchers: store.passiveWatchers,
    passiveTriggers: store.passiveTriggers,
    passiveTasks: store.passiveTasks,
    passiveRuns: store.passiveRuns,
    passiveResults: store.passiveResults,
    passiveNotifications: store.passiveNotifications
  };
}

function snapshotCount(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function snapshotSummary(snapshot: Record<string, unknown>): Record<string, number> {
  return {
    workspaces: snapshotCount(snapshot.workspaces),
    members: snapshotCount(snapshot.members),
    jobs: snapshotCount(snapshot.jobs),
    studySessions: snapshotCount(snapshot.studySessions),
    careerActions: snapshotCount(snapshot.careerActions),
    gameRuns: snapshotCount(snapshot.gameRuns),
    gameStates: snapshotCount(snapshot.gameStates),
    achievements: snapshotCount(snapshot.achievements),
    notes: snapshotCount(snapshot.notes),
    integrationConnections: snapshotCount(snapshot.integrationConnections),
    syncEvents: Array.isArray(snapshot.syncEvents)
      ? snapshotCount(snapshot.syncEvents)
      : typeof snapshot.syncEventCount === 'number'
        ? snapshot.syncEventCount
        : 0,
    actionEvents: Array.isArray(snapshot.actionEvents)
      ? snapshotCount(snapshot.actionEvents)
      : typeof snapshot.actionEventCount === 'number'
        ? snapshot.actionEventCount
        : 0,
    passiveWatchers: snapshotCount(snapshot.passiveWatchers),
    passiveTriggers: snapshotCount(snapshot.passiveTriggers),
    passiveTasks: snapshotCount(snapshot.passiveTasks),
    passiveRuns: snapshotCount(snapshot.passiveRuns),
    passiveResults: snapshotCount(snapshot.passiveResults),
    passiveNotifications: snapshotCount(snapshot.passiveNotifications)
  };
}

function countRedactedTokenSets(snapshot: Record<string, unknown>): number {
  const connections = Array.isArray(snapshot.integrationConnections) ? snapshot.integrationConnections : [];
  return connections.filter((connection) => isRecord(connection) && connection.encryptedTokenSet === '[encrypted-redacted]').length;
}

function verifyMiniHubSnapshotFile(snapshotPath: string): SnapshotVerification {
  try {
    const text = readFileSync(snapshotPath, 'utf8');
    const parsed = JSON.parse(text) as unknown;
    if (!isRecord(parsed)) throw new Error('Snapshot root is not an object.');
    if (
      !Array.isArray(parsed.workspaces) ||
      !Array.isArray(parsed.integrationConnections) ||
      !Array.isArray(parsed.syncEvents) ||
      !Array.isArray(parsed.actionEvents) ||
      !Array.isArray(parsed.passiveTasks) ||
      !Array.isArray(parsed.passiveResults)
    ) {
      throw new Error('Snapshot is missing required Mini Hub collections.');
    }
    const leakedToken = parsed.integrationConnections.some(
      (connection) =>
        isRecord(connection) &&
        typeof connection.encryptedTokenSet === 'string' &&
        connection.encryptedTokenSet !== '' &&
        connection.encryptedTokenSet !== '[encrypted-redacted]'
    );
    if (leakedToken) throw new Error('Snapshot verification found an unredacted token payload.');
    return {
      ok: true,
      bytes: Buffer.byteLength(text, 'utf8'),
      sha256: createHash('sha256').update(text).digest('hex'),
      summary: snapshotSummary(parsed),
      redactedTokenSets: countRedactedTokenSets(parsed)
    };
  } catch (error) {
    return {
      ok: false,
      bytes: existsSync(snapshotPath) ? statSync(snapshotPath).size : 0,
      sha256: '',
      summary: {},
      redactedTokenSets: 0,
      error: describeError(error)
    };
  }
}

function formatBytes(value: number): string {
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
}

function cleanupCandidate(path: string, kind: CleanupCandidate['kind'], reason: string): CleanupCandidate | null {
  try {
    const stat = statSync(path);
    if (!stat.isFile()) return null;
    return { path, kind, size: stat.size, mtimeMs: stat.mtimeMs, reason };
  } catch {
    return null;
  }
}

function planMiniHubCleanup(date = new Date()): CleanupCandidate[] {
  const candidates: CleanupCandidate[] = [];
  const dataDir = resolve(env.dataDir);
  const snapshotRoot = join(dataDir, passiveSnapshotDirName);
  const snapshotRetentionCount = 14;
  const oldSnapshotCutoff = date.getTime() - 45 * dayMs;
  const oldLogCutoff = date.getTime() - 21 * dayMs;

  if (existsSync(snapshotRoot)) {
    try {
      const snapshots = readdirSync(snapshotRoot, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map((entry) => join(snapshotRoot, entry.name))
        .map((path) => cleanupCandidate(path, 'snapshot', 'stale Mini Hub restore snapshot'))
        .filter((item): item is CleanupCandidate => Boolean(item))
        .sort((a, b) => b.mtimeMs - a.mtimeMs);
      for (const [index, snapshot] of snapshots.entries()) {
        if (index >= snapshotRetentionCount || snapshot.mtimeMs < oldSnapshotCutoff) candidates.push(snapshot);
      }
    } catch {
      // A cleanup dry-run should not fail the idle compute task just because a folder changed mid-scan.
    }
  }

  if (existsSync(dataDir)) {
    try {
      for (const entry of readdirSync(dataDir, { withFileTypes: true }).slice(0, 200)) {
        if (!entry.isFile()) continue;
        const fullPath = join(dataDir, entry.name);
        const extension = extname(entry.name).toLowerCase();
        if (!['.log', '.tmp'].includes(extension)) continue;
        const candidate = cleanupCandidate(fullPath, extension === '.log' ? 'log' : 'temp', `old ${extension.slice(1)} file in Mini Hub data dir`);
        if (candidate && candidate.mtimeMs < oldLogCutoff) candidates.push(candidate);
      }
    } catch {
      // Keep cleanup planning best-effort and non-blocking.
    }
  }

  return candidates.sort((a, b) => b.size - a.size).slice(0, 40);
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

function passiveDigestSummaryText(cards: PassiveResultCard[], maxLength: number): string {
  const lines: string[] = [
    'Summarize these Mini Hub passive-task findings. Use only the listed source-backed facts. Return a concise synthesis with next actions and uncertainty.'
  ];
  for (const [index, item] of cards.entries()) {
    const sources = item.sourceRefs
      .slice(0, 4)
      .map((ref) => `${ref.kind}:${ref.label}${ref.filePath ? ` (${ref.filePath})` : ref.route ? ` (${ref.route})` : ''}`)
      .join('; ');
    lines.push(
      [
        `${index + 1}. ${familyLabels[item.family]} | urgency ${Math.round(item.urgency)} | confidence ${Math.round(item.confidence * 100)}%`,
        `Title: ${item.title}`,
        `Summary: ${item.summary}`,
        `Why: ${item.why}`,
        `Suggested action: ${item.suggestedAction}`,
        sources ? `Sources: ${sources}` : ''
      ]
        .filter(Boolean)
        .join('\n')
    );
    if (lines.join('\n\n').length >= maxLength) break;
  }
  return truncateText(lines.join('\n\n'), maxLength);
}

async function queueIdleDigestSummary(
  store: MemoryStore,
  task: PassiveTask,
  runId: string,
  fetchImpl: FetchLike,
  budget: PassiveResourceBudget,
  resourceDecision: PassiveResourceDecision
): Promise<{ cards: PassiveResultCard[]; changed: string[]; metadata: Record<string, unknown> }> {
  const settings = store.passiveSettings ?? defaultPassiveSettings();
  const digestCards = buildPassiveDigest(store, budget.idleSummaryCards);
  if (!digestCards.length) {
    return {
      cards: [],
      changed: [],
      metadata: {
        queued: false,
        reason: 'no-passive-digest-cards',
        cardCount: 0
      }
    };
  }

  const summaryText = passiveDigestSummaryText(digestCards, budget.idleSummaryChars);
  const machineMode = currentPassiveMachineMode(store);
  const allowCloud = settings.localAiPreference === 'cloud_allowed';
  const preferredRoute = isRecord(resourceDecision.preferredLocalRoute) ? resourceDecision.preferredLocalRoute : undefined;
  const preferredProvider = optionalString(preferredRoute?.provider);
  const preferredModel = optionalString(preferredRoute?.model);
  const suggestedConcurrency = optionalNumber(resourceDecision.suggestedMaxJobConcurrency);
  const boundedConcurrency = suggestedConcurrency === undefined ? undefined : Math.max(1, Math.min(4, Math.floor(suggestedConcurrency)));
  const payload = await fetchJsonWithTimeout(
    fetchImpl,
    new URL('/api/ai/jobs', env.aiOsApiUrl),
    'AI OS idle digest summary job',
    {
      method: 'POST',
      body: JSON.stringify({
        primitive: 'chunk_summarize',
        text: summaryText,
        chunk_size: 2200,
        request: {
          task_type: 'summarize',
          prompt: 'Summarize Mini Hub passive-task findings into a concise source-backed digest.',
          temperature: 0.2,
          max_tokens: 512,
          local_first: true,
          allow_fallback: allowCloud,
          cost_ceiling_usd: allowCloud ? 0.05 : 0,
          ...(preferredProvider ? { provider: preferredProvider } : {}),
          ...(preferredModel ? { model: preferredModel } : {}),
          metadata: {
            source: 'passive-task',
            task_id: task.id,
            passive_run_id: runId,
            machine_mode: machineMode,
            local_ai_preference: settings.localAiPreference,
            resource_decision: resourceDecision
          }
        },
        ...(boundedConcurrency ? { concurrency: boundedConcurrency } : {}),
        metadata: {
          source: 'passive-task',
          task_id: task.id,
          passive_run_id: runId,
          machine_mode: machineMode,
          local_ai_preference: settings.localAiPreference,
          resource_decision: resourceDecision,
          ...(boundedConcurrency ? { concurrency: boundedConcurrency } : {}),
          ...(preferredProvider || preferredModel
            ? { preferred_route: { provider: preferredProvider, model: preferredModel, source: 'ai-os-machine-profile' } }
            : {}),
          card_count: digestCards.length,
          source_card_ids: digestCards.map((item) => item.id)
        }
      })
    },
    10000
  );
  const job = isRecord(payload) && isRecord(payload.job) ? payload.job : {};
  const jobId = typeof job.id === 'string' ? job.id : undefined;
  return {
    cards: [
      card({
        id: id('passive-card'),
        taskId: task.id,
        runId,
        family: task.family,
        title: 'Idle passive digest summary queued',
        summary: `AI OS accepted ${digestCards.length} passive finding${digestCards.length === 1 ? '' : 's'} for a local-first summary job.`,
        urgency: digestCards.some((item) => item.urgency >= 85) ? 64 : 48,
        confidence: 0.84,
        route: routeMap.aiOs,
        sourceRefs: [
          stableSourceRef('record', 'AI OS job', {
            id: jobId ?? runId,
            route: routeMap.aiOs,
            metadata: {
              job,
              sourceCardIds: digestCards.map((item) => item.id)
            }
          }),
          ...digestCards.slice(0, 5).map((item) =>
            stableSourceRef('record', item.title, {
              id: item.id,
              route: item.route,
              metadata: {
                family: item.family,
                urgency: item.urgency,
                sourceRefs: item.sourceRefs
              }
            })
          )
        ],
        suggestedAction: 'Inspect summary job',
        actionKind: 'inspect',
        why: 'The machine was idle, so Mini Hub queued a bounded AI OS summary over existing passive findings instead of blocking the UI.'
      })
    ],
    changed: jobId ? [`ai-job:${jobId}`] : [],
    metadata: {
      queued: true,
      jobId,
      cardCount: digestCards.length,
      inputChars: summaryText.length,
      localFirst: true,
      allowFallback: allowCloud,
      resourceDecision,
      ...(boundedConcurrency ? { concurrency: boundedConcurrency } : {}),
      ...(preferredProvider || preferredModel
        ? { preferredRoute: { provider: preferredProvider, model: preferredModel, source: 'ai-os-machine-profile' } }
        : {})
    }
  };
}

async function runBackupSnapshot(store: MemoryStore, task: PassiveTask, runId: string, fetchImpl: FetchLike): Promise<FamilyRunResult> {
  const createdAt = nowIso();
  const snapshotRoot = join(resolve(env.dataDir), passiveSnapshotDirName);
  mkdirSync(snapshotRoot, { recursive: true });
  const snapshotId = `${createdAt.replace(/[:.]/gu, '-')}_${crypto.randomUUID().slice(0, 8)}`;
  const snapshotPath = join(snapshotRoot, `${snapshotId}.json`);
  const snapshotPayload = sanitizedMiniHubSnapshot(store);
  writeFileSync(snapshotPath, JSON.stringify(snapshotPayload, null, 2), 'utf8');
  const verification = verifyMiniHubSnapshotFile(snapshotPath);

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
      sourceRefs: [
        stableSourceRef('file', 'Mini Hub restore snapshot', {
          id: snapshotId,
          filePath: snapshotPath,
          metadata: {
            verified: verification.ok,
            bytes: verification.bytes,
            sha256: verification.sha256,
            redactedTokenSets: verification.redactedTokenSets,
            summary: verification.summary,
            ...(verification.error ? { error: verification.error } : {})
          }
        })
      ],
      suggestedAction: 'Inspect snapshot',
      actionKind: 'inspect',
      why: verification.ok
        ? 'A scheduled non-destructive backup watcher created and read-verified a restore point.'
        : 'A scheduled non-destructive backup watcher wrote a restore point, but verification failed.'
    })
  ];
  const changed = [`snapshot:${snapshotPath}`];
  if (!verification.ok) {
    cards.push(
      serviceIssueCard(
        task,
        runId,
        'Mini Hub restore snapshot verification failed',
        verification.error ?? 'Snapshot could not be read back after writing.',
        88,
        stableSourceRef('file', 'Mini Hub restore snapshot', { id: snapshotId, filePath: snapshotPath })
      )
    );
  }
  const aiBackupMetadata: Record<string, unknown> = { requested: false };

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
    aiBackupMetadata.requested = true;
    if (backup?.id) {
      changed.push(`ai-backup:${String(backup.id)}`);
      aiBackupMetadata.id = String(backup.id);
    }
    if (backup) aiBackupMetadata.backup = backup;
  } catch (error) {
    aiBackupMetadata.requested = true;
    aiBackupMetadata.error = describeError(error);
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

  return {
    status: verification.ok ? 'succeeded' : 'failed',
    ...(verification.ok ? {} : { error: verification.error ?? 'Mini Hub restore snapshot verification failed.' }),
    cards,
    changed,
    metadata: {
      snapshotPath,
      snapshotId,
      snapshotVerified: verification.ok,
      snapshotBytes: verification.bytes,
      snapshotSha256: verification.sha256,
      snapshotSummary: verification.summary,
      redactedTokenSets: verification.redactedTokenSets,
      aiBackup: aiBackupMetadata
    }
  };
}

async function runIdleCompute(
  store: MemoryStore,
  task: PassiveTask,
  runId: string,
  fetchImpl: FetchLike,
  input: PassiveRunInput
): Promise<FamilyRunResult> {
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

  const settings = store.passiveSettings ?? defaultPassiveSettings();
  const budget = resourceBudget(settings);
  const resourceDecision = passiveResourceDecision(store);
  const cleanupCandidates = planMiniHubCleanup();
  const cleanupCards: PassiveResultCard[] = cleanupCandidates.length
    ? [
        card({
          id: id('passive-card'),
          taskId: task.id,
          runId,
          family: task.family,
          title: `${cleanupCandidates.length} idle cleanup candidate${cleanupCandidates.length === 1 ? '' : 's'} found`,
          summary: `Dry-run only: ${formatBytes(cleanupCandidates.reduce((total, item) => total + item.size, 0))} across stale snapshots/logs/temp files. No files were changed.`,
          urgency: cleanupCandidates.length >= 10 ? 58 : 46,
          confidence: 0.86,
          route: routeMap.passiveTasks,
          sourceRefs: cleanupCandidates.slice(0, 10).map((item) =>
            stableSourceRef('file', basename(item.path), {
              id: item.path,
              filePath: item.path,
              metadata: {
                kind: item.kind,
                size: item.size,
                modifiedAt: new Date(item.mtimeMs).toISOString(),
                reason: item.reason
              }
            })
          ),
          suggestedAction: 'Review cleanup plan',
          actionKind: 'inspect',
          why: 'The machine was idle, so the cleanup planner checked only Mini Hub-owned data paths and produced a non-destructive dry-run.'
        })
      ]
    : [
        card({
          id: id('passive-card'),
          taskId: task.id,
          runId,
          family: task.family,
          title: 'Idle cleanup is quiet',
          summary: 'No stale Mini Hub snapshots, logs, or temp files crossed the cleanup planning threshold.',
          urgency: 18,
          confidence: 0.78,
          route: routeMap.passiveTasks,
          sourceRefs: [stableSourceRef('file', 'Mini Hub data dir', { id: resolve(env.dataDir), filePath: resolve(env.dataDir) })],
          suggestedAction: 'No action',
          actionKind: 'inspect',
          why: 'The cleanup planner ran during an idle window and found no non-destructive cleanup candidates.'
        })
      ];
  const cleanupChanged = cleanupCandidates.map((item) => `cleanup-candidate:${item.path}`);

  if (!resourceDecision.heavyAiAllowed) {
    const reason = resourceDecision.skipReason ?? 'Current machine policy does not allow background local AI work.';
    const deferredByPressure = resourceDecision.resourcePressureLevel === 'high';
    return {
      status: 'succeeded',
      cards: [
        card({
          id: id('passive-card'),
          taskId: task.id,
          runId,
          family: task.family,
          title: deferredByPressure ? 'Idle local AI work deferred by machine pressure' : 'Idle local AI work deferred by machine policy',
          summary: `${reason} Cleanup planning still ran because it is non-destructive and bounded.`,
          urgency: deferredByPressure ? 54 : 42,
          confidence: resourceDecision.profileFresh ? 0.9 : 0.72,
          route: routeMap.aiOs,
          sourceRefs: [
            stableSourceRef('service', resourceDecision.profileFresh ? 'AI OS machine profile' : 'Machine mode', {
              id: resourceDecision.profileRunId ?? 'passive-resource-policy',
              route: routeMap.aiOs,
              metadata: { resourceDecision }
            })
          ],
          suggestedAction: deferredByPressure ? 'Wait for lower pressure' : 'Inspect policy',
          actionKind: 'inspect',
          why: 'Idle compute respects recent machine-profile/autotune pressure before launching local AI work.'
        }),
        ...cleanupCards
      ],
      changed: cleanupChanged,
      metadata: {
        cleanupCandidates: cleanupCandidates.length,
        cleanupBytes: cleanupCandidates.reduce((total, item) => total + item.size, 0),
        resourceDecision,
        idleSummary: {
          queued: false,
          reason: 'resource-policy'
        },
        benchmark: {
          queued: false,
          reason: 'resource-policy'
        }
      }
    };
  }

  const summary = await queueIdleDigestSummary(store, task, runId, fetchImpl, budget, resourceDecision).catch((error: unknown) => ({
    cards: [
      serviceIssueCard(
        task,
        runId,
        'Idle digest summary failed to queue',
        describeError(error),
        58,
        stableSourceRef('service', 'AI OS jobs', { id: 'ai-os-jobs', route: routeMap.aiOs })
      )
    ],
    changed: [],
    metadata: {
      queued: false,
      error: describeError(error)
    }
  }));
  const preferredRoute = isRecord(resourceDecision.preferredLocalRoute) ? resourceDecision.preferredLocalRoute : undefined;
  const preferredProvider = optionalString(preferredRoute?.provider);
  const preferredModel = optionalString(preferredRoute?.model);

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
          ...(preferredProvider ? { provider: preferredProvider } : {}),
          ...(preferredModel ? { model: preferredModel } : {}),
          metadata: {
            source: 'passive-task',
            task_id: task.id,
            passive_run_id: runId,
            resource_decision: resourceDecision,
            ...(preferredProvider || preferredModel
              ? { preferred_route: { provider: preferredProvider, model: preferredModel, source: 'ai-os-machine-profile' } }
              : {})
          }
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
      ].concat(cleanupCards, summary.cards),
      changed: [...(benchmark.id ? [`benchmark:${String(benchmark.id)}`] : []), ...cleanupChanged, ...summary.changed],
      metadata: {
        cleanupCandidates: cleanupCandidates.length,
        cleanupBytes: cleanupCandidates.reduce((total, item) => total + item.size, 0),
        resourceDecision,
        idleSummary: summary.metadata,
        benchmark: {
          queued: true,
          ...(preferredProvider || preferredModel
            ? { preferredRoute: { provider: preferredProvider, model: preferredModel, source: 'ai-os-machine-profile' } }
            : {})
        }
      }
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
      ].concat(cleanupCards, summary.cards),
      changed: [...cleanupChanged, ...summary.changed],
      metadata: {
        cleanupCandidates: cleanupCandidates.length,
        cleanupBytes: cleanupCandidates.reduce((total, item) => total + item.size, 0),
        resourceDecision,
        idleSummary: summary.metadata,
        benchmark: {
          queued: false,
          error: describeError(error),
          ...(preferredProvider || preferredModel
            ? { preferredRoute: { provider: preferredProvider, model: preferredModel, source: 'ai-os-machine-profile' } }
            : {})
        }
      }
    };
  }
}

async function ensureWatchedDomainResearchMonitors(settings: PassiveEngineSettings, fetchImpl: FetchLike): Promise<Record<string, unknown>[]> {
  const budget = resourceBudget(settings);
  const domains = safeConfiguredDomains(settings, budget);
  if (!domains.length) return [];

  const payload = await fetchJsonWithTimeout(
    fetchImpl,
    new URL('/api/ai/research/monitors?limit=50', env.aiOsApiUrl),
    'Research monitors'
  );
  const existing = isRecord(payload) && Array.isArray(payload.monitors) ? payload.monitors.filter(isRecord) : [];
  const covered = new Set(
    existing
      .map((monitor) => (isRecord(monitor.metadata) ? monitor.metadata.watched_domain : undefined))
      .filter((value): value is string => typeof value === 'string')
  );

  const created: Record<string, unknown>[] = [];
  for (const domain of domains.filter((item) => !covered.has(item)).slice(0, budget.researchMonitorCreateLimit)) {
    const createPayload = await fetchJsonWithTimeout(
      fetchImpl,
      new URL('/api/ai/research/monitors', env.aiOsApiUrl),
      'Create research monitor',
      {
        method: 'POST',
        body: JSON.stringify({
          name: `Passive watch: ${domain}`,
          enabled: true,
          schedule: 'daily',
          request: {
            mode: 'monitor_topic',
            goal: `Monitor ${domain} for meaningful changes, new posts, product/company updates, deadlines, or technical notes relevant to my Mini Hub watch list. Summarize only source-backed changes.`,
            seed_urls: [`https://${domain}/`],
            depth: 1,
            max_pages: budget.researchMaxPages,
            per_domain_limit: budget.researchPerDomainLimit,
            time_budget_s: budget.researchTimeBudgetSeconds,
            include_domains: [domain],
            exclude_domains: [],
            use_ai: settings.localAiPreference !== 'local_only',
            use_cloud_ai: settings.localAiPreference === 'cloud_allowed',
            local_first: true,
            screenshot: false,
            save_to_memory: false,
            metadata: {
              source: 'mini-hub-passive',
              watched_domain: domain
            }
          },
          metadata: {
            source: 'mini-hub-passive',
            watched_domain: domain,
            created_by_task: 'research_monitor'
          }
        })
      },
      10000
    );
    const monitor = isRecord(createPayload) && isRecord(createPayload.monitor) ? createPayload.monitor : { domain };
    created.push(monitor);
  }
  return created;
}

function stringList(value: unknown, limit = 4): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, limit) : [];
}

function nestedRecord(value: Record<string, unknown>, key: string): Record<string, unknown> {
  return isRecord(value[key]) ? value[key] : {};
}

function researchRunSourceRefs(run: Record<string, unknown>): PassiveSourceRef[] {
  const sources = Array.isArray(run.sources) ? run.sources.filter(isRecord) : [];
  return sources.slice(0, 6).map((source) => {
    const url =
      typeof source.canonical_url === 'string' && source.canonical_url
        ? source.canonical_url
        : typeof source.url === 'string'
          ? source.url
          : undefined;
    const label =
      typeof source.title === 'string' && source.title.trim()
        ? source.title
        : url
          ? url
          : typeof source.id === 'string'
            ? source.id
            : 'Research source';
    return stableSourceRef('url', label, {
      id: String(source.id ?? url ?? label),
      route: routeMap.research,
      ...(url ? { url } : {}),
      metadata: {
        url,
        title: source.title,
        description: source.description,
        fetchedAt: source.fetched_at,
        score: source.score,
        rank: source.rank
      }
    });
  });
}

function researchRunReportSummary(report: Record<string, unknown>, sources: PassiveSourceRef[]): string {
  const keyFacts = stringList(report.key_facts, 3);
  const tldr = typeof report.tldr === 'string' ? report.tldr.trim() : '';
  const detailed = typeof report.detailed_summary === 'string' ? report.detailed_summary.trim() : '';
  const parts = [tldr, keyFacts.length ? `Key facts: ${keyFacts.join('; ')}.` : '', !tldr && detailed ? detailed : ''].filter(Boolean);
  if (parts.length) return truncateText(parts.join(' '), 520);
  return sources.length
    ? `AI OS found ${sources.length} source${sources.length === 1 ? '' : 's'} for this monitor run.`
    : 'AI OS completed this monitor run without a source-backed summary.';
}

function researchRunCard(task: PassiveTask, passiveRunId: string, researchRun: Record<string, unknown>): PassiveResultCard | null {
  if (researchRun.mode !== 'monitor_topic' || researchRun.status !== 'succeeded') return null;
  const report = nestedRecord(researchRun, 'report');
  const sources = researchRunSourceRefs(researchRun);
  const keyFacts = stringList(report.key_facts, 3);
  const tldr = typeof report.tldr === 'string' ? report.tldr.trim() : '';
  const detailed = typeof report.detailed_summary === 'string' ? report.detailed_summary.trim() : '';
  if (!sources.length && !keyFacts.length && !tldr && !detailed) return null;
  const options = nestedRecord(researchRun, 'options');
  const metadata = nestedRecord(options, 'metadata');
  const watchedDomain = typeof metadata.watched_domain === 'string' ? metadata.watched_domain : undefined;
  const title =
    typeof report.title === 'string' && report.title.trim()
      ? report.title.trim()
      : watchedDomain
        ? `Research update for ${watchedDomain}`
        : 'Research monitor update';
  return card({
    id: id('passive-card'),
    taskId: task.id,
    runId: passiveRunId,
    family: task.family,
    title: truncateText(title, 140),
    summary: researchRunReportSummary(report, sources),
    urgency: keyFacts.length || sources.length >= 2 ? 68 : 56,
    confidence: sources.length ? 0.78 : 0.58,
    route: routeMap.research,
    sourceRefs: [
      stableSourceRef('record', 'AI OS research run', {
        id: String(researchRun.id ?? title),
        route: routeMap.research,
        metadata: {
          researchRunId: researchRun.id,
          status: researchRun.status,
          mode: researchRun.mode,
          goal: researchRun.goal,
          watchedDomain,
          sourceCount: sources.length,
          runtimeMs: researchRun.runtime_ms,
          costUsd: researchRun.cost_usd,
          totalTokens: researchRun.total_tokens
        }
      }),
      ...sources
    ],
    suggestedAction: 'Review research update',
    actionKind: 'inspect',
    why: watchedDomain
      ? `AI OS completed a saved monitor run for ${watchedDomain} and returned source-backed findings.`
      : 'AI OS completed a saved topic monitor run and returned source-backed findings.'
  });
}

function passiveResultResearchRunId(item: PassiveResultCard): string | undefined {
  for (const ref of item.sourceRefs) {
    const researchRunId = ref.metadata.researchRunId;
    if (typeof researchRunId === 'string' && researchRunId.trim()) return researchRunId;
  }
  return undefined;
}

function surfacedResearchMonitorRunIds(store: MemoryStore): Set<string> {
  const ids = new Set<string>();
  for (const result of store.passiveResults) {
    if (result.family !== 'research_monitor') continue;
    const researchRunId = passiveResultResearchRunId(result);
    if (researchRunId) ids.add(researchRunId);
  }
  for (const run of store.passiveRuns) {
    for (const cardItem of run.cards) {
      if (cardItem.family !== 'research_monitor') continue;
      const researchRunId = passiveResultResearchRunId(cardItem);
      if (researchRunId) ids.add(researchRunId);
    }
  }
  return ids;
}

async function recentResearchMonitorRunCards(
  store: MemoryStore,
  task: PassiveTask,
  passiveRunId: string,
  fetchImpl: FetchLike,
  budget: PassiveResourceBudget
): Promise<{ cards: PassiveResultCard[]; changed: string[]; metadata: Record<string, unknown> }> {
  const payload = await fetchJsonWithTimeout(
    fetchImpl,
    new URL('/api/ai/research/runs?limit=10', env.aiOsApiUrl),
    'Recent research runs'
  );
  const runs = isRecord(payload) && Array.isArray(payload.runs) ? payload.runs.filter(isRecord) : [];
  const monitorRuns = runs.filter((run) => run.mode === 'monitor_topic');
  const alreadySurfaced = surfacedResearchMonitorRunIds(store);
  const freshMonitorRuns = monitorRuns.filter((run) => typeof run.id !== 'string' || !alreadySurfaced.has(run.id));
  const cards = freshMonitorRuns
    .map((run) => researchRunCard(task, passiveRunId, run))
    .filter((item): item is PassiveResultCard => Boolean(item))
    .slice(0, budget.researchMonitorRunLimit);
  return {
    cards,
    changed: cards
      .map((item) => item.sourceRefs[0]?.metadata.researchRunId)
      .filter((value): value is string => typeof value === 'string')
      .map((researchRunId) => `research-run:${researchRunId}`),
    metadata: {
      recentRunsChecked: runs.length,
      monitorRunsChecked: monitorRuns.length,
      skippedAlreadySurfaced: monitorRuns.length - freshMonitorRuns.length,
      surfacedResearchRuns: cards.length
    }
  };
}

async function runResearchMonitor(store: MemoryStore, task: PassiveTask, runId: string, fetchImpl: FetchLike): Promise<FamilyRunResult> {
  const settings = store.passiveSettings ?? defaultPassiveSettings();
  const budget = resourceBudget(settings);
  try {
    const createdMonitors = await ensureWatchedDomainResearchMonitors(settings, fetchImpl);
    const recent = await recentResearchMonitorRunCards(store, task, runId, fetchImpl, budget).catch((error: unknown) => ({
      cards: [
        serviceIssueCard(
          task,
          runId,
          'Recent research run summary failed',
          describeError(error),
          56,
          stableSourceRef('service', 'AI OS research runs', { id: 'ai-os-research-runs', route: routeMap.research })
        )
      ],
      changed: [],
      metadata: { recentRunError: describeError(error) }
    }));
    const duePayload = await fetchJsonWithTimeout(
      fetchImpl,
      new URL('/api/ai/research/monitors/due?limit=10', env.aiOsApiUrl),
      'Research monitors'
    );
    const due = isRecord(duePayload) && Array.isArray(duePayload.monitors) ? duePayload.monitors.filter(isRecord) : [];
    if (!due.length) {
      if (createdMonitors.length) {
        return {
          status: 'succeeded',
          cards: [
            card({
              id: id('passive-card'),
              taskId: task.id,
              runId,
              family: task.family,
              title: `${createdMonitors.length} watched domain monitor${createdMonitors.length === 1 ? '' : 's'} prepared`,
              summary: 'Created AI OS daily monitor templates from Passive Task watched domains. No crawl was run by this setup step.',
              urgency: 44,
              confidence: 0.88,
              route: routeMap.research,
              sourceRefs: createdMonitors.map((monitor) =>
                stableSourceRef('record', String(monitor.name ?? monitor.id ?? 'Watched domain monitor'), {
                  id: String(monitor.id ?? crypto.randomUUID()),
                  route: routeMap.research,
                  metadata: monitor
                })
              ),
              suggestedAction: 'Inspect monitors',
              actionKind: 'inspect',
              why: 'Passive Tasks found watched domains in settings and created durable AI OS monitor definitions for them without running a crawl.'
            })
          ].concat(recent.cards),
          changed: [
            ...createdMonitors.map((monitor) => `research-monitor:${String(monitor.id ?? '')}`).filter((value) => !value.endsWith(':')),
            ...recent.changed
          ],
          metadata: {
            createdMonitors: createdMonitors.length,
            watchedDomains: safeConfiguredDomains(settings, budget),
            resourceLimit: settings.resourceLimit,
            recentResearch: recent.metadata
          }
        };
      }
      if (recent.cards.length) {
        return {
          status: 'succeeded',
          cards: recent.cards,
          changed: recent.changed,
          metadata: {
            createdMonitors: 0,
            watchedDomains: safeConfiguredDomains(settings, budget),
            resourceLimit: settings.resourceLimit,
            recentResearch: recent.metadata
          }
        };
      }
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
        ].concat(recent.cards),
        changed: recent.changed,
        metadata: {
          createdMonitors: 0,
          watchedDomains: safeConfiguredDomains(settings, budget),
          resourceLimit: settings.resourceLimit,
          recentResearch: recent.metadata
        }
      };
    }

    const sweep = await fetchJsonWithTimeout(
      fetchImpl,
      new URL('/api/ai/research/monitors/run-due', env.aiOsApiUrl),
      'Run due research monitors',
      {
        method: 'POST',
        body: JSON.stringify({ limit: Math.min(budget.researchMonitorRunLimit, due.length), dry_run: false, include_manual: false })
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
      ].concat(recent.cards),
      changed: [
        ...createdMonitors.map((monitor) => `research-monitor:${String(monitor.id ?? '')}`).filter((value) => !value.endsWith(':')),
        ...queued.map((run) => `research-run:${String(run.id ?? '')}`).filter((value) => !value.endsWith(':')),
        ...recent.changed
      ],
      metadata: {
        createdMonitors: createdMonitors.length,
        watchedDomains: safeConfiguredDomains(settings, budget),
        resourceLimit: settings.resourceLimit,
        recentResearch: recent.metadata
      }
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
  const leadJobs = store.jobs.filter((job) => {
    if (!['lead', 'saved', 'watching'].includes(job.status)) return false;
    const nextAction = parseTime(job.nextActionAt);
    if (Number.isFinite(nextAction)) return nextAction <= soonMs;
    return parseTime(job.updatedAt) <= now - 21 * dayMs;
  });
  const submittedJobs = store.jobs.filter((job) => {
    if (!['applied', 'interview', 'offer'].includes(job.status)) return false;
    const nextAction = parseTime(job.nextActionAt);
    if (Number.isFinite(nextAction)) return nextAction <= soonMs;
    const thresholdDays = job.status === 'applied' ? 14 : 7;
    return parseTime(job.updatedAt) <= now - thresholdDays * dayMs;
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

  if (leadJobs.length) {
    cards.push(
      card({
        id: id('passive-card'),
        taskId: task.id,
        runId,
        family: task.family,
        title: `${leadJobs.length} career lead${leadJobs.length === 1 ? '' : 's'} need follow-up`,
        summary: leadJobs.slice(0, 4).map((job) => `${job.company} - ${job.role}`).join('; '),
        urgency: leadJobs.some((job) => Number.isFinite(parseTime(job.nextActionAt)) && parseTime(job.nextActionAt) <= now) ? 80 : 62,
        confidence: 0.78,
        route: routeMap.careerDesk,
        sourceRefs: leadJobs.slice(0, 8).map((job) =>
          stableSourceRef('record', `${job.company} - ${job.role}`, {
            id: job.id,
            route: routeMap.careerDesk,
            metadata: {
              status: job.status,
              nextActionAt: job.nextActionAt,
              updatedAt: job.updatedAt,
              reason: Number.isFinite(parseTime(job.nextActionAt)) ? 'scheduled-follow-up' : 'stale-lead'
            }
          })
        ),
        suggestedAction: 'Review job status',
        actionKind: 'inspect',
        why: 'Saved job records have overdue next-action dates or have gone stale without a next action.'
      })
    );
  }

  if (submittedJobs.length) {
    cards.push(
      card({
        id: id('passive-card'),
        taskId: task.id,
        runId,
        family: task.family,
        title: `${submittedJobs.length} submitted application${submittedJobs.length === 1 ? '' : 's'} need status review`,
        summary: submittedJobs
          .slice(0, 4)
          .map((job) => `${job.company} - ${job.role} (${job.status})`)
          .join('; '),
        urgency: submittedJobs.some((job) => Number.isFinite(parseTime(job.nextActionAt)) && parseTime(job.nextActionAt) <= now)
          ? 82
          : submittedJobs.some((job) => ['interview', 'offer'].includes(job.status))
            ? 76
            : 68,
        confidence: 0.8,
        route: routeMap.careerDesk,
        sourceRefs: submittedJobs.slice(0, 8).map((job) => {
          const nextAction = parseTime(job.nextActionAt);
          const hasScheduledFollowUp = Number.isFinite(nextAction);
          const thresholdDays = job.status === 'applied' ? 14 : 7;
          const daysSinceUpdate = Math.max(0, Math.floor((now - parseTime(job.updatedAt)) / dayMs));
          return stableSourceRef('record', `${job.company} - ${job.role}`, {
            id: job.id,
            route: routeMap.careerDesk,
            metadata: compactRecord({
              status: job.status,
              nextActionAt: job.nextActionAt,
              updatedAt: job.updatedAt,
              reason: hasScheduledFollowUp ? 'scheduled-follow-up' : 'quiet-submitted-application',
              thresholdDays,
              daysSinceUpdate,
              applicationUrl: job.applicationUrl || undefined
            })
          });
        }),
        suggestedAction: 'Review application pipeline',
        actionKind: 'inspect',
        why: 'Submitted Career Desk applications or interview-stage records have an overdue/upcoming follow-up or have gone quiet without a next action.'
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

  return {
    status: 'succeeded',
    cards,
    metadata: {
      overdueCareerActions: overdueActions.length,
      upcomingCareerActions: dueActions.length,
      leadFollowUps: leadJobs.length,
      submittedApplicationFollowUps: submittedJobs.length
    }
  };
}

function safeConfiguredFolders(settings: PassiveEngineSettings, budget = resourceBudget(settings)): string[] {
  return Array.from(new Set(settings.watchedFolders.map((folder) => folder.trim()).filter(Boolean))).slice(0, budget.watchedFolderLimit);
}

const interestingFileExtensions = new Set([
  '.pdf',
  '.doc',
  '.docx',
  '.txt',
  '.md',
  '.csv',
  '.json',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp'
]);
const textPreviewExtensions = new Set(['.txt', '.md', '.csv', '.json']);
const maxPreviewBytes = 96_000;

function pathWithinFolder(folder: string, target: string): boolean {
  const relativePath = relative(resolve(folder), resolve(target));
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
}

function passiveEventFilePath(input: PassiveRunInput, folders: string[]): string | undefined {
  const eventPath = typeof input.eventFilePath === 'string' && input.eventFilePath.trim() ? resolve(input.eventFilePath) : '';
  if (!eventPath) return undefined;
  return folders.some((folder) => pathWithinFolder(folder, eventPath)) ? eventPath : undefined;
}

function fileKind(extension: string): FileInsight['kind'] {
  if (['.png', '.jpg', '.jpeg', '.webp'].includes(extension)) return 'image';
  if (['.csv', '.json'].includes(extension)) return 'data';
  if (['.txt', '.md'].includes(extension)) return 'note';
  if (['.pdf', '.doc', '.docx'].includes(extension)) return 'document';
  return 'other';
}

function suggestFileTags(filePath: string, extension: string): string[] {
  const name = basename(filePath).toLowerCase();
  const fullPath = filePath.toLowerCase();
  const tags = new Set<string>([fileKind(extension)]);
  if (/\b(resume|cv|cover[-_\s]?letter|application|recruiter|interview)\b/iu.test(name)) tags.add('career');
  if (/\b(homework|assignment|exam|quiz|lecture|notes?|study|course)\b/iu.test(name)) tags.add('study');
  if (/\b(invoice|receipt|statement|tax|payment)\b/iu.test(name)) tags.add('finance');
  if (/\b(screenshot|screen shot|capture)\b/iu.test(name)) tags.add('screenshot');
  if (/\bdownloads?\b/iu.test(fullPath) || /\b(download|untitled|scan)\b/iu.test(name)) tags.add('download');
  if (/\b(research|paper|source|citation|report)\b/iu.test(name)) tags.add('research');
  if (extension === '.md') tags.add('markdown');
  if (extension === '.json') tags.add('structured-data');
  return Array.from(tags).filter(Boolean).slice(0, 6);
}

function cleanupHintsForFile(filePath: string, size: number, mtimeMs: number): string[] {
  const hints: string[] = [];
  const name = basename(filePath);
  if (size >= 25 * 1024 * 1024) hints.push('large file');
  if (/\(\d+\)| copy\b|duplicate/iu.test(name)) hints.push('possible duplicate');
  if (/\b(download|untitled|scan|screenshot)\b/iu.test(name) && Date.now() - mtimeMs > 14 * dayMs) hints.push('review or file away');
  return hints.slice(0, 4);
}

function compactPreviewText(value: string): string {
  return value
    .replace(/\u0000/gu, '')
    .replace(/[^\S\r\n]+/gu, ' ')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

function readFileRange(filePath: string, offset = 0, length = 128_000): Buffer {
  const fd = openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const bytesRead = readSync(fd, buffer, 0, length, offset);
    return buffer.subarray(0, bytesRead);
  } finally {
    closeSync(fd);
  }
}

function imageDimensions(filePath: string, extension: string, size: number): Record<string, unknown> {
  try {
    const header = readFileRange(filePath, 0, Math.min(size, 96_000));
    if (extension === '.png' && header.length >= 24 && header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      return {
        width: header.readUInt32BE(16),
        height: header.readUInt32BE(20),
        dimensionSource: 'png-header'
      };
    }

    if (['.jpg', '.jpeg'].includes(extension) && header.length >= 12 && header[0] === 0xff && header[1] === 0xd8) {
      let offset = 2;
      while (offset + 9 < header.length) {
        if (header[offset] !== 0xff) {
          offset += 1;
          continue;
        }
        const marker = header[offset + 1];
        if (marker === undefined) break;
        const segmentLength = header.readUInt16BE(offset + 2);
        if (segmentLength < 2) break;
        if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
          return {
            width: header.readUInt16BE(offset + 7),
            height: header.readUInt16BE(offset + 5),
            dimensionSource: 'jpeg-sof'
          };
        }
        offset += 2 + segmentLength;
      }
    }

    if (extension === '.webp' && header.length >= 30 && header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WEBP') {
      const chunk = header.toString('ascii', 12, 16);
      if (chunk === 'VP8X' && header.length >= 30) {
        const width = 1 + header.readUIntLE(24, 3);
        const height = 1 + header.readUIntLE(27, 3);
        return { width, height, dimensionSource: 'webp-vp8x' };
      }
    }
  } catch {
    return {};
  }
  return {};
}

function pdfMetadata(filePath: string, size: number): Record<string, unknown> {
  try {
    const text = readFileRange(filePath, 0, Math.min(size, 160_000)).toString('latin1');
    const version = /^%PDF-(\d\.\d)/u.exec(text)?.[1];
    const pageMarkers = text.match(/\/Type\s*\/Page\b(?!s)/gu) ?? [];
    return {
      ...(version ? { pdfVersion: version } : {}),
      ...(pageMarkers.length ? { pageCountApprox: pageMarkers.length } : {}),
      metadataSource: 'pdf-header'
    };
  } catch {
    return {};
  }
}

function docxMetadata(filePath: string, size: number): Record<string, unknown> {
  try {
    const tailLength = Math.min(size, 192_000);
    const text = readFileRange(filePath, Math.max(0, size - tailLength), tailLength).toString('latin1');
    const parts = [
      text.includes('word/document.xml') ? 'document' : '',
      text.includes('docProps/core.xml') ? 'core-properties' : '',
      text.includes('word/media/') ? 'embedded-media' : ''
    ].filter(Boolean);
    return {
      officePackage: true,
      ...(parts.length ? { docxParts: parts } : {}),
      metadataSource: 'docx-zip-directory'
    };
  } catch {
    return {};
  }
}

function fileMetadata(filePath: string, extension: string, size: number, mtimeMs: number): Record<string, unknown> {
  const name = basename(filePath).toLowerCase();
  const folder = filePath.toLowerCase();
  const base = {
    size,
    modifiedAt: new Date(mtimeMs).toISOString(),
    extension,
    kind: fileKind(extension),
    likelyDownload: /\bdownloads?\b/u.test(folder) || /\b(download|untitled|scan)\b/u.test(name),
    likelyScreenshot: /\b(screenshot|screen shot|capture)\b/u.test(name)
  };
  if (extension === '.pdf') return { ...base, ...pdfMetadata(filePath, size) };
  if (extension === '.docx') return { ...base, ...docxMetadata(filePath, size) };
  if (extension === '.doc') return { ...base, legacyOfficeDocument: true };
  if (fileKind(extension) === 'image') return { ...base, ...imageDimensions(filePath, extension, size) };
  return base;
}

function readTextPreview(filePath: string, size: number, extension: string, budget: PassiveResourceBudget): { preview?: string; indexableText?: string } {
  if (!textPreviewExtensions.has(extension) || size > maxPreviewBytes) return {};
  try {
    const text = compactPreviewText(readFileSync(filePath, 'utf8').slice(0, budget.indexedFileChars));
    if (!text) return {};
    return {
      preview: text.slice(0, 360),
      indexableText: text
    };
  } catch {
    return {};
  }
}

function insightForFile(filePath: string, size: number, mtimeMs: number, budget: PassiveResourceBudget): FileInsight {
  const extension = extname(filePath).toLowerCase();
  const tags = suggestFileTags(filePath, extension);
  const cleanupHints = cleanupHintsForFile(filePath, size, mtimeMs);
  return {
    path: filePath,
    size,
    mtimeMs,
    extension,
    kind: fileKind(extension),
    tags,
    cleanupHints,
    metadata: {
      ...fileMetadata(filePath, extension, size, mtimeMs),
      tags,
      cleanupHints
    },
    ...readTextPreview(filePath, size, extension, budget)
  };
}

function fileInsightSourceMetadata(file: FileInsight): Record<string, unknown> {
  return {
    ...file.metadata,
    preview: file.preview,
    indexable: Boolean(file.indexableText)
  };
}

function fileIndexFingerprint(file: Pick<FileInsight, 'path' | 'mtimeMs' | 'size'>): string {
  return `${resolve(file.path)}:${Math.round(file.mtimeMs)}:${file.size}`;
}

function previouslyIndexedFileFingerprints(store: MemoryStore): Set<string> {
  const fingerprints = new Set<string>();
  for (const run of store.passiveRuns) {
    if (run.family !== 'file_intelligence') continue;
    const indexed = Array.isArray(run.metadata.indexed) ? run.metadata.indexed.filter(isRecord) : [];
    for (const item of indexed) {
      if (typeof item.fingerprint === 'string' && item.fingerprint.trim()) {
        fingerprints.add(item.fingerprint);
      }
    }
  }
  return fingerprints;
}

function fileInsightSummary(file: FileInsight): string {
  const parts = [`${file.extension.replace('.', '').toUpperCase() || 'file'} ${file.kind}`];
  if (typeof file.metadata.width === 'number' && typeof file.metadata.height === 'number') {
    parts.push(`${file.metadata.width}x${file.metadata.height}`);
  }
  if (typeof file.metadata.pageCountApprox === 'number') parts.push(`~${file.metadata.pageCountApprox} page${file.metadata.pageCountApprox === 1 ? '' : 's'}`);
  if (file.metadata.officePackage === true) parts.push('Office package');
  if (file.metadata.legacyOfficeDocument === true) parts.push('legacy Office document');
  if (file.tags.length) parts.push(`tags: ${file.tags.join(', ')}`);
  if (file.cleanupHints.length) parts.push(`hints: ${file.cleanupHints.join(', ')}`);
  return parts.join(' - ');
}

function fileKindCounts(files: FileInsight[]): string {
  const counts = files.reduce<Record<string, number>>((acc, file) => {
    acc[file.kind] = (acc[file.kind] ?? 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([kind, count]) => `${count} ${kind}${count === 1 ? '' : 's'}`)
    .join(', ');
}

function safeInsightForExistingFile(filePath: string, budget: PassiveResourceBudget): FileInsight | undefined {
  try {
    const stat = statSync(filePath);
    if (!stat.isFile()) return undefined;
    return insightForFile(filePath, stat.size, stat.mtimeMs, budget);
  } catch {
    return undefined;
  }
}

function recentInterestingFiles(folder: string, budget: PassiveResourceBudget): FileInsight[] {
  const entries: FileInsight[] = [];
  const cutoff = Date.now() - 7 * dayMs;
  for (const entry of readdirSync(folder, { withFileTypes: true }).slice(0, budget.directoryEntriesPerFolder)) {
    if (!entry.isFile()) continue;
    const fullPath = join(folder, entry.name);
    const extension = extname(entry.name).toLowerCase();
    if (!interestingFileExtensions.has(extension)) continue;
    const stat = statSync(fullPath);
    if (stat.mtimeMs < cutoff) continue;
    entries.push(insightForFile(fullPath, stat.size, stat.mtimeMs, budget));
  }
  return entries.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, budget.filesPerFolder);
}

async function indexFileInsightsToMemory(
  store: MemoryStore,
  fetchImpl: FetchLike,
  settings: PassiveEngineSettings,
  insights: FileInsight[]
): Promise<{ changed: string[]; metadata: Record<string, unknown>; error?: string }> {
  const budget = resourceBudget(settings);
  const unique = Array.from(new Map(insights.map((file) => [file.path, file])).values());
  const candidates = unique.filter((file) => file.indexableText);
  const previousFingerprints = previouslyIndexedFileFingerprints(store);
  const skippedAlreadyIndexed = candidates.filter((file) => previousFingerprints.has(fileIndexFingerprint(file)));
  const indexable = candidates.filter((file) => !previousFingerprints.has(fileIndexFingerprint(file))).slice(0, budget.indexableFiles);
  if (!indexable.length) {
    return {
      changed: [],
      metadata: {
        indexedFiles: 0,
        skippedAlreadyIndexedFiles: skippedAlreadyIndexed.length
      }
    };
  }
  const changed: string[] = [];
  const indexed: Array<Record<string, unknown>> = [];
  const failed: Array<Record<string, unknown>> = [];
  for (const file of indexable) {
    const fingerprint = fileIndexFingerprint(file);
    try {
      const payload = await fetchJsonWithTimeout(
        fetchImpl,
        new URL('/api/ai/memory/ingest', env.aiOsApiUrl),
        'AI OS memory ingest',
        {
          method: 'POST',
          body: JSON.stringify({
            source_type: 'local_file',
            source_id: file.path,
            title: basename(file.path),
            text: file.indexableText,
            metadata: {
              source: 'passive-file-intelligence',
              file_path: file.path,
              extension: file.extension,
              kind: file.kind,
              size: file.size,
              modified_at: new Date(file.mtimeMs).toISOString(),
              tags: file.tags,
              cleanup_hints: file.cleanupHints
            },
            chunk_size: 1200,
            overlap: 120,
            ...(settings.localAiPreference === 'cloud_allowed' ? {} : { embedding_provider: 'ollama' })
          })
        },
        12000
      );
      const result = isRecord(payload) && isRecord(payload.result) ? payload.result : {};
      const documentId = typeof result.document_id === 'string' ? result.document_id : '';
      if (documentId) changed.push(`memory:${documentId}`);
      indexed.push({
        path: file.path,
        fingerprint,
        size: file.size,
        mtimeMs: Math.round(file.mtimeMs),
        modifiedAt: new Date(file.mtimeMs).toISOString(),
        documentId,
        chunks: typeof result.chunks === 'number' ? result.chunks : undefined
      });
    } catch (error) {
      failed.push({ path: file.path, error: describeError(error) });
    }
  }
  return {
    changed,
    metadata: {
      indexedFiles: indexed.length,
      skippedAlreadyIndexedFiles: skippedAlreadyIndexed.length,
      indexFailures: failed.length,
      indexed,
      ...(failed.length ? { failed } : {})
    },
    ...(failed.length ? { error: `AI OS memory ingest failed for ${failed.length} file${failed.length === 1 ? '' : 's'}.` } : {})
  };
}

async function runFileIntelligence(
  store: MemoryStore,
  task: PassiveTask,
  runId: string,
  fetchImpl: FetchLike,
  input: PassiveRunInput
): Promise<FamilyRunResult> {
  const settings = store.passiveSettings ?? defaultPassiveSettings();
  const budget = resourceBudget(settings);
  const folders = safeConfiguredFolders(settings, budget);
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
  const allInsights: FileInsight[] = [];
  const eventFilePath = passiveEventFilePath(input, folders);
  const eventFileName = input.eventFileName || (eventFilePath ? basename(eventFilePath) : '');
  const eventInsight = eventFilePath ? safeInsightForExistingFile(eventFilePath, budget) : undefined;
  if (eventInsight) allInsights.push(eventInsight);
  if (eventFilePath && (!eventFileName || interestingFileExtensions.has(extname(eventFileName).toLowerCase()))) {
    cards.push(
      card({
        id: id('passive-card'),
        taskId: task.id,
        runId,
        family: task.family,
        title: eventFileName ? `Watched file changed: ${eventFileName}` : 'Watched folder changed',
        summary: [
          `${input.eventKind ?? 'change'} event from ${input.eventFolder ? basename(input.eventFolder) || input.eventFolder : 'a configured folder'}.`,
          eventInsight ? fileInsightSummary(eventInsight) : ''
        ].filter(Boolean).join(' '),
        urgency: 58,
        confidence: 0.82,
        route: routeMap.passiveTasks,
        sourceRefs: [
          stableSourceRef('file', eventFileName || eventFilePath, {
            id: eventFilePath,
            filePath: eventFilePath,
            metadata: {
              eventName: input.eventName,
              eventKind: input.eventKind,
              eventFolder: input.eventFolder,
              ...(eventInsight ? fileInsightSourceMetadata(eventInsight) : {})
            }
          })
        ],
        suggestedAction: eventInsight?.indexableText ? 'Inspect indexed file' : 'Inspect file',
        actionKind: 'inspect',
        why: 'A configured watched folder emitted a file change event.'
      })
    );
  }

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
      const files = recentInterestingFiles(resolved, budget);
      allInsights.push(...files);
      if (files.length) {
        const tagText = Array.from(new Set(files.flatMap((file) => file.tags))).slice(0, 6).join(', ');
        const cleanupText = Array.from(new Set(files.flatMap((file) => file.cleanupHints))).slice(0, 4).join(', ');
        const countText = fileKindCounts(files);
        cards.push(
          card({
            id: id('passive-card'),
            taskId: task.id,
            runId,
            family: task.family,
            title: `${files.length} recent file${files.length === 1 ? '' : 's'} in ${basename(resolved) || resolved}`,
            summary: [
              countText ? `Found ${countText}.` : '',
              files.slice(0, 5).map((file) => basename(file.path)).join('; '),
              tagText ? `Tags: ${tagText}.` : '',
              cleanupText ? `Hints: ${cleanupText}.` : ''
            ].filter(Boolean).join(' '),
            urgency: files.length >= 8 ? 60 : 46,
            confidence: 0.72,
            route: routeMap.passiveTasks,
            sourceRefs: files.slice(0, 10).map((file) =>
              stableSourceRef('file', basename(file.path), {
                id: file.path,
                filePath: file.path,
                metadata: fileInsightSourceMetadata(file)
              })
            ),
            suggestedAction: files.some((file) => file.indexableText) ? 'Inspect indexed files' : 'Inspect files',
            actionKind: 'inspect',
            why: 'Configured folder metadata shows recently changed document, data, note, or image files.'
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
        summary: 'No recently changed document, data, note, or image files were found in configured folders.',
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

  const memory = await indexFileInsightsToMemory(store, fetchImpl, settings, allInsights);
  if (memory.error) {
    cards.push(
      serviceIssueCard(
        task,
        runId,
        'File memory indexing partially failed',
        memory.error,
        56,
        stableSourceRef('service', 'AI OS memory', { id: 'ai-os-memory', route: routeMap.aiOs })
      )
    );
  }
  const changed = [...(eventFilePath ? [`file:${eventFilePath}`] : []), ...memory.changed];
  return {
    status: cards.some((item) => item.urgency >= 80) ? 'blocked' : 'succeeded',
    cards,
    changed,
    metadata: {
      ...(eventFilePath ? { eventFilePath } : {}),
      ...(input.eventFolder ? { eventFolder: input.eventFolder } : {}),
      ...(input.eventFileName ? { eventFileName: input.eventFileName } : {}),
      ...(input.eventKind ? { eventKind: input.eventKind } : {}),
      resourceLimit: settings.resourceLimit,
      fileBudget: {
        folders: folders.length,
        filesPerFolder: budget.filesPerFolder,
        directoryEntriesPerFolder: budget.directoryEntriesPerFolder,
        indexableFiles: budget.indexableFiles,
        indexedFileChars: budget.indexedFileChars
      },
      fileKinds: Array.from(new Set(allInsights.map((file) => file.kind))).sort(),
      fileCount: new Set(allInsights.map((file) => file.path)).size,
      ...memory.metadata
    }
  };
}

function countTodos(folder: string, budget: PassiveResourceBudget): number {
  let count = 0;
  const stack = [folder];
  const ignored = new Set(['node_modules', '.git', 'dist', 'build', '.svelte-kit', 'coverage']);
  while (stack.length && count < budget.projectTodoCap) {
    const current = stack.pop()!;
    for (const entry of readdirSync(current, { withFileTypes: true }).slice(0, budget.projectDirectoryEntries)) {
      if (entry.isDirectory()) {
        if (!ignored.has(entry.name)) stack.push(join(current, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      const extension = extname(entry.name).toLowerCase();
      if (!['.ts', '.js', '.svelte', '.py', '.md', '.txt'].includes(extension)) continue;
      const text = readFileSync(join(current, entry.name), 'utf8').slice(0, budget.projectFileChars);
      count += (text.match(/\b(TODO|FIXME)\b/giu) ?? []).length;
    }
  }
  return count;
}

function latestSourceNewerThanReadme(folder: string, readmePath: string, budget: PassiveResourceBudget): ProjectDocDrift | null {
  const readmeMtimeMs = statSync(readmePath).mtimeMs;
  const stack = [folder];
  const ignored = new Set(['node_modules', '.git', 'dist', 'build', '.svelte-kit', 'coverage']);
  const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.svelte', '.py', '.rs', '.go', '.json', '.toml', '.yaml', '.yml']);
  let inspected = 0;
  let newest: { path: string; mtimeMs: number } | null = null;

  while (stack.length && inspected < budget.projectDirectoryEntries) {
    const current = stack.pop()!;
    for (const entry of readdirSync(current, { withFileTypes: true }).slice(0, budget.projectDirectoryEntries)) {
      inspected += 1;
      if (inspected > budget.projectDirectoryEntries) break;
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        if (!ignored.has(entry.name)) stack.push(path);
        continue;
      }
      if (!entry.isFile() || resolve(path) === resolve(readmePath)) continue;
      const lowerName = entry.name.toLowerCase();
      if (lowerName.endsWith('.lock') || lowerName === 'package-lock.json' || lowerName === 'pnpm-lock.yaml') continue;
      if (!sourceExtensions.has(extname(entry.name).toLowerCase())) continue;
      const mtimeMs = statSync(path).mtimeMs;
      if (mtimeMs <= readmeMtimeMs + 14 * dayMs) continue;
      if (!newest || mtimeMs > newest.mtimeMs) newest = { path, mtimeMs };
    }
  }

  if (!newest) return null;
  return {
    path: newest.path,
    mtimeMs: newest.mtimeMs,
    readmeMtimeMs,
    daysNewerThanReadme: Math.max(0, Math.round((newest.mtimeMs - readmeMtimeMs) / dayMs))
  };
}

function projectHealthArtifactName(name: string): boolean {
  const lower = name.toLowerCase();
  if (/^\.tmp-.+\.(?:err\.)?log$/u.test(lower)) return true;
  if (/\b(?:test|tests|check|health|ci|junit|vitest|pytest|playwright|coverage)\b/u.test(lower)) {
    return /\.(?:log|txt|xml|json)$/u.test(lower);
  }
  return false;
}

function projectHealthFailureLine(text: string): string | null {
  const patterns = [
    /\b(?:tests?|checks?)\s+failed\b/iu,
    /\b[1-9]\d*\s+(?:failed|failing|failure|failures)\b/iu,
    /\bFAIL(?:ED)?\s+[\w./:-]+/u,
    /\bexit code\s+[1-9]\d*\b/iu,
    /\bProcess completed with exit code [1-9]\d*\b/iu,
    /\bnpm ERR!\b/u,
    /\bERR_PNPM_[A-Z0-9_]+\b/u,
    /\bAssertionError\b/u,
    /\bTraceback \(most recent call last\)/u,
    /<(?:failure|error)\b/iu
  ];
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (patterns.some((pattern) => pattern.test(line))) return line.slice(0, 220);
  }
  return null;
}

function scanProjectHealthArtifacts(folder: string, budget: PassiveResourceBudget): ProjectHealthArtifact[] {
  const artifacts: ProjectHealthArtifact[] = [];
  const stack = [folder];
  const ignored = new Set(['node_modules', '.git', 'dist', 'build', '.svelte-kit', 'coverage']);
  let inspected = 0;
  const recentCutoff = Date.now() - 45 * dayMs;
  while (stack.length && inspected < budget.projectDirectoryEntries && artifacts.length < 5) {
    const current = stack.pop()!;
    for (const entry of readdirSync(current, { withFileTypes: true }).slice(0, budget.projectDirectoryEntries)) {
      inspected += 1;
      if (inspected > budget.projectDirectoryEntries || artifacts.length >= 5) break;
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        if (!ignored.has(entry.name)) stack.push(path);
        continue;
      }
      if (!entry.isFile() || !projectHealthArtifactName(entry.name)) continue;
      const stats = statSync(path);
      if (stats.mtimeMs < recentCutoff || stats.size > 2_000_000) continue;
      const text = readFileSync(path, 'utf8').slice(0, Math.min(budget.projectFileChars, 80_000));
      const matched = projectHealthFailureLine(text);
      if (!matched) continue;
      artifacts.push({
        path,
        summary: `${basename(path)} reports a failing health check.`,
        matched,
        mtimeMs: stats.mtimeMs
      });
    }
  }
  return artifacts;
}

function runProjectDrift(store: MemoryStore, task: PassiveTask, runId: string): FamilyRunResult {
  const settings = store.passiveSettings ?? defaultPassiveSettings();
  const budget = resourceBudget(settings);
  const folders = safeConfiguredFolders(settings, budget);
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
  const changed: string[] = [];
  let healthArtifactCount = 0;
  let docDriftCount = 0;
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
        const docDrift = latestSourceNewerThanReadme(resolved, readme, budget);
        if (docDrift) {
          docDriftCount += 1;
          changed.push(`doc-drift:${docDrift.path}`);
          issues.push(`README trails ${basename(docDrift.path)} by ${docDrift.daysNewerThanReadme} days`);
          sourceRefs.push(
            stableSourceRef('file', basename(docDrift.path), {
              id: docDrift.path,
              filePath: docDrift.path,
              metadata: {
                reason: 'newer-than-readme',
                daysNewerThanReadme: docDrift.daysNewerThanReadme,
                sourceMtimeMs: docDrift.mtimeMs,
                readmeMtimeMs: docDrift.readmeMtimeMs
              }
            })
          );
        }
      }

      if (existsSync(packagePath)) {
        sourceRefs.push(stableSourceRef('file', 'package.json', { id: packagePath, filePath: packagePath }));
        const parsed = JSON.parse(readFileSync(packagePath, 'utf8')) as unknown;
        const scripts = isRecord(parsed) && isRecord(parsed.scripts) ? parsed.scripts : {};
        if (!('test' in scripts) && !('check' in scripts)) issues.push('no test/check script');
      }

      const todos = countTodos(resolved, budget);
      if (todos >= 20) issues.push(`${todos} TODO/FIXME markers`);

      const healthArtifacts = scanProjectHealthArtifacts(resolved, budget);
      if (healthArtifacts.length) {
        healthArtifactCount += healthArtifacts.length;
        issues.push(`${healthArtifacts.length} failing health check artifact${healthArtifacts.length === 1 ? '' : 's'}`);
        for (const artifact of healthArtifacts) {
          changed.push(`health-check:${artifact.path}`);
          sourceRefs.push(
            stableSourceRef('file', basename(artifact.path), {
              id: artifact.path,
              filePath: artifact.path,
              metadata: {
                matched: artifact.matched,
                mtimeMs: artifact.mtimeMs
              }
            })
          );
        }
      }

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
            why: 'Configured project metadata shows stale docs, TODO buildup, failing health artifacts, or missing health scripts.'
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
        summary: 'No README, TODO, package health, or failing health artifact drift was detected in configured folders.',
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

  return {
    status: 'succeeded',
    cards,
    changed,
    metadata: {
      resourceLimit: settings.resourceLimit,
      projectBudget: {
        folders: folders.length,
        directoryEntries: budget.projectDirectoryEntries,
        todoCap: budget.projectTodoCap,
        fileChars: budget.projectFileChars,
        healthArtifactCount,
        docDriftCount
      }
    }
  };
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
  if (task.family === 'idle_compute') return runIdleCompute(store, task, runId, fetchImpl, input);
  if (task.family === 'research_monitor') return runResearchMonitor(store, task, runId, fetchImpl);
  if (task.family === 'career_radar') return runCareerRadar(store, task, runId);
  if (task.family === 'file_intelligence') return runFileIntelligence(store, task, runId, fetchImpl, input);
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

function updateTriggerAfterRun(store: MemoryStore, task: PassiveTask, run: PassiveRun): void {
  syncPassiveTriggersFromTasks(store);
  const triggerIndex = store.passiveTriggers.findIndex((trigger) => trigger.id === task.trigger.id);
  if (triggerIndex < 0) return;
  const existing = store.passiveTriggers[triggerIndex]!;
  store.passiveTriggers[triggerIndex] = passiveTriggerSchema.parse({
    ...existing,
    watcherId: task.watcherId,
    taskIds: [...new Set([...existing.taskIds, task.id])].sort(),
    lastFiredAt: run.finishedAt ?? nowIso(),
    lastRunId: run.id,
    lastStatus: run.status,
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
  const runMode = taskMachineMode(store, task);
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
  const taskAfterExecution = store.passiveTasks[taskIndex]!;
  if (taskAfterExecution.status === 'cancelled') {
    result = {
      ...result,
      status: 'cancelled',
      error: result.error ?? 'Passive task was cancelled before completion.',
      metadata: {
        ...(result.metadata ?? {}),
        cancelledDuringRun: true
      }
    };
  }

  const finished = new Date();
  const nextRunAt = nextRunAfterResult(task, result.status, finished);
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
    nextRunAt,
    metadata: {
      reason: options.input?.reason ?? 'scheduled',
      machineMode: runMode.mode,
      machineModeSource: runMode.source,
      eventName: options.input?.eventName,
      idle: Boolean(options.input?.idle),
      ...(options.input?.idleMinutes !== undefined ? { idleMinutes: options.input.idleMinutes } : {}),
      ...(options.input?.idleSource ? { idleSource: options.input.idleSource } : {}),
      ...(options.input?.idleError ? { idleError: options.input.idleError } : {}),
      ...(options.input?.eventFolder ? { eventFolder: options.input.eventFolder } : {}),
      ...(options.input?.eventFileName ? { eventFileName: options.input.eventFileName } : {}),
      ...(options.input?.eventFilePath ? { eventFilePath: options.input.eventFilePath } : {}),
      ...(options.input?.eventKind ? { eventKind: options.input.eventKind } : {}),
      ...(result.metadata ?? {})
    }
  });
  store.passiveRuns.unshift(run);
  store.passiveRuns = store.passiveRuns.slice(0, 200);
  syncPassiveResultsFromRuns(store);

  const nextTask = applyRunOutcomeToTask(taskAfterExecution.status === 'cancelled' ? taskAfterExecution : task, run, finished);
  store.passiveTasks[taskIndex] = nextTask;
  updateWatcherAfterRun(store, nextTask, run);
  updateTriggerAfterRun(store, nextTask, run);

  const notification = notificationFromRun(run, result.cards);
  const notificationStyle = store.passiveSettings?.notificationStyle ?? 'digest';
  if (
    notification &&
    notificationAllowedByStyle(notification, notificationStyle) &&
    shouldStorePassiveNotification(store, notification, finished)
  ) {
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
    mode: runMode.mode,
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
  options: {
    externalFetch?: FetchLike;
    intervalMs?: number;
    startupEventName?: string | false;
    idleDetector?: PassiveIdleDetector;
    folderWatcher?: PassiveFolderWatchFactory;
    fileEventDebounceMs?: number;
  } = {}
): () => void {
  const intervalMs = options.intervalMs ?? 5 * minuteMs;
  const startupEventName = options.startupEventName ?? 'app.startup';
  const idleDetector = options.idleDetector ?? detectPassiveIdleState;
  const folderWatcher = options.folderWatcher ?? createNodeFolderWatcher;
  const fileEventDebounceMs = options.fileEventDebounceMs ?? 1500;
  const watchedFolders = new Map<string, Pick<FSWatcher, 'close'>>();
  let pendingFileEvent: PassiveRunInput | null = null;
  let fileEventTimer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  setPassiveWorkerState(store, {
    startedAt: nowIso(),
    stoppedAt: undefined,
    running: false,
    intervalMs,
    nextTickAt: addMilliseconds(new Date(), intervalMs),
    activeFileWatchCount: 0,
    pendingFileEvent: false,
    lastError: undefined
  });
  const runExclusive = async (label: string, work: () => Promise<unknown>) => {
    if (running) {
      setPassiveWorkerState(store, {
        lastEventName: label,
        pendingFileEvent: Boolean(pendingFileEvent),
        lastError: `Skipped ${label}; worker is already running.`
      });
      return false;
    }
    running = true;
    const started = new Date();
    setPassiveWorkerState(store, {
      running: true,
      lastEventName: label,
      activeFileWatchCount: watchedFolders.size,
      pendingFileEvent: Boolean(pendingFileEvent),
      ...(label === 'tick' ? { lastTickAt: nowIso(started), nextTickAt: addMilliseconds(started, intervalMs) } : {})
    }, started);
    try {
      await work();
    } catch (error) {
      const message = describeError(error);
      setPassiveWorkerState(store, { lastError: message });
      console.warn(`Passive task worker ${label} failed: ${message}`);
    } finally {
      running = false;
      const finished = new Date();
      setPassiveWorkerState(store, {
        running: false,
        activeFileWatchCount: watchedFolders.size,
        pendingFileEvent: Boolean(pendingFileEvent),
        ...(label === 'tick' ? { lastTickFinishedAt: nowIso(finished), nextTickAt: addMilliseconds(finished, intervalMs) } : {})
      }, finished);
    }
    return true;
  };
  const closeFolderWatchers = () => {
    for (const watcher of watchedFolders.values()) {
      watcher.close();
    }
    watchedFolders.clear();
    setPassiveWorkerState(store, { activeFileWatchCount: 0 });
  };
  const fileWatcherEnabled = () => {
    const settings = store.passiveSettings ?? defaultPassiveSettings();
    const watcher = store.passiveWatchers.find((item) => item.family === 'file_intelligence');
    return Boolean(settings.enabled && watcher?.enabled && settings.enabledFamilies.file_intelligence !== false);
  };
  const flushFileEvent = () => {
    if (!pendingFileEvent) return;
    if (!fileWatcherEnabled()) {
      pendingFileEvent = null;
      if (fileEventTimer) {
        clearTimeout(fileEventTimer);
        fileEventTimer = null;
      }
      setPassiveWorkerState(store, {
        pendingFileEvent: false,
        activeFileWatchCount: watchedFolders.size
      });
      refreshFolderWatchers();
      return;
    }
    const input = pendingFileEvent;
    pendingFileEvent = null;
    void runExclusive('file event', async () => {
      const eventOptions: { externalFetch?: FetchLike; input: Omit<PassiveRunInput, 'eventName'>; limit: number } = {
        input,
        limit: 1
      };
      if (options.externalFetch) eventOptions.externalFetch = options.externalFetch;
      await runPassiveEvent(store, 'file.changed', eventOptions);
    }).then((started) => {
      if (started) return;
      pendingFileEvent = input;
      fileEventTimer = setTimeout(flushFileEvent, fileEventDebounceMs);
    });
  };
  const scheduleFileEvent = (folder: string, eventKind: string, fileName?: string) => {
    if (!fileWatcherEnabled()) {
      pendingFileEvent = null;
      if (fileEventTimer) {
        clearTimeout(fileEventTimer);
        fileEventTimer = null;
      }
      setPassiveWorkerState(store, {
        pendingFileEvent: false,
        activeFileWatchCount: watchedFolders.size,
        lastEventName: 'file.changed'
      });
      refreshFolderWatchers();
      return;
    }
    const resolvedFolder = resolve(folder);
    const eventFilePath = fileName ? resolve(resolvedFolder, fileName) : resolvedFolder;
    pendingFileEvent = {
      reason: `folder-watch:${eventKind}`,
      eventFolder: resolvedFolder,
      ...(fileName ? { eventFileName: fileName } : {}),
      eventFilePath,
      eventKind
    };
    setPassiveWorkerState(store, {
      pendingFileEvent: true,
      activeFileWatchCount: watchedFolders.size,
      lastEventName: 'file.changed'
    });
    if (fileEventTimer) clearTimeout(fileEventTimer);
    fileEventTimer = setTimeout(flushFileEvent, fileEventDebounceMs);
  };
  const refreshFolderWatchers = () => {
    ensurePassiveDefaults(store);
    if (!fileWatcherEnabled()) {
      closeFolderWatchers();
      return;
    }
    const settings = store.passiveSettings ?? defaultPassiveSettings();
    const folders = safeConfiguredFolders(settings)
      .map((folder) => resolve(folder))
      .filter((folder) => existsSync(folder) && statSync(folder).isDirectory());
    const desired = new Set(folders);
    for (const [folder, watcher] of watchedFolders.entries()) {
      if (!desired.has(folder)) {
        watcher.close();
        watchedFolders.delete(folder);
      }
    }
    for (const folder of folders) {
      if (watchedFolders.has(folder)) continue;
      try {
        watchedFolders.set(
          folder,
          folderWatcher(folder, (eventKind, fileName) => scheduleFileEvent(folder, eventKind, fileName))
        );
      } catch (error) {
        console.warn(`Passive file watcher could not watch ${folder}: ${describeError(error)}`);
      }
    }
    setPassiveWorkerState(store, {
      activeFileWatchCount: watchedFolders.size,
      pendingFileEvent: Boolean(pendingFileEvent)
    });
  };
  const tick = async () =>
    runExclusive('tick', async () => {
      refreshFolderWatchers();
      if (!store.passiveSettings?.enabled) {
        pendingFileEvent = null;
        if (fileEventTimer) {
          clearTimeout(fileEventTimer);
          fileEventTimer = null;
        }
        setPassiveWorkerState(store, {
          lastIdle: idleState({
            idle: false,
            thresholdMinutes: passiveIdleThresholdMinutes(store),
            source: 'engine-disabled'
          }),
          pendingFileEvent: false
        });
        return;
      }
      const idle = await idleDetector(passiveIdleThresholdMinutes(store));
      setPassiveWorkerState(store, { lastIdle: idle, pendingFileEvent: Boolean(pendingFileEvent) });
      const tickOptions: { externalFetch?: FetchLike; input?: PassiveRunInput } = {
        input: {
          reason: 'worker-tick',
          idle: idle.idle,
          ...(idle.idleMinutes !== undefined ? { idleMinutes: idle.idleMinutes } : {}),
          idleSource: idle.source,
          ...(idle.error ? { idleError: idle.error } : {})
        }
      };
      if (options.externalFetch) tickOptions.externalFetch = options.externalFetch;
      await runDuePassiveTasks(store, tickOptions);
    });
  const startup = async () => {
    if (!startupEventName) return;
    await runExclusive('startup event', async () => {
      const eventOptions: { externalFetch?: FetchLike; input: Omit<PassiveRunInput, 'eventName'>; limit: number } = {
        input: { reason: 'worker-startup' },
        limit: 1
      };
      if (options.externalFetch) eventOptions.externalFetch = options.externalFetch;
      await runPassiveEvent(store, startupEventName, eventOptions);
    });
  };
  const interval = setInterval(() => {
    void tick();
  }, intervalMs);
  refreshFolderWatchers();
  void startup().then(() => tick());
  return () => {
    clearInterval(interval);
    if (fileEventTimer) clearTimeout(fileEventTimer);
    closeFolderWatchers();
    setPassiveWorkerState(store, {
      running: false,
      stoppedAt: nowIso(),
      nextTickAt: undefined,
      activeFileWatchCount: 0,
      pendingFileEvent: false
    });
  };
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
  syncPassiveTriggersFromTasks(store);
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
  syncPassiveTriggersFromTasks(store);
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
  syncPassiveTriggersFromTasks(store);
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

function passiveCardTriageKey(cardItem: PassiveResultCard): string {
  const sourceRefs = cardItem.sourceRefs
    .map((ref) => [ref.kind, ref.id, ref.label, ref.route ?? '', ref.url ?? '', ref.filePath ?? ''].join('|'))
    .sort();
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify({
        family: cardItem.family,
        title: cardItem.title,
        summary: cardItem.summary,
        route: cardItem.route,
        suggestedAction: cardItem.suggestedAction,
        sourceRefs
      })
    )
    .digest('hex')
    .slice(0, 24);
  return `passive-card-key:${fingerprint}`;
}

function findPassiveResultCard(store: MemoryStore, cardId: string): PassiveResultCard | null {
  return (
    store.passiveResults.find((result) => result.id === cardId) ??
    store.passiveRuns.flatMap((run) => run.cards).find((cardItem) => cardItem.id === cardId) ??
    null
  );
}

function parsePassiveCardState(store: MemoryStore, key: string) {
  const raw = store.passiveSettings?.cardTriage?.[key];
  const parsed = passiveCardTriageStateSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function passiveCardState(store: MemoryStore, cardItem: PassiveResultCard) {
  return parsePassiveCardState(store, cardItem.id) ?? parsePassiveCardState(store, passiveCardTriageKey(cardItem));
}

function passiveCardVisible(store: MemoryStore, cardItem: PassiveResultCard, date = new Date()): boolean {
  const state = passiveCardState(store, cardItem);
  if (!state) return true;
  if (state.status === 'dismissed' || state.status === 'reviewed') return false;
  if (state.status === 'snoozed') {
    const snoozedUntil = state.snoozedUntil ? Date.parse(state.snoozedUntil) : Number.NaN;
    return !(Number.isFinite(snoozedUntil) && snoozedUntil > date.getTime());
  }
  return true;
}

function passiveCardForDigest(store: MemoryStore, cardItem: PassiveResultCard): PassiveResultCard {
  const state = passiveCardState(store, cardItem);
  if (!state) return cardItem;
  return passiveResultCardSchema.parse({
    ...cardItem,
    urgency: state.status === 'important' ? Math.min(100, cardItem.urgency + 12) : cardItem.urgency,
    metadata: {
      ...cardItem.metadata,
      passiveTriageStatus: state.status,
      passiveTriageUpdatedAt: state.updatedAt,
      ...(state.snoozedUntil ? { snoozedUntil: state.snoozedUntil } : {})
    }
  });
}

function passiveCardImportant(store: MemoryStore, cardId: string): boolean {
  const cardItem = findPassiveResultCard(store, cardId);
  if (!cardItem) return false;
  return passiveCardState(store, cardItem)?.status === 'important';
}

export function updatePassiveCardTriage(
  store: MemoryStore,
  cardId: string,
  status: PassiveCardTriageStatus | 'clear',
  input: { snoozedUntil?: string; reason?: string } = {}
): PassiveEngineSettings {
  ensurePassiveDefaults(store);
  const cardItem = findPassiveResultCard(store, cardId);
  if (!cardItem) throw new Error('Passive result card not found.');
  const stableKey = passiveCardTriageKey(cardItem);
  const existing = store.passiveSettings ?? defaultPassiveSettings();
  const nextTriage = { ...(existing.cardTriage ?? {}) };
  if (status === 'clear') {
    delete nextTriage[cardId];
    delete nextTriage[stableKey];
  } else {
    nextTriage[cardId] = passiveCardTriageStateSchema.parse({
      cardId,
      status,
      updatedAt: nowIso(),
      ...(input.snoozedUntil ? { snoozedUntil: input.snoozedUntil } : {}),
      ...(input.reason ? { reason: input.reason } : {})
    });
    nextTriage[stableKey] = passiveCardTriageStateSchema.parse({
      cardId: stableKey,
      status,
      updatedAt: nowIso(),
      ...(input.snoozedUntil ? { snoozedUntil: input.snoozedUntil } : {}),
      ...(input.reason ? { reason: input.reason } : {})
    });
  }
  const next = passiveEngineSettingsSchema.parse({
    ...existing,
    cardTriage: nextTriage,
    updatedAt: nowIso()
  });
  store.passiveSettings = next;
  appendActionLedgerEvent(store, {
    system: 'mini-hub',
    source: 'passive-tasks',
    actionType: status === 'clear' ? 'passive.card.clear' : `passive.card.${status}`,
    summary: status === 'clear' ? 'Passive card triage cleared' : `Passive card marked ${status}`,
    status: 'succeeded',
    risk: 'write',
    changed: [`passive-card:${cardId}`, stableKey],
    recoverability: {
      kind: 'snapshot',
      route: routeMap.passiveTasks,
      description: 'Passive card triage can be changed again from the Passive Tasks dashboard.',
      reversible: true
    },
    rawRef: { kind: 'passive_card', id: cardId },
    metadata: { status, snoozedUntil: input.snoozedUntil, reason: input.reason, stableKey }
  });
  persistPassiveTasks(store);
  return next;
}

export function dismissPassiveNotification(store: MemoryStore, notificationId: string): PassiveNotification {
  ensurePassiveDefaults(store);
  const dismissedAt = nowIso();
  const index = store.passiveNotifications.findIndex((notification) => notification.id === notificationId);
  if (index < 0) throw new Error('Passive notification not found.');
  const dismissed = passiveNotificationSchema.parse({
    ...store.passiveNotifications[index]!,
    dismissedAt
  });
  store.passiveNotifications = store.passiveNotifications.map((notification, notificationIndex) =>
    notificationIndex === index ? dismissed : notification
  );
  appendActionLedgerEvent(store, {
    system: 'mini-hub',
    source: 'passive-tasks',
    actionType: 'passive.notification.dismiss',
    summary: `Dismissed passive notification: ${dismissed.title}`,
    status: 'succeeded',
    risk: 'write',
    changed: [`passive-notification:${notificationId}`, ...dismissed.cardIds.map((cardId) => `passive-card:${cardId}`)],
    recoverability: {
      kind: 'snapshot',
      route: routeMap.passiveTasks,
      description: 'Notification dismissal is persisted locally; the source run and cards remain available for inspection.',
      reversible: false
    },
    rawRef: { kind: 'passive_notification', id: notificationId },
    metadata: {
      family: dismissed.family,
      level: dismissed.level,
      taskId: dismissed.taskId,
      runId: dismissed.runId,
      cardIds: dismissed.cardIds,
      dismissedAt
    }
  });
  persistPassiveTasks(store);
  return dismissed;
}

export function buildPassiveDigest(store: MemoryStore, limit = 12): PassiveResultCard[] {
  const seen = new Set<string>();
  const cards: PassiveResultCard[] = [];
  const checkedAt = new Date();
  for (const item of store.passiveResults) {
    if (!passiveCardVisible(store, item, checkedAt)) continue;
    const run = store.passiveRuns.find((entry) => entry.id === item.runId);
    const digestItem = passiveCardForDigest(store, item);
    const key = `${item.family}:${item.title}:${item.summary}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (
      passiveCardImportant(store, item.id) ||
      digestItem.urgency >= passiveDigestUrgency ||
      run?.status === 'failed' ||
      run?.status === 'blocked'
    ) {
      cards.push(digestItem);
    }
  }
  return cards.sort((a, b) => b.urgency - a.urgency || parseTime(b.createdAt) - parseTime(a.createdAt)).slice(0, limit);
}

export function buildPassiveSourceStatuses(store: MemoryStore): PassiveSourceStatus[] {
  const currentMode = currentPassiveMachineMode(store);
  return store.passiveTasks.map((task) => {
    const run = latestRunForTask(store, task.id);
    const fetchedAt = run?.finishedAt ?? task.lastRunAt;
    const error = task.lastError ?? run?.error;
    const taskMode = taskMachineMode(store, task);
    const modePolicy = passiveModePolicy(task, currentMode);
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
        nextRetryAt: task.retry.nextRetryAt,
        status: task.status,
        lastRunStatus: run?.status,
        errorLogCount: task.errorLog.length,
        latestErrorAt: task.errorLog[0]?.at,
        machineMode: taskMode.mode,
        machineModeSource: taskMode.source,
        modePolicy: modePolicy.allowed ? 'allowed' : 'deferred',
        ...(modePolicy.reason ? { modePolicyReason: modePolicy.reason } : {}),
        ...(task.idleOnly || task.family === 'idle_compute'
          ? {
              idleOnly: task.idleOnly,
              idleThresholdMinutes: task.trigger.idleMinutes,
              lastIdle: run?.metadata.idle,
              lastIdleMinutes: run?.metadata.idleMinutes,
              lastIdleSource: run?.metadata.idleSource,
              lastIdleError: run?.metadata.idleError
            }
          : {})
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
    triggers: store.passiveTriggers,
    tasks: store.passiveTasks,
    worker: passiveWorkerSnapshot(store),
    runs: store.passiveRuns.slice(0, 50),
    results: store.passiveResults.slice(0, 100),
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
    risk: kind === 'run' ? 'system' : kind === 'dismiss' || kind === 'snooze' || kind === 'mark_important' ? 'write' : 'read'
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
        attentionAction('mark_important', 'Important', routeMap.passiveTasks),
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
