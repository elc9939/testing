<script lang="ts">
  import { onMount } from 'svelte';
  import { CalendarDays, Edit3, Flame, Plus, RefreshCw, Save, Search, Trash2, X } from 'lucide-svelte';
  import type { CareerActionRecord, StudySession } from '@mini-hub/core';
  import type { LegacyImportSummary } from '@mini-hub/db/migration';
  import { getBrowserStorage } from '$lib/browser-storage';
  import { canAutoSave, clientData } from '$lib/client-data';

  interface StudyDraft {
    subject: string;
    minutes: number;
  }

  interface StudyViewState {
    searchQuery: string;
    subject: string;
    minutes: number;
  }

  interface LegacyImportState {
    importedAt?: string;
    jobs?: number;
    studySessions?: number;
    careerActions?: number;
    studyDays?: number;
    studyCareerActions?: number;
  }

  interface LegacyTopicRow {
    track: string;
    done: number;
    total: number;
    next: string;
    updatedAt: string;
  }

  interface LegacyDailyRow {
    date: string;
    careerActions: number;
    neetcodeNew: number;
    neetcodeSubmissions: number;
    note: string;
  }

  interface LegacyGithubSummary {
    repo: string;
    lastSync: string;
    submissions: number;
    problems: number;
    newPaths: number;
    status: string;
  }

  interface DailyProgress {
    date: string;
    neetcodeNew: number;
    neetcodeSubmissions: number;
    minutes: number;
    active: boolean;
    intensity: number;
  }

  interface StudyControlState {
    canSave: boolean;
    saving: boolean;
    rowBusyId: string;
    editingSessionId: string;
    studySummaryLoading: boolean;
  }

  let summary: LegacyImportSummary | null = null;
  let subject = 'NeetCode';
  let minutes = 30;
  let searchQuery = '';
  let saveError = '';
  let rowError = '';
  let saveMessage = '';
  let viewStatus = 'Loading saved Study view.';
  let viewHydrated = false;
  let saving = false;
  let studySummaryLoading = false;
  let rowBusyId = '';
  let editingSessionId = '';
  let studyDraft: StudyDraft = emptyStudyDraft();
  const studyViewStorageKey = 'miniHub.study.view.v1';
  const quickSubjects = ['NeetCode', 'Review', 'Math', 'Project'];
  const quickMinutes = [15, 30, 45, 60];

  $: canSave = canAutoSave($clientData);
  $: logs = $clientData.studySessions;
  $: careerActions = $clientData.careerActions;
  $: filteredLogs = logs.filter(matchesLog);
  $: filteredCareerActions = careerActions.filter(matchesCareerAction).slice(0, 12);
  $: totalMinutes = logs.reduce((sum, item) => sum + item.minutes, 0);
  $: todayMinutes = logs.filter((item) => isToday(item.loggedAt)).reduce((sum, item) => sum + item.minutes, 0);
  $: weekMinutes = logs.filter((item) => isThisWeek(item.loggedAt)).reduce((sum, item) => sum + item.minutes, 0);
  $: importedLegacy = (($clientData.settings?.recentState?.legacyImport ?? null) as LegacyImportState | null);
  $: legacyLinkedState = (($clientData.settings?.recentState?.legacyLinkedState ??
    $clientData.settings?.preferences?.legacyLinkedState ??
    null) as Record<string, unknown> | null);
  $: legacyStudyState = asRecord(legacyLinkedState?.studyDesk);
  $: legacyStudySettings = asRecord(legacyStudyState?.settings);
  $: legacyStudyTopics = asRecord(legacyStudyState?.topics);
  $: legacyStudyDaily = asRecord(legacyStudyState?.daily);
  $: legacyGithub = summarizeLegacyGithub(asRecord(legacyStudyState?.github));
  $: legacyTopicRows = buildLegacyTopicRows(legacyStudyTopics);
  $: legacyDailyRows = buildLegacyDailyRows(legacyStudyDaily);
  $: progressDays = buildProgressDays(legacyStudyDaily, logs);
  $: currentStreak = calculateStreak(progressDays);
  $: activeProgressDays = progressDays.filter((day) => day.active).length;
  $: neetcodeSubmissions = progressDays.reduce((sum, day) => sum + day.neetcodeSubmissions, 0);
  $: neetcodeNewProblems = progressDays.reduce((sum, day) => sum + day.neetcodeNew, 0);
  $: hasLegacyStudyState = Boolean(
    legacyStudyState &&
      (Object.keys(legacyStudySettings ?? {}).length ||
        legacyTopicRows.length ||
        legacyDailyRows.length ||
        legacyGithub.problems ||
        legacyGithub.submissions ||
        legacyGithub.lastSync)
  );
  $: studyControlState = {
    canSave,
    saving,
    rowBusyId,
    editingSessionId,
    studySummaryLoading
  };
  $: addLogButtonTitle = addLogTitle(studyControlState, subject, Number(minutes));
  $: saveLogEditButtonTitle = saveLogEditTitle(studyControlState, studyDraft);
  $: studySummaryButtonTitle = studySummaryTitle(studyControlState);
  $: if (viewHydrated) persistStudyViewState(searchQuery, subject, Number(minutes));

  function studySaveTitle(state: Pick<StudyControlState, 'canSave' | 'saving'>, enabledTitle: string): string {
    if (!state.canSave) return 'Offline read-only: start or connect the Mini Hub API before saving Study changes.';
    if (state.saving) return 'A Study save is already running.';
    return enabledTitle;
  }

  function addLogTitle(state: Pick<StudyControlState, 'canSave' | 'saving'>, nextSubject: string, nextMinutes: number): string {
    if (!state.canSave || state.saving) return studySaveTitle(state, 'Log this study session.');
    if (!nextSubject.trim()) return 'Add a study label before logging progress.';
    if (nextMinutes < 1) return 'Minutes must be at least 1 before logging progress.';
    return 'Log this study session.';
  }

  function studyRowTitle(state: Pick<StudyControlState, 'canSave' | 'rowBusyId' | 'editingSessionId'>, enabledTitle: string, rowId?: string): string {
    if (!state.canSave) return 'Offline read-only: start or connect the Mini Hub API before changing Study logs.';
    if (state.rowBusyId === rowId) return 'This Study row action is already running.';
    if (state.rowBusyId) return 'Another Study row action is already running.';
    if (state.editingSessionId && enabledTitle === 'Edit') return 'Finish or cancel the current edit before editing another study log.';
    return enabledTitle;
  }

  function saveLogEditTitle(state: StudyControlState, draft: StudyDraft): string {
    if (!state.canSave || state.rowBusyId) return studyRowTitle(state, 'Save study log changes.', state.editingSessionId);
    if (!draft.subject.trim()) return 'Add a study label before saving this log.';
    if (draft.minutes < 1) return 'Minutes must be at least 1 before saving this log.';
    return 'Save study log changes.';
  }

  function studySummaryTitle(state: Pick<StudyControlState, 'studySummaryLoading'>): string {
    return state.studySummaryLoading ? 'Legacy Study scan is already running.' : 'Scan this browser for legacy Study Desk data.';
  }

  function studyCareerActionsEmptyMessage(): string {
    if (careerActions.length) return 'No linked career actions match the current search.';
    if (!$clientData.initialized) return 'Opening cached linked career actions before live API sync.';
    if (!canSave) return 'No cached linked career actions found in this browser.';
    return 'No linked career actions have been imported or created yet.';
  }

  function studyLogsEmptyMessage(): string {
    if (logs.length) return 'No study logs match the current filters.';
    if (!$clientData.initialized) return 'Opening cached Study logs before live API sync.';
    if (!canSave) return 'No cached Study logs found in this browser. Start or connect the Mini Hub API before logging progress.';
    return 'No saved Study logs yet. Use Quick Log to add one.';
  }

  function emptyStudyDraft(): StudyDraft {
    return { subject: '', minutes: 30 };
  }

  function normalizeStudyViewState(value: unknown, fallback: StudyViewState): StudyViewState {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
    const record = value as Partial<StudyViewState>;
    const nextMinutes = typeof record.minutes === 'number' && Number.isFinite(record.minutes) ? Math.max(1, Math.round(record.minutes)) : fallback.minutes;
    return {
      searchQuery: typeof record.searchQuery === 'string' ? record.searchQuery : fallback.searchQuery,
      subject: typeof record.subject === 'string' && record.subject.trim() ? record.subject : fallback.subject,
      minutes: nextMinutes
    };
  }

  function currentStudyViewState(): StudyViewState {
    return { searchQuery, subject, minutes: Number(minutes) };
  }

  function hydrateStudyViewState(): void {
    const storage = getBrowserStorage();
    if (!storage) {
      viewHydrated = true;
      viewStatus = 'Browser storage is unavailable; filters reset on reload.';
      return;
    }
    try {
      const raw = storage.getItem(studyViewStorageKey);
      if (raw) {
        const next = normalizeStudyViewState(JSON.parse(raw) as unknown, currentStudyViewState());
        searchQuery = next.searchQuery;
        subject = next.subject;
        minutes = next.minutes;
        viewStatus = 'Reloaded Study filters and quick-log defaults from this browser.';
      } else {
        viewStatus = 'Study filters and quick-log defaults are saved in this browser.';
      }
    } catch {
      viewStatus = 'Stored Study view was unreadable; defaults are loaded.';
    } finally {
      viewHydrated = true;
    }
  }

  function persistStudyViewState(nextSearchQuery = searchQuery, nextSubject = subject, nextMinutes = Number(minutes)): void {
    const storage = getBrowserStorage();
    if (!storage) return;
    try {
      storage.setItem(studyViewStorageKey, JSON.stringify({ searchQuery: nextSearchQuery, subject: nextSubject, minutes: Number(nextMinutes) }));
    } catch {
      viewStatus = 'Browser storage is full or blocked; Study view may not persist.';
    }
  }

  function matchesLog(log: StudySession): boolean {
    const query = searchQuery.trim().toLowerCase();
    return !query || log.subject.toLowerCase().includes(query);
  }

  function matchesCareerAction(action: CareerActionRecord): boolean {
    const query = searchQuery.trim().toLowerCase();
    return !query || action.label.toLowerCase().includes(query);
  }

  function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  }

  function text(value: unknown): string {
    return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
  }

  function numberValue(value: unknown): number {
    const next = Number(value);
    return Number.isFinite(next) ? next : 0;
  }

  function arrayLength(value: unknown): number {
    return Array.isArray(value) ? value.length : 0;
  }

  function trackLabel(value: string): string {
    const labels: Record<string, string> = {
      examP: 'Exam P',
      quant: 'Quant',
      coding: 'Coding'
    };
    return labels[value] ?? value;
  }

  function buildLegacyTopicRows(topics: Record<string, unknown> | null): LegacyTopicRow[] {
    if (!topics) return [];
    return Object.entries(topics)
      .map(([track, value]) => {
        const list = Array.isArray(value) ? value.map(asRecord).filter((item): item is Record<string, unknown> => Boolean(item)) : [];
        const done = list.filter((item) => Boolean(item.done)).length;
        const next = list.find((item) => !item.done);
        const updatedAt = list
          .map((item) => text(item.updatedAt))
          .filter(Boolean)
          .sort()
          .at(-1);
        return {
          track: trackLabel(track),
          done,
          total: list.length,
          next: next ? text(next.title) || text(next.id) || 'Untitled milestone' : list.length ? 'Complete' : 'None',
          updatedAt: updatedAt ?? ''
        };
      })
      .filter((row) => row.total > 0);
  }

  function buildLegacyDailyRows(daily: Record<string, unknown> | null): LegacyDailyRow[] {
    if (!daily) return [];
    return Object.entries(daily)
      .map(([date, value]) => {
        const record = asRecord(value) ?? {};
        return {
          date,
          careerActions: arrayLength(record.careerActions),
          neetcodeNew: numberValue(record.neetcodeNew),
          neetcodeSubmissions: numberValue(record.neetcodeSubmissions),
          note: text(record.note)
        };
      })
      .sort((left, right) => right.date.localeCompare(left.date))
      .slice(0, 10);
  }

  function localDayKey(date: Date): string {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function buildProgressDays(daily: Record<string, unknown> | null, sessions: StudySession[]): DailyProgress[] {
    const days = new Map<string, DailyProgress>();
    const today = startOfLocalDay(new Date());
    for (let offset = 27; offset >= 0; offset -= 1) {
      const date = new Date(today);
      date.setDate(today.getDate() - offset);
      const key = localDayKey(date);
      days.set(key, { date: key, neetcodeNew: 0, neetcodeSubmissions: 0, minutes: 0, active: false, intensity: 0 });
    }

    for (const [date, value] of Object.entries(daily ?? {})) {
      const row = days.get(date);
      if (!row) continue;
      const record = asRecord(value) ?? {};
      row.neetcodeNew = numberValue(record.neetcodeNew);
      row.neetcodeSubmissions = numberValue(record.neetcodeSubmissions);
    }

    for (const session of sessions) {
      const parsed = new Date(session.loggedAt);
      if (Number.isNaN(parsed.getTime())) continue;
      const row = days.get(localDayKey(parsed));
      if (row) row.minutes += session.minutes;
    }

    return [...days.values()].map((day) => {
      const score = day.neetcodeSubmissions + day.neetcodeNew + Math.floor(day.minutes / 30);
      return {
        ...day,
        active: score > 0,
        intensity: Math.min(4, score)
      };
    });
  }

  function calculateStreak(days: DailyProgress[]): number {
    let streak = 0;
    for (const day of [...days].reverse()) {
      if (!day.active) break;
      streak += 1;
    }
    return streak;
  }

  function summarizeLegacyGithub(github: Record<string, unknown> | null): LegacyGithubSummary {
    return {
      repo: text(github?.repo) || 'None',
      lastSync: text(github?.lastSync),
      submissions: numberValue(github?.submissions),
      problems: arrayLength(github?.problems),
      newPaths: arrayLength(github?.newPaths),
      status: text(github?.status) || 'unknown'
    };
  }

  function displayDateTime(value: string): string {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
  }

  function startOfLocalDay(date: Date): Date {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    return start;
  }

  function isToday(value: string): boolean {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return false;
    return startOfLocalDay(parsed).getTime() === startOfLocalDay(new Date()).getTime();
  }

  function isThisWeek(value: string): boolean {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return false;
    const today = startOfLocalDay(new Date());
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - today.getDay());
    return parsed >= weekStart;
  }

  async function refreshSummary(): Promise<void> {
    if (studySummaryLoading) return;
    studySummaryLoading = true;
    saveError = '';
    saveMessage = '';
    try {
      const storage = getBrowserStorage();
      if (!storage) {
        throw new Error('Browser storage is unavailable; legacy Study scan cannot run.');
      }
      const { inspectLegacyStorage } = await import('@mini-hub/db/migration');
      summary = inspectLegacyStorage(storage);
    } catch (error) {
      saveError = error instanceof Error ? error.message : 'Legacy Study scan failed';
    } finally {
      studySummaryLoading = false;
    }
  }

  async function addLog(): Promise<void> {
    if (!canSave || saving || !subject.trim() || minutes < 1) return;
    saveError = '';
    rowError = '';
    saveMessage = '';
    saving = true;
    const savedSubject = subject.trim();
    const savedMinutes = Number(minutes);
    try {
      await clientData.saveStudySession({
        subject: savedSubject,
        minutes: savedMinutes,
        source: 'manual'
      });
      subject = 'NeetCode';
      minutes = 30;
      saveMessage = `Logged ${savedMinutes} min for ${savedSubject}.`;
    } catch (error) {
      saveError = error instanceof Error ? error.message : 'Save failed';
    } finally {
      saving = false;
    }
  }

  function chooseQuickLog(nextSubject: string, nextMinutes: number): void {
    if (!canSave || saving) return;
    subject = nextSubject;
    minutes = nextMinutes;
  }

  function startEditLog(log: StudySession): void {
    if (!canSave || editingSessionId || rowBusyId) return;
    editingSessionId = log.id;
    rowError = '';
    saveMessage = '';
    studyDraft = {
      subject: log.subject,
      minutes: log.minutes
    };
  }

  function cancelEditLog(): void {
    editingSessionId = '';
    rowBusyId = '';
    rowError = '';
    studyDraft = emptyStudyDraft();
  }

  async function saveLogEdit(log: StudySession): Promise<void> {
    if (!canSave || !studyDraft.subject.trim() || studyDraft.minutes < 1) return;
    rowError = '';
    saveError = '';
    saveMessage = '';
    rowBusyId = log.id;
    const savedSubject = studyDraft.subject.trim();
    const savedMinutes = Number(studyDraft.minutes);
    try {
      await clientData.updateStudySession(log.id, {
        subject: savedSubject,
        minutes: savedMinutes
      });
      cancelEditLog();
      saveMessage = `Updated ${savedSubject} to ${savedMinutes} min.`;
    } catch (error) {
      rowError = error instanceof Error ? error.message : 'Save failed';
    } finally {
      rowBusyId = '';
    }
  }

  async function deleteLog(log: StudySession): Promise<void> {
    if (!canSave || rowBusyId) return;
    if (!window.confirm(`Delete ${log.minutes} min for "${log.subject}"? This removes the saved Study Desk log from this workspace.`)) {
      saveMessage = 'Study delete skipped.';
      rowError = '';
      saveError = '';
      return;
    }
    rowError = '';
    saveError = '';
    saveMessage = '';
    rowBusyId = log.id;
    try {
      await clientData.deleteStudySession(log.id);
      if (editingSessionId === log.id) cancelEditLog();
      saveMessage = `Deleted ${log.minutes} min for ${log.subject}.`;
    } catch (error) {
      rowError = error instanceof Error ? error.message : 'Delete failed';
    } finally {
      rowBusyId = '';
    }
  }

  onMount(() => {
    hydrateStudyViewState();
    void clientData.init();
    void refreshSummary();
  });
