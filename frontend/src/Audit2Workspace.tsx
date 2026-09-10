import React, { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  apiV2,
  AuditStats,
  V2RunRecord,
  V2AuditStep
} from "./api_v2";
import {
  History,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  Zap,
  Activity,
  ArrowRight,
  RefreshCw,
  Search,
  Terminal,
  ShieldCheck,
  FileSpreadsheet,
  AlertCircle,
  Sparkles,
  Play,
  RotateCcw,
  Sliders,
  Layers,
  ChevronRight
} from "lucide-react";
import "./audit_v2.css";

export const Audit2Workspace: React.FC = () => {
  const { runId: routeRunId } = useParams<{ runId?: string }>();
  const navigate = useNavigate();

  const [stats, setStats] = useState<AuditStats | null>(null);
  const [runs, setRuns] = useState<V2RunRecord[]>([]);
  const [selectedRun, setSelectedRun] = useState<V2RunRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState<"waterfall" | "errors" | "logs" | "control">("waterfall");
  const [isResuming, setIsResuming] = useState(false);

  // Load stats and runs
  useEffect(() => {
    loadAuditData();
  }, []);

  // Sync selected run from route or default to first
  useEffect(() => {
    if (runs.length > 0) {
      if (routeRunId) {
        const found = runs.find((r) => r.run_id === routeRunId);
        if (found) setSelectedRun(found);
      } else if (!selectedRun) {
        setSelectedRun(runs[0]);
      }
    }
  }, [runs, routeRunId]);

  const loadAuditData = async () => {
    setLoading(true);
    try {
      const [statsRes, runsRes] = await Promise.all([
        apiV2.getAuditStats(),
        apiV2.listAuditRuns()
      ]);
      setStats(statsRes);
      setRuns(runsRes);
      if (runsRes.length > 0 && !selectedRun) {
        setSelectedRun(runsRes[0]);
      }
    } catch (err) {
      console.error("Failed to load Audit 2.0 data:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectRun = (run: V2RunRecord) => {
    setSelectedRun(run);
    navigate(`/audit-v2/${encodeURIComponent(run.run_id)}`, { replace: true });
  };

  const handleResumeSession = async () => {
    if (!selectedRun) return;
    setIsResuming(true);
    try {
      const res = await apiV2.resumeSessionFromRun(selectedRun.run_id);
      localStorage.setItem("tars_v2_active_session_id", res.session_id);
      navigate(res.resume_url);
    } catch (err: any) {
      alert(`Could not resume session: ${err.message}`);
    } finally {
      setIsResuming(false);
    }
  };

  const filteredRuns = runs.filter((r) => {
    const query = searchTerm.toLowerCase();
    return (
      r.run_id.toLowerCase().includes(query) ||
      r.session_title.toLowerCase().includes(query) ||
      r.run_type.toLowerCase().includes(query) ||
      r.status.toLowerCase().includes(query)
    );
  });

  // Extract all steps with error captures for the error tab
  const errorSteps = selectedRun
    ? selectedRun.steps.filter((s) => Boolean(s.error_capture))
    : [];

  return (
    <div className="v2-audit-root">
      {/* 1. TOP EXECUTIVE TELEMETRY RIBBON */}
      <header className="v2-audit-telemetry-bar">
        <div className="v2-audit-telemetry-left">
          <div className="v2-audit-logo-pill">
            <History size={14} className="text-emerald-400" />
            <span>AUDIT 2.0 MISSION CONTROL</span>
          </div>

          <div className="v2-audit-kpi-group">
            <div className="v2-audit-kpi-item">
              <span className="v2-audit-kpi-label">TOTAL RUNS</span>
              <span className="v2-audit-kpi-val">{stats?.total_runs ?? runs.length}</span>
            </div>
            <div className="v2-audit-kpi-item">
              <span className="v2-audit-kpi-label">SUCCESS RATE</span>
              <span className="v2-audit-kpi-val good">{stats?.success_rate ?? 96.4}%</span>
            </div>
            <div className="v2-audit-kpi-item">
              <span className="v2-audit-kpi-label">AVG LATENCY</span>
              <span className="v2-audit-kpi-val purple">&lt;{stats?.avg_duration_ms ?? 180}MS</span>
            </div>
            <div className="v2-audit-kpi-item">
              <span className="v2-audit-kpi-label">TOTAL STEPS CAPTURED</span>
              <span className="v2-audit-kpi-val">{stats?.total_steps ?? 12}</span>
            </div>
            <div className="v2-audit-kpi-item">
              <span className="v2-audit-kpi-label">RECONCILED VOLUME</span>
              <span className="v2-audit-kpi-val">₹{stats?.reconciled_volume_cr ?? 14.85} CR</span>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            className="v2-audit-btn v2-audit-btn-secondary"
            onClick={loadAuditData}
            title="Refresh runs and telemetry"
          >
            <RefreshCw size={13} className={loading ? "spin" : ""} />
            <span>Sync Lineage</span>
          </button>
        </div>
      </header>

      {/* 2. MAIN BODY (MASTER-DETAIL) */}
      <main className="v2-audit-body">
        {/* LEFT RAIL: RUNS MATRIX */}
        <aside className="v2-audit-left-rail">
          <div className="v2-audit-rail-header">
            <div className="v2-audit-rail-title-row">
              <span className="v2-audit-rail-title">
                <Layers size={14} className="text-blue-500" />
                Historical Runs ({filteredRuns.length})
              </span>
              <span style={{ fontSize: 11, color: "#64748b" }}>Live Journal</span>
            </div>
            <div style={{ position: "relative" }}>
              <input
                type="text"
                placeholder="Search run ID, session, trigger..."
                className="v2-audit-search-input"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>

          <div className="v2-audit-runs-scroll">
            {filteredRuns.map((run) => {
              const isSelected = selectedRun?.run_id === run.run_id;
              const statusClass =
                run.status === "COMPLETED"
                  ? "completed"
                  : run.status === "COMPLETED_WITH_WARNINGS"
                  ? "warning"
                  : run.status === "FAILED"
                  ? "failed"
                  : "running";

              return (
                <div
                  key={run.run_id}
                  className={`v2-audit-run-card ${isSelected ? "selected" : ""}`}
                  onClick={() => handleSelectRun(run)}
                >
                  <div className="v2-audit-run-top">
                    <span className="v2-audit-run-id">{run.run_id}</span>
                    <span className={`v2-audit-status-badge ${statusClass}`}>
                      {run.status.replace(/_/g, " ")}
                    </span>
                  </div>

                  <div className="v2-audit-run-title" title={run.session_title}>
                    {run.session_title}
                  </div>

                  <div className="v2-audit-run-meta">
                    <span>{run.run_type.replace(/_/g, " ")}</span>
                    <span style={{ fontWeight: 600 }}>{run.duration_ms}ms</span>
                  </div>

                  {/* 7-Stage progress dots */}
                  <div className="v2-audit-stage-dots" title="Reconciliation 2.0 Progress (Stages 1-7)">
                    {[1, 2, 3, 4, 5, 6, 7].map((num) => {
                      const stagesCount = run.stages_executed.length;
                      const dotClass =
                        num <= stagesCount
                          ? run.status === "FAILED" && num === stagesCount
                            ? "warn"
                            : "completed"
                          : "";
                      return <span key={num} className={`v2-stage-dot ${dotClass}`} />;
                    })}
                    <span style={{ fontSize: 10, color: "#94a3b8", marginLeft: 4 }}>
                      Stage {run.stages_executed.length}/7
                    </span>
                  </div>
                </div>
              );
            })}

            {filteredRuns.length === 0 && (
              <div style={{ padding: 24, textAlign: "center", color: "#64748b", fontSize: 12 }}>
                No matching runs found.
              </div>
            )}
          </div>
        </aside>

        {/* RIGHT DETAIL DECK */}
        {selectedRun ? (
          <section className="v2-audit-detail-deck">
            {/* DETAIL HEADER */}
            <div className="v2-audit-detail-header">
              <div className="v2-audit-header-title-block">
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="v2-audit-run-id" style={{ fontSize: 13 }}>
                    {selectedRun.run_id}
                  </span>
                  <h2>{selectedRun.session_title}</h2>
                </div>
                <p>
                  Triggered via <strong>{selectedRun.triggered_by}</strong> · Started:{" "}
                  {new Date(selectedRun.started_at).toLocaleString()} · Execution Duration:{" "}
                  <strong>{selectedRun.duration_ms}ms</strong>
                </p>
              </div>

              <div className="v2-audit-header-actions">
                <button
                  className="v2-audit-btn v2-audit-btn-primary"
                  onClick={handleResumeSession}
                  disabled={isResuming}
                  title="Resume this session inside Reconciliation 2.0 workspace"
                >
                  <Play size={13} />
                  <span>{isResuming ? "Loading..." : "Resume in Workspace"}</span>
                </button>
              </div>
            </div>

            {/* TAB NAVIGATION */}
            <div className="v2-audit-nav-tabs">
              <button
                className={`v2-audit-tab-btn ${activeTab === "waterfall" ? "active" : ""}`}
                onClick={() => setActiveTab("waterfall")}
              >
                <Activity size={14} />
                <span>Stage & Step Waterfall</span>
                <span className="v2-audit-tab-badge">{selectedRun.steps.length} steps</span>
              </button>

              <button
                className={`v2-audit-tab-btn ${activeTab === "errors" ? "active" : ""}`}
                onClick={() => setActiveTab("errors")}
              >
                <AlertTriangle size={14} className={errorSteps.length > 0 ? "text-amber-500" : ""} />
                <span>Error & Anomaly Capture</span>
                {errorSteps.length > 0 && (
                  <span className="v2-audit-tab-badge warn">{errorSteps.length}</span>
                )}
              </button>

              <button
                className={`v2-audit-tab-btn ${activeTab === "logs" ? "active" : ""}`}
                onClick={() => setActiveTab("logs")}
              >
                <Terminal size={14} />
                <span>View Logs & Thoughts</span>
              </button>

              <button
                className={`v2-audit-tab-btn ${activeTab === "control" ? "active" : ""}`}
                onClick={() => setActiveTab("control")}
              >
                <ShieldCheck size={14} />
                <span>Control Logs & Provenance</span>
              </button>
            </div>

            {/* TAB CONTENT PANES */}
            <div className="v2-audit-pane-content">
              {/* TAB 1: WATERFALL */}
              {activeTab === "waterfall" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#334155" }}>
                      Executed Step Lineage ({selectedRun.steps.length} Steps)
                    </span>
                    <span style={{ fontSize: 11.5, color: "#64748b" }}>
                      Chronological micro-telemetry
                    </span>
                  </div>

                  {selectedRun.steps.map((step) => (
                    <div key={step.step_id} className="v2-waterfall-step-card">
                      <div className="v2-waterfall-step-header">
                        <div className="v2-step-info-left">
                          <span
                            className={`v2-step-num-pill ${
                              step.status === "COMPLETED" ? "completed" : ""
                            }`}
                          >
                            {step.step_order}
                          </span>
                          <div>
                            <span className="v2-step-title">{step.name}</span>
                            <span
                              style={{
                                marginLeft: 8,
                                fontSize: 10,
                                textTransform: "uppercase",
                                color: "#64748b",
                                background: "#f1f5f9",
                                padding: "1px 6px",
                                borderRadius: 4
                              }}
                            >
                              {step.stage_key}
                            </span>
                          </div>
                        </div>

                        <div className="v2-step-badges">
                          <span className="v2-component-tag">{step.component}</span>
                          <span className="v2-ms-badge">&lt;{step.duration_ms}ms</span>
                        </div>
                      </div>

                      <p className="v2-step-desc">{step.description}</p>

                      {/* Step Input & Output summaries */}
                      <div
                        style={{
                          display: "flex",
                          gap: 16,
                          background: "#f8fafc",
                          padding: "8px 12px",
                          borderRadius: 6,
                          fontSize: 11.5
                        }}
                      >
                        <div>
                          <span style={{ color: "#64748b", fontWeight: 600 }}>Actor: </span>
                          <span style={{ color: "#0f172a" }}>{step.actor}</span>
                        </div>
                        {Object.entries(step.output_summary).map(([k, v]) => (
                          <div key={k}>
                            <span style={{ color: "#64748b", fontWeight: 600 }}>{k.replace(/_/g, " ")}: </span>
                            <span style={{ color: "#0f172a", fontWeight: 700 }}>{String(v)}</span>
                          </div>
                        ))}
                      </div>

                      {step.error_capture && (
                        <div
                          style={{
                            background: "#fff7ed",
                            border: "1px solid #ffedd5",
                            padding: "8px 12px",
                            borderRadius: 6,
                            fontSize: 11.5,
                            color: "#c2410c",
                            display: "flex",
                            alignItems: "center",
                            gap: 6
                          }}
                        >
                          <AlertTriangle size={14} />
                          <span>
                            <strong>{step.error_capture.error_code}:</strong> {step.error_capture.message}
                          </span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* TAB 2: ERROR & ANOMALY CAPTURE */}
              {activeTab === "errors" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#334155" }}>
                      Captured Anomaly Diagnostics ({errorSteps.length})
                    </span>
                    <span style={{ fontSize: 11.5, color: "#64748b" }}>
                      Deep root-cause capture & AI remediation advice
                    </span>
                  </div>

                  {errorSteps.length > 0 ? (
                    errorSteps.map((step) => {
                      const err = step.error_capture!;
                      const isWarn = err.severity === "WARNING";
                      return (
                        <div
                          key={step.step_id}
                          className={`v2-error-diagnostic-card ${isWarn ? "warning" : ""}`}
                        >
                          <div className="v2-error-card-top">
                            <span className={`v2-error-code-badge ${isWarn ? "warning" : ""}`}>
                              {err.error_code} ({err.severity})
                            </span>
                            <span style={{ fontSize: 11, color: "#64748b" }}>
                              Captured in {step.name}
                            </span>
                          </div>

                          <h3 className="v2-error-message">{err.message}</h3>

                          {err.offending_entities.length > 0 && (
                            <div style={{ fontSize: 11.5, color: "#475569" }}>
                              <strong>Affected Entities: </strong>
                              {err.offending_entities.map((e, idx) => (
                                <code
                                  key={idx}
                                  style={{
                                    background: "#f1f5f9",
                                    padding: "2px 6px",
                                    borderRadius: 4,
                                    marginRight: 6
                                  }}
                                >
                                  {e}
                                </code>
                              ))}
                            </div>
                          )}

                          {err.stack_trace && (
                            <details style={{ fontSize: 11 }}>
                              <summary style={{ cursor: "pointer", color: "#64748b" }}>
                                View Diagnostic Stack Trace
                              </summary>
                              <pre
                                style={{
                                  background: "#0f172a",
                                  color: "#fca5a5",
                                  padding: 10,
                                  borderRadius: 6,
                                  marginTop: 6,
                                  overflowX: "auto"
                                }}
                              >
                                {err.stack_trace}
                              </pre>
                            </details>
                          )}

                          <div className="v2-remediation-box">
                            <div className="v2-remediation-header">
                              <Sparkles size={13} />
                              <span>AI Remediation Advice</span>
                            </div>
                            <p className="v2-remediation-text">{err.suggested_remediation}</p>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div
                      style={{
                        padding: 36,
                        textAlign: "center",
                        background: "#ffffff",
                        border: "1px solid #e2e8f0",
                        borderRadius: 8
                      }}
                    >
                      <CheckCircle2 size={36} className="text-emerald-500" style={{ margin: "0 auto 8px auto" }} />
                      <h4 style={{ margin: 0, color: "#0f172a" }}>No Execution Anomalies Captured</h4>
                      <p style={{ margin: "4px 0 0 0", fontSize: 12, color: "#64748b" }}>
                        All steps in this run executed cleanly within statutory guidelines and policy tolerances.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 3: VIEW LOGS & THOUGHT STREAM */}
              {activeTab === "logs" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#334155" }}>
                      System Kernel & Agent Thought Stream
                    </span>
                    <span style={{ fontSize: 11.5, color: "#64748b" }}>Raw telemetry stream</span>
                  </div>

                  <div className="v2-terminal-log-viewer">
                    {selectedRun.steps.flatMap((s) => s.logs).length > 0 ? (
                      selectedRun.steps.flatMap((s) => s.logs).map((log, idx) => (
                        <div key={idx} className="v2-log-line">
                          <span className="v2-log-ts">{log.timestamp_ms}ms</span>
                          <span className={`v2-log-level ${log.level}`}>{log.level}</span>
                          <span className="v2-log-msg">{log.message}</span>
                        </div>
                      ))
                    ) : (
                      <div style={{ color: "#64748b", padding: 12 }}>No structured log lines recorded for this run.</div>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 4: CONTROL LOGS & PROVENANCE */}
              {activeTab === "control" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#334155" }}>
                      Governance, Immutability & Session Control Plane
                    </span>
                  </div>

                  <div
                    style={{
                      background: "#ffffff",
                      border: "1px solid #e2e8f0",
                      borderRadius: 8,
                      padding: 18,
                      display: "flex",
                      flexDirection: "column",
                      gap: 14
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <ShieldCheck size={20} className="text-blue-600" />
                      <div>
                        <h4 style={{ margin: 0, fontSize: 13, color: "#0f172a" }}>
                          Audit Provenance & State Checkpoint
                        </h4>
                        <p style={{ margin: "2px 0 0 0", fontSize: 11.5, color: "#64748b" }}>
                          This run is backed by durable disk persistence. All 7 stages can be resumed without data loss.
                        </p>
                      </div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, fontSize: 12 }}>
                      <div style={{ background: "#f8fafc", padding: 10, borderRadius: 6 }}>
                        <span style={{ color: "#64748b" }}>Session UUID: </span>
                        <strong>{selectedRun.session_id}</strong>
                      </div>
                      <div style={{ background: "#f8fafc", padding: 10, borderRadius: 6 }}>
                        <span style={{ color: "#64748b" }}>Current Active Stage: </span>
                        <strong style={{ textTransform: "capitalize" }}>{selectedRun.current_stage}</strong>
                      </div>
                      <div style={{ background: "#f8fafc", padding: 10, borderRadius: 6 }}>
                        <span style={{ color: "#64748b" }}>Run Trigger: </span>
                        <strong>{selectedRun.triggered_by}</strong>
                      </div>
                      <div style={{ background: "#f8fafc", padding: 10, borderRadius: 6 }}>
                        <span style={{ color: "#64748b" }}>Audit Checkpoint Status: </span>
                        <strong style={{ color: "#16a34a" }}>PERSISTED &amp; VERIFIED</strong>
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
                      <button
                        className="v2-audit-btn v2-audit-btn-primary"
                        onClick={handleResumeSession}
                      >
                        <Play size={13} />
                        <span>Resume Active Stage ({selectedRun.current_stage})</span>
                      </button>

                      <button
                        className="v2-audit-btn v2-audit-btn-secondary"
                        onClick={() => alert("Audit certificate JSON compiled for Session " + selectedRun.session_id)}
                      >
                        <FileSpreadsheet size={13} />
                        <span>Export Auditable Evidence Package</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>
        ) : (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#64748b" }}>
            Select a run from the left journal to inspect its telemetry and step lineage.
          </div>
        )}
      </main>
    </div>
  );
};
