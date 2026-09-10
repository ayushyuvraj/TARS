import React, { useState, useEffect, useRef } from "react";
import {
  apiV2,
  Rule2Item,
  SimulationResultV2,
  DateToleranceUnit,
  NumericToleranceMode,
  NormalizationType,
  MatchStrategy,
} from "./api_v2";
import {
  Play,
  ChevronDown,
  Info,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ShieldCheck,
  Sliders,
  X,
  StopCircle,
  Activity,
  Trash2,
  Edit3,
  User,
  Layers,
  Sparkles,
} from "lucide-react";
import "./rules_v2.css";

const ALL_NORMALIZERS: { type: NormalizationType; label: string; description?: string }[] = [
  { type: "TRIM_WHITESPACE", label: "Clean Spaces", description: "Trim leading and trailing whitespace" },
  { type: "STRIP_SPECIAL_CHARS", label: "Strip Symbols (+, -, /, _)", description: "Strip punctuation and delimiter symbols" },
  { type: "REMOVE_PREFIXES", label: "Strip Prefixes (INV, BILL)", description: "Strip standard document prefixes like INV or BILL" },
  { type: "TRIM_LEADING_ZEROS", label: "Trim Leading Zeros (0042 → 42)", description: "Remove leading zeroes from numeric identifiers" },
  { type: "UPPERCASE", label: "Case Fold (A-Z)", description: "Normalize letters to uppercase" },
];

