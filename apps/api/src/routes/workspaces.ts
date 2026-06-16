import { workspaceSchema } from '@mini-hub/core';
import { Hono } from 'hono';
import { z } from 'zod';
import { requireUser, type AppBindings } from '../context';
import { ensurePersonalWorkspace, type MemoryStore } from '../store';

const createWorkspaceBody = z.object({
  name: z.string().min(1)
});

export function workspaceRoutes(store: MemoryStore): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.get('/', (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    ensurePersonalWorkspace(store);
    const workspaceIds = new Set(
      store.members.filter((member) => member.userId === user.id).map((member) => member.workspaceId)
    );
    return c.json({
      workspaces: [...store.workspaces.values()].filter((workspace) => workspaceIds.has(workspace.id))
    });
  });

  app.post('/', async (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;

    const parsed = createWorkspaceBody.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400);

    const now = new Date().toISOString();
    const requestedId = parsed.data.name === 'Personal Mini Hub' ? 'personal' : crypto.randomUUID();
    const workspace = workspaceSchema.parse({
      id: requestedId,
      name: parsed.data.name,
      ownerId: user.id,
      createdAt: now,
      updatedAt: now
    });

    store.workspaces.set(workspace.id, workspace);
    store.members.push({
      id: crypto.randomUUID(),
      workspaceId: workspace.id,
      userId: user.id,
      role: 'owner'
    });

    return c.json({ workspace }, 201);
  });

  return app;
}
