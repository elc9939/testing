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
  it('keeps route empty-state labels specific instead of bare None', async () => {
    const files = await routePageFiles();
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      const label = relative(routesRoot, file);
      expect(source, `${label} should use a specific empty-state label instead of "None"`).not.toMatch(/(["'`])None\1|>\s*None\s*</u);
    }
  });

  it('keeps the global save status recoverable from every route', async () => {
    const source = await routeSource('../routes/+layout.svelte');

    expect(source).toContain('function layoutSyncPillText');
    expect(source).toContain('function layoutSyncPillTitle');
    expect(source).toContain('syncPillText = layoutSyncPillText($clientData)');
    expect(source).toContain("if (!state.initialized) return 'Opening saved data'");
    expect(source).toContain('if (canAutoSave($clientData))');
    expect(source).toContain('function readPassiveEventLastRun');
    expect(source).toContain('function writePassiveEventLastRun');
    expect(source).toContain('Passive event throttling is best-effort; app startup should stay usable.');
    expect(source).toContain('Auto-save ready');
    expect(source).toContain('Offline read-only: cached pages stay readable, but save buttons wait for the Mini Hub API.');
    expect(source).toContain('Online auto-save ready. Last sync:');
    expect(source).toContain('Open Settings Data & Recovery for what survives closing the site.');
    expect(source).toContain('const dataRecoveryRoute = `${routeMap.settings}#data-recovery`');
    expect(source).toContain('class="sync-pill" href={hubHref(dataRecoveryRoute)}');
    expect(source).toContain('aria-label={`Save status: ${syncPillText}. Open Settings Data and Recovery.`}');
    expect(source).not.toContain('Loading cache');
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

  it('keeps every route button titled for hover and blocked-state clarity', async () => {
    const offenders: string[] = [];
    const pageFiles = await controlSurfaceFiles();

    for (const pageFile of pageFiles) {
      const source = await readFile(pageFile, 'utf8');
      const buttons = source.matchAll(/<button\b[\s\S]*?<\/button>/g);

      for (const button of buttons) {
        const open = firstTag(button[0]);
        if (!/\btitle=/.test(open)) {
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

  it('keeps route links titled for recovery and navigation clarity', async () => {
    const offenders: string[] = [];
    const pageFiles = await controlSurfaceFiles();

    for (const pageFile of pageFiles) {
      const source = await readFile(pageFile, 'utf8');
      const links = source.matchAll(/<a\b[\s\S]*?<\/a>/g);

      for (const link of links) {
        const open = firstTag(link[0]);
        if (!/\btitle=/.test(open)) {
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

  it('keeps route form controls self-explanatory', async () => {
    const offenders: string[] = [];
    const pageFiles = await controlSurfaceFiles();

    for (const pageFile of pageFiles) {
      const source = await readFile(pageFile, 'utf8');
      const controls = source.matchAll(/<(?:input|select|textarea)\b[\s\S]*?(?:<\/textarea>|<\/select>|>)/g);

      for (const control of controls) {
        const block = control[0];
        const hasExplanation = /\b(?:title|aria-describedby)=/.test(block);
        if (!hasExplanation) {
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
    expect(source).toContain("import { getBrowserStorage } from '$lib/browser-storage'");
    expect(source).toContain('const storage = getBrowserStorage()');
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
    expect(source).toContain('researchDraftForPersistence = {');
    expect(source).toContain('$: if (draftHydrated) persistResearchDraft(researchDraftForPersistence)');
    expect(source).toContain('function persistResearchDraft(nextDraft: ResearchDraftState = currentResearchDraft())');
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
    expect(source).toContain('Checking saved research runs.');
    expect(source).toContain('Saved reports will reload after the AI OS service card reconnects.');
    expect(source).toContain('function monitorEmptyMessage');
    expect(source).toContain('Checking saved topic monitors.');
    expect(source).toContain('Saved topic monitors will reload after the AI OS service card reconnects.');
    expect(source).toContain('function sourceLibraryEmptyMessage');
    expect(source).toContain('Checking archived source cards.');
    expect(source).toContain('Archived sources will reload after the AI OS service card reconnects.');
    expect(source).toContain('type ResearchReportSection');
    expect(source).toContain('function selectedReportSectionEmptyMessage');
    expect(source).toContain('function researchReportSectionLabel');
    expect(source).toContain("if (value === undefined || value === null || value === '') return 'not recorded'");
    expect(source).toContain("if (!value) return 'date not recorded'");
    expect(source).toContain("{source.author ?? 'not recorded'}");
    expect(source).toContain("{source.published_at ?? 'not recorded'}");
    expect(source).toContain('will appear after this ${selectedRun.status} run produces that part of the report.');
    expect(source).toContain('The run remains recoverable from Activity.');
    expect(source).toContain('Open logs or retry from Activity.');
    expect(source).toContain("selectedReportSectionEmptyMessage('tldr')");
    expect(source).toContain("selectedReportSectionEmptyMessage('reliability')");
    expect(source).toContain("selectedReportSectionEmptyMessage('detailedSummary')");
    expect(source).toContain("selectedReportSectionEmptyMessage('sourceTable')");
    expect(source).toContain("selectedReportSectionEmptyMessage('queryPlan')");
    expect(source).toContain("selectedReportSectionEmptyMessage('citations')");
    expect(source).not.toContain('No TLDR was generated yet.');
    expect(source).not.toContain('No reliability notes were recorded.');
    expect(source).not.toContain('No source table was recorded.');
    expect(source).not.toContain('No query-plan lists were recorded.');
    expect(source).not.toContain('No citations mapped yet.');
    expect(source).not.toContain("return 'n/a'");
    expect(source).not.toContain("?? 'n/a'");
    expect(source).toContain('Checking saved research monitors.');
    expect(source).toContain('Searching archived source cards.');
    expect(source).not.toContain('Reports are unavailable until AI OS is connected.');
    expect(source).not.toContain('Topic monitors are unavailable until AI OS is connected.');
    expect(source).not.toContain('Source Library is unavailable until AI OS is connected.');
    expect(source).not.toContain('Loading research monitors...');
    expect(source).not.toContain('Searching archived source cards...');
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
    expect(source).toContain("return aiOsUnavailable ? hubHref('/settings#feature-wiring') : researchExportUrl(run.id, format)");
    expect(source).toContain("href={hubHref('/settings#feature-wiring')}");
    expect(source).toContain('Exports need AI OS; these links open Settings Feature Wiring.');
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
    expect(source).toContain('interface AiLabControlState');
    expect(source).toContain('aiLabControlState = { sampleControlsDisabled }');
    expect(source).toContain('restoreSamplesButtonTitle = restoreSamplesTitle(aiLabControlState)');
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
    expect(source).toContain('title={restoreSamplesButtonTitle}');
    expect(source).toContain('disabled={Boolean(classifyBlockedReason)}');
    expect(source).toContain('disabled={Boolean(parseBlockedReason)}');
    expect(source).toContain('aria-busy={classifyBusy}');
    expect(source).toContain('aria-busy={parseBusy}');
    expect(source).toContain('AI Lab local capability status');
    expect(source).toContain('This lab is browser-local.');
    expect(source).toContain('AI Lab persistence rules');
    expect(source).toContain('Text, labels, code, and grammar URL reload from this browser when storage is available.');
    expect(source).toContain('Classifier and parser output is ad hoc test output; rerun the panel after refresh if you need it again.');
    expect(source).toContain('AI Lab does not create AI OS jobs, Activity records, or background tasks.');
    expect(source).toContain('.lab-persistence-strip');
    expect(source).toContain("import { getBrowserStorage } from '$lib/browser-storage'");
    expect(source).toContain('const storage = getBrowserStorage()');
    expect(source).toContain('draftStatus =');
    expect(source).toContain('Reloaded AI Lab inputs from this browser.');
    expect(source).toContain('class="result-grid"');
    expect(source).not.toContain('let busy = false');
  });

  it('keeps the assistant dock command controls explainable', async () => {
    const source = await routeSource('./AssistantDock.svelte');

    expect(source).toContain('sendBlockedReason = assistantSendBlockedReason');
    expect(source).toContain("assistantToggleTitle = open ? 'Close AI assistant.' : 'Open AI assistant.'");
    expect(source).toContain('function assistantSendBlockedReason');
    expect(source).toContain('Assistant is already working on the current request.');
    expect(source).toContain('Assistant is working on this request.');
    expect(source).toContain('<article class="message assistant" aria-live="polite">');
    expect(source).toContain('Type a message before sending.');
    expect(source).toContain('disabled={Boolean(sendBlockedReason)}');
    expect(source).toContain("title={sendBlockedReason || 'Send this message to the assistant.'}");
    expect(source).toContain('function exampleTitle');
    expect(source).toContain('function assistantActionTitle');
    expect(source).toContain("if (action.kind === 'navigate') return /^open\\b/iu.test(action.label) ? `${action.label}.` : `Open ${action.label}.`;");
    expect(source).toContain('title={exampleTitle(example)}');
    expect(source).toContain('disabled={busy}');
    expect(source).toContain('title={assistantActionTitle(action)}');
    expect(source).toContain('aria-label={open ? \'Close assistant\' : \'Open assistant\'} title={assistantToggleTitle}');
    expect(source).toContain('aria-label="Close assistant" title="Close AI assistant."');
    expect(source).toContain("const featureWiringAction: AssistantAction = { id: 'open-feature-wiring', label: 'Open Feature Wiring', kind: 'navigate', route: '/settings#feature-wiring' }");
    expect(source).toContain('actions: [\n          featureWiringAction,\n          { id:');
    expect(source).toContain("import { compactServiceIssueIfRecognized } from '$lib/service-issues'");
    expect(source).toContain('function rawErrorMessage');
    expect(source).toContain('function assistantIssueMessage');
    expect(source).toContain("return compactServiceIssueIfRecognized(raw, serviceLabel);");
    expect(source).toContain('Open Feature Wiring and retry the service check.');
    expect(source).toContain("text: `Memory search failed.\\n\\n${assistantIssueMessage(error, 'AI OS memory')}`");
    expect(source).toContain("text: `AI OS command failed.\\n\\n${assistantIssueMessage(error, 'AI OS command')}`");
    expect(source).toContain('text: localAssistantFallback(input, aiOsError, fallbackError),\n        actions: [featureWiringAction]');
    expect(source).toContain('Route ambiguous assistant requests through the AI OS command/tool planner when possible.');
    expect(source).toContain('Permit write or system tools only after an explicit confirmation pass.');
    expect(source).toContain('{currentMachineMode.shortLabel} - App helper');
    expect(source).toContain("const score = typeof hit.score === 'number' ? hit.score.toFixed(3) : 'score not returned'");
    expect(source).toContain("return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(1)}${suffix}` : 'not measured'");
    expect(source).not.toContain('Unknown error');
    expect(source).not.toContain("'n/a'");
    expect(source).not.toContain('Working...');
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
    expect(source).toContain('aiOsDefaultRefreshTitle = aiOsRefreshTitle(loading)');
    expect(source).toContain("aiOsCommandRefreshTitle = aiOsRefreshTitle(loading, 'Refresh AI OS status before running command actions.')");
    expect(source).toContain("aiOsProfileRefreshTitle = aiOsRefreshTitle(loading, 'Refresh AI OS status and machine profile.')");
    expect(source).toContain("aiOsAdvancedCommandRefreshTitle = aiOsRefreshTitle(loading, 'Refresh AI OS status before using advanced command controls.')");
    expect(source).toContain("visibleActionError = actionError ? compactServiceIssueIfRecognized(actionError, 'AI OS') :");
    expect(source).toContain('Raw AI OS error:');
    expect(source).toContain('connection-card service-card');
    expect(source).toContain('function aiOsActionTitle');
    expect(source).toContain('function foundationActionTitle');
    expect(source).toContain('function warmLocalModelBlockedReason');
    expect(source).toContain('function aiOsMetricLabel');
    expect(source).toContain('function aiOsCountLabel');
    expect(source).toContain("if (loading && !status) return 'checking'");
    expect(source).toContain("if (!status) return 'Refresh needed'");
    expect(source).not.toContain("if (!status) return 'not reported yet'");
    expect(source).toContain("return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(1)}${suffix}` : 'not measured'");
    expect(source).toContain('function aiOsRamDetail');
    expect(source).toContain('Service status is shown above; memory telemetry has not been checked.');
    expect(source).toContain('Memory telemetry not reported by AI OS.');
    expect(source).toContain('function aiOsGpuDetail');
    expect(source).toContain('GPU telemetry not reported');
    expect(source).toContain('VRAM not reported by AI OS');
    expect(source).toContain('temperature not reported by AI OS');
    expect(source).toContain('function aiOsModelSummary');
    expect(source).toContain('function noGpuRowsMessage');
    expect(source).toContain('function aiOsPanelEmptyMessage');
    expect(source).toContain('function machineProfileEmptyMessage');
    expect(source).toContain('function modelRowsEmptyMessage');
    expect(source).toContain('will reload after the Desktop service card reconnects.');
    expect(source).toContain('Machine profile will reload after the Desktop service card reconnects.');
    expect(source).toContain('Model load will reload after the Desktop service card reconnects.');
    expect(source).toContain('See the Desktop service card above for the connection error and fix actions.');
    expect(source).toContain('Provider state will reload after the Desktop service card reconnects.');
    expect(source).toContain('function providerRouteDetail');
    expect(source).toContain('function providerRouteTitle');
    expect(source).toContain("compactServiceIssueIfRecognized(error, provider.label)");
    expect(source).toContain('needs provider setup or a missing secret/API key in AI OS');
    expect(source).toContain("providerRouteDetail(ollama)");
    expect(source).toContain('<p title={providerRouteTitle(provider)}>{providerRouteDetail(provider)}</p>');
    expect(source).toContain('function hostSystemLabel');
    expect(source).toContain("return 'OS not reported by AI OS'");
    expect(source).toContain('function hostMachineLabel');
    expect(source).toContain("return metricString(host, 'machine') ?? 'machine type not reported by AI OS'");
    expect(source).toContain("return 'Waiting for report'");
    expect(source).not.toContain("return 'Not checked'");
    expect(source).toContain('GPU telemetry will reload after the Desktop service card reconnects.');
    expect(source).toContain('Checking model routes from AI OS.');
    expect(source).toContain('Checking app tools from AI OS.');
    expect(source).toContain("aiOsPanelEmptyMessage('No tool calls logged yet.', 'Checking AI OS tool calls.', 'Tool calls')");
    expect(source).toContain("aiOsPanelEmptyMessage('No benchmark runs yet.', 'Checking AI OS benchmark runs.', 'Benchmarks')");
    expect(source).toContain("aiOsPanelEmptyMessage('No design patches yet.', 'Checking AI OS design patch history.', 'Design patches')");
    expect(source).toContain('Checking AI OS jobs.');
    expect(source).toContain('Process this queued item for an ad hoc capability test: {item}');
    expect(source).not.toContain('placeholder capability test');
    expect(source).toContain('No verified AI OS backup recorded yet.');
    expect(source).toContain('Loading GPU telemetry rows from AI OS.');
    expect(source).toContain('Loading GPU, VRAM, and temperature telemetry.');
    expect(source).toContain('Service status is shown above; GPU telemetry has not been checked.');
    expect(source).toContain('Service status is shown above; model load has not been checked.');
    expect(source).toContain('Service status is shown above; GPU telemetry will appear after AI OS connects.');
    expect(source).toContain('No GPU telemetry rows returned yet. Refresh AI OS or check Windows/AMD telemetry setup.');
    expect(source).toContain('no GPU telemetry rows were returned from Windows counters or vendor tools');
    expect(source).not.toContain('Windows/NVIDIA GPU telemetry');
    expect(source).not.toContain("?? 'No GPU'");
    expect(source).not.toContain('AI OS is not connected, so GPU telemetry is not checked.');
    expect(source).not.toContain('AI OS API is not reachable yet.');
    expect(source).not.toContain('Machine profile is unavailable. Start AI OS or refresh once providers and telemetry are reachable.');
    expect(source).not.toContain('Unknown until AI OS is reachable.');
    expect(source).not.toContain('Unknown until AI OS can query Windows GPU counters.');
    expect(source).not.toContain('Unknown until AI OS can query Ollama /api/ps.');
    expect(source).not.toContain('Model load has not been checked yet.');
    expect(source).not.toContain('Connect AI OS to inspect GPU utilization, VRAM, and temperature.');
    expect(source).not.toContain('No backup yet');
    expect(source).not.toContain(' · ');
    expect(source).toContain('<strong>{aiOsMetricLabel(hardware?.cpu_percent,');
    expect(source).toContain('<small>{aiOsGpuDetail(primaryGpu)}</small>');
    expect(source).toContain("Suggested concurrency: ${result.profile.autotune.suggested_max_job_concurrency ?? 'not measured'}");
    expect(source).toContain('<strong>{hostSystemLabel(machineProfile.host)}</strong>');
    expect(source).toContain('<small>{hostMachineLabel(machineProfile.host)}</small>');
    expect(source).not.toContain("machineProfile.host.system ?? 'Unknown'");
    expect(source).not.toContain("machineProfile.host.machine ?? 'machine type not reported'");
    expect(source).toContain("autotuneResult = 'Running autotune probe.'");
    expect(source).toContain('tokens/sec not measured');
    expect(source).toContain("Schema {status?.integrity?.schema_version ?? 'not reported'} / {status?.integrity?.expected_schema_version ?? 'not reported'}");
    expect(source).not.toContain("'n/a'");
    expect(source).not.toContain('n/a tok/s');
    expect(source).not.toContain("return '...'");
    expect(source).not.toContain('Loading GPU telemetry rows from AI OS...');
    expect(source).toContain('<p class="muted">{noGpuRowsMessage()}</p>');
    expect(source).toContain('disabled={Boolean(warmupBlockedReason)}');
    expect(source).toContain('function requireAiOsReady');
    expect(source).toContain('disabled={commandBusy || aiOsActionBlocked}');
    expect(source).toContain('function aiOsCommandRunTitle');
    expect(source).toContain('function aiOsAutotuneActionTitle');
    expect(source).toContain('function aiOsDesignProposalTitle');
    expect(source).toContain('function aiOsBenchmarkActionTitle');
    expect(source).toContain('function aiOsInferenceActionTitle');
    expect(source).toContain('function aiOsJobQueueActionTitle');
    expect(source).toContain('function aiOsJobRefreshActionTitle');
    expect(source).toContain('function aiOsMemoryActionTitle');
    expect(source).toContain('function aiOsAgentActionTitle');
    expect(source).toContain('function aiOsMultimodalActionTitle');
    expect(source).toContain('title={aiOsCommandRunTitle()}');
    expect(source).toContain('Plan and run this AI OS command; tool calls, usage, and Activity records stay recoverable.');
    expect(source).toContain('benchmark data updates routing, mode recommendations, and Activity.');
    expect(source).toContain('progress, result, and errors reload from Jobs and Activity.');
    expect(source).toContain('provider, model, latency, and usage are logged by AI OS.');
    expect(source).not.toContain("title={aiOsActionBlockedReason || (commandBusy ? 'AI OS command is already running.' : 'Run this AI OS command.')}");
    expect(source).not.toContain("title={aiOsActionBlockedReason || (commandBusy ? 'AI OS command is already running.' : 'Execute this AI OS command.')}");
    expect(source).toContain('disabled={autotuneBusy || aiOsActionBlocked}');
    expect(source).toContain('disabled={designBusy || aiOsActionBlocked}');
    expect(source).toContain('disabled={benchmarkBusy || aiOsActionBlocked}');
    expect(source).toContain('title={aiOsDefaultRefreshTitle}');
    expect(source).toContain('title={aiOsCommandRefreshTitle}');
    expect(source).toContain('title={aiOsProfileRefreshTitle}');
    expect(source).toContain('title={aiOsAdvancedCommandRefreshTitle}');
    expect(source).toContain('function commandExampleTitle');
    expect(source).toContain('title={commandExampleTitle(example)}');
    expect(source).not.toContain('<button class="button" type="button" on:click={refresh}>');
    expect(source).toContain("title={foundationActionTitle('Create a verified AI OS backup now.')}");
    expect(source).toContain("title={foundationActionTitle('Verify the latest AI OS backup.', true)}");
    expect(source).toContain('title={aiOsInferenceActionTitle(false)}');
    expect(source).toContain('title={aiOsInferenceActionTitle(true)}');
    expect(source).toContain('title={aiOsJobQueueActionTitle()}');
    expect(source).toContain('title={aiOsJobRefreshActionTitle()}');
    expect(source).toContain("title={aiOsMemoryActionTitle('ingest')}");
    expect(source).toContain("title={aiOsMemoryActionTitle('search')}");
    expect(source).toContain('title={aiOsAgentActionTitle()}');
    expect(source).toContain('title={aiOsMultimodalActionTitle()}');
    expect(source).not.toContain("title={aiOsActionTitle('Run one ad hoc inference call.', inferBusy, 'Inference is already running.')}");
    expect(source).not.toContain("title={aiOsActionTitle('Queue this AI OS job.', jobBusy, 'A job queue request is already running.')}");
    expect(source).not.toContain("title={aiOsActionTitle('Ingest this scratch text into semantic memory.', memoryBusy, 'A memory action is already running.')}");
    expect(source).not.toContain("title={aiOsActionTitle('Run the generic agent loop.', agentBusy, 'Agent loop is already running.')}");
    expect(source).not.toContain("title={aiOsActionTitle('Invoke the selected multimodal capability.', multimodalBusy, 'Multimodal generation is already running.')}");
    expect(source).toContain('id="command-objective-primary"');
    expect(source).toContain('id="command-objective-advanced"');
    expect(source).toContain('id="command-confirm-primary"');
    expect(source).toContain('id="command-confirm-advanced"');
    expect(source).not.toContain('id="command-objective"');
    expect(source).not.toContain('id="command-confirm"');
    expect(source).toContain('function jobCancelBlockedReason');
    expect(source).toContain('function jobCancelTitle');
    expect(source).toContain('Another job cancellation is already running.');
    expect(source).toContain('Ask for confirmation before cancelling AI OS job ${job.id}. Saved Activity records remain recoverable.');
    expect(source).toContain('Cancel AI OS job "${job.id}"?');
    expect(source).toContain('AI OS job cancellation skipped.');
    expect(source).toContain('disabled={jobCancelDisabled(job)}');
    expect(source).toContain('title={jobCancelTitle(job)}');
    expect(source).toContain('function designPatchActionBlockedReason');
    expect(source).toContain('Arm apply/revert before modifying app files.');
    expect(source).toContain('function designPatchActionTitle');
    expect(source).toContain('Apply this reversible design patch. AI OS records the patch so it can be reverted.');
    expect(source).toContain('Revert this applied design patch using the saved AI OS patch record.');
    expect(source).toContain('function designPatchActionDisabled');
    expect(source).toContain("const blocked = designPatchActionBlockedReason(patch, 'apply')");
    expect(source).toContain("const blocked = designPatchActionBlockedReason(patch, 'revert')");
    expect(source).toContain("disabled={designPatchActionDisabled(patch, 'apply')}");
    expect(source).toContain("title={designPatchActionTitle(patch, 'apply')}");
    expect(source).toContain("disabled={designPatchActionDisabled(patch, 'revert')}");
    expect(source).toContain("title={designPatchActionTitle(patch, 'revert')}");
    expect(source).toContain('function backgroundActionBlockedReason');
    expect(source).toContain('Another ambient unit action is already running.');
    expect(source).toContain('function backgroundActionTitle');
    expect(source).toContain('Disable ${unit.label}; existing AI OS history remains recoverable.');
    expect(source).toContain('Enable ${unit.label}; it can run only from its configured ${unit.trigger} trigger.');
    expect(source).toContain('Run ${unit.label} once now through AI OS; Activity and AI OS logs will show the result.');
    expect(source).toContain("disabled={backgroundActionDisabled(unit, 'toggle')}");
    expect(source).toContain("disabled={backgroundActionDisabled(unit, 'run')}");
    expect(source).toContain("title={backgroundActionTitle(unit, 'toggle')}");
    expect(source).toContain("title={backgroundActionTitle(unit, 'run')}");
    expect(source).not.toContain("title={backgroundActionBlockedReason(unit, 'toggle') || 'Toggle ambient unit'}");
    expect(source).not.toContain("title={backgroundActionBlockedReason(unit, 'run') || 'Run ambient unit'}");
    expect(source).toContain("href={hubHref('/settings#feature-wiring')}");
  });

  it('guards Macro Lab and Passive task side-effect controls while state is unknown', async () => {
    const macro = await routeSource('../routes/macro-lab/+page.svelte');
    const passive = await routeSource('../routes/passive-tasks/+page.svelte');

    expect(macro).toContain('macroServiceReady = Boolean(status && !serviceError)');
    expect(macro).toContain('macroControlTitle = macroDisabledReason({ loading, busy, serviceError, status })');
    expect(macro).toContain("visibleServiceError = serviceError ? compactServiceIssueIfRecognized(serviceError, 'Macro Lab') :");
    expect(macro).toContain("visibleActionError = actionError ? compactServiceIssueIfRecognized(actionError, 'Macro Lab action') :");
    expect(macro).toContain('macroControlDisabled = Boolean(macroControlTitle)');
    expect(macro).toContain('macroRefreshBlockedReason = macroRefreshDisabledReason({ loading, busy })');
    expect(macro).toContain('function macroRefreshDisabledReason');
    expect(macro).toContain('function macroRowTitle');
    expect(macro).toContain('title={macroRowTitle(macro)}');
    expect(macro).toContain("title={macroRefreshBlockedReason || 'Reload Macro Lab state from the desktop service.'}");
    expect(macro).toContain('function requireMacroReady');
    expect(macro).toContain('function macroCapabilitiesDetail');
    expect(macro).toContain('function macroTriggersDetail');
    expect(macro).toContain('function macroDatabaseDetail');
    expect(macro).toContain('function macroEditorEmptyDetail');
    expect(macro).toContain('function macroDefinitionsEmptyMessage');
    expect(macro).toContain('function macroActionCatalogEmptyMessage');
    expect(macro).toContain('function macroRunHistoryEmptyMessage');
    expect(macro).toContain('function macroEditorBlockedTitle');
    expect(macro).toContain('function macroEditorTextareaTitle');
    expect(macro).toContain('function macroActionTitle');
    expect(macro).toContain('Select or create a macro before using ${action}.');
    expect(macro).toContain('Select or create a macro before editing its JSON definition.');
    expect(macro).toContain('Edit ${macro.name} JSON locally, then Save to persist it through Macro Lab.');
    expect(macro).toContain('Trigger Macro Lab panic: stop running automations and disable triggers until reset.');
    expect(macro).toContain('Arm ${name}; confirmed runs may execute system-level actions after the confirmation prompt.');
    expect(macro).toContain('Run ${name} in dry-run mode; Macro Lab should log a preview without desktop side effects.');
    expect(macro).toContain('Ask for confirmation before running ${name} with real desktop side effects; run history records the result.');
    expect(macro).toContain('Ask for confirmation before capturing keyboard and mouse input; Stop ends the recorder.');
    expect(macro).toContain("loading ? 'checking' : 'connect service'");
    expect(macro).toContain("engineState === 'connect service'");
    expect(macro).toContain("triggerState === 'connect service'");
    expect(macro).toContain("databaseState === 'connect service'");
    expect(macro).toContain('Checking action catalog and capability state.');
    expect(macro).toContain('Checking trigger and running automation state.');
    expect(macro).toContain('Checking macro definitions and run history.');
    expect(macro).toContain('Checking macro definitions before enabling edit and run controls.');
    expect(macro).toContain('Saved definitions and run history will reload after the Macro Lab service card reconnects.');
    expect(macro).toContain('Saved macro definitions will reload after the Macro Lab service card reconnects.');
    expect(macro).toContain('Checking saved macro definitions.');
    expect(macro).toContain('Checking action catalog.');
    expect(macro).toContain('Checking recent Macro Lab runs.');
    expect(macro).toContain('Action catalog will reload after the Macro Lab service card reconnects.');
    expect(macro).toContain('Run history will reload after the Macro Lab service card reconnects.');
    expect(macro).toContain('Connect Macro Lab to load saved macro definitions before creating or editing macros.');
    expect(macro).toContain('No macros are registered yet. Use the New macro button above, then save the definition through Macro Lab.');
    expect(macro).toContain('Connect Macro Lab to inspect available action types.');
    expect(macro).toContain('Macro Lab is reachable, but its action catalog is empty; check the desktop service install.');
    expect(macro).toContain('Activity run ${highlightedRunId} is not in Macro Lab');
    expect(macro).toContain('{macroDefinitionsEmptyMessage()}');
    expect(macro).toContain('{macroActionCatalogEmptyMessage()}');
    expect(macro).toContain('{macroRunHistoryEmptyMessage()}');
    expect(macro).not.toContain("serviceError ? 'Saved macro definitions will reload");
    expect(macro).not.toContain("serviceError ? 'Action catalog will reload");
    expect(macro).not.toContain("serviceError ? 'Run history will reload");
    expect(macro).not.toContain('No action types are registered yet.');
    expect(macro).not.toContain('Create one with the plus button.');
    expect(macro).not.toContain('Loading action catalog and capability state.');
    expect(macro).not.toContain('Loading trigger and running automation state.');
    expect(macro).not.toContain('Loading macro definitions and run history.');
    expect(macro).not.toContain('Loading macro definitions from Macro Lab...');
    expect(macro).not.toContain('Loading action catalog...');
    expect(macro).not.toContain('Loading recent Macro Lab runs...');
    expect(macro).not.toContain('Run history is unavailable until Macro Lab responds.');
    expect(macro).not.toContain("'not checked'");
    expect(macro).toContain('if (macroConnectionError(message)) {');
    expect(macro).toContain("actionError = ''");
    expect(macro).toContain('connection-card service-card');
    expect(macro).toContain('Macro Lab connection failed');
    expect(macro).toContain('Raw Macro Lab service error:');
    expect(macro).toContain('Raw Macro Lab action error:');
    expect(macro).toContain("href={hubHref('/settings#feature-wiring')}");
    expect(macro).toContain('function confirmMacroSideEffectRun');
    expect(macro).toContain('window.confirm(');
    expect(macro).toContain('Confirmed macro run skipped.');
    expect(macro).toContain('Start Macro Lab recording? Keyboard and mouse events will be captured until you press Stop.');
    expect(macro).toContain('Macro recording skipped.');
    expect(macro).toContain('!dryRun && confirm && !confirmMacroSideEffectRun(selectedMacro)');
    expect(macro).toContain("title={macroActionTitle('panic')}");
    expect(macro).toContain("title={macroActionTitle('toggle-armed', selectedMacro)}");
    expect(macro).toContain("title={macroActionTitle('dry-run', selectedMacro)}");
    expect(macro).toContain("title={macroActionTitle('run-confirmed', selectedMacro)}");
    expect(macro).toContain("title={macroActionTitle('record')}");
    expect(macro).toContain('disabled={macroControlDisabled} spellcheck="false" title={macroEditorTextareaTitle(selectedMacro)}');
    expect(macro).not.toContain("title={macroControlTitle || 'Ask for confirmation before running this macro with real desktop side effects.'}");
    expect(macro).not.toContain("title={macroControlTitle || 'Ask for confirmation before recording keyboard and mouse input.'}");
    expect(macro).not.toContain("title={macroControlTitle || 'Toggle the explicit armed state for system-level actions.'}");
    expect(macro).not.toContain("title={macroControlTitle || 'Run this macro without side effects.'}");
    expect(macro).not.toContain('title="Edit the selected macro definition JSON. Saving is disabled until Macro Lab state is loaded."');
    expect(macro).toContain("title={macroEditorBlockedTitle('dry run')}");
    expect(macro).toContain("title={macroEditorBlockedTitle('confirmed run')}");
    expect(macro).toContain('disabled={macroControlDisabled}');
    expect(passive).toContain('passiveServiceReady = Boolean(snapshot && settings && !serviceError)');
    expect(passive).toContain('passiveWriteTitle = passiveDisabledReason({ loading, busyId, serviceError, serviceReady: passiveServiceReady })');
    expect(passive).toContain("visibleServiceError = serviceError ? compactServiceIssueIfRecognized(serviceError, 'Passive Tasks API') :");
    expect(passive).toContain("visibleActionError = actionError ? compactServiceIssueIfRecognized(actionError, 'Passive Tasks action') :");
    expect(passive).toContain('passiveControlDisabled = Boolean(passiveWriteTitle)');
    expect(passive).toContain('passiveWriteDisabled = passiveControlDisabled');
    expect(passive).toContain('passiveRefreshBlockedReason = passiveRefreshDisabledReason({ loading, busyId })');
    expect(passive).toContain('rawDigestCards = topPassiveCards(snapshot)');
    expect(passive).toContain('summarizedDigestCards = rawDigestCards.filter');
    expect(passive).toContain('digestCards = rawDigestCards.filter');
    expect(passive).toContain('summarizedResultRows = rawResultRows.filter');
    expect(passive).toContain('sourceIssueSummary = summarizedServiceIssueLine');
    expect(passive).toContain('function summarizedServiceIssueCard');
    expect(passive).toContain('function summarizedServiceIssueLine');
    expect(passive).toContain('function passiveInlineIssue');
    expect(passive).toContain('Raw Passive Tasks service error:');
    expect(passive).toContain('Raw Passive source error:');
    expect(passive).toContain('Raw Passive trigger error:');
    expect(passive).toContain('Raw Passive worker error:');
    expect(passive).toContain('Raw Passive run error:');
    expect(passive).toContain('repeated service issue card');
    expect(passive).toContain('shown in Source Health instead');
    expect(passive).toContain('compact-service-note');
    expect(passive).toContain('function passiveRefreshDisabledReason');
    expect(passive).toContain("title={passiveRefreshBlockedReason || 'Reload the latest Passive Tasks snapshot.'}");
    expect(passive).toContain('function passiveEngineLabel');
    expect(passive).toContain('function passiveScheduleLabel');
    expect(passive).toContain('function passiveBackupStatusLabel');
    expect(passive).toContain('function passiveCountLabel');
    expect(passive).toContain('function passivePanelEmptyMessage');
    expect(passive).toContain('function passiveRecentRunsEmptyMessage');
    expect(passive).toContain('This panel will reload after the Passive Tasks service card reconnects.');
    expect(passive).toContain('Run history will reload after the Passive Tasks service card reconnects.');
    expect(passive).toContain('Checking Passive Tasks snapshot.');
    expect(passive).toContain('Checking recent passive results.');
    expect(passive).toContain('Checking passive worker state.');
    expect(passive).toContain('Checking passive settings.');
    expect(passive).toContain("if (!settings) return 'Refresh needed'");
    expect(passive).toContain("return snapshot ? 'Refresh backup check' : 'Refresh needed'");
    expect(passive).toContain("if (loading && !snapshot) return 'checking'");
    expect(passive).toContain("if (!snapshot) return 'refresh needed'");
    expect(passive).toContain('Passive Tasks needs a fresh snapshot. Use Refresh or open Settings Feature Wiring.');
    expect(passive).toContain('Passive Tasks run history needs a fresh snapshot. Use Refresh or open Settings Feature Wiring.');
    expect(passive).toContain("if (!snapshot) return 'Refresh needed'");
    expect(passive).toContain("if (!worker?.startedAt) return 'Waiting for startup'");
    expect(passive).toContain("if (!worker?.lastIdle) return 'Waiting for first idle check'");
    expect(passive).toContain("trigger.lastStatus ? passiveRunStatusLabel(trigger.lastStatus) : 'waiting for first trigger'");
    expect(passive).not.toContain("return 'Not checked'");
    expect(passive).not.toContain('Load snapshot');
    expect(passive).not.toContain('Backup health not reported');
    expect(passive).not.toContain("return 'Not started'");
    expect(passive).not.toContain('No idle probe yet');
    expect(passive).not.toContain('not fired yet');
    expect(passive).not.toContain("'No backup health'");
    expect(passive).toContain("if (typeof value !== 'number' || !Number.isFinite(value)) return 'not measured'");
    expect(passive).toContain('function passiveDigestEmptyMessage');
    expect(passive).toContain('summarized in Source Health instead of repeating here.');
    expect(passive).toContain('{passiveDigestEmptyMessage()}');
    expect(passive).toContain('Checking passive task outputs.');
    expect(passive).toContain('No entity changes recorded for this snapshot.');
    expect(passive).toContain('No run timing, backup, or cleanup evidence recorded yet.');
    expect(passive).not.toContain("return '...'");
    expect(passive).not.toContain("return 'n/a'");
    expect(passive).not.toContain('No entity summary yet');
    expect(passive).not.toContain('No run evidence yet');
    expect(passive).not.toContain('Passive Tasks API is offline; this panel will load after the service reconnects.');
    expect(passive).not.toContain('Loading recent passive results.');
    expect(passive).not.toContain('Loading passive worker state.');
    expect(passive).not.toContain('Loading passive settings.');
    expect(passive).not.toContain('{:else if loading}');
    expect(passive).not.toContain('Loading passive task outputs.');
    expect(passive).not.toContain('Loading passive task outputs...');
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
    expect(passive).toContain("href={hubHref('/settings#feature-wiring')}");
    expect(passive).toContain("href={hubHref('/settings#data-recovery')}");
    expect(passive).toContain('Open Settings Data & Recovery for restore-point and backup details.');
    expect(passive).toContain('disabled={passiveWriteDisabled}');
    expect(passive).toContain('function passiveActionTitle');
    expect(passive).toContain('function passiveManualRunTitle');
    expect(passive).toContain("title={passiveManualRunTitle('due')}");
    expect(passive).toContain("title={passiveManualRunTitle('startup')}");
    expect(passive).toContain("title={passiveManualRunTitle('idle')}");
    expect(passive).toContain('function passiveDigestActionTitle');
    expect(passive).toContain("title={passiveDigestActionTitle('important')}");
    expect(passive).toContain("title={passiveDigestActionTitle('snoozed')}");
    expect(passive).toContain("title={passiveDigestActionTitle('reviewed')}");
    expect(passive).toContain("title={passiveDigestActionTitle('dismissed')}");
    expect(passive).toContain('function passiveEngineTitle');
    expect(passive).toContain('function passiveWatcherTitle');
    expect(passive).toContain('function passiveTaskResumeTitle');
    expect(passive).toContain('function passiveTaskPauseTitle');
    expect(passive).toContain('function passiveTaskCancelTitle');
    expect(passive).toContain('function passiveNotificationDismissTitle');
    expect(passive).toContain('function passiveSettingsSaveTitle');
    expect(passive).toContain('function passivePreferenceTitle');
    expect(passive).toContain('function passiveFamilyControlTitle');
    expect(passive).toContain('function passiveScopeTitle');
    expect(passive).toContain('run history and Activity');
    expect(passive).toContain('recoverable run history');
    expect(passive).toContain('future watcher runs');
    expect(passive).toContain('Server-backed scopes reload from the Passive Tasks API.');
    expect(passive).toContain('Recent runs, digest cards, and Activity handoffs remain recoverable after route changes.');
    expect(passive).toContain('aria-label="Passive settings recovery"');
    expect(passive).toContain("title={passivePreferenceTitle('notifications')}");
    expect(passive).toContain("title={passivePreferenceTitle('resource')}");
    expect(passive).toContain("title={passivePreferenceTitle('idle')}");
    expect(passive).toContain("title={passivePreferenceTitle('ai')}");
    expect(passive).toContain("title={passivePreferenceTitle('maxRuns')}");
    expect(passive).toContain('title={passiveFamilyControlTitle(family)}');
    expect(passive).toContain("title={passiveScopeTitle('folders')}");
    expect(passive).toContain("title={passiveScopeTitle('research')}");
    expect(passive).toContain("title={passiveScopeTitle('accounts')}");
    expect(passive).toContain('disabled={passiveWriteDisabled || !canRunTask(task, watcher)}');
    expect(passive).toContain('title={passiveTaskCancelTitle(task)}');
    expect(passive).toContain('Load Passive Tasks before changing worker, watcher, task, card, notification, or settings state.');
    expect(passive).toContain("{loading ? 'Refreshing' : 'Refresh'}");
    expect(passive).toContain('<span>Run Due</span>');
    expect(passive).toContain('<span>Startup Event</span>');
    expect(passive).toContain('<span>Idle Tick</span>');
    expect(passive).not.toContain("title={passiveActionTitle('Run due passive tasks now.')}");
    expect(passive).not.toContain("title={passiveActionTitle('Mark important')}");
    expect(passive).not.toContain("title={passiveActionTitle('Dismiss')}");
    expect(passive).not.toContain("title={passiveActionTitle('Save passive task settings.')}");
    expect(passive).toContain('Task Failure Log');
    expect(passive).toContain('No retained task failures right now.');
    expect(passive).not.toContain('Task Error Logs');
    expect(passive).not.toContain('Load First');
  });

  it('keeps Productivity Google writes guarded while cached data remains inspectable', async () => {
    const source = await routeSource('../routes/productivity/+page.svelte');

    expect(source).toContain('productivityReady = canAct && googleConnected');
    expect(source).toContain("apiChecking = !$clientData.initialized || $clientData.status === 'syncing'");
    expect(source).toContain("let actionBusyKey = ''");
    expect(source).toContain('productivityWriteDisabled = loading || !productivityReady || Boolean(actionBusyKey)');
    expect(source).toContain('productivityRefreshDisabled = loading || backgroundRefreshing || Boolean(actionBusyKey)');
    expect(source).toContain('productivityEventInspectDisabled = Boolean(actionBusyKey)');
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
    expect(source).toContain('productivityApiBannerText = apiChecking');
    expect(source).toContain('interface ProductivityControlTitleState extends ProductivityStatusState');
    expect(source).toContain('productivityControlTitleState = {');
    expect(source).toContain('productivityRefreshButtonTitle = productivityRefreshTitle(productivityControlTitleState)');
    expect(source).toContain('gmailRefreshButtonTitle = gmailRefreshTitle(productivityControlTitleState)');
    expect(source).toContain('gmailThreadOpenButtonTitle = gmailThreadOpenTitle(productivityControlTitleState)');
    expect(source).toContain('function gmailThreadReadActionTitle');
    expect(source).toContain('function gmailThreadImportantActionTitle');
    expect(source).toContain('function gmailThreadArchiveActionTitle');
    expect(source).toContain('selectedLabelButtonTitle = selectedLabelActionTitle(productivityControlTitleState)');
    expect(source).toContain('replyDraftButtonTitle = replyActionTitle(productivityControlTitleState, false)');
    expect(source).toContain('replySendButtonTitle = replyActionTitle(productivityControlTitleState, true)');
    expect(source).toContain('eventSaveButtonTitle = eventSaveActionTitle(productivityControlTitleState)');
    expect(source).toContain('composeDraftButtonTitle = composeActionTitle(productivityControlTitleState, false)');
    expect(source).toContain('composeSendButtonTitle = composeActionTitle(productivityControlTitleState, true)');
    expect(source).toContain('eventCalendarSelectDisabled = productivityWriteDisabled || Boolean(editingEventId)');
    expect(source).toContain('eventCalendarSelectTitle = eventCalendarActionTitle(productivityControlTitleState)');
    expect(source).toContain('visibleActionError = actionError ? compactProductivityServiceIssue(actionError) :');
    expect(source).toContain('function compactProductivityServiceIssue');
    expect(source).toContain('Google blocked OAuth for this account; add the account as a tester or use a verified OAuth app.');
    expect(source).toContain("compactServiceIssueIfRecognized(text, 'Productivity')");
    expect(source).toContain('Productivity action needs attention');
    expect(source).toContain('Raw Productivity error:');
    expect(source).toContain('title={productivityRefreshButtonTitle}');
    expect(source).toContain('title={gmailRefreshButtonTitle}');
    expect(source).toContain('title={gmailThreadOpenButtonTitle}');
    expect(source).toContain('title={gmailThreadReadActionTitle(thread)}');
    expect(source).toContain('title={gmailThreadImportantActionTitle(thread)}');
    expect(source).toContain('title={gmailThreadArchiveActionTitle(thread)}');
    expect(source).toContain('title={gmailThreadReadActionTitle(selectedGmailThread)}');
    expect(source).toContain('title={gmailThreadImportantActionTitle(selectedGmailThread)}');
    expect(source).toContain('title={gmailThreadArchiveActionTitle(selectedGmailThread)}');
    expect(source).toContain('title={selectedLabelButtonTitle}');
    expect(source).toContain('title={eventSaveButtonTitle}');
    expect(source).toContain('function productivityWriteStateLabel');
    expect(source).toContain('function productivityWriteStateDetail');
    expect(source).toContain('function productivityReadStateLabel');
    expect(source).toContain('function productivityReadStateDetail');
    expect(source).toContain('state.cacheLoadedAt');
    expect(source).toContain("let cacheWarning = ''");
    expect(source).toContain("import { getBrowserStorage } from '$lib/browser-storage'");
    expect(source).toContain("const storage = getBrowserStorage('session')");
    expect(source).toContain('const storage = getBrowserStorage()');
    expect(source).toContain('productivityCacheDetail = cacheWarning');
    expect(source).toContain('Browser productivity cache is unavailable');
    expect(source).toContain('Browser productivity cache could not be updated');
    expect(source).toContain('No browser cache snapshot yet');
    expect(source).toContain('No Google accounts connected');
    expect(source).toContain('{#if cacheWarning}');
    expect(source).toContain('Write Mode');
    expect(source).toContain('Read Mode');
    expect(source).toContain('Checking connections');
    expect(source).toContain('Waiting for API, Google, Gmail, and Calendar state before enabling writes.');
    expect(source).toContain('Opening cache');
    expect(source).toContain('Opening cached productivity data first, then live Google data when available.');
    expect(source).toContain('Checking API');
    expect(source).toContain('Opening the browser cache and checking the Mini Hub API before enabling OAuth or writes.');
    expect(source).toContain('Checking the Mini Hub API before loading live Gmail and Calendar data.');
    expect(source).toContain('Cached read-only');
    expect(source).toContain('Showing the last browser snapshot; live refresh, search, and edits wait for the local API and Google.');
    expect(source).toContain('OAuth, Gmail, and Calendar writes need the local API; cached rows stay readable.');
    expect(source).toContain('Use Connect Google or Add Google Account before sending mail or changing calendar events.');
    expect(source).toContain('function gmailReadTitle');
    expect(source).toContain('function calendarWindowSummary');
    expect(source).toContain('Checking cached calendar events before live Google refresh.');
    expect(source).toContain('No cached events in this window while the API check continues.');
    expect(source).toContain('No live Google Calendar events in this window.');
    expect(source).toContain('No cached calendar events match this range; connect the API and Google to refresh live Calendar.');
    expect(source).toContain('No live Google Calendar events match this range. Try another week, search, or calendar.');
    expect(source).toContain('function calendarTableEmptyMessage');
    expect(source).toContain('function priorityInboxEmptyMessage');
    expect(source).toContain('Checking cached Gmail threads and connected accounts.');
    expect(source).toContain('No cached priority Gmail threads; connect the API and Google to refresh live Gmail.');
    expect(source).toContain('function timelineEmptyMessage');
    expect(source).toContain('Checking cached timeline items and connected deadlines.');
    expect(source).toContain('No cached timeline items; connect the API and Google to refresh live deadlines.');
    expect(source).toContain('<span>{calendarWindowSummary()}</span>');
    expect(source).toContain('<tr><td colspan="4" class="muted">{calendarTableEmptyMessage()}</td></tr>');
    expect(source).toContain('<tr><td colspan="6" class="muted">{priorityInboxEmptyMessage()}</td></tr>');
    expect(source).toContain('<tr><td colspan="4" class="muted">{timelineEmptyMessage()}</td></tr>');
    expect(source).toContain('function calendarEventBlockTitle');
    expect(source).toContain('Open cached event details. Connect the API and Google to edit or save.');
    expect(source).toContain('Showing cached event details. Connect the API and Google to edit, move, delete, or save.');
    expect(source).toContain('function moveEventTitle');
    expect(source).toContain('Move "${event.title}" from ${calendarName(event.calendarId)} to ${calendarName(moveTargetCalendarId)}? This updates the live Google Calendar event.');
    expect(source).toContain('Calendar move skipped.');
    expect(source).toContain('Ask for confirmation before moving this event.');
    expect(source).toContain('function eventCalendarActionTitle');
    expect(source).toContain('Existing events keep their current calendar in this editor. Use the row Move action for a confirmed Google Calendar move.');
    expect(source).toContain('Choose the Google Calendar for this new event.');
    expect(source).toContain('function syncEventDraftCalendarMeta');
    expect(source).toContain('calendarId: eventDraft.calendarId || selectedCalendarId');
    expect(source).toContain('const savedDraft = draftForApi()');
    expect(source).toContain('selectedCalendarId = savedDraft.calendarId');
    expect(source).toContain('Ask for confirmation before revoking this Google account connection.');
    expect(source).toContain('Revoke ${label} for this hub? Live Gmail and Calendar actions for that account will stop until you connect it again.');
    expect(source).toContain('Ask for confirmation before deleting this Google Calendar event.');
    expect(source).toContain('Delete "${event.title}" from ${calendarName(event.calendarId)}? This removes the live Google Calendar event.');
    expect(source).toContain('Ask for confirmation before sending this Gmail message.');
    expect(source).toContain('Send email to ${composeDraft.to.join(\', \')}? This sends through Gmail now.');
    expect(source).toContain('Ask for confirmation before sending this Gmail reply.');
    expect(source).toContain('Send reply to "${selectedGmailThread.subject}"? This sends through Gmail now.');
    expect(source).toContain('function selectedLabelActionTitle');
    expect(source).toContain('function replyActionTitle');
    expect(source).toContain('function eventSaveActionTitle');
    expect(source).toContain('disabled={eventCalendarSelectDisabled}');
    expect(source).toContain('title={eventCalendarSelectTitle}');
    expect(source).toContain('bind:value={eventDraft.calendarId}');
    expect(source).toContain('function composeActionTitle');
    expect(source).toContain('disabled={productivityWriteDisabled}');
    expect(source).toContain('disabled={productivityEventInspectDisabled}');
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
    expect(source).toContain('it leaves the priority queue and the browser cache refreshes');
    expect(source).toContain('this does not delete it, and the priority list plus browser cache refresh afterward');
    expect(source).toContain('Remove the IMPORTANT label');
    expect(source).toContain('cached productivity data can stay visible');
    expect(source).toContain("googleOAuthOpening ? 'Opening sign-in'");
    expect(source).not.toContain('No local cache yet');
    expect(source).not.toContain(": 'None'}</strong>");
    expect(source).toContain('Opening Google sign-in.');
    expect(source).not.toContain("googleOAuthOpening ? 'Opening...'");
    expect(source).not.toContain('Opening Google sign-in...');
    expect(source).not.toContain('No events loaded for this window yet.');
    expect(source).not.toContain('No events found in this window.');
    expect(source).not.toContain('No events found in this range.');
    expect(source).not.toContain('No timeline items loaded yet.');
    expect(source).not.toContain("title={productivityActionTitle(thread.unread ? 'Mark read' : 'Mark unread')}");
    expect(source).not.toContain("title={productivityActionTitle(isThreadImportant(thread) ? 'Remove important' : 'Mark important')}");
    expect(source).not.toContain("title={productivityActionTitle('Archive')}");
    expect(source).not.toContain("title={productivityActionTitle('Toggle read state')}");
    expect(source).not.toContain("title={productivityActionTitle('Toggle important state')}");
    expect(source).not.toContain("title={productivityActionTitle('Archive selected thread')}");
    expect(source).not.toContain('bind:value={selectedCalendarId} disabled={productivityWriteDisabled}');
    expect(source).toContain('{productivityApiBannerText}');
    expect(source).toContain("href={hubHref('/settings#feature-wiring')}");
    expect(source).toContain('disabled={productivityRefreshDisabled}');
  });

  it('keeps the Google OAuth callback recoverable if popup handoff stalls', async () => {
    const source = await routeSource('../routes/oauth/google/callback/+page.svelte');

    expect(source).toContain('<h1>Google OAuth</h1>');
    expect(source).toContain('googleOAuthRedirectForCurrentHub');
    expect(source).toContain('googleOAuthStateReturnTo');
    expect(source).toContain('storedReturnTo');
    expect(source).toContain("import { getBrowserStorage } from '$lib/browser-storage'");
    expect(source).toContain("const storage = getBrowserStorage('session')");
    expect(source).toContain('window.opener.postMessage');
    expect(source).toContain('function showManualResult');
    expect(source).toContain('Google OAuth did not return a usable authorization code.');
    expect(source).toContain('missing-code');
    expect(source).toContain('showManualResult(result)');
    expect(source).toContain('href={returnHref}');
    expect(source).toContain('Open Productivity');
    expect(source).toContain('Open Productivity with the Google OAuth result message.');
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
    expect(source).toContain('Activity needs a fresh source check. Refresh Activity or open Settings Feature Wiring.');
    expect(source).toContain('function activitySourceHealthSummary');
    expect(source).toContain("if (!state.hasSourceSnapshot) return state.loading || state.refreshing ? 'Checking' : 'Refresh needed'");
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
    expect(source).toContain('activityRecoveryNotes = activitySnapshotRecoveryNotes(snapshot)');
    expect(source).toContain('visibleActivityError = error ? compactActivityRefreshError(error) :');
    expect(source).toContain('visibleActivityActionError = actionError ? compactActivityActionError(actionError) :');
    expect(source).toContain('activityActionIssue = actionError ? classifyServiceIssue(actionError) : null');
    expect(source).toContain("if (!value) return 'time not recorded'");
    expect(source).not.toContain("return 'n/a'");
    expect(source).toContain('function activitySnapshotRecoveryNotes');
    expect(source).toContain('function compactActivityRecoveryNote');
    expect(source).toContain('function compactActivityRefreshError');
    expect(source).toContain("compactServiceIssueIfRecognized(text, 'Activity')");
    expect(source).toContain('function compactActivityActionError');
    expect(source).toContain("compactServiceIssueIfRecognized(text, 'Activity action')");
    expect(source).toContain('function activityRecordErrorDetail');
    expect(source).toContain('title={`Raw Activity record error: ${record.error}`}');
    expect(source).toContain('Activity refresh needs attention');
    expect(source).toContain('Activity action needs attention');
    expect(source).toContain('Raw Activity action error:');
    expect(source).toContain('Cached records stay visible when available.');
    expect(source).toContain('Raw Activity error:');
    expect(source).toContain('Activity cache and recovery notes');
    expect(source).toContain('Browser Activity cache');
    expect(source).toContain('one source failed; available work is still listed');
    expect(source).toContain('function sourceReachable');
    expect(source).toContain('function activityActionKey');
    expect(source).toContain('refreshBlockedReason = activityRefreshBlockedReason({ loading, refreshing, busyKey })');
    expect(source).toContain('function activityRefreshBlockedReason');
    expect(source).toContain('function activityEmptyTitle');
    expect(source).toContain('No live activity loaded from reachable sources.');
    expect(source).toContain('No durable work recorded yet.');
    expect(source).toContain('function activityEmptyDetail');
    expect(source).toContain('Start or fix AI OS, Passive Tasks, or Macro Lab in Settings Feature Wiring');
    expect(source).toContain('Start a research run, AI OS job, tool call, generated asset, passive sweep, backup, benchmark, or macro run; Activity will list it here after refresh.');
    expect(source).toContain('cached record');
    expect(source).not.toContain('No durable activity yet.');
    expect(source).toContain('function activityEmptyRefreshTitle');
    expect(source).toContain('function dismissedToggleTitle');
    expect(source).toContain('function restoreDismissedTitle');
    expect(source).toContain('interface ActivityControlState');
    expect(source).toContain('activityControlState = {');
    expect(source).toContain('activityInitialLoading = loading && !snapshot');
    expect(source).toContain("runningStatusDetail = activityInitialLoading ? 'Checking active work'");
    expect(source).toContain("pausedStatusDetail = activityInitialLoading ? 'Checking paused work'");
    expect(source).toContain("failedStatusDetail = activityInitialLoading ? 'Checking for issues'");
    expect(source).toContain("savedStatusDetail = activityInitialLoading ? 'Checking saved work'");
    expect(source).toContain('No paused work');
    expect(source).toContain('No failures');
    expect(source).toContain('No saved records yet');
    expect(source).toContain('No hidden records');
    expect(source).not.toContain("pausedRecords.length ? 'Resume or cancel' : 'None'");
    expect(source).not.toContain("failedRecords.length ? 'Needs inspection' : 'Clear'");
    expect(source).not.toContain("stableRecords.length ? 'Reports and history' : 'None yet'");
    expect(source).not.toContain("'None hidden'");
    expect(source).toContain('function activityStatusCardLabel');
    expect(source).toContain("aria-label={activityStatusCardLabel('Running activity records', runningRecords.length, runningStatusDetail)}");
    expect(source).toContain("aria-label={activityStatusCardLabel('Failed or blocked activity records', failedRecords.length, failedStatusDetail)}");
    expect(source).toContain('dismissedToggleButtonTitle = dismissedToggleTitle(activityControlState)');
    expect(source).toContain('restoreDismissedButtonTitle = restoreDismissedTitle()');
    expect(source).toContain('activityRefreshButtonTitle = activityRefreshTitle(activityControlState)');
    expect(source).toContain('activityEmptyRefreshButtonTitle = activityEmptyRefreshTitle(activityControlState)');
    expect(source).toContain('function actionBlockedReason');
    expect(source).toContain('function activityRefreshTitle');
    expect(source).toContain('function activityActionTitle');
    expect(source).toContain('function linkActionNeedsSetup');
    expect(source).toContain('function linkActionDisabled');
    expect(source).toContain('function linkActionLabel');
    expect(source).toContain('Another Activity action is already running.');
    expect(source).toContain('disabled={actionDisabled(record, action)}');
    expect(source).toContain('disabled={Boolean(refreshBlockedReason)}');
    expect(source).toContain('title={dismissedToggleButtonTitle}');
    expect(source).toContain('title={restoreDismissedButtonTitle}');
    expect(source).toContain('title={activityRefreshButtonTitle}');
    expect(source).toContain('title={activityEmptyRefreshButtonTitle}');
    expect(source).toContain('href={linkActionDisabled(record, action) ? undefined : actionHref(record, action)}');
    expect(source).toContain('class:disabled={linkActionDisabled(record, action)}');
    expect(source).toContain('aria-disabled={linkActionDisabled(record, action)}');
    expect(source).toContain('{linkActionLabel(record, action)}');
    expect(source).toContain('title={activityActionTitle(record, action)}');
    expect(source).toContain('backend records are not deleted');
    expect(source).toContain('window.confirm(`Cancel "${record.title}" in ${record.sourceLabel}?');
    expect(source).toContain('Cancel skipped.');
    expect(source).toContain('asks for confirmation before stopping active work');
    expect(source).toContain("href={hubHref('/settings#data-recovery')}");
    expect(source).toContain("href={hubHref('/settings#feature-wiring')}");
    expect(source).toContain('Open Settings Feature Wiring before reopening ${record.title}.');
    expect(source).not.toContain('Open ${record.sourceLabel}; the backend may still show a setup or offline state.');
  });

  it('keeps Today recommendation actions tied to live capability readiness', async () => {
    const source = await routeSource('../routes/+page.svelte');

    expect(source).toContain('function modeActionBlockedReason');
    expect(source).toContain('AI OS is not reachable; open Settings Feature Wiring to connect the local service.');
    expect(source).toContain('function modeActionDisabled');
    expect(source).toContain('disabled={modeActionDisabled(item)}');
    expect(source).toContain('function modeActionTitle');
    expect(source).toContain('title={modeActionTitle(item)}');
    expect(source).toContain('Run a measured local text benchmark for ${item.label}; AI OS, Activity, and Recent Actions will track the result.');
    expect(source).toContain('Create, verify, and restore-test an AI OS backup for ${item.label}; Recent Actions records the recovery artifact.');
    expect(source).toContain('Queue a local AI OS summary batch for ${item.label}; Activity and AI OS job history will track progress.');
    expect(source).not.toContain('title={modeActionBlockedReason(item) || item.action.label}');
    expect(source).toContain('function attentionItemActionTitle');
    expect(source).toContain('Cached attention is read-only until Mini Hub reconnects.');
    expect(source).toContain('Complete ${item.title}; synced state and Recent Actions will refresh.');
    expect(source).toContain('Run ${item.title}; Activity and Recent Actions will track the result.');
    expect(source).toContain('Restore ${item.title}; the owning service may require setup or confirmation.');
    expect(source).toContain('title={attentionItemActionTitle(item, openAction)}');
    expect(source).toContain('title={attentionItemActionTitle(item, itemAction)}');
    expect(source).not.toContain('title={itemAction.reason ?? attentionActionLabel(itemAction.kind)}');
    expect(source).not.toContain('title={attentionActionLabel(openAction.kind)}');
    expect(source).toContain('interface TodayRefreshControlState');
    expect(source).toContain('todayRefreshControlState = {');
    expect(source).toContain('todayRefreshButtonTitle = todayRefreshTitle(todayRefreshControlState)');
    expect(source).toContain('visibleAttentionError = $attentionStore.error ? compactTodayServiceIssue($attentionStore.error) :');
    expect(source).toContain('visibleActionLedgerError = actionLedgerError ? compactTodayServiceIssue(actionLedgerError) :');
    expect(source).toContain('visibleActionLedgerSourceError = actionLedgerSourceError ? compactTodayServiceIssue(actionLedgerSourceError) :');
    expect(source).toContain('function todayRefreshTitle');
    expect(source).toContain('function compactTodayServiceIssue');
    expect(source).toContain('function actionLedgerEmptyMessage');
    expect(source).toContain('Today refresh needs attention');
    expect(source).toContain('Cached attention remains visible when available.');
    expect(source).toContain('Raw Today error:');
    expect(source).toContain('attention-error-panel service-card');
    expect(source).toContain("compactServiceIssueIfRecognized(text, 'Today')");
    expect(source).toContain('title={todayRefreshButtonTitle}');
    expect(source).toContain("href={hubHref('/settings#feature-wiring')}");
    expect(source).toContain("href={hubHref('/settings#machine-mode')}");
    expect(source).toContain("href={hubHref('/settings#action-ledger')}");
    expect(source).toContain('function todayCountLabel');
    expect(source).toContain("if ($attentionStore.loading && !attentionSnapshot) return 'checking'");
    expect(source).toContain("if (!attentionSnapshot) return 'refresh needed'");
    expect(source).toContain('<strong>{todayCountLabel(attentionItems.length)}</strong>');
    expect(source).toContain('function todaySnapshotUnavailableMessage');
    expect(source).toContain('Opening the browser attention cache before live sources refresh.');
    expect(source).toContain('will reload after the Today refresh card reconnects.');
    expect(source).toContain('needs a refresh. Refresh Today or open Settings Feature Wiring.');
    expect(source).toContain('function nowNextEmptyMessage');
    expect(source).toContain('Checking Google Calendar attention from the hub.');
    expect(source).toContain('function priorityEmptyMessage');
    expect(source).toContain('Attention sources need refresh');
    expect(source).toContain('function mailEmptyMessage');
    expect(source).toContain('Loading Gmail attention from the hub.');
    expect(source).toContain('function focusEmptyMessage');
    expect(source).toContain('Loading Career and Study attention from the hub.');
    expect(source).toContain('function systemEmptyMessage');
    expect(source).toContain('Loading local service and AI OS signals.');
    expect(source).toContain('function sourceStatusEmptyMessage');
    expect(source).toContain('Checking source status from the hub.');
    expect(source).toContain('Checking attention sources');
    expect(source).toContain('Refresh Today to check attention');
    expect(source).toContain('Loading real attention sources.');
    expect(source).toContain('Checking local services and providers.');
    expect(source).toContain('Loading recent app actions, AI OS logs, and Macro Lab runs.');
    expect(source).toContain('Recent Actions need a refresh. Refresh Today or open Settings Action Ledger.');
    expect(source).toContain('No recent action rows loaded from reachable sources.');
    expect(source).toContain('No recent app actions are logged yet. Today checked Hub, AI OS, Macro Lab, and browser actions; saves and automations will appear here.');
    expect(source).toContain('Raw Recent Actions error:');
    expect(source).toContain('Raw Action Ledger source error:');
    expect(source).not.toContain("return '...'");
    expect(source).not.toContain("return 'n/a'");
    expect(source).not.toContain('No attention snapshot has loaded yet.');
    expect(source).not.toContain('No attention check yet');
    expect(source).not.toContain('No meaningful actions are logged yet.');
    expect(source).not.toContain("return 'not loaded'");
    expect(source).not.toContain('Attention queue not loaded');
    expect(source).not.toContain('has not loaded yet. Refresh Today');
    expect(source).not.toContain('Recent Actions has not loaded yet.');
    expect(source).not.toContain('Loading attention.');
    expect(source).not.toContain('Not checked');
    expect(source).not.toContain('Loading attention...');
    expect(source).not.toContain('Loading real attention sources...');
    expect(source).toContain('cachedCoreRows =');
    expect(source).toContain('type ClientDataState');
    expect(source).toContain('saveStatusLabel = todaySaveStatusLabel($clientData)');
    expect(source).toContain('saveStatusDetail = todaySaveStatusDetail($clientData)');
    expect(source).toContain('lastSyncLabel = todayLastSyncLabel($clientData)');
    expect(source).toContain('function todaySaveStatusLabel');
    expect(source).toContain('function todaySaveStatusLabel(state: ClientDataState)');
    expect(source).toContain("if (state.status === 'error') return 'Needs attention';\n    if (!state.initialized) return 'Opening saved data';");
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
    expect(source).toContain("href={hubHref('/settings#data-recovery')}");
    expect(source).toContain('Data Map');
  });

  it('keeps Career and Study inline edits read-only when save capability drops', async () => {
    const career = await routeSource('../routes/desk/career/+page.svelte');
    const study = await routeSource('../routes/desk/study/+page.svelte');

    expect(career).toContain('if (!canSave || saving || !company.trim() || !role.trim()) return');
    expect(career).toContain('if (!canSave || editingJobId || rowBusyId) return');
    expect(career).toContain('if (!canSave || !jobDraft.company.trim() || !jobDraft.role.trim()) return');
    expect(career).toContain('disabled={!canSave || rowBusyId === job.id}');
    expect(career).toContain('interface CareerControlState');
    expect(career).toContain('careerControlState = {');
    expect(career).toContain('addJobButtonTitle = addJobTitle(careerControlState, company, role)');
    expect(career).toContain('saveJobEditButtonTitle = saveJobEditTitle(careerControlState, jobDraft)');
    expect(career).toContain('careerSummaryButtonTitle = careerSummaryTitle(careerControlState)');
    expect(career).toContain('careerMailUpdatesButtonTitle = careerMailUpdatesTitle(careerControlState)');
    expect(career).toContain('careerExportButtonTitle = careerExportTitle(careerControlState)');
    expect(career).toContain('visibleMailUpdatesError = mailUpdatesError ? compactServiceIssueLine(mailUpdatesError,');
    expect(career).toContain('Raw Career mail scan error:');
    expect(career).toContain('function careerSaveTitle');
    expect(career).toContain('function careerRowTitle');
    expect(career).toContain('function careerEditRowTitle');
    expect(career).toContain('function careerCancelEditTitle');
    expect(career).toContain('Edit this saved job inline; save or cancel the row to keep changes.');
    expect(career).toContain('Cancel this inline job edit and discard unsaved row changes.');
    expect(career).toContain('function careerMailUpdatesTitle');
    expect(career).toContain('function careerMailPanelStatus');
    expect(career).toContain('function careerMailEmptyMessage');
    expect(career).toContain('function careerJobsEmptyMessage');
    expect(career).toContain('function careerActionsEmptyMessage');
    expect(career).toContain("if (mailUpdatesLoading && !connections.length && !careerMailUpdates.length) return 'Checking Google'");
    expect(career).toContain('Checking Google connection and cached Career mail state.');
    expect(career).toContain('Opening cached Career jobs before live API sync.');
    expect(career).toContain('No cached Career jobs found in this browser. Start or connect the Mini Hub API before saving new jobs.');
    expect(career).toContain('No saved Career jobs yet. Add a job manually or import legacy Career Desk data.');
    expect(career).toContain('Opening cached career actions before live API sync.');
    expect(career).toContain('No linked career actions have been imported or created yet.');
    expect(career).toContain('No notes saved');
    expect(career).toContain('No due date');
    expect(career).toContain('No legacy theme found');
    expect(career).not.toContain('No new jobs in this Svelte workspace yet.');
    expect(career).not.toContain("return 'None'");
    expect(career).not.toContain('<span class="muted">None</span>');
    expect(career).not.toContain(": 'None'}</td>");
    expect(career).not.toContain("summary.hasTheme ? 'Found' : 'None'");
    expect(career).toContain('<span>{careerMailPanelStatus()}</span>');
    expect(career).toContain('<p class="muted mail-update-empty">{careerMailEmptyMessage()}</p>');
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
    expect(career).toContain('title={addJobButtonTitle}');
    expect(career).toContain('title={saveJobEditButtonTitle}');
    expect(career).toContain('title={careerMailUpdatesButtonTitle}');
    expect(career).toContain('title={careerEditRowTitle(careerControlState, job.id)}');
    expect(career).toContain('title={careerCancelEditTitle(careerControlState, job.id)}');
    expect(career).not.toContain("title={careerRowTitle(careerControlState, 'Edit', job.id)}");
    expect(career).not.toContain("title={rowBusyId === job.id ? 'This Career row action is already running.' : 'Cancel job edit.'}");
    expect(career).toContain("title={careerSaveTitle(careerControlState, 'Company name.')}");
    expect(career).toContain('Delete "${job.role}" at ${job.company}?');
    expect(career).toContain('Career delete skipped.');
    expect(career).toContain('Ask for confirmation before deleting this saved job.');
    expect(career).toContain('Offline read-only: start or connect the Mini Hub API before saving Career changes.');
    expect(career).toContain("careerViewStorageKey = 'miniHub.career.view.v1'");
    expect(career).toContain("import { getBrowserStorage } from '$lib/browser-storage'");
    expect(career).toContain('const storage = getBrowserStorage()');
    expect(career).toContain('function hydrateCareerViewState');
    expect(career).toContain('$: if (viewHydrated) persistCareerViewState(searchQuery, statusFilter)');
    expect(career).toContain('Reloaded Career filters from this browser.');
    expect(career).toContain('success-banner');
    expect(study).toContain('if (!canSave || saving || !subject.trim() || minutes < 1) return');
    expect(study).toContain('if (!canSave || saving) return');
    expect(study).toContain('if (!canSave || editingSessionId || rowBusyId) return');
    expect(study).toContain('disabled={!canSave || rowBusyId === log.id}');
    expect(study).toContain('interface StudyControlState');
    expect(study).toContain('studyControlState = {');
    expect(study).toContain('addLogButtonTitle = addLogTitle(studyControlState, subject, Number(minutes))');
    expect(study).toContain('saveLogEditButtonTitle = saveLogEditTitle(studyControlState, studyDraft)');
    expect(study).toContain('studySummaryButtonTitle = studySummaryTitle(studyControlState)');
    expect(study).toContain('function studySaveTitle');
    expect(study).toContain('function studyRowTitle');
    expect(study).toContain('function studyEditRowTitle');
    expect(study).toContain('function studyCancelEditTitle');
    expect(study).toContain('Edit this saved study log inline; save or cancel the row to keep changes.');
    expect(study).toContain('Cancel this inline study log edit and discard unsaved row changes.');
    expect(study).toContain('function studyLogsEmptyMessage');
    expect(study).toContain('function studyCareerActionsEmptyMessage');
    expect(study).toContain('let studySummaryLoading = false');
    expect(study).toContain('function studySummaryTitle');
    expect(study).toContain('if (studySummaryLoading) return');
    expect(study).toContain('disabled={studySummaryLoading}');
    expect(study).toContain("{studySummaryLoading ? 'Scanning' : 'Scan'}");
    expect(study).toContain('Add a study label before logging progress.');
    expect(study).toContain('disabled={!canSave || saving || !subject.trim() || minutes < 1}');
    expect(study).toContain('title={addLogButtonTitle}');
    expect(study).toContain('title={saveLogEditButtonTitle}');
    expect(study).toContain('title={studyEditRowTitle(studyControlState, log.id)}');
    expect(study).toContain('title={studyCancelEditTitle(studyControlState, log.id)}');
    expect(study).not.toContain("title={studyRowTitle(studyControlState, 'Edit', log.id)}");
    expect(study).not.toContain("title={rowBusyId === log.id ? 'This Study row action is already running.' : 'Cancel study log edit.'}");
    expect(study).toContain("title={studySaveTitle(studyControlState, 'Study label.')}");
    expect(study).toContain('Delete ${log.minutes} min for "${log.subject}"?');
    expect(study).toContain('Study delete skipped.');
    expect(study).toContain('Ask for confirmation before deleting this saved study log.');
    expect(study).toContain('Offline read-only: start or connect the Mini Hub API before saving Study changes.');
    expect(study).toContain('Opening cached Study logs before live API sync.');
    expect(study).toContain('No cached Study logs found in this browser. Start or connect the Mini Hub API before logging progress.');
    expect(study).toContain('No saved Study logs yet. Use Quick Log to add one.');
    expect(study).toContain('Opening cached linked career actions before live API sync.');
    expect(study).toContain('No linked career actions have been imported or created yet.');
    expect(study).not.toContain('No study logs in this Svelte workspace yet.');
    expect(study).toContain('No legacy GitHub sync recorded');
    expect(study).toContain('No exam date saved');
    expect(study).toContain('No legacy repo saved');
    expect(study).toContain('No milestones saved');
    expect(study).toContain('No update saved');
    expect(study).toContain('No note saved');
    expect(study).toContain('No due date');
    expect(study).not.toContain("|| 'None'");
    expect(study).not.toContain(": 'None'");
    expect(study).not.toContain("legacyGithub.lastSync ? displayDateTime(legacyGithub.lastSync) : 'Never'");
    expect(study).toContain("studyViewStorageKey = 'miniHub.study.view.v1'");
    expect(study).toContain("import { getBrowserStorage } from '$lib/browser-storage'");
    expect(study).toContain('const storage = getBrowserStorage()');
    expect(study).toContain('function hydrateStudyViewState');
    expect(study).toContain('$: if (viewHydrated) persistStudyViewState(searchQuery, subject, Number(minutes))');
    expect(study).toContain('Reloaded Study filters and quick-log defaults from this browser.');
    expect(study).toContain('success-banner');
    expect(study).toContain('<details class="secondary-details" open={logs.length > 0}>');
  });

  it('keeps the hub smoke script able to print a repeatable action and reload checklist', async () => {
    const source = await routeSource('../../../../scripts/hub-usability-smoke.mjs');
    const packageJson = await routeSource('../../../../package.json');

    expect(source).toContain('function printChecklist');
    expect(source).toContain('function argValue');
    expect(source).toContain("argValue(rawArgs, '--url') || process.env.HUB_SMOKE_URL || ''");
    expect(source).toContain('pass --url or set HUB_SMOKE_URL');
    expect(packageJson).toContain('"qa:hub:smoke:local": "node scripts/hub-usability-smoke.mjs --url http://127.0.0.1:5173"');
    expect(packageJson).toContain('"qa:hub:smoke:hosted": "node scripts/hub-usability-smoke.mjs --url https://elc9939.github.io/testing/"');
    expect(packageJson).toContain('"qa:hub:usability": "pnpm qa:hub:smoke && pnpm qa:hub:smoke:hosted && pnpm qa:hub:hydrated"');
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
    expect(source).toContain('function unexplainedDisabledControls');
    expect(source).toContain('function controlCoverage');
    expect(source).toContain('function controlCoverageSummary');
    expect(source).toContain('Control coverage');
    expect(source).toContain('Confirm control coverage');
    expect(source).toContain('Disabled controls without explanations');
    expect(source).toContain('row.controlCoverage.unexplainedDisabled');
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
    expect(source).toContain('repeated service issue compaction');
    expect(source).toContain('compact service issue note');
    expect(source).toContain('source health issue summary');
  });

  it('keeps the hydrated smoke script dependency-free and focused on route recovery', async () => {
    const source = await routeSource('../../../../scripts/hub-hydrated-smoke.mjs');
    const fullAiSource = await routeSource('../../../../scripts/hub-hydrated-smoke-full-ai.mjs');
    const deskWritesSource = await routeSource('../../../../scripts/hub-hydrated-smoke-desk-writes.mjs');
    const packageJson = await routeSource('../../../../package.json');

    expect(packageJson).toContain('"qa:hub:hydrated": "node scripts/hub-hydrated-smoke.mjs"');
    expect(packageJson).toContain('"qa:hub:hydrated:ai": "node scripts/hub-hydrated-smoke-full-ai.mjs"');
    expect(packageJson).toContain('"qa:hub:hydrated:writes": "node scripts/hub-hydrated-smoke-desk-writes.mjs"');
    expect(fullAiSource).toContain("process.env.HUB_HYDRATED_AI_LAB_CLASSIFY = process.env.HUB_HYDRATED_AI_LAB_CLASSIFY || '1'");
    expect(fullAiSource).toContain("await import('./hub-hydrated-smoke.mjs')");
    expect(deskWritesSource).toContain("process.env.HUB_HYDRATED_DESK_WRITES = '1'");
    expect(deskWritesSource).toContain("await import('./hub-hydrated-smoke.mjs')");
    expect(source).toContain('Chrome DevTools websocket');
    expect(source).toContain('Could not remove temporary browser profile');
    expect(source).toContain('HUB_HYDRATED_URL');
    expect(source).toContain('HUB_HYDRATED_BROWSER');
    expect(source).toContain('HUB_HYDRATED_API_URL');
    expect(source).toContain('HUB_HYDRATED_DESK_WRITES');
    expect(source).toContain("title: 'Today - Mini Hub'");
    expect(source).toContain("title: 'Stick Arena Ability Lab - Mini Hub'");
    expect(source).toContain('function titleMatches');
    expect(source).toContain('titleOk: titleMatches(route, snapshot.title)');
    expect(source).toContain('!row.titleOk');
    expect(source).toContain('Inspected target navigated or closed');
    expect(source).toContain('Execution context was destroyed');
    expect(source).toContain('class HydrationTimeoutError extends Error');
    expect(source).toContain('function blankHydrationState');
    expect(source).toContain('if (!(error instanceof HydrationTimeoutError) || !blankHydrationState(error.lastState) || attempt === 1)');
    expect(source).toContain('async function reloadCurrentPage');
    expect(source).toContain('miniHub.activity.snapshot.v1');
    expect(source).toContain('miniHub.productivity.cache.v1');
    expect(source).toContain('productivity-cache');
    expect(source).toContain('skipApiUrlOverride');
    expect(source).toContain('Hydrated Cache Interview');
    expect(source).toContain('Hydrated cached deadline mail');
    expect(source).toContain('Hydrated cached Activity run');
    expect(source).toContain('Recovered from browser Activity cache.');
    expect(source).toContain('miniHub.research.draft.v1');
    expect(source).toContain('miniHub.aiLab.draft.v1');
    expect(source).toContain('Hydrated smoke research draft');
    expect(source).toContain('Hydrated smoke AI Lab draft');
    expect(source).toContain("safeActionLabels: ['Connect AI OS', 'Run Quick Search', 'Retry Service']");
    expect(source).toContain('safeActionFallbacks');
    expect(source).toContain("'Run Quick Search': ['Connect AI OS', 'Checking AI OS', 'Setup', 'Checking saved research monitors']");
    expect(source).toContain("'Do it': ['Connect AI OS', 'Checking AI OS']");
    expect(source).toContain("'Dry Run': ['No macro selected', 'Saved macro definitions will reload', 'Connect Macro Lab', 'Start Macro Lab', 'Checking saved macro definitions']");
    expect(source).toContain('Connect Macro Lab to load saved macro definitions');
    expect(source).not.toContain("'Check Services': ['Checking']");
    expect(source).not.toContain("'Sync Now': ['API Not Ready', 'Loading Cache', 'Offline Read-only']");
    expect(source).toContain('runPersistenceChecks');
    expect(source).toContain('async function reloadAndFindValue');
    expect(source).toContain('await reloadCurrentPage(client)');
    expect(source).toContain('await waitForCondition(');
    expect(source).toContain('return { ok: values.some((value) => value.includes(expected)) || text.includes(expected) };');
    expect(source).toContain('options.timeoutMs ?? 4_000');
    expect(source).toContain('safeActionStatus');
    expect(source).toContain('fallbackFor');
    expect(source).toContain('function snapshotMatchesLabel');
    expect(source).toContain("match.fallbackFor ? 'blocked' : match.disabled ? 'disabled' : 'enabled'");
    expect(source).toContain('runAiLabActionChecks');
    expect(source).toContain('clickButtonByText');
    expect(source).toContain('fillFirstTextarea');
    expect(source).toContain('setControlValue');
    expect(source).toContain('runResearchActionChecks');
    expect(source).toContain('startMockResearchAiOsServer');
    expect(source).toContain('runResearchOnlineRecoveryChecks');
    expect(source).toContain('runAiOsOfflineActionGuardChecks');
    expect(source).toContain('runAssistantDockRecoveryChecks');
    expect(source).toContain('runDeskWriteGuardChecks');
    expect(source).toContain('runProductivityCacheWriteGuardChecks');
    expect(source).toContain('runLocalServiceSideEffectGuardChecks');
    expect(source).toContain('research-offline-run-guard');
    expect(source).toContain('research-online-run-created');
    expect(source).toContain('research-online-run-rehydrated');
    expect(source).toContain('research-monitor-created');
    expect(source).toContain('research-monitor-run-created');
    expect(source).toContain('research-report-export-links');
    expect(source).toContain('research-source-search');
    expect(source).toContain('research-source-seed-added');
    expect(source).toContain('research-monitor-source-draft-reloaded');
    expect(source).toContain('research-monitor-toggle');
    expect(source).toContain('research-monitor-delete');
    expect(source).toContain('Hydrated Mock Research Report');
    expect(source).toContain('Hydrated monitor watch');
    expect(source).toContain('ai-os-offline-action-guard');
    expect(source).toContain('assistant-toggle-title-closed');
    expect(source).toContain('assistant-toggle-title-open');
    expect(source).toContain('assistant-ai-os-status-recovery');
    expect(source).toContain('Open Feature Wiring');
    expect(source).toContain('career-add-job-guard');
    expect(source).toContain('study-log-guard');
    expect(source).toContain('productivity-cache-write-guard');
    expect(source).toContain('productivity-cached-event-readonly-details');
    expect(source).toContain('macro-lab-side-effect-guard');
    expect(source).toContain('passive-task-run-guard');
    expect(source).toContain('career-add-job-save-reload');
    expect(source).toContain('career-add-job-reloaded');
    expect(source).toContain('career-filter-visible');
    expect(source).toContain('career-filter-saved-locally');
    expect(source).toContain('career-edit-persisted');
    expect(source).toContain('career-edit-filter-reloaded');
    expect(source).toContain('career-export-visible-confirmation');
    expect(source).toContain('study-log-save-reload');
    expect(source).toContain('study-log-reloaded');
    expect(source).toContain('study-edit-persisted');
    expect(source).toContain('study-filter-saved-locally');
    expect(source).toContain('study-filter-progress-reloaded');
    expect(source).toContain('clickButtonByAriaLabel');
    expect(source).toContain('setNthControlValue');
    expect(source).toContain('Hydrated Smoke Labs');
    expect(source).toContain('Hydrated Smoke Study');
    expect(source).toContain('Hydrated API Smoke Labs');
    expect(source).toContain('Hydrated API Study');
    expect(source).toContain('Hydrated Edited Study');
    expect(source).toContain('createMockAiStatus');
    expect(source).toContain('/api/ai/status');
    expect(source).toContain('activity-ai-os-work-rehydrated');
    expect(source).toContain('Tool call: study.add_session');
    expect(source).toContain('generated/hydrated-image.png');
    expect(source).toContain('Hydrated smoke: verify Research Desk offline run guard.');
    expect(source).toContain('Connect AI OS before starting a research run');
    expect(source).toContain('queued message visible');
    expect(source).toContain('Hydrated Action Check');
    expect(source).toContain('ai-lab-parse');
    expect(source).toContain('ai-lab-parse-asset-error');
    expect(source).toContain('ai-lab-classify');
    expect(source).toContain('Parser: Result ready');
    expect(source).toContain('Parser: Action needed');
    expect(source).toContain('Waiting for parser asset failure.');
    expect(source).toContain('blockClassifierModelFetches');
    expect(source).toContain('Waiting for classifier blocked-asset error.');
    expect(source).toContain('browser-local Tree-sitter');
    expect(source).toContain('HUB_HYDRATED_AI_LAB_CLASSIFY');
    expect(source).toContain("(process.env.HUB_HYDRATED_AI_LAB_CLASSIFY || '0') !== '0'");
    expect(source).toContain('Classifier returned labels even though model URLs were blocked.');
    expect(source).toContain('startManagedHubServer');
    expect(source).toContain('stopProcessTree');
    expect(source).toContain('Could not start managed Mini Hub dev server');
    expect(source).toContain('unexplainedDisabled');
    expect(source).toContain('rawNotFound');
    expect(source).toContain('Mini Hub hydrated smoke found');
    expect(source).not.toContain("from 'playwright'");
    expect(source).not.toContain("from 'puppeteer'");
  });

  it('explains Stick Arena lab loading and offline save controls', async () => {
    const games = await routeSource('../routes/games/+page.svelte');
    const source = await routeSource('../routes/games/stick-arena-lab/+page.svelte');

    expect(games).toContain('Games save and recovery status');
    expect(games).toContain("import { canAutoSave, clientData, type ClientDataState } from '$lib/client-data'");
    expect(games).toContain('gameRunCount = $clientData.gameRuns.length');
    expect(games).toContain('gameStateCount = $clientData.gameStates.length');
    expect(games).toContain('gameSaveReady = canAutoSave($clientData)');
    expect(games).toContain("gameSaveMode = gameSaveReady ? 'API-backed saves enabled'");
    expect(games).toContain('Opening saved game data');
    expect(games).toContain('function gameSaveBlockedDetail');
    expect(games).toContain('Opening the browser cache before game save status is known.');
    expect(games).toContain('API-backed run/state saves wait for Mini Hub status');
    expect(games).toContain('Supported game runs and state save through the Mini Hub API');
    expect(games).toContain('Games remain playable, but API-backed run/state saves are disabled');
    expect(games).toContain('Open Settings Data & Recovery for game cache and API status.');
    expect(games).toContain('title="Open Stick Arena Ability Lab."');
    expect(games).toContain('title="Open the legacy arcade."');
    expect(source).toContain('labReady = Boolean(lab)');
    expect(source).toContain('saveDisabled = !labReady || !canSave || saving');
    expect(source).toContain('resetDisabled = !labReady || labControlBusy');
    expect(source).toContain('interface StickArenaLabControlState');
    expect(source).toContain('clientInitialized: boolean');
    expect(source).toContain('stickArenaLabControlState = {');
    expect(source).toContain('clientInitialized: $clientData.initialized');
    expect(source).toContain('resetButtonTitle = resetTitle(stickArenaLabControlState)');
    expect(source).toContain('saveButtonTitle = saveTitle(stickArenaLabControlState)');
    expect(source).toContain('function gameRunSaveStatus');
    expect(source).toContain('function gameRunSaveBlockedReason');
    expect(source).toContain('function telemetryEmptyMessage');
    expect(source).toContain('Ready to save runs through Mini Hub.');
    expect(source).toContain('Opening saved game data');
    expect(source).toContain('Mini Hub API is not ready for game saves');
    expect(source).toContain('Loading local cache before game run saves are enabled.');
    expect(source).toContain('Waiting for the game engine to load before telemetry starts.');
    expect(source).toContain('Telemetry is unavailable because the game engine did not load');
    expect(source).toContain('Telemetry is ready; interact with the arena or reset the lab to capture recent events.');
    expect(source).toContain('if (!lab)');
    expect(source).toContain('Engine is still loading; wait for the lab before saving.');
    expect(source).toContain('Run saved to Mini Hub.');
    expect(source).toContain('Loading game engine: reset and save are disabled until the lab is ready.');
    expect(source).toContain('The lab is playable; {gameRunSaveBlockedReason(stickArenaLabControlState)}');
    expect(source).toContain("href={hubHref('/settings#data-recovery')}");
    expect(source).toContain('disabled={resetDisabled}');
    expect(source).toContain('disabled={saveDisabled}');
    expect(source).toContain('title={resetButtonTitle}');
    expect(source).toContain('title={saveButtonTitle}');
    expect(source).toContain('clientData.saveGameRun');
    expect(source).toContain('clientData.saveGameState');
    expect(source).toContain('Telemetry');
    expect(source).not.toContain('No events yet.');
    expect(games).not.toContain('Loading cache');
    expect(source).not.toContain('Loading cache');
  });

  it('shows Analytics refresh as a guarded async action with readable failures', async () => {
    const source = await routeSource('../routes/analytics/+page.svelte');

    expect(source).toContain('let refreshBusy = false');
    expect(source).toContain('if (refreshBusy) return');
    expect(source).toContain('refreshError = error instanceof Error');
    expect(source).toContain('cachedRecordCount = rows.reduce');
    expect(source).toContain('analyticsIssue = refreshError || renderError');
    expect(source).toContain('visibleAnalyticsIssue = analyticsIssue ? compactAnalyticsIssue(analyticsIssue) :');
    expect(source).toContain('function compactAnalyticsIssue');
    expect(source).toContain('The analytics renderer could not load; cached rows are still available.');
    expect(source).toContain("compactServiceIssueIfRecognized(text, 'Analytics')");
    expect(source).toContain('Raw Analytics error:');
    expect(source).toContain('Open Settings Data & Recovery');
    expect(source).toContain("href={hubHref('/settings#data-recovery')}");
    expect(source).toContain('function analyticsCacheStatus');
    expect(source).toContain('function analyticsSyncDetail');
    expect(source).toContain('function analyticsRecordSummary');
    expect(source).toContain('function workspaceMixEmptyTitle');
    expect(source).toContain('function workspaceMixEmptyMessage');
    expect(source).toContain('function studyTrendEmptyTitle');
    expect(source).toContain('function studyTrendEmptyMessage');
    expect(source).toContain("if (!value) return 'not recorded'");
    expect(source).toContain("if (!$clientData.initialized) return 'Opening browser cache'");
    expect(source).toContain("if (!$clientData.initialized) return 'Opening PGlite/browser cache.'");
    expect(source).toContain('Opening browser cache before drawing the workspace mix.');
    expect(source).toContain('No cached Career, Study, or game records are available in this browser yet.');
    expect(source).toContain('No workspace data to chart yet');
    expect(source).toContain('Opening browser cache before drawing the seven-day trend.');
    expect(source).toContain('No cached study sessions are available in this browser yet.');
    expect(source).toContain('No study trend to chart yet');
    expect(source).toContain("viewState === 'error' ? 'Action Needed' : 'Opening Cache'");
    expect(source).not.toContain("if (!value) return 'n/a'");
    expect(source).not.toContain('Cache loading');
    expect(source).not.toContain('Loading PGlite/browser cache.');
    expect(source).not.toContain('<strong>No chart yet</strong>');
    expect(source).not.toContain('<strong>No study trend yet</strong>');
    expect(source).toContain('aria-label="Analytics cache status"');
    expect(source).toContain('Last sync');
    expect(source).toContain('No completed sync yet; refresh or open Data & Recovery to inspect the cache.');
    expect(source).not.toContain('No chart data yet');
    expect(source).not.toContain('No study trend data yet');
    expect(source).not.toContain('No completed sync recorded in this browser yet.');
    expect(source).toContain('disabled={refreshBusy}');
    expect(source).toContain("{refreshBusy ? 'Refreshing' : 'Refresh'}");
    expect(source).toContain("refreshError ? 'Refresh needs attention'");
  });

  it('guards Settings sync, export, and endpoint actions with readable busy states', async () => {
    const source = await routeSource('../routes/settings/+page.svelte');

    expect(source).toContain('let serviceChecking = false');
    expect(source).toContain('let hubHealth: HubHealth | null = null');
    expect(source).toContain('let syncBusy = false');
    expect(source).toContain('let exportBusy = false');
    expect(source).toContain("import { canUseBrowserStorage } from '$lib/browser-storage'");
    expect(source).toContain('return canUseBrowserStorage()');
    expect(source).toContain('let endpointSaving = false');
    expect(source).toContain('interface SettingsControlState');
    expect(source).toContain('settingsControlState = {');
    expect(source).toContain("import { canAutoSave, clientData } from '$lib/client-data'");
    expect(source).toContain('canSync = canAutoSave($clientData)');
    expect(source).toContain('canSync,');
    expect(source).toContain('clientInitialized: $clientData.initialized');
    expect(source).toContain('clientOnline: $clientData.isOnline');
    expect(source).toContain('clientStatus: $clientData.status');
    expect(source).toContain('clientError: $clientData.error');
    expect(source).toContain('exportBusy');
    expect(source).toContain('syncNowButtonTitle = syncNowTitle(settingsControlState)');
    expect(source).toContain('capabilityRefreshButtonTitle = capabilityRefreshTitle(settingsControlState)');
    expect(source).toContain('actionLedgerRefreshButtonTitle = actionLedgerRefreshTitle(settingsControlState)');
    expect(source).toContain('exportCacheButtonTitle = exportCacheTitle(settingsControlState)');
    expect(source).toContain('serviceCheckButtonTitle = serviceCheckTitle(serviceChecking)');
    expect(source).toContain('machineAutotuneButtonTitle = machineAutotuneTitle(machineAutotuneBlockedReason)');
    expect(source).toContain('machineSnapshotButtonTitle = machineSnapshotTitle(machineSnapshotBlockedReason)');
    expect(source).toContain('machineProfileRefreshButtonTitle = machineProfileRefreshTitle(machineProfileLoading)');
    expect(source).toContain('passiveSettingsSaveButtonTitle = passiveSettingsSaveTitle()');
    expect(source).toContain('passiveSettingsRefreshButtonTitle = passiveSettingsRefreshTitle()');
    expect(source).toContain('endpointSaveButtonTitle = endpointSaveTitle(endpointSaving)');
    expect(source).toContain('endpointReloadButtonTitle = endpointReloadTitle(endpointSaving)');
    expect(source).toContain('function serviceCheckTitle');
    expect(source).toContain('title={serviceCheckButtonTitle}');
    expect(source).toContain('Check Mini Hub, AI OS, Macro Lab, Passive Tasks, Google readiness, endpoint wiring, and browser storage health.');
    expect(source).toContain('function capabilityRefreshTitle');
    expect(source).toContain('title={capabilityRefreshButtonTitle}');
    expect(source).toContain('function themeButtonTitle');
    expect(source).toContain("title={themeButtonTitle('dark')}");
    expect(source).toContain('function actionLedgerRefreshTitle');
    expect(source).toContain('title={actionLedgerRefreshButtonTitle}');
    expect(source).toContain('function exportCacheBlockedReason');
    expect(source).toContain('function exportCacheTitle');
    expect(source).toContain('Download the current browser cache as JSON for local inspection, backup, or recovery.');
    expect(source).toContain('function actionLedgerEmptyMessage');
    expect(source).toContain('visibleActionLedgerError = actionLedgerError ? compactServiceIssueIfRecognized(actionLedgerError,');
    expect(source).toContain('visibleActionLedgerSourceError = actionLedgerSourceError ? compactServiceIssueIfRecognized(actionLedgerSourceError,');
    expect(source).toContain('function restoreActionTitle');
    expect(source).toContain('This can overwrite the current local file target.');
    expect(source).toContain('This can move, delete, or overwrite local files.');
    expect(source).toContain('This writes synced Mini Hub data.');
    expect(source).not.toContain('from its recorded recovery data.');
    expect(source).toContain('title={restoreActionTitle(action)}');
    expect(source).toContain('function endpointInputTitle');
    expect(source).toContain("title={endpointInputTitle('AI OS API')}");
    expect(source).toContain('machineAiOsEndpointIssue = aiOsEndpointIssue(endpointResolutions)');
    expect(source).toContain("machineProfileControlBlockedReason('autotune', {");
    expect(source).toContain('function machineProfileControlBlockedReason');
    expect(source).toContain('AI OS is unavailable. Start AI OS or fix the endpoint, then retry the profile check.');
    expect(source).toContain("visibleMachineProfileError = machineProfileError ? compactServiceIssueIfRecognized(machineProfileError, 'AI OS machine profile') :");
    expect(source).toContain('Raw machine profile error:');
    expect(source).toContain("import { compactServiceIssueIfRecognized } from '$lib/service-issues'");
    expect(source).toContain('disabled={Boolean(machineAutotuneBlockedReason)}');
    expect(source).toContain('disabled={Boolean(machineSnapshotBlockedReason)}');
    expect(source).toContain('function machineAutotuneTitle');
    expect(source).toContain('function machineSnapshotTitle');
    expect(source).toContain('function machineProfileRefreshTitle');
    expect(source).toContain('title={machineAutotuneButtonTitle}');
    expect(source).toContain('title={machineSnapshotButtonTitle}');
    expect(source).toContain('title={machineProfileRefreshButtonTitle}');
    expect(source).toContain('save latency/provider/model data, and update routing plus mode recommendations');
    expect(source).toContain('Save the current AI OS machine profile snapshot so Settings, Today, and AI OS can reload measured hardware and provider status.');
    expect(source).toContain('Reload AI OS machine profile, recent snapshots, provider readiness, and benchmark history.');
    expect(source).toContain('function machineModeBlockedReason');
    expect(source).toContain('Machine Mode cannot save because Mini Hub API is not ready');
    expect(source).toContain('id="machine-mode"');
    expect(source).toContain('disabled={modeSaving || !canSync}');
    expect(source).toContain('No machine profile snapshots saved yet.');
    expect(source).toContain('No completed sync recorded yet');
    expect(source).toContain('Auto-import waits for legacy browser data');
    expect(source).not.toContain("'none saved'");
    expect(source).not.toContain(": 'Never'");
    expect(source).not.toContain(": 'Auto'}</dd>");
    expect(source).toContain("{machineProfileError && !machineProfile ? 'Retry Profile' : 'Refresh Profile'}");
    expect(source).toContain('passiveSettingsBlockedReason = passiveSettingsControlBlockedReason');
    expect(source).toContain('function passiveSettingsControlBlockedReason');
    expect(source).toContain('Passive Tasks API is reporting an error. Retry Passive settings before changing preferences.');
    expect(source).toContain('disabled={Boolean(passiveSettingsBlockedReason)}');
    expect(source).toContain('function passiveWorkerToggleTitle');
    expect(source).toContain('function passiveFamilyToggleTitle');
    expect(source).toContain('function passivePreferenceTitle');
    expect(source).toContain('function passiveScopeTitle');
    expect(source).toContain('function passiveSettingsSaveTitle');
    expect(source).toContain('function passiveSettingsRefreshTitle');
    expect(source).toContain('This saves immediately through the Passive Tasks API');
    expect(source).toContain('title={passiveWorkerToggleTitle(passiveSettings.enabled)}');
    expect(source).toContain('title={passiveFamilyToggleTitle(family)}');
    expect(source).toContain("title={passivePreferenceTitle('idle')}");
    expect(source).toContain("title={passivePreferenceTitle('notifications')}");
    expect(source).toContain("title={passivePreferenceTitle('resource')}");
    expect(source).toContain("title={passivePreferenceTitle('ai')}");
    expect(source).toContain("title={passivePreferenceTitle('maxRuns')}");
    expect(source).toContain("title={passiveScopeTitle('folders')}");
    expect(source).toContain("title={passiveScopeTitle('research')}");
    expect(source).toContain("title={passiveScopeTitle('accounts')}");
    expect(source).toContain('title={passiveSettingsSaveButtonTitle}');
    expect(source).toContain('title={passiveSettingsRefreshButtonTitle}');
    expect(source).toContain('future runs and Activity use these scopes');
    expect(source).not.toContain("title={passiveSettingsBlockedReason || 'Enable or disable the passive worker.'}");
    expect(source).not.toContain('title={passiveSettingsBlockedReason || `Enable or disable ${family.label}.`}');
    expect(source).not.toContain("title={passiveSettingsBlockedReason || 'Save passive task settings.'}");
    expect(source).not.toContain("title={passiveSettingsBlockedReason || 'One watched folder per line.'}");
    expect(source).toContain("{passiveLoading ? 'Loading' : passiveError ? 'Retry Passive' : 'Refresh'}");
    expect(source).toContain('function syncNowBlockedReason');
    expect(source).toContain('const blocked = syncNowBlockedReason(settingsControlState)');
    expect(source).toContain('disabled={Boolean(syncNowBlockedReason(settingsControlState))}');
    expect(source).toContain('function syncNowTitle');
    expect(source).toContain('title={syncNowButtonTitle}');
    expect(source).toContain('Push and pull Mini Hub data with the API now; cache status, last synced time, and Action Ledger update afterward.');
    expect(source).toContain('Loading local cache before sync controls are enabled.');
    expect(source).toContain('Mini Hub API is not ready:');
    expect(source).toContain('Opening the browser cache before export is available.');
    expect(source).toContain('<span>Check Services</span>');
    expect(source).toContain('<span>Sync Now</span>');
    expect(source).not.toContain("serviceChecking ? 'Checking' : 'Check Services'");
    expect(source).not.toContain("canSync ? 'Sync Now' : $clientData.initialized ? 'API Not Ready' : 'Loading Cache'");
    expect(source).toContain('Sync is already running.');
    expect(source).toContain("let apiStatus = 'Run Check Services'");
    expect(source).toContain("value === 'Run Check Services'");
    expect(source).toContain("if (!row.lastCheckedAt) return 'Run Check Services'");
    expect(source).toContain('function featureWiringOpenTitle');
    expect(source).toContain("if (row.status === 'unknown') return `Open ${row.feature} after running Check Services if this still needs setup.`;");
    expect(source).toContain('title={featureWiringOpenTitle(row)}');
    expect(source).toContain(": 'Run Check Services'");
    expect(source).not.toContain("let apiStatus = 'Not checked'");
    expect(source).not.toContain("value === 'Not checked'");
    expect(source).not.toContain("return 'Not checked'");
    expect(source).not.toContain("'Not checked yet'");
    expect(source).toContain('function formatHubCoreDataHealth');
    expect(source).toContain('hubCoreDataStatus = formatHubCoreDataHealth(hubHealth)');
    expect(source).toContain('<div><dt>Core data</dt><dd>{hubCoreDataStatus}</dd></div>');
    expect(source).toContain('Persistent snapshot');
    expect(source).toContain('Memory-only for this API process');
    expect(source).toContain('function formatPercent');
    expect(source).toContain("return typeof value === 'number' && Number.isFinite(value) ? `${value}%` : 'not measured'");
    expect(source).toContain("if (typeof value !== 'number' || !Number.isFinite(value)) return 'not measured'");
    expect(source).toContain("if (!health) return 'Refresh needed'");
    expect(source).toContain("health.latestSha256?.slice(0, 12) ?? 'hash not reported'");
    expect(source).toContain('<strong>{formatPercent(machineProfile.hardware.cpu_percent)} / {formatPercent(machineProfile.hardware.memory_percent)}</strong>');
    expect(source).toContain("machineProfile.autotune.suggested_max_job_concurrency ?? 'not measured'");
    expect(source).toContain("endpointMessage = 'Saved. Checking services with the new URLs.'");
    expect(source).toContain('function endpointSaveTitle');
    expect(source).toContain('function endpointReloadTitle');
    expect(source).toContain('title={endpointSaveButtonTitle}');
    expect(source).toContain('title={endpointReloadButtonTitle}');
    expect(source).toContain('hosted pages use this to avoid calling the wrong /api route');
    expect(source).toContain('Save service URLs in this browser, then run Check Services so Feature Wiring reflects the new targets.');
    expect(source).toContain('Loading passive task settings.');
    expect(source).toContain('Passive task settings need a fresh source check. Use Check Services or open Passive Tasks.');
    expect(source).toContain('Loading action ledger.');
    expect(source).toContain('Action Ledger needs a fresh source check. Use Refresh or Check Services to inspect Hub, AI OS, Macro Lab, and browser actions.');
    expect(source).toContain('No action rows loaded from reachable sources.');
    expect(source).toContain('No action ledger entries are recorded yet. New saves, AI OS jobs, passive work, and Macro Lab runs will appear here.');
    expect(source).toContain('Raw Action Ledger error:');
    expect(source).toContain('Raw Action Ledger source error:');
    expect(source).not.toContain('No action ledger entries are available yet.');
    expect(source).not.toContain('Saved. Checking services with the new URLs...');
    expect(source).not.toContain('Loading passive task settings...');
    expect(source).not.toContain('Passive task settings have not loaded yet.');
    expect(source).not.toContain('Loading action ledger...');
    expect(source).not.toContain('Action Ledger has not loaded yet.');
    expect(source).toContain('disabled={Boolean(exportCacheBlockedReason(settingsControlState))}');
    expect(source).toContain('title={exportCacheButtonTitle}');
    expect(source).not.toContain('disabled={exportBusy}');
    expect(source).toContain('disabled={endpointSaving}');
    expect(source).toContain("{endpointSaving ? 'Saving URLs' : 'Save Service URLs'}");
    expect(source).not.toContain("title={serviceChecking ? 'Service check is already running.' : 'Check all configured local and browser services.'}");
    expect(source).not.toContain("title={machineAutotuneBlockedReason || 'Run a small AI OS benchmark and update the machine profile.'}");
    expect(source).not.toContain("title={machineSnapshotBlockedReason || 'Save the current AI OS machine profile snapshot.'}");
    expect(source).not.toContain("title={machineProfileLoading ? 'Machine profile is already loading.' : 'Retry the AI OS machine profile check.'}");
    expect(source).not.toContain("title={endpointSaving ? 'Saving service URLs and checking services.' : 'Save service URLs for this browser.'}");
    expect(source).not.toContain('title="Reload the service URLs saved in this browser."');
    expect(source).toContain('Offline read-only: start or connect the Mini Hub API before syncing.');
    expect(source).toContain('id="feature-wiring"');
    expect(source).toContain('id="data-recovery"');
    expect(source).toContain('id="action-ledger"');
    expect(source).toContain('<strong>Data &amp; Recovery</strong>');
    expect(source).toContain('persistenceRows');
    expect(source).toContain('persistenceStats.crossDevice');
    expect(source).toContain('What survives refreshes, browser closes, route changes, and service outages.');
    expect(source).toContain('aria-label="Save and recovery rules"');
    expect(source).toContain('<span>Switch pages</span>');
    expect(source).toContain('Visible drafts, filters, and active work rehydrate from browser state or the owning service.');
    expect(source).toContain('<span>Close and reopen</span>');
    expect(source).toContain('Browser-local state returns in this browser; service-backed records reload when their API is online.');
    expect(source).toContain('<span>Another device</span>');
    expect(source).toContain('browser-only drafts stay here');
    expect(source).toContain('.recovery-rules,');
    expect(source).toContain('overflow-wrap: anywhere;');
  });
});
