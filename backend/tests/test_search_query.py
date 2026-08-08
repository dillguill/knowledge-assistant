import respx

UPSTREAM = "https://openrouter.ai/api/v1/chat/completions"


def completion(text: str) -> dict:
    return {"choices": [{"message": {"role": "assistant", "content": text}}]}


@respx.mock
async def test_short_question_is_used_verbatim_without_a_model_call():
    from app.services.search_query import derive_query

    route = respx.post(UPSTREAM).respond(json=completion("unused"))
    assert await derive_query("What is sqlite-vec?", None) == "What is sqlite-vec?"
    assert route.call_count == 0


@respx.mock
async def test_long_message_is_rewritten_by_the_model():
    from app.services.search_query import derive_query

    respx.post(UPSTREAM).respond(json=completion("  sqlite-vec vector index benchmarks  "))
    query = await derive_query(
        "I've been reading about embedding stores all week and I keep wondering "
        "how the vector index in that sqlite extension actually benchmarks "
        "against the alternatives people keep recommending to me.",
        None,
    )
    assert query == "sqlite-vec vector index benchmarks"


@respx.mock
async def test_falls_back_to_the_raw_message_when_the_model_fails():
    from app.services.search_query import derive_query

    respx.post(UPSTREAM).respond(status_code=500)
    long_message = "x" * 200
    assert await derive_query(long_message, None) == long_message


@respx.mock
async def test_empty_model_output_falls_back_to_the_raw_message():
    from app.services.search_query import derive_query

    respx.post(UPSTREAM).respond(json=completion("   "))
    long_message = "y" * 200
    assert await derive_query(long_message, None) == long_message
