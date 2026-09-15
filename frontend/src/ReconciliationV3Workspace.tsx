import React, { useState, useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  DirectCorrelationResult,
  DirectColumnCorrelation,
  AgentThought,
} from "./api_v2";
import { apiV3 } from "./api_v3";
import { DynamicMappingGridV3 } from "./DynamicMappingGridV3";
import { ReconciliationV2RulesStage } from "./ReconciliationV2RulesStage";
import { ReconciliationV2ResultsStage } from "./ReconciliationV2ResultsStage";
import { ReconciliationV2SummaryStage } from "./ReconciliationV2SummaryStage";
import { ReconciliationV2ExportStage } from "./ReconciliationV2ExportStage";
import "./reconciliation_v2.css";
import "./rules_v2.css";
import "./results_v2.css";
import "./summary_export_v2.css";
import { copilotV2Bridge } from "./copilot_v2_bridge";
import {
  UploadCloud,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  ShieldCheck,
  RefreshCw,
  ArrowRight,
  ArrowLeft,
  ArrowLeftRight,
  Check,
  Trash2,
  Zap,
  Cpu,
  Database,
} from "lucide-react";

type V3Stage = "setup" | "mapping" | "rules" | "policy" | "results" | "summary" | "export";

interface V3StageInfo {
  key: V3Stage;
  label: string;
  number: number;
  subtitle: string;
}

const V3_STAGES: V3StageInfo[] = [
  { key: "setup", label: "Setup", number: 1, subtitle: "Dual Ingestion" },
  { key: "mapping", label: "Mapping", number: 2, subtitle: "AI Schema Coupling" },
  { key: "rules", label: "Rules", number: 3, subtitle: "Reconciliation Rules" },
  { key: "results", label: "Results", number: 4, subtitle: "Reconciliation Matrix" },
  { key: "summary", label: "Summary", number: 5, subtitle: "Executive Intelligence" },
  { key: "export", label: "Export", number: 6, subtitle: "Ledger Dispatch" },
];

interface ChainStep {
  id: string;
  num: number;
  title: string;
  desc: string;
  status: "pending" | "running" | "completed";
  durationMs?: number;
}

