# Research Engine / Web Intelligence

Mini Hub now has a first-pass Research Desk backed by the AI OS API. The goal is to make
web research a durable local artifact instead of a transient chat answer.

## Current Architecture

The Svelte route `/research` calls AI OS endpoints under `/api/ai/research/*`.

Pipeline v1:

1. `plan_research()` normalizes the request into search queries, seed URLs, crawl targets,
   and run knobs.
2. `SearchProvider` is an adapter interface. The built-in provider wraps the existing
   DuckDuckGo HTML web search tool. Tavily, Brave, Bing, SearxNG, RSS, sitemap, and site API
   adapters can be added behind the same interface.
3. `ResearchEngine` crawls with max pages, depth, time budget, per-domain limits,
   include/exclude domains, URL normalization, retry, cache reuse, and robots.txt checks.
4. Existing AI OS `WebAccess` performs network fetches and extraction limits. The extractor
   keeps title, author, published date, canonical URL, description, readable text, links,
   tables, headings, metadata, and optional browser screenshots when the run asks for them.
5. `dedupe_and_rank_sources()` picks canonical source cards and scores them against the goal.
6. `build_extractive_report()` creates a source-backed report without requiring a model.
   Optional `use_ai` adds a local/cloud AI synthesis layer through the unified inference
   router, while keeping source citations mapped separately.
7. `map_citations()` links key claims to source IDs and quotes where possible.
8. `AppStorage` persists `research_pages` and `research_runs`, so reports can be reopened and
   exported later. Research runs are created as durable queued records before work starts and
   update with progress, current step, partial sources, cancellation state, and final report
   data.
9. `research_monitors` stores reusable topic-watch templates. A monitor records the saved
   request knobs, enabled state, manual/daily/weekly cadence hint, run count, last run ID,
   last status, and last error. "Run Now" creates a normal archived research run with monitor
   metadata attached.
10. A real off-by-default AI OS background unit, `research.monitors.sweep`, can sweep enabled
   daily/weekly monitors and queue the ones that are due. The same sweep is exposed directly
   through the Research API and Research Desk.
11. When `save_to_memory` is enabled, the completed report plus source excerpts are ingested
   into AI OS semantic memory as a `research_run` document. The run stores
   `memory_document_id` and `memory_chunks` so the Research Desk and Action Ledger can show
   whether it became searchable local knowledge.
12. `build_ai_action_ledger()` emits research runs as `research.<mode>` AI OS actions with
   source count, cached page count, runtime, progress, provider/model, tokens, and cost
   memory index metadata. Runs created from a monitor include `research_monitor_id` and
   `research_monitor_name` in ledger metadata.

## API

- `POST /api/ai/research/runs`
- `GET /api/ai/research/runs?limit=25`
- `GET /api/ai/research/sources?q=<text>&domain=<host>&limit=25`
- `GET /api/ai/research/monitors?limit=50`
- `GET /api/ai/research/monitors/due?limit=10`
- `POST /api/ai/research/monitors/run-due`
- `POST /api/ai/research/monitors`
- `PATCH /api/ai/research/monitors/:id`
- `DELETE /api/ai/research/monitors/:id`
- `POST /api/ai/research/monitors/:id/run`
- `GET /api/ai/research/runs/:id`
- `GET /api/ai/research/runs/:id/export?format=markdown|json|html`
- `POST /api/ai/research/runs/:id/cancel`

`POST /api/ai/research/runs` returns the initial queued run immediately. AI OS then executes
the crawl in a FastAPI background task and the Research Desk polls `GET /api/ai/research/runs/:id`
while `status` is `queued` or `running`. Persisted run records include:

- `progress`
- `total_steps`
- `completed_steps`
- `current_step`
- `cancel_requested`
- `memory_document_id`
- `memory_chunks`

Cancellation v1 marks the stored run cancelled and sets `cancel_requested`; the crawler checks
that flag between page fetches and major pipeline stages.

The Research Desk exposes "Index into semantic memory" under advanced knobs. When enabled,
semantic memory search can later retrieve the report and source excerpts through the existing
`/api/ai/memory/query` endpoint and assistant memory search tool.

## Research Desk UI

The hub route `/research` is the current Deep Research Report artifact viewer. A run can be
reopened from the Reports rail and inspected without rerunning the crawl. The report view now
shows:

- final TLDR and detailed summary
- key facts, contradictions, open questions, and next research suggestions
- citation cards with links back to archived source URLs
- reliability notes, dated source timeline, and source table
- query plan search queries and crawl targets
- run logs with raw JSON detail for troubleshooting
- raw extracted source cards with canonical URL, author/date/fetch metadata, text preview,
  links, tables, optional screenshot thumbnails, and metadata
- Markdown, JSON, and HTML export links

The same route also includes a Source Library panel backed by the local `research_pages`
archive. It can search archived source cards by text, filter by domain, show preview text and
first/last seen metadata, open the original URL, or add an archived source URL back into the
Seed URLs box for a follow-up run.

The route also includes a Topic Watch / Monitors panel. It saves the current workbench goal
and knobs as a durable monitor, lists saved monitors, enables/disables them, reloads a monitor
into the form, deletes a monitor without deleting archived reports, runs a monitor on demand,
and runs any due daily/weekly monitors. A monitor run is just a normal report artifact, so
exports, citations, source cache, Action Ledger visibility, and semantic-memory opt-in all
continue to work.

Advanced run knobs currently sent by the UI include depth, max pages, per-domain limit, time
budget, date range, include/exclude domains, local AI synthesis, cloud fallback, explicit
provider/model, screenshot preference, and opt-in semantic memory indexing.

Modes:

- `quick_search`
- `deep_research`
- `url_scrape`
- `site_crawl`
- `compare_sources`
- `monitor_topic`

## Safety Boundaries

The engine uses the existing AI OS web-access controls:

- no paywall bypassing
- no captcha bypassing
- no credentialed or stealth scraping
- localhost/private-network blocking unless explicitly enabled
- request byte limits, text limits, redirect limits, timeouts, and configured user agent
- robots.txt awareness before page fetches

When official APIs, RSS feeds, sitemaps, or exported files are available, future providers
should prefer those over scraping.

## Current Limits

- Runs now have persisted progress and cancel state, but they still execute in-process as
  FastAPI background tasks. A dedicated queue/worker can come later if research workloads
  need process isolation, concurrency caps across restarts, pause/resume, or scheduling.
- Monitor Topic now has durable saved monitors, on-demand runs, a due-monitor sweep endpoint,
  and an off-by-default AI OS background unit. There is not yet an always-on wall-clock
  scheduler that wakes the sweep without you or the local supervisor invoking it.
- Screenshot capture uses `browser.extract` when requested and stores the resulting image
  payload in source metadata. If no browser is available, AI OS falls back to HTTP extraction
  and records the browser error in metadata/logs.
- Citation mapping is deterministic and source-backed, but not a full claim graph yet.
- Semantic memory indexing is opt-in per run. It currently indexes a single research-run
  document containing the report and source excerpts; archived source cards are searchable in
  the Research Desk Source Library, but source-card promotion into separate semantic-memory
  documents can be added as a follow-up.

## Adding A Search Provider

Implement the `SearchProvider` protocol in `apps/ai-os-api/ai_os/research.py`:

```python
class MyProvider:
    id = "my-provider"

    async def search(self, query: str, limit: int) -> list[dict[str, str]]:
        return [{"title": "...", "url": "https://...", "snippet": "..."}]
```

Then instantiate `ResearchEngine(..., search_provider=MyProvider(...))`, or add a small
provider registry once multiple real adapters exist.
