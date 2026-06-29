#!/usr/bin/env node
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const routes = [
  { id: 'today', path: '/', title: 'Today - Mini Hub', heading: 'Attention Queue', safeActionLabels: ['Refresh'] },
  { id: 'activity', path: '/activity', title: 'Activity - Mini Hub', heading: 'Activity', safeActionLabels: ['Refresh'] },
  { id: 'productivity', path: '/productivity', title: 'Productivity Hub - Mini Hub', heading: 'Productivity Hub', safeActionLabels: ['Refresh'] },
  {
    id: 'google-oauth-callback',
    path: '/oauth/google/callback',
    title: 'Google OAuth - Mini Hub',
    heading: 'Google OAuth',
    safeActionLabels: ['Open Productivity']
  },
  { id: 'career', path: '/desk/career', title: 'Career Desk - Mini Hub', heading: 'Career', safeActionLabels: ['Export', 'Add Job'] },
  { id: 'study', path: '/desk/study', title: 'Study Desk - Mini Hub', heading: 'Study', safeActionLabels: ['Log'] },
  { id: 'analytics', path: '/analytics', title: 'Analytics - Mini Hub', heading: 'Local Insights', safeActionLabels: ['Refresh'] },
  {
    id: 'research',
    path: '/research',
    title: 'Research Desk - Mini Hub',
    heading: 'Research Desk',
    safeActionLabels: ['Connect AI OS', 'Run Quick Search', 'Retry Service'],
    safeActionFallbacks: {
      'Connect AI OS': ['Checking AI OS', 'Setup', 'Loading research monitors'],
      'Run Quick Search': ['Connect AI OS', 'Checking AI OS', 'Setup', 'Loading research monitors'],
      'Retry Service': ['Checking AI OS', 'Setup', 'Loading research monitors']
    }
  },
  { id: 'ai-lab', path: '/ai-lab', title: 'AI Lab - Mini Hub', heading: 'Browser Experiments', safeActionLabels: ['Restore Samples', 'Classify', 'Parse'] },
  {
    id: 'ai-os',
    path: '/ai-os',
    title: 'AI OS - Mini Hub',
    heading: 'Ask AI OS',
    safeActionLabels: ['Refresh', 'Do it'],
    safeActionFallbacks: {
      'Do it': ['Connect AI OS', 'Checking AI OS']
    }
  },
  {
    id: 'macro-lab',
    path: '/macro-lab',
    title: 'Macro Lab - Mini Hub',
    heading: 'Macro Lab',
    safeActionLabels: ['Refresh', 'Panic', 'Dry Run', 'Run Confirmed'],
    safeActionFallbacks: {
      'Dry Run': ['No macro selected', 'Macro definitions are unavailable', 'Start Macro Lab', 'Loading macro definitions'],
      'Run Confirmed': ['No macro selected', 'Macro definitions are unavailable', 'Start Macro Lab', 'Loading macro definitions']
    }
  },
  { id: 'passive-tasks', path: '/passive-tasks', title: 'Passive Tasks - Mini Hub', heading: 'Passive Tasks', safeActionLabels: ['Refresh', 'Run Due', 'Startup', 'Idle'] },
  {
    id: 'settings',
    path: '/settings',
    title: 'Settings - Mini Hub',
    heading: 'Workspace',
    safeActionLabels: ['Check Services', 'Sync Now'],
    safeActionFallbacks: {
      'Check Services': ['Checking'],
      'Sync Now': ['API Not Ready', 'Loading Cache', 'Offline Read-only']
    }
  },
  { id: 'games', path: '/games', title: 'Games - Mini Hub', heading: 'Play Surfaces', safeActionLabels: ['Open'] },
  { id: 'stick-arena-lab', path: '/games/stick-arena-lab', title: 'Stick Arena Ability Lab - Mini Hub', heading: 'Ability Lab', safeActionLabels: ['Reset', 'Save Run', 'Open Settings'] }
];

const persistenceSeeds = [
  {
    id: 'activity-cache',
    route: '/activity?aiOsUrl=http%3A%2F%2F127.0.0.1%3A9&macroLabUrl=http%3A%2F%2F127.0.0.1%3A9&apiUrl=http%3A%2F%2F127.0.0.1%3A9',
    storageKey: 'miniHub.activity.snapshot.v1',
    expectedValue: 'Hydrated cached Activity run',
    value: {
      version: 1,
      cachedAt: '2026-06-23T10:00:00.000Z',
      snapshot: {
        checkedAt: '2026-06-23T09:59:00.000Z',
        stale: false,
        partial: false,
        active: true,
        records: [
          {
            id: 'research:hydrated-cache',
            source: 'research',
            sourceLabel: 'Research Desk',
            title: 'Hydrated cached Activity run',
            detail: 'Recovered from browser Activity cache.',
            status: 'running',
            startedAt: '2026-06-23T09:50:00.000Z',
            updatedAt: '2026-06-23T09:55:00.000Z',
            progress: 0.42,
            route: '/research?run=hydrated-cache',
            actions: [
              { kind: 'open', label: 'Open', enabled: true, route: '/research?run=hydrated-cache' },
              { kind: 'view_logs', label: 'View Logs', enabled: true, route: '/research?run=hydrated-cache' }
            ],
            metadata: { runId: 'hydrated-cache', mode: 'quick_search', goal: 'Hydrated cached Activity run' }
          }
        ],
        sources: [],
        errors: []
      }
    }
  },
  {
    id: 'research-draft',
    route: '/research',
    storageKey: 'miniHub.research.draft.v1',
    expectedValue: 'Hydrated smoke research draft',
    value: {
      mode: 'quick_search',
      goal: 'Hydrated smoke research draft',
      seedUrlsText: 'https://example.com/research-seed',
      includeDomainsText: '',
      excludeDomainsText: '',
      depth: 1,
      maxPages: 3,
      perDomainLimit: 2,
      timeBudget: 30,
      dateRangeStart: '',
      dateRangeEnd: '',
      useAi: false,
      useCloudAi: false,
      saveToMemory: false,
      screenshot: false,
      provider: '',
      model: '',
      advancedOpen: true,
      monitorName: 'Hydrated smoke monitor',
      monitorSchedule: 'manual',
      selectedRunId: '',
      selectedMonitorId: ''
    }
  },
  {
    id: 'ai-lab-draft',
    route: '/ai-lab',
    storageKey: 'miniHub.aiLab.draft.v1',
    expectedValue: 'Hydrated smoke AI Lab draft',
    value: {
      text: 'Hydrated smoke AI Lab draft',
      labels: 'qa, smoke',
      codeText: 'function hydratedSmoke() { return true; }',
      grammarUrl: ''
    }
  }
];

const productivityCacheSeed = {
  version: 1,
  cachedAt: '2026-06-23T11:00:00.000Z',
  catalog: [
    {
      id: 'google',
      label: 'Google Workspace',
      status: 'implemented',
      auth: 'oauth2',
      notes: 'Hydrated smoke cached Google fixture.',
      capabilities: [
        { id: 'gmail.read', label: 'Read Gmail', access: 'read', status: 'available' },
        { id: 'gmail.write', label: 'Modify Gmail', access: 'write', status: 'requires-api' },
        { id: 'calendar.read', label: 'Read Calendar', access: 'read', status: 'available' },
        { id: 'calendar.write', label: 'Modify Calendar', access: 'write', status: 'requires-api' }
      ]
    }
  ],
  connections: [
    {
      id: 'google-hydrated',
      provider: 'google',
      accountLabel: 'hydrated@example.com',
      scopes: ['gmail.modify', 'gmail.send', 'calendar.events'],
      status: 'connected',
      lastSyncAt: '2026-06-23T10:55:00.000Z',
      updatedAt: '2026-06-23T10:55:00.000Z'
    }
  ],
  calendars: [
    {
      id: 'google-hydrated::primary',
      summary: 'Hydrated Smoke Calendar',
      primary: true,
      timeZone: 'America/Los_Angeles'
    },
    {
      id: 'google-hydrated::school',
      summary: 'Hydrated Smoke School',
      timeZone: 'America/Los_Angeles'
    }
  ],
  events: [
    {
      id: 'hydrated-event-1',
      calendarId: 'google-hydrated::primary',
      provider: 'google',
      title: 'Hydrated Cache Interview',
      description: 'Cached calendar event for the Productivity write guard smoke.',
      location: 'Video call',
      start: '2026-06-29T17:00:00.000Z',
      end: '2026-06-29T17:30:00.000Z',
      timeZone: 'America/Los_Angeles',
      status: 'confirmed',
      htmlLink: 'https://calendar.google.com/calendar/event?eid=hydrated-event-1',
      recurrence: [],
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 10 }] },
      raw: {}
    }
  ],
  timeline: [
    {
      id: 'timeline:hydrated-event-1',
      source: 'google_calendar',
      sourceId: 'hydrated-event-1',
      kind: 'event',
      title: 'Hydrated Cache Interview',
      when: '2026-06-29T17:00:00.000Z',
      end: '2026-06-29T17:30:00.000Z',
      timeZone: 'America/Los_Angeles',
      actionUrl: 'https://calendar.google.com/calendar/event?eid=hydrated-event-1',
      canEdit: true,
      canComplete: false,
      metadata: {}
    }
  ],
  priorityThreads: [
    {
      thread: {
        id: 'google-hydrated::thread-1',
        historyId: '101',
        snippet: 'Please confirm the deadline package before Monday.',
        labelIds: ['INBOX', 'UNREAD'],
        subject: 'Hydrated cached deadline mail',
        from: 'Advisor <advisor@example.com>',
        date: 'Jun 23',
        unread: true,
        messages: [
          {
            id: 'msg-hydrated-1',
            threadId: 'google-hydrated::thread-1',
            labelIds: ['INBOX', 'UNREAD'],
            snippet: 'Please confirm the deadline package before Monday.',
            subject: 'Hydrated cached deadline mail',
            from: 'Advisor <advisor@example.com>',
            to: 'Edward <edward@example.com>',
            cc: '',
            date: 'Tue, 23 Jun 2026 10:00:00 -0700',
            internalDate: '1782243600000',
            messageIdHeader: '<hydrated-smoke@example.com>',
            references: '',
            inReplyTo: '',
            bodyText: 'Please confirm the deadline package before Monday so the cached preview has useful content.',
            bodyHtml: '',
            headers: {}
          }
        ]
      },
      priority: 86,
      category: 'deadline',
      reason: 'Mentions a deadline and asks for confirmation.',
      deadlineHint: 'Jun 29',
      source: 'heuristic'
    }
  ],
  gmailLabels: [
    { id: 'IMPORTANT', name: 'Important', type: 'system' },
    { id: 'Label_Study', name: 'Study', type: 'user' }
  ],
  selectedCalendarId: 'google-hydrated::primary',
  query: '',
  gmailQuery: 'in:inbox newer_than:14d deadline',
  selectedGmailLabelId: 'Label_Study'
};

