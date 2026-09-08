export type DatasetRole = "government" | "purchase_register";
export type CanonicalDataType = "string" | "number" | "date";

export type ColumnProfile = {
  column_name: string;
  inferred_dtype: CanonicalDataType;
  pandas_dtype: string;
  non_null_count: number;
  non_null_percentage: number;
  null_percentage: number;
  unique_count: number;
  sample_values: string[];
  minimum: string | null;
  maximum: string | null;
  pattern_hints: string[];
};

export type DatasetProfile = {
  role: DatasetRole;
  sheet_name: string;
  header_row: number;
  row_count: number;
  column_count: number;
  columns: string[];
  inferred_types: Record<string, string>;
  null_counts: Record<string, number>;
  column_profiles: ColumnProfile[];
};

export type UploadedFile = {
  role: DatasetRole;
  original_filename: string;
  stored_path: string;
  size_bytes: number;
  profile: DatasetProfile;
};

export type CanonicalFieldDefinition = {
  canonical_name: string;
  display_name: string;
  description: string;
  expected_datatype: CanonicalDataType;
  participates_in_matching: boolean;
  required_for_exact_match: boolean;
  aliases: string[];
};

export type ColumnMappingCandidate = {
  source_dataset: DatasetRole;
  source_column: string;
  canonical_field: string | null;
  confidence: number;
  rationale: string;
  proposed_by: "deterministic" | "ai" | "human";
  user_edited: boolean;
};

export type DatasetMappingProposal = {
  source_dataset: DatasetRole;
  mappings: ColumnMappingCandidate[];
};

export type MappingValidationIssue = {
  code: string;
  message: string;
  source_dataset: DatasetRole | null;
  source_column: string | null;
  canonical_field: string | null;
  severity: "error" | "warning";
};

export type MappingValidationResult = {
  valid: boolean;
  issues: MappingValidationIssue[];
  required_fields_mapped: Record<string, string[]>;
};

export type SchemaMappingProposal = {
  reconciliation_id: string;
  datasets: DatasetMappingProposal[];
  validation: MappingValidationResult;
  created_at: string;
  ai_provider_used: string | null;
  ai_model_used: string | null;
  provider_error: string | null;
};

export type ConfirmedMappingSet = {
  reconciliation_id: string;
  datasets: DatasetMappingProposal[];
  confirmed_at: string;
};

export type ReconciliationSummary = {
  reconciliation_id: string;
  status: "completed";
  government_records: number;
  purchase_register_records: number;
  exact_matches: number;
  remaining_government_records: number;
  remaining_purchase_register_records: number;
};

export type MatchOperator = "EXACT" | "ABSOLUTE_TOLERANCE" | "DATE_TOLERANCE";
export type ToleranceUnit = "INR" | "DAYS";
export type PolicyFieldRule = {
  canonical_field: string;
  enabled: boolean;
  required: boolean;
  operator: MatchOperator;
  priority: number;
  tolerance: { value: number; unit: ToleranceUnit } | null;
  weight: number | null;
};
export type ReconciliationPolicy = {
  id: string;
  name: string;
  rules: PolicyFieldRule[];
  status: "draft" | "proposed" | "awaiting_approval" | "confirmed" | "rejected";
  proposed_by: "deterministic" | "ai" | "human";
  natural_language_instruction: string | null;
  explanation: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
  confirmed_at: string | null;
};
export type PolicyValidationIssue = {
  code: string;
  message: string;
  canonical_field: string | null;
  severity: "error" | "warning";
};
export type PolicyValidationResult = {
  valid: boolean;
  issues: PolicyValidationIssue[];
};
export type PolicyProposal = {
  reconciliation_id: string;
  policy: ReconciliationPolicy;
  validation: PolicyValidationResult;
  created_at: string;
  ai_provider_used: string | null;
  ai_model_used: string | null;
  provider_error: string | null;
};
export type ToleranceSummary = {
  reconciliation_id: string;
  status: "completed";
  government_records: number;
  purchase_register_records: number;
  exact_matches: number;
  tolerance_matches: number;
  resolved_records: number;
  remaining_government_records: number;
  remaining_purchase_register_records: number;
  conflict_count: number;
};
export type MatchResult = {
  government_record_id: string;
  purchase_register_record_id: string;
  match_type: "exact" | "tolerance" | "near";
  matched_fields: string[];
  variances: Record<string, number>;
  allowed_tolerances: Record<string, number>;
  rules_satisfied: string[];
  government_values: Record<string, unknown>;
  purchase_register_values: Record<string, unknown>;
  policy_revision: number | null;
};
export type ResultStatus =
  "EXACT_MATCHED" | "TOLERANCE_MATCHED" | "NEAR_MATCHED" | "UNRESOLVED";
