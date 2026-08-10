"""Persistence for skill runs and their steps.

These tables live in the shared knowledge.db but are owned here rather than in
`store.py`, following `wiki_store`'s precedent: one module owns one table
family, and every module that owns tables must be init'd by `_startup` after
`sync.pull()`.

Uniform step rows are the point. v0.8.0's analytics read this schema instead of
mining a log, so every step — including the ones that make no model call —
gets a row.
"""

import json
import sqlite3
from pathlib import Path

from app.config import get_settings

_SCHEMA = """
CREATE TABLE IF NOT EXISTS skill_runs (
    id INTEGER PRIMARY KEY,
    skill TEXT NOT NULL,
    scheduler TEXT NOT NULL,
    model TEXT,
    status TEXT NOT NULL
        CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
    input_json TEXT NOT NULL DEFAULT '{}',
    output_json TEXT,
    error_code TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    started_at TEXT,
    finished_at TEXT
);
CREATE TABLE IF NOT EXISTS skill_run_steps (
    id INTEGER PRIMARY KEY,
    run_id INTEGER NOT NULL REFERENCES skill_runs(id),
    ordinal INTEGER NOT NULL,
    name TEXT NOT NULL,
    model TEXT,
    tokens_in INTEGER,
    tokens_out INTEGER,
    latency_ms INTEGER,
    status TEXT NOT NULL
        CHECK (status IN ('running', 'succeeded', 'failed')),
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS skill_run_steps_run
    ON skill_run_steps(run_id, ordinal);
"""
# Note on the skill_runs status CHECK: 'cancelled' is listed from day one even
# though cancellation lands a PR later. SQLite cannot ALTER a CHECK constraint,
# so widening it after this table has shipped to the Space means a full table
# rebuild — exactly the v0.5.0 `documents.origin` migration that cost a
# production incident. Costing nothing now beats rebuilding later.

_ACTIVE = ("queued", "running")


class ActiveRunExists(Exception):
    """One run at a time. Free-tier rate limits make parallel runs a way to
    get 429'd, not a feature."""


def _db_path() -> Path:
    return Path(get_settings().data_dir) / "knowledge.db"


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(_db_path())
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_runs(data_dir: str) -> None:
    Path(data_dir).mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(Path(data_dir) / "knowledge.db") as conn:
        conn.executescript(_SCHEMA)


def _loads(raw: str | None) -> dict | None:
    if raw is None:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


def _run_dict(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "skill": row["skill"],
        "scheduler": row["scheduler"],
        "model": row["model"],
        "status": row["status"],
        "input": _loads(row["input_json"]) or {},
        "output": _loads(row["output_json"]),
        "error_code": row["error_code"],
        "error_message": row["error_message"],
        "created_at": row["created_at"],
        "started_at": row["started_at"],
        "finished_at": row["finished_at"],
    }


def _step_dict(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "run_id": row["run_id"],
        "ordinal": row["ordinal"],
        "name": row["name"],
        "model": row["model"],
        "tokens_in": row["tokens_in"],
        "tokens_out": row["tokens_out"],
        "latency_ms": row["latency_ms"],
        "status": row["status"],
        "error": row["error"],
    }


def active_run() -> dict | None:
    with _connect() as conn:
        row = conn.execute(
            f"SELECT * FROM skill_runs WHERE status IN ({','.join('?' * len(_ACTIVE))})"
            " ORDER BY id LIMIT 1",
            _ACTIVE,
        ).fetchone()
    return _run_dict(row) if row else None


def create_run(skill: str, scheduler: str, model: str | None, inputs: dict) -> dict:
    """Create a queued run, rejecting a second concurrent one.

    The check and the insert share one connection with no `await` between them,
    and this app is single-process/single-event-loop by invariant (see
    services/sync.py), so nothing can interleave. That invariant — not a DB
    constraint — is what makes this cap real; if the app ever grows a second
    writer, this needs a partial unique index instead.
    """
    with _connect() as conn:
        existing = conn.execute(
            f"SELECT id FROM skill_runs WHERE status IN ({','.join('?' * len(_ACTIVE))})",
            _ACTIVE,
        ).fetchone()
        if existing is not None:
            raise ActiveRunExists(f"run {existing['id']} is already active")
        cur = conn.execute(
            """INSERT INTO skill_runs (skill, scheduler, model, status, input_json)
               VALUES (?, ?, ?, 'queued', ?)""",
            (skill, scheduler, model, json.dumps(inputs)),
        )
        row = conn.execute(
            "SELECT * FROM skill_runs WHERE id = ?", (cur.lastrowid,)
        ).fetchone()
    return _run_dict(row)


