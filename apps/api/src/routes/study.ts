import { studySessionSchema } from '@mini-hub/core';
import { Hono } from 'hono';
import { z } from 'zod';
import { requireUser, type AppBindings } from '../context';
import type { MemoryStore } from '../store';
import { appendSyncEvent, ensurePersonalWorkspace, userWorkspaceIds } from '../store';

const studyBody = z.object({
  id: z.string().min(1).optional(),
  workspaceId: z.string().min(1),
  subject: z.string().min(1),
  minutes: z.number().int().nonnegative(),
  source: z.string().default('manual'),
  loggedAt: z.string().min(1).optional(),
  deviceId: z.string().min(1).optional(),
  updatedAt: z.string().min(1).optional()
});

const studyPatchBody = studyBody.partial().extend({
  workspaceId: z.string().min(1).optional()
});

export function studyRoutes(store: MemoryStore): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.get('/', (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    ensurePersonalWorkspace(store);
    const workspaceIds = userWorkspaceIds(store, user.id);
    return c.json({ sessions: store.studySessions.filter((session) => workspaceIds.has(session.workspaceId)) });
  });

  app.post('/', async (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    ensurePersonalWorkspace(store);
    const parsed = studyBody.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400);

    if (!userWorkspaceIds(store, user.id).has(parsed.data.workspaceId)) {
      return c.json({ error: 'Workspace not found' }, 404);
    }

    const now = new Date().toISOString();
    const existingIndex = parsed.data.id ? store.studySessions.findIndex((session) => session.id === parsed.data.id) : -1;
    const session = studySessionSchema.parse({
      ...(existingIndex >= 0 ? store.studySessions[existingIndex] : {}),
      id: parsed.data.id ?? crypto.randomUUID(),
      workspaceId: parsed.data.workspaceId,
      subject: parsed.data.subject,
      minutes: parsed.data.minutes,
      source: parsed.data.source,
      loggedAt: parsed.data.loggedAt ?? now,
      deviceId: parsed.data.deviceId ?? 'api',
      updatedAt: parsed.data.updatedAt ?? now
    });
    if (existingIndex >= 0) {
      store.studySessions[existingIndex] = session;
    } else {
      store.studySessions.push(session);
    }
    appendSyncEvent(store, {
      workspaceId: session.workspaceId,
      entityType: 'study_session',
      entityId: session.id,
      operation: existingIndex >= 0 ? 'update' : 'insert',
      payload: session,
      deviceId: session.deviceId
    });
    return c.json({ session }, existingIndex >= 0 ? 200 : 201);
  });

  app.patch('/:id', async (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    const parsed = studyPatchBody.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400);

    const index = store.studySessions.findIndex((session) => session.id === c.req.param('id'));
    if (index < 0) return c.json({ error: 'Study session not found' }, 404);
    const existing = store.studySessions[index];
    if (!existing) return c.json({ error: 'Study session not found' }, 404);
    if (!userWorkspaceIds(store, user.id).has(existing.workspaceId)) {
      return c.json({ error: 'Workspace not found' }, 404);
    }

    const session = studySessionSchema.parse({
      ...existing,
      ...parsed.data,
      workspaceId: existing.workspaceId,
      loggedAt: existing.loggedAt,
      deviceId: 'api',
      updatedAt: new Date().toISOString()
    });
    store.studySessions[index] = session;
    appendSyncEvent(store, {
      workspaceId: session.workspaceId,
      entityType: 'study_session',
      entityId: session.id,
      operation: 'update',
      payload: session,
      deviceId: session.deviceId
    });
    return c.json({ session });
  });

  app.delete('/:id', (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    const index = store.studySessions.findIndex((session) => session.id === c.req.param('id'));
    if (index < 0) return c.json({ error: 'Study session not found' }, 404);
    const [session] = store.studySessions.splice(index, 1);
    if (!session) return c.json({ error: 'Study session not found' }, 404);
    if (!userWorkspaceIds(store, user.id).has(session.workspaceId)) {
      return c.json({ error: 'Workspace not found' }, 404);
    }
    appendSyncEvent(store, {
      workspaceId: session.workspaceId,
      entityType: 'study_session',
      entityId: session.id,
      operation: 'delete',
      payload: { id: session.id },
      deviceId: 'api'
    });
    return c.json({ ok: true });
  });

  return app;
}
