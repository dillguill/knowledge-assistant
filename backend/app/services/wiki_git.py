"""Git-native storage for wiki pages.

A local git working tree under `<data_dir>/wiki_git/` holds one markdown file
per page (`wiki/<folder-path>/<slug>.md`, frontmatter + body). All git access
goes through plain `git` subprocess calls — no new pip dependency, `git` is
already on the box for the Space's own deploy. This module knows nothing
about SQLite; `app/db/wiki_store.py` orchestrates calls into it after its own
transactions have already committed (see that module's `_sync_page_to_git`).
"""

import re
import subprocess
from pathlib import Path

GIT_AUTHOR_NAME = "Knowledge Assistant"
GIT_AUTHOR_EMAIL = "assistant@knowledge-assistant.local"

# indirection point so tests can monkeypatch without shelling out for real,
# matching the convention already used by app/services/sync.py's
# _snapshot_download/_upload_folder.
_run_git = subprocess.run


class GitCommitError(RuntimeError):
    """Raised when a git subprocess operation fails."""


def _repo_dir(data_dir: str) -> Path:
    return Path(data_dir) / "wiki_git"


def _git(args: list[str], cwd: Path) -> subprocess.CompletedProcess:
    try:
        return _run_git(["git", *args], cwd=str(cwd), capture_output=True, text=True)
    except OSError as exc:
        raise GitCommitError(str(exc)) from exc


def _current_head(repo: Path) -> str | None:
    result = _git(["rev-parse", "HEAD"], repo)
    if result.returncode != 0:
        return None
    return result.stdout.strip()


def ensure_repo(data_dir: str) -> Path:
    """Idempotently create/open the wiki git working tree with a fixed
    committer identity (no per-user git identity — see wiki-consideration.md)."""
    repo = _repo_dir(data_dir)
    repo.mkdir(parents=True, exist_ok=True)
    if not (repo / ".git").is_dir():
        result = _git(["init", "-b", "main"], repo)
        if result.returncode != 0:
            raise GitCommitError(result.stderr or result.stdout)
    _git(["config", "user.name", GIT_AUTHOR_NAME], repo)
    _git(["config", "user.email", GIT_AUTHOR_EMAIL], repo)
    return repo


# --- frontmatter ---

_FRONTMATTER_RE = re.compile(r"\A---\n(.*?)\n---\n?(.*)\Z", re.DOTALL)


def _quote(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def _unquote(value: str) -> str:
    if len(value) >= 2 and value[0] == '"' and value[-1] == '"':
        return value[1:-1].replace('\\"', '"').replace("\\\\", "\\")
    return value


def render_frontmatter(title: str, slug: str, created_at: str, updated_at: str) -> str:
    lines = [
        "---",
        f"title: {_quote(title)}",
        f"slug: {_quote(slug)}",
        f"created_at: {_quote(created_at)}",
        f"updated_at: {_quote(updated_at)}",
        "---",
        "",
    ]
    return "\n".join(lines)


def parse_frontmatter(text: str) -> tuple[dict[str, str], str]:
    """Parse a `---`-delimited frontmatter block this module itself wrote.

    Not a general YAML parser — we only ever read back what render_frontmatter
    wrote, so a small hand-rolled `key: "value"` parser is sufficient and
    avoids a new pip dependency for a schema this small.
    """
    match = _FRONTMATTER_RE.match(text)
    if match is None:
        return {}, text
    block, body = match.groups()
    fields: dict[str, str] = {}
    for line in block.splitlines():
        if not line.strip():
            continue
        key, _, raw = line.partition(":")
        fields[key.strip()] = _unquote(raw.strip())
    return fields, body


# --- commit / delete ---


def commit_page(
    *,
    data_dir: str,
    folder_path_parts: list[str],
    slug: str,
    title: str,
    content: str,
    created_at: str,
    updated_at: str,
    author: str,
    note: str = "",
    old_relative_path: str | None = None,
) -> tuple[str, str]:
    """Write (or relocate) a page's markdown file and commit it.

    No-op-safe: if the target file already holds identical frontmatter+content
    at the same path, returns the current HEAD sha without creating an empty
    commit — this is what lets a boot-time reconcile pass call this
    unconditionally without spamming history.
    """
    repo = ensure_repo(data_dir)
    new_relative_path = "/".join(["wiki", *folder_path_parts, f"{slug}.md"])
    full_path = repo / new_relative_path
    full_path.parent.mkdir(parents=True, exist_ok=True)
    file_text = render_frontmatter(title, slug, created_at, updated_at) + content

    unchanged = (
        old_relative_path in (None, new_relative_path)
        and full_path.exists()
        and full_path.read_text(encoding="utf-8") == file_text
    )

    if old_relative_path and old_relative_path != new_relative_path:
        old_full = repo / old_relative_path
        if old_full.exists():
            old_full.unlink()

    full_path.write_text(file_text, encoding="utf-8")

    if unchanged:
        head = _current_head(repo)
        if head is not None:
            return head, new_relative_path

    add_result = _git(["add", "-A"], repo)
    if add_result.returncode != 0:
        raise GitCommitError(add_result.stderr or add_result.stdout)

    message = f"{note or f'Update {title}'}\n\nwiki-author: {author}\nwiki-slug: {slug}\n"
    commit_result = _git(["commit", "-m", message], repo)
    if commit_result.returncode != 0:
        combined = commit_result.stdout + commit_result.stderr
        if "nothing to commit" not in combined:
            raise GitCommitError(combined)

    sha = _current_head(repo)
    if sha is None:
        raise GitCommitError("commit succeeded but HEAD could not be resolved")
    return sha, new_relative_path


def delete_page_file(*, data_dir: str, relative_path: str, author: str, note: str = "") -> str:
    repo = ensure_repo(data_dir)
    full_path = repo / relative_path
    if full_path.exists():
        full_path.unlink()

    add_result = _git(["add", "-A"], repo)
    if add_result.returncode != 0:
        raise GitCommitError(add_result.stderr or add_result.stdout)

    message = f"{note or 'Delete page'}\n\nwiki-author: {author}\n"
    commit_result = _git(["commit", "-m", message], repo)
    if commit_result.returncode != 0:
        combined = commit_result.stdout + commit_result.stderr
        if "nothing to commit" not in combined:
            raise GitCommitError(combined)

    sha = _current_head(repo)
    if sha is None:
        raise GitCommitError("commit succeeded but HEAD could not be resolved")
    return sha
