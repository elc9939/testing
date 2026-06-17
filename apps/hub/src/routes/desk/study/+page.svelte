<script lang="ts">
  import { onMount } from 'svelte';
  import { Edit3, Plus, RefreshCw, Save, Search, Trash2, X } from 'lucide-svelte';
  import type { StudySession } from '@mini-hub/core';
  import type { LegacyImportSummary } from '@mini-hub/db/migration';
  import { canAutoSave, clientData } from '$lib/client-data';

  interface StudyDraft {
    subject: string;
    minutes: number;
  }

  let summary: LegacyImportSummary | null = null;
  let subject = 'Exam P';
  let minutes = 30;
  let searchQuery = '';
  let saveError = '';
  let rowError = '';
  let saving = false;
  let rowBusyId = '';
  let editingSessionId = '';
  let studyDraft: StudyDraft = emptyStudyDraft();

  $: canSave = canAutoSave($clientData);
  $: logs = $clientData.studySessions;
  $: filteredLogs = logs.filter(matchesLog);
  $: totalMinutes = logs.reduce((sum, item) => sum + item.minutes, 0);
  $: todayMinutes = logs.filter((item) => isToday(item.loggedAt)).reduce((sum, item) => sum + item.minutes, 0);
  $: weekMinutes = logs.filter((item) => isThisWeek(item.loggedAt)).reduce((sum, item) => sum + item.minutes, 0);

  function emptyStudyDraft(): StudyDraft {
    return { subject: '', minutes: 30 };
  }

  function matchesLog(log: StudySession): boolean {
    const query = searchQuery.trim().toLowerCase();
    return !query || log.subject.toLowerCase().includes(query);
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
    const { inspectLegacyStorage } = await import('@mini-hub/db/migration');
    summary = inspectLegacyStorage(localStorage);
  }

  async function addLog(): Promise<void> {
    if (!subject.trim() || minutes < 1) return;
    saveError = '';
    saving = true;
    try {
      await clientData.saveStudySession({
        subject: subject.trim(),
        minutes: Number(minutes),
        source: 'manual'
      });
      subject = '';
      minutes = 30;
    } catch (error) {
      saveError = error instanceof Error ? error.message : 'Save failed';
    } finally {
      saving = false;
    }
  }

  function startEditLog(log: StudySession): void {
    editingSessionId = log.id;
    rowError = '';
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
    if (!studyDraft.subject.trim() || studyDraft.minutes < 1) return;
    rowError = '';
    rowBusyId = log.id;
    try {
      await clientData.updateStudySession(log.id, {
        subject: studyDraft.subject.trim(),
        minutes: Number(studyDraft.minutes)
      });
      cancelEditLog();
    } catch (error) {
      rowError = error instanceof Error ? error.message : 'Save failed';
    } finally {
      rowBusyId = '';
    }
  }

  async function deleteLog(log: StudySession): Promise<void> {
    rowError = '';
    rowBusyId = log.id;
    try {
      await clientData.deleteStudySession(log.id);
      if (editingSessionId === log.id) cancelEditLog();
    } catch (error) {
      rowError = error instanceof Error ? error.message : 'Delete failed';
    } finally {
      rowBusyId = '';
    }
  }

  onMount(() => {
    void clientData.init();
    void refreshSummary();
  });
</script>

<section class="page-header">
  <div>
    <p class="eyebrow">Desk</p>
    <h1>Study</h1>
  </div>
  <button class="button" type="button" on:click={refreshSummary}>
    <RefreshCw size={17} />
    <span>Scan</span>
  </button>
</section>

