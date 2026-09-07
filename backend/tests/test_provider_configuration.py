from pathlib import Path

from fastapi.testclient import TestClient

from app.config import PROJECT_ROOT, Settings
from app.main import create_app
from app.providers.factory import create_llm_provider


def test_project_root_env_is_canonical_and_openai_key_serves_all_features(tmp_path: Path):
    assert Settings.model_config["env_file"] == (str(PROJECT_ROOT / ".env"),)
    settings = Settings(
        database_path=tmp_path / "provider.db", upload_dir=tmp_path / "uploads",
        export_dir=tmp_path / "exports", openai_api_key="test-key",
        openai_model="fixture-model", llm_api_key=None, _env_file=None,
    )
    provider = create_llm_provider(settings)
    assert provider.provider_name == "openai"
    with TestClient(create_app(settings)) as client:
        health = client.get("/health").json()["provider"]
        assert health["available"] is True
        assert health["schema_mapping_ready"] is True
        assert health["ai_investigation_ready"] is True
        assert health["model"] == "fixture-model"
        assert health["secrets_exposed"] is False
        assert "test-key" not in str(health)
