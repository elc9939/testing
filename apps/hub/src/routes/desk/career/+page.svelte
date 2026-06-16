<script lang="ts">
  import { onMount } from 'svelte';
  import { Download, Plus, RefreshCw } from 'lucide-svelte';
  import type { LegacyImportSummary } from '@mini-hub/db/migration';
  import { canAutoSave, clientData } from '$lib/client-data';

  let summary: LegacyImportSummary | null = null;
  let company = '';
  let role = '';
  let status = 'lead';
  let saveError = '';
  let saving = false;

  $: canSave = canAutoSave($clientData);
  $: jobs = $clientData.jobs;

  async function refreshSummary(): Promise<void> {
    const { inspectLegacyStorage } = await import('@mini-hub/db/migration');
    summary = inspectLegacyStorage(localStorage);
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
        notes: ''
      });
      company = '';
      role = '';
      status = 'lead';
    } catch (error) {
      saveError = error instanceof Error ? error.message : 'Save failed';
    } finally {
      saving = false;
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
  <section class="card card-pad offline-banner">Offline or missing sync key: cached jobs are readable, saving is disabled.</section>
{/if}
{#if saveError}
  <section class="card card-pad error-banner">{saveError}</section>
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
        <option value="lead">Lead</option>
        <option value="applied">Applied</option>
        <option value="interview">Interview</option>
        <option value="offer">Offer</option>
      </select>
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
        <div><dt>High-score games</dt><dd>{summary.highScoreGames}</dd></div>
        <div><dt>Theme</dt><dd>{summary.hasTheme ? 'Found' : 'None'}</dd></div>
      </dl>
      {#each summary.warnings as warning}
        <p class="muted">{warning}</p>
      {/each}
    {:else}
      <p class="muted">Scanning local browser data.</p>
    {/if}
  </div>
</section>

<section class="card table-card">
  <table>
    <thead>
      <tr>
        <th>Company</th>
        <th>Role</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>
      {#each jobs as job}
        <tr>
          <td>{job.company}</td>
          <td>{job.role}</td>
          <td>{job.status}</td>
        </tr>
      {:else}
        <tr>
          <td colspan="3" class="muted">No new jobs in this Svelte workspace yet.</td>
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
    color: #64748b;
  }

  dd {
    margin: 0;
    font-weight: 800;
  }

  .table-card {
    margin-top: 14px;
    overflow: auto;
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
</style>
