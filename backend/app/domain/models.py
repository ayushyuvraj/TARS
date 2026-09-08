from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from enum import StrEnum
from typing import Any, Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class SessionStatus(StrEnum):
    CREATED = "created"
    FILES_PENDING = "files_pending"
    READY = "ready"
    PROFILING = "profiling"
    AWAITING_MAPPING_APPROVAL = "awaiting_mapping_approval"
    MAPPING_CONFIRMED = "mapping_confirmed"
    AWAITING_POLICY_APPROVAL = "awaiting_policy_approval"
    POLICY_CONFIRMED = "policy_confirmed"
    ANALYZING_NEAR_MATCHES = "analyzing_near_matches"
    AWAITING_NEAR_MATCH_APPROVAL = "awaiting_near_match_approval"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class DatasetRole(StrEnum):
    GOVERNMENT = "government"
    PURCHASE_REGISTER = "purchase_register"


class ActorType(StrEnum):
    SYSTEM = "system"
    USER = "user"
    AGENT = "agent"


class CanonicalDataType(StrEnum):
    STRING = "string"
    NUMBER = "number"
    DATE = "date"


class ProposedBy(StrEnum):
    DETERMINISTIC = "deterministic"
    AI = "ai"
    HUMAN = "human"


class ColumnMapping(BaseModel):
    canonical_field: str
    source_column: str
    confidence: float | None = Field(default=None, ge=0, le=1)
    rationale: str | None = None


class MappingProposal(BaseModel):
    dataset_role: DatasetRole
    mappings: list[ColumnMapping]
    model_provider: str | None = None
    model_name: str | None = None


class PolicyStatus(StrEnum):
    DRAFT = "draft"
    PROPOSED = "proposed"
    AWAITING_APPROVAL = "awaiting_approval"
    CONFIRMED = "confirmed"
    REJECTED = "rejected"


class MatchOperator(StrEnum):
    EXACT = "EXACT"
    ABSOLUTE_TOLERANCE = "ABSOLUTE_TOLERANCE"
    DATE_TOLERANCE = "DATE_TOLERANCE"


class ToleranceUnit(StrEnum):
    INR = "INR"
    DAYS = "DAYS"


class ToleranceDefinition(BaseModel):
    value: Decimal = Field(ge=0)
    unit: ToleranceUnit


class PolicyFieldRule(BaseModel):
    canonical_field: str
    enabled: bool = True
    required: bool = True
    operator: MatchOperator
    priority: int = Field(default=1, ge=1)
    tolerance: ToleranceDefinition | None = None
    weight: Decimal | None = Field(default=None, ge=0)


class PolicyValidationIssue(BaseModel):
    code: str
    message: str
    canonical_field: str | None = None
    severity: Literal["error", "warning"] = "error"


class PolicyValidationResult(BaseModel):
    valid: bool
    issues: list[PolicyValidationIssue] = Field(default_factory=list)


