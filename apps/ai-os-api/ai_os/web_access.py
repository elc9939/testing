from __future__ import annotations

import base64
import ipaddress
import os
import re
import shutil
import socket
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, quote_plus, unquote, urljoin, urlparse

import httpx
from bs4 import BeautifulSoup

from .config import Settings

try:
    from playwright.async_api import async_playwright
except Exception:  # pragma: no cover - exercised when dependency is unavailable.
    async_playwright = None


class WebAccess:
    def __init__(self, settings: Settings):
        self.settings = settings

    def capability_adapters(self) -> dict[str, dict[str, bool]]:
        return {
            "web.search": {"duckduckgo-html": self.settings.web_access_enabled},
            "web.scrape": {"httpx-beautifulsoup": self.settings.web_access_enabled},
            "browser.extract": {
                "playwright": self.settings.web_access_enabled and bool(self._browser_executable_path()),
                "http-fallback": self.settings.web_access_enabled,
            },
        }

    async def search(self, query: str, limit: int = 6) -> dict[str, Any]:
        self._ensure_enabled()
        cleaned_query = query.strip()
        if not cleaned_query:
            raise ValueError("query is required.")
        max_results = max(1, min(limit, self.settings.web_search_max_results))
        search_url = f"https://duckduckgo.com/html/?q={quote_plus(cleaned_query)}"
        page = await self._fetch_bytes(search_url)
        soup = BeautifulSoup(page["body"].decode(page["encoding"], errors="replace"), "html.parser")
        results: list[dict[str, Any]] = []
        for anchor in soup.select("a.result__a, a[data-testid='result-title-a'], a[href]"):
            title = self._clean_text(anchor.get_text(" ", strip=True))
            href = str(anchor.get("href") or "")
            if not title or not href:
                continue
            resolved = self._duckduckgo_result_url(urljoin(str(page["final_url"]), href))
            if not resolved.startswith(("http://", "https://")) or "duckduckgo.com" in urlparse(resolved).netloc:
                continue
            container = anchor.find_parent(class_=re.compile("result", re.I)) or anchor.parent
            snippet = ""
            if container:
                snippet = self._clean_text(container.get_text(" ", strip=True)).replace(title, "", 1).strip(" -")
            if any(item["url"] == resolved for item in results):
                continue
            results.append({"title": title, "url": resolved, "snippet": snippet[:500]})
            if len(results) >= max_results:
                break
        return {
            "ok": True,
            "tool_id": "web.search",
            "query": cleaned_query,
            "provider": "duckduckgo-html",
            "results": results,
            "result_count": len(results),
            "source_url": str(page["final_url"]),
        }

    async def scrape(self, url: str, *, include_html: bool = False, max_text_chars: int | None = None, max_links: int | None = None) -> dict[str, Any]:
        self._ensure_enabled()
        page = await self._fetch_bytes(url)
        parsed = self._extract_page(
            html_or_text=page["body"].decode(page["encoding"], errors="replace"),
            base_url=str(page["final_url"]),
            content_type=str(page["content_type"]),
            max_text_chars=max_text_chars,
            max_links=max_links,
            include_html=include_html,
        )
        parsed.update(
            {
                "ok": True,
                "tool_id": "web.scrape",
                "url": page["url"],
                "final_url": str(page["final_url"]),
                "status_code": page["status_code"],
                "content_type": page["content_type"],
                "bytes": len(page["body"]),
                "mode": "http",
            }
        )
        return parsed

    async def browser_extract(
        self,
        url: str,
        *,
        wait_until: str = "domcontentloaded",
        wait_ms: int = 0,
        screenshot: bool = False,
        max_text_chars: int | None = None,
        max_links: int | None = None,
    ) -> dict[str, Any]:
        self._ensure_enabled()
        try:
            result = await self._extract_with_browser(
                url,
                wait_until=wait_until,
                wait_ms=wait_ms,
                screenshot=screenshot,
                max_text_chars=max_text_chars,
                max_links=max_links,
            )
            result["ok"] = True
            result["tool_id"] = "browser.extract"
            return result
        except Exception as error:
            fallback = await self.scrape(url, include_html=False, max_text_chars=max_text_chars, max_links=max_links)
            fallback["tool_id"] = "browser.extract"
            fallback["mode"] = "http-fallback"
            fallback["browser_available"] = False
            fallback["browser_error"] = str(error)
            return fallback

    async def _extract_with_browser(
        self,
        url: str,
        *,
        wait_until: str,
        wait_ms: int,
        screenshot: bool,
        max_text_chars: int | None,
        max_links: int | None,
    ) -> dict[str, Any]:
        if async_playwright is None:
            raise RuntimeError("Playwright is not installed.")
        await self._validate_url(url)
        wait_state = wait_until if wait_until in {"commit", "domcontentloaded", "load", "networkidle"} else "domcontentloaded"
        wait_delay = max(0, min(wait_ms, self.settings.web_browser_max_wait_ms))
        executable = self._browser_executable_path()
        launch_options: dict[str, Any] = {"headless": True}
        if executable:
            launch_options["executable_path"] = str(executable)
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(**launch_options)
            try:
                page = await browser.new_page(
                    user_agent=self.settings.web_user_agent,
                    viewport={"width": 1280, "height": 900},
                )

                async def guard_route(route):
                    request_url = route.request.url
                    if request_url.startswith(("http://", "https://")):
                        try:
                            await self._validate_url(request_url)
                        except Exception:
                            await route.abort("blockedbyclient")
                            return
                    await route.continue_()

                await page.route("**/*", guard_route)
                response = await page.goto(
                    url,
                    wait_until=wait_state,
                    timeout=int(self.settings.web_browser_timeout_s * 1000),
                )
                if wait_delay:
                    await page.wait_for_timeout(wait_delay)
                final_url = page.url
                await self._validate_url(final_url)
                title = await page.title()
                text = await page.locator("body").inner_text(timeout=5000)
                links = await page.eval_on_selector_all(
                    "a[href]",
                    """elements => elements.slice(0, 300).map((element) => ({
                        href: element.href,
                        text: (element.innerText || element.textContent || '').trim()
                    }))""",
                )
                normalized = self._normalize_extracted_text(text, max_text_chars=max_text_chars)
                payload: dict[str, Any] = {
                    "mode": "browser",
                    "browser_available": True,
                    "url": url,
                    "final_url": final_url,
                    "status_code": response.status if response else None,
                    "content_type": response.headers.get("content-type") if response else None,
                    "title": self._clean_text(title),
                    "description": "",
                    "headings": [],
                    "text": normalized["text"],
                    "text_length": len(text),
                    "text_truncated": normalized["truncated"],
                    "links": self._normalize_links(links, final_url, max_links=max_links),
                }
                if screenshot:
                    image = await page.screenshot(full_page=False, type="png")
                    payload["screenshot_base64"] = base64.b64encode(image).decode("ascii")
                    payload["screenshot_content_type"] = "image/png"
                return payload
            finally:
                await browser.close()

    async def _fetch_bytes(self, url: str) -> dict[str, Any]:
        current = url.strip()
        if not current:
            raise ValueError("url is required.")
        headers = {
            "user-agent": self.settings.web_user_agent,
            "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
        }
        async with httpx.AsyncClient(timeout=self.settings.web_timeout_s, follow_redirects=False) as client:
            for _ in range(self.settings.web_max_redirects + 1):
                await self._validate_url(current)
                response = await client.get(current, headers=headers)
                if response.status_code in {301, 302, 303, 307, 308} and response.headers.get("location"):
                    current = urljoin(str(response.url), response.headers["location"])
                    continue
                body = response.content
                if len(body) > self.settings.web_max_bytes:
                    raise ValueError(f"Response exceeds limit of {self.settings.web_max_bytes} bytes.")
                content_type = response.headers.get("content-type", "")
                return {
                    "url": url,
                    "final_url": response.url,
                    "status_code": response.status_code,
                    "content_type": content_type,
                    "encoding": self._encoding_from_content_type(content_type),
                    "body": body,
                }
        raise ValueError(f"Too many redirects; limit is {self.settings.web_max_redirects}.")

    def _extract_page(
        self,
        *,
        html_or_text: str,
        base_url: str,
        content_type: str,
        max_text_chars: int | None,
        max_links: int | None,
        include_html: bool,
    ) -> dict[str, Any]:
        if "html" not in content_type.lower():
            normalized = self._normalize_extracted_text(html_or_text, max_text_chars=max_text_chars)
            return {
                "title": "",
                "description": "",
                "headings": [],
                "text": normalized["text"],
                "text_length": len(html_or_text),
                "text_truncated": normalized["truncated"],
                "links": [],
            }
        soup = BeautifulSoup(html_or_text, "html.parser")
        for tag in soup(["script", "style", "noscript", "svg", "canvas", "template"]):
            tag.decompose()
        title = self._clean_text(soup.title.get_text(" ", strip=True) if soup.title else "")
        metadata = self._extract_metadata(soup)
        canonical_url = ""
        canonical_tag = soup.find("link", attrs={"rel": lambda value: value and "canonical" in value})
        if canonical_tag and canonical_tag.get("href"):
            canonical_url = urljoin(base_url, str(canonical_tag["href"]))
        description = ""
        description_tag = soup.find("meta", attrs={"name": re.compile("^description$", re.I)}) or soup.find(
            "meta",
            attrs={"property": re.compile("^(og:description|twitter:description)$", re.I)},
        )
        if description_tag and description_tag.get("content"):
            description = self._clean_text(str(description_tag["content"]))
        headings = [self._clean_text(tag.get_text(" ", strip=True)) for tag in soup.find_all(["h1", "h2", "h3"])[:20]]
        text_source = soup.get_text("\n", strip=True)
        normalized = self._normalize_extracted_text(text_source, max_text_chars=max_text_chars)
        links = [
            {"url": urljoin(base_url, str(anchor.get("href"))), "text": self._clean_text(anchor.get_text(" ", strip=True))[:180]}
            for anchor in soup.find_all("a", href=True)
        ]
        payload = {
            "title": title,
            "description": description,
            "author": metadata.get("author") or metadata.get("article:author"),
            "published_at": metadata.get("article:published_time") or metadata.get("date") or metadata.get("datePublished"),
            "canonical_url": canonical_url,
            "headings": [heading for heading in headings if heading],
            "text": normalized["text"],
            "text_length": len(text_source),
            "text_truncated": normalized["truncated"],
            "links": self._normalize_links(links, base_url, max_links=max_links),
            "tables": self._extract_tables(soup),
            "metadata": metadata,
        }
        if include_html:
            html_limit = min(self.settings.web_max_text_chars, max_text_chars or self.settings.web_max_text_chars)
            payload["html"] = html_or_text[:html_limit]
            payload["html_truncated"] = len(html_or_text) > html_limit
        return payload

    def _normalize_extracted_text(self, text: str, *, max_text_chars: int | None) -> dict[str, Any]:
        max_chars = max(1, min(max_text_chars or self.settings.web_max_text_chars, self.settings.web_max_text_chars))
        lines = [self._clean_text(line) for line in text.splitlines()]
        collapsed = "\n".join(line for line in lines if line)
        return {"text": collapsed[:max_chars], "truncated": len(collapsed) > max_chars}

    def _normalize_links(self, links: list[Any], base_url: str, *, max_links: int | None) -> list[dict[str, str]]:
        limit = max(0, min(max_links or self.settings.web_max_links, self.settings.web_max_links))
        normalized: list[dict[str, str]] = []
        for item in links:
            href = item.get("url") or item.get("href") if isinstance(item, dict) else ""
            text = item.get("text") if isinstance(item, dict) else ""
            if not isinstance(href, str) or not href:
                continue
            resolved = urljoin(base_url, href)
            if not resolved.startswith(("http://", "https://")):
                continue
            if any(entry["url"] == resolved for entry in normalized):
                continue
            normalized.append({"url": resolved, "text": self._clean_text(str(text))[:180]})
            if len(normalized) >= limit:
                break
        return normalized

    async def _validate_url(self, url: str) -> None:
        parsed = urlparse(url)
        if parsed.scheme not in {"http", "https"}:
            raise ValueError("Only http:// and https:// URLs are allowed.")
        if not parsed.hostname:
            raise ValueError("URL must include a hostname.")
        if self.settings.web_allow_private_hosts:
            return
        host = parsed.hostname
        if host.lower() == "localhost" or host.lower().endswith(".local"):
            raise ValueError("Private/local hosts are blocked by AI_OS_WEB_ALLOW_PRIVATE_HOSTS=false.")
        try:
            addresses = [ipaddress.ip_address(host)]
        except ValueError:
            addresses = await self._resolve_host(host)
        for address in addresses:
            if (
                address.is_private
                or address.is_loopback
                or address.is_link_local
                or address.is_multicast
                or address.is_unspecified
                or address.is_reserved
            ):
                raise ValueError("Private/local network targets are blocked by AI_OS_WEB_ALLOW_PRIVATE_HOSTS=false.")

    async def _resolve_host(self, host: str) -> list[ipaddress.IPv4Address | ipaddress.IPv6Address]:
        import asyncio

        def resolve() -> list[ipaddress.IPv4Address | ipaddress.IPv6Address]:
            resolved = socket.getaddrinfo(host, None)
            addresses = []
            for item in resolved:
                raw = item[4][0]
                try:
                    addresses.append(ipaddress.ip_address(raw))
                except ValueError:
                    continue
            return addresses

        return await asyncio.to_thread(resolve)

    def _browser_executable_path(self) -> Path | None:
        configured = self.settings.web_browser_executable_path
        if configured and configured.exists() and configured.is_file():
            return configured
        candidates: list[Path] = []
        if os.name == "nt":
            for base in [os.getenv("ProgramFiles"), os.getenv("ProgramFiles(x86)"), os.getenv("LOCALAPPDATA")]:
                if not base:
                    continue
                candidates.extend(
                    [
                        Path(base) / "Google" / "Chrome" / "Application" / "chrome.exe",
                        Path(base) / "Microsoft" / "Edge" / "Application" / "msedge.exe",
                    ]
                )
        for command in ["google-chrome", "chrome", "chromium", "chromium-browser", "msedge"]:
            found = shutil.which(command)
            if found:
                candidates.append(Path(found))
        return next((candidate for candidate in candidates if candidate.exists() and candidate.is_file()), None)

    def _duckduckgo_result_url(self, href: str) -> str:
        parsed = urlparse(href)
        values = parse_qs(parsed.query)
        if "uddg" in values and values["uddg"]:
            return unquote(values["uddg"][0])
        return href

    def _encoding_from_content_type(self, content_type: str) -> str:
        match = re.search(r"charset=([^;]+)", content_type, re.I)
        return match.group(1).strip() if match else "utf-8"

    def _extract_metadata(self, soup: BeautifulSoup) -> dict[str, str]:
        metadata: dict[str, str] = {}
        for tag in soup.find_all("meta"):
            key = tag.get("name") or tag.get("property") or tag.get("itemprop")
            value = tag.get("content")
            if key and value:
                metadata[str(key)] = self._clean_text(str(value))
        return metadata

    def _extract_tables(self, soup: BeautifulSoup) -> list[dict[str, Any]]:
        tables: list[dict[str, Any]] = []
        for index, table in enumerate(soup.find_all("table")[:8], start=1):
            rows: list[list[str]] = []
            for tr in table.find_all("tr")[:40]:
                cells = [self._clean_text(cell.get_text(" ", strip=True)) for cell in tr.find_all(["th", "td"])[:12]]
                if cells:
                    rows.append(cells)
            if rows:
                tables.append({"index": index, "rows": rows})
        return tables

    def _clean_text(self, text: str) -> str:
        return re.sub(r"\s+", " ", text or "").strip()

    def _ensure_enabled(self) -> None:
        if not self.settings.web_access_enabled:
            raise RuntimeError("AI OS web access is disabled by AI_OS_WEB_ACCESS_ENABLED=false.")
