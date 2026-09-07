from __future__ import annotations

import json
import logging
import re
from difflib import SequenceMatcher
from typing import Iterable

from app.domain.models import (
    CanonicalDataType,
    ColumnMappingCandidate,
    DatasetMappingProposal,
    DatasetProfile,
    DatasetRole,
    MappingValidationIssue,
    MappingValidationResult,
    ProposedBy,
    SchemaMappingAgentOutput,
)
from app.providers.base import LLMProvider, ProviderError
from app.services.canonical_schema import (
    CANONICAL_BY_NAME,
    CANONICAL_FIELD_DEFINITIONS,
    REQUIRED_EXACT_FIELDS,
)

logger = logging.getLogger(__name__)


class SchemaProviderUnavailable(RuntimeError):
    pass


def normalize_name(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.lower())


class DeterministicSchemaMapper:
    def __init__(self, high_confidence_threshold: float = 0.90) -> None:
        self.high_confidence_threshold = high_confidence_threshold
        self._aliases: dict[str, set[str]] = {
            definition.canonical_name: {
                normalize_name(definition.canonical_name),
                *(normalize_name(alias) for alias in definition.aliases),
            }
            for definition in CANONICAL_FIELD_DEFINITIONS
        }

    @staticmethod
    def _compatible(actual: CanonicalDataType, expected: CanonicalDataType) -> bool:
        return actual == expected or (
            expected == CanonicalDataType.STRING and actual != CanonicalDataType.DATE
        )

    def propose_column(self, role: DatasetRole, profile) -> ColumnMappingCandidate:
        normalized = normalize_name(profile.column_name)
        entity_gstin = any(marker in normalized for marker in (
            "locationgstin", "entitygstin", "companygstin", "ourgstin",
            "billtogstin", "shiptogstin", "buyergstin", "recipientgstin",
        ))
        if normalized.endswith("gstin") and entity_gstin:
            return ColumnMappingCandidate(
                source_dataset=role, source_column=profile.column_name,
                canonical_field=None, confidence=0.99,
                rationale=("Entity, location, buyer, or recipient GSTIN is not the "
                           "supplier/counterparty GSTIN used for purchase reconciliation."),
                proposed_by=ProposedBy.DETERMINISTIC,
            )
        exact_matches = [
            canonical for canonical, aliases in self._aliases.items() if normalized in aliases
        ]
        if len(exact_matches) == 1:
            canonical = exact_matches[0]
            return ColumnMappingCandidate(
                source_dataset=role,
                source_column=profile.column_name,
                canonical_field=canonical,
                confidence=0.99,
                rationale="Column name matches a known semantic alias.",
                proposed_by=ProposedBy.DETERMINISTIC,
            )
        gstin_context = any(
            marker in normalized
            for marker in (
                "vendor", "supplier", "counterparty", "ctin", "party", "taxid",
                "billfrom", "seller",
            )
        ) or normalized == "gstin"
        if normalized.endswith("gstin") and gstin_context:
            return ColumnMappingCandidate(
                source_dataset=role,
                source_column=profile.column_name,
                canonical_field="gstin",
                confidence=0.96 if "gstin" in profile.pattern_hints else 0.92,
                rationale=("Header semantics identify the supplier/counterparty GSTIN; "
                           "profile pattern evidence is also present."
                           if "gstin" in profile.pattern_hints else
                           "Header and transaction-direction semantics identify the supplier/counterparty GSTIN."),
                proposed_by=ProposedBy.DETERMINISTIC,
            )

        scored: list[tuple[float, str]] = []
        for canonical, aliases in self._aliases.items():
            definition = CANONICAL_BY_NAME[canonical]
            if not self._compatible(profile.inferred_dtype, definition.expected_datatype):
                continue
            similarity = max(SequenceMatcher(None, normalized, alias).ratio() for alias in aliases)
            scored.append((similarity, canonical))
        if scored:
            similarity, canonical = max(scored)
            if similarity >= 0.84:
                return ColumnMappingCandidate(
                    source_dataset=role,
                    source_column=profile.column_name,
                    canonical_field=canonical,
                    confidence=round(min(0.94, 0.72 + similarity * 0.22), 3),
                    rationale="Column name is lexically similar and datatype-compatible.",
                    proposed_by=ProposedBy.DETERMINISTIC,
                )
        return ColumnMappingCandidate(
            source_dataset=role,
            source_column=profile.column_name,
            canonical_field=None,
            confidence=0.0,
            rationale="No sufficiently strong deterministic semantic signal was found.",
            proposed_by=ProposedBy.DETERMINISTIC,
        )

    def propose_dataset(self, profile: DatasetProfile) -> DatasetMappingProposal:
        return DatasetMappingProposal(
            source_dataset=profile.role,
            mappings=[self.propose_column(profile.role, column) for column in profile.column_profiles],
        )


