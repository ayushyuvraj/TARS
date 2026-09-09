import React, { useState, useEffect, useMemo } from "react";
import {
  apiV2,
  DirectColumnCorrelation,
  MatchingPass,
  FieldMatchRule,
  MatchStrategy,
  NormalizationType,
  SimulationResult,
} from "./api_v2";
import {
  Sparkles,
  Layers,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  Play,
  ChevronUp,
  ChevronDown,
  Plus,
  Trash2,
  RefreshCw,
  Sliders,
  Check,
  Eye,
  Calendar,
  DollarSign,
  FileText,
  Hash,
} from "lucide-react";
import "./rules_v2.css";

interface Props {
  sessionId: string;
  correlations: DirectColumnCorrelation[];
  prColumns: string[];
  onBackToMapping: () => void;
  onProceedToResults: (selectedRuleIds: string[], executionOrder: string[]) => void;
}

const ALL_NORMALIZERS: { type: NormalizationType; label: string; desc: string }[] = [
  { type: "TRIM_WHITESPACE", label: "Clean Spaces", desc: "Strip leading, trailing & extra spaces" },
  { type: "STRIP_SPECIAL_CHARS", label: "Strip Symbols (+, -, /, _, #)", desc: "Remove punctuation and symbols" },
  { type: "REMOVE_PREFIXES", label: "Strip Prefixes (INV, BILL, TAX)", desc: "Remove common invoice prefixes" },
  { type: "TRIM_LEADING_ZEROS", label: "Trim Leading Zeros (0042 → 42)", desc: "Strip zero padding" },
  { type: "UPPERCASE", label: "Case Fold (A-Z)", desc: "Ignore case differences" },
  { type: "ALPHANUMERIC_ONLY", label: "Strict Alphanumeric", desc: "Keep letters & numbers only" },
];

