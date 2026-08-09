import pytest


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
