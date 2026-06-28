import { get, writable } from 'svelte/store';
import {
  createDeviceId,
  personalWorkspaceId,
  type CareerActionRecord,
  type GameRun,
  type GameState,
  type JobRecord,
  type PersonalSettings,
  type StudySession,
  type SyncEvent
} from '@mini-hub/core';
import type { LegacyEntityImport, LegacyImportSummary } from '@mini-hub/db/migration';
import { requestApiJson } from './api';

type PGliteDatabase = Awaited<ReturnType<typeof import('@mini-hub/db/local').createMiniHubPglite>>;
type JobPatchInput = Partial<Pick<JobRecord, 'company' | 'role' | 'status' | 'applicationUrl' | 'notes'>> & {
  nextActionAt?: string | null;
};
type StudySessionPatchInput = Partial<Pick<StudySession, 'subject' | 'minutes' | 'source'>>;
type CareerActionPatchInput = Partial<Pick<CareerActionRecord, 'jobId' | 'label'>> & {
  dueAt?: string | null;
  completedAt?: string | null;
};

const deviceIdStorageKey = 'miniHub.deviceId.v1';
const cursorStorageKey = 'miniHub.syncCursor.v1';
const legacyAutoImportStorageKey = 'miniHub.legacyAutoImport.v1';
const localCacheFallbackStorageKey = 'miniHub.localCacheFallback.v1';

export interface ClientDataState {
  initialized: boolean;
  isOnline: boolean;
  deviceId: string;
  workspaceId: string;
  cursor: string;
  lastSyncedAt: string;
  status: 'idle' | 'syncing' | 'offline-readonly' | 'error';
  error: string;
  jobs: JobRecord[];
  studySessions: StudySession[];
  careerActions: CareerActionRecord[];
  gameRuns: GameRun[];
  settings: PersonalSettings | null;
  gameStates: GameState[];
}