export type ResultItem = {
  status: ResultStatus;
  government_record_id: string | null;
  purchase_register_record_id: string | null;
  match: MatchResult | null;
};
export type ReconciliationResults = {
  summary: ToleranceSummary;
  records: ResultItem[];
  conflicts: {
    government_record_id: string;
    purchase_register_record_ids: string[];
    reason: string;
  }[];
};

export type AuditEvent = {
  id: string;
  event_type: string;
  actor_type: "system" | "user" | "agent";
  component: string;
  timestamp: string;
  input_count: number | null;
  output_count: number | null;
  result: string | null;
  metadata: Record<string, unknown>;
};

export type ReconciliationSession = {
  id: string;
  status: string;
  government_file: UploadedFile | null;
  purchase_register_file: UploadedFile | null;
  mapping_proposal: SchemaMappingProposal | null;
  confirmed_mapping: ConfirmedMappingSet | null;
  summary: ReconciliationSummary | null;
  policy_proposal: PolicyProposal | null;
  confirmed_policy: ReconciliationPolicy | null;
  tolerance_summary: ToleranceSummary | null;
  near_match_analysis: NearMatchAnalysis | null;
  near_match_summary: NearMatchSummary | null;
  client_profile_id: string | null;
  profile_version: number | null;
};

export type ReconciliationListItem = {
  id: string;
  status: string;
  created_at: string;
  updated_at: string;
  client_name: string | null;
  government_filename: string | null;
  purchase_register_filename: string | null;
  government_records: number;
  purchase_register_records: number;
  resolved_records: number;
  remaining_government_records: number;
  remaining_purchase_register_records: number;
  current_stage: "setup" | "mapping" | "policy" | "results" | "near-matches" | "exceptions" | "audit" | "final-review";
};

export type CandidateStatus =
  | "NEAR_MATCH_PROPOSED"
  | "NEAR_MATCH_APPROVED"
  | "AMBIGUOUS"
  | "REJECTED_CANDIDATE"
  | "MATERIAL_MISMATCH";
export type CandidateFeatures = {
  document_number_government_raw: string;
  document_number_purchase_raw: string;
  document_number_government_normalized: string;
  document_number_purchase_normalized: string;
  document_number_normalized_equal: boolean;
  document_number_similarity: number;
  document_date_difference_days: number;
  taxable_value_difference: number;
  igst_difference: number;
  cgst_difference: number;
  sgst_difference: number;
  cess_difference: number;
  gst_rate_match: boolean;
  document_type_match: boolean;
};
export type CandidateMatch = {
  id: string;
  government_record_id: string;
  purchase_register_record_id: string;
  match_score: number;
  rank: number;
  status: CandidateStatus;
  eligible_for_bulk_approval: boolean;
  reciprocal_best: boolean;
  score_gap: number | null;
  features: CandidateFeatures;
  reasons: string[];
  government_values: Record<string, unknown>;
  purchase_register_values: Record<string, unknown>;
};
export type NearMatchAnalysis = {
  reconciliation_id: string;
  candidates: CandidateMatch[];
  ambiguities: {
    government_record_id: string;
    candidate_ids: string[];
    candidate_count: number;
    top_candidate_score: number;
    second_candidate_score: number;
    score_gap: number;
    reason: string;
  }[];
  material_mismatch_government_ids: string[];
  gst_only_government_ids: string[];
  pr_only_purchase_register_ids: string[];
  summary: {
    candidate_count: number;
    high_confidence_proposals: number;
    ambiguous_government_records: number;
    material_mismatch_records: number;
    gst_only_records: number;
    pr_only_records: number;
    runtime_ms: number;
  };
};
export type NearMatchSummary = {
  reconciliation_id: string;
  status: "awaiting_near_match_approval" | "completed";
  government_records: number;
  purchase_register_records: number;
  exact_matches: number;
  tolerance_matches: number;
  near_match_proposals: number;
  near_matches: number;
  ambiguous_records: number;
  material_mismatch_records: number;
  gst_only_records: number;
  pr_only_records: number;
  resolved_records: number;
  remaining_government_records: number;
  remaining_purchase_register_records: number;
};
export type NearMatchBulkSkipReason = {
  candidate_id: string;
  government_record_id: string;
  purchase_register_record_id: string;
  code: string;
  message: string;
};
export type NearMatchBulkApprovalResult = {
  batch_id: string;
  reconciliation_id: string;
  requested: number;
  approved: number;
  skipped: number;
  failed: number;
  skip_reasons: NearMatchBulkSkipReason[];
  errors: string[];
  before: { resolved_records: number; government_open: number; purchase_register_remaining: number };
  after: { resolved_records: number; government_open: number; purchase_register_remaining: number };
  duplicate_pr_consumption: number;
  policy_revision: number | null;
  client_profile_id: string | null;
  profile_version: number | null;
  summary: NearMatchSummary;
};

