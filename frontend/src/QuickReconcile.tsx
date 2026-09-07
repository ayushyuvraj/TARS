import { ChangeEvent, DragEvent, useEffect, useState } from "react";
import {
  Activity,
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock,
  FileSearch,
  FileSpreadsheet,
  MessageSquareText,
  Play,
  RefreshCw,
  Scale,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";
import {
  api,
  ClientProfile,
  DatasetRole,
  QuickReconcileResponse,
  RoleDetectionResult,
  ReconciliationProgress,
  AgentActivityEvent,
} from "./api";

const nf = new Intl.NumberFormat("en-IN");

interface QuickReconcileProps {
  onSessionCreated: (reconciliationId: string, targetStage?: string) => void;
  onOpenCopilot: (reconciliationId: string) => void;
}

export function QuickReconcile({
  onSessionCreated,
  onOpenCopilot,
}: QuickReconcileProps) {
  const [file1, setFile1] = useState<File | null>(null);
  const [file2, setFile2] = useState<File | null>(null);
  const [role1, setRole1] = useState<DatasetRole>("government");
  const [role2, setRole2] = useState<DatasetRole>("purchase_register");
  const [roleResult, setRoleResult] = useState<RoleDetectionResult | null>(null);
  const [roleConfirmed, setRoleConfirmed] = useState(false);
  const [detectingRoles, setDetectingRoles] = useState(false);

  const [profiles, setProfiles] = useState<ClientProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string>("");
  const [instruction, setInstruction] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<QuickReconcileResponse | null>(null);
  const [progress, setProgress] = useState<ReconciliationProgress | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [expandedEvents, setExpandedEvents] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetch("/api/client-profiles")
      .then((res) => (res.ok ? res.json() : []))
      .then((data: ClientProfile[]) => setProfiles(data))
      .catch(() => {});
  }, []);

  // Poll progress telemetry periodically when response exists
  useEffect(() => {
    if (!response?.reconciliation_id) return;

    let intervalId: any = null;
    const fetchProgress = async () => {
      try {
        const prog = await api.progress(response.reconciliation_id);
        setProgress(prog);
        if (prog.status === "completed" || prog.status === "failed" || prog.interrupt) {
          if (intervalId) clearInterval(intervalId);
        }
      } catch (e) {
        // ignore periodic fetch errors
      }
    };

    fetchProgress();
    intervalId = setInterval(fetchProgress, 1200);

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [response?.reconciliation_id, response?.status]);

  // Real elapsed timer: derived from persisted backend started_at timestamp
  useEffect(() => {
    let timer: any = null;
    const updateTimer = () => {
      if (progress?.started_at) {
        const startTime = new Date(progress.started_at).getTime();
        const endTime = progress.completed_at
          ? new Date(progress.completed_at).getTime()
          : Date.now();
        const diff = Math.max(0, Math.floor((endTime - startTime) / 1000));
        setElapsedSeconds(diff);
      } else {
        setElapsedSeconds((s) => s + 1);
      }
    };

    const isRunning =
      progress?.status === "running" ||
      progress?.status === "processing" ||
      response?.status === "running" ||
      busy;

    if (isRunning) {
      timer = setInterval(updateTimer, 1000);
      updateTimer();
    } else if (progress?.started_at) {
      updateTimer();
    }

    return () => {
      if (timer) clearInterval(timer);
    };
  }, [progress?.started_at, progress?.completed_at, progress?.status, response?.status, busy]);

  useEffect(() => {
    if (file1 && file2) {
      setDetectingRoles(true);
      setRoleConfirmed(false);
      api
        .detectRoles(file1, file2)
        .then((res) => {
          setRoleResult(res);
          setRole1(res.file_1_role);
          setRole2(res.file_2_role);
          setRoleConfirmed(res.is_confident);
        })
        .catch(() => {
          setRoleResult({
            file_1_role: "government",
            file_2_role: "purchase_register",
            confidence: 0.5,
            is_confident: false,
            reason: "Could not auto-detect roles. Please verify file roles below.",
          });
          setRoleConfirmed(false);
        })
        .finally(() => setDetectingRoles(false));
    } else {
      setRoleResult(null);
      setRoleConfirmed(false);
    }
  }, [file1, file2]);

  const swapRoles = () => {
    const nextR1 = role1 === "government" ? ("purchase_register" as DatasetRole) : ("government" as DatasetRole);
    const nextR2 = role2 === "government" ? ("purchase_register" as DatasetRole) : ("government" as DatasetRole);
    setRole1(nextR1);
    setRole2(nextR2);
    setRoleConfirmed(false);
  };

  const confirmRoles = () => {
    setRoleConfirmed(true);
  };

  const handleDrop = (
    e: DragEvent<HTMLLabelElement>,
    setFile: (f: File | null) => void
  ) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setFile(e.dataTransfer.files[0]);
    }
  };

  const handleDragOver = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const startReconciliation = async () => {
    if (!file1 || !file2 || !roleConfirmed) return;
    setBusy(true);
    setError(null);
    setElapsedSeconds(0);
    try {
      const res = await api.quickReconcile(file1, file2, {
        instruction: instruction.trim() || undefined,
        profile_id: selectedProfileId || undefined,
        file_1_role: role1,
        file_2_role: role2,
      });
      setResponse(res);
      onSessionCreated(res.reconciliation_id, res.current_stage);
    } catch (err: any) {
      setError(err?.message || "Quick reconcile encountered an unhandled error.");
    } finally {
      setBusy(false);
    }
  };

  const resumeReconciliation = async () => {
    if (!response) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.quickResume(response.reconciliation_id, {
        instruction: instruction.trim() || undefined,
        profile_id: selectedProfileId || undefined,
      });
      setResponse(res);
      onSessionCreated(res.reconciliation_id, res.current_stage);
    } catch (err: any) {
      setError(err?.message || "Could not resume reconciliation execution.");
    } finally {
      setBusy(false);
    }
  };

  const formatSeconds = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m < 10 ? "0" : ""}${m}:${s < 10 ? "0" : ""}${s}`;
  };

  const toggleEventExpanded = (id: string) => {
    setExpandedEvents((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const activeStatus = progress?.status || response?.status || "ready";
  const isRunning = activeStatus === "running" || activeStatus === "processing";
  const isCompleted = activeStatus === "completed";
  const isFailed = activeStatus === "failed";
  const currentInterrupt = progress?.interrupt || response?.interrupt;

  const govCount = progress?.counters.government_records || response?.government_records || 0;
  const prCount = progress?.counters.purchase_register_records || response?.purchase_register_records || 0;
  const exactMatches = progress?.counters.exact_matches || response?.summary?.exact_matches || 0;
  const tolMatches = progress?.counters.tolerance_matches || 0;
  const nearProposals = progress?.counters.near_match_proposals || response?.near_summary?.near_match_approvals || 0;
  const ambiguousCount = progress?.counters.ambiguous || 0;
  const materialMismatchCount = progress?.counters.material_mismatch || 0;
  const gstOnlyCount = progress?.counters.gst_only || 0;
  const prOnlyCount = progress?.counters.pr_only || 0;

  return (
    <div className="quick-reconcile-workspace">
      <div className="page-header">
        <div>
          <span className="eyebrow">Zero-Touch Front Door</span>
          <h2>Quick Reconcile</h2>
          <p>
            Provide Government GSTR-2B and Purchase Register workbooks. TARS will automatically
            reuse approved client intelligence, apply governed rules, and execute exact and
            tolerance matching.
          </p>
        </div>
      </div>

      {!response ? (
        <div className="quick-reconcile-card surface">
          <div className="upload-dual-grid">
            <label
              className={`upload-zone${file1 ? " upload-zone--ready" : ""}`}
              htmlFor="quick-file-1"
              onDrop={(e) => handleDrop(e, setFile1)}
              onDragOver={handleDragOver}
            >
              <input
                id="quick-file-1"
                type="file"
                accept=".xlsx"
                className="sr-only"
                onChange={(e: ChangeEvent<HTMLInputElement>) => setFile1(e.target.files?.[0] || null)}
              />
              <FileSpreadsheet className="upload-icon" size={32} />
              <div className="upload-zone-label">
                <strong>{file1 ? file1.name : "Drop File 1 or Click to Upload"}</strong>
                <small>{file1 ? `${(file1.size / 1024).toFixed(1)} KB` : "Excel workbook (.xlsx)"}</small>
              </div>
              {file1 && (
                <span className={`role-pill role-pill--${role1}`}>
                  {role1 === "government" ? "Government GSTR-2B" : "Purchase Register"}
                </span>
              )}
            </label>

            <label
              className={`upload-zone${file2 ? " upload-zone--ready" : ""}`}
              htmlFor="quick-file-2"
              onDrop={(e) => handleDrop(e, setFile2)}
              onDragOver={handleDragOver}
            >
              <input
                id="quick-file-2"
                type="file"
                accept=".xlsx"
                className="sr-only"
                onChange={(e: ChangeEvent<HTMLInputElement>) => setFile2(e.target.files?.[0] || null)}
              />
              <FileSpreadsheet className="upload-icon" size={32} />
              <div className="upload-zone-label">
                <strong>{file2 ? file2.name : "Drop File 2 or Click to Upload"}</strong>
                <small>{file2 ? `${(file2.size / 1024).toFixed(1)} KB` : "Excel workbook (.xlsx)"}</small>
              </div>
              {file2 && (
                <span className={`role-pill role-pill--${role2}`}>
                  {role2 === "government" ? "Government GSTR-2B" : "Purchase Register"}
                </span>
              )}
            </label>
          </div>

          {file1 && file2 && (
            <div className="role-detection-panel">
              {detectingRoles ? (
                <div className="detecting-box">
                  <RefreshCw className="animate-spin" size={16} />
                  <span>Analyzing workbook header semantics & structure...</span>
                </div>
              ) : roleResult ? (
                <div
                  className={`role-result-box ${
                    roleConfirmed ? "role-result-box--confident" : "role-result-box--ambiguous"
                  }`}
                >
                  <div className="role-result-header">
                    {roleConfirmed ? (
                      <ShieldCheck size={20} className="role-icon-good" />
                    ) : (
                      <ShieldAlert size={20} className="role-icon-warn" />
                    )}
                    <div>
                      <strong>
                        {roleConfirmed
                          ? "Workbook Roles Confirmed Automatically"
                          : "Header Semantics Ambiguous — Confirmation Needed"}
                      </strong>
                      <p>{roleResult.reason}</p>
                    </div>
                  </div>

                  <div className="role-evidence-grid">
                    {roleResult.file_1_evidence.length > 0 && (
                      <div className="evidence-col">
                        <small>File 1 Signal ({file1.name}):</small>
                        <ul>
                          {roleResult.file_1_evidence.map((ev, idx) => (
                            <li key={idx}>{ev}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {roleResult.file_2_evidence.length > 0 && (
                      <div className="evidence-col">
                        <small>File 2 Signal ({file2.name}):</small>
                        <ul>
                          {roleResult.file_2_evidence.map((ev, idx) => (
                            <li key={idx}>{ev}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>

                  <div className="role-actions">
                    <button type="button" className="button-secondary button-sm" onClick={swapRoles}>
                      <RefreshCw size={14} />
                      Swap File Roles
                    </button>
                    {!roleConfirmed && (
                      <button type="button" className="button-primary button-sm" onClick={confirmRoles}>
                        <Check size={14} />
                        Confirm File Roles
                      </button>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          )}

          <div className="quick-options-grid">
            <div className="form-group">
              <label htmlFor="quick-client-profile">
                <Building2 size={15} /> Approved Client Profile (Optional)
              </label>
              <select
                id="quick-client-profile"
                value={selectedProfileId}
                onChange={(e) => setSelectedProfileId(e.target.value)}
              >
                <option value="">Auto-detect / Standard Client Policy</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.client_name} — {p.profile_name} (v{p.version})
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="quick-instruction">
                <Sparkles size={15} /> Policy Instruction (Optional)
              </label>
              <input
                id="quick-instruction"
                type="text"
                placeholder='e.g., "Allow ₹50 taxable difference and 7 days date tolerance"'
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
              />
            </div>
          </div>

          {error && (
            <div className="error-banner">
              <CircleAlert size={18} />
              <span>{error}</span>
            </div>
          )}

          <div className="quick-action-bar">
            <button
              type="button"
              className="button-primary button-lg"
              disabled={!file1 || !file2 || !roleConfirmed || busy || detectingRoles}
              onClick={startReconciliation}
            >
              {busy ? (
                <>
                  <RefreshCw className="animate-spin" size={18} />
                  Initiating Quick Reconcile...
                </>
              ) : (
                <>
                  <Play size={18} />
                  Start Quick Reconcile
                </>
              )}
            </button>
          </div>
        </div>
      ) : (
        <div className="quick-results-view">
          {isRunning && (
            <div className="running-notice-banner surface">
              <RefreshCw className="animate-spin text-accent" size={18} />
              <div>
                <strong>Reconciliation is continuing in the background.</strong>
                <p>You may safely navigate away or explore other pages. Returns will restore progress view.</p>
              </div>
            </div>
          )}

          {/* Persistent Execution Progress Telemetry Panel */}
          <div className="surface progress-timeline-card">
            <div className="progress-header">
              <div>
                <span className="eyebrow">Real Execution Telemetry</span>
                <h3>Reconciliation Progress</h3>
                <small>Session {response.reconciliation_id.slice(0, 8)}</small>
              </div>
              <div className="elapsed-badge">
                <Clock size={16} />
                <span>Elapsed: {formatSeconds(elapsedSeconds)}</span>
              </div>
            </div>

            <div className="pipeline-record-stats">
              <div className="stat-pill">
                <span>Government Records:</span>
                <strong>{nf.format(govCount)}</strong>
              </div>
              <div className="stat-pill">
                <span>Purchase Register Records:</span>
                <strong>{nf.format(prCount)}</strong>
              </div>
              <div className="stat-pill">
                <span>Current Stage:</span>
                <strong className="capitalize">{progress?.current_stage || response.current_stage}</strong>
              </div>
            </div>

            {/* Pipeline Checklist */}
            <div className="real-stage-list">
              <div className="stage-row stage-row--completed">
                <span className="stage-icon"><CheckCircle2 size={18} /></span>
                <span className="stage-label">Files Uploaded & Validated</span>
                <span className="stage-detail">
                  {nf.format(govCount)} Govt · {nf.format(prCount)} PR
                </span>
              </div>

              {(progress?.stages || []).map((stage) => {
                const isStageCompleted = stage.status === "completed";
                const isStageRunning = stage.status === "running";
                const isStageInterrupted = stage.status === "interrupted";
                const isStageFailed = stage.status === "failed";
                const hasMeasurable = stage.processed_records !== null && stage.total_records !== null && stage.total_records > 0;
                const percent = hasMeasurable ? Math.round((stage.processed_records! / stage.total_records!) * 100) : null;

                return (
                  <div
                    key={stage.name}
                    className={`stage-row stage-row--${stage.status}`}
                  >
                    <span className="stage-icon">
                      {isStageCompleted ? (
                        <CheckCircle2 size={18} />
                      ) : isStageRunning ? (
                        <RefreshCw className="animate-spin text-accent" size={18} />
                      ) : isStageInterrupted ? (
                        <ShieldAlert size={18} />
                      ) : isStageFailed ? (
                        <CircleAlert size={18} />
                      ) : (
                        <Clock size={18} />
                      )}
                    </span>
                    <span className="stage-label capitalize">{stage.name.replace(/_/g, " ")}</span>
                    <span className="stage-detail">
                      {isStageCompleted ? (
                        "Completed"
                      ) : isStageRunning ? (
                        percent !== null ? `${percent}% (${nf.format(stage.processed_records!)} / ${nf.format(stage.total_records!)})` : "Working…"
                      ) : isStageInterrupted ? (
                        "Interrupted — Action Required"
                      ) : isStageFailed ? (
                        "Failed"
                      ) : (
                        "Pending"
                      )}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Actual Discovered Results Counters */}
            <div className="telemetry-counters-section">
              <h4>Discovered Results Counter</h4>
              <div className="telemetry-grid">
                <div className="telemetry-card telemetry-card--exact">
                  <small>Exact Matches</small>
                  <strong>{nf.format(exactMatches)}</strong>
                </div>
                <div className="telemetry-card telemetry-card--tolerance">
                  <small>Tolerance Matches</small>
                  <strong>{nf.format(tolMatches)}</strong>
                </div>
                <div className="telemetry-card telemetry-card--near">
                  <small>Near-Match Proposals</small>
                  <strong>{nf.format(nearProposals)}</strong>
                </div>
                <div className="telemetry-card telemetry-card--ambiguous">
                  <small>Ambiguous / Review</small>
                  <strong>{nf.format(ambiguousCount)}</strong>
                </div>
                <div className="telemetry-card telemetry-card--mismatch">
                  <small>Material Mismatch</small>
                  <strong>{nf.format(materialMismatchCount)}</strong>
                </div>
                <div className="telemetry-card telemetry-card--unmatched">
                  <small>GST Only</small>
                  <strong>{nf.format(gstOnlyCount)}</strong>
                </div>
                <div className="telemetry-card telemetry-card--unmatched">
                  <small>PR Only</small>
                  <strong>{nf.format(prOnlyCount)}</strong>
                </div>
              </div>
            </div>
          </div>

          {/* Codex-like Live TARS Agent Activity Stream */}
          <div className="surface agent-activity-card">
            <div className="agent-activity-header">
              <div>
                <span className="eyebrow">LangGraph Execution Stream</span>
                <h3>TARS Agent Activity</h3>
                <small>Auditable, deterministic agent event log</small>
              </div>
              {isRunning && (
                <span className="live-pill">
                  <span className="live-dot animate-pulse"></span>
                  LIVE STREAMING
                </span>
              )}
            </div>

            <div className="agent-activity-stream">
              {(progress?.activities || []).length === 0 ? (
                <div className="activity-empty-state">
                  <Sparkles size={24} className="text-muted" />
                  <p>Awaiting agent execution events...</p>
                </div>
              ) : (
                (progress?.activities || []).map((act: AgentActivityEvent) => {
                  const isExp = !!expandedEvents[act.event_id];
                  const isActDone = act.status === "completed";
                  const isActRunning = act.status === "running";
                  const isActInterrupted = act.status === "interrupted";
                  const isActFailed = act.status === "failed";

                  return (
                    <div
                      key={act.event_id}
                      className={`activity-item activity-item--${act.status}`}
                    >
                      <div className="activity-item-main">
                        <span className="activity-status-icon">
                          {isActDone ? (
                            <CheckCircle2 size={16} className="text-good" />
                          ) : isActRunning ? (
                            <RefreshCw size={16} className="animate-spin text-accent" />
                          ) : isActInterrupted ? (
                            <ShieldAlert size={16} className="text-warn" />
                          ) : isActFailed ? (
                            <CircleAlert size={16} className="text-danger" />
                          ) : (
                            <Clock size={16} className="text-muted" />
                          )}
                        </span>

                        <div className="activity-content">
                          <div className="activity-title-row">
                            <strong className="actor-name">{act.actor_label}</strong>
                            <span className="activity-time">
                              {new Date(act.timestamp).toLocaleTimeString()}
                            </span>
                          </div>
                          <p className="activity-summary">{act.summary}</p>
                          {act.evidence_summary && (
                            <span className="activity-evidence">{act.evidence_summary}</span>
                          )}
                        </div>

                        {(act.reasoning_summary || act.tool_name || act.duration_ms) && (
                          <button
                            type="button"
                            className="activity-details-btn"
                            onClick={() => toggleEventExpanded(act.event_id)}
                          >
                            <span>{isExp ? "Hide details" : "View details"}</span>
                            <ChevronDown
                              size={14}
                              style={{ transform: isExp ? "rotate(180deg)" : "rotate(0deg)" }}
                            />
                          </button>
                        )}
                      </div>

                      {isExp && (
                        <div className="activity-expanded-details">
                          {act.reasoning_summary && (
                            <div className="detail-row">
                              <strong>Why:</strong> <span>{act.reasoning_summary}</span>
                            </div>
                          )}
                          {act.evidence_summary && (
                            <div className="detail-row">
                              <strong>Evidence:</strong> <span>{act.evidence_summary}</span>
                            </div>
                          )}
                          {act.tool_name && (
                            <div className="detail-row">
                              <strong>Tool/Engine:</strong> <code>{act.tool_name}</code>
                            </div>
                          )}
                          {act.duration_ms !== null && act.duration_ms !== undefined && (
                            <div className="detail-row">
                              <strong>Duration:</strong> <span>{(act.duration_ms / 1000).toFixed(2)}s</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Legitimate Governance Interrupt UX */}
          {currentInterrupt && (
            <div className="surface interrupt-card">
              <div className="interrupt-header">
                <ShieldAlert size={24} className="interrupt-icon" />
                <div>
                  <h4>Human Review Required</h4>
                  <p>{currentInterrupt.message}</p>
                </div>
              </div>
              <div className="interrupt-actions">
                <button
                  type="button"
                  className="button-primary"
                  onClick={() =>
                    onSessionCreated(
                      response.reconciliation_id,
                      currentInterrupt.action_stage
                    )
                  }
                >
                  {currentInterrupt.action_label}
                  <ChevronRight size={16} />
                </button>
                <button
                  type="button"
                  className="button-secondary"
                  onClick={resumeReconciliation}
                  disabled={busy}
                >
                  <RefreshCw size={15} />
                  Resume Reconciliation
                </button>
              </div>
            </div>
          )}

          {/* Execution Failure UX */}
          {isFailed && (
            <div className="surface failure-card">
              <div className="failure-header">
                <CircleAlert size={24} className="text-danger" />
                <div>
                  <h4>Reconciliation Stopped</h4>
                  <p>Stage: {progress?.current_stage || "Matching Execution"}</p>
                </div>
              </div>
              <div className="failure-details">
                <p>{progress?.error || response?.error || "An unhandled exception occurred during reconciliation execution."}</p>
              </div>
              <button
                type="button"
                className="button-primary"
                onClick={resumeReconciliation}
                disabled={busy}
              >
                <RefreshCw size={15} />
                Retry from Safe Checkpoint
              </button>
            </div>
          )}

          {/* Executive Completion Summary */}
          {isCompleted && (
            <div className="surface executive-summary-card">
              <div className="summary-title-bar">
                <div>
                  <span className="eyebrow">Reconciliation Complete</span>
                  <h3>Executive Summary</h3>
                  <small>Total elapsed time: {formatSeconds(elapsedSeconds)}</small>
                </div>
                <span className="health-badge health-badge--good">
                  <Check size={14} /> Pipeline Complete
                </span>
              </div>

              <div className="executive-metrics-grid">
                <div className="metric-box">
                  <small>Government Records</small>
                  <strong>{nf.format(govCount)}</strong>
                </div>
                <div className="metric-box">
                  <small>PR Records</small>
                  <strong>{nf.format(prCount)}</strong>
                </div>
                <div className="metric-box metric-box--good">
                  <small>Exact Matched</small>
                  <strong>{nf.format(exactMatches)}</strong>
                </div>
                <div className="metric-box metric-box--good">
                  <small>Tolerance Matched</small>
                  <strong>{nf.format(tolMatches)}</strong>
                </div>
                <div className="metric-box metric-box--good">
                  <small>Near Matched / Proposed</small>
                  <strong>{nf.format(nearProposals)}</strong>
                </div>
                <div className="metric-box metric-box--warn">
                  <small>Ambiguous / Review</small>
                  <strong>{nf.format(ambiguousCount)}</strong>
                </div>
                <div className="metric-box metric-box--warn">
                  <small>Material Mismatch</small>
                  <strong>{nf.format(materialMismatchCount)}</strong>
                </div>
                <div className="metric-box metric-box--warn">
                  <small>GST Only</small>
                  <strong>{nf.format(gstOnlyCount)}</strong>
                </div>
                <div className="metric-box metric-box--warn">
                  <small>PR Only</small>
                  <strong>{nf.format(prOnlyCount)}</strong>
                </div>
              </div>

              <div className="executive-nav-actions">
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => onSessionCreated(response.reconciliation_id, "results")}
                >
                  <FileSearch size={16} />
                  Review Results
                </button>
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => onSessionCreated(response.reconciliation_id, "exceptions")}
                >
                  <CircleAlert size={16} />
                  Review Exceptions
                </button>
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => onSessionCreated(response.reconciliation_id, "final-review")}
                >
                  <ArrowRight size={16} />
                  Export Results
                </button>
                <button
                  type="button"
                  className="button-primary"
                  onClick={() => onOpenCopilot(response.reconciliation_id)}
                >
                  <MessageSquareText size={16} />
                  Ask Copilot
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
