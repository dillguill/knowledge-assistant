"""The tools the harness ships with.

v0.5.0's web search is the first. The fence-based actions in
`services/actions.py` are deliberately NOT migrated here — the two mechanisms
coexist for now, with the fence path documented as legacy.
"""

from app.config import get_settings
from app.harness import tools
from app.services import search

_WEB_SEARCH_PARAMETERS = {
    "type": "object",
    "properties": {
        "query": {"type": "string", "description": "A short web search query."},
    },
    "required": ["query"],
    "additionalProperties": False,
}


async def _web_search(query: str = "") -> dict:
    """Search the web. Returns excerpts, never full page bodies — this result
    goes back into a model's context, and full markdown per result would swamp
    it. The full text stays in the search cache for callers that need it."""
    try:
        results = await search.run_search(query, get_settings().web_search_max_results)
    except search.SearchError as exc:
        # A tool failure is a typed result the model sees and continues past.
        return tools.err(search.error_code(exc), str(exc))
    return tools.ok({
        "results": [
            {"url": r.url, "title": r.title, "excerpt": r.excerpt} for r in results
        ]
    })


def web_search_tool() -> tools.Tool:
    return tools.Tool(
        name="web_search",
        description=(
            "Search the web for current or unverified information. Use only when "
            "the answer depends on facts that may be recent, changing, or absent "
            "from the provided sources."
        ),
        parameters=_WEB_SEARCH_PARAMETERS,
        handler=_web_search,
        # Same gate as v0.5.0's chat control: a small monthly quota on a
        # publicly reachable server.
        owner_only=True,
    )


def default_registry() -> tools.ToolRegistry:
    registry = tools.ToolRegistry()
    registry.register(web_search_tool())
    return registry
