import {
  actionLedgerEntrySchema,
  careerActionSchema,
  gameStateSchema,
  jobSchema,
  personalSettingsSchema,
  studySessionSchema,
  type ActionLedgerEntry,
  type SyncEvent
} from '@mini-hub/core';
import { Hono } from 'hono';
import { z } from 'zod';
import { requireUser, type AppBindings } from '../context';
import { env } from '../env';
import type { MemoryStore } from '../store';
import {
  appendActionLedgerEvent,
  appendSyncEvent,
  ensurePersonalWorkspace,
  ledgerMetadataFromPayload,
  userWorkspaceIds,
  withLedgerMetadata
} from '../store';

const restoreBody = z.object({
  confirm: z.boolean().default(false)
});

type FetchLike = typeof fetch;

interface ActionLedgerRouteOptions {
  externalFetch?: FetchLike;
}

interface FederatedSourceStatus {
  id: 'mini-hub' | 'ai-os' | 'macro-lab';
  label: string;
  ok: boolean;
  count: number;
  error?: string;
}

interface AiActionLedgerEntry {
  id: string;
  occurred_at: string;
  system: ActionLedgerEntry['system'];
  source: string;
  action_type: string;
  summary: string;
  status: ActionLedgerEntry['status'];
  risk: ActionLedgerEntry['risk'];
  mode?: string | null;
  changed?: string[];
  recoverability?: {
    kind?: ActionLedgerEntry['recoverability']['kind'];
    reference_id?: string | null;
    route?: string | null;
    description?: string;
    reversible?: boolean;
  };
  raw_ref?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

interface MacroRun {
  id: string;
  macro_id: string;
  macro_name: string;
  trigger_id?: string;
  status: string;
  dry_run: boolean;
  started_at: string;
  finished_at?: string;
  error?: string;
  steps: Array<Record<string, unknown>>;
}

function parseLimit(value: string | undefined, fallback = 50): number {
  return Math.max(1, Math.min(Number(value ?? fallback) || fallback, 200));
}

function dateValue(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sortLedgerActions(actions: ActionLedgerEntry[], limit: number): ActionLedgerEntry[] {
  return actions
    .filter((action) => action.occurredAt)
    .sort((a, b) => dateValue(b.occurredAt) - dateValue(a.occurredAt) || a.id.localeCompare(b.id))
    .slice(0, limit);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim()))];
}

function titleCase(value: string): string {
  return value
    .replace(/[_-]/gu, ' ')
    .replace(/\b\w/gu, (match) => match.toUpperCase())
    .trim();
}

function actionSummary(event: SyncEvent): string {
  const entity = titleCase(event.entityType);
  if (event.operation === 'insert') return `Created ${entity}`;
  if (event.operation === 'update') return `Updated ${entity}`;
  return `Deleted ${entity}`;
}

function actionMode(event: SyncEvent): string | undefined {
  const preferences = event.entityType === 'settings' ? event.payload.preferences : undefined;
  if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) return undefined;
  const mode = (preferences as Record<string, unknown>).machineMode;
  return typeof mode === 'string' && mode.trim() ? mode : undefined;
}

function recoverability(event: SyncEvent): ActionLedgerEntry['recoverability'] {
  const metadata = ledgerMetadataFromPayload(event.payload);
  if (metadata.before !== undefined && metadata.before !== null) {
    return {
      kind: 'snapshot',
      referenceId: event.id,
      route: '/settings',
      description: 'A before-state snapshot is attached and can be restored through the action ledger API.',
      reversible: true
    };
  }

  if (event.operation === 'delete') {
    return {
      kind: 'none',
      description: 'Delete event was recorded without a before-state restore payload.',
      reversible: false
    };
  }

  return {
    kind: 'snapshot',
    referenceId: event.id,
    route: '/settings',
    description: 'The synced after-state payload is recorded with this event.',
    reversible: false
  };
}

