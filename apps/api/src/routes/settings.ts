import { personalSettingsSchema, personalWorkspaceId } from '@mini-hub/core';
import { Hono } from 'hono';
import { z } from 'zod';
import { requireUser, type AppBindings } from '../context';
import { appendSyncEvent, ensurePersonalWorkspace, type MemoryStore } from '../store';

const settingsBody = z.object({
  theme: z.string().optional(),
  highScores: z.record(z.string(), z.unknown()).default({}),
  recentState: z.record(z.string(), z.unknown()).default({}),
  preferences: z.record(z.string(), z.unknown()).default({}),
  lastLegacyImportAt: z.string().optional()
});

function defaultSettings() {
  const now = new Date().toISOString();
  return personalSettingsSchema.parse({
    workspaceId: personalWorkspaceId,
    highScores: {},
    recentState: {},
    preferences: {},
    deviceId: 'api',
    updatedAt: now
  });
}

export function settingsRoutes(store: MemoryStore): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.get('/', (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    ensurePersonalWorkspace(store);
    store.settings ??= defaultSettings();
    return c.json({ settings: store.settings });
  });

  app.put('/', async (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    ensurePersonalWorkspace(store);
    const parsed = settingsBody.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400);

    const settings = personalSettingsSchema.parse({
      ...(store.settings ?? defaultSettings()),
      ...parsed.data,
      workspaceId: personalWorkspaceId,
      deviceId: 'api',
      updatedAt: new Date().toISOString()
    });
    store.settings = settings;
    appendSyncEvent(store, {
      workspaceId: settings.workspaceId,
      entityType: 'settings',
      entityId: settings.workspaceId,
      operation: 'update',
      payload: settings,
      deviceId: settings.deviceId
    });
    return c.json({ settings });
  });

  return app;
}

