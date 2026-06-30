<script lang="ts">
  import { onMount } from 'svelte';
  import { ArrowRight, Gamepad2 } from 'lucide-svelte';
  import { canAutoSave, clientData, type ClientDataState } from '$lib/client-data';
  import { hubHref, legacyHref } from '$lib/routes';

  $: gameRunCount = $clientData.gameRuns.length;
  $: gameStateCount = $clientData.gameStates.length;
  $: lastGameRun = $clientData.gameRuns[0] ?? null;
  $: gameSaveReady = canAutoSave($clientData);
  $: gameSaveMode = gameSaveReady ? 'API-backed saves enabled' : $clientData.initialized ? 'Offline/read-only until API is ready' : 'Opening saved game data';
  $: gameSaveDetail = gameSaveReady
    ? 'Supported game runs and state save through the Mini Hub API, then reload from the local browser cache.'
    : gameSaveBlockedDetail($clientData);
  $: lastGameRunLabel = lastGameRun ? new Date(lastGameRun.updatedAt).toLocaleString() : 'No saved game run in cache.';

  function gameSaveBlockedDetail(state: ClientDataState): string {
    if (!state.initialized) return 'Opening the browser cache before game save status is known.';
    if (state.error) return `Games remain playable, but API-backed run/state saves are disabled: ${state.error}`;
    if (!state.isOnline) return 'Games remain playable, but API-backed run/state saves are disabled until Mini Hub reconnects.';
    if (state.status === 'syncing') return 'Games remain playable; save controls wait while Mini Hub sync is running.';
    return `Games remain playable, but API-backed run/state saves wait for Mini Hub status ${state.status}.`;
  }

  onMount(() => {
    void clientData.init();
  });
</script>

<svelte:head>
  <title>Games - Mini Hub</title>
</svelte:head>

<section class="page-header">
  <div>
    <p class="eyebrow">Games</p>
    <h1>Play Surfaces</h1>
  </div>
</section>

<section class="card card-pad save-recovery-strip" aria-label="Games save and recovery status">
  <div>
    <span>Save Mode</span>
    <strong>{gameSaveMode}</strong>
    <small>{gameSaveDetail}</small>
  </div>
  <div>
    <span>Cached Runs</span>
    <strong>{gameRunCount}</strong>
    <small>Last run: {lastGameRunLabel}</small>
  </div>
  <div>
    <span>Cached State</span>
    <strong>{gameStateCount}</strong>
    <small>Stick Arena uses API/cache saves; legacy games keep their existing local behavior.</small>
  </div>
  <a class="button compact" href={hubHref('/settings#data-recovery')} title="Open Settings Data & Recovery for game cache and API status.">
    <span>Recovery</span>
    <ArrowRight size={15} />
  </a>
</section>

<section class="grid two">
  <a class="card game-link" href={hubHref('/games/stick-arena-lab')} title="Open Stick Arena Ability Lab.">
    <Gamepad2 size={22} />
    <div>
      <strong>Stick Arena Ability Lab</strong>
      <p>Pixi rendering, Rapier bodies, ledges, crates, knockback, and reset telemetry.</p>
    </div>
    <ArrowRight size={18} />
  </a>

  <a class="card game-link legacy" href={legacyHref()} title="Open the legacy arcade.">
    <Gamepad2 size={22} />
    <div>
      <strong>Legacy Arcade</strong>
      <p>The existing Canvas games stay available while each rewrite surface reaches parity.</p>
    </div>
    <ArrowRight size={18} />
  </a>
</section>

<style>
  .game-link {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 14px;
    align-items: center;
    padding: 18px;
    color: var(--text);
    text-decoration: none;
  }

  .game-link p {
    margin: 5px 0 0;
    color: var(--muted);
  }

  .save-recovery-strip {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr)) auto;
    gap: 12px;
    align-items: center;
    margin-bottom: 12px;
  }

  .save-recovery-strip div {
    display: grid;
    gap: 4px;
    min-width: 0;
  }

  .save-recovery-strip span {
    color: var(--muted);
    font-size: 12px;
    font-weight: 800;
    text-transform: uppercase;
  }

  .save-recovery-strip small {
    color: var(--muted);
    line-height: 1.35;
  }

  .legacy {
    border-style: dashed;
  }

  @media (max-width: 860px) {
    .save-recovery-strip {
      grid-template-columns: 1fr;
    }
  }
</style>
