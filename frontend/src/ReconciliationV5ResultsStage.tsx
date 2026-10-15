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
  FileText,
  Activity,
  Check,
  FileSpreadsheet,
  Info,
} from "lucide-react";
import {
  apiV2,
  Stage4ExecutionResponse,
  Stage4ResultsSummary,
  ReconciliationRecordItem,
  AmbiguityCluster,
  AmbiguityRecommendation,
} from "./api_v2";
import { apiV5, ReconciliationRecordItemV5 } from "./api_v5";
import { copilotV2Bridge } from "./copilot_v2_bridge";
import "./results_v2.css";
import "./reconciliation_v2.css";
import "./results_v4.css";

export type ReconciliationRecordItemV5Extended = ReconciliationRecordItem & {
  source_gstin?: string;
  target_gstin?: string;
  source_doc_num?: string;
  target_doc_num?: string;
  source_date?: string;
  target_date?: string;
  source_taxable?: number;
  target_taxable?: number;
  source_tax?: number;
  target_tax?: number;
  taxable_diff?: number;
  tax_diff?: number;
  pass_tier?: string;
};
export type Stage4ExecutionResponseV5 = Omit<Stage4ExecutionResponse, "records"> & {
  records: ReconciliationRecordItemV5Extended[];
};

interface ResultsStageProps {
  sessionId: string;
  isReadOnly?: boolean;
  onBackToRules: () => void;
  onProceedToSummary: () => void;
}

const extractField = (preview: Record<string, any> | undefined, keys: string[]): any => {
  if (!preview) return null;
  for (const k of keys) {
    if (preview[k] !== undefined && preview[k] !== null && preview[k] !== "") {
      return preview[k];
    }
  }
  return null;
};

