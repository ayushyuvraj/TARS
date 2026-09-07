from __future__ import annotations

from typing import TypedDict
from uuid import UUID

from langgraph.graph import END, START, StateGraph

from app.domain.models import ReconciliationSummary
from app.services.reconciliation import ReconciliationService


class ExactMatchGraphState(TypedDict, total=False):
    reconciliation_id: UUID
    summary: ReconciliationSummary


class ExactMatchWorkflow:
    """Phase 1 LangGraph workflow; later nodes can be inserted without changing API contracts."""

    def __init__(self, service: ReconciliationService) -> None:
        self.service = service
        graph = StateGraph(ExactMatchGraphState)
        graph.add_node("exact_match", self._exact_match)
        graph.add_edge(START, "exact_match")
        graph.add_edge("exact_match", END)
        self._compiled = graph.compile()

    def _exact_match(self, state: ExactMatchGraphState) -> ExactMatchGraphState:
        return {"summary": self.service.run_exact_match(state["reconciliation_id"])}

    def run(self, reconciliation_id: UUID) -> ReconciliationSummary:
        result = self._compiled.invoke({"reconciliation_id": reconciliation_id})
        return ReconciliationSummary.model_validate(result["summary"])