def start_run(run_id: int) -> None:
    with _connect() as conn:
        conn.execute(
            "UPDATE skill_runs SET status = 'running', started_at = datetime('now')"
            " WHERE id = ?",
            (run_id,),
        )


def finish_run(run_id: int, output: dict) -> None:
    with _connect() as conn:
        conn.execute(
            """UPDATE skill_runs
               SET status = 'succeeded', output_json = ?,
                   finished_at = datetime('now')
               WHERE id = ?""",
            (json.dumps(output), run_id),
        )


def fail_run(run_id: int, code: str, message: str) -> None:
    with _connect() as conn:
        conn.execute(
            """UPDATE skill_runs
               SET status = 'failed', error_code = ?, error_message = ?,
                   finished_at = datetime('now')
               WHERE id = ?""",
            (code, message, run_id),
        )


def get_run(run_id: int) -> dict | None:
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM skill_runs WHERE id = ?", (run_id,)
        ).fetchone()
    return _run_dict(row) if row else None


def list_runs(limit: int = 25) -> list[dict]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM skill_runs ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()
    return [_run_dict(r) for r in rows]


def add_step(run_id: int, name: str) -> int:
    with _connect() as conn:
        cur = conn.execute(
            """INSERT INTO skill_run_steps (run_id, ordinal, name, status)
               VALUES (
                   ?,
                   (SELECT COALESCE(MAX(ordinal), 0) + 1
                      FROM skill_run_steps WHERE run_id = ?),
                   ?, 'running'
               )""",
            (run_id, run_id, name),
        )
        return int(cur.lastrowid)


def finish_step(
    step_id: int,
    *,
    status: str,
    model: str | None = None,
    tokens_in: int | None = None,
    tokens_out: int | None = None,
    latency_ms: int | None = None,
    error: str | None = None,
) -> None:
    with _connect() as conn:
        conn.execute(
            """UPDATE skill_run_steps
               SET status = ?, model = ?, tokens_in = ?, tokens_out = ?,
                   latency_ms = ?, error = ?
               WHERE id = ?""",
            (status, model, tokens_in, tokens_out, latency_ms, error, step_id),
        )


def list_steps(run_id: int) -> list[dict]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM skill_run_steps WHERE run_id = ? ORDER BY ordinal",
            (run_id,),
        ).fetchall()
    return [_step_dict(r) for r in rows]


def sweep_orphans() -> int:
    """Mark runs left mid-flight by a restart as failed. Returns how many.

    Detached runs live on the event loop, so a container restart destroys them
    with no chance to record anything. Without this, the row stays `running`
    forever AND permanently wedges the one-active-run cap.
    """
    with _connect() as conn:
        cur = conn.execute(
            f"""UPDATE skill_runs
                SET status = 'failed', error_code = 'orphaned',
                    error_message = 'The server restarted while this run was in progress.',
                    finished_at = datetime('now')
                WHERE status IN ({','.join('?' * len(_ACTIVE))})""",
            _ACTIVE,
        )
        swept = cur.rowcount
        conn.execute(
            # created_at is the only start time that survives a restart — the
            # in-memory timer died with the process, so latency comes from the
            # row itself rather than being left null.
            """UPDATE skill_run_steps
               SET status = 'failed', error = 'orphaned',
                   latency_ms = COALESCE(latency_ms, CAST((julianday('now') - julianday(created_at)) * 86400000 AS INTEGER))
               WHERE status = 'running'"""
        )
    return swept


def cancel_run(run_id: int) -> None:
    """Terminal, and deliberately distinct from 'failed': the user stopped this
    on purpose, and run history should say so rather than implying a defect.

    Only an active run is touched — cancelling an already-terminal run must not
    rewrite a finished record.
    """
    with _connect() as conn:
        conn.execute(
            f"""UPDATE skill_runs
                SET status = 'cancelled',
                    error_message = 'The run was cancelled.',
                    finished_at = datetime('now')
                WHERE id = ? AND status IN ({','.join('?' * len(_ACTIVE))})""",
            (run_id, *_ACTIVE),
        )
        conn.execute(
            # The step really ran; recording None loses the one number the
            # timeline shows for it.
            """UPDATE skill_run_steps
               SET status = 'failed', error = 'cancelled',
                   latency_ms = COALESCE(latency_ms, CAST((julianday('now') - julianday(created_at)) * 86400000 AS INTEGER))
               WHERE run_id = ? AND status = 'running'""",
            (run_id,),
        )
