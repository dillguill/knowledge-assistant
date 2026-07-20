import json

import pytest

from app.services.actions import (
    SYSTEM_PROMPT,
    execute_action,
    parse_actions,
    _strip_fences,
)


# --- parse_actions ---


def test_parse_no_fences():
    assert parse_actions("just a plain text response") == []


def test_parse_wiki_create_page():
    text = (
        'I will create that page.\n\n'
        '```wiki-create-page\n'
        '{"title": "Reading List", "content": "## Books\\n- 1984", "folder_id": null}\n'
        '```'
    )
    actions = parse_actions(text)
    assert len(actions) == 1
    assert actions[0]["action"] == "wiki-create-page"
    assert actions[0]["data"]["title"] == "Reading List"
    assert actions[0]["data"]["content"] == "## Books\n- 1984"


def test_parse_wiki_update():
    text = (
        'Here is a proposal.\n\n'
        '```wiki-update\n'
        '{"page_id": null, "title": "New Page", "content": "content here"}\n'
        '```'
    )
    actions = parse_actions(text)
    assert len(actions) == 1
    assert actions[0]["action"] == "wiki-update"
    assert actions[0]["data"]["title"] == "New Page"


def test_parse_collection_create():
    text = (
        '```collection-create\n'
        '{"name": "Engine Specs"}\n'
        '```'
    )
    actions = parse_actions(text)
    assert len(actions) == 1
    assert actions[0]["action"] == "collection-create"
    assert actions[0]["data"]["name"] == "Engine Specs"


def test_parse_multiple_fences():
    text = (
        'First action:\n'
        '```collection-create\n{"name": "C1"}\n```\n'
        'Second action:\n'
        '```wiki-create-page\n{"title": "P1", "content": "c"}\n```'
    )
    actions = parse_actions(text)
    assert len(actions) == 2
    assert actions[0]["action"] == "collection-create"
    assert actions[1]["action"] == "wiki-create-page"


def test_parse_malformed_json_yields_error():
    text = (
        '```wiki-create-page\n'
        'not valid json\n'
        '```'
    )
    actions = parse_actions(text)
    assert len(actions) == 1
    assert "error" in actions[0]
    assert "Invalid JSON" in actions[0]["error"]


def test_parse_fence_already_in_error_entry():
    text = (
        '```wiki-create-page\n'
        'not valid json\n'
        '```'
    )
    actions = parse_actions(text)
    assert actions[0]["action"] == "wiki-create-page"


# --- _strip_fences ---


def test_strip_fences_removes_all():
    text = (
        'Hello\n'
        '```collection-create\n{"name": "C1"}\n```\n'
        'World\n'
        '```wiki-create-page\n{"title": "P1", "content": "c"}\n```\n'
        'Done'
    )
    result = _strip_fences(text)
    assert "```" not in result
    assert "Hello" in result
    assert "World" in result
    assert "Done" in result


def test_strip_fences_no_fences():
    assert _strip_fences("just text") == "just text"


# --- execute_action ---


def test_execute_wiki_create_page_requires_owner(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("OWNER_TOKEN", "sekrit")
    from app.config import get_settings
    get_settings.cache_clear()
    from app.db import store, wiki_store
    store.init_db(str(tmp_path))
    wiki_store.init_wiki(str(tmp_path))

    action = {"action": "wiki-create-page", "data": {"title": "Test", "content": "hello"}}
    result = execute_action(action, owner_token="wrong")
    assert "error" in result
    assert "Owner token required" in result["error"]
    get_settings.cache_clear()


def test_execute_wiki_create_page_success(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("OWNER_TOKEN", "sekrit")
    from app.config import get_settings
    get_settings.cache_clear()
    from app.db import store, wiki_store
    store.init_db(str(tmp_path))
    wiki_store.init_wiki(str(tmp_path))

    action = {"action": "wiki-create-page", "data": {"title": "Test", "content": "hello"}}
    result = execute_action(action, owner_token="sekrit")
    assert "error" not in result
    assert result["result"]["title"] == "Test"

    pages = wiki_store.list_pages()
    assert len(pages) == 1
    assert pages[0]["title"] == "Test"
    get_settings.cache_clear()


def test_execute_wiki_update_creates_proposal(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    from app.config import get_settings
    get_settings.cache_clear()
    from app.db import store, wiki_store
    store.init_db(str(tmp_path))
    wiki_store.init_wiki(str(tmp_path))

    action = {"action": "wiki-update", "data": {"page_id": None, "title": "Proposal", "content": "content"}}
    result = execute_action(action)
    assert "error" not in result
    assert result["result"]["title"] == "Proposal"

    proposals = wiki_store.list_proposals()
    assert len(proposals) == 1
    assert proposals[0]["title"] == "Proposal"
    get_settings.cache_clear()


def test_execute_collection_create_requires_owner(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("OWNER_TOKEN", "sekrit")
    from app.config import get_settings
    get_settings.cache_clear()
    from app.db import store
    store.init_db(str(tmp_path))

    action = {"action": "collection-create", "data": {"name": "Test"}}
    result = execute_action(action, owner_token="")
    assert "error" in result
    assert "Owner token required" in result["error"]
    get_settings.cache_clear()


def test_execute_collection_create_success(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("OWNER_TOKEN", "sekrit")
    from app.config import get_settings
    get_settings.cache_clear()
    from app.db import store
    store.init_db(str(tmp_path))

    action = {"action": "collection-create", "data": {"name": "Test Col"}}
    result = execute_action(action, owner_token="sekrit")
    assert "error" not in result
    assert result["result"]["name"] == "Test Col"

    cols = store.list_collections()
    assert len(cols) == 1
    assert cols[0]["name"] == "Test Col"
    get_settings.cache_clear()


def test_execute_unknown_action():
    action = {"action": "unknown", "data": {}}
    result = execute_action(action)
    assert "error" in result


def test_execute_action_with_preexisting_error():
    action = {"action": "wiki-create-page", "error": "already broken"}
    result = execute_action(action)
    assert result["error"] == "already broken"


# --- SYSTEM_PROMPT ---


def test_system_prompt_mentions_all_tools():
    assert "wiki-create-page" in SYSTEM_PROMPT
    assert "wiki-update" in SYSTEM_PROMPT
    assert "collection-create" in SYSTEM_PROMPT


def test_system_prompt_has_json_examples():
    assert '"title"' in SYSTEM_PROMPT
    assert '"content"' in SYSTEM_PROMPT
    assert '"name"' in SYSTEM_PROMPT
