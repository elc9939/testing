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
    const EMAIL_SEED_KEY = 'careerDesk.emailSeed.v6';
    const EMAIL_SEED_URL = 'js/games/careerdesk-email-seed.json?v=7';
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
    const CANDIDATE_PROFILE = {
      headline: 'NYU Math BS May 2026 -> MS Math May 2027',
      summary: 'Authorized to work in the US, no sponsorship needed. Prioritize Summer 2027 entry-level/new-grad quant, data science, research, risk/fraud, fintech, and applied math roles.',
      fitChecks: ['May 2027 timing', 'Entry-level / new grad', 'No sponsorship issue', 'Math/data/research fit', 'Location priority', 'No duplicate risk'],
      watchlist: ['Point72', 'D.E. Shaw', 'Two Sigma', 'Jane Street', 'IMC', 'SIG', 'DRW', 'Radix', 'Citadel', 'Five Rings', 'HRT', 'AQR'],
    };

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
      .jt{--jt-bg:var(--bg);--jt-bg2:var(--bg-2);--jt-panel:var(--panel);--jt-panel-solid:var(--panel-solid);--jt-surface:var(--surface);--jt-surface-2:var(--surface-2);--jt-strong:var(--surface-strong);--jt-line:var(--line);--jt-line2:var(--line);--jt-text:var(--text);--jt-muted:var(--muted);--jt-faint:var(--faint);--jt-chip:var(--surface-2);--jt-accent:#4fb477;--jt-accent-soft:color-mix(in srgb,var(--jt-accent) 16%,var(--jt-surface));--jt-warn:#d7a86e;--jt-warn-soft:color-mix(in srgb,var(--jt-warn) 15%,var(--jt-surface));--jt-bad:var(--danger);--jt-bad-soft:color-mix(in srgb,var(--jt-bad) 13%,var(--jt-surface));position:relative;height:100%;min-height:0;background:transparent;color:var(--jt-text);font-family:var(--font,Inter,"Segoe UI",system-ui,sans-serif);overflow:hidden}
      .jt *{box-sizing:border-box}
      .jt button,.jt input,.jt select,.jt textarea{font:inherit}
      .jt-shell{height:100%;display:grid;grid-template-columns:minmax(0,1fr) 390px;gap:14px;min-height:0}
      .jt-main,.jt-detail{min-width:0;min-height:0;border:1px solid var(--jt-line);background:var(--jt-panel);border-radius:var(--radius-lg,10px);box-shadow:none;backdrop-filter:blur(12px)}
      .jt-main{display:flex;flex-direction:column;overflow:hidden}
      .jt-detail{overflow:auto}
      .jt-head{display:flex;align-items:center;justify-content:space-between;gap:14px;min-height:66px;padding:12px 14px;border-bottom:1px solid var(--jt-line);background:var(--jt-panel)}
      .jt-brand{display:flex;align-items:center;gap:10px;min-width:0}
      .jt-app-logo{display:grid;place-items:center;width:42px;height:42px;min-width:42px;border:1px solid var(--jt-line);border-radius:var(--radius,8px);background:#0f0f0f;overflow:hidden;position:relative}
      .jt-app-logo span{position:relative;z-index:2;color:var(--jt-text);font-size:11px;font-weight:760;letter-spacing:.01em}
      .jt-app-logo::before,.jt-app-logo::after,.jt-app-logo i,.jt-app-logo b{content:"";position:absolute;width:7px;height:7px;border-radius:50%;background:var(--jt-accent)}
      .jt-app-logo::before{left:9px;top:9px;background:color-mix(in srgb,var(--jt-accent) 80%,#7dd3fc)}
      .jt-app-logo::after{right:9px;top:10px;background:color-mix(in srgb,var(--jt-accent) 70%,#f0abfc)}
      .jt-app-logo i{left:10px;bottom:9px;background:color-mix(in srgb,var(--jt-accent) 72%,#fbbf24)}
      .jt-app-logo b{right:10px;bottom:9px;background:color-mix(in srgb,var(--jt-accent) 80%,#86efac)}
      .jt-title{min-width:0}
      .jt-title h2{font-size:14px;line-height:1.15;margin:0;color:var(--jt-text);font-weight:720;letter-spacing:0}
      .jt-title p{font-size:12px;line-height:1.35;color:var(--jt-muted);margin:3px 0 0;max-width:660px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .jt-kicker{display:inline-flex;align-items:center;gap:6px;margin-bottom:3px;color:var(--jt-faint);font-size:10px;font-weight:850;letter-spacing:.08em;text-transform:uppercase}
      .jt-kicker::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--jt-accent)}
      .jt-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}
      .jt-view-tabs{display:flex;gap:4px;padding:3px;border:1px solid var(--jt-line);border-radius:var(--radius,8px);background:var(--jt-surface-2)}
      .jt-view-tabs .jt-btn{min-height:32px;padding:6px 10px;border-color:transparent;background:transparent}
      .jt-btn{min-height:38px;border:1px solid var(--jt-line);background:var(--jt-surface);color:var(--jt-text);border-radius:var(--radius,8px);padding:8px 12px;font-weight:820;cursor:pointer;box-shadow:none;transition:background .14s ease,border-color .14s ease,transform .12s ease}
      .jt-btn:hover{border-color:var(--jt-line2);background:var(--jt-strong);transform:translateY(-1px)}
      .jt-btn:active{transform:translateY(0) scale(.985)}
      .jt-btn.primary{border-color:color-mix(in srgb,var(--jt-accent) 28%,var(--jt-line));background:color-mix(in srgb,var(--jt-accent) 18%,var(--jt-surface));color:var(--jt-text)}
      .jt-btn.primary:hover{background:color-mix(in srgb,var(--jt-accent) 24%,var(--jt-surface))}
      .jt-btn.danger{border-color:color-mix(in srgb,var(--jt-bad) 38%,var(--jt-line));color:var(--jt-bad);background:var(--jt-bad-soft)}
      .jt-btn.danger[data-confirm="1"]{background:var(--jt-bad);color:#fff;border-color:var(--jt-bad)}
      .jt-btn.slim{padding:6px 9px;font-size:12px}
      .jt-toolbar{display:grid;grid-template-columns:minmax(180px,1.5fr) repeat(4,minmax(118px,.7fr));gap:8px;padding:10px 14px;border-bottom:1px solid var(--jt-line);background:var(--jt-panel)}
      .jt-field{display:flex;flex-direction:column;gap:4px}
      .jt-field span{font-size:10px;font-weight:850;letter-spacing:.075em;text-transform:uppercase;color:var(--jt-faint)}
      .jt input,.jt select,.jt textarea{width:100%;border:1px solid var(--jt-line);border-radius:var(--radius,8px);background:var(--jt-surface-2);color:var(--jt-text);padding:9px 10px;outline:none}
      .jt input:focus,.jt select:focus,.jt textarea:focus{border-color:var(--jt-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--jt-accent) 16%,transparent)}
      .jt textarea{resize:vertical;min-height:74px;line-height:1.35}
      .jt-summary{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;padding:10px 14px;border-bottom:1px solid var(--jt-line);background:var(--jt-surface-2)}
      .jt-stat{border:1px solid var(--jt-line);border-radius:var(--radius,8px);background:var(--jt-surface);padding:9px 10px}
      .jt-stat b{display:block;font-size:20px;line-height:1;color:var(--jt-text);font-weight:760}
      .jt-stat span{display:block;margin-top:5px;font-size:11px;color:var(--jt-muted);font-weight:780}
      .jt-content{min-height:0;overflow:auto;padding:12px;background:var(--jt-bg)}
      .jt-todo,.jt-jobs{display:grid;gap:12px;align-content:start}
      .jt-profile{border:1px solid var(--jt-line);background:var(--jt-panel);border-radius:var(--radius-lg,10px);padding:11px 12px;display:grid;gap:8px}
      .jt-profile-top{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
      .jt-profile b{display:block;color:var(--jt-text);font-size:13px}
      .jt-profile p{margin:3px 0 0;color:var(--jt-muted);font-size:12px;line-height:1.35}
      .jt-fit-tags{display:flex;flex-wrap:wrap;gap:5px}
      .jt-fit-tags span{border:1px solid var(--jt-line);background:var(--jt-surface-2);color:var(--jt-muted);border-radius:999px;padding:3px 7px;font-size:11px;font-weight:800}
      .jt-insights{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px}
      .jt-insight{border:1px solid var(--jt-line);background:var(--jt-surface);border-radius:var(--radius,8px);padding:7px 8px;min-width:0}
      .jt-insight b{font-size:16px;line-height:1;color:var(--jt-text)}
      .jt-insight span{display:block;margin-top:3px;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--jt-muted);font-weight:900}
      .jt-score{display:inline-flex;align-items:center;gap:4px;border-radius:999px;padding:3px 7px;font-size:11px;font-weight:900;border:1px solid var(--jt-line2);background:var(--jt-chip);color:var(--jt-muted);white-space:nowrap}
      .jt-score.good{border-color:color-mix(in srgb,var(--jt-accent) 36%,var(--jt-line));background:var(--jt-accent-soft);color:var(--jt-accent)}
      .jt-score.ok{border-color:color-mix(in srgb,var(--jt-warn) 36%,var(--jt-line));background:var(--jt-warn-soft);color:var(--jt-warn)}
      .jt-score.bad{border-color:color-mix(in srgb,var(--jt-bad) 36%,var(--jt-line));background:var(--jt-bad-soft);color:var(--jt-bad)}
      .jt-analysis{display:grid;gap:8px}
      .jt-analysis-row{display:flex;gap:8px;align-items:flex-start;color:var(--jt-muted);font-size:12px;line-height:1.35}
      .jt-analysis-row b{min-width:86px;color:var(--jt-text);font-size:12px}
      .jt-angle{margin:0;padding-left:18px;color:var(--jt-muted);font-size:12px;line-height:1.35}
      .jt-angle li{margin:3px 0}
      .jt-task-section,.jt-list-section{border:1px solid var(--jt-line);background:var(--jt-panel);border-radius:var(--radius-lg,10px);overflow:hidden}
      .jt-task-head,.jt-list-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 12px;border-bottom:1px solid var(--jt-line);background:var(--jt-panel)}
      .jt-task-head h3,.jt-list-head h3{margin:0;font-size:15px;color:var(--jt-text)}
      .jt-task-head p{margin:2px 0 0;font-size:12px;color:var(--jt-muted);line-height:1.3}
      .jt-task-count{font-size:12px;font-weight:900;color:var(--jt-muted);border:1px solid var(--jt-line2);background:var(--jt-chip);border-radius:999px;padding:3px 8px;white-space:nowrap}
      .jt-task-list,.jt-list-items{display:grid;gap:8px;padding:9px}
      .jt-task{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;border:1px solid var(--jt-line);background:var(--jt-surface);border-radius:var(--radius,8px);padding:10px;box-shadow:none}
      .jt-task-main{min-width:0;border:0;background:transparent;color:inherit;text-align:left;padding:0;cursor:pointer}
      .jt-task-main:hover .jt-role{text-decoration:underline}
      .jt-task-text{margin-top:7px;font-size:13px;color:var(--jt-muted);line-height:1.3}
      .jt-fit-check{margin-top:8px;display:flex;flex-wrap:wrap;gap:5px}
      .jt-fit-check span{border:1px solid var(--jt-line2);background:var(--jt-panel);color:var(--jt-muted);border-radius:999px;padding:3px 7px;font-size:11px;font-weight:800}
      .jt-task-actions{display:flex;align-items:center;justify-content:flex-end;gap:6px;flex-wrap:wrap}
      .jt-link-btn{display:inline-flex;align-items:center;justify-content:center;text-decoration:none;border:1px solid var(--jt-line);background:var(--jt-surface);color:var(--jt-text);border-radius:var(--radius,8px);padding:6px 9px;font-weight:900;font-size:12px;min-height:30px}
      .jt-link-btn:hover{border-color:var(--jt-accent);background:var(--jt-accent-soft)}
      .jt-stage-strip{display:flex;gap:7px;flex-wrap:wrap;padding:10px 14px;border-bottom:1px solid var(--jt-line);background:var(--jt-surface-2)}
      .jt-stage-pill{border:1px solid var(--jt-line);background:var(--jt-surface);color:var(--jt-text);border-radius:999px;padding:7px 10px;font-size:12px;font-weight:900;cursor:pointer}
      .jt-stage-pill.active{background:color-mix(in srgb,var(--jt-accent) 18%,var(--jt-surface));color:var(--jt-text);border-color:color-mix(in srgb,var(--jt-accent) 30%,var(--jt-line))}
      .jt-board{display:grid;grid-template-columns:repeat(6,minmax(220px,1fr));gap:10px;min-height:100%}
      .jt-col{min-height:260px;border:1px solid var(--jt-line);background:var(--jt-panel);border-radius:var(--radius-lg,10px);display:flex;flex-direction:column;overflow:hidden}
      .jt-col-head{display:flex;align-items:center;justify-content:space-between;padding:10px 11px;border-bottom:1px solid var(--jt-line);background:var(--jt-panel)}
      .jt-col-name{display:flex;align-items:center;gap:7px;font-weight:900;color:var(--jt-text)}
      .jt-dot{width:9px;height:9px;border-radius:50%;background:var(--stage)}
      .jt-count{font-size:12px;color:var(--jt-muted);font-weight:900}
      .jt-cards{display:grid;gap:8px;padding:9px;align-content:start}
      .jt-card{border:1px solid var(--jt-line);background:var(--jt-surface);border-radius:var(--radius,8px);padding:10px;text-align:left;color:inherit;cursor:pointer;box-shadow:none}
      .jt-card:hover,.jt-card.active{border-color:color-mix(in srgb,var(--jt-accent) 32%,var(--jt-line));background:var(--jt-strong);box-shadow:none}
      .jt-card-top{display:flex;justify-content:space-between;align-items:flex-start;gap:8px}
      .jt-role{font-weight:900;font-size:14px;color:var(--jt-text);line-height:1.2}
      .jt-company{font-size:13px;color:var(--jt-muted);margin-top:2px;font-weight:700}
      .jt-meta{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}
      .jt-chip{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--jt-line);background:var(--jt-chip);border-radius:999px;padding:3px 7px;font-size:11px;font-weight:800;color:var(--jt-muted);white-space:nowrap}
      .jt-chip.high{border-color:color-mix(in srgb,var(--jt-bad) 40%,var(--jt-line));background:var(--jt-bad-soft);color:var(--jt-bad)}
      .jt-chip.medium{border-color:color-mix(in srgb,var(--jt-warn) 40%,var(--jt-line));background:var(--jt-warn-soft);color:var(--jt-warn)}
      .jt-chip.low{border-color:color-mix(in srgb,var(--jt-accent) 36%,var(--jt-line));background:var(--jt-accent-soft);color:var(--jt-accent)}
      .jt-next{margin-top:9px;border-top:1px solid var(--jt-line2);padding-top:8px}
      .jt-next b{display:block;font-size:11px;color:var(--jt-muted);text-transform:uppercase;letter-spacing:.04em}
      .jt-next span{display:block;font-size:13px;color:var(--jt-text);line-height:1.25;margin-top:2px}
      .jt-prior-note{margin-top:7px;border-left:3px solid var(--jt-bad);background:var(--jt-bad-soft);color:var(--jt-bad);padding:6px 8px;border-radius:0 8px 8px 0;font-size:12px;font-weight:800;line-height:1.3}
      .jt-alert{color:var(--jt-bad)!important}
      .jt-empty{padding:22px;text-align:center;color:var(--jt-muted);font-weight:800}
      .jt-table{width:100%;border-collapse:separate;border-spacing:0 8px}
      .jt-table th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--jt-muted);padding:0 10px}
      .jt-table td{background:var(--jt-panel);border-top:1px solid var(--jt-line2);border-bottom:1px solid var(--jt-line2);padding:11px 10px;font-size:13px}
      .jt-table td:first-child{border-left:1px solid var(--jt-line2);border-radius:8px 0 0 8px}
      .jt-table td:last-child{border-right:1px solid var(--jt-line2);border-radius:0 8px 8px 0}
      .jt-row{cursor:pointer}
      .jt-row:hover td{border-color:var(--jt-accent)}
      .jt-detail-head{position:sticky;top:0;z-index:2;background:var(--jt-panel);border-bottom:1px solid var(--jt-line);padding:14px 15px}
      .jt-detail-head h3{margin:0;font-size:15px;color:var(--jt-text);font-weight:740}
      .jt-detail-head p{margin:4px 0 0;color:var(--jt-muted);font-size:13px}
      .jt-detail-body{padding:14px;display:grid;gap:13px}
      .jt-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
      .jt-form-grid .wide{grid-column:1/-1}
      .jt-section{border:1px solid var(--jt-line);border-radius:var(--radius,8px);padding:12px;background:var(--jt-surface)}
      .jt-section h4{margin:0 0 10px;font-size:12px;text-transform:uppercase;letter-spacing:.07em;color:var(--jt-muted)}
      .jt-dupe{border:1px solid color-mix(in srgb,var(--jt-bad) 36%,var(--jt-line));background:var(--jt-bad-soft);color:var(--jt-bad);border-radius:8px;padding:9px;font-size:12px;font-weight:800}
      .jt-history{display:grid;gap:7px}
      .jt-history-row{font-size:12px;color:var(--jt-muted);border-left:3px solid var(--jt-line2);padding-left:8px}
      .jt-history-row b{color:var(--jt-text)}
      .jt-detail-empty{height:100%;display:flex;align-items:center;justify-content:center;text-align:center;color:var(--jt-muted);padding:30px;font-weight:800}
      .jt-detail-empty-title{font-size:22px;margin-bottom:8px;color:var(--jt-text)}
      .jt-section-note{margin:9px 0 0;color:var(--jt-muted);font-size:12px;line-height:1.35}
      .jt-footer-actions{display:flex;gap:8px;justify-content:space-between;flex-wrap:wrap}
      .jt-file{display:none}
      @media (max-width:1120px){
        .jt-shell{grid-template-columns:1fr}
        .jt-detail{position:absolute;right:0;top:0;bottom:0;width:min(430px,100%);z-index:6;display:none}
        .jt-detail.open{display:block}
        .jt-board{grid-template-columns:repeat(3,minmax(220px,1fr))}
      }
      @media (max-width:760px){
        .jt{height:auto;min-height:720px;overflow:visible}
        .jt-head{align-items:stretch;flex-direction:column;padding:12px}
        .jt-actions{justify-content:flex-start}
        .jt-toolbar{grid-template-columns:1fr 1fr;padding:10px}
        .jt-toolbar .jt-field:first-child{grid-column:1/-1}
        .jt-summary{grid-template-columns:1fr 1fr;padding:10px}
        .jt-insights{grid-template-columns:1fr 1fr}
        .jt-content{padding:9px}
        .jt-task{grid-template-columns:1fr}
        .jt-task-actions{justify-content:flex-start}
        .jt-board{display:flex;overflow-x:auto;min-height:0}
        .jt-col{min-width:245px}
        .jt-form-grid{grid-template-columns:1fr}
        .jt-table-wrap{overflow:auto}
        .jt-table{min-width:920px}
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

    function normalizeForMatch(value) {
      return String(value || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
    }

    function priorApplicationFor(job) {
      if (!job || (!job.title && !job.company)) return null;
      const title = normalizeForMatch(job.title);
      const company = normalizeForMatch(job.company);
      if (!title || !company) return null;
      const priorStages = new Set(['applied', 'interviewing', 'offer', 'rejected', 'archived']);
      return state.jobs.find(other => {
        if (!other || other.id === job.id || !priorStages.has(other.stage)) return false;
        return normalizeForMatch(other.title) === title && normalizeForMatch(other.company) === company;
      }) || null;
    }

    function formatDateFull(value) {
      return value ? new Date(value + 'T00:00:00').toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '';
    }

    function priorApplicationText(prior) {
      if (!prior) return '';
      const stage = stageById(prior.stage).name.toLowerCase();
      const when = prior.dateApplied ? ' after applying ' + formatDateFull(prior.dateApplied) : '';
      return 'Prior ' + stage + when;
    }

    function jobText(job) {
      return [
        job && job.title,
        job && job.company,
        job && job.location,
        job && job.jobType,
        job && job.source,
        job && job.nextAction,
        job && Array.isArray(job.tags) ? job.tags.join(' ') : '',
        job && job.notes,
        job && job.description,
      ].join(' ').toLowerCase();
    }

    function hasAny(text, terms) {
      return terms.some(term => text.indexOf(term) >= 0);
    }

    function clampScore(score) {
      return Math.max(0, Math.min(100, Math.round(score)));
    }

    function overlapCount(a, b) {
      const ignore = new Set(['the', 'and', 'for', 'with', 'intern', 'internship', 'analyst', 'associate', 'program', 'summer', 'new', 'grad']);
      const words = value => normalizeForMatch(value).split(' ').filter(word => word.length > 2 && !ignore.has(word));
      const aw = new Set(words(a));
      return words(b).filter(word => aw.has(word)).length;
    }

    function possibleDuplicateFor(job) {
      if (!job || !job.company || !job.title) return null;
      const company = normalizeForMatch(job.company);
      return state.jobs.find(other => {
        if (!other || other.id === job.id || !other.company || !other.title) return false;
        if (normalizeForMatch(other.company) !== company) return false;
        return overlapCount(other.title, job.title) >= 2;
      }) || null;
    }

    function sourceQualityFor(job) {
      const source = String(job && job.source || '').toLowerCase();
      const link = String(job && job.link || '').toLowerCase();
      const text = source + ' ' + link + ' ' + jobText(job);
      if (source === 'email import' || hasTag(job, 'email-import')) {
        return { label: 'Email history', tone: 'ok', score: 2, detail: 'Imported from application email history.' };
      }
      if (hasAny(link, ['greenhouse.io', 'lever.co', 'ashbyhq.com', 'myworkdayjobs.com', 'icims.com', 'workdayjobs.com']) ||
        hasAny(link, ['careers.', '/careers/', '/jobs/'])) {
        return { label: 'Direct source', tone: 'good', score: 8, detail: 'Likely company or ATS posting.' };
      }
      if (hasAny(text, ['lensa', 'indeed', 'linkedin', 'glassdoor', 'ziprecruiter', 'simplify', 'jobright', 'wellfound'])) {
        return { label: 'Mirror source', tone: 'ok', score: 1, detail: 'Useful lead, but verify against the company career page.' };
      }
      if (source === 'career scout' || hasTag(job, 'career-scout')) {
        return { label: 'Scout lead', tone: 'ok', score: 4, detail: 'Found by scout; verify source quality before applying.' };
      }
      return { label: 'Source unclear', tone: 'bad', score: -2, detail: 'Source needs verification before applying.' };
    }

    function leadStatusFor(job) {
      const prior = priorApplicationFor(job);
      if (prior) {
        const text = jobText(job);
        const oldEnough = prior.dateApplied ? daysBetween(prior.dateApplied, todayISO()) >= 150 : false;
        if (oldEnough && hasAny(text, ['2027', 'upcoming graduate', 'new grad', 'campus', 'summer 2027'])) {
          return { label: 'Possible new cycle', tone: 'ok', detail: priorApplicationText(prior) + '; verify this is a fresh posting.' };
        }
        return { label: 'Prior application', tone: 'bad', detail: priorApplicationText(prior) + '; avoid reapplying unless the cycle changed.' };
      }
      const dupe = duplicateFor(job);
      if (dupe) return { label: 'Exact duplicate', tone: 'bad', detail: 'Matches another tracked role by link or company/title.' };
      const possible = possibleDuplicateFor(job);
      if (possible) return { label: 'Possible duplicate', tone: 'ok', detail: 'Same company and similar title already exists in Career Desk.' };
      if (job && isSeedRecord(job)) return { label: 'New scout lead', tone: 'good', detail: 'No matching prior lead found locally.' };
      return { label: 'Manual lead', tone: 'ok', detail: 'No matching prior lead found locally.' };
    }

    function timingFitFor(job) {
      const text = jobText(job);
      let score = 0;
      const reasons = [];
      if (hasAny(text, ['2027', 'may 2027', 'summer 2027', 'class of 2027', 'upcoming graduate'])) {
        score += 22;
        reasons.push('2027 timing');
      } else if (hasAny(text, ['new grad', 'new-grad', 'campus', 'graduate', 'entry level', 'entry-level', 'junior', 'early career', '0-2'])) {
        score += 16;
        reasons.push('early-career timing');
      } else if (hasAny(text, ['intern'])) {
        score += 8;
        reasons.push('internship timing needs check');
      }
      if (hasAny(text, ['summer 2026', '2026 internship'])) {
        score -= 10;
        reasons.push('likely too early');
      }
      if (hasAny(text, ['3+ years', 'three years', '5+ years', 'senior', 'staff ', 'principal', 'phd required', 'ph.d. required'])) {
        score -= 18;
        reasons.push('seniority risk');
      }
      return { score, reasons };
    }

    function roleFitFor(job) {
      const text = jobText(job);
      let score = 0;
      const reasons = [];
      if (hasAny(text, ['quant', 'quantitative', 'trading', 'alpha', 'portfolio', 'market making'])) {
        score += 24;
        reasons.push('quant/finance core');
      }
      if (hasAny(text, ['research', 'model', 'statistic', 'probability', 'optimization', 'mathematics', 'machine learning', 'data science', 'risk', 'fraud'])) {
        score += 16;
        reasons.push('math/modeling fit');
      }
      if (hasAny(text, ['python', 'pandas', 'numpy', 'c++', 'data analysis', 'analytics'])) {
        score += 9;
        reasons.push('technical skill fit');
      }
      if (hasAny(text, ['generic sql', 'sales', 'wealth management', 'investment banking', 'consulting', 'frontend', 'backend', 'full-stack', 'devops', 'sre'])) {
        score -= 14;
        reasons.push('lower-priority lane');
      }
      return { score, reasons };
    }

    function locationFitFor(job) {
      const text = String(job && job.location || '').toLowerCase();
      if (hasAny(text, ['irvine', 'orange county', 'costa mesa', 'newport beach', 'anaheim', 'santa ana'])) return { score: 15, label: 'Top location' };
      if (hasAny(text, ['new york', 'nyc', 'manhattan'])) return { score: 13, label: 'NYC priority' };
      if (hasAny(text, ['california', 'los angeles', 'san diego', 'santa monica', 'pasadena'])) return { score: 11, label: 'California fit' };
      if (hasAny(text, ['san francisco', 'bay area', 'san jose', 'menlo park', 'palo alto', 'mountain view', 'redwood city'])) return { score: 10, label: 'Bay Area fit' };
      if (hasAny(text, ['remote', 'united states', 'usa', 'us '])) return { score: 7, label: 'US/remote fit' };
      if (!text || text === 'unknown') return { score: 2, label: 'Location unclear' };
      if (hasAny(text, ['london', 'hong kong', 'singapore', 'europe', 'international'])) return { score: -7, label: 'International low priority' };
      return { score: 4, label: 'US selective' };
    }

    function fitScoreFor(job) {
      const timing = timingFitFor(job);
      const role = roleFitFor(job);
      const location = locationFitFor(job);
      const source = sourceQualityFor(job);
      const lead = leadStatusFor(job);
      const text = jobText(job);
      let score = 28 + timing.score + role.score + location.score + source.score;
      if (job && job.priority === 'High') score += 6;
      if (job && job.priority === 'Low') score -= 5;
      if (hasAny(text, CANDIDATE_PROFILE.watchlist.map(v => v.toLowerCase()))) score += 3;
      if (lead.tone === 'bad') score -= 24;
      else if (lead.label === 'Possible new cycle') score -= 8;
      else if (lead.label === 'Possible duplicate') score -= 6;
      const finalScore = clampScore(score);
      const label = finalScore >= 82 ? 'Excellent' : finalScore >= 68 ? 'Strong' : finalScore >= 52 ? 'Check' : 'Weak';
      const tone = finalScore >= 68 ? 'good' : finalScore >= 52 ? 'ok' : 'bad';
      const reasons = []
        .concat(timing.reasons, role.reasons)
        .concat(location.label, source.label, lead.label)
        .filter(Boolean);
      return { score: finalScore, label, tone, reasons, source, lead, location };
    }

    function urgencyFor(job) {
      const due = dueStatus(job);
      if (due.due) return { label: due.text || 'Due now', tone: 'bad', rank: 0 };
      if (job && job.deadline) {
        const d = daysBetween(todayISO(), job.deadline);
        if (d < 0) return { label: 'Deadline passed', tone: 'bad', rank: 1 };
        if (d <= 3) return { label: 'Deadline soon', tone: 'bad', rank: 2 };
        if (d <= 10) return { label: 'Deadline ' + d + 'd', tone: 'ok', rank: 4 };
      }
      if (job && job.stage === 'saved' && fitScoreFor(job).score >= 76) return { label: 'Apply soon', tone: 'good', rank: 5 };
      if (isStale(job)) return { label: 'Stale active', tone: 'ok', rank: 6 };
      return { label: '', tone: 'ok', rank: 9 };
    }

    function resumeAnglesFor(job) {
      const text = jobText(job);
      const angles = [];
      if (hasAny(text, ['quant', 'trading', 'market', 'portfolio', 'alpha'])) {
        angles.push('Lead with probability, statistics, mathematical modeling, and contest-style problem solving.');
      }
      if (hasAny(text, ['data science', 'machine learning', 'model', 'analytics', 'risk', 'fraud'])) {
        angles.push('Emphasize Python, NumPy/Pandas, statistical modeling, and the Wordle ML/statistics project.');
      }
      if (hasAny(text, ['research', 'physics', 'simulation', 'optimization', 'numerical'])) {
        angles.push('Use the neutrino physics numerical modeling and visualization research as the strongest research signal.');
      }
      if (hasAny(text, ['c++', 'developer', 'technology', 'systems'])) {
        angles.push('Mention C/C++, Java, and EOSpace automation/tooling without framing yourself as pure SWE.');
      }
      if (hasAny(text, ['intern', 'campus', 'new grad', 'graduate', '2027'])) {
        angles.push('Make the May 2027 M.S. graduation timing and no-sponsorship status easy to find.');
      }
      return angles.slice(0, 3);
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

    function isSeedRecord(job) {
      const source = String(job && job.source || '').toLowerCase();
      return source === 'email import' || source === 'career scout' ||
        (Array.isArray(job && job.tags) && (job.tags.includes('email-import') || job.tags.includes('career-scout')));
    }

    function hasTag(job, tag) {
      return Array.isArray(job && job.tags) && job.tags.includes(tag);
    }

    function isPassiveUpdateCheck(job) {
      const text = String(job && job.nextAction || '').toLowerCase();
      return /\b(check|watch|wait|monitor)\b.*\b(email|portal|reply|status|update)\b/.test(text) ||
        /\b(email|portal)\b.*\b(status|update)\b/.test(text);
    }

    function hasActionableNextStep(job) {
      return !!(job && job.nextAction && !isPassiveUpdateCheck(job));
    }

    function isTodoJob(job) {
      if (!job || job.stage === 'rejected' || job.stage === 'archived') return false;
      return job.stage === 'saved' || job.stage === 'interviewing' || job.stage === 'offer' ||
        (dueStatus(job).due && hasActionableNextStep(job)) ||
        (ACTIVE_STAGES.has(job.stage) && isStale(job));
    }

    function needsFitCheck(job) {
      if (!job || job.stage !== 'saved' || hasTag(job, 'fit-checked')) return false;
      const source = String(job.source || '').toLowerCase();
      return source === 'career scout' || hasTag(job, 'career-scout') || hasTag(job, 'needs-fit-check');
    }

    function todoPriorityRank(job) {
      const index = PRIORITIES.indexOf(job && job.priority);
      return index >= 0 ? index : PRIORITIES.length;
    }

    function todoSort(a, b) {
      const byUrgency = urgencyFor(a).rank - urgencyFor(b).rank;
      if (byUrgency) return byUrgency;
      const byPriority = todoPriorityRank(a) - todoPriorityRank(b);
      if (byPriority) return byPriority;
      const byFit = fitScoreFor(b).score - fitScoreFor(a).score;
      if (byFit) return byFit;
      const byDate = (a.nextActionDate || a.deadline || '9999-99-99').localeCompare(b.nextActionDate || b.deadline || '9999-99-99');
      if (byDate) return byDate;
      return (b.updatedAt || '').localeCompare(a.updatedAt || '');
    }

    function todoGroups(jobs) {
      const visible = jobs.filter(isTodoJob).slice().sort(todoSort);
      const byId = new Set();
      const take = predicate => visible.filter(job => {
        if (byId.has(job.id) || !predicate(job)) return false;
        byId.add(job.id);
        return true;
      });
      const groups = [
        {
          id: 'urgent',
          name: 'Apply / act today',
          hint: 'Assessments, recruiter replies, scheduling, materials, or deadlines that need a real action.',
          jobs: take(job => dueStatus(job).due && hasActionableNextStep(job)),
        },
        {
          id: 'fit',
          name: 'Need fit check',
          hint: 'Confirm timing, level, role fit, location, source quality, and duplicate risk before applying.',
          jobs: take(needsFitCheck),
        },
        {
          id: 'apply',
          name: 'Apply queue',
          hint: 'Saved leads that passed fit check or were entered manually and need a yes/no decision.',
          jobs: take(job => job.stage === 'saved'),
        },
        {
          id: 'active',
          name: 'Interview / offer prep',
          hint: 'Active processes where preparation, scheduling, or decision work matters most.',
          jobs: take(job => job.stage === 'interviewing' || job.stage === 'offer'),
        },
        {
          id: 'stale',
          name: 'Stale / ghosted cleanup',
          hint: 'Decide whether to follow up, archive, or leave these active. No passive email/portal chores.',
          jobs: take(job => ACTIVE_STAGES.has(job.stage) && isStale(job)),
        },
      ];
      return groups.filter(group => group.jobs.length);
    }

    function summary() {
      const active = activeJobs();
      const due = active.filter(j => dueStatus(j).due).length;
      const interviews = state.jobs.filter(j => j.stage === 'interviewing').length;
      const stale = active.filter(isStale).length;
      const todo = state.jobs.filter(isTodoJob).length;
      const email = emailImportCount();
      const highFit = state.jobs.filter(job => ACTIVE_STAGES.has(job.stage) && fitScoreFor(job).score >= 76 && leadStatusFor(job).tone !== 'bad').length;
      const duplicateRisk = state.jobs.filter(job => ACTIVE_STAGES.has(job.stage) && leadStatusFor(job).tone === 'bad').length;
      return { active: active.length, todo, due, interviews, stale, email, highFit, duplicateRisk };
    }

    function scoutStats() {
      const active = state.jobs.filter(job => ACTIVE_STAGES.has(job.stage));
      return {
        highFit: active.filter(job => fitScoreFor(job).score >= 76 && leadStatusFor(job).tone !== 'bad').length,
        duplicateRisk: active.filter(job => leadStatusFor(job).tone === 'bad').length,
        urgent: active.filter(job => urgencyFor(job).rank <= 4).length,
        stale: active.filter(isStale).length,
      };
    }

    function render() {
      const stats = summary();
      wrap.innerHTML = `
        <div class="jt-shell">
          <section class="jt-main">
            <div class="jt-head">
              <div class="jt-brand">
                <div class="jt-app-logo" aria-hidden="true"><span>JOB</span><i></i><b></b></div>
                <div class="jt-title">
                  <span class="jt-kicker">Tool</span>
                  <h2>Career Desk</h2>
                  <p>Track leads, applications, follow-ups, materials, and next actions.</p>
                </div>
              </div>
              <div class="jt-actions">
                <div class="jt-view-tabs" role="group" aria-label="Career Desk views">
                  ${VIEWS.map(view => `<button class="jt-btn ${state.view === view.id ? 'primary' : ''}" data-act="view" data-view="${view.id}">${view.name}</button>`).join('')}
                </div>
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
              <div class="jt-stat"><b>${stats.highFit}</b><span>High-fit leads</span></div>
              <div class="jt-stat"><b>${stats.due}</b><span>Due now</span></div>
              <div class="jt-stat"><b>${stats.duplicateRisk}</b><span>Duplicate risk</span></div>
              <div class="jt-stat"><b>${stats.stale}</b><span>Stale active</span></div>
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
      const profile = profileHTML();
      if (!groups.length) return `<div class="jt-todo">${profile}<div class="jt-empty">No current tasks. New scout leads, applications to submit, dated follow-ups, and interview actions will show here.</div></div>`;
      return `<div class="jt-todo">${profile}${groups.map(group => `<section class="jt-task-section">
        <div class="jt-task-head">
          <div><h3>${esc(group.name)}</h3><p>${esc(group.hint)}</p></div>
          <span class="jt-task-count">${group.jobs.length}</span>
        </div>
        <div class="jt-task-list">${group.jobs.map(job => taskHTML(job, group.id)).join('')}</div>
      </section>`).join('')}</div>`;
    }

    function profileHTML() {
      const stats = scoutStats();
      return `<section class="jt-profile">
        <div class="jt-profile-top">
          <div><b>${esc(CANDIDATE_PROFILE.headline)}</b><p>${esc(CANDIDATE_PROFILE.summary)}</p></div>
          <span class="jt-chip low">No sponsorship</span>
        </div>
        <div class="jt-fit-tags">${CANDIDATE_PROFILE.fitChecks.map(item => `<span>${esc(item)}</span>`).join('')}</div>
        <div class="jt-insights">
          <div class="jt-insight"><b>${stats.highFit}</b><span>High fit</span></div>
          <div class="jt-insight"><b>${stats.duplicateRisk}</b><span>Dup risk</span></div>
          <div class="jt-insight"><b>${stats.urgent}</b><span>Urgent</span></div>
          <div class="jt-insight"><b>${stats.stale}</b><span>Stale</span></div>
        </div>
      </section>`;
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
      const fit = fitScoreFor(job);
      const lead = fit.lead;
      const urgency = urgencyFor(job);
      const actionText = groupId === 'fit'
        ? 'Fit-check this lead against your May 2027 MS timeline, entry-level/new-grad target, no-sponsorship status, role fit, location, and duplicate history.'
        : groupId === 'stale'
          ? 'Decide whether this should get a real follow-up, stay active, or be archived as ghosted.'
        : job.nextAction || (isSaved ? 'Review the role and decide whether to apply.' : 'Review the next concrete action.');
      const prior = priorApplicationFor(job);
      const priorText = priorApplicationText(prior);
      return `<div class="jt-task">
        <button class="jt-task-main" data-act="select" data-id="${esc(job.id)}">
          <div class="jt-card-top">
            <div><div class="jt-role">${esc(job.title || 'Untitled role')}</div><div class="jt-company">${esc(job.company || 'Unknown company')}</div></div>
            <span class="jt-chip ${chipClass(job.priority)}">${esc(job.priority)}</span>
          </div>
          <div class="jt-meta">
            <span class="jt-score ${fit.tone}">Fit ${fit.score}</span>
            <span class="jt-chip">${esc(stageById(job.stage).name)}</span>
            ${job.location ? `<span class="jt-chip">${esc(job.location)}</span>` : ''}
            ${job.dateApplied ? `<span class="jt-chip">Applied ${esc(formatDate(job.dateApplied))}</span>` : ''}
            ${sourceChip(job)}
            <span class="jt-chip ${lead.tone === 'bad' ? 'high' : lead.tone === 'good' ? 'low' : 'medium'}">${esc(lead.label)}</span>
            <span class="jt-chip ${fit.source.tone === 'bad' ? 'high' : fit.source.tone === 'good' ? 'low' : 'medium'}">${esc(fit.source.label)}</span>
            ${urgency.label ? `<span class="jt-chip ${urgency.tone === 'bad' ? 'high' : urgency.tone === 'good' ? 'low' : 'medium'}">${esc(urgency.label)}</span>` : ''}
            ${priorText ? `<span class="jt-chip high">${esc(priorText)}</span>` : ''}
            ${status ? `<span class="jt-chip ${due.due || isStale(job) ? 'high' : ''}">${esc(status)}</span>` : ''}
          </div>
          <div class="jt-task-text">${esc(actionText)}</div>
          ${groupId === 'fit' ? `<div class="jt-fit-check">${CANDIDATE_PROFILE.fitChecks.map(item => `<span>${esc(item)}</span>`).join('')}</div>` : ''}
          ${priorText ? `<div class="jt-prior-note">${esc(priorText)}. Check whether this is a new cycle and whether the portal allows another application.</div>` : ''}
        </button>
        <div class="jt-task-actions">
          ${job.link ? `<a class="jt-link-btn" href="${esc(job.link)}" target="_blank" rel="noreferrer">Open</a>` : ''}
          ${groupId === 'fit' ? `<button class="jt-btn slim" data-act="fit-ok" data-id="${esc(job.id)}">Fit OK</button>` : ''}
          ${isSaved ? `<button class="jt-btn slim primary" data-act="mark-applied" data-id="${esc(job.id)}">Applied</button>` : ''}
          ${groupId === 'apply' || groupId === 'fit' ? `<button class="jt-btn slim" data-act="archive" data-id="${esc(job.id)}">Skip</button>` : ''}
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
      const priorText = priorApplicationText(priorApplicationFor(job));
      const fit = fitScoreFor(job);
      const urgency = urgencyFor(job);
      return `<button class="jt-card ${active}" data-act="select" data-id="${job.id}">
        <div class="jt-card-top">
          <div><div class="jt-role">${esc(job.title || 'Untitled role')}</div><div class="jt-company">${esc(job.company || 'Unknown company')}</div></div>
          <span class="jt-chip ${chipClass(job.priority)}">${esc(job.priority)}</span>
        </div>
        <div class="jt-meta">
          <span class="jt-score ${fit.tone}">Fit ${fit.score}</span>
          ${job.location ? `<span class="jt-chip">${esc(job.location)}</span>` : ''}
          ${job.workMode && job.workMode !== 'Unknown' ? `<span class="jt-chip">${esc(job.workMode)}</span>` : ''}
          ${job.dateApplied ? `<span class="jt-chip">Applied ${esc(formatDate(job.dateApplied))}</span>` : ''}
          ${sourceChip(job)}
          <span class="jt-chip ${fit.lead.tone === 'bad' ? 'high' : fit.lead.tone === 'good' ? 'low' : 'medium'}">${esc(fit.lead.label)}</span>
          <span class="jt-chip ${fit.source.tone === 'bad' ? 'high' : fit.source.tone === 'good' ? 'low' : 'medium'}">${esc(fit.source.label)}</span>
          ${salary ? `<span class="jt-chip">${esc(salary)}</span>` : ''}
          ${priorText ? `<span class="jt-chip high">${esc(priorText)}</span>` : ''}
          ${urgency.label ? `<span class="jt-chip ${urgency.tone === 'bad' ? 'high' : urgency.tone === 'good' ? 'low' : 'medium'}">${esc(urgency.label)}</span>` : ''}
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
        <thead><tr><th>Role</th><th>Fit</th><th>Seen</th><th>Stage</th><th>Priority</th><th>Applied</th><th>Next action</th><th>Due</th><th>Location</th><th>Contact</th></tr></thead>
        <tbody>${jobs.map(job => {
          const due = dueStatus(job);
          const fit = fitScoreFor(job);
          return `<tr class="jt-row" data-act="select" data-id="${job.id}">
            <td><b>${esc(job.title || 'Untitled role')}</b><br><span>${esc(job.company || 'Unknown company')}</span></td>
            <td><span class="jt-score ${fit.tone}">${fit.score}</span></td>
            <td><span class="jt-chip ${fit.lead.tone === 'bad' ? 'high' : fit.lead.tone === 'good' ? 'low' : 'medium'}">${esc(fit.lead.label)}</span></td>
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
            <div class="jt-detail-empty-title">No job selected</div>
            <button class="jt-btn primary" data-act="new">New Job</button>
          </div>
        </div>`;
      }
      const dupe = duplicateFor(job);
      const prior = priorApplicationFor(job);
      const priorText = priorApplicationText(prior);
      const fit = fitScoreFor(job);
      const urgency = urgencyFor(job);
      const angles = resumeAnglesFor(job);
      return `<div class="jt-detail-head">
        <h3>${esc(job.title || 'New job')}</h3>
        <p>${esc(job.company || 'Company not set')} ${job.stage ? '- ' + esc(stageById(job.stage).name) : ''}</p>
      </div>
      <form class="jt-detail-body" data-form="job">
        <input type="hidden" name="id" value="${esc(job.id)}">
        ${prior ? `<div class="jt-dupe">Prior application warning: ${esc(priorText)} for ${esc(prior.company)} - ${esc(prior.title)}. Reapply only if this posting is a new cycle or the portal allows it.</div>` : dupe ? `<div class="jt-dupe">Possible duplicate: ${esc(dupe.company)} - ${esc(dupe.title)}</div>` : ''}
        ${needsFitCheck(job) ? `<section class="jt-section"><h4>Fit check</h4><div class="jt-fit-tags">${CANDIDATE_PROFILE.fitChecks.map(item => `<span>${esc(item)}</span>`).join('')}</div><p class="jt-section-note">${esc(CANDIDATE_PROFILE.summary)}</p></section>` : ''}
        <section class="jt-section">
          <h4>Scout intelligence</h4>
          <div class="jt-analysis">
            <div class="jt-analysis-row"><b>Fit score</b><span><span class="jt-score ${fit.tone}">${fit.score} ${esc(fit.label)}</span> ${esc(fit.reasons.slice(0, 5).join(' / '))}</span></div>
            <div class="jt-analysis-row"><b>Lead status</b><span>${esc(fit.lead.label)} - ${esc(fit.lead.detail)}</span></div>
            <div class="jt-analysis-row"><b>Source</b><span>${esc(fit.source.label)} - ${esc(fit.source.detail)}</span></div>
            <div class="jt-analysis-row"><b>Location</b><span>${esc(fit.location.label)}${job.location ? ' - ' + esc(job.location) : ''}</span></div>
            ${urgency.label ? `<div class="jt-analysis-row"><b>Urgency</b><span>${esc(urgency.label)}</span></div>` : ''}
            ${angles.length ? `<div><div class="jt-analysis-row"><b>Resume angle</b><span>Use these notes when tailoring.</span></div><ul class="jt-angle">${angles.map(angle => `<li>${esc(angle)}</li>`).join('')}</ul></div>` : ''}
          </div>
        </section>
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
        nextAction: '',
        nextActionDate: '',
      }, 'Marked as applied from To-do.');
    }

    function archiveJob(id, text) {
      quickUpdateJob(id, {
        stage: 'archived',
        nextAction: '',
        nextActionDate: '',
      }, text || 'Archived from To-do.');
    }

    function markFitChecked(id) {
      const job = state.jobs.find(j => j.id === id);
      if (!job) return;
      const tags = (job.tags || []).filter(tag => tag !== 'needs-fit-check');
      if (!tags.includes('fit-checked')) tags.push('fit-checked');
      quickUpdateJob(id, { tags }, 'Marked as fit-checked against May 2027 profile.');
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

    function mergeSeedRecord(existing, incoming) {
      if (!existing) return incoming;
      if (!isSeedRecord(existing)) return existing;
      const userMoved = existing.stage !== incoming.stage && existing.stage !== 'saved';
      if (userMoved || existing.dateApplied) return existing;
      return normalizeJob(Object.assign({}, existing, incoming, {
        id: existing.id,
        createdAt: existing.createdAt || incoming.createdAt,
        history: Array.isArray(existing.history) && existing.history.length ? existing.history : incoming.history,
      }));
    }

    function importRecords(payload, options) {
      const overwrite = !options || options.overwrite !== false;
      const seedMerge = options && options.seedMerge;
      const incoming = Array.isArray(payload) ? payload : payload && payload.jobs;
      if (!Array.isArray(incoming)) throw new Error('Missing jobs array');
      const byId = new Map(state.jobs.map(j => [j.id, j]));
      incoming.map(normalizeJob).filter(Boolean).forEach(job => {
        if (seedMerge && byId.has(job.id)) byId.set(job.id, mergeSeedRecord(byId.get(job.id), job));
        else if (overwrite || !byId.has(job.id)) byId.set(job.id, job);
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
          importRecords(payload, { overwrite: false, seedMerge: true });
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
      else if (act === 'fit-ok') { markFitChecked(btn.dataset.id); return; }
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
