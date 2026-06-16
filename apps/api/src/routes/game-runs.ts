import { gameRunSchema } from '@mini-hub/core';
import { Hono } from 'hono';
import { z } from 'zod';
import { requireUser, type AppBindings } from '../context';
import type { MemoryStore } from '../store';
import { appendSyncEvent, ensurePersonalWorkspace, userWorkspaceIds } from '../store';

const gameRunBody = z.object({
  workspaceId: z.string().min(1),
  gameId: z.string().min(1),
  score: z.number().finite().default(0),
  durationMs: z.number().int().nonnegative().default(0),
  metadata: z.record(z.string(), z.unknown()).default({})
});

export function gameRunRoutes(store: MemoryStore): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.get('/', (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    ensurePersonalWorkspace(store);
    const workspaceIds = userWorkspaceIds(store, user.id);
    return c.json({ runs: store.gameRuns.filter((run) => workspaceIds.has(run.workspaceId)) });
  });

  app.post('/', async (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    ensurePersonalWorkspace(store);
    const parsed = gameRunBody.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400);

    if (!userWorkspaceIds(store, user.id).has(parsed.data.workspaceId)) {
      return c.json({ error: 'Workspace not found' }, 404);
    }

    const run = gameRunSchema.parse({
      id: crypto.randomUUID(),
      workspaceId: parsed.data.workspaceId,
      gameId: parsed.data.gameId,
      score: parsed.data.score,
      durationMs: parsed.data.durationMs,
      metadata: parsed.data.metadata,
      deviceId: 'api',
      updatedAt: new Date().toISOString()
    });
    store.gameRuns.push(run);
    appendSyncEvent(store, {
      workspaceId: run.workspaceId,
      entityType: 'game_run',
      entityId: run.id,
      operation: 'insert',
      payload: run,
      deviceId: run.deviceId
    });
    return c.json({ run }, 201);
  });

  return app;
}
