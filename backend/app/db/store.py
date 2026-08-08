"""SQLite-backed store for collections, documents, and extracted text."""

import json
import re
import sqlite3
from pathlib import Path

from app.config import get_settings

_SCHEMA = """
CREATE TABLE IF NOT EXISTS collections (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY,
    collection_id INTEGER REFERENCES collections(id),
    filename TEXT NOT NULL,
    content_type TEXT NOT NULL,
    origin TEXT NOT NULL
        CHECK (origin IN ('upload', 'corpus', 'attachment', 'web')),
    size_bytes INTEGER NOT NULL,
    source_url TEXT,
    fetched_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS document_texts (
    document_id INTEGER PRIMARY KEY REFERENCES documents(id),
    extracted_text TEXT NOT NULL
);
CREATE VIRTUAL TABLE IF NOT EXISTS document_texts_fts USING fts5(
    extracted_text, content='document_texts', content_rowid='document_id'
);
CREATE TABLE IF NOT EXISTS web_search_cache (
    query TEXT NOT NULL,
    max_results INTEGER NOT NULL,
    results_json TEXT NOT NULL,
    fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (query, max_results)
);
"""


def _db_path() -> Path:
    return Path(get_settings().data_dir) / "knowledge.db"


def _uploads_dir() -> Path:
    return Path(get_settings().data_dir) / "uploads"


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(_db_path())
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _migrate(conn: sqlite3.Connection) -> None:
    """Additive migrations for databases created before v0.5.0. The live Space
    restores its SQLite file from the dataset repo, so `CREATE TABLE IF NOT
    EXISTS` alone never reaches an existing deployment."""
    columns = {row[1] for row in conn.execute("PRAGMA table_info(documents)")}
    if not columns:
        return
    if "source_url" not in columns:
        conn.execute("ALTER TABLE documents ADD COLUMN source_url TEXT")
    if "fetched_at" not in columns:
        conn.execute("ALTER TABLE documents ADD COLUMN fetched_at TEXT")

    row = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='documents'"
    ).fetchone()
    if row is None or "'web'" in row[0]:
        return
    # SQLite cannot ALTER a CHECK constraint, so widening `origin` to accept
    # 'web' means rebuilding the table. Ids are carried over explicitly:
    # document_texts and the FTS index both key on them.
    conn.executescript(
        """
        PRAGMA foreign_keys = OFF;
        CREATE TABLE documents_new (
            id INTEGER PRIMARY KEY,
            collection_id INTEGER REFERENCES collections(id),
            filename TEXT NOT NULL,
            content_type TEXT NOT NULL,
            origin TEXT NOT NULL
                CHECK (origin IN ('upload', 'corpus', 'attachment', 'web')),
            size_bytes INTEGER NOT NULL,
            source_url TEXT,
            fetched_at TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO documents_new
            (id, collection_id, filename, content_type, origin, size_bytes,
             source_url, fetched_at, created_at)
            SELECT id, collection_id, filename, content_type, origin,
                   size_bytes, source_url, fetched_at, created_at
            FROM documents;
        DROP TABLE documents;
        ALTER TABLE documents_new RENAME TO documents;
        PRAGMA foreign_keys = ON;
        """
    )


def init_db(data_dir: str) -> None:
    Path(data_dir).mkdir(parents=True, exist_ok=True)
    (Path(data_dir) / "uploads").mkdir(exist_ok=True)
    with sqlite3.connect(Path(data_dir) / "knowledge.db") as conn:
        _migrate(conn)
        conn.executescript(_SCHEMA)


def _collection_row(row: sqlite3.Row, file_count: int) -> dict:
    return {"id": row["id"], "name": row["name"], "file_count": file_count}


def create_collection(name: str) -> dict:
    with _connect() as conn:
        cur = conn.execute("INSERT INTO collections (name) VALUES (?)", (name,))
        row = conn.execute(
            "SELECT * FROM collections WHERE id = ?", (cur.lastrowid,)
        ).fetchone()
    return _collection_row(row, 0)


def list_collections() -> list[dict]:
    with _connect() as conn:
        rows = conn.execute(
            """SELECT c.*, COUNT(d.id) AS file_count
               FROM collections c LEFT JOIN documents d ON d.collection_id = c.id
               GROUP BY c.id ORDER BY c.name"""
        ).fetchall()
    return [_collection_row(r, r["file_count"]) for r in rows]


def _doc_dict(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "collection_id": row["collection_id"],
        "filename": row["filename"],
        "content_type": row["content_type"],
        "origin": row["origin"],
        "size_bytes": row["size_bytes"],
        # Rows selected before the migration ran won't carry these.
        "source_url": row["source_url"] if "source_url" in row.keys() else None,
        "fetched_at": row["fetched_at"] if "fetched_at" in row.keys() else None,
    }


def _safe_name(filename: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]", "_", filename)


def add_document(
    collection_id: int | None,
    filename: str,
    content_type: str,
    origin: str,
    raw: bytes,
    text: str,
) -> dict:
    with _connect() as conn:
        cur = conn.execute(
            """INSERT INTO documents
               (collection_id, filename, content_type, origin, size_bytes)
               VALUES (?, ?, ?, ?, ?)""",
            (collection_id, filename, content_type, origin, len(raw)),
        )
        doc_id = cur.lastrowid
        conn.execute(
            "INSERT INTO document_texts (document_id, extracted_text) VALUES (?, ?)",
            (doc_id, text),
        )
        conn.execute(
            "INSERT INTO document_texts_fts (rowid, extracted_text) VALUES (?, ?)",
            (doc_id, text),
        )
        row = conn.execute(
            "SELECT * FROM documents WHERE id = ?", (doc_id,)
        ).fetchone()
    doc = _doc_dict(row)
    get_document_path(doc).write_bytes(raw)
    return doc


