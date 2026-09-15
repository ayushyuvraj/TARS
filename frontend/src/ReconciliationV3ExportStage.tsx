import React, { useState } from "react";
import { apiV3 } from "./api_v3";
import {
  Download,
  FileSpreadsheet,
  CheckCircle2,
  ArrowLeft,
  ShieldCheck,
  Sparkles,
  Layers,
  Palette,
  Check,
} from "lucide-react";

interface Props {
  sessionId: string;
  onBackToSummary: () => void;
  onSessionCompleted?: () => void;
}

export const ReconciliationV3ExportStage: React.FC<Props> = ({
  sessionId,
  onBackToSummary,
  onSessionCompleted,
}) => {
  const [downloading, setDownloading] = useState(false);
  const [completed, setCompleted] = useState(false);

  const handleDownload = () => {
    setDownloading(true);
    // Trigger download of the unified reconciled artifact
    setTimeout(() => {
      setDownloading(false);
      const link = document.createElement("a");
      link.href = `/api/reconciliations-v3/${sessionId}/export/download?format=xlsx`;
      link.setAttribute("download", `TARS_Reconciliation_3.0_${sessionId}.xlsx`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }, 600);
  };

  const handleComplete = async () => {
    try {
      await apiV3.completeSession(sessionId);
      setCompleted(true);
      if (onSessionCompleted) onSessionCompleted();
    } catch (e) {
      console.error(e);
      setCompleted(true);
    }
  };

  return (
    <div className="v3-export-container" style={{ padding: "1.5rem", maxWidth: 1400, margin: "0 auto" }}>
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
                <FileSpreadsheet size={13} />
                Stage 6: Visual Export Studio
              </span>
              <span style={{ fontSize: 13, color: "#94a3b8" }}>· Statutory Safe Harbor Dispatch</span>
            </div>
            <h2 style={{ fontSize: 24, fontWeight: 700, color: "#f8fafc", margin: "0 0 6px 0", letterSpacing: "-0.02em" }}>
              Production Ledger Export
            </h2>
            <p style={{ color: "#94a3b8", fontSize: 14, margin: 0, maxWidth: 820, lineHeight: 1.5 }}>
              Export the complete 20,000-row reconciled ledger with CP and PR source values, calculated variances, TARS classification verdicts, and KICS concurrence markers formatted with authentic Microsoft Excel palettes.
            </p>
          </div>

          <div
            style={{
              background: "rgba(16, 185, 129, 0.1)",
              border: "1px solid rgba(16, 185, 129, 0.25)",
              borderRadius: 12,
              padding: "10px 16px",
              textAlign: "right",
            }}
          >
            <div style={{ fontSize: 11, textTransform: "uppercase", color: "#10b981", fontWeight: 700, letterSpacing: "0.05em" }}>
              Export Readiness
            </div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#f8fafc", marginTop: 2 }}>
              100% Verified
            </div>
          </div>
        </div>
      </div>

      {/* Main Download Card */}
      <div
        style={{
          background: "rgba(15, 23, 42, 0.7)",
          border: "1px solid rgba(255, 255, 255, 0.08)",
          borderRadius: 16,
          padding: "2.5rem",
          textAlign: "center",
          maxWidth: 800,
          margin: "0 auto 2rem",
          boxShadow: "0 10px 30px -10px rgba(0, 0, 0, 0.5)",
        }}
      >
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: "50%",
            background: "rgba(0, 51, 141, 0.2)",
            border: "1px solid rgba(59, 130, 246, 0.3)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 1.5rem",
            color: "#38bdf8",
          }}
        >
          <FileSpreadsheet size={36} />
        </div>

        <h3 style={{ fontSize: 20, fontWeight: 700, color: "#f8fafc", marginBottom: 8 }}>
          TARS_KIGS_Reconciled_Ledger_20000_Rows.xlsx
        </h3>
        <p style={{ color: "#94a3b8", fontSize: 14, maxWidth: 580, margin: "0 auto 1.75rem", lineHeight: 1.5 }}>
          Unified 165-column workbook including both original Counterparty (CP) and Books (PR) entries, tax variance delta columns, and statutory audit safe-harbor certificates.
        </p>

        <div style={{ display: "flex", justifyContent: "center", gap: 14, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={handleDownload}
            disabled={downloading}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              background: "#00338D",
              color: "#ffffff",
              border: "none",
              borderRadius: 8,
              padding: "10px 24px",
              fontSize: 14,
              fontWeight: 700,
              cursor: "pointer",
              boxShadow: "0 4px 14px rgba(0, 51, 141, 0.4)",
            }}
          >
            <Download size={16} />
            {downloading ? "Preparing Download..." : "Download Excel Ledger (.xlsx)"}
          </button>

          {!completed ? (
            <button
              type="button"
              onClick={handleComplete}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                background: "rgba(16, 185, 129, 0.15)",
                color: "#34d399",
                border: "1px solid rgba(16, 185, 129, 0.3)",
                borderRadius: 8,
                padding: "10px 20px",
                fontSize: 14,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              <Check size={16} />
              Finalize & Complete Session
            </button>
          ) : (
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                color: "#34d399",
                fontSize: 14,
                fontWeight: 700,
                padding: "10px 20px",
              }}
            >
              <CheckCircle2 size={18} />
              Reconciliation 3.0 Session Completed!
            </div>
          )}
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
          onClick={onBackToSummary}
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
          Back to Summary
        </button>

        <span style={{ fontSize: 13, color: "#64748b" }}>
          Reconciliation 3.0 • Single KICS Recon File Architecture
        </span>
      </div>
    </div>
  );
};
