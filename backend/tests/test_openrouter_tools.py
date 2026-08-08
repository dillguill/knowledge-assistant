import json

import httpx
import pytest
import respx

UPSTREAM = "https://openrouter.ai/api/v1/chat/completions"

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "Search the web.",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
            },
        },
    }
]


@respx.mock
async def test_complete_with_tools_returns_tool_call_message():
    from app.services import openrouter

    respx.post(UPSTREAM).respond(
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
        }
    )
    message = await openrouter.complete_with_tools(
        None, [{"role": "user", "content": "hi"}], TOOLS
    )
    assert message["tool_calls"][0]["function"]["name"] == "web_search"


@respx.mock
async def test_complete_with_tools_sends_tools_in_payload():
    from app.services import openrouter

    route = respx.post(UPSTREAM).respond(
        json={"choices": [{"message": {"role": "assistant", "content": "plain"}}]}
    )
    await openrouter.complete_with_tools(None, [{"role": "user", "content": "hi"}], TOOLS)

    payload = json.loads(route.calls.last.request.content)
    assert payload["tools"] == TOOLS
    assert payload["tool_choice"] == "auto"
    assert payload["stream"] is False


@respx.mock
async def test_complete_with_tools_raises_rate_limited():
    from app.services import openrouter

    respx.post(UPSTREAM).respond(status_code=429, headers={"Retry-After": "12"})
    with pytest.raises(openrouter.RateLimitedError) as exc:
        await openrouter.complete_with_tools(None, [{"role": "user", "content": "x"}], TOOLS)
    assert exc.value.retry_after == 12


@respx.mock
async def test_list_free_models_exposes_supported_parameters():
    from app.services import openrouter

    openrouter.clear_model_cache()
    respx.get("https://openrouter.ai/api/v1/models").respond(
        json={
            "data": [
                {
                    "id": "vendor/tool-model:free",
                    "name": "Tool Model",
                    "context_length": 8192,
                    "supported_parameters": ["tools", "tool_choice"],
                },
                {
                    "id": "vendor/plain-model:free",
                    "name": "Plain Model",
                    "context_length": 4096,
                },
            ]
        }
    )
    models = await openrouter.list_free_models()
    openrouter.clear_model_cache()

    by_id = {m["id"]: m for m in models}
    assert by_id["vendor/tool-model:free"]["supported_parameters"] == ["tools", "tool_choice"]
    assert by_id["vendor/plain-model:free"]["supported_parameters"] == []


@respx.mock
async def test_a_non_json_200_becomes_an_upstream_error():
    from app.services import openrouter

    respx.post(UPSTREAM).respond(status_code=200, content=b"<html>gateway</html>")
    # A 200 carrying HTML must not escape as a raw JSON decode error, which
    # would kill the chat stream instead of degrading it.
    with pytest.raises(openrouter.UpstreamError):
        await openrouter.complete(None, [{"role": "user", "content": "hi"}])


@respx.mock
async def test_a_transport_error_becomes_an_upstream_error():
    from app.services import openrouter

    respx.post(UPSTREAM).mock(side_effect=httpx.ConnectTimeout("timed out"))
    with pytest.raises(openrouter.UpstreamError):
        await openrouter.complete(None, [{"role": "user", "content": "hi"}])
