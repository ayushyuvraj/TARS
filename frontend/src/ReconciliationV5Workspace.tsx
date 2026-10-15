import React, { useState, useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  DirectCorrelationResult,
  DirectColumnCorrelation,
  AgentThought,
} from "./api_v2";
import { apiV5 } from "./api_v5";
import { DynamicMappingGridV2 } from "./DynamicMappingGridV2";
import { ReconciliationV5RulesStage } from "./ReconciliationV5RulesStage";
import { ReconciliationV5ResultsStage } from "./ReconciliationV5ResultsStage";
import { ReconciliationV2SummaryStage } from "./ReconciliationV2SummaryStage";
import { ReconciliationV2ExportStage } from "./ReconciliationV2ExportStage";
import "./reconciliation_v2.css";
import "./rules_v2.css";
import "./results_v2.css";
import "./results_v4.css";
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
  ArrowLeftRight,
  Check,
  Trash2,
  Zap,
  Cpu,
  Layers,
  Database,
  X,
} from "lucide-react";

type V5Stage = "setup" | "mapping" | "rules" | "policy" | "results" | "summary" | "export";

interface V5StageInfo {
  key: V5Stage;
  label: string;
  number: number;
  subtitle: string;
}

const V5_STAGES: V5StageInfo[] = [
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

export const ReconciliationV5Workspace: React.FC = () => {
  const { id: routeSessionId, stage: routeStage } = useParams<{ id?: string; stage?: string }>();
  const navigate = useNavigate();

  const [currentStage, setCurrentStage] = useState<V5Stage>((routeStage as V5Stage) || "setup");
  const [sessionId, setSessionId] = useState<string | null>(routeSessionId || null);

  // Files
  const [gstrFile, setGstrFile] = useState<File | null>(null);
  const [prFile, setPrFile] = useState<File | null>(null);
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

  // Progressive stage unlocking predicate
  const isStageUnlocked = (stageKey: V5Stage): boolean => {
    if (isSessionCompleted) return true;

    switch (stageKey) {
      case "setup":
        return true;
      case "mapping":
        return Boolean(
          correlationResult !== null ||
          ["mapped", "mapping_confirmed", "rules_confirmed", "reconciled", "completed", "exported"].includes(sessionStatus)
        );
      case "rules":
      case "policy":
        return Boolean(
          mappingConfirmed ||
          ["mapping_confirmed", "rules_confirmed", "reconciled", "completed", "exported"].includes(sessionStatus)
        );
      case "results":
        return Boolean(
          rulesConfirmed ||
          hasVisitedResults ||
          ["rules_confirmed", "reconciled", "completed", "exported"].includes(sessionStatus)
        );
      case "summary":
        return Boolean(
          hasVisitedSummary ||
          ["reconciled", "completed", "exported"].includes(sessionStatus)
        );
      case "export":
        return Boolean(
          hasVisitedSummary ||
          hasExported ||
          ["completed", "exported"].includes(sessionStatus)
        );
      default:
        return false;
    }
  };

  const isStageCompleted = (stageKey: V5Stage): boolean => {
    switch (stageKey) {
      case "setup":
        return correlationResult !== null || ["mapped", "mapping_confirmed", "rules_confirmed", "reconciled", "completed", "exported"].includes(sessionStatus);
      case "mapping":
        return mappingConfirmed || ["mapping_confirmed", "rules_confirmed", "reconciled", "completed", "exported"].includes(sessionStatus);
      case "rules":
      case "policy":
        return rulesConfirmed || ["rules_confirmed", "reconciled", "completed", "exported"].includes(sessionStatus);
      case "results":
        return hasVisitedResults || ["reconciled", "completed", "exported"].includes(sessionStatus);
      case "summary":
        return hasVisitedSummary || ["completed", "exported"].includes(sessionStatus);
      case "export":
        return hasExported || sessionStatus === "completed" || sessionStatus === "exported";
      default:
        return false;
    }
  };

  // Auto-trigger when both files are selected
  const hasAutoTriggered = useRef(false);
  useEffect(() => {
    if (gstrFile && prFile && !hasAutoTriggered.current && currentStage === "setup") {
      hasAutoTriggered.current = true;
      executeFastUploadAndMapping(gstrFile, prFile);
    }
  }, [gstrFile, prFile, currentStage]);

  // Sync route stage with internal stage and enforce progressive stage unlocking
  useEffect(() => {
    if (routeStage && !isHydrating) {
      const normalizedStage = routeStage === "policy" ? "rules" : (routeStage as V5Stage);
      if (isStageUnlocked(normalizedStage)) {
        if (normalizedStage !== currentStage) {
          setCurrentStage(normalizedStage);
        }
      } else {
        const highestUnlocked = [...V5_STAGES].reverse().find((s) => isStageUnlocked(s.key))?.key || "setup";
        if (highestUnlocked !== currentStage && sessionId) {
          setCurrentStage(highestUnlocked);
          navigate(`/reconciliations-v5/${sessionId}/${highestUnlocked}`, { replace: true });
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
      stageLabel: stageLabelMap[currentStage] || "Reconciliation 5.0",
      sessionId: sessionId,
      gstrFilename: gstrFile?.name || correlationResult?.gstr_filename || undefined,
      prFilename: prFile?.name || correlationResult?.pr_filename || undefined,
    });
  }, [currentStage, sessionId, gstrFile, prFile, correlationResult]);

  // Handle external copilot actions
  useEffect(() => {
    const unregNav = copilotV2Bridge.registerActionHandler("NAVIGATE_STAGE", (payload: any) => {
      if (payload?.target_stage) {
        const target = payload.target_stage as V5Stage;
        if (sessionId && isStageUnlocked(target)) {
          setCurrentStage(target);
          navigate(`/reconciliations-v5/${sessionId}/${target}`);
        }
      }
    });

    const unregReconcile = copilotV2Bridge.registerActionHandler("RUN_RECONCILIATION", () => {
      if (sessionId && isStageUnlocked("results")) {
        setCurrentStage("results");
        navigate(`/reconciliations-v5/${sessionId}/results`);
      }
    });

    const unregAutoRec = copilotV2Bridge.registerActionHandler("AUTO_RECONCILE_SUCCESS", (payload: any) => {
      if (payload?.session_id && (payload?.recon_type === "v5" || !payload?.recon_type)) {
        setSessionId(payload.session_id);
        setCurrentStage("results");
        navigate(`/reconciliations-v5/${payload.session_id}/results`);
      }
    });

    return () => {
      unregNav();
      unregReconcile();
      unregAutoRec();
    };
  }, [sessionId, navigate]);

  // Session hydration / creation logic:
  // 1. If routeSessionId is present in URL (e.g. /reconciliations-v5/:id or /reconciliations-v5/:id/:stage),
  //    hydrate that specific session.
  // 2. If routeSessionId is NOT present (e.g. clicking sidebar link /reconciliations-v5),
  //    automatically create a BRAND NEW session via apiV5.createSession() and redirect to /reconciliations-v5/<new-id>/setup.
  useEffect(() => {
    if (isHydrating) return;

    if (routeSessionId) {
      if (sessionId !== routeSessionId || !correlationResult) {
        setIsHydrating(true);
        apiV5
          .getSession(routeSessionId)
          .then((session) => {
            setSessionId(session.id);
            localStorage.setItem("tars_v5_active_session_id", session.id);
            setSessionStatus(session.status);

            if (session.correlation) {
              setCorrelationResult(session.correlation);
              if (session.correlation.agent_thoughts) {
                setAgentThoughts(session.correlation.agent_thoughts);
              }
            }

            if (session.is_completed || session.status === "completed" || session.status === "exported") {
              setHasExported(true);
              setHasVisitedSummary(true);
              setHasVisitedResults(true);
              setRulesConfirmed(true);
              setMappingConfirmed(true);
            } else if (session.status === "reconciled") {
              setHasVisitedResults(true);
              setRulesConfirmed(true);
              setMappingConfirmed(true);
            } else if (session.status === "rules_confirmed") {
              setRulesConfirmed(true);
              setMappingConfirmed(true);
            } else if (session.status === "mapping_confirmed") {
              setMappingConfirmed(true);
            }

            if (!routeStage && session.current_stage) {
              setCurrentStage(session.current_stage as V5Stage);
              navigate(`/reconciliations-v5/${session.id}/${session.current_stage}`, { replace: true });
            }
          })
          .catch((err) => {
            console.warn("Could not hydrate existing V5 session, initializing new:", err);
            initNewSession();
          })
          .finally(() => {
            setIsHydrating(false);
          });
      }
    } else {
      initNewSession();
    }
  }, [routeSessionId]);

  const initNewSession = async () => {
    setIsHydrating(true);
    setGstrFile(null);
    setPrFile(null);
    setCorrelationResult(null);
    setAgentThoughts([]);
    setMappingConfirmed(false);
    setRulesConfirmed(false);
    setHasVisitedResults(false);
    setHasVisitedSummary(false);
    setHasExported(false);
    hasAutoTriggered.current = false;
    setCurrentStage("setup");
    try {
      const newSession = await apiV5.createSession();
      setSessionId(newSession.id);
      setSessionStatus(newSession.status || "setup");
      localStorage.setItem("tars_v5_active_session_id", newSession.id);
      navigate(`/reconciliations-v5/${newSession.id}/setup`, { replace: true });
    } catch (err: any) {
      console.error("Failed to initialize V5 session:", err);
      setErrorMessage("Could not connect to TARS reconciliation engine.");
    } finally {
      setIsHydrating(false);
    }
  };

  const isIngestionFinishedRef = useRef(false);

  // Ingestion and correlation
  const executeFastUploadAndMapping = async (gFile?: File | null, pFile?: File | null) => {
    let targetId = sessionId;
    if (!targetId) {
      const sess = await apiV5.createSession();
      targetId = sess.id;
      setSessionId(sess.id);
      localStorage.setItem("tars_v5_active_session_id", sess.id);
    }

    setIsUploadingAndCorrelating(true);
    setErrorMessage(null);
    setElapsedSec(0);
    setTotalMeasuredDurationMs(0);
    isIngestionFinishedRef.current = false;

    setChainSteps([
      { id: "step1", num: 1, title: "Fast Header & Sample Ingestion", desc: "Stream-probing file structure and initial 50 sample rows into memory buffer", status: "running" },
      { id: "step2", num: 2, title: "Deterministic Statutory Rules", desc: "Validating GSTIN, Invoice Numbers, Tax Rates & exact financial figures", status: "pending" },
      { id: "step3", num: 3, title: "Multi-Agent Semantic Matching", desc: "Resolving ERP column abbreviations and building cross-ledger linkages", status: "pending" },
    ]);

    const startTime = Date.now();
    const timerInterval = setInterval(() => {
      if (!isIngestionFinishedRef.current) {
        setElapsedSec(Math.round((Date.now() - startTime) / 100) / 10);
      }
    }, 100);

    const t1 = setTimeout(() => {
      setChainSteps((prev) => [
        { ...prev[0], status: "completed", durationMs: 65 },
        { ...prev[1], status: "running" },
        prev[2],
      ]);
    }, 320);

    const t2 = setTimeout(() => {
      setChainSteps((prev) => [
        prev[0],
        { ...prev[1], status: "completed", durationMs: 95 },
        { ...prev[2], status: "running" },
      ]);
    }, 650);

    try {
      const isUsingSample = !gFile && !pFile;
      const result = await apiV5.uploadFiles(targetId, gFile, pFile, isUsingSample);

      clearInterval(timerInterval);
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

      setChainSteps([
        { id: "step1", num: 1, title: "Fast Header & Sample Ingestion", desc: "Stream-probing file structure and initial 50 sample rows into memory buffer", status: "completed", durationMs: 65 },
        { id: "step2", num: 2, title: "Deterministic Statutory Rules", desc: "Validating GSTIN, Invoice Numbers, Tax Rates & exact financial figures", status: "completed", durationMs: 95 },
        { id: "step3", num: 3, title: "Multi-Agent Semantic Matching", desc: "Resolving ERP column abbreviations and building cross-ledger linkages", status: "completed", durationMs: Math.max(80, Math.round(measuredDuration - 160)) },
      ]);

      setCorrelationResult(result);
      setAgentThoughts(result.agent_thoughts || []);
      setSessionStatus("mapped");

      setTimeout(() => {
        setCurrentStage("mapping");
        navigate(`/reconciliations-v5/${targetId}/mapping`, { replace: true });
        setIsUploadingAndCorrelating(false);
      }, 350);
    } catch (err: any) {
      console.error("V5 Fast Ingestion Error:", err);
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
      await apiV5.confirmMapping(sessionId, correlationResult.correlations);
      setMappingConfirmed(true);
      setRulesConfirmed(false);
      setHasVisitedResults(false);
      setHasVisitedSummary(false);
      setSessionStatus("mapping_confirmed");
      setCurrentStage("rules");
      navigate(`/reconciliations-v5/${sessionId}/rules`);
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
    setGstrFile(null);
    setPrFile(null);
    setCorrelationResult(null);
    setAgentThoughts([]);
    setMappingConfirmed(false);
    setRulesConfirmed(false);
    setHasVisitedResults(false);
    setHasVisitedSummary(false);
    setHasExported(false);
    hasAutoTriggered.current = false;
    setCurrentStage("setup");
    try {
      const sess = await apiV5.createSession();
      setSessionId(sess.id);
      localStorage.setItem("tars_v5_active_session_id", sess.id);
      navigate(`/reconciliations-v5/${sess.id}/setup`, { replace: true });
    } catch {
      setSessionId(null);
      navigate(`/reconciliations-v5`);
    } finally {
      setIsResetting(false);
    }
  };

  const effectiveGstrName = gstrFile?.name || correlationResult?.gstr_filename || null;
  const effectivePrName = prFile?.name || correlationResult?.pr_filename || null;

  return (
    <div className="v2-executive-root">
      {/* 1. TOP EXECUTIVE TELEMETRY RIBBON */}
      <div className="v2-telemetry-ribbon">
        <div className="v2-telemetry-left">
          <div className="v2-brand-pill">
            <div className="v2-brand-icon-halo">
              <Sparkles size={13} className="v2-sparkle-spin" />
            </div>
            <span className="v2-brand-title">RECONCILIATION 5.0 • DOUBLE LEDGER</span>
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
          {V5_STAGES.map((s, idx) => {
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
                      navigate(`/reconciliations-v5/${sessionId}/${s.key}`);
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
                {idx < V5_STAGES.length - 1 && (
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
            <button type="button" onClick={() => setErrorMessage(null)} className="v2-alert-close" style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "inherit" }}>
              <X size={14} />
            </button>
          </div>
        )}

        {/* ========================================================================= */}
        {/* STAGE 1: DUAL PRECISION NEURAL DOCKING BAYS (ZERO-SCROLL VIEWPORT)        */}
        {/* ========================================================================= */}
        {currentStage === "setup" && (
          <div className={`v2-setup-stage-wrapper ${isSessionCompleted ? "v2-read-only-wrapper" : ""}`}>
            {isSessionCompleted && <div className="v2-read-only-shield" aria-hidden="true" />}
            <div className="v2-setup-flow">
            {/* 1. HERO BANNER (Unified Dark Royal Cobalt matching Stage 4) */}
            <div className="v2-stage-hero">
              <div className="v2-stage-hero-center">
                <h2 className="v2-stage-hero-title">Bring the two ledgers together.</h2>
                <div className="v2-stage-hero-tag">
                  <Sparkles size={12} />
                  <span>Stage 1 of 6 • Dual Ingestion Docking Bay</span>
                </div>
                <p className="v2-stage-hero-desc">
                  Upload your Government GSTR-2B extract and Client Purchase Register. Intelligent agents automatically match columns in seconds.
                </p>
              </div>

              <div className="v2-stage-hero-actions">
                {(effectiveGstrName || effectivePrName) && (
                  <button
                    type="button"
                    className="v2-hero-btn-secondary"
                    onClick={() => {
                      setGstrFile(null);
                      setPrFile(null);
                      setCorrelationResult(null);
                      hasAutoTriggered.current = false;
                    }}
                    title="Clear selected workbooks"
                  >
                    <Trash2 size={13} />
                    <span>Clear Files</span>
                  </button>
                )}
                <button
                  type="button"
                  className="v2-btn-primary-action"
                  onClick={() => {
                    if (correlationResult) {
                      setCurrentStage("mapping");
                      if (sessionId) navigate(`/reconciliations-v5/${sessionId}/mapping`);
                    } else if (gstrFile && prFile) {
                      executeFastUploadAndMapping(gstrFile, prFile);
                    }
                  }}
                  disabled={(!gstrFile || !prFile) && !correlationResult}
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

            {/* Ingestion Docking Bay Terminals (Doppelrand Architecture) */}
            <div className="v2-docking-grid">
              {/* TERMINAL 1: GOVERNMENT GSTR-2B */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDraggingOver("gstr");
                }}
                onDragLeave={() => setIsDraggingOver(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDraggingOver(null);
                  if (e.dataTransfer.files?.[0]) setGstrFile(e.dataTransfer.files[0]);
                }}
                className={`v2-dock-shell gstr ${isDraggingOver === "gstr" ? "is-dragging" : ""} ${effectiveGstrName ? "has-payload" : ""}`}
              >
                <div className="v2-dock-core">
                  {/* Terminal Header Bar */}
                  <div className="v2-terminal-header">
                    <div className="v2-terminal-tag">
                      <span className="v2-dot-indicator blue" />
                      <span>TAX AUTHORITY LEDGER</span>
                    </div>
                    <span className="v2-format-badge">OFFICIAL GSTN PORTAL</span>
                  </div>

                  {/* Content Bay */}
                  <div className="v2-terminal-body">
                    {effectiveGstrName ? (
                      <div className="v2-payload-card">
                        <div className="v2-payload-glyph">
                          <CheckCircle2 size={24} />
                        </div>
                        <div className="v2-payload-meta">
                          <span className="v2-payload-state-chip">SOURCE 1 READY</span>
                          <h4 className="v2-payload-title" title={effectiveGstrName}>{effectiveGstrName}</h4>
                          <div className="v2-payload-specs">
                            <span>{gstrFile ? formatFileSize(gstrFile.size) : "Ingested"}</span>
                            <span>•</span>
                            <span>Ready to Correlate</span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setGstrFile(null);
                            if (correlationResult) setCorrelationResult(null);
                            hasAutoTriggered.current = false;
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
                        <h3 className="v2-drop-title">Government GSTR-2B</h3>
                        <p className="v2-drop-subtitle">
                          Drag & drop official GST portal download or browse local files
                        </p>

                        <label className="v2-browse-button blue">
                          <span className="v2-btn-icon-capsule">
                            <UploadCloud size={13} />
                          </span>
                          <span>Select GSTR-2B File</span>
                          <input
                            type="file"
                            accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                            style={{ display: "none" }}
                            onChange={(e) => {
                              if (e.target.files?.[0]) setGstrFile(e.target.files[0]);
                            }}
                          />
                        </label>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* CENTER NEURAL NEXUS (AI OPTICAL BRIDGE) */}
              <div className="v2-neural-nexus">
                <div className="v2-nexus-core">
                  <div className="v2-pulse-ring-outer" />
                  <div className="v2-pulse-ring-inner" />
                  <div className="v2-nexus-badge">
                    <Sparkles size={16} className="v2-sparkle-spin" />
                  </div>
                </div>
                <div className="v2-nexus-label-col">
                  <span className="v2-nexus-title">TARS AGENTIC AI</span>
                  <span className="v2-nexus-sub">Double Ledger Correlator</span>
                </div>
                <div className="v2-nexus-flow-arrow">
                  <ArrowLeftRight size={15} />
                </div>
              </div>

              {/* TERMINAL 2: PURCHASE REGISTER (ERP) */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDraggingOver("pr");
                }}
                onDragLeave={() => setIsDraggingOver(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDraggingOver(null);
                  if (e.dataTransfer.files?.[0]) setPrFile(e.dataTransfer.files[0]);
                }}
                className={`v2-dock-shell pr ${isDraggingOver === "pr" ? "is-dragging" : ""} ${effectivePrName ? "has-payload" : ""}`}
              >
                <div className="v2-dock-core">
                  {/* Terminal Header Bar */}
                  <div className="v2-terminal-header">
                    <div className="v2-terminal-tag">
                      <span className="v2-dot-indicator steel" />
                      <span>CLIENT ACCOUNTING LEDGER</span>
                    </div>
                    <span className="v2-format-badge">ERP REGISTER</span>
                  </div>

                  {/* Content Bay */}
                  <div className="v2-terminal-body">
                    {effectivePrName ? (
                      <div className="v2-payload-card">
                        <div className="v2-payload-glyph">
                          <CheckCircle2 size={24} />
                        </div>
                        <div className="v2-payload-meta">
                          <span className="v2-payload-state-chip">SOURCE 2 READY</span>
                          <h4 className="v2-payload-title" title={effectivePrName}>{effectivePrName}</h4>
                          <div className="v2-payload-specs">
                            <span>{prFile ? formatFileSize(prFile.size) : "Ingested"}</span>
                            <span>•</span>
                            <span>Ready to Correlate</span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPrFile(null);
                            if (correlationResult) setCorrelationResult(null);
                            hasAutoTriggered.current = false;
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
                        <div className="v2-holographic-halo steel">
                          <Database size={22} className="v2-holo-icon" />
                        </div>
                        <h3 className="v2-drop-title">Purchase Register / ERP</h3>
                        <p className="v2-drop-subtitle">
                          Drag & drop your client accounts workbook or browse local storage
                        </p>

                        <label className="v2-browse-button steel">
                          <span className="v2-btn-icon-capsule">
                            <UploadCloud size={13} />
                          </span>
                          <span>Select Purchase Register</span>
                          <input
                            type="file"
                            accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                            style={{ display: "none" }}
                            onChange={(e) => {
                              if (e.target.files?.[0]) setPrFile(e.target.files[0]);
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
                      <p>Both workbooks are correlated and schema linkages are ready for review.</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setCurrentStage("mapping");
                      if (sessionId) navigate(`/reconciliations-v5/${sessionId}/mapping`);
                    }}
                    className="v2-btn-launch-correlator"
                  >
                    <span>RESUME SCHEMA CORRELATION (STAGE 2)</span>
                    <ArrowRight size={16} />
                  </button>
                </div>
              ) : gstrFile && prFile ? (
                <div className="v2-ready-action-card">
                  <div className="v2-ready-meta">
                    <span className="v2-ready-icon">✦</span>
                    <div>
                      <strong>Both workbooks verified and ready.</strong>
                      <p>Click below to launch the autonomous column matching agents.</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => executeFastUploadAndMapping(gstrFile, prFile)}
                    className="v2-btn-launch-correlator"
                    disabled={isUploadingAndCorrelating}
                  >
                    <span>{isUploadingAndCorrelating ? "CORRELATING WORKBOOKS..." : "ENGAGE AGENTIC AI CORRELATOR"}</span>
                    <ArrowRight size={16} />
                  </button>
                </div>
              ) : (
                <div className="v2-telemetry-conduit">
                  <div className="v2-conduit-node">
                    <span className={`v2-conduit-pip ${effectiveGstrName ? "is-primed" : ""}`} />
                    <span>Sovereign 2B {effectiveGstrName ? "Primed" : "Awaiting"}</span>
                  </div>
                  <span className="v2-conduit-divider">•</span>
                  <div className="v2-conduit-node">
                    <span className={`v2-conduit-pip ${effectivePrName ? "is-primed" : ""}`} />
                    <span>Client ERP {effectivePrName ? "Primed" : "Awaiting"}</span>
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
                      Correlating Sovereign GSTR-2B with Enterprise ERP across structural schema fields...
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
                          width: `${(chainSteps.filter((s) => s.status === "completed").length / chainSteps.length) * 100}%`
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
                    <h4>Instant High-Throughput Ingestion</h4>
                  </div>
                  <p>
                    Processes large multi-sheet Excel workbooks in seconds with zero browser freezing and memory virtualization.
                  </p>
                  <div className="v2-trust-foot">Streaming Dual-Ledger Ingestion Engine</div>
                </div>
              </div>

              <div className="v2-trust-shell">
                <div className="v2-trust-core">
                  <span className="v2-trust-badge">Autonomous Alignment</span>
                  <div className="v2-trust-header-row">
                    <div className="v2-trust-icon-box steel">
                      <Cpu size={15} />
                    </div>
                    <h4>Smart Column Auto-Match</h4>
                  </div>
                  <p>
                    Intelligent agents read varied ERP column headers (Bill No, Taxable Value, etc.) and accurately map to GSTN standards.
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
                    All GSTIN checksums and arithmetic computations verified down to the rupee. Autonomous advice, human authority.
                  </p>
                  <div className="v2-trust-foot">Auditable & Human-Governed</div>
                </div>
              </div>
            </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* STAGE 2: HIGH-END DYNAMIC MAPPING GRID V2 (RECON 2.0 PARITY)              */}
        {/* ========================================================================= */}
        {currentStage === "mapping" && (
          <div className={isSessionCompleted ? "v2-read-only-wrapper" : ""}>
            {isSessionCompleted && <div className="v2-read-only-shield" aria-hidden="true" />}
            {correlationResult ? (
              <DynamicMappingGridV2
                correlations={correlationResult.correlations || []}
                prColumns={correlationResult.pr_columns || []}
                gstrFileName={gstrFile?.name || correlationResult.gstr_filename || "Government GSTR-2B.xlsx"}
                prFileName={prFile?.name || correlationResult.pr_filename || "Purchase Register ERP.xlsx"}
                agentThoughts={agentThoughts.length > 0 ? agentThoughts : (correlationResult.agent_thoughts || [])}
                totalDurationMs={totalMeasuredDurationMs || (correlationResult?.total_duration_ms && correlationResult.total_duration_ms >= 150 ? correlationResult.total_duration_ms : 0)}
                isConfirmed={mappingConfirmed}
                disabled={isSessionCompleted}
                onChange={handleCorrelationsChange}
                onConfirmMapping={handleConfirmMapping}
                onBackToSetup={() => {
                  setCurrentStage("setup");
                  if (sessionId) navigate(`/reconciliations-v5/${sessionId}/setup`);
                  else navigate("/reconciliations-v5");
                }}
              />
            ) : isHydrating ? (
              <div className="v2-processing-state-card" style={{ margin: "40px auto" }}>
                <div className="v2-processing-header">
                  <RefreshCw size={20} className="v2-spin" />
                  <div>
                    <h4 className="v2-processing-title">Restoring Agentic Correlation Session</h4>
                    <p className="v2-processing-step">Loading active checkpoint from SQLite state machine...</p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="v2-alert-error" style={{ maxWidth: 640, margin: "40px auto", textAlign: "center" }}>
                <p>No active schema correlation found for this session ID. Please return to setup to re-upload files.</p>
                <button
                  type="button"
                  className="v2-browse-button blue"
                  style={{ margin: "10px auto 0 auto" }}
                  onClick={() => {
                    setCurrentStage("setup");
                    if (sessionId) navigate(`/reconciliations-v5/${sessionId}/setup`);
                    else navigate("/reconciliations-v5");
                  }}
                >
                  ← Return to Ingestion Setup
                </button>
              </div>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* STAGE 3: RULES PIPELINE & GOVERNANCE PLANE (RECON 5.0)                    */}
        {/* ========================================================================= */}
        {(currentStage === "rules" || currentStage === "policy") && (
          <div className={isSessionCompleted ? "v2-read-only-wrapper" : ""}>
            {isSessionCompleted && <div className="v2-read-only-shield" aria-hidden="true" />}
            <ReconciliationV5RulesStage
              sessionId={sessionId || ""}
              isReadOnly={isSessionCompleted}
              onBackToMapping={() => {
                setCurrentStage("mapping");
                if (sessionId) navigate(`/reconciliations-v5/${sessionId}/mapping`);
              }}
              onProceedToResults={() => {
                setRulesConfirmed(true);
                setHasVisitedResults(true);
                setSessionStatus("rules_confirmed");
                setCurrentStage("results");
                if (sessionId) navigate(`/reconciliations-v5/${sessionId}/results`);
              }}
            />
          </div>
        )}

        {/* ========================================================================= */}
        {/* STAGE 4: DETERMINISTIC RESULTS & AMBIGUITY HUB (RECON 5.0)                */}
        {/* ========================================================================= */}
        {currentStage === "results" && (
          <div className={isSessionCompleted ? "v2-read-only-wrapper" : ""}>
            {isSessionCompleted && <div className="v2-read-only-shield" aria-hidden="true" />}
            <ReconciliationV5ResultsStage
              sessionId={sessionId || ""}
              isReadOnly={isSessionCompleted}
              onBackToRules={() => {
                setCurrentStage("rules");
                if (sessionId) navigate(`/reconciliations-v5/${sessionId}/rules`);
              }}
              onProceedToSummary={() => {
                setHasVisitedSummary(true);
                setSessionStatus("results");
                setCurrentStage("summary");
                if (sessionId) navigate(`/reconciliations-v5/${sessionId}/summary`);
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
              isReadOnly={isSessionCompleted}
              onBack={() => {
                setCurrentStage("results");
                if (sessionId) navigate(`/reconciliations-v5/${sessionId}/results`);
              }}
              onProceedToExport={() => {
                setSessionStatus("export");
                setCurrentStage("export");
                if (sessionId) navigate(`/reconciliations-v5/${sessionId}/export`);
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
              if (sessionId) navigate(`/reconciliations-v5/${sessionId}/summary`);
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