class ReconciliationPolicy(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    name: str = Field(min_length=1, max_length=120)
    rules: list[PolicyFieldRule]
    status: PolicyStatus = PolicyStatus.DRAFT
    proposed_by: ProposedBy = ProposedBy.HUMAN
    natural_language_instruction: str | None = Field(default=None, max_length=4000)
    explanation: str | None = Field(default=None, max_length=2000)
    revision: int = Field(default=1, ge=1)
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
    confirmed_at: datetime | None = None


class NearMatchOperator(StrEnum):
    NORMALIZED_EXACT = "NORMALIZED_EXACT"
    FUZZY_SIMILARITY = "FUZZY_SIMILARITY"


class MatchingThresholds(BaseModel):
    candidate_generation_min_score: float = Field(default=0.45, ge=0, le=1)
    near_match_threshold: float = Field(default=0.92, ge=0, le=1)
    ambiguity_margin: float = Field(default=0.05, ge=0, le=1)
    minimum_invoice_similarity: float = Field(default=0.55, ge=0, le=1)
    date_window_days: int = Field(default=30, ge=0)
    amount_window_absolute: Decimal = Field(default=Decimal("20000"), ge=0)
    amount_window_relative: float = Field(default=0.50, ge=0)
    material_amount_tolerance: Decimal = Field(default=Decimal("10"), ge=0)
    material_tax_tolerance: Decimal = Field(default=Decimal("2"), ge=0)


class NearMatchRule(BaseModel):
    canonical_field: str = "document_number"
    operator: NearMatchOperator = NearMatchOperator.FUZZY_SIMILARITY
    threshold: float = Field(default=0.90, ge=0, le=1)


class NaturalLanguagePolicyAgentOutput(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    rules: list[PolicyFieldRule]
    explanation: str | None = Field(default=None, max_length=2000)


class NaturalLanguagePolicyRequest(BaseModel):
    instruction: str = Field(min_length=1, max_length=4000)


class NaturalLanguagePolicyProposal(BaseModel):
    reconciliation_id: UUID
    policy: ReconciliationPolicy
    validation: PolicyValidationResult
    created_at: datetime = Field(default_factory=utc_now)
    ai_provider_used: str | None = None
    ai_model_used: str | None = None
    provider_error: str | None = None


class HumanPolicyDecision(BaseModel):
    policy: ReconciliationPolicy


class PolicyEvaluationReport(BaseModel):
    provider: str
    model: str | None = None
    field_accuracy: float = Field(ge=0, le=1)
    operator_accuracy: float = Field(ge=0, le=1)
    tolerance_accuracy: float = Field(ge=0, le=1)
    missing_rule_count: int = Field(ge=0)
    extra_rule_count: int = Field(ge=0)
    validation_failure_count: int = Field(ge=0)
    structured_output_failure_count: int = Field(ge=0)
    latency_ms: float = Field(ge=0)


class DatasetProfile(BaseModel):
    role: DatasetRole
    sheet_name: str
    header_row: int = Field(ge=1)
    row_count: int = Field(ge=0)
    column_count: int = Field(ge=0)
    columns: list[str]
    inferred_types: dict[str, str]
    null_counts: dict[str, int]
    column_profiles: list["ColumnProfile"] = Field(default_factory=list)


class ColumnProfile(BaseModel):
    column_name: str
    inferred_dtype: CanonicalDataType
    pandas_dtype: str
    non_null_count: int = Field(ge=0)
    non_null_percentage: float = Field(ge=0, le=100)
    null_percentage: float = Field(ge=0, le=100)
    unique_count: int = Field(ge=0)
    sample_values: list[str] = Field(default_factory=list, max_length=5)
    minimum: str | None = None
    maximum: str | None = None
    pattern_hints: list[str] = Field(default_factory=list)


class CanonicalFieldDefinition(BaseModel):
    canonical_name: str
    display_name: str
    description: str
    expected_datatype: CanonicalDataType
    participates_in_matching: bool
    required_for_exact_match: bool = False
    aliases: list[str] = Field(default_factory=list)


class ColumnMappingCandidate(BaseModel):
    source_dataset: DatasetRole
    source_column: str
    canonical_field: str | None = None
    confidence: float = Field(ge=0, le=1)
    rationale: str
    proposed_by: ProposedBy
    user_edited: bool = False


class DatasetMappingProposal(BaseModel):
    source_dataset: DatasetRole
    mappings: list[ColumnMappingCandidate]


class MappingValidationIssue(BaseModel):
    code: str
    message: str
    source_dataset: DatasetRole | None = None
    source_column: str | None = None
    canonical_field: str | None = None
    severity: Literal["error", "warning"] = "error"


class MappingValidationResult(BaseModel):
    valid: bool
    issues: list[MappingValidationIssue] = Field(default_factory=list)
    required_fields_mapped: dict[str, list[str]] = Field(default_factory=dict)


class SchemaMappingProposal(BaseModel):
    reconciliation_id: UUID
    datasets: list[DatasetMappingProposal]
    validation: MappingValidationResult
    created_at: datetime = Field(default_factory=utc_now)
    ai_provider_used: str | None = None
    ai_model_used: str | None = None
    provider_error: str | None = None


class ConfirmedDatasetMapping(BaseModel):
    source_dataset: DatasetRole
    mappings: list[ColumnMappingCandidate]


class ConfirmedMappingSet(BaseModel):
    reconciliation_id: UUID
    datasets: list[ConfirmedDatasetMapping]
    confirmed_at: datetime = Field(default_factory=utc_now)


class HumanMappingDecision(BaseModel):
    datasets: list[DatasetMappingProposal]


class SchemaMappingAgentOutput(BaseModel):
    mappings: list[ColumnMappingCandidate]


class MappingEvaluationReport(BaseModel):
    provider: str
    model: str | None = None
    required_field_mapping_accuracy: float = Field(ge=0, le=1)
    overall_canonical_mapping_accuracy: float = Field(ge=0, le=1)
    invalid_mapping_count: int = Field(ge=0)
    missing_required_mappings: int = Field(ge=0)
    structured_output_failure_count: int = Field(ge=0)
    latency_ms: float = Field(ge=0)


class UploadedFile(BaseModel):
    role: DatasetRole
    original_filename: str
    stored_path: str
    size_bytes: int = Field(ge=0)
    profile: DatasetProfile


class MatchResult(BaseModel):
    government_record_id: str
    purchase_register_record_id: str
    match_type: Literal["exact", "tolerance", "near", "human_selected"] = "exact"
    matched_fields: list[str]
    variances: dict[str, float] = Field(default_factory=dict)
    allowed_tolerances: dict[str, float] = Field(default_factory=dict)
    rules_satisfied: list[str] = Field(default_factory=list)
    government_values: dict[str, Any] = Field(default_factory=dict)
    purchase_register_values: dict[str, Any] = Field(default_factory=dict)
    policy_revision: int | None = None


class CandidateStatus(StrEnum):
    NEAR_MATCH_PROPOSED = "NEAR_MATCH_PROPOSED"
    NEAR_MATCH_APPROVED = "NEAR_MATCH_APPROVED"
    AMBIGUOUS = "AMBIGUOUS"
    REJECTED_CANDIDATE = "REJECTED_CANDIDATE"
    MATERIAL_MISMATCH = "MATERIAL_MISMATCH"


class CandidateFeatures(BaseModel):
    gstin_exact: bool
    document_number_raw_equal: bool
    document_number_government_raw: str
    document_number_purchase_raw: str
    document_number_government_normalized: str
    document_number_purchase_normalized: str
    document_number_normalized_equal: bool
    document_number_similarity: float = Field(ge=0, le=1)
    document_date_difference_days: int = Field(ge=0)
    taxable_value_difference: Decimal = Field(ge=0)
    taxable_value_relative_difference: float = Field(ge=0)
    igst_difference: Decimal = Field(ge=0)
    cgst_difference: Decimal = Field(ge=0)
    sgst_difference: Decimal = Field(ge=0)
    cess_difference: Decimal = Field(ge=0)
    gst_rate_match: bool
    document_type_match: bool


class CandidateScoreComponents(BaseModel):
    invoice: float = Field(ge=0, le=1)
    taxable_value: float = Field(ge=0, le=1)
    tax_amounts: float = Field(ge=0, le=1)
    date: float = Field(ge=0, le=1)
    gst_rate: float = Field(ge=0, le=1)
    document_type: float = Field(ge=0, le=1)


class CandidateMatch(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    government_record_id: str
    purchase_register_record_id: str
    match_score: float = Field(ge=0, le=1)
    rank: int = Field(default=1, ge=1)
    status: CandidateStatus
    eligible_for_bulk_approval: bool = False
    reciprocal_best: bool = False
    score_gap: float | None = Field(default=None, ge=0, le=1)
    features: CandidateFeatures
    component_scores: CandidateScoreComponents
    reasons: list[str] = Field(default_factory=list)
    government_values: dict[str, Any] = Field(default_factory=dict)
    purchase_register_values: dict[str, Any] = Field(default_factory=dict)


class MatchConflict(BaseModel):
    government_record_id: str
    purchase_register_record_ids: list[str]
    reason: str = "Multiple valid tolerance candidates require human review."


class NearMatchAmbiguity(BaseModel):
    government_record_id: str
    candidate_ids: list[UUID]
    candidate_count: int = Field(ge=2)
    top_candidate_score: float = Field(ge=0, le=1)
    second_candidate_score: float = Field(ge=0, le=1)
    score_gap: float = Field(ge=0, le=1)
    reason: str = "Multiple similarly strong candidates"


class NearMatchAnalysisSummary(BaseModel):
    candidate_count: int = Field(ge=0)
    high_confidence_proposals: int = Field(ge=0)
    ambiguous_government_records: int = Field(ge=0)
    material_mismatch_records: int = Field(ge=0)
    gst_only_records: int = Field(ge=0)
    pr_only_records: int = Field(ge=0)
    runtime_ms: float = Field(ge=0)


class NearMatchAnalysis(BaseModel):
    reconciliation_id: UUID
    thresholds: MatchingThresholds
    near_rule: NearMatchRule = Field(default_factory=NearMatchRule)
    candidates: list[CandidateMatch]
    ambiguities: list[NearMatchAmbiguity]
    material_mismatch_government_ids: list[str]
    gst_only_government_ids: list[str]
    pr_only_purchase_register_ids: list[str]
    summary: NearMatchAnalysisSummary
    policy_revision: int | None = None
    client_profile_id: UUID | None = None
    profile_version: int | None = None
    created_at: datetime = Field(default_factory=utc_now)


class NearMatchDecisionAction(StrEnum):
    APPROVE = "approve"
    REJECT = "reject"


class NearMatchDecision(BaseModel):
    action: NearMatchDecisionAction


class NearMatchReconciliationSummary(BaseModel):
    reconciliation_id: UUID
    status: SessionStatus
    government_records: int = Field(ge=0)
    purchase_register_records: int = Field(ge=0)
    exact_matches: int = Field(ge=0)
    tolerance_matches: int = Field(ge=0)
    near_match_proposals: int = Field(ge=0)
    near_matches: int = Field(ge=0)
    ambiguous_records: int = Field(ge=0)
    material_mismatch_records: int = Field(ge=0)
    gst_only_records: int = Field(ge=0)
    pr_only_records: int = Field(ge=0)
    resolved_records: int = Field(ge=0)
    remaining_government_records: int = Field(ge=0)
    remaining_purchase_register_records: int = Field(ge=0)


class NearMatchBulkApprovalTotals(BaseModel):
    resolved_records: int = Field(ge=0)
    government_open: int = Field(ge=0)
    purchase_register_remaining: int = Field(ge=0)


class NearMatchBulkSkipReason(BaseModel):
    candidate_id: UUID
    government_record_id: str
    purchase_register_record_id: str
    code: str
    message: str


class NearMatchBulkApprovalResult(BaseModel):
    batch_id: UUID
    reconciliation_id: UUID
    requested: int = Field(ge=0)
    approved: int = Field(ge=0)
    skipped: int = Field(ge=0)
    failed: int = Field(ge=0)
    skip_reasons: list[NearMatchBulkSkipReason] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)
    before: NearMatchBulkApprovalTotals
    after: NearMatchBulkApprovalTotals
    duplicate_pr_consumption: int = Field(ge=0)
    policy_revision: int | None = None
    client_profile_id: UUID | None = None
    profile_version: int | None = None
    summary: NearMatchReconciliationSummary


class NearMatchEvaluationReport(BaseModel):
    expected_near_pairs: int = Field(ge=0)
    candidate_recall: float = Field(ge=0, le=1)
    top_1_accuracy: float = Field(ge=0, le=1)
    safe_proposal_precision: float = Field(ge=0, le=1)
    safe_proposal_recall: float = Field(ge=0, le=1)
    false_positive_count: int = Field(ge=0)
    ambiguous_auto_match_count: int = Field(ge=0)
    duplicate_consumption_count: int = Field(ge=0)
    material_mismatch_false_matches: int = Field(ge=0)
    gst_only_false_matches: int = Field(ge=0)
    pr_only_false_consumption: int = Field(ge=0)
    candidate_count: int = Field(ge=0)
    runtime_ms: float = Field(ge=0)
    true_near_score_min: float | None = None
    true_near_score_max: float | None = None


class ToleranceReconciliationSummary(BaseModel):
    reconciliation_id: UUID
    status: SessionStatus
    government_records: int = Field(ge=0)
    purchase_register_records: int = Field(ge=0)
    exact_matches: int = Field(ge=0)
    tolerance_matches: int = Field(ge=0)
    resolved_records: int = Field(ge=0)
    remaining_government_records: int = Field(ge=0)
    remaining_purchase_register_records: int = Field(ge=0)
    conflict_count: int = Field(default=0, ge=0)


class ReconciliationResultItem(BaseModel):
    status: Literal["EXACT_MATCHED", "TOLERANCE_MATCHED", "NEAR_MATCH_PROPOSED", "NEAR_MATCHED", "HUMAN_SELECTED", "AMBIGUOUS", "MATERIAL_MISMATCH", "GST_ONLY", "PR_ONLY", "UNRESOLVED"]
    government_record_id: str | None = None
    purchase_register_record_id: str | None = None
    match: MatchResult | None = None


class ReconciliationResults(BaseModel):
    summary: ToleranceReconciliationSummary | NearMatchReconciliationSummary
    records: list[ReconciliationResultItem]
    conflicts: list[MatchConflict] = Field(default_factory=list)
    total_records: int | None = Field(default=None, ge=0)
    offset: int = Field(default=0, ge=0)
    limit: int | None = Field(default=None, ge=1)


class ReconciliationSummary(BaseModel):
    reconciliation_id: UUID
    status: SessionStatus
    government_records: int = Field(ge=0)
    purchase_register_records: int = Field(ge=0)
    exact_matches: int = Field(ge=0)
    remaining_government_records: int = Field(ge=0)
    remaining_purchase_register_records: int = Field(ge=0)


class ApprovalRequest(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    reconciliation_id: UUID
    action_type: str
    payload: dict[str, Any]
    status: Literal["pending", "approved", "rejected"] = "pending"


class AgentEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: UUID = Field(default_factory=uuid4)
    event_type: str
    reconciliation_id: UUID
    actor_type: ActorType
    component: str
    timestamp: datetime = Field(default_factory=utc_now)
    input_count: int | None = Field(default=None, ge=0)
    output_count: int | None = Field(default=None, ge=0)
    result: str | None = None
    confidence: float | None = Field(default=None, ge=0, le=1)
    approval_status: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    model_provider: str | None = None
    model_name: str | None = None


class ReconciliationSession(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    status: SessionStatus = SessionStatus.CREATED
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
    government_file: UploadedFile | None = None
    purchase_register_file: UploadedFile | None = None
    mapping_proposal: SchemaMappingProposal | None = None
    confirmed_mapping: ConfirmedMappingSet | None = None
    mapping_validation: MappingValidationResult | None = None
    workflow_thread_id: str | None = None
    policy_proposal: NaturalLanguagePolicyProposal | None = None
    confirmed_policy: ReconciliationPolicy | None = None
    policy_validation: PolicyValidationResult | None = None
    policy_workflow_thread_id: str | None = None
    tolerance_summary: ToleranceReconciliationSummary | None = None
    near_match_analysis: NearMatchAnalysis | None = None
    near_match_summary: NearMatchReconciliationSummary | None = None
    near_workflow_thread_id: str | None = None
    summary: ReconciliationSummary | None = None
    client_profile_id: UUID | None = None
    profile_version: int | None = None


class ReconciliationListItem(BaseModel):
    id: UUID
    status: SessionStatus
    created_at: datetime
    updated_at: datetime
    client_name: str | None = None
    government_filename: str | None = None
    purchase_register_filename: str | None = None
    government_records: int = Field(default=0, ge=0)
    purchase_register_records: int = Field(default=0, ge=0)
    resolved_records: int = Field(default=0, ge=0)
    remaining_government_records: int = Field(default=0, ge=0)
    remaining_purchase_register_records: int = Field(default=0, ge=0)
    current_stage: Literal[
        "setup", "mapping", "policy", "results", "near-matches", "exceptions", "audit", "final-review"
    ]


class ReconciliationState(BaseModel):
    reconciliation_id: UUID
    government_file: UploadedFile | None = None
    purchase_register_file: UploadedFile | None = None
    government_profile: DatasetProfile | None = None
    purchase_register_profile: DatasetProfile | None = None
    proposed_mappings: list[MappingProposal] = Field(default_factory=list)
    confirmed_mappings: list[ColumnMapping] = Field(default_factory=list)
    policy: ReconciliationPolicy | None = None
    exact_match_results: list[MatchResult] = Field(default_factory=list)
    tolerance_results: list[MatchResult] = Field(default_factory=list)
    near_match_results: list[MatchResult] = Field(default_factory=list)


class SemanticCategory(StrEnum):
    PRIOR_PERIOD_ADJUSTMENT = "PRIOR_PERIOD_ADJUSTMENT"
    ADVANCE_ADJUSTMENT = "ADVANCE_ADJUSTMENT"
    ITC_REVERSAL = "ITC_REVERSAL"
    GST_REGISTRATION_CHANGE = "GST_REGISTRATION_CHANGE"
    RCM_ADJUSTMENT = "RCM_ADJUSTMENT"
    PRICE_CORRECTION = "PRICE_CORRECTION"
    FREIGHT_ALLOCATION = "FREIGHT_ALLOCATION"
    REGULAR_PURCHASE = "REGULAR_PURCHASE"
    OTHER = "OTHER"
    INSUFFICIENT_EVIDENCE = "INSUFFICIENT_EVIDENCE"


class SuggestedAction(StrEnum):
    REVIEW = "REVIEW"
    ACCEPT_NEAR_MATCH = "ACCEPT_NEAR_MATCH"
    SELECT_CANDIDATE = "SELECT_CANDIDATE"
    INVESTIGATE_VALUE_VARIANCE = "INVESTIGATE_VALUE_VARIANCE"
    VERIFY_VENDOR_DOCUMENT = "VERIFY_VENDOR_DOCUMENT"
    CHECK_PERIOD = "CHECK_PERIOD"
    CHECK_GSTIN = "CHECK_GSTIN"
    NO_ACTION = "NO_ACTION"
    LEAVE_UNRESOLVED = "LEAVE_UNRESOLVED"
    INSUFFICIENT_EVIDENCE = "INSUFFICIENT_EVIDENCE"


class SemanticAgentOutput(BaseModel):
    category: SemanticCategory
    confidence: float = Field(ge=0, le=1)
    evidence_fields: list[str] = Field(default_factory=list, max_length=8)
    reason: str = Field(max_length=1000)
    suggested_action: SuggestedAction
    requires_human_review: bool = True


class SemanticClassification(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    reconciliation_id: UUID
    record_id: str
    source_dataset: DatasetRole
    proposed_category: SemanticCategory
    final_category: SemanticCategory | None = None
    confidence: float = Field(ge=0, le=1)
    evidence_fields: list[str] = Field(default_factory=list)
    reason: str
    suggested_action: SuggestedAction
    requires_human_review: bool = True
    review_status: Literal["ai_proposed", "human_confirmed", "human_overridden", "unclassified"] = "ai_proposed"
    provider: str
    model: str | None = None
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class SemanticDecision(BaseModel):
    category: SemanticCategory | None = None
    action: Literal["confirm", "override", "leave_unclassified"]


class SemanticBatchRequest(BaseModel):
    statuses: list[Literal["AMBIGUOUS", "MATERIAL_MISMATCH", "GST_ONLY", "PR_ONLY"]] = Field(default_factory=lambda: ["AMBIGUOUS", "MATERIAL_MISMATCH", "GST_ONLY", "PR_ONLY"])
    record_ids: list[str] | None = Field(default=None, max_length=250)
    batch_size: int = Field(default=20, ge=1, le=50)


class SemanticBatchResult(BaseModel):
    requested: int = Field(ge=0)
    completed: int = Field(ge=0)
    failed: int = Field(ge=0)
    classifications: list[SemanticClassification]
    failures: dict[str, str] = Field(default_factory=dict)


class SemanticAvailability(BaseModel):
    available: bool
    provider: str | None = None
    model: str | None = None


class ExceptionRecord(BaseModel):
    record_id: str
    source_dataset: DatasetRole
    status: Literal["AMBIGUOUS", "MATERIAL_MISMATCH", "GST_ONLY", "PR_ONLY"]
    values: dict[str, Any]
    best_candidate: CandidateMatch | None = None
    candidate_count: int = Field(default=0, ge=0)
    semantic_classification: SemanticClassification | None = None


class ExceptionBreakdown(BaseModel):
    reconciliation_id: UUID
    remaining_government: int = Field(ge=0)
    remaining_purchase_register: int = Field(ge=0)
    ambiguous: int = Field(ge=0)
    material_mismatch: int = Field(ge=0)
    gst_only: int = Field(ge=0)
    pr_only: int = Field(ge=0)
    semantic_categories: dict[str, int] = Field(default_factory=dict)


class ExceptionSearchRequest(BaseModel):
    statuses: list[str] | None = None
    vendor: str | None = None
    gstin: str | None = None
    amount_min: Decimal | None = None
    amount_max: Decimal | None = None
    date_from: date | None = None
    date_to: date | None = None
    taxable_variance_min: Decimal | None = None
    taxable_variance_max: Decimal | None = None
    semantic_category: SemanticCategory | None = None
    semantic_confidence_min: float | None = Field(default=None, ge=0, le=1)
    semantic_confidence_max: float | None = Field(default=None, ge=0, le=1)
    semantic_review_status: list[Literal["ai_proposed", "human_confirmed", "human_overridden", "unclassified"]] | None = None
    requires_human_review: bool | None = None
    match_score_min: float | None = Field(default=None, ge=0, le=1)
    match_score_max: float | None = Field(default=None, ge=0, le=1)
    record_id: str | None = None
    offset: int = Field(default=0, ge=0)
    limit: int = Field(default=50, ge=1, le=100)


class ExceptionSearchResult(BaseModel):
    total: int = Field(ge=0)
    offset: int = Field(ge=0)
    limit: int = Field(ge=1)
    records: list[ExceptionRecord]


class VarianceAnalysis(BaseModel):
    record_id: str
    candidate_record_id: str | None = None
    status: str
    variances: dict[str, float] = Field(default_factory=dict)
    allowed_tolerances: dict[str, float] = Field(default_factory=dict)
    blockers: list[str] = Field(default_factory=list)


class PolicySimulationRequest(BaseModel):
    taxable_value_tolerance: Decimal | None = Field(default=None, ge=0)
    document_date_tolerance_days: int | None = Field(default=None, ge=0)
    tax_amount_tolerance: Decimal | None = Field(default=None, ge=0)


class PolicySimulationResult(BaseModel):
    record_id: str
    current_policy_revision: int
    hypothetical: PolicySimulationRequest
    would_satisfy: bool
    blockers: list[str]
    policy_mutated: bool = False


class CopilotToolCall(BaseModel):
    tool_name: str
    purpose: str
    status: Literal["completed", "failed"]
    result_count: int | None = Field(default=None, ge=0)
    duration_ms: float = Field(ge=0)


class CopilotEvidence(BaseModel):
    reference_type: str
    reference_id: str
    facts: dict[str, Any]


class CopilotTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=4000)


class CopilotRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    conversation_id: UUID | None = None
    reconciliation_id: UUID | None = None
    selected_record_id: str | None = None
    current_page: str | None = None
    conversation_history: list[CopilotTurn] = Field(default_factory=list)


class CopilotResponse(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    conversation_id: UUID
    answer: str
    evidence: list[CopilotEvidence]
    tool_calls: list[CopilotToolCall]
    suggested_actions: list[SuggestedAction] = Field(default_factory=list)
    requires_human_action: bool = False
    provider: str = "deterministic"
    model: str | None = None
    created_at: datetime = Field(default_factory=utc_now)


class CopilotMessage(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    conversation_id: UUID
    reconciliation_id: UUID | None = None
    role: Literal["user", "assistant"]
    content: str
    selected_record_id: str | None = None
    response: CopilotResponse | None = None
    created_at: datetime = Field(default_factory=utc_now)


class CopilotConversation(BaseModel):
    conversation_id: UUID
    reconciliation_id: UUID | None = None
    messages: list[CopilotMessage]


class InvestigationEvidence(BaseModel):
    reference_id: str
    tool_name: str
    fact_paths: list[str] = Field(default_factory=list)
    supports_reasoning_indexes: list[int] = Field(default_factory=list)


class InvestigationConclusion(BaseModel):
    classification: Literal["MATERIAL_MISMATCH", "AMBIGUOUS", "GST_ONLY", "PR_ONLY"]
    conclusion_summary: str = Field(min_length=1, max_length=800)
    likely_root_cause: str = Field(min_length=1, max_length=800)
    reasoning_summary: list[str] = Field(min_length=1, max_length=8)
    evidence: list[InvestigationEvidence] = Field(min_length=1, max_length=12)
    recommended_action: str = Field(min_length=1, max_length=800)
    confidence: float = Field(ge=0, le=1)
    insufficient_evidence: bool = False
    data_needed: list[str] = Field(default_factory=list, max_length=8)
    limitations: list[str] = Field(default_factory=list, max_length=8)


class InvestigationTraceStep(BaseModel):
    sequence: int = Field(ge=1)
    stage: Literal["load", "model", "tool", "validation", "persist"]
    name: str
    started_at: datetime
    completed_at: datetime
    duration_ms: float = Field(ge=0)
    status: Literal["completed", "failed"]
    structured_result: dict[str, Any] = Field(default_factory=dict)


class InvestigationValidationResult(BaseModel):
    valid: bool
    checked_evidence_references: int = Field(ge=0)
    checked_reasoning_statements: int = Field(ge=0)
    errors: list[str] = Field(default_factory=list)


class AIInvestigationRecord(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    reconciliation_id: UUID
    record_id: str
    status: Literal["completed", "failed"]
    conclusion: InvestigationConclusion | None = None
    execution_trace: list[InvestigationTraceStep] = Field(default_factory=list)
    provider: str
    model: str
    started_at: datetime
    completed_at: datetime
    latency_ms: float = Field(ge=0)
    token_usage: dict[str, int] | None = None
    validation_result: InvestigationValidationResult
    error_code: str | None = None
    error_message: str | None = None


class AIInvestigationAvailability(BaseModel):
    available: bool
    provider: Literal["openai"] = "openai"
    model: str
    reason: str | None = None


class ProfileStatus(StrEnum):
    ACTIVE = "ACTIVE"
    DISABLED = "DISABLED"
    ARCHIVED = "ARCHIVED"


class CompatibilityStatus(StrEnum):
    COMPATIBLE = "PROFILE_COMPATIBLE"
    PARTIAL = "PROFILE_PARTIALLY_COMPATIBLE"
    INCOMPATIBLE = "PROFILE_INCOMPATIBLE"


class ApprovalMetadata(BaseModel):
    approved_by: str
    approved_at: datetime = Field(default_factory=utc_now)
    note: str | None = None


class ClientProfile(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    client_name: str = Field(min_length=1, max_length=200)
    profile_name: str = Field(min_length=1, max_length=250)
    status: ProfileStatus = ProfileStatus.ACTIVE
    version: int = Field(default=1, ge=1)
    saved_mapping: ConfirmedMappingSet
    saved_policy: ReconciliationPolicy
    created_from_reconciliation_id: UUID
    active_rule_ids: list[str] = Field(default_factory=list)
    created_by: str = "POC user"
    approved_by: str | None = None
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
    last_used_at: datetime | None = None


class ProfileCompatibility(BaseModel):
    profile_id: UUID
    reconciliation_id: UUID
    status: CompatibilityStatus
    compatible_fields: list[str] = Field(default_factory=list)
    remapped_fields: dict[str, str] = Field(default_factory=dict)
    missing_fields: list[str] = Field(default_factory=list)
    confirmation_required: bool = False


class RuleType(StrEnum):
    DETERMINISTIC = "DETERMINISTIC"
    NORMALIZATION = "NORMALIZATION"
    TOLERANCE = "TOLERANCE"
    CLASSIFICATION_ASSIST = "CLASSIFICATION_ASSIST"
    HYBRID = "HYBRID"


class RuleStatus(StrEnum):
    DRAFT = "DRAFT"
    PROPOSED = "PROPOSED"
    APPROVED = "APPROVED"
    ACTIVE = "ACTIVE"
    DISABLED = "DISABLED"
    RETIRED = "RETIRED"
    REJECTED = "REJECTED"
    SUPERSEDED = "SUPERSEDED"


class ActionAuthority(StrEnum):
    PROPOSE_ONLY = "PROPOSE_ONLY"
    REQUIRES_HUMAN_APPROVAL = "REQUIRES_HUMAN_APPROVAL"
    AUTO_EXECUTE_LOW_RISK = "AUTO_EXECUTE_LOW_RISK"
    AUTO_EXECUTE = "AUTO_EXECUTE"


class RuleProvenanceType(StrEnum):
    MANUALLY_CREATED = "MANUALLY_CREATED"
    POLICY_DERIVED = "POLICY_DERIVED"
    HUMAN_DECISION_PATTERN = "HUMAN_DECISION_PATTERN"
    AI_SUGGESTED = "AI_SUGGESTED"
    MIGRATED = "MIGRATED"


class RuleCondition(BaseModel):
    field: str
    operator: str
    value: Decimal | int | str | None = None


class RuleAction(BaseModel):
    type: str
    value: str | None = None


class RuleProvenance(BaseModel):
    type: RuleProvenanceType
    reconciliation_id: UUID | None = None
    pattern_suggestion_id: UUID | None = None
    decision_count: int = Field(default=0, ge=0)
    summary: str
    evidence_ids: list[str] = Field(default_factory=list)


class RuleEffectiveness(BaseModel):
    times_evaluated: int = Field(default=0, ge=0)
    times_triggered: int = Field(default=0, ge=0)
    approved_outcomes: int = Field(default=0, ge=0)
    rejected_outcomes: int = Field(default=0, ge=0)
    human_overrides: int = Field(default=0, ge=0)
    conflicts: int = Field(default=0, ge=0)
    sessions_used: int = Field(default=0, ge=0)
    last_used_at: datetime | None = None


class ReusableRuleVersion(BaseModel):
    rule_id: str
    version: int = Field(ge=1)
    client_profile_id: UUID | str | None = None
    name: str = Field(min_length=1, max_length=200)
    description: str = Field(min_length=1, max_length=1000)
    rule_type: RuleType
    status: RuleStatus = RuleStatus.DRAFT
    conditions: list[RuleCondition] = Field(min_length=1)
    action: RuleAction
    action_authority: ActionAuthority = ActionAuthority.PROPOSE_ONLY
    provenance: RuleProvenance
    effectiveness: RuleEffectiveness = Field(default_factory=RuleEffectiveness)
    created_by: str = "POC user"
    approval: ApprovalMetadata | None = None
    created_at: datetime = Field(default_factory=utc_now)
    parent_version: int | None = None
    rationale: str | None = None
    validation_state: str | None = None
    governance_tier: str | None = None
    execution_stage: str | None = None
    thinking_steps: list[str] = Field(default_factory=list)
    formula: str | None = None


class RuleDraftCreateRequest(BaseModel):
    rule_id: str | None = Field(default=None, max_length=50)
    name: str = Field(min_length=1, max_length=200)
    description: str = Field(min_length=1, max_length=1000)
    rule_type: RuleType = RuleType.NORMALIZATION
    conditions: list[RuleCondition] = Field(min_length=1)
    action: RuleAction
    action_authority: ActionAuthority = ActionAuthority.PROPOSE_ONLY
    parent_version: int | None = None
    rationale: str | None = Field(default=None, max_length=1000)
    created_by: str = "POC user"
    client_profile_id: UUID | None = None


class AIRuleCompileRequest(BaseModel):
    prompt: str = Field(..., min_length=3, max_length=2000)
    reconciliation_id: UUID | None = None
    client_profile_id: UUID | None = None
    actor: str = "POC user"


class AIRuleInterpretationOutput(BaseModel):
    name: str = Field(..., description="Short descriptive name for the compiled rule")
    description: str = Field(..., description="Detailed description of what the rule checks and does")
    rule_type: RuleType = Field(default=RuleType.DETERMINISTIC, description="Rule category type")
    conditions: list[RuleCondition] = Field(..., min_length=1, description="Rule conditions to evaluate")
    action: RuleAction = Field(default_factory=lambda: RuleAction(type="PROPOSE_NEAR_MATCH"), description="Rule action")
    rationale: str = Field(..., description="Explanation of how the natural language prompt was interpreted into declarative rule logic")
    thinking_steps: list[str] = Field(default_factory=list, description="Claude-style step-by-step reasoning logs")
    formula: str = Field(default="", description="Column formula / mathematical logic representation")


class RuleDraftUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, min_length=1, max_length=1000)
    rule_type: RuleType | None = None
    conditions: list[RuleCondition] | None = None
    action: RuleAction | None = None
    action_authority: ActionAuthority | None = None
    rationale: str | None = Field(default=None, max_length=1000)
    created_by: str | None = None


class RuleValidationIssue(BaseModel):
    code: str
    message: str
    field: str | None = None
    severity: Literal["error", "warning"] = "error"


class RuleValidationResult(BaseModel):
    valid: bool
    rule_id: str
    version: int | None = None
    issues: list[RuleValidationIssue] = Field(default_factory=list)
    checked_at: datetime = Field(default_factory=utc_now)


class RuleHistoryResponse(BaseModel):
    rule_id: str
    name: str
    configurable: bool
    locked: bool
    versions: list[ReusableRuleVersion]
    current_version: int
    draft_version: int | None = None
    active_version: int | None = None


class RuleVersionDetailResponse(BaseModel):
    rule: ReusableRuleVersion
    validation: RuleValidationResult
    history_count: int
    is_latest: bool
    is_editable_draft: bool


class RuleCreateRequest(BaseModel):
    name: str
    description: str
    rule_type: RuleType
    conditions: list[RuleCondition]
    action: RuleAction


class PatternDisposition(StrEnum):
    NEW = "NEW"
    REVIEWED = "REVIEWED"
    CONVERTED_TO_RULE = "CONVERTED_TO_RULE"
    DISMISSED = "DISMISSED"


class PatternEvidence(BaseModel):
    record_id: str
    counterpart_id: str | None = None
    observation: str


class PatternSuggestion(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    reconciliation_id: UUID
    pattern_key: str
    title: str
    summary: str
    observation_count: int = Field(ge=1)
    acceptance_ratio: float = Field(ge=0, le=1)
    consistency: float = Field(ge=0, le=1)
    estimated_impact: int = Field(ge=0)
    evidence: list[PatternEvidence]
    suggested_rule: RuleCreateRequest
    disposition: PatternDisposition = PatternDisposition.NEW
    created_at: datetime = Field(default_factory=utc_now)


class RuleSimulation(BaseModel):
    rule_id: str
    rule_version: int
    read_only: bool = True
    historical_observations: int = 0
    would_propose: int = 0
    correct_known_approvals: int = 0
    potential_new_cases: int = 0
    conflicts: int = 0
    rejected_decision_collisions: int = 0
    ambiguous_conflicts: int = 0
    duplicate_consumption_conflicts: int = 0
    activation_blocked: bool = False
    validation_errors: list[str] = Field(default_factory=list)


class RuleExecution(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    reconciliation_id: UUID
    rule_id: str
    rule_version: int
    records_evaluated: int = Field(ge=0)
    records_affected: int = Field(ge=0)
    automatic_reconciliations: int = Field(default=0, ge=0)
    action_authority: ActionAuthority = ActionAuthority.PROPOSE_ONLY
    result: Literal["available", "evaluated", "proposals_created", "no_trigger", "blocked"]
    timestamp: datetime = Field(default_factory=utc_now)


class ExportSchemaSource(StrEnum):
    CONFIGURED_POC = "CONFIGURED_POC"
    TEMPLATE = "TEMPLATE"


class ExportFieldGroup(StrEnum):
    RECONCILIATION_DERIVED = "RECONCILIATION_DERIVED"
    CP_GOVERNMENT = "CP_GOVERNMENT"
    PR_PURCHASE_REGISTER = "PR_PURCHASE_REGISTER"
    PROCESS_METADATA = "PROCESS_METADATA"


class ExportFieldDefinition(BaseModel):
    target_name: str
    group: ExportFieldGroup
    datatype: Literal["text", "number", "date", "datetime", "percentage"] = "text"
    required: bool = False
    confirmed: bool = True
    passthrough: bool = False
    internal_mapping: str | None = None


class ExportProfile(BaseModel):
    export_profile_id: str = "KIGS-GSTR2B-POC"
    name: str = "KIGS GSTR-2B Reconciliation POC"
    version: int = 1
    target_system: str = "KIGS"
    schema_source: ExportSchemaSource = ExportSchemaSource.CONFIGURED_POC
    field_order: list[str]
    fields: list[ExportFieldDefinition]
    required_fields: list[str]
    status_mapping: dict[str, str]
    action_mapping: dict[str, str]
    created_at: datetime = Field(default_factory=utc_now)


class ExportValidationIssue(BaseModel):
    code: str
    message: str


class ExportValidationResult(BaseModel):
    valid: bool
    issues: list[ExportValidationIssue] = Field(default_factory=list)
    state_version: str


class FinalReview(BaseModel):
    reconciliation_id: UUID
    exact_matches: int
    tolerance_matches: int
    near_matches: int
    human_selected_matches: int
    resolved_records: int
    unresolved_records: int
    ambiguous_records: int
    material_mismatch_records: int
    gst_only_records: int
    pr_only_records: int
    client_profile_id: UUID | None = None
    profile_version: int | None = None
    policy_version: int
    active_rules: list[dict[str, Any]] = Field(default_factory=list)
    export_profile: ExportProfile
    validation: ExportValidationResult


class ExportRecord(BaseModel):
    export_id: UUID = Field(default_factory=uuid4)
    version: int = Field(ge=1)
    reconciliation_id: UUID
    client_profile_id: UUID | None = None
    client_profile_version: int | None = None
    policy_version: int
    export_profile_id: str
    export_profile_version: int
    created_at: datetime = Field(default_factory=utc_now)
    created_by: str = "POC user"
    row_count: int = Field(ge=0)
    schema_source: ExportSchemaSource
    file_path: str
    sha256: str
    state_version: str
    stale: bool = False


class ProfileCreateRequest(BaseModel):
    client_name: str
    profile_name: str
    approved_by: str | None = None


class RuleDecisionRequest(BaseModel):
    actor: str = "POC user"
    note: str | None = None


class AmbiguousSelectionRequest(BaseModel):
    purchase_register_record_id: str | None = None
    action: Literal["select", "leave_unresolved"]
    unresolved_records: list[str] = Field(default_factory=list)
    approval_requests: list[ApprovalRequest] = Field(default_factory=list)
    audit_events: list[AgentEvent] = Field(default_factory=list)
    status: SessionStatus = SessionStatus.CREATED


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    service: str
    database: Literal["ok"] = "ok"
    provider: dict[str, Any] = Field(default_factory=dict)
    current_date: date = Field(default_factory=date.today)


class RoleDetectionResult(BaseModel):
    file_1_role: DatasetRole
    file_2_role: DatasetRole
    confidence: float = Field(ge=0.0, le=1.0)
    is_confident: bool
    reason: str


class QuickReconcileInterrupt(BaseModel):
    interrupt_type: Literal["mapping", "policy", "role_confirmation"]
    message: str
    action_label: str
    action_stage: str


class QuickReconcileResponse(BaseModel):
    reconciliation_id: UUID
    status: str
    current_stage: str
    stage_statuses: dict[str, str] = Field(default_factory=dict)
    government_records: int = 0
    purchase_register_records: int = 0
    summary: ReconciliationSummary | None = None
    near_summary: NearMatchReconciliationSummary | None = None
    exception_breakdown: ExceptionBreakdown | None = None
    profile_reused: bool = False
    profile_name: str | None = None
    interrupt: QuickReconcileInterrupt | None = None
    error: str | None = None


class RuleCatalogItem(BaseModel):
    rule_id: str
    name: str
    suggested_human_friendly_name: str
    category: str
    description: str
    stage: str
    execution_order: int
    enabled: bool = True
    configurable: bool
    locked: bool
    if_condition: str
    then_result: str
    human_friendly_if: str
    human_friendly_then: str
    authority: str
    source_of_truth: str
    version: int | str
    status: str
    parameters: Any | None = None
    dependencies: list[str] = Field(default_factory=list)
    conflicts_with: list[str] = Field(default_factory=list)
    side_effects: str | None = None
    audit_event_produced: bool = True
    safe_to_disable: bool = False
    toggle_safety: str
    execution_sequencing: str
    file_function_db_location: str
    notes: str | None = None
    approval: dict[str, Any] | None = None
    provenance: dict[str, Any] | None = None
    effectiveness: dict[str, Any] | None = None
    conditions: list[dict[str, Any]] | None = None
    action: dict[str, Any] | None = None


class RuleCatalogSummary(BaseModel):
    total_rules: int = Field(ge=0)
    configurable_count: int = Field(ge=0)
    locked_count: int = Field(ge=0)
    active_count: int = Field(ge=0)
    learned_count: int = Field(ge=0)


class ExecutionStageInfo(BaseModel):
    stage_id: str
    stage_name: str
    description: str
    execution_order: int
    reorderability: str
    rule_ids: list[str] = Field(default_factory=list)


class RuleCatalogResponse(BaseModel):
    rules: list[RuleCatalogItem]
    summary: RuleCatalogSummary
    stages: list[ExecutionStageInfo]
    llm_connected: bool = True
    llm_model: str = "gpt-5.4-mini"
    llm_provider: str = "openai"


