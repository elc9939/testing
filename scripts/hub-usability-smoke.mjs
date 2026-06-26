#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const routes = [
  {
    id: 'today',
    path: '/',
    source: 'apps/hub/src/routes/+page.svelte',
    service: 'Mini Hub API + optional Google/AI/Macro sources',
    safeAction: 'Refresh Today; blocked source rows should remain partial, not page-fatal.'
  },
  {
    id: 'activity',
    path: '/activity',
    source: 'apps/hub/src/routes/activity/+page.svelte',
    service: 'AI OS API, Passive Tasks, Macro Lab',
    safeAction: 'Refresh Activity; source failures should show as partial/stale rows.'
  },
  {
    id: 'productivity',
    path: '/productivity',
    source: 'apps/hub/src/routes/productivity/+page.svelte',
    service: 'Mini Hub API + Google OAuth',
    safeAction: 'Refresh overview; writes stay disabled unless API and Google are ready.'
  },
  {
    id: 'career',
    path: '/desk/career',
    source: 'apps/hub/src/routes/desk/career/+page.svelte',
    service: 'Mini Hub API + browser PGlite cache',
    safeAction: 'Filter/export; add/edit requires online Mini Hub API.'
  },
  {
    id: 'study',
    path: '/desk/study',
    source: 'apps/hub/src/routes/desk/study/+page.svelte',
    service: 'Mini Hub API + browser PGlite cache',
    safeAction: 'Review progress; logging requires online Mini Hub API.'
  },
  {
    id: 'analytics',
    path: '/analytics',
    source: 'apps/hub/src/routes/analytics/+page.svelte',
    service: 'Browser cache + optional Mini Hub sync',
    safeAction: 'Refresh cache-backed analytics; healthy-empty is acceptable.'
  },
  {
    id: 'research',
    path: '/research',
    source: 'apps/hub/src/routes/research/+page.svelte',
    service: 'AI OS API',
    safeAction: 'Run sample goal only when AI OS is connected; otherwise Connect AI OS is disabled/actionable.'
  },
  {
    id: 'ai-lab',
    path: '/ai-lab',
    source: 'apps/hub/src/routes/ai-lab/+page.svelte',
    service: 'Browser-local Transformers.js and Tree-sitter assets',
    safeAction: 'Classify sample text and parse sample code independently.'
  },
  {
    id: 'ai-os',
    path: '/ai-os',
    source: 'apps/hub/src/routes/ai-os/+page.svelte',
    service: 'AI OS API',
    safeAction: 'Refresh status; work buttons stay disabled until AI OS status is loaded.'
  },
  {
    id: 'macro-lab',
    path: '/macro-lab',
    source: 'apps/hub/src/routes/macro-lab/+page.svelte',
    service: 'Macro Lab API',
    safeAction: 'Refresh state; panic/run/reset stay disabled until Macro Lab state is known.'
  },
  {
    id: 'passive-tasks',
    path: '/passive-tasks',
    source: 'apps/hub/src/routes/passive-tasks/+page.svelte',
    service: 'Mini Hub API passive engine',
    safeAction: 'Refresh snapshot; run controls stay disabled until snapshot/settings load.'
  },
  {
    id: 'settings',
    path: '/settings',
    source: 'apps/hub/src/routes/settings/+page.svelte',
    service: 'Mini Hub API, AI OS API, Macro Lab API, browser storage',
    safeAction: 'Refresh Feature Wiring; save endpoint/theme changes only when target storage is ready.'
  },
  {
    id: 'games',
    path: '/games',
    source: 'apps/hub/src/routes/games/+page.svelte',
    service: 'Browser + optional Mini Hub API saves',
    safeAction: 'Open launcher entries; save buttons should show offline/read-only state when API is unavailable.'
  }
];

function stripSvelte(value) {
  return value.replace(/\{[^}]*\}/gu, '').replace(/\s+/gu, ' ').trim();
}

function extract(pattern, source) {
  const match = source.match(pattern);
  return match ? stripSvelte(match[1] ?? '') : '';
}

function count(pattern, source) {
  return [...source.matchAll(pattern)].length;
}

async function sourceSnapshot(route) {
  const sourcePath = path.join(root, route.source);
  const source = await readFile(sourcePath, 'utf8');
  const title = extract(/<title>([\s\S]*?)<\/title>/iu, source);
  const heading = extract(/<h1[^>]*>([\s\S]*?)<\/h1>/iu, source);
  const buttons = count(/<button\b/giu, source);
  const disabled = count(/\bdisabled(?:=|\s|>)/giu, source);
  const errors = count(/(?:error-message|error-banner|warning-panel|offline-banner|service-card|connection-card)/giu, source);
  const settingsLinks = count(/routeMap\.settings|Open Settings|href=\{hubHref\(routeMap\.settings\)\}/giu, source);
  return {
    ...route,
    title,
    heading,
    buttons,
    disabled,
    errors,
    settingsLinks,
    sourceOk: Boolean(title && heading)
  };
}

async function fetchRoute(baseUrl, routePath) {
  const url = new URL(routePath.replace(/^\//u, ''), baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    return {
      url,
      status: response.status,
      ok: response.ok,
      title: extract(/<title>([\s\S]*?)<\/title>/iu, text),
      contentType: response.headers.get('content-type') ?? ''
    };
  } catch (error) {
    return {
      url,
      status: 0,
      ok: false,
      title: '',
      contentType: '',
      error: error instanceof Error ? error.message : 'fetch failed'
    };
  } finally {
    clearTimeout(timer);
  }
}

function printMarkdown(rows, liveRows) {
  console.log('| Route | Title | Heading | Buttons | Disabled refs | Service | Safe QA action | Live |');
  console.log('| --- | --- | --- | ---: | ---: | --- | --- | --- |');
  for (const row of rows) {
    const live = liveRows.get(row.id);
    const liveText = live ? `${live.ok ? 'ok' : 'check'} ${live.status} ${live.error ?? ''}`.trim() : 'not run';
    console.log(
      `| ${row.path} | ${row.title || 'MISSING'} | ${row.heading || 'MISSING'} | ${row.buttons} | ${row.disabled} | ${row.service} | ${row.safeAction} | ${liveText} |`
    );
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const baseUrl = process.env.HUB_SMOKE_URL ?? '';
  const rows = await Promise.all(routes.map(sourceSnapshot));
  const liveRows = new Map();
  if (baseUrl) {
    for (const route of routes) {
      liveRows.set(route.id, await fetchRoute(baseUrl, route.path));
    }
  }

  if (args.has('--json')) {
    console.log(JSON.stringify({ checkedAt: new Date().toISOString(), baseUrl: baseUrl || null, routes: rows, live: Object.fromEntries(liveRows) }, null, 2));
  } else {
    printMarkdown(rows, liveRows);
  }

  const failures = rows.filter((row) => !row.sourceOk);
  const liveFailures = [...liveRows.values()].filter((row) => !row.ok);
  if (failures.length || liveFailures.length) {
    console.error(`Mini Hub usability smoke found ${failures.length} source issue(s) and ${liveFailures.length} live route issue(s).`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
