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
    expect(source).toContain('selectedRunId: selectedRun?.id ?? persistedRunId');
    expect(source).toContain('selectedMonitorId');
    expect(source).toContain('class:selected={monitor.id === selectedMonitorId}');
  });

  it('keeps AI Lab classify and parse controls independent', async () => {
    const source = await routeSource('../routes/ai-lab/+page.svelte');

    expect(source).toContain('let classifyBusy = false');
    expect(source).toContain('let parseBusy = false');
    expect(source).toContain('classifyBlockedReason = classifyBusy ?');
    expect(source).toContain('classifyValidationReason({ text, labels })');
    expect(source).toContain('parseBlockedReason = parseBusy ?');
    expect(source).toContain('parseValidationReason({ grammarUrl, codeText })');
    expect(source).toContain('function classifyValidationReason');
    expect(source).toContain('function parseValidationReason');
    expect(source).toContain('disabled={Boolean(classifyBlockedReason)}');
    expect(source).toContain('disabled={Boolean(parseBlockedReason)}');
    expect(source).toContain('aria-busy={classifyBusy}');
    expect(source).toContain('aria-busy={parseBusy}');
    expect(source).toContain('draftStatus =');
    expect(source).toContain('Reloaded AI Lab inputs from this browser.');
    expect(source).toContain('class="result-grid"');
    expect(source).not.toContain('let busy = false');
  });

  it('blocks AI OS service-backed work until a status snapshot is loaded', async () => {
    const source = await routeSource('../routes/ai-os/+page.svelte');

    expect(source).toContain('aiOsActionBlocked = !aiOsReady');
    expect(source).toContain('aiOsActionBlockedReason = aiOsServiceActionBlockedReason');
    expect(source).toContain('function aiOsServiceActionBlockedReason');
    expect(source).toContain('function warmLocalModelBlockedReason');
    expect(source).toContain('disabled={Boolean(warmupBlockedReason)}');
    expect(source).toContain('function requireAiOsReady');
    expect(source).toContain('disabled={commandBusy || aiOsActionBlocked}');
    expect(source).toContain("title={aiOsActionBlockedReason || (commandBusy ? 'AI OS command is already running.' : 'Run this AI OS command.')}");
    expect(source).toContain('disabled={autotuneBusy || aiOsActionBlocked}');
    expect(source).toContain('disabled={designBusy || aiOsActionBlocked}');
    expect(source).toContain('disabled={benchmarkBusy || aiOsActionBlocked}');
    expect(source).toContain('id="command-objective-primary"');
    expect(source).toContain('id="command-objective-advanced"');
    expect(source).toContain('id="command-confirm-primary"');
    expect(source).toContain('id="command-confirm-advanced"');
    expect(source).not.toContain('id="command-objective"');
    expect(source).not.toContain('id="command-confirm"');
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
    expect(macro).toContain('macroControlTitle = macroDisabledReason({ loading, busy, serviceError, status })');
    expect(macro).toContain('macroControlDisabled = Boolean(macroControlTitle)');
    expect(macro).toContain('macroRefreshBlockedReason = macroRefreshDisabledReason({ loading, busy })');
    expect(macro).toContain('function macroRefreshDisabledReason');
    expect(macro).toContain("title={macroRefreshBlockedReason || 'Reload Macro Lab state from the desktop service.'}");
    expect(macro).toContain('function requireMacroReady');
    expect(macro).toContain('if (macroConnectionError(message)) serviceError = message');
    expect(macro).toContain('Macro Lab connection failed: {serviceError}');
    expect(macro).toContain("title={macroControlTitle || 'Run this macro with confirmed side effects.'}");
    expect(macro).toContain('disabled={macroControlDisabled}');
    expect(passive).toContain('passiveServiceReady = Boolean(snapshot && settings && !serviceError)');
    expect(passive).toContain('passiveWriteTitle = passiveDisabledReason({ loading, busyId, serviceError, serviceReady: passiveServiceReady })');
    expect(passive).toContain('passiveControlDisabled = Boolean(passiveWriteTitle)');
    expect(passive).toContain('passiveWriteDisabled = passiveControlDisabled');
    expect(passive).toContain('passiveRefreshBlockedReason = passiveRefreshDisabledReason({ loading, busyId })');
    expect(passive).toContain('function passiveRefreshDisabledReason');
    expect(passive).toContain("title={passiveRefreshBlockedReason || 'Reload the latest Passive Tasks snapshot.'}");
    expect(passive).toContain('function passiveDisabledReason');
    expect(passive).toContain('function requirePassiveReady');
    expect(passive).toContain('if (passiveConnectionError(nextError))');
    expect(passive).toContain('Passive Tasks API unavailable');
    expect(passive).toContain('Target: {getApiUrl()}. {localNetworkHint()}');
    expect(passive).toContain('disabled={passiveWriteDisabled}');
    expect(passive).toContain('title={passiveActionTitle');
    expect(passive).toContain('disabled={passiveWriteDisabled || !canRunTask(task, watcher)}');
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
    expect(source).toContain('disabled={productivityWriteDisabled}');
    expect(source).toContain('Open the cached thread preview. Connect the API and Google to fetch full messages.');
    expect(source).toContain('Showing cached thread preview. Connect the API and Google to fetch full messages, reply, label, or archive.');
    expect(source).toContain('cached productivity data can stay visible');
    expect(source).toContain('hubHref(routeMap.settings)');
    expect(source).toContain('disabled={productivityRefreshDisabled}');
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
    expect(source).toContain('refreshBlockedReason = activityRefreshBlockedReason({ loading, refreshing, busyKey })');
    expect(source).toContain('function activityRefreshBlockedReason');
    expect(source).toContain('function actionBlockedReason');
    expect(source).toContain('Another Activity action is already running.');
    expect(source).toContain('disabled={actionDisabled(record, action)}');
    expect(source).toContain('disabled={Boolean(refreshBlockedReason)}');
    expect(source).toContain("title={refreshBlockedReason || 'Refresh Activity records from connected sources.'}");
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
    expect(career).toContain('function careerSaveTitle');
    expect(career).toContain('function careerRowTitle');
    expect(career).toContain('Company and role are required before saving a job.');
    expect(career).toContain('disabled={!canSave || saving || !company.trim() || !role.trim()}');
    expect(career).toContain('title={saveJobEditTitle()}');
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
    expect(study).toContain('Add a study label before logging progress.');
    expect(study).toContain('disabled={!canSave || saving || !subject.trim() || minutes < 1}');
    expect(study).toContain('title={saveLogEditTitle()}');
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
    expect(source).toContain('function extractButtonStates');
    expect(source).toContain('function safeActionStatus');
    expect(source).toContain('function liveRenderState');
    expect(source).toContain('client-rendered shell');
    expect(source).toContain('rawNotFound');
    expect(source).toContain('Live DOM snapshot');
    expect(source).toContain('Exercise safe action');
    expect(source).toContain('verify persistence');
    expect(source).toContain('expectedBlockedState');
  });

  it('explains Stick Arena lab loading and offline save controls', async () => {
    const source = await routeSource('../routes/games/stick-arena-lab/+page.svelte');

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
