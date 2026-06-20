<script lang="ts">
  import { onMount } from 'svelte';
  import { Activity, ArrowRight, Cloud, Download, Monitor, Moon, RefreshCw, Save, Sun } from 'lucide-svelte';
  import { getApiUrl, getHealth } from '$lib/api';
  import { getAiOsApiUrl } from '$lib/ai-os-api';
  import {
    capabilityServiceLabel,
    capabilityStateLabel,
    loadCapabilityRegistry,
    selectCapabilityIssues,
    type CapabilityRegistryEntry,
    type CapabilityRegistrySnapshot,
    type CapabilityService
  } from '$lib/capability-registry';
  import { clientData } from '$lib/client-data';
  import {
    formatMachineModeContext,
    machineModeFromPreferences,
    machineModePreferenceKey,
    machineModes,
    type MachineModeDefinition,
    type MachineModeId
  } from '$lib/machine-mode';
  import { getMacroLabApiUrl } from '$lib/macro-lab-api';
  import { getConnections } from '$lib/productivity-api';
  import { hubHref } from '$lib/routes';
  import { localNetworkHint, setServiceEndpoints } from '$lib/service-config';
  import { setTheme, theme, type ThemeMode } from '$lib/theme';

  interface CapabilityServiceGroup {
    service: CapabilityService;
    label: string;
    route: string;
    ready: number;
    total: number;
    issues: number;
    capabilities: CapabilityRegistryEntry[];
  }

  let apiStatus = 'Not checked';
  let settingsError = '';
  let endpointMessage = '';
  let hubApiInput = '';
  let aiOsInput = '';
  let macroLabInput = '';
  let themeSaving = false;
  let modeSaving = false;
  let capabilitySnapshot: CapabilityRegistrySnapshot | null = null;
  let capabilityIssues: CapabilityRegistryEntry[] = [];
  let capabilityGroups: CapabilityServiceGroup[] = [];
  let capabilityLoading = false;
  let capabilityError = '';
  $: legacyImport = $clientData.settings?.recentState?.legacyImport as { importedAt?: string } | undefined;
  $: currentMachineMode = machineModeFromPreferences($clientData.settings?.preferences);
  $: currentMachineModeDetails = formatMachineModeContext(currentMachineMode);
  $: capabilityIssues = selectCapabilityIssues(capabilitySnapshot, 8);
  $: capabilityGroups = groupCapabilityServices(capabilitySnapshot?.capabilities ?? []);

  async function checkApi(): Promise<void> {
    apiStatus = 'Checking';
    try {
      const health = await getHealth();
      apiStatus = `${health.service}: ${health.ok ? 'ok' : 'not ok'}`;
    } catch (error) {
      apiStatus = error instanceof Error ? error.message : 'API unavailable';
    }
  }

  async function checkServices(): Promise<void> {
    await Promise.all([checkApi(), refreshCapabilities()]);
  }

  async function syncNow(): Promise<void> {
    settingsError = '';
    try {
      await clientData.syncNow();
    } catch (error) {
      settingsError = error instanceof Error ? error.message : 'Sync failed';
    }
  }

  function loadEndpointInputs(): void {
    hubApiInput = getApiUrl();
    aiOsInput = getAiOsApiUrl();
    macroLabInput = getMacroLabApiUrl();
  }

  function saveEndpoints(): void {
    setServiceEndpoints({
      hubApi: hubApiInput,
      aiOs: aiOsInput,
      macroLab: macroLabInput
    });
    loadEndpointInputs();
    endpointMessage = 'Saved. Service requests now use these URLs on this browser.';
    void checkServices();
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

  async function chooseMachineMode(mode: MachineModeId): Promise<void> {
    settingsError = '';
    if (!$clientData.isOnline) {
      settingsError = 'Offline read-only mode';
      return;
    }
    modeSaving = true;
    try {
      await clientData.saveSettings({
        preferences: {
          ...($clientData.settings?.preferences ?? {}),
          [machineModePreferenceKey]: mode
        }
      });
    } catch (error) {
      settingsError = error instanceof Error ? error.message : 'Machine mode save failed';
    } finally {
      modeSaving = false;
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

  async function refreshCapabilities(): Promise<void> {
    capabilityLoading = true;
    capabilityError = '';
    try {
      const googleConnected = await loadGoogleConnected();
      capabilitySnapshot = await loadCapabilityRegistry({
        isOnline: $clientData.isOnline,
        syncStatus: $clientData.status,
        syncError: $clientData.error,
        googleConnected
      });
    } catch (error) {
      capabilityError = error instanceof Error ? error.message : 'Capability registry failed to load.';
    } finally {
      capabilityLoading = false;
    }
  }

  async function loadGoogleConnected(): Promise<boolean> {
    try {
      const connections = await getConnections();
      return connections.some((connection) => connection.provider === 'google' && connection.status === 'connected');
    } catch {
      return false;
    }
  }

  function groupCapabilityServices(capabilities: CapabilityRegistryEntry[]): CapabilityServiceGroup[] {
    const order: CapabilityService[] = ['hub', 'browser', 'productivity', 'ai-os', 'macro-lab'];
    return order
      .map((service) => {
        const rows = capabilities.filter((capability) => capability.service === service);
        return {
          service,
          label: capabilityServiceLabel(service),
          route: rows[0]?.route ?? '/settings',
          ready: rows.filter((capability) => capability.state === 'ready' || capability.state === 'running').length,
          total: rows.length,
          issues: rows.filter((capability) => !['ready', 'running'].includes(capability.state)).length,
          capabilities: rows
        };
      })
      .filter((group) => group.total > 0);
  }

  function readyCapabilityCount(snapshot: CapabilityRegistrySnapshot): number {
    return snapshot.summary.ready + snapshot.summary.running;
  }

  function serviceHealthHref(service: CapabilityService): string {
    if (service === 'hub') return `${getApiUrl()}/api/health`;
    if (service === 'ai-os') return `${getAiOsApiUrl()}/api/ai/health`;
    if (service === 'macro-lab') return `${getMacroLabApiUrl()}/api/macro-lab/health`;
    return '';
  }

  function serviceDescription(service: CapabilityService): string {
    if (service === 'hub') return 'Personal data, sync, and integration API.';
    if (service === 'browser') return 'Local cache and read-only offline behavior.';
    if (service === 'productivity') return 'Google Calendar and Gmail workflow access.';
    if (service === 'ai-os') return 'Model routing, local AI, memory, jobs, media, health, and telemetry.';
    return 'Windows automation, macro execution, triggers, clipboard, windows, and files.';
  }

  function capabilityMetricSummary(capability: CapabilityRegistryEntry): string {
    if (!capability.metrics) return capability.requiredService ?? capability.locality;
    const entries = Object.entries(capability.metrics)
      .slice(0, 3)
      .map(([key, value]) => `${key}: ${String(value)}`);
    return entries.join(' · ') || capability.requiredService || capability.locality;
  }

  function modeButtonTitle(mode: MachineModeDefinition): string {
    return `${mode.label}: ${mode.summary}`;
  }

  onMount(() => {
    loadEndpointInputs();
    void clientData.init();
    void checkServices();
  });
</script>

<section class="page-header">
  <div>
    <p class="eyebrow">Settings</p>
    <h1>Workspace</h1>
  </div>
  <button class="button" type="button" disabled={capabilityLoading} on:click={checkServices}>
    <RefreshCw size={17} />
    <span>{capabilityLoading ? 'Checking' : 'Check Services'}</span>
  </button>
</section>

<section class="service-control" aria-label="Service and machine control">
  <div class="service-control-header">
    <div>
      <p class="eyebrow">Machine Control</p>
      <h2>Services And Capabilities</h2>
    </div>
    <button class="button" type="button" disabled={capabilityLoading} on:click={refreshCapabilities}>
      <Activity size={17} />
      <span>{capabilityLoading ? 'Checking' : 'Refresh Capabilities'}</span>
    </button>
  </div>

  <div class="machine-mode-panel">
    <div class="mode-heading">
      <div>
        <strong>Machine Mode</strong>
        <span>{currentMachineMode.summary}</span>
      </div>
      <small>{modeSaving ? 'Saving' : currentMachineMode.label}</small>
    </div>
    <div class="mode-segment" aria-label="Machine mode">
      {#each machineModes as mode}
        <button
          class:active={currentMachineMode.id === mode.id}
          type="button"
          title={modeButtonTitle(mode)}
          aria-pressed={currentMachineMode.id === mode.id}
          disabled={modeSaving || !$clientData.isOnline}
          on:click={() => chooseMachineMode(mode.id)}
        >
          <strong>{mode.shortLabel}</strong>
          <span>{mode.summary}</span>
        </button>
      {/each}
    </div>
    <pre class="mode-context">{currentMachineModeDetails}</pre>
  </div>

  {#if capabilitySnapshot}
    <div class="capability-kpis">
      <div>
        <span>Usable</span>
        <strong>{readyCapabilityCount(capabilitySnapshot)}/{capabilitySnapshot.summary.total}</strong>
      </div>
      <div>
        <span>Local Ready</span>
        <strong>{capabilitySnapshot.summary.localReady}</strong>
      </div>
      <div>
        <span>Needs Setup</span>
        <strong>{capabilitySnapshot.summary.needsSetup}</strong>
      </div>
      <div>
        <span>Repair</span>
        <strong>{capabilitySnapshot.summary.offline + capabilitySnapshot.summary.degraded + capabilitySnapshot.summary.blocked}</strong>
      </div>
    </div>

    {#if capabilityIssues.length}
      <div class="issue-strip" aria-label="Capability issues">
        {#each capabilityIssues as capability}
          <a class="issue-row" href={hubHref(capability.route)}>
            <span class={`state-chip ${capability.state}`}>{capabilityStateLabel(capability.state)}</span>
            <span>
              <strong>{capability.label}</strong>
              <small>{capability.lastError ?? capability.requiredService ?? capability.description}</small>
            </span>
            <ArrowRight size={15} />
          </a>
        {/each}
      </div>
    {:else}
      <p class="helper-text">No capability blockers are visible from this browser.</p>
    {/if}

    <div class="service-list">
      {#each capabilityGroups as group}
        <article class="service-row">
          <div class="service-main">
            <div>
              <strong>{group.label}</strong>
              <span>{serviceDescription(group.service)}</span>
            </div>
            <small>{group.ready}/{group.total} ready · {group.issues} issue{group.issues === 1 ? '' : 's'}</small>
          </div>
          <div class="service-actions">
            <a class="button compact" href={hubHref(group.route)}>
              <span>Open Panel</span>
              <ArrowRight size={15} />
            </a>
            {#if serviceHealthHref(group.service)}
              <a class="button compact" href={serviceHealthHref(group.service)} target="_blank" rel="noreferrer">
                <span>Health</span>
                <ArrowRight size={15} />
              </a>
            {/if}
          </div>
          <div class="capability-mini-list">
            {#each group.capabilities.slice(0, 5) as capability}
              <div class="capability-mini-row">
                <span class={`state-dot ${capability.state}`} aria-hidden="true"></span>
                <span>
                  <strong>{capability.label}</strong>
                  <small>{capabilityMetricSummary(capability)}</small>
                </span>
              </div>
            {/each}
          </div>
        </article>
      {/each}
    </div>
  {:else if capabilityLoading}
    <p class="helper-text">Checking local APIs, Google connection state, AI providers, Macro Lab, and offline cache.</p>
  {:else if capabilityError}
    <p class="sync-error">{capabilityError}</p>
  {:else}
    <p class="helper-text">Capability status has not been checked yet.</p>
  {/if}
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
      <div><dt>API</dt><dd>{getApiUrl()}</dd></div>
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

  <div class="panel-block">
    <div class="section-title">
      <Monitor size={18} />
      <strong>Desktop Services</strong>
    </div>
    <p class="helper-text">{localNetworkHint()}</p>
    <div class="endpoint-grid">
      <div class="field">
        <label for="hub-api-url">Mini Hub API</label>
        <input id="hub-api-url" bind:value={hubApiInput} placeholder="http://192.168.1.25:8787" />
      </div>
      <div class="field">
        <label for="ai-os-url">AI OS API</label>
        <input id="ai-os-url" bind:value={aiOsInput} placeholder="http://192.168.1.25:8791" />
      </div>
      <div class="field">
        <label for="macro-lab-url">Macro Lab API</label>
        <input id="macro-lab-url" bind:value={macroLabInput} placeholder="http://192.168.1.25:8792" />
      </div>
    </div>
    <div class="action-row">
      <button class="button primary" type="button" on:click={saveEndpoints}>
        <Save size={17} />
        <span>Save Service URLs</span>
      </button>
      <button class="button" type="button" on:click={loadEndpointInputs}>
        <Cloud size={17} />
        <span>Reload Values</span>
      </button>
    </div>
    {#if endpointMessage}
      <p class="endpoint-message">{endpointMessage}</p>
    {/if}
  </div>
</section>

<style>
  .settings-panel {
    display: grid;
    gap: 16px;
    max-width: 980px;
  }

  .service-control {
    display: grid;
    gap: 12px;
    max-width: 980px;
    margin-bottom: 12px;
    padding: 14px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
  }

  .service-control-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .service-control-header h2 {
    margin: 0;
    font-size: 17px;
    letter-spacing: 0;
  }

  .machine-mode-panel {
    display: grid;
    gap: 10px;
    padding: 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface-muted);
  }

  .mode-heading {
    display: flex;
    align-items: start;
    justify-content: space-between;
    gap: 10px;
  }

  .mode-heading div {
    display: grid;
    gap: 3px;
    min-width: 0;
  }

  .mode-heading strong {
    font-size: 14px;
  }

  .mode-heading span,
  .mode-heading small {
    color: var(--muted);
  }

  .mode-heading span {
    line-height: 1.35;
  }

  .mode-heading small {
    flex: 0 0 auto;
    font-weight: 800;
  }

  .mode-segment {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(145px, 1fr));
    gap: 6px;
  }

  .mode-segment button {
    display: grid;
    gap: 4px;
    min-width: 0;
    min-height: 86px;
    padding: 9px;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    background: var(--surface);
    text-align: left;
    cursor: pointer;
  }

  .mode-segment button.active {
    border-color: var(--accent);
    box-shadow: inset 0 0 0 1px var(--accent);
  }

  .mode-segment button:disabled {
    cursor: not-allowed;
    opacity: 0.68;
  }

  .mode-segment strong,
  .mode-segment span {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .mode-segment span {
    color: var(--muted);
    font-size: 12px;
    line-height: 1.3;
  }

  .mode-context {
    max-height: 120px;
    margin: 0;
    overflow: auto;
    white-space: pre-wrap;
  }

  .capability-kpis {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
  }

  .capability-kpis div {
    display: grid;
    gap: 3px;
    min-width: 0;
    padding: 10px;
    border-right: 1px solid var(--border);
    background: var(--surface-muted);
  }

  .capability-kpis div:last-child {
    border-right: 0;
  }

  .capability-kpis span,
  .service-main small,
  .capability-mini-row small,
  .issue-row small {
    overflow: hidden;
    color: var(--muted);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .capability-kpis span {
    font-size: 11px;
    font-weight: 800;
    text-transform: uppercase;
  }

  .capability-kpis strong {
    overflow: hidden;
    font-size: 18px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .issue-strip,
  .service-list,
  .capability-mini-list {
    display: grid;
  }

  .issue-strip,
  .service-list {
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
  }

  .issue-row,
  .service-row {
    border-bottom: 1px solid var(--border);
  }

  .issue-row:last-child,
  .service-row:last-child {
    border-bottom: 0;
  }

  .issue-row {
    display: grid;
    grid-template-columns: 90px minmax(0, 1fr) 20px;
    gap: 8px;
    align-items: center;
    min-height: 52px;
    padding: 9px 10px;
    color: var(--text);
    text-decoration: none;
  }

  .issue-row:hover,
  .service-row:hover {
    background: var(--active);
  }

  .issue-row > span:nth-child(2) {
    display: grid;
    gap: 2px;
    min-width: 0;
  }

  .issue-row strong,
  .service-main strong,
  .service-main span,
  .capability-mini-row strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .state-chip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: fit-content;
    min-width: 76px;
    min-height: 23px;
    padding: 2px 7px;
    border: 1px solid var(--border);
    border-radius: 999px;
    color: var(--muted);
    background: var(--surface-muted);
    font-size: 11px;
    font-weight: 800;
  }

  .state-chip.offline,
  .state-chip.blocked {
    border-color: var(--danger-border);
    color: var(--danger-text);
    background: var(--danger-bg);
  }

  .state-chip.degraded,
  .state-chip.needs_setup {
    border-color: var(--warning-border);
    color: var(--warning-text);
    background: var(--warning-bg);
  }

  .service-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 10px;
    padding: 12px;
  }

  .service-main {
    display: grid;
    gap: 4px;
    min-width: 0;
  }

  .service-main > div {
    display: grid;
    gap: 2px;
    min-width: 0;
  }

  .service-main span {
    color: var(--muted);
  }

  .service-actions {
    display: flex;
    align-items: flex-start;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: 6px;
  }

  .capability-mini-list {
    grid-column: 1 / 3;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 6px;
    padding-top: 4px;
  }

  .capability-mini-row {
    display: grid;
    grid-template-columns: 12px minmax(0, 1fr);
    gap: 7px;
    align-items: center;
    min-width: 0;
    padding: 7px 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface-muted);
  }

  .capability-mini-row > span:last-child {
    display: grid;
    gap: 2px;
    min-width: 0;
  }

  .state-dot {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: var(--muted);
  }

  .state-dot.ready,
  .state-dot.running {
    background: var(--success-text);
  }

  .state-dot.degraded,
  .state-dot.needs_setup {
    background: var(--warning-text);
  }

  .state-dot.offline,
  .state-dot.blocked {
    background: var(--danger-text);
  }

  .panel-block {
    display: grid;
    gap: 10px;
  }

  .helper-text,
  .endpoint-message {
    margin: 0;
    color: var(--muted);
    line-height: 1.45;
  }

  .endpoint-message {
    color: var(--success-text);
    font-weight: 800;
  }

  .endpoint-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
  }

  .button.compact {
    min-height: 28px;
    padding: 4px 8px;
    font-size: 12px;
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
    .service-control-header {
      align-items: stretch;
      flex-direction: column;
    }

    .mode-heading {
      flex-direction: column;
    }

    .mode-segment {
      grid-template-columns: 1fr;
    }

    .mode-segment button {
      min-height: 64px;
    }

    .capability-kpis {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .capability-kpis div:nth-child(2n) {
      border-right: 0;
    }

    .capability-kpis div:nth-child(-n + 2) {
      border-bottom: 1px solid var(--border);
    }

    .issue-row {
      grid-template-columns: 84px minmax(0, 1fr);
    }

    .issue-row :global(svg) {
      display: none;
    }

    .service-row {
      grid-template-columns: 1fr;
    }

    .service-actions {
      justify-content: flex-start;
    }

    .capability-mini-list {
      grid-column: auto;
      grid-template-columns: 1fr;
    }

    .endpoint-grid {
      grid-template-columns: 1fr;
    }

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
