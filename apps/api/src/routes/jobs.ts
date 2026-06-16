import { jobSchema } from '@mini-hub/core';
import { Hono } from 'hono';
import { z } from 'zod';
import { requireUser, type AppBindings } from '../context';
import type { MemoryStore } from '../store';
import { appendSyncEvent, ensurePersonalWorkspace, userWorkspaceIds } from '../store';

const jobBody = z.object({
  workspaceId: z.string().min(1),
  company: z.string().min(1),
  role: z.string().min(1),
  status: z.string().min(1).default('lead'),
  notes: z.string().default(''),
  nextActionAt: z.string().nullable().optional()
});

const jobPatchBody = jobBody.partial().extend({
  workspaceId: z.string().min(1).optional()
});

export function jobRoutes(store: MemoryStore): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.get('/', (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    ensurePersonalWorkspace(store);
    const workspaceIds = userWorkspaceIds(store, user.id);
    return c.json({ jobs: store.jobs.filter((job) => workspaceIds.has(job.workspaceId)) });
  });

  app.post('/', async (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    ensurePersonalWorkspace(store);
    const parsed = jobBody.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400);

    if (!userWorkspaceIds(store, user.id).has(parsed.data.workspaceId)) {
      return c.json({ error: 'Workspace not found' }, 404);
    }

    const now = new Date().toISOString();
    const job = jobSchema.parse({
      id: crypto.randomUUID(),
      workspaceId: parsed.data.workspaceId,
      company: parsed.data.company,
      role: parsed.data.role,
      status: parsed.data.status,
      notes: parsed.data.notes,
      nextActionAt: parsed.data.nextActionAt ?? undefined,
      deviceId: 'api',
      updatedAt: now
    });
    store.jobs.push(job);
    appendSyncEvent(store, {
      workspaceId: job.workspaceId,
      entityType: 'job',
      entityId: job.id,
      operation: 'insert',
      payload: job,
      deviceId: job.deviceId
    });
    return c.json({ job }, 201);
  });

  app.patch('/:id', async (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    const parsed = jobPatchBody.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400);

    const index = store.jobs.findIndex((job) => job.id === c.req.param('id'));
    if (index < 0) return c.json({ error: 'Job not found' }, 404);

    const existing = store.jobs[index];
    if (!existing) return c.json({ error: 'Job not found' }, 404);
    if (!userWorkspaceIds(store, user.id).has(existing.workspaceId)) {
      return c.json({ error: 'Workspace not found' }, 404);
    }

    const nextJob = {
      ...existing,
      ...parsed.data,
      workspaceId: existing.workspaceId,
      deviceId: 'api',
      updatedAt: new Date().toISOString()
    };
    if ('nextActionAt' in parsed.data) {
      nextJob.nextActionAt = parsed.data.nextActionAt ?? undefined;
    }
    const job = jobSchema.parse(nextJob);
    store.jobs[index] = job;
    appendSyncEvent(store, {
      workspaceId: job.workspaceId,
      entityType: 'job',
      entityId: job.id,
      operation: 'update',
      payload: job,
      deviceId: job.deviceId
    });
    return c.json({ job });
  });

  app.delete('/:id', (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    const index = store.jobs.findIndex((job) => job.id === c.req.param('id'));
    if (index < 0) return c.json({ error: 'Job not found' }, 404);
    const [job] = store.jobs.splice(index, 1);
    if (!job) return c.json({ error: 'Job not found' }, 404);
    if (!userWorkspaceIds(store, user.id).has(job.workspaceId)) {
      return c.json({ error: 'Workspace not found' }, 404);
    }
    appendSyncEvent(store, {
      workspaceId: job.workspaceId,
      entityType: 'job',
      entityId: job.id,
      operation: 'delete',
      payload: { id: job.id },
      deviceId: 'api'
    });
    return c.json({ ok: true });
  });

  return app;
}
