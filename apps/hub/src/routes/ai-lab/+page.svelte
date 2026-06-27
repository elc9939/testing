<script lang="ts">
  import { onMount } from 'svelte';
  import { BrainCircuit, FileCode2, Play, RotateCcw } from 'lucide-svelte';
  import javascriptGrammarUrl from 'tree-sitter-javascript/tree-sitter-javascript.wasm?url';
  import {
    aiLabDraftStorageKey,
    aiLabAssetErrorDetail,
    aiLabResultCopy,
    normalizeAiLabDraft,
    parseAiLabLabels,
    type AiLabDraftState,
    type AiLabResultState
  } from '$lib/ai-lab-state';

  const defaultAiLabDraft: AiLabDraftState = {
    text: 'Follow up with two high-fit roles, summarize the study backlog, and classify today as focused work.',
    labels: 'career, study, games, admin',
    codeText: `function scoreCareerFit(role) {
  const tags = role.tags ?? [];
  return tags.includes('ai') && role.remote ? 0.95 : 0.62;
}`,
    grammarUrl: javascriptGrammarUrl
  };

  let text = defaultAiLabDraft.text;
  let labels = defaultAiLabDraft.labels;
  let codeText = defaultAiLabDraft.codeText;
  let grammarUrl = defaultAiLabDraft.grammarUrl;
  let classifyResultText = '';
  let classifyResultState: AiLabResultState = 'idle';
  let classifyBusy = false;
  let parseResultText = '';
  let parseResultState: AiLabResultState = 'idle';
  let parseBusy = false;
  let draftHydrated = false;
  let draftStatus = 'Using default browser-local samples.';
  $: classifyResultCopy = aiLabResultCopy(classifyResultState, classifyResultText);
  $: parseResultCopy = aiLabResultCopy(parseResultState, parseResultText);
  $: classifyBlockedReason = classifyBusy ? 'Classification is already running.' : classifyValidationReason({ text, labels });
  $: parseBlockedReason = parseBusy ? 'Parser is already running.' : parseValidationReason({ grammarUrl, codeText });
  $: sampleControlsDisabled = classifyBusy || parseBusy;
  $: grammarAssetState = grammarUrl.trim()
    ? 'Tree-sitter grammar URL is configured.'
    : 'Tree-sitter needs a WASM grammar URL before parsing can run.';
  $: readinessRows = [
    {
      label: 'Transformers.js',
      state: 'Loads on demand',
      detail: 'Classification runs in the browser bundle through the shared AI package. First run may download or initialize model assets.'
    },
    {
      label: 'Tree-sitter grammar',
      state: grammarUrl.trim() ? 'Configured' : 'Setup needed',
      detail: grammarUrl.trim()
        ? 'The parser will load the configured WASM grammar URL when you press Parse.'
        : 'Paste a WASM grammar URL before parsing. The JavaScript grammar is bundled by default.'
    },
    {
      label: 'AI OS API',
      state: 'Not required',
      detail: 'This lab is browser-local. Use AI OS for Ollama/API routing, queues, agents, and service health.'
    }
  ];
  $: if (draftHydrated) persistAiLabDraft();

  onMount(() => {
    hydrateAiLabDraft();
  });

  function setClassifyResult(state: AiLabResultState, detail = ''): void {
    classifyResultState = state;
    classifyResultText = detail;
  }

  function setParseResult(state: AiLabResultState, detail = ''): void {
    parseResultState = state;
    parseResultText = detail;
  }

  function classifyValidationReason(state: { text: string; labels: string } = { text, labels }): string {
    const parsedLabels = parseAiLabLabels(state.labels);
    if (!state.text.trim()) return 'Add text before running the classifier.';
    if (!parsedLabels.length) return 'Add at least one comma-separated label.';
    return '';
  }

  function parseValidationReason(state: { grammarUrl: string; codeText: string } = { grammarUrl, codeText }): string {
    if (!state.grammarUrl.trim()) return 'Provide a Tree-sitter WASM grammar URL first.';
    if (!state.codeText.trim()) return 'Add code before running the parser.';
    return '';
  }

  function classifyInputTitle(enabledTitle: string): string {
    if (classifyBusy) return 'Classification is running with the submitted text and labels; wait before editing these inputs.';
    return enabledTitle;
  }

  function parseInputTitle(enabledTitle: string): string {
    if (parseBusy) return 'Parsing is running with the submitted code and grammar URL; wait before editing these inputs.';
    return enabledTitle;
  }

  function currentAiLabDraft(): AiLabDraftState {
    return { text, labels, codeText, grammarUrl };
  }

  function applyAiLabDraft(draft: AiLabDraftState): void {
    text = draft.text;
    labels = draft.labels;
    codeText = draft.codeText;
    grammarUrl = draft.grammarUrl;
  }

  function restoreAiLabSamples(): void {
    if (sampleControlsDisabled) return;
    applyAiLabDraft(defaultAiLabDraft);
    setClassifyResult('idle');
    setParseResult('idle');
    draftStatus = 'Restored default AI Lab samples in this browser.';
  }

  function restoreSamplesTitle(): string {
    if (sampleControlsDisabled) return 'Wait for the current AI Lab experiment before restoring samples.';
    return 'Restore the known-good AI Lab sample inputs for Classify and Parse.';
  }

  function hydrateAiLabDraft(): void {
    if (typeof localStorage === 'undefined') {
      draftHydrated = true;
      draftStatus = 'Browser storage is unavailable; samples reset on reload.';
      return;
    }
    try {
      const raw = localStorage.getItem(aiLabDraftStorageKey);
      if (raw) {
        applyAiLabDraft(normalizeAiLabDraft(JSON.parse(raw) as unknown, currentAiLabDraft()));
        draftStatus = 'Reloaded AI Lab inputs from this browser.';
      } else {
        draftStatus = 'Using default browser-local samples.';
      }
    } catch {
      draftStatus = 'Stored AI Lab inputs were unreadable; defaults are loaded.';
    } finally {
      draftHydrated = true;
    }
  }

  function persistAiLabDraft(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(aiLabDraftStorageKey, JSON.stringify(currentAiLabDraft()));
    } catch {
      draftStatus = 'Browser storage is full or blocked; AI Lab inputs may not persist.';
    }
  }

  async function classify(): Promise<void> {
    const blocked = classifyValidationReason({ text, labels });
    if (blocked) {
      setClassifyResult('error', blocked);
      return;
    }
    const parsedLabels = parseAiLabLabels(labels);
    classifyBusy = true;
    setClassifyResult('loading', 'Loading Transformers.js and the local classification model.');
    try {
      const ai = await import('@mini-hub/ai');
      const rows = await ai.classifyTextLocally(text, parsedLabels);
      if (!rows.length) {
        setClassifyResult('empty', 'Classifier returned no labels. Try broader labels or a longer input.');
      } else {
        setClassifyResult('success', rows.map((row) => `${row.label}: ${row.score.toFixed(3)}`).join('\n'));
      }
    } catch (error) {
      setClassifyResult('error', aiLabAssetErrorDetail('classify', error));
    } finally {
      classifyBusy = false;
    }
  }

  async function parseCode(): Promise<void> {
    const blocked = parseValidationReason({ grammarUrl, codeText });
    if (blocked) {
      setParseResult('error', blocked);
      return;
    }
    parseBusy = true;
    setParseResult('loading', 'Loading Tree-sitter and the configured grammar.');
    try {
      const ai = await import('@mini-hub/ai');
      const parsed = await ai.parseWithTreeSitter(codeText, grammarUrl.trim() || javascriptGrammarUrl);
      const serialized = JSON.stringify(parsed, null, 2);
      setParseResult(serialized && serialized !== '{}' ? 'success' : 'empty', serialized || 'Parser returned no syntax tree.');
    } catch (error) {
      setParseResult('error', aiLabAssetErrorDetail('parse', error));
    } finally {
      parseBusy = false;
    }
  }
