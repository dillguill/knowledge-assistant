# Ensures the backend root (and thus the `app` package) is importable in tests.

import pytest

from app.config import Settings


@pytest.fixture(autouse=True, scope="session")
def ignore_local_env_file():
    """Tests never read the developer's local backend/.env.

    `Settings` loads that file so local runs don't need `export`, but a test
    asserting a default (`owner_token == ""`, `data_dir == "data"`) would then
    fail on a machine that has a real .env and pass everywhere else — the
    "works on my machine" bug inverted, and the worst kind to debug.

    Env vars set with `monkeypatch.setenv` still work: this only removes the
    file as a source.
    """
    original = Settings.model_config.get("env_file")
    Settings.model_config["env_file"] = None
    yield
    Settings.model_config["env_file"] = original
