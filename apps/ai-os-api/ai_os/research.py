from __future__ import annotations

import asyncio
import hashlib
import html
import re
import time
import urllib.robotparser
import xml.etree.ElementTree as ET
from collections import deque
from dataclasses import dataclass
from typing import Any, Protocol
from urllib.parse import parse_qsl, urlencode, urljoin, urlparse, urlunparse

from bs4 import BeautifulSoup

from .config import Settings
from .inference import InferenceRouter
from .memory.store import SemanticMemory
from .models import (
    InferenceRequest,
    MemoryIngestRequest,
    ResearchCitation,
    ResearchReport,
    ResearchRunRecord,
    ResearchRunRequest,
    ResearchSourceRecord,
    new_id,
    now_iso,
)
from .storage import AppStorage
from .web_access import WebAccess


tracking_query_prefixes = ("utm_",)
tracking_query_keys = {"fbclid", "gclid", "mc_cid", "mc_eid", "igshid", "ref"}
structured_discovery_modes = {"deep_research", "site_crawl", "monitor_topic"}
structured_discovery_limit = 24


class SearchProvider(Protocol):
    id: str

    async def search(self, query: str, limit: int) -> list[dict[str, str]]:
        ...


class WebAccessSearchProvider:
    id = "duckduckgo-html"

    def __init__(self, web: WebAccess):
        self.web = web

    async def search(self, query: str, limit: int) -> list[dict[str, str]]:
        result = await self.web.search(query, limit=limit)
        return [
            {
                "title": str(item.get("title") or ""),
                "url": str(item.get("url") or ""),
                "snippet": str(item.get("snippet") or ""),
            }
            for item in result.get("results", [])
            if isinstance(item, dict) and item.get("url")
        ]


@dataclass
class ResearchPlan:
    mode: str
    goal: str
    search_queries: list[str]
    crawl_targets: list[str]
    knobs: dict[str, Any]

    def as_dict(self) -> dict[str, Any]:
        return {
            "mode": self.mode,
            "goal": self.goal,
            "search_queries": self.search_queries,
            "crawl_targets": self.crawl_targets,
            "knobs": self.knobs,
        }

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> "ResearchPlan":
        return cls(
            mode=str(value.get("mode") or "quick_search"),
            goal=str(value.get("goal") or ""),
            search_queries=[str(item) for item in value.get("search_queries", []) if item],
            crawl_targets=[str(item) for item in value.get("crawl_targets", []) if item],
            knobs=value.get("knobs") if isinstance(value.get("knobs"), dict) else {},
        )


def normalize_url(value: str, *, base_url: str | None = None) -> str:
    raw = urljoin(base_url or "", value.strip())
    parsed = urlparse(raw)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return ""
    scheme = parsed.scheme.lower()
    netloc = parsed.netloc.lower()
    if (scheme == "http" and netloc.endswith(":80")) or (scheme == "https" and netloc.endswith(":443")):
        netloc = netloc.rsplit(":", 1)[0]
    path = parsed.path or "/"
    query_parts = [
        (key, value)
        for key, value in parse_qsl(parsed.query, keep_blank_values=True)
        if key not in tracking_query_keys and not key.startswith(tracking_query_prefixes)
    ]
    query = urlencode(sorted(query_parts), doseq=True)
    return urlunparse((scheme, netloc, path.rstrip("/") or "/", "", query, ""))


def extract_urls_from_text(text: str) -> list[str]:
    matches = re.findall(r"https?://[^\s<>)\]}\"']+", text)
    return [normalized for normalized in (normalize_url(match.rstrip(".,;:")) for match in matches) if normalized]


def _text_list(value: Any, limit: int = 8) -> list[str]:
    raw = value if isinstance(value, list) else re.split(r"[\n,;]+", value) if isinstance(value, str) else []
    compacted: list[str] = []
    seen: set[str] = set()
    for item in raw:
        text = _clean_text(str(item))
        key = text.lower()
        if not text or key in seen:
            continue
        compacted.append(text)
        seen.add(key)
        if len(compacted) >= limit:
            break
    return compacted


def _clip_search_query(value: str, limit: int = 180) -> str:
    compacted = _clean_text(value).strip(" .")
    if len(compacted) <= limit:
        return compacted
    clipped = compacted[:limit].rsplit(" ", 1)[0].strip(" .")
    return clipped or compacted[:limit].strip(" .")


def _append_query(queries: list[str], value: str, *, limit: int = 180) -> None:
    query = _clip_search_query(value, limit=limit)
    if query and query.lower() not in {item.lower() for item in queries}:
        queries.append(query)


def _career_discovery_search_queries(request: ResearchRunRequest, clean_goal: str) -> list[str]:
    metadata = request.metadata if isinstance(request.metadata, dict) else {}
    if metadata.get("career_discovery") is not True:
        return []

    roles = _text_list(metadata.get("target_roles"), 6)
    role = _clean_text(str(metadata.get("role") or (roles[0] if roles else "Data Analyst")))
    locations = _text_list(metadata.get("locations"), 4)
    location = locations[0] if locations else ""
    target_window = _clean_text(str(metadata.get("target_start_window") or "May 2027 / Summer 2027 start"))
    source_lane = _clean_text(str(metadata.get("source_lane") or ""))
    priority_company = _clean_text(str(metadata.get("priority_company") or ""))
    queries: list[str] = []

    if priority_company:
        _append_query(queries, f"{priority_company} careers {role} Summer 2027")
        _append_query(queries, f"{priority_company} {role} new grad 2027 application")
        _append_query(queries, f"{priority_company} {role} internship 2027")
    elif source_lane == "company-career-pages":
        for domain in ["greenhouse.io", "lever.co", "ashbyhq.com", "myworkdayjobs.com", "smartrecruiters.com"]:
            _append_query(queries, f"site:{domain} {role} 2027")
    elif source_lane == "application-deadlines-cycles":
        _append_query(queries, f"{target_window} {role} application deadline")
        _append_query(queries, f"Summer 2027 {role} recruiting cycle")
        _append_query(queries, f"2027 {role} analyst program deadline")
    elif source_lane == "student-program-directories":
        _append_query(queries, f"Summer 2027 {role} student program")
        _append_query(queries, f"Class of 2027 {role} internship")
        _append_query(queries, f"university recruiting {role} 2027")
    elif source_lane == "early-career-job-boards":
        _append_query(queries, f"{role} new grad 2027 jobs")
        _append_query(queries, f"{role} early career 2027")
        _append_query(queries, f"{role} Summer 2027 internship")
    elif source_lane == "quant-finance":
        _append_query(queries, "Summer 2027 quant research intern application")
        _append_query(queries, "2027 quant trading intern careers")
        _append_query(queries, "new grad quant 2027 analyst")
    elif source_lane == "finance-summer-analyst":
        _append_query(queries, "Summer 2027 analyst finance application")
        _append_query(queries, "2027 summer analyst investment research")
        _append_query(queries, "2027 analyst program finance careers")
    elif source_lane == "ai-research-labs":
        _append_query(queries, "2027 machine learning intern applied AI lab")
        _append_query(queries, "new grad AI research 2027 careers")
        _append_query(queries, "Summer 2027 ML intern research")
    else:
        _append_query(queries, f"{role} Summer 2027 internship application")
        _append_query(queries, f"{role} new grad 2027 careers")
        _append_query(queries, f"{role} early career analyst program 2027")

    for extra_role in roles[1:4]:
        _append_query(queries, f"{extra_role} Summer 2027 application")
    if location:
        _append_query(queries, f"{role} Summer 2027 {location}")
    if not queries:
        _append_query(queries, clean_goal)
    return queries[:8]


