import { gameStateSchema, personalWorkspaceId } from '@mini-hub/core';
import { Hono } from 'hono';
import { z } from 'zod';
import { requireUser, type AppBindings } from '../context';
import { appendSyncEvent, ensurePersonalWorkspace, type MemoryStore, withBeforeSnapshot } from '../store';

const gameStateBody = z.object({
  state: z.record(z.string(), z.unknown()).default({})
});

export function gameStateRoutes(store: MemoryStore): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.get('/:gameId', (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    ensurePersonalWorkspace(store);
    const gameId = c.req.param('gameId');
    const state = store.gameStates.get(gameId) ?? null;
    return c.json({ state });
  });

  app.put('/:gameId', async (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    ensurePersonalWorkspace(store);
    const parsed = gameStateBody.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400);

    const gameId = c.req.param('gameId');
    const existing = store.gameStates.get(gameId) ?? null;
    const state = gameStateSchema.parse({
      id: `${personalWorkspaceId}:${gameId}`,
      workspaceId: personalWorkspaceId,
      gameId,
      state: parsed.data.state,
      deviceId: 'api',
      updatedAt: new Date().toISOString()
    });
    store.gameStates.set(gameId, state);
    appendSyncEvent(store, {
      workspaceId: state.workspaceId,
      entityType: 'game_state',
      entityId: state.id,
      operation: 'update',
      payload: existing ? withBeforeSnapshot(state, existing, 'update') : state,
      deviceId: state.deviceId
    });
    return c.json({ state });
  });

  return app;
}
