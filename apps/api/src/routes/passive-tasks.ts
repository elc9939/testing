import { passiveTaskStatusSchema, type PassiveEngineSettings } from '@mini-hub/core';
import { Hono } from 'hono';
import { z } from 'zod';
import { requireUser, type AppBindings } from '../context';
import {
  buildPassiveSnapshot,
  type PassiveRunInput,
  runDuePassiveTasks,
  runPassiveEvent,
  runPassiveTask,
  setPassiveWatcherEnabled,
  updatePassiveSettings,
  updatePassiveTaskStatus
} from '../passive-engine';
import { ensurePersonalWorkspace, persistPassiveTasks, type MemoryStore } from '../store';

type FetchLike = typeof fetch;

interface PassiveTaskRouteOptions {
  externalFetch?: FetchLike;
}

const settingsPatchSchema = z.object({
  enabled: z.boolean().optional(),
  notificationStyle: z.enum(['digest', 'urgent_only', 'off']).optional(),
  idleOnly: z.boolean().optional(),
  resourceLimit: z.enum(['light', 'balanced', 'heavy']).optional(),
  localAiPreference: z.enum(['local_first', 'local_only', 'cloud_allowed']).optional(),
  maxRunsPerTick: z.number().int().positive().max(10).optional(),
  watchedFolders: z.array(z.string()).optional(),
  watchedDomains: z.array(z.string()).optional(),
  watchedAccounts: z.array(z.string()).optional(),
  enabledFamilies: z.record(z.string(), z.boolean()).optional()
});

const tickBodySchema = z.object({
  idle: z.boolean().optional(),
  reason: z.string().optional(),
  eventName: z.string().optional(),
  limit: z.number().int().positive().max(10).optional()
});

const eventNameSchema = z.string().min(1).max(120).regex(/^[a-z0-9_.:-]+$/iu);

const watcherToggleSchema = z.object({
  enabled: z.boolean()
});

const statusBodySchema = z.object({
  status: passiveTaskStatusSchema
});

type PassiveSettingsPatch = Partial<Omit<PassiveEngineSettings, 'updatedAt'>>;
type TickBody = z.infer<typeof tickBodySchema>;

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Passive task request failed.';
}

function compactSettingsPatch(input: z.infer<typeof settingsPatchSchema>): PassiveSettingsPatch {
  const patch: PassiveSettingsPatch = {};
  if (input.enabled !== undefined) patch.enabled = input.enabled;
  if (input.notificationStyle !== undefined) patch.notificationStyle = input.notificationStyle;
  if (input.idleOnly !== undefined) patch.idleOnly = input.idleOnly;
  if (input.resourceLimit !== undefined) patch.resourceLimit = input.resourceLimit;
  if (input.localAiPreference !== undefined) patch.localAiPreference = input.localAiPreference;
  if (input.maxRunsPerTick !== undefined) patch.maxRunsPerTick = input.maxRunsPerTick;
  if (input.watchedFolders !== undefined) patch.watchedFolders = input.watchedFolders;
  if (input.watchedDomains !== undefined) patch.watchedDomains = input.watchedDomains;
  if (input.watchedAccounts !== undefined) patch.watchedAccounts = input.watchedAccounts;
  if (input.enabledFamilies !== undefined) patch.enabledFamilies = input.enabledFamilies;
  return patch;
}

function passiveRunInput(input: TickBody, fallbackReason: string): PassiveRunInput {
  const result: PassiveRunInput = { reason: input.reason ?? fallbackReason };
  if (input.idle !== undefined) result.idle = input.idle;
  if (input.eventName !== undefined) result.eventName = input.eventName;
  return result;
}