const formatINR = (val: any): string => {
  if (val === null || val === undefined || isNaN(Number(val))) return "—";
  return `₹${Number(val).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const getNumericDeltaBadge = (val1: any, val2: any) => {
  if (val1 === null || val2 === null || val1 === undefined || val2 === undefined) {
    return <span className="v4-diff-badge missing">—</span>;
  }
  const n1 = Number(val1);
  const n2 = Number(val2);
  if (isNaN(n1) || isNaN(n2)) return <span className="v4-diff-badge missing">—</span>;
  const diff = n1 - n2;
  if (Math.abs(diff) < 0.005) {
    return (
      <span className="v4-diff-badge match">
        <CheckCircle2 size={11} /> ₹0.00
      </span>
    );
  }
  const formatted = Math.abs(diff).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    <span className={`v4-diff-badge ${Math.abs(diff) <= 10 ? "delta-tol" : "delta-warn"}`}>
      {diff > 0 ? `+₹${formatted}` : `-₹${formatted}`}
    </span>
  );
};

const getTextDeltaBadge = (val1: any, val2: any, isDocNum: boolean = false) => {
  if (!val1 || !val2) return <span className="v4-diff-badge missing">—</span>;
  const s1 = String(val1).trim();
  const s2 = String(val2).trim();
  if (s1.toLowerCase() === s2.toLowerCase()) {
    return (
      <span className="v4-diff-badge match">
        <CheckCircle2 size={11} /> Match
      </span>
    );
  }
  if (isDocNum) {
    const stripped1 = s1.replace(/^(INV|BILL|REC|#|\/|-|_)+/i, "").replace(/^0+/, "");
    const stripped2 = s2.replace(/^(INV|BILL|REC|#|\/|-|_)+/i, "").replace(/^0+/, "");
    if (stripped1 && stripped2 && stripped1.toLowerCase() === stripped2.toLowerCase()) {
      return (
        <span className="v4-diff-badge norm">
          <Sparkles size={10} /> Normalized
        </span>
      );
    }
  }
  return <span className="v4-diff-badge mismatch">Variance</span>;
};

const WATERFALL_STEPS_V4 = [
  {
    tier: 1,
    name: "Exact Statutory Identity",
    desc: "Zero-tolerance match across Supplier GSTIN, normalized Invoice No, Date & Financials",
    highlight: "100% Identity",
  },
  {
    tier: 2,
    name: "Commercial Tolerances & Drift",
    desc: "Stage 3 configured numerical & date tolerances (± ₹10.00 / 30-day window)",
    highlight: "± ₹10.00 Window",
  },
  {
    tier: 3,
    name: "Semantic Near-Matching",
    desc: "Normalized phonetic string edit distance (≥85%), prefix stripping & date drift",
    highlight: "≥85% Edit Sim",
  },
  {
    tier: 4,
    name: "Multi-Tranche Batches & Sec 17(5)",
    desc: "Combinatorial 1:N / N:1 tranches and statutory blocked credit tagging",
    highlight: "1:N & N:1 Batches",
  },
  {
    tier: 5,
    name: "Residuals & Ambiguity Clustering",
    desc: "Quarantining unresolvable variances, single-sided credits & DRC-01C risks",
    highlight: "Audit Quarantine",
  },
];

const getPassNarrative = (pass: number): string => {
  switch (pass) {
    case 1:
      return "Scanning primary ledger anchors: Matching GSTINs, clean document numbers, and zero-variance financials...";
    case 2:
      return "Applying commercial tolerance envelopes: Absorbing minor penny roundoffs (± ₹10) and invoice date windows...";
    case 3:
      return "Running semantic similarity analysis: Normalizing alphanumeric invoice prefixes, zeros, and typo variations...";
    case 4:
      return "Executing multi-tranche combinatorial matching: Aggregating 1:N / N:1 payment tranches and Section 17(5) blocked credits...";
    case 5:
      return "Isolating residual variances: Quarantining single-sided credits into 2B Unmatched and DRC-01C risk clusters...";
    default:
      return "Autonomous dual-ledger reconciliation pipeline active...";
  }
};

export const ReconciliationV5ResultsStage: React.FC<ResultsStageProps> = ({
  sessionId,
  isReadOnly = false,
  onBackToRules,
  onProceedToSummary,
}) => {
  const [data, setData] = useState<Stage4ExecutionResponseV5 | null>(null);
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
  const [selectedAmbiguousRecord, setSelectedAmbiguousRecord] = useState<ReconciliationRecordItemV5Extended | null>(null);
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
      let resp: any = null;
      try {
        resp = await apiV5.getStage4Results(sessionId);
      } catch {
        resp = await apiV2.getStage4Results(sessionId);
      }
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
      setExecElapsedMs(Date.now() - startTime);
    }, 60);

    let passTicker: any = null;
    try {
      const backendPromise = (async () => {
        try {
          return await apiV5.executeStage4Results(sessionId);
        } catch (errV5: any) {
          console.warn("apiV5.executeStage4Results failed, falling back to apiV2:", errV5);
          return await apiV2.executeStage4Results(sessionId);
        }
      })();

      let currentPass = 1;
      passTicker = setInterval(() => {
        if (currentPass < 4) {
          currentPass++;
          setExecPass(currentPass);
        }
      }, 80);

      const resp = await backendPromise;
      if (passTicker) clearInterval(passTicker);
      if (!resp || !resp.records) {
        throw new Error("Empty or invalid results payload returned from reconciliation engine.");
      }
      setData(resp as any);
      setExecPass(5);
    } catch (err: any) {
      if (passTicker) clearInterval(passTicker);
      console.error("Reconciliation execution error:", err);
      setErrorMessage(err.message || "Failed to run reconciliation waterfall.");
    } finally {
      if (passTicker) clearInterval(passTicker);
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
      let updated: any = null;
      try {
        updated = await apiV5.resolveAmbiguity(sessionId, clusterId, chosenCandidateId, action);
      } catch {
        updated = await apiV2.resolveAmbiguity(sessionId, clusterId, chosenCandidateId, action);
      }
      setData(updated);
      setSelectedCluster(null);
    } catch (err: any) {
      alert(`Resolution failed: ${err.message || "Unknown error"}`);
    } finally {
      setIsResolving(false);
    }
  };

  const handleOpenReclassifyModal = async (rec: ReconciliationRecordItemV5Extended) => {
    // Check if an ambiguity cluster exists for this record
    if (rec.ambiguity_cluster_id && data?.ambiguities && data.ambiguities.length > 0) {
      const cluster = data.ambiguities.find((c) => c.cluster_id === rec.ambiguity_cluster_id);
      if (cluster) {
        setSelectedCluster(cluster);
        return;
      }
    }
    setSelectedAmbiguousRecord(rec);
    setIsLoadingRecommendation(true);
    setReviewerNote("");
    try {
      const recId = rec.id || String(rec.gstr_row_index ?? 0);
      let recResp: any = null;
      try {
        recResp = await apiV5.getRecordRecommendation(sessionId, recId, rec);
      } catch {
        recResp = await apiV2.getRecordRecommendation(sessionId, recId, rec);
      }
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

  const handleSwitchToReclassify = async (cluster: AmbiguityCluster) => {
    const matchingRec = data?.records?.find(
      (r) => r.ambiguity_cluster_id === cluster.cluster_id || r.id === cluster.gstr_record_id
    );
    setSelectedCluster(null);
    if (matchingRec) {
      setSelectedAmbiguousRecord(matchingRec);
      setIsLoadingRecommendation(true);
      setReviewerNote("");
      try {
        const recId = matchingRec.id || String(matchingRec.gstr_row_index ?? 0);
        let recResp: any = null;
        try {
          recResp = await apiV5.getRecordRecommendation(sessionId, recId, matchingRec);
        } catch {
          recResp = await apiV2.getRecordRecommendation(sessionId, recId, matchingRec);
        }
        setRecommendation(recResp);
        setTargetBucket(recResp.recommended_bucket || "EXACT_MATCH");
      } catch (err: any) {
        setRecommendation(null);
        setTargetBucket("EXACT_MATCH");
      } finally {
        setIsLoadingRecommendation(false);
      }
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

      let updated: Stage4ExecutionResponse | null = null;
      try {
        // Try V5-specific API first
        updated = (await apiV5.reclassifyRecord(sessionId, recId, {
          target_bucket: bucketToPost,
          reviewer_note: autoNote,
          override_policy: policyInfo?.verdict === "NOT_OKAY",
        })) as any;
      } catch (errV5) {
        // Fallback to apiV2 router
        updated = await apiV2.reclassifyRecord(sessionId, recId, {
          target_bucket: bucketToPost,
          reviewer_note: autoNote,
          override_policy: policyInfo?.verdict === "NOT_OKAY",
        });
      }

      if (updated && updated.records) {
        setData(updated);
        setSelectedAmbiguousRecord(null);
        setRecommendation(null);
      } else {
        throw new Error("No updated records returned from server");
      }
    } catch (err: any) {
      console.warn("Applying optimistic reclassification update:", err);

      // Optimistic local update fallback — guarantees immediate UI update identical to Recon 2.0 / 3.0
      const currentRecords = data?.records || [];
      const updatedRecords: ReconciliationRecordItemV5Extended[] = currentRecords.map((r) => {
        const matchesRec =
          r.id === selectedAmbiguousRecord.id ||
          (selectedAmbiguousRecord.gstr_row_index !== undefined && r.gstr_row_index === selectedAmbiguousRecord.gstr_row_index) ||
          (selectedAmbiguousRecord.index !== undefined && (r as any).index === selectedAmbiguousRecord.index) ||
          (selectedAmbiguousRecord.ambiguity_cluster_id && r.ambiguity_cluster_id === selectedAmbiguousRecord.ambiguity_cluster_id);

        if (matchesRec) {
          const vMap: Record<string, string> = {
            EXACT_MATCH: "Exact Match",
            TOLERANCE_MATCH: "Tolerance Match",
            NEAR_MATCH: "Near Match",
            GSTR_ONLY: "GST Only",
            PR_ONLY: "PR Only",
            AMBIGUOUS: "Ambiguous",
          };
          return {
            ...r,
            bucket: bucketToPost as any,
            tars_verdict: vMap[bucketToPost] || "Exact Match",
            reclassified_from: "AMBIGUOUS",
            reclassification_note: reviewerNote.trim() || `Classified to ${bucketToPost}`,
            matched_by_pass: `Manual Reclassification → ${bucketToPost}`,
            concurrence: ["EXACT_MATCH", "TOLERANCE_MATCH", "NEAR_MATCH"].includes(bucketToPost) ? "AGREEMENT" : r.concurrence,
          };
        }
        return r;
      });

      const updatedSummary = { ...(data?.summary || fallbackSummary) };
      if (updatedSummary.ambiguous_count && updatedSummary.ambiguous_count > 0) {
        updatedSummary.ambiguous_count -= 1;
      }
      if ((updatedSummary as any).ambiguous && (updatedSummary as any).ambiguous > 0) {
        (updatedSummary as any).ambiguous -= 1;
      }

      if (bucketToPost === "EXACT_MATCH") {
        updatedSummary.exact_match_count = (updatedSummary.exact_match_count || 0) + 1;
        (updatedSummary as any).exact_matches = ((updatedSummary as any).exact_matches || 0) + 1;
      } else if (bucketToPost === "TOLERANCE_MATCH") {
        updatedSummary.tolerance_match_count = (updatedSummary.tolerance_match_count || 0) + 1;
        (updatedSummary as any).tolerance_matches = ((updatedSummary as any).tolerance_matches || 0) + 1;
      } else if (bucketToPost === "NEAR_MATCH") {
        updatedSummary.near_match_count = (updatedSummary.near_match_count || 0) + 1;
        (updatedSummary as any).near_matches = ((updatedSummary as any).near_matches || 0) + 1;
      } else if (bucketToPost === "GSTR_ONLY") {
        updatedSummary.gstr_only_count = (updatedSummary.gstr_only_count || 0) + 1;
        (updatedSummary as any).gst_only = ((updatedSummary as any).gst_only || 0) + 1;
      } else if (bucketToPost === "PR_ONLY") {
        updatedSummary.pr_only_count = (updatedSummary.pr_only_count || 0) + 1;
        (updatedSummary as any).pr_only = ((updatedSummary as any).pr_only || 0) + 1;
      }

      updatedSummary.total_reconciled_count =
        (updatedSummary.exact_match_count || 0) +
        (updatedSummary.tolerance_match_count || 0) +
        (updatedSummary.near_match_count || 0);

      const tot = updatedSummary.total_gstr_rows || (updatedSummary as any).total_records || updatedRecords.length || 1;
      updatedSummary.overall_reconciliation_rate = parseFloat(((updatedSummary.total_reconciled_count / tot) * 100).toFixed(1));
      (updatedSummary as any).accuracy_percentage = updatedSummary.overall_reconciliation_rate;

      // Also mark ambiguity cluster resolved if one was associated
      const clusterId = selectedAmbiguousRecord.ambiguity_cluster_id;
      const updatedAmbiguities = (data?.ambiguities || []).map((c) => {
        if (c.cluster_id === clusterId) {
          return {
            ...c,
            status: "RESOLVED" as const,
            resolved_at: new Date().toISOString(),
          };
        }
        return c;
      });

      setData({
        session_id: sessionId,
        summary: updatedSummary,
        records: updatedRecords,
        ambiguities: updatedAmbiguities,
        compared_columns: data?.compared_columns || [],
      });
      setSelectedAmbiguousRecord(null);
      setRecommendation(null);
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
        const gstinVal = rec.gstin || rec.source_gstin || rec.target_gstin || "";
        const docVal = rec.document_number || rec.source_doc_num || rec.target_doc_num || "";
        const gstinMatch = gstinVal.toLowerCase().includes(q);
        const docMatch = docVal.toLowerCase().includes(q);
        const reasonMatch = (rec.classification_reason || "").toLowerCase().includes(q);
        const gstrPreview = JSON.stringify(rec.gstr_preview || {}).toLowerCase();
        const prPreview = JSON.stringify(rec.pr_preview || {}).toLowerCase();
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
        name: "Multi-Tranche Batches (1:N / N:1)",
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
            <h2 className="v2-results-hero-title">Deterministic Match Matrix &amp; Ambiguity Hub (Recon 5.0)</h2>
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
            title={!data ? "Execute reconciliation engine across dual workbooks (GSTR-2B & Purchase Register)" : "Re-run reconciliation waterfall with active rules"}
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

      {/* ERROR BANNER */}
      {errorMessage && (
        <div
          style={{
            margin: "16px 0",
            padding: "12px 18px",
            background: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: 10,
            color: "#991b1b",
            display: "flex",
            alignItems: "center",
            gap: 12,
            fontSize: 13.5,
            fontWeight: 500,
          }}
        >
          <AlertCircle size={18} style={{ flexShrink: 0, color: "#dc2626" }} />
          <div style={{ flex: 1 }}>{errorMessage}</div>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            style={{ background: "transparent", border: "none", cursor: "pointer", color: "#991b1b", padding: 4 }}
            title="Dismiss error message"
          >
            <X size={16} />
          </button>
        </div>
      )}

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
                    if (isActive) {
                      setActiveRuleFilter(null);
                    } else {
                      setActiveRuleFilter(item.id);
                      if (activeTab !== "ALL" && activeTab !== item.passKey) {
                        setActiveTab("ALL");
                      }
                    }
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
                          Your dual workbooks (GSTR-2B &amp; Purchase Register) and KPMG client matching rules are loaded. Click <strong>"Reconcile"</strong> in the top hero banner to run the 5-pass progressive elimination waterfall.
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
                                  🏦 {rec.variances?.batch_type ? `Rule 1: Batch ${rec.variances.batch_type}` : "Rule 1: Multi-Tranche Batch"}
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
                          <span className="v2-gstin-code">{rec.gstin || rec.source_gstin || rec.target_gstin || "—"}</span>
                        </td>
                        <td>
                          <span className="v2-doc-num">{rec.document_number || rec.source_doc_num || rec.target_doc_num || "—"}</span>
                        </td>
                        <td>
                          <span style={{ fontSize: 12.5, color: "#64748b" }}>{rec.document_date || rec.source_date || rec.target_date || "—"}</span>
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <span className="v2-money-amt">
                            ₹{(Number(rec.taxable_value ?? rec.source_taxable ?? 0) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <span className="v2-money-amt" style={{ color: "#00338d", fontWeight: 700 }}>
                            ₹{(Number(rec.tax_amount ?? rec.source_tax ?? 0) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <span className="v2-money-amt">
                            ₹{(Number(rec.total_value ?? ((rec.taxable_value ?? rec.source_taxable ?? 0) + (rec.tax_amount ?? rec.source_tax ?? 0))) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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

                      {/* Expanded Record View — UI/UX Pro Max Dual-Ledger Audit Inspector */}
                      {isExpanded && (() => {
                        const isGstrOnly = rec.bucket === "GSTR_ONLY";
                        const isPrOnly = rec.bucket === "PR_ONLY";

                        const gstrGstin = extractField(rec.gstr_preview, ["gstin", "GSTIN", "supplier_gstin", "ctin"]) || (!isPrOnly ? rec.gstin : null);
                        const prGstin = extractField(rec.pr_preview, ["gstin", "GSTIN", "supplier_gstin", "ctin"]) || (!isGstrOnly ? rec.gstin : null);

                        const gstrDoc = extractField(rec.gstr_preview, ["document_number", "invoice_number", "Invoice", "inv_no", "inum"]) || (!isPrOnly ? rec.document_number : null);
                        const prDoc = extractField(rec.pr_preview, ["document_number", "invoice_number", "Invoice", "inv_no", "inum"]) || (!isGstrOnly ? rec.document_number : null);

                        const gstrDate = extractField(rec.gstr_preview, ["document_date", "invoice_date", "Date", "inv_date", "dt"]) || (!isPrOnly ? rec.document_date : null);
                        const prDate = extractField(rec.pr_preview, ["document_date", "invoice_date", "Date", "inv_date", "dt"]) || (!isGstrOnly ? rec.document_date : null);

                        const gstrTaxable = extractField(rec.gstr_preview, ["taxable_value", "Taxable", "txval"]) ?? (!isPrOnly ? rec.taxable_value : null);
                        const prTaxable = extractField(rec.pr_preview, ["taxable_value", "Taxable", "txval"]) ?? (!isGstrOnly ? rec.taxable_value : null);

                        const gstrTax = extractField(rec.gstr_preview, ["tax_amount", "Tax", "itc", "iamt", "igst"]) ?? (!isPrOnly ? rec.tax_amount : null);
                        const prTax = extractField(rec.pr_preview, ["tax_amount", "Tax", "itc", "iamt", "igst"]) ?? (!isGstrOnly ? rec.tax_amount : null);

                        const gstrTotal = extractField(rec.gstr_preview, ["total_value", "Total", "val"]) ?? (!isPrOnly ? rec.total_value : null);
                        const prTotal = extractField(rec.pr_preview, ["total_value", "Total", "val"]) ?? (!isGstrOnly ? rec.total_value : null);

                        return (
                          <tr className="v4-expanded-details-row">
                            <td colSpan={10} className="v4-expanded-details-cell">
                              <div className="v4-inspector-card">
                                {/* 1. Inspector Header: Metadata & Audit Status */}
                                <div className="v4-inspector-header">
                                  <div className="v4-inspector-meta-left">
                                    <div className="v4-inspector-badge-group">
                                      <span className={`v4-inspector-pass-badge ${rec.bucket.toLowerCase().replace(/_/g, "-")}`}>
                                        {rec.bucket.replace(/_/g, " ")}
                                      </span>
                                      {rec.sub_classification && (
                                        <span className="v4-inspector-rule-badge">
                                          {rec.sub_classification === "BANKING_MULTI_TRANCHE" && rec.variances?.batch_type
                                            ? `MULTI-TRANCHE (${rec.variances.batch_type})`
                                            : rec.sub_classification.replace(/_/g, " ")}
                                        </span>
                                      )}
                                    </div>
                                    <div className="v4-inspector-provenance-tags">
                                      {rec.gstr_row_index !== undefined && rec.gstr_row_index !== null && (
                                        <span className="v4-row-tag portal">
                                          <Landmark size={11} /> 2B Row #{rec.gstr_row_index + 1}
                                        </span>
                                      )}
                                      {rec.pr_row_index !== undefined && rec.pr_row_index !== null && (
                                        <span className="v4-row-tag books">
                                          <FileText size={11} /> PR Row #{rec.pr_row_index + 1}
                                        </span>
                                      )}
                                    </div>
                                  </div>

                                  <div className="v4-inspector-status-right">
                                    {rec.bucket === "EXACT_MATCH" ? (
                                      <span className="v4-status-pill exact">
                                        <CheckCircle2 size={13} /> Strict Statutory Identity • 0.00 Variance
                                      </span>
                                    ) : rec.bucket === "TOLERANCE_MATCH" ? (
                                      <span className="v4-status-pill tolerance">
                                        <Zap size={13} /> Tolerances Satisfied
                                      </span>
                                    ) : rec.bucket === "NEAR_MATCH" ? (
                                      <span className="v4-status-pill near">
                                        <Layers size={13} /> Normalized Reference Match
                                      </span>
                                    ) : rec.bucket === "AMBIGUOUS" ? (
                                      <span className="v4-status-pill ambiguous">
                                        <Split size={13} /> Multi-Candidate Ambiguity
                                      </span>
                                    ) : isGstrOnly ? (
                                      <span className="v4-status-pill residual">
                                        <AlertTriangle size={13} /> Unclaimed Credit (In 2B Only)
                                      </span>
                                    ) : (
                                      <span className="v4-status-pill residual-books">
                                        <AlertCircle size={13} /> Missing in Portal (Books Only • DRC-01C)
                                      </span>
                                    )}
                                  </div>
                                </div>

                                {/* 2. Side-by-Side Dual-Ledger Comparative Matrix */}
                                <div className="v4-inspector-matrix-box">
                                  <table className="v4-inspector-table">
                                    <thead>
                                      <tr>
                                        <th style={{ width: "22%" }}>Reconciliation Anchor</th>
                                        <th style={{ width: "32%" }}>
                                          <div className="v4-table-header-ledger portal">
                                            <Landmark size={12} />
                                            <span>Government Portal (GSTR-2B)</span>
                                          </div>
                                        </th>
                                        <th style={{ width: "32%" }}>
                                          <div className="v4-table-header-ledger books">
                                            <FileText size={12} />
                                            <span>Purchase Register (Books)</span>
                                          </div>
                                        </th>
                                        <th style={{ width: "14%", textAlign: "right" }}>Variance / Delta</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {/* Anchor 1: Supplier GSTIN */}
                                      <tr>
                                        <td className="v4-anchor-label">
                                          <span className="v4-anchor-icon"><Landmark size={12} /></span>
                                          <span>Supplier GSTIN</span>
                                        </td>
                                        <td className="v4-ledger-val mono">
                                          {gstrGstin || <span className="v4-val-empty">Missing in Portal</span>}
                                        </td>
                                        <td className="v4-ledger-val mono">
                                          {prGstin || <span className="v4-val-empty">Missing in Books</span>}
                                        </td>
                                        <td className="v4-ledger-delta">
                                          {getTextDeltaBadge(gstrGstin, prGstin)}
                                        </td>
                                      </tr>

                                      {/* Anchor 2: Invoice Number */}
                                      <tr>
                                        <td className="v4-anchor-label">
                                          <span className="v4-anchor-icon"><Hash size={12} /></span>
                                          <span>Document / Invoice #</span>
                                        </td>
                                        <td className="v4-ledger-val mono bold">
                                          {gstrDoc || <span className="v4-val-empty">Missing in Portal</span>}
                                        </td>
                                        <td className="v4-ledger-val mono bold">
                                          {prDoc || <span className="v4-val-empty">Missing in Books</span>}
                                        </td>
                                        <td className="v4-ledger-delta">
                                          {rec.batch_components && rec.batch_components.length > 0 ? (
                                            <span className="v4-diff-badge delta-tol">
                                              <Layers size={11} /> {rec.batch_components.length} {rec.variances?.batch_type === "N:1" ? "Invoices" : "Vouchers"}
                                            </span>
                                          ) : (
                                            getTextDeltaBadge(gstrDoc, prDoc, true)
                                          )}
                                        </td>
                                      </tr>

                                      {/* Anchor 3: Invoice Date */}
                                      <tr>
                                        <td className="v4-anchor-label">
                                          <span className="v4-anchor-icon"><Calendar size={12} /></span>
                                          <span>Invoice Date</span>
                                        </td>
                                        <td className="v4-ledger-val">
                                          {gstrDate || <span className="v4-val-empty">—</span>}
                                        </td>
                                        <td className="v4-ledger-val">
                                          {prDate || <span className="v4-val-empty">—</span>}
                                        </td>
                                        <td className="v4-ledger-delta">
                                          {getTextDeltaBadge(gstrDate, prDate)}
                                        </td>
                                      </tr>

                                      {/* Anchor 4: Taxable Value */}
                                      <tr>
                                        <td className="v4-anchor-label">
                                          <span className="v4-anchor-icon"><Scale size={12} /></span>
                                          <span>Taxable Value</span>
                                        </td>
                                        <td className="v4-ledger-val num">
                                          {gstrTaxable !== null ? formatINR(gstrTaxable) : <span className="v4-val-empty">—</span>}
                                        </td>
                                        <td className="v4-ledger-val num">
                                          {prTaxable !== null ? formatINR(prTaxable) : <span className="v4-val-empty">—</span>}
                                        </td>
                                        <td className="v4-ledger-delta">
                                          {getNumericDeltaBadge(gstrTaxable, prTaxable)}
                                        </td>
                                      </tr>

                                      {/* Anchor 5: Tax Amount (ITC) */}
                                      <tr>
                                        <td className="v4-anchor-label">
                                          <span className="v4-anchor-icon highlight"><Zap size={12} /></span>
                                          <span style={{ fontWeight: 700, color: "#00338d" }}>Statutory ITC Amount</span>
                                        </td>
                                        <td className="v4-ledger-val num itc">
                                          {gstrTax !== null ? formatINR(gstrTax) : <span className="v4-val-empty">—</span>}
                                        </td>
                                        <td className="v4-ledger-val num itc">
                                          {prTax !== null ? formatINR(prTax) : <span className="v4-val-empty">—</span>}
                                        </td>
                                        <td className="v4-ledger-delta">
                                          {getNumericDeltaBadge(gstrTax, prTax)}
                                        </td>
                                      </tr>

                                      {/* Anchor 6: Total Invoice Value */}
                                      <tr>
                                        <td className="v4-anchor-label">
                                          <span className="v4-anchor-icon"><Scale size={12} /></span>
                                          <span>Total Invoice Value</span>
                                        </td>
                                        <td className="v4-ledger-val num">
                                          {gstrTotal !== null ? formatINR(gstrTotal) : <span className="v4-val-empty">—</span>}
                                        </td>
                                        <td className="v4-ledger-val num">
                                          {prTotal !== null ? formatINR(prTotal) : <span className="v4-val-empty">—</span>}
                                        </td>
                                        <td className="v4-ledger-delta">
                                          {getNumericDeltaBadge(gstrTotal, prTotal)}
                                        </td>
                                      </tr>
                                    </tbody>
                                  </table>
                                </div>

                                {/* 2.5 Constituent Multi-Tranche Batch Components Breakdown */}
                                {rec.batch_components && rec.batch_components.length > 0 && (
                                  <div className="v4-inspector-batch-card" style={{ marginTop: 12 }}>
                                    <div className="v4-batch-card-header">
                                      <div className="v4-batch-header-title">
                                        <Layers size={14} className="batch-layers-icon" />
                                        <span>
                                          Consolidated Constituent Breakdown ({rec.batch_components.length}{" "}
                                          {rec.variances?.batch_type === "N:1" ? "Portal Invoices" : "Books Vouchers"})
                                        </span>
                                      </div>
                                      <div className="v4-batch-header-badges">
                                        <span className="v4-batch-meta-pill">
                                          Batch Sum: <strong>{formatINR(rec.variances?.batch_sum)}</strong>
                                        </span>
                                        <span className="v4-batch-meta-pill highlight">
                                          Target ({rec.variances?.batch_type === "N:1" ? "PR" : "2B"}): <strong>{formatINR(rec.variances?.target_amount)}</strong>
                                        </span>
                                        <span className="v4-batch-meta-pill variance">
                                          Net Variance: <strong>{rec.variances?.net_batch_variance || "₹0.00"}</strong>
                                        </span>
                                      </div>
                                    </div>
                                    
                                    <div className="v4-batch-table-container">
                                      <table className="v4-batch-components-table">
                                        <thead>
                                          <tr>
                                            <th style={{ width: "5%" }}>#</th>
                                            <th style={{ width: "14%" }}>Workbook Row</th>
                                            <th style={{ width: "23%" }}>Document / Voucher #</th>
                                            <th style={{ width: "13%" }}>Date</th>
                                            <th style={{ width: "14%", textAlign: "right" }}>Taxable Value</th>
                                            <th style={{ width: "13%", textAlign: "right" }}>Statutory Tax (ITC)</th>
                                            <th style={{ width: "14%", textAlign: "right" }}>Total Value</th>
                                            <th style={{ width: "14%", textAlign: "right" }}>Share %</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {rec.batch_components.map((comp, cIdx) => (
                                            <tr key={`${comp.row_index}-${cIdx}`} className="v4-batch-comp-row">
                                              <td className="v4-batch-comp-idx">{cIdx + 1}</td>
                                              <td className="v4-batch-comp-source">
                                                <span className={`v4-comp-source-tag ${comp.doc_type === "PR" ? "books" : "portal"}`}>
                                                  {comp.doc_type === "PR" ? <FileText size={10} /> : <Landmark size={10} />}
                                                  <span>Row #{comp.row_number}</span>
                                                </span>
                                              </td>
                                              <td className="v4-batch-comp-doc mono bold">
                                                {comp.document_number || "—"}
                                              </td>
                                              <td className="v4-batch-comp-date">
                                                {comp.document_date || "—"}
                                              </td>
                                              <td className="v4-batch-comp-num num">
                                                {formatINR(comp.taxable_value)}
                                              </td>
                                              <td className="v4-batch-comp-num num itc">
                                                {formatINR(comp.tax_amount)}
                                              </td>
                                              <td className="v4-batch-comp-num num bold">
                                                {formatINR(comp.total_value)}
                                              </td>
                                              <td className="v4-batch-comp-share">
                                                <div className="v4-share-cell">
                                                  <span className="v4-share-pct">{comp.share_percentage}%</span>
                                                  <div className="v4-share-bar-track">
                                                    <div 
                                                      className="v4-share-bar-fill" 
                                                      style={{ width: `${Math.min(100, Math.max(0, comp.share_percentage))}%` }} 
                                                    />
                                                  </div>
                                                </div>
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                        <tfoot>
                                          <tr className="v4-batch-comp-total-row">
                                            <td colSpan={4} style={{ textAlign: "right", fontWeight: 700 }}>
                                              Consolidated Aggregate ({rec.batch_components.length} constituent items):
                                            </td>
                                            <td className="num bold" style={{ textAlign: "right" }}>
                                              {formatINR(rec.batch_components.reduce((sum, c) => sum + (c.taxable_value || 0), 0))}
                                            </td>
                                            <td className="num bold itc" style={{ textAlign: "right" }}>
                                              {formatINR(rec.batch_components.reduce((sum, c) => sum + (c.tax_amount || 0), 0))}
                                            </td>
                                            <td className="num bold" style={{ textAlign: "right" }}>
                                              {formatINR(rec.batch_components.reduce((sum, c) => sum + (c.total_value || 0), 0))}
                                            </td>
                                            <td style={{ textAlign: "right" }}>
                                              <span className="v4-share-pct total">100.0%</span>
                                            </td>
                                          </tr>
                                        </tfoot>
                                      </table>
                                    </div>
                                  </div>
                                )}

                                {/* 3. Statutory Audit Provenance & Findings */}
                                <div className="v4-inspector-provenance-card">
                                  <div className="v4-provenance-header">
                                    <ShieldCheck size={14} className="provenance-shield" />
                                    <span>Statutory Audit Provenance & Legal Basis</span>
                                  </div>
                                  <div className="v4-provenance-body">
                                    <p className="v4-provenance-reason">
                                      {rec.classification_reason || "Deterministic match verified against statutory parameters."}
                                    </p>
                                    {rec.ai_reason && (
                                      <p className="v4-provenance-ai-note">
                                        <strong>Audit Intelligence: </strong>{rec.ai_reason}
                                      </p>
                                    )}
                                  </div>
                                </div>

                                {/* 4. Technical JSON Payloads Drawer (Clean Collapsed Default) */}
                                <details className="v4-inspector-json-drawer">
                                  <summary className="v4-json-summary">
                                    <span>Technical Raw JSON Audit Payload (Dual Ledger Source)</span>
                                  </summary>
                                  <div className="v4-json-panes-grid">
                                    <div className="v4-json-pane">
                                      <span className="v4-json-pane-title">Government Portal GSTR-2B Raw</span>
                                      <pre>{JSON.stringify(rec.gstr_preview, null, 2)}</pre>
                                    </div>
                                    <div className="v4-json-pane">
                                      <span className="v4-json-pane-title">Internal Purchase Register (Books) Raw</span>
                                      <pre>{JSON.stringify(rec.pr_preview, null, 2)}</pre>
                                    </div>
                                  </div>
                                </details>
                              </div>
                            </td>
                          </tr>
                        );
                      })()}
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

      {/* DIRECTION 2: SUPERCHARGED AGENTIC TELEMETRY HUD MODAL */}
      {isRerunning && (
        <div
          className="v4-telemetry-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="v4-telemetry-title"
        >
          <div className="v4-telemetry-modal-container">
            <div className="v4-telemetry-glow-ribbon" />

            {/* Header with Title and Live Timer */}
            <div className="v4-telemetry-header">
              <div className="v4-telemetry-brand">
                <div className="v4-telemetry-icon-pulse">
                  <Activity size={20} />
                </div>
                <div>
                  <div id="v4-telemetry-title" className="v4-telemetry-title">
                    Autonomous 5-Pass Reconciliation Telemetry Engine
                  </div>
                  <div className="v4-telemetry-sub">
                    Dual-ledger progressive elimination &amp; combinatorial matching in real time
                  </div>
                </div>
              </div>

              <div className="v4-telemetry-meta">
                <div className="v4-telemetry-timer-badge">
                  <Clock size={13} />
                  <span>{(execElapsedMs / 1000).toFixed(1)}s elapsed</span>
                </div>
                <div className="v4-telemetry-active-badge">
                  {execPass < 5 ? `PASS 0${execPass} / 05 ACTIVE` : "FINALIZING AUDIT MATRIX"}
                </div>
              </div>
            </div>

            {/* Dual-Ledger Conduit Strip with Laser Scanline */}
            <div className="v4-telemetry-conduit">
              <div className="v4-conduit-ledger portal">
                <Landmark size={13} />
                <span>Government GSTR-2B Portal Stream</span>
              </div>
              <div className="v4-conduit-stream">
                <div className="v4-conduit-pulse-line" />
                <div className="v4-conduit-core-badge">
                  <Zap size={11} />
                  <span>5-PASS PIPELINE CONDUIT</span>
                </div>
              </div>
              <div className="v4-conduit-ledger books">
                <FileText size={13} />
                <span>Internal Books PR Ledger</span>
              </div>
            </div>

            {/* 5-Pass Stepper Grid */}
            <div className="v4-telemetry-passes-grid">
              {WATERFALL_STEPS_V4.map((step) => {
                const isPast = step.tier < execPass;
                const isCurrent = step.tier === execPass;
                const status = isPast ? "completed" : isCurrent ? "running" : "pending";

                return (
                  <div key={step.tier} className={`v4-pass-tile is-${status}`}>
                    <div className="v4-pass-tile-header">
                      <span className="v4-pass-num-label">PASS 0{step.tier}</span>
                      <div className="v4-pass-status-icon">
                        {isPast ? (
                          <CheckCircle2 size={16} className="v4-pass-check" />
                        ) : isCurrent ? (
                          <RefreshCw size={14} className="v4-spin" />
                        ) : (
                          <span className="v4-pass-pending-dot" />
                        )}
                      </div>
                    </div>

                    <div className="v4-pass-tile-body">
                      <div className="v4-pass-title">{step.name}</div>
                      <div className="v4-pass-desc">{step.desc}</div>
                    </div>

                    <div className="v4-pass-tile-footer">
                      <span className="v4-pass-highlight-pill">{step.highlight}</span>
                      <span className="v4-pass-state-text">
                        {isPast ? "COMPLETED" : isCurrent ? "SCANNING..." : "QUEUED"}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Bottom Progress Bar & Real-time Narrative */}
            <div className="v4-telemetry-bottom">
              <div className="v4-telemetry-progress-track">
                <div
                  className="v4-telemetry-progress-fill"
                  style={{
                    width: `${Math.min(100, Math.max(12, (execPass / 5) * 100))}%`,
                  }}
                />
              </div>

              <div className="v4-telemetry-narrative-bar">
                <div className="v4-narrative-left">
                  <span className="v4-narrative-pulse-dot" />
                  <span className="v4-narrative-text">{getPassNarrative(execPass)}</span>
                </div>
                <div className="v4-narrative-right">
                  {Math.round((execPass / 5) * 100)}% COMPLETE
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 5A. AMBIGUOUS TRANSACTION MANUAL CLASSIFICATION & AI RECOMMENDATION MODAL */}
      {selectedAmbiguousRecord && (
        <div className="v2-modal-backdrop" onClick={() => setSelectedAmbiguousRecord(null)}>
          <div className="v2-modal-content v2-reclassify-modal-shell" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="v2-modal-header">
              <div className="v2-modal-title-row">
                <Split size={20} color="#00338d" />
                <div>
                  <h3>Ambiguous Transaction Manual Classification</h3>
                  <span style={{ fontSize: 12.5, color: "#64748b" }}>
                    Record ID: {selectedAmbiguousRecord.id || "N/A"} • Invoice #{selectedAmbiguousRecord.document_number || "—"} • GSTIN: {selectedAmbiguousRecord.gstin || "—"}
                  </span>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {(() => {
                  const matchingClust = data?.ambiguities?.find(
                    (c) => c.cluster_id === selectedAmbiguousRecord.ambiguity_cluster_id
                  );
                  if (matchingClust && matchingClust.candidates?.length > 0) {
                    return (
                      <button
                        type="button"
                        style={{
                          background: "#e0f2fe",
                          color: "#0369a1",
                          border: "1px solid #bae6fd",
                          borderRadius: 6,
                          padding: "4px 10px",
                          fontSize: 11.5,
                          fontWeight: 700,
                          cursor: "pointer",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 5,
                        }}
                        onClick={() => {
                          setSelectedAmbiguousRecord(null);
                          setSelectedCluster(matchingClust);
                        }}
                      >
                        <Split size={12} />
                        <span>Probable Candidates ({matchingClust.candidates.length})</span>
                      </button>
                    );
                  }
                  return null;
                })()}
                <button
                  type="button"
                  className="v2-modal-close-btn"
                  onClick={() => setSelectedAmbiguousRecord(null)}
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="v2-modal-body">
              {/* 1. Side-by-Side Comparison */}
              <div className="v2-recon-split-container">
                {/* GSTR-2B Side */}
                <div className="v2-recon-side-card gstr-side">
                  <div className="v2-recon-side-header">
                    <span className="v2-recon-side-title gstr">
                      <FileSpreadsheet size={14} /> Counterparty (GSTR-2B)
                    </span>
                    <span style={{ fontSize: 11.5, color: "#1e40af", fontWeight: 700 }}>
                      {selectedAmbiguousRecord.gstr_record_id || "Portal Entry"}
                    </span>
                  </div>
                  <div className="v2-recon-kv-grid">
                    <div className="v2-recon-kv-item">
                      <span className="v2-recon-kv-label">GSTIN</span>
                      <span className="v2-recon-kv-value v2-gstin-code">
                        {selectedAmbiguousRecord.gstr_preview?.gstin || selectedAmbiguousRecord.gstin || "—"}
                      </span>
                    </div>
                    <div className="v2-recon-kv-item">
                      <span className="v2-recon-kv-label">Invoice Number</span>
                      <span className="v2-recon-kv-value v2-doc-num">
                        {selectedAmbiguousRecord.gstr_preview?.invoice_number || selectedAmbiguousRecord.document_number || "—"}
                      </span>
                    </div>
                    <div className="v2-recon-kv-item">
                      <span className="v2-recon-kv-label">Date</span>
                      <span className="v2-recon-kv-value">
                        {selectedAmbiguousRecord.gstr_preview?.invoice_date || selectedAmbiguousRecord.document_date || "—"}
                      </span>
                    </div>
                    <div className="v2-recon-kv-item">
                      <span className="v2-recon-kv-label">Taxable Value</span>
                      <span className="v2-recon-kv-value">
                        ₹{Number(selectedAmbiguousRecord.gstr_preview?.taxable_value ?? selectedAmbiguousRecord.taxable_value ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                    <div className="v2-recon-kv-item">
                      <span className="v2-recon-kv-label">Tax (ITC)</span>
                      <span className="v2-recon-kv-value" style={{ color: "#1e40af" }}>
                        ₹{Number(selectedAmbiguousRecord.gstr_preview?.igst ?? selectedAmbiguousRecord.tax_amount ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>
                </div>

                {/* PR Side */}
                <div className="v2-recon-side-card pr-side">
                  <div className="v2-recon-side-header">
                    <span className="v2-recon-side-title pr">
                      <ShieldCheck size={14} /> Enterprise Books (Purchase Register)
                    </span>
                    <span style={{ fontSize: 11.5, color: "#065f46", fontWeight: 700 }}>
                      {selectedAmbiguousRecord.pr_record_id || "ERP Voucher"}
                    </span>
                  </div>
                  <div className="v2-recon-kv-grid">
                    <div className="v2-recon-kv-item">
                      <span className="v2-recon-kv-label">GSTIN</span>
                      <span className="v2-recon-kv-value v2-gstin-code">
                        {selectedAmbiguousRecord.pr_preview?.gstin || selectedAmbiguousRecord.pr_preview?.GSTIN || (selectedAmbiguousRecord as any).target_gstin || selectedAmbiguousRecord.gstin || "—"}
                      </span>
                    </div>
                    <div className="v2-recon-kv-item">
                      <span className="v2-recon-kv-label">Invoice Number</span>
                      <span className="v2-recon-kv-value v2-doc-num">
                        {selectedAmbiguousRecord.pr_preview?.document_number || selectedAmbiguousRecord.pr_preview?.invoice_number || selectedAmbiguousRecord.pr_preview?.Invoice || (selectedAmbiguousRecord as any).target_doc_num || selectedAmbiguousRecord.document_number || "—"}
                      </span>
                    </div>
                    <div className="v2-recon-kv-item">
                      <span className="v2-recon-kv-label">Date</span>
                      <span className="v2-recon-kv-value">
                        {selectedAmbiguousRecord.pr_preview?.document_date || selectedAmbiguousRecord.pr_preview?.invoice_date || selectedAmbiguousRecord.pr_preview?.Date || (selectedAmbiguousRecord as any).target_date || "—"}
                      </span>
                    </div>
                    <div className="v2-recon-kv-item">
                      <span className="v2-recon-kv-label">Taxable Value</span>
                      <span className="v2-recon-kv-value">
                        {(() => {
                          const prTaxable = selectedAmbiguousRecord.pr_preview?.taxable_value ?? selectedAmbiguousRecord.pr_preview?.Taxable ?? (selectedAmbiguousRecord as any).target_taxable;
                          if (prTaxable !== undefined && prTaxable !== null) {
                            return `₹${Number(prTaxable).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
                          }
                          if (selectedAmbiguousRecord.taxable_value !== undefined && selectedAmbiguousRecord.variances?.taxable_diff !== undefined) {
                            const computedPr = Number(selectedAmbiguousRecord.taxable_value) - Number(selectedAmbiguousRecord.variances.taxable_diff);
                            return `₹${computedPr.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
                          }
                          return `₹${Number(selectedAmbiguousRecord.taxable_value ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
                        })()}
                      </span>
                    </div>
                    <div className="v2-recon-kv-item">
                      <span className="v2-recon-kv-label">Tax (ITC)</span>
                      <span className="v2-recon-kv-value" style={{ color: "#065f46" }}>
                        {(() => {
                          const prTax = selectedAmbiguousRecord.pr_preview?.tax_amount ?? selectedAmbiguousRecord.pr_preview?.igst ?? selectedAmbiguousRecord.pr_preview?.Tax ?? (selectedAmbiguousRecord as any).target_tax;
                          if (prTax !== undefined && prTax !== null) {
                            return `₹${Number(prTax).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
                          }
                          if (selectedAmbiguousRecord.tax_amount !== undefined && selectedAmbiguousRecord.variances?.tax_diff !== undefined) {
                            const computedPr = Number(selectedAmbiguousRecord.tax_amount) - Number(selectedAmbiguousRecord.variances.tax_diff);
                            return `₹${computedPr.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
                          }
                          return `₹${Number(selectedAmbiguousRecord.tax_amount ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
                        })()}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Variances Bar */}
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap", background: "#f8fafc", padding: "10px 16px", borderRadius: 8, fontSize: 12.5, alignItems: "center", border: "1px solid #e2e8f0" }}>
                <strong style={{ color: "#334155" }}>Detected Discrepancies:</strong>
                <span style={{ color: Number(selectedAmbiguousRecord.variances?.taxable_diff || 0) > 0 ? "#b45309" : "#166534", fontWeight: 700 }}>
                  Taxable Diff: ₹{Number(selectedAmbiguousRecord.variances?.taxable_diff || 0).toFixed(2)}
                </span>
                <span style={{ color: Number(selectedAmbiguousRecord.variances?.tax_diff || 0) > 0 ? "#b45309" : "#166534", fontWeight: 700 }}>
                  Tax Diff: ₹{Number(selectedAmbiguousRecord.variances?.tax_diff || 0).toFixed(2)}
                </span>
              </div>

              {/* 2. TARS AI & Deterministic Recommendation Card */}
              {isLoadingRecommendation ? (
                <div style={{ padding: 24, textAlign: "center", color: "#6366f1", display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
                  <RefreshCw size={18} className="v2-spin" />
                  <span>Evaluating hybrid statutory rules and generating recommendation...</span>
                </div>
              ) : recommendation ? (
                <div className="v2-ai-recom-card" style={{ flexShrink: 0, minHeight: "fit-content", overflow: "visible" }}>
                  <div className="v2-ai-recom-top">
                    <div className="v2-ai-recom-badge-group">
                      <span className="v2-ai-sparkle-badge">
                        <Sparkles size={13} /> TARS AI &amp; Deterministic Recommendation
                      </span>
                      <span className="v2-ai-confidence-pill">
                        {recommendation.confidence.toFixed(1)}% Confidence
                      </span>
                    </div>
                    <button
                      type="button"
                      className="v2-btn-accept-recom"
                      onClick={() => handleConfirmReclassification(recommendation.recommended_bucket)}
                      disabled={isReclassifying}
                    >
                      <Zap size={14} />
                      <span>⚡ Accept Recommendation &amp; Post ({recommendation.recommended_label})</span>
                    </button>
                  </div>

                  <div className="v2-ai-recom-heading">
                    <h4>Recommended Category:</h4>
                    <span className="v2-ai-recom-target">{recommendation.recommended_label}</span>
                  </div>

                  <p className="v2-ai-rationale-text">
                    {recommendation.accounting_rationale}
                  </p>

                  {recommendation.deterministic_factors && recommendation.deterministic_factors.length > 0 && (
                    <div className="v2-ai-factors-row">
                      <span style={{ fontSize: 11.5, fontWeight: 750, color: "#4338ca", textTransform: "uppercase" }}>
                        Key Factors:
                      </span>
                      {recommendation.deterministic_factors.map((f, fIdx) => (
                        <span key={fIdx} className="v2-ai-factor-chip">
                          ✓ {f}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}

              {/* 3. Five Standard Category Selector */}
              <div className="v2-category-options-section">
                <label className="v2-category-options-label">
                  Select Classification Category (All 5 Categories Available):
                </label>
                <div className="v2-category-grid">
                  {[
                    { id: "EXACT_MATCH", label: "Exact Match", sub: "Section 16(2)(aa) zero variance", icon: "✓" },
                    { id: "TOLERANCE_MATCH", label: "Tolerance Match", sub: "Within ±₹10 rounding margin", icon: "±" },
                    { id: "NEAR_MATCH", label: "Near Match", sub: "Doc punctuation / typo normalization", icon: "≈" },
                    { id: "GSTR_ONLY", label: "GSTR - 2B Match", sub: "GSTR-2B Only / Vendor Follow-up", icon: "→" },
                    { id: "PR_ONLY", label: "PR Match", sub: "Books Only / DRC-01C Audit Risk", icon: "←" },
                  ].map((cat) => {
                    const isSelected = targetBucket === cat.id;
                    const isRecommended = recommendation?.recommended_bucket === cat.id;
                    const confScore = recommendation?.category_confidences?.[cat.id] ?? (isRecommended ? recommendation?.confidence : undefined);
                    return (
                      <div
                        key={cat.id}
                        className={`v2-category-card ${isSelected ? "is-selected" : ""} ${isRecommended ? "is-recommended" : ""}`}
                        onClick={() => setTargetBucket(cat.id)}
                      >
                        {isRecommended && <span className="v2-category-recom-tag">AI Pick</span>}
                        <div className="v2-category-icon-wrap">{cat.icon}</div>
                        <span className="v2-category-name">{cat.label}</span>
                        <span className="v2-category-subtext">{cat.sub}</span>
                        {confScore !== undefined && (
                          <div
                            style={{
                              marginTop: 4,
                              fontSize: 10.5,
                              fontWeight: 750,
                              padding: "2px 7px",
                              borderRadius: 10,
                              background: isRecommended ? "#dbeafe" : confScore > 50 ? "#e0f2fe" : "#f1f5f9",
                              color: isRecommended ? "#1e40af" : confScore > 50 ? "#0369a1" : "#64748b",
                              border: isRecommended ? "1px solid #bfdbfe" : "1px solid #e2e8f0",
                            }}
                          >
                            {confScore.toFixed(0)}% Conf
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 4. Policy Determination Box (OKAY vs NOT OKAY) */}
              {(() => {
                const policyVerdict = recommendation?.category_policies?.[targetBucket];
                const isOkay = policyVerdict ? policyVerdict.verdict === "OKAY" : true;
                const msg = policyVerdict?.message || (
                  isOkay
                    ? "Transaction classification complies with standard statutory and commercial guidelines."
                    : "Discrepancy detected: verify voucher before manual override."
                );

                return (
                  <div className={`v2-policy-verdict-box ${isOkay ? "is-okay" : "is-not-okay"}`}>
                    <div className="v2-policy-icon-wrap">
                      {isOkay ? (
                        <CheckCircle2 size={18} color="#16a34a" />
                      ) : (
                        <AlertTriangle size={18} color="#d97706" />
                      )}
                    </div>
                    <div className="v2-policy-content">
                      <div className="v2-policy-status-title">
                        {isOkay ? "✓ Statutory Determination: OKAY" : "⚠️ Statutory Determination: NOT OKAY (Policy Override)"}
                      </div>
                      <p className="v2-policy-message">{msg}</p>
                    </div>
                  </div>
                );
              })()}

              {/* 5. Senior Reviewer Note */}
              <div className="v2-reviewer-note-wrap">
                <label>Reviewer Note / Justification (Audit Trail):</label>
                <textarea
                  className="v2-reviewer-note-input"
                  rows={2}
                  placeholder="e.g., Verified physical invoice #INV-101. Discrepancy accepted following cross-department verification."
                  value={reviewerNote}
                  onChange={(e) => setReviewerNote(e.target.value)}
                />
              </div>
            </div>

            {/* Footer */}
            <div className="v2-modal-footer">
              <button
                type="button"
                className="v2-btn-reject-all"
                onClick={() => setSelectedAmbiguousRecord(null)}
                disabled={isReclassifying}
              >
                Discard / Cancel
              </button>
              <button
                type="button"
                className="v2-btn-select-candidate"
                onClick={() => handleConfirmReclassification()}
                disabled={isReclassifying}
                style={{ background: "#00338d", color: "#ffffff", padding: "8px 20px" }}
              >
                {isReclassifying ? (
                  <>
                    <RefreshCw size={14} className="v2-spin" />
                    <span>Posting Classification...</span>
                  </>
                ) : (
                  <>
                    <Check size={14} />
                    <span>Confirm &amp; Post to {
                      targetBucket === "EXACT_MATCH" ? "Exact Match" :
                      targetBucket === "TOLERANCE_MATCH" ? "Tolerance Match" :
                      targetBucket === "NEAR_MATCH" ? "Near Match" :
                      targetBucket === "GSTR_ONLY" ? "GSTR - 2B Match (GSTR-2B Only)" : "PR Match (Books Only)"
                    }</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 5B. HUMAN-IN-THE-LOOP DISAMBIGUATION HUB MODAL */}
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
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button
                  type="button"
                  style={{
                    background: "#fef3c7",
                    color: "#b45309",
                    border: "1px solid #fde68a",
                    borderRadius: 6,
                    padding: "4px 10px",
                    fontSize: 11.5,
                    fontWeight: 700,
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                  }}
                  onClick={() => handleSwitchToReclassify(selectedCluster)}
                >
                  <Sparkles size={12} />
                  <span>5-Category AI Reclassification</span>
                </button>
                <button
                  type="button"
                  className="v2-modal-close-btn"
                  onClick={() => setSelectedCluster(null)}
                >
                  <X size={18} />
                </button>
              </div>
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
                    <span className="v2-doc-num">{selectedCluster.anchor_preview?.document_number || selectedCluster.anchor_preview?.invoice_number || "—"}</span>
                  </div>
                  <div className="v2-field-unit">
                    <label>Invoice Date</label>
                    <span>{selectedCluster.anchor_preview?.document_date || selectedCluster.anchor_preview?.invoice_date || "—"}</span>
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
                      ₹{Number(selectedCluster.anchor_preview?.tax_amount || selectedCluster.anchor_preview?.igst || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
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

              {/* Executive AI Recommendation Intelligence Banner */}
              {(() => {
                const topCand = selectedCluster.candidates[0];
                const secCand = selectedCluster.candidates[1];
                const gap = topCand && secCand ? (topCand.confidence_score - secCand.confidence_score).toFixed(1) : null;

                return (
                  <div style={{
                    background: "linear-gradient(135deg, #f0f7ff 0%, #f8fafc 100%)",
                    border: "1.5px solid #bfdbfe",
                    borderRadius: 12,
                    padding: "16px 20px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                    boxShadow: "0 2px 8px rgba(37,99,235,0.06)"
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{
                          background: "#2563eb",
                          color: "#fff",
                          width: 24,
                          height: 24,
                          borderRadius: 6,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontWeight: 800,
                          fontSize: 13
                        }}>
                          ★
                        </div>
                        <span style={{ fontSize: 13, fontWeight: 800, color: "#1e3a8a", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                          AI Match Intelligence • Conflict Disambiguation Engine
                        </span>
                      </div>
                      {topCand && (
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <span style={{
                            background: "#dcfce7",
                            color: "#15803d",
                            border: "1px solid #86efac",
                            padding: "3px 10px",
                            borderRadius: 20,
                            fontSize: 12,
                            fontWeight: 700
                          }}>
                            AI Top Pick: Candidate #1 ({topCand.confidence_score}%)
                          </span>
                          {secCand && gap !== null && (
                            <span style={{
                              background: "#fef3c7",
                              color: "#b45309",
                              border: "1px solid #fde68a",
                              padding: "3px 10px",
                              borderRadius: 20,
                              fontSize: 12,
                              fontWeight: 700
                            }}>
                              Close Call: Candidate #2 ({secCand.confidence_score}%, gap: {gap} pts)
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    <div style={{ fontSize: 13, color: "#334155", lineHeight: 1.5, background: "rgba(255,255,255,0.85)", padding: "10px 14px", borderRadius: 8, border: "1px solid #e2e8f0" }}>
                      {selectedCluster.ai_justification}
                    </div>

                    {topCand && (
                      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12, paddingTop: 2 }}>
                        <span style={{ fontSize: 12, color: "#64748b" }}>
                          AI Recommendation:
                        </span>
                        <button
                          type="button"
                          style={{
                            background: "linear-gradient(135deg, #16a34a 0%, #15803d 100%)",
                            color: "#fff",
                            border: "none",
                            borderRadius: 8,
                            padding: "8px 18px",
                            fontSize: 13,
                            fontWeight: 700,
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            cursor: "pointer",
                            boxShadow: "0 2px 6px rgba(22,163,74,0.25)"
                          }}
                          onClick={() => handleResolveAmbiguity(selectedCluster.cluster_id, topCand.candidate_id, "CHOOSE")}
                          disabled={isResolving}
                        >
                          <Check size={16} />
                          <span>Accept AI Top Pick (Bind Candidate #1: {topCand.pr_record_id})</span>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Candidates Side-by-Side Cards */}
              <div className="v2-candidates-grid">
                {selectedCluster.candidates.map((cand, idx) => {
                  const conf = cand.confidence_score;
                  const pillClass = conf >= 85 ? "high" : conf >= 70 ? "medium" : "low";
                  const isTopPick = idx === 0;
                  const isCloseCall = idx === 1;

                  return (
                    <div
                      key={cand.candidate_id}
                      className={`v2-candidate-card ${isTopPick ? "top-rank" : ""}`}
                      style={{
                        borderColor: isTopPick ? "#2563eb" : isCloseCall ? "#f59e0b" : "#e2e8f0",
                        background: isTopPick ? "linear-gradient(to bottom, #f8faff 0%, #ffffff 100%)" : isCloseCall ? "linear-gradient(to bottom, #fffdfa 0%, #ffffff 100%)" : "#ffffff",
                        boxShadow: isTopPick ? "0 4px 14px rgba(37,99,235,0.12)" : isCloseCall ? "0 4px 14px rgba(245,158,11,0.08)" : undefined
                      }}
                    >
                      {/* Badge for AI Ranking */}
                      {isTopPick && (
                        <div style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 5,
                          alignSelf: "flex-start",
                          background: "#dcfce7",
                          color: "#15803d",
                          border: "1px solid #86efac",
                          fontSize: 11,
                          fontWeight: 800,
                          padding: "2px 8px",
                          borderRadius: 6,
                          textTransform: "uppercase"
                        }}>
                          ⭐ AI Top Pick · Recommended
                        </div>
                      )}
                      {isCloseCall && (
                        <div style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 5,
                          alignSelf: "flex-start",
                          background: "#fef3c7",
                          color: "#b45309",
                          border: "1px solid #fde68a",
                          fontSize: 11,
                          fontWeight: 800,
                          padding: "2px 8px",
                          borderRadius: 6,
                          textTransform: "uppercase"
                        }}>
                          ⚠️ Close Call Competitor
                        </div>
                      )}
                      {!isTopPick && !isCloseCall && (
                        <div style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 5,
                          alignSelf: "flex-start",
                          background: "#f1f5f9",
                          color: "#475569",
                          border: "1px solid #cbd5e1",
                          fontSize: 11,
                          fontWeight: 800,
                          padding: "2px 8px",
                          borderRadius: 6,
                          textTransform: "uppercase"
                        }}>
                          Alternative Candidate #{idx + 1}
                        </div>
                      )}

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
                          <span className="v2-doc-num">{cand.pr_preview?.document_number || cand.pr_preview?.invoice_number || cand.pr_preview?.Invoice || "—"}</span>
                        </div>
                        <div className="v2-field-unit">
                          <label>Invoice Date</label>
                          <span>{cand.pr_preview?.document_date || cand.pr_preview?.invoice_date || cand.pr_preview?.Date || "—"}</span>
                        </div>
                        <div className="v2-field-unit">
                          <label>Taxable Amount</label>
                          <span className="v2-money-amt">
                            ₹{Number(cand.pr_preview?.taxable_value || cand.pr_preview?.Taxable || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
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
                          style={{
                            background: isTopPick ? "linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)" : isCloseCall ? "linear-gradient(135deg, #d97706 0%, #b45309 100%)" : undefined,
                            color: "#fff"
                          }}
                          onClick={() => handleResolveAmbiguity(selectedCluster.cluster_id, cand.candidate_id, "CHOOSE")}
                          disabled={isResolving}
                        >
                          <Check size={14} />
                          <span>{isTopPick ? `Bind Candidate #1 (AI Top Pick)` : isCloseCall ? `Bind Candidate #2 (Close Call)` : `Bind Candidate #${idx + 1}`}</span>
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
    </div>
  );
};

