import type { AmbiguityRecommendation } from "./api_v2";

export interface AlternativeMatchV4 {
  target_column: string;
  confidence: number;
  reason: string;
}

export interface DirectColumnCorrelationV4 {
  source_column: string;
  source_dtype: string;
  source_samples: string[];
  selected_target_column: string | null;
  confidence: number;
  reason: string;
  engine: string;
  alternatives: AlternativeMatchV4[];
  is_primary_gst_field: boolean;
  canonical_concept?: string | null;
  user_edited?: boolean;
}

export interface AgentThoughtV4 {
  step: string;
  message: string;
  timestamp_ms: number;
  duration_ms: number;
  model?: string | null;
}

export interface DirectCorrelationResultV4 {
  reconciliation_id: string;
  recon_filename: string;
  sheet_name: string;
  total_columns: number;
  correlations: DirectColumnCorrelationV4[];
  all_columns: string[];
  source_columns: string[];
  target_columns: string[];
  kics_status_column?: string | null;
  kics_reason_column?: string | null;
  agent_thoughts: AgentThoughtV4[];
  total_duration_ms: number;
}

export type NormalizationTypeV4 =
  | "TRIM_WHITESPACE"
  | "STRIP_SPECIAL_CHARS"
  | "REMOVE_PREFIXES"
  | "TRIM_LEADING_ZEROS"
  | "UPPERCASE"
  | "ALPHANUMERIC_ONLY";

export interface NormalizerConfigV4 {
  trim_whitespace: boolean;
  strip_special_chars: boolean;
  strip_prefixes: boolean;
  trim_leading_zeros: boolean;
  case_fold: boolean;
}

export function configToActiveNormalizersV4(config?: NormalizerConfigV4 | null): NormalizationTypeV4[] {
  if (!config) return [];
  const list: NormalizationTypeV4[] = [];
  if (config.trim_whitespace) list.push("TRIM_WHITESPACE");
  if (config.strip_special_chars) list.push("STRIP_SPECIAL_CHARS");
  if (config.strip_prefixes) list.push("REMOVE_PREFIXES");
  if (config.trim_leading_zeros) list.push("TRIM_LEADING_ZEROS");
  if (config.case_fold) list.push("UPPERCASE");
  return list;
}

export function activeNormalizersToConfigV4(types: string[]): NormalizerConfigV4 {
  return {
    trim_whitespace: types.includes("TRIM_WHITESPACE"),
    strip_special_chars: types.includes("STRIP_SPECIAL_CHARS"),
    strip_prefixes: types.includes("REMOVE_PREFIXES"),
    trim_leading_zeros: types.includes("TRIM_LEADING_ZEROS"),
    case_fold: types.includes("UPPERCASE"),
  };
}

export function toggleNormalizerInConfigV4(config: NormalizerConfigV4, type: NormalizationTypeV4): NormalizerConfigV4 {
  const next = { ...config };
  switch (type) {
    case "TRIM_WHITESPACE":
      next.trim_whitespace = !next.trim_whitespace;
      break;
    case "STRIP_SPECIAL_CHARS":
      next.strip_special_chars = !next.strip_special_chars;
      break;
    case "REMOVE_PREFIXES":
      next.strip_prefixes = !next.strip_prefixes;
      break;
    case "TRIM_LEADING_ZEROS":
      next.trim_leading_zeros = !next.trim_leading_zeros;
      break;
    case "UPPERCASE":
      next.case_fold = !next.case_fold;
      break;
  }
  return next;
}

export interface Rule4Item {
  id: string;
  order: number;
  name: string;
  description: string;
  statutory_rationale: string;
  category: string;
  rule_tier?: string;
  canonical_concept: string;
  is_mandatory: boolean;
  is_enabled: boolean;
  match_strategy: string;
  source_field_concept: string;
  target_field_concept: string;
  tolerance_value?: number | null;
  tolerance_unit?: string | null;
  normalizers: NormalizerConfigV4;
  created_at: string;
  is_temporary?: boolean;
  scope?: "temporary" | "wiki";
  origin_session_id?: string;
  created_by?: string;
  version?: string;
  tolerance_mode?: "ABSOLUTE_INR" | "PERCENTAGE";
  date_tolerance_value?: number;
  date_tolerance_unit?: "DAYS" | "MONTHS" | "YEARS";
  cross_fy_enabled?: boolean;
  min_threshold_ineligible?: number;
  custom_date_range_days?: number;
  advisory_caution?: string;
  plain_english_explanation?: string;
  why_it_matters?: string;
}

