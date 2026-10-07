"""Application settings, loaded from the environment with sane local defaults."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "Signal Clone API"
    debug: bool = False

    # SQLite lives next to the backend package so it survives `uvicorn --reload`.
    database_url: str = f"sqlite:///{BACKEND_DIR / 'signal_clone.db'}"

    # Override in production. Render injects this via render.yaml's generateValue.
    jwt_secret: str = "dev-only-insecure-secret-change-me"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 24 * 30  # 30 days; this is a demo app

    # The one OTP the mocked verification flow accepts.
    mock_otp_code: str = "123456"

    # Comma-separated in the environment, list in code.
    allowed_origins: list[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]

    # Seed the database on startup when it has no users.
    seed_on_startup: bool = True

    @field_validator("allowed_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
