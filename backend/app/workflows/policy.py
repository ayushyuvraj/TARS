from __future__ import annotations

import sqlite3
from typing import TypedDict
from uuid import UUID, uuid4

from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt

from app.domain.models import NaturalLanguagePolicyProposal
from app.services.reconciliation import ReconciliationNotReadyError, ReconciliationService


class PolicyGraphState(TypedDict, total=False):
    reconciliation_id: str
    workflow_thread_id: str
    instruction: str | None
    policy_valid: bool
    approval: str


class PolicyWorkflow:
    """Durable policy compilation workflow with a real human interrupt."""

    def __init__(self, service: ReconciliationService, database_path) -> None:
        self.service = service
        self._connection = sqlite3.connect(database_path, check_same_thread=False)
        self._checkpointer = SqliteSaver(self._connection)
        self._checkpointer.setup()
        graph = StateGraph(PolicyGraphState)
        graph.add_node("propose_reconciliation_policy", self._propose)
        graph.add_node("validate_policy", self._validate)
        graph.add_node("await_policy_confirmation", self._await_confirmation)
        graph.add_node("policy_confirmed", self._confirmed)
        graph.add_edge(START, "propose_reconciliation_policy")
        graph.add_edge("propose_reconciliation_policy", "validate_policy")
        graph.add_edge("validate_policy", "await_policy_confirmation")
        graph.add_edge("await_policy_confirmation", "policy_confirmed")
        graph.add_edge("policy_confirmed", END)
        self._compiled = graph.compile(checkpointer=self._checkpointer)

    @staticmethod
    def _config(thread_id: str) -> dict:
        return {"configurable": {"thread_id": thread_id}}

    def _propose(self, state: PolicyGraphState) -> PolicyGraphState:
        proposal = self.service.propose_policy(
            UUID(state["reconciliation_id"]), state.get("instruction"), state["workflow_thread_id"]
        )
        return {"policy_valid": proposal.validation.valid}

    def _validate(self, state: PolicyGraphState) -> PolicyGraphState:
        validation = self.service.validate_policy(UUID(state["reconciliation_id"]))
        return {"policy_valid": validation.valid}

    @staticmethod
    def _await_confirmation(state: PolicyGraphState) -> PolicyGraphState:
        decision = interrupt({
            "type": "policy_approval",
            "reconciliation_id": state["reconciliation_id"],
            "policy_valid": state.get("policy_valid", False),
        })
        return {"approval": str(decision)}

    def _confirmed(self, state: PolicyGraphState) -> PolicyGraphState:
        session = self.service.get(UUID(state["reconciliation_id"]))
        if session.confirmed_policy is None:
            raise ReconciliationNotReadyError(
                "The workflow cannot resume until the policy is persisted as confirmed"
            )
        return {"approval": "confirmed"}

    def start(self, reconciliation_id: UUID, instruction: str | None = None) -> NaturalLanguagePolicyProposal:
        thread_id = f"policy-{reconciliation_id}-{uuid4().hex}"
        self._compiled.invoke({
            "reconciliation_id": str(reconciliation_id),
            "workflow_thread_id": thread_id,
            "instruction": instruction,
        }, config=self._config(thread_id))
        return self.service.get_policy(reconciliation_id)

    def resume_after_confirmation(self, reconciliation_id: UUID) -> None:
        session = self.service.get(reconciliation_id)
        if session.policy_workflow_thread_id is None:
            raise ReconciliationNotReadyError("No policy approval checkpoint exists")
        self._compiled.invoke(
            Command(resume="confirmed"), config=self._config(session.policy_workflow_thread_id)
        )

    def checkpoint_next_nodes(self, reconciliation_id: UUID) -> tuple[str, ...]:
        session = self.service.get(reconciliation_id)
        if session.policy_workflow_thread_id is None:
            return ()
        snapshot = self._compiled.get_state(self._config(session.policy_workflow_thread_id))
        return tuple(snapshot.next)

    def close(self) -> None:
        self._connection.close()
