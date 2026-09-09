import React, { useEffect } from "react";
import {
  X,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  ShieldCheck,
  Check,
} from "lucide-react";
import { DirectColumnCorrelation } from "./api_v2";

interface MappingInspectorDrawerProps {
  correlation: DirectColumnCorrelation | null;
  prColumns: string[];
  isOpen: boolean;
  onClose: () => void;
  onSelectColumn: (gstrCol: string, prCol: string | null) => void;
}

export const MappingInspectorDrawer: React.FC<MappingInspectorDrawerProps> = ({
  correlation,
  isOpen,
  onClose,
  onSelectColumn,
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !correlation) return null;

  const isDeterministic = correlation.engine === "deterministic";
  const isLLM = correlation.engine.startsWith("llm");
  const isUserEdited = correlation.user_edited;

  return (
    <div className="v2-drawer-overlay" onClick={onClose}>
      {/* Drawer Panel */}
      <div className="v2-drawer-panel" onClick={(e) => e.stopPropagation()}>
        {/* Drawer Header */}
        <div className="v2-drawer-header">
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#6d2077", fontFamily: "var(--v2-font-mono)" }}>
                Mapping Inspector
              </span>
              {correlation.is_primary_gst_field && (
                <span className="v2-tag-core">
                  <ShieldCheck size={11} style={{ display: "inline", verticalAlign: "middle", marginRight: 2 }} />
                  Primary Field
                </span>
              )}
            </div>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--v2-slate-900)", margin: "4px 0 0 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {correlation.gstr_column}
            </h3>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", padding: 4, borderRadius: 6 }}
            aria-label="Close inspector drawer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Drawer Scrollable Content */}
        <div className="v2-drawer-body">
          {/* Engine & Confidence Banner */}
          <div className="v2-evidence-box">
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: isUserEdited ? "#eff6ff" : isDeterministic ? "#ecfdf5" : isLLM ? "#faf5ff" : "#fffbeb",
                  color: isUserEdited ? "#1d4ed8" : isDeterministic ? "#059669" : isLLM ? "#7c3aed" : "#d97706",
                }}
              >
                {isUserEdited ? <CheckCircle2 size={16} /> : isDeterministic ? <CheckCircle2 size={16} /> : isLLM ? <Sparkles size={16} /> : <AlertTriangle size={16} />}
              </div>
              <span style={{ fontSize: 14, fontWeight: 700, color: "var(--v2-slate-900)" }}>
                {(correlation.confidence * 100).toFixed(0)}% Confidence Match
              </span>
              <span style={{ fontSize: 10, fontFamily: "var(--v2-font-mono)", textTransform: "uppercase", padding: "2px 6px", borderRadius: 4, background: "var(--v2-slate-200)", color: "var(--v2-slate-700)" }}>
                {isUserEdited ? "USER OVERRIDE" : isDeterministic ? "DETERMINISTIC" : "AGENTIC AI"}
              </span>
            </div>
            <p style={{ fontSize: 12, color: "var(--v2-slate-600)", lineHeight: 1.5, margin: 0 }}>
              {correlation.reason}
            </p>
          </div>

          {/* Visual Source to Target Flow */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "var(--v2-slate-400)", letterSpacing: "0.06em", marginBottom: 8 }}>
              Resolution Flow
            </div>

            <div className="v2-resolution-card">
              <div>
                <span style={{ fontSize: 10, fontFamily: "var(--v2-font-mono)", color: "#38bdf8", textTransform: "uppercase", display: "block", marginBottom: 3 }}>
                  GSTR-2B Field
                </span>
                <div style={{ fontWeight: 700, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {correlation.gstr_column}
                </div>
                <span style={{ fontSize: 10, color: "#94a3b8", fontFamily: "var(--v2-font-mono)", marginTop: 2, display: "block" }}>
                  DTYPE: {correlation.gstr_dtype}
                </span>
              </div>

              <div style={{ borderLeft: "1px solid #1e293b", paddingLeft: 12 }}>
                <span style={{ fontSize: 10, fontFamily: "var(--v2-font-mono)", color: "#c084fc", textTransform: "uppercase", display: "block", marginBottom: 3 }}>
                  Matched PR Field
                </span>
                <div style={{ fontWeight: 700, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {correlation.selected_pr_column || "— Unmapped —"}
                </div>
                <span style={{ fontSize: 10, color: "#94a3b8", fontFamily: "var(--v2-font-mono)", marginTop: 2, display: "block" }}>
                  STATUS: {correlation.selected_pr_column ? "LINKED" : "UNMAPPED"}
                </span>
              </div>
            </div>
          </div>

          {/* Sample Data Comparison */}
          {correlation.gstr_samples && correlation.gstr_samples.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "var(--v2-slate-400)", letterSpacing: "0.06em", marginBottom: 8 }}>
                Sample Values Preview
              </div>
              <div style={{ border: "1px solid var(--v2-slate-200)", borderRadius: 12, overflow: "hidden", background: "#fbfcfe" }}>
                <div style={{ padding: "8px 12px", background: "var(--v2-slate-100)", borderBottom: "1px solid var(--v2-slate-200)", fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: "var(--v2-slate-500)", fontFamily: "var(--v2-font-mono)" }}>
                  First 5 Extracted Values (GSTR-2B)
                </div>
                <div>
                  {correlation.gstr_samples.map((val, idx) => (
                    <div
                      key={idx}
                      style={{ padding: "7px 12px", fontFamily: "var(--v2-font-mono)", fontSize: 11, borderBottom: "1px solid var(--v2-slate-100)", color: "var(--v2-slate-700)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    >
                      <span style={{ color: "#94a3b8", marginRight: 8, fontSize: 10 }}>#{idx + 1}</span>
                      {val || <span style={{ color: "#cbd5e1", fontStyle: "italic" }}>null / blank</span>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Alternative Recommendations */}
          {correlation.alternatives && correlation.alternatives.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "var(--v2-slate-400)", letterSpacing: "0.06em", marginBottom: 8 }}>
                Alternative Candidates Generated by AI
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {correlation.alternatives.map((alt) => {
                  const isCurrent = correlation.selected_pr_column === alt.pr_column;
                  return (
                    <div
                      key={alt.pr_column}
                      style={{
                        padding: "10px 12px",
                        borderRadius: 10,
                        border: isCurrent ? "1px solid #c084fc" : "1px solid var(--v2-slate-200)",
                        background: isCurrent ? "#faf5ff" : "#ffffff",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 10,
                      }}
                    >
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontWeight: 700, fontSize: 12.5, color: "var(--v2-slate-900)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {alt.pr_column}
                          </span>
                          <span style={{ fontSize: 10.5, fontFamily: "var(--v2-font-mono)", fontWeight: 700, color: "#0284c7" }}>
                            {(alt.confidence * 100).toFixed(0)}%
                          </span>
                        </div>
                        <p style={{ fontSize: 11, color: "var(--v2-slate-500)", margin: "2px 0 0 0", lineHeight: 1.4 }}>
                          {alt.reason}
                        </p>
                      </div>

                      {isCurrent ? (
                        <span style={{ fontSize: 10.5, fontWeight: 700, background: "#6d2077", color: "#ffffff", padding: "3px 8px", borderRadius: 6, display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                          <Check size={11} /> Linked
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onSelectColumn(correlation.gstr_column, alt.pr_column)}
                          style={{ padding: "4px 10px", fontSize: 11, fontWeight: 600, background: "#ffffff", border: "1px solid var(--v2-slate-300)", borderRadius: 6, color: "var(--v2-slate-700)", cursor: "pointer", flexShrink: 0 }}
                        >
                          Switch
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Drawer Footer */}
        <div className="v2-drawer-footer">
          <button
            type="button"
            onClick={() => onSelectColumn(correlation.gstr_column, null)}
            style={{ background: "none", border: "none", color: "#e11d48", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
          >
            Unmap Field
          </button>
          <button
            type="button"
            onClick={onClose}
            className="v2-btn-secondary"
          >
            Close Inspector
          </button>
        </div>
      </div>
    </div>
  );
};
