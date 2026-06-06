#!/usr/bin/env node
'use strict';
/* Tiny dependency-free CLI over tasks/TASKS.md. The Markdown stays the single,
   hand-editable source of truth (edit it on GitHub from a phone, or use this);
   the CLI just does line-level edits so it round-trips with manual edits.

   Usage:
     node scripts/task.js list                      # show numbered open tasks
     node scripts/task.js add "desc" [--p N] [--area X]
     node scripts/task.js start <n>                 # Todo -> In progress
     node scripts/task.js done <n>                  # -> Done (dated, checked)
     node scripts/task.js rm <n>                    # delete a task
   Tasks are numbered in `list` order (Todo first, then In progress). */
const fs = require('fs');
const path = require('path');

const FILE = process.env.TASKS_FILE || path.resolve(__dirname, '..', 'tasks', 'TASKS.md');
const SECTIONS = { todo: '## 📥 Todo', prog: '## 🏗️ In progress', done: '## ✅ Done' };
const isTask = l => /^- \[[ xX]\] /.test(l);
const isIndent = l => /^\s+\S/.test(l);

const read = () => fs.readFileSync(FILE, 'utf8').split('\n');
const write = lines => fs.writeFileSync(FILE, lines.join('\n'));
const die = msg => { console.error('task: ' + msg); process.exit(1); };

function rangeOf(lines, key) {
  const heads = []; lines.forEach((l, i) => { if (/^## /.test(l)) heads.push(i); });
  let idx = -1; for (const i of heads) if (lines[i].trim() === SECTIONS[key]) idx = i;
  if (idx < 0) return null;
  let end = lines.length; for (const i of heads) if (i > idx) { end = i; break; }
  return { header: idx, start: idx + 1, end };
}
// task "blocks" = a `- [ ]` line plus any immediately-following indented detail lines
function blocks(lines, key) {
  const r = rangeOf(lines, key); if (!r) return [];
  const out = [];
  for (let i = r.start; i < r.end; i++) {
    if (isTask(lines[i])) { let j = i + 1; while (j < r.end && isIndent(lines[j])) j++; out.push({ key, start: i, end: j }); i = j - 1; }
  }
  return out;
}
const openTasks = lines => [...blocks(lines, 'todo'), ...blocks(lines, 'prog')];

function cmdList() {
  const lines = read();
  const open = openTasks(lines);
  if (!open.length) { console.log('No open tasks. Add one: node scripts/task.js add "…"'); return; }
  let n = 0, lastKey = null;
  for (const b of open) {
    if (b.key !== lastKey) { console.log('\n' + (b.key === 'todo' ? '📥 Todo' : '🏗️  In progress')); lastKey = b.key; }
    n++; console.log('  ' + String(n).padStart(2) + '. ' + lines[b.start].replace(/^- \[[ xX]\] /, ''));
    for (let i = b.start + 1; i < b.end; i++) console.log('      ' + lines[i].trim());
  }
  const done = blocks(lines, 'done').length;
  console.log('\n(' + open.length + ' open · ' + done + ' done)');
}

function cmdAdd(argv) {
  let desc = [], p = null, area = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--p') p = argv[++i];
    else if (argv[i] === '--area') area = argv[++i];
    else desc.push(argv[i]);
  }
  desc = desc.join(' ').trim();
  if (!desc) die('add needs a description, e.g. add "tune the Knight" --p 2 --area stickrun');
  const tags = [];
  if (p) tags.push('[p' + String(p).replace(/\D/g, '') + ']');
  if (area) tags.push('[area:' + area + ']');
  const line = '- [ ] ' + (tags.length ? tags.join(' ') + ' ' : '') + desc;
  const lines = read();
  const r = rangeOf(lines, 'todo'); if (!r) die('no "📥 Todo" section in ' + FILE);
  let ins = r.end; while (ins > r.start && lines[ins - 1].trim() === '') ins--;   // append after existing todos
  lines.splice(ins, 0, line); write(lines);
  console.log('Added to Todo: ' + desc);
}

function take(n) {
  const lines = read();
  const open = openTasks(lines);
  const i = parseInt(n, 10);
  if (!Number.isInteger(i) || i < 1 || i > open.length) die('no open task #' + n + ' (see: task list)');
  const b = open[i - 1];
  const removed = lines.slice(b.start, b.end);
  lines.splice(b.start, b.end - b.start);
  return { lines, removed, text: removed[0].replace(/^- \[[ xX]\] /, '') };
}
function insertTop(lines, key, block) {
  const r = rangeOf(lines, key); if (!r) die('no section "' + SECTIONS[key] + '"');
  let ins = r.start; while (ins < r.end && lines[ins].trim() === '') ins++;   // after header + blank
  lines.splice(ins, 0, ...block); return lines;
}
function cmdStart(n) { const { lines, removed, text } = take(n); write(insertTop(lines, 'prog', removed)); console.log('Started: ' + text); }
function cmdRm(n) { const { lines, text } = take(n); write(lines); console.log('Removed: ' + text); }
function cmdDone(n) {
  const { lines, removed, text } = take(n);
  let head = removed[0].replace(/^- \[[ xX]\] /, '');
  const today = new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}/.test(head)) head = today + ' — ' + head;
  removed[0] = '- [x] ' + head;
  write(insertTop(lines, 'done', removed));
  console.log('Done: ' + text);
}

const [cmd, ...rest] = process.argv.slice(2);
switch (cmd) {
  case 'add': cmdAdd(rest); break;
  case 'start': cmdStart(rest[0]); break;
  case 'done': cmdDone(rest[0]); break;
  case 'rm': case 'remove': cmdRm(rest[0]); break;
  case 'list': case undefined: cmdList(); break;
  default: console.log('Usage: node scripts/task.js <list|add|start|done|rm>\n  add "desc" [--p N] [--area X]\n  start|done|rm <n>   (numbers from `list`)');
}
