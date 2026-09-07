from __future__ import annotations

from typing import Any

import pytest
from pydantic import ValidationError

from app.domain.models import (
    ColumnMappingCandidate,
    ColumnProfile,
    CanonicalDataType,
    DatasetProfile,
    DatasetMappingProposal,
    DatasetRole,
    HumanMappingDecision,
    ProposedBy,
    SchemaMappingAgentOutput,
)
from app.evaluation.schema_mapping import SchemaMappingEvaluator
from app.providers.base import LLMProvider, ProviderError, StructuredOutput
from app.services.exact_match import ExactMatchEngine
from app.services.excel_parser import ExcelParser
from app.services.schema_mapping import (
    DeterministicSchemaMapper, MappingValidator, enforce_one_source_per_canonical,
    merge_ai_candidates,
)


def _profiles(files):
    parser = ExcelParser()
    return [
        parser.parse(files["government"], DatasetRole.GOVERNMENT),
        parser.parse(files["purchase_register"], DatasetRole.PURCHASE_REGISTER),
    ]


def _mapping_dict(proposals):
    return {
        dataset.source_dataset: {
            mapping.canonical_field: mapping.source_column
            for mapping in dataset.mappings
            if mapping.canonical_field is not None
        }
        for dataset in proposals
    }


def test_deterministic_profiles_detect_gstin_dates_and_numbers(sample_files):
    government, _ = _profiles(sample_files)
    profiles = {item.column_name: item for item in government.profile.column_profiles}

    assert "gstin" in profiles["Counterparty_GSTIN"].pattern_hints
    assert profiles["Counterparty_Document_Date"].inferred_dtype == "date"
    assert profiles["Taxable_Value"].inferred_dtype == "number"
    assert profiles["Taxable_Value"].minimum is not None
    assert profiles["Taxable_Value"].maximum is not None
    assert len(profiles["Counterparty_GSTIN"].sample_values) <= 5


def test_mapping_contract_rejects_out_of_range_confidence():
    with pytest.raises(ValidationError):
        ColumnMappingCandidate(
            source_dataset=DatasetRole.GOVERNMENT,
            source_column="ctin",
            canonical_field="gstin",
            confidence=1.2,
            rationale="invalid confidence",
            proposed_by=ProposedBy.AI,
        )


def _wide_profile(role: DatasetRole) -> DatasetProfile:
    critical = [
        "LocationGstin", "BillFromGstin", "DispatchFromGstin", "BillToGstin", "ShipToGstin",
        "DocumentType", "TransactionType", "TransactionNote", "DocumentNumber", "JWDocumentNumber",
        "OriginalDocumentNumber", "DocumentDate", "JWDocumentDate", "TaxableValue", "IgstAmount",
        "ItcIgstAmount", "ItcCgstAmount", "CgstAmount", "SgstAmount", "ItcSgstAmount",
        "CessAmount", "ItcCessAmount", "DocumentValue", "ReturnPeriod", "TransactionId", "Rate",
        "Irn", "Gstr3BSection",
    ]
    columns = critical + [f"CustomField{index:03d}" for index in range(195)]
    profiles = []
    for name in columns:
        lowered = name.lower()
        dtype = (CanonicalDataType.DATE if "date" in lowered else
                 CanonicalDataType.NUMBER if any(token in lowered for token in ("amount", "value", "rate")) else
                 CanonicalDataType.STRING)
        entity = name in {"LocationGstin", "BillToGstin", "ShipToGstin"}
        profiles.append(ColumnProfile(
            column_name=name, inferred_dtype=dtype, pandas_dtype="object",
            non_null_count=10000, non_null_percentage=100, null_percentage=0,
            unique_count=1 if entity else 500,
            sample_values=["33AAACK2138A1ZC"] if entity else ["sample"],
            pattern_hints=["gstin"] if entity else (["date"] if dtype == CanonicalDataType.DATE else []),
        ))
    return DatasetProfile(
        role=role, sheet_name="wide", header_row=1, row_count=10000,
        column_count=223, columns=columns, inferred_types={}, null_counts={},
        column_profiles=profiles,
    )


