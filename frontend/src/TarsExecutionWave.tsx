import { useEffect, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Clock,
  Play,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  StopCircle,
  XCircle,
} from "lucide-react";
import {
  AgentActivityEvent,
  api,
  ReconciliationProgress,
} from "./api";

const nf = new Intl.NumberFormat("en-IN");

interface TarsExecutionWaveProps {
  reconciliationId: string;
  stageName?: string;
  onResume?: () => void;
  onOpenCopilot?: () => void;
  compact?: boolean;
}

export function TarsExecutionWave({
  reconciliationId,
  stageName,
  onResume,
  onOpenCopilot,
  compact = false,
}: TarsExecutionWaveProps) {
  const [progress, setProgress] = useState<ReconciliationProgress | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [showFullActivity, setShowFullActivity] = useState(false);
  const [showAbortModal, setShowAbortModal] = useState(false);
  const [aborting, setAborting] = useState(false);
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);

  // Poll progress telemetry periodically
  useEffect(() => {
    if (!reconciliationId) return;

    let intervalId: any = null;
    const fetchProgress = async () => {
      try {
        const prog = await api.progress(reconciliationId);
        setProgress(prog);
        if (
          prog.status === "completed" ||
          prog.status === "failed" ||
          prog.status === "aborted" ||
          prog.interrupt
        ) {
          if (intervalId) clearInterval(intervalId);
        }
      } catch (e) {
        // ignore periodic network fetch errors
      }
    };

    fetchProgress();
    intervalId = setInterval(fetchProgress, 1200);

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [reconciliationId]);

  // Real elapsed timer derived from backend started_at timestamp
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
      progress?.status === "aborting";

    if (isRunning) {
      timer = setInterval(updateTimer, 1000);
      updateTimer();
    } else if (progress?.started_at) {
      updateTimer();
    }

    return () => {
      if (timer) clearInterval(timer);
    };
  }, [progress?.started_at, progress?.completed_at, progress?.status]);

  const handleAbort = async () => {
    setAborting(true);
    try {
      const res = await api.abort(reconciliationId, stageName);
      setProgress(res);
    } catch (e) {
      // fallback handling
    } finally {
      setAborting(false);
      setShowAbortModal(false);
    }
  };

  const formatSeconds = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m < 10 ? "0" : ""}${m}:${s < 10 ? "0" : ""}${s}`;
  };

  if (!progress) {
    return (
      <div className="tars-execution-wave tars-execution-wave--loading surface">
        <RefreshCw className="animate-spin text-accent" size={16} />
        <span>Connecting to TARS Agent execution stream...</span>
      </div>
    );
  }

  const isRunning = progress.status === "running" || progress.status === "processing";
  const isAborting = progress.status === "aborting" || progress.abort_requested;
  const isAborted = progress.status === "aborted";
  const isCompleted = progress.status === "completed";
  const isFailed = progress.status === "failed";
  const isInterrupted = !!progress.interrupt;

  // Active running stage item
  const runningStage = (progress.stages || []).find((st) => st.status === "running");
  const hasMeasurable =
    runningStage?.processed_records !== null &&
    runningStage?.processed_records !== undefined &&
    runningStage?.total_records !== null &&
    runningStage?.total_records !== undefined &&
    runningStage.total_records > 0;

  const percent = hasMeasurable
    ? Math.round((runningStage!.processed_records! / runningStage!.total_records!) * 100)
    : null;

  // Recent 3-5 narrative events
  const recentActivities = (progress.activities || []).slice(-4).reverse();

  return (
    <div className={`tars-execution-wave surface ${compact ? "tars-execution-wave--compact" : ""}`}>
      {/* 1. Live Current-Action Header Bar */}
      <div className="wave-main-bar">
        <div className="wave-action-title">
          {isRunning ? (
            <span className="wave-pulse-dot animate-pulse">●</span>
          ) : isAborting ? (
            <RefreshCw className="animate-spin text-warn" size={18} />
          ) : isAborted ? (
            <StopCircle className="text-muted" size={18} />
          ) : isCompleted ? (
            <CheckCircle2 className="text-good" size={18} />
          ) : isInterrupted ? (
            <ShieldAlert className="text-warn" size={18} />
          ) : isFailed ? (
            <XCircle className="text-danger" size={18} />
          ) : (
            <Sparkles className="text-accent" size={18} />
          )}

          <div className="wave-action-text">
            <strong>
              {isAborting
                ? "◉ Stopping safely..."
                : isAborted
                ? "■ Reconciliation aborted by user"
                : isCompleted
                ? "✓ Reconciliation pipeline complete"
                : isFailed
                ? "✕ Execution failed"
                : isInterrupted
                ? "⚠ Human review required"
                : `◉ ${progress.current_action || "TARS is processing your reconciliation..."}`}
            </strong>
            {hasMeasurable && isRunning && (
              <span className="wave-inline-stats">
                {nf.format(runningStage!.processed_records!)} / {nf.format(runningStage!.total_records!)} · {percent}%
                {progress.estimated_remaining_text && ` · ${progress.estimated_remaining_text} remaining`}
              </span>
            )}
          </div>
        </div>

        <div className="wave-right-controls">
          <div className="elapsed-pill">
            <Clock size={14} />
            <span>{formatSeconds(elapsedSeconds)}</span>
          </div>

          {isRunning && (
            <button
              type="button"
              className="button-secondary button-sm wave-abort-btn"
              onClick={() => setShowAbortModal(true)}
            >
              <StopCircle size={14} />
              Abort
            </button>
          )}

          {isAborted && onResume && (
            <button
              type="button"
              className="button-primary button-sm"
              onClick={onResume}
            >
              <Play size={14} />
              Resume from Checkpoint
            </button>
          )}

          <button
            type="button"
            className="button-ghost button-sm"
            onClick={() => setShowFullActivity((v) => !v)}
          >
            <span>{showFullActivity ? "Hide activity" : "View activity"}</span>
            <ChevronDown
              size={14}
              style={{ transform: showFullActivity ? "rotate(180deg)" : "rotate(0deg)" }}
            />
          </button>
        </div>
      </div>

      {/* 2. Recent Narrative Events Stream (3-5 Items) */}
      {!showFullActivity && recentActivities.length > 0 && (
        <div className="wave-recent-narrative">
          {recentActivities.map((act) => (
            <div key={act.event_id} className="narrative-row">
              <span className="narrative-bullet">↳</span>
              <span className="narrative-text">{act.summary}</span>
              {act.evidence_summary && (
                <span className="narrative-evidence">— {act.evidence_summary}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 3. Full Auditable Agent Activity Log */}
      {showFullActivity && (
        <div className="wave-full-transcript">
          <div className="transcript-header">
            <strong>Auditable TARS Agent Log</strong>
            <small>{progress.activities.length} deterministic execution events</small>
          </div>
          <div className="transcript-list">
            {(progress.activities || []).map((act) => {
              const isExp = expandedEventId === act.event_id;
              return (
                <div key={act.event_id} className="transcript-item">
                  <div className="transcript-item-main">
                    <span className="transcript-time">
                      {new Date(act.timestamp).toLocaleTimeString()}
                    </span>
                    <strong className="transcript-actor">{act.actor_label}:</strong>
                    <span className="transcript-summary">{act.summary}</span>

                    {(act.reasoning_summary || act.evidence_summary) && (
                      <button
                        type="button"
                        className="button-ghost button-xs"
                        onClick={() => setExpandedEventId(isExp ? null : act.event_id)}
                      >
                        {isExp ? "Why? ▲" : "Why? ▼"}
                      </button>
                    )}
                  </div>

                  {isExp && (
                    <div className="transcript-expanded-box">
                      {act.reasoning_summary && (
                        <div>
                          <strong>WHY:</strong> <span>{act.reasoning_summary}</span>
                        </div>
                      )}
                      {act.evidence_summary && (
                        <div>
                          <strong>EVIDENCE:</strong> <span>{act.evidence_summary}</span>
                        </div>
                      )}
                      {act.tool_name && (
                        <div>
                          <strong>TOOL/ENGINE:</strong> <code>{act.tool_name}</code>
                        </div>
                      )}
                      {act.duration_ms !== null && act.duration_ms !== undefined && (
                        <div>
                          <strong>DURATION:</strong> <span>{(act.duration_ms / 1000).toFixed(2)}s</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 4. Compact Safe Abort Confirmation Modal */}
      {showAbortModal && (
        <div className="abort-modal-backdrop">
          <div className="abort-modal-card surface">
            <div className="abort-modal-header">
              <ShieldAlert className="text-warn" size={24} />
              <h4>Abort Reconciliation?</h4>
            </div>
            <p>
              TARS will stop at the next safe checkpoint. Completed stages and safely persisted work will be preserved.
            </p>
            <div className="abort-modal-actions">
              <button
                type="button"
                className="button-secondary"
                onClick={() => setShowAbortModal(false)}
                disabled={aborting}
              >
                Keep Running
              </button>
              <button
                type="button"
                className="button-danger"
                onClick={handleAbort}
                disabled={aborting}
              >
                {aborting ? "Stopping safely..." : "Abort Safely"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
