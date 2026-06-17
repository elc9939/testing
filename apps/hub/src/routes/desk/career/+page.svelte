<script lang="ts">
  import { onMount } from 'svelte';
  import { Download, Edit3, Plus, RefreshCw, Save, Search, Trash2, Upload, X } from 'lucide-svelte';
  import type { JobRecord } from '@mini-hub/core';
  import type { LegacyImportSummary } from '@mini-hub/db/migration';
  import { canAutoSave, clientData } from '$lib/client-data';

  const statuses = ['lead', 'applied', 'interview', 'offer', 'rejected', 'archived'];

  interface LegacyImportState {
    importedAt?: string;
    jobs?: number;
    studySessions?: number;
    studyDays?: number;
    studyCareerActions?: number;
    warnings?: string[];
  }

  interface JobDraft {
    company: string;
    role: string;
    status: string;
    notes: string;
    nextActionAt: string;
  }

  let summary: LegacyImportSummary | null = null;
  let company = '';
  let role = '';
  let status = 'lead';
  let notes = '';
  let nextActionAt = '';
  let searchQuery = '';
  let statusFilter = 'all';
  let saveError = '';
  let rowError = '';
  let importMessage = '';
  let saving = false;
  let importing = false;
  let rowBusyId = '';
  let editingJobId = '';
  let jobDraft: JobDraft = emptyJobDraft();

  $: canSave = canAutoSave($clientData);
  $: jobs = $clientData.jobs;
  $: filteredJobs = jobs.filter(matchesJob);
  $: importedLegacy = (($clientData.settings?.recentState?.legacyImport ?? null) as LegacyImportState | null);

  function emptyJobDraft(): JobDraft {
    return { company: '', role: '', status: 'lead', notes: '', nextActionAt: '' };
  }

  function dateInputValue(value?: string): string {
    return value ? value.slice(0, 10) : '';
  }

  function displayDate(value?: string): string {
    if (!value) return 'None';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString();
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
      job.notes.toLowerCase().includes(query);
    return statusMatch && queryMatch;
  }

  async function refreshSummary(): Promise<void> {
    const { inspectLegacyStorage } = await import('@mini-hub/db/migration');
    summary = inspectLegacyStorage(localStorage);
  }

  async function importLegacy(): Promise<void> {
    saveError = '';
    importMessage = '';
    importing = true;
    try {
      const result = await clientData.importLegacySnapshot(localStorage);
      importMessage = `Imported ${result.jobs.length} job${result.jobs.length === 1 ? '' : 's'} and ${result.studySessions.length} study session${result.studySessions.length === 1 ? '' : 's'}.`;
      await refreshSummary();
    } catch (error) {
      saveError = error instanceof Error ? error.message : 'Legacy import failed';
    } finally {
      importing = false;
    }
  }

  async function addJob(): Promise<void> {
    if (!company.trim() || !role.trim()) return;
    saveError = '';
    saving = true;
    try {
      await clientData.saveJob({
        company: company.trim(),
        role: role.trim(),
        status,
        notes: notes.trim(),
        nextActionAt: nextActionAt || null
      });
      company = '';
      role = '';
      status = 'lead';
      notes = '';
      nextActionAt = '';
    } catch (error) {
      saveError = error instanceof Error ? error.message : 'Save failed';
    } finally {
      saving = false;
    }
  }

  function startEditJob(job: JobRecord): void {
    editingJobId = job.id;
    rowError = '';
    jobDraft = {
      company: job.company,
      role: job.role,
      status: job.status,
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
    if (!jobDraft.company.trim() || !jobDraft.role.trim()) return;
    rowError = '';
    rowBusyId = job.id;
    try {
      await clientData.updateJob(job.id, {
        company: jobDraft.company.trim(),
        role: jobDraft.role.trim(),
        status: jobDraft.status,
        notes: jobDraft.notes.trim(),
        nextActionAt: jobDraft.nextActionAt || null
      });
      cancelEditJob();
    } catch (error) {
      rowError = error instanceof Error ? error.message : 'Save failed';
    } finally {
      rowBusyId = '';
    }
  }

  async function deleteJob(job: JobRecord): Promise<void> {
    rowError = '';
    rowBusyId = job.id;
    try {
      await clientData.deleteJob(job.id);
      if (editingJobId === job.id) cancelEditJob();
    } catch (error) {
      rowError = error instanceof Error ? error.message : 'Delete failed';
    } finally {
      rowBusyId = '';
    }
  }

  async function exportSnapshot(): Promise<void> {
    const { exportLegacySnapshot } = await import('@mini-hub/db/migration');
    const blob = new Blob([JSON.stringify(exportLegacySnapshot(localStorage), null, 2)], {
      type: 'application/json'
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'mini-hub-legacy-career-snapshot.json';
    link.click();
    URL.revokeObjectURL(url);
  }

  onMount(() => {
    void clientData.init();
    void refreshSummary();
  });
</script>

<section class="page-header">
  <div>
    <p class="eyebrow">Desk</p>
    <h1>Career</h1>
  </div>
  <div class="action-row">
    <button class="button" type="button" on:click={refreshSummary}>
      <RefreshCw size={17} />
      <span>Scan</span>
    </button>
    <button class="button" type="button" on:click={exportSnapshot}>
      <Download size={17} />
      <span>Export</span>
    </button>
  </div>
</section>

{#if !canSave}
  <section class="card card-pad offline-banner">Offline: cached jobs are readable, saving is disabled.</section>
{/if}
{#if saveError || rowError}
  <section class="card card-pad error-banner">{saveError || rowError}</section>
{/if}
{#if importMessage}
  <section class="card card-pad success-banner">{importMessage}</section>
{/if}

<section class="grid two">
  <form class="card card-pad form" on:submit|preventDefault={addJob}>
    <div class="field">
      <label for="company">Company</label>
      <input id="company" bind:value={company} disabled={!canSave || saving} autocomplete="organization" />
    </div>
    <div class="field">
      <label for="role">Role</label>
      <input id="role" bind:value={role} disabled={!canSave || saving} autocomplete="off" />
    </div>
    <div class="field">
      <label for="status">Status</label>
      <select id="status" bind:value={status} disabled={!canSave || saving}>
        {#each statuses as item}
          <option value={item}>{item}</option>
        {/each}
      </select>
    </div>
    <div class="field">
      <label for="next-action">Next action</label>
      <input id="next-action" bind:value={nextActionAt} disabled={!canSave || saving} type="date" />
    </div>
    <div class="field wide">
      <label for="notes">Notes</label>
      <textarea id="notes" bind:value={notes} disabled={!canSave || saving} rows="2"></textarea>
    </div>
    <button class="button primary" type="submit" disabled={!canSave || saving}>
      <Plus size={17} />
      <span>{saving ? 'Saving' : 'Add Job'}</span>
    </button>
  </form>

  <div class="card card-pad">
    <strong>Legacy Import</strong>
    {#if summary}
      <dl>
        <div><dt>Jobs</dt><dd>{summary.careers}</dd></div>
        <div><dt>Study sessions</dt><dd>{summary.studySessions}</dd></div>
        <div><dt>Study daily actions</dt><dd>{summary.studyCareerActions}</dd></div>
        <div><dt>High-score games</dt><dd>{summary.highScoreGames}</dd></div>
        <div><dt>Theme</dt><dd>{summary.hasTheme ? 'Found' : 'None'}</dd></div>
      </dl>
      {#each summary.warnings as warning}
        <p class="muted">{warning}</p>
      {/each}
      <button class="button" type="button" disabled={!canSave || importing} on:click={importLegacy}>
        <Upload size={17} />
        <span>{importing ? 'Importing' : 'Import Legacy Data'}</span>
      </button>
      {#if importedLegacy}
        <div class="import-summary">
          <span>Last import</span>
          <strong>{importedLegacy.importedAt ? displayUpdated(importedLegacy.importedAt) : 'Recorded'}</strong>
          <small>{importedLegacy.jobs ?? 0} jobs, {importedLegacy.studySessions ?? 0} study sessions</small>
        </div>
      {/if}
    {:else}
      <p class="muted">Scanning local browser data.</p>
    {/if}
  </div>
</section>

<section class="table-toolbar" aria-label="Career filters">
  <div class="field">
    <label for="job-search">Search</label>
    <div class="search-box">
      <Search size={16} />
      <input id="job-search" bind:value={searchQuery} placeholder="Company, role, or notes" />
    </div>
  </div>
  <div class="field">
    <label for="status-filter">Status</label>
    <select id="status-filter" bind:value={statusFilter}>
      <option value="all">All statuses</option>
      {#each statuses as item}
        <option value={item}>{item}</option>
      {/each}
    </select>
  </div>
  <div class="filter-count">{filteredJobs.length} / {jobs.length} jobs</div>
</section>

<section class="card table-card">
  <table>
    <thead>
      <tr>
        <th>Company</th>
        <th>Role</th>
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
            <td><input class="table-input" bind:value={jobDraft.company} disabled={rowBusyId === job.id} /></td>
            <td><input class="table-input" bind:value={jobDraft.role} disabled={rowBusyId === job.id} /></td>
            <td>
              <select class="table-select" bind:value={jobDraft.status} disabled={rowBusyId === job.id}>
                {#each statuses as item}
                  <option value={item}>{item}</option>
                {/each}
              </select>
            </td>
            <td><input class="table-input" bind:value={jobDraft.nextActionAt} disabled={rowBusyId === job.id} type="date" /></td>
            <td><textarea class="table-textarea" bind:value={jobDraft.notes} disabled={rowBusyId === job.id} rows="2"></textarea></td>
            <td>{displayUpdated(job.updatedAt)}</td>
            <td class="actions-cell">
              <div class="row-actions">
                <button class="icon-button" type="button" aria-label="Save job" title="Save job" disabled={!canSave || rowBusyId === job.id} on:click={() => saveJobEdit(job)}>
                  <Save size={16} />
                </button>
                <button class="icon-button" type="button" aria-label="Cancel job edit" title="Cancel" disabled={rowBusyId === job.id} on:click={cancelEditJob}>
                  <X size={16} />
                </button>
              </div>
            </td>
          {:else}
            <td>{job.company}</td>
            <td>{job.role}</td>
            <td>{job.status}</td>
            <td>{displayDate(job.nextActionAt)}</td>
            <td class="notes-cell">{job.notes || 'None'}</td>
            <td>{displayUpdated(job.updatedAt)}</td>
            <td class="actions-cell">
              <div class="row-actions">
                <button class="icon-button" type="button" aria-label={`Edit ${job.company}`} title="Edit" disabled={!canSave || !!editingJobId || rowBusyId === job.id} on:click={() => startEditJob(job)}>
                  <Edit3 size={16} />
                </button>
                <button class="icon-button danger" type="button" aria-label={`Delete ${job.company}`} title="Delete" disabled={!canSave || rowBusyId === job.id} on:click={() => deleteJob(job)}>
                  <Trash2 size={16} />
                </button>
              </div>
            </td>
          {/if}
        </tr>
      {:else}
        <tr>
          <td colspan="7" class="muted">{jobs.length ? 'No jobs match the current filters.' : 'No new jobs in this Svelte workspace yet.'}</td>
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
    align-items: center;
    color: var(--muted);
    font-weight: 800;
  }

  .table-card {
    overflow: auto;
  }

  .notes-cell {
    min-width: 180px;
    max-width: 280px;
    white-space: pre-wrap;
  }

  .table-input,
  .table-select,
  .table-textarea {
    min-width: 128px;
    padding: 8px 9px;
  }

  .table-textarea {
    min-width: 190px;
    resize: vertical;
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

  @media (max-width: 820px) {
    .table-toolbar {
      grid-template-columns: 1fr;
    }
  }
</style>
