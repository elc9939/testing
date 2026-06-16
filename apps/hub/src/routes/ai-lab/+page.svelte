<script lang="ts">
  import { BrainCircuit, FileCode2, Play } from 'lucide-svelte';

  let text = 'Follow up with two high-fit roles, summarize the study backlog, and classify today as focused work.';
  let labels = 'career, study, games, admin';
  let grammarUrl = '';
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
      const parsed = await ai.parseWithTreeSitter(text, grammarUrl.trim());
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
    <h1>Local Intelligence</h1>
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
      <input id="grammar" bind:value={grammarUrl} placeholder="/tree-sitter-javascript.wasm" />
    </div>
    <button class="button" type="button" disabled={busy} on:click={parseCode}>
      <Play size={17} />
      <span>Parse</span>
    </button>
    <pre>{result}</pre>
  </div>
</section>

<style>
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
    min-height: 180px;
    max-height: 360px;
    overflow: auto;
    margin: 0;
    padding: 12px;
    border-radius: 6px;
    background: #18202f;
    color: #f6f8fb;
    white-space: pre-wrap;
  }
</style>

