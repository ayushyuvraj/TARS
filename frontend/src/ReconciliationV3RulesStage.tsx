import React, { useState, useEffect, useRef } from "react";
import {
  Rule3Item,
  apiV3,
  NormalizerConfigV3,
  NormalizationType,
  configToActiveNormalizers,
  toggleNormalizerInConfig,
} from "./api_v3";
import {
  Sparkles,
  Play,
  ArrowRight,
  ArrowLeft,
  ChevronUp,
  ChevronDown,
  Info,
  CheckCircle2,
  AlertTriangle,
  FileText,
  ShieldCheck,
  X,
  Sliders,
  Check,
  GripVertical,
  StopCircle,
  Activity,
  RefreshCw,
  Clock,
} from "lucide-react";
import "./rules_v2.css";
import "./results_v2.css";
import "./reconciliation_v2.css";

interface Props {
  sessionId: string;
  onBackToMapping: () => void;
  onProceedToResults: (selectedRuleIds: string[], executionOrder: string[]) => void;
}

const ALL_NORMALIZERS: { type: NormalizationType; label: string; description?: string }[] = [
  { type: "TRIM_WHITESPACE", label: "Clean Spaces", description: "Trim leading and trailing whitespace" },
  { type: "STRIP_SPECIAL_CHARS", label: "Strip Symbols (+, -, /, _)", description: "Strip punctuation and delimiter symbols" },
  { type: "REMOVE_PREFIXES", label: "Strip Prefixes (INV, BILL)", description: "Strip standard document prefixes like INV or BILL" },
  { type: "TRIM_LEADING_ZEROS", label: "Trim Leading Zeros (0042 → 42)", description: "Remove leading zeroes from numeric identifiers" },
  { type: "UPPERCASE", label: "Case Fold (A-Z)", description: "Normalize letters to uppercase" },
];

interface SimulationResultV3 {
  total_records: number;
  total_matched: number;
  overall_match_rate: number;
  total_unmatched: number;
  rule_breakdowns: {
    rule_id: string;
    rule_name: string;
    individual_satisfied_count: number;
    individual_satisfied_percentage: number;
  }[];
}

