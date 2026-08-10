import asyncio

import pytest
from pydantic import BaseModel

from app.config import get_settings
from app.db import store


class Inputs(BaseModel):
    topic: str


@pytest.fixture(autouse=True)
def executor_env(tmp_path, monkeypatch):
    from app.harness import runs

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    store.init_db(str(tmp_path))
    runs.init_runs(str(tmp_path))
    yield
    get_settings.cache_clear()


def _skill(scheduler):
    from app.skills import Skill

    return Skill(
        name="demo", label="Demo", description="",
        input_model=Inputs, scheduler=scheduler, estimated_calls=lambda i: 1,
    )


class _Scheduler:
    name = "pipeline"

    def __init__(self, fn):
        self.fn = fn

    async def run(self, ctx):
        return await self.fn(ctx)


async def test_start_returns_immediately_and_the_run_completes():
    from app.harness import executor, runs

    started = asyncio.Event()

    async def work(ctx):
        await started.wait()
        return {"ok": True}

    run = await executor.start(_skill(_Scheduler(work)), {"topic": "x"}, "m:free", owner=True)
    assert run["status"] == "queued"

    started.set()
    await executor.drain()
    assert runs.get_run(run["id"])["status"] == "succeeded"
    assert runs.get_run(run["id"])["output"] == {"ok": True}


async def test_the_task_reference_is_held_for_the_whole_run():
    # A bare create_task can be garbage-collected mid-flight; the run would
    # simply stop with the row left at 'running'.
    from app.harness import executor

    gate = asyncio.Event()

    async def work(ctx):
        await gate.wait()
        return {}

    await executor.start(_skill(_Scheduler(work)), {"topic": "x"}, None, owner=True)
    assert len(executor._tasks) == 1
    gate.set()
    await executor.drain()
    assert executor._tasks == {}


async def test_a_step_failure_is_recorded_with_its_code():
    from app.harness import executor, runner, runs

    async def work(ctx):
        raise runner.StepFailure("rate_limited", "wait 30s", retry_after=30)

    run = await executor.start(_skill(_Scheduler(work)), {"topic": "x"}, None, owner=True)
    await executor.drain()

    failed = runs.get_run(run["id"])
    assert failed["status"] == "failed"
    assert failed["error_code"] == "rate_limited"
    assert failed["error_message"] == "wait 30s"


async def test_an_unexpected_exception_still_writes_a_terminal_row():
    # Otherwise it vanishes into the loop's exception handler and the row sits
    # at 'running' until the next boot sweeps it.
    from app.harness import executor, runs

    async def work(ctx):
        raise ZeroDivisionError("oops")

    run = await executor.start(_skill(_Scheduler(work)), {"topic": "x"}, None, owner=True)
    await executor.drain()

    assert runs.get_run(run["id"])["error_code"] == "internal_error"


async def test_invalid_input_is_rejected_before_a_run_row_exists():
    from app.harness import executor, runs

    async def work(ctx):
        return {}

    with pytest.raises(executor.InvalidInput):
        await executor.start(_skill(_Scheduler(work)), {"nope": 1}, None, owner=True)
    assert runs.list_runs() == []


async def test_a_second_concurrent_run_is_rejected_cleanly():
    from app.harness import executor, runs

    gate = asyncio.Event()

    async def work(ctx):
        await gate.wait()
        return {}

    await executor.start(_skill(_Scheduler(work)), {"topic": "x"}, None, owner=True)
    with pytest.raises(runs.ActiveRunExists):
        await executor.start(_skill(_Scheduler(work)), {"topic": "y"}, None, owner=True)
    gate.set()
    await executor.drain()


async def test_the_run_record_is_pushed_once_the_run_is_terminal(monkeypatch):
    from app.harness import executor
    from app.services import sync

    pushes = []
    monkeypatch.setattr(sync, "schedule_push", lambda *a, **k: pushes.append(1))

    async def work(ctx):
        return {}

    await executor.start(_skill(_Scheduler(work)), {"topic": "x"}, None, owner=True)
    await executor.drain()
    assert pushes == [1]


