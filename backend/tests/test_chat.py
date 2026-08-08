import json

import httpx
import respx

from app.main import create_app

UPSTREAM = "https://openrouter.ai/api/v1/chat/completions"

UPSTREAM_SSE = (
    b'data: {"id":"1","choices":[{"delta":{"content":"Hel"}}]}\n\n'
    b'data: {"id":"1","choices":[{"delta":{"content":"lo!"}}]}\n\n'
    b'data: {"id":"1","choices":[{"delta":{}}]}\n\n'
    b"data: [DONE]\n\n"
)


def client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_app()), base_url="http://test"
    )


def parse_events(body: str) -> list[str]:
    return [
        line[len("data: ") :]
        for line in body.split("\n\n")
        if line.startswith("data: ")
    ]


@respx.mock
async def test_chat_streams_text_deltas():
    respx.post(UPSTREAM).respond(
        status_code=200,
        headers={"content-type": "text/event-stream"},
        content=UPSTREAM_SSE,
    )
    async with client() as c:
        resp = await c.post(
            "/api/chat",
            json={"model": "qwen/qwen3-4b:free",
                  "messages": [{"role": "user", "content": "hi"}]},
        )
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/event-stream")
    events = parse_events(resp.text)
    deltas = [json.loads(e)["text"] for e in events[:-1]]
    assert deltas == ["Hel", "lo!"]
    assert events[-1] == "[DONE]"


@respx.mock
async def test_chat_maps_429_to_rate_limited_event():
    respx.post(UPSTREAM).respond(status_code=429, json={"error": "slow down"})
    async with client() as c:
        resp = await c.post(
            "/api/chat", json={"messages": [{"role": "user", "content": "hi"}]}
        )
    assert resp.status_code == 200
    events = parse_events(resp.text)
    err = json.loads(events[0])
    assert err["type"] == "error"
    assert err["code"] == "rate_limited"
    assert events[-1] == "[DONE]"


@respx.mock
async def test_rate_limited_passes_retry_after_through():
    respx.post(UPSTREAM).respond(
        status_code=429, headers={"Retry-After": "52"}, json={"error": "slow down"}
    )
    async with client() as c:
        resp = await c.post(
            "/api/chat", json={"messages": [{"role": "user", "content": "hi"}]}
        )
    err = json.loads(parse_events(resp.text)[0])
    assert err["code"] == "rate_limited"
    assert err["retry_after"] == 52


@respx.mock
async def test_rate_limited_omits_retry_after_when_absent():
    respx.post(UPSTREAM).respond(status_code=429, json={"error": "slow down"})
    async with client() as c:
        resp = await c.post(
            "/api/chat", json={"messages": [{"role": "user", "content": "hi"}]}
        )
    err = json.loads(parse_events(resp.text)[0])
    assert err["code"] == "rate_limited"
    assert "retry_after" not in err


@respx.mock
async def test_404_maps_to_model_gone():
    respx.post(UPSTREAM).respond(status_code=404, json={"error": "no such model"})
    async with client() as c:
        resp = await c.post(
            "/api/chat",
            json={"model": "gone/model:free",
                  "messages": [{"role": "user", "content": "hi"}]},
        )
    events = parse_events(resp.text)
    err = json.loads(events[0])
    assert err["type"] == "error"
    assert err["code"] == "model_gone"
    assert "gone/model:free" in err["message"]
    assert events[-1] == "[DONE]"


async def test_chat_rejects_empty_messages():
    async with client() as c:
        resp = await c.post("/api/chat", json={"messages": []})
    assert resp.status_code == 422


@respx.mock
async def test_chat_with_sources_emits_sources_event_and_context(tmp_path, monkeypatch):
    from app.config import get_settings
    from app.db import store

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    store.init_db(str(tmp_path))
    col = store.create_collection("Garage")
    doc = store.add_document(col["id"], "manual.txt", "text/plain",
                             "upload", b"x", "torque is 22 Nm")

    route = respx.post(UPSTREAM).respond(
        status_code=200,
        headers={"content-type": "text/event-stream"},
        content=UPSTREAM_SSE,
    )
    async with client() as c:
        resp = await c.post("/api/chat", json={
            "messages": [{"role": "user", "content": "torque?"}],
            "collection_ids": [col["id"]],
        })
    events = parse_events(resp.text)
    first = json.loads(events[0])
    assert first["type"] == "sources"
    assert first["sources"] == [
        {"id": doc["id"], "label": "S1", "filename": "manual.txt", "kind": "document"}]
    sent = json.loads(route.calls[0].request.content)
    assert sent["messages"][0]["role"] == "system"
    assert "torque is 22 Nm" in sent["messages"][0]["content"]
    get_settings.cache_clear()


