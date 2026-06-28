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
    safeAction: 'Refresh Today; blocked source rows should remain partial, not page-fatal.',
    sampleInput: 'No input. Click Refresh from the Today header.',
    expectedResult: 'Attention rows refresh, or partial source cards explain which local/Google service is offline and link to Settings.',
    reloadProof: 'Reload the route; cached attention/source health should remain visible while live sources refresh.',
    safeActionLabels: ['Refresh'],
    expectedBlockedState: 'Partial source rows and Settings links, not a blank cockpit.',
    persistence: 'Attention snapshot should reload from cache while live sources refresh.',
    expectedStates: ['loading', 'partial', 'cached', 'recovery'],
    requiredMarkers: [
      { label: 'partial source issues', text: 'sourceIssues' },
      { label: 'setup warning panels', text: 'warning-panel' },
      { label: 'unavailable source state', text: "status: 'unavailable'" },
      { label: 'recommendation action gating', text: 'modeActionDisabled' },
      { label: 'save and recovery strip', text: 'Save & Recovery' }
    ]
  },
  {
    id: 'activity',
    path: '/activity',
    source: 'apps/hub/src/routes/activity/+page.svelte',
    service: 'AI OS API, Passive Tasks, Macro Lab',
    safeAction: 'Refresh Activity; source failures should show as partial/stale rows.',
    sampleInput: 'No input. Click Refresh on Activity.',
    expectedResult: 'Active, paused, failed, stale, cached, and dismissed records stay grouped; failed sources do not hide cached work.',
    reloadProof: 'Dismiss a non-active item if present, reload, then use Restore dismissed records to recover it in this browser.',
    safeActionLabels: ['Refresh'],
    expectedBlockedState: 'Source strip explains timeout/offline/cached state per backend.',
    persistence: 'Durable runs/jobs/history should reappear after refresh or route changes.',
    expectedStates: ['loading', 'offline', 'cached', 'recovery'],
    requiredMarkers: [
      { label: 'source failure list', text: 'sourceFailures' },
      { label: 'expected source rows', text: 'expectedActivitySources' },
      { label: 'passive source id alignment', text: "{ id: 'passive', label: 'Passive Tasks' }" },
      { label: 'source health rows', text: 'sourceHealthRows' },
      { label: 'checking source state', text: 'checking source status' },
      { label: 'compact source diagnostics', text: 'compactActivitySourceError' },
      { label: 'source detail tooltip', text: 'sourceHealthTitle' },
      { label: 'no source snapshot state', text: 'No source snapshot yet; refresh Activity or open Settings.' },
      { label: 'cached records state', text: 'showing cached records from' },
      { label: 'offline empty state', text: 'No live activity loaded from reachable sources.' },
      { label: 'recovery model strip', text: 'Activity recovery model' },
      { label: 'cancel confirmation', text: 'asks for confirmation before stopping active work' },
      { label: 'settings recovery link', text: "href={hubHref('/settings')}" }
    ]
  },
  {
    id: 'productivity',
    path: '/productivity',
    source: 'apps/hub/src/routes/productivity/+page.svelte',
    service: 'Mini Hub API + Google OAuth',
    safeAction: 'Refresh overview; writes stay disabled unless API and Google are ready.',
    sampleInput: 'No input. Click Refresh overview, or Connect/Add Google only when intentionally testing OAuth.',
    expectedResult: 'Cached mail/calendar remain readable; Gmail/calendar writes stay disabled until Mini Hub API and Google are connected.',
    reloadProof: 'Reload after selecting an account/filter; cached productivity state should rehydrate before live refresh completes.',
    safeActionLabels: ['Refresh', 'Connect Google', 'Add Google Account'],
    expectedBlockedState: 'Cached mail/calendar can show; OAuth and write buttons route to setup or stay disabled.',
    persistence: 'Local snapshot, filters, and selected Google cache should reload from browser storage.',
    expectedStates: ['loading', 'cached', 'setup', 'disabled'],
    requiredMarkers: [
      { label: 'write gating', text: 'productivityWriteDisabled' },
      { label: 'write mode summary', text: 'productivityWriteStatus = productivityWriteStateLabel()' },
      { label: 'read mode summary', text: 'productivityReadStatus = productivityReadStateLabel()' },
      { label: 'cached read-only state', text: 'Cached read-only' },
      { label: 'api offline write detail', text: 'OAuth, Gmail, and Calendar writes need the local API' },
      { label: 'google setup write detail', text: 'Use Connect Google or Add Google Account before sending mail' },
      { label: 'calendar event disabled title', text: 'calendarEventBlockTitle' },
      { label: 'calendar move confirmation', text: 'Calendar move skipped.' },
      { label: 'offline cache banner', text: 'offline-banner' },
      { label: 'cached productivity wording', text: 'cached productivity data can stay visible' },
      { label: 'OAuth gating', text: 'googleConnectDisabled' }
    ]
  },
  {
    id: 'google-oauth-callback',
    path: '/oauth/google/callback',
    source: 'apps/hub/src/routes/oauth/google/callback/+page.svelte',
    service: 'Mini Hub API Google OAuth exchange',
    safeAction: 'Open Productivity if the popup/redirect handoff does not complete automatically.',
    sampleInput: 'Open the callback without code/state to verify it returns to Productivity with a missing-code message instead of stranding the user.',
    expectedResult: 'OAuth completion posts to the opener or redirects back to the original hub; fallback link remains visible while the callback is finishing.',
    reloadProof: 'Reloading the callback should still finish into Productivity with either connected or actionable error state.',
    safeActionLabels: ['Open Productivity'],
    expectedBlockedState: 'Missing code/state, OAuth errors, or exchange failures return to Productivity with an actionable message.',
    persistence: 'Google grants live in the local Hub API; the callback preserves same-origin return state across hosted/local handoffs.',
    expectedStates: ['loading', 'error', 'setup'],
    requiredMarkers: [
      { label: 'callback heading', text: '<h1>Google OAuth</h1>' },
      { label: 'fallback productivity link', text: 'Open Productivity' },
      { label: 'fallback link title', text: 'Return to Productivity if Google OAuth does not redirect automatically.' },
      { label: 'state return decoder', text: 'googleOAuthStateReturnTo' },
      { label: 'same-hub redirect resolver', text: 'googleOAuthRedirectForCurrentHub' },
      { label: 'stored return target', text: 'storedReturnTo' },
      { label: 'opener handoff', text: 'window.opener.postMessage' },
      { label: 'missing code state', text: 'missing-code' },
      { label: 'usable authorization code wording', text: 'Google OAuth did not return a usable authorization code.' }
    ]
  },
  {
    id: 'career',
    path: '/desk/career',
    source: 'apps/hub/src/routes/desk/career/+page.svelte',
    service: 'Mini Hub API + browser PGlite cache',
    safeAction: 'Filter/export; add/edit requires online Mini Hub API.',
    sampleInput: 'Type a harmless filter such as "test"; click Scan or Export. Only add a QA job when Mini Hub API is online.',
    expectedResult: 'Filter state and legacy scan/export status are explicit; add/edit/delete controls explain offline read-only state.',
    reloadProof: 'Reload after changing the filter; the browser should report reloaded Career filters. API-backed jobs should reappear from cache/API.',
    safeActionLabels: ['Export', 'Add Job'],
    expectedBlockedState: 'Offline read-only explains cached jobs and disables saves.',
    persistence: 'Jobs, filters, save confirmations, and exports should survive or clearly report reload from API/cache/browser storage.',
    expectedStates: ['offline', 'cached', 'recovery', 'disabled'],
    requiredMarkers: [
      { label: 'offline read-only banner', text: 'Offline: cached jobs are readable, saving is disabled.' },
      { label: 'view storage key', text: 'careerViewStorageKey' },
      { label: 'save title helper', text: 'careerSaveTitle' },
      { label: 'delete confirmation', text: 'Career delete skipped.' },
      { label: 'saved/reloaded feedback', text: 'success-banner' }
    ]
  },
  {
    id: 'study',
    path: '/desk/study',
    source: 'apps/hub/src/routes/desk/study/+page.svelte',
    service: 'Mini Hub API + browser PGlite cache',
    safeAction: 'Review progress; logging requires online Mini Hub API.',
    sampleInput: 'Choose a quick label/minutes. Only click Log Progress when Mini Hub API is online; otherwise inspect disabled titles.',
    expectedResult: 'Study progress and analytics update after a save, or offline read-only explains why logging is disabled.',
    reloadProof: 'Reload after changing quick-log defaults or filters; the browser should report reloaded Study view/defaults.',
    safeActionLabels: ['Log'],
    expectedBlockedState: 'Offline read-only explains cached sessions and disables logging.',
    persistence: 'Logged sessions, filters, quick-log defaults, and analytics should reload from API/cache/browser storage.',
    expectedStates: ['offline', 'cached', 'recovery', 'disabled'],
    requiredMarkers: [
      { label: 'offline read-only banner', text: 'Offline: cached study logs are readable, saving is disabled.' },
      { label: 'view storage key', text: 'studyViewStorageKey' },
      { label: 'save title helper', text: 'studySaveTitle' },
      { label: 'delete confirmation', text: 'Study delete skipped.' },
      { label: 'saved/reloaded feedback', text: 'success-banner' }
    ]
  },
  {
    id: 'analytics',
    path: '/analytics',
    source: 'apps/hub/src/routes/analytics/+page.svelte',
    service: 'Browser cache + optional Mini Hub sync',
    safeAction: 'Refresh cache-backed analytics; healthy-empty is acceptable.',
    sampleInput: 'No input. Click Refresh.',
    expectedResult: 'Analytics either render from cached Career/Study/game data or show a distinct healthy-empty/offline/cache-error state.',
    reloadProof: 'Reload after Career/Study changes; charts and counts should recompute from the cache or explain why data is unavailable.',
    safeActionLabels: ['Refresh'],
    expectedBlockedState: 'Loading, healthy-empty, offline, and cache-error states are distinct.',
    persistence: 'Charts should recompute from cached Career/Study/game data after reload.',
    expectedStates: ['loading', 'offline', 'empty', 'error'],
    requiredMarkers: [
      { label: 'cached/offline state', text: "viewState === 'offline'" },
      { label: 'healthy empty state', text: 'Healthy Empty' },
      { label: 'refresh failure state', text: 'Refresh Failed' },
      { label: 'refresh busy gate', text: 'refreshBusy' },
      { label: 'cache status row', text: 'Analytics cache status' }
    ]
  },
  {
    id: 'research',
    path: '/research',
    source: 'apps/hub/src/routes/research/+page.svelte',
    service: 'AI OS API',
    safeAction: 'Run sample goal only when AI OS is connected; otherwise Connect AI OS is disabled/actionable.',
    sampleInput: 'Goal: "Compare two sources about local AI model routing and list open questions." Keep depth/pages small.',
    expectedResult: 'Offline AI OS shows one service card and no fake run; online AI OS queues a run, polls progress, and keeps the selected report visible.',
    reloadProof: 'Navigate away and back or reload; draft goal/options/seed URLs and selected/latest active run should restore.',
    safeActionLabels: ['Run', 'Connect AI OS', 'Retry Service'],
    expectedBlockedState: 'One compact AI OS setup card; no fake run appears when offline.',
    persistence: 'Draft goal/options/seed URLs, selected report, loaded monitor, and latest active run should restore after navigation.',
    expectedStates: ['loading', 'offline', 'setup', 'recovery', 'disabled'],
    requiredMarkers: [
      { label: 'compact service issue', text: 'serviceIssue = compactResearchServiceIssue' },
      { label: 'AI OS unavailable gate', text: 'aiOsUnavailable' },
      { label: 'initial service probe', text: 'serviceProbePending' },
      { label: 'run blocked reason', text: 'researchRunBlockedReason = researchRunDisabledReason' },
      { label: 'offline reports empty state', text: 'Reports are unavailable until AI OS is connected' },
      { label: 'checking service card', text: 'Checking AI OS service' },
      { label: 'selected run recovery', text: 'selectedRunId: selectedRun?.id ?? persistedRunId' },
      { label: 'offline monitor empty state', text: 'Topic monitors are unavailable until AI OS is connected' },
      { label: 'source library gating', text: 'sourceLibrarySearchDisabled' },
      { label: 'offline source empty state', text: 'Source Library is unavailable until AI OS is connected' },
      { label: 'research cancel prompt', text: 'Research cancellation skipped.' },
      { label: 'export setup routing', text: 'reportExportHref' }
    ]
  },
  {
    id: 'ai-lab',
    path: '/ai-lab',
    source: 'apps/hub/src/routes/ai-lab/+page.svelte',
    service: 'Browser-local Transformers.js and Tree-sitter assets',
    safeAction: 'Restore samples, then classify sample text and parse sample code independently.',
    sampleInput: 'Click Restore Samples, then Classify. Parse sample code: "function add(a, b) { return a + b; }" is equivalent to the bundled sample shape.',
    expectedResult: 'Classify and Parse show independent loading/result/error states; model or WASM failures are local to that panel.',
    reloadProof: 'Reload and rerun each sample; AI Lab should work without AI OS and should not lose backend work because it has none.',
    safeActionLabels: ['Restore Samples', 'Classify', 'Parse'],
    expectedBlockedState: 'Asset/model failures show in the relevant classify or parse panel only.',
    persistence: 'Sample inputs can be rerun without AI OS; no backend work should disappear.',
    expectedStates: ['loading', 'error', 'browser-local', 'ready'],
    requiredMarkers: [
      { label: 'independent classify busy state', text: 'classifyBusy' },
      { label: 'independent parse busy state', text: 'parseBusy' },
      { label: 'classify input lock title', text: 'classifyInputTitle' },
      { label: 'parse input lock title', text: 'parseInputTitle' },
      { label: 'sample restore control', text: 'restoreAiLabSamples' },
      { label: 'browser-local capability status', text: 'AI Lab local capability status' },
      { label: 'asset failure helper', text: 'aiLabAssetErrorDetail' },
      { label: 'browser draft status', text: 'draftStatus' },
      { label: 'result panels', text: 'result-grid' }
    ]
  },
  {
    id: 'ai-os',
    path: '/ai-os',
    source: 'apps/hub/src/routes/ai-os/+page.svelte',
    service: 'AI OS API',
    safeAction: 'Refresh status; work buttons stay disabled until AI OS status is loaded.',
    sampleInput: 'No input for refresh. For command bar, use a harmless read-only request such as "check AI status".',
    expectedResult: 'AI OS offline is a service state with Settings recovery; online work logs provider/model/cost/latency and gates writes.',
    reloadProof: 'Reload after a job/benchmark/tool call; durable AI OS jobs, logs, and benchmarks should rehydrate from AI OS storage.',
    safeActionLabels: ['Refresh', 'Do it'],
    expectedBlockedState: 'Unavailable AI OS is a service state, not a whole-app failure.',
    persistence: 'Jobs, usage, benchmarks, and tool logs should reload from AI OS storage.',
    expectedStates: ['loading', 'offline', 'setup', 'disabled'],
    requiredMarkers: [
      { label: 'AI OS action gate', text: 'aiOsActionBlocked' },
      { label: 'startup checking state', text: "state === 'checking'" },
      { label: 'startup checking summary', text: 'Checking AI OS' },
      { label: 'connection card', text: 'connection-card' },
      { label: 'settings recovery link', text: 'Open Settings' },
      { label: 'warmup gate', text: 'warmupBlockedReason' },
      { label: 'job cancel gate', text: 'jobCancelBlockedReason' },
      { label: 'job cancel prompt', text: 'AI OS job cancellation skipped.' }
    ]
  },
  {
    id: 'macro-lab',
    path: '/macro-lab',
    source: 'apps/hub/src/routes/macro-lab/+page.svelte',
    service: 'Macro Lab API',
    safeAction: 'Refresh state; panic/reset/confirmed run stay disabled until Macro Lab state is known.',
    sampleInput: 'No input. Click Refresh. Use Dry Run only on a safe macro when Macro Lab is ready.',
    expectedResult: 'Panic/reset/run controls stay disabled until Macro Lab state is known; dry-run/run history reports success or setup errors.',
    reloadProof: 'Reload after a dry run; run history and selected macro state should reappear from Macro Lab storage.',
    safeActionLabels: ['Refresh', 'Panic', 'Dry Run', 'Run Confirmed'],
    expectedBlockedState: 'Panic/reset/run controls are disabled until Macro Lab state is known.',
    persistence: 'Run history and trigger status should reload from Macro Lab storage.',
    expectedStates: ['loading', 'offline', 'disabled'],
    requiredMarkers: [
      { label: 'service readiness state', text: 'macroServiceReady' },
      { label: 'macro control gate', text: 'macroControlDisabled' },
      { label: 'connection card', text: 'connection-card' },
      { label: 'compact service card', text: 'service-card' },
      { label: 'confirmed run prompt', text: 'confirmMacroSideEffectRun' },
      { label: 'history unavailable state', text: 'Run history is unavailable until Macro Lab responds.' }
    ]
  },
  {
    id: 'passive-tasks',
    path: '/passive-tasks',
    source: 'apps/hub/src/routes/passive-tasks/+page.svelte',
    service: 'Mini Hub API passive engine',
    safeAction: 'Refresh snapshot; run controls stay disabled until snapshot/settings load.',
    sampleInput: 'No input. Click Refresh. Run Due/Startup/Idle only after the worker snapshot and settings are loaded.',
    expectedResult: 'Passive run controls are gated while loading/offline; worker state, digest, and source health explain unknown/empty states.',
    reloadProof: 'Reload after a passive run or settings save; worker state, last digest, and run history should return from backend/cache.',
    safeActionLabels: ['Refresh', 'Run Due', 'Startup', 'Idle'],
    expectedBlockedState: 'Run Due/Startup/Idle stay disabled until worker snapshot is loaded.',
    persistence: 'Worker state, last digest, and run history should reload from backend/cache.',
    expectedStates: ['loading', 'offline', 'empty', 'disabled', 'recovery'],
    requiredMarkers: [
      { label: 'service readiness state', text: 'passiveServiceReady' },
      { label: 'write gating', text: 'passiveWriteDisabled' },
      { label: 'service card', text: 'service-card' },
      { label: 'offline wording', text: 'Passive Tasks API unavailable' },
      { label: 'passive cancel prompt', text: 'Passive task cancellation skipped.' },
      { label: 'source health empty state', text: 'Source health appears after passive tasks are registered.' }
    ]
  },
  {
    id: 'settings',
    path: '/settings',
    source: 'apps/hub/src/routes/settings/+page.svelte',
    service: 'Mini Hub API, AI OS API, Macro Lab API, browser storage',
    safeAction: 'Refresh Feature Wiring; save endpoint/theme changes only when target storage is ready.',
    sampleInput: 'No destructive input. Click Check Services and inspect Feature Wiring/Data & Recovery.',
    expectedResult: 'Each feature row reports working/offline/misconfigured/setup-needed with endpoint and fix action.',
    reloadProof: 'Change a harmless setting such as theme/mode, reload, and confirm browser/API-backed settings rehydrate visibly.',
    safeActionLabels: ['Check Services', 'Run Autotune', 'Retry Profile', 'Save Passive Settings', 'Retry Passive', 'Save Service URLs', 'Sync Now'],
    expectedBlockedState: 'Feature Wiring table shows missing endpoint/service/setup and fix action.',
    persistence: 'Endpoints, theme, mode, diagnostics, and the Data & Recovery map should explain what reloads from browser/API/service storage.',
    expectedStates: ['offline', 'setup', 'recovery', 'ready'],
    requiredMarkers: [
      { label: 'feature wiring table', text: 'Feature Wiring' },
      { label: 'data recovery map', text: 'persistenceRows' },
      { label: 'sync gate title', text: 'syncNowTitle' },
      { label: 'machine profile gate', text: 'machineProfileControlBlockedReason' },
      { label: 'passive settings gate', text: 'passiveSettingsControlBlockedReason' }
    ]
  },
  {
    id: 'games',
    path: '/games',
    source: 'apps/hub/src/routes/games/+page.svelte',
    service: 'Browser + optional Mini Hub API saves',
    safeAction: 'Open launcher entries; save buttons should show offline/read-only state when API is unavailable.',
    sampleInput: 'Open a launcher entry. Avoid destructive/reset actions unless intentionally testing that game.',
    expectedResult: 'Legacy/playground games launch; API-backed save/status controls explain offline/read-only state when Mini Hub API is unavailable.',
    reloadProof: 'Reload after a supported score/state change; game state should return from cache/API or clearly explain local-only behavior.',
    safeActionLabels: ['Legacy Arcade', 'Open'],
    expectedBlockedState: 'Legacy/playground games remain launchable; API-backed saves explain offline state.',
    persistence: 'High scores/game state should reload from cache/API where supported.',
    expectedStates: ['offline', 'cached', 'recovery'],
    requiredMarkers: [
      { label: 'save and recovery status', text: 'Games save and recovery status' },
      { label: 'cached game runs', text: 'gameRunCount = $clientData.gameRuns.length' },
      { label: 'cached game state', text: 'gameStateCount = $clientData.gameStates.length' },
      { label: 'offline save wording', text: 'API-backed run/state saves are disabled' },
      { label: 'new lab route', text: "hubHref('/games/stick-arena-lab')" },
      { label: 'legacy fallback route', text: 'legacyHref()' },
      { label: 'legacy arcade label', text: 'Legacy Arcade' }
    ]
  },
  {
    id: 'stick-arena-lab',
    path: '/games/stick-arena-lab',
    source: 'apps/hub/src/routes/games/stick-arena-lab/+page.svelte',
    service: 'Browser game engine + optional Mini Hub API saves',
    safeAction: 'Open the lab; Reset waits for the engine, Save Run waits for engine/API readiness.',
    sampleInput: 'No text input. Wait for the Pixi/Rapier lab to load, then use Reset locally; only save when Mini Hub API is online.',
    expectedResult: 'Engine loading/unavailable, offline read-only saving, telemetry, reset, and save state are all visible instead of silent.',
    reloadProof: 'Reload the route; the lab should recreate locally and saved game runs/state remain API/cache-backed when saving is available.',
    safeActionLabels: ['Reset', 'Save Run', 'Open Settings'],
    expectedBlockedState: 'Engine/API prerequisites disable reset/save with clear titles and banners.',
    persistence: 'Runs and game state save through Mini Hub when online; telemetry stays visible during the current browser session.',
    expectedStates: ['loading', 'offline', 'disabled', 'ready'],
    requiredMarkers: [
      { label: 'engine loading state', text: 'Loading engine' },
      { label: 'engine unavailable state', text: 'Game engine unavailable' },
      { label: 'offline save banner', text: 'Offline read-only: the lab is playable' },
      { label: 'reset gate', text: 'resetDisabled' },
      { label: 'save gate', text: 'saveDisabled' },
      { label: 'save title helper', text: 'function saveTitle' },
      { label: 'game run save', text: 'clientData.saveGameRun' },
      { label: 'game state save', text: 'clientData.saveGameState' },
      { label: 'telemetry output', text: 'Telemetry' },
      { label: 'engine import', text: "createStickArenaLab" }
    ]
  }
];

