"""SQLite-backed store for wiki folders, pages, versions, and proposals."""

import json
import re
import sqlite3
from pathlib import Path

from app.config import get_settings

_SCHEMA = """
CREATE TABLE IF NOT EXISTS wiki_folders (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    parent_id INTEGER REFERENCES wiki_folders(id),
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (parent_id, name)
);
CREATE TABLE IF NOT EXISTS wiki_pages (
    id INTEGER PRIMARY KEY,
    folder_id INTEGER REFERENCES wiki_folders(id),
    title TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    content TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS wiki_versions (
    id INTEGER PRIMARY KEY,
    page_id INTEGER NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    author TEXT NOT NULL CHECK (author IN ('owner', 'assistant')),
    note TEXT NOT NULL DEFAULT '',
    citations TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS wiki_proposals (
    id INTEGER PRIMARY KEY,
    page_id INTEGER REFERENCES wiki_pages(id) ON DELETE CASCADE,  -- NULL = new page
    title TEXT NOT NULL,
    folder_id INTEGER REFERENCES wiki_folders(id),
    base_version_id INTEGER REFERENCES wiki_versions(id),
    content TEXT NOT NULL,
    rationale TEXT NOT NULL DEFAULT '',
    citations TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    decided_at TEXT
);
CREATE VIRTUAL TABLE IF NOT EXISTS wiki_pages_fts USING fts5(
    title, content, content='wiki_pages', content_rowid='id'
);
"""


def _db_path() -> Path:
    return Path(get_settings().data_dir) / "knowledge.db"


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(_db_path())
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_wiki(data_dir: str) -> None:
    Path(data_dir).mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(Path(data_dir) / "knowledge.db") as conn:
        conn.executescript(_SCHEMA)


def _slugify(title: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
    return slug or "page"


def _unique_slug(conn: sqlite3.Connection, title: str) -> str:
    base = _slugify(title)
    slug = base
    n = 2
    while conn.execute(
        "SELECT 1 FROM wiki_pages WHERE slug = ?", (slug,)
    ).fetchone():
        slug = f"{base}-{n}"
        n += 1
    return slug


# --- folders ---


def _folder_dict(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "parent_id": row["parent_id"],
        "position": row["position"],
        "created_at": row["created_at"],
    }


def create_folder(name: str, parent_id: int | None) -> dict:
    with _connect() as conn:
        cur = conn.execute(
            "INSERT INTO wiki_folders (name, parent_id) VALUES (?, ?)",
            (name, parent_id),
        )
        row = conn.execute(
            "SELECT * FROM wiki_folders WHERE id = ?", (cur.lastrowid,)
        ).fetchone()
    return _folder_dict(row)


def list_folders() -> list[dict]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM wiki_folders ORDER BY name"
        ).fetchall()
    return [_folder_dict(r) for r in rows]


def rename_folder(folder_id: int, name: str) -> None:
    with _connect() as conn:
        conn.execute(
            "UPDATE wiki_folders SET name = ? WHERE id = ?", (name, folder_id)
        )


def move_folder(folder_id: int, parent_id: int | None) -> None:
    with _connect() as conn:
        conn.execute(
            "UPDATE wiki_folders SET parent_id = ? WHERE id = ?",
            (parent_id, folder_id),
        )


def delete_folder(folder_id: int) -> None:
    with _connect() as conn:
        has_pages = conn.execute(
            "SELECT 1 FROM wiki_pages WHERE folder_id = ?", (folder_id,)
        ).fetchone()
        has_subfolders = conn.execute(
            "SELECT 1 FROM wiki_folders WHERE parent_id = ?", (folder_id,)
        ).fetchone()
        if has_pages or has_subfolders:
            raise ValueError("Cannot delete a folder that contains pages or subfolders")
        conn.execute("DELETE FROM wiki_folders WHERE id = ?", (folder_id,))


# --- pages ---


def _page_dict(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "folder_id": row["folder_id"],
        "title": row["title"],
        "slug": row["slug"],
        "content": row["content"],
        "position": row["position"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def create_page(title: str, folder_id: int | None, content: str, author: str) -> dict:
    with _connect() as conn:
        slug = _unique_slug(conn, title)
        cur = conn.execute(
            """INSERT INTO wiki_pages (folder_id, title, slug, content)
               VALUES (?, ?, ?, ?)""",
            (folder_id, title, slug, content),
        )
        page_id = cur.lastrowid
        conn.execute(
            """INSERT INTO wiki_versions (page_id, content, author)
               VALUES (?, ?, ?)""",
            (page_id, content, author),
        )
        conn.execute(
            "INSERT INTO wiki_pages_fts (rowid, title, content) VALUES (?, ?, ?)",
            (page_id, title, content),
        )
        row = conn.execute(
            "SELECT * FROM wiki_pages WHERE id = ?", (page_id,)
        ).fetchone()
    return _page_dict(row)


def get_page(page_id: int) -> dict | None:
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM wiki_pages WHERE id = ?", (page_id,)
        ).fetchone()
    return _page_dict(row) if row else None


def get_page_by_slug(slug: str) -> dict | None:
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM wiki_pages WHERE slug = ?", (slug,)
        ).fetchone()
    return _page_dict(row) if row else None


