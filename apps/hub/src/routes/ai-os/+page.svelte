<script lang="ts">
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import {
    Activity,
    BrainCircuit,
    Cpu,
    Database,
    Eye,
    Film,
    HardDrive,
    Image,
    ListChecks,
    Mic,
    Music,
    Play,
    RefreshCw,
    Search,
    Square,
    ShieldCheck,
    ToggleLeft,
    ToggleRight,
    Volume2,
    WandSparkles,
    Wrench,
    Workflow,
    Zap
  } from 'lucide-svelte';
  import { hubHref } from '$lib/routes';
  import { localNetworkHint } from '$lib/service-config';
  import { compactServiceIssueIfRecognized } from '$lib/service-issues';
  import { clientData } from '$lib/client-data';
  import { aiActivityStateLabel, buildAiActivityItems } from '$lib/ai-activity';
  import { machineModeContext, machineModeFromPreferences } from '$lib/machine-mode';
  import {
    cancelAiJob,
    cleanupAiOs,
    createAiBackup,
    createAiJob,
    getAiOsApiUrl,
    getAiStatus,
    getAiUsage,
    getMachineProfile,
    ingestMemory,
    invokeMultimodal,
    applyDesignPatch,
    listBenchmarks,
    listDesignPatches,
    listGenerationAssets,
    listToolCalls,
    listAiJobs,
    proposeDesignPatch,
    queryMemory,
    revertDesignPatch,
    runAgent,
    runAutotune,
    runBackgroundUnit,
    runBenchmark,
    runCommand,
    runInference,
    restoreTestAiBackup,
    streamInference,
    toggleBackgroundUnit,
    verifyAiBackup,
    type AiBackgroundUnit,
    type AiBenchmarkRun,
    type AiDesignPatch,
    type AiGenerationAsset,
    type AiJobSnapshot,
    type AiMachineProfileSnapshot,
    type AiStatus,
    type AiToolCallEntry,
    type AiUsageEntry
  } from '$lib/ai-os-api';

  interface PlainCapability {
    id: string;
    label: string;
    detail: string;
    available: boolean;
    state: string;
  }

  type StartupState = 'ready' | 'degraded' | 'offline' | 'unknown' | 'checking';

  interface StartupCheck {
    id: string;
    label: string;
    state: StartupState;
    detail: string;
  }

  const commandExamples = [
    'Summarize my current AI OS status and tell me what is ready to use.',
    'Search memory for local AI notes and give me the useful bits.',
    'Add a 25 minute study session for linear algebra.',
    'List my available macros before running anything.'
  ];

  let status: AiStatus | null = null;
  let usage: AiUsageEntry[] = [];
  let jobs: AiJobSnapshot[] = [];
  let toolCalls: AiToolCallEntry[] = [];
  let generationAssets: AiGenerationAsset[] = [];
  let designPatches: AiDesignPatch[] = [];
  let benchmarkRuns: AiBenchmarkRun[] = [];
  let machineSnapshots: AiMachineProfileSnapshot[] = [];
  let loading = false;
  let actionError = '';
  let actionMessage = '';
  let foundationResult = '';
  let foundationBusy = false;
  let autotuneBusy = false;
  let autotuneResult = '';
  let startupRetryCount = 0;
  let warmupBusy = false;
  let jobCancelBusyId = '';
  let backgroundBusyId = '';

  let inferPrompt = 'Return one sentence confirming which provider handled this ad hoc capability test.';
  let inferProvider = '';
  let inferModel = '';
  let inferResult = '';
  let inferBusy = false;

  let jobPrimitive = 'map';
  let jobItems = 'alpha\nbeta\ngamma';
  let jobTemplate = 'Process this item as a placeholder capability test: {item}';
  let jobBusy = false;

  let memorySourceId = 'scratch-note';
  let memoryText = 'Vector spaces, eigenvectors, schedulers, and local-first AI infrastructure notes.';
  let memoryQuery = 'local AI vector search';
  let memoryResult = '';
  let memoryBusy = false;

  let agentObjective = 'Exercise the generic agent loop with one small plan and no product-specific assumptions.';
  let agentResult = '';
  let agentBusy = false;

  let commandObjective = 'Add a 25 minute study session for linear algebra.';
  let commandConfirm = false;
  let commandResult = '';
  let commandBusy = false;

  let designInstruction = 'Make the AI OS dashboard denser while preserving the current layout system.';
  let designTargets = 'apps/hub/src/routes/ai-os/+page.svelte';
  let designConfirm = false;
  let designResult = '';
  let designBusy = false;

  let multimodalKind = 'image';
  let multimodalProvider = '';
  let multimodalPrompt = 'A clean technical diagram of modular local AI infrastructure';
  let multimodalText = 'This is an ad hoc TTS test from the AI OS dashboard.';
  let imageBase64 = '';
  let audioBase64 = '';
  let videoBase64 = '';
  let multimodalResult = '';
  let multimodalPreview: { kind: 'image' | 'audio' | 'video'; src: string } | null = null;
  let multimodalBusy = false;

  let benchmarkKind = 'text';
  let benchmarkPrompt = 'Run a compact local benchmark and describe the AI stack capability in one paragraph.';
  let benchmarkResult = '';
  let benchmarkBusy = false;

  $: providers = status?.providers ?? [];
  $: availableProviders = providers.filter((provider) => provider.available);
  $: providerOptions = providers.map((provider) => provider.id);
  $: hardware = status?.hardware;
  $: machineProfile = status?.machine_profile;
  $: primaryGpu = hardware?.gpus?.[0];
  $: loadedModels = hardware?.loaded_models ?? [];
  $: capabilityGroups = groupCapabilities(status?.capabilities ?? []);
  $: plainCapabilities = buildPlainCapabilities(status);
  $: recentActivity = buildAiActivityItems(status, 8);
  $: autoRouteText = autoRouteSummary(status);
  $: mediaProviderOptions = multimodalProviderOptions(status);
  $: connectedLocalAiOsHref = localConnectedAiOsHref();
  $: currentMachineMode = machineModeFromPreferences($clientData.settings?.preferences);
  $: profilePressure = machineProfile?.autotune?.resource_pressure?.level ?? 'unknown';
  $: profileBestRoute = routeLabel(machineProfile?.autotune?.best_text_route ?? machineProfile?.benchmarks?.best_text_route);
  $: profileBestSpeed = routeSpeed(machineProfile?.autotune?.best_text_route ?? machineProfile?.benchmarks?.best_text_route);
  $: startupChecks = buildStartupChecks(status, actionError, loading);
  $: startupSummary = summarizeStartupChecks(startupChecks);
  $: aiOsReady = Boolean(status);
  $: aiOsActionBlocked = !aiOsReady;
  $: aiOsActionBlockedReason = aiOsServiceActionBlockedReason({
    loading,
    ready: aiOsReady,
    apiUrl: getAiOsApiUrl()
  });
  $: warmupBlockedReason = warmLocalModelBlockedReason({
    busy: warmupBusy,
    status,
    loadedCount: loadedModels.length,
    aiOsReason: aiOsActionBlockedReason
  });
  $: aiOsBlockedLabel = loading ? 'Checking AI OS' : 'Connect AI OS';
  $: linkedActivityKind = $page.url.searchParams.get('activity') ?? ($page.url.searchParams.get('job') ? 'job' : '');
  $: linkedActivityId = $page.url.searchParams.get('id') ?? $page.url.searchParams.get('job') ?? '';
  $: highlightedJobId = linkedActivityKind === 'job' ? linkedActivityId : '';
  $: highlightedToolId = linkedActivityKind === 'tool' ? linkedActivityId : '';
  $: highlightedBenchmarkId = linkedActivityKind === 'benchmark' ? linkedActivityId : '';
  $: highlightedBackupId = linkedActivityKind === 'backup' ? linkedActivityId : '';
  $: highlightedGenerationId = linkedActivityKind === 'generation' ? linkedActivityId : '';
  $: highlightedJobPresent = highlightedJobId ? jobs.some((job) => job.id === highlightedJobId) : true;
  $: highlightedToolPresent = highlightedToolId ? toolCalls.some((call) => call.id === highlightedToolId) : true;
  $: highlightedBenchmarkPresent = highlightedBenchmarkId ? benchmarkRuns.some((run) => run.id === highlightedBenchmarkId) : true;
  $: highlightedBackupPresent = highlightedBackupId ? (status?.backups ?? []).some((backup) => backup.id === highlightedBackupId) : true;
  $: highlightedGenerationPresent = highlightedGenerationId ? generationAssets.some((asset) => asset.id === highlightedGenerationId) : true;
  $: aiOsDefaultRefreshTitle = aiOsRefreshTitle(loading);
  $: aiOsStartupCheckTitle = aiOsRefreshTitle(loading, 'Check AI OS startup health now.');
  $: aiOsReconnectTitle = aiOsRefreshTitle(loading, 'Reconnect to the local AI OS service.');
  $: aiOsCommandRefreshTitle = aiOsRefreshTitle(loading, 'Refresh AI OS status before running command actions.');
  $: aiOsProfileRefreshTitle = aiOsRefreshTitle(loading, 'Refresh AI OS status and machine profile.');
  $: aiOsAdvancedCommandRefreshTitle = aiOsRefreshTitle(loading, 'Refresh AI OS status before using advanced command controls.');
  $: visibleActionError = actionError ? compactServiceIssueIfRecognized(actionError, 'AI OS') : '';

  function groupCapabilities(capabilities: NonNullable<AiStatus['capabilities']>): Array<{ kind: string; rows: typeof capabilities }> {
    const groups = new Map<string, typeof capabilities>();
    for (const capability of capabilities) {
      const rows = groups.get(capability.kind) ?? [];
      rows.push(capability);
      groups.set(capability.kind, rows);
    }
    return [...groups.entries()].map(([kind, rows]) => ({ kind, rows }));
  }

  function setError(error: unknown, fallback: string): void {
    actionError = error instanceof Error ? error.message : fallback;
    actionMessage = '';
  }

  function localConnectedAiOsHref(): string {
    const apiUrl = getAiOsApiUrl();
    const localHost = apiUrl.includes('localhost') ? 'localhost' : '127.0.0.1';
    return `http://${localHost}:5173/ai-os?aiOsUrl=${encodeURIComponent(apiUrl)}`;
  }

  function shouldOfferLocalHub(): boolean {
    if (typeof window === 'undefined') return false;
    return window.location.protocol === 'https:' && /^http:\/\/(?:127\.0\.0\.1|localhost)(?::|\/|$)/u.test(getAiOsApiUrl());
  }

  function stringify(value: unknown): string {
    return JSON.stringify(value, null, 2);
  }

  function modeMetadata(): Record<string, unknown> {
    return { machine_mode: machineModeContext(currentMachineMode.id) };
  }

  function requireAiOsReady(action: string): boolean {
    if (status) return true;
    actionError = `${action} needs the local AI OS service first. Refresh status or open Settings Feature Wiring to connect ${getAiOsApiUrl()}.`;
    actionMessage = '';
    return false;
  }

  function aiOsServiceActionBlockedReason(state: { loading: boolean; ready: boolean; apiUrl: string }): string {
    if (state.ready) return '';
    if (state.loading) return `AI OS status is still loading from ${state.apiUrl}.`;
    return `AI OS is offline or not connected at ${state.apiUrl}. Open Settings Feature Wiring or refresh status before using this control.`;
  }

  function aiOsRefreshTitle(isLoading: boolean, enabledTitle = 'Refresh AI OS status from the local service.'): string {
    return isLoading ? 'AI OS status refresh is already running.' : enabledTitle;
  }

  function aiOsActionTitle(enabledTitle: string, busy: boolean, busyTitle: string): string {
    if (aiOsActionBlockedReason) return aiOsActionBlockedReason;
    if (busy) return busyTitle;
    return enabledTitle;
  }

  function foundationActionTitle(enabledTitle: string, needsBackup = false): string {
    if (aiOsActionBlockedReason) return aiOsActionBlockedReason;
    if (foundationBusy) return 'A foundation health action is already running.';
    if (needsBackup && !status?.backups?.length) return 'Create a backup before using this action.';
    return enabledTitle;
  }

  function warmLocalModelBlockedReason(state: { busy: boolean; status: AiStatus | null; loadedCount: number; aiOsReason: string }): string {
    if (state.busy) return 'Local model warmup is already running.';
    if (!state.status) return state.aiOsReason;
    const ollama = providerById(state.status, 'ollama');
    if (!ollama?.available) return ollama?.error ?? 'Ollama is not available in the latest AI OS provider status.';
    if (state.loadedCount > 0) return 'A local model is already loaded.';
    return '';
  }

  function jobCancelBlockedReason(job: AiJobSnapshot): string {
    if (aiOsActionBlocked) return `Cancel needs the local AI OS service first. Refresh status or open Settings Feature Wiring to connect ${getAiOsApiUrl()}.`;
    if (job.status !== 'running' && job.status !== 'queued') return `Cannot cancel a ${job.status} job.`;
    if (jobCancelBusyId === job.id) return 'Cancellation is already running for this job.';
    if (jobCancelBusyId) return 'Another job cancellation is already running.';
    return '';
  }

  function jobCancelDisabled(job: AiJobSnapshot): boolean {
    return Boolean(jobCancelBlockedReason(job));
  }

  function backgroundActionKey(unit: AiBackgroundUnit, action: 'toggle' | 'run'): string {
    return `${unit.id}:${action}`;
  }

  function backgroundActionBlockedReason(unit: AiBackgroundUnit, action: 'toggle' | 'run'): string {
    const label = action === 'toggle' ? 'Toggle ambient unit' : 'Run ambient unit';
    const key = backgroundActionKey(unit, action);
    if (aiOsActionBlocked) return `${label} needs the local AI OS service first. Refresh status or open Settings Feature Wiring to connect ${getAiOsApiUrl()}.`;
    if (backgroundBusyId === key) return `${label} is already running.`;
    if (backgroundBusyId) return 'Another ambient unit action is already running.';
    return '';
  }

  function backgroundActionDisabled(unit: AiBackgroundUnit, action: 'toggle' | 'run'): boolean {
    return Boolean(backgroundActionBlockedReason(unit, action));
  }

  function redactMediaPayloads(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(redactMediaPayloads);
    if (!value || typeof value !== 'object') return value;
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (['image_base64', 'audio_base64', 'video_base64', 'b64_json'].includes(key) && typeof item === 'string') {
        next[key] = `[base64 ${item.length} chars]`;
      } else {
        next[key] = redactMediaPayloads(item);
      }
    }
    return next;
  }

  function multimodalProviderOptions(nextStatus: AiStatus | null): string[] {
    const adapters = (nextStatus?.capabilities ?? [])
      .filter((capability) => capability.kind === 'multimodal')
      .flatMap((capability) => capability.adapters);
    return [...new Set([...adapters, ...providerOptions])].filter(Boolean);
  }

  function mediaPreview(result: Record<string, unknown>, fallbackKind: string): { kind: 'image' | 'audio' | 'video'; src: string } | null {
    const contentType = typeof result.content_type === 'string' ? result.content_type : '';
    if (typeof result.image_base64 === 'string') {
      return { kind: 'image', src: `data:${contentType || 'image/png'};base64,${result.image_base64}` };
    }
    if (typeof result.audio_base64 === 'string') {
      return { kind: 'audio', src: `data:${contentType || 'audio/wav'};base64,${result.audio_base64}` };
    }
    if (typeof result.video_base64 === 'string') {
      if (contentType.startsWith('image/')) {
        return { kind: 'image', src: `data:${contentType};base64,${result.video_base64}` };
      }
      return { kind: 'video', src: `data:${contentType || 'video/mp4'};base64,${result.video_base64}` };
    }
    const data = Array.isArray(result.data) ? result.data : [];
    const b64Image = data.find((item) => item && typeof item === 'object' && typeof (item as { b64_json?: unknown }).b64_json === 'string') as
      | { b64_json: string }
      | undefined;
    if (b64Image) return { kind: 'image', src: `data:image/png;base64,${b64Image.b64_json}` };
    if (fallbackKind === 'video' && typeof result.output_path === 'string') return null;
    return null;
  }

  function numberLabel(value: number | undefined, suffix = ''): string {
    return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(1)}${suffix}` : 'not measured';
  }

  function aiOsMetricLabel(value: number | undefined, suffix = ''): string {
    if (loading && !status) return 'checking';
    if (!status) return 'Refresh needed';
    return numberLabel(value, suffix);
  }

  function aiOsCountLabel(value: number): string {
    if (loading && !status) return 'checking';
    if (!status) return 'Refresh needed';
    return String(value);
  }

  function aiOsRamDetail(): string {
    if (loading && !status) return 'Loading memory telemetry from AI OS.';
    if (!status) return 'Service status is shown above; memory telemetry has not been checked.';
    if (typeof hardware?.memory_used_gb !== 'number' || typeof hardware.memory_total_gb !== 'number') {
      return 'Memory telemetry not reported by AI OS.';
    }
    return `${hardware.memory_used_gb} / ${hardware.memory_total_gb} GB`;
  }

  function aiOsGpuDetail(gpu: Record<string, unknown> | undefined): string {
    if (loading && !status) return 'Loading GPU, VRAM, and temperature telemetry.';
    if (!status) return 'Service status is shown above; GPU telemetry has not been checked.';
    return `${gpuName(gpu)} - ${gpuMemoryLabel(gpu)} - ${gpuTemperatureLabel(gpu)}`;
  }

  function aiOsModelSummary(models: Array<Record<string, unknown>>): string {
    if (loading && !status) return 'Loading model residency from AI OS.';
    if (!status) return 'Service status is shown above; model load has not been checked.';
    return modelLoadSummary(models);
  }

  function noGpuRowsMessage(): string {
    if (loading && !status) return 'Loading GPU telemetry rows from AI OS.';
    if (!status) return 'Service status is shown above; GPU telemetry will appear after AI OS connects.';
    return 'No GPU telemetry rows returned yet. Refresh AI OS or check Windows/AMD telemetry setup.';
  }

  function aiOsPanelEmptyMessage(healthyEmpty: string, loadingMessage: string, subject = 'This panel'): string {
    if (loading && !status) return loadingMessage;
    if (!status) return `${subject} will reload after the Desktop service card reconnects.`;
    return healthyEmpty;
  }

  function machineProfileEmptyMessage(): string {
    if (loading && !status) return 'Checking machine profile, providers, and telemetry.';
    if (!status) return 'Machine profile will reload after the Desktop service card reconnects.';
    return 'Machine profile is unavailable even though AI OS is connected. Refresh profile or inspect Feature Wiring.';
  }

  function modelRowsEmptyMessage(): string {
    if (loading && !status) return 'Checking loaded Ollama models.';
    if (!status) return 'Model load will reload after the Desktop service card reconnects.';
    return 'No Ollama model is currently loaded.';
  }

  function metricValue(source: Record<string, unknown> | undefined, key: string): string {
    const value = source?.[key];
    if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2);
    if (typeof value === 'string') return value;
    if (value === null || value === undefined) return 'not reported';
    return stringify(value);
  }

  function metricNumber(source: Record<string, unknown> | undefined, key: string): number | undefined {
    const value = source?.[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  }

  function metricString(source: Record<string, unknown> | undefined, key: string): string | undefined {
    const value = source?.[key];
    return typeof value === 'string' && value.trim() ? value : undefined;
  }

  function gbFromMb(value: number | undefined): string {
    return typeof value === 'number' && Number.isFinite(value) ? `${(value / 1024).toFixed(1)} GB` : 'not reported';
  }

  function gpuName(gpu: Record<string, unknown> | undefined): string {
    return metricString(gpu, 'name') ?? 'GPU telemetry not reported';
  }

  function gpuMemoryLabel(gpu: Record<string, unknown> | undefined): string {
    const used = metricNumber(gpu, 'memory_used_mb');
    const total = metricNumber(gpu, 'memory_total_mb') ?? metricNumber(gpu, 'memory_reported_total_mb');
    if (used !== undefined && total !== undefined) return `${gbFromMb(used)} / ${gbFromMb(total)}`;
    if (used !== undefined) return `${gbFromMb(used)} used`;
    return 'VRAM not reported by AI OS';
  }

  function gpuTemperatureLabel(gpu: Record<string, unknown> | undefined): string {
    const value = metricNumber(gpu, 'temperature_c');
    if (value !== undefined) return `${value.toFixed(0)} C`;
    const source = metricString(gpu, 'temperature_source');
    return source === 'unavailable' ? 'temperature sensor unavailable' : 'temperature not reported by AI OS';
  }

  function routeLabel(route: Record<string, unknown> | null | undefined): string {
    if (!route) return 'No measured route';
    const provider = metricString(route, 'provider');
    const model = metricString(route, 'model');
    if (!provider) return 'No measured route';
    return model ? `${provider}/${model}` : provider;
  }

  function routeSpeed(route: Record<string, unknown> | null | undefined): string {
    const value = metricNumber(route ?? undefined, 'tokens_per_second');
    return value !== undefined ? `${value.toFixed(1)} tok/s` : 'not measured';
  }

  function modelName(model: Record<string, unknown>): string {
    return metricString(model, 'name') ?? metricString(model, 'model') ?? 'loaded model';
  }

  function modelLoadSummary(models: Array<Record<string, unknown>>): string {
    if (!models.length) return 'No model loaded';
    return models
      .map((model) => {
        const processor = metricString(model, 'processor');
        return `${modelName(model)}${processor ? ` - ${processor}` : ''}`;
      })
      .join(', ');
  }

  function modelDetail(model: Record<string, unknown>): string {
    const processor = metricString(model, 'processor') ?? 'processor unknown';
    const vram = metricNumber(model, 'vram_gb');
    const size = metricNumber(model, 'size_gb');
    const context = metricNumber(model, 'context_length');
    const pieces = [processor];
    if (vram !== undefined) pieces.push(`${vram.toFixed(1)} GB VRAM`);
    if (size !== undefined) pieces.push(`${size.toFixed(1)} GB model`);
    if (context !== undefined) pieces.push(`${context} ctx`);
    return pieces.join(' - ');
  }

  function providerById(nextStatus: AiStatus | null, id: string) {
    return nextStatus?.providers.find((provider) => provider.id === id);
  }

  function buildStartupChecks(nextStatus: AiStatus | null, error: string, checking: boolean): StartupCheck[] {
    if (!nextStatus && checking) {
      return [
        {
          id: 'service',
          label: 'AI OS service',
          state: 'checking',
          detail: `Checking ${getAiOsApiUrl()} for the local AI OS service.`
        },
        {
          id: 'ollama',
          label: 'Ollama provider',
          state: 'unknown',
          detail: 'Waiting for AI OS before checking Ollama.'
        },
        {
          id: 'gpu',
          label: 'GPU telemetry',
          state: 'unknown',
          detail: 'Waiting for AI OS before checking GPU counters.'
        },
        {
          id: 'model',
          label: 'Model load',
          state: 'unknown',
          detail: 'Waiting for AI OS before checking Ollama /api/ps.'
        }
      ];
    }

    if (!nextStatus) {
      const detail = error
        ? 'See the Desktop service card above for the connection error and fix actions.'
        : `AI OS has not answered at ${getAiOsApiUrl()} yet. Use Check Now or Settings Feature Wiring to reconnect.`;
      return [
        { id: 'service', label: 'AI OS service', state: 'offline', detail },
        { id: 'ollama', label: 'Ollama provider', state: 'unknown', detail: 'Provider state will reload after the Desktop service card reconnects.' },
        { id: 'gpu', label: 'GPU telemetry', state: 'unknown', detail: 'GPU telemetry will reload after the Desktop service card reconnects.' },
        { id: 'model', label: 'Model load', state: 'unknown', detail: 'Model load will reload after the Desktop service card reconnects.' }
      ];
    }

    const ollama = providerById(nextStatus, 'ollama');
    const gpus = nextStatus.hardware?.gpus ?? [];
    const models = nextStatus.hardware?.loaded_models ?? [];
    return [
      {
        id: 'service',
        label: 'AI OS service',
        state: 'ready',
        detail: `Connected at ${getAiOsApiUrl()}.`
      },
      {
        id: 'ollama',
        label: 'Ollama provider',
        state: ollama?.available ? 'ready' : 'degraded',
        detail: ollama?.available
          ? `${ollama.models.length} local model${ollama.models.length === 1 ? '' : 's'} visible.`
          : ollama?.error ?? 'AI OS is running, but Ollama did not answer the provider check.'
      },
      {
        id: 'gpu',
        label: 'GPU telemetry',
        state: gpus.length ? 'ready' : 'degraded',
        detail: gpus.length
          ? `${gpuName(gpus[0])} - ${gpuMemoryLabel(gpus[0])}.`
          : nextStatus.hardware?.error ?? 'AI OS is running, but no GPU telemetry rows were returned from Windows counters or vendor tools.'
      },
      {
        id: 'model',
        label: 'Model load',
        state: models.length ? 'ready' : 'unknown',
        detail: models.length
          ? modelLoadSummary(models)
          : 'No model is resident yet. That is normal after boot until a local prompt, benchmark, or autotune run loads one.'
      }
    ];
  }

  function summarizeStartupChecks(checks: StartupCheck[]): string {
    if (checks.some((check) => check.state === 'checking')) return 'Checking AI OS';
    if (checks.some((check) => check.state === 'offline')) return 'AI OS offline';
    if (checks.some((check) => check.state === 'degraded')) return 'Connected with setup items';
    if (checks.some((check) => check.state === 'unknown')) return 'Connected, waiting for first local run';
    return 'Connected';
  }

  function startupStateLabel(state: StartupState): string {
    if (state === 'ready') return 'Ready';
    if (state === 'degraded') return 'Needs attention';
    if (state === 'offline') return 'Offline';
    if (state === 'checking') return 'Checking';
    return 'Waiting for report';
  }

  function hasCapability(nextStatus: AiStatus | null, id: string): boolean {
    return Boolean(nextStatus?.capabilities.find((capability) => capability.id === id)?.available);
  }

  function buildPlainCapabilities(nextStatus: AiStatus | null): PlainCapability[] {
    const anyProvider = Boolean(nextStatus?.providers.some((provider) => provider.available));
    const anyTool = Boolean(nextStatus?.tools.length);
    return [
      {
        id: 'ask',
        label: 'Ask for help or answers',
        detail: 'Chat, summarize, rewrite, classify, reason, and stream answers.',
        available: anyProvider,
        state: anyProvider ? 'Ready' : 'Needs Ollama or an API'
      },
      {
        id: 'act',
        label: 'Use the app for you',
        detail: 'Search memory, check Hub status, add study sessions, add career jobs, and run macros with confirmation.',
        available: anyProvider && anyTool,
        state: anyProvider && anyTool ? 'Ready' : 'Needs AI OS service'
      },
      {
        id: 'memory',
        label: 'Search your local memory',
        detail: 'Ingest notes and retrieve related chunks for other AI tasks.',
        available: hasCapability(nextStatus, 'memory.embedding'),
        state: hasCapability(nextStatus, 'memory.embedding') ? 'Ready' : 'Needs embedding model'
      },
      {
        id: 'media',
        label: 'Generate images, audio, or video',
        detail: 'Create local gallery artifacts or use paid/specialist adapters when configured.',
        available:
          hasCapability(nextStatus, 'multimodal.image') ||
          hasCapability(nextStatus, 'multimodal.audio') ||
          hasCapability(nextStatus, 'multimodal.video'),
        state:
          hasCapability(nextStatus, 'multimodal.image') ||
          hasCapability(nextStatus, 'multimodal.audio') ||
          hasCapability(nextStatus, 'multimodal.video')
            ? 'Ready'
            : 'Needs media adapter'
      },
      {
        id: 'voice',
        label: 'Speak or transcribe',
        detail: 'Text-to-speech and speech-to-text can use Windows local speech, Piper, Whisper, or OpenAI audio.',
        available: hasCapability(nextStatus, 'multimodal.audio_tts') || hasCapability(nextStatus, 'multimodal.audio_stt'),
        state:
          hasCapability(nextStatus, 'multimodal.audio_tts') || hasCapability(nextStatus, 'multimodal.audio_stt')
            ? 'Ready'
            : 'Optional setup'
      },
      {
        id: 'measure',
        label: 'Test what this PC can do',
        detail: 'Run benchmarks while watching CPU, RAM, GPU, latency, and tokens/sec.',
        available: anyProvider,
        state: anyProvider ? 'Ready' : 'Needs a model'
      }
    ];
  }

  function autoRouteSummary(nextStatus: AiStatus | null): string {
    if (!nextStatus) return 'Auto mode will use the best reachable route, local first, as soon as status finishes loading.';
    const measuredRoute = routeLabel(nextStatus.machine_profile?.autotune?.best_text_route ?? nextStatus.machine_profile?.benchmarks?.best_text_route);
    const measuredSpeed = routeSpeed(nextStatus.machine_profile?.autotune?.best_text_route ?? nextStatus.machine_profile?.benchmarks?.best_text_route);
    if (measuredRoute !== 'No measured route') {
      return `Auto mode can use measured route ${measuredRoute}${measuredSpeed !== 'not measured' ? ` (${measuredSpeed})` : ''}, while keeping ${nextStatus.machine_profile?.autotune?.resource_pressure?.level ?? 'unknown'} pressure in view.`;
    }
    const available = nextStatus.providers.filter((provider) => provider.available);
    const local = available.filter((provider) => provider.local).map((provider) => provider.label);
    const paid = available.filter((provider) => provider.paid).map((provider) => provider.label);
    if (local.length) return `Auto mode will try local first: ${local.join(', ')}${paid.length ? `; paid fallback: ${paid.join(', ')}` : ''}.`;
    if (paid.length) return `No local provider is reachable, so auto mode can use paid fallback: ${paid.join(', ')}.`;
    return 'No model provider is reachable yet.';
  }

  function useCommandExample(example: string): void {
    commandObjective = example;
  }

  function commandExampleTitle(example: string): string {
    return commandObjective === example ? 'This example is already loaded in the request box.' : 'Load this example into the AI OS request box.';
  }

  function toolLabel(toolId: string): string {
    return status?.tools.find((tool) => tool.id === toolId)?.label ?? toolId;
  }

  function summarizeCommandResult(value: Record<string, unknown>): string {
    const result = value.result && typeof value.result === 'object' ? (value.result as Record<string, unknown>) : {};
    const statusText = typeof result.status === 'string' ? result.status.replace(/_/gu, ' ') : 'finished';
    const output = typeof result.output === 'string' && result.output.trim() ? result.output.trim() : '';
    const calls = Array.isArray(value.tool_calls) ? value.tool_calls : [];
    const lines = [`Status: ${statusText}`];
    if (output) lines.push('', output);
    if (calls.length) lines.push('', `Actions used: ${calls.length}`);
    if (!output && !calls.length) lines.push('', 'No app action was needed.');
    return lines.join('\n');
  }

  function summarizeMediaResult(result: Record<string, unknown>, kind: string): string {
    const provider = typeof result.provider === 'string' ? result.provider : multimodalProvider || 'auto';
    const model = typeof result.model === 'string' ? result.model : '';
    const contentType = typeof result.content_type === 'string' ? result.content_type : '';
    const asset = result.asset && typeof result.asset === 'object' ? (result.asset as Record<string, unknown>) : {};
    const lines = [`Created ${kind.replace('audio_', '').replace('_', ' ')} with ${provider}${model ? ` (${model})` : ''}.`];
    if (contentType) lines.push(`Format: ${contentType}.`);
    if (typeof asset.id === 'string') lines.push('Saved to the local generation gallery.');
    return lines.join('\n');
  }

  function activityWhen(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString();
  }

  async function refresh(): Promise<void> {
    loading = true;
    actionError = '';
    try {
      const [nextStatus, nextUsage, nextToolCalls, nextAssets, nextPatches, nextBenchmarks, nextProfile] = await Promise.all([
        getAiStatus(currentMachineMode.id),
        getAiUsage(30),
        listToolCalls(30),
        listGenerationAssets(24),
        listDesignPatches(12),
        listBenchmarks(12),
        getMachineProfile(currentMachineMode.id, 5).catch(() => null)
      ]);
      status = nextProfile ? { ...nextStatus, machine_profile: nextProfile.profile } : nextStatus;
      usage = nextUsage;
      toolCalls = nextToolCalls;
      generationAssets = nextAssets;
      designPatches = nextPatches;
      benchmarkRuns = nextBenchmarks;
      machineSnapshots = nextProfile?.snapshots ?? machineSnapshots;
      jobs = status.jobs;
      actionMessage = 'AI OS status refreshed.';
    } catch (error) {
      setError(error, 'Failed to load AI OS status.');
    } finally {
      loading = false;
    }
  }

  async function warmLocalModel(): Promise<void> {
    warmupBusy = true;
    actionError = '';
    try {
      await runInference({
        prompt: 'Mini Hub local model warmup. Reply OK.',
        provider: 'ollama',
        task_type: 'startup.warmup',
        max_tokens: 8,
        allow_fallback: false,
        local_first: true,
        metadata: modeMetadata()
      });
      actionMessage = 'Local Ollama model warmed; GPU/model telemetry refreshed.';
      await refresh();
    } catch (error) {
      setError(error, 'Model warmup failed.');
    } finally {
      warmupBusy = false;
    }
  }

  async function refreshJobs(): Promise<void> {
    if (!requireAiOsReady('Job refresh')) return;
    try {
      jobs = await listAiJobs();
    } catch (error) {
      setError(error, 'Failed to refresh jobs.');
    }
  }

  async function runAdHocInference(stream = false): Promise<void> {
    if (!requireAiOsReady('Inference')) return;
    inferBusy = true;
    actionError = '';
    inferResult = stream ? '' : 'Running';
    try {
      if (stream) {
        await streamInference(
          {
            prompt: inferPrompt,
            provider: inferProvider || undefined,
            model: inferModel || undefined,
            task_type: 'dashboard.stream',
            metadata: modeMetadata()
          },
          (event, data) => {
            if (event === 'error') {
              inferResult += `\n${stringify(data)}`;
              return;
            }
            const text = typeof data.text === 'string' ? data.text : '';
            if (text) inferResult += text;
          }
        );
      } else {
        const result = await runInference({
          prompt: inferPrompt,
          provider: inferProvider || undefined,
          model: inferModel || undefined,
          task_type: 'dashboard.ad_hoc',
          metadata: modeMetadata()
        });
        inferResult = stringify(result);
      }
      usage = await getAiUsage(30);
    } catch (error) {
      setError(error, 'Inference failed.');
    } finally {
      inferBusy = false;
    }
  }

  async function createBackupNow(): Promise<void> {
    if (!requireAiOsReady('Backup')) return;
    foundationBusy = true;
    actionError = '';
    try {
      foundationResult = stringify(await createAiBackup('dashboard'));
      await refresh();
    } catch (error) {
      setError(error, 'Backup failed.');
    } finally {
      foundationBusy = false;
    }
  }

  async function verifyLatestBackup(): Promise<void> {
    if (!requireAiOsReady('Backup verification')) return;
    const latest = status?.backups?.[0];
    if (!latest) return;
    foundationBusy = true;
    actionError = '';
    try {
      foundationResult = stringify(await verifyAiBackup(latest.id));
      await refresh();
    } catch (error) {
      setError(error, 'Backup verification failed.');
    } finally {
      foundationBusy = false;
    }
  }

  async function restoreTestLatestBackup(): Promise<void> {
    if (!requireAiOsReady('Restore test')) return;
    const latest = status?.backups?.[0];
    if (!latest) return;
    foundationBusy = true;
    actionError = '';
    try {
      foundationResult = stringify(await restoreTestAiBackup(latest.id));
      await refresh();
    } catch (error) {
      setError(error, 'Restore test failed.');
    } finally {
      foundationBusy = false;
    }
  }

  async function cleanupSystem(): Promise<void> {
    if (!requireAiOsReady('Cleanup')) return;
    foundationBusy = true;
    actionError = '';
    try {
      foundationResult = stringify(await cleanupAiOs());
      await refresh();
    } catch (error) {
      setError(error, 'Cleanup failed.');
    } finally {
      foundationBusy = false;
    }
  }

  async function startJob(): Promise<void> {
    if (!requireAiOsReady('Job queueing')) return;
    jobBusy = true;
    actionError = '';
    try {
      const request = {
        prompt: inferPrompt,
        provider: inferProvider || undefined,
        model: inferModel || undefined,
        task_type: `dashboard.job.${jobPrimitive}`,
        allow_fallback: true,
        local_first: true,
        metadata: modeMetadata()
      };
      const payload: Record<string, unknown> = { primitive: jobPrimitive, request, metadata: modeMetadata() };
      if (jobPrimitive === 'map') {
        payload.items = jobItems.split('\n').map((item) => item.trim()).filter(Boolean);
        payload.template = jobTemplate;
      } else if (jobPrimitive === 'self_consistency') {
        payload.n = 3;
      } else if (jobPrimitive === 'chunk_summarize') {
        payload.text = memoryText;
      } else if (jobPrimitive === 'retry_loop') {
        payload.max_retries = 3;
      }
      const job = await createAiJob(payload);
      actionMessage = `Job ${job.id} queued.`;
      await refreshJobs();
    } catch (error) {
      setError(error, 'Failed to start job.');
    } finally {
      jobBusy = false;
    }
  }

  async function cancelJob(job: AiJobSnapshot): Promise<void> {
    if (!requireAiOsReady('Job cancellation')) return;
    const blocked = jobCancelBlockedReason(job);
    if (blocked) {
      actionError = blocked;
      return;
    }
    if (!window.confirm(`Cancel AI OS job "${job.id}"? Partial results and Activity records remain recoverable when the service has saved them.`)) {
      actionMessage = 'AI OS job cancellation skipped.';
      return;
    }
    jobCancelBusyId = job.id;
    actionError = '';
    try {
      await cancelAiJob(job.id);
      await refreshJobs();
    } catch (error) {
      setError(error, 'Failed to cancel job.');
    } finally {
      jobCancelBusyId = '';
    }
  }

  async function ingestScratchMemory(): Promise<void> {
    if (!requireAiOsReady('Memory ingest')) return;
    memoryBusy = true;
    actionError = '';
    try {
      const result = await ingestMemory({
        source_type: 'dashboard',
        source_id: memorySourceId,
        title: memorySourceId,
        text: memoryText
      });
      memoryResult = stringify(result);
    } catch (error) {
      setError(error, 'Memory ingest failed.');
    } finally {
      memoryBusy = false;
    }
  }

  async function searchMemory(): Promise<void> {
    if (!requireAiOsReady('Memory search')) return;
    memoryBusy = true;
    actionError = '';
    try {
      const hits = await queryMemory({ query: memoryQuery, limit: 6 });
      memoryResult = stringify(hits);
    } catch (error) {
      setError(error, 'Memory query failed.');
    } finally {
      memoryBusy = false;
    }
  }

  async function runGenericAgent(): Promise<void> {
    if (!requireAiOsReady('Agent loop')) return;
    agentBusy = true;
    actionError = '';
    try {
      const result = await runAgent({
        objective: agentObjective,
        provider: inferProvider || undefined,
        model: inferModel || undefined,
        max_steps: 3,
        tools: ['memory.search'],
        context: { source: 'ai-os-dashboard', ...modeMetadata() }
      });
      agentResult = stringify(result);
    } catch (error) {
      setError(error, 'Agent run failed.');
    } finally {
      agentBusy = false;
    }
  }

  async function runCommandBar(): Promise<void> {
    if (!requireAiOsReady('Command bar')) return;
    commandBusy = true;
    actionError = '';
    try {
      const result = await runCommand({
        objective: commandObjective,
        confirm_actions: commandConfirm,
        provider: inferProvider || undefined,
        model: inferModel || undefined,
        max_steps: 4,
        context: { source: 'ai-os-dashboard', ...modeMetadata() }
      });
      commandResult = summarizeCommandResult(result);
      toolCalls = await listToolCalls(30);
    } catch (error) {
      setError(error, 'Command failed.');
    } finally {
      commandBusy = false;
    }
  }

  async function proposePatch(): Promise<void> {
    if (!requireAiOsReady('Design patch proposal')) return;
    designBusy = true;
    actionError = '';
    try {
      const patch = await proposeDesignPatch({
        instruction: designInstruction,
        target_files: designTargets
          .split('\n')
          .map((item) => item.trim())
          .filter(Boolean),
        provider: inferProvider || undefined,
        model: inferModel || undefined
      });
      designPatches = [patch, ...designPatches.filter((item) => item.id !== patch.id)].slice(0, 12);
      designResult = patch.patch;
    } catch (error) {
      setError(error, 'Design patch proposal failed.');
    } finally {
      designBusy = false;
    }
  }

  async function applyPatchRecord(patch: AiDesignPatch): Promise<void> {
    if (!requireAiOsReady('Design patch apply')) return;
    designBusy = true;
    actionError = '';
    try {
      const updated = await applyDesignPatch(patch.id, designConfirm);
      designPatches = designPatches.map((item) => (item.id === updated.id ? updated : item));
      designResult = stringify(updated);
    } catch (error) {
      setError(error, 'Design patch apply failed.');
    } finally {
      designBusy = false;
    }
  }

  async function revertPatchRecord(patch: AiDesignPatch): Promise<void> {
    if (!requireAiOsReady('Design patch revert')) return;
    designBusy = true;
    actionError = '';
    try {
      const updated = await revertDesignPatch(patch.id, designConfirm);
      designPatches = designPatches.map((item) => (item.id === updated.id ? updated : item));
      designResult = stringify(updated);
    } catch (error) {
      setError(error, 'Design patch revert failed.');
    } finally {
      designBusy = false;
    }
  }

  async function invokeMedia(): Promise<void> {
    if (!requireAiOsReady('Media generation')) return;
    multimodalBusy = true;
    actionError = '';
    try {
      const result = await invokeMultimodal(multimodalKind, {
        provider: multimodalProvider || undefined,
        model: inferModel || undefined,
        prompt: multimodalPrompt,
        text: multimodalText,
        image_base64: imageBase64 || undefined,
        audio_base64: audioBase64 || undefined,
        video_base64: videoBase64 || undefined,
        options: modeMetadata()
      });
      multimodalPreview = mediaPreview(result, multimodalKind);
      multimodalResult = summarizeMediaResult(redactMediaPayloads(result) as Record<string, unknown>, multimodalKind);
      generationAssets = await listGenerationAssets(24);
    } catch (error) {
      setError(error, 'Multimodal invocation failed.');
    } finally {
      multimodalBusy = false;
    }
  }

  async function runCapabilityBenchmark(): Promise<void> {
    if (!requireAiOsReady('Benchmark')) return;
    benchmarkBusy = true;
    actionError = '';
    try {
      const run = await runBenchmark({
        kind: benchmarkKind,
        prompt: benchmarkPrompt,
        provider: inferProvider || undefined,
        model: inferModel || undefined,
        local_first: true,
        metadata: modeMetadata()
      });
      benchmarkRuns = [run, ...benchmarkRuns.filter((item) => item.id !== run.id)].slice(0, 12);
      benchmarkResult = stringify(run);
      await refresh();
    } catch (error) {
      setError(error, 'Benchmark failed.');
    } finally {
      benchmarkBusy = false;
    }
  }

  async function runMachineAutotune(): Promise<void> {
    if (!requireAiOsReady('Autotune')) return;
    autotuneBusy = true;
    actionError = '';
    autotuneResult = 'Running autotune probe.';
    try {
      const result = await runAutotune({
        mode: currentMachineMode.id,
        provider: inferProvider || undefined,
        model: inferModel || undefined
      });
      status = status ? { ...status, machine_profile: result.profile } : status;
      if (result.snapshot) machineSnapshots = [result.snapshot, ...machineSnapshots.filter((item) => item.id !== result.snapshot?.id)].slice(0, 5);
      if (result.benchmark) {
        benchmarkRuns = [result.benchmark, ...benchmarkRuns.filter((item) => item.id !== result.benchmark?.id)].slice(0, 12);
      }
      const speed = typeof result.benchmark?.tokens_per_second === 'number' ? ` at ${result.benchmark.tokens_per_second.toFixed(1)} tok/s` : '';
      autotuneResult = result.ok
        ? `Autotune measured ${result.benchmark?.provider ?? 'auto'}${speed}. Suggested concurrency: ${result.profile.autotune.suggested_max_job_concurrency ?? 'not measured'}.`
        : `Autotune could not complete: ${result.error ?? 'provider unavailable'}`;
      await refresh();
    } catch (error) {
      setError(error, 'Autotune failed.');
    } finally {
      autotuneBusy = false;
    }
  }

  async function toggleUnit(unit: AiBackgroundUnit): Promise<void> {
    if (!requireAiOsReady('Ambient unit toggle')) return;
    const blocked = backgroundActionBlockedReason(unit, 'toggle');
    if (blocked) {
      actionError = blocked;
      return;
    }
    backgroundBusyId = backgroundActionKey(unit, 'toggle');
    actionError = '';
    try {
      await toggleBackgroundUnit(unit.id, !unit.enabled);
      await refresh();
    } catch (error) {
      setError(error, 'Failed to toggle background unit.');
    } finally {
      backgroundBusyId = '';
    }
  }

  async function runUnit(unit: AiBackgroundUnit): Promise<void> {
    if (!requireAiOsReady('Ambient unit run')) return;
    const blocked = backgroundActionBlockedReason(unit, 'run');
    if (blocked) {
      actionError = blocked;
      return;
    }
    backgroundBusyId = backgroundActionKey(unit, 'run');
    actionError = '';
    try {
      await runBackgroundUnit(unit.id);
      await refresh();
    } catch (error) {
      setError(error, 'Failed to run background unit.');
    } finally {
      backgroundBusyId = '';
    }
  }

  onMount(() => {
    void clientData.init();
    void refresh();
    const retry = window.setInterval(() => {
      startupRetryCount += 1;
      if (startupRetryCount > 20 || status) {
        window.clearInterval(retry);
        return;
      }
      if (!loading) void refresh();
    }, 3000);
    return () => window.clearInterval(retry);
  });
</script>

<svelte:head>
  <title>AI OS - Mini Hub</title>
</svelte:head>

<section class="page-header">
  <div>
    <p class="eyebrow">Personal AI OS</p>
    <h1>Ask AI OS</h1>
  </div>
  <button class="button" type="button" disabled={loading} title={aiOsDefaultRefreshTitle} on:click={refresh}>
    <RefreshCw size={17} />
    <span>{loading ? 'Refreshing' : 'Refresh'}</span>
  </button>
</section>

{#if actionError}
  <section class="card card-pad error-banner" title={`Raw AI OS error: ${actionError}`}>{visibleActionError}</section>
  <section class="card card-pad connection-card service-card">
    <div>
      <strong>Desktop service</strong>
      <span>{getAiOsApiUrl()}</span>
      <p>{localNetworkHint()}</p>
    </div>
    <div class="connection-actions">
      {#if shouldOfferLocalHub()}
        <a class="button primary" href={connectedLocalAiOsHref} title="Open the configured local AI OS service health endpoint in a new tab.">Open connected local AI OS</a>
      {/if}
      <a class="button" href={hubHref('/settings#feature-wiring')} title="Open Settings Feature Wiring for AI OS endpoint setup.">Open Settings</a>
    </div>
  </section>
{:else if actionMessage}
  <section class="card card-pad success-banner">{actionMessage}</section>
{/if}

<section class="card card-pad startup-card">
  <div class="startup-heading">
    <div>
      <strong>Local AI Startup</strong>
      <span>{startupSummary}</span>
    </div>
    <button class="button" type="button" disabled={loading} title={aiOsStartupCheckTitle} on:click={refresh}>
      <RefreshCw size={17} />
      <span>{loading ? 'Checking' : 'Check Now'}</span>
    </button>
  </div>
  <div class="startup-grid">
    {#each startupChecks as check}
      <article class={`startup-check ${check.state}`}>
        <div>
          <strong>{check.label}</strong>
          <span>{startupStateLabel(check.state)}</span>
        </div>
        <p>{check.detail}</p>
      </article>
    {/each}
  </div>
  <div class="action-row tight startup-actions">
    <button class="button" type="button" disabled={loading} title={aiOsReconnectTitle} on:click={refresh}>
      <RefreshCw size={17} />
      <span>Reconnect</span>
    </button>
    <button class="button primary" type="button" disabled={Boolean(warmupBlockedReason)} title={warmupBlockedReason || 'Warm a local Ollama model once.'} on:click={warmLocalModel}>
      <Zap size={17} />
      <span>{warmupBusy ? 'Warming' : 'Warm Model'}</span>
    </button>
  </div>
  <p class="startup-note">
    The local supervisor starts AI OS after Windows sign-in and warms Ollama once. If this page opens first, it retries for about a minute before giving up.
  </p>
</section>

<section class="card card-pad plain-guide">
  <div>
    <strong>Say what you want</strong>
    <p>Ask in normal language. AI OS chooses the strongest reachable route for the request, prioritizing local models before paid APIs.</p>
  </div>
  <div>
    <strong>It can use the app</strong>
    <p>It can read status, search memory, add study or career records, and run macros. Anything that changes data or controls Windows asks first.</p>
  </div>
  <div>
    <strong>Power controls stay here</strong>
    <p>The labs, benchmarks, provider logs, backups, and raw tools are still available below when you want to inspect the machinery.</p>
  </div>
</section>

<section class="card card-pad command-hero">
  <div class="section-title">
    <Zap size={18} />
    <strong>What should it do?</strong>
  </div>
  <p class="auto-route-note">{autoRouteText}</p>
  <div class="field">
    <label for="command-objective-primary">Request</label>
    <textarea id="command-objective-primary" bind:value={commandObjective} rows="4" title="Describe the AI OS command to plan and run. Write/system actions still require confirmation."></textarea>
  </div>
  <div class="example-row" aria-label="Example AI OS requests">
    {#each commandExamples as example}
      <button class="chip-button" type="button" title={commandExampleTitle(example)} on:click={() => useCommandExample(example)}>{example}</button>
    {/each}
  </div>
  <label class="checkline" for="command-confirm-primary">
    <input id="command-confirm-primary" type="checkbox" bind:checked={commandConfirm} title="Allow AI OS to request confirmed write/system tool calls for this command." />
    <span>Allow confirmed write/system actions for this run</span>
  </label>
  <div class="action-row">
    <button class="button primary" type="button" disabled={commandBusy || aiOsActionBlocked} title={aiOsActionBlockedReason || (commandBusy ? 'AI OS command is already running.' : 'Run this AI OS command.')} on:click={runCommandBar}>
      <Play size={17} />
      <span>{aiOsActionBlocked ? aiOsBlockedLabel : commandBusy ? 'Working' : 'Do it'}</span>
    </button>
    <button class="button" type="button" disabled={loading} title={aiOsCommandRefreshTitle} on:click={refresh}>
      <RefreshCw size={17} />
      <span>{loading ? 'Refreshing' : 'Refresh status'}</span>
    </button>
  </div>
  {#if commandResult}
    <pre class="friendly-result">{commandResult}</pre>
  {/if}
</section>

<section class="metric-grid">
  <article class="card card-pad metric">
    <Cpu size={19} />
    <span>CPU</span>
    <strong>{aiOsMetricLabel(hardware?.cpu_percent, '%')}</strong>
  </article>
  <article class="card card-pad metric">
    <Activity size={19} />
    <span>RAM</span>
    <strong>{aiOsMetricLabel(hardware?.memory_percent, '%')}</strong>
    <small>{aiOsRamDetail()}</small>
  </article>
  <article class="card card-pad metric">
    <HardDrive size={19} />
    <span>GPU</span>
    <strong>{aiOsMetricLabel(metricNumber(primaryGpu, 'utilization_percent'), '%')}</strong>
    <small>{aiOsGpuDetail(primaryGpu)}</small>
  </article>
  <article class="card card-pad metric">
    <BrainCircuit size={19} />
    <span>Model Load</span>
    <strong>{aiOsCountLabel(loadedModels.length)}</strong>
    <small>{aiOsModelSummary(loadedModels)}</small>
  </article>
  <article class="card card-pad metric">
    <Zap size={19} />
    <span>Tokens/sec</span>
    <strong>{aiOsMetricLabel(hardware?.recent_tokens_per_second)}</strong>
  </article>
  <article class="card card-pad metric">
    <BrainCircuit size={19} />
    <span>Reachable</span>
    <strong>{status ? `${availableProviders.length}/${providers.length}` : aiOsCountLabel(availableProviders.length)}</strong>
  </article>
</section>

<section class="card card-pad machine-profile-card">
  <div class="section-title">
    <Cpu size={18} />
    <strong>Machine Profile + Autotune</strong>
  </div>
  {#if machineProfile}
    <div class="profile-grid">
      <div>
        <span>Mode</span>
        <strong>{currentMachineMode.label}</strong>
        <small>{machineProfile.autotune.confidence ?? 'limited'} confidence</small>
      </div>
      <div>
        <span>Pressure</span>
        <strong>{profilePressure}</strong>
        <small>{machineProfile.autotune.resource_pressure?.drivers?.join(', ') || 'no pressure driver'}</small>
      </div>
      <div>
        <span>Best text route</span>
        <strong>{profileBestRoute}</strong>
        <small>{profileBestSpeed}</small>
      </div>
      <div>
        <span>Suggested concurrency</span>
        <strong>{machineProfile.autotune.suggested_max_job_concurrency ?? 'not measured'}</strong>
        <small>{machineProfile.benchmarks.text_samples ?? 0} text samples</small>
      </div>
      <div>
        <span>OS</span>
        <strong>{machineProfile.host.system ?? 'Unknown'} {machineProfile.host.release ?? ''}</strong>
        <small>{machineProfile.host.machine ?? 'machine type not reported'}</small>
      </div>
      <div>
        <span>Snapshots</span>
        <strong>{machineSnapshots.length}</strong>
        <small>{machineSnapshots[0]?.created_at ? new Date(machineSnapshots[0].created_at).toLocaleString() : 'none saved'}</small>
      </div>
    </div>
    {#if machineProfile.autotune.routing_notes?.length}
      <p class="auto-route-note">{machineProfile.autotune.routing_notes.join(' ')}</p>
    {/if}
  {:else}
    <p class="muted">{machineProfileEmptyMessage()}</p>
  {/if}
  <div class="action-row">
    <button class="button primary" type="button" disabled={autotuneBusy || aiOsActionBlocked} title={aiOsActionBlockedReason || (autotuneBusy ? 'Autotune is already running.' : 'Run a compact AI OS autotune probe.')} on:click={runMachineAutotune}>
      <Zap size={17} />
      <span>{aiOsActionBlocked ? aiOsBlockedLabel : autotuneBusy ? 'Running' : 'Run Autotune'}</span>
    </button>
    <button class="button" type="button" disabled={loading} title={aiOsProfileRefreshTitle} on:click={refresh}>
      <RefreshCw size={17} />
      <span>{loading ? 'Refreshing' : 'Refresh Profile'}</span>
    </button>
  </div>
  {#if autotuneResult}
    <pre class="friendly-result">{autotuneResult}</pre>
  {/if}
</section>

<section class="capability-showcase" aria-label="AI OS things you can do">
  {#each plainCapabilities as capability}
    <article class:ready={capability.available} class="card card-pad capability-card">
      <div>
        <strong>{capability.label}</strong>
        <span>{capability.state}</span>
      </div>
      <p>{capability.detail}</p>
    </article>
  {/each}
</section>

<details class="card card-pad advanced-status">
  <summary>
    <span>Advanced details</span>
    <small>Providers, adapters, app actions, and recent tool calls</small>
  </summary>
  <div class="advanced-grid">
    <div class="providers-panel">
      <div class="section-title">
        <Cpu size={18} />
        <strong>Model Routes</strong>
      </div>
      <div class="provider-list">
        {#each providers as provider}
          <article class:offline={!provider.available} class="provider-row">
            <div>
              <strong>{provider.label}</strong>
              <span>{provider.local ? 'local' : provider.paid ? 'paid' : 'adapter'}</span>
            </div>
            <p>{provider.available ? `${provider.models.length} models` : provider.error}</p>
          </article>
        {:else}
          <p class="muted">{aiOsPanelEmptyMessage('No model routes are registered yet.', 'Checking model routes from AI OS.', 'Model routes')}</p>
        {/each}
      </div>
    </div>

    <div class="gpu-panel">
      <div class="section-title">
        <HardDrive size={18} />
        <strong>GPU and Model Load</strong>
      </div>
      <div class="gpu-list">
        {#each hardware?.gpus ?? [] as gpu}
          <article class="gpu-row">
            <div>
              <strong>{gpuName(gpu)}</strong>
              <span>{metricString(gpu, 'vendor') ?? metricString(gpu, 'source') ?? 'gpu'}</span>
            </div>
            <small>{numberLabel(metricNumber(gpu, 'utilization_percent'), '%')} - {gpuMemoryLabel(gpu)} - {gpuTemperatureLabel(gpu)}</small>
          </article>
        {:else}
          <p class="muted">{noGpuRowsMessage()}</p>
        {/each}
        {#each loadedModels as model}
          <article class="model-row">
            <div>
              <strong>{modelName(model)}</strong>
              <span>{metricString(model, 'processor') ?? 'loaded'}</span>
            </div>
            <small>{modelDetail(model)}</small>
          </article>
        {:else}
          <p class="muted">{modelRowsEmptyMessage()}</p>
        {/each}
      </div>
    </div>

    <div class="capability-panel">
      <div class="section-title">
        <ListChecks size={18} />
        <strong>Detailed Capabilities</strong>
      </div>
      <div class="capability-groups">
        {#each capabilityGroups as group}
          <div class="capability-group">
            <span>{group.kind}</span>
            {#each group.rows as capability}
              <div class:off={!capability.available} class="capability-row">
                <strong>{capability.label}</strong>
                <small>{capability.available ? capability.adapters.join(', ') || capability.safety : 'needs setup'}</small>
              </div>
            {/each}
          </div>
        {/each}
      </div>
    </div>

    <div>
      <div class="section-title">
        <Wrench size={18} />
        <strong>App Actions</strong>
      </div>
      <div class="tool-list">
        {#each status?.tools ?? [] as tool}
          <article class:armed={tool.requires_confirmation} class="tool-row">
            <div>
              <strong>{tool.label}</strong>
              <span>{tool.requires_confirmation ? 'asks first' : tool.safety}</span>
            </div>
            <small>{tool.description}</small>
          </article>
        {:else}
          <p class="muted">{aiOsPanelEmptyMessage('No tools registered.', 'Checking app tools from AI OS.', 'App tools')}</p>
        {/each}
      </div>
    </div>

    <div>
      <div class="section-title">
        <Activity size={18} />
        <strong>Recent Actions</strong>
      </div>
      <div class="call-list">
        {#each recentActivity as item}
          <a
            class:failed={item.state === 'failed'}
            class:paused={item.state === 'paused'}
            class="call-row"
            href={hubHref(item.route)}
            title={`Open ${item.title} activity details.`}
          >
            <strong>{item.title}</strong>
            <span>{aiActivityStateLabel(item.state)}</span>
            <small>{item.detail} - {activityWhen(item.occurredAt)}</small>
          </a>
        {:else}
          <p class="muted">{aiOsPanelEmptyMessage('No AI OS activity yet.', 'Checking recent AI OS activity.', 'Recent activity')}</p>
        {/each}
      </div>
    </div>
  </div>
</details>

<section class="grid two work-grid legacy-command-grid">
  <div class="card card-pad panel command-panel">
    <div class="section-title">
      <Zap size={18} />
      <strong>Command Bar</strong>
    </div>
    <div class="field">
      <label for="command-objective-advanced">Objective</label>
      <textarea id="command-objective-advanced" bind:value={commandObjective} rows="4" title="Describe the advanced AI OS command to execute through the command bar."></textarea>
    </div>
    <label class="checkline" for="command-confirm-advanced">
      <input id="command-confirm-advanced" type="checkbox" bind:checked={commandConfirm} title="Allow confirmed write/system tools for the advanced command run." />
      <span>Confirm write/system tools</span>
    </label>
    <div class="action-row">
      <button class="button primary" type="button" disabled={commandBusy || aiOsActionBlocked} title={aiOsActionBlockedReason || (commandBusy ? 'AI OS command is already running.' : 'Execute this AI OS command.')} on:click={runCommandBar}>
        <Play size={17} />
        <span>{aiOsActionBlocked ? aiOsBlockedLabel : 'Execute'}</span>
      </button>
      <button class="button" type="button" disabled={loading} title={aiOsAdvancedCommandRefreshTitle} on:click={refresh}>
        <RefreshCw size={17} />
        <span>{loading ? 'Refreshing' : 'Refresh'}</span>
      </button>
    </div>
    <pre>{commandResult}</pre>
  </div>

  <div class="card card-pad panel">
    <div class="section-title">
      <Wrench size={18} />
      <strong>App Tools</strong>
    </div>
    <div class="tool-list">
      {#each status?.tools ?? [] as tool}
        <article class:armed={tool.requires_confirmation} class="tool-row">
          <div>
            <strong>{tool.id}</strong>
            <span>{tool.safety}</span>
          </div>
          <small>{tool.label}{tool.requires_confirmation ? ' - confirmation required' : ''}</small>
        </article>
      {:else}
        <p class="muted">{aiOsPanelEmptyMessage('No tools registered.', 'Checking app tools from AI OS.', 'App tools')}</p>
      {/each}
    </div>
    <div class="call-list">
      {#each toolCalls.slice(0, 6) as call}
        <article class:failed={!call.ok} class:selected={call.id === highlightedToolId} class="call-row">
          <strong>{call.tool_id}</strong>
          <span>{call.ok ? 'OK' : call.error ?? 'blocked'}</span>
          <small>{call.latency_ms.toFixed(0)} ms - {new Date(call.created_at).toLocaleTimeString()}</small>
        </article>
      {:else}
        <p class="muted">{highlightedToolId ? `Activity tool call ${highlightedToolId} is not in the current AI OS tool-call snapshot.` : aiOsPanelEmptyMessage('No tool calls logged yet.', 'Checking AI OS tool calls.', 'Tool calls')}</p>
      {/each}
      {#if !highlightedToolPresent}
        <p class="muted">The linked Activity tool call is not in the latest {toolCalls.length} tool-call rows. Refresh AI OS or open Activity for the durable record.</p>
      {/if}
    </div>
  </div>
</section>

<section class="grid two work-grid">
  <div class="card card-pad panel">
    <div class="section-title">
      <WandSparkles size={18} />
      <strong>Design Patch Lab</strong>
    </div>
    <div class="control-grid">
      <div class="field wide">
        <label for="design-instruction">Instruction</label>
        <textarea id="design-instruction" bind:value={designInstruction} rows="3" title="Describe the reversible UI or style change AI OS should propose."></textarea>
      </div>
      <div class="field wide">
        <label for="design-targets">Target files</label>
        <textarea id="design-targets" bind:value={designTargets} rows="2" title="List target files AI OS may inspect or patch, one path per line or comma-separated."></textarea>
      </div>
    </div>
    <label class="checkline" for="design-confirm">
      <input id="design-confirm" type="checkbox" bind:checked={designConfirm} title="Arm apply/revert actions for proposed design patches." />
      <span>Arm apply/revert</span>
    </label>
    <div class="action-row">
      <button class="button primary" type="button" disabled={designBusy || aiOsActionBlocked} title={aiOsActionBlockedReason || (designBusy ? 'A design patch action is already running.' : 'Ask AI OS to propose a reversible design patch.')} on:click={proposePatch}>
        <Play size={17} />
        <span>{aiOsActionBlocked ? aiOsBlockedLabel : 'Propose'}</span>
      </button>
    </div>
    <pre>{designResult}</pre>
  </div>

  <div class="card card-pad panel">
    <div class="section-title">
      <Activity size={18} />
      <strong>Benchmarks</strong>
      {#if highlightedBenchmarkId}
        <span class="section-kicker">Activity: {highlightedBenchmarkId}</span>
      {/if}
    </div>
    <div class="control-grid">
      <div class="field">
        <label for="benchmark-kind">Kind</label>
        <select id="benchmark-kind" bind:value={benchmarkKind} title="Choose which AI OS capability family to benchmark.">
          <option value="text">text</option>
          <option value="image">image</option>
          <option value="audio">audio</option>
          <option value="video">video</option>
        </select>
      </div>
      <div class="field wide">
        <label for="benchmark-prompt">Prompt</label>
        <textarea id="benchmark-prompt" bind:value={benchmarkPrompt} rows="3" title="Prompt or payload used for this benchmark probe."></textarea>
      </div>
    </div>
    <button class="button primary" type="button" disabled={benchmarkBusy || aiOsActionBlocked} title={aiOsActionBlockedReason || (benchmarkBusy ? 'Benchmark is already running.' : 'Run this AI OS capability benchmark.')} on:click={runCapabilityBenchmark}>
      <Zap size={17} />
      <span>{aiOsActionBlocked ? aiOsBlockedLabel : 'Run Benchmark'}</span>
    </button>
    <div class="benchmark-list">
      {#each benchmarkRuns.slice(0, 5) as run}
        <article class:failed={!run.ok} class:selected={run.id === highlightedBenchmarkId} class="benchmark-row">
          <div>
            <strong>{run.kind}</strong>
            <span>{run.provider ?? 'auto'}</span>
          </div>
          <small>{run.latency_ms.toFixed(0)} ms - {run.tokens_per_second ? `${run.tokens_per_second.toFixed(1)} tok/s` : 'tokens/sec not measured'}</small>
        </article>
      {:else}
        <p class="muted">{highlightedBenchmarkId ? `Activity benchmark ${highlightedBenchmarkId} is not in the current AI OS benchmark snapshot.` : aiOsPanelEmptyMessage('No benchmark runs yet.', 'Checking AI OS benchmark runs.', 'Benchmarks')}</p>
      {/each}
      {#if !highlightedBenchmarkPresent}
        <p class="muted">The linked Activity benchmark is not in the latest {benchmarkRuns.length} benchmark rows. Refresh AI OS or open Activity for the durable record.</p>
      {/if}
    </div>
    <pre>{benchmarkResult}</pre>
  </div>
</section>

<section class="card card-pad panel patch-history">
  <div class="section-title">
    <Wrench size={18} />
    <strong>Patch History</strong>
  </div>
  <div class="patch-list">
    {#each designPatches as patch}
      <article class:failed={patch.status === 'failed'} class="patch-row">
        <div>
          <strong>{patch.status}</strong>
          <span>{new Date(patch.created_at).toLocaleString()}</span>
        </div>
        <small>{patch.target_files.join(', ')}</small>
        <p>{patch.instruction}</p>
        <div class="action-row tight">
          <button class="button" type="button" disabled={designBusy || aiOsActionBlocked || patch.status === 'applied'} title={aiOsActionBlockedReason || (patch.status === 'applied' ? 'This patch is already applied.' : designBusy ? 'A design patch action is already running.' : 'Apply this reversible design patch.')} on:click={() => applyPatchRecord(patch)}>
            <Play size={16} />
            <span>Apply</span>
          </button>
          <button class="button" type="button" disabled={designBusy || aiOsActionBlocked || patch.status !== 'applied'} title={aiOsActionBlockedReason || (patch.status !== 'applied' ? 'Apply this patch before it can be reverted.' : designBusy ? 'A design patch action is already running.' : 'Revert this applied design patch.')} on:click={() => revertPatchRecord(patch)}>
            <Square size={16} />
            <span>Revert</span>
          </button>
        </div>
      </article>
    {:else}
      <p class="muted">{aiOsPanelEmptyMessage('No design patches yet.', 'Checking AI OS design patch history.', 'Design patches')}</p>
    {/each}
  </div>
</section>

<section class="grid two work-grid">
  <div class="card card-pad panel">
    <div class="section-title">
      <ShieldCheck size={18} />
      <strong>Foundation Health</strong>
    </div>
    <div class="foundation-grid">
      <article class:bad={!status?.integrity?.ok} class="foundation-tile">
        <Database size={17} />
        <span>Database</span>
        <strong>{status?.integrity?.ok ? 'OK' : 'Check'}</strong>
        <small>Schema {status?.integrity?.schema_version ?? 'not reported'} / {status?.integrity?.expected_schema_version ?? 'not reported'}</small>
      </article>
      <article class:bad={!status?.backups?.[0]?.ok} class="foundation-tile">
        <HardDrive size={17} />
        <span>Backups</span>
        <strong>{status?.backups?.[0]?.ok ? 'Verified' : 'Needed'}</strong>
        <small>{status?.backups?.[0]?.created_at ? new Date(status.backups[0].created_at).toLocaleString() : 'No verified AI OS backup recorded yet.'}</small>
      </article>
      <article class="foundation-tile">
        <Workflow size={17} />
        <span>Queue</span>
        <strong>{metricValue(status?.metrics?.queue, 'queue_depth')}</strong>
        <small>Active jobs</small>
      </article>
      <article class="foundation-tile">
        <Activity size={17} />
        <span>Failures</span>
        <strong>{metricValue(status?.metrics?.usage, 'failed_calls')}</strong>
        <small>{metricValue(status?.metrics?.usage, 'total_calls')} total calls</small>
      </article>
    </div>
    <div class="action-row">
      <button class="button primary" type="button" disabled={foundationBusy || aiOsActionBlocked} title={foundationActionTitle('Create a verified AI OS backup now.')} on:click={createBackupNow}>
        <HardDrive size={17} />
        <span>Backup</span>
      </button>
      <button class="button" type="button" disabled={foundationBusy || aiOsActionBlocked || !status?.backups?.length} title={foundationActionTitle('Verify the latest AI OS backup.', true)} on:click={verifyLatestBackup}>
        <ShieldCheck size={17} />
        <span>Verify</span>
      </button>
      <button class="button" type="button" disabled={foundationBusy || aiOsActionBlocked || !status?.backups?.length} title={foundationActionTitle('Run a non-destructive restore test for the latest backup.', true)} on:click={restoreTestLatestBackup}>
        <Database size={17} />
        <span>Restore Test</span>
      </button>
      <button class="button" type="button" disabled={foundationBusy || aiOsActionBlocked} title={foundationActionTitle('Run AI OS cleanup with configured resource limits.')} on:click={cleanupSystem}>
        <Wrench size={17} />
        <span>Cleanup</span>
      </button>
    </div>
    <pre>{foundationResult}</pre>
  </div>

  <div class="card table-card">
    <div class="section-title usage-title">
      <HardDrive size={18} />
      <strong>Backups</strong>
      {#if highlightedBackupId}
        <span class="section-kicker">Activity: {highlightedBackupId}</span>
      {/if}
    </div>
    <table>
      <thead>
        <tr>
          <th>Created</th>
          <th>Status</th>
          <th>Reason</th>
          <th>Size</th>
        </tr>
      </thead>
      <tbody>
        {#each status?.backups ?? [] as backup}
          <tr class:failed={!backup.ok} class:selected={backup.id === highlightedBackupId}>
            <td>{backup.created_at ? new Date(backup.created_at).toLocaleString() : backup.id}</td>
            <td>{backup.ok ? 'OK' : backup.error ?? 'Check'}</td>
            <td>{backup.reason}</td>
            <td>{(backup.size_bytes / 1024).toFixed(1)} KB</td>
          </tr>
        {:else}
          <tr><td colspan="4" class="muted">{highlightedBackupId ? `Activity backup ${highlightedBackupId} is not in the current AI OS backup snapshot.` : aiOsPanelEmptyMessage('No backups yet.', 'Checking AI OS backups.', 'Backups')}</td></tr>
        {/each}
        {#if !highlightedBackupPresent}
          <tr><td colspan="4" class="muted">The linked Activity backup is not in the latest AI OS backup rows. Refresh AI OS or open Activity for the durable record.</td></tr>
        {/if}
      </tbody>
    </table>
  </div>
</section>

<section class="grid two work-grid">
  <div class="card card-pad panel">
    <div class="section-title">
      <Play size={18} />
      <strong>Inference</strong>
    </div>
    <div class="control-grid">
      <div class="field wide">
        <label for="infer-prompt">Prompt</label>
        <textarea id="infer-prompt" bind:value={inferPrompt} rows="4" title="Prompt for one ad hoc AI OS inference call."></textarea>
      </div>
      <div class="field">
        <label for="infer-provider">Provider</label>
        <select id="infer-provider" bind:value={inferProvider} title="Pick a provider or leave auto so AI OS routes locally first when possible.">
          <option value="">auto</option>
          {#each providerOptions as provider}
            <option value={provider}>{provider}</option>
          {/each}
        </select>
      </div>
      <div class="field">
        <label for="infer-model">Model</label>
        <input id="infer-model" bind:value={inferModel} placeholder="provider default" title="Optional model override; leave blank to use the selected provider default." />
      </div>
    </div>
    <div class="action-row">
      <button class="button primary" type="button" disabled={inferBusy || aiOsActionBlocked} title={aiOsActionTitle('Run one ad hoc inference call.', inferBusy, 'Inference is already running.')} on:click={() => runAdHocInference(false)}>
        <Play size={17} />
        <span>{aiOsActionBlocked ? aiOsBlockedLabel : 'Run'}</span>
      </button>
      <button class="button" type="button" disabled={inferBusy || aiOsActionBlocked} title={aiOsActionTitle('Stream one ad hoc inference call.', inferBusy, 'Inference is already running.')} on:click={() => runAdHocInference(true)}>
        <Activity size={17} />
        <span>{aiOsActionBlocked ? aiOsBlockedLabel : 'Stream'}</span>
      </button>
    </div>
    <pre>{inferResult}</pre>
  </div>

  <div class="card card-pad panel">
    <div class="section-title">
      <Workflow size={18} />
      <strong>Jobs</strong>
      {#if highlightedJobId}
        <span class="section-kicker">Activity: {highlightedJobId}</span>
      {/if}
    </div>
    <div class="control-grid">
      <div class="field">
        <label for="job-primitive">Primitive</label>
        <select id="job-primitive" bind:value={jobPrimitive} title="Choose the batch job primitive AI OS should queue.">
          <option value="map">map</option>
          <option value="self_consistency">self-consistency</option>
          <option value="chunk_summarize">chunk summarize</option>
          <option value="retry_loop">retry loop</option>
        </select>
      </div>
      <div class="field wide">
        <label for="job-template">Template</label>
        <input id="job-template" bind:value={jobTemplate} title="Template applied to each queued item or retry loop step." />
      </div>
      <div class="field wide">
        <label for="job-items">Items</label>
        <textarea id="job-items" bind:value={jobItems} rows="4" title="Items to process, one per line, for the queued AI OS job."></textarea>
      </div>
    </div>
    <div class="action-row">
      <button class="button primary" type="button" disabled={jobBusy || aiOsActionBlocked} title={aiOsActionTitle('Queue this AI OS job.', jobBusy, 'A job queue request is already running.')} on:click={startJob}>
        <Play size={17} />
        <span>{aiOsActionBlocked ? aiOsBlockedLabel : 'Queue'}</span>
      </button>
      <button class="button" type="button" disabled={aiOsActionBlocked} title={aiOsActionTitle('Refresh AI OS job rows.', false, 'AI OS jobs are already refreshing.')} on:click={refreshJobs}>
        <RefreshCw size={17} />
        <span>{aiOsActionBlocked ? aiOsBlockedLabel : 'Jobs'}</span>
      </button>
    </div>
    <div class="job-list">
      {#each jobs as job}
        <article class:selected={job.id === highlightedJobId} class="job-row">
          <div>
            <strong>{job.primitive}</strong>
            <span>{job.status}</span>
          </div>
          <progress max="1" value={job.progress}></progress>
          <button class="icon-button" type="button" disabled={jobCancelDisabled(job)} title={jobCancelBlockedReason(job) || 'Cancel job'} aria-label={`Cancel ${job.id}`} on:click={() => cancelJob(job)}>
            <Square size={15} />
          </button>
        </article>
      {:else}
        <p class="muted">{highlightedJobId ? `Activity job ${highlightedJobId} is not in the current AI OS job snapshot.` : aiOsPanelEmptyMessage('No jobs queued.', 'Checking AI OS jobs.', 'Jobs')}</p>
      {/each}
      {#if !highlightedJobPresent}
        <p class="muted">The linked Activity job is not in the latest {jobs.length} AI OS job rows. Refresh AI OS or open Activity for the durable record.</p>
      {/if}
    </div>
  </div>
</section>

<section class="grid two work-grid">
  <div class="card card-pad panel">
    <div class="section-title">
      <Database size={18} />
      <strong>Semantic Memory</strong>
    </div>
    <div class="control-grid">
      <div class="field">
        <label for="memory-source">Source</label>
        <input id="memory-source" bind:value={memorySourceId} title="Source identifier to attach to semantic memory ingest records." />
      </div>
      <div class="field wide">
        <label for="memory-text">Text</label>
        <textarea id="memory-text" bind:value={memoryText} rows="4" title="Text to ingest into semantic memory."></textarea>
      </div>
      <div class="field wide">
        <label for="memory-query">Query</label>
        <input id="memory-query" bind:value={memoryQuery} title="Semantic memory query to search against local embeddings." />
      </div>
    </div>
    <div class="action-row">
      <button class="button" type="button" disabled={memoryBusy || aiOsActionBlocked} title={aiOsActionTitle('Ingest this scratch text into semantic memory.', memoryBusy, 'A memory action is already running.')} on:click={ingestScratchMemory}>
        <Database size={17} />
        <span>Ingest</span>
      </button>
      <button class="button primary" type="button" disabled={memoryBusy || aiOsActionBlocked} title={aiOsActionTitle('Search semantic memory.', memoryBusy, 'A memory action is already running.')} on:click={searchMemory}>
        <Search size={17} />
        <span>Search</span>
      </button>
    </div>
    <pre>{memoryResult}</pre>
  </div>

  <div class="card card-pad panel">
    <div class="section-title">
      <BrainCircuit size={18} />
      <strong>Agent Engine</strong>
    </div>
    <div class="field">
      <label for="agent-objective">Objective</label>
      <textarea id="agent-objective" bind:value={agentObjective} rows="5" title="Objective for the generic AI OS plan-act-check agent loop."></textarea>
    </div>
    <button class="button primary" type="button" disabled={agentBusy || aiOsActionBlocked} title={aiOsActionTitle('Run the generic agent loop.', agentBusy, 'Agent loop is already running.')} on:click={runGenericAgent}>
      <Play size={17} />
      <span>{aiOsActionBlocked ? aiOsBlockedLabel : 'Run Loop'}</span>
    </button>
    <pre>{agentResult}</pre>
  </div>
</section>

<section class="grid two work-grid">
  <div class="card card-pad panel">
    <div class="section-title">
      {#if multimodalKind === 'image'}
        <Image size={18} />
      {:else if multimodalKind === 'video'}
        <Film size={18} />
      {:else if multimodalKind === 'audio'}
        <Music size={18} />
      {:else if multimodalKind === 'audio_tts'}
        <Volume2 size={18} />
      {:else if multimodalKind === 'audio_stt'}
        <Mic size={18} />
      {:else}
        <Eye size={18} />
      {/if}
      <strong>Make Media</strong>
    </div>
    <div class="control-grid">
      <div class="field">
        <label for="multi-kind">Kind</label>
        <select id="multi-kind" bind:value={multimodalKind} title="Choose the multimodal capability to invoke.">
          <option value="image">Create an image</option>
          <option value="audio">Create audio</option>
          <option value="video">Create a short animation/video</option>
          <option value="audio_tts">Read text aloud</option>
          <option value="audio_stt">Transcribe audio</option>
          <option value="vision">Analyze an image</option>
        </select>
      </div>
      <div class="field">
        <label for="multi-provider">Provider</label>
        <select id="multi-provider" bind:value={multimodalProvider} title="Pick a multimodal provider or leave auto for local-first routing.">
          <option value="">auto, local first</option>
          {#each mediaProviderOptions as provider}
            <option value={provider}>{provider}</option>
          {/each}
        </select>
      </div>
      <div class="field wide">
        <label for="multi-prompt">Prompt</label>
        <textarea id="multi-prompt" bind:value={multimodalPrompt} rows="3" title="Prompt for image, audio, video, or vision capability calls."></textarea>
      </div>
      <div class="field wide">
        <label for="multi-text">Text</label>
        <textarea id="multi-text" bind:value={multimodalText} rows="3" title="Text payload for TTS, captions, transcription context, or multimodal instructions."></textarea>
      </div>
      <div class="field wide">
        <label for="image-base64">Image base64</label>
        <textarea id="image-base64" bind:value={imageBase64} rows="2" title="Optional base64 image input for img2img or vision analysis."></textarea>
      </div>
      <div class="field wide">
        <label for="audio-base64">Audio base64</label>
        <textarea id="audio-base64" bind:value={audioBase64} rows="2" title="Optional base64 audio input for speech-to-text or audio analysis."></textarea>
      </div>
      <div class="field wide">
        <label for="video-base64">Video base64</label>
        <textarea id="video-base64" bind:value={videoBase64} rows="2" title="Optional base64 video input for video-capable adapters."></textarea>
      </div>
    </div>
    <button class="button primary" type="button" disabled={multimodalBusy || aiOsActionBlocked} title={aiOsActionTitle('Invoke the selected multimodal capability.', multimodalBusy, 'Multimodal generation is already running.')} on:click={invokeMedia}>
      <Play size={17} />
      <span>{aiOsActionBlocked ? aiOsBlockedLabel : multimodalBusy ? 'Creating' : 'Create'}</span>
    </button>
    {#if multimodalPreview}
      <div class="media-preview">
        {#if multimodalPreview.kind === 'image'}
          <img src={multimodalPreview.src} alt="Generated preview" />
        {:else if multimodalPreview.kind === 'audio'}
          <audio controls src={multimodalPreview.src}></audio>
        {:else}
          <!-- svelte-ignore a11y_media_has_caption -->
          <video controls src={multimodalPreview.src}></video>
        {/if}
      </div>
    {/if}
    <pre>{multimodalResult}</pre>
    <div class="asset-list">
      {#each generationAssets.slice(0, 6) as asset}
        <article class:selected={asset.id === highlightedGenerationId} class="asset-row">
          <div>
            <strong>{asset.kind}</strong>
            <span>{asset.provider}</span>
          </div>
          <small>{asset.asset_path ?? asset.content_type ?? 'metadata only'}</small>
        </article>
      {:else}
        <p class="muted">{highlightedGenerationId ? `Activity generation ${highlightedGenerationId} is not in the current AI OS asset snapshot.` : aiOsPanelEmptyMessage('No generation assets yet.', 'Checking generated assets from AI OS.', 'Generated assets')}</p>
      {/each}
      {#if !highlightedGenerationPresent}
        <p class="muted">The linked Activity generation is not in the latest {generationAssets.length} generated asset rows. Refresh AI OS or open Activity for the durable record.</p>
      {/if}
    </div>
  </div>

  <div class="card card-pad panel">
    <div class="section-title">
      <ToggleLeft size={18} />
      <strong>Ambient Units</strong>
    </div>
    <div class="ambient-list">
      {#each status?.background ?? [] as unit}
        <article class="ambient-row">
          <div>
            <strong>{unit.label}</strong>
            <span>{unit.trigger}</span>
          </div>
          <div class="ambient-actions">
            <button class="icon-button" type="button" disabled={backgroundActionDisabled(unit, 'toggle')} title={backgroundActionBlockedReason(unit, 'toggle') || 'Toggle ambient unit'} aria-label={`Toggle ${unit.label}`} on:click={() => toggleUnit(unit)}>
              {#if unit.enabled}
                <ToggleRight size={18} />
              {:else}
                <ToggleLeft size={18} />
              {/if}
            </button>
            <button class="icon-button" type="button" disabled={backgroundActionDisabled(unit, 'run')} title={backgroundActionBlockedReason(unit, 'run') || 'Run ambient unit'} aria-label={`Run ${unit.label}`} on:click={() => runUnit(unit)}>
              <Play size={16} />
            </button>
          </div>
        </article>
      {:else}
        <p class="muted">{aiOsPanelEmptyMessage('No ambient units registered.', 'Checking ambient units from AI OS.', 'Ambient units')}</p>
      {/each}
    </div>
  </div>
</section>

<section class="card table-card">
  <div class="section-title usage-title">
    <Activity size={18} />
    <strong>Usage Log</strong>
  </div>
  <table>
    <thead>
      <tr>
        <th>Provider</th>
        <th>Task</th>
        <th>Tokens</th>
        <th>Latency</th>
        <th>Cost</th>
      </tr>
    </thead>
    <tbody>
      {#each usage as entry}
        <tr class:failed={!entry.ok}>
          <td>{entry.provider}</td>
          <td>{entry.task_type}</td>
          <td>{entry.total_tokens}</td>
          <td>{entry.latency_ms.toFixed(0)} ms</td>
          <td>${entry.cost_usd.toFixed(6)}</td>
        </tr>
      {:else}
        <tr><td colspan="5" class="muted">{aiOsPanelEmptyMessage('No calls logged yet.', 'Checking AI OS usage log.', 'Usage log')}</td></tr>
      {/each}
    </tbody>
  </table>
</section>

<style>
  .error-banner,
  .success-banner {
    margin-bottom: 14px;
    font-weight: 800;
  }

  .connection-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 14px;
    background: var(--surface-muted);
  }

  .connection-card div {
    display: grid;
    gap: 4px;
    min-width: 0;
  }

  .connection-card span,
  .connection-card p {
    margin: 0;
    color: var(--muted);
    overflow-wrap: anywhere;
  }

  .connection-card .connection-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
  }

  .plain-guide {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
    margin-bottom: 14px;
    background: var(--surface-muted);
  }

  .startup-card {
    display: grid;
    gap: 12px;
    margin-bottom: 14px;
  }

  .startup-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .startup-heading div {
    display: grid;
    gap: 4px;
  }

  .startup-heading span,
  .startup-note {
    margin: 0;
    color: var(--muted);
  }

  .startup-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 10px;
  }

  .startup-check {
    display: grid;
    gap: 7px;
    min-height: 104px;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface-muted);
  }

  .startup-check.ready {
    border-color: var(--success-border);
    background: var(--success-bg);
  }

  .startup-check.degraded {
    border-color: var(--warning-border);
    background: var(--warning-bg);
  }

  .startup-check.checking {
    border-style: dashed;
    background: var(--surface-soft);
  }

  .startup-check.offline {
    border-color: var(--error-border);
    background: var(--error-bg);
  }

  .startup-check div {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .startup-check span {
    color: var(--muted);
    font-size: 12px;
    font-weight: 850;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .startup-check p {
    margin: 0;
    color: var(--muted);
    line-height: 1.45;
    overflow-wrap: anywhere;
  }

  .plain-guide div {
    display: grid;
    gap: 5px;
    align-content: start;
  }

  .plain-guide p {
    margin: 0;
    color: var(--muted);
    line-height: 1.45;
  }

  .command-hero {
    display: grid;
    gap: 12px;
    margin-bottom: 14px;
  }

  .auto-route-note {
    margin: 0;
    color: var(--muted);
    font-weight: 750;
    line-height: 1.4;
  }

  .example-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .chip-button {
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 7px 10px;
    color: var(--text);
    background: var(--surface-muted);
    cursor: pointer;
    font-size: 12px;
    font-weight: 800;
  }

  .chip-button:hover {
    background: var(--active);
  }

  .friendly-result {
    min-height: 72px;
  }

  .capability-showcase {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
    margin-bottom: 14px;
  }

  .capability-card {
    display: grid;
    gap: 8px;
    align-content: start;
    border-color: var(--border);
  }

  .capability-card.ready {
    border-color: var(--accent);
  }

  .capability-card div {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .capability-card span {
    color: var(--muted);
    font-size: 12px;
    font-weight: 850;
    white-space: nowrap;
  }

  .capability-card p {
    margin: 0;
    color: var(--muted);
    line-height: 1.45;
  }

  .advanced-status {
    margin-bottom: 14px;
  }

  .advanced-status summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    cursor: pointer;
    font-weight: 900;
  }

  .advanced-status summary small {
    color: var(--muted);
    font-size: 12px;
  }

  .advanced-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px;
    margin-top: 14px;
    padding-top: 14px;
    border-top: 1px solid var(--border);
  }

  .legacy-command-grid,
  .command-panel,
  .command-panel + .panel {
    display: none;
  }

  .error-banner {
    border-color: var(--error-border);
    color: var(--error-text);
    background: var(--error-bg);
  }

  .success-banner {
    border-color: var(--success-border);
    color: var(--success-text);
    background: var(--success-bg);
  }

  .metric-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 12px;
    margin-bottom: 14px;
  }

  .metric {
    display: grid;
    gap: 6px;
    min-height: 88px;
    align-content: center;
  }

  .metric span {
    color: var(--muted);
    font-size: 13px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0;
  }

  .metric strong {
    font-size: 18px;
    line-height: 1;
  }

  .metric small {
    color: var(--muted);
  }

  .machine-profile-card {
    display: grid;
    gap: 12px;
    margin-bottom: 14px;
  }

  .profile-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
  }

  .profile-grid div {
    display: grid;
    gap: 5px;
    min-width: 0;
    padding: 10px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface-muted);
  }

  .profile-grid span {
    color: var(--muted);
    font-size: 12px;
    font-weight: 800;
    text-transform: uppercase;
  }

  .profile-grid strong,
  .profile-grid small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .profile-grid small {
    color: var(--muted);
  }

  .work-grid {
    margin-bottom: 14px;
  }

  .section-title {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
  }

  .section-kicker {
    min-width: 0;
    color: var(--muted);
    font-size: 12px;
    font-weight: 800;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .providers-panel,
  .capability-panel,
  .panel {
    display: grid;
    gap: 12px;
    align-content: start;
  }

  .provider-list,
  .capability-groups,
  .gpu-list,
  .job-list,
  .ambient-list,
  .tool-list,
  .call-list,
  .benchmark-list,
  .asset-list,
  .patch-list {
    display: grid;
    gap: 10px;
  }

  .provider-row,
  .capability-row,
  .gpu-row,
  .model-row,
  .job-row,
  .ambient-row,
  .tool-row,
  .call-row,
  .benchmark-row,
  .asset-row,
  .patch-row,
  .foundation-tile {
    display: grid;
    gap: 6px;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface-muted);
  }

  .foundation-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 10px;
  }

  .foundation-tile {
    min-height: 92px;
  }

  .foundation-tile.bad {
    border-color: var(--error-border);
    background: var(--error-bg);
  }

  .foundation-tile span {
    color: var(--muted);
    font-size: 12px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0;
  }

  .foundation-tile small {
    color: var(--muted);
    overflow-wrap: anywhere;
  }

  .provider-row div,
  .gpu-row div,
  .model-row div,
  .job-row div,
  .ambient-row div:first-child,
  .tool-row div,
  .benchmark-row div,
  .asset-row div,
  .patch-row div:first-child {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .provider-row span,
  .gpu-row span,
  .model-row span,
  .job-row span,
  .ambient-row span,
  .tool-row span,
  .call-row span,
  .benchmark-row span,
  .asset-row span,
  .patch-row span,
  .capability-group > span {
    color: var(--muted);
    font-size: 12px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0;
  }

  .provider-row p,
  .gpu-row small,
  .model-row small,
  .capability-row small,
  .tool-row small,
  .call-row small,
  .benchmark-row small,
  .asset-row small,
  .patch-row small,
  .patch-row p {
    margin: 0;
    color: var(--muted);
    overflow-wrap: anywhere;
  }

  .provider-row.offline,
  .capability-row.off,
  .call-row.failed,
  .benchmark-row.failed,
  .patch-row.failed {
    border-color: var(--error-border);
    background: var(--error-bg);
  }

  .tool-row.armed {
    border-color: var(--warning-border);
    background: var(--warning-bg);
  }

  .job-row.selected,
  .call-row.selected,
  .benchmark-row.selected,
  .asset-row.selected {
    border-color: var(--accent);
    background: var(--active);
    box-shadow: inset 3px 0 0 var(--accent);
  }

  .capability-group {
    display: grid;
    gap: 8px;
  }

  .control-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }

  .wide {
    grid-column: 1 / -1;
  }

  .checkline {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: var(--text-soft);
    font-size: 13px;
    font-weight: 800;
  }

  .checkline input {
    width: 16px;
    height: 16px;
  }

  pre {
    min-height: 120px;
    max-height: 360px;
    overflow: auto;
    margin: 0;
    padding: 12px;
    border-radius: 6px;
    background: var(--code-bg);
    color: var(--code-text);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .media-preview {
    display: grid;
    min-height: 72px;
    place-items: center;
    padding: 10px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface-muted);
  }

  .media-preview img,
  .media-preview video {
    max-width: 100%;
    max-height: 340px;
    border-radius: 6px;
  }

  .media-preview audio {
    width: 100%;
  }

  .job-row {
    grid-template-columns: minmax(0, 1fr) minmax(120px, 220px) auto;
    align-items: center;
  }

  .call-row {
    grid-template-columns: minmax(0, 1fr) auto;
    color: var(--text);
    text-decoration: none;
  }

  .call-row:hover {
    background: var(--active);
  }

  .call-row.paused {
    border-color: var(--warning-border);
    background: var(--warning-bg);
  }

  .patch-history {
    margin-bottom: 14px;
  }

  .patch-list {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .patch-row {
    align-content: start;
  }

  .action-row.tight {
    margin-top: 4px;
  }

  progress {
    width: 100%;
    height: 10px;
  }

  .ambient-row {
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
  }

  .ambient-actions {
    display: flex;
    gap: 6px;
  }

  .icon-button {
    display: inline-grid;
    width: 34px;
    height: 34px;
    place-items: center;
    border: 1px solid var(--border-strong);
    border-radius: 6px;
    color: var(--text);
    background: var(--surface);
    cursor: pointer;
  }

  .icon-button:disabled,
  .button:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  .table-card {
    overflow: auto;
  }

  .usage-title {
    padding: 14px 14px 0;
  }

  tr.failed td {
    background: var(--error-bg);
  }

  tr.selected td {
    background: var(--active);
    box-shadow: inset 0 1px 0 var(--accent), inset 0 -1px 0 var(--accent);
  }

  @media (max-width: 1100px) {
    .metric-grid,
    .profile-grid,
    .foundation-grid,
    .startup-grid,
    .capability-showcase,
    .advanced-grid,
    .plain-guide,
    :global(.grid.two),
    .patch-list {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 760px) {
    .metric-grid,
    .profile-grid,
    .foundation-grid,
    .startup-grid,
    .capability-showcase,
    .advanced-grid,
    .plain-guide,
    :global(.grid.two),
    .control-grid,
    .patch-list,
    .job-row,
    .ambient-row {
      grid-template-columns: 1fr;
    }

    .connection-card {
      align-items: stretch;
      flex-direction: column;
    }

    .connection-card .connection-actions {
      justify-content: flex-start;
    }
  }
</style>