def domain_of(url: str) -> str:
    return (urlparse(url).hostname or "").lower()


def domain_allowed(url: str, *, include_domains: list[str], exclude_domains: list[str]) -> bool:
    host = domain_of(url)
    normalized_include = [item.lower().strip() for item in include_domains if item.strip()]
    normalized_exclude = [item.lower().strip() for item in exclude_domains if item.strip()]
    if normalized_include and not any(host == domain or host.endswith(f".{domain}") for domain in normalized_include):
        return False
    return not any(host == domain or host.endswith(f".{domain}") for domain in normalized_exclude)


def origin_of(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return ""
    return f"{parsed.scheme}://{parsed.netloc}"


def structured_discovery_candidates(url: str) -> list[str]:
    origin = origin_of(url)
    if not origin:
        return []
    candidates = [
        f"{origin}/sitemap.xml",
        f"{origin}/sitemap_index.xml",
        f"{origin}/feed.xml",
        f"{origin}/rss.xml",
        f"{origin}/atom.xml",
        f"{origin}/feed",
    ]
    lowered = url.lower()
    if any(marker in lowered for marker in ("sitemap", "rss", "atom", "feed.xml", "/feed")):
        candidates.insert(0, url)
    return list(dict.fromkeys(normalize_url(candidate) for candidate in candidates if normalize_url(candidate)))


def looks_like_structured_document_url(url: str) -> bool:
    path = urlparse(url).path.lower()
    name = path.rstrip("/").rsplit("/", 1)[-1]
    return path.endswith(".xml") or name in {"sitemap", "sitemap_index", "feed", "rss", "atom"}


def extract_structured_urls(text: str, *, base_url: str, limit: int = structured_discovery_limit) -> list[dict[str, str]]:
    stripped = text.strip()
    if not stripped:
        return []
    discovered: list[dict[str, str]] = []
    parsed_xml = False
    if "<" in stripped[:200]:
        try:
            root = ET.fromstring(stripped.encode("utf-8"))
            discovered.extend(_urls_from_xml_tree(root, base_url=base_url, limit=limit))
            parsed_xml = True
        except ET.ParseError:
            discovered.extend(_urls_from_html_feed_links(stripped, base_url=base_url, limit=limit))
    if not parsed_xml:
        discovered.extend(_urls_from_plain_text_feed(stripped, base_url=base_url, limit=limit))
    deduped: list[dict[str, str]] = []
    seen: set[str] = set()
    for item in discovered:
        url = normalize_url(item.get("url", ""), base_url=base_url)
        if not url or url in seen:
            continue
        seen.add(url)
        deduped.append({"url": url, "kind": item.get("kind", "structured")})
        if len(deduped) >= limit:
            break
    return deduped


def _local_xml_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1].lower()


def _urls_from_xml_tree(root: ET.Element, *, base_url: str, limit: int) -> list[dict[str, str]]:
    discovered: list[dict[str, str]] = []

    def visit(element: ET.Element, parents: list[str]) -> None:
        if len(discovered) >= limit:
            return
        name = _local_xml_name(element.tag)
        parent = parents[-1] if parents else ""
        if name == "loc" and element.text:
            discovered.append({"url": element.text.strip(), "kind": "sitemap_index" if parent == "sitemap" else "sitemap_url"})
        elif name == "link":
            href = str(element.attrib.get("href") or "").strip()
            text_href = (element.text or "").strip()
            candidate = href or text_href
            if candidate and (parent in {"entry", "item"} or "entry" in parents or "item" in parents):
                discovered.append({"url": candidate, "kind": "feed"})
        for child in list(element):
            visit(child, [*parents, name])

    visit(root, [])
    return [
        {"url": normalize_url(item["url"], base_url=base_url), "kind": item["kind"]}
        for item in discovered
        if normalize_url(item["url"], base_url=base_url)
    ][:limit]


def _urls_from_html_feed_links(text: str, *, base_url: str, limit: int) -> list[dict[str, str]]:
    soup = BeautifulSoup(text, "html.parser")
    discovered: list[dict[str, str]] = []
    for tag in soup.find_all("link", href=True):
        rel = " ".join(str(item).lower() for item in tag.get("rel", []))
        media_type = str(tag.get("type") or "").lower()
        href = str(tag.get("href") or "")
        if any(marker in media_type for marker in ("rss", "atom", "xml")) or any(marker in rel for marker in ("alternate", "sitemap")):
            kind = "sitemap" if "sitemap" in rel or "sitemap" in href.lower() else "feed"
            discovered.append({"url": href, "kind": kind})
    for anchor in soup.find_all("a", href=True):
        href = str(anchor.get("href") or "")
        label = f"{href} {anchor.get_text(' ', strip=True)}".lower()
        if any(marker in label for marker in ("sitemap", "rss", "atom", "feed")):
            kind = "sitemap" if "sitemap" in label else "feed"
            discovered.append({"url": href, "kind": kind})
        if len(discovered) >= limit:
            break
    return [
        {"url": normalize_url(item["url"], base_url=base_url), "kind": item["kind"]}
        for item in discovered
        if normalize_url(item["url"], base_url=base_url)
    ][:limit]


def _urls_from_plain_text_feed(text: str, *, base_url: str, limit: int) -> list[dict[str, str]]:
    discovered: list[dict[str, str]] = []
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.lower().startswith("sitemap:"):
            discovered.append({"url": stripped.split(":", 1)[1].strip(), "kind": "sitemap"})
    for url in extract_urls_from_text(text):
        lowered = url.lower()
        if any(marker in lowered for marker in ("sitemap", "rss", "atom", "/feed", "feed.xml")):
            discovered.append({"url": url, "kind": "sitemap" if "sitemap" in lowered else "feed"})
        if len(discovered) >= limit:
            break
    return [
        {"url": normalize_url(item["url"], base_url=base_url), "kind": item["kind"]}
        for item in discovered
        if normalize_url(item["url"], base_url=base_url)
    ][:limit]