export type SemanticCategory =
  | "PRIOR_PERIOD_ADJUSTMENT"
  | "ADVANCE_ADJUSTMENT"
  | "ITC_REVERSAL"
  | "GST_REGISTRATION_CHANGE"
  | "RCM_ADJUSTMENT"
  | "PRICE_CORRECTION"
  | "FREIGHT_ALLOCATION"
  | "REGULAR_PURCHASE"
  | "OTHER"
  | "INSUFFICIENT_EVIDENCE";
export type SemanticClassification = {
  id: string;
  record_id: string;
  source_dataset: DatasetRole;
  proposed_category: SemanticCategory;
  final_category: SemanticCategory | null;
  confidence: number;
  evidence_fields: string[];
  reason: string;
  suggested_action: string;
  requires_human_review: boolean;
  review_status:
    "ai_proposed" | "human_confirmed" | "human_overridden" | "unclassified";
  provider: string;
  model: string | null;
  created_at: string;
  updated_at: string;
};
export type ExceptionBreakdown = {
  reconciliation_id: string;
  remaining_government: number;
  remaining_purchase_register: number;
  ambiguous: number;
  material_mismatch: number;
  gst_only: number;
  pr_only: number;
  semantic_categories: Record<string, number>;
};
export type ExceptionRecord = {
  record_id: string;
  source_dataset: DatasetRole;
  status: "AMBIGUOUS" | "MATERIAL_MISMATCH" | "GST_ONLY" | "PR_ONLY";
  values: Record<string, unknown>;
  best_candidate: CandidateMatch | null;
  candidate_count: number;
  semantic_classification: SemanticClassification | null;
};
export type InvestigationEvidence = {
  reference_id: string;
  tool_name: string;
  fact_paths: string[];
  supports_reasoning_indexes: number[];
};
export type InvestigationConclusion = {
  classification: "AMBIGUOUS" | "MATERIAL_MISMATCH" | "GST_ONLY" | "PR_ONLY";
  conclusion_summary: string;
  likely_root_cause: string;
  reasoning_summary: string[];
  evidence: InvestigationEvidence[];
  recommended_action: string;
  confidence: number;
  insufficient_evidence: boolean;
  data_needed: string[];
  limitations: string[];
};
export type InvestigationTraceStep = {
  sequence: number;
  stage: "load" | "model" | "tool" | "validation" | "persist";
  name: string;
  started_at: string;
  completed_at: string;
  duration_ms: number;
  status: "completed" | "failed";
  structured_result: Record<string, unknown>;
};
export type AIInvestigation = {
  id: string;
  reconciliation_id: string;
  record_id: string;
  status: "completed" | "failed";
  conclusion: InvestigationConclusion | null;
  execution_trace: InvestigationTraceStep[];
  provider: string;
  model: string;
  started_at: string;
  completed_at: string;
  latency_ms: number;
  token_usage: Record<string, number> | null;
  validation_result: { valid: boolean; errors: string[] };
  error_code: string | null;
  error_message: string | null;
};
export type ExceptionSearchResult = {
  total: number;
  offset: number;
  limit: number;
  records: ExceptionRecord[];
};
export type CopilotToolCall = {
  tool_name: string;
  purpose: string;
  status: "completed" | "failed";
  result_count: number | null;
  duration_ms: number;
};
export type CopilotEvidence = {
  reference_type: string;
  reference_id: string;
  facts: Record<string, unknown>;
};
export type CopilotResponse = {
  id: string;
  conversation_id: string;
  answer: string;
  evidence: CopilotEvidence[];
  tool_calls: CopilotToolCall[];
  suggested_actions: string[];
  requires_human_action: boolean;
  provider: string;
  model: string | null;
  created_at: string;
};
export type CopilotMessage = {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  selected_record_id: string | null;
  response: CopilotResponse | null;
  created_at: string;
};
export type CopilotConversation = {
  conversation_id: string;
  reconciliation_id: string;
  messages: CopilotMessage[];
};
export type ClientProfile = {
  id: string;
  client_name: string;
  profile_name: string;
  status: "ACTIVE" | "DISABLED" | "ARCHIVED";
  version: number;
  saved_mapping: ConfirmedMappingSet;
  saved_policy: ReconciliationPolicy;
  created_from_reconciliation_id: string;
  active_rule_ids: string[];
  approved_by: string | null;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
};
export type RuleVersion = {
  rule_id: string;
  version: number;
  client_profile_id: string;
  name: string;
  description: string;
  rule_type:
    | "DETERMINISTIC"
    | "NORMALIZATION"
    | "TOLERANCE"
    | "CLASSIFICATION_ASSIST"
    | "HYBRID";
  status:
    | "DRAFT"
    | "PROPOSED"
    | "APPROVED"
    | "ACTIVE"
    | "DISABLED"
    | "RETIRED"
    | "REJECTED"
    | "SUPERSEDED";
  conditions: {
    field: string;
    operator: string;
    value: string | number | null;
  }[];
  action: { type: string; value: string | null };
  action_authority: "PROPOSE_ONLY";
  provenance: {
    type: string;
    reconciliation_id: string | null;
    pattern_suggestion_id: string | null;
    decision_count: number;
    summary: string;
    evidence_ids: string[];
  };
  effectiveness: {
    times_evaluated: number;
    times_triggered: number;
    approved_outcomes: number;
    rejected_outcomes: number;
    human_overrides: number;
    conflicts: number;
    sessions_used: number;
    last_used_at: string | null;
  };
  approval: {
    approved_by: string;
    approved_at: string;
    note: string | null;
  } | null;
  created_at: string;
};

