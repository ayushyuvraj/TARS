export interface AlternativeMatch {
  pr_column: string;
  confidence: number;
  reason: string;
}

export interface DirectColumnCorrelation {
  gstr_column: string;
  gstr_dtype: string;
  gstr_samples: string[];
  selected_pr_column: string | null;
  confidence: number;
  reason: string;
  engine: string;
  alternatives: AlternativeMatch[];
  is_primary_gst_field: boolean;
  canonical_concept?: string | null;
  user_edited?: boolean;
}

export interface AgentThought {
  step: string;
  message: string;
  timestamp_ms: number;
  duration_ms: number;
  model?: string | null;
}

export interface DirectCorrelationResult {
  reconciliation_id: string;
  gstr_filename: string;
  pr_filename: string;
  total_gstr_columns: number;
  total_pr_columns: number;
  correlations: DirectColumnCorrelation[];
  pr_columns: string[];
  agent_thoughts: AgentThought[];
  model_used?: string | null;
  total_duration_ms: number;
}

export type NormalizationType =
  | "TRIM_WHITESPACE"
  | "STRIP_SPECIAL_CHARS"
  | "UPPERCASE"
  | "REMOVE_PREFIXES"
  | "TRIM_LEADING_ZEROS"
  | "ALPHANUMERIC_ONLY";

export type MatchStrategy =
  | "EXACT"
  | "NORMALIZED_TEXT"
  | "NUMERIC_TOLERANCE"
  | "DATE_PROXIMITY"
  | "VALUE_GUARD";

export interface FieldMatchRule {
  rule_id: string;
  gstr_column: string;
  pr_column: string;
  canonical_concept?: string | null;
  strategy: MatchStrategy;
  normalizers: NormalizationType[];
  tolerance_value: number;
  date_tolerance_days: number;
  is_active: boolean;
}

export interface MatchingPass {
  pass_id: string;
  name: string;
  description: string;
  tier: number;
  is_enabled: boolean;
  rules: FieldMatchRule[];
}

export interface SampleMatchPair {
  gstr_row_index: number;
  pr_row_index: number;
  gstr_preview: Record<string, string>;
  pr_preview: Record<string, string>;
  matched_by_pass: string;
  normalized_values: Record<string, string>;
}

export interface SimulationYield {
  pass_id: string;
  pass_name: string;
  tier: number;
  matched_count: number;
  cumulative_matched: number;
  pass_match_percentage: number;
  sample_matches: SampleMatchPair[];
}

export interface SimulationResult {
  total_gstr_rows: number;
  total_pr_rows: number;
  total_matched: number;
  total_unmatched_gstr: number;
  total_unmatched_pr: number;
  overall_match_rate: number;
  waterfall: SimulationYield[];
}

export type DateToleranceUnit = "DAYS" | "MONTHS" | "YEARS";
export type NumericToleranceMode = "ABSOLUTE_INR" | "PERCENTAGE";

export interface Rule2Item {
  id: string;
  name: string;
  description: string;
  category: string;
  gstr_column: string;
  pr_column: string;
  canonical_concept?: string | null;
  strategy: MatchStrategy;
  normalizers: NormalizationType[];
  tolerance_value: number;
  tolerance_mode: NumericToleranceMode;
  date_tolerance_value: number;
  date_tolerance_unit: DateToleranceUnit;
  is_enabled: boolean;
  execution_order: number;
  plain_english_explanation: string;
  why_it_matters: string;
  column_status?: "AVAILABLE" | "MISSING" | "UNMAPPED";
  missing_reason?: string | null;
  ai_rationale?: string | null;
  is_ai_suggested?: boolean;
  rule_tier?: "CORE_STATUTORY" | "COMMERCIAL_POLICY" | "AUXILIARY_METADATA";
  statutory_reference?: string | null;
  advisory_caution?: string | null;
  created_at?: string | null;
  created_by?: string | null;
  created_in_run?: string | null;
  version?: string;
  last_modified_at?: string | null;
  last_modified_by?: string | null;
  is_custom?: boolean;
}

export interface SessionRulesResponse {
  pipeline_rules: Rule2Item[];
  ai_suggested_rules: Rule2Item[];
}

