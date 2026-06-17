import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { auth } from './auth';
import { personalUserId } from '@mini-hub/core';
import type { AppBindings, SessionUser } from './context';
import { env } from './env';
import { gameRunRoutes } from './routes/game-runs';
import { gameStateRoutes } from './routes/game-state';
import { integrationRoutes, productivityRoutes } from './routes/integrations';
import { careerActionRoutes } from './routes/career-actions';
import { jobRoutes } from './routes/jobs';
import { settingsRoutes } from './routes/settings';
import { studyRoutes } from './routes/study';
import { syncRoutes } from './routes/sync';
import { workspaceRoutes } from './routes/workspaces';
import { createMemoryStore, defaultStore, ensurePersonalWorkspace, type MemoryStore } from './store';

export interface CreateAppOptions {
  authBypass?: boolean;
  syncMode?: string;
  useLogger?: boolean;
  store?: MemoryStore;
}

function devUser(): SessionUser {
  return {
    id: 'dev-user',
    email: 'dev@mini-hub.local',
    name: 'Development User'
  };
}

function personalUser(): SessionUser {
  return {
    id: personalUserId,
    email: 'personal@mini-hub.local',
    name: 'Personal Mini Hub'
  };
}

export function createApp(options: CreateAppOptions = {}) {
  const app = new Hono<AppBindings>();
  const store = options.store ?? defaultStore;
  const authBypass = options.authBypass ?? env.devAuthBypass;
  const syncMode = options.syncMode ?? env.syncMode;
  ensurePersonalWorkspace(store);

  if (options.useLogger ?? process.env.NODE_ENV !== 'test') {
    app.use('*', logger());
  }

  app.use(
    '*',
    cors({
      origin(origin) {
        if (!origin) return env.trustedOrigins[0] ?? '*';
        return env.trustedOrigins.includes(origin) ? origin : env.trustedOrigins[0];
      },
      allowHeaders: ['Content-Type', 'Authorization'],
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      credentials: true
    })
  );

  app.use('*', async (c, next) => {
    const oauthCallbackPath = c.req.path === '/api/integrations/google/oauth/callback';
    if (syncMode === 'personal' && c.req.path.startsWith('/api/') && c.req.path !== '/api/health' && !c.req.path.startsWith('/api/auth/') && !oauthCallbackPath) {
      c.set('user', personalUser());
      c.set('session', { id: 'personal-session', userId: personalUserId });
      await next();
      return;
    }

    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (session) {
      c.set('user', {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name
      });
      c.set('session', {
        id: session.session.id,
        userId: session.session.userId
      });
    } else if (authBypass) {
      c.set('user', devUser());
      c.set('session', { id: 'dev-session', userId: 'dev-user' });
    } else {
      c.set('user', null);
      c.set('session', null);
    }
    await next();
  });

  app.on(['POST', 'GET'], '/api/auth/*', (c) => auth.handler(c.req.raw));
  app.get('/api/health', (c) => c.json({ ok: true, service: 'mini-hub-api' }));
  app.route('/api/workspaces', workspaceRoutes(store));
  app.route('/api/sync', syncRoutes(store));
  app.route('/api/settings', settingsRoutes(store));
  app.route('/api/integrations', integrationRoutes(store));
  app.route('/api/productivity', productivityRoutes(store));
  app.route('/api/jobs', jobRoutes(store));
  app.route('/api/career-actions', careerActionRoutes(store));
  app.route('/api/study', studyRoutes(store));
  app.route('/api/game-runs', gameRunRoutes(store));
  app.route('/api/game-state', gameStateRoutes(store));

  return app;
}

export type AppType = ReturnType<typeof createApp>;

if (process.env.NODE_ENV !== 'test') {
  const app = createApp();
  serve({ fetch: app.fetch, port: env.port });
  console.log(`Mini Hub API listening on http://localhost:${env.port}`);
}

export { createMemoryStore };