{#if !canSave}
  <section class="card card-pad offline-banner">Offline: cached study logs are readable, saving is disabled.</section>
{/if}
{#if saveError || rowError}
  <section class="card card-pad error-banner">{saveError || rowError}</section>
{/if}

<section class="grid three">
  <form class="card card-pad form" on:submit|preventDefault={addLog}>
    <div class="field">
      <label for="subject">Subject</label>
      <input id="subject" bind:value={subject} disabled={!canSave || saving} />
    </div>
    <div class="field">
      <label for="minutes">Minutes</label>
      <input id="minutes" bind:value={minutes} disabled={!canSave || saving} type="number" min="1" step="5" />
    </div>
    <button class="button primary" type="button" disabled={!canSave || saving} on:click={addLog}>
      <Plus size={17} />
      <span>{saving ? 'Saving' : 'Log'}</span>
    </button>
  </form>

  <div class="card card-pad metric">
    <span>Today</span>
    <strong>{todayMinutes}</strong>
  </div>

  <div class="card card-pad metric">
    <span>This Week</span>
    <strong>{weekMinutes}</strong>
  </div>
</section>

<section class="metric-strip">
  <div><span>Total Minutes</span><strong>{totalMinutes}</strong></div>
  <div><span>Legacy Days</span><strong>{summary?.studyDays ?? 0}</strong></div>
  <div><span>Visible Logs</span><strong>{filteredLogs.length} / {logs.length}</strong></div>
</section>

<section class="table-toolbar" aria-label="Study filters">
  <div class="field">
    <label for="study-search">Search</label>
    <div class="search-box">
      <Search size={16} />
      <input id="study-search" bind:value={searchQuery} placeholder="Subject" />
    </div>
  </div>
</section>

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
            <td><input class="table-input" bind:value={studyDraft.subject} disabled={rowBusyId === log.id} /></td>
            <td><input class="table-input minutes-input" bind:value={studyDraft.minutes} disabled={rowBusyId === log.id} type="number" min="1" step="5" /></td>
            <td>{displayDateTime(log.loggedAt)}</td>
            <td>{displayDateTime(log.updatedAt)}</td>
            <td class="actions-cell">
              <div class="row-actions">
                <button class="icon-button" type="button" aria-label="Save study log" title="Save log" disabled={!canSave || rowBusyId === log.id} on:click={() => saveLogEdit(log)}>
                  <Save size={16} />
                </button>
                <button class="icon-button" type="button" aria-label="Cancel study log edit" title="Cancel" disabled={rowBusyId === log.id} on:click={cancelEditLog}>
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
                <button class="icon-button" type="button" aria-label={`Edit ${log.subject}`} title="Edit" disabled={!canSave || !!editingSessionId || rowBusyId === log.id} on:click={() => startEditLog(log)}>
                  <Edit3 size={16} />
                </button>
                <button class="icon-button danger" type="button" aria-label={`Delete ${log.subject}`} title="Delete" disabled={!canSave || rowBusyId === log.id} on:click={() => deleteLog(log)}>
                  <Trash2 size={16} />
                </button>
              </div>
            </td>
          {/if}
        </tr>
      {:else}
        <tr>
          <td colspan="5" class="muted">{logs.length ? 'No study logs match the current filters.' : 'No study logs in this Svelte workspace yet.'}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</section>

<style>
  .form {
    display: grid;
    gap: 12px;
  }

  .metric {
    display: grid;
    align-content: center;
    gap: 6px;
    min-height: 150px;
  }

  .metric span,
  .metric-strip span {
    color: #64748b;
    font-weight: 700;
  }

  .metric strong {
    font-size: 42px;
    line-height: 1;
  }

  .metric-strip {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 14px;
    margin: 14px 0 0;
  }

  .metric-strip div {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 14px;
    border: 1px solid #dfe5ee;
    border-radius: 8px;
    background: #ffffff;
  }

  .table-toolbar {
    display: grid;
    grid-template-columns: minmax(220px, 420px);
    gap: 12px;
    margin: 16px 0 10px;
  }

  .search-box {
    display: grid;
    grid-template-columns: 18px minmax(0, 1fr);
    align-items: center;
    gap: 8px;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    padding: 0 10px;
    background: #ffffff;
  }

  .search-box input {
    border: 0;
    padding-inline: 0;
  }

  .table-card {
    overflow: auto;
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
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    color: #18202f;
    background: #ffffff;
    cursor: pointer;
  }

  .icon-button.danger {
    color: #9f1239;
  }

  .icon-button:disabled,
  .button:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  .offline-banner {
    margin-bottom: 14px;
    border-color: #f2c14e;
    color: #815d00;
    background: #fff8df;
    font-weight: 800;
  }

  .error-banner {
    margin-bottom: 14px;
    border-color: #ff9f6e;
    color: #944700;
    background: #fff0e6;
    font-weight: 800;
  }

  @media (max-width: 820px) {
    .metric-strip {
      grid-template-columns: 1fr;
    }
  }
</style>
