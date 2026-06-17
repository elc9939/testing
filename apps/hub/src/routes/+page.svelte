<script lang="ts">
  import { ArrowRight, DatabaseZap, Gamepad2, ShieldCheck } from 'lucide-svelte';
  import { launcherEntries } from '@mini-hub/core';
  import { statusLabel } from '@mini-hub/ui';
  import { hubHref } from '$lib/routes';
</script>

<section class="page-header">
  <div>
    <p class="eyebrow">Today</p>
    <h1>Mini Hub</h1>
  </div>
  <a class="button primary" href={hubHref('/settings')}>
    <ShieldCheck size={17} />
    <span>Workspace Setup</span>
  </a>
</section>

<section class="status-strip" aria-label="Rewrite status">
  <div>
    <DatabaseZap size={18} />
    <span>Cloud sync and PGlite migration spine</span>
  </div>
  <div>
    <Gamepad2 size={18} />
    <span>Pixi/Rapier game-engine slice</span>
  </div>
  <div>
    <ShieldCheck size={18} />
    <span>Better Auth API boundary</span>
  </div>
</section>

<section class="grid three launcher" aria-label="Launcher">
  {#each launcherEntries as entry}
    <a class="card launch-card" href={hubHref(entry.route)}>
      <div>
        <strong>{entry.name}</strong>
        <span>{entry.group}</span>
      </div>
      <p>{statusLabel(entry.status)}</p>
      <ArrowRight size={18} />
    </a>
  {/each}
</section>

<style>
  .status-strip {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
    margin-bottom: 12px;
  }

  .status-strip div {
    display: flex;
    align-items: center;
    gap: 9px;
    min-height: 38px;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
    color: var(--muted);
  }

  .launcher {
    align-items: stretch;
  }

  .launch-card {
    position: relative;
    display: grid;
    min-height: 108px;
    padding: 12px;
    overflow: hidden;
    color: var(--text);
    text-decoration: none;
  }

  .launch-card::before {
    content: "";
    position: absolute;
    inset: 0 auto 0 0;
    width: 5px;
    background: var(--accent);
  }

  .launch-card div {
    display: grid;
    gap: 4px;
  }

  .launch-card strong {
    font-size: 15px;
  }

  .launch-card span,
  .launch-card p {
    margin: 0;
    color: var(--muted);
  }

  .launch-card :global(svg) {
    align-self: end;
    justify-self: end;
  }

  @media (max-width: 820px) {
    .status-strip {
      grid-template-columns: 1fr;
    }
  }
</style>
