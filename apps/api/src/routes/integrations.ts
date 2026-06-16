import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { env } from '../env';
import {
  GoogleCalendarConnector,
  GoogleGmailConnector,
  googleAuthUrl,
  googleCatalog,
  handleGoogleCallback,
  revokeGoogleConnection
} from '../integrations/google';
import { getConnection } from '../integrations/token-vault';
import type { CalendarEventPatch, GmailComposeInput, GmailModifyInput, GmailReplyInput } from '../integrations/types';
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

const emailHeaderValue = z.string().min(1).max(512).refine((value) => !/[\r\n]/u.test(value), {
  message: 'Email header values cannot contain newlines'
});

const gmailComposeBody = z.object({
  to: z.array(emailHeaderValue).min(1),
  cc: z.array(emailHeaderValue).default([]),
  bcc: z.array(emailHeaderValue).default([]),
  subject: z.string().min(1).max(998).refine((value) => !/[\r\n]/u.test(value), {
    message: 'Subject cannot contain newlines'
  }),
  bodyText: z.string().min(1).max(100_000)
});

const gmailReplyBody = z.object({
  to: z.array(emailHeaderValue).default([]),
  cc: z.array(emailHeaderValue).default([]),
  bcc: z.array(emailHeaderValue).default([]),
  bodyText: z.string().min(1).max(100_000)
});

