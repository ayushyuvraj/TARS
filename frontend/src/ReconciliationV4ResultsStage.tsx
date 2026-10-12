import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  CheckCircle2,
  AlertCircle,
  Sparkles,
  ArrowRight,
  ArrowLeft,
  RefreshCw,
  Search,
  ChevronDown,
  ChevronUp,
  X,
  Layers,
  Zap,
  AlertTriangle,
  Split,
  Play,
  ShieldCheck,
  Calendar,
  Landmark,
  Hash,
  Sliders,
  Filter,
  Scale,
  Clock,
} from "lucide-react";
import {
  apiV2,
  Stage4ExecutionResponse,
  Stage4ResultsSummary,
  ReconciliationRecordItem,
  AmbiguityCluster,
  AmbiguityRecommendation,
} from "./api_v2";
import { copilotV2Bridge } from "./copilot_v2_bridge";
import "./results_v2.css";
import "./reconciliation_v2.css";
import "./results_v4.css";

interface ResultsStageProps {
  sessionId: string;
  isReadOnly?: boolean;
  onBackToRules: () => void;
  onProceedToSummary: () => void;
}

export const ReconciliationV4ResultsStage: React.FC<ResultsStageProps> = ({
  sessionId,
  isReadOnly = false,
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
  const [activeRuleFilter, setActiveRuleFilter] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);

  // Ambiguity Resolution Modal
  const [selectedCluster, setSelectedCluster] = useState<AmbiguityCluster | null>(null);
  const [isResolving, setIsResolving] = useState<boolean>(false);

  // Ambiguity Manual Classification Modal
  const [selectedAmbiguousRecord, setSelectedAmbiguousRecord] = useState<ReconciliationRecordItem | null>(null);
  const [recommendation, setRecommendation] = useState<AmbiguityRecommendation | null>(null);
  const [isLoadingRecommendation, setIsLoadingRecommendation] = useState<boolean>(false);
  const [targetBucket, setTargetBucket] = useState<string>("EXACT_MATCH");
  const [reviewerNote, setReviewerNote] = useState<string>("");
  const [isReclassifying, setIsReclassifying] = useState<boolean>(false);

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
      // Results not run yet. Show launchpad
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

  const handleOpenReclassifyModal = async (rec: ReconciliationRecordItem) => {
    setSelectedAmbiguousRecord(rec);
    setIsLoadingRecommendation(true);
    setReviewerNote("");
    try {
      const recId = rec.id || String(rec.gstr_row_index ?? 0);
      const recResp = await apiV2.getRecordRecommendation(sessionId, recId, rec);
      setRecommendation(recResp);
      setTargetBucket(recResp.recommended_bucket || "EXACT_MATCH");
    } catch (err: any) {
      console.warn("Failed to fetch recommendation:", err);
      setRecommendation(null);
      setTargetBucket("EXACT_MATCH");
    } finally {
      setIsLoadingRecommendation(false);
    }
  };

  const handleConfirmReclassification = async (chosenBucketOverride?: string) => {
    if (!selectedAmbiguousRecord) return;
    const bucketToPost = chosenBucketOverride || targetBucket;
    setIsReclassifying(true);
    try {
      const recId = selectedAmbiguousRecord.id || String(selectedAmbiguousRecord.gstr_row_index ?? 0);
      const policyInfo = recommendation?.category_policies?.[bucketToPost];
      const autoNote = reviewerNote.trim() || `Classified as ${bucketToPost}. ${policyInfo?.message || ""}`;

      const updated = await apiV2.reclassifyRecord(sessionId, recId, {
        target_bucket: bucketToPost,
        reviewer_note: autoNote,
        override_policy: policyInfo?.verdict === "NOT_OKAY",
      });

      setData(updated);
      setSelectedAmbiguousRecord(null);
      setRecommendation(null);
    } catch (err: any) {
      console.error(err);
    } finally {
      setIsReclassifying(false);
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
      { tier: 2, name: "Enterprise Tolerances & Cross-FY", matched_count: 0, retention_percentage: 0, matched_itc: 0 },
      { tier: 3, name: "Semantic Near-Matching", matched_count: 0, retention_percentage: 0, matched_itc: 0 },
      { tier: 4, name: "Statutory Discrepancies & Batches", matched_count: 0, retention_percentage: 0, matched_itc: 0 },
      { tier: 5, name: "Single-Sided Residuals", matched_count: 0, retention_percentage: 0, matched_itc: 0 },
    ],
  };

  const summary = data?.summary || fallbackSummary;
  const records = data?.records || [];
  const ambiguities = data?.ambiguities || [];
  const comparedColumns = data?.compared_columns || [];

  // Compute or extract rule-level breakdown counts
  const ruleCounts = useMemo(() => {
    const b = summary.rule_breakdown || {};
    // If not present in summary, derive from sample records
    const counts = {
      INELIGIBLE_ITC_17_5: b.INELIGIBLE_ITC_17_5 ?? summary.ineligible_itc_matches ?? 0,
      CROSS_FY_TIMING: b.CROSS_FY_TIMING ?? 0,
      DATE_OPERATIONAL_SHIFT: b.DATE_OPERATIONAL_SHIFT ?? 0,
      BANKING_MULTI_TRANCHE: b.BANKING_MULTI_TRANCHE ?? summary.consolidated_matches ?? 0,
      DOC_PREFIX_NORMALIZED: b.DOC_PREFIX_NORMALIZED ?? 0,
      COMPOUND_DOC_DATE_VARIATION: b.COMPOUND_DOC_DATE_VARIATION ?? 0,
      COMMERCIAL_TOLERANCE: b.COMMERCIAL_TOLERANCE ?? 0,
      EXACT_ZERO_VARIANCE: b.EXACT_ZERO_VARIANCE ?? summary.exact_match_count ?? 0,
      AMBIGUOUS_COLLISION: b.AMBIGUOUS_COLLISION ?? summary.ambiguous_count ?? 0,
    };
    if (counts.CROSS_FY_TIMING === 0 && records.length > 0) {
      for (const r of records) {
        if (r.sub_classification === "CROSS_FY_TIMING") counts.CROSS_FY_TIMING++;
        if (r.sub_classification === "DATE_OPERATIONAL_SHIFT") counts.DATE_OPERATIONAL_SHIFT++;
        if (r.sub_classification === "DOC_PREFIX_NORMALIZED") counts.DOC_PREFIX_NORMALIZED++;
        if (r.sub_classification === "COMPOUND_DOC_DATE_VARIATION") counts.COMPOUND_DOC_DATE_VARIATION++;
        if (r.sub_classification === "INELIGIBLE_ITC_17_5" && !counts.INELIGIBLE_ITC_17_5) counts.INELIGIBLE_ITC_17_5++;
        if (r.sub_classification === "BANKING_MULTI_TRANCHE" && !counts.BANKING_MULTI_TRANCHE) counts.BANKING_MULTI_TRANCHE++;
        if (r.sub_classification === "COMMERCIAL_TOLERANCE" && !counts.COMMERCIAL_TOLERANCE) counts.COMMERCIAL_TOLERANCE++;
      }
    }
    return counts;
  }, [summary, records]);

  // Filtered records
  const filteredRecords = useMemo(() => {
    return records.filter((rec) => {
      // 1. Rule-Level Filter
      if (activeRuleFilter) {
        if (activeRuleFilter === "EXACT_ZERO_VARIANCE") {
          if (rec.bucket !== "EXACT_MATCH" && rec.sub_classification !== "EXACT_ZERO_VARIANCE") return false;
        } else if (activeRuleFilter === "AMBIGUOUS_COLLISION") {
          if (rec.bucket !== "AMBIGUOUS" && rec.sub_classification !== "AMBIGUOUS_COLLISION") return false;
        } else if (activeRuleFilter === "GST_ONLY") {
          if (rec.bucket !== "GSTR_ONLY") return false;
        } else if (activeRuleFilter === "PR_ONLY") {
          if (rec.bucket !== "PR_ONLY") return false;
        } else if (rec.sub_classification !== activeRuleFilter) {
          // Special fallback check for verdict names
          if (activeRuleFilter === "INELIGIBLE_ITC_17_5" && rec.tars_verdict?.includes("17(5)")) {
            // Keep
          } else if (activeRuleFilter === "BANKING_MULTI_TRANCHE" && rec.tars_verdict?.includes("Consolidated")) {
            // Keep
          } else {
            return false;
          }
        }
      }

      // 2. Tab Filter
      if (activeTab === "EXACT_MATCH" && rec.bucket !== "EXACT_MATCH") return false;
      if (activeTab === "TOLERANCE_MATCH" && rec.bucket !== "TOLERANCE_MATCH") return false;
      if (activeTab === "NEAR_MATCH" && rec.bucket !== "NEAR_MATCH") return false;
      if (activeTab === "AMBIGUOUS" && rec.bucket !== "AMBIGUOUS") return false;
      if (activeTab === "RESIDUALS" && rec.bucket !== "GSTR_ONLY" && rec.bucket !== "PR_ONLY") return false;
      if (activeTab === "GSTR_ONLY" && rec.bucket !== "GSTR_ONLY") return false;
      if (activeTab === "PR_ONLY" && rec.bucket !== "PR_ONLY") return false;

      // 3. Search Filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const gstinMatch = rec.gstin?.toLowerCase().includes(q);
        const docMatch = rec.document_number?.toLowerCase().includes(q);
        const reasonMatch = rec.classification_reason?.toLowerCase().includes(q);
        const gstrPreview = JSON.stringify(rec.gstr_preview).toLowerCase();
        const prPreview = JSON.stringify(rec.pr_preview).toLowerCase();
        if (!gstinMatch && !docMatch && !reasonMatch && !gstrPreview.includes(q) && !prPreview.includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [records, activeTab, activeRuleFilter, searchQuery]);

  // Total records base for calculating percentages
  const totalRows = useMemo(() => {
    return summary.total_gstr_rows || records.length || 1;
  }, [summary, records]);

  // Subtle percentage calculator across total records
  const calcPct = useCallback(
    (cnt: number) => (totalRows > 0 ? ((cnt / totalRows) * 100).toFixed(1) : "0.0"),
    [totalRows]
  );

  interface FilterItem {
    id: string;
    name: string;
    icon: React.ReactNode;
    className: string;
    passKey: string;
    passTier: number;
    count: number;
    pct: string;
  }

  const allFilterItems: FilterItem[] = useMemo(() => {
    return [
      // Pass 1: Exact Match
      {
        id: "EXACT_ZERO_VARIANCE",
        name: "Exact Match",
        icon: <CheckCircle2 size={13} />,
        className: "exact-stat",
        passKey: "EXACT_MATCH",
        passTier: 1,
        count: summary.exact_match_count || ruleCounts.EXACT_ZERO_VARIANCE || 0,
        pct: calcPct(summary.exact_match_count || ruleCounts.EXACT_ZERO_VARIANCE || 0),
      },
      // Pass 2: Tolerance Matches
      {
        id: "COMMERCIAL_TOLERANCE",
        name: "Commercial Tolerance",
        icon: <Scale size={13} />,
        className: "comm-tol",
        passKey: "TOLERANCE_MATCH",
        passTier: 2,
        count: ruleCounts.COMMERCIAL_TOLERANCE || 0,
        pct: calcPct(ruleCounts.COMMERCIAL_TOLERANCE || 0),
      },
      {
        id: "INELIGIBLE_ITC_17_5",
        name: "Sec 17(5) Ineligible ITC",
        icon: <ShieldCheck size={13} />,
        className: "sec-17-5",
        passKey: "TOLERANCE_MATCH",
        passTier: 2,
        count: ruleCounts.INELIGIBLE_ITC_17_5 || 0,
        pct: calcPct(ruleCounts.INELIGIBLE_ITC_17_5 || 0),
      },
      {
        id: "CROSS_FY_TIMING",
        name: "Cross-FY (March/April)",
        icon: <Calendar size={13} />,
        className: "cross-fy",
        passKey: "TOLERANCE_MATCH",
        passTier: 2,
        count: ruleCounts.CROSS_FY_TIMING || 0,
        pct: calcPct(ruleCounts.CROSS_FY_TIMING || 0),
      },
      {
        id: "DATE_OPERATIONAL_SHIFT",
        name: "Date Proximity (±30d)",
        icon: <Clock size={13} />,
        className: "date-prox",
        passKey: "TOLERANCE_MATCH",
        passTier: 2,
        count: ruleCounts.DATE_OPERATIONAL_SHIFT || 0,
        pct: calcPct(ruleCounts.DATE_OPERATIONAL_SHIFT || 0),
      },
      {
        id: "BANKING_MULTI_TRANCHE",
        name: "Banking Tranches (N:1)",
        icon: <Landmark size={13} />,
        className: "banking",
        passKey: "TOLERANCE_MATCH",
        passTier: 2,
        count: ruleCounts.BANKING_MULTI_TRANCHE || 0,
        pct: calcPct(ruleCounts.BANKING_MULTI_TRANCHE || 0),
      },
      // Pass 3: Near Matches
      {
        id: "DOC_PREFIX_NORMALIZED",
        name: "Prefix Normalization",
        icon: <Hash size={13} />,
        className: "prefix",
        passKey: "NEAR_MATCH",
        passTier: 3,
        count: ruleCounts.DOC_PREFIX_NORMALIZED || 0,
        pct: calcPct(ruleCounts.DOC_PREFIX_NORMALIZED || 0),
      },
      {
        id: "COMPOUND_DOC_DATE_VARIATION",
        name: "Compound Variation",
        icon: <Zap size={13} />,
        className: "compound",
        passKey: "NEAR_MATCH",
        passTier: 3,
        count: ruleCounts.COMPOUND_DOC_DATE_VARIATION || 0,
        pct: calcPct(ruleCounts.COMPOUND_DOC_DATE_VARIATION || 0),
      },
      // Pass 4: Ambiguous
      {
        id: "AMBIGUOUS_COLLISION",
        name: "Multi-Candidate Ambiguity",
        icon: <Split size={13} />,
        className: "amb-col",
        passKey: "AMBIGUOUS",
        passTier: 4,
        count: summary.ambiguous_count || 0,
        pct: calcPct(summary.ambiguous_count || 0),
      },
      // Pass 5: GSTR-2B Only
      {
        id: "GST_ONLY",
        name: "GSTR 2B Only",
        icon: <AlertTriangle size={13} />,
        className: "gstr-only",
        passKey: "GSTR_ONLY",
        passTier: 5,
        count: summary.gstr_only_count || 0,
        pct: calcPct(summary.gstr_only_count || 0),
      },
      // Pass 5: PR Only
      {
        id: "PR_ONLY",
        name: "PR Only",
        icon: <AlertCircle size={13} />,
        className: "pr-only",
        passKey: "PR_ONLY",
        passTier: 5,
        count: summary.pr_only_count || 0,
        pct: calcPct(summary.pr_only_count || 0),
      },
    ];
  }, [summary, ruleCounts, totalRows, calcPct]);

  // Derive visible filter chips according to active pass / tab
  const visibleFilterItems = useMemo(() => {
    if (activeTab === "EXACT_MATCH") {
      return allFilterItems.filter((item) => item.passKey === "EXACT_MATCH");
    }
    if (activeTab === "TOLERANCE_MATCH") {
      return allFilterItems.filter((item) => item.passKey === "TOLERANCE_MATCH");
    }
    if (activeTab === "NEAR_MATCH") {
      return allFilterItems.filter((item) => item.passKey === "NEAR_MATCH");
    }
    if (activeTab === "AMBIGUOUS") {
      return allFilterItems.filter((item) => item.passKey === "AMBIGUOUS");
    }
    if (activeTab === "RESIDUALS") {
      return allFilterItems.filter((item) => item.passKey === "GSTR_ONLY" || item.passKey === "PR_ONLY");
    }
    if (activeTab === "GSTR_ONLY") {
      return allFilterItems.filter((item) => item.passKey === "GSTR_ONLY");
    }
    if (activeTab === "PR_ONLY") {
      return allFilterItems.filter((item) => item.passKey === "PR_ONLY");
    }
    return allFilterItems;
  }, [allFilterItems, activeTab]);

  // Pagination state
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(50);

  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, activeRuleFilter, searchQuery, pageSize]);

  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / pageSize));

  const paginatedRecords = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredRecords.slice(start, start + pageSize);
  }, [filteredRecords, currentPage, pageSize]);

  // Tab counts
  const tabCounts = useMemo(() => {
    if (summary && summary.total_gstr_rows) {
      return {
        ALL: summary.total_gstr_rows,
        EXACT_MATCH: summary.exact_match_count || 0,
        TOLERANCE_MATCH: summary.tolerance_match_count || 0,
        NEAR_MATCH: summary.near_match_count || 0,
        AMBIGUOUS: summary.ambiguous_count || 0,
        RESIDUALS: (summary.gstr_only_count || 0) + (summary.pr_only_count || 0),
        GSTR_ONLY: summary.gstr_only_count || 0,
        PR_ONLY: summary.pr_only_count || 0,
      };
    }
    const counts = {
      ALL: records.length,
      EXACT_MATCH: 0,
      TOLERANCE_MATCH: 0,
      NEAR_MATCH: 0,
      AMBIGUOUS: 0,
      RESIDUALS: 0,
      GSTR_ONLY: 0,
      PR_ONLY: 0,
    };
    for (const r of records) {
      if (r.bucket in counts) {
        counts[r.bucket as keyof typeof counts]++;
      }
      if (r.bucket === "GSTR_ONLY" || r.bucket === "PR_ONLY") {
        counts.RESIDUALS++;
      }
    }
    return counts;
  }, [records, summary]);

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
            <h2 className="v2-results-hero-title">Deterministic Match Matrix &amp; Ambiguity Hub (Recon 4.0)</h2>
            <div className="v2-results-stage-tag">
              <Sparkles size={12} />
              <span>Stage 4 of 6 • Multi-Pass Reconciliation Matrix • KPMG Client Rules Active</span>
            </div>
          </div>
          <p className="v2-results-hero-desc">
            Dual-ledger progressive elimination executed across 5 statutory passes: zero-tolerance identity,
            configured numerical tolerances, Section 17(5) blocked credit segregation, Cross-FY boundaries, and multi-tranche batching.
          </p>
        </div>
        <div className="v2-results-hero-actions">
          <button
            type="button"
            className="v2-btn-rerun"
            onClick={handleRerunWaterfall}
            disabled={isRerunning}
            title={!data ? "Execute reconciliation engine across single-ledger workbook" : "Re-run reconciliation waterfall with active rules"}
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



      {/* 3. EXECUTIVE 6-CATEGORY SUMMARY HUD (TIER 1 MACRO PASSES - COMPACT SENIORITY) */}
      {summary && (
        <div className="v4-kpi-hud-grid">
          {/* Box 1: Exact Matches */}
          <div
            className={`v4-kpi-card exact ${activeTab === "EXACT_MATCH" && !activeRuleFilter ? "is-active" : ""}`}
            onClick={() => {
              setActiveTab("EXACT_MATCH");
              setActiveRuleFilter(null);
            }}
            title="Pass 1 • Highest Seniority • Exact Match (Zero Variance)"
          >
            <div className="v4-kpi-top">
              <div className="v4-kpi-title-wrap">
                <span className="v4-kpi-seniority">PASS 1</span>
                <span className="v4-kpi-label">Exact Match</span>
              </div>
              <div className="v4-kpi-glyph">
                <CheckCircle2 size={13} />
              </div>
            </div>
            <div className="v4-kpi-value-row">
              <span className="v4-kpi-value">{(summary.exact_match_count || 0).toLocaleString()}</span>
              <span className="v4-kpi-pct-badge">{calcPct(summary.exact_match_count || 0)}%</span>
            </div>
          </div>

          {/* Box 2: Tolerance Matched */}
          <div
            className={`v4-kpi-card tolerance ${activeTab === "TOLERANCE_MATCH" && !activeRuleFilter ? "is-active" : ""}`}
            onClick={() => {
              setActiveTab("TOLERANCE_MATCH");
              setActiveRuleFilter(null);
            }}
            title="Pass 2 • Seniority 2 • Tolerance Match (Margin Bounds)"
          >
            <div className="v4-kpi-top">
              <div className="v4-kpi-title-wrap">
                <span className="v4-kpi-seniority">PASS 2</span>
                <span className="v4-kpi-label">Tolerance Match</span>
              </div>
              <div className="v4-kpi-glyph">
                <Zap size={13} />
              </div>
            </div>
            <div className="v4-kpi-value-row">
              <span className="v4-kpi-value">{(summary.tolerance_match_count || 0).toLocaleString()}</span>
              <span className="v4-kpi-pct-badge">{calcPct(summary.tolerance_match_count || 0)}%</span>
            </div>
          </div>

          {/* Box 3: Near Matches */}
          <div
            className={`v4-kpi-card near ${activeTab === "NEAR_MATCH" && !activeRuleFilter ? "is-active" : ""}`}
            onClick={() => {
              setActiveTab("NEAR_MATCH");
              setActiveRuleFilter(null);
            }}
            title="Pass 3 • Seniority 3 • Near Match (Normalized Ref)"
          >
            <div className="v4-kpi-top">
              <div className="v4-kpi-title-wrap">
                <span className="v4-kpi-seniority">PASS 3</span>
                <span className="v4-kpi-label">Near Match</span>
              </div>
              <div className="v4-kpi-glyph">
                <Layers size={13} />
              </div>
            </div>
            <div className="v4-kpi-value-row">
              <span className="v4-kpi-value">{(summary.near_match_count || 0).toLocaleString()}</span>
              <span className="v4-kpi-pct-badge">{calcPct(summary.near_match_count || 0)}%</span>
            </div>
          </div>

          {/* Box 4: Ambiguous Multi */}
          <div
            className={`v4-kpi-card ambiguous ${activeTab === "AMBIGUOUS" && !activeRuleFilter ? "is-active" : ""}`}
            onClick={() => {
              setActiveTab("AMBIGUOUS");
              setActiveRuleFilter(null);
            }}
            title="Pass 4 • Seniority 4 • Ambiguous Cases (Multi-Candidate)"
          >
            <div className="v4-kpi-top">
              <div className="v4-kpi-title-wrap">
                <span className="v4-kpi-seniority">PASS 4</span>
                <span className="v4-kpi-label">Ambiguous</span>
              </div>
              <div className="v4-kpi-glyph">
                <Split size={13} />
              </div>
            </div>
            <div className="v4-kpi-value-row">
              <span className="v4-kpi-value" style={{ color: "#b45309" }}>
                {(summary.ambiguous_count || 0).toLocaleString()}
              </span>
              <span className="v4-kpi-pct-badge">{calcPct(summary.ambiguous_count || 0)}%</span>
            </div>
          </div>

          {/* Box 5: Residuals (Pass 5) */}
          <div
            className={`v4-kpi-card residuals ${activeTab === "RESIDUALS" && !activeRuleFilter ? "is-active" : ""}`}
            onClick={() => {
              setActiveTab("RESIDUALS");
              setActiveRuleFilter(null);
            }}
            title="Pass 5 • Seniority 5 • Residuals (Single-Sided Unmatched Records)"
          >
            <div className="v4-kpi-top">
              <div className="v4-kpi-title-wrap">
                <span className="v4-kpi-seniority">PASS 5</span>
                <span className="v4-kpi-label">Residuals</span>
              </div>
              <div className="v4-kpi-glyph">
                <AlertTriangle size={13} />
              </div>
            </div>
            <div className="v4-kpi-value-row">
              <span className="v4-kpi-value" style={{ color: "#e11d48" }}>
                {((summary.gstr_only_count || 0) + (summary.pr_only_count || 0)).toLocaleString()}
              </span>
              <span className="v4-kpi-pct-badge">
                {calcPct((summary.gstr_only_count || 0) + (summary.pr_only_count || 0))}%
              </span>
            </div>
          </div>
        </div>
      )}

      {/* 4. FILTERS & PROGRESSIVE RETENTION STRIP */}
      {summary && (
        <div className="v4-rule-strip-card">
          <div className="v4-rule-strip-header">
            <div className="v4-rule-strip-title-group">
              <div className="v4-rule-strip-icon-box">
                <Sliders size={17} />
              </div>
              <div>
                <h4 className="v4-rule-strip-heading">
                  Filters
                  <span className="v4-rule-strip-badge">
                    {activeTab === "ALL"
                      ? "All Passes"
                      : activeTab === "EXACT_MATCH"
                      ? "Pass 1 Active"
                      : activeTab === "TOLERANCE_MATCH"
                      ? "Pass 2 Active"
                      : activeTab === "NEAR_MATCH"
                      ? "Pass 3 Active"
                      : activeTab === "AMBIGUOUS"
                      ? "Pass 4 Active"
                      : activeTab === "RESIDUALS"
                      ? "Pass 5 Active (Residuals)"
                      : activeTab === "GSTR_ONLY"
                      ? "Pass 5 (2B Only)"
                      : "Pass 5 (PR Only)"}
                  </span>
                </h4>
                <p className="v4-rule-strip-desc">
                  {activeTab === "ALL"
                    ? "Showing all statutory rule filters across passes. Click any filter chip to isolate specific audit scenarios."
                    : activeTab === "EXACT_MATCH"
                    ? "Showing filters applicable to Pass 1 (Exact Match • Zero Variance)."
                    : activeTab === "TOLERANCE_MATCH"
                    ? "Showing all filters applicable to Pass 2 (Tolerance Match • Margin Bounds & Statutory Scenarios)."
                    : activeTab === "NEAR_MATCH"
                    ? "Showing all filters applicable to Pass 3 (Near Match • Normalized Reference Variations)."
                    : activeTab === "AMBIGUOUS"
                    ? "Showing filters applicable to Pass 4 (Multi-Candidate Ambiguities & Collisions)."
                    : activeTab === "RESIDUALS"
                    ? "Showing Pass 5 single-sided residuals: GSTR 2B Only (Unclaimed Credit) and PR Only (Missing in 2B)."
                    : "Showing filters applicable to Pass 5 (Single-Sided Residuals & Unclaimed Credits)."}
                </p>
              </div>
            </div>

            <div className="v4-rule-strip-actions">
              <button
                type="button"
                className={`v4-rule-view-all-btn ${activeTab === "ALL" && !activeRuleFilter ? "is-active" : ""}`}
                onClick={() => {
                  setActiveTab("ALL");
                  setActiveRuleFilter(null);
                }}
                title="View all records across all statutory passes"
              >
                <span>View All ({(summary.total_gstr_rows || records.length).toLocaleString()})</span>
              </button>
            </div>
          </div>

          {/* Dynamic Rule & Pass Chips Grid */}
          <div className="v4-rule-chips-grid">
            {visibleFilterItems.map((item) => {
              const isActive = activeRuleFilter === item.id;
              return (
                <div
                  key={item.id}
                  className={`v4-rule-chip ${item.className} ${isActive ? "is-active" : ""}`}
                  onClick={() => {
                    setActiveRuleFilter(isActive ? null : item.id);
                  }}
                  title={`Click to filter table by ${item.name}`}
                >
                  <div className="v4-chip-top">
                    <div className="v4-chip-icon-box">{item.icon}</div>
                    <div className="v4-chip-metrics">
                      <span className="v4-chip-count">{item.count.toLocaleString()}</span>
                      <span className="v4-chip-pct">({item.pct}%)</span>
                    </div>
                  </div>
                  <div className="v4-chip-name">{item.name}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 6. RECONCILED LEDGER MATRIX TABLE */}
      <div className="v2-ledger-card">
        <div className="v2-ledger-toolbar">
          {/* Tabs Row */}
          <div className="v2-ledger-tabs-row">
            <button
              type="button"
              className={`v2-ledger-tab-btn ${activeTab === "ALL" && !activeRuleFilter ? "is-active" : ""}`}
              onClick={() => {
                setActiveTab("ALL");
                setActiveRuleFilter(null);
              }}
            >
              <span>All Ledger Records</span>
              <span className="v2-tab-count-pill">{tabCounts.ALL}</span>
            </button>
            <button
              type="button"
              className={`v2-ledger-tab-btn ${activeTab === "EXACT_MATCH" ? "is-active" : ""}`}
              onClick={() => {
                setActiveTab("EXACT_MATCH");
                setActiveRuleFilter(null);
              }}
            >
              <CheckCircle2 size={13} color={activeTab === "EXACT_MATCH" ? "#fff" : "#10b981"} />
              <span>Exact Matches</span>
              <span className="v2-tab-count-pill">{tabCounts.EXACT_MATCH}</span>
            </button>
            <button
              type="button"
              className={`v2-ledger-tab-btn ${activeTab === "TOLERANCE_MATCH" ? "is-active" : ""}`}
              onClick={() => {
                setActiveTab("TOLERANCE_MATCH");
                setActiveRuleFilter(null);
              }}
            >
              <Zap size={13} color={activeTab === "TOLERANCE_MATCH" ? "#fff" : "#3b82f6"} />
              <span>Tolerance Matched</span>
              <span className="v2-tab-count-pill">{tabCounts.TOLERANCE_MATCH}</span>
            </button>
            <button
              type="button"
              className={`v2-ledger-tab-btn ${activeTab === "NEAR_MATCH" ? "is-active" : ""}`}
              onClick={() => {
                setActiveTab("NEAR_MATCH");
                setActiveRuleFilter(null);
              }}
            >
              <Layers size={13} color={activeTab === "NEAR_MATCH" ? "#fff" : "#8b5cf6"} />
              <span>Near Matches</span>
              <span className="v2-tab-count-pill">{tabCounts.NEAR_MATCH}</span>
            </button>
            <button
              type="button"
              className={`v2-ledger-tab-btn ${activeTab === "AMBIGUOUS" ? "is-active" : ""}`}
              onClick={() => {
                setActiveTab("AMBIGUOUS");
                setActiveRuleFilter(null);
              }}
            >
              <Split size={13} color={activeTab === "AMBIGUOUS" ? "#fff" : "#f59e0b"} />
              <span>Ambiguous Collisions</span>
              <span className="v2-tab-count-pill">{tabCounts.AMBIGUOUS}</span>
            </button>
            <button
              type="button"
              className={`v2-ledger-tab-btn ${activeTab === "GSTR_ONLY" ? "is-active" : ""}`}
              onClick={() => {
                setActiveTab("GSTR_ONLY");
                setActiveRuleFilter(null);
              }}
            >
              <AlertTriangle size={13} color={activeTab === "GSTR_ONLY" ? "#fff" : "#ef4444"} />
              <span>GSTR Only (Unclaimed)</span>
              <span className="v2-tab-count-pill">{tabCounts.GSTR_ONLY}</span>
            </button>
            <button
              type="button"
              className={`v2-ledger-tab-btn ${activeTab === "PR_ONLY" ? "is-active" : ""}`}
              onClick={() => {
                setActiveTab("PR_ONLY");
                setActiveRuleFilter(null);
              }}
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
                placeholder="Search by Supplier GSTIN, Document #, or Statutory Remark..."
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
                <th style={{ width: 36 }}></th>
                <th style={{ minWidth: 200, width: 200 }}>Classification &amp; Client Rule</th>
                <th style={{ minWidth: 165, width: 165 }}>Supplier GSTIN</th>
                <th style={{ minWidth: 150, width: 150 }}>Document #</th>
                <th style={{ minWidth: 110, width: 110 }}>Date</th>
                <th style={{ minWidth: 130, width: 130, textAlign: "right" }}>Taxable Value</th>
                <th style={{ minWidth: 140, width: 140, textAlign: "right" }}>Tax Amount (ITC)</th>
                <th style={{ minWidth: 140, width: 140, textAlign: "right" }}>Total Value</th>
                <th style={{ minWidth: 220, width: 220 }}>Statutory Audit Rationale</th>
                <th style={{ minWidth: 90, width: 90, textAlign: "center" }}>Action</th>
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
                          Your single-ledger workbook and KPMG client matching rules are loaded. Click <strong>"Reconcile"</strong> in the top hero banner to run the 5-pass progressive elimination waterfall.
                        </span>
                      </div>
                    ) : (
                      "No records found matching current rule filter and search query."
                    )}
                  </td>
                </tr>
              ) : (
                paginatedRecords.map((rec) => {
                  const isExpanded = expandedRowId === rec.id;
                  const subC = rec.sub_classification;

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
                          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
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
                            </div>

                            {/* Precise Client Rule Badge */}
                            <div>
                              {subC === "INELIGIBLE_ITC_17_5" && (
                                <span className="v4-rule-pill rule-sec-17-5">
                                  🛡️ Rule 2: Sec 17(5) Ineligible
                                </span>
                              )}
                              {subC === "CROSS_FY_TIMING" && (
                                <span className="v4-rule-pill rule-cross-fy">
                                  📅 Rule 4: Cross-FY Cutoff
                                </span>
                              )}
                              {subC === "DATE_OPERATIONAL_SHIFT" && (
                                <span className="v4-rule-pill rule-date">
                                  ⏱️ Rule 3: Date Proximity
                                </span>
                              )}
                              {subC === "BANKING_MULTI_TRANCHE" && (
                                <span className="v4-rule-pill rule-banking">
                                  🏦 Rule 1: Banking N:1
                                </span>
                              )}
                              {subC === "DOC_PREFIX_NORMALIZED" && (
                                <span className="v4-rule-pill rule-prefix">
                                  🔤 Rule 5: Prefix Stripped
                                </span>
                              )}
                              {subC === "COMPOUND_DOC_DATE_VARIATION" && (
                                <span className="v4-rule-pill rule-compound">
                                  ⚡ Rule 6: Compound
                                </span>
                              )}
                              {subC === "COMMERCIAL_TOLERANCE" && (
                                <span className="v4-rule-pill rule-tolerance">
                                  ⚖️ Rule 0: Value ±₹10.00
                                </span>
                              )}
                              {subC === "EXACT_ZERO_VARIANCE" && (
                                <span className="v4-rule-pill rule-exact">
                                  🎯 Zero Variance
                                </span>
                              )}
                            </div>
                          </div>
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
                          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                            <span style={{ fontSize: 11.5, color: "#0f172a", fontWeight: 600, lineHeight: 1.3 }}>
                              {rec.classification_reason || rec.matched_by_pass || rec.bucket}
                            </span>
                            {rec.ai_reason && (
                              <span style={{ fontSize: 10.5, color: "#64748b", fontStyle: "italic", lineHeight: 1.25 }}>
                                {rec.ai_reason}
                              </span>
                            )}
                          </div>
                        </td>
                        <td style={{ textAlign: "center" }}>
                          {rec.bucket === "AMBIGUOUS" ? (
                            <button
                              type="button"
                              className="v2-btn-table-action"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenReclassifyModal(rec);
                              }}
                            >
                              Resolve
                            </button>
                          ) : (
                            <span style={{ fontSize: 11, color: "#94a3b8" }}>—</span>
                          )}
                        </td>
                      </tr>

                      {/* Expanded Record View */}
                      {isExpanded && (
                        <tr className="v2-expanded-details-row">
                          <td colSpan={10}>
                            <div className="v2-expanded-details-panel">
                              <div className="v2-expanded-grid">
                                <div className="v2-preview-box">
                                  <h5>Government Portal GSTR-2B Snapshot</h5>
                                  <pre>{JSON.stringify(rec.gstr_preview, null, 2)}</pre>
                                </div>
                                <div className="v2-preview-box">
                                  <h5>Internal Purchase Register (Books) Snapshot</h5>
                                  <pre>{JSON.stringify(rec.pr_preview, null, 2)}</pre>
                                </div>
                              </div>
                              <div style={{ marginTop: 12, padding: "10px 14px", background: "#f8fafc", borderRadius: 8, border: "1px solid #e2e8f0" }}>
                                <strong style={{ fontSize: 12, color: "#0f172a" }}>Statutory Audit Provenance: </strong>
                                <span style={{ fontSize: 12, color: "#334155" }}>
                                  {rec.classification_reason || "Deterministic match verified against statutory parameters."}
                                </span>
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
    </div>
  );
};
