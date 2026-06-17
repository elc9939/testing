import {
  personalUserId,
  personalWorkspaceId,
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
  syncEvents: SyncEvent[];
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
    syncEvents: []
  };
}

export const defaultStore = createMemoryStore();

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
