<script lang="ts">
  import { onMount } from 'svelte';
  import {
    ArrowRight,
    BriefcaseBusiness,
    CalendarClock,
    RefreshCw,
    Settings,
    Sparkles
  } from 'lucide-svelte';
  import { launcherEntries, type JobRecord, type TimelineItem } from '@mini-hub/core';
  import { statusLabel } from '@mini-hub/ui';
  import { clientData } from '$lib/client-data';
  import { hubHref } from '$lib/routes';
  import {
    getConnections,
    getTimeline,
    listPriorityGmailThreads,
    type GmailThreadInsight,
    type PublicConnection
  } from '$lib/productivity-api';

  let connections: PublicConnection[] = [];
  let priorityThreads: GmailThreadInsight[] = [];
  let timeline: TimelineItem[] = [];
  let dashboardLoading = false;
  let dashboardError = '';
  let lastLoadedAt = '';

  $: googleConnections = connections.filter(
    (connection) => connection.provider === 'google' && connection.status === 'connected'
  );
  $: googleConnected = googleConnections.length > 0;
  $: applyQueue = $clientData.jobs
    .filter((job) => ['lead', 'saved', 'watching'].includes(job.status))
    .sort((a, b) => (a.nextActionAt ?? a.updatedAt).localeCompare(b.nextActionAt ?? b.updatedAt))
    .slice(0, 5);
  $: openCareerActions = $clientData.careerActions
    .filter((action) => !action.completedAt)
    .sort((a, b) => (a.dueAt ?? a.updatedAt).localeCompare(b.dueAt ?? b.updatedAt))
    .slice(0, 5);
  $: careerMailSignals = priorityThreads.filter((insight) => isCareerSignal(insight)).slice(0, 3);
  $: visibleTimeline = timeline.slice(0, 7);

  function isCareerSignal(insight: GmailThreadInsight): boolean {
    if (insight.category === 'career') return true;
    const text = [insight.thread.subject, insight.thread.from, insight.thread.snippet].join(' ').toLowerCase();
    return /\b(interview|application|recruiter|hiring|offer|resume|job)\b/u.test(text);
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

  function threadWhen(insight: GmailThreadInsight): string {
    return displayShortDate(insight.thread.date);
  }

  function priorityLabel(priority: number): string {
    if (priority >= 80) return 'High';
    if (priority >= 60) return 'Medium';
    return 'Watch';
  }

  function sourceLabel(source: GmailThreadInsight['source']): string {
    return source === 'ollama' ? 'Ollama' : 'Rules fallback';
  }

  function timelineKind(item: TimelineItem): string {
    if (item.kind === 'email_action') return 'Email';
    if (item.kind === 'deadline') return 'Deadline';
    if (item.kind === 'task') return 'Task';
    return 'Event';
  }

  function careerJobLine(job: JobRecord): string {
    return [job.company, job.role].filter(Boolean).join(' - ');
  }

  async function refreshDashboard(): Promise<void> {
    dashboardLoading = true;
    dashboardError = '';
    try {
      const nextConnections = await getConnections();
      connections = nextConnections;
      const hasGoogle = nextConnections.some(
        (connection) => connection.provider === 'google' && connection.status === 'connected'
      );
      if (hasGoogle) {
        const now = new Date();
        const end = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
        const [nextPriorityThreads, nextTimeline] = await Promise.all([
          listPriorityGmailThreads({ maxResults: 8 }),
          getTimeline({ timeMin: now.toISOString(), timeMax: end.toISOString() })
        ]);
        priorityThreads = nextPriorityThreads;
        timeline = nextTimeline;
      } else {
        priorityThreads = [];
        timeline = [];
      }
      lastLoadedAt = new Date().toISOString();
    } catch (error) {
      dashboardError = error instanceof Error ? error.message : 'Today dashboard failed to load.';
    } finally {
      dashboardLoading = false;
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
        Sorting...
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
    <span>Google accounts</span>
    <strong>{googleConnections.length}</strong>
  </div>
  <div>
    <span>Priority mail</span>
    <strong>{priorityThreads.length}</strong>
  </div>
  <div>
    <span>Upcoming items</span>
    <strong>{timeline.length}</strong>
  </div>
</section>

<section class="grid dashboard-grid" aria-label="Today dashboard">
  <article class="card panel priority-panel">
    <div class="panel-title">
      <div>
        <span class="icon-chip"><Sparkles size={16} /></span>
        <strong>Important Mail</strong>
      </div>
      <a class="button compact" href={hubHref('/productivity')}>
        <span>Open Hub</span>
        <ArrowRight size={15} />
      </a>
    </div>

    {#if !googleConnected}
      <p class="empty-note">Connect Google in the Hub to sort personal and school inboxes.</p>
    {:else if dashboardLoading && !priorityThreads.length}
      <p class="empty-note">Sorting recent inbox threads...</p>
    {:else if priorityThreads.length}
      <div class="mail-list">
        {#each priorityThreads as insight}
          <a class="mail-row" href={hubHref('/productivity')}>
            <span class="score">{priorityLabel(insight.priority)}</span>
            <span class="mail-main">
              <strong>{insight.thread.subject}</strong>
              <small>{insight.thread.from}</small>
            </span>
            <span class="mail-meta">
              <small>{insight.category}</small>
              <small>{threadWhen(insight)}</small>
            </span>
            <span class="reason">{insight.reason}{insight.deadlineHint ? ` - ${insight.deadlineHint}` : ''}</span>
            <span class="source">{sourceLabel(insight.source)}</span>
          </a>
        {/each}
      </div>
    {:else}
      <p class="empty-note">No high-signal inbox threads found in the recent window.</p>
    {/if}
  </article>

  <article class="card panel timeline-panel">
    <div class="panel-title">
      <div>
        <span class="icon-chip"><CalendarClock size={16} /></span>
        <strong>Deadlines & Timeline</strong>
      </div>
      <a class="button compact" href={hubHref('/productivity')}>
        <span>Manage</span>
        <ArrowRight size={15} />
      </a>
    </div>

    {#if !googleConnected}
      <p class="empty-note">Calendar and Gmail action items appear here after Google is connected.</p>
    {:else if visibleTimeline.length}
      <div class="timeline-list">
        {#each visibleTimeline as item}
          <a class="timeline-row" href={item.actionUrl ?? hubHref('/productivity')} target={item.actionUrl ? '_blank' : undefined} rel={item.actionUrl ? 'noreferrer' : undefined}>
            <span>{timelineKind(item)}</span>
            <strong>{item.title}</strong>
            <small>{displayWhen(item.when)}</small>
          </a>
        {/each}
      </div>
    {:else}
      <p class="empty-note">No deadlines or calendar items loaded for the next two weeks.</p>
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

    <div class="career-columns">
      <div>
        <h2>Apply Queue</h2>
        {#if applyQueue.length}
          {#each applyQueue as job}
            <a class="career-row" href={hubHref('/desk/career')}>
              <strong>{careerJobLine(job)}</strong>
              <small>{job.status} {job.nextActionAt ? `- ${displayShortDate(job.nextActionAt)}` : ''}</small>
            </a>
          {/each}
        {:else}
          <p class="empty-note">No saved jobs are queued in the new workspace yet.</p>
        {/if}
      </div>

      <div>
        <h2>Updates</h2>
        {#if openCareerActions.length}
          {#each openCareerActions as action}
            <a class="career-row" href={hubHref('/desk/career')}>
              <strong>{action.label}</strong>
              <small>{action.dueAt ? displayShortDate(action.dueAt) : 'No due date'}</small>
            </a>
          {/each}
        {:else if careerMailSignals.length}
          {#each careerMailSignals as insight}
            <a class="career-row" href={hubHref('/productivity')}>
              <strong>{insight.thread.subject}</strong>
              <small>{insight.reason}</small>
            </a>
          {/each}
        {:else}
          <p class="empty-note">No open follow-ups or career email signals surfaced.</p>
        {/if}
      </div>
    </div>
  </article>
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

  .dashboard-grid {
    grid-template-columns: minmax(0, 1.3fr) minmax(280px, 0.9fr);
    align-items: start;
  }

  .panel {
    min-width: 0;
    overflow: hidden;
  }

  .priority-panel {
    grid-row: span 2;
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

  .empty-note {
    margin: 0;
    padding: 12px;
    color: var(--muted);
  }

  .mail-list,
  .timeline-list {
    display: grid;
  }

  .mail-row,
  .timeline-row,
  .career-row {
    color: var(--text);
    text-decoration: none;
  }

  .mail-row {
    display: grid;
    grid-template-columns: 74px minmax(0, 1fr) 82px;
    gap: 8px 10px;
    padding: 10px;
    border-bottom: 1px solid var(--border);
  }

  .mail-row:hover,
  .timeline-row:hover,
  .career-row:hover {
    background: var(--active);
  }

  .score,
  .source {
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

  .mail-main {
    display: grid;
    min-width: 0;
    gap: 2px;
  }

  .mail-main strong,
  .career-row strong,
  .timeline-row strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mail-main small,
  .mail-meta small,
  .reason,
  .source,
  .timeline-row small,
  .career-row small {
    overflow: hidden;
    color: var(--muted);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mail-meta {
    display: grid;
    gap: 2px;
    text-align: right;
  }

  .reason {
    grid-column: 2 / 4;
    font-size: 12px;
  }

  .source {
    grid-column: 1;
    grid-row: 2;
  }

  .timeline-row {
    display: grid;
    grid-template-columns: 78px minmax(0, 1fr);
    gap: 3px 10px;
    padding: 10px;
    border-bottom: 1px solid var(--border);
  }

  .timeline-row span {
    grid-row: span 2;
    color: var(--muted);
    font-size: 12px;
    font-weight: 750;
  }

  .career-panel {
    grid-column: 2;
  }

  .career-columns {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0;
  }

  .career-columns > div + div {
    border-left: 1px solid var(--border);
  }

  .career-columns h2 {
    margin: 0;
    padding: 9px 10px 4px;
    color: var(--muted);
    font-size: 12px;
    letter-spacing: 0;
    text-transform: uppercase;
  }

  .career-row {
    display: grid;
    gap: 3px;
    padding: 8px 10px;
    border-top: 1px solid var(--border);
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
    .dashboard-grid,
    .career-panel {
      grid-template-columns: 1fr;
      grid-column: auto;
    }

    .priority-panel {
      grid-row: auto;
    }
  }

  @media (max-width: 820px) {
    .today-header {
      align-items: stretch;
    }

    .header-actions {
      justify-content: flex-start;
    }

    .mail-row {
      grid-template-columns: 68px minmax(0, 1fr);
    }

    .mail-meta {
      grid-column: 2;
      grid-row: 2;
      display: flex;
      justify-content: space-between;
      text-align: left;
    }

    .reason {
      grid-column: 2;
    }

    .source {
      grid-row: 3;
    }

    .career-columns {
      grid-template-columns: 1fr;
    }

    .career-columns > div + div {
      border-top: 1px solid var(--border);
      border-left: 0;
    }
  }
</style>