function stripSvelte(value) {
  return value.replace(/\{[^}]*\}/gu, '').replace(/\s+/gu, ' ').trim();
}

function expressionChoices(value) {
  if (/^\s*[#/:@]/u.test(value)) return '';
  const choices = [];
  const pattern = /'([^'\\]*(?:\\.[^'\\]*)*)'|"([^"\\]*(?:\\.[^"\\]*)*)"|`([^`\\]*(?:\\.[^`\\]*)*)`/gu;
  for (const match of value.matchAll(pattern)) {
    const choice = (match[1] ?? match[2] ?? match[3] ?? '')
      .replace(/\$\{[^}]*\}/gu, '')
      .replace(/\\(['"`])/gu, '$1')
      .trim();
    if (choice && !choices.includes(choice)) choices.push(choice);
  }
  return choices.slice(0, 4).join('/');
}

function stripMarkupTags(value) {
  let output = '';
  let inTag = false;
  let quote = '';
  let braces = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (inTag) {
      if (quote) {
        if (char === quote) quote = '';
        continue;
      }
      if (char === '"' || char === "'") {
        quote = char;
        continue;
      }
      if (char === '{') braces += 1;
      if (char === '}') braces = Math.max(0, braces - 1);
      if (char === '>' && braces === 0) inTag = false;
      continue;
    }
    if (char === '<') {
      inTag = true;
      continue;
    }
    output += char;
  }
  return output;
}

function stripHtml(value) {
  return stripMarkupTags(
    value
      .replace(/<script[\s\S]*?<\/script>/giu, ' ')
      .replace(/<style[\s\S]*?<\/style>/giu, ' ')
  )
    .replace(/&amp;/gu, '&')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    .replace(/\s+/gu, ' ')
    .trim();
}

function svelteExpressionText(value) {
  let output = '';
  let quote = '';
  let braces = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      output += char;
      if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      output += char;
      continue;
    }
    if (char === '{') {
      braces += 1;
      if (braces > 1) output += char;
      continue;
    }
    if (char === '}') {
      braces = Math.max(0, braces - 1);
      if (braces > 0) output += char;
      continue;
    }
    if (braces > 0) output += char;
  }
  return output;
}

function cleanControlLabel(value) {
  let output = '';
  let inExpression = false;
  let quote = '';
  let braces = 0;
  let expression = '';
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (inExpression) {
      expression += char;
      if (quote) {
        if (char === quote) quote = '';
        continue;
      }
      if (char === '"' || char === "'" || char === '`') {
        quote = char;
        continue;
      }
      if (char === '{') braces += 1;
      if (char === '}') {
        braces = Math.max(0, braces - 1);
        if (braces === 0) {
          output += ` ${expressionChoices(svelteExpressionText(expression))} `;
          expression = '';
          inExpression = false;
        }
      }
      continue;
    }
    if (char === '{') {
      inExpression = true;
      braces = 1;
      expression = char;
      continue;
    }
    output += char;
  }
  if (expression) output += ` ${expressionChoices(svelteExpressionText(expression))} `;
  return output
    .replace(/\s+/gu, ' ')
    .trim();
}

function truncateLabel(value, max = 84) {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 3)).trim()}...`;
}

function extract(pattern, source) {
  const match = source.match(pattern);
  return match ? stripSvelte(match[1] ?? '') : '';
}

function extractHtml(pattern, source) {
  const match = source.match(pattern);
  return match ? stripHtml(match[1] ?? '') : '';
}

function count(pattern, source) {
  return [...source.matchAll(pattern)].length;
}

function extractFormStates(source) {
  return [...source.matchAll(/<form\b[\s\S]*?>/giu)].map((match) => {
    const tag = match[0] ?? '';
    return {
      guarded: /\bon:submit\|preventDefault=/u.test(tag),
      tag: tag.replace(/\s+/gu, ' ').trim()
    };
  });
}

function attrValue(attrs, name) {
  const pattern = new RegExp(`\\b${name}=(?:"([^"]*)"|'([^']*)'|\\{([^}]*)\\})`, 'iu');
  const match = pattern.exec(attrs);
  if (!match) return '';
  if (match[1] !== undefined) return match[1];
  if (match[2] !== undefined) return match[2];
  if (match[3] !== undefined) return `{${match[3]}}`;
  return '';
}

