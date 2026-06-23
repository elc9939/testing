<script lang="ts">
  import { onMount } from 'svelte';
  import { Bell, Database, Download, ExternalLink, FileText, Pause, Play, RefreshCw, Search, Trash2, X } from 'lucide-svelte';
  import {
    cancelResearchRun,
    createResearchMonitor,
    createResearchRun,
    deleteResearchMonitor,
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
  import {
    isResearchRunActive,
    normalizeResearchDraft,
    researchDraftStorageKey,
    researchRunListState,
    selectRecoverableResearchRun,
    type ResearchDraftState
  } from '$lib/research-state';

  type SourceLike = Pick<ResearchSource, 'url' | 'canonical_url'>;

  const modes: Array<{ id: ResearchMode; label: string; hint: string }> = [
    { id: 'quick_search', label: 'Quick Search', hint: 'Search, rank, summarize.' },
    { id: 'deep_research', label: 'Deep Research', hint: 'More queries and source comparison.' },
    { id: 'url_scrape', label: 'URL Scrape', hint: 'Read exact pages.' },
    { id: 'site_crawl', label: 'Site Crawl', hint: 'Follow same-site links.' },
    { id: 'compare_sources', label: 'Compare Sources', hint: 'Look for agreement and gaps.' },
    { id: 'monitor_topic', label: 'Monitor Topic', hint: 'Topic run shaped for later monitors.' }
  ];

  let mode: ResearchMode = 'quick_search';
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
  let draftHydrated = false;
  let requestedRunId = '';

  $: currentMode = modes.find((item) => item.id === mode) ?? modes[0];
  $: seedUrls = splitList(seedUrlsText);
  $: includeDomains = splitList(includeDomainsText);
  $: excludeDomains = splitList(excludeDomainsText);
  $: runsPanelState = researchRunListState({ loading: refreshing, error, runCount: runs.length });
  $: if (draftHydrated) persistResearchDraft();

  onMount(() => {
    hydrateResearchDraft();
    requestedRunId = requestedResearchRunId();
    void refreshRuns();
    void refreshSourceLibrary();
    void refreshMonitors();
  });

  async function refreshRuns(): Promise<void> {
    refreshing = true;
    error = '';
    try {
      const runId = requestedRunId || requestedResearchRunId();
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
      if (nextSelected) setSelectedRun(nextSelected, { updateUrl: !runId });
      else selectedRun = null;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Research runs failed to load.';
    } finally {
      refreshing = false;
    }
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

  function currentResearchInput(modeOverride: ResearchMode = mode): ResearchRunInput {
    return {
      mode: modeOverride,
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
      message = `Queued ${currentMode?.label ?? 'research'} run. The report will update as sources arrive.`;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Research run failed.';
    } finally {
      loading = false;
    }
  }

  async function saveCurrentMonitor(): Promise<void> {
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
      monitorName = '';
      monitorMessage = 'Saved topic monitor. Use Run Now whenever you want a fresh report.';
    } catch (err) {
      monitorError = err instanceof Error ? err.message : 'Could not save research monitor.';
    } finally {
      monitorsLoading = false;
    }
  }

  async function toggleMonitor(monitor: ResearchMonitor): Promise<void> {
    monitorActionId = monitor.id;
    monitorError = '';
    monitorMessage = '';
    try {
      const updated = await updateResearchMonitor(monitor.id, { enabled: !monitor.enabled });
      monitors = monitors.map((item) => (item.id === updated.id ? updated : item));
    } catch (err) {
      monitorError = err instanceof Error ? err.message : 'Could not update monitor.';
    } finally {
      monitorActionId = '';
    }
  }

  async function runMonitor(monitor: ResearchMonitor): Promise<void> {
    monitorActionId = monitor.id;
    monitorError = '';
    monitorMessage = '';
    try {
      const result = await runResearchMonitor(monitor.id);
      monitors = [result.monitor, ...monitors.filter((item) => item.id !== result.monitor.id)].slice(0, 30);
      setSelectedRun(result.run);
      runs = [result.run, ...runs.filter((item) => item.id !== result.run.id)].slice(0, 20);
      monitorMessage = `Queued monitor run for ${result.monitor.name}.`;
    } catch (err) {
      monitorError = err instanceof Error ? err.message : 'Could not run monitor.';
    } finally {
      monitorActionId = '';
    }
  }

  async function runDueMonitors(): Promise<void> {
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
    if (!window.confirm(`Delete research monitor "${monitor.name}"? Archived reports stay saved.`)) return;
    monitorActionId = monitor.id;
    monitorError = '';
    monitorMessage = '';
    try {
      await deleteResearchMonitor(monitor.id);
      monitors = monitors.filter((item) => item.id !== monitor.id);
      monitorMessage = 'Deleted monitor. Archived reports were left intact.';
    } catch (err) {
      monitorError = err instanceof Error ? err.message : 'Could not delete monitor.';
    } finally {
      monitorActionId = '';
    }
  }

  function loadMonitorIntoForm(monitor: ResearchMonitor): void {
    const request = monitor.request;
    mode = request.mode ?? 'monitor_topic';
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
    monitorName = monitor.name;
    monitorSchedule = monitor.schedule;
    monitorMessage = 'Loaded monitor settings into the workbench.';
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
    error = '';
    message = '';
    try {
      const cancelled = await cancelResearchRun(run.id);
      runs = [cancelled, ...runs.filter((item) => item.id !== cancelled.id)].slice(0, 20);
      if (selectedRun?.id === cancelled.id) setSelectedRun(cancelled, { updateUrl: false });
      message = 'Research run cancelled.';
    } catch (err) {
      error = err instanceof Error ? err.message : 'Could not cancel research run.';
    }
  }

  async function cancelSelectedRun(): Promise<void> {
    if (!selectedRun) return;
    await cancelRun(selectedRun);
  }

  async function pauseRun(run: ResearchRun): Promise<void> {
    error = '';
    message = '';
    try {
      const paused = await pauseResearchRun(run.id);
      runs = [paused, ...runs.filter((item) => item.id !== paused.id)].slice(0, 20);
      if (selectedRun?.id === paused.id) setSelectedRun(paused, { updateUrl: false });
      message = 'Research run paused.';
    } catch (err) {
      error = err instanceof Error ? err.message : 'Could not pause research run.';
    }
  }

  async function resumeRun(run: ResearchRun): Promise<void> {
    error = '';
    message = '';
    try {
      const resumed = await resumeResearchRun(run.id);
      runs = [resumed, ...runs.filter((item) => item.id !== resumed.id)].slice(0, 20);
      if (selectedRun?.id === resumed.id) setSelectedRun(resumed, { updateUrl: false });
      message = 'Research run resumed.';
    } catch (err) {
      error = err instanceof Error ? err.message : 'Could not resume research run.';
    }
  }

  async function pauseSelectedRun(): Promise<void> {
    if (!selectedRun) return;
    await pauseRun(selectedRun);
  }

  async function resumeSelectedRun(): Promise<void> {
    if (!selectedRun) return;
    await resumeRun(selectedRun);
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
      monitorSchedule
    };
  }

  function currentResearchDraft(): ResearchDraftState {
    return defaultResearchDraft();
  }

  function applyResearchDraft(draft: ResearchDraftState): void {
    mode = draft.mode;
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
  }

  function hydrateResearchDraft(): void {
    if (typeof localStorage === 'undefined') {
      draftHydrated = true;
      return;
    }
    try {
      const parsed = JSON.parse(localStorage.getItem(researchDraftStorageKey) ?? 'null') as unknown;
      applyResearchDraft(normalizeResearchDraft(parsed, defaultResearchDraft()));
    } catch {
      // Draft state is visual convenience only; ignore invalid browser storage.
    } finally {
      draftHydrated = true;
    }
  }

  function persistResearchDraft(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(researchDraftStorageKey, JSON.stringify(currentResearchDraft()));
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
    if (options.updateUrl !== false) updateSelectedRunUrl(run.id);
  }

  function updateSelectedRunUrl(runId: string): void {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    url.searchParams.set('run', runId);
    requestedRunId = runId;
    window.history.replaceState({}, '', url.toString());
  }

  function runMeta(run: ResearchRun): string {
    const providerLabel = [run.provider, run.model].filter(Boolean).join('/');
    const parts = [
      run.mode.replace('_', ' '),
      isLiveRun(run) ? `${progressPercent(run)}%` : '',
      `${run.sources.length} source${run.sources.length === 1 ? '' : 's'}`,
      `${Math.round(run.runtime_ms)} ms`,
      run.cached_pages ? `${run.cached_pages} cached` : '',
      run.memory_chunks ? `${run.memory_chunks} memory chunks` : '',
      providerLabel || 'extractive'
    ].filter(Boolean);
    return parts.join(' - ');
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

  function sourcePreview(source: ResearchSource): string {
    const text = source.text.trim();
    if (!text) return 'No extracted text was stored for this source.';
    return text.length > 2600 ? `${text.slice(0, 2600).trim()}...` : text;
  }

  function sourceById(run: ResearchRun, sourceId: string): ResearchSource | undefined {
    return run.sources.find((source) => source.id === sourceId);
  }

  function citationSources(run: ResearchRun, citation: ResearchCitation): ResearchSource[] {
    return citation.source_ids.map((sourceId) => sourceById(run, sourceId)).filter((source): source is ResearchSource => Boolean(source));
  }

  function formatJson(value: unknown): string {
    if (value === undefined || value === null || value === '') return 'None recorded.';
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
    if (value === undefined || value === null || value === '') return 'n/a';
    if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2);
    if (typeof value === 'boolean') return value ? 'yes' : 'no';
    if (Array.isArray(value)) return value.map((item) => formatValue(item)).join(', ');
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
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
    return typeof log.message === 'string' ? log.message : formatJson(log);
  }

  function logTime(log: Record<string, unknown>): string {
    return typeof log.at === 'string' ? log.at : '';
  }

  function displayDate(value: string | undefined): string {
    if (!value) return 'n/a';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
  }

  function sourceCardPreview(source: ResearchSourceCard): string {
    return source.text_preview || source.description || 'No preview text is available for this archived source.';
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
    <button class="icon-button" type="button" disabled={refreshing} title="Refresh runs" on:click={refreshRuns}>
      <RefreshCw size={17} />
    </button>
  </section>

  <section class="workbench">
    <form class="query-panel" on:submit|preventDefault={runResearch}>
      <div class="mode-grid" aria-label="Research mode">
        {#each modes as item}
          <button class:active={mode === item.id} type="button" on:click={() => (mode = item.id)}>
            <strong>{item.label}</strong>
            <small>{item.hint}</small>
          </button>
        {/each}
      </div>

      <label>
        <span>Goal</span>
        <textarea
          bind:value={goal}
          rows="5"
          placeholder="Example: Compare Clay Labs and FieldAI data analyst roles, cite sources, and list open questions."
        ></textarea>
      </label>

      <div class="inline-fields">
        <label>
          <span>Seed URLs</span>
          <textarea bind:value={seedUrlsText} rows="3" placeholder="Optional URLs, one per line"></textarea>
        </label>
        <label>
          <span>Max pages</span>
          <input bind:value={maxPages} min="1" max="50" type="number" />
        </label>
        <label>
          <span>Depth</span>
          <input bind:value={depth} min="1" max="5" type="number" />
        </label>
      </div>

      <button class="link-button" type="button" on:click={() => (advancedOpen = !advancedOpen)}>
        {advancedOpen ? 'Hide knobs' : 'Show knobs'}
      </button>

      {#if advancedOpen}
        <div class="advanced-grid">
          <label>
            <span>Time budget</span>
            <input bind:value={timeBudget} min="5" max="900" type="number" />
          </label>
          <label>
            <span>Per-domain limit</span>
            <input bind:value={perDomainLimit} min="1" max="20" type="number" />
          </label>
          <label>
            <span>Date start</span>
            <input bind:value={dateRangeStart} type="date" />
          </label>
          <label>
            <span>Date end</span>
            <input bind:value={dateRangeEnd} type="date" />
          </label>
          <label>
            <span>Include domains</span>
            <input bind:value={includeDomainsText} placeholder="example.com, docs.example.com" />
          </label>
          <label>
            <span>Exclude domains</span>
            <input bind:value={excludeDomainsText} placeholder="pinterest.com, reddit.com" />
          </label>
          <label>
            <span>Provider</span>
            <input bind:value={provider} placeholder="optional" />
          </label>
          <label>
            <span>Model</span>
            <input bind:value={model} placeholder="optional" />
          </label>
          <label class="check-row">
            <input bind:checked={useAi} type="checkbox" />
            <span>Use AI synthesis</span>
          </label>
          <label class="check-row">
            <input bind:checked={useCloudAi} type="checkbox" />
            <span>Allow cloud fallback</span>
          </label>
          <label class="check-row">
            <input bind:checked={saveToMemory} type="checkbox" />
            <span>Index into semantic memory</span>
          </label>
          <label class="check-row">
            <input bind:checked={screenshot} type="checkbox" />
            <span>Request screenshots when useful</span>
          </label>
        </div>
      {/if}

      <div class="form-actions">
        <button class="primary-button" type="submit" disabled={loading}>
          <Search size={17} />
          <span>{loading ? 'Queueing' : `Run ${currentMode?.label ?? 'Research'}`}</span>
        </button>
        {#if message}<p class="ok-message">{message}</p>{/if}
        {#if error}<p class="error-message">{error}</p>{/if}
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
            <button class:active={selectedRun?.id === run.id} type="button" on:click={() => setSelectedRun(run)}>
              <span class={`status ${run.status}`}>{statusLabel(run)}</span>
              <strong>{run.report.title}</strong>
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
        <div class="run-list loading-runs" aria-label="Loading archived research runs">
          {#each Array.from({ length: 3 }) as _}
            <span></span>
          {/each}
        </div>
      {:else}
        <p class:error-message={Boolean(error)} class="empty-note">{runsPanelState}</p>
        {#if error}
          <button class="link-button compact" type="button" on:click={refreshRuns}>
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
        <span class="eyebrow">Topic Watch</span>
        <h2>Monitors</h2>
        <p>Save a reusable research setup, then run it again when you want a fresh report.</p>
      </div>
      <div class="monitor-heading-actions">
        <button class="link-button compact" type="button" disabled={monitorsLoading} on:click={runDueMonitors}>
          <Play size={15} />
          <span>Run Due</span>
        </button>
        <button class="icon-button" type="button" disabled={monitorsLoading} title="Refresh monitors" on:click={refreshMonitors}>
          <RefreshCw size={17} />
        </button>
      </div>
    </div>

    <div class="monitor-create-row">
      <label>
        <span>Monitor name</span>
        <input bind:value={monitorName} placeholder="Optional name for this topic watch" />
      </label>
      <label>
        <span>Cadence</span>
        <select bind:value={monitorSchedule}>
          <option value="manual">Manual</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
        </select>
      </label>
      <button class="link-button" type="button" disabled={monitorsLoading || !goal.trim()} on:click={saveCurrentMonitor}>
        <Bell size={15} />
        <span>Save Current Setup</span>
      </button>
    </div>

    {#if monitorError}
      <p class="error-message monitor-note">{monitorError}</p>
    {:else if monitorMessage}
      <p class="ok-message monitor-note">{monitorMessage}</p>
    {/if}

    {#if monitors.length}
      <div class="monitor-list">
        {#each monitors as monitor}
          <article class="monitor-card">
            <div class="monitor-card-main">
              <span class={`status ${monitor.last_status ?? (monitor.enabled ? 'queued' : 'cancelled')}`}>{monitor.enabled ? 'on' : 'off'}</span>
              <div>
                <strong>{monitor.name}</strong>
                <small>{monitorMeta(monitor)}</small>
              </div>
            </div>
            <p>{monitor.request.goal}</p>
            {#if monitor.last_error}<p class="error-message compact-message">{monitor.last_error}</p>{/if}
            <div class="monitor-actions">
              <button type="button" disabled={monitorActionId === monitor.id} on:click={() => runMonitor(monitor)}>
                <Play size={15} />
                <span>Run Now</span>
              </button>
              <button type="button" on:click={() => loadMonitorIntoForm(monitor)}>Load</button>
              <button type="button" disabled={monitorActionId === monitor.id} on:click={() => toggleMonitor(monitor)}>
                {monitor.enabled ? 'Disable' : 'Enable'}
              </button>
              <button class="danger-button" type="button" disabled={monitorActionId === monitor.id} on:click={() => removeMonitor(monitor)}>
                <Trash2 size={15} />
                <span>Delete</span>
              </button>
            </div>
          </article>
        {/each}
      </div>
    {:else if monitorsLoading}
      <p class="empty-note">Loading research monitors...</p>
    {:else}
      <p class="empty-note">No topic monitors yet. Fill in a goal and knobs above, then save the setup here.</p>
    {/if}
  </section>

  <section class="source-library-panel">
    <div class="source-library-heading">
      <div>
        <span class="eyebrow">Local Archive</span>
        <h2>Source Library</h2>
        <p>Search reusable source cards already fetched by Research Desk runs.</p>
      </div>
      <button class="icon-button" type="button" disabled={sourceLibraryLoading} title="Refresh source library" on:click={refreshSourceLibrary}>
        <RefreshCw size={17} />
      </button>
    </div>

    <form class="source-library-controls" on:submit|preventDefault={refreshSourceLibrary}>
      <label>
        <span>Search archived text</span>
        <input bind:value={sourceQuery} placeholder="evidence, company, model, benchmark..." />
      </label>
      <label>
        <span>Domain filter</span>
        <input bind:value={sourceDomain} placeholder="example.com" />
      </label>
      <button class="link-button" type="submit" disabled={sourceLibraryLoading}>
        <Search size={15} />
        <span>{sourceLibraryLoading ? 'Searching' : 'Search Sources'}</span>
      </button>
    </form>

    {#if sourceLibraryError}
      <p class="error-message source-library-note">{sourceLibraryError}</p>
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
                <strong>{source.title || source.canonical_url}</strong>
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
              <a href={source.canonical_url} target="_blank" rel="noreferrer">
                <ExternalLink size={15} />
                <span>Open</span>
              </a>
              <button type="button" on:click={() => addSeedUrl(source.canonical_url)}>
                <Search size={15} />
                <span>Use as Seed</span>
              </button>
            </div>
          </article>
        {/each}
      </div>
    {:else if sourceLibraryLoading}
      <p class="empty-note">Searching archived source cards...</p>
    {:else}
      <p class="empty-note">No archived sources matched. Run a research job first, or relax the search/domain filter.</p>
    {/if}
  </section>

  {#if selectedRun}
    <section class="report-panel">
      <div class="report-heading">
        <div>
          <span class={`status ${selectedRun.status}`}>{statusLabel(selectedRun)}</span>
          <h2>{selectedRun.report.title}</h2>
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
            <button type="button" on:click={pauseSelectedRun}>
              <Pause size={15} /> Pause
            </button>
            <button type="button" on:click={cancelSelectedRun}>
              <X size={15} /> Cancel
            </button>
          {:else if isPausedRun(selectedRun)}
            <button type="button" on:click={resumeSelectedRun}>
              <Play size={15} /> Resume
            </button>
            <button type="button" on:click={cancelSelectedRun}>
              <X size={15} /> Cancel
            </button>
          {/if}
          <a href={researchExportUrl(selectedRun.id, 'markdown')} target="_blank" rel="noreferrer">
            <Download size={15} /> Markdown
          </a>
          <a href={researchExportUrl(selectedRun.id, 'json')} target="_blank" rel="noreferrer">
            <Database size={15} /> JSON
          </a>
          <a href={researchExportUrl(selectedRun.id, 'html')} target="_blank" rel="noreferrer">
            <ExternalLink size={15} /> HTML
          </a>
        </div>
      </div>

      <div class="report-grid">
        <article>
          <h3>TLDR</h3>
          <p>{selectedRun.report.tldr || 'No TLDR was generated yet.'}</p>
        </article>
        <article>
          <h3>Reliability</h3>
          {#if selectedRun.report.reliability_notes.length}
            {#each selectedRun.report.reliability_notes as note}
              <p>{note}</p>
            {/each}
          {:else}
            <p class="empty-note">No reliability notes were recorded.</p>
          {/if}
        </article>
      </div>

      <article class="full-summary">
        <h3>Detailed Summary</h3>
        <p>{selectedRun.report.detailed_summary || 'The run has not produced a detailed summary yet.'}</p>
      </article>

      <div class="report-grid">
        <article>
          <h3>Key Facts</h3>
          {#if selectedRun.report.key_facts.length}
            <ul>
              {#each selectedRun.report.key_facts as fact}
                <li>{fact}</li>
              {/each}
            </ul>
          {:else}
            <p class="empty-note">No key facts were extracted.</p>
          {/if}
        </article>
        <article>
          <h3>Open Questions</h3>
          {#if selectedRun.report.open_questions.length}
            {#each selectedRun.report.open_questions as item}
              <p>{item}</p>
            {/each}
          {:else}
            <p class="empty-note">No open questions were extracted.</p>
          {/if}
        </article>
      </div>

      <div class="report-grid">
        <article>
          <h3>Contradictions</h3>
          {#if selectedRun.report.disagreements.length}
            <ul>
              {#each selectedRun.report.disagreements as item}
                <li>{item}</li>
              {/each}
            </ul>
          {:else}
            <p class="empty-note">No source disagreements were detected.</p>
          {/if}
        </article>
        <article>
          <h3>Next Research</h3>
          {#if selectedRun.report.next_research_suggestions.length}
            <ul>
              {#each selectedRun.report.next_research_suggestions as item}
                <li>{item}</li>
              {/each}
            </ul>
          {:else}
            <p class="empty-note">No follow-up suggestions were generated.</p>
          {/if}
        </article>
      </div>

      <div class="report-grid">
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
            <p class="empty-note">No dated source timeline was available.</p>
          {/if}
        </article>
        <article>
          <h3>Source Table</h3>
          {#if selectedRun.report.source_table.length}
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
          {:else}
            <p class="empty-note">No source table was recorded.</p>
          {/if}
        </article>
      </div>

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
            <p class="empty-note">No query-plan lists were recorded.</p>
          {/if}
          <details class="json-details">
            <summary>Raw plan JSON</summary>
            <pre>{formatJson(selectedRun.query_plan)}</pre>
          </details>
        </article>
        <article>
          <h3>Run Log</h3>
          {#if selectedRun.logs.length}
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
            <p class="empty-note">No run logs were stored for this report.</p>
          {/if}
        </article>
      </div>

      <article>
        <h3>Citations</h3>
        {#if selectedRun.citations.length}
          <div class="citation-list">
            {#each selectedRun.citations as citation}
              <div>
                <strong>{citation.id}</strong>
                <p>{citation.claim}</p>
                {#if citation.quote}<small>{citation.quote}</small>{/if}
                {#if citationSources(selectedRun, citation).length}
                  <div class="citation-sources">
                    {#each citationSources(selectedRun, citation) as source}
                      <a href={source.canonical_url} target="_blank" rel="noreferrer">{source.id}: {sourceHost(source)}</a>
                    {/each}
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {:else}
          <p class="empty-note">No citations mapped yet.</p>
        {/if}
      </article>

      <article>
        <h3>Raw Extracted Sources</h3>
        <div class="source-list">
          {#each selectedRun.sources as source}
            <details class="source-card">
              <summary>
                <span>{source.id}</span>
                <strong>{source.title || source.canonical_url}</strong>
                <small>{sourceHost(source)} - {source.text_length} chars - score {sourceScore(source)}{source.cached ? ' - cached' : ''}</small>
              </summary>
              <div class="source-card-body">
                <a class="source-url" href={source.canonical_url} target="_blank" rel="noreferrer">{source.canonical_url}</a>
                {#if source.description}<p>{source.description}</p>{/if}
                <dl class="source-meta">
                  <div><dt>Author</dt><dd>{source.author ?? 'n/a'}</dd></div>
                  <div><dt>Published</dt><dd>{source.published_at ?? 'n/a'}</dd></div>
                  <div><dt>Fetched</dt><dd>{source.fetched_at}</dd></div>
                  <div><dt>Rank</dt><dd>{source.rank}</dd></div>
                </dl>
                <details class="json-details" open>
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
                          <a href={href} target="_blank" rel="noreferrer">{linkLabel(link)}</a>
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

  .mode-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
    margin-bottom: 14px;
  }

  .mode-grid button,
  .run-list button,
  .source-list a,
  .citation-list div,
  article {
    border: 1px solid var(--border);
    background: var(--surface-soft);
  }

  .mode-grid button,
  .run-list button {
    text-align: left;
    cursor: pointer;
  }

  .mode-grid button {
    display: grid;
    gap: 4px;
    min-height: 72px;
    padding: 10px;
  }

  .mode-grid button.active,
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

  .inline-fields,
  .advanced-grid,
  .report-grid {
    display: grid;
    gap: 12px;
  }

  .inline-fields {
    grid-template-columns: minmax(0, 1fr) 120px 100px;
    margin-top: 12px;
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
    .inline-fields,
    .source-library-controls,
    .monitor-create-row,
    .advanced-grid {
      grid-template-columns: 1fr;
    }

    .runs-panel {
      border-left: 0;
      border-top: 1px solid var(--border);
    }

    .mode-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
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
    .mode-grid {
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
