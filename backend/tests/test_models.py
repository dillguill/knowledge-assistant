import httpx
import respx

from app.main import create_app
from app.services import openrouter

UPSTREAM = "https://openrouter.ai/api/v1/models"

PAYLOAD = {
    "data": [
        {"id": "qwen/qwen3-4b:free", "name": "Qwen3 4B (free)", "context_length": 32768},
        {"id": "openai/gpt-4o", "name": "GPT-4o", "context_length": 128000},
        {"id": "meta-llama/llama-4:free", "name": "Llama 4 (free)", "context_length": 65536},
    ]
}


def client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_app()), base_url="http://test"
    )


@respx.mock
async def test_models_filters_to_free_and_sorts():
    openrouter.clear_model_cache()
    respx.get(UPSTREAM).respond(json=PAYLOAD)
    async with client() as c:
        resp = await c.get("/api/models")
    assert resp.status_code == 200
    models = resp.json()["models"]
    assert [m["id"] for m in models] == [
        "meta-llama/llama-4:free",
        "qwen/qwen3-4b:free",
    ]
    assert models[0]["context_length"] == 65536


@respx.mock
async def test_models_caches_upstream():
    openrouter.clear_model_cache()
    route = respx.get(UPSTREAM).respond(json=PAYLOAD)
    async with client() as c:
        await c.get("/api/models")
        await c.get("/api/models")
    assert route.call_count == 1


@respx.mock
async def test_models_upstream_failure_returns_502():
    openrouter.clear_model_cache()
    respx.get(UPSTREAM).respond(status_code=500)
    async with client() as c:
        resp = await c.get("/api/models")
    assert resp.status_code == 502
    assert resp.json()["detail"]["code"] == "upstream_error"
