import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function routeSource(path: string): Promise<string> {
  return readFile(new URL(path, import.meta.url), 'utf8');
}

describe('Mini Hub usability control gates', () => {
  it('collapses Research service failures and disables AI OS-backed research actions', async () => {
    const source = await routeSource('../routes/research/+page.svelte');

    expect(source).toContain('serviceIssue = compactResearchServiceIssue');
    expect(source).toContain('class="service-card"');
    expect(source).toContain('disabled={loading || aiOsUnavailable}');
    expect(source).toContain('function monitorActionBlockedReason');
    expect(source).toContain('Another research monitor action is already running.');
    expect(source).toContain('disabled={monitorActionDisabled(monitor)}');
    expect(source).toContain('sourceLibrarySearchDisabled = sourceLibraryLoading || aiOsUnavailable');
    expect(source).toContain('on:submit|preventDefault={searchSourceLibrary}');
    expect(source).toContain('disabled={sourceLibrarySearchDisabled}');
    expect(source).toContain('Connect AI OS');
    expect(source).toContain('let runActionId =');
    expect(source).toContain('selectedRunActionDisabled = !selectedRun || aiOsUnavailable || Boolean(runActionId)');
    expect(source).toContain('disabled={selectedRunActionDisabled}');
    expect(source).toContain('function reportExportHref');
    expect(source).toContain('Exports need AI OS; these links open Settings.');
  });

  it('keeps AI Lab classify and parse controls independent', async () => {
    const source = await routeSource('../routes/ai-lab/+page.svelte');

    expect(source).toContain('let classifyBusy = false');
    expect(source).toContain('let parseBusy = false');
    expect(source).toContain('disabled={classifyBusy}');
    expect(source).toContain('disabled={parseBusy}');
    expect(source).toContain('class="result-grid"');
    expect(source).not.toContain('let busy = false');
  });

  it('blocks AI OS service-backed work until a status snapshot is loaded', async () => {
    const source = await routeSource('../routes/ai-os/+page.svelte');

    expect(source).toContain('aiOsActionBlocked = !aiOsReady');
    expect(source).toContain('function requireAiOsReady');
    expect(source).toContain('disabled={commandBusy || aiOsActionBlocked}');
    expect(source).toContain('disabled={autotuneBusy || aiOsActionBlocked}');
    expect(source).toContain('disabled={designBusy || aiOsActionBlocked}');
    expect(source).toContain('disabled={benchmarkBusy || aiOsActionBlocked}');
    expect(source).toContain('function jobCancelBlockedReason');
    expect(source).toContain('Another job cancellation is already running.');
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
    expect(macro).toContain('macroControlDisabled = Boolean(macroControlTitle)');
    expect(macro).toContain('function requireMacroReady');
    expect(macro).toContain('if (macroConnectionError(message)) serviceError = message');
    expect(macro).toContain('Macro Lab connection failed: {serviceError}');
    expect(macro).toContain("title={macroControlTitle || 'Run this macro with confirmed side effects.'}");
    expect(macro).toContain('disabled={macroControlDisabled}');
    expect(passive).toContain('passiveControlDisabled = loading || Boolean(busyId) || !passiveStateKnown');
    expect(passive).toContain('passiveWriteDisabled = passiveControlDisabled');
    expect(passive).toContain('function passiveDisabledReason');
    expect(passive).toContain('disabled={passiveWriteDisabled}');
    expect(passive).toContain('title={passiveActionTitle');
    expect(passive).toContain('disabled={passiveWriteDisabled || !canRunTask(task, watcher)}');
    expect(passive).toContain('Load Passive Tasks before changing worker, watcher, task, card, notification, or settings state.');
  });

  it('keeps Productivity Google writes guarded while cached data remains inspectable', async () => {
    const source = await routeSource('../routes/productivity/+page.svelte');

    expect(source).toContain('productivityReady = canAct && googleConnected');
    expect(source).toContain("let actionBusyKey = ''");
    expect(source).toContain('productivityWriteDisabled = !productivityReady || Boolean(actionBusyKey)');
    expect(source).toContain('function beginProductivityAction');
    expect(source).toContain('function endProductivityAction');
    expect(source).toContain('Another Productivity action is already running.');
    expect(source).toContain('disabled={productivityWriteDisabled}');
    expect(source).toContain('cached productivity data can stay visible');
    expect(source).toContain('hubHref(routeMap.settings)');
    expect(source).toContain('disabled={loading || backgroundRefreshing || Boolean(actionBusyKey)}');
  });

  it('makes Activity recovery state scannable instead of one vague active count', async () => {
    const source = await routeSource('../routes/activity/+page.svelte');

    expect(source).toContain('runningRecords');
    expect(source).toContain('pausedRecords');
    expect(source).toContain('sourceFailures');
    expect(source).toContain('<span>Dismissed</span>');
    expect(source).toContain('showing cached records from');
    expect(source).toContain('one source failed; available work is still listed');
    expect(source).toContain('function sourceReachable');
    expect(source).toContain('function activityActionKey');
    expect(source).toContain('function actionBlockedReason');
    expect(source).toContain('Another Activity action is already running.');
    expect(source).toContain('disabled={actionDisabled(record, action)}');
    expect(source).toContain('disabled={loading || refreshing || Boolean(busyKey)}');
    expect(source).toContain('Open ${record.sourceLabel}; the backend may still show a setup or offline state.');
  });

  it('keeps Today recommendation actions tied to live capability readiness', async () => {
    const source = await routeSource('../routes/+page.svelte');

    expect(source).toContain('function modeActionBlockedReason');
    expect(source).toContain('AI OS is not reachable; open Settings to connect the local service.');
    expect(source).toContain('function modeActionDisabled');
    expect(source).toContain('disabled={modeActionDisabled(item)}');
    expect(source).toContain('title={modeActionBlockedReason(item) || item.action.label}');
  });

  it('keeps Career and Study inline edits read-only when save capability drops', async () => {
    const career = await routeSource('../routes/desk/career/+page.svelte');
    const study = await routeSource('../routes/desk/study/+page.svelte');

    expect(career).toContain('if (!canSave || saving || !company.trim() || !role.trim()) return');
    expect(career).toContain('if (!canSave || editingJobId || rowBusyId) return');
    expect(career).toContain('if (!canSave || !jobDraft.company.trim() || !jobDraft.role.trim()) return');
    expect(career).toContain('disabled={!canSave || rowBusyId === job.id}');
    expect(study).toContain('if (!canSave || saving || !subject.trim() || minutes < 1) return');
    expect(study).toContain('if (!canSave || saving) return');
    expect(study).toContain('if (!canSave || editingSessionId || rowBusyId) return');
    expect(study).toContain('disabled={!canSave || rowBusyId === log.id}');
  });

  it('keeps the hub smoke script able to print a repeatable action and reload checklist', async () => {
    const source = await routeSource('../../../../scripts/hub-usability-smoke.mjs');

    expect(source).toContain('function printChecklist');
    expect(source).toContain("args.has('--checklist')");
    expect(source).toContain('Exercise safe action');
    expect(source).toContain('verify persistence');
    expect(source).toContain('expectedBlockedState');
  });

  it('explains Stick Arena lab loading and offline save controls', async () => {
    const source = await routeSource('../routes/games/stick-arena-lab/+page.svelte');

    expect(source).toContain('labReady = Boolean(lab)');
    expect(source).toContain('if (!lab)');
    expect(source).toContain('Offline read-only: the lab is playable');
    expect(source).toContain("href={hubHref('/settings')}");
    expect(source).toContain('disabled={!labReady}');
    expect(source).toContain('disabled={!canSave || saving}');
  });

  it('shows Analytics refresh as a guarded async action with readable failures', async () => {
    const source = await routeSource('../routes/analytics/+page.svelte');

    expect(source).toContain('let refreshBusy = false');
    expect(source).toContain('if (refreshBusy) return');
    expect(source).toContain('refreshError = error instanceof Error');
    expect(source).toContain('disabled={refreshBusy}');
    expect(source).toContain("{refreshBusy ? 'Refreshing' : 'Refresh'}");
    expect(source).toContain("refreshError ? 'Refresh Failed'");
  });

  it('guards Settings sync, export, and endpoint actions with readable busy states', async () => {
    const source = await routeSource('../routes/settings/+page.svelte');

    expect(source).toContain('let serviceChecking = false');
    expect(source).toContain('let syncBusy = false');
    expect(source).toContain('let exportBusy = false');
    expect(source).toContain('let endpointSaving = false');
    expect(source).toContain('if (syncBusy || !$clientData.isOnline)');
    expect(source).toContain('disabled={syncBusy || !$clientData.isOnline}');
    expect(source).toContain('disabled={exportBusy}');
    expect(source).toContain('disabled={endpointSaving}');
    expect(source).toContain("{endpointSaving ? 'Saving URLs' : 'Save Service URLs'}");
    expect(source).toContain('Offline read-only: start or connect the Mini Hub API before syncing.');
  });
});