function hasAttr(attrs, name) {
  return new RegExp(`\\b${name}(?:=|\\s|$)`, 'iu').test(attrs);
}

function firstTag(block) {
  let quote = '';
  let braces = 0;
  for (let index = 0; index < block.length; index += 1) {
    const char = block[index];
    if (quote) {
      if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '{') braces += 1;
    if (char === '}') braces = Math.max(0, braces - 1);
    if (char === '>' && braces === 0) return block.slice(0, index + 1);
  }
  return block;
}

function elementParts(block, tagName) {
  const open = firstTag(block);
  const closingLength = `</${tagName}>`.length;
  return {
    attrs: open
      .replace(new RegExp(`^<${tagName}\\b`, 'iu'), '')
      .replace(/>$/u, '')
      .trim(),
    content: block.slice(open.length, Math.max(open.length, block.length - closingLength))
  };
}

function extractButtonStates(html) {
  return [...html.matchAll(/<button\b[\s\S]*?<\/button>/giu)].map((match) => {
    const { attrs, content } = elementParts(match[0] ?? '', 'button');
    const title = cleanControlLabel(attrValue(attrs, 'title'));
    const ariaLabel = cleanControlLabel(attrValue(attrs, 'aria-label'));
    const hasTitle = hasAttr(attrs, 'title');
    const hasAriaLabel = hasAttr(attrs, 'aria-label');
    const visibleLabel = cleanControlLabel(stripHtml(content));
    const label = visibleLabel || ariaLabel || title || '(dynamic label)';
    const line = html.slice(0, match.index ?? 0).split('\n').length;
    return {
      label,
      disabled: /\bdisabled(?:=|\s|>)/iu.test(attrs),
      title,
      ariaLabel,
      line,
      ambiguous: !visibleLabel && !hasAriaLabel && !hasTitle
    };
  });
}