def list_documents(collection_id: int) -> list[dict]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM documents WHERE collection_id = ? ORDER BY id",
            (collection_id,),
        ).fetchall()
    return [_doc_dict(r) for r in rows]


def get_document(doc_id: int) -> dict | None:
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM documents WHERE id = ?", (doc_id,)
        ).fetchone()
    return _doc_dict(row) if row else None


def get_document_path(doc: dict) -> Path:
    return _uploads_dir() / f"{doc['id']}_{_safe_name(doc['filename'])}"


def get_texts(doc_ids: list[int]) -> list[tuple[dict, str]]:
    out: list[tuple[dict, str]] = []
    with _connect() as conn:
        for doc_id in doc_ids:
            row = conn.execute(
                """SELECT d.*, t.extracted_text FROM documents d
                   JOIN document_texts t ON t.document_id = d.id
                   WHERE d.id = ?""",
                (doc_id,),
            ).fetchone()
            if row:
                out.append((_doc_dict(row), row["extracted_text"]))
    return out


def normalize_query(query: str) -> str:
    """Cache key normalization — case- and whitespace-insensitive."""
    return " ".join(query.lower().split())


def get_cached_search(query: str, max_results: int, ttl_s: int) -> list[dict] | None:
    """Return cached results if present and younger than ttl_s, else None."""
    with _connect() as conn:
        row = conn.execute(
            """SELECT results_json FROM web_search_cache
               WHERE query = ? AND max_results = ?
                 AND fetched_at > datetime('now', ?)""",
            (normalize_query(query), max_results, f"-{int(ttl_s)} seconds"),
        ).fetchone()
    return json.loads(row["results_json"]) if row else None


def put_cached_search(query: str, max_results: int, results: list[dict]) -> None:
    with _connect() as conn:
        conn.execute(
            """INSERT INTO web_search_cache (query, max_results, results_json, fetched_at)
               VALUES (?, ?, ?, datetime('now'))
               ON CONFLICT(query, max_results) DO UPDATE SET
                 results_json = excluded.results_json,
                 fetched_at = excluded.fetched_at""",
            (normalize_query(query), max_results, json.dumps(results)),
        )


def get_or_create_collection(name: str) -> dict:
    """Idempotent collection lookup, so archiving a web page never depends on
    the 'Web' collection having been seeded first."""
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM collections WHERE name = ?", (name,)
        ).fetchone()
        if row is not None:
            count = conn.execute(
                "SELECT COUNT(*) AS n FROM documents WHERE collection_id = ?",
                (row["id"],),
            ).fetchone()["n"]
            return _collection_row(row, count)
    return create_collection(name)


def upsert_web_document(collection_id: int, url: str, title: str, text: str) -> dict:
    """Archive a fetched web page as a document. The URL is the identity — a
    re-save updates the existing row rather than duplicating it."""
    raw = text.encode("utf-8")
    with _connect() as conn:
        existing = conn.execute(
            "SELECT * FROM documents WHERE source_url = ?", (url,)
        ).fetchone()
        if existing is not None:
            doc_id = existing["id"]
            # FTS5 external-content rule: the index is removed by replaying the
            # OLD text through the 'delete' command, and it must happen BEFORE
            # the backing row changes. Reversed, the old terms stay in the
            # index forever and stale documents keep matching.
            old = conn.execute(
                "SELECT extracted_text FROM document_texts WHERE document_id = ?",
                (doc_id,),
            ).fetchone()
            if old is not None:
                conn.execute(
                    "INSERT INTO document_texts_fts (document_texts_fts, rowid,"
                    " extracted_text) VALUES ('delete', ?, ?)",
                    (doc_id, old["extracted_text"]),
                )
            conn.execute(
                """UPDATE documents
                   SET filename = ?, size_bytes = ?, fetched_at = datetime('now')
                   WHERE id = ?""",
                (title, len(raw), doc_id),
            )
            conn.execute(
                "UPDATE document_texts SET extracted_text = ? WHERE document_id = ?",
                (text, doc_id),
            )
            conn.execute(
                "INSERT INTO document_texts_fts (rowid, extracted_text) VALUES (?, ?)",
                (doc_id, text),
            )
        else:
            cur = conn.execute(
                """INSERT INTO documents
                   (collection_id, filename, content_type, origin, size_bytes,
                    source_url, fetched_at)
                   VALUES (?, ?, 'text/markdown', 'web', ?, ?, datetime('now'))""",
                (collection_id, title, len(raw), url),
            )
            doc_id = cur.lastrowid
            conn.execute(
                "INSERT INTO document_texts (document_id, extracted_text) VALUES (?, ?)",
                (doc_id, text),
            )
            conn.execute(
                "INSERT INTO document_texts_fts (rowid, extracted_text) VALUES (?, ?)",
                (doc_id, text),
            )
        row = conn.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone()
    doc = _doc_dict(row)
    get_document_path(doc).write_bytes(raw)
    return doc


def find_cached_result(url: str) -> dict | None:
    """Look up a single cached web result by URL, newest cache row first.
    Backs archiving a result the browser never held the body for."""
    with _connect() as conn:
        rows = conn.execute(
            "SELECT results_json FROM web_search_cache ORDER BY fetched_at DESC"
        ).fetchall()
    for row in rows:
        try:
            results = json.loads(row["results_json"])
        except json.JSONDecodeError:
            continue
        if not isinstance(results, list):
            continue
        for result in results:
            if isinstance(result, dict) and result.get("url") == url:
                return result
    return None