export interface ReconciliationRecordItemV4 {
  id: string;
  index: number;
  tars_verdict: string;
  kics_verdict: string;
  concurrence: "AGREEMENT" | "DISPARITY";
  disparity_reason?: string | null;
  source_gstin: string;
  target_gstin: string;
  source_doc_num: string;
  target_doc_num: string;
  source_date: string;
  target_date: string;
  source_taxable: number;
  target_taxable: number;
  source_tax: number;
  target_tax: number;
  taxable_diff: number;
  tax_diff: number;
  pass_tier: string;
  raw_attributes: Record<string, any>;
  bucket?: string;
  sub_classification?: string;
  reclassified_from?: string | null;
  reclassification_note?: string | null;
  classification_reason?: string;
  ai_reason?: string;
  gstr_row_index?: number | null;
  pr_row_index?: number | null;
  gstin?: string;
  document_number?: string;
  document_date?: string | null;
  taxable_value?: number;
  tax_amount?: number;
  total_value?: number;
  gstr_preview?: Record<string, any>;
  pr_preview?: Record<string, any>;
  variances?: Record<string, any>;
  matched_by_pass?: string;
}

export interface Stage4ResultsSummaryV4 {
  total_records: number;
  exact_matches: number;
  tolerance_matches: number;
  near_matches: number;
  ineligible_itc_matches?: number;
  consolidated_matches?: number;
  gst_only: number;
  pr_only: number;
  ambiguous: number;
  kics_concurrence_count: number;
  kics_concurrence_rate: number;
  disparities_caught: number;
  net_taxable_variance: number;
  net_tax_variance: number;
  total_gov_taxable: number;
  total_pr_taxable: number;
  accuracy_percentage: number;
  total_gstr_rows?: number;
  total_pr_rows?: number;
  exact_match_count?: number;
  exact_match_itc?: number;
  tolerance_match_count?: number;
  tolerance_match_itc?: number;
  near_match_count?: number;
  near_match_itc?: number;
  ambiguous_count?: number;
  ambiguous_itc?: number;
  gstr_only_count?: number;
  gstr_only_itc?: number;
  pr_only_count?: number;
  pr_only_itc?: number;
  total_reconciled_count?: number;
  total_reconciled_itc?: number;
  overall_reconciliation_rate?: number;
  waterfall_passes?: Array<{
    tier: number;
    name: string;
    matched_count: number;
    matched_itc: number;
    retention_percentage: number;
  }>;
}

export interface Stage4ExecutionResponseV4 {
  session_id: string;
  executed_at: string;
  duration_ms: number;
  summary: Stage4ResultsSummaryV4;
  records: ReconciliationRecordItemV4[];
  kics_status_column: string;
  ambiguities?: any[];
  compared_columns?: any[];
}

export interface KicsConcurrenceBenchmarkV4 {
  concurrence_rate: number;
  total_concurrence_count: number;
  total_disparities: number;
  tars_higher_precision_count: number;
  kics_overmatched_count: number;
  breakdown_by_category: {
    category: string;
    tars_count: number;
    kics_count: number;
    concurrence_pct: number;
  }[];
}

export interface VendorStratificationV4 {
  gstin: string;
  vendor_name: string;
  total_invoices: number;
  exact_count: number;
  tolerance_count: number;
  near_count: number;
  disparity_count: number;
  match_pct: number;
  total_taxable: number;
  risk_level: "LOW" | "MEDIUM" | "HIGH";
}

export interface Stage5SummaryResponseV4 {
  session_id: string;
  summary: Stage4ResultsSummaryV4;
  kics_benchmark: KicsConcurrenceBenchmarkV4;
  vendor_stratification: VendorStratificationV4[];
  process_highlights: {
    metric: string;
    label: string;
    detail: string;
    impact_level: string;
  }[];
  variance_taxonomy: {
    category: string;
    percentage: number;
    description: string;
    remediation: string;
  }[];
  ai_playbook: {
    verdict: string;
    directives: {
      step_number: number;
      title: string;
      target_volume: string;
      directive: string;
      impact: string;
    }[];
  };
}

export interface ReconciliationV4Session {
  id: string;
  recon_type: string;
  title: string;
  status: string;
  current_stage: string;
  created_at: string;
  recon_filename?: string | null;
  sheet_name?: string | null;
  total_rows: number;
  total_columns: number;
  correlation?: DirectCorrelationResultV4 | null;
  selected_rule_ids: string[];
  rule_execution_order: string[];
  rules_v4: Rule4Item[];
  is_completed?: boolean;
  completed_stages_count?: number;
}