function extractLinkStates(html) {
  return [...html.matchAll(/<a\b[\s\S]*?<\/a>/giu)].map((match) => {
    const { attrs, content } = elementParts(match[0] ?? '', 'a');
    const title = cleanControlLabel(attrValue(attrs, 'title'));
    const href = attrValue(attrs, 'href');
    const hasTitle = hasAttr(attrs, 'title');
    const visibleLabel = cleanControlLabel(stripHtml(content));
    const hrefLabel = cleanControlLabel(href);
    const label = visibleLabel || title || hrefLabel || '(dynamic link)';
    const line = html.slice(0, match.index ?? 0).split('\n').length;
    return {
      label,
      disabled:
        /\baria-disabled=(?:"true"|'true'|\{[^}]+\})/iu.test(attrs) ||
        /\bclass:disabled=/iu.test(attrs) ||
        /\bclass="[^"]*\bdisabled\b[^"]*"/iu.test(attrs),
      title,
      href,
      line,
      ambiguous: !visibleLabel && !hasTitle && !hrefLabel
    };
  });
}

function controlSummary(controls, limit = 8) {
  return controls
    .slice(0, limit)
    .map((control) => `${control.disabled ? 'disabled' : 'enabled'}:${truncateLabel(control.label)}`)
    .join('; ');
}

