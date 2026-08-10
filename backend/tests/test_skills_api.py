import asyncio
import json

import httpx
import pytest

from app.config import get_settings
from app.db import store, wiki_store

OWNER = {"X-Owner-Token": "sekret"}


@pytest.fixture(autouse=True)
def api_env(tmp_path, monkeypatch):
    from app.harness import runs

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("OWNER_TOKEN", "sekret")
    get_settings.cache_clear()
    store.init_db(str(tmp_path))
    wiki_store.init_wiki(str(tmp_path))
    runs.init_runs(str(tmp_path))
    yield
    get_settings.cache_clear()


def _client():
    from app.main import create_app

    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_app()), base_url="http://test"
    )


def _sse_events(text: str) -> list[dict]:
    return [
        json.loads(line[len("data: "):])
        for line in text.splitlines()
        if line.startswith("data: ") and line != "data: [DONE]"
    ]


async def test_listing_skills_exposes_the_input_schema_and_cost():
    async with _client() as client:
        resp = await client.get("/api/skills", headers=OWNER)

    assert resp.status_code == 200
    brief = next(s for s in resp.json()["skills"] if s["name"] == "research_brief")
    # The UI is generated from this, not hardcoded.
    assert brief["input_schema"]["properties"]["topic"]["type"] == "string"
    # The user sees what a run costs before committing to it.
    assert brief["estimated_calls"] == 3 + get_settings().skill_max_sections
    assert brief["scheduler"] == "pipeline"


async def test_the_skills_api_is_owner_gated():
    async with _client() as client:
        assert (await client.get("/api/skills")).status_code == 401
        assert (await client.post("/api/skills/run", json={})).status_code == 401
        assert (await client.get("/api/skills/runs")).status_code == 401


async def test_starting_a_run_returns_immediately(monkeypatch):
    from app.harness import executor

    async def fake_execute(skill, run, inputs, owner):
        await asyncio.sleep(0)

    monkeypatch.setattr(executor, "execute", fake_execute)
    async with _client() as client:
        resp = await client.post(
            "/api/skills/run",
            json={"skill": "research_brief", "model": "m:free",
                  "inputs": {"topic": "sqlite performance"}},
            headers=OWNER,
        )

    assert resp.status_code == 201
    assert resp.json()["status"] == "queued"
    assert isinstance(resp.json()["run_id"], int)


async def test_an_unknown_skill_is_404_not_422():
    async with _client() as client:
        resp = await client.post(
            "/api/skills/run", json={"skill": "nope", "inputs": {}}, headers=OWNER
        )
    assert resp.status_code == 404


async def test_invalid_input_is_422():
    async with _client() as client:
        resp = await client.post(
            "/api/skills/run",
            json={"skill": "research_brief", "inputs": {"topic": "x"}},  # too short
            headers=OWNER,
        )
    assert resp.status_code == 422


async def test_a_second_concurrent_run_is_409(monkeypatch):
    from app.harness import executor

    async def fake_execute(skill, run, inputs, owner):
        await asyncio.sleep(5)

    monkeypatch.setattr(executor, "execute", fake_execute)
    body = {"skill": "research_brief", "inputs": {"topic": "sqlite performance"}}
    async with _client() as client:
        first = await client.post("/api/skills/run", json=body, headers=OWNER)
        assert first.status_code == 201
        second = await client.post("/api/skills/run", json=body, headers=OWNER)
    assert second.status_code == 409
    assert "already" in second.json()["detail"].lower()
    await executor.drain()


async def test_a_run_record_carries_its_steps():
    from app.harness import runs

    run = runs.create_run("research_brief", "pipeline", "m:free", {"topic": "x"})
    step = runs.add_step(run["id"], "plan")
    runs.finish_step(step, status="succeeded", latency_ms=12)

    async with _client() as client:
        resp = await client.get(f"/api/skills/runs/{run['id']}", headers=OWNER)

    assert resp.status_code == 200
    assert resp.json()["run"]["skill"] == "research_brief"
    assert resp.json()["steps"][0]["name"] == "plan"


async def test_run_history_is_listed_newest_first():
    from app.harness import runs

    a = runs.create_run("research_brief", "pipeline", None, {})
    runs.finish_run(a["id"], {})
    b = runs.create_run("research_brief", "pipeline", None, {})
    runs.finish_run(b["id"], {})

    async with _client() as client:
        resp = await client.get("/api/skills/runs", headers=OWNER)
    assert [r["id"] for r in resp.json()["runs"]] == [b["id"], a["id"]]


async def test_an_unknown_run_is_404():
    async with _client() as client:
        assert (await client.get("/api/skills/runs/999", headers=OWNER)).status_code == 404
        assert (
            await client.get("/api/skills/runs/999/stream", headers=OWNER)
        ).status_code == 404


async def test_cancelling_a_run_returns_its_new_state(monkeypatch):
    from app.harness import executor, runs

    monkeypatch.setattr(executor, "cancel", lambda run_id: True)
    run = runs.create_run("research_brief", "pipeline", None, {})
    runs.start_run(run["id"])

    async with _client() as client:
        resp = await client.post(f"/api/skills/runs/{run['id']}/cancel", headers=OWNER)

    assert resp.status_code == 200
    assert resp.json()["status"] == "cancelled"


async def test_cancelling_a_finished_run_is_409_not_404():
    from app.harness import runs

    run = runs.create_run("research_brief", "pipeline", None, {})
    runs.finish_run(run["id"], {})

    async with _client() as client:
        resp = await client.post(f"/api/skills/runs/{run['id']}/cancel", headers=OWNER)
    assert resp.status_code == 409


