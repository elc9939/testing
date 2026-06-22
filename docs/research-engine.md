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
   exported later.
9. `build_ai_action_ledger()` emits research runs as `research.<mode>` AI OS actions with
   source count, cached page count, runtime, provider/model, tokens, and cost metadata.

## API

- `POST /api/ai/research/runs`
- `GET /api/ai/research/runs?limit=25`
- `GET /api/ai/research/runs/:id`
- `GET /api/ai/research/runs/:id/export?format=markdown|json|html`
- `POST /api/ai/research/runs/:id/cancel`

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

- Runs are currently synchronous from the UI perspective. They are archived and cancelable
  only before/while a stored non-terminal run exists; full pause/resume belongs in the next
  queue-backed pass.
- Monitor Topic is a run mode now, not yet a recurring background monitor.
- Screenshots are represented in the request model but not yet captured into research source
  cards.
- Citation mapping is deterministic and source-backed, but not a full claim graph yet.
- The local archive is SQLite text/source-card storage; vector indexing into semantic memory
  should be added when a research source is explicitly promoted or when a run opts in.

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
