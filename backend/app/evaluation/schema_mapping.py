from __future__ import annotations

from time import perf_counter

from app.domain.models import (
    DatasetMappingProposal,
    DatasetProfile,
    DatasetRole,
    MappingEvaluationReport,
)
from app.providers.base import LLMProvider
from app.services.canonical_schema import REQUIRED_EXACT_FIELDS
from app.services.schema_mapping import (
    DeterministicSchemaMapper,
    MappingValidator,
    SchemaMappingAgent,
    SchemaProviderUnavailable,
    merge_ai_candidates,
)


class SchemaMappingEvaluator:
    """Provider-agnostic harness that evaluates structured mapping output against fixtures."""

    def __init__(
        self,
        deterministic_mapper: DeterministicSchemaMapper | None = None,
        validator: MappingValidator | None = None,
    ) -> None:
        self.deterministic_mapper = deterministic_mapper or DeterministicSchemaMapper()
        self.validator = validator or MappingValidator()

    def evaluate(
        self,
        profiles: list[DatasetProfile],
        expected: dict[tuple[DatasetRole, str], str | None],
        provider: LLMProvider,
        model_name: str | None = None,
        force_provider: bool = True,
    ) -> MappingEvaluationReport:
        started = perf_counter()
        datasets = [self.deterministic_mapper.propose_dataset(profile) for profile in profiles]
        candidates = [mapping for dataset in datasets for mapping in dataset.mappings]
        unresolved = (
            candidates
            if force_provider
            else [
                candidate
                for candidate in candidates
                if candidate.confidence < self.deterministic_mapper.high_confidence_threshold
            ]
        )
        failures = 0
        if unresolved:
            try:
                output = SchemaMappingAgent(provider, model_name).propose(profiles, unresolved)
                datasets = merge_ai_candidates(datasets, output, unresolved)
            except SchemaProviderUnavailable:
                failures = 1

        calculated = {
            (mapping.source_dataset, mapping.source_column): mapping.canonical_field
            for dataset in datasets
            for mapping in dataset.mappings
        }
        correct = sum(calculated.get(key) == value for key, value in expected.items())
        required_expected = {
            key: value for key, value in expected.items() if value in REQUIRED_EXACT_FIELDS
        }
        required_correct = sum(
            calculated.get(key) == value for key, value in required_expected.items()
        )
        validation = self.validator.validate(datasets, profiles)
        provided_roles = {profile.role for profile in profiles}
        relevant_issues = [
            issue
            for issue in validation.issues
            if issue.source_dataset in provided_roles and issue.code != "dataset_mapping_missing"
        ]
        missing_required = sum(
            issue.code == "missing_required_field" for issue in relevant_issues
        )
        return MappingEvaluationReport(
            provider=provider.provider_name,
            model=model_name,
            required_field_mapping_accuracy=(
                required_correct / len(required_expected) if required_expected else 1.0
            ),
            overall_canonical_mapping_accuracy=correct / len(expected) if expected else 1.0,
            invalid_mapping_count=sum(issue.severity == "error" for issue in relevant_issues),
            missing_required_mappings=missing_required,
            structured_output_failure_count=failures,
            latency_ms=round((perf_counter() - started) * 1000, 2),
        )

