#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultLinkFile = path.join(repoRoot, 'remote-tunnel-link.txt');
const defaultResultFile = path.join(repoRoot, '.mini-hub-bridge', 'phone-tunnel-smoke.json');

const routes = [
  { id: 'settings', path: '/settings', heading: 'Settings' },
  { id: 'today', path: '/', heading: 'Attention Queue' },
  { id: 'activity', path: '/activity', heading: 'Activity' },
  { id: 'research', path: '/research', heading: 'Research Desk' },
  { id: 'ai-os', path: '/ai-os', heading: 'Ask AI OS' }
];

const endpointChecks = [
  { id: 'hub-api', label: 'Mini Hub API', path: '/api/health' },
  { id: 'ai-os', label: 'AI OS API', path: '/api/ai/health' },
  { id: 'macro-lab', label: 'Macro Lab API', path: '/api/macro-lab/health' },
  { id: 'ollama', label: 'Ollama', path: '/api/tags' }
];

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function linkFilePath() {
  return process.env.MINI_HUB_REMOTE_LINK_FILE || process.env.HUB_PHONE_REMOTE_LINK_FILE || defaultLinkFile;
}

function resultFilePath() {
  return process.env.HUB_PHONE_SMOKE_RESULT_FILE || defaultResultFile;
}

