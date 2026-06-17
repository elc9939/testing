<script lang="ts">
  import { onMount } from 'svelte';
  import { Cloud, Download, Monitor, Moon, Sun } from 'lucide-svelte';
  import { apiUrl, getHealth } from '$lib/api';
  import { clientData } from '$lib/client-data';
  import { setTheme, theme, type ThemeMode } from '$lib/theme';

  let apiStatus = 'Not checked';
  let settingsError = '';
  let themeSaving = false;
  $: legacyImport = $clientData.settings?.recentState?.legacyImport as { importedAt?: string } | undefined;

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

<section class="card card-pad settings-panel">
  <div class="panel-block">
    <div class="section-title">
      <Sun size={18} />
      <strong>Appearance</strong>
    </div>
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

  <div class="panel-block">
    <div class="section-title">
      <Cloud size={18} />
      <strong>Personal Sync</strong>
    </div>
    <dl>
      <div><dt>Mode</dt><dd>{$clientData.isOnline ? 'Online auto-save' : 'Offline read-only'}</dd></div>
      <div><dt>Status</dt><dd>{$clientData.status}</dd></div>
      <div><dt>Last synced</dt><dd>{$clientData.lastSyncedAt ? new Date($clientData.lastSyncedAt).toLocaleString() : 'Never'}</dd></div>
      <div><dt>Legacy</dt><dd>{legacyImport?.importedAt ? `Imported ${new Date(legacyImport.importedAt).toLocaleDateString()}` : 'Auto'}</dd></div>
      <div><dt>Device</dt><dd>{$clientData.deviceId}</dd></div>
      <div><dt>API</dt><dd>{apiUrl}</dd></div>
      <div><dt>API check</dt><dd>{apiStatus}</dd></div>
      <div><dt>Local DB</dt><dd>{import.meta.env.PUBLIC_PGLITE_DATA_DIR || 'idb://mini-hub'}</dd></div>
    </dl>
    <div class="action-row">
      <button class="button" type="button" on:click={syncNow}>
        <Cloud size={17} />
        <span>Sync Now</span>
      </button>
      <button class="button" type="button" on:click={exportCache}>
        <Download size={17} />
        <span>Export Cache</span>
      </button>
    </div>
    {#if settingsError || $clientData.error}
      <p class="sync-error">{settingsError || $clientData.error}</p>
    {/if}
  </div>
</section>

<style>
  .settings-panel {
    display: grid;
    gap: 16px;
    max-width: 980px;
  }

  .panel-block {
    display: grid;
    gap: 10px;
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
    gap: 0;
    margin: 0;
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
  }

  dl div {
    padding: 9px 10px;
    border-right: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
    background: var(--surface-muted);
  }

  dl div:nth-child(4n) {
    border-right: 0;
  }

  dl div:nth-last-child(-n + 4) {
    border-bottom: 0;
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

    dl div,
    dl div:nth-child(4n),
    dl div:nth-last-child(-n + 4) {
      border-right: 0;
      border-bottom: 1px solid var(--border);
    }

    dl div:last-child {
      border-bottom: 0;
    }
  }
</style>
