import subprocess

import pytest

from app.services import wiki_git


@pytest.fixture
def data_dir(tmp_path):
    return str(tmp_path)


def _log(repo):
    result = subprocess.run(
        ["git", "log", "--format=%H"], cwd=repo, capture_output=True, text=True
    )
    return result.stdout.split()


def _commit_message(repo, sha):
    result = subprocess.run(
        ["git", "show", "-s", "--format=%B", sha], cwd=repo, capture_output=True, text=True
    )
    return result.stdout


# --- ensure_repo ---


def test_ensure_repo_is_idempotent_and_sets_identity(data_dir):
    repo = wiki_git.ensure_repo(data_dir)
    wiki_git.ensure_repo(data_dir)  # second call must not raise
    assert (repo / ".git").is_dir()
    name = subprocess.run(
        ["git", "config", "user.name"], cwd=repo, capture_output=True, text=True
    ).stdout.strip()
    email = subprocess.run(
        ["git", "config", "user.email"], cwd=repo, capture_output=True, text=True
    ).stdout.strip()
    assert name == wiki_git.GIT_AUTHOR_NAME
    assert email == wiki_git.GIT_AUTHOR_EMAIL


# --- frontmatter ---


def test_render_and_parse_frontmatter_round_trip():
    text = wiki_git.render_frontmatter(
        "Torque Specs", "torque-specs", "2024-01-01 00:00:00", "2026-08-05 12:00:00"
    )
    fields, body = wiki_git.parse_frontmatter(text + "Use 22 Nm.")
    assert fields == {
        "title": "Torque Specs",
        "slug": "torque-specs",
        "created_at": "2024-01-01 00:00:00",
        "updated_at": "2026-08-05 12:00:00",
    }
    assert body == "Use 22 Nm."


def test_parse_frontmatter_handles_quoted_special_characters():
    text = wiki_git.render_frontmatter('He said "hi"', "he-said-hi", "t1", "t2")
    fields, _ = wiki_git.parse_frontmatter(text)
    assert fields["title"] == 'He said "hi"'


def test_parse_frontmatter_returns_empty_fields_when_absent():
    fields, body = wiki_git.parse_frontmatter("just a body, no frontmatter")
    assert fields == {}
    assert body == "just a body, no frontmatter"


# --- commit_page ---


def test_commit_page_writes_file_and_returns_sha(data_dir):
    sha, path = wiki_git.commit_page(
        data_dir=data_dir,
        folder_path_parts=["engines"],
        slug="torque-specs",
        title="Torque Specs",
        content="Use 22 Nm.",
        created_at="2024-01-01 00:00:00",
        updated_at="2024-01-01 00:00:00",
        author="owner",
        note="created",
    )
    assert path == "wiki/engines/torque-specs.md"
    repo = wiki_git._repo_dir(data_dir)
    full = repo / path
    assert full.exists()
    assert "Use 22 Nm." in full.read_text()
    assert sha in _log(repo)


def test_commit_page_root_page_has_no_folder_segment(data_dir):
    _, path = wiki_git.commit_page(
        data_dir=data_dir,
        folder_path_parts=[],
        slug="oil-change",
        title="Oil Change",
        content="body",
        created_at="t1",
        updated_at="t1",
        author="owner",
        note="created",
    )
    assert path == "wiki/oil-change.md"


def test_commit_page_message_contains_trailers(data_dir):
    sha, _ = wiki_git.commit_page(
        data_dir=data_dir,
        folder_path_parts=[],
        slug="oil-change",
        title="Oil Change",
        content="body",
        created_at="t1",
        updated_at="t1",
        author="assistant",
        note="drafted",
    )
    repo = wiki_git._repo_dir(data_dir)
    msg = _commit_message(repo, sha)
    assert msg.startswith("drafted")
    assert "wiki-author: assistant" in msg
    assert "wiki-slug: oil-change" in msg


