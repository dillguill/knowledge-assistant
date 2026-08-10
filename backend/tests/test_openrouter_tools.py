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


@respx.mock
async def test_complete_message_returns_usage_alongside_the_message():
    from app.services import openrouter

    route = respx.post(UPSTREAM).respond(
        json={
            "choices": [{"message": {"role": "assistant", "content": "hi"}}],
            "usage": {"prompt_tokens": 11, "completion_tokens": 5},
        }
    )

    message, usage = await openrouter.complete_message(
        "m:free", [{"role": "user", "content": "x"}]
    )

    assert message["content"] == "hi"
    assert usage == {"prompt_tokens": 11, "completion_tokens": 5}
    assert route.called


@respx.mock
async def test_complete_message_passes_response_format_and_tools():
    from app.services import openrouter

    route = respx.post(UPSTREAM).respond(
        json={"choices": [{"message": {"content": "{}"}}]}
    )

    fmt = {"type": "json_schema", "json_schema": {"name": "plan"}}
    await openrouter.complete_message(
        "m:free", [{"role": "user", "content": "x"}],
        tools=TOOLS, response_format=fmt,
    )

    sent = json.loads(route.calls[0].request.content)
    assert sent["response_format"] == fmt
    assert sent["tools"] == TOOLS
    assert sent["tool_choice"] == "auto"


@respx.mock
async def test_complete_message_omits_absent_optional_fields():
    # Sending response_format: null to a provider that doesn't accept it is a
    # 400 on some upstreams — omit rather than nullify.
    from app.services import openrouter

    route = respx.post(UPSTREAM).respond(
        json={"choices": [{"message": {"content": "hi"}}]}
    )

    await openrouter.complete_message("m:free", [{"role": "user", "content": "x"}])

    sent = json.loads(route.calls[0].request.content)
    assert "response_format" not in sent
    assert "tools" not in sent


@respx.mock
async def test_complete_message_returns_empty_usage_when_upstream_omits_it():
    from app.services import openrouter

    respx.post(UPSTREAM).respond(json={"choices": [{"message": {"content": "hi"}}]})

    _, usage = await openrouter.complete_message(
        "m:free", [{"role": "user", "content": "x"}]
    )
    assert usage == {}


@respx.mock
async def test_complete_message_still_raises_the_specific_upstream_errors():
    from app.services import openrouter

    respx.post(UPSTREAM).respond(status_code=429, headers={"Retry-After": "17"})

    with pytest.raises(openrouter.RateLimitedError) as excinfo:
        await openrouter.complete_message("m:free", [{"role": "user", "content": "x"}])
    assert excinfo.value.retry_after == 17


@respx.mock
async def test_complete_message_rejects_a_non_json_200():
    from app.services import openrouter

    respx.post(UPSTREAM).respond(status_code=200, text="<html>gateway</html>")

    with pytest.raises(openrouter.UpstreamError):
        await openrouter.complete_message("m:free", [{"role": "user", "content": "x"}])


@respx.mock
async def test_a_429_carries_the_upstream_reason_not_just_a_generic_message():
    """OpenRouter says which limit was hit. 'Wait a minute', 'wait until the
    daily quota resets', and 'this model is busy' are different instructions,
    and flattening them loses the only actionable detail."""
    from app.services import openrouter

    respx.post(UPSTREAM).respond(
        status_code=429,
        json={"error": {"message": "Rate limit exceeded: free-models-per-day"}},
    )

    with pytest.raises(openrouter.RateLimitedError) as excinfo:
        await openrouter.complete_message("m:free", [{"role": "user", "content": "x"}])
    assert "free-models-per-day" in excinfo.value.detail


@respx.mock
async def test_a_429_without_a_parseable_body_still_raises_cleanly():
    from app.services import openrouter

    respx.post(UPSTREAM).respond(status_code=429, text="<html>too many</html>")

    with pytest.raises(openrouter.RateLimitedError) as excinfo:
        await openrouter.complete_message("m:free", [{"role": "user", "content": "x"}])
    assert excinfo.value.detail == ""


@respx.mock
async def test_the_streaming_path_reports_the_same_reason():
    from app.services import openrouter

    respx.post(UPSTREAM).respond(
        status_code=429, json={"error": {"message": "free-models-per-min"}}
    )

    with pytest.raises(openrouter.RateLimitedError) as excinfo:
        async for _ in openrouter.stream_chat("m:free", [{"role": "user", "content": "x"}]):
            pass
    assert "free-models-per-min" in excinfo.value.detail
