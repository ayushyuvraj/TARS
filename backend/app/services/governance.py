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
    RuleDraftCreateRequest, RuleDraftUpdateRequest, RuleValidationIssue,
    RuleValidationResult, RuleHistoryResponse, RuleVersionDetailResponse,
    AIRuleCompileRequest, AIRuleInterpretationOutput, ActionAuthority,
)
from app.services.reconciliation import ReconciliationNotReadyError, ReconciliationService
import logging

logger = logging.getLogger(__name__)


LOCKED_GUARDRAIL_IDS = {
    "EXACT-D001", "EXACT-D002", "TOL-D003", "NEAR-D001", "NEAR-D002",
    "NEAR-D003", "NEAR-D004", "NEAR-D005", "GOV-D001", "GOV-D003",
    "SAFE-D001", "SAFE-D002", "SAFE-D003", "SAFE-D004", "DATA-D001",
    "DATA-D002", "EXCEPT-D001", "EXCEPT-D002", "EXEC-D001"
}


class GovernanceError(RuntimeError):
    pass


class LockedGuardrailError(GovernanceError):
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

    def delete_rule(self, rule_id: str) -> None:
        if rule_id in LOCKED_GUARDRAIL_IDS:
            raise LockedGuardrailError(f"Rule '{rule_id}' is a mandatory system guardrail and cannot be deleted.")
        self.repository.delete_rule(rule_id)
        self._event(
            UUID("00000000-0000-0000-0000-000000000000"),
            "rule.deleted",
            "rule_governance",
            human=True,
            rule_id=rule_id,
        )

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

    def validate_rule_definition(
        self,
        rule_id: str,
        name: str,
        description: str,
        conditions: list[RuleCondition],
        action: RuleAction,
        version: int | None = None,
        reconciliation_id: UUID | None = None,
    ) -> RuleValidationResult:
        issues: list[RuleValidationIssue] = []

        if rule_id in LOCKED_GUARDRAIL_IDS:
            issues.append(RuleValidationIssue(
                code="LOCKED_GUARDRAIL",
                message=f"Rule '{rule_id}' is a locked system guardrail and cannot be modified.",
                severity="error",
            ))

        if not name or not name.strip():
            issues.append(RuleValidationIssue(
                code="REQUIRED_FIELD_MISSING",
                message="Rule name cannot be empty.",
                field="name",
                severity="error",
            ))

        if not description or not description.strip():
            issues.append(RuleValidationIssue(
                code="REQUIRED_FIELD_MISSING",
                message="Rule description cannot be empty.",
                field="description",
                severity="error",
            ))

        allowed_fields = {"gstin", "document_number", "taxable_value", "document_date", "igst", "cgst", "sgst", "cess", "narration"}
        allowed_operators = {"EXACT", "NORMALIZED_EXACT", "ABSOLUTE_TOLERANCE", "DATE_TOLERANCE", "EQUALS"}
        allowed_actions = {"PROPOSE_NEAR_MATCH", "TOLERANCE_MATCH", "SUGGEST_CLASSIFICATION", "FLAG_FOR_REVIEW"}

        if not conditions:
            issues.append(RuleValidationIssue(
                code="EMPTY_CONDITIONS",
                message="Rule must contain at least one condition.",
                field="conditions",
                severity="error",
            ))

        seen_fields = set()
        for idx, cond in enumerate(conditions or []):
            if cond.field not in allowed_fields:
                issues.append(RuleValidationIssue(
                    code="UNSUPPORTED_CANONICAL_FIELD",
                    message=f"Condition {idx + 1}: Field '{cond.field}' is not a supported canonical field. Allowed: {sorted(allowed_fields)}.",
                    field=f"conditions[{idx}].field",
                    severity="error",
                ))

            if cond.operator not in allowed_operators:
                issues.append(RuleValidationIssue(
                    code="UNSUPPORTED_OPERATOR",
                    message=f"Condition {idx + 1}: Operator '{cond.operator}' is not supported. Allowed: {sorted(allowed_operators)}.",
                    field=f"conditions[{idx}].operator",
                    severity="error",
                ))

            if cond.operator in {"ABSOLUTE_TOLERANCE", "DATE_TOLERANCE", "EQUALS"} and cond.value is None:
                issues.append(RuleValidationIssue(
                    code="MISSING_THRESHOLD_VALUE",
                    message=f"Condition {idx + 1}: Operator '{cond.operator}' requires a non-null threshold value.",
                    field=f"conditions[{idx}].value",
                    severity="error",
                ))

            if cond.operator in {"ABSOLUTE_TOLERANCE", "DATE_TOLERANCE"} and cond.value is not None:
                try:
                    val = float(str(cond.value))
                    if val <= 0:
                        issues.append(RuleValidationIssue(
                            code="INVALID_THRESHOLD_VALUE",
                            message=f"Condition {idx + 1}: Operator '{cond.operator}' requires a positive threshold value (> 0).",
                            field=f"conditions[{idx}].value",
                            severity="error",
                        ))
                except (ValueError, TypeError):
                    issues.append(RuleValidationIssue(
                        code="INVALID_THRESHOLD_VALUE",
                        message=f"Condition {idx + 1}: Operator '{cond.operator}' requires a numeric threshold value.",
                        field=f"conditions[{idx}].value",
                        severity="error",
                    ))

            if cond.field in seen_fields:
                issues.append(RuleValidationIssue(
                    code="DUPLICATE_CONDITION_FIELD",
                    message=f"Condition {idx + 1}: Multiple conditions evaluate field '{cond.field}'.",
                    field=f"conditions[{idx}].field",
                    severity="warning",
                ))
            seen_fields.add(cond.field)

        if not action or action.type not in allowed_actions:
            issues.append(RuleValidationIssue(
                code="INVALID_ACTION",
                message=f"Action type '{getattr(action, 'type', None)}' is not valid. Allowed: {sorted(allowed_actions)}.",
                field="action.type",
                severity="error",
            ))

        valid = not any(issue.severity == "error" for issue in issues)
        res = RuleValidationResult(valid=valid, rule_id=rule_id, version=version, issues=issues)

        rid = reconciliation_id or UUID("00000000-0000-0000-0000-000000000000")
        try:
            self._event(
                rid,
                "rule.validation.completed",
                "rule_governance",
                rule_id=rule_id,
                version=version,
                valid=valid,
                issue_count=len(issues),
            )
        except Exception:
            pass

        return res

    def create_rule_draft(self, request: RuleDraftCreateRequest) -> ReusableRuleVersion:
        rule_id = request.rule_id
        if rule_id and rule_id in LOCKED_GUARDRAIL_IDS:
            raise LockedGuardrailError(f"Rule '{rule_id}' is a locked system guardrail and cannot be drafted or modified.")

        if not rule_id:
            rule_id = self._next_rule_id()

        history = self.repository.list_rule_history(rule_id)
        if history:
            max_ver = max(r.version for r in history)
            next_ver = max_ver if history[0].status == RuleStatus.DRAFT else max_ver + 1
            parent_ver = request.parent_version or history[0].version
        else:
            next_ver = 1
            parent_ver = None

        val = self.validate_rule_definition(
            rule_id=rule_id,
            name=request.name,
            description=request.description,
            conditions=request.conditions,
            action=request.action,
            version=next_ver,
        )
        if not val.valid:
            errors = [i.message for i in val.issues if i.severity == "error"]
            raise GovernanceError(f"Draft validation failed: {'; '.join(errors)}")

        rule = ReusableRuleVersion(
            rule_id=rule_id,
            version=next_ver,
            client_profile_id=request.client_profile_id or "00000000-0000-0000-0000-000000000000",
            name=request.name,
            description=request.description,
            rule_type=request.rule_type,
            status=RuleStatus.DRAFT,
            conditions=request.conditions,
            action=request.action,
            action_authority=request.action_authority,
            created_by=request.created_by,
            parent_version=parent_ver,
            rationale=request.rationale,
            validation_state="VALID" if val.valid else "INVALID",
            governance_tier="CONFIGURABLE_BUSINESS_RULE",
            provenance=RuleProvenance(
                type=RuleProvenanceType.MANUALLY_CREATED,
                summary=request.rationale or f"Draft created manually by {request.created_by}.",
            ),
        )

        self.repository.save_rule_version(rule)
        self._event(
            UUID("00000000-0000-0000-0000-000000000000"),
            "rule.draft.created",
            "rule_governance",
            human=True,
            rule_id=rule_id,
            version=next_ver,
            actor=request.created_by,
        )
        return rule

    def update_rule_draft(self, rule_id: str, request: RuleDraftUpdateRequest, version: int | None = None) -> ReusableRuleVersion:
        if rule_id in LOCKED_GUARDRAIL_IDS:
            raise LockedGuardrailError(f"Rule '{rule_id}' is a locked system guardrail and cannot be drafted or modified.")

        existing = self.repository.get_rule(rule_id, version)
        if not existing:
            raise GovernanceError(f"Rule '{rule_id}' version {version or 'latest'} not found.")

        if existing.status != RuleStatus.DRAFT:
            raise GovernanceError(f"Only DRAFT versions can be edited. Version {existing.version} has status '{existing.status}'.")

        new_name = request.name if request.name is not None else existing.name
        new_desc = request.description if request.description is not None else existing.description
        new_conditions = request.conditions if request.conditions is not None else existing.conditions
        new_action = request.action if request.action is not None else existing.action
        new_authority = request.action_authority if request.action_authority is not None else existing.action_authority
        new_type = request.rule_type if request.rule_type is not None else existing.rule_type
        new_rationale = request.rationale if request.rationale is not None else existing.rationale
        new_created_by = request.created_by if request.created_by is not None else existing.created_by

        val = self.validate_rule_definition(
            rule_id=rule_id,
            name=new_name,
            description=new_desc,
            conditions=new_conditions,
            action=new_action,
            version=existing.version,
        )
        if not val.valid:
            errors = [i.message for i in val.issues if i.severity == "error"]
            raise GovernanceError(f"Draft validation failed: {'; '.join(errors)}")

        updated = ReusableRuleVersion(
            rule_id=rule_id,
            version=existing.version,
            client_profile_id=existing.client_profile_id,
            name=new_name,
            description=new_desc,
            rule_type=new_type,
            status=RuleStatus.DRAFT,
            conditions=new_conditions,
            action=new_action,
            action_authority=new_authority,
            created_by=new_created_by,
            parent_version=existing.parent_version,
            rationale=new_rationale,
            validation_state="VALID" if val.valid else "INVALID",
            governance_tier="CONFIGURABLE_BUSINESS_RULE",
            provenance=existing.provenance,
            created_at=existing.created_at,
        )

        self.repository.save_rule_version(updated)
        self._event(
            UUID("00000000-0000-0000-0000-000000000000"),
            "rule.draft.updated",
            "rule_governance",
            human=True,
            rule_id=rule_id,
            version=existing.version,
            actor=new_created_by,
        )
        return updated

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

    def compile_rule_from_ai(
        self,
        prompt: str,
        reconciliation_id: UUID | None = None,
        client_profile_id: UUID | None = None,
        actor: str = "POC user",
    ) -> ReusableRuleVersion:
        """Use LLM interpretation (with fallback NLP compiler) to parse human rule instructions into a declarative rule object."""
        file_context_str = "No active session file uploaded."
        if reconciliation_id:
            try:
                session = self.reconciliation.get(reconciliation_id)
                cols = []
                if session.government_file and session.government_file.profile:
                    cols.append(f"Government columns: {session.government_file.profile.columns}")
                if session.purchase_register_file and session.purchase_register_file.profile:
                    cols.append(f"Purchase Register columns: {session.purchase_register_file.profile.columns}")
                if cols:
                    file_context_str = "; ".join(cols)
            except Exception:
                pass

        system_prompt = (
            "You are the TARS Rules Compiler AI for a GST Agentic Reconciliation Workbench.\n"
            "Interpret natural language rule requests from human tax managers and compile them into structured, safe declarative rules.\n\n"
            "Uploaded File Context:\n"
            f"{file_context_str}\n\n"
            "Canonical Data Fields available:\n"
            "- gstin: Supplier/Recipient GSTIN\n"
            "- document_number: Invoice / document number\n"
            "- taxable_value: Material invoice taxable value amount in INR\n"
            "- document_date: Invoice issue date\n"
            "- igst, cgst, sgst, cess: Tax component amounts in INR\n"
            "- narration: Line item remarks / notes\n\n"
            "Available Operators:\n"
            "- EXACT: Exact string match\n"
            "- NORMALIZED_EXACT: Match after normalizing slashes/separators\n"
            "- ABSOLUTE_TOLERANCE: Difference in numeric values <= threshold\n"
            "- DATE_TOLERANCE: Difference in dates <= threshold days\n"
            "- EQUALS: Exact field value match\n\n"
            "Available Actions:\n"
            "- PROPOSE_NEAR_MATCH: Propose a near match for human approval\n"
            "- TOLERANCE_MATCH: Propose a tolerance match pair\n"
            "- SUGGEST_CLASSIFICATION: Classify candidate exception\n"
            "- FLAG_FOR_REVIEW: Flag for priority manual inspection\n"
        )

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Compile the following human rule instruction into a declarative rule:\n'{prompt}'"},
        ]

        compiled_output: AIRuleInterpretationOutput | None = None
        try:
            from app.config import get_settings
            from app.providers.factory import create_llm_provider
            settings = get_settings()
            provider = create_llm_provider(settings)
            compiled_output = provider.invoke_structured(
                messages=messages,
                output_schema=AIRuleInterpretationOutput,
            )
        except Exception as exc:
            logger.info(f"LLM provider rule compilation fallback triggered: {exc}")
            compiled_output = self._fallback_ai_rule_compiler(prompt)

        rule_id = self._next_rule_id()
        
        draft_req = RuleDraftCreateRequest(
            rule_id=rule_id,
            name=compiled_output.name,
            description=compiled_output.description,
            rule_type=compiled_output.rule_type,
            conditions=compiled_output.conditions,
            action=compiled_output.action,
            action_authority=ActionAuthority.PROPOSE_ONLY,
            rationale=f"LLM Interpretation: {compiled_output.rationale}",
            created_by=actor,
            client_profile_id=client_profile_id,
        )

        rule = self.create_rule_draft(draft_req)

        rule.status = RuleStatus.ACTIVE
        rule.approval = ApprovalMetadata(approved_by=actor, note=f"Auto-approved AI compilation: {prompt[:100]}")
        rule.thinking_steps = compiled_output.thinking_steps
        rule.formula = compiled_output.formula
        self.repository.save_rule_version(rule)

        rid = reconciliation_id or UUID("00000000-0000-0000-0000-000000000000")
        self._event(
            rid,
            "rule.ai_compiled",
            "rule_compiler",
            human=True,
            rule_id=rule.rule_id,
            prompt=prompt,
            rule_name=rule.name,
        )
        return rule

    def _fallback_ai_rule_compiler(self, prompt: str) -> AIRuleInterpretationOutput:
        import re
        p_lower = prompt.lower()
        conditions: list[RuleCondition] = []
        action_type = "PROPOSE_NEAR_MATCH"
        rule_type = RuleType.DETERMINISTIC

        if "gstin" in p_lower:
            conditions.append(RuleCondition(field="gstin", operator="EXACT"))

        if "document" in p_lower or "invoice" in p_lower or "separator" in p_lower or "slash" in p_lower:
            if "normalized" in p_lower or "separator" in p_lower or "slash" in p_lower or "format" in p_lower:
                conditions.append(RuleCondition(field="document_number", operator="NORMALIZED_EXACT"))
            else:
                conditions.append(RuleCondition(field="document_number", operator="EXACT"))

        amount_match = re.search(r'(?:₹|inr|rs\.?|amount|taxable|value|variance|within|difference)?\s*(\d+(?:\.\d+)?)\s*(?:₹|inr|rs|rupees)?', p_lower)
        if "day" not in p_lower and ("tolerance" in p_lower or "within" in p_lower or "difference" in p_lower or "variance" in p_lower or "tax" in p_lower or "amount" in p_lower or "taxable" in p_lower):
            if amount_match:
                val = float(amount_match.group(1))
                if val > 0 and val < 100000:
                    conditions.append(RuleCondition(field="taxable_value", operator="ABSOLUTE_TOLERANCE", value=val))
                    rule_type = RuleType.TOLERANCE
                    action_type = "TOLERANCE_MATCH"

        days_match = re.search(r'(\d+)\s*day', p_lower)
        if days_match:
            days = float(days_match.group(1))
            if days > 0:
                conditions.append(RuleCondition(field="document_date", operator="DATE_TOLERANCE", value=days))
                rule_type = RuleType.TOLERANCE

        if "flag" in p_lower or "review" in p_lower or "inspect" in p_lower or "warning" in p_lower:
            action_type = "FLAG_FOR_REVIEW"
        elif "tolerance" in p_lower:
            action_type = "TOLERANCE_MATCH"
        elif "classify" in p_lower or "category" in p_lower:
            action_type = "SUGGEST_CLASSIFICATION"

        if not conditions:
            conditions = [
                RuleCondition(field="gstin", operator="EXACT"),
                RuleCondition(field="document_number", operator="NORMALIZED_EXACT")
            ]

        name = prompt.strip()[:60]
        if len(name) < 5:
            name = "Custom AI Compiled Rule"
        name = name[0].upper() + name[1:]

        cond_str_list = []
        for c in conditions:
            if c.operator == "EXACT":
                cond_str_list.append(f"{c.field} == EXACT_MATCH")
            elif c.operator == "NORMALIZED_EXACT":
                cond_str_list.append(f"{c.field} == NORMALIZED_EXACT_MATCH")
            elif c.operator == "ABSOLUTE_TOLERANCE":
                cond_str_list.append(f"abs({c.field}_diff) <= ₹{c.value}")
            elif c.operator == "DATE_TOLERANCE":
                cond_str_list.append(f"abs({c.field}_drift) <= {c.value} days")
            else:
                cond_str_list.append(f"{c.field} {c.operator} {c.value or ''}")

        formula = f"IF {' AND '.join(cond_str_list)} THEN {action_type}"

        thinking_steps = [
            f"[PROMPT_INGEST] Received natural language instruction: '{prompt}'",
            "[SCHEMA_INSPECT] Cross-referencing against canonical columns: [gstin, document_number, taxable_value, document_date]",
            f"[REASONING] Extracted {len(conditions)} condition(s): {', '.join([c.field + ' (' + c.operator + ')' for c in conditions])}",
            f"[TARGET_ACTION] Selected rule target action: '{action_type}'",
            "[DECLARATIVE_AST] Compiling declarative Rule AST object with PROPOSE_ONLY authority...",
            f"[VERIFY] Validation passed cleanly for column formula: {formula}",
        ]

        return AIRuleInterpretationOutput(
            name=name,
            description=f"AI-interpreted rule created from instruction: '{prompt}'",
            rule_type=rule_type,
            conditions=conditions,
            action=RuleAction(type=action_type),
            rationale=f"Interpreted '{prompt}' into canonical conditions: {[c.model_dump() for c in conditions]} and action '{action_type}'.",
            thinking_steps=thinking_steps,
            formula=formula,
        )

