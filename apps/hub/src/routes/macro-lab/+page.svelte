<script lang="ts">
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import {
    AlertTriangle,
    Clipboard,
    Keyboard,
    Play,
    Power,
    RefreshCw,
    Save,
    Shield,
    Square,
    ToggleLeft,
    ToggleRight,
    Wrench
  } from 'lucide-svelte';
  import { hubHref } from '$lib/routes';
  import { localNetworkHint } from '$lib/service-config';
  import {
    createMacro,
    getMacroLabApiUrl,
    getMacroStatus,
    listMacroActions,
    listMacroRuns,
    listMacros,
    panicMacroLab,
    patchMacro,
    reloadMacroTriggers,
    resetMacroPanic,
    runMacro,
    saveMacro,
    startRecording,
    stopRecording,
    type ActionSpec,
    type MacroDefinition,
    type MacroRun,
    type MacroStatus
  } from '$lib/macro-lab-api';

  let status: MacroStatus | null = null;
  let actions: ActionSpec[] = [];
  let macros: MacroDefinition[] = [];
  let runs: MacroRun[] = [];
  let selectedId = '';
  let editor = '';
  let result = '';
  let serviceError = '';
  let actionError = '';
  let loading = false;
  let busy = false;

  $: selectedMacro = macros.find((macro) => macro.id === selectedId) ?? macros[0];
  $: capabilityReady = status?.capabilities.filter((capability) => capability.available).length ?? 0;
  $: highlightedRunId = $page.url.searchParams.get('run') ?? '';
  $: engineState = status ? (status.engine.panic ? 'panic' : status.ok ? 'ready' : 'check') : loading ? 'loading' : 'unknown';
  $: triggerState = status ? (status.triggers.enabled === true ? 'on' : 'off') : loading ? 'loading' : 'unknown';
  $: databaseState = status ? (status.integrity.ok === true ? 'ok' : 'check') : loading ? 'loading' : 'unknown';
  $: serviceDetail = status ? `${status.version} at ${getMacroLabApiUrl()}` : `Target: ${getMacroLabApiUrl()}`;
  $: macroServiceReady = Boolean(status && !serviceError);
  $: macroStateKnown = macroServiceReady;
  $: macroControlTitle = macroDisabledReason({ loading, busy, serviceError, status });
  $: macroControlDisabled = Boolean(macroControlTitle);
  $: macroRefreshBlockedReason = macroRefreshDisabledReason({ loading, busy });

  onMount(() => {
    void refresh();
  });

  function stringify(value: unknown): string {
    return JSON.stringify(value, null, 2);
  }

  function selectMacro(macro: MacroDefinition): void {
    selectedId = macro.id;
    editor = stringify(macro);
  }

  function macroRowTitle(macro: MacroDefinition): string {
    return selectedMacro?.id === macro.id ? `${macro.name} is selected.` : `Open ${macro.name} in the Macro Lab editor.`;
  }

  function macroDisabledReason(
    state: { loading: boolean; busy: boolean; serviceError: string; status: MacroStatus | null } = { loading, busy, serviceError, status }
  ): string {
    if (state.loading) return 'Macro Lab is loading the latest desktop automation state.';
    if (state.busy) return 'Another Macro Lab action is already running.';
    if (state.serviceError) return `Macro Lab service is unavailable: ${state.serviceError}`;
    if (!state.status) return 'Connect Macro Lab before changing macros, triggers, recorder, panic, or run state.';
    return '';
  }

  function macroRefreshDisabledReason(state: { loading: boolean; busy: boolean }): string {
    if (state.loading) return 'Macro Lab is already loading the latest state.';
    if (state.busy) return 'Wait for the current Macro Lab action before refreshing.';
    return '';
  }

  function requireMacroReady(action: string): boolean {
    const reason = macroDisabledReason();
    if (!reason) return true;
    actionError = `${action} unavailable: ${reason}`;
    return false;
  }

  function confirmMacroSideEffectRun(macro: MacroDefinition): boolean {
    const state = macro.armed ? 'armed' : 'not armed';
    const ok = window.confirm(
      `Run "${macro.name}" with real desktop side effects? This macro is ${state}. Use Dry Run first if you only want a safe preview.`
    );
    if (!ok) actionError = 'Confirmed macro run skipped.';
    return ok;
  }

  function macroConnectionError(message: string): boolean {
    return /(?:Failed to fetch|CORS|mixed-content|network|offline|unavailable|ECONNREFUSED|connection refused|timed out|timeout|Not Found)/iu.test(message);
  }

  function recordMacroActionError(caught: unknown, fallback: string): void {
    const message = caught instanceof Error ? caught.message : fallback;
    actionError = message;
    if (macroConnectionError(message)) {
      serviceError = message;
      actionError = '';
    }
  }

  async function refresh(): Promise<void> {
    loading = true;
    serviceError = '';
    actionError = '';
    try {
      [status, actions, macros, runs] = await Promise.all([getMacroStatus(), listMacroActions(), listMacros(), listMacroRuns(30)]);
      if (!selectedId && macros[0]) selectMacro(macros[0]);
      else if (selectedMacro) editor = stringify(selectedMacro);
    } catch (caught) {
      serviceError = caught instanceof Error ? caught.message : 'Failed to load Macro Lab.';
    } finally {
      loading = false;
    }
  }

  async function saveSelected(): Promise<void> {
    if (!requireMacroReady('Save macro')) return;
    busy = true;
    actionError = '';
    try {
      const parsed = JSON.parse(editor) as MacroDefinition;
      const saved = await saveMacro(parsed);
      result = stringify({ saved: saved.id, updated_at: saved.updated_at });
      await refresh();
      selectMacro(saved);
    } catch (caught) {
      recordMacroActionError(caught, 'Save failed.');
    } finally {
      busy = false;
    }
  }

  async function newMacro(): Promise<void> {
    if (!requireMacroReady('Create macro')) return;
    busy = true;
    actionError = '';
    try {
      const id = `macro_${Date.now().toString(36)}`;
      const macro: MacroDefinition = {
        id,
        name: 'New Macro',
        group: 'Scratch',
        enabled: true,
        armed: false,
        dry_run_default: true,
        variables: {},
        actions: [{ id: `action_${Date.now().toString(36)}`, type: 'shell.run', label: 'Echo', enabled: true, config: { command: 'echo hello' } }],
        triggers: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      const created = await createMacro(macro);
      result = stringify({ created: created.id });
      await refresh();
      selectMacro(created);
    } catch (caught) {
      recordMacroActionError(caught, 'Create failed.');
    } finally {
      busy = false;
    }
  }

  async function toggleSelected(field: 'enabled' | 'armed'): Promise<void> {
    if (!selectedMacro) return;
    if (!requireMacroReady('Toggle macro')) return;
    busy = true;
    actionError = '';
    try {
      const saved = await patchMacro(selectedMacro.id, { [field]: !selectedMacro[field] } as Partial<MacroDefinition>);
      result = stringify({ [field]: saved[field] });
      await refresh();
      selectMacro(saved);
    } catch (caught) {
      recordMacroActionError(caught, 'Toggle failed.');
    } finally {
      busy = false;
    }
  }

  async function runSelected(dryRun: boolean, confirm = false): Promise<void> {
    if (!selectedMacro) return;
    if (!requireMacroReady(dryRun ? 'Dry run macro' : 'Run macro')) return;
    if (!dryRun && confirm && !confirmMacroSideEffectRun(selectedMacro)) return;
    busy = true;
    actionError = '';
    try {
      const run = await runMacro(selectedMacro.id, dryRun, confirm);
      result = stringify(run);
      runs = await listMacroRuns(30);
      status = await getMacroStatus();
    } catch (caught) {
      recordMacroActionError(caught, 'Run failed.');
    } finally {
      busy = false;
    }
  }

  async function callControl(kind: 'panic' | 'reset' | 'reload' | 'record' | 'stop-record'): Promise<void> {
    if (!requireMacroReady(`Macro ${kind}`)) return;
    busy = true;
    actionError = '';
    try {
      const value =
        kind === 'panic'
          ? await panicMacroLab()
          : kind === 'reset'
            ? await resetMacroPanic()
            : kind === 'reload'
              ? await reloadMacroTriggers()
              : kind === 'record'
                ? await startRecording()
                : await stopRecording();
      result = stringify(value);
      await refresh();
    } catch (caught) {
      recordMacroActionError(caught, `${kind} failed.`);
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head>
  <title>Macro Lab - Mini Hub</title>
</svelte:head>

<div class="page-header">
  <div>
    <p class="eyebrow">Local desktop automation</p>
    <h1>Macro Lab</h1>
  </div>
  <div class="action-row">
    <button class="button" type="button" disabled={Boolean(macroRefreshBlockedReason)} title={macroRefreshBlockedReason || 'Reload Macro Lab state from the desktop service.'} on:click={refresh}><RefreshCw size={16} />Refresh</button>
    <button class="button danger" type="button" disabled={macroControlDisabled} title={macroControlTitle || 'Stop all running automations and disable triggers.'} on:click={() => callControl('panic')}><AlertTriangle size={16} />Panic</button>
    <button class="button" type="button" disabled={macroControlDisabled} title={macroControlTitle || 'Reset the Macro Lab panic state.'} on:click={() => callControl('reset')}><Power size={16} />Reset</button>
  </div>
</div>

{#if serviceError}
  <section class="card card-pad connection-card service-card">
    <div>
      <strong>Macro Lab connection failed</strong>
      <span>{getMacroLabApiUrl()}</span>
      <p>{serviceError}</p>
      <p>{localNetworkHint()}</p>
    </div>
    <a class="button" href={hubHref('/settings#feature-wiring')}>Open Settings</a>
  </section>
{/if}
{#if actionError}
  <div class="notice error">{actionError}</div>
{/if}

<section class="status-strip">
  <div class="metric">
    <span>Engine</span>
    <strong class:bad={engineState === 'panic'} class:warn={engineState === 'unknown' || engineState === 'loading' || engineState === 'check'}>{engineState}</strong>
    <small>{serviceDetail}</small>
  </div>
  <div class="metric">
    <span>Capabilities</span>
    <strong>{status ? `${capabilityReady}/${status.capabilities.length}` : loading ? 'loading' : 'unknown'}</strong>
    <small>{status ? `${status.engine.action_count} action type${status.engine.action_count === 1 ? '' : 's'}` : 'Start Macro Lab, then refresh.'}</small>
  </div>
  <div class="metric">
    <span>Triggers</span>
    <strong class:warn={triggerState === 'unknown' || triggerState === 'loading'}>{triggerState}</strong>
    <small>{status ? `${status.engine.running} running automation${status.engine.running === 1 ? '' : 's'}` : 'Reload state is not known yet.'}</small>
  </div>
  <div class="metric">
    <span>Database</span>
    <strong class:warn={databaseState === 'unknown' || databaseState === 'loading' || databaseState === 'check'}>{databaseState}</strong>
    <small>{status ? 'Macro definitions and run history are reachable.' : 'Run history will appear after connection.'}</small>
  </div>
</section>

<section class="workspace">
  <aside class="macro-list card">
    <div class="panel-head">
      <strong>Macros</strong>
      <button class="icon-button" type="button" disabled={macroControlDisabled} title={macroControlTitle || 'Create a new macro.'} on:click={newMacro} aria-label="New macro"><Wrench size={16} /></button>
    </div>
    {#each macros as macro}
      <button class:active={selectedMacro?.id === macro.id} class="macro-row" type="button" title={macroRowTitle(macro)} on:click={() => selectMacro(macro)}>
        <span>
          <strong>{macro.name}</strong>
          <small>{macro.group}</small>
        </span>
        {#if macro.armed}<Shield size={15} />{/if}
      </button>
    {/each}
    {#if loading && !macros.length}
      <p class="empty-note">Loading macro definitions from Macro Lab...</p>
    {:else if !macros.length}
      <p class="empty-note">{serviceError ? 'Macro definitions are unavailable until the service responds.' : 'No macros are registered yet. Create one with the plus button.'}</p>
    {/if}
  </aside>

  <main class="editor card">
    {#if selectedMacro}
      <div class="panel-head">
        <div>
          <strong>{selectedMacro.name}</strong>
          <span class="muted"> {selectedMacro.id}</span>
        </div>
        <div class="action-row compact">
          <button class="button" type="button" disabled={macroControlDisabled} title={macroControlTitle || 'Toggle whether this macro can run.'} on:click={() => toggleSelected('enabled')}>
            {#if selectedMacro.enabled}<ToggleRight size={16} />Enabled{:else}<ToggleLeft size={16} />Disabled{/if}
          </button>
          <button class:selected={selectedMacro.armed} class="button" type="button" disabled={macroControlDisabled} title={macroControlTitle || 'Toggle the explicit armed state for system-level actions.'} on:click={() => toggleSelected('armed')}>
            <Shield size={16} />{selectedMacro.armed ? 'Armed' : 'Safe'}
          </button>
        </div>
      </div>
      <textarea bind:value={editor} spellcheck="false"></textarea>
      <div class="action-row">
        <button class="button primary" type="button" disabled={macroControlDisabled} title={macroControlTitle || 'Save the selected macro definition.'} on:click={saveSelected}><Save size={16} />Save</button>
        <button class="button" type="button" disabled={macroControlDisabled} title={macroControlTitle || 'Run this macro without side effects.'} on:click={() => runSelected(true)}><Play size={16} />Dry Run</button>
        <button class="button danger" type="button" disabled={macroControlDisabled} title={macroControlTitle || 'Ask for confirmation before running this macro with real desktop side effects.'} on:click={() => runSelected(false, true)}><Play size={16} />Run Confirmed</button>
        <button class="button" type="button" disabled={macroControlDisabled} title={macroControlTitle || 'Reload Macro Lab triggers from saved definitions.'} on:click={() => callControl('reload')}><RefreshCw size={16} />Reload Triggers</button>
      </div>
    {:else}
      <div class="empty-panel">
        <Keyboard size={20} />
        <strong>{loading ? 'Loading macro editor' : 'No macro selected'}</strong>
        <p>{serviceError ? 'Connect the Macro Lab service to edit and run macros.' : 'Create or select a macro to edit JSON, dry-run it, run confirmed actions, or reload triggers.'}</p>
      </div>
    {/if}
  </main>
</section>

<section class="grid two lower">
  <div class="card card-pad">
    <div class="panel-head">
      <strong>Action Catalog</strong>
      <Keyboard size={17} />
    </div>
    <div class="catalog">
      {#each actions as action}
        <div>
          <strong>{action.type}</strong>
          <span class:safe={action.safety === 'safe'} class:warn={action.safety !== 'safe'}>{action.safety}</span>
          <small>{action.description}</small>
        </div>
      {/each}
      {#if loading && !actions.length}
        <p class="empty-note">Loading action catalog...</p>
      {:else if !actions.length}
        <p class="empty-note">{serviceError ? 'Action catalog unavailable until Macro Lab responds.' : 'No action types are registered yet.'}</p>
      {/if}
    </div>
  </div>

  <div class="card card-pad">
    <div class="panel-head">
      <strong>Recorder</strong>
      <Clipboard size={17} />
    </div>
    <div class="action-row">
      <button class="button" type="button" disabled={macroControlDisabled} title={macroControlTitle || 'Record keyboard and mouse input.'} on:click={() => callControl('record')}><Keyboard size={16} />Record</button>
      <button class="button" type="button" disabled={macroControlDisabled} title={macroControlTitle || 'Stop the current recorder.'} on:click={() => callControl('stop-record')}><Square size={16} />Stop</button>
    </div>
    {#if result}
      <pre>{result}</pre>
    {/if}
  </div>
</section>

<section class="card card-pad runs">
  <div class="panel-head">
    <strong>Run History</strong>
    <span>{highlightedRunId ? `Activity: ${highlightedRunId}` : `${runs.length}`}</span>
  </div>
  <div class="run-table">
    {#each runs as run}
      <div class:selected={run.id === highlightedRunId}>
        <strong>{run.macro_name}</strong>
        <span class:ok={run.status === 'succeeded' || run.status === 'dry_run'} class:bad={run.status === 'failed'}>{run.status}</span>
        <small>{run.started_at}</small>
      </div>
    {/each}
    {#if loading && !runs.length}
      <p class="empty-note">Loading recent Macro Lab runs...</p>
    {:else if !runs.length}
      <p class="empty-note">{serviceError ? 'Run history is unavailable until Macro Lab responds.' : 'No macro runs have been recorded yet.'}</p>
    {:else if highlightedRunId && !runs.some((run) => run.id === highlightedRunId)}
      <p class="empty-note">The linked Activity run is not in the latest {runs.length} Macro Lab runs. Refresh or open Activity for the durable record.</p>
    {/if}
  </div>
</section>

<style>
  .status-strip {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px;
    margin-bottom: 14px;
  }

  .metric {
    display: grid;
    gap: 5px;
    padding: 14px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
  }

  .metric span {
    color: var(--muted);
    font-size: 12px;
    font-weight: 800;
    text-transform: uppercase;
  }

  .metric strong {
    font-size: 18px;
  }

  .metric small {
    color: var(--muted);
    line-height: 1.35;
  }

  .workspace {
    display: grid;
    grid-template-columns: minmax(220px, 300px) minmax(0, 1fr);
    gap: 14px;
  }

  .panel-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 14px;
    border-bottom: 1px solid var(--border);
  }

  .macro-list {
    overflow: hidden;
  }

  .macro-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    gap: 10px;
    padding: 12px 14px;
    border: 0;
    border-bottom: 1px solid var(--border);
    color: var(--text);
    background: transparent;
    text-align: left;
    cursor: pointer;
  }

  .macro-row.active,
  .macro-row:hover {
    background: var(--active);
  }

  .macro-row span {
    display: grid;
    gap: 3px;
  }

  small {
    color: var(--muted);
  }

  .empty-note {
    margin: 0;
    padding: 12px 14px;
    color: var(--muted);
    line-height: 1.45;
  }

  .empty-panel {
    display: grid;
    gap: 8px;
    min-height: 260px;
    place-content: center;
    justify-items: center;
    padding: 24px;
    color: var(--muted);
    text-align: center;
  }

  .empty-panel strong {
    color: var(--text);
  }

  .empty-panel p {
    max-width: 420px;
    margin: 0;
    line-height: 1.45;
  }

  .editor {
    min-width: 0;
    overflow: hidden;
  }

  textarea {
    width: 100%;
    min-height: 360px;
    padding: 14px;
    border: 0;
    border-bottom: 1px solid var(--border);
    background: var(--code-bg);
    color: var(--code-text);
    font-family: "Cascadia Code", Consolas, monospace;
    font-size: 13px;
    line-height: 1.5;
    resize: vertical;
  }

  .editor > .action-row {
    padding: 14px;
  }

  .compact {
    gap: 6px;
  }

  .button.selected {
    border-color: var(--warning-border);
    color: var(--warning-text);
    background: var(--warning-bg);
  }

  .button.danger {
    border-color: var(--danger-border);
    color: var(--danger-text);
    background: var(--danger-bg);
  }

  .notice {
    margin-bottom: 14px;
    padding: 12px 14px;
    border-radius: 8px;
    font-weight: 700;
  }

  .notice.error {
    border: 1px solid var(--danger-border);
    color: var(--danger-text);
    background: var(--danger-bg);
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

  .lower {
    margin-top: 14px;
  }

  .catalog,
  .run-table {
    display: grid;
    gap: 8px;
  }

  .catalog div,
  .run-table div {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 4px 10px;
    padding: 10px 0;
    border-bottom: 1px solid var(--border);
  }

  .run-table div.selected {
    border-color: var(--accent);
    border-radius: 6px;
    padding: 10px;
    background: var(--active);
  }

  .catalog small,
  .run-table small {
    grid-column: 1 / -1;
  }

  .safe,
  .ok {
    color: var(--success-text);
  }

  .warn {
    color: var(--warning-text);
  }

  .bad {
    color: var(--danger-text);
  }

  pre {
    max-height: 250px;
    overflow: auto;
    padding: 12px;
    border-radius: 7px;
    background: var(--code-bg);
    color: var(--code-text);
    font-size: 12px;
  }

  .icon-button {
    display: grid;
    width: 32px;
    height: 32px;
    place-items: center;
    border: 1px solid var(--border-strong);
    border-radius: 6px;
    background: var(--surface);
    cursor: pointer;
  }

  @media (max-width: 900px) {
    .status-strip,
    .workspace,
    .grid.two {
      grid-template-columns: 1fr;
    }

    .connection-card {
      align-items: stretch;
      flex-direction: column;
    }
  }
</style>
