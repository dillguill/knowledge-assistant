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


async def test_chat_rejects_empty_messages():
    async with client() as c:
        resp = await c.post("/api/chat", json={"messages": []})
    assert resp.status_code == 422
