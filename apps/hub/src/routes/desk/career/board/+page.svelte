<script lang="ts">
  import { onMount } from 'svelte';
  import { ExternalLink, RefreshCw, Star, Check, X, Download, Upload, RotateCcw } from 'lucide-svelte';
  import { CAREER_BOARD_SEED, type CareerBoardJob } from '$lib/career-board-seed';
  import { getBrowserStorage } from '$lib/browser-storage';
  import { hubHref } from '$lib/routes';

  type BoardStatus = 'new' | 'interested' | 'applied' | 'dismissed';
  type SortMode = 'smart' | 'fit' | 'company' | 'added';
  type FilterMode = 'all' | 'new' | 'interested' | 'applied' | 'dismissed';

  interface BoardState {
    userStates: Record<string, BoardStatus>;
    notes: Record<string, string>;
    added: CareerBoardJob[];
    profile: string;
    filter: FilterMode;
    sort: SortMode;
    query: string;
    revisions: number;
    ollamaEndpoint: string;
    ollamaModel: string;
    ollamaExtra: string;
  }

  const STORE_KEY = 'careerBoard.state.v1';
  const defaultProfile =
    'M.S. Physics, May 2027 · B.S. May 2026 · Python / Jupyter · target Spring–Summer 2027 start · US-based · open to remote/hybrid';
  const defaultState: BoardState = {
    userStates: {},
    notes: {},
    added: [],
    profile: defaultProfile,
    filter: 'all',
    sort: 'smart',
    query: '',
    revisions: 0,
    ollamaEndpoint: 'http://localhost:11434',
    ollamaModel: 'llama3.1:8b',
    ollamaExtra: ''
  };

  let state: BoardState = { ...defaultState };
  let hydrated = false;
  let openDetailId = '';
  let ollamaStatus = 'idle';
  let ollamaStatusKind: 'ok' | 'err' | '' = '';

  onMount(() => {
    const store = getBrowserStorage();
    if (!store) {
      hydrated = true;
      return;
    }
    try {
      const raw = store.getItem(STORE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        state = { ...defaultState, ...parsed };
      }
    } catch {
      state = { ...defaultState };
    }
    hydrated = true;
  });

  function persist() {
    if (!hydrated) return;
    const store = getBrowserStorage();
    if (!store) return;
    state.revisions = (state.revisions || 0) + 1;
    try {
      store.setItem(STORE_KEY, JSON.stringify(state));
    } catch {
      // storage full or blocked — silently no-op
    }
    state = state;
  }

  function statusFor(id: string): BoardStatus {
    return state.userStates[id] || 'new';
  }

  function toggleStatus(id: string, next: BoardStatus) {
    const cur = state.userStates[id];
    if (cur === next) delete state.userStates[id];
    else state.userStates[id] = next;
    persist();
  }

  function setNotes(id: string, text: string) {
    if (text.trim()) state.notes[id] = text;
    else delete state.notes[id];
    persist();
  }

  function setProfile() {
    const next = prompt('Edit your profile (used by Ollama to score fit):', state.profile);
    if (next != null) {
      state.profile = next.trim() || state.profile;
      persist();
    }
  }

  function setFilter(f: FilterMode) {
    state.filter = f;
    persist();
  }

  function scoreForSort(job: CareerBoardJob): number {
    const s = statusFor(job.id);
    let boost = 0;
    if (s === 'interested') boost += 1000;
    if (s === 'new') boost += 300;
    if (s === 'applied') boost -= 200;
    if (s === 'dismissed') boost -= 10000;
    return boost + (job.fit || 0);
  }

  function fitTier(f: number): 'high' | 'mid' | 'low' {
    if (f >= 85) return 'high';
    if (f >= 70) return 'mid';
    return 'low';
  }

  function matchesQuery(job: CareerBoardJob, q: string): boolean {
    if (!q) return true;
    const s = [job.company, job.role, job.tier, ...(job.tags || []), ...(job.bullets || []), job.special || '']
      .join(' ')
      .toLowerCase();
    return s.includes(q.toLowerCase());
  }

  function filterKind(job: CareerBoardJob): boolean {
    const s = statusFor(job.id);
    if (state.filter === 'all') return s !== 'dismissed';
    if (state.filter === 'new') return s === 'new';
    return s === state.filter;
  }

  $: allJobs = (() => {
    const map = new Map<string, CareerBoardJob>();
    for (const j of CAREER_BOARD_SEED) map.set(j.id, { ...j, source: 'seed' });
    for (const j of state.added || []) map.set(j.id, { ...j, source: 'user' });
    return [...map.values()];
  })();

  $: counts = (() => {
    const c = { all: 0, new: 0, interested: 0, applied: 0, dismissed: 0 };
    for (const j of allJobs) {
      const s = statusFor(j.id);
      if (s !== 'dismissed') c.all += 1;
      c[s] += 1;
    }
    return c;
  })();

  $: filtered = (() => {
    const list = allJobs.filter((j) => filterKind(j) && matchesQuery(j, state.query));
    if (state.sort === 'smart') list.sort((a, b) => scoreForSort(b) - scoreForSort(a));
    else if (state.sort === 'fit') list.sort((a, b) => (b.fit || 0) - (a.fit || 0));
    else if (state.sort === 'company') list.sort((a, b) => a.company.localeCompare(b.company));
    else if (state.sort === 'added') list.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    return list;
  })();

  function slugify(s: string): string {
    return String(s)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60);
  }

  function buildPrompt(profile: string, extra: string, existing: string[]): string {
    return `You are a career research assistant. Suggest 10 CURRENTLY-HIRING employers whose ongoing early-career or new-grad research/engineering programs fit this candidate. Return ONLY a JSON array, no prose. Do not repeat companies from the "existing" list.

CANDIDATE PROFILE:
${profile}

EXISTING (do not repeat):
${existing.join(', ')}

EXTRA INSTRUCTIONS: ${extra || '(none)'}

Return JSON array. Each element MUST match this schema:
{
  "company": "string",
  "role": "string (specific role or program name)",
  "tier": "AI Research | Quant | National Lab | Aerospace | Semiconductor | Deep Tech | Sci Software | Robotics | Other",
  "link": "careers page URL (canonical, e.g. https://company.com/careers)",
  "fit": 0-100,
  "grad": "one line on grad-date fit for a May 2027 MS grad",
  "exp": "one line on experience/skills required",
  "tags": ["short-tag","location-tag"],
  "special": "one line on any special requirement (clearance, citizenship, visa)",
  "bullets": ["2-4 short factual bullets"]
}

Return only the raw JSON array, starting with [ and ending with ]. No markdown fences.`;
  }

  function parseSuggestions(text: string): CareerBoardJob[] {
    const trimmed = text.trim();
    const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    const raw = fence ? fence[1] : trimmed;
    const startIdx = raw.indexOf('[');
    const endIdx = raw.lastIndexOf(']');
    if (startIdx === -1 || endIdx === -1) throw new Error('Could not find JSON array in model output');
    const arr = JSON.parse(raw.slice(startIdx, endIdx + 1));
    if (!Array.isArray(arr)) throw new Error('Parsed value is not an array');
    return arr;
  }

  function ingest(suggestions: CareerBoardJob[]): number {
    const existing = new Set(allJobs.map((j) => j.company.toLowerCase()));
    let added = 0;
    for (const raw of suggestions) {
      if (!raw || !raw.company || !raw.role) continue;
      const key = raw.company.toLowerCase();
      if (existing.has(key)) continue;
      const link = /^https?:\/\//.test(raw.link)
        ? raw.link
        : 'https://www.google.com/search?q=' + encodeURIComponent(raw.company + ' careers ' + raw.role);
      const j: CareerBoardJob = {
        id: 'oll-' + slugify(raw.company) + '-' + Date.now().toString(36) + '-' + added,
        company: String(raw.company).slice(0, 80),
        role: String(raw.role).slice(0, 120),
        tier: String(raw.tier || 'Other').slice(0, 40),
        link,
        fit: Math.max(0, Math.min(100, parseInt(String(raw.fit)) || 60)),
        grad: String(raw.grad || '—').slice(0, 200),
        exp: String(raw.exp || '—').slice(0, 200),
        tags: Array.isArray(raw.tags) ? raw.tags.slice(0, 6).map((t) => String(t).slice(0, 40)) : [],
        special: String(raw.special || '—').slice(0, 400),
        bullets: Array.isArray(raw.bullets) ? raw.bullets.slice(0, 6).map((b) => String(b).slice(0, 240)) : [],
        source: 'user',
        addedAt: Date.now()
      };
      state.added = [...(state.added || []), j];
      existing.add(key);
      added += 1;
    }
    persist();
    return added;
  }

  async function pingOllama() {
    const url = state.ollamaEndpoint.replace(/\/$/, '');
    ollamaStatus = 'pinging ' + url + ' …';
    ollamaStatusKind = '';
    try {
      const r = await fetch(url + '/api/tags');
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      const models = (d.models || []).map((m: { name: string }) => m.name).join(', ') || '(no models installed)';
      ollamaStatus = 'OK · models: ' + models;
      ollamaStatusKind = 'ok';
    } catch (e) {
      ollamaStatus = 'Failed: ' + (e as Error).message + '\nSee CORS setup below.';
      ollamaStatusKind = 'err';
    }
  }

  async function fetchOllama() {
    const url = state.ollamaEndpoint.replace(/\/$/, '');
    const model = state.ollamaModel.trim() || 'llama3.1:8b';
    const existing = allJobs.map((j) => j.company);
    const prompt = buildPrompt(state.profile, state.ollamaExtra, existing);
    ollamaStatus = 'Asking ' + model + ' for 10 leads… (30–90s)';
    ollamaStatusKind = '';
    try {
      const r = await fetch(url + '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          stream: false,
          options: { temperature: 0.4 }
        })
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();
      const text: string = data.message?.content || '';
      const suggestions = parseSuggestions(text);
      const added = ingest(suggestions);
      ollamaStatus = `Added ${added} new leads (received ${suggestions.length}, skipped ${suggestions.length - added} duplicates).`;
      ollamaStatusKind = 'ok';
    } catch (e) {
      ollamaStatus = 'Fetch failed: ' + (e as Error).message + '\nIf this is a CORS error, expand the help below.';
      ollamaStatusKind = 'err';
    }
  }

  function importJsonPrompt() {
    const txt = prompt('Paste JSON array from Ollama here:');
    if (!txt) return;
    try {
      const arr = parseSuggestions(txt);
      const n = ingest(arr);
      ollamaStatus = 'Imported ' + n + ' new leads.';
      ollamaStatusKind = 'ok';
    } catch (e) {
      ollamaStatus = 'Import failed: ' + (e as Error).message;
      ollamaStatusKind = 'err';
    }
  }

  function exportState() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'career-board-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  function importState() {
    const txt = prompt('Paste a previously exported JSON to restore state:');
    if (!txt) return;
    try {
      const parsed = JSON.parse(txt);
      state = { ...defaultState, ...parsed };
      persist();
    } catch (e) {
      alert('Import failed: ' + (e as Error).message);
    }
  }

  function resetState() {
    if (!confirm('Reset all statuses, notes, and Ollama-added leads?')) return;
    state = { ...defaultState };
    persist();
  }

  function toggleDetail(id: string) {
    openDetailId = openDetailId === id ? '' : id;
  }