def plan_research(request: ResearchRunRequest) -> ResearchPlan:
    seed_urls = [url for url in [normalize_url(item) for item in request.seed_urls] if url]
    inline_urls = extract_urls_from_text(request.goal)
    crawl_targets = list(dict.fromkeys([*seed_urls, *inline_urls]))
    clean_goal = _clean_text(re.sub(r"https?://[^\s<>)\]}\"']+", "", request.goal)).strip(" .\n\t") or request.goal.strip()

    search_queries: list[str] = []
    metadata_queries = _text_list((request.metadata if isinstance(request.metadata, dict) else {}).get("search_queries"), 8)
    career_queries = _career_discovery_search_queries(request, clean_goal)
    if metadata_queries:
        search_queries.extend(_clip_search_query(query) for query in metadata_queries)
    elif career_queries:
        search_queries.extend(career_queries)
    elif request.mode in {"quick_search", "deep_research", "compare_sources", "monitor_topic"}:
        search_queries.append(clean_goal)
    if not (metadata_queries or career_queries):
        if request.mode == "deep_research":
            search_queries.extend([f"{clean_goal} background", f"{clean_goal} analysis evidence"])
        elif request.mode == "compare_sources":
            search_queries.extend([f"{clean_goal} comparison", f"{clean_goal} criticism"])
        elif request.mode == "monitor_topic":
            search_queries.extend([f"{clean_goal} latest", f"{clean_goal} site:news OR update"])
    if request.mode in {"url_scrape", "site_crawl"} and not crawl_targets:
        crawl_targets.extend(inline_urls)

    return ResearchPlan(
        mode=request.mode,
        goal=clean_goal,
        search_queries=list(dict.fromkeys(query for query in search_queries if query)),
        crawl_targets=crawl_targets,
        knobs={
            "depth": request.depth,
            "max_pages": request.max_pages,
            "per_domain_limit": request.per_domain_limit,
            "time_budget_s": request.time_budget_s,
            "date_range_start": request.date_range_start,
            "date_range_end": request.date_range_end,
            "include_domains": request.include_domains,
            "exclude_domains": request.exclude_domains,
            "use_ai": request.use_ai,
            "use_cloud_ai": request.use_cloud_ai,
            "local_first": request.local_first,
            "provider": request.provider,
            "model": request.model,
            "screenshot": request.screenshot,
            "save_to_memory": request.save_to_memory,
        },
    )


def extract_clean_content(
    html_or_text: str,
    *,
    base_url: str,
    content_type: str = "text/html",
    max_text_chars: int = 60_000,
    max_links: int = 80,
) -> dict[str, Any]:
    if "html" not in content_type.lower():
        text = _normalize_text(html_or_text)
        return {
            "title": "",
            "author": None,
            "published_at": None,
            "description": "",
            "canonical_url": normalize_url(base_url),
            "text": text[:max_text_chars],
            "text_length": len(text),
            "links": [],
            "tables": [],
            "metadata": {},
        }
    soup = BeautifulSoup(html_or_text, "html.parser")
    for tag in soup(["script", "style", "noscript", "svg", "canvas", "template", "nav", "footer", "aside"]):
        tag.decompose()
    title = _clean_text(soup.title.get_text(" ", strip=True) if soup.title else "")
    canonical = ""
    canonical_tag = soup.find("link", attrs={"rel": lambda value: value and "canonical" in value})
    if canonical_tag and canonical_tag.get("href"):
        canonical = normalize_url(str(canonical_tag["href"]), base_url=base_url)
    metadata = _extract_metadata(soup)
    headings = [_clean_text(tag.get_text(" ", strip=True)) for tag in soup.find_all(["h1", "h2", "h3"])[:20]]
    text = _normalize_text(soup.get_text("\n", strip=True))
    links = []
    for anchor in soup.find_all("a", href=True):
        url = normalize_url(str(anchor["href"]), base_url=base_url)
        if not url:
            continue
        links.append({"url": url, "text": _clean_text(anchor.get_text(" ", strip=True))[:180]})
        if len(links) >= max_links:
            break
    tables = _extract_tables(soup)
    return {
        "title": title or metadata.get("og:title", ""),
        "author": metadata.get("author") or metadata.get("article:author"),
        "published_at": metadata.get("article:published_time") or metadata.get("date") or metadata.get("datePublished"),
        "description": metadata.get("description") or metadata.get("og:description") or "",
        "canonical_url": canonical or normalize_url(base_url),
        "text": text[:max_text_chars],
        "text_length": len(text),
        "links": _dedupe_links(links),
        "tables": tables,
        "metadata": {**metadata, "headings": [heading for heading in headings if heading]},
    }


def dedupe_and_rank_sources(sources: list[ResearchSourceRecord], goal: str, limit: int) -> list[ResearchSourceRecord]:
    terms = [term.lower() for term in re.findall(r"[a-zA-Z0-9]{4,}", goal)[:20]]
    by_key: dict[str, ResearchSourceRecord] = {}
    for source in sources:
        key = source.canonical_url or normalize_url(source.url)
        existing = by_key.get(key)
        if existing and existing.text_length >= source.text_length:
            continue
        by_key[key] = source
    ranked: list[ResearchSourceRecord] = []
    for source in by_key.values():
        haystack = f"{source.title}\n{source.description}\n{source.text[:5000]}".lower()
        term_hits = sum(1 for term in terms if term in haystack)
        score = term_hits * 4 + min(source.text_length / 1200, 10)
        if source.author:
            score += 0.5
        if source.published_at:
            score += 0.5
        ranked.append(source.model_copy(update={"score": round(score, 3)}))
    ranked.sort(key=lambda item: (item.score, item.text_length, item.title), reverse=True)
    return [source.model_copy(update={"id": f"S{index + 1}", "rank": index + 1}) for index, source in enumerate(ranked[:limit])]


def map_citations(report: ResearchReport, sources: list[ResearchSourceRecord]) -> list[ResearchCitation]:
    citations: list[ResearchCitation] = []
    for index, claim in enumerate(report.key_facts, start=1):
        source = _best_source_for_claim(claim, sources) or (sources[0] if sources else None)
        citations.append(
            ResearchCitation(
                id=f"C{index}",
                claim=claim,
                source_ids=[source.id] if source else [],
                quote=_quote_for_claim(claim, source.text if source else "") if source else None,
            )
        )
    return citations


class RobotsCache:
    def __init__(self, web: WebAccess):
        self.web = web
        self._parsers: dict[str, urllib.robotparser.RobotFileParser | None] = {}

    async def allowed(self, url: str) -> tuple[bool, str]:
        parsed = urlparse(url)
        origin = f"{parsed.scheme}://{parsed.netloc}"
        if origin not in self._parsers:
            robots = urllib.robotparser.RobotFileParser()
            robots.set_url(f"{origin}/robots.txt")
            try:
                page = await self.web._fetch_bytes(f"{origin}/robots.txt")
                text = page["body"].decode(page["encoding"], errors="replace")
                robots.parse(text.splitlines())
                self._parsers[origin] = robots
            except Exception as error:
                self._parsers[origin] = None
                return True, f"robots.txt unavailable: {error}"
        parser = self._parsers[origin]
        if parser is None:
            return True, "robots.txt unavailable"
        allowed = parser.can_fetch(self.web.settings.web_user_agent, url)
        return allowed, "robots.txt allows fetch" if allowed else "robots.txt disallows fetch"


class ResearchCancelled(RuntimeError):
    pass


class ResearchPaused(RuntimeError):
    pass


