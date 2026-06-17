<script lang="ts">
  import { onMount } from 'svelte';
  import {
    Activity,
    BrainCircuit,
    Cpu,
    Database,
    Eye,
    HardDrive,
    Image,
    ListChecks,
    Mic,
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
  import {
    cancelAiJob,
    cleanupAiOs,
    createAiBackup,
    createAiJob,
    getAiStatus,
    getAiUsage,
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
    type AiStatus,
    type AiToolCallEntry,
    type AiUsageEntry
  } from '$lib/ai-os-api';

  let status: AiStatus | null = null;
  let usage: AiUsageEntry[] = [];
  let jobs: AiJobSnapshot[] = [];
  let toolCalls: AiToolCallEntry[] = [];
  let generationAssets: AiGenerationAsset[] = [];
  let designPatches: AiDesignPatch[] = [];
  let benchmarkRuns: AiBenchmarkRun[] = [];
  let loading = false;
  let actionError = '';
  let actionMessage = '';
  let foundationResult = '';
  let foundationBusy = false;

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
  let multimodalResult = '';
  let multimodalBusy = false;

  let benchmarkKind = 'text';
  let benchmarkPrompt = 'Run a compact local benchmark and describe the AI stack capability in one paragraph.';
  let benchmarkResult = '';
  let benchmarkBusy = false;

  $: providers = status?.providers ?? [];
  $: availableProviders = providers.filter((provider) => provider.available);
  $: providerOptions = providers.map((provider) => provider.id);
  $: hardware = status?.hardware;
  $: capabilityGroups = groupCapabilities(status?.capabilities ?? []);

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

  function stringify(value: unknown): string {
    return JSON.stringify(value, null, 2);
  }

  function numberLabel(value: number | undefined, suffix = ''): string {
    return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(1)}${suffix}` : 'n/a';
  }

  function metricValue(source: Record<string, unknown> | undefined, key: string): string {
    const value = source?.[key];
    if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2);
    if (typeof value === 'string') return value;
    if (value === null || value === undefined) return 'n/a';
    return stringify(value);
  }

  async function refresh(): Promise<void> {
    loading = true;
    actionError = '';
    try {
      const [nextStatus, nextUsage, nextToolCalls, nextAssets, nextPatches, nextBenchmarks] = await Promise.all([
        getAiStatus(),
        getAiUsage(30),
        listToolCalls(30),
        listGenerationAssets(24),
        listDesignPatches(12),
        listBenchmarks(12)
      ]);
      status = nextStatus;
      usage = nextUsage;
      toolCalls = nextToolCalls;
      generationAssets = nextAssets;
      designPatches = nextPatches;
      benchmarkRuns = nextBenchmarks;
      jobs = status.jobs;
      actionMessage = 'AI OS status refreshed.';
    } catch (error) {
      setError(error, 'Failed to load AI OS status.');
    } finally {
      loading = false;
    }
  }

  async function refreshJobs(): Promise<void> {
    try {
      jobs = await listAiJobs();
    } catch (error) {
      setError(error, 'Failed to refresh jobs.');
    }
  }

  async function runAdHocInference(stream = false): Promise<void> {
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
            task_type: 'dashboard.stream'
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
          task_type: 'dashboard.ad_hoc'
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
    jobBusy = true;
    actionError = '';
    try {
      const request = {
        prompt: inferPrompt,
        provider: inferProvider || undefined,
        model: inferModel || undefined,
        task_type: `dashboard.job.${jobPrimitive}`,
        allow_fallback: true,
        local_first: true
      };
      const payload: Record<string, unknown> = { primitive: jobPrimitive, request };
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

  async function cancelJob(jobId: string): Promise<void> {
    try {
      await cancelAiJob(jobId);
      await refreshJobs();
    } catch (error) {
      setError(error, 'Failed to cancel job.');
    }
  }

  async function ingestScratchMemory(): Promise<void> {
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
    agentBusy = true;
    actionError = '';
    try {
      const result = await runAgent({
        objective: agentObjective,
        provider: inferProvider || undefined,
        model: inferModel || undefined,
        max_steps: 3,
        tools: ['memory.search']
      });
      agentResult = stringify(result);
    } catch (error) {
      setError(error, 'Agent run failed.');
    } finally {
      agentBusy = false;
    }
  }

  async function runCommandBar(): Promise<void> {
    commandBusy = true;
    actionError = '';
    try {
      const result = await runCommand({
        objective: commandObjective,
        confirm_actions: commandConfirm,
        provider: inferProvider || undefined,
        model: inferModel || undefined,
        max_steps: 4,
        context: { source: 'ai-os-dashboard' }
      });
      commandResult = stringify(result);
      toolCalls = await listToolCalls(30);
    } catch (error) {
      setError(error, 'Command failed.');
    } finally {
      commandBusy = false;
    }
  }

  async function proposePatch(): Promise<void> {
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
    multimodalBusy = true;
    actionError = '';
    try {
      const result = await invokeMultimodal(multimodalKind, {
        provider: multimodalProvider || undefined,
        model: inferModel || undefined,
        prompt: multimodalPrompt,
        text: multimodalText,
        image_base64: imageBase64 || undefined,
        audio_base64: audioBase64 || undefined
      });
      multimodalResult = stringify(result);
      generationAssets = await listGenerationAssets(24);
    } catch (error) {
      setError(error, 'Multimodal invocation failed.');
    } finally {
      multimodalBusy = false;
    }
  }

  async function runCapabilityBenchmark(): Promise<void> {
    benchmarkBusy = true;
    actionError = '';
    try {
      const run = await runBenchmark({
        kind: benchmarkKind,
        prompt: benchmarkPrompt,
        provider: inferProvider || undefined,
        model: inferModel || undefined,
        local_first: true
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

  async function toggleUnit(unit: AiBackgroundUnit): Promise<void> {
    try {
      await toggleBackgroundUnit(unit.id, !unit.enabled);
      await refresh();
    } catch (error) {
      setError(error, 'Failed to toggle background unit.');
    }
  }

  async function runUnit(unit: AiBackgroundUnit): Promise<void> {
    try {
      await runBackgroundUnit(unit.id);
      await refresh();
    } catch (error) {
      setError(error, 'Failed to run background unit.');
    }
  }

  onMount(refresh);
</script>

<section class="page-header">
  <div>
    <p class="eyebrow">Personal AI OS</p>
    <h1>Capability Dashboard</h1>
  </div>
  <button class="button" type="button" disabled={loading} on:click={refresh}>
    <RefreshCw size={17} />
    <span>{loading ? 'Refreshing' : 'Refresh'}</span>
  </button>
</section>

{#if actionError}
  <section class="card card-pad error-banner">{actionError}</section>
{:else if actionMessage}
  <section class="card card-pad success-banner">{actionMessage}</section>
{/if}

<section class="metric-grid">
  <article class="card card-pad metric">
    <Cpu size={19} />
    <span>CPU</span>
    <strong>{numberLabel(hardware?.cpu_percent, '%')}</strong>
  </article>
  <article class="card card-pad metric">
    <Activity size={19} />
    <span>RAM</span>
    <strong>{numberLabel(hardware?.memory_percent, '%')}</strong>
    <small>{hardware?.memory_used_gb ?? 'n/a'} / {hardware?.memory_total_gb ?? 'n/a'} GB</small>
  </article>
  <article class="card card-pad metric">
    <Zap size={19} />
    <span>Tokens/sec</span>
    <strong>{numberLabel(hardware?.recent_tokens_per_second)}</strong>
  </article>
  <article class="card card-pad metric">
    <BrainCircuit size={19} />
    <span>Reachable</span>
    <strong>{availableProviders.length}/{providers.length}</strong>
  </article>
</section>

<section class="grid two top-grid">
  <div class="card card-pad providers-panel">
    <div class="section-title">
      <Cpu size={18} />
      <strong>Providers</strong>
    </div>
    <div class="provider-list">
      {#each providers as provider}
        <article class:offline={!provider.available} class="provider-row">
          <div>
            <strong>{provider.label}</strong>
            <span>{provider.local ? 'local' : provider.paid ? 'paid' : 'adapter'}</span>
          </div>
          <p>{provider.available ? `${provider.models.length} models` : provider.error}</p>
          <small>{provider.capabilities.join(', ')}</small>
        </article>
      {:else}
        <p class="muted">AI OS API is not reachable yet.</p>
      {/each}
    </div>
  </div>

  <div class="card card-pad capability-panel">
    <div class="section-title">
      <ListChecks size={18} />
      <strong>Capabilities</strong>
    </div>
    <div class="capability-groups">
      {#each capabilityGroups as group}
        <div class="capability-group">
          <span>{group.kind}</span>
          {#each group.rows as capability}
            <div class:off={!capability.available} class="capability-row">
              <strong>{capability.label}</strong>
              <small>{capability.available ? capability.adapters.join(', ') || capability.safety : 'unavailable'}</small>
            </div>
          {/each}
        </div>
      {/each}
    </div>
  </div>
</section>

<section class="grid two work-grid">
  <div class="card card-pad panel command-panel">
    <div class="section-title">
      <Zap size={18} />
      <strong>Command Bar</strong>
    </div>
    <div class="field">
      <label for="command-objective">Objective</label>
      <textarea id="command-objective" bind:value={commandObjective} rows="4"></textarea>
    </div>
    <label class="checkline" for="command-confirm">
      <input id="command-confirm" type="checkbox" bind:checked={commandConfirm} />
      <span>Confirm write/system tools</span>
    </label>
    <div class="action-row">
      <button class="button primary" type="button" disabled={commandBusy} on:click={runCommandBar}>
        <Play size={17} />
        <span>Execute</span>
      </button>
      <button class="button" type="button" on:click={refresh}>
        <RefreshCw size={17} />
        <span>Refresh</span>
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
          <small>{tool.label}{tool.requires_confirmation ? ' · confirmation required' : ''}</small>
        </article>
      {:else}
        <p class="muted">No tools registered.</p>
      {/each}
    </div>
    <div class="call-list">
      {#each toolCalls.slice(0, 6) as call}
        <article class:failed={!call.ok} class="call-row">
          <strong>{call.tool_id}</strong>
          <span>{call.ok ? 'OK' : call.error ?? 'blocked'}</span>
          <small>{call.latency_ms.toFixed(0)} ms · {new Date(call.created_at).toLocaleTimeString()}</small>
        </article>
      {:else}
        <p class="muted">No tool calls yet.</p>
      {/each}
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
        <textarea id="design-instruction" bind:value={designInstruction} rows="3"></textarea>
      </div>
      <div class="field wide">
        <label for="design-targets">Target files</label>
        <textarea id="design-targets" bind:value={designTargets} rows="2"></textarea>
      </div>
    </div>
    <label class="checkline" for="design-confirm">
      <input id="design-confirm" type="checkbox" bind:checked={designConfirm} />
      <span>Arm apply/revert</span>
    </label>
    <div class="action-row">
      <button class="button primary" type="button" disabled={designBusy} on:click={proposePatch}>
        <Play size={17} />
        <span>Propose</span>
      </button>
    </div>
    <pre>{designResult}</pre>
  </div>

  <div class="card card-pad panel">
    <div class="section-title">
      <Activity size={18} />
      <strong>Benchmarks</strong>
    </div>
    <div class="control-grid">
      <div class="field">
        <label for="benchmark-kind">Kind</label>
        <select id="benchmark-kind" bind:value={benchmarkKind}>
          <option value="text">text</option>
          <option value="image">image</option>
        </select>
      </div>
      <div class="field wide">
        <label for="benchmark-prompt">Prompt</label>
        <textarea id="benchmark-prompt" bind:value={benchmarkPrompt} rows="3"></textarea>
      </div>
    </div>
    <button class="button primary" type="button" disabled={benchmarkBusy} on:click={runCapabilityBenchmark}>
      <Zap size={17} />
      <span>Run Benchmark</span>
    </button>
    <div class="benchmark-list">
      {#each benchmarkRuns.slice(0, 5) as run}
        <article class:failed={!run.ok} class="benchmark-row">
          <div>
            <strong>{run.kind}</strong>
            <span>{run.provider ?? 'auto'}</span>
          </div>
          <small>{run.latency_ms.toFixed(0)} ms · {run.tokens_per_second ? `${run.tokens_per_second.toFixed(1)} tok/s` : 'n/a tok/s'}</small>
        </article>
      {:else}
        <p class="muted">No benchmark runs yet.</p>
      {/each}
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
          <button class="button" type="button" disabled={designBusy || patch.status === 'applied'} on:click={() => applyPatchRecord(patch)}>
            <Play size={16} />
            <span>Apply</span>
          </button>
          <button class="button" type="button" disabled={designBusy || patch.status !== 'applied'} on:click={() => revertPatchRecord(patch)}>
            <Square size={16} />
            <span>Revert</span>
          </button>
        </div>
      </article>
    {:else}
      <p class="muted">No design patches yet.</p>
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
        <small>Schema {status?.integrity?.schema_version ?? 'n/a'} / {status?.integrity?.expected_schema_version ?? 'n/a'}</small>
      </article>
      <article class:bad={!status?.backups?.[0]?.ok} class="foundation-tile">
        <HardDrive size={17} />
        <span>Backups</span>
        <strong>{status?.backups?.[0]?.ok ? 'Verified' : 'Needed'}</strong>
        <small>{status?.backups?.[0]?.created_at ? new Date(status.backups[0].created_at).toLocaleString() : 'No backup yet'}</small>
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
      <button class="button primary" type="button" disabled={foundationBusy} on:click={createBackupNow}>
        <HardDrive size={17} />
        <span>Backup</span>
      </button>
      <button class="button" type="button" disabled={foundationBusy || !status?.backups?.length} on:click={verifyLatestBackup}>
        <ShieldCheck size={17} />
        <span>Verify</span>
      </button>
      <button class="button" type="button" disabled={foundationBusy || !status?.backups?.length} on:click={restoreTestLatestBackup}>
        <Database size={17} />
        <span>Restore Test</span>
      </button>
      <button class="button" type="button" disabled={foundationBusy} on:click={cleanupSystem}>
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
          <tr class:failed={!backup.ok}>
            <td>{backup.created_at ? new Date(backup.created_at).toLocaleString() : backup.id}</td>
            <td>{backup.ok ? 'OK' : backup.error ?? 'Check'}</td>
            <td>{backup.reason}</td>
            <td>{(backup.size_bytes / 1024).toFixed(1)} KB</td>
          </tr>
        {:else}
          <tr><td colspan="4" class="muted">No backups yet.</td></tr>
        {/each}
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
        <textarea id="infer-prompt" bind:value={inferPrompt} rows="4"></textarea>
      </div>
      <div class="field">
        <label for="infer-provider">Provider</label>
        <select id="infer-provider" bind:value={inferProvider}>
          <option value="">auto</option>
          {#each providerOptions as provider}
            <option value={provider}>{provider}</option>
          {/each}
        </select>
      </div>
      <div class="field">
        <label for="infer-model">Model</label>
        <input id="infer-model" bind:value={inferModel} placeholder="provider default" />
      </div>
    </div>
    <div class="action-row">
      <button class="button primary" type="button" disabled={inferBusy} on:click={() => runAdHocInference(false)}>
        <Play size={17} />
        <span>Run</span>
      </button>
      <button class="button" type="button" disabled={inferBusy} on:click={() => runAdHocInference(true)}>
        <Activity size={17} />
        <span>Stream</span>
      </button>
    </div>
    <pre>{inferResult}</pre>
  </div>

  <div class="card card-pad panel">
    <div class="section-title">
      <Workflow size={18} />
      <strong>Jobs</strong>
    </div>
    <div class="control-grid">
      <div class="field">
        <label for="job-primitive">Primitive</label>
        <select id="job-primitive" bind:value={jobPrimitive}>
          <option value="map">map</option>
          <option value="self_consistency">self-consistency</option>
          <option value="chunk_summarize">chunk summarize</option>
          <option value="retry_loop">retry loop</option>
        </select>
      </div>
      <div class="field wide">
        <label for="job-template">Template</label>
        <input id="job-template" bind:value={jobTemplate} />
      </div>
      <div class="field wide">
        <label for="job-items">Items</label>
        <textarea id="job-items" bind:value={jobItems} rows="4"></textarea>
      </div>
    </div>
    <div class="action-row">
      <button class="button primary" type="button" disabled={jobBusy} on:click={startJob}>
        <Play size={17} />
        <span>Queue</span>
      </button>
      <button class="button" type="button" on:click={refreshJobs}>
        <RefreshCw size={17} />
        <span>Jobs</span>
      </button>
    </div>
    <div class="job-list">
      {#each jobs as job}
        <article class="job-row">
          <div>
            <strong>{job.primitive}</strong>
            <span>{job.status}</span>
          </div>
          <progress max="1" value={job.progress}></progress>
          <button class="icon-button" type="button" disabled={job.status !== 'running' && job.status !== 'queued'} title="Cancel" aria-label={`Cancel ${job.id}`} on:click={() => cancelJob(job.id)}>
            <Square size={15} />
          </button>
        </article>
      {:else}
        <p class="muted">No jobs queued.</p>
      {/each}
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
        <input id="memory-source" bind:value={memorySourceId} />
      </div>
      <div class="field wide">
        <label for="memory-text">Text</label>
        <textarea id="memory-text" bind:value={memoryText} rows="4"></textarea>
      </div>
      <div class="field wide">
        <label for="memory-query">Query</label>
        <input id="memory-query" bind:value={memoryQuery} />
      </div>
    </div>
    <div class="action-row">
      <button class="button" type="button" disabled={memoryBusy} on:click={ingestScratchMemory}>
        <Database size={17} />
        <span>Ingest</span>
      </button>
      <button class="button primary" type="button" disabled={memoryBusy} on:click={searchMemory}>
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
      <textarea id="agent-objective" bind:value={agentObjective} rows="5"></textarea>
    </div>
    <button class="button primary" type="button" disabled={agentBusy} on:click={runGenericAgent}>
      <Play size={17} />
      <span>Run Loop</span>
    </button>
    <pre>{agentResult}</pre>
  </div>
</section>

<section class="grid two work-grid">
  <div class="card card-pad panel">
    <div class="section-title">
      {#if multimodalKind === 'image'}
        <Image size={18} />
      {:else if multimodalKind === 'audio_tts'}
        <Volume2 size={18} />
      {:else if multimodalKind === 'audio_stt'}
        <Mic size={18} />
      {:else}
        <Eye size={18} />
      {/if}
      <strong>Multimodal</strong>
    </div>
    <div class="control-grid">
      <div class="field">
        <label for="multi-kind">Kind</label>
        <select id="multi-kind" bind:value={multimodalKind}>
          <option value="image">image</option>
          <option value="audio_tts">audio TTS</option>
          <option value="audio_stt">audio STT</option>
          <option value="vision">vision</option>
        </select>
      </div>
      <div class="field">
        <label for="multi-provider">Provider</label>
        <select id="multi-provider" bind:value={multimodalProvider}>
          <option value="">auto</option>
          {#each providerOptions as provider}
            <option value={provider}>{provider}</option>
          {/each}
        </select>
      </div>
      <div class="field wide">
        <label for="multi-prompt">Prompt</label>
        <textarea id="multi-prompt" bind:value={multimodalPrompt} rows="3"></textarea>
      </div>
      <div class="field wide">
        <label for="multi-text">Text</label>
        <textarea id="multi-text" bind:value={multimodalText} rows="3"></textarea>
      </div>
      <div class="field wide">
        <label for="image-base64">Image base64</label>
        <textarea id="image-base64" bind:value={imageBase64} rows="2"></textarea>
      </div>
      <div class="field wide">
        <label for="audio-base64">Audio base64</label>
        <textarea id="audio-base64" bind:value={audioBase64} rows="2"></textarea>
      </div>
    </div>
    <button class="button primary" type="button" disabled={multimodalBusy} on:click={invokeMedia}>
      <Play size={17} />
      <span>Invoke</span>
    </button>
    <pre>{multimodalResult}</pre>
    <div class="asset-list">
      {#each generationAssets.slice(0, 6) as asset}
        <article class="asset-row">
          <div>
            <strong>{asset.kind}</strong>
            <span>{asset.provider}</span>
          </div>
          <small>{asset.asset_path ?? asset.content_type ?? 'metadata only'}</small>
        </article>
      {:else}
        <p class="muted">No generation assets yet.</p>
      {/each}
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
            <button class="icon-button" type="button" title="Toggle" aria-label={`Toggle ${unit.label}`} on:click={() => toggleUnit(unit)}>
              {#if unit.enabled}
                <ToggleRight size={18} />
              {:else}
                <ToggleLeft size={18} />
              {/if}
            </button>
            <button class="icon-button" type="button" title="Run" aria-label={`Run ${unit.label}`} on:click={() => runUnit(unit)}>
              <Play size={16} />
            </button>
          </div>
        </article>
      {:else}
        <p class="muted">No ambient units registered.</p>
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
        <tr><td colspan="5" class="muted">No calls logged yet.</td></tr>
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
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px;
    margin-bottom: 14px;
  }

  .metric {
    display: grid;
    gap: 6px;
    min-height: 104px;
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
    font-size: 23px;
    line-height: 1;
  }

  .metric small {
    color: var(--muted);
  }

  .top-grid,
  .work-grid {
    margin-bottom: 14px;
  }

  .section-title {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
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
    min-height: 116px;
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
  .provider-row small,
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
    min-height: 170px;
    max-height: 360px;
    overflow: auto;
    margin: 0;
    padding: 12px;
    border-radius: 6px;
    background: var(--text);
    color: var(--bg);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .job-row {
    grid-template-columns: minmax(0, 1fr) minmax(120px, 220px) auto;
    align-items: center;
  }

  .call-row {
    grid-template-columns: minmax(0, 1fr) auto;
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

  @media (max-width: 1100px) {
    .metric-grid,
    .foundation-grid,
    :global(.grid.two),
    .patch-list {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 760px) {
    .metric-grid,
    .foundation-grid,
    :global(.grid.two),
    .control-grid,
    .patch-list,
    .job-row,
    .ambient-row {
      grid-template-columns: 1fr;
    }
  }
</style>
