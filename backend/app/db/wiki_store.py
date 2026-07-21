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
    proposal_number INTEGER NOT NULL DEFAULT 0,
    title TEXT NOT NULL,
    folder_id INTEGER REFERENCES wiki_folders(id) ON DELETE SET NULL,
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


def _migrate(conn: sqlite3.Connection) -> None:
    """Idempotent schema migrations for databases created before a column
    was added to _SCHEMA.  Add new ALTER TABLE blocks here; _SCHEMA itself
    is only applied by CREATE TABLE IF NOT EXISTS and won't re-add columns
    that were added after the original creation."""
    cols = {r[1] for r in conn.execute("PRAGMA table_info(wiki_proposals)").fetchall()}
    if "proposal_number" not in cols:
        conn.execute(
            "ALTER TABLE wiki_proposals ADD COLUMN proposal_number INTEGER NOT NULL DEFAULT 0"
        )
        # Backfill existing rows with a per-page sequence number ordered by id.
        rows = conn.execute(
            "SELECT id, COALESCE(page_id, -1) AS group_key FROM wiki_proposals ORDER BY id"
        ).fetchall()
        counts: dict[int, int] = {}
        for r in rows:
            gk = r[1]
            counts[gk] = counts.get(gk, 0) + 1
            conn.execute(
                "UPDATE wiki_proposals SET proposal_number = ? WHERE id = ?",
                (counts[gk], r[0]),
            )


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(_db_path())
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_wiki(data_dir: str) -> None:
    Path(data_dir).mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(Path(data_dir) / "knowledge.db") as conn:
        conn.executescript(_SCHEMA)
        _migrate(conn)


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


def _check_folder_name_uniqueness(
    conn: sqlite3.Connection, name: str, parent_id: int | None, exclude_id: int | None = None
) -> None:
    """Check if another folder with the same name and parent already exists.

    Handles NULL parent_id correctly using IS NULL (since SQLite treats NULL != NULL).
    Raises sqlite3.IntegrityError if a conflict is found.
    exclude_id: if provided, ignore folders with this ID (used during rename/move).
    """
    if parent_id is None:
        # Check for root-level duplicate
        query = "SELECT 1 FROM wiki_folders WHERE name = ? AND parent_id IS NULL"
        params = (name,)
    else:
        # Check for duplicate within a specific parent
        query = "SELECT 1 FROM wiki_folders WHERE name = ? AND parent_id = ?"
        params = (name, parent_id)

    if exclude_id is not None:
        query += " AND id != ?"
        params = params + (exclude_id,)

    if conn.execute(query, params).fetchone():
        raise sqlite3.IntegrityError("duplicate folder name")


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
        _check_folder_name_uniqueness(conn, name, parent_id)
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
        # Get the folder's current parent_id before checking
        folder = conn.execute(
            "SELECT parent_id FROM wiki_folders WHERE id = ?", (folder_id,)
        ).fetchone()
        if not folder:
            raise ValueError("Folder not found")
        _check_folder_name_uniqueness(conn, name, folder["parent_id"], exclude_id=folder_id)
        conn.execute(
            "UPDATE wiki_folders SET name = ? WHERE id = ?", (name, folder_id)
        )


def move_folder(folder_id: int, parent_id: int | None) -> None:
    with _connect() as conn:
        # Get the folder's name before checking
        folder = conn.execute(
            "SELECT name FROM wiki_folders WHERE id = ?", (folder_id,)
        ).fetchone()
        if not folder:
            raise ValueError("Folder not found")
        _check_folder_name_uniqueness(conn, folder["name"], parent_id, exclude_id=folder_id)
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


def _create_page_tx(
    conn: sqlite3.Connection,
    title: str,
    folder_id: int | None,
    content: str,
    author: str,
) -> dict:
    """Create a page, its first version, and its FTS entry on an open connection.

    Caller owns the transaction (commit/rollback) via its own `with _connect()`
    block; this helper only issues statements on the supplied connection.
    """
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


def create_page(title: str, folder_id: int | None, content: str, author: str) -> dict:
    with _connect() as conn:
        return _create_page_tx(conn, title, folder_id, content, author)


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


def _update_page_content_tx(
    conn: sqlite3.Connection,
    page_id: int,
    content: str,
    author: str,
    note: str = "",
    citations: list | None = None,
) -> dict:
    """Append a version, update the page content, and resync FTS on an open connection.

    Caller owns the transaction (commit/rollback) via its own `with _connect()`
    block; this helper only issues statements on the supplied connection.
    """
    citations_json = json.dumps(citations or [])
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


def update_page_content(
    page_id: int,
    content: str,
    author: str,
    note: str = "",
    citations: list | None = None,
) -> dict:
    with _connect() as conn:
        return _update_page_content_tx(conn, page_id, content, author, note, citations)


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


class PendingCapExceeded(Exception):
    """Raised when the pending proposal queue is already at capacity."""


_PENDING_CAP = 25


