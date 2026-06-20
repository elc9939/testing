<script lang="ts">
  import { BrainCircuit, FileCode2, Play } from 'lucide-svelte';
  import javascriptGrammarUrl from 'tree-sitter-javascript/tree-sitter-javascript.wasm?url';

  let text = 'Follow up with two high-fit roles, summarize the study backlog, and classify today as focused work.';
  let labels = 'career, study, games, admin';
  let codeText = `function scoreCareerFit(role) {
  const tags = role.tags ?? [];
  return tags.includes('ai') && role.remote ? 0.95 : 0.62;
}`;
  let grammarUrl = javascriptGrammarUrl;
  let result = 'Idle';
  let busy = false;

  async function classify(): Promise<void> {
    busy = true;
    result = 'Loading local model';
    try {
      const ai = await import('@mini-hub/ai');
      const rows = await ai.classifyTextLocally(
        text,
        labels.split(',').map((label) => label.trim()).filter(Boolean)
      );
      result = rows.map((row) => `${row.label}: ${row.score.toFixed(3)}`).join('\n');
    } catch (error) {
      result = error instanceof Error ? error.message : 'Classification failed';
    } finally {
      busy = false;
    }
  }

  async function parseCode(): Promise<void> {
    if (!grammarUrl.trim()) {
      result = 'Provide a Tree-sitter WASM grammar URL first.';
      return;
    }
    busy = true;
    result = 'Loading parser';
    try {
      const ai = await import('@mini-hub/ai');
      const parsed = await ai.parseWithTreeSitter(codeText, grammarUrl.trim() || javascriptGrammarUrl);
      result = JSON.stringify(parsed, null, 2);
    } catch (error) {
      result = error instanceof Error ? error.message : 'Parse failed';
    } finally {
      busy = false;
    }
  }
</script>

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
      <span>Classify</span>
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
    </div>
    <div class="field">
      <label for="code-text">Code</label>
      <textarea id="code-text" bind:value={codeText} rows="7"></textarea>
    </div>
    <button class="button" type="button" disabled={busy} on:click={parseCode}>
      <Play size={17} />
      <span>Parse</span>
    </button>
  </div>
</section>

<section class="card card-pad result-panel">
  <div class="section-title">
    <BrainCircuit size={18} />
    <strong>Result</strong>
  </div>
  <pre>{result}</pre>
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

  .panel {
    display: grid;
    gap: 12px;
    align-content: start;
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

  @media (max-width: 760px) {
    .plain-guide {
      grid-template-columns: 1fr;
    }
  }
</style>
