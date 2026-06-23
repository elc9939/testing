<script lang="ts">
  import { BrainCircuit, FileCode2, Play } from 'lucide-svelte';
  import javascriptGrammarUrl from 'tree-sitter-javascript/tree-sitter-javascript.wasm?url';
  import { aiLabResultCopy, parseAiLabLabels, type AiLabResultState } from '$lib/ai-lab-state';

  let text = 'Follow up with two high-fit roles, summarize the study backlog, and classify today as focused work.';
  let labels = 'career, study, games, admin';
  let codeText = `function scoreCareerFit(role) {
  const tags = role.tags ?? [];
  return tags.includes('ai') && role.remote ? 0.95 : 0.62;
}`;
  let grammarUrl = javascriptGrammarUrl;
  let resultText = '';
  let resultState: AiLabResultState = 'idle';
  let busy = false;
  $: resultCopy = aiLabResultCopy(resultState, resultText);
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

  function setResult(state: AiLabResultState, detail = ''): void {
    resultState = state;
    resultText = detail;
  }

  async function classify(): Promise<void> {
    const parsedLabels = parseAiLabLabels(labels);
    if (!text.trim()) {
      setResult('error', 'Add text before running the classifier.');
      return;
    }
    if (!parsedLabels.length) {
      setResult('error', 'Add at least one comma-separated label.');
      return;
    }
    busy = true;
    setResult('loading', 'Loading Transformers.js and the local classification model.');
    try {
      const ai = await import('@mini-hub/ai');
      const rows = await ai.classifyTextLocally(text, parsedLabels);
      if (!rows.length) {
        setResult('empty', 'Classifier returned no labels. Try broader labels or a longer input.');
      } else {
        setResult('success', rows.map((row) => `${row.label}: ${row.score.toFixed(3)}`).join('\n'));
      }
    } catch (error) {
      setResult('error', error instanceof Error ? error.message : 'Classification failed.');
    } finally {
      busy = false;
    }
  }

  async function parseCode(): Promise<void> {
    if (!grammarUrl.trim()) {
      setResult('error', 'Provide a Tree-sitter WASM grammar URL first.');
      return;
    }
    if (!codeText.trim()) {
      setResult('error', 'Add code before running the parser.');
      return;
    }
    busy = true;
    setResult('loading', 'Loading Tree-sitter and the configured grammar.');
    try {
      const ai = await import('@mini-hub/ai');
      const parsed = await ai.parseWithTreeSitter(codeText, grammarUrl.trim() || javascriptGrammarUrl);
      const serialized = JSON.stringify(parsed, null, 2);
      setResult(serialized && serialized !== '{}' ? 'success' : 'empty', serialized || 'Parser returned no syntax tree.');
    } catch (error) {
      setResult('error', error instanceof Error ? error.message : 'Parse failed.');
    } finally {
      busy = false;
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
</section>

<section class="card card-pad plain-guide">
  <div>
    <strong>What this is</strong>
    <p>AI Lab is a small sandbox for browser-side local AI pieces. Use it to try text classification and code parsing without running the full AI OS control room.</p>
  </div>
  <div>
    <strong>When to use AI OS instead</strong>
    <p>Use AI OS for Ollama/API routing, agents, memory search, queues, multimodal adapters, benchmarks, tools, and health checks.</p>
  </div>
</section>

<section class="card card-pad readiness-strip" aria-label="AI Lab readiness">
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
      <textarea id="text" bind:value={text} rows="7"></textarea>
    </div>
    <div class="field">
      <label for="labels">Labels</label>
      <input id="labels" bind:value={labels} />
    </div>
    <button class="button primary" type="button" disabled={busy} on:click={classify}>
      <Play size={17} />
      <span>{busy && resultState === 'loading' ? 'Running' : 'Classify'}</span>
    </button>
  </div>

  <div class="card card-pad panel">
    <div class="section-title">
      <FileCode2 size={18} />
      <strong>Tree-sitter</strong>
    </div>
    <div class="field">
      <label for="grammar">Grammar WASM URL</label>
      <input id="grammar" bind:value={grammarUrl} />
      <small class:warning={!grammarUrl.trim()}>{grammarAssetState}</small>
    </div>
    <div class="field">
      <label for="code-text">Code</label>
      <textarea id="code-text" bind:value={codeText} rows="7"></textarea>
    </div>
    <button class="button" type="button" disabled={busy} on:click={parseCode}>
      <Play size={17} />
      <span>{busy && resultState === 'loading' ? 'Running' : 'Parse'}</span>
    </button>
  </div>
</section>

<section class={`card card-pad result-panel ${resultState}`} aria-live="polite">
  <div class="section-title">
    <BrainCircuit size={18} />
    <strong>{resultCopy.title}</strong>
  </div>
  <p>{resultCopy.detail}</p>
  {#if resultState === 'success'}
    <pre>{resultText}</pre>
  {:else if resultState === 'empty' && resultText}
    <pre>{resultText}</pre>
  {:else if resultState === 'error' && resultText}
    <pre class="error-output">{resultText}</pre>
  {/if}
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

  .result-panel {
    display: grid;
    gap: 12px;
    margin-top: 10px;
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

  .error-output {
    color: var(--error-text);
  }

  @media (max-width: 760px) {
    .plain-guide,
    .readiness-strip {
      grid-template-columns: 1fr;
    }
  }
</style>