</script>

<svelte:head>
  <title>Study Desk - Mini Hub</title>
</svelte:head>

<section class="page-header">
  <div>
    <p class="eyebrow">Desk</p>
    <h1>Study</h1>
  </div>
  <div class="action-row">
    <button class="button" type="button" disabled={studySummaryLoading} title={studySummaryButtonTitle} on:click={refreshSummary}>
      <RefreshCw size={17} />
      <span>{studySummaryLoading ? 'Scanning' : 'Scan'}</span>
    </button>
  </div>
</section>

{#if !canSave}
  <section class="card card-pad offline-banner">Offline: cached study logs are readable, saving is disabled.</section>
{/if}
{#if saveError || rowError}
  <section class="card card-pad error-banner">{saveError || rowError}</section>
{/if}
{#if saveMessage}
  <section class="card card-pad success-banner">{saveMessage}</section>
{/if}
{#if importedLegacy}
  <section class="card card-pad import-summary">
    <span>Last legacy import</span>
    <strong>{importedLegacy.importedAt ? displayDateTime(importedLegacy.importedAt) : 'Recorded'}</strong>
    <small>{importedLegacy.jobs ?? 0} jobs, {importedLegacy.studySessions ?? 0} study sessions, {importedLegacy.careerActions ?? importedLegacy.studyCareerActions ?? 0} linked career actions</small>
  </section>
{/if}

<section class="progress-grid">
  <div class="card card-pad progress-panel">
    <div class="section-title split">
      <span>
        <CalendarDays size={18} />
        <strong>Daily Progress</strong>
      </span>
      <small>last 28 days</small>
    </div>
    <div class="progress-stats">
      <div><span>Streak</span><strong>{currentStreak}</strong></div>
      <div><span>Active Days</span><strong>{activeProgressDays}</strong></div>
      <div><span>Submissions</span><strong>{legacyGithub.submissions || neetcodeSubmissions}</strong></div>
      <div><span>New Problems</span><strong>{legacyGithub.problems || neetcodeNewProblems}</strong></div>
    </div>
    <div class="progress-calendar" aria-label="NeetCode and study progress over the last 28 days">
      {#each progressDays as day}
        <div class={`day-cell level-${day.intensity}`} title={`${day.date}: ${day.neetcodeSubmissions} submissions, ${day.neetcodeNew} new, ${day.minutes} minutes`}>
          <span>{Number(day.date.slice(-2))}</span>
        </div>
      {/each}
    </div>
    <div class="progress-foot">
      <span>GitHub: {legacyGithub.lastSync ? displayDateTime(legacyGithub.lastSync) : 'not synced yet'}</span>
      <span>{todayMinutes} min today / {weekMinutes} min this week</span>
    </div>
  </div>

  <form class="card card-pad form quick-log" on:submit|preventDefault={addLog}>
    <div class="section-title">
      <Flame size={18} />
      <strong>Quick Log</strong>
    </div>
    <div class="quick-row">
      {#each quickSubjects as option}
        <button class:active={subject === option} type="button" disabled={!canSave || saving} title={studySaveTitle(studyControlState, `Use ${option} as the study label.`)} on:click={() => (subject = option)}>{option}</button>
      {/each}
    </div>
    <div class="quick-row">
      {#each quickMinutes as option}
        <button class:active={minutes === option} type="button" disabled={!canSave || saving} title={studySaveTitle(studyControlState, `Use ${option} minutes.`)} on:click={() => chooseQuickLog(subject, option)}>{option}m</button>
      {/each}
    </div>
    <div class="compact-fields">
      <div class="field">
        <label for="subject">Label</label>
        <input id="subject" bind:value={subject} disabled={!canSave || saving} title={studySaveTitle(studyControlState, 'Study label.')} />
      </div>
      <div class="field minutes-field">
        <label for="minutes">Minutes</label>
        <input id="minutes" bind:value={minutes} disabled={!canSave || saving} title={studySaveTitle(studyControlState, 'Study minutes.')} type="number" min="1" step="5" />
      </div>
    </div>
    <button class="button primary" type="button" disabled={!canSave || saving || !subject.trim() || minutes < 1} title={addLogButtonTitle} on:click={addLog}>
      <Plus size={17} />
      <span>{saving ? 'Saving' : 'Log Progress'}</span>
    </button>
  </form>
</section>

{#if hasLegacyStudyState}
  <section class="card card-pad legacy-study-panel">
    <div class="table-title compact">
      <strong>NeetCode Source</strong>
      <span>GitHub and legacy daily history preserved from old mode</span>
    </div>

    <div class="legacy-summary-grid">
      <div><span>Exam Date</span><strong>{text(legacyStudySettings?.examDate) || 'None'}</strong></div>
      <div><span>Weekly Goal</span><strong>{numberValue(legacyStudySettings?.weeklyGoal) || 0} min</strong></div>
      <div><span>GitHub Repo</span><strong>{legacyGithub.repo}</strong></div>
      <div><span>Submissions</span><strong>{legacyGithub.submissions}</strong></div>
      <div><span>Problems</span><strong>{legacyGithub.problems}</strong></div>
      <div><span>Last Sync</span><strong>{legacyGithub.lastSync ? displayDateTime(legacyGithub.lastSync) : 'No legacy GitHub sync recorded'}</strong></div>
    </div>

    <details class="legacy-details">
      <summary>Show preserved topic and daily details</summary>
      <div class="legacy-grid">
        <div class="legacy-subtable">
          <div class="legacy-subtitle">
            <strong>Topic Progress</strong>
            <span>{legacyTopicRows.length} tracks</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>Track</th>
                <th>Done</th>
                <th>Next</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {#each legacyTopicRows as row}
                <tr>
                  <td>{row.track}</td>
                  <td>{row.done}/{row.total}</td>
                  <td>{row.next}</td>
                  <td>{row.updatedAt ? displayDateTime(row.updatedAt) : 'None'}</td>
                </tr>
              {:else}
                <tr><td colspan="4" class="muted">No legacy topics were found.</td></tr>
              {/each}
            </tbody>
          </table>
        </div>

        <div class="legacy-subtable">
          <div class="legacy-subtitle">
            <strong>Recent Daily Records</strong>
            <span>{legacyDailyRows.length} shown</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Career</th>
                <th>New Code</th>
                <th>Submissions</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {#each legacyDailyRows as row}
                <tr>
                  <td>{row.date}</td>
                  <td>{row.careerActions}</td>
                  <td>{row.neetcodeNew}</td>
                  <td>{row.neetcodeSubmissions}</td>
                  <td>{row.note || 'None'}</td>
                </tr>
              {:else}
                <tr><td colspan="5" class="muted">No legacy daily records were found.</td></tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>
    </details>
  </section>
{/if}

<details class="secondary-details">
  <summary>Linked career actions</summary>
  <div class="table-toolbar" aria-label="Study filters">
    <div class="field">
      <label for="study-search">Search</label>
      <div class="search-box">
        <Search size={16} />
        <input id="study-search" bind:value={searchQuery} placeholder="Subject" title="Filter Study logs and linked career actions by subject. This filter is saved in this browser." />
      </div>
      <small class="view-status">{viewStatus}</small>
    </div>
  </div>

  <section class="card table-card action-card">
    <div class="table-title">
      <strong>Linked Career Actions</strong>
      <span>{filteredCareerActions.length} shown / {careerActions.length} synced</span>
    </div>
    <table>
      <thead>
        <tr>
          <th>Action</th>
          <th>Due</th>
          <th>Completed</th>
        </tr>
      </thead>
      <tbody>
        {#each filteredCareerActions as action}
          <tr>
            <td>{action.label}</td>
            <td>{action.dueAt ? displayDateTime(action.dueAt) : 'None'}</td>
            <td>{action.completedAt ? displayDateTime(action.completedAt) : 'Open'}</td>
          </tr>
        {:else}
          <tr>
            <td colspan="3" class="muted">{studyCareerActionsEmptyMessage()}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </section>
</details>

<details class="secondary-details" open={logs.length > 0}>
  <summary>Manual study logs</summary>
  <section class="card table-card">
    <table>
      <thead>
        <tr>
          <th>Subject</th>
          <th>Minutes</th>
          <th>Logged</th>
          <th>Updated</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {#each filteredLogs as log}
          <tr>
            {#if editingSessionId === log.id}
              <td><input class="table-input" bind:value={studyDraft.subject} disabled={!canSave || rowBusyId === log.id} title={studyRowTitle(studyControlState, 'Study label.', log.id)} /></td>
              <td><input class="table-input minutes-input" bind:value={studyDraft.minutes} disabled={!canSave || rowBusyId === log.id} title={studyRowTitle(studyControlState, 'Study minutes.', log.id)} type="number" min="1" step="5" /></td>
              <td>{displayDateTime(log.loggedAt)}</td>
              <td>{displayDateTime(log.updatedAt)}</td>
              <td class="actions-cell">
                <div class="row-actions">
                  <button class="icon-button" type="button" aria-label="Save study log" title={saveLogEditButtonTitle} disabled={!canSave || rowBusyId === log.id || !studyDraft.subject.trim() || studyDraft.minutes < 1} on:click={() => saveLogEdit(log)}>
                    <Save size={16} />
                  </button>
                  <button class="icon-button" type="button" aria-label="Cancel study log edit" title={rowBusyId === log.id ? 'This Study row action is already running.' : 'Cancel study log edit.'} disabled={rowBusyId === log.id} on:click={cancelEditLog}>
                    <X size={16} />
                  </button>
                </div>
              </td>
            {:else}
              <td>{log.subject}</td>
              <td>{log.minutes}</td>
              <td>{displayDateTime(log.loggedAt)}</td>
              <td>{displayDateTime(log.updatedAt)}</td>
              <td class="actions-cell">
                <div class="row-actions">
                  <button class="icon-button" type="button" aria-label={`Edit ${log.subject}`} title={studyRowTitle(studyControlState, 'Edit', log.id)} disabled={!canSave || !!editingSessionId || rowBusyId === log.id} on:click={() => startEditLog(log)}>
                    <Edit3 size={16} />
                  </button>
                  <button class="icon-button danger" type="button" aria-label={`Delete ${log.subject}`} title={studyRowTitle(studyControlState, 'Ask for confirmation before deleting this saved study log.', log.id)} disabled={!canSave || rowBusyId === log.id} on:click={() => deleteLog(log)}>
                    <Trash2 size={16} />
                  </button>
                </div>
              </td>
            {/if}
          </tr>
        {:else}
          <tr>
            <td colspan="5" class="muted">{studyLogsEmptyMessage()}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </section>
</details>

<style>
  .progress-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.5fr) minmax(260px, 0.7fr);
    gap: 12px;
  }

  .progress-panel,
  .form {
    display: grid;
    gap: 12px;
  }

  .section-title {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .section-title.split {
    justify-content: space-between;
  }

  .section-title.split span {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  .section-title small {
    color: var(--muted);
    font-weight: 800;
  }

  .progress-stats {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;
  }

  .progress-stats div {
    display: grid;
    gap: 4px;
    min-height: 66px;
    align-content: center;
    padding: 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface-muted);
  }

  .progress-stats span,
  .progress-foot {
    color: var(--muted);
    font-weight: 750;
  }

  .progress-stats strong {
    font-size: 19px;
  }

  .progress-calendar {
    display: grid;
    grid-template-columns: repeat(14, minmax(0, 1fr));
    gap: 6px;
  }

  .day-cell {
    display: grid;
    min-height: 34px;
    place-items: center;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--muted);
    background: var(--surface);
    font-size: 11px;
    font-weight: 850;
  }

  .day-cell.level-1 {
    border-color: var(--border-strong);
    color: var(--text);
    background: var(--surface-soft);
  }

  .day-cell.level-2,
  .day-cell.level-3,
  .day-cell.level-4 {
    border-color: var(--primary-bg);
    color: var(--primary-text);
    background: var(--primary-bg);
  }

  .day-cell.level-3,
  .day-cell.level-4 {
    outline: 2px solid var(--border-strong);
  }

  .progress-foot {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 8px;
  }

  .quick-log {
    align-content: start;
  }

  .quick-row {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 6px;
  }

  .quick-row button {
    min-height: 36px;
    border: 1px solid var(--border-strong);
    border-radius: 6px;
    color: var(--text-soft);
    background: var(--surface);
    cursor: pointer;
  }

  .quick-row button.active,
  .quick-row button:hover {
    color: var(--primary-text);
    background: var(--primary-bg);
  }

  .compact-fields {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 110px;
    gap: 8px;
  }

  .table-toolbar {
    display: grid;
    grid-template-columns: minmax(220px, 420px);
    gap: 12px;
    margin: 16px 0 10px;
  }

  .import-summary {
    display: grid;
    gap: 4px;
    margin-bottom: 14px;
  }

  .import-summary span,
  .import-summary small {
    color: var(--muted);
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

  .table-card {
    overflow: auto;
  }

  .action-card {
    margin-bottom: 14px;
  }

  .table-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--border);
  }

  .table-title.compact {
    padding: 0 0 12px;
  }

  .table-title span {
    color: var(--muted);
    font-weight: 700;
  }

  .legacy-study-panel {
    display: grid;
    gap: 14px;
    margin-top: 14px;
  }

  .legacy-details,
  .secondary-details {
    display: grid;
    gap: 10px;
    margin-top: 14px;
  }

  .legacy-details summary,
  .secondary-details summary {
    min-height: 42px;
    padding: 11px 12px;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    background: var(--surface-muted);
    font-weight: 850;
    cursor: pointer;
  }

  .legacy-details[open] summary,
  .secondary-details[open] summary {
    margin-bottom: 10px;
  }

  .legacy-summary-grid {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: 10px;
  }

  .legacy-summary-grid div {
    display: grid;
    gap: 4px;
    min-height: 66px;
    align-content: center;
    padding: 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface-muted);
  }

  .legacy-summary-grid span,
  .legacy-subtitle span {
    color: var(--muted);
    font-weight: 700;
  }

  .legacy-summary-grid strong {
    overflow-wrap: anywhere;
  }

  .legacy-grid {
    display: grid;
    grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
    gap: 14px;
  }

  .legacy-subtable {
    overflow: auto;
    border: 1px solid var(--border);
    border-radius: 6px;
  }

  .legacy-subtitle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--border);
    background: var(--surface-muted);
  }

  .table-input {
    min-width: 150px;
    padding: 8px 9px;
  }

  .minutes-input {
    min-width: 96px;
  }

  .actions-cell {
    min-width: 94px;
  }

  .row-actions {
    display: flex;
    gap: 6px;
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

  .view-status {
    display: block;
    margin-top: 4px;
    color: var(--muted);
    font-size: 12px;
    line-height: 1.25;
  }

  @media (max-width: 820px) {
    .progress-grid,
    .progress-stats,
    .compact-fields {
      grid-template-columns: 1fr;
    }

    .progress-calendar {
      grid-template-columns: repeat(7, minmax(0, 1fr));
    }

    .day-cell {
      min-height: 40px;
      font-size: 12px;
    }

    .quick-row button {
      min-height: 44px;
    }

    .legacy-summary-grid,
    .legacy-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
