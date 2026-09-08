from fastapi.testclient import TestClient
import pytest
from app.main import create_app
from app.config import Settings
from app.domain.models import RuleStatus


@pytest.fixture
def client(tmp_path):
    # Use standard database or temporary test settings
    settings = Settings(database_path="data/gst_reconciliation.db")
    app = create_app(settings)
    return TestClient(app)


def test_01_phase1_catalog_regression_safety(client):
    """Verify Phase 1 rules catalog GET endpoint continues to function perfectly."""
    res = client.get("/api/rules/catalog")
    assert res.status_code == 200
    data = res.json()
    assert data["summary"]["total_rules"] >= 25
    assert data["summary"]["configurable_count"] >= 6
    assert data["summary"]["locked_count"] >= 19
    assert len(data["stages"]) == 13


def test_02_history_endpoint_returns_ordered_versions(client):
    """Verify GET /api/rules/{rule_id}/history returns ordered versions."""
    res = client.get("/api/rules/R-001/history")
    assert res.status_code == 200
    data = res.json()
    assert data["rule_id"] == "R-001"
    assert data["configurable"] is True
    assert data["locked"] is False
    assert len(data["versions"]) >= 1
    assert data["versions"][0]["version"] >= 1


def test_03_version_detail_endpoint(client):
    """Verify GET /api/rules/{rule_id}/versions/{version} returns detailed rule definition."""
    res = client.get("/api/rules/R-001/versions/1")
    assert res.status_code == 200
    data = res.json()
    assert "rule" in data
    assert data["rule"]["rule_id"] == "R-001"
    assert data["rule"]["version"] == 1
    assert data["validation"]["valid"] is True


def test_04_create_configurable_rule_draft(client):
    """Verify a new DRAFT version can be created for a configurable business rule."""
    payload = {
        "rule_id": "R-002",
        "name": "Updated R-002 Separator Normalization Draft",
        "description": "Propose near match when GSTIN matches and invoice numbers normalize.",
        "rule_type": "NORMALIZATION",
        "conditions": [
            {"field": "gstin", "operator": "EXACT", "value": None},
            {"field": "document_number", "operator": "NORMALIZED_EXACT", "value": None}
        ],
        "action": {"type": "PROPOSE_NEAR_MATCH", "value": None},
        "rationale": "Testing draft creation capability."
    }
    res = client.post("/api/rules/draft", json=payload)
    assert res.status_code == 201
    data = res.json()
    assert data["rule_id"] == "R-002"
    assert data["status"] == "DRAFT"
    assert data["name"] == "Updated R-002 Separator Normalization Draft"


