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
  }
};

