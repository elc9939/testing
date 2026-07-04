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
  import type { CalendarEvent, GmailLabel, GmailThread, TimelineItem } from '@mini-hub/core';
  import { attentionStore } from '$lib/attention-store';
  import { getApiUrl } from '$lib/api';
  import { getBrowserStorage } from '$lib/browser-storage';
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
  import { compactServiceIssueIfRecognized } from '$lib/service-issues';

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
    selectedGmailThread: GmailThread | null;
    selectedCalendarId: string;
    calendarCursorKey: string;
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

  interface ProductivityStatusState {
    loading: boolean;
    actionBusyKey: string;
    canAct: boolean;
    apiChecking: boolean;
    googleConnected: boolean;
    googleNeedsReconnect: boolean;
    productivityReady: boolean;
    cacheLoadedAt: string;
  }

  interface ProductivityControlTitleState extends ProductivityStatusState {
    backgroundRefreshing: boolean;
    gmailLoading: boolean;
    selectedGmailLabelId: string;
    replyBody: string;
    editingEventId: string;
    eventDraft: CalendarEventDraft;
    composeDraft: GmailComposeDraft;
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
  let cacheWarning = '';
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
  $: apiChecking = !$clientData.initialized || $clientData.status === 'syncing';
  $: googleConnections = connections.filter((connection) => connection.provider === 'google' && connection.status === 'connected');
  $: googleConnection = googleConnections[0];
  $: googleConnected = googleConnections.length > 0;
  $: googleNeedsReconnect = googleConnected && isGoogleAuthError(actionError);
  $: productivityReady = canAct && googleConnected && !googleNeedsReconnect;
  $: productivityReadReady = productivityReady && !loading;
  $: productivityWriteDisabled = loading || !productivityReady || Boolean(actionBusyKey);
  $: productivityRefreshDisabled = loading || backgroundRefreshing || Boolean(actionBusyKey);
  $: productivityEventInspectDisabled = Boolean(actionBusyKey);
  $: productivityThreadOpenDisabled = Boolean(actionBusyKey);
  $: gmailReady = productivityReady && !gmailLoading;
  $: googleConnectDisabled = loading || !canAct || googleOAuthOpening || Boolean(actionBusyKey);
  $: googleConnectTitle = loading
    ? 'Productivity is still loading the latest connection state.'
    : apiChecking
    ? 'Productivity is checking the local API before opening Google OAuth.'
    : !canAct
    ? 'Start or connect the local API before opening Google OAuth.'
    : googleOAuthOpening
      ? 'Google OAuth popup is already opening.'
      : actionBusyKey
      ? 'Another Productivity action is already running.'
      : googleNeedsReconnect
        ? 'Reconnect Google through OAuth; choose the saved account in the popup so Gmail and Calendar can refresh.'
        : googleConnected
          ? 'Open Google OAuth account picker to add another Google account.'
          : 'Open Google OAuth account picker.';
  $: googleConnectionManageDisabled = loading || !canAct || Boolean(actionBusyKey);
  $: googleHeaderButtonLabel = googleOAuthOpening
    ? 'Opening sign-in'
    : googleNeedsReconnect
      ? 'Reconnect Google'
      : googleConnected
        ? 'Add Google Account'
        : 'Connect Google';
  $: googleSetupButtonLabel = googleOAuthOpening
    ? 'Opening sign-in'
    : googleNeedsReconnect
      ? 'Reconnect Google'
      : googleConnected
        ? 'Add Another'
        : 'Connect Google';
  $: googleAccountPanelAddLabel = googleOAuthOpening ? 'Opening sign-in' : googleNeedsReconnect ? 'Reconnect Google' : 'Add';
  $: googleConnectionManageTitle = actionBusyKey
    ? 'Another Productivity action is already running.'
    : loading
      ? 'Productivity is still loading the latest connection state.'
      : !canAct
        ? 'Start or connect the local API before revoking a saved Google account.'
        : 'Ask for confirmation before revoking this Google account.';
  $: selectedCalendar = calendars.find((calendar) => calendar.id === selectedCalendarId);
  $: calendarWeek = buildCalendarWeek(events, calendarCursor);
  $: calendarRangeLabel = `${displayShortDate(localDateKey(calendarCursor))} - ${displayShortDate(localDateKey(addDays(calendarCursor, 6)))}`;
  $: cacheStatus = cacheLoadedAt ? `Cached ${displayTime(cacheLoadedAt)}` : 'No browser cache snapshot yet';
  $: productivityStatusState = {
    loading,
    actionBusyKey,
    canAct,
    apiChecking,
    googleConnected,
    googleNeedsReconnect,
    productivityReady,
    cacheLoadedAt
  };
  $: productivityWriteStatus = productivityWriteStateLabel(productivityStatusState);
  $: productivityWriteDetail = productivityWriteStateDetail(productivityStatusState);
  $: productivityReadStatus = productivityReadStateLabel(productivityStatusState);
  $: productivityReadDetail = productivityReadStateDetail(productivityStatusState);
  $: productivityControlTitleState = {
    ...productivityStatusState,
    backgroundRefreshing,
    gmailLoading,
    selectedGmailLabelId,
    replyBody,
    editingEventId,
    eventDraft,
    composeDraft
  };
  $: productivityRefreshButtonTitle = productivityRefreshTitle(productivityControlTitleState);
  $: gmailRefreshButtonTitle = gmailRefreshTitle(productivityControlTitleState);
  $: gmailThreadOpenButtonTitle = gmailThreadOpenTitle(productivityControlTitleState);
  $: selectedLabelButtonTitle = selectedLabelActionTitle(productivityControlTitleState);
  $: replyDraftButtonTitle = replyActionTitle(productivityControlTitleState, false);
  $: replySendButtonTitle = replyActionTitle(productivityControlTitleState, true);
  $: eventSaveButtonTitle = eventSaveActionTitle(productivityControlTitleState);
  $: composeDraftButtonTitle = composeActionTitle(productivityControlTitleState, false);
  $: composeSendButtonTitle = composeActionTitle(productivityControlTitleState, true);
  $: newEventButtonTitle = productivityActionTitleForState(productivityControlTitleState, 'Create a Google Calendar event.');
  $: composeButtonTitle = productivityActionTitleForState(productivityControlTitleState, 'Compose a Gmail message.');
  $: eventCalendarSelectDisabled = productivityWriteDisabled || Boolean(editingEventId);
  $: eventCalendarSelectTitle = eventCalendarActionTitle(productivityControlTitleState);
  $: visibleActionError = actionError ? compactProductivityServiceIssue(actionError) : '';
  $: productivityCacheDetail = cacheWarning
    ? cacheWarning
    : cacheLoadedAt
      ? 'Calendar, mail, filters, and selected account restore from this browser before live refresh finishes.'
      : 'No browser snapshot has been saved yet; connect Google and refresh to create one.';
  $: productivityConnectionDetail = googleConnected
    ? googleNeedsReconnect
      ? `${googleConnections.length} saved Google account${googleConnections.length === 1 ? '' : 's'} need OAuth refresh before Gmail or Calendar actions can run.`
      : `${googleConnections.length} account${googleConnections.length === 1 ? '' : 's'} available for Gmail and Calendar actions.`
    : 'Connect Google to enable live Gmail, Calendar, and write actions.';
  $: googleStatusDisplay = googleConnected ? (googleNeedsReconnect ? 'Needs reconnect' : 'Connected') : 'Not connected';
  $: productivityApiDetail = canAct
    ? `Using Mini Hub API at ${getApiUrl()} for OAuth and writes.`
    : apiChecking
      ? `Checking Mini Hub API at ${getApiUrl()}; cached data stays visible while writes wait.`
    : `Mini Hub API is unavailable at ${getApiUrl()}; cached data remains read-only.`;
  $: productivityApiBannerText = apiChecking
    ? 'Checking the local API and browser cache: cached productivity data can stay visible, and OAuth, Gmail, and Calendar writes will unlock when the API is ready.'
    : 'API unavailable or offline: cached productivity data can stay visible, but OAuth, Gmail, and Calendar writes need the local API.';

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
    const storage = getBrowserStorage('session');
    if (!value || !storage) return;
    try {
      storage.setItem(googleOAuthReturnToStorageKey, value);
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
    const storage = getBrowserStorage();
    if (!storage) return null;
    try {
      const parsed = JSON.parse(storage.getItem(productivityCacheKey) ?? 'null') as Partial<ProductivityCache> | null;
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
        selectedGmailThread: isRecord(parsed.selectedGmailThread) ? (parsed.selectedGmailThread as GmailThread) : null,
        selectedCalendarId: typeof parsed.selectedCalendarId === 'string' ? parsed.selectedCalendarId : 'primary',
        calendarCursorKey: typeof parsed.calendarCursorKey === 'string' ? parsed.calendarCursorKey : localDateKey(calendarCursor),
        query: typeof parsed.query === 'string' ? parsed.query : '',
        gmailQuery: typeof parsed.gmailQuery === 'string' ? parsed.gmailQuery : defaultGmailQuery,
        selectedGmailLabelId: typeof parsed.selectedGmailLabelId === 'string' ? parsed.selectedGmailLabelId : ''
      };
    } catch {
      return null;
    }
  }

  function hydrateProductivityCache(): boolean {
    const cached = readProductivityCache();
    if (!cached) return false;
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
    eventDraft = {
      ...eventDraft,
      calendarId: selectedCalendarId,
      timeZone: cached.calendars.find((calendar) => calendar.id === selectedCalendarId)?.timeZone ?? localTimeZone
    };
    query = cached.query;
    gmailQuery = cached.gmailQuery;
    selectedGmailLabelId = cached.selectedGmailLabelId;
    const restoredThread = cached.selectedGmailThread
      ? (gmailThreads.find((thread) => thread.id === cached.selectedGmailThread?.id) ?? cached.selectedGmailThread)
      : null;
    selectedGmailThread = restoredThread ?? gmailThreads[0] ?? null;
    const restoredCursor = localDateFromKey(cached.calendarCursorKey);
    calendarCursor = Number.isNaN(restoredCursor.getTime()) ? startOfLocalDay(new Date()) : startOfLocalDay(restoredCursor);
    cacheLoadedAt = cached.cachedAt;
    cacheWarning = '';
    return true;
  }

  function persistProductivityCache(): void {
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
      selectedGmailThread,
      selectedCalendarId,
      calendarCursorKey: localDateKey(calendarCursor),
      query,
      gmailQuery,
      selectedGmailLabelId
    };
    const storage = getBrowserStorage();
    if (!storage) {
      cacheWarning = 'Browser productivity cache is unavailable; live Google data is visible but may not survive refresh.';
      return;
    }
    try {
      storage.setItem(productivityCacheKey, JSON.stringify(payload));
      cacheLoadedAt = cachedAt;
      cacheWarning = '';
    } catch {
      cacheWarning = 'Browser productivity cache could not be updated; live Google data is visible but may not survive refresh.';
    }
  }

  function draftForApi(): CalendarEventDraft {
    return {
      ...eventDraft,
      calendarId: eventDraft.calendarId || selectedCalendarId,
      start: fromLocalInput(eventDraft.start),
      end: fromLocalInput(eventDraft.end),
      recurrence: eventDraft.recurrence?.filter(Boolean) ?? [],
      reminders: eventDraft.reminders
    };
  }

  function setError(error: unknown, fallback: string): void {
    actionError = error instanceof Error ? error.message : fallback;
  }

  function compactProductivityServiceIssue(message = ''): string {
    const text = message.trim();
    if (!text) return 'Productivity could not complete that action.';
    if (/access blocked|verification process|developer-approved testers|access_denied/iu.test(text)) {
      return 'Google blocked OAuth for this account; add the account as a tester or use a verified OAuth app.';
    }
    const compact = compactServiceIssueIfRecognized(text, 'Productivity');
    return compact === text && text.length > 140 ? `${text.slice(0, 137)}...` : compact;
  }

  function isGoogleAuthError(message = ''): boolean {
    return /token has been expired or revoked|invalid_grant|unauthori[sz]ed|401|403|access_denied|oauth|permission/iu.test(message);
  }

  function productivityActionTitle(enabledTitle: string): string {
    if (actionBusyKey) return 'Another Productivity action is already running.';
    if (googleNeedsReconnect) return 'Google saved tokens are expired or revoked. Use Reconnect Google to refresh OAuth before Gmail or Calendar actions.';
    if (!canAct) return 'Start or connect the local API before using Gmail or Calendar write actions.';
    if (!googleConnected) return 'Connect Google before using Gmail or Calendar write actions.';
    if (apiChecking) return 'Productivity is checking the local API before enabling this action.';
    if (loading) return 'Productivity is still loading the latest connection state.';
    if (!productivityReady) return 'Connect the API and Google before using this action.';
    return enabledTitle;
  }

  function productivityWriteStateLabel(state: ProductivityStatusState): string {
    if (state.loading) return 'Checking connections';
    if (state.apiChecking) return 'Checking API';
    if (state.actionBusyKey) return 'Busy';
    if (!state.canAct) return 'API offline';
    if (!state.googleConnected) return 'Google setup';
    if (googleNeedsReconnect) return 'Reconnect needed';
    return 'Write-ready';
  }

  function productivityWriteStateDetail(state: ProductivityStatusState): string {
    if (state.loading) return 'Waiting for API, Google, Gmail, and Calendar state before enabling writes.';
    if (state.apiChecking) return 'Opening the browser cache and checking the Mini Hub API before enabling OAuth or writes.';
    if (state.actionBusyKey) return 'Another Productivity action is running; write controls stay locked until it finishes.';
    if (!state.canAct) return 'OAuth, Gmail, and Calendar writes need the local API; cached rows stay readable.';
    if (!state.googleConnected) return 'Use Connect Google or Add Google Account before sending mail or changing calendar events.';
    if (googleNeedsReconnect) return 'Saved Google tokens are expired or revoked. Use Reconnect Google to refresh OAuth before sending mail or editing calendar events.';
    return 'Gmail and Calendar write controls can use connected Google accounts.';
  }

  function productivityReadStateLabel(state: ProductivityStatusState): string {
    if (state.loading) return 'Opening cache';
    if (state.productivityReady) return 'Live reads';
    if (state.apiChecking && state.cacheLoadedAt) return 'Cached while checking';
    if (state.apiChecking) return 'Checking API';
    if (state.cacheLoadedAt) return 'Cached read-only';
    if (!state.canAct) return 'API offline';
    if (!state.googleConnected) return 'Google setup';
    if (googleNeedsReconnect) return 'Reconnect needed';
    return 'Unavailable';
  }

  function productivityReadStateDetail(state: ProductivityStatusState): string {
    if (state.loading) return 'Opening cached productivity data first, then live Google data when available.';
    if (state.productivityReady) return 'Calendar and Gmail reads can refresh from connected Google accounts.';
    if (state.apiChecking && state.cacheLoadedAt) return 'Showing the last browser snapshot while Mini Hub checks the API and Google connection state.';
    if (state.apiChecking) return 'Checking the Mini Hub API before loading live Gmail and Calendar data.';
    if (state.cacheLoadedAt) return 'Showing the last browser snapshot; live refresh, search, and edits wait for the local API and Google.';
    if (!state.canAct) return 'Start or connect the local API to load live Gmail and Calendar data.';
    if (!state.googleConnected) return 'Connect Google to load live Gmail and Calendar data.';
    if (googleNeedsReconnect) return 'Saved Google tokens are expired or revoked. Reconnect Google to load live Calendar and Gmail data.';
    return 'Open Settings to inspect Productivity wiring.';
  }

  function googleAccountStatusLabel(connection: PublicConnection): string {
    if (connection.provider === 'google' && googleNeedsReconnect) return 'needs reconnect';
    return connection.status;
  }

  function productivityRefreshTitle(state: ProductivityControlTitleState): string {
    if (state.actionBusyKey) return 'Another Productivity action is already running.';
    if (state.loading) return 'Productivity is already loading.';
    if (state.backgroundRefreshing) return 'Productivity is already refreshing.';
    return 'Refresh calendar, mail, and connection data.';
  }

  function gmailRefreshTitle(state: ProductivityControlTitleState): string {
    if (state.actionBusyKey) return 'Another Productivity action is already running.';
    if (googleNeedsReconnect) return 'Reconnect Google before refreshing Gmail. Cached mail remains readable.';
    if (!state.productivityReady) return 'Connect the API and Google to refresh Gmail. Cached mail remains readable.';
    if (state.gmailLoading) return 'Priority Gmail is already refreshing.';
    return 'Refresh priority Gmail threads.';
  }

  function gmailThreadOpenTitle(state: ProductivityControlTitleState): string {
    if (state.actionBusyKey) return 'Another Productivity action is already running.';
    if (googleNeedsReconnect) return 'Open the cached thread preview. Reconnect Google to fetch full messages.';
    if (!state.productivityReady) return 'Open the cached thread preview. Connect the API and Google to fetch full messages.';
    return 'Open Gmail thread and fetch the latest messages.';
  }

  function gmailThreadReadActionTitle(state: ProductivityControlTitleState, thread: GmailThread): string {
    if (thread.unread) {
      return productivityActionTitleForState(state, `Mark "${thread.subject}" read in Gmail; it leaves the priority queue and the browser cache refreshes.`);
    }
    return productivityActionTitleForState(state, `Mark "${thread.subject}" unread in Gmail; the priority inbox and browser cache refresh afterward.`);
  }

  function gmailThreadImportantActionTitle(state: ProductivityControlTitleState, thread: GmailThread): string {
    if (isThreadImportant(thread)) {
      return productivityActionTitleForState(state, `Remove the IMPORTANT label from "${thread.subject}" in Gmail; the visible thread state refreshes afterward.`);
    }
    return productivityActionTitleForState(state, `Add the IMPORTANT label to "${thread.subject}" in Gmail; the visible thread state refreshes afterward.`);
  }

  function gmailThreadArchiveActionTitle(state: ProductivityControlTitleState, thread: GmailThread): string {
    return productivityActionTitleForState(state, `Archive "${thread.subject}" in Gmail; this does not delete it, and the priority list plus browser cache refresh afterward.`);
  }

  function productivityReadTitle(enabledTitle: string): string {
    if (googleNeedsReconnect) return 'Reconnect Google to load live calendar controls. Cached data remains visible.';
    if (loading) return 'Productivity is still loading the latest connection state.';
    if (!productivityReady) return 'Connect the API and Google to load live calendar controls. Cached data remains visible.';
    return enabledTitle;
  }

  function calendarWindowSummary(): string {
    if (events.length) return `${events.length} events loaded from this window.`;
    if (loading) return 'Checking cached calendar events before live Google refresh.';
    if (apiChecking && cacheLoadedAt) return 'No cached events in this window while the API check continues.';
    if (!productivityReady && cacheLoadedAt) return 'No cached events in this window; connect the API and Google to refresh live Calendar.';
    if (!productivityReady) return 'Calendar waits for the API and a connected Google account.';
    return 'No live Google Calendar events in this window.';
  }

  function calendarTableEmptyMessage(): string {
    if (loading) return 'Checking cached calendar events before live Google refresh.';
    if (apiChecking && cacheLoadedAt) return 'No cached calendar events match this range while the API check continues.';
    if (!productivityReady && cacheLoadedAt) return 'No cached calendar events match this range; connect the API and Google to refresh live Calendar.';
    if (!productivityReady) return 'Connect Google to load real calendar events.';
    return 'No live Google Calendar events match this range. Try another week, search, or calendar.';
  }

  function priorityInboxEmptyMessage(): string {
    if (loading || gmailLoading) return 'Checking cached Gmail threads and connected accounts.';
    if (apiChecking && cacheLoadedAt) return 'No cached priority Gmail threads while the API check continues.';
    if (!productivityReady && cacheLoadedAt) return 'No cached priority Gmail threads; connect the API and Google to refresh live Gmail.';
    if (!productivityReady) return 'Connect Google to load and sort real Gmail threads.';
    return 'No priority Gmail threads matched. Try broadening the search controls.';
  }

  function timelineEmptyMessage(): string {
    if (loading) return 'Checking cached timeline items and connected deadlines.';
    if (apiChecking && cacheLoadedAt) return 'No cached timeline items while the API check continues.';
    if (!productivityReady && cacheLoadedAt) return 'No cached timeline items; connect the API and Google to refresh live deadlines.';
    if (!productivityReady) return 'Connect the API and Google to load timeline items.';
    return 'No timeline items match the current connected sources.';
  }

  function calendarEventBlockTitle(event: CalendarEvent): string {
    const eventSummary = `${event.title} / ${eventTimeRange(event)}`;
    if (actionBusyKey) return `${eventSummary}. Another Productivity action is already running.`;
    if (!productivityReady) return `${eventSummary}. Open cached event details. Connect the API and Google to edit or save.`;
    if (productivityWriteDisabled) return `${eventSummary}. ${productivityActionTitle('Edit this event.')}`;
    return `${eventSummary}. Edit this event.`;
  }

  function productivityValidatedActionTitle(enabledTitle: string, validationReason: string): string {
    const blocked = productivityActionTitle(enabledTitle);
    return blocked === enabledTitle ? validationReason || enabledTitle : blocked;
  }

  function gmailReadTitle(enabledTitle: string): string {
    if (googleNeedsReconnect) return 'Reconnect Google to load live Gmail controls. Cached mail remains visible.';
    if (loading) return 'Productivity is still loading the latest connection state.';
    if (!productivityReady) return 'Connect the API and Google to load live Gmail controls. Cached mail remains visible.';
    if (gmailLoading) return 'Priority Gmail is already refreshing.';
    return enabledTitle;
  }

  function moveEventTitle(event: CalendarEvent): string {
    if (!moveTargetCalendarId) {
      return productivityValidatedActionTitle('Move event', 'Choose a move target calendar first.');
    }
    if (moveTargetCalendarId === event.calendarId) {
      return productivityValidatedActionTitle('Move event', 'Choose a different calendar before moving this event.');
    }
    return productivityActionTitle('Ask for confirmation before moving this event.');
  }

  function productivityActionTitleForState(state: Pick<ProductivityControlTitleState, 'loading' | 'apiChecking' | 'actionBusyKey' | 'googleNeedsReconnect' | 'productivityReady' | 'canAct' | 'googleConnected'>, enabledTitle: string): string {
    if (state.actionBusyKey) return 'Another Productivity action is already running.';
    if (state.googleNeedsReconnect) return 'Google saved tokens are expired or revoked. Use Reconnect Google to refresh OAuth before Gmail or Calendar actions.';
    if (!state.canAct) return 'Start or connect the local API before using Gmail or Calendar write actions.';
    if (!state.googleConnected) return 'Connect Google before using Gmail or Calendar write actions.';
    if (state.apiChecking) return 'Productivity is checking the local API before enabling this action.';
    if (state.loading) return 'Productivity is still loading the latest connection state.';
    if (!state.productivityReady) return 'Connect the API and Google before using this action.';
    return enabledTitle;
  }

  function productivityValidatedActionTitleForState(
    state: Pick<ProductivityControlTitleState, 'loading' | 'apiChecking' | 'actionBusyKey' | 'googleNeedsReconnect' | 'productivityReady' | 'canAct' | 'googleConnected'>,
    enabledTitle: string,
    validationReason: string
  ): string {
    const blocked = productivityActionTitleForState(state, enabledTitle);
    return blocked === enabledTitle ? validationReason || enabledTitle : blocked;
  }

  function selectedLabelActionTitle(state: ProductivityControlTitleState): string {
    return productivityValidatedActionTitleForState(state, 'Apply selected label', state.selectedGmailLabelId ? '' : 'Choose a Gmail label before applying it.');
  }

  function replyActionTitle(state: ProductivityControlTitleState, send: boolean): string {
    return productivityValidatedActionTitleForState(
      state,
      send ? 'Ask for confirmation before sending this Gmail reply.' : 'Save reply as a Gmail draft',
      state.replyBody.trim() ? '' : 'Write a reply before saving or sending it.'
    );
  }

  function eventSaveActionTitle(state: ProductivityControlTitleState): string {
    const action = state.editingEventId ? 'Update this Google Calendar event.' : 'Create this Google Calendar event.';
    if (!state.eventDraft.title.trim()) return productivityValidatedActionTitleForState(state, action, 'Add an event title before saving.');
    if (!state.eventDraft.start) return productivityValidatedActionTitleForState(state, action, 'Add an event start time before saving.');
    if (!state.eventDraft.end) return productivityValidatedActionTitleForState(state, action, 'Add an event end time before saving.');
    return productivityActionTitleForState(state, action);
  }

  function eventCalendarActionTitle(state: ProductivityControlTitleState): string {
    if (state.editingEventId) return 'Existing events keep their current calendar in this editor. Use the row Move action for a confirmed Google Calendar move.';
    return productivityActionTitleForState(state, 'Choose the Google Calendar for this new event.');
  }

  function composeActionTitle(state: ProductivityControlTitleState, send: boolean): string {
    const action = send ? 'Ask for confirmation before sending this Gmail message.' : 'Save this message as a Gmail draft.';
    if (!state.composeDraft.to.length) return productivityValidatedActionTitleForState(state, action, 'Add at least one recipient before saving or sending.');
    if (!state.composeDraft.subject.trim()) return productivityValidatedActionTitleForState(state, action, 'Add a subject before saving or sending.');
    if (!state.composeDraft.bodyText.trim()) return productivityValidatedActionTitleForState(state, action, 'Write a message body before saving or sending.');
    return productivityActionTitleForState(state, action);
  }

  function beginProductivityAction(key: string, requiresGoogle = true): boolean {
    if (actionBusyKey) {
      actionError = 'Another Productivity action is already running.';
      return false;
    }
    if (requiresGoogle && googleNeedsReconnect) {
      actionError = 'Google saved tokens are expired or revoked. Use Reconnect Google to refresh OAuth before using this action.';
      return false;
    }
    if (loading) {
      actionError = 'Productivity is still loading the latest connection state.';
      return false;
    }
    if (apiChecking) {
      actionError = 'Productivity is checking the local API before enabling this action.';
      return false;
    }
    if (requiresGoogle ? !productivityReady : !canAct) {
      actionError = requiresGoogle
        ? googleNeedsReconnect
          ? 'Google saved tokens are expired or revoked. Use Reconnect Google to refresh OAuth before using this action.'
          : 'Connect the API and Google before using this action.'
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

  function syncEventDraftCalendarMeta(): void {
    const calendar = calendars.find((item) => item.id === eventDraft.calendarId);
    eventDraft = { ...eventDraft, timeZone: calendar?.timeZone ?? eventDraft.timeZone ?? localTimeZone };
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

  async function connectGoogle(connection?: PublicConnection): Promise<void> {
    const key = `google:connect:${connection?.id ?? 'new'}`;
    if (!beginProductivityAction(key, false)) return;
    googleOAuthOpening = true;
    const popup =
      typeof window !== 'undefined'
        ? window.open('about:blank', 'mini-hub-google-oauth', 'width=560,height=720,menubar=no,toolbar=no,location=yes,status=no')
        : null;
    if (popup) {
      googleOAuthPopup = popup;
      try {
        popup.document.title = connection ? `Reconnect ${connection.accountLabel}` : 'Connect Google';
        popup.document.body.innerHTML =
          '<main style="font-family: system-ui, sans-serif; padding: 24px;"><strong>Opening Google sign-in.</strong><p>You can close this window if you change your mind.</p></main>';
      } catch {
        // The popup may become cross-origin quickly; setting the placeholder is only cosmetic.
      }
    }
    try {
      const returnTo = googleReturnTo();
      rememberGoogleReturnTo(returnTo);
      const url = await getGoogleOAuthUrl(returnTo, popup ? 'popup' : 'redirect', googleOAuthCallbackMode(), connection?.accountLabel);
      if (popup) {
        popup.location.href = url;
        actionMessage = connection ? `Complete Google sign-in for ${connection.accountLabel} in the popup.` : 'Complete Google sign-in in the popup.';
      } else {
        window.location.href = url;
      }
    } catch (error) {
      if (popup && !popup.closed) popup.close();
      if (googleOAuthPopup === popup) googleOAuthPopup = null;
      setError(error, 'Google OAuth is not configured');
    } finally {
      googleOAuthOpening = false;
      endProductivityAction(key);
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
    if (!beginProductivityAction(`google:disconnect:${connection?.id ?? 'default'}`, false)) return;
    const label = connection?.accountLabel ?? 'the stored Google OAuth grant';
    if (!confirm(`Revoke ${label} for this hub? Live Gmail and Calendar actions for that account will stop until you connect it again.`)) {
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
      const savedDraft = draftForApi();
      if (editingEventId) {
        await updateEvent({ ...savedDraft, eventId: editingEventId });
        actionMessage = 'Event updated.';
      } else {
        await createEvent(savedDraft);
        actionMessage = 'Event created.';
      }
      selectedCalendarId = savedDraft.calendarId;
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
    if (actionBusyKey) return;
    const cachedPreview = !productivityReady;
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
    if (cachedPreview) {
      actionError = '';
      actionMessage = 'Showing cached event details. Connect the API and Google to edit, move, delete, or save.';
    }
  }

  async function removeEvent(event: CalendarEvent): Promise<void> {
    const key = `event:delete:${event.id}`;
    if (!beginProductivityAction(key)) return;
    if (!confirm(`Delete "${event.title}" from ${calendarName(event.calendarId)}? This removes the live Google Calendar event.`)) {
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
    if (!confirm(`Move "${event.title}" from ${calendarName(event.calendarId)} to ${calendarName(moveTargetCalendarId)}? This updates the live Google Calendar event.`)) {
      actionMessage = 'Calendar move skipped.';
      endProductivityAction(key);
      return;
    }
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
      persistProductivityCache();
      return;
    }
    if (!beginProductivityAction(`gmail:open:${thread.id}`)) return;
    try {
      selectedGmailThread = await getGmailThread(thread.id);
      replyBody = '';
      persistProductivityCache();
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
    if (sendNow && !confirm(`Send email to ${composeDraft.to.join(', ')}? This sends through Gmail now.`)) {
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
    if (sendNow && !confirm(`Send reply to "${selectedGmailThread.subject}"? This sends through Gmail now.`)) {
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
    const hydrated = hydrateProductivityCache();
    consumeGoogleQueryStatus();
    void clientData.init();
    void loadOverview({ background: hydrated });
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
    <button class="button" type="button" disabled={productivityWriteDisabled} title={newEventButtonTitle} on:click={openNewEvent}>
      <CalendarPlus size={17} />
      <span>New Event</span>
    </button>
    <button class="button" type="button" disabled={productivityWriteDisabled} title={composeButtonTitle} on:click={openComposeDialog}>
      <Send size={17} />
      <span>Compose</span>
    </button>
    <button class="button" type="button" disabled={productivityRefreshDisabled} title={productivityRefreshButtonTitle} on:click={() => loadOverview()}>
      <RefreshCw size={17} />
      <span>{backgroundRefreshing ? 'Refreshing' : 'Refresh'}</span>
    </button>
    {#if googleConnected}
      <button class="button" type="button" disabled={googleConnectDisabled} title={googleConnectTitle} on:click={() => connectGoogle()}>
        <Link size={17} />
        <span>{googleHeaderButtonLabel}</span>
      </button>
      {#if googleConnections.length === 1}
        <button class="button" type="button" disabled={googleConnectionManageDisabled} title={googleConnectionManageDisabled ? googleConnectionManageTitle : `Ask for confirmation before revoking ${googleConnection?.accountLabel ?? 'this Google account'}.`} on:click={() => disconnectGoogle(googleConnection)}>
          <Unlink size={17} />
          <span>{isActionBusy(`google:disconnect:${googleConnection?.id ?? 'default'}`) ? 'Revoking' : 'Revoke'}</span>
        </button>
      {/if}
    {:else}
      <button class="button primary" type="button" disabled={googleConnectDisabled} title={googleConnectTitle} on:click={() => connectGoogle()}>
        <Link size={17} />
        <span>{googleHeaderButtonLabel}</span>
      </button>
    {/if}
  </div>
</section>

{#if !canAct}
  <section class="card card-pad offline-banner">
    <span>{productivityApiBannerText}</span>
    <a class="inline-action" href={hubHref('/settings#feature-wiring')} title="Open Settings Feature Wiring for Mini Hub API and Google OAuth setup.">Open Settings</a>
  </section>
{/if}
{#if cacheWarning}
  <section class="card card-pad offline-banner">
    <span>{cacheWarning}</span>
    <a class="inline-action" href={hubHref('/settings#feature-wiring')} title="Open Settings Feature Wiring for cached productivity and Google connection diagnostics.">Open Settings</a>
  </section>
{/if}
{#if actionError}
  <section class="card card-pad error-banner productivity-error-panel" title={`Raw Productivity error: ${actionError}`}>
    <div>
      <strong>Productivity action needs attention</strong>
      <p>{visibleActionError}</p>
    </div>
    {#if googleNeedsReconnect}
      <button class="button compact" type="button" disabled={googleConnectDisabled} title={googleConnectTitle} on:click={() => connectGoogle()}>
        <Link size={15} />
        <span>{googleHeaderButtonLabel}</span>
      </button>
    {:else}
      <a class="button compact" href={hubHref('/settings#feature-wiring')} title="Open Settings Feature Wiring to inspect Mini Hub API, Google OAuth, and endpoint wiring.">
        <span>Open Settings</span>
      </a>
    {/if}
  </section>
{:else if actionMessage}
  <section class="card card-pad success-banner">{actionMessage}</section>
{/if}

<section class="status-strip" aria-label="Productivity status">
  <div>
    <span>Write Mode</span>
    <strong>{productivityWriteStatus}</strong>
    <small>{productivityWriteDetail}</small>
  </div>
  <div>
    <span>Read Mode</span>
    <strong>{productivityReadStatus}</strong>
    <small>{productivityReadDetail}</small>
  </div>
  <div>
    <span>API</span>
    <strong>{canAct ? 'Reachable' : apiChecking ? 'Checking' : 'Offline'}</strong>
    <small>{productivityApiDetail}</small>
  </div>
  <div>
    <span>Google</span>
    <strong>{googleStatusDisplay}</strong>
    <small>{productivityConnectionDetail}</small>
  </div>
  <div>
    <span>Accounts</span>
    <strong>{googleConnections.length ? googleConnections.map((connection) => connection.accountLabel).join(', ') : 'No Google accounts connected'}</strong>
    <small>{googleConnected ? googleNeedsReconnect ? 'Reconnect saved accounts to refresh live Gmail and Calendar.' : 'Use Add Google Account for another inbox/calendar.' : 'OAuth setup is required for live data.'}</small>
  </div>
  <div>
    <span>Loaded</span>
    <strong>{calendars.length} calendars / {priorityThreads.length} threads</strong>
    <small>{timeline.length} unified timeline item{timeline.length === 1 ? '' : 's'} loaded.</small>
  </div>
  <div>
    <span>Local snapshot</span>
    <strong>{cacheStatus}</strong>
    <small>{productivityCacheDetail}</small>
  </div>
</section>

<section class="google-setup-panel" aria-label="Google account setup">
  <div>
    <strong>Google account setup</strong>
    <p>
      Use Reconnect Google when saved tokens expire. Use Add Google Account once for each account you want
      Mini Hub to control; the popup stores refreshed OAuth tokens in your local API and returns here automatically.
    </p>
  </div>
  <button class="button compact" type="button" disabled={googleConnectDisabled} title={googleConnectTitle} on:click={() => connectGoogle()}>
    <Link size={15} />
    <span>{googleSetupButtonLabel}</span>
  </button>
</section>

{#if googleConnected}
  <section class="account-panel" aria-label="Connected Google accounts">
    <div class="account-panel-title">
      <strong>{googleNeedsReconnect ? 'Saved Google Accounts' : 'Connected Google Accounts'}</strong>
      <button class="button compact" type="button" disabled={googleConnectDisabled} title={googleConnectTitle} on:click={() => connectGoogle()}>
        <Link size={15} />
        <span>{googleAccountPanelAddLabel}</span>
      </button>
    </div>
    <div class="account-list">
      {#each googleConnections as connection}
        <article>
          <span>
            <strong>{connection.accountLabel}</strong>
            <small>{googleAccountStatusLabel(connection)}{connection.lastSyncAt ? ` - ${displayTime(connection.lastSyncAt)}` : ''}</small>
          </span>
          <span class="account-actions">
            {#if googleNeedsReconnect}
              <button class="button compact" type="button" disabled={googleConnectDisabled} title={googleConnectDisabled ? googleConnectTitle : `Reconnect ${connection.accountLabel} through Google OAuth; the popup will suggest this account when Google allows it.`} on:click={() => connectGoogle(connection)}>
                <Link size={14} />
                <span>Reconnect</span>
              </button>
            {/if}
            <button class="icon-button" type="button" disabled={googleConnectionManageDisabled} title={googleConnectionManageDisabled ? googleConnectionManageTitle : `Ask for confirmation before revoking ${connection.accountLabel}.`} aria-label={`Revoke ${connection.accountLabel}`} on:click={() => disconnectGoogle(connection)}>
              <Unlink size={16} />
            </button>
          </span>
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
        <input id="event-search" bind:value={query} disabled={!productivityReadReady} title={productivityReadTitle('Filter visible calendar events.')} on:change={refreshEvents} />
      </div>
      <div class="field">
        <label for="calendar-source">Calendar</label>
        <select id="calendar-source" bind:value={selectedCalendarId} disabled={!productivityReadReady} title={productivityReadTitle('Choose which Google Calendar to browse.')} on:change={refreshEvents}>
          {#each calendars as calendar}
            <option value={calendar.id}>{calendar.summary}</option>
          {/each}
        </select>
      </div>
      <div class="field">
        <label for="move-target">Move target</label>
        <select id="move-target" bind:value={moveTargetCalendarId} disabled={productivityWriteDisabled} title={productivityActionTitle('Choose the target calendar for moving events.')}>
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
                title={calendarEventBlockTitle(event)}
                disabled={productivityEventInspectDisabled}
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
      <span>{calendarWindowSummary()}</span>
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
                <a class="icon-button" href={event.htmlLink} target="_blank" rel="noreferrer" aria-label="Open in Google Calendar" title="Open this event in Google Calendar.">
                  <ExternalLink size={16} />
                </a>
              {/if}
              <button class="icon-button" type="button" aria-label={`Open details for ${event.title}`} title={calendarEventBlockTitle(event)} disabled={productivityEventInspectDisabled} on:click={() => editEvent(event)}>
                <Save size={16} />
              </button>
              <button class="icon-button" type="button" aria-label={`Move ${event.title}`} title={moveEventTitle(event)} disabled={productivityWriteDisabled || !moveTargetCalendarId || moveTargetCalendarId === event.calendarId} on:click={() => moveSelectedEvent(event)}>
                <Send size={16} />
              </button>
              <button class="icon-button danger" type="button" aria-label={`Delete ${event.title}`} title={productivityActionTitle('Ask for confirmation before deleting this Google Calendar event.')} disabled={productivityWriteDisabled} on:click={() => removeEvent(event)}>
                <Trash2 size={16} />
              </button>
            </td>
          </tr>
        {:else}
          <tr><td colspan="4" class="muted">{calendarTableEmptyMessage()}</td></tr>
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
      <button class="button" type="button" disabled={!gmailReady || Boolean(actionBusyKey)} title={gmailRefreshButtonTitle} on:click={refreshGmail}>
        <RefreshCw size={17} />
        <span>{gmailLoading ? 'Sorting' : 'Refresh'}</span>
      </button>
    </div>
    <details class="mail-filter-panel">
      <summary>Mail search controls</summary>
      <div class="table-header gmail-header">
        <div class="field">
          <label for="gmail-search">Gmail search</label>
          <input id="gmail-search" bind:value={gmailQuery} disabled={!gmailReady} title={gmailReadTitle('Filter priority Gmail threads.')} on:change={refreshGmail} />
        </div>
        <div class="field">
          <label for="gmail-label">Label</label>
          <select id="gmail-label" bind:value={selectedGmailLabelId} disabled={!gmailReady} title={gmailReadTitle('Choose a Gmail label filter or target label.')} on:change={refreshGmail}>
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
              <button class="link-button" type="button" disabled={productivityThreadOpenDisabled} title={gmailThreadOpenButtonTitle} on:click={() => openGmailThread(thread)}>
                <strong>{thread.subject}</strong>
              </button>
              <p class="mail-summary">{summarizeEmailThread(thread)}</p>
            </td>
            <td>{accountLabelForResource(thread.id)}</td>
            <td>{thread.from}</td>
            <td>{thread.date}</td>
            <td class="row-actions quick-row-actions">
              <button class="icon-button" type="button" disabled={productivityThreadOpenDisabled} aria-label={`Open ${thread.subject}`} title={gmailThreadOpenButtonTitle} on:click={() => openGmailThread(thread)}>
                <Mail size={16} />
                <span>{isActionBusy(`gmail:open:${thread.id}`) ? 'Opening' : 'Open'}</span>
              </button>
              <button class="icon-button" type="button" disabled={productivityWriteDisabled} aria-label={thread.unread ? `Mark ${thread.subject} read` : `Mark ${thread.subject} unread`} title={gmailThreadReadActionTitle(productivityControlTitleState, thread)} on:click={() => toggleRead(thread)}>
                <MailOpen size={16} />
                <span>{isActionBusy(`gmail:read:${thread.id}`) ? 'Working' : thread.unread ? 'Read' : 'Unread'}</span>
              </button>
              <button
                class:active={isThreadImportant(thread)}
                class="icon-button"
                type="button"
                aria-label={isThreadImportant(thread) ? `Remove important from ${thread.subject}` : `Mark ${thread.subject} important`}
                disabled={productivityWriteDisabled}
                title={gmailThreadImportantActionTitle(productivityControlTitleState, thread)}
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
              <button class="icon-button" type="button" disabled={productivityWriteDisabled} aria-label={`Archive ${thread.subject}`} title={gmailThreadArchiveActionTitle(productivityControlTitleState, thread)} on:click={() => archiveThread(thread)}>
                <Archive size={16} />
                <span>{isActionBusy(`gmail:archive:${thread.id}`) ? 'Archiving' : 'Archive'}</span>
              </button>
            </td>
          </tr>
        {:else}
          <tr><td colspan="6" class="muted">{priorityInboxEmptyMessage()}</td></tr>
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
        <button class="button" type="button" disabled={productivityWriteDisabled} title={gmailThreadReadActionTitle(productivityControlTitleState, selectedGmailThread)} on:click={toggleSelectedRead}>
          <MailOpen size={17} />
          <span>{selectedGmailThread.unread ? 'Mark Read' : 'Mark Unread'}</span>
        </button>
        <button class="button" type="button" disabled={productivityWriteDisabled} title={gmailThreadImportantActionTitle(productivityControlTitleState, selectedGmailThread)} on:click={toggleSelectedImportant}>
          {#if isThreadImportant(selectedGmailThread)}
            <StarOff size={17} />
            <span>Unmark Important</span>
          {:else}
            <Star size={17} />
            <span>Mark Important</span>
          {/if}
        </button>
        <button class="button" type="button" disabled={productivityWriteDisabled} title={gmailThreadArchiveActionTitle(productivityControlTitleState, selectedGmailThread)} on:click={archiveSelectedThread}>
          <Archive size={17} />
          <span>Archive</span>
        </button>
        <button class="button" type="button" disabled={productivityWriteDisabled || !selectedGmailLabelId} title={selectedLabelButtonTitle} on:click={applySelectedLabel}>
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
        <textarea id="gmail-reply" bind:value={replyBody} disabled={productivityWriteDisabled} title={productivityActionTitle('Write a reply for the selected Gmail thread.')} rows="5"></textarea>
      </div>
      <div class="action-row">
        <button class="button" type="button" disabled={productivityWriteDisabled || !replyBody.trim()} title={replyDraftButtonTitle} on:click={() => sendReply(false)}>
          <Save size={17} />
          <span>{selectedGmailThread && isActionBusy(`gmail:reply:draft:${selectedGmailThread.id}`) ? 'Saving' : 'Draft Reply'}</span>
        </button>
        <button class="button primary" type="button" disabled={productivityWriteDisabled || !replyBody.trim()} title={replySendButtonTitle} on:click={() => sendReply(true)}>
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
        <tr><td colspan="4" class="muted">{timelineEmptyMessage()}</td></tr>
      {/each}
    </tbody>
  </table>
</section>

{#if eventDialogOpen}
  <div class="modal-layer">
    <button class="modal-backdrop" type="button" aria-label="Close event editor" title="Close the event editor without saving changes." on:click={closeEventDialog}></button>
    <div class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="event-dialog-title">
      <form class="modal-form" on:submit|preventDefault={saveEvent}>
      <div class="modal-title">
        <div class="form-title">
          <CalendarPlus size={18} />
          <strong id="event-dialog-title">{editingEventId ? 'Edit Event' : 'Create Event'}</strong>
        </div>
        <button class="icon-button" type="button" aria-label="Close event editor" title="Close the event editor without saving changes." on:click={closeEventDialog}>
          <X size={16} />
        </button>
      </div>
      <div class="modal-grid">
        <div class="field">
          <label for="calendar">Calendar</label>
          <select id="calendar" bind:value={eventDraft.calendarId} disabled={eventCalendarSelectDisabled} title={eventCalendarSelectTitle} on:change={syncEventDraftCalendarMeta}>
            <option value="primary">Primary</option>
            {#each calendars as calendar}
              <option value={calendar.id}>{calendar.summary}</option>
            {/each}
          </select>
        </div>
        <div class="field">
          <label for="event-title">Title</label>
          <input id="event-title" bind:value={eventDraft.title} disabled={productivityWriteDisabled} title={productivityActionTitle('Edit the event title.')} />
        </div>
        <div class="field">
          <label for="event-start">Start</label>
          <input id="event-start" bind:value={eventDraft.start} disabled={productivityWriteDisabled} title={productivityActionTitle('Edit the event start time.')} type="datetime-local" />
        </div>
        <div class="field">
          <label for="event-end">End</label>
          <input id="event-end" bind:value={eventDraft.end} disabled={productivityWriteDisabled} title={productivityActionTitle('Edit the event end time.')} type="datetime-local" />
        </div>
        <div class="field">
          <label for="event-zone">Time zone</label>
          <input id="event-zone" bind:value={eventDraft.timeZone} disabled={productivityWriteDisabled} title={productivityActionTitle('Edit the event time zone.')} />
        </div>
        <div class="field">
          <label for="event-location">Location</label>
          <input id="event-location" bind:value={eventDraft.location} disabled={productivityWriteDisabled} title={productivityActionTitle('Edit the event location.')} />
        </div>
        <div class="field">
          <label for="event-reminder">Reminder minutes</label>
          <input id="event-reminder" bind:value={eventDraft.reminders.overrides[0].minutes} disabled={productivityWriteDisabled} title={productivityActionTitle('Edit the event reminder minutes.')} type="number" min="0" step="5" />
        </div>
        <div class="field wide">
          <label for="event-description">Description</label>
          <textarea id="event-description" bind:value={eventDraft.description} disabled={productivityWriteDisabled} title={productivityActionTitle('Edit the event description.')} rows="3"></textarea>
        </div>
        <div class="field wide">
          <label for="event-recurrence">Recurrence rules</label>
          <textarea
            id="event-recurrence"
            disabled={productivityWriteDisabled}
            title={productivityActionTitle('Edit recurrence rules for this event.')}
            rows="2"
            placeholder="RRULE:FREQ=WEEKLY;COUNT=6"
            value={(eventDraft.recurrence ?? []).join('\n')}
            on:input={(event) => (eventDraft.recurrence = event.currentTarget.value.split('\n').map((line) => line.trim()).filter(Boolean))}
          ></textarea>
        </div>
      </div>
      <div class="action-row">
        <button class="button primary" type="submit" disabled={productivityWriteDisabled || !eventDraft.title.trim() || !eventDraft.start || !eventDraft.end} title={eventSaveButtonTitle}>
          <Save size={17} />
          <span>{isActionBusy(editingEventId ? `event:save:${editingEventId}` : 'event:create') ? 'Saving Event' : editingEventId ? 'Update Event' : 'Create Event'}</span>
        </button>
        <button class="button" type="button" title="Close the event editor without saving changes." on:click={closeEventDialog}>Cancel</button>
      </div>
      </form>
    </div>
  </div>
{/if}

{#if composeDialogOpen}
  <div class="modal-layer">
    <button class="modal-backdrop" type="button" aria-label="Close composer" title="Close the composer without saving changes." on:click={closeComposeDialog}></button>
    <div class="modal-panel modal-form" role="dialog" aria-modal="true" aria-labelledby="compose-dialog-title">
      <div class="modal-title">
        <div class="form-title">
          <Send size={18} />
          <strong id="compose-dialog-title">Compose</strong>
        </div>
        <button class="icon-button" type="button" aria-label="Close composer" title="Close the composer without saving changes." on:click={closeComposeDialog}>
          <X size={16} />
        </button>
      </div>
      <div class="modal-grid compose-grid">
        <div class="field">
          <label for="compose-to">To</label>
          <input id="compose-to" value={addressesValue(composeDraft.to)} disabled={productivityWriteDisabled} title={productivityActionTitle('Edit message recipients.')} on:input={(event) => (composeDraft.to = splitAddresses(inputValue(event)))} />
        </div>
        <div class="field">
          <label for="compose-cc">Cc</label>
          <input id="compose-cc" value={addressesValue(composeDraft.cc)} disabled={productivityWriteDisabled} title={productivityActionTitle('Edit carbon-copy recipients.')} on:input={(event) => (composeDraft.cc = splitAddresses(inputValue(event)))} />
        </div>
        <div class="field">
          <label for="compose-bcc">Bcc</label>
          <input id="compose-bcc" value={addressesValue(composeDraft.bcc)} disabled={productivityWriteDisabled} title={productivityActionTitle('Edit blind-copy recipients.')} on:input={(event) => (composeDraft.bcc = splitAddresses(inputValue(event)))} />
        </div>
        <div class="field wide">
          <label for="compose-subject">Subject</label>
          <input id="compose-subject" bind:value={composeDraft.subject} disabled={productivityWriteDisabled} title={productivityActionTitle('Edit the message subject.')} />
        </div>
        <div class="field wide">
          <label for="compose-body">Body</label>
          <textarea id="compose-body" bind:value={composeDraft.bodyText} disabled={productivityWriteDisabled} title={productivityActionTitle('Edit the message body.')} rows="7"></textarea>
        </div>
      </div>
      <div class="action-row">
        <button class="button" type="button" disabled={productivityWriteDisabled || !composeDraft.to.length || !composeDraft.subject.trim() || !composeDraft.bodyText.trim()} title={composeDraftButtonTitle} on:click={() => sendCompose(false)}>
          <Save size={17} />
          <span>{isActionBusy('gmail:compose:draft') ? 'Saving Draft' : 'Save Draft'}</span>
        </button>
        <button class="button primary" type="button" disabled={productivityWriteDisabled || !composeDraft.to.length || !composeDraft.subject.trim() || !composeDraft.bodyText.trim()} title={composeSendButtonTitle} on:click={() => sendCompose(true)}>
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
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    border-color: var(--error-border);
    color: var(--error-text);
    background: var(--error-bg);
  }

  .error-banner p {
    margin: 4px 0 0;
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

  .status-strip small {
    color: var(--muted);
    font-size: 11px;
    line-height: 1.3;
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

  .account-list .account-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 6px;
    min-width: fit-content;
  }

  .account-list .account-actions span {
    display: inline;
    min-width: auto;
  }

  .account-actions .button.compact {
    min-height: 32px;
    padding: 0.32rem 0.55rem;
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