async def test_cancelling_an_unknown_run_is_404():
    async with _client() as client:
        assert (
            await client.post("/api/skills/runs/999/cancel", headers=OWNER)
        ).status_code == 404


async def test_the_stream_of_a_finished_run_replays_and_closes():
    from app.harness import runs

    run = runs.create_run("research_brief", "pipeline", None, {})
    runs.start_run(run["id"])
    first = runs.add_step(run["id"], "plan")
    runs.finish_step(first, status="succeeded", latency_ms=10, tokens_out=4)
    runs.finish_run(run["id"], {"proposal_id": 4})

    async with _client() as client:
        resp = await client.get(f"/api/skills/runs/{run['id']}/stream", headers=OWNER)

    events_seen = _sse_events(resp.text)
    # Replay, in order, then the terminal event.
    assert events_seen[0]["type"] == "run-start"
    assert (events_seen[1]["type"], events_seen[1]["ordinal"]) == ("step-start", 1)
    assert events_seen[2]["type"] == "step-done"
    assert events_seen[2]["tokens_out"] == 4
    assert events_seen[-1]["type"] == "run-done"
    assert events_seen[-1]["output"] == {"proposal_id": 4}
    assert resp.text.endswith("data: [DONE]\n\n")


async def test_the_stream_of_a_failed_run_replays_its_error():
    from app.harness import runs

    run = runs.create_run("research_brief", "pipeline", None, {})
    runs.start_run(run["id"])
    runs.fail_run(run["id"], "rate_limited", "wait 30s")

    async with _client() as client:
        resp = await client.get(f"/api/skills/runs/{run['id']}/stream", headers=OWNER)

    last = _sse_events(resp.text)[-1]
    assert last["type"] == "error"
    assert last["code"] == "rate_limited"
    assert last["message"] == "wait 30s"


async def _drive(run_id, on_replay_drained=None, expect=None):
    """Drive the SSE generator directly.

    httpx's ASGITransport awaits the whole app before exposing the body (it
    accumulates `body_parts`, then wraps them), so `client.stream()` cannot
    deliver frames incrementally — a test that publishes an event only after
    reading one would deadlock against a generator that never returns. Real
    uvicorn streams fine; the transport is the limitation, not the endpoint.
    Every HTTP-level concern (owner gate, 404, media type) is covered above.
    """
    from app.routers import skills as skills_router

    seen: list[dict] = []
    agen = skills_router._stream(run_id)
    async for frame in agen:
        payload = frame[len("data: "):].strip()
        if payload == "[DONE]":
            break
        seen.append(json.loads(payload))
        if on_replay_drained is not None and len(seen) == expect:
            on_replay_drained()
    return seen


async def test_the_stream_replays_completed_steps_then_follows_live():
    """Reconnect and late-join must behave identically to a first connect —
    which is the whole reason the SSE path reads FROM the run record rather
    than BEING the run."""
    from app.harness import events, runs

    run = runs.create_run("research_brief", "pipeline", "m:free", {})
    runs.start_run(run["id"])
    first = runs.add_step(run["id"], "plan")
    runs.finish_step(first, status="succeeded", latency_ms=10)

    def push_live():
        events.publish(run["id"], {
            "type": "step-start", "name": "gather", "ordinal": 2,
        })
        events.close(run["id"])

    seen = await _drive(run["id"], push_live, expect=3)

    assert seen[0]["type"] == "run-start"
    assert (seen[1]["type"], seen[1]["ordinal"]) == ("step-start", 1)
    assert (seen[2]["type"], seen[2]["status"]) == ("step-done", "succeeded")
    # The live event arrived after the replay, exactly once.
    assert seen[3]["name"] == "gather"
    assert len(seen) == 4


async def test_a_replayed_step_is_not_duplicated_by_the_live_feed():
    """The stream subscribes BEFORE it snapshots, so an event for an already-
    replayed ordinal must be skipped rather than shown twice."""
    from app.harness import events, runs

    run = runs.create_run("research_brief", "pipeline", None, {})
    runs.start_run(run["id"])
    first = runs.add_step(run["id"], "plan")
    runs.finish_step(first, status="succeeded", latency_ms=10)

    def push_duplicates():
        # Same ordinal the replay already emitted, plus a run-start the
        # generator emits itself.
        events.publish(run["id"], {"type": "run-start", "run_id": run["id"]})
        events.publish(run["id"], {
            "type": "step-start", "name": "plan", "ordinal": 1,
        })
        events.publish(run["id"], {
            "type": "step-done", "name": "plan", "ordinal": 1,
            "status": "succeeded",
        })
        events.close(run["id"])

    seen = await _drive(run["id"], push_duplicates, expect=3)

    assert len([e for e in seen if e["type"] == "step-start"]) == 1
    assert len([e for e in seen if e["type"] == "step-done"]) == 1
    assert len([e for e in seen if e["type"] == "run-start"]) == 1


async def test_the_stream_unsubscribes_when_the_client_goes_away():
    """A disconnect must not leak a subscriber queue for the life of the app."""
    from app.harness import events, runs
    from app.routers import skills as skills_router

    run = runs.create_run("research_brief", "pipeline", None, {})
    runs.start_run(run["id"])

    agen = skills_router._stream(run["id"])
    await agen.__anext__()  # run-start; subscription is now live
    assert run["id"] in events._subscribers
    await agen.aclose()
    assert run["id"] not in events._subscribers