persistenceSeeds.push({
  id: 'productivity-cache',
  route: '/productivity?apiUrl=http%3A%2F%2F127.0.0.1%3A9',
  skipApiUrlOverride: true,
  storageKey: 'miniHub.productivity.cache.v1',
  expectedValue: 'Hydrated cached deadline mail',
  value: productivityCacheSeed
});

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function truncate(value, max = 90) {
  const text = String(value ?? '').replace(/\s+/gu, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

async function removeProfileDir(profileDir) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await rm(profileDir, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 5) {
        console.warn(`Could not remove temporary browser profile ${profileDir}: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
      await delay(250);
    }
  }
}

function routeUrl(baseUrl, routePath, options = {}) {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const url = new URL(routePath.replace(/^\//u, ''), normalizedBase);
  if (process.env.HUB_HYDRATED_API_URL && !options.skipApiUrlOverride) {
    url.searchParams.set('apiUrl', process.env.HUB_HYDRATED_API_URL);
  }
  return url.toString();
}

function browserCandidates() {
  const explicit = [
    process.env.HUB_HYDRATED_BROWSER,
    process.env.HUB_SMOKE_BROWSER,
    process.env.BROWSER_PATH,
    process.env.CHROME_PATH,
    process.env.EDGE_PATH
  ].filter(Boolean);

  if (process.platform === 'win32') {
    const programFiles = process.env.ProgramFiles;
    const programFilesX86 = process.env['ProgramFiles(x86)'];
    const localAppData = process.env.LOCALAPPDATA;
    return [
      ...explicit,
      programFiles && path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      programFilesX86 && path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      localAppData && path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      programFiles && path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      programFilesX86 && path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
    ].filter(Boolean);
  }

  if (process.platform === 'darwin') {
    return [
      ...explicit,
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
    ];
  }

  return [...explicit, 'google-chrome-stable', 'google-chrome', 'chromium-browser', 'chromium', 'microsoft-edge'];
}

async function executableExists(candidate) {
  if (!candidate) return false;
  if (!candidate.includes(path.sep) && process.platform !== 'win32') return true;
  try {
    const { access } = await import('node:fs/promises');
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

async function findBrowser() {
  for (const candidate of browserCandidates()) {
    if (await executableExists(candidate)) return candidate;
  }
  throw new Error('No Chrome or Edge executable found. Set HUB_HYDRATED_BROWSER to a Chromium executable path.');
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === 'object') resolve(address.port);
        else reject(new Error('Could not allocate a local debugging port.'));
      });
    });
  });
}

function pnpmExecutable() {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
}

function pnpmSpawn(commandArgs) {
  if (process.platform === 'win32') {
    return {
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', pnpmExecutable(), ...commandArgs]
    };
  }
  return { command: pnpmExecutable(), args: commandArgs };
}

async function waitForReachableUrl(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';
  while (Date.now() < deadline) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    try {
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (response.ok) return true;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      clearTimeout(timer);
      lastError = error instanceof Error ? error.message : String(error);
    }
    await delay(300);
  }
  throw new Error(`Timed out waiting for ${url} to become reachable. Last error: ${lastError || 'no response'}`);
}

async function startManagedHubServer() {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}/`;
  const launcher = pnpmSpawn(['--filter', '@mini-hub/hub', 'dev', '--host', '127.0.0.1', '--port', String(port)]);
  const child = spawn(launcher.command, launcher.args, {
    cwd: repoRoot,
    stdio: ['ignore', 'ignore', 'pipe'],
    shell: false,
    windowsHide: true
  });

  let stderr = '';
  child.stderr?.on('data', (chunk) => {
    const text = chunk.toString();
    stderr += text;
    if (process.env.HUB_HYDRATED_DEBUG === '1') process.stderr.write(text);
  });

  try {
    await waitForReachableUrl(url);
  } catch (error) {
    await stopProcessTree(child);
    throw new Error(
      `Could not start managed Mini Hub dev server for hydrated smoke. ${error instanceof Error ? error.message : String(error)}${
        stderr.trim() ? `\nVite stderr:\n${stderr.trim().slice(-2000)}` : ''
      }`
    );
  }

  return { url, child };
}

async function stopProcessTree(child) {
  if (!child || child.killed) return;
  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
        stdio: ['ignore', 'ignore', 'ignore'],
        windowsHide: true
      });
      const timer = setTimeout(resolve, 2500);
      killer.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      killer.once('error', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    return;
  }
  child.kill();
  await new Promise((resolve) => {
    if (child.exitCode !== null) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, 2000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function stopManagedProcess(child) {
  await stopProcessTree(child);
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type',
    'content-type': 'application/json'
  });
  response.end(JSON.stringify(payload));
}

function sendCredentialedJson(request, response, status, payload) {
  const origin = request.headers.origin || 'http://127.0.0.1';
  response.writeHead(status, {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type,accept,x-mini-hub-sync-key',
    'vary': 'Origin',
    'content-type': 'application/json'
  });
  response.end(JSON.stringify(payload));
}

function readJsonBody(request) {
  return new Promise((resolve) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({});
      }
    });
    request.on('error', () => resolve({}));
  });
}

function createMockResearchSource() {
  return {
    id: 'src-hydrated-mock',
    url: 'https://example.com/hydrated-research',
    canonical_url: 'https://example.com/hydrated-research',
    title: 'Hydrated Research Source',
    description: 'Mock source used by the hydrated Research Desk smoke.',
    text: 'Hydrated mock research source text with enough detail to render a preview and report citation.',
    text_length: 88,
    links: [{ href: 'https://example.com/follow-up', text: 'Follow up' }],
    tables: [],
    metadata: {},
    score: 0.91,
    rank: 1,
    cached: false,
    fetched_at: '2026-06-23T12:00:00.000Z'
  };
}

function createMockResearchReport(goal) {
  return {
    title: 'Hydrated Mock Research Report',
    tldr: `Mock TLDR for ${goal}.`,
    detailed_summary: 'This mock report proves online Research Desk runs stay visible after navigation, reload, and control actions.',
    key_facts: ['The mock AI OS accepted the run.', 'The Research Desk rendered a source-backed report.'],
    disagreements: [],
    source_table: [{ id: 'src-hydrated-mock', title: 'Hydrated Research Source', score: 0.91, cached: false }],
    open_questions: ['What real source should replace this mock during manual QA?'],
    next_research_suggestions: ['Run the same flow against the real AI OS service.'],
    reliability_notes: ['Mock source only; this is a UI recovery smoke check.'],
    timeline: [{ title: 'Mock run queued', date: '2026-06-23', source_id: 'src-hydrated-mock' }]
  };
}

function createMockResearchRun(input, index = 1) {
  const now = '2026-06-23T12:00:00.000Z';
  const source = createMockResearchSource();
  const goal = typeof input.goal === 'string' && input.goal.trim() ? input.goal.trim() : 'Hydrated mock research goal';
  return {
    id: `hydrated-run-${index}`,
    created_at: now,
    updated_at: now,
    mode: input.mode || 'quick_search',
    goal,
    status: 'running',
    query_plan: {
      search_queries: [goal],
      crawl_targets: input.seed_urls || []
    },
    sources: [source],
    report: createMockResearchReport(goal),
    citations: [{ id: 'citation-hydrated', claim: 'Hydrated mock source was rendered.', source_ids: [source.id], quote: 'mock source text' }],
    logs: [{ at: now, level: 'info', message: 'Hydrated mock run accepted.' }],
    progress: 0.42,
    total_steps: 4,
    completed_steps: 2,
    current_step: 'Mock AI OS is ranking sources',
    cancel_requested: false,
    memory_chunks: 0,
    provider: 'mock-ai-os',
    model: 'hydrated-smoke',
    total_tokens: 12,
    cost_usd: 0,
    runtime_ms: 321,
    cached_pages: 0,
    options: input
  };
}

function mockSyncEvent(entityType, entity, operation = 'insert', index = 1) {
  const now = new Date(Date.UTC(2026, 5, 23, 12, 10, index)).toISOString();
  return {
    id: `mock-sync:${entityType}:${entity.id}:${index}`,
    workspaceId: entity.workspaceId || 'personal',
    entityType,
    entityId: entity.id,
    operation,
    payload: operation === 'delete' ? { id: entity.id } : entity,
    deviceId: entity.deviceId || 'hydrated-smoke',
    createdAt: now
  };
}

function createMockJob(input, index = 1) {
  const now = new Date(Date.UTC(2026, 5, 23, 12, 20, index)).toISOString();
  return {
    id: typeof input.id === 'string' && input.id ? input.id : `hydrated-job-${index}`,
    workspaceId: typeof input.workspaceId === 'string' && input.workspaceId ? input.workspaceId : 'personal',
    company: String(input.company || 'Hydrated API Smoke Labs'),
    role: String(input.role || 'Saved QA Analyst'),
    status: String(input.status || 'lead'),
    applicationUrl: String(input.applicationUrl || ''),
    ...(typeof input.fitScore === 'number' ? { fitScore: input.fitScore } : {}),
    ...(input.nextActionAt ? { nextActionAt: String(input.nextActionAt) } : {}),
    notes: String(input.notes || ''),
    deviceId: String(input.deviceId || 'hydrated-smoke'),
    updatedAt: String(input.updatedAt || now)
  };
}

function createMockStudySession(input, index = 1) {
  const now = new Date(Date.UTC(2026, 5, 23, 12, 30, index)).toISOString();
  return {
    id: typeof input.id === 'string' && input.id ? input.id : `hydrated-study-${index}`,
    workspaceId: typeof input.workspaceId === 'string' && input.workspaceId ? input.workspaceId : 'personal',
    subject: String(input.subject || 'Hydrated API Study'),
    minutes: Number.isFinite(Number(input.minutes)) ? Number(input.minutes) : 26,
    source: String(input.source || 'manual'),
    loggedAt: String(input.loggedAt || now),
    deviceId: String(input.deviceId || 'hydrated-smoke'),
    updatedAt: String(input.updatedAt || now)
  };
}

function createMockResearchMonitor(input, index = 1) {
  const now = '2026-06-23T12:04:00.000Z';
  const request = input.request && typeof input.request === 'object' ? input.request : { mode: 'monitor_topic', goal: 'Hydrated monitor goal' };
  const goal = typeof request.goal === 'string' && request.goal.trim() ? request.goal.trim() : 'Hydrated monitor goal';
  return {
    id: `hydrated-monitor-${index}`,
    created_at: now,
    updated_at: now,
    name: typeof input.name === 'string' && input.name.trim() ? input.name.trim() : `Monitor: ${goal.slice(0, 40)}`,
    enabled: input.enabled !== false,
    schedule: ['manual', 'daily', 'weekly'].includes(input.schedule) ? input.schedule : 'manual',
    request: {
      mode: 'monitor_topic',
      ...request,
      goal
    },
    run_count: 0,
    metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {}
  };
}

