from functools import lru_cache

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    openrouter_api_key: str = ""
    allowed_origins: str = "https://dillguill.github.io,http://localhost:5173"
    default_model: str = "meta-llama/llama-3.3-70b-instruct:free"
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    owner_token: str = ""
    hf_token: str = ""
    hf_dataset_repo: str = ""
    data_dir: str = "data"
    context_char_budget: int = 24000
    attachment_max_bytes: int = 2_000_000

    @property
    def origins(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