</script>

<svelte:head>
  <title>Career Board — Mini Hub</title>
</svelte:head>

<section class="page-header">
  <div>
    <p class="eyebrow">Desk / Career</p>
    <h1>Job Board</h1>
    <p class="lede">{allJobs.length} leads · {counts.all} live · {counts.interested} starred · {counts.applied} applied</p>
  </div>
  <div class="header-links">
    <a class="btn ghost" href={hubHref('/desk/career')}>Legacy Scout ↗</a>
  </div>
</section>

<section class="card card-pad profile-strip" aria-label="Candidate profile">
  <div class="profile-block">
    <div class="eyebrow-mini">Profile</div>
    <div class="profile-text">{state.profile}</div>
  </div>
  <button class="btn ghost" type="button" on:click={setProfile}>Edit</button>
</section>

<div class="toolbar" role="toolbar" aria-label="Filters">
  <input
    class="search"
    type="search"
    placeholder="Filter by company, role, keyword…"
    bind:value={state.query}
    on:input={persist}
    autocomplete="off"
  />
  <div class="chip-group" role="group" aria-label="Status filter">
    <button class="chip" class:active={state.filter === 'all'} type="button" on:click={() => setFilter('all')}>
      All <span class="count">{counts.all}</span>
    </button>
    <button class="chip" class:active={state.filter === 'new'} type="button" on:click={() => setFilter('new')}>
      New <span class="count">{counts.new}</span>
    </button>
    <button class="chip" class:active={state.filter === 'interested'} type="button" on:click={() => setFilter('interested')}>
      Starred <span class="count">{counts.interested}</span>
    </button>
    <button class="chip" class:active={state.filter === 'applied'} type="button" on:click={() => setFilter('applied')}>
      Applied <span class="count">{counts.applied}</span>
    </button>
    <button class="chip" class:active={state.filter === 'dismissed'} type="button" on:click={() => setFilter('dismissed')}>
      Passed <span class="count">{counts.dismissed}</span>
    </button>
  </div>
  <select class="sortsel" bind:value={state.sort} on:change={persist} aria-label="Sort">
    <option value="smart">Sort: Smart (starred → fit)</option>
    <option value="fit">Sort: Fit score</option>
    <option value="company">Sort: Company A–Z</option>
    <option value="added">Sort: Recently added</option>
  </select>