async function startMockHubApiServer() {
  const port = await freePort();
  const jobs = [];
  const sessions = [];
  const syncEvents = [];
  const server = http.createServer(async (request, response) => {
    if (request.method === 'OPTIONS') {
      sendCredentialedJson(request, response, 204, {});
      return;
    }
    const url = new URL(request.url || '/', `http://127.0.0.1:${port}`);
    const pathName = url.pathname;

    if (pathName === '/api/health' && request.method === 'GET') {
      sendCredentialedJson(request, response, 200, {
        ok: true,
        service: 'mini-hub-api-hydrated-smoke',
        checkedAt: '2026-06-23T12:00:00.000Z',
        storage: {
          coreData: {
            enabled: true,
            status: 'memory_only',
            exists: true,
            detail: 'Hydrated smoke mock API. Data is discarded when the smoke check exits.',
            recordCounts: {
              workspaces: 1,
              members: 1,
              jobs: jobs.length,
              studySessions: sessions.length,
              careerActions: 0,
              gameRuns: 0,
              gameStates: 0,
              settings: 0,
              achievements: 0,
              notes: 0,
              syncEvents: syncEvents.length
            }
          }
        }
      });
      return;
    }

    if (pathName === '/api/sync/pull' && request.method === 'GET') {
      const since = url.searchParams.get('since') || '';
      const changes = syncEvents.filter((event) => !since || event.createdAt > since);
      sendCredentialedJson(request, response, 200, {
        changes,
        cursor: changes.at(-1)?.createdAt || since
      });
      return;
    }

    if (pathName === '/api/jobs' && request.method === 'GET') {
      sendCredentialedJson(request, response, 200, { jobs });
      return;
    }
    if (pathName === '/api/jobs' && request.method === 'POST') {
      const input = await readJsonBody(request);
      const job = createMockJob(input, jobs.length + 1);
      const existingIndex = jobs.findIndex((candidate) => candidate.id === job.id);
      if (existingIndex >= 0) jobs[existingIndex] = job;
      else jobs.unshift(job);
      syncEvents.push(mockSyncEvent('job', job, existingIndex >= 0 ? 'update' : 'insert', syncEvents.length + 1));
      sendCredentialedJson(request, response, existingIndex >= 0 ? 200 : 201, { job });
      return;
    }

    const jobMatch = /^\/api\/jobs\/([^/]+)$/u.exec(pathName);
    if (jobMatch) {
      const id = decodeURIComponent(jobMatch[1]);
      const index = jobs.findIndex((job) => job.id === id);
      if (index < 0) {
        sendCredentialedJson(request, response, 404, { error: 'Job not found' });
        return;
      }
      if (request.method === 'PATCH') {
        const input = await readJsonBody(request);
        const job = createMockJob({ ...jobs[index], ...input, id }, index + 1);
        jobs[index] = job;
        syncEvents.push(mockSyncEvent('job', job, 'update', syncEvents.length + 1));
        sendCredentialedJson(request, response, 200, { job });
        return;
      }
      if (request.method === 'DELETE') {
        const [job] = jobs.splice(index, 1);
        syncEvents.push(mockSyncEvent('job', job, 'delete', syncEvents.length + 1));
        sendCredentialedJson(request, response, 200, { ok: true });
        return;
      }
    }

    if (pathName === '/api/study' && request.method === 'GET') {
      sendCredentialedJson(request, response, 200, { sessions });
      return;
    }
    if (pathName === '/api/study' && request.method === 'POST') {
      const input = await readJsonBody(request);
      const session = createMockStudySession(input, sessions.length + 1);
      const existingIndex = sessions.findIndex((candidate) => candidate.id === session.id);
      if (existingIndex >= 0) sessions[existingIndex] = session;
      else sessions.unshift(session);
      syncEvents.push(mockSyncEvent('study_session', session, existingIndex >= 0 ? 'update' : 'insert', syncEvents.length + 1));
      sendCredentialedJson(request, response, existingIndex >= 0 ? 200 : 201, { session });
      return;
    }

    const studyMatch = /^\/api\/study\/([^/]+)$/u.exec(pathName);
    if (studyMatch) {
      const id = decodeURIComponent(studyMatch[1]);
      const index = sessions.findIndex((session) => session.id === id);
      if (index < 0) {
        sendCredentialedJson(request, response, 404, { error: 'Study session not found' });
        return;
      }
      if (request.method === 'PATCH') {
        const input = await readJsonBody(request);
        const session = createMockStudySession({ ...sessions[index], ...input, id }, index + 1);
        sessions[index] = session;
        syncEvents.push(mockSyncEvent('study_session', session, 'update', syncEvents.length + 1));
        sendCredentialedJson(request, response, 200, { session });
        return;
      }
      if (request.method === 'DELETE') {
        const [session] = sessions.splice(index, 1);
        syncEvents.push(mockSyncEvent('study_session', session, 'delete', syncEvents.length + 1));
        sendCredentialedJson(request, response, 200, { ok: true });
        return;
      }
    }

    sendCredentialedJson(request, response, 404, { error: `mock route not found: ${pathName}` });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

async function startMockResearchAiOsServer() {
  const port = await freePort();
  const runs = [];
  const monitors = [];
  const server = http.createServer(async (request, response) => {
    if (request.method === 'OPTIONS') {
      sendJson(response, 204, {});
      return;
    }
    const url = new URL(request.url || '/', `http://127.0.0.1:${port}`);
    const pathName = url.pathname;
    if (pathName === '/api/ai/research/runs' && request.method === 'GET') {
      sendJson(response, 200, { runs });
      return;
    }
    if (pathName === '/api/ai/research/runs' && request.method === 'POST') {
      const input = await readJsonBody(request);
      const run = createMockResearchRun(input, runs.length + 1);
      runs.unshift(run);
      sendJson(response, 200, { run });
      return;
    }
    const runMatch = /^\/api\/ai\/research\/runs\/([^/]+)(?:\/(pause|resume|cancel))?$/u.exec(pathName);
    if (runMatch) {
      const runId = decodeURIComponent(runMatch[1]);
      const action = runMatch[2] || '';
      const index = runs.findIndex((run) => run.id === runId);
      if (index === -1) {
        sendJson(response, 404, { error: 'missing mock research run' });
        return;
      }
      const run = runs[index];
      if (request.method === 'POST' && action === 'pause') {
        Object.assign(run, { status: 'paused', current_step: 'Paused by hydrated smoke', updated_at: '2026-06-23T12:01:00.000Z' });
        run.logs = [...run.logs, { at: '2026-06-23T12:01:00.000Z', level: 'info', message: 'Paused by hydrated smoke' }];
      } else if (request.method === 'POST' && action === 'resume') {
        Object.assign(run, { status: 'running', current_step: 'Resumed by hydrated smoke', updated_at: '2026-06-23T12:02:00.000Z' });
        run.logs = [...run.logs, { at: '2026-06-23T12:02:00.000Z', level: 'info', message: 'Resumed by hydrated smoke' }];
      } else if (request.method === 'POST' && action === 'cancel') {
        Object.assign(run, {
          status: 'cancelled',
          cancel_requested: true,
          current_step: 'Cancelled by hydrated smoke',
          updated_at: '2026-06-23T12:03:00.000Z'
        });
        run.logs = [...run.logs, { at: '2026-06-23T12:03:00.000Z', level: 'info', message: 'Cancelled by hydrated smoke' }];
      }
      sendJson(response, 200, { run });
      return;
    }
    if (pathName === '/api/ai/research/sources' && request.method === 'GET') {
      const source = createMockResearchSource();
      const query = url.searchParams.get('q') || '';
      const domain = url.searchParams.get('domain') || '';
      sendJson(response, 200, {
        sources: [
          {
            ...source,
            text_preview: query ? `${source.text} Query matched ${query}.` : source.text,
            first_seen_at: '2026-06-23T12:00:00.000Z',
            last_seen_at: '2026-06-23T12:00:00.000Z',
            fetch_count: 1,
            matched_terms: ['hydrated', 'mock', query, domain].filter(Boolean)
          }
        ]
      });
      return;
    }
    if (pathName === '/api/ai/research/monitors' && request.method === 'GET') {
      sendJson(response, 200, { monitors });
      return;
    }
    if (pathName === '/api/ai/research/monitors' && request.method === 'POST') {
      const input = await readJsonBody(request);
      const monitor = createMockResearchMonitor(input, monitors.length + 1);
      monitors.unshift(monitor);
      sendJson(response, 200, { monitor });
      return;
    }
    if (pathName === '/api/ai/research/monitors/due' && request.method === 'GET') {
      sendJson(response, 200, { monitors: monitors.filter((monitor) => monitor.enabled && monitor.schedule !== 'manual') });
      return;
    }
    if (pathName === '/api/ai/research/monitors/run-due' && request.method === 'POST') {
      const due = monitors.filter((monitor) => monitor.enabled && monitor.schedule !== 'manual');
      const created = due.map((monitor) => {
        const run = createMockResearchRun(monitor.request, runs.length + 1);
        Object.assign(run, { current_step: `Due monitor run for ${monitor.name}` });
        runs.unshift(run);
        Object.assign(monitor, {
          run_count: monitor.run_count + 1,
          last_run_id: run.id,
          last_run_at: '2026-06-23T12:06:00.000Z',
          last_status: run.status,
          updated_at: '2026-06-23T12:06:00.000Z'
        });
        return run;
      });
      sendJson(response, 200, {
        monitors: due,
        runs: created,
        queued_count: created.length,
        skipped_count: monitors.length - due.length,
        errors: []
      });
      return;
    }
    const monitorMatch = /^\/api\/ai\/research\/monitors\/([^/]+)(?:\/run)?$/u.exec(pathName);
    if (monitorMatch) {
      const monitorId = decodeURIComponent(monitorMatch[1]);
      const index = monitors.findIndex((monitor) => monitor.id === monitorId);
      if (index === -1) {
        sendJson(response, 404, { error: 'missing mock research monitor' });
        return;
      }
      const monitor = monitors[index];
      const isRunRoute = pathName.endsWith('/run');
      if (request.method === 'POST' && isRunRoute) {
        const run = createMockResearchRun(monitor.request, runs.length + 1);
        Object.assign(run, { current_step: `Monitor run for ${monitor.name}` });
        runs.unshift(run);
        Object.assign(monitor, {
          run_count: monitor.run_count + 1,
          last_run_id: run.id,
          last_run_at: '2026-06-23T12:05:00.000Z',
          last_status: run.status,
          updated_at: '2026-06-23T12:05:00.000Z'
        });
        sendJson(response, 200, { monitor, run });
        return;
      }
      if (request.method === 'PATCH') {
        const input = await readJsonBody(request);
        Object.assign(monitor, {
          ...input,
          request: input.request && typeof input.request === 'object' ? input.request : monitor.request,
          updated_at: '2026-06-23T12:07:00.000Z'
        });
        sendJson(response, 200, { monitor });
        return;
      }
      if (request.method === 'DELETE') {
        const [deleted] = monitors.splice(index, 1);
        sendJson(response, 200, { monitor: deleted });
        return;
      }
    }
    const exportMatch = /^\/api\/ai\/research\/runs\/([^/]+)\/export$/u.exec(pathName);
    if (exportMatch && request.method === 'GET') {
      const runId = decodeURIComponent(exportMatch[1]);
      const run = runs.find((candidate) => candidate.id === runId);
      if (!run) {
        sendJson(response, 404, { error: 'missing mock research run export' });
        return;
      }
      sendJson(response, 200, { id: run.id, format: url.searchParams.get('format') || 'markdown', title: run.report.title });
      return;
    }
    sendJson(response, 404, { error: `mock route not found: ${pathName}` });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

async function waitForJson(url, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
      lastError = `${response.status} ${response.statusText}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'fetch failed';
    }
    await delay(200);
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError}`);
}

async function createPage(port) {
  const targetUrl = `http://127.0.0.1:${port}/json/new?${encodeURIComponent('about:blank')}`;
  for (const method of ['PUT', 'GET']) {
    try {
      const response = await fetch(targetUrl, { method });
      if (response.ok) {
        const page = await response.json();
        if (page.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
      }
    } catch {
      // Try the next method. Chrome versions differ on /json/new.
    }
  }

  const pages = await waitForJson(`http://127.0.0.1:${port}/json/list`);
  const page = pages.find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
  if (page) return page.webSocketDebuggerUrl;
  throw new Error('Could not create or find a Chrome DevTools page target.');
}

class CdpClient {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.eventWaiters = new Map();
    ws.addEventListener('message', (event) => this.handleMessage(event.data));
    ws.addEventListener('close', () => this.rejectAll(new Error('Chrome DevTools websocket closed.')));
    ws.addEventListener('error', () => this.rejectAll(new Error('Chrome DevTools websocket errored.')));
  }

  static connect(wsUrl) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      const timer = setTimeout(() => reject(new Error('Timed out connecting to Chrome DevTools websocket.')), 8000);
      ws.addEventListener('open', () => {
        clearTimeout(timer);
        resolve(new CdpClient(ws));
      });
      ws.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error('Failed to connect to Chrome DevTools websocket.'));
      });
    });
  }

  handleMessage(raw) {
    const message = JSON.parse(raw);
    if (message.id && this.pending.has(message.id)) {
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message || 'CDP command failed.'));
      else resolve(message.result ?? {});
      return;
    }
    if (message.method && this.eventWaiters.has(message.method)) {
      for (const waiter of this.eventWaiters.get(message.method)) waiter.resolve(message.params ?? {});
      this.eventWaiters.delete(message.method);
    }
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  waitForEvent(method, timeoutMs = 10_000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const waiters = (this.eventWaiters.get(method) ?? []).filter((waiter) => waiter.reject !== reject);
        if (waiters.length) this.eventWaiters.set(method, waiters);
        else this.eventWaiters.delete(method);
        reject(new Error(`Timed out waiting for ${method}.`));
      }, timeoutMs);
      const waiter = {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject
      };
      this.eventWaiters.set(method, [...(this.eventWaiters.get(method) ?? []), waiter]);
    });
  }

  rejectAll(error) {
    for (const { reject } of this.pending.values()) reject(error);
    this.pending.clear();
  }

  close() {
    this.ws.close();
  }
}

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  });
  if (result.exceptionDetails) {
    const detail = result.exceptionDetails.text || result.exceptionDetails.exception?.description || 'Runtime evaluation failed.';
    throw new Error(detail);
  }
  return result.result?.value;
}

async function waitForHydration(client, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await evaluate(
      client,
      `(() => ({
        ready: document.readyState !== 'loading' && Boolean(document.querySelector('h1') || document.body?.innerText?.includes('Not Found')),
        title: document.title,
        heading: document.querySelector('h1')?.textContent?.trim() || '',
        text: document.body?.innerText?.slice(0, 400) || ''
      }))()`
    );
    if (last.ready) return last;
    await delay(200);
  }
  throw new Error(`Timed out waiting for hydrated route. Last state: ${JSON.stringify(last)}`);
}