export type RuleCatalogItem = {
  rule_id: string;
  name: string;
  suggested_human_friendly_name: string;
  category: string;
  description: string;
  stage: string;
  execution_order: number;
  enabled: boolean;
  configurable: boolean;
  locked: boolean;
  if_condition: string;
  then_result: string;
  human_friendly_if: string;
  human_friendly_then: string;
  authority: string;
  source_of_truth: string;
  version: number | string;
  status: string;
  parameters?: unknown;
  dependencies: string[];
  conflicts_with: string[];
  side_effects: string | null;
  audit_event_produced: boolean;
  safe_to_disable: boolean;
  toggle_safety: string;
  execution_sequencing: string;
  thinking_steps?: string[];
  formula?: string;
  conditions?: unknown[];
  action?: unknown;
  file_function_db_location: string;
  notes: string | null;
  approval?: {
    approved_by: string;
    approved_at: string;
    note: string | null;
  } | null;
  provenance?: {
    type: string;
    reconciliation_id?: string;
    pattern_suggestion_id?: string;
    decision_count?: number;
    summary?: string;
    evidence_ids?: string[];
  } | null;
  effectiveness?: Record<string, unknown> | null;
  conditions?: { field: string; operator: string; value: unknown }[] | null;
  action?: { type: string; value: unknown } | null;
};

export type RuleCatalogSummary = {
  total_rules: number;
  configurable_count: number;
  locked_count: number;
  active_count: number;
  learned_count: number;
};

export type ExecutionStageInfo = {
  stage_id: string;
  stage_name: string;
  description: string;
  execution_order: number;
  reorderability: "FIXED_ORDER" | "ORDER_WITHIN_STAGE";
  rule_ids: string[];
};

export type RuleCatalogResponse = {
  rules: RuleCatalogItem[];
  summary: RuleCatalogSummary;
  stages: ExecutionStageInfo[];
  llm_connected?: boolean;
  llm_model?: string;
  llm_provider?: string;
};