async def test_the_stream_is_closed_when_the_run_ends():
    from app.harness import events, executor

    async def work(ctx):
        return {"done": True}

    run = await executor.start(_skill(_Scheduler(work)), {"topic": "x"}, None, owner=True)
    queue = events.subscribe(run["id"])
    await executor.drain()
    seen = []
    while not queue.empty():
        seen.append(queue.get_nowait())
    assert seen[-1] is events.DONE
    assert any(e is not events.DONE and e["type"] == "run-done" for e in seen)


async def test_the_run_context_carries_the_validated_input_and_owner_flag():
    from app.harness import executor

    captured = {}

    async def work(ctx):
        captured["inputs"] = ctx.inputs
        captured["owner"] = ctx.owner
        captured["model"] = ctx.model
        return {}

    await executor.start(_skill(_Scheduler(work)), {"topic": "sqlite"}, "m:free", owner=False)
    await executor.drain()

    assert captured["inputs"] == {"topic": "sqlite"}
    assert captured["owner"] is False
    assert captured["model"] == "m:free"


async def test_cancelling_stops_the_run_and_records_it():
    from app.harness import executor, runs

    started = asyncio.Event()

    async def work(ctx):
        started.set()
        await asyncio.sleep(60)  # never completes on its own
        return {}

    run = await executor.start(_skill(_Scheduler(work)), {"topic": "x"}, None, owner=True)
    await started.wait()

    assert executor.cancel(run["id"]) is True
    await executor.drain()

    # CancelledError is a BaseException — without an explicit handler in
    # execute() this row would still say 'running'.
    assert runs.get_run(run["id"])["status"] == "cancelled"
    assert executor._tasks == {}


async def test_cancelling_an_unknown_or_finished_run_reports_false():
    from app.harness import executor, runs

    async def work(ctx):
        return {}

    assert executor.cancel(999) is False

    run = await executor.start(_skill(_Scheduler(work)), {"topic": "x"}, None, owner=True)
    await executor.drain()
    # Already terminal: nothing to cancel, and the record must not be rewritten.
    assert executor.cancel(run["id"]) is False
    assert runs.get_run(run["id"])["status"] == "succeeded"


async def test_a_cancelled_run_closes_its_stream():
    from app.harness import events, executor

    started = asyncio.Event()

    async def work(ctx):
        started.set()
        await asyncio.sleep(60)
        return {}

    run = await executor.start(_skill(_Scheduler(work)), {"topic": "x"}, None, owner=True)
    queue = events.subscribe(run["id"])
    await started.wait()
    executor.cancel(run["id"])
    await executor.drain()

    seen = []
    while not queue.empty():
        seen.append(queue.get_nowait())
    # The `finally` in execute() must still run on cancellation.
    assert seen[-1] is events.DONE
    assert any(e is not events.DONE and e.get("code") == "cancelled" for e in seen)


async def test_cancelling_frees_the_slot_for_a_new_run():
    from app.harness import executor

    started = asyncio.Event()

    async def blocking(ctx):
        started.set()
        await asyncio.sleep(60)
        return {}

    async def quick(ctx):
        return {}

    first = await executor.start(_skill(_Scheduler(blocking)), {"topic": "x"}, None, owner=True)
    await started.wait()
    executor.cancel(first["id"])
    await executor.drain()

    assert await executor.start(_skill(_Scheduler(quick)), {"topic": "y"}, None, owner=True)
    await executor.drain()


async def test_a_run_records_the_model_that_will_actually_serve_it():
    """The frontend sends null when no model is picked, but a model still runs
    — the default. Recording null leaves run history unable to say what
    produced the output, and v0.8.0's per-model breakdown with a hole in it.
    """
    from app.config import get_settings
    from app.harness import executor, runs

    async def work(ctx):
        return {"model_seen": ctx.model}

    run = await executor.start(_skill(_Scheduler(work)), {"topic": "x"}, None, owner=True)
    await executor.drain()

    expected = get_settings().default_model
    assert runs.get_run(run["id"])["model"] == expected
    # The context agrees with the record, so the row is not merely decorative.
    assert runs.get_run(run["id"])["output"] == {"model_seen": expected}


async def test_an_explicit_model_is_recorded_unchanged():
    from app.harness import executor, runs

    async def work(ctx):
        return {}

    run = await executor.start(
        _skill(_Scheduler(work)), {"topic": "x"}, "explicit/model:free", owner=True
    )
    await executor.drain()
    assert runs.get_run(run["id"])["model"] == "explicit/model:free"
