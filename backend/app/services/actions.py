import json
import logging
import re
import secrets

from app.config import get_settings
from app.db import store, wiki_store

log = logging.getLogger(__name__)

FENCE_WIKI_CREATE_PAGE = re.compile(
    r"^```wiki-create-page[ \t]*\n(.*?)\n^```[ \t]*$", re.DOTALL | re.MULTILINE
)
FENCE_WIKI_UPDATE = re.compile(
    r"^```wiki-update[ \t]*\n(.*?)\n^```[ \t]*$", re.DOTALL | re.MULTILINE
)
FENCE_COLLECTION_CREATE = re.compile(
    r"^```collection-create[ \t]*\n(.*?)\n^```[ \t]*$", re.DOTALL | re.MULTILINE
)

ALL_FENCES = [FENCE_WIKI_CREATE_PAGE, FENCE_WIKI_UPDATE, FENCE_COLLECTION_CREATE]

SYSTEM_PROMPT = """\
You have tools to draft new wiki pages and create collections. \
When the user asks you to create content, include a fenced code block \
with the appropriate tool format in your response. Only use these tools when \
the user explicitly asks.

Tool: wiki-create-page — drafts a new wiki page. The draft is shown to the \
user as a reviewable card they save (or propose) themselves; it is NOT written \
until they act on it, so never claim the page has been created.
```wiki-create-page
{"title": "Page Title", "content": "Full page markdown", "folder_id": null}
```

Tool: collection-create — creates a new collection for documents (owner only)
```collection-create
{"name": "Collection Name"}
```

Place the fence in your response alongside any explanatory text. To edit an \
existing page, do not use these tools — follow the editing instructions given \
when a page is pinned for editing.\
"""


def _owner_error(token: str) -> str | None:
    expected = get_settings().owner_token
    if not expected:
        return "Owner access is not configured on this server."
    if not secrets.compare_digest(token, expected):
        return "Owner token required."
    return None


def _strip_fences(text: str) -> str:
    for pattern in ALL_FENCES:
        text = pattern.sub("", text)
    return text.strip()


def parse_actions(text: str) -> list[dict]:
    tagged: list[tuple[int, dict]] = []

    # Neither `wiki-update` nor `wiki-create-page` is parsed here: both carry a
    # page draft rendered by the frontend as a reviewable card the user saves
    # (or proposes) — creating a page is never an immediate server side effect
    # of a chat turn, so it can't diverge from what the user sees or fire twice.
    # Only genuinely immediate actions (collection-create) run server-side.
    for pattern, action_name in [
        (FENCE_COLLECTION_CREATE, "collection-create"),
    ]:
        for match in pattern.finditer(text):
            try:
                data = json.loads(match.group(1))
                tagged.append((match.start(), {"action": action_name, "data": data}))
            except json.JSONDecodeError as exc:
                tagged.append(
                    (match.start(), {"action": action_name, "error": f"Invalid JSON: {exc}"})
                )

    tagged.sort(key=lambda t: t[0])
    return [entry for _, entry in tagged]


def execute_action(action: dict, owner_token: str = "") -> dict:
    action_type = action["action"]

    if "error" in action:
        return {"action": action_type, "error": action["error"]}

    data = action["data"]

    # NOTE: `parse_actions` no longer emits "wiki-create-page" (page creation is
    # drafted client-side and saved via the proposal flow), so this branch is
    # unreachable from a chat turn. It's retained as a directly-callable,
    # owner-guarded create primitive (and its unit tests) for programmatic use.
    if action_type == "wiki-create-page":
        err = _owner_error(owner_token)
        if err:
            return {"action": action_type, "error": err}
        title = data.get("title", "Untitled")
        content = data.get("content", "")
        folder_id = data.get("folder_id")
        try:
            page = wiki_store.create_page(title, folder_id, content, author="owner")
            return {
                "action": action_type,
                "result": {"id": page["id"], "title": page["title"], "slug": page["slug"]},
            }
        except Exception as exc:
            log.warning("wiki-create-page failed: %s", exc)
            return {"action": action_type, "error": str(exc)}

    if action_type == "collection-create":
        err = _owner_error(owner_token)
        if err:
            return {"action": action_type, "error": err}
        name = data.get("name", "Untitled")
        try:
            col = store.create_collection(name)
            return {"action": action_type, "result": {"id": col["id"], "name": col["name"]}}
        except Exception as exc:
            log.warning("collection-create failed: %s", exc)
            return {"action": action_type, "error": str(exc)}

    return {"action": action_type, "error": f"Unknown action: {action_type}"}
