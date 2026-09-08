import { ChangeEvent, DragEvent, useEffect, useState } from "react";
import {
  Activity,
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
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
  const [detectingRoles, setDetectingRoles] = useState(false);

  const [profiles, setProfiles] = useState<ClientProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string>("");
  const [instruction, setInstruction] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<QuickReconcileResponse | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    fetch("/api/client-profiles")
      .then((res) => (res.ok ? res.json() : []))
      .then((data: ClientProfile[]) => setProfiles(data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let timer: any;
    if (busy) {
      timer = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
    }
    return () => clearInterval(timer);
  }, [busy]);

  useEffect(() => {
    if (file1 && file2) {
      setDetectingRoles(true);
      api
        .detectRoles(file1, file2)
        .then((res) => {
          setRoleResult(res);
          setRole1(res.file_1_role);
          setRole2(res.file_2_role);
        })
        .catch(() => {
          setRoleResult({
            file_1_role: "government",
            file_2_role: "purchase_register",
            confidence: 0.5,
            is_confident: false,
            reason: "Could not auto-detect roles. Please verify file roles below.",
          });
        })
        .finally(() => setDetectingRoles(false));
    } else {
      setRoleResult(null);
    }
  }, [file1, file2]);

  const swapRoles = () => {
    const nextR1 = role1 === "government" ? ("purchase_register" as DatasetRole) : ("government" as DatasetRole);
    const nextR2 = role2 === "government" ? ("purchase_register" as DatasetRole) : ("government" as DatasetRole);
    setRole1(nextR1);
    setRole2(nextR2);
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
    if (!file1 || !file2) return;
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
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  };

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
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(e) => setFile1(e.target.files?.[0] ?? null)}
                disabled={busy}
              />
              <span className="upload-zone__icon">
                <FileSpreadsheet size={24} />
              </span>
              <strong>First Workbook</strong>
              <span>{file1?.name ?? "Drag & drop or browse .xlsx"}</span>
              <small>
                {role1 === "government" ? "Assigned: Government GSTR-2B" : "Assigned: Purchase Register"}
              </small>
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
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(e) => setFile2(e.target.files?.[0] ?? null)}
                disabled={busy}
              />
              <span className="upload-zone__icon">
                <FileSpreadsheet size={24} />
              </span>
              <strong>Second Workbook</strong>
              <span>{file2?.name ?? "Drag & drop or browse .xlsx"}</span>
              <small>
                {role2 === "government" ? "Assigned: Government GSTR-2B" : "Assigned: Purchase Register"}
              </small>
            </label>
          </div>

          {detectingRoles && (
            <div className="role-detection-notice" role="status">
              <Activity className="spin" size={16} />
              <span>Analyzing header semantics for automatic role identification…</span>
            </div>
          )}

          {roleResult && !detectingRoles && (
            <div
              className={`role-detection-banner ${
                roleResult.is_confident ? "role-detection-banner--success" : "role-detection-banner--warning"
              }`}
            >
              <div className="role-banner-content">
                {roleResult.is_confident ? <ShieldCheck size={18} /> : <CircleAlert size={18} />}
                <div>
                  <strong>
                    {roleResult.is_confident
                      ? `Smart File Identification (${(roleResult.confidence * 100).toFixed(0)}% confidence)`
                      : "Header Semantics Ambiguous — Confirmation Needed"}
                  </strong>
                  <p>{roleResult.reason}</p>
                </div>
              </div>
              <button
                type="button"
                className="button-secondary button-sm"
                onClick={swapRoles}
                disabled={busy}
              >
                <RefreshCw size={14} />
                Swap File Roles
              </button>
            </div>
          )}

          <div className="quick-options-grid">
            <div className="form-field">
              <label htmlFor="quick-profile-select">
                <Building2 size={15} />
                Client Profile (Optional)
              </label>
              <select
                id="quick-profile-select"
                value={selectedProfileId}
                onChange={(e) => setSelectedProfileId(e.target.value)}
                disabled={busy}
              >
                <option value="">Auto-detect compatible Client Profile</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.client_name} — {p.profile_name} (v{p.version})
                  </option>
                ))}
              </select>
            </div>

            <div className="form-field">
              <label htmlFor="quick-instruction">
                <Sparkles size={15} />
                Reconciliation Policy Instruction (Optional)
              </label>
              <input
                id="quick-instruction"
                type="text"
                placeholder='e.g., "Use normal August tolerance rules."'
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                disabled={busy}
              />
            </div>
          </div>

          {error && <div className="error-callout" role="alert">{error}</div>}

          <div className="quick-action-bar">
            <button
              className="button-primary button-lg"
              disabled={!file1 || !file2 || busy}
              onClick={startReconciliation}
            >
              {busy ? (
                <>
                  <Activity className="spin" size={18} />
                  Running Zero-Touch Pipeline… ({formatSeconds(elapsedSeconds)})
                </>
              ) : (
                <>
                  <Zap size={18} />
                  Start Reconciliation
                </>
              )}
            </button>
          </div>
        </div>
      ) : (
        <div className="quick-results-view">
          <div className="surface progress-timeline-card">
            <div className="progress-header">
              <div>
                <span className="eyebrow">Execution Pipeline</span>
                <h3>Reconciliation Progress</h3>
                <small>Session {response.reconciliation_id.slice(0, 8)}</small>
              </div>
              <div className="elapsed-badge">
                <Clock size={15} />
                <span>Elapsed: {formatSeconds(elapsedSeconds)}</span>
              </div>
            </div>

            <div className="real-stage-list">
              <div className="stage-row stage-row--completed">
                <span className="stage-icon"><CheckCircle2 size={18} /></span>
                <span className="stage-label">Files Uploaded & Identified</span>
                <span className="stage-detail">
                  Gov: {nf.format(response.government_records)} records · PR: {nf.format(response.purchase_register_records)} records
                </span>
              </div>

              <div
                className={`stage-row stage-row--${
                  response.stage_statuses["mapping"] === "completed"
                    ? "completed"
                    : response.interrupt?.interrupt_type === "mapping"
                    ? "interrupt"
                    : "pending"
                }`}
              >
                <span className="stage-icon">
                  {response.stage_statuses["mapping"] === "completed" ? (
                    <CheckCircle2 size={18} />
                  ) : response.interrupt?.interrupt_type === "mapping" ? (
                    <CircleAlert size={18} />
                  ) : (
                    <Clock size={18} />
                  )}
                </span>
                <span className="stage-label">Schema Mapping</span>
                <span className="stage-detail">
                  {response.profile_reused
                    ? `Reused Client Profile "${response.profile_name}"`
                    : response.interrupt?.interrupt_type === "mapping"
                    ? "Requires Human Review"
                    : "Confirmed"}
                </span>
              </div>

              <div
                className={`stage-row stage-row--${
                  response.stage_statuses["policy"] === "completed"
                    ? "completed"
                    : response.interrupt?.interrupt_type === "policy"
                    ? "interrupt"
                    : "pending"
                }`}
              >
                <span className="stage-icon">
                  {response.stage_statuses["policy"] === "completed" ? (
                    <CheckCircle2 size={18} />
                  ) : response.interrupt?.interrupt_type === "policy" ? (
                    <CircleAlert size={18} />
                  ) : (
                    <Clock size={18} />
                  )}
                </span>
                <span className="stage-label">Policy & Rules</span>
                <span className="stage-detail">
                  {response.stage_statuses["policy"] === "completed"
                    ? "Reconciliation policy active"
                    : response.interrupt?.interrupt_type === "policy"
                    ? "Requires Human Confirmation"
                    : "Pending"}
                </span>
              </div>

              <div
                className={`stage-row stage-row--${
                  response.stage_statuses["matching"] === "completed" ? "completed" : "pending"
                }`}
              >
                <span className="stage-icon">
                  {response.stage_statuses["matching"] === "completed" ? (
                    <CheckCircle2 size={18} />
                  ) : (
                    <Clock size={18} />
                  )}
                </span>
                <span className="stage-label">Exact & Tolerance Matching</span>
                <span className="stage-detail">
                  {response.summary
                    ? `${nf.format(response.summary.exact_matches)} Exact Matches`
                    : "Pending"}
                </span>
              </div>

              <div
                className={`stage-row stage-row--${
                  response.stage_statuses["near"] === "completed" ? "completed" : "pending"
                }`}
              >
                <span className="stage-icon">
                  {response.stage_statuses["near"] === "completed" ? (
                    <CheckCircle2 size={18} />
                  ) : (
                    <Clock size={18} />
                  )}
                </span>
                <span className="stage-label">Near-Match Analysis & Rules</span>
                <span className="stage-detail">
                  {response.near_summary
                    ? `${nf.format(response.near_summary.near_matches)} Approved Near Matches`
                    : "Pending"}
                </span>
              </div>
            </div>
          </div>

          {response.interrupt && (
            <div className="surface interrupt-card">
              <div className="interrupt-header">
                <ShieldAlert size={24} className="interrupt-icon" />
                <div>
                  <h4>Human Review Required</h4>
                  <p>{response.interrupt.message}</p>
                </div>
              </div>
              <div className="interrupt-actions">
                <button
                  className="button-primary"
                  onClick={() =>
                    onSessionCreated(
                      response.reconciliation_id,
                      response.interrupt!.action_stage
                    )
                  }
                >
                  {response.interrupt.action_label}
                  <ChevronRight size={16} />
                </button>
                <button
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

          {response.status === "completed" && (
            <div className="surface executive-summary-card">
              <div className="summary-title-bar">
                <div>
                  <span className="eyebrow">Reconciliation Complete</span>
                  <h3>Executive Summary</h3>
                </div>
                <span className="health-badge health-badge--good">
                  <Check size={14} /> Pipeline Complete
                </span>
              </div>

              <div className="executive-metrics-grid">
                <div className="metric-box">
                  <small>Government Records</small>
                  <strong>{nf.format(response.government_records)}</strong>
                </div>
                <div className="metric-box">
                  <small>PR Records</small>
                  <strong>{nf.format(response.purchase_register_records)}</strong>
                </div>
                <div className="metric-box metric-box--good">
                  <small>Exact Matched</small>
                  <strong>{nf.format(response.summary?.exact_matches ?? 0)}</strong>
                </div>
                <div className="metric-box metric-box--good">
                  <small>Approved Near</small>
                  <strong>{nf.format(response.near_summary?.near_matches ?? 0)}</strong>
                </div>
                <div className="metric-box metric-box--warn">
                  <small>Ambiguous / Open</small>
                  <strong>
                    {nf.format(response.near_summary?.remaining_government_records ?? 0)}
                  </strong>
                </div>
                <div className="metric-box metric-box--warn">
                  <small>PR-Only Records</small>
                  <strong>{nf.format(response.near_summary?.pr_only_records ?? 0)}</strong>
                </div>
              </div>

              <div className="executive-nav-actions">
                <button
                  className="button-secondary"
                  onClick={() => onSessionCreated(response.reconciliation_id, "results")}
                >
                  <FileSearch size={16} />
                  Review Results
                </button>
                <button
                  className="button-secondary"
                  onClick={() => onSessionCreated(response.reconciliation_id, "exceptions")}
                >
                  <CircleAlert size={16} />
                  Review Exceptions
                </button>
                <button
                  className="button-secondary"
                  onClick={() => onSessionCreated(response.reconciliation_id, "final-review")}
                >
                  <ArrowRight size={16} />
                  Export Results
                </button>
                <button
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
