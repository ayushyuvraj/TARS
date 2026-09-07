from app.domain.models import CandidateStatus, RuleStatus
from test_phase5 import _phase5_session, _upload


def test_profile_rule_pattern_governance_lifecycle(client, sample_files):
    reconciliation_id = _phase5_session(client, sample_files)
    created = client.post(
        f"/api/client-profiles/from-reconciliation/{reconciliation_id}",
        json={"client_name": "ABC Ltd", "profile_name": "ABC Ltd GST Purchase Reconciliation", "approved_by": "POC user"},
    )
    assert created.status_code == 200, created.text
    profile = created.json()
    assert profile["saved_mapping"]["datasets"] and profile["saved_policy"]["rules"]
    profile_id = profile["id"]
    assert client.get(f"/api/client-profiles/{profile_id}").json()["profile_name"] == profile["profile_name"]

    detected = client.post(f"/api/reconciliations/{reconciliation_id}/patterns/detect")
    assert detected.status_code == 200, detected.text
    patterns = detected.json()
    assert len(patterns) == 1 and patterns[0]["observation_count"] >= 5
    assert len(client.post(f"/api/reconciliations/{reconciliation_id}/patterns/detect").json()) == 1

    draft = client.post(
        f"/api/reconciliations/{reconciliation_id}/patterns/{patterns[0]['id']}/create-rule?profile_id={profile_id}"
    )
    assert draft.status_code == 200, draft.text
    rule = draft.json()
    assert rule["status"] == "DRAFT"
    assert rule["provenance"]["type"] == "HUMAN_DECISION_PATTERN"
    assert rule["provenance"]["decision_count"] == patterns[0]["observation_count"]

    before = client.get(f"/api/rules/{rule['rule_id']}").json()
    simulation = client.post(f"/api/rules/{rule['rule_id']}/simulate?reconciliation_id={reconciliation_id}")
    assert simulation.status_code == 200, simulation.text
    assert simulation.json()["read_only"] is True
    assert client.get(f"/api/rules/{rule['rule_id']}").json() == before
    assert simulation.json()["correct_known_approvals"] >= 5

    approved = client.post(f"/api/rules/{rule['rule_id']}/approve", json={"actor": "POC user"})
    assert approved.status_code == 200, approved.text
    active = client.post(f"/api/rules/{rule['rule_id']}/activate", json={"actor": "POC user"})
    assert active.status_code == 200, active.text
    assert active.json()["status"] == RuleStatus.ACTIVE
    assert active.json()["action_authority"] == "PROPOSE_ONLY"

    definition = {
        "name": "Invoice separator normalization extended",
        "description": "Draft successor also documents underscore normalization.",
        "rule_type": "NORMALIZATION",
        "conditions": [{"field": "gstin", "operator": "EXACT"},
                       {"field": "document_number", "operator": "NORMALIZED_EXACT"}],
        "action": {"type": "PROPOSE_NEAR_MATCH"},
    }
    version2 = client.post(f"/api/rules/{rule['rule_id']}/versions", json=definition)
    assert version2.status_code == 200 and version2.json()["version"] == 2
    history = client.get(f"/api/rules/{rule['rule_id']}/history").json()
    assert [(item["version"], item["status"]) for item in history] == [(2, "DRAFT"), (1, "ACTIVE")]

    second = client.post(f"/api/client-profiles/{profile_id}/reconciliations")
    assert second.status_code == 200
    second_id = second.json()["id"]
    assert second.json()["summary"] is None
    _upload(client, second_id, "government", sample_files["government"])
    _upload(client, second_id, "purchase-register", sample_files["purchase_register"])
    compatibility = client.post(
        f"/api/client-profiles/{profile_id}/reconciliations/{second_id}/compatibility?apply_if_compatible=true"
    )
    assert compatibility.status_code == 200
    assert compatibility.json()["status"] == "PROFILE_COMPATIBLE"
    reused = client.get(f"/api/reconciliations/{second_id}").json()
    assert reused["mapping_proposal"]["validation"]["valid"] is True
    assert reused["confirmed_mapping"] and reused["confirmed_policy"]
    assert reused["summary"] is None and reused["client_profile_id"] == profile_id
    for endpoint in ("run/exact-match", "run/tolerance-match", "near-match/analyze"):
        response = client.post(f"/api/reconciliations/{second_id}/{endpoint}")
        assert response.status_code == 200, response.text
    executions = client.app.state.reconciliation_service.repository.list_rule_executions(second_id)
    assert len(executions) == 1
    assert executions[0].rule_id == rule["rule_id"] and executions[0].rule_version == 1
    assert executions[0].records_evaluated > 0 and executions[0].records_affected > 0
    assert executions[0].automatic_reconciliations == 0
    assert executions[0].result == "proposals_created"
    disabled = client.post(f"/api/rules/{rule['rule_id']}/disable", json={"actor": "POC user"})
    assert disabled.status_code == 200 and disabled.json()["status"] == "DISABLED"
    assert client.get(f"/api/client-profiles/{profile_id}").json()["active_rule_ids"] == []

    copilot = client.post(f"/api/reconciliations/{reconciliation_id}/copilot/messages", json={
        "message": f"Why does the {rule['name']} rule exist?"
    })
    assert copilot.status_code == 200
    assert rule["rule_id"] in copilot.json()["answer"]
    assert "PROPOSE_ONLY" in copilot.json()["answer"]
    assert copilot.json()["tool_calls"][0]["tool_name"] == "get_rule_provenance"

    events = {item["event_type"] for item in client.get(
        f"/api/reconciliations/{reconciliation_id}/audit-events?limit=200"
    ).json()}
    assert {"profile.created", "pattern.suggestion_created", "rule.draft_created",
            "rule.simulated", "rule.approved", "rule.activated", "rule.version_created"} <= events


