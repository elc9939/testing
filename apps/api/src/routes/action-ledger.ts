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
import type { MemoryStore } from '../store';
import {
  appendSyncEvent,
  ensurePersonalWorkspace,
  ledgerMetadataFromPayload,
  userWorkspaceIds,
  withLedgerMetadata
} from '../store';

const restoreBody = z.object({
  confirm: z.boolean().default(false)
});

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
  if (metadata.before) {
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

function eventIdFromLedgerId(value: string): string {
  return value.startsWith('mini-hub-sync:') ? value.slice('mini-hub-sync:'.length) : value;
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

export function actionLedgerRoutes(store: MemoryStore): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.get('/', (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    ensurePersonalWorkspace(store);
    const workspaceIds = userWorkspaceIds(store, user.id);
    const limit = Math.max(1, Math.min(Number(c.req.query('limit') ?? 50) || 50, 200));
    const actions = store.syncEvents
      .filter((event) => workspaceIds.has(event.workspaceId))
      .map(syncEventToLedgerEntry)
      .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt) || a.id.localeCompare(b.id))
      .slice(0, limit);

    return c.json({ actions });
  });

  app.post('/:id/restore', async (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    ensurePersonalWorkspace(store);

    const parsed = restoreBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400);
    if (!parsed.data.confirm) {
      return c.json({ error: 'Restore requires confirm: true because it writes synced data.' }, 409);
    }

    const eventId = eventIdFromLedgerId(c.req.param('id'));
    const workspaceIds = userWorkspaceIds(store, user.id);
    const event = store.syncEvents.find((candidate) => candidate.id === eventId && workspaceIds.has(candidate.workspaceId));
    if (!event) return c.json({ error: 'Action ledger entry not found' }, 404);

    const metadata = ledgerMetadataFromPayload(event.payload);
    if (!metadata.before) return c.json({ error: 'Action does not have a restore snapshot.' }, 409);

    try {
      const { restored, syncEvent } = restoreSnapshot(store, event, metadata.before);
      return c.json({ restored, syncEvent });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Restore failed' }, 400);
    }
  });

  return app;
}
