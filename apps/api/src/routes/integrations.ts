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
import { triageGmailThreads } from '../integrations/email-triage';
import { getConnection, getConnections as getStoredConnections, verifyOAuthState, type OAuthState } from '../integrations/token-vault';
import type { CalendarEventPatch, GmailComposeInput, GmailModifyInput, GmailReplyInput } from '../integrations/types';
import { requireUser, type AppBindings } from '../context';
import { runPassiveEvent } from '../passive-engine';
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

const googleOAuthExchangeBody = z.object({
  code: z.string().min(1),
  state: z.string().min(1)
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

function connectedGoogleConnections(store: MemoryStore) {
  return getStoredConnections(store, 'google').filter((connection) => connection.status === 'connected');
}

function sortThreadsByDate<T extends { thread?: { date?: string; messages?: Array<{ internalDate?: string; date?: string }> }; date?: string; messages?: Array<{ internalDate?: string; date?: string }> }>(
  items: T[]
): T[] {
  function value(item: T): number {
    const thread = item.thread ?? item;
    const latest = thread.messages?.[thread.messages.length - 1];
    const internalDate = latest?.internalDate ? Number(latest.internalDate) : Number.NaN;
    if (Number.isFinite(internalDate)) return internalDate;
    const parsed = Date.parse(latest?.date ?? thread.date ?? '');
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return items.sort((a, b) => value(b) - value(a));
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

function emitPassiveIntegrationEvent(store: MemoryStore, eventName: string, reason: string): void {
  void runPassiveEvent(store, eventName, {
    input: { reason },
    limit: 1
  }).catch((error) => {
    console.warn(`Passive integration event ${eventName} failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  });
}

function trustedReturnOrigin(origin: string): boolean {
  const trusted = new Set(env.trustedOrigins);
  try {
    trusted.add(new URL(env.hubPublicUrl).origin);
  } catch {
    // Keep the explicit trusted origin list as the source of truth if HUB_PUBLIC_URL is malformed.
  }
  return trusted.has(origin);
}

function safeReturnTo(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return undefined;
    if (!trustedReturnOrigin(url.origin)) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function oauthProductivityRedirect(input: { returnTo?: string | undefined; status: string; message?: string | undefined }): string {
  const target = safeReturnTo(input.returnTo) ?? `${env.hubPublicUrl}/productivity`;
  const url = new URL(target);
  url.searchParams.set('google', input.status);
  if (input.message) url.searchParams.set('message', input.message);
  return url.toString();
}

function oauthMode(value: string | undefined): OAuthState['mode'] {
  return value === 'popup' ? 'popup' : 'redirect';
}

function oauthCallbackMode(value: string | undefined): 'api' | 'hub' {
  return value === 'hub' ? 'hub' : 'api';
}

function oauthStartReturnTo(c: Context<AppBindings>): string | undefined {
  const candidates = [
    c.req.query('returnTo'),
    c.req.header('x-mini-hub-return-to'),
    c.req.header('referer')
  ];
  for (const candidate of candidates) {
    const safe = safeReturnTo(candidate);
    if (safe) return safe;
  }
  return undefined;
}

function normalizedHubBasePath(pathname: string): string {
  const normalized = pathname.replace(/\/+$/u, '');
  if (!normalized || normalized === '/') return '';
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

function hostedGoogleCallbackBasePath(returnUrl: URL): string {
  try {
    const hubUrl = new URL(env.hubPublicUrl);
    if (hubUrl.origin === returnUrl.origin) return normalizedHubBasePath(hubUrl.pathname);
  } catch {
    // Fall through to host-specific inference.
  }

  if (returnUrl.hostname.endsWith('github.io')) {
    const firstPathSegment = returnUrl.pathname.split('/').filter(Boolean)[0];
    return firstPathSegment ? `/${firstPathSegment}` : '';
  }

  return '';
}

function hostedGoogleCallbackUri(returnTo: string | undefined): string | undefined {
  const safe = safeReturnTo(returnTo);
  if (!safe) return undefined;
  const url = new URL(safe);
  const basePath = hostedGoogleCallbackBasePath(url);
  return `${url.origin}${basePath}/oauth/google/callback`;
}

function previewOAuthState(value: string | undefined): OAuthState | null {
  if (!value) return null;
  try {
    return verifyOAuthState(value, 'google');
  } catch {
    return null;
  }
}

function safeJsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</gu, '\\u003c')
    .replace(/>/gu, '\\u003e')
    .replace(/&/gu, '\\u0026')
    .replace(/\u2028/gu, '\\u2028')
    .replace(/\u2029/gu, '\\u2029');
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/"/gu, '&quot;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;');
}

function oauthPopupHtml(input: { redirectUrl: string; status: string; message?: string | undefined }): string {
  const redirect = new URL(input.redirectUrl);
  const payload = {
    type: 'mini-hub:google-oauth',
    provider: 'google',
    status: input.status,
    message: input.message ?? '',
    redirectUrl: redirect.toString()
  };
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Google connected</title>
  <style>
    :root { color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #111827; color: #f8fafc; }
    main { width: min(34rem, calc(100vw - 2rem)); border: 1px solid rgba(148, 163, 184, 0.25); border-radius: 8px; padding: 1.5rem; background: rgba(15, 23, 42, 0.92); }
    p { color: #cbd5e1; }
    a { color: #93c5fd; }
  </style>
</head>
<body>
  <main>
    <strong>Google connection ${input.status === 'connected' ? 'complete' : 'finished'}</strong>
    <p>This popup should close automatically and refresh Mini Hub.</p>
    <a href="${escapeHtmlAttribute(redirect.toString())}">Return to Mini Hub</a>
  </main>
  <script>
    (() => {
      const message = ${safeJsonForScript(payload)};
      const targetOrigin = ${safeJsonForScript(redirect.origin)};
      const redirectUrl = ${safeJsonForScript(redirect.toString())};
      if (window.opener && !window.opener.closed) {
        let attempts = 0;
        const notify = () => {
          attempts += 1;
          window.opener.postMessage(message, targetOrigin);
          if (attempts >= 12) window.clearInterval(timer);
        };
        const timer = window.setInterval(notify, 250);
        notify();
        window.setTimeout(() => window.close(), 500);
      } else {
        window.location.replace(redirectUrl);
      }
    })();
  </script>
</body>
</html>`;
}

function oauthFinishResponse(
  c: Context<AppBindings>,
  input: { state?: OAuthState | null; returnTo?: string | undefined; status: string; message?: string | undefined }
) {
  const redirectUrl = oauthProductivityRedirect({ returnTo: input.returnTo ?? input.state?.returnTo, status: input.status, message: input.message });
  if (input.state?.mode === 'popup') {
    return c.html(oauthPopupHtml({ redirectUrl, status: input.status, message: input.message }));
  }
  return c.redirect(redirectUrl);
}

function oauthExchangeStateValue(body: unknown): string | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
  const value = (body as { state?: unknown }).state;
  return typeof value === 'string' ? value : undefined;
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

  app.get('/google/connections', (c) => {
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
      const returnTo = oauthStartReturnTo(c);
      const callbackMode = oauthCallbackMode(c.req.query('callback'));
      return c.json({
        url: googleAuthUrl({
          returnTo,
          mode: oauthMode(c.req.query('mode')),
          redirectUri: callbackMode === 'hub' ? hostedGoogleCallbackUri(returnTo) : undefined,
          loginHint: c.req.query('loginHint')
        })
      });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Google OAuth unavailable' }, 400);
    }
  });

  app.post('/google/oauth/exchange', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = googleOAuthExchangeBody.safeParse(body);
    const statePreview = previewOAuthState(parsed.success ? parsed.data.state : oauthExchangeStateValue(body));
    const finish = (input: { ok: boolean; status: string; message?: string | undefined }) =>
      c.json({
        ok: input.ok,
        status: input.status,
        redirectUrl: oauthProductivityRedirect({ returnTo: statePreview?.returnTo, status: input.status, message: input.message }),
        ...(input.message ? { message: input.message } : {})
      });

    if (!parsed.success) {
      return finish({ ok: false, status: 'missing-code', message: 'Google OAuth did not return a usable authorization code.' });
    }

    try {
      const connectionState = await handleGoogleCallback(store, parsed.data.code, parsed.data.state);
      emitPassiveIntegrationEvent(store, 'google.oauth.connected', 'google-oauth-exchange');
      return c.json({
        ok: true,
        status: 'connected',
        redirectUrl: oauthProductivityRedirect({ returnTo: connectionState.returnTo, status: 'connected' })
      });
    } catch (error) {
      return finish({
        ok: false,
        status: 'error',
        message: error instanceof Error ? error.message : 'oauth-failed'
      });
    }
  });

  app.get('/google/oauth/callback', async (c) => {
    const code = c.req.query('code');
    const state = c.req.query('state');
    const statePreview = previewOAuthState(state);
    if (!code || !state) return oauthFinishResponse(c, { state: statePreview, status: 'missing-code' });
    try {
      const connectionState = await handleGoogleCallback(store, code, state);
      emitPassiveIntegrationEvent(store, 'google.oauth.connected', 'google-oauth-callback');
      return oauthFinishResponse(c, { state: connectionState, status: 'connected' });
    } catch (error) {
      return oauthFinishResponse(c, {
        state: statePreview,
        status: 'error',
        message: error instanceof Error ? error.message : 'oauth-failed'
      });
    }
  });

  app.post('/google/revoke', async (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    try {
      const body = await c.req.json().catch(() => ({})) as { connectionId?: string };
      await revokeGoogleConnection(store, body.connectionId);
      emitPassiveIntegrationEvent(store, 'google.oauth.revoked', 'google-oauth-revoke');
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
      const connections = connectedGoogleConnections(store);
      if (!connections.length) throw new Error('Google is not connected');
      const results = await Promise.allSettled(
        connections.map((connection) => new GoogleCalendarConnector(store, connection.id).listCalendars())
      );
      const calendars = results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
      if (!calendars.length) {
        const failure = results.find((result) => result.status === 'rejected');
        if (failure?.status === 'rejected') throw failure.reason;
      }
      return c.json({ calendars });
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
      const connections = connectedGoogleConnections(store);
      if (!connections.length) throw new Error('Google is not connected');
      const results = await Promise.allSettled(
        connections.map((connection) => new GoogleGmailConnector(store, connection.id).listLabels())
      );
      const byId = new Map(
        results
          .flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
          .map((label) => [label.id, label])
      );
      if (!byId.size) {
        const failure = results.find((result) => result.status === 'rejected');
        if (failure?.status === 'rejected') throw failure.reason;
      }
      return c.json({ labels: Array.from(byId.values()) });
    } catch (error) {
      const result = connectorError(error);
      return c.json({ error: result.message }, result.status);
    }
  });

  app.get('/gmail/threads', async (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    try {
      const connections = connectedGoogleConnections(store);
      if (!connections.length) throw new Error('Google is not connected');
      const query = gmailThreadQuery(c);
      const results = await Promise.allSettled(
        connections.map((connection) => new GoogleGmailConnector(store, connection.id).listThreads(query))
      );
      const threads = sortThreadsByDate(results.flatMap((result) => (result.status === 'fulfilled' ? result.value.threads : []))).slice(
        0,
        query.maxResults ?? 10
      );
      if (!threads.length) {
        const failure = results.find((result) => result.status === 'rejected');
        if (failure?.status === 'rejected') throw failure.reason;
      }
      return c.json({ threads });
    } catch (error) {
      const result = connectorError(error);
      return c.json({ error: result.message }, result.status);
    }
  });

  app.get('/gmail/priority', async (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    try {
      const connections = connectedGoogleConnections(store);
      if (!connections.length) throw new Error('Google is not connected');
      const query = gmailThreadQuery(c);
      const maxResults = Math.min(Math.max(query.maxResults ?? 10, 1), 20);
      const searchQuery = query.q ?? 'in:inbox newer_than:30d -category:promotions -category:social -category:forums';
      const results = await Promise.allSettled(
        connections.map((connection) =>
          new GoogleGmailConnector(store, connection.id).listThreads({
            ...query,
            q: searchQuery,
            maxResults: 20
          })
        )
      );
      const threads = sortThreadsByDate(
        results.flatMap((result) => (result.status === 'fulfilled' ? result.value.threads : []))
      );
      if (!threads.length) {
        const failure = results.find((result) => result.status === 'rejected');
        if (failure?.status === 'rejected') throw failure.reason;
      }
      const insights = await triageGmailThreads(threads, { maxResults, minPriority: 65 });
      return c.json({ threads: insights });
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
      const connections = connectedGoogleConnections(store);
      if (!connections.length) throw new Error('Google is not connected');
      const results = await Promise.allSettled(
        connections.flatMap((connection) => [
          new GoogleCalendarConnector(store, connection.id).timeline(input),
          new GoogleGmailConnector(store, connection.id).timeline({ maxResults: 5 })
        ])
      );
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