def test_commit_page_identical_content_is_a_noop(data_dir):
    kwargs = dict(
        data_dir=data_dir,
        folder_path_parts=[],
        slug="oil-change",
        title="Oil Change",
        content="body",
        created_at="t1",
        updated_at="t1",
        author="owner",
        note="created",
    )
    sha1, _ = wiki_git.commit_page(**kwargs)
    sha2, _ = wiki_git.commit_page(**kwargs)
    assert sha1 == sha2
    repo = wiki_git._repo_dir(data_dir)
    assert len(_log(repo)) == 1


def test_commit_page_move_relocates_file_in_one_commit(data_dir):
    sha1, old_path = wiki_git.commit_page(
        data_dir=data_dir,
        folder_path_parts=["engines"],
        slug="torque-specs",
        title="Torque Specs",
        content="body",
        created_at="t1",
        updated_at="t1",
        author="owner",
        note="created",
    )
    sha2, new_path = wiki_git.commit_page(
        data_dir=data_dir,
        folder_path_parts=["motors"],
        slug="torque-specs",
        title="Torque Specs",
        content="body",
        created_at="t1",
        updated_at="t2",
        author="owner",
        note="moved to a different folder",
        old_relative_path=old_path,
    )
    assert sha1 != sha2
    repo = wiki_git._repo_dir(data_dir)
    assert not (repo / old_path).exists()
    assert (repo / new_path).exists()
    assert len(_log(repo)) == 2


def test_commit_page_raises_git_commit_error_when_git_unavailable(data_dir, monkeypatch):
    def boom(args, **kwargs):
        raise OSError("git binary not found")

    monkeypatch.setattr(wiki_git, "_run_git", boom)
    with pytest.raises(wiki_git.GitCommitError):
        wiki_git.commit_page(
            data_dir=data_dir,
            folder_path_parts=[],
            slug="oil-change",
            title="Oil Change",
            content="body",
            created_at="t1",
            updated_at="t1",
            author="owner",
            note="created",
        )


# --- delete_page_file ---


def test_log_for_page_ignores_non_wiki_paths_including_binary_files(data_dir):
    # Regression: a real production repo's history includes pre-existing
    # whole-tree-sync commits touching binary files (a sqlite db, PDFs)
    # outside wiki/ entirely, from before the wiki-git migration. log_for_page
    # used to `git show` every changed path in every commit and decode it as
    # UTF-8 text — crashing with an uncaught UnicodeDecodeError on the first
    # binary blob it hit, 500ing the history endpoint for every page. Page
    # files only ever live under wiki/, so non-wiki paths must be skipped
    # outright rather than attempted at all.
    repo = wiki_git.ensure_repo(data_dir)
    (repo / "knowledge.db").write_bytes(b"\xff\xfe\x00\x01binary-not-utf8\x80\x81")
    subprocess.run(["git", "add", "-A"], cwd=repo, check=True)
    subprocess.run(
        ["git", "commit", "-m", "Upload folder using huggingface_hub"],
        cwd=repo, check=True,
    )
    sha, _ = wiki_git.commit_page(
        data_dir=data_dir, folder_path_parts=[], slug="oil-change", title="Oil Change",
        content="v1", created_at="t1", updated_at="t1", author="owner", note="created",
    )
    entries = wiki_git.log_for_page(data_dir, "oil-change")  # must not raise
    assert len(entries) == 1
    assert entries[0]["sha"] == sha


def test_log_for_page_returns_newest_first_with_trailers(data_dir):
    wiki_git.commit_page(
        data_dir=data_dir, folder_path_parts=[], slug="oil-change", title="Oil Change",
        content="v1", created_at="t1", updated_at="t1", author="owner", note="created",
    )
    sha2, _ = wiki_git.commit_page(
        data_dir=data_dir, folder_path_parts=[], slug="oil-change", title="Oil Change",
        content="v2", created_at="t1", updated_at="t2", author="assistant", note="clarify",
    )
    entries = wiki_git.log_for_page(data_dir, "oil-change")
    assert len(entries) == 2
    assert entries[0]["sha"] == sha2
    assert entries[0]["author"] == "assistant"
    assert entries[0]["note"] == "clarify"
    assert entries[1]["note"] == "created"


