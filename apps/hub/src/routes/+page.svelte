<script lang="ts">
  import { onMount } from 'svelte';
  import {
    Activity,
    Archive,
    ArrowRight,
    Bell,
    BriefcaseBusiness,
    CalendarClock,
    CheckCircle2,
    Clock3,
    Cpu,
    Database,
    Eye,
    Inbox,
    MailCheck,
    Play,
    RefreshCw,
    RotateCcw,
    Settings,
    Star,
    XCircle
  } from 'lucide-svelte';
  import {
    launcherEntries,
    type ActionLedgerEntry,
    type ActionLedgerRisk,
    type AttentionAction,
    type AttentionActionKind,
    type AttentionItem,
    type AttentionSnapshot,
    type AttentionSource
  } from '@mini-hub/core';
  import { statusLabel } from '@mini-hub/ui';
  import {
    actionLedgerDetail,
    actionLedgerRiskLabel,
    actionLedgerStatusLabel,
    loadActionLedger,
    type ActionLedgerSnapshot
  } from '$lib/action-ledger';
  import {
    attentionActionLabel,
    attentionSourceLabel,
    attentionSourceStatusLine,
    attentionStore
  } from '$lib/attention-store';
  import {
    formatCapabilityRegistrySummary,
    loadCapabilityRegistry,
    selectCapabilityIssues,
    type CapabilityRegistryEntry,
    type CapabilityRegistrySnapshot,
    type CapabilityState
  } from '$lib/capability-registry';
  import {
    createAiBackup,
    createAiJob,
    restoreTestAiBackup,
    runBenchmark,
    verifyAiBackup
  } from '$lib/ai-os-api';
  import { clientData, type ClientDataState } from '$lib/client-data';
  import { machineModeContext, machineModeFromPreferences } from '$lib/machine-mode';
  import { buildModeRecommendations, type ModeRecommendation } from '$lib/mode-recommendations';
  import { recordBrowserAction } from '$lib/browser-action-ledger';
  import { hubHref } from '$lib/routes';

  let capabilitySnapshot: CapabilityRegistrySnapshot | null = null;
  let capabilityLoading = false;
  let capabilityError = '';
  let actionLedgerSnapshot: ActionLedgerSnapshot | null = null;
  let actionLedgerLoading = false;
  let actionLedgerError = '';
  let modeActionBusyId = '';
  let modeActionMessage = '';
  let modeActionError = '';
  let itemActionMessage = '';

  interface TodayRefreshControlState {
    loading: boolean;
    refreshing: boolean;
  }

  $: attentionSnapshot = $attentionStore.snapshot;
  $: attentionItems = attentionSnapshot?.items ?? [];
  $: calendarItems = attentionItems.filter((item) => item.source === 'google_calendar').slice(0, 10);
  $: nowNextItems = calendarItems.slice(0, 3);
  $: priorityQueue = attentionItems
    .filter((item) => item.source !== 'google_calendar')
    .slice(0, 8);
  $: mailItems = attentionItems.filter((item) => item.source === 'gmail').slice(0, 6);
  $: focusItems = attentionItems
    .filter((item) => ['career_action', 'career_job', 'study_signal', 'study_session'].includes(item.source))
    .slice(0, 6);
  $: systemItems = attentionItems
    .filter((item) => ['service_health', 'ai_os', 'macro_lab', 'research', 'passive_task'].includes(item.source) || item.status === 'blocked')
    .slice(0, 7);
  $: sourceIssues = attentionSnapshot?.sources.filter((source) => source.status !== 'ok') ?? [];
  $: googleConnected = snapshotGoogleConnected(attentionSnapshot);
  $: currentMachineMode = machineModeFromPreferences($clientData.settings?.preferences);
  $: capabilityIssues = selectCapabilityIssues(capabilitySnapshot, 5);
  $: modeRecommendations = buildModeRecommendations({
    mode: currentMachineMode,
    capabilitySnapshot,
    attentionCount: attentionItems.length
  });
  $: actionLedgerItems = actionLedgerSnapshot?.actions.slice(0, 6) ?? [];
  $: cachedCoreRows =
    $clientData.jobs.length +
    $clientData.studySessions.length +
    $clientData.careerActions.length +
    $clientData.gameRuns.length +
    $clientData.gameStates.length;
  $: saveStatusLabel = todaySaveStatusLabel($clientData);
  $: saveStatusDetail = todaySaveStatusDetail($clientData);
  $: lastSyncLabel = todayLastSyncLabel($clientData);
  $: todayRefreshControlState = {
    loading: $attentionStore.loading,
    refreshing: $attentionStore.refreshing
  };
  $: todayRefreshButtonTitle = todayRefreshTitle(todayRefreshControlState);
  $: visibleAttentionError = $attentionStore.error ? compactTodayServiceIssue($attentionStore.error) : '';

  function snapshotGoogleConnected(snapshot: AttentionSnapshot | null): boolean {
    if (!snapshot) return false;
    return snapshot.sources.some(
      (source) => ['google_calendar', 'gmail'].includes(source.id) && source.status === 'ok'
    );
  }

  function displayWhen(value: string | undefined): string {
    if (!value) return 'Anytime';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    }).format(date);
  }

  function displayShortDate(value: string | undefined): string {
    if (!value) return 'Anytime';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
  }

  function displayEventTime(item: AttentionItem): string {
    const start = item.dueAt;
    const end = typeof item.metadata.end === 'string' ? item.metadata.end : '';
    if (!start) return 'Anytime';
    if (!start.includes('T')) return 'All day';
    const startDate = new Date(start);
    const endDate = new Date(end);
    if (Number.isNaN(startDate.getTime())) return start;
    const formatter = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
    if (Number.isNaN(endDate.getTime())) return formatter.format(startDate);
    return `${formatter.format(startDate)} - ${formatter.format(endDate)}`;
  }

  function itemMeta(item: AttentionItem): string {
    if (item.dueAt) return displayShortDate(item.dueAt);
    return attentionSourceLabel(item.source);
  }

  function todayCountLabel(value: number): string {
    if ($attentionStore.loading && !attentionSnapshot) return '...';
    if (!attentionSnapshot) return 'n/a';
    return String(value);
  }

  function mailEmptyMessage(): string {
    if ($attentionStore.loading && !attentionSnapshot) return 'Loading Gmail attention from the hub...';
    if (!attentionSnapshot) return 'No attention snapshot has loaded yet.';
    return googleConnected ? 'No priority Gmail threads are active.' : 'Gmail is not connected or could not refresh.';
  }

  function focusEmptyMessage(): string {
    if ($attentionStore.loading && !attentionSnapshot) return 'Loading Career and Study attention from the hub...';
    if (!attentionSnapshot) return 'No attention snapshot has loaded yet.';
    return 'No due career or study signals are active.';
  }

  function systemEmptyMessage(): string {
    if ($attentionStore.loading && !attentionSnapshot) return 'Loading local service and AI OS signals...';
    if (!attentionSnapshot) return 'No attention snapshot has loaded yet.';
    return 'No service, AI OS, Macro Lab, or Research issues are active.';
  }

  function priorityClass(item: AttentionItem): string {
    if (item.status === 'blocked' || item.priority >= 85) return 'high';
    if (item.priority >= 65) return 'medium';
    return 'low';
  }

  function sourceClass(source: AttentionSource): string {
    if (source === 'gmail') return 'mail';
    if (source === 'google_calendar') return 'calendar';
    if (source === 'career_action' || source === 'career_job') return 'career';
    if (source === 'study_signal' || source === 'study_session') return 'study';
    if (source === 'ai_os' || source === 'macro_lab' || source === 'research' || source === 'passive_task') return 'system';
    return 'service';
  }

  function sourceLabel(item: AttentionItem): string {
    return attentionSourceLabel(item.source);
  }

  function actionable(item: AttentionItem): AttentionAction[] {
    const order: AttentionActionKind[] = [
      'mark_read',
      'archive',
      'mark_important',
      'complete',
      'run',
      'restore',
      'snooze',
      'dismiss'
    ];
    return item.actions
      .filter((itemAction) => order.includes(itemAction.kind))
      .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))
      .slice(0, 5);
  }

  function inspectAction(item: AttentionItem): AttentionAction | undefined {
    return item.actions.find((itemAction) => itemAction.kind === 'inspect' || itemAction.kind === 'open');
  }

  function actionRoute(item: AttentionItem, itemAction?: AttentionAction): string {
    return itemAction?.route ?? item.route;
  }

  function externalHref(route: string): boolean {
    return /^https?:\/\//iu.test(route);
  }

  function actionDisabled(item: AttentionItem, itemAction: AttentionAction): boolean {
    const pending = $attentionStore.pendingActionId;
    if (pending && pending !== `${item.id}:${itemAction.kind}`) return true;
    if (!itemAction.available) return true;
    if ($attentionStore.readOnly && itemAction.requiresOnline) return true;
    return false;
  }

  async function runAttentionAction(item: AttentionItem, itemAction: AttentionAction): Promise<void> {
    if (itemAction.kind === 'open' || itemAction.kind === 'inspect') return;
    itemActionMessage = '';
    const snapshot = await attentionStore.performAction(item.id, { action: itemAction.kind });
    if (snapshot) {
      itemActionMessage = `${attentionActionLabel(itemAction.kind)} applied.`;
      if (itemAction.kind === 'complete') void clientData.syncNow();
      if (['run', 'restore', 'complete'].includes(itemAction.kind)) void refreshActionLedger();
    }
  }

  function capabilityStateLabel(state: CapabilityState): string {
    if (state === 'needs_setup') return 'setup';
    return state.replace('_', ' ');
  }

  function readyCapabilityCount(snapshot: CapabilityRegistrySnapshot): number {
    return snapshot.summary.ready + snapshot.summary.running;
  }

  function aiOsServiceReady(): boolean {
    return Boolean(
      capabilitySnapshot?.capabilities.find((capability) => capability.id === 'ai-os.service' && capability.available)
    );
  }

  function modeRecommendationCapability(item: ModeRecommendation): CapabilityRegistryEntry | undefined {
    if (!item.capabilityId) return undefined;
    return capabilitySnapshot?.capabilities.find((capability) => capability.id === item.capabilityId);
  }

  function modeActionBlockedReason(item: ModeRecommendation): string {
    if (!item.action) return 'This recommendation does not expose a direct action.';
    if (modeActionBusyId && modeActionBusyId !== item.id) return 'Another Today recommendation is already running.';
    if (modeActionBusyId === item.id) return 'This recommendation is running.';
    if (capabilityLoading && !capabilitySnapshot) return 'Capability status is still loading.';
    if (!capabilitySnapshot) return 'Check local services before running this recommendation.';

    const aiService = capabilitySnapshot.capabilities.find((capability) => capability.id === 'ai-os.service');
    if (!aiService?.available) {
      return aiService?.lastError ?? 'AI OS is not reachable; open Settings to connect the local service.';
    }

    const requiredCapability = modeRecommendationCapability(item);
    if (requiredCapability && !requiredCapability.available) {
      return requiredCapability.lastError ?? `${requiredCapability.label} is not ready yet.`;
    }
    return '';
  }

  function modeActionDisabled(item: ModeRecommendation): boolean {
    return Boolean(modeActionBlockedReason(item));
  }

  function actionStatusClass(action: ActionLedgerEntry): string {
    if (action.status === 'succeeded') return 'success';
    if (action.status === 'failed' || action.status === 'blocked') return 'failed';
    if (action.status === 'running' || action.status === 'queued') return action.status;
    return action.status;
  }

  function ledgerRoute(action: ActionLedgerEntry): string {
    if (action.recoverability.route) return action.recoverability.route;
    if (action.system === 'ai-os') return '/ai-os';
    if (action.system === 'macro-lab') return '/macro-lab';
    return '/settings';
  }

  function modeMetadata(): Record<string, unknown> {
    return {
      source: 'today-mode-recommendation',
      machine_mode: machineModeContext(currentMachineMode.id)
    };
  }

  function requireRecordId(value: Record<string, unknown>, label: string): string {
    if (typeof value.id === 'string' && value.id.trim()) return value.id;
    throw new Error(`${label} did not return an id.`);
  }

  function okLabel(value: Record<string, unknown>, success: string, failure: string): string {
    return value.ok === true ? success : failure;
  }

  function modeActionRisk(item: ModeRecommendation): ActionLedgerRisk {
    if (item.action?.kind === 'run_text_benchmark') return 'read';
    return 'system';
  }

  function logModeAction(
    item: ModeRecommendation,
    status: ActionLedgerEntry['status'],
    detail: {
      changed?: string[];
      recoverability?: ActionLedgerEntry['recoverability'];
      metadata?: Record<string, unknown>;
    } = {}
  ): void {
    if (!item.action) return;
    recordBrowserAction({
      source: 'today',
      actionType: `today.${item.action.kind}`,
      summary: `Today recommendation "${item.label}" ${status.replace('_', ' ')}`,
      status,
      risk: modeActionRisk(item),
      mode: currentMachineMode.id,
      changed: detail.changed ?? [item.action.kind],
      recoverability:
        detail.recoverability ?? {
          kind: status === 'blocked' ? 'dry_run' : 'none',
          route: item.route,
          description:
            status === 'blocked'
              ? 'Confirmation was cancelled before Today ran this action.'
              : 'Cockpit action is logged; no rollback artifact is attached.',
          reversible: status === 'blocked'
        },
      rawRef: {
        kind: 'today_recommendation',
        recommendationId: item.id,
        capabilityId: item.capabilityId,
        actionKind: item.action.kind
      },
      metadata: {
        label: item.label,
        route: item.route,
        priority: item.priority,
        ...detail.metadata
      }
    });
  }

  async function runModeRecommendation(item: ModeRecommendation): Promise<void> {
    if (!item.action || modeActionBusyId) return;
    const blockedReason = modeActionBlockedReason(item);
    if (blockedReason) {
      modeActionError = blockedReason;
      return;
    }
    if (item.action.confirm && typeof window !== 'undefined' && !window.confirm(item.action.confirm)) {
      logModeAction(item, 'blocked');
      await refreshActionLedger();
      return;
    }

    modeActionBusyId = item.id;
    modeActionMessage = '';
    modeActionError = '';

    try {
      let changed: string[] = [];
      let recoverability: ActionLedgerEntry['recoverability'] | undefined;
      let metadata: Record<string, unknown> = {};
      if (item.action.kind === 'run_text_benchmark') {
        const run = await runBenchmark({
          kind: 'text',
          prompt:
            'Today cockpit local compute benchmark. In one concise paragraph, state what model route is active and what this Mini Hub machine can help with. Do not claim access to data not provided.',
          max_tokens: 192,
          local_first: true,
          metadata: modeMetadata()
        });
        const speed = typeof run.tokens_per_second === 'number' ? ` at ${run.tokens_per_second.toFixed(1)} tokens/sec` : '';
        modeActionMessage = `Benchmark logged on ${run.provider ?? 'auto'}${run.model ? `/${run.model}` : ''}${speed}.`;
        changed = [`benchmark:${run.id}`];
        recoverability = {
          kind: 'snapshot',
          referenceId: run.id,
          route: '/ai-os',
          description: 'Today triggered a persisted AI OS benchmark measurement.',
          reversible: false
        };
        metadata = { provider: run.provider, model: run.model, tokens_per_second: run.tokens_per_second };
      } else if (item.action.kind === 'run_foundation_check') {
        const backup = await createAiBackup(`today-${currentMachineMode.id}-foundation-check`);
        const backupId = requireRecordId(backup, 'Backup');
        const verification = await verifyAiBackup(backupId);
        const restore = await restoreTestAiBackup(backupId);
        modeActionMessage = [
          `Backup ${backupId} created.`,
          okLabel(verification, 'Checksum/integrity verification passed.', 'Checksum/integrity verification needs review.'),
          okLabel(restore, 'Restore test passed.', 'Restore test needs review.')
        ].join(' ');
        changed = [`backup:${backupId}`];
        recoverability = {
          kind: 'backup',
          referenceId: backupId,
          route: '/ai-os',
          description: 'Today created an AI OS backup and ran verification/restore-test artifacts.',
          reversible: true
        };
        metadata = { backupId, verificationOk: verification.ok, restoreOk: restore.ok };
      } else if (item.action.kind === 'queue_local_summary_batch') {
        const snapshotSummary = capabilitySnapshot
          ? formatCapabilityRegistrySummary(capabilitySnapshot)
          : 'Capability registry unavailable.';
        const job = await createAiJob({
          primitive: 'map',
          request: {
            task_type: 'today.night_shift.summary',
            prompt: 'Summarize a real Mini Hub capability signal.',
            max_tokens: 220,
            local_first: true,
            allow_fallback: false,
            metadata: modeMetadata()
          },
          items: [
            `Machine mode:\n${currentMachineMode.label}\n${currentMachineMode.summary}`,
            `Capability snapshot:\n${snapshotSummary}`,
            `Attention queue count: ${attentionItems.length}`
          ],
          template:
            'Summarize this real Mini Hub signal in one concise operational note. Do not invent external data.\n\n{item}',
          concurrency: 1,
          metadata: { recommendation_id: item.id, ...modeMetadata() }
        });
        modeActionMessage = `Queued local ${job.primitive} job ${job.id}.`;
        changed = [`job:${job.id}`];
        recoverability = {
          kind: 'artifact',
          referenceId: job.id,
          route: '/ai-os',
          description: 'Today queued an AI OS job; job history and results are the recovery/audit artifact.',
          reversible: false
        };
        metadata = { jobId: job.id, primitive: job.primitive };
      }

      logModeAction(item, 'succeeded', { changed, recoverability, metadata });
      await Promise.all([refreshCapabilities(), refreshActionLedger(), attentionStore.refresh({ background: true })]);
    } catch (error) {
      modeActionError = error instanceof Error ? error.message : 'Recommendation action failed.';
      logModeAction(item, 'failed', { metadata: { error: modeActionError } });
      await refreshActionLedger();
    } finally {
      modeActionBusyId = '';
    }
  }

  async function refreshCapabilities(nextGoogleConnected = googleConnected): Promise<void> {
    capabilityLoading = true;
    capabilityError = '';
    try {
      capabilitySnapshot = await loadCapabilityRegistry({
        isOnline: $clientData.isOnline,
        syncStatus: $clientData.status,
        syncError: $clientData.error,
        googleConnected: nextGoogleConnected,
        machineMode: currentMachineMode.id
      });
    } catch (error) {
      capabilityError = error instanceof Error ? error.message : 'Capability registry failed to load.';
    } finally {
      capabilityLoading = false;
    }
  }

  async function refreshActionLedger(): Promise<void> {
    actionLedgerLoading = true;
    actionLedgerError = '';
    try {
      actionLedgerSnapshot = await loadActionLedger(16);
    } catch (error) {
      actionLedgerError = error instanceof Error ? error.message : 'Action ledger failed to load.';
    } finally {
      actionLedgerLoading = false;
    }
  }

  async function refreshToday(): Promise<void> {
    const snapshot = await attentionStore.refresh();
    await Promise.all([refreshCapabilities(snapshotGoogleConnected(snapshot)), refreshActionLedger()]);
  }

  function todayRefreshTitle(state: TodayRefreshControlState): string {
    if (state.loading) return 'Today is still loading the attention snapshot.';
    if (state.refreshing) return 'Today is already refreshing attention sources.';
    return 'Refresh Today from connected sources.';
  }

  function compactTodayServiceIssue(message = ''): string {
    const text = message.trim();
    if (!text) return 'Today could not reach its attention sources.';
    if (/github pages|returned.*html|static site|wrong endpoint|missing route|404|not found/iu.test(text)) {
      return 'Today is pointed at the wrong API endpoint or a missing route.';
    }
    if (/cors|mixed-content|firewall|blocked/iu.test(text)) {
      return 'The browser blocked a Today request. Check CORS, mixed content, or firewall settings.';
    }
    if (/failed to fetch|econnrefused|connection refused|network|offline|unavailable|timed out|timeout/iu.test(text)) {
      return 'One or more local Today sources are offline or unreachable.';
    }
    if (/auth|unauthori[sz]ed|permission|forbidden|401|403/iu.test(text)) {
      return 'A connected Today source needs authentication or permission.';
    }
    return text.length > 120 ? `${text.slice(0, 117)}...` : text;
  }

  function todaySaveStatusLabel(state: ClientDataState): string {
    if (state.status === 'error') return 'Needs attention';
    if (!state.initialized) return 'Loading cache';
    if (state.status === 'syncing') return 'Syncing';
    if (!state.isOnline || state.status === 'offline-readonly') return 'Offline read-only';
    return 'Auto-save ready';
  }

  function todaySaveStatusDetail(state: ClientDataState): string {
    if (state.error) return state.error;
    if (!state.initialized) return 'Opening the browser cache and local workspace snapshot.';
    if (!state.isOnline || state.status === 'offline-readonly') {
      return 'Cached pages stay readable; saves wait for the Hub API.';
    }
    return 'Career, Study, supported games, settings, and activity cache can save through their owners.';
  }

  function todayLastSyncLabel(state: ClientDataState): string {
    if (state.status === 'error') return 'needs review';
    if (!state.initialized) return 'loading';
    if (!state.lastSyncedAt) return 'never';
    const date = new Date(state.lastSyncedAt);
    if (Number.isNaN(date.getTime())) return state.lastSyncedAt;
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    }).format(date);
  }

  onMount(() => {
    void clientData.init();
    void attentionStore.init().then(() => refreshCapabilities(snapshotGoogleConnected($attentionStore.snapshot)));
    void refreshActionLedger();
    let retryCount = 0;
    const retry = window.setInterval(() => {
      retryCount += 1;
      if (retryCount > 20 || aiOsServiceReady()) {
        window.clearInterval(retry);
        return;
      }
      if (!capabilityLoading) void refreshCapabilities();
    }, 3000);
    return () => window.clearInterval(retry);
  });