export const ReconciliationV2RulesStage: React.FC<Props> = ({
  sessionId,
  correlations,
  prColumns,
  onBackToMapping,
  onProceedToResults,
}) => {
  const [passes, setPasses] = useState<MatchingPass[]>([]);
  const [selectedPassId, setSelectedPassId] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [simulationResult, setSimulationResult] = useState<SimulationResult | null>(null);
  const [isConfirming, setIsConfirming] = useState<boolean>(false);
  const [showAddRuleModal, setShowAddRuleModal] = useState<boolean>(false);

  // New rule draft state
  const [newRuleGstrCol, setNewRuleGstrCol] = useState<string>("");
  const [newRulePrCol, setNewRulePrCol] = useState<string>("");
  const [newRuleStrategy, setNewRuleStrategy] = useState<MatchStrategy>("EXACT");

  // Hydrate or build default waterfall
  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);

    apiV2
      .getWaterfall(sessionId)
      .then((data) => {
        if (isMounted && data && data.length > 0) {
          setPasses(data);
          setSelectedPassId(data[0].pass_id);
        }
      })
      .catch((err) => {
        console.warn("Could not load backend waterfall, using defaults:", err);
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [sessionId]);

  const selectedPass = useMemo(() => {
    return passes.find((p) => p.pass_id === selectedPassId) || passes[0];
  }, [passes, selectedPassId]);

  // Waterfall reorder handlers
  const handleMovePass = (idx: number, direction: "up" | "down") => {
    const targetIdx = direction === "up" ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= passes.length) return;

    const updated = [...passes];
    const temp = updated[idx];
    updated[idx] = updated[targetIdx];
    updated[targetIdx] = temp;

    // Recalculate tier numbers
    updated.forEach((p, i) => {
      p.tier = i + 1;
    });

    setPasses(updated);
  };

  const handleTogglePass = (passId: string) => {
    setPasses((prev) =>
      prev.map((p) => (p.pass_id === passId ? { ...p, is_enabled: !p.is_enabled } : p))
    );
  };

  // Rule editing in active pass
  const handleToggleNormalizer = (ruleId: string, normType: NormalizationType) => {
    if (!selectedPass) return;
    setPasses((prev) =>
      prev.map((p) => {
        if (p.pass_id !== selectedPass.pass_id) return p;
        return {
          ...p,
          rules: p.rules.map((r) => {
            if (r.rule_id !== ruleId) return r;
            const exists = r.normalizers.includes(normType);
            const nextNorms = exists
              ? r.normalizers.filter((n) => n !== normType)
              : [...r.normalizers, normType];
            return { ...r, normalizers: nextNorms };
          }),
        };
      })
    );
  };

  const handleStrategyChange = (ruleId: string, strategy: MatchStrategy) => {
    if (!selectedPass) return;
    setPasses((prev) =>
      prev.map((p) => {
        if (p.pass_id !== selectedPass.pass_id) return p;
        return {
          ...p,
          rules: p.rules.map((r) => {
            if (r.rule_id !== ruleId) return r;
            return { ...r, strategy };
          }),
        };
      })
    );
  };

  const handleToleranceChange = (ruleId: string, value: number) => {
    if (!selectedPass) return;
    setPasses((prev) =>
      prev.map((p) => {
        if (p.pass_id !== selectedPass.pass_id) return p;
        return {
          ...p,
          rules: p.rules.map((r) => {
            if (r.rule_id !== ruleId) return r;
            return { ...r, tolerance_value: value };
          }),
        };
      })
    );
  };

  const handleDateToleranceChange = (ruleId: string, days: number) => {
    if (!selectedPass) return;
    setPasses((prev) =>
      prev.map((p) => {
        if (p.pass_id !== selectedPass.pass_id) return p;
        return {
          ...p,
          rules: p.rules.map((r) => {
            if (r.rule_id !== ruleId) return r;
            return { ...r, date_tolerance_days: days };
          }),
        };
      })
    );
  };

  const handleDeleteRule = (ruleId: string) => {
    if (!selectedPass) return;
    setPasses((prev) =>
      prev.map((p) => {
        if (p.pass_id !== selectedPass.pass_id) return p;
        return {
          ...p,
          rules: p.rules.filter((r) => r.rule_id !== ruleId),
        };
      })
    );
  };

  const handleAddRuleToPass = () => {
    if (!selectedPass || !newRuleGstrCol || !newRulePrCol) return;
    const newRule: FieldMatchRule = {
      rule_id: `RUL-${Date.now().toString().slice(-6)}`,
      gstr_column: newRuleGstrCol,
      pr_column: newRulePrCol,
      strategy: newRuleStrategy,
      normalizers:
        newRuleStrategy === "NORMALIZED_TEXT"
          ? ["TRIM_WHITESPACE", "STRIP_SPECIAL_CHARS", "UPPERCASE"]
          : ["TRIM_WHITESPACE"],
      tolerance_value: newRuleStrategy === "NUMERIC_TOLERANCE" ? 5.0 : 0.0,
      date_tolerance_days: newRuleStrategy === "DATE_PROXIMITY" ? 15 : 0,
      is_active: true,
    };

    setPasses((prev) =>
      prev.map((p) => {
        if (p.pass_id !== selectedPass.pass_id) return p;
        return {
          ...p,
          rules: [...p.rules, newRule],
        };
      })
    );
    setShowAddRuleModal(false);
    setNewRuleGstrCol("");
    setNewRulePrCol("");
  };

  const handleAddPass = () => {
    const newTier = passes.length + 1;
    const newPass: MatchingPass = {
      pass_id: `PASS-${newTier}-CUSTOM`,
      name: `Tier ${newTier}: Custom Fallback Pass`,
      description: "User-defined progressive matching tier",
      tier: newTier,
      is_enabled: true,
      rules: [],
    };
    setPasses([...passes, newPass]);
    setSelectedPassId(newPass.pass_id);
  };

  // Run Simulation against uploaded data
  const handleRunSimulation = async () => {
    setIsSimulating(true);
    try {
      const res = await apiV2.simulateRules(sessionId, passes);
      setSimulationResult(res);
    } catch (err: any) {
      alert(`Simulation failed: ${err?.message || err}`);
    } finally {
      setIsSimulating(false);
    }
  };

  // Confirm and proceed to Results
  const handleConfirmAndProceed = async () => {
    setIsConfirming(true);
    try {
      await apiV2.confirmWaterfall(sessionId, passes);
      const ruleIds = passes.flatMap((p) => p.rules.map((r) => r.rule_id));
      onProceedToResults(ruleIds, passes.map((p) => p.pass_id));
    } catch (err: any) {
      alert(`Could not save rules waterfall: ${err?.message || err}`);
    } finally {
      setIsConfirming(false);
    }
  };

  // Find yield for a specific pass if simulated
  const getPassYield = (passId: string) => {
    return simulationResult?.waterfall.find((w) => w.pass_id === passId);
  };

  if (isLoading) {
    return (
      <div className="v2-rules-container">
        <div className="v2-processing-state-card" style={{ margin: "60px auto", maxWidth: 500 }}>
          <div className="v2-processing-header">
            <RefreshCw size={24} className="v2-spin" style={{ color: "#2563eb" }} />
            <div>
              <h4 className="v2-processing-title">Configuring Rules 2.0 Studio</h4>
              <p className="v2-processing-step">
                Assembling progressive normalizer stack and column cascades...
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="v2-rules-container">
      {/* 1. Header & Primary Action Bar */}
      <header className="v2-rules-header">
        <div className="v2-rules-header__info">
          <div className="v2-rules-eyebrow">
            <Layers size={13} />
            <span>RULES ENGINE 2.0 — WATERFALL SIMULATION STUDIO</span>
          </div>
          <h2 className="v2-rules-title">Match Goverment Portal vs. Purchase Register</h2>
          <p className="v2-rules-subtitle">
            Reconciliation 2.0 matches rows hierarchically: from 100% strict identity down to
            progressive symbol stripping (+, -, /, _) and tolerance windows. Simulate in real-time
            against your actual workbooks before running.
          </p>
        </div>

        <div className="v2-rules-header__actions">
          <button
            type="button"
            className="v2-browse-button"
            onClick={onBackToMapping}
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <ArrowLeft size={15} />
            <span>Back to Mapping</span>
          </button>

          <button
            type="button"
            className="btn-ai-sparkle"
            onClick={handleRunSimulation}
            disabled={isSimulating}
            style={{ background: "linear-gradient(135deg, #0284c7 0%, #0369a1 100%)" }}
          >
            {isSimulating ? (
              <RefreshCw size={15} className="v2-spin" />
            ) : (
              <Play size={15} fill="currentColor" />
            )}
            <span>{isSimulating ? "Simulating Rows..." : "Simulate Rules (Live)"}</span>
          </button>

          <button
            type="button"
            className="btn-ai-sparkle"
            onClick={handleConfirmAndProceed}
            disabled={isConfirming}
          >
            {isConfirming ? (
              <RefreshCw size={15} className="v2-spin" />
            ) : (
              <CheckCircle2 size={15} />
            )}
            <span>Save & Proceed to Run</span>
            <ArrowRight size={15} />
          </button>
        </div>
      </header>

      {/* 2. Simulation HUD Ribbon (when results are available) */}
      {simulationResult && (
        <section className="v2-simulation-hud-card">
          <div className="v2-sim-hud-top">
            <div className="v2-sim-badge">
              <Sparkles size={13} />
              <span>LIVE DATASET SIMULATION TELEMETRY</span>
            </div>
            <span style={{ fontSize: 12, color: "#94a3b8", fontFamily: "JetBrains Mono, monospace" }}>
              Total Records Processed: {simulationResult.total_gstr_rows} Gov /{" "}
              {simulationResult.total_pr_rows} PR
            </span>
          </div>

          <div className="v2-kpi-grid">
            <div className="v2-kpi-box">
              <span className="v2-kpi-num green">{simulationResult.overall_match_rate}%</span>
              <span className="v2-kpi-label">Cumulative Match Rate</span>
            </div>
            <div className="v2-kpi-box">
              <span className="v2-kpi-num">{simulationResult.total_matched}</span>
              <span className="v2-kpi-label">Matched Row Pairs</span>
            </div>
            <div className="v2-kpi-box">
              <span className="v2-kpi-num amber">{simulationResult.total_unmatched_gstr}</span>
              <span className="v2-kpi-label">Unmatched Government Rows</span>
            </div>
            <div className="v2-kpi-box">
              <span className="v2-kpi-num amber">{simulationResult.total_unmatched_pr}</span>
              <span className="v2-kpi-label">Unmatched PR Rows</span>
            </div>
          </div>

          {/* Stacked Waterfall Progress Bar */}
          <div className="v2-waterfall-bar-wrap">
            <div className="v2-stacked-bar">
              {simulationResult.waterfall.map((w, idx) => {
                const colors = ["v2-bar-tier1", "v2-bar-tier2", "v2-bar-tier3"];
                const colorClass = colors[idx % colors.length];
                return (
                  <div
                    key={w.pass_id}
                    className={colorClass}
                    style={{ width: `${w.pass_match_percentage}%` }}
                    title={`${w.pass_name}: ${w.pass_match_percentage}% (${w.matched_count} rows)`}
                  />
                );
              })}
              <div
                className="v2-bar-unmatched"
                style={{
                  width: `${Math.max(0, 100 - simulationResult.overall_match_rate)}%`,
                }}
                title={`Unmatched: ${(100 - simulationResult.overall_match_rate).toFixed(1)}%`}
              />
            </div>

            <div className="v2-bar-legend">
              {simulationResult.waterfall.map((w, idx) => {
                const dotColors = ["#3b82f6", "#8b5cf6", "#f59e0b"];
                return (
                  <div key={w.pass_id} className="v2-legend-item">
                    <span
                      className="v2-legend-dot"
                      style={{ background: dotColors[idx % dotColors.length] }}
                    />
                    <span>
                      {w.pass_name}: <strong>+{w.pass_match_percentage}%</strong> (
                      {w.matched_count} rows)
                    </span>
                  </div>
                );
              })}
              <div className="v2-legend-item">
                <span className="v2-legend-dot" style={{ background: "rgba(255,255,255,0.3)" }} />
                <span>
                  Unmatched:{" "}
                  <strong>{(100 - simulationResult.overall_match_rate).toFixed(1)}%</strong>
                </span>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* 3. Studio Main Layout (Left: Waterfall Pipeline, Right: Inspector & Sample Rows) */}
      <div className="v2-studio-layout">
        {/* LEFT COLUMN: The Waterfall Passes */}
        <aside className="v2-waterfall-sidebar">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: "#475569",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              Waterfall Stages ({passes.length})
            </span>
            <button
              type="button"
              className="v2-icon-btn"
              onClick={handleAddPass}
              title="Add Custom Waterfall Tier"
              style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 8px" }}
            >
              <Plus size={13} />
              <span style={{ fontSize: 11, fontWeight: 600 }}>Add Tier</span>
            </button>
          </div>

          {passes.map((mPass, idx) => {
            const isSelected = mPass.pass_id === selectedPass?.pass_id;
            const passYield = getPassYield(mPass.pass_id);

            return (
              <div
                key={mPass.pass_id}
                className={`v2-waterfall-card ${isSelected ? "is-selected" : ""} ${
                  !mPass.is_enabled ? "is-disabled" : ""
                }`}
                onClick={() => setSelectedPassId(mPass.pass_id)}
              >
                <div className="v2-wf-card-top">
                  <span className="v2-wf-tier-tag">
                    <Layers size={11} />
                    <span>TIER {mPass.tier}</span>
                  </span>

                  <div className="v2-wf-card-actions" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className="v2-icon-btn"
                      disabled={idx === 0}
                      onClick={() => handleMovePass(idx, "up")}
                      title="Move Up in Priority"
                    >
                      <ChevronUp size={13} />
                    </button>
                    <button
                      type="button"
                      className="v2-icon-btn"
                      disabled={idx === passes.length - 1}
                      onClick={() => handleMovePass(idx, "down")}
                      title="Move Down in Priority"
                    >
                      <ChevronDown size={13} />
                    </button>
                    <input
                      type="checkbox"
                      checked={mPass.is_enabled}
                      onChange={() => handleTogglePass(mPass.pass_id)}
                      title={mPass.is_enabled ? "Disable this tier" : "Enable this tier"}
                      style={{ cursor: "pointer", marginLeft: 4 }}
                    />
                  </div>
                </div>

                <h4 className="v2-wf-card-title">{mPass.name}</h4>
                <p className="v2-wf-card-desc">{mPass.description}</p>

                <div className={`v2-wf-card-stats ${passYield ? "has-yield" : ""}`}>
                  <span>{mPass.rules.length} column rules</span>
                  {passYield ? (
                    <span className="v2-wf-yield-val">
                      +{passYield.pass_match_percentage}% ({passYield.matched_count} matches)
                    </span>
                  ) : (
                    <span style={{ color: "#94a3b8" }}>Not simulated yet</span>
                  )}
                </div>
              </div>
            );
          })}
        </aside>

        {/* RIGHT COLUMN: Active Pass Inspector & Rule Cards */}
        <main className="v2-studio-main">
          {selectedPass ? (
            <div className="v2-inspector-panel">
              <div className="v2-inspector-header">
                <div className="v2-inspector-title-wrap">
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span className="v2-wf-tier-tag">TIER {selectedPass.tier}</span>
                    <h3 className="v2-inspector-title">{selectedPass.name}</h3>
                  </div>
                  <p className="v2-inspector-desc">{selectedPass.description}</p>
                </div>

                <button
                  type="button"
                  className="v2-browse-button"
                  onClick={() => setShowAddRuleModal(true)}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                >
                  <Plus size={14} />
                  <span>Add Column Rule</span>
                </button>
              </div>

              {/* List of Rules inside this Pass */}
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {selectedPass.rules.length === 0 ? (
                  <div
                    style={{
                      padding: 30,
                      textAlign: "center",
                      color: "#64748b",
                      background: "#f8fafc",
                      borderRadius: 10,
                      border: "1px dashed #cbd5e1",
                    }}
                  >
                    No column rules configured for this tier yet. Click "Add Column Rule" above to
                    bind Government and PR fields.
                  </div>
                ) : (
                  selectedPass.rules.map((rule) => {
                    const isTolerance = rule.strategy === "NUMERIC_TOLERANCE";
                    const isDate = rule.strategy === "DATE_PROXIMITY";
                    const isNormalized =
                      rule.strategy === "NORMALIZED_TEXT" || rule.strategy === "EXACT";

                    return (
                      <div key={rule.rule_id} className="v2-rule-item-card">
                        <div className="v2-rule-col-pair-row">
                          <div className="v2-pair-badges">
                            <span className="v2-source-pill">
                              Gov: <strong>{rule.gstr_column}</strong>
                            </span>
                            <span className="v2-pair-arrow">⟷</span>
                            <span className="v2-source-pill pr">
                              PR: <strong>{rule.pr_column}</strong>
                            </span>
                            {rule.canonical_concept && (
                              <span
                                style={{
                                  fontSize: 11,
                                  fontFamily: "JetBrains Mono, monospace",
                                  color: "#64748b",
                                  background: "#f1f5f9",
                                  padding: "2px 6px",
                                  borderRadius: 4,
                                }}
                              >
                                {rule.canonical_concept.toUpperCase()}
                              </span>
                            )}
                          </div>

                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <select
                              className="v2-strategy-select"
                              value={rule.strategy}
                              onChange={(e) =>
                                handleStrategyChange(rule.rule_id, e.target.value as MatchStrategy)
                              }
                            >
                              <option value="EXACT">Strict 100% Exact Match</option>
                              <option value="NORMALIZED_TEXT">Progressive Normalization</option>
                              <option value="NUMERIC_TOLERANCE">Numeric Tolerance Window (± ₹)</option>
                              <option value="DATE_PROXIMITY">Date Proximity Window (± Days)</option>
                            </select>

                            <button
                              type="button"
                              className="v2-icon-btn"
                              onClick={() => handleDeleteRule(rule.rule_id)}
                              title="Delete rule"
                              style={{ color: "#ef4444" }}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>

                        {/* Normalization Chips */}
                        {isNormalized && (
                          <div className="v2-norm-group">
                            <span className="v2-norm-label">Active String Cleaning Measures:</span>
                            <div className="v2-chips-wrap">
                              {ALL_NORMALIZERS.map((norm) => {
                                const isActive = rule.normalizers.includes(norm.type);
                                return (
                                  <button
                                    key={norm.type}
                                    type="button"
                                    className={`v2-norm-chip ${isActive ? "is-active" : ""}`}
                                    onClick={() => handleToggleNormalizer(rule.rule_id, norm.type)}
                                    title={norm.desc}
                                  >
                                    {isActive && <Check size={11} strokeWidth={3} />}
                                    <span>{norm.label}</span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Numeric Tolerance Input */}
                        {isTolerance && (
                          <div className="v2-tolerance-group">
                            <DollarSign size={16} style={{ color: "#059669" }} />
                            <span style={{ fontSize: 12, color: "#475569", fontWeight: 600 }}>
                              Commercial Amount Variance Allowance:
                            </span>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <span style={{ fontWeight: 700, color: "#0f172a" }}>± ₹</span>
                              <input
                                type="number"
                                step="0.01"
                                className="v2-tolerance-input"
                                value={rule.tolerance_value}
                                onChange={(e) =>
                                  handleToleranceChange(
                                    rule.rule_id,
                                    parseFloat(e.target.value) || 0
                                  )
                                }
                              />
                              <span style={{ fontSize: 11, color: "#64748b" }}>
                                (e.g. ₹10.00 to absorb rounding and fractional freight)
                              </span>
                            </div>
                          </div>
                        )}

                        {/* Date Proximity Input */}
                        {isDate && (
                          <div className="v2-tolerance-group">
                            <Calendar size={16} style={{ color: "#2563eb" }} />
                            <span style={{ fontSize: 12, color: "#475569", fontWeight: 600 }}>
                              Invoice Date Lag Allowance:
                            </span>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <span style={{ fontWeight: 700, color: "#0f172a" }}>±</span>
                              <input
                                type="number"
                                className="v2-tolerance-input"
                                value={rule.date_tolerance_days}
                                onChange={(e) =>
                                  handleDateToleranceChange(
                                    rule.rule_id,
                                    parseInt(e.target.value, 10) || 0
                                  )
                                }
                              />
                              <span style={{ fontSize: 11, color: "#64748b" }}>
                                days (e.g. 30 days for month-end bill booking lag)
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          ) : null}

          {/* Sample Row Inspector (Evidence Preview from Simulation) */}
          {simulationResult && selectedPass && (
            <div className="v2-sample-inspector-tray">
              <div
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Eye size={16} style={{ color: "#2563eb" }} />
                  <strong style={{ fontSize: 13, color: "#0f172a" }}>
                    Sample Rows Matched by {selectedPass.name}
                  </strong>
                </div>
                <span style={{ fontSize: 11, color: "#64748b" }}>
                  Verified row pairings saved by this tier's normalization stack
                </span>
              </div>

              {(() => {
                const currentYield = getPassYield(selectedPass.pass_id);
                if (!currentYield || currentYield.sample_matches.length === 0) {
                  return (
                    <div style={{ padding: 20, textAlign: "center", color: "#64748b", fontSize: 12 }}>
                      No sample matches recorded for this tier in the current simulation slice.
                    </div>
                  );
                }

                return (
                  <table className="v2-sample-table">
                    <thead>
                      <tr>
                        <th>Gov Row #</th>
                        <th>Gov Record Data</th>
                        <th>PR Row #</th>
                        <th>PR Record Data</th>
                        <th>Applied Normalizations</th>
                      </tr>
                    </thead>
                    <tbody>
                      {currentYield.sample_matches.map((s, idx) => (
                        <tr key={idx}>
                          <td style={{ fontFamily: "JetBrains Mono, monospace" }}>
                            #{s.gstr_row_index + 1}
                          </td>
                          <td>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                              {Object.entries(s.gstr_preview)
                                .slice(0, 4)
                                .map(([k, v]) => (
                                  <span
                                    key={k}
                                    style={{
                                      fontSize: 11,
                                      background: "#f1f5f9",
                                      padding: "1px 5px",
                                      borderRadius: 4,
                                    }}
                                  >
                                    <strong>{k}:</strong> {v}
                                  </span>
                                ))}
                            </div>
                          </td>
                          <td style={{ fontFamily: "JetBrains Mono, monospace" }}>
                            #{s.pr_row_index + 1}
                          </td>
                          <td>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                              {Object.entries(s.pr_preview)
                                .slice(0, 4)
                                .map(([k, v]) => (
                                  <span
                                    key={k}
                                    style={{
                                      fontSize: 11,
                                      background: "#fdf2f8",
                                      padding: "1px 5px",
                                      borderRadius: 4,
                                    }}
                                  >
                                    <strong>{k}:</strong> {v}
                                  </span>
                                ))}
                            </div>
                          </td>
                          <td>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                              {Object.entries(s.normalized_values).map(([k, v]) => (
                                <span key={k} className="v2-tag-pass">
                                  {k}: {v}
                                </span>
                              ))}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                );
              })()}
            </div>
          )}
        </main>
      </div>

      {/* 4. Add Rule Modal */}
      {showAddRuleModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.6)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
          }}
        >
          <div
            style={{
              background: "#ffffff",
              borderRadius: 14,
              padding: 24,
              maxWidth: 480,
              width: "100%",
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)",
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: "#0f172a" }}>
              Add Column Rule to {selectedPass?.name}
            </h3>

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#475569" }}>
                Government Column:
              </label>
              <select
                className="v2-strategy-select"
                value={newRuleGstrCol}
                onChange={(e) => setNewRuleGstrCol(e.target.value)}
              >
                <option value="">-- Select Government Column --</option>
                {correlations.map((c) => (
                  <option key={c.gstr_column} value={c.gstr_column}>
                    {c.gstr_column} {c.canonical_concept ? `(${c.canonical_concept})` : ""}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#475569" }}>
                Purchase Register Column:
              </label>
              <select
                className="v2-strategy-select"
                value={newRulePrCol}
                onChange={(e) => setNewRulePrCol(e.target.value)}
              >
                <option value="">-- Select PR Column --</option>
                {prColumns.map((col) => (
                  <option key={col} value={col}>
                    {col}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#475569" }}>
                Initial Matching Strategy:
              </label>
              <select
                className="v2-strategy-select"
                value={newRuleStrategy}
                onChange={(e) => setNewRuleStrategy(e.target.value as MatchStrategy)}
              >
                <option value="EXACT">Strict Exact Match</option>
                <option value="NORMALIZED_TEXT">Normalized Text (Symbols, Prefixes, Spaces)</option>
                <option value="NUMERIC_TOLERANCE">Numeric Tolerance Window (± ₹)</option>
                <option value="DATE_PROXIMITY">Date Proximity Window (± Days)</option>
              </select>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 10,
                marginTop: 10,
              }}
            >
              <button
                type="button"
                className="v2-browse-button"
                onClick={() => setShowAddRuleModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-ai-sparkle"
                disabled={!newRuleGstrCol || !newRulePrCol}
                onClick={handleAddRuleToPass}
              >
                Add to Pass
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
export default ReconciliationV2RulesStage;