def test_log_for_page_does_not_cross_match_unrelated_pages_with_similar_frontmatter(data_dir):
    # Regression: two distinct pages with short, near-identical frontmatter
    # (differing only in title/slug) can exceed git's default ~50% rename
    # similarity threshold, so a --follow/rename-detection-based approach
    # spuriously treats page B's creation as a "rename" of page A. Keying on
    # the immutable slug embedded in the frontmatter instead of content
    # similarity is what actually prevents this.
    sha_a, _ = wiki_git.commit_page(
        data_dir=data_dir, folder_path_parts=[], slug="page-a", title="Page A",
        content="a1", created_at="t1", updated_at="t1", author="owner", note="created",
    )
    sha_b, _ = wiki_git.commit_page(
        data_dir=data_dir, folder_path_parts=[], slug="page-b", title="Page B",
        content="b1", created_at="t1", updated_at="t1", author="owner", note="created",
    )
    entries = wiki_git.log_for_page(data_dir, "page-b")
    shas = [e["sha"] for e in entries]
    assert shas == [sha_b]
    assert sha_a not in shas


def test_log_for_page_follows_renames_across_folder_moves(data_dir):
    sha1, old_path = wiki_git.commit_page(
        data_dir=data_dir, folder_path_parts=["engines"], slug="torque-specs",
        title="Torque Specs", content="body", created_at="t1", updated_at="t1",
        author="owner", note="created",
    )
    sha2, new_path = wiki_git.commit_page(
        data_dir=data_dir, folder_path_parts=["motors"], slug="torque-specs",
        title="Torque Specs", content="body", created_at="t1", updated_at="t2",
        author="owner", note="moved to a different folder", old_relative_path=old_path,
    )
    entries = wiki_git.log_for_page(data_dir, "torque-specs")
    shas = [e["sha"] for e in entries]
    assert shas == [sha2, sha1]
    paths = {e["sha"]: e["path"] for e in entries}
    assert paths[sha1] == old_path
    assert paths[sha2] == new_path


def test_content_at_commit_returns_body_without_frontmatter(data_dir):
    sha1, path = wiki_git.commit_page(
        data_dir=data_dir, folder_path_parts=[], slug="oil-change", title="Oil Change",
        content="original body", created_at="t1", updated_at="t1", author="owner",
        note="created",
    )
    wiki_git.commit_page(
        data_dir=data_dir, folder_path_parts=[], slug="oil-change", title="Oil Change",
        content="updated body", created_at="t1", updated_at="t2", author="owner",
        note="edit",
    )
    assert wiki_git.content_at_commit(data_dir, path, sha1) == "original body"


def test_content_at_commit_returns_none_for_unknown_sha(data_dir):
    _, path = wiki_git.commit_page(
        data_dir=data_dir, folder_path_parts=[], slug="oil-change", title="Oil Change",
        content="body", created_at="t1", updated_at="t1", author="owner", note="created",
    )
    assert wiki_git.content_at_commit(data_dir, path, "deadbeef" * 5) is None


def _bare_remote(tmp_path, name="remote.git"):
    remote_dir = tmp_path / name
    subprocess.run(
        ["git", "init", "--bare", "-b", "main", str(remote_dir)],
        check=True, capture_output=True,
    )
    return remote_dir


