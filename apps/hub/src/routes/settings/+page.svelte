<script lang="ts">
  import { onMount } from 'svelte';
  import { Activity, ArrowRight, Cloud, Download, Monitor, Moon, RefreshCw, Save, Sun } from 'lucide-svelte';
  import type { ActionLedgerEntry } from '@mini-hub/core';
  import {
    actionLedgerDetail,
    actionLedgerRiskLabel,
    actionLedgerStatusLabel,
    actionLedgerSystemLabel,
    loadActionLedger,
    type ActionLedgerSnapshot
  } from '$lib/action-ledger';
  import { getApiUrl, getHealth, restoreHubActionLedgerEntry } from '$lib/api';
  import { getAiOsApiUrl, getMachineProfile, restoreAiActionSnapshot, runAutotune, snapshotMachineProfile, type AiMachineProfile, type AiMachineProfileSnapshot } from '$lib/ai-os-api';
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
  let machineProfile: AiMachineProfile | null = null;
  let machineSnapshots: AiMachineProfileSnapshot[] = [];
  let machineProfileLoading = false;
  let machineProfileError = '';
  let machineProfileMessage = '';
  let autotuneBusy = false;
  let actionLedgerSnapshot: ActionLedgerSnapshot | null = null;
  let actionLedgerLoading = false;
  let actionLedgerError = '';
  let actionLedgerMessage = '';
  let restoreBusyId = '';
  $: legacyImport = $clientData.settings?.recentState?.legacyImport as { importedAt?: string } | undefined;
  $: currentMachineMode = machineModeFromPreferences($clientData.settings?.preferences);
  $: currentMachineModeDetails = formatMachineModeContext(currentMachineMode);
  $: capabilityIssues = selectCapabilityIssues(capabilitySnapshot, 8);
  $: capabilityGroups = groupCapabilityServices(capabilitySnapshot?.capabilities ?? []);
  $: machinePressure = machineProfile?.autotune?.resource_pressure?.level ?? 'unknown';
  $: machineBestRoute = routeLabel(machineProfile?.autotune?.best_text_route ?? machineProfile?.benchmarks?.best_text_route);
  $: machineBestSpeed = routeSpeed(machineProfile?.autotune?.best_text_route ?? machineProfile?.benchmarks?.best_text_route);
  $: actionLedgerItems = actionLedgerSnapshot?.actions ?? [];

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
    await Promise.all([checkApi(), refreshCapabilities(), refreshMachineProfile(), refreshActionLedger()]);
  }

  async function syncNow(): Promise<void> {
    settingsError = '';
    try {
      await clientData.syncNow();
      await refreshActionLedger();
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
      await refreshMachineProfile(mode);
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
        googleConnected,
        machineMode: currentMachineMode.id
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

  async function refreshActionLedger(): Promise<void> {
    actionLedgerLoading = true;
    actionLedgerError = '';
    try {
      actionLedgerSnapshot = await loadActionLedger(20);
    } catch (error) {
      actionLedgerError = error instanceof Error ? error.message : 'Action ledger failed to load.';
    } finally {
      actionLedgerLoading = false;
    }
  }

  function actionWhen(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    }).format(date);
  }

  function canRestoreAction(action: ActionLedgerEntry): boolean {
    if (action.recoverability.kind !== 'snapshot' || !action.recoverability.reversible) return false;
    if (action.system === 'mini-hub') return true;
    return action.system === 'ai-os' && Boolean(action.recoverability.referenceId);
  }

  async function restoreAction(action: ActionLedgerEntry): Promise<void> {
    if (!canRestoreAction(action) || restoreBusyId) return;
    const isAiSnapshot = action.system === 'ai-os';
    const confirmed =
      typeof window === 'undefined' ||
      window.confirm(
        isAiSnapshot
          ? `Restore the file snapshot for "${action.summary}"? This will overwrite the current local file target.`
          : `Restore the before-state snapshot for "${action.summary}"? This will write synced Mini Hub data.`
      );
    if (!confirmed) return;

    restoreBusyId = action.id;
    actionLedgerMessage = '';
    actionLedgerError = '';
    try {
      if (isAiSnapshot) {
        await restoreAiActionSnapshot(action.recoverability.referenceId ?? '');
        actionLedgerMessage = 'AI OS file snapshot restored and the restore was added to the ledger.';
        await refreshActionLedger();
      } else {
        await restoreHubActionLedgerEntry(action.id);
        actionLedgerMessage = 'Snapshot restored and a new sync event was recorded.';
        await Promise.all([clientData.syncNow(), refreshActionLedger()]);
      }
    } catch (error) {
      actionLedgerError = error instanceof Error ? error.message : 'Restore failed.';
    } finally {
      restoreBusyId = '';
    }
  }

  function modeButtonTitle(mode: MachineModeDefinition): string {
    return `${mode.label}: ${mode.summary}`;
  }

  async function refreshMachineProfile(mode = currentMachineMode.id): Promise<void> {
    machineProfileLoading = true;
    machineProfileError = '';
    try {
      const result = await getMachineProfile(mode, 5);
      machineProfile = result.profile;
      machineSnapshots = result.snapshots;
    } catch (error) {
      machineProfileError = error instanceof Error ? error.message : 'Machine profile failed to load.';
    } finally {
      machineProfileLoading = false;
    }
  }

  async function runMachineAutotune(): Promise<void> {
    autotuneBusy = true;
    machineProfileMessage = '';
    machineProfileError = '';
    try {
      const result = await runAutotune({ mode: currentMachineMode.id });
      machineProfile = result.profile;
      if (result.snapshot) machineSnapshots = [result.snapshot, ...machineSnapshots.filter((item) => item.id !== result.snapshot?.id)].slice(0, 5);
      const speed = typeof result.benchmark?.tokens_per_second === 'number' ? ` at ${result.benchmark.tokens_per_second.toFixed(1)} tokens/sec` : '';
      machineProfileMessage = result.ok
        ? `Autotune logged ${result.benchmark?.provider ?? 'auto'}${speed}.`
        : `Autotune could not complete: ${result.error ?? 'provider unavailable'}`;
      await refreshCapabilities();
    } catch (error) {
      machineProfileError = error instanceof Error ? error.message : 'Autotune failed.';
    } finally {
      autotuneBusy = false;
    }
  }

  async function saveMachineSnapshot(): Promise<void> {
    machineProfileMessage = '';
    machineProfileError = '';
    try {
      const snapshot = await snapshotMachineProfile('settings');
      machineSnapshots = [snapshot, ...machineSnapshots.filter((item) => item.id !== snapshot.id)].slice(0, 5);
      machineProfileMessage = `Snapshot saved ${new Date(snapshot.created_at).toLocaleString()}.`;
    } catch (error) {
      machineProfileError = error instanceof Error ? error.message : 'Snapshot failed.';
    }
  }

  function routeLabel(route: Record<string, unknown> | null | undefined): string {
    if (!route) return 'No measured route';
    const provider = typeof route.provider === 'string' ? route.provider : '';
    const model = typeof route.model === 'string' ? route.model : '';
    if (!provider) return 'No measured route';
    return model ? `${provider}/${model}` : provider;
  }

  function routeSpeed(route: Record<string, unknown> | null | undefined): string {
    const value = route?.tokens_per_second;
    return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(1)} tok/s` : 'not measured';
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

  <div class="machine-profile-panel">
    <div class="mode-heading">
      <div>
        <strong>Machine Profile</strong>
        <span>Real hardware, provider, benchmark, and health signals from AI OS.</span>
      </div>
      <small>{machineProfileLoading ? 'Loading' : machinePressure}</small>
    </div>
    {#if machineProfile}
      <div class="machine-profile-grid">
        <div>
          <span>Host</span>
          <strong>{machineProfile.host.system ?? 'OS'} {machineProfile.host.release ?? ''}</strong>
        </div>
        <div>
          <span>CPU/RAM</span>
          <strong>{machineProfile.hardware.cpu_percent ?? 'n/a'}% / {machineProfile.hardware.memory_percent ?? 'n/a'}%</strong>
        </div>
        <div>
          <span>GPU</span>
          <strong>{machineProfile.hardware.gpus.length ? String(machineProfile.hardware.gpus[0].name ?? 'GPU') : 'No telemetry'}</strong>
        </div>
        <div>
          <span>Best Route</span>
          <strong>{machineBestRoute}</strong>
          <small>{machineBestSpeed}</small>
        </div>
        <div>
          <span>Concurrency</span>
          <strong>{machineProfile.autotune.suggested_max_job_concurrency ?? 'n/a'}</strong>
        </div>
        <div>
          <span>Snapshots</span>
          <strong>{machineSnapshots.length}</strong>
          <small>{machineSnapshots[0]?.created_at ? new Date(machineSnapshots[0].created_at).toLocaleString() : 'none saved'}</small>
        </div>
      </div>
      {#if machineProfile.autotune.routing_notes?.length}
        <p class="helper-text">{machineProfile.autotune.routing_notes[0]}</p>
      {/if}
    {:else if machineProfileError}
      <p class="sync-error">{machineProfileError}</p>
    {:else}
      <p class="helper-text">Machine profile has not been loaded yet. Start AI OS, then check services.</p>
    {/if}
    <div class="action-row tight">
      <button class="button primary" type="button" disabled={autotuneBusy || machineProfileLoading} on:click={runMachineAutotune}>
        <Activity size={17} />
        <span>{autotuneBusy ? 'Running' : 'Run Autotune'}</span>
      </button>
      <button class="button" type="button" disabled={!machineProfile || machineProfileLoading} on:click={saveMachineSnapshot}>
        <Save size={17} />
        <span>Save Snapshot</span>
      </button>
      <button class="button" type="button" disabled={machineProfileLoading} on:click={() => refreshMachineProfile()}>
        <RefreshCw size={17} />
        <span>Refresh Profile</span>
      </button>
    </div>
    {#if machineProfileMessage}
      <p class="endpoint-message">{machineProfileMessage}</p>
    {/if}
    {#if machineProfileError && machineProfile}
      <p class="sync-error">{machineProfileError}</p>
    {/if}
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

  <div class="panel-block action-ledger-block">
    <div class="section-title split-title">
      <span>
        <Activity size={18} />
        <strong>Action Ledger</strong>
      </span>
      <button class="button compact" type="button" disabled={actionLedgerLoading} on:click={refreshActionLedger}>
        <RefreshCw size={15} />
        <span>{actionLedgerLoading ? 'Loading' : 'Refresh'}</span>
      </button>
    </div>
    <p class="helper-text">
      Recent real actions from Mini Hub, AI OS, and Macro Lab. Reversible Mini Hub data snapshots and AI OS file snapshots can be restored from here.
    </p>

    {#if actionLedgerItems.length}
      <div class="action-ledger-list">
        {#each actionLedgerItems as action}
          <article class="action-ledger-row">
            <span class={`ledger-status ${action.status}`}>{actionLedgerStatusLabel(action.status)}</span>
            <div class="ledger-main">
              <strong>{action.summary}</strong>
              <small>{actionLedgerSystemLabel(action.system)} - {actionLedgerDetail(action)}</small>
              <small class="ledger-changed">{action.changed.length ? action.changed.slice(0, 3).join(', ') : action.actionType}</small>
            </div>
            <span class={`ledger-risk ${action.risk}`}>{actionLedgerRiskLabel(action.risk)}</span>
            <time datetime={action.occurredAt}>{actionWhen(action.occurredAt)}</time>
            {#if canRestoreAction(action)}
              <button
                class="button compact"
                type="button"
                disabled={Boolean(restoreBusyId)}
                on:click={() => restoreAction(action)}
              >
                <span>{restoreBusyId === action.id ? 'Restoring' : 'Restore'}</span>
              </button>
            {:else}
              <span class="restore-state">{action.recoverability.kind === 'none' ? 'No restore' : action.recoverability.kind}</span>
            {/if}
          </article>
        {/each}
      </div>
    {:else if actionLedgerLoading}
      <p class="helper-text">Loading action ledger...</p>
    {:else if actionLedgerError}
      <p class="sync-error">{actionLedgerError}</p>
    {:else}
      <p class="helper-text">No action ledger entries are available yet.</p>
    {/if}

    {#if actionLedgerMessage}
      <p class="endpoint-message">{actionLedgerMessage}</p>
    {/if}
    {#if actionLedgerSnapshot?.errors.length}
      <p class="sync-error">{actionLedgerSnapshot.errors[0]}</p>
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

  .machine-mode-panel,
  .machine-profile-panel {
    display: grid;
    gap: 10px;
    padding: 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface-muted);
  }

  .machine-profile-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 6px;
  }

  .machine-profile-grid div {
    display: grid;
    gap: 3px;
    min-width: 0;
    padding: 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface);
  }

  .machine-profile-grid span,
  .machine-profile-grid small {
    overflow: hidden;
    color: var(--muted);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .machine-profile-grid span {
    font-size: 11px;
    font-weight: 800;
    text-transform: uppercase;
  }

  .machine-profile-grid strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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

  .split-title {
    justify-content: space-between;
  }

  .split-title span {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .action-ledger-list {
    display: grid;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 6px;
  }

  .action-ledger-row {
    display: grid;
    grid-template-columns: 76px minmax(0, 1fr) 82px 94px 84px;
    gap: 9px;
    align-items: center;
    min-height: 62px;
    padding: 9px 10px;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }

  .action-ledger-row:last-child {
    border-bottom: 0;
  }

  .ledger-main {
    display: grid;
    gap: 3px;
    min-width: 0;
  }

  .ledger-main strong,
  .ledger-main small,
  .action-ledger-row time,
  .restore-state {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ledger-main small,
  .action-ledger-row time,
  .restore-state {
    color: var(--muted);
  }

  .ledger-changed {
    font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
    font-size: 11px;
  }

  .ledger-status,
  .ledger-risk,
  .restore-state {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: fit-content;
    min-width: 64px;
    min-height: 22px;
    padding: 2px 7px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--surface-muted);
    font-size: 11px;
    font-weight: 800;
  }

  .ledger-status.succeeded {
    border-color: var(--success-border);
    color: var(--success-text);
    background: var(--success-bg);
  }

  .ledger-status.failed,
  .ledger-status.blocked {
    border-color: var(--error-border);
    color: var(--error-text);
    background: var(--error-bg);
  }

  .ledger-status.running,
  .ledger-status.queued {
    border-color: var(--warning-border);
    color: var(--warning-text);
    background: var(--warning-bg);
  }

  .ledger-risk {
    justify-self: end;
    color: var(--muted);
  }

  .ledger-risk.system {
    border-color: var(--warning-border);
    color: var(--warning-text);
    background: var(--warning-bg);
  }

  .ledger-risk.destructive {
    border-color: var(--danger-border);
    color: var(--danger-text);
    background: var(--danger-bg);
  }

  .action-ledger-row time {
    justify-self: end;
    font-size: 12px;
    font-weight: 700;
  }

  .restore-state {
    justify-self: end;
    max-width: 84px;
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

    .machine-profile-grid {
      grid-template-columns: 1fr;
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

    .action-ledger-row {
      grid-template-columns: 72px minmax(0, 1fr);
      align-items: start;
    }

    .ledger-risk,
    .action-ledger-row time,
    .action-ledger-row .button,
    .restore-state {
      grid-column: 2;
      justify-self: start;
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
