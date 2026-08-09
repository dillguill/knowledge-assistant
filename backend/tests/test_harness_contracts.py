import pytest
from pydantic import BaseModel, ConfigDict, Field


class Plan(BaseModel):
    model_config = ConfigDict(extra="forbid")
    questions: list[str] = Field(min_length=3, max_length=6)


def test_text_contract_passes_anything_through():
    from app.harness import contracts

    contract = contracts.TextContract()
    assert contract.response_format() is None
    assert contract.validate("  hello  ") == "hello"


def test_text_contract_rejects_an_empty_completion():
    from app.harness import contracts

    with pytest.raises(contracts.ContractError):
        contracts.TextContract().validate("   ")


def test_json_contract_emits_a_strict_response_format():
    from app.harness import contracts

    fmt = contracts.JsonContract(Plan).response_format()
    assert fmt["type"] == "json_schema"
    assert fmt["json_schema"]["strict"] is True
    schema = fmt["json_schema"]["schema"]
    # Strict mode requires every property listed as required and no extras.
    assert schema["additionalProperties"] is False
    assert schema["required"] == ["questions"]


def test_json_contract_validates_a_clean_payload():
    from app.harness import contracts

    parsed = contracts.JsonContract(Plan).validate('{"questions": ["a", "b", "c"]}')
    assert parsed.questions == ["a", "b", "c"]


def test_json_contract_extracts_json_from_a_fenced_reply():
    # Models that ignore response_format overwhelmingly do this instead.
    from app.harness import contracts

    raw = 'Sure!\n```json\n{"questions": ["a", "b", "c"]}\n```\nHope that helps.'
    assert contracts.JsonContract(Plan).validate(raw).questions == ["a", "b", "c"]


def test_json_contract_extracts_a_bare_object_amid_prose():
    from app.harness import contracts

    raw = 'Here you go: {"questions": ["a", "b", "c"]} — done.'
    assert contracts.JsonContract(Plan).validate(raw).questions == ["a", "b", "c"]


def test_json_contract_rejects_a_payload_that_breaks_the_schema():
    # Two questions when the contract demands three: malformed data must never
    # pass downstream, where an outline step would elaborate it faithfully.
    from app.harness import contracts

    with pytest.raises(contracts.ContractError) as excinfo:
        contracts.JsonContract(Plan).validate('{"questions": ["a", "b"]}')
    assert "questions" in str(excinfo.value)


def test_json_contract_rejects_unparseable_output():
    from app.harness import contracts

    with pytest.raises(contracts.ContractError):
        contracts.JsonContract(Plan).validate("I'd rather not.")


def test_json_contract_rejects_an_empty_completion():
    from app.harness import contracts

    with pytest.raises(contracts.ContractError):
        contracts.JsonContract(Plan).validate("")


def test_repair_message_quotes_the_failure_back_to_the_model():
    from app.harness import contracts

    message = contracts.repair_message("questions: too short")
    assert message["role"] == "user"
    assert "questions: too short" in message["content"]
