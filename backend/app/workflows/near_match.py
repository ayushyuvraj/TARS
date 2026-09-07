from __future__ import annotations

import sqlite3
from typing import TypedDict
from uuid import UUID, uuid4

from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt

from app.domain.models import MatchingThresholds, NearMatchAnalysis
from app.services.reconciliation import ReconciliationNotReadyError, ReconciliationService


class NearMatchGraphState(TypedDict, total=False):
    reconciliation_id: str
    workflow_thread_id: str
    thresholds: dict
    approval: str


class NearMatchWorkflow:
    """Durable near-match workflow that pauses before any proposed pair is consumed."""

    def __init__(self, service: ReconciliationService, database_path) -> None:
        self.service = service
        self._connection = sqlite3.connect(database_path, check_same_thread=False)
        self._checkpointer = SqliteSaver(self._connection)
        self._checkpointer.setup()
        graph = StateGraph(NearMatchGraphState)
        graph.add_node("analyze_near_matches", self._analyze)
        graph.add_node("await_near_match_approval", self._await_approval)
        graph.add_node("near_review_completed", self._completed)
        graph.add_edge(START, "analyze_near_matches")
        graph.add_edge("analyze_near_matches", "await_near_match_approval")
        graph.add_edge("await_near_match_approval", "near_review_completed")
        graph.add_edge("near_review_completed", END)
        self._compiled = graph.compile(checkpointer=self._checkpointer)

    @staticmethod
    def _config(thread_id: str) -> dict:
        return {"configurable": {"thread_id": thread_id}}

    def _analyze(self, state: NearMatchGraphState) -> NearMatchGraphState:
        self.service.analyze_near_matches(
            UUID(state["reconciliation_id"]), state["workflow_thread_id"],
            MatchingThresholds.model_validate(state.get("thresholds", {})),
        )
        return {}

    @staticmethod
    def _await_approval(state: NearMatchGraphState) -> NearMatchGraphState:
        decision = interrupt({
            "type": "near_match_approval",
            "reconciliation_id": state["reconciliation_id"],
        })
        return {"approval": str(decision)}

    def _completed(self, state: NearMatchGraphState) -> NearMatchGraphState:
        session = self.service.get(UUID(state["reconciliation_id"]))
        if session.near_match_summary is None or session.near_match_summary.near_match_proposals:
            raise ReconciliationNotReadyError("Pending near-match proposals must be decided before resume")
        return {"approval": "reviewed"}

    def start(
        self, reconciliation_id: UUID, thresholds: MatchingThresholds | None = None,
    ) -> NearMatchAnalysis:
        session = self.service.get(reconciliation_id)
        if session.near_match_analysis is not None and any(
            item.match_type == "near"
            for item in self.service.repository.list_match_results(reconciliation_id)
        ):
            return session.near_match_analysis
        thread_id = f"near-{reconciliation_id}-{uuid4().hex}"
        self._compiled.invoke({
            "reconciliation_id": str(reconciliation_id),
            "workflow_thread_id": thread_id,
            "thresholds": (thresholds or MatchingThresholds()).model_dump(mode="json"),
        }, config=self._config(thread_id))
        return self.service.get_near_analysis(reconciliation_id)

    def resume_after_review(self, reconciliation_id: UUID) -> None:
        session = self.service.get(reconciliation_id)
        if session.near_workflow_thread_id is None:
            raise ReconciliationNotReadyError("No near-match approval checkpoint exists")
        if session.near_match_summary is None or session.near_match_summary.near_match_proposals:
            raise ReconciliationNotReadyError("Pending near-match proposals remain")
        snapshot = self._compiled.get_state(self._config(session.near_workflow_thread_id))
        if not snapshot.next:
            return
        self._compiled.invoke(
            Command(resume="reviewed"), config=self._config(session.near_workflow_thread_id)
        )

    def checkpoint_next_nodes(self, reconciliation_id: UUID) -> tuple[str, ...]:
        session = self.service.get(reconciliation_id)
        if session.near_workflow_thread_id is None:
            return ()
        snapshot = self._compiled.get_state(self._config(session.near_workflow_thread_id))
        return tuple(snapshot.next)

    def close(self) -> None:
        self._connection.close()
