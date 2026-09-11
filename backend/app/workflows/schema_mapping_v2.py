from __future__ import annotations

import logging
from pathlib import Path
import sqlite3
from typing import Any, TypedDict
from uuid import UUID, uuid4

from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt

from app.domain.models import DatasetRole
from app.providers.base import LLMProvider
from app.services.direct_schema_correlator import (
    AgentThought,
    DirectCorrelationResult,
    DirectSchemaCorrelator,
)
from app.services.fast_excel_parser import FastExcelParser, FastFileProfile

logger = logging.getLogger(__name__)


class SchemaMappingV2State(TypedDict, total=False):
    session_id: str
    workflow_thread_id: str
    gstr_path: str
    pr_path: str
    gstr_profile: dict[str, Any]
    pr_profile: dict[str, Any]
    correlation_result: dict[str, Any]
    agent_thoughts: list[dict[str, Any]]
    human_approval: str
    status: str


class SchemaMappingV2Workflow:
    """
    LangGraph StateGraph workflow for Reconciliation 2.0.
    Maintains persistent checkpointing and an observable agent thought stream.
    """

    def __init__(self, database_path: Path, llm_provider: LLMProvider | None = None, model_name: str = "gpt-5.4-mini") -> None:
        self.database_path = database_path
        self.parser = FastExcelParser()
        self.correlator = DirectSchemaCorrelator(llm_provider=llm_provider, model_name=model_name)
        self._connection = sqlite3.connect(database_path, check_same_thread=False)
        self._checkpointer = SqliteSaver(self._connection)
        self._checkpointer.setup()

        graph = StateGraph(SchemaMappingV2State)
        graph.add_node("fast_probe_ingestion", self._fast_probe_ingestion)
        graph.add_node("direct_schema_correlation", self._direct_schema_correlation)
        graph.add_node("await_human_review", self._await_human_review)
        graph.add_node("schema_confirmed", self._schema_confirmed)

        graph.add_edge(START, "fast_probe_ingestion")
        graph.add_edge("fast_probe_ingestion", "direct_schema_correlation")
        graph.add_edge("direct_schema_correlation", "await_human_review")
        graph.add_edge("await_human_review", "schema_confirmed")
        graph.add_edge("schema_confirmed", END)

        self._compiled = graph.compile(checkpointer=self._checkpointer)

    def close(self) -> None:
        try:
            self._connection.close()
        except Exception:
            pass

    @staticmethod
    def _config(thread_id: str) -> dict:
        return {"configurable": {"thread_id": thread_id}}

    def _fast_probe_ingestion(self, state: SchemaMappingV2State) -> SchemaMappingV2State:
        gstr_path = Path(state["gstr_path"])
        pr_path = Path(state["pr_path"])

        g_prof = self.parser.parse_fast_profile(gstr_path, DatasetRole.GOVERNMENT)
        pr_prof = self.parser.parse_fast_profile(pr_path, DatasetRole.PURCHASE_REGISTER)

        return {
            "gstr_profile": g_prof.to_dict(),
            "pr_profile": pr_prof.to_dict(),
            "status": "ingested",
        }

    def _direct_schema_correlation(self, state: SchemaMappingV2State) -> SchemaMappingV2State:
        # Reconstruct already extracted profiles from state to avoid duplicate workbook parsing
        if "gstr_profile" in state and "pr_profile" in state:
            g_prof = FastFileProfile.from_dict(state["gstr_profile"])
            pr_prof = FastFileProfile.from_dict(state["pr_profile"])
        else:
            gstr_path = Path(state["gstr_path"])
            pr_path = Path(state["pr_path"])
            g_prof = self.parser.parse_fast_profile(gstr_path, DatasetRole.GOVERNMENT)
            pr_prof = self.parser.parse_fast_profile(pr_path, DatasetRole.PURCHASE_REGISTER)

        res = self.correlator.correlate(state["session_id"], g_prof, pr_prof)
        return {
            "correlation_result": res.model_dump(mode="json"),
            "agent_thoughts": [t.model_dump(mode="json") for t in res.agent_thoughts],
            "status": "correlated",
        }

    @staticmethod
    def _await_human_review(state: SchemaMappingV2State) -> SchemaMappingV2State:
        decision = interrupt(
            {
                "type": "schema_review",
                "session_id": state["session_id"],
                "gstr_columns": len(state.get("correlation_result", {}).get("correlations", [])),
            }
        )
        return {"human_approval": str(decision), "status": "approved"}

    @staticmethod
    def _schema_confirmed(state: SchemaMappingV2State) -> SchemaMappingV2State:
        return {"status": "confirmed"}

    def run_initial_correlation(
        self, session_id: str, gstr_path: Path, pr_path: Path
    ) -> DirectCorrelationResult:
        thread_id = f"reconciliation-v2-{session_id}-{uuid4().hex[:8]}"
        self._compiled.invoke(
            {
                "session_id": session_id,
                "workflow_thread_id": thread_id,
                "gstr_path": str(gstr_path.resolve()),
                "pr_path": str(pr_path.resolve()),
            },
            config=self._config(thread_id),
        )
        # Read checkpoint state
        state = self._compiled.get_state(self._config(thread_id))
        corr_dict = state.values.get("correlation_result", {})
        return DirectCorrelationResult.model_validate(corr_dict)
