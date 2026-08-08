"""Regression test: _startup ordering when sync.pull clobbers the DB."""

import shutil
import sqlite3
import subprocess
from pathlib import Path

from app.config import get_settings
from app.db import store, wiki_store
from app.main import _startup
from app.services import sync, wiki_git


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


def test_startup_initializes_wiki_git_repo_and_reconciles_seeded_page(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    get_settings.cache_clear()

    _startup()

    repo = wiki_git._repo_dir(str(tmp_path))
    assert (repo / ".git").is_dir()

    pages = wiki_store.list_pages()
    assert len(pages) == 1
    with wiki_store._connect() as conn:
        row = conn.execute(
            "SELECT git_path FROM wiki_pages WHERE id = ?", (pages[0]["id"],)
        ).fetchone()
    assert row["git_path"] is not None

    get_settings.cache_clear()


def test_startup_reconciles_pages_with_stale_git_path(tmp_path, monkeypatch):
    """A page whose git_path is NULL with no new edits pending (e.g. written
    directly by the one-time migration script, bypassing wiki_store's normal
    git-sync wiring) must still get backfilled by _startup()'s boot-time
    reconcile — not just by the next real edit."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    store.init_db(str(tmp_path))
    wiki_store.init_wiki(str(tmp_path))

    page = wiki_store.create_page("Torque Specs", None, "content", "owner")
    with wiki_store._connect() as conn:
        conn.execute(
            "UPDATE wiki_pages SET git_path = NULL WHERE id = ?", (page["id"],)
        )

    _startup()

    with wiki_store._connect() as conn:
        row = conn.execute(
            "SELECT git_path FROM wiki_pages WHERE id = ?", (page["id"],)
        ).fetchone()
    assert row["git_path"] is not None

    get_settings.cache_clear()


def test_startup_pulls_real_wiki_git_history_before_reconcile(tmp_path, monkeypatch):
    """A fresh container boots with a SQLite DB that already has a page
    (as if just pulled via sync.pull()) but no local wiki_git/ clone yet,
    against an HF dataset repo that already holds real git history for that
    page (pushed by a prior instance). _startup() must pull that real
    history in before reconcile_git() runs — a naive local-init-first
    ordering would instead create a fresh, divergent local commit."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("HF_TOKEN", "t")
    monkeypatch.setenv("HF_DATASET_REPO", "u/r")
    get_settings.cache_clear()

    store.init_db(str(tmp_path))
    wiki_store.init_wiki(str(tmp_path))
    page = wiki_store.create_page("Torque Specs", None, "original content", "owner")
    real_sha = wiki_store.page_history(page["id"])[0]["sha"]

    # Move that page's real git history into a bare "remote", then wipe the
    # local clone entirely — simulating a fresh container whose SQLite
    # already synced but whose wiki_git/ working tree doesn't exist yet.
    local_repo = wiki_git._repo_dir(str(tmp_path))
    remote_dir = tmp_path.parent / "startup_remote.git"
    subprocess.run(
        ["git", "clone", "--bare", str(local_repo), str(remote_dir)],
        check=True, capture_output=True,
    )
    shutil.rmtree(local_repo)

    monkeypatch.setattr(wiki_git, "remote_url", lambda token, repo: str(remote_dir))
    monkeypatch.setattr(sync, "pull", lambda: None)  # whole-tree SQLite pull already "happened" above

    _startup()

    shas = [h["sha"] for h in wiki_store.page_history(page["id"])]
    assert real_sha in shas

    get_settings.cache_clear()


def test_startup_migrates_a_database_restored_by_pull(tmp_path, monkeypatch):
    """The v0.5.0 provenance migration must run against the database sync.pull()
    brings down, not against the empty one a fresh container starts with.

    Same bug class as test_startup_survives_pull_overwrite: init_* running
    before pull() means the restored file is never touched by migrations. Here
    the symptom is narrower and only appears in production — every read works,
    and only archiving a web result fails, with "no such column: source_url".
    """
    # A pre-v0.5.0 database: no provenance columns, and the narrow origin CHECK.
    old_dir = tmp_path / "old"
    old_dir.mkdir()
    old_db = old_dir / "knowledge.db"
    with sqlite3.connect(old_db) as conn:
        conn.executescript(
            """
            CREATE TABLE collections (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE documents (
                id INTEGER PRIMARY KEY,
                collection_id INTEGER REFERENCES collections(id),
                filename TEXT NOT NULL,
                content_type TEXT NOT NULL,
                origin TEXT NOT NULL
                    CHECK (origin IN ('upload', 'corpus', 'attachment')),
                size_bytes INTEGER NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE document_texts (
                document_id INTEGER PRIMARY KEY REFERENCES documents(id),
                extracted_text TEXT NOT NULL
            );
            CREATE VIRTUAL TABLE document_texts_fts USING fts5(
                extracted_text, content='document_texts', content_rowid='document_id'
            );
            INSERT INTO collections (id, name) VALUES (1, 'Garage');
            INSERT INTO documents
                (id, collection_id, filename, content_type, origin, size_bytes)
                VALUES (7, 1, 'manual.txt', 'text/plain', 'upload', 3);
            INSERT INTO document_texts (document_id, extracted_text)
                VALUES (7, 'torque is 22 Nm');
            """
        )

    monkeypatch.setattr(sync, "pull", lambda: Path(old_db).replace(tmp_path / "knowledge.db"))
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    get_settings.cache_clear()

    _startup()

    with sqlite3.connect(tmp_path / "knowledge.db") as conn:
        columns = {r[1] for r in conn.execute("PRAGMA table_info(documents)")}
    assert "source_url" in columns
    assert "fetched_at" in columns

    # The restored row survives the rebuild, and archiving now works.
    assert store.get_texts([7])[0][1] == "torque is 22 Nm"
    doc = store.upsert_web_document(1, "https://a.test/x", "Title", "body")
    assert doc["origin"] == "web"

    get_settings.cache_clear()
