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
