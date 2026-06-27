import {
  personalUserId,
  personalWorkspaceId,
  actionLedgerEntrySchema,
  achievementSchema,
  careerActionSchema,
  gameRunSchema,
  gameStateSchema,
  integrationConnectionSchema,
  jobSchema,
  noteSchema,
  passiveEnginePersistedStateSchema,
  passiveWorkerStateSchema,
  personalSettingsSchema,
  studySessionSchema,
  syncEventSchema,
  workspaceSchema,
  type ActionLedgerEntry,
  type Achievement,
  type CareerActionRecord,
  type GameRun,
  type GameState,
  type IntegrationConnection,
  type JobRecord,
  type NoteRecord,
  type PassiveEngineSettings,
  type PassiveNotification,
  type PassiveResult,
  type PassiveRun,
  type PassiveTask,
  type PassiveTrigger,
  type PassiveWatcher,
  type PassiveWorkerState,
  type PersonalSettings,
  type StudySession,
  type SyncEvent,
  type Workspace
} from '@mini-hub/core';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';

const actionLedgerRetentionLimit = 1000;
const workspaceMemberSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  userId: z.string().min(1),
  role: z.enum(['owner', 'admin', 'member', 'viewer'])
});
const coreDataPersistedStateSchema = z.object({
  version: z.literal(1),
  workspaces: z.array(workspaceSchema).default([]),
  members: z.array(workspaceMemberSchema).default([]),
  jobs: z.array(jobSchema).default([]),
  studySessions: z.array(studySessionSchema).default([]),
  careerActions: z.array(careerActionSchema).default([]),
  gameRuns: z.array(gameRunSchema).default([]),
  settings: personalSettingsSchema.nullable().default(null),
  gameStates: z.array(gameStateSchema).default([]),
  achievements: z.array(achievementSchema).default([]),
  notes: z.array(noteSchema).default([]),
  syncEvents: z.array(syncEventSchema).default([])
});
const actionLedgerPersistedStateSchema = z.object({
  version: z.literal(1),
  events: z.array(actionLedgerEntrySchema).default([])
});

export interface WorkspaceMember {
  id: string;
  workspaceId: string;
  userId: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
}

export interface MemoryStore {
  workspaces: Map<string, Workspace>;
  members: WorkspaceMember[];
  jobs: JobRecord[];
  studySessions: StudySession[];
  careerActions: CareerActionRecord[];
  gameRuns: GameRun[];
  settings: PersonalSettings | null;
  gameStates: Map<string, GameState>;
  achievements: Achievement[];
  notes: NoteRecord[];
  coreDataPersistencePath?: string;
  integrationConnections: Map<string, IntegrationConnection>;
  integrationPersistencePath?: string;
  syncEvents: SyncEvent[];
  actionEvents: ActionLedgerEntry[];
  actionLedgerPersistencePath?: string;
  passiveSettings: PassiveEngineSettings | null;
  passiveWatchers: PassiveWatcher[];
  passiveTriggers: PassiveTrigger[];
  passiveTasks: PassiveTask[];
  passiveWorker: PassiveWorkerState | null;
  passiveRuns: PassiveRun[];
  passiveResults: PassiveResult[];
  passiveNotifications: PassiveNotification[];
  passivePersistencePath?: string;
}

export function createMemoryStore(): MemoryStore {
  return {
    workspaces: new Map(),
    members: [],
    jobs: [],
    studySessions: [],
    careerActions: [],
    gameRuns: [],
    settings: null,
    gameStates: new Map(),
    achievements: [],
    notes: [],
    integrationConnections: new Map(),
    syncEvents: [],
    actionEvents: [],
    passiveSettings: null,
    passiveWatchers: [],
    passiveTriggers: [],
    passiveTasks: [],
    passiveWorker: null,
    passiveRuns: [],
    passiveResults: [],
    passiveNotifications: []
  };
}

export function integrationConnectionsPath(dataDir: string): string {
  return join(dataDir, 'integration-connections.json');
}

export function coreDataPath(dataDir: string): string {
  return join(dataDir, 'core-data.json');
}

export function passiveTasksPath(dataDir: string): string {
  return join(dataDir, 'passive-tasks.json');
}

export function actionLedgerPath(dataDir: string): string {
  return join(dataDir, 'action-ledger.json');
}

function writeJsonFile(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  writeFileSync(tempPath, JSON.stringify(value, null, 2), 'utf8');
  renameSync(tempPath, path);
}