def pending_proposals_full() -> bool:
    """Cheap pre-check so callers can skip expensive work (e.g. an LLM call)
    before hitting the authoritative cap check inside create_proposal."""
    with _connect() as conn:
        pending_count = conn.execute(
            "SELECT COUNT(*) AS n FROM wiki_proposals WHERE status = 'pending'"
        ).fetchone()["n"]
    return pending_count >= _PENDING_CAP


# --- proposals ---


def _proposal_dict(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "page_id": row["page_id"],
        "proposal_number": row["proposal_number"],
        "title": row["title"],
        "folder_id": row["folder_id"],
        "base_version_id": row["base_version_id"],
        "content": row["content"],
        "rationale": row["rationale"],
        "citations": json.loads(row["citations"]),
        "status": row["status"],
        "created_at": row["created_at"],
        "decided_at": row["decided_at"],
    }


def create_proposal(
    page_id: int | None,
    title: str,
    folder_id: int | None,
    content: str,
    rationale: str = "",
    citations: list | None = None,
) -> dict:
    citations_json = json.dumps(citations or [])
    with _connect() as conn:
        pending_count = conn.execute(
            "SELECT COUNT(*) AS n FROM wiki_proposals WHERE status = 'pending'"
        ).fetchone()["n"]
        if pending_count >= _PENDING_CAP:
            raise PendingCapExceeded("Pending proposal queue is full.")

        base_version_id = None
        if page_id is not None:
            version_row = conn.execute(
                """SELECT id FROM wiki_versions WHERE page_id = ?
                   ORDER BY id DESC LIMIT 1""",
                (page_id,),
            ).fetchone()
            base_version_id = version_row["id"] if version_row else None

        cur = conn.execute(
            """INSERT INTO wiki_proposals
                   (page_id, title, folder_id, base_version_id, content,
                    rationale, citations)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (page_id, title, folder_id, base_version_id, content,
             rationale, citations_json),
        )
        # Assign a per-page proposal number (new-page proposals share the NULL
        # bucket, using -1 as a surrogate for the grouping key).
        group_key = page_id if page_id is not None else -1
        conn.execute(
            """UPDATE wiki_proposals SET proposal_number = (
                   SELECT COALESCE(MAX(proposal_number), 0) + 1
                   FROM wiki_proposals
                   WHERE COALESCE(page_id, -1) = ?
               ) WHERE id = ?""",
            (group_key, cur.lastrowid),
        )
        row = conn.execute(
            "SELECT * FROM wiki_proposals WHERE id = ?", (cur.lastrowid,)
        ).fetchone()
    return _proposal_dict(row)


def get_proposal(proposal_id: int) -> dict | None:
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM wiki_proposals WHERE id = ?", (proposal_id,)
        ).fetchone()
    return _proposal_dict(row) if row else None


def list_proposals(status: str | None = None) -> list[dict]:
    with _connect() as conn:
        if status is None:
            rows = conn.execute(
                "SELECT * FROM wiki_proposals ORDER BY id DESC"
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM wiki_proposals WHERE status = ? ORDER BY id DESC",
                (status,),
            ).fetchall()
    return [_proposal_dict(r) for r in rows]


def approve_proposal(proposal_id: int) -> dict:
    # Single transaction: fetch + validate the proposal, write the page/version
    # content, and flip the proposal's status all on one connection, so any
    # failure before commit rolls back the entire approval atomically.
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM wiki_proposals WHERE id = ?", (proposal_id,)
        ).fetchone()
        if row is None:
            raise ValueError("Proposal not found")
        proposal = _proposal_dict(row)
        if proposal["status"] != "pending":
            raise ValueError("Proposal is not pending")

        if proposal["page_id"] is None:
            page = _create_page_tx(
                conn, proposal["title"], proposal["folder_id"], proposal["content"],
                author="assistant",
            )
        else:
            # page_id, when set, is guaranteed to reference a live page: the
            # schema's ON DELETE CASCADE removes a proposal the moment its
            # target page is deleted, so a fetchable proposal with a non-null
            # page_id always has a live page behind it.
            page = _update_page_content_tx(
                conn, proposal["page_id"], proposal["content"], author="assistant",
                note=f"approved proposal #{proposal['proposal_number']} (page #{proposal['page_id']})",
                citations=proposal["citations"],
            )

        conn.execute(
            """UPDATE wiki_proposals
               SET status = 'approved', decided_at = datetime('now')
               WHERE id = ?""",
            (proposal_id,),
        )
    return page


def reject_proposal(proposal_id: int) -> dict:
    proposal = get_proposal(proposal_id)
    if proposal is None:
        raise ValueError("Proposal not found")
    if proposal["status"] != "pending":
        raise ValueError("Proposal is not pending")
    with _connect() as conn:
        conn.execute(
            """UPDATE wiki_proposals
               SET status = 'rejected', decided_at = datetime('now')
               WHERE id = ?""",
            (proposal_id,),
        )
        row = conn.execute(
            "SELECT * FROM wiki_proposals WHERE id = ?", (proposal_id,)
        ).fetchone()
    return _proposal_dict(row)


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