export interface RuleBreakdownStat {
  rule_id: string;
  rule_name: string;
  category: string;
  individual_satisfied_count: number;
  individual_satisfied_percentage: number;
  is_bottleneck: boolean;
}

export interface SimulationResultV2 {
  total_gstr_rows: number;
  total_pr_rows: number;
  total_matched: number;
  overall_match_rate: number;
  total_unmatched_gstr: number;
  total_unmatched_pr: number;
  rule_breakdowns: RuleBreakdownStat[];
  sample_matches: SampleMatchPair[];
}

export interface ReconciliationV2Session {
  id: string;
  status: string;
  created_at: string;
  gstr_filename?: string | null;
  pr_filename?: string | null;
  correlation?: DirectCorrelationResult | null;
  selected_rule_ids?: string[];
  rule_execution_order?: string[];
  waterfall_passes?: MatchingPass[];
  rules_v2?: Rule2Item[];
}

// --- Stage 4 Results Models ---

export interface ScoreBreakdown {
  invoice_similarity: number;
  amount_score: number;
  date_score: number;
  tax_score: number;
}

export interface AmbiguityCandidate {
  candidate_id: string;
  pr_row_index: number;
  pr_record_id: string;
  confidence_score: number;
  score_breakdown: ScoreBreakdown;
  detected_differences: string[];
  ai_reason: string;
  pr_preview: Record<string, any>;
}

export interface AmbiguityCluster {
  cluster_id: string;
  gstr_row_index: number;
  gstr_record_id: string;
  anchor_preview: Record<string, any>;
  candidates: AmbiguityCandidate[];
  ai_justification: string;
  status: "PENDING_REVIEW" | "RESOLVED" | "REJECTED";
  resolved_pr_record_id?: string | null;
  resolved_pr_row_index?: number | null;
  resolved_at?: string | null;
}

export interface ReconciliationRecordItem {
  id: string;
  bucket: "EXACT_MATCH" | "TOLERANCE_MATCH" | "NEAR_MATCH" | "AMBIGUOUS" | "GSTR_ONLY" | "PR_ONLY" | "RESOLVED_MANUALLY";
  gstr_row_index?: number | null;
  pr_row_index?: number | null;
  gstr_record_id?: string | null;
  pr_record_id?: string | null;
  gstin: string;
  document_number: string;
  document_date?: string | null;
  taxable_value: number;
  tax_amount: number;
  total_value: number;
  gstr_preview: Record<string, any>;
  pr_preview: Record<string, any>;
  variances: Record<string, any>;
  matched_by_pass: string;
  ambiguity_cluster_id?: string | null;
  classification_reason?: string;
  ai_reason?: string;
}

export interface WaterfallPassYield {
  tier: number;
  name: string;
  matched_count: number;
  matched_itc: number;
  retention_percentage: number;
}

export interface Stage4ResultsSummary {
  total_gstr_rows: number;
  total_pr_rows: number;
  exact_match_count: number;
  exact_match_itc: number;
  tolerance_match_count: number;
  tolerance_match_itc: number;
  near_match_count: number;
  near_match_itc: number;
  ambiguous_count: number;
  ambiguous_itc: number;
  gstr_only_count: number;
  gstr_only_itc: number;
  pr_only_count: number;
  pr_only_itc: number;
  total_reconciled_count: number;
  total_reconciled_itc: number;
  overall_reconciliation_rate: number;
  waterfall_passes: WaterfallPassYield[];
}

export interface ComparedColumnInfo {
  rule_id: string;
  rule_name: string;
  category: string;
  strategy: string;
  gstr_column: string;
  pr_column: string;
  field_a?: string;
  field_b?: string;
  tolerance_summary?: string;
}

export interface Stage4ExecutionResponse {
  session_id: string;
  summary: Stage4ResultsSummary;
  records: ReconciliationRecordItem[];
  ambiguities: AmbiguityCluster[];
  compared_columns?: ComparedColumnInfo[];
}

const API_BASE = "/api/reconciliations-v2";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let errorDetail = "API Error";
    try {
      const errJson = await res.json();
      errorDetail = errJson.detail || JSON.stringify(errJson);
    } catch {
      errorDetail = await res.text();
    }
    throw new Error(errorDetail);
  }
  return res.json() as Promise<T>;
}

