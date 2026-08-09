import pytest

from app.config import get_settings
from app.db import store
from app.services import search


@pytest.fixture(autouse=True)
def tools_env(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("FIRECRAWL_API_KEY", "k")
    get_settings.cache_clear()
    store.init_db(str(tmp_path))
    yield
    get_settings.cache_clear()


async def test_web_search_tool_returns_excerpts_not_page_bodies(monkeypatch):
    from app.harness import builtin_tools

    async def fake_run_search(query, max_results=None, force_refresh=False):
        return [search.WebResult(
            url="https://a.test/x", title="A", content="a" * 5000, excerpt="short",
        )]

    monkeypatch.setattr(search, "run_search", fake_run_search)
    registry = builtin_tools.default_registry()
    result = await registry.dispatch("web_search", {"query": "sqlite"}, owner=True)

    assert result["ok"] is True
    assert result["data"]["results"] == [
        {"url": "https://a.test/x", "title": "A", "excerpt": "short"}
    ]


async def test_web_search_is_owner_only():
    from app.harness import builtin_tools

    registry = builtin_tools.default_registry()
    assert "web_search" not in {
        d["function"]["name"] for d in registry.definitions(owner=False)
    }
    refused = await registry.dispatch("web_search", {"query": "x"}, owner=False)
    assert refused["error"]["code"] == "not_permitted"


async def test_a_rate_limited_search_comes_back_as_a_typed_tool_error(monkeypatch):
    from app.harness import builtin_tools

    async def fake_run_search(query, max_results=None, force_refresh=False):
        raise search.SearchRateLimitedError("429", retry_after=30)

    monkeypatch.setattr(search, "run_search", fake_run_search)
    registry = builtin_tools.default_registry()
    result = await registry.dispatch("web_search", {"query": "x"}, owner=True)

    # Not an exception into the runner, and not flattened into a quota error.
    assert result["ok"] is False
    assert result["error"]["code"] == "search_rate_limited"


async def test_an_exhausted_quota_is_distinguished_from_a_rate_limit(monkeypatch):
    from app.harness import builtin_tools

    async def fake_run_search(query, max_results=None, force_refresh=False):
        raise search.SearchQuotaError("402")

    monkeypatch.setattr(search, "run_search", fake_run_search)
    registry = builtin_tools.default_registry()
    result = await registry.dispatch("web_search", {"query": "x"}, owner=True)
    assert result["error"]["code"] == "search_quota_exhausted"


async def test_a_blank_query_returns_no_results_without_spending_a_credit(monkeypatch):
    from app.harness import builtin_tools

    calls = []

    async def fake_provider_search(self, query, max_results):
        calls.append(query)
        return []

    monkeypatch.setattr(search.FirecrawlProvider, "search", fake_provider_search)
    registry = builtin_tools.default_registry()
    result = await registry.dispatch("web_search", {"query": "   "}, owner=True)

    assert result["data"]["results"] == []
    assert calls == []


async def test_the_tool_definition_declares_its_query_parameter():
    from app.harness import builtin_tools

    definition = builtin_tools.default_registry().definitions(owner=True)[0]
    params = definition["function"]["parameters"]
    assert params["properties"]["query"]["type"] == "string"
    assert params["required"] == ["query"]


async def test_fetch_url_is_registered_owner_only_and_truncated(monkeypatch):
    from app.harness import builtin_tools

    async def fake_scrape(url):
        return search.WebResult(url=url, title="T", content="x" * 50_000, excerpt="e")

    monkeypatch.setattr(search, "scrape_url", fake_scrape)
    monkeypatch.setenv("WEB_SCRAPE_CHAR_BUDGET", "100")
    get_settings.cache_clear()

    registry = builtin_tools.default_registry()
    assert "fetch_url" not in {
        d["function"]["name"] for d in registry.definitions(owner=False)
    }

    result = await registry.dispatch("fetch_url", {"url": "https://a.test"}, owner=True)
    # The result goes back into a model's context; a 50k-char page would swamp it.
    assert len(result["data"]["content"]) <= 100 + len("\n[…truncated]")
    assert result["data"]["title"] == "T"


async def test_fetch_url_leaves_a_short_page_untruncated(monkeypatch):
    from app.harness import builtin_tools

    async def fake_scrape(url):
        return search.WebResult(url=url, title="T", content="short body", excerpt="e")

    monkeypatch.setattr(search, "scrape_url", fake_scrape)
    registry = builtin_tools.default_registry()
    result = await registry.dispatch("fetch_url", {"url": "https://a.test"}, owner=True)
    assert result["data"]["content"] == "short body"


async def test_site_map_returns_links_as_a_typed_result(monkeypatch):
    from app.harness import builtin_tools

    async def fake_map(url, query="", limit=None):
        return [{"url": "https://a.test/1", "title": "P1", "description": "d"}]

    monkeypatch.setattr(search, "map_site", fake_map)
    registry = builtin_tools.default_registry()
    result = await registry.dispatch(
        "site_map", {"url": "https://a.test", "query": "pricing"}, owner=True
    )
    assert result["data"]["links"][0]["url"] == "https://a.test/1"


async def test_a_scrape_failure_is_a_typed_tool_error(monkeypatch):
    from app.harness import builtin_tools

    async def fake_scrape(url):
        raise search.SearchQuotaError("402")

    monkeypatch.setattr(search, "scrape_url", fake_scrape)
    registry = builtin_tools.default_registry()
    result = await registry.dispatch("fetch_url", {"url": "https://a.test"}, owner=True)
    assert result["error"]["code"] == "search_quota_exhausted"


async def test_a_site_map_failure_is_a_typed_tool_error(monkeypatch):
    from app.harness import builtin_tools

    async def fake_map(url, query="", limit=None):
        raise search.SearchRateLimitedError("429", retry_after=5)

    monkeypatch.setattr(search, "map_site", fake_map)
    registry = builtin_tools.default_registry()
    result = await registry.dispatch("site_map", {"url": "https://a.test"}, owner=True)
    assert result["error"]["code"] == "search_rate_limited"


async def test_every_registered_tool_is_owner_only_this_milestone():
    # Each one spends a shared paid allowance from a publicly reachable server.
    from app.harness import builtin_tools

    registry = builtin_tools.default_registry()
    assert registry.definitions(owner=False) == []
    assert {d["function"]["name"] for d in registry.definitions(owner=True)} == {
        "web_search", "fetch_url", "site_map",
    }
