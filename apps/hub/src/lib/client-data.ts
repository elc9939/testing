import { get, writable } from 'svelte/store';
import {
  createDeviceId,
  personalWorkspaceId,
  type GameRun,
  type GameState,
  type JobRecord,
  type PersonalSettings,
  type StudySession,
  type SyncEvent
} from '@mini-hub/core';
import { apiUrl } from './api';

type PGliteDatabase = Awaited<ReturnType<typeof import('@mini-hub/db/local').createMiniHubPglite>>;
type JobPatchInput = Partial<Pick<JobRecord, 'company' | 'role' | 'status' | 'notes'>> & {
  nextActionAt?: string | null;
};
type StudySessionPatchInput = Partial<Pick<StudySession, 'subject' | 'minutes' | 'source'>>;

const syncKeyStorageKey = 'miniHub.personalSyncKey.v1';
const deviceIdStorageKey = 'miniHub.deviceId.v1';
const cursorStorageKey = 'miniHub.syncCursor.v1';

export interface ClientDataState {
  initialized: boolean;
  isOnline: boolean;
  syncKey: string;
  deviceId: string;
  workspaceId: string;
  cursor: string;
  lastSyncedAt: string;
  status: 'idle' | 'syncing' | 'offline-readonly' | 'missing-key' | 'error';
  error: string;
  jobs: JobRecord[];
  studySessions: StudySession[];
  gameRuns: GameRun[];
  settings: PersonalSettings | null;
  gameStates: GameState[];
}

export function canAutoSave(state: Pick<ClientDataState, 'isOnline' | 'syncKey'>): boolean {
  return state.isOnline && state.syncKey.trim().length > 0;
}

function browserOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}

function readStorage(key: string, fallback = ''): string {
  if (typeof localStorage === 'undefined') return fallback;
  return localStorage.getItem(key) ?? fallback;
}

function writeStorage(key: string, value: string): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(key, value);
}

function ensureDeviceId(): string {
  const existing = readStorage(deviceIdStorageKey);
  if (existing) return existing;
  const next = createDeviceId('web');
  writeStorage(deviceIdStorageKey, next);
  return next;
}

function json(value: unknown): string {
  return JSON.stringify(value ?? {});
}

function parseJson(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function headers(syncKey: string): HeadersInit {
  return {
    'content-type': 'application/json',
    'x-mini-hub-sync-key': syncKey
  };
}

async function requestJson<T>(path: string, syncKey: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...headers(syncKey),
      ...(init.headers ?? {})
    }
  });

  if (!response.ok) {
    throw new Error(`Request ${path} failed with ${response.status}`);
  }
  return (await response.json()) as T;
}

