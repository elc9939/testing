import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { networkInterfaces } from 'node:os';
import { auth } from './auth';
import { personalUserId } from '@mini-hub/core';
import type { AppBindings, SessionUser } from './context';
import { env } from './env';
import { gameRunRoutes } from './routes/game-runs';
import { gameStateRoutes } from './routes/game-state';
import { integrationRoutes, productivityRoutes } from './routes/integrations';
import { actionLedgerRoutes } from './routes/action-ledger';
import { attentionRoutes } from './routes/attention';
import { passiveTaskRoutes } from './routes/passive-tasks';
import { careerActionRoutes } from './routes/career-actions';
import { careerScoutRoutes } from './routes/career-scout';
import { assistantRoutes } from './routes/assistant';
import { jobRoutes } from './routes/jobs';
import { remoteAccessRoutes, type RemoteAccessStatusProvider } from './routes/remote-access';
import { settingsRoutes } from './routes/settings';
import { studyRoutes } from './routes/study';
import { syncRoutes } from './routes/sync';
import { workspaceRoutes } from './routes/workspaces';
import {
  actionLedgerPath,
  coreDataHealth,
  coreDataPath,
  createMemoryStore,
  defaultStore,
  enableActionLedgerPersistence,
  enableCoreDataPersistence,
  enableIntegrationPersistence,
  enablePassiveTaskPersistence,
  ensurePersonalWorkspace,
  integrationConnectionsPath,
  passiveTasksPath,
  type MemoryStore
} from './store';
import { ensurePassiveDefaults, startPassiveTaskWorker } from './passive-engine';

export interface CreateAppOptions {
  authBypass?: boolean;
  externalFetch?: typeof fetch;
  syncMode?: string;
  useLogger?: boolean;
  store?: MemoryStore;
  remoteAccessStatusProvider?: RemoteAccessStatusProvider;
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

function bridgeTokenAccepted(headers: Headers): boolean {
  if (!env.bridgeToken) return true;
  return headers.get('x-mini-hub-bridge-token') === env.bridgeToken;
}

function bridgeProtectedPath(path: string): boolean {
  if (!path.startsWith('/api/')) return false;
  if (path === '/api/health') return false;
  if (path.startsWith('/api/auth/')) return false;
  if (path === '/api/integrations/google/oauth/callback') return false;
  return true;
}

function localLanIpv4(): string[] {
  const addresses = new Set<string>();
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      if (entry.address.startsWith('169.254.')) continue;
      addresses.add(entry.address);
    }
  }
  return [...addresses].sort();
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

  app.use('*', async (c, next) => {
    await next();
    const origin = c.req.header('origin');
    if (origin && env.trustedOrigins.includes(origin)) {
      c.header('Access-Control-Allow-Private-Network', 'true');
    }
  });

  app.use(
    '*',
    cors({
      origin(origin) {
        if (!origin) return env.trustedOrigins[0] ?? '*';
        return env.trustedOrigins.includes(origin) ? origin : env.trustedOrigins[0];
      },
      allowHeaders: ['Content-Type', 'Authorization', 'X-Mini-Hub-Return-To', 'X-Mini-Hub-Bridge-Token'],
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      credentials: true
    })
  );

  app.use('*', async (c, next) => {
    if (c.req.method !== 'OPTIONS' && env.bridgeToken && bridgeProtectedPath(c.req.path) && !bridgeTokenAccepted(c.req.raw.headers)) {
      return c.json(
        {
          ok: false,
          detail: 'Mini Hub bridge token is required. Save the matching bridge token in Settings -> Desktop Services.'
        },
        401
      );
    }
    await next();
  });

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
  app.get('/api/health', (c) =>
    c.json({
      ok: true,
      service: 'mini-hub-api',
      checkedAt: new Date().toISOString(),
      network: {
        lanIpv4: localLanIpv4(),
        hubPublicUrl: env.hubPublicUrl
      },
      bridgeAuth: {
        required: Boolean(env.bridgeToken),
        accepted: bridgeTokenAccepted(c.req.raw.headers)
      },
      storage: {
        coreData: coreDataHealth(store)
      }
    })
  );
  app.route('/api/workspaces', workspaceRoutes(store));
  app.route('/api/sync', syncRoutes(store));
  app.route('/api/settings', settingsRoutes(store));
  app.route('/api/remote-access', remoteAccessRoutes(options.remoteAccessStatusProvider));
  app.route('/api/action-ledger', actionLedgerRoutes(store, options.externalFetch ? { externalFetch: options.externalFetch } : {}));
  app.route('/api/attention', attentionRoutes(store, options.externalFetch ? { externalFetch: options.externalFetch } : {}));
  app.route('/api/passive-tasks', passiveTaskRoutes(store, options.externalFetch ? { externalFetch: options.externalFetch } : {}));
  app.route('/api/career-scout', careerScoutRoutes(store, options.externalFetch ? { externalFetch: options.externalFetch } : {}));
  app.route('/api/integrations', integrationRoutes(store));
  app.route('/api/productivity', productivityRoutes(store));
  app.route('/api/assistant', assistantRoutes());
  app.route('/api/jobs', jobRoutes(store));
  app.route('/api/career-actions', careerActionRoutes(store));
  app.route('/api/study', studyRoutes(store));
  app.route('/api/game-runs', gameRunRoutes(store));
  app.route('/api/game-state', gameStateRoutes(store));

  return app;
}

export type AppType = ReturnType<typeof createApp>;

if (process.env.NODE_ENV !== 'test') {
  enableCoreDataPersistence(defaultStore, coreDataPath(env.dataDir));
  enableIntegrationPersistence(defaultStore, integrationConnectionsPath(env.dataDir));
  enableActionLedgerPersistence(defaultStore, actionLedgerPath(env.dataDir));
  enablePassiveTaskPersistence(defaultStore, passiveTasksPath(env.dataDir));
  ensurePassiveDefaults(defaultStore);
  const app = createApp();
  serve({ fetch: app.fetch, port: env.port });
  startPassiveTaskWorker(defaultStore);
  console.log(`Mini Hub API listening on http://localhost:${env.port}`);
}

export { createMemoryStore };