def test_rule_validation_and_disabled_rule_state(client, sample_files):
    reconciliation_id = _phase5_session(client, sample_files)
    profile_id = client.post(f"/api/client-profiles/from-reconciliation/{reconciliation_id}", json={
        "client_name": "Safety Ltd", "profile_name": "Safety profile"
    }).json()["id"]
    invalid = client.post(f"/api/client-profiles/{profile_id}/rules", json={
        "name": "Unsafe", "description": "Invalid arbitrary field", "rule_type": "DETERMINISTIC",
        "conditions": [{"field": "python_expression", "operator": "EXACT"}],
        "action": {"type": "TOLERANCE_MATCH"},
    })
    assert invalid.status_code == 409


def test_pattern_minimum_support_and_conflict_suppression(client, sample_files):
    reconciliation_id = _phase5_session(client, sample_files)
    service = client.app.state.reconciliation_service
    governance = client.app.state.governance_service
    session = service.get(reconciliation_id)
    comparable = [item for item in session.near_match_analysis.candidates
                  if item.features.document_number_normalized_equal and not item.features.document_number_raw_equal]
    for item in session.near_match_analysis.candidates:
        item.status = CandidateStatus.MATERIAL_MISMATCH
    comparable[0].status = CandidateStatus.NEAR_MATCH_APPROVED
    service.repository.save_near_analysis(reconciliation_id, session.near_match_analysis,
                                          session.near_workflow_thread_id, session.near_match_summary)
    assert governance.detect_patterns(reconciliation_id) == []
    for item in comparable[:5]:
        item.status = CandidateStatus.NEAR_MATCH_APPROVED
    for item in comparable[5:10]:
        item.status = CandidateStatus.REJECTED_CANDIDATE
    service.repository.save_near_analysis(reconciliation_id, session.near_match_analysis,
                                          session.near_workflow_thread_id, session.near_match_summary)
    assert governance.detect_patterns(reconciliation_id) == []


def test_profile_renamed_schema_requires_confirmation_then_reuses_policy(client, sample_files, renamed_workbooks):
    source_id = _phase5_session(client, sample_files)
    profile = client.post(f"/api/client-profiles/from-reconciliation/{source_id}", json={
        "client_name": "ABC Ltd", "profile_name": "Renamed-schema profile", "approved_by": "POC user",
    }).json()
    session_id = client.post(f"/api/client-profiles/{profile['id']}/reconciliations").json()["id"]
    _upload(client, session_id, "government", renamed_workbooks["government"])
    _upload(client, session_id, "purchase-register", renamed_workbooks["purchase_register"])

    compatibility = client.post(
        f"/api/client-profiles/{profile['id']}/reconciliations/{session_id}/compatibility?apply_if_compatible=true"
    ).json()
    assert compatibility["status"] in {"PROFILE_PARTIALLY_COMPATIBLE", "PROFILE_INCOMPATIBLE"}
    assert compatibility["confirmation_required"] is True
    assert client.get(f"/api/reconciliations/{session_id}").json()["confirmed_policy"] is None

    analyzed = client.post(f"/api/reconciliations/{session_id}/mapping/analyze")
    assert analyzed.status_code == 200 and analyzed.json()["validation"]["valid"] is True
    assert client.post(f"/api/reconciliations/{session_id}/mapping/confirm").status_code == 200
    confirmed = client.post(
        f"/api/client-profiles/{profile['id']}/reconciliations/{session_id}/compatibility?apply_if_compatible=true"
    ).json()
    assert confirmed["confirmation_required"] is False
    reused = client.get(f"/api/reconciliations/{session_id}").json()
    assert reused["confirmed_policy"] == profile["saved_policy"]
    exact = client.post(f"/api/reconciliations/{session_id}/run/exact-match")
    assert exact.status_code == 200 and exact.json()["exact_matches"] == 520
