<script lang="ts">
  import { onMount } from 'svelte';
  import {
    Activity,
    ArrowRight,
    BriefcaseBusiness,
    CalendarClock,
    Cpu,
    Inbox,
    RefreshCw,
    Settings
  } from 'lucide-svelte';
  import { launcherEntries, type ActionLedgerEntry, type ActionLedgerRisk, type CalendarEvent, type JobRecord } from '@mini-hub/core';
  import { statusLabel } from '@mini-hub/ui';
  import {
    actionLedgerDetail,
    actionLedgerRiskLabel,
    actionLedgerStatusLabel,
    loadActionLedger,
    type ActionLedgerSnapshot
  } from '$lib/action-ledger';
  import { attentionKindLabel, buildAttentionItems, type AttentionItem } from '$lib/attention';
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
  import { clientData } from '$lib/client-data';
  import { machineModeContext, machineModeFromPreferences } from '$lib/machine-mode';
  import { buildModeRecommendations, type ModeRecommendation } from '$lib/mode-recommendations';
  import { recordBrowserAction } from '$lib/browser-action-ledger';
  import { hubHref } from '$lib/routes';
  import {
    getConnections,
    listCalendars,
    listEvents,
    listPriorityGmailThreads,
    type CalendarSummary,
    type GmailThreadInsight,
    type PublicConnection
  } from '$lib/productivity-api';

  let connections: PublicConnection[] = [];
  let calendars: CalendarSummary[] = [];
  let agendaEvents: CalendarEvent[] = [];
  let priorityThreads: GmailThreadInsight[] = [];
  let dashboardLoading = false;
  let dashboardError = '';
  let lastLoadedAt = '';
  let calendarLabelMap = new Map<string, string>();
  let importantMail: GmailThreadInsight[] = [];
  let visibleAgenda: CalendarEvent[] = [];
  let nextEvent: CalendarEvent | null = null;
  let attentionItems: AttentionItem[] = [];
  let capabilitySnapshot: CapabilityRegistrySnapshot | null = null;
  let capabilityIssues: CapabilityRegistryEntry[] = [];
  let modeRecommendations: ModeRecommendation[] = [];
  let capabilityLoading = false;
  let capabilityError = '';
  let actionLedgerSnapshot: ActionLedgerSnapshot | null = null;
  let actionLedgerItems: ActionLedgerEntry[] = [];
  let actionLedgerLoading = false;
  let actionLedgerError = '';
  let modeActionBusyId = '';
  let modeActionMessage = '';
  let modeActionError = '';

  $: googleConnections = connections.filter(
    (connection) => connection.provider === 'google' && connection.status === 'connected'
  );
  $: googleConnected = googleConnections.length > 0;
  $: calendarLabelMap = new Map(calendars.map((calendar) => [calendar.id, calendar.summary]));
  $: visibleAgenda = agendaEvents.slice(0, 12);
  $: nextEvent = agendaEvents[0] ?? null;
  $: importantMail = priorityThreads.filter(isImportantMailSignal).slice(0, 5);
  $: currentMachineMode = machineModeFromPreferences($clientData.settings?.preferences);
  $: attentionItems = buildAttentionItems({
    googleConnected,
    dashboardError,
    syncStatus: $clientData.status,
    syncError: $clientData.error,
    events: agendaEvents,
    importantMail,
    jobs: $clientData.jobs,
    careerActions: $clientData.careerActions,
    studySessions: $clientData.studySessions
  }).slice(0, 8);
  $: capabilityIssues = selectCapabilityIssues(capabilitySnapshot, 4);
  $: modeRecommendations = buildModeRecommendations({
    mode: currentMachineMode,
    capabilitySnapshot,
    attentionCount: attentionItems.length
  });
  $: actionLedgerItems = actionLedgerSnapshot?.actions.slice(0, 5) ?? [];
  $: applyQueue = $clientData.jobs
    .filter((job) => ['lead', 'saved', 'watching'].includes(job.status))
    .sort((a, b) => (a.nextActionAt ?? a.updatedAt).localeCompare(b.nextActionAt ?? b.updatedAt))
    .slice(0, 4);
  $: openCareerActions = $clientData.careerActions
    .filter((action) => !action.completedAt)
    .sort((a, b) => (a.dueAt ?? a.updatedAt).localeCompare(b.dueAt ?? b.updatedAt))
    .slice(0, 4);

  function importantMailQuery(): string {
    return [
      'in:inbox newer_than:30d',
      '-category:promotions',
      '-category:social',
      '-category:forums',
      '(deadline OR due OR "action required" OR "please reply" OR interview OR appointment OR reservation OR flight OR exam OR assignment OR security OR verification)'
    ].join(' ');
  }

  function isImportantMailSignal(insight: GmailThreadInsight): boolean {
    if (insight.category === 'noise' || insight.category === 'notification') return false;
    if (isLikelyLowSignalMail(insight)) return false;
    return insight.priority >= 65 || Boolean(insight.deadlineHint);
  }

  function isLikelyLowSignalMail(insight: GmailThreadInsight): boolean {
    const text = [insight.thread.subject, insight.thread.from, insight.thread.snippet, insight.reason]
      .join(' ')
      .toLowerCase();
    if (insight.thread.labelIds.some((label) => ['CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_FORUMS'].includes(label))) {
      return !/\b(deadline|due|interview|appointment|reservation|flight|exam|assignment|security|verification|invoice|payment)\b/u.test(text);
    }
    return /\b(unsubscribe|promo|promotion|newsletter|sale|discount|sponsored|advertisement|view web version|limited time)\b/u.test(text);
  }

  function passiveCalendar(calendar: CalendarSummary): boolean {
    return /\b(holiday|birthdays?|contacts|moon|weather)\b/iu.test(calendar.summary);
  }

  function selectCalendarTargets(items: CalendarSummary[]): CalendarSummary[] {
    const targets = new Map<string, CalendarSummary>();
    for (const calendar of items.filter((item) => item.primary)) targets.set(calendar.id, calendar);
    for (const calendar of items.filter((item) => !passiveCalendar(item))) targets.set(calendar.id, calendar);
    return Array.from(targets.values()).slice(0, 6);
  }

  function eventTimeValue(event: CalendarEvent): number {
    const parsed = Date.parse(event.start);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function dedupeEvents(events: CalendarEvent[]): CalendarEvent[] {
    const byKey = new Map<string, CalendarEvent>();
    for (const event of events) byKey.set(`${event.calendarId}:${event.id}`, event);
    return Array.from(byKey.values());
  }

  function sortEvents(events: CalendarEvent[]): CalendarEvent[] {
    return events.slice().sort((a, b) => eventTimeValue(a) - eventTimeValue(b));
  }

  function displayWhen(value: string | undefined): string {
    if (!value) return 'No date';
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
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric'
    }).format(date);
  }

  function displayEventDay(event: CalendarEvent): string {
    const date = new Date(event.start);
    if (Number.isNaN(date.getTime())) return event.start;
    return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(date);
  }

  function displayEventTime(event: CalendarEvent): string {
    if (!event.start.includes('T')) return 'All day';
    const start = new Date(event.start);
    const end = new Date(event.end);
    if (Number.isNaN(start.getTime())) return event.start;
    const timeFormatter = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
    if (Number.isNaN(end.getTime())) return timeFormatter.format(start);
    return `${timeFormatter.format(start)} - ${timeFormatter.format(end)}`;
  }

  function calendarLabel(calendarId: string): string {
    return calendarLabelMap.get(calendarId) ?? 'Google Calendar';
  }

  function threadWhen(insight: GmailThreadInsight): string {
    return displayShortDate(insight.thread.date);
  }

  function mailCategoryLabel(category: GmailThreadInsight['category']): string {
    if (category === 'reply') return 'Reply';
    if (category === 'deadline') return 'Deadline';
    if (category === 'career') return 'Career';
    if (category === 'school') return 'School';
    if (category === 'finance') return 'Money';
    if (category === 'travel') return 'Travel';
    return 'Personal';
  }

  function careerJobLine(job: JobRecord): string {
    return [job.company, job.role].filter(Boolean).join(' - ');
  }

  function attentionMeta(item: AttentionItem): string {
    if (item.dueAt) return displayShortDate(item.dueAt);
    return attentionKindLabel(item.kind);
  }

  function capabilityStateLabel(state: CapabilityState): string {
    if (state === 'needs_setup') return 'setup';
    return state.replace('_', ' ');
  }

  function readyCapabilityCount(snapshot: CapabilityRegistrySnapshot): number {
    return snapshot.summary.ready + snapshot.summary.running;
  }

  function displayActivityWhen(value: string): string {
    return displayWhen(value);
  }

  function actionStatusClass(action: ActionLedgerEntry): string {
    if (action.status === 'succeeded') return 'success';
    if (action.status === 'failed' || action.status === 'blocked') return 'failed';
    if (action.status === 'running' || action.status === 'queued') return action.status;
    return action.status;
  }

  function actionRoute(action: ActionLedgerEntry): string {
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
      await Promise.all([refreshCapabilities(), refreshActionLedger()]);
    } catch (error) {
      modeActionError = error instanceof Error ? error.message : 'Recommendation action failed.';
      logModeAction(item, 'failed', {
        metadata: {
          error: modeActionError
        }
      });
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
      actionLedgerSnapshot = await loadActionLedger(12);
    } catch (error) {
      actionLedgerError = error instanceof Error ? error.message : 'Action ledger failed to load.';
    } finally {
      actionLedgerLoading = false;
    }
  }

  async function refreshDashboard(): Promise<void> {
    dashboardLoading = true;
    dashboardError = '';
    let hasGoogle = googleConnected;
    try {
      const nextConnections = await getConnections();
      connections = nextConnections;
      hasGoogle = nextConnections.some(
        (connection) => connection.provider === 'google' && connection.status === 'connected'
      );
      if (hasGoogle) {
        const now = new Date();
        const end = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
        const nextCalendars = await listCalendars();
        calendars = nextCalendars;

        const [eventResults, nextPriorityThreads] = await Promise.all([
          Promise.allSettled(
            selectCalendarTargets(nextCalendars).map((calendar) =>
              listEvents({
                calendarId: calendar.id,
                timeMin: now.toISOString(),
                timeMax: end.toISOString()
              })
            )
          ),
          listPriorityGmailThreads({ maxResults: 8, q: importantMailQuery() }).catch(() => [])
        ]);
        priorityThreads = nextPriorityThreads;
        agendaEvents = sortEvents(
          dedupeEvents(eventResults.flatMap((result) => (result.status === 'fulfilled' ? result.value : [])))
        ).slice(0, 24);
      } else {
        calendars = [];
        agendaEvents = [];
        priorityThreads = [];
      }
      lastLoadedAt = new Date().toISOString();
    } catch (error) {
      dashboardError = error instanceof Error ? error.message : 'Today dashboard failed to load.';
    } finally {
      dashboardLoading = false;
      void refreshCapabilities(hasGoogle);
      void refreshActionLedger();
    }
  }

  onMount(() => {
    void refreshDashboard();
  });
