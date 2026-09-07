from __future__ import annotations

from datetime import datetime
from uuid import UUID

from app.domain.models import (
    AIInvestigationAvailability, AIInvestigationRecord, ActorType, AgentEvent,
    InvestigationValidationResult, utc_now,
)
from app.workflows.exception_investigation import ExceptionInvestigationWorkflow, InvestigationValidationError


class AIInvestigationUnavailable(RuntimeError):
    pass


class AIInvestigationService:
    def __init__(self, reconciliation, workflow: ExceptionInvestigationWorkflow | None,
                 model_name: str) -> None:
        self.reconciliation, self.workflow, self.model_name = reconciliation, workflow, model_name

    @property
    def availability(self) -> AIInvestigationAvailability:
        return AIInvestigationAvailability(
            available=self.workflow is not None, model=self.model_name,
            reason=None if self.workflow else "OPENAI_API_KEY is not configured; AI investigation is unavailable.",
        )

    def investigate(self, reconciliation_id: UUID, record_id: str) -> AIInvestigationRecord:
        self.reconciliation.get(reconciliation_id)
        if self.workflow is None:
            raise AIInvestigationUnavailable(self.availability.reason or "AI investigation is unavailable")
        started = utc_now()
        self.reconciliation.repository.add_event(AgentEvent(
            event_type="AI_INVESTIGATION_STARTED", reconciliation_id=reconciliation_id,
            actor_type=ActorType.USER, component="exception_investigation",
            result="started", metadata={"record_id": record_id},
            model_provider="openai", model_name=self.model_name,
        ))
        try:
            record = self.workflow.run(reconciliation_id, record_id)
            for step in record.execution_trace:
                if step.stage == "tool":
                    self.reconciliation.repository.add_event(AgentEvent(
                        event_type="AI_TOOL_CALLED", reconciliation_id=reconciliation_id,
                        actor_type=ActorType.AGENT, component="exception_investigation",
                        result=step.status, metadata={"record_id": record_id, "tool_name": step.name,
                                                     "duration_ms": step.duration_ms},
                        model_provider="openai", model_name=self.model_name,
                    ))
            self.reconciliation.repository.add_event(AgentEvent(
                event_type="AI_INVESTIGATION_COMPLETED", reconciliation_id=reconciliation_id,
                actor_type=ActorType.AGENT, component="exception_investigation", result="validated",
                metadata={"record_id": record_id, "investigation_id": str(record.id),
                          "tool_count": sum(s.stage == "tool" for s in record.execution_trace),
                          "validation_valid": record.validation_result.valid,
                          "latency_ms": record.latency_ms, "token_usage": record.token_usage},
                model_provider=record.provider, model_name=record.model,
            ))
            return record
        except Exception as exc:
            completed = utc_now()
            validation = exc.result if isinstance(exc, InvestigationValidationError) else InvestigationValidationResult(
                valid=False, checked_evidence_references=0, checked_reasoning_statements=0,
                errors=["Investigation did not produce a displayable validated result"],
            )
            code = "factual_validation_failed" if isinstance(exc, InvestigationValidationError) else "provider_or_tool_failure"
            failed = AIInvestigationRecord(
                reconciliation_id=reconciliation_id, record_id=record_id, status="failed",
                conclusion=exc.conclusion if isinstance(exc, InvestigationValidationError) else None,
                execution_trace=self.workflow.failure_trace,
                provider="openai", model=self.model_name, started_at=started, completed_at=completed,
                latency_ms=(completed - started).total_seconds() * 1000,
                validation_result=validation, error_code=code,
                error_message="AI investigation failed safely. Retry, or use deterministic exception evidence.",
            )
            self.reconciliation.repository.save_ai_investigation(failed)
            for step in failed.execution_trace:
                if step.stage == "tool":
                    self.reconciliation.repository.add_event(AgentEvent(
                        event_type="AI_TOOL_CALLED", reconciliation_id=reconciliation_id,
                        actor_type=ActorType.AGENT, component="exception_investigation",
                        result=step.status, metadata={"record_id": record_id, "tool_name": step.name,
                                                     "duration_ms": step.duration_ms},
                        model_provider="openai", model_name=self.model_name,
                    ))
            self.reconciliation.repository.add_event(AgentEvent(
                event_type="AI_INVESTIGATION_FAILED", reconciliation_id=reconciliation_id,
                actor_type=ActorType.AGENT, component="exception_investigation", result="failed",
                metadata={"record_id": record_id, "investigation_id": str(failed.id), "error_code": code},
                model_provider="openai", model_name=self.model_name,
            ))
            raise

    def list(self, reconciliation_id: UUID, record_id: str) -> list[AIInvestigationRecord]:
        self.reconciliation.get(reconciliation_id)
        return self.reconciliation.repository.list_ai_investigations(reconciliation_id, record_id)
