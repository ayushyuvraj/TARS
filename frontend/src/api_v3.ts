export interface AlternativeMatchV3 {
  target_column: string;
  confidence: number;
  reason: string;
}

export interface DirectColumnCorrelationV3 {
  source_column: string;
  source_dtype: string;
  source_samples: string[];
  selected_target_column: string | null;
  confidence: number;
  reason: string;
  engine: string;
  alternatives: AlternativeMatchV3[];
  is_primary_gst_field: boolean;
  canonical_concept?: string | null;
  user_edited?: boolean;
}

export interface AgentThoughtV3 {
  step: string;
  message: string;
  timestamp_ms: number;
  duration_ms: number;
  model?: string | null;
}

export interface DirectCorrelationResultV3 {
  reconciliation_id: string;
  recon_filename: string;
  sheet_name: string;
  total_columns: number;
  correlations: DirectColumnCorrelationV3[];
  all_columns: string[];
  source_columns: string[];
  target_columns: string[];
  kics_status_column?: string | null;
  kics_reason_column?: string | null;
  agent_thoughts: AgentThoughtV3[];
  total_duration_ms: number;
}

export interface NormalizerConfigV3 {
  trim_whitespace: boolean;
  strip_special_chars: boolean;
  strip_prefixes: boolean;
  trim_leading_zeros: boolean;
  case_fold: boolean;
}

export interface Rule3Item {
  id: string;
  order: number;
  name: string;
  description: string;
  statutory_rationale: string;
  category: "CORE_STATUTORY" | "INTRA_TABLE" | "TOLERANCE" | "DISPARITY";
  canonical_concept: string;
  is_mandatory: boolean;
  is_enabled: boolean;
  match_strategy: string;
  source_field_concept: string;
  target_field_concept: string;
  tolerance_value?: number | null;
  tolerance_unit?: string | null;
  normalizers: NormalizerConfigV3;
  created_at: string;
}

export interface ReconciliationRecordItemV3 {
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
}

export interface Stage4ResultsSummaryV3 {
  total_records: number;
  exact_matches: number;
  tolerance_matches: number;
  near_matches: number;
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
}

export interface Stage4ExecutionResponseV3 {
  session_id: string;
  executed_at: string;
  duration_ms: number;
  summary: Stage4ResultsSummaryV3;
  records: ReconciliationRecordItemV3[];
  kics_status_column: string;
}

export interface KicsConcurrenceBenchmark {
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

export interface VendorStratificationV3 {
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

export interface Stage5SummaryResponseV3 {
  session_id: string;
  summary: Stage4ResultsSummaryV3;
  kics_benchmark: KicsConcurrenceBenchmark;
  vendor_stratification: VendorStratificationV3[];
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

export interface ReconciliationV3Session {
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
  correlation?: DirectCorrelationResultV3 | null;
  selected_rule_ids: string[];
  rule_execution_order: string[];
  rules_v3: Rule3Item[];
}

const API_BASE = "/api/reconciliations-v3";

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

export const apiV3 = {
  async createSession(): Promise<ReconciliationV3Session> {
    return request<ReconciliationV3Session>(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
  },

  async getSession(id: string): Promise<ReconciliationV3Session> {
    return request<ReconciliationV3Session>(`${API_BASE}/${id}`);
  },

  async uploadSingleRecon(
    id: string,
    file?: File,
    useSample = false
  ): Promise<DirectCorrelationResultV3> {
    const formData = new FormData();
    if (file) {
      formData.append("recon_file", file);
    }
    const query = useSample ? "?use_sample=true" : "";
    return request<DirectCorrelationResultV3>(`${API_BASE}/${id}/upload-single${query}`, {
      method: "POST",
      body: file ? formData : undefined,
    });
  },

  async updateMapping(
    id: string,
    correlations: DirectColumnCorrelationV3[],
    kicsStatusCol?: string
  ): Promise<DirectCorrelationResultV3> {
    return request<DirectCorrelationResultV3>(`${API_BASE}/${id}/mapping/update`, {
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
    correlations?: DirectColumnCorrelationV3[],
    kicsStatusCol?: string
  ): Promise<ReconciliationV3Session> {
    return request<ReconciliationV3Session>(`${API_BASE}/${id}/mapping/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        correlations: correlations || [],
        kics_status_column: kicsStatusCol,
      }),
    });
  },

  async getRules(id: string): Promise<Rule3Item[]> {
    return request<Rule3Item[]>(`${API_BASE}/${id}/rules`);
  },

  async confirmRules(
    id: string,
    selectedRuleIds: string[],
    ruleExecutionOrder: string[],
    rules: Rule3Item[]
  ): Promise<ReconciliationV3Session> {
    return request<ReconciliationV3Session>(`${API_BASE}/${id}/rules/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        selected_rule_ids: selectedRuleIds,
        rule_execution_order: ruleExecutionOrder,
        rules,
      }),
    });
  },

  async getMasterRulesCatalog(): Promise<Rule3Item[]> {
    return request<Rule3Item[]>(`${API_BASE}/rules-v3/catalog`);
  },

  async updateMasterRulesCatalog(rules: Rule3Item[]): Promise<Rule3Item[]> {
    return request<Rule3Item[]>(`${API_BASE}/rules-v3/catalog`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rules),
    });
  },

  async executeStage4Results(id: string): Promise<Stage4ExecutionResponseV3> {
    return request<Stage4ExecutionResponseV3>(`${API_BASE}/${id}/results/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
  },

  async getStage4Results(id: string): Promise<Stage4ExecutionResponseV3> {
    return request<Stage4ExecutionResponseV3>(`${API_BASE}/${id}/results`);
  },

  async getStage5Summary(id: string): Promise<Stage5SummaryResponseV3> {
    return request<Stage5SummaryResponseV3>(`${API_BASE}/${id}/summary`);
  },

  async completeSession(id: string): Promise<ReconciliationV3Session> {
    return request<ReconciliationV3Session>(`${API_BASE}/${id}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
  },
};
