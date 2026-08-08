"""Web search provider interface and the Firecrawl implementation.

Search results are DATA, never instructions — downstream prompt assembly must
keep them fenced, same rule as `ingestion.extract_text` output.
"""

import logging
from dataclasses import dataclass
from typing import Protocol

import httpx

from app.config import get_settings
from app.db import store

log = logging.getLogger(__name__)

_FIRECRAWL_SEARCH_URL = "https://api.firecrawl.dev/v2/search"


class SearchError(Exception):
    """Generic search failure."""


class SearchUnavailableError(SearchError):
    """No provider configured, or the provider rejected our credentials."""


class SearchQuotaError(SearchError):
    """The monthly credit allowance is spent — nothing to do but wait for the
    month to roll over, or upgrade."""


class SearchRateLimitedError(SearchError):
    """Too many requests too quickly. Transient, and deliberately NOT a
    SearchQuotaError: telling someone their quota is gone when they merely
    need to wait a minute is the wrong instruction entirely."""

    def __init__(self, message: str, retry_after: int | None = None):
        super().__init__(message)
        self.retry_after = retry_after


@dataclass(frozen=True)
class WebResult:
    url: str
    title: str
    content: str
    excerpt: str

    def to_dict(self) -> dict:
        return {
            "url": self.url,
            "title": self.title,
            "content": self.content,
            "excerpt": self.excerpt,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "WebResult":
        # Cache rows may have been written by an older shape of this class;
        # a stale row must not raise inside the chat stream.
        return cls(
            url=data.get("url", ""),
            title=data.get("title", ""),
            content=data.get("content", ""),
            excerpt=data.get("excerpt", ""),
        )


class SearchProvider(Protocol):
    async def search(self, query: str, max_results: int) -> list[WebResult]: ...


class FirecrawlProvider:
    """Firecrawl v2 /search, requesting markdown so results carry page content
    rather than snippets — the archive and grounding both need the real body."""

    async def search(self, query: str, max_results: int) -> list[WebResult]:
        settings = get_settings()
        payload = {
            "query": query,
            "limit": max_results,
            "sources": [{"type": "web"}],
            "scrapeOptions": {"formats": [{"type": "markdown"}]},
        }
        headers = {"Authorization": f"Bearer {settings.firecrawl_api_key}"}
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(90, connect=15)) as client:
                resp = await client.post(
                    _FIRECRAWL_SEARCH_URL, json=payload, headers=headers
                )
        except httpx.HTTPError as exc:
            raise SearchError(f"search transport error: {exc}") from exc

        if resp.status_code == 429:
            header = resp.headers.get("Retry-After", "")
            raise SearchRateLimitedError(
                "search rate limited (429)", int(header) if header.isdigit() else None
            )
        if resp.status_code == 402:
            raise SearchQuotaError("search quota exhausted (402)")
        if resp.status_code in (401, 403):
            raise SearchUnavailableError(f"search auth rejected ({resp.status_code})")
        if resp.status_code >= 400:
            raise SearchError(f"search upstream status {resp.status_code}")

        try:
            web = resp.json()["data"]["web"]
        except (KeyError, TypeError, ValueError) as exc:
            raise SearchError("malformed search response") from exc

        return [
            WebResult(
                url=item.get("url", ""),
                title=item.get("title") or item.get("url", "Untitled"),
                content=item.get("markdown") or item.get("description") or "",
                excerpt=item.get("description") or "",
            )
            for item in web
            if item.get("url")
        ]


def get_provider() -> SearchProvider | None:
    """The single configured provider, or None when web search is unconfigured."""
    if not get_settings().firecrawl_api_key:
        return None
    return FirecrawlProvider()


async def run_search(
    query: str, max_results: int | None = None, force_refresh: bool = False
) -> list[WebResult]:
    """Cache-aware search. The cache exists to protect a small monthly quota,
    not to store knowledge — hence the short TTL and the force_refresh escape."""
    if not query.strip():
        # Nothing to search for; never spend a provider credit on a blank query.
        return []
    settings = get_settings()
    limit = max_results or settings.web_search_max_results

    if not force_refresh:
        cached = store.get_cached_search(query, limit, settings.web_search_cache_ttl_s)
        if cached is not None:
            return [WebResult.from_dict(item) for item in cached]

    provider = get_provider()
    if provider is None:
        raise SearchUnavailableError("web search is not configured on this server")

    results = await provider.search(query, limit)
    store.put_cached_search(query, limit, [r.to_dict() for r in results])
    return results
