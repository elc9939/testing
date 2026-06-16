<script lang="ts">
  import { onMount } from 'svelte';
  import {
    CalendarPlus,
    ExternalLink,
    Link,
    RefreshCw,
    Save,
    Send,
    Trash2,
    Unlink
  } from 'lucide-svelte';
  import type { CalendarEvent, TimelineItem } from '@mini-hub/core';
  import { canAutoSave, clientData } from '$lib/client-data';
  import {
    createEvent,
    deleteEvent,
    getCatalog,
    getConnections,
    getGoogleOAuthUrl,
    getTimeline,
    listCalendars,
    listEvents,
    moveEvent,
    revokeGoogle,
    updateEvent,
    type CalendarEventDraft,
    type CalendarSummary,
    type ConnectorCatalogEntry,
    type PublicConnection
  } from '$lib/productivity-api';

  const localTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles';

  let catalog: ConnectorCatalogEntry[] = [];
  let connections: PublicConnection[] = [];
  let calendars: CalendarSummary[] = [];
  let events: CalendarEvent[] = [];
  let timeline: TimelineItem[] = [];
  let selectedCalendarId = 'primary';
  let moveTargetCalendarId = '';
  let query = '';
  let loading = false;
  let actionError = '';
  let actionMessage = '';
  let editingEventId = '';
  let eventDraft = emptyDraft();

  $: canAct = canAutoSave($clientData);
  $: googleConnection = connections.find((connection) => connection.provider === 'google');
  $: googleConnected = googleConnection?.status === 'connected';

  function emptyDraft(): CalendarEventDraft {
    const start = new Date(Date.now() + 60 * 60 * 1000);
    start.setMinutes(0, 0, 0);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    return {
      calendarId: selectedCalendarId,
      title: '',
      description: '',
      location: '',
      start: toLocalInput(start.toISOString()),
      end: toLocalInput(end.toISOString()),
      timeZone: localTimeZone,
      recurrence: [],
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 10 }] }
    };
  }

  function toLocalInput(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const offset = date.getTimezoneOffset() * 60_000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
  }

  function fromLocalInput(value: string): string {
    return new Date(value).toISOString();
  }

  function displayTime(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
  }

  function draftForApi(): CalendarEventDraft {
    return {
      ...eventDraft,
      calendarId: selectedCalendarId,
      start: fromLocalInput(eventDraft.start),
      end: fromLocalInput(eventDraft.end),
      recurrence: eventDraft.recurrence?.filter(Boolean) ?? [],
      reminders: eventDraft.reminders
    };
  }

  function setError(error: unknown, fallback: string): void {
    actionError = error instanceof Error ? error.message : fallback;
  }

  async function loadOverview(): Promise<void> {
    loading = true;
    actionError = '';
    try {
      catalog = await getCatalog();
      connections = await getConnections();
      if (connections.some((connection) => connection.provider === 'google' && connection.status === 'connected')) {
        calendars = await listCalendars();
        selectedCalendarId = calendars.find((calendar) => calendar.primary)?.id ?? calendars[0]?.id ?? 'primary';
        moveTargetCalendarId = calendars.find((calendar) => calendar.id !== selectedCalendarId)?.id ?? '';
        eventDraft = { ...eventDraft, calendarId: selectedCalendarId, timeZone: calendars[0]?.timeZone ?? localTimeZone };
        await refreshEvents();
      }
    } catch (error) {
      setError(error, 'Failed to load productivity hub');
    } finally {
      loading = false;
    }
  }

  async function refreshEvents(): Promise<void> {
    if (!googleConnected) return;
    actionError = '';
    const now = new Date();
    const rangeEnd = new Date(now.getTime() + 21 * 24 * 60 * 60 * 1000);
    try {
      events = await listEvents({
        calendarId: selectedCalendarId,
        timeMin: now.toISOString(),
        timeMax: rangeEnd.toISOString(),
        q: query.trim() || undefined
      });
      timeline = await getTimeline({ timeMin: now.toISOString(), timeMax: rangeEnd.toISOString() });
    } catch (error) {
      setError(error, 'Failed to refresh events');
    }
  }

  async function connectGoogle(): Promise<void> {
    actionError = '';
    try {
      const url = await getGoogleOAuthUrl();
      window.location.href = url;
    } catch (error) {
      setError(error, 'Google OAuth is not configured');
    }
  }

  async function disconnectGoogle(): Promise<void> {
    if (!confirm('Revoke the stored Google OAuth grant for this hub?')) return;
    actionError = '';
    try {
      await revokeGoogle();
      actionMessage = 'Google connection revoked.';
      await loadOverview();
    } catch (error) {
      setError(error, 'Failed to revoke Google connection');
    }
  }

  async function saveEvent(): Promise<void> {
    if (!eventDraft.title.trim() || !eventDraft.start || !eventDraft.end) return;
    actionError = '';
    try {
      if (editingEventId) {
        await updateEvent({ ...draftForApi(), eventId: editingEventId });
        actionMessage = 'Event updated.';
      } else {
        await createEvent(draftForApi());
        actionMessage = 'Event created.';
      }
      editingEventId = '';
      eventDraft = emptyDraft();
      await refreshEvents();
    } catch (error) {
      setError(error, 'Failed to save event');
    }
  }

  function editEvent(event: CalendarEvent): void {
    editingEventId = event.id;
    selectedCalendarId = event.calendarId;
    eventDraft = {
      calendarId: event.calendarId,
      eventId: event.id,
      title: event.title,
      description: event.description,
      location: event.location,
      start: toLocalInput(event.start),
      end: toLocalInput(event.end),
      timeZone: event.timeZone || localTimeZone,
      recurrence: event.recurrence,
      reminders: event.reminders
    };
  }

  async function removeEvent(event: CalendarEvent): Promise<void> {
    if (!confirm(`Delete "${event.title}" from ${event.calendarId}?`)) return;
    actionError = '';
    try {
      await deleteEvent(event.calendarId, event.id);
      actionMessage = 'Event deleted.';
      await refreshEvents();
    } catch (error) {
      setError(error, 'Failed to delete event');
    }
  }

  async function moveSelectedEvent(event: CalendarEvent): Promise<void> {
    if (!moveTargetCalendarId || moveTargetCalendarId === event.calendarId) return;
    actionError = '';
    try {
      await moveEvent(event.calendarId, event.id, moveTargetCalendarId);
      actionMessage = 'Event moved.';
      await refreshEvents();
    } catch (error) {
      setError(error, 'Failed to move event');
    }
  }

  onMount(() => {
    void clientData.init();
    void loadOverview();
  });