const API_BASE = "/api/reconciliations-v4";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text();
    let errorDetail = text || `API Error (${res.status})`;
    try {
      const errJson = JSON.parse(text);
      errorDetail = errJson.detail || (typeof errJson === "string" ? errJson : JSON.stringify(errJson));
    } catch {
      // retain raw response text
    }
    throw new Error(errorDetail);
  }
  return res.json() as Promise<T>;
}

export const apiV4 = {
  async createSession(): Promise<ReconciliationV4Session> {
    return request<ReconciliationV4Session>(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
  },

  async getSession(id: string): Promise<ReconciliationV4Session> {
    return request<ReconciliationV4Session>(`${API_BASE}/${id}`);
  },

  async uploadSingleRecon(
    id: string,
    file?: File,
    useSample = false
  ): Promise<DirectCorrelationResultV4> {
    const formData = new FormData();
    if (file) {
      formData.append("recon_file", file);
    }
    const query = useSample ? "?use_sample=true" : "";
    return request<DirectCorrelationResultV4>(`${API_BASE}/${id}/upload-single${query}`, {
      method: "POST",
      body: file ? formData : undefined,
    });
  },

  async updateMapping(
    id: string,
    correlations: DirectColumnCorrelationV4[],
    kicsStatusCol?: string
  ): Promise<DirectCorrelationResultV4> {
    return request<DirectCorrelationResultV4>(`${API_BASE}/${id}/mapping/update`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        correlations,
        kics_status_column: kicsStatusCol,
      }),
    });
  },

  async confirmMapping(
    id: string,
    correlations?: DirectColumnCorrelationV4[],
    kicsStatusCol?: string
  ): Promise<ReconciliationV4Session> {
    return request<ReconciliationV4Session>(`${API_BASE}/${id}/mapping/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        correlations: correlations || [],
        kics_status_column: kicsStatusCol,
      }),
    });
  },

  async getRules(id: string): Promise<Rule4Item[]> {
    return request<Rule4Item[]>(`${API_BASE}/${id}/rules`);
  },

  async confirmRules(
    id: string,
    selectedRuleIds: string[],
    ruleExecutionOrder: string[],
    rules: Rule4Item[]
  ): Promise<ReconciliationV4Session> {
    return request<ReconciliationV4Session>(`${API_BASE}/${id}/rules/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        selected_rule_ids: selectedRuleIds,
        rule_execution_order: ruleExecutionOrder,
        rules,
      }),
    });
  },

  async compileAiRule(
    id: string,
    prompt: string,
    scope: "temporary" | "wiki" = "wiki",
    isTemporary: boolean = false
  ): Promise<Rule4Item> {
    return request<Rule4Item>(`${API_BASE}/${id}/rules/compile-ai`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        scope,
        is_temporary: isTemporary || scope === "temporary",
      }),
    });
  },

  async getMasterRulesCatalog(): Promise<Rule4Item[]> {
    return request<Rule4Item[]>(`${API_BASE}/rules-v4/catalog`);
  },

  async updateMasterRulesCatalog(rules: Rule4Item[]): Promise<Rule4Item[]> {
    return request<Rule4Item[]>(`${API_BASE}/rules-v4/catalog`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rules),
    });
  },

  async executeStage4Results(id: string): Promise<Stage4ExecutionResponseV4> {
    return request<Stage4ExecutionResponseV4>(`${API_BASE}/${id}/results/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
  },

  async getStage4Results(id: string): Promise<Stage4ExecutionResponseV4> {
    return request<Stage4ExecutionResponseV4>(`${API_BASE}/${id}/results`);
  },

  async getStage5Summary(id: string): Promise<Stage5SummaryResponseV4> {
    return request<Stage5SummaryResponseV4>(`${API_BASE}/${id}/summary`);
  },

  async completeSession(id: string): Promise<ReconciliationV4Session> {
    return request<ReconciliationV4Session>(`${API_BASE}/${id}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
  },

  async getRecordRecommendation(
    id: string,
    recordId: string,
    record?: any
  ): Promise<AmbiguityRecommendation> {
    return request<AmbiguityRecommendation>(
      `${API_BASE}/${id}/records/${recordId}/recommend`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ record }),
      }
    );
  },

  async reclassifyRecord(
    id: string,
    recordId: string,
    payload: { target_bucket: string; reviewer_note?: string; override_policy?: boolean }
  ): Promise<Stage4ExecutionResponseV4> {
    return request<Stage4ExecutionResponseV4>(
      `${API_BASE}/${id}/records/${recordId}/reclassify`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
  },
};
