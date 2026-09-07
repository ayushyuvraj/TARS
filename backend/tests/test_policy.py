from __future__ import annotations

from decimal import Decimal

import pandas as pd
import pytest
from pydantic import ValidationError

from app.domain.models import (
    MatchOperator,
    PolicyFieldRule,
    ReconciliationPolicy,
    ToleranceDefinition,
    ToleranceUnit,
    ColumnMappingCandidate,
    ConfirmedDatasetMapping,
    ConfirmedMappingSet,
    DatasetRole,
    ProposedBy,
)
from app.evaluation.policy import PolicyEvaluationCase, PolicyInterpretationEvaluator
from app.providers.base import LLMProvider
from app.providers.base import ProviderError
from app.config import Settings
from fastapi.testclient import TestClient
from app.services.policy import PolicyValidator, default_policy
from app.services.tolerance_match import ToleranceMatchEngine


def _upload(client, reconciliation_id, endpoint, path):
    with path.open("rb") as workbook:
        response = client.post(
            f"/api/reconciliations/{reconciliation_id}/files/{endpoint}",
            files={"file": (path.name, workbook, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        )
    assert response.status_code == 200, response.text


def _mapped_session(client, sample_files):
    reconciliation_id = client.post("/api/reconciliations").json()["id"]
    _upload(client, reconciliation_id, "government", sample_files["government"])
    _upload(client, reconciliation_id, "purchase-register", sample_files["purchase_register"])
    assert client.post(f"/api/reconciliations/{reconciliation_id}/mapping/analyze").status_code == 200
    assert client.post(f"/api/reconciliations/{reconciliation_id}/mapping/confirm").status_code == 200
    return reconciliation_id


def test_policy_contract_rejects_negative_tolerance():
    with pytest.raises(ValidationError):
        ToleranceDefinition(value=Decimal("-1"), unit=ToleranceUnit.INR)


def _confirmed_mapping(fields):
    return ConfirmedMappingSet(
        reconciliation_id="00000000-0000-0000-0000-000000000001",
        datasets=[ConfirmedDatasetMapping(
            source_dataset=role,
            mappings=[ColumnMappingCandidate(source_dataset=role, source_column=field,
                canonical_field=field, confidence=1, rationale="test", proposed_by=ProposedBy.HUMAN)
                for field in fields],
        ) for role in DatasetRole],
    )


def test_unmapped_policy_field_is_rejected_and_conflicts_are_not_auto_matched():
    policy = default_policy()
    mapping = _confirmed_mapping(["record_id", "gstin", "document_number", "document_date"])
    validation = PolicyValidator().validate(policy, mapping)
    assert not validation.valid
    assert any(issue.code == "unmapped_field" and issue.canonical_field == "taxable_value" for issue in validation.issues)

    complete = _confirmed_mapping(["record_id", "gstin", "document_number", "taxable_value", "document_date"])
    government = pd.DataFrame([{"record_id": "G1", "gstin": "GSTIN1", "document_number": "INV1", "taxable_value": 100, "document_date": "2026-08-01"}])
    purchase = pd.DataFrame([
        {"record_id": "P1", "gstin": "GSTIN1", "document_number": "INV1", "taxable_value": 105, "document_date": "2026-08-02"},
        {"record_id": "P2", "gstin": "GSTIN1", "document_number": "INV1", "taxable_value": 106, "document_date": "2026-08-03"},
    ])
    matches, conflicts = ToleranceMatchEngine().match(government, purchase, complete, policy, [])
    assert matches == []
    assert len(conflicts) == 1
    assert set(conflicts[0].purchase_register_record_ids) == {"P1", "P2"}


def test_policy_checkpoint_validation_persistence_and_manual_flow(client, sample_files):
    reconciliation_id = _mapped_session(client, sample_files)
    blocked = client.post(f"/api/reconciliations/{reconciliation_id}/run/tolerance-match")
    assert blocked.status_code == 409

    proposed = client.post(
        f"/api/reconciliations/{reconciliation_id}/policy/propose",
        json={"instruction": "GSTIN and invoice number must match exactly. Allow ₹10 variance in taxable value and 5 days in invoice date."},
    )
    assert proposed.status_code == 200, proposed.text
    payload = proposed.json()
    assert payload["validation"]["valid"] is True
    assert client.app.state.policy_workflow.checkpoint_next_nodes(reconciliation_id) == ("await_policy_confirmation",)
    session = client.get(f"/api/reconciliations/{reconciliation_id}").json()
    assert session["status"] == "awaiting_policy_approval"

    invalid = payload["policy"]
    taxable = next(rule for rule in invalid["rules"] if rule["canonical_field"] == "taxable_value")
    taxable["operator"] = "DATE_TOLERANCE"
    taxable["tolerance"] = {"value": 5, "unit": "DAYS"}
    saved = client.put(f"/api/reconciliations/{reconciliation_id}/policy", json={"policy": invalid})
    assert saved.status_code == 200
    assert saved.json()["validation"]["valid"] is False
    assert any(issue["code"] == "operator_datatype_mismatch" for issue in saved.json()["validation"]["issues"])
    rejected = client.post(f"/api/reconciliations/{reconciliation_id}/policy/confirm")
    assert rejected.status_code == 422

    corrected = saved.json()["policy"]
    taxable = next(rule for rule in corrected["rules"] if rule["canonical_field"] == "taxable_value")
    taxable["operator"] = "ABSOLUTE_TOLERANCE"
    taxable["tolerance"] = {"value": 10, "unit": "INR"}
    saved = client.put(f"/api/reconciliations/{reconciliation_id}/policy", json={"policy": corrected})
    assert saved.json()["validation"]["valid"] is True
    restored = client.get(f"/api/reconciliations/{reconciliation_id}/policy").json()
    assert restored["policy"]["revision"] == saved.json()["policy"]["revision"]
    assert client.post(f"/api/reconciliations/{reconciliation_id}/policy/confirm").status_code == 200
    assert client.app.state.policy_workflow.checkpoint_next_nodes(reconciliation_id) == ()


def test_tolerance_pairs_equal_ground_truth_and_false_positives_are_excluded(client, sample_files):
    reconciliation_id = _mapped_session(client, sample_files)
    policy = client.post(f"/api/reconciliations/{reconciliation_id}/policy/propose")
    assert policy.status_code == 200 and policy.json()["validation"]["valid"] is True
    assert client.post(f"/api/reconciliations/{reconciliation_id}/policy/confirm").status_code == 200
    exact = client.post(f"/api/reconciliations/{reconciliation_id}/run/exact-match")
    assert exact.status_code == 200 and exact.json()["exact_matches"] == 520
    tolerance = client.post(f"/api/reconciliations/{reconciliation_id}/run/tolerance-match")
    assert tolerance.status_code == 200, tolerance.text
    assert tolerance.json() == {
        "reconciliation_id": reconciliation_id,
        "status": "completed",
        "government_records": 1000,
        "purchase_register_records": 1050,
        "exact_matches": 520,
        "tolerance_matches": 140,
        "resolved_records": 660,
        "remaining_government_records": 340,
        "remaining_purchase_register_records": 390,
        "conflict_count": 0,
    }
    results = client.get(f"/api/reconciliations/{reconciliation_id}/results?status=TOLERANCE_MATCHED").json()
    actual = {(row["government_record_id"], row["purchase_register_record_id"]) for row in results["records"]}
    truth = pd.read_excel(sample_files["ground_truth"])
    expected_rows = truth[truth["Expected_Status"] == "TOLERANCE_MATCHED"]
    expected = {(row.Government_Record_ID, row.Expected_PR_Record_IDs) for row in expected_rows.itertuples()}
    assert actual == expected
    assert len({purchase for _, purchase in actual}) == len(actual)
    exact_results = client.get(f"/api/reconciliations/{reconciliation_id}/results?status=EXACT_MATCHED").json()["records"]
    exact_purchase = {row["purchase_register_record_id"] for row in exact_results}
    assert exact_purchase.isdisjoint({purchase for _, purchase in actual})
    forbidden = set(truth[truth["Scenario"].isin(["NEAR", "MISMATCH", "AMBIGUOUS", "GST_ONLY"])]["Government_Record_ID"])
    assert forbidden.isdisjoint({government for government, _ in actual})
    first = results["records"][0]["match"]
    assert first["variances"]["taxable_value"] <= first["allowed_tolerances"]["taxable_value"]
    assert first["variances"]["document_date_days"] <= first["allowed_tolerances"]["document_date_days"]
    events = {event["event_type"] for event in client.get(f"/api/reconciliations/{reconciliation_id}/audit-events?limit=200").json()}
    assert {"policy.proposal.started", "policy.proposal.completed", "policy.validation.completed",
            "policy.approval_required", "policy.confirmed", "tolerance_match.started",
            "tolerance_match.completed"} <= events


class _FakePolicyProvider(LLMProvider):
    @property
    def provider_name(self) -> str:
        return "fake"

    def invoke(self, messages, **kwargs):
        return ""

    def invoke_structured(self, messages, output_schema, **kwargs):
        instruction = messages[1]["content"].lower() if messages else ""
        amount = 50 if "fifty" in instruction else 100 if "100" in instruction else 10
        days = 3 if "3 days" in instruction else 5
        include_date = "100" not in instruction
        rules = [PolicyFieldRule(canonical_field="gstin", operator=MatchOperator.EXACT)]
        if "fifty" not in instruction:
            rules.append(PolicyFieldRule(canonical_field="document_number", operator=MatchOperator.EXACT))
        rules.append(PolicyFieldRule(canonical_field="taxable_value", operator=MatchOperator.ABSOLUTE_TOLERANCE,
                            tolerance=ToleranceDefinition(value=amount, unit=ToleranceUnit.INR)),
        )
        if include_date:
            rules.append(PolicyFieldRule(canonical_field="document_date", operator=MatchOperator.DATE_TOLERANCE,
                                         tolerance=ToleranceDefinition(value=days, unit=ToleranceUnit.DAYS)))
        return output_schema(
            name="Evaluated policy",
            explanation="Structured fake response",
            rules=rules,
        )

    def healthcheck(self) -> bool:
        return True


class _FailingProvider(_FakePolicyProvider):
    def invoke_structured(self, messages, output_schema, **kwargs):
        raise ProviderError("synthetic provider outage")


def test_provider_failure_preserves_mapping_and_manual_policy_path(tmp_path, sample_files, monkeypatch):
    import app.main as main_module
    monkeypatch.setattr(main_module, "create_llm_provider", lambda settings: _FailingProvider())
    settings = Settings(database_path=tmp_path / "provider-failure.db", upload_dir=tmp_path / "uploads", llm_provider="fake")
    with TestClient(main_module.create_app(settings)) as failing_client:
        reconciliation_id = failing_client.post("/api/reconciliations").json()["id"]
        _upload(failing_client, reconciliation_id, "government", sample_files["government"])
        _upload(failing_client, reconciliation_id, "purchase-register", sample_files["purchase_register"])
        assert failing_client.post(f"/api/reconciliations/{reconciliation_id}/mapping/analyze").status_code == 503
        assert failing_client.post(f"/api/reconciliations/{reconciliation_id}/mapping/confirm").status_code == 200
        response = failing_client.post(
            f"/api/reconciliations/{reconciliation_id}/policy/propose",
            json={"instruction": "GSTIN and invoice must be strict. Taxable value may vary by fifty rupees and date by three days."},
        )
        assert response.status_code == 200
        assert response.json()["provider_error"]
        assert response.json()["validation"]["valid"] is False
        session = failing_client.get(f"/api/reconciliations/{reconciliation_id}").json()
        assert session["confirmed_mapping"] is not None
        assert session["policy_proposal"] is not None
        assert session["status"] == "awaiting_policy_approval"
        assert failing_client.app.state.policy_workflow.checkpoint_next_nodes(reconciliation_id) == ("await_policy_confirmation",)


def test_policy_evaluator_is_provider_agnostic(client, sample_files):
    reconciliation_id = _mapped_session(client, sample_files)
    confirmed = client.get(f"/api/reconciliations/{reconciliation_id}").json()["confirmed_mapping"]
    cases = [
        PolicyEvaluationCase(instruction="GSTIN and invoice exact, ₹10 amount and 5 days", expected_rules=default_expected_rules()),
        PolicyEvaluationCase(instruction="Do not allow any GSTIN mismatch. Taxable value can vary by fifty rupees. Invoice date may differ by 3 days.", should_validate=False, expected_rules=[
            default_expected_rules()[0],
            PolicyFieldRule(canonical_field="taxable_value", operator=MatchOperator.ABSOLUTE_TOLERANCE, tolerance=ToleranceDefinition(value=50, unit=ToleranceUnit.INR)),
            PolicyFieldRule(canonical_field="document_date", operator=MatchOperator.DATE_TOLERANCE, tolerance=ToleranceDefinition(value=3, unit=ToleranceUnit.DAYS)),
        ]),
        PolicyEvaluationCase(instruction="Match invoice and GSTIN exactly and permit a taxable value variance up to 100.", expected_rules=[
            *default_expected_rules()[:2],
            PolicyFieldRule(canonical_field="taxable_value", operator=MatchOperator.ABSOLUTE_TOLERANCE, tolerance=ToleranceDefinition(value=100, unit=ToleranceUnit.INR)),
        ]),
    ]
    report = PolicyInterpretationEvaluator(_FakePolicyProvider(), "fake-model").evaluate(
        cases, ConfirmedMappingSet.model_validate(confirmed)
    )
    assert report.field_accuracy == report.operator_accuracy == report.tolerance_accuracy == 1
    assert report.structured_output_failure_count == 0


def default_expected_rules():
    return [
        PolicyFieldRule(canonical_field="gstin", operator=MatchOperator.EXACT),
        PolicyFieldRule(canonical_field="document_number", operator=MatchOperator.EXACT),
        PolicyFieldRule(canonical_field="taxable_value", operator=MatchOperator.ABSOLUTE_TOLERANCE,
                        tolerance=ToleranceDefinition(value=10, unit=ToleranceUnit.INR)),
        PolicyFieldRule(canonical_field="document_date", operator=MatchOperator.DATE_TOLERANCE,
                        tolerance=ToleranceDefinition(value=5, unit=ToleranceUnit.DAYS)),
    ]
