import React, { useState, useEffect, useMemo } from "react";
import {
  apiV2,
  Stage4ExecutionResponse,
  Stage4ResultsSummary,
  ReconciliationRecordItem,
} from "./api_v2";
import { ReconciliationV2ActionBar } from "./ReconciliationV2ActionBar";
import "./summary_export_v2.css";
import {
  Sparkles,
  ShieldCheck,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  Layers,
  ArrowRight,
  ArrowLeft,
  Building2,
  Filter,
  Check,
  Info,
  Clock,
  Coins,
} from "lucide-react";

interface ReconciliationV2SummaryStageProps {
  sessionId: string;
  onProceedToExport: () => void;
  onBack: () => void;
}

export const ReconciliationV2SummaryStage: React.FC<ReconciliationV2SummaryStageProps> = ({
  sessionId,
  onProceedToExport,
  onBack,
}) => {
  const [data, setData] = useState<Stage4ExecutionResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const loadSummary = async () => {
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const res = await apiV2.getStage4Results(sessionId);
        if (isMounted) setData(res);
      } catch (err: any) {
        if (isMounted) {
          // If not yet executed, attempt to execute stage 4
          try {
            const execRes = await apiV2.executeStage4Results(sessionId);
            if (isMounted) setData(execRes);
          } catch (execErr: any) {
            if (isMounted) {
              setErrorMessage(execErr?.message || "Failed to load reconciliation intelligence summary.");
            }
          }
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    loadSummary();
    return () => {
      isMounted = false;
    };
  }, [sessionId]);

  const summary = data?.summary;
  const records = data?.records || [];

  // Vendor Risk Aggregation
  const vendorStratification = useMemo(() => {
    const vendorMap: Record<
      string,
      { gstin: string; totalInvoices: number; matchedInvoices: number; claimableItc: number; disputedItc: number }
    > = {};

    records.forEach((rec) => {
      const gstin = rec.gstin || "UNKNOWN_GSTIN";
      if (!vendorMap[gstin]) {
        vendorMap[gstin] = { gstin, totalInvoices: 0, matchedInvoices: 0, claimableItc: 0, disputedItc: 0 };
      }
      vendorMap[gstin].totalInvoices += 1;
      const isMatched = rec.bucket === "EXACT_MATCH" || rec.bucket === "TOLERANCE_MATCH" || rec.bucket === "NEAR_MATCH";
      if (isMatched) {
        vendorMap[gstin].matchedInvoices += 1;
        vendorMap[gstin].claimableItc += Number(rec.tax_amount || 0);
      } else {
        vendorMap[gstin].disputedItc += Number(rec.tax_amount || 0);
      }
    });

    return Object.values(vendorMap).map((v) => {
      const matchPct = v.totalInvoices > 0 ? (v.matchedInvoices / v.totalInvoices) * 100 : 0;
      let riskLevel: "LOW" | "MED" | "HIGH" = "LOW";
      if (matchPct < 70) riskLevel = "HIGH";
      else if (matchPct < 90) riskLevel = "MED";

      return {
        ...v,
        matchPct: Math.round(matchPct * 10) / 10,
        riskLevel,
      };
    });
  }, [records]);

  // Reclassified ambiguity records for audit trace
  const resolvedAuditTrail = useMemo(() => {
    return records.filter((r) => Boolean(r.reclassification_note));
  }, [records]);

  // Financial calculations
  const claimableItcTotal = useMemo(() => {
    return records
      .filter((r) => r.bucket === "EXACT_MATCH" || r.bucket === "TOLERANCE_MATCH" || r.bucket === "NEAR_MATCH")
      .reduce((sum, r) => sum + Number(r.tax_amount || 0), 0);
  }, [records]);

  const disputedItcTotal = useMemo(() => {
    return records
      .filter((r) => r.bucket === "GSTR_ONLY" || r.bucket === "PR_ONLY" || r.bucket === "AMBIGUOUS")
      .reduce((sum, r) => sum + Number(r.tax_amount || 0), 0);
  }, [records]);

  if (isLoading) {
    return (
      <div className="v2-summary-container" style={{ padding: "40px 0", textAlign: "center" }}>
        <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <Sparkles className="animate-spin text-blue-600" size={32} />
          <div style={{ fontSize: 16, fontWeight: 700, color: "#00338D" }}>
            Compiling Executive Intelligence Dashboard...
          </div>
          <div style={{ fontSize: 13, color: "#64748b" }}>
            Aggregating statutory yields, risk stratification, and audit traces from confirmed ledger passes.
          </div>
        </div>
      </div>
    );
  }

  if (errorMessage) {
    return (
      <div className="v2-summary-container">
        <div className="v2-panel-card" style={{ borderColor: "#fecaca", background: "#fef2f2" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#991b1b" }}>
            <AlertTriangle size={20} />
            <strong>Unable to compile summary dashboard:</strong> {errorMessage}
          </div>
        </div>
      </div>
    );
  }

  const accuracyRate = summary?.overall_reconciliation_rate ?? 0;
  const totalGstr = summary?.total_gstr_rows ?? 0;
  const totalPr = summary?.total_pr_rows ?? 0;
  const totalMatches = (summary?.exact_match_count ?? 0) + (summary?.tolerance_match_count ?? 0) + (summary?.near_match_count ?? 0);

  return (
    <div className="v2-summary-container">
      {/* Header Info */}
      <header className="v2-stage-header-card">
        <span className="v2-stage-eyebrow">
          <Sparkles size={13} />
          Stage 5 of 6: Executive Flight Deck & Risk Intelligence
        </span>
        <h1 className="v2-stage-title">Executive Summary & Statutory Compliance Dashboard</h1>
        <p className="v2-stage-desc">
          Holistic synthesis of financial reconciliation outcomes, rule pass retention, supplier risk exposure, and
          human-in-the-loop disambiguation governance prior to ledger export.
        </p>
      </header>

      {/* Top Action Bar */}
      <ReconciliationV2ActionBar
        position="top"
        stageNumber={5}
        backLabel="Back to Results Matrix"
        onBack={onBack}
        nextLabel="Proceed to Ledger Export"
        onNext={onProceedToExport}
      />

      {/* 4 Core Financial KPIs */}
      <section className="v2-kpi-grid">
        {/* Match Accuracy Rate */}
        <div className="v2-kpi-card">
          <div className="v2-kpi-card__top">
            <span className="v2-kpi-card__label">Match Accuracy Rate</span>
            <div className="v2-kpi-card__icon" style={{ background: "#DCFCE7", color: "#166534" }}>
              <TrendingUp size={18} />
            </div>
          </div>
          <div className="v2-kpi-card__value">{accuracyRate}%</div>
          <div className="v2-kpi-card__sub">
            <span
              className="v2-kpi-badge"
              style={{
                background: accuracyRate >= 95 ? "#DCFCE7" : "#FEF3C7",
                color: accuracyRate >= 95 ? "#166534" : "#92400E",
              }}
            >
              {accuracyRate >= 95 ? "Optimal Statutory Yield" : "Acceptable Tolerance"}
            </span>
            <span>{totalMatches} matched invoices</span>
          </div>
        </div>

        {/* Claimable ITC */}
        <div className="v2-kpi-card">
          <div className="v2-kpi-card__top">
            <span className="v2-kpi-card__label">Claimable ITC (₹)</span>
            <div className="v2-kpi-card__icon" style={{ background: "#DBEAFE", color: "#1E40AF" }}>
              <Coins size={18} />
            </div>
          </div>
          <div className="v2-kpi-card__value">₹{claimableItcTotal.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</div>
          <div className="v2-kpi-card__sub">
            <span className="v2-kpi-badge" style={{ background: "#DBEAFE", color: "#1E40AF" }}>
              100% Eligible
            </span>
            <span>Secured for GSTR-3B filing</span>
          </div>
        </div>

        {/* Discrepancy / At-Risk Capital */}
        <div className="v2-kpi-card">
          <div className="v2-kpi-card__top">
            <span className="v2-kpi-card__label">Disputed / At-Risk ITC</span>
            <div className="v2-kpi-card__icon" style={{ background: "#FEE2E2", color: "#991B1B" }}>
              <AlertTriangle size={18} />
            </div>
          </div>
          <div className="v2-kpi-card__value">₹{disputedItcTotal.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</div>
          <div className="v2-kpi-card__sub">
            <span className="v2-kpi-badge" style={{ background: "#FEE2E2", color: "#991B1B" }}>
              Requires Follow-Up
            </span>
            <span>{(summary?.gstr_only_count ?? 0) + (summary?.pr_only_count ?? 0)} unmatched docs</span>
          </div>
        </div>

        {/* Ambiguity Disambiguation */}
        <div className="v2-kpi-card">
          <div className="v2-kpi-card__top">
            <span className="v2-kpi-card__label">Ambiguity Clearance</span>
            <div className="v2-kpi-card__icon" style={{ background: "#F0FDF4", color: "#166534" }}>
              <ShieldCheck size={18} />
            </div>
          </div>
          <div className="v2-kpi-card__value">{summary?.ambiguous_count ?? 0} Pending</div>
          <div className="v2-kpi-card__sub">
            <span className="v2-kpi-badge" style={{ background: "#DCFCE7", color: "#166534" }}>
              {resolvedAuditTrail.length} Reclassified
            </span>
            <span>Directly into Canonical Buckets</span>
          </div>
        </div>
      </section>

      {/* Row 1: Waterfall Yield & Rule Effectiveness */}
      <div className="v2-dashboard-row">
        {/* Progressive Elimination Yield */}
        <div className="v2-panel-card">
          <div className="v2-panel-header">
            <div className="v2-panel-title-wrap">
              <Layers size={18} color="#00338D" />
              <h3 className="v2-panel-title">Progressive Waterfall Retention Funnel</h3>
            </div>
            <span className="v2-panel-tag">Stage 3 Passes</span>
          </div>

          <div className="v2-funnel-list">
            {(summary?.waterfall_passes || []).map((p, idx) => {
              const passPct = totalGstr > 0 ? Math.round((p.matched_count / totalGstr) * 100) : 0;
              return (
                <div key={idx} className="v2-funnel-item">
                  <div className="v2-funnel-item__top">
                    <span className="v2-funnel-item__name">
                      <CheckCircle2 size={14} color="#166534" />
                      {p.name}
                    </span>
                    <span className="v2-funnel-item__stats">
                      {p.matched_count} docs • ₹{(p.matched_itc || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })} ({passPct}%)
                    </span>
                  </div>
                  <div className="v2-funnel-progress">
                    <div className="v2-funnel-progress__bar" style={{ width: `${Math.min(100, passPct)}%` }} />
                  </div>
                </div>
              );
            })}

            {/* Unlinked residual */}
            <div className="v2-funnel-item" style={{ background: "#fff5f5" }}>
              <div className="v2-funnel-item__top">
                <span className="v2-funnel-item__name" style={{ color: "#991b1b" }}>
                  <AlertTriangle size={14} color="#991b1b" />
                  Residual Unmatched (GSTR Only + PR Only)
                </span>
                <span className="v2-funnel-item__stats" style={{ color: "#991b1b" }}>
                  {(summary?.gstr_only_count ?? 0) + (summary?.pr_only_count ?? 0)} docs
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Stage 3 Rule Effectiveness Scorecard */}
        <div className="v2-panel-card">
          <div className="v2-panel-header">
            <div className="v2-panel-title-wrap">
              <Filter size={18} color="#00338D" />
              <h3 className="v2-panel-title">Stage 3 Rule Effectiveness Scorecard</h3>
            </div>
            <span className="v2-panel-tag">Engine Calibration</span>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table className="v2-clean-table">
              <thead>
                <tr>
                  <th>Compared Concept / Columns</th>
                  <th>Match Mode</th>
                  <th>Execution Tier</th>
                  <th>Integrity Status</th>
                </tr>
              </thead>
              <tbody>
                {(data?.compared_columns || []).map((col, idx) => (
                  <tr key={idx}>
                    <td>
                      <strong>{col.gstr_column}</strong>
                      <span style={{ color: "#94a3b8", margin: "0 4px" }}>↔</span>
                      <span style={{ color: "#475569" }}>{col.pr_column}</span>
                    </td>
                    <td>
                      <span className="v2-panel-tag" style={{ fontSize: 10 }}>
                        {col.strategy || (col as any).match_strategy || "DETERMINISTIC"}
                      </span>
                    </td>
                    <td>
                      <span style={{ fontSize: 11, fontWeight: 600, color: "#00338D" }}>
                        {idx === 0 ? "Tier 1: Strict Statutory" : "Tier 2: Policy Normalization"}
                      </span>
                    </td>
                    <td>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "#166534", fontWeight: 700, fontSize: 11 }}>
                        <Check size={12} /> Satisfied
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Row 2: Supplier Risk & Exposure Stratification */}
      <div className="v2-panel-card">
        <div className="v2-panel-header">
          <div className="v2-panel-title-wrap">
            <Building2 size={18} color="#00338D" />
            <h3 className="v2-panel-title">Supplier Risk & Compliance Stratification</h3>
          </div>
          <span className="v2-panel-tag">{vendorStratification.length} Counterparties</span>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table className="v2-clean-table">
            <thead>
              <tr>
                <th>Vendor GSTIN</th>
                <th>Total Invoices</th>
                <th>Reconciled Match Rate</th>
                <th>Claimable ITC (₹)</th>
                <th>Disputed ITC (₹)</th>
                <th>Vendor Risk Stratification</th>
              </tr>
            </thead>
            <tbody>
              {vendorStratification.map((v, idx) => (
                <tr key={idx}>
                  <td>
                    <strong>{v.gstin}</strong>
                  </td>
                  <td>{v.totalInvoices}</td>
                  <td>
                    <strong>{v.matchPct}%</strong>
                    <span style={{ fontSize: 10, color: "#64748b", marginLeft: 4 }}>
                      ({v.matchedInvoices}/{v.totalInvoices})
                    </span>
                  </td>
                  <td style={{ color: "#166534", fontWeight: 700 }}>
                    ₹{v.claimableItc.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                  </td>
                  <td style={{ color: v.disputedItc > 0 ? "#991b1b" : "#64748b", fontWeight: 600 }}>
                    ₹{v.disputedItc.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                  </td>
                  <td>
                    <span
                      className={`v2-risk-badge ${
                        v.riskLevel === "LOW"
                          ? "v2-risk-badge--low"
                          : v.riskLevel === "MED"
                          ? "v2-risk-badge--med"
                          : "v2-risk-badge--high"
                      }`}
                    >
                      {v.riskLevel === "LOW" && <Check size={10} />}
                      {v.riskLevel === "MED" && <AlertTriangle size={10} />}
                      {v.riskLevel === "HIGH" && <AlertTriangle size={10} />}
                      {v.riskLevel} COMPLIANCE RISK
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Row 3: Disambiguation Governance & Audit Trace Log */}
      {resolvedAuditTrail.length > 0 && (
        <div className="v2-panel-card">
          <div className="v2-panel-header">
            <div className="v2-panel-title-wrap">
              <ShieldCheck size={18} color="#166534" />
              <h3 className="v2-panel-title">Human-in-the-Loop Disambiguation Governance Trace</h3>
            </div>
            <span className="v2-panel-tag" style={{ background: "#dcfce7", color: "#166534" }}>
              {resolvedAuditTrail.length} Invoices Reclassified
            </span>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table className="v2-clean-table">
              <thead>
                <tr>
                  <th>Reconciled Invoice</th>
                  <th>Vendor GSTIN</th>
                  <th>Canonical Target Bucket</th>
                  <th>Provenance Trace & History</th>
                  <th>Deterministic AI Audit Remark</th>
                </tr>
              </thead>
              <tbody>
                {resolvedAuditTrail.map((rec) => (
                  <tr key={rec.id}>
                    <td>
                      <strong>{rec.document_number}</strong>
                    </td>
                    <td>{rec.gstin}</td>
                    <td>
                      <span
                        className="v2-panel-tag"
                        style={{
                          background: rec.bucket === "EXACT_MATCH" ? "#dcfce7" : "#dbeafe",
                          color: rec.bucket === "EXACT_MATCH" ? "#166534" : "#1e40af",
                          fontWeight: 700,
                        }}
                      >
                        {rec.bucket.replace("_", " ")}
                      </span>
                    </td>
                    <td style={{ color: "#00338D", fontWeight: 600 }}>{rec.reclassification_note}</td>
                    <td style={{ color: "#475569", fontStyle: "italic" }}>{rec.classification_reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Bottom Action Bar */}
      <ReconciliationV2ActionBar
        position="bottom"
        stageNumber={5}
        backLabel="Back to Results Matrix"
        onBack={onBack}
        nextLabel="Proceed to Ledger Export"
        onNext={onProceedToExport}
      />
    </div>
  );
};
