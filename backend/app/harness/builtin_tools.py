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


_FETCH_URL_PARAMETERS = {
    "type": "object",
    "properties": {
        "url": {"type": "string", "description": "The page URL to fetch."},
    },
    "required": ["url"],
    "additionalProperties": False,
}

_SITE_MAP_PARAMETERS = {
    "type": "object",
    "properties": {
        "url": {"type": "string", "description": "The site to map."},
        "query": {
            "type": "string",
            "description": "Optional relevance filter for the returned URLs.",
        },
    },
    "required": ["url"],
    "additionalProperties": False,
}

_TRUNCATION_NOTE = "\n[…truncated]"


async def _fetch_url(url: str = "") -> dict:
    """Fetch one page. Truncated to a budget: the result goes back into a
    model's context, and a long page would swamp it."""
    try:
        result = await search.scrape_url(url)
    except search.SearchError as exc:
        return tools.err(search.error_code(exc), str(exc))
    budget = get_settings().web_scrape_char_budget
    content = result.content[:budget]
    if len(result.content) > budget:
        content += _TRUNCATION_NOTE
    return tools.ok({"url": result.url, "title": result.title, "content": content})


async def _site_map(url: str = "", query: str = "") -> dict:
    """List a site's URLs without rendering the pages — cheap reconnaissance."""
    try:
        links = await search.map_site(url, query)
    except search.SearchError as exc:
        return tools.err(search.error_code(exc), str(exc))
    return tools.ok({"links": links})


def fetch_url_tool() -> tools.Tool:
    return tools.Tool(
        name="fetch_url",
        description=(
            "Fetch the readable content of a specific web page as markdown. "
            "Use when a URL is already known, rather than searching for one."
        ),
        parameters=_FETCH_URL_PARAMETERS,
        handler=_fetch_url,
        owner_only=True,
    )


def site_map_tool() -> tools.Tool:
    return tools.Tool(
        name="site_map",
        description=(
            "List the URLs on a website, optionally filtered by relevance to a "
            "query. Use to find which page on a known site to fetch."
        ),
        parameters=_SITE_MAP_PARAMETERS,
        handler=_site_map,
        owner_only=True,
    )


def default_registry() -> tools.ToolRegistry:
    registry = tools.ToolRegistry()
    registry.register(web_search_tool())
    registry.register(fetch_url_tool())
    registry.register(site_map_tool())
    return registry