class ResearchEngine:
    def __init__(
        self,
        *,
        settings: Settings,
        storage: AppStorage,
        web: WebAccess,
        router: InferenceRouter,
        memory: SemanticMemory | None = None,
        search_provider: SearchProvider | None = None,
    ):
        self.settings = settings
        self.storage = storage
        self.web = web
        self.router = router
        self.memory = memory
        self.search_provider = search_provider or WebAccessSearchProvider(web)
        self.robots = RobotsCache(web)

    def create_run(self, request: ResearchRunRequest) -> ResearchRunRecord:
        run_id = new_id("research")
        plan = plan_research(request)
        now = now_iso()
        total_steps = self._estimated_steps(request)
        record = ResearchRunRecord(
            id=run_id,
            created_at=now,
            updated_at=now,
            mode=request.mode,
            goal=request.goal,
            status="queued",
            query_plan=plan.as_dict(),
            report=ResearchReport(
                title=f"{_mode_label(request.mode)}: {plan.goal}",
                tldr="Research run is queued.",
                detailed_summary="The run has been accepted and will update as sources are searched, fetched, ranked, and summarized.",
            ),
            logs=[{"at": now, "level": "info", "message": "Research run queued.", "plan": plan.as_dict()}],
            progress=0.0,
            total_steps=total_steps,
            completed_steps=0,
            current_step="Queued",
            options=request.model_dump(mode="json"),
        )
        return self.storage.log_research_run(record)

    async def run(self, request: ResearchRunRequest) -> ResearchRunRecord:
        record = self.create_run(request)
        return await self.run_existing(record.id, request)

    async def run_existing(self, run_id: str, request: ResearchRunRequest) -> ResearchRunRecord:
        started = time.perf_counter()
        existing = self.storage.get_research_run(run_id)
        if existing and existing.status == "cancelled":
            return existing
        if existing and existing.status == "paused":
            return existing
        created_at = existing.created_at if existing else now_iso()
        logs: list[dict[str, Any]] = list(existing.logs if existing else [])
        plan = ResearchPlan.from_dict(existing.query_plan) if existing and existing.query_plan else plan_research(request)
        options = request.model_dump(mode="json")
        provider = request.provider
        model = request.model
        total_tokens = 0
        cost_usd = 0.0
        try:
            self._raise_if_stopped(run_id)
            logs.append({"at": now_iso(), "level": "info", "message": "Research run started.", "plan": plan.as_dict()})
            self._persist_progress(
                run_id,
                request,
                created_at,
                plan,
                logs,
                status="running",
                current_step="Planning searches",
                progress=0.04,
                completed_steps=1,
                started=started,
            )
            search_results = await self._search(plan, request, logs)
            self._raise_if_stopped(run_id)
            self._persist_progress(
                run_id,
                request,
                created_at,
                plan,
                logs,
                status="running",
                current_step=f"Search complete: {len(search_results)} candidate URL(s)",
                progress=0.16,
                completed_steps=2,
                started=started,
            )
            sources = await self._crawl(plan, request, search_results, logs, started, run_id=run_id, created_at=created_at)
            self._raise_if_stopped(run_id)
            self._persist_progress(
                run_id,
                request,
                created_at,
                plan,
                logs,
                status="running",
                sources=sources,
                current_step=f"Ranking {len(sources)} source(s)",
                progress=0.82,
                completed_steps=max(3, min(self._estimated_steps(request) - 2, len(sources) + 3)),
                started=started,
            )
            ranked_sources = dedupe_and_rank_sources(sources, plan.goal, request.max_pages)
            report = build_extractive_report(plan.goal, request.mode, ranked_sources)
            citations = map_citations(report, ranked_sources)
            if request.use_ai and ranked_sources:
                try:
                    self._persist_progress(
                        run_id,
                        request,
                        created_at,
                        plan,
                        logs,
                        status="running",
                        sources=ranked_sources,
                        report=report,
                        citations=citations,
                        current_step="Synthesizing with AI",
                        progress=0.9,
                        completed_steps=max(1, self._estimated_steps(request) - 1),
                        started=started,
                    )
                    ai_report = await self._ai_summarize(request, plan, ranked_sources, report, run_id)
                    report = ai_report["report"]
                    provider = ai_report.get("provider") or provider
                    model = ai_report.get("model") or model
                    total_tokens += int(ai_report.get("total_tokens") or 0)
                    cost_usd += float(ai_report.get("cost_usd") or 0)
                    citations = map_citations(report, ranked_sources)
                    logs.append({"at": now_iso(), "level": "info", "message": "AI summary layer completed."})
                except Exception as error:
                    logs.append({"at": now_iso(), "level": "warning", "message": "AI summary failed; kept extractive report.", "error": str(error)})
            cached_pages = sum(1 for source in ranked_sources if source.cached)
            record = ResearchRunRecord(
                id=run_id,
                created_at=created_at,
                updated_at=now_iso(),
                mode=request.mode,
                goal=request.goal,
                status="succeeded",
                query_plan=plan.as_dict(),
                sources=ranked_sources,
                report=report,
                citations=citations,
                logs=logs,
                progress=1.0,
                total_steps=self._estimated_steps(request),
                completed_steps=self._estimated_steps(request),
                current_step="Complete",
                provider=provider,
                model=model,
                total_tokens=total_tokens,
                cost_usd=cost_usd,
                runtime_ms=round((time.perf_counter() - started) * 1000, 2),
                cached_pages=cached_pages,
                options=options,
            )
            record = self.storage.log_research_run(record)
            return await self._save_to_memory_if_requested(record, request)
        except ResearchCancelled:
            existing = self.storage.get_research_run(run_id)
            if existing and existing.status == "cancelled":
                return self.storage.log_research_run(
                    existing.model_copy(
                        update={
                            "runtime_ms": round((time.perf_counter() - started) * 1000, 2),
                            "updated_at": now_iso(),
                        }
                    )
                )
            record = ResearchRunRecord(
                id=run_id,
                created_at=created_at,
                updated_at=now_iso(),
                mode=request.mode,
                goal=request.goal,
                status="cancelled",
                query_plan=plan.as_dict(),
                sources=existing.sources if existing else [],
                report=(existing.report if existing else ResearchReport(title=f"{_mode_label(request.mode)}: {plan.goal}", tldr="Research run was cancelled.")),
                citations=existing.citations if existing else [],
                logs=[*logs, {"at": now_iso(), "level": "warning", "message": "Research run cancelled."}],
                progress=existing.progress if existing else 0.0,
                total_steps=self._estimated_steps(request),
                completed_steps=existing.completed_steps if existing else 0,
                current_step="Cancelled",
                cancel_requested=True,
                provider=provider,
                model=model,
                runtime_ms=round((time.perf_counter() - started) * 1000, 2),
                options=options,
            )
            return self.storage.log_research_run(record)
        except ResearchPaused:
            existing = self.storage.get_research_run(run_id)
            if existing and existing.status == "paused":
                return self.storage.log_research_run(
                    existing.model_copy(
                        update={
                            "runtime_ms": round((time.perf_counter() - started) * 1000, 2),
                            "updated_at": now_iso(),
                        }
                    )
                )
            record = ResearchRunRecord(
                id=run_id,
                created_at=created_at,
                updated_at=now_iso(),
                mode=request.mode,
                goal=request.goal,
                status="paused",
                query_plan=plan.as_dict(),
                sources=existing.sources if existing else [],
                report=(existing.report if existing else ResearchReport(title=f"{_mode_label(request.mode)}: {plan.goal}", tldr="Research run was paused.")),
                citations=existing.citations if existing else [],
                logs=[*logs, {"at": now_iso(), "level": "info", "message": "Research run paused."}],
                progress=existing.progress if existing else 0.0,
                total_steps=self._estimated_steps(request),
                completed_steps=existing.completed_steps if existing else 0,
                current_step="Paused",
                provider=provider,
                model=model,
                runtime_ms=round((time.perf_counter() - started) * 1000, 2),
                options=options,
            )
            return self.storage.log_research_run(record)
        except Exception as error:
            record = ResearchRunRecord(
                id=run_id,
                created_at=created_at,
                updated_at=now_iso(),
                mode=request.mode,
                goal=request.goal,
                status="failed",
                query_plan=plan.as_dict(),
                report=ResearchReport(title=f"Research failed: {plan.goal}", tldr=str(error)),
                citations=[],
                logs=[*logs, {"at": now_iso(), "level": "error", "message": "Research run failed.", "error": str(error)}],
                progress=0.0,
                total_steps=self._estimated_steps(request),
                completed_steps=0,
                current_step="Failed",
                provider=provider,
                model=model,
                runtime_ms=round((time.perf_counter() - started) * 1000, 2),
                error=str(error),
                options=options,
            )
            self.storage.log_research_run(record)
            raise

    def _estimated_steps(self, request: ResearchRunRequest) -> int:
        return max(4, 3 + request.max_pages + (1 if request.use_ai else 0))

    def _raise_if_cancelled(self, run_id: str) -> None:
        if self.storage.research_run_cancel_requested(run_id):
            raise ResearchCancelled("Research run cancelled.")

    def _raise_if_paused(self, run_id: str) -> None:
        if self.storage.research_run_pause_requested(run_id):
            raise ResearchPaused("Research run paused.")

    def _raise_if_stopped(self, run_id: str) -> None:
        self._raise_if_cancelled(run_id)
        self._raise_if_paused(run_id)

    def _persist_progress(
        self,
        run_id: str,
        request: ResearchRunRequest,
        created_at: str,
        plan: ResearchPlan,
        logs: list[dict[str, Any]],
        *,
        status: str,
        current_step: str,
        progress: float,
        completed_steps: int,
        started: float,
        sources: list[ResearchSourceRecord] | None = None,
        report: ResearchReport | None = None,
        citations: list[ResearchCitation] | None = None,
    ) -> ResearchRunRecord:
        existing = self.storage.get_research_run(run_id)
        if existing and existing.status == "cancelled":
            raise ResearchCancelled("Research run cancelled.")
        if existing and existing.status == "paused":
            raise ResearchPaused("Research run paused.")
        record = ResearchRunRecord(
            id=run_id,
            created_at=created_at,
            updated_at=now_iso(),
            mode=request.mode,
            goal=request.goal,
            status=status,  # type: ignore[arg-type]
            query_plan=plan.as_dict(),
            sources=sources if sources is not None else (existing.sources if existing else []),
            report=report or (existing.report if existing else ResearchReport(title=f"{_mode_label(request.mode)}: {plan.goal}")),
            citations=citations if citations is not None else (existing.citations if existing else []),
            logs=logs,
            progress=max(0.0, min(1.0, progress)),
            total_steps=self._estimated_steps(request),
            completed_steps=max(0, min(self._estimated_steps(request), completed_steps)),
            current_step=current_step,
            cancel_requested=bool(existing.cancel_requested if existing else False),
            provider=request.provider,
            model=request.model,
            runtime_ms=round((time.perf_counter() - started) * 1000, 2),
            cached_pages=sum(1 for source in (sources if sources is not None else (existing.sources if existing else [])) if source.cached),
            options=request.model_dump(mode="json"),
        )
        return self.storage.log_research_run(record)

    async def _save_to_memory_if_requested(
        self,
        record: ResearchRunRecord,
        request: ResearchRunRequest,
    ) -> ResearchRunRecord:
        if not request.save_to_memory or not self.memory:
            return record
        logs = list(record.logs)
        try:
            text = self._memory_text(record)
            if len(text) > self.settings.max_memory_ingest_chars:
                text = text[: self.settings.max_memory_ingest_chars]
            result = await self.memory.ingest(
                MemoryIngestRequest(
                    source_type="research_run",
                    source_id=record.id,
                    title=record.report.title,
                    text=text,
                    metadata={
                        "kind": "research_run",
                        "research_run_id": record.id,
                        "mode": record.mode,
                        "goal": record.goal,
                        "source_count": len(record.sources),
                        "source_urls": [source.canonical_url for source in record.sources],
                        "citation_count": len(record.citations),
                    },
                    embedding_provider=request.provider,
                    embedding_model=request.model,
                )
            )
            logs.append(
                {
                    "at": now_iso(),
                    "level": "info",
                    "message": "Research run saved to semantic memory.",
                    "document_id": result.get("document_id"),
                    "chunks": result.get("chunks"),
                }
            )
            return self.storage.log_research_run(
                record.model_copy(
                    update={
                        "updated_at": now_iso(),
                        "logs": logs,
                        "memory_document_id": result.get("document_id"),
                        "memory_chunks": int(result.get("chunks") or 0),
                    }
                )
            )
        except Exception as error:
            logs.append(
                {
                    "at": now_iso(),
                    "level": "warning",
                    "message": "Research memory save failed.",
                    "error": str(error),
                }
            )
            return self.storage.log_research_run(record.model_copy(update={"updated_at": now_iso(), "logs": logs}))

    def _memory_text(self, record: ResearchRunRecord) -> str:
        sections = [
            f"Research run: {record.report.title}",
            f"Mode: {record.mode}",
            f"Goal: {record.goal}",
            "",
            "TLDR",
            record.report.tldr,
            "",
            "Detailed Summary",
            record.report.detailed_summary,
            "",
            "Key Facts",
            "\n".join(f"- {fact}" for fact in record.report.key_facts),
            "",
            "Disagreements",
            "\n".join(f"- {item}" for item in record.report.disagreements),
            "",
            "Open Questions",
            "\n".join(f"- {item}" for item in record.report.open_questions),
            "",
            "Next Research Suggestions",
            "\n".join(f"- {item}" for item in record.report.next_research_suggestions),
            "",
            "Citations",
            "\n".join(f"- {citation.id}: {citation.claim}" for citation in record.citations),
            "",
            "Sources",
        ]
        for source in record.sources:
            sections.extend(
                [
                    f"[{source.id}] {source.title or source.canonical_url}",
                    f"URL: {source.canonical_url}",
                    f"Author: {source.author or ''}",
                    f"Published: {source.published_at or ''}",
                    source.description,
                    source.text[:8000],
                    "",
                ]
            )
        return "\n".join(part for part in sections if part is not None).strip()

    async def _search(
        self,
        plan: ResearchPlan,
        request: ResearchRunRequest,
        logs: list[dict[str, Any]],
    ) -> list[dict[str, str]]:
        results: list[dict[str, str]] = []
        if request.mode in {"url_scrape", "site_crawl"} and plan.crawl_targets:
            return results
        per_query_limit = max(1, min(request.max_pages, self.settings.web_search_max_results))
        for query in plan.search_queries:
            try:
                found = await self.search_provider.search(query, per_query_limit)
                logs.append({"at": now_iso(), "level": "info", "message": "Search completed.", "query": query, "count": len(found)})
                results.extend(found)
            except Exception as error:
                logs.append({"at": now_iso(), "level": "warning", "message": "Search failed.", "query": query, "error": str(error)})
        return results

    async def _crawl(
        self,
        plan: ResearchPlan,
        request: ResearchRunRequest,
        search_results: list[dict[str, str]],
        logs: list[dict[str, Any]],
        started: float,
        *,
        run_id: str,
        created_at: str,
    ) -> list[ResearchSourceRecord]:
        targets = [
            normalize_url(result["url"])
            for result in search_results
            if result.get("url")
        ]
        structured_targets: list[str] = []
        if plan.crawl_targets and request.mode in structured_discovery_modes:
            structured_targets = await self._discover_structured_targets(
                plan.crawl_targets,
                request,
                logs,
                started,
                run_id=run_id,
            )
        targets = [url for url in [*plan.crawl_targets, *targets] if url]
        queue: deque[tuple[str, int]] = deque((url, 0) for url in dict.fromkeys([*structured_targets, *targets]))
        seen: set[str] = set()
        domain_counts: dict[str, int] = {}
        sources: list[ResearchSourceRecord] = []
        while queue and len(sources) < request.max_pages:
            self._raise_if_stopped(run_id)
            if time.perf_counter() - started > request.time_budget_s:
                logs.append({"at": now_iso(), "level": "warning", "message": "Time budget reached.", "source_count": len(sources)})
                break
            url, depth = queue.popleft()
            url = normalize_url(url)
            if not url or url in seen:
                continue
            seen.add(url)
            if not domain_allowed(url, include_domains=request.include_domains, exclude_domains=request.exclude_domains):
                logs.append({"at": now_iso(), "level": "info", "message": "Skipped URL by domain filter.", "url": url})
                continue
            domain = domain_of(url)
            if domain_counts.get(domain, 0) >= request.per_domain_limit:
                logs.append({"at": now_iso(), "level": "info", "message": "Skipped URL by per-domain limit.", "url": url})
                continue
            source = await self._fetch_source(url, request, logs)
            if not source:
                continue
            domain_counts[domain] = domain_counts.get(domain, 0) + 1
            sources.append(source)
            crawl_progress = 0.18 + (0.58 * min(len(sources), request.max_pages) / max(1, request.max_pages))
            self._persist_progress(
                run_id,
                request,
                created_at,
                plan,
                logs,
                status="running",
                sources=sources,
                current_step=f"Fetched {len(sources)} of up to {request.max_pages} source(s)",
                progress=crawl_progress,
                completed_steps=min(self._estimated_steps(request) - 2, 2 + len(sources)),
                started=started,
            )
            if request.mode == "site_crawl" and depth + 1 < request.depth:
                for link in source.links:
                    next_url = normalize_url(link.get("url", ""))
                    if next_url and domain_of(next_url) == domain and next_url not in seen:
                        queue.append((next_url, depth + 1))
            await asyncio.sleep(0.2)
        return sources

    async def _discover_structured_targets(
        self,
        seeds: list[str],
        request: ResearchRunRequest,
        logs: list[dict[str, Any]],
        started: float,
        *,
        run_id: str,
    ) -> list[str]:
        document_candidates: list[str] = []
        for seed in seeds[:5]:
            self._raise_if_stopped(run_id)
            if time.perf_counter() - started > request.time_budget_s:
                break
            seed = normalize_url(seed)
            if not seed or not domain_allowed(seed, include_domains=request.include_domains, exclude_domains=request.exclude_domains):
                continue
            origin = origin_of(seed)
            if not origin:
                continue
            robots_url = f"{origin}/robots.txt"
            robots_text = await self._fetch_discovery_text(robots_url, logs, purpose="robots sitemap discovery")
            if robots_text:
                document_candidates.extend(item["url"] for item in _urls_from_plain_text_feed(robots_text, base_url=robots_url, limit=8))
            document_candidates.extend(structured_discovery_candidates(seed))
            allowed, robots_note = await self.robots.allowed(seed)
            if allowed:
                seed_text = await self._fetch_discovery_text(seed, logs, purpose="HTML feed discovery")
                if seed_text:
                    document_candidates.extend(item["url"] for item in _urls_from_html_feed_links(seed_text, base_url=seed, limit=8))
            else:
                logs.append({"at": now_iso(), "level": "info", "message": "Skipped HTML feed discovery by robots.txt.", "url": seed, "robots": robots_note})

        discovered: list[str] = []
        seen_documents: set[str] = set()
        for document_url in dict.fromkeys(document_candidates):
            self._raise_if_stopped(run_id)
            if len(discovered) >= structured_discovery_limit or time.perf_counter() - started > request.time_budget_s:
                break
            document_url = normalize_url(document_url)
            if not document_url or document_url in seen_documents:
                continue
            seen_documents.add(document_url)
            if not domain_allowed(document_url, include_domains=request.include_domains, exclude_domains=request.exclude_domains):
                continue
            allowed, robots_note = await self.robots.allowed(document_url)
            if not allowed:
                logs.append({"at": now_iso(), "level": "info", "message": "Skipped structured discovery document by robots.txt.", "url": document_url, "robots": robots_note})
                continue
            text = await self._fetch_discovery_text(document_url, logs, purpose="structured discovery document")
            if not text:
                continue
            entries = extract_structured_urls(text, base_url=document_url, limit=structured_discovery_limit)
            logs.append(
                {
                    "at": now_iso(),
                    "level": "info",
                    "message": "Structured discovery document parsed.",
                    "url": document_url,
                    "count": len(entries),
                    "kinds": sorted({entry["kind"] for entry in entries}),
                }
            )
            for entry in entries:
                entry_url = entry["url"]
                if entry["kind"] == "sitemap_index" or looks_like_structured_document_url(entry_url):
                    discovered.extend(await self._expand_sitemap_index(entry_url, request, logs, run_id=run_id))
                elif domain_allowed(entry_url, include_domains=request.include_domains, exclude_domains=request.exclude_domains):
                    discovered.append(entry_url)
                if len(discovered) >= structured_discovery_limit:
                    break
        deduped = list(dict.fromkeys(url for url in discovered if normalize_url(url)))[:structured_discovery_limit]
        if deduped:
            logs.append({"at": now_iso(), "level": "info", "message": "Structured source discovery added crawl targets.", "count": len(deduped), "targets": deduped[:10]})
        return deduped

    async def _expand_sitemap_index(
        self,
        sitemap_url: str,
        request: ResearchRunRequest,
        logs: list[dict[str, Any]],
        *,
        run_id: str,
    ) -> list[str]:
        self._raise_if_stopped(run_id)
        if not domain_allowed(sitemap_url, include_domains=request.include_domains, exclude_domains=request.exclude_domains):
            return []
        allowed, robots_note = await self.robots.allowed(sitemap_url)
        if not allowed:
            logs.append({"at": now_iso(), "level": "info", "message": "Skipped sitemap index child by robots.txt.", "url": sitemap_url, "robots": robots_note})
            return []
        text = await self._fetch_discovery_text(sitemap_url, logs, purpose="sitemap index child")
        if not text:
            return []
        return [
            entry["url"]
            for entry in extract_structured_urls(text, base_url=sitemap_url, limit=structured_discovery_limit)
            if entry["kind"] != "sitemap_index" and domain_allowed(entry["url"], include_domains=request.include_domains, exclude_domains=request.exclude_domains)
        ]

    async def _fetch_discovery_text(self, url: str, logs: list[dict[str, Any]], *, purpose: str) -> str:
        try:
            page = await self.web._fetch_bytes(url)
            if int(page["status_code"]) >= 400:
                logs.append({"at": now_iso(), "level": "info", "message": "Structured discovery fetch returned non-OK status.", "url": url, "status_code": page["status_code"], "purpose": purpose})
                return ""
            return page["body"].decode(page["encoding"], errors="replace")
        except Exception as error:
            logs.append({"at": now_iso(), "level": "info", "message": "Structured discovery fetch failed.", "url": url, "purpose": purpose, "error": str(error)})
            return ""

    async def _fetch_source(self, url: str, request: ResearchRunRequest, logs: list[dict[str, Any]]) -> ResearchSourceRecord | None:
        cached = self.storage.get_research_page(url)
        if cached:
            has_screenshot = bool(cached.metadata.get("screenshot_base64"))
            if not request.screenshot or has_screenshot:
                logs.append({"at": now_iso(), "level": "info", "message": "Used cached page.", "url": url, "screenshot": has_screenshot})
                return cached.model_copy(update={"cached": True})
            logs.append({"at": now_iso(), "level": "info", "message": "Refreshing cached page to capture screenshot.", "url": url})
        allowed, robots_note = await self.robots.allowed(url)
        if not allowed:
            logs.append({"at": now_iso(), "level": "warning", "message": "Skipped by robots.txt.", "url": url, "robots": robots_note})
            return None
        for attempt in range(1, 3):
            try:
                if request.screenshot:
                    page = await self.web.browser_extract(
                        url,
                        wait_until="domcontentloaded",
                        screenshot=True,
                        max_text_chars=self.settings.web_max_text_chars,
                        max_links=self.settings.web_max_links,
                    )
                else:
                    page = await self.web.scrape(url, max_text_chars=self.settings.web_max_text_chars, max_links=self.settings.web_max_links)
                source = source_from_scrape_result(page, requested_url=url)
                text_hash = hashlib.sha256(source.text.encode("utf-8")).hexdigest()
                stored = self.storage.upsert_research_page(source, text_hash=text_hash)
                logs.append(
                    {
                        "at": now_iso(),
                        "level": "info",
                        "message": "Fetched page.",
                        "url": url,
                        "attempt": attempt,
                        "robots": robots_note,
                        "tool_id": page.get("tool_id"),
                        "mode": page.get("mode"),
                        "screenshot": bool(page.get("screenshot_base64")),
                        "browser_available": page.get("browser_available"),
                    }
                )
                return stored.model_copy(update={"cached": False})
            except Exception as error:
                logs.append({"at": now_iso(), "level": "warning", "message": "Fetch failed.", "url": url, "attempt": attempt, "error": str(error)})
                if attempt >= 2:
                    return None
                await asyncio.sleep(0.5)
        return None

    async def _ai_summarize(
        self,
        request: ResearchRunRequest,
        plan: ResearchPlan,
        sources: list[ResearchSourceRecord],
        fallback: ResearchReport,
        run_id: str,
    ) -> dict[str, Any]:
        context = "\n\n".join(
            f"[{source.id}] {source.title or source.url}\nURL: {source.canonical_url}\n{source.text[:2200]}"
            for source in sources[:8]
        )
        prompt = (
            "Create a careful research synthesis from the provided source excerpts. "
            "Do not invent facts. Keep citation markers like [S1] beside important claims.\n\n"
            f"Question: {plan.goal}\n\nSources:\n{context}\n\n"
            "Return concise sections: TLDR, Detailed Summary, Key Facts, Disagreements, Open Questions, Next Suggestions."
        )
        result = await self.router.infer(
            InferenceRequest(
                task_type="research.summary",
                prompt=prompt,
                provider=request.provider,
                model=request.model,
                max_tokens=1400,
                local_first=request.local_first,
                allow_fallback=request.use_cloud_ai,
                metadata={"research_run_id": run_id, "research_mode": request.mode},
            )
        )
        report = fallback.model_copy(
            update={
                "detailed_summary": result.text.strip(),
                "tldr": fallback.tldr or _first_sentence(result.text),
            }
        )
        return {
            "report": report,
            "provider": result.provider,
            "model": result.model,
            "total_tokens": result.usage.total_tokens,
            "cost_usd": result.cost_usd,
        }


