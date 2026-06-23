<script lang="ts">
  import { onMount } from 'svelte';
  import { Activity, ArrowRight, Pause, Play, RefreshCw, RotateCcw, Square, Terminal, XCircle } from 'lucide-svelte';
  import {
    activityHasActiveWork,
    activityStatusLabel,
    type ActivityAction,
    type ActivityRecord
  } from '$lib/activity';
  import {
    loadActivitySnapshot,
    performActivityAction,
    readActivityCache,
    type ActivitySnapshot,
    type ActivitySourceState
  } from '$lib/activity-api';
  import { hubHref } from '$lib/routes';

  let snapshot: ActivitySnapshot | null = null;
  let loading = false;
  let refreshing = false;
  let error = '';
  let actionError = '';
  let actionMessage = '';
  let busyKey = '';

  $: records = snapshot?.records ?? [];
  $: sources = snapshot?.sources ?? [];
  $: activeRecords = records.filter((record) => ['queued', 'running', 'paused'].includes(record.status));
  $: failedRecords = records.filter((record) => ['failed', 'blocked'].includes(record.status));
  $: stableRecords = records.filter((record) => !['queued', 'running', 'paused', 'failed', 'blocked'].includes(record.status));
  $: hasActive = activityHasActiveWork(records);
  $: partial = snapshot?.partial ?? false;
  $: stale = snapshot?.stale ?? false;

  onMount(() => {
    snapshot = readActivityCache();
    void refreshActivity();
    const interval = window.setInterval(() => {
      if (hasActive && !refreshing && !loading) void refreshActivity({ background: true });
    }, 8_000);
    const focusRefresh = () => {
      if (!loading && !refreshing) void refreshActivity({ background: true });
    };
    window.addEventListener('focus', focusRefresh);
    document.addEventListener('visibilitychange', focusRefresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', focusRefresh);
      document.removeEventListener('visibilitychange', focusRefresh);
    };
  });

  async function refreshActivity(options: { background?: boolean } = {}): Promise<void> {
    const background = options.background === true;
    if (background) refreshing = true;
    else loading = true;
    error = '';
    try {
      snapshot = await loadActivitySnapshot(60);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'Activity failed to load.';
      snapshot = snapshot ?? readActivityCache();
    } finally {
      loading = false;
      refreshing = false;
    }
  }

  async function runAction(record: ActivityRecord, action: ActivityAction): Promise<void> {
    if (!action.enabled || action.kind === 'open' || action.kind === 'view_logs') return;
    busyKey = `${record.id}:${action.kind}`;
    actionError = '';
    actionMessage = '';
    try {
      await performActivityAction(record, action.kind);
      actionMessage = `${action.label} requested for ${record.title}.`;
      await refreshActivity({ background: true });
    } catch (caught) {
      actionError = caught instanceof Error ? caught.message : `${action.label} failed.`;
    } finally {
      busyKey = '';
    }
  }

  function displayWhen(value: string | undefined): string {
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

  function progressPercent(record: ActivityRecord): number {
    return Math.max(0, Math.min(100, Math.round((record.progress ?? 0) * 100)));
  }

  function actionIcon(kind: ActivityAction['kind']) {
    if (kind === 'resume') return Play;
    if (kind === 'cancel') return Square;
    if (kind === 'retry') return RotateCcw;
    if (kind === 'view_logs') return Terminal;
    if (kind === 'dismiss') return XCircle;
    return ArrowRight;
  }

  function sourceLine(source: ActivitySourceState): string {
    if (source.ok) return `${source.count} record${source.count === 1 ? '' : 's'}`;
    if (source.state === 'timeout') return 'timed out; cached work remains visible';
    return source.error || 'unavailable';
  }
</script>

<svelte:head>
  <title>Activity - Mini Hub</title>
</svelte:head>

<section class="page-header">
  <div>
    <p class="eyebrow">Recovery Surface</p>
    <h1>Activity</h1>
    <p>Research, AI OS, passive engine, and Macro Lab work that has durable backend state.</p>
  </div>
  <button class="button" type="button" disabled={loading || refreshing} on:click={() => refreshActivity()}>
    <RefreshCw size={16} />
    <span>{refreshing ? 'Refreshing' : 'Refresh'}</span>
  </button>
</section>

{#if error}
  <section class="notice error">Activity refresh failed: {error}</section>
{/if}

{#if actionError}
  <section class="notice error">{actionError}</section>
{:else if actionMessage}
  <section class="notice success">{actionMessage}</section>
{/if}

<section class="activity-status">
  <article>
    <span>Active</span>
    <strong>{activeRecords.length}</strong>
    <small>{hasActive ? 'Polls while open' : 'No running work'}</small>
  </article>
  <article>
    <span>Failed</span>
    <strong>{failedRecords.length}</strong>
    <small>{failedRecords.length ? 'Needs inspection' : 'Clear'}</small>
  </article>
  <article>
    <span>Sources</span>
    <strong>{sources.filter((source) => source.ok).length}/{sources.length || 3}</strong>
    <small>{partial ? 'Partial data' : stale ? 'Cached' : 'Fresh'}</small>
  </article>
</section>

{#if sources.length}
  <section class="source-strip" aria-label="Activity source health">
    {#each sources as source}
      <span class:bad={!source.ok}>
        <strong>{source.label}</strong>
        {sourceLine(source)}
      </span>
    {/each}
  </section>
{/if}

{#if loading && !records.length}
  <section class="activity-list">
    {#each Array.from({ length: 4 }) as _}
      <article class="activity-row skeleton">
        <span></span>
        <div></div>
      </article>
    {/each}
  </section>
{:else if records.length}
  <section class="activity-list" aria-label="Activity records">
    {#if activeRecords.length}
      <h2>Active And Paused</h2>
      {#each activeRecords as record}
        {@render ActivityRow(record, busyKey, runAction)}
      {/each}
    {/if}

    {#if failedRecords.length}
      <h2>Needs Attention</h2>
      {#each failedRecords as record}
        {@render ActivityRow(record, busyKey, runAction)}
      {/each}
    {/if}

    {#if stableRecords.length}
      <h2>Recent History</h2>
      {#each stableRecords as record}
        {@render ActivityRow(record, busyKey, runAction)}
      {/each}
    {/if}
  </section>
{:else}
  <section class="empty-state">
    <Activity size={20} />
    <strong>No durable activity yet.</strong>
    <p>When a research run, AI OS job, passive sweep, backup, benchmark, or macro run exists in its backend, it will appear here after refresh.</p>
    {#if partial}
      <p>Some sources are unavailable, so this may be incomplete.</p>
    {/if}
  </section>
{/if}

{#snippet ActivityRow(record: ActivityRecord, busyKey: string, onRun: (record: ActivityRecord, action: ActivityAction) => Promise<void>)}
  <article class={`activity-row ${record.status}`}>
    <div class="activity-main">
      <span class={`status ${record.status}`}>{activityStatusLabel(record.status)}</span>
      <div>
        <strong>{record.title}</strong>
        <p>{record.detail}</p>
        <small>{record.sourceLabel} - started {displayWhen(record.startedAt)} - updated {displayWhen(record.updatedAt)}</small>
        {#if record.error}
          <small class="error-text">{record.error}</small>
        {/if}
        {#if record.progress !== undefined && ['queued', 'running', 'paused'].includes(record.status)}
          <span class="progress-track" aria-label={`Activity progress ${progressPercent(record)}%`}>
            <span style={`width: ${progressPercent(record)}%`}></span>
          </span>
        {/if}
      </div>
    </div>
    <div class="activity-actions">
      {#each record.actions as action}
        {#if action.kind === 'open' || action.kind === 'view_logs'}
          <a class:disabled={!action.enabled} href={hubHref(action.route || record.route)}>
            <svelte:component this={actionIcon(action.kind)} size={15} />
            <span>{action.label}</span>
          </a>
        {:else}
          <button
            type="button"
            disabled={!action.enabled || busyKey === `${record.id}:${action.kind}`}
            on:click={() => onRun(record, action)}
          >
            <svelte:component this={actionIcon(action.kind)} size={15} />
            <span>{busyKey === `${record.id}:${action.kind}` ? 'Working' : action.label}</span>
          </button>
        {/if}
      {/each}
    </div>
  </article>
{/snippet}

<style>
  .activity-status {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
    margin-bottom: 12px;
  }

  .activity-status article,
  .source-strip,
  .activity-row,
  .empty-state {
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
  }

  .activity-status article {
    padding: 12px;
  }

  .activity-status span,
  .activity-status small,
  .activity-row small {
    color: var(--muted);
  }

  .activity-status strong {
    display: block;
    margin: 4px 0;
    font-size: 22px;
  }

  .source-strip {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 10px;
    margin-bottom: 12px;
  }

  .source-strip span {
    display: inline-flex;
    gap: 6px;
    align-items: center;
    padding: 5px 8px;
    border-radius: 6px;
    background: var(--surface-muted);
    color: var(--muted);
  }

  .source-strip span.bad {
    color: var(--error-text);
    background: var(--error-bg);
  }

  .activity-list {
    display: grid;
    gap: 10px;
  }

  .activity-list h2 {
    margin: 8px 0 0;
    font-size: 13px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0;
  }

  .activity-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 12px;
    padding: 12px;
  }

  .activity-main {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 10px;
  }

  .activity-main strong {
    display: block;
  }

  .activity-main p {
    margin: 4px 0;
    color: var(--text-soft);
  }

  .activity-main small {
    display: block;
  }

  .status {
    align-self: start;
    min-width: 70px;
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 4px 8px;
    text-align: center;
    font-size: 11px;
    color: var(--muted);
    background: var(--surface-muted);
  }

  .status.running,
  .status.queued {
    color: var(--warning-text);
    background: var(--warning-bg);
    border-color: var(--warning-border);
  }

  .status.failed,
  .status.blocked {
    color: var(--error-text);
    background: var(--error-bg);
    border-color: var(--error-border);
  }

  .status.succeeded {
    color: var(--success-text);
    background: var(--success-bg);
    border-color: var(--success-border);
  }

  .activity-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 6px;
  }

  .activity-actions a,
  .activity-actions button {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 30px;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0 9px;
    color: var(--text);
    background: var(--surface-muted);
    text-decoration: none;
    font: inherit;
    cursor: pointer;
  }

  .activity-actions a.disabled,
  .activity-actions button:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .progress-track {
    display: block;
    height: 6px;
    margin-top: 8px;
    border-radius: 999px;
    overflow: hidden;
    background: var(--surface-soft);
  }

  .progress-track span {
    display: block;
    height: 100%;
    background: var(--accent);
  }

  .notice,
  .empty-state {
    margin-bottom: 12px;
    padding: 12px;
  }

  .notice.error {
    color: var(--error-text);
    background: var(--error-bg);
    border: 1px solid var(--error-border);
  }

  .notice.success {
    color: var(--success-text);
    background: var(--success-bg);
    border: 1px solid var(--success-border);
  }

  .empty-state {
    display: grid;
    gap: 6px;
    place-items: start;
  }

  .empty-state p {
    margin: 0;
    color: var(--muted);
  }

  .error-text {
    color: var(--error-text) !important;
  }

  .skeleton {
    height: 72px;
    animation: pulse 1.2s ease-in-out infinite;
  }

  .skeleton span,
  .skeleton div {
    border-radius: 6px;
    background: var(--surface-muted);
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

  @media (max-width: 760px) {
    .activity-status,
    .activity-row {
      grid-template-columns: 1fr;
    }

    .activity-actions {
      justify-content: flex-start;
    }
  }
</style>
