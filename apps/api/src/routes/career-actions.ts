import { careerActionSchema } from '@mini-hub/core';
import { Hono } from 'hono';
import { z } from 'zod';
import { requireUser, type AppBindings } from '../context';
import type { MemoryStore } from '../store';
import { appendSyncEvent, ensurePersonalWorkspace, userWorkspaceIds, withBeforeSnapshot } from '../store';

const careerActionBody = z.object({
  id: z.string().min(1).optional(),
  workspaceId: z.string().min(1),
  jobId: z.string().min(1).optional(),
  label: z.string().min(1),
  dueAt: z.string().nullable().optional(),
  completedAt: z.string().nullable().optional(),
  deviceId: z.string().min(1).optional(),
  updatedAt: z.string().min(1).optional()
});

const careerActionPatchBody = careerActionBody.partial().extend({
  workspaceId: z.string().min(1).optional()
});

export function careerActionRoutes(store: MemoryStore): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.get('/', (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    ensurePersonalWorkspace(store);
    const workspaceIds = userWorkspaceIds(store, user.id);
    return c.json({ actions: store.careerActions.filter((action) => workspaceIds.has(action.workspaceId)) });
  });

  app.post('/', async (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    ensurePersonalWorkspace(store);
    const parsed = careerActionBody.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400);

    if (!userWorkspaceIds(store, user.id).has(parsed.data.workspaceId)) {
      return c.json({ error: 'Workspace not found' }, 404);
    }

    const now = new Date().toISOString();
    const existingIndex = parsed.data.id ? store.careerActions.findIndex((action) => action.id === parsed.data.id) : -1;
    const existingAction = existingIndex >= 0 ? store.careerActions[existingIndex] : undefined;
    const action = careerActionSchema.parse({
      ...(existingAction ?? {}),
      id: parsed.data.id ?? crypto.randomUUID(),
      workspaceId: parsed.data.workspaceId,
      jobId: parsed.data.jobId,
      label: parsed.data.label,
      dueAt: parsed.data.dueAt ?? undefined,
      completedAt: parsed.data.completedAt ?? undefined,
      deviceId: parsed.data.deviceId ?? 'api',
      updatedAt: parsed.data.updatedAt ?? now
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
      payload: existingAction ? withBeforeSnapshot(action, existingAction, 'upsert-existing') : action,
      deviceId: action.deviceId
    });

    return c.json({ action }, existingIndex >= 0 ? 200 : 201);
  });

  app.patch('/:id', async (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    const parsed = careerActionPatchBody.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400);

    const index = store.careerActions.findIndex((action) => action.id === c.req.param('id'));
    if (index < 0) return c.json({ error: 'Career action not found' }, 404);

    const existing = store.careerActions[index];
    if (!existing) return c.json({ error: 'Career action not found' }, 404);
    if (!userWorkspaceIds(store, user.id).has(existing.workspaceId)) {
      return c.json({ error: 'Workspace not found' }, 404);
    }

    const action = careerActionSchema.parse({
      ...existing,
      ...parsed.data,
      workspaceId: existing.workspaceId,
      dueAt: 'dueAt' in parsed.data ? parsed.data.dueAt ?? undefined : existing.dueAt,
      completedAt: 'completedAt' in parsed.data ? parsed.data.completedAt ?? undefined : existing.completedAt,
      deviceId: 'api',
      updatedAt: new Date().toISOString()
    });
    store.careerActions[index] = action;
    appendSyncEvent(store, {
      workspaceId: action.workspaceId,
      entityType: 'career_action',
      entityId: action.id,
      operation: 'update',
      payload: withBeforeSnapshot(action, existing, 'update'),
      deviceId: action.deviceId
    });
    return c.json({ action });
  });

  app.delete('/:id', (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    const index = store.careerActions.findIndex((action) => action.id === c.req.param('id'));
    if (index < 0) return c.json({ error: 'Career action not found' }, 404);
    const [action] = store.careerActions.splice(index, 1);
    if (!action) return c.json({ error: 'Career action not found' }, 404);
    if (!userWorkspaceIds(store, user.id).has(action.workspaceId)) {
      return c.json({ error: 'Workspace not found' }, 404);
    }
    appendSyncEvent(store, {
      workspaceId: action.workspaceId,
      entityType: 'career_action',
      entityId: action.id,
      operation: 'delete',
      payload: withBeforeSnapshot({ id: action.id }, action, 'delete'),
      deviceId: 'api'
    });
    return c.json({ ok: true });
  });

  return app;
}