</script>

<svelte:head>
  <title>Today - Mini Hub</title>
</svelte:head>

<section class="page-header today-header">
  <div>
    <p class="eyebrow">Today</p>
    <h1>Attention Queue</h1>
  </div>
  <div class="header-actions">
    <span class="sync-note">
      {#if $attentionStore.loading}
        Loading attention...
      {:else if attentionSnapshot?.checkedAt}
        Updated {displayShortDate(attentionSnapshot.checkedAt)}
      {:else if $attentionStore.cachedAt}
        Cached {displayShortDate($attentionStore.cachedAt)}
      {:else}
        Ready
      {/if}
    </span>
    <button class="button" type="button" disabled={$attentionStore.loading || $attentionStore.refreshing} title={todayRefreshButtonTitle} on:click={refreshToday}>
      <RefreshCw size={16} />
      <span>{$attentionStore.refreshing ? 'Refreshing' : 'Refresh'}</span>
    </button>
    <a class="button" href={hubHref('/settings')}>
      <Settings size={16} />
      <span>Settings</span>
    </a>
  </div>
</section>

{#if $attentionStore.readOnly}
  <section class="card card-pad warning-panel">
    Cached attention is read-only until the hub reconnects.
  </section>
{/if}

{#if $attentionStore.error}
  <section class="card card-pad warning-panel attention-error-panel" title={`Raw Today error: ${$attentionStore.error}`}>
    <div>
      <strong>Today refresh needs attention</strong>
      <p>{visibleAttentionError} Cached attention remains visible when available.</p>
    </div>
    <a class="button compact" href={hubHref('/settings#feature-wiring')} title="Open Settings Feature Wiring to inspect Hub API, Google, AI OS, Macro Lab, and endpoint wiring.">
      <Settings size={15} />
      <span>Open Settings</span>
    </a>
  </section>
{/if}

{#if itemActionMessage}
  <section class="card card-pad success-panel">
    {itemActionMessage}
  </section>
{/if}

<section class="signal-strip" aria-label="Attention signals">
  <div>
    <span>Queue</span>
    <strong>{todayCountLabel(attentionItems.length)}</strong>
  </div>
  <div>
    <span>Mail</span>
    <strong>{todayCountLabel(mailItems.length)}</strong>
  </div>
  <div>
    <span>Calendar</span>
    <strong>{todayCountLabel(calendarItems.length)}</strong>
  </div>
  <div>
    <span>System</span>
    <strong>{todayCountLabel(systemItems.length)}</strong>
  </div>
  <div>
    <span>Source issues</span>
    <strong>{todayCountLabel(sourceIssues.length)}</strong>
  </div>
</section>

<section class="card save-recovery-strip" aria-label="Save and recovery status">
  <div class="save-recovery-title">
    <span class="icon-chip"><Database size={16} /></span>
    <div>
      <strong>Save & Recovery</strong>
      <small>{saveStatusLabel}</small>
    </div>
  </div>
  <div class="save-recovery-facts">
    <div>
      <span>Browser cache</span>
      <strong>{cachedCoreRows} row{cachedCoreRows === 1 ? '' : 's'}</strong>
      <small>Reloads on this browser before live sources refresh.</small>
    </div>
    <div>
      <span>Last sync</span>
      <strong>{lastSyncLabel}</strong>
      <small>{saveStatusDetail}</small>
    </div>
    <div>
      <span>Long work</span>
      <strong>Activity</strong>
      <small>Research, AI OS, Passive, and Macro runs are recovered from Activity.</small>
    </div>
  </div>
  <div class="save-recovery-actions">
    <a class="button compact" href={hubHref('/activity')} title="Open durable Activity and Handoff records.">
      <Activity size={15} />
      <span>Activity</span>
    </a>
    <a class="button compact" href={hubHref('/settings#data-recovery')} title="Open Settings Data & Recovery for the full save and reload map.">
      <Settings size={15} />
      <span>Data Map</span>
    </a>
  </div>
</section>

<section class="card now-strip" aria-label="Now and next calendar">
  <div class="strip-title">
    <span class="icon-chip"><CalendarClock size={16} /></span>
    <strong>Now / Next</strong>
  </div>
  {#if nowNextItems.length}
    <div class="now-items">
      {#each nowNextItems as item}
        {@const openAction = inspectAction(item)}
        <a
          class="now-item"
          href={externalHref(actionRoute(item, openAction)) ? actionRoute(item, openAction) : hubHref(actionRoute(item, openAction))}
          target={externalHref(actionRoute(item, openAction)) ? '_blank' : undefined}
          rel={externalHref(actionRoute(item, openAction)) ? 'noreferrer' : undefined}
          title={`Open ${item.title} from ${sourceLabel(item)}.`}
        >
          <time datetime={item.dueAt}>{displayEventTime(item)}</time>
          <strong>{item.title}</strong>
          <small>{item.detail || sourceLabel(item)}</small>
        </a>
      {/each}
    </div>
  {:else if attentionSnapshot}
    <p class="empty-note">
      {attentionSourceStatusLine(attentionSnapshot.sources.find((source) => source.id === 'google_calendar') ?? {
        id: 'google_calendar',
        label: 'Google Calendar',
        status: 'unavailable',
        itemCount: 0
      })}
    </p>
  {:else}
    <p class="empty-note">No attention snapshot has loaded yet.</p>
  {/if}
</section>

<section class="cockpit-grid" aria-label="Unified attention cockpit">
  <div class="main-column">
    <article class="card panel">
      <div class="panel-title">
        <div>
          <span class="icon-chip"><Bell size={16} /></span>
          <strong>Priority Action Queue</strong>
        </div>
      </div>
      {#if priorityQueue.length}
        <div class="queue-list">
          {#each priorityQueue as item}
            {@const openAction = inspectAction(item)}
            <div class="queue-row">
              <a class="queue-link" href={hubHref(item.route)} title={`Open ${item.title} in ${sourceLabel(item)}.`}>
                <span class={`source-pill ${sourceClass(item.source)}`}>{sourceLabel(item)}</span>
                <span class="queue-main">
                  <strong>{item.title}</strong>
                  <small>{item.detail}</small>
                </span>
                <span class={`priority-pill ${priorityClass(item)}`}>{item.priority}</span>
                <span class="queue-when">{itemMeta(item)}</span>
              </a>
              <div class="item-actions" aria-label={`Actions for ${item.title}`}>
                {#if openAction}
                  <a
                    class="icon-action"
                    title={attentionActionLabel(openAction.kind)}
                    aria-label={`${attentionActionLabel(openAction.kind)} ${item.title}`}
                    href={externalHref(actionRoute(item, openAction)) ? actionRoute(item, openAction) : hubHref(actionRoute(item, openAction))}
                    target={externalHref(actionRoute(item, openAction)) ? '_blank' : undefined}
                    rel={externalHref(actionRoute(item, openAction)) ? 'noreferrer' : undefined}
                  >
                    <Eye size={15} />
                  </a>
                {/if}
                {#each actionable(item) as itemAction}
                  <button
                    class="icon-action text-action"
                    type="button"
                    disabled={actionDisabled(item, itemAction)}
                    title={itemAction.reason ?? attentionActionLabel(itemAction.kind)}
                    aria-label={`${attentionActionLabel(itemAction.kind)} ${item.title}`}
                    on:click={() => runAttentionAction(item, itemAction)}
                  >
                    {#if itemAction.kind === 'mark_read'}
                      <MailCheck size={15} />
                    {:else if itemAction.kind === 'archive'}
                      <Archive size={15} />
                    {:else if itemAction.kind === 'mark_important'}
                      <Star size={15} />
                    {:else if itemAction.kind === 'complete'}
                      <CheckCircle2 size={15} />
                    {:else if itemAction.kind === 'run'}
                      <Play size={15} />
                    {:else if itemAction.kind === 'restore'}
                      <RotateCcw size={15} />
                    {:else if itemAction.kind === 'snooze'}
                      <Clock3 size={15} />
                    {:else}
                      <XCircle size={15} />
                    {/if}
                    <span>{attentionActionLabel(itemAction.kind)}</span>
                  </button>
                {/each}
              </div>
            </div>
          {/each}
        </div>
      {:else if $attentionStore.loading}
        <p class="empty-note">Loading real attention sources...</p>
      {:else}
        <div class="empty-block">
          <strong>No active queue items.</strong>
          <p>{sourceIssues.length ? 'Some sources are unavailable; check the source status panel.' : 'Connected sources do not have active actions right now.'}</p>
        </div>
      {/if}
    </article>

    <article class="card panel">
      <div class="panel-title">
        <div>
          <span class="icon-chip"><Inbox size={16} /></span>
          <strong>Mail Triage</strong>
        </div>
        <a class="button compact" href={hubHref('/productivity')}>
          <span>Inbox</span>
          <ArrowRight size={15} />
        </a>
      </div>
      {#if mailItems.length}
        <div class="compact-list">
          {#each mailItems as item}
            <div class="compact-row">
              <a class="compact-link" href={hubHref('/productivity')} title={`Open mail item ${item.title}.`}>
                <span class={`priority-pill ${priorityClass(item)}`}>{item.priority}</span>
                <span class="compact-main">
                  <strong>{item.title}</strong>
                  <small>{item.detail}</small>
                </span>
                <span class="queue-when">{itemMeta(item)}</span>
              </a>
              <div class="item-actions compact-actions">
                {#each actionable(item).filter((itemAction) => ['mark_read', 'archive', 'mark_important', 'snooze', 'dismiss'].includes(itemAction.kind)) as itemAction}
                  <button
                    class="icon-action text-action"
                    type="button"
                    disabled={actionDisabled(item, itemAction)}
                    title={itemAction.reason ?? attentionActionLabel(itemAction.kind)}
                    on:click={() => runAttentionAction(item, itemAction)}
                  >
                    {#if itemAction.kind === 'mark_read'}
                      <MailCheck size={15} />
                    {:else if itemAction.kind === 'archive'}
                      <Archive size={15} />
                    {:else if itemAction.kind === 'mark_important'}
                      <Star size={15} />
                    {:else if itemAction.kind === 'snooze'}
                      <Clock3 size={15} />
                    {:else}
                      <XCircle size={15} />
                    {/if}
                    <span>{attentionActionLabel(itemAction.kind)}</span>
                  </button>
                {/each}
              </div>
            </div>
          {/each}
        </div>
      {:else}
        <p class="empty-note">{mailEmptyMessage()}</p>
      {/if}
    </article>

    <article class="card panel">
      <div class="panel-title">
        <div>
          <span class="icon-chip"><BriefcaseBusiness size={16} /></span>
          <strong>Career / Study Focus</strong>
        </div>
        <a class="button compact" href={hubHref('/desk/career')}>
          <span>Desk</span>
          <ArrowRight size={15} />
        </a>
      </div>
      {#if focusItems.length}
        <div class="compact-list">
          {#each focusItems as item}
            <div class="compact-row">
              <a class="compact-link" href={hubHref(item.route)} title={`Open ${item.title} in ${sourceLabel(item)}.`}>
                <span class={`source-pill ${sourceClass(item.source)}`}>{sourceLabel(item)}</span>
                <span class="compact-main">
                  <strong>{item.title}</strong>
                  <small>{item.detail}</small>
                </span>
                <span class="queue-when">{itemMeta(item)}</span>
              </a>
              <div class="item-actions compact-actions">
                {#each actionable(item).filter((itemAction) => ['complete', 'snooze', 'dismiss'].includes(itemAction.kind)) as itemAction}
                  <button
                    class="icon-action text-action"
                    type="button"
                    disabled={actionDisabled(item, itemAction)}
                    title={itemAction.reason ?? attentionActionLabel(itemAction.kind)}
                    on:click={() => runAttentionAction(item, itemAction)}
                  >
                    {#if itemAction.kind === 'complete'}
                      <CheckCircle2 size={15} />
                    {:else if itemAction.kind === 'snooze'}
                      <Clock3 size={15} />
                    {:else}
                      <XCircle size={15} />
                    {/if}
                    <span>{attentionActionLabel(itemAction.kind)}</span>
                  </button>
                {/each}
              </div>
            </div>
          {/each}
        </div>
      {:else}
        <p class="empty-note">{focusEmptyMessage()}</p>
      {/if}
    </article>
  </div>

  <aside class="side-rail">
    <article class="card panel">
      <div class="panel-title">
        <div>
          <span class="icon-chip"><Activity size={16} /></span>
          <strong>System / Services</strong>
        </div>
      </div>
      {#if systemItems.length}
        <div class="service-list">
          {#each systemItems as item}
            <a class="service-row" href={hubHref(item.route)} title={`Open ${item.title} status.`}>
              <span class={`source-pill ${sourceClass(item.source)}`}>{sourceLabel(item)}</span>
              <span>
                <strong>{item.title}</strong>
                <small>{item.detail}</small>
              </span>
            </a>
          {/each}
        </div>
      {:else}
        <p class="empty-note">{systemEmptyMessage()}</p>
      {/if}
    </article>

    <article class="card panel">
      <div class="panel-title">
        <div>
          <span class="icon-chip"><Cpu size={16} /></span>
          <strong>Machine Mode</strong>
        </div>
        <a class="button compact" href={hubHref('/settings#machine-mode')} title="Open Settings Machine Mode controls.">
          <span>Mode</span>
          <ArrowRight size={15} />
        </a>
      </div>
      <div class="mode-summary">
        <strong>{currentMachineMode.label}</strong>
        <span>{currentMachineMode.summary}</span>
      </div>
      {#if modeRecommendations.length}
        <div class="mode-rec-list">
          {#each modeRecommendations.slice(0, 4) as item}
            <div class="mode-rec-row">
              <a class="mode-rec-link" href={hubHref(item.route)} title={`Open ${item.label}.`}>
                <span class="mode-rec-tag">{item.tag}</span>
                <span class="mode-rec-main">
                  <strong>{item.label}</strong>
                  <small>{item.detail}</small>
                </span>
                <ArrowRight size={15} />
              </a>
              {#if item.action}
                <button
                  class="button compact mode-action-button"
                  type="button"
                  disabled={modeActionDisabled(item)}
                  title={modeActionBlockedReason(item) || item.action.label}
                  on:click={() => runModeRecommendation(item)}
                >
                  <span>{modeActionBusyId === item.id ? 'Running' : item.action.label}</span>
                </button>
              {/if}
            </div>
          {/each}
        </div>
      {:else}
        <p class="empty-note">No mode-specific recommendation is available from the current capability snapshot.</p>
      {/if}
      {#if modeActionError}
        <p class="panel-note error">{modeActionError}</p>
      {:else if modeActionMessage}
        <p class="panel-note success">{modeActionMessage}</p>
      {/if}
    </article>

    <article class="card panel">
      <div class="panel-title">
        <div>
          <span class="icon-chip"><Activity size={16} /></span>
          <strong>Capability Health</strong>
        </div>
        <a class="button compact" href={hubHref('/settings#feature-wiring')}>
          <span>Fix</span>
          <ArrowRight size={15} />
        </a>
      </div>
      {#if capabilitySnapshot}
        <div class="capability-summary">
          <div>
            <strong>{readyCapabilityCount(capabilitySnapshot)}/{capabilitySnapshot.summary.total}</strong>
            <span>usable</span>
          </div>
          <div>
            <strong>{capabilitySnapshot.summary.localReady}</strong>
            <span>local</span>
          </div>
          <div>
            <strong>{capabilitySnapshot.summary.offline + capabilitySnapshot.summary.degraded + capabilitySnapshot.summary.blocked}</strong>
            <span>repair</span>
          </div>
        </div>
        {#if capabilityIssues.length}
          <div class="service-list">
            {#each capabilityIssues as capability}
              <a class="service-row" href={hubHref(capability.route)} title={`Open ${capability.label} setup or status.`}>
                <span class={`capability-state ${capability.state}`}>{capabilityStateLabel(capability.state)}</span>
                <span>
                  <strong>{capability.label}</strong>
                  <small>{capability.lastError ?? capability.description}</small>
                </span>
              </a>
            {/each}
          </div>
        {:else}
          <p class="empty-note">Core capabilities look ready.</p>
        {/if}
      {:else if capabilityLoading}
        <p class="empty-note">Checking local services and providers...</p>
      {:else if capabilityError}
        <p class="empty-note">{capabilityError}</p>
      {:else}
        <p class="empty-note">Capability status has not been checked yet.</p>
      {/if}
    </article>

    <article class="card panel">
      <div class="panel-title">
        <div>
          <span class="icon-chip"><Activity size={16} /></span>
          <strong>Recent Actions</strong>
        </div>
        <a class="button compact" href={hubHref('/settings#action-ledger')} title="Open Settings Action Ledger.">
          <span>Ledger</span>
          <ArrowRight size={15} />
        </a>
      </div>
      {#if actionLedgerItems.length}
        <div class="ledger-list">
          {#each actionLedgerItems as item}
            <a class="ledger-row" href={hubHref(ledgerRoute(item))} title={`Open action log: ${item.summary}.`}>
              <span class={`activity-state ${actionStatusClass(item)}`}>{actionLedgerStatusLabel(item.status)}</span>
              <span class="ledger-main">
                <strong>{item.summary}</strong>
                <small>{actionLedgerDetail(item)}</small>
              </span>
              <span class={`risk-chip ${item.risk}`}>{actionLedgerRiskLabel(item.risk)}</span>
            </a>
          {/each}
        </div>
      {:else if actionLedgerLoading}
        <p class="empty-note">Loading recent app actions, AI OS logs, and Macro Lab runs...</p>
      {:else if actionLedgerError}
        <p class="empty-note">{actionLedgerError}</p>
      {:else}
        <p class="empty-note">No meaningful actions are logged yet.</p>
      {/if}
      {#if actionLedgerSnapshot?.errors.length}
        <p class="panel-note error">{actionLedgerSnapshot.errors[0]}</p>
      {/if}
    </article>

    <article class="card panel">
      <div class="panel-title">
        <div>
          <span class="icon-chip"><Settings size={16} /></span>
          <strong>Source Status</strong>
        </div>
      </div>
      {#if attentionSnapshot?.sources.length}
        <div class="source-list">
          {#each attentionSnapshot.sources as source}
            <div class={`source-status ${source.status}`}>
              <strong>{source.label}</strong>
              <small>{attentionSourceStatusLine(source)}</small>
            </div>
          {/each}
        </div>
      {:else}
        <p class="empty-note">No source snapshot has loaded yet.</p>
      {/if}
    </article>
  </aside>
</section>

<details class="card launcher-panel">
  <summary>
    <span>Apps</span>
    <small>Open the wider workspace</small>
  </summary>
  <section class="grid three launcher" aria-label="Launcher">
    {#each launcherEntries as entry}
      <a class="launch-card" href={hubHref(entry.route)} title={`Open ${entry.name}.`}>
        <div>
          <strong>{entry.name}</strong>
          <span>{entry.group}</span>
        </div>
        <p>{statusLabel(entry.status)}</p>
        <ArrowRight size={18} />
      </a>
    {/each}
  </section>
</details>

<style>
  .today-header {
    align-items: center;
  }

  .today-header h1 {
    font-size: 22px;
    letter-spacing: 0;
  }

  .header-actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }

  .sync-note {
    color: var(--muted);
    font-size: 12px;
    font-weight: 700;
  }

  .warning-panel {
    margin-bottom: 10px;
    border-color: var(--warning-border);
    color: var(--warning-text);
    background: var(--warning-bg);
  }

  .attention-error-panel {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .attention-error-panel p {
    margin: 4px 0 0;
  }

  .success-panel {
    margin-bottom: 10px;
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

  .save-recovery-strip {
    display: grid;
    grid-template-columns: 180px minmax(0, 1fr) auto;
    align-items: stretch;
    margin-bottom: 10px;
    overflow: hidden;
  }

  .save-recovery-title {
    display: flex;
    align-items: center;
    gap: 9px;
    min-width: 0;
    padding: 10px;
    border-right: 1px solid var(--border);
  }

  .save-recovery-title div,
  .save-recovery-facts div {
    display: grid;
    gap: 2px;
    min-width: 0;
  }

  .save-recovery-title small,
  .save-recovery-facts span,
  .save-recovery-facts small {
    color: var(--muted);
  }

  .save-recovery-title strong,
  .save-recovery-title small,
  .save-recovery-facts strong,
  .save-recovery-facts small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .save-recovery-facts {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    min-width: 0;
  }

  .save-recovery-facts div {
    padding: 9px 10px;
    border-right: 1px solid var(--border);
  }

  .save-recovery-facts span {
    font-size: 11px;
    font-weight: 800;
    text-transform: uppercase;
  }

  .save-recovery-facts strong {
    font-size: 13px;
  }

  .save-recovery-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: 6px;
    padding: 10px;
  }

  .now-strip {
    display: grid;
    grid-template-columns: 148px minmax(0, 1fr);
    align-items: stretch;
    margin-bottom: 10px;
    overflow: hidden;
  }

  .strip-title {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px;
    border-right: 1px solid var(--border);
  }

  .now-items {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .now-item {
    display: grid;
    gap: 3px;
    min-height: 72px;
    padding: 10px;
    border-right: 1px solid var(--border);
    color: var(--text);
    text-decoration: none;
  }

  .now-item:last-child {
    border-right: 0;
  }

  .now-item:hover {
    background: var(--active);
  }

  .now-item time,
  .now-item small {
    overflow: hidden;
    color: var(--muted);
    font-size: 12px;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .now-item strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cockpit-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.4fr) minmax(320px, 0.75fr);
    gap: 10px;
    align-items: start;
  }

  .main-column,
  .side-rail {
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

  .panel-title strong {
    font-size: 14px;
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

  .empty-note,
  .empty-block p,
  .panel-note {
    margin: 0;
    color: var(--muted);
  }

  .empty-note {
    padding: 12px;
  }

  .empty-block {
    display: grid;
    gap: 8px;
    padding: 14px;
  }

  .panel-note {
    padding: 8px 10px;
    border-top: 1px solid var(--border);
    font-size: 12px;
    font-weight: 700;
    line-height: 1.35;
  }

  .panel-note.success {
    color: var(--success-text);
    background: var(--success-bg);
  }

  .panel-note.error {
    color: var(--error-text);
    background: var(--error-bg);
  }

  .queue-list,
  .compact-list,
  .service-list,
  .ledger-list,
  .source-list {
    display: grid;
  }

  .queue-row,
  .compact-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    border-bottom: 1px solid var(--border);
  }

  .queue-link,
  .compact-link,
  .service-row,
  .ledger-row {
    color: var(--text);
    text-decoration: none;
  }

  .queue-link {
    display: grid;
    grid-template-columns: 96px minmax(0, 1fr) 48px 76px;
    gap: 9px;
    align-items: center;
    min-height: 64px;
    padding: 10px;
  }

  .compact-link {
    display: grid;
    grid-template-columns: 88px minmax(0, 1fr) 72px;
    gap: 9px;
    align-items: center;
    min-height: 58px;
    padding: 9px 10px;
  }

  .queue-link:hover,
  .compact-link:hover,
  .service-row:hover,
  .ledger-row:hover {
    background: var(--active);
  }

  .queue-main,
  .compact-main,
  .ledger-main,
  .service-row span:last-child {
    display: grid;
    gap: 3px;
    min-width: 0;
  }

  .queue-main strong,
  .queue-main small,
  .compact-main strong,
  .compact-main small,
  .ledger-main strong,
  .ledger-main small,
  .service-row strong,
  .service-row small,
  .queue-when {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .queue-main small,
  .compact-main small,
  .ledger-main small,
  .service-row small,
  .queue-when {
    color: var(--muted);
  }

  .queue-when {
    justify-self: end;
    font-size: 12px;
    font-weight: 700;
  }

  .source-pill,
  .priority-pill,
  .activity-state,
  .risk-chip,
  .capability-state,
  .mode-rec-tag {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: fit-content;
    min-width: 58px;
    min-height: 22px;
    padding: 2px 7px;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 999px;
    color: var(--muted);
    background: var(--surface-muted);
    font-size: 11px;
    font-weight: 850;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .source-pill.mail,
  .source-pill.calendar {
    border-color: var(--border-strong);
  }

  .source-pill.career,
  .source-pill.study {
    border-color: var(--success-border);
    color: var(--success-text);
    background: var(--success-bg);
  }

  .source-pill.system,
  .source-pill.service,
  .priority-pill.high,
  .activity-state.failed,
  .capability-state.offline,
  .capability-state.blocked {
    border-color: var(--error-border);
    color: var(--error-text);
    background: var(--error-bg);
  }

  .priority-pill.medium,
  .activity-state.running,
  .activity-state.queued,
  .capability-state.degraded,
  .capability-state.needs_setup {
    border-color: var(--warning-border);
    color: var(--warning-text);
    background: var(--warning-bg);
  }

  .priority-pill.low,
  .activity-state.info,
  .activity-state.dry_run {
    border-color: var(--border);
    color: var(--muted);
  }

  .activity-state.success {
    border-color: var(--success-border);
    color: var(--success-text);
    background: var(--success-bg);
  }

  .item-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: 5px;
    min-width: 290px;
    padding: 8px 10px 8px 0;
  }

  .compact-actions {
    min-width: 220px;
  }

  .icon-action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    min-width: 30px;
    height: 30px;
    padding: 0 7px;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--muted);
    background: var(--surface);
    cursor: pointer;
    text-decoration: none;
    font-size: 12px;
    font-weight: 850;
    white-space: nowrap;
  }

  .icon-action:hover:not(:disabled) {
    color: var(--text);
    background: var(--active);
  }

  .icon-action:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  .mode-summary {
    display: grid;
    gap: 4px;
    padding: 10px;
    border-bottom: 1px solid var(--border);
  }

  .mode-summary strong {
    font-size: 14px;
  }

  .mode-summary span {
    color: var(--muted);
    line-height: 1.35;
  }

  .mode-rec-list {
    display: grid;
  }

  .mode-rec-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    min-height: 58px;
    border-bottom: 1px solid var(--border);
  }

  .mode-rec-link {
    display: grid;
    grid-template-columns: 70px minmax(0, 1fr) 16px;
    gap: 8px;
    align-items: center;
    min-height: 58px;
    padding: 9px 10px;
    color: var(--text);
    text-decoration: none;
  }

  .mode-action-button {
    margin-right: 10px;
    white-space: nowrap;
  }

  .mode-rec-main {
    display: grid;
    gap: 2px;
    min-width: 0;
  }

  .mode-rec-main strong,
  .mode-rec-main small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mode-rec-main small {
    color: var(--muted);
  }

  .service-row {
    display: grid;
    grid-template-columns: 88px minmax(0, 1fr);
    gap: 9px;
    align-items: center;
    min-height: 54px;
    padding: 9px 10px;
    border-bottom: 1px solid var(--border);
  }

  .capability-summary {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    border-bottom: 1px solid var(--border);
  }

  .capability-summary div {
    display: grid;
    gap: 2px;
    min-width: 0;
    padding: 10px;
    border-right: 1px solid var(--border);
  }

  .capability-summary div:last-child {
    border-right: 0;
  }

  .capability-summary strong,
  .capability-summary span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .capability-summary span {
    color: var(--muted);
    font-size: 11px;
    font-weight: 800;
    text-transform: uppercase;
  }

  .ledger-row {
    display: grid;
    grid-template-columns: 78px minmax(0, 1fr) 74px;
    gap: 9px;
    align-items: center;
    min-height: 56px;
    padding: 9px 10px;
    border-bottom: 1px solid var(--border);
  }

  .risk-chip {
    justify-self: end;
  }

  .risk-chip.destructive {
    border-color: var(--danger-border);
    color: var(--danger-text);
    background: var(--danger-bg);
  }

  .risk-chip.system {
    border-color: var(--warning-border);
    color: var(--warning-text);
    background: var(--warning-bg);
  }

  .source-status {
    display: grid;
    gap: 3px;
    padding: 9px 10px;
    border-bottom: 1px solid var(--border);
  }

  .source-status small {
    overflow: hidden;
    color: var(--muted);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .source-status.error small {
    color: var(--error-text);
  }

  .source-status.unavailable small {
    color: var(--warning-text);
  }

  .launcher-panel {
    margin-top: 10px;
  }

  .launcher-panel summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-height: 36px;
    padding: 8px 10px;
    cursor: pointer;
  }

  .launcher-panel summary span {
    font-weight: 750;
  }

  .launcher-panel summary small {
    color: var(--muted);
  }

  .launcher {
    align-items: stretch;
    padding: 0 10px 10px;
  }

  .launch-card {
    position: relative;
    display: grid;
    min-height: 92px;
    padding: 12px;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    background: var(--surface);
    text-decoration: none;
  }

  .launch-card::before {
    content: "";
    position: absolute;
    inset: 0 auto 0 0;
    width: 4px;
    background: var(--accent);
  }

  .launch-card div {
    display: grid;
    gap: 4px;
  }

  .launch-card p {
    margin: 0;
    color: var(--muted);
  }

  .launch-card :global(svg) {
    align-self: end;
    justify-self: end;
  }

  @media (max-width: 1120px) {
    .cockpit-grid,
    .now-strip,
    .save-recovery-strip {
      grid-template-columns: 1fr;
    }

    .strip-title,
    .save-recovery-title {
      border-right: 0;
      border-bottom: 1px solid var(--border);
    }

    .save-recovery-actions {
      justify-content: flex-start;
      border-top: 1px solid var(--border);
    }
  }

  @media (max-width: 880px) {
    .signal-strip {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .now-items {
      grid-template-columns: 1fr;
    }

    .now-item {
      border-right: 0;
      border-bottom: 1px solid var(--border);
    }

    .queue-row,
    .compact-row {
      grid-template-columns: 1fr;
    }

    .queue-link {
      grid-template-columns: 86px minmax(0, 1fr) 44px;
    }

    .queue-when {
      grid-column: 2 / 4;
      justify-self: start;
    }

    .compact-link {
      grid-template-columns: 86px minmax(0, 1fr);
    }

    .item-actions,
    .compact-actions {
      justify-content: flex-start;
      min-width: 0;
      padding: 0 10px 10px 104px;
    }

    .save-recovery-facts {
      grid-template-columns: 1fr;
    }

    .save-recovery-facts div {
      border-right: 0;
      border-bottom: 1px solid var(--border);
    }
  }

  @media (max-width: 560px) {
    .signal-strip {
      grid-template-columns: 1fr;
    }

    .item-actions,
    .compact-actions {
      padding-left: 10px;
    }

    .text-action span {
      display: none;
    }
  }
</style>
