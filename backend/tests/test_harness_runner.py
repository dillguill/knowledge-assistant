import pytest
from pydantic import BaseModel, ConfigDict, Field

from app.config import get_settings
from app.db import store


class Plan(BaseModel):
    model_config = ConfigDict(extra="forbid")
    questions: list[str] = Field(min_length=1, max_length=6)


@pytest.fixture(autouse=True)
def runner_env(tmp_path, monkeypatch):
    from app.harness import runs

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    store.init_db(str(tmp_path))
    runs.init_runs(str(tmp_path))
    yield
    get_settings.cache_clear()


def _context(monkeypatch, replies, **kwargs):
    """A RunContext wired to a scripted model. Tests never call live models."""
    from app.harness import runner, runs, tools
    from app.services import openrouter

    scripted = list(replies)

    async def fake_complete_message(model, messages, *, tools=None, response_format=None):
        reply = scripted.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply, {"prompt_tokens": 7, "completion_tokens": 3}

    monkeypatch.setattr(openrouter, "complete_message", fake_complete_message)
    run = runs.create_run("t", "pipeline", "m:free", {})
    ctx = runner.RunContext(
        run_id=run["id"], model="m:free", owner=True, inputs={},
        registry=tools.ToolRegistry(), **kwargs,
    )
    return ctx, scripted


async def test_a_step_records_a_row_and_its_metrics(monkeypatch):
    from app.harness import contracts, runs

    ctx, _ = _context(monkeypatch, [{"content": '{"questions": ["a"]}'}])
    async with ctx.step("plan"):
        plan = await ctx.call_model(
            [{"role": "user", "content": "go"}], contracts.JsonContract(Plan)
        )
    assert plan.questions == ["a"]

    step = runs.list_steps(ctx.run_id)[0]
    assert step["name"] == "plan"
    assert step["status"] == "succeeded"
    assert step["model"] == "m:free"
    assert step["tokens_in"] == 7
    assert step["tokens_out"] == 3
    assert step["latency_ms"] is not None


async def test_a_step_with_no_model_call_still_gets_a_row(monkeypatch):
    # `gather` makes zero model calls; a missing row would make the timeline
    # skip a step the user is waiting on.
    from app.harness import runs

    ctx, _ = _context(monkeypatch, [])
    async with ctx.step("gather"):
        pass
    assert [s["name"] for s in runs.list_steps(ctx.run_id)] == ["gather"]
    assert runs.list_steps(ctx.run_id)[0]["model"] is None


async def test_a_contract_failure_is_retried_then_fails_the_step(monkeypatch):
    from app.harness import contracts, runner, runs

    ctx, scripted = _context(
        monkeypatch,
        [{"content": "nope"}, {"content": "still nope"}, {"content": "nope again"}],
        retries=2,
    )
    with pytest.raises(runner.StepFailure) as excinfo:
        async with ctx.step("plan"):
            await ctx.call_model([{"role": "user", "content": "go"}],
                                 contracts.JsonContract(Plan))
    assert excinfo.value.code == "contract_invalid"
    # 1 attempt + 2 retries, all three consumed.
    assert scripted == []
    assert ctx.calls_used == 3
    assert runs.list_steps(ctx.run_id)[0]["status"] == "failed"


async def test_a_retry_succeeds_and_the_step_passes(monkeypatch):
    from app.harness import contracts

    ctx, _ = _context(
        monkeypatch,
        [{"content": "I refuse"}, {"content": '{"questions": ["a", "b"]}'}],
        retries=2,
    )
    async with ctx.step("plan"):
        plan = await ctx.call_model([{"role": "user", "content": "go"}],
                                    contracts.JsonContract(Plan))
    assert plan.questions == ["a", "b"]
    assert ctx.calls_used == 2