async function waitForCondition(client, expression, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await evaluate(client, expression);
    if (last?.ok) return last;
    await delay(250);
  }
  return last ?? { ok: false, detail: 'Timed out before condition produced a state.' };
}

async function navigate(client, url) {
  const loaded = client.waitForEvent('Page.loadEventFired', 12_000).catch(() => null);
  await client.send('Page.navigate', { url });
  await loaded;
  await waitForHydration(client);
  await delay(300);
}

async function readDomSnapshot(client) {
  return evaluate(
    client,
    `(() => {
      const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
      const controls = [...document.querySelectorAll('button,a')].map((el) => {
        const isButton = el.tagName.toLowerCase() === 'button';
        const title = el.getAttribute('title') || '';
        const ariaLabel = el.getAttribute('aria-label') || '';
        const href = el.getAttribute('href') || '';
        const visibleLabel = clean(el.innerText || el.textContent || '');
        const disabled = isButton
          ? Boolean(el.disabled || el.getAttribute('aria-disabled') === 'true')
          : Boolean(el.getAttribute('aria-disabled') === 'true' || el.classList.contains('disabled'));
        return {
          kind: isButton ? 'button' : 'link',
          label: visibleLabel || ariaLabel || title || href || '(unlabelled)',
          title,
          ariaLabel,
          href,
          disabled,
          hasVisibleLabel: Boolean(visibleLabel),
          hasTitle: Boolean(title),
          hasAriaLabel: Boolean(ariaLabel),
          ambiguous: !visibleLabel && !ariaLabel && !title && !href
        };
      });
      const issuePattern = /\\b(?:offline|unavailable|misconfigured|not configured|needs setup|failed|error|not found|connect|setup|stale|cached|partial|loading)\\b[^.?!]{0,140}[.?!]?/gi;
      const bodyText = clean(document.body?.innerText || '');
      return {
        url: location.href,
        title: document.title,
        heading: clean(document.querySelector('h1')?.textContent || ''),
        rawNotFound: /^Not Found$/i.test(bodyText) || /\\bNot Found\\b/i.test(bodyText.slice(0, 80)),
        buttons: controls.filter((control) => control.kind === 'button').length,
        links: controls.filter((control) => control.kind === 'link').length,
        enabled: controls.filter((control) => !control.disabled).length,
        disabled: controls.filter((control) => control.disabled).length,
        ambiguous: controls.filter((control) => control.ambiguous).length,
        unexplainedDisabled: controls.filter((control) => control.disabled && !control.hasTitle && !control.hasAriaLabel).length,
        controls,
        text: bodyText.slice(0, 6000),
        values: [...document.querySelectorAll('input, textarea, select')].map((el) => clean(el.value)).filter(Boolean).slice(0, 30),
        issues: [...new Set([...bodyText.matchAll(issuePattern)].map((match) => clean(match[0])).filter(Boolean))].slice(0, 5)
      };
    })()`
  );
}

async function blockClassifierModelFetches(client) {
  await client.send('Network.enable');
  await client.send('Network.setBlockedURLs', {
    urls: ['*://huggingface.co/*', '*://*.huggingface.co/*', '*://cdn-lfs.huggingface.co/*']
  });
}

async function unblockClassifierModelFetches(client) {
  await client.send('Network.setBlockedURLs', { urls: [] }).catch(() => null);
}

async function clickButtonByText(client, label) {
  const result = await evaluate(
    client,
    `(() => {
      const label = ${JSON.stringify(label)}.toLowerCase();
      const button = [...document.querySelectorAll('button')].find((candidate) =>
        (candidate.innerText || candidate.textContent || '').toLowerCase().includes(label)
      );
      if (!button) return { ok: false, detail: 'Button not found: ${label}' };
      if (button.disabled) return { ok: false, detail: 'Button disabled: ' + (button.title || button.innerText || label) };
      button.click();
      return { ok: true, detail: (button.innerText || button.textContent || label).trim() };
    })()`
  );
  if (!result?.ok) throw new Error(result?.detail || `Could not click ${label}.`);
  return result;
}

async function clickButtonByAriaLabel(client, ariaLabel) {
  const result = await evaluate(
    client,
    `(() => {
      const ariaLabel = ${JSON.stringify(ariaLabel)};
      const button = [...document.querySelectorAll('button')].find((candidate) => candidate.getAttribute('aria-label') === ariaLabel);
      if (!button) return { ok: false, detail: 'Button not found: ' + ariaLabel };
      if (button.disabled) return { ok: false, detail: 'Button disabled: ' + (button.title || ariaLabel) };
      button.click();
      return { ok: true, detail: ariaLabel };
    })()`
  );
  if (!result?.ok) throw new Error(result?.detail || `Could not click ${ariaLabel}.`);
  return result;
}

async function fillFirstTextarea(client, value) {
  const result = await evaluate(
    client,
    `(() => {
      const textarea = document.querySelector('#research-goal, textarea');
      if (!textarea) {
        return {
          ok: false,
          detail: 'No textarea found. title=' + document.title + '; heading=' + (document.querySelector('h1')?.textContent?.trim() || 'missing') + '; body=' + (document.body?.innerText || '').replace(/\\s+/g, ' ').slice(0, 220)
        };
      }
      const value = ${JSON.stringify(value)};
      textarea.focus();
      textarea.value = value;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, detail: value };
    })()`
  );
  if (!result?.ok) throw new Error(result?.detail || 'Could not fill textarea.');
  return result;
}

async function setNthControlValue(client, selector, index, value) {
  const result = await evaluate(
    client,
    `(() => {
      const controls = [...document.querySelectorAll(${JSON.stringify(selector)})];
      const control = controls[${Number(index)}];
      if (!control) return { ok: false, detail: 'Control not found: ${selector}[${Number(index)}]' };
      const value = ${JSON.stringify(value)};
      control.value = value;
      control.dispatchEvent(new Event('input', { bubbles: true }));
      control.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, detail: value };
    })()`
  );
  if (!result?.ok) throw new Error(result?.detail || `Could not set ${selector}[${index}].`);
  return result;
}

async function setControlValue(client, selector, value) {
  const result = await evaluate(
    client,
    `(() => {
      const control = document.querySelector(${JSON.stringify(selector)});
      if (!control) return { ok: false, detail: 'Control not found: ${selector}' };
      const value = ${JSON.stringify(value)};
      control.value = value;
      control.dispatchEvent(new Event('input', { bubbles: true }));
      control.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, detail: value };
    })()`
  );
  if (!result?.ok) throw new Error(result?.detail || `Could not set ${selector}.`);
  return result;
}

function controlMatchesLabel(control, label) {
  return `${control.label} ${control.title}`.toLowerCase().includes(label.toLowerCase());
}

function snapshotMatchesLabel(snapshot, label) {
  const needle = label.toLowerCase();
  return [...(snapshot.values ?? []), ...(snapshot.issues ?? [])].some((value) => String(value).toLowerCase().includes(needle));
}

function safeActionStatus(route, snapshot) {
  const labels = route.safeActionLabels ?? [];
  const controls = snapshot.controls ?? [];
  const matches = labels.flatMap((label) =>
    controls
      .filter((control) => controlMatchesLabel(control, label))
      .map((control) => ({
        label,
        controlLabel: control.label,
        disabled: control.disabled,
        fallbackFor: ''
      }))
  );
  const directLabels = new Set(matches.map((match) => match.label));
  const fallbackMatches = labels
    .filter((label) => !directLabels.has(label))
    .flatMap((label) =>
      (route.safeActionFallbacks?.[label] ?? []).flatMap((fallbackLabel) => {
        const fallbackControls = controls
          .filter((control) => controlMatchesLabel(control, fallbackLabel))
          .map((control) => ({
            label: fallbackLabel,
            controlLabel: control.label,
            disabled: control.disabled,
            fallbackFor: label
          }));
        if (fallbackControls.length) return fallbackControls;
        if (snapshotMatchesLabel(snapshot, fallbackLabel)) {
          return [
            {
              label: fallbackLabel,
              controlLabel: fallbackLabel,
              disabled: true,
              fallbackFor: label
            }
          ];
        }
        return [];
      })
    );
  const foundLabels = [...new Set([...matches, ...fallbackMatches].map((match) => match.fallbackFor || match.label))];
  return {
    found: foundLabels.length > 0,
    foundLabels,
    missingLabels: labels.filter((label) => !foundLabels.includes(label)),
    matches: [...matches, ...fallbackMatches].slice(0, 8)
  };
}

function headingMatches(route, heading) {
  return [route.heading, ...(route.alternateHeadings ?? [])].includes(heading);
}

function titleMatches(route, title) {
  return [route.title, ...(route.alternateTitles ?? [])].includes(title);
}

async function setLocalStorage(client, key, value) {
  await evaluate(client, `localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify(value))})`);
}

async function reloadAndFindValue(client, route, expectedValue, baseUrl, options = {}) {
  await navigate(client, routeUrl(baseUrl, route, options));
  await client.send('Page.reload', { ignoreCache: true });
  await waitForHydration(client);
  await delay(500);
  const snapshot = await readDomSnapshot(client);
  const values = [...snapshot.values, snapshot.text || ''];
  const observedValues = snapshot.values.filter((value) => value.includes(expectedValue));
  if (!observedValues.length && snapshot.text?.includes(expectedValue)) {
    observedValues.push(expectedValue);
  }
  return {
    ok: values.some((value) => value.includes(expectedValue)),
    route,
    expectedValue,
    values: (observedValues.length ? observedValues : values.filter(Boolean)).slice(0, 8)
  };
}

async function runResearchActionChecks(client, baseUrl) {
  await navigate(client, routeUrl(baseUrl, '/research'));
  await fillFirstTextarea(client, 'Hydrated smoke: verify Research Desk offline run guard.');
  const result = await waitForCondition(
    client,
    `(() => {
      const button = document.querySelector('.form-actions .primary-button');
      const label = (button?.innerText || button?.textContent || '').replace(/\\s+/g, ' ').trim();
      const title = button?.getAttribute('title') || '';
      const disabled = Boolean(button?.disabled);
      const body = document.body?.innerText || '';
      const serviceCards = document.querySelectorAll('.service-card').length;
      const queued = /\\bQueued\\b/i.test(body);
      if (!button) return { ok: false, state: 'missing-button', detail: 'Research run button is missing.' };
      if (label.includes('Connect AI OS')) {
        return {
          ok: disabled && /Connect AI OS before starting a research run/i.test(title) && serviceCards <= 1 && !queued,
          state: 'offline-guard',
          detail: disabled
            ? \`Disabled as "\${label}" with \${serviceCards} service card(s); queued message visible: \${queued}\`
            : \`"\${label}" is visible but not disabled.\`
        };
      }
      if (label.includes('Checking AI OS')) {
        return { ok: false, state: 'checking', detail: 'Research Desk is still probing AI OS.' };
      }
      if (label.includes('Run Quick Search')) {
        return {
          ok: true,
          state: 'online-ready',
          detail: 'AI OS appears reachable; default smoke does not start a real research job.'
        };
      }
      return { ok: false, state: 'unexpected', detail: \`Unexpected Research run button label "\${label}" with title "\${title}".\` };
    })()`,
    15_000
  );
  return [{ id: 'research-offline-run-guard', route: '/research', ...result }];
}

