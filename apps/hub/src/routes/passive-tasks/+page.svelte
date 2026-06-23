<script lang="ts">
  import { onMount } from 'svelte';
  import {
    Activity,
    AlertTriangle,
    Bell,
    CheckCircle2,
    Clock3,
    FolderOpen,
    Pause,
    Play,
    RefreshCw,
    Settings,
    Star,
    XCircle
  } from 'lucide-svelte';
  import type {
    PassiveResultCard,
    PassiveRun,
    PassiveBackupHealth,
    PassiveSnapshot,
    PassiveSourceStatus,
    PassiveTask,
    PassiveTaskFamily,
    PassiveTrigger,
    PassiveWatcher
  } from '@mini-hub/core';
  import {
    cancelPassiveTask,
    dismissPassiveNotification,
    getPassiveSnapshot,
    patchPassiveSettings,
    passiveFamilyLabel,
    passiveRunStatusLabel,
    passiveTaskActive,
    passiveUrgencyLabel,
    pausePassiveTask,
    resumePassiveTask,
    runPassiveEvent,
    runPassiveTask,
    runPassiveTick,
    togglePassiveWatcher,
    topPassiveCards,
    triagePassiveCard,
    visiblePassiveNotifications
  } from '$lib/passive-tasks-api';
  import { attentionStore } from '$lib/attention-store';
  import { hubHref } from '$lib/routes';

  let snapshot: PassiveSnapshot | null = null;
  let loading = false;
  let error = '';
  let message = '';
  let busyId = '';
  let folderText = '';
  let domainText = '';
  let accountText = '';

  interface PassiveFamilyRow {
    family: PassiveTaskFamily;
    label: string;
    description: string;
    watcherEnabled: boolean;
    familyEnabled: boolean;
    taskCount: number;
    activeTaskCount: number;
  }

  $: settings = snapshot?.settings ?? null;
  $: watchersById = new Map((snapshot?.watchers ?? []).map((watcher) => [watcher.id, watcher]));
  $: activeTasks = (snapshot?.tasks ?? []).filter((task) =>
    settings ? passiveTaskActive(task, watchersById.get(task.watcherId), settings) : false
  );
  $: pausedTasks = (snapshot?.tasks ?? []).filter((task) => task.status === 'paused' || task.status === 'cancelled');
  $: failedRuns = (snapshot?.runs ?? []).filter((run) => ['failed', 'blocked'].includes(run.status));
  $: tasksWithErrorLogs = (snapshot?.tasks ?? []).filter((task) => task.errorLog.length > 0).slice(0, 6);
  $: digestCards = topPassiveCards(snapshot);
  $: notifications = visiblePassiveNotifications(snapshot);
  $: familyRows = buildFamilyRows(snapshot, settings);
  $: worker = snapshot?.worker ?? null;
  $: backupHealth = snapshot?.backupHealth ?? null;
  $: resultRows = [...(snapshot?.results ?? [])]
    .sort((a, b) => dateValue(b.createdAt) - dateValue(a.createdAt))
    .slice(0, 8);
  $: triggerRows = [...(snapshot?.triggers ?? [])]
    .sort((a, b) => dateValue(a.nextRunAt) - dateValue(b.nextRunAt) || a.label.localeCompare(b.label))
    .slice(0, 8);
  $: sourceRows = [...(snapshot?.sources ?? [])].sort(
    (a, b) => sourceStatusRank(a) - sourceStatusRank(b) || a.label.localeCompare(b.label)
  );
  $: nextRuns = [...(snapshot?.tasks ?? [])]
    .filter((task) => task.nextRunAt && task.status !== 'cancelled')
    .sort((a, b) => dateValue(a.nextRunAt) - dateValue(b.nextRunAt))
    .slice(0, 8);

  function dateValue(value: string | undefined): number {
    if (!value) return Number.POSITIVE_INFINITY;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
  }

  function displayWhen(value: string | undefined): string {
    if (!value) return 'Not scheduled';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    }).format(date);
  }

  function displayDuration(run: PassiveRun): string {
    if (typeof run.durationMs !== 'number') return '';
    if (run.durationMs < 1000) return `${run.durationMs} ms`;
    return `${(run.durationMs / 1000).toFixed(1)} s`;
  }

  function displayInterval(ms: number | undefined): string {
    if (!ms) return 'Not scheduled';
    if (ms < 60_000) return `${Math.round(ms / 1000)} sec`;
    return `${Math.round(ms / 60_000)} min`;
  }

  function workerStateLabel(): string {
    if (!worker?.startedAt) return 'Not started';
    if (!worker.enabled) return 'Disabled';
    return worker.running ? 'Running' : 'Idle';
  }

  function workerIdleLine(): string {
    if (!worker?.lastIdle) return 'No idle probe yet';
    const idle = worker.lastIdle.idle ? 'idle' : 'active';
    const minutes = typeof worker.lastIdle.idleMinutes === 'number' ? ` ${Math.round(worker.lastIdle.idleMinutes)} min` : '';
    const errorText = worker.lastIdle.error ? ` - ${worker.lastIdle.error}` : '';
    return `${idle}${minutes} via ${worker.lastIdle.source}${errorText}`;
  }

  function triggerCadence(trigger: PassiveTrigger): string {
    if (trigger.kind === 'schedule') return trigger.intervalMinutes ? `Every ${trigger.intervalMinutes} min` : 'Scheduled';
    if (trigger.kind === 'idle') return trigger.idleMinutes ? `Idle ${trigger.idleMinutes} min` : 'Idle window';
    if (trigger.kind === 'event') {
      const aliases = Array.isArray(trigger.metadata.eventNames)
        ? trigger.metadata.eventNames.filter((value): value is string => typeof value === 'string')
        : [];
      return [trigger.eventName, ...aliases].filter(Boolean).slice(0, 3).join(', ') || 'Event';
    }
    return 'Manual';
  }

  function triggerLastLine(trigger: PassiveTrigger): string {
    const status = trigger.lastStatus ? passiveRunStatusLabel(trigger.lastStatus) : 'not fired yet';
    const when = trigger.lastFiredAt ? displayWhen(trigger.lastFiredAt) : '';
    return when ? `${status} - ${when}` : status;
  }

  function runMode(run: PassiveRun): string {
    const mode = run.metadata.machineMode;
    return typeof mode === 'string' && mode.trim() ? mode : '';
  }

  function latestTaskError(task: PassiveTask): string {
    const latest = task.errorLog[0];
    if (!latest) return '';
    const retry = latest.nextRetryAt ? ` Retry ${displayWhen(latest.nextRetryAt)}.` : '';
    return `${displayWhen(latest.at)}: ${latest.message}${retry}`;
  }

  function canRunTask(task: PassiveTask, watcher: PassiveWatcher | undefined): boolean {
    if (!settings?.enabled || !watcher?.enabled) return false;
    if (settings.enabledFamilies[task.family] === false) return false;
    return !['paused', 'cancelled', 'running'].includes(task.status);
  }

  function buildFamilyRows(nextSnapshot: PassiveSnapshot | null, nextSettings: typeof settings): PassiveFamilyRow[] {
    if (!nextSnapshot || !nextSettings) return [];
    return nextSnapshot.watchers.map((watcher) => {
      const tasks = nextSnapshot.tasks.filter((task) => task.watcherId === watcher.id);
      return {
        family: watcher.family,
        label: passiveFamilyLabel(watcher.family),
        description: watcher.description,
        watcherEnabled: watcher.enabled,
        familyEnabled: nextSettings.enabledFamilies[watcher.family] !== false,
        taskCount: tasks.length,
        activeTaskCount: tasks.filter((task) => task.status === 'active' || task.status === 'failed' || task.status === 'blocked').length
      };
    });
  }

  function compactHash(value: unknown): string {
    return typeof value === 'string' && value.length >= 12 ? value.slice(0, 12) : '';
  }

  function formatBytes(value: unknown): string {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '';
    if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
    if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${value} B`;
  }

  function formatMinutes(value: number): string {
    if (value >= 24 * 60) return `${Math.round(value / (24 * 60))} d`;
    if (value >= 60) return `${Math.round(value / 60)} hr`;
    return `${Math.max(0, Math.round(value))} min`;
  }

  function formatHours(value: number | undefined): string {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a';
    if (value >= 48) return `${Math.round(value / 24)} d old`;
    if (value >= 1) return `${Math.round(value)} hr old`;
    return '<1 hr old';
  }

  function fileName(value: string | undefined): string {
    if (!value) return 'None';
    const parts = value.split(/[\\/]/u).filter(Boolean);
    return parts[parts.length - 1] ?? value;
  }

  function backupStatusLabel(health: PassiveBackupHealth): string {
    if (health.status === 'ok') return 'Verified';
    if (health.status === 'warning') return health.stale ? 'Stale' : 'Review';
    return 'Needs setup';
  }

  function backupStateClass(health: PassiveBackupHealth): string {
    if (health.status === 'ok') return 'ready';
    if (health.status === 'warning') return 'paused';
    return 'error';
  }

  function backupLatestLine(health: PassiveBackupHealth): string {
    if (!health.latestPath) return 'No restore point found';
    return `${fileName(health.latestPath)} - ${formatHours(health.latestAgeHours)}`;
  }

  function backupVerifyLine(health: PassiveBackupHealth): string {
    const parts: string[] = [];
    if (health.latestBytes !== undefined) parts.push(formatBytes(health.latestBytes));
    if (health.latestSha256) parts.push(`sha ${compactHash(health.latestSha256)}`);
    if (health.latestRedactedTokenSets) parts.push(`${health.latestRedactedTokenSets} redacted token set${health.latestRedactedTokenSets === 1 ? '' : 's'}`);
    return parts.join(' - ') || 'Verification not available';
  }

  function backupSummaryLine(health: PassiveBackupHealth): string {
    const entries = Object.entries(health.latestSummary)
      .filter(([, count]) => typeof count === 'number' && count > 0)
      .slice(0, 5)
      .map(([key, count]) => `${key} ${count}`);
    return entries.join(' - ') || 'No entity summary yet';
  }

  function backupCleanupLine(health: PassiveBackupHealth): string {
    if (!health.cleanupCandidateCount) return 'No stale snapshot/log/temp cleanup candidates';
    return `${health.cleanupCandidateCount} dry-run candidate${health.cleanupCandidateCount === 1 ? '' : 's'} - ${formatBytes(health.cleanupBytes)}`;
  }

  function asNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  function sourceStatusRank(source: PassiveSourceStatus): number {
    if (source.status === 'error') return 0;
    if (source.status === 'unavailable') return 1;
    return 2;
  }

  function sourceStateClass(source: PassiveSourceStatus): string {
    if (source.status === 'ok') return 'ready';
    if (source.status === 'unavailable') return 'paused';
    return 'error';
  }

  function sourceDetailsLine(source: PassiveSourceStatus): string {
    const details = source.details ?? {};
    const parts: string[] = [];
    const state = typeof details.scheduleState === 'string' ? details.scheduleState.replaceAll('_', ' ') : '';
    if (state) parts.push(state);
    const lastAge = asNumber(details.lastRunAgeMinutes);
    if (lastAge !== null) parts.push(`last ${formatMinutes(lastAge)} ago`);
    const lag = asNumber(details.scheduleLagMinutes);
    if (lag !== null && lag > 0) parts.push(`lag ${formatMinutes(lag)}`);
    const nextRunAt = typeof details.nextRunAt === 'string' ? details.nextRunAt : '';
    if (nextRunAt) parts.push(`next ${displayWhen(nextRunAt)}`);
    const modeReason = typeof details.modePolicyReason === 'string' ? details.modePolicyReason : '';
    if (modeReason) parts.push(modeReason);
    return parts.join(' - ') || 'No run evidence yet';
  }

  function sourceList(card: PassiveResultCard): string {
    const labels = card.sourceRefs.slice(0, 3).map((source) => source.label).filter(Boolean);
    if (!labels.length) return '';
    return `${labels.join(', ')}${card.sourceRefs.length > labels.length ? ` +${card.sourceRefs.length - labels.length}` : ''}`;
  }

  function cardEvidence(card: PassiveResultCard): string {
    const source = card.sourceRefs[0];
    const metadata = source?.metadata ?? {};
    const parts: string[] = [];
    if (metadata.verified === true) parts.push('verified');
    const bytes = formatBytes(metadata.bytes ?? metadata.size);
    if (bytes) parts.push(bytes);
    const sha = compactHash(metadata.sha256);
    if (sha) parts.push(`sha ${sha}`);
    const width = asNumber(metadata.width);
    const height = asNumber(metadata.height);
    if (width && height) parts.push(`${width}x${height}`);
    const pages = asNumber(metadata.pageCountApprox);
    if (pages) parts.push(`~${pages} page${pages === 1 ? '' : 's'}`);
    if (metadata.officePackage === true) parts.push('Office package');
    if (Array.isArray(metadata.tags) && metadata.tags.length) parts.push(`tags ${metadata.tags.slice(0, 4).join(', ')}`);
    if (card.sourceRefs.length > 1) parts.push(`${card.sourceRefs.length} sources`);
    return parts.join(' - ');
  }

  function runEvidence(run: PassiveRun): string {
    const parts: string[] = [];
    if (run.cards.length) parts.push(`${run.cards.length} card${run.cards.length === 1 ? '' : 's'}`);
    if (run.changed.length) parts.push(`${run.changed.length} artifact${run.changed.length === 1 ? '' : 's'}`);
    if (run.metadata.snapshotVerified === true) parts.push('snapshot verified');
    const sha = compactHash(run.metadata.snapshotSha256);
    if (sha) parts.push(`sha ${sha}`);
    const cleanupCandidates = asNumber(run.metadata.cleanupCandidates);
    if (cleanupCandidates) parts.push(`${cleanupCandidates} cleanup candidate${cleanupCandidates === 1 ? '' : 's'}`);
    const indexedFiles = asNumber(run.metadata.indexedFiles);
    if (indexedFiles) parts.push(`${indexedFiles} indexed file${indexedFiles === 1 ? '' : 's'}`);
    const fileCount = asNumber(run.metadata.fileCount);
    if (fileCount) parts.push(`${fileCount} file${fileCount === 1 ? '' : 's'} scanned`);
    const ignoredAccounts = asNumber(run.metadata.ignoredIntegrationConnectionIssues);
    if (ignoredAccounts) parts.push(`${ignoredAccounts} ignored account issue${ignoredAccounts === 1 ? '' : 's'}`);
    return parts.join(' - ');
  }

  function syncEditor(next: PassiveSnapshot): void {
    snapshot = next;
    folderText = next.settings.watchedFolders.join('\n');
    domainText = next.settings.watchedDomains.join('\n');
    accountText = next.settings.watchedAccounts.join('\n');
  }

  async function load(): Promise<void> {
    loading = true;
    error = '';
    try {
      syncEditor(await getPassiveSnapshot());
    } catch (err) {
      error = err instanceof Error ? err.message : 'Passive task snapshot failed to load.';
    } finally {
      loading = false;
    }
  }

  async function applyAction(id: string, action: () => Promise<PassiveSnapshot>, success: string): Promise<void> {
    busyId = id;
    error = '';
    message = '';
    try {
      syncEditor(await action());
      message = success;
      attentionStore.invalidate();
    } catch (err) {
      error = err instanceof Error ? err.message : 'Passive task action failed.';
    } finally {
      busyId = '';
    }
  }

  function splitLines(value: string): string[] {
    return value
      .split(/\r?\n|,/u)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  async function saveSettings(): Promise<void> {
    if (!settings) return;
    await applyAction(
      'settings',
      () =>
        patchPassiveSettings({
          watchedFolders: splitLines(folderText),
          watchedDomains: splitLines(domainText),
          watchedAccounts: splitLines(accountText)
        }),
      'Passive task settings saved.'
    );
  }

  async function toggleEngine(): Promise<void> {
    if (!settings) return;
    await applyAction(
      'engine',
      () => patchPassiveSettings({ enabled: !settings.enabled }),
      settings.enabled ? 'Passive task engine paused.' : 'Passive task engine enabled.'
    );
  }

  async function setNotificationStyle(value: 'digest' | 'urgent_only' | 'off'): Promise<void> {
    await applyAction('notification-style', () => patchPassiveSettings({ notificationStyle: value }), 'Notification style saved.');
  }

  async function setResourceLimit(value: 'light' | 'balanced' | 'heavy'): Promise<void> {
    await applyAction('resource-limit', () => patchPassiveSettings({ resourceLimit: value }), 'Resource limit saved.');
  }

  async function setIdleOnly(value: boolean): Promise<void> {
    await applyAction(
      'idle-only',
      () => patchPassiveSettings({ idleOnly: value }),
      value ? 'Passive tasks will wait for idle windows.' : 'Passive tasks can run on their normal schedule.'
    );
  }

  async function setLocalAiPreference(value: 'local_first' | 'local_only' | 'cloud_allowed'): Promise<void> {
    await applyAction('ai-preference', () => patchPassiveSettings({ localAiPreference: value }), 'AI preference saved.');
  }

  async function setMaxRunsPerTick(value: number): Promise<void> {
    const next = Math.max(1, Math.min(10, Math.round(value) || 1));
    await applyAction('max-runs', () => patchPassiveSettings({ maxRunsPerTick: next }), 'Run limit saved.');
  }

  async function setFamilyEnabled(family: PassiveTaskFamily, enabled: boolean): Promise<void> {
    await applyAction(
      `family:${family}`,
      () => patchPassiveSettings({ enabledFamilies: { [family]: enabled } }),
      `${passiveFamilyLabel(family)} ${enabled ? 'enabled' : 'disabled'}.`
    );
  }

  function nextSnoozeUntil(hours = 24): string {
    return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
  }

  async function triageCard(
    cardId: string,
    status: 'reviewed' | 'dismissed' | 'snoozed' | 'important'
  ): Promise<void> {
    await applyAction(
      `card:${status}:${cardId}`,
      () =>
        triagePassiveCard(cardId, {
          status,
          reason: 'dashboard',
          ...(status === 'snoozed' ? { snoozedUntil: nextSnoozeUntil() } : {})
        }),
      status === 'important'
        ? 'Passive card marked important.'
        : status === 'reviewed'
          ? 'Passive card marked reviewed.'
          : status === 'snoozed'
            ? 'Passive card snoozed for 24 hours.'
            : 'Passive card dismissed.'
    );
  }

  function cardSource(card: PassiveResultCard): string {
    return card.sourceRefs[0]?.label ?? passiveFamilyLabel(card.family);
  }

  onMount(() => {
    void load();
  });
</script>

<section class="page-header passive-header">
  <div>
    <p class="eyebrow">Personal AI OS</p>
    <h1>Passive Tasks</h1>
  </div>
  <div class="header-actions">
    <button class="button" type="button" disabled={loading || Boolean(busyId)} on:click={load}>
      <RefreshCw size={16} />
      <span>{loading ? 'Loading' : 'Refresh'}</span>
    </button>
    <button class="button" type="button" disabled={Boolean(busyId)} on:click={() => applyAction('tick', () => runPassiveTick({ reason: 'manual-dashboard' }), 'Due passive tasks checked.')}>
      <Clock3 size={16} />
      <span>Run Due</span>
    </button>
    <button class="button" type="button" disabled={Boolean(busyId)} on:click={() => applyAction('event-startup', () => runPassiveEvent('app.startup', { reason: 'manual-startup-dashboard' }), 'Startup event watchers checked.')}>
      <RefreshCw size={16} />
      <span>Startup Event</span>
    </button>
    <button class="button" type="button" disabled={Boolean(busyId)} on:click={() => applyAction('idle-tick', () => runPassiveTick({ idle: true, reason: 'manual-idle-dashboard' }), 'Idle-capable passive tasks checked.')}>
      <Play size={16} />
      <span>Idle Tick</span>
    </button>
  </div>
</section>

{#if error}
  <section class="card card-pad warning-panel">{error}</section>
{:else if message}
  <section class="card card-pad success-panel">{message}</section>
{/if}

<section class="signal-strip" aria-label="Passive task signals">
  <div>
    <span>Engine</span>
    <strong>{settings?.enabled ? 'On' : 'Off'}</strong>
  </div>
  <div>
    <span>Schedule</span>
    <strong>{settings?.idleOnly ? 'Idle only' : 'Normal'}</strong>
  </div>
  <div>
    <span>Worker</span>
    <strong>{workerStateLabel()}</strong>
  </div>
  <div>
    <span>Backups</span>
    <strong>{backupHealth ? backupStatusLabel(backupHealth) : 'n/a'}</strong>
  </div>
  <div>
    <span>Triggers</span>
    <strong>{snapshot?.triggers.length ?? 0}</strong>
  </div>
  <div>
    <span>Active</span>
    <strong>{activeTasks.length}</strong>
  </div>
  <div>
    <span>Paused</span>
    <strong>{pausedTasks.length}</strong>
  </div>
  <div>
    <span>Failures</span>
    <strong>{failedRuns.length}</strong>
  </div>
  <div>
    <span>Digest</span>
    <strong>{digestCards.length}</strong>
  </div>
  <div>
    <span>Results</span>
    <strong>{snapshot?.results.length ?? 0}</strong>
  </div>
</section>

<section class="dashboard-grid">
  <div class="main-column">
    <article class="card panel">
      <div class="panel-title">
        <div>
          <span class="icon-chip"><Bell size={16} /></span>
          <strong>Quiet Digest</strong>
        </div>
        <a class="button compact" href={hubHref('/')}>Today</a>
      </div>
      {#if digestCards.length}
        <div class="digest-list">
          {#each digestCards as card}
            <div class="digest-row">
              <span class={`urgency ${passiveUrgencyLabel(card.urgency)}`}>{passiveUrgencyLabel(card.urgency)}</span>
              <span class="digest-main">
                <strong>{card.title}</strong>
                <small>{card.summary}</small>
                <em>{cardSource(card)} - confidence {Math.round(card.confidence * 100)}%</em>
                {#if sourceList(card)}
                  <small class="evidence-line">Sources: {sourceList(card)}</small>
                {/if}
                {#if cardEvidence(card)}
                  <small class="evidence-line">{cardEvidence(card)}</small>
                {/if}
              </span>
              <span class="digest-actions">
                <button class="icon-action" type="button" title="Mark important" disabled={Boolean(busyId)} on:click={() => triageCard(card.id, 'important')}>
                  <Star size={15} />
                </button>
                <button class="icon-action" type="button" title="Snooze 24 hours" disabled={Boolean(busyId)} on:click={() => triageCard(card.id, 'snoozed')}>
                  <Clock3 size={15} />
                </button>
                <button class="icon-action" type="button" title="Mark reviewed" disabled={Boolean(busyId)} on:click={() => triageCard(card.id, 'reviewed')}>
                  <CheckCircle2 size={15} />
                </button>
                <button class="icon-action" type="button" title="Dismiss" disabled={Boolean(busyId)} on:click={() => triageCard(card.id, 'dismissed')}>
                  <XCircle size={15} />
                </button>
                <a class="button compact" href={hubHref(card.route)}>Inspect</a>
              </span>
            </div>
          {/each}
        </div>
      {:else if loading}
        <p class="empty-note">Loading passive task outputs...</p>
      {:else}
        <p class="empty-note">No passive task cards yet. Run due tasks or configure folders/research monitors to create source-backed outputs.</p>
      {/if}
    </article>

    <article class="card panel">
      <div class="panel-title">
        <div>
          <span class="icon-chip"><CheckCircle2 size={16} /></span>
          <strong>Recent Results</strong>
        </div>
      </div>
      {#if resultRows.length}
        <div class="run-list">
          {#each resultRows as result}
            <div class="run-row result-row">
              <span class={`urgency ${passiveUrgencyLabel(result.urgency)}`}>{passiveUrgencyLabel(result.urgency)}</span>
              <span>
                <strong>{result.title}</strong>
                <small>{result.summary}</small>
                <small>{passiveFamilyLabel(result.family)} - confidence {Math.round(result.confidence * 100)}%</small>
                {#if sourceList(result)}
                  <small class="evidence-line">Sources: {sourceList(result)}</small>
                {/if}
                {#if cardEvidence(result)}
                  <small class="evidence-line">{cardEvidence(result)}</small>
                {/if}
              </span>
            </div>
          {/each}
        </div>
      {:else}
        <p class="empty-note">No passive results have been persisted yet.</p>
      {/if}
    </article>

    <article class="card panel">
      <div class="panel-title">
        <div>
          <span class="icon-chip"><CheckCircle2 size={16} /></span>
          <strong>Source Health</strong>
        </div>
      </div>
      {#if sourceRows.length}
        <div class="run-list">
          {#each sourceRows as source}
            <div class="run-row">
              <span class={`state ${sourceStateClass(source)}`}>{source.status === 'unavailable' ? 'off' : source.status}</span>
              <span>
                <strong>{source.label}</strong>
                <small>{sourceDetailsLine(source)}</small>
                {#if source.fetchedAt}
                  <small class="evidence-line">fetched {displayWhen(source.fetchedAt)}</small>
                {/if}
                {#if source.error}
                  <small class="error-inline">{source.error}</small>
                {/if}
              </span>
            </div>
          {/each}
        </div>
      {:else}
        <p class="empty-note">Source health appears after passive tasks are registered.</p>
      {/if}
    </article>

    <article class="card panel">
      <div class="panel-title">
        <div>
          <span class="icon-chip"><Clock3 size={16} /></span>
          <strong>Triggers</strong>
        </div>
      </div>
      {#if triggerRows.length}
        <div class="run-list">
          {#each triggerRows as trigger}
            {@const watcher = trigger.watcherId ? watchersById.get(trigger.watcherId) : undefined}
            <div class="run-row">
              <span class={`state ${trigger.enabled ? 'ready' : 'paused'}`}>{trigger.kind}</span>
              <span>
                <strong>{trigger.label}</strong>
                <small>{watcher?.title ?? trigger.watcherId ?? 'Unlinked watcher'} - {triggerCadence(trigger)}</small>
                <small>{triggerLastLine(trigger)}{trigger.nextRunAt ? ` - next ${displayWhen(trigger.nextRunAt)}` : ''}</small>
                {#if trigger.error}
                  <small class="error-inline">{trigger.error}</small>
                {/if}
              </span>
            </div>
          {/each}
        </div>
      {:else}
        <p class="empty-note">No passive triggers are registered yet.</p>
      {/if}
    </article>

    <article class="card panel">
      <div class="panel-title">
        <div>
          <span class="icon-chip"><CheckCircle2 size={16} /></span>
          <strong>Active Watchers</strong>
        </div>
        <button class="button compact" type="button" disabled={!settings || Boolean(busyId)} on:click={toggleEngine}>
          {settings?.enabled ? 'Pause Engine' : 'Enable Engine'}
        </button>
      </div>
      {#if snapshot?.watchers.length}
        <div class="watcher-list">
          {#each snapshot.watchers as watcher}
            <div class="watcher-row">
              <span class={`state ${watcher.enabled ? 'ready' : 'paused'}`}>{watcher.enabled ? 'on' : 'off'}</span>
              <span class="watcher-main">
                <strong>{watcher.title}</strong>
                <small>{watcher.description}</small>
              </span>
              <button class="button compact" type="button" disabled={Boolean(busyId)} on:click={() => applyAction(`watcher:${watcher.id}`, () => togglePassiveWatcher(watcher.id, !watcher.enabled), `${watcher.title} ${watcher.enabled ? 'disabled' : 'enabled'}.`)}>
                {watcher.enabled ? 'Disable' : 'Enable'}
              </button>
            </div>
          {/each}
        </div>
      {:else}
        <p class="empty-note">No passive watchers are registered yet.</p>
      {/if}
    </article>

    <article class="card panel">
      <div class="panel-title">
        <div>
          <span class="icon-chip"><Clock3 size={16} /></span>
          <strong>Next Scheduled Runs</strong>
        </div>
      </div>
      {#if nextRuns.length}
        <table>
          <thead>
            <tr>
              <th>Task</th>
              <th>Family</th>
              <th>Next</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {#each nextRuns as task}
              {@const watcher = watchersById.get(task.watcherId)}
              <tr>
                <td>
                  <strong>{task.title}</strong>
                  <small>{task.detail}</small>
                  {#if latestTaskError(task)}
                    <small class="error-inline">{latestTaskError(task)}</small>
                  {/if}
                </td>
                <td>{passiveFamilyLabel(task.family)}</td>
                <td>{displayWhen(task.nextRunAt)}</td>
                <td><span class={`state ${task.status}`}>{task.status}</span></td>
                <td class="table-actions">
                  <button class="icon-action" type="button" title="Run now" disabled={Boolean(busyId) || !canRunTask(task, watcher)} on:click={() => applyAction(`run:${task.id}`, () => runPassiveTask(task.id, { idle: task.idleOnly, reason: 'dashboard-run' }), `${task.title} ran.`)}>
                    <Play size={15} />
                  </button>
                  {#if task.status === 'paused'}
                    <button class="icon-action" type="button" title="Resume" disabled={Boolean(busyId)} on:click={() => applyAction(`resume:${task.id}`, () => resumePassiveTask(task.id), `${task.title} resumed.`)}>
                      <Play size={15} />
                    </button>
                  {:else}
                    <button class="icon-action" type="button" title="Pause" disabled={Boolean(busyId) || !watcher?.enabled} on:click={() => applyAction(`pause:${task.id}`, () => pausePassiveTask(task.id), `${task.title} paused.`)}>
                      <Pause size={15} />
                    </button>
                  {/if}
                  <button class="icon-action danger" type="button" title="Cancel" disabled={Boolean(busyId)} on:click={() => applyAction(`cancel:${task.id}`, () => cancelPassiveTask(task.id), `${task.title} cancelled.`)}>
                    <XCircle size={15} />
                  </button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {:else}
        <p class="empty-note">No scheduled passive task runs are due or configured.</p>
      {/if}
    </article>
  </div>

  <aside class="side-column">
    <article class="card panel">
      <div class="panel-title">
        <div>
          <span class="icon-chip"><FolderOpen size={16} /></span>
          <strong>Restore Points</strong>
        </div>
        <a class="button compact" href={hubHref('/settings')}>Settings</a>
      </div>
      {#if backupHealth}
        <div class="worker-grid">
          <span>
            <small>Status</small>
            <strong><span class={`state ${backupStateClass(backupHealth)}`}>{backupStatusLabel(backupHealth)}</span></strong>
          </span>
          <span>
            <small>Snapshots</small>
            <strong>{backupHealth.snapshotCount}</strong>
          </span>
          <span>
            <small>Latest</small>
            <strong>{backupLatestLine(backupHealth)}</strong>
          </span>
          <span>
            <small>Verification</small>
            <strong>{backupVerifyLine(backupHealth)}</strong>
          </span>
          <span>
            <small>Contents</small>
            <strong>{backupSummaryLine(backupHealth)}</strong>
          </span>
          <span>
            <small>Cleanup dry-run</small>
            <strong>{backupCleanupLine(backupHealth)}</strong>
          </span>
          {#if backupHealth.error}
            <span class="worker-error">
              <small>Issue</small>
              <strong>{backupHealth.error}</strong>
            </span>
          {/if}
        </div>
      {:else}
        <p class="empty-note">Restore point health appears after the passive snapshot loads.</p>
      {/if}
    </article>

    <article class="card panel">
      <div class="panel-title">
        <div>
          <span class="icon-chip"><Activity size={16} /></span>
          <strong>Worker</strong>
        </div>
      </div>
      {#if worker}
        <div class="worker-grid">
          <span>
            <small>State</small>
            <strong>{workerStateLabel()}</strong>
          </span>
          <span>
            <small>Interval</small>
            <strong>{displayInterval(worker.intervalMs)}</strong>
          </span>
          <span>
            <small>Last tick</small>
            <strong>{displayWhen(worker.lastTickFinishedAt ?? worker.lastTickAt)}</strong>
          </span>
          <span>
            <small>Next tick</small>
            <strong>{displayWhen(worker.nextTickAt)}</strong>
          </span>
          <span>
            <small>Idle probe</small>
            <strong>{workerIdleLine()}</strong>
          </span>
          <span>
            <small>File watchers</small>
            <strong>{worker.activeFileWatchCount}{worker.pendingFileEvent ? ' + pending file event' : ''}</strong>
          </span>
          {#if worker.lastError}
            <span class="worker-error">
              <small>Last worker issue</small>
              <strong>{worker.lastError}</strong>
            </span>
          {/if}
        </div>
      {:else}
        <p class="empty-note">Worker state appears after the API starts the passive task worker.</p>
      {/if}
    </article>

    <article class="card panel">
      <div class="panel-title">
        <div>
          <span class="icon-chip"><AlertTriangle size={16} /></span>
          <strong>Failures</strong>
        </div>
      </div>
      {#if failedRuns.length}
        <div class="run-list">
          {#each failedRuns.slice(0, 6) as run}
            <div class="run-row">
              <span class={`state ${run.status}`}>{passiveRunStatusLabel(run.status)}</span>
              <span>
                <strong>{passiveFamilyLabel(run.family)}</strong>
                <small>{run.error ?? run.cards[0]?.summary ?? 'Needs inspection'}</small>
                {#if runEvidence(run)}
                  <small class="evidence-line">{runEvidence(run)}</small>
                {/if}
              </span>
            </div>
          {/each}
        </div>
      {:else}
        <p class="empty-note">No passive task failures are visible.</p>
      {/if}
    </article>

    <article class="card panel">
      <div class="panel-title">
        <div>
          <span class="icon-chip"><AlertTriangle size={16} /></span>
          <strong>Task Error Logs</strong>
        </div>
      </div>
      {#if tasksWithErrorLogs.length}
        <div class="run-list">
          {#each tasksWithErrorLogs as task}
            <div class="run-row">
              <span class={`state ${task.status}`}>{task.status}</span>
              <span>
                <strong>{task.title}</strong>
                <small>{latestTaskError(task)}</small>
                {#if task.errorLog.length > 1}
                  <small class="evidence-line">{task.errorLog.length} retained error entries</small>
                {/if}
              </span>
            </div>
          {/each}
        </div>
      {:else}
        <p class="empty-note">No task error logs are retained right now.</p>
      {/if}
    </article>

    <article class="card panel">
      <div class="panel-title">
        <div>
          <span class="icon-chip"><Play size={16} /></span>
          <strong>Recent Runs</strong>
        </div>
      </div>
      {#if snapshot?.runs.length}
        <div class="run-list">
          {#each snapshot.runs.slice(0, 8) as run}
            <div class="run-row">
              <span class={`state ${run.status}`}>{passiveRunStatusLabel(run.status)}</span>
              <span>
                <strong>{passiveFamilyLabel(run.family)}</strong>
                <small>{displayWhen(run.finishedAt ?? run.startedAt)} {displayDuration(run)}{runMode(run) ? ` - ${runMode(run)}` : ''}</small>
                {#if runEvidence(run)}
                  <small class="evidence-line">{runEvidence(run)}</small>
                {/if}
              </span>
            </div>
          {/each}
        </div>
      {:else}
        <p class="empty-note">Run history will appear after the worker or dashboard runs a task.</p>
      {/if}
    </article>

    <article class="card panel">
      <div class="panel-title">
        <div>
          <span class="icon-chip"><Bell size={16} /></span>
          <strong>Notifications</strong>
        </div>
      </div>
      {#if notifications.length}
        <div class="run-list">
          {#each notifications as notification}
            <div class="notification-row">
              <span class={`state ${notification.level}`}>{notification.level}</span>
              <span>
                <strong>{notification.title}</strong>
                <small>{notification.body}</small>
              </span>
              <button class="icon-action" type="button" title="Dismiss" disabled={Boolean(busyId)} on:click={() => applyAction(`dismiss:${notification.id}`, () => dismissPassiveNotification(notification.id), 'Notification dismissed.')}>
                <XCircle size={15} />
              </button>
            </div>
          {/each}
        </div>
      {:else}
        <p class="empty-note">No active passive notifications.</p>
      {/if}
    </article>

    <article class="card panel">
      <div class="panel-title">
        <div>
          <span class="icon-chip"><Settings size={16} /></span>
          <strong>Settings</strong>
        </div>
        <button class="button compact" type="button" disabled={Boolean(busyId)} on:click={saveSettings}>Save</button>
      </div>
      {#if settings}
        <div class="settings-form">
          <label class="field">
            <span>Notifications</span>
            <select value={settings.notificationStyle} on:change={(event) => setNotificationStyle(event.currentTarget.value as 'digest' | 'urgent_only' | 'off')}>
              <option value="digest">Digest</option>
              <option value="urgent_only">Urgent only</option>
              <option value="off">Off</option>
            </select>
          </label>
          <label class="field">
            <span>Resource limit</span>
            <select value={settings.resourceLimit} on:change={(event) => setResourceLimit(event.currentTarget.value as 'light' | 'balanced' | 'heavy')}>
              <option value="light">Light</option>
              <option value="balanced">Balanced</option>
              <option value="heavy">Heavy</option>
            </select>
          </label>
          <label class="check-field">
            <input
              type="checkbox"
              checked={settings.idleOnly}
              disabled={Boolean(busyId)}
              on:change={(event) => setIdleOnly(event.currentTarget.checked)}
            />
            <span>
              <strong>Idle-only schedule</strong>
              <small>Scheduled work waits for an idle tick unless run manually.</small>
            </span>
          </label>
          <label class="field">
            <span>AI preference</span>
            <select value={settings.localAiPreference} on:change={(event) => setLocalAiPreference(event.currentTarget.value as 'local_first' | 'local_only' | 'cloud_allowed')}>
              <option value="local_first">Local first</option>
              <option value="local_only">Local only</option>
              <option value="cloud_allowed">Cloud allowed</option>
            </select>
          </label>
          <label class="field">
            <span>Max runs per tick</span>
            <input
              type="number"
              min="1"
              max="10"
              value={settings.maxRunsPerTick}
              on:change={(event) => setMaxRunsPerTick(Number(event.currentTarget.value))}
            />
          </label>
          <div class="family-control-grid" aria-label="Passive task family controls">
            {#each familyRows as family}
              <label class="family-control-row">
                <input
                  type="checkbox"
                  checked={family.familyEnabled}
                  disabled={Boolean(busyId)}
                  on:change={(event) => setFamilyEnabled(family.family, event.currentTarget.checked)}
                />
                <span>
                  <strong>{family.label}</strong>
                  <small>{family.description}</small>
                  <em>{family.activeTaskCount}/{family.taskCount} runnable - watcher {family.watcherEnabled ? 'on' : 'off'}</em>
                </span>
              </label>
            {/each}
          </div>
          <label class="field">
            <span>Watched folders</span>
            <textarea bind:value={folderText} rows="4" placeholder="C:\Users\Edward\Downloads"></textarea>
          </label>
          <label class="field">
            <span>Watched domains</span>
            <textarea bind:value={domainText} rows="3" placeholder="example.com"></textarea>
          </label>
          <label class="field">
            <span>Watched accounts</span>
            <textarea bind:value={accountText} rows="3" placeholder="personal@example.com"></textarea>
          </label>
          <p class="settings-note">
            <FolderOpen size={15} />
            Folder and project scans only use paths listed here.
          </p>
        </div>
      {:else}
        <p class="empty-note">Settings load with the passive snapshot.</p>
      {/if}
    </article>
  </aside>
</section>

<style>
  .passive-header {
    align-items: center;
  }

  .passive-header h1 {
    font-size: 22px;
    letter-spacing: 0;
  }

  .header-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .warning-panel,
  .success-panel {
    margin-bottom: 10px;
  }

  .warning-panel {
    border-color: var(--warning-border);
    color: var(--warning-text);
    background: var(--warning-bg);
  }

  .success-panel {
    border-color: var(--success-border);
    color: var(--success-text);
    background: var(--success-bg);
  }

  .signal-strip {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 8px;
    margin-bottom: 10px;
  }

  .signal-strip div {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 38px;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface);
  }

  .signal-strip span {
    color: var(--muted);
    font-weight: 700;
  }

  .signal-strip strong {
    font-size: 18px;
  }

  .dashboard-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.35fr) minmax(310px, 0.8fr);
    gap: 10px;
    align-items: start;
  }

  .main-column,
  .side-column {
    display: grid;
    gap: 10px;
    min-width: 0;
  }

  .panel {
    min-width: 0;
    overflow: hidden;
  }

  .panel-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    min-height: 40px;
    padding: 9px 10px;
    border-bottom: 1px solid var(--border);
  }

  .panel-title > div {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .icon-chip {
    display: grid;
    width: 26px;
    height: 26px;
    place-items: center;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    background: var(--surface-muted);
  }

  .button.compact {
    min-height: 26px;
    padding: 3px 7px;
    font-size: 12px;
  }

  .empty-note {
    margin: 0;
    padding: 12px;
    color: var(--muted);
  }

  .digest-list,
  .watcher-list,
  .run-list {
    display: grid;
  }

  .digest-row,
  .watcher-row,
  .run-row,
  .notification-row {
    display: grid;
    gap: 9px;
    align-items: center;
    min-height: 58px;
    padding: 9px 10px;
    border-bottom: 1px solid var(--border);
  }

  .digest-row {
    grid-template-columns: 72px minmax(0, 1fr) auto;
  }

  .digest-actions {
    display: inline-flex;
    align-items: center;
    justify-content: flex-end;
    gap: 5px;
    min-width: 0;
  }

  .watcher-row {
    grid-template-columns: 58px minmax(0, 1fr) auto;
  }

  .run-row {
    grid-template-columns: 78px minmax(0, 1fr);
  }

  .notification-row {
    grid-template-columns: 78px minmax(0, 1fr) 30px;
  }

  .digest-main,
  .watcher-main,
  .run-row span:last-child,
  .notification-row span:nth-child(2),
  td {
    display: grid;
    gap: 3px;
    min-width: 0;
  }

  .digest-main strong,
  .digest-main small,
  .digest-main em,
  .watcher-main strong,
  .watcher-main small,
  .run-row strong,
  .run-row small,
  .notification-row strong,
  .notification-row small,
  td strong,
  td small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .digest-main small,
  .digest-main em,
  .watcher-main small,
  .run-row small,
  .notification-row small,
  td small {
    color: var(--muted);
  }

  .digest-main .evidence-line,
  .run-row .evidence-line {
    white-space: normal;
    line-height: 1.35;
    color: var(--muted);
  }

  td small.error-inline,
  .run-row small.error-inline {
    color: var(--danger-text);
  }

  .digest-main em {
    font-style: normal;
    font-size: 12px;
  }

  .state,
  .urgency {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: fit-content;
    min-width: 56px;
    min-height: 22px;
    padding: 2px 7px;
    border: 1px solid var(--border);
    border-radius: 999px;
    color: var(--muted);
    background: var(--surface-muted);
    font-size: 11px;
    font-weight: 850;
    white-space: nowrap;
  }

  .state.ready,
  .state.succeeded,
  .state.success {
    border-color: var(--success-border);
    color: var(--success-text);
    background: var(--success-bg);
  }

  .state.running,
  .state.queued,
  .state.warning,
  .urgency.high,
  .urgency.watch {
    border-color: var(--warning-border);
    color: var(--warning-text);
    background: var(--warning-bg);
  }

  .state.failed,
  .state.blocked,
  .state.error,
  .state.urgent,
  .urgency.urgent {
    border-color: var(--error-border);
    color: var(--error-text);
    background: var(--error-bg);
  }

  .table-actions {
    display: flex;
    justify-content: flex-end;
    gap: 5px;
  }

  .icon-action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--muted);
    background: var(--surface);
    cursor: pointer;
  }

  .icon-action:hover:not(:disabled) {
    color: var(--text);
    background: var(--active);
  }

  .icon-action.danger {
    color: var(--danger-text);
  }

  .settings-form {
    display: grid;
    gap: 10px;
    padding: 10px;
  }

  .worker-grid {
    display: grid;
    gap: 8px;
    padding: 10px;
  }

  .worker-grid span {
    display: grid;
    gap: 2px;
    min-width: 0;
    padding: 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface-muted);
  }

  .worker-grid small {
    color: var(--muted);
    font-size: 12px;
    font-weight: 800;
  }

  .worker-grid strong {
    overflow: hidden;
    color: var(--text);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .worker-grid .worker-error {
    border-color: var(--error-border);
    background: var(--error-bg);
  }

  .worker-grid .worker-error strong {
    color: var(--error-text);
  }

  .settings-form .field span {
    color: var(--muted);
    font-size: 12px;
    font-weight: 800;
  }

  .family-control-grid {
    display: grid;
    gap: 6px;
  }

  .family-control-row {
    display: grid;
    grid-template-columns: 18px minmax(0, 1fr);
    gap: 8px;
    align-items: start;
    padding: 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface-muted);
  }

  .family-control-row input {
    margin-top: 3px;
  }

  .family-control-row span {
    display: grid;
    gap: 2px;
    min-width: 0;
  }

  .family-control-row strong,
  .family-control-row small,
  .family-control-row em {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .family-control-row strong {
    color: var(--text);
  }

  .family-control-row small,
  .family-control-row em {
    color: var(--muted);
    font-size: 12px;
    font-style: normal;
  }

  .check-field {
    display: grid;
    grid-template-columns: 18px minmax(0, 1fr);
    gap: 8px;
    align-items: start;
    color: var(--muted);
    font-size: 12px;
  }

  .check-field input {
    margin-top: 3px;
  }

  .check-field span {
    display: grid;
    gap: 2px;
  }

  .check-field strong {
    color: var(--text);
    font-size: 13px;
  }

  .check-field small {
    color: var(--muted);
  }

  .settings-note {
    display: flex;
    align-items: center;
    gap: 7px;
    margin: 0;
    color: var(--muted);
    font-size: 12px;
  }

  @media (max-width: 980px) {
    .dashboard-grid {
      grid-template-columns: 1fr;
    }

    .signal-strip {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .digest-row {
      grid-template-columns: 72px minmax(0, 1fr);
    }

    .digest-actions {
      grid-column: 2;
      justify-content: flex-start;
      flex-wrap: wrap;
    }
  }

  @media (max-width: 620px) {
    .signal-strip {
      grid-template-columns: 1fr;
    }

    .digest-row,
    .watcher-row,
    .notification-row {
      grid-template-columns: 1fr;
    }

    .table-actions {
      justify-content: flex-start;
    }
  }
</style>
