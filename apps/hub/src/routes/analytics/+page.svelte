<script lang="ts">
  import { onMount } from 'svelte';
  import { BarChart3, RefreshCw, Settings } from 'lucide-svelte';
  import { analyticsViewMessage, analyticsViewState, buildAnalyticsMetricRows, buildStudyMinutesTrend } from '$lib/analytics-view';
  import { clientData } from '$lib/client-data';
  import { hubHref } from '$lib/routes';
  import { compactServiceIssueIfRecognized } from '$lib/service-issues';

  let plotHost: HTMLDivElement;
  let sparklinePath = '';
  let renderStatus = 'Preparing browser analytics';
  let renderError = '';
  let refreshError = '';
  let refreshBusy = false;

  $: rows = buildAnalyticsMetricRows($clientData);
  $: viewState = analyticsViewState($clientData, rows);
  $: viewMessage = analyticsViewMessage($clientData, rows);
  $: trendValues = buildStudyMinutesTrend($clientData.studySessions);
  $: hasMetrics = rows.some((row) => row.value > 0);
  $: hasTrend = trendValues.some((value) => value > 0);
  $: cachedRecordCount = rows.reduce((sum, row) => sum + row.value, 0);
  $: analyticsIssue = refreshError || renderError;
  $: visibleAnalyticsIssue = analyticsIssue ? compactAnalyticsIssue(analyticsIssue) : '';
  $: if (plotHost) void render(rows, trendValues);

  function displayTime(value: string): string {
    if (!value) return 'n/a';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    }).format(date);
  }

  function analyticsCacheStatus(): string {
    if (!$clientData.initialized) return 'Cache loading';
    if (refreshError) return 'Refresh failed; using last loaded cache';
    if (renderError) return 'Renderer failed; data still cached';
    if ($clientData.status === 'syncing') return 'Syncing; showing browser cache';
    if ($clientData.status === 'offline-readonly') return 'Offline read-only cache';
    if ($clientData.status === 'error') return 'Cache needs attention';
    return 'Browser cache ready';
  }

  function analyticsSyncDetail(): string {
    if (!$clientData.initialized) return 'Loading PGlite/browser cache.';
    if ($clientData.lastSyncedAt) return `Last sync ${displayTime($clientData.lastSyncedAt)}`;
    if ($clientData.status === 'offline-readonly') return 'No live sync; showing saved browser data.';
    if ($clientData.status === 'error') return $clientData.error || 'Cache status reported an error.';
    return 'No completed sync recorded in this browser yet.';
  }

  function analyticsRecordSummary(): string {
    return `${cachedRecordCount} cached analytics signal${cachedRecordCount === 1 ? '' : 's'}`;
  }

  function compactAnalyticsIssue(message = ''): string {
    const text = message.trim();
    if (!text) return 'Analytics could not refresh the local cache view.';
    if (/pglite|opfs|indexeddb|quota|storage|cache/iu.test(text)) {
      return 'The browser cache needs attention; existing loaded data remains visible when available.';
    }
    if (/plot|d3|render|canvas|svg|import|module|wasm/iu.test(text)) {
      return 'The analytics renderer could not load; cached rows are still available.';
    }
    const compact = compactServiceIssueIfRecognized(text, 'Analytics');
    return compact === text && text.length > 140 ? `${text.slice(0, 137)}...` : compact;
  }

  async function render(nextRows = rows, nextTrend = trendValues): Promise<void> {
    if (!plotHost) return;
    renderError = '';
    if (!nextRows.some((row) => row.value > 0)) {
      plotHost.replaceChildren();
      sparklinePath = '';
      renderStatus = viewMessage;
      return;
    }
    renderStatus = 'Loading Plot and D3';
    try {
      const analytics = await import('@mini-hub/db/analytics');
      await analytics.renderMetricBars(plotHost, nextRows);
      sparklinePath = analytics.buildSparklinePath(nextTrend);
      renderStatus = 'Rendered real local cache data.';
    } catch (error) {
      renderError = error instanceof Error ? error.message : 'Analytics renderer failed.';
      renderStatus = 'Renderer unavailable.';
      plotHost.replaceChildren();
      sparklinePath = '';
    }
  }

  async function refresh(): Promise<void> {
    if (refreshBusy) return;
    refreshBusy = true;
    refreshError = '';
    try {
      await clientData.init();
      if ($clientData.isOnline) {
        await clientData.syncNow();
      }
      await render(rows, trendValues);
    } catch (error) {
      refreshError = error instanceof Error ? error.message : 'Analytics refresh failed.';
      renderStatus = 'Refresh failed; showing the last local cache state.';
    } finally {
      refreshBusy = false;
    }
  }

  onMount(() => {
    void clientData.init();
  });
</script>

<svelte:head>
  <title>Analytics - Mini Hub</title>
</svelte:head>