</script>

<section class="page-header">
  <div>
    <p class="eyebrow">Command Center</p>
    <h1>Productivity Hub</h1>
  </div>
  <div class="action-row">
    <button class="button" type="button" disabled={!canAct || loading} on:click={loadOverview}>
      <RefreshCw size={17} />
      <span>Refresh</span>
    </button>
    {#if googleConnected}
      <button class="button" type="button" disabled={!canAct} on:click={disconnectGoogle}>
        <Unlink size={17} />
        <span>Revoke Google</span>
      </button>
    {:else}
      <button class="button primary" type="button" disabled={!canAct} on:click={connectGoogle}>
        <Link size={17} />
        <span>Connect Google</span>
      </button>
    {/if}
  </div>
</section>

{#if !canAct}
  <section class="card card-pad offline-banner">Sync key required: productivity actions need the private API key before OAuth or calendar writes can run.</section>
{/if}
{#if actionError}
  <section class="card card-pad error-banner">{actionError}</section>
{:else if actionMessage}
  <section class="card card-pad success-banner">{actionMessage}</section>
{/if}

<section class="grid three">
  <div class="card card-pad metric">
    <span>Google</span>
    <strong>{googleConnected ? 'Connected' : 'Not connected'}</strong>
    <p class="muted">{googleConnection?.accountLabel ?? 'OAuth required for real actions.'}</p>
  </div>
  <div class="card card-pad metric">
    <span>Calendars</span>
    <strong>{calendars.length}</strong>
    <p class="muted">List, create, edit, delete, move, reminders.</p>
  </div>
  <div class="card card-pad metric">
    <span>Timeline</span>
    <strong>{timeline.length}</strong>
    <p class="muted">Unified event/deadline surface.</p>
  </div>
</section>

<section class="connector-grid" aria-label="Integration catalog">
  {#each catalog as connector}
    <article class="connector-card">
      <div>
        <strong>{connector.label}</strong>
        <span class:implemented={connector.status === 'implemented'}>{connector.status}</span>
      </div>
      <p>{connector.notes}</p>
    </article>
  {/each}
</section>

<section class="workspace-grid">
  <form class="card card-pad event-form" on:submit|preventDefault={saveEvent}>
    <div class="form-title">
      <CalendarPlus size={18} />
      <strong>{editingEventId ? 'Edit Event' : 'Create Event'}</strong>
    </div>
    <div class="field">
      <label for="calendar">Calendar</label>
      <select id="calendar" bind:value={selectedCalendarId} disabled={!googleConnected} on:change={refreshEvents}>
        <option value="primary">Primary</option>
        {#each calendars as calendar}
          <option value={calendar.id}>{calendar.summary}</option>
        {/each}
      </select>
    </div>
    <div class="field">
      <label for="event-title">Title</label>
      <input id="event-title" bind:value={eventDraft.title} disabled={!googleConnected} />
    </div>
    <div class="field">
      <label for="event-start">Start</label>
      <input id="event-start" bind:value={eventDraft.start} disabled={!googleConnected} type="datetime-local" />
    </div>
    <div class="field">
      <label for="event-end">End</label>
      <input id="event-end" bind:value={eventDraft.end} disabled={!googleConnected} type="datetime-local" />
    </div>
    <div class="field">
      <label for="event-zone">Time zone</label>
      <input id="event-zone" bind:value={eventDraft.timeZone} disabled={!googleConnected} />
    </div>
    <div class="field">
      <label for="event-location">Location</label>
      <input id="event-location" bind:value={eventDraft.location} disabled={!googleConnected} />
    </div>
    <div class="field">
      <label for="event-reminder">Reminder minutes</label>
      <input id="event-reminder" bind:value={eventDraft.reminders.overrides[0].minutes} disabled={!googleConnected} type="number" min="0" step="5" />
    </div>
    <div class="field wide">
      <label for="event-description">Description</label>
      <textarea id="event-description" bind:value={eventDraft.description} disabled={!googleConnected} rows="3"></textarea>
    </div>
    <div class="field wide">
      <label for="event-recurrence">Recurrence rules</label>
      <textarea
        id="event-recurrence"
        disabled={!googleConnected}
        rows="2"
        placeholder="RRULE:FREQ=WEEKLY;COUNT=6"
        value={(eventDraft.recurrence ?? []).join('\n')}
        on:input={(event) => (eventDraft.recurrence = event.currentTarget.value.split('\n').map((line) => line.trim()).filter(Boolean))}
      ></textarea>
    </div>
    <div class="action-row">
      <button class="button primary" type="submit" disabled={!googleConnected || !canAct}>
        <Save size={17} />
        <span>{editingEventId ? 'Update Event' : 'Create Event'}</span>
      </button>
      {#if editingEventId}
        <button class="button" type="button" on:click={() => { editingEventId = ''; eventDraft = emptyDraft(); }}>
          Cancel
        </button>
      {/if}
    </div>
  </form>

  <section class="card table-card">
    <div class="table-header">
      <div class="field">
        <label for="event-search">Search events</label>
        <input id="event-search" bind:value={query} disabled={!googleConnected} on:change={refreshEvents} />
      </div>
      <div class="field">
        <label for="move-target">Move target</label>
        <select id="move-target" bind:value={moveTargetCalendarId} disabled={!googleConnected}>
          <option value="">Choose calendar</option>
          {#each calendars as calendar}
            <option value={calendar.id}>{calendar.summary}</option>
          {/each}
        </select>
      </div>
    </div>
    <table>
      <thead>
        <tr>
          <th>Event</th>
          <th>When</th>
          <th>Calendar</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {#each events as event}
          <tr>
            <td>
              <strong>{event.title}</strong>
              {#if event.location}<div class="muted">{event.location}</div>{/if}
            </td>
            <td>{displayTime(event.start)}</td>
            <td>{event.calendarId}</td>
            <td class="row-actions">
              {#if event.htmlLink}
                <a class="icon-button" href={event.htmlLink} target="_blank" rel="noreferrer" aria-label="Open in Google Calendar" title="Open">
                  <ExternalLink size={16} />
                </a>
              {/if}
              <button class="icon-button" type="button" aria-label={`Edit ${event.title}`} title="Edit" on:click={() => editEvent(event)}>
                <Save size={16} />
              </button>
              <button class="icon-button" type="button" aria-label={`Move ${event.title}`} title="Move" disabled={!moveTargetCalendarId || moveTargetCalendarId === event.calendarId} on:click={() => moveSelectedEvent(event)}>
                <Send size={16} />
              </button>
              <button class="icon-button danger" type="button" aria-label={`Delete ${event.title}`} title="Delete" on:click={() => removeEvent(event)}>
                <Trash2 size={16} />
              </button>
            </td>
          </tr>
        {:else}
          <tr><td colspan="4" class="muted">{googleConnected ? 'No events found in this range.' : 'Connect Google to load real calendar events.'}</td></tr>
        {/each}
      </tbody>
    </table>
  </section>
</section>

<section class="card table-card timeline-card">
  <div class="section-title">Unified Timeline</div>
  <table>
    <thead>
      <tr>
        <th>Item</th>
        <th>Source</th>
        <th>When</th>
        <th>Action</th>
      </tr>
    </thead>
    <tbody>
      {#each timeline as item}
        <tr>
          <td>{item.title}</td>
          <td>{item.source}</td>
          <td>{displayTime(item.when)}</td>
          <td>{item.canEdit ? 'Editable' : 'Read-only'}</td>
        </tr>
      {:else}
        <tr><td colspan="4" class="muted">No timeline items loaded yet.</td></tr>
      {/each}
    </tbody>
  </table>
</section>

<style>
  .offline-banner,
  .error-banner,
  .success-banner {
    margin-bottom: 14px;
    font-weight: 800;
  }

  .offline-banner {
    border-color: #f2c14e;
    color: #815d00;
    background: #fff8df;
  }

  .error-banner {
    border-color: #ff9f6e;
    color: #944700;
    background: #fff0e6;
  }

  .success-banner {
    border-color: #90d4a7;
    color: #166534;
    background: #ecfdf3;
  }

  .metric {
    display: grid;
    gap: 7px;
    min-height: 150px;
    align-content: center;
  }

  .metric span {
    color: #64748b;
    font-weight: 800;
  }

  .metric strong {
    font-size: 28px;
    line-height: 1;
  }

  .connector-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px;
    margin: 14px 0;
  }

  .connector-card {
    min-height: 120px;
    padding: 14px;
    border: 1px solid #dfe5ee;
    border-radius: 8px;
    background: #ffffff;
  }

  .connector-card div {
    display: flex;
    justify-content: space-between;
    gap: 10px;
  }

  .connector-card span {
    color: #64748b;
    font-size: 12px;
    font-weight: 800;
  }

  .connector-card span.implemented {
    color: #166534;
  }

  .connector-card p {
    margin: 10px 0 0;
    color: #64748b;
    font-size: 13px;
    line-height: 1.45;
  }

  .workspace-grid {
    display: grid;
    grid-template-columns: minmax(280px, 390px) minmax(0, 1fr);
    gap: 14px;
    align-items: start;
  }

  .event-form {
    display: grid;
    gap: 12px;
  }

  .form-title,
  .section-title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 900;
  }

  .wide {
    grid-column: 1 / -1;
  }

  .table-card {
    overflow: auto;
  }

  .table-header {
    display: grid;
    grid-template-columns: minmax(180px, 1fr) minmax(180px, 260px);
    gap: 12px;
    padding: 14px;
    border-bottom: 1px solid #e5eaf1;
  }

  .row-actions {
    display: flex;
    gap: 6px;
    min-width: 160px;
  }

  .icon-button {
    display: inline-grid;
    width: 34px;
    height: 34px;
    place-items: center;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    color: #18202f;
    background: #ffffff;
    cursor: pointer;
    text-decoration: none;
  }

  .icon-button.danger {
    color: #9f1239;
  }

  .icon-button:disabled,
  .button:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  .timeline-card {
    margin-top: 14px;
  }

  .timeline-card .section-title {
    padding: 14px;
    border-bottom: 1px solid #e5eaf1;
  }

  @media (max-width: 1100px) {
    .connector-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .workspace-grid {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 760px) {
    .connector-grid,
    .table-header {
      grid-template-columns: 1fr;
    }
  }
</style>