_PRIMARY_FIELD_NEGATIVES = (
    "custom", "metadata", "note", "remark", "original", "preceding", "reference",
    "refdocument", "supportingdocument", "jobwork", "jwdocument", "itc", "determined",
)
_PRIMARY_TRANSACTION_TARGETS = {
    "record_id", "gstin", "document_type", "document_number", "document_date",
    "taxable_value", "document_value", "gst_rate", "igst", "cgst", "sgst", "cess",
}


def _selection_score(mapping: ColumnMappingCandidate, profile) -> float:
    canonical = mapping.canonical_field
    if canonical is None:
        return -100.0
    source = normalize_name(mapping.source_column)
    canonical_name = normalize_name(canonical)
    score = mapping.confidence
    if source == canonical_name:
        score += 1.0
    if source == canonical_name + "amount":
        score += 0.9
    if source == canonical_name + "value":
        score += 0.8
    if canonical in _PRIMARY_TRANSACTION_TARGETS and any(
        marker in source for marker in _PRIMARY_FIELD_NEGATIVES
    ):
        score -= 1.25
    if canonical == "record_id":
        if source in {
            "recordid", "transactionid", "sourcerowkey", "lineid",
            "governmentrecordid", "prrecordid",
        }:
            score += 1.0
        if source in {"irn", "invoice referencenumber", "invoicereferencenumber"}:
            score -= 1.0
    if canonical == "gstin":
        if any(marker in source for marker in ("billfrom", "supplier", "vendor", "counterparty", "seller")):
            score += 1.2
        if any(marker in source for marker in (
            "location", "entity", "company", "billto", "shipto", "buyer", "recipient", "dispatchfrom",
        )):
            score -= 1.5
        if profile.non_null_count and profile.unique_count > 1:
            score += 0.15
    return score


def enforce_one_source_per_canonical(
    datasets: list[DatasetMappingProposal], profiles: Iterable[DatasetProfile],
) -> list[DatasetMappingProposal]:
    """Resolve competing proposals generically before deterministic validation."""
    lookup = {
        (dataset.role, column.column_name): column
        for dataset in profiles for column in dataset.column_profiles
    }
    resolved: list[DatasetMappingProposal] = []
    for dataset in datasets:
        groups: dict[str, list[ColumnMappingCandidate]] = {}
        for mapping in dataset.mappings:
            if mapping.canonical_field:
                groups.setdefault(mapping.canonical_field, []).append(mapping)
        winners = {
            canonical: max(
                candidates,
                key=lambda item: (
                    _selection_score(item, lookup[(item.source_dataset, item.source_column)]),
                    -dataset.mappings.index(item),
                ),
            )
            for canonical, candidates in groups.items()
        }
        rows = []
        for mapping in dataset.mappings:
            if mapping.canonical_field and winners[mapping.canonical_field] is not mapping:
                rows.append(mapping.model_copy(update={
                    "canonical_field": None,
                    "confidence": min(mapping.confidence, 0.89),
                    "rationale": (
                        f"Excluded from {mapping.canonical_field}: a stronger primary-field "
                        "header/profile candidate won deterministic one-to-one arbitration."
                    ),
                }))
            else:
                rows.append(mapping)
        resolved.append(DatasetMappingProposal(source_dataset=dataset.source_dataset, mappings=rows))
    return resolved