function ambiguousControls(controls) {
  return controls.filter((control) => control.ambiguous);
}

function ambiguousSummary(controls, limit = 6) {
  const ambiguous = ambiguousControls(controls);
  if (!ambiguous.length) return 'none';
  return ambiguous
    .slice(0, limit)
    .map((control) => `line ${control.line}: ${truncateLabel(control.label)}`)
    .join('; ');
}

function visibleIssueSnippets(html) {
  const text = cleanControlLabel(stripHtml(html));
  const issuePatterns = [
    /\b(?:offline|unavailable|misconfigured|not configured|needs setup|failed|error|not found|connect|setup|stale|cached|partial|loading)\b[^.?!]{0,140}[.?!]?/giu
  ];
  const snippets = new Set();
  for (const pattern of issuePatterns) {
    for (const match of text.matchAll(pattern)) {
      const snippet = (match[0] ?? '').trim();
      if (snippet.length > 4) snippets.add(snippet);
      if (snippets.size >= 8) break;
    }
  }
  return Array.from(snippets);
}

const stateCategoryPatterns = {
  loading: /\b(?:loading|refreshing|checking|scanning|syncing|opening|busy|preparing|finishing|saving)\b/iu,
  offline: /\b(?:offline|unavailable|not connected|not reachable|connection failed|service is unavailable|read-only|cannot reach)\b/iu,
  setup: /\b(?:setup|connect|open settings|not configured|misconfigured|needs|requires|target:)\b/iu,
  cached: /\b(?:cached|cache|browser storage|last browser snapshot|stale|localstorage|this browser)\b/iu,
  recovery: /\b(?:recovery|recoverable|restore|reloaded|reload|saved|survive|persist|activity|run history|source history)\b/iu,
  empty: /\b(?:empty|healthy empty|healthy-empty|no [a-z][^.?!]*(?:yet|available|registered|found|recorded|configured|matched))\b/iu,
  error: /\b(?:error|failed|failure|not found|invalid|unavailable|abort|blocked)\b/iu,
  disabled: /\b(?:disabled|blocked|guard|gating|read-only|before using|before saving|wait for|locked)\b/iu,
  partial: /\b(?:partial|sourceissues|sourcefailures|degraded|one slow|failed sources|stale partial)\b/iu,
  ready: /\b(?:ready|healthy| ok\b|available|capability|working|no action needed)\b/iu,
  'browser-local': /\b(?:browser[- ]local|browser storage|localstorage|this browser|browser-side|browser cache)\b/iu
};

