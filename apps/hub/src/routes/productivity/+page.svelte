<script lang="ts">
  import { onMount } from 'svelte';
  import {
    Archive,
    CalendarPlus,
    ExternalLink,
    Link,
    Mail,
    MailOpen,
    RefreshCw,
    Reply,
    Save,
    Send,
    Tag,
    Trash2,
    Unlink
  } from 'lucide-svelte';
  import type { CalendarEvent, GmailLabel, GmailThread, TimelineItem } from '@mini-hub/core';
  import { canAutoSave, clientData } from '$lib/client-data';
  import {
    archiveGmailThread,
    createGmailDraft,
    createEvent,
    deleteEvent,
    getCatalog,
    getConnections,
    getGmailThread,
    getGoogleOAuthUrl,
    getTimeline,
    listGmailLabels,
    listGmailThreads,
    listCalendars,
    listEvents,
    markGmailThreadRead,
    markGmailThreadUnread,
    modifyGmailThread,
    moveEvent,
    replyGmailThread,
    revokeGoogle,
    sendGmailMessage,
    updateEvent,
    type CalendarEventDraft,
    type CalendarSummary,
    type ConnectorCatalogEntry,
    type GmailComposeDraft,
    type PublicConnection
  } from '$lib/productivity-api';

  const localTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles';

  let catalog: ConnectorCatalogEntry[] = [];
  let connections: PublicConnection[] = [];
  let calendars: CalendarSummary[] = [];
  let events: CalendarEvent[] = [];
  let timeline: TimelineItem[] = [];
  let gmailThreads: GmailThread[] = [];
  let gmailLabels: GmailLabel[] = [];
  let selectedGmailThread: GmailThread | null = null;
  let selectedCalendarId = 'primary';
  let moveTargetCalendarId = '';
  let gmailQuery = 'in:inbox newer_than:30d';
  let selectedGmailLabelId = '';
  let query = '';
  let loading = false;
  let gmailLoading = false;
  let actionError = '';
  let actionMessage = '';
  let editingEventId = '';
  let eventDraft = emptyDraft();
  let composeDraft: GmailComposeDraft = emptyComposeDraft();
  let replyBody = '';

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

  function emptyComposeDraft(): GmailComposeDraft {
    return {
      to: [],
      cc: [],
      bcc: [],
      subject: '',
      bodyText: ''
    };
  }

  function splitAddresses(value: string): string[] {
    return value
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
  }

  function addressesValue(values: string[] | undefined): string {
    return (values ?? []).join(', ');
  }

  function inputValue(event: Event): string {
    return (event.currentTarget as HTMLInputElement | HTMLTextAreaElement).value;
  }

  function threadPreview(thread: GmailThread): string {
    return thread.messages[thread.messages.length - 1]?.snippet || thread.snippet || 'No preview';
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
        await refreshGmail();
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

  async function refreshGmail(): Promise<void> {
    if (!googleConnected) return;
    gmailLoading = true;
    actionError = '';
    try {
      const [threadResult, labels] = await Promise.all([
        listGmailThreads({
          q: gmailQuery.trim() || undefined,
          labelIds: selectedGmailLabelId ? [selectedGmailLabelId] : undefined,
          maxResults: 10
        }),
        listGmailLabels()
      ]);
      gmailThreads = threadResult.threads;
      gmailLabels = labels;
      if (selectedGmailThread && gmailThreads.some((thread) => thread.id === selectedGmailThread?.id)) {
        selectedGmailThread = await getGmailThread(selectedGmailThread.id);
      } else {
        selectedGmailThread = gmailThreads[0] ?? null;
      }
    } catch (error) {
      setError(error, 'Failed to refresh Gmail');
    } finally {
      gmailLoading = false;
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

  async function openGmailThread(thread: GmailThread): Promise<void> {
    actionError = '';
    try {
      selectedGmailThread = await getGmailThread(thread.id);
      replyBody = '';
    } catch (error) {
      setError(error, 'Failed to open Gmail thread');
    }
  }

  async function sendCompose(sendNow: boolean): Promise<void> {
    if (!composeDraft.to.length || !composeDraft.subject.trim() || !composeDraft.bodyText.trim()) return;
    if (sendNow && !confirm(`Send email to ${composeDraft.to.join(', ')}?`)) return;
    actionError = '';
    try {
      if (sendNow) {
        await sendGmailMessage(composeDraft);
        actionMessage = 'Email sent.';
      } else {
        await createGmailDraft(composeDraft);
        actionMessage = 'Draft saved.';
      }
      composeDraft = emptyComposeDraft();
      await refreshGmail();
    } catch (error) {
      setError(error, sendNow ? 'Failed to send email' : 'Failed to save draft');
    }
  }

  async function sendReply(sendNow: boolean): Promise<void> {
    if (!selectedGmailThread || !replyBody.trim()) return;
    if (sendNow && !confirm(`Send reply to "${selectedGmailThread.subject}"?`)) return;
    actionError = '';
    try {
      if (sendNow) {
        await replyGmailThread({ threadId: selectedGmailThread.id, bodyText: replyBody });
        actionMessage = 'Reply sent.';
      } else {
        await createGmailDraft({ threadId: selectedGmailThread.id, bodyText: replyBody });
        actionMessage = 'Reply draft saved.';
      }
      replyBody = '';
      await openGmailThread(selectedGmailThread);
      await refreshGmail();
    } catch (error) {
      setError(error, sendNow ? 'Failed to send reply' : 'Failed to save reply draft');
    }
  }

  async function archiveThread(thread: GmailThread): Promise<void> {
    actionError = '';
    try {
      await archiveGmailThread(thread.id);
      actionMessage = 'Thread archived.';
      await refreshGmail();
    } catch (error) {
      setError(error, 'Failed to archive thread');
    }
  }

  async function toggleRead(thread: GmailThread): Promise<void> {
    actionError = '';
    try {
      if (thread.unread) {
        await markGmailThreadRead(thread.id);
        actionMessage = 'Thread marked read.';
      } else {
        await markGmailThreadUnread(thread.id);
        actionMessage = 'Thread marked unread.';
      }
      await refreshGmail();
    } catch (error) {
      setError(error, 'Failed to update read state');
    }
  }

  async function toggleSelectedRead(): Promise<void> {
    if (!selectedGmailThread) return;
    await toggleRead(selectedGmailThread);
  }

  async function archiveSelectedThread(): Promise<void> {
    if (!selectedGmailThread) return;
    await archiveThread(selectedGmailThread);
  }

  async function applySelectedLabel(): Promise<void> {
    if (!selectedGmailThread || !selectedGmailLabelId) return;
    actionError = '';
    try {
      selectedGmailThread = await modifyGmailThread(selectedGmailThread.id, { addLabelIds: [selectedGmailLabelId] });
      actionMessage = 'Label applied.';
      await refreshGmail();
    } catch (error) {
      setError(error, 'Failed to apply label');
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
  <section class="card card-pad offline-banner">API unavailable or offline: productivity actions need the local API before OAuth or calendar writes can run.</section>
{/if}
{#if actionError}
  <section class="card card-pad error-banner">{actionError}</section>
{:else if actionMessage}
  <section class="card card-pad success-banner">{actionMessage}</section>
{/if}

<section class="grid four">
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
    <span>Gmail</span>
    <strong>{gmailThreads.length}</strong>
    <p class="muted">Threads, drafts, sends, labels, archive, read state.</p>
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

<section class="gmail-workspace">
  <section class="card table-card">
    <div class="table-header gmail-header">
      <div class="field">
        <label for="gmail-search">Gmail search</label>
        <input id="gmail-search" bind:value={gmailQuery} disabled={!googleConnected || gmailLoading} on:change={refreshGmail} />
      </div>
      <div class="field">
        <label for="gmail-label">Label</label>
        <select id="gmail-label" bind:value={selectedGmailLabelId} disabled={!googleConnected || gmailLoading} on:change={refreshGmail}>
          <option value="">All labels</option>
          {#each gmailLabels as label}
            <option value={label.id}>{label.name}</option>
          {/each}
        </select>
      </div>
      <button class="button" type="button" disabled={!googleConnected || gmailLoading} on:click={refreshGmail}>
        <RefreshCw size={17} />
        <span>{gmailLoading ? 'Loading' : 'Mail'}</span>
      </button>
    </div>
    <table>
      <thead>
        <tr>
          <th>Thread</th>
          <th>From</th>
          <th>Date</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {#each gmailThreads as thread}
          <tr class:unread={thread.unread}>
            <td>
              <button class="link-button" type="button" on:click={() => openGmailThread(thread)}>
                <strong>{thread.subject}</strong>
              </button>
              <div class="muted">{threadPreview(thread)}</div>
            </td>
            <td>{thread.from}</td>
            <td>{thread.date}</td>
            <td class="row-actions">
              <button class="icon-button" type="button" aria-label={`Open ${thread.subject}`} title="Open" on:click={() => openGmailThread(thread)}>
                <Mail size={16} />
              </button>
              <button class="icon-button" type="button" aria-label={thread.unread ? `Mark ${thread.subject} read` : `Mark ${thread.subject} unread`} title={thread.unread ? 'Mark read' : 'Mark unread'} on:click={() => toggleRead(thread)}>
                <MailOpen size={16} />
              </button>
              <button class="icon-button" type="button" aria-label={`Archive ${thread.subject}`} title="Archive" on:click={() => archiveThread(thread)}>
                <Archive size={16} />
              </button>
            </td>
          </tr>
        {:else}
          <tr><td colspan="4" class="muted">{googleConnected ? 'No Gmail threads matched.' : 'Connect Google to load real Gmail threads.'}</td></tr>
        {/each}
      </tbody>
    </table>
  </section>

  <section class="card card-pad mail-panel">
    <div class="form-title">
      <Mail size={18} />
      <strong>{selectedGmailThread?.subject ?? 'Selected Thread'}</strong>
    </div>
    {#if selectedGmailThread}
      <div class="mail-actions">
        <button class="button" type="button" disabled={!googleConnected} on:click={toggleSelectedRead}>
          <MailOpen size={17} />
          <span>{selectedGmailThread.unread ? 'Mark Read' : 'Mark Unread'}</span>
        </button>
        <button class="button" type="button" disabled={!googleConnected} on:click={archiveSelectedThread}>
          <Archive size={17} />
          <span>Archive</span>
        </button>
        <button class="button" type="button" disabled={!googleConnected || !selectedGmailLabelId} on:click={applySelectedLabel}>
          <Tag size={17} />
          <span>Apply Label</span>
        </button>
      </div>
      <div class="message-stack">
        {#each selectedGmailThread.messages as message}
          <article class="message-card">
            <div>
              <strong>{message.from}</strong>
              <span>{message.date}</span>
            </div>
            <p class="muted">To: {message.to}</p>
            <pre>{message.bodyText || message.snippet}</pre>
          </article>
        {/each}
      </div>
      <div class="field">
        <label for="gmail-reply">Reply</label>
        <textarea id="gmail-reply" bind:value={replyBody} disabled={!googleConnected} rows="5"></textarea>
      </div>
      <div class="action-row">
        <button class="button" type="button" disabled={!googleConnected || !replyBody.trim()} on:click={() => sendReply(false)}>
          <Save size={17} />
          <span>Draft Reply</span>
        </button>
        <button class="button primary" type="button" disabled={!googleConnected || !replyBody.trim()} on:click={() => sendReply(true)}>
          <Reply size={17} />
          <span>Send Reply</span>
        </button>
      </div>
    {:else}
      <p class="muted">Select a Gmail thread to read the full messages and reply.</p>
    {/if}
  </section>
</section>

<section class="card card-pad compose-panel">
  <div class="form-title">
    <Send size={18} />
    <strong>Compose</strong>
  </div>
  <div class="compose-grid">
    <div class="field">
      <label for="compose-to">To</label>
      <input id="compose-to" value={addressesValue(composeDraft.to)} disabled={!googleConnected} on:input={(event) => (composeDraft.to = splitAddresses(inputValue(event)))} />
    </div>
    <div class="field">
      <label for="compose-cc">Cc</label>
      <input id="compose-cc" value={addressesValue(composeDraft.cc)} disabled={!googleConnected} on:input={(event) => (composeDraft.cc = splitAddresses(inputValue(event)))} />
    </div>
    <div class="field">
      <label for="compose-bcc">Bcc</label>
      <input id="compose-bcc" value={addressesValue(composeDraft.bcc)} disabled={!googleConnected} on:input={(event) => (composeDraft.bcc = splitAddresses(inputValue(event)))} />
    </div>
    <div class="field">
      <label for="compose-subject">Subject</label>
      <input id="compose-subject" bind:value={composeDraft.subject} disabled={!googleConnected} />
    </div>
    <div class="field wide">
      <label for="compose-body">Body</label>
      <textarea id="compose-body" bind:value={composeDraft.bodyText} disabled={!googleConnected} rows="5"></textarea>
    </div>
  </div>
  <div class="action-row">
    <button class="button" type="button" disabled={!googleConnected || !composeDraft.to.length || !composeDraft.subject.trim() || !composeDraft.bodyText.trim()} on:click={() => sendCompose(false)}>
      <Save size={17} />
      <span>Save Draft</span>
    </button>
    <button class="button primary" type="button" disabled={!googleConnected || !composeDraft.to.length || !composeDraft.subject.trim() || !composeDraft.bodyText.trim()} on:click={() => sendCompose(true)}>
      <Send size={17} />
      <span>Send Email</span>
    </button>
  </div>
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
    border-color: var(--warning-border);
    color: var(--warning-text);
    background: var(--warning-bg);
  }

  .error-banner {
    border-color: var(--error-border);
    color: var(--error-text);
    background: var(--error-bg);
  }

  .success-banner {
    border-color: var(--success-border);
    color: var(--success-text);
    background: var(--success-bg);
  }

  .metric {
    display: grid;
    gap: 7px;
    min-height: 150px;
    align-content: center;
  }

  .metric span {
    color: var(--muted);
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
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
  }

  .connector-card div {
    display: flex;
    justify-content: space-between;
    gap: 10px;
  }

  .connector-card span {
    color: var(--muted);
    font-size: 12px;
    font-weight: 800;
  }

  .connector-card span.implemented {
    color: var(--success-text);
  }

  .connector-card p {
    margin: 10px 0 0;
    color: var(--muted);
    font-size: 13px;
    line-height: 1.45;
  }

  .grid.four {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  .workspace-grid {
    display: grid;
    grid-template-columns: minmax(280px, 390px) minmax(0, 1fr);
    gap: 14px;
    align-items: start;
  }

  .gmail-workspace {
    display: grid;
    grid-template-columns: minmax(0, 1.1fr) minmax(320px, 0.9fr);
    gap: 14px;
    align-items: start;
    margin-top: 14px;
  }

  .gmail-header {
    grid-template-columns: minmax(180px, 1fr) minmax(160px, 240px) auto;
    align-items: end;
  }

  .mail-panel,
  .compose-panel {
    display: grid;
    gap: 14px;
  }

  .mail-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .message-stack {
    display: grid;
    gap: 10px;
    max-height: 480px;
    overflow: auto;
  }

  .message-card {
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface-muted);
  }

  .message-card div {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    font-size: 13px;
  }

  .message-card pre {
    margin: 10px 0 0;
    white-space: pre-wrap;
    word-break: break-word;
    font: inherit;
    line-height: 1.45;
  }

  .compose-panel {
    margin-top: 14px;
  }

  .compose-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
  }

  .link-button {
    display: inline;
    padding: 0;
    border: 0;
    color: var(--text);
    background: transparent;
    cursor: pointer;
    text-align: left;
  }

  tr.unread td {
    background: var(--surface-soft);
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
    border-bottom: 1px solid var(--border);
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
    border: 1px solid var(--border-strong);
    border-radius: 6px;
    color: var(--text);
    background: var(--surface);
    cursor: pointer;
    text-decoration: none;
  }

  .icon-button.danger {
    color: var(--danger-text);
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
    border-bottom: 1px solid var(--border);
  }

  @media (max-width: 1100px) {
    .connector-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .grid.four,
    .workspace-grid {
      grid-template-columns: 1fr;
    }

    .gmail-workspace {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 760px) {
    .connector-grid,
    .table-header,
    .compose-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