export function passiveTaskRoutes(store: MemoryStore, options: PassiveTaskRouteOptions = {}): Hono<AppBindings> {
  const app = new Hono<AppBindings>();
  const externalFetch = options.externalFetch ?? fetch;

  app.get('/snapshot', (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    ensurePersonalWorkspace(store);
    return c.json(buildPassiveSnapshot(store));
  });

  app.patch('/settings', async (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    ensurePersonalWorkspace(store);
    const parsed = settingsPatchSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400);
    const settings = updatePassiveSettings(store, compactSettingsPatch(parsed.data));
    return c.json({ settings, snapshot: buildPassiveSnapshot(store) });
  });

  app.post('/tick', async (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    ensurePersonalWorkspace(store);
    const parsed = tickBodySchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400);
    try {
      const tickOptions: { externalFetch: FetchLike; input: PassiveRunInput; limit?: number } = {
        externalFetch,
        input: passiveRunInput(parsed.data, 'api-tick')
      };
      if (parsed.data.limit !== undefined) tickOptions.limit = parsed.data.limit;
      const runs = await runDuePassiveTasks(store, tickOptions);
      return c.json({ runs, snapshot: buildPassiveSnapshot(store) });
    } catch (error) {
      return c.json({ error: errorMessage(error), snapshot: buildPassiveSnapshot(store) }, 500);
    }
  });

  app.post('/events/:eventName', async (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    ensurePersonalWorkspace(store);
    const eventName = c.req.param('eventName');
    const parsedEventName = eventNameSchema.safeParse(eventName);
    if (!parsedEventName.success) {
      return c.json({ error: 'Invalid event name', issues: parsedEventName.error.issues }, 400);
    }
    const parsed = tickBodySchema.omit({ eventName: true }).safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400);
    try {
      const eventOptions: { externalFetch: FetchLike; input: Omit<PassiveRunInput, 'eventName'>; limit?: number } = {
        externalFetch,
        input: { reason: parsed.data.reason ?? `api-event:${parsedEventName.data}` }
      };
      if (parsed.data.idle !== undefined) eventOptions.input.idle = parsed.data.idle;
      if (parsed.data.limit !== undefined) eventOptions.limit = parsed.data.limit;
      const runs = await runPassiveEvent(store, parsedEventName.data, eventOptions);
      return c.json({ runs, snapshot: buildPassiveSnapshot(store) });
    } catch (error) {
      return c.json({ error: errorMessage(error), snapshot: buildPassiveSnapshot(store) }, 500);
    }
  });

  app.post('/tasks/:id/run', async (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    ensurePersonalWorkspace(store);
    const parsed = tickBodySchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400);
    try {
      const run = await runPassiveTask(store, c.req.param('id'), {
        externalFetch,
        force: true,
        input: passiveRunInput(parsed.data, 'manual-run')
      });
      return c.json({ run, snapshot: buildPassiveSnapshot(store) });
    } catch (error) {
      return c.json({ error: errorMessage(error), snapshot: buildPassiveSnapshot(store) }, 409);
    }
  });

  app.post('/tasks/:id/status', async (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    ensurePersonalWorkspace(store);
    const parsed = statusBodySchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400);
    try {
      const task = updatePassiveTaskStatus(store, c.req.param('id'), parsed.data.status);
      return c.json({ task, snapshot: buildPassiveSnapshot(store) });
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 404);
    }
  });

  app.post('/tasks/:id/pause', (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    ensurePersonalWorkspace(store);
    try {
      const task = updatePassiveTaskStatus(store, c.req.param('id'), 'paused');
      return c.json({ task, snapshot: buildPassiveSnapshot(store) });
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 404);
    }
  });

  app.post('/tasks/:id/resume', (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    ensurePersonalWorkspace(store);
    try {
      const task = updatePassiveTaskStatus(store, c.req.param('id'), 'active');
      return c.json({ task, snapshot: buildPassiveSnapshot(store) });
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 404);
    }
  });

  app.post('/tasks/:id/cancel', (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    ensurePersonalWorkspace(store);
    try {
      const task = updatePassiveTaskStatus(store, c.req.param('id'), 'cancelled');
      return c.json({ task, snapshot: buildPassiveSnapshot(store) });
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 404);
    }
  });

  app.post('/watchers/:id/toggle', async (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    ensurePersonalWorkspace(store);
    const parsed = watcherToggleSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400);
    try {
      const watcher = setPassiveWatcherEnabled(store, c.req.param('id'), parsed.data.enabled);
      return c.json({ watcher, snapshot: buildPassiveSnapshot(store) });
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 404);
    }
  });

  app.post('/notifications/:id/dismiss', (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    ensurePersonalWorkspace(store);
    const id = c.req.param('id');
    const now = new Date().toISOString();
    let found = false;
    store.passiveNotifications = store.passiveNotifications.map((notification) => {
      if (notification.id !== id) return notification;
      found = true;
      return { ...notification, dismissedAt: now };
    });
    if (!found) return c.json({ error: 'Notification not found.' }, 404);
    persistPassiveTasks(store);
    return c.json({ ok: true, snapshot: buildPassiveSnapshot(store) });
  });

  return app;
}
