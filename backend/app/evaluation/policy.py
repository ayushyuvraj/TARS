from __future__ import annotations

from time import perf_counter

from pydantic import BaseModel, Field

from app.domain.models import (
    ConfirmedMappingSet,
    PolicyEvaluationReport,
    PolicyFieldRule,
    ReconciliationPolicy,
)
from app.providers.base import LLMProvider
from app.services.policy import PolicyInterpreterAgent, PolicyProviderUnavailable, PolicyValidator


class PolicyEvaluationCase(BaseModel):
    instruction: str
    expected_rules: list[PolicyFieldRule]
    should_validate: bool = True


class PolicyInterpretationEvaluator:
    """Provider-agnostic scoring for structured policy interpretation."""

    def __init__(self, provider: LLMProvider, model: str, validator: PolicyValidator | None = None) -> None:
        self.provider = provider
        self.model = model
        self.validator = validator or PolicyValidator()

    def evaluate(
        self, cases: list[PolicyEvaluationCase], confirmed_mapping: ConfirmedMappingSet
    ) -> PolicyEvaluationReport:
        started = perf_counter()
        expected_fields = correct_fields = expected_operators = correct_operators = 0
        expected_tolerances = correct_tolerances = missing = extra = validation_failures = failures = 0
        available = sorted(set.intersection(*[
            {item.canonical_field for item in dataset.mappings if item.canonical_field}
            for dataset in confirmed_mapping.datasets
        ]))
        for case in cases:
            try:
                policy = PolicyInterpreterAgent(self.provider, self.model).interpret(
                    case.instruction, available
                )
            except PolicyProviderUnavailable:
                failures += 1
                expected_fields += len(case.expected_rules)
                expected_operators += len(case.expected_rules)
                expected_tolerances += sum(rule.tolerance is not None for rule in case.expected_rules)
                missing += len(case.expected_rules)
                continue
            expected = {rule.canonical_field: rule for rule in case.expected_rules}
            actual = {rule.canonical_field: rule for rule in policy.rules if rule.enabled}
            expected_fields += len(expected)
            correct_fields += len(expected.keys() & actual.keys())
            missing += len(expected.keys() - actual.keys())
            extra += len(actual.keys() - expected.keys())
            for field, rule in expected.items():
                expected_operators += 1
                candidate = actual.get(field)
                if candidate and candidate.operator == rule.operator:
                    correct_operators += 1
                if rule.tolerance is not None:
                    expected_tolerances += 1
                    if candidate and candidate.tolerance == rule.tolerance:
                        correct_tolerances += 1
            validation = self.validator.validate(policy, confirmed_mapping)
            if validation.valid != case.should_validate:
                validation_failures += 1
        return PolicyEvaluationReport(
            provider=self.provider.provider_name,
            model=self.model,
            field_accuracy=correct_fields / expected_fields if expected_fields else 1,
            operator_accuracy=correct_operators / expected_operators if expected_operators else 1,
            tolerance_accuracy=correct_tolerances / expected_tolerances if expected_tolerances else 1,
            missing_rule_count=missing,
            extra_rule_count=extra,
            validation_failure_count=validation_failures,
            structured_output_failure_count=failures,
            latency_ms=round((perf_counter() - started) * 1000, 2),
        )
