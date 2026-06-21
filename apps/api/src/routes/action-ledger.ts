import { actionLedgerEntrySchema, type ActionLedgerEntry, type SyncEvent } from '@mini-hub/core';
import { Hono } from 'hono';
import { requireUser, type AppBindings } from '../context';
import type { MemoryStore } from '../store';
import { ensurePersonalWorkspace, userWorkspaceIds } from '../store';

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
      operation: event.operation
    },
    metadata: {
      workspaceId: event.workspaceId,
      deviceId: event.deviceId
    }
  });
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

  return app;
}