async function writeSmokeResult(result) {
  const file = resultFilePath();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify({ resultFile: file, ...result }, null, 2)}\n`, 'utf8');
  return file;
}

async function readRemoteLink() {
  const file = linkFilePath();
  const raw = await readFile(file, 'utf8').catch((error) => {
    throw new Error(`Could not read ${file}. Start the tunnel with pnpm bridge:tunnel:start first. ${error.message}`);
  });
  const link = raw.split(/\r?\n/u)[0]?.trim() ?? '';
  if (!link) throw new Error(`${file} is empty. Start the tunnel with pnpm bridge:tunnel:start first.`);
  const url = new URL(link);
  const token = url.searchParams.get('bridgeToken') || url.searchParams.get('gatewayToken') || '';
  if (!token) throw new Error(`${file} does not include a bridge token. Restart the tunnel with pnpm bridge:tunnel:start.`);
  return { file, link, url, token, origin: url.origin };
}

function setupUrl(remote) {
  const url = new URL('/settings', remote.origin);
  url.search = remote.url.search;
  return url.toString();
}

function routeUrl(remote, routePath) {
  return new URL(routePath, `${remote.origin}/`).toString();
}

function browserCandidates() {
  const explicit = [
    process.env.HUB_PHONE_BROWSER,
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
  throw new Error('No Chrome or Edge executable found. Set HUB_PHONE_BROWSER to a Chromium executable path.');
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
      // Chrome versions differ on /json/new.
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
  let result;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      result = await client.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true
      });
      break;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/Inspected target navigated or closed|Cannot find context with specified id|Execution context was destroyed/iu.test(message) || attempt === 2) {
        throw error;
      }
      await delay(250);
    }
  }
  if (result.exceptionDetails) {
    const detail = result.exceptionDetails.text || result.exceptionDetails.exception?.description || 'Runtime evaluation failed.';
    throw new Error(detail);
  }
  return result.result?.value;
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
}

async function fetchEndpoint(remote, check) {
  const url = new URL(check.path, remote.origin);
  const started = performance.now();
  try {
    const response = await fetch(url, {
      headers: { 'X-Mini-Hub-Bridge-Token': remote.token },
      signal: AbortSignal.timeout(15_000)
    });
    const text = await response.text();
    return {
      ...check,
      ok: response.ok,
      status: response.status,
      latencyMs: Math.round(performance.now() - started),
      detail: response.ok ? 'ok' : text.replace(/\s+/gu, ' ').trim().slice(0, 160)
    };
  } catch (error) {
    return {
      ...check,
      ok: false,
      status: 0,
      latencyMs: Math.round(performance.now() - started),
      detail: error instanceof Error ? error.message : 'fetch failed'
    };
  }
}

async function navigate(client, url) {
  const loaded = client.waitForEvent('Page.loadEventFired', 20_000).catch(() => null);
  await client.send('Page.navigate', { url });
  await loaded;
  await waitForHydratedPage(client);
}

async function waitForHydratedPage(client, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await snapshot(client);
    if (last.ready) return last;
    await delay(250);
  }
  throw new Error(`Timed out waiting for Mini Hub route to hydrate. Last state: ${JSON.stringify(last)}`);
}

async function snapshot(client) {
  return evaluate(
    client,
    `(() => {
      const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
      const text = clean(document.body?.innerText || '');
      const endpointsRaw = localStorage.getItem('miniHub.serviceEndpoints.v1') || '';
      let endpoints = {};
      try { endpoints = JSON.parse(endpointsRaw || '{}'); } catch {}
      return {
        ready: document.readyState !== 'loading' && Boolean(document.querySelector('h1') || text.includes('Not Found')),
        title: document.title,
        heading: clean(document.querySelector('h1')?.textContent || ''),
        text: text.slice(0, 5000),
        rawNotFound: /(^|\\n)Not Found($|\\n)/u.test(document.body?.innerText || ''),
        tokenSaved: Boolean(localStorage.getItem('miniHub.bridgeToken.v1')),
        endpoints,
        viewport: { width: window.innerWidth, height: window.innerHeight }
      };
    })()`
  );
}

async function clickButton(client, labelPart) {
  return evaluate(
    client,
    `(() => {
      const target = ${JSON.stringify(labelPart)}.toLowerCase();
      const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
      const button = [...document.querySelectorAll('button')]
        .find((item) => clean(item.innerText || item.textContent || item.getAttribute('aria-label') || item.getAttribute('title')).toLowerCase().includes(target));
      if (!button) return { ok: false, detail: 'button not found' };
      if (button.disabled) return { ok: false, detail: 'button disabled' };
      button.click();
      return { ok: true, detail: clean(button.innerText || button.textContent || '') };
    })()`
  );
}

async function waitForSettingsReadiness(client) {
  const clicked = await clickButton(client, 'Check Services');
  if (clicked.ok) await delay(250);
  const deadline = Date.now() + 25_000;
  let last = null;
  while (Date.now() < deadline) {
    last = await snapshot(client);
    const text = last.text || '';
    const hasFeatureWiring = text.includes('Feature Wiring');
    const hasTunnel = text.includes('Outbound tunnel readiness') || text.includes('Tunnel Live') || text.includes('Active HTTPS tunnel');
    const hasServices = ['Mini Hub API', 'AI OS API', 'Macro Lab', 'Ollama'].every((label) => text.includes(label));
    if (last.tokenSaved && hasFeatureWiring && hasTunnel && hasServices) {
      return { ok: true, clicked: clicked.detail || 'not clicked', snapshot: last };
    }
    await delay(500);
  }
  return { ok: false, clicked: clicked.detail || clicked.detail, snapshot: last };
}

function routeResult(route, page) {
  const expectedHeading = route.heading;
  const headingOk = page.heading === expectedHeading;
  const text = page.text || '';
  const serviceHintOk =
    route.id === 'settings' ||
    text.includes('Feature Wiring') ||
    text.includes('AI OS') ||
    text.includes('Research') ||
    text.includes('Activity') ||
    text.includes('Settings');
  return {
    ...route,
    expectedHeading,
    ok: Boolean(headingOk && !page.rawNotFound && page.tokenSaved && serviceHintOk),
    title: page.title,
    heading: page.heading,
    tokenSaved: page.tokenSaved,
    rawNotFound: page.rawNotFound,
    viewport: page.viewport
  };
}

function printEndpointTable(rows) {
  console.log('| Remote Endpoint | Status | HTTP | Latency | Detail |');
  console.log('| --- | --- | --- | --- | --- |');
  for (const row of rows) {
    console.log(`| ${row.label} | ${row.ok ? 'ok' : 'failed'} | ${row.status || 'n/a'} | ${row.latencyMs} ms | ${String(row.detail || '').replace(/\|/gu, '/')} |`);
  }
}

function printRouteTable(rows) {
  console.log('');
  console.log('| Phone Route | Result | Heading | Token | Viewport | Issue |');
  console.log('| --- | --- | --- | --- | --- | --- |');
  for (const row of rows) {
    const issue = [
      row.heading === row.expectedHeading ? '' : `heading expected ${row.expectedHeading || 'unknown'}`,
      row.rawNotFound ? 'raw Not Found' : '',
      row.tokenSaved ? '' : 'bridge token not saved'
    ]
      .filter(Boolean)
      .join('; ');
    console.log(
      `| ${row.path} | ${row.ok ? 'ok' : 'failed'} | ${row.heading || 'missing'} | ${row.tokenSaved ? 'saved' : 'missing'} | ${row.viewport?.width || '?'}x${row.viewport?.height || '?'} | ${issue || 'ok'} |`
    );
  }
}

async function runBrowserChecks(remote) {
  const browser = await findBrowser();
  const port = await freePort();
  const profileDir = await mkdtemp(path.join(os.tmpdir(), 'mini-hub-phone-smoke-'));
  const child = spawn(browser, [
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
  ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });

  let client;
  try {
    child.stderr?.on('data', (chunk) => {
      if (process.env.HUB_PHONE_DEBUG === '1') process.stderr.write(chunk);
    });
    await waitForJson(`http://127.0.0.1:${port}/json/version`);
    client = await CdpClient.connect(await createPage(port));
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 3,
      mobile: true
    });
    await client.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    await client.send('Network.enable');
    await client.send('Network.setUserAgentOverride', {
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
    });

    await navigate(client, setupUrl(remote));
    const settingsReadiness = await waitForSettingsReadiness(client);
    const routeRows = [];
    for (const route of routes) {
      await navigate(client, routeUrl(remote, route.path));
      routeRows.push(routeResult(route, await snapshot(client)));
    }
    return { settingsReadiness, routeRows };
  } finally {
    client?.close();
    await stopProcessTree(child);
    await rm(profileDir, { recursive: true, force: true }).catch(() => null);
  }
}

