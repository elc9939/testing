<script lang="ts">
  import { onMount } from 'svelte';
  import {
    Archive,
    CalendarPlus,
    ChevronLeft,
    ChevronRight,
    ExternalLink,
    Link,
    Mail,
    MailOpen,
    RefreshCw,
    Reply,
    Save,
    Send,
    Sparkles,
    Star,
    StarOff,
    Tag,
    Trash2,
    Unlink,
    X
  } from 'lucide-svelte';
  import { routeMap } from '@mini-hub/core';
  import type { CalendarEvent, GmailLabel, GmailThread, TimelineItem } from '@mini-hub/core';
  import { attentionStore } from '$lib/attention-store';
  import { getApiUrl } from '$lib/api';
  import { canAutoSave, clientData } from '$lib/client-data';
  import { googleOAuthCallbackModeForUrls, googleOAuthReturnToStorageKey } from '$lib/productivity-oauth';
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
    listPriorityGmailThreads,
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
    type GmailThreadInsight,
    type PublicConnection
  } from '$lib/productivity-api';
  import {
    addDays,
    buildCalendarWeek,
    eventBlockStyle,
    localDateKey,
    startOfLocalDay,
    summarizeEmailThread
  } from '$lib/productivity-view';
  import { hubHref } from '$lib/routes';

  const localTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles';
  const productivityCacheKey = 'miniHub.productivity.cache.v1';
  const defaultGmailQuery = [
    'in:inbox newer_than:14d',
    '-category:promotions',
    '-category:social',
    '-category:forums',
    '-newsletter',
    '-unsubscribe',
    '(deadline OR due OR "action required" OR "please reply" OR rsvp OR interview OR appointment OR rescheduled OR reservation OR flight OR exam OR assignment OR "security alert" OR verification OR "payment failed" OR invoice)'
  ].join(' ');

  interface ProductivityCache {
    version: 1;
    cachedAt: string;
    catalog: ConnectorCatalogEntry[];
    connections: PublicConnection[];
    calendars: CalendarSummary[];
    events: CalendarEvent[];
    timeline: TimelineItem[];
    priorityThreads: GmailThreadInsight[];
    gmailLabels: GmailLabel[];
    selectedCalendarId: string;
    query: string;
    gmailQuery: string;
    selectedGmailLabelId: string;
  }

  interface GoogleOAuthMessage {
    type: 'mini-hub:google-oauth';
    provider: 'google';
    status: string;
    message?: string;
    redirectUrl?: string;
  }

  let catalog: ConnectorCatalogEntry[] = [];
  let connections: PublicConnection[] = [];
  let calendars: CalendarSummary[] = [];
  let events: CalendarEvent[] = [];
  let timeline: TimelineItem[] = [];
  let gmailThreads: GmailThread[] = [];
  let priorityThreads: GmailThreadInsight[] = [];
  let gmailLabels: GmailLabel[] = [];
  let selectedGmailThread: GmailThread | null = null;
  let selectedCalendarId = 'primary';
  let calendarCursor = startOfLocalDay(new Date());
  let moveTargetCalendarId = '';
  let gmailQuery = defaultGmailQuery;
  let selectedGmailLabelId = '';
  let query = '';
  let loading = false;
  let gmailLoading = false;
  let backgroundRefreshing = false;
  let cacheLoadedAt = '';
  let actionError = '';
  let actionMessage = '';
  let actionBusyKey = '';
  let googleOAuthOpening = false;
  let googleOAuthPopup: Window | null = null;
  let editingEventId = '';
  let eventDraft = emptyDraft();
  let composeDraft: GmailComposeDraft = emptyComposeDraft();
  let replyBody = '';
  let eventDialogOpen = false;
  let composeDialogOpen = false;

  $: canAct = canAutoSave($clientData);
  $: googleConnections = connections.filter((connection) => connection.provider === 'google' && connection.status === 'connected');
  $: googleConnection = googleConnections[0];
  $: googleConnected = googleConnections.length > 0;
  $: productivityReady = canAct && googleConnected;
  $: productivityReadReady = productivityReady && !loading;
  $: productivityWriteDisabled = loading || !productivityReady || Boolean(actionBusyKey);
  $: productivityRefreshDisabled = loading || backgroundRefreshing || Boolean(actionBusyKey);
  $: productivityThreadOpenDisabled = Boolean(actionBusyKey);
  $: gmailReady = productivityReady && !gmailLoading;
  $: googleConnectDisabled = loading || !canAct || googleOAuthOpening || Boolean(actionBusyKey);
  $: googleConnectTitle = loading
    ? 'Productivity is still loading the latest connection state.'
    : !canAct
    ? 'Start or connect the local API before opening Google OAuth.'
    : googleOAuthOpening
      ? 'Google OAuth popup is already opening.'
      : actionBusyKey
      ? 'Another Productivity action is already running.'
      : 'Open Google OAuth account picker.';
  $: selectedCalendar = calendars.find((calendar) => calendar.id === selectedCalendarId);
  $: calendarWeek = buildCalendarWeek(events, calendarCursor);
  $: calendarRangeLabel = `${displayShortDate(localDateKey(calendarCursor))} - ${displayShortDate(localDateKey(addDays(calendarCursor, 6)))}`;
  $: cacheStatus = cacheLoadedAt ? `Cached ${displayTime(cacheLoadedAt)}` : 'No local cache yet';

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

  function googleReturnTo(): string | undefined {
    if (typeof window === 'undefined') return undefined;
    const url = new URL(window.location.href);
    url.searchParams.delete('google');
    url.searchParams.delete('message');
    return url.toString();
  }

  function rememberGoogleReturnTo(value: string | undefined): void {
    if (!value || typeof sessionStorage === 'undefined') return;
    try {
      sessionStorage.setItem(googleOAuthReturnToStorageKey, value);
    } catch {
      // Session storage is only a best-effort breadcrumb for OAuth diagnostics.
    }
  }

  function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function isGoogleOAuthMessage(value: unknown): value is GoogleOAuthMessage {
    return (
      isRecord(value) &&
      value.type === 'mini-hub:google-oauth' &&
      value.provider === 'google' &&
      typeof value.status === 'string' &&
      (value.message === undefined || typeof value.message === 'string') &&
      (value.redirectUrl === undefined || typeof value.redirectUrl === 'string')
    );
  }

  function isCurrentHubUrl(value: string | undefined): boolean {
    if (!value || typeof window === 'undefined') return true;
    try {
      return new URL(value).origin === window.location.origin;
    } catch {
      return false;
    }
  }

  function googleOAuthCallbackMode(): 'api' | 'hub' {
    if (typeof window === 'undefined') return 'api';
    return googleOAuthCallbackModeForUrls(window.location.href, getApiUrl());
  }

  function consumeGoogleQueryStatus(): void {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const status = url.searchParams.get('google');
    if (!status) return;
    const message = url.searchParams.get('message') ?? '';
    if (status === 'connected') {
      actionMessage = 'Google account connected.';
      actionError = '';
    } else if (status === 'error') {
      actionError = message || 'Google OAuth failed.';
    } else if (status === 'missing-code') {
      actionError = 'Google OAuth did not return a usable authorization code.';
    }
    url.searchParams.delete('google');
    url.searchParams.delete('message');
    window.history.replaceState({}, '', url.toString());
  }

  function inputValue(event: Event): string {
    return (event.currentTarget as HTMLInputElement | HTMLTextAreaElement).value;
  }

  function scopedConnectionId(resourceId: string): string {
    const separator = resourceId.indexOf('::');
    return separator === -1 ? '' : resourceId.slice(0, separator);
  }

  function accountLabelForResource(resourceId: string): string {
    const connectionId = scopedConnectionId(resourceId);
    return connections.find((connection) => connection.id === connectionId)?.accountLabel ?? googleConnection?.accountLabel ?? 'Google';
  }

  function isThreadImportant(thread: GmailThread): boolean {
    return thread.labelIds.includes('IMPORTANT');
  }

  function priorityClass(priority: number): string {
    if (priority >= 78) return 'high';
    if (priority >= 60) return 'medium';
    return 'low';
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

  function displayShortDate(value: string): string {
    const date = value.includes('T') ? new Date(value) : localDateFromKey(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
  }

  function localDateFromKey(value: string): Date {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
    if (!match) return new Date(value);
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }

  function eventTimeRange(event: CalendarEvent): string {
    if (!event.start.includes('T')) return 'All day';
    const start = new Date(event.start);
    const end = new Date(event.end);
    if (Number.isNaN(start.getTime())) return event.start;
    const formatter = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
    if (Number.isNaN(end.getTime())) return formatter.format(start);
    return `${formatter.format(start)} - ${formatter.format(end)}`;
  }

  function calendarName(calendarId: string): string {
    return calendars.find((calendar) => calendar.id === calendarId)?.summary ?? calendarId;
  }

  function readProductivityCache(): ProductivityCache | null {
    if (typeof localStorage === 'undefined') return null;
    try {
      const parsed = JSON.parse(localStorage.getItem(productivityCacheKey) ?? 'null') as Partial<ProductivityCache> | null;
      if (!parsed || parsed.version !== 1 || !parsed.cachedAt) return null;
      return {
        version: 1,
        cachedAt: parsed.cachedAt,
        catalog: Array.isArray(parsed.catalog) ? parsed.catalog : [],
        connections: Array.isArray(parsed.connections) ? parsed.connections : [],
        calendars: Array.isArray(parsed.calendars) ? parsed.calendars : [],
        events: Array.isArray(parsed.events) ? parsed.events : [],
        timeline: Array.isArray(parsed.timeline) ? parsed.timeline : [],
        priorityThreads: Array.isArray(parsed.priorityThreads) ? parsed.priorityThreads : [],
        gmailLabels: Array.isArray(parsed.gmailLabels) ? parsed.gmailLabels : [],
        selectedCalendarId: typeof parsed.selectedCalendarId === 'string' ? parsed.selectedCalendarId : 'primary',
        query: typeof parsed.query === 'string' ? parsed.query : '',
        gmailQuery: typeof parsed.gmailQuery === 'string' ? parsed.gmailQuery : defaultGmailQuery,
        selectedGmailLabelId: typeof parsed.selectedGmailLabelId === 'string' ? parsed.selectedGmailLabelId : ''
      };
    } catch {
      return null;
    }
  }

  function hydrateProductivityCache(): void {
    const cached = readProductivityCache();
    if (!cached) return;
    catalog = cached.catalog;
    connections = cached.connections;
    calendars = cached.calendars;
    events = cached.events;
    timeline = cached.timeline;
    priorityThreads = cached.priorityThreads;
    gmailThreads = cached.priorityThreads.map((insight) => insight.thread);
    gmailLabels = cached.gmailLabels;
    selectedCalendarId = cached.calendars.some((calendar) => calendar.id === cached.selectedCalendarId)
      ? cached.selectedCalendarId
      : (cached.calendars.find((calendar) => calendar.primary)?.id ?? cached.calendars[0]?.id ?? 'primary');
    moveTargetCalendarId = cached.calendars.find((calendar) => calendar.id !== selectedCalendarId)?.id ?? '';
    query = cached.query;
    gmailQuery = cached.gmailQuery;
    selectedGmailLabelId = cached.selectedGmailLabelId;
    selectedGmailThread = gmailThreads[0] ?? null;
    cacheLoadedAt = cached.cachedAt;
  }

  function persistProductivityCache(): void {
    if (typeof localStorage === 'undefined') return;
    const cachedAt = new Date().toISOString();
    const payload: ProductivityCache = {
      version: 1,
      cachedAt,
      catalog,
      connections,
      calendars,
      events,
      timeline,
      priorityThreads,
      gmailLabels,
      selectedCalendarId,
      query,
      gmailQuery,
      selectedGmailLabelId
    };
    localStorage.setItem(productivityCacheKey, JSON.stringify(payload));
    cacheLoadedAt = cachedAt;
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

  function productivityActionTitle(enabledTitle: string): string {
    if (loading) return 'Productivity is still loading the latest connection state.';
    if (!productivityReady) return 'Connect the API and Google before using this action.';
    if (actionBusyKey) return 'Another Productivity action is already running.';
    return enabledTitle;
  }

  function productivityRefreshTitle(): string {
    if (actionBusyKey) return 'Another Productivity action is already running.';
    if (loading) return 'Productivity is already loading.';
    if (backgroundRefreshing) return 'Productivity is already refreshing.';
    return 'Refresh calendar, mail, and connection data.';
  }

  function gmailRefreshTitle(): string {
    if (actionBusyKey) return 'Another Productivity action is already running.';
    if (!productivityReady) return 'Connect the API and Google to refresh Gmail. Cached mail remains readable.';
    if (gmailLoading) return 'Priority Gmail is already refreshing.';
    return 'Refresh priority Gmail threads.';
  }

  function gmailThreadOpenTitle(): string {
    if (actionBusyKey) return 'Another Productivity action is already running.';
    if (!productivityReady) return 'Open the cached thread preview. Connect the API and Google to fetch full messages.';
    return 'Open Gmail thread and fetch the latest messages.';
  }

  function productivityReadTitle(enabledTitle: string): string {
    if (loading) return 'Productivity is still loading the latest connection state.';
    if (!productivityReady) return 'Connect the API and Google to load live calendar controls. Cached data remains visible.';
    return enabledTitle;
  }

  function beginProductivityAction(key: string, requiresGoogle = true): boolean {
    if (actionBusyKey) {
      actionError = 'Another Productivity action is already running.';
      return false;
    }
    if (loading) {
      actionError = 'Productivity is still loading the latest connection state.';
      return false;
    }
    if (requiresGoogle ? !productivityReady : !canAct) {
      actionError = requiresGoogle
        ? 'Connect the API and Google before using this action.'
        : 'Start or connect the local API before using this action.';
      return false;
    }
    actionBusyKey = key;
    actionError = '';
    actionMessage = '';
    return true;
  }

  function endProductivityAction(key: string): void {
    if (actionBusyKey === key) actionBusyKey = '';
  }

  function isActionBusy(key: string): boolean {
    return actionBusyKey === key;
  }

  function notifyAttentionChanged(): void {
    attentionStore.invalidate();
  }

  function openNewEvent(): void {
    if (productivityWriteDisabled) {
      actionError = productivityActionTitle('Create a Google Calendar event.');
      return;
    }
    editingEventId = '';
    eventDraft = emptyDraft();
    eventDialogOpen = true;
  }

  function closeEventDialog(): void {
    editingEventId = '';
    eventDraft = emptyDraft();
    eventDialogOpen = false;
  }

  function openComposeDialog(): void {
    if (productivityWriteDisabled) {
      actionError = productivityActionTitle('Compose a Gmail message.');
      return;
    }
    composeDraft = emptyComposeDraft();
    composeDialogOpen = true;
  }

  function closeComposeDialog(): void {
    composeDraft = emptyComposeDraft();
    composeDialogOpen = false;
  }

  async function loadOverview(options: { background?: boolean } = {}): Promise<void> {
    const isBackground = options.background === true;
    if (isBackground) {
      backgroundRefreshing = true;
    } else {
      loading = true;
    }
    actionError = '';
    try {
      catalog = await getCatalog();
      connections = await getConnections();
      if (connections.some((connection) => connection.provider === 'google' && connection.status === 'connected')) {
        calendars = await listCalendars();
        const nextSelectedCalendar = calendars.some((calendar) => calendar.id === selectedCalendarId)
          ? calendars.find((calendar) => calendar.id === selectedCalendarId)
          : (calendars.find((calendar) => calendar.primary) ?? calendars[0]);
        selectedCalendarId = nextSelectedCalendar?.id ?? 'primary';
        moveTargetCalendarId = calendars.find((calendar) => calendar.id !== selectedCalendarId)?.id ?? '';
        eventDraft = { ...eventDraft, calendarId: selectedCalendarId, timeZone: nextSelectedCalendar?.timeZone ?? localTimeZone };
        await refreshEvents();
        await refreshGmail();
        persistProductivityCache();
      } else {
        persistProductivityCache();
      }
    } catch (error) {
      if (!isBackground) setError(error, 'Failed to load productivity hub');
    } finally {
      if (isBackground) {
        backgroundRefreshing = false;
      } else {
        loading = false;
      }
    }
  }

  async function refreshEvents(): Promise<void> {
    if (!productivityReady) return;
    actionError = '';
    const rangeStart = startOfLocalDay(calendarCursor);
    const rangeEnd = addDays(rangeStart, 21);
    try {
      events = await listEvents({
        calendarId: selectedCalendarId,
        timeMin: rangeStart.toISOString(),
        timeMax: rangeEnd.toISOString(),
        q: query.trim() || undefined
      });
      timeline = await getTimeline({ timeMin: rangeStart.toISOString(), timeMax: rangeEnd.toISOString() });
      persistProductivityCache();
    } catch (error) {
      setError(error, 'Failed to refresh events');
    }
  }

  async function refreshGmail(): Promise<void> {
    if (!productivityReady) return;
    gmailLoading = true;
    actionError = '';
    try {
      const [threadResult, labels] = await Promise.all([
        listPriorityGmailThreads({
          q: gmailQuery.trim() || undefined,
          labelIds: selectedGmailLabelId ? [selectedGmailLabelId] : undefined,
          maxResults: 10
        }),
        listGmailLabels()
      ]);
      priorityThreads = threadResult;
      gmailThreads = threadResult.map((insight) => insight.thread);
      gmailLabels = labels;
      if (selectedGmailThread && gmailThreads.some((thread) => thread.id === selectedGmailThread?.id)) {
        selectedGmailThread = await getGmailThread(selectedGmailThread.id);
      } else {
        selectedGmailThread = gmailThreads[0] ?? null;
      }
      persistProductivityCache();
    } catch (error) {
      setError(error, 'Failed to refresh Gmail');
    } finally {
      gmailLoading = false;
    }
  }

  async function connectGoogle(): Promise<void> {
    if (!beginProductivityAction('google:connect', false)) return;
    googleOAuthOpening = true;
    const popup =
      typeof window !== 'undefined'
        ? window.open('about:blank', 'mini-hub-google-oauth', 'width=560,height=720,menubar=no,toolbar=no,location=yes,status=no')
        : null;
    if (popup) {
      googleOAuthPopup = popup;
      try {
        popup.document.title = 'Connect Google';
        popup.document.body.innerHTML =
          '<main style="font-family: system-ui, sans-serif; padding: 24px;"><strong>Opening Google sign-in...</strong><p>You can close this window if you change your mind.</p></main>';
      } catch {
        // The popup may become cross-origin quickly; setting the placeholder is only cosmetic.
      }
    }
    try {
      const returnTo = googleReturnTo();
      rememberGoogleReturnTo(returnTo);
      const url = await getGoogleOAuthUrl(returnTo, popup ? 'popup' : 'redirect', googleOAuthCallbackMode());
      if (popup) {
        popup.location.href = url;
        actionMessage = 'Complete Google sign-in in the popup.';
      } else {
        window.location.href = url;
      }
    } catch (error) {
      if (popup && !popup.closed) popup.close();
      if (googleOAuthPopup === popup) googleOAuthPopup = null;
      setError(error, 'Google OAuth is not configured');
    } finally {
      googleOAuthOpening = false;
      endProductivityAction('google:connect');
    }
  }

  async function handleGoogleOAuthMessage(event: MessageEvent): Promise<void> {
    if (!isGoogleOAuthMessage(event.data)) return;
    if (googleOAuthPopup) {
      if (event.source !== googleOAuthPopup) return;
    } else if (!isCurrentHubUrl(event.data.redirectUrl)) {
      return;
    }
    if (googleOAuthPopup && !googleOAuthPopup.closed) {
      googleOAuthPopup.close();
    }
    googleOAuthPopup = null;
    if (event.data.status === 'connected') {
      actionError = '';
      actionMessage = 'Google account connected.';
      await loadOverview();
      notifyAttentionChanged();
      return;
    }
    actionMessage = '';
    actionError = event.data.message || 'Google OAuth failed.';
  }

  async function disconnectGoogle(connection?: PublicConnection): Promise<void> {
    if (!beginProductivityAction(`google:disconnect:${connection?.id ?? 'default'}`)) return;
    const label = connection?.accountLabel ?? 'the stored Google OAuth grant';
    if (!confirm(`Revoke ${label} for this hub?`)) {
      endProductivityAction(`google:disconnect:${connection?.id ?? 'default'}`);
      return;
    }
    try {
      await revokeGoogle(connection?.id);
      actionMessage = connection ? `${connection.accountLabel} revoked.` : 'Google connection revoked.';
      await loadOverview();
      notifyAttentionChanged();
    } catch (error) {
      setError(error, 'Failed to revoke Google connection');
    } finally {
      endProductivityAction(`google:disconnect:${connection?.id ?? 'default'}`);
    }
  }

  async function saveEvent(): Promise<void> {
    if (!eventDraft.title.trim() || !eventDraft.start || !eventDraft.end) return;
    const key = editingEventId ? `event:save:${editingEventId}` : 'event:create';
    if (!beginProductivityAction(key)) return;
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
      eventDialogOpen = false;
      await refreshEvents();
      notifyAttentionChanged();
    } catch (error) {
      setError(error, 'Failed to save event');
    } finally {
      endProductivityAction(key);
    }
  }

  function editEvent(event: CalendarEvent): void {
    if (!productivityReady) return;
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
    eventDialogOpen = true;
  }

  async function removeEvent(event: CalendarEvent): Promise<void> {
    const key = `event:delete:${event.id}`;
    if (!beginProductivityAction(key)) return;
    if (!confirm(`Delete "${event.title}" from ${event.calendarId}?`)) {
      endProductivityAction(key);
      return;
    }
    try {
      await deleteEvent(event.calendarId, event.id);
      actionMessage = 'Event deleted.';
      await refreshEvents();
      notifyAttentionChanged();
    } catch (error) {
      setError(error, 'Failed to delete event');
    } finally {
      endProductivityAction(key);
    }
  }

  async function moveSelectedEvent(event: CalendarEvent): Promise<void> {
    if (!moveTargetCalendarId || moveTargetCalendarId === event.calendarId) return;
    const key = `event:move:${event.id}`;
    if (!beginProductivityAction(key)) return;
    try {
      await moveEvent(event.calendarId, event.id, moveTargetCalendarId);
      actionMessage = 'Event moved.';
      await refreshEvents();
      notifyAttentionChanged();
    } catch (error) {
      setError(error, 'Failed to move event');
    } finally {
      endProductivityAction(key);
    }
  }

  async function openGmailThread(thread: GmailThread): Promise<void> {
    if (!productivityReady) {
      selectedGmailThread = thread;
      replyBody = '';
      actionError = '';
      actionMessage = 'Showing cached thread preview. Connect the API and Google to fetch full messages, reply, label, or archive.';
      return;
    }
    if (!beginProductivityAction(`gmail:open:${thread.id}`)) return;
    try {
      selectedGmailThread = await getGmailThread(thread.id);
      replyBody = '';
    } catch (error) {
      setError(error, 'Failed to open Gmail thread');
    } finally {
      endProductivityAction(`gmail:open:${thread.id}`);
    }
  }

  async function sendCompose(sendNow: boolean): Promise<void> {
    if (!composeDraft.to.length || !composeDraft.subject.trim() || !composeDraft.bodyText.trim()) return;
    const key = sendNow ? 'gmail:compose:send' : 'gmail:compose:draft';
    if (!beginProductivityAction(key)) return;
    if (sendNow && !confirm(`Send email to ${composeDraft.to.join(', ')}?`)) {
      endProductivityAction(key);
      return;
    }
    try {
      if (sendNow) {
        await sendGmailMessage(composeDraft);
        actionMessage = 'Email sent.';
      } else {
        await createGmailDraft(composeDraft);
        actionMessage = 'Draft saved.';
      }
      composeDraft = emptyComposeDraft();
      composeDialogOpen = false;
      await refreshGmail();
    } catch (error) {
      setError(error, sendNow ? 'Failed to send email' : 'Failed to save draft');
    } finally {
      endProductivityAction(key);
    }
  }

  async function sendReply(sendNow: boolean): Promise<void> {
    if (!selectedGmailThread || !replyBody.trim()) return;
    const key = sendNow ? `gmail:reply:send:${selectedGmailThread.id}` : `gmail:reply:draft:${selectedGmailThread.id}`;
    if (!beginProductivityAction(key)) return;
    if (sendNow && !confirm(`Send reply to "${selectedGmailThread.subject}"?`)) {
      endProductivityAction(key);
      return;
    }
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
    } finally {
      endProductivityAction(key);
    }
  }

  async function archiveThread(thread: GmailThread): Promise<void> {
    if (!beginProductivityAction(`gmail:archive:${thread.id}`)) return;
    try {
      await archiveGmailThread(thread.id);
      priorityThreads = priorityThreads.filter((insight) => insight.thread.id !== thread.id);
      gmailThreads = gmailThreads.filter((item) => item.id !== thread.id);
      if (selectedGmailThread?.id === thread.id) selectedGmailThread = gmailThreads[0] ?? null;
      persistProductivityCache();
      actionMessage = 'Thread archived.';
      await refreshGmail();
      notifyAttentionChanged();
    } catch (error) {
      setError(error, 'Failed to archive thread');
    } finally {
      endProductivityAction(`gmail:archive:${thread.id}`);
    }
  }

  async function toggleRead(thread: GmailThread): Promise<void> {
    const key = `gmail:read:${thread.id}`;
    if (!beginProductivityAction(key)) return;
    try {
      if (thread.unread) {
        await markGmailThreadRead(thread.id);
        priorityThreads = priorityThreads.filter((insight) => insight.thread.id !== thread.id);
        gmailThreads = gmailThreads.filter((item) => item.id !== thread.id);
        if (selectedGmailThread?.id === thread.id) selectedGmailThread = gmailThreads[0] ?? null;
        actionMessage = 'Thread marked read.';
      } else {
        await markGmailThreadUnread(thread.id);
        actionMessage = 'Thread marked unread.';
      }
      persistProductivityCache();
      await refreshGmail();
      notifyAttentionChanged();
    } catch (error) {
      setError(error, 'Failed to update read state');
    } finally {
      endProductivityAction(key);
    }
  }

  async function toggleImportant(thread: GmailThread): Promise<void> {
    const key = `gmail:important:${thread.id}`;
    if (!beginProductivityAction(key)) return;
    try {
      if (isThreadImportant(thread)) {
        await modifyGmailThread(thread.id, { removeLabelIds: ['IMPORTANT'] });
        actionMessage = 'Thread removed from important.';
      } else {
        await modifyGmailThread(thread.id, { addLabelIds: ['IMPORTANT'] });
        actionMessage = 'Thread marked important.';
      }
      await refreshGmail();
      notifyAttentionChanged();
    } catch (error) {
      setError(error, 'Failed to update important state');
    } finally {
      endProductivityAction(key);
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

  async function toggleSelectedImportant(): Promise<void> {
    if (!selectedGmailThread) return;
    await toggleImportant(selectedGmailThread);
  }

  async function applySelectedLabel(): Promise<void> {
    if (!selectedGmailThread || !selectedGmailLabelId) return;
    const key = `gmail:label:${selectedGmailThread.id}`;
    if (!beginProductivityAction(key)) return;
    try {
      selectedGmailThread = await modifyGmailThread(selectedGmailThread.id, { addLabelIds: [selectedGmailLabelId] });
      actionMessage = 'Label applied.';
      await refreshGmail();
    } catch (error) {
      setError(error, 'Failed to apply label');
    } finally {
      endProductivityAction(key);
    }
  }

  function shiftCalendar(days: number): void {
    if (!productivityReadReady) return;
    calendarCursor = addDays(calendarCursor, days);
    void refreshEvents();
  }

  function jumpToToday(): void {
    if (!productivityReadReady) return;
    calendarCursor = startOfLocalDay(new Date());
    void refreshEvents();
  }

  function refreshIfVisible(): void {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    if (loading || backgroundRefreshing) return;
    void loadOverview({ background: true });
  }

  onMount(() => {
    hydrateProductivityCache();
    consumeGoogleQueryStatus();
    void clientData.init();
    void loadOverview();
    const interval = window.setInterval(refreshIfVisible, 120_000);
    const oauthListener = (event: MessageEvent) => {
      void handleGoogleOAuthMessage(event);
    };
    window.addEventListener('message', oauthListener);
    window.addEventListener('focus', refreshIfVisible);
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('message', oauthListener);
      window.removeEventListener('focus', refreshIfVisible);
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  });
</script>

<svelte:head>
  <title>Productivity Hub - Mini Hub</title>
</svelte:head>

<section class="page-header">
  <div>
    <p class="eyebrow">Command Center</p>
    <h1>Productivity Hub</h1>
  </div>
  <div class="action-row">
    <button class="button" type="button" disabled={productivityWriteDisabled} title={productivityActionTitle('Create a Google Calendar event.')} on:click={openNewEvent}>
      <CalendarPlus size={17} />
      <span>New Event</span>
    </button>
    <button class="button" type="button" disabled={productivityWriteDisabled} title={productivityActionTitle('Compose a Gmail message.')} on:click={openComposeDialog}>
      <Send size={17} />
      <span>Compose</span>
    </button>
    <button class="button" type="button" disabled={productivityRefreshDisabled} title={productivityRefreshTitle()} on:click={() => loadOverview()}>
      <RefreshCw size={17} />
      <span>{backgroundRefreshing ? 'Refreshing' : 'Refresh'}</span>
    </button>
    {#if googleConnected}
      <button class="button" type="button" disabled={googleConnectDisabled} title={googleConnectTitle} on:click={connectGoogle}>
        <Link size={17} />
        <span>{googleOAuthOpening ? 'Opening...' : 'Add Google Account'}</span>
      </button>
      {#if googleConnections.length === 1}
        <button class="button" type="button" disabled={productivityWriteDisabled} title={productivityActionTitle('Revoke this Google account connection.')} on:click={() => disconnectGoogle(googleConnection)}>
          <Unlink size={17} />
          <span>{isActionBusy(`google:disconnect:${googleConnection?.id ?? 'default'}`) ? 'Revoking' : 'Revoke'}</span>
        </button>
      {/if}
    {:else}
      <button class="button primary" type="button" disabled={googleConnectDisabled} title={googleConnectTitle} on:click={connectGoogle}>
        <Link size={17} />
        <span>{googleOAuthOpening ? 'Opening...' : 'Connect Google'}</span>
      </button>
    {/if}
  </div>
</section>

{#if !canAct}
  <section class="card card-pad offline-banner">
    <span>API unavailable or offline: cached productivity data can stay visible, but OAuth, Gmail, and Calendar writes need the local API.</span>
    <a class="inline-action" href={hubHref(routeMap.settings)}>Open Settings</a>
  </section>
{/if}
{#if actionError}
  <section class="card card-pad error-banner">{actionError}</section>
{:else if actionMessage}
  <section class="card card-pad success-banner">{actionMessage}</section>
{/if}

<section class="status-strip" aria-label="Productivity status">
  <div><span>Google</span><strong>{googleConnected ? 'Connected' : 'Not connected'}</strong></div>
  <div><span>Accounts</span><strong>{googleConnections.length ? googleConnections.map((connection) => connection.accountLabel).join(', ') : 'None'}</strong></div>
  <div><span>Calendars</span><strong>{calendars.length}</strong></div>
  <div><span>Priority Mail</span><strong>{priorityThreads.length}</strong></div>
  <div><span>Timeline</span><strong>{timeline.length}</strong></div>
  <div><span>Local snapshot</span><strong>{cacheStatus}</strong></div>
</section>

<section class="google-setup-panel" aria-label="Google account setup">
  <div>
    <strong>Google account setup</strong>
    <p>
      Use Add Google Account once for each account you want Mini Hub to control. The OAuth flow opens Google's
      account picker in a popup, stores the token in your local API, and returns to this hub tab automatically.
    </p>
  </div>
  <button class="button compact" type="button" disabled={googleConnectDisabled} title={googleConnectTitle} on:click={connectGoogle}>
    <Link size={15} />
    <span>{googleOAuthOpening ? 'Opening...' : googleConnected ? 'Add Another' : 'Connect Google'}</span>
  </button>
</section>

{#if googleConnected}
  <section class="account-panel" aria-label="Connected Google accounts">
    <div class="account-panel-title">
      <strong>Connected Google Accounts</strong>
      <button class="button compact" type="button" disabled={googleConnectDisabled} title={googleConnectTitle} on:click={connectGoogle}>
        <Link size={15} />
        <span>{googleOAuthOpening ? 'Opening...' : 'Add'}</span>
      </button>
    </div>
    <div class="account-list">
      {#each googleConnections as connection}
        <article>
          <span>
            <strong>{connection.accountLabel}</strong>
            <small>{connection.status}{connection.lastSyncAt ? ` - ${displayTime(connection.lastSyncAt)}` : ''}</small>
          </span>
          <button class="icon-button" type="button" disabled={productivityWriteDisabled} title={productivityActionTitle('Revoke account')} aria-label={`Revoke ${connection.accountLabel}`} on:click={() => disconnectGoogle(connection)}>
            <Unlink size={16} />
          </button>
        </article>
      {/each}
    </div>
  </section>
{/if}

{#if catalog.length}
  <details class="connector-details">
    <summary>Connectors</summary>
    <div class="connector-list" aria-label="Integration catalog">
      {#each catalog as connector}
        <article>
          <strong>{connector.label}</strong>
          <span>{connector.status}</span>
          <p>{connector.notes}</p>
        </article>
      {/each}
    </div>
  </details>
{/if}

<section class="workspace-grid">
  <section class="card table-card">
    <div class="table-title-row">
      <div class="form-title">
        <CalendarPlus size={18} />
        <strong>Calendar</strong>
      </div>
      <div class="calendar-controls">
        <button class="icon-button" type="button" disabled={!productivityReadReady} title={productivityReadTitle('Show the previous calendar week.')} aria-label="Previous week" on:click={() => shiftCalendar(-7)}>
          <ChevronLeft size={16} />
        </button>
        <button class="button compact" type="button" disabled={!productivityReadReady} title={productivityReadTitle('Jump the calendar window to today.')} on:click={jumpToToday}>Today</button>
        <button class="icon-button" type="button" disabled={!productivityReadReady} title={productivityReadTitle('Show the next calendar week.')} aria-label="Next week" on:click={() => shiftCalendar(7)}>
          <ChevronRight size={16} />
        </button>
        <span>{calendarRangeLabel}</span>
      </div>
    </div>
    <div class="calendar-filter-row">
      <div class="field">
        <label for="event-search">Search events</label>
        <input id="event-search" bind:value={query} disabled={!productivityReadReady} on:change={refreshEvents} />
      </div>
      <div class="field">
        <label for="calendar-source">Calendar</label>
        <select id="calendar-source" bind:value={selectedCalendarId} disabled={!productivityReadReady} on:change={refreshEvents}>
          {#each calendars as calendar}
            <option value={calendar.id}>{calendar.summary}</option>
          {/each}
        </select>
      </div>
      <div class="field">
        <label for="move-target">Move target</label>
        <select id="move-target" bind:value={moveTargetCalendarId} disabled={productivityWriteDisabled}>
          <option value="">Choose calendar</option>
          {#each calendars as calendar}
            <option value={calendar.id}>{calendar.summary}</option>
          {/each}
        </select>
      </div>
    </div>
    <section class="calendar-board" aria-label="Visual calendar">
      {#each calendarWeek as day}
        <article class:today={day.isToday} class="calendar-day">
          <header>
            <span>{day.label}</span>
            <strong>{day.dateLabel}</strong>
          </header>
          <div class="day-lane">
            {#each day.events.slice(0, 5) as event}
              <button
                class="event-block"
                type="button"
                style={eventBlockStyle(event)}
                title={`${event.title} / ${eventTimeRange(event)}`}
                disabled={productivityWriteDisabled}
                on:click={() => editEvent(event)}
              >
                <span>{eventTimeRange(event)}</span>
                <strong>{event.title}</strong>
              </button>
            {/each}
            {#if day.events.length > 5}
              <small class="more-events">+{day.events.length - 5} more</small>
            {/if}
          </div>
        </article>
      {/each}
    </section>
    <div class="table-caption">
      <strong>{selectedCalendar?.summary ?? 'Calendar'}</strong>
      <span>{events.length ? `${events.length} events loaded from this window.` : 'No events loaded for this window yet.'}</span>
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
            <td>{calendarName(event.calendarId)}</td>
            <td class="row-actions">
              {#if event.htmlLink}
                <a class="icon-button" href={event.htmlLink} target="_blank" rel="noreferrer" aria-label="Open in Google Calendar" title="Open">
                  <ExternalLink size={16} />
                </a>
              {/if}
              <button class="icon-button" type="button" aria-label={`Edit ${event.title}`} title={productivityActionTitle('Edit event')} disabled={productivityWriteDisabled} on:click={() => editEvent(event)}>
                <Save size={16} />
              </button>
              <button class="icon-button" type="button" aria-label={`Move ${event.title}`} title={productivityActionTitle('Move event')} disabled={productivityWriteDisabled || !moveTargetCalendarId || moveTargetCalendarId === event.calendarId} on:click={() => moveSelectedEvent(event)}>
                <Send size={16} />
              </button>
              <button class="icon-button danger" type="button" aria-label={`Delete ${event.title}`} title={productivityActionTitle('Delete event')} disabled={productivityWriteDisabled} on:click={() => removeEvent(event)}>
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
    <div class="table-title-row">
      <div class="form-title">
        <Sparkles size={18} />
        <strong>Priority Inbox</strong>
      </div>
      <button class="button" type="button" disabled={!gmailReady || Boolean(actionBusyKey)} title={gmailRefreshTitle()} on:click={refreshGmail}>
        <RefreshCw size={17} />
        <span>{gmailLoading ? 'Sorting' : 'Refresh'}</span>
      </button>
    </div>
    <details class="mail-filter-panel">
      <summary>Mail search controls</summary>
      <div class="table-header gmail-header">
        <div class="field">
          <label for="gmail-search">Gmail search</label>
          <input id="gmail-search" bind:value={gmailQuery} disabled={!gmailReady} on:change={refreshGmail} />
        </div>
        <div class="field">
          <label for="gmail-label">Label</label>
          <select id="gmail-label" bind:value={selectedGmailLabelId} disabled={!gmailReady} on:change={refreshGmail}>
            <option value="">All labels</option>
            {#each gmailLabels as label}
              <option value={label.id}>{label.name}</option>
            {/each}
          </select>
        </div>
      </div>
    </details>
    <table>
      <thead>
        <tr>
          <th>Signal</th>
          <th>Thread</th>
          <th>Account</th>
          <th>From</th>
          <th>Date</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {#each priorityThreads as insight}
          {@const thread = insight.thread}
          <tr class:unread={thread.unread}>
            <td>
              <span class={`priority-pill ${priorityClass(insight.priority)}`}>{insight.priority}</span>
              <div class="muted">{insight.category}</div>
              <small class="triage-reason">{insight.reason}{insight.deadlineHint ? ` / ${insight.deadlineHint}` : ''}</small>
            </td>
            <td>
              <button class="link-button" type="button" disabled={productivityThreadOpenDisabled} title={gmailThreadOpenTitle()} on:click={() => openGmailThread(thread)}>
                <strong>{thread.subject}</strong>
              </button>
              <p class="mail-summary">{summarizeEmailThread(thread)}</p>
            </td>
            <td>{accountLabelForResource(thread.id)}</td>
            <td>{thread.from}</td>
            <td>{thread.date}</td>
            <td class="row-actions quick-row-actions">
              <button class="icon-button" type="button" disabled={productivityThreadOpenDisabled} aria-label={`Open ${thread.subject}`} title={gmailThreadOpenTitle()} on:click={() => openGmailThread(thread)}>
                <Mail size={16} />
                <span>{isActionBusy(`gmail:open:${thread.id}`) ? 'Opening' : 'Open'}</span>
              </button>
              <button class="icon-button" type="button" disabled={productivityWriteDisabled} aria-label={thread.unread ? `Mark ${thread.subject} read` : `Mark ${thread.subject} unread`} title={productivityActionTitle(thread.unread ? 'Mark read' : 'Mark unread')} on:click={() => toggleRead(thread)}>
                <MailOpen size={16} />
                <span>{isActionBusy(`gmail:read:${thread.id}`) ? 'Working' : thread.unread ? 'Read' : 'Unread'}</span>
              </button>
              <button
                class:active={isThreadImportant(thread)}
                class="icon-button"
                type="button"
                aria-label={isThreadImportant(thread) ? `Remove important from ${thread.subject}` : `Mark ${thread.subject} important`}
                disabled={productivityWriteDisabled}
                title={productivityActionTitle(isThreadImportant(thread) ? 'Remove important' : 'Mark important')}
                on:click={() => toggleImportant(thread)}
              >
                {#if isThreadImportant(thread)}
                  <StarOff size={16} />
                  <span>{isActionBusy(`gmail:important:${thread.id}`) ? 'Working' : 'Unmark'}</span>
                {:else}
                  <Star size={16} />
                  <span>{isActionBusy(`gmail:important:${thread.id}`) ? 'Working' : 'Important'}</span>
                {/if}
              </button>
              <button class="icon-button" type="button" disabled={productivityWriteDisabled} aria-label={`Archive ${thread.subject}`} title={productivityActionTitle('Archive')} on:click={() => archiveThread(thread)}>
                <Archive size={16} />
                <span>{isActionBusy(`gmail:archive:${thread.id}`) ? 'Archiving' : 'Archive'}</span>
              </button>
            </td>
          </tr>
        {:else}
          <tr><td colspan="6" class="muted">{googleConnected ? 'No priority Gmail threads matched. Try broadening the search controls.' : 'Connect Google to load and sort real Gmail threads.'}</td></tr>
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
        <button class="button" type="button" disabled={productivityWriteDisabled} title={productivityActionTitle('Toggle read state')} on:click={toggleSelectedRead}>
          <MailOpen size={17} />
          <span>{selectedGmailThread.unread ? 'Mark Read' : 'Mark Unread'}</span>
        </button>
        <button class="button" type="button" disabled={productivityWriteDisabled} title={productivityActionTitle('Toggle important state')} on:click={toggleSelectedImportant}>
          {#if isThreadImportant(selectedGmailThread)}
            <StarOff size={17} />
            <span>Unmark Important</span>
          {:else}
            <Star size={17} />
            <span>Mark Important</span>
          {/if}
        </button>
        <button class="button" type="button" disabled={productivityWriteDisabled} title={productivityActionTitle('Archive selected thread')} on:click={archiveSelectedThread}>
          <Archive size={17} />
          <span>Archive</span>
        </button>
        <button class="button" type="button" disabled={productivityWriteDisabled || !selectedGmailLabelId} title={productivityActionTitle('Apply selected label')} on:click={applySelectedLabel}>
          <Tag size={17} />
          <span>{selectedGmailThread && isActionBusy(`gmail:label:${selectedGmailThread.id}`) ? 'Applying' : 'Apply Label'}</span>
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
        <textarea id="gmail-reply" bind:value={replyBody} disabled={productivityWriteDisabled} rows="5"></textarea>
      </div>
      <div class="action-row">
        <button class="button" type="button" disabled={productivityWriteDisabled || !replyBody.trim()} title={productivityActionTitle('Save reply as a Gmail draft')} on:click={() => sendReply(false)}>
          <Save size={17} />
          <span>{selectedGmailThread && isActionBusy(`gmail:reply:draft:${selectedGmailThread.id}`) ? 'Saving' : 'Draft Reply'}</span>
        </button>
        <button class="button primary" type="button" disabled={productivityWriteDisabled || !replyBody.trim()} title={productivityActionTitle('Send this Gmail reply')} on:click={() => sendReply(true)}>
          <Reply size={17} />
          <span>{selectedGmailThread && isActionBusy(`gmail:reply:send:${selectedGmailThread.id}`) ? 'Sending' : 'Send Reply'}</span>
        </button>
      </div>
    {:else}
      <p class="muted">Select a Gmail thread to read the full messages and reply.</p>
    {/if}
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

{#if eventDialogOpen}
  <div class="modal-layer">
    <button class="modal-backdrop" type="button" aria-label="Close event editor" on:click={closeEventDialog}></button>
    <div class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="event-dialog-title">
      <form class="modal-form" on:submit|preventDefault={saveEvent}>
      <div class="modal-title">
        <div class="form-title">
          <CalendarPlus size={18} />
          <strong id="event-dialog-title">{editingEventId ? 'Edit Event' : 'Create Event'}</strong>
        </div>
        <button class="icon-button" type="button" aria-label="Close event editor" on:click={closeEventDialog}>
          <X size={16} />
        </button>
      </div>
      <div class="modal-grid">
        <div class="field">
          <label for="calendar">Calendar</label>
          <select id="calendar" bind:value={selectedCalendarId} disabled={productivityWriteDisabled} on:change={refreshEvents}>
            <option value="primary">Primary</option>
            {#each calendars as calendar}
              <option value={calendar.id}>{calendar.summary}</option>
            {/each}
          </select>
        </div>
        <div class="field">
          <label for="event-title">Title</label>
          <input id="event-title" bind:value={eventDraft.title} disabled={productivityWriteDisabled} />
        </div>
        <div class="field">
          <label for="event-start">Start</label>
          <input id="event-start" bind:value={eventDraft.start} disabled={productivityWriteDisabled} type="datetime-local" />
        </div>
        <div class="field">
          <label for="event-end">End</label>
          <input id="event-end" bind:value={eventDraft.end} disabled={productivityWriteDisabled} type="datetime-local" />
        </div>
        <div class="field">
          <label for="event-zone">Time zone</label>
          <input id="event-zone" bind:value={eventDraft.timeZone} disabled={productivityWriteDisabled} />
        </div>
        <div class="field">
          <label for="event-location">Location</label>
          <input id="event-location" bind:value={eventDraft.location} disabled={productivityWriteDisabled} />
        </div>
        <div class="field">
          <label for="event-reminder">Reminder minutes</label>
          <input id="event-reminder" bind:value={eventDraft.reminders.overrides[0].minutes} disabled={productivityWriteDisabled} type="number" min="0" step="5" />
        </div>
        <div class="field wide">
          <label for="event-description">Description</label>
          <textarea id="event-description" bind:value={eventDraft.description} disabled={productivityWriteDisabled} rows="3"></textarea>
        </div>
        <div class="field wide">
          <label for="event-recurrence">Recurrence rules</label>
          <textarea
            id="event-recurrence"
            disabled={productivityWriteDisabled}
            rows="2"
            placeholder="RRULE:FREQ=WEEKLY;COUNT=6"
            value={(eventDraft.recurrence ?? []).join('\n')}
            on:input={(event) => (eventDraft.recurrence = event.currentTarget.value.split('\n').map((line) => line.trim()).filter(Boolean))}
          ></textarea>
        </div>
      </div>
      <div class="action-row">
        <button class="button primary" type="submit" disabled={productivityWriteDisabled || !eventDraft.title.trim() || !eventDraft.start || !eventDraft.end} title={productivityActionTitle(editingEventId ? 'Update this Google Calendar event.' : 'Create this Google Calendar event.')}>
          <Save size={17} />
          <span>{isActionBusy(editingEventId ? `event:save:${editingEventId}` : 'event:create') ? 'Saving Event' : editingEventId ? 'Update Event' : 'Create Event'}</span>
        </button>
        <button class="button" type="button" on:click={closeEventDialog}>Cancel</button>
      </div>
      </form>
    </div>
  </div>
{/if}

{#if composeDialogOpen}
  <div class="modal-layer">
    <button class="modal-backdrop" type="button" aria-label="Close composer" on:click={closeComposeDialog}></button>
    <div class="modal-panel modal-form" role="dialog" aria-modal="true" aria-labelledby="compose-dialog-title">
      <div class="modal-title">
        <div class="form-title">
          <Send size={18} />
          <strong id="compose-dialog-title">Compose</strong>
        </div>
        <button class="icon-button" type="button" aria-label="Close composer" on:click={closeComposeDialog}>
          <X size={16} />
        </button>
      </div>
      <div class="modal-grid compose-grid">
        <div class="field">
          <label for="compose-to">To</label>
          <input id="compose-to" value={addressesValue(composeDraft.to)} disabled={productivityWriteDisabled} on:input={(event) => (composeDraft.to = splitAddresses(inputValue(event)))} />
        </div>
        <div class="field">
          <label for="compose-cc">Cc</label>
          <input id="compose-cc" value={addressesValue(composeDraft.cc)} disabled={productivityWriteDisabled} on:input={(event) => (composeDraft.cc = splitAddresses(inputValue(event)))} />
        </div>
        <div class="field">
          <label for="compose-bcc">Bcc</label>
          <input id="compose-bcc" value={addressesValue(composeDraft.bcc)} disabled={productivityWriteDisabled} on:input={(event) => (composeDraft.bcc = splitAddresses(inputValue(event)))} />
        </div>
        <div class="field wide">
          <label for="compose-subject">Subject</label>
          <input id="compose-subject" bind:value={composeDraft.subject} disabled={productivityWriteDisabled} />
        </div>
        <div class="field wide">
          <label for="compose-body">Body</label>
          <textarea id="compose-body" bind:value={composeDraft.bodyText} disabled={productivityWriteDisabled} rows="7"></textarea>
        </div>
      </div>
      <div class="action-row">
        <button class="button" type="button" disabled={productivityWriteDisabled || !composeDraft.to.length || !composeDraft.subject.trim() || !composeDraft.bodyText.trim()} title={productivityActionTitle('Save this message as a Gmail draft.')} on:click={() => sendCompose(false)}>
          <Save size={17} />
          <span>{isActionBusy('gmail:compose:draft') ? 'Saving Draft' : 'Save Draft'}</span>
        </button>
        <button class="button primary" type="button" disabled={productivityWriteDisabled || !composeDraft.to.length || !composeDraft.subject.trim() || !composeDraft.bodyText.trim()} title={productivityActionTitle('Send this Gmail message.')} on:click={() => sendCompose(true)}>
          <Send size={17} />
          <span>{isActionBusy('gmail:compose:send') ? 'Sending Email' : 'Send Email'}</span>
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .offline-banner,
  .error-banner,
  .success-banner {
    margin-bottom: 14px;
    font-weight: 800;
  }

  .button.compact {
    min-height: 28px;
    padding: 4px 8px;
    font-size: 12px;
  }

  .offline-banner {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    justify-content: space-between;
    border-color: var(--warning-border);
    color: var(--warning-text);
    background: var(--warning-bg);
  }

  .inline-action {
    color: inherit;
    font-weight: 850;
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

  .status-strip {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: 0;
    margin: 0 0 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface);
    overflow: hidden;
  }

  .status-strip div {
    display: grid;
    gap: 3px;
    min-width: 0;
    padding: 9px 11px;
    border-right: 1px solid var(--border);
  }

  .status-strip div:last-child {
    border-right: 0;
  }

  .status-strip span,
  .connector-details summary {
    color: var(--muted);
    font-size: 12px;
    font-weight: 750;
  }

  .status-strip strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .google-setup-panel {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 12px;
    align-items: center;
    margin: 0 0 10px;
    padding: 10px 11px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface);
  }

  .google-setup-panel p {
    margin: 3px 0 0;
    color: var(--muted);
    line-height: 1.35;
  }

  .account-panel {
    margin: 0 0 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface);
    overflow: hidden;
  }

  .account-panel-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    min-height: 38px;
    padding: 8px 11px;
    border-bottom: 1px solid var(--border);
  }

  .account-list {
    display: grid;
  }

  .account-list article {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 10px;
    align-items: center;
    min-height: 48px;
    padding: 8px 11px;
    border-bottom: 1px solid var(--border);
  }

  .account-list article:last-child {
    border-bottom: 0;
  }

  .account-list span {
    display: grid;
    gap: 2px;
    min-width: 0;
  }

  .account-list strong,
  .account-list small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .account-list small {
    color: var(--muted);
  }

  .connector-details {
    margin: 0 0 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface);
  }

  .connector-details summary {
    padding: 8px 11px;
    cursor: pointer;
  }

  .connector-list {
    display: grid;
    gap: 0;
    border-top: 1px solid var(--border);
  }

  .connector-list article {
    display: grid;
    grid-template-columns: minmax(140px, 0.4fr) 96px minmax(0, 1fr);
    gap: 10px;
    padding: 8px 11px;
    border-bottom: 1px solid var(--border);
    align-items: center;
  }

  .connector-list article:last-child {
    border-bottom: 0;
  }

  .connector-list span,
  .connector-list p {
    margin: 0;
    color: var(--muted);
  }

  .workspace-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 14px;
    align-items: start;
  }

  .calendar-controls {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: 8px;
    color: var(--muted);
    font-weight: 800;
  }

  .calendar-filter-row {
    display: grid;
    grid-template-columns: minmax(180px, 1fr) minmax(180px, 280px) minmax(180px, 260px);
    gap: 12px;
    padding: 14px;
    border-bottom: 1px solid var(--border);
  }

  .calendar-board {
    display: grid;
    grid-template-columns: repeat(7, minmax(120px, 1fr));
    min-height: 280px;
    overflow-x: auto;
    border-bottom: 1px solid var(--border);
  }

  .calendar-day {
    display: grid;
    grid-template-rows: auto 1fr;
    min-width: 120px;
    border-right: 1px solid var(--border);
    background: var(--surface);
  }

  .calendar-day:last-child {
    border-right: 0;
  }

  .calendar-day.today {
    background: var(--surface-soft);
  }

  .calendar-day header {
    display: grid;
    gap: 2px;
    min-height: 48px;
    padding: 8px 9px;
    border-bottom: 1px solid var(--border);
  }

  .calendar-day header span {
    color: var(--muted);
    font-size: 11px;
    font-weight: 850;
    text-transform: uppercase;
  }

  .calendar-day header strong {
    font-size: 13px;
  }

  .day-lane {
    position: relative;
    min-height: 226px;
    padding: 6px;
    background:
      linear-gradient(to bottom, transparent 0, transparent calc(25% - 1px), var(--border) 25%, transparent calc(25% + 1px)),
      linear-gradient(to bottom, transparent 0, transparent calc(50% - 1px), var(--border) 50%, transparent calc(50% + 1px)),
      linear-gradient(to bottom, transparent 0, transparent calc(75% - 1px), var(--border) 75%, transparent calc(75% + 1px));
  }

  .event-block {
    position: absolute;
    inset: var(--event-top) 6px auto 6px;
    display: grid;
    align-content: start;
    min-height: var(--event-height);
    max-height: 86px;
    padding: 6px 7px;
    overflow: hidden;
    border: 1px solid var(--border-strong);
    border-radius: 6px;
    color: var(--text);
    background: var(--surface-muted);
    cursor: pointer;
    text-align: left;
  }

  .event-block:hover {
    background: var(--active);
  }

  .event-block span,
  .event-block strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .event-block span {
    color: var(--muted);
    font-size: 11px;
    font-weight: 800;
  }

  .event-block strong {
    font-size: 12px;
  }

  .more-events {
    position: absolute;
    right: 8px;
    bottom: 6px;
    color: var(--muted);
    font-weight: 800;
  }

  .table-caption {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 9px 14px;
    border-bottom: 1px solid var(--border);
    color: var(--muted);
  }

  .table-caption strong {
    color: var(--text);
  }

  .gmail-workspace {
    display: grid;
    grid-template-columns: minmax(0, 1.1fr) minmax(320px, 0.9fr);
    gap: 14px;
    align-items: start;
    margin-top: 14px;
  }

  .gmail-header {
    grid-template-columns: minmax(180px, 1fr) minmax(160px, 240px);
    align-items: end;
  }

  .table-title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--border);
  }

  .mail-filter-panel {
    border-bottom: 1px solid var(--border);
  }

  .mail-filter-panel summary {
    padding: 8px 14px;
    color: var(--muted);
    cursor: pointer;
    font-size: 12px;
    font-weight: 800;
  }

  .mail-filter-panel .table-header {
    border-bottom: 0;
  }

  .priority-pill {
    display: inline-grid;
    min-width: 38px;
    height: 24px;
    place-items: center;
    border: 1px solid var(--border-strong);
    border-radius: 999px;
    font-size: 12px;
    font-weight: 900;
    background: var(--surface-muted);
  }

  .priority-pill.high {
    border-color: var(--error-border);
    color: var(--error-text);
    background: var(--error-bg);
  }

  .priority-pill.medium {
    border-color: var(--warning-border);
    color: var(--warning-text);
    background: var(--warning-bg);
  }

  .priority-pill.low {
    border-color: var(--border);
    color: var(--muted);
  }

  .triage-reason {
    display: block;
    margin-top: 3px;
    max-width: 160px;
    color: var(--muted);
    line-height: 1.25;
  }

  .mail-summary {
    margin: 5px 0 0;
    max-width: 460px;
    color: var(--muted);
    line-height: 1.35;
  }

  .quick-row-actions {
    min-width: 310px;
    opacity: 0.34;
    transform: translateX(8px);
    transition:
      opacity 140ms ease,
      transform 140ms ease;
  }

  tr:hover .quick-row-actions,
  tr:focus-within .quick-row-actions {
    opacity: 1;
    transform: translateX(0);
  }

  .quick-row-actions .icon-button {
    display: inline-flex;
    width: auto;
    min-width: 0;
    padding: 0 8px;
    gap: 5px;
    white-space: nowrap;
  }

  .quick-row-actions .icon-button span {
    font-size: 12px;
    font-weight: 850;
  }

  .mail-panel {
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

  .icon-button.active {
    color: var(--text);
    background: var(--active);
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

  .modal-layer {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: grid;
    place-items: start center;
    padding: 7vh 16px 24px;
  }

  .modal-backdrop {
    position: absolute;
    inset: 0;
    border: 0;
    background: color-mix(in srgb, var(--bg) 78%, transparent);
    backdrop-filter: blur(3px);
    cursor: default;
  }

  .modal-panel {
    position: relative;
    z-index: 1;
    display: grid;
    gap: 14px;
    width: min(760px, 100%);
    max-height: 86vh;
    overflow: auto;
    padding: 14px;
    border: 1px solid var(--border-strong);
    border-radius: 7px;
    background: var(--surface);
    box-shadow: 0 18px 50px color-mix(in srgb, var(--code-bg) 28%, transparent);
  }

  .modal-form {
    display: grid;
    gap: 14px;
  }

  .modal-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .modal-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }

  @media (max-width: 1100px) {
    .status-strip {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .gmail-workspace {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 760px) {
    .status-strip,
    .google-setup-panel,
    .connector-list article,
    .calendar-filter-row,
    .table-header,
    .modal-grid,
    .compose-grid {
      grid-template-columns: 1fr;
    }

    .table-title-row,
    .table-caption {
      align-items: stretch;
      flex-direction: column;
    }

    .calendar-controls {
      justify-content: flex-start;
    }

    .quick-row-actions {
      opacity: 1;
      transform: none;
    }

    .status-strip div {
      border-right: 0;
      border-bottom: 1px solid var(--border);
    }

    .status-strip div:last-child {
      border-bottom: 0;
    }
  }
</style>