def source_from_scrape_result(result: dict[str, Any], *, requested_url: str) -> ResearchSourceRecord:
    final_url = str(result.get("final_url") or result.get("url") or requested_url)
    canonical = normalize_url(str(result.get("canonical_url") or final_url))
    return ResearchSourceRecord(
        id=new_id("source"),
        url=normalize_url(requested_url) or requested_url,
        canonical_url=canonical or normalize_url(requested_url) or requested_url,
        title=str(result.get("title") or ""),
        author=result.get("author") if isinstance(result.get("author"), str) else None,
        published_at=result.get("published_at") if isinstance(result.get("published_at"), str) else None,
        description=str(result.get("description") or ""),
        text=str(result.get("text") or ""),
        text_length=int(result.get("text_length") or len(str(result.get("text") or ""))),
        links=[link for link in result.get("links", []) if isinstance(link, dict)],
        tables=[table for table in result.get("tables", []) if isinstance(table, dict)],
        metadata={key: value for key, value in result.items() if key not in {"text", "links", "tables"}},
        fetched_at=now_iso(),
    )


def build_extractive_report(goal: str, mode: str, sources: list[ResearchSourceRecord]) -> ResearchReport:
    title = f"{_mode_label(mode)}: {goal}"
    if not sources:
        return ResearchReport(
            title=title,
            tldr="No sources were collected.",
            detailed_summary="The run completed without usable sources. Try a broader query, seed URL, or relaxed domain filter.",
            open_questions=["Which source or domain should be used as a seed?"],
            next_research_suggestions=["Try URL Scrape with a known source URL.", "Increase max pages or remove restrictive domain filters."],
        )
    facts = _key_facts(sources)
    top_titles = ", ".join((source.title or source.canonical_url) for source in sources[:3])
    tldr = f"Collected {len(sources)} source(s). Strongest sources: {top_titles}."
    detailed = "\n\n".join(
        f"[{source.id}] {source.title or source.canonical_url}\n{_source_summary(source)}"
        for source in sources[:8]
    )
    return ResearchReport(
        title=title,
        tldr=tldr,
        detailed_summary=detailed,
        key_facts=facts,
        disagreements=_disagreements(sources),
        source_table=[
            {
                "id": source.id,
                "title": source.title,
                "url": source.canonical_url,
                "author": source.author,
                "published_at": source.published_at,
                "score": source.score,
                "cached": source.cached,
            }
            for source in sources
        ],
        open_questions=_open_questions(sources),
        next_research_suggestions=[
            "Run Compare Sources against the top domains if claims conflict.",
            "Use Site Crawl on the strongest source to gather supporting pages.",
            "Save the strongest source cards into semantic memory if this topic will recur.",
        ],
        reliability_notes=_reliability_notes(sources),
        timeline=[
            {"source_id": source.id, "date": source.published_at, "title": source.title}
            for source in sources
            if source.published_at
        ],
    )


