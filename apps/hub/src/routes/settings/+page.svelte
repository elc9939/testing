<script lang="ts">
  import { onMount } from 'svelte';
  import { Cloud, Database, Download, Monitor, Moon, ShieldCheck, Sun, Upload } from 'lucide-svelte';
  import { apiUrl, getHealth } from '$lib/api';
  import { clientData } from '$lib/client-data';
  import { setTheme, theme, type ThemeMode } from '$lib/theme';

  let apiStatus = 'Not checked';
  let settingsError = '';
  let themeSaving = false;

  async function checkApi(): Promise<void> {
    apiStatus = 'Checking';
    try {
      const health = await getHealth();
      apiStatus = `${health.service}: ${health.ok ? 'ok' : 'not ok'}`;
    } catch (error) {
      apiStatus = error instanceof Error ? error.message : 'API unavailable';
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

  async function chooseTheme(mode: ThemeMode): Promise<void> {
    settingsError = '';
    setTheme(mode);
    if (!$clientData.isOnline) return;
    themeSaving = true;
    try {
      await clientData.saveSettings({ theme: mode });
    } catch (error) {
      settingsError = error instanceof Error ? error.message : 'Theme save failed';
    } finally {
      themeSaving = false;
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
    <span>{import.meta.env.PUBLIC_SYNC_MODE || 'personal'} local workspace</span>
  </div>
  <div class="card card-pad setting">
    <Sun size={22} />
    <strong>Appearance</strong>
    <div class="theme-segment" aria-label="Theme">
      <button class:active={$theme === 'system'} type="button" aria-pressed={$theme === 'system'} disabled={themeSaving} on:click={() => chooseTheme('system')}>
        <Monitor size={15} />
        <span>System</span>
      </button>
      <button class:active={$theme === 'light'} type="button" aria-pressed={$theme === 'light'} disabled={themeSaving} on:click={() => chooseTheme('light')}>
        <Sun size={15} />
        <span>Light</span>
      </button>
      <button class:active={$theme === 'dark'} type="button" aria-pressed={$theme === 'dark'} disabled={themeSaving} on:click={() => chooseTheme('dark')}>
        <Moon size={15} />
        <span>Dark</span>
      </button>
    </div>
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
    <Cloud size={18} />
    <strong>Personal Sync</strong>
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
    <button class="button" type="button" disabled={!$clientData.isOnline} on:click={importLegacy}>
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
    min-height: 112px;
    align-content: start;
  }

  .setting span {
    color: var(--muted);
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

  .theme-segment {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 2px;
    padding: 2px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface-muted);
  }

  .theme-segment button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: 30px;
    border: 0;
    border-radius: 4px;
    color: var(--muted);
    background: transparent;
    cursor: pointer;
  }

  .theme-segment button.active {
    color: var(--text);
    background: var(--surface);
    box-shadow: inset 0 0 0 1px var(--border);
  }

  .theme-segment button:disabled {
    cursor: progress;
    opacity: 0.72;
  }

  dl {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 10px;
    margin: 0;
  }

  dl div {
    padding: 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface-muted);
  }

  dt {
    color: var(--muted);
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
    color: var(--error-text);
    font-weight: 800;
  }

  @media (max-width: 820px) {
    dl {
      grid-template-columns: 1fr;
    }
  }
</style>