function stateCategories(text) {
  const normalized = String(text ?? '').replace(/[_-]/gu, ' ');
  return Object.entries(stateCategoryPatterns)
    .filter(([, pattern]) => pattern.test(normalized))
    .map(([category]) => category);
}

function missingStateCategories(row) {
  const found = new Set(row.sourceStateCategories ?? []);
  return (row.expectedStates ?? []).filter((state) => !found.has(state));
}

function stateCategorySummary(row) {
  const expected = row.expectedStates ?? [];
  if (!expected.length) return 'none';
  const missing = missingStateCategories(row);
  if (!missing.length) return `ok ${expected.join(', ')}`;
  return `missing ${missing.join(', ')}`;
}

function safeActionStatus(route, controls) {
  const labels = route.safeActionLabels ?? [];
  if (!labels.length) return { found: false, enabled: false, labels: [], missingLabels: [] };
  const matches = controls.filter((control) =>
    labels.some((label) => control.label.toLowerCase().includes(label.toLowerCase()) || control.title.toLowerCase().includes(label.toLowerCase()))
  );
  const missingLabels = labels.filter(
    (label) => !controls.some((control) => control.label.toLowerCase().includes(label.toLowerCase()) || control.title.toLowerCase().includes(label.toLowerCase()))
  );
  return {
    found: matches.length > 0,
    enabled: matches.some((control) => !control.disabled),
    labels: matches.slice(0, 6).map((control) => `${control.disabled ? 'disabled' : 'enabled'}:${control.label}`),
    missingLabels
  };
}

function formSummary(row) {
  if (!row.forms) return 'none';
  if (!row.unguardedForms) return `ok ${row.forms}/${row.forms}`;
  return `unguarded ${row.unguardedForms}/${row.forms}`;
}

function sourceMarkerStatus(route, source) {
  return (route.requiredMarkers ?? []).map((marker) => ({
    ...marker,
    found: source.includes(marker.text)
  }));
}

function missingMarkers(row) {
  return (row.markerStatus ?? []).filter((marker) => !marker.found);
}

function markerSummary(row) {
  const markers = row.markerStatus ?? [];
  if (!markers.length) return 'none';
  const missing = missingMarkers(row);
  if (!missing.length) return `ok ${markers.length}/${markers.length}`;
  return `missing ${missing.map((marker) => marker.label).join(', ')}`;
}

function missingScenarioFields(row) {
  return ['sampleInput', 'expectedResult', 'reloadProof'].filter((field) => !String(row[field] ?? '').trim());
}

function scenarioSummary(row) {
  const missing = missingScenarioFields(row);
  return missing.length ? `missing ${missing.join(', ')}` : 'ok';
}

function liveRenderState(row) {
  if (!row) return 'not run';
  if (!row.ok) return `failed ${row.status}`;
  if (row.rawNotFound) return 'raw Not Found';
  if ((row.buttons ?? 0) + (row.links ?? 0) > 0) return 'rendered controls';
  if (row.title || row.heading) return 'rendered shell';
  return 'client-rendered shell';
}

function liveHydrationState(row) {
  if (!row) return 'not run';
  if (!row.ok) return 'live fetch failed';
  if (row.rawNotFound) return 'raw Not Found';
  if ((row.buttons ?? 0) + (row.links ?? 0) > 0) return 'hydrated controls visible';
  return 'client shell only; browser pass needed';
}

function safeActionSummary(safeAction) {
  if (!safeAction?.found) return 'missing';
  if (safeAction.missingLabels?.length) return `missing ${safeAction.missingLabels.join(', ')}`;
  return safeAction.enabled ? 'enabled' : 'disabled/setup';
}

function liveSafeActionSummary(row) {
  if (!row) return 'not run';
  if (row.ok && (row.buttons ?? 0) + (row.links ?? 0) === 0) return 'not-inspected';
  return safeActionSummary(row.safeAction);
}

