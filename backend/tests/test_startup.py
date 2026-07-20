"""Regression test: _startup ordering when sync.pull clobbers the DB."""

import sqlite3
from pathlib import Path

from app.config import get_settings
from app.db import store, wiki_store
from app.main import _startup
from app.services import sync


def test_startup_survives_pull_overwrite(tmp_path, monkeypatch):
    """sync.pull() must run BEFORE init_* so the idempotent schema creation
    layers on top of whatever the HF dataset brought down.

    Regression test for the deploy bug where pull() ran after init_wiki()
    and overwrote the freshly-created knowledge.db with an older copy that
    lacked wiki tables, causing seed_wiki() to raise "no such table:
    wiki_pages".
    """
    # (1) Build an old-style knowledge.db (store tables only, no wiki tables)
    old_dir = tmp_path / "old"
    old_dir.mkdir()
    store.init_db(str(old_dir))
    old_db = old_dir / "knowledge.db"

    conn = sqlite3.connect(old_db)
    old_tables = {r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    )}
    conn.close()
    assert "wiki_pages" not in old_tables

    # (2) Monkey-patch sync.pull() to overwrite data_dir/knowledge.db with
    # the old-schema copy (simulating the HF dataset download).
    def fake_pull():
        Path(old_db).replace(tmp_path / "knowledge.db")

    monkeypatch.setattr(sync, "pull", fake_pull)

    # (3)
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    get_settings.cache_clear()

    _startup()

    # (4) Verify wiki tables now exist and seed_wiki populated the page
    conn = sqlite3.connect(tmp_path / "knowledge.db")
    tables = {r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    )}
    conn.close()

    assert "wiki_pages" in tables
    assert "wiki_folders" in tables
    assert "wiki_versions" in tables
    assert "wiki_proposals" in tables
    assert "wiki_pages_fts" in tables

    folders = wiki_store.list_folders()
    assert [f["name"] for f in folders] == ["Guides"]

    pages = wiki_store.list_pages()
    assert [p["title"] for p in pages] == ["Welcome to the Wiki"]

    get_settings.cache_clear()
