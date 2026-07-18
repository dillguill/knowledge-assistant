"""SQLite-backed store for collections, documents, and extracted text."""

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
    origin TEXT NOT NULL CHECK (origin IN ('upload', 'corpus', 'attachment')),
    size_bytes INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS document_texts (
    document_id INTEGER PRIMARY KEY REFERENCES documents(id),
    extracted_text TEXT NOT NULL
);
CREATE VIRTUAL TABLE IF NOT EXISTS document_texts_fts USING fts5(
    extracted_text, content='document_texts', content_rowid='document_id'
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


def init_db(data_dir: str) -> None:
    Path(data_dir).mkdir(parents=True, exist_ok=True)
    (Path(data_dir) / "uploads").mkdir(exist_ok=True)
    with sqlite3.connect(Path(data_dir) / "knowledge.db") as conn:
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