def _seed_remote_with_commit(remote_dir, tmp_path):
    """Populate a bare remote via a throwaway clone, simulating content
    already pushed by a prior deployment/instance."""
    seed_repo = tmp_path / "seed_clone"
    subprocess.run(
        ["git", "clone", str(remote_dir), str(seed_repo)],
        check=True, capture_output=True,
    )
    subprocess.run(["git", "-C", str(seed_repo), "config", "user.name", "Seed"], check=True)
    subprocess.run(["git", "-C", str(seed_repo), "config", "user.email", "seed@test"], check=True)
    (seed_repo / "wiki").mkdir()
    (seed_repo / "wiki" / "existing.md").write_text('---\ntitle: "Existing"\n---\nhi')
    subprocess.run(["git", "-C", str(seed_repo), "add", "-A"], check=True)
    subprocess.run(["git", "-C", str(seed_repo), "commit", "-m", "seed"], check=True, capture_output=True)
    subprocess.run(
        ["git", "-C", str(seed_repo), "push", "origin", "main"],
        check=True, capture_output=True,
    )


# --- remote_url / ensure_remote / push / pull_or_clone ---


def test_remote_url_uses_dataset_repo_owner_as_username():
    # HF's git-auth docs (huggingface.co/blog/password-git-deprecation)
    # require the actual account username in the URL, not a placeholder —
    # derived here from the "owner/name" dataset_repo we already have.
    url = wiki_git.remote_url("hf_abc123", "dillguill/knowledge-assistant-data")
    assert url == "https://dillguill:hf_abc123@huggingface.co/datasets/dillguill/knowledge-assistant-data"


def test_ensure_remote_adds_then_updates_origin_url(data_dir):
    wiki_git.ensure_remote(data_dir, "https://example.com/a")
    repo = wiki_git._repo_dir(data_dir)
    result = subprocess.run(
        ["git", "remote", "get-url", "origin"], cwd=repo, capture_output=True, text=True
    )
    assert result.stdout.strip() == "https://example.com/a"

    # A rotated HF_TOKEN changes the embedded credential — must update, not skip.
    wiki_git.ensure_remote(data_dir, "https://example.com/b")
    result = subprocess.run(
        ["git", "remote", "get-url", "origin"], cwd=repo, capture_output=True, text=True
    )
    assert result.stdout.strip() == "https://example.com/b"


def test_push_sends_local_commits_to_remote(tmp_path, data_dir):
    remote_dir = _bare_remote(tmp_path)
    wiki_git.ensure_remote(data_dir, str(remote_dir))
    wiki_git.commit_page(
        data_dir=data_dir, folder_path_parts=[], slug="oil-change", title="Oil Change",
        content="body", created_at="t1", updated_at="t1", author="owner", note="created",
    )
    wiki_git.push(data_dir)
    result = subprocess.run(
        ["git", "log", "--oneline", "main"], cwd=remote_dir, capture_output=True, text=True
    )
    assert "created" in result.stdout


def test_push_raises_git_commit_error_on_failure(data_dir):
    # No remote configured at all — push must fail loudly, not silently no-op.
    wiki_git.ensure_repo(data_dir)
    with pytest.raises(wiki_git.GitCommitError):
        wiki_git.push(data_dir)


def _push_commit_from_a_second_clone(remote_dir, tmp_path, *, name, content):
    """Simulate a second writer (e.g. a brief restart-overlap despite the
    single-writer invariant) advancing the remote via an independent clone."""
    other = tmp_path / f"other_{name}"
    subprocess.run(["git", "clone", str(remote_dir), str(other)], check=True, capture_output=True)
    subprocess.run(["git", "-C", str(other), "config", "user.name", "Other"], check=True)
    subprocess.run(["git", "-C", str(other), "config", "user.email", "other@test"], check=True)
    target = other / "wiki" / f"{name}.md"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content)
    subprocess.run(["git", "-C", str(other), "add", "-A"], check=True)
    subprocess.run(["git", "-C", str(other), "commit", "-m", name], check=True, capture_output=True)
    subprocess.run(
        ["git", "-C", str(other), "push", "origin", "main"], check=True, capture_output=True
    )


