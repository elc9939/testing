<script lang="ts">
  import { tick } from 'svelte';
  import { goto } from '$app/navigation';
  import { Bot, ChevronRight, Cpu, MessageCircle, PanelRightClose, PanelRightOpen, Search, Send, ShieldCheck, Sparkles } from 'lucide-svelte';
  import { clientData } from '$lib/client-data';
  import { chatWithMiniHubAssistant } from '$lib/assistant-api';
  import {
    compactCapabilityRegistryContext,
    formatCapabilityRegistrySummary,
    loadCapabilityRegistry,
    type CapabilityRegistrySnapshot
  } from '$lib/capability-registry';
  import { hubHref } from '$lib/routes';
  import { formatMachineModeContext, machineModeContext, machineModeFromPreferences } from '$lib/machine-mode';
  import { localNetworkHint } from '$lib/service-config';
  import { getConnections } from '$lib/productivity-api';
  import {
    getAiStatus,
    queryMemory,
    runCommand,
    runInference,
    type AiStatus
  } from '$lib/ai-os-api';
  import { assistantExplanation, resolveAssistantIntent, type AssistantIntent } from '$lib/assistant';

  type AssistantRole = 'assistant' | 'user' | 'system';
  type AssistantAction =
    | { id: string; label: string; kind: 'navigate'; route: string }
    | { id: string; label: string; kind: 'confirm-command'; objective: string }
    | { id: string; label: string; kind: 'retry'; objective: string };

  interface AssistantMessage {
    id: string;
    role: AssistantRole;
    text: string;
    actions?: AssistantAction[];
  }

  let open = false;
  let draft = '';
  let busy = false;
  let toolMode = false;
  let confirmActions = false;
  let aiStatus: AiStatus | null = null;
  let capabilitySnapshot: CapabilityRegistrySnapshot | null = null;
  let logElement: HTMLDivElement | null = null;
  let messages: AssistantMessage[] = [
    {
      id: newMessageId(),
      role: 'assistant',
      text: assistantExplanation('assistant'),
      actions: [
        { id: 'open-ai-os', label: 'Open AI OS', kind: 'navigate', route: '/ai-os' },
        { id: 'open-ai-lab', label: 'Open AI Lab', kind: 'navigate', route: '/ai-lab' }
      ]
    }
  ];

  const examples = ['What can this PC do?', 'Check AI status', 'Open Career Desk', 'Summarize my hub'];
  const featureWiringAction: AssistantAction = { id: 'open-feature-wiring', label: 'Open Feature Wiring', kind: 'navigate', route: '/settings#feature-wiring' };

  $: availableProviderCount = aiStatus?.providers.filter((provider) => provider.available).length ?? 0;
  $: providerCount = aiStatus?.providers.length ?? 0;
  $: capabilityReadyCount = capabilitySnapshot ? capabilitySnapshot.summary.ready + capabilitySnapshot.summary.running : 0;
  $: capabilityTotal = capabilitySnapshot?.summary.total ?? 0;
  $: currentMachineMode = machineModeFromPreferences($clientData.settings?.preferences);
  $: sendBlockedReason = assistantSendBlockedReason({ busy, draft });
  $: assistantToggleTitle = open ? 'Close AI assistant.' : 'Open AI assistant.';

  function newMessageId(): string {
    if (globalThis.crypto && 'randomUUID' in globalThis.crypto) return globalThis.crypto.randomUUID();
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  function addMessage(message: Omit<AssistantMessage, 'id'>): void {
    messages = [...messages, { id: newMessageId(), ...message }];
    void tick().then(scrollToBottom);
  }

  function scrollToBottom(): void {
    if (!logElement) return;
    logElement.scrollTop = logElement.scrollHeight;
  }

  function setExample(value: string): void {
    draft = value;
    open = true;
  }

  function exampleTitle(value: string): string {
    return draft === value ? 'This assistant example is already loaded.' : 'Load this example into the assistant message box.';
  }

  function assistantActionTitle(action: AssistantAction): string {
    if (busy) return 'Assistant is already working on the current request.';
    if (action.kind === 'navigate') return /^open\b/iu.test(action.label) ? `${action.label}.` : `Open ${action.label}.`;
    if (action.kind === 'confirm-command') return 'Run this assistant request with confirmed write/system actions enabled.';
    return 'Retry this assistant request.';
  }

  async function submit(): Promise<void> {
    const text = draft.trim();
    if (assistantSendBlockedReason({ busy, draft })) return;
    draft = '';
    addMessage({ role: 'user', text });
    await handleIntent(resolveAssistantIntent(text, toolMode), text, confirmActions);
  }

  function assistantSendBlockedReason(state: { busy: boolean; draft: string }): string {
    if (state.busy) return 'Assistant is already working on the current request.';
    if (!state.draft.trim()) return 'Type a message before sending.';
    return '';
  }

  async function handleAction(action: AssistantAction): Promise<void> {
    if (busy) return;
    if (action.kind === 'navigate') {
      await navigateTo(action.route, action.label);
      return;
    }
    if (action.kind === 'confirm-command') {
      addMessage({ role: 'system', text: 'Running the same request with write/system confirmation enabled.' });
      await runToolCommand(action.objective, true);
      return;
    }
    if (action.kind === 'retry') {
      await handleIntent(resolveAssistantIntent(action.objective, true), action.objective, confirmActions);
    }
  }

  async function handleIntent(intent: AssistantIntent, original: string, confirmed: boolean): Promise<void> {
    if (intent.kind === 'navigate') {
      await navigateTo(intent.route, intent.label);
      return;
    }

    if (intent.kind === 'explain') {
      const route = intent.topic === 'ai-lab' ? '/ai-lab' : intent.topic === 'ai-os' ? '/ai-os' : '';
      addMessage({
        role: 'assistant',
        text: assistantExplanation(intent.topic),
        actions: route ? [{ id: `open-${intent.topic}`, label: `Open ${intent.topic === 'ai-lab' ? 'AI Lab' : 'AI OS'}`, kind: 'navigate', route }] : []
      });
      return;
    }

    if (intent.kind === 'local-summary') {
      addMessage({ role: 'assistant', text: localHubSummary() });
      return;
    }

    if (intent.kind === 'capabilities') {
      await loadCapabilities();
      return;
    }

    if (intent.kind === 'status') {
      await loadAiStatus();
      return;
    }

    if (intent.kind === 'memory-search') {
      await searchMemory(intent.query || original);
      return;
    }

    if (intent.kind === 'command') {
      await runToolCommand(original, confirmed);
      return;
    }

    await chatWithAi(original);
  }

  async function navigateTo(route: string, label: string): Promise<void> {
    addMessage({ role: 'assistant', text: `Opening ${label}.` });
    await goto(hubHref(route));
  }

  async function loadAiStatus(): Promise<void> {
    busy = true;
    try {
      const mode = machineModeFromPreferences($clientData.settings?.preferences);
      aiStatus = await getAiStatus(mode.id);
      const providers = aiStatus.providers
        .filter((provider) => provider.available)
        .map((provider) => `${provider.label}${provider.models.length ? ` (${provider.models.slice(0, 2).join(', ')})` : ''}`);
      const writeTools = aiStatus.tools.filter((tool) => tool.requires_confirmation).length;
      addMessage({
        role: 'assistant',
        text: [
          `AI OS is reachable. Providers online: ${providers.length}/${aiStatus.providers.length}.`,
          providers.length ? `Available: ${providers.join('; ')}.` : 'No providers are reporting available right now.',
          `Tools registered: ${aiStatus.tools.length}. Confirmation-gated tools: ${writeTools}.`,
          `Hardware: CPU ${labelMetric(aiStatus.hardware.cpu_percent, '%')}, RAM ${labelMetric(aiStatus.hardware.memory_percent, '%')}, tokens/sec ${labelMetric(aiStatus.hardware.recent_tokens_per_second)}.`
        ].join('\n\n'),
        actions: [{ id: 'status-ai-os', label: 'Open AI OS', kind: 'navigate', route: '/ai-os' }]
      });
    } catch (error) {
      addMessage({
        role: 'assistant',
        text: `I could not reach AI OS, so tool/agent status is unavailable right now.\n\n${localNetworkHint()}\n\n${errorMessage(error)}`,
        actions: [
          featureWiringAction,
          { id: 'retry-status', label: 'Retry', kind: 'retry', objective: 'Check AI status' }
        ]
      });
    } finally {
      busy = false;
    }
  }

  async function loadCapabilities(): Promise<void> {
    busy = true;
    try {
      const snapshot = await refreshCapabilitySnapshot();
      addMessage({
        role: 'assistant',
        text: formatCapabilityRegistrySummary(snapshot),
        actions: [
          { id: 'open-today-capabilities', label: 'Open Today', kind: 'navigate', route: '/' },
          featureWiringAction
        ]
      });
    } catch (error) {
      addMessage({
        role: 'assistant',
        text: `I could not build the capability registry right now.\n\n${localNetworkHint()}\n\n${errorMessage(error)}`,
        actions: [
          featureWiringAction,
          { id: 'retry-capabilities', label: 'Retry', kind: 'retry', objective: 'What capabilities are available?' }
        ]
      });
    } finally {
      busy = false;
    }
  }

  async function searchMemory(query: string): Promise<void> {
    busy = true;
    try {
      const hits = await queryMemory({ query, limit: 5 });
      const lines = hits.map((hit, index) => {
        const title = typeof hit.title === 'string' && hit.title ? hit.title : `Hit ${index + 1}`;
        const text = typeof hit.text === 'string' ? hit.text.replace(/\s+/gu, ' ').slice(0, 220) : '';
        const score = typeof hit.score === 'number' ? hit.score.toFixed(3) : 'n/a';
        return `${index + 1}. ${title} (${score})\n${text}`;
      });
      addMessage({
        role: 'assistant',
        text: lines.length ? `Semantic memory results for "${query}":\n\n${lines.join('\n\n')}` : `No semantic memory hits for "${query}".`
      });
    } catch (error) {
      addMessage({
        role: 'assistant',
        text: `Memory search failed.\n\n${errorMessage(error)}`,
        actions: [featureWiringAction]
      });
    } finally {
      busy = false;
    }
  }

  async function runToolCommand(objective: string, confirmed: boolean): Promise<void> {
    busy = true;
    try {
      const registryContext = await optionalCapabilityContext();
      const response = await runCommand({
        objective,
        confirm_actions: confirmed,
        max_steps: 4,
        context: {
          source: 'assistant-popup',
          machine_mode: machineModeContext(currentMachineMode.id),
          capability_registry: registryContext
        }
      });
      const needsConfirmation = commandNeedsConfirmation(response);
      addMessage({
        role: 'assistant',
        text: formatCommandResponse(response, needsConfirmation),
        actions: needsConfirmation
          ? [{ id: 'confirm-command', label: 'Run with confirmation', kind: 'confirm-command', objective }]
          : [{ id: 'open-ai-os-calls', label: 'View tool log', kind: 'navigate', route: '/ai-os' }]
      });
    } catch (error) {
      addMessage({
        role: 'assistant',
        text: `AI OS command failed.\n\n${errorMessage(error)}`,
        actions: [
          featureWiringAction,
          { id: 'retry-command', label: 'Retry as tool command', kind: 'retry', objective }
        ]
      });
    } finally {
      busy = false;
    }
  }

  async function chatWithAi(input: string): Promise<void> {
    busy = true;
    try {
      const registryText = capabilitySnapshot ? `\n\nCurrent capability registry:\n${formatCapabilityRegistrySummary(capabilitySnapshot)}` : '';
      const modeText = `\n\nCurrent ${formatMachineModeContext(currentMachineMode)}`;
      const result = await runInference({
        prompt: [
          'You are the Mini Hub side assistant for a private personal productivity and AI OS app.',
          'Be concise and practical. Explain how to use the app, AI Lab, AI OS, Macro Lab, Career Desk, Study Desk, and Productivity Hub when relevant.',
          'Do not claim you performed an action unless a tool/action was actually invoked by the UI.',
          modeText,
          registryText,
          `User: ${input}`
        ].join('\n')
      });
      const text = typeof result.text === 'string' && result.text.trim() ? result.text.trim() : JSON.stringify(result, null, 2);
      addMessage({ role: 'assistant', text });
    } catch (error) {
      await chatWithMiniHubFallback(input, error);
    } finally {
      busy = false;
    }
  }

  async function chatWithMiniHubFallback(input: string, aiOsError: unknown): Promise<void> {
    try {
      const response = await chatWithMiniHubAssistant({
        message: input,
        context: {
          source: 'assistant-popup',
          localSummary: localHubSummary(),
          machineMode: machineModeContext(currentMachineMode.id),
          capabilitySummary: capabilitySnapshot ? formatCapabilityRegistrySummary(capabilitySnapshot) : '',
          aiOsUnavailable: errorMessage(aiOsError)
        }
      });
      addMessage({
        role: 'assistant',
        text: `${response.text}\n\nModel: ${response.model ?? response.provider} via Mini Hub API fallback.`
      });
    } catch (fallbackError) {
      addMessage({
        role: 'assistant',
        text: localAssistantFallback(input, aiOsError, fallbackError),
        actions: [featureWiringAction]
      });
    }
  }

  function localHubSummary(): string {
    const jobs = $clientData.jobs;
    const actions = $clientData.careerActions;
    const sessions = $clientData.studySessions;
    const openJobs = jobs.filter((job) => job.status.toLowerCase() !== 'closed' && job.status.toLowerCase() !== 'rejected');
    const upcomingActions = actions
      .filter((action) => !action.completedAt)
      .slice()
      .sort((a, b) => String(a.dueAt ?? a.updatedAt).localeCompare(String(b.dueAt ?? b.updatedAt)))
      .slice(0, 4);
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const studyMinutes = sessions
      .filter((session) => Date.parse(session.loggedAt) >= sevenDaysAgo)
      .reduce((total, session) => total + session.minutes, 0);
    const nextJobs = openJobs
      .filter((job) => job.nextActionAt)
      .slice()
      .sort((a, b) => String(a.nextActionAt).localeCompare(String(b.nextActionAt)))
      .slice(0, 4)
      .map((job) => `- ${job.company}: ${job.role}${job.nextActionAt ? ` (${dateLabel(job.nextActionAt)})` : ''}`);
    const nextActions = upcomingActions.map((action) => `- ${action.label}${action.dueAt ? ` (${dateLabel(action.dueAt)})` : ''}`);

    return [
      `Local hub cache: ${jobs.length} career rows, ${actions.length} career actions, ${sessions.length} study sessions.`,
      `Open career opportunities: ${openJobs.length}. Study logged in the last 7 days: ${studyMinutes} minutes.`,
      nextJobs.length ? `Next job follow-ups:\n${nextJobs.join('\n')}` : 'No dated job follow-ups are currently cached.',
      nextActions.length ? `Open actions:\n${nextActions.join('\n')}` : 'No open career actions are currently cached.'
    ].join('\n\n');
  }

  async function refreshCapabilitySnapshot(): Promise<CapabilityRegistrySnapshot> {
    const googleConnected = await loadGoogleConnected();
    capabilitySnapshot = await loadCapabilityRegistry({
      isOnline: $clientData.isOnline,
      syncStatus: $clientData.status,
      syncError: $clientData.error,
      googleConnected,
      machineMode: machineModeFromPreferences($clientData.settings?.preferences).id
    });
    return capabilitySnapshot;
  }

  async function optionalCapabilityContext(): Promise<ReturnType<typeof compactCapabilityRegistryContext> | null> {
    try {
      const snapshot = await refreshCapabilitySnapshot();
      return compactCapabilityRegistryContext(snapshot, 8);
    } catch {
      return capabilitySnapshot ? compactCapabilityRegistryContext(capabilitySnapshot, 8) : null;
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

  function labelMetric(value: number | undefined, suffix = ''): string {
    return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(1)}${suffix}` : 'n/a';
  }

  function dateLabel(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Unknown error';
  }

  function localAssistantFallback(input: string, aiOsError: unknown, fallbackError: unknown): string {
    const normalized = input.toLowerCase();
    const status = [
      `AI OS: ${errorMessage(aiOsError)}`,
      `Mini Hub/Ollama fallback: ${errorMessage(fallbackError)}`
    ].join('\n');

    if (/\b(ai lab|transformers|tree[- ]?sitter)\b/u.test(normalized)) {
      return `${assistantExplanation('ai-lab')}\n\nLive model chat is offline right now, but I can still route you around the app.\n\n${status}`;
    }

    if (/\b(ai os|ollama|model|provider|agent|memory|rag)\b/u.test(normalized)) {
      return `${assistantExplanation('ai-os')}\n\nThe heavy AI service is currently unreachable. The quickest local fix is to use the phone/desktop launcher so the API and AI OS services come up together.\n\n${localNetworkHint()}\n\n${status}`;
    }

    if (/\b(calendar|email|gmail|command center|homepage|today|deadline|event)\b/u.test(normalized)) {
      return [
        'The command center is being shaped around calendar-first attention: upcoming Google Calendar events and actual dated obligations should lead, while email belongs in a smaller important-mail side rail.',
        'I can still open the Productivity Hub, summarize cached career/study data, or explain the AI surfaces while live model chat is offline.',
        status
      ].join('\n\n');
    }

    return [
      'Live model chat is offline, but the local assistant shell is still working.',
      'I can open pages, explain AI Lab or AI OS, summarize cached hub data, and retry tool-backed commands once AI OS is reachable.',
      localNetworkHint(),
      status
    ].join('\n\n');
  }

  function commandNeedsConfirmation(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false;
    if (Array.isArray(value)) return value.some(commandNeedsConfirmation);
    const record = value as Record<string, unknown>;
    if (record.requires_confirmation === true) return true;
    return Object.values(record).some(commandNeedsConfirmation);
  }

  function formatCommandResponse(response: Record<string, unknown>, needsConfirmation: boolean): string {
    const result = response.result && typeof response.result === 'object' ? (response.result as Record<string, unknown>) : {};
    const output = typeof result.output === 'string' && result.output.trim() ? result.output.trim() : '';
    const status = typeof result.status === 'string' ? result.status : 'completed';
    const calls = Array.isArray(response.tool_calls) ? response.tool_calls.length : 0;
    if (needsConfirmation) {
      return [
        'AI OS understood the request, but a write/system tool needs explicit confirmation.',
        output || 'Use the confirmation button below if you want it to actually run.',
        calls ? `Tool calls prepared: ${calls}.` : ''
      ]
        .filter(Boolean)
        .join('\n\n');
    }
    return [
      `AI OS command ${status}.`,
      output || summarizeCommandSteps(result),
      calls ? `Tool calls logged: ${calls}.` : ''
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  function summarizeCommandSteps(result: Record<string, unknown>): string {
    const steps = Array.isArray(result.steps) ? result.steps : [];
    if (!steps.length) return JSON.stringify(result, null, 2);
    return steps
      .slice(-3)
      .map((step, index) => {
        const record = step && typeof step === 'object' ? (step as Record<string, unknown>) : {};
        const phase = typeof record.phase === 'string' ? record.phase : `step ${index + 1}`;
        const text = typeof record.text === 'string' ? record.text : JSON.stringify(record);
        return `${phase}: ${text}`;
      })
      .join('\n');
  }
</script>

<div class:open class="assistant-dock">
  {#if open}
    <section class="assistant-panel" aria-label="AI assistant">
      <header>
        <div>
          <span class="title-row"><Bot size={17} /> Assistant</span>
          <small>
            {#if capabilityTotal}
              {currentMachineMode.shortLabel} - {capabilityReadyCount}/{capabilityTotal} ready
            {:else if providerCount}
              {currentMachineMode.shortLabel} - {availableProviderCount}/{providerCount} providers
            {:else}
              {currentMachineMode.shortLabel} - App helper
            {/if}
          </small>
        </div>
        <button class="icon-button" type="button" aria-label="Close assistant" title="Close AI assistant." on:click={() => (open = false)}>
          <PanelRightClose size={17} />
        </button>
      </header>

      <div class="quick-grid" aria-label="Assistant examples">
        {#each examples as example}
          <button type="button" title={exampleTitle(example)} on:click={() => setExample(example)}>{example}</button>
        {/each}
      </div>

      <div bind:this={logElement} class="message-log" aria-live="polite">
        {#each messages as message}
          <article class={`message ${message.role}`}>
            <div class="message-icon" aria-hidden="true">
              {#if message.role === 'user'}
                <MessageCircle size={14} />
              {:else if message.role === 'system'}
                <ShieldCheck size={14} />
              {:else}
                <Sparkles size={14} />
              {/if}
            </div>
            <div class="message-body">
              <p>{message.text}</p>
              {#if message.actions?.length}
                <div class="message-actions">
                  {#each message.actions as action}
                    <button type="button" disabled={busy} title={assistantActionTitle(action)} on:click={() => handleAction(action)}>
                      <span>{action.label}</span>
                      <ChevronRight size={14} />
                    </button>
                  {/each}
                </div>
              {/if}
            </div>
          </article>
        {/each}
        {#if busy}
          <article class="message assistant">
            <div class="message-icon" aria-hidden="true"><Cpu size={14} /></div>
            <div class="message-body"><p>Working...</p></div>
          </article>
        {/if}
      </div>

      <div class="mode-row">
        <label title="Route ambiguous assistant requests through the AI OS command/tool planner when possible.">
          <input type="checkbox" bind:checked={toolMode} title="Route ambiguous assistant requests through the AI OS command/tool planner when possible." />
          <span>Tool mode</span>
        </label>
        <label title="Permit write or system tools only after an explicit confirmation pass.">
          <input type="checkbox" bind:checked={confirmActions} title="Require explicit confirmation before assistant write or system tool calls run." />
          <span>Confirm writes</span>
        </label>
      </div>

      <form class="composer" on:submit|preventDefault={submit}>
        <textarea
          bind:value={draft}
          rows="2"
          aria-label="Message assistant"
          placeholder="Ask to open a page, check AI status, search memory, or run an AI OS command"
          title="Write a message for the Mini Hub assistant. Press Enter to send or Shift+Enter for a new line."
          on:keydown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
        ></textarea>
        <button class="send-button" type="submit" disabled={Boolean(sendBlockedReason)} aria-label="Send" title={sendBlockedReason || 'Send this message to the assistant.'}>
          <Send size={17} />
        </button>
      </form>
    </section>
  {/if}

  <button class="assistant-toggle" type="button" aria-label={open ? 'Close assistant' : 'Open assistant'} title={assistantToggleTitle} on:click={() => (open = !open)}>
    {#if open}
      <PanelRightOpen size={20} />
    {:else}
      <Search size={20} />
    {/if}
  </button>
</div>

<style>
  .assistant-dock {
    position: fixed;
    right: 16px;
    bottom: 16px;
    z-index: 80;
    display: grid;
    justify-items: end;
    gap: 10px;
    pointer-events: none;
  }

  .assistant-dock.open {
    top: 12px;
  }

  .assistant-panel,
  .assistant-toggle {
    pointer-events: auto;
  }

  .assistant-panel {
    display: grid;
    grid-template-rows: auto auto minmax(0, 1fr) auto auto;
    width: min(420px, calc(100vw - 24px));
    max-height: calc(100vh - 84px);
    min-height: 480px;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
    box-shadow: 0 18px 54px rgb(0 0 0 / 18%);
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }

  header > div {
    display: grid;
    gap: 2px;
    min-width: 0;
  }

  header small {
    color: var(--muted);
  }

  .title-row {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    font-weight: 800;
  }

  .quick-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--border);
    background: var(--surface-muted);
  }

  .quick-grid button,
  .message-actions button,
  .assistant-toggle,
  .icon-button,
  .send-button {
    border: 1px solid var(--border-strong);
    color: var(--text);
    background: var(--surface);
    cursor: pointer;
  }

  .quick-grid button {
    min-height: 30px;
    padding: 5px 8px;
    border-radius: 6px;
    color: var(--text-soft);
    text-align: left;
  }

  .quick-grid button:hover,
  .message-actions button:hover,
  .assistant-toggle:hover,
  .icon-button:hover,
  .send-button:hover {
    background: var(--active);
  }

  .message-log {
    display: grid;
    align-content: start;
    gap: 10px;
    overflow: auto;
    padding: 12px;
    background: var(--bg);
  }

  .message {
    display: grid;
    grid-template-columns: 28px minmax(0, 1fr);
    gap: 8px;
  }

  .message.user {
    grid-template-columns: minmax(0, 1fr) 28px;
  }

  .message.user .message-icon {
    grid-column: 2;
    grid-row: 1;
  }

  .message.user .message-body {
    grid-column: 1;
    grid-row: 1;
    justify-self: end;
    background: var(--surface-soft);
  }

  .message-icon {
    display: grid;
    width: 28px;
    height: 28px;
    place-items: center;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--muted);
    background: var(--surface);
  }

  .message-body {
    display: grid;
    gap: 8px;
    max-width: 100%;
    padding: 9px 10px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
  }

  .message.system .message-body {
    background: var(--surface-muted);
  }

  .message-body p {
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    line-height: 1.45;
  }

  .message-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .message-actions button {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-height: 26px;
    padding: 3px 7px;
    border-radius: 6px;
    color: var(--text-soft);
  }

  .mode-row {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    padding: 8px 12px;
    border-top: 1px solid var(--border);
    color: var(--muted);
    background: var(--surface);
    font-size: 12px;
    font-weight: 750;
  }

  .mode-row label {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .mode-row input {
    width: 14px;
    height: 14px;
  }

  .composer {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 38px;
    gap: 8px;
    padding: 10px 12px 12px;
    border-top: 1px solid var(--border);
    background: var(--surface);
  }

  .composer textarea {
    min-height: 42px;
    max-height: 120px;
    resize: vertical;
  }

  .send-button,
  .icon-button {
    display: grid;
    place-items: center;
    border-radius: 6px;
  }

  .send-button {
    width: 38px;
    height: 38px;
    align-self: end;
    color: var(--primary-text);
    background: var(--primary-bg);
  }

  .send-button:hover {
    background: var(--primary-bg);
  }

  .send-button:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  .icon-button {
    width: 32px;
    height: 32px;
  }

  .assistant-toggle {
    display: grid;
    width: 46px;
    height: 46px;
    place-items: center;
    border-radius: 8px;
    color: var(--primary-text);
    background: var(--primary-bg);
    box-shadow: 0 12px 28px rgb(0 0 0 / 20%);
  }

  .assistant-toggle:hover {
    background: var(--primary-bg);
  }

  @media (max-width: 620px) {
    .assistant-dock {
      right: 10px;
      bottom: 10px;
    }

    .assistant-dock.open {
      left: 10px;
      top: 10px;
      justify-items: stretch;
    }

    .assistant-panel {
      width: auto;
      min-height: min(540px, calc(100vh - 78px));
    }
  }
</style>
