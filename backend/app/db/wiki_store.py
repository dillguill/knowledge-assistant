"""SQLite-backed store for wiki folders, pages, versions, and proposals."""

import json
import logging
import re
import sqlite3
from pathlib import Path

from app.config import get_settings
from app.services import wiki_git

log = logging.getLogger(__name__)

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
    proposal_number INTEGER NOT NULL DEFAULT 0,  -- per-page sequence (new-page proposals share one bucket)
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
    """Idempotent schema migrations for databases created before a column was
    added to _SCHEMA. `CREATE TABLE IF NOT EXISTS` never re-adds columns to an
    existing table, so post-creation columns must be ALTERed in here.

    Reads use integer tuple indices (``row[0]``/``row[1]``) rather than column
    names so the backfill is independent of the connection's ``row_factory``.
    """
    cols = {row[1] for row in conn.execute("PRAGMA table_info(wiki_proposals)").fetchall()}
    if "proposal_number" not in cols:
        conn.execute(
            "ALTER TABLE wiki_proposals ADD COLUMN proposal_number INTEGER NOT NULL DEFAULT 0"
        )
        # Backfill existing rows with a per-page sequence number ordered by id.
        # New-page proposals (page_id IS NULL) share a single bucket keyed by -1.
        rows = conn.execute(
            "SELECT id, COALESCE(page_id, -1) FROM wiki_proposals ORDER BY id"
        ).fetchall()
        counts: dict[int, int] = {}
        for row in rows:
            group_key = row[1]
            counts[group_key] = counts.get(group_key, 0) + 1
            conn.execute(
                "UPDATE wiki_proposals SET proposal_number = ? WHERE id = ?",
                (counts[group_key], row[0]),
            )

    if "commit_sha" not in cols:
        conn.execute("ALTER TABLE wiki_proposals ADD COLUMN commit_sha TEXT")

    page_cols = {row[1] for row in conn.execute("PRAGMA table_info(wiki_pages)").fetchall()}
    if "git_path" not in page_cols:
        conn.execute("ALTER TABLE wiki_pages ADD COLUMN git_path TEXT")


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


# --- git sync ---
#
# Failure policy is deliberately lenient: SQLite is the source of truth, and
# every function below is called *after* the SQLite write that matters has
# already committed (its own `with _connect()` block has exited) — never from
# inside that transaction. A git failure is logged and swallowed, not raised,
# so a page write always succeeds for the caller even if git has a transient
# problem. Every write already re-attempts the sync with fresh content, so a
# page edited again naturally self-heals; `resync_page`/`reconcile_git` below
# cover pages that just sit stale with no new edits. See
# context/v0.4.5_wiki-git-enhancement.md's "Resolved decisions" section.


def _folder_path_parts(conn: sqlite3.Connection, folder_id: int | None) -> list[str]:
    """Root-to-leaf slugified folder-name segments, for deriving a page's git
    file path. Cycle-safe (visited-set guard): move_folder has no cycle
    prevention today, so a corrupted parent chain must not hang this walk."""
    parts: list[str] = []
    visited: set[int] = set()
    current = folder_id
    while current is not None and current not in visited:
        visited.add(current)
        row = conn.execute(
            "SELECT name, parent_id FROM wiki_folders WHERE id = ?", (current,)
        ).fetchone()
        if row is None:
            break
        parts.append(_slugify(row["name"]))
        current = row["parent_id"]
    parts.reverse()
    return parts


def _sync_page_to_git(page_id: int, author: str, note: str = "") -> str | None:
    """Best-effort: never raises. Commits the page's current content to git
    and persists the resulting file path. Returns the commit sha, or None if
    the git commit failed (logged) or the page no longer exists."""
    page = get_page(page_id)
    if page is None:
        return None
    with _connect() as conn:
        old_path_row = conn.execute(
            "SELECT git_path FROM wiki_pages WHERE id = ?", (page_id,)
        ).fetchone()
        old_path = old_path_row["git_path"] if old_path_row else None
        folder_parts = _folder_path_parts(conn, page["folder_id"])
    try:
        sha, new_path = wiki_git.commit_page(
            data_dir=get_settings().data_dir,
            folder_path_parts=folder_parts,
            slug=page["slug"],
            title=page["title"],
            content=page["content"],
            created_at=page["created_at"],
            updated_at=page["updated_at"],
            author=author,
            note=note,
            old_relative_path=old_path,
        )
    except wiki_git.GitCommitError:
        log.error("wiki git commit failed for page %s", page_id, exc_info=True)
        return None
    with _connect() as conn:
        conn.execute(
            "UPDATE wiki_pages SET git_path = ? WHERE id = ?", (new_path, page_id)
        )
    return sha