function syncEventToLedgerEntry(event: SyncEvent): ActionLedgerEntry {
  const metadata = ledgerMetadataFromPayload(event.payload);
  return actionLedgerEntrySchema.parse({
    id: `mini-hub-sync:${event.id}`,
    occurredAt: event.createdAt,
    system: 'mini-hub',
    source: 'sync_event',
    actionType: `${event.entityType}.${event.operation}`,
    summary: actionSummary(event),
    status: 'succeeded',
    risk: event.operation === 'delete' ? 'destructive' : 'write',
    mode: actionMode(event),
    changed: [`${event.entityType}:${event.entityId}`],
    recoverability: recoverability(event),
    rawRef: {
      kind: 'sync_event',
      id: event.id,
      entityType: event.entityType,
      entityId: event.entityId,
      operation: event.operation,
      snapshot: Boolean(metadata.before),
      restoredFrom: metadata.restoredFrom
    },
    metadata: {
      workspaceId: event.workspaceId,
      deviceId: event.deviceId,
      recoveryReason: metadata.reason,
      restoredFrom: metadata.restoredFrom
    }
  });
}

function hubActionLedgerEntries(store: MemoryStore, workspaceIds: Set<string>, limit: number): ActionLedgerEntry[] {
  const syncActions = store.syncEvents
    .filter((event) => workspaceIds.has(event.workspaceId))
    .map(syncEventToLedgerEntry);
  const explicitActions = store.actionEvents.filter((event) => {
    const workspaceId = event.metadata.workspaceId;
    return typeof workspaceId !== 'string' || workspaceIds.has(workspaceId);
  });
  return sortLedgerActions([...syncActions, ...explicitActions], limit);
}

function normalizeStatus(status: unknown): ActionLedgerEntry['status'] {
  if (typeof status !== 'string') return 'info';
  if (['succeeded', 'failed', 'running', 'queued', 'cancelled', 'dry_run', 'blocked', 'info'].includes(status)) {
    return status as ActionLedgerEntry['status'];
  }
  if (status === 'success' || status === 'ok') return 'succeeded';
  if (status === 'error') return 'failed';
  return 'info';
}

function optionalNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function normalizeAiAction(action: AiActionLedgerEntry): ActionLedgerEntry {
  return actionLedgerEntrySchema.parse({
    id: action.id,
    occurredAt: action.occurred_at,
    system: action.system,
    source: action.source,
    actionType: action.action_type,
    summary: action.summary,
    status: action.status,
    risk: action.risk,
    mode: optionalNonEmptyString(action.mode),
    changed: action.changed ?? [],
    recoverability: {
      kind: action.recoverability?.kind ?? 'none',
      referenceId: optionalNonEmptyString(action.recoverability?.reference_id),
      route: optionalNonEmptyString(action.recoverability?.route),
      description: action.recoverability?.description ?? '',
      reversible: action.recoverability?.reversible ?? false
    },
    rawRef: action.raw_ref ?? {},
    metadata: action.metadata ?? {}
  });
}

function macroRunToAction(run: MacroRun): ActionLedgerEntry {
  return actionLedgerEntrySchema.parse({
    id: `macro-lab-run:${run.id}`,
    occurredAt: run.finished_at || run.started_at,
    system: 'macro-lab',
    source: 'run_history',
    actionType: 'macro.run',
    summary: `${run.dry_run ? 'Dry-run' : 'Ran'} ${run.macro_name}`,
    status: run.dry_run ? 'dry_run' : normalizeStatus(run.status),
    risk: macroRunRisk(run),
    changed: macroRunChanged(run),
    recoverability: macroRecoverability(run),
    rawRef: {
      kind: 'macro_run',
      id: run.id,
      macroId: run.macro_id,
      triggerId: run.trigger_id
    },
    metadata: {
      error: run.error,
      step_count: run.steps.length
    }
  });
}

function macroRunRisk(run: MacroRun): ActionLedgerEntry['risk'] {
  const safety = run.steps.map((step) => String(step.safety ?? step.action_safety ?? '')).join(' ');
  if (/\bdestructive\b/iu.test(safety)) return 'destructive';
  if (/\bwrite\b/iu.test(safety)) return 'write';
  return 'system';
}

