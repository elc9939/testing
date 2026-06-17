<script lang="ts">
  import { ArrowRight, Gamepad2 } from 'lucide-svelte';
  import { hubHref, legacyHref } from '$lib/routes';
</script>

<section class="page-header">
  <div>
    <p class="eyebrow">Games</p>
    <h1>Play Surfaces</h1>
  </div>
</section>

<section class="grid two">
  <a class="card game-link" href={hubHref('/games/stick-arena-lab')}>
    <Gamepad2 size={22} />
    <div>
      <strong>Stick Arena Ability Lab</strong>
      <p>Pixi rendering, Rapier bodies, ledges, crates, knockback, and reset telemetry.</p>
    </div>
    <ArrowRight size={18} />
  </a>

  <a class="card game-link legacy" href={legacyHref()}>
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

  .legacy {
    border-style: dashed;
  }
</style>
