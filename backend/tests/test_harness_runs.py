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


def test_sweep_marks_interrupted_runs_failed():
    from app.harness import runs

    run = runs.create_run("research_brief", "pipeline", None, {})
    runs.start_run(run["id"])
    step = runs.add_step(run["id"], "draft")

    assert runs.sweep_orphans() == 1

    swept = runs.get_run(run["id"])
    assert swept["status"] == "failed"
    assert swept["error_code"] == "orphaned"
    # The unfinished step is closed too, or the timeline renders a step that
    # spins forever in the run history.
    assert runs.list_steps(run["id"])[0]["status"] == "failed"
    assert step is not None
    # And the slot is free again.
    assert runs.create_run("research_brief", "pipeline", None, {})


def test_sweep_is_a_noop_on_an_empty_table():
    from app.harness import runs

    # Runs on every boot, including the first one after deploy.
    assert runs.sweep_orphans() == 0


def test_cancelling_a_run_is_terminal_and_frees_the_slot():
    from app.harness import runs

    run = runs.create_run("research_brief", "pipeline", None, {})
    runs.start_run(run["id"])
    runs.add_step(run["id"], "draft")

    runs.cancel_run(run["id"])

    cancelled = runs.get_run(run["id"])
    assert cancelled["status"] == "cancelled"
    assert cancelled["finished_at"] is not None
    # An unfinished step must not spin forever in the timeline.
    assert runs.list_steps(run["id"])[0]["status"] == "failed"
    assert runs.list_steps(run["id"])[0]["error"] == "cancelled"
    # Terminal means the one-active-run cap lets the next run through.
    assert runs.create_run("research_brief", "pipeline", None, {})


def test_cancelling_an_already_terminal_run_does_not_rewrite_it():
    from app.harness import runs

    run = runs.create_run("research_brief", "pipeline", None, {})
    runs.finish_run(run["id"], {"proposal_id": 1})

    runs.cancel_run(run["id"])

    assert runs.get_run(run["id"])["status"] == "succeeded"
    assert runs.get_run(run["id"])["output"] == {"proposal_id": 1}


def test_the_boot_sweep_leaves_cancelled_runs_alone():
    from app.harness import runs

    run = runs.create_run("research_brief", "pipeline", None, {})
    runs.start_run(run["id"])
    runs.cancel_run(run["id"])

    assert runs.sweep_orphans() == 0
    assert runs.get_run(run["id"])["status"] == "cancelled"
