from __future__ import annotations

import pandas as pd

from app.domain.models import ActorType, AgentEvent, CandidateStatus
from app.domain.models import (
    ColumnMappingCandidate, ConfirmedDatasetMapping, ConfirmedMappingSet, DatasetRole,
    MatchingThresholds, ProposedBy,
)
from app.evaluation.near_match import NearMatchEvaluator
from app.services.near_match import NearMatchEngine, normalize_invoice_number


def _upload(client, reconciliation_id, endpoint, path):
    with path.open("rb") as workbook:
        response = client.post(
            f"/api/reconciliations/{reconciliation_id}/files/{endpoint}",
            files={"file": (path.name, workbook, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        )
    assert response.status_code == 200, response.text


def _through_tolerance(client, sample_files):
    reconciliation_id = client.post("/api/reconciliations").json()["id"]
    _upload(client, reconciliation_id, "government", sample_files["government"])
    _upload(client, reconciliation_id, "purchase-register", sample_files["purchase_register"])
    assert client.post(f"/api/reconciliations/{reconciliation_id}/mapping/analyze").status_code == 200
    assert client.post(f"/api/reconciliations/{reconciliation_id}/mapping/confirm").status_code == 200
    assert client.post(f"/api/reconciliations/{reconciliation_id}/policy/propose").status_code == 200
    assert client.post(f"/api/reconciliations/{reconciliation_id}/policy/confirm").status_code == 200
    assert client.post(f"/api/reconciliations/{reconciliation_id}/run/exact-match").json()["exact_matches"] == 520
    assert client.post(f"/api/reconciliations/{reconciliation_id}/run/tolerance-match").json()["tolerance_matches"] == 140
    return reconciliation_id


def test_invoice_normalization_is_explicit_and_conservative():
    assert normalize_invoice_number(" ster/26/01661 ") == "STER2601661"
    assert normalize_invoice_number("STER 26-01661") == "STER2601661"
    assert normalize_invoice_number("STER/26/01662") != normalize_invoice_number("STER/26/01661")


def _mapping() -> ConfirmedMappingSet:
    fields = ["record_id", "gstin", "document_number", "document_date", "document_type",
              "taxable_value", "gst_rate", "igst", "cgst", "sgst", "cess"]
    return ConfirmedMappingSet(
        reconciliation_id="00000000-0000-0000-0000-000000000001",
        datasets=[ConfirmedDatasetMapping(
            source_dataset=role,
            mappings=[ColumnMappingCandidate(
                source_dataset=role, source_column=field, canonical_field=field,
                confidence=1, rationale="test", proposed_by=ProposedBy.HUMAN,
            ) for field in fields],
        ) for role in DatasetRole],
    )


def test_blocking_features_scoring_thresholds_reciprocity_and_ambiguity():
    government = pd.DataFrame([
        {"record_id": "G1", "gstin": "GST1", "document_number": "ROCKY/23/1001", "document_date": "2026-08-10", "document_type": "Invoice", "taxable_value": 1000, "gst_rate": 18, "igst": 180, "cgst": 0, "sgst": 0, "cess": 0},
        {"record_id": "G2", "gstin": "GST2", "document_number": "OTHER/99", "document_date": "2026-08-10", "document_type": "Invoice", "taxable_value": 500, "gst_rate": 18, "igst": 90, "cgst": 0, "sgst": 0, "cess": 0},
    ])
    purchase = pd.DataFrame([
        {"record_id": "P1", "gstin": "GST1", "document_number": "ROCKY-23-1001", "document_date": "2026-08-10", "document_type": "Invoice", "taxable_value": 1000, "gst_rate": 18, "igst": 180, "cgst": 0, "sgst": 0, "cess": 0},
        {"record_id": "P2", "gstin": "WRONG", "document_number": "OTHER-99", "document_date": "2026-08-10", "document_type": "Invoice", "taxable_value": 500, "gst_rate": 18, "igst": 90, "cgst": 0, "sgst": 0, "cess": 0},
    ])
    engine = NearMatchEngine()
    mappings = engine._mapping(_mapping())
    blocked = engine.candidate_generation(government, purchase, mappings, set(), set())
    assert len(blocked) == 1
    features = engine.calculate_features(blocked[0][0], blocked[0][1], mappings)
    score, components = engine.score_candidate(features)
    assert features.document_number_normalized_equal
    assert features.document_number_similarity == 1
    assert score == 1 and components.invoice == 1
    analysis = engine.analyze("00000000-0000-0000-0000-000000000001", government, purchase, _mapping(), [])
    proposal = next(item for item in analysis.candidates if item.status == CandidateStatus.NEAR_MATCH_PROPOSED)
    assert proposal.reciprocal_best and proposal.eligible_for_bulk_approval

    fuzzy_purchase = purchase.copy()
    fuzzy_purchase.loc[0, "document_number"] = "ROCKY-23-1010"
    strict = NearMatchEngine(MatchingThresholds(near_match_threshold=0.99)).analyze(
        "00000000-0000-0000-0000-000000000001", government, fuzzy_purchase, _mapping(), []
    )
    assert not any(item.status == CandidateStatus.NEAR_MATCH_PROPOSED for item in strict.candidates)
    broad = NearMatchEngine(MatchingThresholds(near_match_threshold=0.90)).analyze(
        "00000000-0000-0000-0000-000000000001", government, fuzzy_purchase, _mapping(), []
    )
    assert any(item.status == CandidateStatus.NEAR_MATCH_PROPOSED for item in broad.candidates)

    ambiguous_purchase = pd.concat([purchase.iloc[[0]], purchase.iloc[[0]].assign(record_id="P3", document_number="ROCKY/23/1002")])
    ambiguous = engine.analyze(
        "00000000-0000-0000-0000-000000000001", government.iloc[[0]], ambiguous_purchase, _mapping(), []
    )
    assert len(ambiguous.ambiguities) == 1
    assert not any(item.status == CandidateStatus.NEAR_MATCH_PROPOSED for item in ambiguous.candidates)


def test_near_match_ground_truth_checkpoint_bulk_approval_and_audit(client, sample_files):
    reconciliation_id = _through_tolerance(client, sample_files)
    response = client.post(f"/api/reconciliations/{reconciliation_id}/near-match/analyze")
    assert response.status_code == 200, response.text
    analysis_payload = response.json()
    observed_summary = dict(analysis_payload["summary"])
    assert observed_summary.pop("runtime_ms") >= 0
    assert observed_summary == {
        "candidate_count": 2750,
        "high_confidence_proposals": 100,
        "ambiguous_government_records": 40,
        "material_mismatch_records": 80,
        "gst_only_records": 120,
        "pr_only_records": 130,
    }
    assert client.app.state.near_workflow.checkpoint_next_nodes(reconciliation_id) == ("await_near_match_approval",)
    restored = client.get(f"/api/reconciliations/{reconciliation_id}/near-match").json()
    assert restored == analysis_payload
    for status, expected_count in (("NEAR_MATCH_PROPOSED", 100), ("AMBIGUOUS", 40),
                                   ("MATERIAL_MISMATCH", 80), ("GST_ONLY", 120), ("PR_ONLY", 130)):
        filtered = client.get(f"/api/reconciliations/{reconciliation_id}/results?status={status}")
        assert filtered.status_code == 200
        assert len(filtered.json()["records"]) == expected_count

    analysis = client.app.state.reconciliation_service.get_near_analysis(reconciliation_id)
    ground_truth = pd.read_excel(sample_files["ground_truth"])
    report = NearMatchEvaluator().evaluate(analysis, ground_truth)
    assert report.candidate_recall == 1
    assert report.top_1_accuracy == 1
    assert report.safe_proposal_precision == 1
    assert report.safe_proposal_recall == 1
    assert report.false_positive_count == 0
    assert report.ambiguous_auto_match_count == 0
    assert report.duplicate_consumption_count == 0
    assert report.material_mismatch_false_matches == 0
    assert report.gst_only_false_matches == 0
    assert report.pr_only_false_consumption == 0

    proposed = [item for item in analysis.candidates if item.status == CandidateStatus.NEAR_MATCH_PROPOSED]
    expected_near = {
        (str(row.Government_Record_ID), str(row.Expected_PR_Record_IDs))
        for row in ground_truth[ground_truth["Scenario"] == "NEAR"].itertuples()
    }
    assert {(item.government_record_id, item.purchase_register_record_id) for item in proposed} == expected_near
    assert len(analysis.ambiguities) == 40
    assert all(item.candidate_count >= 2 for item in analysis.ambiguities)

    unsafe_candidate = analysis.ambiguities[0].candidate_ids[0]
    unsafe = client.post(
        f"/api/reconciliations/{reconciliation_id}/near-match/{unsafe_candidate}/decision",
        json={"action": "approve"},
    )
    assert unsafe.status_code == 409
    first = proposed[0]
    rejected = client.post(
        f"/api/reconciliations/{reconciliation_id}/near-match/{first.id}/decision",
        json={"action": "reject"},
    )
    assert rejected.status_code == 200
    assert rejected.json()["near_match_proposals"] == 99
    persisted_rejection = client.get(f"/api/reconciliations/{reconciliation_id}/near-match").json()
    assert next(item for item in persisted_rejection["candidates"] if item["id"] == str(first.id))["status"] == "REJECTED_CANDIDATE"
    rerun = client.post(f"/api/reconciliations/{reconciliation_id}/near-match/analyze")
    assert rerun.status_code == 200
    refreshed = client.app.state.reconciliation_service.get_near_analysis(reconciliation_id)
    proposed = [item for item in refreshed.candidates if item.status == CandidateStatus.NEAR_MATCH_PROPOSED]
    first = proposed[0]
    approved = client.post(
        f"/api/reconciliations/{reconciliation_id}/near-match/{first.id}/decision",
        json={"action": "approve"},
    )
    assert approved.status_code == 200
    assert approved.json()["near_matches"] == 1
    assert approved.json()["near_match_proposals"] == 99
    duplicate = client.post(
        f"/api/reconciliations/{reconciliation_id}/near-match/{first.id}/decision",
        json={"action": "approve"},
    )
    assert duplicate.status_code == 409

    bulk = client.post(f"/api/reconciliations/{reconciliation_id}/near-match/bulk-approve")
    assert bulk.status_code == 200, bulk.text
    payload = bulk.json()
    assert payload["requested"] == payload["approved"] == 99
    assert payload["skipped"] == payload["failed"] == 0
    assert payload["skip_reasons"] == payload["errors"] == []
    assert payload["duplicate_pr_consumption"] == 0
    assert payload["before"] == {
        "resolved_records": 661,
        "government_open": 339,
        "purchase_register_remaining": 389,
    }
    assert payload["after"] == {
        "resolved_records": 760,
        "government_open": 240,
        "purchase_register_remaining": 290,
    }
    assert payload["summary"] == {
        "reconciliation_id": reconciliation_id,
        "status": "completed",
        "government_records": 1000,
        "purchase_register_records": 1050,
        "exact_matches": 520,
        "tolerance_matches": 140,
        "near_match_proposals": 0,
        "near_matches": 100,
        "ambiguous_records": 40,
        "material_mismatch_records": 80,
        "gst_only_records": 120,
        "pr_only_records": 130,
        "resolved_records": 760,
        "remaining_government_records": 240,
        "remaining_purchase_register_records": 290,
    }
    assert client.app.state.near_workflow.checkpoint_next_nodes(reconciliation_id) == ()
    near_results = client.get(f"/api/reconciliations/{reconciliation_id}/results?status=NEAR_MATCHED").json()["records"]
    actual_near = {(row["government_record_id"], row["purchase_register_record_id"]) for row in near_results}
    assert actual_near == expected_near
    assert len({purchase for _, purchase in actual_near}) == 100
    all_results = client.app.state.reconciliation_service.repository.list_match_results(reconciliation_id)
    assert len({item.government_record_id for item in all_results}) == len(all_results) == 760
    assert len({item.purchase_register_record_id for item in all_results}) == 760
    events = {item["event_type"] for item in client.get(
        f"/api/reconciliations/{reconciliation_id}/audit-events?limit=200"
    ).json()}
    assert {"candidate_generation.completed", "candidate_scoring.completed",
            "near_match.proposals_created", "near_match.ambiguity_detected",
            "near_match.approval_required", "near_match.rejected", "near_match.approved",
            "NEAR_MATCH_BULK_APPROVAL"} <= events

    audit = client.app.state.reconciliation_service.repository.list_events(reconciliation_id, limit=1000)
    batch_event = next(item for item in audit if item.event_type == "NEAR_MATCH_BULK_APPROVAL")
    assert batch_event.metadata["batch_id"] == payload["batch_id"]
    assert batch_event.metadata["requested"] == batch_event.metadata["approved"] == 99
    pair_events = [item for item in audit if item.event_type == "near_match.approved"
                   and item.metadata.get("batch_id") == payload["batch_id"]]
    assert len(pair_events) == 99
    assert all(item.approval_status == "human_approved" for item in pair_events)
    assert all(item.metadata["approval_mode"] == "human_bulk_approval" for item in pair_events)

    retry = client.post(f"/api/reconciliations/{reconciliation_id}/near-match/bulk-approve")
    assert retry.status_code == 200
    assert retry.json()["requested"] == retry.json()["approved"] == 0
    retry_results = client.app.state.reconciliation_service.repository.list_match_results(reconciliation_id)
    assert len(retry_results) == 760
    assert len({item.purchase_register_record_id for item in retry_results}) == 760


def test_bulk_approves_every_current_safe_proposal_and_excludes_other_queues(client, sample_files):
    reconciliation_id = _through_tolerance(client, sample_files)
    analysis = client.post(f"/api/reconciliations/{reconciliation_id}/near-match/analyze").json()
    assert analysis["summary"]["high_confidence_proposals"] == 100

    result = client.post(f"/api/reconciliations/{reconciliation_id}/near-match/bulk-approve").json()
    assert result["requested"] == result["approved"] == 100
    assert result["skipped"] == result["failed"] == 0
    assert result["duplicate_pr_consumption"] == 0
    assert result["summary"]["near_matches"] == 100
    assert result["summary"]["ambiguous_records"] == 40
    assert result["summary"]["material_mismatch_records"] == 80
    assert result["summary"]["gst_only_records"] == 120
    assert result["summary"]["pr_only_records"] == 130

    matches = client.app.state.reconciliation_service.repository.list_match_results(reconciliation_id)
    near = [item for item in matches if item.match_type == "near"]
    assert len(near) == len({item.purchase_register_record_id for item in near}) == 100

    rerun = client.post(f"/api/reconciliations/{reconciliation_id}/near-match/analyze")
    assert rerun.status_code == 200
    assert sum(item["status"] == "NEAR_MATCH_PROPOSED" for item in rerun.json()["candidates"]) == 0
    assert len([
        item for item in client.app.state.reconciliation_service.repository.list_match_results(reconciliation_id)
        if item.match_type == "near"
    ]) == 100


def test_bulk_restores_audited_approvals_after_legacy_reanalysis_overwrite(client, sample_files):
    reconciliation_id = _through_tolerance(client, sample_files)
    assert client.post(f"/api/reconciliations/{reconciliation_id}/near-match/analyze").status_code == 200
    service = client.app.state.reconciliation_service
    proposal_snapshot = service.get_near_analysis(reconciliation_id).model_copy(deep=True)
    assert client.post(f"/api/reconciliations/{reconciliation_id}/near-match/bulk-approve").json()["approved"] == 100

    completed_summary = service.get(reconciliation_id).near_match_summary
    assert completed_summary is not None
    service.repository.save_near_analysis(
        reconciliation_id, proposal_snapshot, "legacy-overwrite", completed_summary,
    )

    restored = client.post(f"/api/reconciliations/{reconciliation_id}/near-match/bulk-approve")
    assert restored.status_code == 200
    assert restored.json()["approved"] == 100
    assert restored.json()["summary"]["near_match_proposals"] == 0
    assert restored.json()["summary"]["near_matches"] == 100
    batch = next(
        event for event in service.repository.list_events(reconciliation_id, limit=1)
        if event.event_type == "NEAR_MATCH_BULK_APPROVAL"
    )
    assert batch.metadata["restored_from_audit"] == 100


def test_bulk_revalidation_reports_policy_profile_stale_and_conflicting_decisions(client, sample_files):
    reconciliation_id = _through_tolerance(client, sample_files)
    assert client.post(f"/api/reconciliations/{reconciliation_id}/near-match/analyze").status_code == 200
    service = client.app.state.reconciliation_service
    repository = service.repository

    session = service.get(reconciliation_id)
    analysis = session.near_match_analysis
    assert analysis is not None and session.near_match_summary is not None
    original_policy_revision = analysis.policy_revision
    analysis.policy_revision = (original_policy_revision or 0) + 1
    repository.save_near_analysis(reconciliation_id, analysis, "policy-mismatch", session.near_match_summary)
    policy_result = client.post(f"/api/reconciliations/{reconciliation_id}/near-match/bulk-approve").json()
    assert policy_result["approved"] == 0 and policy_result["skipped"] == 100
    assert {item["code"] for item in policy_result["skip_reasons"]} == {"policy_version_mismatch"}

    session = service.get(reconciliation_id)
    analysis = session.near_match_analysis
    assert analysis is not None and session.near_match_summary is not None
    analysis.policy_revision = original_policy_revision
    analysis.profile_version = 999
    repository.save_near_analysis(reconciliation_id, analysis, "profile-mismatch", session.near_match_summary)
    profile_result = client.post(f"/api/reconciliations/{reconciliation_id}/near-match/bulk-approve").json()
    assert profile_result["approved"] == 0 and profile_result["skipped"] == 100
    assert {item["code"] for item in profile_result["skip_reasons"]} == {"profile_version_mismatch"}

    session = service.get(reconciliation_id)
    analysis = session.near_match_analysis
    assert analysis is not None and session.near_match_summary is not None
    analysis.profile_version = None
    proposed = [item for item in analysis.candidates if item.status == CandidateStatus.NEAR_MATCH_PROPOSED]
    proposed[0].match_score = 0.1
    repository.add_event(AgentEvent(
        event_type="near_match.rejected", reconciliation_id=reconciliation_id,
        actor_type=ActorType.USER, component="test", result="rejected",
        metadata={"candidate_id": str(proposed[1].id)},
    ))
    repository.save_near_analysis(reconciliation_id, analysis, "partial-revalidation", session.near_match_summary)
    partial = client.post(f"/api/reconciliations/{reconciliation_id}/near-match/bulk-approve").json()
    assert partial["requested"] == 100
    assert partial["approved"] == 98
    assert partial["skipped"] == 2
    assert partial["failed"] == 0
    assert {item["code"] for item in partial["skip_reasons"]} == {
        "threshold_not_met", "conflicting_human_decision",
    }
    assert partial["summary"]["ambiguous_records"] == 40
    assert partial["summary"]["material_mismatch_records"] == 80
    assert partial["summary"]["resolved_records"] == 758
    assert partial["summary"]["remaining_government_records"] == 242
    results = repository.list_match_results(reconciliation_id)
    assert len({item.purchase_register_record_id for item in results}) == len(results)
