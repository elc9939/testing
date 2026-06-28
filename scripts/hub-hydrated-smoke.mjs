#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

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
      'Run Quick Search': ['Connect AI OS']
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

function routeUrl(baseUrl, routePath) {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const url = new URL(routePath.replace(/^\//u, ''), normalizedBase);
  if (process.env.HUB_HYDRATED_API_URL) {
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

async function fillFirstTextarea(client, value) {
  const result = await evaluate(
    client,
    `(() => {
      const textarea = document.querySelector('textarea');
      if (!textarea) return { ok: false, detail: 'No textarea found.' };
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

async function reloadAndFindValue(client, route, expectedValue, baseUrl) {
  await navigate(client, routeUrl(baseUrl, route));
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

async function runDeskWriteGuardChecks(client, baseUrl) {
  if (process.env.HUB_HYDRATED_DESK_WRITES === '1') return runDeskApiSaveChecks(client, baseUrl);

  const checks = [];

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
          detail: 'Add Job is enabled after required fields are filled; default smoke does not create persistent API records.'
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
          detail: 'Log Progress is enabled after required fields are filled; default smoke does not create persistent API records.'
        };
      })()`,
      12_000
    ))
  });

  return checks;
}

async function runDeskApiSaveChecks(client, baseUrl) {
  const checks = [];

  await navigate(client, routeUrl(baseUrl, '/desk/career'));
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
    await navigate(client, routeUrl(baseUrl, '/desk/career'));
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
  }

  await navigate(client, routeUrl(baseUrl, '/desk/study'));
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
    await navigate(client, routeUrl(baseUrl, '/desk/study'));
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

  if (process.env.HUB_HYDRATED_AI_LAB_CLASSIFY !== '0') {
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
    results.push({
      id: 'ai-lab-classify',
      route: '/ai-lab',
      ok: true,
      state: 'skipped',
      detail: 'Skipped because HUB_HYDRATED_AI_LAB_CLASSIFY=0. Default hydrated smoke runs the real Transformers.js classify path.'
    });
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
        titleOk: titleMatches(route, snapshot.title),
        headingOk: headingMatches(route, snapshot.heading),
        safeAction: safeActionStatus(route, snapshot)
      });
    }
    const actionChecks = [
      ...(await runResearchActionChecks(client, baseUrl)),
      ...(await runDeskWriteGuardChecks(client, baseUrl)),
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
