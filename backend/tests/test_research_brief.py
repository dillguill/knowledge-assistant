import json

import pytest

from app.config import get_settings
from app.db import store, wiki_store


def test_render_injects_the_canonical_grounding_rule():
    from app import skills
    from app.services.context_builder import RULES

    assert skills.render("Rules: ${GROUNDING}") == f"Rules: {RULES}"


def test_render_leaves_json_braces_alone():
    # str.format would choke on every one of these; string.Template does not.
    from app import skills

    out = skills.render('Reply with {"questions": ["a"]} about ${TOPIC}.', TOPIC="sqlite")
    assert out == 'Reply with {"questions": ["a"]} about sqlite.'


def test_render_fails_loudly_on_a_missing_variable():
    from app import skills

    # A prompt shipping a literal ${TOPIC} to the model is worse than a crash.
    with pytest.raises(KeyError):
        skills.render("About ${TOPIC}.")


def test_the_registry_holds_the_shipped_skills():
    import app.skills.research_brief  # noqa: F401  (registers on import)
    from app import skills

    brief = skills.get("research_brief")
    assert brief is not None
    assert brief.owner_only is True
    assert brief.scheduler.name == "pipeline"
    assert brief in skills.all()


def test_an_unknown_skill_is_none():
    from app import skills

    assert skills.get("nope") is None


@pytest.fixture
def brief_env(tmp_path, monkeypatch):
    from app.harness import runs

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    store.init_db(str(tmp_path))
    wiki_store.init_wiki(str(tmp_path))
    runs.init_runs(str(tmp_path))
    yield
    get_settings.cache_clear()


PLAN = json.dumps({"questions": ["q1", "q2", "q3"]})
OUTLINE = json.dumps({"sections": [
    {"title": "Background", "source_labels": ["S1"]},
    {"title": "Findings", "source_labels": ["S1"]},
]})
VERIFY = json.dumps({"unsupported_claims": ["Claim about throughput has no source."]})


def _script(monkeypatch, replies):
    from app.services import openrouter

    queue = list(replies)

    async def fake_complete_message(model, messages, *, tools=None, response_format=None):
        reply = queue.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return {"content": reply}, {"prompt_tokens": 10, "completion_tokens": 4}

    monkeypatch.setattr(openrouter, "complete_message", fake_complete_message)


async def _run(monkeypatch, inputs, replies):
    import app.skills.research_brief  # noqa: F401
    from app import skills
    from app.harness import executor

    _script(monkeypatch, replies)
    run = await executor.start(skills.get("research_brief"), inputs, "m:free", owner=True)
    await executor.drain()
    return run


def _collection_with_a_document():
    collection = store.create_collection("Notes")
    store.add_document(
        collection["id"], "n.txt", "text/plain", "upload", b"x", "sqlite is fast"
    )
    return collection["id"]


async def test_a_full_run_files_a_wiki_proposal(brief_env, monkeypatch):
    from app.harness import runs

    cid = _collection_with_a_document()
    run = await _run(
        monkeypatch,
        {"topic": "sqlite performance", "collection_ids": [cid]},
        [PLAN, OUTLINE, "## Background\nText [S1].", "## Findings\nMore [S1].", VERIFY],
    )

    record = runs.get_run(run["id"])
    assert record["status"] == "succeeded"
    proposal = wiki_store.get_proposal(record["output"]["proposal_id"])
    assert proposal["status"] == "pending"
    assert "Background" in proposal["content"]
    assert "Findings" in proposal["content"]
    # The verification list travels with the run.
    assert record["output"]["unsupported_claims"] == [
        "Claim about throughput has no source."
    ]
    # Citations reuse the source list, same rule as the chat proposal card.
    assert proposal["citations"][0]["label"] == "S1"


async def test_the_step_timeline_is_complete_and_ordered(brief_env, monkeypatch):
    from app.harness import runs

    cid = _collection_with_a_document()
    run = await _run(
        monkeypatch,
        {"topic": "sqlite", "collection_ids": [cid]},
        [PLAN, OUTLINE, "a", "b", VERIFY],
    )

    steps = runs.list_steps(run["id"])
    assert [s["name"] for s in steps] == [
        "plan", "gather", "outline", "draft:1", "draft:2", "verify"
    ]
    assert all(s["status"] == "succeeded" for s in steps)


async def test_the_advertised_estimate_matches_the_nominal_call_count(brief_env, monkeypatch):
    import app.skills.research_brief  # noqa: F401
    from app import skills
    from app.harness import runs

    cid = _collection_with_a_document()
    run = await _run(
        monkeypatch,
        {"topic": "sqlite", "collection_ids": [cid]},
        [PLAN, OUTLINE, "a", "b", VERIFY],
    )

    spent = [s for s in runs.list_steps(run["id"]) if s["tokens_out"]]
    # plan + outline + 2 drafts + verify
    assert len(spent) == 5
    # The advertised number assumes the section cap; it must never understate.
    estimate = skills.get("research_brief").estimated_calls({})
    assert estimate == 3 + get_settings().skill_max_sections
    assert len(spent) <= estimate