def export_research_markdown(run: ResearchRunRecord) -> str:
    lines = [
        f"# {run.report.title}",
        "",
        f"- Run: `{run.id}`",
        f"- Status: `{run.status}`",
        f"- Mode: `{run.mode}`",
        f"- Sources: {len(run.sources)}",
        f"- Runtime: {round(run.runtime_ms)} ms",
        "",
        "## TLDR",
        run.report.tldr,
        "",
        "## Detailed Summary",
        run.report.detailed_summary,
        "",
        "## Key Facts",
    ]
    lines.extend(f"- {fact}" for fact in run.report.key_facts)
    lines.extend(["", "## Citations"])
    source_by_id = {source.id: source for source in run.sources}
    for citation in run.citations:
        urls = ", ".join(source_by_id[source_id].canonical_url for source_id in citation.source_ids if source_id in source_by_id)
        lines.append(f"- `{citation.id}` {citation.claim} ({urls})")
    lines.extend(["", "## Sources"])
    for source in run.sources:
        lines.append(f"- [{source.id}] {source.title or source.canonical_url} - {source.canonical_url}")
    return "\n".join(lines).strip() + "\n"


def export_research_html(run: ResearchRunRecord) -> str:
    markdown = export_research_markdown(run)
    body = "\n".join(f"<p>{html.escape(line)}</p>" if line else "" for line in markdown.splitlines())
    return f"<!doctype html><html><head><meta charset=\"utf-8\"><title>{html.escape(run.report.title)}</title></head><body>{body}</body></html>"


