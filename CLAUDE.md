# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Mini Arcade** — a dependency-free browser arcade (vanilla HTML/CSS/Canvas, **no build step**) deployed to GitHub Pages at https://elc9939.github.io/testing/ as an installable, offline-capable PWA. The repo also contains a local-only **AI lab** (`ai/`) for training game models and a standalone **Java LogMiner** CLI (`logminer/`) that share the repo but are independent of the arcade.

## Commands

```bash
# Run all checks (this is what `npm test` runs and what CI gates on)
npm test                       # === node scripts/check-all.js

# Individual checks
npm run check:js               # node --check on sw.js, js/, scripts/
npm run check:pwa              # PWA cache-coverage check (see "PWA cache invariant")
npm run check:logminer         # javac logminer/*.java + smoke test (needs JDK 21)

# Serve locally (no build — just static files)
python3 -m http.server 8000    # then open http://localhost:8000

# AI lab (local only; arcade ships the exported weights, not the trainer)
npm run ai:connect4:eval
npm run ai:connect4:train
node scripts/eval-connect4.js 2 8       # tiny smoke args: (games, sims)
node scripts/train-connect4.js 1 2 8    # tiny smoke args: (iters, games, sims)

# Regenerate PWA PNG icons
npm run icons
```

There is no test framework — "tests" are the Node check scripts above plus per-game **headless harnesses** (see Testing). Run a single check directly with `node scripts/<name>.js`.

## Architecture

### Arcade shell + lazy-load manifest (the core pattern)
The shell is `js/arcade.js`. It exposes a global `Arcade` and drives the whole app. Adding/loading a game is a **two-step, decoupled** flow:

1. **Catalog entry** in `js/app-manifest.js` — a lightweight card: `{ id, name, emoji, desc, color, kind, src }`. This calls `Arcade.define([...])`. The `src` script is **not** loaded until the user opens the card.
2. **Runtime registration** inside the game file: `Arcade.register({ id, start(root, api), stop? })`. The `id` must match the catalog entry's `id`; the shell merges them.

So a game's file is loaded lazily on first open, then self-registers its `start` function. `start(root, api)` mounts the game into the `root` DOM element.

> Note: an older pattern loaded games via `<script>` tags in `index.html`. That is **gone** — never add game scripts to `index.html`. Use the manifest.

### The `api` object passed to `start(root, api)`
All helpers auto-clean when the player exits to the menu (listeners removed, RAF cancelled, `stop()` called). Use them instead of raw DOM/`requestAnimationFrame` so cleanup is automatic:
- `makeCanvas(root, {width?, height?, onResize?})` → `{canvas, ctx, w, h, dpr}`. DPR is capped by the current quality tier.
- `loop(cb)` → `cb(dt, now, rawDt, perf)`; `dt` is clamped to 60ms. Skips ticks while `document.hidden`.
- `on(target, type, fn, opts)` — tracked `addEventListener`.
- `onCleanup(fn)` — register teardown.
- `getBest(key)` / `setBest(key, val)` — persistent high scores in `localStorage` (keyed `arcade_<key>`; `setBest` only writes if higher).
- `perf` — adaptive quality. `perf.particleCount(n)`, `perf.particleLimit(n)`, `perf.trailLimit(n)`, `perf.quality()`, `perf.snapshot()`. The shell auto-downshifts a 3-tier quality system (low/medium/high) under frame pressure; games should scale effect counts through these so they stay smooth on phones. `F2` toggles a perf overlay; `?perf` or `?debug=1` forces it on.

Games clear/fill their own backgrounds (the stage background is dark). Shared CSS classes live in `css/style.css`: `.center-overlay`(+`.hidden`), `.msg`, `.btn`(+`.btn.alt`), `.hud` (`.a` accent / `.b` gold), `.stat-row`, `.stat .v/.l`, `.new-best`.

### PWA cache invariant (CI will fail if you skip this)
`sw.js` precaches every asset for offline play. **Two rules, enforced by `scripts/check-pwa-cache.js`:**
1. Every `src`/`href` in `index.html`, every icon in `manifest.webmanifest`, and every game `src` in `js/app-manifest.js` **must** appear in the `ASSETS` array in `sw.js`.
2. Every cached path must actually exist on disk.

Assets are cache-busted with `?v=N` query strings. When you change a game file, bump its `?v=N` in **both** `app-manifest.js` and `sw.js` (they must match), and bump the top-level `CACHE = 'mini-arcade-vNN'` constant in `sw.js` so clients pick up the new version. The same applies to `css/style.css` and `js/arcade.js` (versioned in `index.html`).

### AI lab (`ai/connect4/`)
Reusable modules (`env`, `net`, `mcts`, `trainer`, `evaluate`, `random`) implementing an AlphaZero-style pipeline: a tiny policy+value MLP + PUCT MCTS + self-play training with hand-rolled Adam backprop. `scripts/train-connect4.js` is a thin CLI over `ai/connect4/trainer` and writes `js/games/connect4-weights.json` (the compact model the in-browser Connect Four game loads at startup; `connect4.js` reads `net.H1/H2` from the weights meta so it adapts to net size). Heavy training stays out of the browser by design.

### Deploy (`pages.yml`)
Push to `main` → GitHub Pages deploys. The job assembles `_site` from **only** `index.html`, `manifest.webmanifest`, `sw.js`, `css/`, `js/`, `icons/` — deliberately excluding `.env`, `*.json` at root, notebooks, the AI lab, and LogMiner. Never rely on anything outside that copied set being public, and never expect `.env` to deploy.

## Testing

Games are validated with **headless Node harnesses**: stub a minimal DOM + a NaN-checking 2D canvas context, capture the `api.loop` callback, and drive the game through an inert test seam the game exposes on `window` (e.g. `window.__c4test`, `window.__gambitTest`, `window.__arenaTest`). When adding logic-heavy games, expose a similar `window.__<game>Test` seam (getters for state + input injection) so behavior can be asserted without a browser. Node 22 is the target; `navigator` is read-only there — don't assign to it in shared code.

## Conventions

- **Vanilla only** — no dependencies, no bundler, no framework. Keep it that way.
- Each game is one self-contained file in `js/games/`, scoping its own CSS via an injected `<style>` when it needs DOM UI.
- Match the surrounding file's style; many games are large and idiomatic to themselves.
- Design docs live in `docs/` (e.g. `docs/stick-arena-tactics.md` is the active Stick Arena progression + tactical-combat spec). Treat the committed Markdown as the source of truth for in-progress designs.

## Git / PR workflow

- Branch off `main` for changes; CI runs on pushes to `main` and on PRs.
- After pushing, open a **draft** PR; mark ready, then squash-merge. Pages auto-deploys on merge to `main`.
- `main` churns frequently — rebase on conflict rather than forcing.
