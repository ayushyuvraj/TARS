from __future__ import annotations

import sqlite3
from typing import TypedDict
from uuid import UUID, uuid4

from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt

from app.domain.models import SchemaMappingProposal
from app.services.reconciliation import ReconciliationNotReadyError, ReconciliationService
from app.services.schema_mapping import SchemaProviderUnavailable


class SchemaMappingGraphState(TypedDict, total=False):
    reconciliation_id: str
    workflow_thread_id: str
    profile_column_count: int
    mapping_valid: bool
    approval: str


class SchemaMappingWorkflow:
    """Durable LangGraph workflow that genuinely interrupts for human confirmation."""

    def __init__(self, service: ReconciliationService, database_path) -> None:
        self.service = service
        self._connection = sqlite3.connect(database_path, check_same_thread=False)
        self._checkpointer = SqliteSaver(self._connection)
        self._checkpointer.setup()
        graph = StateGraph(SchemaMappingGraphState)
        graph.add_node("profile_files", self._profile_files)
        graph.add_node("propose_schema_mapping", self._propose_schema_mapping)
        graph.add_node("await_human_confirmation", self._await_human_confirmation)
        graph.add_node("mapping_confirmed", self._mapping_confirmed)
        graph.add_edge(START, "profile_files")
        graph.add_edge("profile_files", "propose_schema_mapping")
        graph.add_edge("propose_schema_mapping", "await_human_confirmation")
        graph.add_edge("await_human_confirmation", "mapping_confirmed")
        graph.add_edge("mapping_confirmed", END)
        self._compiled = graph.compile(checkpointer=self._checkpointer)

    @staticmethod
    def _config(thread_id: str) -> dict:
        return {"configurable": {"thread_id": thread_id}}

    def _profile_files(self, state: SchemaMappingGraphState) -> SchemaMappingGraphState:
        profiles = self.service.profile_files(UUID(state["reconciliation_id"]))
        return {"profile_column_count": sum(len(profile.column_profiles) for profile in profiles)}

    def _propose_schema_mapping(self, state: SchemaMappingGraphState) -> SchemaMappingGraphState:
        proposal = self.service.propose_schema_mapping(
            UUID(state["reconciliation_id"]), state["workflow_thread_id"]
        )
        return {"mapping_valid": proposal.validation.valid}

    @staticmethod
    def _await_human_confirmation(state: SchemaMappingGraphState) -> SchemaMappingGraphState:
        decision = interrupt(
            {
                "type": "mapping_approval",
                "reconciliation_id": state["reconciliation_id"],
                "mapping_valid": state.get("mapping_valid", False),
            }
        )
        return {"approval": str(decision)}

    def _mapping_confirmed(self, state: SchemaMappingGraphState) -> SchemaMappingGraphState:
        session = self.service.get(UUID(state["reconciliation_id"]))
        if session.confirmed_mapping is None:
            raise ReconciliationNotReadyError(
                "The workflow cannot resume until the mapping is persisted as confirmed"
            )
        return {"approval": "confirmed"}

    def start(self, reconciliation_id: UUID) -> SchemaMappingProposal:
        thread_id = f"mapping-{reconciliation_id}-{uuid4().hex}"
        self._compiled.invoke(
            {
                "reconciliation_id": str(reconciliation_id),
                "workflow_thread_id": thread_id,
            },
            config=self._config(thread_id),
        )
        proposal = self.service.get_mapping(reconciliation_id)
        if proposal.provider_error:
            raise SchemaProviderUnavailable(
                proposal.provider_error + " Retry is safe or complete the mapping manually."
            )
        return proposal

    def resume_after_confirmation(self, reconciliation_id: UUID) -> None:
        session = self.service.get(reconciliation_id)
        if session.workflow_thread_id is None:
            raise ReconciliationNotReadyError("No schema-mapping checkpoint exists")
        self._compiled.invoke(
            Command(resume="confirmed"),
            config=self._config(session.workflow_thread_id),
        )

    def checkpoint_next_nodes(self, reconciliation_id: UUID) -> tuple[str, ...]:
        session = self.service.get(reconciliation_id)
        if session.workflow_thread_id is None:
            return ()
        snapshot = self._compiled.get_state(self._config(session.workflow_thread_id))
        return tuple(snapshot.next)

    def close(self) -> None:
        self._connection.close()
