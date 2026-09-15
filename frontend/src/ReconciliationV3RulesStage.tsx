import React, { useState, useEffect } from "react";
import { Rule3Item, apiV3 } from "./api_v3";
import {
  ShieldCheck,
  Sparkles,
  ArrowLeft,
  ArrowRight,
  Sliders,
  CheckCircle2,
  Info,
  Check,
  Zap,
  Layers,
  ChevronUp,
  ChevronDown,
} from "lucide-react";

interface Props {
  sessionId: string;
  onBackToMapping: () => void;
  onProceedToResults: (selectedRuleIds: string[], executionOrder: string[]) => void;
}

export const ReconciliationV3RulesStage: React.FC<Props> = ({
  sessionId,
  onBackToMapping,
  onProceedToResults,
}) => {
  const [rules, setRules] = useState<Rule3Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let mounted = true;
    apiV3
      .getRules(sessionId)
      .then((res) => {
        if (mounted) {
          setRules(res);
          setLoading(false);
        }
      })
      .catch(() => {
        if (mounted) {
          setLoading(false);
        }
      });
    return () => {
      mounted = false;
    };
  }, [sessionId]);

  const toggleRule = (id: string) => {
    setRules((prev) =>
      prev.map((r) => (r.id === id ? { ...r, is_enabled: !r.is_enabled } : r))
    );
  };

  const moveRule = (index: number, direction: "up" | "down") => {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= rules.length) return;
    const updated = [...rules];
    const temp = updated[index];
    updated[index] = updated[targetIndex];
    updated[targetIndex] = temp;
    setRules(updated);
  };

  const handleConfirm = async () => {
    setSaving(true);
    try {
      const selectedIds = rules.filter((r) => r.is_enabled).map((r) => r.id);
      const executionOrder = rules.map((r) => r.id);
      await apiV3.confirmRules(sessionId, selectedIds, executionOrder, rules);
      onProceedToResults(selectedIds, executionOrder);
    } catch (e) {
      console.error("Failed to confirm rules:", e);
      // Still proceed on UI
      onProceedToResults(
        rules.filter((r) => r.is_enabled).map((r) => r.id),
        rules.map((r) => r.id)
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: "4rem", textAlign: "center", color: "#94a3b8" }}>
        <div className="spinner" style={{ margin: "0 auto 16px" }} />
        Loading Intra-Table Reconciliation Rules...
      </div>
    );
  }

  const enabledCount = rules.filter((r) => r.is_enabled).length;

  return (
    <div className="v3-rules-container" style={{ padding: "1.5rem", maxWidth: 1400, margin: "0 auto" }}>
      {/* Hero Header */}
      <div
        style={{
          background: "linear-gradient(135deg, rgba(0, 51, 141, 0.12) 0%, rgba(15, 23, 42, 0.85) 100%)",
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
                  background: "rgba(59, 130, 246, 0.15)",
                  color: "#60a5fa",
                  border: "1px solid rgba(59, 130, 246, 0.3)",
                  padding: "3px 10px",
                  borderRadius: 12,
                  fontSize: 12,
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                <Sliders size={13} />
                Stage 3: Intra-Table Rules Studio
              </span>
              <span style={{ fontSize: 13, color: "#94a3b8" }}>· Single-Record Logic</span>
            </div>
            <h2 style={{ fontSize: 24, fontWeight: 700, color: "#f8fafc", margin: "0 0 6px 0", letterSpacing: "-0.02em" }}>
              Intra-Table Reconciliation Guardrails
            </h2>
            <p style={{ color: "#94a3b8", fontSize: 14, margin: 0, maxWidth: 820, lineHeight: 1.5 }}>
              Configure validation thresholds and normalization strategies applied across Counterparty and Books columns within each transaction row.
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
              Active Rules
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#f8fafc", marginTop: 1 }}>
              {enabledCount} / {rules.length}
            </div>
          </div>
        </div>
      </div>

      {/* Rules List */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {rules.map((rule, idx) => (
          <div
            key={rule.id}
            style={{
              background: rule.is_enabled ? "rgba(15, 23, 42, 0.75)" : "rgba(15, 23, 42, 0.4)",
              border: rule.is_enabled ? "1px solid rgba(59, 130, 246, 0.2)" : "1px solid rgba(255, 255, 255, 0.05)",
              borderRadius: 14,
              padding: "1.25rem 1.5rem",
              display: "flex",
              alignItems: "flex-start",
              gap: 16,
              opacity: rule.is_enabled ? 1 : 0.65,
              transition: "all 0.15s ease",
            }}
          >
            {/* Reorder Buttons */}
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
              <button
                type="button"
                onClick={() => moveRule(idx, "up")}
                disabled={idx === 0}
                style={{
                  background: "rgba(255, 255, 255, 0.05)",
                  border: "none",
                  borderRadius: 4,
                  padding: "3px 5px",
                  color: idx === 0 ? "#475569" : "#cbd5e1",
                  cursor: idx === 0 ? "default" : "pointer",
                }}
              >
                <ChevronUp size={14} />
              </button>
              <button
                type="button"
                onClick={() => moveRule(idx, "down")}
                disabled={idx === rules.length - 1}
                style={{
                  background: "rgba(255, 255, 255, 0.05)",
                  border: "none",
                  borderRadius: 4,
                  padding: "3px 5px",
                  color: idx === rules.length - 1 ? "#475569" : "#cbd5e1",
                  cursor: idx === rules.length - 1 ? "default" : "pointer",
                }}
              >
                <ChevronDown size={14} />
              </button>
            </div>

            {/* Checkbox */}
            <input
              type="checkbox"
              checked={rule.is_enabled}
              onChange={() => toggleRule(rule.id)}
              style={{
                marginTop: 6,
                width: 18,
                height: 18,
                accentColor: "#00338D",
                cursor: "pointer",
              }}
            />

            {/* Content */}
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
                <span
                  style={{
                    background: "rgba(30, 41, 59, 0.9)",
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                    borderRadius: 6,
                    padding: "2px 8px",
                    fontSize: 12,
                    fontWeight: 700,
                    color: "#38bdf8",
                  }}
                >
                  {rule.id}
                </span>
                <h4 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#f8fafc" }}>
                  {rule.name}
                </h4>
                <span
                  style={{
                    background: rule.category === "CORE_STATUTORY" ? "rgba(59, 130, 246, 0.15)" : "rgba(168, 85, 247, 0.15)",
                    color: rule.category === "CORE_STATUTORY" ? "#60a5fa" : "#c084fc",
                    borderRadius: 6,
                    padding: "2px 8px",
                    fontSize: 11,
                    fontWeight: 600,
                  }}
                >
                  {rule.category}
                </span>
                <span
                  style={{
                    background: "rgba(255, 255, 255, 0.05)",
                    color: "#94a3b8",
                    borderRadius: 6,
                    padding: "2px 8px",
                    fontSize: 11,
                  }}
                >
                  <code>{rule.source_field_concept}</code> ↔ <code>{rule.target_field_concept}</code>
                </span>
              </div>

              <p style={{ color: "#cbd5e1", fontSize: 13, margin: "0 0 8px 0", lineHeight: 1.5 }}>
                {rule.description}
              </p>

              {rule.statutory_rationale && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 12,
                    color: "#34d399",
                    background: "rgba(16, 185, 129, 0.06)",
                    padding: "4px 10px",
                    borderRadius: 6,
                    border: "1px solid rgba(16, 185, 129, 0.15)",
                    width: "fit-content",
                  }}
                >
                  <ShieldCheck size={13} />
                  <span>{rule.statutory_rationale}</span>
                </div>
              )}
            </div>

            {/* Strategy / Tolerance Badge */}
            <div style={{ textAlign: "right", minWidth: 140 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8" }}>Strategy</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#38bdf8", marginTop: 2 }}>
                {rule.match_strategy}
              </div>
              {rule.tolerance_value !== undefined && rule.tolerance_value !== null && (
                <div style={{ fontSize: 12, color: "#f59e0b", marginTop: 4 }}>
                  ±{rule.tolerance_value} {rule.tolerance_unit || ""}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Bottom Actions */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: "2rem",
          paddingTop: "1.25rem",
          borderTop: "1px solid rgba(255, 255, 255, 0.08)",
        }}
      >
        <button
          type="button"
          onClick={onBackToMapping}
          disabled={saving}
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
          Back to Mapping
        </button>

        <button
          type="button"
          onClick={handleConfirm}
          disabled={saving || enabledCount === 0}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            background: "#00338D",
            color: "#ffffff",
            border: "none",
            borderRadius: 8,
            padding: "9px 24px",
            fontSize: 14,
            fontWeight: 700,
            cursor: "pointer",
            boxShadow: "0 4px 14px rgba(0, 51, 141, 0.4)",
            transition: "all 0.15s ease",
          }}
        >
          <Check size={16} />
          {saving ? "Executing Waterfall Engine..." : "Execute Intra-Table Waterfall (20,000 Rows)"}
          <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
};
