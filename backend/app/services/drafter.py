"""Turns an owner instruction + selected sources into a wiki proposal.

Makes one non-streaming OpenRouter call and expects the reply to contain
exactly one complete ```wiki-update fenced block with the full page markdown.
"""

import re

from app.config import get_settings
from app.db import wiki_store
from app.services import openrouter, target_builder
from app.services.context_builder import build_source_context

# Greedy-to-the-LAST-fence, not the first: models occasionally emit a drafted
# page that itself contains fenced code blocks (e.g. a ```python sample), and
# same-length fences cannot nest in CommonMark anyway, so there is no way to
# tell a "real" close from a nested one by counting backticks. Assuming the
# model's own closing fence is the last ``` line in the reply (trailing
# post-fence chatter is not a case we've seen) lets nested blocks survive
# intact instead of truncating at the first nested closer.
_FENCE_PATTERN = re.compile(
    r"^```wiki-update[ \t]*\n(.*)\n^```[ \t]*$", re.DOTALL | re.MULTILINE
)

_TITLE_FALLBACK = "Drafted page"
_TITLE_MAX_LEN = 80


class DraftError(Exception):
    """Raised when the completion has no usable ```wiki-update fence."""


def _build_system_message(page: dict | None, source_block: str) -> str:
    parts: list[str] = []
    if source_block:
        parts.append(source_block)
    if page is not None:
        parts.append(
            f'The current content of the wiki page "{page["title"]}" is between '
            f"the markers below. {target_builder.DATA_RULE}\n\n"
            f"{target_builder.BEGIN_MARKER}\n{page['content']}\n{target_builder.END_MARKER}"
        )
    parts.append("Always " + target_builder.FENCE_INSTRUCTION)
    return "\n\n".join(parts)


def _derive_title(instruction: str) -> str:
    title = instruction.strip()[:_TITLE_MAX_LEN].strip()
    return title or _TITLE_FALLBACK


async def draft_proposal(
    *,
    instruction: str,
    page_id: int | None,
    collection_ids: list[int],
    attachment_ids: list[int],
    model: str | None,
) -> dict:
    """Draft a wiki proposal from an owner instruction. Raises KeyError for an
    unknown page_id, DraftError when the completion lacks a usable fence, and
    propagates openrouter.UpstreamError / wiki_store.PendingCapExceeded."""
    page: dict | None = None
    if page_id is not None:
        page = wiki_store.get_page(page_id)
        if page is None:
            raise KeyError(page_id)

    # Cheap pre-check before spending an OpenRouter call: create_proposal()
    # re-checks the cap authoritatively (belt and braces) once we have a
    # completion, but there is no point paying for one if the queue is
    # already full.
    if wiki_store.pending_proposals_full():
        raise wiki_store.PendingCapExceeded("Pending proposal queue is full.")

    source_block = ""
    sources: list[dict] = []
    if collection_ids or attachment_ids:
        source_block, sources = build_source_context(
            collection_ids, attachment_ids, [], get_settings().context_char_budget,
        )

    messages = [
        {"role": "system", "content": _build_system_message(page, source_block)},
        {"role": "user", "content": instruction},
    ]
    completion = await openrouter.complete(model, messages)

    match = _FENCE_PATTERN.search(completion)
    if match is None:
        raise DraftError("draft_failed")
    content = match.group(1)

    if page is not None:
        title = page["title"]
        folder_id = page["folder_id"]
    else:
        title = _derive_title(instruction)
        folder_id = None

    return wiki_store.create_proposal(
        page_id, title, folder_id, content,
        rationale=instruction, citations=sources,
    )