async function runResearchOnlineRecoveryChecks(client, baseUrl) {
  const mock = await startMockResearchAiOsServer();
  const route = `/research?aiOsUrl=${encodeURIComponent(mock.url)}`;
  const checks = [];
  try {
    await navigate(client, routeUrl(baseUrl, route));
    await fillFirstTextarea(client, 'Hydrated mock research goal');
    checks.push({
      id: 'research-online-run-ready',
      route: '/research',
      ...(await waitForCondition(
        client,
        `(() => {
          const button = document.querySelector('.form-actions .primary-button');
          const label = (button?.innerText || button?.textContent || '').replace(/\\s+/g, ' ').trim();
          const title = button?.getAttribute('title') || '';
          const body = document.body?.innerText || '';
          return {
            ok: Boolean(button && !button.disabled && label.includes('Run Quick Search') && !/AI OS service needs attention/i.test(body)),
            state: button?.disabled ? 'blocked' : 'ready',
            detail: \`label="\${label}"; title="\${title}"\`
          };
        })()`,
        15_000
      ))
    });
    if (!checks.at(-1)?.ok) return checks;

    await clickButtonByText(client, 'Run Quick Search');
    checks.push({
      id: 'research-online-run-created',
      route: '/research',
      ...(await waitForCondition(
        client,
        `(() => {
          const body = document.body?.innerText || '';
          const url = window.location.href;
          const visible = body.includes('Hydrated Mock Research Report') && body.includes('Mock AI OS is ranking sources');
          const sourceVisible = body.includes('Hydrated Research Source');
          const stableUrl = /run=hydrated-run-1/.test(url);
          return {
            ok: visible && sourceVisible && stableUrl,
            state: visible ? 'created' : 'waiting',
            detail: \`visible=\${visible}; sourceVisible=\${sourceVisible}; stableUrl=\${stableUrl}; url=\${url}\`
          };
        })()`,
        15_000
      ))
    });
    if (!checks.at(-1)?.ok) return checks;

    await clickButtonByText(client, 'Pause');
    checks.push({
      id: 'research-online-run-paused',
      route: '/research',
      ...(await waitForCondition(
        client,
        `(() => {
          const body = document.body?.innerText || '';
          const paused = body.includes('Research run paused.') && body.includes('Paused by hydrated smoke') && body.includes('Resume');
          return {
            ok: paused,
            state: paused ? 'paused' : 'waiting',
            detail: \`paused=\${paused}\`
          };
        })()`,
        10_000
      ))
    });
    if (!checks.at(-1)?.ok) return checks;

    await clickButtonByText(client, 'Resume');
    checks.push({
      id: 'research-online-run-resumed',
      route: '/research',
      ...(await waitForCondition(
        client,
        `(() => {
          const body = document.body?.innerText || '';
          const resumed = body.includes('Research run resumed.') && body.includes('Resumed by hydrated smoke') && body.includes('Pause');
          return {
            ok: resumed,
            state: resumed ? 'resumed' : 'waiting',
            detail: \`resumed=\${resumed}\`
          };
        })()`,
        10_000
      ))
    });
    if (!checks.at(-1)?.ok) return checks;

    await evaluate(client, 'window.confirm = () => true');
    await clickButtonByText(client, 'Cancel');
    checks.push({
      id: 'research-online-run-cancelled',
      route: '/research',
      ...(await waitForCondition(
        client,
        `(() => {
          const body = document.body?.innerText || '';
          const cancelled = body.includes('Research run cancelled.') && body.includes('cancelled') && body.includes('Cancelled by hydrated smoke');
          return {
            ok: cancelled,
            state: cancelled ? 'cancelled' : 'waiting',
            detail: \`cancelled=\${cancelled}\`
          };
        })()`,
        10_000
      ))
    });
    if (!checks.at(-1)?.ok) return checks;

    await navigate(client, routeUrl(baseUrl, '/activity'));
    await navigate(client, routeUrl(baseUrl, `/research?aiOsUrl=${encodeURIComponent(mock.url)}&run=hydrated-run-1`));
    checks.push({
      id: 'research-online-run-rehydrated',
      route: '/research',
      ...(await waitForCondition(
        client,
        `(() => {
          const body = document.body?.innerText || '';
          const reloaded = body.includes('Hydrated Mock Research Report') && body.includes('Cancelled by hydrated smoke') && body.includes('Hydrated Research Source');
          return {
            ok: reloaded,
            state: reloaded ? 'rehydrated' : 'waiting',
            detail: \`reloaded=\${reloaded}; url=\${window.location.href}\`
          };
        })()`,
        15_000
      ))
    });

    await fillFirstTextarea(client, 'Hydrated monitor goal');
    await setControlValue(client, 'input[placeholder="Optional name for this topic watch"]', 'Hydrated monitor watch');
    await setControlValue(client, '.monitor-create-row select', 'daily');
    await clickButtonByText(client, 'Save Current Setup');
    checks.push({
      id: 'research-monitor-created',
      route: '/research',
      ...(await waitForCondition(
        client,
        `(() => {
          const body = document.body?.innerText || '';
          const created = body.includes('Saved topic monitor') && body.includes('Hydrated monitor watch') && body.includes('daily');
          return {
            ok: created,
            state: created ? 'created' : 'waiting',
            detail: created ? 'Saved Research monitor is visible.' : 'Waiting for saved monitor card.'
          };
        })()`,
        15_000
      ))
    });

    await clickButtonByText(client, 'Run Now');
    checks.push({
      id: 'research-monitor-run-created',
      route: '/research',
      ...(await waitForCondition(
        client,
        `(() => {
          const body = document.body?.innerText || '';
          const queued = body.includes('Queued monitor run for Hydrated monitor watch') && body.includes('Monitor run for Hydrated monitor watch');
          const urlUpdated = /run=hydrated-run-2/.test(location.href);
          return {
            ok: queued && urlUpdated,
            state: queued ? 'queued' : 'waiting',
            detail: \`queued=\${queued}; urlUpdated=\${urlUpdated}; url=\${location.href}\`
          };
        })()`,
        15_000
      ))
    });

    checks.push({
      id: 'research-report-export-links',
      route: '/research',
      ...(await waitForCondition(
        client,
        `(() => {
          const links = [...document.querySelectorAll('.export-actions a')].map((link) => ({
            text: (link.innerText || link.textContent || '').replace(/\\s+/g, ' ').trim(),
            href: link.href
          }));
          const markdown = links.some((link) => /Markdown/i.test(link.text) && /\\/api\\/ai\\/research\\/runs\\/hydrated-run-2\\/export\\?format=markdown/u.test(link.href));
          const json = links.some((link) => /JSON/i.test(link.text) && /\\/api\\/ai\\/research\\/runs\\/hydrated-run-2\\/export\\?format=json/u.test(link.href));
          const html = links.some((link) => /HTML/i.test(link.text) && /\\/api\\/ai\\/research\\/runs\\/hydrated-run-2\\/export\\?format=html/u.test(link.href));
          return {
            ok: markdown && json && html,
            state: markdown && json && html ? 'ready' : 'waiting',
            detail: \`markdown=\${markdown}; json=\${json}; html=\${html}\`
          };
        })()`,
        15_000
      ))
    });

    await setNthControlValue(client, '.source-library-controls input', 0, 'hydrated');
    await setNthControlValue(client, '.source-library-controls input', 1, 'example.com');
    await clickButtonByText(client, 'Search Sources');
    checks.push({
      id: 'research-source-search',
      route: '/research',
      ...(await waitForCondition(
        client,
        `(() => {
          const body = document.body?.innerText || '';
          const source = body.includes('Hydrated Research Source') && body.includes('Matched hydrated, mock, hydrated, example.com');
          const controlsReady = [...document.querySelectorAll('button')].some((button) => /Use as Seed/i.test(button.innerText || button.textContent || '') && !button.disabled);
          return {
            ok: source && controlsReady,
            state: source ? 'source-found' : 'waiting',
            detail: \`source=\${source}; controlsReady=\${controlsReady}\`
          };
        })()`,
        15_000
      ))
    });

    await clickButtonByText(client, 'Use as Seed');
    checks.push({
      id: 'research-source-seed-added',
      route: '/research',
      ...(await waitForCondition(
        client,
        `(() => {
          const body = document.body?.innerText || '';
          const seedText = [...document.querySelectorAll('textarea')].map((textarea) => textarea.value).join('\\n');
          const added = seedText.includes('https://example.com/hydrated-research') && body.includes('Added archived source to Seed URLs for the next run.');
          return {
            ok: added,
            state: added ? 'seeded' : 'waiting',
            detail: \`seeded=\${seedText.includes('https://example.com/hydrated-research')}; message=\${body.includes('Added archived source to Seed URLs for the next run.')}\`
          };
        })()`,
        15_000
      ))
    });

    await navigate(client, routeUrl(baseUrl, `/research?aiOsUrl=${encodeURIComponent(mock.url)}&run=hydrated-run-2`));
    checks.push({
      id: 'research-monitor-source-draft-reloaded',
      route: '/research',
      ...(await waitForCondition(
        client,
        `(() => {
          const body = document.body?.innerText || '';
          const values = [...document.querySelectorAll('input, textarea, select')].map((control) => control.value);
          const report = body.includes('Hydrated Mock Research Report') && body.includes('Monitor run for Hydrated monitor watch');
          const monitor = body.includes('Hydrated monitor watch') && values.includes('Hydrated monitor watch') && values.includes('daily');
          const seed = values.some((value) => String(value).includes('https://example.com/hydrated-research'));
          return {
            ok: report && monitor && seed,
            state: report && monitor && seed ? 'rehydrated' : 'waiting',
            detail: \`report=\${report}; monitor=\${monitor}; seed=\${seed}; url=\${location.href}\`
          };
        })()`,
        15_000
      ))
    });

    await clickButtonByText(client, 'Disable');
    checks.push({
      id: 'research-monitor-toggle',
      route: '/research',
      ...(await waitForCondition(
        client,
        `(() => {
          const body = document.body?.innerText || '';
          const lowerBody = body.toLowerCase();
          const toggled = (lowerBody.includes('off') || body.includes('Disabled monitor.')) && [...document.querySelectorAll('button')].some((button) => /Enable/i.test(button.innerText || button.textContent || ''));
          return {
            ok: toggled,
            state: toggled ? 'disabled' : 'waiting',
            detail: toggled ? 'Monitor toggled off and Enable action is visible.' : 'Waiting for monitor toggle.'
          };
        })()`,
        15_000
      ))
    });

    await evaluate(client, `window.confirm = () => true`);
    await clickButtonByText(client, 'Delete');
    checks.push({
      id: 'research-monitor-delete',
      route: '/research',
      ...(await waitForCondition(
        client,
        `(() => {
          const body = document.body?.innerText || '';
          const monitorCards = [...document.querySelectorAll('.monitor-card')].map((card) => card.innerText || card.textContent || '');
          const cardRemoved = !monitorCards.some((card) => card.includes('Hydrated monitor watch'));
          const deleted = body.includes('Deleted monitor. Archived reports were left intact.') && cardRemoved;
          return {
            ok: deleted,
            state: deleted ? 'deleted' : 'waiting',
            detail: deleted ? 'Monitor delete confirmation left reports intact.' : 'Waiting for monitor delete. cardRemoved=' + cardRemoved
          };
        })()`,
        15_000
      ))
    });
    return checks;
  } finally {
    await mock.close();
  }
}

async function runAiOsOfflineActionGuardChecks(client, baseUrl) {
  await navigate(client, routeUrl(baseUrl, '/ai-os?aiOsUrl=http%3A%2F%2F127.0.0.1%3A9'));
  const result = await waitForCondition(
    client,
    `(() => {
      const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
      const body = document.body?.innerText || '';
      const buttons = [...document.querySelectorAll('button')].map((button) => ({
        label: clean(button.innerText || button.textContent),
        title: button.getAttribute('title') || '',
        disabled: Boolean(button.disabled)
      }));
      const offlineKnown = /AI OS service OFFLINE|AI OS is offline|AI OS status is still loading|Failed to fetch|Desktop service/i.test(body);
      const blocked = buttons.filter((button) =>
        /AI OS is offline or not connected|AI OS status is still loading/i.test(button.title)
      );
      const badBlocked = blocked.filter((button) => !button.disabled);
      const blockedLabels = blocked.map((button) => button.label).join(' | ');
      const blocks = [...document.querySelectorAll('.card, section, details')].map((block) => ({
        text: clean(block.innerText || block.textContent),
        blockedButtonCount: [...block.querySelectorAll('button')].filter(
          (button) =>
            button.disabled &&
            /AI OS is offline or not connected|AI OS status is still loading/i.test(button.getAttribute('title') || '')
        ).length
      }));
      const sectionBlocked = (needle) =>
        blocks.some((block) => block.text.includes(needle) && block.blockedButtonCount > 0);
      const hasCommand = blockedLabels.includes('Connect AI OS');
      const hasWarmup = blockedLabels.includes('Warm Model');
      const hasAutotune = sectionBlocked('Machine Profile + Autotune');
      const hasDesign = sectionBlocked('Design Patch Lab');
      const hasBenchmark = sectionBlocked('Benchmarks');
      const hasQueue = sectionBlocked('Jobs');
      const hasAgentOrMedia = sectionBlocked('Agent Engine') || sectionBlocked('Make Media');
      return {
        ok:
          offlineKnown &&
          blocked.length >= 10 &&
          badBlocked.length === 0 &&
          hasCommand &&
          hasWarmup &&
          hasAutotune &&
          hasDesign &&
          hasBenchmark &&
          hasQueue &&
          hasAgentOrMedia,
        state: offlineKnown ? 'offline-guard' : 'waiting',
        detail: \`offlineKnown=\${offlineKnown}; disabledBlocked=\${blocked.length - badBlocked.length}/\${blocked.length}; command=\${hasCommand}; warmup=\${hasWarmup}; autotune=\${hasAutotune}; design=\${hasDesign}; benchmark=\${hasBenchmark}; queue=\${hasQueue}; agentOrMedia=\${hasAgentOrMedia}\`
      };
    })()`,
    15_000
  );
  return [{ id: 'ai-os-offline-action-guard', route: '/ai-os', ...result }];
}