def list_pages() -> list[dict]:
    with _connect() as conn:
        rows = conn.execute(
            """SELECT p.id, p.folder_id, p.title, p.slug, p.position, p.updated_at,
                      (SELECT v.author FROM wiki_versions v
                       WHERE v.page_id = p.id ORDER BY v.id DESC LIMIT 1) AS last_author
               FROM wiki_pages p ORDER BY p.title"""
        ).fetchall()
    return [
        {
            "id": r["id"],
            "folder_id": r["folder_id"],
            "title": r["title"],
            "slug": r["slug"],
            "position": r["position"],
            "updated_at": r["updated_at"],
            "last_author": r["last_author"],
        }
        for r in rows
    ]


def update_page_content(
    page_id: int,
    content: str,
    author: str,
    note: str = "",
    citations: list | None = None,
) -> dict:
    citations_json = json.dumps(citations or [])
    with _connect() as conn:
        conn.execute(
            """INSERT INTO wiki_versions (page_id, content, author, note, citations)
               VALUES (?, ?, ?, ?, ?)""",
            (page_id, content, author, note, citations_json),
        )
        title_row = conn.execute(
            "SELECT title FROM wiki_pages WHERE id = ?", (page_id,)
        ).fetchone()
        # FTS is an external-content table: delete the old index entry
        # *before* mutating the backing row, since the DELETE looks up the
        # current backing row to know which terms to remove.
        conn.execute("DELETE FROM wiki_pages_fts WHERE rowid = ?", (page_id,))
        conn.execute(
            """UPDATE wiki_pages
               SET content = ?, updated_at = datetime('now')
               WHERE id = ?""",
            (content, page_id),
        )
        conn.execute(
            "INSERT INTO wiki_pages_fts (rowid, title, content) VALUES (?, ?, ?)",
            (page_id, title_row["title"], content),
        )
        row = conn.execute(
            "SELECT * FROM wiki_pages WHERE id = ?", (page_id,)
        ).fetchone()
    return _page_dict(row)


def rename_page(page_id: int, title: str) -> None:
    with _connect() as conn:
        row = conn.execute(
            "SELECT content FROM wiki_pages WHERE id = ?", (page_id,)
        ).fetchone()
        conn.execute("DELETE FROM wiki_pages_fts WHERE rowid = ?", (page_id,))
        conn.execute(
            "UPDATE wiki_pages SET title = ? WHERE id = ?", (title, page_id)
        )
        conn.execute(
            "INSERT INTO wiki_pages_fts (rowid, title, content) VALUES (?, ?, ?)",
            (page_id, title, row["content"]),
        )


def move_page(page_id: int, folder_id: int | None) -> None:
    with _connect() as conn:
        conn.execute(
            "UPDATE wiki_pages SET folder_id = ? WHERE id = ?", (folder_id, page_id)
        )


def delete_page(page_id: int) -> None:
    with _connect() as conn:
        conn.execute("DELETE FROM wiki_pages_fts WHERE rowid = ?", (page_id,))
        conn.execute("DELETE FROM wiki_pages WHERE id = ?", (page_id,))


# --- versions ---


def list_versions(page_id: int) -> list[dict]:
    with _connect() as conn:
        rows = conn.execute(
            """SELECT id, author, note, citations, created_at
               FROM wiki_versions WHERE page_id = ? ORDER BY id DESC""",
            (page_id,),
        ).fetchall()
    return [
        {
            "id": r["id"],
            "author": r["author"],
            "note": r["note"],
            "citations": json.loads(r["citations"]),
            "created_at": r["created_at"],
        }
        for r in rows
    ]


def get_version(version_id: int) -> dict | None:
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM wiki_versions WHERE id = ?", (version_id,)
        ).fetchone()
    if not row:
        return None
    return {
        "id": row["id"],
        "page_id": row["page_id"],
        "content": row["content"],
        "author": row["author"],
        "note": row["note"],
        "citations": json.loads(row["citations"]),
        "created_at": row["created_at"],
    }


# --- search ---


def _fts_escape(query: str) -> str:
    terms = re.findall(r"\w+", query)
    if not terms:
        return '""'
    return " ".join(f'"{t}"' for t in terms)


def search_pages(query: str) -> list[dict]:
    fts_query = _fts_escape(query)
    with _connect() as conn:
        rows = conn.execute(
            """SELECT p.id, p.title, p.slug,
                      snippet(wiki_pages_fts, 1, '[', ']', '...', 10) AS snippet
               FROM wiki_pages_fts
               JOIN wiki_pages p ON p.id = wiki_pages_fts.rowid
               WHERE wiki_pages_fts MATCH ?
               ORDER BY rank""",
            (fts_query,),
        ).fetchall()
    return [
        {"id": r["id"], "title": r["title"], "slug": r["slug"], "snippet": r["snippet"]}
        for r in rows
    ]
