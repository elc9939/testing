<script lang="ts">
  import { onMount } from 'svelte';
  import { CheckCircle2, Download, Edit3, ExternalLink, Mail, Plus, RefreshCw, Save, Search, Trash2, X } from 'lucide-svelte';
  import type { CareerActionRecord, JobRecord } from '@mini-hub/core';
  import type { LegacyImportSummary } from '@mini-hub/db/migration';
  import { getBrowserStorage } from '$lib/browser-storage';
  import { canAutoSave, clientData } from '$lib/client-data';
  import { getConnections, listPriorityGmailThreads, type GmailThreadInsight, type PublicConnection } from '$lib/productivity-api';
  import { hubHref } from '$lib/routes';
  import { compactServiceIssueIfRecognized, compactServiceIssueLine } from '$lib/service-issues';

  const statuses = ['lead', 'saved', 'watching', 'applied', 'interview', 'offer', 'rejected', 'archived'];

  interface LegacyImportState {
    importedAt?: string;
    jobs?: number;
    studySessions?: number;
    careerActions?: number;
    studyDays?: number;
    studyCareerActions?: number;
    warnings?: string[];
  }

  interface JobDraft {
    company: string;
    role: string;
    status: string;
    applicationUrl: string;
    fitScore: string;
    notes: string;
    nextActionAt: string;
  }

  interface CareerViewState {
    searchQuery: string;
    statusFilter: string;
  }

  interface CareerDiscoveryProfile {
    enabled: boolean;
    autoMarkAppliedFromEvidence: boolean;
    researchIntensity: 'focused' | 'broad' | 'max';
    background: string;
    graduationStatus: string;
    targetStartWindow: string;
    targetRoles: string[];
    locations: string[];
    excludeCompanies: string[];
  }

  interface LegacyJobDetail {
    label: string;
    value: string;
  }

  interface CareerControlState {
    canSave: boolean;
    saving: boolean;
    rowBusyId: string;
    editingJobId: string;
    careerSummaryLoading: boolean;
    careerExportLoading: boolean;
    mailUpdatesLoading: boolean;
    careerProfileSaving: boolean;
  }

  const githubPagesCareerUrl = 'https://elc9939.github.io/testing/desk/career';
  const careerViewStorageKey = 'miniHub.career.view.v1';
  const careerEditRowEnabledTitle = 'Edit this saved job inline; save or cancel the row to keep changes.';
  const defaultCareerDiscoveryStartWindow = 'May 2027 / Summer 2027 start';

  let summary: LegacyImportSummary | null = null;
  let localDevOrigin = false;
  let company = '';
  let role = '';
  let status = 'lead';
  let applicationUrl = '';
  let fitScore = '';
  let notes = '';
  let nextActionAt = '';
  let searchQuery = '';
  let statusFilter = 'all';
  let saveError = '';
  let rowError = '';
  let saveMessage = '';
  let viewStatus = 'Loading saved Career view.';
  let viewHydrated = false;
  let saving = false;
  let careerSummaryLoading = false;
  let careerExportLoading = false;
  let rowBusyId = '';
  let editingJobId = '';
  let jobDraft: JobDraft = emptyJobDraft();
  let careerProfileHydrated = false;
  let careerProfileSaving = false;
  let careerDiscoveryEnabled = true;
  let careerAutoMarkAppliedFromEvidence = true;
  let careerDiscoveryResearchIntensity: CareerDiscoveryProfile['researchIntensity'] = 'max';
  let careerDiscoveryBackground = '';
  let careerDiscoveryGraduationStatus = '';
  let careerDiscoveryStartWindow = defaultCareerDiscoveryStartWindow;
  let careerDiscoveryRoles = '';
  let careerDiscoveryLocations = '';
  let careerDiscoveryExclusions = '';
  let connections: PublicConnection[] = [];
  let careerMailUpdates: GmailThreadInsight[] = [];
  let mailUpdatesLoading = false;
  let mailUpdatesError = '';

  $: canSave = canAutoSave($clientData);
  $: jobs = $clientData.jobs;
  $: careerActions = $clientData.careerActions;
  $: filteredJobs = jobs.filter(matchesJob).sort(compareCareerJobs);
  $: filteredCareerActions = careerActions.filter(matchesCareerAction);
  $: importedLegacy = (($clientData.settings?.recentState?.legacyImport ?? null) as LegacyImportState | null);
  $: applyQueue = jobs.filter((job) => ['lead', 'saved', 'watching'].includes(job.status));
  $: activeJobs = jobs.filter((job) => !['rejected', 'archived'].includes(job.status));
  $: openCareerActions = careerActions.filter((action) => !action.completedAt);
  $: dueCareerActions = openCareerActions.filter((action) => action.dueAt);
  $: googleConnected = connections.some((connection) => connection.provider === 'google' && connection.status === 'connected');
  $: submittedJobs = jobs.filter(isSubmittedApplication);
  $: matchedCareerMailUpdates = careerMailUpdates.filter((insight) => isKnownApplicationMail(insight, submittedJobs));
  $: unreadCareerMailUpdates = matchedCareerMailUpdates.filter((insight) => insight.thread.unread);
  $: visibleCareerMailUpdates = (unreadCareerMailUpdates.length ? unreadCareerMailUpdates : matchedCareerMailUpdates).slice(0, 5);
  $: discoveredCareerLeads = jobs.filter(isDiscoveredCareerLead).sort(compareCareerJobs);
  $: topDiscoveredCareerLeads = discoveredCareerLeads.slice(0, 5);
  $: suggestedDiscoveryRoles = suggestedCareerDiscoveryRoles(jobs);
  $: trackedCareerCompanies = trackedCareerCompanyNames(jobs);
  $: careerControlState = {
    canSave,
    saving,
    rowBusyId,
    editingJobId,
    careerSummaryLoading,
    careerExportLoading,
    mailUpdatesLoading,
    careerProfileSaving
  };
  $: addJobButtonTitle = addJobTitle(careerControlState, company, role);
  $: saveJobEditButtonTitle = saveJobEditTitle(careerControlState, jobDraft);
  $: careerSummaryButtonTitle = careerSummaryTitle(careerControlState);
  $: careerMailUpdatesButtonTitle = careerMailUpdatesTitle(careerControlState);
  $: careerExportButtonTitle = careerExportTitle(careerControlState);
  $: visibleMailUpdatesError = mailUpdatesError ? compactServiceIssueLine(mailUpdatesError, 'Career mail scan') : '';
  $: visibleSaveError = saveError ? compactCareerDeskIssue(saveError, 'Career Desk save') : '';
  $: visibleRowError = rowError ? compactCareerDeskIssue(rowError, 'Career Desk row') : '';
  $: visibleCareerDeskError = visibleSaveError || visibleRowError;
  $: rawCareerDeskError = saveError || rowError;
  $: if (viewHydrated) persistCareerViewState(searchQuery, statusFilter);
  $: if ($clientData.initialized && !careerProfileHydrated) hydrateCareerDiscoveryProfile($clientData.settings?.preferences?.careerDiscovery);

  function careerSaveTitle(state: Pick<CareerControlState, 'canSave' | 'saving'>, enabledTitle: string): string {
    if (!state.canSave) return 'Offline read-only: start or connect the Mini Hub API before saving Career changes.';
    if (state.saving) return 'A Career save is already running.';
    return enabledTitle;
  }

  function addJobTitle(state: Pick<CareerControlState, 'canSave' | 'saving'>, nextCompany: string, nextRole: string): string {
    if (!state.canSave || state.saving) return careerSaveTitle(state, 'Add this job.');
    if (!nextCompany.trim() || !nextRole.trim()) return 'Company and role are required before saving a job.';
    return 'Add this job to Career Desk.';
  }

  function careerRowTitle(state: Pick<CareerControlState, 'canSave' | 'rowBusyId' | 'editingJobId'>, enabledTitle: string, rowId?: string): string {
    if (!state.canSave) return 'Offline read-only: start or connect the Mini Hub API before changing Career rows.';
    if (state.rowBusyId === rowId) return 'This Career row action is already running.';
    if (state.rowBusyId) return 'Another Career row action is already running.';
    if (state.editingJobId && enabledTitle === careerEditRowEnabledTitle) return 'Finish or cancel the current edit before editing another job.';
    return enabledTitle;
  }

  function careerEditRowTitle(state: Pick<CareerControlState, 'canSave' | 'rowBusyId' | 'editingJobId'>, rowId: string): string {
    return careerRowTitle(state, careerEditRowEnabledTitle, rowId);
  }

  function careerCancelEditTitle(state: Pick<CareerControlState, 'rowBusyId'>, rowId: string): string {
    if (state.rowBusyId === rowId) return 'This Career row action is already running.';
    if (state.rowBusyId) return 'Another Career row action is already running.';
    return 'Cancel this inline job edit and discard unsaved row changes.';
  }

  function saveJobEditTitle(state: CareerControlState, draft: JobDraft): string {
    if (!state.canSave || state.rowBusyId) return careerRowTitle(state, 'Save job changes.', state.editingJobId);
    if (!draft.company.trim() || !draft.role.trim()) return 'Company and role are required before saving this job.';
    return 'Save job changes.';
  }

  function careerMailUpdatesTitle(state: Pick<CareerControlState, 'mailUpdatesLoading'>): string {
    return state.mailUpdatesLoading ? 'Career mail scan is already running.' : 'Scan connected Gmail for likely career updates.';
  }

  function careerMailPanelStatus(): string {
    if (mailUpdatesLoading && !connections.length && !careerMailUpdates.length) return 'Checking Google';
    if (mailUpdatesError) return 'Needs attention';
    if (googleConnected) return `${visibleCareerMailUpdates.length} shown / ${matchedCareerMailUpdates.length} matched`;
    return 'Google not connected';
  }

  function careerMailEmptyMessage(): string {
    if (mailUpdatesLoading && !connections.length && !careerMailUpdates.length) {
      return 'Checking Google connection and cached Career mail state.';
    }
    if (!googleConnected) {
      return 'Connect Google in Hub, then this page will surface updates that match jobs you marked as applied, interview, offer, or rejected.';
    }
    if (!submittedJobs.length) return 'Mark a job as applied, interview, offer, or rejected before this panel shows inbox updates.';
    if (mailUpdatesLoading && !visibleCareerMailUpdates.length) return 'Matching priority inbox threads to submitted applications...';
    return 'No recent priority mail matches your submitted applications.';
  }

  function careerJobsEmptyMessage(): string {
    if (jobs.length) return 'No jobs match the current filters.';
    if (!$clientData.initialized) return 'Opening cached Career jobs before live API sync.';
    if (!canSave) return 'No cached Career jobs found in this browser. Start or connect the Mini Hub API before saving new jobs.';
    return 'No saved Career jobs yet. Add a job manually or import legacy Career Desk data.';
  }

  function careerActionsEmptyMessage(): string {
    if (careerActions.length) return 'No career actions match the current filters.';
    if (!$clientData.initialized) return 'Opening cached career actions before live API sync.';
    if (!canSave) return 'No cached linked career actions found in this browser.';
    return 'No linked career actions have been imported or created yet.';
  }

  function careerSummaryTitle(state: Pick<CareerControlState, 'careerSummaryLoading'>): string {
    return state.careerSummaryLoading ? 'Legacy Career scan is already running.' : 'Scan this browser for legacy Career Desk data.';
  }

  function careerExportTitle(state: Pick<CareerControlState, 'careerExportLoading'>): string {
    return state.careerExportLoading ? 'Career export is already preparing.' : 'Download the current legacy Career snapshot from this browser.';
  }

  function compactCareerDeskIssue(message = '', label = 'Career Desk'): string {
    const text = message.trim();
    if (!text) return '';
    const compact = compactServiceIssueIfRecognized(text, label);
    return compact === text && text.length > 140 ? `${text.slice(0, 137)}...` : compact;
  }

  function emptyJobDraft(): JobDraft {
    return { company: '', role: '', status: 'lead', applicationUrl: '', fitScore: '', notes: '', nextActionAt: '' };
  }

  function normalizeCareerViewState(value: unknown, fallback: CareerViewState): CareerViewState {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
    const record = value as Partial<CareerViewState>;
    const nextStatus = typeof record.statusFilter === 'string' ? record.statusFilter : fallback.statusFilter;
    return {
      searchQuery: typeof record.searchQuery === 'string' ? record.searchQuery : fallback.searchQuery,
      statusFilter: nextStatus === 'all' || statuses.includes(nextStatus) ? nextStatus : fallback.statusFilter
    };
  }

  function currentCareerViewState(): CareerViewState {
    return { searchQuery, statusFilter };
  }

  function hydrateCareerViewState(): void {
    const storage = getBrowserStorage();
    if (!storage) {
      viewHydrated = true;
      viewStatus = 'Browser storage is unavailable; filters reset on reload.';
      return;
    }
    try {
      const raw = storage.getItem(careerViewStorageKey);
      if (raw) {
        const next = normalizeCareerViewState(JSON.parse(raw) as unknown, currentCareerViewState());
        searchQuery = next.searchQuery;
        statusFilter = next.statusFilter;
        viewStatus = 'Reloaded Career filters from this browser.';
      } else {
        viewStatus = 'Career filters are saved in this browser.';
      }
    } catch {
      viewStatus = 'Stored Career filters were unreadable; defaults are loaded.';
    } finally {
      viewHydrated = true;
    }
  }

  function persistCareerViewState(nextSearchQuery = searchQuery, nextStatusFilter = statusFilter): void {
    const storage = getBrowserStorage();
    if (!storage) return;
    try {
      storage.setItem(careerViewStorageKey, JSON.stringify({ searchQuery: nextSearchQuery, statusFilter: nextStatusFilter }));
    } catch {
      viewStatus = 'Browser storage is full or blocked; Career filters may not persist.';
    }
  }

  function splitListField(value: string): string[] {
    return Array.from(
      new Set(
        value
          .split(/[\n,;]+/u)
          .map((item) => item.trim().replace(/\s+/gu, ' '))
          .filter(Boolean)
      )
    );
  }

  function normalizeCareerDiscoveryProfile(value: unknown): CareerDiscoveryProfile {
    const record = value && typeof value === 'object' && !Array.isArray(value) ? (value as Partial<CareerDiscoveryProfile>) : {};
    return {
      enabled: record.enabled !== false,
      autoMarkAppliedFromEvidence: record.autoMarkAppliedFromEvidence !== false,
      researchIntensity:
        record.researchIntensity === 'focused' || record.researchIntensity === 'broad' || record.researchIntensity === 'max'
          ? record.researchIntensity
          : 'max',
      background: typeof record.background === 'string' ? record.background : '',
      graduationStatus: typeof record.graduationStatus === 'string' ? record.graduationStatus : '',
      targetStartWindow: typeof record.targetStartWindow === 'string' && record.targetStartWindow.trim() ? record.targetStartWindow : defaultCareerDiscoveryStartWindow,
      targetRoles: Array.isArray(record.targetRoles) ? record.targetRoles.map(String).filter(Boolean) : [],
      locations: Array.isArray(record.locations) ? record.locations.map(String).filter(Boolean) : [],
      excludeCompanies: Array.isArray(record.excludeCompanies) ? record.excludeCompanies.map(String).filter(Boolean) : []
    };
  }

  function hydrateCareerDiscoveryProfile(value: unknown): void {
    const profile = normalizeCareerDiscoveryProfile(value);
    careerDiscoveryEnabled = profile.enabled;
    careerAutoMarkAppliedFromEvidence = profile.autoMarkAppliedFromEvidence;
    careerDiscoveryResearchIntensity = profile.researchIntensity;
    careerDiscoveryBackground = profile.background;
    careerDiscoveryGraduationStatus = profile.graduationStatus;
    careerDiscoveryStartWindow = profile.targetStartWindow;
    careerDiscoveryRoles = profile.targetRoles.join('\n');
    careerDiscoveryLocations = profile.locations.join('\n');
    careerDiscoveryExclusions = profile.excludeCompanies.join('\n');
    careerProfileHydrated = true;
  }

  function currentCareerDiscoveryProfile(): CareerDiscoveryProfile {
    return {
      enabled: careerDiscoveryEnabled,
      autoMarkAppliedFromEvidence: careerAutoMarkAppliedFromEvidence,
      researchIntensity: careerDiscoveryResearchIntensity,
      background: careerDiscoveryBackground.trim(),
      graduationStatus: careerDiscoveryGraduationStatus.trim(),
      targetStartWindow: careerDiscoveryStartWindow.trim() || defaultCareerDiscoveryStartWindow,
      targetRoles: splitListField(careerDiscoveryRoles),
      locations: splitListField(careerDiscoveryLocations),
      excludeCompanies: splitListField(careerDiscoveryExclusions)
    };
  }

  function suggestedCareerDiscoveryRoles(records: JobRecord[]): string[] {
    return Array.from(
      new Set(
        records
          .filter((job) => !['rejected', 'archived'].includes(job.status))
          .sort((a, b) => (b.fitScore ?? -1) - (a.fitScore ?? -1))
          .map((job) => job.role.trim())
          .filter((item) => item.length >= 4)
      )
    ).slice(0, 5);
  }

  function trackedCareerCompanyNames(records: JobRecord[]): string[] {
    return Array.from(new Set(records.map((job) => job.company.trim()).filter(Boolean))).slice(0, 12);
  }

  function careerDiscoveryProfileTitle(state: Pick<CareerControlState, 'canSave' | 'careerProfileSaving'>): string {
    if (!state.canSave) return 'Offline read-only: start or connect the Mini Hub API before saving Career Discovery settings.';
    if (state.careerProfileSaving) return 'Career Discovery profile is already saving.';
    return 'Save Career Discovery filters for passive role research and dedupe.';
  }

  function dateInputValue(value?: string): string {
    return value ? value.slice(0, 10) : '';
  }

  function displayDate(value?: string): string {
    if (!value) return 'No date saved';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString();
  }

  function displayFitScore(job: JobRecord): string {
    return typeof job.fitScore === 'number' ? `${job.fitScore}` : 'Unranked';
  }

  function fitInputValue(value?: number): string {
    return typeof value === 'number' ? String(value) : '';
  }

  function normalizedFitScore(value: string): number | null {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const score = Number(trimmed);
    if (!Number.isFinite(score)) return null;
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  function displayUpdated(value: string): string {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
  }

  function matchesJob(job: JobRecord): boolean {
    const query = searchQuery.trim().toLowerCase();
    const statusMatch = statusFilter === 'all' || job.status === statusFilter;
    const queryMatch =
      !query ||
      job.company.toLowerCase().includes(query) ||
      job.role.toLowerCase().includes(query) ||
      job.applicationUrl.toLowerCase().includes(query) ||
      displayFitScore(job).toLowerCase().includes(query) ||
      job.notes.toLowerCase().includes(query);
    return statusMatch && queryMatch;
  }

  function compareCareerJobs(left: JobRecord, right: JobRecord): number {
    const leftFit = typeof left.fitScore === 'number' ? left.fitScore : -1;
    const rightFit = typeof right.fitScore === 'number' ? right.fitScore : -1;
    if (leftFit !== rightFit) return rightFit - leftFit;
    return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
  }

  function matchesCareerAction(action: CareerActionRecord): boolean {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return true;
    const linkedJob = jobs.find((job) => job.id === action.jobId);
    return (
      action.label.toLowerCase().includes(query) ||
      linkedJob?.company.toLowerCase().includes(query) ||
      linkedJob?.role.toLowerCase().includes(query) ||
      false
    );
  }

  function linkedJobLabel(action: CareerActionRecord): string {
    const linkedJob = jobs.find((job) => job.id === action.jobId);
    return linkedJob ? `${linkedJob.role} at ${linkedJob.company}` : 'Unlinked';
  }

  function linkedJob(action: CareerActionRecord): JobRecord | undefined {
    return jobs.find((job) => job.id === action.jobId);
  }

  function legacyDetailBlock(notes: string): string {
    const marker = 'Legacy Career Desk details:';
    const start = notes.indexOf(marker);
    if (start === -1) return '';
    const afterMarker = notes.slice(start + marker.length);
    const [block] = afterMarker.split('\n\n');
    return block ?? '';
  }

  function legacyJobDetails(job: JobRecord): LegacyJobDetail[] {
    return legacyDetailBlock(job.notes)
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('- '))
      .map((line) => {
        const body = line.slice(2);
        const separator = body.indexOf(':');
        if (separator === -1) return null;
        const label = body.slice(0, separator).trim();
        const value = body.slice(separator + 1).trim();
        return label && value ? { label, value } : null;
      })
      .filter((detail): detail is LegacyJobDetail => Boolean(detail));
  }

  function primaryLegacyJobDetails(job: JobRecord): LegacyJobDetail[] {
    const priority = [
      'Legacy stage',
      'Priority',
      'Location',
      'Work mode',
      'Job type',
      'Date applied',
      'Deadline',
      'Next action',
      'Contact name',
      'Contact info',
      'Resume version',
      'Cover letter',
      'Source',
      'Link',
      'Tags'
    ];
    const details = legacyJobDetails(job);
    const byLabel = new Map(details.map((detail) => [detail.label, detail]));
    return priority
      .map((label) => byLabel.get(label))
      .filter((detail): detail is LegacyJobDetail => Boolean(detail))
      .slice(0, 8);
  }

  function visibleJobNotes(job: JobRecord): string {
    const sections = job.notes
      .split('\n\n')
      .filter(
        (section) =>
          !section.startsWith('Legacy Career Desk details:') &&
          !section.startsWith('Legacy description:') &&
          !section.startsWith('Legacy history:')
      )
      .join('\n\n')
      .trim();
    return sections;
  }

  function safeExternalUrl(value: string | undefined): string {
    const trimmed = (value ?? '').trim();
    if (!trimmed) return '';
    if (/^https?:\/\//iu.test(trimmed)) return trimmed;
    if (/^www\./iu.test(trimmed)) return `https://${trimmed}`;
    return '';
  }

  function legacyJobLink(job: JobRecord): string {
    return legacyJobDetails(job).find((detail) => detail.label === 'Link')?.value ?? '';
  }

  function jobApplicationHref(job: JobRecord): string {
    return safeExternalUrl(job.applicationUrl) || safeExternalUrl(legacyJobLink(job));
  }

  function normalizedApplicationUrl(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) return '';
    if (/^https?:\/\//iu.test(trimmed)) return trimmed;
    if (/^www\./iu.test(trimmed)) return `https://${trimmed}`;
    return trimmed;
  }

  function isSubmittedApplication(job: JobRecord): boolean {
    return ['applied', 'interview', 'offer', 'rejected'].includes(job.status);
  }

  function isDiscoveredCareerLead(job: JobRecord): boolean {
    return job.status === 'lead' && /Discovered by Career Discovery/u.test(job.notes);
  }

  function discoveredLeadMeta(job: JobRecord): string {
    return [`Fit ${displayFitScore(job)}`, job.nextActionAt ? `Review ${displayDate(job.nextActionAt)}` : 'No review date']
      .filter(Boolean)
      .join(' - ');
  }

  function canReviewDiscoveredLead(job: JobRecord): boolean {
    return canSave && isDiscoveredCareerLead(job) && !editingJobId && !rowBusyId;
  }

  function discoveredLeadReviewTitle(state: CareerControlState, job: JobRecord, action: 'save' | 'watch' | 'archive'): string {
    if (!state.canSave) return 'Offline read-only: start or connect the Mini Hub API before reviewing discovered leads.';
    if (state.rowBusyId === job.id) return 'This discovered lead review is already saving.';
    if (state.rowBusyId) return 'Another Career row action is already running.';
    if (state.editingJobId) return 'Finish or cancel the current edit before reviewing discovered leads.';
    if (!isDiscoveredCareerLead(job)) return 'This discovered lead has already been reviewed.';
    if (action === 'save') return 'Keep this discovered lead as saved for near-term review.';
    if (action === 'watch') return 'Move this discovered lead to watching for a later check-in.';
    return 'Archive this discovered lead as not fit while preserving the source notes.';
  }

  function appendDiscoveryReviewNote(existingNotes: string, label: string): string {
    const date = localDateInput();
    return [existingNotes.trim(), `Career Discovery review: ${label} on ${date}.`].filter(Boolean).join('\n\n');
  }

  function canMarkJobApplied(job: JobRecord): boolean {
    return canSave && !editingJobId && !rowBusyId && !['applied', 'interview', 'offer', 'rejected', 'archived'].includes(job.status);
  }

  function markAppliedTitle(state: CareerControlState, job: JobRecord): string {
    if (!state.canSave) return 'Offline read-only: start or connect the Mini Hub API before marking applications applied.';
    if (state.rowBusyId === job.id) return 'Saving applied status and follow-up action.';
    if (state.rowBusyId) return 'Another Career row action is already running.';
    if (state.editingJobId) return 'Finish or cancel the current edit before marking a job applied.';
    if (job.status === 'applied') return 'This job is already marked applied.';
    if (['interview', 'offer'].includes(job.status)) return 'This job is already beyond applied status.';
    if (['rejected', 'archived'].includes(job.status)) return 'Closed jobs are not marked applied from the quick action.';
    return 'Mark this job as applied and create a 14-day follow-up action.';
  }

  function localDateInput(daysFromToday = 0): string {
    const date = new Date();
    date.setDate(date.getDate() + daysFromToday);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function applicationFollowUpLabel(job: Pick<JobRecord, 'company' | 'role'>): string {
    return `Follow up on application: ${job.role} at ${job.company}`;
  }

  function existingOpenApplicationFollowUp(job: JobRecord): CareerActionRecord | undefined {
    return careerActions.find(
      (action) => action.jobId === job.id && !action.completedAt && action.label.toLowerCase().startsWith('follow up on application:')
    );
  }

  function appendAppliedNote(existingNotes: string, appliedDate: string): string {
    if (/Applied via Career Desk on \d{4}-\d{2}-\d{2}\./u.test(existingNotes)) return existingNotes;
    return [existingNotes.trim(), `Applied via Career Desk on ${appliedDate}.`].filter(Boolean).join('\n\n');
  }

  function words(value: string): string[] {
    const stop = new Set(['and', 'the', 'inc', 'llc', 'ltd', 'corp', 'company', 'careers', 'jobs', 'job', 'role']);
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, ' ')
      .split(' ')
      .map((word) => word.trim())
      .filter((word) => word.length >= 3 && !stop.has(word));
  }

  function hostnameWords(value: string): string[] {
    const href = safeExternalUrl(value);
    if (!href) return [];
    try {
      return words(new URL(href).hostname.replace(/^www\./iu, '').replace(/\.[a-z]{2,}$/iu, ''));
    } catch {
      return [];
    }
  }

  function threadText(insight: GmailThreadInsight): string {
    return [insight.thread.subject, insight.thread.from, insight.thread.snippet, insight.reason, insight.deadlineHint ?? ''].join(' ').toLowerCase();
  }

  function matchesKnownApplication(insight: GmailThreadInsight, job: JobRecord): boolean {
    const text = threadText(insight);
    const companyText = job.company.toLowerCase().trim();
    const roleText = job.role.toLowerCase().trim();
    const companyTokens = [...new Set([...words(job.company), ...hostnameWords(job.applicationUrl), ...hostnameWords(legacyJobLink(job))])];
    const roleTokens = words(job.role);
    if (companyText.length >= 3 && text.includes(companyText)) return true;
    if (roleText.length >= 8 && text.includes(roleText)) return true;
    if (companyTokens.some((token) => text.includes(token))) return true;
    return roleTokens.filter((token) => text.includes(token)).length >= 2;
  }

  function isKnownApplicationMail(insight: GmailThreadInsight, appliedJobs: JobRecord[]): boolean {
    if (!isCareerMailSignal(insight)) return false;
    return appliedJobs.some((job) => matchesKnownApplication(insight, job));
  }

  function matchedApplicationLabel(insight: GmailThreadInsight): string {
    const job = submittedJobs.find((item) => matchesKnownApplication(insight, item));
    return job ? `${job.company} - ${job.role}` : 'Matched application';
  }

  function oneLine(value: string): string {
    return value.replace(/\s+/gu, ' ').trim();
  }

  function notesSummary(job: JobRecord): string {
    const visible = oneLine(visibleJobNotes(job));
    if (visible) return visible;
    const details = primaryLegacyJobDetails(job)
      .slice(0, 3)
      .map((detail) => `${detail.label}: ${detail.value}`)
      .join(' · ');
    if (details) return details;
    const historyCount = legacyHistoryCount(job);
    if (historyCount) return `${historyCount} legacy history event${historyCount === 1 ? '' : 's'} preserved`;
    return 'No notes saved';
  }

  function legacyHistoryCount(job: JobRecord): number {
    const marker = 'Legacy history:';
    const start = job.notes.indexOf(marker);
    if (start === -1) return 0;
    const [block] = job.notes.slice(start + marker.length).split('\n\n');
    return (block ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('- '))
      .length;
  }

  function isCareerMailSignal(insight: GmailThreadInsight): boolean {
    if (insight.category === 'career') return true;
    const text = [insight.thread.subject, insight.thread.from, insight.thread.snippet].join(' ').toLowerCase();
    return /\b(interview|application|recruiter|hiring|offer|resume|career|job)\b/u.test(text);
  }

  function threadDate(value: string): string {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString();
  }

  async function refreshCareerMailUpdates(): Promise<void> {
    mailUpdatesLoading = true;
    mailUpdatesError = '';
    try {
      const nextConnections = await getConnections();
      connections = nextConnections;
      const hasGoogle = nextConnections.some((connection) => connection.provider === 'google' && connection.status === 'connected');
      if (!hasGoogle) {
        careerMailUpdates = [];
        return;
      }
      const insights = await listPriorityGmailThreads({ maxResults: 20 });
      careerMailUpdates = insights.filter(isCareerMailSignal).slice(0, 8);
    } catch (error) {
      mailUpdatesError = error instanceof Error ? error.message : 'Career mail scan failed';
    } finally {
      mailUpdatesLoading = false;
    }
  }

  async function refreshSummary(): Promise<void> {
    if (careerSummaryLoading) return;
    careerSummaryLoading = true;
    saveError = '';
    saveMessage = '';
    try {
      const storage = getBrowserStorage();
      if (!storage) {
        throw new Error('Browser storage is unavailable; legacy Career scan cannot run.');
      }
      const { inspectLegacyStorage } = await import('@mini-hub/db/migration');
      summary = inspectLegacyStorage(storage);
    } catch (error) {
      saveError = error instanceof Error ? error.message : 'Legacy Career scan failed';
    } finally {
      careerSummaryLoading = false;
    }
  }

  async function addJob(): Promise<void> {
    if (!canSave || saving || !company.trim() || !role.trim()) return;
    saveError = '';
    rowError = '';
    saveMessage = '';
    saving = true;
    const savedCompany = company.trim();
    const savedRole = role.trim();
    try {
      await clientData.saveJob({
        company: savedCompany,
        role: savedRole,
        status,
        applicationUrl: normalizedApplicationUrl(applicationUrl),
        fitScore: normalizedFitScore(fitScore),
        notes: notes.trim(),
        nextActionAt: nextActionAt || null
      });
      company = '';
      role = '';
      status = 'lead';
      applicationUrl = '';
      fitScore = '';
      notes = '';
      nextActionAt = '';
      saveMessage = `Saved ${savedRole} at ${savedCompany}.`;
    } catch (error) {
      saveError = error instanceof Error ? error.message : 'Save failed';
    } finally {
      saving = false;
    }
  }

  function startEditJob(job: JobRecord): void {
    if (!canSave || editingJobId || rowBusyId) return;
    editingJobId = job.id;
    rowError = '';
    saveMessage = '';
    jobDraft = {
      company: job.company,
      role: job.role,
      status: job.status,
      applicationUrl: job.applicationUrl || legacyJobLink(job),
      fitScore: fitInputValue(job.fitScore),
      notes: job.notes,
      nextActionAt: dateInputValue(job.nextActionAt)
    };
  }

  function cancelEditJob(): void {
    editingJobId = '';
    rowBusyId = '';
    rowError = '';
    jobDraft = emptyJobDraft();
  }

  async function saveJobEdit(job: JobRecord): Promise<void> {
    if (!canSave || !jobDraft.company.trim() || !jobDraft.role.trim()) return;
    rowError = '';
    saveError = '';
    saveMessage = '';
    rowBusyId = job.id;
    const savedCompany = jobDraft.company.trim();
    const savedRole = jobDraft.role.trim();
    try {
      await clientData.updateJob(job.id, {
        company: savedCompany,
        role: savedRole,
        status: jobDraft.status,
        applicationUrl: normalizedApplicationUrl(jobDraft.applicationUrl),
        fitScore: normalizedFitScore(jobDraft.fitScore),
        notes: jobDraft.notes.trim(),
        nextActionAt: jobDraft.nextActionAt || null
      });
      cancelEditJob();
      saveMessage = `Updated ${savedRole} at ${savedCompany}.`;
    } catch (error) {
      rowError = error instanceof Error ? error.message : 'Save failed';
    } finally {
      rowBusyId = '';
    }
  }

  async function markJobApplied(job: JobRecord): Promise<void> {
    if (!canMarkJobApplied(job)) return;
    rowError = '';
    saveError = '';
    saveMessage = '';
    rowBusyId = job.id;
    const appliedDate = localDateInput();
    const followUpDate = localDateInput(14);
    const nextLabel = applicationFollowUpLabel(job);
    try {
      await clientData.updateJob(job.id, {
        status: 'applied',
        nextActionAt: followUpDate,
        notes: appendAppliedNote(job.notes, appliedDate)
      });
      const existingFollowUp = existingOpenApplicationFollowUp(job);
      if (existingFollowUp) {
        await clientData.updateCareerAction(existingFollowUp.id, {
          label: nextLabel,
          dueAt: existingFollowUp.dueAt ?? followUpDate
        });
      } else {
        await clientData.saveCareerAction({
          jobId: job.id,
          label: nextLabel,
          dueAt: followUpDate
        });
      }
      saveMessage = `Marked ${job.role} at ${job.company} as applied; follow-up set for ${displayDate(followUpDate)}.`;
    } catch (error) {
      rowError = error instanceof Error ? error.message : 'Mark applied failed';
    } finally {
      rowBusyId = '';
    }
  }

  async function reviewDiscoveredLead(job: JobRecord, decision: 'save' | 'watch' | 'archive'): Promise<void> {
    if (!canReviewDiscoveredLead(job)) return;
    rowError = '';
    saveError = '';
    saveMessage = '';
    rowBusyId = job.id;
    const statusByDecision = {
      save: 'saved',
      watch: 'watching',
      archive: 'archived'
    } as const;
    const noteByDecision = {
      save: 'saved for review',
      watch: 'moved to watching',
      archive: 'archived as not fit'
    } as const;
    const nextActionByDecision = {
      save: localDateInput(7),
      watch: localDateInput(21),
      archive: null
    } as const;
    try {
      await clientData.updateJob(job.id, {
        status: statusByDecision[decision],
        nextActionAt: nextActionByDecision[decision],
        notes: appendDiscoveryReviewNote(job.notes, noteByDecision[decision])
      });
      saveMessage =
        decision === 'archive'
          ? `Archived discovered lead ${job.role} at ${job.company} as not fit.`
          : `Moved discovered lead ${job.role} at ${job.company} to ${statusByDecision[decision]}.`;
    } catch (error) {
      rowError = error instanceof Error ? error.message : 'Discovered lead review failed';
    } finally {
      rowBusyId = '';
    }
  }

  async function saveCareerDiscoveryProfile(): Promise<void> {
    if (!canSave || careerProfileSaving) return;
    rowError = '';
    saveError = '';
    saveMessage = '';
    careerProfileSaving = true;
    try {
      await clientData.saveSettings({
        preferences: {
          ...($clientData.settings?.preferences ?? {}),
          careerDiscovery: currentCareerDiscoveryProfile()
        }
      });
      saveMessage = 'Saved Career Discovery filters for passive role research.';
    } catch (error) {
      saveError = error instanceof Error ? error.message : 'Career Discovery profile save failed';
    } finally {
      careerProfileSaving = false;
    }
  }

  async function deleteJob(job: JobRecord): Promise<void> {
    if (!canSave || rowBusyId) return;
    if (!window.confirm(`Delete "${job.role}" at ${job.company}? This removes the saved Career Desk record from this workspace.`)) {
      saveMessage = 'Career delete skipped.';
      rowError = '';
      saveError = '';
      return;
    }
    rowError = '';
    saveError = '';
    saveMessage = '';
    rowBusyId = job.id;
    try {
      await clientData.deleteJob(job.id);
      if (editingJobId === job.id) cancelEditJob();
      saveMessage = `Deleted ${job.role} at ${job.company}.`;
    } catch (error) {
      rowError = error instanceof Error ? error.message : 'Delete failed';
    } finally {
      rowBusyId = '';
    }
  }

  async function exportSnapshot(): Promise<void> {
    if (careerExportLoading) return;
    careerExportLoading = true;
    saveError = '';
    saveMessage = '';
    try {
      const storage = getBrowserStorage();
      if (!storage) {
        throw new Error('Browser storage is unavailable; legacy Career export cannot run.');
      }
      const { exportLegacySnapshot } = await import('@mini-hub/db/migration');
      const blob = new Blob([JSON.stringify(exportLegacySnapshot(storage), null, 2)], {
        type: 'application/json'
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'mini-hub-legacy-career-snapshot.json';
      link.click();
      URL.revokeObjectURL(url);
      saveMessage = 'Exported legacy Career snapshot from this browser.';
    } catch (error) {
      saveError = error instanceof Error ? error.message : 'Legacy Career export failed';
    } finally {
      careerExportLoading = false;
    }
  }

  onMount(() => {
    localDevOrigin = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
    hydrateCareerViewState();
    void clientData.init();
    void refreshSummary();
    void refreshCareerMailUpdates();
  });
</script>

<svelte:head>
  <title>Career Desk - Mini Hub</title>
</svelte:head>

<section class="page-header">
  <div>
    <p class="eyebrow">Desk</p>
    <h1>Career</h1>
  </div>
  <div class="action-row">
    <button class="button" type="button" disabled={careerSummaryLoading} title={careerSummaryButtonTitle} on:click={refreshSummary}>
      <RefreshCw size={17} />
      <span>{careerSummaryLoading ? 'Scanning' : 'Scan'}</span>
    </button>
    <button class="button" type="button" disabled={mailUpdatesLoading} title={careerMailUpdatesButtonTitle} on:click={refreshCareerMailUpdates}>
      <Mail size={17} />
      <span>{mailUpdatesLoading ? 'Sorting' : 'Mail Updates'}</span>
    </button>
    <button class="button" type="button" disabled={careerExportLoading} title={careerExportButtonTitle} on:click={exportSnapshot}>
      <Download size={17} />
      <span>{careerExportLoading ? 'Exporting' : 'Export'}</span>
    </button>
  </div>
</section>

{#if !canSave}
  <section class="card card-pad offline-banner">Offline: cached jobs are readable, saving is disabled.</section>
{/if}
{#if rawCareerDeskError}
  <section class="card card-pad error-banner" title={`Raw Career Desk error: ${rawCareerDeskError}`}>{visibleCareerDeskError}</section>
{/if}
{#if saveMessage}
  <section class="card card-pad success-banner">{saveMessage}</section>
{/if}

<section class="focus-strip" aria-label="Career focus">
  <div><span>Apply queue</span><strong>{applyQueue.length}</strong></div>
  <div><span>Active jobs</span><strong>{activeJobs.length}</strong></div>
  <div><span>Discovered leads</span><strong>{discoveredCareerLeads.length}</strong></div>
  <div><span>Open updates</span><strong>{openCareerActions.length + unreadCareerMailUpdates.length}</strong></div>
  <div><span>Dated follow-ups</span><strong>{dueCareerActions.length}</strong></div>
</section>

{#if discoveredCareerLeads.length}
  <section class="card discovered-leads-panel" aria-label="Discovered Career leads">
    <div class="table-section-title">
      <strong>Discovered Leads</strong>
      <span>{discoveredCareerLeads.length} ranked by fit</span>
    </div>
    <div class="discovered-lead-list">
      {#each topDiscoveredCareerLeads as job}
        <div class="discovered-lead-row">
          <a class="discovered-lead-main" href={jobApplicationHref(job) || '#job-search'} target={jobApplicationHref(job) ? '_blank' : undefined} rel={jobApplicationHref(job) ? 'noreferrer' : undefined} title={`Review discovered lead: ${job.role} at ${job.company}.`}>
            <span>{displayFitScore(job)}</span>
            <strong>{job.company}</strong>
            <small>{job.role}</small>
            <small>{discoveredLeadMeta(job)}</small>
          </a>
          <div class="discovered-lead-actions">
            <button class="row-command" type="button" disabled={!canReviewDiscoveredLead(job)} title={discoveredLeadReviewTitle(careerControlState, job, 'save')} on:click={() => reviewDiscoveredLead(job, 'save')}>
              <Save size={14} />
              <span>Save</span>
            </button>
            <button class="row-command" type="button" disabled={!canReviewDiscoveredLead(job)} title={discoveredLeadReviewTitle(careerControlState, job, 'watch')} on:click={() => reviewDiscoveredLead(job, 'watch')}>
              <Search size={14} />
              <span>Watch</span>
            </button>
            <button class="row-command danger" type="button" disabled={!canReviewDiscoveredLead(job)} title={discoveredLeadReviewTitle(careerControlState, job, 'archive')} on:click={() => reviewDiscoveredLead(job, 'archive')}>
              <X size={14} />
              <span>Not fit</span>
            </button>
          </div>
        </div>
      {/each}
    </div>
  </section>
{/if}

<section class="card mail-updates-panel" aria-label="Career mail updates">
  <div class="table-section-title">
    <strong>Unread Applied-Job Updates</strong>
    <span>{careerMailPanelStatus()}</span>
  </div>
  {#if mailUpdatesError}
    <p class="muted mail-update-empty" title={`Raw Career mail scan error: ${mailUpdatesError}`}>{visibleMailUpdatesError}</p>
  {:else if visibleCareerMailUpdates.length}
    <div class="mail-update-list">
      {#each visibleCareerMailUpdates as insight}
        <a class:unread={insight.thread.unread} class="mail-update-row" href={hubHref('/productivity')} title={`Open Productivity for ${insight.thread.subject}.`}>
          <span>{insight.thread.unread ? 'Unread' : 'Seen'}</span>
          <strong>{insight.thread.subject}</strong>
          <small>{matchedApplicationLabel(insight)} - {insight.reason}{insight.deadlineHint ? ` - ${insight.deadlineHint}` : ''}</small>
          <small>{threadDate(insight.thread.date)}</small>
        </a>
      {/each}
    </div>
  {:else}
    <p class="muted mail-update-empty">{careerMailEmptyMessage()}</p>
  {/if}
</section>

<section class="table-toolbar" aria-label="Career filters">
  <div class="field">
    <label for="job-search">Search</label>
    <div class="search-box">
      <Search size={16} />
      <input id="job-search" bind:value={searchQuery} placeholder="Company, role, or notes" title="Filter saved Career jobs by company, role, or notes. This filter is saved in this browser." />
    </div>
  </div>
  <div class="field">
    <label for="status-filter">Status</label>
    <select id="status-filter" bind:value={statusFilter} title="Filter saved Career jobs by status. This filter is saved in this browser.">
      <option value="all">All statuses</option>
      {#each statuses as item}
        <option value={item}>{item}</option>
      {/each}
    </select>
  </div>
  <div class="filter-count">
    <strong>{filteredJobs.length} / {jobs.length} jobs</strong>
    <small>{viewStatus}</small>
  </div>
</section>

<section class="card table-card">
  <table>
    <thead>
      <tr>
        <th>Company</th>
        <th>Role</th>
        <th>Application</th>
        <th>Fit</th>
        <th>Status</th>
        <th>Next</th>
        <th>Notes</th>
        <th>Updated</th>
        <th>Actions</th>
      </tr>
    </thead>
    <tbody>
      {#each filteredJobs as job}
        <tr>
          {#if editingJobId === job.id}
            <td><input class="table-input" bind:value={jobDraft.company} disabled={!canSave || rowBusyId === job.id} title={careerRowTitle(careerControlState, 'Company name.', job.id)} /></td>
            <td><input class="table-input" bind:value={jobDraft.role} disabled={!canSave || rowBusyId === job.id} title={careerRowTitle(careerControlState, 'Role title.', job.id)} /></td>
            <td><input class="table-input link-input" bind:value={jobDraft.applicationUrl} disabled={!canSave || rowBusyId === job.id} title={careerRowTitle(careerControlState, 'Application link.', job.id)} placeholder="https://..." /></td>
            <td><input class="table-input fit-input" bind:value={jobDraft.fitScore} disabled={!canSave || rowBusyId === job.id} title={careerRowTitle(careerControlState, 'Manual fit score from 0 to 100. Leave blank when unknown.', job.id)} inputmode="numeric" type="number" min="0" max="100" /></td>
            <td>
              <select class="table-select" bind:value={jobDraft.status} disabled={!canSave || rowBusyId === job.id} title={careerRowTitle(careerControlState, 'Application status.', job.id)}>
                {#each statuses as item}
                  <option value={item}>{item}</option>
                {/each}
              </select>
            </td>
            <td><input class="table-input" bind:value={jobDraft.nextActionAt} disabled={!canSave || rowBusyId === job.id} title={careerRowTitle(careerControlState, 'Next action date.', job.id)} type="date" /></td>
            <td><textarea class="table-textarea" bind:value={jobDraft.notes} disabled={!canSave || rowBusyId === job.id} title={careerRowTitle(careerControlState, 'Job notes.', job.id)} rows="2"></textarea></td>
            <td>{displayUpdated(job.updatedAt)}</td>
            <td class="actions-cell">
              <div class="row-actions">
                <button class="icon-button" type="button" aria-label="Save job" title={saveJobEditButtonTitle} disabled={!canSave || rowBusyId === job.id || !jobDraft.company.trim() || !jobDraft.role.trim()} on:click={() => saveJobEdit(job)}>
                  <Save size={16} />
                </button>
                <button class="icon-button" type="button" aria-label="Cancel job edit" title={careerCancelEditTitle(careerControlState, job.id)} disabled={rowBusyId === job.id} on:click={cancelEditJob}>
                  <X size={16} />
                </button>
              </div>
            </td>
          {:else}
            <td>{job.company}</td>
            <td>{job.role}</td>
            <td class="application-cell">
              {#if jobApplicationHref(job)}
                <a class="application-link" href={jobApplicationHref(job)} target="_blank" rel="noreferrer" title={`Open application link for ${job.role} at ${job.company}.`}>
                  <ExternalLink size={15} />
                  <span>Open</span>
                </a>
              {:else}
                <span class="muted">No link</span>
              {/if}
            </td>
            <td><span class="fit-score">{displayFitScore(job)}</span></td>
            <td>{job.status}</td>
            <td>{displayDate(job.nextActionAt)}</td>
            <td class="notes-cell">
              <details class="notes-detail">
                <summary>{notesSummary(job)}</summary>
                <div class="notes-expanded">
                  {#if visibleJobNotes(job)}
                    <p>{visibleJobNotes(job)}</p>
                  {/if}
                  {#if primaryLegacyJobDetails(job).length}
                    <div class="legacy-detail-list" aria-label="Legacy Career Desk details">
                      {#each primaryLegacyJobDetails(job) as detail}
                        <span>
                          <b>{detail.label}</b>
                          {#if detail.label === 'Link'}
                            <a href={detail.value} target="_blank" rel="noreferrer" title={`Open preserved legacy link for ${job.role} at ${job.company}.`}>Open</a>
                          {:else}
                            {detail.value}
                          {/if}
                        </span>
                      {/each}
                    </div>
                  {/if}
                  {#if legacyHistoryCount(job)}
                    <small class="legacy-history-note">{legacyHistoryCount(job)} legacy history event{legacyHistoryCount(job) === 1 ? '' : 's'} preserved</small>
                  {/if}
                  {#if !visibleJobNotes(job) && !primaryLegacyJobDetails(job).length && !legacyHistoryCount(job)}
                    <span class="muted">No notes saved</span>
                  {/if}
                </div>
              </details>
            </td>
            <td>{displayUpdated(job.updatedAt)}</td>
            <td class="actions-cell">
              <div class="row-actions">
                <button class="row-command" type="button" aria-label={`Mark ${job.company} applied`} title={markAppliedTitle(careerControlState, job)} disabled={!canMarkJobApplied(job)} on:click={() => markJobApplied(job)}>
                  <CheckCircle2 size={15} />
                  <span>{job.status === 'applied' ? 'Applied' : 'Mark applied'}</span>
                </button>
                <button class="icon-button" type="button" aria-label={`Edit ${job.company}`} title={careerEditRowTitle(careerControlState, job.id)} disabled={!canSave || !!editingJobId || rowBusyId === job.id} on:click={() => startEditJob(job)}>
                  <Edit3 size={16} />
                </button>
                <button class="icon-button danger" type="button" aria-label={`Delete ${job.company}`} title={careerRowTitle(careerControlState, 'Ask for confirmation before deleting this saved job.', job.id)} disabled={!canSave || rowBusyId === job.id} on:click={() => deleteJob(job)}>
                  <Trash2 size={16} />
                </button>
              </div>
            </td>
          {/if}
        </tr>
      {:else}
        <tr>
          <td colspan="9" class="muted">
            {#if jobs.length}
              No jobs match the current filters.
            {:else}
              <div class="empty-career-state">
                <span>{careerJobsEmptyMessage()}</span>
                {#if localDevOrigin}
                  <small>Legacy Career Desk jobs saved on GitHub Pages live under that browser origin, so localhost cannot read them directly.</small>
                  <a class="link-button" href={githubPagesCareerUrl} target="_blank" rel="noreferrer" title="Open the legacy GitHub Pages Career Desk import page.">Open GitHub Pages import</a>
                {/if}
              </div>
            {/if}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</section>

<section class="card table-card action-table">
  <div class="table-section-title">
    <strong>Career Actions</strong>
    <span>{filteredCareerActions.length} shown / {careerActions.length} synced</span>
  </div>
  <table>
    <thead>
      <tr>
        <th>Action</th>
        <th>Job</th>
        <th>Due</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>
      {#each filteredCareerActions as action}
        {@const job = linkedJob(action)}
        <tr>
          <td>{action.label}</td>
          <td>
            <span>{linkedJobLabel(action)}</span>
            {#if job && jobApplicationHref(job)}
              <a class="inline-application-link" href={jobApplicationHref(job)} target="_blank" rel="noreferrer" title={`Open application link for ${job.role} at ${job.company}.`}>Open application</a>
            {/if}
          </td>
          <td>{action.dueAt ? displayDate(action.dueAt) : 'No due date'}</td>
          <td>{action.completedAt ? `Done ${displayDate(action.completedAt)}` : 'Open'}</td>
        </tr>
      {:else}
        <tr>
          <td colspan="4" class="muted">{careerActionsEmptyMessage()}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</section>

<section class="utility-panels">
  <details class="card card-pad compact-panel">
    <summary>
      <span>Manual add</span>
      <small>Add a job by hand when it is not imported or discovered elsewhere.</small>
    </summary>
    <form class="form compact-form" on:submit|preventDefault={addJob}>
      <div class="field">
        <label for="company">Company</label>
        <input id="company" aria-label="Company" bind:value={company} disabled={!canSave || saving} title={careerSaveTitle(careerControlState, 'Company name.')} autocomplete="organization" />
      </div>
      <div class="field">
        <label for="role">Role</label>
        <input id="role" aria-label="Role" bind:value={role} disabled={!canSave || saving} title={careerSaveTitle(careerControlState, 'Role title.')} autocomplete="off" />
      </div>
      <div class="field">
        <label for="status">Status</label>
        <select id="status" aria-label="Application status" bind:value={status} disabled={!canSave || saving} title={careerSaveTitle(careerControlState, 'Application status.')}>
          {#each statuses as item}
            <option value={item}>{item}</option>
          {/each}
        </select>
      </div>
      <div class="field">
        <label for="application-url">Application link</label>
        <input id="application-url" aria-label="Application link" bind:value={applicationUrl} disabled={!canSave || saving} title={careerSaveTitle(careerControlState, 'Application link.')} inputmode="url" placeholder="https://..." />
      </div>
      <div class="field">
        <label for="fit-score">Fit</label>
        <input id="fit-score" aria-label="Fit score" bind:value={fitScore} disabled={!canSave || saving} title={careerSaveTitle(careerControlState, 'Manual fit score from 0 to 100. Leave blank when unknown.')} inputmode="numeric" type="number" min="0" max="100" />
      </div>
      <div class="field">
        <label for="next-action">Next action</label>
        <input id="next-action" aria-label="Next action date" bind:value={nextActionAt} disabled={!canSave || saving} title={careerSaveTitle(careerControlState, 'Next action date.')} type="date" />
      </div>
      <div class="field wide">
        <label for="notes">Notes</label>
        <textarea id="notes" aria-label="Job notes" bind:value={notes} disabled={!canSave || saving} title={careerSaveTitle(careerControlState, 'Job notes.')} rows="2"></textarea>
      </div>
      <button class="button primary" type="submit" disabled={!canSave || saving || !company.trim() || !role.trim()} title={addJobButtonTitle}>
        <Plus size={17} />
        <span>{saving ? 'Saving' : 'Add Job'}</span>
      </button>
    </form>
  </details>

  <details class="card card-pad compact-panel">
    <summary>
      <span>Career discovery</span>
      <small>{careerDiscoveryEnabled ? `Targets ${careerDiscoveryStartWindow || defaultCareerDiscoveryStartWindow}` : 'Passive role discovery is off'}</small>
    </summary>
    <form class="form compact-form" on:submit|preventDefault={saveCareerDiscoveryProfile}>
      <label class="check-row">
        <input type="checkbox" bind:checked={careerDiscoveryEnabled} disabled={!canSave || careerProfileSaving} title={careerDiscoveryProfileTitle(careerControlState)} />
        <span>Use this profile for routine passive role research</span>
      </label>
      <label class="check-row">
        <input type="checkbox" bind:checked={careerAutoMarkAppliedFromEvidence} disabled={!canSave || careerProfileSaving} title={careerDiscoveryProfileTitle(careerControlState)} />
        <span>Auto-mark applied when Gmail or completed actions match with high confidence</span>
      </label>
      <div class="field">
        <label for="career-research-intensity">Research intensity</label>
        <select id="career-research-intensity" aria-label="Career discovery research intensity" bind:value={careerDiscoveryResearchIntensity} disabled={!canSave || careerProfileSaving} title={careerDiscoveryProfileTitle(careerControlState)}>
          <option value="focused">Focused</option>
          <option value="broad">Broad</option>
          <option value="max">Max</option>
        </select>
      </div>
      <div class="field wide">
        <label for="career-background">Background filter</label>
        <textarea id="career-background" aria-label="Career background filter" bind:value={careerDiscoveryBackground} disabled={!canSave || careerProfileSaving} title={careerDiscoveryProfileTitle(careerControlState)} rows="2" placeholder="Math/CS, analytics, local AI projects, coursework, tools..."></textarea>
      </div>
      <div class="field">
        <label for="career-graduation-status">Status</label>
        <input id="career-graduation-status" aria-label="Career graduation and work status" bind:value={careerDiscoveryGraduationStatus} disabled={!canSave || careerProfileSaving} title={careerDiscoveryProfileTitle(careerControlState)} placeholder="Upcoming graduate, May 2027..." />
      </div>
      <div class="field">
        <label for="career-start-window">Start window</label>
        <input id="career-start-window" aria-label="Career target start window" bind:value={careerDiscoveryStartWindow} disabled={!canSave || careerProfileSaving} title={careerDiscoveryProfileTitle(careerControlState)} />
      </div>
      <div class="field">
        <label for="career-target-roles">Target roles</label>
        <textarea id="career-target-roles" aria-label="Career target roles" bind:value={careerDiscoveryRoles} disabled={!canSave || careerProfileSaving} title={careerDiscoveryProfileTitle(careerControlState)} rows="4" placeholder="One role family per line"></textarea>
      </div>
      <div class="field">
        <label for="career-locations">Locations / modes</label>
        <textarea id="career-locations" aria-label="Career target locations and work modes" bind:value={careerDiscoveryLocations} disabled={!canSave || careerProfileSaving} title={careerDiscoveryProfileTitle(careerControlState)} rows="4" placeholder="New York&#10;Remote&#10;Hybrid"></textarea>
      </div>
      <div class="field wide">
        <label for="career-exclusions">Extra exclusions</label>
        <textarea id="career-exclusions" aria-label="Career excluded companies" bind:value={careerDiscoveryExclusions} disabled={!canSave || careerProfileSaving} title={careerDiscoveryProfileTitle(careerControlState)} rows="2" placeholder="Companies or sources to avoid, one per line"></textarea>
      </div>
      <div class="profile-hints wide">
        <small>Saved-role seeds: {suggestedDiscoveryRoles.length ? suggestedDiscoveryRoles.join(', ') : 'none yet'}</small>
        <small>Duplicate guard: {trackedCareerCompanies.length ? trackedCareerCompanies.join(', ') : 'no tracked companies yet'}</small>
      </div>
      <button class="button primary" type="submit" disabled={!canSave || careerProfileSaving} title={careerDiscoveryProfileTitle(careerControlState)}>
        <Save size={17} />
        <span>{careerProfileSaving ? 'Saving' : 'Save Discovery'}</span>
      </button>
    </form>
  </details>

  <details class="card card-pad compact-panel">
    <summary>
      <span>Legacy data</span>
      <small>{importedLegacy ? `${importedLegacy.jobs ?? 0} imported jobs, ${importedLegacy.careerActions ?? importedLegacy.studyCareerActions ?? 0} actions` : 'Scan/export old local browser data'}</small>
    </summary>
    {#if summary}
      <dl>
        <div><dt>Jobs</dt><dd>{summary.careers}</dd></div>
        <div><dt>Study sessions</dt><dd>{summary.studySessions}</dd></div>
        <div><dt>Study daily actions</dt><dd>{summary.studyCareerActions}</dd></div>
        <div><dt>High-score games</dt><dd>{summary.highScoreGames}</dd></div>
        <div><dt>Theme</dt><dd>{summary.hasTheme ? 'Found' : 'No legacy theme found'}</dd></div>
      </dl>
      {#each summary.warnings as warning}
        <p class="muted">{warning}</p>
      {/each}
      {#if importedLegacy}
        <div class="import-summary">
          <span>Last import</span>
          <strong>{importedLegacy.importedAt ? displayUpdated(importedLegacy.importedAt) : 'Recorded'}</strong>
          <small>{importedLegacy.jobs ?? 0} jobs, {importedLegacy.studySessions ?? 0} study sessions, {importedLegacy.careerActions ?? importedLegacy.studyCareerActions ?? 0} career actions</small>
        </div>
      {/if}
    {:else}
      <p class="muted">Scanning local browser data.</p>
    {/if}
    <p class="muted import-hint">Legacy import scans only this page's browser origin. For old GitHub Pages jobs, open the GitHub Pages Career page while the local API is running, then use this panel there.</p>
  </details>
</section>

<style>
  .form {
    display: grid;
    gap: 12px;
  }

  .wide {
    grid-column: 1 / -1;
  }

  dl {
    display: grid;
    gap: 8px;
    margin: 14px 0 0;
  }

  dl div {
    display: flex;
    justify-content: space-between;
    gap: 14px;
  }

  dt {
    color: var(--muted);
  }

  dd {
    margin: 0;
    font-weight: 800;
  }

  .import-summary {
    display: grid;
    gap: 3px;
    margin-top: 12px;
    padding-top: 10px;
    border-top: 1px solid var(--border);
  }

  .import-summary span,
  .import-summary small {
    color: var(--muted);
  }

  .focus-strip {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    margin: 0 0 12px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface);
    overflow: hidden;
  }

  .focus-strip div {
    display: grid;
    gap: 3px;
    padding: 9px 11px;
    border-right: 1px solid var(--border);
  }

  .focus-strip div:last-child {
    border-right: 0;
  }

  .focus-strip span {
    color: var(--muted);
    font-size: 12px;
    font-weight: 750;
  }

  .focus-strip strong {
    font-size: 18px;
  }

  .mail-updates-panel {
    margin-bottom: 12px;
    overflow: hidden;
  }

  .discovered-leads-panel {
    margin-bottom: 12px;
    overflow: hidden;
  }

  .discovered-lead-list {
    display: grid;
  }

  .discovered-lead-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
    padding: 9px 11px;
    border-top: 1px solid var(--border);
    color: var(--text);
  }

  .discovered-lead-main {
    display: grid;
    grid-template-columns: 58px minmax(130px, 0.75fr) minmax(0, 1fr) 150px;
    gap: 3px 10px;
    color: var(--text);
    text-decoration: none;
  }

  .discovered-lead-row:hover {
    background: var(--active);
  }

  .discovered-lead-main span {
    color: var(--text);
    font-size: 12px;
    font-weight: 850;
  }

  .discovered-lead-main strong,
  .discovered-lead-main small {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .discovered-lead-main small {
    color: var(--muted);
  }

  .discovered-lead-main small:last-child {
    text-align: right;
  }

  .discovered-lead-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 6px;
  }

  .row-command.danger {
    color: var(--danger-text);
    border-color: var(--danger-border);
  }

  .mail-update-list {
    display: grid;
  }

  .mail-update-row {
    display: grid;
    grid-template-columns: 64px minmax(0, 1fr) 84px;
    gap: 3px 10px;
    padding: 9px 11px;
    border-top: 1px solid var(--border);
    color: var(--text);
    text-decoration: none;
  }

  .mail-update-row:hover {
    background: var(--active);
  }

  .mail-update-row span {
    grid-row: span 2;
    color: var(--muted);
    font-size: 12px;
    font-weight: 800;
  }

  .mail-update-row.unread span,
  .mail-update-row.unread strong {
    color: var(--text);
  }

  .mail-update-row strong,
  .mail-update-row small {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mail-update-row small {
    color: var(--muted);
  }

  .mail-update-row small:last-child {
    text-align: right;
  }

  .mail-update-empty {
    margin: 0;
    padding: 11px;
  }

  .table-toolbar {
    display: grid;
    grid-template-columns: minmax(220px, 1fr) 180px auto;
    align-items: end;
    gap: 12px;
    margin: 16px 0 10px;
  }

  .search-box {
    display: grid;
    grid-template-columns: 18px minmax(0, 1fr);
    align-items: center;
    gap: 8px;
    border: 1px solid var(--border-strong);
    border-radius: 6px;
    padding: 0 10px;
    background: var(--surface);
  }

  .search-box input {
    border: 0;
    padding-inline: 0;
  }

  .filter-count {
    min-height: 38px;
    display: grid;
    gap: 2px;
    align-items: center;
    color: var(--muted);
    font-weight: 800;
  }

  .filter-count strong {
    color: var(--text);
  }

  .filter-count small {
    color: var(--muted);
    font-size: 12px;
    line-height: 1.25;
  }

  .empty-career-state {
    display: grid;
    gap: 5px;
    max-width: 620px;
  }

  .empty-career-state small,
  .import-hint {
    color: var(--muted);
    font-size: 12px;
    line-height: 1.35;
  }

  .link-button {
    width: fit-content;
    border: 0;
    padding: 0;
    color: var(--text);
    background: transparent;
    font-weight: 750;
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  .table-card {
    overflow: auto;
  }

  .action-table {
    margin-top: 14px;
  }

  .utility-panels {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px;
    margin-top: 14px;
  }

  .compact-panel {
    padding: 0;
  }

  .compact-panel summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 14px;
    cursor: pointer;
    font-weight: 900;
  }

  .compact-panel summary small {
    min-width: 0;
    overflow: hidden;
    color: var(--muted);
    font-size: 12px;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .compact-panel > :not(summary) {
    margin: 0 14px 14px;
  }

  .compact-form {
    padding-top: 12px;
    border-top: 1px solid var(--border);
  }

  .check-row {
    display: flex;
    grid-column: 1 / -1;
    align-items: center;
    gap: 8px;
    color: var(--text);
    font-weight: 800;
  }

  .check-row input {
    width: 16px;
    height: 16px;
  }

  .profile-hints {
    display: grid;
    gap: 4px;
    color: var(--muted);
    font-weight: 700;
    line-height: 1.35;
  }

  .table-section-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--border);
  }

  .table-section-title span {
    color: var(--muted);
    font-weight: 700;
  }

  .notes-cell {
    min-width: 180px;
    max-width: 360px;
  }

  .application-cell {
    min-width: 112px;
  }

  .application-link,
  .inline-application-link {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: var(--accent);
    font-weight: 850;
    text-decoration: none;
  }

  .application-link:hover,
  .inline-application-link:hover {
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  .inline-application-link {
    margin-left: 8px;
    font-size: 12px;
  }

  .notes-detail summary {
    max-width: 340px;
    overflow: hidden;
    color: var(--text);
    cursor: pointer;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .notes-detail[open] summary {
    margin-bottom: 8px;
    color: var(--muted);
    white-space: normal;
  }

  .notes-expanded {
    display: grid;
    gap: 8px;
    max-width: 420px;
  }

  .notes-expanded p {
    margin: 0 0 8px;
    white-space: pre-wrap;
  }

  .legacy-detail-list {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    white-space: normal;
  }

  .legacy-detail-list span {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    max-width: 100%;
    padding: 3px 6px;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-soft);
    background: var(--surface-muted);
    overflow-wrap: anywhere;
  }

  .legacy-detail-list b {
    color: var(--muted);
  }

  .legacy-detail-list a {
    color: var(--accent);
    font-weight: 800;
  }

  .legacy-history-note {
    display: block;
    margin-top: 8px;
    color: var(--muted);
    font-weight: 700;
  }

  .table-input,
  .table-select,
  .table-textarea {
    min-width: 128px;
    padding: 8px 9px;
  }

  .fit-input {
    min-width: 84px;
  }

  .fit-score {
    font-weight: 850;
  }

  .link-input {
    min-width: 180px;
  }

  .table-textarea {
    min-width: 190px;
    resize: vertical;
  }

  .actions-cell {
    min-width: 198px;
  }

  .row-actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .row-command {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 34px;
    padding: 0 9px;
    border: 1px solid var(--border-strong);
    border-radius: 6px;
    color: var(--text);
    background: var(--surface);
    cursor: pointer;
    font-size: 12px;
    font-weight: 850;
    white-space: nowrap;
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
  }

  .icon-button.danger {
    color: var(--danger-text);
  }

  .icon-button:disabled,
  .row-command:disabled,
  .button:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  .offline-banner {
    margin-bottom: 14px;
    border-color: var(--warning-border);
    color: var(--warning-text);
    background: var(--warning-bg);
    font-weight: 800;
  }

  .error-banner {
    margin-bottom: 14px;
    border-color: var(--error-border);
    color: var(--error-text);
    background: var(--error-bg);
    font-weight: 800;
  }

  .success-banner {
    margin-bottom: 14px;
    border-color: var(--success-border);
    color: var(--success-text);
    background: var(--success-bg);
    font-weight: 800;
  }

  @media (max-width: 820px) {
    .table-toolbar,
    .utility-panels,
    .focus-strip {
      grid-template-columns: 1fr;
    }

    .focus-strip div {
      border-right: 0;
      border-bottom: 1px solid var(--border);
    }

    .focus-strip div:last-child {
      border-bottom: 0;
    }

    .mail-update-row {
      grid-template-columns: 62px minmax(0, 1fr);
    }

    .discovered-lead-row {
      grid-template-columns: 1fr;
    }

    .discovered-lead-main {
      grid-template-columns: 52px minmax(0, 1fr);
    }

    .discovered-lead-main small {
      grid-column: 2;
    }

    .discovered-lead-main small:last-child {
      text-align: left;
    }

    .discovered-lead-actions {
      justify-content: flex-start;
    }

    .mail-update-row small:last-child {
      grid-column: 2;
      text-align: left;
    }
  }
</style>
