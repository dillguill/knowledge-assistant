from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Anchored to backend/ rather than the process CWD, so `uv run uvicorn ...`
# picks the same file up whether it is launched from backend/ or the repo root.
# A real environment variable still wins over anything in the file, which is
# what keeps the Space (env vars only, no .env shipped) unaffected.
_ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=_ENV_FILE,
        env_file_encoding="utf-8",
        # A shared .env may carry unrelated keys (frontend VITE_*, tooling);
        # they are not this model's business and must not raise.
        extra="ignore",
    )

    openrouter_api_key: str = ""
    allowed_origins: str = "https://dillguill.github.io,http://localhost:5173"
    default_model: str = "google/gemma-4-26b-a4b-it:free"
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    owner_token: str = ""
    hf_token: str = ""
    hf_dataset_repo: str = ""
    data_dir: str = "data"
    context_char_budget: int = 24000
    attachment_max_bytes: int = 20_000_000
    firecrawl_api_key: str = ""
    web_search_max_results: int = 5
    web_search_cache_ttl_s: int = 3600
    web_search_char_budget: int = 12000
    skill_max_model_calls: int = 12
    skill_max_sections: int = 4
    skill_contract_retries: int = 2
    skill_agent_max_iterations: int = 6

    @property
    def origins(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
