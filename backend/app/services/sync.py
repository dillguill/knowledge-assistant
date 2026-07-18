"""HF Dataset persistence: pull data/ on startup, debounced push after writes.

Single-writer invariant: exactly one Space instance writes; pushes replace
the dataset contents wholesale.
"""

import asyncio
import logging

from huggingface_hub import snapshot_download, upload_folder

from app.config import get_settings

log = logging.getLogger(__name__)
_push_task: asyncio.Task | None = None

# indirection points so tests can monkeypatch without touching huggingface_hub
_snapshot_download = snapshot_download
_upload_folder = upload_folder


def enabled() -> bool:
    s = get_settings()
    return bool(s.hf_token and s.hf_dataset_repo)


def status() -> str:
    if not enabled():
        return "disabled"
    if _push_task is not None and not _push_task.done():
        return "pending"
    return "idle"


def pull() -> None:
    if not enabled():
        return
    s = get_settings()
    try:
        _snapshot_download(
            repo_id=s.hf_dataset_repo,
            repo_type="dataset",
            local_dir=s.data_dir,
            token=s.hf_token,
        )
    except Exception as exc:  # first boot (empty repo) or transient network
        log.warning("dataset pull skipped: %s", exc)


def schedule_push(delay_s: float = 30) -> None:
    global _push_task
    if not enabled():
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return  # no event loop (e.g. sync context) — nothing to schedule
    if _push_task is not None and not _push_task.done():
        _push_task.cancel()
    _push_task = loop.create_task(_push_after(delay_s))


async def _push_after(delay_s: float) -> None:
    await asyncio.sleep(delay_s)
    s = get_settings()
    try:
        _upload_folder(
            folder_path=s.data_dir,
            repo_id=s.hf_dataset_repo,
            repo_type="dataset",
            token=s.hf_token,
        )
    except Exception as exc:
        log.warning("dataset push failed: %s", exc)


def _reset_for_tests() -> None:
    global _push_task
    if _push_task is not None and not _push_task.done():
        _push_task.cancel()
    _push_task = None
