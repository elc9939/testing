import {
  personalUserId,
  personalWorkspaceId,
  actionLedgerEntrySchema,
  integrationConnectionSchema,
  type ActionLedgerEntry,
  type Achievement,
  type CareerActionRecord,
  type GameRun,
  type GameState,
  type IntegrationConnection,
  type JobRecord,
  type NoteRecord,
  type PersonalSettings,
  type StudySession,
  type SyncEvent,
  type Workspace
} from '@mini-hub/core';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

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
  integrationConnections: Map<string, IntegrationConnection>;
  integrationPersistencePath?: string;
  syncEvents: SyncEvent[];
  actionEvents: ActionLedgerEntry[];
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
    actionEvents: []
  };
}

export function integrationConnectionsPath(dataDir: string): string {
  return join(dataDir, 'integration-connections.json');
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
  mkdirSync(dirname(store.integrationPersistencePath), { recursive: true });
  const connections = Array.from(store.integrationConnections.values());
  writeFileSync(store.integrationPersistencePath, JSON.stringify(connections, null, 2), 'utf8');
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
  if (!workspace) {
    workspace = {
      id: personalWorkspaceId,
      name: 'Personal Mini Hub',
      ownerId: personalUserId,
      createdAt: now,
      updatedAt: now
    };
    store.workspaces.set(workspace.id, workspace);
  }

  if (!store.members.some((member) => member.workspaceId === personalWorkspaceId && member.userId === personalUserId)) {
    store.members.push({
      id: 'personal-owner',
      workspaceId: personalWorkspaceId,
      userId: personalUserId,
      role: 'owner'
    });
  }

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
  return event;
}