function macroRunChanged(run: MacroRun): string[] {
  const changed: string[] = [];
  for (const [index, step] of run.steps.entries()) {
    const before = changed.length;
    changed.push(...macroStepChangedPaths(step));
    if (changed.length === before) {
      const label = step.label ?? step.action_label ?? step.action_type ?? step.type;
      changed.push(typeof label === 'string' && label.trim() ? label : `step:${index + 1}`);
    }
  }
  return unique(changed).slice(0, 6);
}

function macroRecoverability(run: MacroRun): ActionLedgerEntry['recoverability'] {
  if (run.dry_run) {
    return {
      kind: 'dry_run',
      referenceId: run.id,
      route: '/macro-lab',
      description: 'Dry-run recorded the planned steps without side effects.',
      reversible: true
    };
  }

  const artifacts = run.steps.map(macroStepRecoverability).filter((item): item is Record<string, unknown> => Boolean(item));
  if (!artifacts.length) {
    return {
      kind: 'none',
      route: '/macro-lab',
      description: 'Macro run history is recorded, but no automatic rollback artifact is attached.',
      reversible: false
    };
  }

  const snapshots = artifacts.flatMap((artifact) => (Array.isArray(artifact.snapshots) ? artifact.snapshots : []));
  const inverseOperations = artifacts.flatMap((artifact) =>
    Array.isArray(artifact.inverse_operations) ? artifact.inverse_operations : []
  );
  const hasSnapshot = artifacts.some((artifact) => artifact.kind === 'snapshot') || snapshots.length > 0;
  const reversible = artifacts.some((artifact) => artifact.reversible === true);
  const noun = artifacts.length === 1 ? 'step' : 'steps';
  return {
    kind: hasSnapshot ? 'snapshot' : 'artifact',
    referenceId: run.id,
    route: '/macro-lab',
    description: `Macro Lab recorded recovery metadata for ${artifacts.length} ${noun}: ${snapshots.length} snapshot(s), ${inverseOperations.length} inverse operation(s).`,
    reversible
  };
}

function macroStepRecoverability(step: Record<string, unknown>): Record<string, unknown> | null {
  const detail = step.detail;
  if (!isRecord(detail)) return null;
  const recoverability = detail.recoverability;
  return isRecord(recoverability) ? recoverability : null;
}

function macroStepChangedPaths(step: Record<string, unknown>): string[] {
  const detail = step.detail;
  if (!isRecord(detail)) return [];
  const paths: string[] = [];
  for (const key of ['path', 'source', 'target']) {
    const value = detail[key];
    if (typeof value === 'string' && value.trim()) paths.push(value);
  }
  for (const collectionKey of ['operations', 'applied']) {
    const operations = detail[collectionKey];
    if (!Array.isArray(operations)) continue;
    for (const operation of operations) {
      if (!isRecord(operation)) continue;
      for (const key of ['path', 'source', 'target']) {
        const value = operation[key];
        if (typeof value === 'string' && value.trim()) paths.push(value);
      }
    }
  }
  const preRestoreSnapshots = detail.pre_restore_snapshots;
  if (Array.isArray(preRestoreSnapshots)) {
    for (const snapshot of preRestoreSnapshots) {
      if (!isRecord(snapshot)) continue;
      const target = snapshot.target;
      if (typeof target === 'string' && target.trim()) paths.push(target);
    }
  }
  const recoverability = macroStepRecoverability(step);
  const snapshots = recoverability?.snapshots;
  if (Array.isArray(snapshots)) {
    for (const snapshot of snapshots) {
      if (!isRecord(snapshot)) continue;
      const target = snapshot.target;
      if (typeof target === 'string' && target.trim()) paths.push(target);
    }
  }
  return paths;
}

function describeError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error || 'Unknown error');
}