export function enableCoreDataPersistence(store: MemoryStore, path: string): void {
  store.coreDataPersistencePath = path;
  mkdirSync(dirname(path), { recursive: true });
  if (!existsSync(path)) return;

  try {
    const parsed = coreDataPersistedStateSchema.parse(JSON.parse(readFileSync(path, 'utf8')) as unknown);
    store.workspaces = new Map(parsed.workspaces.map((workspace) => [workspace.id, workspace]));
    store.members = parsed.members;
    store.jobs = parsed.jobs;
    store.studySessions = parsed.studySessions;
    store.careerActions = parsed.careerActions;
    store.gameRuns = parsed.gameRuns;
    store.settings = parsed.settings;
    store.gameStates = new Map(parsed.gameStates.map((state) => [state.gameId, state]));
    store.achievements = parsed.achievements;
    store.notes = parsed.notes;
    store.syncEvents = parsed.syncEvents;
  } catch (error) {
    console.warn(`Could not load persisted Mini Hub core data: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
}

export function persistCoreData(store: MemoryStore): void {
  if (!store.coreDataPersistencePath) return;
  const state = coreDataPersistedStateSchema.parse({
    version: 1,
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
    syncEvents: store.syncEvents
  });
  writeJsonFile(store.coreDataPersistencePath, state);
}

export function enableIntegrationPersistence(store: MemoryStore, path: string): void {
  store.integrationPersistencePath = path;
  mkdirSync(dirname(path), { recursive: true });
  if (!existsSync(path)) return;

  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    const connections = integrationConnectionSchema.array().parse(parsed);
    store.integrationConnections = new Map(connections.map((connection) => [connection.id, connection]));
  } catch (error) {
    console.warn(
      `Could not load persisted integration connections: ${error instanceof Error ? error.message : 'unknown error'}`
    );
  }
}

export function persistIntegrationConnections(store: MemoryStore): void {
  if (!store.integrationPersistencePath) return;
  const connections = Array.from(store.integrationConnections.values());
  writeJsonFile(store.integrationPersistencePath, connections);
}

export function enablePassiveTaskPersistence(store: MemoryStore, path: string): void {
  store.passivePersistencePath = path;
  mkdirSync(dirname(path), { recursive: true });
  if (!existsSync(path)) return;

  try {
    const parsed = passiveEnginePersistedStateSchema.parse(JSON.parse(readFileSync(path, 'utf8')) as unknown);
    store.passiveSettings = parsed.settings;
    store.passiveWorker = parsed.worker
      ? passiveWorkerStateSchema.parse({
          ...parsed.worker,
          running: false,
          activeFileWatchCount: 0,
          pendingFileEvent: false,
          stoppedAt: parsed.worker.running ? new Date().toISOString() : parsed.worker.stoppedAt
        })
      : null;
    store.passiveWatchers = parsed.watchers;
    store.passiveTriggers = parsed.triggers;
    store.passiveTasks = parsed.tasks;
    store.passiveRuns = parsed.runs;
    store.passiveResults = parsed.results;
    store.passiveNotifications = parsed.notifications;
  } catch (error) {
    console.warn(`Could not load persisted passive tasks: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
}

export function persistPassiveTasks(store: MemoryStore): void {
  if (!store.passivePersistencePath) return;
  const state = passiveEnginePersistedStateSchema.parse({
    version: 1,
    settings: store.passiveSettings,
    worker: store.passiveWorker,
    watchers: store.passiveWatchers,
    triggers: store.passiveTriggers,
    tasks: store.passiveTasks,
    runs: store.passiveRuns.slice(0, 200),
    results: store.passiveResults.slice(0, 500),
    notifications: store.passiveNotifications.slice(0, 200)
  });
  writeJsonFile(store.passivePersistencePath, state);
}

export function enableActionLedgerPersistence(store: MemoryStore, path: string): void {
  store.actionLedgerPersistencePath = path;
  mkdirSync(dirname(path), { recursive: true });
  if (!existsSync(path)) return;

  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    const state = actionLedgerPersistedStateSchema.parse(Array.isArray(parsed) ? { version: 1, events: parsed } : parsed);
    store.actionEvents = state.events.slice(-actionLedgerRetentionLimit);
  } catch (error) {
    console.warn(`Could not load persisted action ledger: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
}

export function persistActionLedgerEvents(store: MemoryStore): void {
  if (!store.actionLedgerPersistencePath) return;
  const state = actionLedgerPersistedStateSchema.parse({
    version: 1,
    events: store.actionEvents.slice(-actionLedgerRetentionLimit).map(redactActionLedgerEvent)
  });
  writeJsonFile(store.actionLedgerPersistencePath, state);
}

export const defaultStore = createMemoryStore();
export const ledgerMetadataKey = '__miniHubLedger';

export interface LedgerEventMetadata {
  before?: unknown;
  reason?: string;
  restoredFrom?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function withLedgerMetadata<T extends object>(
  payload: T,
  metadata: LedgerEventMetadata
): T & { [ledgerMetadataKey]: LedgerEventMetadata } {
  return {
    ...payload,
    [ledgerMetadataKey]: metadata
  };
}

export function withBeforeSnapshot<T extends object>(
  payload: T,
  before: unknown,
  reason = 'pre-action'
): T & { [ledgerMetadataKey]: LedgerEventMetadata } {
  return withLedgerMetadata(payload, { before, reason });
}

export function ledgerMetadataFromPayload(payload: Record<string, unknown>): LedgerEventMetadata {
  const metadata = payload[ledgerMetadataKey];
  if (!isRecord(metadata)) return {};
  const result: LedgerEventMetadata = {};
  if ('before' in metadata) result.before = metadata.before;
  if (typeof metadata.reason === 'string') result.reason = metadata.reason;
  if (typeof metadata.restoredFrom === 'string') result.restoredFrom = metadata.restoredFrom;
  return result;
}

export function userWorkspaceIds(store: MemoryStore, userId: string): Set<string> {
  return new Set(store.members.filter((member) => member.userId === userId).map((member) => member.workspaceId));
}

export function ensurePersonalWorkspace(store: MemoryStore): Workspace {
  let workspace = store.workspaces.get(personalWorkspaceId);
  const now = new Date().toISOString();
  let changed = false;
  if (!workspace) {
    workspace = {
      id: personalWorkspaceId,
      name: 'Personal Mini Hub',
      ownerId: personalUserId,
      createdAt: now,
      updatedAt: now
    };
    store.workspaces.set(workspace.id, workspace);
    changed = true;
  }

  if (!store.members.some((member) => member.workspaceId === personalWorkspaceId && member.userId === personalUserId)) {
    store.members.push({
      id: 'personal-owner',
      workspaceId: personalWorkspaceId,
      userId: personalUserId,
      role: 'owner'
    });
    changed = true;
  }

  if (changed) persistCoreData(store);
  return workspace;
}

export function appendSyncEvent(
  store: MemoryStore,
  input: Omit<SyncEvent, 'id' | 'createdAt'>
): SyncEvent {
  const event: SyncEvent = {
    ...input,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString()
  };
  store.syncEvents.push(event);
  persistCoreData(store);
  return event;
}

export function appendActionLedgerEvent(
  store: MemoryStore,
  input: Omit<ActionLedgerEntry, 'id' | 'occurredAt'> & Partial<Pick<ActionLedgerEntry, 'id' | 'occurredAt'>>
): ActionLedgerEntry {
  const event = actionLedgerEntrySchema.parse({
    ...input,
    id: input.id ?? `mini-hub-action:${crypto.randomUUID()}`,
    occurredAt: input.occurredAt ?? new Date().toISOString()
  });
  store.actionEvents.push(event);
  store.actionEvents = store.actionEvents.slice(-actionLedgerRetentionLimit);
  persistActionLedgerEvents(store);
  return event;
}

export function redactActionLedgerEvent(event: ActionLedgerEntry): ActionLedgerEntry {
  return actionLedgerEntrySchema.parse(redactSensitiveValue(event));
}

function redactSensitiveValue(value: unknown, key = ''): unknown {
  if (sensitiveKey(key)) return '[redacted]';
  if (Array.isArray(value)) return value.map((item) => redactSensitiveValue(item));
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([entryKey, item]) => [entryKey, redactSensitiveValue(item, entryKey)]));
  }
  if (typeof value === 'string') return redactSensitiveString(value);
  return value;
}

function sensitiveKey(key: string): boolean {
  const normalized = key.replace(/[-_\s]/gu, '').toLowerCase();
  return (
    normalized === 'encryptedtokenset' ||
    normalized === 'tokenset' ||
    normalized === 'apikey' ||
    normalized === 'clientsecret' ||
    normalized.endsWith('token') ||
    normalized.includes('secret') ||
    normalized.includes('authorization') ||
    normalized.includes('password') ||
    normalized.includes('credential')
  );
}

function redactSensitiveString(value: string): string {
  return value.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gu, 'Bearer [redacted]');
}
