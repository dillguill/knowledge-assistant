"""HF Dataset persistence: pull data/ on startup, debounced push after writes.

Single-writer invariant: exactly one Space instance writes; pushes replace
the dataset contents wholesale.

The wiki's own content (wiki/**, at the dataset repo's root) is synced
independently via real git push/fetch against the same dataset repo (see
pull_wiki_git/schedule_wiki_push below) — this module's whole-tree
snapshot_download/upload_folder calls exclude it in both directions so the
two sync mechanisms never touch the same files (see wiki_git.py's remote
sync functions for why mixing them would corrupt the git object store).
"""

import asyncio
import logging

from huggingface_hub import snapshot_download, upload_folder

from app.config import get_settings
from app.services import wiki_git

log = logging.getLogger(__name__)
_push_task: asyncio.Task | None = None
_wiki_push_task: asyncio.Task | None = None

# indirection points so tests can monkeypatch without touching huggingface_hub
_snapshot_download = snapshot_download
_upload_folder = upload_folder
_wiki_git_push = wiki_git.push
_wiki_git_pull_or_clone = wiki_git.pull_or_clone


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
            ignore_patterns=["wiki/**"],
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
            ignore_patterns=["wiki_git/**"],
        )
    except Exception as exc:
        log.warning("dataset push failed: %s", exc)


def pull_wiki_git() -> None:
    """Boot-time counterpart to pull(): bring the local wiki git working
    tree in line with the HF dataset repo's real git history before
    anything (reconcile_git, a fresh write) trusts local state — a naive
    local-init-first ordering would otherwise create a divergent local
    history on every fresh-container boot."""
    if not enabled():
        return
    s = get_settings()
    try:
        url = wiki_git.remote_url(s.hf_token, s.hf_dataset_repo)
        wiki_git.ensure_remote(s.data_dir, url)
        _wiki_git_pull_or_clone(s.data_dir)
    except Exception as exc:
        log.warning("wiki git pull skipped: %s", exc)


def schedule_wiki_push(delay_s: float = 30) -> None:
    global _wiki_push_task
    if not enabled():
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    if _wiki_push_task is not None and not _wiki_push_task.done():
        _wiki_push_task.cancel()
    _wiki_push_task = loop.create_task(_wiki_push_after(delay_s))


async def _wiki_push_after(delay_s: float) -> None:
    await asyncio.sleep(delay_s)
    s = get_settings()
    try:
        url = wiki_git.remote_url(s.hf_token, s.hf_dataset_repo)
        wiki_git.ensure_remote(s.data_dir, url)
        _wiki_git_push(s.data_dir)
    except Exception as exc:
        log.warning("wiki git push failed: %s", exc)


def _reset_for_tests() -> None:
    global _push_task, _wiki_push_task
    if _push_task is not None and not _push_task.done():
        _push_task.cancel()
    _push_task = None
    if _wiki_push_task is not None and not _wiki_push_task.done():
        _wiki_push_task.cancel()
    _wiki_push_task = None