class SchemaMappingAgent:
    def __init__(self, provider: LLMProvider, model_name: str | None = None) -> None:
        self.provider = provider
        self.model_name = model_name

    def propose(
        self,
        profiles: Iterable[DatasetProfile],
        unresolved: list[ColumnMappingCandidate],
    ) -> SchemaMappingAgentOutput:
        unresolved_keys = {
            (candidate.source_dataset.value, candidate.source_column) for candidate in unresolved
        }
        compact_profiles = []
        for profile in profiles:
            for column in profile.column_profiles:
                if (profile.role.value, column.column_name) in unresolved_keys:
                    compact_profiles.append(column.model_dump(mode="json") | {"source_dataset": profile.role.value})
        canonical_fields = [field.model_dump(mode="json") for field in CANONICAL_FIELD_DEFINITIONS]
        messages = [
            {
                "role": "system",
                "content": (
                    "You map spreadsheet column metadata to an explicit canonical GST schema. "
                    "Return only the requested structured output. Use null canonical_field when uncertain. "
                    "Do not infer or calculate transaction results. Select at most one source per canonical field. "
                    "For purchase reconciliation, GSTIN means supplier/counterparty GSTIN, not entity/location, "
                    "Bill-To, Ship-To, buyer, recipient, or dispatch-location GSTIN. Prefer primary document and "
                    "invoice-tax fields; exclude ITC, job-work/JW, original/reference document, custom, note, and "
                    "transaction-metadata fields unless the canonical target explicitly requests that concept."
                ),
            },
            {
                "role": "user",
                "content": json.dumps(
                    {"column_profiles": compact_profiles, "canonical_fields": canonical_fields},
                    separators=(",", ":"),
                ),
            },
        ]
        try:
            return self.provider.invoke_structured(messages, SchemaMappingAgentOutput)
        except ProviderError as exc:
            raise SchemaProviderUnavailable("Schema mapping provider is unavailable; retry is safe") from exc


