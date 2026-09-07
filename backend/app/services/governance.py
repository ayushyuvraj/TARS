from __future__ import annotations

from copy import deepcopy
from uuid import UUID

from app.domain.models import (
    ActorType, AgentEvent, ApprovalMetadata, CandidateStatus, ClientProfile,
    CompatibilityStatus, PatternDisposition, PatternEvidence, PatternSuggestion,
    DatasetMappingProposal, MappingValidationResult, ProfileCompatibility,
    ProfileCreateRequest, ReusableRuleVersion, RuleAction, SchemaMappingProposal,
    RuleCondition, RuleCreateRequest, RuleDecisionRequest, RuleProvenance,
    RuleExecution, RuleProvenanceType, RuleSimulation, RuleStatus, RuleType, utc_now,
)
from app.services.reconciliation import ReconciliationNotReadyError, ReconciliationService


class GovernanceError(RuntimeError):
    pass


class GovernanceService:
    """Deterministic profile, pattern, rule-version, and approval governance."""

    minimum_observations = 5
    minimum_acceptance_ratio = .8

    def __init__(self, reconciliation: ReconciliationService) -> None:
        self.reconciliation = reconciliation
        self.repository = reconciliation.repository

    def _event(self, reconciliation_id: UUID, event_type: str, component: str, **metadata) -> None:
        self.repository.add_event(AgentEvent(
            event_type=event_type, reconciliation_id=reconciliation_id,
            actor_type=ActorType.USER if metadata.pop("human", False) else ActorType.SYSTEM,
            component=component, result=metadata.pop("result", "completed"), metadata=metadata,
        ))

    def create_profile(self, reconciliation_id: UUID, request: ProfileCreateRequest) -> ClientProfile:
        session = self.reconciliation.get(reconciliation_id)
        if not session.confirmed_mapping or not session.confirmed_policy:
            raise ReconciliationNotReadyError("Confirmed mapping and policy are required")
        profile = ClientProfile(
            client_name=request.client_name, profile_name=request.profile_name,
            saved_mapping=session.confirmed_mapping, saved_policy=session.confirmed_policy,
            created_from_reconciliation_id=reconciliation_id, approved_by=request.approved_by,
        )
        self.repository.save_client_profile(profile)  # type: ignore[attr-defined]
        self.repository.attach_profile(reconciliation_id, profile.id, profile.version)  # type: ignore[attr-defined]
        self._event(reconciliation_id, "profile.created", "profile_service", human=True,
                    profile_id=str(profile.id), profile_version=1)
        return profile

    def list_profiles(self) -> list[ClientProfile]:
        return self.repository.list_client_profiles()  # type: ignore[attr-defined]

    def get_profile(self, profile_id: UUID) -> ClientProfile:
        profile = self.repository.get_client_profile(profile_id)  # type: ignore[attr-defined]
        if not profile:
            raise GovernanceError("Client profile not found")
        profile.active_rule_ids = [r.rule_id for r in self.repository.list_active_rules(profile_id)]  # type: ignore[attr-defined]
        return profile

    def create_session_from_profile(self, profile_id: UUID):
        profile = self.get_profile(profile_id)
        session = self.reconciliation.create()
        self.repository.attach_profile(session.id, profile.id, profile.version)  # type: ignore[attr-defined]
        profile.last_used_at, profile.updated_at = utc_now(), utc_now()
        self.repository.save_client_profile(profile)  # type: ignore[attr-defined]
        self._event(session.id, "profile.reused", "profile_service", human=True,
                    profile_id=str(profile.id), profile_version=profile.version,
                    active_rule_ids=profile.active_rule_ids)
        return self.reconciliation.get(session.id)

    def compatibility(self, profile_id: UUID, reconciliation_id: UUID, apply_if_compatible: bool = False) -> ProfileCompatibility:
        profile, session = self.get_profile(profile_id), self.reconciliation.get(reconciliation_id)
        if not session.government_file or not session.purchase_register_file:
            raise ReconciliationNotReadyError("Both new workbooks must be uploaded first")
        available = {
            session.government_file.role: set(session.government_file.profile.columns),
            session.purchase_register_file.role: set(session.purchase_register_file.profile.columns),
        }
        compatible, missing = [], []
        for dataset in profile.saved_mapping.datasets:
            for mapping in dataset.mappings:
                target = compatible if mapping.source_column in available[dataset.source_dataset] else missing
                target.append(mapping.canonical_field or mapping.source_column)
        status = CompatibilityStatus.COMPATIBLE if not missing else (
            CompatibilityStatus.PARTIAL if compatible else CompatibilityStatus.INCOMPATIBLE
        )
        result = ProfileCompatibility(
            profile_id=profile_id, reconciliation_id=reconciliation_id, status=status,
            compatible_fields=sorted(set(compatible)), missing_fields=sorted(set(missing)),
            confirmation_required=bool(missing),
        )
        if apply_if_compatible and status == CompatibilityStatus.COMPATIBLE:
            mapping = profile.saved_mapping.model_copy(deep=True)
            mapping.reconciliation_id = reconciliation_id
            proposal = SchemaMappingProposal(
                reconciliation_id=reconciliation_id,
                datasets=[DatasetMappingProposal.model_validate(item.model_dump()) for item in mapping.datasets],
                validation=MappingValidationResult(valid=True),
            )
            self.repository.save_mapping_proposal(
                reconciliation_id, proposal, f"profile:{profile_id}:v{profile.version}"
            )
            self.repository.save_confirmed_mapping(reconciliation_id, mapping)
            self.repository.save_confirmed_policy(reconciliation_id, profile.saved_policy.model_copy(deep=True))
            self._event(reconciliation_id, "profile.configuration_reused", "profile_service",
                        profile_id=str(profile_id), mapping_reused=True, policy_reused=True,
                        active_rule_ids=profile.active_rule_ids)
        elif apply_if_compatible and session.confirmed_mapping:
            # A human may have repaired and confirmed a partial/incompatible mapping.
            # The saved policy is then safe to reuse without replacing that mapping.
            self.repository.save_confirmed_policy(reconciliation_id, profile.saved_policy.model_copy(deep=True))
            result.confirmation_required = False
            self._event(reconciliation_id, "profile.configuration_reused", "profile_service",
                        profile_id=str(profile_id), mapping_reused=False, policy_reused=True,
                        compatibility_confirmed_by_human=True, active_rule_ids=profile.active_rule_ids)
        self._event(reconciliation_id, "profile.compatibility_checked", "profile_service",
                    profile_id=str(profile_id), compatibility=status.value, missing_fields=result.missing_fields)
        return result

    def detect_patterns(self, reconciliation_id: UUID) -> list[PatternSuggestion]:
        session = self.reconciliation.get(reconciliation_id)
        if not session.near_match_analysis:
            raise ReconciliationNotReadyError("Near-match decisions are required")
        existing = {item.pattern_key: item for item in self.repository.list_pattern_suggestions(reconciliation_id)}  # type: ignore[attr-defined]
        approved = [c for c in session.near_match_analysis.candidates
                    if c.status == CandidateStatus.NEAR_MATCH_APPROVED and c.features.gstin_exact
                    and c.features.document_number_normalized_equal and not c.features.document_number_raw_equal]
        rejected = [c for c in session.near_match_analysis.candidates
                    if c.status == CandidateStatus.REJECTED_CANDIDATE and c.features.document_number_normalized_equal]
        comparable = len(approved) + len(rejected)
        ratio = len(approved) / comparable if comparable else 0
        if len(approved) < self.minimum_observations or ratio < self.minimum_acceptance_ratio:
            return list(existing.values())
        key = "invoice_separator_normalization_v1"
        if key in existing:
            return list(existing.values())
        evidence = [PatternEvidence(record_id=c.government_record_id,
                    counterpart_id=c.purchase_register_record_id,
                    observation=f"{c.features.document_number_government_raw} ↔ {c.features.document_number_purchase_raw}")
                    for c in approved[:30]]
        suggestion = PatternSuggestion(
            reconciliation_id=reconciliation_id, pattern_key=key,
            title="Invoice separator normalization",
            summary=(f"{len(approved)} human-approved near matches had the same GSTIN and equivalent "
                     "invoice numbers after deterministic separator normalization."),
            observation_count=len(approved), acceptance_ratio=ratio, consistency=1.0,
            estimated_impact=len(approved), evidence=evidence,
            suggested_rule=RuleCreateRequest(
                name="Invoice separator normalization",
                description="Propose a near match when GSTIN is exact and invoice numbers differ only by separators.",
                rule_type=RuleType.NORMALIZATION,
                conditions=[RuleCondition(field="gstin", operator="EXACT"),
                            RuleCondition(field="document_number", operator="NORMALIZED_EXACT")],
                action=RuleAction(type="PROPOSE_NEAR_MATCH"),
            ),
        )
        self.repository.save_pattern_suggestion(suggestion)  # type: ignore[attr-defined]
        self._event(reconciliation_id, "pattern.suggestion_created", "pattern_detector",
                    pattern_id=str(suggestion.id), observations=len(approved), acceptance_ratio=ratio)
        return [suggestion, *existing.values()]

    def dismiss_pattern(self, reconciliation_id: UUID, pattern_id: UUID) -> PatternSuggestion:
        pattern = self._pattern(reconciliation_id, pattern_id)
        pattern.disposition = PatternDisposition.DISMISSED
        return self.repository.save_pattern_suggestion(pattern)  # type: ignore[attr-defined]

    def _pattern(self, reconciliation_id: UUID, pattern_id: UUID) -> PatternSuggestion:
        item = next((p for p in self.repository.list_pattern_suggestions(reconciliation_id) if p.id == pattern_id), None)  # type: ignore[attr-defined]
        if not item:
            raise GovernanceError("Pattern suggestion not found")
        return item

    def _next_rule_id(self) -> str:
        numbers = [int(r.rule_id.split("-")[-1]) for r in self.repository.list_rules()  # type: ignore[attr-defined]
                   if r.rule_id.startswith("R-") and r.rule_id.split("-")[-1].isdigit()]
        return f"R-{max(numbers, default=0) + 1:03d}"

    def create_draft(self, profile_id: UUID, definition: RuleCreateRequest,
                     provenance: RuleProvenance | None = None) -> ReusableRuleVersion:
        profile = self.get_profile(profile_id)
        rule = ReusableRuleVersion(
            rule_id=self._next_rule_id(), version=1, client_profile_id=profile_id,
            **definition.model_dump(), provenance=provenance or RuleProvenance(
                type=RuleProvenanceType.MANUALLY_CREATED,
                reconciliation_id=profile.created_from_reconciliation_id,
                summary="Created manually by the POC user.",
            ),
        )
        self._validate(rule)
        self.repository.save_rule_version(rule)  # type: ignore[attr-defined]
        self._event(profile.created_from_reconciliation_id, "rule.draft_created", "rule_governance",
                    human=True, rule_id=rule.rule_id, rule_version=1)
        return rule

    def create_rule_from_pattern(self, reconciliation_id: UUID, pattern_id: UUID, profile_id: UUID) -> ReusableRuleVersion:
        pattern = self._pattern(reconciliation_id, pattern_id)
        if pattern.disposition == PatternDisposition.DISMISSED:
            raise GovernanceError("Dismissed pattern cannot create a rule")
        rule = self.create_draft(profile_id, pattern.suggested_rule, RuleProvenance(
            type=RuleProvenanceType.HUMAN_DECISION_PATTERN, reconciliation_id=reconciliation_id,
            pattern_suggestion_id=pattern.id, decision_count=pattern.observation_count,
            summary=pattern.summary, evidence_ids=[item.record_id for item in pattern.evidence],
        ))
        pattern.disposition = PatternDisposition.CONVERTED_TO_RULE
        self.repository.save_pattern_suggestion(pattern)  # type: ignore[attr-defined]
        return rule

    def _validate(self, rule: ReusableRuleVersion) -> None:
        allowed = {"gstin", "document_number", "taxable_value", "document_date", "igst", "cgst", "sgst", "cess", "narration"}
        errors = [f"Unsupported field {c.field}" for c in rule.conditions if c.field not in allowed]
        errors += [f"{c.operator} requires a value" for c in rule.conditions
                   if c.operator in {"ABSOLUTE_TOLERANCE", "DATE_TOLERANCE", "EQUALS"} and c.value is None]
        if errors:
            raise GovernanceError("; ".join(errors))

    def list_rules(self, profile_id: UUID | None = None) -> list[ReusableRuleVersion]:
        return self.repository.list_rules(profile_id)  # type: ignore[attr-defined]

    def get_rule(self, rule_id: str) -> ReusableRuleVersion:
        rule = self.repository.get_rule(rule_id)  # type: ignore[attr-defined]
        if not rule:
            raise GovernanceError("Rule not found")
        return rule

    def history(self, rule_id: str) -> list[ReusableRuleVersion]:
        return self.repository.list_rule_history(rule_id)  # type: ignore[attr-defined]

    def simulate(self, rule_id: str, reconciliation_id: UUID | None = None) -> RuleSimulation:
        rule = self.get_rule(rule_id)
        rid = reconciliation_id or rule.provenance.reconciliation_id
        if not rid:
            return RuleSimulation(rule_id=rule_id, rule_version=rule.version, activation_blocked=True,
                                  validation_errors=["No historical reconciliation is available"])
        session = self.reconciliation.get(rid)
        candidates = session.near_match_analysis.candidates if session.near_match_analysis else []
        normalized = [c for c in candidates if c.features.gstin_exact and c.features.document_number_normalized_equal]
        approvals = [c for c in normalized if c.status == CandidateStatus.NEAR_MATCH_APPROVED]
        rejected = [c for c in normalized if c.status == CandidateStatus.REJECTED_CANDIDATE]
        ambiguous_ids = {a.government_record_id for a in session.near_match_analysis.ambiguities} if session.near_match_analysis else set()
        ambiguous = sum(c.government_record_id in ambiguous_ids for c in normalized)
        duplicate_pr = len(normalized) - len({c.purchase_register_record_id for c in normalized})
        blocked = bool(rejected or duplicate_pr)
        result = RuleSimulation(
            rule_id=rule_id, rule_version=rule.version, historical_observations=rule.provenance.decision_count,
            would_propose=len(normalized), correct_known_approvals=len(approvals),
            potential_new_cases=max(0, len(normalized)-len(approvals)-len(rejected)), conflicts=len(rejected)+duplicate_pr,
            rejected_decision_collisions=len(rejected), ambiguous_conflicts=ambiguous,
            duplicate_consumption_conflicts=duplicate_pr, activation_blocked=blocked,
            validation_errors=["Known rejected-decision collision"] if rejected else [],
        )
        self._event(rid, "rule.simulated", "rule_governance", rule_id=rule_id,
                    rule_version=rule.version, read_only=True, conflicts=result.conflicts)
        return result

    def approve(self, rule_id: str, decision: RuleDecisionRequest) -> ReusableRuleVersion:
        rule = self.get_rule(rule_id)
        if rule.status not in {RuleStatus.DRAFT, RuleStatus.PROPOSED}:
            raise GovernanceError("Only draft or proposed rules can be approved")
        simulation = self.simulate(rule_id)
        if simulation.activation_blocked:
            raise GovernanceError("Rule approval blocked by known-decision conflicts")
        rule.status = RuleStatus.APPROVED
        rule.approval = ApprovalMetadata(approved_by=decision.actor, note=decision.note)
        self.repository.save_rule_version(rule)  # type: ignore[attr-defined]
        self._event(rule.provenance.reconciliation_id, "rule.approved", "rule_governance", human=True,
                    rule_id=rule_id, rule_version=rule.version, approved_by=decision.actor)
        return rule

    def activate(self, rule_id: str, decision: RuleDecisionRequest) -> ReusableRuleVersion:
        rule = self.get_rule(rule_id)
        if rule.status != RuleStatus.APPROVED:
            raise GovernanceError("Only approved rules can be activated")
        if self.simulate(rule_id).activation_blocked:
            raise GovernanceError("Rule activation blocked by simulation conflicts")
        for prior in self.history(rule_id):
            if prior.version != rule.version and prior.status == RuleStatus.ACTIVE:
                prior.status = RuleStatus.SUPERSEDED
                self.repository.save_rule_version(prior)  # type: ignore[attr-defined]
        rule.status = RuleStatus.ACTIVE
        self.repository.save_rule_version(rule)  # type: ignore[attr-defined]
        self._event(rule.provenance.reconciliation_id, "rule.activated", "rule_governance", human=True,
                    rule_id=rule_id, rule_version=rule.version, actor=decision.actor)
        return rule

    def disable(self, rule_id: str, decision: RuleDecisionRequest) -> ReusableRuleVersion:
        rule = next((item for item in self.history(rule_id) if item.status == RuleStatus.ACTIVE), None)
        if rule is None:
            raise GovernanceError("Only active rules can be disabled")
        rule.status = RuleStatus.DISABLED
        self.repository.save_rule_version(rule)  # type: ignore[attr-defined]
        self._event(rule.provenance.reconciliation_id, "rule.disabled", "rule_governance", human=True,
                    rule_id=rule_id, rule_version=rule.version, actor=decision.actor)
        return rule

    def new_version(self, rule_id: str, definition: RuleCreateRequest) -> ReusableRuleVersion:
        current = self.get_rule(rule_id)
        version = ReusableRuleVersion(
            rule_id=rule_id, version=current.version + 1, client_profile_id=current.client_profile_id,
            **definition.model_dump(), provenance=deepcopy(current.provenance), created_by=current.created_by,
        )
        self._validate(version)
        self.repository.save_rule_version(version)  # type: ignore[attr-defined]
        self._event(current.provenance.reconciliation_id, "rule.version_created", "rule_governance", human=True,
                    rule_id=rule_id, prior_version=current.version, rule_version=version.version)
        return version

    def execute_available_rules(self, reconciliation_id: UUID) -> list[RuleExecution]:
        session = self.reconciliation.get(reconciliation_id)
        if not session.client_profile_id or not session.near_match_analysis:
            return []
        rules = self.repository.list_active_rules(session.client_profile_id)  # type: ignore[attr-defined]
        executions = []
        prior_executions = {(item.rule_id, item.rule_version): item for item in
                            self.repository.list_rule_executions(reconciliation_id)}  # type: ignore[attr-defined]
        for rule in rules:
            if (rule.rule_id, rule.version) in prior_executions:
                executions.append(prior_executions[(rule.rule_id, rule.version)])
                continue
            candidates = session.near_match_analysis.candidates
            triggered = [item for item in candidates if all(
                (condition.field != "gstin" or item.features.gstin_exact) and
                (condition.field != "document_number" or condition.operator != "NORMALIZED_EXACT" or item.features.document_number_normalized_equal)
                for condition in rule.conditions
            )]
            execution = RuleExecution(
                reconciliation_id=reconciliation_id, rule_id=rule.rule_id, rule_version=rule.version,
                records_evaluated=len(candidates), records_affected=len(triggered),
                action_authority=rule.action_authority, automatic_reconciliations=0,
                result="proposals_created" if triggered else "no_trigger",
            )
            self.repository.save_rule_execution(execution)  # type: ignore[attr-defined]
            rule.effectiveness.times_evaluated += len(candidates)
            rule.effectiveness.times_triggered += len(triggered)
            rule.effectiveness.sessions_used += 1
            rule.effectiveness.last_used_at = utc_now()
            self.repository.save_rule_version(rule)  # type: ignore[attr-defined]
            self._event(reconciliation_id, "rule.executed", "rule_engine", rule_id=rule.rule_id,
                        rule_version=rule.version, records_evaluated=len(candidates), records_affected=len(triggered),
                        action_authority=rule.action_authority,
                        automatic_reconciliations=0,
                        result="proposals_created" if triggered else "no_trigger")
            executions.append(execution)
        return executions