async function main() {
  const checkedAt = new Date().toISOString();
  const remote = await readRemoteLink();
  console.log(`Mini Hub phone tunnel smoke target: ${remote.origin}`);
  console.log(`Link file: ${remote.file}`);
  console.log('Bridge token: present (redacted)');
  console.log('');

  const endpointRows = await Promise.all(endpointChecks.map((check) => fetchEndpoint(remote, check)));
  printEndpointTable(endpointRows);

  const browserResult = await runBrowserChecks(remote);
  printRouteTable(browserResult.routeRows);

  const failures = [
    ...endpointRows.filter((row) => !row.ok).map((row) => `${row.label}: ${row.detail || row.status}`),
    ...(browserResult.settingsReadiness.ok ? [] : ['Settings did not show remote readiness with saved service state.']),
    ...browserResult.routeRows.filter((row) => !row.ok).map((row) => `${row.path}: heading=${row.heading || 'missing'}, token=${row.tokenSaved ? 'saved' : 'missing'}`)
  ];
  const resultFile = await writeSmokeResult({
    version: 1,
    checkedAt,
    ok: failures.length === 0,
    origin: remote.origin,
    linkFile: remote.file,
    endpoints: endpointRows.map((row) => ({
      id: row.id,
      label: row.label,
      ok: row.ok,
      status: row.status,
      latencyMs: row.latencyMs,
      detail: row.detail
    })),
    settings: {
      ok: browserResult.settingsReadiness.ok,
      clicked: browserResult.settingsReadiness.clicked || ''
    },
    routes: browserResult.routeRows.map((row) => ({
      id: row.id,
      path: row.path,
      ok: row.ok,
      heading: row.heading,
      expectedHeading: row.expectedHeading,
      tokenSaved: row.tokenSaved,
      viewport: row.viewport,
      rawNotFound: row.rawNotFound
    })),
    failures
  });

  if (failures.length) {
    console.error('');
    console.error(`Phone tunnel smoke found ${failures.length} issue(s):`);
    for (const failure of failures) console.error(`- ${failure}`);
    console.error(`Saved phone smoke result: ${resultFile}`);
    process.exitCode = 1;
  } else {
    console.log('');
    console.log('Phone tunnel smoke passed: endpoint health, mobile hydration, saved bridge token, and route handoff all look reachable.');
    console.log(`Saved phone smoke result: ${resultFile}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  writeSmokeResult({
    version: 1,
    checkedAt: new Date().toISOString(),
    ok: false,
    origin: '',
    endpoints: [],
    settings: { ok: false, clicked: '' },
    routes: [],
    failures: [error instanceof Error ? error.message : String(error)]
  }).catch(() => null);
  process.exitCode = 1;
});