def test_push_retries_once_via_rebase_on_non_fast_forward(tmp_path, data_dir):
    remote_dir = _bare_remote(tmp_path)
    wiki_git.ensure_remote(data_dir, str(remote_dir))
    wiki_git.commit_page(
        data_dir=data_dir, folder_path_parts=[], slug="oil-change", title="Oil Change",
        content="v1", created_at="t1", updated_at="t1", author="owner", note="created",
    )
    wiki_git.push(data_dir)

    _push_commit_from_a_second_clone(
        remote_dir, tmp_path, name="other", content='---\ntitle: "Other"\n---\nhi'
    )

    # Our local clone hasn't fetched "other" yet — a non-conflicting local
    # commit + push must auto-rebase and retry rather than fail outright.
    wiki_git.commit_page(
        data_dir=data_dir, folder_path_parts=[], slug="second-page", title="Second Page",
        content="v1", created_at="t1", updated_at="t1", author="owner", note="created",
    )
    wiki_git.push(data_dir)  # must not raise

    remote_log = subprocess.run(
        ["git", "log", "--oneline", "main"], cwd=remote_dir, capture_output=True, text=True
    ).stdout
    assert "other" in remote_log
    assert "created" in remote_log


def test_push_aborts_rebase_and_raises_on_real_conflict(tmp_path, data_dir):
    remote_dir = _bare_remote(tmp_path)
    wiki_git.ensure_remote(data_dir, str(remote_dir))
    wiki_git.commit_page(
        data_dir=data_dir, folder_path_parts=[], slug="oil-change", title="Oil Change",
        content="v1", created_at="t1", updated_at="t1", author="owner", note="created",
    )
    wiki_git.push(data_dir)

    _push_commit_from_a_second_clone(
        remote_dir, tmp_path,
        name="oil-change", content='---\ntitle: "Oil Change"\n---\nCONFLICTING REMOTE EDIT',
    )

    # Our local clone edits the SAME file differently without having fetched
    # the remote's conflicting edit — a genuine, unresolvable conflict.
    wiki_git.commit_page(
        data_dir=data_dir, folder_path_parts=[], slug="oil-change", title="Oil Change",
        content="LOCAL CONFLICTING EDIT", created_at="t1", updated_at="t2",
        author="owner", note="local edit",
    )
    with pytest.raises(wiki_git.GitCommitError):
        wiki_git.push(data_dir)

    repo = wiki_git._repo_dir(data_dir)
    # the aborted rebase must not leave the repo mid-conflict
    assert not (repo / ".git" / "rebase-apply").exists()
    assert not (repo / ".git" / "rebase-merge").exists()


def test_pull_or_clone_resets_local_to_remote_when_remote_has_history(tmp_path, data_dir):
    remote_dir = _bare_remote(tmp_path)
    _seed_remote_with_commit(remote_dir, tmp_path)

    wiki_git.ensure_remote(data_dir, str(remote_dir))
    wiki_git.pull_or_clone(data_dir)

    repo = wiki_git._repo_dir(data_dir)
    assert (repo / "wiki" / "existing.md").exists()


def test_pull_or_clone_is_a_noop_on_a_brand_new_empty_remote(data_dir, tmp_path):
    remote_dir = _bare_remote(tmp_path)
    wiki_git.ensure_remote(data_dir, str(remote_dir))
    wiki_git.pull_or_clone(data_dir)  # must not raise on an empty remote


def test_delete_page_file_removes_file_and_commits(data_dir):
    _, path = wiki_git.commit_page(
        data_dir=data_dir,
        folder_path_parts=[],
        slug="oil-change",
        title="Oil Change",
        content="body",
        created_at="t1",
        updated_at="t1",
        author="owner",
        note="created",
    )
    sha = wiki_git.delete_page_file(
        data_dir=data_dir, relative_path=path, author="owner", note="deleted"
    )
    repo = wiki_git._repo_dir(data_dir)
    assert not (repo / path).exists()
    msg = _commit_message(repo, sha)
    assert "deleted" in msg
    assert "wiki-author: owner" in msg