export function canAutoSave(state: Pick<ClientDataState, 'initialized' | 'isOnline' | 'status'>): boolean {
  return state.initialized && state.isOnline && state.status === 'idle';
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

function legacySummaryHasData(summary: LegacyImportSummary): boolean {
  return Boolean(
    summary.careers ||
      summary.studyDays ||
      summary.studySessions ||
      summary.studyCareerActions ||
      summary.highScoreGames ||
      summary.hasTheme ||
      summary.hasStickArenaMap
  );
}

export function createClientDataStore() {
  let db: PGliteDatabase | null = null;
  let initPromise: Promise<void> | null = null;
  let intervalId: number | null = null;
  let listenersBound = false;

  const store = writable<ClientDataState>({
    initialized: false,
    isOnline: browserOnline(),
    deviceId: ensureDeviceId(),
    workspaceId: personalWorkspaceId,
    cursor: readStorage(cursorStorageKey),
    lastSyncedAt: '',
    status: browserOnline() ? 'idle' : 'offline-readonly',
    error: '',
    jobs: [],
    studySessions: [],
    careerActions: [],
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
    const configuredDataDir = import.meta.env.PUBLIC_PGLITE_DATA_DIR || '';
    const persistentUnavailable = !configuredDataDir && readStorage(localCacheFallbackStorageKey) === 'memory';
    const requestedDataDir = persistentUnavailable ? 'memory://mini-hub-fallback' : configuredDataDir || 'idb://mini-hub';
    try {
      db = await createMiniHubPglite({ dataDir: requestedDataDir });
      if (!requestedDataDir.startsWith('memory://')) {
        writeStorage(localCacheFallbackStorageKey, 'persistent');
      }
    } catch (error) {
      console.warn('Persistent offline cache is unavailable; using memory cache for this browser session.');
      if (!configuredDataDir) {
        writeStorage(localCacheFallbackStorageKey, 'memory');
      }
      db = await createMiniHubPglite({ dataDir: 'memory://mini-hub-fallback' });
      setPartial({
        status: 'error',
        error: 'Persistent offline cache is unavailable in this browser session; using memory cache until reload.'
      });
    }
    return db;
  }

  async function upsertJob(job: JobRecord): Promise<void> {
    const local = await getDb();
    await local.query(
      `insert into jobs (id, workspace_id, company, role, status, application_url, fit_score, next_action_at, notes, device_id, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       on conflict (id) do update set
       workspace_id=excluded.workspace_id,
       company=excluded.company,
       role=excluded.role,
       status=excluded.status,
       application_url=excluded.application_url,
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
        job.applicationUrl,
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

  async function upsertCareerAction(action: CareerActionRecord): Promise<void> {
    const local = await getDb();
    await local.query(
      `insert into career_actions (id, workspace_id, job_id, label, due_at, completed_at, device_id, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (id) do update set
       workspace_id=excluded.workspace_id,
       job_id=excluded.job_id,
       label=excluded.label,
       due_at=excluded.due_at,
       completed_at=excluded.completed_at,
       device_id=excluded.device_id,
       updated_at=excluded.updated_at`,
      [
        action.id,
        action.workspaceId,
        action.jobId ?? null,
        action.label,
        action.dueAt ?? null,
        action.completedAt ?? null,
        action.deviceId,
        action.updatedAt
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

  async function deleteLocalCareerAction(id: string): Promise<void> {
    const local = await getDb();
    await local.query('delete from career_actions where id = $1', [id]);
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
      application_url: string;
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
    const careerActions = await local.query<{
      id: string;
      workspace_id: string;
      job_id: string | null;
      label: string;
      due_at: string | null;
      completed_at: string | null;
      device_id: string;
      updated_at: string;
    }>('select * from career_actions order by coalesce(completed_at, due_at, updated_at) desc');
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
        applicationUrl: row.application_url,
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
      careerActions: careerActions.rows.map((row) => ({
        id: row.id,
        workspaceId: row.workspace_id,
        jobId: row.job_id ?? undefined,
        label: row.label,
        dueAt: row.due_at ?? undefined,
        completedAt: row.completed_at ?? undefined,
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
    if (event.operation === 'delete' && event.entityType === 'career_action') {
      await deleteLocalCareerAction(event.entityId);
      return;
    }

    if (event.entityType === 'job') await upsertJob(event.payload as JobRecord);
    if (event.entityType === 'study_session') await upsertStudySession(event.payload as StudySession);
    if (event.entityType === 'career_action') await upsertCareerAction(event.payload as CareerActionRecord);
    if (event.entityType === 'game_run') await upsertGameRun(event.payload as GameRun);
    if (event.entityType === 'settings') await upsertSettings(event.payload as PersonalSettings);
    if (event.entityType === 'game_state') await upsertGameState(event.payload as GameState);
  }

  async function syncNow(): Promise<void> {
    const state = get(store);
    if (!state.isOnline) {
      setPartial({ status: 'offline-readonly', error: '' });
      return;
    }

    setPartial({ status: 'syncing', error: '' });
    try {
      const current = get(store);
      const result = await requestApiJson<{ changes: SyncEvent[]; cursor: string }>(
        `/api/sync/pull?since=${encodeURIComponent(current.cursor)}`
      );
      for (const event of result.changes) {
        await applyEvent(event);
      }
      writeStorage(cursorStorageKey, result.cursor);
      await setMeta('cursor', result.cursor);
      await loadCache();
      setPartial({
        initialized: true,
        isOnline: true,
        cursor: result.cursor,
        lastSyncedAt: new Date().toISOString(),
        status: 'idle',
        error: ''
      });
      await autoImportLegacyIfNeeded();
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
        status: browserOnline() ? 'idle' : 'offline-readonly'
      });

      if (typeof window !== 'undefined' && !listenersBound) {
        listenersBound = true;
        window.addEventListener('online', () => {
          setPartial({ isOnline: true, status: 'idle' });
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

  async function saveJob(
    input: Pick<JobRecord, 'company' | 'role' | 'status' | 'notes'> & { applicationUrl?: string; nextActionAt?: string | null }
  ): Promise<JobRecord> {
    const state = get(store);
    if (!canAutoSave(state)) throw new Error('Offline read-only mode');
    const result = await requestApiJson<{ job: JobRecord }>('/api/jobs', {
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
    const result = await requestApiJson<{ job: JobRecord }>(`/api/jobs/${encodeURIComponent(id)}`, {
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
    await requestApiJson<{ ok: true }>(`/api/jobs/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    });
    await deleteLocalJob(id);
    await loadCache();
  }

  async function saveStudySession(input: Pick<StudySession, 'subject' | 'minutes' | 'source'>): Promise<StudySession> {
    const state = get(store);
    if (!canAutoSave(state)) throw new Error('Offline read-only mode');
    const result = await requestApiJson<{ session: StudySession }>('/api/study', {
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
    const result = await requestApiJson<{ session: StudySession }>(`/api/study/${encodeURIComponent(id)}`, {
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
    await requestApiJson<{ ok: true }>(`/api/study/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    });
    await deleteLocalStudySession(id);
    await loadCache();
  }

  async function saveCareerAction(
    input: Pick<CareerActionRecord, 'label'> & { jobId?: string; dueAt?: string | null; completedAt?: string | null }
  ): Promise<CareerActionRecord> {
    const state = get(store);
    if (!canAutoSave(state)) throw new Error('Offline read-only mode');
    const result = await requestApiJson<{ action: CareerActionRecord }>('/api/career-actions', {
      method: 'POST',
      body: JSON.stringify({ ...input, workspaceId: state.workspaceId })
    });
    await upsertCareerAction(result.action);
    await loadCache();
    return result.action;
  }

  async function updateCareerAction(id: string, input: CareerActionPatchInput): Promise<CareerActionRecord> {
    const state = get(store);
    if (!canAutoSave(state)) throw new Error('Offline read-only mode');
    const result = await requestApiJson<{ action: CareerActionRecord }>(`/api/career-actions/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(input)
    });
    await upsertCareerAction(result.action);
    await loadCache();
    return result.action;
  }

  async function deleteCareerAction(id: string): Promise<void> {
    const state = get(store);
    if (!canAutoSave(state)) throw new Error('Offline read-only mode');
    await requestApiJson<{ ok: true }>(`/api/career-actions/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    });
    await deleteLocalCareerAction(id);
    await loadCache();
  }

  async function saveGameRun(input: Pick<GameRun, 'gameId' | 'score' | 'durationMs' | 'metadata'>): Promise<GameRun> {
    const state = get(store);
    if (!canAutoSave(state)) throw new Error('Offline read-only mode');
    const result = await requestApiJson<{ run: GameRun }>('/api/game-runs', {
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
    const result = await requestApiJson<{ state: GameState }>(`/api/game-state/${encodeURIComponent(gameId)}`, {
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
    const result = await requestApiJson<{ settings: PersonalSettings }>('/api/settings', {
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

  async function importLegacySnapshot(storage: Storage): Promise<LegacyEntityImport> {
    const state = get(store);
    if (!canAutoSave(state)) throw new Error('Offline read-only mode');

    const { createLegacyEntityImport } = await import('@mini-hub/db/migration');
    const now = new Date().toISOString();
    const legacyImport = createLegacyEntityImport(storage, {
      workspaceId: state.workspaceId,
      deviceId: state.deviceId,
      importedAt: now
    });

    for (const legacyJob of legacyImport.jobs) {
      const result = await requestApiJson<{ job: JobRecord }>('/api/jobs', {
        method: 'POST',
        body: JSON.stringify(legacyJob)
      });
      await upsertJob(result.job);
    }

    for (const legacySession of legacyImport.studySessions) {
      const result = await requestApiJson<{ session: StudySession }>('/api/study', {
        method: 'POST',
        body: JSON.stringify(legacySession)
      });
      await upsertStudySession(result.session);
    }

    for (const legacyAction of legacyImport.careerActions) {
      const result = await requestApiJson<{ action: CareerActionRecord }>('/api/career-actions', {
        method: 'POST',
        body: JSON.stringify(legacyAction)
      });
      await upsertCareerAction(result.action);
    }

    for (const legacyGameState of legacyImport.gameStates) {
      await saveGameState(legacyGameState.gameId, legacyGameState.state);
    }

    const current = get(store);
    const legacyImportSummary = {
      importedAt: now,
      jobs: legacyImport.jobs.length,
      studySessions: legacyImport.studySessions.length,
      careerActions: legacyImport.careerActions.length,
      studyDays: legacyImport.summary.studyDays,
      studyCareerActions: legacyImport.summary.studyCareerActions,
      highScoreGames: legacyImport.summary.highScoreGames,
      gameStates: legacyImport.gameStates.length,
      hasTheme: legacyImport.summary.hasTheme,
      hasStickArenaMap: legacyImport.summary.hasStickArenaMap,
      warnings: legacyImport.summary.warnings
    };
    await saveSettings({
      theme: legacyImport.theme ?? current.settings?.theme,
      highScores: {
        ...(current.settings?.highScores ?? {}),
        ...legacyImport.highScores
      },
      recentState: {
        ...(current.settings?.recentState ?? {}),
        ...legacyImport.recentState,
        legacySnapshot: legacyImport.snapshot,
        legacyImport: legacyImportSummary,
        legacyLinkedState: legacyImport.linkedState
      },
      preferences: {
        ...(current.settings?.preferences ?? {}),
        legacyLinkedState: legacyImport.linkedState
      },
      lastLegacyImportAt: now
    });
    await saveGameState('legacy-import', {
      snapshot: legacyImport.snapshot,
      importedAt: now,
      summary: legacyImportSummary,
      linkedState: legacyImport.linkedState
    });
    await loadCache();
    return legacyImport;
  }

  async function autoImportLegacyIfNeeded(): Promise<void> {
    if (typeof localStorage === 'undefined') return;

    const state = get(store);
    if (!canAutoSave(state)) return;
    const cachedEntityCount = state.jobs.length + state.studySessions.length + state.careerActions.length + state.gameRuns.length + state.gameStates.length;
    const hasImportedState = Boolean(state.settings?.lastLegacyImportAt || state.settings?.recentState?.legacyImport);
    if (hasImportedState && cachedEntityCount > 0) {
      writeStorage(legacyAutoImportStorageKey, 'done');
      return;
    }
    if (readStorage(legacyAutoImportStorageKey) === 'done' && cachedEntityCount > 0) return;

    const { inspectLegacyStorage } = await import('@mini-hub/db/migration');
    const summary = inspectLegacyStorage(localStorage);
    if (!legacySummaryHasData(summary)) return;

    try {
      await importLegacySnapshot(localStorage);
      writeStorage(legacyAutoImportStorageKey, 'done');
    } catch (error) {
      setPartial({
        status: 'error',
        error: error instanceof Error ? error.message : 'Legacy import failed'
      });
    }
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
    saveJob,
    updateJob,
    deleteJob,
    saveStudySession,
    updateStudySession,
    deleteStudySession,
    saveCareerAction,
    updateCareerAction,
    deleteCareerAction,
    saveGameRun,
    saveGameState,
    saveSettings,
    importLegacySnapshot,
    destroy
  };
}

export const clientData = createClientDataStore();
