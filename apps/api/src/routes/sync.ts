import { validateSyncEvents } from '@mini-hub/db/sync';
import { Hono } from 'hono';
import { z } from 'zod';
import { requireUser, type AppBindings } from '../context';
import type { MemoryStore } from '../store';
import { ensurePersonalWorkspace, userWorkspaceIds } from '../store';

const pushBody = z.object({
  events: z.array(z.unknown()).default([])
});

export function syncRoutes(store: MemoryStore): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.post('/push', async (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    ensurePersonalWorkspace(store);
    const parsed = pushBody.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400);

    const events = validateSyncEvents(parsed.data.events);
    const workspaceIds = userWorkspaceIds(store, user.id);
    const allowed = events.filter((event) => workspaceIds.has(event.workspaceId));
    store.syncEvents.push(...allowed);

    return c.json({
      accepted: allowed.length,
      cursor: allowed.at(-1)?.createdAt ?? new Date().toISOString()
    });
  });

  app.get('/pull', (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    ensurePersonalWorkspace(store);
    const since = c.req.query('since') ?? '';
    const workspaceIds = userWorkspaceIds(store, user.id);
    const changes = store.syncEvents.filter(
      (event) => workspaceIds.has(event.workspaceId) && (!since || event.createdAt > since)
    );
    return c.json({
      changes,
      cursor: changes.at(-1)?.createdAt ?? since
    });
  });

  return app;
}
