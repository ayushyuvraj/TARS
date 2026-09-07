from __future__ import annotations

import re
from time import perf_counter

from pydantic import BaseModel, Field

from app.domain.models import CopilotRequest
from app.services.copilot import CopilotService


class CopilotEvaluationCase(BaseModel):
    question: str
    expected_tools: list[str]
    expected_facts: list[str]
    selected_record_id: str | None = None


class CopilotEvaluationReport(BaseModel):
    case_count: int = Field(ge=0)
    tool_selection_accuracy: float = Field(ge=0, le=1)
    factual_consistency: float = Field(ge=0, le=1)
    unsupported_number_count: int = Field(ge=0)
    structured_response_validity: float = Field(ge=0, le=1)
    latency_ms: float = Field(ge=0)


class CopilotEvaluator:
    def __init__(self, service: CopilotService) -> None:
        self.service = service

    def evaluate(self, reconciliation_id, cases: list[CopilotEvaluationCase]) -> CopilotEvaluationReport:
        started = perf_counter()
        tool_correct = fact_correct = valid = unsupported = 0
        for case in cases:
            response = self.service.ask(reconciliation_id, CopilotRequest(
                message=case.question, selected_record_id=case.selected_record_id,
            ))
            called = {item.tool_name for item in response.tool_calls}
            tool_correct += set(case.expected_tools) <= called
            fact_correct += all(fact.lower() in response.answer.lower() for fact in case.expected_facts)
            valid += bool(response.answer and response.evidence and response.tool_calls)
            evidence_text = str([item.facts for item in response.evidence])
            answer_numbers = set(re.findall(r"\d+(?:,\d{3})*(?:\.\d+)?", response.answer))
            unsupported += sum(number.replace(",", "") not in evidence_text.replace(",", "")
                               for number in answer_numbers)
        count = len(cases)
        return CopilotEvaluationReport(
            case_count=count, tool_selection_accuracy=tool_correct / count if count else 1,
            factual_consistency=fact_correct / count if count else 1,
            unsupported_number_count=unsupported,
            structured_response_validity=valid / count if count else 1,
            latency_ms=round((perf_counter() - started) * 1000, 2),
        )
