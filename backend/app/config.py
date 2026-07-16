from functools import lru_cache

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    openrouter_api_key: str = ""
    allowed_origins: str = "https://dillguill.github.io,http://localhost:5173"
    default_model: str = "qwen/qwen3-4b:free"
    openrouter_base_url: str = "https://openrouter.ai/api/v1"

    @property
    def origins(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