def _extract_metadata(soup: BeautifulSoup) -> dict[str, str]:
    metadata: dict[str, str] = {}
    for tag in soup.find_all("meta"):
        key = tag.get("name") or tag.get("property") or tag.get("itemprop")
        value = tag.get("content")
        if key and value:
            metadata[str(key)] = _clean_text(str(value))
    return metadata


def _extract_tables(soup: BeautifulSoup) -> list[dict[str, Any]]:
    tables: list[dict[str, Any]] = []
    for index, table in enumerate(soup.find_all("table")[:8], start=1):
        rows = []
        for tr in table.find_all("tr")[:40]:
            cells = [_clean_text(cell.get_text(" ", strip=True)) for cell in tr.find_all(["th", "td"])[:12]]
            if cells:
                rows.append(cells)
        if rows:
            tables.append({"index": index, "rows": rows})
    return tables


def _dedupe_links(links: list[dict[str, str]]) -> list[dict[str, str]]:
    seen: set[str] = set()
    deduped = []
    for link in links:
        url = link.get("url", "")
        if not url or url in seen:
            continue
        seen.add(url)
        deduped.append(link)
    return deduped


def _key_facts(sources: list[ResearchSourceRecord]) -> list[str]:
    facts: list[str] = []
    for source in sources[:8]:
        sentence = _first_sentence(source.description) or _first_sentence(source.text)
        if sentence:
            facts.append(f"{sentence} [{source.id}]")
    return facts[:10]