async def test_retries_count_against_the_call_budget(monkeypatch):
    # The budget exists because the free allowance is 50 calls/day. A retry
    # that didn't count would leak exactly where the budget matters most.
    from app.harness import contracts, runner

    ctx, _ = _context(
        monkeypatch, [{"content": "no"}, {"content": "no"}], max_calls=2, retries=5
    )
    with pytest.raises(runner.StepFailure) as excinfo:
        async with ctx.step("plan"):
            await ctx.call_model([{"role": "user", "content": "go"}],
                                 contracts.JsonContract(Plan))
    assert excinfo.value.code == "budget_exceeded"
    assert ctx.calls_used == 2


async def test_a_rate_limit_fails_the_step_carrying_retry_after(monkeypatch):
    # Specific subclass before the parent: a routine 429 must not flatten into
    # a generic upstream error, and it must not auto-retry.
    from app.harness import contracts, runner
    from app.services import openrouter

    ctx, _ = _context(monkeypatch, [openrouter.RateLimitedError(retry_after=42)])
    with pytest.raises(runner.StepFailure) as excinfo:
        async with ctx.step("plan"):
            await ctx.call_model([{"role": "user", "content": "go"}],
                                 contracts.JsonContract(Plan))
    assert excinfo.value.code == "rate_limited"
    assert excinfo.value.retry_after == 42
    assert ctx.calls_used == 1


async def test_a_model_gone_error_is_distinguished_from_a_generic_outage(monkeypatch):
    from app.harness import contracts, runner
    from app.services import openrouter

    ctx, _ = _context(monkeypatch, [openrouter.ModelGoneError("m:free")])
    with pytest.raises(runner.StepFailure) as excinfo:
        async with ctx.step("plan"):
            await ctx.call_model([{"role": "user", "content": "go"}],
                                 contracts.JsonContract(Plan))
    assert excinfo.value.code == "model_gone"


async def test_a_generic_upstream_error_fails_the_step(monkeypatch):
    from app.harness import contracts, runner
    from app.services import openrouter

    ctx, _ = _context(monkeypatch, [openrouter.UpstreamError("upstream status 502")])
    with pytest.raises(runner.StepFailure) as excinfo:
        async with ctx.step("plan"):
            await ctx.call_model([{"role": "user", "content": "go"}],
                                 contracts.JsonContract(Plan))
    assert excinfo.value.code == "upstream_error"


async def test_a_tool_call_is_recorded_as_its_own_step(monkeypatch):
    from app.harness import runs, tools

    ctx, _ = _context(monkeypatch, [])

    async def hello(name: str = "") -> dict:
        return tools.ok({"hi": name})

    ctx.registry.register(tools.Tool(
        name="hello", description="", parameters={}, handler=hello,
    ))
    async with ctx.step("gather"):
        result = await ctx.call_tool("hello", {"name": "x"})

    assert result == {"ok": True, "data": {"hi": "x"}}
    names = [s["name"] for s in runs.list_steps(ctx.run_id)]
    assert names == ["gather", "tool:hello"]


async def test_a_failing_tool_records_a_failed_step_but_does_not_raise(monkeypatch):
    from app.harness import runs

    ctx, _ = _context(monkeypatch, [])
    async with ctx.step("gather"):
        result = await ctx.call_tool("missing", {})

    assert result["ok"] is False
    tool_step = [s for s in runs.list_steps(ctx.run_id) if s["name"].startswith("tool:")][0]
    assert tool_step["status"] == "failed"
    assert tool_step["error"] == "unknown_tool"


async def test_a_tool_call_does_not_lose_the_enclosing_steps_metrics(monkeypatch):
    # call_tool swaps the open step; the enclosing step must still record the
    # tokens its own model call spent.
    from app.harness import contracts, runs, tools

    ctx, _ = _context(monkeypatch, [{"content": '{"questions": ["a"]}'}])

    async def hello() -> dict:
        return tools.ok({})

    ctx.registry.register(tools.Tool(
        name="hello", description="", parameters={}, handler=hello,
    ))
    async with ctx.step("gather"):
        await ctx.call_model([{"role": "user", "content": "go"}],
                             contracts.JsonContract(Plan))
        await ctx.call_tool("hello", {})

    gather = [s for s in runs.list_steps(ctx.run_id) if s["name"] == "gather"][0]
    assert gather["tokens_out"] == 3
    assert gather["status"] == "succeeded"


