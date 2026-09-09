import React, { useState, useEffect, useRef } from "react";
import {
  apiV2,
  Rule2Item,
  SimulationResultV2,
  DateToleranceUnit,
  NumericToleranceMode,
  NormalizationType,
} from "./api_v2";
import {
  Sparkles,
  Play,
  HelpCircle,
  ChevronUp,
  ChevronDown,
  Info,
  CheckCircle2,
  AlertTriangle,
  FileText,
  Clock,
  ShieldCheck,
  Percent,
  Sliders,
  X,
  Plus,
  ArrowRight,
  Database,
  GripVertical,
  StopCircle,
  Activity,
} from "lucide-react";
import "./rules_v2.css";

const ALL_NORMALIZERS: { type: NormalizationType; label: string }[] = [
  { type: "TRIM_WHITESPACE", label: "Clean Spaces" },
  { type: "STRIP_SPECIAL_CHARS", label: "Strip Symbols (+, -, /, _)" },
  { type: "REMOVE_PREFIXES", label: "Strip Prefixes (INV, BILL)" },
  { type: "TRIM_LEADING_ZEROS", label: "Trim Leading Zeros (0042 → 42)" },
  { type: "UPPERCASE", label: "Case Fold (A-Z)" },
];

export const RulesWikiV2: React.FC = () => {
  const [rules, setRules] = useState<Rule2Item[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [simulationResult, setSimulationResult] = useState<SimulationResultV2 | null>(null);
  const [simulationAborted, setSimulationAborted] = useState<boolean>(false);

  // Drag and Drop state
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  // Agentic Simulation HUD telemetry state
  const [simStep, setSimStep] = useState<number>(1);
  const [simElapsedMs, setSimElapsedMs] = useState<number>(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Modal states
  const [explainingRule, setExplainingRule] = useState<Rule2Item | null>(null);
  const [showAiModal, setShowAiModal] = useState<boolean>(false);
  const [aiPrompt, setAiPrompt] = useState<string>("");
  const [isAiCompiling, setIsAiCompiling] = useState<boolean>(false);
  const [compiledPreview, setCompiledPreview] = useState<Rule2Item | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  // Load catalog on mount (NO auto-simulation)
  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);
    apiV2
      .getRules2Catalog()
      .then((data) => {
        if (isMounted && data) {
          setRules(data);
        }
      })
      .catch((err) => {
        console.error("Failed to load Rules 2.0 catalog:", err);
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const handleAbortSimulation = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsSimulating(false);
    setSimulationAborted(true);
  };

  const runSimulation = async (rulesToSimulate = rules) => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsSimulating(true);
    setSimulationAborted(false);
    setSimStep(1);
    const startTime = Date.now();

    const stepTimer = setInterval(() => {
      setSimElapsedMs(Date.now() - startTime);
      setSimStep((prev) => (prev < 5 ? prev + 1 : prev));
    }, 350);

    try {
      const res = await apiV2.simulateRulesV2("master-catalog-preview", rulesToSimulate, controller.signal);
      setSimulationResult(res);
    } catch (err: any) {
      if (err.name === "AbortError" || err.message?.includes("aborted")) {
        console.log("Simulation aborted by user.");
        setSimulationAborted(true);
      } else {
        console.error("Simulation failed:", err);
      }
    } finally {
      clearInterval(stepTimer);
      setIsSimulating(false);
      abortControllerRef.current = null;
    }
  };

  // Drag and Drop Handlers
  const handleDragStart = (e: React.DragEvent, index: number) => {
    e.dataTransfer.setData("text/plain", index.toString());
    e.dataTransfer.effectAllowed = "move";
    setDraggedIdx(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverIdx !== index) {
      setDragOverIdx(index);
    }
  };

  const handleDrop = (e: React.DragEvent, dropIdx: number) => {
    e.preventDefault();
    const dragIdxStr = e.dataTransfer.getData("text/plain");
    const dragIdx = parseInt(dragIdxStr, 10);
    if (isNaN(dragIdx) || dragIdx === dropIdx) {
      setDraggedIdx(null);
      setDragOverIdx(null);
      return;
    }

    const newRules = [...rules];
    const [draggedItem] = newRules.splice(dragIdx, 1);
    newRules.splice(dropIdx, 0, draggedItem);

    const reordered = newRules.map((r, i) => ({ ...r, execution_order: i + 1 }));
    setRules(reordered);
    setDraggedIdx(null);
    setDragOverIdx(null);
  };

  const handleDragEnd = () => {
    setDraggedIdx(null);
    setDragOverIdx(null);
  };

  // Rule toggle (NO auto-simulation)
  const handleToggleRule = (id: string) => {
    const updated = rules.map((r) => (r.id === id ? { ...r, is_enabled: !r.is_enabled } : r));
    setRules(updated);
  };

  // Rule reordering (NO auto-simulation)
  const handleMoveRule = (index: number, direction: "up" | "down") => {
    const targetIdx = direction === "up" ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= rules.length) return;

    const newRules = [...rules];
    const temp = newRules[index];
    newRules[index] = newRules[targetIdx];
    newRules[targetIdx] = temp;

    const reordered = newRules.map((r, i) => ({ ...r, execution_order: i + 1 }));
    setRules(reordered);
  };

  // Tolerance updates (NO auto-simulation)
  const handleUpdateNumericTol = (id: string, val: number, mode?: NumericToleranceMode) => {
    const updated = rules.map((r) => {
      if (r.id === id) {
        return {
          ...r,
          tolerance_value: Math.max(0, val),
          ...(mode ? { tolerance_mode: mode } : {}),
        };
      }
      return r;
    });
    setRules(updated);
  };

  const handleUpdateDateTol = (id: string, val: number, unit?: DateToleranceUnit) => {
    const updated = rules.map((r) => {
      if (r.id === id) {
        return {
          ...r,
          date_tolerance_value: Math.max(0, val),
          ...(unit ? { date_tolerance_unit: unit } : {}),
        };
      }
      return r;
    });
    setRules(updated);
  };

  const handleToggleNormalizer = (id: string, norm: NormalizationType) => {
    const updated = rules.map((r) => {
      if (r.id === id) {
        const has = r.normalizers.includes(norm);
        const newNorms = has ? r.normalizers.filter((n) => n !== norm) : [...r.normalizers, norm];
        return { ...r, normalizers: newNorms };
      }
      return r;
    });
    setRules(updated);
  };

  // AI Rule Compilation (NO auto-simulation)
  const handleCompileAi = async () => {
    if (!aiPrompt.trim()) return;
    setIsAiCompiling(true);
    setAiError(null);
    try {
      const res = await apiV2.compileAiRule(aiPrompt.trim());
      setCompiledPreview(res);
    } catch (err: any) {
      setAiError(err.message || "Failed to compile AI rule.");
    } finally {
      setIsAiCompiling(false);
    }
  };

  const handleAddCompiledRule = () => {
    if (!compiledPreview) return;
    const updated = [...rules, { ...compiledPreview, execution_order: rules.length + 1 }];
    setRules(updated);
    setCompiledPreview(null);
    setAiPrompt("");
    setShowAiModal(false);
  };

  return (
    <div className="v2-rules-container" style={{ maxWidth: 1240, margin: "0 auto", padding: "24px 16px" }}>
      {/* 1. Header Banner */}
      <header className="v2-rules-header">
        <div className="v2-rules-header__info">
          <span className="v2-rules-eyebrow">
            <ShieldCheck size={13} />
            Enterprise Governance Catalog
          </span>
          <h1 className="v2-rules-title">Rules Wiki 2.0</h1>
          <p className="v2-rules-subtitle">
            Authoritative declarative business rules configured for real-world enterprise GST reconciliation.
            Click any rule to inspect its plain-English explanation, columns evaluated, and regulatory rationale.
          </p>
        </div>

        <div className="v2-rules-header__actions">
          <button
            type="button"
            className="btn-ai-sparkle"
            onClick={() => {
              setAiPrompt("");
              setCompiledPreview(null);
              setAiError(null);
              setShowAiModal(true);
            }}
          >
            <Sparkles size={16} />
            <span>Make Rules with AI</span>
          </button>

          <button
            type="button"
            className="btn-sim-run"
            disabled={isSimulating}
            onClick={() => runSimulation()}
          >
            <Play size={15} fill="currentColor" />
            <span>{isSimulating ? "Simulating..." : "Simulate Dataset"}</span>
          </button>
        </div>
      </header>

      {/* Agentic Simulation Deep Dive Console HUD */}
      {isSimulating && (
        <div className="v2-agentic-loading-screen" style={{ margin: "16px 0" }}>
          <div className="v2-agentic-loading-hud">
            <div className="v2-hud-top-ribbon">
              <div className="v2-hud-brand">
                <Sparkles size={14} />
                <span>AGENTIC MATCHING ENGINE DEEP DIVE TELEMETRY</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span className="v2-hud-timer-badge">
                  <Activity size={12} className="spin" />
                  {simElapsedMs} ms
                </span>
                <button
                  type="button"
                  className="btn-abort-sim"
                  onClick={handleAbortSimulation}
                  title="Click to cancel active simulation run immediately"
                >
                  <StopCircle size={14} />
                  <span>Abort Simulation</span>
                </button>
              </div>
            </div>

            <div className="v2-hud-heading">
              <h3>Simulating Catalog Rules Across Benchmark Dataset...</h3>
              <p>Real-time execution telemetry of deterministic matching passes, normalizations, and commercial tolerances.</p>
            </div>

            <div className="v2-hud-steps">
              <div className={`v2-hud-step-card ${simStep === 1 ? "active" : simStep > 1 ? "completed" : ""}`}>
                <div className="v2-hud-step-left">
                  <span className="v2-hud-step-num">01</span>
                  <div>
                    <div className="v2-hud-step-title">Ingesting Benchmark Datasets</div>
                    <div className="v2-hud-step-desc">Loading Tax Authority Ledger (GSTR-2B) and Client ERP Purchase Register</div>
                  </div>
                </div>
                <span className={`v2-hud-step-badge ${simStep > 1 ? "completed" : "running"}`}>
                  {simStep > 1 ? "COMPLETED" : "RUNNING..."}
                </span>
              </div>

              <div className={`v2-hud-step-card ${simStep === 2 ? "active" : simStep > 2 ? "completed" : ""}`}>
                <div className="v2-hud-step-left">
                  <span className="v2-hud-step-num">02</span>
                  <div>
                    <div className="v2-hud-step-title">Applying Column Normalizers</div>
                    <div className="v2-hud-step-desc">Cleaning whitespace, stripping special symbols, trimming leading zeros, case folding</div>
                  </div>
                </div>
                <span className={`v2-hud-step-badge ${simStep > 2 ? "completed" : simStep === 2 ? "running" : ""}`}>
                  {simStep > 2 ? "COMPLETED" : simStep === 2 ? "RUNNING..." : "WAITING"}
                </span>
              </div>

              <div className={`v2-hud-step-card ${simStep === 3 ? "active" : simStep > 3 ? "completed" : ""}`}>
                <div className="v2-hud-step-left">
                  <span className="v2-hud-step-num">03</span>
                  <div>
                    <div className="v2-hud-step-title">Executing Sequential Waterfall Pipeline</div>
                    <div className="v2-hud-step-desc">Evaluating {rules.filter((r) => r.is_enabled).length} active rules in drag sequence</div>
                  </div>
                </div>
                <span className={`v2-hud-step-badge ${simStep > 3 ? "completed" : simStep === 3 ? "running" : ""}`}>
                  {simStep > 3 ? "COMPLETED" : simStep === 3 ? "RUNNING..." : "WAITING"}
                </span>
              </div>

              <div className={`v2-hud-step-card ${simStep === 4 ? "active" : simStep > 4 ? "completed" : ""}`}>
                <div className="v2-hud-step-left">
                  <span className="v2-hud-step-num">04</span>
                  <div>
                    <div className="v2-hud-step-title">Evaluating Commercial Tolerances</div>
                    <div className="v2-hud-step-desc">Computing date lag windows and percentage/INR amount variance boundaries</div>
                  </div>
                </div>
                <span className={`v2-hud-step-badge ${simStep > 4 ? "completed" : simStep === 4 ? "running" : ""}`}>
                  {simStep > 4 ? "COMPLETED" : simStep === 4 ? "RUNNING..." : "WAITING"}
                </span>
              </div>

              <div className={`v2-hud-step-card ${simStep === 5 ? "active" : simStep > 5 ? "completed" : ""}`}>
                <div className="v2-hud-step-left">
                  <span className="v2-hud-step-num">05</span>
                  <div>
                    <div className="v2-hud-step-title">Synthesizing Match Telemetry & Breakdown</div>
                    <div className="v2-hud-step-desc">Aggregating simultaneous match rates and rule satisfaction percentages</div>
                  </div>
                </div>
                <span className={`v2-hud-step-badge ${simStep === 5 ? "running" : ""}`}>
                  {simStep === 5 ? "FINALIZING..." : "WAITING"}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Aborted Banner */}
      {simulationAborted && (
        <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 12, padding: "12px 18px", color: "#991b1b", display: "flex", alignItems: "center", gap: 10, fontSize: 13, fontWeight: 600 }}>
          <AlertTriangle size={18} />
          <span>Simulation run was aborted by user. Click "Simulate Dataset" to run a new simulation when ready.</span>
        </div>
      )}

      {/* 2. Simulation HUD — Deep Navy Blue Card */}
      {simulationResult && !isSimulating && (
        <section className="v2-simulation-hud-card">
          <div className="v2-sim-hud-top">
            <span className="v2-sim-badge">
              <Sparkles size={12} />
              LIVE ENGINE SIMULATION TELEMETRY
            </span>
            <span style={{ fontSize: 12, color: "#94a3b8" }}>
              Deterministic Financial Evidence · Instant Re-Evaluation Across Checked Rules
            </span>
          </div>

          <div className="v2-kpi-grid">
            <div className="v2-kpi-box">
              <span className="v2-kpi-label">Government (GSTR-2B)</span>
              <span className="v2-kpi-num">{simulationResult.total_gstr_rows.toLocaleString()}</span>
              <small style={{ fontSize: 11, color: "#64748b" }}>Tax Authority Ledger</small>
            </div>
            <div className="v2-kpi-box">
              <span className="v2-kpi-label">Purchase Register</span>
              <span className="v2-kpi-num">{simulationResult.total_pr_rows.toLocaleString()}</span>
              <small style={{ fontSize: 11, color: "#64748b" }}>Client Accounting ERP</small>
            </div>
            <div className="v2-kpi-box">
              <span className="v2-kpi-label">Simultaneous Matches</span>
              <span className="v2-kpi-num green">{simulationResult.total_matched.toLocaleString()}</span>
              <small style={{ fontSize: 11, color: "#34d399" }}>Across all active rules concurrently</small>
            </div>
            <div className="v2-kpi-box">
              <span className="v2-kpi-label">Overall Match Rate</span>
              <span className="v2-kpi-num green">{simulationResult.overall_match_rate}%</span>
              <small style={{ fontSize: 11, color: "#34d399" }}>
                {simulationResult.total_unmatched_gstr.toLocaleString()} Gov rows remaining
              </small>
            </div>
          </div>

          {/* Multi-Color Stacked Progress Bar */}
          <div className="v2-waterfall-bar-wrap">
            <div className="v2-stacked-bar">
              {simulationResult.rule_breakdowns.map((bd, i) => {
                const colors = ["#3b82f6", "#10b981", "#8b5cf6", "#f59e0b", "#ec4899", "#06b6d4", "#14b8a6"];
                const color = colors[i % colors.length];
                const widthPct = simulationResult.total_gstr_rows > 0
                  ? (bd.individual_satisfied_count / simulationResult.total_gstr_rows) * 100 / simulationResult.rule_breakdowns.length
                  : 0;
                return (
                  <div
                    key={bd.rule_id}
                    style={{
                      width: `${Math.min(100, Math.max(8, widthPct))}%`,
                      background: color,
                      height: "100%",
                      transition: "width 0.3s ease",
                    }}
                    title={`${bd.rule_name}: ${bd.individual_satisfied_count.toLocaleString()} rows (${bd.individual_satisfied_percentage}%)`}
                  />
                );
              })}
              {simulationResult.total_unmatched_gstr > 0 && (
                <div
                  className="v2-bar-unmatched"
                  style={{
                    width: `${Math.max(2, (simulationResult.total_unmatched_gstr / simulationResult.total_gstr_rows) * 100)}%`,
                    height: "100%",
                  }}
                  title={`Unmatched: ${simulationResult.total_unmatched_gstr.toLocaleString()} rows`}
                />
              )}
            </div>

            <div className="v2-bar-legend">
              {simulationResult.rule_breakdowns.map((bd, i) => {
                const colors = ["#3b82f6", "#10b981", "#8b5cf6", "#f59e0b", "#ec4899", "#06b6d4", "#14b8a6"];
                const color = colors[i % colors.length];
                return (
                  <div key={bd.rule_id} className="v2-legend-item">
                    <span className="v2-legend-dot" style={{ background: color }} />
                    <span>
                      {bd.rule_name.split("(")[0].trim()}: <strong>{bd.individual_satisfied_count.toLocaleString()}</strong> ({bd.individual_satisfied_percentage}%)
                    </span>
                  </div>
                );
              })}
              <div className="v2-legend-item">
                <span className="v2-legend-dot" style={{ background: "rgba(255,255,255,0.25)" }} />
                <span>Unmatched: {simulationResult.total_unmatched_gstr.toLocaleString()}</span>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* 3. Rules Catalog List */}
      <section style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: "#0f172a", margin: 0 }}>
            Active Rules Catalog ({rules.filter((r) => r.is_enabled).length} of {rules.length} enabled)
          </h2>
          <span style={{ fontSize: 12, color: "#64748b" }}>
            Drag handle <GripVertical size={13} style={{ display: "inline", verticalAlign: "middle" }} /> or use arrows to reorder execution sequence.
          </span>
        </div>

        {rules.map((rule, idx) => {
          const isDate = rule.strategy === "DATE_PROXIMITY";
          const isNumeric = rule.strategy === "NUMERIC_TOLERANCE";
          const isNormalized = rule.strategy === "NORMALIZED_TEXT" || rule.strategy === "EXACT";
          const stat = simulationResult?.rule_breakdowns.find((b) => b.rule_id === rule.id);

          return (
            <div
              key={rule.id}
              draggable
              onDragStart={(e) => handleDragStart(e, idx)}
              onDragOver={(e) => handleDragOver(e, idx)}
              onDrop={(e) => handleDrop(e, idx)}
              onDragEnd={handleDragEnd}
              className={`v2-rule-item-card ${!rule.is_enabled ? "disabled" : ""} ${draggedIdx === idx ? "dragging" : ""}`}
              style={{
                background: rule.is_enabled ? "#ffffff" : "#f8fafc",
                borderColor: dragOverIdx === idx ? "#2563eb" : rule.is_enabled ? "#cbd5e1" : "#e2e8f0",
                opacity: draggedIdx === idx ? 0.4 : rule.is_enabled ? 1 : 0.75,
                transition: "all 0.15s ease",
              }}
            >
              {/* Top Row: Drag Handle, Checkbox, Order, Title, Individual Metric Badge, Explain Button */}
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14 }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  {/* Drag Handle */}
                  <div className="v2-drag-grip" title="Drag to reorder rule execution sequence">
                    <GripVertical size={18} />
                  </div>

                  <input
                    type="checkbox"
                    checked={rule.is_enabled}
                    onChange={() => handleToggleRule(rule.id)}
                    style={{ width: 18, height: 18, cursor: "pointer", marginTop: 3 }}
                    title={rule.is_enabled ? "Click to disable rule" : "Click to enable rule"}
                  />

                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                      <span className="v2-wf-tier-tag">Priority #{idx + 1}</span>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          textTransform: "uppercase",
                          color: "#475569",
                          background: "#f1f5f9",
                          padding: "2px 8px",
                          borderRadius: 4,
                        }}
                      >
                        {rule.category.replaceAll("_", " ")}
                      </span>
                      <h3 style={{ fontSize: 15, fontWeight: 700, color: "#0f172a", margin: 0 }}>
                        {rule.name}
                      </h3>
                    </div>
                    <p style={{ fontSize: 13, color: "#475569", margin: 0, lineHeight: 1.4 }}>
                      {rule.description}
                    </p>
                  </div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <button
                      type="button"
                      className="v2-rule-card-order-btn"
                      disabled={idx === 0}
                      onClick={() => handleMoveRule(idx, "up")}
                      title="Move up in execution priority"
                    >
                      <ChevronUp size={16} />
                    </button>
                    <button
                      type="button"
                      className="v2-rule-card-order-btn"
                      disabled={idx === rules.length - 1}
                      onClick={() => handleMoveRule(idx, "down")}
                      title="Move down in execution priority"
                    >
                      <ChevronDown size={16} />
                    </button>

                    <button
                      type="button"
                      onClick={() => setExplainingRule(rule)}
                      className="v2-browse-button"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "6px 12px",
                        fontSize: 12,
                        fontWeight: 600,
                        color: "#1d4ed8",
                        background: "#eff6ff",
                        border: "1px solid #bfdbfe",
                        borderRadius: 8,
                        cursor: "pointer",
                        marginLeft: 8,
                      }}
                      title="Click to view plain-English explanation, target columns & accounting rationale"
                    >
                      <Info size={14} />
                      <span>Explain Rule</span>
                    </button>
                  </div>

                  {/* Display actual match count & percentage below Explain Rule button AFTER simulation */}
                  {simulationResult && rule.is_enabled && stat && (
                    <div
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "4px 10px",
                        fontSize: 12,
                        fontWeight: 600,
                        color: "#047857",
                        background: "#ecfdf5",
                        border: "1px solid #a7f3d0",
                        borderRadius: 8,
                      }}
                      title="Actual 1-to-1 matches and percentage for this rule"
                    >
                      <CheckCircle2 size={13} color="#10b981" />
                      <span>
                        <strong>{stat.individual_satisfied_count.toLocaleString()} matches</strong> ({stat.individual_satisfied_percentage}%)
                      </span>
                    </div>
                  )}
                  {simulationResult && !rule.is_enabled && (
                    <div
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "4px 10px",
                        fontSize: 11.5,
                        fontWeight: 500,
                        color: "#64748b",
                        background: "#f1f5f9",
                        border: "1px solid #e2e8f0",
                        borderRadius: 8,
                      }}
                    >
                      <span>Excluded from simulation run</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Middle Row: Column Binding Pill */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
                <span className="v2-source-pill">
                  Government: <strong>{rule.gstr_column}</strong>
                </span>
                <span style={{ color: "#94a3b8", fontWeight: 700 }}>⟷</span>
                <span className="v2-source-pill pr">
                  Purchase Register: <strong>{rule.pr_column}</strong>
                </span>
                {rule.canonical_concept && (
                  <span style={{ fontSize: 11, color: "#64748b", fontFamily: "monospace" }}>
                    ({rule.canonical_concept})
                  </span>
                )}
              </div>

              {/* Bottom Row: Dynamic Inline Option Controls */}
              <div style={{ marginTop: 14 }}>
                {/* 1. Date Tolerance Control */}
                {isDate && (
                  <div className="v2-tolerance-row">
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: "#334155" }}>
                      Allowed Date Lag:
                    </span>
                    <input
                      type="number"
                      min={0}
                      className="v2-input-number"
                      value={rule.date_tolerance_value}
                      onChange={(e) => handleUpdateDateTol(rule.id, parseInt(e.target.value) || 0)}
                      onBlur={() => runSimulation()}
                    />
                    <select
                      className="v2-select-unit"
                      value={rule.date_tolerance_unit}
                      onChange={(e) => {
                        handleUpdateDateTol(rule.id, rule.date_tolerance_value, e.target.value as DateToleranceUnit);
                        runSimulation();
                      }}
                    >
                      <option value="DAYS">Days</option>
                      <option value="MONTHS">Months</option>
                      <option value="YEARS">Years</option>
                    </select>
                    <span style={{ fontSize: 12, color: "#64748b", fontStyle: "italic" }}>
                      (Matches if invoice dates are within ± {rule.date_tolerance_value} {rule.date_tolerance_unit.toLowerCase()})
                    </span>
                  </div>
                )}

                {/* 2. Numeric Tolerance Control */}
                {isNumeric && (
                  <div className="v2-tolerance-row">
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: "#334155" }}>
                      Allowed Variance:
                    </span>
                    <select
                      className="v2-select-mode"
                      value={rule.tolerance_mode}
                      onChange={(e) => {
                        handleUpdateNumericTol(rule.id, rule.tolerance_value, e.target.value as NumericToleranceMode);
                        runSimulation();
                      }}
                    >
                      <option value="ABSOLUTE_INR">₹ Absolute INR</option>
                      <option value="PERCENTAGE">% Percentage</option>
                    </select>
                    <input
                      type="number"
                      step={rule.tolerance_mode === "PERCENTAGE" ? 0.1 : 1}
                      min={0}
                      className="v2-input-number"
                      value={rule.tolerance_value}
                      onChange={(e) => handleUpdateNumericTol(rule.id, parseFloat(e.target.value) || 0)}
                      onBlur={() => runSimulation()}
                    />
                    <span style={{ fontSize: 12, color: "#64748b", fontStyle: "italic" }}>
                      (Matches if amount variance does not exceed{" "}
                      {rule.tolerance_mode === "PERCENTAGE" ? `${rule.tolerance_value}%` : `₹ ${rule.tolerance_value}`})
                    </span>
                  </div>
                )}

                {/* 3. Text Normalization Pills */}
                {isNormalized && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: "#64748b" }}>
                      Active Normalizers:
                    </span>
                    {ALL_NORMALIZERS.map((norm) => {
                      const isActive = rule.normalizers.includes(norm.type);
                      return (
                        <button
                          key={norm.type}
                          type="button"
                          onClick={() => handleToggleNormalizer(rule.id, norm.type)}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 5,
                            padding: "4px 10px",
                            borderRadius: 6,
                            fontSize: 11.5,
                            fontWeight: 600,
                            cursor: "pointer",
                            border: isActive ? "1px solid #3b82f6" : "1px solid #e2e8f0",
                            background: isActive ? "#eff6ff" : "#f8fafc",
                            color: isActive ? "#1e40af" : "#64748b",
                          }}
                        >
                          {isActive && <CheckCircle2 size={12} />}
                          <span>{norm.label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* 4. Value Guard */}
                {rule.strategy === "VALUE_GUARD" && (
                  <div style={{ fontSize: 12.5, color: "#475569", background: "#f8fafc", padding: "8px 12px", borderRadius: 6 }}>
                    Strict Value Equality Guard: Verifies that categorical classification flags match exactly across both workbooks.
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </section>

      {/* --- PLAIN ENGLISH EXPLANATION MODAL --- */}
      {explainingRule && (
        <div className="v2-modal-backdrop" onClick={() => setExplainingRule(null)}>
          <div className="v2-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="v2-modal-header">
              <div>
                <span className="v2-rules-eyebrow" style={{ marginBottom: 6 }}>
                  {explainingRule.category.replaceAll("_", " ")}
                </span>
                <h2 style={{ fontSize: 18, fontWeight: 700, color: "#0f172a", margin: 0 }}>
                  {explainingRule.name}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setExplainingRule(null)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b" }}
              >
                <X size={20} />
              </button>
            </div>

            <div className="v2-modal-body">
              <div className="v2-explain-section">
                <span className="v2-explain-label">Plain-English Rule Explanation</span>
                <div className="v2-explain-box">
                  {explainingRule.plain_english_explanation}
                </div>
              </div>

              <div className="v2-explain-section">
                <span className="v2-explain-label">Columns Evaluated Across Datasets</span>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div style={{ background: "#f1f5f9", padding: "10px 14px", borderRadius: 8 }}>
                    <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>TAX AUTHORITY LEDGER (GSTR-2B)</div>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: "#0f172a", marginTop: 4 }}>
                      {explainingRule.gstr_column}
                    </div>
                  </div>
                  <div style={{ background: "#ecfdf5", padding: "10px 14px", borderRadius: 8 }}>
                    <div style={{ fontSize: 11, color: "#047857", fontWeight: 600 }}>CLIENT ACCOUNTING LEDGER (PR)</div>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: "#065f46", marginTop: 4 }}>
                      {explainingRule.pr_column}
                    </div>
                  </div>
                </div>
              </div>

              <div className="v2-explain-section">
                <span className="v2-explain-label">Accounting & Regulatory Rationale (Why It Matters)</span>
                <div className="v2-explain-box rationale">
                  <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <ShieldCheck size={18} style={{ flexShrink: 0, marginTop: 2 }} />
                    <div>{explainingRule.why_it_matters}</div>
                  </div>
                </div>
              </div>

              <div className="v2-explain-section">
                <span className="v2-explain-label">Active Comparison Parameters</span>
                <div style={{ fontSize: 12.5, color: "#475569", background: "#f8fafc", padding: "10px 14px", borderRadius: 8 }}>
                  {explainingRule.strategy === "DATE_PROXIMITY" && (
                    <span>
                      Window: ± <strong>{explainingRule.date_tolerance_value} {explainingRule.date_tolerance_unit.toLowerCase()}</strong>
                    </span>
                  )}
                  {explainingRule.strategy === "NUMERIC_TOLERANCE" && (
                    <span>
                      Variance: ± <strong>{explainingRule.tolerance_mode === "PERCENTAGE" ? `${explainingRule.tolerance_value}%` : `₹ ${explainingRule.tolerance_value}`}</strong>
                    </span>
                  )}
                  {explainingRule.strategy === "NORMALIZED_TEXT" && (
                    <span>
                      Active Normalizers: <strong>{explainingRule.normalizers.join(", ")}</strong>
                    </span>
                  )}
                  {explainingRule.strategy === "VALUE_GUARD" && (
                    <span>Strict flag identity (forward charge vs reverse charge)</span>
                  )}
                  {explainingRule.strategy === "EXACT" && (
                    <span>100% byte-for-byte exact value match</span>
                  )}
                </div>
              </div>
            </div>

            <div className="v2-modal-footer">
              <button
                type="button"
                className="btn-primary-v2"
                style={{ padding: "8px 18px", fontSize: 13 }}
                onClick={() => setExplainingRule(null)}
              >
                Close Explanation
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- MAKE RULES WITH AI MODAL --- */}
      {showAiModal && (
        <div className="v2-modal-backdrop" onClick={() => setShowAiModal(false)}>
          <div className="v2-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="v2-modal-header">
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Sparkles size={20} color="#2563eb" />
                <h2 style={{ fontSize: 18, fontWeight: 700, color: "#0f172a", margin: 0 }}>
                  Make Rules with AI
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setShowAiModal(false)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b" }}
              >
                <X size={20} />
              </button>
            </div>

            <div className="v2-modal-body">
              <p style={{ fontSize: 13.5, color: "#475569", margin: 0 }}>
                Describe your reconciliation policy in plain English. The agent will compile your instruction into a validated declarative rule.
              </p>

              <div>
                <textarea
                  rows={3}
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder="e.g. Allow invoice date variance of up to 15 days, or allow 1% tolerance on taxable value..."
                  style={{
                    width: "100%",
                    padding: "12px",
                    borderRadius: 8,
                    border: "1px solid #cbd5e1",
                    fontSize: 13.5,
                    fontFamily: "inherit",
                    outline: "none",
                  }}
                />
              </div>

              {/* Prompt Suggestions */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: "#94a3b8", alignSelf: "center" }}>
                  Try:
                </span>
                {[
                  "Invoice date must match exactly in both excels",
                  "Invoice amount should match",
                  "Allow invoice date variance of 15 days",
                  "Allow 2% tolerance on taxable value",
                  "Strict reverse charge mechanism alignment",
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => setAiPrompt(suggestion)}
                    style={{
                      background: "#f1f5f9",
                      border: "1px solid #e2e8f0",
                      borderRadius: 6,
                      padding: "4px 8px",
                      fontSize: 11.5,
                      color: "#334155",
                      cursor: "pointer",
                    }}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>

              {aiError && (
                <div style={{ color: "#ef4444", fontSize: 12.5, background: "#fef2f2", padding: "8px 12px", borderRadius: 6 }}>
                  {aiError}
                </div>
              )}

              {/* Preview of Compiled Rule */}
              {compiledPreview && (
                <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 10, padding: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#166534", fontWeight: 700, fontSize: 13 }}>
                    <CheckCircle2 size={16} />
                    <span>Compiled Declarative Rule: {compiledPreview.name}</span>
                  </div>
                  <p style={{ fontSize: 12.5, color: "#166534", marginTop: 4, marginBottom: 8 }}>
                    {compiledPreview.plain_english_explanation}
                  </p>
                  <div style={{ fontSize: 11.5, color: "#15803d" }}>
                    Columns: <strong>{compiledPreview.gstr_column}</strong> ⟷ <strong>{compiledPreview.pr_column}</strong>
                  </div>
                </div>
              )}
            </div>

            <div className="v2-modal-footer">
              <button
                type="button"
                className="btn-secondary-v2"
                onClick={() => setShowAiModal(false)}
              >
                Cancel
              </button>

              {!compiledPreview ? (
                <button
                  type="button"
                  className="btn-primary-v2"
                  disabled={isAiCompiling || !aiPrompt.trim()}
                  onClick={handleCompileAi}
                >
                  {isAiCompiling ? "Compiling with AI..." : "Compile Rule"}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-primary-v2"
                  onClick={handleAddCompiledRule}
                >
                  Add Rule to Catalog
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