async function runDeskWriteGuardChecks(client, baseUrl) {
  const checks = [];
  const useRealApi = process.env.HUB_HYDRATED_DESK_WRITES === '1';

  if (!useRealApi) {
    await navigate(client, routeUrl(baseUrl, '/desk/career'));
    await setControlValue(client, '#company', 'Hydrated Smoke Labs');
    await setControlValue(client, '#role', 'QA Reliability Analyst');
    checks.push({
      id: 'career-add-job-guard',
      route: '/desk/career',
      ...(await waitForCondition(
        client,
        `(() => {
          const button = [...document.querySelectorAll('button')].find((candidate) =>
            (candidate.innerText || candidate.textContent || '').includes('Add Job')
          );
          const title = button?.getAttribute('title') || '';
          const disabled = Boolean(button?.disabled);
          const body = document.body?.innerText || '';
          if (!button) return { ok: false, state: 'missing-button', detail: 'Add Job button is missing.' };
          if (disabled) {
            return {
              ok: /Offline read-only|API before saving|A Career save is already running/i.test(title),
              state: 'write-guarded',
              detail: \`Add Job disabled with title "\${title}". Saved message visible: \${/Saved QA Reliability Analyst at Hydrated Smoke Labs/i.test(body)}\`
            };
          }
          return {
            ok: true,
            state: 'online-ready',
            detail: 'Add Job is enabled after required fields are filled; default smoke will verify saving against a mock API next.'
          };
        })()`,
        12_000
      ))
    });

    await navigate(client, routeUrl(baseUrl, '/desk/study'));
    await setControlValue(client, '#subject', 'Hydrated Smoke Study');
    await setControlValue(client, '#minutes', '25');
    checks.push({
      id: 'study-log-guard',
      route: '/desk/study',
      ...(await waitForCondition(
        client,
        `(() => {
          const button = [...document.querySelectorAll('button')].find((candidate) =>
            (candidate.innerText || candidate.textContent || '').includes('Log Progress')
          );
          const title = button?.getAttribute('title') || '';
          const disabled = Boolean(button?.disabled);
          const body = document.body?.innerText || '';
          if (!button) return { ok: false, state: 'missing-button', detail: 'Log Progress button is missing.' };
          if (disabled) {
            return {
              ok: /Offline read-only|API before saving|A Study save is already running/i.test(title),
              state: 'write-guarded',
              detail: \`Log Progress disabled with title "\${title}". Logged message visible: \${/Logged 25 min for Hydrated Smoke Study/i.test(body)}\`
            };
          }
          return {
            ok: true,
            state: 'online-ready',
            detail: 'Log Progress is enabled after required fields are filled; default smoke will verify saving against a mock API next.'
          };
        })()`,
        12_000
      ))
    });
  }

  let mockApi = null;
  try {
    mockApi = useRealApi ? null : await startMockHubApiServer();
    checks.push(...(await runDeskApiSaveChecks(client, baseUrl, mockApi?.url || '')));
  } finally {
    await mockApi?.close();
  }
  return checks;
}

async function runProductivityCacheWriteGuardChecks(client, baseUrl) {
  const checks = [];
  await navigate(client, routeUrl(baseUrl, '/'));
  await setLocalStorage(client, 'miniHub.productivity.cache.v1', productivityCacheSeed);
  await navigate(
    client,
    routeUrl(baseUrl, '/productivity?apiUrl=http%3A%2F%2F127.0.0.1%3A9', { skipApiUrlOverride: true })
  );

  checks.push({
    id: 'productivity-cache-write-guard',
    route: '/productivity',
    ...(await waitForCondition(
      client,
      `(() => {
        const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
        const body = document.body?.innerText || '';
        const eventBlock = [...document.querySelectorAll('.event-block')].find((button) =>
          clean(button.innerText || button.textContent).includes('Hydrated Cache Interview')
        );
        const eventTitle = eventBlock?.getAttribute('title') || '';
        const cachedEventVisible = body.includes('Hydrated Cache Interview');
        const cachedThreadVisible = body.includes('Hydrated cached deadline mail') && body.includes('Please confirm the deadline package');
        const offlineKnown = /API unavailable|Mini Hub API is unavailable|cached read-only|cached data remains read-only/i.test(body);
        const writeNeedles = [
          /\\bRead\\b/i,
          /\\bImportant\\b/i,
          /\\bArchive\\b/i,
          /\\bApply Label\\b/i,
          /\\bDraft Reply\\b/i,
          /\\bSend Reply\\b/i
        ];
        const writeButtons = [...document.querySelectorAll('.gmail-workspace button')].filter((button) => {
          const label = clean(button.innerText || button.textContent || button.getAttribute('aria-label'));
          return writeNeedles.some((pattern) => pattern.test(label));
        });
        const badWrites = writeButtons.filter((button) => {
          const title = button.getAttribute('title') || '';
          return !button.disabled || !/Connect the API and Google|checking the local API|latest connection state|Another Productivity action/i.test(title);
        });
        const eventInspectable = Boolean(eventBlock && !eventBlock.disabled && /Open cached event details/i.test(eventTitle));
        return {
          ok: cachedEventVisible && cachedThreadVisible && offlineKnown && eventInspectable && writeButtons.length >= 6 && badWrites.length === 0,
          state: eventInspectable && badWrites.length === 0 ? 'cache-readonly' : 'waiting',
          detail: \`cachedEvent=\${cachedEventVisible}; cachedThread=\${cachedThreadVisible}; offlineKnown=\${offlineKnown}; eventInspectable=\${eventInspectable}; disabledWrites=\${writeButtons.length - badWrites.length}/\${writeButtons.length}\`
        };
      })()`,
      15_000
    ))
  });

  if (checks.at(-1)?.ok) {
    await evaluate(
      client,
      `(() => {
        const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
        const eventBlock = [...document.querySelectorAll('.event-block')].find((button) =>
          clean(button.innerText || button.textContent).includes('Hydrated Cache Interview')
        );
        eventBlock?.click();
        return { ok: Boolean(eventBlock) };
      })()`
    );
  }

  checks.push({
    id: 'productivity-cached-event-readonly-details',
    route: '/productivity',
    ...(await waitForCondition(
      client,
      `(() => {
        const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
        const dialog = document.querySelector('[role="dialog"]');
        const titleInput = document.querySelector('#event-title');
        const description = document.querySelector('#event-description');
        const saveButton = dialog
          ? [...dialog.querySelectorAll('button')].find((button) => clean(button.innerText || button.textContent).includes('Update Event'))
          : null;
        const saveTitle = saveButton?.getAttribute('title') || '';
        const eventLoaded = titleInput?.value === 'Hydrated Cache Interview';
        const messageVisible = /Showing cached event details/i.test(document.body?.innerText || '');
        const fieldsReadonly = Boolean(titleInput?.disabled && description?.disabled);
        const saveBlocked = Boolean(saveButton?.disabled && /Connect the API and Google|checking the local API|latest connection state/i.test(saveTitle));
        return {
          ok: Boolean(dialog) && eventLoaded && messageVisible && fieldsReadonly && saveBlocked,
          state: Boolean(dialog) ? 'readonly-details' : 'waiting',
          detail: \`dialog=\${Boolean(dialog)}; eventLoaded=\${eventLoaded}; message=\${messageVisible}; fieldsReadonly=\${fieldsReadonly}; saveBlocked=\${saveBlocked}; saveTitle="\${saveTitle}"\`
        };
      })()`,
      10_000
    ))
  });

  return checks;
}

async function runLocalServiceSideEffectGuardChecks(client, baseUrl) {
  const checks = [];

  await navigate(
    client,
    routeUrl(baseUrl, '/macro-lab?macroLabUrl=http%3A%2F%2F127.0.0.1%3A9')
  );
  checks.push({
    id: 'macro-lab-side-effect-guard',
    route: '/macro-lab',
    ...(await waitForCondition(
      client,
      `(() => {
        const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
        const body = document.body?.innerText || '';
        const serviceCards = document.querySelectorAll('.service-card').length;
        const labels = ['Panic', 'Reset', 'Record', 'Stop', 'Dry Run', 'Run Confirmed'];
        const buttons = labels.flatMap((label) =>
          [...document.querySelectorAll('button')]
            .filter((button) => clean(button.innerText || button.textContent).includes(label))
            .map((button) => ({ label, disabled: Boolean(button.disabled), title: button.getAttribute('title') || '' }))
        );
        const panicReset = buttons.filter((button) => ['Panic', 'Reset'].includes(button.label));
        const badButtons = buttons.filter((button) => {
          if (!button.disabled) return true;
          return !/Macro Lab service is unavailable|Connect Macro Lab|loading the latest|already running/i.test(button.title);
        });
        const emptyEditor = /Connect the Macro Lab service to edit and run macros|Macro definitions are unavailable/i.test(body);
        const offlineKnown = /Macro Lab connection failed|Macro Lab service is unavailable|Failed to fetch/i.test(body);
        return {
          ok: offlineKnown && serviceCards <= 1 && panicReset.length >= 2 && badButtons.length === 0 && (buttons.length >= 4 || emptyEditor),
          state: offlineKnown ? 'offline-guard' : 'waiting',
          detail: \`offlineKnown=\${offlineKnown}; serviceCards=\${serviceCards}; guardedButtons=\${buttons.length - badButtons.length}/\${buttons.length}; emptyEditor=\${emptyEditor}\`
        };
      })()`,
      15_000
    ))
  });

  await navigate(
    client,
    routeUrl(baseUrl, '/passive-tasks?apiUrl=http%3A%2F%2F127.0.0.1%3A9', { skipApiUrlOverride: true })
  );
  checks.push({
    id: 'passive-task-run-guard',
    route: '/passive-tasks',
    ...(await waitForCondition(
      client,
      `(() => {
        const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
        const body = document.body?.innerText || '';
        const serviceCards = document.querySelectorAll('.service-card').length;
        const labels = ['Run Due', 'Startup Event', 'Idle Tick'];
        const buttons = labels.flatMap((label) =>
          [...document.querySelectorAll('button')]
            .filter((button) => clean(button.innerText || button.textContent).includes(label))
            .map((button) => ({ label, disabled: Boolean(button.disabled), title: button.getAttribute('title') || '' }))
        );
        const badButtons = buttons.filter((button) => {
          if (!button.disabled) return true;
          return !/Passive Tasks API is unavailable|loading the latest|already running|Load Passive Tasks/i.test(button.title);
        });
        const offlineKnown = /Passive Tasks API unavailable|Passive Tasks API is unavailable|Failed to fetch/i.test(body);
        return {
          ok: offlineKnown && serviceCards <= 1 && buttons.length === labels.length && badButtons.length === 0,
          state: offlineKnown ? 'offline-guard' : 'waiting',
          detail: \`offlineKnown=\${offlineKnown}; serviceCards=\${serviceCards}; guardedButtons=\${buttons.length - badButtons.length}/\${buttons.length}\`
        };
      })()`,
      15_000
    ))
  });

  return checks;
}