</script>

<svelte:head>
  <title>AI Lab - Mini Hub</title>
</svelte:head>

<section class="page-header">
  <div>
    <p class="eyebrow">AI Lab</p>
    <h1>Browser Experiments</h1>
  </div>
  <div class="action-row">
    <button class="button" type="button" disabled={sampleControlsDisabled} title={restoreSamplesTitle()} on:click={restoreAiLabSamples}>
      <RotateCcw size={17} />
      <span>Restore Samples</span>
    </button>
  </div>
</section>

<section class="card card-pad plain-guide">
  <div>
    <strong>What this is</strong>
    <p>AI Lab is a small sandbox for browser-side local AI pieces. Use it to try text classification and code parsing without running the full AI OS control room.</p>
    <small>{draftStatus}</small>
  </div>
  <div>
    <strong>When to use AI OS instead</strong>
    <p>Use AI OS for Ollama/API routing, agents, memory search, queues, multimodal adapters, benchmarks, tools, and health checks.</p>
  </div>
</section>

<section class="card card-pad readiness-strip" aria-label="AI Lab local capability status">
  {#each readinessRows as row}
    <div>
      <span>{row.label}</span>
      <strong>{row.state}</strong>
      <small>{row.detail}</small>
    </div>
  {/each}
</section>

<section class="grid two">
  <div class="card card-pad panel">
    <div class="section-title">
      <BrainCircuit size={18} />
      <strong>Transformers.js</strong>
    </div>
    <div class="field">
      <label for="text">Text</label>
      <textarea id="text" bind:value={text} disabled={classifyBusy} title={classifyInputTitle('Edit the text to classify.')} rows="7"></textarea>
    </div>
    <div class="field">
      <label for="labels">Labels</label>
      <input id="labels" bind:value={labels} disabled={classifyBusy} title={classifyInputTitle('Edit comma-separated classifier labels.')} />
    </div>
    <button class="button primary" type="button" disabled={Boolean(classifyBlockedReason)} title={classifyBlockedReason || 'Classify this text using browser-side local assets.'} on:click={classify}>
      <Play size={17} />
      <span>{classifyBusy ? 'Running' : 'Classify'}</span>
    </button>
    {#if classifyBlockedReason && !classifyBusy}
      <small class="control-note warning">{classifyBlockedReason}</small>
    {/if}
  </div>

  <div class="card card-pad panel">
    <div class="section-title">
      <FileCode2 size={18} />
      <strong>Tree-sitter</strong>
    </div>
    <div class="field">
      <label for="grammar">Grammar WASM URL</label>
      <input id="grammar" bind:value={grammarUrl} disabled={parseBusy} title={parseInputTitle('Edit the Tree-sitter WASM grammar URL.')} />
      <small class:warning={!grammarUrl.trim()}>{grammarAssetState}</small>
    </div>
    <div class="field">
      <label for="code-text">Code</label>
      <textarea id="code-text" bind:value={codeText} disabled={parseBusy} title={parseInputTitle('Edit the code to parse.')} rows="7"></textarea>
    </div>
    <button class="button" type="button" disabled={Boolean(parseBlockedReason)} title={parseBlockedReason || 'Parse this code using the configured Tree-sitter grammar.'} on:click={parseCode}>
      <Play size={17} />
      <span>{parseBusy ? 'Running' : 'Parse'}</span>
    </button>
    {#if parseBlockedReason && !parseBusy}
      <small class="control-note warning">{parseBlockedReason}</small>
    {/if}
  </div>
</section>

<section class="result-grid" aria-label="AI Lab results">
  <article class={`card card-pad result-panel ${classifyResultState}`} aria-live="polite" aria-busy={classifyBusy}>
    <div class="section-title">
      <BrainCircuit size={18} />
      <strong>Classifier: {classifyResultCopy.title}</strong>
    </div>
    <p>{classifyResultCopy.detail}</p>
    {#if classifyResultState === 'success' || (classifyResultState === 'empty' && classifyResultText)}
      <pre>{classifyResultText}</pre>
    {:else if classifyResultState === 'error' && classifyResultText}
      <pre class="error-output">{classifyResultText}</pre>
    {/if}
  </article>

  <article class={`card card-pad result-panel ${parseResultState}`} aria-live="polite" aria-busy={parseBusy}>
    <div class="section-title">
      <FileCode2 size={18} />
      <strong>Parser: {parseResultCopy.title}</strong>
    </div>
    <p>{parseResultCopy.detail}</p>
    {#if parseResultState === 'success' || (parseResultState === 'empty' && parseResultText)}
      <pre>{parseResultText}</pre>
    {:else if parseResultState === 'error' && parseResultText}
      <pre class="error-output">{parseResultText}</pre>
    {/if}
  </article>
</section>

<style>
  .plain-guide {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
    margin-bottom: 10px;
    background: var(--surface-muted);
  }

  .plain-guide div {
    display: grid;
    gap: 5px;
  }

  .plain-guide p {
    margin: 0;
    color: var(--muted);
    line-height: 1.45;
  }

  .plain-guide small,
  .control-note {
    color: var(--muted);
    line-height: 1.35;
  }

  .control-note.warning {
    color: var(--warning-text);
  }

  .readiness-strip {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
    margin-bottom: 10px;
  }

  .readiness-strip div {
    display: grid;
    gap: 4px;
    min-width: 0;
    padding: 10px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface-muted);
  }

  .readiness-strip span {
    color: var(--muted);
    font-size: 12px;
    font-weight: 800;
    text-transform: uppercase;
  }

  .readiness-strip small {
    color: var(--muted);
    line-height: 1.35;
  }

  .panel {
    display: grid;
    gap: 12px;
    align-content: start;
  }

  .field small {
    color: var(--muted);
    line-height: 1.35;
  }

  .field small.warning {
    color: var(--warning-text);
  }

  .section-title {
    display: flex;
    align-items: center;
    gap: 8px;
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
  }

  .result-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
    margin-top: 10px;
  }

  .result-panel {
    display: grid;
    gap: 12px;
    align-content: start;
  }

  .result-panel p {
    margin: 0;
    color: var(--muted);
    line-height: 1.45;
  }

  .result-panel.error {
    border-color: var(--error-border);
  }

  .result-panel.loading {
    border-color: var(--warning-border);
  }

  .result-panel.empty {
    border-color: var(--border-strong);
  }

  .result-panel.success {
    border-color: var(--success-border);
  }

  .error-output {
    color: var(--error-text);
  }

  @media (max-width: 760px) {
    .plain-guide,
    .readiness-strip,
    .result-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
