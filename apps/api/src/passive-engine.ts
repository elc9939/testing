import {
  careerActionSchema,
  jobSchema,
  passiveEngineSettingsSchema,
  passiveBackupHealthSchema,
  passiveCardTriageStateSchema,
  personalWorkspaceId,
  personalSettingsSchema,
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
  type GmailThread,
  type JobRecord,
  type CareerActionRecord,
  type AttentionAction,
  type AttentionItem,
  type IntegrationConnection,
  type PassiveEngineSettings,
  type PassiveBackupHealth,
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
import { careerSeenLeadKeys, careerSeenLeadRegistry, upsertCareerSeenLeadRegistry } from './career-seen-registry';
import { GoogleGmailConnector } from './integrations/google';
import {
  appendActionLedgerEvent,
  appendSyncEvent,
  persistPassiveTasks,
  redactActionLedgerEvent,
  withBeforeSnapshot,
  type MemoryStore
} from './store';

type FetchLike = typeof fetch;
type PassiveMachineMode = 'auto' | 'balanced' | 'beast' | 'quiet' | 'offline' | 'night' | 'maintenance';
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

interface MiniHubSnapshotHealth {
  ok: boolean;
  snapshotRoot: string;
  snapshotCount: number;
  latestPath?: string;
  latestAgeHours?: number;
  stale?: boolean;
  verification?: SnapshotVerification;
  error?: string;
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

interface ProjectTodoFile {
  path: string;
  count: number;
  sample: string;
  mtimeMs: number;
}

interface ProjectTodoScan {
  total: number;
  files: ProjectTodoFile[];
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

type PassiveResearchWatchKind = 'domain' | 'page' | 'topic' | 'tool' | 'company';

interface PassiveResearchDomainEntry {
  key: string;
  kind: PassiveResearchWatchKind;
  domain?: string;
  source: 'settings' | 'career_job' | 'career_profile';
  labels: string[];
  jobIds: string[];
  urls: string[];
  metadata?: Record<string, unknown>;
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

interface PassiveModePolicyContext {
  idle?: boolean;
  eventName?: string;
  activeUse?: boolean;
  activeReason?: string;
  activeSignalAgeMinutes?: number;
  highPressure?: boolean;
  pressureDrivers?: string[];
  profileFresh?: boolean;
}

export interface PassiveRunInput {
  idle?: boolean;
  manual?: boolean;
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
const hourMs = 60 * 60 * 1000;
const minuteMs = 60 * 1000;
const passiveSnapshotDirName = 'passive-snapshots';
const passiveDigestUrgency = 58;
const passiveDigestFreshMs = 7 * dayMs;
const passiveDigestUrgentFreshMs = 30 * dayMs;
const passiveSourceOverdueGraceMs = 15 * minuteMs;
const attentionUrgency = 65;
const maxTaskErrorLogEntries = 12;
const passiveNotificationDedupeMs = dayMs;
const passiveMachineProfileFreshMs = 60 * minuteMs;
const careerDiscoveryMaxPowerIntervalMinutes = 15;
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

const passiveMachineModes = new Set<PassiveMachineMode>(['auto', 'balanced', 'beast', 'quiet', 'offline', 'night', 'maintenance']);
const quietDeferredFamilies = new Set<PassiveTaskFamily>(['idle_compute', 'research_monitor', 'file_intelligence', 'project_drift']);
const autoDeferredFamilies = new Set<PassiveTaskFamily>(['idle_compute', 'research_monitor', 'file_intelligence', 'project_drift']);
const passiveActiveUseEvents = new Set(['app.user_active', 'app.game_active']);
const passiveActiveUseSignalMaxAgeMs = 20 * minuteMs;

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
  currentMode: PassiveMachineMode,
  context: PassiveModePolicyContext = {}
): { allowed: boolean; priorityDelta: number; reason?: string } {
  const explicitMode = passiveMachineMode(task.machineMode);
  if (explicitMode && explicitMode !== currentMode) {
    return {
      allowed: false,
      priorityDelta: 0,
      reason: `Task is pinned to ${explicitMode} mode.`
    };
  }

  if (currentMode === 'auto' && autoDeferredFamilies.has(task.family)) {
    if (context.activeUse) {
      return {
        allowed: false,
        priorityDelta: 0,
        reason: `Auto waits while ${context.activeReason ?? 'active hub use'} is detected before running heavier passive work.`
      };
    }
    if (context.highPressure) {
      return {
        allowed: false,
        priorityDelta: 0,
        reason: `Auto defers heavier passive work while machine pressure is high${context.pressureDrivers?.length ? ` from ${context.pressureDrivers.join(', ')}` : ''}.`
      };
    }
    if (!context.idle) {
      return {
        allowed: false,
        priorityDelta: 0,
        reason: 'Auto waits for idle time before running heavier passive work.'
      };
    }
    return { allowed: true, priorityDelta: 7 };
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

function passiveModePolicyContext(store: MemoryStore, date: Date, input: PassiveRunInput = {}): PassiveModePolicyContext {
  const decision = passiveResourceDecision(store, date);
  const context: PassiveModePolicyContext = {
    highPressure: decision.resourcePressureLevel === 'high',
    pressureDrivers: decision.resourcePressureDrivers,
    profileFresh: decision.profileFresh
  };
  const idle = input.idle ?? store.passiveWorker?.lastIdle?.idle;
  const eventName = input.eventName?.trim();
  if (eventName) context.eventName = eventName;
  const idleSource = input.idleSource ?? store.passiveWorker?.lastIdle?.source;
  const idleCheckedAt = store.passiveWorker?.lastIdle?.checkedAt;
  const idleCheckedAtMs = parseTime(idleCheckedAt);
  const activeSignalAgeMs = Number.isFinite(idleCheckedAtMs) ? Math.max(0, date.getTime() - idleCheckedAtMs) : Number.NaN;
  const activeSignalFresh = !Number.isFinite(activeSignalAgeMs) || activeSignalAgeMs <= passiveActiveUseSignalMaxAgeMs;
  const activeFromEvent = eventName ? passiveActiveUseEvents.has(eventName) : false;
  const activeFromIdleSource =
    activeSignalFresh && (idleSource === 'hub-route:games' || idleSource === 'hub-route:active' || idleSource === 'browser-focus');
  if (activeFromEvent || activeFromIdleSource) {
    context.activeUse = true;
    context.activeReason = eventName === 'app.game_active' || idleSource === 'hub-route:games' ? 'game route' : 'hub activity';
    if (Number.isFinite(activeSignalAgeMs)) context.activeSignalAgeMinutes = Math.round((activeSignalAgeMs / minuteMs) * 10) / 10;
  }
  if (context.activeUse) {
    context.idle = false;
  } else if (idle !== undefined) {
    context.idle = idle;
  }
  return context;
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
    eventNames: [
      'app.startup',
      'app.reconnect',
      'app.user_active',
      'app.game_active',
      'service.reconnect',
      'google.oauth.connected',
      'google.oauth.revoked'
    ],
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

function compactPassiveServiceText(value: string, serviceLabel = 'Passive Tasks', maxLength = 220): string {
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (/gpu telemetry|nvidia-smi|win32_perf|win32_videocontroller|powershell|winerror|hardwareinformation|gpuadaptermemory/iu.test(text)) {
    return 'GPU telemetry is unavailable. Check AI OS machine profile and Windows/AMD telemetry setup.';
  }
  if (/openai|anthropic|api\s*key|client error ['"]?401|\b401\b|unauthori[sz]ed|\btoken\b|expired|revoked|forbidden|permission/iu.test(text)) {
    return `${serviceLabel} needs authentication or a valid API key before this check can run.`;
  }
  if (/timed out|timeout|operation was aborted|request aborted|aborted/iu.test(text)) {
    return `${serviceLabel} timed out. Cached data stays visible when available; retry after the service settles.`;
  }
  if (/github pages|returned html|html instead of json|static site|wrong endpoint|missing route|route .*not found|\b404\b|not found/iu.test(text)) {
    return `${serviceLabel} is pointed at the wrong endpoint or a missing route. Open Settings Feature Wiring and check the saved service URL.`;
  }
  if (/failed to fetch|fetch failed|econnrefused|connection refused/iu.test(text)) {
    return `${serviceLabel} is offline or unreachable. Start the desktop service, then retry.`;
  }
  if (/network|offline|unavailable|service-offline/iu.test(text) && !/returned \d{3}/iu.test(text) && text.length > 40) {
    return `${serviceLabel} is offline or unreachable. Start the desktop service, then retry.`;
  }
  return text.length > maxLength ? `${text.slice(0, maxLength - 3).trim()}...` : text;
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

function applyPassiveRunIdleInput(store: MemoryStore, input: PassiveRunInput | undefined, date = new Date()): void {
  if (
    !input ||
    (input.idle === undefined && input.idleMinutes === undefined && !input.idleSource && !input.idleError)
  ) {
    return;
  }
  const existing = store.passiveWorker?.lastIdle;
  setPassiveWorkerState(
    store,
    {
      lastIdle: idleState({
        idle: input.idle ?? existing?.idle ?? false,
        thresholdMinutes: existing?.thresholdMinutes ?? passiveIdleThresholdMinutes(store),
        source: input.idleSource ?? existing?.source ?? 'passive-run-input',
        ...(input.idleMinutes !== undefined
          ? { idleMinutes: input.idleMinutes }
          : existing?.idleMinutes !== undefined
            ? { idleMinutes: existing.idleMinutes }
            : {}),
        ...(input.idleError ? { error: input.idleError } : existing?.error ? { error: existing.error } : {}),
        checkedAt: nowIso(date)
      })
    },
    date
  );
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

function slugResearchWatchKey(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, '-')
      .replace(/^-+|-+$/gu, '')
      .slice(0, 80) || 'watch'
  );
}

function parseWatchedPage(value: string): PassiveResearchDomainEntry | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    const domain = normalizeWatchedDomain(url.toString());
    if (!domain) return null;
    return {
      key: `page:${url.toString()}`,
      kind: 'page',
      domain,
      source: 'settings',
      labels: [url.toString()],
      jobIds: [],
      urls: [url.toString()]
    };
  } catch {
    return null;
  }
}

function parseResearchSettingEntry(value: string): PassiveResearchDomainEntry | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const prefixed = /^(topic|tool|company|page)\s*:\s*(.+)$/iu.exec(trimmed);
  if (prefixed) {
    const kind = prefixed[1]!.toLowerCase() as PassiveResearchWatchKind;
    const body = prefixed[2]!.trim();
    if (kind === 'page') return parseWatchedPage(body);
    if (!body) return null;
    return {
      key: `${kind}:${slugResearchWatchKey(body)}`,
      kind,
      source: 'settings',
      labels: [body],
      jobIds: [],
      urls: []
    };
  }

  const domain = normalizeWatchedDomain(trimmed);
  if (!domain) return null;
  return {
    key: `domain:${domain}`,
    kind: 'domain',
    domain,
    source: 'settings',
    labels: [domain],
    jobIds: [],
    urls: [`https://${domain}/`]
  };
}

function safeConfiguredDomainEntries(settings: PassiveEngineSettings, budget = resourceBudget(settings)): PassiveResearchDomainEntry[] {
  const limit = Math.max(budget.researchMonitorCreateLimit, budget.researchMonitorRunLimit);
  const byKey = new Map<string, PassiveResearchDomainEntry>();
  for (const entry of settings.watchedDomains.map(parseResearchSettingEntry).filter((item): item is PassiveResearchDomainEntry => Boolean(item))) {
    if (!byKey.has(entry.key)) byKey.set(entry.key, entry);
    if (byKey.size >= limit) break;
  }
  return Array.from(byKey.values());
}

function activeCareerResearchJobs(store: MemoryStore) {
  const inactiveStatuses = new Set(['archived', 'closed', 'rejected', 'declined', 'withdrawn']);
  return store.jobs
    .filter((job) => job.applicationUrl.trim())
    .filter((job) => !inactiveStatuses.has(job.status.trim().toLowerCase()))
    .sort((a, b) => parseTime(b.nextActionAt ?? b.updatedAt) - parseTime(a.nextActionAt ?? a.updatedAt));
}

function activeCareerRoleSeedJobs(store: MemoryStore) {
  const inactiveStatuses = new Set(['archived', 'closed', 'rejected', 'declined', 'withdrawn']);
  return store.jobs
    .filter((job) => !inactiveStatuses.has(job.status.trim().toLowerCase()))
    .sort((a, b) => (b.fitScore ?? -1) - (a.fitScore ?? -1) || parseTime(b.updatedAt) - parseTime(a.updatedAt));
}

function compactTextList(value: unknown, limit = 12): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[\n,;]+/u)
      : [];
  return Array.from(
    new Set(
      raw
        .map((item) => String(item).trim())
        .filter(Boolean)
        .map((item) => item.replace(/\s+/gu, ' '))
    )
  ).slice(0, limit);
}

function careerDiscoveryPreference(store: MemoryStore): Record<string, unknown> {
  const raw = store.settings?.preferences?.careerDiscovery;
  return isRecord(raw) ? raw : {};
}

function careerDiscoveryProfileConfigured(store: MemoryStore): boolean {
  return isRecord(store.settings?.preferences?.careerDiscovery);
}

function careerDiscoveryEnabled(store: MemoryStore): boolean {
  if (!careerDiscoveryProfileConfigured(store)) return false;
  const profile = careerDiscoveryPreference(store);
  return profile.enabled !== false;
}

function careerDiscoveryMaxPowerSearchEnabled(store: MemoryStore): boolean {
  if (!careerDiscoveryEnabled(store)) return false;
  const profile = careerDiscoveryPreference(store);
  return profile.maxPowerSearch === true;
}

function careerDiscoveryRoleSeeds(store: MemoryStore, profile: Record<string, unknown>, limit = 6): string[] {
  const configured = compactTextList(profile.targetRoles, limit);
  const fromJobs = activeCareerRoleSeedJobs(store)
    .map((job) => job.role.trim())
    .filter(Boolean)
    .filter((role) => role.length >= 4);
  return Array.from(new Set([...configured, ...fromJobs])).slice(0, limit);
}

function careerDiscoveryPriorityCompanies(profile: Record<string, unknown>, limit = 8): string[] {
  return compactTextList(profile.priorityCompanies, limit);
}

function careerDiscoveryIntensity(profile: Record<string, unknown>): 'focused' | 'broad' | 'max' {
  return profile.researchIntensity === 'max' || profile.researchIntensity === 'broad' || profile.researchIntensity === 'focused'
    ? profile.researchIntensity
    : 'focused';
}

function careerDiscoveryEntryLimit(profile: Record<string, unknown>, budget: PassiveResourceBudget): number {
  const base = Math.max(1, budget.researchMonitorCreateLimit);
  const intensity = careerDiscoveryIntensity(profile);
  if (profile.maxPowerSearch === true) return Math.max(base, 48);
  if (intensity === 'max') return Math.max(base, 24);
  if (intensity === 'broad') return Math.max(base, 8);
  return base;
}

function researchMonitorBudget(settings: PassiveEngineSettings, store: MemoryStore): PassiveResourceBudget {
  const budget = resourceBudget(settings);
  if (!careerDiscoveryMaxPowerSearchEnabled(store)) return budget;
  return {
    ...budget,
    researchMonitorCreateLimit: Math.max(budget.researchMonitorCreateLimit, 18),
    researchMonitorRunLimit: Math.max(budget.researchMonitorRunLimit, 10),
    researchMaxPages: Math.max(budget.researchMaxPages, 18),
    researchPerDomainLimit: Math.max(budget.researchPerDomainLimit, 10),
    researchTimeBudgetSeconds: Math.max(budget.researchTimeBudgetSeconds, 300)
  };
}

function careerDiscoveryExistingCompanies(store: MemoryStore, profile: Record<string, unknown>, limit = 24): string[] {
  const configured = compactTextList(profile.excludeCompanies, limit);
  const configuredKeys = new Set(configured.map(normalizeCompanyKey).filter(Boolean));
  const priorityKeys = new Set(careerDiscoveryPriorityCompanies(profile, limit).map(normalizeCompanyKey).filter(Boolean));
  const fromJobs = store.jobs
    .map((job) => job.company.trim())
    .filter(Boolean)
    .filter((company) => {
      const key = normalizeCompanyKey(company);
      return !priorityKeys.has(key) || configuredKeys.has(key);
    });
  const fromSeenRegistry = careerSeenLeadRegistry(store)
    .map((entry) => entry.company.trim())
    .filter(Boolean)
    .filter((company) => {
      const key = normalizeCompanyKey(company);
      return !priorityKeys.has(key) || configuredKeys.has(key);
    });
  return Array.from(new Set([...configured, ...fromJobs, ...fromSeenRegistry])).slice(0, limit);
}

const careerSignalStopTerms = new Set([
  'analyst',
  'assistant',
  'associate',
  'career',
  'careers',
  'company',
  'developer',
  'engineer',
  'entry',
  'graduate',
  'intern',
  'internship',
  'jobs',
  'junior',
  'level',
  'new',
  'opening',
  'program',
  'role',
  'roles',
  'summer'
]);

function careerSignalTerms(values: string[], limit = 18): string[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    for (const token of value.toLowerCase().match(/[a-z][a-z0-9+#.-]{2,}/gu) ?? []) {
      const normalized = token.replace(/^[^a-z0-9]+|[^a-z0-9]+$/gu, '');
      if (normalized.length < 3 || careerSignalStopTerms.has(normalized)) continue;
      counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([term]) => term)
    .slice(0, limit);
}

function hasCareerDiscoveryNotFitReview(job: JobRecord): boolean {
  return /Career Discovery review:\s*archived as not fit/iu.test(job.notes);
}

function careerDiscoveryFeedbackProfile(store: MemoryStore): Record<string, unknown> {
  const positiveStatuses = new Set(['saved', 'watching', 'applied', 'interview', 'offer']);
  const negativeStatuses = new Set(['archived', 'rejected', 'declined', 'withdrawn']);
  const positiveJobs = store.jobs
    .filter((job) => positiveStatuses.has(job.status.trim().toLowerCase()))
    .sort((a, b) => (b.fitScore ?? -1) - (a.fitScore ?? -1) || parseTime(b.updatedAt) - parseTime(a.updatedAt));
  const negativeJobs = store.jobs
    .filter((job) => negativeStatuses.has(job.status.trim().toLowerCase()) || hasCareerDiscoveryNotFitReview(job))
    .sort((a, b) => parseTime(b.updatedAt) - parseTime(a.updatedAt));
  const preferredRoleTerms = careerSignalTerms(positiveJobs.map((job) => job.role), 18);
  const targetRoleTerms = careerSignalTerms(careerDiscoveryRoleSeeds(store, careerDiscoveryPreference(store), 12), 24);
  const blockedPositiveTerms = new Set([...preferredRoleTerms, ...targetRoleTerms]);
  const avoidedRoleTerms = careerSignalTerms(negativeJobs.map((job) => job.role), 18).filter((term) => !blockedPositiveTerms.has(term));
  return compactRecord({
    positive_review_count: positiveJobs.length,
    negative_review_count: negativeJobs.length,
    preferred_role_terms: preferredRoleTerms,
    avoided_role_terms: avoidedRoleTerms,
    positive_examples: positiveJobs.slice(0, 8).map((job) => `${job.company} - ${job.role}`),
    negative_examples: negativeJobs.slice(0, 8).map((job) => `${job.company} - ${job.role}`)
  });
}

interface CareerDiscoverySourceLane {
  key: string;
  label: string;
  instruction: string;
  roles?: RegExp;
}

const careerDiscoverySourceLanes: CareerDiscoverySourceLane[] = [
  {
    key: 'company-career-pages',
    label: 'company career pages and ATS postings',
    instruction: 'Prioritize direct employer career pages, Greenhouse, Lever, Ashby, Workday, SmartRecruiters, and other ATS postings with application URLs.'
  },
  {
    key: 'new-grad-rotational',
    label: 'new-grad and rotational programs',
    instruction: 'Prioritize new-grad, rotational, analyst program, early-career, and upcoming-graduate programs with 2027 eligibility.'
  },
  {
    key: 'internships-fellowships',
    label: 'internships and fellowships',
    instruction: 'Prioritize internships, fellowships, summer analyst roles, and structured student programs that can fit a May/Summer 2027 start.'
  },
  {
    key: 'application-deadlines-cycles',
    label: 'application deadlines and recruiting cycles',
    instruction: 'Prioritize source-backed application windows, deadline pages, campus recruiting timelines, and newly opened 2027 cycles so promising leads are not found too late.'
  },
  {
    key: 'early-career-job-boards',
    label: 'early-career job boards and source roundups',
    instruction: 'Use reputable early-career boards and roundups only as discovery indexes; prefer links that resolve to the official employer or ATS application page.'
  },
  {
    key: 'student-program-directories',
    label: 'student program directories',
    instruction: 'Prioritize university-facing student program directories, fellowship pages, internship program lists, and employer student-opportunity pages with official source links.'
  },
  {
    key: 'data-analytics',
    label: 'data and analytics role boards',
    instruction: 'Prioritize data analyst, analytics engineer, GTM/product analytics, business analytics, and data operations listings that match the profile background.',
    roles: /\b(data|analytics?|analyst|gtm|product)\b/iu
  },
  {
    key: 'data-vendor-startups',
    label: 'data vendor and GTM analytics startups',
    instruction: 'Prioritize data vendors, analytics platforms, AI data infrastructure, GTM data, product analytics, and research-operations startups with early-career roles.',
    roles: /\b(data|analytics?|analyst|gtm|product|startup)\b/iu
  },
  {
    key: 'quant-finance',
    label: 'quant and finance early-career searches',
    instruction: 'Prioritize quant research, investment analyst, trading, risk, and finance research opportunities that are explicitly student/new-grad eligible.',
    roles: /\b(quant|investment|trading|finance|risk|research)\b/iu
  },
  {
    key: 'finance-summer-analyst',
    label: 'finance summer analyst and academy programs',
    instruction: 'Prioritize Summer 2027 analyst, academy, research, portfolio, risk, and rotational finance programs with undergraduate/upcoming-graduate eligibility.',
    roles: /\b(quant|investment|trading|finance|risk|research|analyst)\b/iu
  },
  {
    key: 'local-ai-technical',
    label: 'AI tooling and technical analyst searches',
    instruction: 'Prioritize AI tooling, machine learning operations, automation, technical analyst, and software-adjacent roles that value local AI or CS project experience.',
    roles: /\b(ai|machine learning|ml|software|automation|technical|engineer|developer|cs)\b/iu
  },
  {
    key: 'ai-research-labs',
    label: 'AI research labs and applied ML teams',
    instruction: 'Prioritize applied AI labs, research engineering teams, data/ML evaluation teams, and AI product teams with internships or early-career analyst/technical roles.',
    roles: /\b(ai|machine learning|ml|software|automation|technical|engineer|developer|cs|data|research)\b/iu
  }
];

function careerDiscoveryLaneEntries(
  sharedMetadata: Record<string, unknown>,
  roles: string[],
  targetStartWindow: string,
  intensity: 'focused' | 'broad' | 'max',
  entryLimit: number
): PassiveResearchDomainEntry[] {
  if (intensity === 'focused') return [];
  const profileText = typeof sharedMetadata.profile_background === 'string' ? sharedMetadata.profile_background : '';
  const roleText = [roles.join(' '), profileText].join(' ');
  const laneLimit = intensity === 'max' ? Math.min(12, Math.max(4, entryLimit - 4)) : Math.min(5, Math.max(2, entryLimit - 2));
  return careerDiscoverySourceLanes
    .filter((lane) => !lane.roles || lane.roles.test(roleText))
    .slice(0, laneLimit)
    .map((lane) => ({
      key: `topic:career-discovery-${slugResearchWatchKey(targetStartWindow)}-lane-${lane.key}`,
      kind: 'topic' as const,
      source: 'career_profile' as const,
      labels: [`${targetStartWindow} ${lane.label}`],
      jobIds: [],
      urls: [],
      metadata: {
        ...sharedMetadata,
        discovery_scope: 'source_lane',
        source_lane: lane.key,
        source_lane_label: lane.label,
        source_lane_instruction: lane.instruction
      }
    }));
}

function careerDiscoveryPriorityCompanyEntries(
  sharedMetadata: Record<string, unknown>,
  priorityCompanies: string[],
  targetStartWindow: string,
  intensity: 'focused' | 'broad' | 'max',
  entryLimit: number
): PassiveResearchDomainEntry[] {
  if (!priorityCompanies.length) return [];
  const companyLimit = intensity === 'max' ? Math.min(8, Math.max(2, entryLimit - 4)) : intensity === 'broad' ? Math.min(5, Math.max(2, entryLimit - 3)) : Math.min(3, Math.max(1, entryLimit - 2));
  return priorityCompanies.slice(0, companyLimit).map((company) => ({
    key: `topic:career-discovery-${slugResearchWatchKey(targetStartWindow)}-priority-company-${slugResearchWatchKey(company)}`,
    kind: 'company' as const,
    source: 'career_profile' as const,
    labels: [`${company} ${targetStartWindow} opportunities`],
    jobIds: [],
    urls: [],
    metadata: {
      ...sharedMetadata,
      discovery_scope: 'priority_company',
      priority_company: company
    }
  }));
}

function careerDiscoveryProfileEntries(
  store: MemoryStore,
  budget = resourceBudget(store.passiveSettings ?? defaultPassiveSettings())
): PassiveResearchDomainEntry[] {
  if (!careerDiscoveryEnabled(store)) return [];
  const profile = careerDiscoveryPreference(store);
  const entryLimit = careerDiscoveryEntryLimit(profile, budget);
  const roles = careerDiscoveryRoleSeeds(store, profile, Math.max(3, Math.min(entryLimit, 12)));
  if (!roles.length) return [];
  const intensity = careerDiscoveryIntensity(profile);
  const targetStartWindow =
    typeof profile.targetStartWindow === 'string' && profile.targetStartWindow.trim()
      ? profile.targetStartWindow.trim()
      : 'May 2027 / Summer 2027 start';
  const background = typeof profile.background === 'string' ? profile.background.trim() : '';
  const graduationStatus = typeof profile.graduationStatus === 'string' ? profile.graduationStatus.trim() : '';
  const locations = compactTextList(profile.locations, 8);
  const priorityCompanies = careerDiscoveryPriorityCompanies(profile, 10);
  const excludedCompanies = careerDiscoveryExistingCompanies(store, profile);
  const feedback = careerDiscoveryFeedbackProfile(store);
  const sharedMetadata = compactRecord({
    career_discovery: true,
    target_start_window: targetStartWindow,
    profile_background: background || undefined,
    graduation_status: graduationStatus || undefined,
    research_intensity: intensity,
    max_power_search: profile.maxPowerSearch === true,
    target_roles: roles,
    locations,
    priority_companies: priorityCompanies,
    excluded_companies: excludedCompanies,
    existing_company_count: store.jobs.length,
    feedback
  });
  const entries: PassiveResearchDomainEntry[] = [
    {
      key: `topic:career-discovery-${slugResearchWatchKey(targetStartWindow)}`,
      kind: 'topic',
      source: 'career_profile',
      labels: [`${targetStartWindow} career discovery`],
      jobIds: [],
      urls: [],
      metadata: {
        ...sharedMetadata,
        discovery_scope: 'broad'
      }
    }
  ];

  for (const role of roles) {
    entries.push({
      key: `topic:career-discovery-${slugResearchWatchKey(targetStartWindow)}-${slugResearchWatchKey(role)}`,
      kind: 'topic',
      source: 'career_profile',
      labels: [`${targetStartWindow} ${role} roles`],
      jobIds: [],
      urls: [],
      metadata: {
        ...sharedMetadata,
        discovery_scope: 'role',
        role
      }
    });
  }

  entries.push(...careerDiscoveryLaneEntries(sharedMetadata, roles, targetStartWindow, intensity, entryLimit));
  entries.push(...careerDiscoveryPriorityCompanyEntries(sharedMetadata, priorityCompanies, targetStartWindow, intensity, entryLimit));

  if (intensity === 'max' && locations.length) {
    for (const role of roles) {
      for (const location of locations.slice(0, 6)) {
        entries.push({
          key: `topic:career-discovery-${slugResearchWatchKey(targetStartWindow)}-${slugResearchWatchKey(role)}-${slugResearchWatchKey(location)}`,
          kind: 'topic',
          source: 'career_profile',
          labels: [`${targetStartWindow} ${role} roles in ${location}`],
          jobIds: [],
          urls: [],
          metadata: {
            ...sharedMetadata,
            discovery_scope: 'role_location',
            role,
            location
          }
        });
      }
    }
  }

  return entries.slice(0, entryLimit);
}

function safeCareerResearchDomainEntries(
  store: MemoryStore,
  budget = resourceBudget(store.passiveSettings ?? defaultPassiveSettings())
): PassiveResearchDomainEntry[] {
  const limit = Math.max(budget.researchMonitorCreateLimit, budget.researchMonitorRunLimit);
  const byDomain = new Map<string, PassiveResearchDomainEntry>();
  for (const job of activeCareerResearchJobs(store)) {
    const domain = normalizeWatchedDomain(job.applicationUrl);
    if (!domain) continue;
    const label = `${job.company} - ${job.role}`;
    const existing =
      byDomain.get(domain) ??
      ({
        key: `domain:${domain}`,
        kind: 'domain',
        domain,
        source: 'career_job',
        labels: [],
        jobIds: [],
        urls: []
      } satisfies PassiveResearchDomainEntry);
    if (!existing.labels.includes(label)) existing.labels.push(label);
    if (!existing.jobIds.includes(job.id)) existing.jobIds.push(job.id);
    if (!existing.urls.includes(job.applicationUrl)) existing.urls.push(job.applicationUrl);
    byDomain.set(domain, existing);
    if (byDomain.size >= limit) break;
  }
  return Array.from(byDomain.values()).map((entry) => ({
    ...entry,
    labels: entry.labels.slice(0, 4),
    jobIds: entry.jobIds.slice(0, 8),
    urls: entry.urls.slice(0, 4)
  }));
}

function passiveResearchDomainEntries(
  store: MemoryStore,
  settings: PassiveEngineSettings,
  budget = resourceBudget(settings)
): PassiveResearchDomainEntry[] {
  const configuredEntries = safeConfiguredDomainEntries(settings, budget);
  const careerJobEntries = safeCareerResearchDomainEntries(store, budget);
  const careerProfileEntries = careerDiscoveryProfileEntries(store, budget);
  const limit = Math.max(
    budget.researchMonitorCreateLimit,
    budget.researchMonitorRunLimit,
    configuredEntries.length + careerJobEntries.length + careerProfileEntries.length
  );
  const byKey = new Map<string, PassiveResearchDomainEntry>();
  for (const entry of [...configuredEntries, ...careerJobEntries, ...careerProfileEntries]) {
    const existing = byKey.get(entry.key);
    if (!existing) {
      byKey.set(entry.key, entry);
      continue;
    }
    byKey.set(entry.key, {
      key: entry.key,
      kind: existing.kind,
      ...(existing.domain ?? entry.domain ? { domain: existing.domain ?? entry.domain } : {}),
      source: existing.source === 'settings' || entry.source === 'settings' ? 'settings' : entry.source,
      labels: Array.from(new Set([...existing.labels, ...entry.labels])).slice(0, 4),
      jobIds: Array.from(new Set([...existing.jobIds, ...entry.jobIds])).slice(0, 8),
      urls: Array.from(new Set([...existing.urls, ...entry.urls])).slice(0, 4),
      metadata: compactRecord({
        ...(existing.metadata ?? {}),
        ...(entry.metadata ?? {})
      })
    });
  }
  return Array.from(byKey.values()).slice(0, limit);
}

function researchDomainMetadata(entries: PassiveResearchDomainEntry[]): Record<string, unknown> {
  const domainEntries = entries.filter((entry): entry is PassiveResearchDomainEntry & { domain: string } => Boolean(entry.domain));
  const nonDomainEntries = entries.filter((entry) => !entry.domain || entry.kind !== 'domain');
  return {
    watchedDomains: Array.from(new Set(domainEntries.map((entry) => entry.domain))),
    watchedDomainSources: Object.fromEntries(domainEntries.map((entry) => [entry.domain, entry.source])),
    careerJobDomains: Array.from(new Set(domainEntries.filter((entry) => entry.source === 'career_job').map((entry) => entry.domain))),
    watchedResearchEntries: entries.map((entry) =>
      compactRecord({
        key: entry.key,
        kind: entry.kind,
        label: entry.labels[0] ?? entry.domain ?? entry.key,
        domain: entry.domain,
        source: entry.source,
        url: entry.urls[0]
      })
    ),
    watchedTopics: nonDomainEntries.filter((entry) => entry.kind === 'topic').map((entry) => entry.labels[0] ?? entry.key),
    careerDiscoveryTopics: nonDomainEntries
      .filter((entry) => entry.source === 'career_profile')
      .map((entry) => entry.labels[0] ?? entry.key),
    watchedTools: nonDomainEntries.filter((entry) => entry.kind === 'tool').map((entry) => entry.labels[0] ?? entry.key),
    watchedCompanies: nonDomainEntries.filter((entry) => entry.kind === 'company').map((entry) => entry.labels[0] ?? entry.key),
    watchedPages: nonDomainEntries.filter((entry) => entry.kind === 'page').map((entry) => entry.urls[0]).filter(Boolean)
  };
}

function careerDiscoverySourceDetails(
  store: MemoryStore,
  settings: PassiveEngineSettings,
  run: PassiveRun | undefined
): Record<string, unknown> {
  const configured = careerDiscoveryProfileConfigured(store);
  const profile = careerDiscoveryPreference(store);
  const enabled = careerDiscoveryEnabled(store);
  const maxPowerSearch = careerDiscoveryMaxPowerSearchEnabled(store);
  const entries = enabled ? careerDiscoveryProfileEntries(store, researchMonitorBudget(settings, store)) : [];
  const topics = entries.filter((entry) => entry.kind === 'topic');
  const companies = entries.filter((entry) => entry.kind === 'company');
  const lanes = entries.filter((entry) => entry.metadata?.discovery_scope === 'source_lane');
  const recentResearch = isRecord(run?.metadata.recentResearch) ? run.metadata.recentResearch : {};
  const setupReason = !configured
    ? 'No saved Career Discovery profile. Use Career Desk Max Scout to create broad new-role monitors.'
    : !enabled
      ? 'Career Discovery profile is saved but disabled.'
      : !entries.length
        ? 'Career Discovery profile is enabled, but no target roles produced monitors.'
        : undefined;
  return compactRecord({
    careerDiscoveryConfigured: configured,
    careerDiscoveryEnabled: enabled,
    careerDiscoveryNeedsSetup: !configured,
    careerDiscoverySetupReason: setupReason,
    careerDiscoveryResearchIntensity: configured ? careerDiscoveryIntensity(profile) : undefined,
    careerDiscoveryMaxPowerSearch: configured ? maxPowerSearch : false,
    careerDiscoveryMaxPowerIntervalMinutes: maxPowerSearch ? careerDiscoveryMaxPowerIntervalMinutes : undefined,
    careerDiscoveryTargetStartWindow: configured
      ? textValue(profile.targetStartWindow) || 'May 2027 / Summer 2027 start'
      : undefined,
    careerDiscoveryTargetRoles: configured ? careerDiscoveryRoleSeeds(store, profile, 12) : undefined,
    careerDiscoveryLocations: configured ? compactTextList(profile.locations, 8) : undefined,
    careerDiscoveryPriorityCompanies: configured ? careerDiscoveryPriorityCompanies(profile, 10) : undefined,
    careerDiscoveryActiveTopicCount: topics.length,
    careerDiscoveryActiveCompanyCount: companies.length,
    careerDiscoveryActiveSourceLaneCount: lanes.length,
    careerDiscoveryTopics: topics.slice(0, 16).map((entry) => entry.labels[0] ?? entry.key),
    careerDiscoveryCompanies: companies.slice(0, 10).map((entry) => entry.labels[0] ?? entry.key),
    careerDiscoverySourceLanes: lanes.slice(0, 12).map((entry) => entry.labels[0] ?? entry.key),
    importedCareerLeads: recentResearch.importedCareerLeads,
    skippedCareerLeadCandidates: recentResearch.skippedCareerLeadCandidates,
    skippedCareerLeadReasons: recentResearch.skippedCareerLeadReasons,
    careerDiscoveryFilterMemorySize: recentResearch.careerDiscoveryFilterMemorySize,
    careerSeenLeadRegistrySize: recentResearch.careerSeenLeadRegistrySize
  });
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
  persistPassiveTasks(store);
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

function computeNextRunAtForStore(store: MemoryStore, task: PassiveTask, date = new Date()): string | undefined {
  if (task.family === 'research_monitor' && careerDiscoveryMaxPowerSearchEnabled(store)) {
    if (task.status === 'cancelled') return undefined;
    if (task.status === 'paused') return task.nextRunAt;
    if (task.trigger.kind === 'event' || task.trigger.kind === 'manual') return undefined;
    return addMinutes(date, careerDiscoveryMaxPowerIntervalMinutes);
  }
  return computeNextRunAt(task, date);
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

function nextRunAfterResultForStore(store: MemoryStore, task: PassiveTask, status: PassiveRunStatus, date: Date): string | undefined {
  if (status === 'cancelled') return undefined;
  if (status === 'failed' || status === 'blocked') {
    return retryScheduleFor(task, task.retry.attempts + 1, date).nextRetryAt;
  }
  return computeNextRunAtForStore(store, task, date);
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
  const policyContext = passiveModePolicyContext(store, date, input);
  if (!store.passiveSettings?.enabled) return [];
  if (store.passiveSettings.idleOnly && !input.idle && !eventName) return [];
  return store.passiveTasks
    .filter((task) => ['active', 'failed'].includes(task.status))
    .filter((task) => watcherEnabled(store, task))
    .filter((task) => !task.idleOnly || Boolean(input.idle))
    .filter((task) => (eventName ? taskMatchesEvent(task, eventName) : task.trigger.kind !== 'event'))
    .map((task) => ({ task, policy: passiveModePolicy(task, mode, policyContext) }))
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
  timeoutMs = env.actionLedgerFederationTimeoutMs
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

async function fetchReachabilityWithTimeout(
  fetchImpl: FetchLike,
  url: URL,
  label: string,
  timeoutMs = Math.min(env.actionLedgerFederationTimeoutMs, 6000)
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const checkedAt = nowIso();
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: {
        accept: 'text/html,application/json;q=0.9,*/*;q=0.8'
      }
    });
    const contentType = response.headers.get('content-type') ?? undefined;
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return compactRecord({
        ok: false,
        url: url.toString(),
        checkedAt,
        status: response.status,
        statusText: response.statusText || undefined,
        contentType,
        error: `${label} returned ${response.status}: ${text.slice(0, 180) || response.statusText}`
      });
    }
    return compactRecord({
      ok: true,
      url: url.toString(),
      checkedAt,
      status: response.status,
      statusText: response.statusText || undefined,
      contentType
    });
  } catch (error) {
    return {
      ok: false,
      url: url.toString(),
      checkedAt,
      error: describeError(error)
    };
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
    (mode === 'beast' || mode === 'auto') && !highPressure && route?.local === true && provider
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
  const serviceChecks: Record<string, Record<string, unknown>> = {};
  const miniHubSnapshotHealth = latestMiniHubSnapshotHealth();
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
  if (miniHubSnapshotHealth.snapshotCount === 0) {
    cards.push(
      serviceIssueCard(
        task,
        runId,
        'Mini Hub has no local restore snapshot',
        miniHubSnapshotHealth.error ?? 'No Mini Hub restore snapshots were found.',
        68,
        stableSourceRef('file', 'Mini Hub restore snapshots', {
          id: 'mini-hub-restore-snapshots',
          route: routeMap.settings,
          filePath: miniHubSnapshotHealth.snapshotRoot,
          metadata: { snapshotHealth: miniHubSnapshotHealth }
        })
      )
    );
  } else if (miniHubSnapshotHealth.verification?.ok === false) {
    cards.push(
      serviceIssueCard(
        task,
        runId,
        'Latest Mini Hub restore snapshot did not verify',
        miniHubSnapshotHealth.error ?? 'The newest Mini Hub restore snapshot could not be read back safely.',
        84,
        stableSourceRef('file', 'Mini Hub restore snapshot', {
          id: miniHubSnapshotHealth.latestPath ?? 'latest-mini-hub-restore-snapshot',
          route: routeMap.settings,
          filePath: miniHubSnapshotHealth.latestPath ?? miniHubSnapshotHealth.snapshotRoot,
          metadata: { snapshotHealth: miniHubSnapshotHealth }
        })
      )
    );
  } else if (miniHubSnapshotHealth.stale === true) {
    cards.push(
      serviceIssueCard(
        task,
        runId,
        'Mini Hub restore snapshot is stale',
        miniHubSnapshotHealth.error ?? 'The newest Mini Hub restore snapshot is older than the passive backup freshness window.',
        72,
        stableSourceRef('file', 'Mini Hub restore snapshot', {
          id: miniHubSnapshotHealth.latestPath ?? 'latest-mini-hub-restore-snapshot',
          route: routeMap.settings,
          filePath: miniHubSnapshotHealth.latestPath ?? miniHubSnapshotHealth.snapshotRoot,
          metadata: { snapshotHealth: miniHubSnapshotHealth }
        })
      )
    );
  }

  try {
    const hubUrl = new URL(env.hubPublicUrl);
    const hubCheck = await fetchReachabilityWithTimeout(fetchImpl, hubUrl, 'Mini Hub public page');
    serviceChecks.hub = hubCheck;
    if (hubCheck.ok !== true) {
      cards.push(
        serviceIssueCard(
          task,
          runId,
          'Mini Hub public page is unavailable',
          optionalString(hubCheck.error) ?? 'The configured Mini Hub public page did not respond successfully.',
          76,
          stableSourceRef('service', 'Mini Hub public page', {
            id: 'mini-hub-public-page',
            route: routeMap.settings,
            url: env.hubPublicUrl,
            metadata: { ...endpoints.hub, check: hubCheck }
          })
        )
      );
    }
  } catch (error) {
    const hubCheck = {
      ok: false,
      url: env.hubPublicUrl,
      checkedAt: nowIso(),
      error: `Invalid Mini Hub public URL: ${describeError(error)}`
    };
    serviceChecks.hub = hubCheck;
    cards.push(
      serviceIssueCard(
        task,
        runId,
        'Mini Hub public page is unavailable',
        hubCheck.error,
        76,
        stableSourceRef('service', 'Mini Hub public page', {
          id: 'mini-hub-public-page',
          route: routeMap.settings,
          url: env.hubPublicUrl,
          metadata: { ...endpoints.hub, check: hubCheck }
        })
      )
    );
  }

  const miniHubApiHealthUrl = new URL('/api/health', `http://127.0.0.1:${env.port}`);
  const miniHubApiCheck = await fetchReachabilityWithTimeout(fetchImpl, miniHubApiHealthUrl, 'Mini Hub API health', 1600);
  serviceChecks.miniHubApi = miniHubApiCheck;
  if (miniHubApiCheck.ok !== true) {
    cards.push(
      serviceIssueCard(
        task,
        runId,
        'Mini Hub API health check failed',
        optionalString(miniHubApiCheck.error) ?? 'The local Mini Hub API health endpoint did not respond successfully.',
        88,
        stableSourceRef('service', 'Mini Hub API health', {
          id: 'mini-hub-api-health',
          route: routeMap.settings,
          url: miniHubApiHealthUrl.toString(),
          metadata: { ...endpoints.miniHubApi, check: miniHubApiCheck }
        })
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
        summary: 'Mini Hub public page, API health, data directory, and local service checks did not surface blockers.',
        urgency: 22,
        confidence: 0.82,
        route: routeMap.settings,
        sourceRefs: [
          stableSourceRef('service', 'Mini Hub public page', {
            id: 'mini-hub-public-page',
            route: routeMap.settings,
            url: env.hubPublicUrl,
            metadata: { ...endpoints.hub, check: serviceChecks.hub }
          }),
          stableSourceRef('service', 'Mini Hub API', {
            id: 'mini-hub-api',
            route: routeMap.settings,
            url: miniHubApiHealthUrl.toString(),
            metadata: { ...endpoints.miniHubApi, check: serviceChecks.miniHubApi }
          }),
          stableSourceRef('file', 'Mini Hub restore snapshot', {
            id: miniHubSnapshotHealth.latestPath ?? 'mini-hub-restore-snapshots',
            route: routeMap.settings,
            filePath: miniHubSnapshotHealth.latestPath ?? miniHubSnapshotHealth.snapshotRoot,
            metadata: { snapshotHealth: miniHubSnapshotHealth }
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
      serviceChecks,
      miniHubSnapshotHealth,
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

function latestMiniHubSnapshotHealth(date = new Date()): MiniHubSnapshotHealth {
  const snapshotRoot = join(resolve(env.dataDir), passiveSnapshotDirName);
  if (!existsSync(snapshotRoot)) {
    return {
      ok: false,
      snapshotRoot,
      snapshotCount: 0,
      error: 'Mini Hub restore snapshot directory does not exist yet.'
    };
  }

  try {
    const snapshots = readdirSync(snapshotRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => join(snapshotRoot, entry.name))
      .map((path) => ({ path, stats: statSync(path) }))
      .sort((a, b) => b.stats.mtimeMs - a.stats.mtimeMs);
    const latest = snapshots[0];
    if (!latest) {
      return {
        ok: false,
        snapshotRoot,
        snapshotCount: 0,
        error: 'Mini Hub restore snapshot directory has no JSON restore points.'
      };
    }
    const verification = verifyMiniHubSnapshotFile(latest.path);
    const latestAgeHours = Math.max(0, Math.round(((date.getTime() - latest.stats.mtimeMs) / hourMs) * 10) / 10);
    const stale = latest.stats.mtimeMs < date.getTime() - 3 * dayMs;
    return {
      ok: verification.ok && !stale,
      snapshotRoot,
      snapshotCount: snapshots.length,
      latestPath: latest.path,
      latestAgeHours,
      stale,
      verification,
      ...(!verification.ok ? { error: verification.error ?? 'Latest Mini Hub restore snapshot did not verify.' } : {}),
      ...(verification.ok && stale ? { error: `Latest Mini Hub restore snapshot is ${latestAgeHours} hours old.` } : {})
    };
  } catch (error) {
    return {
      ok: false,
      snapshotRoot,
      snapshotCount: 0,
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

function buildPassiveBackupHealth(date = new Date()): PassiveBackupHealth {
  const latest = latestMiniHubSnapshotHealth(date);
  const cleanupCandidates = planMiniHubCleanup(date);
  const cleanupBytes = cleanupCandidates.reduce((total, item) => total + item.size, 0);
  const verification = latest.verification;
  const hasValidSnapshot = latest.snapshotCount > 0 && verification?.ok === true;
  const status: PassiveBackupHealth['status'] = !hasValidSnapshot
    ? 'error'
    : latest.stale === true || cleanupCandidates.length > 0
      ? 'warning'
      : 'ok';
  return passiveBackupHealthSchema.parse({
    checkedAt: date.toISOString(),
    ok: latest.ok,
    status,
    snapshotRoot: latest.snapshotRoot,
    snapshotCount: latest.snapshotCount,
    latestPath: latest.latestPath,
    latestAgeHours: latest.latestAgeHours,
    stale: latest.stale === true,
    latestBytes: verification?.bytes,
    latestSha256: verification?.sha256,
    latestSummary: verification?.summary ?? {},
    latestRedactedTokenSets: verification?.redactedTokenSets ?? 0,
    cleanupCandidateCount: cleanupCandidates.length,
    cleanupBytes,
    error: latest.error
  });
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

function passiveResearchWatchLabel(entry: PassiveResearchDomainEntry): string {
  return entry.labels[0] ?? entry.domain ?? entry.key.replace(/^[^:]+:/u, '');
}

function passiveResearchWatchName(entry: PassiveResearchDomainEntry): string {
  const label = passiveResearchWatchLabel(entry);
  if (entry.source === 'career_job' && entry.domain) return `Passive career watch: ${entry.domain}`;
  if (entry.source === 'career_profile') return `Passive career discovery: ${label}`;
  if (entry.kind === 'domain' && entry.domain) return `Passive watch: ${entry.domain}`;
  if (entry.kind === 'page') return `Passive page watch: ${label}`;
  if (entry.kind === 'tool') return `Passive tool watch: ${label}`;
  if (entry.kind === 'company') return `Passive company watch: ${label}`;
  return `Passive topic watch: ${label}`;
}

function passiveResearchWatchGoal(entry: PassiveResearchDomainEntry): string {
  const label = passiveResearchWatchLabel(entry);
  const labelText = entry.labels.length ? ` Sources: ${entry.labels.join('; ')}.` : '';
  if (entry.source === 'career_profile') {
    const metadata = entry.metadata ?? {};
    const startWindow = typeof metadata.target_start_window === 'string' ? metadata.target_start_window : 'May 2027 / Summer 2027 start';
    const roles = compactTextList(metadata.target_roles, 8);
    const locations = compactTextList(metadata.locations, 8);
    const excludedCompanies = compactTextList(metadata.excluded_companies, 24);
    const intensity = typeof metadata.research_intensity === 'string' ? metadata.research_intensity : 'focused';
    const background = typeof metadata.profile_background === 'string' ? metadata.profile_background : '';
    const graduationStatus = typeof metadata.graduation_status === 'string' ? metadata.graduation_status : '';
    const feedback = isRecord(metadata.feedback) ? metadata.feedback : {};
    const preferredRoleTerms = compactTextList(feedback.preferred_role_terms, 12);
    const avoidedRoleTerms = compactTextList(feedback.avoided_role_terms, 12);
    const sourceLaneLabel = typeof metadata.source_lane_label === 'string' ? metadata.source_lane_label : '';
    const sourceLaneInstruction = typeof metadata.source_lane_instruction === 'string' ? metadata.source_lane_instruction : '';
    const priorityCompany = typeof metadata.priority_company === 'string' ? metadata.priority_company : '';
    return [
      `Find source-backed career opportunities for ${label}.`,
      `Only prioritize roles that explicitly fit a ${startWindow} timeline, new-grad, early-career, analyst, internship, rotational, or upcoming-graduate style eligibility.`,
      `Research intensity: ${intensity}; prefer breadth only when each result still passes the fit and novelty filters.`,
      sourceLaneLabel ? `This monitor is a source lane for ${sourceLaneLabel}.` : '',
      sourceLaneInstruction ? `Source lane instruction: ${sourceLaneInstruction}` : '',
      priorityCompany
        ? `Priority company focus: search ${priorityCompany} official career pages, ATS postings, student programs, and new-cycle roles; reject exact duplicate company-role matches already tracked.`
        : '',
      roles.length ? `Target role families: ${roles.join('; ')}.` : '',
      locations.length ? `Preferred locations/work modes: ${locations.join('; ')}.` : '',
      background ? `Candidate background filter: ${background}.` : '',
      graduationStatus ? `Current school/work status: ${graduationStatus}.` : '',
      'Hard profile guardrail: reject roles whose source-local graduation year, class year, start date, or eligibility conflicts with the May/Summer 2027 profile; reject senior-only, 3+ years professional experience, PhD-only, MBA-only, and undergraduate-only listings unless the source explicitly fits the saved status.',
      preferredRoleTerms.length ? `Career Desk feedback prefers role signals: ${preferredRoleTerms.join('; ')}.` : '',
      avoidedRoleTerms.length ? `Career Desk not-fit feedback should de-prioritize role signals: ${avoidedRoleTerms.join('; ')}.` : '',
      excludedCompanies.length
        ? `Avoid duplicates and low-value repeats from already tracked or excluded companies: ${excludedCompanies.join('; ')}.`
        : '',
      'Reject senior-only, already-closed, vague, or unsourced listings. Rank findings by fit, start-date match, source quality, and novelty. Summarize only source-backed roles with links.'
    ]
      .filter(Boolean)
      .join(' ');
  }
  if (entry.source === 'career_job' && entry.domain) {
    return `Monitor ${entry.domain} for meaningful career/company changes relevant to saved Career Desk targets.${labelText} Summarize only source-backed changes.`;
  }
  if (entry.kind === 'domain' && entry.domain) {
    return `Monitor ${entry.domain} for meaningful changes, new posts, product/company updates, deadlines, or technical notes relevant to my Mini Hub watch list. Summarize only source-backed changes.`;
  }
  if (entry.kind === 'page') {
    return `Monitor this saved page for meaningful changes relevant to my Mini Hub watch list: ${label}. Summarize only source-backed changes.`;
  }
  if (entry.kind === 'tool') {
    return `Monitor meaningful updates about this saved tool: ${label}. Focus on releases, docs, pricing, API changes, reliability notes, and source-backed technical changes.`;
  }
  if (entry.kind === 'company') {
    return `Monitor meaningful updates about this saved company: ${label}. Focus on product, hiring, funding, leadership, deadlines, and source-backed changes.`;
  }
  return `Monitor meaningful source-backed updates about this saved topic: ${label}.`;
}

function passiveResearchWatchMetadata(entry: PassiveResearchDomainEntry): Record<string, unknown> {
  return compactRecord({
    source: 'mini-hub-passive',
    passive_watch_key: entry.key,
    passive_watch_kind: entry.kind,
    passive_watch_label: passiveResearchWatchLabel(entry),
    watched_domain: entry.domain,
    watched_domain_source: entry.domain ? entry.source : undefined,
    created_by_task: 'research_monitor',
    source_labels: entry.labels,
    source_job_ids: entry.jobIds,
    ...(entry.metadata ?? {})
  });
}

function existingResearchWatchKey(monitor: Record<string, unknown>): string | undefined {
  const metadata = isRecord(monitor.metadata) ? monitor.metadata : {};
  if (typeof metadata.passive_watch_key === 'string' && metadata.passive_watch_key.trim()) return metadata.passive_watch_key;
  if (typeof metadata.watched_domain === 'string' && metadata.watched_domain.trim()) return `domain:${metadata.watched_domain.trim().toLowerCase()}`;
  return undefined;
}

async function ensureWatchedDomainResearchMonitors(
  settings: PassiveEngineSettings,
  domainEntries: PassiveResearchDomainEntry[],
  fetchImpl: FetchLike
): Promise<Record<string, unknown>[]> {
  const budget = resourceBudget(settings);
  if (!domainEntries.length) return [];

  const payload = await fetchJsonWithTimeout(
    fetchImpl,
    new URL('/api/ai/research/monitors?limit=50', env.aiOsApiUrl),
    'Research monitors'
  );
  const existing = isRecord(payload) && Array.isArray(payload.monitors) ? payload.monitors.filter(isRecord) : [];
  const covered = new Set(existing.map(existingResearchWatchKey).filter((value): value is string => typeof value === 'string'));

  const created: Record<string, unknown>[] = [];
  for (const entry of domainEntries.filter((item) => !covered.has(item.key))) {
    const seedUrls = entry.urls.length ? entry.urls : entry.domain ? [`https://${entry.domain}/`] : [];
    const metadata = passiveResearchWatchMetadata(entry);
    const createPayload = await fetchJsonWithTimeout(
      fetchImpl,
      new URL('/api/ai/research/monitors', env.aiOsApiUrl),
      'Create research monitor',
      {
        method: 'POST',
        body: JSON.stringify({
          name: passiveResearchWatchName(entry),
          enabled: true,
          schedule: 'daily',
          request: {
            mode: 'monitor_topic',
            goal: passiveResearchWatchGoal(entry),
            seed_urls: seedUrls,
            depth: 1,
            max_pages: budget.researchMaxPages,
            per_domain_limit: budget.researchPerDomainLimit,
            time_budget_s: budget.researchTimeBudgetSeconds,
            include_domains: entry.domain ? [entry.domain] : [],
            exclude_domains: [],
            use_ai: settings.localAiPreference !== 'local_only',
            use_cloud_ai: settings.localAiPreference === 'cloud_allowed',
            local_first: true,
            screenshot: false,
            save_to_memory: false,
            metadata
          },
          metadata
        })
      },
      10000
    );
    const monitor = isRecord(createPayload) && isRecord(createPayload.monitor) ? createPayload.monitor : metadata;
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

interface CareerLeadCandidate {
  company: string;
  role: string;
  applicationUrl: string;
  fitScore: number;
  notes: string;
  source: Record<string, unknown>;
  evidence: string[];
  quality: CareerLeadQualitySignals;
}

interface CareerLeadQualitySignals {
  sourceQuality: 'direct-career-page' | 'ats-posting' | 'job-board' | 'unclear';
  sourceQualityEvidence: string;
  timingConfidence: 'high' | 'medium' | 'low';
  timingEvidence: string;
  profileFitConfidence: 'high' | 'medium' | 'low';
  profileFitEvidence: string;
  profileRejectReason?: 'graduation-year-mismatch' | 'start-date-mismatch' | 'qualification-mismatch' | 'weak-profile-fit';
  deadlineConfidence: 'high' | 'medium' | 'unknown';
  deadlineEvidence: string;
  duplicateStatus: string;
  postingDate?: string;
}

interface CareerLeadFilteredCandidate {
  candidate: CareerLeadCandidate;
  reason: string;
}

interface CareerDiscoveryFilterMemoryEntry {
  fingerprint: string;
  reason: string;
  company: string;
  role: string;
  applicationUrl: string;
  sourceTitle?: string;
  fitScore?: number;
  evidence: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  seenCount: number;
}

interface CareerLeadImportResult {
  createdJobs: JobRecord[];
  skipped: number;
  skippedReasons: Record<string, number>;
  rememberedFilters: number;
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function sourceMetadata(source: Record<string, unknown>): Record<string, unknown> {
  return isRecord(source.metadata) ? source.metadata : {};
}

function sourceField(source: Record<string, unknown>, keys: string[]): string {
  const metadata = sourceMetadata(source);
  for (const key of keys) {
    const direct = textValue(source[key]);
    if (direct) return direct;
    const nested = textValue(metadata[key]);
    if (nested) return nested;
  }
  return '';
}

function sourceUrl(source: Record<string, unknown>): string {
  return sourceField(source, ['canonical_url', 'url', 'href', 'link', 'application_url', 'applicationUrl']);
}

function sourceTitle(source: Record<string, unknown>): string {
  return sourceField(source, ['title', 'name', 'headline']);
}

function reportTextParts(report: Record<string, unknown>): string[] {
  return [
    textValue(report.title),
    textValue(report.tldr),
    textValue(report.detailed_summary),
    ...stringList(report.key_facts, 8),
    ...stringList(report.next_research_suggestions, 4)
  ].filter(Boolean);
}

function sourceText(source: Record<string, unknown>, report: Record<string, unknown>): string {
  const metadata = sourceMetadata(source);
  return [
    sourceTitle(source),
    sourceField(source, ['description', 'snippet', 'summary', 'text']),
    sourceUrl(source),
    ...[
      'company',
      'employer',
      'organization',
      'role',
      'job_title',
      'jobTitle',
      'location',
      'start_date',
      'startDate',
      'eligibility',
      'qualifications',
      'requirements',
      'graduation_year',
      'graduationYear',
      'class_year',
      'classYear'
    ].map((key) => textValue(metadata[key])),
    ...reportTextParts(report)
  ]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function normalizeDedupeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, ' ').trim();
}

function normalizeCompanyKey(value: string): string {
  return normalizeDedupeText(value)
    .replace(/\b(inc|llc|ltd|corp|corporation|company|co|careers|jobs)\b/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function canonicalUrlKey(value: string): string {
  try {
    const url = new URL(value);
    url.hash = '';
    url.search = '';
    return url.toString().replace(/\/$/u, '').toLowerCase();
  } catch {
    return value.trim().toLowerCase();
  }
}

function careerLeadCandidateFingerprint(candidate: Pick<CareerLeadCandidate, 'company' | 'role' | 'applicationUrl'>): string {
  const urlKey = candidate.applicationUrl ? canonicalUrlKey(candidate.applicationUrl) : '';
  if (urlKey) return `url:${urlKey}`;
  return `company-role:${normalizeCompanyKey(candidate.company)}|${normalizeDedupeText(candidate.role)}`;
}

function careerDiscoveryFilterMemory(store: MemoryStore): CareerDiscoveryFilterMemoryEntry[] {
  const raw = store.settings?.preferences.careerDiscoveryMemory;
  const entries = isRecord(raw) && Array.isArray(raw.rejectedCandidates) ? raw.rejectedCandidates : [];
  return entries
    .filter(isRecord)
    .map((entry): CareerDiscoveryFilterMemoryEntry | null => {
      const fingerprint = textValue(entry.fingerprint);
      const company = textValue(entry.company);
      const role = textValue(entry.role);
      const applicationUrl = textValue(entry.applicationUrl);
      const reason = textValue(entry.reason) || 'filtered';
      const firstSeenAt = textValue(entry.firstSeenAt);
      const lastSeenAt = textValue(entry.lastSeenAt);
      const seenCount = Number(entry.seenCount);
      const fitScore = Number(entry.fitScore);
      if (!fingerprint || !company || !role || !applicationUrl) return null;
      const parsed: CareerDiscoveryFilterMemoryEntry = {
        fingerprint,
        reason,
        company,
        role,
        applicationUrl,
        evidence: compactTextList(entry.evidence, 8),
        firstSeenAt: firstSeenAt || lastSeenAt || new Date(0).toISOString(),
        lastSeenAt: lastSeenAt || firstSeenAt || new Date(0).toISOString(),
        seenCount: Number.isFinite(seenCount) ? Math.max(1, Math.trunc(seenCount)) : 1
      };
      const title = textValue(entry.sourceTitle);
      if (title) parsed.sourceTitle = title;
      if (Number.isFinite(fitScore)) parsed.fitScore = fitScore;
      return parsed;
    })
    .filter((entry): entry is CareerDiscoveryFilterMemoryEntry => Boolean(entry));
}

function careerLeadPreviouslyFilteredReason(
  candidate: CareerLeadCandidate,
  memoryFingerprints: Set<string>,
  reconsiderScore = 86
): string | null {
  if (candidate.fitScore >= reconsiderScore) return null;
  return memoryFingerprints.has(careerLeadCandidateFingerprint(candidate)) ? 'previously-filtered' : null;
}

function shouldRememberCareerLeadFilter(reason: string): boolean {
  return [
    'low-fit-score',
    'excluded-company',
    'previously-filtered',
    'low-timing-confidence',
    'job-board-mirror',
    'unclear-source',
    'graduation-year-mismatch',
    'start-date-mismatch',
    'qualification-mismatch',
    'weak-profile-fit'
  ].includes(reason);
}

function upsertCareerDiscoveryFilterMemory(
  store: MemoryStore,
  filtered: CareerLeadFilteredCandidate[],
  passiveRunId: string,
  date = new Date()
): number {
  const memorable = filtered.filter((item) => shouldRememberCareerLeadFilter(item.reason));
  if (!memorable.length) return 0;
  const now = nowIso(date);
  const before = store.settings ? personalSettingsSchema.parse(store.settings) : null;
  const base = before
    ? before
    : personalSettingsSchema.parse({
        workspaceId: personalWorkspaceId,
        highScores: {},
        recentState: {},
        preferences: {},
        deviceId: 'passive-engine',
        updatedAt: now
      });
  const existingMemory = careerDiscoveryFilterMemory({ ...store, settings: base });
  const byFingerprint = new Map(existingMemory.map((entry) => [entry.fingerprint, entry]));
  for (const item of memorable) {
    const fingerprint = careerLeadCandidateFingerprint(item.candidate);
    const existing = byFingerprint.get(fingerprint);
    const updatedEntry: CareerDiscoveryFilterMemoryEntry = {
      fingerprint,
      reason: item.reason,
      company: item.candidate.company,
      role: item.candidate.role,
      applicationUrl: item.candidate.applicationUrl,
      evidence: item.candidate.evidence.slice(0, 8),
      firstSeenAt: existing?.firstSeenAt ?? now,
      lastSeenAt: now,
      seenCount: (existing?.seenCount ?? 0) + 1
    };
    const title = sourceTitle(item.candidate.source) || existing?.sourceTitle;
    if (title) updatedEntry.sourceTitle = title;
    if (Number.isFinite(item.candidate.fitScore)) updatedEntry.fitScore = item.candidate.fitScore;
    byFingerprint.set(fingerprint, updatedEntry);
  }
  const rejectedCandidates = Array.from(byFingerprint.values())
    .sort((left, right) => parseTime(right.lastSeenAt) - parseTime(left.lastSeenAt))
    .slice(0, 120);
  const settings = personalSettingsSchema.parse({
    ...base,
    preferences: {
      ...base.preferences,
      careerDiscoveryMemory: {
        rejectedCandidates,
        updatedAt: now,
        passiveRunId,
        limit: 120
      }
    },
    deviceId: 'passive-engine',
    updatedAt: now
  });
  store.settings = settings;
  appendSyncEvent(store, {
    workspaceId: settings.workspaceId,
    entityType: 'settings',
    entityId: settings.workspaceId,
    operation: 'update',
    payload: before ? withBeforeSnapshot(settings, before, 'passive-career-discovery-filter-memory') : settings,
    deviceId: settings.deviceId
  });
  return memorable.length;
}

function hostCompanyHint(value: string): string {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./u, '');
    const pathHead = url.pathname.split('/').map((part) => part.trim()).filter(Boolean)[0] ?? '';
    if (/greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|workdayjobs\.com|smartrecruiters\.com/iu.test(host) && pathHead) {
      return pathHead.replace(/[-_]+/gu, ' ');
    }
    const parts = host.split('.').filter(Boolean);
    const company = parts.length > 2 ? parts[parts.length - 3] : parts[0];
    return company ? company.replace(/[-_]+/gu, ' ') : '';
  } catch {
    return '';
  }
}

function looksLikeRoleText(value: string, targetRoles: string[] = []): boolean {
  const text = value.toLowerCase();
  return (
    targetRoles.some((role) => role && text.includes(role.toLowerCase())) ||
    /\b(analyst|engineer|developer|researcher|research|quant|data|machine learning|ai|software|product|intern|internship|associate|rotational|new grad|graduate)\b/iu.test(
      text
    )
  );
}

function parseCompanyRoleFromSource(source: Record<string, unknown>, metadata: Record<string, unknown>): { company: string; role: string } {
  const title = sourceTitle(source);
  const targetRoles = compactTextList(metadata.target_roles, 12);
  const explicitCompany = sourceField(source, ['company', 'employer', 'organization', 'org']);
  const explicitRole = sourceField(source, ['role', 'job_title', 'jobTitle', 'position']);
  let company = explicitCompany;
  let role = explicitRole;
  const atMatch = title.match(/^\s*(.+?)\s+(?:at|@)\s+(.+?)(?:\s+[-|–]\s+|$)/iu);
  if (!role && atMatch?.[1]) role = atMatch[1].trim();
  if (!company && atMatch?.[2]) company = atMatch[2].trim();
  if ((!role || !company) && title.includes(' - ')) {
    const [left = '', right = ''] = title.split(' - ').map((part) => part.trim());
    if (!role && looksLikeRoleText(left, targetRoles)) role = left;
    if (!company && looksLikeRoleText(left, targetRoles) && right) company = right;
    if (!company && !looksLikeRoleText(left, targetRoles)) company = left;
    if (!role && looksLikeRoleText(right, targetRoles)) role = right;
  }
  if (!role) {
    const matchedRole = targetRoles.find((item) => sourceText(source, { title }).toLowerCase().includes(item.toLowerCase()));
    role = matchedRole ?? title;
  }
  if (!company) company = hostCompanyHint(sourceUrl(source));
  return {
    company: truncateText(company.replace(/\s+/gu, ' ').trim(), 80),
    role: truncateText(role.replace(/\s+/gu, ' ').trim(), 120)
  };
}

function sourceHost(value: string): string {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./u, '');
  } catch {
    return '';
  }
}

function sourcePath(value: string): string {
  try {
    return new URL(value).pathname.toLowerCase();
  } catch {
    return '';
  }
}

function careerLeadSourceQuality(applicationUrl: string, company: string): Pick<CareerLeadQualitySignals, 'sourceQuality' | 'sourceQualityEvidence'> {
  const host = sourceHost(applicationUrl);
  const path = sourcePath(applicationUrl);
  const companyTokens = normalizeCompanyKey(company).split(/\s+/u).filter((token) => token.length >= 4);
  if (/\b(greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|workdayjobs\.com|smartrecruiters\.com|icims\.com|workable\.com|jobvite\.com|bamboohr\.com)\b/iu.test(host)) {
    return { sourceQuality: 'ats-posting', sourceQualityEvidence: `ATS posting on ${host}` };
  }
  if (/\b(linkedin\.com|indeed\.com|glassdoor\.com|builtin\.com|simplify\.jobs|handshake\.com|wayup\.com|ziprecruiter\.com)\b/iu.test(host)) {
    return { sourceQuality: 'job-board', sourceQualityEvidence: `job-board mirror on ${host}` };
  }
  if ((/\/(careers?|jobs?|openings?|roles?)\b/iu.test(path) || companyTokens.some((token) => host.includes(token))) && host) {
    return { sourceQuality: 'direct-career-page', sourceQualityEvidence: `direct employer/career source on ${host}` };
  }
  return { sourceQuality: 'unclear', sourceQualityEvidence: host ? `unclear source host ${host}` : 'source host unavailable' };
}

function careerLeadTimingSignal(
  sourceOnlyText: string,
  fullText: string,
  metadata: Record<string, unknown>
): Pick<CareerLeadQualitySignals, 'timingConfidence' | 'timingEvidence'> {
  const targetStartWindow = textValue(metadata.target_start_window) || 'May 2027 / Summer 2027 start';
  if (/\b(may\s*2027|summer\s*2027|class of 2027|2027\s+(?:start|intern|internship|graduate|new grad)|(?:start|starting)\s+(?:in\s+)?2027)\b/iu.test(sourceOnlyText)) {
    return { timingConfidence: 'high', timingEvidence: `source explicitly matches ${targetStartWindow}` };
  }
  if (/\b(new grad|new graduate|upcoming graduate|early career|entry[- ]level|internship|intern|rotational|analyst program)\b/iu.test(sourceOnlyText)) {
    return { timingConfidence: 'medium', timingEvidence: 'source has early-career or student eligibility language' };
  }
  if (/\b(may\s*2027|summer\s*2027|class of 2027|2027)\b/iu.test(fullText)) {
    return { timingConfidence: 'low', timingEvidence: `only surrounding research context mentions ${targetStartWindow}` };
  }
  return { timingConfidence: 'low', timingEvidence: 'no explicit May/Summer 2027 timing found in source text' };
}

function careerProfileTargetYears(metadata: Record<string, unknown>): number[] {
  const startText = textValue(metadata.target_start_window);
  const startYears = Array.from(startText.matchAll(/\b20\d{2}\b/gu))
    .map((match) => Number(match[0]))
    .filter((year) => Number.isFinite(year));
  if (startYears.length) return Array.from(new Set(startYears)).sort((left, right) => left - right);

  const statusText = textValue(metadata.graduation_status);
  const expectedYears = Array.from(
    statusText.matchAll(/\b(?:expected|target(?:ing)?|current|continuing|graduate|master'?s?|m\.s\.)\b.{0,80}?\b(20\d{2})\b/giu)
  )
    .map((match) => Number(match[1]))
    .filter((year) => Number.isFinite(year));
  if (expectedYears.length) return Array.from(new Set(expectedYears)).sort((left, right) => left - right);

  const years = Array.from(statusText.matchAll(/\b20\d{2}\b/gu))
    .map((match) => Number(match[0]))
    .filter((year) => Number.isFinite(year));
  return Array.from(new Set(years.length ? years : [2027])).sort((left, right) => left - right);
}

function findCareerProfileYearMismatch(text: string, targetYears: number[]): { year: number; kind: 'graduation' | 'start'; evidence: string } | null {
  const normalized = text.replace(/\s+/gu, ' ');
  const contextualYearPattern =
    /\b(?:(class of|graduat(?:e|ing|ion|es)|expected graduation|grad date|students? graduating|new grad|graduate program|analyst program|internship|intern|start(?:ing)? date|start(?:ing)?|summer|spring|fall|winter)\b.{0,90}?\b(20\d{2})\b|\b(20\d{2})\b.{0,90}?\b(class of|graduat(?:e|ing|ion|es)|new grad|graduate program|analyst program|internship|intern|start(?:ing)? date|start(?:ing)?|summer analyst|summer internship)\b)/giu;
  for (const match of normalized.matchAll(contextualYearPattern)) {
    const prefix = String(match[1] ?? match[4] ?? '').toLowerCase();
    const rawYear = match[2] ?? match[3];
    const year = Number(rawYear);
    if (!Number.isFinite(year) || targetYears.includes(year)) continue;
    const index = typeof match.index === 'number' ? match.index : 0;
    const snippet = normalized.slice(Math.max(0, index - 40), index + match[0].length + 40).trim();
    if (/\b(deadline|apply by|applications? (?:close|due)|posting|posted|published)\b/iu.test(snippet) && !/\b(class of|graduat|start|summer analyst|internship|new grad)\b/iu.test(snippet)) {
      continue;
    }
    const kind = /\b(class of|graduat|new grad|graduate)\b/iu.test(prefix) ? 'graduation' : 'start';
    return {
      year,
      kind,
      evidence: truncateText(snippet, 180)
    };
  }
  return null;
}

function careerProfileQualificationMismatch(text: string): string | null {
  const normalized = text.replace(/\s+/gu, ' ');
  const seniorMatch = normalized.match(/\b(?:senior|sr\.?|staff|principal|manager|director|head of|vp)\b.{0,80}\b(?:analyst|research|engineer|scientist|trader|developer|role|position)?\b/iu);
  if (seniorMatch?.[0]) return truncateText(seniorMatch[0], 180);
  const experienceMatch = normalized.match(/\b(?:[3-9]|1[0-9])\+?\s*(?:years|yrs)\s+(?:of\s+)?(?:professional\s+)?experience\b/iu);
  if (experienceMatch?.[0]) return truncateText(experienceMatch[0], 180);
  const credentialMatch = normalized.match(/\b(?:phd|ph\.d\.|doctorate|mba|cpa)\s+(?:required|is required|only)\b/iu);
  if (credentialMatch?.[0]) return truncateText(credentialMatch[0], 180);
  const studentLevelMatch = normalized.match(/\b(?:sophomore|rising junior|junior only|undergraduate students only|penultimate year students only)\b/iu);
  if (studentLevelMatch?.[0]) return truncateText(studentLevelMatch[0], 180);
  return null;
}

function careerLeadProfileFitSignal(
  sourceOnlyText: string,
  fullText: string,
  metadata: Record<string, unknown>
): Pick<CareerLeadQualitySignals, 'profileFitConfidence' | 'profileFitEvidence' | 'profileRejectReason'> {
  const targetYears = careerProfileTargetYears(metadata);
  const targetLine = targetYears.join('/');
  const sourceTextForRules = sourceOnlyText || fullText;
  const mismatch = findCareerProfileYearMismatch(sourceTextForRules, targetYears);
  if (mismatch) {
    return {
      profileFitConfidence: 'low',
      profileFitEvidence: `${mismatch.kind === 'graduation' ? 'graduation/class year' : 'start-date'} mismatch: found ${mismatch.year}, target ${targetLine}. ${mismatch.evidence}`,
      profileRejectReason: mismatch.kind === 'graduation' ? 'graduation-year-mismatch' : 'start-date-mismatch'
    };
  }
  const qualificationMismatch = careerProfileQualificationMismatch(sourceTextForRules);
  if (qualificationMismatch) {
    return {
      profileFitConfidence: 'low',
      profileFitEvidence: `qualification mismatch for current May 2027 early-career profile: ${qualificationMismatch}`,
      profileRejectReason: 'qualification-mismatch'
    };
  }
  const targetYearPattern = new RegExp(`\\b(?:${targetYears.join('|')})\\b`, 'u');
  if (targetYearPattern.test(sourceOnlyText)) {
    return {
      profileFitConfidence: 'high',
      profileFitEvidence: `source-local eligibility references target year ${targetLine}`
    };
  }
  if (/\b(new grad|new graduate|upcoming graduate|early career|entry[- ]level|internship|intern|rotational|analyst program)\b/iu.test(sourceOnlyText)) {
    return {
      profileFitConfidence: 'medium',
      profileFitEvidence: `source-local early-career/student eligibility fits target year ${targetLine} unless a stricter class year appears`
    };
  }
  if (targetYearPattern.test(fullText)) {
    return {
      profileFitConfidence: 'medium',
      profileFitEvidence: `research context references target year ${targetLine}, but source-local profile evidence is limited`
    };
  }
  return {
    profileFitConfidence: 'low',
    profileFitEvidence: `no source-local graduation year, start-date, or student/early-career eligibility matched target year ${targetLine}`,
    profileRejectReason: 'weak-profile-fit'
  };
}

function careerLeadPostingDate(source: Record<string, unknown>): string | undefined {
  const value = sourceField(source, ['posted_at', 'posting_date', 'postingDate', 'date_posted', 'datePosted', 'published_at', 'publishedAt']);
  return value ? truncateText(value, 80) : undefined;
}

function careerLeadDeadlineSignal(
  source: Record<string, unknown>,
  sourceOnlyText: string
): Pick<CareerLeadQualitySignals, 'deadlineConfidence' | 'deadlineEvidence'> {
  const explicit = sourceField(source, ['deadline', 'application_deadline', 'applicationDeadline', 'closing_date', 'closingDate', 'close_date', 'closeDate']);
  if (explicit) return { deadlineConfidence: 'high', deadlineEvidence: truncateText(explicit, 100) };
  const deadlineMatch = sourceOnlyText.match(
    /\b(?:deadline|apply by|applications? (?:close|due)|closing date|closes)\b[:\s-]*(.{0,80}?\b(?:20\d{2}|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\b.{0,40})/iu
  );
  if (deadlineMatch?.[1]) return { deadlineConfidence: 'medium', deadlineEvidence: truncateText(deadlineMatch[1].trim(), 100) };
  if (/\b(rolling|open until filled|applications reviewed on a rolling basis)\b/iu.test(sourceOnlyText)) {
    return { deadlineConfidence: 'medium', deadlineEvidence: 'rolling or open-until-filled language' };
  }
  return { deadlineConfidence: 'unknown', deadlineEvidence: 'no application deadline found' };
}

function careerLeadQualitySignals(
  source: Record<string, unknown>,
  metadata: Record<string, unknown>,
  company: string,
  applicationUrl: string,
  sourceOnlyText: string,
  fullText: string
): CareerLeadQualitySignals {
  const postingDate = careerLeadPostingDate(source);
  const signals: CareerLeadQualitySignals = {
    ...careerLeadSourceQuality(applicationUrl, company),
    ...careerLeadTimingSignal(sourceOnlyText, fullText, metadata),
    ...careerLeadProfileFitSignal(sourceOnlyText, fullText, metadata),
    ...careerLeadDeadlineSignal(source, sourceOnlyText),
    duplicateStatus: 'new-source'
  };
  if (postingDate) signals.postingDate = postingDate;
  return signals;
}

function careerLeadQualityMetadata(quality: CareerLeadQualitySignals): Record<string, unknown> {
  return compactRecord({
    sourceQuality: quality.sourceQuality,
    timingConfidence: quality.timingConfidence,
    profileFitConfidence: quality.profileFitConfidence,
    profileRejectReason: quality.profileRejectReason,
    deadlineConfidence: quality.deadlineConfidence,
    postingDate: quality.postingDate,
    duplicateStatus: quality.duplicateStatus
  });
}

function careerLeadFitScore(text: string, metadata: Record<string, unknown>, source: Record<string, unknown>): { score: number; evidence: string[] } {
  const lower = text.toLowerCase();
  const targetRoles = compactTextList(metadata.target_roles, 12);
  const locations = compactTextList(metadata.locations, 8);
  const feedback = isRecord(metadata.feedback) ? metadata.feedback : {};
  const targetRoleTerms = new Set(careerSignalTerms(targetRoles, 30));
  const preferredRoleTerms = compactTextList(feedback.preferred_role_terms, 18).filter((term) => term.length >= 3);
  const preferredRoleTermSet = new Set(preferredRoleTerms.map((term) => term.toLowerCase()));
  const avoidedRoleTerms = compactTextList(feedback.avoided_role_terms, 18).filter(
    (term) => term.length >= 3 && !targetRoleTerms.has(term.toLowerCase()) && !preferredRoleTermSet.has(term.toLowerCase())
  );
  const backgroundTerms = Array.from(
    new Set([...compactTextList(metadata.profile_background, 20), ...careerSignalTerms([textValue(metadata.profile_background)], 20)])
  ).filter((term) => term.length >= 4);
  const startWindow = textValue(metadata.target_start_window) || 'May 2027 / Summer 2027 start';
  const sourceScore = Number(source.score ?? sourceMetadata(source).score);
  const evidence: string[] = [];
  let score = 42;
  if (targetRoles.some((role) => role && lower.includes(role.toLowerCase()))) {
    score += 20;
    evidence.push('target role match');
  } else if (looksLikeRoleText(text, targetRoles)) {
    score += 12;
    evidence.push('role-family match');
  }
  if (/\b(2027|summer\s*2027|may\s*2027|class of 2027|new grad|new graduate|upcoming graduate|early career|entry[- ]level|internship|intern)\b/iu.test(lower)) {
    score += 20;
    evidence.push(`${startWindow} or early-career timing evidence`);
  }
  if (locations.some((location) => location && lower.includes(location.toLowerCase()))) {
    score += 8;
    evidence.push('location/work-mode match');
  }
  if (backgroundTerms.some((term) => lower.includes(term.toLowerCase()))) {
    score += 8;
    evidence.push('background keyword match');
  }
  const preferredMatches = preferredRoleTerms.filter((term) => lower.includes(term.toLowerCase()));
  if (preferredMatches.length) {
    score += Math.min(12, 4 + preferredMatches.length * 3);
    evidence.push(`Career Desk feedback match: ${preferredMatches.slice(0, 4).join(', ')}`);
  }
  const avoidedMatches = avoidedRoleTerms.filter((term) => lower.includes(term.toLowerCase()));
  if (avoidedMatches.length) {
    score -= Math.min(26, 12 + avoidedMatches.length * 6);
    evidence.push(`not-fit feedback penalty: ${avoidedMatches.slice(0, 4).join(', ')}`);
  }
  if (Number.isFinite(sourceScore)) {
    score += Math.round(Math.min(8, Math.max(0, sourceScore * 8)));
    evidence.push('source ranking signal');
  }
  if (/\b(senior|sr\.?|staff|principal|manager|director|head of|vp)\b/iu.test(lower)) {
    score -= 28;
    evidence.push('senior-level penalty');
  }
  if (/\b(closed|no longer accepting|expired|filled)\b/iu.test(lower)) {
    score -= 35;
    evidence.push('closed/expired penalty');
  }
  return { score: Math.max(0, Math.min(100, score)), evidence };
}

function existingCareerLeadKeys(store: MemoryStore): { urls: Set<string>; companyRoles: Set<string>; companies: Set<string> } {
  const registryKeys = careerSeenLeadKeys(store);
  const urls = new Set<string>(registryKeys.urls);
  const companyRoles = new Set<string>(registryKeys.companyRoles);
  const companies = new Set<string>(registryKeys.companies);
  for (const job of store.jobs) {
    if (job.applicationUrl) urls.add(canonicalUrlKey(job.applicationUrl));
    const companyKey = normalizeCompanyKey(job.company);
    if (companyKey) companies.add(companyKey);
    companyRoles.add(`${companyKey}|${normalizeDedupeText(job.role)}`);
  }
  return { urls, companyRoles, companies };
}

function careerLeadDuplicateReason(
  candidate: Pick<CareerLeadCandidate, 'company' | 'role' | 'applicationUrl'>,
  existing: { urls: Set<string>; companyRoles: Set<string>; companies: Set<string> },
  metadata: Record<string, unknown>
): string | null {
  const urlKey = canonicalUrlKey(candidate.applicationUrl);
  if (existing.urls.has(urlKey)) return 'duplicate-url';
  const companyKey = normalizeCompanyKey(candidate.company);
  const roleKey = normalizeDedupeText(candidate.role);
  if (existing.companyRoles.has(`${companyKey}|${roleKey}`)) return 'duplicate-company-role';
  const excluded = compactTextList(metadata.excluded_companies, 50).map(normalizeCompanyKey).filter(Boolean);
  if (companyKey && excluded.some((item) => item === companyKey || companyKey.includes(item) || item.includes(companyKey))) {
    return 'excluded-company';
  }
  return null;
}

function careerLeadQualityRejectReason(candidate: CareerLeadCandidate): string | null {
  if (candidate.quality.profileFitConfidence === 'low' && candidate.quality.profileRejectReason !== 'weak-profile-fit') {
    return candidate.quality.profileRejectReason ?? 'weak-profile-fit';
  }
  if (candidate.quality.timingConfidence === 'low') return 'low-timing-confidence';
  if (candidate.quality.sourceQuality === 'job-board') return 'job-board-mirror';
  if (candidate.quality.sourceQuality === 'unclear') return 'unclear-source';
  if (candidate.quality.profileFitConfidence === 'low') return candidate.quality.profileRejectReason ?? 'weak-profile-fit';
  return null;
}

function careerLeadCandidateFromSource(
  source: Record<string, unknown>,
  researchRun: Record<string, unknown>,
  metadata: Record<string, unknown>,
  report: Record<string, unknown>
): CareerLeadCandidate | { skipped: string } {
  const applicationUrl = sourceUrl(source);
  if (!applicationUrl) return { skipped: 'missing-url' };
  const text = sourceText(source, {}) || sourceText(source, report);
  if (!/\b(apply|application|job|jobs|career|careers|opening|role|intern|internship|new grad|graduate|rotational)\b/iu.test(text)) {
    return { skipped: 'not-opportunity' };
  }
  const { company, role } = parseCompanyRoleFromSource(source, metadata);
  if (!company || !role || role.length < 4) return { skipped: 'missing-company-role' };
  const sourceOnlyText = sourceText(source, {});
  const fit = careerLeadFitScore(text, metadata, source);
  const quality = careerLeadQualitySignals(source, metadata, company, applicationUrl, sourceOnlyText, text);
  const title = sourceTitle(source);
  const description = sourceField(source, ['description', 'snippet', 'summary']);
  const researchRunId = textValue(researchRun.id);
  const notes = [
    `Discovered by Career Discovery from AI OS research${researchRunId ? ` run ${researchRunId}` : ''}.`,
    title ? `Source title: ${title}` : '',
    description ? `Source summary: ${truncateText(description, 260)}` : '',
    `Source: ${applicationUrl}`,
    `Source quality: ${quality.sourceQuality} (${quality.sourceQualityEvidence})`,
    `Timing confidence: ${quality.timingConfidence} (${quality.timingEvidence})`,
    `Profile fit: ${quality.profileFitConfidence} (${quality.profileFitEvidence})`,
    `Deadline confidence: ${quality.deadlineConfidence} (${quality.deadlineEvidence})`,
    quality.postingDate ? `Posting date: ${quality.postingDate}` : '',
    `Duplicate status: ${quality.duplicateStatus}`,
    `Fit evidence: ${fit.evidence.join('; ') || 'source-backed candidate'}`,
    `Discovery metadata: ${JSON.stringify(careerLeadQualityMetadata(quality))}`
  ]
    .filter(Boolean)
    .join('\n');
  return {
    company,
    role,
    applicationUrl,
    fitScore: fit.score,
    notes,
    source,
    evidence: fit.evidence,
    quality
  };
}

function importCareerLeadsFromResearchRun(
  store: MemoryStore,
  task: PassiveTask,
  passiveRunId: string,
  researchRun: Record<string, unknown>,
  limit: number,
  date = new Date()
): CareerLeadImportResult {
  const options = nestedRecord(researchRun, 'options');
  const metadata = nestedRecord(options, 'metadata');
  if (metadata.career_discovery !== true) return { createdJobs: [], skipped: 0, skippedReasons: {}, rememberedFilters: 0 };
  const report = nestedRecord(researchRun, 'report');
  const sources = Array.isArray(researchRun.sources) ? researchRun.sources.filter(isRecord) : [];
  const existing = existingCareerLeadKeys(store);
  const memoryFingerprints = new Set(careerDiscoveryFilterMemory(store).map((entry) => entry.fingerprint));
  const skippedReasons: Record<string, number> = {};
  const filteredForMemory: CareerLeadFilteredCandidate[] = [];
  const createdJobs: JobRecord[] = [];
  const workspaceId = store.settings?.workspaceId ?? personalWorkspaceId;
  const now = nowIso(date);
  const reviewDate = addMilliseconds(date, 3 * dayMs).slice(0, 10);
  for (const source of sources) {
    if (createdJobs.length >= limit) break;
    const candidate = careerLeadCandidateFromSource(source, researchRun, metadata, report);
    if ('skipped' in candidate) {
      skippedReasons[candidate.skipped] = (skippedReasons[candidate.skipped] ?? 0) + 1;
      continue;
    }
    const duplicateReason = careerLeadDuplicateReason(candidate, existing, metadata);
    if (duplicateReason) {
      skippedReasons[duplicateReason] = (skippedReasons[duplicateReason] ?? 0) + 1;
      if (shouldRememberCareerLeadFilter(duplicateReason)) filteredForMemory.push({ candidate, reason: duplicateReason });
      continue;
    }
    const memoryReason = careerLeadPreviouslyFilteredReason(candidate, memoryFingerprints);
    if (memoryReason) {
      skippedReasons[memoryReason] = (skippedReasons[memoryReason] ?? 0) + 1;
      filteredForMemory.push({ candidate, reason: memoryReason });
      continue;
    }
    const qualityReason = careerLeadQualityRejectReason(candidate);
    if (qualityReason) {
      skippedReasons[qualityReason] = (skippedReasons[qualityReason] ?? 0) + 1;
      filteredForMemory.push({ candidate, reason: qualityReason });
      continue;
    }
    if (candidate.fitScore < 72) {
      skippedReasons['low-fit-score'] = (skippedReasons['low-fit-score'] ?? 0) + 1;
      filteredForMemory.push({ candidate, reason: 'low-fit-score' });
      continue;
    }
    const job = jobSchema.parse({
      id: id('career-job'),
      workspaceId,
      company: candidate.company,
      role: candidate.role,
      status: 'lead',
      applicationUrl: candidate.applicationUrl,
      fitScore: candidate.fitScore,
      nextActionAt: reviewDate,
      notes: candidate.notes,
      deviceId: 'passive-engine',
      updatedAt: now
    });
    store.jobs.push(job);
    existing.urls.add(canonicalUrlKey(job.applicationUrl));
    const companyKey = normalizeCompanyKey(job.company);
    existing.companies.add(companyKey);
    existing.companyRoles.add(`${companyKey}|${normalizeDedupeText(job.role)}`);
    appendSyncEvent(store, {
      workspaceId: job.workspaceId,
      entityType: 'job',
      entityId: job.id,
      operation: 'insert',
      payload: job,
      deviceId: job.deviceId
    });
    createdJobs.push(job);
  }
  const seenRegistry = createdJobs.length
    ? upsertCareerSeenLeadRegistry(store, createdJobs, {
        deviceId: 'passive-engine',
        reason: 'passive-career-discovery-import-seen-registry',
        source: 'career-discovery',
        date
      })
    : { changed: 0, total: careerSeenLeadRegistry(store).length };
  if (createdJobs.length) {
    appendActionLedgerEvent(store, {
      system: 'mini-hub',
      source: 'passive-career-discovery',
      actionType: 'career.import_discovered_leads',
      summary: `Saved ${createdJobs.length} source-backed Career Discovery lead${createdJobs.length === 1 ? '' : 's'} from AI OS research.`,
      status: 'succeeded',
      risk: 'write',
      changed: createdJobs.map((job) => `job:${job.id}`),
      recoverability: {
        kind: 'snapshot',
        referenceId: passiveRunId,
        route: routeMap.careerDesk,
        description: 'Inserted jobs are recorded as sync events and can be deleted from Career Desk.',
        reversible: true
      },
      rawRef: compactRecord({
        runId: passiveRunId,
        researchRunId: researchRun.id,
        taskId: task.id
      }),
      metadata: {
        imported: createdJobs.length,
        skippedReasons,
        rememberedFilters: filteredForMemory.filter((item) => shouldRememberCareerLeadFilter(item.reason)).length,
        seenRegistry,
        fitScores: createdJobs.map((job) => job.fitScore).filter((score): score is number => typeof score === 'number')
      }
    });
  }
  const rememberedFilters = upsertCareerDiscoveryFilterMemory(store, filteredForMemory, passiveRunId, date);
  return {
    createdJobs,
    skipped: Object.values(skippedReasons).reduce((total, count) => total + count, 0),
    skippedReasons,
    rememberedFilters
  };
}

function careerLeadSkipReasonLabel(reason: string): string {
  const labels: Record<string, string> = {
    'duplicate-company-role': 'duplicate role',
    'duplicate-url': 'duplicate URL',
    'excluded-company': 'excluded company',
    'graduation-year-mismatch': 'wrong graduation year',
    'job-board-mirror': 'job-board mirror',
    'low-fit-score': 'low fit score',
    'low-timing-confidence': 'weak timing evidence',
    'missing-company-role': 'missing company or role',
    'missing-url': 'missing source URL',
    'not-opportunity': 'not a role listing',
    'previously-filtered': 'previously filtered',
    'qualification-mismatch': 'qualification mismatch',
    'start-date-mismatch': 'wrong start date',
    'unclear-source': 'unclear source',
    'weak-profile-fit': 'weak profile fit'
  };
  return labels[reason] ?? reason.replaceAll('-', ' ');
}

function careerLeadSkipReasonSummary(skippedReasons: Record<string, number>, limit = 4): string {
  return Object.entries(skippedReasons)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([reason, count]) => `${careerLeadSkipReasonLabel(reason)}: ${count}`)
    .join('; ');
}

function careerLeadDiscoveryMetadataFromJob(job: JobRecord): Record<string, unknown> {
  const match = job.notes.match(/^Discovery metadata:\s*(\{.+\})\s*$/imu);
  if (!match?.[1]) return {};
  try {
    const parsed = JSON.parse(match[1]) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function careerLeadImportCard(
  task: PassiveTask,
  passiveRunId: string,
  researchRun: Record<string, unknown>,
  result: CareerLeadImportResult
): PassiveResultCard | null {
  const skippedSummary = careerLeadSkipReasonSummary(result.skippedReasons);
  if (!result.createdJobs.length) {
    if (!result.skipped) return null;
    return card({
      id: id('passive-card'),
      taskId: task.id,
      runId: passiveRunId,
      family: task.family,
      title: `${result.skipped} Career Discovery candidate${result.skipped === 1 ? '' : 's'} filtered`,
      summary: skippedSummary
        ? `No new Career Desk rows were saved. Filtered by ${skippedSummary}.`
        : 'No new Career Desk rows were saved after source, duplicate, timing, and fit checks.',
      urgency: 34,
      confidence: 0.76,
      route: routeMap.careerDesk,
      sourceRefs: [
        stableSourceRef('record', 'AI OS research run', {
          id: String(researchRun.id ?? passiveRunId),
          route: routeMap.research,
          metadata: compactRecord({
            researchRunId: researchRun.id,
            skippedCareerLeadCandidates: result.skipped,
            skippedCareerLeadReasons: result.skippedReasons,
            rememberedCareerLeadFilters: result.rememberedFilters
          })
        })
      ],
      suggestedAction: 'Review filters',
      actionKind: 'inspect',
      why: 'Career Discovery returned source-backed candidates, but the passive engine rejected them before saving because they did not pass opportunity, timing, seniority, duplicate, feedback, or fit-score filters.'
    });
  }
  return card({
    id: id('passive-card'),
    taskId: task.id,
    runId: passiveRunId,
    family: task.family,
    title: `${result.createdJobs.length} source-backed Career lead${result.createdJobs.length === 1 ? '' : 's'} saved`,
    summary: result.createdJobs
      .slice(0, 4)
      .map((job) => `${job.company} - ${job.role}${typeof job.fitScore === 'number' ? ` (${job.fitScore})` : ''}`)
      .join('; ') + (result.skipped && skippedSummary ? `; filtered ${result.skipped} (${skippedSummary})` : ''),
    urgency: result.createdJobs.some((job) => (job.fitScore ?? 0) >= 86) ? 78 : 66,
    confidence: 0.82,
    route: routeMap.careerDesk,
    sourceRefs: result.createdJobs.slice(0, 8).map((job) =>
      stableSourceRef('record', `${job.company} - ${job.role}`, {
        id: job.id,
        route: routeMap.careerDesk,
        url: job.applicationUrl,
        metadata: compactRecord({
          status: job.status,
          fitScore: job.fitScore,
          applicationUrl: job.applicationUrl,
          nextActionAt: job.nextActionAt,
          researchRunId: researchRun.id,
          ...careerLeadDiscoveryMetadataFromJob(job)
        })
      })
    ),
    suggestedAction: 'Review saved leads',
    actionKind: 'inspect',
    why: 'A Career Discovery monitor returned source URLs that passed the role, timing, seniority, duplicate, feedback, and fit-score filters, so the passive engine saved them as ranked Career Desk leads.'
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
  const watchLabel = typeof metadata.passive_watch_label === 'string' ? metadata.passive_watch_label : undefined;
  const watchKind = typeof metadata.passive_watch_kind === 'string' ? metadata.passive_watch_kind : undefined;
  const title =
    typeof report.title === 'string' && report.title.trim()
      ? report.title.trim()
      : watchedDomain
        ? `Research update for ${watchedDomain}`
        : watchLabel
          ? `Research update for ${watchLabel}`
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
      : watchLabel
        ? `AI OS completed a saved ${watchKind ?? 'topic'} monitor run for ${watchLabel} and returned source-backed findings.`
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
  const importResults = freshMonitorRuns.map((run) =>
    importCareerLeadsFromResearchRun(store, task, passiveRunId, run, Math.max(2, budget.researchPerDomainLimit))
  );
  const importCards = freshMonitorRuns
    .map((run, index) =>
      careerLeadImportCard(task, passiveRunId, run, importResults[index] ?? { createdJobs: [], skipped: 0, skippedReasons: {}, rememberedFilters: 0 })
    )
    .filter((item): item is PassiveResultCard => Boolean(item));
  const cards = freshMonitorRuns
    .map((run) => researchRunCard(task, passiveRunId, run))
    .filter((item): item is PassiveResultCard => Boolean(item))
    .slice(0, budget.researchMonitorRunLimit);
  const importedJobs = importResults.flatMap((result) => result.createdJobs);
  const skippedReasons = importResults.reduce<Record<string, number>>((acc, result) => {
    for (const [reason, count] of Object.entries(result.skippedReasons)) acc[reason] = (acc[reason] ?? 0) + count;
    return acc;
  }, {});
  const rememberedFilters = importResults.reduce((total, result) => total + result.rememberedFilters, 0);
  return {
    cards: [...importCards, ...cards],
    changed: [
      ...importedJobs.map((job) => `job:${job.id}`),
      ...(importedJobs.length ? ['settings:career-seen-lead-registry'] : []),
      ...cards
      .map((item) => item.sourceRefs[0]?.metadata.researchRunId)
      .filter((value): value is string => typeof value === 'string')
        .map((researchRunId) => `research-run:${researchRunId}`)
    ],
    metadata: {
      recentRunsChecked: runs.length,
      monitorRunsChecked: monitorRuns.length,
      skippedAlreadySurfaced: monitorRuns.length - freshMonitorRuns.length,
      surfacedResearchRuns: cards.length,
      importedCareerLeads: importedJobs.length,
      skippedCareerLeadCandidates: Object.values(skippedReasons).reduce((total, count) => total + count, 0),
      skippedCareerLeadReasons: skippedReasons,
      rememberedCareerLeadFilters: rememberedFilters,
      careerSeenLeadRegistrySize: careerSeenLeadRegistry(store).length,
      careerDiscoveryFilterMemorySize: careerDiscoveryFilterMemory(store).length
    }
  };
}

async function runResearchMonitor(store: MemoryStore, task: PassiveTask, runId: string, fetchImpl: FetchLike): Promise<FamilyRunResult> {
  const settings = store.passiveSettings ?? defaultPassiveSettings();
  const budget = researchMonitorBudget(settings, store);
  const domainEntries = passiveResearchDomainEntries(store, settings, budget);
  const domainMetadata = researchDomainMetadata(domainEntries);
  try {
    const createdMonitors = await ensureWatchedDomainResearchMonitors(settings, domainEntries, fetchImpl);
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
              title: `${createdMonitors.length} research watch${createdMonitors.length === 1 ? '' : 'es'} prepared`,
              summary: 'Created AI OS daily monitor templates from Passive Task watch-list entries. No crawl was run by this setup step.',
              urgency: 44,
              confidence: 0.88,
              route: routeMap.research,
              sourceRefs: createdMonitors.map((monitor) =>
                stableSourceRef('record', String(monitor.name ?? monitor.id ?? 'Research watch monitor'), {
                  id: String(monitor.id ?? crypto.randomUUID()),
                  route: routeMap.research,
                  metadata: monitor
                })
              ),
              suggestedAction: 'Inspect monitors',
              actionKind: 'inspect',
              why: 'Passive Tasks found source-backed research watch-list entries and created durable AI OS monitor definitions for them without running a crawl.'
            })
          ].concat(recent.cards),
          changed: [
            ...createdMonitors.map((monitor) => `research-monitor:${String(monitor.id ?? '')}`).filter((value) => !value.endsWith(':')),
            ...recent.changed
          ],
          metadata: {
            createdMonitors: createdMonitors.length,
            ...domainMetadata,
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
            ...domainMetadata,
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
          ...domainMetadata,
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
        ...domainMetadata,
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

function careerMailConnections(store: MemoryStore): IntegrationConnection[] {
  return Array.from(store.integrationConnections.values()).filter(
    (connection) => connection.provider === 'google' && connection.status === 'connected'
  );
}

type CareerApplicationEvidenceSource = 'gmail' | 'completed_action';

interface CareerApplicationEvidence {
  job: JobRecord;
  source: CareerApplicationEvidenceSource;
  reason: string;
  confidence: number;
  matchedOn: string[];
  occurredAt?: string;
  thread?: GmailThread;
  action?: CareerActionRecord;
}

interface CareerApplicationAutoUpdate {
  job: JobRecord;
  before: JobRecord;
  followUpAction: CareerActionRecord;
  evidence: CareerApplicationEvidence;
}

type CareerStatusTarget = 'interview' | 'offer' | 'rejected';

interface CareerMailJobMatch {
  matchedOn: string[];
  exactCompany: boolean;
  exactRole: boolean;
  companyMatches: string[];
  roleMatches: string[];
  confidenceBoost: number;
}

interface CareerStatusEvidence {
  job: JobRecord;
  targetStatus: CareerStatusTarget;
  source: 'gmail';
  reason: string;
  confidence: number;
  matchedOn: string[];
  occurredAt?: string;
  thread: GmailThread;
}

interface CareerStatusAutoUpdate {
  job: JobRecord;
  before: JobRecord;
  evidence: CareerStatusEvidence;
  followUpAction?: CareerActionRecord;
}

function careerAutoMarkAppliedEnabled(store: MemoryStore): boolean {
  const profile = careerDiscoveryPreference(store);
  return profile.autoMarkAppliedFromEvidence !== false;
}

function careerAutoMarkConfidenceThreshold(store: MemoryStore): number {
  const profile = careerDiscoveryPreference(store);
  const raw = Number(profile.autoMarkConfidenceThreshold);
  if (!Number.isFinite(raw)) return 0.92;
  return Math.min(0.99, Math.max(0.88, raw));
}

function applicationCandidateJobs(store: MemoryStore): JobRecord[] {
  return store.jobs.filter((job) => ['lead', 'saved', 'watching'].includes(job.status.trim().toLowerCase()));
}

function statusUpdateCandidateJobs(store: MemoryStore): JobRecord[] {
  return store.jobs.filter((job) => ['lead', 'saved', 'watching', 'applied', 'interview'].includes(job.status.trim().toLowerCase()));
}

function careerMailText(thread: GmailThread): string {
  return [
    thread.subject,
    thread.from,
    thread.snippet,
    ...thread.messages.flatMap((message) => [message.subject, message.from, message.bodyText])
  ]
    .join(' ')
    .toLowerCase();
}

function careerWordTokens(value: string): string[] {
  const stop = new Set(['and', 'the', 'inc', 'llc', 'ltd', 'corp', 'company', 'careers', 'jobs', 'job', 'role']);
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, ' ')
    .split(' ')
    .map((item) => item.trim())
    .filter((item) => item.length >= 3 && !stop.has(item));
}

function careerUrlTokens(value: string): string[] {
  if (!value) return [];
  try {
    const url = new URL(value);
    return careerWordTokens(url.hostname.replace(/^www\./iu, '').replace(/\.[a-z]{2,}$/iu, ' '));
  } catch {
    return [];
  }
}

function careerMailJobMatch(thread: GmailThread, job: JobRecord): CareerMailJobMatch | null {
  const text = careerMailText(thread);
  const company = job.company.toLowerCase().trim();
  const role = job.role.toLowerCase().trim();
  const companyTokens = Array.from(new Set([...careerWordTokens(job.company), ...careerUrlTokens(job.applicationUrl)]));
  const roleTokens = careerWordTokens(job.role);
  const exactCompany = company.length >= 4 && text.includes(company);
  const exactRole = role.length >= 8 && text.includes(role);
  const companyMatches = companyTokens.filter((token) => text.includes(token));
  const roleMatches = roleTokens.filter((token) => text.includes(token));
  const matchedOn = [
    exactCompany ? 'exact-company' : '',
    exactRole ? 'exact-role' : '',
    ...companyMatches.map((token) => `company:${token}`),
    ...roleMatches.map((token) => `role:${token}`)
  ].filter(Boolean);
  if (!exactCompany && !companyMatches.length) return null;
  if (!exactRole && roleMatches.length < 1) return null;

  let confidenceBoost = 0;
  if (exactCompany) confidenceBoost += 0.06;
  if (exactRole) confidenceBoost += 0.06;
  if (!exactRole && roleMatches.length >= 2) confidenceBoost += 0.04;
  if (companyMatches.length >= 2) confidenceBoost += 0.02;
  if (/\b(intern|graduate|analyst|engineer|research|quant|data)\b/iu.test(role) && roleMatches.length) confidenceBoost += 0.01;

  return {
    matchedOn: Array.from(new Set(matchedOn)).slice(0, 8),
    exactCompany,
    exactRole,
    companyMatches,
    roleMatches,
    confidenceBoost
  };
}

function applicationConfirmationReason(thread: GmailThread): string | null {
  const text = careerMailText(thread);
  if (/\b(thank you for applying|thanks for applying|application (?:was )?(?:submitted|received)|we (?:have )?received your application|your application (?:has been|was) received|application confirmation|successfully submitted)\b/iu.test(text)) {
    return 'Gmail contains application confirmation language';
  }
  return null;
}

function careerMailApplicationEvidence(thread: GmailThread, job: JobRecord): CareerApplicationEvidence | null {
  const reason = applicationConfirmationReason(thread);
  if (!reason) return null;
  const match = careerMailJobMatch(thread, job);
  if (!match) return null;

  let confidence = 0.84 + match.confidenceBoost;
  confidence = Math.min(0.98, confidence);

  const occurredAt = thread.date || thread.messages[0]?.date;
  return {
    job,
    source: 'gmail',
    reason,
    confidence,
    matchedOn: match.matchedOn,
    ...(occurredAt ? { occurredAt } : {}),
    thread
  };
}

function careerMailStatusReason(thread: GmailThread): { targetStatus: CareerStatusTarget; reason: string } | null {
  const text = careerMailText(thread);
  if (
    /\b(congratulations|congrats|pleased to offer|offer letter|employment offer|we would like to offer|would like to extend (?:an )?offer|extend (?:an )?offer)\b/iu.test(
      text
    )
  ) {
    return { targetStatus: 'offer', reason: 'Gmail contains offer-stage language' };
  }
  if (
    /\b(after careful consideration|not moving forward|will not be moving forward|not selected|no longer under consideration|decided not to proceed|pursue other candidates|unable to offer|we regret to inform)\b/iu.test(
      text
    )
  ) {
    return { targetStatus: 'rejected', reason: 'Gmail contains rejection/no-longer-moving-forward language' };
  }
  if (
    /\b(interview|schedule (?:a |an )?(?:call|conversation|interview)|availability for (?:a |an )?(?:call|interview)|next round|phone screen|technical screen|recruiter screen|onsite|final round)\b/iu.test(
      text
    )
  ) {
    return { targetStatus: 'interview', reason: 'Gmail contains interview or scheduling language' };
  }
  return null;
}

function careerStatusTransitionAllowed(currentStatus: string, targetStatus: CareerStatusTarget): boolean {
  const current = currentStatus.trim().toLowerCase();
  if (['archived', 'rejected'].includes(current)) return false;
  if (targetStatus === 'interview') return ['lead', 'saved', 'watching', 'applied'].includes(current);
  if (targetStatus === 'offer') return ['lead', 'saved', 'watching', 'applied', 'interview'].includes(current);
  return ['lead', 'saved', 'watching', 'applied', 'interview'].includes(current);
}

function careerStatusAutoThreshold(store: MemoryStore, targetStatus: CareerStatusTarget): number {
  const base = careerAutoMarkConfidenceThreshold(store);
  if (targetStatus === 'rejected') return Math.max(0.95, base);
  if (targetStatus === 'offer') return Math.max(0.93, base);
  return base;
}

function careerMailStatusEvidence(thread: GmailThread, job: JobRecord): CareerStatusEvidence | null {
  const reason = careerMailStatusReason(thread);
  if (!reason || !careerStatusTransitionAllowed(job.status, reason.targetStatus)) return null;
  const match = careerMailJobMatch(thread, job);
  if (!match) return null;
  const confidence = Math.min(0.99, 0.85 + match.confidenceBoost + (reason.targetStatus === 'offer' && match.exactRole ? 0.01 : 0));
  const occurredAt = thread.date || thread.messages[0]?.date;
  return {
    job,
    targetStatus: reason.targetStatus,
    source: 'gmail',
    reason: reason.reason,
    confidence,
    matchedOn: match.matchedOn,
    ...(occurredAt ? { occurredAt } : {}),
    thread
  };
}

function completedApplyActionEvidence(store: MemoryStore): CareerApplicationEvidence[] {
  const candidateById = new Map(applicationCandidateJobs(store).map((job) => [job.id, job]));
  const evidence: CareerApplicationEvidence[] = [];
  for (const action of store.careerActions) {
    if (!action.jobId || !action.completedAt) continue;
    const job = candidateById.get(action.jobId);
    if (!job) continue;
    const label = action.label.toLowerCase();
    if (/\bfollow\s*up\b/iu.test(label)) continue;
    const applySignal =
      /^\s*(apply|applied|submit|submitted)\b/iu.test(label) ||
      /\b(application submitted|submitted application|applied to|apply to|submit application)\b/iu.test(label);
    if (!applySignal) continue;
    evidence.push({
      job,
      source: 'completed_action',
      reason: 'Completed Career action indicates the application was submitted',
      confidence: 0.97,
      matchedOn: [`career-action:${action.id}`],
      occurredAt: action.completedAt,
      action
    });
  }
  return evidence;
}

function dateInputFromEvidence(value: string | undefined, fallback = new Date()): string {
  const parsed = parseTime(value);
  const date = Number.isFinite(parsed) ? new Date(parsed) : fallback;
  return date.toISOString().slice(0, 10);
}

function addDaysToDateInput(value: string, days: number): string {
  const parsed = Date.parse(`${value}T12:00:00.000Z`);
  const date = Number.isFinite(parsed) ? new Date(parsed) : new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function applicationFollowUpLabel(job: Pick<JobRecord, 'company' | 'role'>): string {
  return `Follow up on application: ${job.role} at ${job.company}`;
}

function appendPassiveAppliedNote(existingNotes: string, evidence: CareerApplicationEvidence, appliedDate: string): string {
  if (/Career Radar marked this as applied on \d{4}-\d{2}-\d{2}\./u.test(existingNotes)) return existingNotes;
  const source =
    evidence.source === 'gmail'
      ? `Gmail confirmation${evidence.thread?.subject ? ` "${evidence.thread.subject}"` : ''}`
      : `completed Career action${evidence.action?.label ? ` "${evidence.action.label}"` : ''}`;
  return [
    existingNotes.trim(),
    `Career Radar marked this as applied on ${appliedDate} from ${source}. Evidence confidence: ${Math.round(evidence.confidence * 100)}%.`
  ]
    .filter(Boolean)
    .join('\n\n');
}

function upsertPassiveApplicationFollowUp(
  store: MemoryStore,
  job: JobRecord,
  followUpDate: string,
  date: Date
): CareerActionRecord {
  const now = nowIso(date);
  const label = applicationFollowUpLabel(job);
  const existingIndex = store.careerActions.findIndex(
    (action) => action.jobId === job.id && !action.completedAt && action.label.toLowerCase().startsWith('follow up on application:')
  );
  const existing = existingIndex >= 0 ? store.careerActions[existingIndex] : undefined;
  const action = careerActionSchema.parse({
    ...(existing ?? {}),
    id: existing?.id ?? id('career-action'),
    workspaceId: job.workspaceId,
    jobId: job.id,
    label,
    dueAt: followUpDate,
    completedAt: existing?.completedAt,
    deviceId: 'passive-engine',
    updatedAt: now
  });
  if (existingIndex >= 0) {
    store.careerActions[existingIndex] = action;
  } else {
    store.careerActions.push(action);
  }
  appendSyncEvent(store, {
    workspaceId: action.workspaceId,
    entityType: 'career_action',
    entityId: action.id,
    operation: existingIndex >= 0 ? 'update' : 'insert',
    payload: existing ? withBeforeSnapshot(action, existing, 'passive-application-follow-up') : action,
    deviceId: action.deviceId
  });
  return action;
}

function statusFollowUpLabel(status: CareerStatusTarget, job: Pick<JobRecord, 'company' | 'role'>): string | undefined {
  if (status === 'interview') return `Prepare interview: ${job.role} at ${job.company}`;
  if (status === 'offer') return `Review offer: ${job.role} at ${job.company}`;
  return undefined;
}

function appendPassiveStatusNote(existingNotes: string, evidence: CareerStatusEvidence, statusDate: string): string {
  if (new RegExp(`Career Radar marked this as ${evidence.targetStatus} on \\d{4}-\\d{2}-\\d{2}\\.`, 'u').test(existingNotes)) {
    return existingNotes;
  }
  const source = `Gmail status update${evidence.thread?.subject ? ` "${evidence.thread.subject}"` : ''}`;
  return [
    existingNotes.trim(),
    `Career Radar marked this as ${evidence.targetStatus} on ${statusDate} from ${source}. Evidence confidence: ${Math.round(
      evidence.confidence * 100
    )}%.`
  ]
    .filter(Boolean)
    .join('\n\n');
}

function upsertPassiveStatusFollowUp(
  store: MemoryStore,
  job: JobRecord,
  targetStatus: CareerStatusTarget,
  dueAt: string,
  date: Date
): CareerActionRecord | undefined {
  const label = statusFollowUpLabel(targetStatus, job);
  if (!label) return undefined;
  const prefix = targetStatus === 'interview' ? 'prepare interview:' : 'review offer:';
  const now = nowIso(date);
  const existingIndex = store.careerActions.findIndex(
    (action) => action.jobId === job.id && !action.completedAt && action.label.toLowerCase().startsWith(prefix)
  );
  const existing = existingIndex >= 0 ? store.careerActions[existingIndex] : undefined;
  const action = careerActionSchema.parse({
    ...(existing ?? {}),
    id: existing?.id ?? id('career-action'),
    workspaceId: job.workspaceId,
    jobId: job.id,
    label,
    dueAt,
    completedAt: existing?.completedAt,
    deviceId: 'passive-engine',
    updatedAt: now
  });
  if (existingIndex >= 0) {
    store.careerActions[existingIndex] = action;
  } else {
    store.careerActions.push(action);
  }
  appendSyncEvent(store, {
    workspaceId: action.workspaceId,
    entityType: 'career_action',
    entityId: action.id,
    operation: existingIndex >= 0 ? 'update' : 'insert',
    payload: existing ? withBeforeSnapshot(action, existing, 'passive-career-status-follow-up') : action,
    deviceId: action.deviceId
  });
  return action;
}

function promoteCareerApplicationEvidence(
  store: MemoryStore,
  evidence: CareerApplicationEvidence,
  runId: string,
  date = new Date()
): CareerApplicationAutoUpdate | null {
  const index = store.jobs.findIndex((job) => job.id === evidence.job.id);
  const before = index >= 0 ? store.jobs[index] : undefined;
  if (!before || !applicationCandidateJobs(store).some((job) => job.id === before.id)) return null;
  const appliedDate = dateInputFromEvidence(evidence.occurredAt, date);
  const followUpDate = addDaysToDateInput(appliedDate, 14);
  const updated = jobSchema.parse({
    ...before,
    status: 'applied',
    nextActionAt: followUpDate,
    notes: appendPassiveAppliedNote(before.notes, evidence, appliedDate),
    deviceId: 'passive-engine',
    updatedAt: nowIso(date)
  });
  store.jobs[index] = updated;
  appendSyncEvent(store, {
    workspaceId: updated.workspaceId,
    entityType: 'job',
    entityId: updated.id,
    operation: 'update',
    payload: withBeforeSnapshot(updated, before, 'passive-application-confirmation'),
    deviceId: updated.deviceId
  });
  upsertCareerSeenLeadRegistry(store, [updated], {
    deviceId: 'passive-engine',
    reason: 'passive-application-confirmation-seen-registry',
    source: 'career-radar',
    date
  });
  const followUpAction = upsertPassiveApplicationFollowUp(store, updated, followUpDate, date);
  appendActionLedgerEvent(store, {
    system: 'mini-hub',
    source: 'passive-career-radar',
    actionType: 'career.auto_mark_applied',
    summary: `Marked ${updated.role} at ${updated.company} applied from ${evidence.source === 'gmail' ? 'Gmail confirmation' : 'completed Career action'}.`,
    status: 'succeeded',
    risk: 'write',
    changed: [`job:${updated.id}`, `career_action:${followUpAction.id}`],
    recoverability: {
      kind: 'snapshot',
      referenceId: runId,
      route: routeMap.careerDesk,
      description: 'The sync event stores a before-snapshot for the job update.',
      reversible: true
    },
    rawRef: compactRecord({
      runId,
      jobId: updated.id,
      source: evidence.source,
      gmailThreadId: evidence.thread?.id,
      careerActionId: evidence.action?.id
    }),
    metadata: compactRecord({
      confidence: evidence.confidence,
      matchedOn: evidence.matchedOn,
      reason: evidence.reason,
      appliedDate,
      followUpDate
    })
  });
  return { job: updated, before, followUpAction, evidence };
}

function promoteCareerStatusEvidence(
  store: MemoryStore,
  evidence: CareerStatusEvidence,
  runId: string,
  date = new Date()
): CareerStatusAutoUpdate | null {
  const index = store.jobs.findIndex((job) => job.id === evidence.job.id);
  const before = index >= 0 ? store.jobs[index] : undefined;
  if (!before || !careerStatusTransitionAllowed(before.status, evidence.targetStatus)) return null;
  const statusDate = dateInputFromEvidence(evidence.occurredAt, date);
  const followUpDate =
    evidence.targetStatus === 'interview'
      ? addDaysToDateInput(statusDate, 3)
      : evidence.targetStatus === 'offer'
        ? addDaysToDateInput(statusDate, 2)
        : undefined;
  const updated = jobSchema.parse({
    ...before,
    status: evidence.targetStatus,
    nextActionAt: followUpDate,
    notes: appendPassiveStatusNote(before.notes, evidence, statusDate),
    deviceId: 'passive-engine',
    updatedAt: nowIso(date)
  });
  store.jobs[index] = updated;
  appendSyncEvent(store, {
    workspaceId: updated.workspaceId,
    entityType: 'job',
    entityId: updated.id,
    operation: 'update',
    payload: withBeforeSnapshot(updated, before, 'passive-career-status-update'),
    deviceId: updated.deviceId
  });
  upsertCareerSeenLeadRegistry(store, [updated], {
    deviceId: 'passive-engine',
    reason: 'passive-career-status-update-seen-registry',
    source: 'career-radar',
    date
  });
  const followUpAction = followUpDate ? upsertPassiveStatusFollowUp(store, updated, evidence.targetStatus, followUpDate, date) : undefined;
  appendActionLedgerEvent(store, {
    system: 'mini-hub',
    source: 'passive-career-radar',
    actionType: 'career.auto_status_update',
    summary: `Marked ${updated.role} at ${updated.company} ${evidence.targetStatus} from Gmail status evidence.`,
    status: 'succeeded',
    risk: 'write',
    changed: [`job:${updated.id}`, ...(followUpAction ? [`career_action:${followUpAction.id}`] : [])],
    recoverability: {
      kind: 'snapshot',
      referenceId: runId,
      route: routeMap.careerDesk,
      description: 'The sync event stores a before-snapshot for the job update.',
      reversible: true
    },
    rawRef: compactRecord({
      runId,
      jobId: updated.id,
      gmailThreadId: evidence.thread.id
    }),
    metadata: compactRecord({
      previousStatus: before.status,
      status: updated.status,
      confidence: evidence.confidence,
      matchedOn: evidence.matchedOn,
      reason: evidence.reason,
      statusDate,
      followUpDate
    })
  });
  return { job: updated, before, evidence, ...(followUpAction ? { followUpAction } : {}) };
}

async function careerApplicationConfirmationCards(
  store: MemoryStore,
  task: PassiveTask,
  runId: string
): Promise<{
  cards: PassiveResultCard[];
  matchedCount: number;
  autoAppliedCount: number;
  reviewCount: number;
  error?: string;
}> {
  const connections = careerMailConnections(store);
  if (!connections.length) return { cards: [], matchedCount: 0, autoAppliedCount: 0, reviewCount: 0 };
  const candidateJobs = applicationCandidateJobs(store);
  if (!candidateJobs.length) return { cards: [], matchedCount: 0, autoAppliedCount: 0, reviewCount: 0 };
  const results = await Promise.allSettled(
    connections.map((connection) =>
      new GoogleGmailConnector(store, connection.id).listThreads({
        q: 'newer_than:45d ("thank you for applying" OR "application received" OR "application submitted" OR "we received your application" OR "application confirmation") -category:promotions -category:social',
        maxResults: 20
      })
    )
  );
  const threads = results.flatMap((result) => (result.status === 'fulfilled' ? result.value.threads : []));
  const errors = results
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map((result) => describeError(result.reason));
  const matches: CareerApplicationEvidence[] = [];
  for (const thread of threads) {
    const evidence = candidateJobs
      .map((item) => careerMailApplicationEvidence(thread, item))
      .filter((item): item is CareerApplicationEvidence => Boolean(item))
      .sort((a, b) => b.confidence - a.confidence)[0];
    if (!evidence?.thread) continue;
    if (matches.some((match) => match.job.id === evidence.job.id && match.thread?.id === evidence.thread?.id)) continue;
    matches.push(evidence);
  }
  if (!matches.length) {
    return {
      cards: [],
      matchedCount: 0,
      autoAppliedCount: 0,
      reviewCount: 0,
      ...(errors[0] ? { error: errors[0] } : {})
    };
  }
  const threshold = careerAutoMarkConfidenceThreshold(store);
  const autoEligible = careerAutoMarkAppliedEnabled(store)
    ? matches.filter((match) => match.confidence >= threshold)
    : [];
  const updates = autoEligible
    .map((match) => promoteCareerApplicationEvidence(store, match, runId))
    .filter((item): item is CareerApplicationAutoUpdate => Boolean(item));
  const updatedJobIds = new Set(updates.map((item) => item.job.id));
  const reviewMatches = matches.filter((match) => !updatedJobIds.has(match.job.id));
  const cards: PassiveResultCard[] = [];
  if (updates.length) {
    cards.push(
      card({
        id: id('passive-card'),
        taskId: task.id,
        runId,
        family: task.family,
        title: `${updates.length} application${updates.length === 1 ? '' : 's'} auto-marked applied`,
        summary: updates
          .slice(0, 4)
          .map((update) => `${update.job.company} - ${update.job.role}`)
          .join('; '),
        urgency: 74,
        confidence: Math.min(0.98, Math.max(...updates.map((update) => update.evidence.confidence))),
        route: routeMap.careerDesk,
        sourceRefs: updates.slice(0, 8).map((update) =>
          stableSourceRef('record', `${update.job.company} - ${update.job.role}`, {
            id: update.job.id,
            route: routeMap.careerDesk,
            metadata: compactRecord({
              previousStatus: update.before.status,
              status: update.job.status,
              source: update.evidence.source,
              confidence: update.evidence.confidence,
              matchedOn: update.evidence.matchedOn,
              gmailThreadId: update.evidence.thread?.id,
              gmailSubject: update.evidence.thread?.subject,
              gmailFrom: update.evidence.thread?.from,
              gmailDate: update.evidence.thread?.date,
              careerActionId: update.evidence.action?.id,
              followUpActionId: update.followUpAction.id,
              followUpDueAt: update.followUpAction.dueAt,
              reason: update.evidence.reason
            })
          })
        ),
        suggestedAction: 'Review updates',
        actionKind: 'inspect',
        why: `Career Radar found application evidence above the ${Math.round(threshold * 100)}% confidence threshold and updated matching saved leads with synced follow-up actions.`
      })
    );
  }
  if (reviewMatches.length) {
    cards.push(
      card({
        id: id('passive-card'),
        taskId: task.id,
        runId,
        family: task.family,
        title: `${reviewMatches.length} likely application confirmation${reviewMatches.length === 1 ? '' : 's'} need review`,
        summary: reviewMatches
          .slice(0, 4)
          .map((match) => `${match.job.company} - ${match.job.role}`)
          .join('; '),
        urgency: 78,
        confidence: Math.max(...reviewMatches.map((match) => match.confidence)),
        route: routeMap.careerDesk,
        sourceRefs: reviewMatches.slice(0, 8).map((match) =>
          stableSourceRef('record', `${match.job.company} - ${match.job.role}`, {
            id: match.job.id,
            route: routeMap.careerDesk,
            metadata: compactRecord({
              status: match.job.status,
              source: match.source,
              confidence: match.confidence,
              matchedOn: match.matchedOn,
              gmailThreadId: match.thread?.id,
              gmailSubject: match.thread?.subject,
              gmailFrom: match.thread?.from,
              gmailDate: match.thread?.date,
              reason: match.reason
            })
          })
        ),
        suggestedAction: 'Mark applied',
        actionKind: 'inspect',
        why: 'Gmail returned application-confirmation language that matched saved Career Desk leads, but the match stayed below the auto-update threshold. Use the row-level Mark applied action after reviewing it.'
      })
    );
  }
  return {
    matchedCount: matches.length,
    autoAppliedCount: updates.length,
    reviewCount: reviewMatches.length,
    ...(errors[0] ? { error: errors[0] } : {}),
    cards
  };
}

async function careerStatusUpdateCards(
  store: MemoryStore,
  task: PassiveTask,
  runId: string
): Promise<{
  cards: PassiveResultCard[];
  matchedCount: number;
  autoUpdatedCount: number;
  reviewCount: number;
  error?: string;
}> {
  const connections = careerMailConnections(store);
  if (!connections.length) return { cards: [], matchedCount: 0, autoUpdatedCount: 0, reviewCount: 0 };
  const candidateJobs = statusUpdateCandidateJobs(store);
  if (!candidateJobs.length) return { cards: [], matchedCount: 0, autoUpdatedCount: 0, reviewCount: 0 };
  const results = await Promise.allSettled(
    connections.map((connection) =>
      new GoogleGmailConnector(store, connection.id).listThreads({
        q: 'newer_than:45d (interview OR "schedule interview" OR "schedule a call" OR "next round" OR "phone screen" OR "technical screen" OR "offer letter" OR "we would like to offer" OR "not moving forward" OR "not selected" OR "after careful consideration") -category:promotions -category:social',
        maxResults: 25
      })
    )
  );
  const threads = results.flatMap((result) => (result.status === 'fulfilled' ? result.value.threads : []));
  const errors = results
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map((result) => describeError(result.reason));
  const matches: CareerStatusEvidence[] = [];
  for (const thread of threads) {
    const evidence = candidateJobs
      .map((item) => careerMailStatusEvidence(thread, item))
      .filter((item): item is CareerStatusEvidence => Boolean(item))
      .sort((a, b) => b.confidence - a.confidence)[0];
    if (!evidence) continue;
    if (
      matches.some(
        (match) =>
          match.job.id === evidence.job.id && match.thread.id === evidence.thread.id && match.targetStatus === evidence.targetStatus
      )
    ) {
      continue;
    }
    matches.push(evidence);
  }
  if (!matches.length) {
    return {
      cards: [],
      matchedCount: 0,
      autoUpdatedCount: 0,
      reviewCount: 0,
      ...(errors[0] ? { error: errors[0] } : {})
    };
  }
  const autoEligible = careerAutoMarkAppliedEnabled(store)
    ? matches.filter((match) => match.confidence >= careerStatusAutoThreshold(store, match.targetStatus))
    : [];
  const updates = autoEligible
    .map((match) => promoteCareerStatusEvidence(store, match, runId))
    .filter((item): item is CareerStatusAutoUpdate => Boolean(item));
  const updatedKeys = new Set(updates.map((item) => `${item.job.id}:${item.evidence.thread.id}:${item.evidence.targetStatus}`));
  const reviewMatches = matches.filter((match) => !updatedKeys.has(`${match.job.id}:${match.thread.id}:${match.targetStatus}`));
  const cards: PassiveResultCard[] = [];
  if (updates.length) {
    cards.push(
      card({
        id: id('passive-card'),
        taskId: task.id,
        runId,
        family: task.family,
        title: `${updates.length} career status update${updates.length === 1 ? '' : 's'} applied from Gmail`,
        summary: updates
          .slice(0, 4)
          .map((update) => `${update.job.company} - ${update.job.role} (${update.before.status} -> ${update.job.status})`)
          .join('; '),
        urgency: updates.some((update) => update.job.status === 'offer') ? 88 : updates.some((update) => update.job.status === 'interview') ? 82 : 76,
        confidence: Math.min(0.99, Math.max(...updates.map((update) => update.evidence.confidence))),
        route: routeMap.careerDesk,
        sourceRefs: updates.slice(0, 8).map((update) =>
          stableSourceRef('record', `${update.job.company} - ${update.job.role}`, {
            id: update.job.id,
            route: routeMap.careerDesk,
            metadata: compactRecord({
              previousStatus: update.before.status,
              status: update.job.status,
              source: update.evidence.source,
              confidence: update.evidence.confidence,
              matchedOn: update.evidence.matchedOn,
              gmailThreadId: update.evidence.thread.id,
              gmailSubject: update.evidence.thread.subject,
              gmailFrom: update.evidence.thread.from,
              gmailDate: update.evidence.thread.date,
              followUpActionId: update.followUpAction?.id,
              followUpDueAt: update.followUpAction?.dueAt,
              reason: update.evidence.reason
            })
          })
        ),
        suggestedAction: 'Review status',
        actionKind: 'inspect',
        why: 'Career Radar found high-confidence Gmail status evidence for matching Career Desk records and updated the job pipeline with a synced audit trail.'
      })
    );
  }
  if (reviewMatches.length) {
    cards.push(
      card({
        id: id('passive-card'),
        taskId: task.id,
        runId,
        family: task.family,
        title: `${reviewMatches.length} likely career status update${reviewMatches.length === 1 ? '' : 's'} need review`,
        summary: reviewMatches
          .slice(0, 4)
          .map((match) => `${match.job.company} - ${match.job.role} (${match.job.status} -> ${match.targetStatus})`)
          .join('; '),
        urgency: reviewMatches.some((match) => match.targetStatus === 'offer') ? 86 : 78,
        confidence: Math.max(...reviewMatches.map((match) => match.confidence)),
        route: routeMap.careerDesk,
        sourceRefs: reviewMatches.slice(0, 8).map((match) =>
          stableSourceRef('record', `${match.job.company} - ${match.job.role}`, {
            id: match.job.id,
            route: routeMap.careerDesk,
            metadata: compactRecord({
              status: match.job.status,
              targetStatus: match.targetStatus,
              source: match.source,
              confidence: match.confidence,
              threshold: careerStatusAutoThreshold(store, match.targetStatus),
              matchedOn: match.matchedOn,
              gmailThreadId: match.thread.id,
              gmailSubject: match.thread.subject,
              gmailFrom: match.thread.from,
              gmailDate: match.thread.date,
              reason: match.reason
            })
          })
        ),
        suggestedAction: 'Review status',
        actionKind: 'inspect',
        why: 'Gmail returned possible interview, offer, or rejection evidence, but the match stayed below the auto-update threshold or needed human review.'
      })
    );
  }
  return {
    matchedCount: matches.length,
    autoUpdatedCount: updates.length,
    reviewCount: reviewMatches.length,
    ...(errors[0] ? { error: errors[0] } : {}),
    cards
  };
}

async function runCareerRadar(store: MemoryStore, task: PassiveTask, runId: string): Promise<FamilyRunResult> {
  const now = Date.now();
  const soonMs = now + 14 * dayMs;
  const cards: PassiveResultCard[] = [];
  const completedActionEvidence = completedApplyActionEvidence(store);
  const completedActionThreshold = careerAutoMarkConfidenceThreshold(store);
  const completedActionUpdates = careerAutoMarkAppliedEnabled(store)
    ? completedActionEvidence
        .filter((evidence) => evidence.confidence >= completedActionThreshold)
        .map((evidence) => promoteCareerApplicationEvidence(store, evidence, runId))
        .filter((item): item is CareerApplicationAutoUpdate => Boolean(item))
    : [];
  if (completedActionUpdates.length) {
    cards.push(
      card({
        id: id('passive-card'),
        taskId: task.id,
        runId,
        family: task.family,
        title: `${completedActionUpdates.length} application${completedActionUpdates.length === 1 ? '' : 's'} marked applied from completed actions`,
        summary: completedActionUpdates
          .slice(0, 4)
          .map((update) => `${update.job.company} - ${update.job.role}`)
          .join('; '),
        urgency: 72,
        confidence: Math.min(0.98, Math.max(...completedActionUpdates.map((update) => update.evidence.confidence))),
        route: routeMap.careerDesk,
        sourceRefs: completedActionUpdates.slice(0, 8).map((update) =>
          stableSourceRef('record', `${update.job.company} - ${update.job.role}`, {
            id: update.job.id,
            route: routeMap.careerDesk,
            metadata: compactRecord({
              previousStatus: update.before.status,
              status: update.job.status,
              source: update.evidence.source,
              confidence: update.evidence.confidence,
              careerActionId: update.evidence.action?.id,
              followUpActionId: update.followUpAction.id,
              followUpDueAt: update.followUpAction.dueAt,
              reason: update.evidence.reason
            })
          })
        ),
        suggestedAction: 'Review updates',
        actionKind: 'inspect',
        why: 'A completed linked Career action looked like an apply/submit action, so Career Radar promoted the saved lead and created a synced application follow-up.'
      })
    );
  }
  const mailConfirmations = await careerApplicationConfirmationCards(store, task, runId);
  const mailStatusUpdates = await careerStatusUpdateCards(store, task, runId);
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

  cards.push(...mailConfirmations.cards);
  cards.push(...mailStatusUpdates.cards);

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
      submittedApplicationFollowUps: submittedJobs.length,
      gmailApplicationConfirmations: mailConfirmations.matchedCount,
      gmailAutoMarkedApplied: mailConfirmations.autoAppliedCount,
      gmailApplicationConfirmationsNeedingReview: mailConfirmations.reviewCount,
      gmailCareerStatusUpdates: mailStatusUpdates.matchedCount,
      gmailCareerStatusAutoUpdated: mailStatusUpdates.autoUpdatedCount,
      gmailCareerStatusUpdatesNeedingReview: mailStatusUpdates.reviewCount,
      completedApplyActionAutoMarkedApplied: completedActionUpdates.length,
      ...(mailConfirmations.error ? { gmailApplicationConfirmationError: mailConfirmations.error } : {}),
      ...(mailStatusUpdates.error ? { gmailCareerStatusUpdateError: mailStatusUpdates.error } : {})
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

function scanTodos(folder: string, budget: PassiveResourceBudget): ProjectTodoScan {
  let total = 0;
  const files: ProjectTodoFile[] = [];
  const stack = [folder];
  const ignored = new Set(['node_modules', '.git', 'dist', 'build', '.svelte-kit', 'coverage']);
  while (stack.length && total < budget.projectTodoCap) {
    const current = stack.pop()!;
    for (const entry of readdirSync(current, { withFileTypes: true }).slice(0, budget.projectDirectoryEntries)) {
      if (entry.isDirectory()) {
        if (!ignored.has(entry.name)) stack.push(join(current, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      const extension = extname(entry.name).toLowerCase();
      if (!['.ts', '.js', '.svelte', '.py', '.md', '.txt'].includes(extension)) continue;
      const path = join(current, entry.name);
      const text = readFileSync(path, 'utf8').slice(0, budget.projectFileChars);
      const lines = text.split(/\r?\n/u);
      const todoLines = lines
        .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
        .filter((item) => /\b(TODO|FIXME)\b/iu.test(item.line));
      if (!todoLines.length) continue;
      total += todoLines.length;
      const stats = statSync(path);
      files.push({
        path,
        count: todoLines.length,
        sample: `L${todoLines[0]!.lineNumber}: ${todoLines[0]!.line.slice(0, 180)}`,
        mtimeMs: stats.mtimeMs
      });
      if (total >= budget.projectTodoCap) break;
    }
  }
  return {
    total,
    files: files.sort((a, b) => b.count - a.count || b.mtimeMs - a.mtimeMs).slice(0, 8)
  };
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
  let todoMarkerCount = 0;
  let todoFileCount = 0;
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

      const todoScan = scanTodos(resolved, budget);
      todoMarkerCount += todoScan.total;
      todoFileCount += todoScan.files.length;
      if (todoScan.total >= 20) {
        issues.push(`${todoScan.total} TODO/FIXME markers across ${todoScan.files.length} file${todoScan.files.length === 1 ? '' : 's'}`);
        for (const todoFile of todoScan.files) {
          changed.push(`todo-buildup:${todoFile.path}`);
          sourceRefs.push(
            stableSourceRef('file', basename(todoFile.path), {
              id: todoFile.path,
              filePath: todoFile.path,
              metadata: {
                reason: 'todo-buildup',
                todoCount: todoFile.count,
                sample: todoFile.sample,
                mtimeMs: todoFile.mtimeMs
              }
            })
          );
        }
      }

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
        docDriftCount,
        todoMarkerCount,
        todoFileCount
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

function manualTriggerId(task: PassiveTask): string {
  return `passive-trigger:manual:${task.id}`;
}

function updateManualTriggerAfterRun(store: MemoryStore, task: PassiveTask, run: PassiveRun): void {
  syncPassiveTriggersFromTasks(store);
  const triggerId = manualTriggerId(task);
  const now = nowIso();
  const existing = store.passiveTriggers.find((trigger) => trigger.id === triggerId);
  const next = passiveTriggerSchema.parse({
    ...(existing ?? {
      id: triggerId,
      kind: 'manual',
      label: 'Manual run',
      createdAt: task.createdAt
    }),
    kind: 'manual',
    watcherId: task.watcherId,
    taskIds: [task.id],
    enabled: watcherEnabled(store, task) && !['paused', 'cancelled'].includes(task.status),
    lastFiredAt: run.finishedAt ?? now,
    lastRunId: run.id,
    lastStatus: run.status,
    nextRunAt: undefined,
    error: run.status === 'failed' || run.status === 'blocked' ? run.error : undefined,
    updatedAt: now,
    metadata: {
      ...(existing?.metadata ?? {}),
      taskCount: 1,
      source: 'manual-run'
    }
  });
  if (existing) {
    store.passiveTriggers = store.passiveTriggers.map((trigger) => (trigger.id === triggerId ? next : trigger));
  } else {
    store.passiveTriggers.push(next);
  }

  const watcherIndex = store.passiveWatchers.findIndex((watcher) => watcher.id === task.watcherId);
  if (watcherIndex >= 0) {
    const watcher = store.passiveWatchers[watcherIndex]!;
    store.passiveWatchers[watcherIndex] = passiveWatcherSchema.parse({
      ...watcher,
      triggerIds: [...new Set([...watcher.triggerIds, triggerId])],
      updatedAt: now
    });
  }
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
  const manualRun = options.input?.manual === true;
  const previousNextRunAt = task.nextRunAt ?? task.trigger.nextRunAt;
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
  const preserveSchedule =
    manualRun &&
    ['succeeded', 'skipped'].includes(result.status) &&
    !(task.family === 'research_monitor' && careerDiscoveryMaxPowerSearchEnabled(store));
  const nextRunAt = preserveSchedule ? previousNextRunAt : nextRunAfterResultForStore(store, task, result.status, finished);
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
      triggerKind: manualRun ? 'manual' : options.input?.eventName ? 'event' : options.input?.idle ? 'idle' : 'schedule',
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

  const appliedTask = applyRunOutcomeToTask(taskAfterExecution.status === 'cancelled' ? taskAfterExecution : task, run, finished);
  const nextTask =
    nextRunAt !== appliedTask.nextRunAt || nextRunAt !== appliedTask.trigger.nextRunAt
      ? passiveTaskSchema.parse({ ...appliedTask, nextRunAt, trigger: { ...appliedTask.trigger, nextRunAt } })
      : appliedTask;
  store.passiveTasks[taskIndex] = nextTask;
  updateWatcherAfterRun(store, nextTask, run);
  if (manualRun) {
    updateManualTriggerAfterRun(store, nextTask, run);
  } else {
    updateTriggerAfterRun(store, nextTask, run);
  }

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
  applyPassiveRunIdleInput(store, options.input);
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
  const nextRunAt =
    status === 'cancelled'
      ? undefined
      : status === 'active' && !existing.nextRunAt
        ? computeNextRunAt(existing)
        : existing.nextRunAt;
  const next = passiveTaskSchema.parse({
    ...existing,
    status,
    nextRunAt,
    trigger: { ...existing.trigger, nextRunAt },
    retry:
      status === 'active' || status === 'cancelled'
        ? { ...existing.retry, attempts: 0, nextRetryAt: undefined }
        : existing.retry,
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

function passiveCardFreshForDigest(
  store: MemoryStore,
  cardItem: PassiveResultCard,
  digestItem: PassiveResultCard,
  run: PassiveRun | undefined,
  checkedAt: Date
): boolean {
  if (passiveCardImportant(store, cardItem.id)) return true;
  if (run?.status === 'failed' || run?.status === 'blocked') return true;
  if (passiveCardResolvedByLaterRun(store, cardItem, run)) return false;
  const createdAt = parseTime(cardItem.createdAt);
  if (!Number.isFinite(createdAt)) return true;
  const ageMs = checkedAt.getTime() - createdAt;
  if (ageMs <= passiveDigestFreshMs) return true;
  return digestItem.urgency >= 85 && ageMs <= passiveDigestUrgentFreshMs;
}

function passiveRunTime(run: PassiveRun | undefined): number {
  if (!run) return Number.NaN;
  const finishedAt = parseTime(run.finishedAt);
  if (Number.isFinite(finishedAt)) return finishedAt;
  return parseTime(run.startedAt);
}

function passiveCardResolvedByLaterRun(store: MemoryStore, cardItem: PassiveResultCard, run: PassiveRun | undefined): boolean {
  const latestRun = latestRunForTask(store, cardItem.taskId);
  if (!latestRun || latestRun.id === run?.id) return false;
  if (latestRun.status === 'failed' || latestRun.status === 'blocked' || latestRun.error) return false;

  const cardCreatedAt = parseTime(cardItem.createdAt);
  const latestRunAt = passiveRunTime(latestRun);
  if (!Number.isFinite(cardCreatedAt) || !Number.isFinite(latestRunAt) || latestRunAt <= cardCreatedAt) return false;

  return !latestRun.cards.some((latestCard) => latestCard.title === cardItem.title);
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
    if (!passiveCardFreshForDigest(store, item, digestItem, run, checkedAt)) continue;
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

function backupSourceError(health: PassiveBackupHealth): string | undefined {
  if (health.status === 'ok') return undefined;
  return health.error ?? (health.stale ? 'Latest restore snapshot is stale.' : `Restore point health is ${health.status}.`);
}

function backupSourceDetails(health: PassiveBackupHealth): Record<string, unknown> {
  const details: Record<string, unknown> = {
    backupStatus: health.status,
    backupOk: health.ok,
    snapshotRoot: health.snapshotRoot,
    snapshotCount: health.snapshotCount,
    stale: health.stale,
    cleanupCandidateCount: health.cleanupCandidateCount,
    cleanupBytes: health.cleanupBytes,
    latestRedactedTokenSets: health.latestRedactedTokenSets
  };
  if (health.latestPath) details.latestSnapshotPath = health.latestPath;
  if (health.latestAgeHours !== undefined) details.latestSnapshotAgeHours = health.latestAgeHours;
  if (health.latestBytes !== undefined) details.latestSnapshotBytes = health.latestBytes;
  if (health.latestSha256) details.latestSnapshotSha256 = health.latestSha256;
  if (Object.keys(health.latestSummary).length) details.latestSnapshotSummary = health.latestSummary;
  if (health.error) details.backupError = health.error;
  return details;
}

export function buildPassiveSourceStatuses(store: MemoryStore, backupHealth = buildPassiveBackupHealth()): PassiveSourceStatus[] {
  const currentMode = currentPassiveMachineMode(store);
  const checkedAt = new Date();
  const settings = store.passiveSettings ?? defaultPassiveSettings(checkedAt);
  const policyInput: PassiveRunInput = {};
  if (store.passiveWorker?.lastIdle?.idle !== undefined) policyInput.idle = store.passiveWorker.lastIdle.idle;
  if (store.passiveWorker?.lastIdle?.idleMinutes !== undefined) policyInput.idleMinutes = store.passiveWorker.lastIdle.idleMinutes;
  if (store.passiveWorker?.lastIdle?.source) policyInput.idleSource = store.passiveWorker.lastIdle.source;
  const policyContext = passiveModePolicyContext(store, checkedAt, policyInput);
  const workerIntervalMs =
    typeof store.passiveWorker?.intervalMs === 'number' && store.passiveWorker.intervalMs > 0
      ? store.passiveWorker.intervalMs
      : 5 * minuteMs;
  const overdueGraceMs = Math.max(passiveSourceOverdueGraceMs, workerIntervalMs * 2);
  return store.passiveTasks.map((task) => {
    const run = latestRunForTask(store, task.id);
    const fetchedAt = run?.finishedAt ?? task.lastRunAt;
    const nextRunAt = task.nextRunAt ?? task.trigger.nextRunAt;
    const fetchedAtMs = parseTime(fetchedAt);
    const nextRunAtMs = parseTime(nextRunAt);
    const scheduleLagMs = Number.isFinite(nextRunAtMs) ? checkedAt.getTime() - nextRunAtMs : Number.NaN;
    const taskMode = taskMachineMode(store, task);
    const modePolicy = passiveModePolicy(task, currentMode, policyContext);
    const taskEnabled =
      settings.enabled && watcherEnabled(store, task) && !['paused', 'cancelled'].includes(task.status);
    const waitsForIdle =
      (settings.idleOnly || task.idleOnly || task.trigger.kind === 'idle') && store.passiveWorker?.lastIdle?.idle !== true;
    const scheduleOverdue =
      taskEnabled &&
      ['active', 'failed'].includes(task.status) &&
      modePolicy.allowed &&
      !waitsForIdle &&
      Number.isFinite(scheduleLagMs) &&
      scheduleLagMs > overdueGraceMs;
    const scheduleState = !settings.enabled
      ? 'engine_disabled'
      : !watcherEnabled(store, task)
        ? 'watcher_disabled'
        : task.status === 'paused' || task.status === 'cancelled'
          ? task.status
          : !modePolicy.allowed
            ? 'mode_deferred'
            : waitsForIdle
              ? 'waiting_for_idle'
              : scheduleOverdue
                ? 'overdue'
                : Number.isFinite(scheduleLagMs) && scheduleLagMs > 0
                  ? 'due'
                  : nextRunAt
                    ? 'scheduled'
                    : task.trigger.kind === 'event'
                      ? 'waiting_for_event'
                      : 'unscheduled';
    const staleError = scheduleOverdue
      ? `${task.title} is ${Math.round(scheduleLagMs / minuteMs)} min overdue. Check the worker or run it manually.`
      : undefined;
    const restorePointError = task.family === 'backup_snapshot' ? backupSourceError(backupHealth) : undefined;
    const error = task.lastError ?? run?.error ?? staleError ?? restorePointError;
    const status: PassiveSourceStatus['status'] =
      task.family === 'backup_snapshot' && backupHealth.status !== 'ok'
        ? 'error'
        : task.status === 'blocked' || run?.status === 'failed' || run?.status === 'blocked'
        ? 'error'
        : scheduleOverdue
          ? 'error'
          : taskEnabled
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
        nextRunAt,
        nextRetryAt: task.retry.nextRetryAt,
        status: task.status,
        lastRunStatus: run?.status,
        scheduleState,
        overdueGraceMinutes: Math.round(overdueGraceMs / minuteMs),
        ...(Number.isFinite(scheduleLagMs) && scheduleLagMs > 0
          ? { scheduleLagMinutes: Math.round(scheduleLagMs / minuteMs) }
          : {}),
        ...(Number.isFinite(fetchedAtMs)
          ? { lastRunAgeMinutes: Math.max(0, Math.round((checkedAt.getTime() - fetchedAtMs) / minuteMs)) }
          : {}),
        errorLogCount: task.errorLog.length,
        latestErrorAt: task.errorLog[0]?.at,
        machineMode: taskMode.mode,
        machineModeSource: taskMode.source,
        modePolicy: modePolicy.allowed ? 'allowed' : 'deferred',
        ...(modePolicy.reason ? { modePolicyReason: modePolicy.reason } : {}),
        ...(currentMode === 'auto'
          ? {
              autoIdle: policyContext.idle,
              autoActiveUse: policyContext.activeUse,
              autoActiveReason: policyContext.activeReason,
              autoActiveSignalAgeMinutes: policyContext.activeSignalAgeMinutes,
              autoProfileFresh: policyContext.profileFresh,
              autoHighPressure: policyContext.highPressure,
              autoPressureDrivers: policyContext.pressureDrivers
            }
          : {}),
        ...(task.idleOnly || task.family === 'idle_compute'
          ? {
              idleOnly: task.idleOnly,
              idleThresholdMinutes: task.trigger.idleMinutes,
              lastIdle: run?.metadata.idle ?? store.passiveWorker?.lastIdle?.idle,
              lastIdleMinutes: run?.metadata.idleMinutes ?? store.passiveWorker?.lastIdle?.idleMinutes,
              lastIdleSource: run?.metadata.idleSource ?? store.passiveWorker?.lastIdle?.source,
              lastIdleError: run?.metadata.idleError ?? store.passiveWorker?.lastIdle?.error
            }
          : {}),
        ...(task.family === 'research_monitor' ? careerDiscoverySourceDetails(store, settings, run) : {}),
        ...(task.family === 'backup_snapshot' ? backupSourceDetails(backupHealth) : {})
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
  const backupHealth = buildPassiveBackupHealth();
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
    sources: buildPassiveSourceStatuses(store, backupHealth),
    backupHealth,
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
      title: compactPassiveServiceText(item.title, 'Passive Tasks', 140),
      detail: compactPassiveServiceText(item.summary, 'Passive Tasks', 260),
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
