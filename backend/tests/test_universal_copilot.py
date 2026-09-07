from __future__ import annotations

import pytest
from uuid import uuid4
from app.domain.models import CopilotRequest

def _upload(client, reconciliation_id, endpoint, path):
    with path.open("rb") as workbook:
        response = client.post(
            f"/api/reconciliations/{reconciliation_id}/files/{endpoint}",
            files={"file": (path.name, workbook, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        )
    assert response.status_code == 200, response.text

@pytest.fixture
def frozen_reconciliation_id(client, sample_files):
    reconciliation_id = client.post("/api/reconciliations").json()["id"]
    _upload(client, reconciliation_id, "government", sample_files["government"])
    _upload(client, reconciliation_id, "purchase-register", sample_files["purchase_register"])
    for endpoint in ("mapping/analyze", "mapping/confirm", "policy/propose", "policy/confirm",
                     "run/exact-match", "run/tolerance-match", "near-match/analyze",
                     "near-match/bulk-approve"):
        response = client.post(f"/api/reconciliations/{reconciliation_id}/{endpoint}")
        assert response.status_code == 200, response.text
    return reconciliation_id

@pytest.fixture
def copilot_service(client):
    return client.app.state.copilot_service

def test_copilot_ai_unavailable_state(copilot_service, frozen_reconciliation_id):
    """Verify that when LLM provider is unavailable, Copilot returns explicit unavailable state."""
    original_provider = copilot_service.provider
    try:
        copilot_service.provider = None
        request = CopilotRequest(message="What is a Near Match?")
        response = copilot_service.ask(frozen_reconciliation_id, request)
        
        assert response.provider == "unavailable"
        assert response.model is None
        assert "AI Copilot is currently unavailable" in response.answer
        assert len(response.evidence) == 0
        assert len(response.tool_calls) == 0
    finally:
        copilot_service.provider = original_provider

def test_copilot_out_of_domain_refusal(copilot_service, frozen_reconciliation_id):
    """Verify that non-TARS out-of-domain questions like recipes are refused politely with provider='domain_blocked'."""
    request = CopilotRequest(message="Give me a pizza recipe.")
    response = copilot_service.ask(frozen_reconciliation_id, request)
    
    assert response.provider == "domain_blocked"
    assert "TARS Copilot" in response.answer
    assert len(response.evidence) == 0

def test_copilot_conversational_multi_turn_context(copilot_service, frozen_reconciliation_id):
    """Verify multi-turn conversation context maintains record reference without repeating ID."""
    conversation_id = uuid4()
    
    # Turn 1: Explicit ID
    req1 = CopilotRequest(message="Why is GST-00761 a material mismatch?", conversation_id=conversation_id)
    res1 = copilot_service.ask(frozen_reconciliation_id, req1)
    if res1.provider != "unavailable":
        assert "GST-00761" in res1.answer

    # Turn 2: Follow-up without explicit ID
    req2 = CopilotRequest(message="What about its candidate?", conversation_id=conversation_id)
    res2 = copilot_service.ask(frozen_reconciliation_id, req2)
    if res2.provider != "unavailable":
        assert len(res2.evidence) > 0
        assert any(e.reference_id in ("GST-00761", "GST-00761") or "GST-00761" in str(e.facts) for e in res2.evidence)

    # Turn 3: Simplified explanation follow-up
    req3 = CopilotRequest(message="Explain that in simple words.", conversation_id=conversation_id)
    res3 = copilot_service.ask(frozen_reconciliation_id, req3)
    if res3.provider != "unavailable":
        assert response_ok := len(res3.answer) > 0

def test_copilot_product_help_near_match(copilot_service, frozen_reconciliation_id):
    """Verify product help query about Near Match."""
    request = CopilotRequest(message="What is a Near Match?")
    response = copilot_service.ask(frozen_reconciliation_id, request)
    
    if response.provider != "unavailable":
        assert "Near Match" in response.answer
        assert len(response.evidence) > 0

def test_copilot_unresolved_summary_populations(copilot_service, frozen_reconciliation_id):
    """Verify reconciliation summary question explicitly separates Govt and PR populations."""
    request = CopilotRequest(message="How many records are unresolved?")
    response = copilot_service.ask(frozen_reconciliation_id, request)
    
    if response.provider != "unavailable":
        assert "Government" in response.answer
        assert "Purchase Register" in response.answer or "PR" in response.answer
        assert len(response.evidence) > 0

def test_copilot_material_mismatch_record_lookup(copilot_service, frozen_reconciliation_id):
    """Verify record-level query for GST-00761."""
    request = CopilotRequest(message="Why is GST-00761 a material mismatch?")
    response = copilot_service.ask(frozen_reconciliation_id, request)
    
    if response.provider != "unavailable":
        assert "GST-00761" in response.answer
        assert len(response.evidence) > 0

def test_copilot_row_lookup_semantics(copilot_service, frozen_reconciliation_id):
    """Verify source row index lookup (row 776) with explicit physical row semantics."""
    request = CopilotRequest(message="Why is row 776 not an exact match?")
    response = copilot_service.ask(frozen_reconciliation_id, request)
    
    if response.provider != "unavailable":
        assert "row" in response.answer.lower()
        assert len(response.evidence) > 0
        assert "row_semantics" in str(response.evidence[0].facts)

def test_copilot_pattern_summary(copilot_service, frozen_reconciliation_id):
    """Verify factual pattern analysis query."""
    request = CopilotRequest(message="Are there any patterns in the unresolved population?")
    response = copilot_service.ask(frozen_reconciliation_id, request)
    
    if response.provider != "unavailable":
        assert len(response.evidence) > 0
        assert response.evidence[0].reference_type == "pattern_summary"
