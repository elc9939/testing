<script lang="ts">
  import { onMount } from 'svelte';
  import {
    AlertTriangle,
    Bell,
    CheckCircle2,
    Clock3,
    FolderOpen,
    Pause,
    Play,
    RefreshCw,
    Settings,
    XCircle
  } from 'lucide-svelte';
  import type { PassiveResultCard, PassiveRun, PassiveSnapshot, PassiveTask, PassiveWatcher } from '@mini-hub/core';
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

  $: settings = snapshot?.settings ?? null;
  $: watchersById = new Map((snapshot?.watchers ?? []).map((watcher) => [watcher.id, watcher]));
  $: activeTasks = (snapshot?.tasks ?? []).filter((task) =>
    settings ? passiveTaskActive(task, watchersById.get(task.watcherId), settings) : false
  );
  $: pausedTasks = (snapshot?.tasks ?? []).filter((task) => task.status === 'paused' || task.status === 'cancelled');
  $: failedRuns = (snapshot?.runs ?? []).filter((run) => ['failed', 'blocked'].includes(run.status));
  $: digestCards = topPassiveCards(snapshot);
  $: notifications = visiblePassiveNotifications(snapshot);
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
                <em>{cardSource(card)} · confidence {Math.round(card.confidence * 100)}%</em>
              </span>
              <a class="button compact" href={hubHref(card.route)}>Inspect</a>
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
                </td>
                <td>{passiveFamilyLabel(task.family)}</td>
                <td>{displayWhen(task.nextRunAt)}</td>
                <td><span class={`state ${task.status}`}>{task.status}</span></td>
                <td class="table-actions">
                  <button class="icon-action" type="button" title="Run now" disabled={Boolean(busyId)} on:click={() => applyAction(`run:${task.id}`, () => runPassiveTask(task.id, { idle: task.idleOnly, reason: 'dashboard-run' }), `${task.title} ran.`)}>
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
                <small>{displayWhen(run.finishedAt ?? run.startedAt)} {displayDuration(run)}</small>
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
    grid-template-columns: repeat(5, minmax(0, 1fr));
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

  .settings-form .field span {
    color: var(--muted);
    font-size: 12px;
    font-weight: 800;
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