async function runDeskApiSaveChecks(client, baseUrl, apiUrl = '') {
  const checks = [];
  const withApi = (route) =>
    apiUrl
      ? routeUrl(baseUrl, `${route}${route.includes('?') ? '&' : '?'}apiUrl=${encodeURIComponent(apiUrl)}`, { skipApiUrlOverride: true })
      : routeUrl(baseUrl, route);

  await navigate(client, withApi('/desk/career'));
  await setControlValue(client, '#company', 'Hydrated API Smoke Labs');
  await setControlValue(client, '#role', 'Saved QA Analyst');
  checks.push({
    id: 'career-add-job-save-reload',
    route: '/desk/career',
    ...(await waitForCondition(
      client,
      `(() => {
        const button = [...document.querySelectorAll('button')].find((candidate) =>
          (candidate.innerText || candidate.textContent || '').includes('Add Job')
        );
        const title = button?.getAttribute('title') || '';
        const disabled = Boolean(button?.disabled);
        if (!button) return { ok: false, state: 'missing-button', detail: 'Add Job button is missing.' };
        return {
          ok: !disabled,
          state: disabled ? 'blocked' : 'ready',
          detail: disabled ? \`Add Job is still disabled: \${title}\` : 'Add Job is enabled against the configured Hub API.'
        };
      })()`,
      15_000
    ))
  });
  if (checks.at(-1)?.ok) {
    await clickButtonByText(client, 'Add Job');
    checks.push({
      id: 'career-add-job-persisted',
      route: '/desk/career',
      ...(await waitForCondition(
        client,
        `(() => {
          const text = document.body?.innerText || '';
          const saved = /Saved Saved QA Analyst at Hydrated API Smoke Labs/i.test(text);
          const row = /Hydrated API Smoke Labs/i.test(text) && /Saved QA Analyst/i.test(text);
          return {
            ok: saved && row,
            state: saved && row ? 'saved' : 'waiting',
            detail: saved && row ? 'Career save banner and row are visible.' : 'Waiting for Career save banner and saved row.'
          };
        })()`,
        15_000
      ))
    });
    await navigate(client, withApi('/desk/career'));
    checks.push({
      id: 'career-add-job-reloaded',
      route: '/desk/career',
      ...(await waitForCondition(
        client,
        `(() => {
          const text = document.body?.innerText || '';
          const row = /Hydrated API Smoke Labs/i.test(text) && /Saved QA Analyst/i.test(text);
          return {
            ok: row,
            state: row ? 'reloaded' : 'waiting',
            detail: row ? 'Saved Career row reloaded from API/cache.' : 'Waiting for saved Career row after navigation.'
          };
        })()`,
        15_000
      ))
    });

    await setControlValue(client, '#job-search', 'Hydrated API Smoke Labs');
    await setControlValue(client, '#status-filter', 'lead');
    checks.push({
      id: 'career-filter-visible',
      route: '/desk/career',
      ...(await waitForCondition(
        client,
        `(() => {
          const text = document.body?.innerText || '';
          const row = /Hydrated API Smoke Labs/i.test(text) && /Saved QA Analyst/i.test(text);
          const count = /\\d+\\s*\\/\\s*\\d+ jobs/i.test(text);
          const empty = /No jobs match the current filters/i.test(text);
          return {
            ok: row && count && !empty,
            state: row && !empty ? 'filtered' : 'waiting',
            detail: row && count && !empty ? 'Career search/status filters kept the saved row visible.' : 'Waiting for filtered Career row.'
          };
        })()`,
        15_000
      ))
    });

    await setControlValue(client, '#status-filter', 'all');
    checks.push({
      id: 'career-edit-ready',
      route: '/desk/career',
      ...(await waitForCondition(
        client,
        `(() => {
          const button = [...document.querySelectorAll('button')].find((candidate) => candidate.getAttribute('aria-label') === 'Edit Hydrated API Smoke Labs');
          const title = button?.getAttribute('title') || '';
          const disabled = Boolean(button?.disabled);
          return {
            ok: Boolean(button) && !disabled,
            state: button && !disabled ? 'ready' : 'waiting',
            detail: button ? \`Edit button disabled=\${disabled}; title="\${title}"\` : 'Waiting for Career edit button.'
          };
        })()`,
        15_000
      ))
    });
    await clickButtonByAriaLabel(client, 'Edit Hydrated API Smoke Labs');
    await setNthControlValue(client, '.table-card tbody tr .table-input', 1, 'Edited QA Analyst');
    await setNthControlValue(client, '.table-card tbody tr .table-select', 0, 'interview');
    await clickButtonByAriaLabel(client, 'Save job');
    checks.push({
      id: 'career-edit-persisted',
      route: '/desk/career',
      ...(await waitForCondition(
        client,
        `(() => {
          const text = document.body?.innerText || '';
          const updated = /Updated Edited QA Analyst at Hydrated API Smoke Labs/i.test(text);
          const row = /Hydrated API Smoke Labs/i.test(text) && /Edited QA Analyst/i.test(text) && /interview/i.test(text);
          return {
            ok: updated && row,
            state: updated && row ? 'edited' : 'waiting',
            detail: updated && row ? 'Career inline edit saved and row updated.' : 'Waiting for edited Career row.'
          };
        })()`,
        15_000
      ))
    });

    await setControlValue(client, '#status-filter', 'interview');
    checks.push({
      id: 'career-filter-saved-locally',
      route: '/desk/career',
      ...(await waitForCondition(
        client,
        `(() => {
          const searchValue = document.querySelector('#job-search')?.value || '';
          const statusValue = document.querySelector('#status-filter')?.value || '';
          let storedSearch = '';
          let storedStatus = '';
          try {
            const stored = JSON.parse(localStorage.getItem('miniHub.career.view.v1') || '{}');
            storedSearch = stored?.searchQuery || '';
            storedStatus = stored?.statusFilter || '';
          } catch {}
          return {
            ok: searchValue === 'Hydrated API Smoke Labs' && statusValue === 'interview' && storedSearch === searchValue && storedStatus === statusValue,
            state: storedSearch === searchValue && storedStatus === statusValue ? 'saved' : 'waiting',
            detail: \`searchValue=\${searchValue}; statusValue=\${statusValue}; storedSearch=\${storedSearch}; storedStatus=\${storedStatus}\`
          };
        })()`,
        15_000
      ))
    });
    await navigate(client, withApi('/desk/career'));
    checks.push({
      id: 'career-edit-filter-reloaded',
      route: '/desk/career',
      ...(await waitForCondition(
        client,
        `(() => {
          const text = document.body?.innerText || '';
          const searchValue = document.querySelector('#job-search')?.value || '';
          const statusValue = document.querySelector('#status-filter')?.value || '';
          const row = /Hydrated API Smoke Labs/i.test(text) && /Edited QA Analyst/i.test(text) && /interview/i.test(text);
          const filterReloaded = searchValue === 'Hydrated API Smoke Labs' && statusValue === 'interview';
          return {
            ok: row && filterReloaded,
            state: row ? 'reloaded' : 'waiting',
            detail: row && filterReloaded ? 'Edited Career row and browser filter values reloaded.' : \`row=\${row}; searchValue=\${searchValue}; statusValue=\${statusValue}\`
          };
        })()`,
        15_000
      ))
    });

    await clickButtonByText(client, 'Export');
    checks.push({
      id: 'career-export-visible-confirmation',
      route: '/desk/career',
      ...(await waitForCondition(
        client,
        `(() => {
          const text = document.body?.innerText || '';
          const exported = /Exported legacy Career snapshot from this browser/i.test(text);
          return {
            ok: exported,
            state: exported ? 'exported' : 'waiting',
            detail: exported ? 'Career export action produced a visible confirmation.' : 'Waiting for Career export confirmation.'
          };
        })()`,
        15_000
      ))
    });
  }

  await navigate(client, withApi('/desk/study'));
  await setControlValue(client, '#subject', 'Hydrated API Study');
  await setControlValue(client, '#minutes', '26');
  checks.push({
    id: 'study-log-save-reload',
    route: '/desk/study',
    ...(await waitForCondition(
      client,
      `(() => {
        const button = [...document.querySelectorAll('button')].find((candidate) =>
          (candidate.innerText || candidate.textContent || '').includes('Log Progress')
        );
        const title = button?.getAttribute('title') || '';
        const disabled = Boolean(button?.disabled);
        if (!button) return { ok: false, state: 'missing-button', detail: 'Log Progress button is missing.' };
        return {
          ok: !disabled,
          state: disabled ? 'blocked' : 'ready',
          detail: disabled ? \`Log Progress is still disabled: \${title}\` : 'Log Progress is enabled against the configured Hub API.'
        };
      })()`,
      15_000
    ))
  });
  if (checks.at(-1)?.ok) {
    await clickButtonByText(client, 'Log Progress');
    checks.push({
      id: 'study-log-persisted',
      route: '/desk/study',
      ...(await waitForCondition(
        client,
        `(() => {
          const text = document.body?.innerText || '';
          const saved = /Logged 26 min for Hydrated API Study/i.test(text);
          const row = /Hydrated API Study/i.test(text) && /26/.test(text);
          return {
            ok: saved && row,
            state: saved && row ? 'saved' : 'waiting',
            detail: saved && row ? 'Study save banner and row are visible.' : 'Waiting for Study save banner and saved row.'
          };
        })()`,
        15_000
      ))
    });
    await navigate(client, withApi('/desk/study'));
    checks.push({
      id: 'study-log-reloaded',
      route: '/desk/study',
      ...(await waitForCondition(
        client,
        `(() => {
          const text = document.body?.innerText || '';
          const row = /Hydrated API Study/i.test(text) && /26/.test(text);
          return {
            ok: row,
            state: row ? 'reloaded' : 'waiting',
            detail: row ? 'Saved Study row reloaded from API/cache.' : 'Waiting for saved Study row after navigation.'
          };
        })()`,
        15_000
      ))
    });

    checks.push({
      id: 'study-edit-ready',
      route: '/desk/study',
      ...(await waitForCondition(
        client,
        `(() => {
          const button = [...document.querySelectorAll('button')].find((candidate) => candidate.getAttribute('aria-label') === 'Edit Hydrated API Study');
          const title = button?.getAttribute('title') || '';
          const disabled = Boolean(button?.disabled);
          return {
            ok: Boolean(button) && !disabled,
            state: button && !disabled ? 'ready' : 'waiting',
            detail: button ? \`Edit button disabled=\${disabled}; title="\${title}"\` : 'Waiting for Study edit button.'
          };
        })()`,
        15_000
      ))
    });
    await clickButtonByAriaLabel(client, 'Edit Hydrated API Study');
    await setNthControlValue(client, 'details[open] .table-card tbody tr .table-input', 0, 'Hydrated Edited Study');
    await setNthControlValue(client, 'details[open] .table-card tbody tr .table-input', 1, '31');
    await clickButtonByAriaLabel(client, 'Save study log');
    checks.push({
      id: 'study-edit-persisted',
      route: '/desk/study',
      ...(await waitForCondition(
        client,
        `(() => {
          const text = document.body?.innerText || '';
          const updated = /Updated 31 min for Hydrated Edited Study/i.test(text);
          const row = /Hydrated Edited Study/i.test(text) && /31/.test(text);
          const progress = [...document.querySelectorAll('.day-cell')].some((cell) => /31 minutes/i.test(cell.getAttribute('title') || ''));
          return {
            ok: row && progress,
            state: row && progress ? 'edited' : 'waiting',
            detail: row && progress ? \`Study inline edit saved durable row/progress evidence. banner=\${updated}\` : \`updated=\${updated}; row=\${row}; progress=\${progress}\`
          };
        })()`,
        15_000
      ))
    });

    await setControlValue(client, '#study-search', 'Edited');
    checks.push({
      id: 'study-filter-saved-locally',
      route: '/desk/study',
      ...(await waitForCondition(
        client,
        `(() => {
          const filterValue = document.querySelector('#study-search')?.value || '';
          let stored = '';
          try {
            stored = JSON.parse(localStorage.getItem('miniHub.study.view.v1') || '{}')?.searchQuery || '';
          } catch {}
          return {
            ok: filterValue === 'Edited' && stored === 'Edited',
            state: stored === 'Edited' ? 'saved' : 'waiting',
            detail: \`filterValue=\${filterValue}; stored=\${stored}\`
          };
        })()`,
        15_000
      ))
    });
    await navigate(client, withApi('/desk/study'));
    checks.push({
      id: 'study-filter-progress-reloaded',
      route: '/desk/study',
      ...(await waitForCondition(
        client,
        `(() => {
          const text = document.body?.innerText || '';
          const row = /Hydrated Edited Study/i.test(text) && /31/.test(text);
          const filterValue = document.querySelector('#study-search')?.value || '';
          const filterReloaded = filterValue === 'Edited';
          const progress = [...document.querySelectorAll('.day-cell')].some((cell) => /31 minutes/i.test(cell.getAttribute('title') || ''));
          return {
            ok: row && filterReloaded && progress,
            state: row ? 'reloaded' : 'waiting',
            detail: row && filterReloaded && progress ? 'Edited Study row, filter value, and progress cell reloaded.' : \`row=\${row}; filterValue=\${filterValue}; progress=\${progress}\`
          };
        })()`,
        15_000
      ))
    });
  }

  return checks;
}

