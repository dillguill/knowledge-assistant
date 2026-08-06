"""HF Dataset persistence: pull data/ on startup, debounced push after writes.

Single-writer invariant: exactly one Space instance writes; pushes replace
the dataset contents wholesale.

The wiki's own content is synced independently via real git push/fetch
against the same dataset repo (see pull_wiki_git/schedule_wiki_push below),
on the repo's default "main" branch. This module's whole-tree blob-replace
sync deliberately lives on a SEPARATE branch (_DATA_SYNC_REVISION) instead —
confirmed via live testing that sharing "main" between the two causes a real
non-fast-forward collision: upload_folder's commit API and a literal `git
push` from the wiki's local clone both race to advance the same ref, with
no coordination between them. Two logically independent writers get two
refs; "same repo" was never meant to imply "same branch". wiki_git/** is
still excluded from the local folder scan below (its own nested .git
internals must never be uploaded as plain files), but that's an orthogonal
concern from which branch this sync targets.
"""

import asyncio
import logging

from huggingface_hub import create_branch, snapshot_download, upload_folder

from app.config import get_settings
from app.services import wiki_git

log = logging.getLogger(__name__)
_push_task: asyncio.Task | None = None
_wiki_push_task: asyncio.Task | None = None

_DATA_SYNC_REVISION = "data-sync"

# indirection points so tests can monkeypatch without touching huggingface_hub
_snapshot_download = snapshot_download
_upload_folder = upload_folder
_create_branch = create_branch
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
        # data-sync is a branch this app itself introduces — never
        # auto-created by upload_folder/snapshot_download (per HF Hub docs),
        # so it won't exist yet on a repo's first-ever boot under this code.
        # Ensure it exists (idempotent, mirrors the push path) *before*
        # downloading from it: skipping straight to snapshot_download and
        # swallowing the resulting 404 caused a real production incident —
        # the app booted with an empty database instead of the real synced
        # content, since the failure looked identical to "first boot ever".
        _create_branch(
            repo_id=s.hf_dataset_repo, repo_type="dataset",
            branch=_DATA_SYNC_REVISION, token=s.hf_token, exist_ok=True,
        )
        _snapshot_download(
            repo_id=s.hf_dataset_repo,
            repo_type="dataset",
            local_dir=s.data_dir,
            token=s.hf_token,
            revision=_DATA_SYNC_REVISION,
        )
    except Exception as exc:  # transient network, or a genuinely absent repo
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
        # upload_folder/snapshot_download never auto-create a branch (per
        # HF Hub docs) — this ensure-step is idempotent (exist_ok=True) and
        # cheap enough to run every push rather than tracking whether it's
        # already been done once.
        _create_branch(
            repo_id=s.hf_dataset_repo, repo_type="dataset",
            branch=_DATA_SYNC_REVISION, token=s.hf_token, exist_ok=True,
        )
        _upload_folder(
            folder_path=s.data_dir,
            repo_id=s.hf_dataset_repo,
            repo_type="dataset",
            token=s.hf_token,
            revision=_DATA_SYNC_REVISION,
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
