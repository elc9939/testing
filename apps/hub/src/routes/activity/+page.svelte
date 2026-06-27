<script lang="ts">
  import { onMount } from 'svelte';
  import { Activity, ArrowRight, Pause, Play, RefreshCw, RotateCcw, Settings, Square, Terminal, XCircle } from 'lucide-svelte';
  import {
    activityHasActiveWork,
    activityStatusLabel,
    type ActivityAction,
    type ActivityRecord
  } from '$lib/activity';
  import {
    clearDismissedActivityRecords,
    dismissActivityRecord,
    loadActivitySnapshot,
    performActivityAction,
    readActivityCache,
    readDismissedActivityIds,
    type ActivitySnapshot,
    type ActivitySourceState
  } from '$lib/activity-api';
  import { persistenceRows, persistenceSummary } from '$lib/persistence-map';
  import { hubHref } from '$lib/routes';

  const expectedActivitySources = [
    { id: 'ai-os', label: 'AI OS' },
    { id: 'passive-tasks', label: 'Passive Tasks' },
    { id: 'macro-lab', label: 'Macro Lab' }
  ];

  let snapshot: ActivitySnapshot | null = null;
  let loading = false;
  let refreshing = false;
  let error = '';
  let actionError = '';
  let actionMessage = '';
  let busyKey = '';
  let dismissedIds = new Set<string>();
  let showDismissed = false;

  $: records = snapshot?.records ?? [];
  $: visibleRecords = showDismissed ? records : records.filter((record) => isActiveRecord(record) || !dismissedIds.has(record.id));
  $: dismissedCount = records.filter((record) => !isActiveRecord(record) && dismissedIds.has(record.id)).length;
  $: sources = snapshot?.sources ?? [];
  $: sourceHealthRows = sources.length ? sources : fallbackActivitySources({ loading, refreshing });
  $: runningRecords = visibleRecords.filter((record) => ['queued', 'running'].includes(record.status));
  $: pausedRecords = visibleRecords.filter((record) => record.status === 'paused');
  $: activeRecords = visibleRecords.filter((record) => ['queued', 'running', 'paused'].includes(record.status));
  $: failedRecords = visibleRecords.filter((record) => ['failed', 'blocked'].includes(record.status));
  $: stableRecords = visibleRecords.filter((record) => !['queued', 'running', 'paused', 'failed', 'blocked'].includes(record.status));
  $: sourceFailures = sourceHealthRows.filter((source) => !source.ok);
  $: sourceHealthSummary = activitySourceHealthSummary({
    hasSourceSnapshot: sources.length > 0,
    loading,
    refreshing,
    sourceFailureCount: sourceFailures.length,
    stale
  });
  $: hasActive = activityHasActiveWork(records);
  $: partial = snapshot?.partial ?? false;
  $: stale = snapshot?.stale ?? false;
  $: activityRecoveryRows = persistenceRows.filter((row) => ['activity', 'research', 'ai-os', 'macro-lab', 'passive-tasks'].includes(row.id));
  $: activityRecoveryStats = persistenceSummary(activityRecoveryRows);
  $: refreshBlockedReason = activityRefreshBlockedReason({ loading, refreshing, busyKey });

  onMount(() => {
    dismissedIds = readDismissedActivityIds();
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
    const blocked = actionBlockedReason(record, action);
    if (blocked) {
      actionError = blocked;
      return;
    }
    if (action.kind === 'open' || action.kind === 'view_logs') return;
    if (action.kind === 'dismiss') {
      dismissedIds = dismissActivityRecord(record.id);
      actionMessage = `Dismissed ${record.title} from this browser. The backend record is still recoverable.`;
      actionError = '';
      return;
    }
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

  function restoreDismissed(): void {
    dismissedIds = clearDismissedActivityRecords();
    showDismissed = false;
    actionMessage = 'Restored dismissed Activity records for this browser.';
    actionError = '';
  }

  function dismissedToggleTitle(): string {
    return showDismissed
      ? 'Hide records dismissed in this browser; active work remains visible.'
      : `Show ${dismissedCount} Activity record${dismissedCount === 1 ? '' : 's'} dismissed in this browser.`;
  }

  function restoreDismissedTitle(): string {
    return 'Restore Activity records hidden in this browser. Durable backend records are not changed.';
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
    const cached = source.count ? `; ${source.count} cached record${source.count === 1 ? '' : 's'} still visible` : '';
    if (source.state === 'timeout') return `timed out${cached || '; cached work remains visible'}`;
    return `${source.error || 'unavailable'}${cached}`;
  }

  function fallbackActivitySources(state: { loading: boolean; refreshing: boolean }): ActivitySourceState[] {
    const detail = state.loading || state.refreshing
      ? 'Checking source status from AI OS, Passive Tasks, and Macro Lab.'
      : 'No source snapshot yet; refresh Activity or open Settings.';
    return expectedActivitySources.map((source) => ({
      ...source,
      ok: false,
      state: 'error' as const,
      error: detail,
      count: 0
    }));
  }

  function activitySourceHealthSummary(state: {
    hasSourceSnapshot: boolean;
    loading: boolean;
    refreshing: boolean;
    sourceFailureCount: number;
    stale: boolean;
  }): string {
    if (!state.hasSourceSnapshot) return state.loading || state.refreshing ? 'Checking' : 'No snapshot';
    if (state.sourceFailureCount) return `${state.sourceFailureCount} issue${state.sourceFailureCount === 1 ? '' : 's'}`;
    if (state.stale) return 'Cached';
    return 'Fresh';
  }

  function isActiveRecord(record: ActivityRecord): boolean {
    return ['queued', 'running', 'paused'].includes(record.status);
  }

  function sourceIdFor(record: ActivityRecord): string {
    if (record.source === 'research' || record.source === 'ai-os') return 'ai-os';
    return record.source;
  }

  function sourceStateFor(record: ActivityRecord): ActivitySourceState | undefined {
    return sourceHealthRows.find((source) => source.id === sourceIdFor(record));
  }

  function sourceReachable(record: ActivityRecord): boolean {
    const source = sourceStateFor(record);
    return Boolean(source?.ok);
  }

  function activityActionKey(record: ActivityRecord, action: ActivityAction): string {
    return `${record.id}:${action.kind}`;
  }

  function activityRefreshBlockedReason(state: { loading: boolean; refreshing: boolean; busyKey: string }): string {
    if (state.loading) return 'Activity is already loading records from connected sources.';
    if (state.refreshing) return 'Activity is already refreshing in the background.';
    if (state.busyKey) return 'Another Activity action is already running.';
    return '';
  }

  function activityEmptyTitle(): string {
    if (partial || sourceFailures.length) return 'No live activity loaded from reachable sources.';
    if (stale) return 'No cached Activity records.';
    return 'No durable activity yet.';
  }

  function activityEmptyDetail(): string {
    if (partial || sourceFailures.length) {
      return 'Activity checked the durable work sources it could reach. Start or fix AI OS, Passive Tasks, or Macro Lab in Settings, then retry.';
    }
    if (stale) return 'The browser cache is available, but it does not contain any durable work records yet.';
    return 'When a research run, AI OS job, tool call, generated asset, passive sweep, backup, benchmark, or macro run exists in its backend, it will appear here after refresh.';
  }

  function activityEmptyRefreshTitle(): string {
    return refreshBlockedReason || 'Retry loading Activity records from connected sources.';
  }

  function actionBlockedReason(record: ActivityRecord, action: ActivityAction): string {
    const key = activityActionKey(record, action);
    if (busyKey === key) return `${action.label} is already running.`;
    if (busyKey) return 'Another Activity action is already running.';
    if (!action.enabled) return `${action.label} is not available for this ${activityStatusLabel(record.status)} item.`;
    if (action.kind === 'open' || action.kind === 'view_logs' || action.kind === 'dismiss') return '';
    const source = sourceStateFor(record);
    if (!source?.ok) {
      const detail = source?.state === 'timeout' ? 'timed out' : source?.error || 'is offline';
      return `${record.sourceLabel} ${detail}; refresh or open Settings before running ${action.label}.`;
    }
    return '';
  }

  function actionDisabled(record: ActivityRecord, action: ActivityAction): boolean {
    return Boolean(actionBlockedReason(record, action));
  }

  function actionHref(record: ActivityRecord, action: ActivityAction): string {
    if (action.enabled || sourceReachable(record)) return hubHref(action.route || record.route);
    return hubHref('/settings');
  }

  function linkActionTitle(record: ActivityRecord, action: ActivityAction): string {
    const blocked = actionBlockedReason(record, action);
    if (blocked) return blocked;
    if (!sourceReachable(record)) return `Open ${record.sourceLabel}; the backend may still show a setup or offline state.`;
    return activityActionTitle(record, action);
  }

  function activityActionTitle(record: ActivityRecord, action: ActivityAction): string {
    const blocked = actionBlockedReason(record, action);
    if (blocked) return blocked;
    if (action.kind === 'open') return `Open ${record.title} in ${record.sourceLabel}.`;
    if (action.kind === 'view_logs') return `View logs for ${record.title}.`;
    if (action.kind === 'resume') return `Resume ${record.title} from Activity.`;
    if (action.kind === 'cancel') return `Cancel ${record.title}; use only for active work you want to stop.`;
    if (action.kind === 'retry') return `Retry ${record.title} from its owning service.`;
    if (action.kind === 'dismiss') return `Hide ${record.title} in this browser; backend records are not deleted.`;
    return `${action.label} ${record.title}.`;
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
  <div class="action-row">
    {#if dismissedCount}
      <button class="button" type="button" title={dismissedToggleTitle()} on:click={() => (showDismissed = !showDismissed)}>
        <XCircle size={16} />
        <span>{showDismissed ? 'Hide dismissed' : `Show dismissed (${dismissedCount})`}</span>
      </button>
      <button class="button" type="button" title={restoreDismissedTitle()} on:click={restoreDismissed}>
        <RotateCcw size={16} />
        <span>Restore</span>
      </button>
    {/if}
    <button class="button" type="button" disabled={Boolean(refreshBlockedReason)} title={refreshBlockedReason || 'Refresh Activity records from connected sources.'} on:click={() => refreshActivity()}>
      <RefreshCw size={16} />
      <span>{refreshing ? 'Refreshing' : 'Refresh'}</span>
    </button>
  </div>
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
    <span>Running</span>
    <strong>{runningRecords.length}</strong>
    <small>{hasActive ? 'Polls while open' : 'No live work'}</small>
  </article>
  <article>
    <span>Paused</span>
    <strong>{pausedRecords.length}</strong>
    <small>{pausedRecords.length ? 'Resume or cancel' : 'None'}</small>
  </article>
  <article>
    <span>Failed</span>
    <strong>{failedRecords.length}</strong>
    <small>{failedRecords.length ? 'Needs inspection' : 'Clear'}</small>
  </article>
  <article>
    <span>Saved</span>
    <strong>{stableRecords.length}</strong>
    <small>{stableRecords.length ? 'Reports and history' : 'None yet'}</small>
  </article>
  <article>
    <span>Sources</span>
    <strong>{sourceHealthRows.filter((source) => source.ok).length}/{sourceHealthRows.length}</strong>
    <small>{sourceHealthSummary}</small>
  </article>
  <article>
    <span>Dismissed</span>
    <strong>{dismissedCount}</strong>
    <small>{dismissedCount ? 'Hidden here only' : 'None hidden'}</small>
  </article>
</section>

<section class="recovery-summary" aria-label="Activity recovery model">
  <div>
    <strong>What comes back after you leave</strong>
    <p>Real work reloads from its owning service. Activity keeps a browser cache too, so stale records can remain visible when a local service is down.</p>
  </div>
  <div class="recovery-facts">
    <span>
      <strong>{activityRecoveryStats.serviceBacked}</strong>
      <small>service-backed work areas</small>
    </span>
    <span>
      <strong>{activityRecoveryStats.browserLocal}</strong>
      <small>browser cache layer</small>
    </span>
    <span>
      <strong>{activityRecoveryStats.crossDevice}</strong>
      <small>cross-device via Hub API</small>
    </span>
  </div>
  <a class="button" href={hubHref('/settings')} title="Open Settings Data & Recovery for the full save/reload map.">
    <Settings size={16} />
    <span>Data &amp; Recovery</span>
  </a>
</section>

<section class="source-strip" aria-label="Activity source health">
  {#each sourceHealthRows as source}
    <span class:bad={!source.ok && sources.length > 0} class:pending={!sources.length}>
      <strong>{source.label}</strong>
      {sourceLine(source)}
    </span>
  {/each}
  {#if stale || partial}
    <span class:bad={partial}>
      <strong>{stale ? 'Cache' : 'Partial'}</strong>
      {stale ? `showing cached records from ${displayWhen(snapshot?.cachedAt)}` : 'one source failed; available work is still listed'}
    </span>
  {/if}
</section>

{#if loading && !records.length}
  <section class="activity-list">
    {#each Array.from({ length: 4 }) as _}
      <article class="activity-row skeleton">
        <span></span>
        <div></div>
      </article>
    {/each}
  </section>
{:else if visibleRecords.length}
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
{:else if records.length}
  <section class="empty-state">
    <XCircle size={20} />
    <strong>All current Activity records are dismissed.</strong>
    <p>Dismiss only hides records in this browser. Durable research, AI OS, passive, and Macro Lab records still live in their owning backend.</p>
    <button class="button" type="button" title={restoreDismissedTitle()} on:click={restoreDismissed}>
      <RotateCcw size={16} />
      <span>Restore dismissed records</span>
    </button>
  </section>
{:else}
  <section class="empty-state">
    <Activity size={20} />
    <strong>{activityEmptyTitle()}</strong>
    <p>{activityEmptyDetail()}</p>
    {#if partial || sourceFailures.length || error}
      <div class="empty-actions">
        <button class="button" type="button" disabled={Boolean(refreshBlockedReason)} title={activityEmptyRefreshTitle()} on:click={() => refreshActivity()}>
          <RefreshCw size={16} />
          <span>{refreshing ? 'Refreshing' : 'Retry Activity'}</span>
        </button>
        <a class="button" href={hubHref('/settings')} title="Open Settings to check service endpoints and local services.">
          <Settings size={16} />
          <span>Open Settings</span>
        </a>
      </div>
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
          <a
            class:disabled={!action.enabled && !sourceReachable(record)}
            href={actionHref(record, action)}
            aria-disabled={!action.enabled && !sourceReachable(record)}
            title={linkActionTitle(record, action)}
          >
            <svelte:component this={actionIcon(action.kind)} size={15} />
            <span>{!action.enabled && !sourceReachable(record) ? 'Open Settings' : action.label}</span>
          </a>
        {:else}
          <button
            type="button"
            disabled={actionDisabled(record, action)}
            title={activityActionTitle(record, action)}
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
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: 10px;
    margin-bottom: 12px;
  }

  .activity-status article,
  .recovery-summary,
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

  .recovery-summary {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 14px;
    padding: 12px;
    margin-bottom: 12px;
  }

  .recovery-summary p {
    margin: 4px 0 0;
    color: var(--muted);
  }

  .recovery-facts {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
  }

  .recovery-facts span {
    min-width: 116px;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface-muted);
  }

  .recovery-facts strong {
    display: block;
    font-size: 16px;
  }

  .recovery-facts small {
    color: var(--muted);
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

  .source-strip span.pending {
    border: 1px dashed var(--border);
    background: var(--surface-soft);
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

  .empty-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 10px;
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
    .activity-status {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .activity-row {
      grid-template-columns: 1fr;
    }

    .recovery-summary {
      grid-template-columns: 1fr;
    }

    .activity-actions {
      justify-content: flex-start;
    }
  }
</style>
