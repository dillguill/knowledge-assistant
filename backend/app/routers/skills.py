"""Skills API: list, start, inspect, cancel, and watch runs.

Every endpoint is owner-gated. Runs spend a shared free-tier model allowance
on a publicly reachable server; there is nothing here for a visitor.
"""

import json
from typing import AsyncIterator

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

import app.skills.research_brief  # noqa: F401  (registers the shipped skill)
from app import skills
from app.auth import require_owner
from app.harness import events, executor, runs

router = APIRouter(prefix="/api/skills", dependencies=[Depends(require_owner)])


class RunRequest(BaseModel):
    skill: str
    model: str | None = None
    inputs: dict = {}


def _event(payload: dict) -> str:
    return f"data: {json.dumps(payload)}\n\n"


@router.get("")
async def list_skills() -> dict:
    return {
        "skills": [
            {
                "name": s.name,
                "label": s.label,
                "description": s.description,
                # The UI form is generated from this rather than hardcoded, so
                # a new skill needs no frontend change to become runnable.
                "input_schema": s.input_model.model_json_schema(),
                "estimated_calls": s.estimated_calls({}),
                "scheduler": s.scheduler.name,
            }
            for s in skills.all()
        ]
    }


@router.post("/run", status_code=201)
async def start_run(body: RunRequest) -> dict:
    skill = skills.get(body.skill)
    if skill is None:
        raise HTTPException(404, f"No skill named {body.skill}.")
    try:
        run = await executor.start(skill, body.inputs, body.model, owner=True)
    except executor.InvalidInput as exc:
        raise HTTPException(422, str(exc)) from exc
    except runs.ActiveRunExists as exc:
        raise HTTPException(
            409, "A run is already in progress — wait for it to finish."
        ) from exc
    return {"run_id": run["id"], "status": run["status"]}


@router.get("/runs")
async def list_run_history() -> dict:
    return {"runs": runs.list_runs()}


@router.get("/runs/{run_id}")
async def get_run(run_id: int) -> dict:
    run = runs.get_run(run_id)
    if run is None:
        raise HTTPException(404, "Run not found.")
    return {"run": run, "steps": runs.list_steps(run_id)}


@router.post("/runs/{run_id}/cancel")
async def cancel_run(run_id: int) -> dict:
    if runs.get_run(run_id) is None:
        raise HTTPException(404, "Run not found.")
    if not executor.cancel(run_id):
        # The run exists but is already finished — a conflict, not a 404.
        raise HTTPException(409, "That run has already finished.")
    return {"run_id": run_id, "status": "cancelled"}


def _terminal_event(run: dict) -> dict:
    if run["status"] == "succeeded":
        return {"type": "run-done", "run_id": run["id"], "output": run["output"] or {}}
    return {
        "type": "error",
        "code": run["error_code"] or "internal_error",
        "message": run["error_message"] or "The run failed.",
    }


_TERMINAL = ("succeeded", "failed", "cancelled")


async def _stream(run_id: int) -> AsyncIterator[str]:
    # Subscribe BEFORE snapshotting. The other order drops every event that
    # lands in the gap, which is exactly the window a fast step occupies.
    queue = events.subscribe(run_id)
    try:
        run = runs.get_run(run_id)
        yield _event({"type": "run-start", "run_id": run_id, "skill": run["skill"]})

        started: set[int] = set()
        finished: set[int] = set()
        for step in runs.list_steps(run_id):
            yield _event({
                "type": "step-start", "name": step["name"], "ordinal": step["ordinal"],
            })
            started.add(step["ordinal"])
            if step["status"] != "running":
                yield _event({
                    "type": "step-done", "name": step["name"],
                    "ordinal": step["ordinal"], "status": step["status"],
                    "latency_ms": step["latency_ms"],
                    "tokens_in": step["tokens_in"], "tokens_out": step["tokens_out"],
                    "error": step["error"],
                })
                finished.add(step["ordinal"])

        if run["status"] in _TERMINAL:
            yield _event(_terminal_event(run))
        else:
            while True:
                item = await queue.get()
                if item is events.DONE:
                    break
                # We emitted our own run-start, and replayed rows must not double.
                if item.get("type") == "run-start":
                    continue
                ordinal = item.get("ordinal")
                if item.get("type") == "step-start" and ordinal in started:
                    continue
                if item.get("type") == "step-done" and ordinal in finished:
                    continue
                yield _event(item)
        # On the normal path only. A `yield` inside the `finally` below would
        # raise when the generator is closed on a client disconnect — Starlette
        # calls aclose(), and yielding while unwinding GeneratorExit is an
        # error, which would also skip the unsubscribe and leak the queue.
        yield "data: [DONE]\n\n"
    finally:
        events.unsubscribe(run_id, queue)


@router.get("/runs/{run_id}/stream")
async def stream_run(run_id: int) -> StreamingResponse:
    if runs.get_run(run_id) is None:
        raise HTTPException(404, "Run not found.")
    return StreamingResponse(
        _stream(run_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
