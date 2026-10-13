import type { AmbiguityRecommendation, DirectColumnCorrelation, DirectCorrelationResult } from "./api_v2";

export type NormalizationTypeV5 =
  | "TRIM_WHITESPACE"
  | "STRIP_SPECIAL_CHARS"
  | "REMOVE_PREFIXES"
  | "TRIM_LEADING_ZEROS"
  | "UPPERCASE"
  | "ALPHANUMERIC_ONLY";

export interface NormalizerConfigV5 {
  trim_whitespace: boolean;
  strip_special_chars: boolean;
  strip_prefixes: boolean;
  trim_leading_zeros: boolean;
  case_fold: boolean;
}

export function configToActiveNormalizersV5(config?: NormalizerConfigV5 | null): NormalizationTypeV5[] {
  if (!config) return [];
  const list: NormalizationTypeV5[] = [];
  if (config.trim_whitespace) list.push("TRIM_WHITESPACE");
  if (config.strip_special_chars) list.push("STRIP_SPECIAL_CHARS");
  if (config.strip_prefixes) list.push("REMOVE_PREFIXES");
  if (config.trim_leading_zeros) list.push("TRIM_LEADING_ZEROS");
  if (config.case_fold) list.push("UPPERCASE");
  return list;
}

export function toggleNormalizerInConfigV5(config: NormalizerConfigV5, type: NormalizationTypeV5): NormalizerConfigV5 {
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

export interface Rule5Item {
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
  gstr_column: string;
  pr_column: string;
  tolerance_value?: number | null;
  tolerance_unit?: string | null;
  normalizers: NormalizerConfigV5;
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

export interface BatchComponentItemV5 {
  row_index: number;
  row_number: number;
  doc_type: string;
  document_number: string;
  document_date: string;
  taxable_value: number;
  tax_amount: number;
  total_value: number;
  gstin: string;
  share_percentage: number;
}

export interface ReconciliationRecordItemV5 {
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
  classification_reason: string;
  ai_reason: string;
  variances: Record<string, any>;
  matched_by_pass: string;
  bucket: string;
  reclassified_from?: string | null;
  reclassification_note?: string | null;
  batch_components?: BatchComponentItemV5[];
  raw_attributes?: Record<string, any>;
  gstr_preview?: Record<string, any>;
  pr_preview?: Record<string, any>;
}

export interface Stage4ResultsSummaryV5 {
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
  tolerance_match_count?: number;
  near_match_count?: number;
  ambiguous_count?: number;
  gstr_only_count?: number;
  pr_only_count?: number;
  total_reconciled_count?: number;
  overall_reconciliation_rate?: number;
  waterfall_passes?: { name: string; count: number; percentage: number }[];
  rule_breakdown?: Record<string, number>;
}

export interface Stage4ExecutionResponseV5 {
  session_id: string;
  executed_at: string;
  duration_ms: number;
  summary: Stage4ResultsSummaryV5;
  records: ReconciliationRecordItemV5[];
  kics_status_column?: string;
  ambiguities: any[];
  compared_columns: any[];
}

export interface ReconciliationV5Session {
  id: string;
  recon_type: string;
  title: string;
  status: string;
  current_stage: string;
  created_at: string;
  gstr_filename?: string | null;
  pr_filename?: string | null;
  total_gstr_rows: number;
  total_pr_rows: number;
  correlation?: DirectCorrelationResult | null;
  selected_rule_ids: string[];
  rule_execution_order: string[];
  rules_v5: Rule5Item[];
  is_completed?: boolean;
  completed_stages_count?: number;
}

const API_BASE = "/api/reconciliations-v5";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let errDetail = `${res.status} ${res.statusText}`;
    try {
      const data = await res.json();
      errDetail = data.detail || errDetail;
    } catch {}
    throw new Error(errDetail);
  }
  return res.json() as Promise<T>;
}