export const apiV2 = {
  async createSession(): Promise<ReconciliationV2Session> {
    return request<ReconciliationV2Session>(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" }
    });
  },

  async getSession(id: string): Promise<ReconciliationV2Session> {
    return request<ReconciliationV2Session>(`${API_BASE}/${id}`);
  },

  async fastUploadAndCorrelate(
    id: string,
    governmentFile: File,
    purchaseFile: File
  ): Promise<DirectCorrelationResult> {
    const formData = new FormData();
    formData.append("government_file", governmentFile);
    formData.append("purchase_file", purchaseFile);

    return request<DirectCorrelationResult>(
      `${API_BASE}/${id}/fast-upload-and-correlate`,
      {
        method: "POST",
        body: formData
      }
    );
  },

  async confirmMapping(
    id: string,
    correlations: DirectColumnCorrelation[]
  ): Promise<ReconciliationV2Session> {
    return request<ReconciliationV2Session>(`${API_BASE}/${id}/mapping/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ correlations })
    });
  },

  async getWaterfall(id: string): Promise<MatchingPass[]> {
    return request<MatchingPass[]>(`${API_BASE}/${id}/rules/waterfall`);
  },

  async simulateRules(id: string, passes: MatchingPass[]): Promise<SimulationResult> {
    return request<SimulationResult>(`${API_BASE}/${id}/rules/simulate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passes })
    });
  },

  async confirmWaterfall(
    id: string,
    passes: MatchingPass[]
  ): Promise<ReconciliationV2Session> {
    return request<ReconciliationV2Session>(`${API_BASE}/${id}/rules/confirm-waterfall`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passes })
    });
  },

  async confirmRules(
    id: string,
    selectedRuleIds: string[],
    ruleExecutionOrder: string[]
  ): Promise<ReconciliationV2Session> {
    return request<ReconciliationV2Session>(`${API_BASE}/${id}/rules/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        selected_rule_ids: selectedRuleIds,
        rule_execution_order: ruleExecutionOrder
      })
    });
  },

  async getSessionRules(sessionId: string): Promise<SessionRulesResponse> {
    return request<SessionRulesResponse>(`${API_BASE}/${sessionId}/rules-v2`);
  },

  async acceptRuleV2(sessionId: string, rule: Rule2Item): Promise<SessionRulesResponse> {
    return request<SessionRulesResponse>(`${API_BASE}/${sessionId}/rules-v2/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rule)
    });
  },

  async refreshAiSuggestedRules(sessionId: string, identifyMore: boolean = false): Promise<Rule2Item[]> {
    return request<Rule2Item[]>(`${API_BASE}/${sessionId}/rules-v2/suggest-ai`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identify_more: identifyMore })
    });
  },


  async getRules2Catalog(): Promise<Rule2Item[]> {
    return request<Rule2Item[]>(`${API_BASE}/rules-v2/catalog`);
  },

  async saveRules2Catalog(rules: Rule2Item[]): Promise<Rule2Item[]> {
    return request<Rule2Item[]>(`${API_BASE}/rules-v2/catalog`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rules)
    });
  },

  async deleteRuleFromCatalog(ruleId: string): Promise<Rule2Item[]> {
    return request<Rule2Item[]>(`${API_BASE}/rules-v2/catalog/${encodeURIComponent(ruleId)}`, {
      method: "DELETE"
    });
  },

  async batchDeleteRulesFromCatalog(ruleIds: string[]): Promise<Rule2Item[]> {
    return request<Rule2Item[]>(`${API_BASE}/rules-v2/catalog/delete-batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rule_ids: ruleIds })
    });
  },

  async compileAiRule(prompt: string, availableColumns: string[] = []): Promise<Rule2Item> {
    return request<Rule2Item>(`${API_BASE}/rules-v2/compile-ai`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, available_columns: availableColumns })
    });
  },

  async simulateRulesV2(id: string, rules: Rule2Item[], signal?: AbortSignal): Promise<SimulationResultV2> {
    return request<SimulationResultV2>(`${API_BASE}/${id}/rules-v2/simulate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rules }),
      signal
    });
  },

  async confirmRulesV2(id: string, rules: Rule2Item[]): Promise<ReconciliationV2Session> {
    return request<ReconciliationV2Session>(`${API_BASE}/${id}/rules-v2/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rules })
    });
  },

  // --- Stage 4 Results Endpoints ---
  async executeStage4Results(sessionId: string): Promise<Stage4ExecutionResponse> {
    return request<Stage4ExecutionResponse>(`${API_BASE}/${sessionId}/results/execute`, {
      method: "POST"
    });
  },

  async getStage4Results(sessionId: string): Promise<Stage4ExecutionResponse> {
    return request<Stage4ExecutionResponse>(`${API_BASE}/${sessionId}/results`);
  },

  async resolveAmbiguity(
    sessionId: string,
    clusterId: string,
    chosenCandidateId?: string,
    action: "CHOOSE" | "REJECT" = "CHOOSE"
  ): Promise<Stage4ExecutionResponse> {
    return request<Stage4ExecutionResponse>(`${API_BASE}/${sessionId}/results/resolve-ambiguity`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cluster_id: clusterId,
        chosen_candidate_id: chosenCandidateId,
        action
      })
    });
  },

  // --- Audit 2.0 Endpoints ---
  async getAuditStats(): Promise<AuditStats> {
    return request<AuditStats>(`${API_BASE}/audit/stats`);
  },

  async listAuditRuns(): Promise<V2RunRecord[]> {
    return request<V2RunRecord[]>(`${API_BASE}/audit/runs`);
  },

  async getAuditRun(runId: string): Promise<V2RunRecord> {
    return request<V2RunRecord>(`${API_BASE}/audit/runs/${encodeURIComponent(runId)}`);
  },

  async listAuditSessions(): Promise<ReconciliationV2Session[]> {
    return request<ReconciliationV2Session[]>(`${API_BASE}/audit/sessions`);
  },

  async resumeSessionFromRun(runId: string): Promise<{ session_id: string; target_stage: string; resume_url: string }> {
    return request<{ session_id: string; target_stage: string; resume_url: string }>(
      `${API_BASE}/audit/runs/${encodeURIComponent(runId)}/resume`,
      { method: "POST" }
    );
  }
};

export interface AuditStats {
  total_runs: number;
  total_sessions: number;
  success_rate: number;
  failed_runs: number;
  avg_duration_ms: number;
  total_steps: number;
  errors_captured: number;
  reconciled_volume_cr: number;
}

export interface V2LogEntry {
  timestamp_ms: number;
  level: "TRACE" | "DEBUG" | "INFO" | "WARN" | "ERROR";
  message: string;
  data?: Record<string, any> | null;
}

export interface V2StepErrorDetail {
  error_code: string;
  severity: "CRITICAL" | "ERROR" | "WARNING" | "INFO";
  message: string;
  offending_entities: string[];
  stack_trace?: string | null;
  root_cause_category: string;
  suggested_remediation: string;
  remediation_action?: Record<string, any> | null;
}

export interface V2AuditStep {
  step_id: string;
  run_id: string;
  session_id: string;
  stage_key: string;
  step_order: number;
  name: string;
  description: string;
  component: string;
  actor: "SYSTEM" | "AI_AGENT" | "USER" | string;
  status: "RUNNING" | "COMPLETED" | "FAILED" | "SKIPPED";
  duration_ms: number;
  started_at: string;
  completed_at?: string | null;
  input_summary: Record<string, any>;
  output_summary: Record<string, any>;
  logs: V2LogEntry[];
  error_capture?: V2StepErrorDetail | null;
}

export interface V2RunRecord {
  run_id: string;
  session_id: string;
  session_title: string;
  run_type: string;
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "COMPLETED_WITH_WARNINGS" | "FAILED" | "ABORTED";
  started_at: string;
  completed_at?: string | null;
  duration_ms: number;
  triggered_by: string;
  stages_executed: string[];
  current_stage: string;
  kpi_snapshot: Record<string, any>;
  steps: V2AuditStep[];
  error_count: number;
  warning_count: number;
  error_summary?: string | null;
}

