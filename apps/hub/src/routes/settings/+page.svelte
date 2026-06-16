<script lang="ts">
  import { onMount } from 'svelte';
  import { Cloud, Database, Download, KeyRound, ShieldCheck, Upload } from 'lucide-svelte';
  import { apiUrl, getHealth } from '$lib/api';
  import { clientData } from '$lib/client-data';

  let apiStatus = 'Not checked';
  let syncKeyDraft = '';
  let settingsError = '';

  async function checkApi(): Promise<void> {
    apiStatus = 'Checking';
    try {
      const health = await getHealth();
      apiStatus = `${health.service}: ${health.ok ? 'ok' : 'not ok'}`;
    } catch (error) {
      apiStatus = error instanceof Error ? error.message : 'API unavailable';
    }
  }

  async function saveSyncKey(): Promise<void> {
    settingsError = '';
    try {
      await clientData.setSyncKey(syncKeyDraft);
    } catch (error) {
      settingsError = error instanceof Error ? error.message : 'Sync key save failed';
    }
  }

  async function syncNow(): Promise<void> {
    settingsError = '';
    try {
      await clientData.syncNow();
    } catch (error) {
      settingsError = error instanceof Error ? error.message : 'Sync failed';
    }
  }

  async function importLegacy(): Promise<void> {
    settingsError = '';
    try {
      await clientData.importLegacySnapshot(localStorage);
    } catch (error) {
      settingsError = error instanceof Error ? error.message : 'Legacy import failed';
    }
  }

  function exportCache(): void {
    const blob = new Blob([JSON.stringify($clientData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'mini-hub-sync-cache.json';
    link.click();
    URL.revokeObjectURL(url);
  }

  onMount(() => {
    void clientData.init();
    syncKeyDraft = $clientData.syncKey;
    void checkApi();
  });
</script>

<section class="page-header">
  <div>
    <p class="eyebrow">Settings</p>
    <h1>Workspace</h1>
  </div>
  <button class="button" type="button" on:click={checkApi}>
    <Cloud size={17} />
    <span>Check API</span>
  </button>
</section>

<section class="grid three">
  <div class="card card-pad setting">
    <ShieldCheck size={22} />
    <strong>Auth</strong>
    <span>{import.meta.env.PUBLIC_SYNC_MODE || 'personal'} mode with private sync key</span>
  </div>
  <div class="card card-pad setting">
    <Database size={22} />
    <strong>Local DB</strong>
    <span>{import.meta.env.PUBLIC_PGLITE_DATA_DIR || 'idb://mini-hub'}</span>
  </div>
  <div class="card card-pad setting">
    <Cloud size={22} />
    <strong>API</strong>
    <span>{apiUrl}</span>
    <span class="muted">{apiStatus}</span>
  </div>
</section>

<section class="card card-pad sync-panel">
  <div class="section-title">
    <KeyRound size={18} />
    <strong>Personal Sync Key</strong>
  </div>
  <div class="sync-grid">
    <div class="field">
      <label for="sync-key">Private key</label>
      <input id="sync-key" bind:value={syncKeyDraft} type="password" autocomplete="off" />
    </div>
    <button class="button primary" type="button" on:click={saveSyncKey}>Save Key</button>
    <button class="button" type="button" on:click={() => clientData.clearSyncKey()}>Clear</button>
  </div>
  <dl>
    <div><dt>Device</dt><dd>{$clientData.deviceId}</dd></div>
    <div><dt>Mode</dt><dd>{$clientData.isOnline ? 'Online auto-save' : 'Offline read-only'}</dd></div>
    <div><dt>Status</dt><dd>{$clientData.status}</dd></div>
    <div><dt>Last synced</dt><dd>{$clientData.lastSyncedAt ? new Date($clientData.lastSyncedAt).toLocaleString() : 'Never'}</dd></div>
  </dl>
  <div class="action-row">
    <button class="button" type="button" on:click={syncNow}>
      <Cloud size={17} />
      <span>Sync Now</span>
    </button>
    <button class="button" type="button" disabled={!$clientData.syncKey || !$clientData.isOnline} on:click={importLegacy}>
      <Upload size={17} />
      <span>Import Legacy</span>
    </button>
    <button class="button" type="button" on:click={exportCache}>
      <Download size={17} />
      <span>Export Cache</span>
    </button>
  </div>
  {#if settingsError || $clientData.error}
    <p class="sync-error">{settingsError || $clientData.error}</p>
  {/if}
</section>

<style>
  .setting {
    display: grid;
    gap: 8px;
    min-height: 150px;
    align-content: start;
  }

  .setting span {
    color: #64748b;
    overflow-wrap: anywhere;
  }

  .sync-panel {
    display: grid;
    gap: 14px;
    margin-top: 14px;
  }

  .section-title {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .sync-grid {
    display: grid;
    grid-template-columns: minmax(220px, 1fr) auto auto;
    gap: 10px;
    align-items: end;
  }

  dl {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 10px;
    margin: 0;
  }

  dl div {
    padding: 10px;
    border: 1px solid #dfe5ee;
    border-radius: 6px;
    background: #f8fafc;
  }

  dt {
    color: #64748b;
    font-size: 12px;
    font-weight: 800;
  }

  dd {
    margin: 4px 0 0;
    overflow-wrap: anywhere;
    font-weight: 800;
  }

  .sync-error {
    margin: 0;
    color: #944700;
    font-weight: 800;
  }

  @media (max-width: 820px) {
    .sync-grid,
    dl {
      grid-template-columns: 1fr;
    }
  }
</style>