export type PatternSuggestion = {
  id: string;
  reconciliation_id: string;
  pattern_key: string;
  title: string;
  summary: string;
  observation_count: number;
  acceptance_ratio: number;
  consistency: number;
  estimated_impact: number;
  evidence: {
    record_id: string;
    counterpart_id: string | null;
    observation: string;
  }[];
  suggested_rule: {
    name: string;
    description: string;
    rule_type: string;
    conditions: {
      field: string;
      operator: string;
      value?: string | number | null;
    }[];
    action: { type: string; value?: string | null };
  };
  disposition: "NEW" | "REVIEWED" | "CONVERTED_TO_RULE" | "DISMISSED";
};
export type RuleSimulation = {
  rule_id: string;
  rule_version: number;
  read_only: boolean;
  historical_observations: number;
  would_propose: number;
  correct_known_approvals: number;
  potential_new_cases: number;
  conflicts: number;
  rejected_decision_collisions: number;
  ambiguous_conflicts: number;
  duplicate_consumption_conflicts: number;
  activation_blocked: boolean;
  validation_errors: string[];
};
export type ProfileCompatibility = {
  profile_id: string;
  reconciliation_id: string;
  status:
    | "PROFILE_COMPATIBLE"
    | "PROFILE_PARTIALLY_COMPATIBLE"
    | "PROFILE_INCOMPATIBLE";
  compatible_fields: string[];
  missing_fields: string[];
  confirmation_required: boolean;
};
export type ExportValidation = {
  valid: boolean;
  issues: { code: string; message: string }[];
  state_version: string;
};
export type ExportProfile = {
  export_profile_id: string;
  name: string;
  version: number;
  target_system: string;
  schema_source: "CONFIGURED_POC" | "TEMPLATE";
};
export type FinalReview = {
  reconciliation_id: string;
  exact_matches: number;
  tolerance_matches: number;
  near_matches: number;
  human_selected_matches: number;
  resolved_records: number;
  unresolved_records: number;
  ambiguous_records: number;
  material_mismatch_records: number;
  gst_only_records: number;
  pr_only_records: number;
  client_profile_id: string | null;
  profile_version: number | null;
  policy_version: number;
  active_rules: {
    rule_id: string;
    version: number;
    status: string;
    action_authority: string;
  }[];
  export_profile: ExportProfile;
  validation: ExportValidation;
};
export type ExportRecord = {
  export_id: string;
  version: number;
  reconciliation_id: string;
  created_at: string;
  created_by: string;
  row_count: number;
  schema_source: "CONFIGURED_POC" | "TEMPLATE";
  sha256: string;
  stale: boolean;
  export_profile_id: string;
  export_profile_version: number;
  policy_version: number;
};

type ErrorDetail =
  | string
  | {
      code?: string;
      message?: string;
      validation?: MappingValidationResult;
      policy_validation?: PolicyValidationResult;
    };

export class ApiError extends Error {
  status: number;
  code?: string;
  validation?: MappingValidationResult;
  policyValidation?: PolicyValidationResult;

  constructor(status: number, detail: ErrorDetail | undefined) {
    const message = typeof detail === "string" ? detail : detail?.message;
    super(message ?? `Request failed (${status})`);
    this.status = status;
    if (typeof detail === "object") {
      this.code = detail.code;
      this.validation = detail.validation;
      this.policyValidation = detail.policy_validation;
    }
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      detail?: ErrorDetail;
    } | null;
    throw new ApiError(response.status, payload?.detail);
  }
  return response.json() as Promise<T>;
}

export type RoleDetectionResult = {
  file_1_role: DatasetRole;
  file_2_role: DatasetRole;
  confidence: number;
  is_confident: boolean;
  reason: string;
};

export type QuickReconcileInterrupt = {
  interrupt_type: "mapping" | "policy" | "role_confirmation";
  message: string;
  action_label: string;
  action_stage: string;
};

export type QuickReconcileResponse = {
  reconciliation_id: string;
  status: string;
  current_stage: string;
  stage_statuses: Record<string, string>;
  government_records: number;
  purchase_register_records: number;
  summary: ReconciliationSummary | null;
  near_summary: NearMatchSummary | null;
  exception_breakdown: any | null;
  profile_reused: boolean;
  profile_name: string | null;
  interrupt: QuickReconcileInterrupt | null;
  error: string | null;
};

