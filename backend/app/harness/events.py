"""In-process fan-out from a detached run to however many browsers are watching.

Deliberately not durable: the durable record is `skill_run_steps`, and the
stream endpoint replays from there before it follows this bus. That split is
what makes a disconnect survivable — the SSE path reads *from* the run record
rather than *being* the run.
"""

import asyncio
import logging

log = logging.getLogger(__name__)

# Bounded so a browser that stops reading cannot grow memory without limit.
_MAX_QUEUE = 256

DONE = object()
"""Sentinel pushed by close(): end of stream, not an event."""

_subscribers: dict[int, set[asyncio.Queue]] = {}


def subscribe(run_id: int) -> asyncio.Queue:
    queue: asyncio.Queue = asyncio.Queue(maxsize=_MAX_QUEUE)
    _subscribers.setdefault(run_id, set()).add(queue)
    return queue


def unsubscribe(run_id: int, queue: asyncio.Queue) -> None:
    listeners = _subscribers.get(run_id)
    if listeners is None:
        return
    listeners.discard(queue)
    if not listeners:
        _subscribers.pop(run_id, None)


def publish(run_id: int, event: dict) -> None:
    """Non-blocking by contract. A stalled reader loses events; it must never
    stall the run producing them, and it never loses the durable step rows."""
    for queue in list(_subscribers.get(run_id, ())):
        try:
            queue.put_nowait(event)
        except asyncio.QueueFull:
            log.warning("dropping event for run %s: subscriber queue full", run_id)


def close(run_id: int) -> None:
    for queue in list(_subscribers.get(run_id, ())):
        try:
            queue.put_nowait(DONE)
        except asyncio.QueueFull:
            pass
    _subscribers.pop(run_id, None)
