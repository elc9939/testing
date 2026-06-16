<script lang="ts">
  import { onMount } from 'svelte';
  import { Plus, RefreshCw } from 'lucide-svelte';
  import type { LegacyImportSummary } from '@mini-hub/db/migration';
  import { canAutoSave, clientData } from '$lib/client-data';

  let summary: LegacyImportSummary | null = null;
  let subject = 'Exam P';
  let minutes = 30;
  let saveError = '';
  let saving = false;

  $: canSave = canAutoSave($clientData);
  $: logs = $clientData.studySessions;

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

  $: totalMinutes = logs.reduce((sum, item) => sum + item.minutes, 0);

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
  <section class="card card-pad offline-banner">Offline or missing sync key: cached study logs are readable, saving is disabled.</section>
{/if}
{#if saveError}
  <section class="card card-pad error-banner">{saveError}</section>
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
    <span>Total Minutes</span>
    <strong>{totalMinutes}</strong>
  </div>

  <div class="card card-pad metric">
    <span>Legacy Days</span>
    <strong>{summary?.studyDays ?? 0}</strong>
  </div>
</section>

<section class="card table-card">
  <table>
    <thead>
      <tr>
        <th>Subject</th>
        <th>Minutes</th>
        <th>Logged</th>
      </tr>
    </thead>
    <tbody>
      {#each logs as log}
        <tr>
          <td>{log.subject}</td>
          <td>{log.minutes}</td>
          <td>{new Date(log.loggedAt).toLocaleString()}</td>
        </tr>
      {:else}
        <tr>
          <td colspan="3" class="muted">No study logs in this Svelte workspace yet.</td>
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

  .metric span {
    color: #64748b;
    font-weight: 700;
  }

  .metric strong {
    font-size: 42px;
    line-height: 1;
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
