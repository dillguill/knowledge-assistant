import httpx
import pytest
import respx

from app.config import get_settings

SEARCH_URL = "https://api.firecrawl.dev/v2/search"

FIRECRAWL_OK = {
    "success": True,
    "data": {
        "web": [
            {
                "url": "https://example.test/a",
                "title": "Article A",
                "description": "Short blurb A",
                "markdown": "# A\n\nFull page body A.",
            },
            {
                "url": "https://example.test/b",
                "title": "Article B",
                "description": "Short blurb B",
                "markdown": "# B\n\nFull page body B.",
            },
        ]
    },
    "creditsUsed": 2,
}


@pytest.fixture(autouse=True)
def _settings(tmp_path, monkeypatch):
    from app.db import store

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("FIRECRAWL_API_KEY", "test-key")
    get_settings.cache_clear()
    store.init_db(str(tmp_path))
    yield
    get_settings.cache_clear()


@respx.mock
async def test_firecrawl_provider_maps_results():
    from app.services.search import FirecrawlProvider

    respx.post(SEARCH_URL).respond(json=FIRECRAWL_OK)
    results = await FirecrawlProvider().search("query", 2)

    assert [r.url for r in results] == ["https://example.test/a", "https://example.test/b"]
    assert results[0].title == "Article A"
    assert results[0].content == "# A\n\nFull page body A."
    assert results[0].excerpt == "Short blurb A"


@respx.mock
async def test_firecrawl_provider_sends_expected_request():
    from app.services.search import FirecrawlProvider

    route = respx.post(SEARCH_URL).respond(json=FIRECRAWL_OK)
    await FirecrawlProvider().search("rust linters", 3)

    request = route.calls.last.request
    assert request.headers["authorization"] == "Bearer test-key"
    payload = httpx.Request("POST", SEARCH_URL, content=request.content).content
    import json as _json

    body = _json.loads(payload)
    assert body["query"] == "rust linters"
    assert body["limit"] == 3
    assert body["sources"] == [{"type": "web"}]
    assert body["scrapeOptions"]["formats"] == [{"type": "markdown"}]


@respx.mock
async def test_quota_error_raised_on_402():
    from app.services.search import FirecrawlProvider, SearchQuotaError

    respx.post(SEARCH_URL).respond(status_code=402, json={"error": "out of credits"})
    with pytest.raises(SearchQuotaError):
        await FirecrawlProvider().search("q", 5)


@respx.mock
async def test_quota_error_raised_on_429():
    from app.services.search import FirecrawlProvider, SearchQuotaError

    respx.post(SEARCH_URL).respond(status_code=429, json={"error": "rate limited"})
    with pytest.raises(SearchQuotaError):
        await FirecrawlProvider().search("q", 5)


@respx.mock
async def test_unavailable_error_raised_on_401():
    from app.services.search import FirecrawlProvider, SearchUnavailableError

    respx.post(SEARCH_URL).respond(status_code=401, json={"error": "bad key"})
    with pytest.raises(SearchUnavailableError):
        await FirecrawlProvider().search("q", 5)


@respx.mock
async def test_malformed_payload_raises_search_error():
    from app.services.search import FirecrawlProvider, SearchError

    respx.post(SEARCH_URL).respond(json={"success": True})
    with pytest.raises(SearchError):
        await FirecrawlProvider().search("q", 5)


async def test_get_provider_returns_none_without_key(monkeypatch):
    from app.services import search

    monkeypatch.setenv("FIRECRAWL_API_KEY", "")
    get_settings.cache_clear()
    assert search.get_provider() is None


@respx.mock
async def test_run_search_caches_and_second_call_skips_provider():
    from app.services import search

    route = respx.post(SEARCH_URL).respond(json=FIRECRAWL_OK)

    first = await search.run_search("cached query", 2)
    second = await search.run_search("cached query", 2)

    assert route.call_count == 1
    assert [r.url for r in second] == [r.url for r in first]


@respx.mock
async def test_run_search_force_refresh_bypasses_cache():
    from app.services import search

    route = respx.post(SEARCH_URL).respond(json=FIRECRAWL_OK)

    await search.run_search("forced", 2)
    await search.run_search("forced", 2, force_refresh=True)

    assert route.call_count == 2


async def test_run_search_without_key_raises_unavailable(monkeypatch):
    from app.services import search

    monkeypatch.setenv("FIRECRAWL_API_KEY", "")
    get_settings.cache_clear()
    with pytest.raises(search.SearchUnavailableError):
        await search.run_search("q", 2)