def _source_summary(source: ResearchSourceRecord) -> str:
    sentences = _sentences(source.text)
    return " ".join(sentences[:3]) or source.description or "No readable body text was extracted."


def _best_source_for_claim(claim: str, sources: list[ResearchSourceRecord]) -> ResearchSourceRecord | None:
    source_id_match = re.search(r"\[(S\d+)\]", claim)
    if source_id_match:
        source_id = source_id_match.group(1)
        return next((source for source in sources if source.id == source_id), None)
    terms = set(re.findall(r"[a-zA-Z0-9]{5,}", claim.lower()))
    ranked = sorted(
        sources,
        key=lambda source: len(terms.intersection(set(re.findall(r"[a-zA-Z0-9]{5,}", source.text.lower())))),
        reverse=True,
    )
    return ranked[0] if ranked else None


def _quote_for_claim(claim: str, text: str) -> str | None:
    claim_terms = set(re.findall(r"[a-zA-Z0-9]{5,}", claim.lower()))
    best = ""
    best_score = 0
    for sentence in _sentences(text)[:80]:
        score = len(claim_terms.intersection(set(re.findall(r"[a-zA-Z0-9]{5,}", sentence.lower()))))
        if score > best_score:
            best = sentence
            best_score = score
    return best[:500] if best else None


def _disagreements(sources: list[ResearchSourceRecord]) -> list[str]:
    combined = "\n".join(source.text[:2000].lower() for source in sources)
    if any(word in combined for word in ["however", "criticism", "dispute", "contradict", "declined", "failed"]):
        return ["Some collected sources contain contrast or caveat language; inspect the cited raw sources before acting."]
    return ["No explicit contradictions were detected in the collected source excerpts."]


def _open_questions(sources: list[ResearchSourceRecord]) -> list[str]:
    questions = []
    if len({domain_of(source.canonical_url) for source in sources}) < 2:
        questions.append("Can this be corroborated by more independent domains?")
    if not any(source.published_at for source in sources):
        questions.append("What is the publication or last-updated date for the strongest sources?")
    if not any(source.author for source in sources):
        questions.append("Who authored the strongest sources?")
    return questions[:4]


def _reliability_notes(sources: list[ResearchSourceRecord]) -> list[str]:
    domains = sorted({domain_of(source.canonical_url) for source in sources if source.canonical_url})
    notes = [f"Collected sources span {len(domains)} domain(s): {', '.join(domains[:8])}."]
    if any(source.cached for source in sources):
        notes.append("At least one source came from the local cache; rerun with a URL scrape if freshness matters.")
    if any(source.text_length < 500 for source in sources):
        notes.append("Some sources had short extracted text, which can mean a thin page, heavy client rendering, or extraction limits.")
    return notes


def _sentences(text: str) -> list[str]:
    return [sentence.strip() for sentence in re.split(r"(?<=[.!?])\s+", _normalize_text(text)) if len(sentence.strip()) > 20]


def _first_sentence(text: str) -> str:
    sentences = _sentences(text)
    return sentences[0] if sentences else ""


def _normalize_text(text: str) -> str:
    lines = [_clean_text(line) for line in text.splitlines()]
    return "\n".join(line for line in lines if line)


def _clean_text(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def _mode_label(mode: str) -> str:
    return mode.replace("_", " ").title()
