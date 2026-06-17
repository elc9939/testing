<script lang="ts">
  import { onMount } from 'svelte';
  import { BarChart3, RefreshCw } from 'lucide-svelte';

  let plotHost: HTMLDivElement;
  let sparklinePath = '';
  let status = 'Preparing browser analytics';

  const rows = [
    { label: 'Career leads', value: 12 },
    { label: 'Study sessions', value: 8 },
    { label: 'Game runs', value: 21 },
    { label: 'Sync events', value: 17 }
  ];

  async function render(): Promise<void> {
    status = 'Loading Plot and D3';
    const analytics = await import('@mini-hub/db/analytics');
    await analytics.renderMetricBars(plotHost, rows);
    sparklinePath = analytics.buildSparklinePath([2, 5, 4, 8, 10, 9, 14, 12]);
    status = 'Rendered';
  }

  onMount(render);
</script>

<section class="page-header">
  <div>
    <p class="eyebrow">Analytics</p>
    <h1>Local Insights</h1>
  </div>
  <button class="button" type="button" on:click={render}>
    <RefreshCw size={17} />
    <span>Refresh</span>
  </button>
</section>

<section class="grid two">
  <div class="card card-pad">
    <div class="section-title">
      <BarChart3 size={18} />
      <strong>Workspace Mix</strong>
    </div>
    <div class="plot" bind:this={plotHost}></div>
    <p class="muted">{status}</p>
  </div>

  <div class="card card-pad">
    <strong>Trend</strong>
    <svg class="sparkline" viewBox="0 0 240 64" role="img" aria-label="Sample trend">
      <path d={sparklinePath} />
    </svg>
    <p class="muted">DuckDB-Wasm is reserved for CSV and LogMiner-style imports on this route.</p>
  </div>
</section>

<style>
  .section-title {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
  }

  .plot {
    min-height: 220px;
  }

  .sparkline {
    display: block;
    width: 100%;
    max-width: 420px;
    height: auto;
    margin: 14px 0;
  }

  .sparkline path {
    fill: none;
    stroke: var(--accent);
    stroke-width: 4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>
