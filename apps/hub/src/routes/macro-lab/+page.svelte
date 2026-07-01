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
  import { compactServiceIssueIfRecognized, isLikelyServiceIssue } from '$lib/service-issues';

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
  $: engineState = status ? (status.engine.panic ? 'panic' : status.ok ? 'ready' : 'check') : loading ? 'checking' : 'connect service';
  $: triggerState = status ? (status.triggers.enabled === true ? 'on' : 'off') : loading ? 'checking' : 'connect service';
  $: databaseState = status ? (status.integrity.ok === true ? 'ok' : 'check') : loading ? 'checking' : 'connect service';
  $: serviceDetail = status
    ? `${status.version} at ${getMacroLabApiUrl()}`
    : loading
      ? `Checking ${getMacroLabApiUrl()}`
      : serviceError
        ? 'See the Macro Lab service card above.'
        : `Target: ${getMacroLabApiUrl()}`;
  $: macroServiceReady = Boolean(status && !serviceError);
  $: macroStateKnown = macroServiceReady;
  $: macroControlTitle = macroDisabledReason({ loading, busy, serviceError, status });
  $: macroControlDisabled = Boolean(macroControlTitle);
  $: macroRefreshBlockedReason = macroRefreshDisabledReason({ loading, busy });
  $: visibleServiceError = serviceError ? compactServiceIssueIfRecognized(serviceError, 'Macro Lab') : '';
  $: visibleActionError = actionError ? compactServiceIssueIfRecognized(actionError, 'Macro Lab action') : '';

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
    if (state.serviceError) return `Macro Lab service is unavailable: ${compactServiceIssueIfRecognized(state.serviceError, 'Macro Lab')}`;
    if (!state.status) return 'Connect Macro Lab before changing macros, triggers, recorder, panic, or run state.';
    return '';
  }

  function macroRefreshDisabledReason(state: { loading: boolean; busy: boolean }): string {
    if (state.loading) return 'Macro Lab is already loading the latest state.';
    if (state.busy) return 'Wait for the current Macro Lab action before refreshing.';
    return '';
  }

  function macroCapabilitiesDetail(): string {
    if (status) return `${status.engine.action_count} action type${status.engine.action_count === 1 ? '' : 's'}`;
    if (loading) return 'Checking action catalog and capability state.';
    if (serviceError) return 'Capability state will reload after the Macro Lab service card reconnects.';
    return 'Service status above controls action catalog availability.';
  }

  function macroTriggersDetail(): string {
    if (status) return `${status.engine.running} running automation${status.engine.running === 1 ? '' : 's'}`;
    if (loading) return 'Checking trigger and running automation state.';
    if (serviceError) return 'Trigger state will reload after the Macro Lab service card reconnects.';
    return 'Service status above controls trigger visibility.';
  }

  function macroDatabaseDetail(): string {
    if (status) return 'Macro definitions and run history are reachable.';
    if (loading) return 'Checking macro definitions and run history.';
    if (serviceError) return 'Saved definitions and run history will reload after the Macro Lab service card reconnects.';
    return 'Service status above controls saved definition visibility.';
  }

  function macroEditorEmptyDetail(): string {
    if (loading && !macros.length) return 'Checking macro definitions before enabling edit and run controls.';
    if (serviceError) return 'Saved macro definitions will reload after the Macro Lab service card reconnects.';
    return 'Create or select a macro to edit JSON, dry-run it, run confirmed actions, or reload triggers.';
  }

  function macroDefinitionsEmptyMessage(): string {
    if (loading && !macros.length) return 'Checking saved macro definitions.';
    if (serviceError) return 'Saved macro definitions will reload after the Macro Lab service card reconnects.';
    if (!status) return 'Connect Macro Lab to load saved macro definitions before creating or editing macros.';
    return 'No macros are registered yet. Use the New macro button above, then save the definition through Macro Lab.';
  }

  function macroActionCatalogEmptyMessage(): string {
    if (loading && !actions.length) return 'Checking action catalog.';
    if (serviceError) return 'Action catalog will reload after the Macro Lab service card reconnects.';
    if (!status) return 'Connect Macro Lab to inspect available action types.';
    if (status.engine.action_count === 0) return 'Macro Lab is reachable, but its action catalog is empty; check the desktop service install.';
    return 'No action types were returned by Macro Lab. Refresh the desktop service state.';
  }

  function macroRunHistoryEmptyMessage(): string {
    if (loading && !runs.length) return 'Checking recent Macro Lab runs.';
    if (serviceError) return 'Run history will reload after the Macro Lab service card reconnects.';
    if (!status) return 'Connect Macro Lab to load desktop automation run history.';
    if (highlightedRunId) return `Activity run ${highlightedRunId} is not in Macro Lab's current run history. Refresh or open Activity for the durable record.`;
    return 'No macro runs have been recorded yet. Dry runs and confirmed runs will appear here after they finish.';
  }

  function macroEditorBlockedTitle(action: string): string {
    const reason = macroDisabledReason();
    if (reason) return reason;
    return `Select or create a macro before using ${action}.`;
  }

  function macroEditorTextareaTitle(macro: MacroDefinition | undefined = selectedMacro): string {
    const reason = macroDisabledReason();
    if (reason) return reason;
    if (!macro) return 'Select or create a macro before editing its JSON definition.';
    return `Edit ${macro.name} JSON locally, then Save to persist it through Macro Lab.`;
  }

  function macroActionTitle(
    action: 'panic' | 'reset' | 'new' | 'toggle-enabled' | 'toggle-armed' | 'save' | 'dry-run' | 'run-confirmed' | 'reload' | 'record' | 'stop-record',
    macro: MacroDefinition | undefined = selectedMacro
  ): string {
    if (macroControlTitle) return macroControlTitle;
    const name = macro?.name ?? 'the selected macro';
    if (action === 'panic') return 'Trigger Macro Lab panic: stop running automations and disable triggers until reset.';
    if (action === 'reset') return 'Clear Macro Lab panic state so enabled triggers can run again.';
    if (action === 'new') return 'Create and save a new scratch macro definition in Macro Lab.';
    if (action === 'toggle-enabled') {
      return macro?.enabled
        ? `Disable ${name}; saved triggers stop launching it until it is enabled again.`
        : `Enable ${name}; saved triggers may launch it when Macro Lab triggers are active.`;
    }
    if (action === 'toggle-armed') {
      return macro?.armed
        ? `Disarm ${name}; system-level actions require arming again before confirmed runs.`
        : `Arm ${name}; confirmed runs may execute system-level actions after the confirmation prompt.`;
    }
    if (action === 'save') return 'Save the edited macro JSON through Macro Lab; invalid JSON or action config will be rejected.';
    if (action === 'dry-run') return `Run ${name} in dry-run mode; Macro Lab should log a preview without desktop side effects.`;
    if (action === 'run-confirmed') {
      return `Ask for confirmation before running ${name} with real desktop side effects; run history records the result.`;
    }
    if (action === 'reload') return 'Reload Macro Lab triggers from saved macro definitions without running a macro body.';
    if (action === 'record') return 'Ask for confirmation before capturing keyboard and mouse input; Stop ends the recorder.';
    return 'Stop the current keyboard and mouse recorder and reload Macro Lab state.';
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
    return isLikelyServiceIssue(message);
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
    if (kind === 'record' && !window.confirm('Start Macro Lab recording? Keyboard and mouse events will be captured until you press Stop.')) {
      actionError = 'Macro recording skipped.';
      return;
    }
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
    <button class="button danger" type="button" disabled={macroControlDisabled} title={macroActionTitle('panic')} on:click={() => callControl('panic')}><AlertTriangle size={16} />Panic</button>
    <button class="button" type="button" disabled={macroControlDisabled} title={macroActionTitle('reset')} on:click={() => callControl('reset')}><Power size={16} />Reset</button>
  </div>
</div>

{#if serviceError}
  <section class="card card-pad connection-card service-card">
    <div>
      <strong>Macro Lab connection failed</strong>
      <span>{getMacroLabApiUrl()}</span>
      <p title={`Raw Macro Lab service error: ${serviceError}`}>{visibleServiceError}</p>
      <p>{localNetworkHint()}</p>
    </div>
    <a class="button" href={hubHref('/settings#feature-wiring')} title="Open Settings Feature Wiring for Macro Lab endpoint setup.">Open Settings</a>
  </section>
{/if}
{#if actionError}
  <div class="notice error" title={`Raw Macro Lab action error: ${actionError}`}>{visibleActionError}</div>
{/if}

<section class="status-strip">
  <div class="metric">
    <span>Engine</span>
    <strong class:bad={engineState === 'panic'} class:warn={engineState === 'connect service' || engineState === 'checking' || engineState === 'check'}>{engineState}</strong>
    <small>{serviceDetail}</small>
  </div>
  <div class="metric">
    <span>Capabilities</span>
    <strong>{status ? `${capabilityReady}/${status.capabilities.length}` : loading ? 'checking' : 'connect service'}</strong>
    <small>{macroCapabilitiesDetail()}</small>
  </div>
  <div class="metric">
    <span>Triggers</span>
    <strong class:warn={triggerState === 'connect service' || triggerState === 'checking'}>{triggerState}</strong>
    <small>{macroTriggersDetail()}</small>
  </div>
  <div class="metric">
    <span>Database</span>
    <strong class:warn={databaseState === 'connect service' || databaseState === 'checking' || databaseState === 'check'}>{databaseState}</strong>
    <small>{macroDatabaseDetail()}</small>
  </div>
</section>

<section class="workspace">
  <aside class="macro-list card">
    <div class="panel-head">
      <strong>Macros</strong>
      <button class="icon-button" type="button" disabled={macroControlDisabled} title={macroActionTitle('new')} on:click={newMacro} aria-label="New macro"><Wrench size={16} /></button>
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
    {#if !macros.length}
      <p class="empty-note">{macroDefinitionsEmptyMessage()}</p>
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
          <button class="button" type="button" disabled={macroControlDisabled} title={macroActionTitle('toggle-enabled', selectedMacro)} on:click={() => toggleSelected('enabled')}>
            {#if selectedMacro.enabled}<ToggleRight size={16} />Enabled{:else}<ToggleLeft size={16} />Disabled{/if}
          </button>
          <button class:selected={selectedMacro.armed} class="button" type="button" disabled={macroControlDisabled} title={macroActionTitle('toggle-armed', selectedMacro)} on:click={() => toggleSelected('armed')}>
            <Shield size={16} />{selectedMacro.armed ? 'Armed' : 'Safe'}
          </button>
        </div>
      </div>
      <textarea bind:value={editor} disabled={macroControlDisabled} spellcheck="false" title={macroEditorTextareaTitle(selectedMacro)}></textarea>
      <div class="action-row">
        <button class="button primary" type="button" disabled={macroControlDisabled} title={macroActionTitle('save', selectedMacro)} on:click={saveSelected}><Save size={16} />Save</button>
        <button class="button" type="button" disabled={macroControlDisabled} title={macroActionTitle('dry-run', selectedMacro)} on:click={() => runSelected(true)}><Play size={16} />Dry Run</button>
        <button class="button danger" type="button" disabled={macroControlDisabled} title={macroActionTitle('run-confirmed', selectedMacro)} on:click={() => runSelected(false, true)}><Play size={16} />Run Confirmed</button>
        <button class="button" type="button" disabled={macroControlDisabled} title={macroActionTitle('reload')} on:click={() => callControl('reload')}><RefreshCw size={16} />Reload Triggers</button>
      </div>
    {:else}
      <div class="empty-panel">
        <Keyboard size={20} />
        <strong>{loading ? 'Checking macro editor' : 'No macro selected'}</strong>
        <p>{macroEditorEmptyDetail()}</p>
        <div class="action-row">
          <button class="button primary" type="button" disabled title={macroEditorBlockedTitle('save')}><Save size={16} />Save</button>
          <button class="button" type="button" disabled title={macroEditorBlockedTitle('dry run')}><Play size={16} />Dry Run</button>
          <button class="button danger" type="button" disabled title={macroEditorBlockedTitle('confirmed run')}><Play size={16} />Run Confirmed</button>
          <button class="button" type="button" disabled title={macroEditorBlockedTitle('trigger reload')}><RefreshCw size={16} />Reload Triggers</button>
        </div>
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
      {#if !actions.length}
        <p class="empty-note">{macroActionCatalogEmptyMessage()}</p>
      {/if}
    </div>
  </div>

  <div class="card card-pad">
    <div class="panel-head">
      <strong>Recorder</strong>
      <Clipboard size={17} />
    </div>
    <div class="action-row">
      <button class="button" type="button" disabled={macroControlDisabled} title={macroActionTitle('record')} on:click={() => callControl('record')}><Keyboard size={16} />Record</button>
      <button class="button" type="button" disabled={macroControlDisabled} title={macroActionTitle('stop-record')} on:click={() => callControl('stop-record')}><Square size={16} />Stop</button>
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
    {#if !runs.length}
      <p class="empty-note">{macroRunHistoryEmptyMessage()}</p>
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
