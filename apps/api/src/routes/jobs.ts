import { jobSchema } from '@mini-hub/core';
import { Hono } from 'hono';
import { z } from 'zod';
import { upsertCareerSeenLeadRegistry } from '../career-seen-registry';
import { requireUser, type AppBindings } from '../context';
import type { MemoryStore } from '../store';
import { appendSyncEvent, ensurePersonalWorkspace, userWorkspaceIds, withBeforeSnapshot } from '../store';

const jobBody = z.object({
  id: z.string().min(1).optional(),
  workspaceId: z.string().min(1),
  company: z.string().min(1),
  role: z.string().min(1),
  status: z.string().min(1).default('lead'),
  applicationUrl: z.string().max(2048).default(''),
  fitScore: z.number().min(0).max(100).nullable().optional(),
  notes: z.string().default(''),
  nextActionAt: z.string().nullable().optional(),
  deviceId: z.string().min(1).optional(),
  updatedAt: z.string().min(1).optional()
});

const jobPatchBody = z.object({
  workspaceId: z.string().min(1).optional(),
  company: z.string().min(1).optional(),
  role: z.string().min(1).optional(),
  status: z.string().min(1).optional(),
  applicationUrl: z.string().max(2048).optional(),
  fitScore: z.number().min(0).max(100).nullable().optional(),
  notes: z.string().optional(),
  nextActionAt: z.string().nullable().optional(),
  deviceId: z.string().min(1).optional(),
  updatedAt: z.string().min(1).optional()
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
    const existingIndex = parsed.data.id ? store.jobs.findIndex((job) => job.id === parsed.data.id) : -1;
    const existingJob = existingIndex >= 0 ? store.jobs[existingIndex] : undefined;
    const job = jobSchema.parse({
      ...(existingJob ?? {}),
      id: parsed.data.id ?? crypto.randomUUID(),
      workspaceId: parsed.data.workspaceId,
      company: parsed.data.company,
      role: parsed.data.role,
      status: parsed.data.status,
      applicationUrl: parsed.data.applicationUrl,
      fitScore: parsed.data.fitScore ?? undefined,
      notes: parsed.data.notes,
      nextActionAt: parsed.data.nextActionAt ?? undefined,
      deviceId: parsed.data.deviceId ?? 'api',
      updatedAt: parsed.data.updatedAt ?? now
    });
    if (existingIndex >= 0) {
      store.jobs[existingIndex] = job;
    } else {
      store.jobs.push(job);
    }
    appendSyncEvent(store, {
      workspaceId: job.workspaceId,
      entityType: 'job',
      entityId: job.id,
      operation: existingIndex >= 0 ? 'update' : 'insert',
      payload: existingJob ? withBeforeSnapshot(job, existingJob, 'upsert-existing') : job,
      deviceId: job.deviceId
    });
    upsertCareerSeenLeadRegistry(store, [job], {
      deviceId: job.deviceId,
      reason: existingIndex >= 0 ? 'job-upsert-existing-seen-registry' : 'job-insert-seen-registry'
    });
    return c.json({ job }, existingIndex >= 0 ? 200 : 201);
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
    if ('fitScore' in parsed.data) {
      nextJob.fitScore = parsed.data.fitScore ?? undefined;
    }
    const job = jobSchema.parse(nextJob);
    store.jobs[index] = job;
    appendSyncEvent(store, {
      workspaceId: job.workspaceId,
      entityType: 'job',
      entityId: job.id,
      operation: 'update',
      payload: withBeforeSnapshot(job, existing, 'update'),
      deviceId: job.deviceId
    });
    upsertCareerSeenLeadRegistry(store, [job], {
      deviceId: job.deviceId,
      reason: 'job-update-seen-registry'
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
      payload: withBeforeSnapshot({ id: job.id }, job, 'delete'),
      deviceId: 'api'
    });
    upsertCareerSeenLeadRegistry(store, [job], {
      deviceId: 'api',
      reason: 'job-delete-seen-registry',
      status: 'deleted'
    });
    return c.json({ ok: true });
  });

  return app;
}