function formatAuditDate(iso?: string | null): string {
  if (!iso) return "Initial Baseline";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString("en-US", {
      month: "short",
      day: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export const RulesWikiV2: React.FC = () => {
  const [rules, setRules] = useState<Rule2Item[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [simulationResult, setSimulationResult] = useState<SimulationResultV2 | null>(null);
  const [simulationAborted, setSimulationAborted] = useState<boolean>(false);

  // Multi-select & Batch Deletion state
  const [selectedRuleIds, setSelectedRuleIds] = useState<Set<string>>(new Set());

  // Irreversible Caution Delete Modal state
  const [deleteModalState, setDeleteModalState] = useState<{
    isOpen: boolean;
    ruleIds: string[];
    ruleName?: string;
  } | null>(null);

  // Edit Rule Modal state
  const [editingRule, setEditingRule] = useState<Rule2Item | null>(null);
  const [editForm, setEditForm] = useState<Rule2Item | null>(null);

  // Expanded Rule details state
  const [expandedRuleIds, setExpandedRuleIds] = useState<Set<string>>(new Set());

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

  // Agentic Simulation HUD telemetry state
  const [simStep, setSimStep] = useState<number>(1);
  const [simElapsedMs, setSimElapsedMs] = useState<number>(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Explanation Modal state
  const [explainingRule, setExplainingRule] = useState<Rule2Item | null>(null);

  // Load master catalog on mount with cross-storage synchronization
  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);

    const loadCatalog = async () => {
      try {
        const data = await apiV2.getRules2Catalog();
        if (!isMounted) return;

        let merged = [...(data || [])];
        try {
          // 1. Check local master storage
          const masterSaved = localStorage.getItem("tars_master_rules_v2_catalog");
          if (masterSaved) {
            const parsedMaster: Rule2Item[] = JSON.parse(masterSaved);
            for (const r of parsedMaster) {
              if (!merged.some((m) => m.id === r.id || (r.canonical_concept && m.canonical_concept === r.canonical_concept))) {
                merged.push(r);
              }
            }
          }
          // 2. Check active session rules across localStorage
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith("tars_v2_rules_")) {
              const raw = localStorage.getItem(key);
              if (raw) {
                const sessionRules: Rule2Item[] = JSON.parse(raw);
                for (const sr of sessionRules) {
                  if (
                    (sr.is_custom || sr.is_ai_suggested || sr.category === "AI_SUGGESTED") &&
                    !merged.some((m) => m.id === sr.id || (sr.canonical_concept && m.canonical_concept === sr.canonical_concept))
                  ) {
                    merged.push(sr);
                  }
                }
              }
            }
          }
        } catch (e) {
          console.warn("Could not merge local rules into Rules Wiki 2.0:", e);
        }

        merged = merged.map((r, idx) => ({
          ...r,
          execution_order: idx + 1,
          created_at: r.created_at || "2026-08-01T00:00:00Z",
          created_by: r.created_by || (r.is_ai_suggested ? "AI Data Engine (GPT-5.4-mini)" : "System Standard Baseline"),
          created_in_run: r.created_in_run || "Master Catalog v2.0",
          version: r.version || "1.0.0",
        }));

        setRules(merged);
        try {
          localStorage.setItem("tars_master_rules_v2_catalog", JSON.stringify(merged));
        } catch {}

        if (data && merged.length > data.length) {
          apiV2.saveRules2Catalog(merged).catch(() => {});
        }
      } catch (err) {
        console.error("Failed to load Rules 2.0 catalog:", err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    loadCatalog();

    return () => {
      isMounted = false;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  // Continuously persist any rule modifications to master catalog storage
  useEffect(() => {
    if (rules.length > 0) {
      try {
        localStorage.setItem("tars_master_rules_v2_catalog", JSON.stringify(rules));
      } catch {}
    }
  }, [rules]);

  const isExplicitAbortRef = useRef<boolean>(false);

  const handleAbortSimulation = () => {
    isExplicitAbortRef.current = true;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsSimulating(false);
    setSimulationAborted(true);
  };

  const runSimulation = async (rulesToSimulate = rules) => {
    isExplicitAbortRef.current = false;
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
      setSimulationAborted(false);
    } catch (err: any) {
      if (err.name === "AbortError" || err.message?.includes("aborted")) {
        if (isExplicitAbortRef.current) {
          console.log("Simulation explicitly aborted by user.");
          setSimulationAborted(true);
        }
      } else {
        console.error("Simulation failed:", err);
      }
    } finally {
      clearInterval(stepTimer);
      setIsSimulating(false);
      abortControllerRef.current = null;
    }
  };

  // Selection handlers
  const handleToggleSelectRule = (id: string) => {
    setSelectedRuleIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleToggleSelectAll = () => {
    if (selectedRuleIds.size === rules.length) {
      setSelectedRuleIds(new Set());
    } else {
      setSelectedRuleIds(new Set(rules.map((r) => r.id)));
    }
  };

  const handleClearSelection = () => {
    setSelectedRuleIds(new Set());
  };

  // Rule toggle active state (NO auto-simulation)
  const handleToggleRule = (id: string) => {
    const updated = rules.map((r) => (r.id === id ? { ...r, is_enabled: !r.is_enabled } : r));
    setRules(updated);
  };

  // Tolerance updates
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

  const handleSetMatchMode = (id: string, mode: "EXACT" | "TOLERANCE") => {
    const updated = rules.map((r) => {
      if (r.id === id) {
        const isDateRule = r.strategy === "DATE_PROXIMITY" || r.id === "RW2-003" || r.id === "RW2-006";
        if (mode === "EXACT") {
          return {
            ...r,
            tolerance_value: 0,
            date_tolerance_value: 0,
          };
        } else {
          return {
            ...r,
            tolerance_value: r.tolerance_value > 0 ? r.tolerance_value : 10.0,
            date_tolerance_value: r.date_tolerance_value > 0 ? r.date_tolerance_value : 30,
            tolerance_mode: r.tolerance_mode || "ABSOLUTE_INR",
            date_tolerance_unit: r.date_tolerance_unit || "DAYS",
            strategy: (isDateRule ? "DATE_PROXIMITY" : (r.strategy === "VALUE_GUARD" ? "VALUE_GUARD" : "NUMERIC_TOLERANCE")) as MatchStrategy,
          };
        }
      }
      return r;
    });
    setRules(updated);
  };

  // Delete Prompt
  const promptDeleteSingle = (rule: Rule2Item) => {
    setDeleteModalState({
      isOpen: true,
      ruleIds: [rule.id],
      ruleName: rule.name,
    });
  };

  const promptDeleteBatch = () => {
    if (selectedRuleIds.size === 0) return;
    setDeleteModalState({
      isOpen: true,
      ruleIds: Array.from(selectedRuleIds),
    });
  };

  // Perform Delete after explicit confirmation of irreversible caution
  const handleConfirmDelete = async () => {
    if (!deleteModalState || deleteModalState.ruleIds.length === 0) return;
    const idsToDelete = new Set(deleteModalState.ruleIds);

    try {
      if (deleteModalState.ruleIds.length === 1) {
        await apiV2.deleteRuleFromCatalog(deleteModalState.ruleIds[0]);
      } else {
        await apiV2.batchDeleteRulesFromCatalog(deleteModalState.ruleIds);
      }
    } catch (err) {
      console.warn("Backend delete endpoint notice (fallback to local state):", err);
    }

    const updatedRules = rules.filter((r) => !idsToDelete.has(r.id));
    setRules(updatedRules);

    setSelectedRuleIds((prev) => {
      const next = new Set(prev);
      for (const id of idsToDelete) {
        next.delete(id);
      }
      return next;
    });

    try {
      localStorage.setItem("tars_master_rules_v2_catalog", JSON.stringify(updatedRules));
    } catch {}

    setDeleteModalState(null);
  };

  // Edit Rule Handlers
  const handleStartEdit = (rule: Rule2Item) => {
    setEditingRule(rule);
    setEditForm({ ...rule });
  };

  const handleSaveEdit = () => {
    if (!editForm || !editingRule) return;

    const now = new Date().toISOString();
    const updatedRule: Rule2Item = {
      ...editForm,
      last_modified_at: now,
      last_modified_by: "Tax Reviewer (Manual Edit)",
      version: editForm.version ? incrementVersion(editForm.version) : "1.1.0",
    };

    const updatedList = rules.map((r) => (r.id === editingRule.id ? updatedRule : r));
    setRules(updatedList);

    try {
      localStorage.setItem("tars_master_rules_v2_catalog", JSON.stringify(updatedList));
    } catch {}

    apiV2.saveRules2Catalog(updatedList).catch(console.error);
    setEditingRule(null);
    setEditForm(null);
  };

  const incrementVersion = (v: string): string => {
    const parts = v.split(".");
    if (parts.length === 3) {
      const patch = parseInt(parts[2], 10);
      if (!isNaN(patch)) {
        return `${parts[0]}.${parts[1]}.${patch + 1}`;
      }
    }
    return `${v}.1`;
  };

  return (
    <div className="v2-rules-container" style={{ maxWidth: 1240, margin: "0 auto", padding: "24px 16px" }}>
      {/* 1. Header Banner (No 'Make Rules with AI' button) */}
      <header className="v2-rules-header">
        <div className="v2-rules-header__info">
          <span className="v2-rules-eyebrow">
            <ShieldCheck size={13} />
            Enterprise Governance Catalog
          </span>
          <h1 className="v2-rules-title">Rules Wiki 2.0</h1>
          <p className="v2-rules-subtitle">
            Master repository of declarative business rules configured for real-world enterprise GST reconciliation.
            Audit provenance, inspect comparison logic, edit parameters, or manage catalog policies.
          </p>
        </div>

        <div className="v2-rules-header__actions">
          <button
            type="button"
            className="btn-sim-run"
            disabled={isSimulating}
            onClick={() => runSimulation()}
          >
            <Play size={15} fill="currentColor" />
            <span>{isSimulating ? "Simulating..." : "Simulate"}</span>
          </button>
        </div>
      </header>

      {/* Floating Bulk Action Bar when rules are selected */}
      {selectedRuleIds.size > 0 && (
        <div className="v2-bulk-bar">
          <div className="v2-bulk-info">
            <span className="v2-bulk-count-badge">{selectedRuleIds.size}</span>
            <span>
              {selectedRuleIds.size === 1 ? "1 rule selected" : `${selectedRuleIds.size} rules selected`}
            </span>
          </div>

          <div className="v2-bulk-actions">
            <button
              type="button"
              className="btn-bulk-clear"
              onClick={handleClearSelection}
            >
              Clear Selection
            </button>
            <button
              type="button"
              className="btn-bulk-delete"
              onClick={promptDeleteBatch}
            >
              <Trash2 size={14} />
              <span>Delete Selected ({selectedRuleIds.size})</span>
            </button>
          </div>
        </div>
      )}

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
                    <div className="v2-hud-step-desc">Evaluating {rules.filter((r) => r.is_enabled).length} active rules in sequence</div>
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
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#334155" }}>
              <input
                type="checkbox"
                className="v2-card-select-checkbox"
                checked={rules.length > 0 && selectedRuleIds.size === rules.length}
                onChange={handleToggleSelectAll}
                title="Select all rules for bulk action"
              />
              <span>Select All</span>
            </label>
            <span style={{ color: "#94a3b8" }}>|</span>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: "#0f172a", margin: 0 }}>
              Master Catalog Rules ({rules.filter((r) => r.is_enabled).length} of {rules.length} active)
            </h2>
          </div>

          <span style={{ fontSize: 12, color: "#64748b" }}>
            Click rule card to view/configure comparison parameters & audit metadata.
          </span>
        </div>

        {rules.map((rule, idx) => {
          const isDate = rule.strategy === "DATE_PROXIMITY" || rule.id === "RW2-003" || rule.id === "RW2-006";
          const isExactMatch = isDate ? rule.date_tolerance_value === 0 : rule.tolerance_value === 0;
          const stat = simulationResult?.rule_breakdowns.find((b) => b.rule_id === rule.id);
          const isExpanded = expandedRuleIds.has(rule.id);
          const isSelected = selectedRuleIds.has(rule.id);

          return (
            <div
              key={rule.id}
              id={`v2-rule-card-${rule.id}`}
              className={`v2-rule-item-card ${!rule.is_enabled ? "disabled" : ""} ${isExpanded ? "is-expanded" : ""} ${rule.is_ai_suggested ? "is-ai-suggested-rule" : ""}`}
              style={{
                background: !rule.is_enabled ? "#f8fafc" : "#ffffff",
                borderColor: isSelected ? "#2563eb" : isExpanded ? "#93c5fd" : rule.is_enabled ? "#cbd5e1" : "#e2e8f0",
                boxShadow: isSelected ? "0 0 0 2px rgba(37, 99, 235, 0.2)" : undefined,
              }}
            >
              {/* Compact Main Row */}
              <div
                className="v2-rule-compact-row"
                onClick={() => toggleRuleExpand(rule.id)}
                title={isExpanded ? "Click to collapse details" : "Click to expand configuration & audit metadata"}
              >
                {/* Left: Checkbox for batch selection, Rule enable toggle, Category, Name */}
                <div className="v2-rule-compact-left">
                  <input
                    type="checkbox"
                    className="v2-card-select-checkbox"
                    checked={isSelected}
                    onChange={() => handleToggleSelectRule(rule.id)}
                    onClick={(e) => e.stopPropagation()}
                    title={isSelected ? "Deselect rule" : "Select rule for bulk deletion"}
                  />

                  <input
                    type="checkbox"
                    checked={rule.is_enabled}
                    onChange={() => handleToggleRule(rule.id)}
                    onClick={(e) => e.stopPropagation()}
                    style={{ width: 17, height: 17, cursor: "pointer" }}
                    title={rule.is_enabled ? "Active in reconciliation engine. Click to disable" : "Disabled in engine. Click to enable"}
                  />

                  <span className="v2-wf-tier-tag" style={{ fontSize: 10.5, padding: "2px 7px" }}>
                    #{idx + 1}
                  </span>

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
                  <span className="v2-source-pill-compact" title={`Matched columns: ${rule.gstr_column} ⟷ ${rule.pr_column}`}>
                    <strong className="gov">{rule.gstr_column}</strong>
                    <span style={{ color: "#94a3b8" }}>⟷</span>
                    <strong className="pr">{rule.pr_column}</strong>
                  </span>

                  {/* AI Suggested or Custom Origin Badges */}
                  {rule.is_ai_suggested && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        color: "#6d28d9",
                        background: "#f3e8ff",
                        border: "1px solid #d8b4fe",
                        padding: "2px 7px",
                        borderRadius: 999,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                      }}
                      title="AI suggested or adopted from Stage 3"
                    >
                      <Sparkles size={11} /> AI Suggested
                    </span>
                  )}
                  {rule.is_custom && !rule.is_ai_suggested && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        color: "#0369a1",
                        background: "#e0f2fe",
                        border: "1px solid #bae6fd",
                        padding: "2px 7px",
                        borderRadius: 999,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                      }}
                      title="Custom enterprise rule"
                    >
                      Custom Rule
                    </span>
                  )}

                  {/* Parameter Summary Badge */}
                  {isExactMatch ? (
                    <span className="v2-param-badge" style={{ background: "#ecfdf5", color: "#065f46", borderColor: "#a7f3d0" }} title="Exact match (0 variance)">
                      Exact Match
                    </span>
                  ) : isDate ? (
                    <span className="v2-param-badge date" title="Date tolerance parameter">
                      ± {rule.date_tolerance_value} {rule.date_tolerance_unit.toLowerCase()}
                    </span>
                  ) : (
                    <span className="v2-param-badge numeric" title="Numeric tolerance parameter">
                      ± {rule.tolerance_mode === "PERCENTAGE" ? `${rule.tolerance_value}%` : `₹${rule.tolerance_value}`}
                    </span>
                  )}
                  <span className="v2-param-badge" title="Active normalization rules count">
                    {rule.normalizers.length} normalizer{rule.normalizers.length === 1 ? "" : "s"}
                  </span>
                </div>

                {/* Right: Simulation Match Stats, Edit, Delete, Expand Chevron */}
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

                  {/* Edit Action Button */}
                  <button
                    type="button"
                    className="v2-rule-action-btn edit"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleStartEdit(rule);
                    }}
                    title="Edit rule name, columns, tolerances, or rationale"
                  >
                    <Edit3 size={12} />
                    <span>Edit</span>
                  </button>

                  {/* Single Delete Action Button */}
                  <button
                    type="button"
                    className="v2-rule-action-btn delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      promptDeleteSingle(rule);
                    }}
                    title="Delete rule permanently from catalog"
                  >
                    <Trash2 size={12} />
                    <span>Delete</span>
                  </button>

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

              {/* Audit & Governance Provenance Tray on each card */}
              <div className="v2-audit-tray">
                <div className="v2-audit-tray-left">
                  <div className="v2-audit-item" title="Timestamp when this rule was created">
                    <Clock size={12} color="#64748b" />
                    <span>Created: <strong>{formatAuditDate(rule.created_at)}</strong></span>
                  </div>

                  <div className="v2-audit-item" title="Author or system agent that authored this rule">
                    <User size={12} color="#64748b" />
                    <span>By: <strong>{rule.created_by || "System Standard Baseline"}</strong></span>
                  </div>

                  <div className="v2-audit-item" title="Reconciliation run or catalog context where this rule originated">
                    <Layers size={12} color="#64748b" />
                    <span>In Run: <strong>{rule.created_in_run || "Master Catalog v2.0"}</strong></span>
                  </div>
                </div>

                <div className="v2-audit-tray-right">
                  <span className={`v2-audit-badge ${rule.is_ai_suggested ? "ai" : rule.is_custom ? "custom" : "system"}`}>
                    v{rule.version || "1.0.0"}
                  </span>
                  {rule.last_modified_at && (
                    <span style={{ fontSize: 10.5, color: "#94a3b8" }} title={`Last modified on ${formatAuditDate(rule.last_modified_at)} by ${rule.last_modified_by || "User"}`}>
                      (Edited {formatAuditDate(rule.last_modified_at)})
                    </span>
                  )}
                </div>
              </div>

              {/* Expanded Ancillary Drawer */}
              {isExpanded && (
                <div className="v2-rule-expanded-drawer" onClick={(e) => e.stopPropagation()}>
                  {/* Top of Drawer: Description, Canonical Concept, Explain Rule Button */}
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
                      title="Click to view plain-English explanation, target columns & accounting rationale"
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
                          {rule.normalizers.length} active
                        </span>
                      </div>
                      <div className="v2-norm-chips-wrap">
                        {ALL_NORMALIZERS.map((norm) => {
                          const isActive = rule.normalizers.includes(norm.type);
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
                              value={isDate ? rule.date_tolerance_value : rule.tolerance_value}
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
                                value={rule.date_tolerance_unit}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  handleUpdateDateTol(rule.id, rule.date_tolerance_value, e.target.value as DateToleranceUnit);
                                }}
                              >
                                <option value="DAYS">Absolute Days</option>
                                <option value="MONTHS">Months</option>
                                <option value="YEARS">Years</option>
                              </select>
                            ) : (
                              <select
                                className="v2-select-mode"
                                value={rule.tolerance_mode}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  handleUpdateNumericTol(rule.id, rule.tolerance_value, e.target.value as NumericToleranceMode);
                                }}
                              >
                                <option value="ABSOLUTE_INR">Absolute Amount</option>
                                <option value="PERCENTAGE">Percentage</option>
                              </select>
                            )}

                            <span className="v2-tolerance-formula-hint">
                              {isDate
                                ? `(Matches if date difference does not exceed ± ${rule.date_tolerance_value} ${rule.date_tolerance_unit.toLowerCase()})`
                                : `(Matches if |GSTR - PR| does not exceed ${rule.tolerance_mode === "PERCENTAGE" ? `${rule.tolerance_value}%` : `₹${rule.tolerance_value}`})`}
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

      {/* --- EDIT RULE MODAL --- */}
      {editingRule && editForm && (
        <div className="v2-delete-modal-overlay" onClick={() => { setEditingRule(null); setEditForm(null); }}>
          <div className="v2-edit-modal-card" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 24px", borderBottom: "1px solid #e2e8f0" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Edit3 size={18} color="#2563eb" />
                <h2 style={{ fontSize: 17, fontWeight: 700, color: "#0f172a", margin: 0 }}>
                  Edit Reconciliation Rule
                </h2>
              </div>
              <button
                type="button"
                onClick={() => { setEditingRule(null); setEditForm(null); }}
                style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b" }}
              >
                <X size={20} />
              </button>
            </div>

            <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
              <div className="v2-edit-form-grid">
                <div className="v2-edit-form-group">
                  <label>Rule Name</label>
                  <input
                    type="text"
                    className="v2-edit-input"
                    value={editForm.name}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  />
                </div>

                <div className="v2-edit-form-group">
                  <label>Category</label>
                  <input
                    type="text"
                    className="v2-edit-input"
                    value={editForm.category}
                    onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                  />
                </div>

                <div className="v2-edit-form-group">
                  <label>GSTR-2B Target Column</label>
                  <input
                    type="text"
                    className="v2-edit-input"
                    value={editForm.gstr_column}
                    onChange={(e) => setEditForm({ ...editForm, gstr_column: e.target.value })}
                  />
                </div>

                <div className="v2-edit-form-group">
                  <label>Purchase Register Target Column</label>
                  <input
                    type="text"
                    className="v2-edit-input"
                    value={editForm.pr_column}
                    onChange={(e) => setEditForm({ ...editForm, pr_column: e.target.value })}
                  />
                </div>

                <div className="v2-edit-form-group full">
                  <label>Plain-English Description</label>
                  <textarea
                    rows={2}
                    className="v2-edit-input"
                    value={editForm.description}
                    onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                  />
                </div>

                <div className="v2-edit-form-group full">
                  <label>Accounting & Regulatory Rationale</label>
                  <textarea
                    rows={2}
                    className="v2-edit-input"
                    value={editForm.why_it_matters}
                    onChange={(e) => setEditForm({ ...editForm, why_it_matters: e.target.value })}
                  />
                </div>
              </div>

              {/* Normalizers Checklist */}
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#475569", textTransform: "uppercase", display: "block", marginBottom: 8 }}>
                  Active Normalizers
                </label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {ALL_NORMALIZERS.map((norm) => {
                    const checked = editForm.normalizers.includes(norm.type);
                    return (
                      <button
                        key={norm.type}
                        type="button"
                        className={`v2-norm-chip ${checked ? "is-active" : ""}`}
                        onClick={() => {
                          const updated = checked
                            ? editForm.normalizers.filter((n) => n !== norm.type)
                            : [...editForm.normalizers, norm.type];
                          setEditForm({ ...editForm, normalizers: updated });
                        }}
                      >
                        {checked && <CheckCircle2 size={12} />}
                        <span>{norm.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Tolerance Parameters */}
              <div style={{ background: "#f8fafc", padding: "14px 16px", borderRadius: 10, border: "1px solid #e2e8f0" }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "#334155", textTransform: "uppercase", display: "block", marginBottom: 8 }}>
                  Comparison Tolerances
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 12, color: "#64748b" }}>Numeric Tol:</span>
                    <input
                      type="number"
                      min={0}
                      className="v2-input-number"
                      style={{ width: 85 }}
                      value={editForm.tolerance_value}
                      onChange={(e) => setEditForm({ ...editForm, tolerance_value: parseFloat(e.target.value) || 0 })}
                    />
                    <select
                      className="v2-select-mode"
                      value={editForm.tolerance_mode}
                      onChange={(e) => setEditForm({ ...editForm, tolerance_mode: e.target.value as NumericToleranceMode })}
                    >
                      <option value="ABSOLUTE_INR">Absolute INR</option>
                      <option value="PERCENTAGE">Percentage (%)</option>
                    </select>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 12, color: "#64748b" }}>Date Tol:</span>
                    <input
                      type="number"
                      min={0}
                      className="v2-input-number"
                      style={{ width: 75 }}
                      value={editForm.date_tolerance_value}
                      onChange={(e) => setEditForm({ ...editForm, date_tolerance_value: parseInt(e.target.value, 10) || 0 })}
                    />
                    <select
                      className="v2-select-mode"
                      value={editForm.date_tolerance_unit}
                      onChange={(e) => setEditForm({ ...editForm, date_tolerance_unit: e.target.value as DateToleranceUnit })}
                    >
                      <option value="DAYS">Days</option>
                      <option value="MONTHS">Months</option>
                      <option value="YEARS">Years</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10, padding: "14px 24px", borderTop: "1px solid #e2e8f0", background: "#f8fafc" }}>
              <button
                type="button"
                className="btn-secondary-v2"
                onClick={() => { setEditingRule(null); setEditForm(null); }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary-v2"
                onClick={handleSaveEdit}
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- IRREVERSIBLE CAUTION DELETE CONFIRMATION MODAL --- */}
      {deleteModalState && deleteModalState.isOpen && (
        <div className="v2-delete-modal-overlay" onClick={() => setDeleteModalState(null)}>
          <div className="v2-delete-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="v2-delete-modal-header">
              <div className="v2-delete-icon-wrap">
                <AlertTriangle size={22} />
              </div>
              <div>
                <h2 style={{ fontSize: 17, fontWeight: 700, color: "#991b1b", margin: 0 }}>
                  {deleteModalState.ruleIds.length === 1
                    ? "Permanently Delete Rule?"
                    : `Permanently Delete ${deleteModalState.ruleIds.length} Rules?`}
                </h2>
                <span style={{ fontSize: 12, color: "#7f1d1d" }}>
                  Authoritative Reconciliation Catalog Governance
                </span>
              </div>
            </div>

            <div className="v2-delete-modal-body">
              {/* Mandatory Irreversible Caution Banner */}
              <div className="v2-irreversible-caution-box">
                <AlertTriangle size={24} color="#dc2626" style={{ flexShrink: 0, marginTop: 2 }} />
                <div className="v2-caution-text-wrap">
                  <span className="v2-caution-headline">
                    CAUTION: THIS ACTION IS IRREVERSIBLE AND CANNOT BE REVERSED
                  </span>
                  <p className="v2-caution-message">
                    Once deleted, {deleteModalState.ruleIds.length === 1 ? "this rule" : "these rules"} will be permanently removed from the Master Catalog. All associated parameters, normalizers, and execution logic cannot be recovered.
                  </p>
                </div>
              </div>

              {/* Items to be deleted list */}
              <div>
                <span style={{ fontSize: 12, fontWeight: 600, color: "#475569", display: "block", marginBottom: 6 }}>
                  Rules designated for permanent deletion:
                </span>
                <div className="v2-delete-item-list">
                  {deleteModalState.ruleIds.map((id) => {
                    const item = rules.find((r) => r.id === id);
                    return (
                      <div key={id} className="v2-delete-item-row">
                        <span style={{ fontWeight: 600, color: "#0f172a" }}>
                          {item ? item.name : id}
                        </span>
                        <span style={{ fontSize: 11, color: "#64748b" }}>
                          {item?.category}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <p style={{ fontSize: 12.5, color: "#64748b", margin: 0, lineHeight: 1.4 }}>
                Please confirm that you have audited these reconciliation rules and want to proceed with permanent deletion.
              </p>
            </div>

            <div className="v2-delete-modal-footer">
              <button
                type="button"
                className="btn-secondary-v2"
                onClick={() => setDeleteModalState(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-danger-confirm"
                onClick={handleConfirmDelete}
              >
                <Trash2 size={14} />
                <span>Yes, Permanently Delete</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
