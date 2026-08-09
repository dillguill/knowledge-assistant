import pytest


def _registry():
    from app.harness import tools

    registry = tools.ToolRegistry()

    async def echo(text: str = "") -> dict:
        return tools.ok({"echoed": text})

    async def boom() -> dict:
        raise RuntimeError("handler blew up")

    registry.register(tools.Tool(
        name="echo", description="Echo text.",
        parameters={"type": "object", "properties": {"text": {"type": "string"}}},
        handler=echo,
    ))
    registry.register(tools.Tool(
        name="secret", description="Owner only.",
        parameters={"type": "object", "properties": {}},
        handler=echo, owner_only=True,
    ))
    registry.register(tools.Tool(
        name="boom", description="Always fails.",
        parameters={"type": "object", "properties": {}},
        handler=boom,
    ))
    return registry


def test_definitions_are_openrouter_shaped():
    registry = _registry()
    definitions = registry.definitions(owner=True)
    echo = next(d for d in definitions if d["function"]["name"] == "echo")
    assert echo["type"] == "function"
    assert echo["function"]["description"] == "Echo text."
    assert echo["function"]["parameters"]["properties"]["text"]["type"] == "string"


def test_owner_only_tools_are_hidden_from_visitors():
    registry = _registry()
    names = {d["function"]["name"] for d in registry.definitions(owner=False)}
    assert "secret" not in names
    assert "echo" in names


async def test_dispatch_returns_a_typed_result():
    registry = _registry()
    assert await registry.dispatch("echo", {"text": "hi"}, owner=False) == {
        "ok": True, "data": {"echoed": "hi"}
    }


async def test_dispatch_refuses_an_owner_only_tool_even_if_the_model_names_it():
    registry = _registry()
    result = await registry.dispatch("secret", {}, owner=False)
    assert result["ok"] is False
    assert result["error"]["code"] == "not_permitted"


async def test_dispatch_reports_an_unknown_tool_rather_than_raising():
    registry = _registry()
    result = await registry.dispatch("nope", {}, owner=True)
    assert result["error"]["code"] == "unknown_tool"


async def test_a_raising_handler_becomes_a_typed_error():
    # An exception escaping into the runner would fail the whole run; a tool
    # failure is supposed to be something the model sees and continues past.
    registry = _registry()
    result = await registry.dispatch("boom", {}, owner=True)
    assert result["ok"] is False
    assert result["error"]["code"] == "tool_error"
    assert "handler blew up" in result["error"]["message"]


async def test_bad_arguments_are_a_typed_error_not_a_crash():
    # Arguments come from model output, so the wrong shape is expected traffic.
    registry = _registry()
    result = await registry.dispatch("echo", {"unexpected": 1}, owner=True)
    assert result["ok"] is False
    assert result["error"]["code"] == "bad_arguments"


async def test_non_dict_arguments_are_a_typed_error():
    registry = _registry()
    result = await registry.dispatch("echo", ["not", "a", "dict"], owner=True)
    assert result["error"]["code"] == "bad_arguments"


def test_registering_a_duplicate_name_is_refused():
    from app.harness import tools

    registry = _registry()
    with pytest.raises(ValueError):
        registry.register(tools.Tool(
            name="echo", description="dup", parameters={},
            handler=_registry().get("echo").handler,
        ))