export const apiV5 = {
  async createSession(req?: { title?: string; client_name?: string }): Promise<ReconciliationV5Session> {
    return request<ReconciliationV5Session>(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req || {}),
    });
  },

  async getSession(id: string): Promise<ReconciliationV5Session> {
    return request<ReconciliationV5Session>(`${API_BASE}/${id}`);
  },

  async uploadFiles(
    id: string,
    governmentFile?: File | null,
    purchaseFile?: File | null,
    useSample: boolean = false
  ): Promise<DirectCorrelationResult> {
    const formData = new FormData();
    if (governmentFile) formData.append("government_file", governmentFile);
    if (purchaseFile) formData.append("purchase_file", purchaseFile);
    const query = useSample ? "?use_sample=true" : "";
    return request<DirectCorrelationResult>(`${API_BASE}/${id}/upload${query}`, {
      method: "POST",
      body: governmentFile || purchaseFile ? formData : undefined,
    });
  },

  async updateMapping(
    id: string,
    correlations: DirectColumnCorrelation[]
  ): Promise<{ status: string; correlations_count: number }> {
    return request<{ status: string; correlations_count: number }>(`${API_BASE}/${id}/mapping`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ correlations }),
    });
  },

  async confirmMapping(
    id: string,
    correlations?: DirectColumnCorrelation[]
  ): Promise<ReconciliationV5Session> {
    return request<ReconciliationV5Session>(`${API_BASE}/${id}/mapping/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ correlations: correlations || [] }),
    });
  },

  async getRules(id: string): Promise<Rule5Item[]> {
    return request<Rule5Item[]>(`${API_BASE}/${id}/rules`);
  },

  async confirmRules(
    id: string,
    selectedRuleIds: string[],
    ruleExecutionOrder: string[],
    rules: Rule5Item[]
  ): Promise<ReconciliationV5Session> {
    return request<ReconciliationV5Session>(`${API_BASE}/${id}/rules/confirm`, {
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
    prompt: string
  ): Promise<Rule5Item> {
    return request<Rule5Item>(`${API_BASE}/${id}/rules/compile-ai`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
  },

  async getMasterRulesCatalog(): Promise<Rule5Item[]> {
    return request<Rule5Item[]>(`${API_BASE}/rules-v5/catalog`);
  },

  async updateMasterRulesCatalog(rules: Rule5Item[]): Promise<Rule5Item[]> {
    return request<Rule5Item[]>(`${API_BASE}/rules-v5/catalog`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rules),
    });
  },

  async simulateRules(rules: Rule5Item[]): Promise<any> {
    return request<any>(`${API_BASE}/rules-v5/simulate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rules),
    });
  },

  async executeStage4Results(id: string): Promise<Stage4ExecutionResponseV5> {
    return request<Stage4ExecutionResponseV5>(`${API_BASE}/${id}/results/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
  },

  async getStage4Results(id: string): Promise<Stage4ExecutionResponseV5> {
    return request<Stage4ExecutionResponseV5>(`${API_BASE}/${id}/results`);
  },

  async getStage5Summary(id: string): Promise<any> {
    return request<any>(`${API_BASE}/${id}/summary`);
  },

  async completeSession(id: string): Promise<ReconciliationV5Session> {
    return request<ReconciliationV5Session>(`${API_BASE}/${id}/complete`, {
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
  ): Promise<Stage4ExecutionResponseV5> {
    return request<Stage4ExecutionResponseV5>(
      `${API_BASE}/${id}/records/${recordId}/reclassify`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
  },

  async resolveAmbiguity(
    id: string,
    clusterId: string,
    chosenCandidateId?: string,
    action: "CHOOSE" | "REJECT" = "CHOOSE"
  ): Promise<Stage4ExecutionResponseV5> {
    return request<Stage4ExecutionResponseV5>(
      `${API_BASE}/${id}/ambiguities/resolve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cluster_id: clusterId,
          chosen_candidate_id: chosenCandidateId,
          action,
        }),
      }
    );
  },
};
