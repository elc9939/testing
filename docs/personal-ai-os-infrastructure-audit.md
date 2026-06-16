# Personal AI OS Infrastructure Audit

Date: 2026-06-16

Scope: FastAPI AI OS backend, Ollama/provider routing, local RAG storage, browser dashboard, local lifecycle scripts, dependency/model hygiene. This is intentionally personal-scale robustness: no Kubernetes, no CI/CD ceremony, no distributed queue until the system actually needs it.

## Prioritized Risk Ranking

1. **No tested backup/restore path**
   - Missing: automated backups, manifests, checksums, and restore verification for the AI OS SQLite database, RAG index, config summary, and generated assets.
   - Risk: high likelihood, high impact. Local AI/RAG data can quietly become important; losing or corrupting it would be painful.
   - Fix: add scheduled local backups, manifest checksums, SQLite integrity checks, retention, CLI/API/dashboard backup actions, and restore-test support.

2. **No schema migration ledger**
   - Missing: durable schema versioning for tables that will change as providers, jobs, agents, and memory evolve.
   - Risk: medium likelihood, high impact. A future refactor could break old local data or create half-applied schemas.
   - Fix: add `schema_migrations`, a current schema version, idempotent migration application, foreign-key enforcement, and integrity reporting.

3. **Resource guardrails were partial**
   - Missing: caps for active jobs, request size, prompt size, batch size, job runtime, result retention, and temp/log cleanup.
   - Risk: medium likelihood, high impact. Local model loops can eat RAM, VRAM, or disk quickly.
   - Fix: add bounded Pydantic inputs, HTTP body limit, max active jobs, job timeout, concurrency caps, result caps, temp/log cleanup, and exposed queue metrics.

4. **Observability was useful but shallow**
   - Missing: a single full-health surface, structured logs, backup health, queue metrics, and database integrity visibility.
   - Risk: medium likelihood, medium impact. Failures would be visible only after a feature broke.
   - Fix: add JSONL rotating logs, `/api/ai/health/full`, `/api/ai/metrics`, `/api/ai/integrity`, backup status endpoints, and dashboard foundation health cards.

5. **Security assumed localhost but did not enforce it**
   - Missing: a request-level guard against accidental LAN exposure and safer request validation.
   - Risk: low-to-medium likelihood, high impact if the service is bound broadly.
   - Fix: default `AI_OS_REQUIRE_LOOPBACK=true`, reject non-loopback clients with `403`, keep secrets env-only, and redact sensitive config/log fields.

6. **Lifecycle management was manual**
   - Missing: simple start/stop/status scripts and an optional crash-restart loop.
   - Risk: medium likelihood, medium impact. After reboot or crash, the system needed manual care.
   - Fix: add `scripts/ai-os.ps1`, root `pnpm ai-os:*` wrappers, and a lightweight `scripts/ai-os-supervisor.ps1`.

7. **Dependency and model hygiene was ad hoc**
   - Missing: a repeatable command to inspect JS/Python advisories, outdated packages, and local Ollama models.
   - Risk: medium likelihood, medium impact.
   - Fix: add exact Python pins and `scripts/ai-os-deps.ps1`.
   - Residual: `pnpm audit --prod` still reports transitive `esbuild` and `cookie` advisories through current `better-auth` / `drizzle-kit` / `@sveltejs/kit`. Package update checks did not show a simple safe bump at this time; keep monitoring with `pnpm ai-os:audit`.

8. **Testing safety net was thin**
   - Missing: tests around backup/restore, migration integrity, request bounds, health endpoints, and local-only guard.
   - Risk: medium likelihood, medium impact.
   - Fix: add focused backend tests for the load-bearing paths without trying to chase 100 percent coverage.

## Area-by-Area Improvements

### Backups And Disaster Recovery

- Implemented `BackupManager` with local backup directories under `AI_OS_BACKUP_DIR` or `.ai-os-data/backups`.
- Each backup contains:
  - `ai-os.sqlite3`
  - `manifest.json`
  - `config-redacted.json`
  - copied generated assets from `AI_OS_ASSETS_DIR` when present
