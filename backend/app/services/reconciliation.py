from __future__ import annotations

import logging
from pathlib import Path
from threading import RLock
from time import perf_counter
from uuid import UUID, uuid4

from app.config import Settings
from app.domain.models import (
    ActorType,
    AgentEvent,
    ConfirmedDatasetMapping,
    ConfirmedMappingSet,
    DatasetMappingProposal,
    DatasetRole,
    HumanMappingDecision,
    MappingValidationResult,
    HumanPolicyDecision,
    NaturalLanguagePolicyProposal,
    PolicyStatus,
    PolicyValidationResult,
    ProposedBy,
    ReconciliationPolicy,
    ReconciliationResultItem,
    ReconciliationResults,
    ReconciliationSession,
    ReconciliationSummary,
    ToleranceReconciliationSummary,
    SchemaMappingProposal,
    SessionStatus,
    UploadedFile,
    CandidateMatch,
    CandidateStatus,
    MatchResult,
    MatchingThresholds,
    NearMatchAnalysis,
    NearMatchBulkApprovalResult,
    NearMatchBulkApprovalTotals,
    NearMatchBulkSkipReason,
    NearMatchDecisionAction,
    NearMatchReconciliationSummary,
    utc_now,
)
from app.repositories.base import ReconciliationRepository
from app.providers.base import LLMProvider
from app.services.canonical_schema import REQUIRED_EXACT_FIELDS
from app.services.exact_match import ExactMatchEngine
from app.services.excel_parser import ExcelParser
from app.services.schema_mapping import (
    DeterministicSchemaMapper,
    MappingValidator,
    SchemaMappingAgent,
    SchemaProviderUnavailable,
    enforce_one_source_per_canonical,
    merge_ai_candidates,
)
from app.services.policy import (
    DeterministicPolicyInterpreter,
    PolicyInterpreterAgent,
    PolicyProviderUnavailable,
    PolicyValidator,
    default_policy,
)
from app.services.tolerance_match import ToleranceMatchEngine
from app.services.near_match import NearMatchEngine

logger = logging.getLogger(__name__)


class ReconciliationNotFoundError(LookupError):
    pass


class ReconciliationNotReadyError(RuntimeError):
    pass


class MappingInvalidError(RuntimeError):
    def __init__(self, validation: MappingValidationResult) -> None:
        super().__init__("Schema mapping is invalid")
        self.validation = validation


class PolicyInvalidError(RuntimeError):
    def __init__(self, validation: PolicyValidationResult) -> None:
        super().__init__("Reconciliation policy is invalid")
        self.validation = validation