export const api = {
  listReconciliations: () =>
    request<ReconciliationListItem[]>("/api/reconciliations"),
  create: () =>
    request<ReconciliationSession>("/api/reconciliations", { method: "POST" }),
  getSession: (id: string, includeNearAnalysis = true, signal?: AbortSignal) =>
    request<ReconciliationSession>(
      `/api/reconciliations/${id}?include_near_analysis=${includeNearAnalysis}`,
      { signal },
    ),
  canonicalFields: () =>
    request<CanonicalFieldDefinition[]>("/api/schema/canonical-fields"),
  upload: (
    id: string,
    role: "government" | "purchase-register",
    file: File,
  ) => {
    const body = new FormData();
    body.append("file", file);
    return request<UploadedFile>(`/api/reconciliations/${id}/files/${role}`, {
      method: "POST",
      body,
    });
  },
  analyzeMapping: (id: string) =>
    request<SchemaMappingProposal>(
      `/api/reconciliations/${id}/mapping/analyze`,
      {
        method: "POST",
      },
    ),
  getMapping: (id: string) =>
    request<SchemaMappingProposal>(`/api/reconciliations/${id}/mapping`),
  updateMapping: (id: string, datasets: DatasetMappingProposal[]) =>
    request<SchemaMappingProposal>(`/api/reconciliations/${id}/mapping`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ datasets }),
    }),
  confirmMapping: (id: string) =>
    request<ConfirmedMappingSet>(`/api/reconciliations/${id}/mapping/confirm`, {
      method: "POST",
    }),
  runExact: (id: string) =>
    request<ReconciliationSummary>(
      `/api/reconciliations/${id}/run/exact-match`,
      {
        method: "POST",
      },
    ),
  proposePolicy: (id: string, instruction?: string) =>
    request<PolicyProposal>(`/api/reconciliations/${id}/policy/propose`, {
      method: "POST",
      headers: instruction ? { "Content-Type": "application/json" } : undefined,
      body: instruction ? JSON.stringify({ instruction }) : undefined,
    }),
  getPolicy: (id: string) =>
    request<PolicyProposal>(`/api/reconciliations/${id}/policy`),
  updatePolicy: (id: string, policy: ReconciliationPolicy) =>
    request<PolicyProposal>(`/api/reconciliations/${id}/policy`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ policy }),
    }),
  confirmPolicy: (id: string) =>
    request<ReconciliationPolicy>(`/api/reconciliations/${id}/policy/confirm`, {
      method: "POST",
    }),
  runTolerance: (id: string) =>
    request<ToleranceSummary>(
      `/api/reconciliations/${id}/run/tolerance-match`,
      { method: "POST" },
    ),
  analyzeNearMatches: (id: string) =>
    request<NearMatchAnalysis>(
      `/api/reconciliations/${id}/near-match/analyze`,
      { method: "POST" },
    ),
  nearMatches: (id: string) =>
    request<NearMatchAnalysis>(`/api/reconciliations/${id}/near-match`),
  decideNearMatch: (
    id: string,
    candidateId: string,
    action: "approve" | "reject",
  ) =>
    request<NearMatchSummary>(
      `/api/reconciliations/${id}/near-match/${candidateId}/decision`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      },
    ),
  bulkApproveNearMatches: (id: string) =>
    request<NearMatchBulkApprovalResult>(
      `/api/reconciliations/${id}/near-match/bulk-approve`,
      { method: "POST" },
    ),
  exceptionBreakdown: (id: string, signal?: AbortSignal) =>
    request<ExceptionBreakdown>(`/api/reconciliations/${id}/exceptions`, { signal }),
  exceptionRecords: (id: string, category: string, offset: number, limit: number, signal?: AbortSignal) => {
    const query = new URLSearchParams({ category, offset: String(offset), limit: String(limit) });
    return request<ExceptionSearchResult>(
      `/api/reconciliations/${id}/exceptions/records?${query}`,
      { signal },
    );
  },
  searchExceptions: (id: string, filters: Record<string, unknown>, signal?: AbortSignal) =>
    request<ExceptionSearchResult>(
      `/api/reconciliations/${id}/exceptions/search`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(filters),
        signal,
      },
    ),
  exceptionRecord: (id: string, recordId: string, signal?: AbortSignal) =>
    request<ExceptionRecord>(
      `/api/reconciliations/${id}/records/${encodeURIComponent(recordId)}?include_source_values=false`,
      { signal },
    ),
  rankedCandidates: (id: string, recordId: string, signal?: AbortSignal) =>
    request<CandidateMatch[]>(
      `/api/reconciliations/${id}/records/${encodeURIComponent(recordId)}/candidates`,
      { signal },
    ),
  investigationStatus: (id: string, signal?: AbortSignal) =>
    request<{ available: boolean; provider: "openai"; model: string; reason: string | null }>(
      `/api/reconciliations/${id}/ai-investigation/status`,
      { signal },
    ),
  investigateException: (id: string, recordId: string, signal?: AbortSignal) =>
    request<AIInvestigation>(
      `/api/reconciliations/${id}/records/${encodeURIComponent(recordId)}/ai-investigations`,
      { method: "POST", signal },
    ),
  investigations: (id: string, recordId: string, signal?: AbortSignal) =>
    request<AIInvestigation[]>(
      `/api/reconciliations/${id}/records/${encodeURIComponent(recordId)}/ai-investigations`,
      { signal },
    ),
  semanticStatus: (id: string, signal?: AbortSignal) =>
    request<{
      available: boolean;
      provider: string | null;
      model: string | null;
    }>(`/api/reconciliations/${id}/exceptions/semantic-status`, { signal }),
  analyzeSemantics: (id: string, recordIds?: string[]) =>
    request<{
      requested: number;
      completed: number;
      failed: number;
      classifications: SemanticClassification[];
      failures: Record<string, string>;
    }>(`/api/reconciliations/${id}/exceptions/semantic-analysis`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(recordIds ? { record_ids: recordIds } : {}),
    }),
  semanticDecision: (
    id: string,
    recordId: string,
    action: "confirm" | "override" | "leave_unclassified",
    category?: SemanticCategory,
  ) =>
    request<SemanticClassification>(
      `/api/reconciliations/${id}/records/${recordId}/semantic-decision`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, category }),
      },
    ),
  selectAmbiguous: (
    id: string,
    recordId: string,
    action: "select" | "leave_unresolved",
    purchaseId?: string,
  ) =>
    request<NearMatchSummary>(
      `/api/reconciliations/${id}/ambiguous/${recordId}/select`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          purchase_register_record_id: purchaseId,
        }),
      },
    ),
  askCopilot: (
    id: string | null,
    message: string,
    conversationId?: string,
    selectedRecordId?: string,
    currentPage?: string,
    conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>,
  ) =>
    request<CopilotResponse>(
      id ? `/api/reconciliations/${id}/copilot/messages` : "/api/reconciliations/copilot/messages",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          conversation_id: conversationId,
          reconciliation_id: id ?? undefined,
          selected_record_id: selectedRecordId,
          current_page: currentPage,
          conversation_history: conversationHistory ?? [],
        }),
      },
    ),
  copilotConversation: (id: string | null, conversationId: string) =>
    request<CopilotConversation>(
      id
        ? `/api/reconciliations/${id}/copilot/conversation?conversation_id=${conversationId}`
        : `/api/reconciliations/copilot/conversation?conversation_id=${conversationId}`,
    ),
  profiles: () => request<ClientProfile[]>("/api/client-profiles"),
  createProfile: (
    reconciliationId: string,
    clientName: string,
    profileName: string,
  ) =>
    request<ClientProfile>(
      `/api/client-profiles/from-reconciliation/${reconciliationId}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_name: clientName,
          profile_name: profileName,
          approved_by: "POC user",
        }),
      },
    ),
  profile: (id: string) => request<ClientProfile>(`/api/client-profiles/${id}`),
  newFromProfile: (id: string) =>
    request<ReconciliationSession>(
      `/api/client-profiles/${id}/reconciliations`,
      { method: "POST" },
    ),
  profileCompatibility: (
    profileId: string,
    reconciliationId: string,
    apply = false,
  ) =>
    request<ProfileCompatibility>(
      `/api/client-profiles/${profileId}/reconciliations/${reconciliationId}/compatibility?apply_if_compatible=${apply}`,
      { method: "POST" },
    ),
  finalReview: (id: string) =>
    request<FinalReview>(`/api/reconciliations/${id}/final-review`),
  exports: (id: string) =>
    request<ExportRecord[]>(`/api/reconciliations/${id}/exports`),
  generateExport: (id: string) =>
    request<ExportRecord>(`/api/reconciliations/${id}/exports`, {
      method: "POST",
    }),
  exportDownloadUrl: (id: string, exportId: string) =>
    `/api/reconciliations/${id}/exports/${exportId}/download`,
  rulesCatalog: () => request<RuleCatalogResponse>("/api/rules/catalog"),
  rules: (profileId?: string) =>
    request<RuleVersion[]>(
      profileId ? `/api/client-profiles/${profileId}/rules` : "/api/rules",
    ),
  ruleHistory: (id: string) =>
    request<RuleVersion[]>(`/api/rules/${id}/history`),
  simulateRule: (id: string, reconciliationId: string) =>
    request<RuleSimulation>(
      `/api/rules/${id}/simulate?reconciliation_id=${reconciliationId}`,
      { method: "POST" },
    ),
  approveRule: (id: string) =>
    request<RuleVersion>(`/api/rules/${id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actor: "POC user" }),
    }),
  activateRule: (id: string) =>
    request<RuleVersion>(`/api/rules/${id}/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actor: "POC user" }),
    }),
  patterns: (id: string) =>
    request<PatternSuggestion[]>(`/api/reconciliations/${id}/patterns`),
  detectPatterns: (id: string) =>
    request<PatternSuggestion[]>(`/api/reconciliations/${id}/patterns/detect`, {
      method: "POST",
    }),
  patternToRule: (
    reconciliationId: string,
    patternId: string,
    profileId: string,
  ) =>
    request<RuleVersion>(
      `/api/reconciliations/${reconciliationId}/patterns/${patternId}/create-rule?profile_id=${profileId}`,
      { method: "POST" },
    ),

  detectRoles: (file1: File, file2: File) => {
    const formData = new FormData();
    formData.append("file_1", file1);
    formData.append("file_2", file2);
    return request<RoleDetectionResult>("/api/reconciliations/detect-roles", {
      method: "POST",
      body: formData,
    });
  },
  quickReconcile: (
    file1: File,
    file2: File,
    options?: {
      instruction?: string;
      profile_id?: string;
      file_1_role?: DatasetRole;
      file_2_role?: DatasetRole;
    },
  ) => {
    const formData = new FormData();
    formData.append("file_1", file1);
    formData.append("file_2", file2);
    if (options?.instruction) formData.append("instruction", options.instruction);
    if (options?.profile_id) formData.append("profile_id", options.profile_id);
    if (options?.file_1_role) formData.append("file_1_role", options.file_1_role);
    if (options?.file_2_role) formData.append("file_2_role", options.file_2_role);
    return request<QuickReconcileResponse>("/api/reconciliations/quick-reconcile", {
      method: "POST",
      body: formData,
    });
  },
  quickResume: (
    reconciliationId: string,
    options?: { instruction?: string; profile_id?: string },
  ) => {
    const params = new URLSearchParams();
    if (options?.instruction) params.append("instruction", options.instruction);
    if (options?.profile_id) params.append("profile_id", options.profile_id);
    const qs = params.toString();
    return request<QuickReconcileResponse>(
      `/api/reconciliations/${reconciliationId}/quick-resume${qs ? `?${qs}` : ""}`,
      { method: "POST" },
    );
  },
  results: (id: string, status?: ResultStatus) =>
    request<ReconciliationResults>(
      `/api/reconciliations/${id}/results${status ? `?status=${status}` : ""}`,
    ),
  auditEvents: (id?: string | null) =>
    request<AuditEvent[]>(
      id
        ? `/api/reconciliations/${id}/audit-events?limit=200`
        : "/api/reconciliations/audit-events?limit=200",
    ),
  compileRuleWithAI: (prompt: string, reconciliationId?: string) =>
    request<RuleCatalogItem>("/api/rules/compile-ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, reconciliation_id: reconciliationId ?? null }),
    }),
  deleteRule: (ruleId: string) =>
    request<{ success: boolean; message: string; rule_id: string }>(
      `/api/rules/${encodeURIComponent(ruleId)}`,
      { method: "DELETE" }
    ),
  bulkDeleteRules: (ruleIds: string[]) =>
    request<{ success: boolean; deleted_count: number; rule_ids: string[] }>(
      "/api/rules/bulk-delete",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rule_ids: ruleIds }),
      }
    ),
};