- Each backup records SHA-256 checksums, app version, schema version, database counts, and integrity status.
- Scheduled backups run in-process by default every `AI_OS_BACKUP_INTERVAL_MINUTES` minutes and keep `AI_OS_BACKUP_RETENTION_COUNT` backups.
- Restore is deliberately non-destructive by default: CLI restore writes to a target path and requires `--confirm RESTORE`.
- Dashboard, API, and CLI all support create, verify, and restore-test.

### Data Integrity And Schema Evolution

- Added `schema_migrations` and `CURRENT_SCHEMA_VERSION`.
- Database opens with `pragma foreign_keys = on` and WAL mode.
- Added indexes for common memory, usage, and job-event lookups.
- Added `integrity_report()` with SQLite `pragma integrity_check`, `pragma foreign_key_check`, schema version, table counts, and JSON validation for metadata/result columns.

### Observability And Health

- Added JSONL rotating logs under `AI_OS_LOG_DIR`.
- Logs redact common secret-bearing names and include request method/path/status/latency.
- Added health/status surfaces:
  - `GET /api/ai/health`
  - `GET /api/ai/health/full`
  - `GET /api/ai/metrics`
  - `GET /api/ai/integrity`
  - `GET /api/ai/backups`
- Dashboard now has a Foundation Health panel showing database, backup, queue, failure, and backup table status.

### Testing Safety Net

- Added tests for:
  - provider fallback and usage logging
  - RAG ingest/query
  - async map jobs
  - schema migration/integrity
  - backup verify/restore
  - bounded request validation
  - health/backup endpoints
  - non-loopback rejection

### Secrets And Security

- Secrets remain env-only via `.env` / environment variables.
- `.env.example` documents names but contains no real secrets.
- Sensitive config is redacted in backup manifests and logging helpers.
- Default host remains `127.0.0.1`.
- `AI_OS_REQUIRE_LOOPBACK=true` rejects non-loopback request clients.
- Request body size and Pydantic model bounds protect OS/file/model-facing actions from accidental huge inputs.

### Resource Safety And Cleanup

- Added settings for request size, prompt size, memory ingest size, active jobs, concurrency, timeout, result cap, and cleanup age.
- Job queue rejects excessive active jobs and marks timed-out work as failed.
- Cleanup removes stale temp/log files and applies backup retention.

### Process And Lifecycle Management

- Added `scripts/ai-os.ps1` for start, stop, restart, status, health, backup, verify, restore-test, integrity, and cleanup.
- Added package scripts:
  - `pnpm ai-os:start`
  - `pnpm ai-os:stop`
  - `pnpm ai-os:status`
  - `pnpm ai-os:backup`
  - `pnpm ai-os:audit`
- Added `scripts/ai-os-supervisor.ps1` as an optional lightweight restart loop for a personal machine.

### Dependency And Model Hygiene

- Python dependencies are pinned exactly in `requirements.txt` and `pyproject.toml`.
- Added `scripts/ai-os-deps.ps1` for:
  - JS/Python audit
  - Python outdated check
  - Ollama local model listing
- Residual advisory tracking is documented instead of hidden.

## Residual Risks

- The broader Hono personal sync/productivity API still has an in-memory fallback store. Anything user-facing stored there should be moved to the existing Postgres store path before being treated as durable.
- The AI OS queue is still in-process. That is right-sized for now, but jobs disappear if the process dies. Long-running valuable jobs should later persist checkpoints/results to SQLite.
- Model caches and large generated assets are only backed up if placed under configured AI OS asset paths. Huge model files are intentionally not copied into routine backups.
- `pnpm audit --prod` currently reports transitive advisories that require upstream package movement or a more invasive dependency change.

## Worst-Risk-First Implementation Order

1. Backup/restore and integrity checks.
2. Schema migrations and data validation.
3. Resource limits and cleanup.
4. Health/metrics/logging and dashboard visibility.
5. Local-only guard and secret redaction.
6. Lifecycle scripts.
7. Dependency/model hygiene scripts.
8. Focused regression tests.
