# Backlog autopilot — routine prompt

This is the prompt for a scheduled **Routine** (see
https://code.claude.com/docs/en/routines). Point a routine at this repo with a
**Schedule** trigger (every 2 hours), and set its instructions to:

> Read `tasks/ROUTINE.md` in this repo and follow it exactly.

Each routine run is a fresh, autonomous cloud session that clones the repo from
`main`. There is no human at the keyboard, so the steps below are written to be
self-contained, conservative, and safe to run unattended. **When in doubt, do
less** — an unmerged draft PR a human can review beats a wrong change.

---

## What to do, in order

### 1. Don't stack up work — check for an open autopilot PR first
A routine pushes only to `claude/`-prefixed branches and opens PRs; it never
commits to `main`. So the backlog on `main` won't reflect in-flight work. Before
starting anything, list open PRs whose head branch starts with
`claude/autopilot-`.

- **If any such PR is still open** (not merged, not closed): a previous run is
  already waiting on Edward's review. **Stop now** — do nothing, end the turn.
  Don't pile a second PR on top.
- If there are none, continue.

### 2. Pick the work
Read `tasks/TASKS.md`. From the **📥 Todo** section, choose the single best item:

- Honor priority order: `[p1]` before `[p2]` before `[p3]`; among equal
  priority, top-to-bottom.
- **Skip** any item tagged `@blocked`.
- **Skip** any item that is ambiguous or clearly larger than one session's worth
  of focused work — don't guess at scope on a vague item. Move to the next
  eligible item instead.
- If **no item is eligible** (backlog empty, or every item is blocked / ambiguous
  / too large): **stop** — do nothing, end the turn. This is a normal, expected
  outcome; an idle run is fine.

### 3. Do an appropriately-sized chunk
- Create a fresh branch named `claude/autopilot-<short-slug>` off `main`.
- Implement a coherent, reviewable chunk of the chosen item. If the item is big,
  do one clean, self-contained slice rather than a sprawling half-finished pass —
  and say in the PR body what's done vs. what's left.
- Follow the repo's conventions in `CLAUDE.md`: vanilla only (no deps/build), one
  self-contained file per game, bump `?v=N` in **both** `js/app-manifest.js` and
  `sw.js` plus the `CACHE` constant when you touch a cached asset, etc.

### 4. Verify
- Run `npm test` and make sure it passes. If you can't get it green, don't open a
  PR with broken checks — instead open the PR as a draft, clearly flag in the body
  that tests are red and why, and stop.

### 5. Record it in the backlog (same PR)
- Move the chosen item out of **📥 Todo** with the task CLI and mark it done,
  dated, in the **✅ Done** section:
  `node scripts/task.js list` to find its number, then `node scripts/task.js done <n>`.
- After you open the PR (next step) and know its number, append ` (#NN)` to that
  Done line so it reads `- [x] YYYY-MM-DD — … (#NN)`. Commit this with the rest.

### 6. Open a **draft** PR and stop — do not merge
- Push the branch and open a **draft** PR titled for the work, body summarizing
  what changed, how it was verified, and anything left to do.
- **Do not squash-merge.** Autopilot runs stop at a reviewable draft; Edward
  merges (or asks for changes) by hand. Then end the turn.

---

## Guardrails
- One PR per run, maximum. Never touch `main` directly.
- Never delete or overwrite something you didn't create without flagging it.
- If a step is genuinely ambiguous and you'd have to guess at intent, prefer the
  smaller / reversible choice, and note the open question in the PR body rather
  than making an irreversible call.
- This file and `tasks/TASKS.md` are the source of truth; keep them tidy.
