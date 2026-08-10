"""Research brief: the first skill, and v0.7.0's ceiling arm.

Pipeline scheduler, pinned. A ceiling that drifts run-to-run makes v0.7.0's
three-arm comparison unreadable — you cannot tell whether the RAG arm improved
or the reference moved.

Known limitation, accepted for v0.6.0: a bad outline at step 3 is elaborated
faithfully by steps 4-5, and the pipeline has no mechanism to back up. The
mitigation is per-step output validation and retry, not model self-correction.
"""

from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field, create_model

from app import skills
from app.config import get_settings
from app.db import store, wiki_store
from app.harness import contracts, runner
from app.services import search
from app.services.context_builder import build_source_context

_DIR = str(Path(__file__).parent)


class ResearchBriefInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    topic: str = Field(min_length=3, max_length=300)
    collection_ids: list[int] = []
    wiki_page_ids: list[int] = []
    web_search: bool = False


class _Plan(BaseModel):
    model_config = ConfigDict(extra="forbid")
    questions: list[str] = Field(min_length=3, max_length=6)


class _Section(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str
    source_labels: list[str] = []


class _Verify(BaseModel):
    model_config = ConfigDict(extra="forbid")
    unsupported_claims: list[str] = []


def _outline_contract() -> contracts.JsonContract:
    """The section cap lives in the schema, not in prompt politeness — the
    provider enforces it, so no retry is spent arguing about the count."""
    maximum = get_settings().skill_max_sections
    model = create_model(
        "Outline",
        __config__=ConfigDict(extra="forbid"),
        sections=(list[_Section], Field(min_length=1, max_length=maximum)),
    )
    return contracts.JsonContract(model)


async def _plan(ctx: runner.RunContext) -> None:
    async with ctx.step("plan"):
        # Cheap pre-check before spending anything: create_proposal re-checks
        # authoritatively at the end, but there is no point paying for seven
        # completions if the queue is already full.
        if wiki_store.pending_proposals_full():
            raise runner.StepFailure(
                "proposal_queue_full",
                "The pending proposal queue is full — review the existing "
                "proposals before starting another run.",
            )
        prompt = skills.render(
            skills.load_prompt(_DIR, "plan"), TOPIC=ctx.inputs["topic"]
        )
        plan = await ctx.call_model(
            [{"role": "user", "content": prompt}], contracts.JsonContract(_Plan)
        )
        ctx.state["questions"] = plan.questions


async def _gather(ctx: runner.RunContext) -> None:
    """No model call. Retrieves the selected sources, and optionally runs one
    web search per planned sub-question.

    v0.5.0's one-search-per-turn cap was scoped to a chat turn; here the bound
    is the plan itself (3-6 questions), which is the multi-search capability
    that milestone deferred to the harness.
    """
    async with ctx.step("gather"):
        settings = get_settings()
        web_results: list[search.WebResult] = []
        if ctx.inputs.get("web_search"):
            seen: set[str] = set()
            for question in ctx.state["questions"]:
                result = await ctx.call_tool("web_search", {"query": question})
                if not result.get("ok"):
                    continue  # a tool failure degrades the brief, never fails it
                for item in result["data"]["results"]:
                    url = item.get("url")
                    if not url or url in seen:
                        continue
                    seen.add(url)
                    # The tool returns excerpts by design; the full body is in
                    # the search cache v0.5.0 already writes.
                    cached = store.find_cached_result(url)
                    if cached:
                        web_results.append(search.WebResult.from_dict(cached))

        block, sources = build_source_context(
            ctx.inputs.get("collection_ids") or [],
            [],
            ctx.inputs.get("wiki_page_ids") or [],
            settings.context_char_budget,
            web_results=web_results,
            web_budget=settings.web_search_char_budget,
        )
        if not sources:
            raise runner.StepFailure(
                "no_sources",
                "Nothing to research from — select at least one collection or "
                "wiki page, or enable web search.",
            )
        ctx.state["source_block"] = block
        ctx.state["sources"] = sources


async def _outline(ctx: runner.RunContext) -> None:
    async with ctx.step("outline"):
        prompt = skills.render(
            skills.load_prompt(_DIR, "outline"),
            SOURCES=ctx.state["source_block"],
            TOPIC=ctx.inputs["topic"],
            QUESTIONS="\n".join(f"- {q}" for q in ctx.state["questions"]),
            MAX_SECTIONS=str(get_settings().skill_max_sections),
        )
        outline = await ctx.call_model(
            [{"role": "user", "content": prompt}], _outline_contract()
        )
        ctx.state["sections"] = [s.model_dump() for s in outline.sections]


async def _draft(ctx: runner.RunContext) -> None:
    drafted: list[str] = []
    for i, section in enumerate(ctx.state["sections"], start=1):
        async with ctx.step(f"draft:{i}"):
            prompt = skills.render(
                skills.load_prompt(_DIR, "draft_section"),
                SOURCES=ctx.state["source_block"],
                TOPIC=ctx.inputs["topic"],
                SECTION_TITLE=section["title"],
                SECTION_LABELS=", ".join(section["source_labels"]) or "none listed",
            )
            drafted.append(
                await ctx.call_model(
                    [{"role": "user", "content": prompt}], contracts.TextContract()
                )
            )
    ctx.state["brief"] = "\n\n".join(drafted)


async def _verify(ctx: runner.RunContext) -> dict:
    async with ctx.step("verify"):
        prompt = skills.render(
            skills.load_prompt(_DIR, "verify"),
            SOURCES=ctx.state["source_block"],
            BRIEF=ctx.state["brief"],
        )
        verified = await ctx.call_model(
            [{"role": "user", "content": prompt}], contracts.JsonContract(_Verify)
        )

    # Filed through the existing approval loop: the harness gets no new write
    # path, and nothing lands without owner approval.
    claims = verified.unsupported_claims
    rationale = f"Research brief on {ctx.inputs['topic']}."
    if claims:
        rationale += " Unverified claims: " + "; ".join(claims)
    proposal = wiki_store.create_proposal(
        None,
        ctx.inputs["topic"],
        None,
        ctx.state["brief"],
        rationale=rationale,
        citations=ctx.state["sources"],
    )
    return {
        "proposal_id": proposal["id"],
        "title": proposal["title"],
        "unsupported_claims": claims,
    }


def _estimated_calls(_inputs: dict) -> int:
    # plan + outline + verify + one draft per section.
    return 3 + get_settings().skill_max_sections


skills.register(
    skills.Skill(
        name="research_brief",
        label="Research brief",
        description=(
            "Plans sub-questions, gathers from your selected sources (and "
            "optionally the web), drafts a cited brief, and files it as a wiki "
            "proposal for your approval."
        ),
        input_model=ResearchBriefInput,
        scheduler=runner.PipelineScheduler([_plan, _gather, _outline, _draft, _verify]),
        estimated_calls=_estimated_calls,
    )
)
