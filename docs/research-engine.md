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
   tables, headings, and metadata.
5. `dedupe_and_rank_sources()` picks canonical source cards and scores them against the goal.
6. `build_extractive_report()` creates a source-backed report without requiring a model.
   Optional `use_ai` adds a local/cloud AI synthesis layer through the unified inference
   router, while keeping source citations mapped separately.
7. `map_citations()` links key claims to source IDs and quotes where possible.
8. `AppStorage` persists `research_pages` and `research_runs`, so reports can be reopened and
   exported later. Research runs are created as durable queued records before work starts and
   update with progress, current step, partial sources, cancellation state, and final report
   data.
9. When `save_to_memory` is enabled, the completed report plus source excerpts are ingested
   into AI OS semantic memory as a `research_run` document. The run stores
   `memory_document_id` and `memory_chunks` so the Research Desk and Action Ledger can show
   whether it became searchable local knowledge.
10. `build_ai_action_ledger()` emits research runs as `research.<mode>` AI OS actions with
   source count, cached page count, runtime, progress, provider/model, tokens, and cost
   memory index metadata.

## API

- `POST /api/ai/research/runs`
- `GET /api/ai/research/runs?limit=25`
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
- Monitor Topic is a run mode now, not yet a recurring background monitor.
- Screenshots are represented in the request model but not yet captured into research source
  cards.
- Citation mapping is deterministic and source-backed, but not a full claim graph yet.
- Semantic memory indexing is opt-in per run. It currently indexes a single research-run
  document containing the report and source excerpts; individual reusable source-card
  promotion can be added as a follow-up.

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
