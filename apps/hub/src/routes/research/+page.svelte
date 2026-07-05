<script lang="ts">
  import { onMount } from 'svelte';
  import { routeMap } from '@mini-hub/core';
  import { Bell, Database, Download, ExternalLink, FileText, Pause, Play, RefreshCw, Search, Trash2, X } from 'lucide-svelte';
  import {
    cancelResearchRun,
    createResearchMonitor,
    createResearchRun,
    deleteResearchMonitor,
    getAiOsApiUrl,
    getResearchRun,
    listResearchMonitors,
    listResearchRuns,
    listResearchSources,
    pauseResearchRun,
    researchExportUrl,
    resumeResearchRun,
    runDueResearchMonitors,
    runResearchMonitor,
    updateResearchMonitor,
    type ResearchCitation,
    type ResearchMonitor,
    type ResearchMonitorSchedule,
    type ResearchMode,
    type ResearchRun,
    type ResearchRunInput,
    type ResearchSource,
    type ResearchSourceCard
  } from '$lib/ai-os-api';
  import { getBrowserStorage } from '$lib/browser-storage';
  import { hubHref } from '$lib/routes';
  import { localNetworkHint } from '$lib/service-config';
  import { compactServiceIssueIfRecognized } from '$lib/service-issues';
  import {
    compactResearchServiceIssue,
    isResearchServiceError,
    isResearchRunActive,
    normalizeResearchDraft,
    researchDraftStorageKey,
    researchRunListState,
    selectRecoverableResearchRun,
    type ResearchDraftState
  } from '$lib/research-state';

  type SourceLike = Pick<ResearchSource, 'url' | 'canonical_url'>;

  type ResearchEffort = 'quick' | 'standard' | 'deep';
  type ResearchEffortOption = {
    id: ResearchEffort;
    label: string;
    hint: string;
    mode: ResearchMode;
    depth: number;
    maxPages: number;
    perDomainLimit: number;
    timeBudget: number;
    useAi: boolean;
  };

  interface ResearchMonitorActionState {
    aiOsUnavailable: boolean;
    serviceProbePending: boolean;
    monitorsLoading: boolean;
    monitorActionId: string;
  }

  interface ResearchServicesRefreshState {
    refreshing: boolean;
    monitorsLoading: boolean;
    sourceLibraryLoading: boolean;
  }

  type ResearchReportSection =
    | 'tldr'
    | 'reliability'
    | 'detailedSummary'
    | 'keyFacts'
    | 'openQuestions'
    | 'disagreements'
    | 'nextResearch'
    | 'timeline'
    | 'sourceTable'
    | 'queryPlan'
    | 'runLog'
    | 'citations';

  const effortOptions: ResearchEffortOption[] = [
    {
      id: 'quick',
      label: 'Quick',
      hint: 'Fast scan for a first answer.',
      mode: 'quick_search',
      depth: 1,
      maxPages: 6,
      perDomainLimit: 3,
      timeBudget: 75,
      useAi: false
    },
    {
      id: 'standard',
      label: 'Standard',
      hint: 'Balanced report with citations.',
      mode: 'deep_research',
      depth: 2,
      maxPages: 12,
      perDomainLimit: 4,
      timeBudget: 150,
      useAi: true
    },
    {
      id: 'deep',
      label: 'Deep',
      hint: 'More source comparison and follow-ups.',
      mode: 'compare_sources',
      depth: 3,
      maxPages: 24,
      perDomainLimit: 6,
      timeBudget: 300,
      useAi: true
    }
  ];

  let mode: ResearchMode = 'quick_search';
  let effort: ResearchEffort = 'standard';
  let goal = '';
  let seedUrlsText = '';
  let includeDomainsText = '';
  let excludeDomainsText = '';
  let depth = 1;
  let maxPages = 6;
  let perDomainLimit = 4;
  let timeBudget = 90;
  let dateRangeStart = '';
  let dateRangeEnd = '';
  let useAi = false;
  let useCloudAi = false;
  let saveToMemory = false;
  let screenshot = false;
  let provider = '';
  let model = '';
  let advancedOpen = false;
  let loading = false;
  let refreshing = false;
  let sourceLibraryLoading = false;
  let error = '';
  let message = '';
  let sourceLibraryError = '';
  let sourceLibraryMessage = '';
  let monitorError = '';
  let monitorMessage = '';
  let runs: ResearchRun[] = [];
  let selectedRun: ResearchRun | null = null;
  let sourceLibrary: ResearchSourceCard[] = [];
  let monitors: ResearchMonitor[] = [];
  let sourceQuery = '';
  let sourceDomain = '';
  let monitorName = '';
  let monitorSchedule: ResearchMonitorSchedule = 'manual';
  let monitorsLoading = false;
  let monitorActionId = '';
  let runActionId = '';
  let serviceProbePending = true;
  let draftHydrated = false;
  let requestedRunId = '';
  let persistedRunId = '';
  let selectedMonitorId = '';
  let restoredMonitorSummaryId = '';

  $: currentEffort = effortOptions.find((item) => item.id === effort) ?? effortOptions[1];
  $: seedUrls = splitList(seedUrlsText);
  $: includeDomains = splitList(includeDomainsText);
  $: excludeDomains = splitList(excludeDomainsText);
  $: serviceIssue = compactResearchServiceIssue([error, monitorError, sourceLibraryError]);
  $: aiOsUnavailable = Boolean(serviceIssue);
  $: visibleRunError = serviceIssue && isResearchServiceError(error) ? '' : compactResearchInlineError(error, 'Research run');
  $: visibleMonitorError = serviceIssue && isResearchServiceError(monitorError) ? '' : compactResearchInlineError(monitorError, 'Research monitor');
  $: visibleSourceLibraryError =
    serviceIssue && isResearchServiceError(sourceLibraryError) ? '' : compactResearchInlineError(sourceLibraryError, 'Research source library');
  $: runsPanelState = researchRunListState({ loading: refreshing, error: visibleRunError, runCount: runs.length });
  $: researchRunBlockedReason = researchRunDisabledReason({
    loading,
    serviceProbePending,
    aiOsUnavailable
  });
  $: researchRunDisabled = Boolean(researchRunBlockedReason);
  $: serviceBlockedLabel = aiOsUnavailable
    ? 'Connect AI OS'
    : serviceProbePending
      ? 'Checking AI OS'
      : loading
        ? 'Queueing'
        : 'Run Research';
  $: sourceLibrarySearchDisabled = sourceLibraryLoading || aiOsUnavailable || serviceProbePending;
  $: sourceLibrarySearchTitle = aiOsUnavailable
    ? 'Connect AI OS before searching the archived source library.'
    : serviceProbePending
      ? 'Research Desk is checking whether AI OS is reachable.'
    : sourceLibraryLoading
      ? 'Source library search is already running.'
      : 'Search archived Research Desk source cards.';
  $: selectedRunActionBlockedReason = !selectedRun
    ? 'Select a research run before controlling it.'
    : aiOsUnavailable
    ? 'Connect AI OS before controlling this research run.'
    : serviceProbePending
    ? 'Research Desk is checking AI OS before run controls are enabled.'
    : runActionId
      ? 'A research run action is already in progress.'
      : '';
  $: selectedRunActionDisabled = Boolean(selectedRunActionBlockedReason);
  $: selectedRunActionTitle = selectedRunActionBlockedReason || 'Control the selected research run.';
  $: monitorActionState = {
    aiOsUnavailable,
    serviceProbePending,
    monitorsLoading,
    monitorActionId
  };
  $: researchServicesRefreshState = {
    refreshing,
    monitorsLoading,
    sourceLibraryLoading
  };
  $: researchRunButtonTitle = runResearchTitle({
    blockedReason: researchRunBlockedReason,
    effort: currentEffort
  });
  $: refreshRunsButtonTitle = refreshRunsTitle(refreshing);
  $: refreshMonitorsButtonTitle = refreshMonitorsTitle(monitorActionState);
  $: researchServicesButtonTitle = researchServicesRefreshTitle(researchServicesRefreshState);
  $: saveCurrentMonitorButtonTitle = saveCurrentMonitorTitle(monitorActionState, goal);
  $: advancedToggleButtonTitle = advancedToggleTitle(advancedOpen);
  $: researchDraftForPersistence = {
    mode,
    effort,
    goal,
    seedUrlsText,
    includeDomainsText,
    excludeDomainsText,
    depth,
    maxPages,
    perDomainLimit,
    timeBudget,
    dateRangeStart,
    dateRangeEnd,
    useAi,
    useCloudAi,
    saveToMemory,
    screenshot,
    provider,
    model,
    advancedOpen,
    monitorName,
    monitorSchedule,
    selectedRunId: selectedRun?.id ?? persistedRunId,
    selectedMonitorId
  } satisfies ResearchDraftState;
  $: selectedMonitorForDraft = monitors.find((monitor) => monitor.id === selectedMonitorId);
  $: if (draftHydrated && selectedMonitorForDraft && selectedMonitorForDraft.id !== restoredMonitorSummaryId) {
    restoreSelectedMonitorSummary(selectedMonitorForDraft);
  }
  $: if (!selectedMonitorId && restoredMonitorSummaryId) restoredMonitorSummaryId = '';
  $: if (draftHydrated) persistResearchDraft(researchDraftForPersistence);

  function runResearchTitle(state: { blockedReason: string; effort: ResearchEffortOption }): string {
    if (state.blockedReason) return state.blockedReason;
    return `Start a ${state.effort.label.toLowerCase()} research run.`;
  }

  function researchRunDisabledReason(state: {
    loading: boolean;
    serviceProbePending: boolean;
    aiOsUnavailable: boolean;
  }): string {
    if (state.aiOsUnavailable) return 'Connect AI OS before starting a research run.';
    if (state.serviceProbePending) return 'Research Desk is checking whether AI OS is reachable before starting a run.';
    if (state.loading) return 'Research run is already being queued.';
    return '';
  }

  function refreshRunsTitle(isRefreshing: boolean): string {
    return isRefreshing ? 'Research runs are already refreshing.' : 'Refresh research runs from AI OS.';
  }

  function refreshMonitorsTitle(state: ResearchMonitorActionState): string {
    if (state.monitorActionId) return 'Another research monitor action is already running.';
    if (state.monitorsLoading) return 'Research monitors are already refreshing.';
    return 'Refresh research monitors from AI OS.';
  }

  function researchRunsEmptyMessage(): string {
    if (serviceProbePending || refreshing) return 'Checking saved research runs.';
    if (aiOsUnavailable) return 'Saved reports will reload after the AI OS service card reconnects.';
    return runsPanelState;
  }

  function monitorEmptyMessage(): string {
    if (serviceProbePending) return 'Checking saved topic monitors.';
    if (aiOsUnavailable) return 'Saved topic monitors will reload after the AI OS service card reconnects.';
    return 'No topic monitors yet. Fill in a goal and knobs above, then save the setup here.';
  }

  function sourceLibraryEmptyMessage(): string {
    if (serviceProbePending) return 'Checking archived source cards.';
    if (aiOsUnavailable) return 'Archived sources will reload after the AI OS service card reconnects.';
    return 'No archived sources matched. Run a research job first, or relax the search/domain filter.';
  }

  function compactResearchInlineError(value = '', label = 'Research'): string {
    const text = value.trim();
    if (!text) return '';
    const compact = compactServiceIssueIfRecognized(text, label);
    return compact === text && text.length > 140 ? `${text.slice(0, 137)}...` : compact;
  }

  function monitorLastErrorDetail(monitor: ResearchMonitor): string {
    return compactResearchInlineError(monitor.last_error ?? '', 'Research monitor');
  }

  function selectedReportSectionEmptyMessage(section: ResearchReportSection): string {
    const label = researchReportSectionLabel(section);
    if (!selectedRun) return `Select a saved research run to inspect ${label}.`;
    if (isResearchRunActive(selectedRun)) {
      return `${label} will appear after this ${selectedRun.status} run produces that part of the report. The run remains recoverable from Activity.`;
    }
    if (selectedRun.status === 'failed' || selectedRun.status === 'cancelled') {
      return `${label} was not recorded before this run ${selectedRun.status}. Open logs or retry from Activity.`;
    }
    return `${label} was not recorded in this saved report. The run remains recoverable from Activity.`;
  }

  function researchReportSectionLabel(section: ResearchReportSection): string {
    if (section === 'tldr') return 'TLDR';
    if (section === 'reliability') return 'Reliability notes';
    if (section === 'detailedSummary') return 'Detailed summary';
    if (section === 'keyFacts') return 'Key facts';
    if (section === 'openQuestions') return 'Open questions';
    if (section === 'disagreements') return 'Source disagreements';
    if (section === 'nextResearch') return 'Follow-up suggestions';
    if (section === 'timeline') return 'Dated source timeline';
    if (section === 'sourceTable') return 'Source table';
    if (section === 'queryPlan') return 'Query plan';
    if (section === 'runLog') return 'Run log';
    return 'Citations';
  }

  function monitorActionBlockedReason(state: ResearchMonitorActionState, monitor?: ResearchMonitor): string {
    if (state.aiOsUnavailable) return 'Connect AI OS before changing research monitors.';
    if (state.serviceProbePending) return 'Research Desk is checking AI OS before monitor actions are enabled.';
    if (state.monitorsLoading) return 'Research monitors are loading or syncing.';
    if (state.monitorActionId && (!monitor || !state.monitorActionId.startsWith(`${monitor.id}:`))) {
      return 'Another research monitor action is already running.';
    }
    if (state.monitorActionId && monitor && state.monitorActionId.startsWith(`${monitor.id}:`)) {
      return 'This research monitor action is already running.';
    }
    return '';
  }

  function monitorActionDisabled(state: ResearchMonitorActionState, monitor?: ResearchMonitor): boolean {
    return Boolean(monitorActionBlockedReason(state, monitor));
  }

  function monitorActionTitle(state: ResearchMonitorActionState, enabledTitle: string, monitor?: ResearchMonitor): string {
    return monitorActionBlockedReason(state, monitor) || enabledTitle;
  }

  function saveCurrentMonitorTitle(state: ResearchMonitorActionState, currentGoal: string): string {
    if (!currentGoal.trim()) return 'Enter a research goal before saving a monitor.';
    return monitorActionTitle(state, 'Save the current workbench as a reusable monitor.');
  }

  function researchEffortTitle(item: ResearchEffortOption): string {
    return effort === item.id ? `${item.label} effort is selected.` : `Use ${item.label} effort: ${item.hint}`;
  }

  function advancedToggleTitle(isOpen: boolean): string {
    return isOpen
      ? 'Hide advanced research knobs; current values stay saved in this browser.'
      : 'Show optional source, provider, model, domain, limit, and indexing controls.';
  }

  function researchRunSelectionTitle(run: ResearchRun): string {
    const title = displayRunTitle(run, 160);
    return selectedRun?.id === run.id ? `${title} is the selected report.` : `Open ${title} from saved research runs.`;
  }

  function sourceSeedAlreadyAdded(url: string): boolean {
    const next = normalizeTextUrl(url);
    return Boolean(next && seedUrls.some((item) => normalizeTextUrl(item) === next));
  }

  function sourceSeedDisabled(url: string): boolean {
    return !normalizeTextUrl(url) || sourceSeedAlreadyAdded(url);
  }

  function sourceSeedTitle(url: string): string {
    const next = normalizeTextUrl(url);
    if (!next) return 'This archived source does not have a usable URL.';
    if (sourceSeedAlreadyAdded(url)) return 'This source is already listed in Seed URLs.';
    return 'Add this archived source URL to Seed URLs.';
  }

  function selectEffort(next: ResearchEffort): void {
    const option = effortOptions.find((item) => item.id === next) ?? effortOptions[1];
    effort = option.id;
    mode = option.mode;
    depth = option.depth;
    maxPages = option.maxPages;
    perDomainLimit = option.perDomainLimit;
    timeBudget = option.timeBudget;
    useAi = option.useAi;
  }

  function effortFromResearchMode(value: ResearchMode | undefined): ResearchEffort {
    if (value === 'quick_search' || value === 'url_scrape') return 'quick';
    if (value === 'deep_research') return 'standard';
    if (value === 'site_crawl' || value === 'compare_sources') return 'deep';
    return 'standard';
  }

  function monitorActionBusy(monitor: ResearchMonitor, action: 'run' | 'toggle' | 'delete'): boolean {
    return monitorActionId === `${monitor.id}:${action}`;
  }

  onMount(() => {
    hydrateResearchDraft();
    requestedRunId = requestedResearchRunId();
    void initialResearchServiceCheck();
  });

  async function initialResearchServiceCheck(): Promise<void> {
    serviceProbePending = true;
    try {
      await refreshResearchServices();
    } finally {
      serviceProbePending = false;
    }
  }

  async function refreshRuns(): Promise<void> {
    if (refreshing) return;
    refreshing = true;
    error = '';
    try {
      const urlRunId = requestedRunId || requestedResearchRunId();
      const runId = urlRunId || persistedRunId;
      let nextRuns = await listResearchRuns(20);
      if (runId && !nextRuns.some((run) => run.id === runId)) {
        const requested = await getResearchRun(runId).catch(() => null);
        if (requested) nextRuns = [requested, ...nextRuns].slice(0, 20);
      }
      runs = nextRuns;
      const nextSelected = selectRecoverableResearchRun(runs, {
        requestedRunId: runId,
        currentRunId: selectedRun?.id
      });
      if (nextSelected) setSelectedRun(nextSelected, { updateUrl: !urlRunId });
      else selectedRun = null;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Research runs failed to load.';
    } finally {
      refreshing = false;
    }
  }

  async function refreshResearchServices(): Promise<void> {
    await Promise.all([refreshRuns(), refreshSourceLibrary(), refreshMonitors()]);
  }

  function researchServicesRefreshTitle(state: ResearchServicesRefreshState): string {
    if (state.refreshing || state.monitorsLoading || state.sourceLibraryLoading) {
      return 'Research service refresh is already running.';
    }
    return 'Retry AI OS research runs, monitors, and source library.';
  }

  async function refreshSourceLibrary(): Promise<void> {
    sourceLibraryLoading = true;
    sourceLibraryError = '';
    try {
      sourceLibrary = await listResearchSources({
        q: sourceQuery,
        domain: sourceDomain,
        limit: 20
      });
    } catch (err) {
      sourceLibraryError = err instanceof Error ? err.message : 'Source library failed to load.';
    } finally {
      sourceLibraryLoading = false;
    }
  }

  async function refreshMonitors(): Promise<void> {
    monitorsLoading = true;
    monitorError = '';
    try {
      monitors = await listResearchMonitors(30);
    } catch (err) {
      monitorError = err instanceof Error ? err.message : 'Research monitors failed to load.';
    } finally {
      monitorsLoading = false;
    }
  }

  function currentResearchInput(modeOverride?: ResearchMode): ResearchRunInput {
    const selectedMode = modeOverride ?? currentEffort.mode;
    return {
      mode: selectedMode,
      goal: goal.trim(),
      seed_urls: seedUrls,
      include_domains: includeDomains,
      exclude_domains: excludeDomains,
      depth,
      max_pages: maxPages,
      per_domain_limit: perDomainLimit,
      time_budget_s: timeBudget,
      date_range_start: dateRangeStart || undefined,
      date_range_end: dateRangeEnd || undefined,
      use_ai: useAi,
      use_cloud_ai: useCloudAi,
      local_first: !useCloudAi,
      screenshot,
      save_to_memory: saveToMemory,
      provider: provider.trim() || undefined,
      model: model.trim() || undefined
    };
  }

  async function runResearch(): Promise<void> {
    if (researchRunBlockedReason) {
      error = aiOsUnavailable && serviceIssue ? serviceIssue : researchRunBlockedReason;
      return;
    }
    if (!goal.trim()) {
      error = 'Type a research goal, question, topic, company, person, site, or seed URL.';
      return;
    }
    loading = true;
    error = '';
    message = '';
    try {
      const run = await createResearchRun(currentResearchInput());
      setSelectedRun(run);
      runs = [run, ...runs.filter((item) => item.id !== run.id)].slice(0, 20);
      message = `Queued ${currentEffort.label.toLowerCase()} research. The report will update as sources arrive.`;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Research run failed.';
    } finally {
      loading = false;
    }
  }

  async function saveCurrentMonitor(): Promise<void> {
    const blocked = monitorActionBlockedReason(monitorActionState);
    if (blocked) {
      monitorError = aiOsUnavailable ? serviceIssue : blocked;
      return;
    }
    if (!goal.trim()) {
      monitorError = 'Type a topic or goal before saving a monitor.';
      return;
    }
    monitorsLoading = true;
    monitorError = '';
    monitorMessage = '';
    try {
      const monitor = await createResearchMonitor({
        name: monitorName.trim() || undefined,
        enabled: true,
        schedule: monitorSchedule,
        request: {
          ...currentResearchInput('monitor_topic'),
          metadata: { created_from: 'research_desk' }
        }
      });
      monitors = [monitor, ...monitors.filter((item) => item.id !== monitor.id)].slice(0, 30);
      selectedMonitorId = monitor.id;
      monitorName = '';
      monitorMessage = 'Saved topic monitor. Use Run Now whenever you want a fresh report.';
    } catch (err) {
      monitorError = err instanceof Error ? err.message : 'Could not save research monitor.';
    } finally {
      monitorsLoading = false;
    }
  }

  async function toggleMonitor(monitor: ResearchMonitor): Promise<void> {
    const blocked = monitorActionBlockedReason(monitorActionState, monitor);
    if (blocked) {
      monitorError = aiOsUnavailable ? serviceIssue : blocked;
      return;
    }
    monitorActionId = `${monitor.id}:toggle`;
    monitorError = '';
    monitorMessage = '';
    try {
      const updated = await updateResearchMonitor(monitor.id, { enabled: !monitor.enabled });
      monitors = monitors.map((item) => (item.id === updated.id ? updated : item));
      selectedMonitorId = updated.id;
      monitorMessage = updated.enabled ? 'Enabled monitor.' : 'Disabled monitor.';
    } catch (err) {
      monitorError = err instanceof Error ? err.message : 'Could not update monitor.';
    } finally {
      monitorActionId = '';
    }
  }

  async function runMonitor(monitor: ResearchMonitor): Promise<void> {
    const blocked = monitorActionBlockedReason(monitorActionState, monitor);
    if (blocked) {
      monitorError = aiOsUnavailable ? serviceIssue : blocked;
      return;
    }
    monitorActionId = `${monitor.id}:run`;
    monitorError = '';
    monitorMessage = '';
    try {
      const result = await runResearchMonitor(monitor.id);
      monitors = [result.monitor, ...monitors.filter((item) => item.id !== result.monitor.id)].slice(0, 30);
      selectedMonitorId = result.monitor.id;
      setSelectedRun(result.run);
      runs = [result.run, ...runs.filter((item) => item.id !== result.run.id)].slice(0, 20);
      monitorMessage = `Queued monitor run for ${displayResearchTitle(result.monitor.name, 'routine research monitor', 140)}.`;
    } catch (err) {
      monitorError = err instanceof Error ? err.message : 'Could not run monitor.';
    } finally {
      monitorActionId = '';
    }
  }

  async function runDueMonitors(): Promise<void> {
    const blocked = monitorActionBlockedReason(monitorActionState);
    if (blocked) {
      monitorError = aiOsUnavailable ? serviceIssue : blocked;
      return;
    }
    monitorsLoading = true;
    monitorActionId = 'due-sweep';
    monitorError = '';
    monitorMessage = '';
    try {
      const result = await runDueResearchMonitors({ limit: 8 });
      if (result.runs.length) {
        runs = [...result.runs, ...runs.filter((run) => !result.runs.some((item) => item.id === run.id))].slice(0, 20);
        setSelectedRun(result.runs[0]);
      }
      await refreshMonitors();
      monitorMessage = result.queued_count
        ? `Queued ${result.queued_count} due monitor run${result.queued_count === 1 ? '' : 's'}.`
        : 'No enabled daily or weekly monitors are due right now.';
    } catch (err) {
      monitorError = err instanceof Error ? err.message : 'Could not run due monitors.';
    } finally {
      monitorActionId = '';
      monitorsLoading = false;
    }
  }

  async function removeMonitor(monitor: ResearchMonitor): Promise<void> {
    const blocked = monitorActionBlockedReason(monitorActionState, monitor);
    if (blocked) {
      monitorError = aiOsUnavailable ? serviceIssue : blocked;
      return;
    }
    monitorActionId = `${monitor.id}:delete`;
    monitorError = '';
    monitorMessage = '';
    if (!window.confirm(`Delete research monitor "${displayMonitorName(monitor, 140)}"? Archived reports stay saved.`)) {
      monitorActionId = '';
      return;
    }
    try {
      await deleteResearchMonitor(monitor.id);
      monitors = monitors.filter((item) => item.id !== monitor.id);
      if (selectedMonitorId === monitor.id) {
        selectedMonitorId = '';
        restoredMonitorSummaryId = '';
      }
      monitorMessage = 'Deleted monitor. Archived reports were left intact.';
    } catch (err) {
      monitorError = err instanceof Error ? err.message : 'Could not delete monitor.';
    } finally {
      monitorActionId = '';
    }
  }

  function loadMonitorIntoForm(monitor: ResearchMonitor): void {
    selectedMonitorId = monitor.id;
    restoredMonitorSummaryId = monitor.id;
    const request = monitor.request;
    mode = request.mode ?? 'monitor_topic';
    effort = effortFromResearchMode(request.mode);
    goal = request.goal ?? '';
    seedUrlsText = (request.seed_urls ?? []).join('\n');
    includeDomainsText = (request.include_domains ?? []).join(', ');
    excludeDomainsText = (request.exclude_domains ?? []).join(', ');
    depth = request.depth ?? 1;
    maxPages = request.max_pages ?? 6;
    perDomainLimit = request.per_domain_limit ?? 4;
    timeBudget = request.time_budget_s ?? 90;
    dateRangeStart = request.date_range_start ?? '';
    dateRangeEnd = request.date_range_end ?? '';
    useAi = Boolean(request.use_ai);
    useCloudAi = Boolean(request.use_cloud_ai);
    saveToMemory = Boolean(request.save_to_memory);
    screenshot = Boolean(request.screenshot);
    provider = request.provider ?? '';
    model = request.model ?? '';
    monitorName = displayMonitorName(monitor, 160);
    monitorSchedule = monitor.schedule;
    monitorMessage = 'Loaded monitor settings into the workbench.';
  }

  function restoreSelectedMonitorSummary(monitor: ResearchMonitor): void {
    restoredMonitorSummaryId = monitor.id;
    monitorName = monitorName.trim() ? monitorName : displayMonitorName(monitor, 160);
    monitorSchedule = monitor.schedule;
    const request = monitor.request;
    if (!goal.trim()) goal = request.goal ?? '';
    if (!seedUrlsText.trim() && request.seed_urls?.length) seedUrlsText = request.seed_urls.join('\n');
    if (!includeDomainsText.trim() && request.include_domains?.length) includeDomainsText = request.include_domains.join(', ');
    if (!excludeDomainsText.trim() && request.exclude_domains?.length) excludeDomainsText = request.exclude_domains.join(', ');
    mode = mode || request.mode || 'monitor_topic';
    effort = effortFromResearchMode(request.mode);
  }

  async function pollLiveRuns(): Promise<void> {
    const liveIds = new Set(runs.filter(isResearchRunActive).map((run) => run.id));
    if (selectedRun && isResearchRunActive(selectedRun)) liveIds.add(selectedRun.id);
    if (!liveIds.size) return;
    try {
      const updates = (await Promise.all(Array.from(liveIds).map((id) => getResearchRun(id).catch(() => null)))).filter(
        (run): run is ResearchRun => Boolean(run)
      );
      if (!updates.length) return;
      for (const update of updates) {
        runs = [update, ...runs.filter((item) => item.id !== update.id)].slice(0, 20);
        if (selectedRun?.id === update.id) setSelectedRun(update, { updateUrl: false });
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Research run refresh failed.';
    }
  }

  async function cancelRun(run: ResearchRun): Promise<void> {
    if (aiOsUnavailable) {
      error = serviceIssue;
      return;
    }
    if (runActionId) return;
    if (!window.confirm(`Cancel research run "${run.goal || run.id}"? Saved reports and Activity records remain recoverable.`)) {
      message = 'Research cancellation skipped.';
      return;
    }
    runActionId = `${run.id}:cancel`;
    error = '';
    message = '';
    try {
      const cancelled = await cancelResearchRun(run.id);
      runs = [cancelled, ...runs.filter((item) => item.id !== cancelled.id)].slice(0, 20);
      if (selectedRun?.id === cancelled.id) setSelectedRun(cancelled, { updateUrl: false });
      message = 'Research run cancelled.';
    } catch (err) {
      error = err instanceof Error ? err.message : 'Could not cancel research run.';
    } finally {
      runActionId = '';
    }
  }

  async function cancelSelectedRun(): Promise<void> {
    if (!selectedRun || selectedRunActionDisabled) {
      if (aiOsUnavailable) error = serviceIssue;
      return;
    }
    await cancelRun(selectedRun);
  }

  async function pauseRun(run: ResearchRun): Promise<void> {
    if (aiOsUnavailable) {
      error = serviceIssue;
      return;
    }
    if (runActionId) return;
    runActionId = `${run.id}:pause`;
    error = '';
    message = '';
    try {
      const paused = await pauseResearchRun(run.id);
      runs = [paused, ...runs.filter((item) => item.id !== paused.id)].slice(0, 20);
      if (selectedRun?.id === paused.id) setSelectedRun(paused, { updateUrl: false });
      message = 'Research run paused.';
    } catch (err) {
      error = err instanceof Error ? err.message : 'Could not pause research run.';
    } finally {
      runActionId = '';
    }
  }

  async function resumeRun(run: ResearchRun): Promise<void> {
    if (aiOsUnavailable) {
      error = serviceIssue;
      return;
    }
    if (runActionId) return;
    runActionId = `${run.id}:resume`;
    error = '';
    message = '';
    try {
      const resumed = await resumeResearchRun(run.id);
      runs = [resumed, ...runs.filter((item) => item.id !== resumed.id)].slice(0, 20);
      if (selectedRun?.id === resumed.id) setSelectedRun(resumed, { updateUrl: false });
      message = 'Research run resumed.';
    } catch (err) {
      error = err instanceof Error ? err.message : 'Could not resume research run.';
    } finally {
      runActionId = '';
    }
  }

  async function pauseSelectedRun(): Promise<void> {
    if (!selectedRun || selectedRunActionDisabled) {
      if (aiOsUnavailable) error = serviceIssue;
      return;
    }
    await pauseRun(selectedRun);
  }

  async function resumeSelectedRun(): Promise<void> {
    if (!selectedRun || selectedRunActionDisabled) {
      if (aiOsUnavailable) error = serviceIssue;
      return;
    }
    await resumeRun(selectedRun);
  }

  function runActionBusy(run: ResearchRun, action: 'pause' | 'resume' | 'cancel'): boolean {
    return runActionId === `${run.id}:${action}`;
  }

  function reportExportHref(run: ResearchRun, format: 'markdown' | 'json' | 'html'): string {
    return aiOsUnavailable ? hubHref('/settings#feature-wiring') : researchExportUrl(run.id, format);
  }

  function reportExportTitle(format: string): string {
    return aiOsUnavailable ? `Connect AI OS before exporting this report as ${format}.` : `Export this report as ${format}.`;
  }

  function splitList(value: string): string[] {
    return value
      .split(/[\n,]/u)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function defaultResearchDraft(): ResearchDraftState {
    return {
      mode,
      effort,
      goal,
      seedUrlsText,
      includeDomainsText,
      excludeDomainsText,
      depth,
      maxPages,
      perDomainLimit,
      timeBudget,
      dateRangeStart,
      dateRangeEnd,
      useAi,
      useCloudAi,
      saveToMemory,
      screenshot,
      provider,
      model,
      advancedOpen,
      monitorName,
      monitorSchedule,
      selectedRunId: selectedRun?.id ?? persistedRunId,
      selectedMonitorId
    };
  }

  function currentResearchDraft(): ResearchDraftState {
    return defaultResearchDraft();
  }

  function applyResearchDraft(draft: ResearchDraftState): void {
    mode = draft.mode;
    effort = draft.effort;
    goal = draft.goal;
    seedUrlsText = draft.seedUrlsText;
    includeDomainsText = draft.includeDomainsText;
    excludeDomainsText = draft.excludeDomainsText;
    depth = draft.depth;
    maxPages = draft.maxPages;
    perDomainLimit = draft.perDomainLimit;
    timeBudget = draft.timeBudget;
    dateRangeStart = draft.dateRangeStart;
    dateRangeEnd = draft.dateRangeEnd;
    useAi = draft.useAi;
    useCloudAi = draft.useCloudAi;
    saveToMemory = draft.saveToMemory;
    screenshot = draft.screenshot;
    provider = draft.provider;
    model = draft.model;
    advancedOpen = draft.advancedOpen;
    monitorName = draft.monitorName;
    monitorSchedule = draft.monitorSchedule;
    persistedRunId = draft.selectedRunId;
    selectedMonitorId = draft.selectedMonitorId;
  }

  function hydrateResearchDraft(): void {
    const storage = getBrowserStorage();
    if (!storage) {
      draftHydrated = true;
      return;
    }
    try {
      const parsed = JSON.parse(storage.getItem(researchDraftStorageKey) ?? 'null') as unknown;
      applyResearchDraft(normalizeResearchDraft(parsed, defaultResearchDraft()));
    } catch {
      // Draft state is visual convenience only; ignore invalid browser storage.
    } finally {
      draftHydrated = true;
    }
  }

  function persistResearchDraft(nextDraft: ResearchDraftState = currentResearchDraft()): void {
    const storage = getBrowserStorage();
    if (!storage) return;
    try {
      storage.setItem(researchDraftStorageKey, JSON.stringify(nextDraft));
    } catch {
      // Browser storage can be full or unavailable; real run records remain backend-persisted.
    }
  }

  function requestedResearchRunId(): string {
    if (typeof window === 'undefined') return '';
    return new URL(window.location.href).searchParams.get('run') ?? '';
  }

  function setSelectedRun(run: ResearchRun, options: { updateUrl?: boolean } = {}): void {
    selectedRun = run;
    persistedRunId = run.id;
    if (options.updateUrl !== false) updateSelectedRunUrl(run.id);
  }

  function updateSelectedRunUrl(runId: string): void {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    url.searchParams.set('run', runId);
    requestedRunId = runId;
    window.history.replaceState({}, '', url.toString());
  }

  function displayResearchTitle(value: string | undefined, fallback = 'Saved research report', maxLength = 180): string {
    const raw = (value ?? '').trim() || fallback;
    const cleaned = raw
      .replace(/^(?:quick search|deep research|url scrape|site crawl|compare sources|monitor topic)\s*:\s*/iu, '')
      .trim();
    return compactDisplayText(cleaned || raw, maxLength);
  }

  function displayRunTitle(run: ResearchRun, maxLength = 150): string {
    return displayResearchTitle(run.report.title, 'Saved research report', maxLength);
  }

  function displayMonitorName(monitor: ResearchMonitor, maxLength = 120): string {
    return displayResearchTitle(monitor.name, 'Routine research monitor', maxLength);
  }

  function displayMonitorGoal(monitor: ResearchMonitor): string {
    return compactDisplayText(monitor.request.goal, 260);
  }

  function runMeta(run: ResearchRun): string {
    const providerLabel = [run.provider, run.model].filter(Boolean).join('/');
    const parts = [
      runEffortLabel(run),
      isLiveRun(run) ? `${progressPercent(run)}%` : '',
      `${run.sources.length} source${run.sources.length === 1 ? '' : 's'}`,
      `${Math.round(run.runtime_ms)} ms`,
      run.cached_pages ? `${run.cached_pages} cached` : '',
      run.memory_chunks ? `${run.memory_chunks} memory chunks` : '',
      providerLabel || 'extractive'
    ].filter(Boolean);
    return parts.join(' - ');
  }

  function runEffortLabel(run: Pick<ResearchRun, 'mode' | 'options'>): string {
    if (run.mode === 'monitor_topic') return 'monitor';
    if (run.mode === 'quick_search' || run.mode === 'url_scrape') return 'quick';
    if (run.mode === 'deep_research') return 'standard';
    if (run.mode === 'site_crawl' || run.mode === 'compare_sources') return 'deep';
    return 'research';
  }

  function isLiveRun(run: ResearchRun): boolean {
    return run.status === 'queued' || run.status === 'running';
  }

  function isPausedRun(run: ResearchRun): boolean {
    return run.status === 'paused';
  }

  function progressPercent(run: ResearchRun): number {
    return Math.max(0, Math.min(100, Math.round((run.progress ?? 0) * 100)));
  }

  function statusLabel(run: ResearchRun): string {
    if (run.status === 'succeeded') return 'saved';
    return run.status.replace('_', ' ');
  }

  function sourceHost(source: SourceLike): string {
    try {
      return new URL(source.canonical_url || source.url).hostname.replace(/^www\./u, '');
    } catch {
      return source.canonical_url || source.url;
    }
  }

  function blockedExternalSourceText(value: string): boolean {
    const text = value.toLowerCase();
    return (
      /\b403\b/u.test(text) ||
      text.includes('access denied') ||
      text.includes("don't have permission") ||
      text.includes('do not have permission') ||
      text.includes('site currently unavailable') ||
      text.includes('page unavailable')
    );
  }

  function compactBlockedExternalSourceText(value: string): string {
    if (!blockedExternalSourceText(value)) return value;
    return 'External source limited automated capture. The source record is saved for inspection; Mini Hub is connected.';
  }

  function compactDisplayText(value: string, maxLength = 520): string {
    const compact = compactBlockedExternalSourceText(value).replace(/\s+/gu, ' ').trim();
    if (!compact) return '';
    return compact.length > maxLength ? `${compact.slice(0, maxLength).trim()}...` : compact;
  }

  function reportText(value: string | undefined, fallback: string): string {
    const text = (value ?? '').trim();
    if (!text) return fallback;
    return compactDisplayText(text, 1800);
  }

  function reportParagraphs(value: string | undefined, fallback: string): string[] {
    const text = reportText(value, fallback);
    return text
      .split(/\n{2,}|(?<=\.)\s+(?=[A-Z0-9])/u)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 5);
  }

  function conciseList(items: string[], fallbackSection: ResearchReportSection, limit = 6): string[] {
    const cleaned = items.map((item) => compactBlockedExternalSourceText(item).trim()).filter(Boolean);
    return cleaned.length ? cleaned.slice(0, limit) : [selectedReportSectionEmptyMessage(fallbackSection)];
  }

  function topResearchSources(run: ResearchRun, limit = 5): ResearchSource[] {
    return [...run.sources].sort((a, b) => b.score - a.score || a.rank - b.rank).slice(0, limit);
  }

  function reportOutcomeLine(run: ResearchRun): string {
    if (isResearchRunActive(run)) return run.current_step || 'Research is still running; this brief will keep updating.';
    if (run.status === 'paused') return run.current_step || 'Research is paused and can be resumed from this page or Activity.';
    if (run.status === 'failed') return run.error || 'This run failed before a complete report was recorded.';
    if (run.status === 'cancelled') return run.error || 'This run was cancelled; partial evidence remains saved.';
    return run.report.tldr || run.report.detailed_summary || 'Saved report with source-backed evidence.';
  }

  function addRunSourcesAsSeeds(run: ResearchRun): void {
    const urls = topResearchSources(run, 8).map((source) => source.canonical_url || source.url).filter(Boolean);
    const existing = new Set(seedUrls.map(normalizeTextUrl));
    const next = urls.filter((url) => !existing.has(normalizeTextUrl(url)));
    if (!next.length) {
      message = 'The selected report sources are already in the next query seed list.';
      return;
    }
    seedUrlsText = [seedUrlsText.trim(), ...next].filter(Boolean).join('\n');
    message = `Added ${next.length} report source${next.length === 1 ? '' : 's'} to the next query.`;
  }

  function addSelectedRunSourcesAsSeeds(): void {
    if (!selectedRun) return;
    addRunSourcesAsSeeds(selectedRun);
  }

  function useFollowUpSuggestion(item: string): void {
    const next = compactBlockedExternalSourceText(item).trim();
    if (!next) return;
    goal = next;
    message = 'Loaded follow-up suggestion as the next query.';
  }

  function sourcePreview(source: ResearchSource): string {
    const text = source.text.trim();
    if (!text) return 'No extracted text was stored for this source.';
    return compactDisplayText(text, 1200);
  }

  function sourceById(run: ResearchRun, sourceId: string): ResearchSource | undefined {
    return run.sources.find((source) => source.id === sourceId);
  }

  function citationSources(run: ResearchRun, citation: ResearchCitation): ResearchSource[] {
    return citation.source_ids.map((sourceId) => sourceById(run, sourceId)).filter((source): source is ResearchSource => Boolean(source));
  }

  function formatJson(value: unknown): string {
    if (value === undefined || value === null || value === '') return 'Not recorded.';
    return JSON.stringify(value, null, 2);
  }

  function listFromPlan(run: ResearchRun, key: string): string[] {
    const value = run.query_plan[key];
    return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
  }

  function searchQueries(run: ResearchRun): string[] {
    return listFromPlan(run, 'search_queries');
  }

  function crawlTargets(run: ResearchRun): string[] {
    return listFromPlan(run, 'crawl_targets');
  }

  function formatValue(value: unknown): string {
    if (value === undefined || value === null || value === '') return 'not recorded';
    if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2);
    if (typeof value === 'boolean') return value ? 'yes' : 'no';
    if (Array.isArray(value)) return compactDisplayText(value.map((item) => formatValue(item)).join(', '), 500);
    if (typeof value === 'object') return compactDisplayText(JSON.stringify(value), 500);
    return compactDisplayText(String(value), 500);
  }

  function sourceTableValue(row: Record<string, unknown>, key: string): string {
    return formatValue(row[key]);
  }

  function sourceScore(source: ResearchSource): string {
    return Number.isFinite(source.score) ? source.score.toFixed(2) : '0';
  }

  function linkLabel(link: Record<string, string>): string {
    return link.text || link.title || link.href || link.url || 'link';
  }

  function linkHref(link: Record<string, string>): string {
    return link.href || link.url || '';
  }

  function logLevel(log: Record<string, unknown>): string {
    return typeof log.level === 'string' ? log.level : 'info';
  }

  function logMessage(log: Record<string, unknown>): string {
    if (typeof log.message === 'string') {
      if (log.message.trim().toLowerCase() === 'fetch failed.') {
        return 'Source fetch warning: one page could not be fetched; cached sources stayed available when possible.';
      }
      return compactDisplayText(log.message, 420);
    }
    return compactDisplayText(formatJson(log), 420);
  }

  function logTime(log: Record<string, unknown>): string {
    return typeof log.at === 'string' ? log.at : '';
  }

  function displayDate(value: string | undefined): string {
    if (!value) return 'date not recorded';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
  }

  function sourceCardPreview(source: ResearchSourceCard): string {
    return compactDisplayText(source.text_preview || source.description || 'No preview text is available for this archived source.', 420);
  }

  function sourceCardTitle(source: ResearchSourceCard): string {
    return compactDisplayText(source.title || source.canonical_url, 140);
  }

  function researchSourceTitle(source: ResearchSource): string {
    return compactDisplayText(source.title || source.canonical_url, 140);
  }

  function researchSourceDescription(source: ResearchSource): string {
    return compactDisplayText(source.description || '', 700);
  }

  function sourceScreenshotDataUrl(source: { metadata: Record<string, unknown> }): string {
    const raw = source.metadata.screenshot_base64;
    if (typeof raw !== 'string' || !raw) return '';
    const contentType = typeof source.metadata.screenshot_content_type === 'string' ? source.metadata.screenshot_content_type : 'image/png';
    return `data:${contentType};base64,${raw}`;
  }

  function addSeedUrl(url: string): void {
    const next = normalizeTextUrl(url);
    if (!next) return;
    const existing = new Set(seedUrls.map(normalizeTextUrl));
    if (existing.has(next)) {
      sourceLibraryMessage = 'That source is already in Seed URLs.';
      return;
    }
    seedUrlsText = [seedUrlsText.trim(), next].filter(Boolean).join('\n');
    sourceLibraryMessage = 'Added archived source to Seed URLs for the next run.';
  }

  async function searchSourceLibrary(): Promise<void> {
    if (sourceLibrarySearchDisabled) {
      if (aiOsUnavailable) sourceLibraryError = serviceIssue;
      return;
    }
    await refreshSourceLibrary();
  }

  function normalizeTextUrl(url: string): string {
    return url.trim();
  }

  function monitorMeta(monitor: ResearchMonitor): string {
    const last = monitor.last_run_at ? `last ${displayDate(monitor.last_run_at)}` : 'never run';
    const status = monitor.last_status ? monitor.last_status.replace('_', ' ') : 'idle';
    return `${monitor.schedule} - ${monitor.run_count} run${monitor.run_count === 1 ? '' : 's'} - ${status} - ${last}`;
  }

  onMount(() => {
    const timer = window.setInterval(() => {
      void pollLiveRuns();
    }, 1500);
    const visibleRefresh = () => {
      if (document.visibilityState === 'visible') void refreshRuns();
    };
    window.addEventListener('focus', visibleRefresh);
    document.addEventListener('visibilitychange', visibleRefresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', visibleRefresh);
      document.removeEventListener('visibilitychange', visibleRefresh);
    };
  });