export function createClientDataStore() {
  let db: PGliteDatabase | null = null;
  let initPromise: Promise<void> | null = null;
  let intervalId: number | null = null;
  let listenersBound = false;

  const store = writable<ClientDataState>({
    initialized: false,
    isOnline: browserOnline(),
    syncKey: readStorage(syncKeyStorageKey),
    deviceId: ensureDeviceId(),
    workspaceId: personalWorkspaceId,
    cursor: readStorage(cursorStorageKey),
    lastSyncedAt: '',
    status: readStorage(syncKeyStorageKey) ? 'idle' : 'missing-key',
    error: '',
    jobs: [],
    studySessions: [],
    gameRuns: [],
    settings: null,
    gameStates: []
  });

  function setPartial(partial: Partial<ClientDataState>): void {
    store.update((state) => ({ ...state, ...partial }));
  }

  async function getDb(): Promise<PGliteDatabase> {
    if (db) return db;
    const { createMiniHubPglite } = await import('@mini-hub/db/local');
    db = await createMiniHubPglite({
      dataDir: import.meta.env.PUBLIC_PGLITE_DATA_DIR || 'idb://mini-hub'
    });
    return db;
  }

  async function upsertJob(job: JobRecord): Promise<void> {
    const local = await getDb();
    await local.query(
      `insert into jobs (id, workspace_id, company, role, status, fit_score, next_action_at, notes, device_id, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       on conflict (id) do update set
       workspace_id=excluded.workspace_id,
       company=excluded.company,
       role=excluded.role,
       status=excluded.status,
       fit_score=excluded.fit_score,
       next_action_at=excluded.next_action_at,
       notes=excluded.notes,
       device_id=excluded.device_id,
       updated_at=excluded.updated_at`,
      [
        job.id,
        job.workspaceId,
        job.company,
        job.role,
        job.status,
        job.fitScore ?? null,
        job.nextActionAt ?? null,
        job.notes,
        job.deviceId,
        job.updatedAt
      ]
    );
  }

  async function upsertStudySession(session: StudySession): Promise<void> {
    const local = await getDb();
    await local.query(
      `insert into study_sessions (id, workspace_id, subject, minutes, source, logged_at, device_id, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (id) do update set
       workspace_id=excluded.workspace_id,
       subject=excluded.subject,
       minutes=excluded.minutes,
       source=excluded.source,
       logged_at=excluded.logged_at,
       device_id=excluded.device_id,
       updated_at=excluded.updated_at`,
      [
        session.id,
        session.workspaceId,
        session.subject,
        session.minutes,
        session.source,
        session.loggedAt,
        session.deviceId,
        session.updatedAt
      ]
    );
  }

  async function deleteLocalJob(id: string): Promise<void> {
    const local = await getDb();
    await local.query('delete from jobs where id = $1', [id]);
  }

  async function deleteLocalStudySession(id: string): Promise<void> {
    const local = await getDb();
    await local.query('delete from study_sessions where id = $1', [id]);
  }

  async function upsertGameRun(run: GameRun): Promise<void> {
    const local = await getDb();
    await local.query(
      `insert into game_runs (id, workspace_id, game_id, score, duration_ms, metadata, device_id, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (id) do update set
       workspace_id=excluded.workspace_id,
       game_id=excluded.game_id,
       score=excluded.score,
       duration_ms=excluded.duration_ms,
       metadata=excluded.metadata,
       device_id=excluded.device_id,
       updated_at=excluded.updated_at`,
      [run.id, run.workspaceId, run.gameId, run.score, run.durationMs, json(run.metadata), run.deviceId, run.updatedAt]
    );
  }

  async function upsertSettings(settings: PersonalSettings): Promise<void> {
    const local = await getDb();
    await local.query(
      `insert into personal_settings (workspace_id, theme, high_scores, recent_state, preferences, last_legacy_import_at, device_id, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (workspace_id) do update set
       theme=excluded.theme,
       high_scores=excluded.high_scores,
       recent_state=excluded.recent_state,
       preferences=excluded.preferences,
       last_legacy_import_at=excluded.last_legacy_import_at,
       device_id=excluded.device_id,
       updated_at=excluded.updated_at`,
      [
        settings.workspaceId,
        settings.theme ?? null,
        json(settings.highScores),
        json(settings.recentState),
        json(settings.preferences),
        settings.lastLegacyImportAt ?? null,
        settings.deviceId,
        settings.updatedAt
      ]
    );
  }

  async function upsertGameState(state: GameState): Promise<void> {
    const local = await getDb();
    await local.query(
      `insert into game_state (id, workspace_id, game_id, state, device_id, updated_at)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (id) do update set
       workspace_id=excluded.workspace_id,
       game_id=excluded.game_id,
       state=excluded.state,
       device_id=excluded.device_id,
       updated_at=excluded.updated_at`,
      [state.id, state.workspaceId, state.gameId, json(state.state), state.deviceId, state.updatedAt]
    );
  }

  async function setMeta(key: string, value: string): Promise<void> {
    const local = await getDb();
    await local.query(
      `insert into sync_meta (key, value) values ($1, $2)
       on conflict (key) do update set value=excluded.value`,
      [key, value]
    );
  }

  async function loadCache(): Promise<void> {
    const local = await getDb();
    const jobs = await local.query<{
      id: string;
      workspace_id: string;
      company: string;
      role: string;
      status: string;
      fit_score: number | null;
      next_action_at: string | null;
      notes: string;
      device_id: string;
      updated_at: string;
    }>('select * from jobs order by updated_at desc');
    const sessions = await local.query<{
      id: string;
      workspace_id: string;
      subject: string;
      minutes: number;
      source: string;
      logged_at: string;
      device_id: string;
      updated_at: string;
    }>('select * from study_sessions order by logged_at desc');
    const runs = await local.query<{
      id: string;
      workspace_id: string;
      game_id: string;
      score: number;
      duration_ms: number;
      metadata: string;
      device_id: string;
      updated_at: string;
    }>('select * from game_runs order by updated_at desc');
    const settings = await local.query<{
      workspace_id: string;
      theme: string | null;
      high_scores: string;
      recent_state: string;
      preferences: string;
      last_legacy_import_at: string | null;
      device_id: string;
      updated_at: string;
    }>('select * from personal_settings limit 1');
    const gameStates = await local.query<{
      id: string;
      workspace_id: string;
      game_id: string;
      state: string;
      device_id: string;
      updated_at: string;
    }>('select * from game_state order by updated_at desc');

    setPartial({
      jobs: jobs.rows.map((row) => ({
        id: row.id,
        workspaceId: row.workspace_id,
        company: row.company,
        role: row.role,
        status: row.status,
        fitScore: row.fit_score ?? undefined,
        nextActionAt: row.next_action_at ?? undefined,
        notes: row.notes,
        deviceId: row.device_id,
        updatedAt: row.updated_at
      })),
      studySessions: sessions.rows.map((row) => ({
        id: row.id,
        workspaceId: row.workspace_id,
        subject: row.subject,
        minutes: Number(row.minutes),
        source: row.source,
        loggedAt: row.logged_at,
        deviceId: row.device_id,
        updatedAt: row.updated_at
      })),
      gameRuns: runs.rows.map((row) => ({
        id: row.id,
        workspaceId: row.workspace_id,
        gameId: row.game_id,
        score: Number(row.score),
        durationMs: Number(row.duration_ms),
        metadata: parseJson(row.metadata),
        deviceId: row.device_id,
        updatedAt: row.updated_at
      })),
      settings: settings.rows[0]
        ? {
            workspaceId: settings.rows[0].workspace_id,
            theme: settings.rows[0].theme ?? undefined,
            highScores: parseJson(settings.rows[0].high_scores),
            recentState: parseJson(settings.rows[0].recent_state),
            preferences: parseJson(settings.rows[0].preferences),
            lastLegacyImportAt: settings.rows[0].last_legacy_import_at ?? undefined,
            deviceId: settings.rows[0].device_id,
            updatedAt: settings.rows[0].updated_at
          }
        : null,
      gameStates: gameStates.rows.map((row) => ({
        id: row.id,
        workspaceId: row.workspace_id,
        gameId: row.game_id,
        state: parseJson(row.state),
        deviceId: row.device_id,
        updatedAt: row.updated_at
      }))
    });
  }

  async function applyEvent(event: SyncEvent): Promise<void> {
    if (event.operation === 'delete' && event.entityType === 'job') {
      await deleteLocalJob(event.entityId);
      return;
    }
    if (event.operation === 'delete' && event.entityType === 'study_session') {
      await deleteLocalStudySession(event.entityId);
      return;
    }

    if (event.entityType === 'job') await upsertJob(event.payload as JobRecord);
    if (event.entityType === 'study_session') await upsertStudySession(event.payload as StudySession);
    if (event.entityType === 'game_run') await upsertGameRun(event.payload as GameRun);
    if (event.entityType === 'settings') await upsertSettings(event.payload as PersonalSettings);
    if (event.entityType === 'game_state') await upsertGameState(event.payload as GameState);
  }

  async function syncNow(): Promise<void> {
    const state = get(store);
    if (!state.syncKey.trim()) {
      setPartial({ status: 'missing-key', error: '' });
      return;
    }
    if (!state.isOnline) {
      setPartial({ status: 'offline-readonly', error: '' });
      return;
    }

    setPartial({ status: 'syncing', error: '' });
    try {
      const current = get(store);
      const result = await requestJson<{ changes: SyncEvent[]; cursor: string }>(
        `/api/sync/pull?since=${encodeURIComponent(current.cursor)}`,
        current.syncKey
      );
      for (const event of result.changes) {
        await applyEvent(event);
      }
      writeStorage(cursorStorageKey, result.cursor);
      await setMeta('cursor', result.cursor);
      await loadCache();
      setPartial({
        cursor: result.cursor,
        lastSyncedAt: new Date().toISOString(),
        status: 'idle',
        error: ''
      });
    } catch (error) {
      setPartial({
        status: 'error',
        error: error instanceof Error ? error.message : 'Sync failed'
      });
    }
  }

  async function init(): Promise<void> {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      await getDb();
      await loadCache();
      setPartial({
        initialized: true,
        isOnline: browserOnline(),
        status: get(store).syncKey ? (browserOnline() ? 'idle' : 'offline-readonly') : 'missing-key'
      });

      if (typeof window !== 'undefined' && !listenersBound) {
        listenersBound = true;
        window.addEventListener('online', () => {
          setPartial({ isOnline: true, status: get(store).syncKey ? 'idle' : 'missing-key' });
          void syncNow();
        });
        window.addEventListener('offline', () => {
          setPartial({ isOnline: false, status: 'offline-readonly' });
        });
        window.addEventListener('focus', () => {
          void syncNow();
        });
        intervalId = window.setInterval(() => {
          void syncNow();
        }, 30_000);
      }

      await syncNow();
    })();
    return initPromise;
  }

  async function setSyncKey(syncKey: string): Promise<void> {
    writeStorage(syncKeyStorageKey, syncKey.trim());
    writeStorage(cursorStorageKey, '');
    setPartial({ syncKey: syncKey.trim(), cursor: '', status: syncKey.trim() ? 'idle' : 'missing-key' });
    await syncNow();
  }

  function clearSyncKey(): void {
    writeStorage(syncKeyStorageKey, '');
    writeStorage(cursorStorageKey, '');
    setPartial({ syncKey: '', cursor: '', status: 'missing-key' });
  }

  async function saveJob(input: Pick<JobRecord, 'company' | 'role' | 'status' | 'notes'> & { nextActionAt?: string | null }): Promise<JobRecord> {
    const state = get(store);
    if (!canAutoSave(state)) throw new Error('Offline read-only mode');
    const result = await requestJson<{ job: JobRecord }>('/api/jobs', state.syncKey, {
      method: 'POST',
      body: JSON.stringify({ ...input, workspaceId: state.workspaceId })
    });
    await upsertJob(result.job);
    await loadCache();
    return result.job;
  }

  async function updateJob(id: string, input: JobPatchInput): Promise<JobRecord> {
    const state = get(store);
    if (!canAutoSave(state)) throw new Error('Offline read-only mode');
    const result = await requestJson<{ job: JobRecord }>(`/api/jobs/${encodeURIComponent(id)}`, state.syncKey, {
      method: 'PATCH',
      body: JSON.stringify(input)
    });
    await upsertJob(result.job);
    await loadCache();
    return result.job;
  }

  async function deleteJob(id: string): Promise<void> {
    const state = get(store);
    if (!canAutoSave(state)) throw new Error('Offline read-only mode');
    await requestJson<{ ok: true }>(`/api/jobs/${encodeURIComponent(id)}`, state.syncKey, {
      method: 'DELETE'
    });
    await deleteLocalJob(id);
    await loadCache();
  }

  async function saveStudySession(input: Pick<StudySession, 'subject' | 'minutes' | 'source'>): Promise<StudySession> {
    const state = get(store);
    if (!canAutoSave(state)) throw new Error('Offline read-only mode');
    const result = await requestJson<{ session: StudySession }>('/api/study', state.syncKey, {
      method: 'POST',
      body: JSON.stringify({ ...input, workspaceId: state.workspaceId })
    });
    await upsertStudySession(result.session);
    await loadCache();
    return result.session;
  }

  async function updateStudySession(id: string, input: StudySessionPatchInput): Promise<StudySession> {
    const state = get(store);
    if (!canAutoSave(state)) throw new Error('Offline read-only mode');
    const result = await requestJson<{ session: StudySession }>(`/api/study/${encodeURIComponent(id)}`, state.syncKey, {
      method: 'PATCH',
      body: JSON.stringify(input)
    });
    await upsertStudySession(result.session);
    await loadCache();
    return result.session;
  }

  async function deleteStudySession(id: string): Promise<void> {
    const state = get(store);
    if (!canAutoSave(state)) throw new Error('Offline read-only mode');
    await requestJson<{ ok: true }>(`/api/study/${encodeURIComponent(id)}`, state.syncKey, {
      method: 'DELETE'
    });
    await deleteLocalStudySession(id);
    await loadCache();
  }

  async function saveGameRun(input: Pick<GameRun, 'gameId' | 'score' | 'durationMs' | 'metadata'>): Promise<GameRun> {
    const state = get(store);
    if (!canAutoSave(state)) throw new Error('Offline read-only mode');
    const result = await requestJson<{ run: GameRun }>('/api/game-runs', state.syncKey, {
      method: 'POST',
      body: JSON.stringify({ ...input, workspaceId: state.workspaceId })
    });
    await upsertGameRun(result.run);
    await loadCache();
    return result.run;
  }

  async function saveGameState(gameId: string, value: Record<string, unknown>): Promise<GameState> {
    const state = get(store);
    if (!canAutoSave(state)) throw new Error('Offline read-only mode');
    const result = await requestJson<{ state: GameState }>(`/api/game-state/${encodeURIComponent(gameId)}`, state.syncKey, {
      method: 'PUT',
      body: JSON.stringify({ state: value })
    });
    await upsertGameState(result.state);
    await loadCache();
    return result.state;
  }

  async function saveSettings(input: Partial<PersonalSettings>): Promise<PersonalSettings> {
    const state = get(store);
    if (!canAutoSave(state)) throw new Error('Offline read-only mode');
    const result = await requestJson<{ settings: PersonalSettings }>('/api/settings', state.syncKey, {
      method: 'PUT',
      body: JSON.stringify({
        theme: input.theme,
        highScores: input.highScores ?? state.settings?.highScores ?? {},
        recentState: input.recentState ?? state.settings?.recentState ?? {},
        preferences: input.preferences ?? state.settings?.preferences ?? {},
        lastLegacyImportAt: input.lastLegacyImportAt ?? state.settings?.lastLegacyImportAt
      })
    });
    await upsertSettings(result.settings);
    await loadCache();
    return result.settings;
  }

  async function importLegacySnapshot(storage: Storage): Promise<void> {
    const { exportLegacySnapshot } = await import('@mini-hub/db/migration');
    const snapshot = exportLegacySnapshot(storage);
    const now = new Date().toISOString();
    await saveSettings({
      recentState: { legacySnapshot: snapshot },
      lastLegacyImportAt: now
    });
    await saveGameState('legacy-import', { snapshot, importedAt: now });
  }

  function destroy(): void {
    if (intervalId !== null && typeof window !== 'undefined') {
      window.clearInterval(intervalId);
    }
  }

  return {
    subscribe: store.subscribe,
    init,
    syncNow,
    setSyncKey,
    clearSyncKey,
    saveJob,
    updateJob,
    deleteJob,
    saveStudySession,
    updateStudySession,
    deleteStudySession,
    saveGameRun,
    saveGameState,
    saveSettings,
    importLegacySnapshot,
    destroy
  };
}

export const clientData = createClientDataStore();
