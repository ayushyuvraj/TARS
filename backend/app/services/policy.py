from __future__ import annotations

import re
from decimal import Decimal
from time import perf_counter

from app.domain.models import (
    CanonicalDataType,
    ConfirmedMappingSet,
    MatchOperator,
    NaturalLanguagePolicyAgentOutput,
    PolicyEvaluationReport,
    PolicyFieldRule,
    PolicyValidationIssue,
    PolicyValidationResult,
    ProposedBy,
    ReconciliationPolicy,
    ToleranceDefinition,
    ToleranceUnit,
)
from app.providers.base import LLMProvider, ProviderError
from app.services.canonical_schema import CANONICAL_BY_NAME


class PolicyProviderUnavailable(RuntimeError):
    pass


FIELD_TERMS = {
    "gstin": ("gstin", "gst number"),
    "document_number": ("invoice number", "invoice", "document number"),
    "taxable_value": ("taxable value", "amount", "value"),
    "document_date": ("invoice date", "document date", "date"),
    "igst": ("igst",),
    "cgst": ("cgst",),
    "sgst": ("sgst",),
}


def default_policy(instruction: str | None = None) -> ReconciliationPolicy:
    return ReconciliationPolicy(
        name="GST Purchase Reconciliation Default",
        proposed_by=ProposedBy.DETERMINISTIC if instruction else ProposedBy.HUMAN,
        natural_language_instruction=instruction,
        explanation="GSTIN and invoice identify a transaction; amount and date permit bounded variance.",
        rules=[
            PolicyFieldRule(canonical_field="gstin", operator=MatchOperator.EXACT),
            PolicyFieldRule(canonical_field="document_number", operator=MatchOperator.EXACT),
            PolicyFieldRule(
                canonical_field="taxable_value",
                operator=MatchOperator.ABSOLUTE_TOLERANCE,
                tolerance=ToleranceDefinition(value=Decimal("10"), unit=ToleranceUnit.INR),
            ),
            PolicyFieldRule(
                canonical_field="document_date",
                operator=MatchOperator.DATE_TOLERANCE,
                tolerance=ToleranceDefinition(value=Decimal("5"), unit=ToleranceUnit.DAYS),
            ),
        ],
    )


class DeterministicPolicyInterpreter:
    """Conservative extraction for the common, unambiguous policy language."""

    _money = re.compile(
        r"(?:₹|rs\.?|inr)\s*(\d+(?:\.\d+)?)|(?:taxable\s+value|amount|value)[^.!?]{0,45}?(\d+(?:\.\d+)?)",
        re.IGNORECASE,
    )
    _days = re.compile(r"(\d+(?:\.\d+)?)\s*days?", re.IGNORECASE)

    def interpret(self, instruction: str) -> ReconciliationPolicy | None:
        text = " ".join(instruction.split())
        lower = text.lower()
        money = self._money.search(text)
        days = self._days.search(text)
        has_gstin = "gstin" in lower or "gst number" in lower
        has_invoice = "invoice" in lower or "document number" in lower
        if not (has_gstin and has_invoice and money and days):
            return None
        money_value = next(group for group in money.groups() if group is not None)
        policy = default_policy(instruction)
        policy.rules[2].tolerance = ToleranceDefinition(
            value=Decimal(money_value), unit=ToleranceUnit.INR
        )
        policy.rules[3].tolerance = ToleranceDefinition(
            value=Decimal(days.group(1)), unit=ToleranceUnit.DAYS
        )
        return policy


class PolicyInterpreterAgent:
    def __init__(self, provider: LLMProvider, model: str) -> None:
        self.provider = provider
        self.model = model

    def interpret(
        self,
        instruction: str,
        available_fields: list[str],
        existing_policy: ReconciliationPolicy | None = None,
    ) -> ReconciliationPolicy:
        definitions = [
            {
                "canonical_field": name,
                "datatype": CANONICAL_BY_NAME[name].expected_datatype.value,
            }
            for name in available_fields
            if name in CANONICAL_BY_NAME
        ]
        messages = [
            {
                "role": "system",
                "content": (
                    "Compile the user's GST reconciliation instruction into the supplied structured schema. "
                    "Use only EXACT, ABSOLUTE_TOLERANCE (INR), and DATE_TOLERANCE (DAYS). "
                    "Never invent a missing critical identifier or tolerance."
                ),
            },
            {
                "role": "user",
                "content": str(
                    {
                        "instruction": instruction,
                        "available_fields": definitions,
                        "existing_policy": (
                            existing_policy.model_dump(mode="json") if existing_policy else None
                        ),
                    }
                ),
            },
        ]
        try:
            output = self.provider.invoke_structured(
                messages, NaturalLanguagePolicyAgentOutput, model=self.model
            )
        except (ProviderError, ValueError, TypeError) as exc:
            raise PolicyProviderUnavailable("The configured policy provider could not return valid structured output.") from exc
        return ReconciliationPolicy(
            name=output.name,
            rules=output.rules,
            explanation=output.explanation,
            natural_language_instruction=instruction,
            proposed_by=ProposedBy.AI,
        )