async def test_gather_searches_once_per_sub_question_when_web_is_enabled(brief_env, monkeypatch):
    from app.harness import runs
    from app.services import search

    queries = []

    async def fake_run_search(query, max_results=None, force_refresh=False):
        queries.append(query)
        result = search.WebResult(
            url=f"https://a.test/{len(queries)}", title="A",
            content="full page body", excerpt="ex",
        )
        store.put_cached_search(query, max_results or 5, [result.to_dict()])
        return [result]

    monkeypatch.setattr(search, "run_search", fake_run_search)
    monkeypatch.setenv("FIRECRAWL_API_KEY", "k")
    get_settings.cache_clear()

    run = await _run(
        monkeypatch,
        {"topic": "sqlite", "web_search": True},
        [PLAN, OUTLINE, "a", "b", VERIFY],
    )

    # One per planned sub-question — the multi-search capability v0.5.0
    # deferred to the harness, bounded by the step rather than unbounded.
    assert len(queries) == 3
    tool_steps = [s for s in runs.list_steps(run["id"]) if s["name"] == "tool:web_search"]
    assert len(tool_steps) == 3
    assert runs.get_run(run["id"])["status"] == "succeeded"


async def test_a_failed_search_degrades_instead_of_failing_the_run(brief_env, monkeypatch):
    from app.harness import runs
    from app.services import search

    async def fake_run_search(query, max_results=None, force_refresh=False):
        raise search.SearchQuotaError("402")

    monkeypatch.setattr(search, "run_search", fake_run_search)
    cid = _collection_with_a_document()

    run = await _run(
        monkeypatch,
        {"topic": "sqlite", "collection_ids": [cid], "web_search": True},
        [PLAN, OUTLINE, "a", "b", VERIFY],
    )

    # A tool failure is not a step failure: the brief is written from the
    # remaining sources rather than abandoned.
    assert runs.get_run(run["id"])["status"] == "succeeded"


async def test_a_run_with_no_usable_sources_fails_before_drafting(brief_env, monkeypatch):
    from app.harness import runs

    run = await _run(monkeypatch, {"topic": "sqlite"}, [PLAN])

    record = runs.get_run(run["id"])
    assert record["status"] == "failed"
    assert record["error_code"] == "no_sources"
    # Nothing half-finished was filed.
    assert wiki_store.list_proposals() == []


async def test_a_full_proposal_queue_is_caught_before_any_model_call(brief_env, monkeypatch):
    from app.harness import runs

    monkeypatch.setattr(wiki_store, "pending_proposals_full", lambda: True)
    run = await _run(monkeypatch, {"topic": "sqlite"}, [])

    record = runs.get_run(run["id"])
    assert record["error_code"] == "proposal_queue_full"
    # Nothing was spent.
    assert runs.list_steps(run["id"])[0]["tokens_out"] is None


async def test_a_mid_run_rate_limit_keeps_the_completed_steps(brief_env, monkeypatch):
    from app.harness import runs
    from app.services import openrouter

    cid = _collection_with_a_document()
    run = await _run(
        monkeypatch,
        {"topic": "sqlite", "collection_ids": [cid]},
        [PLAN, OUTLINE, openrouter.RateLimitedError(retry_after=30)],
    )

    record = runs.get_run(run["id"])
    assert record["error_code"] == "rate_limited"
    # With free-tier limits and 3 + sections calls, this is the EXPECTED
    # failure. History has to show how far it got.
    steps = runs.list_steps(run["id"])
    assert [s["name"] for s in steps] == ["plan", "gather", "outline", "draft:1"]
    assert [s["status"] for s in steps[:3]] == ["succeeded"] * 3
    assert steps[-1]["status"] == "failed"
    assert wiki_store.list_proposals() == []


async def test_the_outline_schema_caps_sections_at_the_configured_maximum(brief_env):
    from app.skills.research_brief import _outline_contract

    schema = _outline_contract().response_format()["json_schema"]["schema"]
    sections = schema["properties"]["sections"]
    assert sections["maxItems"] == get_settings().skill_max_sections


async def test_web_results_are_labeled_sources_like_any_other(brief_env, monkeypatch):
    from app.harness import runs
    from app.services import search

    async def fake_run_search(query, max_results=None, force_refresh=False):
        result = search.WebResult(
            url="https://a.test/1", title="Web Page",
            content="the full page body", excerpt="ex",
        )
        store.put_cached_search(query, max_results or 5, [result.to_dict()])
        return [result]

    monkeypatch.setattr(search, "run_search", fake_run_search)
    monkeypatch.setenv("FIRECRAWL_API_KEY", "k")
    get_settings.cache_clear()

    run = await _run(
        monkeypatch, {"topic": "sqlite", "web_search": True},
        [PLAN, OUTLINE, "a", "b", VERIFY],
    )

    proposal = wiki_store.get_proposal(
        runs.get_run(run["id"])["output"]["proposal_id"]
    )
    web = [c for c in proposal["citations"] if c["kind"] == "web"]
    assert web and web[0]["url"] == "https://a.test/1"