@respx.mock
async def test_chat_with_only_wiki_pages_emits_sources_event_and_context(
    tmp_path, monkeypatch
):
    from app.config import get_settings
    from app.db import store, wiki_store

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    store.init_db(str(tmp_path))
    wiki_store.init_wiki(str(tmp_path))
    page = wiki_store.create_page(
        "Torque Specs", None, "wiki torque is 26 Nm", "owner"
    )

    route = respx.post(UPSTREAM).respond(
        status_code=200,
        headers={"content-type": "text/event-stream"},
        content=UPSTREAM_SSE,
    )
    async with client() as c:
        resp = await c.post("/api/chat", json={
            "messages": [{"role": "user", "content": "torque?"}],
            "wiki_page_ids": [page["id"]],
        })
    events = parse_events(resp.text)
    first = json.loads(events[0])
    assert first["type"] == "sources"
    assert first["sources"] == [
        {"id": page["id"], "label": "S1", "filename": "Torque Specs",
         "kind": "wiki", "slug": page["slug"]}]
    sent = json.loads(route.calls[0].request.content)
    assert sent["messages"][0]["role"] == "system"
    assert "wiki torque is 26 Nm" in sent["messages"][0]["content"]
    get_settings.cache_clear()


@respx.mock
async def test_chat_with_target_emits_target_event_first(tmp_path, monkeypatch):
    from app.config import get_settings
    from app.db import store, wiki_store

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    store.init_db(str(tmp_path))
    wiki_store.init_wiki(str(tmp_path))
    page = wiki_store.create_page("Torque Specs", None, "torque is 22 Nm", "owner")

    route = respx.post(UPSTREAM).respond(
        status_code=200,
        headers={"content-type": "text/event-stream"},
        content=UPSTREAM_SSE,
    )
    async with client() as c:
        resp = await c.post("/api/chat", json={
            "messages": [{"role": "user", "content": "edit it"}],
            "target_page_id": page["id"],
        })
    events = parse_events(resp.text)
    first = json.loads(events[0])
    assert first["type"] == "target"
    assert first["target"] == {
        "page_id": page["id"], "title": "Torque Specs", "slug": page["slug"]}
    sent = json.loads(route.calls[0].request.content)
    assert sent["messages"][0]["role"] == "system"
    assert "Torque Specs" in sent["messages"][0]["content"]
    assert "torque is 22 Nm" in sent["messages"][0]["content"]
    get_settings.cache_clear()


@respx.mock
async def test_chat_with_target_and_sources_orders_target_before_sources(
    tmp_path, monkeypatch
):
    from app.config import get_settings
    from app.db import store, wiki_store

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    store.init_db(str(tmp_path))
    wiki_store.init_wiki(str(tmp_path))
    target_page = wiki_store.create_page(
        "Torque Specs", None, "torque is 22 Nm", "owner"
    )
    source_page = wiki_store.create_page(
        "Reference", None, "reference detail", "owner"
    )

    route = respx.post(UPSTREAM).respond(
        status_code=200,
        headers={"content-type": "text/event-stream"},
        content=UPSTREAM_SSE,
    )
    async with client() as c:
        resp = await c.post("/api/chat", json={
            "messages": [{"role": "user", "content": "edit it"}],
            "target_page_id": target_page["id"],
            "wiki_page_ids": [source_page["id"]],
        })
    events = parse_events(resp.text)
    first = json.loads(events[0])
    second = json.loads(events[1])
    assert first["type"] == "target"
    assert second["type"] == "sources"

    sent = json.loads(route.calls[0].request.content)
    assert "Torque Specs" in sent["messages"][0]["content"]
    assert "reference detail" in sent["messages"][1]["content"]
    get_settings.cache_clear()