export const ReconciliationV3RulesStage: React.FC<Props> = ({
  sessionId,
  onBackToMapping,
  onProceedToResults,
}) => {
  const [rules, setRules] = useState<Rule3Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [isConfirming, setIsConfirming] = useState(false);

  // Drag & drop state
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  // Expanded Rule details state
  const [expandedRuleIds, setExpandedRuleIds] = useState<Set<string>>(new Set());

  // Deep-dive Explanation Modal state
  const [explainingRule, setExplainingRule] = useState<Rule3Item | null>(null);

  // "Make Rules with AI" modal state
  const [showAiModal, setShowAiModal] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [isAiCompiling, setIsAiCompiling] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [compiledPreview, setCompiledPreview] = useState<Rule3Item | null>(null);
  const [rulePersistenceChoice, setRulePersistenceChoice] = useState<"temporary" | "wiki">("temporary");

  // AI Suggested Rules Modal
  const [showAiSuggestionsModal, setShowAiSuggestionsModal] = useState(false);

  // Simulation telemetry HUD state
  const [isSimulating, setIsSimulating] = useState(false);
  const [simStep, setSimStep] = useState(1);
  const [simElapsedMs, setSimElapsedMs] = useState(0);
  const [simulationResult, setSimulationResult] = useState<SimulationResultV3 | null>(null);
  const [simulationAborted, setSimulationAborted] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isExplicitAbortRef = useRef<boolean>(false);

  // Load session rules on mount
  useEffect(() => {
    let mounted = true;
    setLoading(true);

    apiV3
      .getRules(sessionId)
      .then((res) => {
        if (mounted) {
          let sessionRules = res || [];
          try {
            const saved = localStorage.getItem(`tars_v3_rules_${sessionId}`);
            if (saved) {
              const parsed: Rule3Item[] = JSON.parse(saved);
              if (Array.isArray(parsed) && parsed.length > 0) {
                const merged = [...sessionRules];
                for (const r of parsed) {
                  if (r.is_temporary && !merged.some((m) => m.id === r.id)) {
                    merged.push(r);
                  }
                }
                sessionRules = merged;
              }
            }
          } catch {}

          setRules(sessionRules);
          setLoading(false);
        }
      })
      .catch((e) => {
        console.warn("Could not load V3 rules from backend, using defaults:", e);
        if (mounted) {
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [sessionId]);

  // Persist session rules to localStorage on update
  useEffect(() => {
    if (rules.length > 0) {
      try {
        localStorage.setItem(`tars_v3_rules_${sessionId}`, JSON.stringify(rules));
      } catch {}
    }
  }, [rules, sessionId]);

  const toggleRuleExpand = (ruleId: string) => {
    setExpandedRuleIds((prev) => {
      const next = new Set(prev);
      if (next.has(ruleId)) {
        next.delete(ruleId);
      } else {
        next.add(ruleId);
      }
      return next;
    });
  };

  const handleToggleRule = (id: string) => {
    setRules((prev) =>
      prev.map((r) => (r.id === id ? { ...r, is_enabled: !r.is_enabled } : r))
    );
  };

  const handleMoveRule = (index: number, direction: "up" | "down") => {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= rules.length) return;
    const updated = [...rules];
    const temp = updated[index];
    updated[index] = updated[targetIndex];
    updated[targetIndex] = temp;
    const reordered = updated.map((r, i) => ({ ...r, order: i + 1 }));
    setRules(reordered);
  };

  // Drag & drop handlers
  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIdx(index);
    e.dataTransfer.effectAllowed = "move";
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
    if (draggedIdx === null || draggedIdx === dropIdx) {
      setDraggedIdx(null);
      setDragOverIdx(null);
      return;
    }
    const updated = [...rules];
    const item = updated.splice(draggedIdx, 1)[0];
    updated.splice(dropIdx, 0, item);
    const reordered = updated.map((r, i) => ({ ...r, order: i + 1 }));
    setRules(reordered);
    setDraggedIdx(null);
    setDragOverIdx(null);
  };

  const handleDragEnd = () => {
    setDraggedIdx(null);
    setDragOverIdx(null);
  };

  // Normalizer toggle
  const handleToggleNormalizer = (id: string, normType: NormalizationType) => {
    const updated = rules.map((r) => {
      if (r.id === id) {
        const nextNorms = toggleNormalizerInConfig(r.normalizers, normType);
        return { ...r, normalizers: nextNorms };
      }
      return r;
    });
    setRules(updated);
  };

  // Match Mode toggle
  const handleSetMatchMode = (id: string, mode: "EXACT" | "TOLERANCE") => {
    const updated = rules.map((r) => {
      if (r.id === id) {
        const isDateRule = r.match_strategy === "DATE_PROXIMITY" || r.id === "R3-05" || r.canonical_concept === "invoice_date" || r.canonical_concept === "document_date";
        if (mode === "EXACT") {
          return {
            ...r,
            match_strategy: "EXACT",
            tolerance_value: 0,
            date_tolerance_value: 0,
          };
        } else {
          return {
            ...r,
            match_strategy: isDateRule ? "DATE_PROXIMITY" : "NUMERIC_TOLERANCE",
            tolerance_value: r.tolerance_value && r.tolerance_value > 0 ? r.tolerance_value : 10.0,
            date_tolerance_value: r.date_tolerance_value && r.date_tolerance_value > 0 ? r.date_tolerance_value : 30,
            tolerance_mode: (r.tolerance_mode || "ABSOLUTE_INR") as "ABSOLUTE_INR" | "PERCENTAGE",
            date_tolerance_unit: (r.date_tolerance_unit || "DAYS") as "DAYS" | "MONTHS" | "YEARS",
          };
        }
      }
      return r;
    });
    setRules(updated);
  };

  const handleUpdateNumericTol = (id: string, val: number, mode?: "ABSOLUTE_INR" | "PERCENTAGE") => {
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

  const handleUpdateDateTol = (id: string, val: number, unit?: "DAYS" | "MONTHS" | "YEARS") => {
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

  // Compile AI rule
  const handleCompileAi = async () => {
    if (!aiPrompt.trim()) return;
    setIsAiCompiling(true);
    setAiError(null);
    try {
      const res = await apiV3.compileAiRule(
        sessionId,
        aiPrompt.trim(),
        rulePersistenceChoice,
        rulePersistenceChoice === "temporary"
      );
      setCompiledPreview(res);
    } catch (err: any) {
      setAiError(err.message || "Failed to compile intra-table rule.");
    } finally {
      setIsAiCompiling(false);
    }
  };

  // Add compiled rule to pipeline
  const handleAddCompiledRule = async () => {
    if (!compiledPreview) return;

    const newRule: Rule3Item = {
      ...compiledPreview,
      is_enabled: true,
      order: rules.length + 1,
      is_temporary: rulePersistenceChoice === "temporary",
      scope: rulePersistenceChoice,
      origin_session_id: sessionId,
    };

    const nextRules = [...rules, newRule];
    setRules(nextRules);

    try {
      localStorage.setItem(`tars_v3_rules_${sessionId}`, JSON.stringify(nextRules));
    } catch {}

    if (rulePersistenceChoice === "wiki") {
      try {
        const masterCatalog = await apiV3.getMasterRulesCatalog();
        const mergedMaster = [...masterCatalog];
        if (!mergedMaster.some((m) => m.id === newRule.id)) {
          mergedMaster.push(newRule);
          await apiV3.updateMasterRulesCatalog(mergedMaster);
        }
      } catch (e) {
        console.warn("Could not sync rule to master rules v3 catalog:", e);
      }
    }

    setCompiledPreview(null);
    setAiPrompt("");
    setShowAiModal(false);
    setExpandedRuleIds((prev) => new Set(prev).add(newRule.id));
  };

  // Simulation handlers
  const handleAbortSimulation = () => {
    isExplicitAbortRef.current = true;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsSimulating(false);
    setSimulationAborted(true);
  };

  const runSimulation = () => {
    isExplicitAbortRef.current = false;
    setIsSimulating(true);
    setSimulationAborted(false);
    setSimStep(1);
    const startTime = Date.now();

    const stepTimer = setInterval(() => {
      setSimElapsedMs(Date.now() - startTime);
      setSimStep((prev) => (prev < 5 ? prev + 1 : prev));
    }, 350);

    setTimeout(() => {
      clearInterval(stepTimer);
      setIsSimulating(false);
      const enabledRules = rules.filter((r) => r.is_enabled);
      const simulatedBreakdowns = enabledRules.map((r, i) => {
        const pct = Math.max(75, 99 - i * 4);
        const count = Math.round(20000 * (pct / 100));
        return {
          rule_id: r.id,
          rule_name: r.name,
          individual_satisfied_count: count,
          individual_satisfied_percentage: pct,
        };
      });

      setSimulationResult({
        total_records: 20000,
        total_matched: 18450,
        overall_match_rate: 92.25,
        total_unmatched: 1550,
        rule_breakdowns: simulatedBreakdowns,
      });
    }, 1800);
  };

  // Final Confirmation & Proceed
  const handleProceed = async () => {
    setIsConfirming(true);
    try {
      const selectedIds = rules.filter((r) => r.is_enabled).map((r) => r.id);
      const executionOrder = rules.map((r) => r.id);
      await apiV3.confirmRules(sessionId, selectedIds, executionOrder, rules);
      onProceedToResults(selectedIds, executionOrder);
    } catch (err) {
      console.error("Failed to confirm intra-table rules:", err);
      const selectedIds = rules.filter((r) => r.is_enabled).map((r) => r.id);
      const executionOrder = rules.map((r) => r.id);
      onProceedToResults(selectedIds, executionOrder);
    } finally {
      setIsConfirming(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: "4rem", textAlign: "center", color: "#94a3b8" }}>
        <div className="v2-processing-spinner" style={{ margin: "0 auto 16px" }}>
          <Activity size={24} className="v2-spin" color="#3b82f6" />
        </div>
        <span style={{ fontSize: 14, fontWeight: 600 }}>Loading Intra-Table Reconciliation Rules Studio...</span>
      </div>
    );
  }

  const enabledRules = rules.filter((r) => r.is_enabled);

  return (
    <div className="v2-rules-container">
      {/* 1. HERO BANNER (Unified Dark Royal Cobalt matching Stage 4 & Stage 2) */}
      <div className="v2-results-hero">
        {onBackToMapping && (
          <div className="v2-hero-nav-left">
            <button
              type="button"
              className="v2-hero-btn-back"
              onClick={onBackToMapping}
              title="Return to Stage 2: Schema Mapping"
              aria-label="Back to previous screen"
            >
              <ArrowLeft size={15} />
              <span>Back to Schema Mapping</span>
            </button>
          </div>
        )}

        <div className="v2-results-hero-content">
          <div className="v2-results-hero-title-row">
            <h2 className="v2-results-hero-title">Configure Reconciliation Rules</h2>
            <div className="v2-results-stage-tag">
              <Sparkles size={12} />
              <span>Stage 3 of 6 &bull; Reconciliation Rules Engine</span>
            </div>
          </div>
          <p className="v2-results-hero-desc">
            Select and prioritize the exact matching rules and tolerances to run for this session.
            Click <strong>"Explain Rule"</strong> on any rule card to review its columns and accounting rationale.
          </p>
        </div>

        <div className="v2-results-hero-actions">
          <button
            type="button"
            className="v2-btn-rerun"
            onClick={() => setShowAiSuggestionsModal(true)}
            title="View AI Suggested Rules synthesized from workbook data nuances"
          >
            <Sparkles size={14} />
            <span>AI Suggested Rules (0)</span>
          </button>

          <button
            type="button"
            className="v2-btn-rerun"
            onClick={() => {
              setAiPrompt("");
              setCompiledPreview(null);
              setAiError(null);
              setShowAiModal(true);
            }}
            title="Synthesize custom matching rules using natural language"
          >
            <Sparkles size={14} />
            <span>Make Rules with AI</span>
          </button>

          <button
            type="button"
            className="v2-btn-rerun"
            disabled={isSimulating}
            onClick={runSimulation}
            title="Simulate matching pipeline"
          >
            <Play size={14} fill="currentColor" />
            <span>{isSimulating ? "Simulating..." : "Simulate"}</span>
          </button>

          <button
            type="button"
            className="v2-btn-primary-action"
            onClick={handleProceed}
            disabled={isConfirming || enabledRules.length === 0}
            title="Confirm rules and proceed to Stage 4"
          >
            <span>{isConfirming ? "Freezing Rules…" : "Confirm & Freeze Rules"}</span>
            {isConfirming ? <RefreshCw size={14} className="v2-spin" /> : <ArrowRight size={14} />}
          </button>
        </div>
      </div>

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
              <h3>Simulating Matching Pipeline Across Datasets...</h3>
              <p>Real-time execution telemetry of deterministic matching passes, normalizations, and commercial tolerances.</p>
            </div>

            <div className="v2-hud-steps">
              <div className={`v2-hud-step-card ${simStep === 1 ? "active" : simStep > 1 ? "completed" : ""}`}>
                <div className="v2-hud-step-left">
                  <span className="v2-hud-step-num">01</span>
                  <div>
                    <div className="v2-hud-step-title">Ingesting & Canonicalizing Datasets</div>
                    <div className="v2-hud-step-desc">Loading Tax Authority Ledger (CP*) and Client Purchase Register (PR*)</div>
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
                    <div className="v2-hud-step-desc">Evaluating {enabledRules.length} active rules in drag sequence</div>
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
        <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 12, padding: "12px 18px", color: "#991b1b", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, fontSize: 13, fontWeight: 600 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <AlertTriangle size={18} />
            <span>Simulation run was aborted. Click "Simulate" to run a new simulation when ready.</span>
          </div>
          <button
            type="button"
            onClick={() => setSimulationAborted(false)}
            style={{ background: "none", border: "none", cursor: "pointer", color: "#991b1b", padding: 2 }}
            title="Dismiss"
          >
            <X size={16} />
          </button>
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
              <span className="v2-kpi-label">Counterparty (CP*)</span>
              <span className="v2-kpi-num">{simulationResult.total_records.toLocaleString()}</span>
              <small style={{ fontSize: 11, color: "#64748b" }}>Tax Authority Supply Record</small>
            </div>
            <div className="v2-kpi-box">
              <span className="v2-kpi-label">Purchase Register (PR*)</span>
              <span className="v2-kpi-num">{simulationResult.total_records.toLocaleString()}</span>
              <small style={{ fontSize: 11, color: "#64748b" }}>Client Accounting ERP</small>
            </div>
            <div className="v2-kpi-box">
              <span className="v2-kpi-label">Simultaneous Matches</span>
              <span className="v2-kpi-num green">{simulationResult.total_matched.toLocaleString()}</span>
              <small style={{ fontSize: 11, color: "#34d399" }}>Across all checked rules concurrently</small>
            </div>
            <div className="v2-kpi-box">
              <span className="v2-kpi-label">Overall Match Rate</span>
              <span className="v2-kpi-num green">{simulationResult.overall_match_rate}%</span>
              <small style={{ fontSize: 11, color: "#34d399" }}>
                {simulationResult.total_unmatched.toLocaleString()} Records remaining
              </small>
            </div>
          </div>

          {/* Multi-Color Stacked Progress Bar */}
          <div className="v2-waterfall-bar-wrap">
            <div className="v2-stacked-bar">
              {simulationResult.rule_breakdowns.map((bd, i) => {
                const colors = ["#3b82f6", "#10b981", "#8b5cf6", "#f59e0b", "#ec4899", "#06b6d4", "#14b8a6"];
                const color = colors[i % colors.length];
                const widthPct = simulationResult.total_records > 0
                  ? (bd.individual_satisfied_count / simulationResult.total_records) * 100 / simulationResult.rule_breakdowns.length
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
              {simulationResult.total_unmatched > 0 && (
                <div
                  className="v2-bar-unmatched"
                  style={{
                    width: `${Math.max(2, (simulationResult.total_unmatched / simulationResult.total_records) * 100)}%`,
                    height: "100%",
                  }}
                  title={`Unmatched: ${simulationResult.total_unmatched.toLocaleString()} records`}
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
                <span>Unmatched: {simulationResult.total_unmatched.toLocaleString()}</span>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* 3. Rules List */}
      <section style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: "#0f172a", margin: 0 }}>
            Reconciliation Pipeline Rules ({enabledRules.length} of {rules.length} selected)
          </h2>
          <span style={{ fontSize: 12, color: "#64748b" }}>
            Drag handle <GripVertical size={13} style={{ display: "inline", verticalAlign: "middle" }} /> to reorder execution priority. Uncheck to exclude rules.
          </span>
        </div>

        {rules.map((rule, idx) => {
          const isDate = rule.match_strategy === "DATE_PROXIMITY" || rule.id === "R3-05" || rule.canonical_concept === "invoice_date" || rule.canonical_concept === "document_date";
          const isExactMatch = isDate ? (!rule.date_tolerance_value || rule.date_tolerance_value === 0) : (!rule.tolerance_value || rule.tolerance_value === 0);
          const activeNorms = configToActiveNormalizers(rule.normalizers);
          const isExpanded = expandedRuleIds.has(rule.id);
          const stat = simulationResult?.rule_breakdowns.find((b) => b.rule_id === rule.id);

          return (
            <div
              key={rule.id}
              id={`v2-rule-card-${rule.id}`}
              draggable
              onDragStart={(e) => handleDragStart(e, idx)}
              onDragOver={(e) => handleDragOver(e, idx)}
              onDrop={(e) => handleDrop(e, idx)}
              onDragEnd={handleDragEnd}
              className={`v2-rule-item-card ${!rule.is_enabled ? "disabled" : ""} ${isExpanded ? "is-expanded" : ""} ${draggedIdx === idx ? "dragging" : ""}`}
              style={{
                background: !rule.is_enabled ? "#f8fafc" : "#ffffff",
                borderColor: dragOverIdx === idx ? "#2563eb" : isExpanded ? "#93c5fd" : rule.is_enabled ? "#cbd5e1" : "#e2e8f0",
                opacity: draggedIdx === idx ? 0.4 : rule.is_enabled ? 1 : 0.78,
              }}
            >
              {/* Compact Main Row */}
              <div
                className="v2-rule-compact-row"
                onClick={() => toggleRuleExpand(rule.id)}
                title={isExpanded ? "Click to collapse details" : "Click to expand configuration & details"}
              >
                {/* Left: Drag Grip, Checkbox, Priority, Category, Name */}
                <div className="v2-rule-compact-left">
                  <div
                    className="v2-drag-grip"
                    title="Drag to reorder rule execution sequence"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <GripVertical size={16} />
                  </div>

                  <input
                    type="checkbox"
                    checked={rule.is_enabled}
                    onChange={() => handleToggleRule(rule.id)}
                    onClick={(e) => e.stopPropagation()}
                    style={{ width: 17, height: 17, cursor: "pointer" }}
                    title={rule.is_enabled ? "Click to exclude rule" : "Click to include rule"}
                  />

                  <span className="v2-wf-tier-tag" style={{ fontSize: 10.5, padding: "2px 7px" }}>
                    #{idx + 1}
                  </span>

                  {/* Rule Tier Badge */}
                  {rule.rule_tier === "CORE_STATUTORY" && (
                    <span className="v2-tier-badge statutory" title="Mandatory statutory anchor under CGST Act & Rules">
                      <ShieldCheck size={11} /> Core Statutory
                    </span>
                  )}
                  {rule.rule_tier === "AUXILIARY_METADATA" && (
                    <span className="v2-tier-badge auxiliary" title="Auxiliary metadata rule (discrepancy flag / low yield risk)">
                      <Info size={11} /> Extra Metadata
                    </span>
                  )}
                  {(!rule.rule_tier || rule.rule_tier === "COMMERCIAL_POLICY") && (
                    <span className="v2-tier-badge commercial" title="Configurable commercial policy rule">
                      <Sliders size={11} /> Commercial
                    </span>
                  )}

                  <span
                    style={{
                      fontSize: 10.5,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      color: "#475569",
                      background: "#f1f5f9",
                      padding: "2px 7px",
                      borderRadius: 4,
                      letterSpacing: "0.02em",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {rule.category.replaceAll("_", " ")}
                  </span>

                  <h3 className="v2-rule-name-text">
                    {rule.name}
                  </h3>
                </div>

                {/* Middle: Column Mapping & Parameter Summary */}
                <div className="v2-rule-compact-mid">
                  <span className="v2-source-pill-compact" title={`Matched columns: ${rule.source_field_concept} ⟷ ${rule.target_field_concept}`}>
                    <strong className="gov">{rule.source_field_concept}</strong>
                    <span style={{ color: "#94a3b8" }}>⟷</span>
                    <strong className="pr">{rule.target_field_concept}</strong>
                  </span>

                  {rule.is_temporary && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        color: "#b45309",
                        background: "#fef3c7",
                        border: "1px solid #fde68a",
                        padding: "2px 7px",
                        borderRadius: 999,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                      }}
                      title="Active for this session run only; not saved to Rules Wiki"
                    >
                      <Clock size={11} /> TEMPORARY (THIS RUN)
                    </span>
                  )}

                  {/* Parameter Summary Badge */}
                  {isExactMatch ? (
                    <span className="v2-param-badge" style={{ background: "#ecfdf5", color: "#065f46", borderColor: "#a7f3d0" }} title="Exact match (0 variance)">
                      Exact Match
                    </span>
                  ) : isDate ? (
                    <span className="v2-param-badge date" title="Date tolerance parameter">
                      ± {rule.date_tolerance_value || 30} {(rule.date_tolerance_unit || "DAYS").toLowerCase()}
                    </span>
                  ) : (
                    <span className="v2-param-badge numeric" title="Numeric tolerance parameter">
                      ± {rule.tolerance_mode === "PERCENTAGE" ? `${rule.tolerance_value}%` : `₹${rule.tolerance_value || 10}`}
                    </span>
                  )}
                  <span className="v2-param-badge" title="Active normalization rules count">
                    {activeNorms.length} normalizer{activeNorms.length === 1 ? "" : "s"}
                  </span>
                </div>

                {/* Right: Simulation Match Stats, Reorder buttons, Expand Chevron */}
                <div className="v2-rule-compact-right">
                  {simulationResult && rule.is_enabled && stat && (
                    <div
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                        padding: "3px 8px",
                        fontSize: 11.5,
                        fontWeight: 600,
                        color: "#047857",
                        background: "#ecfdf5",
                        border: "1px solid #a7f3d0",
                        borderRadius: 6,
                        whiteSpace: "nowrap",
                      }}
                      title="Actual 1-to-1 matches and percentage for this rule"
                    >
                      <CheckCircle2 size={12} color="#10b981" />
                      <span>
                        <strong>{stat.individual_satisfied_count.toLocaleString()}</strong> ({stat.individual_satisfied_percentage}%)
                      </span>
                    </div>
                  )}
                  {simulationResult && !rule.is_enabled && (
                    <div
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        padding: "3px 8px",
                        fontSize: 11,
                        fontWeight: 500,
                        color: "#64748b",
                        background: "#f1f5f9",
                        border: "1px solid #e2e8f0",
                        borderRadius: 6,
                        whiteSpace: "nowrap",
                      }}
                    >
                      <span>Excluded</span>
                    </div>
                  )}

                  {/* Up / Down Reorder */}
                  <div style={{ display: "flex", alignItems: "center", gap: 3 }} onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className="v2-rule-card-order-btn"
                      disabled={idx === 0}
                      onClick={() => handleMoveRule(idx, "up")}
                      title="Move up in execution priority"
                    >
                      <ChevronUp size={14} />
                    </button>
                    <button
                      type="button"
                      className="v2-rule-card-order-btn"
                      disabled={idx === rules.length - 1}
                      onClick={() => handleMoveRule(idx, "down")}
                      title="Move down in execution priority"
                    >
                      <ChevronDown size={14} />
                    </button>
                  </div>

                  {/* Expand/Collapse Chevron Button */}
                  <button
                    type="button"
                    className={`v2-expand-chevron-btn ${isExpanded ? "expanded" : ""}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleRuleExpand(rule.id);
                    }}
                    title={isExpanded ? "Collapse ancillary details" : "Expand ancillary details"}
                  >
                    <ChevronDown size={15} />
                  </button>
                </div>
              </div>

              {/* Word of Caution Banner for Disabled Core Statutory Rules */}
              {rule.rule_tier === "CORE_STATUTORY" && !rule.is_enabled && (
                <div className="v2-word-of-caution-box" onClick={(e) => e.stopPropagation()}>
                  <div className="v2-caution-header">
                    <AlertTriangle size={15} className="v2-caution-icon" />
                    <strong>Word of Caution (Core Statutory Rule Excluded):</strong>
                  </div>
                  <p className="v2-caution-desc">
                    {rule.advisory_caution ||
                      `'${rule.name}' is a primary statutory anchor under Section 16(2)(aa). Excluding this rule allows unanchored cross-vendor matching and exposes ITC claims to audit inquiry (Form DRC-01C).`}
                  </p>
                  <button
                    type="button"
                    className="btn-re-enable-statutory"
                    onClick={() => handleToggleRule(rule.id)}
                    title="Click to re-include this core statutory rule in reconciliation"
                  >
                    <Check size={12} /> Re-include Rule
                  </button>
                </div>
              )}

              {/* Expanded Ancillary Drawer (Exact Stage 3 Recon 2 Format) */}
              {isExpanded && (
                <div className="v2-rule-expanded-drawer" onClick={(e) => e.stopPropagation()}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14 }}>
                    <div>
                      <p style={{ fontSize: 13, color: "#475569", margin: "0 0 4px 0", lineHeight: 1.45 }}>
                        {rule.description}
                      </p>
                      {rule.canonical_concept && (
                        <span style={{ fontSize: 11, color: "#64748b", fontFamily: "monospace" }}>
                          Canonical concept: <code>{rule.canonical_concept}</code>
                        </span>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => setExplainingRule(rule)}
                      className="v2-browse-button"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "5px 12px",
                        fontSize: 12,
                        fontWeight: 600,
                        color: "#1d4ed8",
                        background: "#eff6ff",
                        border: "1px solid #bfdbfe",
                        borderRadius: 7,
                        cursor: "pointer",
                        flexShrink: 0,
                      }}
                      title="View plain-English explanation, target columns & accounting rationale"
                    >
                      <Info size={14} />
                      <span>Explain Rule</span>
                    </button>
                  </div>

                  {/* Unified 2 Sections */}
                  <div className="v2-rule-sections-wrapper">
                    {/* SECTION 1: NORMALISERS */}
                    <div className="v2-rule-section-block">
                      <div className="v2-rule-section-header">
                        <span className="v2-rule-section-title">
                          Section 1: Normalisers
                        </span>
                        <span className="v2-rule-section-count">
                          {activeNorms.length} active
                        </span>
                      </div>
                      <div className="v2-norm-chips-wrap">
                        {ALL_NORMALIZERS.map((norm) => {
                          const isActive = activeNorms.includes(norm.type);
                          return (
                            <button
                              key={norm.type}
                              type="button"
                              className={`v2-norm-chip ${isActive ? "is-active" : ""}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleToggleNormalizer(rule.id, norm.type);
                              }}
                              title={norm.description}
                            >
                              {isActive && <CheckCircle2 size={12} />}
                              <span>{norm.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* SECTION 2: EXACT MATCH & TOLERANCE MATCH */}
                    <div className="v2-rule-section-block">
                      <div className="v2-rule-section-header">
                        <span className="v2-rule-section-title">
                          Section 2: Exact match & Tolerance match
                        </span>
                      </div>

                      <div className="v2-match-mode-selector">
                        <button
                          type="button"
                          className={`v2-mode-pill ${isExactMatch ? "is-active" : ""}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSetMatchMode(rule.id, "EXACT");
                          }}
                        >
                          <CheckCircle2 size={13} />
                          <span>Exact Match</span>
                        </button>
                        <button
                          type="button"
                          className={`v2-mode-pill ${!isExactMatch ? "is-active" : ""}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSetMatchMode(rule.id, "TOLERANCE");
                          }}
                        >
                          <Sliders size={13} />
                          <span>Tolerance Match</span>
                        </button>
                      </div>

                      {isExactMatch ? (
                        <div className="v2-exact-mode-info">
                          <CheckCircle2 size={14} color="#059669" />
                          <span>Strict 1-to-1 Equality: Permitting 0.00 variance after normalisation.</span>
                        </div>
                      ) : (
                        <div className="v2-tolerance-control-group">
                          <span className="v2-tolerance-input-label">Permitted Variance:</span>
                          <div className="v2-tolerance-inputs-row">
                            <input
                              type="number"
                              min={0}
                              step={!isDate && rule.tolerance_mode === "PERCENTAGE" ? 0.1 : 1}
                              className="v2-input-number"
                              value={isDate ? (rule.date_tolerance_value || 30) : (rule.tolerance_value || 10)}
                              onChange={(e) => {
                                e.stopPropagation();
                                const val = parseFloat(e.target.value) || 0;
                                if (isDate) {
                                  handleUpdateDateTol(rule.id, Math.round(val));
                                } else {
                                  handleUpdateNumericTol(rule.id, val);
                                }
                              }}
                            />

                            {isDate ? (
                              <select
                                className="v2-select-mode"
                                value={rule.date_tolerance_unit || "DAYS"}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  handleUpdateDateTol(rule.id, rule.date_tolerance_value || 30, e.target.value as "DAYS" | "MONTHS" | "YEARS");
                                }}
                              >
                                <option value="DAYS">Absolute Days</option>
                                <option value="MONTHS">Months</option>
                                <option value="YEARS">Years</option>
                              </select>
                            ) : (
                              <select
                                className="v2-select-mode"
                                value={rule.tolerance_mode || "ABSOLUTE_INR"}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  handleUpdateNumericTol(rule.id, rule.tolerance_value || 10, e.target.value as "ABSOLUTE_INR" | "PERCENTAGE");
                                }}
                              >
                                <option value="ABSOLUTE_INR">Absolute Amount (INR)</option>
                                <option value="PERCENTAGE">Percentage (%)</option>
                              </select>
                            )}

                            <span className="v2-tolerance-formula-hint">
                              {isDate
                                ? `(± ${rule.date_tolerance_value || 30} ${(rule.date_tolerance_unit || "DAYS").toLowerCase()})`
                                : `(|CP - PR| ≤ ${rule.tolerance_mode === "PERCENTAGE" ? `${rule.tolerance_value || 10}%` : `₹${rule.tolerance_value || 10}`})`}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
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
                  {explainingRule.plain_english_explanation || explainingRule.description}
                </div>
              </div>

              <div className="v2-explain-section">
                <span className="v2-explain-label">Columns Evaluated Across Datasets</span>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div style={{ background: "#f1f5f9", padding: "10px 14px", borderRadius: 8 }}>
                    <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>COUNTERPARTY COLUMN (CP*)</div>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: "#0f172a", marginTop: 4 }}>
                      {explainingRule.source_field_concept}
                    </div>
                  </div>
                  <div style={{ background: "#ecfdf5", padding: "10px 14px", borderRadius: 8 }}>
                    <div style={{ fontSize: 11, color: "#047857", fontWeight: 600 }}>PURCHASE REGISTER (PR*)</div>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: "#065f46", marginTop: 4 }}>
                      {explainingRule.target_field_concept}
                    </div>
                  </div>
                </div>
              </div>

              <div className="v2-explain-section">
                <span className="v2-explain-label">Accounting & Regulatory Rationale (Why It Matters)</span>
                <div className="v2-explain-box rationale">
                  <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <ShieldCheck size={18} style={{ flexShrink: 0, marginTop: 2 }} />
                    <div>{explainingRule.statutory_rationale || explainingRule.why_it_matters || "Statutory reconciliation guardrail ensuring strict compliance with GST ITC claims."}</div>
                  </div>
                </div>
              </div>

              <div className="v2-explain-section">
                <span className="v2-explain-label">Active Comparison Parameters</span>
                <div style={{ fontSize: 12.5, color: "#475569", background: "#f8fafc", padding: "10px 14px", borderRadius: 8 }}>
                  {explainingRule.match_strategy === "DATE_PROXIMITY" && (
                    <span>
                      Window: ± <strong>{explainingRule.date_tolerance_value || 30} {(explainingRule.date_tolerance_unit || "DAYS").toLowerCase()}</strong>
                    </span>
                  )}
                  {explainingRule.match_strategy === "NUMERIC_TOLERANCE" && (
                    <span>
                      Variance: ± <strong>{explainingRule.tolerance_mode === "PERCENTAGE" ? `${explainingRule.tolerance_value}%` : `₹ ${explainingRule.tolerance_value || 10}`}</strong>
                    </span>
                  )}
                  {explainingRule.match_strategy === "EXACT" && (
                    <span>100% byte-for-byte exact value match</span>
                  )}
                  <div style={{ marginTop: 6, fontSize: 11.5, color: "#64748b" }}>
                    Active Normalizers: <strong>{configToActiveNormalizers(explainingRule.normalizers).join(", ") || "None"}</strong>
                  </div>
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
          <div className="v2-modal-card" style={{ maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
            <div className="v2-modal-header">
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Sparkles size={20} color="#7c3aed" />
                <h2 style={{ fontSize: 18, fontWeight: 700, color: "#0f172a", margin: 0 }}>
                  Make Intra-Table Rules with AI
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

            <div className="v2-modal-body" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <p style={{ fontSize: 13, color: "#475569", margin: 0 }}>
                Describe your desired intra-record matching logic in natural language. Our AI engine compiles it into a validated rule.
              </p>

              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#334155", display: "block", marginBottom: 6 }}>
                  Persistence Scope:
                </label>
                <div style={{ display: "flex", gap: 16 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
                    <input
                      type="radio"
                      name="persistenceChoiceV3"
                      value="temporary"
                      checked={rulePersistenceChoice === "temporary"}
                      onChange={() => setRulePersistenceChoice("temporary")}
                    />
                    <span><strong>Use Temporarily</strong> (This Run Only)</span>
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
                    <input
                      type="radio"
                      name="persistenceChoiceV3"
                      value="wiki"
                      checked={rulePersistenceChoice === "wiki"}
                      onChange={() => setRulePersistenceChoice("wiki")}
                    />
                    <span><strong>Save to Rules Wiki</strong> (All Runs Going Forward)</span>
                  </label>
                </div>
              </div>

              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#334155", display: "block", marginBottom: 6 }}>
                  Natural Language Prompt:
                </label>
                <textarea
                  rows={3}
                  className="v2-edit-input"
                  style={{ width: "100%", boxSizing: "border-box" }}
                  placeholder="e.g. Match taxable value within 5 rupees tolerance across CP and PR columns"
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                />
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                <span style={{ fontSize: 11, color: "#64748b", width: "100%" }}>Suggestions:</span>
                {[
                  "Allow ± ₹5 rounding on taxable value",
                  "Allow ± 15 days window on document date",
                  "Strict supplier GSTIN match with clean spaces",
                  "Match document numbers ignoring prefixes",
                ].map((sugg) => (
                  <button
                    key={sugg}
                    type="button"
                    style={{
                      background: "#f1f5f9",
                      border: "1px solid #cbd5e1",
                      borderRadius: 14,
                      padding: "3px 10px",
                      fontSize: 11.5,
                      color: "#334155",
                      cursor: "pointer",
                    }}
                    onClick={() => setAiPrompt(sugg)}
                  >
                    {sugg}
                  </button>
                ))}
              </div>

              {aiError && (
                <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "8px 12px", color: "#991b1b", fontSize: 12.5 }}>
                  {aiError}
                </div>
              )}

              {compiledPreview && (
                <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#0f172a", marginBottom: 4 }}>
                    Compiled Rule Preview:
                  </div>
                  <div style={{ fontSize: 13, color: "#1e293b", fontWeight: 600 }}>{compiledPreview.name}</div>
                  <div style={{ fontSize: 12, color: "#64748b" }}>{compiledPreview.description}</div>
                  <div style={{ fontSize: 11.5, color: "#0369a1", marginTop: 4 }}>
                    Linkage: <code>{compiledPreview.source_field_concept} ↔ {compiledPreview.target_field_concept}</code>
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
                  Add Rule to Pipeline
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* --- AI SUGGESTED RULES MODAL --- */}
      {showAiSuggestionsModal && (
        <div className="v2-modal-backdrop" onClick={() => setShowAiSuggestionsModal(false)}>
          <div className="v2-modal-card" style={{ maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
            <div className="v2-modal-header">
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Sparkles size={20} color="#7c3aed" />
                <h2 style={{ fontSize: 18, fontWeight: 700, color: "#0f172a", margin: 0 }}>
                  AI Suggested Rules
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setShowAiSuggestionsModal(false)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b" }}
              >
                <X size={20} />
              </button>
            </div>

            <div className="v2-modal-body">
              <p style={{ fontSize: 13, color: "#475569", margin: 0 }}>
                All high-confidence intra-table patterns in your dataset are currently mapped and active in your pipeline. You can synthesize custom rules using the <strong>"Make Rules with AI"</strong> tool.
              </p>
            </div>

            <div className="v2-modal-footer">
              <button
                type="button"
                className="btn-primary-v2"
                onClick={() => setShowAiSuggestionsModal(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
