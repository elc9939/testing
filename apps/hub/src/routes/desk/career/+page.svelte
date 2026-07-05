<script lang="ts">
  import { onMount } from 'svelte';
  import { CheckCircle2, Download, Edit3, ExternalLink, Mail, Play, Plus, RefreshCw, Save, Search, Trash2, X, Zap } from 'lucide-svelte';
  import type { CareerActionRecord, CareerScoutCandidate, JobRecord, PassiveResultCard, PassiveRun, PassiveSnapshot, PassiveTaskFamily } from '@mini-hub/core';
  import type { LegacyImportSummary } from '@mini-hub/db/migration';
  import { getBrowserStorage } from '$lib/browser-storage';
  import { canAutoSave, clientData } from '$lib/client-data';
  import {
    getPassiveSnapshot,
    passiveTaskActive,
    patchPassiveSettings,
    readCachedPassiveSnapshot,
    runPassiveTask as runPassiveAutomationTask,
    writePassiveSnapshotCache
  } from '$lib/passive-tasks-api';
  import { getConnections, listPriorityGmailThreads, type GmailThreadInsight, type PublicConnection } from '$lib/productivity-api';
  import {
    listCareerScoutCandidates,
    promoteCareerScoutCandidate,
    refineCareerScoutCandidate,
    rejectCareerScoutCandidate,
    runCareerScoutMaxPowerSearch,
    type CareerScoutSummary
  } from '$lib/career-scout-api';
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
    maxPowerSearch: boolean;
    researchIntensity: 'focused' | 'broad' | 'max';
    background: string;
    graduationStatus: string;
    targetStartWindow: string;
    targetRoles: string[];
    locations: string[];
    priorityCompanies: string[];
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
    careerDiscoverySetupBusy: boolean;
  }

  interface CareerAutomationRow {
    family: PassiveTaskFamily;
    label: string;
    taskId: string;
    active: boolean;
    taskStatus: string;
    sourceStatus: string;
    nextRunAt?: string;
    lastRunAt?: string;
    lastRunStatus?: string;
    summary: string;
    error: string;
  }

  interface CareerDiscoveryLearningSummary {
    memorySize: number;
    seenRegistrySize: number;
    seenFinalDecisions: number;
    rememberedFilters: number;
    skippedCandidates: number;
    importedLeads: number;
    pooledCandidates: number;
    enrichedCandidates: number;
    rejectedCandidates: number;
    skippedReasonSummary: string;
    latestRunAt: string;
    status: string;
  }

  interface CareerDiscoveryReadiness {
    configured: boolean;
    enabled: boolean;
    maxPowerSearch: boolean;
    status: string;
    detail: string;
    whyNoRecommendations: string;
    activeTopicCount: number;
    activeSourceLaneCount: number;
    activeCompanyCount: number;
    topics: string[];
    sourceLanes: string[];
    companies: string[];
    importedLeads: number;
    filteredCandidates: number;
    lastRunAt: string;
    nextRunAt: string;
    workerLine: string;
  }

  interface CareerScoutControlState {
    canSave: boolean;
    loading: boolean;
    busyId: string;
    passiveBusyFamily: PassiveTaskFamily | '';
    careerDiscoverySetupBusy: boolean;
  }

  interface CareerDiscoveryLeadMetadata {
    sourceQuality?: string;
    timingConfidence?: string;
    deadlineConfidence?: string;
    postingDate?: string;
    duplicateStatus?: string;
  }

  interface CareerStrategySummary {
    headline: string;
    nextAction: string;
    pipelineLine: string;
    riskLine: string;
    roleLine: string;
    recentLine: string;
  }

  interface ApplyQueueItem {
    job: JobRecord;
    score: number;
    reason: string;
    angle: string;
    urgency: string;
    href: string;
  }

  const githubPagesCareerUrl = 'https://elc9939.github.io/testing/desk/career';
  const careerViewStorageKey = 'miniHub.career.view.v1';
  const careerEditRowEnabledTitle = 'Edit this saved job inline; save or cancel the row to keep changes.';
  const defaultCareerDiscoveryStartWindow = 'May 2027 / Summer 2027 start';
  const defaultCareerDiscoveryRoles = [
    'Quant Research Intern',
    'Quant Trading Intern',
    'Data Analyst',
    'Data Scientist',
    'Machine Learning Intern',
    'ML/Data Analyst',
    'Technical Analyst',
    'Early-career finance data analyst'
  ];
  const defaultCareerDiscoveryLocations = [
    'New York',
    'San Francisco Bay Area',
    'California',
    'Remote',
    'Hybrid',
    'Chicago',
    'Boston',
    'Jersey City',
    'Stamford'
  ];
  const defaultCareerDiscoveryBackground =
    'Math/CS background with analytics, quant, Python, machine learning, research, data projects, technical tooling, and local AI/automation projects.';
  const defaultCareerDiscoveryGraduationStatus =
    'B.S. Mathematics completed May 2026; current M.S. Mathematics student expected May 2027, targeting May/Summer 2027 starts and early-career or student-eligible roles.';
  const careerAutomationFamilies: PassiveTaskFamily[] = ['career_radar', 'research_monitor'];

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
  let careerDiscoverySetupBusy = false;
  let careerDiscoveryEnabled = true;
  let careerAutoMarkAppliedFromEvidence = true;
  let careerDiscoveryMaxPowerSearch = false;
  let careerDiscoveryResearchIntensity: CareerDiscoveryProfile['researchIntensity'] = 'max';
  let careerDiscoveryBackground = '';
  let careerDiscoveryGraduationStatus = '';
  let careerDiscoveryStartWindow = defaultCareerDiscoveryStartWindow;
  let careerDiscoveryRoles = '';
  let careerDiscoveryLocations = '';
  let careerDiscoveryPriorityCompanies = '';
  let careerDiscoveryExclusions = '';
  let connections: PublicConnection[] = [];
  let careerMailUpdates: GmailThreadInsight[] = [];
  let mailUpdatesLoading = false;
  let mailUpdatesError = '';
  let passiveSnapshot: PassiveSnapshot | null = null;
  let passiveCachedAt = '';
  let passiveLoading = false;
  let passiveError = '';
  let passiveBusyFamily: PassiveTaskFamily | '' = '';
  let careerScoutCandidates: CareerScoutCandidate[] = [];
  let careerScoutSummary: CareerScoutSummary = emptyCareerScoutSummary();
  let careerScoutLoading = false;
  let careerScoutError = '';
  let careerScoutBusyId = '';

  $: canSave = canAutoSave($clientData);
  $: jobs = $clientData.jobs;
  $: careerActions = $clientData.careerActions;
  $: filteredJobs = jobs.filter(matchesJob).sort(compareCareerJobs);
  $: filteredCareerActions = careerActions.filter(matchesCareerAction);
  $: importedLegacy = (($clientData.settings?.recentState?.legacyImport ?? null) as LegacyImportState | null);
  $: applyQueue = jobs.filter((job) => ['lead', 'saved', 'watching'].includes(job.status)).sort(compareApplyQueueJobs);
  $: topApplyQueue = applyQueue.slice(0, 6).map(applyQueueItem);
  $: activeJobs = jobs.filter((job) => !['rejected', 'archived'].includes(job.status));
  $: openCareerActions = careerActions.filter((action) => !action.completedAt);
  $: dueCareerActions = openCareerActions.filter((action) => action.dueAt);
  $: googleConnected = connections.some((connection) => connection.provider === 'google' && connection.status === 'connected');
  $: submittedJobs = jobs.filter(isSubmittedApplication);
  $: careerStrategy = buildCareerStrategySummary(jobs, careerActions);
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
    careerProfileSaving,
    careerDiscoverySetupBusy
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
  $: careerAutomationRows = buildCareerAutomationRows(passiveSnapshot);
  $: careerDiscoveryAutomationRow = careerAutomationRows.find((row) => row.family === 'research_monitor');
  $: careerAutomationCards = careerAutomationResultCards(passiveSnapshot);
  $: careerAutomationStatusText = careerAutomationStatus(passiveSnapshot, passiveLoading, passiveError);
  $: careerDiscoveryLearning = buildCareerDiscoveryLearningSummary(
    passiveSnapshot,
    $clientData.settings?.preferences?.careerDiscoveryMemory,
    $clientData.settings?.preferences?.careerSeenLeadRegistry
  );
  $: careerDiscoveryReadiness = buildCareerDiscoveryReadiness(
    passiveSnapshot,
    $clientData.settings?.preferences?.careerDiscovery,
    careerDiscoveryLearning,
    careerDiscoveryAutomationRow
  );
  $: actionableCareerScoutCandidates = careerScoutCandidates
    .filter((candidate) => ['enriched', 'needs_review', 'plausible'].includes(candidate.status))
    .sort(compareCareerScoutCandidates)
    .slice(0, 6);
  $: rejectedCareerScoutPreview = careerScoutCandidates.filter((candidate) => candidate.status === 'rejected').slice(0, 4);
  $: careerScoutControlState = {
    canSave,
    loading: careerScoutLoading,
    busyId: careerScoutBusyId,
    passiveBusyFamily,
    careerDiscoverySetupBusy
  };
  $: careerScoutStatusText = careerScoutPanelStatus(careerScoutSummary, careerScoutLoading, careerScoutError);
  $: visibleCareerScoutError = careerScoutError ? compactCareerDeskIssue(careerScoutError, 'Career Scout') : '';
  $: visiblePassiveError = passiveError ? compactCareerDeskIssue(passiveError, 'Career automation') : '';
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

  function emptyCareerScoutSummary(): CareerScoutSummary {
    return {
      discovered: 0,
      plausible: 0,
      enriched: 0,
      promoted: 0,
      rejected: 0,
      needsReview: 0,
      total: 0
    };
  }

  function careerScoutPanelStatus(summary: CareerScoutSummary, loading: boolean, error: string): string {
    if (loading && !summary.total) return 'Loading candidate pool';
    if (error) return 'Needs attention';
    if (!summary.total) return 'No candidates pooled yet';
    return `${summary.enriched + summary.needsReview + summary.plausible} reviewable / ${summary.total} pooled`;
  }

  function compareCareerScoutCandidates(a: CareerScoutCandidate, b: CareerScoutCandidate): number {
    return (b.fitScore ?? -1) - (a.fitScore ?? -1) || dateMs(b.updatedAt) - dateMs(a.updatedAt);
  }

  function careerScoutCandidateTitle(candidate: CareerScoutCandidate): string {
    const bits = [
      candidate.sourceQuality ? `source ${candidate.sourceQuality}` : '',
      candidate.timingConfidence ? `timing ${candidate.timingConfidence}` : '',
      candidate.profileFitConfidence ? `profile ${candidate.profileFitConfidence}` : '',
      candidate.deadlineConfidence ? `deadline ${candidate.deadlineConfidence}` : ''
    ].filter(Boolean);
    return bits.join(' / ') || 'Candidate metadata not available yet';
  }

  function careerScoutCandidateSummary(candidate: CareerScoutCandidate): string {
    const score = typeof candidate.fitScore === 'number' ? `fit ${candidate.fitScore}` : 'fit unknown';
    const source = candidate.sourceQuality || 'source unknown';
    const timing = candidate.timingConfidence || 'timing unknown';
    return `${score} - ${source} - ${timing}`;
  }

  function careerScoutActionTitle(
    state: CareerScoutControlState,
    candidate: CareerScoutCandidate,
    action: 'promote' | 'reject' | 'refine' | 'paid-refine'
  ): string {
    if (!state.canSave) return 'Offline read-only: start or connect the Mini Hub API before changing Career Scout candidates.';
    if (state.loading) return 'Career Scout candidate pool is still loading.';
    if (state.busyId === candidate.id) return 'This Career Scout candidate action is already running.';
    if (state.busyId) return 'Another Career Scout candidate action is already running.';
    if (action === 'promote' && candidate.status === 'promoted') return 'This candidate is already promoted.';
    if (action === 'promote' && (!candidate.company.trim() || !candidate.role.trim())) return 'Candidate needs a company and role before promotion.';
    if (action === 'reject' && candidate.status === 'rejected') return 'This candidate is already rejected.';
    if (action === 'refine') return 'Refresh this candidate with the local refine/ranking path; paid GPT fallback remains budget-gated.';
    if (action === 'paid-refine') return 'Run local-first refinement with paid GPT-4o mini fallback allowed up to a $0.05 cap.';
    return action === 'promote' ? 'Promote this candidate into the visible Career Desk table.' : 'Reject this candidate but keep it inspectable in the pool.';
  }

  function maxPowerButtonTitle(state: CareerScoutControlState): string {
    if (!state.canSave) return 'Start or connect the local Mini Hub API before starting Max Power Search.';
    if (state.careerDiscoverySetupBusy || state.passiveBusyFamily) return 'Career Discovery is already running.';
    return 'Run a heavy bounded local-first Career Scout discovery sweep and save results to the candidate pool.';
  }

  function dateMs(value?: string): number {
    const parsed = Date.parse(value ?? '');
    return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
  }

  function plainRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  }

  function numberField(record: Record<string, unknown>, key: string): number {
    const value = Number(record[key]);
    return Number.isFinite(value) ? value : 0;
  }

  function booleanField(record: Record<string, unknown>, key: string): boolean {
    return record[key] === true;
  }

  function stringArrayField(value: unknown, limit = 12): string[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => String(item).trim())
      .filter(Boolean)
      .slice(0, limit);
  }

  function uniqueStringList(values: string[], limit = 50): string[] {
    return Array.from(new Set(values.map((item) => item.trim().replace(/\s+/g, ' ')).filter(Boolean))).slice(0, limit);
  }

  function passiveSourceDetails(snapshot: PassiveSnapshot | null, family: PassiveTaskFamily): Record<string, unknown> {
    return plainRecord(snapshot?.sources.find((source) => source.id === family)?.details);
  }

  function careerDiscoveryMemorySize(value: unknown): number {
    const memory = plainRecord(value);
    const candidates = memory.rejectedCandidates;
    return Array.isArray(candidates) ? candidates.length : 0;
  }

  function careerSeenLeadRegistryStats(value: unknown): { total: number; finalDecisions: number } {
    const registry = plainRecord(value);
    const entries = registry.entries;
    if (!Array.isArray(entries)) return { total: 0, finalDecisions: 0 };
    const finalStatuses = new Set(['applied', 'interview', 'offer', 'rejected', 'archived', 'deleted']);
    const finalDecisions = entries.filter((entry) => finalStatuses.has(String(plainRecord(entry).status ?? '').toLowerCase())).length;
    return { total: entries.length, finalDecisions };
  }

  function careerDiscoverySkipReasonLabel(reason: string): string {
    const labels: Record<string, string> = {
      'duplicate-company-role': 'duplicate role',
      'duplicate-url': 'duplicate URL',
      'excluded-company': 'excluded company',
      'graduation-year-mismatch': 'wrong graduation year',
      'job-board-mirror': 'job-board mirror',
      'low-fit-score': 'low fit',
      'low-timing-confidence': 'weak timing',
      'missing-company-role': 'missing company/role',
      'missing-url': 'missing URL',
      'not-opportunity': 'not a role',
      'previously-filtered': 'previously filtered',
      'qualification-mismatch': 'qualification mismatch',
      'start-date-mismatch': 'wrong start date',
      'unclear-source': 'unclear source',
      'weak-profile-fit': 'weak profile fit'
    };
    return labels[reason] ?? reason.replaceAll('-', ' ');
  }

  function careerDiscoverySkipReasonSummary(value: unknown): string {
    const reasons = plainRecord(value);
    return Object.entries(reasons)
      .map(([reason, count]) => [reason, Number(count)] as const)
      .filter(([, count]) => Number.isFinite(count) && count > 0)
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 4)
      .map(([reason, count]) => `${careerDiscoverySkipReasonLabel(reason)} ${count}`)
      .join(' / ');
  }

  function displayAutomationTime(value?: string): string {
    if (!value) return 'Not yet';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
  }

  function careerAutomationLabel(family: PassiveTaskFamily): string {
    return family === 'career_radar' ? 'Career Radar' : 'Career Discovery';
  }

  function hydratePassiveSnapshotFromCache(): void {
    const cached = readCachedPassiveSnapshot();
    if (!cached) return;
    passiveSnapshot = cached.snapshot;
    passiveCachedAt = cached.cachedAt;
  }

  function setPassiveSnapshot(snapshot: PassiveSnapshot): void {
    passiveSnapshot = snapshot;
    const cacheResult = writePassiveSnapshotCache(snapshot);
    passiveCachedAt = cacheResult.cachedAt ?? passiveCachedAt;
  }

  async function refreshCareerAutomationSnapshot(background = false): Promise<void> {
    if (passiveLoading) return;
    passiveLoading = true;
    if (!background) passiveError = '';
    try {
      setPassiveSnapshot(await getPassiveSnapshot());
      passiveError = '';
    } catch (error) {
      passiveError = error instanceof Error ? error.message : 'Career automation status refresh failed';
    } finally {
      passiveLoading = false;
    }
  }

  async function refreshCareerScoutPool(background = false): Promise<void> {
    if (careerScoutLoading) return;
    careerScoutLoading = true;
    if (!background) careerScoutError = '';
    try {
      const result = await listCareerScoutCandidates('', 120);
      careerScoutCandidates = result.candidates;
      careerScoutSummary = result.summary;
      careerScoutError = '';
    } catch (error) {
      careerScoutError = error instanceof Error ? error.message : 'Career Scout pool refresh failed';
    } finally {
      careerScoutLoading = false;
    }
  }

  async function promoteCareerScout(candidate: CareerScoutCandidate): Promise<void> {
    if (!canSave || careerScoutBusyId) return;
    careerScoutBusyId = candidate.id;
    careerScoutError = '';
    saveMessage = '';
    try {
      const result = await promoteCareerScoutCandidate(candidate.id);
      await clientData.syncNow();
      await refreshCareerScoutPool(true);
      saveMessage = `Promoted ${result.job.role} at ${result.job.company} from Career Scout.`;
    } catch (error) {
      careerScoutError = error instanceof Error ? error.message : 'Career Scout promotion failed';
    } finally {
      careerScoutBusyId = '';
    }
  }

  async function rejectCareerScout(candidate: CareerScoutCandidate): Promise<void> {
    if (!canSave || careerScoutBusyId) return;
    careerScoutBusyId = candidate.id;
    careerScoutError = '';
    saveMessage = '';
    try {
      await rejectCareerScoutCandidate(candidate.id, 'manual-not-fit');
      await refreshCareerScoutPool(true);
      saveMessage = `Rejected Career Scout candidate ${candidate.company || candidate.rawTitle || candidate.id}.`;
    } catch (error) {
      careerScoutError = error instanceof Error ? error.message : 'Career Scout reject failed';
    } finally {
      careerScoutBusyId = '';
    }
  }

  async function refineCareerScout(candidate: CareerScoutCandidate, usePaidProvider = false): Promise<void> {
    if (!canSave || careerScoutBusyId) return;
    careerScoutBusyId = candidate.id;
    careerScoutError = '';
    saveMessage = '';
    try {
      const result = await refineCareerScoutCandidate(candidate.id, { usePaidProvider, costCeilingUsd: usePaidProvider ? 0.05 : 0 });
      await refreshCareerScoutPool(true);
      saveMessage = `Refined ${candidate.company || candidate.rawTitle || candidate.id} with ${result.refinement.provider}/${result.refinement.model}; cost $${result.refinement.costUsd.toFixed(4)}.`;
    } catch (error) {
      careerScoutError = error instanceof Error ? error.message : 'Career Scout refine failed';
    } finally {
      careerScoutBusyId = '';
    }
  }

  function latestPassiveRun(snapshot: PassiveSnapshot | null, family: PassiveTaskFamily): PassiveRun | undefined {
    return [...(snapshot?.runs ?? [])]
      .filter((run) => run.family === family)
      .sort((a, b) => dateMs(b.finishedAt ?? b.startedAt) - dateMs(a.finishedAt ?? a.startedAt))[0];
  }

  function latestPassiveCard(snapshot: PassiveSnapshot | null, family: PassiveTaskFamily): PassiveResultCard | undefined {
    return [...(snapshot?.results ?? []), ...(snapshot?.digest ?? [])]
      .filter((card) => card.family === family)
      .sort((a, b) => dateMs(b.createdAt) - dateMs(a.createdAt))[0];
  }

  function buildCareerDiscoveryLearningSummary(snapshot: PassiveSnapshot | null, memoryValue: unknown, registryValue: unknown): CareerDiscoveryLearningSummary {
    const run = latestPassiveRun(snapshot, 'research_monitor');
    const metadata = plainRecord(run?.metadata);
    const recentResearch = plainRecord(metadata.recentResearch);
    const memorySize = numberField(recentResearch, 'careerDiscoveryFilterMemorySize') || careerDiscoveryMemorySize(memoryValue);
    const registryStats = careerSeenLeadRegistryStats(registryValue);
    const seenRegistrySize = numberField(recentResearch, 'careerSeenLeadRegistrySize') || registryStats.total;
    const rememberedFilters = numberField(recentResearch, 'rememberedCareerLeadFilters');
    const skippedCandidates = numberField(recentResearch, 'skippedCareerLeadCandidates');
    const importedLeads = numberField(recentResearch, 'importedCareerLeads');
    const pooledCandidates = numberField(recentResearch, 'careerScoutCandidatesPooled');
    const enrichedCandidates = numberField(recentResearch, 'enrichedCareerScoutCandidates');
    const rejectedCandidates = numberField(recentResearch, 'rejectedCareerScoutCandidates');
    const skippedReasonSummary = careerDiscoverySkipReasonSummary(recentResearch.skippedCareerLeadReasons);
    const latestRunAt = run?.finishedAt ?? run?.startedAt ?? '';
    let status = 'No Career Discovery learning data yet.';
    if (seenRegistrySize || memorySize || rememberedFilters || skippedCandidates || importedLeads || pooledCandidates) {
      status = `${pooledCandidates} pooled / ${enrichedCandidates} enriched / ${rejectedCandidates || skippedCandidates} rejected-filtered`;
    } else if (snapshot && run) {
      status = 'Latest discovery run did not pool or filter any candidates.';
    } else if (snapshot) {
      status = 'Career Discovery has no run history yet.';
    }
    return {
      memorySize,
      seenRegistrySize,
      seenFinalDecisions: registryStats.finalDecisions,
      rememberedFilters,
      skippedCandidates,
      importedLeads,
      pooledCandidates,
      enrichedCandidates,
      rejectedCandidates,
      skippedReasonSummary,
      latestRunAt,
      status
    };
  }

  function buildCareerDiscoveryReadiness(
    snapshot: PassiveSnapshot | null,
    profileValue: unknown,
    learning: CareerDiscoveryLearningSummary,
    row: CareerAutomationRow | undefined
  ): CareerDiscoveryReadiness {
    const profile = plainRecord(profileValue);
    const localConfigured = Boolean(profileValue && typeof profileValue === 'object' && !Array.isArray(profileValue));
    const researchSource = snapshot?.sources.find((source) => source.id === 'research_monitor');
    const sourceDetails = passiveSourceDetails(snapshot, 'research_monitor');
    const sourceConfigured = booleanField(sourceDetails, 'careerDiscoveryConfigured');
    const configured = localConfigured || sourceConfigured;
    const enabled = configured && profile.enabled !== false && (sourceConfigured ? booleanField(sourceDetails, 'careerDiscoveryEnabled') : true);
    const maxPowerSearch = configured && (profile.maxPowerSearch === true || booleanField(sourceDetails, 'careerDiscoveryMaxPowerSearch'));
    const run = latestPassiveRun(snapshot, 'research_monitor');
    const runMetadata = plainRecord(run?.metadata);
    const recentResearch = plainRecord(runMetadata.recentResearch);
    const topics = uniqueStringList([
      ...stringArrayField(sourceDetails.careerDiscoveryTopics, 16),
      ...stringArrayField(runMetadata.careerDiscoveryTopics, 16)
    ]);
    const sourceLanes = stringArrayField(sourceDetails.careerDiscoverySourceLanes, 12);
    const companies = uniqueStringList([
      ...stringArrayField(sourceDetails.careerDiscoveryCompanies, 10),
      ...stringArrayField(runMetadata.watchedCompanies, 10)
    ]);
    const activeTopicCount = numberField(sourceDetails, 'careerDiscoveryActiveTopicCount') || topics.length;
    const activeSourceLaneCount = numberField(sourceDetails, 'careerDiscoveryActiveSourceLaneCount') || sourceLanes.length;
    const activeCompanyCount = numberField(sourceDetails, 'careerDiscoveryActiveCompanyCount') || companies.length;
    const importedLeads = learning.importedLeads || numberField(sourceDetails, 'importedCareerLeads') || numberField(recentResearch, 'importedCareerLeads');
    const enrichedCandidates =
      learning.enrichedCandidates || numberField(sourceDetails, 'enrichedCareerScoutCandidates') || numberField(recentResearch, 'enrichedCareerScoutCandidates');
    const pooledCandidates =
      learning.pooledCandidates || numberField(sourceDetails, 'careerScoutCandidatesPooled') || numberField(recentResearch, 'careerScoutCandidatesPooled');
    const filteredCandidates =
      learning.skippedCandidates || numberField(sourceDetails, 'skippedCareerLeadCandidates') || numberField(recentResearch, 'skippedCareerLeadCandidates');
    const lastRunAt = learning.latestRunAt || run?.finishedAt || run?.startedAt || row?.lastRunAt || '';
    const nextRunAt = row?.nextRunAt ?? String(sourceDetails.nextRunAt ?? '');
    const workerLine = snapshot
      ? snapshot.worker.enabled
        ? `Worker ${snapshot.worker.running ? 'running' : 'idle'}; next tick ${displayAutomationTime(snapshot.worker.nextTickAt)}`
        : 'Passive worker is disabled'
      : 'Passive worker status unknown';
    const setupReason = String(sourceDetails.careerDiscoverySetupReason ?? '');

    let status = 'Checking Career Discovery';
    let detail = 'Loading passive task state.';
    let whyNoRecommendations = 'Career Discovery has not reported a reason yet.';
    if (!snapshot) {
      status = 'Needs local API';
      detail = 'Career Discovery needs the local Mini Hub API and Passive Tasks snapshot.';
      whyNoRecommendations = 'No passive snapshot is loaded, so the app cannot confirm scouting state.';
    } else if (!configured) {
      status = 'Career Discovery is not configured';
      detail = setupReason || 'Enable Max Scout to save a real scouting profile and create broad new-role monitors.';
      whyNoRecommendations = 'No saved Max Scout profile exists, so passive runs only watch existing saved-job domains.';
    } else if (!enabled) {
      status = 'Career Discovery is off';
      detail = setupReason || 'The saved Career Discovery profile is disabled.';
      whyNoRecommendations = 'The saved scouting profile is disabled.';
    } else if (researchSource?.status === 'error') {
      status = 'Career Discovery needs service';
      detail = researchSource.error ? compactCareerDeskIssue(researchSource.error, 'Career Discovery') : 'The research monitor source is reporting an error.';
      whyNoRecommendations = 'The saved scouting profile exists, but the research monitor cannot complete until the local AI OS/research service is reachable.';
    } else if (!activeTopicCount && !activeSourceLaneCount && !activeCompanyCount) {
      status = 'Career Discovery needs targets';
      detail = setupReason || 'The profile is saved, but no active topics, source lanes, or companies were generated.';
      whyNoRecommendations = 'The profile did not produce active discovery monitors.';
    } else {
      status = `${maxPowerSearch ? 'Max Power Search' : 'Max Scout'} ready: ${activeTopicCount} topics / ${activeSourceLaneCount} lanes`;
      detail = activeCompanyCount
        ? `${activeCompanyCount} priority-company monitor${activeCompanyCount === 1 ? '' : 's'} included.${maxPowerSearch ? ' Continuous heavy cadence is on.' : ''}`
        : `Broad source-lane monitors are active.${maxPowerSearch ? ' Continuous heavy cadence is on.' : ''}`;
      if (enrichedCandidates) {
        whyNoRecommendations = `${enrichedCandidates} candidate${enrichedCandidates === 1 ? '' : 's'} enriched into the Career Scout pool; promote the clean ones when ready.`;
      } else if (pooledCandidates) {
        whyNoRecommendations = `${pooledCandidates} candidate${pooledCandidates === 1 ? '' : 's'} pooled, but none reached enriched status yet.`;
      } else if (importedLeads) {
        whyNoRecommendations = `${importedLeads} source-backed lead${importedLeads === 1 ? '' : 's'} imported from the latest Career Discovery data.`;
      } else if (filteredCandidates) {
        whyNoRecommendations = `${filteredCandidates} candidate${filteredCandidates === 1 ? '' : 's'} found but filtered by strict fit/source/timing rules.`;
      } else if (!lastRunAt) {
        whyNoRecommendations = 'Max Scout is configured, but the research monitor has not run yet.';
      } else {
        whyNoRecommendations = 'Latest run did not return a new source-backed candidate that passed pool checks.';
      }
    }

    return {
      configured,
      enabled,
      maxPowerSearch,
      status,
      detail,
      whyNoRecommendations,
      activeTopicCount,
      activeSourceLaneCount,
      activeCompanyCount,
      topics,
      sourceLanes,
      companies,
      importedLeads,
      filteredCandidates,
      lastRunAt,
      nextRunAt,
      workerLine
    };
  }

  function buildCareerAutomationRows(snapshot: PassiveSnapshot | null): CareerAutomationRow[] {
    return careerAutomationFamilies.map((family) => {
      const task = snapshot?.tasks.find((item) => item.family === family);
      const watcher = task ? snapshot?.watchers.find((item) => item.id === task.watcherId) : undefined;
      const source = snapshot?.sources.find((item) => item.id === family);
      const run = latestPassiveRun(snapshot, family);
      const card = latestPassiveCard(snapshot, family);
      return {
        family,
        label: careerAutomationLabel(family),
        taskId: task?.id ?? '',
        active: Boolean(snapshot && task && passiveTaskActive(task, watcher, snapshot.settings)),
        taskStatus: task?.status ?? 'missing',
        sourceStatus: source?.status ?? (snapshot ? 'unavailable' : 'unknown'),
        nextRunAt: task?.nextRunAt ?? task?.trigger.nextRunAt,
        lastRunAt: run?.finishedAt ?? run?.startedAt ?? card?.createdAt,
        lastRunStatus: run?.status,
        summary: card?.title ?? run?.cards[0]?.title ?? source?.label ?? 'No run history yet',
        error: source?.error ?? run?.error ?? ''
      };
    });
  }

  function careerAutomationResultCards(snapshot: PassiveSnapshot | null): PassiveResultCard[] {
    return [...(snapshot?.results ?? []), ...(snapshot?.digest ?? [])]
      .filter((card) => careerAutomationFamilies.includes(card.family))
      .sort((a, b) => dateMs(b.createdAt) - dateMs(a.createdAt))
      .slice(0, 4);
  }

  function careerAutomationStatus(snapshot: PassiveSnapshot | null, loading: boolean, error: string): string {
    if (loading && !snapshot) return 'Checking automation';
    if (error && !snapshot) return 'Needs local service';
    if (!snapshot) return 'No snapshot loaded';
    const active = buildCareerAutomationRows(snapshot).filter((row) => row.active).length;
    return `${active} active / ${careerAutomationFamilies.length} career tasks`;
  }

  function careerAutomationRunTitle(row: CareerAutomationRow): string {
    if (passiveBusyFamily === row.family) return `${row.label} is already running.`;
    if (passiveBusyFamily) return 'Another Career automation task is already running.';
    if (!row.taskId) return 'Passive Tasks has no saved task id for this Career automation.';
    if (!row.active) return 'Enable the Passive Tasks engine, watcher, and family before running this task.';
    return `Run ${row.label} now through the Passive Tasks API.`;
  }

  async function runCareerAutomation(row: CareerAutomationRow): Promise<void> {
    if (!row.taskId || !row.active || passiveBusyFamily) return;
    passiveBusyFamily = row.family;
    passiveError = '';
    saveMessage = '';
    try {
      setPassiveSnapshot(await runPassiveAutomationTask(row.taskId, { manual: true, reason: `career-desk-${row.family}` }));
      if (row.family === 'research_monitor') await refreshCareerScoutPool(true);
      saveMessage = `${row.label} run finished; Career automation status refreshed.`;
    } catch (error) {
      passiveError = error instanceof Error ? error.message : `${row.label} run failed`;
    } finally {
      passiveBusyFamily = '';
    }
  }

  async function runCareerDiscoveryNow(): Promise<void> {
    if (!careerDiscoveryAutomationRow || !careerDiscoveryReadiness.configured) return;
    await runCareerAutomation(careerDiscoveryAutomationRow);
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

  function careerDiscoveryExcludedCompaniesFromJobs(records: JobRecord[]): string[] {
    const finalStatuses = new Set(['applied', 'interview', 'offer', 'rejected', 'archived']);
    return uniqueStringList(
      records
        .filter((job) => finalStatuses.has(job.status))
        .map((job) => job.company)
        .filter(Boolean),
      80
    );
  }

  function maxScoutCareerDiscoveryProfile(records: JobRecord[], maxPowerSearch = false): CareerDiscoveryProfile {
    const existingPriorityCompanies = splitListField(careerDiscoveryPriorityCompanies);
    return {
      enabled: true,
      autoMarkAppliedFromEvidence: true,
      maxPowerSearch,
      researchIntensity: 'max',
      background: careerDiscoveryBackground.trim() || defaultCareerDiscoveryBackground,
      graduationStatus: careerDiscoveryGraduationStatus.trim() || defaultCareerDiscoveryGraduationStatus,
      targetStartWindow: careerDiscoveryStartWindow.trim() || defaultCareerDiscoveryStartWindow,
      targetRoles: uniqueStringList([...splitListField(careerDiscoveryRoles), ...defaultCareerDiscoveryRoles], 18),
      locations: uniqueStringList([...splitListField(careerDiscoveryLocations), ...defaultCareerDiscoveryLocations], 18),
      priorityCompanies: existingPriorityCompanies,
      excludeCompanies: uniqueStringList([...splitListField(careerDiscoveryExclusions), ...careerDiscoveryExcludedCompaniesFromJobs(records)], 120)
    };
  }

  function applyCareerDiscoveryProfileToForm(profile: CareerDiscoveryProfile): void {
    careerDiscoveryEnabled = profile.enabled;
    careerAutoMarkAppliedFromEvidence = profile.autoMarkAppliedFromEvidence;
    careerDiscoveryMaxPowerSearch = profile.maxPowerSearch;
    careerDiscoveryResearchIntensity = profile.researchIntensity;
    careerDiscoveryBackground = profile.background;
    careerDiscoveryGraduationStatus = profile.graduationStatus;
    careerDiscoveryStartWindow = profile.targetStartWindow;
    careerDiscoveryRoles = profile.targetRoles.join('\n');
    careerDiscoveryLocations = profile.locations.join('\n');
    careerDiscoveryPriorityCompanies = profile.priorityCompanies.join('\n');
    careerDiscoveryExclusions = profile.excludeCompanies.join('\n');
  }

  function normalizeCareerDiscoveryProfile(value: unknown): CareerDiscoveryProfile {
    const configured = Boolean(value && typeof value === 'object' && !Array.isArray(value));
    const record = configured ? (value as Partial<CareerDiscoveryProfile>) : {};
    return {
      enabled: configured ? record.enabled !== false : false,
      autoMarkAppliedFromEvidence: record.autoMarkAppliedFromEvidence !== false,
      maxPowerSearch: record.maxPowerSearch === true,
      researchIntensity:
        record.researchIntensity === 'focused' || record.researchIntensity === 'broad' || record.researchIntensity === 'max'
          ? record.researchIntensity
          : 'max',
      background: typeof record.background === 'string' ? record.background : defaultCareerDiscoveryBackground,
      graduationStatus: typeof record.graduationStatus === 'string' ? record.graduationStatus : defaultCareerDiscoveryGraduationStatus,
      targetStartWindow: typeof record.targetStartWindow === 'string' && record.targetStartWindow.trim() ? record.targetStartWindow : defaultCareerDiscoveryStartWindow,
      targetRoles: Array.isArray(record.targetRoles) ? record.targetRoles.map(String).filter(Boolean) : defaultCareerDiscoveryRoles,
      locations: Array.isArray(record.locations) ? record.locations.map(String).filter(Boolean) : defaultCareerDiscoveryLocations,
      priorityCompanies: Array.isArray(record.priorityCompanies) ? record.priorityCompanies.map(String).filter(Boolean) : [],
      excludeCompanies: Array.isArray(record.excludeCompanies) ? record.excludeCompanies.map(String).filter(Boolean) : []
    };
  }

  function hydrateCareerDiscoveryProfile(value: unknown): void {
    const profile = normalizeCareerDiscoveryProfile(value);
    applyCareerDiscoveryProfileToForm(profile);
    careerProfileHydrated = true;
  }

  function currentCareerDiscoveryProfile(): CareerDiscoveryProfile {
    return {
      enabled: careerDiscoveryEnabled,
      autoMarkAppliedFromEvidence: careerAutoMarkAppliedFromEvidence,
      maxPowerSearch: careerDiscoveryMaxPowerSearch,
      researchIntensity: careerDiscoveryResearchIntensity,
      background: careerDiscoveryBackground.trim(),
      graduationStatus: careerDiscoveryGraduationStatus.trim(),
      targetStartWindow: careerDiscoveryStartWindow.trim() || defaultCareerDiscoveryStartWindow,
      targetRoles: splitListField(careerDiscoveryRoles),
      locations: splitListField(careerDiscoveryLocations),
      priorityCompanies: splitListField(careerDiscoveryPriorityCompanies),
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

  function careerDiscoveryProfileTitle(state: Pick<CareerControlState, 'canSave' | 'careerProfileSaving' | 'careerDiscoverySetupBusy'>): string {
    if (!state.canSave) return 'Offline read-only: start or connect the Mini Hub API before saving Career Discovery settings.';
    if (state.careerProfileSaving || state.careerDiscoverySetupBusy) return 'Career Discovery profile is already saving.';
    return 'Save Career Discovery filters for passive role research and dedupe.';
  }

  function careerDiscoverySetupTitle(state: CareerControlState): string {
    if (!state.canSave) return 'Start or connect the local Mini Hub API before enabling Max Scout.';
    if (state.careerProfileSaving || state.careerDiscoverySetupBusy) return 'Max Scout setup is already running.';
    return 'Save the default Max Scout profile, enable passive discovery, and run the research monitor now.';
  }

  function careerDiscoveryMaxPowerTitle(state: CareerControlState): string {
    if (!state.canSave) return 'Start or connect the local Mini Hub API before starting Max Power Search.';
    if (state.careerProfileSaving || state.careerDiscoverySetupBusy) return 'Career Discovery setup is already running.';
    return 'Turn on continuous heavy Career Discovery: heavy passive budget, max runs per tick, local-first AI, and a short repeated research cadence while local services are running.';
  }

  function runDiscoveryNowTitle(row: CareerAutomationRow | undefined): string {
    if (!row) return 'Passive Tasks snapshot has not loaded the Career Discovery task yet.';
    if (!careerDiscoveryReadiness.configured) return 'Enable Max Scout before running broad Career Discovery.';
    return careerAutomationRunTitle(row);
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

  function daysSince(value?: string): number {
    const parsed = Date.parse(value ?? '');
    if (!Number.isFinite(parsed)) return Number.POSITIVE_INFINITY;
    return Math.max(0, Math.floor((Date.now() - parsed) / 86_400_000));
  }

  function dueOrStale(job: JobRecord, staleDays: number): boolean {
    const nextAction = Date.parse(job.nextActionAt ?? '');
    if (Number.isFinite(nextAction)) return nextAction <= Date.now();
    return daysSince(job.updatedAt) >= staleDays;
  }

  function roleFamily(role: string): string {
    const text = role.toLowerCase();
    if (/\b(quant|trading|investment|finance|risk|portfolio)\b/u.test(text)) return 'Quant/finance';
    if (/\b(data|analytics?|analyst|gtm|business intelligence|bi)\b/u.test(text)) return 'Data/analytics';
    if (/\b(ai|machine learning|ml|software|engineer|developer|automation|technical)\b/u.test(text)) return 'Technical/AI';
    if (/\b(product|operations|strategy)\b/u.test(text)) return 'Product/ops';
    return 'Other';
  }

  function topRoleFamilies(records: JobRecord[]): string {
    const counts = new Map<string, number>();
    for (const job of records) counts.set(roleFamily(job.role), (counts.get(roleFamily(job.role)) ?? 0) + 1);
    return Array.from(counts.entries())
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 3)
      .map(([label, count]) => `${label} ${count}`)
      .join(' / ');
  }

  function plural(count: number, one: string, many = `${one}s`): string {
    return `${count} ${count === 1 ? one : many}`;
  }

  function buildCareerStrategySummary(records: JobRecord[], actions: CareerActionRecord[]): CareerStrategySummary {
    const active = records.filter((job) => !['archived', 'rejected'].includes(job.status));
    const discovered = records.filter(isDiscoveredCareerLead);
    const submitted = records.filter(isSubmittedApplication);
    const interviews = records.filter((job) => job.status === 'interview');
    const offers = records.filter((job) => job.status === 'offer');
    const recentRejections = records.filter((job) => job.status === 'rejected' && daysSince(job.updatedAt) <= 30);
    const staleLeads = records.filter((job) => ['lead', 'saved', 'watching'].includes(job.status) && dueOrStale(job, 21));
    const quietSubmitted = submitted.filter((job) => ['applied', 'interview', 'offer'].includes(job.status) && dueOrStale(job, job.status === 'applied' ? 14 : 7));
    const highFitLeads = records.filter((job) => ['lead', 'saved', 'watching'].includes(job.status) && (job.fitScore ?? 0) >= 82);
    const open = actions.filter((action) => !action.completedAt);
    const overdueActions = open.filter((action) => {
      const due = Date.parse(action.dueAt ?? '');
      return Number.isFinite(due) && due <= Date.now();
    });
    const nextAction = overdueActions.length
      ? `${plural(overdueActions.length, 'overdue action')}`
      : interviews.length
        ? `Prep ${plural(interviews.length, 'interview')}`
        : offers.length
          ? `Review ${plural(offers.length, 'offer')}`
          : highFitLeads.length
            ? `Review ${plural(highFitLeads.length, 'high-fit lead')}`
            : staleLeads.length || quietSubmitted.length
              ? 'Refresh stale pipeline'
              : 'Pipeline steady';
    return {
      headline: `${plural(active.length, 'active job')} / ${plural(discovered.length, 'discovered lead')} / ${plural(open.length, 'open action')}`,
      nextAction,
      pipelineLine: `${plural(submitted.length, 'submitted application')} / ${plural(highFitLeads.length, 'high-fit lead')}`,
      riskLine: `${plural(staleLeads.length, 'stale lead')} / ${plural(quietSubmitted.length, 'quiet submitted record')}`,
      roleLine: topRoleFamilies(active) || 'No active role mix yet',
      recentLine: `${plural(interviews.length, 'interview')} / ${plural(offers.length, 'offer')} / ${plural(recentRejections.length, 'recent rejection')}`
    };
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

  function applyQueueDueBoost(job: JobRecord): number {
    const due = Date.parse(job.nextActionAt ?? '');
    if (!Number.isFinite(due)) return 0;
    const daysUntil = Math.floor((due - Date.now()) / 86_400_000);
    if (daysUntil < 0) return 14;
    if (daysUntil <= 3) return 10;
    if (daysUntil <= 7) return 6;
    return 0;
  }

  function applyQueueSourceBoost(job: JobRecord): number {
    const metadata = discoveryMetadataFromNotes(job.notes);
    if (metadata.sourceQuality === 'direct-career-page') return 8;
    if (metadata.sourceQuality === 'ats-posting') return 6;
    if (metadata.sourceQuality === 'job-board') return -4;
    if (metadata.sourceQuality === 'unclear') return -6;
    return 0;
  }

  function applyQueueTimingBoost(job: JobRecord): number {
    const metadata = discoveryMetadataFromNotes(job.notes);
    if (metadata.timingConfidence === 'high') return 10;
    if (metadata.timingConfidence === 'medium') return 5;
    if (metadata.timingConfidence === 'low') return -3;
    return 0;
  }

  function applyQueueScore(job: JobRecord): number {
    const baseFit = typeof job.fitScore === 'number' ? job.fitScore : 50;
    const statusBoost = job.status === 'saved' ? 8 : job.status === 'watching' ? 4 : 0;
    const score = baseFit + statusBoost + applyQueueDueBoost(job) + applyQueueSourceBoost(job) + applyQueueTimingBoost(job);
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  function compareApplyQueueJobs(left: JobRecord, right: JobRecord): number {
    const leftScore = applyQueueScore(left);
    const rightScore = applyQueueScore(right);
    if (leftScore !== rightScore) return rightScore - leftScore;
    return compareCareerJobs(left, right);
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

  function discoveryMetadataFromNotes(notes: string): CareerDiscoveryLeadMetadata {
    const match = notes.match(/^Discovery metadata:\s*(\{.+\})\s*$/imu);
    if (!match?.[1]) return {};
    try {
      const parsed = JSON.parse(match[1]) as unknown;
      const record = plainRecord(parsed);
      const metadata: CareerDiscoveryLeadMetadata = {};
      if (typeof record.sourceQuality === 'string') metadata.sourceQuality = record.sourceQuality;
      if (typeof record.timingConfidence === 'string') metadata.timingConfidence = record.timingConfidence;
      if (typeof record.deadlineConfidence === 'string') metadata.deadlineConfidence = record.deadlineConfidence;
      if (typeof record.postingDate === 'string') metadata.postingDate = record.postingDate;
      if (typeof record.duplicateStatus === 'string') metadata.duplicateStatus = record.duplicateStatus;
      return metadata;
    } catch {
      return {};
    }
  }

  function discoveryQualityLabel(value?: string): string {
    if (value === 'direct-career-page') return 'direct source';
    if (value === 'ats-posting') return 'ATS';
    if (value === 'job-board') return 'job board';
    if (value === 'unclear') return 'unclear source';
    return '';
  }

  function discoveredLeadQualityMeta(job: JobRecord): string {
    const metadata = discoveryMetadataFromNotes(job.notes);
    return [
      discoveryQualityLabel(metadata.sourceQuality),
      metadata.timingConfidence ? `timing ${metadata.timingConfidence}` : '',
      metadata.deadlineConfidence ? `deadline ${metadata.deadlineConfidence}` : '',
      metadata.postingDate ? `posted ${metadata.postingDate}` : '',
      metadata.duplicateStatus && metadata.duplicateStatus !== 'new-source' ? metadata.duplicateStatus.replaceAll('-', ' ') : ''
    ]
      .filter(Boolean)
      .join(' / ');
  }

  function discoveredLeadMeta(job: JobRecord): string {
    const quality = discoveredLeadQualityMeta(job);
    return [quality, job.nextActionAt ? `Review ${displayDate(job.nextActionAt)}` : 'No review date']
      .filter(Boolean)
      .join(' - ');
  }

  function discoveredLeadTitle(job: JobRecord): string {
    const quality = discoveredLeadQualityMeta(job);
    return [`Review discovered lead: ${job.role} at ${job.company}.`, quality ? `Discovery signals: ${quality}.` : 'No structured discovery metadata yet.']
      .filter(Boolean)
      .join(' ');
  }

  function applyQueueUrgency(job: JobRecord): string {
    const score = applyQueueScore(job);
    const due = Date.parse(job.nextActionAt ?? '');
    if (Number.isFinite(due) && due <= Date.now()) return 'due now';
    if (score >= 90) return 'apply first';
    if (score >= 82) return 'strong fit';
    if (job.status === 'watching') return 'watch';
    return 'review';
  }

  function applyQueueReason(job: JobRecord): string {
    const metadata = discoveryMetadataFromNotes(job.notes);
    const reasons = [
      typeof job.fitScore === 'number' ? `fit ${job.fitScore}` : 'unranked fit',
      job.status,
      metadata.timingConfidence ? `${metadata.timingConfidence} timing` : '',
      discoveryQualityLabel(metadata.sourceQuality),
      metadata.deadlineConfidence && metadata.deadlineConfidence !== 'unknown' ? `${metadata.deadlineConfidence} deadline` : '',
      job.nextActionAt ? `next ${displayDate(job.nextActionAt)}` : ''
    ].filter(Boolean);
    return reasons.join(' / ');
  }

  function applicationAngle(job: JobRecord): string {
    const text = `${job.role} ${job.notes}`.toLowerCase();
    if (/\b(quant|trading|investment|finance|risk|portfolio)\b/u.test(text)) {
      return 'Angle: math, probability, market curiosity, research discipline.';
    }
    if (/\b(data|analytics?|analyst|gtm|business intelligence|bi)\b/u.test(text)) {
      return 'Angle: analytics projects, SQL/Python, experimental thinking, clear business judgment.';
    }
    if (/\b(ai|machine learning|ml|software|engineer|developer|automation|technical)\b/u.test(text)) {
      return 'Angle: local AI systems, automation, full-stack projects, careful technical writing.';
    }
    if (/\b(product|operations|strategy)\b/u.test(text)) {
      return 'Angle: structured problem solving, user empathy, metrics, execution follow-through.';
    }
    return 'Angle: connect the role to math/CS coursework, projects, and May 2027 availability.';
  }

  function applyQueueItem(job: JobRecord): ApplyQueueItem {
    return {
      job,
      score: applyQueueScore(job),
      reason: applyQueueReason(job),
      angle: applicationAngle(job),
      urgency: applyQueueUrgency(job),
      href: jobApplicationHref(job)
    };
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

  async function persistCareerDiscoveryProfile(profile: CareerDiscoveryProfile, message: string): Promise<boolean> {
    if (!canSave || careerProfileSaving) return false;
    rowError = '';
    saveError = '';
    saveMessage = '';
    careerProfileSaving = true;
    try {
      await clientData.saveSettings({
        preferences: {
          ...($clientData.settings?.preferences ?? {}),
          careerDiscovery: profile
        }
      });
      saveMessage = message;
      applyCareerDiscoveryProfileToForm(profile);
      return true;
    } catch (error) {
      saveError = error instanceof Error ? error.message : 'Career Discovery profile save failed';
      return false;
    } finally {
      careerProfileSaving = false;
    }
  }

  async function saveCareerDiscoveryProfile(): Promise<void> {
    await persistCareerDiscoveryProfile(currentCareerDiscoveryProfile(), 'Saved Career Discovery filters for passive role research.');
  }

  async function enableCareerDiscoveryMode(maxPowerSearch = false): Promise<void> {
    if (!canSave || careerProfileSaving || careerDiscoverySetupBusy) return;
    careerDiscoverySetupBusy = true;
    passiveError = '';
    saveError = '';
    rowError = '';
    saveMessage = '';
    const profile = maxScoutCareerDiscoveryProfile(jobs, maxPowerSearch);
    try {
      const saved = await persistCareerDiscoveryProfile(
        profile,
        maxPowerSearch ? 'Saved Max Power Search profile for continuous heavy Career Discovery.' : 'Saved Max Scout profile for broad Career Discovery.'
      );
      if (!saved) return;
      const enabledSnapshot = await patchPassiveSettings({
        enabled: true,
        idleOnly: false,
        resourceLimit: 'heavy',
        localAiPreference: 'local_first',
        maxRunsPerTick: maxPowerSearch ? 10 : 5,
        enabledFamilies: {
          career_radar: true,
          research_monitor: true
        }
      });
      setPassiveSnapshot(enabledSnapshot);
      const researchRow = buildCareerAutomationRows(enabledSnapshot).find((row) => row.family === 'research_monitor');
      if (researchRow?.taskId && researchRow.active) {
        if (maxPowerSearch) {
          const result = await runCareerScoutMaxPowerSearch();
          setPassiveSnapshot(result.snapshot);
          careerScoutSummary = result.summary;
          await refreshCareerScoutPool(true);
        } else {
          setPassiveSnapshot(
            await runPassiveAutomationTask(researchRow.taskId, {
              manual: true,
              reason: 'career-desk-enable-max-scout'
            })
          );
          await refreshCareerScoutPool(true);
        }
        saveMessage = maxPowerSearch
          ? 'Max Power Search is on. Career Scout ran once and saved findings to the candidate pool while the short heavy cadence remains enabled.'
          : 'Max Scout enabled and Career Discovery ran. Review active topics and any filtered/pooled results above.';
      } else {
        saveMessage = maxPowerSearch
          ? 'Max Power Search profile saved. Passive Tasks is enabled, but the Career Discovery task was not runnable yet.'
          : 'Max Scout profile saved. Passive Tasks is enabled, but the Career Discovery task was not runnable yet.';
      }
    } catch (error) {
      passiveError = error instanceof Error ? error.message : (maxPowerSearch ? 'Max Power Search setup failed' : 'Max Scout setup failed');
    } finally {
      careerDiscoverySetupBusy = false;
    }
  }

  async function enableMaxScout(): Promise<void> {
    await enableCareerDiscoveryMode(false);
  }

  async function enableMaxPowerSearch(): Promise<void> {
    await enableCareerDiscoveryMode(true);
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
    hydratePassiveSnapshotFromCache();
    void clientData.init();
    void refreshSummary();
    void refreshCareerMailUpdates();
    void refreshCareerAutomationSnapshot(true);
    void refreshCareerScoutPool(true);
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

<section class:needs-setup={!careerDiscoveryReadiness.configured} class="card career-discovery-panel" aria-label="Career Discovery scouting status">
  <div class="table-section-title">
    <div>
      <strong>Career Discovery</strong>
      <span>{careerDiscoveryReadiness.status}</span>
    </div>
    <div class="discovery-actions">
      <button class="button primary" type="button" disabled={!canSave || careerProfileSaving || careerDiscoverySetupBusy} title={careerDiscoverySetupTitle(careerControlState)} on:click={enableMaxScout}>
        <Search size={16} />
        <span>{careerDiscoverySetupBusy ? 'Enabling' : careerDiscoveryReadiness.configured ? 'Refresh Max Scout' : 'Enable Max Scout'}</span>
      </button>
      <button class="button max-power" type="button" disabled={!canSave || careerProfileSaving || careerDiscoverySetupBusy} title={careerDiscoveryMaxPowerTitle(careerControlState)} on:click={enableMaxPowerSearch}>
        <Zap size={16} />
        <span>{careerDiscoverySetupBusy && careerDiscoveryMaxPowerSearch ? 'Powering' : 'Max Power Search'}</span>
      </button>
      <button class="button" type="button" disabled={!careerDiscoveryAutomationRow || !careerDiscoveryAutomationRow.active || !careerDiscoveryReadiness.configured || !!passiveBusyFamily || careerDiscoverySetupBusy} title={runDiscoveryNowTitle(careerDiscoveryAutomationRow)} on:click={runCareerDiscoveryNow}>
        <Play size={16} />
        <span>{passiveBusyFamily === 'research_monitor' ? 'Running' : 'Run Discovery Now'}</span>
      </button>
    </div>
  </div>
  <p class="discovery-detail">{careerDiscoveryReadiness.detail}</p>
  <div class="discovery-metrics">
    <div>
      <span>Worker</span>
      <strong>{careerDiscoveryReadiness.workerLine}</strong>
    </div>
    <div>
      <span>Last discovery run</span>
      <strong>{careerDiscoveryReadiness.lastRunAt ? displayAutomationTime(careerDiscoveryReadiness.lastRunAt) : 'Not yet'}</strong>
    </div>
    <div>
      <span>Next discovery run</span>
      <strong>{careerDiscoveryReadiness.nextRunAt ? displayAutomationTime(careerDiscoveryReadiness.nextRunAt) : 'Not scheduled'}</strong>
    </div>
    <div>
      <span>Search mode</span>
      <strong>{careerDiscoveryReadiness.maxPowerSearch ? 'Max power continuous' : 'Normal cadence'}</strong>
    </div>
    <div>
      <span>Latest result</span>
      <strong>{careerDiscoveryReadiness.importedLeads} imported / {careerDiscoveryReadiness.filteredCandidates} filtered</strong>
    </div>
  </div>
  <div class="discovery-reason">
    <strong>Why no new recommendations?</strong>
    <span>{careerDiscoveryReadiness.whyNoRecommendations}</span>
  </div>
  {#if careerDiscoveryReadiness.topics.length || careerDiscoveryReadiness.sourceLanes.length || careerDiscoveryReadiness.companies.length}
    <div class="discovery-chip-groups" aria-label="Active Career Discovery searches">
      <div>
        <span>Topics</span>
        <div>
          {#each careerDiscoveryReadiness.topics.slice(0, 8) as item}
            <small>{item}</small>
          {/each}
        </div>
      </div>
      <div>
        <span>Source lanes</span>
        <div>
          {#each careerDiscoveryReadiness.sourceLanes.slice(0, 8) as item}
            <small>{item}</small>
          {/each}
        </div>
      </div>
      {#if careerDiscoveryReadiness.companies.length}
        <div>
          <span>Companies</span>
          <div>
            {#each careerDiscoveryReadiness.companies.slice(0, 6) as item}
              <small>{item}</small>
            {/each}
          </div>
        </div>
      {/if}
    </div>
  {:else}
    <p class="muted discovery-empty">No active Career Discovery topics or source lanes are saved yet.</p>
  {/if}
</section>

<section class="card career-scout-panel" aria-label="Career Scout candidate pool">
  <div class="table-section-title">
    <div>
      <strong>Career Scout Pool</strong>
      <span>{careerScoutStatusText}</span>
    </div>
    <div class="discovery-actions">
      <button class="button" type="button" disabled={careerScoutLoading} title="Refresh the durable Career Scout candidate pool from the Mini Hub API." on:click={() => refreshCareerScoutPool()}>
        <RefreshCw size={16} />
        <span>{careerScoutLoading ? 'Refreshing' : 'Refresh Pool'}</span>
      </button>
      <button class="button max-power" type="button" disabled={!canSave || careerDiscoverySetupBusy || !!passiveBusyFamily} title={maxPowerButtonTitle(careerScoutControlState)} on:click={enableMaxPowerSearch}>
        <Zap size={16} />
        <span>{careerDiscoverySetupBusy && careerDiscoveryMaxPowerSearch ? 'Powering' : 'Max Power Search'}</span>
      </button>
    </div>
  </div>
  <p class="discovery-detail">
    Wide discovery saves plausible and rejected findings here first. Promote only the clean, reviewed roles into the main Career Desk table.
  </p>
  {#if visibleCareerScoutError}
    <p class="muted career-scout-error">{visibleCareerScoutError}</p>
  {/if}
  <div class="career-scout-grid">
    <div><span>Total pooled</span><strong>{careerScoutSummary.total}</strong></div>
    <div><span>Reviewable</span><strong>{careerScoutSummary.enriched + careerScoutSummary.needsReview + careerScoutSummary.plausible}</strong></div>
    <div><span>Rejected-filtered</span><strong>{careerScoutSummary.rejected}</strong></div>
    <div><span>Promoted</span><strong>{careerScoutSummary.promoted}</strong></div>
  </div>
  {#if actionableCareerScoutCandidates.length}
    <div class="career-scout-list" aria-label="Reviewable Career Scout candidates">
      {#each actionableCareerScoutCandidates as candidate}
        <article class="career-scout-row" title={careerScoutCandidateTitle(candidate)}>
          <div class="career-scout-score">
            <strong>{typeof candidate.fitScore === 'number' ? candidate.fitScore : '--'}</strong>
            <small>{candidate.status.replace('_', ' ')}</small>
          </div>
          <div class="career-scout-main">
            <div>
              <strong>{candidate.company || 'Unknown company'}</strong>
              <span>{candidate.role || candidate.rawTitle || 'Unknown role'}</span>
            </div>
            <p>{careerScoutCandidateSummary(candidate)}</p>
            <small>
              {candidate.location || 'Location unknown'}
              {#if candidate.structured?.applicationDeadline}
                · deadline {candidate.structured.applicationDeadline}
              {/if}
              {#if candidate.modelUsage?.provider}
                · {candidate.modelUsage.provider}
              {/if}
            </small>
          </div>
          <div class="career-scout-actions">
            {#if candidate.applicationUrl || candidate.sourceUrl}
              <a class="button subtle" href={candidate.applicationUrl || candidate.sourceUrl} target="_blank" rel="noreferrer" title="Open the source or application page.">
                <ExternalLink size={16} />
                <span>Open</span>
              </a>
            {/if}
            <button class="button primary" type="button" disabled={!canSave || !!careerScoutBusyId || careerScoutLoading || candidate.status === 'promoted' || !candidate.company.trim() || !candidate.role.trim()} title={careerScoutActionTitle(careerScoutControlState, candidate, 'promote')} on:click={() => promoteCareerScout(candidate)}>
              <Plus size={16} />
              <span>Promote</span>
            </button>
            <button class="button" type="button" disabled={!canSave || !!careerScoutBusyId || careerScoutLoading} title={careerScoutActionTitle(careerScoutControlState, candidate, 'refine')} on:click={() => refineCareerScout(candidate)}>
              <Search size={16} />
              <span>Refine</span>
            </button>
            <button class="button" type="button" disabled={!canSave || !!careerScoutBusyId || careerScoutLoading} title={careerScoutActionTitle(careerScoutControlState, candidate, 'paid-refine')} on:click={() => refineCareerScout(candidate, true)}>
              <Zap size={16} />
              <span>GPT Rank</span>
            </button>
            <button class="button subtle" type="button" disabled={!canSave || !!careerScoutBusyId || careerScoutLoading || candidate.status === 'rejected'} title={careerScoutActionTitle(careerScoutControlState, candidate, 'reject')} on:click={() => rejectCareerScout(candidate)}>
              <X size={16} />
              <span>Not fit</span>
            </button>
          </div>
        </article>
      {/each}
    </div>
  {:else if careerScoutLoading}
    <p class="muted career-scout-empty">Loading the candidate pool...</p>
  {:else}
    <p class="muted career-scout-empty">No reviewable candidates are pooled yet. Run Max Power Search or leave Career Discovery running, and broad findings will appear here before they reach your main table.</p>
  {/if}
  {#if rejectedCareerScoutPreview.length}
    <div class="career-scout-rejected" aria-label="Recently filtered Career Scout candidates">
      <span>Recently filtered</span>
      {#each rejectedCareerScoutPreview as candidate}
        <small>{candidate.company || candidate.rawTitle || 'Unknown'} · {candidate.rejectionReason || 'filtered'}</small>
      {/each}
    </div>
  {/if}
</section>

<section class="card career-strategy-panel" aria-label="Career strategy review">
  <div class="table-section-title">
    <div>
      <strong>Strategy Review</strong>
      <span>{careerStrategy.headline}</span>
    </div>
  </div>
  <div class="strategy-grid">
    <div>
      <span>Next focus</span>
      <strong>{careerStrategy.nextAction}</strong>
      <small>{careerStrategy.riskLine}</small>
    </div>
    <div>
      <span>Pipeline</span>
      <strong>{careerStrategy.pipelineLine}</strong>
      <small>{careerStrategy.recentLine}</small>
    </div>
    <div>
      <span>Role mix</span>
      <strong>{careerStrategy.roleLine}</strong>
      <small>Based on active Career Desk rows.</small>
    </div>
  </div>
</section>

<section class="card apply-queue-panel" aria-label="Career apply queue">
  <div class="table-section-title">
    <div>
      <strong>Apply Queue</strong>
      <span>{applyQueue.length} lead{applyQueue.length === 1 ? '' : 's'} ranked by fit, timing, source, and urgency</span>
    </div>
  </div>
  {#if topApplyQueue.length}
    <div class="apply-queue-list">
      {#each topApplyQueue as item (item.job.id)}
        <article class="apply-queue-row">
          <div class="apply-score">
            <strong>{item.score}</strong>
            <small>{item.urgency}</small>
          </div>
          <div class="apply-main">
            <div>
              <strong>{item.job.company}</strong>
              <span>{item.job.role}</span>
            </div>
            <small>{item.reason}</small>
            <small>{item.angle}</small>
          </div>
          <div class="row-actions apply-row-actions">
            {#if item.href}
              <a class="row-command" href={item.href} target="_blank" rel="noreferrer" title={`Open application source for ${item.job.role} at ${item.job.company}.`}>
                <ExternalLink size={14} />
                <span>Open</span>
              </a>
            {/if}
            {#if canReviewDiscoveredLead(item.job)}
              <button class="row-command" type="button" disabled={!canReviewDiscoveredLead(item.job)} title={discoveredLeadReviewTitle(careerControlState, item.job, 'save')} on:click={() => reviewDiscoveredLead(item.job, 'save')}>
                <Save size={14} />
                <span>Save</span>
              </button>
              <button class="row-command" type="button" disabled={!canReviewDiscoveredLead(item.job)} title={discoveredLeadReviewTitle(careerControlState, item.job, 'watch')} on:click={() => reviewDiscoveredLead(item.job, 'watch')}>
                <Search size={14} />
                <span>Watch</span>
              </button>
            {/if}
            <button class="row-command" type="button" aria-label={`Mark ${item.job.company} applied`} title={markAppliedTitle(careerControlState, item.job)} disabled={!canMarkJobApplied(item.job)} on:click={() => markJobApplied(item.job)}>
              <CheckCircle2 size={14} />
              <span>Applied</span>
            </button>
          </div>
        </article>
      {/each}
    </div>
  {:else}
    <p class="muted apply-queue-empty">No active leads are ready for the apply queue. Run Career Discovery or add a lead manually.</p>
  {/if}
</section>

<section class="card career-automation-panel" aria-label="Career automation status">
  <div class="table-section-title">
    <div>
      <strong>Career Automation</strong>
      <span>{careerAutomationStatusText}{passiveCachedAt ? ` - cached ${displayAutomationTime(passiveCachedAt)}` : ''}</span>
    </div>
    <button class="row-command" type="button" disabled={passiveLoading || !!passiveBusyFamily} title="Refresh real Passive Tasks status for Career Radar and Career Discovery." on:click={() => refreshCareerAutomationSnapshot()}>
      <RefreshCw size={14} />
      <span>{passiveLoading ? 'Checking' : 'Refresh'}</span>
    </button>
  </div>
  {#if passiveError}
    <p class="muted automation-message" title={`Raw Career automation error: ${passiveError}`}>{visiblePassiveError}</p>
  {/if}
  <div class="automation-grid">
    {#each careerAutomationRows as row}
      <article class:inactive={!row.active} class="automation-row">
        <div>
          <strong>{row.label}</strong>
          <small>{row.active ? 'Active' : row.taskStatus} - source {row.sourceStatus} - next {displayAutomationTime(row.nextRunAt)}</small>
          <span>{row.summary}</span>
          {#if row.error}
            <small title={`Raw ${row.label} error: ${row.error}`}>{compactCareerDeskIssue(row.error, row.label)}</small>
          {/if}
        </div>
        <div class="automation-actions">
          <small>{row.lastRunAt ? `${row.lastRunStatus ?? 'run'} ${displayAutomationTime(row.lastRunAt)}` : 'No run yet'}</small>
          <button class="row-command" type="button" disabled={!row.taskId || !row.active || !!passiveBusyFamily} title={careerAutomationRunTitle(row)} on:click={() => runCareerAutomation(row)}>
            <Play size={14} />
            <span>{passiveBusyFamily === row.family ? 'Running' : 'Run'}</span>
          </button>
        </div>
      </article>
    {/each}
  </div>
  {#if careerAutomationCards.length}
    <div class="automation-card-list" aria-label="Recent Career automation results">
      {#each careerAutomationCards as card}
        <a href={hubHref(card.route)} title={card.why || `Open ${card.title}.`}>
          <strong>{card.title}</strong>
          <small>{card.summary}</small>
        </a>
      {/each}
    </div>
  {:else}
    <p class="muted automation-message">No Career automation cards yet. Run Career Radar or wait for scheduled discovery to create source-backed records.</p>
  {/if}
  <div class="automation-learning" aria-label="Career Discovery learning summary">
    <div>
      <strong>Discovery learning</strong>
      <small>{careerDiscoveryLearning.status}</small>
    </div>
    <div>
      <span>{careerDiscoveryLearning.seenRegistrySize} seen leads / {careerDiscoveryLearning.seenFinalDecisions} final decisions</span>
      <span>{careerDiscoveryLearning.rememberedFilters} remembered this run</span>
      <span>{careerDiscoveryLearning.skippedReasonSummary || 'No skip reasons yet'}</span>
      <span>{careerDiscoveryLearning.latestRunAt ? `Latest ${displayAutomationTime(careerDiscoveryLearning.latestRunAt)}` : 'No discovery run yet'}</span>
    </div>
  </div>
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
          <a class="discovered-lead-main" href={jobApplicationHref(job) || '#job-search'} target={jobApplicationHref(job) ? '_blank' : undefined} rel={jobApplicationHref(job) ? 'noreferrer' : undefined} title={discoveredLeadTitle(job)}>
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
      <label class="check-row">
        <input type="checkbox" bind:checked={careerDiscoveryMaxPowerSearch} disabled={!canSave || careerProfileSaving} title={careerDiscoveryProfileTitle(careerControlState)} />
        <span>Keep Max Power Search on: heavy local-first budget and repeated short-cadence research sweeps</span>
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
      <div class="field">
        <label for="career-priority-companies">Priority companies</label>
        <textarea id="career-priority-companies" aria-label="Career priority companies" bind:value={careerDiscoveryPriorityCompanies} disabled={!canSave || careerProfileSaving} title={careerDiscoveryProfileTitle(careerControlState)} rows="4" placeholder="Companies to watch closely, one per line"></textarea>
      </div>
      <div class="field wide">
        <label for="career-exclusions">Extra exclusions</label>
        <textarea id="career-exclusions" aria-label="Career excluded companies" bind:value={careerDiscoveryExclusions} disabled={!canSave || careerProfileSaving} title={careerDiscoveryProfileTitle(careerControlState)} rows="2" placeholder="Companies or sources to avoid, one per line"></textarea>
      </div>
      <div class="profile-hints wide">
        <small>Graduation guard: B.S. May 2026, M.S. expected May 2027, target May/Summer 2027 starts.</small>
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

  .career-discovery-panel {
    margin-bottom: 12px;
    overflow: hidden;
  }

  .career-discovery-panel.needs-setup {
    border-color: var(--warning-border);
  }

  .career-discovery-panel .table-section-title {
    align-items: start;
  }

  .career-discovery-panel .table-section-title > div:first-child {
    display: grid;
    gap: 3px;
    min-width: 0;
  }

  .discovery-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
  }

  .button.max-power {
    border-color: color-mix(in srgb, var(--accent) 48%, var(--border-strong));
    color: var(--accent-strong);
    background: color-mix(in srgb, var(--accent) 12%, var(--surface));
  }

  .discovery-detail,
  .discovery-empty {
    margin: 0;
    padding: 10px 14px;
    border-top: 1px solid var(--border);
    color: var(--muted);
  }

  .discovery-metrics {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    border-top: 1px solid var(--border);
  }

  .discovery-metrics div {
    display: grid;
    gap: 3px;
    padding: 9px 11px;
    border-right: 1px solid var(--border);
  }

  .discovery-metrics div:last-child {
    border-right: 0;
  }

  .discovery-metrics span,
  .discovery-chip-groups > div > span {
    color: var(--muted);
    font-size: 12px;
    font-weight: 750;
  }

  .discovery-metrics strong {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .discovery-reason {
    display: flex;
    gap: 8px;
    padding: 10px 14px;
    border-top: 1px solid var(--border);
    background: var(--surface-muted);
  }

  .discovery-reason span {
    color: var(--muted);
  }

  .discovery-chip-groups {
    display: grid;
    gap: 9px;
    padding: 10px 14px;
    border-top: 1px solid var(--border);
  }

  .discovery-chip-groups > div {
    display: grid;
    gap: 6px;
  }

  .discovery-chip-groups > div > div {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .discovery-chip-groups small {
    padding: 3px 7px;
    border: 1px solid var(--border);
    border-radius: 999px;
    color: var(--text-soft);
    background: var(--surface-muted);
    font-size: 12px;
  }

  .career-scout-panel {
    margin-bottom: 12px;
    overflow: hidden;
  }

  .career-scout-error,
  .career-scout-empty {
    padding: 0 14px 12px;
    margin: 0;
  }

  .career-scout-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    border-top: 1px solid var(--border);
  }

  .career-scout-grid div {
    display: grid;
    gap: 4px;
    padding: 10px 14px;
    border-right: 1px solid var(--border);
  }

  .career-scout-grid div:last-child {
    border-right: 0;
  }

  .career-scout-grid span,
  .career-scout-main p,
  .career-scout-main small,
  .career-scout-score small,
  .career-scout-rejected {
    color: var(--muted);
    font-size: 12px;
  }

  .career-scout-list {
    display: grid;
    border-top: 1px solid var(--border);
  }

  .career-scout-row {
    display: grid;
    grid-template-columns: 64px minmax(0, 1fr) auto;
    gap: 12px;
    align-items: center;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
  }

  .career-scout-row:last-child {
    border-bottom: 0;
  }

  .career-scout-row:hover {
    background: var(--active);
  }

  .career-scout-score {
    display: grid;
    gap: 2px;
    min-width: 0;
  }

  .career-scout-score strong {
    font-size: 20px;
    line-height: 1;
  }

  .career-scout-main {
    display: grid;
    gap: 4px;
    min-width: 0;
  }

  .career-scout-main div {
    display: grid;
    grid-template-columns: minmax(100px, 0.34fr) minmax(0, 1fr);
    gap: 10px;
    min-width: 0;
  }

  .career-scout-main strong,
  .career-scout-main span,
  .career-scout-main p,
  .career-scout-main small {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .career-scout-main p {
    margin: 0;
  }

  .career-scout-actions {
    display: flex;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: 7px;
  }

  .career-scout-rejected {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
    padding: 10px 14px;
    border-top: 1px solid var(--border);
  }

  .career-scout-rejected span {
    color: var(--text-soft);
    font-weight: 750;
  }

  .career-scout-rejected small {
    padding: 3px 7px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--surface-muted);
  }

  .career-strategy-panel {
    margin-bottom: 12px;
    overflow: hidden;
  }

  .career-strategy-panel .table-section-title {
    align-items: start;
  }

  .strategy-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    border-top: 1px solid var(--border);
  }

  .strategy-grid div {
    display: grid;
    gap: 4px;
    padding: 10px 14px;
    border-right: 1px solid var(--border);
  }

  .strategy-grid div:last-child {
    border-right: 0;
  }

  .strategy-grid span,
  .strategy-grid small {
    color: var(--muted);
    font-size: 12px;
  }

  .strategy-grid strong {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .apply-queue-panel {
    margin-bottom: 12px;
    overflow: hidden;
  }

  .apply-queue-list {
    display: grid;
  }

  .apply-queue-row {
    display: grid;
    grid-template-columns: 72px minmax(0, 1fr) auto;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    border-top: 1px solid var(--border);
  }

  .apply-queue-row:hover {
    background: var(--active);
  }

  .apply-score {
    display: grid;
    gap: 2px;
  }

  .apply-score strong {
    font-size: 20px;
    line-height: 1;
  }

  .apply-score small,
  .apply-main small {
    color: var(--muted);
    font-size: 12px;
  }

  .apply-main {
    display: grid;
    gap: 4px;
    min-width: 0;
  }

  .apply-main div {
    display: grid;
    grid-template-columns: minmax(100px, 0.4fr) minmax(0, 1fr);
    gap: 10px;
    min-width: 0;
  }

  .apply-main strong,
  .apply-main span,
  .apply-main small {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .apply-main span {
    color: var(--text-soft);
    font-weight: 750;
  }

  .apply-row-actions {
    justify-content: flex-end;
  }

  .apply-queue-empty {
    margin: 0;
    padding: 12px 14px;
  }

  .mail-updates-panel {
    margin-bottom: 12px;
    overflow: hidden;
  }

  .career-automation-panel {
    margin-bottom: 12px;
    overflow: hidden;
  }

  .career-automation-panel .table-section-title {
    align-items: start;
  }

  .career-automation-panel .table-section-title > div {
    display: grid;
    gap: 3px;
    min-width: 0;
  }

  .automation-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    border-bottom: 1px solid var(--border);
  }

  .automation-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 12px;
    padding: 11px 14px;
    border-top: 1px solid var(--border);
  }

  .automation-row:first-child {
    border-right: 1px solid var(--border);
  }

  .automation-row.inactive {
    background: var(--surface-muted);
  }

  .automation-row > div:first-child {
    display: grid;
    gap: 4px;
    min-width: 0;
  }

  .automation-row strong,
  .automation-row span,
  .automation-row small {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .automation-row span {
    color: var(--text);
    font-weight: 750;
  }

  .automation-row small,
  .automation-message,
  .automation-card-list small {
    color: var(--muted);
  }

  .automation-actions {
    display: grid;
    justify-items: end;
    gap: 6px;
  }

  .automation-card-list {
    display: grid;
  }

  .automation-card-list a {
    display: grid;
    gap: 3px;
    padding: 9px 14px;
    border-top: 1px solid var(--border);
    color: var(--text);
    text-decoration: none;
  }

  .automation-card-list a:hover {
    background: var(--active);
  }

  .automation-card-list strong,
  .automation-card-list small {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .automation-message {
    margin: 0;
    padding: 11px 14px;
  }

  .automation-learning {
    display: grid;
    grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr);
    gap: 10px;
    padding: 10px 14px;
    border-top: 1px solid var(--border);
    background: var(--surface-muted);
  }

  .automation-learning > div {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 12px;
    min-width: 0;
  }

  .automation-learning strong,
  .automation-learning small,
  .automation-learning span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .automation-learning small,
  .automation-learning span {
    color: var(--muted);
    font-size: 12px;
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
    .focus-strip,
    .strategy-grid,
    .discovery-metrics,
    .career-scout-grid {
      grid-template-columns: 1fr;
    }

    .focus-strip div,
    .strategy-grid div,
    .discovery-metrics div,
    .career-scout-grid div {
      border-right: 0;
      border-bottom: 1px solid var(--border);
    }

    .focus-strip div:last-child,
    .strategy-grid div:last-child,
    .discovery-metrics div:last-child,
    .career-scout-grid div:last-child {
      border-bottom: 0;
    }

    .automation-grid,
    .automation-row,
    .automation-learning {
      grid-template-columns: 1fr;
    }

    .apply-queue-row {
      grid-template-columns: 1fr;
      align-items: start;
    }

    .career-scout-row {
      grid-template-columns: 1fr;
      align-items: start;
    }

    .career-scout-main div {
      grid-template-columns: 1fr;
      gap: 2px;
    }

    .career-scout-actions {
      justify-content: flex-start;
    }

    .apply-main div {
      grid-template-columns: 1fr;
      gap: 2px;
    }

    .apply-row-actions {
      justify-content: start;
    }

    .automation-row:first-child {
      border-right: 0;
    }

    .automation-actions {
      justify-items: start;
    }

    .discovery-actions,
    .discovery-reason {
      justify-content: start;
    }

    .discovery-reason {
      display: grid;
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