@respx.mock
async def test_chat_with_unknown_target_emits_error_and_skips_upstream(
    tmp_path, monkeypatch
):
    from app.config import get_settings
    from app.db import store, wiki_store

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    store.init_db(str(tmp_path))
    wiki_store.init_wiki(str(tmp_path))

    route = respx.post(UPSTREAM).respond(
        status_code=200,
        headers={"content-type": "text/event-stream"},
        content=UPSTREAM_SSE,
    )
    async with client() as c:
        resp = await c.post("/api/chat", json={
            "messages": [{"role": "user", "content": "edit it"}],
            "target_page_id": 9999,
        })
    events = parse_events(resp.text)
    err = json.loads(events[0])
    assert err["type"] == "error"
    assert err["code"] == "unknown_target"
    assert events[-1] == "[DONE]"
    assert route.called is False
    get_settings.cache_clear()


@respx.mock
async def test_tools_enabled_injects_system_prompt(tmp_path, monkeypatch):
    from app.config import get_settings
    from app.db import store
    from app.services import actions

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("OWNER_TOKEN", "sekrit")
    get_settings.cache_clear()
    store.init_db(str(tmp_path))

    route = respx.post(UPSTREAM).respond(
        status_code=200,
        headers={"content-type": "text/event-stream"},
        content=UPSTREAM_SSE,
    )
    async with client() as c:
        resp = await c.post("/api/chat", json={
            "messages": [{"role": "user", "content": "create a page"}],
            "tools_enabled": True,
            "owner_token": "sekrit",
        })
    assert resp.status_code == 200
    sent = json.loads(route.calls[0].request.content)
    prompt = sent["messages"][0]["content"]
    assert "wiki-create-page" in prompt
    assert "collection-create" in prompt
    # wiki-update is markdown handled by the edit/proposal flow, not a JSON tool.
    assert "```wiki-update" not in prompt
    get_settings.cache_clear()


@respx.mock
async def test_tools_disabled_no_system_prompt():
    route = respx.post(UPSTREAM).respond(
        status_code=200,
        headers={"content-type": "text/event-stream"},
        content=UPSTREAM_SSE,
    )
    async with client() as c:
        resp = await c.post("/api/chat", json={
            "messages": [{"role": "user", "content": "hi"}],
        })
    assert resp.status_code == 200
    sent = json.loads(route.calls[0].request.content)
    for msg in sent["messages"]:
        assert "wiki-create-page" not in msg.get("content", "")
        assert "collection-create" not in msg.get("content", "")
        assert "wiki-update" not in msg.get("content", "")


@respx.mock
async def test_wiki_create_page_fence_is_not_executed_server_side(tmp_path, monkeypatch):
    # A `wiki-create-page` fence is a draft the frontend renders as a reviewable
    # card; the page is only written when the user saves or proposes it. The chat
    # turn itself must not create anything, even for the owner.
    from app.config import get_settings
    from app.db import store, wiki_store

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("OWNER_TOKEN", "sekrit")
    get_settings.cache_clear()
    store.init_db(str(tmp_path))
    wiki_store.init_wiki(str(tmp_path))

    WIKI_CREATE_SSE = (
        b'data: {"id":"1","choices":[{"delta":{"content":'
        b'"Creating page...\\n\\n```wiki-create-page\\n'
        b'{\\"title\\": \\"Reading List\\", \\"content\\": \\"books\\"}\\n```"}}]}\n\n'
        b'data: {"id":"1","choices":[{"delta":{}}]}\n\n'
        b"data: [DONE]\n\n"
    )
    respx.post(UPSTREAM).respond(
        status_code=200,
        headers={"content-type": "text/event-stream"},
        content=WIKI_CREATE_SSE,
    )
    async with client() as c:
        resp = await c.post("/api/chat", json={
            "messages": [{"role": "user", "content": "create a reading list page"}],
            "tools_enabled": True,
            "owner_token": "sekrit",
        })
    events = parse_events(resp.text)
    action_events = [
        json.loads(e) for e in events[:-1]
        if json.loads(e).get("type") == "action"
    ]
    assert action_events == []
    assert wiki_store.list_pages() == []
    get_settings.cache_clear()


