#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const routes = [
  { id: 'today', path: '/', heading: 'Attention Queue', safeActionLabels: ['Refresh'] },
  { id: 'activity', path: '/activity', heading: 'Activity', safeActionLabels: ['Refresh'] },
  { id: 'productivity', path: '/productivity', heading: 'Productivity Hub', safeActionLabels: ['Refresh'] },
  {
    id: 'google-oauth-callback',
    path: '/oauth/google/callback',
    heading: 'Google OAuth',
    alternateHeadings: ['Productivity Hub'],
    safeActionLabels: ['Open Productivity', 'Connect Google']
  },
  { id: 'career', path: '/desk/career', heading: 'Career', safeActionLabels: ['Export', 'Add Job'] },
  { id: 'study', path: '/desk/study', heading: 'Study', safeActionLabels: ['Log'] },
  { id: 'analytics', path: '/analytics', heading: 'Local Insights', safeActionLabels: ['Refresh'] },
  { id: 'research', path: '/research', heading: 'Research Desk', safeActionLabels: ['Run'] },
  { id: 'ai-lab', path: '/ai-lab', heading: 'Browser Experiments', safeActionLabels: ['Restore Samples', 'Classify', 'Parse'] },
  { id: 'ai-os', path: '/ai-os', heading: 'Ask AI OS', safeActionLabels: ['Refresh', 'Do it'] },
  { id: 'macro-lab', path: '/macro-lab', heading: 'Macro Lab', safeActionLabels: ['Refresh', 'Panic', 'Dry Run', 'Run Confirmed'] },
  { id: 'passive-tasks', path: '/passive-tasks', heading: 'Passive Tasks', safeActionLabels: ['Refresh', 'Run Due', 'Startup', 'Idle'] },
  { id: 'settings', path: '/settings', heading: 'Workspace', safeActionLabels: ['Check Services', 'Sync Now'] },
  { id: 'games', path: '/games', heading: 'Play Surfaces', safeActionLabels: ['Open'] },
  { id: 'stick-arena-lab', path: '/games/stick-arena-lab', heading: 'Ability Lab', safeActionLabels: ['Reset', 'Save Run', 'Open Settings'] }
];

const persistenceSeeds = [
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
      if (attempt === 5) throw error;
      await delay(250);
    }
  }
}

function routeUrl(baseUrl, routePath) {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return new URL(routePath.replace(/^\//u, ''), normalizedBase).toString();
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
        values: [...document.querySelectorAll('input, textarea, select')].map((el) => clean(el.value)).filter(Boolean).slice(0, 30),
        issues: [...new Set([...bodyText.matchAll(issuePattern)].map((match) => clean(match[0])).filter(Boolean))].slice(0, 5)
      };
    })()`
  );
}

function safeActionStatus(route, controls) {
  const labels = route.safeActionLabels ?? [];
  const foundLabels = labels.filter((label) =>
    controls.some((control) => `${control.label} ${control.title}`.toLowerCase().includes(label.toLowerCase()))
  );
  return {
    found: foundLabels.length > 0,
    foundLabels,
    missingLabels: labels.filter((label) => !foundLabels.includes(label))
  };
}

function headingMatches(route, heading) {
  return [route.heading, ...(route.alternateHeadings ?? [])].includes(heading);
}

async function setLocalStorage(client, key, value) {
  await evaluate(client, `localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify(value))})`);
}

async function reloadAndFindValue(client, route, expectedValue, baseUrl) {
  await navigate(client, routeUrl(baseUrl, route));
  await client.send('Page.reload', { ignoreCache: true });
  await waitForHydration(client);
  await delay(500);
  const snapshot = await readDomSnapshot(client);
  return {
    ok: snapshot.values.some((value) => value.includes(expectedValue)),
    route,
    expectedValue,
    values: snapshot.values.slice(0, 8)
  };
}

async function runPersistenceChecks(client, baseUrl) {
  await navigate(client, routeUrl(baseUrl, '/'));
  const results = [];
  for (const seed of persistenceSeeds) {
    await setLocalStorage(client, seed.storageKey, seed.value);
    results.push({
      id: seed.id,
      ...(await reloadAndFindValue(client, seed.route, seed.expectedValue, baseUrl))
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
  console.log('| Route | Heading | Controls | Safe Actions | Issues | Control Preview |');
  console.log('| --- | --- | --- | --- | --- | --- |');
  for (const row of rows) {
    const safe = row.safeAction.found
      ? `ok ${row.safeAction.foundLabels.join(', ')}${row.safeAction.missingLabels.length ? `; missing ${row.safeAction.missingLabels.join(', ')}` : ''}`
      : `missing ${row.safeAction.missingLabels.join(', ') || 'safe action'}`;
    const coverage = `${row.snapshot.enabled} enabled / ${row.snapshot.disabled} disabled / ${row.snapshot.buttons} buttons / ${row.snapshot.links} links`;
    const issues = [
      row.headingOk ? '' : `heading expected "${row.route.heading}" got "${row.snapshot.heading || 'MISSING'}"`,
      row.snapshot.rawNotFound ? 'raw Not Found' : '',
      row.snapshot.ambiguous ? `${row.snapshot.ambiguous} ambiguous controls` : '',
      row.snapshot.unexplainedDisabled ? `${row.snapshot.unexplainedDisabled} disabled controls lack explanation` : '',
      row.snapshot.issues?.join('; ') ?? ''
    ]
      .filter(Boolean)
      .join(' | ');
    console.log(
      `| ${row.route.path} | ${row.snapshot.heading || 'MISSING'} | ${coverage} | ${safe} | ${issues || 'ok'} | ${controlSummary(row.snapshot.controls)} |`
    );
  }
  console.log('');
  console.log('| Persistence Check | Route | Result | Observed Values |');
  console.log('| --- | --- | --- | --- |');
  for (const item of persistence) {
    console.log(`| ${item.id} | ${item.route} | ${item.ok ? 'ok' : `missing ${item.expectedValue}`} | ${item.values.map((value) => truncate(value, 45)).join('; ') || 'none'} |`);
  }
}

async function main() {
  const baseUrl = process.env.HUB_HYDRATED_URL || process.env.HUB_SMOKE_URL || 'http://127.0.0.1:5173/';
  const browser = await findBrowser();
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
        headingOk: headingMatches(route, snapshot.heading),
        safeAction: safeActionStatus(route, snapshot.controls)
      });
    }
    const persistence = await runPersistenceChecks(client, baseUrl);
    printMarkdown(rows, persistence);

    const failures = rows.filter(
      (row) =>
        !row.headingOk ||
        row.snapshot.rawNotFound ||
        row.snapshot.ambiguous ||
        row.snapshot.unexplainedDisabled ||
        !row.safeAction.found
    );
    const persistenceFailures = persistence.filter((item) => !item.ok);
    if (failures.length || persistenceFailures.length) {
      console.error(`Mini Hub hydrated smoke found ${failures.length} route issue(s) and ${persistenceFailures.length} persistence issue(s).`);
      process.exitCode = 1;
    }
  } finally {
    client?.close();
    if (!browserProcess.killed) browserProcess.kill();
    await new Promise((resolve) => {
      if (browserProcess.exitCode !== null) {
        resolve();
        return;
      }
      const timer = setTimeout(resolve, 2000);
      browserProcess.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    await removeProfileDir(profileDir);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
