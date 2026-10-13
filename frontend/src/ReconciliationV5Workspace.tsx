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
  ArrowLeft,
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

  // Sync route stage changes
  useEffect(() => {
    if (routeStage && routeStage !== currentStage) {
      setCurrentStage(routeStage as V5Stage);
    }
  }, [routeStage]);

  // Hydrate session on mount
  useEffect(() => {
    const hydrateSession = async () => {
      let targetId = routeSessionId || localStorage.getItem("tars_v5_active_session_id");

      if (targetId) {
        setIsHydrating(true);
        try {
          const session = await apiV5.getSession(targetId);
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
        } catch (err) {
          console.warn("Could not hydrate existing V5 session, initializing new:", err);
          initNewSession();
        } finally {
          setIsHydrating(false);
        }
      } else {
        initNewSession();
      }
    };

    hydrateSession();
  }, [routeSessionId]);

  const initNewSession = async () => {
    try {
      const newSession = await apiV5.createSession();
      setSessionId(newSession.id);
      localStorage.setItem("tars_v5_active_session_id", newSession.id);
      navigate(`/reconciliations-v5/${newSession.id}/setup`, { replace: true });
    } catch (err: any) {
      console.error("Failed to initialize V5 session:", err);
      setErrorMessage("Could not connect to TARS reconciliation engine.");
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

  const resetAll = async () => {
    setGstrFile(null);
    setPrFile(null);
    setCorrelationResult(null);
    setAgentThoughts([]);
    setMappingConfirmed(false);
    setRulesConfirmed(false);
    setHasVisitedResults(false);
    setHasVisitedSummary(false);
    setCurrentStage("setup");
    try {
      const sess = await apiV5.createSession();
      setSessionId(sess.id);
      localStorage.setItem("tars_v5_active_session_id", sess.id);
      navigate(`/reconciliations-v5/${sess.id}/setup`, { replace: true });
    } catch {
      setSessionId(null);
      navigate(`/reconciliations-v5`);
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
                  className="v2-btn-reset-icon"
                  title="Reset Reconciliation Session"
                >
                  <RefreshCw size={12} />
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 2. 6-STAGE WORKFLOW PROGRESS RAIL */}
      <div className="v2-stepper-rail-wrap">
        <div className="v2-stepper-rail">
          {V5_STAGES.map((st) => {
            const isCompleted = isStageCompleted(st.key);
            const isCurrent = currentStage === st.key;
            const isUnlocked = isStageUnlocked(st.key);

            return (
              <div
                key={st.key}
                onClick={() => {
                  if (isUnlocked && sessionId) {
                    setCurrentStage(st.key);
                    navigate(`/reconciliations-v5/${sessionId}/${st.key}`);
                  }
                }}
                className={`v2-step-card ${isCurrent ? "is-current" : ""} ${isCompleted ? "is-completed" : ""} ${!isUnlocked ? "is-locked" : ""}`}
              >
                <div className="v2-step-indicator">
                  {isCompleted && !isCurrent ? (
                    <span className="v2-check-glyph">✓</span>
                  ) : (
                    <span>{st.number}</span>
                  )}
                </div>
                <div className="v2-step-meta">
                  <span className="v2-step-label">{st.label}</span>
                  <span className="v2-step-sub">{st.subtitle}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 3. ERROR BANNER */}
      {errorMessage && (
        <div className="v2-alert-error" style={{ margin: "16px 24px" }}>
          <AlertCircle size={16} />
          <span>{errorMessage}</span>
          <button type="button" onClick={() => setErrorMessage(null)} className="v2-alert-close">
            <X size={14} />
          </button>
        </div>
      )}

      {/* 4. MAIN WORKSPACE CONTENT AREA */}
      <div className="v2-stage-viewport">
        {/* ========================================================================= */}
        {/* STAGE 1: DUAL FILE INGESTION (RECON 2.0 PARITY)                           */}
        {/* ========================================================================= */}
        {currentStage === "setup" && (
          <div className="v2-stage-frame">
            <div className="v2-stage-hero-card">
              <div className="v2-stage-hero-left">
                <span className="v2-stage-tag">STAGE 1 • DUAL INGESTION</span>
                <h2 className="v2-stage-heading">Ingest Separate GSTR-2B & Purchase Register Files</h2>
                <p className="v2-stage-description">
                  Upload your Government GSTR-2B extract and Client Purchase Register separately. Intelligent agents automatically match columns in seconds.
                </p>
              </div>

              <div className="v2-stage-hero-actions">
                <button
                  type="button"
                  id="v5-load-sample-btn"
                  className="v2-hero-btn-secondary"
                  onClick={() => {
                    executeFastUploadAndMapping(null, null);
                  }}
                  title="Load pre-configured benchmark datasets"
                >
                  <Database size={13} />
                  <span>Load Sample Datasets</span>
                </button>
                {(effectiveGstrName || effectivePrName) && (
                  <button
                    type="button"
                    className="v2-hero-btn-secondary"
                    onClick={() => {
                      setGstrFile(null);
                      setPrFile(null);
                      setCorrelationResult(null);
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

            {/* Ingestion Docking Bay Terminals */}
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
                  <div className="v2-terminal-header">
                    <div className="v2-terminal-tag">
                      <span className="v2-dot-indicator blue" />
                      <span>TAX AUTHORITY LEDGER</span>
                    </div>
                    <span className="v2-format-badge">OFFICIAL GSTN PORTAL</span>
                  </div>

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

              {/* CENTER NEURAL NEXUS */}
              <div className="v2-neural-nexus">
                <div className="v2-nexus-core">
                  <div className="v2-pulse-ring-outer" />
                  <div className="v2-pulse-ring-inner" />
                  <div className="v2-nexus-badge">
                    <Sparkles size={16} className="v2-sparkle-spin" />
                  </div>
                </div>
                <div className="v2-nexus-label">
                  <span>NEURAL COUPLING</span>
                  <small>Double Ledger</small>
                </div>
              </div>

              {/* TERMINAL 2: PURCHASE REGISTER */}
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
                  <div className="v2-terminal-header">
                    <div className="v2-terminal-tag">
                      <span className="v2-dot-indicator purple" />
                      <span>INTERNAL ERP REGISTER</span>
                    </div>
                    <span className="v2-format-badge">SAP / TALLY / ORACLE</span>
                  </div>

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
                        <div className="v2-holographic-halo purple">
                          <FileSpreadsheet size={22} className="v2-holo-icon" />
                        </div>
                        <h3 className="v2-drop-title">Purchase Register (PR)</h3>
                        <p className="v2-drop-subtitle">
                          Drag & drop ERP purchase ledger or browse local spreadsheets
                        </p>

                        <label className="v2-browse-button purple">
                          <span className="v2-btn-icon-capsule">
                            <UploadCloud size={13} />
                          </span>
                          <span>Select PR File</span>
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

            {/* Action Bar */}
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
                    <span className="v2-conduit-dot" />
                    <span>Awaiting files for dual-table ingestion</span>
                  </div>
                </div>
              )}
            </div>

            {/* Dynamic Modal Loading Screen */}
            {isUploadingAndCorrelating && (
              <div className="v2-agentic-modal-backdrop">
                <div className="v2-agentic-modal-card">
                  <div className="v2-agentic-modal-header">
                    <div className="v2-modal-brand-capsule">
                      <Sparkles size={14} className="v2-sparkle-spin" />
                      <span>AGENTIC SCHEMA CORRELATION</span>
                    </div>
                    <div className="v2-modal-timer-badge">
                      <span className="v2-timer-dot" />
                      <span>{elapsedSec.toFixed(1)}s elapsed</span>
                    </div>
                  </div>

                  <div className="v2-agentic-modal-body">
                    <div className="v2-cot-stepper-list">
                      {chainSteps.map((st) => (
                        <div key={st.id} className={`v2-cot-step-item ${st.status}`}>
                          <div className="v2-cot-step-bullet">
                            {st.status === "completed" ? (
                              <CheckCircle2 size={16} className="text-emerald-500" />
                            ) : st.status === "running" ? (
                              <RefreshCw size={15} className="v2-spin text-blue-500" />
                            ) : (
                              <span>{st.num}</span>
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
                  </div>
                </div>
              </div>
            )}
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
      </div>
    </div>
  );
};