@respx.mock
async def test_tools_enabled_collection_action(tmp_path, monkeypatch):
    from app.config import get_settings
    from app.db import store

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("OWNER_TOKEN", "sekrit")
    get_settings.cache_clear()
    store.init_db(str(tmp_path))

    COL_CREATE_SSE = (
        b'data: {"id":"1","choices":[{"delta":{"content":'
        b'"Done.\\n\\n```collection-create\\n'
        b'{\\"name\\": \\"Engine Specs\\"}\\n```"}}]}\n\n'
        b'data: {"id":"1","choices":[{"delta":{}}]}\n\n'
        b"data: [DONE]\n\n"
    )
    respx.post(UPSTREAM).respond(
        status_code=200,
        headers={"content-type": "text/event-stream"},
        content=COL_CREATE_SSE,
    )
    async with client() as c:
        resp = await c.post("/api/chat", json={
            "messages": [{"role": "user", "content": "create a collection"}],
            "tools_enabled": True,
            "owner_token": "sekrit",
        })
    events = parse_events(resp.text)
    action_events = [
        json.loads(e) for e in events[:-1]
        if json.loads(e).get("type") == "action"
    ]
    assert len(action_events) == 1
    assert action_events[0]["action"] == "collection-create"
    assert action_events[0]["result"]["name"] == "Engine Specs"

    cols = store.list_collections()
    assert len(cols) == 1
    assert cols[0]["name"] == "Engine Specs"
    get_settings.cache_clear()


@respx.mock
async def test_tools_enabled_owner_gated_action_fails_without_token(tmp_path, monkeypatch):
    from app.config import get_settings
    from app.db import store

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("OWNER_TOKEN", "sekrit")
    get_settings.cache_clear()
    store.init_db(str(tmp_path))

    COL_CREATE_SSE = (
        b'data: {"id":"1","choices":[{"delta":{"content":'
        b'"```collection-create\\n'
        b'{\\"name\\": \\"X\\"}\\n```"}}]}\n\n'
        b'data: {"id":"1","choices":[{"delta":{}}]}\n\n'
        b"data: [DONE]\n\n"
    )
    respx.post(UPSTREAM).respond(
        status_code=200,
        headers={"content-type": "text/event-stream"},
        content=COL_CREATE_SSE,
    )
    async with client() as c:
        resp = await c.post("/api/chat", json={
            "messages": [{"role": "user", "content": "create a collection"}],
            "tools_enabled": True,
            "owner_token": "",
        })
    events = parse_events(resp.text)
    action_events = [
        json.loads(e) for e in events[:-1]
        if json.loads(e).get("type") == "action"
    ]
    assert len(action_events) == 1
    assert action_events[0]["action"] == "collection-create"
    assert "error" in action_events[0]
    assert "Owner token required" in action_events[0]["error"]
    assert store.list_collections() == []
    get_settings.cache_clear()


@respx.mock
async def test_tools_enabled_no_fences_gives_no_action_events(tmp_path, monkeypatch):
    from app.config import get_settings
    from app.db import store

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    store.init_db(str(tmp_path))

    respx.post(UPSTREAM).respond(
        status_code=200,
        headers={"content-type": "text/event-stream"},
        content=UPSTREAM_SSE,
    )
    async with client() as c:
        resp = await c.post("/api/chat", json={
            "messages": [{"role": "user", "content": "hi"}],
            "tools_enabled": True,
        })
    events = parse_events(resp.text)
    action_events = [e for e in events if '"type":"action"' in e]
    assert len(action_events) == 0
    assert events[-1] == "[DONE]"
    get_settings.cache_clear()


import pytest

from app.config import get_settings

FIRECRAWL = "https://api.firecrawl.dev/v2/search"

FIRECRAWL_OK = {
    "success": True,
    "data": {
        "web": [
            {
                "url": "https://example.test/a",
                "title": "Article A",
                "description": "blurb",
                "markdown": "Full body A.",
            }
        ]
    },
}


@pytest.fixture
def owner_env(tmp_path, monkeypatch):
    from app.db import store

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("OWNER_TOKEN", "sekret")
    monkeypatch.setenv("FIRECRAWL_API_KEY", "fc-key")
    get_settings.cache_clear()
    store.init_db(str(tmp_path))
    yield
    get_settings.cache_clear()


@respx.mock
async def test_web_search_on_emits_search_event_and_web_source(owner_env):
    respx.post(FIRECRAWL).respond(json=FIRECRAWL_OK)
    respx.post(UPSTREAM).respond(
        status_code=200,
        headers={"content-type": "text/event-stream"},
        content=UPSTREAM_SSE,
    )
    async with client() as c:
        resp = await c.post(
            "/api/chat",
            json={
                "messages": [{"role": "user", "content": "What is sqlite-vec?"}],
                "web_search": "on",
                "owner_token": "sekret",
            },
        )
    events = [json.loads(e) for e in parse_events(resp.text) if e != "[DONE]"]
    search_events = [e for e in events if e["type"] == "search"]
    source_events = [e for e in events if e["type"] == "sources"]

    assert search_events[0]["query"] == "What is sqlite-vec?"
    assert search_events[0]["results"] == [
        {"url": "https://example.test/a", "title": "Article A"}
    ]
    assert source_events[0]["sources"][0]["kind"] == "web"
    assert source_events[0]["sources"][0]["url"] == "https://example.test/a"
    # The search event must arrive before any sources event.
    assert events.index(search_events[0]) < events.index(source_events[0])