async function runAiLabActionChecks(client, baseUrl) {
  const results = [];
  await navigate(client, routeUrl(baseUrl, '/ai-lab'));

  try {
    await clickButtonByText(client, 'Restore Samples');
    await clickButtonByText(client, 'Parse');
    const parse = await waitForCondition(
      client,
      `(() => {
        const text = document.body?.innerText || '';
        if (text.includes('Parser: Result ready')) {
          return { ok: true, state: 'success', detail: text.includes('"rootType"') ? 'Tree-sitter returned rootType output.' : 'Parser reported success.' };
        }
        if (text.includes('Parser: Action needed')) {
          return { ok: false, state: 'error', detail: [...document.querySelectorAll('.result-panel.error pre')].map((item) => item.textContent?.trim()).filter(Boolean).join(' ') || 'Parser action needed.' };
        }
        if (text.includes('Parser: No output returned')) {
          return { ok: false, state: 'empty', detail: 'Parser returned no inspectable output.' };
        }
        return { ok: false, state: 'waiting', detail: 'Waiting for parser result.' };
      })()`,
      20_000
    );
    results.push({ id: 'ai-lab-parse', route: '/ai-lab', ...parse });
    await setControlValue(client, '#grammar', 'data:application/wasm;base64,ZmFrZSB3YXNt');
    await clickButtonByText(client, 'Parse');
    const parseAssetError = await waitForCondition(
      client,
      `(() => {
        const text = document.body?.innerText || '';
        if (text.includes('Parser: Action needed')) {
          const detail = [...document.querySelectorAll('.result-panel.error pre')]
            .map((item) => item.textContent?.trim())
            .filter(Boolean)
            .join(' ');
          const readable = /Tree-sitter|WASM grammar|browser-local Tree-sitter|not an AI OS outage/i.test(detail);
          return {
            ok: readable,
            state: readable ? 'readable-error' : 'unclear-error',
            detail: detail || 'Parser action needed, but no error detail was visible.'
          };
        }
        if (text.includes('Parser: Result ready')) {
          return { ok: false, state: 'unexpected-success', detail: 'Invalid grammar URL parsed successfully.' };
        }
        return { ok: false, state: 'waiting', detail: 'Waiting for parser asset failure.' };
      })()`,
      20_000
    );
    results.push({ id: 'ai-lab-parse-asset-error', route: '/ai-lab', ...parseAssetError });
  } catch (error) {
    results.push({
      id: 'ai-lab-parse',
      route: '/ai-lab',
      ok: false,
      state: 'error',
      detail: error instanceof Error ? error.message : 'Parse smoke failed.'
    });
  }

  if ((process.env.HUB_HYDRATED_AI_LAB_CLASSIFY || '0') !== '0') {
    try {
      await clickButtonByText(client, 'Classify');
      const classify = await waitForCondition(
        client,
        `(() => {
          const text = document.body?.innerText || '';
          if (text.includes('Classifier: Result ready')) return { ok: true, state: 'success', detail: 'Classifier returned labels.' };
          if (text.includes('Classifier: Action needed')) {
            return { ok: false, state: 'error', detail: [...document.querySelectorAll('.result-panel.error pre')].map((item) => item.textContent?.trim()).filter(Boolean).join(' ') || 'Classifier action needed.' };
          }
          if (text.includes('Classifier: No output returned')) return { ok: false, state: 'empty', detail: 'Classifier returned no labels.' };
          return { ok: false, state: 'waiting', detail: 'Waiting for classifier result.' };
        })()`,
        90_000
      );
      results.push({ id: 'ai-lab-classify', route: '/ai-lab', ...classify });
    } catch (error) {
      results.push({
        id: 'ai-lab-classify',
        route: '/ai-lab',
        ok: false,
        state: 'error',
        detail: error instanceof Error ? error.message : 'Classify smoke failed.'
      });
    }
  } else {
    try {
      await blockClassifierModelFetches(client);
      await clickButtonByText(client, 'Classify');
      const classifyAssetError = await waitForCondition(
        client,
        `(() => {
          const text = document.body?.innerText || '';
          if (text.includes('Classifier: Action needed')) {
            const detail = [...document.querySelectorAll('.result-panel.error pre')]
              .map((item) => item.textContent?.trim())
              .filter(Boolean)
              .join(' ');
            const readable = /Transformers\\.js|browser-local asset|model runtime issue|not an AI OS outage|model assets/i.test(detail);
            return {
              ok: readable,
              state: readable ? 'readable-error' : 'unclear-error',
              detail: detail || 'Classifier action needed, but no error detail was visible.'
            };
          }
          if (text.includes('Classifier: Result ready')) {
            return { ok: false, state: 'unexpected-success', detail: 'Classifier returned labels even though model URLs were blocked.' };
          }
          return { ok: false, state: 'waiting', detail: 'Waiting for classifier blocked-asset error.' };
        })()`,
        45_000
      );
      results.push({ id: 'ai-lab-classify', route: '/ai-lab', ...classifyAssetError });
    } catch (error) {
      results.push({
        id: 'ai-lab-classify',
        route: '/ai-lab',
        ok: false,
        state: 'error',
        detail: error instanceof Error ? error.message : 'Blocked classifier smoke failed.'
      });
    } finally {
      await unblockClassifierModelFetches(client);
    }
  }

  return results;
}

async function runPersistenceChecks(client, baseUrl) {
  await navigate(client, routeUrl(baseUrl, '/'));
  const results = [];
  for (const seed of persistenceSeeds) {
    await setLocalStorage(client, seed.storageKey, seed.value);
    results.push({
      id: seed.id,
      ...(await reloadAndFindValue(client, seed.route, seed.expectedValue, baseUrl, {
        skipApiUrlOverride: Boolean(seed.skipApiUrlOverride)
      }))
    });
  }
  return results;
}

function controlSummary(controls) {
  return controls
    .slice(0, 8)
    .map((control) => `${control.disabled ? 'disabled' : 'enabled'}:${truncate(control.label, 36)}`)
    .join('; ');
}

function printMarkdown(rows, persistence) {
  console.log('| Route | Title | Heading | Controls | Safe Actions | Issues | Control Preview |');
  console.log('| --- | --- | --- | --- | --- | --- | --- |');
  for (const row of rows) {
    const safe = row.safeAction.found
      ? `ok ${row.safeAction.matches.map((match) => `${match.fallbackFor ? 'blocked' : match.disabled ? 'disabled' : 'enabled'}:${match.fallbackFor ? `${match.fallbackFor}->${match.label}` : match.label}`).join(', ')}${row.safeAction.missingLabels.length ? `; missing ${row.safeAction.missingLabels.join(', ')}` : ''}`
      : `missing ${row.safeAction.missingLabels.join(', ') || 'safe action'}`;
    const coverage = `${row.snapshot.enabled} enabled / ${row.snapshot.disabled} disabled / ${row.snapshot.buttons} buttons / ${row.snapshot.links} links`;
    const issues = [
      row.titleOk ? '' : `title expected "${row.route.title}" got "${row.snapshot.title || 'MISSING'}"`,
      row.headingOk ? '' : `heading expected "${row.route.heading}" got "${row.snapshot.heading || 'MISSING'}"`,
      row.snapshot.rawNotFound ? 'raw Not Found' : '',
      row.snapshot.ambiguous ? `${row.snapshot.ambiguous} ambiguous controls` : '',
      row.snapshot.unexplainedDisabled ? `${row.snapshot.unexplainedDisabled} disabled controls lack explanation` : '',
      row.snapshot.issues?.join('; ') ?? ''
    ]
      .filter(Boolean)
      .join(' | ');
    console.log(
      `| ${row.route.path} | ${row.snapshot.title || 'MISSING'} | ${row.snapshot.heading || 'MISSING'} | ${coverage} | ${safe} | ${issues || 'ok'} | ${controlSummary(row.snapshot.controls)} |`
    );
  }
  console.log('');
  console.log('| Persistence Check | Route | Result | Observed Values |');
  console.log('| --- | --- | --- | --- |');
  for (const item of persistence) {
    console.log(`| ${item.id} | ${item.route} | ${item.ok ? 'ok' : `missing ${item.expectedValue}`} | ${item.values.map((value) => truncate(value, 45)).join('; ') || 'none'} |`);
  }
}

function printActionChecks(actions) {
  console.log('');
  console.log('| Hydrated Action Check | Route | Result | State | Detail |');
  console.log('| --- | --- | --- | --- | --- |');
  for (const item of actions) {
    console.log(`| ${item.id} | ${item.route} | ${item.ok ? 'ok' : 'check'} | ${item.state || 'n/a'} | ${truncate(item.detail, 120)} |`);
  }
}

async function main() {
  const browser = await findBrowser();
  const configuredBaseUrl = process.env.HUB_HYDRATED_URL || process.env.HUB_SMOKE_URL || '';
  const managedHub = configuredBaseUrl ? null : await startManagedHubServer();
  const baseUrl = configuredBaseUrl || managedHub.url;
  const port = await freePort();
  const profileDir = await mkdtemp(path.join(os.tmpdir(), 'mini-hub-hydrated-smoke-'));
  const browserProcess = spawn(browser, [
    '--headless=new',
    '--disable-background-networking',
    '--disable-default-apps',
    '--disable-extensions',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--no-sandbox',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    'about:blank'
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  let client;
  try {
    browserProcess.stderr?.on('data', (chunk) => {
      if (process.env.HUB_HYDRATED_DEBUG === '1') process.stderr.write(chunk);
    });
    await waitForJson(`http://127.0.0.1:${port}/json/version`);
    const pageWsUrl = await createPage(port);
    client = await CdpClient.connect(pageWsUrl);
    await client.send('Page.enable');
    await client.send('Runtime.enable');

    const rows = [];
    for (const route of routes) {
      await navigate(client, routeUrl(baseUrl, route.path));
      const snapshot = await readDomSnapshot(client);
      rows.push({
        route,
        snapshot,
        titleOk: titleMatches(route, snapshot.title),
        headingOk: headingMatches(route, snapshot.heading),
        safeAction: safeActionStatus(route, snapshot)
      });
    }
    const actionChecks = [
      ...(await runResearchActionChecks(client, baseUrl)),
      ...(await runResearchOnlineRecoveryChecks(client, baseUrl)),
      ...(await runAiOsOfflineActionGuardChecks(client, baseUrl)),
      ...(await runDeskWriteGuardChecks(client, baseUrl)),
      ...(await runProductivityCacheWriteGuardChecks(client, baseUrl)),
      ...(await runLocalServiceSideEffectGuardChecks(client, baseUrl)),
      ...(await runAiLabActionChecks(client, baseUrl))
    ];
    const persistence = await runPersistenceChecks(client, baseUrl);
    printMarkdown(rows, persistence);
    printActionChecks(actionChecks);

    const failures = rows.filter(
      (row) =>
        !row.titleOk ||
        !row.headingOk ||
        row.snapshot.rawNotFound ||
        row.snapshot.ambiguous ||
        row.snapshot.unexplainedDisabled ||
        !row.safeAction.found
    );
    const persistenceFailures = persistence.filter((item) => !item.ok);
    const actionFailures = actionChecks.filter((item) => !item.ok);
    if (failures.length || persistenceFailures.length || actionFailures.length) {
      console.error(
        `Mini Hub hydrated smoke found ${failures.length} route issue(s), ${persistenceFailures.length} persistence issue(s), and ${actionFailures.length} action issue(s).`
      );
      process.exitCode = 1;
    }
  } finally {
    client?.close();
    await stopProcessTree(browserProcess);
    await removeProfileDir(profileDir);
    await stopManagedProcess(managedHub?.child);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
