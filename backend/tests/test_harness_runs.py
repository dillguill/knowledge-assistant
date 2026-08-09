import pytest

from app.config import get_settings
from app.db import store


@pytest.fixture(autouse=True)
def runs_env(tmp_path, monkeypatch):
    from app.harness import runs

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    store.init_db(str(tmp_path))
    runs.init_runs(str(tmp_path))
    yield
    get_settings.cache_clear()


def test_run_lifecycle_records_input_and_output():
    from app.harness import runs

    run = runs.create_run("research_brief", "pipeline", "m:free", {"topic": "sqlite"})
    assert run["status"] == "queued"
    assert run["input"] == {"topic": "sqlite"}

    runs.start_run(run["id"])
    assert runs.get_run(run["id"])["status"] == "running"

    runs.finish_run(run["id"], {"proposal_id": 3})
    done = runs.get_run(run["id"])
    assert done["status"] == "succeeded"
    assert done["output"] == {"proposal_id": 3}
    assert done["finished_at"] is not None


def test_failed_run_keeps_a_queryable_record():
    from app.harness import runs

    run = runs.create_run("research_brief", "pipeline", None, {})
    runs.start_run(run["id"])
    runs.fail_run(run["id"], "rate_limited", "wait 30s")

    failed = runs.get_run(run["id"])
    assert failed["status"] == "failed"
    assert failed["error_code"] == "rate_limited"
    assert failed["error_message"] == "wait 30s"


def test_steps_record_ordinals_and_metrics():
    from app.harness import runs

    run = runs.create_run("research_brief", "pipeline", None, {})
    first = runs.add_step(run["id"], "plan")
    runs.finish_step(
        first, status="succeeded", model="m:free",
        tokens_in=100, tokens_out=42, latency_ms=1200,
    )
    second = runs.add_step(run["id"], "gather")
    runs.finish_step(second, status="succeeded", latency_ms=5)

    steps = runs.list_steps(run["id"])
    assert [s["ordinal"] for s in steps] == [1, 2]
    assert [s["name"] for s in steps] == ["plan", "gather"]
    assert steps[0]["tokens_out"] == 42
    assert steps[0]["latency_ms"] == 1200
    assert steps[1]["model"] is None


def test_a_second_concurrent_run_is_rejected():
    from app.harness import runs

    first = runs.create_run("research_brief", "pipeline", None, {})
    runs.start_run(first["id"])
    with pytest.raises(runs.ActiveRunExists):
        runs.create_run("research_brief", "pipeline", None, {})

    # Once the first run reaches a terminal state, the slot frees up.
    runs.finish_run(first["id"], {})
    assert runs.create_run("research_brief", "pipeline", None, {})["id"] != first["id"]


def test_list_runs_is_newest_first():
    from app.harness import runs

    a = runs.create_run("research_brief", "pipeline", None, {})
    runs.finish_run(a["id"], {})
    b = runs.create_run("research_brief", "pipeline", None, {})
    runs.finish_run(b["id"], {})

    assert [r["id"] for r in runs.list_runs()] == [b["id"], a["id"]]
