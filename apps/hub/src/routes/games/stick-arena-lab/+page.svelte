<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { RotateCcw, Save } from 'lucide-svelte';
  import type { StickArenaLabHandle } from '@mini-hub/game-engine';
  import { canAutoSave, clientData } from '$lib/client-data';
  import { hubHref } from '$lib/routes';

  let mount: HTMLDivElement;
  let lab: StickArenaLabHandle | null = null;
  let status = 'Loading engine';
  let telemetry: string[] = [];
  let saveStatus = '';
  let saving = false;
  let startedAt = Date.now();

  $: canSave = canAutoSave($clientData);
  $: labReady = Boolean(lab);
  $: labLoading = !labReady && status === 'Loading engine';
  $: labControlBusy = saving;
  $: resetDisabled = !labReady || labControlBusy;
  $: saveDisabled = !labReady || !canSave || saving;
  $: saveCapabilityStatus = labReady ? (canSave ? 'Ready' : 'Offline read-only') : labLoading ? 'Engine loading' : 'Engine unavailable';

  function resetTitle(): string {
    if (saving) return 'Wait for the current run save to finish before resetting.';
    if (labReady) return 'Reset the local ability lab.';
    if (labLoading) return 'Wait for the game engine to finish loading.';
    return `Game engine is unavailable: ${status}`;
  }

  function saveTitle(): string {
    if (saving) return 'This run is already saving.';
    if (!labReady) {
      return labLoading
        ? 'Wait for the game engine to finish loading before saving.'
        : `Game engine is unavailable: ${status}`;
    }
    if (!canSave) return 'Start the Mini Hub API before saving game runs.';
    return 'Save this run to Mini Hub.';
  }

  onMount(async () => {
    void clientData.init();
    try {
      const engine = await import('@mini-hub/game-engine');
      lab = await engine.createStickArenaLab(mount, {
        onTelemetry(event) {
          telemetry = [`${event.type}: ${JSON.stringify(event.payload)}`, ...telemetry].slice(0, 5);
        }
      });
      status = 'Running';
    } catch (error) {
      status = error instanceof Error ? error.message : 'Engine failed to load';
    }
  });

  onDestroy(() => {
    lab?.destroy();
  });

  async function saveRun(label = 'manual'): Promise<void> {
    if (!lab) {
      saveStatus = labLoading ? 'Engine is still loading; wait for the lab before saving.' : `Cannot save: game engine is unavailable (${status}).`;
      return;
    }
    if (!canSave) {
      saveStatus = 'Offline read-only: telemetry stays visible, but saving needs the Mini Hub API.';
      return;
    }
    if (saving) return;
    saveStatus = 'Saving';
    saving = true;
    try {
      const durationMs = Date.now() - startedAt;
      await clientData.saveGameRun({
        gameId: 'stick-arena-lab',
        score: telemetry.length,
        durationMs,
        metadata: { label, telemetry }
      });
      await clientData.saveGameState('stick-arena-lab', {
        lastSavedAt: new Date().toISOString(),
        lastDurationMs: durationMs,
        telemetry
      });
      saveStatus = 'Saved';
    } catch (error) {
      saveStatus = error instanceof Error ? error.message : 'Save failed';
    } finally {
      saving = false;
    }
  }

  async function resetLab(): Promise<void> {
    if (!lab) {
      status = labLoading ? 'Engine is still loading.' : status;
      return;
    }
    if (saving) {
      saveStatus = 'Wait for the current save before resetting the lab.';
      return;
    }
    lab?.reset();
    startedAt = Date.now();
    await saveRun('reset');
  }
</script>

<svelte:head>
  <title>Stick Arena Ability Lab - Mini Hub</title>
</svelte:head>

<section class="page-header">
  <div>
    <p class="eyebrow">Stick Arena</p>
    <h1>Ability Lab</h1>
  </div>
  <div class="action-row">
    <button class="button" type="button" disabled={resetDisabled} title={resetTitle()} on:click={resetLab}>
      <RotateCcw size={17} />
      <span>Reset</span>
    </button>
    <button class="button" type="button" disabled={saveDisabled} title={saveTitle()} on:click={() => saveRun()}>
      <Save size={17} />
      <span>{saving ? 'Saving' : 'Save Run'}</span>
    </button>
  </div>
</section>

{#if !canSave}
  <section class="card card-pad offline-banner">
    <span>Offline read-only: the lab is playable, but run saving needs the Mini Hub API.</span>
    <a href={hubHref('/settings')}>Open Settings</a>
  </section>
{/if}

{#if !labReady}
  <section class="card card-pad engine-banner">
    <span>{labLoading ? 'Loading game engine: reset and save are disabled until the lab is ready.' : `Game engine unavailable: ${status}`}</span>
  </section>
{/if}

<section class="lab-layout">
  <div class="arena card" bind:this={mount} aria-label="Stick Arena Pixi Rapier canvas"></div>
  <aside class="card card-pad">
    <strong>Status</strong>
    <p class="muted">{status}</p>
    <strong>Saving</strong>
    <p class="muted">{saveStatus || saveCapabilityStatus}</p>
    <strong>Telemetry</strong>
    {#if telemetry.length}
      <ul>
        {#each telemetry as item}
          <li>{item}</li>
        {/each}
      </ul>
    {:else}
      <p class="muted">No events yet.</p>
    {/if}
  </aside>
</section>

<style>
  .lab-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 280px;
    gap: 14px;
  }

  .arena {
    min-height: min(64vh, 560px);
    overflow: hidden;
    background: var(--code-bg);
  }

  .arena :global(canvas) {
    display: block;
    width: 100%;
    height: 100%;
  }

  ul {
    margin: 8px 0 0;
    padding-left: 18px;
    color: var(--muted);
    font-size: 13px;
  }

  .offline-banner {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
    border-color: var(--warning-border);
    color: var(--warning-text);
    background: var(--warning-bg);
  }

  .engine-banner {
    margin-bottom: 12px;
    border-color: var(--warning-border);
    color: var(--warning-text);
    background: var(--warning-bg);
  }

  .offline-banner a {
    color: inherit;
    font-weight: 850;
  }

  @media (max-width: 900px) {
    .lab-layout {
      grid-template-columns: 1fr;
    }

    .arena {
      min-height: 440px;
    }
  }
</style>