</div>

<section class="list" aria-live="polite">
  {#if filtered.length === 0}
    <div class="empty">No jobs match this filter.</div>
  {/if}
  {#each filtered as job (job.id)}
    {@const s = statusFor(job.id)}
    {@const tier = fitTier(job.fit)}
    <article class="job" data-status={s} data-fittier={tier}>
      <div class="fit-col">
        <div class="fit-badge">{job.fit}</div>
        <div class="fit-lbl">{tier === 'high' ? 'top' : tier === 'mid' ? 'fit' : 'watch'}</div>
      </div>

      <div class="body-col">
        <div class="row1">
          <span class="company">{job.company}</span>
          <span class="role">{job.role}</span>
          <span class="tag tag-tier">{job.tier}</span>
          {#each job.tags || [] as t}
            <span class="tag">{t}</span>
          {/each}
          {#if s === 'applied'}<span class="tag tag-success">applied</span>{/if}
          {#if s === 'interested'}<span class="tag tag-warning">starred</span>{/if}
          {#if job.source === 'user'}<span class="tag tag-info">ollama</span>{/if}
        </div>
        <ul class="bullets">
          {#each job.bullets || [] as b}
            <li>{b}</li>
          {/each}
        </ul>
      </div>

      <div class="action-col">
        <div class="status-btns">
          <button
            class="sbtn"
            class:sbtn-active-star={s === 'interested'}
            type="button"
            aria-pressed={s === 'interested'}
            on:click={() => toggleStatus(job.id, 'interested')}
            title="Star"
          >
            <Star size={12} /> Star
          </button>
          <button
            class="sbtn"
            class:sbtn-active-applied={s === 'applied'}
            type="button"
            aria-pressed={s === 'applied'}
            on:click={() => toggleStatus(job.id, 'applied')}
            title="Applied"
          >
            <Check size={12} /> Applied
          </button>
          <button
            class="sbtn"
            class:sbtn-active-dismiss={s === 'dismissed'}
            type="button"
            aria-pressed={s === 'dismissed'}
            on:click={() => toggleStatus(job.id, 'dismissed')}
            title="Pass"
          >
            <X size={12} /> Pass
          </button>
        </div>
        <a class="apply" href={job.link} target="_blank" rel="noopener noreferrer">
          Open careers <ExternalLink size={11} />
        </a>
        <button class="notes-toggle" type="button" on:click={() => toggleDetail(job.id)}>
          {openDetailId === job.id ? 'hide details' : state.notes[job.id] ? 'notes ● details' : 'details'}
        </button>
      </div>

      {#if openDetailId === job.id}
        <div class="detail">
          <div class="detail-main">
            <h4>Special requirements</h4>
            <p class="body-text">{job.special || '—'}</p>
            <h4>Your notes</h4>
            <textarea
              value={state.notes[job.id] || ''}
              on:input={(e) => setNotes(job.id, (e.target as HTMLTextAreaElement).value)}
              placeholder="Application status, contacts, follow-ups…"
            ></textarea>
          </div>
          <dl class="detail-meta">
            <dt>Grad</dt><dd>{job.grad || '—'}</dd>
            <dt>Exp</dt><dd>{job.exp || '—'}</dd>
            <dt>Tier</dt><dd>{job.tier || '—'}</dd>
            <dt>Score</dt><dd>{job.fit}/100</dd>
            <dt>Source</dt><dd>{job.source === 'user' ? 'ollama fetch' : 'curated seed'}</dd>
          </dl>
        </div>
      {/if}
    </article>
  {/each}
</section>

<section class="card card-pad ollama" aria-labelledby="ollama-h">
  <div class="ollama-head">
    <div>
      <h3 id="ollama-h">Ollama — fetch more leads</h3>
      <p class="mini">Runs a local model against your profile and appends new suggestions. Needs Ollama running with browser CORS enabled.</p>
    </div>
    <div class="ollama-actions">
      <button class="btn ghost" type="button" on:click={pingOllama}><RefreshCw size={12} /> Ping</button>
      <button class="btn primary" type="button" on:click={fetchOllama}>Fetch 10 leads</button>
    </div>
  </div>
  <div class="ollama-grid">
    <label>
      <span class="eyebrow-mini">Endpoint</span>
      <input type="url" bind:value={state.ollamaEndpoint} on:blur={persist} />
    </label>
    <label>
      <span class="eyebrow-mini">Model</span>
      <input type="text" bind:value={state.ollamaModel} on:blur={persist} placeholder="e.g. llama3.1:8b, qwen2.5:14b" />
    </label>
    <label class="full">
      <span class="eyebrow-mini">Extra instruction (optional)</span>
      <textarea bind:value={state.ollamaExtra} on:blur={persist} placeholder="e.g. focus on quantum computing startups; avoid finance; prioritize NYC / remote"></textarea>
    </label>
  </div>
  <div class="status" class:err={ollamaStatusKind === 'err'} class:ok={ollamaStatusKind === 'ok'}>{ollamaStatus}</div>
  <details class="help">
    <summary>Ollama CORS setup (one-time)</summary>
    <div class="help-body">
      <p>Browsers block requests from this page to <code>localhost</code> unless Ollama sends CORS headers.</p>
      <p><strong>Windows PowerShell (persistent):</strong><br />
        <code>[Environment]::SetEnvironmentVariable("OLLAMA_ORIGINS", "*", "User")</code><br />
        Then restart Ollama (quit tray icon → relaunch).</p>
      <p><strong>One-off (current terminal):</strong><br />
        <code>$env:OLLAMA_ORIGINS="*"; ollama serve</code></p>
      <p>If CORS still blocks, paste the model's JSON output manually:</p>
      <button class="btn ghost" type="button" on:click={importJsonPrompt}><Upload size={12} /> Import JSON manually</button>
    </div>
  </details>
</section>

<footer class="foot">
  <div>State persists in this browser · {state.revisions} revisions saved</div>
  <div class="foot-actions">
    <button type="button" on:click={exportState}><Download size={11} /> Export</button>
    <span>·</span>
    <button type="button" on:click={importState}><Upload size={11} /> Import</button>
    <span>·</span>
    <button type="button" on:click={resetState}><RotateCcw size={11} /> Reset</button>
  </div>
</footer>

<style>
  .page-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    margin: 4px 0 16px;
  }
  .page-header .eyebrow {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
    margin: 0 0 4px;
    font-weight: 500;
  }
  .page-header h1 {
    font-size: 22px;
    font-weight: 600;
    letter-spacing: -0.005em;
    margin: 0 0 4px;
  }
  .page-header .lede { margin: 0; color: var(--muted); font-size: 12.5px; }
  .header-links { display: flex; gap: 8px; }

  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
  }
  .card-pad { padding: 12px 14px; }

  .profile-strip {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 12px;
    align-items: center;
    margin-bottom: 12px;
  }
  .profile-block .profile-text { color: var(--text); font-size: 13.5px; line-height: 1.5; }
  .eyebrow-mini {
    display: block;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
    margin-bottom: 3px;
  }

  .toolbar {
    position: sticky;
    top: 0;
    z-index: 5;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    padding: 10px 0;
    background: var(--bg);
    border-bottom: 1px solid var(--border);
    margin-bottom: 12px;
  }
  .search {
    flex: 1;
    min-width: 200px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 7px 10px;
    color: var(--text);
    font-size: 13px;
  }
  .search:focus { outline: 2px solid var(--accent); outline-offset: -1px; }

  .chip-group {
    display: flex;
    gap: 3px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 3px;
  }
  .chip {
    background: transparent;
    border: 0;
    color: var(--text-soft);
    padding: 5px 9px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    letter-spacing: 0.01em;
  }
  .chip:hover { color: var(--text); background: var(--surface-muted); }
  .chip.active {
    background: var(--primary-bg);
    color: var(--primary-text);
  }
  .chip .count {
    font-variant-numeric: tabular-nums;
    font-size: 11px;
    opacity: 0.85;
  }

  .sortsel {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 6px 10px;
    color: var(--text);
    font-size: 12.5px;
  }

  .btn {
    background: var(--primary-bg);
    color: var(--primary-text);
    border: 1px solid var(--primary-bg);
    border-radius: 6px;
    padding: 6px 12px;
    font-size: 12.5px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    line-height: 1;
  }
  .btn:hover { filter: brightness(1.08); }
  .btn.ghost {
    background: transparent;
    color: var(--text-soft);
    border-color: var(--border);
  }
  .btn.ghost:hover { color: var(--text); border-color: var(--border-strong); background: var(--surface-muted); }
  .btn.primary { background: var(--primary-bg); color: var(--primary-text); }

  .list { display: flex; flex-direction: column; gap: 8px; }

  .job {
    display: grid;
    grid-template-columns: 52px 1fr auto;
    gap: 12px;
    padding: 12px 14px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    align-items: start;
    transition: border-color 0.12s;
  }
  .job:hover { border-color: var(--border-strong); }
  .job[data-status='applied'] { opacity: 0.7; }
  .job[data-status='dismissed'] { display: none; }
  .job[data-status='interested'] {
    border-left: 3px solid var(--warning-border);
    padding-left: 11px;
  }

  .fit-col { display: flex; flex-direction: column; align-items: center; gap: 2px; padding-top: 2px; }
  .fit-badge {
    background: var(--surface-muted);
    color: var(--text);
    border-radius: 5px;
    padding: 4px 6px;
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    font-size: 14px;
    min-width: 40px;
    text-align: center;
  }
  .job[data-fittier='high'] .fit-badge {
    background: var(--warning-bg);
    color: var(--warning-text);
    border: 1px solid var(--warning-border);
  }
  .job[data-fittier='low'] .fit-badge { color: var(--muted); }
  .fit-lbl {
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--muted);
  }

  .body-col { min-width: 0; }
  .row1 { display: flex; align-items: baseline; flex-wrap: wrap; gap: 8px; }
  .company { font-size: 15px; font-weight: 600; color: var(--text); }
  .role { font-size: 13px; color: var(--text-soft); }

  .tag {
    display: inline-flex;
    padding: 2px 7px;
    border-radius: 3px;
    font-size: 10.5px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--muted);
    border: 1px solid var(--border);
    background: var(--surface-muted);
    font-weight: 500;
  }
  .tag-tier { color: var(--text-soft); border-color: var(--border-strong); }
  .tag-success { color: var(--success-text); background: var(--success-bg); border-color: var(--success-border); }
  .tag-warning { color: var(--warning-text); background: var(--warning-bg); border-color: var(--warning-border); }
  .tag-info { color: var(--text); background: var(--active); border-color: var(--border-strong); }

  .bullets {
    margin: 6px 0 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 3px;
    color: var(--text-soft);
    font-size: 12.5px;
  }
  .bullets li::before {
    content: '·';
    color: var(--muted);
    margin-right: 6px;
    font-weight: 700;
  }

  .action-col { display: flex; flex-direction: column; gap: 5px; min-width: 155px; }
  .status-btns { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 3px; }
  .sbtn {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--muted);
    border-radius: 4px;
    padding: 5px 3px;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 3px;
  }
  .sbtn:hover { color: var(--text); border-color: var(--border-strong); }
  .sbtn-active-star {
    background: var(--warning-bg);
    color: var(--warning-text);
    border-color: var(--warning-border);
  }
  .sbtn-active-applied {
    background: var(--success-bg);
    color: var(--success-text);
    border-color: var(--success-border);
  }
  .sbtn-active-dismiss {
    background: var(--surface-muted);
    color: var(--muted);
    border-color: var(--border-strong);
  }
  .apply {
    background: var(--primary-bg);
    color: var(--primary-text);
    padding: 7px 10px;
    border-radius: 5px;
    text-decoration: none;
    font-size: 12px;
    text-align: center;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    letter-spacing: 0.01em;
  }
  .apply:hover { filter: brightness(1.08); }
  .notes-toggle {
    background: transparent;
    border: 0;
    color: var(--muted);
    font-size: 10.5px;
    text-align: right;
    cursor: pointer;
    padding: 2px 0;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .notes-toggle:hover { color: var(--text); }

  .detail {
    grid-column: 1 / -1;
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px dashed var(--border);
    display: grid;
    grid-template-columns: 2fr 1fr;
    gap: 16px;
  }
  .detail h4 {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
    margin: 0 0 5px;
    font-weight: 500;
  }
  .detail .body-text { font-size: 12.5px; color: var(--text-soft); margin: 0 0 12px; line-height: 1.55; }
  .detail textarea {
    width: 100%;
    background: var(--surface-muted);
    border: 1px solid var(--border);
    border-radius: 5px;
    padding: 8px;
    font-size: 12px;
    color: var(--text);
    resize: vertical;
    min-height: 70px;
    font-family: inherit;
  }
  .detail-meta {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 12px;
    font-size: 12px;
    margin: 0;
  }
  .detail-meta dt {
    color: var(--muted);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding-top: 2px;
  }
  .detail-meta dd { margin: 0; color: var(--text); }

  .empty {
    text-align: center;
    padding: 40px 20px;
    color: var(--muted);
    font-style: italic;
    background: var(--surface);
    border: 1px dashed var(--border);
    border-radius: 8px;
  }

  .ollama { margin-top: 24px; }
  .ollama-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 14px; margin-bottom: 10px; flex-wrap: wrap; }
  .ollama h3 { margin: 0 0 3px; font-size: 15px; }
  .ollama .mini { color: var(--muted); font-size: 12px; margin: 0; }
  .ollama-actions { display: flex; gap: 6px; }
  .ollama-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .ollama-grid label.full { grid-column: 1 / -1; }
  .ollama-grid input,
  .ollama-grid textarea {
    width: 100%;
    background: var(--surface-muted);
    border: 1px solid var(--border);
    border-radius: 5px;
    padding: 7px 9px;
    color: var(--text);
    font-size: 12.5px;
    font-family: inherit;
  }
  .ollama-grid textarea { resize: vertical; min-height: 50px; }
  .status {
    margin-top: 10px;
    padding: 8px 10px;
    background: var(--surface-muted);
    border: 1px solid var(--border);
    border-radius: 5px;
    color: var(--text-soft);
    font-size: 11.5px;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: ui-monospace, "SF Mono", "Cascadia Code", Consolas, monospace;
  }
  .status.err { color: var(--error-text); background: var(--error-bg); border-color: var(--error-border); }
  .status.ok { color: var(--success-text); background: var(--success-bg); border-color: var(--success-border); }
  .help { margin-top: 12px; }
  .help summary { cursor: pointer; color: var(--muted); font-size: 12px; }
  .help-body { padding: 8px 0 0; color: var(--text-soft); font-size: 12.5px; }
  .help-body code {
    font-family: ui-monospace, "SF Mono", "Cascadia Code", Consolas, monospace;
    background: var(--surface-muted);
    padding: 1px 5px;
    border-radius: 3px;
    border: 1px solid var(--border);
    font-size: 11.5px;
  }

  .foot {
    margin-top: 24px;
    padding-top: 14px;
    border-top: 1px solid var(--border);
    color: var(--muted);
    font-size: 11px;
    display: flex;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }
  .foot-actions { display: flex; gap: 6px; align-items: center; }
  .foot-actions button {
    background: transparent;
    border: 0;
    color: var(--muted);
    font: inherit;
    font-size: 11px;
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 2px;
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }
  .foot-actions button:hover { color: var(--text); }

  @media (max-width: 720px) {
    .job { grid-template-columns: 44px 1fr; }
    .action-col { grid-column: 1 / -1; flex-direction: row; flex-wrap: wrap; }
    .status-btns { flex: 1; min-width: 180px; }
    .apply { flex: 1; }
    .detail { grid-template-columns: 1fr; }
    .ollama-grid { grid-template-columns: 1fr; }
    .toolbar { position: static; }
  }
</style>
