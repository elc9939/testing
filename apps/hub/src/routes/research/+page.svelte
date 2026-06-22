<script lang="ts">
  import { onMount } from 'svelte';
  import { Database, Download, ExternalLink, FileText, RefreshCw, Search, X } from 'lucide-svelte';
  import {
    cancelResearchRun,
    createResearchRun,
    getResearchRun,
    listResearchRuns,
    researchExportUrl,
    type ResearchMode,
    type ResearchRun
  } from '$lib/ai-os-api';

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
  let timeBudget = 90;
  let useAi = false;
  let useCloudAi = false;
  let provider = '';
  let model = '';
  let advancedOpen = false;
  let loading = false;
  let refreshing = false;
  let error = '';
  let message = '';
  let runs: ResearchRun[] = [];
  let selectedRun: ResearchRun | null = null;

  $: currentMode = modes.find((item) => item.id === mode) ?? modes[0];
  $: seedUrls = splitList(seedUrlsText);
  $: includeDomains = splitList(includeDomainsText);
  $: excludeDomains = splitList(excludeDomainsText);

  onMount(() => {
    void refreshRuns();
  });

  async function refreshRuns(): Promise<void> {
    refreshing = true;
    error = '';
    try {
      runs = await listResearchRuns(20);
      selectedRun = selectedRun ? runs.find((run) => run.id === selectedRun?.id) ?? selectedRun : runs[0] ?? null;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Research runs failed to load.';
    } finally {
      refreshing = false;
    }
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
      const run = await createResearchRun({
        mode,
        goal: goal.trim(),
        seed_urls: seedUrls,
        include_domains: includeDomains,
        exclude_domains: excludeDomains,
        depth,
        max_pages: maxPages,
        time_budget_s: timeBudget,
        use_ai: useAi,
        use_cloud_ai: useCloudAi,
        local_first: !useCloudAi,
        provider: provider.trim() || undefined,
        model: model.trim() || undefined
      });
      selectedRun = run;
      runs = [run, ...runs.filter((item) => item.id !== run.id)].slice(0, 20);
      message = `Queued ${currentMode?.label ?? 'research'} run. The report will update as sources arrive.`;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Research run failed.';
    } finally {
      loading = false;
    }
  }

  async function pollLiveRuns(): Promise<void> {
    const liveIds = new Set(runs.filter(isLiveRun).map((run) => run.id));
    if (selectedRun && isLiveRun(selectedRun)) liveIds.add(selectedRun.id);
    if (!liveIds.size) return;
    try {
      const updates = (await Promise.all(Array.from(liveIds).map((id) => getResearchRun(id).catch(() => null)))).filter(
        (run): run is ResearchRun => Boolean(run)
      );
      if (!updates.length) return;
      for (const update of updates) {
        runs = [update, ...runs.filter((item) => item.id !== update.id)].slice(0, 20);
        if (selectedRun?.id === update.id) selectedRun = update;
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
      if (selectedRun?.id === cancelled.id) selectedRun = cancelled;
      message = 'Research run cancelled.';
    } catch (err) {
      error = err instanceof Error ? err.message : 'Could not cancel research run.';
    }
  }

  async function cancelSelectedRun(): Promise<void> {
    if (!selectedRun) return;
    await cancelRun(selectedRun);
  }

  function splitList(value: string): string[] {
    return value
      .split(/[\n,]/u)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function runMeta(run: ResearchRun): string {
    const providerLabel = [run.provider, run.model].filter(Boolean).join('/');
    const parts = [
      run.mode.replace('_', ' '),
      isLiveRun(run) ? `${progressPercent(run)}%` : '',
      `${run.sources.length} source${run.sources.length === 1 ? '' : 's'}`,
      `${Math.round(run.runtime_ms)} ms`,
      run.cached_pages ? `${run.cached_pages} cached` : '',
      providerLabel || 'extractive'
    ].filter(Boolean);
    return parts.join(' - ');
  }

  function isLiveRun(run: ResearchRun): boolean {
    return run.status === 'queued' || run.status === 'running';
  }

  function progressPercent(run: ResearchRun): number {
    return Math.max(0, Math.min(100, Math.round((run.progress ?? 0) * 100)));
  }

  function statusLabel(run: ResearchRun): string {
    if (run.status === 'succeeded') return 'saved';
    return run.status.replace('_', ' ');
  }

  onMount(() => {
    const timer = window.setInterval(() => {
      void pollLiveRuns();
    }, 1500);
    return () => window.clearInterval(timer);
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
            <button class:active={selectedRun?.id === run.id} type="button" on:click={() => (selectedRun = run)}>
              <span class={`status ${run.status}`}>{statusLabel(run)}</span>
              <strong>{run.report.title}</strong>
              <small>{runMeta(run)}</small>
              {#if isLiveRun(run)}
                <span class="progress-track" aria-label={`Research progress ${progressPercent(run)}%`}>
                  <span style={`width: ${progressPercent(run)}%`}></span>
                </span>
                <small>{run.current_step || 'Working'}</small>
              {/if}
            </button>
          {/each}
        </div>
      {:else if refreshing}
        <p class="empty-note">Loading archived research runs.</p>
      {:else}
        <p class="empty-note">No archived research yet.</p>
      {/if}
    </aside>
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
          {/if}
        </div>
        <div class="export-actions">
          {#if isLiveRun(selectedRun)}
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
          <p>{selectedRun.report.tldr}</p>
        </article>
        <article>
          <h3>Reliability</h3>
          {#each selectedRun.report.reliability_notes as note}
            <p>{note}</p>
          {/each}
        </article>
      </div>

      <article class="full-summary">
        <h3>Detailed Summary</h3>
        <p>{selectedRun.report.detailed_summary}</p>
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
          {#each selectedRun.report.open_questions as item}
            <p>{item}</p>
          {/each}
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
              </div>
            {/each}
          </div>
        {:else}
          <p class="empty-note">No citations mapped yet.</p>
        {/if}
      </article>

      <article>
        <h3>Sources</h3>
        <div class="source-list">
          {#each selectedRun.sources as source}
            <a href={source.canonical_url} target="_blank" rel="noreferrer">
              <span>{source.id}</span>
              <strong>{source.title || source.canonical_url}</strong>
              <small>{source.canonical_url}</small>
              <small>{source.text_length} chars - score {source.score}{source.cached ? ' - cached' : ''}</small>
            </a>
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
  input {
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

  .link-button,
  .icon-button,
  .primary-button,
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

  .report-progress {
    display: grid;
    gap: 5px;
    margin-top: 8px;
    max-width: 420px;
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

  ul {
    margin: 0;
    padding-left: 18px;
  }

  .empty-note {
    color: var(--muted);
  }

  @media (max-width: 900px) {
    .workbench,
    .report-grid,
    .inline-fields,
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
  }

  @media (max-width: 540px) {
    .mode-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