async def test_step_events_are_published_with_their_ordinal(monkeypatch):
    # The stream endpoint dedupes replayed vs live events by ordinal, so an
    # event without one cannot be reconciled.
    from app.harness import events

    ctx, _ = _context(monkeypatch, [])
    queue = events.subscribe(ctx.run_id)
    async with ctx.step("plan"):
        pass
    start = await queue.get()
    done = await queue.get()
    assert (start["type"], start["name"], start["ordinal"]) == ("step-start", "plan", 1)
    assert done["type"] == "step-done"
    assert done["ordinal"] == 1
    events.unsubscribe(ctx.run_id, queue)


async def test_a_failed_step_publishes_its_failure(monkeypatch):
    from app.harness import events, runner

    ctx, _ = _context(monkeypatch, [])
    queue = events.subscribe(ctx.run_id)
    with pytest.raises(runner.StepFailure):
        async with ctx.step("plan"):
            raise runner.StepFailure("no_sources", "nothing to research from")
    await queue.get()  # step-start
    done = await queue.get()
    assert done["status"] == "failed"
    assert done["error"] == "no_sources"
    events.unsubscribe(ctx.run_id, queue)


async def test_an_unexpected_exception_still_closes_the_step_row(monkeypatch):
    from app.harness import runs

    ctx, _ = _context(monkeypatch, [])
    with pytest.raises(ZeroDivisionError):
        async with ctx.step("plan"):
            raise ZeroDivisionError("boom")

    step = runs.list_steps(ctx.run_id)[0]
    assert step["status"] == "failed"
    assert step["error"] == "ZeroDivisionError"


async def test_budget_and_retries_default_from_settings(monkeypatch):
    from app.harness import runner, runs, tools

    run = runs.create_run("t2", "pipeline", None, {})
    ctx = runner.RunContext(
        run_id=run["id"], model=None, owner=True, inputs={},
        registry=tools.ToolRegistry(),
    )
    settings = get_settings()
    assert ctx.max_calls == settings.skill_max_model_calls
    assert ctx.retries == settings.skill_contract_retries


async def test_pipeline_runs_steps_in_order_and_threads_state(monkeypatch):
    from app.harness import runner

    ctx, _ = _context(monkeypatch, [])
    order = []

    async def first(c):
        async with c.step("first"):
            order.append("first")
            c.state["value"] = 1

    async def second(c):
        async with c.step("second"):
            order.append("second")
            c.state["value"] += 1

    async def finish(c):
        return {"value": c.state["value"]}

    scheduler = runner.PipelineScheduler([first, second, finish])
    assert scheduler.name == "pipeline"
    assert await scheduler.run(ctx) == {"value": 2}
    assert order == ["first", "second"]


async def test_pipeline_stops_at_the_first_failing_step(monkeypatch):
    # No mechanism to back up, and half a research brief presented as finished
    # is worse than a visible failure.
    from app.harness import runner

    ctx, _ = _context(monkeypatch, [])
    reached = []

    async def boom(c):
        async with c.step("boom"):
            raise runner.StepFailure("contract_invalid", "bad shape")

    async def never(c):
        reached.append("never")

    with pytest.raises(runner.StepFailure):
        await runner.PipelineScheduler([boom, never]).run(ctx)
    assert reached == []


async def test_pipeline_returns_an_empty_output_when_no_step_returns_one(monkeypatch):
    from app.harness import runner

    ctx, _ = _context(monkeypatch, [])

    async def nothing(c):
        async with c.step("nothing"):
            pass

    assert await runner.PipelineScheduler([nothing]).run(ctx) == {}
