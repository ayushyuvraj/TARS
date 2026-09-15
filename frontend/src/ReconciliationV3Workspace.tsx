import React, { useState, useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  apiV3,
  DirectCorrelationResultV3,
  DirectColumnCorrelationV3,
  AgentThoughtV3,
} from "./api_v3";
import { DynamicMappingGridV3 } from "./DynamicMappingGridV3";
import { ReconciliationV3RulesStage } from "./ReconciliationV3RulesStage";
import { ReconciliationV3ResultsStage } from "./ReconciliationV3ResultsStage";
import { ReconciliationV3SummaryStage } from "./ReconciliationV3SummaryStage";
import { ReconciliationV3ExportStage } from "./ReconciliationV3ExportStage";
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
  Check,
  Zap,
  Cpu,
  Layers,
  Database,
} from "lucide-react";

type V3Stage = "setup" | "mapping" | "rules" | "results" | "summary" | "export";

interface V3StageInfo {
  key: V3Stage;
  label: string;
  number: number;
  subtitle: string;
}

const V3_STAGES: V3StageInfo[] = [
  { key: "setup", label: "Setup", number: 1, subtitle: "Single File Ingestion" },
  { key: "mapping", label: "Mapping", number: 2, subtitle: "Intra-Table Linkage" },
  { key: "rules", label: "Rules", number: 3, subtitle: "Reconciliation Rules" },
  { key: "results", label: "Results", number: 4, subtitle: "Waterfall Matrix" },
  { key: "summary", label: "Summary", number: 5, subtitle: "KICS Concurrence" },
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

  // File
  const [reconFile, setReconFile] = useState<File | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  // State
  const [isUploadingAndCorrelating, setIsUploadingAndCorrelating] = useState(false);
  const [isHydrating, setIsHydrating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Chain of Thought Steps
  const [chainSteps, setChainSteps] = useState<ChainStep[]>([
    {
      id: "step1",
      num: 1,
      title: "Streaming XML Binary Probe",
      desc: "Stream-probing 165 columns and 20,000 unified rows into memory buffer",
      status: "pending",
    },
    {
      id: "step2",
      num: 2,
      title: "Intra-Table Column Pairing",
      desc: "Coupling corresponding Counterparty (CP) and Books (PR) fields",
      status: "pending",
    },
    {
      id: "step3",
      num: 3,
      title: "KICS Baseline Detection",
      desc: "Identifying ReconciliationSection baseline column for disparity benchmarking",
      status: "pending",
    },
  ]);

  // Results
  const [correlationResult, setCorrelationResult] = useState<DirectCorrelationResultV3 | null>(null);
  const [agentThoughts, setAgentThoughts] = useState<AgentThoughtV3[]>([]);
  const [sessionStatus, setSessionStatus] = useState<string>("initialized");

  // Synchronize route stage
  useEffect(() => {
    if (routeStage && routeStage !== currentStage) {
      setCurrentStage(routeStage as V3Stage);
    }
  }, [routeStage]);

  // Initialize or hydrate session
  useEffect(() => {
    let isCancelled = false;

    async function initOrHydrate() {
      if (routeSessionId) {
        setIsHydrating(true);
        try {
          const sess = await apiV3.getSession(routeSessionId);
          if (isCancelled) return;
          setSessionId(sess.id);
          setSessionStatus(sess.status);
          if (sess.correlation) {
            setCorrelationResult(sess.correlation);
            setAgentThoughts(sess.correlation.agent_thoughts || []);
          }
        } catch (e) {
          console.error("Hydration failed:", e);
        } finally {
          if (!isCancelled) setIsHydrating(false);
        }
      } else {
        // Create session
        try {
          const newSess = await apiV3.createSession();
          if (isCancelled) return;
          setSessionId(newSess.id);
          navigate(`/reconciliations-v3/${newSess.id}/setup`, { replace: true });
        } catch (e) {
          console.error("Create session failed:", e);
        }
      }
    }

    void initOrHydrate();

    return () => {
      isCancelled = true;
    };
  }, [routeSessionId]);

  // Handle probe / upload
  const handleStartIngestion = async (useDefaultSample = false) => {
    if (!sessionId) return;
    setIsUploadingAndCorrelating(true);
    setErrorMessage(null);

    // Animate chain steps
    setChainSteps((prev) =>
      prev.map((s, idx) => (idx === 0 ? { ...s, status: "running" } : { ...s, status: "pending" }))
    );

    const step1Timer = setTimeout(() => {
      setChainSteps((prev) =>
        prev.map((s) => (s.id === "step1" ? { ...s, status: "completed" } : s.id === "step2" ? { ...s, status: "running" } : s))
      );
    }, 400);

    const step2Timer = setTimeout(() => {
      setChainSteps((prev) =>
        prev.map((s) => (s.id === "step2" ? { ...s, status: "completed" } : s.id === "step3" ? { ...s, status: "running" } : s))
      );
    }, 800);

    try {
      const corr = await apiV3.uploadSingleRecon(
        sessionId,
        useDefaultSample ? undefined : reconFile || undefined,
        useDefaultSample || !reconFile
      );

      clearTimeout(step1Timer);
      clearTimeout(step2Timer);

      setChainSteps((prev) => prev.map((s) => ({ ...s, status: "completed" })));
      setCorrelationResult(corr);
      setAgentThoughts(corr.agent_thoughts || []);
      setSessionStatus("mapped");

      setTimeout(() => {
        navigate(`/reconciliations-v3/${sessionId}/mapping`);
      }, 500);
    } catch (err: any) {
      clearTimeout(step1Timer);
      clearTimeout(step2Timer);
      setErrorMessage(err.message || "Failed to parse recon file.");
      setChainSteps((prev) => prev.map((s) => ({ ...s, status: "pending" })));
    } finally {
      setIsUploadingAndCorrelating(false);
    }
  };

  const handleStageNavigation = (targetStage: V3Stage) => {
    if (!sessionId) return;
    navigate(`/reconciliations-v3/${sessionId}/${targetStage}`);
  };

  const activeStageInfo = V3_STAGES.find((s) => s.key === currentStage) || V3_STAGES[0];

  return (
    <div className="v2-workspace-container" style={{ minHeight: "100vh", background: "#0b0f19", color: "#f8fafc" }}>
      {/* Top Universal Stepper Header */}
      <header
        style={{
          background: "rgba(15, 23, 42, 0.95)",
          borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
          padding: "1rem 2rem",
          position: "sticky",
          top: 0,
          zIndex: 40,
          backdropFilter: "blur(12px)",
        }}
      >
        <div style={{ maxWidth: 1400, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                background: "linear-gradient(135deg, #00338D 0%, #06b6d4 100%)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 4px 12px rgba(6, 182, 212, 0.3)",
              }}
            >
              <Layers size={20} style={{ color: "#ffffff" }} />
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <h1 style={{ margin: 0, fontSize: 17, fontWeight: 800, letterSpacing: "-0.01em", color: "#f8fafc" }}>
                  Reconciliation 3.0
                </h1>
                <span
                  style={{
                    background: "rgba(6, 182, 212, 0.15)",
                    color: "#22d3ee",
                    border: "1px solid rgba(6, 182, 212, 0.3)",
                    padding: "2px 7px",
                    borderRadius: 6,
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                >
                  Single Recon File Mode
                </span>
              </div>
              <small style={{ color: "#94a3b8", fontSize: 12 }}>
                Intra-Table Reconciliation • 20,000 Rows • KICS Concurrence
              </small>
            </div>
          </div>

          {/* Stepper Tabs */}
          <nav style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {V3_STAGES.map((s) => {
              const isActive = s.key === currentStage;
              const isPassed = s.number < activeStageInfo.number || sessionStatus === "completed";
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => handleStageNavigation(s.key)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    background: isActive
                      ? "#00338D"
                      : isPassed
                      ? "rgba(30, 41, 59, 0.8)"
                      : "rgba(15, 23, 42, 0.6)",
                    color: isActive ? "#ffffff" : isPassed ? "#cbd5e1" : "#64748b",
                    border: isActive
                      ? "1px solid #38bdf8"
                      : isPassed
                      ? "1px solid rgba(255, 255, 255, 0.1)"
                      : "1px solid rgba(255, 255, 255, 0.04)",
                    borderRadius: 10,
                    padding: "6px 14px",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                  }}
                >
                  <span
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: "50%",
                      background: isActive
                        ? "#ffffff"
                        : isPassed
                        ? "#10b981"
                        : "rgba(255, 255, 255, 0.1)",
                      color: isActive ? "#00338D" : isPassed ? "#ffffff" : "#64748b",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 11,
                      fontWeight: 800,
                    }}
                  >
                    {isPassed && !isActive ? <Check size={12} /> : s.number}
                  </span>
                  <span>{s.label}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      {/* Main Stage Content */}
      <main>
        {currentStage === "setup" && (
          <div style={{ maxWidth: 960, margin: "2.5rem auto", padding: "0 1.5rem" }}>
            <div
              style={{
                background: "linear-gradient(135deg, rgba(0, 51, 141, 0.12) 0%, rgba(15, 23, 42, 0.8) 100%)",
                border: "1px solid rgba(59, 130, 246, 0.25)",
                borderRadius: 18,
                padding: "2.5rem",
                boxShadow: "0 15px 35px -10px rgba(0, 0, 0, 0.5)",
              }}
            >
              <div style={{ textAlign: "center", marginBottom: "2rem" }}>
                <span
                  style={{
                    background: "rgba(6, 182, 212, 0.15)",
                    color: "#22d3ee",
                    border: "1px solid rgba(6, 182, 212, 0.3)",
                    padding: "3px 10px",
                    borderRadius: 12,
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  Intra-Table Single Recon Engine
                </span>
                <h2 style={{ fontSize: 28, fontWeight: 800, color: "#f8fafc", margin: "10px 0 8px 0" }}>
                  Ingest Unified Reconciliation File
                </h2>
                <p style={{ color: "#94a3b8", fontSize: 15, maxWidth: 640, margin: "0 auto", lineHeight: 1.5 }}>
                  Unlike Reconciliation 2.0 (which takes two separate workbooks), Reconciliation 3.0 reconciles corresponding Counterparty and Books columns inside a single unified KICS recon file.
                </p>
              </div>

              {/* Upload Drop Zone */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDraggingOver(true);
                }}
                onDragLeave={() => setIsDraggingOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDraggingOver(false);
                  if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                    setReconFile(e.dataTransfer.files[0]);
                  }
                }}
                style={{
                  border: isDraggingOver ? "2px dashed #38bdf8" : "2px dashed rgba(255, 255, 255, 0.15)",
                  borderRadius: 14,
                  padding: "2.5rem 1.5rem",
                  textAlign: "center",
                  background: isDraggingOver ? "rgba(56, 189, 248, 0.05)" : "rgba(15, 23, 42, 0.5)",
                  cursor: "pointer",
                  marginBottom: "1.5rem",
                }}
                onClick={() => {
                  const input = document.getElementById("v3-file-input");
                  if (input) input.click();
                }}
              >
                <input
                  id="v3-file-input"
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      setReconFile(e.target.files[0]);
                    }
                  }}
                />

                <UploadCloud size={42} style={{ color: "#38bdf8", margin: "0 auto 12px" }} />
                <h4 style={{ margin: 0, fontSize: 16, color: "#f8fafc", fontWeight: 700 }}>
                  {reconFile ? reconFile.name : "Drag and drop your KICS recon file here"}
                </h4>
                <p style={{ color: "#64748b", fontSize: 13, margin: "6px 0 0 0" }}>
                  Supports Microsoft Excel (.xlsx, .xls) and CSV
                </p>
              </div>

              {/* Reference Sample Callout */}
              <div
                style={{
                  background: "rgba(255, 255, 255, 0.03)",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                  borderRadius: 12,
                  padding: "1rem 1.25rem",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: "1.75rem",
                  flexWrap: "wrap",
                  gap: 12,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <FileSpreadsheet size={24} style={{ color: "#34d399" }} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#f8fafc" }}>
                      Default Reference: <code>TARS_KIGS_RECON_20000_Rows_All_Scenarios.xlsx</code>
                    </div>
                    <div style={{ fontSize: 12, color: "#94a3b8" }}>
                      Sheet: <code>KIGS GSTR 2B Reco</code> · 165 columns · 20,000 rows · Full multi-scenario matrix
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => handleStartIngestion(true)}
                  disabled={isUploadingAndCorrelating}
                  style={{
                    background: "#00338D",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: 8,
                    padding: "8px 18px",
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: "pointer",
                    boxShadow: "0 4px 12px rgba(0, 51, 141, 0.4)",
                  }}
                >
                  {isUploadingAndCorrelating ? "Probing Ingestion..." : "Load 20,000-Row Reference"}
                </button>
              </div>

              {/* Error Callout */}
              {errorMessage && (
                <div
                  style={{
                    background: "rgba(239, 68, 68, 0.1)",
                    border: "1px solid rgba(239, 68, 68, 0.3)",
                    borderRadius: 10,
                    padding: "10px 14px",
                    color: "#f87171",
                    fontSize: 13,
                    marginBottom: "1.25rem",
                  }}
                >
                  {errorMessage}
                </div>
              )}

              {/* Chain of Thought Animation */}
              {isUploadingAndCorrelating && (
                <div style={{ marginTop: "1.5rem" }}>
                  <h4 style={{ fontSize: 13, textTransform: "uppercase", color: "#64748b", fontWeight: 700, letterSpacing: "0.05em", marginBottom: 10 }}>
                    Intra-Table Ingestion Pipeline
                  </h4>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {chainSteps.map((step) => (
                      <div
                        key={step.id}
                        style={{
                          background:
                            step.status === "completed"
                              ? "rgba(16, 185, 129, 0.08)"
                              : step.status === "running"
                              ? "rgba(56, 189, 248, 0.08)"
                              : "rgba(255, 255, 255, 0.02)",
                          border:
                            step.status === "completed"
                              ? "1px solid rgba(16, 185, 129, 0.25)"
                              : step.status === "running"
                              ? "1px solid rgba(56, 189, 248, 0.3)"
                              : "1px solid rgba(255, 255, 255, 0.05)",
                          borderRadius: 10,
                          padding: "10px 14px",
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                        }}
                      >
                        {step.status === "completed" ? (
                          <CheckCircle2 size={18} style={{ color: "#34d399" }} />
                        ) : step.status === "running" ? (
                          <RefreshCw size={18} className="spin" style={{ color: "#38bdf8" }} />
                        ) : (
                          <div
                            style={{
                              width: 18,
                              height: 18,
                              borderRadius: "50%",
                              border: "2px solid #475569",
                            }}
                          />
                        )}
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: "#f8fafc" }}>
                            {step.title}
                          </div>
                          <div style={{ fontSize: 12, color: "#94a3b8" }}>{step.desc}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {currentStage === "mapping" && (
          <DynamicMappingGridV3
            correlations={correlationResult?.correlations || []}
            targetColumns={correlationResult?.target_columns || []}
            reconFileName={correlationResult?.recon_filename}
            sheetName={correlationResult?.sheet_name}
            kicsStatusColumn={correlationResult?.kics_status_column}
            agentThoughts={agentThoughts}
            totalDurationMs={correlationResult?.total_duration_ms}
            onChange={(updated) => {
              if (correlationResult) {
                const next = { ...correlationResult, correlations: updated };
                setCorrelationResult(next);
                if (sessionId) {
                  void apiV3.updateMapping(sessionId, updated, correlationResult.kics_status_column || undefined);
                }
              }
            }}
            onConfirmMapping={async () => {
              if (sessionId && correlationResult) {
                await apiV3.confirmMapping(
                  sessionId,
                  correlationResult.correlations,
                  correlationResult.kics_status_column || undefined
                );
                handleStageNavigation("rules");
              }
            }}
            onBackToSetup={() => handleStageNavigation("setup")}
          />
        )}

        {currentStage === "rules" && sessionId && (
          <ReconciliationV3RulesStage
            sessionId={sessionId}
            onBackToMapping={() => handleStageNavigation("mapping")}
            onProceedToResults={() => handleStageNavigation("results")}
          />
        )}

        {currentStage === "results" && sessionId && (
          <ReconciliationV3ResultsStage
            sessionId={sessionId}
            onBackToRules={() => handleStageNavigation("rules")}
            onProceedToSummary={() => handleStageNavigation("summary")}
          />
        )}

        {currentStage === "summary" && sessionId && (
          <ReconciliationV3SummaryStage
            sessionId={sessionId}
            onBackToResults={() => handleStageNavigation("results")}
            onProceedToExport={() => handleStageNavigation("export")}
          />
        )}

        {currentStage === "export" && sessionId && (
          <ReconciliationV3ExportStage
            sessionId={sessionId}
            onBackToSummary={() => handleStageNavigation("summary")}
            onSessionCompleted={() => setSessionStatus("completed")}
          />
        )}
      </main>
    </div>
  );
};
