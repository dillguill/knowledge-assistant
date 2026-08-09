import asyncio


async def test_a_subscriber_receives_published_events():
    from app.harness import events

    queue = events.subscribe(1)
    events.publish(1, {"type": "step-start", "name": "plan"})
    assert (await queue.get())["name"] == "plan"
    events.unsubscribe(1, queue)


async def test_two_subscribers_both_receive_every_event():
    from app.harness import events

    a, b = events.subscribe(2), events.subscribe(2)
    events.publish(2, {"type": "step-start"})
    assert (await a.get())["type"] == "step-start"
    assert (await b.get())["type"] == "step-start"
    events.unsubscribe(2, a)
    events.unsubscribe(2, b)


async def test_publishing_with_no_subscribers_is_harmless():
    from app.harness import events

    events.publish(999, {"type": "step-start"})  # a detached run outlives every viewer


async def test_close_signals_end_of_stream_and_drops_subscribers():
    from app.harness import events

    queue = events.subscribe(3)
    events.close(3)
    assert await queue.get() is events.DONE
    assert 3 not in events._subscribers


async def test_a_stalled_subscriber_never_blocks_the_run():
    """A browser that stops reading must not wedge the run producing events."""
    from app.harness import events

    queue = events.subscribe(4)
    for i in range(events._MAX_QUEUE + 10):
        events.publish(4, {"type": "step-start", "i": i})
    # Publishing stayed non-blocking; the overflow was dropped, not queued.
    assert queue.qsize() <= events._MAX_QUEUE
    events.unsubscribe(4, queue)


async def test_unsubscribe_is_idempotent():
    from app.harness import events

    queue = events.subscribe(5)
    events.unsubscribe(5, queue)
    events.unsubscribe(5, queue)  # a disconnect can fire twice
    assert 5 not in events._subscribers
    await asyncio.sleep(0)


async def test_one_runs_events_never_reach_another_runs_subscriber():
    from app.harness import events

    a, b = events.subscribe(6), events.subscribe(7)
    events.publish(6, {"type": "step-start", "run": 6})
    assert b.empty()
    assert (await a.get())["run"] == 6
    events.unsubscribe(6, a)
    events.unsubscribe(7, b)