def _descendant_page_ids(conn: sqlite3.Connection, folder_id: int) -> list[int]:
    """All page ids under folder_id, including nested subfolders. Cycle-safe."""
    folder_ids: list[int] = []
    visited: set[int] = set()
    frontier = [folder_id]
    while frontier:
        current = frontier.pop()
        if current in visited:
            continue
        visited.add(current)
        folder_ids.append(current)
        children = conn.execute(
            "SELECT id FROM wiki_folders WHERE parent_id = ?", (current,)
        ).fetchall()
        frontier.extend(row["id"] for row in children)
    if not folder_ids:
        return []
    placeholders = ",".join("?" * len(folder_ids))
    rows = conn.execute(
        f"SELECT id FROM wiki_pages WHERE folder_id IN ({placeholders})", folder_ids
    ).fetchall()
    return [row["id"] for row in rows]


def _resync_subtree_git(folder_id: int, note: str) -> None:
    """Re-sync every page under folder_id (recursively) to git — called after
    a folder rename/move, since every descendant page's file path changes."""
    with _connect() as conn:
        page_ids = _descendant_page_ids(conn, folder_id)
    for page_id in page_ids:
        _sync_page_to_git(page_id, author="owner", note=note)


def resync_page(page_id: int) -> str | None:
    """Owner-triggered manual re-sync of a single page to git — covers a page
    that's sat stale with no new edits since a prior git failure."""
    if get_page(page_id) is None:
        raise ValueError("Page not found")
    return _sync_page_to_git(page_id, author="owner", note="resync")


def reconcile_git() -> int:
    """Boot-time backstop: re-sync every page to git. Safe to call
    unconditionally — commit_page is no-op-safe, so already-synced pages
    produce no new commits. Returns the number of pages successfully synced
    (informational, for a boot log line — not a strict "changed" count)."""
    synced = 0
    for page in list_pages():
        sha = _sync_page_to_git(
            page["id"], author=page["last_author"] or "owner", note="reconcile"
        )
        if sha is not None:
            synced += 1
    return synced


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
    _resync_subtree_git(folder_id, note="folder path changed")


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
    _resync_subtree_git(folder_id, note="folder path changed")


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
        page = _create_page_tx(conn, title, folder_id, content, author)
    _sync_page_to_git(page["id"], author, note="created")
    return page


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
        page = _update_page_content_tx(conn, page_id, content, author, note, citations)
    _sync_page_to_git(page_id, author, note)
    return page


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
    _sync_page_to_git(page_id, author="owner", note=f"renamed to {title}")


def move_page(page_id: int, folder_id: int | None) -> None:
    with _connect() as conn:
        conn.execute(
            "UPDATE wiki_pages SET folder_id = ? WHERE id = ?", (folder_id, page_id)
        )
    _sync_page_to_git(page_id, author="owner", note="moved to a different folder")


def delete_page(page_id: int) -> None:
    with _connect() as conn:
        row = conn.execute(
            "SELECT git_path FROM wiki_pages WHERE id = ?", (page_id,)
        ).fetchone()
        old_path = row["git_path"] if row else None
        conn.execute("DELETE FROM wiki_pages_fts WHERE rowid = ?", (page_id,))
        conn.execute("DELETE FROM wiki_pages WHERE id = ?", (page_id,))
    if old_path is not None:
        try:
            wiki_git.delete_page_file(
                data_dir=get_settings().data_dir, relative_path=old_path,
                author="owner", note="deleted",
            )
        except wiki_git.GitCommitError:
            log.error("wiki git delete failed for page %s", page_id, exc_info=True)


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
        # Assign the next per-page proposal number. New-page proposals
        # (page_id IS NULL) share a single bucket keyed by -1.
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

    sha = _sync_page_to_git(
        page["id"], author="assistant",
        note=f"approved proposal #{proposal['proposal_number']}",
    )
    if sha is not None:
        with _connect() as conn:
            conn.execute(
                "UPDATE wiki_proposals SET commit_sha = ? WHERE id = ?",
                (sha, proposal_id),
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
