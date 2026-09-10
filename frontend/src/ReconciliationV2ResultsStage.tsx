import React, { useState, useEffect, useMemo } from "react";
import {
  CheckCircle2,
  AlertCircle,
  Sparkles,
  ArrowRight,
  ArrowLeft,
  RefreshCw,
  Search,
  Filter,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Check,
  X,
  Layers,
  Zap,
  TrendingUp,
  AlertTriangle,
  Split,
  FileSpreadsheet,
  HelpCircle,
  Info,
  Play,
  ShieldCheck,
  Activity,
} from "lucide-react";
import {
  apiV2,
  Stage4ExecutionResponse,
  Stage4ResultsSummary,
  ReconciliationRecordItem,
  AmbiguityCluster,
  AmbiguityCandidate,
} from "./api_v2";
import { ReconciliationV2ActionBar } from "./ReconciliationV2ActionBar";
import "./results_v2.css";

interface ResultsStageProps {
  sessionId: string;
  onBackToRules: () => void;
  onProceedToNearMatches: () => void;
}

export const ReconciliationV2ResultsStage: React.FC<ResultsStageProps> = ({
  sessionId,
  onBackToRules,
  onProceedToNearMatches,
}) => {
  const [data, setData] = useState<Stage4ExecutionResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRerunning, setIsRerunning] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [execPass, setExecPass] = useState<number>(1);
  const [execElapsedMs, setExecElapsedMs] = useState<number>(0);

  // Filter state
  const [activeTab, setActiveTab] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);

  // Ambiguity Resolution Modal
  const [selectedCluster, setSelectedCluster] = useState<AmbiguityCluster | null>(null);
  const [isResolving, setIsResolving] = useState<boolean>(false);

  // Load results
  useEffect(() => {
    loadResults();
  }, [sessionId]);

  const loadResults = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const resp = await apiV2.getStage4Results(sessionId);
      setData(resp);
    } catch (err: any) {
      // Results have not been run yet for this session.
      // Do not auto-run. Show the Launchpad screen!
      setData(null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRerunWaterfall = async () => {
    setIsRerunning(true);
    setErrorMessage(null);
    setExecPass(1);
    setExecElapsedMs(0);
    const startTime = Date.now();
    const timer = setInterval(() => {
      setExecElapsedMs(Date.now() - startTime);
      setExecPass((prev) => (prev < 5 ? prev + 1 : prev));
    }, 1200);

    try {
      const resp = await apiV2.executeStage4Results(sessionId);
      setData(resp);
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to rerun reconciliation waterfall.");
    } finally {
      clearInterval(timer);
      setIsRerunning(false);
    }
  };

  const handleResolveAmbiguity = async (
    clusterId: string,
    chosenCandidateId?: string,
    action: "CHOOSE" | "REJECT" = "CHOOSE"
  ) => {
    setIsResolving(true);
    try {
      const updated = await apiV2.resolveAmbiguity(sessionId, clusterId, chosenCandidateId, action);
      setData(updated);
      setSelectedCluster(null);
    } catch (err: any) {
      alert(`Resolution failed: ${err.message || "Unknown error"}`);
    } finally {
      setIsResolving(false);
    }
  };

  const summary = data?.summary;
  const records = data?.records || [];
  const ambiguities = data?.ambiguities || [];
  const comparedColumns = data?.compared_columns || [];

  // Filtered records
  const filteredRecords = useMemo(() => {
    return records.filter((rec) => {
      // Tab filter
      if (activeTab === "EXACT_MATCH" && rec.bucket !== "EXACT_MATCH") return false;
      if (activeTab === "TOLERANCE_MATCH" && rec.bucket !== "TOLERANCE_MATCH") return false;
      if (activeTab === "NEAR_MATCH" && rec.bucket !== "NEAR_MATCH") return false;
      if (activeTab === "AMBIGUOUS" && rec.bucket !== "AMBIGUOUS") return false;
      if (activeTab === "GSTR_ONLY" && rec.bucket !== "GSTR_ONLY") return false;
      if (activeTab === "PR_ONLY" && rec.bucket !== "PR_ONLY") return false;
      if (activeTab === "RESOLVED_MANUALLY" && rec.bucket !== "RESOLVED_MANUALLY") return false;

      // Search filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const gstinMatch = rec.gstin?.toLowerCase().includes(q);
        const docMatch = rec.document_number?.toLowerCase().includes(q);
        const gstrPreview = JSON.stringify(rec.gstr_preview).toLowerCase();
        const prPreview = JSON.stringify(rec.pr_preview).toLowerCase();
        if (!gstinMatch && !docMatch && !gstrPreview.includes(q) && !prPreview.includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [records, activeTab, searchQuery]);

  // Pagination state
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(50);

  // Reset page when tab, search, or page size changes
  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, searchQuery, pageSize]);

  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / pageSize));

  const paginatedRecords = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredRecords.slice(start, start + pageSize);
  }, [filteredRecords, currentPage, pageSize]);

  // Tab counts
  const tabCounts = useMemo(() => {
    const counts = {
      ALL: records.length,
      EXACT_MATCH: 0,
      TOLERANCE_MATCH: 0,
      NEAR_MATCH: 0,
      AMBIGUOUS: 0,
      GSTR_ONLY: 0,
      PR_ONLY: 0,
      RESOLVED_MANUALLY: 0,
    };
    for (const r of records) {
      if (r.bucket in counts) {
        counts[r.bucket as keyof typeof counts]++;
      }
    }
    return counts;
  }, [records]);

  const WATERFALL_STEPS = [
    { tier: 1, name: "Pass 1: Exact Statutory Identity", desc: "Zero-tolerance match across GSTIN, Clean Invoice Number, Date, and Financials" },
    { tier: 2, name: "Pass 2: Enterprise Tolerances", desc: "Stage 3 configured numerical & date tolerances (± ₹10.00 / 30-day window)" },
    { tier: 3, name: "Pass 3: Semantic Near-Matching", desc: "Vectorized string edit distance (≥85%) with leading-zero and prefix normalization" },
    { tier: 4, name: "Pass 4: Ambiguity Clustering", desc: "Quarantining multi-match collisions (1:N and N:1) for accountant consensus" },
    { tier: 5, name: "Pass 5: Single-Sided Residuals", desc: "Categorizing GSTR-2B Only unclaimed credits vs Books-only DRC-01C risks" },
  ];

  if (isRerunning && !data) {
    const activePassInfo = WATERFALL_STEPS[execPass - 1] || WATERFALL_STEPS[0];
    return (
      <div className="v2-results-container">
        <ReconciliationV2ActionBar
          position="top"
          stageNumber={4}
          backLabel="Back to Stage 3 Rules"
          onBack={onBackToRules}
        />

        <div className="v2-processing-state-card" style={{ margin: "40px auto", maxWidth: 760 }}>
          <div className="v2-processing-header">
            <div className="v2-processing-spinner">
              <RefreshCw size={26} className="v2-spin text-blue-600" />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <h4 className="v2-processing-title" style={{ margin: 0 }}>
                  Executing 5-Pass Reconciliation Waterfall
                </h4>
                <span style={{ background: "#eff6ff", color: "#1d4ed8", padding: "4px 10px", borderRadius: 6, fontWeight: 700, fontSize: 13, border: "1px solid #bfdbfe" }}>
                  {(execElapsedMs / 1000).toFixed(1)}s elapsed
                </span>
              </div>
              <p className="v2-processing-step" style={{ marginTop: 6, color: "#1e40af", fontWeight: 600 }}>
                {activePassInfo.name}: <span style={{ fontWeight: 400, color: "#475569" }}>{activePassInfo.desc}</span>
              </p>
            </div>
          </div>

          <div className="v2-progress-rail" style={{ margin: "16px 0 20px 0" }}>
            <div className="v2-progress-indeterminate" />
          </div>

          {/* 5-Pass Telemetry Stepper Visualizer */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8, width: "100%" }}>
            {WATERFALL_STEPS.map((step) => {
              const isPast = step.tier < execPass;
              const isCurrent = step.tier === execPass;
              return (
                <div
                  key={step.tier}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    padding: "8px 6px",
                    borderRadius: 8,
                    background: isCurrent ? "#eff6ff" : (isPast ? "#f0fdf4" : "#f8fafc"),
                    border: `1px solid ${isCurrent ? "#93c5fd" : (isPast ? "#bbf7d0" : "#e2e8f0")}`,
                    textAlign: "center",
                    gap: 4,
                  }}
                >
                  <span style={{ fontSize: 10, fontWeight: 750, color: isCurrent ? "#1d4ed8" : (isPast ? "#16a34a" : "#94a3b8") }}>
                    PASS {step.tier}
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: isCurrent ? "#0f172a" : (isPast ? "#15803d" : "#64748b"), whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", width: "100%" }}>
                    {step.name.split(":")[1]?.trim() || step.name}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="v2-results-container">
        <div className="v2-processing-state-card" style={{ margin: "60px auto", maxWidth: 640 }}>
          <div className="v2-processing-header">
            <div className="v2-processing-spinner">
              <RefreshCw size={24} className="v2-spin text-blue-600" />
            </div>
            <div>
              <h4 className="v2-processing-title">Checking Reconciliation State</h4>
              <p className="v2-processing-step">
                Hydrating session waterfall results, deterministic matches, and ambiguity clusters...
              </p>
            </div>
          </div>
          <div className="v2-progress-rail">
            <div className="v2-progress-indeterminate" />
          </div>
        </div>
      </div>
    );
  }

  if (!data && !isLoading) {
    return (
      <div className="v2-results-container">
        {/* Top Action Bar */}
        <ReconciliationV2ActionBar
          position="top"
          stageNumber={4}
          backLabel="Back to Stage 3 Rules"
          onBack={onBackToRules}
        />

        {/* Hero Banner */}
        <div className="v2-results-hero" style={{ background: "linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #1e40af 100%)" }}>
          <div className="v2-results-hero-left">
            <div className="v2-results-stage-tag" style={{ background: "rgba(59, 130, 246, 0.2)", color: "#93c5fd" }}>
              <Sparkles size={13} />
              <span>Stage 4 of 8 • Reconciliation Engine Launchpad</span>
            </div>
            <h2 className="v2-results-hero-title">Ready to Run Reconciliation Engine</h2>
            <p className="v2-results-hero-desc">
              Your reconciliation rules, numerical tolerances, and schema couplings are frozen and locked. Click <strong>"Run Reconciliation Engine"</strong> to execute vectorized multi-pass matching across both workbooks.
            </p>
          </div>
        </div>

        {/* Launchpad Card */}
        <div className="v2-stage4-launchpad-card">
          <div className="v2-launchpad-prep-grid">
            <div className="v2-prep-item">
              <div className="v2-prep-icon green">
                <CheckCircle2 size={22} />
              </div>
              <div className="v2-prep-content">
                <span className="v2-prep-label">Stage 1 Ingestion</span>
                <span className="v2-prep-title">Dual Workbooks Primed</span>
                <span className="v2-prep-desc">Government GSTR-2B & Purchase Register active</span>
              </div>
            </div>

            <div className="v2-prep-item">
              <div className="v2-prep-icon green">
                <CheckCircle2 size={22} />
              </div>
              <div className="v2-prep-content">
                <span className="v2-prep-label">Stage 2 Mapping</span>
                <span className="v2-prep-title">AI Schema Coupled</span>
                <span className="v2-prep-desc">Canonical field alignments confirmed</span>
              </div>
            </div>

            <div className="v2-prep-item">
              <div className="v2-prep-icon green">
                <CheckCircle2 size={22} />
              </div>
              <div className="v2-prep-content">
                <span className="v2-prep-label">Stage 3 Rules</span>
                <span className="v2-prep-title">Matching Policy Frozen</span>
                <span className="v2-prep-desc">Tolerances & pass order locked</span>
              </div>
            </div>
          </div>

          <div className="v2-launchpad-action-deck">
            <button
              type="button"
              className="v2-btn-run-reconciliation-main"
              disabled={isRerunning}
              onClick={handleRerunWaterfall}
            >
              {isRerunning ? (
                <>
                  <RefreshCw size={20} className="v2-spin" />
                  <span>Executing Reconciliation Waterfall Engine…</span>
                </>
              ) : (
                <>
                  <Play size={20} fill="currentColor" />
                  <span>Run Reconciliation Engine</span>
                </>
              )}
            </button>
            <p className="v2-launchpad-hint">
              Executes 5-pass progressive elimination: exact identity, tolerance matching, near-match candidates, and ambiguity isolation.
            </p>
          </div>

          {errorMessage && (
            <div className="v2-alert-error" style={{ margin: "20px 0 0 0" }}>
              <AlertCircle size={16} />
              <span>{errorMessage}</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (errorMessage && !data) {
    return (
      <div className="v2-results-container">
        <div className="v2-alert-error" style={{ maxWidth: 640, margin: "60px auto", textAlign: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "center", marginBottom: 12 }}>
            <AlertCircle size={24} />
            <strong style={{ fontSize: 16 }}>Reconciliation Waterfall Failed</strong>
          </div>
          <p style={{ margin: 0, fontSize: 13, color: "#9f1239" }}>{errorMessage}</p>
          <button
            type="button"
            className="v2-browse-button blue"
            style={{ margin: "20px auto 0 auto" }}
            onClick={loadResults}
          >
            ← Retry Reconciliation Execution
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="v2-results-container">
      {/* 1. HERO BANNER */}
      <div className="v2-results-hero">
        <div className="v2-results-hero-left">
          <div className="v2-results-hero-title-row">
            <h2 className="v2-results-hero-title">Deterministic Match Matrix &amp; Ambiguity Hub</h2>
            <div className="v2-results-stage-tag">
              <Sparkles size={12} />
              <span>Stage 4 of 8 • Multi-Pass Reconciliation Matrix</span>
            </div>
          </div>
          <p className="v2-results-hero-desc">
            Dual-ledger progressive elimination executed across 5 statutory and commercial passes: zero-tolerance identity,
            configured numerical tolerances, semantic near-matching, and quarantined multi-matches with human-in-the-loop consensus.
          </p>
        </div>
        <div className="v2-results-hero-actions">
          <button
            type="button"
            className="v2-btn-rerun"
            onClick={handleRerunWaterfall}
            disabled={isRerunning}
            title="Re-run reconciliation waterfall with active rules"
          >
            <RefreshCw size={14} className={isRerunning ? "v2-spin" : ""} />
            <span>{isRerunning ? "Re-running..." : "Re-run Waterfall"}</span>
          </button>
          <button
            type="button"
            className="v2-btn-primary-action"
            onClick={onProceedToNearMatches}
          >
            <span>Review Near Matches</span>
            <ArrowRight size={14} />
          </button>
        </div>
      </div>

      {/* 2. OVERALL RECONCILIATION ACCURACY UNIT (SEPARATE HIGHLIGHTED BOX) */}
      {summary && (
        <div
          className={`v2-accuracy-hero-banner ${activeTab === "ALL" ? "is-active" : ""}`}
          onClick={() => setActiveTab("ALL")}
          title="Click to view all records"
        >
          <div className="v2-accuracy-left">
            <div className="v2-accuracy-icon-wrap">
              <TrendingUp size={18} color="#ffffff" />
            </div>
            <div className="v2-accuracy-title-group">
              <span className="v2-accuracy-title">Reconciliation Accuracy &amp; Health</span>
              <span className="v2-accuracy-sub">Overall progressive waterfall consensus across active statutory rules</span>
            </div>
          </div>
          <div className="v2-accuracy-right">
            <div className="v2-accuracy-stat-pill">
              <span className="v2-accuracy-rate-val">{summary.overall_reconciliation_rate}%</span>
              <span className="v2-accuracy-rate-lbl">Accuracy</span>
            </div>
            <div className="v2-accuracy-count-tag">
              Total Reconciled: <strong>{(summary.total_reconciled_count || 0).toLocaleString()}</strong> of {(summary.total_gstr_rows || 0).toLocaleString()} portal rows
            </div>
            <button
              type="button"
              className="v2-accuracy-view-all-btn"
              onClick={(e) => {
                e.stopPropagation();
                setActiveTab("ALL");
              }}
            >
              View All ({records.length.toLocaleString()})
            </button>
          </div>
        </div>
      )}

      {/* 3. EXECUTIVE 6-CATEGORY SUMMARY (IN ONE COMPACT LINE) */}
      {summary && (
        <div className="v2-kpi-hud-grid">
          {/* Box 1: Exact Matches */}
          <div
            className={`v2-kpi-card exact ${activeTab === "EXACT_MATCH" ? "is-active" : ""}`}
            onClick={() => setActiveTab("EXACT_MATCH")}
            title="Filter by Exact Matches"
          >
            <div className="v2-kpi-top">
              <span className="v2-kpi-label">Exact Match</span>
              <div className="v2-kpi-glyph">
                <CheckCircle2 size={15} />
              </div>
            </div>
            <div className="v2-kpi-value-row">
              <span className="v2-kpi-value">{(summary.exact_match_count || 0).toLocaleString()}</span>
              <span className="v2-kpi-unit">rows</span>
            </div>
            <div className="v2-kpi-caption">Pass 1 • Zero Variance</div>
          </div>

          {/* Box 2: Tolerance Matched */}
          <div
            className={`v2-kpi-card tolerance ${activeTab === "TOLERANCE_MATCH" ? "is-active" : ""}`}
            onClick={() => setActiveTab("TOLERANCE_MATCH")}
            title="Filter by Tolerance Matches"
          >
            <div className="v2-kpi-top">
              <span className="v2-kpi-label">Tolerance Match</span>
              <div className="v2-kpi-glyph">
                <Zap size={15} />
              </div>
            </div>
            <div className="v2-kpi-value-row">
              <span className="v2-kpi-value">{(summary.tolerance_match_count || 0).toLocaleString()}</span>
              <span className="v2-kpi-unit">rows</span>
            </div>
            <div className="v2-kpi-caption">Pass 2 • Margin Bounds</div>
          </div>

          {/* Box 3: Near Matches */}
          <div
            className={`v2-kpi-card near ${activeTab === "NEAR_MATCH" ? "is-active" : ""}`}
            onClick={() => setActiveTab("NEAR_MATCH")}
            title="Filter by Near Matches"
          >
            <div className="v2-kpi-top">
              <span className="v2-kpi-label">Near Match</span>
              <div className="v2-kpi-glyph">
                <Layers size={15} />
              </div>
            </div>
            <div className="v2-kpi-value-row">
              <span className="v2-kpi-value">{(summary.near_match_count || 0).toLocaleString()}</span>
              <span className="v2-kpi-unit">rows</span>
            </div>
            <div className="v2-kpi-caption">Pass 3 • Normalized Ref</div>
          </div>

          {/* Box 4: Ambiguous Multi */}
          <div
            className={`v2-kpi-card ambiguous ${activeTab === "AMBIGUOUS" ? "is-active" : ""}`}
            onClick={() => setActiveTab("AMBIGUOUS")}
            title="Filter by Ambiguous Cases"
          >
            <div className="v2-kpi-top">
              <span className="v2-kpi-label">Ambiguous</span>
              <div className="v2-kpi-glyph">
                <Split size={15} />
              </div>
            </div>
            <div className="v2-kpi-value-row">
              <span className="v2-kpi-value" style={{ color: "#d97706" }}>
                {(summary.ambiguous_count || 0).toLocaleString()}
              </span>
              <span className="v2-kpi-unit">cases</span>
            </div>
            <div className="v2-kpi-caption">Pass 4 • Multi-Candidate</div>
          </div>

          {/* Box 5: GSTR 2B Only */}
          <div
            className={`v2-kpi-card gstr-only ${activeTab === "GSTR_ONLY" ? "is-active" : ""}`}
            onClick={() => setActiveTab("GSTR_ONLY")}
            title="Filter by GSTR-2B Only"
          >
            <div className="v2-kpi-top">
              <span className="v2-kpi-label">GSTR 2B Only</span>
              <div className="v2-kpi-glyph">
                <AlertTriangle size={15} />
              </div>
            </div>
            <div className="v2-kpi-value-row">
              <span className="v2-kpi-value" style={{ color: "#0284c7" }}>
                {(summary.gstr_only_count || 0).toLocaleString()}
              </span>
              <span className="v2-kpi-unit">rows</span>
            </div>
            <div className="v2-kpi-caption">Pass 5 • Unclaimed Credit</div>
          </div>

          {/* Box 6: PR Only */}
          <div
            className={`v2-kpi-card pr-only ${activeTab === "PR_ONLY" ? "is-active" : ""}`}
            onClick={() => setActiveTab("PR_ONLY")}
            title="Filter by PR Only (In Books Only)"
          >
            <div className="v2-kpi-top">
              <span className="v2-kpi-label">PR Only</span>
              <div className="v2-kpi-glyph">
                <AlertCircle size={15} />
              </div>
            </div>
            <div className="v2-kpi-value-row">
              <span className="v2-kpi-value" style={{ color: "#e11d48" }}>
                {(summary.pr_only_count || 0).toLocaleString()}
              </span>
              <span className="v2-kpi-unit">rows</span>
            </div>
            <div className="v2-kpi-caption">Pass 5 • Missing in 2B</div>
          </div>
        </div>
      )}

      {/* 3. WATERFALL RETENTION FUNNEL */}
      {summary && summary.waterfall_passes && summary.waterfall_passes.length > 0 && (
        <div className="v2-waterfall-funnel-card">
          <div className="v2-funnel-header">
            <div className="v2-funnel-title-row">
              <Layers size={18} color="#00338d" />
              <div>
                <h3>Progressive Elimination Waterfall Flow</h3>
                <span className="v2-funnel-subtitle">
                  Visualizing multi-pass ledger retention across the 5 statutory matching tiers
                </span>
              </div>
            </div>
          </div>

          <div className="v2-funnel-tiers-track">
            {summary.waterfall_passes.map((pass) => (
              <div
                key={pass.tier}
                className={`v2-funnel-tier-item tier-${pass.tier}`}
                onClick={() => {
                  if (pass.tier === 1) setActiveTab("EXACT_MATCH");
                  if (pass.tier === 2) setActiveTab("TOLERANCE_MATCH");
                  if (pass.tier === 3) setActiveTab("NEAR_MATCH");
                  if (pass.tier === 4) setActiveTab("AMBIGUOUS");
                  if (pass.tier === 5) setActiveTab("GSTR_ONLY");
                }}
                style={{ cursor: "pointer" }}
              >
                <div className="v2-funnel-tier-top">
                  <span className={`v2-funnel-tier-badge tier-${pass.tier}`}>Tier {pass.tier}</span>
                  <span className="v2-funnel-tier-itc">
                    ₹{pass.matched_itc.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                  </span>
                </div>
                <h4 className="v2-funnel-tier-name">{pass.name}</h4>
                <div className="v2-funnel-tier-stat">
                  <span className="num">{(pass.matched_count || 0).toLocaleString()}</span>
                  <span className="pct">({pass.retention_percentage}%)</span>
                </div>
                <div className="v2-funnel-progress-rail">
                  <div
                    className="v2-funnel-progress-bar"
                    style={{ width: `${Math.min(100, Math.max(5, pass.retention_percentage))}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 4. RECONCILED LEDGER MATRIX TABLE */}
      <div className="v2-ledger-card">
        <div className="v2-ledger-toolbar">
          {/* Tabs Row */}
          <div className="v2-ledger-tabs-row">
            <button
              type="button"
              className={`v2-ledger-tab-btn ${activeTab === "ALL" ? "is-active" : ""}`}
              onClick={() => setActiveTab("ALL")}
            >
              <span>All Ledger Records</span>
              <span className="v2-tab-count-pill">{tabCounts.ALL}</span>
            </button>
            <button
              type="button"
              className={`v2-ledger-tab-btn ${activeTab === "EXACT_MATCH" ? "is-active" : ""}`}
              onClick={() => setActiveTab("EXACT_MATCH")}
            >
              <CheckCircle2 size={13} color={activeTab === "EXACT_MATCH" ? "#fff" : "#10b981"} />
              <span>Exact Matches</span>
              <span className="v2-tab-count-pill">{tabCounts.EXACT_MATCH}</span>
            </button>
            <button
              type="button"
              className={`v2-ledger-tab-btn ${activeTab === "TOLERANCE_MATCH" ? "is-active" : ""}`}
              onClick={() => setActiveTab("TOLERANCE_MATCH")}
            >
              <Zap size={13} color={activeTab === "TOLERANCE_MATCH" ? "#fff" : "#3b82f6"} />
              <span>Tolerance Matched</span>
              <span className="v2-tab-count-pill">{tabCounts.TOLERANCE_MATCH}</span>
            </button>
            <button
              type="button"
              className={`v2-ledger-tab-btn ${activeTab === "NEAR_MATCH" ? "is-active" : ""}`}
              onClick={() => setActiveTab("NEAR_MATCH")}
            >
              <Layers size={13} color={activeTab === "NEAR_MATCH" ? "#fff" : "#8b5cf6"} />
              <span>Near Matches</span>
              <span className="v2-tab-count-pill">{tabCounts.NEAR_MATCH}</span>
            </button>
            <button
              type="button"
              className={`v2-ledger-tab-btn ${activeTab === "AMBIGUOUS" ? "is-active" : ""}`}
              onClick={() => setActiveTab("AMBIGUOUS")}
            >
              <Split size={13} color={activeTab === "AMBIGUOUS" ? "#fff" : "#f59e0b"} />
              <span>Ambiguous Collisions</span>
              <span className="v2-tab-count-pill">{tabCounts.AMBIGUOUS}</span>
            </button>
            <button
              type="button"
              className={`v2-ledger-tab-btn ${activeTab === "GSTR_ONLY" ? "is-active" : ""}`}
              onClick={() => setActiveTab("GSTR_ONLY")}
            >
              <AlertTriangle size={13} color={activeTab === "GSTR_ONLY" ? "#fff" : "#ef4444"} />
              <span>GSTR Only (Unclaimed)</span>
              <span className="v2-tab-count-pill">{tabCounts.GSTR_ONLY}</span>
            </button>
            <button
              type="button"
              className={`v2-ledger-tab-btn ${activeTab === "PR_ONLY" ? "is-active" : ""}`}
              onClick={() => setActiveTab("PR_ONLY")}
            >
              <AlertTriangle size={13} color={activeTab === "PR_ONLY" ? "#fff" : "#be123c"} />
              <span>PR Only (DRC-01C)</span>
              <span className="v2-tab-count-pill">{tabCounts.PR_ONLY}</span>
            </button>
            {tabCounts.RESOLVED_MANUALLY > 0 && (
              <button
                type="button"
                className={`v2-ledger-tab-btn ${activeTab === "RESOLVED_MANUALLY" ? "is-active" : ""}`}
                onClick={() => setActiveTab("RESOLVED_MANUALLY")}
              >
                <Check size={13} color={activeTab === "RESOLVED_MANUALLY" ? "#fff" : "#15803d"} />
                <span>Resolved Manually</span>
                <span className="v2-tab-count-pill">{tabCounts.RESOLVED_MANUALLY}</span>
              </button>
            )}
          </div>

          {/* Search & Control Row */}
          <div className="v2-ledger-controls-row">
            <div className="v2-ledger-search-box">
              <Search size={15} className="v2-ledger-search-icon" />
              <input
                type="text"
                placeholder="Search by Supplier GSTIN, Document #, or Vendor Name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="v2-ledger-search-input"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  style={{
                    position: "absolute",
                    right: 10,
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "#94a3b8",
                  }}
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <span className="v2-ledger-meta-info">
              Showing{" "}
              {filteredRecords.length === 0
                ? "0"
                : `${((currentPage - 1) * pageSize + 1).toLocaleString()}–${Math.min(
                    currentPage * pageSize,
                    filteredRecords.length
                  ).toLocaleString()}`}{" "}
              of {filteredRecords.length.toLocaleString()} records
              {totalPages > 1 && ` • Page ${currentPage} of ${totalPages}`}
              {comparedColumns.length > 0 && (
                <span className="v2-compared-cols-badge" title="Dynamic rules actively evaluated across both datasets">
                  {comparedColumns.length} Columns Reconciled
                </span>
              )}
            </span>
          </div>
        </div>

        {/* Table Content */}
        <div className="v2-table-wrapper">
          <table className="v2-ledger-table">
            <thead>
              <tr>
                <th style={{ width: 40 }}></th>
                <th>Classification</th>
                <th>Supplier GSTIN</th>
                <th>Document #</th>
                <th>Date</th>
                <th style={{ textAlign: "right" }}>Taxable Value</th>
                <th style={{ textAlign: "right" }}>Tax Amount (ITC)</th>
                <th style={{ textAlign: "right" }}>Total Value</th>
                <th>Matching Waterfall Pass</th>
                <th style={{ textAlign: "center", width: 100 }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredRecords.length === 0 ? (
                <tr>
                  <td colSpan={10} style={{ textAlign: "center", padding: "40px 20px", color: "#64748b" }}>
                    No records found matching current tab filter and search query.
                  </td>
                </tr>
              ) : (
                paginatedRecords.map((rec) => {
                  const isExpanded = expandedRowId === rec.id;
                  return (
                    <React.Fragment key={rec.id}>
                      <tr
                        className={`v2-ledger-row ${isExpanded ? "is-expanded" : ""}`}
                        onClick={() => setExpandedRowId(isExpanded ? null : rec.id)}
                      >
                        <td style={{ textAlign: "center" }}>
                          {isExpanded ? (
                            <ChevronUp size={16} color="#00338d" />
                          ) : (
                            <ChevronDown size={16} color="#94a3b8" />
                          )}
                        </td>
                        <td>
                          {rec.bucket === "EXACT_MATCH" && (
                            <span className="v2-bucket-badge exact">
                              <CheckCircle2 size={11} /> Exact Match
                            </span>
                          )}
                          {rec.bucket === "TOLERANCE_MATCH" && (
                            <span className="v2-bucket-badge tolerance">
                              <Zap size={11} /> Tolerance Matched
                            </span>
                          )}
                          {rec.bucket === "NEAR_MATCH" && (
                            <span className="v2-bucket-badge near">
                              <Layers size={11} /> Near Match
                            </span>
                          )}
                          {rec.bucket === "AMBIGUOUS" && (
                            <span className="v2-bucket-badge ambiguous">
                              <Split size={11} /> Ambiguous
                            </span>
                          )}
                          {rec.bucket === "GSTR_ONLY" && (
                            <span className="v2-bucket-badge gstr-only">
                              <AlertTriangle size={11} /> GSTR Only
                            </span>
                          )}
                          {rec.bucket === "PR_ONLY" && (
                            <span className="v2-bucket-badge pr-only">
                              <AlertTriangle size={11} /> PR Only
                            </span>
                          )}
                          {rec.bucket === "RESOLVED_MANUALLY" && (
                            <span className="v2-bucket-badge resolved">
                              <Check size={11} /> Resolved Manually
                            </span>
                          )}
                        </td>
                        <td>
                          <span className="v2-gstin-code">{rec.gstin || "—"}</span>
                        </td>
                        <td>
                          <span className="v2-doc-num">{rec.document_number || "—"}</span>
                        </td>
                        <td>
                          <span style={{ fontSize: 12.5, color: "#64748b" }}>{rec.document_date || "—"}</span>
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <span className="v2-money-amt">
                            ₹{rec.taxable_value.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                          </span>
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <span className="v2-money-amt" style={{ color: "#00338d", fontWeight: 700 }}>
                            ₹{rec.tax_amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                          </span>
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <span className="v2-money-amt">
                            ₹{rec.total_value.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                          </span>
                        </td>
                        <td>
                          <span style={{ fontSize: 12, color: "#475569" }}>{rec.matched_by_pass}</span>
                        </td>
                        <td style={{ textAlign: "center" }}>
                          {rec.bucket === "AMBIGUOUS" && rec.ambiguity_cluster_id ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                const cluster = ambiguities.find((c) => c.cluster_id === rec.ambiguity_cluster_id);
                                if (cluster) setSelectedCluster(cluster);
                              }}
                              style={{
                                padding: "4px 10px",
                                background: "#fef3c7",
                                border: "1px solid #fde68a",
                                borderRadius: 6,
                                color: "#b45309",
                                fontSize: 11.5,
                                fontWeight: 700,
                                cursor: "pointer",
                              }}
                            >
                              Resolve
                            </button>
                          ) : (
                            <span style={{ fontSize: 11.5, color: "#94a3b8" }}>
                              {isExpanded ? "Collapse" : "Details"}
                            </span>
                          )}
                        </td>
                      </tr>

                      {/* Side-by-side expandable row view */}
                      {isExpanded && (
                        <tr>
                          <td colSpan={10} style={{ padding: 0 }}>
                            <div className="v2-row-detail-panel">
                              {/* AI / Matching Engine Classification Rationale */}
                              {(rec.classification_reason || rec.ai_reason) && (
                                <div className="v2-classification-reason-card">
                                  <div className="v2-reason-header">
                                    <div className="v2-reason-title">
                                      <Sparkles size={15} color="#00338d" />
                                      <span>Match Classification &amp; Audit Rationale</span>
                                    </div>
                                    <span className="v2-reason-pass-badge">
                                      {rec.matched_by_pass || rec.bucket}
                                    </span>
                                  </div>
                                  <div className="v2-reason-text">
                                    {rec.classification_reason || rec.ai_reason}
                                  </div>
                                </div>
                              )}

                              <div className="v2-side-by-side-grid">
                                {/* Left Side: GSTR-2B */}
                                <div className="v2-side-box gstr">
                                  <div className="v2-side-box-header">
                                    <span className="v2-side-box-title">Official Portal GSTR-2B</span>
                                    <span style={{ fontSize: 11, color: "#0284c7", fontWeight: 700 }}>
                                      {rec.gstr_record_id || "GSTR-RECORD"}
                                    </span>
                                  </div>
                                  <div className="v2-fields-grid">
                                    <div className="v2-field-unit">
                                      <label>Supplier GSTIN</label>
                                      <span>{rec.gstr_preview?.gstin || rec.gstin || "—"}</span>
                                    </div>
                                    <div className="v2-field-unit">
                                      <label>Document #</label>
                                      <span>{rec.gstr_preview?.document_number || rec.document_number || "—"}</span>
                                    </div>
                                    <div className="v2-field-unit">
                                      <label>Invoice Date</label>
                                      <span>{rec.gstr_preview?.document_date || rec.document_date || "—"}</span>
                                    </div>
                                    <div className="v2-field-unit">
                                      <label>Taxable Value</label>
                                      <span>
                                        ₹{Number(rec.gstr_preview?.taxable_value || rec.taxable_value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                                      </span>
                                    </div>
                                    <div className="v2-field-unit">
                                      <label>Tax Amount</label>
                                      <span>
                                        ₹{Number(rec.gstr_preview?.tax_amount || rec.tax_amount || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                                      </span>
                                    </div>
                                    <div className="v2-field-unit">
                                      <label>Total Value</label>
                                      <span>
                                        ₹{Number(rec.gstr_preview?.total_value || rec.total_value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                                      </span>
                                    </div>
                                    {rec.gstr_preview?.VendorName && (
                                      <div className="v2-field-unit" style={{ gridColumn: "span 3" }}>
                                        <label>Vendor Legal Name</label>
                                        <span>{rec.gstr_preview.VendorName}</span>
                                      </div>
                                    )}

                                    {/* Dynamic auxiliary columns evaluated in Stage 3 */}
                                    {comparedColumns
                                      .filter((c) => {
                                        const fa = c.field_a || c.gstr_column;
                                        return (
                                          fa &&
                                          ![
                                            "gstin",
                                            "document_number",
                                            "document_date",
                                            "taxable_value",
                                            "tax_amount",
                                            "total_value",
                                            "VendorName",
                                          ].includes(fa)
                                        );
                                      })
                                      .map((c) => {
                                        const fa = c.field_a || c.gstr_column;
                                        const val = rec.gstr_preview && fa ? rec.gstr_preview[fa] : undefined;
                                        return (
                                          <div key={c.rule_id} className="v2-field-unit auxiliary">
                                            <label>{c.rule_name || fa}</label>
                                            <span>
                                              {val !== undefined && val !== null && String(val).trim() !== ""
                                                ? String(val)
                                                : "—"}
                                            </span>
                                          </div>
                                        );
                                      })}
                                  </div>
                                </div>

                                {/* Right Side: Client ERP PR */}
                                <div className="v2-side-box pr">
                                  <div className="v2-side-box-header">
                                    <span className="v2-side-box-title">ERP Purchase Register</span>
                                    <span style={{ fontSize: 11, color: "#7c3aed", fontWeight: 700 }}>
                                      {rec.pr_record_id || (rec.pr_row_index !== null ? `PR-${(rec.pr_row_index || 0)+1}` : "NOT IN BOOKS")}
                                    </span>
                                  </div>
                                  <div className="v2-fields-grid">
                                    <div className="v2-field-unit">
                                      <label>Vendor GSTIN</label>
                                      <span>{rec.pr_preview?.gstin || (rec.bucket === "GSTR_ONLY" ? "Missing in Books" : rec.gstin) || "—"}</span>
                                    </div>
                                    <div className="v2-field-unit">
                                      <label>Document #</label>
                                      <span>{rec.pr_preview?.document_number || (rec.bucket === "GSTR_ONLY" ? "—" : rec.document_number) || "—"}</span>
                                    </div>
                                    <div className="v2-field-unit">
                                      <label>Invoice Date</label>
                                      <span>{rec.pr_preview?.document_date || (rec.bucket === "GSTR_ONLY" ? "—" : rec.document_date) || "—"}</span>
                                    </div>
                                    <div className="v2-field-unit">
                                      <label>Taxable Value</label>
                                      <span>
                                        {rec.pr_preview?.taxable_value !== undefined
                                          ? `₹${Number(rec.pr_preview.taxable_value).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`
                                          : rec.bucket === "GSTR_ONLY" ? "—" : `₹${rec.taxable_value.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`}
                                      </span>
                                    </div>
                                    <div className="v2-field-unit">
                                      <label>Tax Amount</label>
                                      <span>
                                        {rec.pr_preview?.tax_amount !== undefined
                                          ? `₹${Number(rec.pr_preview.tax_amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`
                                          : rec.bucket === "GSTR_ONLY" ? "—" : `₹${rec.tax_amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`}
                                      </span>
                                    </div>
                                    <div className="v2-field-unit">
                                      <label>Total Value</label>
                                      <span>
                                        {rec.pr_preview?.total_value !== undefined
                                          ? `₹${Number(rec.pr_preview.total_value).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`
                                          : rec.bucket === "GSTR_ONLY" ? "—" : `₹${rec.total_value.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`}
                                      </span>
                                    </div>
                                    {rec.pr_preview?.SupplierName && (
                                      <div className="v2-field-unit" style={{ gridColumn: "span 3" }}>
                                        <label>Supplier Name in Books</label>
                                        <span>{rec.pr_preview.SupplierName}</span>
                                      </div>
                                    )}

                                    {/* Dynamic auxiliary columns evaluated in Stage 3 */}
                                    {comparedColumns
                                      .filter((c) => {
                                        const fb = c.field_b || c.pr_column;
                                        return (
                                          fb &&
                                          ![
                                            "gstin",
                                            "document_number",
                                            "document_date",
                                            "taxable_value",
                                            "tax_amount",
                                            "total_value",
                                            "SupplierName",
                                          ].includes(fb)
                                        );
                                      })
                                      .map((c) => {
                                        const fb = c.field_b || c.pr_column;
                                        const val = rec.pr_preview && fb ? rec.pr_preview[fb] : undefined;
                                        return (
                                          <div key={c.rule_id} className="v2-field-unit auxiliary">
                                            <label>{c.rule_name || fb}</label>
                                            <span>
                                              {val !== undefined && val !== null && String(val).trim() !== ""
                                                ? String(val)
                                                : rec.bucket === "GSTR_ONLY"
                                                ? "—"
                                                : "—"}
                                            </span>
                                          </div>
                                        );
                                      })}
                                  </div>
                                </div>
                              </div>

                              {/* Variances Chip Bar */}
                              <div className="v2-variance-bar">
                                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                  <strong>Consensus Variances:</strong>
                                  <div className="v2-variance-chips">
                                    {rec.variances && Object.keys(rec.variances).length > 0 ? (
                                      Object.entries(rec.variances).map(([k, v]) => {
                                        const isWarn =
                                          (k.includes("diff") && Number(v) > 0) || String(v) === "MISMATCH";
                                        const isAgreed = String(v) === "YES" || String(v) === "EXACT";
                                        return (
                                          <span
                                            key={k}
                                            className={`v2-diff-chip ${
                                              isWarn ? "warn" : isAgreed ? "guard-agreed" : ""
                                            }`}
                                          >
                                            {k.replace(/_/g, " ")}: <strong>{String(v)}</strong>
                                          </span>
                                        );
                                      })
                                    ) : (
                                      <span className="v2-diff-chip">Zero Variance (Exact Match)</span>
                                    )}
                                  </div>
                                </div>

                                {rec.bucket === "AMBIGUOUS" && rec.ambiguity_cluster_id && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const cluster = ambiguities.find((c) => c.cluster_id === rec.ambiguity_cluster_id);
                                      if (cluster) setSelectedCluster(cluster);
                                    }}
                                    style={{
                                      padding: "6px 14px",
                                      background: "#00338d",
                                      color: "#ffffff",
                                      border: "none",
                                      borderRadius: 6,
                                      fontSize: 12,
                                      fontWeight: 700,
                                      cursor: "pointer",
                                    }}
                                  >
                                    Launch Multi-Match Disambiguation →
                                  </button>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Toolbar */}
        {filteredRecords.length > 0 && (
          <div className="v2-pagination-bar">
            <div className="v2-pagination-left">
              <span className="v2-pagination-info">
                Showing <strong>{((currentPage - 1) * pageSize + 1).toLocaleString()}</strong> to{" "}
                <strong>{Math.min(currentPage * pageSize, filteredRecords.length).toLocaleString()}</strong> of{" "}
                <strong>{filteredRecords.length.toLocaleString()}</strong> records
              </span>
              <div className="v2-page-size-selector">
                <label htmlFor="pageSizeSelect">Rows per page:</label>
                <select
                  id="pageSizeSelect"
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  className="v2-page-select"
                >
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                  <option value={200}>200</option>
                </select>
              </div>
            </div>

            <div className="v2-pagination-right">
              <button
                type="button"
                className="v2-page-nav-btn"
                onClick={() => setCurrentPage(1)}
                disabled={currentPage === 1}
                title="First Page"
              >
                «
              </button>
              <button
                type="button"
                className="v2-page-nav-btn"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                title="Previous Page"
              >
                ‹ Prev
              </button>

              <div className="v2-page-numbers">
                <span className="v2-page-indicator">
                  Page <strong>{currentPage}</strong> of <strong>{totalPages}</strong>
                </span>
              </div>

              <button
                type="button"
                className="v2-page-nav-btn"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages}
                title="Next Page"
              >
                Next ›
              </button>
              <button
                type="button"
                className="v2-page-nav-btn"
                onClick={() => setCurrentPage(totalPages)}
                disabled={currentPage >= totalPages}
                title="Last Page"
              >
                »
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 5. AMBIGUITY RESOLUTION MODAL / DRAWER */}
      {selectedCluster && (
        <div className="v2-modal-backdrop" onClick={() => setSelectedCluster(null)}>
          <div className="v2-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="v2-modal-header">
              <div className="v2-modal-title-row">
                <Split size={20} color="#00338d" />
                <div>
                  <h3>Human-in-the-Loop Disambiguation Hub</h3>
                  <span style={{ fontSize: 12.5, color: "#64748b" }}>
                    Cluster {selectedCluster.cluster_id} • Multiple purchase register candidates identified for GSTR document
                  </span>
                </div>
              </div>
              <button
                type="button"
                className="v2-modal-close-btn"
                onClick={() => setSelectedCluster(null)}
              >
                <X size={18} />
              </button>
            </div>

            <div className="v2-modal-body">
              {/* Anchor Card */}
              <div className="v2-ambiguity-anchor-card">
                <div className="v2-anchor-header">
                  <span className="v2-anchor-badge">
                    <FileSpreadsheet size={13} /> Official Portal Anchor Invoice (GSTR-2B)
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#1d4ed8" }}>
                    {selectedCluster.gstr_record_id}
                  </span>
                </div>
                <div className="v2-fields-grid">
                  <div className="v2-field-unit">
                    <label>Supplier GSTIN</label>
                    <span className="v2-gstin-code">{selectedCluster.anchor_preview?.gstin || "—"}</span>
                  </div>
                  <div className="v2-field-unit">
                    <label>Invoice Number</label>
                    <span className="v2-doc-num">{selectedCluster.anchor_preview?.document_number || "—"}</span>
                  </div>
                  <div className="v2-field-unit">
                    <label>Invoice Date</label>
                    <span>{selectedCluster.anchor_preview?.document_date || "—"}</span>
                  </div>
                  <div className="v2-field-unit">
                    <label>Taxable Amount</label>
                    <span className="v2-money-amt">
                      ₹{Number(selectedCluster.anchor_preview?.taxable_value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="v2-field-unit">
                    <label>Tax (ITC)</label>
                    <span className="v2-money-amt" style={{ color: "#00338d", fontWeight: 700 }}>
                      ₹{Number(selectedCluster.anchor_preview?.tax_amount || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="v2-field-unit">
                    <label>Total Value</label>
                    <span className="v2-money-amt">
                      ₹{Number(selectedCluster.anchor_preview?.total_value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
              </div>

              {/* AI Justification Explanation */}
              <div style={{ background: "#f8fafc", padding: "12px 16px", borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 13, color: "#334155", display: "flex", alignItems: "flex-start", gap: 10 }}>
                <Info size={16} color="#00338d" style={{ marginTop: 2, flexShrink: 0 }} />
                <span>{selectedCluster.ai_justification}</span>
              </div>

              {/* Candidates Side-by-Side Cards */}
              <div className="v2-candidates-grid">
                {selectedCluster.candidates.map((cand, idx) => {
                  const conf = cand.confidence_score;
                  const pillClass = conf >= 85 ? "high" : conf >= 70 ? "medium" : "low";

                  return (
                    <div
                      key={cand.candidate_id}
                      className={`v2-candidate-card ${idx === 0 ? "top-rank" : ""}`}
                    >
                      <div className="v2-candidate-top">
                        <div>
                          <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>
                            ERP Candidate #{idx + 1}
                          </span>
                          <h4 style={{ margin: "2px 0 0 0", fontSize: 15, fontWeight: 800, color: "#0f172a" }}>
                            {cand.pr_record_id}
                          </h4>
                        </div>
                        <span className={`v2-confidence-pill ${pillClass}`}>
                          {conf}% Confidence
                        </span>
                      </div>

                      {/* Candidate Fields */}
                      <div className="v2-fields-grid">
                        <div className="v2-field-unit">
                          <label>Invoice Number</label>
                          <span className="v2-doc-num">{cand.pr_preview?.document_number || "—"}</span>
                        </div>
                        <div className="v2-field-unit">
                          <label>Invoice Date</label>
                          <span>{cand.pr_preview?.document_date || "—"}</span>
                        </div>
                        <div className="v2-field-unit">
                          <label>Taxable Amount</label>
                          <span className="v2-money-amt">
                            ₹{Number(cand.pr_preview?.taxable_value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                          </span>
                        </div>
                      </div>

                      {/* Deterministic Radar Breakdown */}
                      <div className="v2-score-radar">
                        <div className="v2-radar-col">
                          <span>Doc Sim</span>
                          <strong>{cand.score_breakdown.invoice_similarity}%</strong>
                        </div>
                        <div className="v2-radar-col">
                          <span>Amount</span>
                          <strong>{cand.score_breakdown.amount_score}%</strong>
                        </div>
                        <div className="v2-radar-col">
                          <span>Date</span>
                          <strong>{cand.score_breakdown.date_score}%</strong>
                        </div>
                        <div className="v2-radar-col">
                          <span>Tax</span>
                          <strong>{cand.score_breakdown.tax_score}%</strong>
                        </div>
                      </div>

                      {/* Detected Differences */}
                      {cand.detected_differences.length > 0 && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {cand.detected_differences.map((diff, dIdx) => (
                            <span key={dIdx} className="v2-diff-chip warn" style={{ fontSize: 11 }}>
                              {diff}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* AI Reason */}
                      <div className="v2-candidate-ai-reason">{cand.ai_reason}</div>

                      {/* Actions */}
                      <div className="v2-candidate-actions">
                        <button
                          type="button"
                          className="v2-btn-select-candidate"
                          onClick={() => handleResolveAmbiguity(selectedCluster.cluster_id, cand.candidate_id, "CHOOSE")}
                          disabled={isResolving}
                        >
                          <Check size={14} />
                          <span>Bind Candidate #{idx + 1}</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="v2-modal-footer">
              <button
                type="button"
                className="v2-btn-reject-all"
                onClick={() => handleResolveAmbiguity(selectedCluster.cluster_id, undefined, "REJECT")}
                disabled={isResolving}
              >
                Reject All Candidates (Leave Unmatched in 2B)
              </button>
              <span style={{ fontSize: 12, color: "#64748b" }}>
                Senior Tax Accountant Governance • Section 16(2)(aa) Verification
              </span>
            </div>
          </div>
        </div>
      )}

      {/* 6. BOTTOM ACTION BAR */}
      <ReconciliationV2ActionBar
        position="bottom"
        stageNumber={4}
        backLabel="Back to Rules Wiki Studio"
        onBack={onBackToRules}
        nextLabel="Proceed to Near-Match Review"
        onNext={onProceedToNearMatches}
        extraLeft={
          <div style={{ fontSize: 12.5, fontWeight: 600, color: "#64748b", display: "flex", alignItems: "center", gap: 6 }}>
            <Sparkles size={14} color="#00338d" />
            <span>Stage 4 of 8: Deterministic Reconciliation Matrix</span>
          </div>
        }
      />
    </div>
  );
};
