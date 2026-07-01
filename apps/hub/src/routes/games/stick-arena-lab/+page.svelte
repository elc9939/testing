<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { RotateCcw, Save } from 'lucide-svelte';
  import type { StickArenaLabHandle } from '@mini-hub/game-engine';
  import { canAutoSave, clientData, type ClientDataState } from '$lib/client-data';
  import { hubHref } from '$lib/routes';
  import { compactServiceIssueIfRecognized } from '$lib/service-issues';

  let mount: HTMLDivElement;
  let lab: StickArenaLabHandle | null = null;
  let status = 'Loading engine';
  let telemetry: string[] = [];
  let saveStatus = '';
  let saving = false;
  let startedAt = Date.now();

  interface StickArenaLabControlState {
    saving: boolean;
    labReady: boolean;
    labLoading: boolean;
    canSave: boolean;
    clientInitialized: boolean;
    clientOnline: boolean;
    clientStatus: string;
    clientError: string;
    status: string;
  }

  $: canSave = canAutoSave($clientData);
  $: labReady = Boolean(lab);
  $: labLoading = !labReady && status === 'Loading engine';
  $: labControlBusy = saving;
  $: resetDisabled = !labReady || labControlBusy;
  $: saveDisabled = !labReady || !canSave || saving;
  $: saveCapabilityStatus = labReady ? gameRunSaveStatus($clientData) : labLoading ? 'Engine loading' : 'Engine unavailable';
  $: visibleEngineStatus = compactStickArenaLabIssue(status, 'Game engine');
  $: visibleSaveStatus = saveStatus ? compactStickArenaLabIssue(saveStatus, 'Stick Arena save') : saveCapabilityStatus;
  $: stickArenaLabControlState = {
    saving,
    labReady,
    labLoading,
    canSave,
    clientInitialized: $clientData.initialized,
    clientOnline: $clientData.isOnline,
    clientStatus: $clientData.status,
    clientError: $clientData.error,
    status
  };
  $: resetButtonTitle = resetTitle(stickArenaLabControlState);
  $: saveButtonTitle = saveTitle(stickArenaLabControlState);

  function resetTitle(state: Pick<StickArenaLabControlState, 'saving' | 'labReady' | 'labLoading' | 'status'>): string {
    if (state.saving) return 'Wait for the current run save to finish before resetting.';
    if (state.labReady) return 'Reset the local ability lab.';
    if (state.labLoading) return 'Wait for the game engine to finish loading.';
    return `Game engine is unavailable: ${state.status}`;
  }

  function saveTitle(state: StickArenaLabControlState): string {
    if (state.saving) return 'This run is already saving.';
    if (!state.labReady) {
      return state.labLoading
        ? 'Wait for the game engine to finish loading before saving.'
        : `Game engine is unavailable: ${state.status}`;
    }
    if (!state.canSave) return gameRunSaveBlockedReason(state);
    return 'Save this run to Mini Hub.';
  }

  function gameRunSaveStatus(state: ClientDataState): string {
    if (canAutoSave(state)) return 'Ready to save runs through Mini Hub.';
    if (!state.initialized) return 'Opening saved game data';
    if (state.error) return 'API not ready';
    if (!state.isOnline) return 'Offline read-only';
    if (state.status === 'syncing') return 'Syncing';
    return 'API not ready';
  }

  function gameRunSaveBlockedReason(
    state: Pick<StickArenaLabControlState, 'clientInitialized' | 'clientOnline' | 'clientStatus' | 'clientError'>
  ): string {
    if (!state.clientInitialized) return 'Loading local cache before game run saves are enabled.';
    if (!state.clientOnline) return 'Offline read-only: connect the Mini Hub API before saving game runs.';
    if (state.clientError) return `Mini Hub API is not ready for game saves: ${compactStickArenaLabIssue(state.clientError, 'Mini Hub API')}`;
    if (state.clientStatus === 'syncing') return 'Game run saves wait while Mini Hub sync is running.';
    return `Game run saves wait for Mini Hub status ${state.clientStatus}.`;
  }

  function compactStickArenaLabIssue(message = '', label = 'Stick Arena Lab'): string {
    const text = message.trim();
    if (!text) return '';
    const compact = compactServiceIssueIfRecognized(text, label);
    return compact === text && text.length > 120 ? `${text.slice(0, 117)}...` : compact;
  }

  function telemetryEmptyMessage(state: Pick<StickArenaLabControlState, 'labReady' | 'labLoading' | 'saving' | 'status'>): string {
    if (state.labLoading) return 'Waiting for the game engine to load before telemetry starts.';
    if (!state.labReady) return `Telemetry is unavailable because the game engine did not load (${state.status}).`;
    if (state.saving) return 'Run save is in progress; recent telemetry stays visible after the save finishes.';
    return 'Telemetry is ready; interact with the arena or reset the lab to capture recent events.';
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
      saveStatus = gameRunSaveBlockedReason(stickArenaLabControlState);
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
      saveStatus = 'Run saved to Mini Hub.';
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
    <button class="button" type="button" disabled={resetDisabled} title={resetButtonTitle} on:click={resetLab}>
      <RotateCcw size={17} />
      <span>Reset</span>
    </button>
    <button class="button" type="button" disabled={saveDisabled} title={saveButtonTitle} on:click={() => saveRun()}>
      <Save size={17} />
      <span>{saving ? 'Saving' : 'Save Run'}</span>
    </button>
  </div>
</section>

{#if !canSave}
  <section class="card card-pad offline-banner">
    <span>The lab is playable; {gameRunSaveBlockedReason(stickArenaLabControlState)}</span>
    <a href={hubHref('/settings#data-recovery')} title="Open Settings Data & Recovery for game save/cache status.">Open Settings</a>
  </section>
{/if}

{#if !labReady}
  <section class="card card-pad engine-banner">
    <span title={labLoading ? undefined : `Raw Stick Arena engine error: ${status}`}>
      {labLoading ? 'Loading game engine: reset and save are disabled until the lab is ready.' : `Game engine unavailable: ${visibleEngineStatus}`}
    </span>
  </section>
{/if}

<section class="lab-layout">
  <div class="arena card" bind:this={mount} aria-label="Stick Arena Pixi Rapier canvas"></div>
  <aside class="card card-pad">
    <strong>Status</strong>
    <p class="muted" title={`Raw Stick Arena engine status: ${status}`}>{visibleEngineStatus}</p>
    <strong>Saving</strong>
    <p class="muted" title={saveStatus ? `Raw Stick Arena save status: ${saveStatus}` : saveCapabilityStatus}>{visibleSaveStatus}</p>
    <strong>Telemetry</strong>
    {#if telemetry.length}
      <ul>
        {#each telemetry as item}
          <li>{item}</li>
        {/each}
      </ul>
    {:else}
      <p class="muted">{telemetryEmptyMessage(stickArenaLabControlState)}</p>
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