</script>

<svelte:head>
  <title>Research Desk - Mini Hub</title>
</svelte:head>

<main class="research-page">
  <section class="desk-header">
    <div>
      <span class="eyebrow">Web Intelligence</span>
      <h1>Research Desk</h1>
      <p>Search, scrape, crawl, compare, cite, and archive source-backed reports through AI OS.</p>
    </div>
    <button class="icon-button" type="button" aria-label="Refresh research runs" disabled={refreshing} title={refreshRunsButtonTitle} on:click={refreshRuns}>
      <RefreshCw size={17} />
    </button>
  </section>

  {#if serviceIssue}
    <section class="service-card" aria-live="polite">
      <div>
        <strong>AI OS service needs attention</strong>
        <span>{getAiOsApiUrl()}</span>
        <p>{serviceIssue}</p>
        <p>{localNetworkHint()}</p>
      </div>
      <div class="service-actions">
        <button
          class="link-button compact"
          type="button"
          disabled={refreshing || monitorsLoading || sourceLibraryLoading}
          title={researchServicesButtonTitle}
          on:click={refreshResearchServices}
        >
          <RefreshCw size={15} />
          <span>Retry Service</span>
        </button>
        <a class="link-button compact" href={hubHref('/settings#feature-wiring')} title="Open Settings Feature Wiring for AI OS endpoint setup.">Open Settings</a>
      </div>
    </section>
  {:else if serviceProbePending}
    <section class="service-card pending" aria-live="polite">
      <div>
        <strong>Checking AI OS service</strong>
        <span>{getAiOsApiUrl()}</span>
        <p>Research Desk is checking runs, monitors, and the source library before enabling service-backed actions.</p>
      </div>
    </section>
  {/if}

  <section class="workbench">
    <form class="query-panel" on:submit|preventDefault={runResearch}>
      <div class="query-intro">
        <div>
          <span class="eyebrow">New Research</span>
          <h2>Ask once, get a readable brief</h2>
        </div>
        <small>Runs stay recoverable in the report list and Activity after you leave this page.</small>
      </div>

      <label class="goal-field">
        <span>Query</span>
        <textarea
          id="research-goal"
          aria-label="Research goal"
          bind:value={goal}
          rows="4"
          placeholder="Example: Compare Clay Labs and FieldAI data analyst roles, cite sources, and list open questions."
          title="Describe the research question or report you want AI OS to run. This draft is saved in this browser."
        ></textarea>
      </label>

      <div class="effort-grid" aria-label="Research effort">
        {#each effortOptions as item}
          <button class:active={effort === item.id} type="button" title={researchEffortTitle(item)} on:click={() => selectEffort(item.id)}>
            <strong>{item.label}</strong>
            <small>{item.hint}</small>
          </button>
        {/each}
      </div>

      <div class="source-seeds-row">
        <label>
          <span>Optional source URLs</span>
          <textarea id="research-seed-urls" aria-label="Research seed URLs" bind:value={seedUrlsText} rows="2" placeholder="Paste exact URLs here when you want the run grounded in specific pages." title="Optional starting URLs for the run, one per line. This draft is saved in this browser."></textarea>
        </label>
      </div>

      <button class="link-button" type="button" title={advancedToggleButtonTitle} on:click={() => (advancedOpen = !advancedOpen)}>
        {advancedOpen ? 'Hide advanced options' : 'Advanced options'}
      </button>

      {#if advancedOpen}
        <div class="advanced-grid">
          <label>
            <span>Max pages</span>
            <input bind:value={maxPages} min="1" max="50" type="number" title="Maximum pages this research run may fetch." />
          </label>
          <label>
            <span>Depth</span>
            <input bind:value={depth} min="1" max="5" type="number" title="Maximum crawl depth for this research run." />
          </label>
          <label>
            <span>Time budget</span>
            <input bind:value={timeBudget} min="5" max="900" type="number" title="Time budget in seconds for the research run." />
          </label>
          <label>
            <span>Per-domain limit</span>
            <input bind:value={perDomainLimit} min="1" max="20" type="number" title="Maximum fetched pages per domain." />
          </label>
          <label>
            <span>Date start</span>
            <input bind:value={dateRangeStart} type="date" title="Optional earliest publication or source date for the run." />
          </label>
          <label>
            <span>Date end</span>
            <input bind:value={dateRangeEnd} type="date" title="Optional latest publication or source date for the run." />
          </label>
          <label>
            <span>Include domains</span>
            <input bind:value={includeDomainsText} placeholder="example.com, docs.example.com" title="Optional comma-separated domains to prefer or include." />
          </label>
          <label>
            <span>Exclude domains</span>
            <input bind:value={excludeDomainsText} placeholder="pinterest.com, reddit.com" title="Optional comma-separated domains to exclude from fetching." />
          </label>
          <label>
            <span>Provider</span>
            <input bind:value={provider} placeholder="optional" title="Optional AI provider override for this research run." />
          </label>
          <label>
            <span>Model</span>
            <input bind:value={model} placeholder="optional" title="Optional model override for this research run." />
          </label>
          <label class="check-row">
            <input bind:checked={useAi} type="checkbox" title="Use AI synthesis when AI OS is connected." />
            <span>Use AI synthesis</span>
          </label>
          <label class="check-row">
            <input bind:checked={useCloudAi} type="checkbox" title="Allow configured paid/cloud AI fallback for this run." />
            <span>Allow cloud fallback</span>
          </label>
          <label class="check-row">
            <input bind:checked={saveToMemory} type="checkbox" title="Save fetched and summarized research output into semantic memory." />
            <span>Index into semantic memory</span>
          </label>
          <label class="check-row">
            <input bind:checked={screenshot} type="checkbox" title="Ask the research service to capture screenshots when useful." />
            <span>Request screenshots when useful</span>
          </label>
        </div>
      {/if}

      <div class="form-actions">
        <button class="primary-button" type="submit" disabled={researchRunDisabled} title={researchRunButtonTitle}>
          <Search size={17} />
          <span>{serviceBlockedLabel}</span>
        </button>
        {#if message}<p class="ok-message">{message}</p>{/if}
        {#if visibleRunError}<p class="error-message" title={`Raw Research run error: ${error}`}>{visibleRunError}</p>{/if}
      </div>
    </form>

    <aside class="runs-panel">
      <div class="panel-heading">
        <FileText size={17} />
        <strong>Reports</strong>
      </div>
      {#if runs.length}
        <div class="run-list">
          {#each runs as run}
            <button class:active={selectedRun?.id === run.id} type="button" title={researchRunSelectionTitle(run)} on:click={() => setSelectedRun(run)}>
              <span class={`status ${run.status}`}>{statusLabel(run)}</span>
              <strong>{displayRunTitle(run, 120)}</strong>
              <small>{runMeta(run)}</small>
              {#if isLiveRun(run)}
                <span class="progress-track" aria-label={`Research progress ${progressPercent(run)}%`}>
                  <span style={`width: ${progressPercent(run)}%`}></span>
                </span>
                <small>{run.current_step || 'Working'}</small>
              {:else if isPausedRun(run)}
                <span class="progress-track paused" aria-label={`Research paused at ${progressPercent(run)}%`}>
                  <span style={`width: ${progressPercent(run)}%`}></span>
                </span>
                <small>{run.current_step || 'Paused'}</small>
              {/if}
            </button>
          {/each}
        </div>
      {:else if refreshing}
        <div class="run-list loading-runs" aria-label="Checking saved research runs">
          {#each Array.from({ length: 3 }) as _}
            <span></span>
          {/each}
        </div>
      {:else}
        <p class:error-message={Boolean(visibleRunError || aiOsUnavailable)} class="empty-note">{researchRunsEmptyMessage()}</p>
        {#if visibleRunError || serviceIssue}
          <button class="link-button compact" type="button" disabled={refreshing} title={refreshRunsButtonTitle} on:click={refreshRuns}>
            <RefreshCw size={15} />
            <span>Retry Runs</span>
          </button>
        {/if}
      {/if}
    </aside>
  </section>

  <section class="monitor-panel">
    <div class="monitor-heading">
      <div>
        <span class="eyebrow">Routine Research</span>
        <h2>Recurring monitors</h2>
        <p>Turn the current query into a reusable watch. Manual monitors wait for you; daily and weekly monitors can be swept when due.</p>
      </div>
      <div class="monitor-heading-actions">
        <button class="link-button compact" type="button" disabled={monitorActionDisabled(monitorActionState)} title={monitorActionTitle(monitorActionState, 'Run due daily and weekly monitors.')} on:click={runDueMonitors}>
          <Play size={15} />
          <span>{aiOsUnavailable ? 'Connect AI OS' : monitorActionId === 'due-sweep' ? 'Running Due' : 'Run Due'}</span>
        </button>
        <button class="icon-button" type="button" aria-label="Refresh research monitors" disabled={monitorsLoading || Boolean(monitorActionId)} title={refreshMonitorsButtonTitle} on:click={refreshMonitors}>
          <RefreshCw size={17} />
        </button>
      </div>
    </div>

    <div class="monitor-create-row">
      <label>
        <span>Monitor name</span>
        <input bind:value={monitorName} placeholder="Optional name for this routine" title="Optional name for the saved research monitor." />
      </label>
      <label>
        <span>Cadence</span>
        <select bind:value={monitorSchedule} title="Cadence for the saved research monitor.">
          <option value="manual">Manual</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
        </select>
      </label>
      <button class="link-button" type="button" disabled={monitorActionDisabled(monitorActionState) || !goal.trim()} title={saveCurrentMonitorButtonTitle} on:click={saveCurrentMonitor}>
        <Bell size={15} />
        <span>{aiOsUnavailable ? 'Connect AI OS' : 'Save as Monitor'}</span>
      </button>
    </div>

    {#if visibleMonitorError}
      <p class="error-message monitor-note" title={`Raw Research monitor error: ${monitorError}`}>{visibleMonitorError}</p>
    {:else if monitorMessage}
      <p class="ok-message monitor-note">{monitorMessage}</p>
    {/if}

    {#if monitors.length}
      <div class="monitor-list">
        {#each monitors as monitor}
          <article class="monitor-card" class:selected={monitor.id === selectedMonitorId}>
            <div class="monitor-card-main">
              <span class={`status ${monitor.last_status ?? (monitor.enabled ? 'queued' : 'cancelled')}`}>{monitor.enabled ? 'on' : 'off'}</span>
              <div>
                <strong>{displayMonitorName(monitor)}</strong>
                <small>{monitorMeta(monitor)}</small>
              </div>
            </div>
            <p>{displayMonitorGoal(monitor)}</p>
            {#if monitor.last_error}
              <p class="error-message compact-message" title={`Raw Research monitor last error: ${monitor.last_error}`}>{monitorLastErrorDetail(monitor)}</p>
            {/if}
            <div class="monitor-actions">
              <button type="button" disabled={monitorActionDisabled(monitorActionState, monitor)} title={monitorActionTitle(monitorActionState, 'Run this monitor now.', monitor)} on:click={() => runMonitor(monitor)}>
                <Play size={15} />
                <span>{monitorActionBusy(monitor, 'run') ? 'Running' : 'Run Now'}</span>
              </button>
              <button type="button" title={monitor.id === selectedMonitorId ? 'This monitor is loaded in the workbench.' : 'Load this monitor into the workbench.'} on:click={() => loadMonitorIntoForm(monitor)}>
                {monitor.id === selectedMonitorId ? 'Loaded' : 'Load'}
              </button>
              <button type="button" disabled={monitorActionDisabled(monitorActionState, monitor)} title={monitorActionTitle(monitorActionState, monitor.enabled ? 'Disable this monitor.' : 'Enable this monitor.', monitor)} on:click={() => toggleMonitor(monitor)}>
                {monitorActionBusy(monitor, 'toggle') ? 'Saving' : monitor.enabled ? 'Disable' : 'Enable'}
              </button>
              <button class="danger-button" type="button" disabled={monitorActionDisabled(monitorActionState, monitor)} title={monitorActionTitle(monitorActionState, 'Delete this monitor without deleting archived reports.', monitor)} on:click={() => removeMonitor(monitor)}>
                <Trash2 size={15} />
                <span>{monitorActionBusy(monitor, 'delete') ? 'Deleting' : 'Delete'}</span>
              </button>
            </div>
          </article>
        {/each}
      </div>
    {:else if monitorsLoading}
      <p class="empty-note">Checking saved research monitors.</p>
    {:else}
      <p class:error-message={aiOsUnavailable} class="empty-note">{monitorEmptyMessage()}</p>
    {/if}
  </section>

  <section class="source-library-panel">
    <div class="source-library-heading">
      <div>
        <span class="eyebrow">Local Archive</span>
        <h2>Source Library</h2>
        <p>Search reusable source cards already fetched by Research Desk runs.</p>
      </div>
      <button class="icon-button" type="button" aria-label="Search source library" disabled={sourceLibrarySearchDisabled} title={sourceLibrarySearchTitle} on:click={refreshSourceLibrary}>
        <RefreshCw size={17} />
      </button>
    </div>

    <form class="source-library-controls" on:submit|preventDefault={searchSourceLibrary}>
      <label>
        <span>Search archived text</span>
        <input bind:value={sourceQuery} placeholder="evidence, company, model, benchmark..." title="Search text in archived Research Desk source cards." />
      </label>
      <label>
        <span>Domain filter</span>
        <input bind:value={sourceDomain} placeholder="example.com" title="Optional domain filter for archived Research Desk source cards." />
      </label>
      <button class="link-button" type="submit" disabled={sourceLibrarySearchDisabled} title={sourceLibrarySearchTitle}>
        <Search size={15} />
        <span>{aiOsUnavailable ? 'Connect AI OS' : sourceLibraryLoading ? 'Searching' : 'Search Sources'}</span>
      </button>
    </form>

    {#if visibleSourceLibraryError}
      <p class="error-message source-library-note" title={`Raw Research source library error: ${sourceLibraryError}`}>{visibleSourceLibraryError}</p>
    {:else if sourceLibraryMessage}
      <p class="ok-message source-library-note">{sourceLibraryMessage}</p>
    {/if}

    {#if sourceLibrary.length}
      <div class="source-library-list">
        {#each sourceLibrary as source}
          <article class="source-library-card">
            <div class="source-library-card-main">
              <span class="source-rank">#{source.rank}</span>
              <div>
                <strong>{sourceCardTitle(source)}</strong>
                <small>{sourceHost(source)} - {source.text_length} chars - seen {source.fetch_count} time{source.fetch_count === 1 ? '' : 's'}</small>
              </div>
              <span class="source-score">score {source.score.toFixed(1)}</span>
            </div>
            <p>{sourceCardPreview(source)}</p>
            <div class="source-library-meta">
              <span>First {displayDate(source.first_seen_at)}</span>
              <span>Last {displayDate(source.last_seen_at)}</span>
              {#if source.published_at}<span>Published {displayDate(source.published_at)}</span>{/if}
              {#if sourceScreenshotDataUrl(source)}<span>Screenshot</span>{/if}
              {#if source.matched_terms.length}<span>Matched {source.matched_terms.join(', ')}</span>{/if}
            </div>
            <div class="source-library-actions">
              <a href={source.canonical_url} target="_blank" rel="noreferrer" title={`Open archived source ${source.canonical_url}.`}>
                <ExternalLink size={15} />
                <span>Open</span>
              </a>
              <button type="button" disabled={sourceSeedDisabled(source.canonical_url)} title={sourceSeedTitle(source.canonical_url)} on:click={() => addSeedUrl(source.canonical_url)}>
                <Search size={15} />
                <span>Use as Seed</span>
              </button>
            </div>
          </article>
        {/each}
      </div>
    {:else if sourceLibraryLoading}
      <p class="empty-note">Searching archived source cards.</p>
    {:else}
      <p class:error-message={aiOsUnavailable} class="empty-note">{sourceLibraryEmptyMessage()}</p>
    {/if}
  </section>

  {#if selectedRun}
    <section class="report-panel">
      <div class="report-heading">
        <div>
          <span class={`status ${selectedRun.status}`}>{statusLabel(selectedRun)}</span>
          <h2>{displayRunTitle(selectedRun, 220)}</h2>
          <p>{runMeta(selectedRun)}</p>
          {#if isLiveRun(selectedRun)}
            <div class="report-progress">
              <span class="progress-track" aria-label={`Research progress ${progressPercent(selectedRun)}%`}>
                <span style={`width: ${progressPercent(selectedRun)}%`}></span>
              </span>
              <small>{selectedRun.current_step || 'Working'} ({progressPercent(selectedRun)}%)</small>
            </div>
          {:else if isPausedRun(selectedRun)}
            <div class="report-progress">
              <span class="progress-track paused" aria-label={`Research paused at ${progressPercent(selectedRun)}%`}>
                <span style={`width: ${progressPercent(selectedRun)}%`}></span>
              </span>
              <small>{selectedRun.current_step || 'Paused'} ({progressPercent(selectedRun)}%)</small>
            </div>
          {:else if selectedRun.memory_chunks}
            <p class="memory-note">
              Indexed into semantic memory as {selectedRun.memory_chunks} chunk{selectedRun.memory_chunks === 1 ? '' : 's'}.
            </p>
          {/if}
        </div>
        <div class="export-actions">
          {#if isLiveRun(selectedRun)}
            <button type="button" disabled={selectedRunActionDisabled} title={selectedRunActionTitle} on:click={pauseSelectedRun}>
              <Pause size={15} /> {runActionBusy(selectedRun, 'pause') ? 'Pausing' : 'Pause'}
            </button>
            <button type="button" disabled={selectedRunActionDisabled} title={selectedRunActionTitle} on:click={cancelSelectedRun}>
              <X size={15} /> {runActionBusy(selectedRun, 'cancel') ? 'Cancelling' : 'Cancel'}
            </button>
          {:else if isPausedRun(selectedRun)}
            <button type="button" disabled={selectedRunActionDisabled} title={selectedRunActionTitle} on:click={resumeSelectedRun}>
              <Play size={15} /> {runActionBusy(selectedRun, 'resume') ? 'Resuming' : 'Resume'}
            </button>
            <button type="button" disabled={selectedRunActionDisabled} title={selectedRunActionTitle} on:click={cancelSelectedRun}>
              <X size={15} /> {runActionBusy(selectedRun, 'cancel') ? 'Cancelling' : 'Cancel'}
            </button>
          {/if}
          <a class:setup-link={aiOsUnavailable} href={reportExportHref(selectedRun, 'markdown')} target={aiOsUnavailable ? undefined : '_blank'} rel="noreferrer" title={reportExportTitle('Markdown')}>
            <Download size={15} /> Markdown
          </a>
          <a class:setup-link={aiOsUnavailable} href={reportExportHref(selectedRun, 'json')} target={aiOsUnavailable ? undefined : '_blank'} rel="noreferrer" title={reportExportTitle('JSON')}>
            <Database size={15} /> JSON
          </a>
          <a class:setup-link={aiOsUnavailable} href={reportExportHref(selectedRun, 'html')} target={aiOsUnavailable ? undefined : '_blank'} rel="noreferrer" title={reportExportTitle('HTML')}>
            <ExternalLink size={15} /> HTML
          </a>
          {#if aiOsUnavailable}
            <small class="export-note">Exports need AI OS; these links open Settings Feature Wiring.</small>
          {/if}
        </div>
      </div>

      <article class="quick-report">
        <div class="quick-report-head">
          <div>
            <span class="eyebrow">Quick Report</span>
            <h3>Result</h3>
          </div>
          <div class="report-stats" aria-label="Research report stats">
            <span>{selectedRun.sources.length} source{selectedRun.sources.length === 1 ? '' : 's'}</span>
            <span>{selectedRun.citations.length} citation{selectedRun.citations.length === 1 ? '' : 's'}</span>
            <span>{selectedRun.cost_usd ? `$${selectedRun.cost_usd.toFixed(4)}` : 'local/free'}</span>
          </div>
        </div>
        <p class="answer-lead">{reportOutcomeLine(selectedRun)}</p>
        <div class="report-handoff">
          <button type="button" on:click={addSelectedRunSourcesAsSeeds} title="Use the strongest sources from this report as seed URLs for the next query.">
            <Search size={15} />
            <span>Use Sources Next</span>
          </button>
          <a href={hubHref('/activity')} title="Open Activity to recover this and other long-running work.">Open Activity</a>
          {#if selectedRun.memory_chunks}
            <span>Memory: {selectedRun.memory_chunks} chunk{selectedRun.memory_chunks === 1 ? '' : 's'}</span>
          {:else}
            <span>Memory: not indexed</span>
          {/if}
        </div>
      </article>

      <section class="brief-layout" aria-label="Readable research brief">
        <article class="full-summary">
          <h3>Answer</h3>
          {#each reportParagraphs(selectedRun.report.detailed_summary || selectedRun.report.tldr, selectedReportSectionEmptyMessage('detailedSummary')) as paragraph}
            <p>{paragraph}</p>
          {/each}
        </article>

        <article>
          <h3>Key Facts</h3>
          <ul class="clean-list">
            {#each conciseList(selectedRun.report.key_facts, 'keyFacts') as fact}
              <li>{fact}</li>
            {/each}
          </ul>
        </article>

        <article>
          <h3>Open Questions</h3>
          <ul class="clean-list">
            {#each conciseList(selectedRun.report.open_questions, 'openQuestions', 5) as item}
              <li>{item}</li>
            {/each}
          </ul>
        </article>

        <article>
          <h3>Next Moves</h3>
          {#if selectedRun.report.next_research_suggestions.length}
            <div class="next-move-list">
              {#each selectedRun.report.next_research_suggestions.slice(0, 5) as item}
                <button type="button" title="Load this follow-up as the next research query." on:click={() => useFollowUpSuggestion(item)}>
                  {compactBlockedExternalSourceText(item)}
                </button>
              {/each}
            </div>
          {:else}
            <p class="empty-note">{selectedReportSectionEmptyMessage('nextResearch')}</p>
          {/if}
        </article>
      </section>

      <section class="evidence-layout" aria-label="Research evidence">
        <article>
          <h3>Best Sources</h3>
          {#if topResearchSources(selectedRun).length}
            <div class="source-evidence-list">
              {#each topResearchSources(selectedRun) as source}
                <a href={source.canonical_url} target="_blank" rel="noreferrer" title={`Open source URL ${source.canonical_url}.`}>
                  <strong>{researchSourceTitle(source)}</strong>
                  <small>{sourceHost(source)} - score {sourceScore(source)}{source.cached ? ' - cached' : ''}</small>
                </a>
              {/each}
            </div>
          {:else}
            <p class="empty-note">No source evidence was saved for this report yet.</p>
          {/if}
        </article>

        <article>
          <h3>Reliability</h3>
          <ul class="clean-list">
            {#each conciseList(selectedRun.report.reliability_notes, 'reliability', 4) as note}
              <li>{note}</li>
            {/each}
          </ul>
          {#if selectedRun.report.disagreements.length}
            <strong class="section-subhead">Conflicts</strong>
            <ul class="clean-list">
              {#each selectedRun.report.disagreements.slice(0, 4) as item}
                <li>{compactBlockedExternalSourceText(item)}</li>
              {/each}
            </ul>
          {/if}
        </article>
      </section>

      <details class="report-details" open={selectedRun.citations.length > 0}>
        <summary>Citations and timeline</summary>
        <div class="report-grid">
          <article>
            <h3>Citations</h3>
            {#if selectedRun.citations.length}
              <div class="citation-list">
                {#each selectedRun.citations as citation}
                  <div>
                    <strong>{citation.id}</strong>
                    <p>{compactBlockedExternalSourceText(citation.claim)}</p>
                    {#if citation.quote}<small>{compactBlockedExternalSourceText(citation.quote)}</small>{/if}
                    {#if citationSources(selectedRun, citation).length}
                      <div class="citation-sources">
                        {#each citationSources(selectedRun, citation) as source}
                          <a href={source.canonical_url} target="_blank" rel="noreferrer" title={`Open report source ${source.canonical_url}.`}>{source.id}: {sourceHost(source)}</a>
                        {/each}
                      </div>
                    {/if}
                  </div>
                {/each}
              </div>
            {:else}
              <p class="empty-note">{selectedReportSectionEmptyMessage('citations')}</p>
            {/if}
          </article>

          <article>
            <h3>Timeline</h3>
            {#if selectedRun.report.timeline.length}
              <div class="timeline-list">
                {#each selectedRun.report.timeline as item}
                  <div>
                    <strong>{formatValue(item.title)}</strong>
                    <span>{formatValue(item.date)}</span>
                    <small>{formatValue(item.source_id)}</small>
                  </div>
                {/each}
              </div>
            {:else}
              <p class="empty-note">{selectedReportSectionEmptyMessage('timeline')}</p>
            {/if}
          </article>
        </div>
      </details>

      <details class="report-details">
        <summary>Diagnostics and raw run data</summary>
        <div class="report-grid">
          <article>
            <h3>Query Plan</h3>
            {#if searchQueries(selectedRun).length || crawlTargets(selectedRun).length}
              {#if searchQueries(selectedRun).length}
                <strong class="section-subhead">Search queries</strong>
                <ul>
                  {#each searchQueries(selectedRun) as query}
                    <li>{query}</li>
                  {/each}
                </ul>
              {/if}
              {#if crawlTargets(selectedRun).length}
                <strong class="section-subhead">Crawl targets</strong>
                <ul>
                  {#each crawlTargets(selectedRun) as target}
                    <li>{target}</li>
                  {/each}
                </ul>
              {/if}
            {:else}
              <p class="empty-note">{selectedReportSectionEmptyMessage('queryPlan')}</p>
            {/if}
            <details class="json-details">
              <summary>Raw plan JSON</summary>
              <pre>{formatJson(selectedRun.query_plan)}</pre>
            </details>
          </article>
          <article>
            <h3>Run Log</h3>
            {#if selectedRun.logs.length}
              <p class="empty-note">Run log warnings are diagnostics for this selected report, not a Research Desk page failure.</p>
              <div class="log-list">
                {#each selectedRun.logs as log}
                  <div>
                    <span class={`log-level ${logLevel(log)}`}>{logLevel(log)}</span>
                    <strong>{logMessage(log)}</strong>
                    <small>{logTime(log)}</small>
                    <details class="json-details compact">
                      <summary>Details</summary>
                      <pre>{formatJson(log)}</pre>
                    </details>
                  </div>
                {/each}
              </div>
            {:else}
              <p class="empty-note">{selectedReportSectionEmptyMessage('runLog')}</p>
            {/if}
          </article>
        </div>
        {#if selectedRun.report.source_table.length}
          <article>
            <h3>Source Table</h3>
            <div class="compact-table" role="table" aria-label="Research source table">
              <div class="compact-table-head" role="row">
                <span>ID</span>
                <span>Source</span>
                <span>Score</span>
                <span>Cached</span>
              </div>
              {#each selectedRun.report.source_table as row}
                <div role="row">
                  <span>{sourceTableValue(row, 'id')}</span>
                  <span>{sourceTableValue(row, 'title') || sourceTableValue(row, 'url')}</span>
                  <span>{sourceTableValue(row, 'score')}</span>
                  <span>{sourceTableValue(row, 'cached')}</span>
                </div>
              {/each}
            </div>
          </article>
        {/if}
      </details>

      <details class="report-details">
        <summary>Raw extracted sources</summary>
        <article>
        <div class="source-list">
          {#each selectedRun.sources as source}
            <details class="source-card">
              <summary>
                <span>{source.id}</span>
                <strong>{researchSourceTitle(source)}</strong>
                <small>{sourceHost(source)} - {source.text_length} chars - score {sourceScore(source)}{source.cached ? ' - cached' : ''}</small>
              </summary>
              <div class="source-card-body">
                <a class="source-url" href={source.canonical_url} target="_blank" rel="noreferrer" title={`Open source URL ${source.canonical_url}.`}>{source.canonical_url}</a>
                {#if source.description}<p>{researchSourceDescription(source)}</p>{/if}
                <dl class="source-meta">
                  <div><dt>Author</dt><dd>{source.author ?? 'not recorded'}</dd></div>
                  <div><dt>Published</dt><dd>{source.published_at ?? 'not recorded'}</dd></div>
                  <div><dt>Fetched</dt><dd>{source.fetched_at}</dd></div>
                  <div><dt>Rank</dt><dd>{source.rank}</dd></div>
                </dl>
                <details class="json-details">
                  <summary>Extracted text preview</summary>
                  <pre>{sourcePreview(source)}</pre>
                </details>
                {#if sourceScreenshotDataUrl(source)}
                  <figure class="source-screenshot">
                    <img src={sourceScreenshotDataUrl(source)} alt={`Screenshot captured for ${source.title || source.canonical_url}`} loading="lazy" />
                    <figcaption>Captured browser screenshot</figcaption>
                  </figure>
                {/if}
                {#if source.links.length}
                  <details class="json-details">
                    <summary>Links ({source.links.length})</summary>
                    <div class="link-list">
                      {#each source.links.slice(0, 12) as link}
                        {@const href = linkHref(link)}
                        {#if href}
                          <a href={href} target="_blank" rel="noreferrer" title={`Open extracted link ${linkLabel(link)}.`}>{linkLabel(link)}</a>
                        {:else}
                          <span>{linkLabel(link)}</span>
                        {/if}
                      {/each}
                    </div>
                  </details>
                {/if}
                {#if source.tables.length}
                  <details class="json-details">
                    <summary>Tables ({source.tables.length})</summary>
                    <pre>{formatJson(source.tables.slice(0, 3))}</pre>
                  </details>
                {/if}
                <details class="json-details">
                  <summary>Metadata</summary>
                  <pre>{formatJson(source.metadata)}</pre>
                </details>
              </div>
            </details>
          {:else}
            <p class="empty-note">No raw sources were archived for this run.</p>
          {/each}
        </div>
        </article>
      </details>
    </section>
  {/if}
</main>

<style>
  .research-page {
    display: grid;
    gap: 18px;
  }

  .desk-header,
  .workbench,
  .monitor-panel,
  .source-library-panel,
  .report-panel {
    border: 1px solid var(--border);
    background: var(--surface);
    box-shadow: var(--shadow);
  }

  .desk-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 18px;
  }

  .service-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    padding: 14px 16px;
    border: 1px solid var(--warning-border);
    border-radius: 8px;
    background: var(--warning-bg);
  }

  .service-card.pending {
    border-style: dashed;
    background: var(--surface-soft);
  }

  .service-card > div:first-child {
    display: grid;
    gap: 5px;
    min-width: 0;
  }

  .service-card span,
  .service-card p {
    color: var(--muted);
    overflow-wrap: anywhere;
  }

  .service-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    min-width: max-content;
  }

  .eyebrow,
  label span,
  .panel-heading,
  .report-heading p,
  small {
    color: var(--muted);
    font-size: 0.78rem;
  }

  h1,
  h2,
  h3,
  p {
    margin: 0;
  }

  h1 {
    margin-top: 4px;
    font-size: clamp(1.45rem, 4vw, 2rem);
  }

  h2 {
    font-size: 1.2rem;
  }

  h3 {
    margin-bottom: 8px;
    font-size: 0.95rem;
  }

  .desk-header p,
  .full-summary p,
  article p,
  li {
    color: var(--text-soft);
    line-height: 1.55;
  }

  .workbench {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(260px, 340px);
    gap: 0;
  }

  .query-panel,
  .runs-panel,
  .report-panel {
    padding: 18px;
  }

  .runs-panel {
    border-left: 1px solid var(--border);
  }

  .query-intro {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
  }

  .query-intro h2 {
    margin-top: 3px;
  }

  .query-intro small {
    max-width: 280px;
    text-align: right;
  }

  .goal-field textarea {
    min-height: 118px;
  }

  .effort-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
    margin-top: 12px;
  }

  .source-seeds-row {
    margin-top: 12px;
  }

  .effort-grid button,
  .run-list button,
  .source-list a,
  .source-evidence-list a,
  .citation-list div,
  article {
    border: 1px solid var(--border);
    background: var(--surface-soft);
  }

  .effort-grid button,
  .run-list button {
    text-align: left;
    cursor: pointer;
  }

  .effort-grid button {
    display: grid;
    gap: 4px;
    min-height: 68px;
    padding: 10px;
  }

  .effort-grid button.active,
  .run-list button.active {
    border-color: var(--accent);
    background: var(--active);
  }

  label {
    display: grid;
    gap: 6px;
  }

  textarea,
  input,
  select {
    width: 100%;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    padding: 10px;
    font: inherit;
  }

  textarea {
    resize: vertical;
  }

  .advanced-grid,
  .report-grid,
  .brief-layout,
  .evidence-layout {
    display: grid;
    gap: 12px;
  }

  .advanced-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    margin-top: 12px;
  }

  .check-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .check-row input {
    width: auto;
  }

  .monitor-panel {
    display: grid;
    gap: 14px;
    padding: 18px;
  }

  .monitor-heading,
  .monitor-card-main,
  .monitor-actions,
  .monitor-heading-actions,
  .monitor-create-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .monitor-heading {
    justify-content: space-between;
  }

  .monitor-card-main {
    justify-content: flex-start;
  }

  .monitor-create-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 160px auto;
  }

  .monitor-list {
    display: grid;
    gap: 10px;
  }

  .monitor-card {
    display: grid;
    gap: 10px;
    padding: 12px;
  }

  .monitor-card.selected {
    border-color: var(--accent);
    background: var(--active);
    box-shadow: inset 3px 0 0 var(--accent);
  }

  .monitor-card p {
    font-size: 0.9rem;
  }

  .monitor-actions {
    flex-wrap: wrap;
  }

  .monitor-heading-actions {
    justify-content: flex-end;
  }

  .monitor-actions button {
    min-height: 34px;
  }

  .monitor-note,
  .compact-message {
    font-size: 0.85rem;
  }

  .link-button,
  .icon-button,
  .primary-button,
  .monitor-actions button,
  .export-actions a,
  .export-actions button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    border: 1px solid var(--border);
    background: var(--surface-soft);
    color: var(--text);
    text-decoration: none;
    cursor: pointer;
  }

  .link-button {
    margin-top: 12px;
    padding: 8px 10px;
  }

  .link-button.compact {
    min-height: 38px;
    margin-top: 0;
  }

  .monitor-create-row .link-button {
    align-self: end;
    min-height: 40px;
    margin-top: 0;
    padding: 0 12px;
  }

  .monitor-actions button {
    padding: 0 10px;
    font: inherit;
    font-size: 0.78rem;
    font-weight: 800;
  }

  .monitor-actions button:disabled {
    opacity: 0.55;
    cursor: wait;
  }

  .danger-button {
    color: var(--danger-text);
  }

  .icon-button {
    width: 38px;
    height: 38px;
  }

  .primary-button {
    min-height: 42px;
    padding: 0 14px;
    border-color: var(--primary-bg);
    background: var(--primary-bg);
    color: var(--primary-text);
    font-weight: 700;
  }

  .primary-button:disabled,
  .icon-button:disabled {
    opacity: 0.55;
    cursor: wait;
  }

  .form-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
    margin-top: 14px;
  }

  .ok-message {
    color: var(--success-text);
  }

  .error-message {
    color: var(--danger-text);
  }

  .panel-heading,
  .report-heading,
  .source-library-heading,
  .export-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .panel-heading,
  .report-heading {
    margin-bottom: 12px;
  }

  .report-heading {
    justify-content: space-between;
    gap: 14px;
  }

  .source-library-panel {
    display: grid;
    gap: 12px;
    padding: 18px;
  }

  .source-library-heading {
    justify-content: space-between;
    gap: 14px;
  }

  .source-library-heading p {
    margin-top: 4px;
    color: var(--muted);
  }

  .monitor-heading p {
    margin-top: 4px;
    color: var(--muted);
  }

  .source-library-controls {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(180px, 260px) auto;
    gap: 10px;
    align-items: end;
  }

  .source-library-controls .link-button {
    min-height: 40px;
    margin-top: 0;
    padding: 0 12px;
  }

  .source-library-note {
    padding: 8px 10px;
    border: 1px solid var(--border);
    background: var(--surface-soft);
  }

  .source-library-list {
    display: grid;
    gap: 8px;
  }

  .source-library-card {
    gap: 8px;
  }

  .source-library-card-main {
    display: grid;
    grid-template-columns: 52px minmax(0, 1fr) 82px;
    gap: 10px;
    align-items: center;
  }

  .source-library-card-main div {
    display: grid;
    gap: 3px;
    min-width: 0;
  }

  .source-library-card-main strong,
  .source-library-card-main small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .source-rank,
  .source-score {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: fit-content;
    min-width: 46px;
    min-height: 24px;
    border: 1px solid var(--border);
    color: var(--muted);
    background: var(--surface);
    font-size: 0.72rem;
    font-weight: 900;
  }

  .source-score {
    justify-self: end;
    min-width: 72px;
  }

  .source-library-meta,
  .source-library-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .source-library-meta span {
    border: 1px solid var(--border);
    padding: 3px 7px;
    color: var(--muted);
    background: var(--surface);
    font-size: 0.72rem;
    font-weight: 800;
  }

  .source-library-actions a,
  .source-library-actions button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 30px;
    padding: 0 9px;
    border: 1px solid var(--border);
    color: var(--text);
    background: var(--surface);
    cursor: pointer;
    font: inherit;
    font-size: 0.78rem;
    font-weight: 800;
    text-decoration: none;
  }

  .export-actions {
    flex-wrap: wrap;
  }

  .export-actions a,
  .export-actions button {
    min-height: 34px;
    padding: 0 10px;
  }

  .export-actions button {
    font: inherit;
  }

  .export-actions button:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .export-actions a.setup-link {
    border-color: var(--warning-border);
    color: var(--warning-text);
  }

  .export-note {
    color: var(--muted);
  }

  .progress-track {
    display: block;
    width: 100%;
    height: 6px;
    overflow: hidden;
    border: 1px solid var(--border);
    background: var(--surface);
  }

  .progress-track span {
    display: block;
    height: 100%;
    background: var(--accent);
  }

  .progress-track.paused span {
    background: var(--warning-text);
  }

  .report-progress {
    display: grid;
    gap: 5px;
    margin-top: 8px;
    max-width: 420px;
  }

  .memory-note {
    margin-top: 8px;
    color: var(--success-text);
    font-size: 0.82rem;
    font-weight: 700;
  }

  .run-list,
  .source-list,
  .citation-list {
    display: grid;
    gap: 8px;
  }

  .run-list button,
  .source-list a,
  .citation-list div,
  article {
    display: grid;
    gap: 5px;
    padding: 10px;
  }

  .status {
    width: fit-content;
    border: 1px solid var(--border);
    padding: 2px 7px;
    color: var(--muted);
    font-size: 0.72rem;
    text-transform: uppercase;
  }

  .status.succeeded {
    border-color: var(--success-border);
    color: var(--success-text);
  }

  .status.paused {
    border-color: var(--warning-border);
    color: var(--warning-text);
  }

  .status.failed {
    color: var(--danger-text);
  }

  .report-panel {
    display: grid;
    gap: 14px;
  }

  .report-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .quick-report {
    gap: 12px;
    padding: 14px;
    border-color: var(--accent);
    background: var(--active);
  }

  .quick-report-head,
  .report-handoff,
  .report-stats {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  .quick-report-head {
    justify-content: space-between;
  }

  .answer-lead {
    max-width: 78ch;
    font-size: 1rem;
    font-weight: 700;
  }

  .report-stats span,
  .report-handoff span,
  .report-handoff a,
  .report-handoff button {
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    font-size: 0.76rem;
    font-weight: 800;
  }

  .report-stats span,
  .report-handoff span {
    padding: 4px 8px;
  }

  .report-handoff a,
  .report-handoff button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 30px;
    padding: 0 9px;
    font: inherit;
    text-decoration: none;
    cursor: pointer;
  }

  .brief-layout {
    grid-template-columns: minmax(0, 1.2fr) minmax(240px, 0.8fr);
  }

  .brief-layout .full-summary {
    grid-row: span 3;
    gap: 9px;
    padding: 14px;
  }

  .evidence-layout {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .clean-list {
    display: grid;
    gap: 7px;
    margin: 0;
    padding-left: 18px;
  }

  .next-move-list,
  .source-evidence-list {
    display: grid;
    gap: 7px;
  }

  .next-move-list button,
  .source-evidence-list a {
    display: grid;
    gap: 3px;
    padding: 8px 10px;
    color: var(--text);
    background: var(--surface);
    font: inherit;
    text-align: left;
    text-decoration: none;
  }

  .next-move-list button {
    border: 1px solid var(--border);
    cursor: pointer;
  }

  .report-details {
    border: 1px solid var(--border);
    background: var(--surface-soft);
  }

  .report-details > summary {
    padding: 10px 12px;
    color: var(--text);
    cursor: pointer;
    font-weight: 900;
  }

  .report-details > .report-grid,
  .report-details > article {
    padding: 0 10px 10px;
  }

  .source-list a {
    color: inherit;
  }

  .source-card {
    border: 1px solid var(--border);
    background: var(--surface-soft);
  }

  .source-card summary {
    display: grid;
    grid-template-columns: 70px minmax(0, 1fr);
    gap: 4px 10px;
    align-items: center;
    padding: 10px;
    cursor: pointer;
  }

  .source-card summary span {
    width: fit-content;
    border: 1px solid var(--border);
    padding: 2px 7px;
    color: var(--muted);
    font-size: 0.72rem;
    font-weight: 800;
  }

  .source-card summary strong,
  .source-card summary small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .source-card summary small {
    grid-column: 2;
  }

  .source-card-body {
    display: grid;
    gap: 10px;
    padding: 0 10px 10px;
  }

  .source-screenshot {
    display: grid;
    gap: 6px;
    margin: 0;
  }

  .source-screenshot img {
    width: min(100%, 520px);
    max-height: 320px;
    border: 1px solid var(--border);
    background: var(--surface);
    object-fit: contain;
  }

  .source-screenshot figcaption {
    color: var(--muted);
    font-size: 0.78rem;
  }

  .source-url {
    overflow-wrap: anywhere;
    color: var(--accent);
  }

  .source-meta {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;
    margin: 0;
  }

  .source-meta div {
    display: grid;
    gap: 2px;
    min-width: 0;
    padding: 8px;
    border: 1px solid var(--border);
    background: var(--surface);
  }

  .source-meta dt {
    color: var(--muted);
    font-size: 0.72rem;
    font-weight: 800;
  }

  .source-meta dd {
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .timeline-list,
  .log-list,
  .link-list,
  .citation-sources {
    display: grid;
    gap: 7px;
  }

  .timeline-list div,
  .log-list div {
    display: grid;
    gap: 3px;
    padding: 8px;
    border: 1px solid var(--border);
    background: var(--surface);
  }

  .timeline-list span {
    color: var(--muted);
    font-size: 0.82rem;
  }

  .compact-table {
    display: grid;
    overflow: auto;
    border: 1px solid var(--border);
  }

  .compact-table > div {
    display: grid;
    grid-template-columns: 72px minmax(160px, 1fr) 72px 72px;
    gap: 8px;
    min-width: 520px;
    padding: 7px 8px;
    border-bottom: 1px solid var(--border);
  }

  .compact-table > div:last-child {
    border-bottom: 0;
  }

  .compact-table-head {
    color: var(--muted);
    background: var(--surface);
    font-size: 0.72rem;
    font-weight: 900;
    text-transform: uppercase;
  }

  .compact-table span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .section-subhead {
    margin-top: 4px;
    color: var(--muted);
    font-size: 0.78rem;
    text-transform: uppercase;
  }

  .json-details {
    border: 1px solid var(--border);
    background: var(--surface);
  }

  .json-details summary {
    padding: 7px 9px;
    color: var(--muted);
    cursor: pointer;
    font-size: 0.78rem;
    font-weight: 800;
  }

  .json-details.compact {
    margin-top: 4px;
  }

  pre {
    max-height: 360px;
    margin: 0;
    overflow: auto;
    padding: 10px;
    border-top: 1px solid var(--border);
    background: var(--code-bg);
    color: var(--text);
    font: 0.78rem/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .log-level {
    width: fit-content;
    border: 1px solid var(--border);
    padding: 2px 7px;
    color: var(--muted);
    font-size: 0.68rem;
    font-weight: 900;
    text-transform: uppercase;
  }

  .log-level.warning {
    border-color: var(--warning-border);
    color: var(--warning-text);
    background: var(--warning-bg);
  }

  .log-level.error,
  .log-level.failed {
    border-color: var(--danger-border);
    color: var(--danger-text);
    background: var(--danger-bg);
  }

  .citation-sources {
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  }

  .citation-sources a,
  .link-list a,
  .link-list span {
    overflow: hidden;
    border: 1px solid var(--border);
    padding: 6px 8px;
    color: var(--accent);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  ul {
    margin: 0;
    padding-left: 18px;
  }

  .empty-note {
    color: var(--muted);
  }

  .loading-runs span {
    display: block;
    height: 74px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: linear-gradient(90deg, var(--surface-muted), var(--surface-soft), var(--surface-muted));
    animation: pulse 1.2s ease-in-out infinite;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 0.55;
    }
    50% {
      opacity: 1;
    }
  }

  @media (max-width: 900px) {
    .workbench,
    .report-grid,
    .brief-layout,
    .evidence-layout,
    .source-library-controls,
    .monitor-create-row,
    .advanced-grid {
      grid-template-columns: 1fr;
    }

    .runs-panel {
      border-left: 0;
      border-top: 1px solid var(--border);
    }

    .effort-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .query-intro {
      align-items: flex-start;
      flex-direction: column;
    }

    .query-intro small {
      max-width: none;
      text-align: left;
    }

    .report-heading {
      align-items: flex-start;
      flex-direction: column;
    }

    .source-library-heading,
    .monitor-heading {
      align-items: flex-start;
    }

    .source-meta {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 540px) {
    .effort-grid {
      grid-template-columns: 1fr;
    }

    .source-card summary,
    .source-library-card-main,
    .source-meta {
      grid-template-columns: 1fr;
    }

    .source-card summary small {
      grid-column: 1;
    }

    .source-score {
      justify-self: start;
    }
  }
</style>
