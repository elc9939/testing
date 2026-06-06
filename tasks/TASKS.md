# Task Backlog

Tasks **Edward** wants **Claude** to work on. This file is the source of truth —
it's committed to the repo, so any Claude session (including from mobile) can read
it and pick up where things left off. Nothing here is on the public site (the
Pages deploy doesn't include `tasks/`).

## How to add a task (you)
- Add a bullet under **📥 Todo** below. **One line is enough** — e.g.
  `- [ ] Make the Knight feel heavier`.
- Add detail under the bullet if you want (indented sub-bullets, links, etc.).
- Optional tags, anywhere in the line:
  - Priority: `[p1]` (do first) · `[p2]` · `[p3]` (whenever)
  - Area: `[area:stickrun]`, `[area:pwa]`, `[area:ai]`, …
  - `@blocked` if it's waiting on something (say what in a sub-bullet).
- On your phone: open this file on GitHub → ✏️ edit → commit. Or just tell me in
  chat and I'll file it here.

## How I work it (Claude)
1. At the start of a session, read this file.
2. Pick the top unblocked **Todo** (respecting `[p1]` first), move it to
   **🏗️ In progress**, and do it on a branch → draft PR → squash-merge.
3. On finish, move it to **✅ Done** with the date + PR number, e.g.
   `- [x] 2026-06-06 — Did the thing (#42)`.
4. If something's ambiguous, I ask before building (lesson learned 😄).

---

## 📥 Todo

_Add tasks here. The examples below are real candidates from our chats — keep,
edit, reprioritize, or delete them freely._

- [ ] [p2] [area:stickrun] Playtest-tune Stick Arena: class balance, cooldown
      lengths, and whether ranged classes (Mage/Ranger) feel too safe.
- [ ] [p3] [area:stickrun] Delete the retired `js/games/arenatactics.js` file
      once you're sure nothing from it is still wanted (it's already disabled).
- [ ] [p3] [area:pwa] PWA app polish: iOS splash/launch images + verify install
      meta, so it feels more like a native app when added to the home screen.

## 🏗️ In progress

_(nothing yet)_

## ✅ Done

- [x] 2026-06-06 — Set up this task backlog (`tasks/TASKS.md`).
