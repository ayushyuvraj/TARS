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
import { copilotV2Bridge } from "./copilot_v2_bridge";
import "./results_v2.css";
import "./reconciliation_v2.css";

interface ResultsStageProps {
  sessionId: string;
  onBackToRules: () => void;
  onProceedToSummary: () => void;
}

export const ReconciliationV2ResultsStage: React.FC<ResultsStageProps> = ({
  sessionId,
  onBackToRules,
  onProceedToSummary,
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
  const [isWaterfallExpanded, setIsWaterfallExpanded] = useState<boolean>(false);

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
      const elapsed = Date.now() - startTime;
      setExecElapsedMs(elapsed);
      const pass = Math.min(5, Math.floor(elapsed / 800) + 1);
      setExecPass(pass);
    }, 100);

    try {
      const resp = await apiV2.executeStage4Results(sessionId);
      setData(resp);
      setExecPass(5);
      await new Promise((r) => setTimeout(r, 350));
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to run reconciliation waterfall.");
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

  // Synchronize Stage 4 results & selected record to Copilot Bridge
  useEffect(() => {
    if (data && data.summary) {
      const rec = expandedRowId ? data.records?.find((r) => r.id === expandedRowId) : null;
      copilotV2Bridge.setContext({
        resultsSummary: {
          exact: data.summary.exact_match_count || 0,
          tolerance: data.summary.tolerance_match_count || 0,
          nearMatch: data.summary.near_match_count || 0,
          unresolved: (data.summary.pr_only_count || 0) + (data.summary.gstr_only_count || 0),
        },
        selectedRecordId: expandedRowId,
        selectedRecordData: rec ? (rec as any) : null,
      });
    }
  }, [data, expandedRowId]);

  // Register RUN_RECONCILIATION handler for Results stage
  useEffect(() => {
    return copilotV2Bridge.registerActionHandler("RUN_RECONCILIATION", () => {
      void handleRerunWaterfall();
    });
  }, []);

  const fallbackSummary: Stage4ResultsSummary = {
    total_gstr_rows: 0,
    total_pr_rows: 0,
    exact_match_count: 0,
    exact_match_itc: 0,
    tolerance_match_count: 0,
    tolerance_match_itc: 0,
    near_match_count: 0,
    near_match_itc: 0,
    ambiguous_count: 0,
    ambiguous_itc: 0,
    gstr_only_count: 0,
    gstr_only_itc: 0,
    pr_only_count: 0,
    pr_only_itc: 0,
    total_reconciled_count: 0,
    total_reconciled_itc: 0,
    overall_reconciliation_rate: 0,
    waterfall_passes: [
      { tier: 1, name: "Exact Statutory Identity", matched_count: 0, retention_percentage: 0, matched_itc: 0 },
      { tier: 2, name: "Enterprise Tolerances", matched_count: 0, retention_percentage: 0, matched_itc: 0 },
      { tier: 3, name: "Semantic Near-Matching", matched_count: 0, retention_percentage: 0, matched_itc: 0 },
      { tier: 4, name: "Ambiguity Clustering", matched_count: 0, retention_percentage: 0, matched_itc: 0 },
      { tier: 5, name: "Single-Sided Residuals", matched_count: 0, retention_percentage: 0, matched_itc: 0 },
    ],
  };

  const summary = data?.summary || fallbackSummary;
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



  return (
    <div className="v2-results-container">
      {/* 1. HERO BANNER */}
      <div className="v2-results-hero">
        {onBackToRules && (
          <div className="v2-hero-nav-left">
            <button
              type="button"
              className="v2-hero-btn-back"
              onClick={onBackToRules}
              title="Return to Stage 3: Reconciliation Rules"
              aria-label="Back to previous screen"
            >
              <ArrowLeft size={15} />
              <span>Back to Rules</span>
            </button>
          </div>
        )}

        <div className="v2-results-hero-content">
          <div className="v2-results-hero-title-row">
            <h2 className="v2-results-hero-title">Deterministic Match Matrix &amp; Ambiguity Hub</h2>
            <div className="v2-results-stage-tag">
              <Sparkles size={12} />
              <span>Stage 4 of 6 • Multi-Pass Reconciliation Matrix</span>
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
            title={!data ? "Execute 5-pass reconciliation engine across both workbooks" : "Re-run reconciliation waterfall with active rules"}
          >
            {isRerunning ? (
              <>
                <RefreshCw size={14} className="v2-spin" />
                <span>Reconciling...</span>
              </>
            ) : !data ? (
              <>
                <Play size={14} fill="currentColor" />
                <span>Reconcile</span>
              </>
            ) : (
              <>
                <RefreshCw size={14} />
                <span>Rerun Reconciliation</span>
              </>
            )}
          </button>
          <button
            type="button"
            className="v2-btn-primary-action"
            onClick={onProceedToSummary}
            disabled={!data || isRerunning}
            title={!data ? "Please run reconciliation to proceed to Summary Dashboard" : "Proceed to Stage 5: Summary Dashboard"}
            style={!data || isRerunning ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
          >
            <span>Proceed to Summary Dashboard</span>
            <ArrowRight size={14} />
          </button>
        </div>
      </div>

      {errorMessage && (
        <div className="v2-alert-error" style={{ margin: "16px 0 0 0" }}>
          <AlertCircle size={16} />
          <span>{errorMessage}</span>
        </div>
      )}

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
        <div className={`v2-waterfall-funnel-card ${isWaterfallExpanded ? "is-expanded" : "is-collapsed"}`}>
          <div
            className="v2-funnel-header"
            onClick={() => setIsWaterfallExpanded(!isWaterfallExpanded)}
            role="button"
            tabIndex={0}
            aria-expanded={isWaterfallExpanded}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setIsWaterfallExpanded(!isWaterfallExpanded);
              }
            }}
          >
            <div className="v2-funnel-title-row">
              <Layers size={18} color="#00338d" />
              <div>
                <h3>Progressive Elimination Waterfall Flow</h3>
                <span className="v2-funnel-subtitle">
                  Visualizing multi-pass ledger retention across the 5 statutory matching tiers
                </span>
              </div>
            </div>

            <div className="v2-funnel-toggle-wrap">
              <button
                type="button"
                className="v2-funnel-toggle-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsWaterfallExpanded(!isWaterfallExpanded);
                }}
              >
                <span>{isWaterfallExpanded ? "Hide Flow" : "View Flow"}</span>
                <ChevronDown
                  size={15}
                  className={`v2-funnel-chevron ${isWaterfallExpanded ? "is-rotated" : ""}`}
                />
              </button>
            </div>
          </div>

          {isWaterfallExpanded && (
            <div className="v2-funnel-tiers-track v2-funnel-animated-content">
              {summary.waterfall_passes.map((pass) => (
                <div
                  key={pass.tier}
                  className={`v2-funnel-tier-item tier-${pass.tier}`}
                  onClick={(e) => {
                    e.stopPropagation();
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
          )}
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
                    {!data ? (
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "28px 20px" }}>
                        <div style={{ width: 44, height: 44, borderRadius: 12, background: "rgba(2, 132, 199, 0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <Play size={22} style={{ color: "#0284c7" }} fill="#0284c7" />
                        </div>
                        <span style={{ fontSize: 15, fontWeight: 700, color: "#0f172a" }}>
                          Reconciliation Engine Ready to Execute
                        </span>
                        <span style={{ fontSize: 12.5, color: "#64748b", maxWidth: 480, textAlign: "center", lineHeight: 1.5 }}>
                          Your dual workbooks and statutory matching policies are frozen. Click <strong>"Reconcile"</strong> in the top hero banner to run the 5-pass progressive elimination waterfall.
                        </span>
                      </div>
                    ) : (
                      "No records found matching current tab filter and search query."
                    )}
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
                          {rec.reclassified_from && (
                            <span
                              className="v2-reclassified-pill"
                              title={rec.reclassification_note || `Reclassified from ${rec.reclassified_from} via Reviewer Resolution`}
                            >
                              <Split size={10} /> From Ambiguous
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
                          <span className="v2-pass-tag">{rec.matched_by_pass || rec.bucket}</span>
                        </td>
                        <td style={{ textAlign: "center" }}>
                          {rec.bucket === "AMBIGUOUS" ? (
                            <button
                              type="button"
                              className="v2-btn-resolve-trigger"
                              onClick={(e) => {
                                e.stopPropagation();
                                const cluster = ambiguities.find((a) => a.cluster_id === rec.ambiguity_cluster_id);
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
                              {/* Audit Lifecycle Provenance Banner (if reclassified from Ambiguous) */}
                              {rec.reclassified_from && (
                                <div className="v2-reclassification-provenance-banner">
                                  <div className="v2-provenance-icon-wrap">
                                    <Split size={14} color="#b45309" />
                                  </div>
                                  <div className="v2-provenance-content">
                                    <div className="v2-provenance-title">
                                      <span>Audit Provenance Trace</span>
                                      <span className="v2-provenance-badge">Human-in-the-Loop Disambiguation</span>
                                    </div>
                                    <p className="v2-provenance-text">
                                      {rec.reclassification_note ||
                                        `Originally quarantined in Ambiguous Collisions (Pass 4). Following senior reviewer resolution, this record was re-evaluated against Stage 3 reconciliation conditions and transitioned into ${rec.bucket}.`}
                                    </p>
                                  </div>
                                </div>
                              )}

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

      {/* 5-PASS DYNAMIC RECONCILIATION MODAL HUD (Matching Stage 1) */}
      {isRerunning && (
        <div className="v2-cot-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="v2-reconcile-modal-title">
          <div className="v2-cot-modal-shell" style={{ maxWidth: 880 }}>
            <div className="v2-cot-modal-core">
              <div className="v2-cot-header">
                <div className="v2-cot-title-row">
                  <span className="v2-status-dot-pulse" />
                  <span id="v2-reconcile-modal-title" className="v2-cot-title">
                    Autonomous 5-Pass Reconciliation Waterfall Engine
                  </span>
                </div>
                <span className="v2-cot-timer">{(execElapsedMs / 1000).toFixed(1)}s elapsed</span>
              </div>

              <p className="v2-cot-modal-sub">
                Progressively eliminating dual-ledger variance across 5 statutory, enterprise, and near-match passes...
              </p>

              {/* 5-Pass Telemetry Stepper Visualizer Grid */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
                  gap: 8,
                  marginTop: 6,
                }}
              >
                {WATERFALL_STEPS.map((step) => {
                  const isPast = step.tier < execPass;
                  const isCurrent = step.tier === execPass;
                  const status = isPast ? "completed" : isCurrent ? "running" : "pending";
                  return (
                    <div
                      key={step.tier}
                      className={`v2-cot-step-tile is-${status}`}
                      style={{
                        padding: "10px 8px",
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                        minHeight: 120,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 4 }}>
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 800,
                            letterSpacing: "0.05em",
                            color: isCurrent ? "#72cdf4" : isPast ? "#34d399" : "#64748b",
                          }}
                        >
                          PASS 0{step.tier}
                        </span>
                        <div className="v2-cot-step-icon" style={{ margin: 0, width: 20, height: 20 }}>
                          {isPast ? (
                            <CheckCircle2 size={14} className="v2-step-check" />
                          ) : isCurrent ? (
                            <RefreshCw size={13} className="v2-spin text-blue-400" />
                          ) : (
                            <span style={{ fontSize: 10, color: "#64748b" }}>{step.tier}</span>
                          )}
                        </div>
                      </div>

                      <div>
                        <div
                          style={{
                            fontSize: 11.5,
                            fontWeight: 700,
                            color: isCurrent ? "#ffffff" : isPast ? "#f1f5f9" : "#94a3b8",
                            lineHeight: 1.3,
                            marginBottom: 4,
                          }}
                        >
                          {step.name.split(":")[1]?.trim() || step.name}
                        </div>
                        <p
                          style={{
                            fontSize: 10,
                            color: isCurrent ? "#cbd5e1" : "#64748b",
                            lineHeight: 1.35,
                            margin: 0,
                          }}
                        >
                          {step.desc}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Bottom Micro-Progress Bar */}
              <div className="v2-cot-progress-track" style={{ marginTop: 8 }}>
                <div
                  className="v2-cot-progress-fill"
                  style={{
                    width: `${Math.min(100, Math.max(10, (execPass / 5) * 100))}%`,
                    transition: "width 0.35s ease",
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 6. BOTTOM ACTION BAR */}
      <ReconciliationV2ActionBar
        position="bottom"
        stageNumber={4}
        backLabel="Back to Stage 3 Rules"
        onBack={onBackToRules}
        nextLabel="Proceed to Summary Dashboard"
        onNext={onProceedToSummary}
        nextDisabled={!data || isRerunning}
        extraLeft={
          <div style={{ fontSize: 12.5, fontWeight: 600, color: "#64748b", display: "flex", alignItems: "center", gap: 6 }}>
            <Sparkles size={14} color="#00338d" />
            <span>Stage 4 of 6: Deterministic Reconciliation Matrix</span>
          </div>
        }
      />
    </div>
  );
};
