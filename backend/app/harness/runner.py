"""The instrumented middle: what a step is, what a model call costs, and what
gets written down about both.

Every model call and every tool call goes through here, which is the only
reason the run record can be trusted as the source of truth for the live view
and for v0.8.0's analytics.
"""

import time
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any

from app.config import get_settings
from app.harness import contracts, events, runs, tools
from app.services import openrouter


class StepFailure(Exception):
    """A step could not produce valid output. Fails the run, recording which
    step and why — no partial output is ever filed as a proposal."""

    def __init__(self, code: str, message: str, retry_after: int | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.retry_after = retry_after


class BudgetExceeded(StepFailure):
    def __init__(self, used: int, allowed: int):
        super().__init__(
            "budget_exceeded",
            f"This run reached its {allowed}-call limit (used {used}).",
        )


@dataclass
class _OpenStep:
    step_id: int
    ordinal: int
    started: float
    model: str | None = None
    tokens_in: int = 0
    tokens_out: int = 0


@dataclass
class RunContext:
    run_id: int
    model: str | None
    owner: bool
    inputs: dict
    registry: tools.ToolRegistry
    max_calls: int | None = None
    retries: int | None = None
    state: dict = field(default_factory=dict)
    calls_used: int = 0
    _open: _OpenStep | None = None

    def __post_init__(self) -> None:
        settings = get_settings()
        if self.max_calls is None:
            self.max_calls = settings.skill_max_model_calls
        if self.retries is None:
            self.retries = settings.skill_contract_retries

    def emit(self, event: dict) -> None:
        events.publish(self.run_id, event)

    @asynccontextmanager
    async def step(self, name: str):
        """Open a step: one row, one start event, one done/failed event.

        Steps that make no model call still get a row — `gather` is a real
        step the user waits on, and a timeline that skips it is wrong.
        """
        step_id = runs.add_step(self.run_id, name)
        ordinal = len(runs.list_steps(self.run_id))
        open_step = _OpenStep(
            step_id=step_id, ordinal=ordinal, started=time.monotonic()
        )
        self._open = open_step
        self.emit({"type": "step-start", "name": name, "ordinal": ordinal})
        try:
            yield open_step
        except StepFailure as exc:
            self._close_step(open_step, status="failed", error=exc.code)
            self.emit({
                "type": "step-done", "name": name, "ordinal": ordinal,
                "status": "failed", "error": exc.code,
            })
            raise
        except Exception as exc:
            self._close_step(open_step, status="failed", error=type(exc).__name__)
            self.emit({
                "type": "step-done", "name": name, "ordinal": ordinal,
                "status": "failed", "error": type(exc).__name__,
            })
            raise
        else:
            latency = self._close_step(open_step, status="succeeded")
            self.emit({
                "type": "step-done", "name": name, "ordinal": ordinal,
                "status": "succeeded", "latency_ms": latency,
                "tokens_in": open_step.tokens_in or None,
                "tokens_out": open_step.tokens_out or None,
            })

    def _close_step(
        self, open_step: _OpenStep, *, status: str, error: str | None = None
    ) -> int:
        if self._open is open_step:
            self._open = None
        latency = int((time.monotonic() - open_step.started) * 1000)
        runs.finish_step(
            open_step.step_id,
            status=status,
            model=open_step.model,
            tokens_in=open_step.tokens_in or None,
            tokens_out=open_step.tokens_out or None,
            latency_ms=latency,
            error=error,
        )
        return latency

    async def call_model(
        self,
        messages: list[dict],
        contract: "contracts.TextContract | contracts.JsonContract",
        *,
        tool_definitions: list[dict] | None = None,
    ) -> Any:
        """One contract-validated completion, retried a bounded number of times.

        Provider-side enforcement first (`response_format`), extraction second
        (inside the contract), and only then a retry that quotes the exact
        validation failure back.
        """
        conversation = list(messages)
        attempts = (self.retries or 0) + 1
        last_error = ""
        for _ in range(attempts):
            raw = await self._one_completion(conversation, contract, tool_definitions)
            content = raw.get("content") or ""
            try:
                return contract.validate(content)
            except contracts.ContractError as exc:
                last_error = str(exc)
                conversation = conversation + [
                    {"role": "assistant", "content": content},
                    contracts.repair_message(last_error),
                ]
        raise StepFailure(
            "contract_invalid",
            f"The model's output did not match the required format: {last_error}",
        )

    async def call_model_raw(
        self, messages: list[dict], *, tool_definitions: list[dict] | None = None
    ) -> dict:
        """A completion with no contract — the agent scheduler's tool loop,
        where the decision is 'which tool', not 'what shape'."""
        return await self._one_completion(
            messages, contracts.TextContract(), tool_definitions
        )

    async def _one_completion(
        self, messages: list[dict], contract, tool_definitions: list[dict] | None
    ) -> dict:
        if self.calls_used >= (self.max_calls or 0):
            raise BudgetExceeded(self.calls_used, self.max_calls or 0)
        self.calls_used += 1
        response_format = contract.response_format()
        try:
            message, usage = await openrouter.complete_message(
                self.model, messages,
                tools=tool_definitions, response_format=response_format,
            )
        # Specific subclasses before the shared parent: a routine 429 must not
        # flatten into a generic outage, and the user needs the retry_after.
        except openrouter.RateLimitedError as exc:
            raise StepFailure(
                "rate_limited",
                "The model provider rate limited this run.",
                exc.retry_after,
            ) from exc
        except openrouter.ModelGoneError as exc:
            raise StepFailure(
                "model_gone", f"The model {exc.model} is no longer available."
            ) from exc
        except openrouter.UpstreamError as exc:
            raise StepFailure("upstream_error", str(exc)) from exc
        if self._open is not None:
            self._open.model = self.model
            self._open.tokens_in += int(usage.get("prompt_tokens") or 0)
            self._open.tokens_out += int(usage.get("completion_tokens") or 0)
        return message

    async def call_tool(self, name: str, arguments: dict) -> dict:
        """Dispatch a tool, recording it as its own step row.

        A tool call is a step so that every event the stream emits is
        reconstructible from the database — which is what makes replay-then-
        follow identical to a first connect.
        """
        parent = self._open
        step_id = runs.add_step(self.run_id, f"tool:{name}")
        ordinal = len(runs.list_steps(self.run_id))
        started = time.monotonic()
        self.emit({"type": "step-start", "name": f"tool:{name}", "ordinal": ordinal})
        result = await self.registry.dispatch(name, arguments, owner=self.owner)
        latency = int((time.monotonic() - started) * 1000)
        failed = not result.get("ok")
        error = result.get("error", {}).get("code") if failed else None
        runs.finish_step(
            step_id,
            status="failed" if failed else "succeeded",
            latency_ms=latency,
            error=error,
        )
        self.emit({
            "type": "step-done", "name": f"tool:{name}", "ordinal": ordinal,
            "status": "failed" if failed else "succeeded",
            "latency_ms": latency, "error": error,
        })
        # A tool failure is something the model sees and continues past, so it
        # is returned, never raised. Restore the enclosing step for metrics.
        self._open = parent
        return result


class PipelineScheduler:
    """Walks a declared step list. The most deterministic scheduler available:
    call count and order are knowable before the run starts.

    v0.7.0's ceiling arm pins this scheduler — a ceiling that drifts run to run
    makes the three-arm comparison unreadable.
    """

    name = "pipeline"

    def __init__(self, steps: list) -> None:
        self.steps = steps

    async def run(self, ctx: RunContext) -> dict:
        output: dict = {}
        for step in self.steps:
            result = await step(ctx)
            if isinstance(result, dict):
                output = result
        return output