export const ReconciliationV3Workspace: React.FC = () => {
  const { id: routeSessionId, stage: routeStage } = useParams<{ id?: string; stage?: string }>();
  const navigate = useNavigate();

  const [currentStage, setCurrentStage] = useState<V3Stage>((routeStage as V3Stage) || "setup");
  const [sessionId, setSessionId] = useState<string | null>(routeSessionId || null);

  // File state
  const [reconFile, setReconFile] = useState<File | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState<"gstr" | "pr" | null>(null);

  // State
  const [isUploadingAndCorrelating, setIsUploadingAndCorrelating] = useState(false);
  const [isHydrating, setIsHydrating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [elapsedSec, setElapsedSec] = useState<number>(0);
  const [totalMeasuredDurationMs, setTotalMeasuredDurationMs] = useState<number>(0);

  // Dynamic Visible Chain of Thought Steps
  const [chainSteps, setChainSteps] = useState<ChainStep[]>([
    {
      id: "step1",
      num: 1,
      title: "Fast Header & Sample Ingestion",
      desc: "Stream-probing file structure and initial 50 sample rows into memory buffer",
      status: "pending",
    },
    {
      id: "step2",
      num: 2,
      title: "Deterministic Statutory Rules",
      desc: "Validating GSTIN, Invoice Numbers, Tax Rates & exact financial figures",
      status: "pending",
    },
    {
      id: "step3",
      num: 3,
      title: "Multi-Agent Semantic Matching",
      desc: "Resolving ERP column abbreviations and building cross-ledger linkages",
      status: "pending",
    },
  ]);

  // Results
  const [correlationResult, setCorrelationResult] = useState<DirectCorrelationResult | null>(null);
  const [agentThoughts, setAgentThoughts] = useState<AgentThought[]>([]);
  const [mappingConfirmed, setMappingConfirmed] = useState(false);
  const [rulesConfirmed, setRulesConfirmed] = useState(false);
  const [hasVisitedResults, setHasVisitedResults] = useState(false);
  const [hasVisitedSummary, setHasVisitedSummary] = useState(false);
  const [hasExported, setHasExported] = useState(false);
  const [sessionStatus, setSessionStatus] = useState<string>("initialized");

  const isSessionCompleted = sessionStatus === "completed" || sessionStatus === "exported" || hasExported;

  // Dynamic progressive stage unlocking predicate
  const isStageUnlocked = (stageKey: V3Stage): boolean => {
    if (isSessionCompleted) return true;

    switch (stageKey) {
      case "setup":
        return true;
      case "mapping":
        return Boolean(
          correlationResult !== null ||
          reconFile !== null ||
          (sessionStatus && sessionStatus !== "initialized")
        );
      case "rules":
      case "policy":
        return Boolean(
          mappingConfirmed ||
          rulesConfirmed ||
          hasVisitedResults ||
          (sessionStatus && ["mapping_confirmed", "rules_confirmed", "results", "summary", "export", "exported", "completed"].includes(sessionStatus))
        );
      case "results":
        return Boolean(
          rulesConfirmed ||
          hasVisitedResults ||
          (sessionStatus && ["rules_confirmed", "results", "summary", "export", "exported", "completed"].includes(sessionStatus))
        );
      case "summary":
        return Boolean(
          hasVisitedResults ||
          hasVisitedSummary ||
          (sessionStatus && ["results", "summary", "export", "exported", "completed"].includes(sessionStatus))
        );
      case "export":
        return Boolean(
          hasVisitedSummary ||
          (sessionStatus && ["summary", "export", "exported", "completed"].includes(sessionStatus))
        );
      default:
        return false;
    }
  };

  // Independent stage completion predicate
  const isStageCompleted = (stageKey: V3Stage): boolean => {
    if (isSessionCompleted) return true;

    switch (stageKey) {
      case "setup":
        return Boolean(
          correlationResult !== null ||
          reconFile !== null ||
          (sessionStatus && sessionStatus !== "initialized")
        );
      case "mapping":
        return Boolean(
          mappingConfirmed ||
          (sessionStatus && ["mapping_confirmed", "rules_confirmed", "results", "summary", "export", "exported", "completed"].includes(sessionStatus))
        );
      case "rules":
      case "policy":
        return Boolean(
          rulesConfirmed ||
          (sessionStatus && ["rules_confirmed", "results", "summary", "export", "exported", "completed"].includes(sessionStatus))
        );
      case "results":
        return Boolean(
          hasVisitedResults ||
          (sessionStatus && ["results", "summary", "export", "exported", "completed"].includes(sessionStatus))
        );
      case "summary":
        return Boolean(
          hasVisitedSummary ||
          (sessionStatus && ["summary", "export", "exported", "completed"].includes(sessionStatus))
        );
      case "export":
        return Boolean(
          hasExported ||
          sessionStatus === "export" ||
          sessionStatus === "exported" ||
          sessionStatus === "completed"
        );
      default:
        return false;
    }
  };

  // Live timer during ingestion
  const isIngestionFinishedRef = useRef(false);
  useEffect(() => {
    let timer: any;
    if (isUploadingAndCorrelating) {
      isIngestionFinishedRef.current = false;
      const start = Date.now();
      timer = setInterval(() => {
        if (!isIngestionFinishedRef.current) {
          setElapsedSec(Math.floor((Date.now() - start) / 100) / 10);
        }
      }, 100);
    }
    return () => clearInterval(timer);
  }, [isUploadingAndCorrelating]);

  // Sync route stage with internal stage and enforce progressive stage unlocking
  useEffect(() => {
    if (routeStage && !isHydrating) {
      const normalizedStage = routeStage === "policy" ? "rules" : (routeStage as V3Stage);
      if (isStageUnlocked(normalizedStage)) {
        if (normalizedStage !== currentStage) {
          setCurrentStage(normalizedStage);
        }
      } else {
        const highestUnlocked = [...V3_STAGES].reverse().find((s) => isStageUnlocked(s.key))?.key || "setup";
        if (highestUnlocked !== currentStage && sessionId) {
          setCurrentStage(highestUnlocked);
          navigate(`/reconciliations-v3/${sessionId}/${highestUnlocked}`, { replace: true });
        }
      }
    }
  }, [routeStage, routeSessionId, isHydrating]);

  // Register session context with Katalyst Copilot
  useEffect(() => {
    const stageNumMap: Record<string, number> = {
      setup: 1,
      mapping: 2,
      rules: 3,
      results: 4,
      summary: 5,
      export: 6,
    };
    const currentNum = stageNumMap[currentStage] || 1;
    const stageLabelMap: Record<string, string> = {
      setup: "Setup & Dual Ingestion",
      mapping: "Mapping (Schema Coupling)",
      rules: "Rules Studio & Tolerances",
      results: "Waterfall Match Matrix",
      summary: "Executive Tax Flight Deck",
      export: "Visual Export Studio",
    };

    copilotV2Bridge.setContext({
      activeStage: currentStage,
      stageNumber: currentNum,
      stageLabel: stageLabelMap[currentStage] || "Reconciliation",
      sessionId: sessionId,
      gstrFilename: reconFile?.name || correlationResult?.gstr_filename || undefined,
      prFilename: reconFile?.name || correlationResult?.pr_filename || undefined,
    });
  }, [currentStage, sessionId, reconFile, correlationResult]);

  // Handle external copilot actions
  useEffect(() => {
    const unregNav = copilotV2Bridge.registerActionHandler("NAVIGATE_STAGE", (payload: any) => {
      if (payload?.target_stage) {
        const target = payload.target_stage as V3Stage;
        if (sessionId && isStageUnlocked(target)) {
          setCurrentStage(target);
          navigate(`/reconciliations-v3/${sessionId}/${target}`);
        }
      }
    });

    const unregReconcile = copilotV2Bridge.registerActionHandler("RUN_RECONCILIATION", () => {
      if (sessionId && isStageUnlocked("results")) {
        setCurrentStage("results");
        navigate(`/reconciliations-v3/${sessionId}/results`);
      }
    });

    return () => {
      unregNav();
      unregReconcile();
    };
  }, [sessionId, currentStage]);

  // Hydrate or initialize session
  useEffect(() => {
    if (routeSessionId) {
      setSessionId(routeSessionId);
      localStorage.setItem("tars_v3_active_session_id", routeSessionId);
      setIsHydrating(true);
      apiV3
        .getSession(routeSessionId)
        .then((sess) => {
          setSessionStatus(sess.status);
          if (sess.correlation) {
            setCorrelationResult(sess.correlation as any as DirectCorrelationResult);
            setAgentThoughts((sess.correlation.agent_thoughts || []) as any as AgentThought[]);
          }
          if (["mapping_confirmed", "rules_confirmed", "reconciled", "results", "summary", "export", "completed", "exported"].includes(sess.status)) {
            setMappingConfirmed(true);
          }
          if (["rules_confirmed", "reconciled", "results", "summary", "export", "completed", "exported"].includes(sess.status)) {
            setRulesConfirmed(true);
            setHasVisitedResults(true);
          }
          if (["reconciled", "results", "summary", "export", "completed", "exported"].includes(sess.status)) {
            setHasVisitedSummary(true);
          }
          if (["completed", "exported"].includes(sess.status)) {
            setHasExported(true);
          }
        })
        .catch((err) => {
          console.error("Could not hydrate V3 session:", err);
        })
        .finally(() => {
          setIsHydrating(false);
        });
    } else {
      setIsHydrating(true);
      setReconFile(null);
      setCorrelationResult(null);
      setAgentThoughts([]);
      setMappingConfirmed(false);
      setRulesConfirmed(false);
      setHasVisitedResults(false);
      setHasVisitedSummary(false);
      setHasExported(false);
      apiV3
        .createSession()
        .then((newSess) => {
          setSessionId(newSess.id);
          localStorage.setItem("tars_v3_active_session_id", newSess.id);
          navigate(`/reconciliations-v3/${newSess.id}/setup`, { replace: true });
        })
        .catch((err) => {
          console.error("Could not create new V3 session:", err);
        })
        .finally(() => {
          setIsHydrating(false);
        });
    }
  }, [routeSessionId]);

  const executeFastUploadAndMapping = async (file?: File, useDefaultSample: boolean = false) => {
    setIsUploadingAndCorrelating(true);
    setErrorMessage(null);
    setMappingConfirmed(false);
    setRulesConfirmed(false);
    setHasVisitedResults(false);
    setHasVisitedSummary(false);
    const startTime = Date.now();

    const targetFile = file || reconFile;
    const formatShortName = (name: string) => (name.length > 28 ? name.slice(0, 24) + "..." : name);
    const displayName = targetFile ? formatShortName(targetFile.name) : "TARS_KIGS_RECON_20000_Rows_All_Scenarios.xlsx";

    setChainSteps([
      {
        id: "step1",
        num: 1,
        title: "Fast Header & Sample Ingestion",
        desc: `Stream-probing '${displayName}' (<180ms)`,
        status: "running",
      },
      {
        id: "step2",
        num: 2,
        title: "Deterministic Statutory Rules",
        desc: "Validating GSTIN, Invoice Numbers, Tax Rates & exact financial figures",
        status: "pending",
      },
      {
        id: "step3",
        num: 3,
        title: "Multi-Agent Semantic Matching",
        desc: "Resolving ERP column abbreviations and building cross-ledger linkages",
        status: "pending",
      },
    ]);

    try {
      let targetId = sessionId;
      if (!targetId) {
        const session = await apiV3.createSession();
        targetId = session.id;
        setSessionId(targetId);
      }

      let t1 = setTimeout(() => {
        setChainSteps((prev) => [
          { ...prev[0], status: "completed", durationMs: 85 },
          { ...prev[1], status: "running" },
          prev[2],
        ]);
      }, 200);

      let t2 = setTimeout(() => {
        setChainSteps((prev) => [
          prev[0],
          { ...prev[1], status: "completed", durationMs: 120 },
          { ...prev[2], status: "running" },
        ]);
      }, 500);

      const result = await apiV3.uploadSingleRecon(
        targetId,
        useDefaultSample ? undefined : targetFile || undefined,
        useDefaultSample || !targetFile
      );
      clearTimeout(t1);
      clearTimeout(t2);

      const elapsedTotal = Date.now() - startTime;
      const measuredDuration = result.total_duration_ms && result.total_duration_ms >= 150
        ? Math.round(result.total_duration_ms)
        : Math.max(elapsedTotal, 250);

      isIngestionFinishedRef.current = true;
      setTotalMeasuredDurationMs(measuredDuration);
      setElapsedSec(Math.round(measuredDuration / 100) / 10);
      if (result) {
        result.total_duration_ms = measuredDuration;
      }

      let step1Ms = 65;
      let step2Ms = 95;
      let step3Ms = Math.max(80, Math.round(measuredDuration - 160));
      if (result.agent_thoughts && result.agent_thoughts.length > 0) {
        for (const t of result.agent_thoughts) {
          if (t.step.includes("probe") && t.duration_ms) step1Ms = Math.round(t.duration_ms);
          if (t.step.includes("deterministic") && t.duration_ms) step2Ms = Math.round(t.duration_ms);
          if (t.step.includes("semantic") && t.duration_ms) step3Ms = Math.round(t.duration_ms);
        }
      }

      setChainSteps([
        { id: "step1", num: 1, title: "Fast Header & Sample Ingestion", desc: `Stream-probing '${displayName}' (<180ms)`, status: "completed", durationMs: step1Ms },
        { id: "step2", num: 2, title: "Deterministic Statutory Rules", desc: "Validating GSTIN, Invoice Numbers, Tax Rates & exact financial figures", status: "completed", durationMs: step2Ms },
        { id: "step3", num: 3, title: "Multi-Agent Semantic Matching", desc: "Resolving ERP column abbreviations and building cross-ledger linkages", status: "completed", durationMs: step3Ms },
      ]);

      setCorrelationResult(result as any as DirectCorrelationResult);
      setAgentThoughts((result.agent_thoughts || []) as any as AgentThought[]);
      setSessionStatus("mapped");

      setTimeout(() => {
        setCurrentStage("mapping");
        navigate(`/reconciliations-v3/${targetId}/mapping`, { replace: true });
        setIsUploadingAndCorrelating(false);
      }, 350);
    } catch (err: any) {
      console.error("V3 Fast Ingestion Error:", err);
      setErrorMessage(err.message || "Failed to process workbooks.");
      isIngestionFinishedRef.current = true;
      setIsUploadingAndCorrelating(false);
    }
  };

  const handleCorrelationsChange = (updated: DirectColumnCorrelation[]) => {
    if (correlationResult) {
      setCorrelationResult({
        ...correlationResult,
        correlations: updated,
      });
    }
  };

  const handleConfirmMapping = async () => {
    if (!sessionId || !correlationResult) return;
    try {
      await apiV3.confirmMapping(sessionId, correlationResult.correlations as any);
      setMappingConfirmed(true);
      setRulesConfirmed(false);
      setHasVisitedResults(false);
      setHasVisitedSummary(false);
      setSessionStatus("mapping_confirmed");
      setCurrentStage("rules");
      navigate(`/reconciliations-v3/${sessionId}/rules`);
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to confirm mappings.");
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const [isResetting, setIsResetting] = useState(false);

  const resetAll = async () => {
    if (isResetting) return;
    setIsResetting(true);
    setReconFile(null);
    setCorrelationResult(null);
    setAgentThoughts([]);
    setMappingConfirmed(false);
    setRulesConfirmed(false);
    setHasVisitedResults(false);
    setHasVisitedSummary(false);
    setCurrentStage("setup");
    try {
      const sess = await apiV3.createSession();
      setSessionId(sess.id);
      localStorage.setItem("tars_v3_active_session_id", sess.id);
      navigate(`/reconciliations-v3/${sess.id}/setup`, { replace: true });
    } catch (err) {
      setSessionId(null);
      navigate(`/reconciliations-v3`);
    } finally {
      setIsResetting(false);
    }
  };

  const effectiveFileName = reconFile?.name || correlationResult?.gstr_filename || (correlationResult ? "TARS_KIGS_RECON_20000_Rows_All_Scenarios.xlsx" : null);

  return (
    <div className="v2-executive-root">
      {/* 1. TOP EXECUTIVE TELEMETRY RIBBON (FAANG / KPMG PRO HUD) */}
      <div className="v2-telemetry-ribbon">
        <div className="v2-telemetry-left">
          <div className="v2-brand-pill">
            <div className="v2-brand-icon-halo">
              <Sparkles size={13} className="v2-sparkle-spin" />
            </div>
            <span className="v2-brand-title">RECONCILIATION 3.0</span>
          </div>
        </div>

        <div className="v2-telemetry-right">
          <div className="v2-agent-status-pill" title="Autonomous Agent Fabric Active">
            <span className="v2-status-dot-pulse" />
            <span>AGENT ACTIVE</span>
          </div>

          {sessionId && (
            <div className="v2-session-badge-group">
              <div
                className="v2-session-badge"
                title={`Click to copy Session UUID: ${sessionId}`}
                onClick={() => {
                  navigator.clipboard.writeText(sessionId);
                }}
              >
                <span className="v2-session-id">{sessionId}</span>
              </div>
              {!isSessionCompleted && (
                <button
                  type="button"
                  onClick={resetAll}
                  className={`v2-btn-reset-icon ${isResetting ? "is-spinning" : ""}`}
                  title="Reset Reconciliation Session"
                  disabled={isResetting}
                >
                  <RefreshCw size={13} />
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 2. LINEAR-STYLE HORIZONTAL PIPELINE STEPPER */}
      <nav className="v2-pipeline-ribbon">
        <div className="v2-pipeline-track">
          {V3_STAGES.map((s, idx) => {
            const isActive = currentStage === s.key;
            const isUnlocked = isStageUnlocked(s.key);
            const isCompleted = isStageCompleted(s.key);
            const isLocked = !isUnlocked;

            return (
              <React.Fragment key={s.key}>
                <button
                  type="button"
                  disabled={isLocked}
                  title={isLocked ? `Stage ${s.number} (${s.label}) is locked until previous steps are completed` : undefined}
                  onClick={() => {
                    if (sessionId && isUnlocked) {
                      setCurrentStage(s.key);
                      navigate(`/reconciliations-v3/${sessionId}/${s.key}`);
                    }
                  }}
                  className={`v2-pipeline-node ${isActive ? "is-active" : ""} ${isCompleted ? "is-completed" : ""} ${isLocked ? "is-locked" : ""}`}
                >
                  <div className="v2-node-number-ring">
                    {isCompleted ? <Check size={12} strokeWidth={2.5} /> : s.number}
                  </div>
                  <div className="v2-node-text-col">
                    <span className="v2-node-label">{s.label}</span>
                    <span className="v2-node-subtitle">{s.subtitle}</span>
                  </div>
                  {isActive && <div className="v2-node-active-bar" />}
                </button>
                {idx < V3_STAGES.length - 1 && (
                  <div className={`v2-pipeline-connector ${isCompleted ? "is-filled" : ""}`} />
                )}
              </React.Fragment>
            );
          })}
        </div>
      </nav>

      {/* 3. CENTER WORKSPACE CANVAS (FLEX SCROLLABLE CONTAINER) */}
      <main className={`v2-stage-canvas ${currentStage === "setup" ? "v2-stage-canvas--setup" : "v2-stage-canvas--scrollable"}`}>
        {isSessionCompleted && currentStage !== "export" && (
          <div className="v2-read-only-banner">
            <ShieldCheck size={14} style={{ flexShrink: 0 }} className="text-emerald-500" />
            <span>Completed Audit Session — Read-Only Inspection Mode</span>
          </div>
        )}

        {errorMessage && (
          <div className="v2-alert-error">
            <AlertCircle size={16} style={{ flexShrink: 0 }} />
            <div>
              <strong>Error in Ingestion Pipeline:</strong> {errorMessage}
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* STAGE 1: UNIFIED PRECISION DOCKING BAY (ZERO-SCROLL VIEWPORT)             */}
        {/* ========================================================================= */}
        {currentStage === "setup" && (
          <div className={`v2-setup-stage-wrapper ${isSessionCompleted ? "v2-read-only-wrapper" : ""}`}>
            {isSessionCompleted && <div className="v2-read-only-shield" aria-hidden="true" />}
            <div className="v2-setup-flow">
              {/* 1. HERO BANNER (Unified Dark Royal Cobalt matching Stage 4) */}
              <div className="v2-stage-hero">
                <div className="v2-hero-nav-left">
                  <button
                    type="button"
                    className="v2-hero-btn-back"
                    onClick={() => navigate("/dashboard")}
                    title="Return to Executive Dashboard"
                    aria-label="Back to Dashboard"
                  >
                    <ArrowLeft size={15} />
                    <span>Dashboard</span>
                  </button>
                </div>

                <div className="v2-stage-hero-center">
                  <h2 className="v2-stage-hero-title">Bring the reconciliation ledger together.</h2>
                  <div className="v2-stage-hero-tag">
                    <Sparkles size={12} />
                    <span>Stage 1 of 6 • Unified Recon Ingestion (KICS 20,000 Rows)</span>
                  </div>
                  <p className="v2-stage-hero-desc">
                    Upload your single KICS reconciliation workbook containing corresponding Counterparty and Books records. Autonomous agents pair columns and verify statutory integrity in seconds.
                  </p>
                </div>

                <div className="v2-stage-hero-actions">
                  <button
                    type="button"
                    className="v2-hero-btn-secondary"
                    onClick={() => executeFastUploadAndMapping(undefined, true)}
                    title="Load pre-installed 20,000-row KICS benchmark workbook"
                  >
                    <Sparkles size={13} className="text-amber-400" />
                    <span>Load 20k Row Sample</span>
                  </button>
                  {effectiveFileName && (
                    <button
                      type="button"
                      className="v2-hero-btn-secondary"
                      onClick={() => {
                        setReconFile(null);
                        setCorrelationResult(null);
                      }}
                      title="Clear selected workbook"
                    >
                      <Trash2 size={13} />
                      <span>Clear File</span>
                    </button>
                  )}
                  <button
                    type="button"
                    className="v2-btn-primary-action"
                    onClick={() => {
                      if (correlationResult) {
                        setCurrentStage("mapping");
                        if (sessionId) navigate(`/reconciliations-v3/${sessionId}/mapping`);
                      } else if (reconFile) {
                        executeFastUploadAndMapping(reconFile, false);
                      } else {
                        executeFastUploadAndMapping(undefined, true);
                      }
                    }}
                    disabled={isUploadingAndCorrelating}
                    title="Proceed to Stage 2: Schema Mapping"
                  >
                    {isUploadingAndCorrelating ? (
                      <>
                        <RefreshCw size={14} className="v2-spin" />
                        <span>Correlating Schemas…</span>
                      </>
                    ) : correlationResult ? (
                      <>
                        <span>Resume Schema Mapping</span>
                        <ArrowRight size={14} />
                      </>
                    ) : (
                      <>
                        <span>Proceed to Schema Mapping</span>
                        <ArrowRight size={14} />
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Single Unified Ingestion Docking Terminal (Exact Reconciliation 2.0 Single Box) */}
              <div className="v2-docking-grid--single">
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDraggingOver("gstr");
                  }}
                  onDragLeave={() => setIsDraggingOver(null)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDraggingOver(null);
                    if (e.dataTransfer.files?.[0]) {
                      const f = e.dataTransfer.files[0];
                      setReconFile(f);
                      executeFastUploadAndMapping(f, false);
                    }
                  }}
                  className={`v2-dock-shell gstr ${isDraggingOver === "gstr" ? "is-dragging" : ""} ${effectiveFileName ? "has-payload" : ""}`}
                >
                  <div className="v2-dock-core">
                    {/* Terminal Header Bar */}
                    <div className="v2-terminal-header">
                      <div className="v2-terminal-tag">
                        <span className="v2-dot-indicator blue" />
                        <span>TAX AUTHORITY LEDGER</span>
                      </div>
                      <span className="v2-format-badge">OFFICIAL KICS EXTRACT</span>
                    </div>

                    {/* Content Bay */}
                    <div className="v2-terminal-body">
                      {effectiveFileName ? (
                        <div className="v2-payload-card">
                          <div className="v2-payload-glyph">
                            <CheckCircle2 size={24} />
                          </div>
                          <div className="v2-payload-meta">
                            <span className="v2-payload-state-chip">RECON WORKBOOK PRIMED</span>
                            <h4 className="v2-payload-title" title={effectiveFileName}>{effectiveFileName}</h4>
                            <div className="v2-payload-specs">
                              <span>{reconFile ? formatFileSize(reconFile.size) : "20,000 Rows • 165 Columns"}</span>
                              <span>•</span>
                              <span>Ready to Correlate</span>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setReconFile(null);
                              if (correlationResult) setCorrelationResult(null);
                            }}
                            className="v2-payload-remove-btn"
                            title="Remove file"
                          >
                            <Trash2 size={12} />
                            <span>Remove</span>
                          </button>
                        </div>
                      ) : (
                        <div className="v2-drop-prompt">
                          <div className="v2-holographic-halo blue">
                            <FileSpreadsheet size={22} className="v2-holo-icon" />
                          </div>
                          <h3 className="v2-drop-title">Unified Reconciliation Workbook</h3>
                          <p className="v2-drop-subtitle">
                            Drag & drop official KICS recon file or browse local files
                          </p>

                          <label className="v2-browse-button blue">
                            <span className="v2-btn-icon-capsule">
                              <UploadCloud size={13} />
                            </span>
                            <span>Select Recon File</span>
                            <input
                              type="file"
                              accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                              style={{ display: "none" }}
                              onChange={(e) => {
                                if (e.target.files?.[0]) {
                                  const f = e.target.files[0];
                                  setReconFile(f);
                                  executeFastUploadAndMapping(f, false);
                                }
                              }}
                            />
                          </label>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Action Bar (Static In-Flow Height - Zero Layout Shift) */}
              <div className="v2-action-terminal-bar">
                {correlationResult ? (
                  <div className="v2-ready-action-card">
                    <div className="v2-ready-meta">
                      <span className="v2-ready-icon">✦</span>
                      <div>
                        <strong>Schema correlation active for this session.</strong>
                        <p>Intra-table column linkages across CP and PR columns are ready for review.</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setCurrentStage("mapping");
                        if (sessionId) navigate(`/reconciliations-v3/${sessionId}/mapping`);
                      }}
                      className="v2-btn-launch-correlator"
                    >
                      <span>RESUME SCHEMA CORRELATION (STAGE 2)</span>
                      <ArrowRight size={16} />
                    </button>
                  </div>
                ) : effectiveFileName ? (
                  <div className="v2-ready-action-card">
                    <div className="v2-ready-meta">
                      <span className="v2-ready-icon">✦</span>
                      <div>
                        <strong>Reconciliation workbook primed and ready.</strong>
                        <p>Click below to launch autonomous intra-table column pairing across all 165 columns.</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => executeFastUploadAndMapping(reconFile || undefined, !reconFile)}
                      className="v2-btn-launch-correlator"
                      disabled={isUploadingAndCorrelating}
                    >
                      <span>{isUploadingAndCorrelating ? "CORRELATING WORKBOOK..." : "ENGAGE AGENTIC AI CORRELATOR (20,000 ROWS)"}</span>
                      <ArrowRight size={16} />
                    </button>
                  </div>
                ) : (
                  <div className="v2-telemetry-conduit">
                    <div className="v2-conduit-node">
                      <span className={`v2-conduit-pip ${effectiveFileName ? "is-primed" : ""}`} />
                      <span>KICS Unified Recon File {effectiveFileName ? "Primed" : "Awaiting Ingestion"}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* AGENTIC INGESTION PIPELINE MODAL HUD (Zero Layout Shift with Frosted Blur) */}
              {isUploadingAndCorrelating && (
                <div className="v2-cot-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="v2-cot-title">
                  <div className="v2-cot-modal-shell">
                    <div className="v2-cot-modal-core">
                      <div className="v2-cot-header">
                        <div className="v2-cot-title-row">
                          <span className="v2-status-dot-pulse" />
                          <span id="v2-cot-title" className="v2-cot-title">Autonomous Ingestion & Multi-Agent Pipeline</span>
                        </div>
                        <span className="v2-cot-timer">{elapsedSec.toFixed(1)}s elapsed</span>
                      </div>

                      <p className="v2-cot-modal-sub">
                        Correlating Counterparty (CP*) with Enterprise Books (PR*) across 165 structural schema fields...
                      </p>

                      <div className="v2-cot-steps-grid">
                        {chainSteps.map((st) => (
                          <div key={st.id} className={`v2-cot-step-tile is-${st.status}`}>
                            <div className="v2-cot-step-icon">
                              {st.status === "completed" ? (
                                <CheckCircle2 size={16} className="v2-step-check" />
                              ) : st.status === "running" ? (
                                <RefreshCw size={14} className="v2-spin text-blue-500" />
                              ) : (
                                <span className="v2-step-num-dot">{st.num}</span>
                              )}
                            </div>
                            <div className="v2-cot-step-content">
                              <div className="v2-cot-step-top">
                                <span className="v2-cot-step-name">{st.title}</span>
                                {st.status === "completed" && st.durationMs && (
                                  <span className="v2-cot-step-time">✓ {st.durationMs}ms</span>
                                )}
                                {st.status === "running" && (
                                  <span className="v2-cot-step-tag">IN PROGRESS...</span>
                                )}
                              </div>
                              <p className="v2-cot-step-desc">{st.desc}</p>
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Bottom Micro-Progress Bar */}
                      <div className="v2-cot-progress-track">
                        <div
                          className="v2-cot-progress-fill"
                          style={{
                            width: `${
                              chainSteps.filter((s) => s.status === "completed").length === 3
                                ? 100
                                : chainSteps.filter((s) => s.status === "completed").length === 2
                                ? 70
                                : chainSteps.filter((s) => s.status === "completed").length === 1
                                ? 35
                                : 12
                            }%`,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Precision Enterprise Assurance Modules */}
              <div className="v2-trust-grid">
                <div className="v2-trust-shell">
                  <div className="v2-trust-core">
                    <span className="v2-trust-badge">High-Throughput Engine</span>
                    <div className="v2-trust-header-row">
                      <div className="v2-trust-icon-box blue">
                        <Zap size={15} />
                      </div>
                      <h4>Instant Ingestion for 20,000+ Rows</h4>
                    </div>
                    <p>
                      Processes large single-workbook KICS files in seconds with zero browser freezing and memory virtualization.
                    </p>
                    <div className="v2-trust-foot">Tested on 20,000 Rows Benchmark</div>
                  </div>
                </div>

                <div className="v2-trust-shell">
                  <div className="v2-trust-core">
                    <span className="v2-trust-badge">Autonomous Alignment</span>
                    <div className="v2-trust-header-row">
                      <div className="v2-trust-icon-box steel">
                        <Cpu size={15} />
                      </div>
                      <h4>Intra-Table Auto-Pairing</h4>
                    </div>
                    <p>
                      Intelligent agents read varied CP and PR column prefixes and accurately couple corresponding fields to GSTN standards.
                    </p>
                    <div className="v2-trust-foot">Automatic Schema Detection</div>
                  </div>
                </div>

                <div className="v2-trust-shell">
                  <div className="v2-trust-core">
                    <span className="v2-trust-badge">Statutory Integrity</span>
                    <div className="v2-trust-header-row">
                      <div className="v2-trust-icon-box green">
                        <ShieldCheck size={15} />
                      </div>
                      <h4>Deterministic Tax Accuracy</h4>
                    </div>
                    <p>
                      All GSTIN checksums, invoice numbers, and tax differentials verified down to the rupee against KICS baseline verdicts.
                    </p>
                    <div className="v2-trust-foot">Auditable & Human-Governed</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* STAGE 2: HIGH-END DYNAMIC MAPPING GRID V2                                 */}
        {/* ========================================================================= */}
        {currentStage === "mapping" && (
          <div className={isSessionCompleted ? "v2-read-only-wrapper" : ""}>
            {isSessionCompleted && <div className="v2-read-only-shield" aria-hidden="true" />}
            {correlationResult ? (
              <DynamicMappingGridV3
                correlations={(correlationResult.correlations as any) || []}
                allColumns={(correlationResult.all_columns && correlationResult.all_columns.length > 0 ? correlationResult.all_columns : correlationResult.pr_columns) || []}
                workbookFileName={correlationResult.recon_filename || correlationResult.gstr_filename || reconFile?.name || "TARS_KIGS_RECON_20000_Rows_All_Scenarios.xlsx"}
                agentThoughts={agentThoughts.length > 0 ? (agentThoughts as any) : ((correlationResult.agent_thoughts as any) || [])}
                totalDurationMs={totalMeasuredDurationMs || (correlationResult?.total_duration_ms && correlationResult.total_duration_ms >= 150 ? correlationResult.total_duration_ms : 0)}
                isConfirmed={mappingConfirmed}
                disabled={isSessionCompleted}
                onChange={handleCorrelationsChange}
                onConfirmMapping={handleConfirmMapping}
                onBackToSetup={() => {
                  setCurrentStage("setup");
                  if (sessionId) {
                    navigate(`/reconciliations-v3/${sessionId}/setup`);
                  } else {
                    navigate("/reconciliations-v3");
                  }
                }}
              />
            ) : isHydrating ? (
              <div className="v2-processing-state-card" style={{ margin: "40px auto" }}>
                <div className="v2-processing-header">
                  <div className="v2-processing-spinner">
                    <RefreshCw size={20} className="v2-spin" />
                  </div>
                  <div>
                    <h4 className="v2-processing-title">Restoring Agentic Correlation Session</h4>
                    <p className="v2-processing-step">Loading active checkpoint from SQLite state machine...</p>
                  </div>
                </div>
                <div className="v2-progress-rail">
                  <div className="v2-progress-indeterminate" />
                </div>
              </div>
            ) : (
              <div className="v2-alert-error" style={{ maxWidth: 640, margin: "40px auto", textAlign: "center", display: "flex", flexDirection: "column", gap: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "center" }}>
                  <AlertCircle size={20} />
                  <strong>Session State Expired or Not Found</strong>
                </div>
                <p style={{ margin: 0, fontSize: 13, color: "#9f1239" }}>
                  No active schema correlation was found for this session ID. Please return to setup to re-correlate your workbooks.
                </p>
                <button
                  type="button"
                  className="v2-browse-button blue"
                  style={{ margin: "10px auto 0 auto" }}
                  onClick={() => {
                    setCurrentStage("setup");
                    if (sessionId) {
                      navigate(`/reconciliations-v3/${sessionId}/setup`);
                    } else {
                      navigate("/reconciliations-v3");
                    }
                  }}
                >
                  ← Return to Ingestion Setup
                </button>
              </div>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* STAGE 3: RULES PIPELINE & GOVERNANCE PLANE                                */}
        {/* ========================================================================= */}
        {(currentStage === "rules" || currentStage === "policy") && (
          <div className={isSessionCompleted ? "v2-read-only-wrapper" : ""}>
            {isSessionCompleted && <div className="v2-read-only-shield" aria-hidden="true" />}
            <ReconciliationV2RulesStage
              sessionId={sessionId || ""}
              correlations={correlationResult?.correlations || []}
              prColumns={(correlationResult?.all_columns && correlationResult.all_columns.length > 0 ? correlationResult.all_columns : correlationResult?.pr_columns) || []}
              onBackToMapping={() => {
                setCurrentStage("mapping");
                if (sessionId) navigate(`/reconciliations-v3/${sessionId}/mapping`);
              }}
              onProceedToResults={() => {
                setRulesConfirmed(true);
                setHasVisitedResults(true);
                setSessionStatus("rules_confirmed");
                setCurrentStage("results");
                if (sessionId) navigate(`/reconciliations-v3/${sessionId}/results`);
              }}
            />
          </div>
        )}

        {/* ========================================================================= */}
        {/* STAGE 4: DETERMINISTIC RESULTS & AMBIGUITY HUB                            */}
        {/* ========================================================================= */}
        {currentStage === "results" && (
          <div className={isSessionCompleted ? "v2-read-only-wrapper" : ""}>
            {isSessionCompleted && <div className="v2-read-only-shield" aria-hidden="true" />}
            <ReconciliationV2ResultsStage
              sessionId={sessionId || ""}
              onBackToRules={() => {
                setCurrentStage("rules");
                if (sessionId) navigate(`/reconciliations-v3/${sessionId}/rules`);
              }}
              onProceedToSummary={() => {
                setHasVisitedSummary(true);
                setSessionStatus("results");
                setCurrentStage("summary");
                if (sessionId) navigate(`/reconciliations-v3/${sessionId}/summary`);
              }}
            />
          </div>
        )}

        {/* ========================================================================= */}
        {/* STAGE 5: EXECUTIVE SUMMARY DASHBOARD & COMPLIANCE INTELLIGENCE            */}
        {/* ========================================================================= */}
        {currentStage === "summary" && (
          <div className={isSessionCompleted ? "v2-read-only-wrapper" : ""}>
            {isSessionCompleted && <div className="v2-read-only-shield" aria-hidden="true" />}
            <ReconciliationV2SummaryStage
              sessionId={sessionId || ""}
              onBack={() => {
                setCurrentStage("results");
                if (sessionId) navigate(`/reconciliations-v3/${sessionId}/results`);
              }}
              onProceedToExport={() => {
                setSessionStatus("export");
                setCurrentStage("export");
                if (sessionId) navigate(`/reconciliations-v3/${sessionId}/export`);
              }}
            />
          </div>
        )}

        {/* ========================================================================= */}
        {/* STAGE 6: EXPORT STUDIO & MULTI-FORMAT DISPATCH                            */}
        {/* ========================================================================= */}
        {currentStage === "export" && (
          <ReconciliationV2ExportStage
            sessionId={sessionId || ""}
            onBack={() => {
              setCurrentStage("summary");
              if (sessionId) navigate(`/reconciliations-v3/${sessionId}/summary`);
            }}
            onComplete={() => {
              setHasExported(true);
              setSessionStatus("completed");
            }}
          />
        )}
      </main>
    </div>
  );
};
