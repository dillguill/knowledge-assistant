"""Starting a run and letting it outlive the request that asked for it.

`asyncio.create_task` on the same event loop — no worker process, no queue,
matching the single-instance Space. Closing the browser does not kill the run.
"""

import asyncio
import logging

from pydantic import ValidationError

from app.harness import events, runner, runs, tools
from app.services import sync

log = logging.getLogger(__name__)

# Strong references, keyed by run id. The event loop only holds a weak one, so
# a task not kept here can be garbage-collected mid-run; keying by run id is
# also what lets `cancel` find the task to stop.
_tasks: dict[int, asyncio.Task] = {}


class InvalidInput(Exception):
    """The submitted input did not match the skill's declared input model."""


def build_registry() -> tools.ToolRegistry:
    """The tools a run may call. PR 3 fills this in with the real builtins."""
    return tools.ToolRegistry()


async def start(skill, inputs: dict, model: str | None, owner: bool) -> dict:
    """Validate, create the run row, detach the work, return immediately.

    Input validation happens BEFORE the row exists so a malformed submission
    leaves no failed run cluttering history — and, more importantly, does not
    consume the one-active-run slot.
    """
    try:
        validated = skill.input_model.model_validate(inputs)
    except ValidationError as exc:
        raise InvalidInput(str(exc)) from exc

    payload = validated.model_dump()
    run = runs.create_run(skill.name, skill.scheduler.name, model, payload)
    task = asyncio.create_task(execute(skill, run, payload, owner))
    _tasks[run["id"]] = task
    task.add_done_callback(lambda _t: _tasks.pop(run["id"], None))
    return run


async def execute(skill, run: dict, inputs: dict, owner: bool) -> None:
    """The detached body. Every exit path writes a terminal row — an exception
    escaping here would vanish into the loop's handler and leave the row at
    'running' until the next boot's sweep."""
    run_id = run["id"]
    runs.start_run(run_id)
    events.publish(run_id, {"type": "run-start", "run_id": run_id, "skill": skill.name})
    ctx = runner.RunContext(
        run_id=run_id, model=run["model"], owner=owner,
        inputs=inputs, registry=build_registry(),
    )
    try:
        output = await skill.scheduler.run(ctx)
        runs.finish_run(run_id, output or {})
        events.publish(
            run_id, {"type": "run-done", "run_id": run_id, "output": output or {}}
        )
    except runner.StepFailure as exc:
        runs.fail_run(run_id, exc.code, exc.message)
        event = {"type": "error", "code": exc.code, "message": exc.message}
        if exc.retry_after is not None:
            event["retry_after"] = exc.retry_after
        events.publish(run_id, event)
    except asyncio.CancelledError:
        # CancelledError is a BaseException, so the broad `except Exception`
        # below would NOT catch it — without this the run row would be left at
        # 'running' until the next boot's sweep. Re-raised after recording, so
        # asyncio still sees a properly cancelled task.
        runs.cancel_run(run_id)
        events.publish(run_id, {"type": "error", "code": "cancelled",
                                "message": "The run was cancelled."})
        raise
    except Exception as exc:
        log.exception("run %s failed unexpectedly", run_id)
        runs.fail_run(run_id, "internal_error", str(exc))
        events.publish(
            run_id,
            {"type": "error", "code": "internal_error", "message": "The run failed."},
        )
    finally:
        events.close(run_id)
        # Once, at the terminal state: the 30s debounce means pushing per-step
        # would churn the dataset repo for no gain, but a finished run that is
        # never pushed is lost to the next restart.
        sync.schedule_push()


async def drain() -> None:
    """Await every in-flight run. Test helper; also useful for a clean shutdown."""
    while _tasks:
        await asyncio.gather(*list(_tasks.values()), return_exceptions=True)


def cancel(run_id: int) -> bool:
    """Stop an in-flight run. Returns False when there is nothing to stop.

    The row is written by `execute`'s CancelledError handler rather than here,
    so cancellation records itself through the same path whether it is
    requested or arrives some other way.
    """
    task = _tasks.get(run_id)
    if task is None or task.done():
        return False
    task.cancel()
    return True
