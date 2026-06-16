# Hybrid Mini Hub Rewrite

This repo now contains two application tracks:

- The legacy static Mini Hub at the repository root remains deployable by the existing GitHub Pages workflow.
- The staged rewrite lives in `apps/*` and `packages/*` with pnpm workspaces.

## Workspaces

- `apps/hub`: SvelteKit SPA/static frontend.
- `apps/api`: Hono API with Better Auth mounted at `/api/auth/*` and v1 personal sync-key mode.
- `apps/desktop`: Tauri v2 shell around the SvelteKit build.
- `packages/core`: shared routes, launcher metadata, Zod contracts, and legacy storage keys.
- `packages/db`: Drizzle schema, PGlite local DB bootstrap, sync conflict helpers, migration inspection, and analytics helpers.
- `packages/game-engine`: PixiJS/Rapier Stick Arena Ability Lab vertical slice.
- `packages/ai`: dynamic Transformers.js and Tree-sitter helpers.
- `packages/ui`: shared tokens and small formatting helpers.

## Commands

Use the bundled pnpm or a local pnpm install:

```powershell
pnpm install
pnpm --filter @mini-hub/hub dev
pnpm --filter @mini-hub/api dev
pnpm typecheck
pnpm test:workspaces
pnpm build
```

The desktop shell is scaffolded, but a full `pnpm --filter @mini-hub/desktop build:tauri` requires a Rust/Tauri system setup.

## Deployment Notes

The existing Pages workflow still assembles only the legacy root files. Cutover should happen later by changing the Pages workflow to deploy `apps/hub/build` and keeping a legacy fallback route.

The API expects:

- `DATABASE_URL` for local Postgres or Neon.
- `BETTER_AUTH_SECRET` with at least 32 random characters.
- `BETTER_AUTH_URL` for the API origin.
- `TRUSTED_ORIGINS` for the SvelteKit/Tauri origins.
- `PUBLIC_SYNC_MODE=personal` for the no-account personal workflow.
- `MINI_HUB_SYNC_KEY` for the private key that each of your devices enters in Settings.

## Personal Offline + Sync V1

The current sync mode is personal, not public multi-user. The hub stores a per-device id and a private sync key in browser storage, sends the key as `X-Mini-Hub-Sync-Key`, and keeps a PGlite cache for offline reads.

- Online: Career Desk, Study Desk, game runs, game state, settings, and legacy snapshots auto-save through the API.
- Offline: cached data stays visible, but edit/save controls are disabled.
- Sync: the hub pulls `/api/sync/pull?since=<cursor>` on startup, focus, reconnect, and a 30-second interval.
- Legacy import: Settings can import current root-app `localStorage` keys into the synced workspace.