<section class="page-header">
  <div>
    <p class="eyebrow">Analytics</p>
    <h1>Local Insights</h1>
  </div>
  <button class="button" type="button" disabled={refreshBusy} title={refreshBusy ? 'Analytics refresh is already running.' : 'Refresh local cache analytics.'} on:click={refresh}>
    <RefreshCw size={17} />
    <span>{refreshBusy ? 'Refreshing' : 'Refresh'}</span>
  </button>
</section>

<section class={`card card-pad analytics-state ${refreshError ? 'error' : viewState}`}>
  <strong>{refreshError ? 'Refresh needs attention' : viewState === 'ready' ? 'Connected Data' : viewState === 'offline' ? 'Cached Data' : viewState === 'empty' ? 'Healthy Empty' : viewState === 'error' ? 'Action Needed' : 'Loading'}</strong>
  <p>{viewMessage}</p>
  {#if analyticsIssue}
    <div class="analytics-issue" title={`Raw Analytics error: ${analyticsIssue}`}>
      <p class="error-text">{visibleAnalyticsIssue}</p>
      <a class="button compact" href={hubHref('/settings#data-recovery')} title="Open Settings Data & Recovery to inspect browser cache and sync state.">
        <Settings size={15} />
        <span>Open Settings</span>
      </a>
    </div>
  {/if}
  <div class="state-meta" aria-label="Analytics cache status">
    <span>{analyticsCacheStatus()}</span>
    <span>{analyticsSyncDetail()}</span>
    <span>{analyticsRecordSummary()}</span>
  </div>
</section>

<section class="grid two">
  <div class="card card-pad">
    <div class="section-title">
      <BarChart3 size={18} />
      <strong>Workspace Mix</strong>
    </div>
    <div class:hidden={!hasMetrics} class="plot" bind:this={plotHost}></div>
    {#if !hasMetrics}
      <div class="empty-panel">
        <strong>No chart yet</strong>
        <p>Add real records in Career, Study, or games and this panel will render them.</p>
      </div>
    {/if}
    <p class="muted">{renderStatus}</p>
  </div>

  <div class="card card-pad">
    <strong>Study Minutes Trend</strong>
    {#if hasTrend && sparklinePath}
      <svg class="sparkline" viewBox="0 0 240 64" role="img" aria-label="Study minutes trend from local sessions">
        <path d={sparklinePath} />
      </svg>
    {:else}
      <div class="empty-panel compact">
        <strong>No study trend yet</strong>
        <p>Log a study session to build the seven-day local trend.</p>
      </div>
    {/if}
    <p class="muted">DuckDB-Wasm is reserved for CSV and LogMiner-style imports; this page shows real Mini Hub cache data first.</p>
    <div class="quick-links">
      <a href={hubHref('/desk/career')}>Career</a>
      <a href={hubHref('/desk/study')}>Study</a>
      <a href={hubHref('/games')}>Games</a>
    </div>
  </div>
</section>

<style>
  .analytics-state {
    display: grid;
    gap: 5px;
    margin-bottom: 10px;
    background: var(--surface-muted);
  }

  .analytics-state p {
    margin: 0;
    color: var(--muted);
    line-height: 1.45;
  }

  .state-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 4px;
  }

  .state-meta span {
    min-height: 26px;
    padding: 5px 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface);
    color: var(--muted);
    font-size: 12px;
    font-weight: 800;
  }

  .analytics-state.error {
    border-color: var(--error-border);
    background: var(--error-bg);
  }

  .analytics-issue {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-top: 2px;
  }

  .analytics-issue .button {
    flex: 0 0 auto;
  }

  .analytics-state.offline {
    border-color: var(--warning-border);
    background: var(--warning-bg);
  }

  .section-title {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
  }

  .plot {
    min-height: 220px;
  }

  .plot.hidden {
    display: none;
  }

  .empty-panel {
    display: grid;
    min-height: 220px;
    place-content: center;
    gap: 6px;
    padding: 18px;
    border: 1px dashed var(--border);
    border-radius: 8px;
    color: var(--muted);
    text-align: center;
  }

  .empty-panel.compact {
    min-height: 84px;
    margin: 14px 0;
  }

  .empty-panel strong {
    color: var(--text);
  }

  .empty-panel p {
    max-width: 320px;
    margin: 0;
    line-height: 1.45;
  }

  .sparkline {
    display: block;
    width: 100%;
    max-width: 420px;
    height: auto;
    margin: 14px 0;
  }

  .sparkline path {
    fill: none;
    stroke: var(--accent);
    stroke-width: 4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .quick-links {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 12px;
  }

  .quick-links a {
    min-height: 28px;
    padding: 5px 9px;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    background: var(--surface-muted);
    font-size: 13px;
    font-weight: 800;
    text-decoration: none;
  }

  .error-text {
    color: var(--error-text);
  }
</style>