def test_05_edit_draft_version(client):
    """Verify edits are permitted on DRAFT status rules."""
    payload = {
        "name": "Edited R-002 Draft Name",
        "description": "Edited description for draft version.",
        "rationale": "Updated rationale for audit tracking."
    }
    res = client.put("/api/rules/draft/R-002", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["rule_id"] == "R-002"
    assert data["status"] == "DRAFT"
    assert data["name"] == "Edited R-002 Draft Name"


def test_06_reject_edit_on_active_non_draft_version(client):
    """Verify non-DRAFT (ACTIVE) versions cannot be edited via Phase 2A draft update API."""
    payload = {
        "name": "Attempting to edit ACTIVE R-001"
    }
    res = client.put("/api/rules/draft/R-001", json=payload)
    assert res.status_code == 400
    assert "Only DRAFT versions can be edited" in res.json()["detail"]


def test_07_locked_guardrail_draft_rejection_create(client):
    """Verify write attempt (create draft) on a locked system guardrail returns 403 Forbidden."""
    payload = {
        "rule_id": "EXACT-D001",
        "name": "Hacked EXACT-D001 Guardrail",
        "description": "Attempting to override exact match guardrail",
        "conditions": [{"field": "document_number", "operator": "EXACT", "value": None}],
        "action": {"type": "PROPOSE_NEAR_MATCH", "value": None}
    }
    res = client.post("/api/rules/draft", json=payload)
    assert res.status_code == 403
    assert "locked system guardrail" in res.json()["detail"]


def test_08_locked_guardrail_draft_rejection_edit(client):
    """Verify edit attempt on a locked system guardrail returns 403 Forbidden."""
    payload = {
        "name": "Modifying EXACT-D001"
    }
    res = client.put("/api/rules/draft/EXACT-D001", json=payload)
    assert res.status_code == 403
    assert "locked system guardrail" in res.json()["detail"]


def test_09_deterministic_validation_valid_rule(client):
    """Verify deterministic validation accepts valid structured rule definition."""
    payload = {
        "name": "Valid Rule Draft",
        "description": "Valid rule description",
        "conditions": [{"field": "taxable_value", "operator": "ABSOLUTE_TOLERANCE", "value": "10.00"}],
        "action": {"type": "TOLERANCE_MATCH"}
    }
    res = client.post("/api/rules/draft/R-002/validate", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["valid"] is True
    assert len(data["issues"]) == 0


def test_10_deterministic_validation_invalid_operator(client):
    """Verify deterministic validation rejects unsupported operator."""
    payload = {
        "name": "Invalid Operator Draft",
        "description": "Test invalid operator",
        "conditions": [{"field": "gstin", "operator": "FUZZY_MAGIC_OPERATOR", "value": None}],
        "action": {"type": "PROPOSE_NEAR_MATCH"}
    }
    res = client.post("/api/rules/draft/R-002/validate", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["valid"] is False
    assert any(i["code"] == "UNSUPPORTED_OPERATOR" for i in data["issues"])


def test_11_deterministic_validation_missing_threshold_value(client):
    """Verify deterministic validation rejects tolerance operator with missing threshold value."""
    payload = {
        "name": "Missing Threshold Draft",
        "description": "Test missing threshold",
        "conditions": [{"field": "taxable_value", "operator": "ABSOLUTE_TOLERANCE", "value": None}],
        "action": {"type": "TOLERANCE_MATCH"}
    }
    res = client.post("/api/rules/draft/R-002/validate", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["valid"] is False
    assert any(i["code"] == "MISSING_THRESHOLD_VALUE" for i in data["issues"])


def test_12_deterministic_validation_unsupported_canonical_field(client):
    """Verify deterministic validation rejects unsupported canonical field."""
    payload = {
        "name": "Unsupported Field Draft",
        "description": "Test unsupported field",
        "conditions": [{"field": "arbitrary_user_field", "operator": "EXACT", "value": None}],
        "action": {"type": "PROPOSE_NEAR_MATCH"}
    }
    res = client.post("/api/rules/draft/R-002/validate", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["valid"] is False
    assert any(i["code"] == "UNSUPPORTED_CANONICAL_FIELD" for i in data["issues"])


def test_13_active_engine_isolation(client):
    """Verify creating and editing DRAFT rules has ZERO effect on active reconciliation execution."""
    # 1. Create a draft rule with aggressive matching condition
    payload = {
        "rule_id": "R-999",
        "name": "Test Draft Rule for Engine Isolation",
        "description": "Aggressive draft rule should not affect reconciliation execution.",
        "rule_type": "NORMALIZATION",
        "conditions": [{"field": "gstin", "operator": "EXACT", "value": None}],
        "action": {"type": "PROPOSE_NEAR_MATCH"},
        "rationale": "Engine isolation test"
    }
    create_res = client.post("/api/rules/draft", json=payload)
    assert create_res.status_code == 201
    assert create_res.json()["status"] == "DRAFT"

    # 2. Verify R-999 is NOT returned as active rule in profile or catalog active rules
    cat_res = client.get("/api/rules/catalog")
    assert cat_res.status_code == 200
    r999_cat = next((r for r in cat_res.json()["rules"] if r["rule_id"] == "R-999"), None)
    if r999_cat:
        assert r999_cat["status"] == "DRAFT"
        assert r999_cat["enabled"] is False


def test_14_historical_versions_preserved(client):
    """Verify historical versions remain permanently available after draft edits."""
    history_res = client.get("/api/rules/R-002/history")
    assert history_res.status_code == 200
    versions = history_res.json()["versions"]
    assert len(versions) >= 1


def test_15_no_activation_api_available(client):
    """Verify Phase 2A does not expose functional activation endpoints or allow activating drafts."""
    res = client.post("/api/rules/R-002/activate", json={"actor": "POC user"})
    assert res.status_code in (403, 404, 405, 501)
    assert "not permitted in Phase 2A" in res.json().get("detail", "")