</script>

<section class="page-header today-header">
  <div>
    <p class="eyebrow">Today</p>
    <h1>Command Center</h1>
  </div>
  <div class="header-actions">
    <span class="sync-note">
      {#if dashboardLoading}
        Loading calendar...
      {:else if lastLoadedAt}
        Updated {displayShortDate(lastLoadedAt)}
      {:else}
        Ready
      {/if}
    </span>
    <button class="button" type="button" disabled={dashboardLoading} on:click={refreshDashboard}>
      <RefreshCw size={16} />
      <span>Refresh</span>
    </button>
    <a class="button" href={hubHref('/settings')}>
      <Settings size={16} />
      <span>Settings</span>
    </a>
  </div>
</section>

{#if dashboardError}
  <section class="card card-pad warning-panel">
    {dashboardError}
  </section>
{/if}

<section class="grid three signal-strip" aria-label="Today signals">
  <div>
    <span>Needs attention</span>
    <strong>{attentionItems.length}</strong>
  </div>
  <div>
    <span>Calendar events</span>
    <strong>{agendaEvents.length}</strong>
  </div>
  <div>
    <span>Capabilities ready</span>
    <strong>{capabilitySnapshot ? `${readyCapabilityCount(capabilitySnapshot)}/${capabilitySnapshot.summary.total}` : capabilityLoading ? '...' : '0'}</strong>
  </div>
</section>

<section class="home-grid" aria-label="Today command center">
  <div class="main-column">
    <article class="card panel attention-panel">
      <div class="panel-title">
        <div>
          <span class="icon-chip"><Inbox size={16} /></span>
          <strong>Needs Attention</strong>
        </div>
        <a class="button compact" href={hubHref('/settings')}>
          <span>Status</span>
          <ArrowRight size={15} />
        </a>
      </div>

      {#if attentionItems.length}
        <div class="attention-list">
          {#each attentionItems as item}
            <a class="attention-row" href={hubHref(item.route)}>
              <span class:service={item.kind === 'service'} class="attention-kind">{attentionKindLabel(item.kind)}</span>
              <span class="attention-main">
                <strong>{item.title}</strong>
                <small>{item.detail}</small>
              </span>
              <span class="attention-meta">{attentionMeta(item)}</span>
            </a>
          {/each}
        </div>
      {:else}
        <div class="empty-block">
          <strong>No urgent signals right now.</strong>
          <p>Today will fill from real calendar, mail, career, study, and local service data as those systems have something actionable.</p>
        </div>
      {/if}
    </article>

    <article class="card panel agenda-panel">
      <div class="panel-title">
        <div>
          <span class="icon-chip"><CalendarClock size={16} /></span>
          <strong>Upcoming Calendar</strong>
        </div>
        <a class="button compact" href={hubHref('/productivity')}>
          <span>Manage</span>
          <ArrowRight size={15} />
        </a>
      </div>

      {#if !googleConnected}
        <div class="empty-block">
          <strong>Connect Google to make this your live agenda.</strong>
          <p>Calendar and Gmail signals become part of the attention queue once the Productivity Hub is connected.</p>
          <a class="button compact" href={hubHref('/productivity')}>Open Productivity Hub</a>
        </div>
      {:else if dashboardLoading && !visibleAgenda.length}
        <p class="empty-note">Loading your upcoming calendar...</p>
      {:else if visibleAgenda.length}
        <div class="agenda-list">
          {#each visibleAgenda as event}
            <a
              class="agenda-row"
              href={event.htmlLink ?? hubHref('/productivity')}
              target={event.htmlLink ? '_blank' : undefined}
              rel={event.htmlLink ? 'noreferrer' : undefined}
            >
              <time datetime={event.start}>
                <strong>{displayEventDay(event)}</strong>
                <span>{displayEventTime(event)}</span>
              </time>
              <span class="agenda-main">
                <strong>{event.title}</strong>
                <small>{calendarLabel(event.calendarId)}{event.location ? ` - ${event.location}` : ''}</small>
              </span>
              <span class="agenda-meta">{event.status}</span>
            </a>
          {/each}
        </div>
      {:else}
        <p class="empty-note">No upcoming events found on your active Google calendars for the next two weeks.</p>
      {/if}
    </article>

    <article class="card panel action-ledger-panel">
      <div class="panel-title">
        <div>
          <span class="icon-chip"><Activity size={16} /></span>
          <strong>Recent Actions</strong>
        </div>
        <a class="button compact" href={hubHref('/settings')}>
          <span>Ledger</span>
          <ArrowRight size={15} />
        </a>
      </div>

      {#if actionLedgerItems.length}
        <div class="ai-activity-list">
          {#each actionLedgerItems as item}
            <a class="ai-activity-row" href={hubHref(actionRoute(item))}>
              <span class={`activity-state ${actionStatusClass(item)}`}>{actionLedgerStatusLabel(item.status)}</span>
              <span class="activity-main">
                <strong>{item.summary}</strong>
                <small>{actionLedgerDetail(item)}</small>
              </span>
              <span class={`risk-chip ${item.risk}`}>{actionLedgerRiskLabel(item.risk)}</span>
              <time datetime={item.occurredAt}>{displayActivityWhen(item.occurredAt)}</time>
            </a>
          {/each}
        </div>
      {:else if actionLedgerLoading}
        <p class="empty-note">Loading recent app actions, AI OS logs, and Macro Lab runs...</p>
      {:else if actionLedgerError}
        <p class="empty-note">{actionLedgerError}</p>
      {:else}
        <p class="empty-note">No meaningful actions are logged yet. Saves, benchmarks, backups, tools, and macros will appear here.</p>
      {/if}
      {#if actionLedgerSnapshot?.errors.length}
        <p class="ledger-warning">{actionLedgerSnapshot.errors[0]}</p>
      {/if}
    </article>
  </div>

  <aside class="side-rail">
    <article class="card panel mode-panel">
      <div class="panel-title">
        <div>
          <span class="icon-chip"><Cpu size={16} /></span>
          <strong>Machine Mode</strong>
        </div>
        <a class="button compact" href={hubHref('/settings')}>
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
          {#each modeRecommendations as item}
            <div class="mode-rec-row">
              <a class="mode-rec-link" href={hubHref(item.route)}>
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
                  disabled={Boolean(modeActionBusyId)}
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
        <p class="mode-action-note error">{modeActionError}</p>
      {:else if modeActionMessage}
        <p class="mode-action-note success">{modeActionMessage}</p>
      {/if}
    </article>

    <article class="card panel next-panel">
      <div class="panel-title">
        <div>
          <span class="icon-chip"><CalendarClock size={16} /></span>
          <strong>Next Up</strong>
        </div>
      </div>
      {#if nextEvent}
        <div class="next-event">
          <strong>{nextEvent.title}</strong>
          <span>{displayWhen(nextEvent.start)}</span>
          <small>{calendarLabel(nextEvent.calendarId)}{nextEvent.location ? ` - ${nextEvent.location}` : ''}</small>
        </div>
      {:else}
        <p class="empty-note">No calendar item is currently queued.</p>
      {/if}
    </article>

    <article class="card panel mail-panel">
      <div class="panel-title">
        <div>
          <span class="icon-chip"><Inbox size={16} /></span>
          <strong>Important Mail</strong>
        </div>
        <a class="button compact" href={hubHref('/productivity')}>
          <span>Inbox</span>
          <ArrowRight size={15} />
        </a>
      </div>

      {#if !googleConnected}
        <p class="empty-note">Connect Google before mail triage can run.</p>
      {:else if dashboardLoading && !importantMail.length}
        <p class="empty-note">Checking only action-heavy mail...</p>
      {:else if importantMail.length}
        <div class="mail-list">
          {#each importantMail as insight}
            <a class="mail-row" href={hubHref('/productivity')}>
              <span class="mail-tag">{mailCategoryLabel(insight.category)}</span>
              <span class="mail-main">
                <strong>{insight.thread.subject}</strong>
                <small>{insight.thread.from}</small>
              </span>
              <small class="mail-when">{threadWhen(insight)}</small>
              <span class="reason">{insight.reason}{insight.deadlineHint ? ` - ${insight.deadlineHint}` : ''}</span>
            </a>
          {/each}
        </div>
      {:else}
        <p class="empty-note">No mail was important enough for the home view. Good, honestly.</p>
      {/if}
    </article>

    <article class="card panel capability-health-panel">
      <div class="panel-title">
        <div>
          <span class="icon-chip"><Activity size={16} /></span>
          <strong>Capability Health</strong>
        </div>
        <a class="button compact" href={hubHref('/settings')}>
          <span>Fix</span>
          <ArrowRight size={15} />
        </a>
      </div>

      {#if capabilitySnapshot}
        <div class="capability-summary">
          <div>
            <strong>{readyCapabilityCount(capabilitySnapshot)}/{capabilitySnapshot.summary.total}</strong>
            <span>usable now</span>
          </div>
          <div>
            <strong>{capabilitySnapshot.summary.localReady}</strong>
            <span>local ready</span>
          </div>
          <div>
            <strong>{capabilitySnapshot.summary.offline + capabilitySnapshot.summary.degraded + capabilitySnapshot.summary.blocked}</strong>
            <span>need repair</span>
          </div>
        </div>
        {#if capabilityIssues.length}
          <div class="capability-issue-list">
            {#each capabilityIssues as capability}
              <a class="capability-issue-row" href={hubHref(capability.route)}>
                <span class={`capability-state ${capability.state}`}>{capabilityStateLabel(capability.state)}</span>
                <span>
                  <strong>{capability.label}</strong>
                  <small>{capability.lastError ?? capability.description}</small>
                </span>
              </a>
            {/each}
          </div>
        {:else}
          <p class="empty-note">Core services look ready. The machine is in a usable state.</p>
        {/if}
      {:else if capabilityLoading}
        <p class="empty-note">Checking local services and providers...</p>
      {:else if capabilityError}
        <p class="empty-note">{capabilityError}</p>
      {:else}
        <p class="empty-note">Capability status has not been checked yet.</p>
      {/if}
    </article>

    <article class="card panel career-panel">
      <div class="panel-title">
        <div>
          <span class="icon-chip"><BriefcaseBusiness size={16} /></span>
          <strong>Career Focus</strong>
        </div>
        <a class="button compact" href={hubHref('/desk/career')}>
          <span>Review</span>
          <ArrowRight size={15} />
        </a>
      </div>

      {#if applyQueue.length || openCareerActions.length}
        <div class="career-list">
          {#each openCareerActions as action}
            <a class="career-row" href={hubHref('/desk/career')}>
              <strong>{action.label}</strong>
              <small>{action.dueAt ? displayShortDate(action.dueAt) : 'No due date'}</small>
            </a>
          {/each}
          {#each applyQueue as job}
            <a class="career-row" href={hubHref('/desk/career')}>
              <strong>{careerJobLine(job)}</strong>
              <small>{job.status}{job.nextActionAt ? ` - ${displayShortDate(job.nextActionAt)}` : ''}</small>
            </a>
          {/each}
        </div>
      {:else}
        <p class="empty-note">No dated career actions are queued in the new workspace yet.</p>
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
      <a class="launch-card" href={hubHref(entry.route)}>
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
    font-weight: 650;
  }

  .warning-panel {
    margin-bottom: 10px;
    border-color: var(--warning-border);
    color: var(--warning-text);
    background: var(--warning-bg);
  }

  .signal-strip {
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

  .home-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.6fr) minmax(300px, 0.7fr);
    gap: 10px;
    align-items: start;
  }

  .main-column {
    display: grid;
    gap: 10px;
    min-width: 0;
  }

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
  .empty-block p {
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

  .empty-block strong {
    font-size: 14px;
  }

  .attention-list,
  .agenda-list,
  .ai-activity-list,
  .mail-list,
  .career-list {
    display: grid;
  }

  .attention-row,
  .agenda-row,
  .ai-activity-row,
  .mail-row,
  .career-row {
    color: var(--text);
    text-decoration: none;
  }

  .attention-row {
    display: grid;
    grid-template-columns: 86px minmax(0, 1fr) 76px;
    gap: 10px;
    align-items: center;
    min-height: 62px;
    padding: 10px;
    border-bottom: 1px solid var(--border);
  }

  .agenda-row {
    display: grid;
    grid-template-columns: 128px minmax(0, 1fr) 92px;
    gap: 10px;
    align-items: center;
    min-height: 68px;
    padding: 10px;
    border-bottom: 1px solid var(--border);
  }

  .attention-row:hover,
  .agenda-row:hover,
  .ai-activity-row:hover,
  .mail-row:hover,
  .career-row:hover {
    background: var(--active);
  }

  .attention-kind {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: fit-content;
    min-width: 66px;
    min-height: 22px;
    padding: 2px 7px;
    border: 1px solid var(--border);
    border-radius: 999px;
    color: var(--muted);
    background: var(--surface-muted);
    font-size: 12px;
    font-weight: 750;
  }

  .attention-kind.service {
    border-color: var(--warning-border);
    color: var(--warning-text);
    background: var(--warning-bg);
  }

  .agenda-row time {
    display: grid;
    gap: 3px;
    color: var(--muted);
    font-size: 12px;
  }

  .agenda-row time strong {
    color: var(--text);
    font-size: 13px;
  }

  .attention-main,
  .agenda-main,
  .mail-main {
    display: grid;
    min-width: 0;
    gap: 3px;
  }

  .attention-main strong,
  .agenda-main strong,
  .mail-main strong,
  .career-row strong,
  .next-event strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .attention-main small,
  .attention-meta,
  .agenda-main small,
  .agenda-meta,
  .mail-main small,
  .mail-when,
  .reason,
  .career-row small,
  .next-event span,
  .next-event small {
    overflow: hidden;
    color: var(--muted);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .agenda-meta {
    justify-self: end;
    font-size: 12px;
    font-weight: 700;
    text-transform: capitalize;
  }

  .ai-activity-row {
    display: grid;
    grid-template-columns: 78px minmax(0, 1fr) 82px 116px;
    gap: 10px;
    align-items: center;
    min-height: 58px;
    padding: 9px 10px;
    border-bottom: 1px solid var(--border);
  }

  .activity-state {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: fit-content;
    min-width: 66px;
    min-height: 22px;
    padding: 2px 7px;
    border: 1px solid var(--border);
    border-radius: 999px;
    color: var(--muted);
    background: var(--surface-muted);
    font-size: 11px;
    font-weight: 800;
  }

  .activity-state.success {
    border-color: var(--success-border);
    color: var(--success-text);
    background: var(--success-bg);
  }

  .activity-state.failed {
    border-color: var(--error-border);
    color: var(--error-text);
    background: var(--error-bg);
  }

  .activity-state.running,
  .activity-state.queued {
    border-color: var(--warning-border);
    color: var(--warning-text);
    background: var(--warning-bg);
  }

  .activity-state.dry_run,
  .activity-state.info,
  .activity-state.cancelled {
    border-color: var(--border);
    color: var(--muted);
    background: var(--surface-muted);
  }

  .activity-main {
    display: grid;
    gap: 3px;
    min-width: 0;
  }

  .activity-main strong,
  .activity-main small,
  .ai-activity-row time {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .activity-main small,
  .ai-activity-row time {
    color: var(--muted);
  }

  .ai-activity-row time {
    justify-self: end;
    font-size: 12px;
    font-weight: 700;
  }

  .risk-chip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: fit-content;
    min-width: 66px;
    min-height: 22px;
    justify-self: end;
    padding: 2px 7px;
    border: 1px solid var(--border);
    border-radius: 999px;
    color: var(--muted);
    background: var(--surface-muted);
    font-size: 11px;
    font-weight: 800;
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

  .ledger-warning {
    margin: 0;
    padding: 9px 10px;
    border-top: 1px solid var(--border);
    color: var(--warning-text);
    background: var(--warning-bg);
    font-size: 12px;
    font-weight: 700;
    line-height: 1.35;
  }

  .attention-meta {
    justify-self: end;
    font-size: 12px;
    font-weight: 700;
  }

  .next-event {
    display: grid;
    gap: 5px;
    padding: 12px;
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
    min-height: 62px;
    border-bottom: 1px solid var(--border);
  }

  .mode-rec-link {
    display: grid;
    grid-template-columns: 70px minmax(0, 1fr) 16px;
    gap: 8px;
    align-items: center;
    min-height: 62px;
    padding: 9px 10px;
    color: var(--text);
    text-decoration: none;
  }

  .mode-rec-link:hover {
    background: var(--active);
  }

  .mode-action-button {
    margin-right: 10px;
    white-space: nowrap;
  }

  .mode-action-note {
    margin: 0;
    padding: 10px;
    border-top: 1px solid var(--border);
    color: var(--muted);
    font-weight: 700;
    line-height: 1.35;
  }

  .mode-action-note.success {
    color: var(--success-text);
    background: var(--success-bg);
  }

  .mode-action-note.error {
    color: var(--error-text);
    background: var(--error-bg);
  }

  .mode-rec-tag {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: fit-content;
    min-width: 58px;
    min-height: 22px;
    padding: 2px 6px;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 999px;
    color: var(--muted);
    background: var(--surface-muted);
    font-size: 11px;
    font-weight: 800;
    text-overflow: ellipsis;
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

  .next-event strong {
    font-size: 15px;
  }

  .mail-row {
    display: grid;
    grid-template-columns: 72px minmax(0, 1fr) 54px;
    gap: 5px 8px;
    padding: 10px;
    border-bottom: 1px solid var(--border);
  }

  .mail-tag {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: fit-content;
    min-height: 22px;
    padding: 2px 7px;
    border: 1px solid var(--border);
    border-radius: 999px;
    color: var(--muted);
    background: var(--surface-muted);
    font-size: 12px;
    font-weight: 750;
  }

  .mail-when {
    justify-self: end;
    font-size: 12px;
  }

  .reason {
    grid-column: 2 / 4;
    font-size: 12px;
  }

  .capability-summary {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0;
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

  .capability-summary strong {
    overflow: hidden;
    font-size: 15px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .capability-summary span {
    overflow: hidden;
    color: var(--muted);
    font-size: 11px;
    font-weight: 750;
    text-overflow: ellipsis;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .capability-issue-list {
    display: grid;
  }

  .capability-issue-row {
    display: grid;
    grid-template-columns: 76px minmax(0, 1fr);
    gap: 8px;
    align-items: center;
    min-height: 54px;
    padding: 9px 10px;
    border-bottom: 1px solid var(--border);
    color: var(--text);
    text-decoration: none;
  }

  .capability-issue-row:hover {
    background: var(--active);
  }

  .capability-issue-row > span:last-child {
    display: grid;
    gap: 2px;
    min-width: 0;
  }

  .capability-issue-row strong,
  .capability-issue-row small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .capability-issue-row small {
    color: var(--muted);
  }

  .capability-state {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: fit-content;
    min-width: 64px;
    min-height: 22px;
    padding: 2px 6px;
    border: 1px solid var(--border);
    border-radius: 999px;
    color: var(--muted);
    background: var(--surface-muted);
    font-size: 11px;
    font-weight: 800;
  }

  .capability-state.offline,
  .capability-state.blocked {
    border-color: var(--danger-border);
    color: var(--danger-text);
    background: var(--danger-bg);
  }

  .capability-state.degraded,
  .capability-state.needs_setup {
    border-color: var(--warning-border);
    color: var(--warning-text);
    background: var(--warning-bg);
  }

  .career-row {
    display: grid;
    gap: 3px;
    padding: 9px 10px;
    border-bottom: 1px solid var(--border);
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

  .launch-card strong {
    font-size: 14px;
  }

  .launch-card span,
  .launch-card p {
    margin: 0;
    color: var(--muted);
  }

  .launch-card :global(svg) {
    align-self: end;
    justify-self: end;
  }

  @media (max-width: 1040px) {
    .home-grid {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 820px) {
    .today-header {
      align-items: stretch;
    }

    .header-actions {
      justify-content: flex-start;
    }

    .agenda-row {
      grid-template-columns: 92px minmax(0, 1fr);
    }

    .ai-activity-row {
      grid-template-columns: 72px minmax(0, 1fr);
    }

    .attention-row {
      grid-template-columns: 76px minmax(0, 1fr);
    }

    .attention-meta {
      grid-column: 2;
      justify-self: start;
    }

    .agenda-meta {
      grid-column: 2;
      justify-self: start;
    }

    .ai-activity-row time {
      grid-column: 2;
      justify-self: start;
    }

    .risk-chip {
      grid-column: 2;
      justify-self: start;
    }

    .mail-row {
      grid-template-columns: 66px minmax(0, 1fr);
    }

    .mail-when {
      grid-column: 2;
      justify-self: start;
    }

    .reason {
      grid-column: 2;
    }
  }
</style>