async function fetchJsonWithTimeout(
  fetchImpl: FetchLike,
  url: URL,
  label: string,
  timeoutMs: number
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: { accept: 'application/json' },
      signal: controller.signal
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${label} returned ${response.status}: ${text.slice(0, 160) || response.statusText}`);
    }
    if (text.trimStart().startsWith('<')) {
      throw new Error(`${label} returned HTML instead of JSON. Check the configured service URL.`);
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error(`${label} returned invalid JSON.`);
    }
  } finally {
    clearTimeout(timer);
  }
}

async function fetchAiLedgerActions(fetchImpl: FetchLike, limit: number): Promise<ActionLedgerEntry[]> {
  const url = new URL('/api/ai/action-ledger', env.aiOsApiUrl);
  url.searchParams.set('limit', String(limit));
  const payload = await fetchJsonWithTimeout(fetchImpl, url, 'AI OS', env.actionLedgerFederationTimeoutMs);
  if (!isRecord(payload) || !Array.isArray(payload.actions)) throw new Error('AI OS action ledger response is missing actions.');
  return payload.actions.map((action) => normalizeAiAction(action as AiActionLedgerEntry));
}

async function fetchMacroLedgerActions(fetchImpl: FetchLike, limit: number): Promise<ActionLedgerEntry[]> {
  const url = new URL('/api/macro-lab/runs', env.macroLabApiUrl);
  url.searchParams.set('limit', String(limit));
  const payload = await fetchJsonWithTimeout(fetchImpl, url, 'Macro Lab', env.actionLedgerFederationTimeoutMs);
  if (!isRecord(payload) || !Array.isArray(payload.runs)) throw new Error('Macro Lab run history response is missing runs.');
  return payload.runs.map((run) => macroRunToAction(run as MacroRun));
}

function eventIdFromLedgerId(value: string): string {
  return value.startsWith('mini-hub-sync:') ? value.slice('mini-hub-sync:'.length) : value;
}

function entityLabel(event: SyncEvent): string {
  return titleCase(event.entityType);
}

function restoreAttemptAction(
  store: MemoryStore,
  event: SyncEvent,
  input: {
    status: ActionLedgerEntry['status'];
    detail: string;
    restoredSyncEvent?: SyncEvent;
    error?: string;
  }
): ActionLedgerEntry {
  const restoredSyncMetadata = input.restoredSyncEvent
    ? ledgerMetadataFromPayload(input.restoredSyncEvent.payload)
    : {};
  const hasRestorablePreRestoreState =
    restoredSyncMetadata.before !== undefined && restoredSyncMetadata.before !== null;
  return appendActionLedgerEvent(store, {
    system: 'mini-hub',
    source: 'action_ledger_restore',
    actionType: 'action_ledger.restore',
    summary:
      input.status === 'succeeded'
        ? `Restored ${entityLabel(event)} snapshot`
        : input.status === 'blocked'
          ? `Restore ${entityLabel(event)} snapshot blocked`
          : `Restore ${entityLabel(event)} snapshot failed`,
    status: input.status,
    risk: 'destructive',
    changed: [`${event.entityType}:${event.entityId}`],
    recoverability:
      input.status === 'succeeded' && input.restoredSyncEvent
        ? {
            kind: hasRestorablePreRestoreState ? 'snapshot' : 'artifact',
            referenceId: input.restoredSyncEvent.id,
            route: '/settings',
            description:
              hasRestorablePreRestoreState
                ? 'Restore wrote synced data and captured the pre-restore state in a follow-up sync event.'
                : 'Restore wrote synced data; the follow-up sync event is the audit artifact.',
            reversible: hasRestorablePreRestoreState
          }
        : input.status === 'blocked'
          ? {
              kind: 'dry_run',
              referenceId: event.id,
              route: '/settings',
              description: 'Restore was blocked before side effects because confirmation was not provided.',
              reversible: true
            }
          : {
              kind: 'none',
              referenceId: event.id,
              route: '/settings',
              description: input.detail,
              reversible: false
            },
    rawRef: {
      kind: 'action_ledger_restore',
      sourceEventId: event.id,
      restoredSyncEventId: input.restoredSyncEvent?.id
    },
    metadata: {
      workspaceId: event.workspaceId,
      entityType: event.entityType,
      entityId: event.entityId,
      operation: event.operation,
      restoredFrom: event.id,
      detail: input.detail,
      error: input.error
    }
  });
}

function currentEntitySnapshot(store: MemoryStore, event: SyncEvent): unknown {
  if (event.entityType === 'job') return store.jobs.find((job) => job.id === event.entityId) ?? null;
  if (event.entityType === 'study_session') {
    return store.studySessions.find((session) => session.id === event.entityId) ?? null;
  }
  if (event.entityType === 'career_action') {
    return store.careerActions.find((action) => action.id === event.entityId) ?? null;
  }
  if (event.entityType === 'settings') return store.settings ?? null;
  if (event.entityType === 'game_state') {
    return Array.from(store.gameStates.values()).find((state) => state.id === event.entityId) ?? null;
  }
  return null;
}

function restoreSnapshot(store: MemoryStore, event: SyncEvent, before: unknown): { restored: unknown; syncEvent: SyncEvent } {
  const current = currentEntitySnapshot(store, event);
  const restoredPayload = (restored: object) =>
    withLedgerMetadata(restored, {
      before: current,
      reason: 'restore',
      restoredFrom: event.id
    });

  if (event.entityType === 'job') {
    const restored = jobSchema.parse(before);
    const index = store.jobs.findIndex((job) => job.id === restored.id);
    if (index >= 0) store.jobs[index] = restored;
    else store.jobs.push(restored);
    const syncEvent = appendSyncEvent(store, {
      workspaceId: restored.workspaceId,
      entityType: 'job',
      entityId: restored.id,
      operation: index >= 0 ? 'update' : 'insert',
      payload: restoredPayload(restored),
      deviceId: 'api'
    });
    return { restored, syncEvent };
  }

  if (event.entityType === 'study_session') {
    const restored = studySessionSchema.parse(before);
    const index = store.studySessions.findIndex((session) => session.id === restored.id);
    if (index >= 0) store.studySessions[index] = restored;
    else store.studySessions.push(restored);
    const syncEvent = appendSyncEvent(store, {
      workspaceId: restored.workspaceId,
      entityType: 'study_session',
      entityId: restored.id,
      operation: index >= 0 ? 'update' : 'insert',
      payload: restoredPayload(restored),
      deviceId: 'api'
    });
    return { restored, syncEvent };
  }

  if (event.entityType === 'career_action') {
    const restored = careerActionSchema.parse(before);
    const index = store.careerActions.findIndex((action) => action.id === restored.id);
    if (index >= 0) store.careerActions[index] = restored;
    else store.careerActions.push(restored);
    const syncEvent = appendSyncEvent(store, {
      workspaceId: restored.workspaceId,
      entityType: 'career_action',
      entityId: restored.id,
      operation: index >= 0 ? 'update' : 'insert',
      payload: restoredPayload(restored),
      deviceId: 'api'
    });
    return { restored, syncEvent };
  }

  if (event.entityType === 'settings') {
    const restored = personalSettingsSchema.parse(before);
    store.settings = restored;
    const syncEvent = appendSyncEvent(store, {
      workspaceId: restored.workspaceId,
      entityType: 'settings',
      entityId: restored.workspaceId,
      operation: 'update',
      payload: restoredPayload(restored),
      deviceId: 'api'
    });
    return { restored, syncEvent };
  }

  if (event.entityType === 'game_state') {
    const restored = gameStateSchema.parse(before);
    store.gameStates.set(restored.gameId, restored);
    const syncEvent = appendSyncEvent(store, {
      workspaceId: restored.workspaceId,
      entityType: 'game_state',
      entityId: restored.id,
      operation: 'update',
      payload: restoredPayload(restored),
      deviceId: 'api'
    });
    return { restored, syncEvent };
  }

  throw new Error(`Restore is not supported for ${event.entityType}.`);
}

export function actionLedgerRoutes(store: MemoryStore, options: ActionLedgerRouteOptions = {}): Hono<AppBindings> {
  const app = new Hono<AppBindings>();
  const externalFetch = options.externalFetch ?? fetch;

  app.get('/', (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    ensurePersonalWorkspace(store);
    const workspaceIds = userWorkspaceIds(store, user.id);
    const limit = parseLimit(c.req.query('limit'));
    const actions = hubActionLedgerEntries(store, workspaceIds, limit);

    return c.json({ actions });
  });

  app.get('/unified', async (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    ensurePersonalWorkspace(store);
    const workspaceIds = userWorkspaceIds(store, user.id);
    const limit = parseLimit(c.req.query('limit'));
    const sourceLimit = parseLimit(c.req.query('sourceLimit'), Math.max(limit * 2, 50));

    const hubActions = hubActionLedgerEntries(store, workspaceIds, sourceLimit);
    const sources: FederatedSourceStatus[] = [
      { id: 'mini-hub', label: 'Mini Hub', ok: true, count: hubActions.length }
    ];
    const errors: string[] = [];
    const externalResults = await Promise.allSettled([
      fetchAiLedgerActions(externalFetch, sourceLimit),
      fetchMacroLedgerActions(externalFetch, sourceLimit)
    ]);

    const aiActions = externalResults[0].status === 'fulfilled' ? externalResults[0].value : [];
    const macroActions = externalResults[1].status === 'fulfilled' ? externalResults[1].value : [];
    if (externalResults[0].status === 'rejected') {
      const error = `AI OS: ${describeError(externalResults[0].reason)}`;
      errors.push(error);
      sources.push({ id: 'ai-os', label: 'AI OS', ok: false, count: 0, error });
    } else {
      sources.push({ id: 'ai-os', label: 'AI OS', ok: true, count: aiActions.length });
    }
    if (externalResults[1].status === 'rejected') {
      const error = `Macro Lab: ${describeError(externalResults[1].reason)}`;
      errors.push(error);
      sources.push({ id: 'macro-lab', label: 'Macro Lab', ok: false, count: 0, error });
    } else {
      sources.push({ id: 'macro-lab', label: 'Macro Lab', ok: true, count: macroActions.length });
    }

    return c.json({
      checkedAt: new Date().toISOString(),
      actions: sortLedgerActions([...hubActions, ...aiActions, ...macroActions], limit),
      errors,
      sources
    });
  });

  app.post('/:id/restore', async (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    ensurePersonalWorkspace(store);

    const parsed = restoreBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400);
    const eventId = eventIdFromLedgerId(c.req.param('id'));
    const workspaceIds = userWorkspaceIds(store, user.id);
    const event = store.syncEvents.find((candidate) => candidate.id === eventId && workspaceIds.has(candidate.workspaceId));
    if (!event) return c.json({ error: 'Action ledger entry not found' }, 404);

    const metadata = ledgerMetadataFromPayload(event.payload);
    if (!metadata.before) {
      restoreAttemptAction(store, event, {
        status: 'failed',
        detail: 'Action does not have a restore snapshot.',
        error: 'Action does not have a restore snapshot.'
      });
      return c.json({ error: 'Action does not have a restore snapshot.' }, 409);
    }
    if (!parsed.data.confirm) {
      restoreAttemptAction(store, event, {
        status: 'blocked',
        detail: 'Restore requires confirm: true because it writes synced data.'
      });
      return c.json({ error: 'Restore requires confirm: true because it writes synced data.' }, 409);
    }

    try {
      const { restored, syncEvent } = restoreSnapshot(store, event, metadata.before);
      const action = restoreAttemptAction(store, event, {
        status: 'succeeded',
        detail: 'Restore completed and wrote a follow-up sync event.',
        restoredSyncEvent: syncEvent
      });
      return c.json({ restored, syncEvent, action });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Restore failed';
      restoreAttemptAction(store, event, {
        status: 'failed',
        detail: message,
        error: message
      });
      return c.json({ error: error instanceof Error ? error.message : 'Restore failed' }, 400);
    }
  });

  return app;
}
