import { careerScoutCandidateStatusSchema, personalWorkspaceId, type CareerScoutCandidate } from '@mini-hub/core';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  careerScoutSummary,
  promoteCareerScoutCandidate,
  rejectCareerScoutCandidate,
  upsertCareerScoutCandidate,
  type CareerScoutUpsertInput
} from '../career-scout';
import { requireUser, type AppBindings } from '../context';
import { buildPassiveSnapshot, runPassiveTask } from '../passive-engine';
import { ensurePersonalWorkspace, userWorkspaceIds, type MemoryStore } from '../store';

type FetchLike = typeof fetch;

interface CareerScoutRouteOptions {
  externalFetch?: FetchLike;
}

const listQuerySchema = z.object({
  status: z.string().optional(),
  limit: z.coerce.number().int().positive().max(250).default(80)
});

const rejectBodySchema = z.object({
  reason: z.string().trim().min(1).max(160).default('manual-reject')
});

const refineBodySchema = z.object({
  usePaidProvider: z.boolean().default(false),
  costCeilingUsd: z.number().nonnegative().max(2).default(0.05)
});

function visibleCandidates(store: MemoryStore, workspaceIds: Set<string>): CareerScoutCandidate[] {
  return store.careerScoutCandidates
    .filter((candidate) => workspaceIds.has(candidate.workspaceId))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function statusSet(value: string | undefined): Set<string> | null {
  if (!value) return null;
  return new Set(value.split(',').map((item) => item.trim()).filter(Boolean));
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Career Scout request failed.';
}

export function careerScoutRoutes(store: MemoryStore, options: CareerScoutRouteOptions = {}): Hono<AppBindings> {
  const app = new Hono<AppBindings>();
  const externalFetch = options.externalFetch ?? fetch;

  app.get('/', (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    ensurePersonalWorkspace(store);
    const workspaceIds = userWorkspaceIds(store, user.id);
    const parsed = listQuerySchema.safeParse({
      status: c.req.query('status'),
      limit: c.req.query('limit') ?? undefined
    });
    if (!parsed.success) return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400);
    const statuses = statusSet(parsed.data.status);
    const candidates = visibleCandidates(store, workspaceIds)
      .filter((candidate) => !statuses || statuses.has(candidate.status))
      .slice(0, parsed.data.limit);
    return c.json({ candidates, summary: careerScoutSummary(visibleCandidates(store, workspaceIds)) });
  });

  app.get('/summary', (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    ensurePersonalWorkspace(store);
    const workspaceIds = userWorkspaceIds(store, user.id);
    return c.json({ summary: careerScoutSummary(visibleCandidates(store, workspaceIds)) });
  });

  app.post('/candidates', async (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    ensurePersonalWorkspace(store);
    const parsed = z
      .object({
        sourceUrl: z.string().min(1),
        company: z.string().optional(),
        role: z.string().optional(),
        rawTitle: z.string().optional(),
        rawSummary: z.string().optional(),
        status: careerScoutCandidateStatusSchema.optional()
      })
      .passthrough()
      .safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400);
    const input: CareerScoutUpsertInput = {
      sourceUrl: parsed.data.sourceUrl,
      workspaceId: personalWorkspaceId,
      deviceId: 'api'
    };
    if (parsed.data.company) input.company = parsed.data.company;
    if (parsed.data.role) input.role = parsed.data.role;
    if (parsed.data.rawTitle) input.rawTitle = parsed.data.rawTitle;
    if (parsed.data.rawSummary) input.rawSummary = parsed.data.rawSummary;
    if (parsed.data.status) input.status = parsed.data.status;
    const result = upsertCareerScoutCandidate(store, input);
    return c.json(result, result.inserted ? 201 : 200);
  });

  app.post('/candidates/:id/promote', (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    ensurePersonalWorkspace(store);
    try {
      const result = promoteCareerScoutCandidate(store, c.req.param('id'));
      return c.json(result);
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 404);
    }
  });

  app.post('/candidates/:id/reject', async (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    ensurePersonalWorkspace(store);
    const parsed = rejectBodySchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400);
    try {
      const candidate = rejectCareerScoutCandidate(store, c.req.param('id'), parsed.data.reason);
      return c.json({ candidate });
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 404);
    }
  });

  app.post('/candidates/:id/refine', async (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    ensurePersonalWorkspace(store);
    const parsed = refineBodySchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400);
    const candidate = store.careerScoutCandidates.find((item) => item.id === c.req.param('id'));
    if (!candidate) return c.json({ error: 'Career Scout candidate not found.' }, 404);
    if (parsed.data.usePaidProvider && parsed.data.costCeilingUsd <= 0) {
      return c.json({ error: 'Paid refinement requires a positive cost ceiling.' }, 400);
    }
    const result = upsertCareerScoutCandidate(store, {
      id: candidate.id,
      workspaceId: candidate.workspaceId,
      sourceUrl: candidate.sourceUrl,
      status: candidate.status === 'rejected' ? 'needs_review' : 'enriched',
      stage: 'refine_rank',
      metadata: {
        ...candidate.metadata,
        refineRequestedAt: new Date().toISOString(),
        paidProviderAllowed: parsed.data.usePaidProvider,
        costCeilingUsd: parsed.data.costCeilingUsd,
        refineNote: parsed.data.usePaidProvider
          ? 'Queued for paid-provider-capable refinement infrastructure; API key availability and budget cap are enforced before paid calls.'
          : 'Refreshed with local rules only; paid provider was not allowed for this refinement request.'
      }
    });
    return c.json(result);
  });

  app.post('/max-power-search', async (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    ensurePersonalWorkspace(store);
    try {
      const run = await runPassiveTask(store, 'passive-task:research-monitor', {
        externalFetch,
        force: true,
        input: { manual: true, reason: 'career-scout-max-power-search' }
      });
      return c.json({ run, snapshot: buildPassiveSnapshot(store), summary: careerScoutSummary(store.careerScoutCandidates) });
    } catch (error) {
      return c.json({ error: errorMessage(error), snapshot: buildPassiveSnapshot(store) }, 409);
    }
  });

  return app;
}
