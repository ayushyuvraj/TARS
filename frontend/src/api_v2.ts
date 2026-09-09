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

export interface ReconciliationV2Session {
  id: string;
  status: string;
  created_at: string;
  gstr_filename?: string | null;
  pr_filename?: string | null;
  correlation?: DirectCorrelationResult | null;
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
  }
};
