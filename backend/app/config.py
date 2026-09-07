from __future__ import annotations

from typing import Any
from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(str(PROJECT_ROOT / ".env"),), env_file_encoding="utf-8", extra="ignore"
    )

    app_name: str = "GST Agentic Reconciliation Workbench"
    app_env: str = "development"
    api_prefix: str = "/api"
    database_path: Path = Path("data/gst_reconciliation.db")
    upload_dir: Path = Path("data/uploads")
    export_dir: Path = Path("data/exports")
    kigs_template_path: Path = Path("sample_data/KIGS_GSTR2B_Reco_Template.xlsx")
    frontend_origin: str = "http://localhost:5173"
    max_upload_bytes: int = 25 * 1024 * 1024

    llm_provider: str = "openai"
    llm_model: str = "gpt-4.1-mini"
    llm_api_key: str | None = Field(default=None, repr=False)
    llm_max_repair_attempts: int = 1
    openai_api_key: str | None = Field(default=None, repr=False)
    openai_model: str = "gpt-5.4-mini"
    ai_investigation_timeout_seconds: float = 45.0
    ai_investigation_max_tool_calls: int = 8
    mapping_high_confidence_threshold: float = 0.90
    mapping_medium_confidence_threshold: float = 0.70

    @property
    def effective_openai_api_key(self) -> str | None:
        """One OpenAI credential for all model-backed features; legacy name remains compatible."""
        return self.openai_api_key or self.llm_api_key

    @property
    def effective_openai_model(self) -> str:
        return self.openai_model if self.openai_api_key else self.llm_model

    def model_post_init(self, __context: Any) -> None:
        if not self.database_path.is_absolute():
            self.database_path = (PROJECT_ROOT / self.database_path).resolve()
        if not self.upload_dir.is_absolute():
            self.upload_dir = (PROJECT_ROOT / self.upload_dir).resolve()
        if not self.export_dir.is_absolute():
            self.export_dir = (PROJECT_ROOT / self.export_dir).resolve()
        if not self.kigs_template_path.is_absolute():
            self.kigs_template_path = (PROJECT_ROOT / self.kigs_template_path).resolve()


@lru_cache
def get_settings() -> Settings:
    return Settings()