function sourceSafeActionSummary(row) {
  if (row.missingSafeActionRefs?.length) return `missing ${row.missingSafeActionRefs.join(', ')}`;
  return row.safeActionRefs.join(', ') || 'MISSING';
}

async function sourceSnapshot(route) {
  const sourcePath = path.join(root, route.source);
  const source = await readFile(sourcePath, 'utf8');
  const title = extract(/<title>([\s\S]*?)<\/title>/iu, source);
  const heading = extract(/<h1[^>]*>([\s\S]*?)<\/h1>/iu, source);
  const sourceButtons = extractButtonStates(source);
  const sourceLinks = extractLinkStates(source);
  const sourceAmbiguousControls = ambiguousControls([...sourceButtons, ...sourceLinks]);
  const buttons = sourceButtons.length;
  const links = sourceLinks.length;
  const disabled = count(/\bdisabled(?:=|\s|>)/giu, source);
  const disabledLinks = count(/\baria-disabled=|\bclass:disabled=|\bclass="[^"]*\bdisabled\b[^"]*"/giu, source);
  const forms = extractFormStates(source);
  const errors = count(/(?:error-message|error-banner|warning-panel|offline-banner|service-card|connection-card)/giu, source);
  const settingsLinks = count(/routeMap\.settings|Open Settings|href=\{hubHref\(routeMap\.settings\)\}/giu, source);
  const sourceControls = [...sourceButtons, ...sourceLinks];
  const safeActionRefs = (route.safeActionLabels ?? []).filter((label) =>
    sourceControls.some((control) => control.label.toLowerCase().includes(label.toLowerCase()) || control.title.toLowerCase().includes(label.toLowerCase()))
  );
  const missingSafeActionRefs = (route.safeActionLabels ?? []).filter(
    (label) => !sourceControls.some((control) => control.label.toLowerCase().includes(label.toLowerCase()) || control.title.toLowerCase().includes(label.toLowerCase()))
  );
  const markerStatus = sourceMarkerStatus(route, source);
  const sourceStateCategories = stateCategories(source);
  return {
    ...route,
    title,
    heading,
    buttons,
    links,
    disabled,
    disabledLinks,
    sourceButtonLabels: controlSummary(sourceButtons),
    sourceLinkLabels: controlSummary(sourceLinks),
    sourceAmbiguousControls: sourceAmbiguousControls.length,
    sourceAmbiguousControlLabels: ambiguousSummary([...sourceButtons, ...sourceLinks]),
    sourceIssueSnippets: visibleIssueSnippets(source),
    sourceStateCategories,
    forms: forms.length,
    unguardedForms: forms.filter((form) => !form.guarded).length,
    errors,
    settingsLinks,
    safeActionRefs,
    missingSafeActionRefs,
    markerStatus,
    sourceOk: Boolean(title && heading)
  };
}