class ReconciliationService:
    def __init__(
        self,
        repository: ReconciliationRepository,
        parser: ExcelParser,
        exact_engine: ExactMatchEngine,
        settings: Settings,
        schema_mapper: DeterministicSchemaMapper | None = None,
        mapping_validator: MappingValidator | None = None,
        llm_provider: LLMProvider | None = None,
        policy_validator: PolicyValidator | None = None,
        tolerance_engine: ToleranceMatchEngine | None = None,
        near_match_engine: NearMatchEngine | None = None,
    ) -> None:
        self.repository = repository
        self.parser = parser
        self.exact_engine = exact_engine
        self.settings = settings
        self.schema_mapper = schema_mapper or DeterministicSchemaMapper()
        self.mapping_validator = mapping_validator or MappingValidator()
        self.llm_provider = llm_provider
        self.policy_validator = policy_validator or PolicyValidator()
        self.policy_interpreter = DeterministicPolicyInterpreter()
        self.tolerance_engine = tolerance_engine or ToleranceMatchEngine()
        self.near_match_engine = near_match_engine or NearMatchEngine()
        self._near_approval_lock = RLock()

    def create(self) -> ReconciliationSession:
        session = self.repository.create(ReconciliationSession())
        self.repository.add_event(
            AgentEvent(
                event_type="reconciliation.created",
                reconciliation_id=session.id,
                actor_type=ActorType.USER,
                component="reconciliation_service",
                result="created",
            )
        )
        return session

    def get(self, reconciliation_id: UUID) -> ReconciliationSession:
        session = self.repository.get(reconciliation_id)
        if session is None:
            raise ReconciliationNotFoundError(str(reconciliation_id))
        return session

    def list_sessions(self):
        return self.repository.list_sessions()

    def register_upload(
        self,
        reconciliation_id: UUID,
        role: DatasetRole,
        original_filename: str,
        stored_path: Path,
        size_bytes: int,
    ) -> UploadedFile:
        self.get(reconciliation_id)
        parsed = self.parser.parse(stored_path, role)
        uploaded = UploadedFile(
            role=role,
            original_filename=original_filename,
            stored_path=str(stored_path.resolve()),
            size_bytes=size_bytes,
            profile=parsed.profile,
        )
        self.repository.save_file(reconciliation_id, uploaded)
        self.repository.add_event(
            AgentEvent(
                event_type=f"file.{role.value}.profiled",
                reconciliation_id=reconciliation_id,
                actor_type=ActorType.SYSTEM,
                component="excel_parser",
                input_count=parsed.profile.row_count,
                output_count=parsed.profile.row_count,
                result="profiled",
                metadata={
                    "filename": original_filename,
                    "sheet_name": parsed.profile.sheet_name,
                    "header_row": parsed.profile.header_row,
                    "column_count": parsed.profile.column_count,
                },
            )
        )
        return uploaded

    def profile_files(self, reconciliation_id: UUID) -> list:
        session = self.get(reconciliation_id)
        if session.government_file is None or session.purchase_register_file is None:
            raise ReconciliationNotReadyError("Both source files must be uploaded before analysis")
        self.repository.update_status(reconciliation_id, SessionStatus.PROFILING)
        self.repository.add_event(
            AgentEvent(
                event_type="dataset.profile.started",
                reconciliation_id=reconciliation_id,
                actor_type=ActorType.SYSTEM,
                component="dataset_profiler",
                input_count=2,
                result="started",
            )
        )
        updated_files: list[UploadedFile] = []
        for uploaded in (session.government_file, session.purchase_register_file):
            parsed = self.parser.parse(Path(uploaded.stored_path), uploaded.role)
            updated = uploaded.model_copy(update={"profile": parsed.profile})
            self.repository.save_file(reconciliation_id, updated)
            updated_files.append(updated)
        self.repository.add_event(
            AgentEvent(
                event_type="dataset.profile.completed",
                reconciliation_id=reconciliation_id,
                actor_type=ActorType.SYSTEM,
                component="dataset_profiler",
                input_count=sum(file.profile.row_count for file in updated_files),
                output_count=sum(len(file.profile.column_profiles) for file in updated_files),
                result="completed",
                metadata={"datasets": 2},
            )
        )
        return [file.profile for file in updated_files]

    def propose_schema_mapping(
        self, reconciliation_id: UUID, workflow_thread_id: str
    ) -> SchemaMappingProposal:
        session = self.get(reconciliation_id)
        if session.government_file is None or session.purchase_register_file is None:
            raise ReconciliationNotReadyError("Both source files must be uploaded before analysis")
        profiles = [session.government_file.profile, session.purchase_register_file.profile]
        started = perf_counter()
        self.repository.add_event(
            AgentEvent(
                event_type="schema_mapping.started",
                reconciliation_id=reconciliation_id,
                actor_type=ActorType.SYSTEM,
                component="hybrid_schema_mapper",
                input_count=sum(len(profile.column_profiles) for profile in profiles),
                result="started",
            )
        )
        datasets = enforce_one_source_per_canonical(
            [self.schema_mapper.propose_dataset(profile) for profile in profiles], profiles
        )
        unresolved = [
            mapping
            for dataset in datasets
            for mapping in dataset.mappings
            if mapping.confidence < self.schema_mapper.high_confidence_threshold
        ]
        provider_used: str | None = None
        provider_failure: SchemaProviderUnavailable | None = None
        if unresolved and self.llm_provider is not None:
            provider_used = self.llm_provider.provider_name
            try:
                ai_output = SchemaMappingAgent(
                    self.llm_provider, self.settings.effective_openai_model
                ).propose(profiles, unresolved)
                datasets = merge_ai_candidates(datasets, ai_output, unresolved)
                datasets = enforce_one_source_per_canonical(datasets, profiles)
            except SchemaProviderUnavailable as exc:
                provider_failure = exc

        validation = self.mapping_validator.validate(datasets, profiles)
        proposal = SchemaMappingProposal(
            reconciliation_id=reconciliation_id,
            datasets=datasets,
            validation=validation,
            ai_provider_used=provider_used,
            ai_model_used=self.settings.effective_openai_model if provider_used else None,
            provider_error=(
                "The configured AI provider was unavailable. Deterministic proposals were preserved."
                if provider_failure is not None
                else None
            ),
        )
        self.repository.save_mapping_proposal(reconciliation_id, proposal, workflow_thread_id)
        duration_ms = round((perf_counter() - started) * 1000, 2)
        self.repository.add_event(
            AgentEvent(
                event_type="schema_mapping.completed",
                reconciliation_id=reconciliation_id,
                actor_type=ActorType.AGENT if provider_used else ActorType.SYSTEM,
                component="hybrid_schema_mapper",
                input_count=sum(len(profile.column_profiles) for profile in profiles),
                output_count=sum(len(dataset.mappings) for dataset in datasets),
                result="provider_failed" if provider_failure else "completed",
                metadata={
                    "duration_ms": duration_ms,
                    "structured_output_success": provider_failure is None,
                    "ai_columns_evaluated": len(unresolved) if provider_used else 0,
                },
                model_provider=provider_used,
                model_name=self.settings.effective_openai_model if provider_used else None,
            )
        )
        self._audit_validation(reconciliation_id, validation)
        self.repository.add_event(
            AgentEvent(
                event_type="schema_mapping.approval_required",
                reconciliation_id=reconciliation_id,
                actor_type=ActorType.SYSTEM,
                component="mapping_workflow",
                result="paused",
                approval_status="pending",
            )
        )
        required_missing = any(
            issue.code == "missing_required_field" for issue in validation.issues
        )
        if required_missing and self.llm_provider is None:
            proposal.provider_error = (
                "Required fields remain unresolved and no AI provider is configured. "
                "Deterministic profiling was preserved."
            )
            self.repository.save_mapping_proposal(
                reconciliation_id, proposal, workflow_thread_id
            )
        return proposal

    def _audit_validation(
        self, reconciliation_id: UUID, validation: MappingValidationResult
    ) -> None:
        self.repository.add_event(
            AgentEvent(
                event_type="schema_mapping.validation_completed",
                reconciliation_id=reconciliation_id,
                actor_type=ActorType.SYSTEM,
                component="mapping_validator",
                input_count=sum(len(fields) for fields in validation.required_fields_mapped.values()),
                output_count=len(validation.issues),
                result="valid" if validation.valid else "invalid",
                metadata={"error_count": len(validation.issues)},
            )
        )

    def get_mapping(self, reconciliation_id: UUID) -> SchemaMappingProposal:
        session = self.get(reconciliation_id)
        if session.mapping_proposal is None:
            raise ReconciliationNotReadyError("Schema mapping has not been analyzed")
        return session.mapping_proposal

    def edit_mapping(
        self, reconciliation_id: UUID, decision: HumanMappingDecision
    ) -> SchemaMappingProposal:
        session = self.get(reconciliation_id)
        if session.mapping_proposal is None or session.workflow_thread_id is None:
            raise ReconciliationNotReadyError("Schema mapping has not been analyzed")
        previous = {
            (mapping.source_dataset, mapping.source_column): mapping.canonical_field
            for dataset in session.mapping_proposal.datasets
            for mapping in dataset.mappings
        }
        edited_count = 0
        normalized_datasets: list[DatasetMappingProposal] = []
        for dataset in decision.datasets:
            rows = []
            for mapping in dataset.mappings:
                changed = previous.get((dataset.source_dataset, mapping.source_column)) != mapping.canonical_field
                if changed:
                    edited_count += 1
                    mapping = mapping.model_copy(
                        update={
                            "source_dataset": dataset.source_dataset,
                            "proposed_by": ProposedBy.HUMAN,
                            "confidence": 1.0,
                            "rationale": "User selected this canonical field.",
                            "user_edited": True,
                        }
                    )
                rows.append(mapping)
            normalized_datasets.append(
                DatasetMappingProposal(source_dataset=dataset.source_dataset, mappings=rows)
            )
        profiles = [session.government_file.profile, session.purchase_register_file.profile]  # type: ignore[union-attr]
        validation = self.mapping_validator.validate(normalized_datasets, profiles)
        proposal = SchemaMappingProposal(
            reconciliation_id=reconciliation_id,
            datasets=normalized_datasets,
            validation=validation,
            ai_provider_used=session.mapping_proposal.ai_provider_used,
            ai_model_used=session.mapping_proposal.ai_model_used,
            provider_error=None,
        )
        self.repository.save_mapping_proposal(
            reconciliation_id, proposal, session.workflow_thread_id
        )
        if edited_count:
            self.repository.add_event(
                AgentEvent(
                    event_type="schema_mapping.user_edited",
                    reconciliation_id=reconciliation_id,
                    actor_type=ActorType.USER,
                    component="mapping_editor",
                    input_count=sum(len(dataset.mappings) for dataset in normalized_datasets),
                    output_count=edited_count,
                    result="saved",
                )
            )
        self._audit_validation(reconciliation_id, validation)
        return proposal

    def confirm_mapping(self, reconciliation_id: UUID) -> ConfirmedMappingSet:
        session = self.get(reconciliation_id)
        if session.mapping_proposal is None:
            raise ReconciliationNotReadyError("Schema mapping has not been analyzed")
        profiles = [session.government_file.profile, session.purchase_register_file.profile]  # type: ignore[union-attr]
        validation = self.mapping_validator.validate(session.mapping_proposal.datasets, profiles)
        self._audit_validation(reconciliation_id, validation)
        if not validation.valid:
            raise MappingInvalidError(validation)
        confirmed = ConfirmedMappingSet(
            reconciliation_id=reconciliation_id,
            datasets=[
                ConfirmedDatasetMapping(
                    source_dataset=dataset.source_dataset,
                    mappings=dataset.mappings,
                )
                for dataset in session.mapping_proposal.datasets
            ],
        )
        self.repository.save_confirmed_mapping(reconciliation_id, confirmed)
        self.repository.add_event(
            AgentEvent(
                event_type="schema_mapping.confirmed",
                reconciliation_id=reconciliation_id,
                actor_type=ActorType.USER,
                component="mapping_workflow",
                result="confirmed",
                approval_status="approved",
            )
        )
        return confirmed

    @staticmethod
    def _exact_mappings(confirmed: ConfirmedMappingSet) -> dict[DatasetRole, dict[str, str]]:
        return {
            dataset.source_dataset: {
                mapping.canonical_field: mapping.source_column
                for mapping in dataset.mappings
                if mapping.canonical_field in REQUIRED_EXACT_FIELDS
            }
            for dataset in confirmed.datasets
        }

    def run_exact_match(self, reconciliation_id: UUID) -> ReconciliationSummary:
        session = self.get(reconciliation_id)
        if session.government_file is None or session.purchase_register_file is None:
            raise ReconciliationNotReadyError("Both source files must be uploaded before matching")
        if session.confirmed_mapping is None or session.status not in {
            SessionStatus.MAPPING_CONFIRMED,
            SessionStatus.AWAITING_POLICY_APPROVAL,
            SessionStatus.POLICY_CONFIRMED,
            SessionStatus.COMPLETED,
        }:
            raise ReconciliationNotReadyError(
                "A valid schema mapping must be explicitly confirmed before exact matching"
            )
        self.repository.update_status(reconciliation_id, SessionStatus.RUNNING)
        self.repository.add_event(
            AgentEvent(
                event_type="exact_match.started",
                reconciliation_id=reconciliation_id,
                actor_type=ActorType.SYSTEM,
                component="exact_match_engine",
                input_count=(
                    session.government_file.profile.row_count
                    + session.purchase_register_file.profile.row_count
                ),
                result="started",
            )
        )
        government = self.parser.parse(
            Path(session.government_file.stored_path), DatasetRole.GOVERNMENT
        )
        purchase_register = self.parser.parse(
            Path(session.purchase_register_file.stored_path), DatasetRole.PURCHASE_REGISTER
        )
        matches = self.exact_engine.match(
            government.dataframe,
            purchase_register.dataframe,
            self._exact_mappings(session.confirmed_mapping),
        )
        summary = ReconciliationSummary(
            reconciliation_id=reconciliation_id,
            status=SessionStatus.COMPLETED,
            government_records=government.profile.row_count,
            purchase_register_records=purchase_register.profile.row_count,
            exact_matches=len(matches),
            remaining_government_records=government.profile.row_count - len(matches),
            remaining_purchase_register_records=purchase_register.profile.row_count - len(matches),
        )
        self.repository.save_results(reconciliation_id, matches, summary)
        self.repository.add_event(
            AgentEvent(
                event_type="exact_match.completed",
                reconciliation_id=reconciliation_id,
                actor_type=ActorType.SYSTEM,
                component="exact_match_engine",
                input_count=government.profile.row_count + purchase_register.profile.row_count,
                output_count=len(matches),
                result="completed",
                metadata={
                    "government_records": government.profile.row_count,
                    "purchase_register_records": purchase_register.profile.row_count,
                    "one_to_one": True,
                    "matched_fields": list(matches[0].matched_fields) if matches else [],
                },
            )
        )
        logger.info("Exact reconciliation completed", extra={"reconciliation_id": str(reconciliation_id)})
        return summary

    @staticmethod
    def _available_policy_fields(confirmed: ConfirmedMappingSet) -> list[str]:
        mapped = [
            {item.canonical_field for item in dataset.mappings if item.canonical_field}
            for dataset in confirmed.datasets
        ]
        return sorted(set.intersection(*mapped)) if mapped else []

    def propose_policy(
        self, reconciliation_id: UUID, instruction: str | None, workflow_thread_id: str
    ) -> NaturalLanguagePolicyProposal:
        session = self.get(reconciliation_id)
        if session.confirmed_mapping is None:
            raise ReconciliationNotReadyError("Schema mapping must be confirmed before policy creation")
        started = perf_counter()
        self.repository.add_event(AgentEvent(
            event_type="policy.proposal.started", reconciliation_id=reconciliation_id,
            actor_type=ActorType.USER, component="policy_interpreter", result="started",
        ))
        available = self._available_policy_fields(session.confirmed_mapping)
        provider_used: str | None = None
        provider_error: str | None = None
        policy: ReconciliationPolicy
        if instruction:
            deterministic = self.policy_interpreter.interpret(instruction)
            if deterministic is not None:
                policy = deterministic
            elif self.llm_provider is not None:
                provider_used = self.llm_provider.provider_name
                try:
                    policy = PolicyInterpreterAgent(self.llm_provider, self.settings.llm_model).interpret(
                        instruction, available,
                        session.policy_proposal.policy if session.policy_proposal else None,
                    )
                except PolicyProviderUnavailable as exc:
                    provider_error = str(exc)
                    policy = ReconciliationPolicy(
                        name="Manual reconciliation policy", rules=[],
                        proposed_by=ProposedBy.HUMAN,
                        natural_language_instruction=instruction,
                        explanation="AI generation failed. Build and validate the policy manually.",
                    )
            else:
                provider_error = "No AI provider is configured and the instruction was not safely deterministic. Build the policy manually."
                policy = ReconciliationPolicy(
                    name="Manual reconciliation policy", rules=[], proposed_by=ProposedBy.HUMAN,
                    natural_language_instruction=instruction,
                    explanation="The instruction needs clarification or manual structured rules.",
                )
        else:
            policy = default_policy()
        previous_revision = session.policy_proposal.policy.revision if session.policy_proposal else 0
        policy = policy.model_copy(update={
            "revision": previous_revision + 1,
            "status": PolicyStatus.AWAITING_APPROVAL,
            "updated_at": utc_now(),
        })
        validation = self.policy_validator.validate(policy, session.confirmed_mapping)
        proposal = NaturalLanguagePolicyProposal(
            reconciliation_id=reconciliation_id, policy=policy, validation=validation,
            ai_provider_used=provider_used,
            ai_model_used=self.settings.llm_model if provider_used else None,
            provider_error=provider_error,
        )
        self.repository.save_policy_proposal(reconciliation_id, proposal, workflow_thread_id)
        duration_ms = round((perf_counter() - started) * 1000, 2)
        self.repository.add_event(AgentEvent(
            event_type="policy.proposal.completed", reconciliation_id=reconciliation_id,
            actor_type=ActorType.AGENT if provider_used else ActorType.SYSTEM,
            component="policy_interpreter", output_count=len(policy.rules),
            result="provider_failed" if provider_error else "completed",
            metadata={"duration_ms": duration_ms, "structured_output_success": provider_error is None},
            model_provider=provider_used, model_name=self.settings.llm_model if provider_used else None,
        ))
        self._audit_policy_validation(reconciliation_id, validation)
        self.repository.add_event(AgentEvent(
            event_type="policy.approval_required", reconciliation_id=reconciliation_id,
            actor_type=ActorType.SYSTEM, component="policy_workflow", result="paused",
            approval_status="pending",
        ))
        return proposal

    def _audit_policy_validation(self, reconciliation_id: UUID, validation: PolicyValidationResult) -> None:
        self.repository.add_event(AgentEvent(
            event_type="policy.validation.completed", reconciliation_id=reconciliation_id,
            actor_type=ActorType.SYSTEM, component="policy_validator",
            output_count=len(validation.issues), result="valid" if validation.valid else "invalid",
            metadata={"error_count": len(validation.issues)},
        ))

    def get_policy(self, reconciliation_id: UUID) -> NaturalLanguagePolicyProposal:
        session = self.get(reconciliation_id)
        if session.policy_proposal is None:
            raise ReconciliationNotReadyError("A reconciliation policy has not been proposed")
        return session.policy_proposal

    def edit_policy(self, reconciliation_id: UUID, decision: HumanPolicyDecision) -> NaturalLanguagePolicyProposal:
        session = self.get(reconciliation_id)
        if session.confirmed_mapping is None or session.policy_workflow_thread_id is None:
            raise ReconciliationNotReadyError("A policy approval checkpoint does not exist")
        previous = session.policy_proposal.policy if session.policy_proposal else None
        changed = previous is None or any(
            getattr(previous, field) != getattr(decision.policy, field)
            for field in ("name", "rules", "natural_language_instruction")
        )
        policy = decision.policy.model_copy(update={
            "id": previous.id if previous else decision.policy.id,
            "revision": (previous.revision + 1) if previous and changed else decision.policy.revision,
            "status": PolicyStatus.AWAITING_APPROVAL,
            "proposed_by": ProposedBy.HUMAN if changed else decision.policy.proposed_by,
            "updated_at": utc_now(),
            "confirmed_at": None,
        })
        validation = self.policy_validator.validate(policy, session.confirmed_mapping)
        proposal = NaturalLanguagePolicyProposal(
            reconciliation_id=reconciliation_id, policy=policy, validation=validation,
            ai_provider_used=previous and session.policy_proposal.ai_provider_used,
            ai_model_used=previous and session.policy_proposal.ai_model_used,
        )
        self.repository.save_policy_proposal(reconciliation_id, proposal, session.policy_workflow_thread_id)
        if changed:
            self.repository.add_event(AgentEvent(
                event_type="policy.user_edited", reconciliation_id=reconciliation_id,
                actor_type=ActorType.USER, component="policy_builder",
                input_count=len(policy.rules), output_count=len(policy.rules), result="saved",
                metadata={"revision": policy.revision},
            ))
        self._audit_policy_validation(reconciliation_id, validation)
        return proposal

    def validate_policy(self, reconciliation_id: UUID) -> PolicyValidationResult:
        session = self.get(reconciliation_id)
        if session.policy_proposal is None or session.confirmed_mapping is None:
            raise ReconciliationNotReadyError("A draft policy and confirmed mapping are required")
        validation = self.policy_validator.validate(session.policy_proposal.policy, session.confirmed_mapping)
        self._audit_policy_validation(reconciliation_id, validation)
        return validation

    def confirm_policy(self, reconciliation_id: UUID) -> ReconciliationPolicy:
        session = self.get(reconciliation_id)
        if session.policy_proposal is None or session.confirmed_mapping is None:
            raise ReconciliationNotReadyError("A draft policy and confirmed mapping are required")
        validation = self.policy_validator.validate(session.policy_proposal.policy, session.confirmed_mapping)
        self._audit_policy_validation(reconciliation_id, validation)
        if not validation.valid:
            raise PolicyInvalidError(validation)
        now = utc_now()
        policy = session.policy_proposal.policy.model_copy(update={
            "status": PolicyStatus.CONFIRMED, "confirmed_at": now, "updated_at": now,
        })
        self.repository.save_confirmed_policy(reconciliation_id, policy)
        self.repository.add_event(AgentEvent(
            event_type="policy.confirmed", reconciliation_id=reconciliation_id,
            actor_type=ActorType.USER, component="policy_workflow", result="confirmed",
            approval_status="approved", metadata={"revision": policy.revision},
        ))
        return policy

    def run_tolerance_match(self, reconciliation_id: UUID) -> ToleranceReconciliationSummary:
        session = self.get(reconciliation_id)
        if session.confirmed_mapping is None:
            raise ReconciliationNotReadyError("Schema mapping must be confirmed before tolerance matching")
        if session.confirmed_policy is None or session.confirmed_policy.status != PolicyStatus.CONFIRMED:
            raise ReconciliationNotReadyError("A valid policy must be explicitly confirmed before tolerance matching")
        if session.summary is None:
            raise ReconciliationNotReadyError("Exact matching must complete before tolerance matching")
        validation = self.policy_validator.validate(session.confirmed_policy, session.confirmed_mapping)
        if not validation.valid:
            raise PolicyInvalidError(validation)
        exact_matches = [item for item in self.repository.list_match_results(reconciliation_id) if item.match_type == "exact"]
        if len(exact_matches) != session.summary.exact_matches:
            raise ReconciliationNotReadyError("Persisted exact-match results are incomplete")
        self.repository.add_event(AgentEvent(
            event_type="tolerance_match.started", reconciliation_id=reconciliation_id,
            actor_type=ActorType.SYSTEM, component="tolerance_match_engine",
            input_count=session.summary.remaining_government_records + session.summary.remaining_purchase_register_records,
            result="started", metadata={"policy_revision": session.confirmed_policy.revision},
        ))
        government = self.parser.parse(Path(session.government_file.stored_path), DatasetRole.GOVERNMENT)  # type: ignore[union-attr]
        purchase = self.parser.parse(Path(session.purchase_register_file.stored_path), DatasetRole.PURCHASE_REGISTER)  # type: ignore[union-attr]
        matches, conflicts = self.tolerance_engine.match(
            government.dataframe, purchase.dataframe, session.confirmed_mapping,
            session.confirmed_policy, exact_matches,
        )
        resolved = len(exact_matches) + len(matches)
        summary = ToleranceReconciliationSummary(
            reconciliation_id=reconciliation_id, status=SessionStatus.COMPLETED,
            government_records=government.profile.row_count,
            purchase_register_records=purchase.profile.row_count,
            exact_matches=len(exact_matches), tolerance_matches=len(matches),
            resolved_records=resolved,
            remaining_government_records=government.profile.row_count - resolved,
            remaining_purchase_register_records=purchase.profile.row_count - resolved,
            conflict_count=len(conflicts),
        )
        self.repository.save_tolerance_results(reconciliation_id, matches, conflicts, summary)
        for conflict in conflicts:
            self.repository.add_event(AgentEvent(
                event_type="tolerance_match.conflict_detected", reconciliation_id=reconciliation_id,
                actor_type=ActorType.SYSTEM, component="tolerance_match_engine",
                input_count=len(conflict.purchase_register_record_ids), result="manual_review",
                metadata={"government_record_id": conflict.government_record_id,
                          "candidate_count": len(conflict.purchase_register_record_ids)},
            ))
        self.repository.add_event(AgentEvent(
            event_type="tolerance_match.completed", reconciliation_id=reconciliation_id,
            actor_type=ActorType.SYSTEM, component="tolerance_match_engine",
            input_count=session.summary.remaining_government_records + session.summary.remaining_purchase_register_records,
            output_count=len(matches), result="completed",
            metadata={"one_to_one": True, "conflict_count": len(conflicts),
                      "policy_revision": session.confirmed_policy.revision},
        ))
        return summary

    def analyze_near_matches(
        self,
        reconciliation_id: UUID,
        workflow_thread_id: str,
        thresholds: MatchingThresholds | None = None,
    ) -> NearMatchAnalysis:
        session = self.get(reconciliation_id)
        existing_near_matches = [
            item for item in self.repository.list_match_results(reconciliation_id)
            if item.match_type == "near"
        ]
        if session.near_match_analysis is not None and existing_near_matches:
            # An explicit approval is durable. Re-opening or retrying analysis must
            # never replace approved candidates with a fresh proposal set.
            return session.near_match_analysis
        if session.confirmed_mapping is None or session.confirmed_policy is None:
            raise ReconciliationNotReadyError("Confirmed mapping and policy are required for near matching")
        if session.tolerance_summary is None:
            raise ReconciliationNotReadyError("Tolerance matching must complete before near matching")
        previous_matches = [
            item for item in self.repository.list_match_results(reconciliation_id)
            if item.match_type in {"exact", "tolerance"}
        ]
        expected = session.tolerance_summary.exact_matches + session.tolerance_summary.tolerance_matches
        if len(previous_matches) != expected:
            raise ReconciliationNotReadyError("Persisted exact and tolerance results are incomplete")
        engine = NearMatchEngine(thresholds or MatchingThresholds())
        self.repository.update_status(reconciliation_id, SessionStatus.ANALYZING_NEAR_MATCHES)
        self.repository.add_event(AgentEvent(
            event_type="near_match.analysis_started", reconciliation_id=reconciliation_id,
            actor_type=ActorType.SYSTEM, component="near_match_engine", result="started",
            input_count=(session.tolerance_summary.remaining_government_records +
                         session.tolerance_summary.remaining_purchase_register_records),
        ))
        government = self.parser.parse(
            Path(session.government_file.stored_path), DatasetRole.GOVERNMENT  # type: ignore[union-attr]
        )
        purchase = self.parser.parse(
            Path(session.purchase_register_file.stored_path), DatasetRole.PURCHASE_REGISTER  # type: ignore[union-attr]
        )
        analysis = engine.analyze(
            reconciliation_id, government.dataframe, purchase.dataframe,
            session.confirmed_mapping, previous_matches,
        )
        analysis = analysis.model_copy(update={
            "policy_revision": session.confirmed_policy.revision,
            "client_profile_id": session.client_profile_id,
            "profile_version": session.profile_version,
        })
        summary = self._near_summary(session, analysis, [])
        self.repository.save_near_analysis(reconciliation_id, analysis, workflow_thread_id, summary)
        common_metadata = {
            "thresholds": analysis.thresholds.model_dump(mode="json"),
            "runtime_ms": analysis.summary.runtime_ms,
        }
        for event_type, output_count, result in (
            ("candidate_generation.completed", analysis.summary.candidate_count, "completed"),
            ("candidate_scoring.completed", analysis.summary.candidate_count, "ranked"),
            ("near_match.proposals_created", analysis.summary.high_confidence_proposals, "approval_required"),
            ("near_match.ambiguity_detected", analysis.summary.ambiguous_government_records, "manual_review"),
            ("near_match.approval_required", analysis.summary.high_confidence_proposals, "paused"),
        ):
            self.repository.add_event(AgentEvent(
                event_type=event_type, reconciliation_id=reconciliation_id,
                actor_type=ActorType.SYSTEM, component="near_match_engine",
                output_count=output_count, result=result, metadata=common_metadata,
            ))
        return analysis

    def get_near_analysis(self, reconciliation_id: UUID) -> NearMatchAnalysis:
        session = self.get(reconciliation_id)
        if session.near_match_analysis is None:
            raise ReconciliationNotReadyError("Near-match analysis has not completed")
        return session.near_match_analysis

    @staticmethod
    def _candidate_match(candidate: CandidateMatch, policy_revision: int | None) -> MatchResult:
        features = candidate.features
        return MatchResult(
            government_record_id=candidate.government_record_id,
            purchase_register_record_id=candidate.purchase_register_record_id,
            match_type="near",
            matched_fields=["gstin", "document_number", "document_date", "document_type",
                            "taxable_value", "gst_rate", "igst", "cgst", "sgst", "cess"],
            variances={
                "document_number_similarity": round(features.document_number_similarity, 6),
                "document_date_days": float(features.document_date_difference_days),
                "taxable_value": float(features.taxable_value_difference),
                "igst": float(features.igst_difference), "cgst": float(features.cgst_difference),
                "sgst": float(features.sgst_difference), "cess": float(features.cess_difference),
            },
            allowed_tolerances={"near_match_score": candidate.match_score},
            rules_satisfied=candidate.reasons,
            government_values=candidate.government_values,
            purchase_register_values=candidate.purchase_register_values,
            policy_revision=policy_revision,
        )

    def _near_summary(
        self, session: ReconciliationSession, analysis: NearMatchAnalysis,
        near_matches: list[MatchResult],
    ) -> NearMatchReconciliationSummary:
        tolerance = session.tolerance_summary
        if tolerance is None:
            raise ReconciliationNotReadyError("Tolerance summary is unavailable")
        pending = sum(item.status == CandidateStatus.NEAR_MATCH_PROPOSED for item in analysis.candidates)
        resolved = tolerance.resolved_records + len(near_matches)
        return NearMatchReconciliationSummary(
            reconciliation_id=session.id,
            status=(SessionStatus.AWAITING_NEAR_MATCH_APPROVAL if pending else SessionStatus.COMPLETED),
            government_records=tolerance.government_records,
            purchase_register_records=tolerance.purchase_register_records,
            exact_matches=tolerance.exact_matches,
            tolerance_matches=tolerance.tolerance_matches,
            near_match_proposals=pending,
            near_matches=len(near_matches),
            ambiguous_records=analysis.summary.ambiguous_government_records,
            material_mismatch_records=analysis.summary.material_mismatch_records,
            gst_only_records=analysis.summary.gst_only_records,
            pr_only_records=analysis.summary.pr_only_records,
            resolved_records=resolved,
            remaining_government_records=tolerance.government_records - resolved,
            remaining_purchase_register_records=tolerance.purchase_register_records - resolved,
        )

    def _save_near_decisions(
        self, session: ReconciliationSession, analysis: NearMatchAnalysis,
    ) -> NearMatchReconciliationSummary:
        approved = [
            self._candidate_match(item, session.confirmed_policy.revision if session.confirmed_policy else None)
            for item in analysis.candidates if item.status == CandidateStatus.NEAR_MATCH_APPROVED
        ]
        summary = self._near_summary(session, analysis, approved)
        self.repository.save_near_state(session.id, analysis, approved, summary)
        return summary

    def decide_near_candidate(
        self, reconciliation_id: UUID, candidate_id: UUID, action: NearMatchDecisionAction,
    ) -> NearMatchReconciliationSummary:
        with self._near_approval_lock:
            return self._decide_near_candidate(reconciliation_id, candidate_id, action)

    def _decide_near_candidate(
        self, reconciliation_id: UUID, candidate_id: UUID, action: NearMatchDecisionAction,
    ) -> NearMatchReconciliationSummary:
        session = self.get(reconciliation_id)
        analysis = self.get_near_analysis(reconciliation_id)
        candidate = next((item for item in analysis.candidates if item.id == candidate_id), None)
        if candidate is None:
            raise ReconciliationNotReadyError("Near-match candidate was not found")
        if candidate.status != CandidateStatus.NEAR_MATCH_PROPOSED:
            raise ReconciliationNotReadyError("Only pending safe proposals can be approved or rejected")
        if action == NearMatchDecisionAction.APPROVE:
            if not candidate.eligible_for_bulk_approval or not candidate.reciprocal_best:
                raise ReconciliationNotReadyError("Candidate is no longer eligible for approval")
            consumed_government = {
                item.government_record_id for item in self.repository.list_match_results(reconciliation_id)
            }
            consumed_purchase = {
                item.purchase_register_record_id for item in self.repository.list_match_results(reconciliation_id)
            }
            if candidate.government_record_id in consumed_government or candidate.purchase_register_record_id in consumed_purchase:
                raise ReconciliationNotReadyError("Approval would consume an already matched record")
            candidate.status = CandidateStatus.NEAR_MATCH_APPROVED
            event_type, result = "near_match.approved", "approved"
        else:
            candidate.status = CandidateStatus.REJECTED_CANDIDATE
            candidate.eligible_for_bulk_approval = False
            event_type, result = "near_match.rejected", "rejected"
        summary = self._save_near_decisions(session, analysis)
        self.repository.add_event(AgentEvent(
            event_type=event_type, reconciliation_id=reconciliation_id,
            actor_type=ActorType.USER, component="near_match_approval",
            result=result, approval_status=result,
            metadata={"candidate_id": str(candidate.id), "government_record_id": candidate.government_record_id,
                      "purchase_register_record_id": candidate.purchase_register_record_id,
                      "match_score": candidate.match_score},
        ))
        return summary

    @staticmethod
    def _bulk_totals(summary: NearMatchReconciliationSummary) -> NearMatchBulkApprovalTotals:
        return NearMatchBulkApprovalTotals(
            resolved_records=summary.resolved_records,
            government_open=summary.remaining_government_records,
            purchase_register_remaining=summary.remaining_purchase_register_records,
        )

    def bulk_approve_near_matches(self, reconciliation_id: UUID) -> NearMatchBulkApprovalResult:
        """Revalidate persisted proposals, then persist valid approvals atomically."""
        with self._near_approval_lock:
            session = self.get(reconciliation_id)
            analysis = self.get_near_analysis(reconciliation_id)
            if session.confirmed_mapping is None or session.confirmed_policy is None:
                raise ReconciliationNotReadyError("Confirmed mapping and policy are required")

            requested_candidates = sorted(
                (item for item in analysis.candidates
                 if item.status == CandidateStatus.NEAR_MATCH_PROPOSED),
                key=lambda item: (-item.match_score, item.government_record_id),
            )
            existing = self.repository.list_match_results(reconciliation_id)
            existing_near = [item for item in existing if item.match_type == "near"]
            before_summary = session.near_match_summary or self._near_summary(session, analysis, existing_near)
            consumed_government = {item.government_record_id for item in existing}
            consumed_purchase = {item.purchase_register_record_id for item in existing}
            batch_id = uuid4()

            global_reasons: list[tuple[str, str]] = []
            if session.status not in {
                SessionStatus.AWAITING_NEAR_MATCH_APPROVAL, SessionStatus.COMPLETED,
            }:
                global_reasons.append(("reconciliation_state_stale", "The reconciliation is not in a current near-match review state."))
            # Analyses created before this field was introduced are still safe to
            # revalidate because policy edits move the session out of near review.
            if (analysis.policy_revision is not None and
                    analysis.policy_revision != session.confirmed_policy.revision):
                global_reasons.append(("policy_version_mismatch", "The approved policy changed after this proposal was generated."))
            analysis_has_profile_snapshot = (
                analysis.client_profile_id is not None or analysis.profile_version is not None
            )
            if (analysis_has_profile_snapshot and
                    (analysis.client_profile_id != session.client_profile_id or
                     analysis.profile_version != session.profile_version)):
                global_reasons.append(("profile_version_mismatch", "The attached client profile changed after this proposal was generated."))
            elif session.client_profile_id is not None and not analysis_has_profile_snapshot:
                global_reasons.append(("profile_snapshot_missing", "This proposal predates the attached client profile snapshot and must be regenerated."))
            if session.client_profile_id is not None:
                current_profile = self.repository.get_client_profile(session.client_profile_id)
                if current_profile is None or current_profile.version != session.profile_version:
                    global_reasons.append(("profile_not_current", "The reconciliation is not using the current client profile version."))

            # Upload, mapping, and policy changes clear the persisted near-match
            # snapshot. When those versions still match, re-running the full engine
            # here is redundant and makes a human approval unnecessarily slow.
            fresh_pairs = {
                (item.government_record_id, item.purchase_register_record_id): item
                for item in requested_candidates
            } if not global_reasons else {}
            decisions = [
                event for event in self.repository.list_events(reconciliation_id, limit=100000)
                if event.event_type in {"near_match.approved", "near_match.rejected"}
            ]
            decision_events = {str(event.metadata.get("candidate_id")) for event in decisions}
            approved_pairs = {
                (str(event.metadata.get("government_record_id")),
                 str(event.metadata.get("purchase_register_record_id")))
                for event in decisions if event.event_type == "near_match.approved"
                and event.metadata.get("government_record_id")
                and event.metadata.get("purchase_register_record_id")
            }
            rejected_pairs = {
                (str(event.metadata.get("government_record_id")),
                 str(event.metadata.get("purchase_register_record_id")))
                for event in decisions if event.event_type == "near_match.rejected"
                and event.metadata.get("government_record_id")
                and event.metadata.get("purchase_register_record_id")
            }
            ambiguity_government = {
                item.government_record_id for item in analysis.ambiguities
            }
            approved_candidates: list[CandidateMatch] = []
            restored_candidates: list[CandidateMatch] = []
            skip_reasons: list[NearMatchBulkSkipReason] = []

            def skip(candidate: CandidateMatch, code: str, message: str) -> None:
                skip_reasons.append(NearMatchBulkSkipReason(
                    candidate_id=candidate.id,
                    government_record_id=candidate.government_record_id,
                    purchase_register_record_id=candidate.purchase_register_record_id,
                    code=code,
                    message=message,
                ))

            batch_government: set[str] = set()
            batch_purchase: set[str] = set()
            for candidate in requested_candidates:
                pair = (candidate.government_record_id, candidate.purchase_register_record_id)
                if global_reasons:
                    skip(candidate, *global_reasons[0])
                    continue
                if pair in approved_pairs and pair not in rejected_pairs:
                    candidate.status = CandidateStatus.NEAR_MATCH_APPROVED
                    candidate.eligible_for_bulk_approval = False
                    approved_candidates.append(candidate)
                    restored_candidates.append(candidate)
                    batch_government.add(candidate.government_record_id)
                    batch_purchase.add(candidate.purchase_register_record_id)
                    continue
                if str(candidate.id) in decision_events:
                    skip(candidate, "conflicting_human_decision", "A human decision already exists for this proposal.")
                    continue
                if candidate.government_record_id in ambiguity_government:
                    skip(candidate, "ambiguity_present", "The Government record is in the ambiguous review queue.")
                    continue
                if candidate.government_record_id in consumed_government:
                    skip(candidate, "government_record_consumed", "The Government record is already resolved.")
                    continue
                if candidate.purchase_register_record_id in consumed_purchase:
                    skip(candidate, "purchase_record_consumed", "The Purchase Register record is already consumed.")
                    continue
                if not candidate.eligible_for_bulk_approval:
                    skip(candidate, "eligibility_flag_changed", "The proposal is no longer marked safe for bulk approval.")
                    continue
                if candidate.match_score < analysis.thresholds.near_match_threshold:
                    skip(candidate, "threshold_not_met", "The proposal no longer meets the current near-match threshold.")
                    continue
                if not candidate.reciprocal_best:
                    skip(candidate, "reciprocal_uniqueness_failed", "The pair is no longer reciprocal-best and unique.")
                    continue
                if candidate.score_gap is None or candidate.score_gap + 1e-12 < analysis.thresholds.ambiguity_margin:
                    skip(candidate, "score_gap_not_met", "The candidate score gap no longer meets the ambiguity safeguard.")
                    continue
                pair = (candidate.government_record_id, candidate.purchase_register_record_id)
                if pair not in fresh_pairs:
                    skip(candidate, "stale_proposal", "The pair is not present in the current persisted proposal snapshot.")
                    continue
                if (candidate.government_record_id in batch_government or
                        candidate.purchase_register_record_id in batch_purchase):
                    skip(candidate, "duplicate_batch_consumption", "Another eligible pair in this batch already uses one of these records.")
                    continue
                candidate.status = CandidateStatus.NEAR_MATCH_APPROVED
                approved_candidates.append(candidate)
                batch_government.add(candidate.government_record_id)
                batch_purchase.add(candidate.purchase_register_record_id)

            candidate_near = [
                self._candidate_match(item, session.confirmed_policy.revision)
                for item in analysis.candidates
                if item.status == CandidateStatus.NEAR_MATCH_APPROVED
            ]
            existing_pairs = {
                (item.government_record_id, item.purchase_register_record_id)
                for item in existing_near
            }
            all_near = [*existing_near, *(
                item for item in candidate_near
                if (item.government_record_id, item.purchase_register_record_id) not in existing_pairs
            )]
            summary = self._near_summary(session, analysis, all_near)
            all_pairs = existing + [item for item in all_near
                                    if item.government_record_id not in consumed_government]
            duplicate_pr_consumption = len(all_pairs) - len({item.purchase_register_record_id for item in all_pairs})
            restored_ids = {item.id for item in restored_candidates}
            pair_events = [AgentEvent(
                event_type="near_match.approved", reconciliation_id=reconciliation_id,
                actor_type=ActorType.USER, component="near_match_bulk_approval",
                result="approved", approval_status="human_approved",
                metadata={
                    "batch_id": str(batch_id), "candidate_id": str(candidate.id),
                    "government_record_id": candidate.government_record_id,
                    "purchase_register_record_id": candidate.purchase_register_record_id,
                    "match_score": candidate.match_score,
                    "approval_mode": "human_bulk_approval",
                },
            ) for candidate in approved_candidates if candidate.id not in restored_ids]
            batch_event = AgentEvent(
                event_type="NEAR_MATCH_BULK_APPROVAL", reconciliation_id=reconciliation_id,
                actor_type=ActorType.USER, component="near_match_bulk_approval",
                input_count=len(requested_candidates), output_count=len(approved_candidates),
                result=("no_changes" if not requested_candidates else
                        "approved" if not skip_reasons else "partially_approved"),
                approval_status="human_approved",
                metadata={
                    "batch_id": str(batch_id), "actor": "local_user",
                    "requested": len(requested_candidates), "approved": len(approved_candidates),
                    "restored_from_audit": len(restored_candidates),
                    "skipped": len(skip_reasons), "failed": 0,
                    "policy_revision": session.confirmed_policy.revision,
                    "client_profile_id": str(session.client_profile_id) if session.client_profile_id else None,
                    "profile_version": session.profile_version,
                    "revalidation": {
                        "source_state_current": not bool(global_reasons),
                        "records_unconsumed": not any(item.code in {
                            "government_record_consumed", "purchase_record_consumed",
                        } for item in skip_reasons),
                        "threshold_checked": True,
                        "reciprocal_uniqueness_checked": True, "score_gap_checked": True,
                        "ambiguity_checked": True, "duplicate_pr_consumption": duplicate_pr_consumption,
                    },
                    "skip_reasons": [item.model_dump(mode="json") for item in skip_reasons],
                },
            )
            self.repository.save_near_bulk_approval(
                reconciliation_id, analysis, all_near, summary, [*pair_events, batch_event]
            )
            return NearMatchBulkApprovalResult(
                batch_id=batch_id, reconciliation_id=reconciliation_id,
                requested=len(requested_candidates), approved=len(approved_candidates),
                skipped=len(skip_reasons), failed=0, skip_reasons=skip_reasons,
                before=self._bulk_totals(before_summary), after=self._bulk_totals(summary),
                duplicate_pr_consumption=duplicate_pr_consumption,
                policy_revision=session.confirmed_policy.revision,
                client_profile_id=session.client_profile_id, profile_version=session.profile_version,
                summary=summary,
            )

    def get_results(self, reconciliation_id: UUID, result_status: str | None = None) -> ReconciliationResults:
        session = self.get(reconciliation_id)
        if session.tolerance_summary is None or session.confirmed_mapping is None:
            raise ReconciliationNotReadyError("Tolerance reconciliation has not completed")
        matches = self.repository.list_match_results(reconciliation_id)
        status_by_type = {"exact": "EXACT_MATCHED", "tolerance": "TOLERANCE_MATCHED",
                          "near": "NEAR_MATCHED", "human_selected": "HUMAN_SELECTED"}
        records = [ReconciliationResultItem(
            status=status_by_type[item.match_type],
            government_record_id=item.government_record_id,
            purchase_register_record_id=item.purchase_register_record_id,
            match=item,
        ) for item in matches if result_status is None or (
            result_status == status_by_type[item.match_type]
        )]
        analysis = session.near_match_analysis
        if analysis is not None:
            if result_status in {None, "NEAR_MATCH_PROPOSED"}:
                records.extend(ReconciliationResultItem(
                    status="NEAR_MATCH_PROPOSED",
                    government_record_id=item.government_record_id,
                    purchase_register_record_id=item.purchase_register_record_id,
                ) for item in analysis.candidates if item.status == CandidateStatus.NEAR_MATCH_PROPOSED)
            if result_status in {None, "AMBIGUOUS"}:
                records.extend(ReconciliationResultItem(
                    status="AMBIGUOUS", government_record_id=item.government_record_id,
                ) for item in analysis.ambiguities)
            classifications = (
                ("MATERIAL_MISMATCH", analysis.material_mismatch_government_ids, "government"),
                ("GST_ONLY", analysis.gst_only_government_ids, "government"),
                ("PR_ONLY", analysis.pr_only_purchase_register_ids, "purchase"),
            )
            for status, identifiers, side in classifications:
                if result_status in {None, status}:
                    records.extend(ReconciliationResultItem(
                        status=status,
                        government_record_id=identifier if side == "government" else None,
                        purchase_register_record_id=identifier if side == "purchase" else None,
                    ) for identifier in identifiers)
        if result_status not in {None, "UNRESOLVED"}:
            return ReconciliationResults(summary=session.near_match_summary or session.tolerance_summary, records=records,
                                         conflicts=self.repository.list_conflicts(reconciliation_id))
        mappings = self._exact_mappings(session.confirmed_mapping)
        government = self.parser.parse(Path(session.government_file.stored_path), DatasetRole.GOVERNMENT).dataframe  # type: ignore[union-attr]
        purchase = self.parser.parse(Path(session.purchase_register_file.stored_path), DatasetRole.PURCHASE_REGISTER).dataframe  # type: ignore[union-attr]
        matched_gov = {item.government_record_id for item in matches}
        matched_pr = {item.purchase_register_record_id for item in matches}
        unresolved_records = [ReconciliationResultItem(status="UNRESOLVED", government_record_id=str(value).strip())
                       for value in government[mappings[DatasetRole.GOVERNMENT]["record_id"]]
                       if str(value).strip() not in matched_gov]
        unresolved_records.extend(ReconciliationResultItem(status="UNRESOLVED", purchase_register_record_id=str(value).strip())
                       for value in purchase[mappings[DatasetRole.PURCHASE_REGISTER]["record_id"]]
                       if str(value).strip() not in matched_pr)
        if result_status in {None, "UNRESOLVED"}:
            records.extend(unresolved_records)
        return ReconciliationResults(summary=session.near_match_summary or session.tolerance_summary, records=records,
                                     conflicts=self.repository.list_conflicts(reconciliation_id))
