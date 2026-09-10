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
      console.error("Failed to load Stage 4 results:", err);
      // If error, try executing waterfall freshly
      try {
        const resp = await apiV2.executeStage4Results(sessionId);
        setData(resp);
      } catch (execErr: any) {
        setErrorMessage(execErr.message || "Failed to execute reconciliation waterfall.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleRerunWaterfall = async () => {
    setIsRerunning(true);
    setErrorMessage(null);
    try {
      const resp = await apiV2.executeStage4Results(sessionId);
      setData(resp);
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to rerun reconciliation waterfall.");
    } finally {
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

  if (isLoading) {
    return (
      <div className="v2-results-container">
        <div className="v2-processing-state-card" style={{ margin: "60px auto", maxWidth: 640 }}>
          <div className="v2-processing-header">
            <div className="v2-processing-spinner">
              <RefreshCw size={24} className="v2-spin text-blue-600" />
            </div>
            <div>
              <h4 className="v2-processing-title">Running 5-Pass Reconciliation Waterfall</h4>
              <p className="v2-processing-step">
                Evaluating exact statutory identities, applying enterprise tolerances, fuzzy normalization, and clustering multi-match collisions...
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
          <div className="v2-results-stage-tag">
            <Sparkles size={13} />
            <span>Stage 4 of 8 • Multi-Pass Reconciliation Matrix</span>
          </div>
          <h2 className="v2-results-hero-title">Deterministic Match Matrix & Ambiguity Hub</h2>
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

      {/* 2. EXECUTIVE 6-CARD KPI HUD */}
      {summary && (
        <div className="v2-kpi-hud-grid">
          {/* Card 1: Overall Reconciliation Rate */}
          <div
            className={`v2-kpi-card hero ${activeTab === "ALL" ? "is-active" : ""}`}
            onClick={() => setActiveTab("ALL")}
          >
            <div className="v2-kpi-top">
              <span className="v2-kpi-label">Reconciliation Rate</span>
              <div className="v2-kpi-glyph">
                <TrendingUp size={16} />
              </div>
            </div>
            <div className="v2-kpi-value-row">
              <span className="v2-kpi-value">{summary.overall_reconciliation_rate}%</span>
              <span className="v2-kpi-unit">matched</span>
            </div>
            <div className="v2-kpi-subtext">
              <span>Total Reconciled:</span>
              <strong>{(summary.total_reconciled_count || 0).toLocaleString()} rows</strong>
            </div>
            <div className="v2-kpi-subtext">
              <span>Matched ITC:</span>
              <strong>₹{summary.total_reconciled_itc.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</strong>
            </div>
          </div>

          {/* Card 2: Pass 1 Exact Matches */}
          <div
            className={`v2-kpi-card exact ${activeTab === "EXACT_MATCH" ? "is-active" : ""}`}
            onClick={() => setActiveTab("EXACT_MATCH")}
          >
            <div className="v2-kpi-top">
              <span className="v2-kpi-label">Exact Matches</span>
              <div className="v2-kpi-glyph">
                <CheckCircle2 size={16} />
              </div>
            </div>
            <div className="v2-kpi-value-row">
              <span className="v2-kpi-value">{(summary.exact_match_count || 0).toLocaleString()}</span>
              <span className="v2-kpi-unit">rows</span>
            </div>
            <div className="v2-kpi-subtext">
              <span>Pass 1 (0 Tol):</span>
              <strong>
                {summary.total_gstr_rows > 0
                  ? ((summary.exact_match_count / summary.total_gstr_rows) * 100).toFixed(1)
                  : 0}
                %
              </strong>
            </div>
            <div className="v2-kpi-subtext">
              <span>ITC Value:</span>
              <strong>₹{summary.exact_match_itc.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</strong>
            </div>
          </div>

          {/* Card 3: Pass 2 Tolerance Matched */}
          <div
            className={`v2-kpi-card tolerance ${activeTab === "TOLERANCE_MATCH" ? "is-active" : ""}`}
            onClick={() => setActiveTab("TOLERANCE_MATCH")}
          >
            <div className="v2-kpi-top">
              <span className="v2-kpi-label">Tolerance Matched</span>
              <div className="v2-kpi-glyph">
                <Zap size={16} />
              </div>
            </div>
            <div className="v2-kpi-value-row">
              <span className="v2-kpi-value">{(summary.tolerance_match_count || 0).toLocaleString()}</span>
              <span className="v2-kpi-unit">rows</span>
            </div>
            <div className="v2-kpi-subtext">
              <span>Pass 2 (Stage 3):</span>
              <strong>
                {summary.total_gstr_rows > 0
                  ? ((summary.tolerance_match_count / summary.total_gstr_rows) * 100).toFixed(1)
                  : 0}
                %
              </strong>
            </div>
            <div className="v2-kpi-subtext">
              <span>ITC Value:</span>
              <strong>₹{summary.tolerance_match_itc.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</strong>
            </div>
          </div>

          {/* Card 4: Pass 3 Near Match */}
          <div
            className={`v2-kpi-card near ${activeTab === "NEAR_MATCH" ? "is-active" : ""}`}
            onClick={() => setActiveTab("NEAR_MATCH")}
          >
            <div className="v2-kpi-top">
              <span className="v2-kpi-label">Near Matches</span>
              <div className="v2-kpi-glyph">
                <Layers size={16} />
              </div>
            </div>
            <div className="v2-kpi-value-row">
              <span className="v2-kpi-value">{(summary.near_match_count || 0).toLocaleString()}</span>
              <span className="v2-kpi-unit">rows</span>
            </div>
            <div className="v2-kpi-subtext">
              <span>Pass 3 (Fuzzy):</span>
              <strong>
                {summary.total_gstr_rows > 0
                  ? ((summary.near_match_count / summary.total_gstr_rows) * 100).toFixed(1)
                  : 0}
                %
              </strong>
            </div>
            <div className="v2-kpi-subtext">
              <span>ITC Value:</span>
              <strong>₹{summary.near_match_itc.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</strong>
            </div>
          </div>

          {/* Card 5: Pass 4 Ambiguous (Quarantined) */}
          <div
            className={`v2-kpi-card ambiguous ${activeTab === "AMBIGUOUS" ? "is-active" : ""}`}
            onClick={() => setActiveTab("AMBIGUOUS")}
          >
            <div className="v2-kpi-top">
              <span className="v2-kpi-label">Ambiguous Multi</span>
              <div className="v2-kpi-glyph">
                <Split size={16} />
              </div>
            </div>
            <div className="v2-kpi-value-row">
              <span className="v2-kpi-value" style={{ color: "#d97706" }}>
                {(summary.ambiguous_count || 0).toLocaleString()}
              </span>
              <span className="v2-kpi-unit">cases</span>
            </div>
            <div className="v2-kpi-subtext">
              <span>Pass 4 (Collision):</span>
              <strong>Requires Review</strong>
            </div>
            <div className="v2-kpi-subtext">
              <span>At-Stake ITC:</span>
              <strong>₹{summary.ambiguous_itc.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</strong>
            </div>
          </div>

          {/* Card 6: Pass 5 Single-Sided Residuals */}
          <div
            className={`v2-kpi-card residual ${activeTab === "GSTR_ONLY" || activeTab === "PR_ONLY" ? "is-active" : ""}`}
            onClick={() => setActiveTab("GSTR_ONLY")}
          >
            <div className="v2-kpi-top">
              <span className="v2-kpi-label">Single-Sided</span>
              <div className="v2-kpi-glyph">
                <AlertTriangle size={16} />
              </div>
            </div>
            <div className="v2-kpi-value-row">
              <span className="v2-kpi-value" style={{ color: "#dc2626" }}>
                {((summary.gstr_only_count || 0) + (summary.pr_only_count || 0)).toLocaleString()}
              </span>
              <span className="v2-kpi-unit">unmatched</span>
            </div>
            <div className="v2-kpi-subtext">
              <span>In 2B Only:</span>
              <strong>{(summary.gstr_only_count || 0).toLocaleString()}</strong>
            </div>
            <div className="v2-kpi-subtext">
              <span>In Books Only:</span>
              <strong>{(summary.pr_only_count || 0).toLocaleString()}</strong>
            </div>
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
              Showing {filteredRecords.length.toLocaleString()} of {records.length.toLocaleString()} records
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
                filteredRecords.map((rec) => {
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
                                  </div>
                                </div>
                              </div>

                              {/* Variances Chip Bar */}
                              <div className="v2-variance-bar">
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                  <strong>Consensus Variances:</strong>
                                  <div className="v2-variance-chips">
                                    {rec.variances && Object.keys(rec.variances).length > 0 ? (
                                      Object.entries(rec.variances).map(([k, v]) => (
                                        <span
                                          key={k}
                                          className={`v2-diff-chip ${
                                            k.includes("diff") && Number(v) > 0 ? "warn" : ""
                                          }`}
                                        >
                                          {k.replace(/_/g, " ")}: <strong>{String(v)}</strong>
                                        </span>
                                      ))
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
