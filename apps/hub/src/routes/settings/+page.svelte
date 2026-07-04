<script lang="ts">
  import { onMount } from 'svelte';
  import { Activity, ArrowRight, Cloud, Database, Download, ListChecks, Monitor, Moon, RefreshCw, Save, Sun } from 'lucide-svelte';
  import type { ActionLedgerEntry, PassiveBackupHealth, PassiveSnapshot, PassiveTaskFamily } from '@mini-hub/core';
  import {
    actionLedgerDetail,
    actionLedgerRiskLabel,
    actionLedgerStatusLabel,
    actionLedgerSystemLabel,
    loadActionLedger,
    type ActionLedgerSnapshot
  } from '$lib/action-ledger';
  import { getApiUrl, getHealth, restoreHubActionLedgerEntry, type HubHealth } from '$lib/api';
  import { getAiOsApiUrl, getMachineProfile, restoreAiActionSnapshot, runAutotune, snapshotMachineProfile, type AiMachineProfile, type AiMachineProfileSnapshot } from '$lib/ai-os-api';
  import {
    capabilityServiceLabel,
    capabilityStateLabel,
    loadCapabilityRegistry,
    readCachedCapabilityRegistrySnapshot,
    selectCapabilityIssues,
    writeCapabilityRegistryCache,
    type CapabilityRegistryEntry,
    type CapabilityRegistrySnapshot,
    type CapabilityService
  } from '$lib/capability-registry';
  import { canUseBrowserStorage } from '$lib/browser-storage';
  import { canAutoSave, clientData } from '$lib/client-data';
  import {
    buildFeatureWiringRows,
    featureWiringStatusLabel,
    type FeatureWiringRow
  } from '$lib/feature-wiring';
  import {
    formatMachineModeContext,
    advancedMachineModes,
    machineModeFromPreferences,
    machineModePreferenceKey,
    machineModes,
    primaryMachineModes,
    type MachineModeDefinition,
    type MachineModeId
  } from '$lib/machine-mode';
  import { persistenceOwnerLabel, persistenceRows, persistenceSummary } from '$lib/persistence-map';
  import { getMacroLabApiUrl, restoreMacroRun } from '$lib/macro-lab-api';
  import { getOllamaTags, getOllamaUrl } from '$lib/ollama-api';
  import { getPassiveSnapshot, passiveFamilyLabel, patchPassiveSettings } from '$lib/passive-tasks-api';
  import { getConnections, listCalendars, listGmailLabels } from '$lib/productivity-api';
  import { hubHref } from '$lib/routes';
  import {
    bridgeTokenConfigured,
    connectionModeForOrigin,
    getBridgeToken,
    localNetworkHint,
    remoteEndpointSuggestions,
    serviceEndpointResolution,
    serviceFallbackUrl,
    serviceHealthPath,
    setBridgeToken,
    setServiceEndpoints,
    type ServiceEndpoint,
    type ServiceId
  } from '$lib/service-config';
  import { compactServiceIssueIfRecognized } from '$lib/service-issues';
  import { setTheme, theme, type ThemeMode } from '$lib/theme';

  const watchedResearchPlaceholder = [
    'example.com',
    'page:https://example.com/updates',
    'topic: local LLM tooling',
    'tool: Ollama',
    'company: Clay Labs'
  ].join('\n');

  interface CapabilityServiceGroup {
    service: CapabilityService;
    label: string;
    route: string;
    ready: number;
    total: number;
    issues: number;
    capabilities: CapabilityRegistryEntry[];
  }

  interface SettingsControlState {
    syncBusy: boolean;
    canSync: boolean;
    clientInitialized: boolean;
    clientOnline: boolean;
    clientStatus: string;
    clientError: string;
    capabilityLoading: boolean;
    actionLedgerLoading: boolean;
    exportBusy: boolean;
  }

  let apiStatus = 'Run Check Services';
  let hubHealth: HubHealth | null = null;
  let settingsError = '';
  let settingsMessage = '';
  let serviceCheckedAt = '';
  let endpointMessage = '';
  let endpointError = '';
  let hubApiInput = '';
  let aiOsInput = '';
  let macroLabInput = '';
  let ollamaInput = '';
  let bridgeTokenInput = '';
  let ollamaStatus = 'Run Check Services';
  let ollamaModelCount = 0;
  let googleConnected = false;
  let googleReady = false;
  let googleNeedsReconnect = false;
  let googleStatusDetail = 'Run Check Services to inspect Google readiness.';
  let googleFixAction = 'Open Productivity Hub and connect Google.';
  let serviceChecking = false;
  let syncBusy = false;
  let exportBusy = false;
  let endpointSaving = false;
  let themeSaving = false;
  let modeSaving = false;
  let capabilitySnapshot: CapabilityRegistrySnapshot | null = null;
  let capabilityCachedAt = '';
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
  let passiveSnapshot: PassiveSnapshot | null = null;
  let passiveLoading = false;
  let passiveError = '';
  let passiveMessage = '';
  let passiveSaving = false;
  let passiveFolders = '';
  let passiveDomains = '';
  let passiveAccounts = '';
  $: legacyImport = $clientData.settings?.recentState?.legacyImport as { importedAt?: string } | undefined;
  $: currentMachineMode = machineModeFromPreferences($clientData.settings?.preferences);
  $: currentMachineModeDetails = formatMachineModeContext(currentMachineMode);
  $: canSync = canAutoSave($clientData);
  $: capabilityIssues = selectCapabilityIssues(capabilitySnapshot, 8);
  $: capabilityGroups = groupCapabilityServices(capabilitySnapshot?.capabilities ?? []);
  $: machineTelemetryCapability = capabilitySnapshot?.capabilities.find((capability) => capability.id === 'machine.telemetry');
  $: machinePressure = machineProfile?.autotune?.resource_pressure?.level ?? 'unknown';
  $: machineBestRoute = routeLabel(machineProfile?.autotune?.best_text_route ?? machineProfile?.benchmarks?.best_text_route);
  $: machineBestSpeed = routeSpeed(machineProfile?.autotune?.best_text_route ?? machineProfile?.benchmarks?.best_text_route);
  $: ollamaProviderViaAiOs = machineProfile?.providers.find((provider) => provider.id === 'ollama' || /ollama/iu.test(provider.label));
  $: ollamaViaAiOsReady = Boolean(ollamaProviderViaAiOs?.available || (machineBestRoute.toLowerCase().startsWith('ollama/') && machineProfile));
  $: ollamaVisibleModelCount = Math.max(ollamaModelCount, ollamaProviderViaAiOs?.models.length ?? 0, machineProfile?.loaded_models.length ?? 0);
  $: visibleSettingsError = settingsError ? compactSettingsIssue(settingsError, 'Settings') : '';
  $: visibleClientDataError = $clientData.error ? compactSettingsIssue($clientData.error, 'Mini Hub cache') : '';
  $: visibleEndpointError = endpointError ? compactSettingsIssue(endpointError, 'Desktop Services') : '';
  $: visibleCapabilityError = capabilityError ? compactSettingsIssue(capabilityError, 'Capability Registry') : '';
  $: visibleMachineProfileError = machineProfileError ? compactServiceIssueIfRecognized(machineProfileError, 'AI OS machine profile') : '';
  $: actionLedgerItems = actionLedgerSnapshot?.actions ?? [];
  $: visibleActionLedgerError = actionLedgerError ? compactServiceIssueIfRecognized(actionLedgerError, 'Action Ledger') : '';
  $: actionLedgerSourceError = actionLedgerSnapshot?.errors[0] ?? '';
  $: visibleActionLedgerSourceError = actionLedgerSourceError ? compactServiceIssueIfRecognized(actionLedgerSourceError, 'Action Ledger source') : '';
  $: visiblePassiveError = passiveError ? compactSettingsIssue(passiveError, 'Passive Tasks') : '';
  $: visiblePassiveBackupHealthError = passiveBackupHealth?.error ? compactSettingsIssue(passiveBackupHealth.error, 'Passive restore points') : '';
  $: passiveSettings = passiveSnapshot?.settings ?? null;
  $: passiveSettingsBlockedReason = passiveSettingsControlBlockedReason({
    saving: passiveSaving,
    loading: passiveLoading,
    settings: passiveSettings,
    error: passiveError
  });
  $: passiveBackupHealth = passiveSnapshot?.backupHealth ?? null;
  $: hubCoreDataStatus = formatHubCoreDataHealth(hubHealth);
  $: passiveEnabledWatchers = passiveSnapshot?.watchers.filter((watcher) => watcher.enabled).length ?? 0;
  $: passiveFailures = passiveSnapshot?.runs.filter((run) => ['failed', 'blocked'].includes(run.status)).length ?? 0;
  $: persistenceStats = persistenceSummary(persistenceRows);
  $: passiveFamilyRows = passiveSnapshot?.watchers.map((watcher) => ({
    family: watcher.family,
    label: passiveFamilyLabel(watcher.family),
    description: watcher.description,
    watcherEnabled: watcher.enabled,
    familyEnabled: passiveSettings?.enabledFamilies[watcher.family] !== false,
    taskCount: watcher.taskIds.length
  })) ?? [];
  $: endpointResolutions = [
    serviceEndpointResolution('hubApi', hubApiInput, serviceFallbackUrl('hubApi'), currentOrigin()),
    serviceEndpointResolution('aiOs', aiOsInput, serviceFallbackUrl('aiOs'), currentOrigin()),
    serviceEndpointResolution('macroLab', macroLabInput, serviceFallbackUrl('macroLab'), currentOrigin()),
    serviceEndpointResolution('ollama', ollamaInput, serviceFallbackUrl('ollama'), currentOrigin())
  ];
  $: connectionMode = connectionModeForOrigin(currentOrigin());
  $: endpointSuggestions = remoteEndpointSuggestions(currentOrigin());
  $: endpointSuggestionMap = new Map(endpointSuggestions.map((suggestion) => [suggestion.id, suggestion]));
  $: connectionModeClass = connectionMode.id;
  $: lanAddressInfo = lanAddressSummary(hubHealth);
  $: machineAiOsEndpointIssue = aiOsEndpointIssue(endpointResolutions);
  $: machineAutotuneBlockedReason = machineProfileControlBlockedReason('autotune', {
    endpointIssue: machineAiOsEndpointIssue,
    busy: autotuneBusy,
    loading: machineProfileLoading,
    profile: machineProfile,
    error: machineProfileError
  });
  $: machineSnapshotBlockedReason = machineProfileControlBlockedReason('snapshot', {
    endpointIssue: machineAiOsEndpointIssue,
    busy: autotuneBusy,
    loading: machineProfileLoading,
    profile: machineProfile,
    error: machineProfileError
  });
  $: featureWiringRows = buildFeatureWiringRows({
    checkedAt: serviceCheckedAt,
    endpoints: endpointResolutions,
    hubApi: {
      ready: apiStatusReady(apiStatus),
      loading: apiStatus === 'Checking',
      error: apiStatusError(apiStatus),
      detail: apiStatusReady(apiStatus) ? `Health check passed: ${apiStatus}` : undefined
    },
    aiOs: {
      ready: Boolean(machineProfile) || capabilityServiceReady('ai-os'),
      loading: machineProfileLoading || capabilityLoading,
      error: machineProfileError || capabilityServiceError('ai-os'),
      detail: machineProfile
        ? `Machine profile loaded. Best measured route: ${machineBestRoute}.`
        : capabilityServiceReady('ai-os')
          ? 'AI OS capabilities are reachable.'
          : undefined
    },
    macroLab: {
      ready: capabilityServiceReady('macro-lab'),
      loading: capabilityLoading,
      error: capabilityServiceError('macro-lab'),
      detail: capabilityServiceReady('macro-lab') ? 'Macro status, run history, and actions are reachable.' : undefined
    },
    ollama: {
      ready: apiStatusReady(ollamaStatus) || ollamaViaAiOsReady,
      loading: ollamaStatus === 'Checking' || machineProfileLoading,
      error: apiStatusReady(ollamaStatus) || ollamaViaAiOsReady ? '' : apiStatusError(ollamaStatus),
      detail: ollamaWiringDetail(ollamaStatus, ollamaVisibleModelCount, ollamaViaAiOsReady, machineBestRoute),
      fixAction: ollamaViaAiOsReady && apiStatusError(ollamaStatus)
        ? 'No action needed for AI OS. Only fix the direct Ollama URL if you want browser-to-Ollama checks.'
        : undefined
    },
    google: {
      ready: googleReady,
      loading: capabilityLoading,
      error: googleNeedsReconnect ? '' : apiStatusError(apiStatus),
      setupNeeded: !googleReady,
      detail: googleStatusDetail,
      fixAction: googleReady ? undefined : googleFixAction
    },
    passiveTasks: {
      ready: Boolean(passiveSnapshot && !passiveError),
      loading: passiveLoading,
      error: passiveError || capabilityServiceError('passive-tasks'),
      detail: passiveSnapshot ? `${passiveSnapshot.watchers.length} watcher${passiveSnapshot.watchers.length === 1 ? '' : 's'} loaded.` : undefined
    },
    browserStorage: {
      ready: browserStorageAvailable(),
      detail: 'Browser storage is used for drafts, endpoint settings, cached activity, and offline-readable data.'
    }
  } satisfies Parameters<typeof buildFeatureWiringRows>[0]);
  $: settingsControlState = {
    syncBusy,
    canSync,
    clientInitialized: $clientData.initialized,
    clientOnline: $clientData.isOnline,
    clientStatus: $clientData.status,
    clientError: $clientData.error,
    capabilityLoading,
    actionLedgerLoading,
    exportBusy
  };
  $: syncNowButtonTitle = syncNowTitle(settingsControlState);
  $: capabilityRefreshButtonTitle = capabilityRefreshTitle(settingsControlState);
  $: actionLedgerRefreshButtonTitle = actionLedgerRefreshTitle(settingsControlState);
  $: exportCacheButtonTitle = exportCacheTitle(settingsControlState);
  $: serviceCheckButtonTitle = serviceCheckTitle(serviceChecking);
  $: machineAutotuneButtonTitle = machineAutotuneTitle(machineAutotuneBlockedReason);
  $: machineSnapshotButtonTitle = machineSnapshotTitle(machineSnapshotBlockedReason);
  $: machineProfileRefreshButtonTitle = machineProfileRefreshTitle(machineProfileLoading);
  $: passiveSettingsSaveButtonTitle = passiveSettingsSaveTitle(passiveSettingsBlockedReason);
  $: passiveSettingsRefreshButtonTitle = passiveSettingsRefreshTitle(passiveLoading, passiveError);
  $: endpointSaveButtonTitle = endpointSaveTitle(endpointSaving);
  $: endpointReloadButtonTitle = endpointReloadTitle(endpointSaving);
  $: machineModeBlocked = machineModeBlockedReason(settingsControlState);

  async function checkApi(): Promise<void> {
    apiStatus = 'Checking';
    try {
      const health = await getHealth();
      hubHealth = health;
      const bridgeAuthBlocksWrites = Boolean(health.bridgeAuth?.required && !health.bridgeAuth.accepted);
      const coreDataStatus = health.storage?.coreData ? ` - core data ${health.storage.coreData.status.replace('_', '-')}` : '';
      const bridgeAuthStatus = health.bridgeAuth?.required
        ? health.bridgeAuth.accepted
          ? ' - bridge token accepted'
          : ' - bridge token required; save it in Desktop Services'
        : '';
      apiStatus = `${health.service}: ${health.ok && !bridgeAuthBlocksWrites ? 'ok' : 'not ok'}${coreDataStatus}${bridgeAuthStatus}`;
    } catch (error) {
      hubHealth = null;
      apiStatus = error instanceof Error ? error.message : 'API unavailable';
    }
  }

  async function checkOllama(): Promise<void> {
    ollamaStatus = 'Checking';
    ollamaModelCount = 0;
    try {
      const tags = await getOllamaTags();
      ollamaModelCount = tags.models?.length ?? 0;
      ollamaStatus = `Ollama: ok - ${ollamaModelCount} model${ollamaModelCount === 1 ? '' : 's'}`;
    } catch (error) {
      ollamaStatus = error instanceof Error ? error.message : 'Ollama unavailable';
    }
  }

  async function checkServices(): Promise<void> {
    if (serviceChecking) return;
    serviceChecking = true;
    try {
      await Promise.all([
        checkApi(),
        checkOllama(),
        refreshCapabilities({ background: Boolean(capabilitySnapshot) }),
        refreshMachineProfile(),
        refreshActionLedger(),
        refreshPassiveSettings()
      ]);
      serviceCheckedAt = new Date().toISOString();
    } finally {
      serviceChecking = false;
    }
  }

  function syncPassiveEditor(next: PassiveSnapshot): void {
    passiveSnapshot = next;
    passiveFolders = next.settings.watchedFolders.join('\n');
    passiveDomains = next.settings.watchedDomains.join('\n');
    passiveAccounts = next.settings.watchedAccounts.join('\n');
  }

  async function refreshPassiveSettings(): Promise<void> {
    passiveLoading = true;
    passiveError = '';
    try {
      syncPassiveEditor(await getPassiveSnapshot());
    } catch (error) {
      passiveError = error instanceof Error ? error.message : 'Passive task settings failed to load.';
    } finally {
      passiveLoading = false;
    }
  }

  function splitPassiveLines(value: string): string[] {
    return value
      .split(/\r?\n|,/u)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function serviceCheckTitle(isChecking: boolean): string {
    return isChecking
      ? 'Service check is already running across Mini Hub, AI OS, Macro Lab, Ollama, Passive Tasks, Google, and browser storage.'
      : 'Check Mini Hub, AI OS, Macro Lab, Ollama, Passive Tasks, Google readiness, endpoint wiring, and browser storage health.';
  }

  function passiveSettingsControlBlockedReason(state: {
    saving: boolean;
    loading: boolean;
    settings: PassiveSnapshot['settings'] | null;
    error: string;
  } = { saving: passiveSaving, loading: passiveLoading, settings: passiveSettings, error: passiveError }): string {
    if (state.saving) return 'Passive task settings are already saving.';
    if (state.loading) return 'Passive task settings are loading.';
    if (!state.settings) {
      return state.error
        ? 'Passive Tasks API is unavailable. Start the Mini Hub API or fix the endpoint, then retry Passive settings.'
        : 'Load Passive Task settings before changing worker, watcher, task, notification, or scope preferences.';
    }
    if (state.error) return 'Passive Tasks API is reporting an error. Retry Passive settings before changing preferences.';
    return '';
  }

  function passiveWorkerToggleTitle(enabled: boolean): string {
    if (passiveSettingsBlockedReason) return passiveSettingsBlockedReason;
    return enabled
      ? 'Turn off the passive worker now. This saves immediately through the Passive Tasks API; existing runs stay recoverable in Activity and Passive Tasks.'
      : 'Turn on the passive worker now. This saves immediately through the Passive Tasks API so scheduled and event work can create Activity records.';
  }

  function passiveFamilyToggleTitle(family: { label: string; familyEnabled: boolean; taskCount: number; watcherEnabled: boolean }): string {
    if (passiveSettingsBlockedReason) return passiveSettingsBlockedReason;
    const count = `${family.taskCount} task${family.taskCount === 1 ? '' : 's'}`;
    const stopVerb = family.taskCount === 1 ? 'stops' : 'stop';
    const watcher = family.watcherEnabled ? 'watcher is on' : 'watcher is off';
    return family.familyEnabled
      ? `Disable ${family.label} now. This saves immediately through the Passive Tasks API; ${count} ${stopVerb} producing new background findings while the ${watcher}.`
      : `Enable ${family.label} now. This saves immediately through the Passive Tasks API; ${count} can produce future Activity and Passive Tasks findings when the ${watcher}.`;
  }

  function passivePreferenceTitle(kind: 'idle' | 'notifications' | 'resource' | 'ai' | 'maxRuns'): string {
    if (passiveSettingsBlockedReason) return passiveSettingsBlockedReason;
    if (kind === 'idle') return 'Save idle-only preference immediately through the Passive Tasks API; scheduled work waits for Windows idle windows.';
    if (kind === 'notifications') return 'Save how Passive Tasks records notifications, digest cards, and urgent-only alerts.';
    if (kind === 'resource') return 'Save the resource limit used by future passive task runs and Activity findings.';
    if (kind === 'ai') return 'Save local/cloud AI routing preference for future passive task summaries and monitors.';
    return 'Save the maximum passive tasks allowed per tick so background work cannot fan out unexpectedly.';
  }

  function passiveScopeTitle(scope: 'folders' | 'research' | 'accounts'): string {
    if (passiveSettingsBlockedReason) return passiveSettingsBlockedReason;
    if (scope === 'folders') return 'One watched folder per line; Save Passive Settings writes these scopes to the Passive Tasks API.';
    if (scope === 'research') return 'One watched research source per line; Save Passive Settings controls future monitor/source checks.';
    return 'One watched account per line; Save Passive Settings controls future account-aware passive checks.';
  }

  function passiveSettingsSaveTitle(blockedReason = passiveSettingsBlockedReason): string {
    return (
      blockedReason ||
      'Save watched folders, research sources, and accounts through the Passive Tasks API; future runs and Activity use these scopes.'
    );
  }

  function passiveSettingsRefreshTitle(loading = passiveLoading, error = passiveError): string {
    if (loading) return 'Passive task settings are already loading.';
    if (error) return 'Retry Passive Task settings from the local API; controls stay disabled until a snapshot loads.';
    return 'Reload Passive Task settings, watcher state, backup health, and watched scopes from the local API.';
  }

  async function savePassiveSettings(): Promise<void> {
    const blockedReason = passiveSettingsControlBlockedReason();
    if (blockedReason) {
      passiveError = blockedReason;
      return;
    }
    if (!passiveSettings) return;
    passiveSaving = true;
    passiveError = '';
    passiveMessage = '';
    try {
      syncPassiveEditor(
        await patchPassiveSettings({
          watchedFolders: splitPassiveLines(passiveFolders),
          watchedDomains: splitPassiveLines(passiveDomains),
          watchedAccounts: splitPassiveLines(passiveAccounts)
        })
      );
      passiveMessage = 'Passive task settings saved.';
    } catch (error) {
      passiveError = error instanceof Error ? error.message : 'Passive task settings save failed.';
    } finally {
      passiveSaving = false;
    }
  }

  async function updatePassivePreference(patch: Parameters<typeof patchPassiveSettings>[0]): Promise<void> {
    const blockedReason = passiveSettingsControlBlockedReason();
    if (blockedReason) {
      passiveError = blockedReason;
      return;
    }
    passiveSaving = true;
    passiveError = '';
    passiveMessage = '';
    try {
      syncPassiveEditor(await patchPassiveSettings(patch));
      passiveMessage = 'Passive task preference saved.';
    } catch (error) {
      passiveError = error instanceof Error ? error.message : 'Passive task preference save failed.';
    } finally {
      passiveSaving = false;
    }
  }

  async function updatePassiveFamily(family: PassiveTaskFamily, enabled: boolean): Promise<void> {
    await updatePassivePreference({ enabledFamilies: { [family]: enabled } });
  }

  async function syncNow(): Promise<void> {
    const blocked = syncNowBlockedReason(settingsControlState);
    if (blocked) {
      settingsError = blocked;
      return;
    }
    syncBusy = true;
    settingsError = '';
    settingsMessage = '';
    try {
      await clientData.syncNow();
      await refreshActionLedger();
      settingsMessage = `Synced ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`;
    } catch (error) {
      settingsError = error instanceof Error ? error.message : 'Sync failed';
    } finally {
      syncBusy = false;
    }
  }

  function syncNowBlockedReason(
    state: Pick<SettingsControlState, 'syncBusy' | 'canSync' | 'clientInitialized' | 'clientOnline' | 'clientStatus' | 'clientError'>
  ): string {
    if (state.syncBusy) return 'Sync is already running.';
    if (!state.clientInitialized) return 'Loading local cache before sync controls are enabled.';
    if (!state.clientOnline) return 'Offline read-only: start or connect the Mini Hub API before syncing.';
    if (!state.canSync) {
      return state.clientError
        ? `Mini Hub API is not ready: ${state.clientError}`
        : `Mini Hub sync is ${state.clientStatus}; wait for an idle online state before syncing.`;
    }
    return '';
  }

  function syncNowTitle(
    state: Pick<SettingsControlState, 'syncBusy' | 'canSync' | 'clientInitialized' | 'clientOnline' | 'clientStatus' | 'clientError'>
  ): string {
    const blocked = syncNowBlockedReason(state);
    if (blocked) return blocked;
    return 'Push and pull Mini Hub data with the API now; cache status, last synced time, and Action Ledger update afterward.';
  }

  function loadEndpointInputs(showMessage = false): void {
    if (endpointSaving) return;
    hubApiInput = getApiUrl();
    aiOsInput = getAiOsApiUrl();
    macroLabInput = getMacroLabApiUrl();
    ollamaInput = getOllamaUrl();
    bridgeTokenInput = getBridgeToken();
    endpointError = '';
    if (showMessage) endpointMessage = 'Reloaded saved service URLs from this browser.';
  }

  function endpointInputTitle(service: string): string {
    if (endpointSaving) return 'Service URLs are saving; wait before editing endpoints.';
    return `Edit the ${service} URL stored in this browser; hosted pages use this to avoid calling the wrong /api route.`;
  }

  function endpointSaveTitle(isSaving: boolean): string {
    return isSaving
      ? 'Saving service URLs in this browser and checking services.'
      : 'Save service URLs in this browser, then run Check Services so Feature Wiring reflects the new targets.';
  }

  function endpointReloadTitle(isSaving: boolean): string {
    return isSaving
      ? 'Service URLs are saving; wait before reloading browser-stored values.'
      : 'Reload service URLs from browser storage without contacting services.';
  }

  function endpointSuggestion(id: ServiceId): ServiceEndpoint | undefined {
    return endpointSuggestionMap.get(id);
  }

  function endpointHealthTarget(id: ServiceId, url: string): string {
    return `${url}${serviceHealthPath(id)}`;
  }

  function applyCurrentHostEndpoints(): void {
    if (!endpointSuggestions.length || endpointSaving) return;
    for (const suggestion of endpointSuggestions) {
      if (suggestion.id === 'hubApi') hubApiInput = suggestion.url;
      if (suggestion.id === 'aiOs') aiOsInput = suggestion.url;
      if (suggestion.id === 'macroLab') macroLabInput = suggestion.url;
      if (suggestion.id === 'ollama') ollamaInput = suggestion.url;
    }
    endpointMessage = 'Filled service URLs from the current hub host. Save Service URLs to use them in this browser.';
    endpointError = '';
  }

  function applyLocalhostEndpoints(): void {
    if (endpointSaving) return;
    hubApiInput = serviceFallbackUrl('hubApi');
    aiOsInput = serviceFallbackUrl('aiOs');
    macroLabInput = serviceFallbackUrl('macroLab');
    ollamaInput = serviceFallbackUrl('ollama');
    endpointMessage = 'Filled localhost service URLs. Save Service URLs to use the Local Full Power profile in this browser.';
    endpointError = '';
  }

  function currentHostEndpointTitle(): string {
    if (endpointSaving) return 'Service URLs are saving.';
    if (!endpointSuggestions.length) return 'This public/static origin cannot infer your private desktop host. Enter a LAN or Tailscale host manually.';
    return 'Fill Mini Hub API, AI OS, Macro Lab, and Ollama URLs using this page host and the standard service ports.';
  }

  function endpointModeNote(): string {
    if (connectionMode.id === 'hosted-light') {
      return 'GitHub Pages is a static shell. Full-power controls need saved private endpoints or the local hub URL.';
    }
    if (connectionMode.id === 'private-remote') {
      return 'This can be full power if your PC is awake, the LAN/Tailscale stack is running, and service origins are trusted.';
    }
    return 'This is the best full-power mode because the browser and desktop services are on the same PC.';
  }

  function lanAddressSummary(health: HubHealth | null): { label: string; detail: string } {
    if (!health) return { label: 'Run Check Services', detail: 'The Hub API reports LAN IPv4 addresses when it is reachable.' };
    const addresses = health.network?.lanIpv4 ?? [];
    if (addresses.length) {
      return {
        label: addresses.join(', '),
        detail: 'Detected from the PC network interfaces through the Hub API.'
      };
    }
    return {
      label: 'No LAN IPv4 reported',
      detail: 'Use the Tailscale name/100.x address or the URL printed by the LAN launcher.'
    };
  }

  async function saveEndpoints(): Promise<void> {
    if (endpointSaving) return;
    endpointSaving = true;
    endpointMessage = '';
    endpointError = '';
    try {
      setServiceEndpoints({
        hubApi: hubApiInput,
        aiOs: aiOsInput,
        macroLab: macroLabInput,
        ollama: ollamaInput
      });
      setBridgeToken(bridgeTokenInput);
      hubApiInput = getApiUrl();
      aiOsInput = getAiOsApiUrl();
      macroLabInput = getMacroLabApiUrl();
      ollamaInput = getOllamaUrl();
      bridgeTokenInput = getBridgeToken();
      endpointMessage = 'Saved. Checking services with the new URLs.';
      await checkServices();
      endpointMessage = 'Saved. Service requests now use these URLs on this browser.';
    } catch (error) {
      endpointError = error instanceof Error ? error.message : 'Service URL save failed.';
    } finally {
      endpointSaving = false;
    }
  }

  async function chooseTheme(mode: ThemeMode): Promise<void> {
    settingsError = '';
    setTheme(mode);
    if (!canSync) return;
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
    const blocked = machineModeBlockedReason(settingsControlState);
    if (blocked) {
      settingsError = blocked;
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
    const blocked = exportCacheBlockedReason(settingsControlState);
    if (blocked) {
      settingsError = blocked;
      return;
    }
    exportBusy = true;
    settingsError = '';
    settingsMessage = '';
    try {
      const blob = new Blob([JSON.stringify($clientData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'mini-hub-sync-cache.json';
      link.click();
      URL.revokeObjectURL(url);
      settingsMessage = 'Local cache export downloaded.';
    } catch (error) {
      settingsError = error instanceof Error ? error.message : 'Cache export failed.';
    } finally {
      exportBusy = false;
    }
  }

  function exportCacheBlockedReason(state: Pick<SettingsControlState, 'clientInitialized' | 'exportBusy'>): string {
    if (state.exportBusy) return 'Cache export is already running.';
    if (!state.clientInitialized) return 'Opening the browser cache before export is available.';
    return '';
  }

  function exportCacheTitle(state: Pick<SettingsControlState, 'clientInitialized' | 'exportBusy'>): string {
    return exportCacheBlockedReason(state) || 'Download the current browser cache as JSON for local inspection, backup, or recovery.';
  }

  function hydrateCapabilityCache(): void {
    const cached = readCachedCapabilityRegistrySnapshot();
    if (!cached) return;
    capabilitySnapshot = cached.snapshot;
    capabilityCachedAt = cached.cachedAt;
  }

  async function refreshCapabilities(options: { background?: boolean } = {}): Promise<void> {
    const background = options.background === true && Boolean(capabilitySnapshot);
    if (!background) capabilityLoading = true;
    capabilityError = '';
    try {
      const googleStatus = await loadGoogleStatus();
      googleConnected = googleStatus.connected;
      googleReady = googleStatus.ready;
      googleNeedsReconnect = googleStatus.needsReconnect;
      googleStatusDetail = googleStatus.detail;
      googleFixAction = googleStatus.fixAction;
      const snapshot = await loadCapabilityRegistry({
        isOnline: $clientData.isOnline,
        syncStatus: $clientData.status,
        syncError: $clientData.error,
        googleConnected: googleReady,
        machineMode: currentMachineMode.id
      });
      const cacheWrite = writeCapabilityRegistryCache(snapshot);
      capabilitySnapshot = snapshot;
      if (cacheWrite.cachedAt) capabilityCachedAt = cacheWrite.cachedAt;
      if (cacheWrite.error) capabilityError = cacheWrite.error;
    } catch (error) {
      capabilityError = error instanceof Error ? error.message : 'Capability registry failed to load.';
    } finally {
      if (!background) capabilityLoading = false;
    }
  }

  function currentOrigin(): string {
    return typeof window === 'undefined' ? '' : window.location.origin;
  }

  function apiStatusReady(value: string): boolean {
    return /:\s*ok\b/iu.test(value) && !/\bnot ok\b/iu.test(value);
  }

  function apiStatusError(value: string): string {
    if (!value || value === 'Run Check Services' || value === 'Checking' || apiStatusReady(value)) return '';
    return value;
  }

  function formatHubCoreDataHealth(health: HubHealth | null): string {
    const core = health?.storage?.coreData;
    if (!core) return 'Run Check Services to inspect API persistence.';
    const counts = core.recordCounts;
    const countText = `${counts.jobs} jobs, ${counts.studySessions} study logs, ${counts.careerActions} career actions, ${counts.gameRuns} game runs, ${counts.syncEvents} sync events`;
    if (core.status === 'persistent') {
      return `Persistent snapshot ${core.updatedAt ? `saved ${new Date(core.updatedAt).toLocaleString()}` : 'is available'} (${formatBytes(core.bytes)}; ${countText}).`;
    }
    if (core.status === 'memory_only') return `Memory-only for this API process (${countText}). Start the configured local API for disk persistence.`;
    if (core.status === 'missing') return `Persistence is configured, but no core-data snapshot exists yet (${countText}). Save a Career, Study, Settings, or game item to create it.`;
    return `${core.detail} (${countText}).`;
  }

  function capabilityServiceReady(service: CapabilityService): boolean {
    const group = capabilityGroups.find((item) => item.service === service);
    return Boolean(group && group.ready > 0 && group.issues === 0);
  }

  function capabilityServiceError(service: CapabilityService): string {
    const issue = capabilitySnapshot?.capabilities.find((capability) => capability.service === service && capability.lastError);
    return issue?.lastError ?? '';
  }

  function browserStorageAvailable(): boolean {
    return canUseBrowserStorage();
  }

  function featureWiringWhen(row: FeatureWiringRow): string {
    if (!row.lastCheckedAt) return 'Run Check Services';
    const date = new Date(row.lastCheckedAt);
    if (Number.isNaN(date.getTime())) return row.lastCheckedAt;
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  function featureWiringOpenTitle(row: FeatureWiringRow): string {
    if (row.status === 'unknown') return `Open ${row.feature} after running Check Services if this still needs setup.`;
    if (row.status === 'ready') return `Open ${row.feature}.`;
    return `Open ${row.feature} setup or status screen.`;
  }

  function isGoogleAuthError(message = ''): boolean {
    return /token has been expired or revoked|invalid_grant|unauthori[sz]ed|401|403|access_denied|oauth|permission/iu.test(message);
  }

  async function loadGoogleStatus(): Promise<{
    connected: boolean;
    ready: boolean;
    needsReconnect: boolean;
    detail: string;
    fixAction: string;
  }> {
    try {
      const connections = await getConnections();
      const connected = connections.some((connection) => connection.provider === 'google' && connection.status === 'connected');
      if (!connected) {
        return {
          connected: false,
          ready: false,
          needsReconnect: false,
          detail: 'No Google account is connected in this browser session.',
          fixAction: 'Open Productivity Hub and connect Google.'
        };
      }
      try {
        await Promise.all([listCalendars(), listGmailLabels()]);
        return {
          connected: true,
          ready: true,
          needsReconnect: false,
          detail: `${connections.length} saved Google account${connections.length === 1 ? '' : 's'} can reach Calendar and Gmail APIs.`,
          fixAction: 'No action needed.'
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Google readiness check failed.';
        const authError = isGoogleAuthError(message);
        return {
          connected: true,
          ready: false,
          needsReconnect: authError,
          detail: authError
            ? 'A saved Google account exists, but Google rejected the token. Reconnect the account before Calendar or Gmail actions can run.'
            : compactServiceIssueIfRecognized(message, 'Google productivity'),
          fixAction: authError ? 'Open Productivity Hub and use Reconnect Google to refresh OAuth.' : 'Open Productivity Hub, retry Refresh, then inspect the Google error.'
        };
      }
    } catch (error) {
      return {
        connected: false,
        ready: false,
        needsReconnect: false,
        detail: error instanceof Error ? compactServiceIssueIfRecognized(error.message, 'Google productivity') : 'Google connection check failed.',
        fixAction: 'Start the Mini Hub API and retry Check Services.'
      };
    }
  }

  function groupCapabilityServices(capabilities: CapabilityRegistryEntry[]): CapabilityServiceGroup[] {
    const order: CapabilityService[] = ['hub', 'browser', 'productivity', 'ai-os', 'macro-lab', 'passive-tasks'];
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
    if (service === 'passive-tasks') return 'Background watchers, run history, digests, and scheduler controls.';
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
    if (!action.recoverability.reversible) return false;
    if (action.system === 'mini-hub') return true;
    if (action.system === 'ai-os') return action.recoverability.kind === 'snapshot' && Boolean(action.recoverability.referenceId);
    return action.system === 'macro-lab' && ['snapshot', 'artifact'].includes(action.recoverability.kind) && Boolean(action.recoverability.referenceId);
  }

  function capabilityRefreshTitle(state: Pick<SettingsControlState, 'capabilityLoading'>): string {
    return state.capabilityLoading ? 'Capability registry refresh is already running.' : 'Refresh service capability readiness from configured endpoints.';
  }

  function themeButtonTitle(mode: ThemeMode): string {
    if (themeSaving) return 'Theme preference is already saving.';
    return `Switch theme to ${mode}.`;
  }

  function actionLedgerRefreshTitle(state: Pick<SettingsControlState, 'actionLedgerLoading'>): string {
    return state.actionLedgerLoading ? 'Action Ledger refresh is already running.' : 'Refresh recent actions from Mini Hub, AI OS, and Macro Lab.';
  }

  function actionLedgerEmptyMessage(): string {
    if (actionLedgerLoading) return 'Loading action ledger.';
    if (actionLedgerError) return visibleActionLedgerError || 'Action Ledger needs attention.';
    if (!actionLedgerSnapshot) return 'Action Ledger needs a fresh source check. Use Refresh or Check Services to inspect Hub, AI OS, Macro Lab, and browser actions.';
    if (actionLedgerSnapshot.errors.length) {
      return 'No action rows loaded from reachable sources. The source issue is shown below; browser-only actions will still appear here when recorded.';
    }
    return 'No action ledger entries are recorded yet. New saves, AI OS jobs, passive work, and Macro Lab runs will appear here.';
  }

  function restoreActionTitle(action: ActionLedgerEntry): string {
    if (restoreBusyId === action.id) return 'This restore is already running.';
    if (restoreBusyId) return 'Another restore action is already running.';
    if (!canRestoreAction(action)) return 'This action does not have a reversible snapshot or recovery artifact.';
    if (action.system === 'ai-os') return `Ask for confirmation before restoring "${action.summary}". This can overwrite the current local file target.`;
    if (action.system === 'macro-lab') return `Ask for confirmation before restoring "${action.summary}". This can move, delete, or overwrite local files.`;
    return `Ask for confirmation before restoring "${action.summary}". This writes synced Mini Hub data.`;
  }

  async function restoreAction(action: ActionLedgerEntry): Promise<void> {
    if (!canRestoreAction(action) || restoreBusyId) return;
    const isAiSnapshot = action.system === 'ai-os';
    const isMacroRecovery = action.system === 'macro-lab';
    const confirmed =
      typeof window === 'undefined' ||
      window.confirm(
        isAiSnapshot
          ? `Restore the file snapshot for "${action.summary}"? This will overwrite the current local file target.`
          : isMacroRecovery
            ? `Restore the Macro Lab file recovery artifacts for "${action.summary}"? This will move, delete, or overwrite local files according to the recorded inverse operations.`
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
      } else if (isMacroRecovery) {
        await restoreMacroRun(action.recoverability.referenceId ?? '');
        actionLedgerMessage = 'Macro Lab file recovery artifacts restored and the restore was added to run history.';
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

  function modeButtonTitle(mode: MachineModeDefinition, blocked = machineModeBlocked): string {
    if (blocked) return blocked;
    return `${mode.label}: ${mode.summary}`;
  }

  function machineModeBlockedReason(
    state: Pick<SettingsControlState, 'canSync' | 'clientInitialized' | 'clientOnline' | 'clientStatus' | 'clientError'>
  ): string {
    if (!state.clientInitialized) return 'Loading local cache before machine mode can be saved.';
    if (!state.clientOnline) return 'Offline read-only: connect the Mini Hub API before saving Machine Mode.';
    if (!state.canSync) {
      return state.clientError
        ? `Machine Mode cannot save because Mini Hub API is not ready: ${state.clientError}`
        : `Machine Mode cannot save while sync is ${state.clientStatus}.`;
    }
    return '';
  }

  function aiOsEndpointIssue(resolutions = endpointResolutions): string {
    const endpoint = resolutions.find((item) => item.id === 'aiOs');
    if (endpoint?.state === 'misconfigured') return endpoint.fixAction || 'Save a valid AI OS endpoint before running machine controls.';
    return '';
  }

  function machineProfileControlBlockedReason(
    action: 'autotune' | 'snapshot',
    state: {
      endpointIssue: string;
      busy: boolean;
      loading: boolean;
      profile: AiMachineProfile | null;
      error: string;
    } = {
      endpointIssue: aiOsEndpointIssue(),
      busy: autotuneBusy,
      loading: machineProfileLoading,
      profile: machineProfile,
      error: machineProfileError
    }
  ): string {
    if (state.endpointIssue) return state.endpointIssue;
    if (action === 'autotune' && state.busy) return 'Autotune is already running.';
    if (state.loading) return 'Machine profile is loading.';
    if (!state.profile) {
      return state.error
        ? 'AI OS is unavailable. Start AI OS or fix the endpoint, then retry the profile check.'
        : 'Load the AI OS Machine Profile before running this control.';
    }
    return '';
  }

  function machineAutotuneTitle(blockedReason: string): string {
    return (
      blockedReason ||
      'Run a small AI OS benchmark, save latency/provider/model data, and update routing plus mode recommendations.'
    );
  }

  function machineSnapshotTitle(blockedReason: string): string {
    return (
      blockedReason ||
      'Save the current AI OS machine profile snapshot so Settings, Today, and AI OS can reload measured hardware and provider status.'
    );
  }

  function machineProfileRefreshTitle(isLoading: boolean): string {
    return isLoading
      ? 'Machine profile is already loading.'
      : 'Reload AI OS machine profile, recent snapshots, provider readiness, and benchmark history.';
  }

  async function refreshMachineProfile(mode = currentMachineMode.id): Promise<void> {
    machineProfileLoading = true;
    machineProfileError = '';
    try {
      const result = await getMachineProfile(mode, 5);
      machineProfile = result.profile;
      machineSnapshots = result.snapshots;
    } catch (error) {
      machineProfile = null;
      machineProfileError = error instanceof Error ? error.message : 'Machine profile failed to load.';
    } finally {
      machineProfileLoading = false;
    }
  }

  async function runMachineAutotune(): Promise<void> {
    if (machineAutotuneBlockedReason) {
      machineProfileError = machineAutotuneBlockedReason;
      return;
    }
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
    if (machineSnapshotBlockedReason) {
      machineProfileError = machineSnapshotBlockedReason;
      return;
    }
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

  function ollamaWiringDetail(status: string, modelCount: number, readyViaAiOs: boolean, bestRoute: string): string | undefined {
    if (apiStatusReady(status)) return `Ollama responded directly with ${modelCount} local model${modelCount === 1 ? '' : 's'}.`;
    if (readyViaAiOs) {
      const modelText = modelCount > 0 ? `${modelCount} local model${modelCount === 1 ? '' : 's'}` : 'local model telemetry';
      return `AI OS can reach Ollama (${modelText}; best route ${bestRoute}). Direct browser-to-Ollama checks are optional and may be blocked on hosted pages.`;
    }
    return undefined;
  }

  function formatPercent(value: number | undefined): string {
    return typeof value === 'number' && Number.isFinite(value) ? `${value}%` : 'not measured';
  }

  function capabilityMetricString(capability: CapabilityRegistryEntry | undefined, key: string): string {
    const value = capability?.metrics?.[key];
    return typeof value === 'string' && value.trim() ? value : '';
  }

  function capabilityMetricNumber(capability: CapabilityRegistryEntry | undefined, key: string): number | undefined {
    const value = capability?.metrics?.[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  }

  function machineGpuName(gpu: Record<string, unknown> | undefined, telemetry: CapabilityRegistryEntry | undefined): string {
    const name = gpu?.name;
    if (typeof name === 'string' && name.trim()) return name;
    return capabilityMetricString(telemetry, 'gpuName') || 'No telemetry';
  }

  function machineGpuDetail(gpu: Record<string, unknown> | undefined, telemetry: CapabilityRegistryEntry | undefined): string {
    if (!gpu) {
      const fallbackCount = capabilityMetricNumber(telemetry, 'gpus') ?? 0;
      if (fallbackCount > 0) return 'Detected from AI OS telemetry fallback.';
      return 'Live GPU telemetry has not reported a GPU yet.';
    }
    const status = typeof gpu.telemetry_status === 'string' ? gpu.telemetry_status : '';
    const source = typeof gpu.source === 'string' ? gpu.source : '';
    if (status === 'stale' || source === 'benchmark-cache') {
      const observedAt = typeof gpu.last_observed_at === 'string' ? gpu.last_observed_at : '';
      return observedAt ? `Cached from benchmark ${new Date(observedAt).toLocaleString()}` : 'Cached from benchmark history';
    }
    return typeof gpu.vendor === 'string' && gpu.vendor ? gpu.vendor : source || 'Live telemetry';
  }

  function formatBytes(value: number | undefined): string {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 'not measured';
    if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
    if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${value} B`;
  }

  function formatSnapshotAge(value: number | undefined): string {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 'not measured';
    if (value >= 48) return `${Math.round(value / 24)} d`;
    if (value >= 1) return `${Math.round(value)} hr`;
    return '<1 hr';
  }

  function compactFileName(value: string | undefined): string {
    if (!value) return 'No restore file recorded';
    const parts = value.split(/[\\/]/u).filter(Boolean);
    return parts[parts.length - 1] ?? value;
  }

  function backupHealthLabel(health: PassiveBackupHealth | null): string {
    if (!health) return 'Refresh needed';
    if (health.status === 'ok') return 'Verified';
    if (health.status === 'warning') return health.stale ? 'Stale' : 'Review';
    return 'Needs setup';
  }

  function backupHealthClass(health: PassiveBackupHealth | null): string {
    if (!health) return 'unknown';
    return health.status;
  }

  function compactSettingsIssue(message = '', label = 'Settings'): string {
    const text = message.trim();
    if (!text) return `${label} needs attention. Retry the action or check Feature Wiring.`;
    const compact = compactServiceIssueIfRecognized(text, label);
    return compact === text && text.length > 140 ? `${text.slice(0, 137)}...` : compact;
  }

  function capabilityIssueDetail(capability: CapabilityRegistryEntry): string {
    if (capability.lastError) return compactSettingsIssue(capability.lastError, capability.label);
    return capability.requiredService ?? capability.description;
  }

  function backupHealthDetail(health: PassiveBackupHealth): string {
    if (!health.latestPath) return health.error ? compactSettingsIssue(health.error, 'Passive restore points') : 'No Mini Hub restore point is available yet.';
    const cleanup = health.cleanupCandidateCount
      ? ` Cleanup dry-run: ${health.cleanupCandidateCount} candidate${health.cleanupCandidateCount === 1 ? '' : 's'} (${formatBytes(health.cleanupBytes)}).`
      : '';
    return `${compactFileName(health.latestPath)} is ${formatSnapshotAge(health.latestAgeHours)} old, ${formatBytes(health.latestBytes)}, sha ${health.latestSha256?.slice(0, 12) ?? 'hash not reported'}.${cleanup}`;
  }

  onMount(() => {
    loadEndpointInputs();
    hydrateCapabilityCache();
    void clientData.init();
    void checkServices();
  });
</script>

<svelte:head>
  <title>Settings - Mini Hub</title>
</svelte:head>

<section class="page-header">
  <div>
    <p class="eyebrow">Settings</p>
    <h1>Settings</h1>
  </div>
  <button class="button" type="button" disabled={serviceChecking} title={serviceCheckButtonTitle} on:click={checkServices}>
    <RefreshCw size={17} />
    <span>Check Services</span>
  </button>
</section>

<section class="service-control" aria-label="Service and machine control">
  <div class="service-control-header">
    <div>
      <p class="eyebrow">Machine Control</p>
      <h2>Services And Capabilities</h2>
    </div>
    <button class="button" type="button" disabled={capabilityLoading} title={capabilityRefreshButtonTitle} on:click={() => refreshCapabilities()}>
      <Activity size={17} />
      <span>{capabilityLoading ? 'Checking' : 'Refresh Capabilities'}</span>
    </button>
  </div>

  <div id="connection-mode" class="connection-mode-panel">
    <div class="mode-heading">
      <div>
        <strong>Remote Access / Connection Mode</strong>
        <span>{connectionMode.summary}</span>
      </div>
      <small class={`mode-pill ${connectionModeClass}`}>{connectionMode.label}</small>
    </div>
    <p class="helper-text">{connectionMode.detail} {endpointModeNote()}</p>
    <div class="connection-grid" aria-label="Current connection mode">
      <div>
        <span>App origin</span>
        <strong>{currentOrigin() || 'Unknown browser origin'}</strong>
      </div>
      <div>
        <span>PC requirement</span>
        <strong>{connectionMode.fullPower ? 'PC services required' : 'Static shell'}</strong>
        <small>{connectionMode.setupAction}</small>
      </div>
      <div>
        <span>Detected LAN IPv4</span>
        <strong>{lanAddressInfo.label}</strong>
        <small>{lanAddressInfo.detail}</small>
      </div>
      <div>
        <span>Local full power</span>
        <strong>http://127.0.0.1:5173</strong>
        <small>Open this on the Windows PC.</small>
      </div>
      <div>
        <span>Bridge token</span>
        <strong>{bridgeTokenConfigured() ? 'Saved in this browser' : 'Not saved'}</strong>
        <small>{bridgeTokenConfigured() ? 'Sent to Hub API, AI OS, and Macro Lab when configured server-side.' : 'Optional; set MINI_HUB_BRIDGE_TOKEN before exposing services beyond loopback.'}</small>
      </div>
    </div>
    <div class="endpoint-diagnostic-list" aria-label="Service targets for this browser">
      {#each endpointResolutions as endpoint}
        <article class="endpoint-diagnostic-row">
          <span class={`state-chip ${endpoint.state}`}>{endpoint.state}</span>
          <div>
            <strong>{endpoint.label}</strong>
            <small>{endpoint.detail}</small>
            <code>{endpointHealthTarget(endpoint.id, endpoint.resolvedUrl)}</code>
            {#if endpointSuggestion(endpoint.id)}
              <em>Current-host suggestion: {endpointSuggestion(endpoint.id)?.url}</em>
            {/if}
          </div>
        </article>
      {/each}
    </div>
    <div class="action-row tight">
      <button
        class="button"
        type="button"
        disabled={endpointSaving || !endpointSuggestions.length}
        title={currentHostEndpointTitle()}
        on:click={applyCurrentHostEndpoints}
      >
        <Cloud size={17} />
        <span>Use Current Host URLs</span>
      </button>
      <button class="button" type="button" disabled={endpointSaving} title="Use the default Local Full Power service URLs on this Windows PC." on:click={applyLocalhostEndpoints}>
        <Monitor size={17} />
        <span>Use Localhost URLs</span>
      </button>
      <a class="button" href="http://127.0.0.1:5173/" target="_blank" rel="noreferrer" title="Open the local full-power hub on this Windows PC.">
        <Monitor size={17} />
        <span>Open Local Full Power</span>
      </a>
      <a class="button" href="https://elc9939.github.io/testing/" target="_blank" rel="noreferrer" title="Open the hosted static shell. Full-power services still need private endpoints.">
        <Cloud size={17} />
        <span>Open Hosted Light</span>
      </a>
    </div>
    <p class="helper-text">
      Profiles: Localhost uses 127.0.0.1 on this PC; Current Host uses the LAN/Tailscale/private host serving this page; hosted GitHub Pages needs manually saved private endpoints or an HTTPS tunnel/proxy that forwards to these same service ports.
    </p>
  </div>

  <div id="machine-mode" class="machine-mode-panel">
    <div class="mode-heading">
      <div>
        <strong>Machine Mode</strong>
        <span>{currentMachineMode.summary}</span>
      </div>
      <small>{modeSaving ? 'Saving' : currentMachineMode.label}</small>
    </div>
    <div class="mode-segment" aria-label="Primary machine mode presets">
      {#each primaryMachineModes as mode}
        <button
          class:active={currentMachineMode.id === mode.id}
          type="button"
          title={modeButtonTitle(mode, machineModeBlocked)}
          aria-pressed={currentMachineMode.id === mode.id}
          disabled={Boolean(machineModeBlocked)}
          on:click={() => chooseMachineMode(mode.id)}
        >
          <strong>{mode.shortLabel}</strong>
          <span>{mode.summary}</span>
        </button>
      {/each}
    </div>
    {#if currentMachineMode.id === 'auto'}
      <p class="helper-text">
        Auto uses AI OS machine pressure and idle state: active or high-pressure sessions defer heavier passive work, while idle low-pressure sessions can run local batches and sweeps.
      </p>
    {/if}
    <details class="advanced-mode-options">
      <summary>
        <span>Advanced modes</span>
        <small>{advancedMachineModes.length} special presets; {machineModes.length} total</small>
      </summary>
      <div class="mode-segment compact" aria-label="Advanced machine mode presets">
        {#each advancedMachineModes as mode}
          <button
            class:active={currentMachineMode.id === mode.id}
            type="button"
            title={modeButtonTitle(mode, machineModeBlocked)}
            aria-pressed={currentMachineMode.id === mode.id}
            disabled={Boolean(machineModeBlocked)}
            on:click={() => chooseMachineMode(mode.id)}
          >
            <strong>{mode.shortLabel}</strong>
            <span>{mode.summary}</span>
          </button>
        {/each}
      </div>
      <pre class="mode-context">{currentMachineModeDetails}</pre>
    </details>
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
          <strong>{formatPercent(machineProfile.hardware.cpu_percent)} / {formatPercent(machineProfile.hardware.memory_percent)}</strong>
        </div>
        <div>
          <span>GPU</span>
          <strong>{machineGpuName(machineProfile.hardware.gpus[0], machineTelemetryCapability)}</strong>
          <small>{machineGpuDetail(machineProfile.hardware.gpus[0], machineTelemetryCapability)}</small>
        </div>
        <div>
          <span>Best Route</span>
          <strong>{machineBestRoute}</strong>
          <small>{machineBestSpeed}</small>
        </div>
        <div>
          <span>Concurrency</span>
          <strong>{machineProfile.autotune.suggested_max_job_concurrency ?? 'not measured'}</strong>
        </div>
        <div>
          <span>Snapshots</span>
          <strong>{machineSnapshots.length}</strong>
          <small>{machineSnapshots[0]?.created_at ? new Date(machineSnapshots[0].created_at).toLocaleString() : 'No machine profile snapshots saved yet.'}</small>
        </div>
      </div>
      {#if machineProfile.autotune.routing_notes?.length}
        <p class="helper-text">{machineProfile.autotune.routing_notes[0]}</p>
      {/if}
    {:else if machineProfileError}
      <p class="sync-error" title="Machine profile diagnostic is compacted for display. Retry Profile or open Feature Wiring for service setup.">{visibleMachineProfileError}</p>
    {:else}
      <p class="helper-text">Machine profile has not been loaded yet. Start AI OS, then check services.</p>
    {/if}
    <div class="action-row tight">
      <button class="button primary" type="button" disabled={Boolean(machineAutotuneBlockedReason)} title={machineAutotuneButtonTitle} on:click={runMachineAutotune}>
        <Activity size={17} />
        <span>{autotuneBusy ? 'Running' : 'Run Autotune'}</span>
      </button>
      <button class="button" type="button" disabled={Boolean(machineSnapshotBlockedReason)} title={machineSnapshotButtonTitle} on:click={saveMachineSnapshot}>
        <Save size={17} />
        <span>Save Snapshot</span>
      </button>
      <button class="button" type="button" disabled={machineProfileLoading} title={machineProfileRefreshButtonTitle} on:click={() => refreshMachineProfile()}>
        <RefreshCw size={17} />
        <span>{machineProfileError && !machineProfile ? 'Retry Profile' : 'Refresh Profile'}</span>
      </button>
    </div>
    {#if machineProfileMessage}
      <p class="endpoint-message">{machineProfileMessage}</p>
    {/if}
    {#if machineProfileError && machineProfile}
      <p class="sync-error" title="Machine profile diagnostic is compacted for display. Retry Profile or open Feature Wiring for service setup.">{visibleMachineProfileError}</p>
    {/if}
  </div>

  {#if capabilitySnapshot}
    <p class="helper-text">
      {#if capabilityLoading}
        Updating capability registry quietly; cached service status remains visible.
      {:else if capabilityCachedAt}
        Capability registry warm-loaded from browser cache saved {new Date(capabilityCachedAt).toLocaleString()}.
      {:else}
        Capability registry loaded from live services.
      {/if}
    </p>
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
          <a class="issue-row" href={hubHref(capability.route)} title={`Open ${capability.label} setup or status.`}>
            <span class={`state-chip ${capability.state}`}>{capabilityStateLabel(capability.state)}</span>
            <span>
              <strong>{capability.label}</strong>
              <small>{capabilityIssueDetail(capability)}</small>
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
            <a class="button compact" href={hubHref(group.route)} title={`Open ${group.label} panel.`}>
              <span>Open Panel</span>
              <ArrowRight size={15} />
            </a>
            {#if serviceHealthHref(group.service)}
              <a class="button compact" href={serviceHealthHref(group.service)} target="_blank" rel="noreferrer" title={`Open ${group.label} service health endpoint.`}>
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
    <p class="sync-error" title="Capability Registry diagnostic is compacted for display. Retry Refresh Capabilities or check Feature Wiring.">{visibleCapabilityError}</p>
  {:else}
    <p class="helper-text">Capability status has not been checked yet.</p>
  {/if}

  <div id="feature-wiring" class="feature-wiring-panel" aria-label="Feature wiring diagnostics">
    <div class="section-title split-title">
      <span>
        <Monitor size={18} />
        <strong>Feature Wiring</strong>
      </span>
      <small>{serviceCheckedAt ? `Checked ${new Date(serviceCheckedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Run Check Services'}</small>
    </div>
    <p class="helper-text">
      Shows what each visible feature depends on from this browser. If the hosted site is accidentally pointed at GitHub Pages /api routes, it will show as misconfigured here instead of failing as a plain 404 page.
    </p>
    <div class="feature-wiring-list">
      {#each featureWiringRows as row}
        <article class="feature-wiring-row">
          <span class={`state-chip ${row.status}`}>{featureWiringStatusLabel(row.status)}</span>
          <div class="feature-wiring-main">
            <strong>{row.feature}</strong>
            <small>{row.requiredService}</small>
            <span>{row.detail}</span>
            <code>{row.endpoint}</code>
          </div>
          <div class="feature-wiring-fix">
            <small>{row.fixAction}</small>
            <small>{featureWiringWhen(row)}</small>
          </div>
          <div class="feature-wiring-actions">
            <a class="button compact" href={hubHref(row.route)} title={featureWiringOpenTitle(row)}>
              <span>Open</span>
              <ArrowRight size={15} />
            </a>
            {#if row.healthUrl}
              <a class="button compact" href={row.healthUrl} target="_blank" rel="noreferrer" title={`Open ${row.feature} health endpoint.`}>
                <span>Health</span>
                <ArrowRight size={15} />
              </a>
            {/if}
          </div>
        </article>
      {/each}
    </div>
  </div>
</section>

<section class="card card-pad passive-settings-panel">
  <div class="section-title split-title">
    <span>
      <ListChecks size={18} />
      <strong>Passive Tasks</strong>
    </span>
    <a class="button compact" href={hubHref('/passive-tasks')} title="Open Passive Tasks dashboard.">
      <span>Dashboard</span>
      <ArrowRight size={15} />
    </a>
  </div>

  {#if passiveSettings}
    <div class="passive-summary">
      <div>
        <span>Engine</span>
        <strong>{passiveSettings.enabled ? 'On' : 'Off'}</strong>
      </div>
      <div>
        <span>Watchers</span>
        <strong>{passiveEnabledWatchers}/{passiveSnapshot?.watchers.length ?? 0}</strong>
      </div>
      <div>
        <span>Digest</span>
        <strong>{passiveSnapshot?.digest.length ?? 0}</strong>
      </div>
      <div>
        <span>Failures</span>
        <strong>{passiveFailures}</strong>
      </div>
      <div>
        <span>Backups</span>
        <strong>{backupHealthLabel(passiveBackupHealth)}</strong>
      </div>
    </div>

    {#if passiveBackupHealth}
      <div class={`passive-backup-health ${backupHealthClass(passiveBackupHealth)}`}>
        <span>
          <strong>Restore point health</strong>
          <small>{backupHealthDetail(passiveBackupHealth)}</small>
          {#if passiveBackupHealth.error}
            <em title="Passive restore point diagnostic is compacted for display. Retry Passive or check Data & Recovery.">{visiblePassiveBackupHealthError}</em>
          {/if}
        </span>
        <a class="button compact" href={hubHref('/passive-tasks')} title="Open Passive Tasks restore points.">Open Restore Points</a>
      </div>
    {/if}

    <div class="passive-control-grid">
      <label class="toggle-row">
        <input
          type="checkbox"
          checked={passiveSettings.enabled}
          disabled={Boolean(passiveSettingsBlockedReason)}
          title={passiveWorkerToggleTitle(passiveSettings.enabled)}
          on:change={(event) => updatePassivePreference({ enabled: event.currentTarget.checked })}
        />
        <span>
          <strong>Enable passive task engine</strong>
          <small>Scheduled and event-style checks can run in the background.</small>
        </span>
      </label>
      <label class="toggle-row">
        <input
          type="checkbox"
          checked={passiveSettings.idleOnly}
          disabled={Boolean(passiveSettingsBlockedReason)}
          title={passivePreferenceTitle('idle')}
          on:change={(event) => updatePassivePreference({ idleOnly: event.currentTarget.checked })}
        />
        <span>
          <strong>Prefer idle-only background work</strong>
          <small>Scheduled work waits for the local API to report a Windows idle window.</small>
        </span>
      </label>
      <label class="field">
        <span>Notifications</span>
        <select
          value={passiveSettings.notificationStyle}
          disabled={Boolean(passiveSettingsBlockedReason)}
          title={passivePreferenceTitle('notifications')}
          on:change={(event) => updatePassivePreference({ notificationStyle: event.currentTarget.value as 'digest' | 'urgent_only' | 'off' })}
        >
          <option value="digest">Digest</option>
          <option value="urgent_only">Urgent only</option>
          <option value="off">Off</option>
        </select>
      </label>
      <label class="field">
        <span>Resource limit</span>
        <select
          value={passiveSettings.resourceLimit}
          disabled={Boolean(passiveSettingsBlockedReason)}
          title={passivePreferenceTitle('resource')}
          on:change={(event) => updatePassivePreference({ resourceLimit: event.currentTarget.value as 'light' | 'balanced' | 'heavy' })}
        >
          <option value="light">Light</option>
          <option value="balanced">Balanced</option>
          <option value="heavy">Heavy</option>
        </select>
      </label>
      <label class="field">
        <span>AI preference</span>
        <select
          value={passiveSettings.localAiPreference}
          disabled={Boolean(passiveSettingsBlockedReason)}
          title={passivePreferenceTitle('ai')}
          on:change={(event) => updatePassivePreference({ localAiPreference: event.currentTarget.value as 'local_first' | 'local_only' | 'cloud_allowed' })}
        >
          <option value="local_first">Local first</option>
          <option value="local_only">Local only</option>
          <option value="cloud_allowed">Cloud allowed</option>
        </select>
      </label>
      <label class="field">
        <span>Max runs per tick</span>
        <input
          type="number"
          min="1"
          max="10"
          value={passiveSettings.maxRunsPerTick}
          disabled={Boolean(passiveSettingsBlockedReason)}
          title={passivePreferenceTitle('maxRuns')}
          on:change={(event) => updatePassivePreference({ maxRunsPerTick: Number(event.currentTarget.value) || 1 })}
        />
      </label>
    </div>

    <div class="passive-family-grid" aria-label="Passive task families">
      {#each passiveFamilyRows as family}
        <label class="family-toggle-row">
          <input
            type="checkbox"
            checked={family.familyEnabled}
            disabled={Boolean(passiveSettingsBlockedReason)}
            title={passiveFamilyToggleTitle(family)}
            on:change={(event) => updatePassiveFamily(family.family, event.currentTarget.checked)}
          />
          <span>
            <strong>{family.label}</strong>
            <small>{family.description}</small>
            <em>{family.taskCount} task{family.taskCount === 1 ? '' : 's'} - watcher {family.watcherEnabled ? 'on' : 'off'} - family {family.familyEnabled ? 'enabled' : 'disabled'}</em>
          </span>
        </label>
      {/each}
    </div>

    <div class="passive-scope-grid">
      <label class="field">
        <span>Watched folders</span>
        <textarea
          bind:value={passiveFolders}
          rows="4"
          placeholder="C:\Users\Edward\Downloads"
          disabled={Boolean(passiveSettingsBlockedReason)}
          title={passiveScopeTitle('folders')}
        ></textarea>
      </label>
      <label class="field">
        <span>Watched research</span>
        <textarea
          bind:value={passiveDomains}
          rows="5"
          placeholder={watchedResearchPlaceholder}
          disabled={Boolean(passiveSettingsBlockedReason)}
          title={passiveScopeTitle('research')}
        ></textarea>
      </label>
      <label class="field">
        <span>Watched accounts</span>
        <textarea
          bind:value={passiveAccounts}
          rows="4"
          placeholder="personal@example.com"
          disabled={Boolean(passiveSettingsBlockedReason)}
          title={passiveScopeTitle('accounts')}
        ></textarea>
      </label>
    </div>
    <div class="action-row">
      <button
        class="button primary"
        type="button"
        disabled={Boolean(passiveSettingsBlockedReason)}
        title={passiveSettingsSaveButtonTitle}
        on:click={savePassiveSettings}
      >
        <Save size={17} />
        <span>{passiveSaving ? 'Saving' : 'Save Passive Settings'}</span>
      </button>
      <button
        class="button"
        type="button"
        disabled={passiveLoading}
        title={passiveSettingsRefreshButtonTitle}
        on:click={refreshPassiveSettings}
      >
        <RefreshCw size={17} />
        <span>{passiveLoading ? 'Loading' : passiveError ? 'Retry Passive' : 'Refresh'}</span>
      </button>
    </div>
    {#if passiveMessage}
      <p class="endpoint-message">{passiveMessage}</p>
    {/if}
    {#if passiveError}
      <p class="sync-error" title="Passive Tasks diagnostic is compacted for display. Retry Passive or check Feature Wiring.">{visiblePassiveError}</p>
    {/if}
  {:else if passiveLoading}
    <p class="helper-text">Loading passive task settings.</p>
  {:else if passiveError}
    <p class="sync-error" title="Passive Tasks diagnostic is compacted for display. Retry Passive or check Feature Wiring.">{visiblePassiveError}</p>
  {:else}
    <p class="helper-text">Passive task settings need a fresh source check. Use Check Services or open Passive Tasks.</p>
  {/if}
</section>

<section class="card card-pad settings-panel">
  <div class="panel-block">
    <div class="section-title">
      <Sun size={18} />
      <strong>Appearance</strong>
    </div>
    <div class="theme-segment" aria-label="Theme">
      <button class:active={$theme === 'system'} type="button" aria-pressed={$theme === 'system'} disabled={themeSaving} title={themeButtonTitle('system')} on:click={() => chooseTheme('system')}>
        <Monitor size={15} />
        <span>System</span>
      </button>
      <button class:active={$theme === 'light'} type="button" aria-pressed={$theme === 'light'} disabled={themeSaving} title={themeButtonTitle('light')} on:click={() => chooseTheme('light')}>
        <Sun size={15} />
        <span>Light</span>
      </button>
      <button class:active={$theme === 'dark'} type="button" aria-pressed={$theme === 'dark'} disabled={themeSaving} title={themeButtonTitle('dark')} on:click={() => chooseTheme('dark')}>
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
      <div><dt>Mode</dt><dd>{canSync ? 'Online auto-save' : $clientData.initialized ? 'Offline/read-only until API is ready' : 'Loading local cache'}</dd></div>
      <div><dt>Status</dt><dd>{$clientData.status}</dd></div>
      <div><dt>Last synced</dt><dd>{$clientData.lastSyncedAt ? new Date($clientData.lastSyncedAt).toLocaleString() : 'No completed sync recorded yet'}</dd></div>
      <div><dt>Legacy</dt><dd>{legacyImport?.importedAt ? `Imported ${new Date(legacyImport.importedAt).toLocaleDateString()}` : 'Auto-import waits for legacy browser data'}</dd></div>
      <div><dt>Device</dt><dd>{$clientData.deviceId}</dd></div>
      <div><dt>API</dt><dd>{getApiUrl()}</dd></div>
      <div><dt>API check</dt><dd>{apiStatus}</dd></div>
      <div><dt>Core data</dt><dd>{hubCoreDataStatus}</dd></div>
      <div><dt>Local DB</dt><dd>{import.meta.env.PUBLIC_PGLITE_DATA_DIR || 'idb://mini-hub'}</dd></div>
    </dl>
    <div class="action-row">
      <button class="button" type="button" disabled={Boolean(syncNowBlockedReason(settingsControlState))} title={syncNowButtonTitle} on:click={syncNow}>
        <Cloud size={17} />
        <span>Sync Now</span>
      </button>
      <button class="button" type="button" disabled={Boolean(exportCacheBlockedReason(settingsControlState))} title={exportCacheButtonTitle} on:click={exportCache}>
        <Download size={17} />
        <span>{exportBusy ? 'Exporting' : 'Export Cache'}</span>
      </button>
    </div>
    {#if settingsMessage}
      <p class="endpoint-message">{settingsMessage}</p>
    {/if}
    {#if settingsError || $clientData.error}
      <p class="sync-error" title="Settings/cache diagnostic is compacted for display. Retry Sync Now or check Feature Wiring.">
        {settingsError ? visibleSettingsError : visibleClientDataError}
      </p>
    {/if}
  </div>

  <div id="data-recovery" class="panel-block persistence-block">
    <div class="section-title split-title">
      <span>
        <Database size={18} />
        <strong>Data &amp; Recovery</strong>
      </span>
      <a class="button compact" href={hubHref('/activity')} title="Open Activity and Handoff records.">
        <span>Activity</span>
        <ArrowRight size={15} />
      </a>
    </div>
    <p class="helper-text">
      What survives refreshes, browser closes, route changes, and service outages. Cross-device rows depend on the Hub API or the owning local service being reachable.
    </p>
    <div class="recovery-rules" aria-label="Save and recovery rules">
      <div>
        <span>Switch pages</span>
        <strong>Safe</strong>
        <small>Visible drafts, filters, and active work rehydrate from browser state or the owning service.</small>
      </div>
      <div>
        <span>Close and reopen</span>
        <strong>Usually safe</strong>
        <small>Browser-local state returns in this browser; service-backed records reload when their API is online.</small>
      </div>
      <div>
        <span>Another device</span>
        <strong>Service-backed only</strong>
        <small>Hub API, Google, AI OS, Macro Lab, and Passive rows can follow; browser-only drafts stay here.</small>
      </div>
    </div>
    <div class="persistence-summary" aria-label="Persistence summary">
      <div>
        <span>Tracked</span>
        <strong>{persistenceStats.total}</strong>
      </div>
      <div>
        <span>Cross-device</span>
        <strong>{persistenceStats.crossDevice}</strong>
      </div>
      <div>
        <span>Browser-local</span>
        <strong>{persistenceStats.browserLocal}</strong>
      </div>
      <div>
        <span>Service-backed</span>
        <strong>{persistenceStats.serviceBacked}</strong>
      </div>
    </div>
    <div class="persistence-list" aria-label="Data persistence map">
      {#each persistenceRows as row}
        <article class="persistence-row">
          <span class={`owner-chip ${row.owner}`}>{persistenceOwnerLabel(row.owner)}</span>
          <div class="persistence-main">
            <strong>{row.feature}</strong>
            <small>{row.savedWhere}</small>
            <span>{row.reloadBehavior}</span>
            <em>{row.offlineBehavior}</em>
          </div>
          <span class:yes={row.crossDevice} class="cross-device">{row.crossDevice ? 'Cross-device' : 'This browser'}</span>
          <a class="button compact" href={hubHref(row.recoveryRoute)} title={`Open ${row.feature} recovery: ${row.recoveryLabel}.`}>
            <span>{row.recoveryLabel}</span>
            <ArrowRight size={15} />
          </a>
        </article>
      {/each}
    </div>
  </div>

  <div id="action-ledger" class="panel-block action-ledger-block">
    <div class="section-title split-title">
      <span>
        <Activity size={18} />
        <strong>Action Ledger</strong>
      </span>
      <button class="button compact" type="button" disabled={actionLedgerLoading} title={actionLedgerRefreshButtonTitle} on:click={refreshActionLedger}>
        <RefreshCw size={15} />
        <span>{actionLedgerLoading ? 'Loading' : 'Refresh'}</span>
      </button>
    </div>
    <p class="helper-text">
      Recent real actions from Mini Hub, AI OS, and Macro Lab. Reversible Mini Hub data, AI OS file snapshots, and Macro Lab file recovery artifacts can be restored from here.
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
                title={restoreActionTitle(action)}
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
      <p class="helper-text">Loading action ledger.</p>
    {:else if actionLedgerError}
      <p class="sync-error" title="Action Ledger diagnostic is compacted for display. Retry Refresh or check Feature Wiring.">{actionLedgerEmptyMessage()}</p>
    {:else}
      <p class="helper-text">{actionLedgerEmptyMessage()}</p>
    {/if}

    {#if actionLedgerMessage}
      <p class="endpoint-message">{actionLedgerMessage}</p>
    {/if}
    {#if actionLedgerSourceError}
      <p class="sync-error" title="Action Ledger source diagnostic is compacted for display. Retry Refresh or check Feature Wiring.">{visibleActionLedgerSourceError}</p>
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
        <input id="hub-api-url" bind:value={hubApiInput} disabled={endpointSaving} title={endpointInputTitle('Mini Hub API')} placeholder="http://192.168.1.25:8787" />
      </div>
      <div class="field">
        <label for="ai-os-url">AI OS API</label>
        <input id="ai-os-url" bind:value={aiOsInput} disabled={endpointSaving} title={endpointInputTitle('AI OS API')} placeholder="http://192.168.1.25:8791" />
      </div>
      <div class="field">
        <label for="macro-lab-url">Macro Lab API</label>
        <input id="macro-lab-url" bind:value={macroLabInput} disabled={endpointSaving} title={endpointInputTitle('Macro Lab API')} placeholder="http://192.168.1.25:8792" />
      </div>
      <div class="field">
        <label for="ollama-url">Ollama</label>
        <input id="ollama-url" bind:value={ollamaInput} disabled={endpointSaving} title={endpointInputTitle('Ollama')} placeholder="http://192.168.1.25:11434" />
      </div>
      <div class="field">
        <label for="bridge-token">Bridge token</label>
        <input
          id="bridge-token"
          type="password"
          bind:value={bridgeTokenInput}
          disabled={endpointSaving}
          autocomplete="off"
          title="Optional shared secret stored in this browser. If MINI_HUB_BRIDGE_TOKEN is set on local services, this token is required for service-backed Hub, AI OS, and Macro Lab calls."
          placeholder="Optional shared secret"
        />
      </div>
    </div>
    <div class="action-row">
      <button class="button primary" type="button" disabled={endpointSaving} title={endpointSaveButtonTitle} on:click={saveEndpoints}>
        <Save size={17} />
        <span>{endpointSaving ? 'Saving URLs' : 'Save Service URLs'}</span>
      </button>
      <button class="button" type="button" disabled={endpointSaving} title={endpointReloadButtonTitle} on:click={() => loadEndpointInputs(true)}>
        <Cloud size={17} />
        <span>Reload Values</span>
      </button>
    </div>
    {#if endpointMessage}
      <p class="endpoint-message">{endpointMessage}</p>
    {/if}
    {#if endpointError}
      <p class="sync-error" title="Desktop Services diagnostic is compacted for display. Save service URLs, then run Check Services.">{visibleEndpointError}</p>
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

  .connection-mode-panel,
  .machine-mode-panel,
  .machine-profile-panel {
    display: grid;
    gap: 10px;
    padding: 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface-muted);
  }

  .connection-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(175px, 1fr));
    gap: 6px;
  }

  .connection-grid div {
    display: grid;
    gap: 4px;
    min-width: 0;
    padding: 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface);
  }

  .connection-grid span,
  .connection-grid small {
    overflow: hidden;
    color: var(--muted);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .connection-grid span {
    font-size: 11px;
    font-weight: 800;
    text-transform: uppercase;
  }

  .connection-grid strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .endpoint-diagnostic-list {
    display: grid;
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
  }

  .endpoint-diagnostic-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 10px;
    align-items: start;
    padding: 9px;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }

  .endpoint-diagnostic-row:last-child {
    border-bottom: 0;
  }

  .endpoint-diagnostic-row div {
    display: grid;
    gap: 3px;
    min-width: 0;
  }

  .endpoint-diagnostic-row small,
  .endpoint-diagnostic-row em,
  .endpoint-diagnostic-row code {
    overflow: hidden;
    color: var(--muted);
    font-style: normal;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .endpoint-diagnostic-row code {
    color: var(--text);
  }

  .mode-pill {
    align-self: start;
    padding: 4px 8px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--surface);
    color: var(--muted);
  }

  .mode-pill.local-full-power,
  .mode-pill.private-remote {
    border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
    color: var(--accent);
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

  .mode-segment.compact {
    grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
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

  .advanced-mode-options {
    display: grid;
    gap: 8px;
  }

  .advanced-mode-options summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    min-height: 34px;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface);
    cursor: pointer;
  }

  .advanced-mode-options summary span {
    font-weight: 800;
  }

  .advanced-mode-options summary small {
    color: var(--muted);
  }

  .advanced-mode-options[open] summary {
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
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
  .feature-wiring-list,
  .capability-mini-list {
    display: grid;
  }

  .issue-strip,
  .service-list,
  .feature-wiring-list {
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
  }

  .issue-row,
  .service-row,
  .feature-wiring-row {
    border-bottom: 1px solid var(--border);
  }

  .issue-row:last-child,
  .service-row:last-child,
  .feature-wiring-row:last-child {
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

  .state-chip.ready {
    border-color: var(--success-border);
    color: var(--success-text);
    background: var(--success-bg);
  }

  .state-chip.checking,
  .state-chip.defaulted,
  .state-chip.unknown {
    border-color: var(--warning-border);
    color: var(--warning-text);
    background: var(--warning-bg);
  }

  .state-chip.offline,
  .state-chip.blocked,
  .state-chip.empty,
  .state-chip.misconfigured {
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

  .feature-wiring-panel {
    display: grid;
    gap: 10px;
  }

  .feature-wiring-row {
    display: grid;
    grid-template-columns: 104px minmax(0, 1.4fr) minmax(160px, 0.8fr) auto;
    gap: 10px;
    align-items: start;
    min-height: 72px;
    padding: 10px;
    background: var(--surface);
  }

  .feature-wiring-main,
  .feature-wiring-fix {
    display: grid;
    gap: 3px;
    min-width: 0;
  }

  .feature-wiring-main strong,
  .feature-wiring-main small,
  .feature-wiring-main span,
  .feature-wiring-main code,
  .feature-wiring-fix small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .feature-wiring-main small,
  .feature-wiring-main span,
  .feature-wiring-fix small {
    color: var(--muted);
  }

  .feature-wiring-main code {
    display: block;
    color: var(--code-text);
    background: var(--code-bg);
    border-radius: 4px;
    padding: 3px 5px;
    font-size: 11px;
  }

  .feature-wiring-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 6px;
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

  .persistence-block {
    display: grid;
    gap: 10px;
  }

  .persistence-summary {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
  }

  .persistence-summary div {
    display: grid;
    gap: 3px;
    min-width: 0;
    padding: 9px 10px;
    border-right: 1px solid var(--border);
    background: var(--surface-muted);
  }

  .persistence-summary div:last-child {
    border-right: 0;
  }

  .recovery-rules {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
  }

  .recovery-rules div {
    display: grid;
    gap: 3px;
    min-width: 0;
    min-height: 82px;
    padding: 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface-muted);
  }

  .recovery-rules span,
  .recovery-rules strong,
  .recovery-rules small,
  .persistence-summary span,
  .persistence-summary strong {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .recovery-rules span,
  .recovery-rules strong,
  .persistence-summary span,
  .persistence-summary strong {
    white-space: nowrap;
  }

  .recovery-rules small {
    color: var(--muted);
    font-size: 12px;
    line-height: 1.35;
    white-space: normal;
  }

  .recovery-rules span,
  .persistence-summary span {
    color: var(--muted);
    font-size: 12px;
    font-weight: 800;
  }

  .persistence-list {
    display: grid;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 6px;
  }

  .persistence-row {
    display: grid;
    grid-template-columns: 110px minmax(0, 1fr) 96px auto;
    gap: 10px;
    align-items: start;
    min-height: 78px;
    padding: 10px;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }

  .persistence-row:last-child {
    border-bottom: 0;
  }

  .persistence-main {
    display: grid;
    gap: 3px;
    min-width: 0;
  }

  .persistence-main strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .persistence-main small,
  .persistence-main span,
  .persistence-main em {
    overflow-wrap: anywhere;
    white-space: normal;
  }

  .persistence-main small,
  .persistence-main span,
  .persistence-main em {
    color: var(--muted);
    font-size: 12px;
    line-height: 1.35;
  }

  .persistence-main em {
    font-style: normal;
  }

  .owner-chip,
  .cross-device {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: fit-content;
    min-width: 78px;
    min-height: 23px;
    padding: 2px 7px;
    border: 1px solid var(--border);
    border-radius: 999px;
    color: var(--muted);
    background: var(--surface-muted);
    font-size: 11px;
    font-weight: 800;
  }

  .owner-chip.hub-api,
  .owner-chip.ai-os,
  .owner-chip.macro-lab,
  .owner-chip.passive-engine,
  .owner-chip.google {
    color: var(--text);
    background: var(--surface-soft);
  }

  .cross-device {
    justify-self: end;
  }

  .cross-device.yes {
    border-color: var(--success-border);
    color: var(--success-text);
    background: var(--success-bg);
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
  .ledger-status.queued,
  .ledger-status.paused {
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

  .passive-settings-panel {
    display: grid;
    gap: 12px;
    margin-bottom: 10px;
  }

  .passive-summary {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
  }

  .passive-summary div {
    display: grid;
    gap: 3px;
    min-width: 0;
    padding: 9px 10px;
    border-right: 1px solid var(--border);
    background: var(--surface-muted);
  }

  .passive-summary div:last-child {
    border-right: 0;
  }

  .passive-summary span,
  .passive-summary strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .passive-summary span {
    color: var(--muted);
    font-size: 12px;
    font-weight: 800;
  }

  .passive-backup-health {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 10px;
    align-items: center;
    min-height: 58px;
    padding: 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface-muted);
  }

  .passive-backup-health.warning {
    border-color: var(--warning-border);
    background: var(--warning-bg);
  }

  .passive-backup-health.error {
    border-color: var(--danger-border);
    background: var(--danger-bg);
  }

  .passive-backup-health span {
    display: grid;
    gap: 3px;
    min-width: 0;
  }

  .passive-backup-health small,
  .passive-backup-health em {
    color: var(--muted);
    font-size: 12px;
    font-style: normal;
    line-height: 1.35;
  }

  .passive-backup-health.error em {
    color: var(--danger-text);
  }

  .passive-control-grid,
  .passive-scope-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
  }

  .passive-family-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }

  .toggle-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 8px;
    align-items: start;
    min-height: 62px;
    padding: 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface-muted);
  }

  .family-toggle-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 8px;
    align-items: start;
    min-height: 76px;
    padding: 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface);
  }

  .toggle-row input {
    width: 16px;
    margin-top: 2px;
  }

  .family-toggle-row input {
    width: 16px;
    margin-top: 2px;
  }

  .toggle-row span {
    display: grid;
    gap: 3px;
    min-width: 0;
  }

  .family-toggle-row span {
    display: grid;
    gap: 3px;
    min-width: 0;
  }

  .toggle-row small {
    color: var(--muted);
    line-height: 1.35;
  }

  .family-toggle-row small,
  .family-toggle-row em {
    color: var(--muted);
    line-height: 1.35;
  }

  .family-toggle-row em {
    font-style: normal;
    font-size: 12px;
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

    .feature-wiring-row {
      grid-template-columns: 1fr;
    }

    .service-actions {
      justify-content: flex-start;
    }

    .feature-wiring-actions {
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

    .recovery-rules,
    .persistence-summary,
    .passive-summary,
    .passive-control-grid,
    .passive-family-grid,
    .passive-scope-grid {
      grid-template-columns: 1fr;
    }

    .persistence-row {
      grid-template-columns: 1fr;
    }

    .cross-device {
      justify-self: start;
    }

    .passive-backup-health {
      grid-template-columns: 1fr;
    }

    .persistence-summary div,
    .persistence-summary div:last-child,
    .passive-summary div,
    .passive-summary div:last-child {
      border-right: 0;
      border-bottom: 1px solid var(--border);
    }

    .persistence-summary div:last-child,
    .passive-summary div:last-child {
      border-bottom: 0;
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
