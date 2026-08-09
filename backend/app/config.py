from functools import lru_cache

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
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