const gmailModifyBody = z.object({
  addLabelIds: z.array(z.string().min(1)).default([]),
  removeLabelIds: z.array(z.string().min(1)).default([])
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
  if (
    message.toLowerCase().includes('not connected') ||
    message.toLowerCase().includes('reauthorization') ||
    message.toLowerCase().includes('insufficient authentication scopes')
  ) {
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

function gmailComposeInput(input: z.infer<typeof gmailComposeBody>): GmailComposeInput {
  const compose: GmailComposeInput = {
    to: input.to,
    subject: input.subject,
    bodyText: input.bodyText
  };
  if (input.cc.length) compose.cc = input.cc;
  if (input.bcc.length) compose.bcc = input.bcc;
  return compose;
}

function gmailReplyInput(threadId: string, input: z.infer<typeof gmailReplyBody>): GmailReplyInput {
  const reply: GmailReplyInput = {
    threadId,
    bodyText: input.bodyText
  };
  if (input.to.length) reply.to = input.to;
  if (input.cc.length) reply.cc = input.cc;
  if (input.bcc.length) reply.bcc = input.bcc;
  return reply;
}

function gmailModifyInput(input: z.infer<typeof gmailModifyBody>): GmailModifyInput {
  const modify: GmailModifyInput = {};
  if (input.addLabelIds.length) modify.addLabelIds = input.addLabelIds;
  if (input.removeLabelIds.length) modify.removeLabelIds = input.removeLabelIds;
  return modify;
}

function gmailThreadQuery(c: Context<AppBindings>): {
  q?: string;
  labelIds?: string[];
  pageToken?: string;
  maxResults?: number;
} {
  const query: { q?: string; labelIds?: string[]; pageToken?: string; maxResults?: number } = {};
  const q = c.req.query('q');
  const labelIds = c.req.queries('labelIds') ?? [];
  const pageToken = c.req.query('pageToken');
  const maxResults = c.req.query('maxResults');
  if (q !== undefined && q.trim()) query.q = q;
  if (labelIds.length) query.labelIds = labelIds;
  if (pageToken !== undefined) query.pageToken = pageToken;
  if (maxResults !== undefined) query.maxResults = Number(maxResults);
  return query;
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

  app.get('/gmail/labels', async (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    try {
      const connector = new GoogleGmailConnector(store);
      return c.json({ labels: await connector.listLabels() });
    } catch (error) {
      const result = connectorError(error);
      return c.json({ error: result.message }, result.status);
    }
  });

  app.get('/gmail/threads', async (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    try {
      const connector = new GoogleGmailConnector(store);
      return c.json(await connector.listThreads(gmailThreadQuery(c)));
    } catch (error) {
      const result = connectorError(error);
      return c.json({ error: result.message }, result.status);
    }
  });

  app.get('/gmail/threads/:threadId', async (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    try {
      const connector = new GoogleGmailConnector(store);
      return c.json({ thread: await connector.getThread(c.req.param('threadId')) });
    } catch (error) {
      const result = connectorError(error);
      return c.json({ error: result.message }, result.status);
    }
  });

  app.post('/gmail/messages/send', async (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    const parsed = gmailComposeBody.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400);
    try {
      const connector = new GoogleGmailConnector(store);
      return c.json({ message: await connector.sendMessage(gmailComposeInput(parsed.data)) }, 201);
    } catch (error) {
      const result = connectorError(error);
      return c.json({ error: result.message }, result.status);
    }
  });

  app.post('/gmail/drafts', async (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    const body = await c.req.json();
    const parsedReply = z.object({ threadId: z.string().min(1) }).merge(gmailReplyBody).safeParse(body);
    const parsedCompose = gmailComposeBody.safeParse(body);
    if (!parsedReply.success && !parsedCompose.success) {
      return c.json({ error: 'Invalid request', issues: parsedCompose.error.issues }, 400);
    }
    try {
      const connector = new GoogleGmailConnector(store);
      const draft = parsedReply.success
        ? await connector.createDraft(gmailReplyInput(parsedReply.data.threadId, parsedReply.data))
        : parsedCompose.success
          ? await connector.createDraft(gmailComposeInput(parsedCompose.data))
          : null;
      if (!draft) return c.json({ error: 'Invalid request' }, 400);
      return c.json({ draft }, 201);
    } catch (error) {
      const result = connectorError(error);
      return c.json({ error: result.message }, result.status);
    }
  });

  app.post('/gmail/drafts/:draftId/send', async (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    try {
      const connector = new GoogleGmailConnector(store);
      return c.json({ message: await connector.sendDraft(c.req.param('draftId')) });
    } catch (error) {
      const result = connectorError(error);
      return c.json({ error: result.message }, result.status);
    }
  });

  app.delete('/gmail/drafts/:draftId', async (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    try {
      const connector = new GoogleGmailConnector(store);
      return c.json(await connector.deleteDraft(c.req.param('draftId')));
    } catch (error) {
      const result = connectorError(error);
      return c.json({ error: result.message }, result.status);
    }
  });

  app.post('/gmail/threads/:threadId/reply', async (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    const parsed = gmailReplyBody.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400);
    try {
      const connector = new GoogleGmailConnector(store);
      return c.json({ message: await connector.reply(gmailReplyInput(c.req.param('threadId'), parsed.data)) }, 201);
    } catch (error) {
      const result = connectorError(error);
      return c.json({ error: result.message }, result.status);
    }
  });

  app.post('/gmail/threads/:threadId/modify', async (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    const parsed = gmailModifyBody.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400);
    try {
      const connector = new GoogleGmailConnector(store);
      return c.json({ thread: await connector.modifyThread(c.req.param('threadId'), gmailModifyInput(parsed.data)) });
    } catch (error) {
      const result = connectorError(error);
      return c.json({ error: result.message }, result.status);
    }
  });

  app.post('/gmail/threads/:threadId/archive', async (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    try {
      const connector = new GoogleGmailConnector(store);
      return c.json({ thread: await connector.archiveThread(c.req.param('threadId')) });
    } catch (error) {
      const result = connectorError(error);
      return c.json({ error: result.message }, result.status);
    }
  });

  app.post('/gmail/threads/:threadId/read', async (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    try {
      const connector = new GoogleGmailConnector(store);
      return c.json({ thread: await connector.markThreadRead(c.req.param('threadId')) });
    } catch (error) {
      const result = connectorError(error);
      return c.json({ error: result.message }, result.status);
    }
  });

  app.post('/gmail/threads/:threadId/unread', async (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    try {
      const connector = new GoogleGmailConnector(store);
      return c.json({ thread: await connector.markThreadUnread(c.req.param('threadId')) });
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
      const calendar = new GoogleCalendarConnector(store);
      const gmail = new GoogleGmailConnector(store);
      const results = await Promise.allSettled([calendar.timeline(input), gmail.timeline({ maxResults: 5 })]);
      const items = results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
      if (!items.length) {
        const failure = results.find((result) => result.status === 'rejected');
        if (failure?.status === 'rejected') throw failure.reason;
      }
      return c.json({ items: items.sort((a, b) => a.when.localeCompare(b.when)) });
    } catch (error) {
      const result = connectorError(error);
      return c.json({ error: result.message }, result.status);
    }
  });

  return app;
}
