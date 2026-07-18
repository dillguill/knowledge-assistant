from app.config import get_settings


def test_knowledge_settings_defaults(monkeypatch):
    get_settings.cache_clear()
    s = get_settings()
    assert s.owner_token == ""
    assert s.data_dir == "data"
    assert s.context_char_budget == 24000
    assert s.attachment_max_bytes == 20_000_000


def test_settings_read_env(monkeypatch):
    monkeypatch.setenv("OWNER_TOKEN", "sekrit")
    monkeypatch.setenv("HF_DATASET_REPO", "dillguill/knowledge-assistant-data")
    get_settings.cache_clear()
    s = get_settings()
    assert s.owner_token == "sekrit"
    assert s.hf_dataset_repo == "dillguill/knowledge-assistant-data"
    get_settings.cache_clear()