@respx.mock
async def test_web_search_without_owner_token_is_ignored(owner_env):
    route = respx.post(FIRECRAWL).respond(json=FIRECRAWL_OK)
    respx.post(UPSTREAM).respond(
        status_code=200,
        headers={"content-type": "text/event-stream"},
        content=UPSTREAM_SSE,
    )
    async with client() as c:
        resp = await c.post(
            "/api/chat",
            json={
                "messages": [{"role": "user", "content": "What is sqlite-vec?"}],
                "web_search": "on",
            },
        )
    events = [json.loads(e) for e in parse_events(resp.text) if e != "[DONE]"]
    assert route.call_count == 0
    assert not [e for e in events if e["type"] == "search"]
    assert "Hello!" in "".join(
        e["text"] for e in events if e["type"] == "text-delta"
    )


@respx.mock
async def test_quota_exhaustion_degrades_to_an_answer_with_a_typed_error(owner_env):
    respx.post(FIRECRAWL).respond(status_code=402, json={"error": "no credits"})
    respx.post(UPSTREAM).respond(
        status_code=200,
        headers={"content-type": "text/event-stream"},
        content=UPSTREAM_SSE,
    )
    async with client() as c:
        resp = await c.post(
            "/api/chat",
            json={
                "messages": [{"role": "user", "content": "What is sqlite-vec?"}],
                "web_search": "on",
                "owner_token": "sekret",
            },
        )
    events = [json.loads(e) for e in parse_events(resp.text) if e != "[DONE]"]
    errors = [e for e in events if e["type"] == "error"]
    assert errors[0]["code"] == "search_quota_exhausted"
    # The turn still answers — a search failure never kills the stream.
    assert [e for e in events if e["type"] == "text-delta"]


@respx.mock
async def test_auto_mode_searches_only_when_the_model_calls_the_tool(owner_env):
    search_route = respx.post(FIRECRAWL).respond(json=FIRECRAWL_OK)
    respx.post(UPSTREAM).mock(
        side_effect=[
            httpx.Response(
                200,
                json={
                    "choices": [
                        {
                            "message": {
                                "role": "assistant",
                                "content": None,
                                "tool_calls": [
                                    {
                                        "id": "call_1",
                                        "type": "function",
                                        "function": {
                                            "name": "web_search",
                                            "arguments": '{"query": "sqlite-vec"}',
                                        },
                                    }
                                ],
                            }
                        }
                    ]
                },
            ),
            httpx.Response(
                200,
                headers={"content-type": "text/event-stream"},
                content=UPSTREAM_SSE,
            ),
        ]
    )
    async with client() as c:
        resp = await c.post(
            "/api/chat",
            json={
                "messages": [{"role": "user", "content": "anything"}],
                "web_search": "auto",
                "owner_token": "sekret",
            },
        )
    events = [json.loads(e) for e in parse_events(resp.text) if e != "[DONE]"]
    assert search_route.call_count == 1
    assert [e for e in events if e["type"] == "search"][0]["query"] == "sqlite-vec"


@respx.mock
async def test_auto_mode_streams_directly_when_no_tool_call(owner_env):
    search_route = respx.post(FIRECRAWL).respond(json=FIRECRAWL_OK)
    respx.post(UPSTREAM).mock(
        side_effect=[
            httpx.Response(
                200,
                json={"choices": [{"message": {"role": "assistant", "content": "no need"}}]},
            ),
            httpx.Response(
                200,
                headers={"content-type": "text/event-stream"},
                content=UPSTREAM_SSE,
            ),
        ]
    )
    async with client() as c:
        resp = await c.post(
            "/api/chat",
            json={
                "messages": [{"role": "user", "content": "hello"}],
                "web_search": "auto",
                "owner_token": "sekret",
            },
        )
    events = [json.loads(e) for e in parse_events(resp.text) if e != "[DONE]"]
    assert search_route.call_count == 0
    assert not [e for e in events if e["type"] == "search"]
    assert [e for e in events if e["type"] == "text-delta"]
