from fastapi.testclient import TestClient
import pytest


def test_compile_rule_with_ai_endpoint(client: TestClient):
    response = client.post(
        "/api/rules/compile-ai",
        json={
            "prompt": "If tax difference is within 500 INR and GSTIN matches exactly, flag for review",
            "actor": "Tax Auditor",
        },
    )
    assert response.status_code == 201, response.text
    rule = response.json()
    assert rule["rule_id"].startswith("R-")
    assert rule["status"] == "ACTIVE"
    assert rule["action_authority"] == "PROPOSE_ONLY"
    assert len(rule["conditions"]) >= 1


def test_compile_rule_date_tolerance_ai(client: TestClient):
    response = client.post(
        "/api/rules/compile-ai",
        json={
            "prompt": "Propose near match when document dates drift by up to 7 days and GSTIN is exact",
            "actor": "Tax Analyst",
        },
    )
    assert response.status_code == 201, response.text
    rule = response.json()
    assert rule["status"] == "ACTIVE"
    cond_fields = [c["field"] for c in rule["conditions"]]
    assert "document_date" in cond_fields or "gstin" in cond_fields
