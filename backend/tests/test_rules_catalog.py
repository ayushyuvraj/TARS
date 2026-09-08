from fastapi.testclient import TestClient
from app.main import create_app
from app.config import Settings


def test_rules_catalog_endpoint(tmp_path):
    # Use real test DB or test settings
    settings = Settings(database_path="data/gst_reconciliation.db")
    app = create_app(settings)
    client = TestClient(app)

    response = client.get("/api/rules/catalog")
    assert response.status_code == 200
    data = response.json()

    assert "rules" in data
    assert "summary" in data
    assert "stages" in data

    rules = data["rules"]
    summary = data["summary"]
    stages = data["stages"]

    # Dynamic summary assertion
    assert summary["total_rules"] == len(rules)
    assert summary["total_rules"] >= 25
    assert summary["configurable_count"] == sum(1 for r in rules if r["configurable"])
    assert summary["locked_count"] == sum(1 for r in rules if r["locked"])
    assert summary["configurable_count"] >= 6
    assert summary["locked_count"] >= 19

    # Verify R-001 hero example properties from DB
    r001 = next((r for r in rules if r["rule_id"] == "R-001"), None)
    assert r001 is not None
    assert r001["source_of_truth"] == "DATABASE"
    assert r001["status"] == "ACTIVE"
    assert r001["version"] == 1
    assert r001["authority"] == "PROPOSE_ONLY"
    assert r001["human_friendly_if"] != ""
    assert r001["human_friendly_then"] != ""
    assert r001["provenance"] is not None
    assert r001["approval"] is not None
    assert r001["approval"]["approved_by"] == "POC user"

    # Verify R-002 properties from DB
    r002 = next((r for r in rules if r["rule_id"] == "R-002"), None)
    assert r002 is not None
    assert r002["source_of_truth"] == "DATABASE"
    assert r002["status"] == "DRAFT"
    assert r002["version"] == 1
    assert r002["authority"] == "PROPOSE_ONLY"

    # Verify locked rules classification
    exact001 = next((r for r in rules if r["rule_id"] == "EXACT-D001"), None)
    assert exact001 is not None
    assert exact001["locked"] is True
    assert exact001["configurable"] is False
    assert exact001["toggle_safety"] == "MANDATORY_SAFETY_RULE"

    # Verify stage pipeline sequence count (13 stages)
    assert len(stages) == 13
    assert stages[0]["stage_id"] == "UPLOAD_PROFILING"
    assert stages[-1]["stage_id"] == "EXPORT_GENERATION"