def test_223_column_schema_uses_primary_fields_and_one_to_one_arbitration():
    profiles = [_wide_profile(DatasetRole.GOVERNMENT), _wide_profile(DatasetRole.PURCHASE_REGISTER)]
    mapper = DeterministicSchemaMapper()
    proposals = enforce_one_source_per_canonical(
        [mapper.propose_dataset(profile) for profile in profiles], profiles
    )
    expected = {
        "gstin": "BillFromGstin", "document_type": "DocumentType",
        "document_number": "DocumentNumber", "document_date": "DocumentDate",
        "taxable_value": "TaxableValue", "igst": "IgstAmount", "cgst": "CgstAmount",
        "sgst": "SgstAmount", "cess": "CessAmount", "document_value": "DocumentValue",
        "return_period": "ReturnPeriod",
        "record_id": "TransactionId",
    }
    for dataset in proposals:
        selected = {item.canonical_field: item.source_column for item in dataset.mappings if item.canonical_field}
        assert expected.items() <= selected.items()
        assert len(selected) == len([item for item in dataset.mappings if item.canonical_field])
        rejected = {item.source_column: item.canonical_field for item in dataset.mappings}
        for name in ("LocationGstin", "BillToGstin", "ShipToGstin", "DispatchFromGstin",
                     "TransactionType", "TransactionNote", "JWDocumentNumber",
                     "OriginalDocumentNumber", "ItcIgstAmount", "ItcCgstAmount",
                     "ItcSgstAmount", "ItcCessAmount"):
            assert rejected[name] is None
    validation = MappingValidator().validate(proposals, profiles)
    assert validation.valid
    assert all(issue.severity == "warning" for issue in validation.issues)

    unresolved = [item for dataset in proposals for item in dataset.mappings if item.confidence < .9]
    adversarial_ai = SchemaMappingAgentOutput(mappings=[
        ColumnMappingCandidate(source_dataset=role, source_column=source, canonical_field=target,
                               confidence=.99, rationale="ambiguous AI proposal", proposed_by=ProposedBy.AI)
        for role in DatasetRole
        for source, target in (("Irn", "record_id"), ("Gstr3BSection", "itc_eligibility"),
                               ("TransactionType", "document_type"), ("ItcIgstAmount", "igst"))
    ])
    ai_merged = enforce_one_source_per_canonical(
        merge_ai_candidates(proposals, adversarial_ai, unresolved), profiles
    )
    for dataset in ai_merged:
        selected = {item.canonical_field: item.source_column for item in dataset.mappings if item.canonical_field}
        assert expected.items() <= selected.items()
        assert len(selected) == len([item for item in dataset.mappings if item.canonical_field])


def test_mapping_validation_detects_conflict_missing_and_invalid_type(sample_files):
    parsed = _profiles(sample_files)
    profiles = [item.profile for item in parsed]
    datasets = [DeterministicSchemaMapper().propose_dataset(profile) for profile in profiles]
    assert MappingValidator().validate(datasets, profiles).valid

    purchase = datasets[1].model_copy(deep=True)
    company_gstin = next(
        row for row in purchase.mappings if row.source_column == "Purchase_Register_GSTIN"
    )
    company_gstin.canonical_field = "gstin"
    conflict = MappingValidator().validate([datasets[0], purchase], profiles)
    assert any(issue.code == "duplicate_canonical_field" for issue in conflict.issues)

    government = datasets[0].model_copy(deep=True)
    next(row for row in government.mappings if row.canonical_field == "gstin").canonical_field = None
    missing = MappingValidator().validate([government, datasets[1]], profiles)
    assert any(
        issue.code == "missing_required_field" and issue.canonical_field == "gstin"
        for issue in missing.issues
    )

    invalid = datasets[0].model_copy(deep=True)
    next(row for row in invalid.mappings if row.canonical_field == "taxable_value").canonical_field = None
    next(row for row in invalid.mappings if row.source_column == "Narration").canonical_field = "taxable_value"
    invalid_result = MappingValidator().validate([invalid, datasets[1]], profiles)
    assert any(issue.code == "incompatible_datatype" for issue in invalid_result.issues)


@pytest.mark.parametrize("fixture_name", ["renamed_workbooks", "hard_renamed_workbooks"])
def test_renamed_erp_fixtures_map_and_preserve_520_exact_matches(request, fixture_name):
    files = request.getfixturevalue(fixture_name)
    government, purchase = _profiles(files)
    profiles = [government.profile, purchase.profile]
    datasets = [DeterministicSchemaMapper().propose_dataset(profile) for profile in profiles]
    validation = MappingValidator().validate(datasets, profiles)

    assert validation.valid, validation.issues
    matches = ExactMatchEngine().match(
        government.dataframe, purchase.dataframe, _mapping_dict(datasets)
    )
    assert len(matches) == 520


