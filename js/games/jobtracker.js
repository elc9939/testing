/* Career Desk - focused local-first job application tracker. */
Arcade.register({
  id: 'jobtracker',
  name: 'Career Desk',
  emoji: 'JOB',
  desc: 'Track job leads, applications, follow-ups, contacts, materials, and next actions in one clean workspace.',
  color: '#4fb477',
  kind: 'tool',
  scoreKey: false,

  start(root, api) {
    const STORE_KEY = 'careerDesk.jobs.v1';
    const EMAIL_SEED_KEY = 'careerDesk.emailSeed.v2';
    const EMAIL_SEED_URL = 'js/games/careerdesk-email-seed.json?v=3';
    const STAGES = [
      { id: 'saved', name: 'Saved', tone: '#64748b' },
      { id: 'applied', name: 'Applied', tone: '#2f80ed' },
      { id: 'interviewing', name: 'Interviewing', tone: '#9b6bdf' },
      { id: 'offer', name: 'Offer', tone: '#2f9e44' },
      { id: 'rejected', name: 'Rejected', tone: '#d9480f' },
      { id: 'archived', name: 'Archived', tone: '#6b7280' },
    ];
    const ACTIVE_STAGES = new Set(['saved', 'applied', 'interviewing', 'offer']);
    const PRIORITIES = ['High', 'Medium', 'Low'];
    const WORK_MODES = ['Remote', 'Hybrid', 'On-site', 'Flexible', 'Unknown'];
    const JOB_TYPES = ['Full-time', 'Part-time', 'Internship', 'Contract', 'Temporary', 'Unknown'];
    const COVER_STATUSES = ['Not needed', 'Not started', 'Drafted', 'Tailored', 'Submitted'];
    const VIEWS = [
      { id: 'todo', name: 'To-do' },
      { id: 'jobs', name: 'Jobs' },
      { id: 'table', name: 'Table' },
    ];

    const todayISO = () => new Date().toISOString().slice(0, 10);
    const nowISO = () => new Date().toISOString();
    const uid = () => 'job_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    const stageById = id => STAGES.find(s => s.id === id) || STAGES[0];
    const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const cleanList = value => String(value || '').split(',').map(v => v.trim()).filter(Boolean);
    const daysBetween = (a, b) => Math.floor((new Date(b).setHours(0, 0, 0, 0) - new Date(a).setHours(0, 0, 0, 0)) / 86400000);
    const formatDate = value => value ? new Date(value + 'T00:00:00').toLocaleDateString([], { month: 'short', day: 'numeric' }) : '';
    const dollars = n => n ? '$' + Number(n).toLocaleString() : '';
    const HISTORY_FIELDS = [
      ['title', 'role'],
      ['company', 'company'],
      ['priority', 'priority'],
      ['location', 'location'],
      ['workMode', 'work mode'],
      ['salaryMin', 'salary minimum'],
      ['salaryMax', 'salary maximum'],
      ['jobType', 'job type'],
      ['source', 'source'],
      ['link', 'link'],
      ['deadline', 'deadline'],
      ['dateApplied', 'date applied'],
      ['nextAction', 'next action'],
      ['nextActionDate', 'next action date'],
      ['contactName', 'contact name'],
      ['contactInfo', 'contact info'],
      ['resumeVersion', 'resume version'],
      ['coverStatus', 'cover letter'],
      ['tags', 'tags'],
      ['notes', 'notes'],
      ['description', 'job description'],
    ];

    const state = {
      jobs: loadJobs(),
      selectedId: null,
      draft: null,
      view: 'todo',
      query: '',
      stage: 'all',
      priority: 'all',
      sort: 'updated',
    };

    const style = document.createElement('style');
    style.textContent = `
      .jt{position:absolute;inset:0;padding:64px 16px 16px;background:#f5f7f4;color:#15211c;font-family:Inter,"Segoe UI",system-ui,sans-serif;overflow:hidden}
      .jt *{box-sizing:border-box}
      .jt button,.jt input,.jt select,.jt textarea{font:inherit}
      .jt-shell{height:100%;display:grid;grid-template-columns:minmax(0,1fr) 390px;gap:14px;min-height:0}
      .jt-main,.jt-detail{min-width:0;min-height:0;border:1px solid #d8ded7;background:#ffffff;border-radius:8px;box-shadow:0 12px 30px rgba(24,36,31,.08)}
      .jt-main{display:flex;flex-direction:column;overflow:hidden}
      .jt-detail{overflow:auto}
      .jt-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:16px;border-bottom:1px solid #e5e9e3;background:#fbfcfa}
      .jt-title h2{font-size:22px;line-height:1.1;margin:0 0 4px;color:#15211c}
      .jt-title p{font-size:13px;line-height:1.35;color:#647067;margin:0;max-width:620px}
      .jt-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}
      .jt-btn{border:1px solid #cdd6cd;background:#ffffff;color:#24312a;border-radius:8px;padding:9px 12px;font-weight:800;cursor:pointer}
      .jt-btn:hover{border-color:#4fb477;background:#f3fbf6}
      .jt-btn.primary{background:#256b48;color:#fff;border-color:#256b48}
      .jt-btn.primary:hover{background:#1f5c3e}
      .jt-btn.danger{border-color:#f1b4a1;color:#9d3313;background:#fff7f4}
      .jt-btn.danger[data-confirm="1"]{background:#b93616;color:#fff;border-color:#b93616}
      .jt-btn.slim{padding:6px 9px;font-size:12px}
      .jt-toolbar{display:grid;grid-template-columns:minmax(170px,1.4fr) repeat(4,minmax(120px,.7fr));gap:8px;padding:12px 16px;border-bottom:1px solid #e5e9e3;background:#fff}
      .jt-field{display:flex;flex-direction:column;gap:4px}
      .jt-field span{font-size:11px;font-weight:900;letter-spacing:.06em;text-transform:uppercase;color:#65736b}
      .jt input,.jt select,.jt textarea{width:100%;border:1px solid #ccd5cd;border-radius:8px;background:#fff;color:#15211c;padding:9px 10px;outline:none}
      .jt input:focus,.jt select:focus,.jt textarea:focus{border-color:#4fb477;box-shadow:0 0 0 3px rgba(79,180,119,.14)}
      .jt textarea{resize:vertical;min-height:74px;line-height:1.35}
      .jt-summary{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;padding:12px 16px;border-bottom:1px solid #e5e9e3;background:#f9faf8}
      .jt-stat{border:1px solid #e0e5df;border-radius:8px;background:#fff;padding:10px}
      .jt-stat b{display:block;font-size:22px;line-height:1;color:#18231d}
      .jt-stat span{display:block;margin-top:5px;font-size:12px;color:#637067;font-weight:800}
      .jt-content{min-height:0;overflow:auto;padding:14px;background:linear-gradient(180deg,#f5f7f4,#eef3ee)}
      .jt-todo,.jt-jobs{display:grid;gap:12px;align-content:start}
      .jt-task-section,.jt-list-section{border:1px solid #dce3dc;background:#fbfcfa;border-radius:8px;overflow:hidden}
      .jt-task-head,.jt-list-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 12px;border-bottom:1px solid #e6ebe5;background:#fff}
      .jt-task-head h3,.jt-list-head h3{margin:0;font-size:15px;color:#1b2a21}
      .jt-task-head p{margin:2px 0 0;font-size:12px;color:#68756d;line-height:1.3}
      .jt-task-count{font-size:12px;font-weight:900;color:#607067;border:1px solid #dfe6df;background:#f7f9f7;border-radius:999px;padding:3px 8px;white-space:nowrap}
      .jt-task-list,.jt-list-items{display:grid;gap:8px;padding:9px}
      .jt-task{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;border:1px solid #dce4dd;background:#fff;border-radius:8px;padding:10px;box-shadow:0 4px 10px rgba(24,36,31,.04)}
      .jt-task-main{min-width:0;border:0;background:transparent;color:inherit;text-align:left;padding:0;cursor:pointer}
      .jt-task-main:hover .jt-role{text-decoration:underline}
      .jt-task-text{margin-top:7px;font-size:13px;color:#394a40;line-height:1.3}
      .jt-task-actions{display:flex;align-items:center;justify-content:flex-end;gap:6px;flex-wrap:wrap}
      .jt-link-btn{display:inline-flex;align-items:center;justify-content:center;text-decoration:none;border:1px solid #cdd6cd;background:#fff;color:#24312a;border-radius:8px;padding:6px 9px;font-weight:900;font-size:12px;min-height:30px}
      .jt-link-btn:hover{border-color:#4fb477;background:#f3fbf6}
      .jt-stage-strip{display:flex;gap:7px;flex-wrap:wrap;padding:10px 16px;border-bottom:1px solid #e5e9e3;background:#fbfcfa}
      .jt-stage-pill{border:1px solid #d8e0d8;background:#fff;color:#24312a;border-radius:999px;padding:7px 10px;font-size:12px;font-weight:900;cursor:pointer}
      .jt-stage-pill.active{background:#256b48;color:#fff;border-color:#256b48}
      .jt-board{display:grid;grid-template-columns:repeat(6,minmax(220px,1fr));gap:10px;min-height:100%}
      .jt-col{min-height:260px;border:1px solid #dce3dc;background:#fbfcfa;border-radius:8px;display:flex;flex-direction:column;overflow:hidden}
      .jt-col-head{display:flex;align-items:center;justify-content:space-between;padding:10px 11px;border-bottom:1px solid #e6ebe5;background:#fff}
      .jt-col-name{display:flex;align-items:center;gap:7px;font-weight:900;color:#1d2b22}
      .jt-dot{width:9px;height:9px;border-radius:50%;background:var(--stage)}
      .jt-count{font-size:12px;color:#667269;font-weight:900}
      .jt-cards{display:grid;gap:8px;padding:9px;align-content:start}
      .jt-card{border:1px solid #dce4dd;background:#fff;border-radius:8px;padding:10px;text-align:left;color:inherit;cursor:pointer;box-shadow:0 4px 10px rgba(24,36,31,.04)}
      .jt-card:hover,.jt-card.active{border-color:#4fb477;box-shadow:0 8px 18px rgba(24,36,31,.10)}
      .jt-card-top{display:flex;justify-content:space-between;align-items:flex-start;gap:8px}
      .jt-role{font-weight:900;font-size:14px;color:#142119;line-height:1.2}
      .jt-company{font-size:13px;color:#4f5f55;margin-top:2px;font-weight:700}
      .jt-meta{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}
      .jt-chip{display:inline-flex;align-items:center;gap:4px;border:1px solid #dbe2db;background:#f7f9f7;border-radius:999px;padding:3px 7px;font-size:11px;font-weight:800;color:#526258;white-space:nowrap}
      .jt-chip.high{border-color:#ffc9bc;background:#fff3ef;color:#9d3416}
      .jt-chip.medium{border-color:#f2dda0;background:#fffaf0;color:#785e12}
      .jt-chip.low{border-color:#c9decf;background:#f1faf3;color:#2f6b44}
      .jt-next{margin-top:9px;border-top:1px solid #edf1ec;padding-top:8px}
      .jt-next b{display:block;font-size:11px;color:#68756d;text-transform:uppercase;letter-spacing:.04em}
      .jt-next span{display:block;font-size:13px;color:#223028;line-height:1.25;margin-top:2px}
      .jt-alert{color:#a13a18!important}
      .jt-empty{padding:22px;text-align:center;color:#718078;font-weight:800}
      .jt-table{width:100%;border-collapse:separate;border-spacing:0 8px}
      .jt-table th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#667269;padding:0 10px}
      .jt-table td{background:#fff;border-top:1px solid #dce4dd;border-bottom:1px solid #dce4dd;padding:11px 10px;font-size:13px}
      .jt-table td:first-child{border-left:1px solid #dce4dd;border-radius:8px 0 0 8px}
      .jt-table td:last-child{border-right:1px solid #dce4dd;border-radius:0 8px 8px 0}
      .jt-row{cursor:pointer}
      .jt-row:hover td{border-color:#4fb477}
      .jt-detail-head{position:sticky;top:0;z-index:2;background:#fbfcfa;border-bottom:1px solid #e5e9e3;padding:15px}
      .jt-detail-head h3{margin:0;font-size:18px;color:#16221a}
      .jt-detail-head p{margin:4px 0 0;color:#657269;font-size:13px}
      .jt-detail-body{padding:14px;display:grid;gap:13px}
      .jt-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
      .jt-form-grid .wide{grid-column:1/-1}
      .jt-section{border:1px solid #e0e6df;border-radius:8px;padding:12px;background:#fff}
      .jt-section h4{margin:0 0 10px;font-size:12px;text-transform:uppercase;letter-spacing:.07em;color:#607166}
      .jt-dupe{border:1px solid #f1c7b4;background:#fff7f2;color:#873718;border-radius:8px;padding:9px;font-size:12px;font-weight:800}
      .jt-history{display:grid;gap:7px}
      .jt-history-row{font-size:12px;color:#5f6d65;border-left:3px solid #d5ddd5;padding-left:8px}
      .jt-history-row b{color:#203127}
      .jt-detail-empty{height:100%;display:flex;align-items:center;justify-content:center;text-align:center;color:#708078;padding:30px;font-weight:800}
      .jt-footer-actions{display:flex;gap:8px;justify-content:space-between;flex-wrap:wrap}
      .jt-file{display:none}
      @media (max-width:1120px){
        .jt-shell{grid-template-columns:1fr}
        .jt-detail{position:absolute;right:16px;top:76px;bottom:16px;width:min(430px,calc(100vw - 32px));z-index:6;display:none}
        .jt-detail.open{display:block}
        .jt-board{grid-template-columns:repeat(3,minmax(220px,1fr))}
      }
      @media (max-width:760px){
        .jt{padding:58px 8px 8px}
        .jt-head{align-items:stretch;flex-direction:column;padding:12px}
        .jt-actions{justify-content:flex-start}
        .jt-toolbar{grid-template-columns:1fr 1fr;padding:10px}
        .jt-toolbar .jt-field:first-child{grid-column:1/-1}
        .jt-summary{grid-template-columns:1fr 1fr;padding:10px}
        .jt-content{padding:9px}
        .jt-task{grid-template-columns:1fr}
        .jt-task-actions{justify-content:flex-start}
        .jt-board{display:flex;overflow-x:auto;min-height:0}
        .jt-col{min-width:245px}
        .jt-form-grid{grid-template-columns:1fr}
        .jt-table-wrap{overflow:auto}
        .jt-table{min-width:760px}
      }
    `;
    root.appendChild(style);

    const wrap = document.createElement('div');
    wrap.className = 'jt';
    root.appendChild(wrap);

    function loadJobs() {
      try {
        const parsed = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
        return Array.isArray(parsed) ? parsed.map(normalizeJob).filter(Boolean) : [];
      } catch (e) {
        return [];
      }
    }

    function saveJobs() {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(state.jobs)); } catch (e) {}
    }

    function normalizeJob(job) {
      if (!job || typeof job !== 'object') return null;
      const createdAt = job.createdAt || nowISO();
      return {
        id: job.id || uid(),
        title: job.title || '',
        company: job.company || '',
        stage: STAGES.some(s => s.id === job.stage) ? job.stage : 'saved',
        priority: PRIORITIES.includes(job.priority) ? job.priority : 'Medium',
        location: job.location || '',
        workMode: WORK_MODES.includes(job.workMode) ? job.workMode : 'Unknown',
        salaryMin: job.salaryMin || '',
        salaryMax: job.salaryMax || '',
        jobType: JOB_TYPES.includes(job.jobType) ? job.jobType : 'Unknown',
        source: job.source || '',
        link: job.link || '',
        deadline: job.deadline || '',
        dateApplied: job.dateApplied || '',
        nextAction: job.nextAction || '',
        nextActionDate: job.nextActionDate || '',
        contactName: job.contactName || '',
        contactInfo: job.contactInfo || '',
        resumeVersion: job.resumeVersion || '',
        coverStatus: COVER_STATUSES.includes(job.coverStatus) ? job.coverStatus : 'Not started',
        tags: Array.isArray(job.tags) ? job.tags : cleanList(job.tags),
        notes: job.notes || '',
        description: job.description || '',
        history: Array.isArray(job.history) && job.history.length ? job.history : [{ at: createdAt, text: 'Created' }],
        createdAt,
        updatedAt: job.updatedAt || createdAt,
      };
    }

    function blankJob() {
      const t = nowISO();
      return normalizeJob({
        id: uid(),
        title: '',
        company: '',
        stage: 'saved',
        priority: 'Medium',
        workMode: 'Unknown',
        jobType: 'Unknown',
        coverStatus: 'Not started',
        createdAt: t,
        updatedAt: t,
        history: [{ at: t, text: 'Created' }],
      });
    }

    function selectedJob() {
      if (state.draft && state.selectedId === state.draft.id) return state.draft;
      return state.jobs.find(j => j.id === state.selectedId) || null;
    }

    function activeJobs() {
      return state.jobs.filter(j => ACTIVE_STAGES.has(j.stage));
    }

    function dueStatus(job) {
      if (!job.nextActionDate) return { text: '', due: false };
      const d = daysBetween(todayISO(), job.nextActionDate);
      if (d < 0) return { text: Math.abs(d) + 'd overdue', due: true };
      if (d === 0) return { text: 'due today', due: true };
      if (d === 1) return { text: 'tomorrow', due: false };
      return { text: 'in ' + d + 'd', due: false };
    }

    function isStale(job) {
      if (!ACTIVE_STAGES.has(job.stage)) return false;
      const date = (job.updatedAt || job.createdAt || nowISO()).slice(0, 10);
      return daysBetween(date, todayISO()) >= 14;
    }

    function duplicateFor(job) {
      if (!job || (!job.title && !job.company && !job.link)) return null;
      const title = job.title.trim().toLowerCase();
      const company = job.company.trim().toLowerCase();
      const link = job.link.trim().toLowerCase();
      return state.jobs.find(other => other.id !== job.id && (
        (link && other.link && other.link.trim().toLowerCase() === link) ||
        (title && company && other.title.trim().toLowerCase() === title && other.company.trim().toLowerCase() === company)
      ));
    }

    function sameValue(a, b) {
      const clean = value => Array.isArray(value) ? value.join('|') : String(value == null ? '' : value);
      return clean(a) === clean(b);
    }

    function listLabels(labels) {
      if (labels.length <= 1) return labels.join('');
      if (labels.length === 2) return labels.join(' and ');
      return labels.slice(0, -1).join(', ') + ', and ' + labels[labels.length - 1];
    }

    function filteredJobs() {
      const q = state.query.trim().toLowerCase();
      let jobs = state.jobs.filter(job => {
        if (state.stage !== 'all' && job.stage !== state.stage) return false;
        if (state.priority !== 'all' && job.priority !== state.priority) return false;
        if (!q) return true;
        const hay = [
          job.title, job.company, job.location, job.workMode, job.jobType, job.source,
          job.nextAction, job.contactName, job.contactInfo, job.resumeVersion,
          job.tags.join(' '), job.notes,
        ].join(' ').toLowerCase();
        return hay.includes(q);
      });
      jobs = jobs.slice().sort((a, b) => {
        if (state.sort === 'deadline') return (a.nextActionDate || a.deadline || '9999-99-99').localeCompare(b.nextActionDate || b.deadline || '9999-99-99');
        if (state.sort === 'priority') return PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority);
        if (state.sort === 'company') return (a.company || '').localeCompare(b.company || '');
        if (state.sort === 'stage') return STAGES.findIndex(s => s.id === a.stage) - STAGES.findIndex(s => s.id === b.stage);
        return (b.updatedAt || '').localeCompare(a.updatedAt || '');
      });
      return jobs;
    }

    function emailImportCount() {
      return state.jobs.filter(job => (job.source || '').toLowerCase() === 'email import' || job.tags.includes('email-import')).length;
    }

    function isTodoJob(job) {
      if (!job || job.stage === 'rejected' || job.stage === 'archived') return false;
      return job.stage === 'saved' || dueStatus(job).due || isStale(job) || job.stage === 'interviewing' || job.stage === 'offer';
    }

    function todoGroups(jobs) {
      const visible = jobs.filter(isTodoJob);
      const byId = new Set();
      const take = predicate => visible.filter(job => {
        if (byId.has(job.id) || !predicate(job)) return false;
        byId.add(job.id);
        return true;
      });
      const groups = [
        {
          id: 'apply',
          name: 'Apply / decide',
          hint: 'Saved leads that still need a yes/no and an application pass.',
          jobs: take(job => job.stage === 'saved'),
        },
        {
          id: 'updates',
          name: 'Check updates',
          hint: 'Active applications that are due, stale, or need an email/portal status check.',
          jobs: take(job => dueStatus(job).due || isStale(job)),
        },
        {
          id: 'active',
          name: 'Interview / offer track',
          hint: 'Items where the next action matters most.',
          jobs: take(job => job.stage === 'interviewing' || job.stage === 'offer'),
        },
      ];
      const remaining = visible.filter(job => !byId.has(job.id));
      if (remaining.length) {
        groups.push({
          id: 'watch',
          name: 'Watch list',
          hint: 'Applied roles that are current but still worth keeping in view.',
          jobs: remaining,
        });
      }
      return groups.filter(group => group.jobs.length);
    }

    function summary() {
      const active = activeJobs();
      const due = active.filter(j => dueStatus(j).due).length;
      const interviews = state.jobs.filter(j => j.stage === 'interviewing').length;
      const stale = active.filter(isStale).length;
      const todo = state.jobs.filter(isTodoJob).length;
      const email = emailImportCount();
      return { active: active.length, todo, due, interviews, stale, email };
    }

    function render() {
      const stats = summary();
      wrap.innerHTML = `
        <div class="jt-shell">
          <section class="jt-main">
            <div class="jt-head">
              <div class="jt-title">
                <h2>Career Desk</h2>
                <p>Job tracker centered on stages, follow-ups, application materials, and the next concrete action.</p>
              </div>
              <div class="jt-actions">
                ${VIEWS.map(view => `<button class="jt-btn ${state.view === view.id ? 'primary' : ''}" data-act="view" data-view="${view.id}">${view.name}</button>`).join('')}
                <button class="jt-btn primary" data-act="new">New Job</button>
                <button class="jt-btn" data-act="export-json">Export JSON</button>
                <button class="jt-btn" data-act="export-csv">Export CSV</button>
                <button class="jt-btn" data-act="import">Import</button>
                <input class="jt-file" type="file" accept="application/json,.json" data-import-file>
              </div>
            </div>
            <div class="jt-toolbar">
              <label class="jt-field"><span>Search</span><input data-filter="query" value="${esc(state.query)}" placeholder="Company, role, tag, contact"></label>
              <label class="jt-field"><span>Section</span>${selectHTML('stage', [{ id: 'all', name: 'All sections' }].concat(STAGES), state.stage)}</label>
              <label class="jt-field"><span>Priority</span>${selectHTML('priority', [{ id: 'all', name: 'All priorities' }].concat(PRIORITIES.map(p => ({ id: p, name: p }))), state.priority)}</label>
              <label class="jt-field"><span>Sort</span>${selectHTML('sort', [
                { id: 'updated', name: 'Last touched' },
                { id: 'deadline', name: 'Next deadline' },
                { id: 'priority', name: 'Priority' },
                { id: 'company', name: 'Company' },
                { id: 'stage', name: 'Stage' },
              ], state.sort)}</label>
              <label class="jt-field"><span>Reset</span><button class="jt-btn" data-act="clear-filters">Clear filters</button></label>
            </div>
            <div class="jt-summary">
              <div class="jt-stat"><b>${stats.todo}</b><span>To-do items</span></div>
              <div class="jt-stat"><b>${stats.active}</b><span>Active jobs</span></div>
              <div class="jt-stat"><b>${stats.due}</b><span>Due now</span></div>
              <div class="jt-stat"><b>${stats.interviews}</b><span>Interviewing</span></div>
              <div class="jt-stat"><b>${stats.email}</b><span>Email imports</span></div>
            </div>
            ${stageStripHTML()}
            <div class="jt-content">${contentHTML(filteredJobs())}</div>
          </section>
          <aside class="jt-detail ${selectedJob() ? 'open' : ''}">${detailHTML(selectedJob())}</aside>
        </div>
      `;
    }

    function renderKeepingFilterFocus(key, caret) {
      render();
      const field = wrap.querySelector(`[data-filter="${key}"]`);
      if (field) {
        field.focus();
        if (typeof field.setSelectionRange === 'function' && caret != null) {
          field.setSelectionRange(caret, caret);
        }
      }
    }

    function selectHTML(name, options, selected) {
      return `<select data-filter="${esc(name)}">${options.map(o => `<option value="${esc(o.id)}" ${o.id === selected ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select>`;
    }

    function chipClass(priority) {
      return String(priority || '').toLowerCase();
    }

    function contentHTML(jobs) {
      if (state.view === 'table') return tableHTML(jobs);
      if (state.view === 'jobs') return listHTML(jobs);
      return todoHTML(jobs);
    }

    function stageStripHTML() {
      if (state.view !== 'jobs') return '';
      const options = [{ id: 'all', name: 'All' }].concat(STAGES);
      return `<div class="jt-stage-strip">${options.map(stage => `<button class="jt-stage-pill ${state.stage === stage.id ? 'active' : ''}" data-act="stage-filter" data-stage="${stage.id}">${esc(stage.name)}</button>`).join('')}</div>`;
    }

    function todoHTML(jobs) {
      const groups = todoGroups(jobs);
      if (!groups.length) return '<div class="jt-empty">No current tasks. New scout leads, saved roles, stale applications, and interview follow-ups will show here.</div>';
      return `<div class="jt-todo">${groups.map(group => `<section class="jt-task-section">
        <div class="jt-task-head">
          <div><h3>${esc(group.name)}</h3><p>${esc(group.hint)}</p></div>
          <span class="jt-task-count">${group.jobs.length}</span>
        </div>
        <div class="jt-task-list">${group.jobs.map(job => taskHTML(job, group.id)).join('')}</div>
      </section>`).join('')}</div>`;
    }

    function listHTML(jobs) {
      if (!jobs.length) return '<div class="jt-empty">No jobs match the current filters.</div>';
      const sections = state.stage === 'all'
        ? STAGES.map(stage => ({ stage, jobs: jobs.filter(job => job.stage === stage.id) })).filter(section => section.jobs.length)
        : [{ stage: stageById(state.stage), jobs }];
      return `<div class="jt-jobs">${sections.map(section => `<section class="jt-list-section" style="--stage:${section.stage.tone}">
        <div class="jt-list-head"><div class="jt-col-name"><span class="jt-dot"></span>${esc(section.stage.name)}</div><span class="jt-task-count">${section.jobs.length}</span></div>
        <div class="jt-list-items">${section.jobs.map(cardHTML).join('')}</div>
      </section>`).join('')}</div>`;
    }

    function sourceChip(job) {
      if ((job.source || '').toLowerCase() === 'email import' || job.tags.includes('email-import')) return '<span class="jt-chip">Email import</span>';
      if (job.source) return `<span class="jt-chip">${esc(job.source)}</span>`;
      return '';
    }

    function taskHTML(job, groupId) {
      const due = dueStatus(job);
      const isSaved = job.stage === 'saved';
      const status = due.text || (isStale(job) ? 'stale 14d+' : stageById(job.stage).name);
      const actionText = job.nextAction || (isSaved ? 'Review the role and decide whether to apply.' : 'Check email or portal for the latest status.');
      return `<div class="jt-task">
        <button class="jt-task-main" data-act="select" data-id="${esc(job.id)}">
          <div class="jt-card-top">
            <div><div class="jt-role">${esc(job.title || 'Untitled role')}</div><div class="jt-company">${esc(job.company || 'Unknown company')}</div></div>
            <span class="jt-chip ${chipClass(job.priority)}">${esc(job.priority)}</span>
          </div>
          <div class="jt-meta">
            <span class="jt-chip">${esc(stageById(job.stage).name)}</span>
            ${job.location ? `<span class="jt-chip">${esc(job.location)}</span>` : ''}
            ${job.dateApplied ? `<span class="jt-chip">Applied ${esc(formatDate(job.dateApplied))}</span>` : ''}
            ${sourceChip(job)}
            ${status ? `<span class="jt-chip ${due.due || isStale(job) ? 'high' : ''}">${esc(status)}</span>` : ''}
          </div>
          <div class="jt-task-text">${esc(actionText)}</div>
        </button>
        <div class="jt-task-actions">
          ${job.link ? `<a class="jt-link-btn" href="${esc(job.link)}" target="_blank" rel="noreferrer">Open</a>` : ''}
          ${isSaved ? `<button class="jt-btn slim primary" data-act="mark-applied" data-id="${esc(job.id)}">Applied</button>` : ''}
          ${!isSaved && ACTIVE_STAGES.has(job.stage) ? `<button class="jt-btn slim" data-act="checked-email" data-id="${esc(job.id)}">Checked email</button>` : ''}
          ${groupId === 'apply' ? `<button class="jt-btn slim" data-act="archive" data-id="${esc(job.id)}">Skip</button>` : ''}
          ${!ACTIVE_STAGES.has(job.stage) ? `<button class="jt-btn slim" data-act="archive" data-id="${esc(job.id)}">Archive</button>` : ''}
        </div>
      </div>`;
    }

    function boardHTML(jobs) {
      const byStage = new Map(STAGES.map(s => [s.id, []]));
      jobs.forEach(job => byStage.get(job.stage).push(job));
      return `<div class="jt-board">${STAGES.map(stage => {
        const list = byStage.get(stage.id) || [];
        return `<section class="jt-col" style="--stage:${stage.tone}">
          <div class="jt-col-head"><div class="jt-col-name"><span class="jt-dot"></span>${stage.name}</div><div class="jt-count">${list.length}</div></div>
          <div class="jt-cards">${list.length ? list.map(cardHTML).join('') : '<div class="jt-empty">No jobs</div>'}</div>
        </section>`;
      }).join('')}</div>`;
    }

    function cardHTML(job) {
      const due = dueStatus(job);
      const salary = job.salaryMin || job.salaryMax ? `${dollars(job.salaryMin)}${job.salaryMin && job.salaryMax ? '-' : ''}${dollars(job.salaryMax)}` : '';
      const active = job.id === state.selectedId ? 'active' : '';
      return `<button class="jt-card ${active}" data-act="select" data-id="${job.id}">
        <div class="jt-card-top">
          <div><div class="jt-role">${esc(job.title || 'Untitled role')}</div><div class="jt-company">${esc(job.company || 'Unknown company')}</div></div>
          <span class="jt-chip ${chipClass(job.priority)}">${esc(job.priority)}</span>
        </div>
        <div class="jt-meta">
          ${job.location ? `<span class="jt-chip">${esc(job.location)}</span>` : ''}
          ${job.workMode && job.workMode !== 'Unknown' ? `<span class="jt-chip">${esc(job.workMode)}</span>` : ''}
          ${job.dateApplied ? `<span class="jt-chip">Applied ${esc(formatDate(job.dateApplied))}</span>` : ''}
          ${sourceChip(job)}
          ${salary ? `<span class="jt-chip">${esc(salary)}</span>` : ''}
          ${isStale(job) ? '<span class="jt-chip high">Stale</span>' : ''}
        </div>
        <div class="jt-next">
          <b>Next action ${due.text ? `<span class="${due.due ? 'jt-alert' : ''}">- ${esc(due.text)}</span>` : ''}</b>
          <span>${esc(job.nextAction || 'Decide the next move')}</span>
        </div>
      </button>`;
    }

    function tableHTML(jobs) {
      if (!jobs.length) return '<div class="jt-empty">No jobs match the current filters.</div>';
      return `<div class="jt-table-wrap"><table class="jt-table">
        <thead><tr><th>Role</th><th>Stage</th><th>Priority</th><th>Applied</th><th>Next action</th><th>Due</th><th>Location</th><th>Contact</th></tr></thead>
        <tbody>${jobs.map(job => {
          const due = dueStatus(job);
          return `<tr class="jt-row" data-act="select" data-id="${job.id}">
            <td><b>${esc(job.title || 'Untitled role')}</b><br><span>${esc(job.company || 'Unknown company')}</span></td>
            <td><span class="jt-chip">${esc(stageById(job.stage).name)}</span></td>
            <td><span class="jt-chip ${chipClass(job.priority)}">${esc(job.priority)}</span></td>
            <td>${esc(formatDate(job.dateApplied) || '')}</td>
            <td>${esc(job.nextAction || 'Decide the next move')}</td>
            <td class="${due.due ? 'jt-alert' : ''}">${esc(formatDate(job.nextActionDate) || formatDate(job.deadline) || '')}</td>
            <td>${esc([job.location, job.workMode !== 'Unknown' ? job.workMode : ''].filter(Boolean).join(' - '))}</td>
            <td>${esc(job.contactName || job.contactInfo || '')}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>`;
    }

    function detailHTML(job) {
      if (!job) {
        return `<div class="jt-detail-empty">
          <div>
            <div style="font-size:22px;margin-bottom:8px;color:#1d2b22">No job selected</div>
            <button class="jt-btn primary" data-act="new">New Job</button>
          </div>
        </div>`;
      }
      const dupe = duplicateFor(job);
      return `<div class="jt-detail-head">
        <h3>${esc(job.title || 'New job')}</h3>
        <p>${esc(job.company || 'Company not set')} ${job.stage ? '- ' + esc(stageById(job.stage).name) : ''}</p>
      </div>
      <form class="jt-detail-body" data-form="job">
        <input type="hidden" name="id" value="${esc(job.id)}">
        ${dupe ? `<div class="jt-dupe">Possible duplicate: ${esc(dupe.company)} - ${esc(dupe.title)}</div>` : ''}
        <section class="jt-section">
          <h4>Core</h4>
          <div class="jt-form-grid">
            ${inputField('Role title', 'title', job.title, 'text', true)}
            ${inputField('Company', 'company', job.company, 'text', true)}
            ${selectField('Stage', 'stage', STAGES.map(s => ({ id: s.id, name: s.name })), job.stage)}
            ${selectField('Priority', 'priority', PRIORITIES.map(p => ({ id: p, name: p })), job.priority)}
            ${inputField('Location', 'location', job.location)}
            ${selectField('Work mode', 'workMode', WORK_MODES.map(v => ({ id: v, name: v })), job.workMode)}
            ${inputField('Salary min', 'salaryMin', job.salaryMin, 'number')}
            ${inputField('Salary max', 'salaryMax', job.salaryMax, 'number')}
            ${selectField('Job type', 'jobType', JOB_TYPES.map(v => ({ id: v, name: v })), job.jobType)}
            ${inputField('Source', 'source', job.source)}
            ${inputField('Job link', 'link', job.link, 'url', false, 'wide')}
          </div>
        </section>
        <section class="jt-section">
          <h4>Next action</h4>
          <div class="jt-form-grid">
            ${inputField('Next action', 'nextAction', job.nextAction, 'text', false, 'wide')}
            ${inputField('Next action date', 'nextActionDate', job.nextActionDate, 'date')}
            ${inputField('Deadline', 'deadline', job.deadline, 'date')}
            ${inputField('Date applied', 'dateApplied', job.dateApplied, 'date')}
            ${inputField('Tags', 'tags', job.tags.join(', '), 'text', false, 'wide')}
          </div>
        </section>
        <section class="jt-section">
          <h4>Contacts and materials</h4>
          <div class="jt-form-grid">
            ${inputField('Contact name', 'contactName', job.contactName)}
            ${inputField('Contact info', 'contactInfo', job.contactInfo)}
            ${inputField('Resume version', 'resumeVersion', job.resumeVersion)}
            ${selectField('Cover letter', 'coverStatus', COVER_STATUSES.map(v => ({ id: v, name: v })), job.coverStatus)}
          </div>
        </section>
        <section class="jt-section">
          <h4>Notes</h4>
          <label class="jt-field"><span>Notes</span><textarea name="notes">${esc(job.notes)}</textarea></label>
          <label class="jt-field" style="margin-top:10px"><span>Job description</span><textarea name="description" style="min-height:130px">${esc(job.description)}</textarea></label>
        </section>
        <section class="jt-section">
          <h4>History</h4>
          <div class="jt-history">${job.history.slice().reverse().slice(0, 8).map(h => `<div class="jt-history-row"><b>${esc(new Date(h.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}</b> ${esc(h.text)}</div>`).join('')}</div>
        </section>
        <div class="jt-footer-actions">
          <button class="jt-btn danger" type="button" data-act="delete" data-id="${esc(job.id)}">Delete</button>
          <div>
            <button class="jt-btn" type="button" data-act="close-detail">Close</button>
            <button class="jt-btn primary" type="submit">Save</button>
          </div>
        </div>
      </form>`;
    }

    function inputField(label, name, value, type, required, extraClass) {
      return `<label class="jt-field ${extraClass || ''}"><span>${esc(label)}</span><input name="${esc(name)}" type="${type || 'text'}" value="${esc(value)}" ${required ? 'required' : ''}></label>`;
    }

    function selectField(label, name, options, selected) {
      return `<label class="jt-field"><span>${esc(label)}</span><select name="${esc(name)}">${options.map(o => `<option value="${esc(o.id)}" ${o.id === selected ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select></label>`;
    }

    function collectForm(form) {
      const data = new FormData(form);
      const old = selectedJob() || blankJob();
      const next = normalizeJob(Object.assign({}, old, {
        title: data.get('title'),
        company: data.get('company'),
        stage: data.get('stage'),
        priority: data.get('priority'),
        location: data.get('location'),
        workMode: data.get('workMode'),
        salaryMin: data.get('salaryMin'),
        salaryMax: data.get('salaryMax'),
        jobType: data.get('jobType'),
        source: data.get('source'),
        link: data.get('link'),
        deadline: data.get('deadline'),
        dateApplied: data.get('dateApplied'),
        nextAction: data.get('nextAction'),
        nextActionDate: data.get('nextActionDate'),
        contactName: data.get('contactName'),
        contactInfo: data.get('contactInfo'),
        resumeVersion: data.get('resumeVersion'),
        coverStatus: data.get('coverStatus'),
        tags: cleanList(data.get('tags')),
        notes: data.get('notes'),
        description: data.get('description'),
      }));
      const exists = state.jobs.some(j => j.id === next.id);
      const changed = [];
      if (!exists) changed.push('Created entry');
      if (old.stage !== next.stage) changed.push('Moved to ' + stageById(next.stage).name);
      const changedFields = HISTORY_FIELDS
        .filter(([key]) => !sameValue(old[key], next[key]))
        .filter(([key]) => key !== 'stage')
        .map(([, label]) => label);
      if (changedFields.length) changed.push('Updated ' + listLabels(changedFields));
      next.updatedAt = nowISO();
      if (changed.length) next.history = (next.history || []).concat(changed.map(text => ({ at: next.updatedAt, text })));
      else next.history = (next.history || []).concat({ at: next.updatedAt, text: 'Saved without field changes' });
      return next;
    }

    function upsertJob(job) {
      const i = state.jobs.findIndex(j => j.id === job.id);
      if (i >= 0) state.jobs[i] = job;
      else state.jobs.unshift(job);
      state.selectedId = job.id;
      state.draft = null;
      saveJobs();
      render();
    }

    function deleteJob(id) {
      const job = state.jobs.find(j => j.id === id);
      if (!job) return;
      state.jobs = state.jobs.filter(j => j.id !== id);
      state.selectedId = null;
      state.draft = null;
      saveJobs();
      render();
    }

    function quickUpdateJob(id, patch, text) {
      const i = state.jobs.findIndex(j => j.id === id);
      if (i < 0) return;
      const stamp = nowISO();
      const history = (state.jobs[i].history || []).concat({ at: stamp, text });
      state.jobs[i] = normalizeJob(Object.assign({}, state.jobs[i], patch, { updatedAt: stamp, history }));
      state.selectedId = state.jobs[i].id;
      state.draft = null;
      saveJobs();
      render();
    }

    function markApplied(id) {
      const job = state.jobs.find(j => j.id === id);
      if (!job) return;
      quickUpdateJob(id, {
        stage: 'applied',
        dateApplied: job.dateApplied || todayISO(),
        nextAction: 'Check email and portal for confirmation/status updates.',
        nextActionDate: '',
      }, 'Marked as applied from To-do.');
    }

    function checkedEmail(id) {
      quickUpdateJob(id, {
        nextAction: 'Wait for reply; check email/portal again if no update.',
        nextActionDate: '',
      }, 'Checked email/portal for application updates.');
    }

    function archiveJob(id, text) {
      quickUpdateJob(id, {
        stage: 'archived',
        nextAction: '',
        nextActionDate: '',
      }, text || 'Archived from To-do.');
    }

    function download(name, text, type) {
      const blob = new Blob([text], { type });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
    }

    function exportJSON() {
      download(`career-desk-${todayISO()}.json`, JSON.stringify({ version: 1, exportedAt: nowISO(), jobs: state.jobs }, null, 2), 'application/json');
    }

    function exportCSV() {
      const headers = ['company', 'title', 'stage', 'priority', 'location', 'workMode', 'salaryMin', 'salaryMax', 'nextAction', 'nextActionDate', 'deadline', 'dateApplied', 'contactName', 'contactInfo', 'link', 'tags'];
      const rows = [headers].concat(state.jobs.map(j => headers.map(h => h === 'tags' ? j.tags.join('; ') : (j[h] || ''))));
      const csv = rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
      download(`career-desk-${todayISO()}.csv`, csv, 'text/csv');
    }

    function importRecords(payload, options) {
      const overwrite = !options || options.overwrite !== false;
      const incoming = Array.isArray(payload) ? payload : payload && payload.jobs;
      if (!Array.isArray(incoming)) throw new Error('Missing jobs array');
      const byId = new Map(state.jobs.map(j => [j.id, j]));
      incoming.map(normalizeJob).filter(Boolean).forEach(job => {
        if (overwrite || !byId.has(job.id)) byId.set(job.id, job);
      });
      state.jobs = Array.from(byId.values()).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
      saveJobs();
      render();
    }

    function importJSON(file) {
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          importRecords(JSON.parse(reader.result));
        } catch (err) {
          alert('Could not import that file. Use a Career Desk JSON export.');
        }
      };
      reader.readAsText(file);
    }

    function importFromURL() {
      const params = new URLSearchParams(location.search);
      const importPath = params.get('careerDeskImport');
      if (!importPath) return;
      const importUrl = new URL(importPath, location.href);
      if (importUrl.origin !== location.origin) return;
      fetch(importUrl.href, { cache: 'no-store' })
        .then(res => {
          if (!res.ok) throw new Error('Import file not found');
          return res.json();
        })
        .then(importRecords)
        .then(() => {
          params.delete('careerDeskImport');
          history.replaceState(null, '', location.pathname + (params.toString() ? '?' + params.toString() : '') + location.hash);
        })
        .catch(err => console.warn('Career Desk import skipped:', err.message));
    }

    function importSeededEmailJobs() {
      const alreadyHasEmailSeed = state.jobs.some(job => job && job.id && String(job.id).indexOf('email_') === 0);
      if (localStorage.getItem(EMAIL_SEED_KEY) === '1' && alreadyHasEmailSeed) return;
      fetch(EMAIL_SEED_URL, { cache: 'no-store' })
        .then(res => {
          if (!res.ok) throw new Error('Seed file not found');
          return res.json();
        })
        .then(payload => {
          importRecords(payload, { overwrite: false });
          localStorage.setItem(EMAIL_SEED_KEY, '1');
        })
        .catch(err => console.warn('Career Desk email seed skipped:', err.message));
    }

    api.on(wrap, 'click', e => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'view') state.view = btn.dataset.view || 'todo';
      else if (act === 'stage-filter') { state.stage = btn.dataset.stage || 'all'; }
      else if (act === 'select') { state.selectedId = btn.dataset.id; state.draft = null; }
      else if (act === 'new') { state.draft = blankJob(); state.selectedId = state.draft.id; }
      else if (act === 'close-detail') { state.selectedId = null; state.draft = null; }
      else if (act === 'mark-applied') { markApplied(btn.dataset.id); return; }
      else if (act === 'checked-email') { checkedEmail(btn.dataset.id); return; }
      else if (act === 'archive') { archiveJob(btn.dataset.id, 'Skipped/archived from To-do.'); return; }
      else if (act === 'delete') {
        if (btn.dataset.confirm !== '1') {
          btn.dataset.confirm = '1';
          btn.textContent = 'Confirm delete';
          return;
        }
        deleteJob(btn.dataset.id);
        return;
      }
      else if (act === 'clear-filters') { state.query = ''; state.stage = 'all'; state.priority = 'all'; state.sort = 'updated'; }
      else if (act === 'export-json') { exportJSON(); return; }
      else if (act === 'export-csv') { exportCSV(); return; }
      else if (act === 'import') { wrap.querySelector('[data-import-file]').click(); return; }
      render();
    });

    api.on(wrap, 'input', e => {
      const key = e.target.dataset.filter;
      if (!key) return;
      const caret = e.target.selectionStart;
      state[key] = e.target.value;
      renderKeepingFilterFocus(key, caret);
    });

    api.on(wrap, 'change', e => {
      if (e.target.matches('[data-import-file]')) { importJSON(e.target.files && e.target.files[0]); e.target.value = ''; return; }
      const key = e.target.dataset.filter;
      if (!key) return;
      state[key] = e.target.value;
      render();
    });

    api.on(wrap, 'submit', e => {
      if (!e.target.matches('[data-form="job"]')) return;
      e.preventDefault();
      const job = collectForm(e.target);
      upsertJob(job);
    });

    render();
    importFromURL();
    importSeededEmailJobs();
  },
});
