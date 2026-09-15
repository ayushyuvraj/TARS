import React, { useState, useMemo } from "react";
import { DirectColumnCorrelationV3, AgentThoughtV3 } from "./api_v3";
import {
  CheckCircle2,
  Sparkles,
  AlertTriangle,
  Search,
  ArrowRight,
  ShieldCheck,
  Edit3,
  SlidersHorizontal,
  FileSpreadsheet,
  ArrowLeft,
  Check,
  Zap,
  Layers,
  ChevronDown,
} from "lucide-react";

interface DynamicMappingGridV3Props {
  correlations: DirectColumnCorrelationV3[];
  targetColumns: string[];
  reconFileName?: string;
  sheetName?: string;
  kicsStatusColumn?: string | null;
  agentThoughts?: AgentThoughtV3[];
  totalDurationMs?: number;
  isConfirmed?: boolean;
  disabled?: boolean;
  onChange: (updated: DirectColumnCorrelationV3[]) => void;
  onConfirmMapping?: () => void;
  onBackToSetup?: () => void;
}

export const DynamicMappingGridV3: React.FC<DynamicMappingGridV3Props> = ({
  correlations = [],
  targetColumns = [],
  reconFileName = "TARS_KIGS_RECON_20000_Rows_All_Scenarios.xlsx",
  sheetName = "KIGS GSTR 2B Reco",
  kicsStatusColumn = "ReconciliationSection",
  agentThoughts = [],
  totalDurationMs = 180,
  isConfirmed = false,
  disabled = false,
  onChange,
  onConfirmMapping,
  onBackToSetup,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<"all" | "primary" | "paired" | "unpaired">("all");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const filteredCorrelations = useMemo(() => {
    return correlations.filter((c) => {
      const matchesSearch =
        c.source_column.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (c.selected_target_column && c.selected_target_column.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (c.canonical_concept && c.canonical_concept.toLowerCase().includes(searchQuery.toLowerCase()));

      if (!matchesSearch) return false;

      if (filterType === "primary") return c.is_primary_gst_field;
      if (filterType === "paired") return Boolean(c.selected_target_column);
      if (filterType === "unpaired") return !c.selected_target_column;
      return true;
    });
  }, [correlations, searchQuery, filterType]);

  const handleTargetChange = (idx: number, newTarget: string) => {
    const updated = [...correlations];
    updated[idx] = {
      ...updated[idx],
      selected_target_column: newTarget || null,
      confidence: newTarget ? 1.0 : 0.0,
      engine: "user_override",
      user_edited: true,
    };
    onChange(updated);
    setEditingIndex(null);
  };

  const pairedCount = correlations.filter((c) => c.selected_target_column).length;
  const primaryCount = correlations.filter((c) => c.is_primary_gst_field).length;

  return (
    <div className="dynamic-mapping-container" style={{ padding: "1.5rem", maxWidth: 1400, margin: "0 auto" }}>
      {/* Header Banner */}
      <div
        className="mapping-hero-card"
        style={{
          background: "linear-gradient(135deg, rgba(0, 51, 141, 0.12) 0%, rgba(15, 23, 42, 0.8) 100%)",
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
                  background: "rgba(6, 182, 212, 0.15)",
                  color: "#22d3ee",
                  border: "1px solid rgba(6, 182, 212, 0.3)",
                  padding: "3px 10px",
                  borderRadius: 12,
                  fontSize: 12,
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                <Layers size={13} />
                Stage 2: Intra-Table Schema Coupling
              </span>
              <span style={{ fontSize: 13, color: "#94a3b8" }}>· Unified Recon File</span>
            </div>
            <h2 style={{ fontSize: 24, fontWeight: 700, color: "#f8fafc", margin: "0 0 6px 0", letterSpacing: "-0.02em" }}>
              Single-File Column Linkage Matrix
            </h2>
            <p style={{ color: "#94a3b8", fontSize: 14, margin: 0, maxWidth: 820, lineHeight: 1.5 }}>
              TARS has probed your unified KICS reconciliation sheet (<code>{sheetName}</code>) and paired corresponding Counterparty (CP) and Purchase Register (PR) fields within the same table.
            </p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
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
                KICS Baseline Column
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#f8fafc", marginTop: 2 }}>
                <code>{kicsStatusColumn || "ReconciliationSection"}</code>
              </div>
            </div>

            <div
              style={{
                background: "rgba(59, 130, 246, 0.1)",
                border: "1px solid rgba(59, 130, 246, 0.25)",
                borderRadius: 12,
                padding: "10px 16px",
                textAlign: "right",
              }}
            >
              <div style={{ fontSize: 11, textTransform: "uppercase", color: "#60a5fa", fontWeight: 700, letterSpacing: "0.05em" }}>
                Coupled Pairs
              </div>
              <div style={{ fontSize: 18, fontWeight: 800, color: "#f8fafc", marginTop: 1 }}>
                {pairedCount} / {correlations.length}
              </div>
            </div>
          </div>
        </div>

        {/* Thought Chips */}
        {agentThoughts && agentThoughts.length > 0 && (
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid rgba(255, 255, 255, 0.08)", display: "flex", gap: 10, flexWrap: "wrap" }}>
            {agentThoughts.map((t, i) => (
              <span
                key={i}
                style={{
                  background: "rgba(255, 255, 255, 0.04)",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                  borderRadius: 8,
                  padding: "4px 10px",
                  fontSize: 12,
                  color: "#cbd5e1",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <Zap size={12} style={{ color: "#f59e0b" }} />
                {t.message}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Filter and Search Bar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 16,
          marginBottom: 16,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {(["all", "primary", "paired", "unpaired"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setFilterType(mode)}
              style={{
                background: filterType === mode ? "#00338D" : "rgba(30, 41, 59, 0.7)",
                color: filterType === mode ? "#ffffff" : "#94a3b8",
                border: filterType === mode ? "1px solid #3b82f6" : "1px solid rgba(255, 255, 255, 0.08)",
                borderRadius: 8,
                padding: "6px 14px",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
            >
              {mode === "all" && `All Fields (${correlations.length})`}
              {mode === "primary" && `Statutory Core (${primaryCount})`}
              {mode === "paired" && `Coupled (${pairedCount})`}
              {mode === "unpaired" && `Unpaired (${correlations.length - pairedCount})`}
            </button>
          ))}
        </div>

        <div style={{ position: "relative", minWidth: 280 }}>
          <Search size={15} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#64748b" }} />
          <input
            type="text"
            placeholder="Search column names or concepts..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: "100%",
              background: "rgba(15, 23, 42, 0.8)",
              border: "1px solid rgba(255, 255, 255, 0.12)",
              borderRadius: 8,
              padding: "7px 12px 7px 34px",
              color: "#f8fafc",
              fontSize: 13,
              outline: "none",
            }}
          />
        </div>
      </div>

      {/* Grid Table */}
      <div
        style={{
          background: "rgba(15, 23, 42, 0.7)",
          border: "1px solid rgba(255, 255, 255, 0.08)",
          borderRadius: 14,
          overflow: "hidden",
          boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.3)",
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "rgba(30, 41, 59, 0.85)", borderBottom: "1px solid rgba(255, 255, 255, 0.1)" }}>
              <th style={{ padding: "12px 16px", color: "#cbd5e1", fontWeight: 600, width: "32%" }}>
                Counterparty / Portal Column (Source)
              </th>
              <th style={{ padding: "12px 16px", color: "#cbd5e1", fontWeight: 600, width: "6%", textAlign: "center" }}>
                Link
              </th>
              <th style={{ padding: "12px 16px", color: "#cbd5e1", fontWeight: 600, width: "32%" }}>
                Purchase Register Column (Target)
              </th>
              <th style={{ padding: "12px 16px", color: "#cbd5e1", fontWeight: 600, width: "18%" }}>
                Statutory Concept
              </th>
              <th style={{ padding: "12px 16px", color: "#cbd5e1", fontWeight: 600, width: "12%", textAlign: "right" }}>
                Confidence
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredCorrelations.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ padding: "3rem", textAlign: "center", color: "#64748b" }}>
                  No column linkages match your search query.
                </td>
              </tr>
            ) : (
              filteredCorrelations.map((c, idx) => {
                const originalIdx = correlations.findIndex((orig) => orig.source_column === c.source_column);
                return (
                  <tr
                    key={c.source_column}
                    style={{
                      borderBottom: "1px solid rgba(255, 255, 255, 0.04)",
                      background: idx % 2 === 0 ? "transparent" : "rgba(255, 255, 255, 0.01)",
                      transition: "background 0.15s ease",
                    }}
                  >
                    {/* Source Column */}
                    <td style={{ padding: "12px 16px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {c.is_primary_gst_field && (
                          <span
                            title="Primary Statutory Field"
                            style={{
                              background: "rgba(59, 130, 246, 0.15)",
                              color: "#60a5fa",
                              borderRadius: 4,
                              padding: "2px 6px",
                              fontSize: 10,
                              fontWeight: 700,
                            }}
                          >
                            CORE
                          </span>
                        )}
                        <span style={{ fontWeight: 600, color: "#f1f5f9" }}>{c.source_column}</span>
                      </div>
                      {c.source_samples && c.source_samples.length > 0 && (
                        <div style={{ fontSize: 11, color: "#64748b", marginTop: 3 }}>
                          Samples: {c.source_samples.slice(0, 2).join(", ")}
                        </div>
                      )}
                    </td>

                    {/* Arrow */}
                    <td style={{ padding: "12px 16px", textAlign: "center" }}>
                      <ArrowRight size={15} style={{ color: c.selected_target_column ? "#38bdf8" : "#475569" }} />
                    </td>

                    {/* Target Column */}
                    <td style={{ padding: "12px 16px" }}>
                      {editingIndex === originalIdx ? (
                        <select
                          autoFocus
                          defaultValue={c.selected_target_column || ""}
                          onChange={(e) => handleTargetChange(originalIdx, e.target.value)}
                          onBlur={() => setEditingIndex(null)}
                          style={{
                            background: "#0f172a",
                            border: "1px solid #38bdf8",
                            borderRadius: 6,
                            padding: "4px 8px",
                            color: "#f8fafc",
                            fontSize: 13,
                            width: "100%",
                          }}
                        >
                          <option value="">-- Unpaired --</option>
                          {targetColumns.map((col) => (
                            <option key={col} value={col}>
                              {col}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <div
                          onClick={() => !disabled && setEditingIndex(originalIdx)}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                            cursor: disabled ? "default" : "pointer",
                            padding: "3px 8px",
                            borderRadius: 6,
                            background: c.selected_target_column ? "rgba(56, 189, 248, 0.08)" : "rgba(239, 68, 68, 0.08)",
                            border: c.selected_target_column ? "1px solid rgba(56, 189, 248, 0.2)" : "1px dashed rgba(239, 68, 68, 0.3)",
                            color: c.selected_target_column ? "#38bdf8" : "#f87171",
                            fontWeight: 500,
                          }}
                        >
                          <span>{c.selected_target_column || "Click to assign counterpart"}</span>
                          {!disabled && <ChevronDown size={13} style={{ opacity: 0.6 }} />}
                        </div>
                      )}
                    </td>

                    {/* Canonical Concept */}
                    <td style={{ padding: "12px 16px" }}>
                      {c.canonical_concept ? (
                        <span
                          style={{
                            background: "rgba(168, 85, 247, 0.12)",
                            color: "#c084fc",
                            border: "1px solid rgba(168, 85, 247, 0.25)",
                            borderRadius: 6,
                            padding: "3px 8px",
                            fontSize: 11,
                            fontWeight: 600,
                          }}
                        >
                          {c.canonical_concept}
                        </span>
                      ) : (
                        <span style={{ color: "#475569", fontSize: 11 }}>Generic Attribute</span>
                      )}
                    </td>

                    {/* Confidence */}
                    <td style={{ padding: "12px 16px", textAlign: "right" }}>
                      <span
                        style={{
                          color: c.confidence >= 0.9 ? "#34d399" : c.confidence > 0 ? "#fbbf24" : "#94a3b8",
                          fontWeight: 700,
                          fontSize: 12,
                        }}
                      >
                        {c.selected_target_column ? `${Math.round(c.confidence * 100)}%` : "0%"}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
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
          onClick={onBackToSetup}
          disabled={disabled}
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
          Back to Setup
        </button>

        <button
          type="button"
          onClick={onConfirmMapping}
          disabled={disabled || pairedCount === 0}
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
          Confirm Column Linkages & Proceed to Rules
          <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
};