def test_human_edit_persists_and_workflow_is_really_paused(client, sample_files):
    reconciliation_id = client.post("/api/reconciliations").json()["id"]
    for endpoint, key in (("government", "government"), ("purchase-register", "purchase_register")):
        with sample_files[key].open("rb") as workbook:
            response = client.post(
                f"/api/reconciliations/{reconciliation_id}/files/{endpoint}",
                files={"file": (sample_files[key].name, workbook)},
            )
            assert response.status_code == 200
    analyzed = client.post(f"/api/reconciliations/{reconciliation_id}/mapping/analyze")
    assert analyzed.status_code == 200
    assert client.app.state.mapping_workflow.checkpoint_next_nodes(reconciliation_id) == (
        "await_human_confirmation",
    )

    payload = analyzed.json()
    government = next(
        dataset for dataset in payload["datasets"] if dataset["source_dataset"] == "government"
    )
    narration = next(row for row in government["mappings"] if row["source_column"] == "Narration")
    taxable = next(
        row for row in government["mappings"] if row["canonical_field"] == "taxable_value"
    )
    taxable["canonical_field"] = None
    narration["canonical_field"] = "taxable_value"
    invalid = client.put(
        f"/api/reconciliations/{reconciliation_id}/mapping",
        json={"datasets": payload["datasets"]},
    )
    assert invalid.status_code == 200
    assert invalid.json()["validation"]["valid"] is False
    rejected = client.post(f"/api/reconciliations/{reconciliation_id}/mapping/confirm")
    assert rejected.status_code == 422
    assert rejected.json()["detail"]["code"] == "invalid_mapping"

    taxable["canonical_field"] = "taxable_value"
    narration["canonical_field"] = None
    saved = client.put(
        f"/api/reconciliations/{reconciliation_id}/mapping",
        json={"datasets": payload["datasets"]},
    )
    assert saved.status_code == 200, saved.text
    reloaded = client.get(f"/api/reconciliations/{reconciliation_id}/mapping").json()
    persisted = next(
        row
        for dataset in reloaded["datasets"]
        for row in dataset["mappings"]
        if dataset["source_dataset"] == "government" and row["source_column"] == "Narration"
    )
    assert persisted["canonical_field"] is None
    assert persisted["proposed_by"] == "human"
    assert persisted["user_edited"] is True


class FakeProvider(LLMProvider):
    def __init__(self, output: SchemaMappingAgentOutput) -> None:
        self.output = output

    @property
    def provider_name(self) -> str:
        return "fake"

    def invoke(self, messages: list[dict[str, str]], **kwargs: Any) -> str:
        return self.output.model_dump_json()

    def invoke_structured(
        self,
        messages: list[dict[str, str]],
        output_schema: type[StructuredOutput],
        **kwargs: Any,
    ) -> StructuredOutput:
        return output_schema.model_validate(self.output.model_dump())

    def healthcheck(self) -> bool:
        return True


class FailingProvider(FakeProvider):
    def invoke_structured(
        self,
        messages: list[dict[str, str]],
        output_schema: type[StructuredOutput],
        **kwargs: Any,
    ) -> StructuredOutput:
        raise ProviderError("provider unavailable")


def test_provider_evaluation_harness_uses_structured_fake_output(sample_files):
    government, _ = _profiles(sample_files)
    deterministic = DeterministicSchemaMapper().propose_dataset(government.profile)
    output = SchemaMappingAgentOutput(
        mappings=[
            mapping.model_copy(update={"proposed_by": ProposedBy.AI})
            for mapping in deterministic.mappings
        ]
    )
    expected = {
        (mapping.source_dataset, mapping.source_column): mapping.canonical_field
        for mapping in deterministic.mappings
    }
    report = SchemaMappingEvaluator().evaluate(
        [government.profile], expected, FakeProvider(output), model_name="fake-v1"
    )

    assert report.provider == "fake"
    assert report.required_field_mapping_accuracy == 1.0
    assert report.overall_canonical_mapping_accuracy == 1.0
    assert report.structured_output_failure_count == 0

    failed_report = SchemaMappingEvaluator().evaluate(
        [government.profile], expected, FailingProvider(output), model_name="fake-v1"
    )
    assert failed_report.structured_output_failure_count == 1