class PolicyValidator:
    required_identifiers = {"gstin", "document_number"}

    def validate(
        self, policy: ReconciliationPolicy, confirmed_mapping: ConfirmedMappingSet
    ) -> PolicyValidationResult:
        issues: list[PolicyValidationIssue] = []
        mapped_by_dataset = [
            {m.canonical_field for m in dataset.mappings if m.canonical_field}
            for dataset in confirmed_mapping.datasets
        ]
        commonly_mapped = set.intersection(*mapped_by_dataset) if mapped_by_dataset else set()
        enabled = [rule for rule in policy.rules if rule.enabled]
        if not enabled:
            issues.append(PolicyValidationIssue(code="empty_policy", message="Enable at least one policy rule."))
        seen: set[str] = set()
        for rule in enabled:
            field = rule.canonical_field
            definition = CANONICAL_BY_NAME.get(field)
            if field in seen:
                issues.append(PolicyValidationIssue(code="duplicate_rule", canonical_field=field, message=f"{field} has more than one enabled rule."))
            seen.add(field)
            if definition is None:
                issues.append(PolicyValidationIssue(code="unknown_field", canonical_field=field, message=f"{field} is not a supported canonical field."))
                continue
            if field not in commonly_mapped:
                issues.append(PolicyValidationIssue(code="unmapped_field", canonical_field=field, message=f"{definition.display_name} must be mapped in both datasets before it can be used."))
            if rule.operator == MatchOperator.EXACT:
                if rule.tolerance is not None:
                    issues.append(PolicyValidationIssue(code="unexpected_tolerance", canonical_field=field, message=f"Exact rule for {definition.display_name} cannot have a tolerance."))
            elif rule.operator == MatchOperator.ABSOLUTE_TOLERANCE:
                if definition.expected_datatype != CanonicalDataType.NUMBER:
                    issues.append(PolicyValidationIssue(code="operator_datatype_mismatch", canonical_field=field, message=f"Absolute tolerance can only be used with numeric fields, not {definition.display_name}."))
                if rule.tolerance is None or rule.tolerance.unit != ToleranceUnit.INR:
                    issues.append(PolicyValidationIssue(code="invalid_tolerance_unit", canonical_field=field, message=f"{definition.display_name} requires a structured INR tolerance."))
            elif rule.operator == MatchOperator.DATE_TOLERANCE:
                if definition.expected_datatype != CanonicalDataType.DATE:
                    issues.append(PolicyValidationIssue(code="operator_datatype_mismatch", canonical_field=field, message=f"Date tolerance can only be used with date fields, not {definition.display_name}."))
                if rule.tolerance is None or rule.tolerance.unit != ToleranceUnit.DAYS:
                    issues.append(PolicyValidationIssue(code="invalid_tolerance_unit", canonical_field=field, message=f"{definition.display_name} requires a structured DAYS tolerance."))
        missing = self.required_identifiers - seen
        for field in sorted(missing):
            issues.append(PolicyValidationIssue(code="missing_required_identifier", canonical_field=field, message=f"Required reconciliation identifier {CANONICAL_BY_NAME[field].display_name} is missing."))
        for field in self.required_identifiers & seen:
            rule = next(item for item in enabled if item.canonical_field == field)
            if rule.operator != MatchOperator.EXACT or not rule.required:
                issues.append(PolicyValidationIssue(code="unsafe_identifier_rule", canonical_field=field, message=f"{CANONICAL_BY_NAME[field].display_name} must be required and exact in Phase 3."))
        return PolicyValidationResult(valid=not any(i.severity == "error" for i in issues), issues=issues)