class MappingValidator:
    @staticmethod
    def _profile_lookup(profiles: Iterable[DatasetProfile]):
        return {
            (profile.role, column.column_name): column
            for profile in profiles
            for column in profile.column_profiles
        }

    def validate(
        self,
        datasets: list[DatasetMappingProposal],
        profiles: Iterable[DatasetProfile],
    ) -> MappingValidationResult:
        issues: list[MappingValidationIssue] = []
        profile_lookup = self._profile_lookup(profiles)
        required_mapped: dict[str, list[str]] = {}
        roles_seen = {dataset.source_dataset for dataset in datasets}

        for role in DatasetRole:
            if role not in roles_seen:
                issues.append(
                    MappingValidationIssue(
                        code="dataset_mapping_missing",
                        message=f"No mapping was supplied for {role.value}.",
                        source_dataset=role,
                    )
                )

        for dataset in datasets:
            assigned: dict[str, list[str]] = {}
            seen_sources: set[str] = set()
            for mapping in dataset.mappings:
                if mapping.source_dataset != dataset.source_dataset:
                    issues.append(
                        MappingValidationIssue(
                            code="dataset_mismatch",
                            message="Mapping row identifies a different source dataset.",
                            source_dataset=dataset.source_dataset,
                            source_column=mapping.source_column,
                        )
                    )
                if mapping.source_column in seen_sources:
                    issues.append(
                        MappingValidationIssue(
                            code="duplicate_source_column",
                            message=f"Source column '{mapping.source_column}' appears more than once.",
                            source_dataset=dataset.source_dataset,
                            source_column=mapping.source_column,
                        )
                    )
                seen_sources.add(mapping.source_column)
                profile = profile_lookup.get((dataset.source_dataset, mapping.source_column))
                if profile is None:
                    issues.append(
                        MappingValidationIssue(
                            code="unknown_source_column",
                            message=f"Source column '{mapping.source_column}' is not present in the workbook.",
                            source_dataset=dataset.source_dataset,
                            source_column=mapping.source_column,
                        )
                    )
                    continue
                if mapping.canonical_field is None:
                    continue
                definition = CANONICAL_BY_NAME.get(mapping.canonical_field)
                if definition is None:
                    issues.append(
                        MappingValidationIssue(
                            code="unknown_canonical_field",
                            message=f"Canonical field '{mapping.canonical_field}' is not defined.",
                            source_dataset=dataset.source_dataset,
                            source_column=mapping.source_column,
                            canonical_field=mapping.canonical_field,
                        )
                    )
                    continue
                assigned.setdefault(mapping.canonical_field, []).append(mapping.source_column)
                datatype_compatible = (
                    profile.inferred_dtype == definition.expected_datatype
                    or (
                        definition.expected_datatype == CanonicalDataType.STRING
                        and profile.inferred_dtype == CanonicalDataType.NUMBER
                    )
                )
                if not datatype_compatible:
                    issues.append(
                        MappingValidationIssue(
                            code="incompatible_datatype",
                            message=(
                                f"'{mapping.source_column}' is {profile.inferred_dtype.value}, but "
                                f"{definition.display_name} requires {definition.expected_datatype.value}."
                            ),
                            source_dataset=dataset.source_dataset,
                            source_column=mapping.source_column,
                            canonical_field=mapping.canonical_field,
                        )
                    )
                if mapping.canonical_field == "gstin" and "gstin" not in profile.pattern_hints:
                    normalized_source = normalize_name(mapping.source_column)
                    explicit_counterparty_header = normalized_source.endswith("gstin") and any(
                        marker in normalized_source
                        for marker in ("billfrom", "supplier", "vendor", "counterparty", "seller", "ctin")
                    )
                    issues.append(
                        MappingValidationIssue(
                            code=("gstin_pattern_unverified" if explicit_counterparty_header else "invalid_gstin_pattern"),
                            message=(
                                f"'{mapping.source_column}' has explicit supplier/counterparty GSTIN semantics, "
                                "but sampled values do not substantially match the formal GSTIN pattern. Confirm manually."
                                if explicit_counterparty_header else
                                f"Values in '{mapping.source_column}' do not substantially match GSTIN format."
                            ),
                            source_dataset=dataset.source_dataset,
                            source_column=mapping.source_column,
                            canonical_field="gstin",
                            severity="warning" if explicit_counterparty_header else "error",
                        )
                    )

            for canonical, sources in assigned.items():
                if len(sources) > 1:
                    issues.append(
                        MappingValidationIssue(
                            code="duplicate_canonical_field",
                            message=f"{canonical} is assigned to multiple columns: {', '.join(sources)}.",
                            source_dataset=dataset.source_dataset,
                            canonical_field=canonical,
                        )
                    )
            mapped = set(assigned)
            required_mapped[dataset.source_dataset.value] = sorted(mapped.intersection(REQUIRED_EXACT_FIELDS))
            for missing in sorted(set(REQUIRED_EXACT_FIELDS).difference(mapped)):
                issues.append(
                    MappingValidationIssue(
                        code="missing_required_field",
                        message=f"Required canonical field '{missing}' is not mapped.",
                        source_dataset=dataset.source_dataset,
                        canonical_field=missing,
                    )
                )

        return MappingValidationResult(
            valid=not any(issue.severity == "error" for issue in issues),
            issues=issues,
            required_fields_mapped=required_mapped,
        )


def merge_ai_candidates(
    deterministic: list[DatasetMappingProposal],
    ai_output: SchemaMappingAgentOutput,
    unresolved: list[ColumnMappingCandidate],
) -> list[DatasetMappingProposal]:
    allowed = {(item.source_dataset, item.source_column) for item in unresolved}
    replacements = {
        (item.source_dataset, item.source_column): item
        for item in ai_output.mappings
        if (item.source_dataset, item.source_column) in allowed
        and (item.canonical_field is None or item.canonical_field in CANONICAL_BY_NAME)
    }
    merged: list[DatasetMappingProposal] = []
    for dataset in deterministic:
        rows = []
        for mapping in dataset.mappings:
            replacement = replacements.get((mapping.source_dataset, mapping.source_column))
            if replacement is not None:
                replacement.proposed_by = ProposedBy.AI
                rows.append(replacement)
            else:
                rows.append(mapping)
        merged.append(DatasetMappingProposal(source_dataset=dataset.source_dataset, mappings=rows))
    return merged
