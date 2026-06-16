<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { RotateCcw, Save } from 'lucide-svelte';
  import type { StickArenaLabHandle } from '@mini-hub/game-engine';
  import { canAutoSave, clientData } from '$lib/client-data';

  let mount: HTMLDivElement;
  let lab: StickArenaLabHandle | null = null;
  let status = 'Loading engine';
  let telemetry: string[] = [];
  let saveStatus = '';
  let startedAt = Date.now();

  $: canSave = canAutoSave($clientData);

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
    if (!canSave) return;
    saveStatus = 'Saving';
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
    }
  }

  async function resetLab(): Promise<void> {
    lab?.reset();
    startedAt = Date.now();
    await saveRun('reset');
  }
</script>

<section class="page-header">
  <div>
    <p class="eyebrow">Stick Arena</p>
    <h1>Ability Lab</h1>
  </div>
  <div class="action-row">
    <button class="button" type="button" on:click={resetLab}>
      <RotateCcw size={17} />
      <span>Reset</span>
    </button>
    <button class="button" type="button" disabled={!canSave} on:click={() => saveRun()}>
      <Save size={17} />
      <span>Save Run</span>
    </button>
  </div>
</section>

<section class="lab-layout">
  <div class="arena card" bind:this={mount} aria-label="Stick Arena Pixi Rapier canvas"></div>
  <aside class="card card-pad">
    <strong>Status</strong>
    <p class="muted">{status}</p>
    <strong>Saving</strong>
    <p class="muted">{canSave ? saveStatus || 'Ready' : 'Offline read-only or sync key missing'}</p>
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
    background: #10121f;
  }

  .arena :global(canvas) {
    display: block;
    width: 100%;
    height: 100%;
  }

  ul {
    margin: 8px 0 0;
    padding-left: 18px;
    color: #475569;
    font-size: 13px;
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
