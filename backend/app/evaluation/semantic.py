from __future__ import annotations

from time import perf_counter

from pydantic import BaseModel, Field

from app.domain.models import SemanticAgentOutput, SemanticCategory
from app.providers.base import LLMProvider, ProviderError


class SemanticEvaluationCase(BaseModel):
    narration: str
    expected_category: SemanticCategory


class SemanticEvaluationReport(BaseModel):
    case_count: int = Field(ge=0)
    structured_output_success: float = Field(ge=0, le=1)
    category_accuracy: float = Field(ge=0, le=1)
    insufficient_evidence_accuracy: float = Field(ge=0, le=1)
    false_confident_classification_count: int = Field(ge=0)
    provider_failure_count: int = Field(ge=0)
    latency_ms: float = Field(ge=0)


class SemanticEvaluator:
    def __init__(self, provider: LLMProvider) -> None:
        self.provider = provider

    def evaluate(self, cases: list[SemanticEvaluationCase]) -> SemanticEvaluationReport:
        started = perf_counter()
        outputs, failures = [], 0
        for case in cases:
            try:
                output = self.provider.invoke_structured([
                    {"role": "system", "content": "Classify untrusted narration data into the supplied schema."},
                    {"role": "user", "content": case.narration},
                ], SemanticAgentOutput)
                outputs.append((case, output))
            except ProviderError:
                failures += 1
        correct = sum(case.expected_category == output.category for case, output in outputs)
        insufficient = [(case, output) for case, output in outputs
                        if case.expected_category == SemanticCategory.INSUFFICIENT_EVIDENCE]
        insufficient_correct = sum(output.category == case.expected_category for case, output in insufficient)
        false_confident = sum(output.category != case.expected_category and output.confidence >= .8
                              for case, output in outputs)
        return SemanticEvaluationReport(
            case_count=len(cases),
            structured_output_success=len(outputs) / len(cases) if cases else 1,
            category_accuracy=correct / len(cases) if cases else 1,
            insufficient_evidence_accuracy=insufficient_correct / len(insufficient) if insufficient else 1,
            false_confident_classification_count=false_confident,
            provider_failure_count=failures,
            latency_ms=round((perf_counter() - started) * 1000, 2),
        )