async function fetchRouteAttempt(baseUrl, route, attempt) {
  const url = new URL(route.path.replace(/^\//u, ''), baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    const buttons = extractButtonStates(text);
    const links = extractLinkStates(text);
    const ambiguous = ambiguousControls([...buttons, ...links]);
    const safeAction = safeActionStatus(route, [...buttons, ...links]);
    return {
      url,
      status: response.status,
      ok: response.ok,
      title: extractHtml(/<title>([\s\S]*?)<\/title>/iu, text),
      heading: extractHtml(/<h1[^>]*>([\s\S]*?)<\/h1>/iu, text),
      contentType: response.headers.get('content-type') ?? '',
      buttons: buttons.length,
      links: links.length,
      enabledButtons: buttons.filter((button) => !button.disabled).length,
      disabledButtons: buttons.filter((button) => button.disabled).length,
      enabledLinks: links.filter((link) => !link.disabled).length,
      disabledLinks: links.filter((link) => link.disabled).length,
      buttonLabels: controlSummary(buttons, 12),
      linkLabels: controlSummary(links, 12),
      ambiguousControls: ambiguous.length,
      ambiguousControlLabels: ambiguousSummary([...buttons, ...links]),
      issueSnippets: visibleIssueSnippets(text),
      stateCategories: stateCategories(text),
      safeAction,
      rawNotFound: /\bNot Found\b/u.test(stripHtml(text)),
      attempts: attempt
    };
  } catch (error) {
    return {
      url,
      status: 0,
      ok: false,
      title: '',
      contentType: '',
      error: error instanceof Error ? error.message : 'fetch failed',
      attempts: attempt
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchRoute(baseUrl, route) {
  const first = await fetchRouteAttempt(baseUrl, route, 1);
  if (first.status !== 0) return first;
  const second = await fetchRouteAttempt(baseUrl, route, 2);
  if (second.ok) return { ...second, previousError: first.error };
  return { ...second, previousError: first.error ?? second.error };
}

function printMarkdown(rows, liveRows) {
  console.log('| Route | Title | Heading | Buttons | Links | Disabled refs | Ambiguous | Forms | Safe action refs | State markers | State categories | Scenario | Service | Blocked/setup expectation | Safe QA action | Reload persistence | Live | Hydration QA |');
  console.log('| --- | --- | --- | ---: | ---: | ---: | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const row of rows) {
    const live = liveRows.get(row.id);
    const liveText = live
      ? `${live.ok ? 'ok' : 'check'} ${live.status} ${liveRenderState(live)} buttons ${live.enabledButtons ?? 0}/${live.buttons ?? 0} links ${live.enabledLinks ?? 0}/${live.links ?? 0} safe:${liveSafeActionSummary(live)} ${live.attempts > 1 ? `retry:${live.attempts}` : ''} ${live.error ?? ''}`.trim()
      : 'not run';
    console.log(
      `| ${row.path} | ${row.title || 'MISSING'} | ${row.heading || 'MISSING'} | ${row.buttons} | ${row.links} | ${row.disabled} + ${row.disabledLinks} links | ${row.sourceAmbiguousControls ? `check ${row.sourceAmbiguousControls}` : 'ok'} | ${formSummary(row)} | ${sourceSafeActionSummary(row)} | ${markerSummary(row)} | ${stateCategorySummary(row)} | ${scenarioSummary(row)} | ${row.service} | ${row.expectedBlockedState} | ${row.safeAction} | ${row.persistence} | ${liveText} | ${liveHydrationState(live)} |`
    );
  }
}

function printChecklist(rows, liveRows, baseUrl) {
  console.log('# Mini Hub Usability Checklist');
  console.log('');
  console.log(`Generated: ${new Date().toISOString()}`);
  console.log(`Target: ${baseUrl || 'source-only; set HUB_SMOKE_URL for live route links'}`);
  console.log('');
  console.log('Use this as the repeatable manual/Playwright-style pass after the static smoke table. Each item should either work, be disabled with a clear reason, or route to setup.');
  console.log('');
  for (const row of rows) {
    const live = liveRows.get(row.id);
    const liveLabel = live ? `${live.ok ? 'live ok' : 'live check'} ${live.status}${live.error ? `: ${live.error}` : ''}` : 'live not run';
    console.log(`## ${row.heading || row.id} (${row.path})`);
    console.log('');
    console.log(`- [ ] Open ${live?.url ?? row.path} and confirm title "${row.title || 'MISSING'}" plus heading "${row.heading || 'MISSING'}".`);
    console.log(`- [ ] Confirm service state is understandable for: ${row.service}.`);
    console.log(`- [ ] Confirm required state/recovery markers: ${markerSummary(row)}; scenario fields: ${scenarioSummary(row)}.`);
    console.log(`- [ ] Confirm expected state categories are visible in copy/control titles: ${stateCategorySummary(row)}.`);
    console.log(`- [ ] Exercise safe action: ${row.safeAction}`);
    console.log(`- [ ] Sample input/setup: ${row.sampleInput}`);
    console.log(`- [ ] Expected result/output quality: ${row.expectedResult}`);
    console.log(`- [ ] If prerequisites are missing, verify blocked/setup state: ${row.expectedBlockedState}`);
    console.log(`- [ ] Reload or navigate away/back, then verify persistence: ${row.persistence}`);
    console.log(`- [ ] Reload proof: ${row.reloadProof}`);
    console.log(`- [ ] Record visible controls/errors: ${row.buttons} source buttons, ${row.links} source links, ${row.disabled} disabled-control refs, ${row.disabledLinks} disabled-link refs, ambiguous controls ${row.sourceAmbiguousControls}, forms ${formSummary(row)}, ${row.errors} setup/error surface refs, ${row.settingsLinks} Settings links. Live status: ${liveLabel}.`);
    console.log(`- [ ] Hydration status: ${liveHydrationState(live)}.`);
    if (row.missingSafeActionRefs?.length) console.log(`- [ ] Missing source safe-action labels: ${row.missingSafeActionRefs.join(', ')}.`);
    if (row.sourceButtonLabels) console.log(`- [ ] Source buttons: ${row.sourceButtonLabels}`);
    if (row.sourceLinkLabels) console.log(`- [ ] Source links: ${row.sourceLinkLabels}`);
    if (row.sourceAmbiguousControls) console.log(`- [ ] Ambiguous source controls needing labels/titles: ${row.sourceAmbiguousControlLabels}`);
    if (row.sourceIssueSnippets?.length) console.log(`- [ ] Source state snippets: ${row.sourceIssueSnippets.join(' | ')}`);
    if (row.sourceStateCategories?.length) console.log(`- [ ] Source state categories found: ${row.sourceStateCategories.join(', ')}.`);
    if (live) {
      console.log(`- [ ] Live DOM snapshot: ${liveRenderState(live)}, title "${live.title || 'MISSING'}", heading "${live.heading || 'MISSING'}", ${live.enabledButtons ?? 0}/${live.buttons ?? 0} enabled buttons, ${live.enabledLinks ?? 0}/${live.links ?? 0} enabled links, safe action ${liveSafeActionSummary(live)}.`);
      if ((live.buttons ?? 0) + (live.links ?? 0) === 0) console.log('- [ ] Live route returned a static/client-rendered shell; this proves routing and raw Not Found leakage only. Use a hydrated browser pass for actual control clicks.');
      if (live.buttonLabels) console.log(`- [ ] Live buttons: ${live.buttonLabels}`);
      if (live.linkLabels) console.log(`- [ ] Live links: ${live.linkLabels}`);
      if (live.ambiguousControls) console.log(`- [ ] Ambiguous live controls needing browser inspection: ${live.ambiguousControlLabels}`);
      if (live.issueSnippets?.length) console.log(`- [ ] Live state snippets: ${live.issueSnippets.join(' | ')}`);
      if (live.stateCategories?.length) console.log(`- [ ] Live state categories found: ${live.stateCategories.join(', ')}.`);
    }
    console.log('');
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const baseUrl = process.env.HUB_SMOKE_URL ?? '';
  const requireHydrated = args.has('--require-hydrated') || process.env.HUB_SMOKE_REQUIRE_HYDRATED === '1';
  const rows = await Promise.all(routes.map(sourceSnapshot));
  const liveRows = new Map();
  if (baseUrl) {
    for (const route of routes) {
      liveRows.set(route.id, await fetchRoute(baseUrl, route));
    }
  }

  if (args.has('--json')) {
    console.log(JSON.stringify({ checkedAt: new Date().toISOString(), baseUrl: baseUrl || null, routes: rows, live: Object.fromEntries(liveRows) }, null, 2));
  } else if (args.has('--checklist')) {
    printChecklist(rows, liveRows, baseUrl);
  } else {
    printMarkdown(rows, liveRows);
  }

  const failures = rows.filter(
    (row) =>
      !row.sourceOk ||
      !row.safeActionRefs.length ||
      row.missingSafeActionRefs.length ||
      missingMarkers(row).length ||
      missingStateCategories(row).length ||
      missingScenarioFields(row).length ||
      row.unguardedForms ||
      row.sourceAmbiguousControls
  );
  const liveFailures = [...liveRows.values()].filter((row) => !row.ok || row.rawNotFound);
  const hydrationFailures = requireHydrated ? [...liveRows.values()].filter((row) => row.ok && !row.rawNotFound && (row.buttons ?? 0) + (row.links ?? 0) === 0) : [];
  if (failures.length || liveFailures.length || hydrationFailures.length) {
    console.error(
      `Mini Hub usability smoke found ${failures.length} source issue(s), ${liveFailures.length} live route issue(s), and ${hydrationFailures.length} hydration inspection issue(s).`
    );
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
