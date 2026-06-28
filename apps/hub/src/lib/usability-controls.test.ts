import { readdir, readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

async function routeSource(path: string): Promise<string> {
  return readFile(new URL(path, import.meta.url), 'utf8');
}

const routesRoot = fileURLToPath(new URL('../routes', import.meta.url));
const sharedControlFiles = [
  fileURLToPath(new URL('./AssistantDock.svelte', import.meta.url)),
  fileURLToPath(new URL('../routes/+layout.svelte', import.meta.url))
];

async function routePageFiles(dir = routesRoot): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const child = resolve(dir, entry.name);
      if (entry.isDirectory()) return routePageFiles(child);
      return entry.isFile() && entry.name === '+page.svelte' ? [child] : [];
    })
  );
  return files.flat();
}

async function controlSurfaceFiles(): Promise<string[]> {
  return [...(await routePageFiles()), ...sharedControlFiles];
}

function firstTag(block: string): string {
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

function visibleControlText(block: string): string {
  let output = '';
  let inTag = false;
  let quote = '';
  let braces = 0;
  for (let index = 0; index < block.length; index += 1) {
    const char = block[index];
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
  return output
    .replace(/\{[#/:@][^}]*\}/g, ' ')
    .replace(/&[a-z0-9#]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

describe('Mini Hub usability control gates', () => {
  it('keeps the global save status recoverable from every route', async () => {
    const source = await routeSource('../routes/+layout.svelte');

    expect(source).toContain('function layoutSyncPillText');
    expect(source).toContain('function layoutSyncPillTitle');
    expect(source).toContain('Auto-save ready');
    expect(source).toContain('Offline read-only: cached pages stay readable, but save buttons wait for the Mini Hub API.');
    expect(source).toContain('Online auto-save ready. Last sync:');
    expect(source).toContain('Open Settings Data & Recovery for what survives closing the site.');
    expect(source).toContain('class="sync-pill" href={hubHref(routeMap.settings)}');
    expect(source).toContain('aria-label={`Save status: ${syncPillText}. Open Settings Data and Recovery.`}');
  });

  it('keeps disabled route buttons self-explanatory', async () => {
    const offenders: string[] = [];
    const pageFiles = await controlSurfaceFiles();

    for (const pageFile of pageFiles) {
      const source = await readFile(pageFile, 'utf8');
      const buttons = source.matchAll(/<button\b[\s\S]*?<\/button>/g);

      for (const button of buttons) {
        const block = button[0];
        const hasDisabled = /\bdisabled(?:=|\s|>)/.test(block);
        const hasTitle = /\btitle=/.test(block);
        if (hasDisabled && !hasTitle) {
          const line = source.slice(0, button.index ?? 0).split('\n').length;
          offenders.push(`${relative(routesRoot, pageFile)}:${line}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('keeps clickable route buttons labelled or explicitly gated', async () => {
    const offenders: string[] = [];
    const pageFiles = await controlSurfaceFiles();

    for (const pageFile of pageFiles) {
      const source = await readFile(pageFile, 'utf8');
      const buttons = source.matchAll(/<button\b[\s\S]*?<\/button>/g);

      for (const button of buttons) {
        const open = firstTag(button[0]);
        const hasAction = /\bon:click=/.test(open) || /\btype=(["'])submit\1/.test(open);
        const hasGateOrLabel = /\b(?:aria-label|disabled|title)=/.test(open);
        if (hasAction && !hasGateOrLabel) {
          const line = source.slice(0, button.index ?? 0).split('\n').length;
          offenders.push(`${relative(routesRoot, pageFile)}:${line}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('keeps route buttons explicit about submit behavior', async () => {
    const offenders: string[] = [];
    const pageFiles = await controlSurfaceFiles();

    for (const pageFile of pageFiles) {
      const source = await readFile(pageFile, 'utf8');
      const buttons = source.matchAll(/<button\b[\s\S]*?>/g);

      for (const button of buttons) {
        const block = button[0];
        if (!/\btype=/.test(block)) {
          const line = source.slice(0, button.index ?? 0).split('\n').length;
          offenders.push(`${relative(routesRoot, pageFile)}:${line}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('keeps icon-only route buttons labelled', async () => {
    const offenders: string[] = [];
    const pageFiles = await controlSurfaceFiles();

    for (const pageFile of pageFiles) {
      const source = await readFile(pageFile, 'utf8');
      const buttons = source.matchAll(/<button\b[\s\S]*?<\/button>/g);

      for (const button of buttons) {
        const block = button[0];
        const open = firstTag(block);
        const hasAccessibleLabel = /\b(?:aria-label|title)=/.test(open);
        const hasVisibleText = Boolean(visibleControlText(block));
        if (!hasVisibleText && !hasAccessibleLabel) {
          const line = source.slice(0, button.index ?? 0).split('\n').length;
          offenders.push(`${relative(routesRoot, pageFile)}:${line}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('keeps route links labelled and routed', async () => {
    const offenders: string[] = [];
    const pageFiles = await controlSurfaceFiles();

    for (const pageFile of pageFiles) {
      const source = await readFile(pageFile, 'utf8');
      const links = source.matchAll(/<a\b[\s\S]*?<\/a>/g);

      for (const link of links) {
        const block = link[0];
        const open = firstTag(block);
        const hasHref = /\bhref=/.test(open);
        const hasEmptyHref = /\bhref=(["'])\s*(?:#|javascript:void\(0\))?\s*\1/.test(open);
        const hasAccessibleLabel = /\b(?:aria-label|title)=/.test(open);
        const hasVisibleText = Boolean(visibleControlText(block));
        if (!hasHref || hasEmptyHref || (!hasVisibleText && !hasAccessibleLabel)) {
          const line = source.slice(0, link.index ?? 0).split('\n').length;
          offenders.push(`${relative(routesRoot, pageFile)}:${line}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('keeps disabled route links self-explanatory', async () => {
    const offenders: string[] = [];
    const pageFiles = await controlSurfaceFiles();

    for (const pageFile of pageFiles) {
      const source = await readFile(pageFile, 'utf8');
      const links = source.matchAll(/<a\b[\s\S]*?<\/a>/g);

      for (const link of links) {
        const open = firstTag(link[0]);
        const disabled = /\baria-disabled=|\bclass:disabled=|\bclass=(["'])[^"']*\bdisabled\b[^"']*\1/.test(open);
        if (disabled && !/\btitle=/.test(open)) {
          const line = source.slice(0, link.index ?? 0).split('\n').length;
          offenders.push(`${relative(routesRoot, pageFile)}:${line}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('keeps external route links isolated from the opener', async () => {
    const offenders: string[] = [];
    const pageFiles = await controlSurfaceFiles();

    for (const pageFile of pageFiles) {
      const source = await readFile(pageFile, 'utf8');
      const links = source.matchAll(/<a\b[\s\S]*?<\/a>/g);

      for (const link of links) {
        const open = firstTag(link[0]);
        if (/\btarget=(["'])_blank\1/.test(open) && !/\brel=(["'])[^"']*\bnoreferrer\b[^"']*\1/.test(open)) {
          const line = source.slice(0, link.index ?? 0).split('\n').length;
          offenders.push(`${relative(routesRoot, pageFile)}:${line}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('keeps disabled route form controls self-explanatory', async () => {
    const offenders: string[] = [];
    const pageFiles = await controlSurfaceFiles();

    for (const pageFile of pageFiles) {
      const source = await readFile(pageFile, 'utf8');
      const controls = source.matchAll(/<(?:input|select|textarea)\b[\s\S]*?(?:<\/textarea>|<\/select>|>)/g);

      for (const control of controls) {
        const block = control[0];
        const hasDisabled = /\bdisabled(?:=|\s|>)/.test(block);
        const hasExplanation = /\b(?:title|aria-describedby)=/.test(block);
        if (hasDisabled && !hasExplanation) {
          const line = source.slice(0, control.index ?? 0).split('\n').length;
          offenders.push(`${relative(routesRoot, pageFile)}:${line}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('keeps control surface forms from falling back to browser-native submission', async () => {
    const offenders: string[] = [];
    const pageFiles = await controlSurfaceFiles();

    for (const pageFile of pageFiles) {
      const source = await readFile(pageFile, 'utf8');
      const forms = source.matchAll(/<form\b[\s\S]*?>/g);

      for (const form of forms) {
        const tag = form[0];
        if (!/\bon:submit\|preventDefault=/.test(tag)) {
          const line = source.slice(0, form.index ?? 0).split('\n').length;
          offenders.push(`${relative(routesRoot, pageFile)}:${line}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('avoids empty title fallbacks on disabled route controls', async () => {
    const offenders: string[] = [];
    const pageFiles = await controlSurfaceFiles();

    for (const pageFile of pageFiles) {
      const source = await readFile(pageFile, 'utf8');
      const controls = source.matchAll(/<(?:button|input|select|textarea)\b[\s\S]*?(?:<\/button>|<\/textarea>|<\/select>|>)/g);

      for (const control of controls) {
        const block = control[0];
        if (!/\bdisabled(?:=|\s|>)/.test(block)) continue;
        if (/\btitle=\{[\s\S]*?(?:\?\s*[\s\S]*?:\s*''|,\s*'')/.test(block)) {
          const line = source.slice(0, control.index ?? 0).split('\n').length;
          offenders.push(`${relative(routesRoot, pageFile)}:${line}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('collapses Research service failures and disables AI OS-backed research actions', async () => {
    const source = await routeSource('../routes/research/+page.svelte');

    expect(source).toContain('serviceIssue = compactResearchServiceIssue');
    expect(source).toContain('isResearchServiceError');
    expect(source).toContain('visibleRunError = serviceIssue && isResearchServiceError(error) ?');
    expect(source).toContain('visibleMonitorError = serviceIssue && isResearchServiceError(monitorError) ?');
    expect(source).toContain('visibleSourceLibraryError = serviceIssue && isResearchServiceError(sourceLibraryError) ?');
    expect(source).toContain('class="service-card"');
    expect(source).toContain('let serviceProbePending = true');
    expect(source).toContain('function initialResearchServiceCheck');
    expect(source).toContain('function researchRunDisabledReason');
    expect(source).toContain('researchRunBlockedReason = researchRunDisabledReason');
    expect(source).toContain('researchRunDisabled = Boolean(researchRunBlockedReason)');
    expect(source).toContain('Checking AI OS service');
    expect(source).toContain('Research Desk is checking whether AI OS is reachable before starting a run.');
    expect(source).toContain('disabled={researchRunDisabled}');
    expect(source).toContain('interface ResearchMonitorActionState');
    expect(source).toContain('interface ResearchServicesRefreshState');
    expect(source).toContain('monitorActionState = {');
    expect(source).toContain('researchServicesRefreshState = {');
    expect(source).toContain('researchRunButtonTitle = runResearchTitle({');
    expect(source).toContain('refreshRunsButtonTitle = refreshRunsTitle(refreshing)');
    expect(source).toContain('refreshMonitorsButtonTitle = refreshMonitorsTitle(monitorActionState)');
    expect(source).toContain('researchServicesButtonTitle = researchServicesRefreshTitle(researchServicesRefreshState)');
    expect(source).toContain('saveCurrentMonitorButtonTitle = saveCurrentMonitorTitle(monitorActionState, goal)');
    expect(source).toContain('advancedToggleButtonTitle = advancedToggleTitle(advancedOpen)');
    expect(source).toContain('function monitorActionBlockedReason');
    expect(source).toContain('Research Desk is checking AI OS before monitor actions are enabled.');
    expect(source).toContain('Another research monitor action is already running.');
    expect(source).toContain('disabled={monitorActionDisabled(monitorActionState, monitor)}');
    expect(source).toContain('const blocked = monitorActionBlockedReason(monitorActionState);');
    expect(source).toContain('const blocked = monitorActionBlockedReason(monitorActionState, monitor);');
    expect(source).toContain('sourceLibrarySearchDisabled = sourceLibraryLoading || aiOsUnavailable || serviceProbePending');
    expect(source).toContain('on:submit|preventDefault={searchSourceLibrary}');
    expect(source).toContain('disabled={sourceLibrarySearchDisabled}');
    expect(source).toContain('function researchServicesRefreshTitle');
    expect(source).toContain('title={researchServicesButtonTitle}');
    expect(source).toContain('function runResearchTitle');
    expect(source).toContain('function researchRunsEmptyMessage');
    expect(source).toContain('Reports are unavailable until AI OS is connected. Saved runs will reload after Retry Service succeeds.');
    expect(source).toContain('function monitorEmptyMessage');
    expect(source).toContain('Topic monitors are unavailable until AI OS is connected. Saved monitors will reload after Retry Service succeeds.');
    expect(source).toContain('function sourceLibraryEmptyMessage');
    expect(source).toContain('Source Library is unavailable until AI OS is connected. Archived sources will reload after Retry Service succeeds.');
    expect(source).toContain('{researchRunsEmptyMessage()}');
    expect(source).toContain('{monitorEmptyMessage()}');
    expect(source).toContain('{sourceLibraryEmptyMessage()}');
    expect(source).toContain('Research run is already being queued.');
    expect(source).toContain('function refreshRunsTitle');
    expect(source).toContain('return isRefreshing ?');
    expect(source).toContain('function refreshMonitorsTitle');
    expect(source).toContain('function saveCurrentMonitorTitle');
    expect(source).toContain('function researchModeTitle');
    expect(source).toContain('function advancedToggleTitle');
    expect(source).toContain('function researchRunSelectionTitle');
    expect(source).toContain('function sourceSeedTitle');
    expect(source).toContain('function sourceSeedDisabled');
    expect(source).toContain('function sourceSeedAlreadyAdded');
    expect(source).toContain('title={researchModeTitle(item)}');
    expect(source).toContain('title={advancedToggleButtonTitle}');
    expect(source).toContain('title={researchRunSelectionTitle(run)}');
    expect(source).toContain('disabled={sourceSeedDisabled(source.canonical_url)}');
    expect(source).toContain('Enter a research goal before saving a monitor.');
    expect(source).toContain('Connect AI OS');
    expect(source).toContain('let runActionId =');
    expect(source).toContain('selectedRunActionBlockedReason = !selectedRun');
    expect(source).toContain('Select a research run before controlling it.');
    expect(source).toContain('disabled={selectedRunActionDisabled}');
    expect(source).toContain('Cancel research run "${run.goal || run.id}"?');
    expect(source).toContain('Research cancellation skipped.');
    expect(source).toContain('function reportExportHref');
    expect(source).toContain('Exports need AI OS; these links open Settings.');
    expect(source).toContain('selectedRunId: selectedRun?.id ?? persistedRunId');
    expect(source).toContain('selectedMonitorId');
    expect(source).toContain('class:selected={monitor.id === selectedMonitorId}');
  });

  it('keeps AI Lab classify and parse controls independent', async () => {
    const source = await routeSource('../routes/ai-lab/+page.svelte');

    expect(source).toContain('defaultAiLabDraft');
    expect(source).toContain('let classifyBusy = false');
    expect(source).toContain('let parseBusy = false');
    expect(source).toContain('sampleControlsDisabled = classifyBusy || parseBusy');
    expect(source).toContain('classifyBlockedReason = classifyBusy ?');
    expect(source).toContain('classifyValidationReason({ text, labels })');
    expect(source).toContain('parseBlockedReason = parseBusy ?');
    expect(source).toContain('parseValidationReason({ grammarUrl, codeText })');
    expect(source).toContain('function restoreAiLabSamples');
    expect(source).toContain('function restoreSamplesTitle');
    expect(source).toContain('Restored default AI Lab samples in this browser.');
    expect(source).toContain('aiLabAssetErrorDetail');
    expect(source).toContain('function classifyValidationReason');
    expect(source).toContain('function parseValidationReason');
    expect(source).toContain('function classifyInputTitle');
    expect(source).toContain('Classification is running with the submitted text and labels; wait before editing these inputs.');
    expect(source).toContain('function parseInputTitle');
    expect(source).toContain('Parsing is running with the submitted code and grammar URL; wait before editing these inputs.');
    expect(source).toContain('disabled={classifyBusy} title={classifyInputTitle');
    expect(source).toContain('disabled={parseBusy} title={parseInputTitle');
    expect(source).toContain('disabled={sampleControlsDisabled}');
    expect(source).toContain('title={restoreSamplesTitle()}');
    expect(source).toContain('disabled={Boolean(classifyBlockedReason)}');
    expect(source).toContain('disabled={Boolean(parseBlockedReason)}');
    expect(source).toContain('aria-busy={classifyBusy}');
    expect(source).toContain('aria-busy={parseBusy}');
    expect(source).toContain('AI Lab local capability status');
    expect(source).toContain('This lab is browser-local.');
    expect(source).toContain('draftStatus =');
    expect(source).toContain('Reloaded AI Lab inputs from this browser.');
    expect(source).toContain('class="result-grid"');
    expect(source).not.toContain('let busy = false');
  });

  it('keeps the assistant dock command controls explainable', async () => {
    const source = await routeSource('./AssistantDock.svelte');

    expect(source).toContain('sendBlockedReason = assistantSendBlockedReason');
    expect(source).toContain('function assistantSendBlockedReason');
    expect(source).toContain('Assistant is already working on the current request.');
    expect(source).toContain('Type a message before sending.');
    expect(source).toContain('disabled={Boolean(sendBlockedReason)}');
    expect(source).toContain("title={sendBlockedReason || 'Send this message to the assistant.'}");
    expect(source).toContain('function exampleTitle');
    expect(source).toContain('function assistantActionTitle');
    expect(source).toContain('title={exampleTitle(example)}');
    expect(source).toContain('disabled={busy}');
    expect(source).toContain('title={assistantActionTitle(action)}');
    expect(source).toContain('Route ambiguous assistant requests through the AI OS command/tool planner when possible.');
    expect(source).toContain('Permit write or system tools only after an explicit confirmation pass.');
    expect(source).toContain('{currentMachineMode.shortLabel} - App helper');
    expect(source).not.toContain('Â·');
  });

  it('blocks AI OS service-backed work until a status snapshot is loaded', async () => {
    const source = await routeSource('../routes/ai-os/+page.svelte');

    expect(source).toContain("type StartupState = 'ready' | 'degraded' | 'offline' | 'unknown' | 'checking'");
    expect(source).toContain('startupChecks = buildStartupChecks(status, actionError, loading)');
    expect(source).toContain('Checking ${getAiOsApiUrl()} for the local AI OS service.');
    expect(source).toContain("if (checks.some((check) => check.state === 'checking')) return 'Checking AI OS'");
    expect(source).toContain("if (state === 'checking') return 'Checking'");
    expect(source).toContain('.startup-check.checking');
    expect(source).toContain('aiOsActionBlocked = !aiOsReady');
    expect(source).toContain('aiOsActionBlockedReason = aiOsServiceActionBlockedReason');
    expect(source).toContain('function aiOsServiceActionBlockedReason');
    expect(source).toContain('function aiOsRefreshTitle');
    expect(source).toContain('function aiOsActionTitle');
    expect(source).toContain('function foundationActionTitle');
    expect(source).toContain('function warmLocalModelBlockedReason');
    expect(source).toContain('function aiOsMetricLabel');
    expect(source).toContain('function aiOsCountLabel');
    expect(source).toContain('function aiOsRamDetail');
    expect(source).toContain('function aiOsGpuDetail');
    expect(source).toContain('function aiOsModelSummary');
    expect(source).toContain('function noGpuRowsMessage');
    expect(source).toContain('Loading GPU, VRAM, and temperature telemetry.');
    expect(source).toContain('AI OS is not connected, so GPU telemetry is not checked.');
    expect(source).toContain('Model load has not been checked yet.');
    expect(source).toContain('<strong>{aiOsMetricLabel(hardware?.cpu_percent,');
    expect(source).toContain('<small>{aiOsGpuDetail(primaryGpu)}</small>');
    expect(source).toContain('<p class="muted">{noGpuRowsMessage()}</p>');
    expect(source).toContain('disabled={Boolean(warmupBlockedReason)}');
    expect(source).toContain('function requireAiOsReady');
    expect(source).toContain('disabled={commandBusy || aiOsActionBlocked}');
    expect(source).toContain("title={aiOsActionBlockedReason || (commandBusy ? 'AI OS command is already running.' : 'Run this AI OS command.')}");
    expect(source).toContain('disabled={autotuneBusy || aiOsActionBlocked}');
    expect(source).toContain('disabled={designBusy || aiOsActionBlocked}');
    expect(source).toContain('disabled={benchmarkBusy || aiOsActionBlocked}');
    expect(source).toContain("title={aiOsRefreshTitle()}");
    expect(source).toContain("title={aiOsRefreshTitle('Refresh AI OS status before running command actions.')}");
    expect(source).toContain("title={aiOsRefreshTitle('Refresh AI OS status and machine profile.')}");
    expect(source).toContain("title={aiOsRefreshTitle('Refresh AI OS status before using advanced command controls.')}");
    expect(source).toContain('function commandExampleTitle');
    expect(source).toContain('title={commandExampleTitle(example)}');
    expect(source).not.toContain('<button class="button" type="button" on:click={refresh}>');
    expect(source).toContain("title={foundationActionTitle('Create a verified AI OS backup now.')}");
    expect(source).toContain("title={foundationActionTitle('Verify the latest AI OS backup.', true)}");
    expect(source).toContain("title={aiOsActionTitle('Run one ad hoc inference call.', inferBusy, 'Inference is already running.')}");
    expect(source).toContain("title={aiOsActionTitle('Queue this AI OS job.', jobBusy, 'A job queue request is already running.')}");
    expect(source).toContain("title={aiOsActionTitle('Ingest this scratch text into semantic memory.', memoryBusy, 'A memory action is already running.')}");
    expect(source).toContain("title={aiOsActionTitle('Run the generic agent loop.', agentBusy, 'Agent loop is already running.')}");
    expect(source).toContain("title={aiOsActionTitle('Invoke the selected multimodal capability.', multimodalBusy, 'Multimodal generation is already running.')}");
    expect(source).toContain('id="command-objective-primary"');
    expect(source).toContain('id="command-objective-advanced"');
    expect(source).toContain('id="command-confirm-primary"');
    expect(source).toContain('id="command-confirm-advanced"');
    expect(source).not.toContain('id="command-objective"');
    expect(source).not.toContain('id="command-confirm"');
    expect(source).toContain('function jobCancelBlockedReason');
    expect(source).toContain('Another job cancellation is already running.');
    expect(source).toContain('Cancel AI OS job "${job.id}"?');
    expect(source).toContain('AI OS job cancellation skipped.');
    expect(source).toContain('disabled={jobCancelDisabled(job)}');
    expect(source).toContain('function backgroundActionBlockedReason');
    expect(source).toContain('Another ambient unit action is already running.');
    expect(source).toContain("disabled={backgroundActionDisabled(unit, 'toggle')}");
    expect(source).toContain("disabled={backgroundActionDisabled(unit, 'run')}");
  });

  it('guards Macro Lab and Passive task side-effect controls while state is unknown', async () => {
    const macro = await routeSource('../routes/macro-lab/+page.svelte');
    const passive = await routeSource('../routes/passive-tasks/+page.svelte');

    expect(macro).toContain('macroServiceReady = Boolean(status && !serviceError)');
    expect(macro).toContain('macroControlTitle = macroDisabledReason({ loading, busy, serviceError, status })');
    expect(macro).toContain('macroControlDisabled = Boolean(macroControlTitle)');
    expect(macro).toContain('macroRefreshBlockedReason = macroRefreshDisabledReason({ loading, busy })');
    expect(macro).toContain('function macroRefreshDisabledReason');
    expect(macro).toContain('function macroRowTitle');
    expect(macro).toContain('title={macroRowTitle(macro)}');
    expect(macro).toContain("title={macroRefreshBlockedReason || 'Reload Macro Lab state from the desktop service.'}");
    expect(macro).toContain('function requireMacroReady');
    expect(macro).toContain('if (macroConnectionError(message)) {');
    expect(macro).toContain("actionError = ''");
    expect(macro).toContain('connection-card service-card');
    expect(macro).toContain('Macro Lab connection failed');
    expect(macro).toContain('<p>{serviceError}</p>');
    expect(macro).toContain('function confirmMacroSideEffectRun');
    expect(macro).toContain('window.confirm(');
    expect(macro).toContain('Confirmed macro run skipped.');
    expect(macro).toContain('!dryRun && confirm && !confirmMacroSideEffectRun(selectedMacro)');
    expect(macro).toContain("title={macroControlTitle || 'Ask for confirmation before running this macro with real desktop side effects.'}");
    expect(macro).toContain('disabled={macroControlDisabled}');
    expect(passive).toContain('passiveServiceReady = Boolean(snapshot && settings && !serviceError)');
    expect(passive).toContain('passiveWriteTitle = passiveDisabledReason({ loading, busyId, serviceError, serviceReady: passiveServiceReady })');
    expect(passive).toContain('passiveControlDisabled = Boolean(passiveWriteTitle)');
    expect(passive).toContain('passiveWriteDisabled = passiveControlDisabled');
    expect(passive).toContain('passiveRefreshBlockedReason = passiveRefreshDisabledReason({ loading, busyId })');
    expect(passive).toContain('function passiveRefreshDisabledReason');
    expect(passive).toContain("title={passiveRefreshBlockedReason || 'Reload the latest Passive Tasks snapshot.'}");
    expect(passive).toContain('function passiveEngineLabel');
    expect(passive).toContain('function passiveScheduleLabel');
    expect(passive).toContain('function passiveBackupStatusLabel');
    expect(passive).toContain('function passiveCountLabel');
    expect(passive).toContain('if (!settings) return serviceError ?');
    expect(passive).toContain("if (!snapshot) return 'n/a'");
    expect(passive).toContain('<strong>{passiveEngineLabel()}</strong>');
    expect(passive).toContain('<strong>{passiveCountLabel(snapshot?.triggers.length ?? 0)}</strong>');
    expect(passive).toContain('function passiveDisabledReason');
    expect(passive).toContain('function requirePassiveReady');
    expect(passive).toContain('function cancelTask');
    expect(passive).toContain('Cancel passive task "${task.title}"?');
    expect(passive).toContain('Passive task cancellation skipped.');
    expect(passive).toContain('if (passiveConnectionError(nextError))');
    expect(passive).toContain('Passive Tasks API unavailable');
    expect(passive).toContain('Target: {getApiUrl()}. {localNetworkHint()}');
    expect(passive).toContain('disabled={passiveWriteDisabled}');
    expect(passive).toContain('title={passiveActionTitle');
    expect(passive).toContain('disabled={passiveWriteDisabled || !canRunTask(task, watcher)}');
    expect(passive).toContain("title={passiveActionTitle('Ask for confirmation before cancelling this passive task.')}");
    expect(passive).toContain('Load Passive Tasks before changing worker, watcher, task, card, notification, or settings state.');
  });

  it('keeps Productivity Google writes guarded while cached data remains inspectable', async () => {
    const source = await routeSource('../routes/productivity/+page.svelte');

    expect(source).toContain('productivityReady = canAct && googleConnected');
    expect(source).toContain("let actionBusyKey = ''");
    expect(source).toContain('productivityWriteDisabled = loading || !productivityReady || Boolean(actionBusyKey)');
    expect(source).toContain('productivityRefreshDisabled = loading || backgroundRefreshing || Boolean(actionBusyKey)');
    expect(source).toContain('productivityThreadOpenDisabled = Boolean(actionBusyKey)');
    expect(source).toContain('googleConnectDisabled = loading || !canAct || googleOAuthOpening || Boolean(actionBusyKey)');
    expect(source).toContain('function beginProductivityAction');
    expect(source).toContain('function endProductivityAction');
    expect(source).toContain('Another Productivity action is already running.');
    expect(source).toContain('Productivity is still loading the latest connection state.');
    expect(source).toContain('function productivityReadTitle');
    expect(source).toContain('function productivityValidatedActionTitle');
    expect(source).toContain('interface ProductivityStatusState');
    expect(source).toContain('productivityStatusState = {');
    expect(source).toContain('productivityWriteStatus = productivityWriteStateLabel(productivityStatusState)');
    expect(source).toContain('productivityWriteDetail = productivityWriteStateDetail(productivityStatusState)');
    expect(source).toContain('productivityReadStatus = productivityReadStateLabel(productivityStatusState)');
    expect(source).toContain('productivityReadDetail = productivityReadStateDetail(productivityStatusState)');
    expect(source).toContain('function productivityWriteStateLabel');
    expect(source).toContain('function productivityWriteStateDetail');
    expect(source).toContain('function productivityReadStateLabel');
    expect(source).toContain('function productivityReadStateDetail');
    expect(source).toContain('state.cacheLoadedAt');
    expect(source).toContain('Write Mode');
    expect(source).toContain('Read Mode');
    expect(source).toContain('Cached read-only');
    expect(source).toContain('Showing the last browser snapshot; live refresh, search, and edits wait for the local API and Google.');
    expect(source).toContain('OAuth, Gmail, and Calendar writes need the local API; cached rows stay readable.');
    expect(source).toContain('Use Connect Google or Add Google Account before sending mail or changing calendar events.');
    expect(source).toContain('function gmailReadTitle');
    expect(source).toContain('function calendarEventBlockTitle');
    expect(source).toContain('function moveEventTitle');
    expect(source).toContain('Move "${event.title}" from ${calendarName(event.calendarId)} to ${calendarName(moveTargetCalendarId)}?');
    expect(source).toContain('Calendar move skipped.');
    expect(source).toContain('Ask for confirmation before moving this event.');
    expect(source).toContain('function selectedLabelActionTitle');
    expect(source).toContain('function replyActionTitle');
    expect(source).toContain('function eventSaveActionTitle');
    expect(source).toContain('function composeActionTitle');
    expect(source).toContain('disabled={productivityWriteDisabled}');
    expect(source).toContain('title={calendarEventBlockTitle(event)}');
    expect(source).toContain('Open this event in Google Calendar.');
    expect(source).toContain("title={productivityReadTitle('Show the previous calendar week.')}");
    expect(source).toContain("title={productivityReadTitle('Jump the calendar window to today.')}");
    expect(source).toContain("title={productivityReadTitle('Show the next calendar week.')}");
    expect(source).toContain("title={gmailReadTitle('Filter priority Gmail threads.')}");
    expect(source).toContain('Choose a move target calendar first.');
    expect(source).toContain('Choose a Gmail label before applying it.');
    expect(source).toContain('Write a reply before saving or sending it.');
    expect(source).toContain('Add an event title before saving.');
    expect(source).toContain('Add at least one recipient before saving or sending.');
    expect(source).toContain("title={productivityActionTitle('Edit the event title.')}");
    expect(source).toContain("title={productivityActionTitle('Edit the message body.')}");
    expect(source).toContain('title="Close the event editor without saving changes."');
    expect(source).toContain('Open the cached thread preview. Connect the API and Google to fetch full messages.');
    expect(source).toContain('Showing cached thread preview. Connect the API and Google to fetch full messages, reply, label, or archive.');
    expect(source).toContain('cached productivity data can stay visible');
    expect(source).toContain('hubHref(routeMap.settings)');
    expect(source).toContain('disabled={productivityRefreshDisabled}');
  });

  it('keeps the Google OAuth callback recoverable if popup handoff stalls', async () => {
    const source = await routeSource('../routes/oauth/google/callback/+page.svelte');

    expect(source).toContain('<h1>Google OAuth</h1>');
    expect(source).toContain('googleOAuthRedirectForCurrentHub');
    expect(source).toContain('googleOAuthStateReturnTo');
    expect(source).toContain('storedReturnTo');
    expect(source).toContain('window.opener.postMessage');
    expect(source).toContain('Google OAuth did not return a usable authorization code.');
    expect(source).toContain('missing-code');
    expect(source).toContain("href={hubHref('/productivity')}");
    expect(source).toContain('Open Productivity');
    expect(source).toContain('Return to Productivity if Google OAuth does not redirect automatically.');
  });

  it('makes Activity recovery state scannable instead of one vague active count', async () => {
    const source = await routeSource('../routes/activity/+page.svelte');

    expect(source).toContain('runningRecords');
    expect(source).toContain('pausedRecords');
    expect(source).toContain('expectedActivitySources');
    expect(source).toContain("{ id: 'passive', label: 'Passive Tasks' }");
    expect(source).toContain('sourceHealthRows');
    expect(source).toContain('sourceFailures');
    expect(source).toContain('function fallbackActivitySources');
    expect(source).toContain('function compactActivitySourceError');
    expect(source).toContain("if (source.state === 'checking') return 'checking source status'");
    expect(source).toContain("const fallbackState: ActivitySourceState['state'] = state.loading || state.refreshing ? 'checking' : 'error'");
    expect(source).toContain('wrong endpoint or missing route');
    expect(source).toContain('service offline or unreachable');
    expect(source).toContain('browser blocked request');
    expect(source).toContain('function sourceHealthTitle');
    expect(source).toContain('title={sourceHealthTitle(source)}');
    expect(source).toContain('Checking source status from AI OS, Passive Tasks, and Macro Lab.');
    expect(source).toContain('No source snapshot yet; refresh Activity or open Settings.');
    expect(source).toContain('function activitySourceHealthSummary');
    expect(source).toContain('<strong>{sourceHealthRows.filter((source) => source.ok).length}/{sourceHealthRows.length}</strong>');
    expect(source).toContain('<span>Dismissed</span>');
    expect(source).toContain('Activity recovery model');
    expect(source).toContain('What comes back after you leave');
    expect(source).toContain('activityRecoveryRows');
    expect(source).toContain('activityRecoveryStats');
    expect(source).toContain('service-backed work areas');
    expect(source).toContain('browser cache layer');
    expect(source).toContain('cross-device via Hub API');
    expect(source).toContain('Data &amp; Recovery');
    expect(source).toContain('showing cached records from');
    expect(source).toContain('one source failed; available work is still listed');
    expect(source).toContain('function sourceReachable');
    expect(source).toContain('function activityActionKey');
    expect(source).toContain('refreshBlockedReason = activityRefreshBlockedReason({ loading, refreshing, busyKey })');
    expect(source).toContain('function activityRefreshBlockedReason');
    expect(source).toContain('function activityEmptyTitle');
    expect(source).toContain('No live activity loaded from reachable sources.');
    expect(source).toContain('function activityEmptyDetail');
    expect(source).toContain('Start or fix AI OS, Passive Tasks, or Macro Lab in Settings');
    expect(source).toContain('cached record');
    expect(source).toContain('function activityEmptyRefreshTitle');
    expect(source).toContain('function dismissedToggleTitle');
    expect(source).toContain('function restoreDismissedTitle');
    expect(source).toContain('function actionBlockedReason');
    expect(source).toContain('function activityActionTitle');
    expect(source).toContain('Another Activity action is already running.');
    expect(source).toContain('disabled={actionDisabled(record, action)}');
    expect(source).toContain('disabled={Boolean(refreshBlockedReason)}');
    expect(source).toContain('title={dismissedToggleTitle()}');
    expect(source).toContain('title={restoreDismissedTitle()}');
    expect(source).toContain("title={refreshBlockedReason || 'Refresh Activity records from connected sources.'}");
    expect(source).toContain('title={activityEmptyRefreshTitle()}');
    expect(source).toContain('title={activityActionTitle(record, action)}');
    expect(source).toContain('backend records are not deleted');
    expect(source).toContain('window.confirm(`Cancel "${record.title}" in ${record.sourceLabel}?');
    expect(source).toContain('Cancel skipped.');
    expect(source).toContain('asks for confirmation before stopping active work');
    expect(source).toContain("href={hubHref('/settings')}");
    expect(source).toContain('Open ${record.sourceLabel}; the backend may still show a setup or offline state.');
  });

  it('keeps Today recommendation actions tied to live capability readiness', async () => {
    const source = await routeSource('../routes/+page.svelte');

    expect(source).toContain('function modeActionBlockedReason');
    expect(source).toContain('AI OS is not reachable; open Settings to connect the local service.');
    expect(source).toContain('function modeActionDisabled');
    expect(source).toContain('disabled={modeActionDisabled(item)}');
    expect(source).toContain('title={modeActionBlockedReason(item) || item.action.label}');
    expect(source).toContain('function todayRefreshTitle');
    expect(source).toContain('title={todayRefreshTitle()}');
    expect(source).toContain('function todayCountLabel');
    expect(source).toContain("if ($attentionStore.loading && !attentionSnapshot) return '...'");
    expect(source).toContain("if (!attentionSnapshot) return 'n/a'");
    expect(source).toContain('<strong>{todayCountLabel(attentionItems.length)}</strong>');
    expect(source).toContain('function mailEmptyMessage');
    expect(source).toContain('Loading Gmail attention from the hub...');
    expect(source).toContain('function focusEmptyMessage');
    expect(source).toContain('Loading Career and Study attention from the hub...');
    expect(source).toContain('function systemEmptyMessage');
    expect(source).toContain('Loading local service and AI OS signals...');
    expect(source).toContain('cachedCoreRows =');
    expect(source).toContain('type ClientDataState');
    expect(source).toContain('saveStatusLabel = todaySaveStatusLabel($clientData)');
    expect(source).toContain('saveStatusDetail = todaySaveStatusDetail($clientData)');
    expect(source).toContain('lastSyncLabel = todayLastSyncLabel($clientData)');
    expect(source).toContain('function todaySaveStatusLabel');
    expect(source).toContain('function todaySaveStatusLabel(state: ClientDataState)');
    expect(source).toContain("if (state.status === 'error') return 'Needs attention';\n    if (!state.initialized) return 'Loading cache';");
    expect(source).toContain('function todaySaveStatusDetail');
    expect(source).toContain('function todaySaveStatusDetail(state: ClientDataState)');
    expect(source).toContain("if (state.error) return state.error;\n    if (!state.initialized) return 'Opening the browser cache and local workspace snapshot.';");
    expect(source).toContain('function todayLastSyncLabel');
    expect(source).toContain('function todayLastSyncLabel(state: ClientDataState)');
    expect(source).toContain("if (state.status === 'error') return 'needs review';");
    expect(source).toContain('Save & Recovery');
    expect(source).toContain('aria-label="Save and recovery status"');
    expect(source).toContain('Cached pages stay readable; saves wait for the Hub API.');
    expect(source).toContain('Research, AI OS, Passive, and Macro runs are recovered from Activity.');
    expect(source).toContain("href={hubHref('/activity')}");
    expect(source).toContain('Data Map');
  });

  it('keeps Career and Study inline edits read-only when save capability drops', async () => {
    const career = await routeSource('../routes/desk/career/+page.svelte');
    const study = await routeSource('../routes/desk/study/+page.svelte');

    expect(career).toContain('if (!canSave || saving || !company.trim() || !role.trim()) return');
    expect(career).toContain('if (!canSave || editingJobId || rowBusyId) return');
    expect(career).toContain('if (!canSave || !jobDraft.company.trim() || !jobDraft.role.trim()) return');
    expect(career).toContain('disabled={!canSave || rowBusyId === job.id}');
    expect(career).toContain('function careerSaveTitle');
    expect(career).toContain('function careerRowTitle');
    expect(career).toContain('function careerMailUpdatesTitle');
    expect(career).toContain('let careerSummaryLoading = false');
    expect(career).toContain('let careerExportLoading = false');
    expect(career).toContain('function careerSummaryTitle');
    expect(career).toContain('function careerExportTitle');
    expect(career).toContain('if (careerSummaryLoading) return');
    expect(career).toContain('if (careerExportLoading) return');
    expect(career).toContain('disabled={careerSummaryLoading}');
    expect(career).toContain('disabled={careerExportLoading}');
    expect(career).toContain("{careerSummaryLoading ? 'Scanning' : 'Scan'}");
    expect(career).toContain("{careerExportLoading ? 'Exporting' : 'Export'}");
    expect(career).toContain('Company and role are required before saving a job.');
    expect(career).toContain('disabled={!canSave || saving || !company.trim() || !role.trim()}');
    expect(career).toContain('title={saveJobEditTitle()}');
    expect(career).toContain('title={careerMailUpdatesTitle()}');
    expect(career).toContain('Delete "${job.role}" at ${job.company}?');
    expect(career).toContain('Career delete skipped.');
    expect(career).toContain('Ask for confirmation before deleting this saved job.');
    expect(career).toContain('Offline read-only: start or connect the Mini Hub API before saving Career changes.');
    expect(career).toContain("careerViewStorageKey = 'miniHub.career.view.v1'");
    expect(career).toContain('function hydrateCareerViewState');
    expect(career).toContain('Reloaded Career filters from this browser.');
    expect(career).toContain('success-banner');
    expect(study).toContain('if (!canSave || saving || !subject.trim() || minutes < 1) return');
    expect(study).toContain('if (!canSave || saving) return');
    expect(study).toContain('if (!canSave || editingSessionId || rowBusyId) return');
    expect(study).toContain('disabled={!canSave || rowBusyId === log.id}');
    expect(study).toContain('function studySaveTitle');
    expect(study).toContain('function studyRowTitle');
    expect(study).toContain('let studySummaryLoading = false');
    expect(study).toContain('function studySummaryTitle');
    expect(study).toContain('if (studySummaryLoading) return');
    expect(study).toContain('disabled={studySummaryLoading}');
    expect(study).toContain("{studySummaryLoading ? 'Scanning' : 'Scan'}");
    expect(study).toContain('Add a study label before logging progress.');
    expect(study).toContain('disabled={!canSave || saving || !subject.trim() || minutes < 1}');
    expect(study).toContain('title={saveLogEditTitle()}');
    expect(study).toContain('Delete ${log.minutes} min for "${log.subject}"?');
    expect(study).toContain('Study delete skipped.');
    expect(study).toContain('Ask for confirmation before deleting this saved study log.');
    expect(study).toContain('Offline read-only: start or connect the Mini Hub API before saving Study changes.');
    expect(study).toContain("studyViewStorageKey = 'miniHub.study.view.v1'");
    expect(study).toContain('function hydrateStudyViewState');
    expect(study).toContain('Reloaded Study filters and quick-log defaults from this browser.');
    expect(study).toContain('success-banner');
  });

  it('keeps the hub smoke script able to print a repeatable action and reload checklist', async () => {
    const source = await routeSource('../../../../scripts/hub-usability-smoke.mjs');

    expect(source).toContain('function printChecklist');
    expect(source).toContain("args.has('--checklist')");
    expect(source).toContain('safeActionLabels');
    expect(source).toContain('sampleInput');
    expect(source).toContain('expectedResult');
    expect(source).toContain('reloadProof');
    expect(source).toContain('requiredMarkers');
    expect(source).toContain('expectedStates');
    expect(source).toContain("id: 'stick-arena-lab'");
    expect(source).toContain("path: '/games/stick-arena-lab'");
    expect(source).toContain("id: 'google-oauth-callback'");
    expect(source).toContain("path: '/oauth/google/callback'");
    expect(source).toContain('function sourceMarkerStatus');
    expect(source).toContain('function missingMarkers');
    expect(source).toContain('function markerSummary');
    expect(source).toContain('stateCategoryPatterns');
    expect(source).toContain('function stateCategories');
    expect(source).toContain('function missingStateCategories');
    expect(source).toContain('function stateCategorySummary');
    expect(source).toContain('function missingScenarioFields');
    expect(source).toContain('function scenarioSummary');
    expect(source).toContain('function extractFormStates');
    expect(source).toContain('function formSummary');
    expect(source).toContain('function attrValue');
    expect(source).toContain('State markers');
    expect(source).toContain('State categories');
    expect(source).toContain('Scenario');
    expect(source).toContain('Forms');
    expect(source).toContain('unguardedForms');
    expect(source).toContain('Confirm required state/recovery markers');
    expect(source).toContain('Confirm expected state categories are visible');
    expect(source).toContain('missingMarkers(row).length');
    expect(source).toContain('missingStateCategories(row).length');
    expect(source).toContain('missingScenarioFields(row).length');
    expect(source).toContain('row.missingSafeActionRefs.length');
    expect(source).toContain('sourceStateCategories');
    expect(source).toContain('Live state categories found');
    expect(source).toContain('function extractButtonStates');
    expect(source).toContain('function extractLinkStates');
    expect(source).toContain('function stripMarkupTags');
    expect(source).toContain('function svelteExpressionText');
    expect(source).toContain('function cleanControlLabel');
    expect(source).toContain('function truncateLabel');
    expect(source).toContain('function controlSummary');
    expect(source).toContain('function ambiguousControls');
    expect(source).toContain('function ambiguousSummary');
    expect(source).toContain('function fetchRouteAttempt');
    expect(source).toContain('function safeActionStatus');
    expect(source).toContain('function safeActionSummary');
    expect(source).toContain('function liveSafeActionSummary');
    expect(source).toContain('function sourceSafeActionSummary');
    expect(source).toContain('missingLabels');
    expect(source).toContain('missingSafeActionRefs');
    expect(source).toContain('disabled/setup');
    expect(source).toContain('not-inspected');
    expect(source).toContain('function liveRenderState');
    expect(source).toContain('function liveHydrationState');
    expect(source).toContain('client-rendered shell');
    expect(source).toContain('client shell only; browser pass needed');
    expect(source).toContain('HUB_SMOKE_REQUIRE_HYDRATED');
    expect(source).toContain("args.has('--require-hydrated')");
    expect(source).toContain('rawNotFound');
    expect(source).toContain('retry:');
    expect(source).toContain('Live DOM snapshot');
    expect(source).toContain('Hydration status');
    expect(source).toContain('Hydration QA');
    expect(source).toContain('routing and raw Not Found leakage only');
    expect(source).toContain('Live links');
    expect(source).toContain('Source buttons');
    expect(source).toContain('Source links');
    expect(source).toContain('State surfaces');
    expect(source).toContain('Record visible controls/state surfaces');
    expect(source).toContain('Source state surfaces');
    expect(source).toContain('stateSurfaceRefPattern');
    expect(source).toContain('function stateSurfaceRefs');
    expect(source).toContain('function stateSurfaceSummary');
    expect(source).toContain('Ambiguous source controls needing labels/titles');
    expect(source).toContain('Ambiguous live controls needing browser inspection');
    expect(source).toContain('Source state snippets');
    expect(source).toContain('Exercise safe action');
    expect(source).toContain('Sample input/setup');
    expect(source).toContain('Expected result/output quality');
    expect(source).toContain('verify persistence');
    expect(source).toContain('Reload proof');
    expect(source).toContain('expectedBlockedState');
    expect(source).toContain('source links');
    expect(source).toContain('disabled-link refs');
    expect(source).toContain('enabled links');
    expect(source).toContain('row.links');
    expect(source).toContain('const sourceControls = [...sourceButtons, ...sourceLinks]');
    expect(source).toContain('sourceButtonLabels');
    expect(source).toContain('sourceLinkLabels');
    expect(source).toContain('sourceAmbiguousControls');
    expect(source).toContain('sourceIssueSnippets');
    expect(source).toContain('stateSurfaceRefs: surfaces');
    expect(source).toContain('stateSurfaces: surfaces.reduce');
  });

  it('explains Stick Arena lab loading and offline save controls', async () => {
    const games = await routeSource('../routes/games/+page.svelte');
    const source = await routeSource('../routes/games/stick-arena-lab/+page.svelte');

    expect(games).toContain('Games save and recovery status');
    expect(games).toContain('gameRunCount = $clientData.gameRuns.length');
    expect(games).toContain('gameStateCount = $clientData.gameStates.length');
    expect(games).toContain("gameSaveMode = $clientData.isOnline ? 'API-backed saves enabled' : 'Offline read-only'");
    expect(games).toContain('Supported game runs and state save through the Mini Hub API');
    expect(games).toContain('Games remain playable, but API-backed run/state saves are disabled');
    expect(games).toContain('Open Settings Data & Recovery for game cache and API status.');
    expect(games).toContain('title="Open Stick Arena Ability Lab."');
    expect(games).toContain('title="Open the legacy arcade."');
    expect(source).toContain('labReady = Boolean(lab)');
    expect(source).toContain('saveDisabled = !labReady || !canSave || saving');
    expect(source).toContain('resetDisabled = !labReady || labControlBusy');
    expect(source).toContain('if (!lab)');
    expect(source).toContain('Engine is still loading; wait for the lab before saving.');
    expect(source).toContain('Loading game engine: reset and save are disabled until the lab is ready.');
    expect(source).toContain('Offline read-only: the lab is playable');
    expect(source).toContain("href={hubHref('/settings')}");
    expect(source).toContain('disabled={resetDisabled}');
    expect(source).toContain('disabled={saveDisabled}');
    expect(source).toContain('clientData.saveGameRun');
    expect(source).toContain('clientData.saveGameState');
    expect(source).toContain('Telemetry');
  });

  it('shows Analytics refresh as a guarded async action with readable failures', async () => {
    const source = await routeSource('../routes/analytics/+page.svelte');

    expect(source).toContain('let refreshBusy = false');
    expect(source).toContain('if (refreshBusy) return');
    expect(source).toContain('refreshError = error instanceof Error');
    expect(source).toContain('cachedRecordCount = rows.reduce');
    expect(source).toContain('function analyticsCacheStatus');
    expect(source).toContain('function analyticsSyncDetail');
    expect(source).toContain('function analyticsRecordSummary');
    expect(source).toContain('aria-label="Analytics cache status"');
    expect(source).toContain('Last sync');
    expect(source).toContain('No completed sync recorded in this browser yet.');
    expect(source).toContain('disabled={refreshBusy}');
    expect(source).toContain("{refreshBusy ? 'Refreshing' : 'Refresh'}");
    expect(source).toContain("refreshError ? 'Refresh Failed'");
  });

  it('guards Settings sync, export, and endpoint actions with readable busy states', async () => {
    const source = await routeSource('../routes/settings/+page.svelte');

    expect(source).toContain('let serviceChecking = false');
    expect(source).toContain('let hubHealth: HubHealth | null = null');
    expect(source).toContain('let syncBusy = false');
    expect(source).toContain('let exportBusy = false');
    expect(source).toContain('let endpointSaving = false');
    expect(source).toContain('function capabilityRefreshTitle');
    expect(source).toContain('title={capabilityRefreshTitle()}');
    expect(source).toContain('function themeButtonTitle');
    expect(source).toContain("title={themeButtonTitle('dark')}");
    expect(source).toContain('function actionLedgerRefreshTitle');
    expect(source).toContain('title={actionLedgerRefreshTitle()}');
    expect(source).toContain('function restoreActionTitle');
    expect(source).toContain('title={restoreActionTitle(action)}');
    expect(source).toContain('function endpointInputTitle');
    expect(source).toContain("title={endpointInputTitle('AI OS API')}");
    expect(source).toContain('machineAiOsEndpointIssue = aiOsEndpointIssue(endpointResolutions)');
    expect(source).toContain("machineProfileControlBlockedReason('autotune', {");
    expect(source).toContain('function machineProfileControlBlockedReason');
    expect(source).toContain('AI OS is unavailable. Start AI OS or fix the endpoint, then retry the profile check.');
    expect(source).toContain('disabled={Boolean(machineAutotuneBlockedReason)}');
    expect(source).toContain('disabled={Boolean(machineSnapshotBlockedReason)}');
    expect(source).toContain("{machineProfileError && !machineProfile ? 'Retry Profile' : 'Refresh Profile'}");
    expect(source).toContain('passiveSettingsBlockedReason = passiveSettingsControlBlockedReason');
    expect(source).toContain('function passiveSettingsControlBlockedReason');
    expect(source).toContain('Passive Tasks API is reporting an error. Retry Passive settings before changing preferences.');
    expect(source).toContain('disabled={Boolean(passiveSettingsBlockedReason)}');
    expect(source).toContain("{passiveLoading ? 'Loading' : passiveError ? 'Retry Passive' : 'Refresh'}");
    expect(source).toContain('if (syncBusy || !$clientData.isOnline)');
    expect(source).toContain('disabled={syncBusy || !$clientData.isOnline}');
    expect(source).toContain('function syncNowTitle');
    expect(source).toContain('Sync is already running.');
    expect(source).toContain('function formatHubCoreDataHealth');
    expect(source).toContain('hubCoreDataStatus = formatHubCoreDataHealth(hubHealth)');
    expect(source).toContain('<div><dt>Core data</dt><dd>{hubCoreDataStatus}</dd></div>');
    expect(source).toContain('Persistent snapshot');
    expect(source).toContain('Memory-only for this API process');
    expect(source).toContain('disabled={exportBusy}');
    expect(source).toContain('disabled={endpointSaving}');
    expect(source).toContain("{endpointSaving ? 'Saving URLs' : 'Save Service URLs'}");
    expect(source).toContain('Offline read-only: start or connect the Mini Hub API before syncing.');
    expect(source).toContain('<strong>Data &amp; Recovery</strong>');
    expect(source).toContain('persistenceRows');
    expect(source).toContain('persistenceStats.crossDevice');
    expect(source).toContain('What survives refreshes, browser closes, route changes, and service outages.');
  });
});
