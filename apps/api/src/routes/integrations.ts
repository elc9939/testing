import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { env } from '../env';
import {
  GoogleCalendarConnector,
  googleAuthUrl,
  googleCatalog,
  handleGoogleCallback,
  revokeGoogleConnection
} from '../integrations/google';
import { getConnection } from '../integrations/token-vault';
import type { CalendarEventPatch } from '../integrations/types';
import { requireUser, type AppBindings } from '../context';
import type { MemoryStore } from '../store';

const eventBody = z.object({
  calendarId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().default(''),
  location: z.string().default(''),
  start: z.string().min(1),
  end: z.string().min(1),
  timeZone: z.string().min(1).default('UTC'),
  recurrence: z.array(z.string()).default([]),
  reminders: z
    .object({
      useDefault: z.boolean().default(true),
      overrides: z.array(z.object({ method: z.string().min(1), minutes: z.number().int().nonnegative() })).default([])
    })
    .default({ useDefault: true, overrides: [] })
});

const eventPatchBody = eventBody.partial().extend({
  calendarId: z.string().min(1),
  eventId: z.string().min(1)
});

const deleteBody = z.object({
  calendarId: z.string().min(1),
  eventId: z.string().min(1)
});

const moveBody = deleteBody.extend({
  destinationCalendarId: z.string().min(1)
});

function publicConnection(connection: ReturnType<typeof getConnection>) {
  if (!connection) return null;
  return {
    id: connection.id,
    provider: connection.provider,
    accountLabel: connection.accountLabel,
    scopes: connection.scopes,
    status: connection.status,
    lastSyncAt: connection.lastSyncAt,
    error: connection.error,
    updatedAt: connection.updatedAt
  };
}

function connectorError(error: unknown): { message: string; status: 400 | 401 | 429 | 502 } {
  const message = error instanceof Error ? error.message : 'Integration request failed';
  if (message.toLowerCase().includes('not connected') || message.toLowerCase().includes('reauthorization')) {
    return { message, status: 401 };
  }
  if (message.toLowerCase().includes('rate')) return { message, status: 429 };
  if (message.toLowerCase().includes('google request failed')) return { message, status: 502 };
  return { message, status: 400 };
}

function eventQuery(c: Context<AppBindings>): {
  calendarId: string;
  timeMin?: string;
  timeMax?: string;
  q?: string;
} {
  const query: { calendarId: string; timeMin?: string; timeMax?: string; q?: string } = {
    calendarId: c.req.query('calendarId') ?? 'primary'
  };
  const timeMin = c.req.query('timeMin');
  const timeMax = c.req.query('timeMax');
  const q = c.req.query('q');
  if (timeMin !== undefined) query.timeMin = timeMin;
  if (timeMax !== undefined) query.timeMax = timeMax;
  if (q !== undefined) query.q = q;
  return query;
}

function eventPatch(input: z.infer<typeof eventPatchBody>): CalendarEventPatch {
  const patch: CalendarEventPatch = {
    calendarId: input.calendarId,
    eventId: input.eventId
  };
  if (input.title !== undefined) patch.title = input.title;
  if (input.description !== undefined) patch.description = input.description;
  if (input.location !== undefined) patch.location = input.location;
  if (input.start !== undefined) patch.start = input.start;
  if (input.end !== undefined) patch.end = input.end;
  if (input.timeZone !== undefined) patch.timeZone = input.timeZone;
  if (input.recurrence !== undefined) patch.recurrence = input.recurrence;
  if (input.reminders !== undefined) patch.reminders = input.reminders;
  return patch;
}

export function integrationRoutes(store: MemoryStore): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.get('/catalog', (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    return c.json({ connectors: googleCatalog() });
  });

  app.get('/connections', (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    return c.json({
      connections: Array.from(store.integrationConnections.values()).map(publicConnection)
    });
  });

  app.get('/google/oauth/start', (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    try {
      return c.json({ url: googleAuthUrl() });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Google OAuth unavailable' }, 400);
    }
  });

  app.get('/google/oauth/callback', async (c) => {
    const code = c.req.query('code');
    const state = c.req.query('state');
    if (!code || !state) return c.redirect(`${env.hubPublicUrl}/productivity?google=missing-code`);
    try {
      await handleGoogleCallback(store, code, state);
      return c.redirect(`${env.hubPublicUrl}/productivity?google=connected`);
    } catch (error) {
      const message = encodeURIComponent(error instanceof Error ? error.message : 'oauth-failed');
      return c.redirect(`${env.hubPublicUrl}/productivity?google=error&message=${message}`);
    }
  });

  app.post('/google/revoke', async (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    try {
      await revokeGoogleConnection(store);
      return c.json({ ok: true });
    } catch (error) {
      const result = connectorError(error);
      return c.json({ error: result.message }, result.status);
    }
  });

  return app;
}

export function productivityRoutes(store: MemoryStore): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.get('/calendar/calendars', async (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    try {
      const connector = new GoogleCalendarConnector(store);
      return c.json({ calendars: await connector.listCalendars() });
    } catch (error) {
      const result = connectorError(error);
      return c.json({ error: result.message }, result.status);
    }
  });

  app.get('/calendar/events', async (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    try {
      const connector = new GoogleCalendarConnector(store);
      return c.json({ events: await connector.listEvents(eventQuery(c)) });
    } catch (error) {
      const result = connectorError(error);
      return c.json({ error: result.message }, result.status);
    }
  });

  app.post('/calendar/events', async (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    const parsed = eventBody.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400);
    try {
      const connector = new GoogleCalendarConnector(store);
      return c.json({ event: await connector.createEvent(parsed.data) }, 201);
    } catch (error) {
      const result = connectorError(error);
      return c.json({ error: result.message }, result.status);
    }
  });

  app.patch('/calendar/events', async (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    const parsed = eventPatchBody.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400);
    try {
      const connector = new GoogleCalendarConnector(store);
      return c.json({ event: await connector.updateEvent(eventPatch(parsed.data)) });
    } catch (error) {
      const result = connectorError(error);
      return c.json({ error: result.message }, result.status);
    }
  });

  app.delete('/calendar/events', async (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    const parsed = deleteBody.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400);
    try {
      const connector = new GoogleCalendarConnector(store);
      return c.json(await connector.deleteEvent(parsed.data.calendarId, parsed.data.eventId));
    } catch (error) {
      const result = connectorError(error);
      return c.json({ error: result.message }, result.status);
    }
  });

  app.post('/calendar/events/move', async (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    const parsed = moveBody.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400);
    try {
      const connector = new GoogleCalendarConnector(store);
      return c.json({
        event: await connector.moveEvent(
          parsed.data.calendarId,
          parsed.data.eventId,
          parsed.data.destinationCalendarId
        )
      });
    } catch (error) {
      const result = connectorError(error);
      return c.json({ error: result.message }, result.status);
    }
  });

  app.get('/timeline', async (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    try {
      const input: { timeMin?: string; timeMax?: string } = {};
      const timeMin = c.req.query('timeMin');
      const timeMax = c.req.query('timeMax');
      if (timeMin !== undefined) input.timeMin = timeMin;
      if (timeMax !== undefined) input.timeMax = timeMax;
      const connector = new GoogleCalendarConnector(store);
      return c.json({ items: await connector.timeline(input) });
    } catch (error) {
      const result = connectorError(error);
      return c.json({ error: result.message }, result.status);
    }
  });

  return app;
}
