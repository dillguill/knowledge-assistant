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
You have tools to create and modify wiki pages and collections. \
When the user asks you to create or modify content, include a fenced code block \
with the appropriate tool format in your response. Only use these tools when \
the user explicitly asks.

Tool: wiki-create-page — creates a new wiki page immediately (owner only)
```wiki-create-page
{"title": "Page Title", "content": "Full page markdown", "folder_id": null}
```

Tool: wiki-update — creates a proposal to create or change a wiki page (anyone)
```wiki-update
{"page_id": null, "title": "Page Title", "content": "Full page markdown", "folder_id": null}
```

Tool: collection-create — creates a new collection for documents (owner only)
```collection-create
{"name": "Collection Name"}
```

Place the fence in your response alongside any explanatory text.\
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

    for pattern, action_name in [
        (FENCE_WIKI_CREATE_PAGE, "wiki-create-page"),
        (FENCE_WIKI_UPDATE, "wiki-update"),
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

    if action_type == "wiki-update":
        page_id = data.get("page_id")
        title = data.get("title", "Untitled")
        content = data.get("content", "")
        folder_id = data.get("folder_id")
        try:
            proposal = wiki_store.create_proposal(
                page_id, title, folder_id, content, rationale="Created via chat"
            )
            return {
                "action": action_type,
                "result": {"proposal_id": proposal["id"], "title": proposal["title"]},
            }
        except Exception as exc:
            log.warning("wiki-update failed: %s", exc)
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
