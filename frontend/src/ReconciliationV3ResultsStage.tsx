import React, { useState, useEffect, useMemo } from "react";
import { Stage4ExecutionResponseV3, ReconciliationRecordItemV3, apiV3 } from "./api_v3";
import {
  ShieldCheck,
  Sparkles,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  FileSpreadsheet,
  Layers,
  Search,
  Check,
  Zap,
  Filter,
} from "lucide-react";

interface Props {
  sessionId: string;
  onBackToRules: () => void;
  onProceedToSummary: () => void;
}

export const ReconciliationV3ResultsStage: React.FC<Props> = ({
  sessionId,
  onBackToRules,
  onProceedToSummary,
}) => {
  const [data, setData] = useState<Stage4ExecutionResponseV3 | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 50;

  useEffect(() => {
    let mounted = true;
    apiV3
      .executeStage4Results(sessionId)
      .then((res) => {
        if (mounted) {
          setData(res);
          setLoading(false);
        }
      })
      .catch(() => {
        // Fallback to get
        apiV3
          .getStage4Results(sessionId)
          .then((res) => {
            if (mounted) {
              setData(res);
              setLoading(false);
            }
          })
          .catch((e) => {
            console.error(e);
            if (mounted) setLoading(false);
          });
      });
    return () => {
      mounted = false;
    };
  }, [sessionId]);

  const filteredRecords = useMemo(() => {
    if (!data || !data.records) return [];
    return data.records.filter((r) => {
      if (activeFilter === "EXACT" && r.tars_verdict !== "Exact Match") return false;
      if (activeFilter === "TOLERANCE" && r.tars_verdict !== "Tolerance Match") return false;
      if (activeFilter === "NEAR" && r.tars_verdict !== "Near Match") return false;
      if (activeFilter === "GST_ONLY" && r.tars_verdict !== "GST Only") return false;
      if (activeFilter === "PR_ONLY" && r.tars_verdict !== "PR Only") return false;
      if (activeFilter === "AMBIGUOUS" && r.tars_verdict !== "Ambiguous") return false;
      if (activeFilter === "DISPARITY" && r.concurrence !== "DISPARITY") return false;

      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (
        r.source_gstin.toLowerCase().includes(q) ||
        r.target_gstin.toLowerCase().includes(q) ||
        r.source_doc_num.toLowerCase().includes(q) ||
        r.target_doc_num.toLowerCase().includes(q) ||
        r.tars_verdict.toLowerCase().includes(q) ||
        r.kics_verdict.toLowerCase().includes(q)
      );
    });
  }, [data, activeFilter, searchQuery]);

  const paginatedRecords = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredRecords.slice(start, start + pageSize);
  }, [filteredRecords, page]);

  const totalPages = Math.ceil(filteredRecords.length / pageSize) || 1;

  if (loading) {
    return (
      <div style={{ padding: "5rem", textAlign: "center", color: "#94a3b8" }}>
        <div className="spinner" style={{ margin: "0 auto 16px" }} />
        <h3 style={{ color: "#f8fafc", marginBottom: 6 }}>Executing Intra-Table Waterfall Engine...</h3>
        <p style={{ margin: 0, fontSize: 14 }}>Processing 20,000 records across paired Counterparty & Books columns</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ padding: "3rem", textAlign: "center", color: "#ef4444" }}>
        Failed to load reconciliation results. Please return to Rules and retry.
      </div>
    );
  }

  const s = data.summary;

  return (
    <div className="v3-results-container" style={{ padding: "1.5rem", maxWidth: 1400, margin: "0 auto" }}>
      {/* Top Telemetry Flight Deck */}
      <div
        style={{
          background: "linear-gradient(135deg, rgba(0, 51, 141, 0.15) 0%, rgba(15, 23, 42, 0.9) 100%)",
          border: "1px solid rgba(59, 130, 246, 0.25)",
          borderRadius: 16,
          padding: "1.75rem",
          marginBottom: "1.75rem",
          backdropFilter: "blur(12px)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <span
                style={{
                  background: "rgba(16, 185, 129, 0.15)",
                  color: "#34d399",
                  border: "1px solid rgba(16, 185, 129, 0.3)",
                  padding: "3px 10px",
                  borderRadius: 12,
                  fontSize: 12,
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                <CheckCircle2 size={13} />
                Stage 4: Intra-Table Waterfall Matrix
              </span>
              <span style={{ fontSize: 13, color: "#94a3b8" }}>· Processed in {data.duration_ms}ms</span>
            </div>
            <h2 style={{ fontSize: 24, fontWeight: 700, color: "#f8fafc", margin: "0 0 6px 0", letterSpacing: "-0.02em" }}>
              20,000 Unified Reconciliation Records
            </h2>
            <p style={{ color: "#94a3b8", fontSize: 14, margin: 0, maxWidth: 820, lineHeight: 1.5 }}>
              TARS matched and benchmarked each transaction against the KICS baseline column <code>{data.kics_status_column}</code>.
            </p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                background: "rgba(16, 185, 129, 0.12)",
                border: "1px solid rgba(16, 185, 129, 0.3)",
                borderRadius: 12,
                padding: "10px 18px",
                textAlign: "right",
              }}
            >
              <div style={{ fontSize: 11, textTransform: "uppercase", color: "#34d399", fontWeight: 700, letterSpacing: "0.05em" }}>
                KICS Concurrence Rate
              </div>
              <div style={{ fontSize: 22, fontWeight: 800, color: "#34d399", marginTop: 1 }}>
                {s.kics_concurrence_rate}%
              </div>
            </div>

            <div
              style={{
                background: "rgba(245, 158, 11, 0.12)",
                border: "1px solid rgba(245, 158, 11, 0.3)",
                borderRadius: 12,
                padding: "10px 18px",
                textAlign: "right",
              }}
            >
              <div style={{ fontSize: 11, textTransform: "uppercase", color: "#fbbf24", fontWeight: 700, letterSpacing: "0.05em" }}>
                Disparities Caught
              </div>
              <div style={{ fontSize: 22, fontWeight: 800, color: "#fbbf24", marginTop: 1 }}>
                {s.disparities_caught.toLocaleString()}
              </div>
            </div>
          </div>
        </div>

        {/* Metric Cards Row */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            gap: 12,
            marginTop: "1.25rem",
          }}
        >
          <div style={{ background: "rgba(255, 255, 255, 0.03)", padding: "10px 14px", borderRadius: 10, border: "1px solid rgba(255, 255, 255, 0.06)" }}>
            <div style={{ fontSize: 11, color: "#94a3b8" }}>Exact Match</div>
            <div style={{ fontSize: 17, fontWeight: 700, color: "#38bdf8", marginTop: 2 }}>{s.exact_matches.toLocaleString()}</div>
          </div>
          <div style={{ background: "rgba(255, 255, 255, 0.03)", padding: "10px 14px", borderRadius: 10, border: "1px solid rgba(255, 255, 255, 0.06)" }}>
            <div style={{ fontSize: 11, color: "#94a3b8" }}>Tolerance Match</div>
            <div style={{ fontSize: 17, fontWeight: 700, color: "#34d399", marginTop: 2 }}>{s.tolerance_matches.toLocaleString()}</div>
          </div>
          <div style={{ background: "rgba(255, 255, 255, 0.03)", padding: "10px 14px", borderRadius: 10, border: "1px solid rgba(255, 255, 255, 0.06)" }}>
            <div style={{ fontSize: 11, color: "#94a3b8" }}>Near Match</div>
            <div style={{ fontSize: 17, fontWeight: 700, color: "#c084fc", marginTop: 2 }}>{s.near_matches.toLocaleString()}</div>
          </div>
          <div style={{ background: "rgba(255, 255, 255, 0.03)", padding: "10px 14px", borderRadius: 10, border: "1px solid rgba(255, 255, 255, 0.06)" }}>
            <div style={{ fontSize: 11, color: "#94a3b8" }}>GST Only (Unclaimed)</div>
            <div style={{ fontSize: 17, fontWeight: 700, color: "#f87171", marginTop: 2 }}>{s.gst_only.toLocaleString()}</div>
          </div>
          <div style={{ background: "rgba(255, 255, 255, 0.03)", padding: "10px 14px", borderRadius: 10, border: "1px solid rgba(255, 255, 255, 0.06)" }}>
            <div style={{ fontSize: 11, color: "#94a3b8" }}>PR Only (Books Only)</div>
            <div style={{ fontSize: 17, fontWeight: 700, color: "#fb923c", marginTop: 2 }}>{s.pr_only.toLocaleString()}</div>
          </div>
          <div style={{ background: "rgba(255, 255, 255, 0.03)", padding: "10px 14px", borderRadius: 10, border: "1px solid rgba(255, 255, 255, 0.06)" }}>
            <div style={{ fontSize: 11, color: "#94a3b8" }}>Ambiguous</div>
            <div style={{ fontSize: 17, fontWeight: 700, color: "#e879f9", marginTop: 2 }}>{s.ambiguous.toLocaleString()}</div>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14, marginBottom: 14, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {[
            { key: "ALL", label: `All (${s.total_records.toLocaleString()})` },
            { key: "EXACT", label: `Exact (${s.exact_matches.toLocaleString()})` },
            { key: "TOLERANCE", label: `Tolerance (${s.tolerance_matches.toLocaleString()})` },
            { key: "NEAR", label: `Near (${s.near_matches.toLocaleString()})` },
            { key: "GST_ONLY", label: `GST Only (${s.gst_only.toLocaleString()})` },
            { key: "PR_ONLY", label: `PR Only (${s.pr_only.toLocaleString()})` },
            { key: "AMBIGUOUS", label: `Ambiguous (${s.ambiguous.toLocaleString()})` },
            { key: "DISPARITY", label: `Disparities (${s.disparities_caught.toLocaleString()})` },
          ].map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => {
                setActiveFilter(item.key);
                setPage(1);
              }}
              style={{
                background: activeFilter === item.key ? "#00338D" : "rgba(30, 41, 59, 0.7)",
                color: activeFilter === item.key ? "#ffffff" : "#94a3b8",
                border: activeFilter === item.key ? "1px solid #3b82f6" : "1px solid rgba(255, 255, 255, 0.08)",
                borderRadius: 8,
                padding: "6px 12px",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div style={{ position: "relative", minWidth: 260 }}>
          <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#64748b" }} />
          <input
            type="text"
            placeholder="Search invoice numbers, GSTINs..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setPage(1);
            }}
            style={{
              width: "100%",
              background: "rgba(15, 23, 42, 0.8)",
              border: "1px solid rgba(255, 255, 255, 0.12)",
              borderRadius: 8,
              padding: "6px 10px 6px 32px",
              color: "#f8fafc",
              fontSize: 12,
              outline: "none",
            }}
          />
        </div>
      </div>

      {/* Results Table */}
      <div
        style={{
          background: "rgba(15, 23, 42, 0.7)",
          border: "1px solid rgba(255, 255, 255, 0.08)",
          borderRadius: 14,
          overflow: "hidden",
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "rgba(30, 41, 59, 0.85)", borderBottom: "1px solid rgba(255, 255, 255, 0.1)" }}>
              <th style={{ padding: "10px 14px", color: "#cbd5e1", fontWeight: 600, width: "6%" }}>Row</th>
              <th style={{ padding: "10px 14px", color: "#cbd5e1", fontWeight: 600, width: "14%" }}>TARS Verdict</th>
              <th style={{ padding: "10px 14px", color: "#cbd5e1", fontWeight: 600, width: "14%" }}>KICS Baseline</th>
              <th style={{ padding: "10px 14px", color: "#cbd5e1", fontWeight: 600, width: "12%" }}>Concurrence</th>
              <th style={{ padding: "10px 14px", color: "#cbd5e1", fontWeight: 600, width: "18%" }}>CP / PR Invoice No</th>
              <th style={{ padding: "10px 14px", color: "#cbd5e1", fontWeight: 600, width: "16%" }}>CP / PR Taxable (₹)</th>
              <th style={{ padding: "10px 14px", color: "#cbd5e1", fontWeight: 600, width: "20%" }}>Execution Pass</th>
            </tr>
          </thead>
          <tbody>
            {paginatedRecords.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: "3rem", textAlign: "center", color: "#64748b" }}>
                  No records match the selected filter.
                </td>
              </tr>
            ) : (
              paginatedRecords.map((r) => {
                const isDisparity = r.concurrence === "DISPARITY";
                return (
                  <tr
                    key={r.id}
                    style={{
                      borderBottom: "1px solid rgba(255, 255, 255, 0.04)",
                      background: isDisparity ? "rgba(245, 158, 11, 0.04)" : "transparent",
                    }}
                  >
                    <td style={{ padding: "10px 14px", color: "#64748b", fontFamily: "monospace", fontSize: 12 }}>
                      #{r.index}
                    </td>

                    <td style={{ padding: "10px 14px" }}>
                      <span
                        style={{
                          background:
                            r.tars_verdict === "Exact Match"
                              ? "rgba(56, 189, 248, 0.15)"
                              : r.tars_verdict === "Tolerance Match"
                              ? "rgba(52, 211, 153, 0.15)"
                              : r.tars_verdict === "Near Match"
                              ? "rgba(192, 132, 252, 0.15)"
                              : "rgba(255, 255, 255, 0.08)",
                          color:
                            r.tars_verdict === "Exact Match"
                              ? "#38bdf8"
                              : r.tars_verdict === "Tolerance Match"
                              ? "#34d399"
                              : r.tars_verdict === "Near Match"
                              ? "#c084fc"
                              : "#e2e8f0",
                          borderRadius: 6,
                          padding: "3px 8px",
                          fontSize: 11,
                          fontWeight: 700,
                        }}
                      >
                        {r.tars_verdict}
                      </span>
                    </td>

                    <td style={{ padding: "10px 14px" }}>
                      <span style={{ color: "#cbd5e1", fontSize: 12 }}>{r.kics_verdict}</span>
                    </td>

                    <td style={{ padding: "10px 14px" }}>
                      <span
                        style={{
                          background: isDisparity ? "rgba(245, 158, 11, 0.15)" : "rgba(16, 185, 129, 0.15)",
                          color: isDisparity ? "#fbbf24" : "#34d399",
                          borderRadius: 6,
                          padding: "2px 8px",
                          fontSize: 11,
                          fontWeight: 700,
                        }}
                      >
                        {r.concurrence}
                      </span>
                      {r.disparity_reason && (
                        <div style={{ fontSize: 10, color: "#f59e0b", marginTop: 2 }}>{r.disparity_reason}</div>
                      )}
                    </td>

                    <td style={{ padding: "10px 14px" }}>
                      <div style={{ fontWeight: 600, color: "#f1f5f9" }}>CP: {r.source_doc_num || "—"}</div>
                      <div style={{ fontSize: 11, color: "#94a3b8" }}>PR: {r.target_doc_num || "—"}</div>
                    </td>

                    <td style={{ padding: "10px 14px" }}>
                      <div style={{ fontWeight: 600, color: "#f1f5f9" }}>
                        ₹{r.source_taxable.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </div>
                      <div style={{ fontSize: 11, color: r.taxable_diff > 0.01 ? "#f59e0b" : "#64748b" }}>
                        Diff: ₹{r.taxable_diff.toFixed(2)}
                      </div>
                    </td>

                    <td style={{ padding: "10px 14px", color: "#94a3b8", fontSize: 12 }}>
                      {r.pass_tier}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, color: "#94a3b8", fontSize: 12 }}>
        <div>
          Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, filteredRecords.length)} of {filteredRecords.length.toLocaleString()} records
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            style={{
              background: "rgba(30, 41, 59, 0.8)",
              color: page === 1 ? "#475569" : "#cbd5e1",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              borderRadius: 6,
              padding: "4px 10px",
              cursor: page === 1 ? "default" : "pointer",
            }}
          >
            Prev
          </button>
          <span style={{ padding: "4px 8px", color: "#cbd5e1" }}>
            {page} / {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            style={{
              background: "rgba(30, 41, 59, 0.8)",
              color: page === totalPages ? "#475569" : "#cbd5e1",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              borderRadius: 6,
              padding: "4px 10px",
              cursor: page === totalPages ? "default" : "pointer",
            }}
          >
            Next
          </button>
        </div>
      </div>

      {/* Bottom Actions */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: "1.75rem",
          paddingTop: "1.25rem",
          borderTop: "1px solid rgba(255, 255, 255, 0.08)",
        }}
      >
        <button
          type="button"
          onClick={onBackToRules}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            background: "rgba(30, 41, 59, 0.8)",
            color: "#e2e8f0",
            border: "1px solid rgba(255, 255, 255, 0.1)",
            borderRadius: 8,
            padding: "8px 16px",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          <ArrowLeft size={16} />
          Back to Rules Studio
        </button>

        <button
          type="button"
          onClick={onProceedToSummary}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            background: "#00338D",
            color: "#ffffff",
            border: "none",
            borderRadius: 8,
            padding: "9px 22px",
            fontSize: 14,
            fontWeight: 700,
            cursor: "pointer",
            boxShadow: "0 4px 14px rgba(0, 51, 141, 0.4)",
            transition: "all 0.15s ease",
          }}
        >
          <Check size={16} />
          Proceed to Stage 5: Executive Intelligence
          <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
};
