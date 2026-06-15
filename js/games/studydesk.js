/* Study Desk - local-first study planner with optional NeetCode GitHub sync. */
Arcade.register({
  id: 'studydesk',
  name: 'Study Desk',
  emoji: 'ST',
  desc: 'Track Exam P prep, quant interview study, coding practice, and synced NeetCode submissions.',
  color: '#7aa36f',
  kind: 'tool',
  scoreKey: false,

  start(root) {
    const STORE_KEY = 'studyDesk.state.v1';
    const REPO = 'elc9939/neetcode-submissions';
    const REPO_TREE_URL = `https://api.github.com/repos/${REPO}/git/trees/main?recursive=1`;
    const AUTO_SYNC_MS = 6 * 60 * 60 * 1000;

    const TRACKS = [
      {
        id: 'examP',
        name: 'Exam P',
        short: 'P',
        accent: '#7aa36f',
        goal: 'Probability fundamentals, speed, and exam-style endurance.',
      },
      {
        id: 'quant',
        name: 'Quant Prep',
        short: 'Q',
        accent: '#6f8fb8',
        goal: 'Probability puzzles, mental math, stats intuition, and market-style reasoning.',
      },
      {
        id: 'coding',
        name: 'Coding Practice',
        short: 'C',
        accent: '#b88a56',
        goal: 'NeetCode, data structures, algorithms, and clean implementation fluency.',
      },
    ];

    const DEFAULT_TOPICS = {
      examP: [
        { id: 'counting', title: 'Counting, combinations, and conditional probability' },
        { id: 'bayes', title: 'Bayes theorem and law of total probability' },
        { id: 'discrete-rv', title: 'Discrete random variables and common distributions' },
        { id: 'continuous-rv', title: 'Continuous random variables, PDFs, CDFs, transforms' },
        { id: 'expectation', title: 'Expectation, variance, covariance, and mixed practice' },
        { id: 'mock-exams', title: 'Timed practice exams and error review' },
      ],
      quant: [
        { id: 'mental-math', title: 'Mental math and estimation drills' },
        { id: 'probability-puzzles', title: 'Classic probability and brainteaser sets' },
        { id: 'stats-modeling', title: 'Statistics, regression, and model intuition' },
        { id: 'markets', title: 'Market making, EV, variance, and risk conversations' },
        { id: 'resume-stories', title: 'Research/project stories and technical explanations' },
      ],
      coding: [
        { id: 'arrays-hash', title: 'Arrays, hash maps, and two pointers' },
        { id: 'stack-queue', title: 'Stacks, queues, heaps, and intervals' },
        { id: 'trees-graphs', title: 'Trees, graphs, BFS, DFS, and union find' },
        { id: 'dp', title: 'Dynamic programming patterns' },
        { id: 'systems-clean-code', title: 'Writing cleaner code and explaining tradeoffs' },
      ],
    };

    const trackById = id => TRACKS.find(t => t.id === id) || TRACKS[0];
    const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const todayISO = () => new Date().toISOString().slice(0, 10);
    const nowISO = () => new Date().toISOString();
    const uid = () => 'study_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    const minutes = value => Math.max(0, Math.min(720, Math.round(Number(value) || 0)));

    const state = loadState();

    const style = document.createElement('style');
    style.textContent = `
      .sd{--sd-bg:#f4f5f1;--sd-bg2:#eceee8;--sd-panel:#fff;--sd-surface:#fbfcf8;--sd-line:#d9ded4;--sd-line2:#e7ebe2;--sd-text:#182019;--sd-muted:#657064;--sd-chip:#f3f6ef;--sd-good:#3d8b5b;--sd-warn:#9a6a2d;--sd-bad:#a64731;position:absolute;inset:0;padding:calc(var(--topbar-h,58px) + 12px) 16px 16px;background:linear-gradient(180deg,var(--sd-bg),var(--sd-bg2));color:var(--sd-text);font-family:Inter,"Segoe UI",system-ui,sans-serif;overflow:hidden}
      :root[data-theme="dark"] .sd{--sd-bg:#101411;--sd-bg2:#141a16;--sd-panel:#182019;--sd-surface:#131914;--sd-line:#2e3a31;--sd-line2:#253029;--sd-text:#edf3ea;--sd-muted:#a9b5a7;--sd-chip:#1f2a22;--sd-good:#80c994;--sd-warn:#d7ab6b;--sd-bad:#e08372}
      .sd *{box-sizing:border-box}
      .sd button,.sd input,.sd select,.sd textarea{font:inherit}
      .sd button{cursor:pointer}
      .sd-shell{height:100%;display:grid;grid-template-columns:minmax(0,1fr) 370px;gap:14px;min-height:0}
      .sd-main,.sd-side-panel,.sd-card,.sd-panel{border:1px solid var(--sd-line);border-radius:8px;background:var(--sd-panel);box-shadow:0 12px 28px rgba(0,0,0,.12)}
      .sd-main{display:flex;flex-direction:column;min-width:0;min-height:0;overflow:hidden}
      .sd-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:16px;border-bottom:1px solid var(--sd-line2);background:var(--sd-surface)}
      .sd-title h2{margin:0 0 4px;font-size:22px;line-height:1.1;color:var(--sd-text)}
      .sd-title p{margin:0;max-width:720px;color:var(--sd-muted);font-size:13px;line-height:1.4}
      .sd-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}
      .sd-btn{border:1px solid var(--sd-line);border-radius:8px;background:var(--sd-panel);color:var(--sd-text);padding:8px 11px;font-weight:800}
      .sd-btn:hover{border-color:var(--track,#7aa36f);background:color-mix(in srgb,var(--track,#7aa36f) 12%,var(--sd-panel))}
      .sd-btn.primary{border-color:var(--sd-good);background:var(--sd-good);color:#fff}
      .sd-btn.slim{min-height:28px;padding:5px 8px;font-size:12px}
      .sd-content{min-height:0;overflow:auto;padding:14px;display:grid;gap:14px}
      .sd-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
      .sd-stat{border:1px solid var(--sd-line);border-radius:8px;background:var(--sd-surface);padding:11px}
      .sd-stat b{display:block;font-size:22px;line-height:1;color:var(--sd-text)}
      .sd-stat span{display:block;margin-top:5px;color:var(--sd-muted);font-size:12px;font-weight:800}
      .sd-log{border:1px solid var(--sd-line);border-radius:8px;background:var(--sd-panel);padding:12px}
      .sd-log h3,.sd-panel h3,.sd-card h3{margin:0;color:var(--sd-text)}
      .sd-log-grid{display:grid;grid-template-columns:150px 120px minmax(180px,1fr) auto;gap:8px;align-items:end;margin-top:10px}
      .sd-field{display:grid;gap:4px}
      .sd-field span{font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:.05em;color:var(--sd-muted)}
      .sd input,.sd select,.sd textarea{width:100%;border:1px solid var(--sd-line);border-radius:8px;background:var(--sd-panel);color:var(--sd-text);padding:8px 9px;outline:none}
      .sd input:focus,.sd select:focus,.sd textarea:focus{border-color:var(--track,#7aa36f);box-shadow:0 0 0 3px color-mix(in srgb,var(--track,#7aa36f) 16%,transparent)}
      .sd-lanes{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
      .sd-card{--track:#7aa36f;overflow:hidden}
      .sd-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:12px;border-bottom:1px solid var(--sd-line2);background:linear-gradient(90deg,color-mix(in srgb,var(--track) 12%,var(--sd-surface)),var(--sd-surface))}
      .sd-track-mark{display:grid;place-items:center;width:34px;height:34px;border:1px solid color-mix(in srgb,var(--track) 45%,var(--sd-line));border-radius:8px;background:color-mix(in srgb,var(--track) 12%,var(--sd-panel));color:var(--track);font-weight:950}
      .sd-card-head p{margin:4px 0 0;color:var(--sd-muted);font-size:12px;line-height:1.35}
      .sd-progress{padding:10px 12px;border-bottom:1px solid var(--sd-line2)}
      .sd-progress-top{display:flex;justify-content:space-between;gap:8px;color:var(--sd-muted);font-size:12px;font-weight:800}
      .sd-bar{height:8px;margin-top:7px;border:1px solid var(--sd-line2);border-radius:999px;background:var(--sd-chip);overflow:hidden}
      .sd-bar span{display:block;height:100%;border-radius:inherit;background:var(--track);width:var(--pct)}
      .sd-topics{display:grid;gap:7px;padding:10px 12px}
      .sd-topic{display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px;align-items:start;border:1px solid var(--sd-line2);border-radius:8px;background:var(--sd-surface);padding:8px;text-align:left;color:var(--sd-text)}
      .sd-topic:hover{border-color:var(--track)}
      .sd-check{display:grid;place-items:center;width:18px;height:18px;border:1px solid var(--sd-line);border-radius:5px;color:#fff;background:var(--sd-panel);font-size:12px;font-weight:900}
      .sd-topic.done .sd-check{border-color:var(--track);background:var(--track)}
      .sd-topic.done span{text-decoration:line-through;color:var(--sd-muted)}
      .sd-quick{display:flex;flex-wrap:wrap;gap:6px;padding:0 12px 12px}
      .sd-side{min-width:0;min-height:0;overflow:auto;display:grid;gap:12px;align-content:start}
      .sd-panel{padding:12px}
      .sd-panel-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:10px}
      .sd-panel p{margin:4px 0 0;color:var(--sd-muted);font-size:12px;line-height:1.35}
      .sd-github-stats{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:10px 0}
      .sd-mini-stat{border:1px solid var(--sd-line2);border-radius:8px;background:var(--sd-surface);padding:9px}
      .sd-mini-stat b{display:block;color:var(--sd-text);font-size:18px}
      .sd-mini-stat span{display:block;margin-top:2px;color:var(--sd-muted);font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.04em}
      .sd-repo-line{display:flex;justify-content:space-between;gap:8px;border:1px solid var(--sd-line2);border-radius:8px;background:var(--sd-chip);padding:8px;margin-top:8px;color:var(--sd-muted);font-size:12px}
      .sd-problem-list,.sd-session-list,.sd-plan{display:grid;gap:7px}
      .sd-problem,.sd-session,.sd-plan li{border:1px solid var(--sd-line2);border-radius:8px;background:var(--sd-surface);padding:8px;color:var(--sd-muted);font-size:12px;line-height:1.35}
      .sd-problem b,.sd-session b{display:block;color:var(--sd-text);font-size:13px}
      .sd-problem small,.sd-session small{display:block;margin-top:2px;color:var(--sd-muted)}
      .sd-plan{margin:0;padding:0;list-style:none}
      .sd-settings{display:grid;grid-template-columns:1fr 1fr auto;gap:8px;align-items:end}
      .sd-toast{border:1px solid color-mix(in srgb,var(--sd-warn) 40%,var(--sd-line));background:color-mix(in srgb,var(--sd-warn) 13%,var(--sd-panel));color:var(--sd-warn);border-radius:8px;padding:8px;margin-top:8px;font-size:12px;line-height:1.35}
      .sd-empty{padding:12px;text-align:center;color:var(--sd-muted);font-weight:800;border:1px dashed var(--sd-line);border-radius:8px;background:var(--sd-surface)}
      @media(max-width:1080px){.sd-shell{grid-template-columns:1fr}.sd-side{grid-template-columns:1fr 1fr}.sd-lanes{grid-template-columns:1fr}.sd-log-grid{grid-template-columns:1fr 1fr}.sd-log-grid .wide{grid-column:1/-1}}
      @media(max-width:720px){.sd{padding:58px 8px 8px}.sd-head{flex-direction:column;padding:12px}.sd-actions{justify-content:flex-start}.sd-content{padding:9px}.sd-stats{grid-template-columns:1fr 1fr}.sd-side{grid-template-columns:1fr}.sd-log-grid,.sd-settings{grid-template-columns:1fr}.sd-log-grid .wide{grid-column:auto}}
    `;
    root.appendChild(style);

    const wrap = document.createElement('div');
    wrap.className = 'sd';
    root.appendChild(wrap);

    function createDefaults() {
      return {
        settings: { examDate: '', weeklyGoal: 600 },
        topics: Object.fromEntries(Object.entries(DEFAULT_TOPICS).map(([track, topics]) => [
          track,
          topics.map(topic => ({ ...topic, done: false, updatedAt: '' })),
        ])),
        sessions: [],
        github: {
          repo: REPO,
          lastSync: '',
          status: 'idle',
          error: '',
          files: [],
          problems: [],
          submissions: 0,
          newPaths: [],
        },
      };
    }

    function loadState() {
      let loaded = null;
      try { loaded = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) {}
      const base = createDefaults();
      if (!loaded || typeof loaded !== 'object') return base;
      base.settings = { ...base.settings, ...(loaded.settings || {}) };
      base.sessions = Array.isArray(loaded.sessions) ? loaded.sessions.map(normalizeSession).filter(Boolean).slice(-500) : [];
      base.github = { ...base.github, ...(loaded.github || {}) };
      if (!Array.isArray(base.github.files)) base.github.files = [];
      if (!Array.isArray(base.github.problems)) base.github.problems = [];
      if (!Array.isArray(base.github.newPaths)) base.github.newPaths = [];

      for (const track of TRACKS) {
        const existing = Array.isArray(loaded.topics && loaded.topics[track.id]) ? loaded.topics[track.id] : [];
        const byId = new Map(existing.map(topic => [topic.id, topic]));
        base.topics[track.id] = DEFAULT_TOPICS[track.id].map(topic => ({
          ...topic,
          done: !!(byId.get(topic.id) && byId.get(topic.id).done),
          updatedAt: (byId.get(topic.id) && byId.get(topic.id).updatedAt) || '',
        }));
      }
      return base;
    }

    function normalizeSession(session) {
      if (!session || typeof session !== 'object') return null;
      const track = TRACKS.some(t => t.id === session.track) ? session.track : 'examP';
      const mins = minutes(session.minutes);
      if (!mins) return null;
      return {
        id: session.id || uid(),
        track,
        minutes: mins,
        notes: session.notes || '',
        date: session.date || todayISO(),
        createdAt: session.createdAt || nowISO(),
      };
    }

    function save() {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {}
    }

    function sessionsFor(days) {
      const cutoff = Date.now() - days * 86400000;
      return state.sessions.filter(s => new Date(s.date + 'T00:00:00').getTime() >= cutoff);
    }

    function totalMinutes(trackId, days) {
      return sessionsFor(days).filter(s => !trackId || s.track === trackId).reduce((sum, s) => sum + s.minutes, 0);
    }

    function completeCount(trackId) {
      return (state.topics[trackId] || []).filter(t => t.done).length;
    }

    function topicPercent(trackId) {
      const list = state.topics[trackId] || [];
      return list.length ? Math.round((completeCount(trackId) / list.length) * 100) : 0;
    }

    function formatMinutes(total) {
      const hours = Math.floor(total / 60);
      const mins = total % 60;
      if (hours && mins) return `${hours}h ${mins}m`;
      if (hours) return `${hours}h`;
      return `${mins}m`;
    }

    function formatDateTime(value) {
      if (!value) return 'Never';
      try {
        return new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      } catch (e) {
        return 'Unknown';
      }
    }

    function daysUntilExam() {
      if (!state.settings.examDate) return null;
      const today = new Date(todayISO() + 'T00:00:00').getTime();
      const exam = new Date(state.settings.examDate + 'T00:00:00').getTime();
      return Math.ceil((exam - today) / 86400000);
    }

    function planItems() {
      const items = [];
      const examNext = (state.topics.examP || []).find(t => !t.done);
      const quantNext = (state.topics.quant || []).find(t => !t.done);
      const codingNext = (state.topics.coding || []).find(t => !t.done);
      if (examNext) items.push(`Exam P: 45 minutes on ${examNext.title}.`);
      if (codingNext) items.push(`Coding: solve or review one problem for ${codingNext.title}.`);
      if (quantNext) items.push(`Quant: 25 minutes on ${quantNext.title}.`);
      if (!items.length) items.push('Everything in the default checklist is marked done. Add harder milestones next.');
      return items.slice(0, 4);
    }

    function render() {
      const today = totalMinutes(null, 1);
      const week = totalMinutes(null, 7);
      const weekGoal = Math.max(60, minutes(state.settings.weeklyGoal) || 600);
      const due = daysUntilExam();
      const github = state.github || {};
      const syncing = github.status === 'syncing';
      wrap.innerHTML = `
        <div class="sd-shell">
          <section class="sd-main">
            <header class="sd-head">
              <div class="sd-title">
                <h2>Study Desk</h2>
                <p>Plan and log Exam P, quant prep, and coding practice. Coding progress syncs from <b>${esc(REPO)}</b> when the app opens and the saved sync is stale.</p>
              </div>
              <div class="sd-actions">
                <button class="sd-btn" type="button" data-action="sync-code" ${syncing ? 'disabled' : ''}>${syncing ? 'Syncing...' : 'Sync NeetCode'}</button>
                <button class="sd-btn primary" type="button" data-action="quick-log" data-track="examP" data-minutes="45">Log Exam P 45m</button>
              </div>
            </header>

            <div class="sd-content">
              <section class="sd-stats" aria-label="Study summary">
                <div class="sd-stat"><b>${esc(formatMinutes(today))}</b><span>Logged today</span></div>
                <div class="sd-stat"><b>${esc(formatMinutes(week))}</b><span>This week / ${esc(formatMinutes(weekGoal))} goal</span></div>
                <div class="sd-stat"><b>${esc(topicPercent('examP'))}%</b><span>Exam P checklist</span></div>
                <div class="sd-stat"><b>${esc(github.problems.length || 0)}</b><span>Synced coding problems</span></div>
              </section>

              <section class="sd-log">
                <h3>Log a study session</h3>
                <form class="sd-log-grid" data-form="session">
                  <label class="sd-field"><span>Track</span><select name="track">${TRACKS.map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')}</select></label>
                  <label class="sd-field"><span>Minutes</span><input name="minutes" type="number" min="1" max="720" step="5" value="30"></label>
                  <label class="sd-field wide"><span>Notes</span><input name="notes" type="text" placeholder="What did you study or solve?"></label>
                  <button class="sd-btn primary" type="submit">Log</button>
                </form>
              </section>

              <section class="sd-lanes">
                ${TRACKS.map(track => trackCardHTML(track)).join('')}
              </section>
            </div>
          </section>

          <aside class="sd-side">
            <section class="sd-panel">
              <div class="sd-panel-head">
                <div><h3>Coding sync</h3><p>Auto-syncs on open if older than 6 hours. Manual sync is always available.</p></div>
                <button class="sd-btn slim" type="button" data-action="sync-code" ${syncing ? 'disabled' : ''}>Sync</button>
              </div>
              <div class="sd-github-stats">
                <div class="sd-mini-stat"><b>${esc(github.problems.length || 0)}</b><span>Problems</span></div>
                <div class="sd-mini-stat"><b>${esc(github.submissions || 0)}</b><span>Submissions</span></div>
              </div>
              <div class="sd-repo-line"><span>Last sync</span><b>${esc(formatDateTime(github.lastSync))}</b></div>
              ${github.error ? `<div class="sd-toast">${esc(github.error)}</div>` : ''}
              <div class="sd-problem-list">
                ${problemListHTML()}
              </div>
            </section>

            <section class="sd-panel">
              <div class="sd-panel-head">
                <div><h3>Study targets</h3><p>Keep this lightweight: dates, weekly minutes, and the next visible work.</p></div>
              </div>
              <form class="sd-settings" data-form="settings">
                <label class="sd-field"><span>Exam P date</span><input name="examDate" type="date" value="${esc(state.settings.examDate || '')}"></label>
                <label class="sd-field"><span>Weekly goal</span><input name="weeklyGoal" type="number" min="60" step="30" value="${esc(weekGoal)}"></label>
                <button class="sd-btn" type="submit">Save</button>
              </form>
              <div class="sd-repo-line"><span>Exam countdown</span><b>${due == null ? 'Set date' : due >= 0 ? `${due} days` : `${Math.abs(due)} days ago`}</b></div>
            </section>

            <section class="sd-panel">
              <h3>Suggested next session</h3>
              <ul class="sd-plan">${planItems().map(item => `<li>${esc(item)}</li>`).join('')}</ul>
            </section>

            <section class="sd-panel">
              <h3>Recent sessions</h3>
              <div class="sd-session-list">${recentSessionsHTML()}</div>
            </section>
          </aside>
        </div>`;
    }

    function trackCardHTML(track) {
      const topics = state.topics[track.id] || [];
      const done = completeCount(track.id);
      const pct = topicPercent(track.id);
      const week = totalMinutes(track.id, 7);
      return `<article class="sd-card" style="--track:${esc(track.accent)}">
        <div class="sd-card-head">
          <div>
            <h3>${esc(track.name)}</h3>
            <p>${esc(track.goal)}</p>
          </div>
          <span class="sd-track-mark">${esc(track.short)}</span>
        </div>
        <div class="sd-progress">
          <div class="sd-progress-top"><span>${done}/${topics.length} milestones</span><span>${esc(formatMinutes(week))} this week</span></div>
          <div class="sd-bar" style="--pct:${pct}%"><span></span></div>
        </div>
        <div class="sd-topics">
          ${topics.map(topic => `<button class="sd-topic ${topic.done ? 'done' : ''}" type="button" data-action="toggle-topic" data-track="${esc(track.id)}" data-topic="${esc(topic.id)}">
            <span class="sd-check">${topic.done ? '✓' : ''}</span>
            <span>${esc(topic.title)}</span>
          </button>`).join('')}
        </div>
        <div class="sd-quick">
          <button class="sd-btn slim" type="button" data-action="quick-log" data-track="${esc(track.id)}" data-minutes="25">+25m</button>
          <button class="sd-btn slim" type="button" data-action="quick-log" data-track="${esc(track.id)}" data-minutes="50">+50m</button>
          <button class="sd-btn slim" type="button" data-action="quick-log" data-track="${esc(track.id)}" data-minutes="90">+90m</button>
        </div>
      </article>`;
    }

    function problemListHTML() {
      const problems = (state.github.problems || []).slice(0, 8);
      if (!problems.length) return '<div class="sd-empty">No synced submissions yet. Click Sync NeetCode after your GitHub sync has pushed accepted solutions.</div>';
      const newSet = new Set(state.github.newPaths || []);
      return problems.map(problem => {
        const isNew = problem.files.some(file => newSet.has(file));
        return `<article class="sd-problem">
          <b>${esc(problem.problem)}${isNew ? ' · new' : ''}</b>
          <small>${esc(problem.topic)} · ${esc(problem.submissions)} submission${problem.submissions === 1 ? '' : 's'} · ${esc(problem.languages.join(', ') || 'unknown')}</small>
        </article>`;
      }).join('');
    }

    function recentSessionsHTML() {
      const recent = state.sessions.slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')).slice(0, 8);
      if (!recent.length) return '<div class="sd-empty">No sessions logged yet.</div>';
      return recent.map(session => {
        const track = trackById(session.track);
        return `<article class="sd-session">
          <b>${esc(track.name)} · ${esc(formatMinutes(session.minutes))}</b>
          <small>${esc(session.date)}${session.notes ? ' · ' + esc(session.notes) : ''}</small>
        </article>`;
      }).join('');
    }

    function addSession(track, mins, notes) {
      const amount = minutes(mins);
      if (!amount) return;
      state.sessions.push({ id: uid(), track: trackById(track).id, minutes: amount, notes: notes || '', date: todayISO(), createdAt: nowISO() });
      state.sessions = state.sessions.slice(-500);
      save();
      render();
    }

    function toggleTopic(trackId, topicId) {
      const list = state.topics[trackId] || [];
      const topic = list.find(item => item.id === topicId);
      if (!topic) return;
      topic.done = !topic.done;
      topic.updatedAt = nowISO();
      save();
      render();
    }

    function updateSettings(form) {
      state.settings.examDate = form.examDate.value || '';
      state.settings.weeklyGoal = Math.max(60, minutes(form.weeklyGoal.value) || 600);
      save();
      render();
    }

    function parseProblemFromPath(path) {
      const normalized = path.replace(/\\/g, '/');
      if (!/submission-\d+\.[a-z0-9]+$/i.test(normalized)) return null;
      const parts = normalized.split('/');
      if (parts.length < 3) return null;
      const file = parts[parts.length - 1];
      return {
        topic: parts[0],
        problem: parts.slice(1, -1).join('/'),
        file,
        language: (file.split('.').pop() || '').toLowerCase(),
        path: normalized,
      };
    }

    async function syncGithub() {
      state.github.status = 'syncing';
      state.github.error = '';
      render();
      try {
        const res = await fetch(REPO_TREE_URL, { headers: { Accept: 'application/vnd.github+json' } });
        if (!res.ok) throw new Error(`GitHub returned ${res.status}`);
        const type = res.headers.get('content-type') || '';
        if (!type.includes('json')) throw new Error('GitHub sync unavailable');
        const data = await res.json();
        const files = Array.isArray(data.tree) ? data.tree.filter(item => item.type === 'blob').map(item => parseProblemFromPath(item.path)).filter(Boolean) : [];
        const previous = new Set(state.github.files || []);
        const grouped = new Map();
        for (const file of files) {
          const key = `${file.topic}/${file.problem}`;
          if (!grouped.has(key)) grouped.set(key, { topic: file.topic, problem: file.problem, submissions: 0, languages: new Set(), files: [] });
          const entry = grouped.get(key);
          entry.submissions++;
          entry.languages.add(file.language);
          entry.files.push(file.path);
        }
        const problems = Array.from(grouped.values()).map(entry => ({
          topic: entry.topic,
          problem: entry.problem,
          submissions: entry.submissions,
          languages: Array.from(entry.languages).sort(),
          files: entry.files.sort(),
        })).sort((a, b) => a.topic.localeCompare(b.topic) || a.problem.localeCompare(b.problem));
        const paths = files.map(file => file.path).sort();
        state.github = {
          repo: REPO,
          lastSync: nowISO(),
          status: 'idle',
          error: '',
          files: paths,
          problems,
          submissions: paths.length,
          newPaths: paths.filter(path => !previous.has(path)).slice(0, 20),
        };
      } catch (err) {
        state.github.status = 'idle';
        state.github.error = `Could not sync ${REPO}: ${err.message || err}`;
      }
      save();
      render();
    }

    wrap.addEventListener('click', e => {
      const button = e.target.closest('[data-action]');
      if (!button) return;
      const action = button.dataset.action;
      if (action === 'quick-log') addSession(button.dataset.track, button.dataset.minutes, '');
      if (action === 'toggle-topic') toggleTopic(button.dataset.track, button.dataset.topic);
      if (action === 'sync-code') syncGithub();
    });

    wrap.addEventListener('submit', e => {
      const form = e.target;
      if (!(form instanceof HTMLFormElement)) return;
      e.preventDefault();
      if (form.dataset.form === 'session') {
        addSession(form.track.value, form.minutes.value, form.notes.value.trim());
      } else if (form.dataset.form === 'settings') {
        updateSettings(form);
      }
    });

    render();

    const lastSync = state.github.lastSync ? Date.parse(state.github.lastSync) : 0;
    if (!lastSync || Date.now() - lastSync > AUTO_SYNC_MS) {
      setTimeout(syncGithub, 300);
    }
  },
});
