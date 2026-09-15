import React, { useState, useEffect } from "react";
import { Stage5SummaryResponseV3, apiV3 } from "./api_v3";
import {
  ShieldCheck,
  Sparkles,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  FileSpreadsheet,
  TrendingUp,
  Activity,
  Layers,
  Check,
  Zap,
} from "lucide-react";

interface Props {
  sessionId: string;
  onBackToResults: () => void;
  onProceedToExport: () => void;
}

export const ReconciliationV3SummaryStage: React.FC<Props> = ({
  sessionId,
  onBackToResults,
  onProceedToExport,
}) => {
  const [data, setData] = useState<Stage5SummaryResponseV3 | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    apiV3
      .getStage5Summary(sessionId)
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
    return () => {
      mounted = false;
    };
  }, [sessionId]);

  if (loading) {
    return (
      <div style={{ padding: "5rem", textAlign: "center", color: "#94a3b8" }}>
        <div className="spinner" style={{ margin: "0 auto 16px" }} />
        <h3 style={{ color: "#f8fafc", marginBottom: 6 }}>Compiling Executive Intelligence & KICS Benchmark...</h3>
        <p style={{ margin: 0, fontSize: 14 }}>Aggregating 20,000 transactions across vendor risk and disparity taxonomies</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ padding: "3rem", textAlign: "center", color: "#ef4444" }}>
        Failed to load executive summary. Please return to Results and retry.
      </div>
    );
  }

  const s = data.summary;
  const b = data.kics_benchmark;

  return (
    <div className="v3-summary-container" style={{ padding: "1.5rem", maxWidth: 1400, margin: "0 auto" }}>
      {/* Hero Header */}
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
                  background: "rgba(168, 85, 247, 0.15)",
                  color: "#c084fc",
                  border: "1px solid rgba(168, 85, 247, 0.3)",
                  padding: "3px 10px",
                  borderRadius: 12,
                  fontSize: 12,
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                <TrendingUp size={13} />
                Stage 5: Executive Intelligence Flight Deck
              </span>
              <span style={{ fontSize: 13, color: "#94a3b8" }}>· Statutory Safe Harbor Verified</span>
            </div>
            <h2 style={{ fontSize: 24, fontWeight: 700, color: "#f8fafc", margin: "0 0 6px 0", letterSpacing: "-0.02em" }}>
              Reconciliation 3.0 Concurrence Benchmark
            </h2>
            <p style={{ color: "#94a3b8", fontSize: 14, margin: 0, maxWidth: 820, lineHeight: 1.5 }}>
              Comprehensive disparity taxonomy, vendor stratification, and operational directives derived from the unified KICS 20,000-row workbook.
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
                KICS Concurrence
              </div>
              <div style={{ fontSize: 22, fontWeight: 800, color: "#34d399", marginTop: 1 }}>
                {b.concurrence_rate}%
              </div>
            </div>

            <div
              style={{
                background: "rgba(59, 130, 246, 0.12)",
                border: "1px solid rgba(59, 130, 246, 0.3)",
                borderRadius: 12,
                padding: "10px 18px",
                textAlign: "right",
              }}
            >
              <div style={{ fontSize: 11, textTransform: "uppercase", color: "#60a5fa", fontWeight: 700, letterSpacing: "0.05em" }}>
                Total Processed
              </div>
              <div style={{ fontSize: 22, fontWeight: 800, color: "#f8fafc", marginTop: 1 }}>
                {s.total_records.toLocaleString()}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Grid of Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))", gap: 16, marginBottom: 16 }}>
        {/* Category Breakdown */}
        <div
          style={{
            background: "rgba(15, 23, 42, 0.7)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            borderRadius: 14,
            padding: "1.25rem 1.5rem",
          }}
        >
          <h3 style={{ fontSize: 16, fontWeight: 700, color: "#f8fafc", margin: "0 0 12px 0", display: "flex", alignItems: "center", gap: 8 }}>
            <Layers size={16} style={{ color: "#38bdf8" }} />
            TARS vs KICS Category Alignment
          </h3>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, textAlign: "left" }}>
            <thead>
              <tr style={{ color: "#94a3b8", borderBottom: "1px solid rgba(255, 255, 255, 0.08)" }}>
                <th style={{ padding: "8px 0" }}>Category</th>
                <th style={{ padding: "8px 0", textAlign: "right" }}>TARS</th>
                <th style={{ padding: "8px 0", textAlign: "right" }}>KICS Baseline</th>
                <th style={{ padding: "8px 0", textAlign: "right" }}>Concurrence</th>
              </tr>
            </thead>
            <tbody>
              {b.breakdown_by_category.map((item) => (
                <tr key={item.category} style={{ borderBottom: "1px solid rgba(255, 255, 255, 0.04)" }}>
                  <td style={{ padding: "8px 0", color: "#cbd5e1" }}>{item.category}</td>
                  <td style={{ padding: "8px 0", textAlign: "right", fontWeight: 700, color: "#f8fafc" }}>
                    {item.tars_count.toLocaleString()}
                  </td>
                  <td style={{ padding: "8px 0", textAlign: "right", color: "#94a3b8" }}>
                    {item.kics_count.toLocaleString()}
                  </td>
                  <td style={{ padding: "8px 0", textAlign: "right", color: "#34d399", fontWeight: 700 }}>
                    {item.concurrence_pct}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Process Highlights */}
        <div
          style={{
            background: "rgba(15, 23, 42, 0.7)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            borderRadius: 14,
            padding: "1.25rem 1.5rem",
          }}
        >
          <h3 style={{ fontSize: 16, fontWeight: 700, color: "#f8fafc", margin: "0 0 12px 0", display: "flex", alignItems: "center", gap: 8 }}>
            <Zap size={16} style={{ color: "#f59e0b" }} />
            System Performance Highlights
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {data.process_highlights.map((h, i) => (
              <div
                key={i}
                style={{
                  background: "rgba(255, 255, 255, 0.02)",
                  border: "1px solid rgba(255, 255, 255, 0.06)",
                  borderRadius: 8,
                  padding: "10px 12px",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                  <span style={{ fontWeight: 700, color: "#f1f5f9", fontSize: 13 }}>{h.metric}</span>
                  <span style={{ fontSize: 11, color: "#38bdf8", fontWeight: 600 }}>{h.label}</span>
                </div>
                <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.4 }}>{h.detail}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Vendor Risk Stratification */}
      <div
        style={{
          background: "rgba(15, 23, 42, 0.7)",
          border: "1px solid rgba(255, 255, 255, 0.08)",
          borderRadius: 14,
          padding: "1.25rem 1.5rem",
          marginBottom: 16,
        }}
      >
        <h3 style={{ fontSize: 16, fontWeight: 700, color: "#f8fafc", margin: "0 0 12px 0", display: "flex", alignItems: "center", gap: 8 }}>
          <ShieldCheck size={16} style={{ color: "#10b981" }} />
          Vendor Risk Stratification
        </h3>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, textAlign: "left" }}>
            <thead>
              <tr style={{ color: "#94a3b8", borderBottom: "1px solid rgba(255, 255, 255, 0.08)" }}>
                <th style={{ padding: "8px 12px" }}>Supplier GSTIN</th>
                <th style={{ padding: "8px 12px" }}>Invoices</th>
                <th style={{ padding: "8px 12px" }}>Exact</th>
                <th style={{ padding: "8px 12px" }}>Tolerance</th>
                <th style={{ padding: "8px 12px" }}>Disparities</th>
                <th style={{ padding: "8px 12px" }}>Match Rate</th>
                <th style={{ padding: "8px 12px" }}>Taxable Consideration</th>
                <th style={{ padding: "8px 12px", textAlign: "right" }}>Risk Rating</th>
              </tr>
            </thead>
            <tbody>
              {data.vendor_stratification.slice(0, 10).map((v) => (
                <tr key={v.gstin} style={{ borderBottom: "1px solid rgba(255, 255, 255, 0.04)" }}>
                  <td style={{ padding: "8px 12px", fontFamily: "monospace", color: "#f8fafc", fontWeight: 600 }}>
                    {v.gstin}
                  </td>
                  <td style={{ padding: "8px 12px", color: "#cbd5e1" }}>{v.total_invoices}</td>
                  <td style={{ padding: "8px 12px", color: "#38bdf8" }}>{v.exact_count}</td>
                  <td style={{ padding: "8px 12px", color: "#34d399" }}>{v.tolerance_count}</td>
                  <td style={{ padding: "8px 12px", color: v.disparity_count > 0 ? "#f59e0b" : "#64748b" }}>
                    {v.disparity_count}
                  </td>
                  <td style={{ padding: "8px 12px", fontWeight: 700, color: v.match_pct >= 90 ? "#34d399" : "#fbbf24" }}>
                    {v.match_pct}%
                  </td>
                  <td style={{ padding: "8px 12px", color: "#cbd5e1" }}>
                    ₹{v.total_taxable.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </td>
                  <td style={{ padding: "8px 12px", textAlign: "right" }}>
                    <span
                      style={{
                        background:
                          v.risk_level === "LOW"
                            ? "rgba(16, 185, 129, 0.12)"
                            : v.risk_level === "MEDIUM"
                            ? "rgba(245, 158, 11, 0.12)"
                            : "rgba(239, 68, 68, 0.12)",
                        color:
                          v.risk_level === "LOW"
                            ? "#34d399"
                            : v.risk_level === "MEDIUM"
                            ? "#fbbf24"
                            : "#f87171",
                        borderRadius: 6,
                        padding: "2px 8px",
                        fontSize: 11,
                        fontWeight: 700,
                      }}
                    >
                      {v.risk_level}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
          onClick={onBackToResults}
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
          Back to Results Matrix
        </button>

        <button
          type="button"
          onClick={onProceedToExport}
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
          Proceed to Stage 6: Export Studio
          <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
};
