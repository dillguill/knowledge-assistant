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
async def test_chat_with_unknown_target_emits_error_and_skips_upstream():
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
