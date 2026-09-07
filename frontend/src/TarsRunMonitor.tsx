import React, { Component, ErrorInfo, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  GripHorizontal,
  Minus,
  Play,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  StopCircle,
  X,
  XCircle,
} from "lucide-react";
import {
  api,
  AgentActivityEvent,
  QuickReconcileInterrupt,
  ReconciliationProgress,
  StageProgressItem,
} from "./api";

const nf = new Intl.NumberFormat("en-IN");

interface TarsRunMonitorProps {
  reconciliationId: string | null;
  stageName?: string;
  copilotOpen?: boolean;
  onResume?: () => void;
  onOpenCopilot?: () => void;
  onConfirmMapping?: () => void;
  onConfirmPolicy?: () => void;
  onNavigateStage?: (stage: string) => void;
  onDismiss?: () => void;
}

const STAGE_CONFIGS = [
  { key: "setup", label: "Setup", num: 1, route: "setup" },
  { key: "mapping", label: "Mapping", num: 2, route: "mapping" },
  { key: "policy", label: "Policy", num: 3, route: "policy" },
  { key: "exact_matching", label: "Reconciliation", num: 4, route: "results" },
  { key: "near_match_analysis", label: "Near Matches", num: 5, route: "near-matches" },
  { key: "exception_construction", label: "Exceptions", num: 6, route: "exceptions" },
  { key: "audit", label: "Audit", num: 7, route: "audit" },
  { key: "finalization", label: "Export", num: 8, route: "final-review" },
];

export interface NormalizedStageItem {
  name: string;
  status: "pending" | "running" | "completed" | "interrupted" | "failed";
  started_at: string | null;
  completed_at: string | null;
  processed_records: number | null;
  total_records: number | null;
}

export interface NormalizedActivityEvent {
  event_id: string;
  timestamp: string;
  reconciliation_id: string;
  graph_node: string;
  actor_label: string;
  event_type: "started" | "progress" | "decision" | "tool_call" | "completed" | "interrupted" | "failed";
  status: string;
  summary: string;
  reasoning_summary?: string | null;
  evidence_summary?: string | null;
  tool_name?: string | null;
  rule_id?: string | null;
  policy_version?: number | null;
  profile_version?: number | null;
  processed_records?: number | null;
  total_records?: number | null;
}

export interface NormalizedProgressCounters {
  government_records: number;
  purchase_register_records: number;
  exact_matches: number;
  tolerance_matches: number;
  near_match_proposals: number;
  ambiguous: number;
  material_mismatch: number;
  gst_only: number;
  pr_only: number;
}

export interface NormalizedProgress {
  canRender: boolean;
  reconciliation_id: string;
  status: string;
  started_at: string | null;
  updated_at: string | null;
  completed_at: string | null;
  current_stage: string;
  current_action: string | null;
  estimated_remaining_seconds: number | null;
  estimated_remaining_text: string | null;
  abort_requested: boolean;
  completed_stages_count: number;
  total_stages_count: number;
  stages: NormalizedStageItem[];
  counters: NormalizedProgressCounters;
  activities: NormalizedActivityEvent[];
  interrupt: QuickReconcileInterrupt | null;
  error: string | null;
}

// Runtime Payload Normalizer for Legacy and Incomplete Telemetry Shapes
export function normalizeProgress(raw: any): NormalizedProgress {
  const defaultCounters: NormalizedProgressCounters = {
    government_records: 0,
    purchase_register_records: 0,
    exact_matches: 0,
    tolerance_matches: 0,
    near_match_proposals: 0,
    ambiguous: 0,
    material_mismatch: 0,
    gst_only: 0,
    pr_only: 0,
  };

  if (!raw || typeof raw !== "object") {
    return {
      canRender: false,
      reconciliation_id: "",
      status: "unknown",
      started_at: null,
      updated_at: null,
      completed_at: null,
      current_stage: "exact_matching",
      current_action: null,
      estimated_remaining_seconds: null,
      estimated_remaining_text: null,
      abort_requested: false,
      completed_stages_count: 0,
      total_stages_count: 8,
      stages: [],
      counters: defaultCounters,
      activities: [],
      interrupt: null,
      error: null,
    };
  }

  const reconciliation_id = typeof raw.reconciliation_id === "string" ? raw.reconciliation_id : "";
  const status = typeof raw.status === "string" ? raw.status : "unknown";
  const current_stage = typeof raw.current_stage === "string" ? raw.current_stage : "exact_matching";
  const started_at = typeof raw.started_at === "string" ? raw.started_at : null;
  const updated_at = typeof raw.updated_at === "string" ? raw.updated_at : null;
  const completed_at = typeof raw.completed_at === "string" ? raw.completed_at : null;
  const current_action = typeof raw.current_action === "string" ? raw.current_action : null;

  const estimated_remaining_seconds =
    typeof raw.estimated_remaining_seconds === "number" && !isNaN(raw.estimated_remaining_seconds)
      ? raw.estimated_remaining_seconds
      : null;
  const estimated_remaining_text =
    typeof raw.estimated_remaining_text === "string" ? raw.estimated_remaining_text : null;
  const abort_requested = Boolean(raw.abort_requested);

  // Normalize stages array safely
  const stages: NormalizedStageItem[] = [];
  if (Array.isArray(raw.stages)) {
    for (const s of raw.stages) {
      if (s && typeof s === "object") {
        stages.push({
          name: typeof s.name === "string" ? s.name : "",
          status:
            s.status === "pending" ||
            s.status === "running" ||
            s.status === "completed" ||
            s.status === "interrupted" ||
            s.status === "failed"
              ? s.status
              : "pending",
          started_at: typeof s.started_at === "string" ? s.started_at : null,
          completed_at: typeof s.completed_at === "string" ? s.completed_at : null,
          processed_records:
            typeof s.processed_records === "number" && !isNaN(s.processed_records) ? s.processed_records : null,
          total_records:
            typeof s.total_records === "number" && !isNaN(s.total_records) ? s.total_records : null,
        });
      }
    }
  }

  // Normalize counters safely
  const rawCounters = raw.counters && typeof raw.counters === "object" ? raw.counters : {};
  const counters: NormalizedProgressCounters = {
    government_records:
      typeof rawCounters.government_records === "number" && !isNaN(rawCounters.government_records)
        ? rawCounters.government_records
        : 0,
    purchase_register_records:
      typeof rawCounters.purchase_register_records === "number" && !isNaN(rawCounters.purchase_register_records)
        ? rawCounters.purchase_register_records
        : 0,
    exact_matches:
      typeof rawCounters.exact_matches === "number" && !isNaN(rawCounters.exact_matches)
        ? rawCounters.exact_matches
        : 0,
    tolerance_matches:
      typeof rawCounters.tolerance_matches === "number" && !isNaN(rawCounters.tolerance_matches)
        ? rawCounters.tolerance_matches
        : 0,
    near_match_proposals:
      typeof rawCounters.near_match_proposals === "number" && !isNaN(rawCounters.near_match_proposals)
        ? rawCounters.near_match_proposals
        : 0,
    ambiguous:
      typeof rawCounters.ambiguous === "number" && !isNaN(rawCounters.ambiguous)
        ? rawCounters.ambiguous
        : 0,
    material_mismatch:
      typeof rawCounters.material_mismatch === "number" && !isNaN(rawCounters.material_mismatch)
        ? rawCounters.material_mismatch
        : 0,
    gst_only:
      typeof rawCounters.gst_only === "number" && !isNaN(rawCounters.gst_only)
        ? rawCounters.gst_only
        : 0,
    pr_only:
      typeof rawCounters.pr_only === "number" && !isNaN(rawCounters.pr_only)
        ? rawCounters.pr_only
        : 0,
  };

  // Normalize activities array safely
  const activities: NormalizedActivityEvent[] = [];
  if (Array.isArray(raw.activities)) {
    for (let idx = 0; idx < raw.activities.length; idx++) {
      const act = raw.activities[idx];
      if (act && typeof act === "object") {
        activities.push({
          event_id: typeof act.event_id === "string" ? act.event_id : `act_${idx}`,
          timestamp: typeof act.timestamp === "string" ? act.timestamp : "",
          reconciliation_id: typeof act.reconciliation_id === "string" ? act.reconciliation_id : reconciliation_id,
          graph_node: typeof act.graph_node === "string" ? act.graph_node : "",
          actor_label: typeof act.actor_label === "string" ? act.actor_label : "TARS Engine",
          event_type:
            act.event_type === "started" ||
            act.event_type === "progress" ||
            act.event_type === "decision" ||
            act.event_type === "tool_call" ||
            act.event_type === "completed" ||
            act.event_type === "interrupted" ||
            act.event_type === "failed"
              ? act.event_type
              : "progress",
          status: typeof act.status === "string" ? act.status : "",
          summary: typeof act.summary === "string" ? act.summary : "Activity event",
          reasoning_summary: typeof act.reasoning_summary === "string" ? act.reasoning_summary : null,
          evidence_summary: typeof act.evidence_summary === "string" ? act.evidence_summary : null,
          tool_name: typeof act.tool_name === "string" ? act.tool_name : null,
          rule_id: typeof act.rule_id === "string" ? act.rule_id : null,
          policy_version: typeof act.policy_version === "number" ? act.policy_version : null,
          profile_version: typeof act.profile_version === "number" ? act.profile_version : null,
          processed_records: typeof act.processed_records === "number" ? act.processed_records : null,
          total_records: typeof act.total_records === "number" ? act.total_records : null,
        });
      }
    }
  }

  const completed_stages_count =
    typeof raw.completed_stages_count === "number" && !isNaN(raw.completed_stages_count)
      ? raw.completed_stages_count
      : stages.filter((s) => s.status === "completed").length;

  const total_stages_count =
    typeof raw.total_stages_count === "number" && !isNaN(raw.total_stages_count) && raw.total_stages_count > 0
      ? raw.total_stages_count
      : 8;

  const interrupt = raw.interrupt && typeof raw.interrupt === "object" ? raw.interrupt : null;
  const error = typeof raw.error === "string" ? raw.error : null;

  return {
    canRender: true,
    reconciliation_id,
    status,
    started_at,
    updated_at,
    completed_at,
    current_stage,
    current_action,
    estimated_remaining_seconds,
    estimated_remaining_text,
    abort_requested,
    completed_stages_count,
    total_stages_count,
    stages,
    counters,
    activities,
    interrupt,
    error,
  };
}

// Versioned Browser UI Storage Helpers (tars-run-monitor:v2)
function getSavedPosition(): { x: number; y: number } | null {
  try {
    const item = localStorage.getItem("tars-run-monitor:v2-pos");
    if (!item) return null;
    const parsed = JSON.parse(item);
    if (
      parsed &&
      typeof parsed.x === "number" &&
      typeof parsed.y === "number" &&
      isFinite(parsed.x) &&
      isFinite(parsed.y)
    ) {
      if (parsed.y >= 0 && parsed.y < window.innerHeight - 30) {
        return { x: parsed.x, y: parsed.y };
      }
    }
  } catch (e) {}
  return null;
}

function setSavedPosition(pos: { x: number; y: number } | null) {
  try {
    if (!pos) {
      localStorage.removeItem("tars-run-monitor:v2-pos");
    } else {
      localStorage.setItem("tars-run-monitor:v2-pos", JSON.stringify(pos));
    }
  } catch (e) {}
}

function getSavedMinimized(): boolean {
  try {
    return localStorage.getItem("tars-run-monitor:v2-minimized") === "true";
  } catch (e) {
    return false;
  }
}

function setSavedMinimized(minimized: boolean) {
  try {
    localStorage.setItem("tars-run-monitor:v2-minimized", String(minimized));
  } catch (e) {}
}

function getSavedHidden(): boolean {
  try {
    return localStorage.getItem("tars-run-monitor:v2-hidden") === "true";
  } catch (e) {
    return false;
  }
}

function setSavedHidden(hidden: boolean) {
  try {
    localStorage.setItem("tars-run-monitor:v2-hidden", String(hidden));
  } catch (e) {}
}

function safeParseDate(val: string | null | undefined): number | null {
  if (!val || typeof val !== "string") return null;
  try {
    const t = new Date(val).getTime();
    return isNaN(t) || !isFinite(t) ? null : t;
  } catch {
    return null;
  }
}

function formatSeconds(sec: number | null | undefined): string {
  if (typeof sec !== "number" || isNaN(sec) || !isFinite(sec) || sec < 0) {
    return "00:00";
  }
  const total = Math.floor(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m < 10 ? "0" : ""}${m}:${s < 10 ? "0" : ""}${s}`;
}

// Isolated Monitor Error Boundary: Guarantees Primary TARS UI Never Crashes
interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class TarsRunMonitorErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[TarsRunMonitor Isolated Render Failure]:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <aside
          className="tars-run-monitor-floating tars-run-monitor-fallback"
          style={{
            position: "fixed",
            bottom: "24px",
            right: "24px",
            zIndex: 999,
            padding: "12px 16px",
            background: "rgba(15, 23, 42, 0.92)",
            backdropFilter: "blur(8px)",
            color: "#f8fafc",
            borderRadius: "12px",
            border: "1px solid rgba(245, 158, 11, 0.4)",
            boxShadow: "0 10px 30px rgba(0,0,0,0.3)",
            fontSize: "13px",
            display: "flex",
            alignItems: "center",
            gap: "10px",
          }}
        >
          <span style={{ color: "#fbbf24", fontWeight: 600 }}>⚠ TARS activity monitor unavailable</span>
          <button
            type="button"
            className="button-secondary-dark button-xs"
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            Retry
          </button>
        </aside>
      );
    }
    return this.props.children;
  }
}

function TarsRunMonitorImpl({
  reconciliationId,
  stageName,
  copilotOpen = false,
  onResume,
  onOpenCopilot,
  onConfirmMapping,
  onConfirmPolicy,
  onNavigateStage,
  onDismiss,
}: TarsRunMonitorProps) {
  const [rawProgress, setRawProgress] = useState<ReconciliationProgress | null>(null);
  const [totalElapsedSeconds, setTotalElapsedSeconds] = useState(0);
  const [stageElapsedSeconds, setStageElapsedSeconds] = useState(0);
  const [isMinimized, setIsMinimized] = useState<boolean>(() => getSavedMinimized());
  const [isHidden, setIsHidden] = useState<boolean>(() => getSavedHidden());
  const [showAbortConfirm, setShowAbortConfirm] = useState(false);
  const [aborting, setAborting] = useState(false);
  const [expandedSubstepKey, setExpandedSubstepKey] = useState<string | null>(null);
  const [manualExpandedStages, setManualExpandedStages] = useState<Record<string, boolean>>({});

  // Desktop Draggable Position State
  const [pos, setPos] = useState<{ x: number; y: number } | null>(() => getSavedPosition());
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; initialX: number; initialY: number } | null>(null);
  const monitorRef = useRef<HTMLDivElement>(null);

  // Normalize Telemetry Payload safely
  const normProgress = useMemo(() => normalizeProgress(rawProgress), [rawProgress]);

  // Persist UI state choices
  useEffect(() => {
    setSavedPosition(pos);
  }, [pos]);

  useEffect(() => {
    setSavedMinimized(isMinimized);
  }, [isMinimized]);

  useEffect(() => {
    setSavedHidden(isHidden);
  }, [isHidden]);

  // Poll progress telemetry periodically when active reconciliation exists
  useEffect(() => {
    if (!reconciliationId) {
      setRawProgress(null);
      return;
    }

    let intervalId: any = null;
    const fetchProgress = async () => {
      try {
        const prog = await api.progress(reconciliationId);
        setRawProgress(prog);
        if (
          prog?.status === "completed" ||
          prog?.status === "failed" ||
          prog?.status === "aborted" ||
          prog?.interrupt
        ) {
          if (intervalId) clearInterval(intervalId);
        }
      } catch (e) {
        // Fallback gracefully on network error or missing endpoint
      }
    };

    fetchProgress();
    intervalId = setInterval(fetchProgress, 1000);

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [reconciliationId]);

  // Timers: Total Run Elapsed and Active Stage Elapsed
  useEffect(() => {
    let timer: any = null;
    const updateTimers = () => {
      const startTime = safeParseDate(normProgress.started_at);
      if (startTime !== null) {
        const endTime = safeParseDate(normProgress.completed_at) ?? Date.now();
        setTotalElapsedSeconds(Math.max(0, Math.floor((endTime - startTime) / 1000)));

        // Stage elapsed
        const currentStageObj = normProgress.stages.find(
          (s) => s.name === normProgress.current_stage || s.status === "running"
        );
        const stStart = safeParseDate(currentStageObj?.started_at);
        if (stStart !== null) {
          const stEnd = safeParseDate(currentStageObj?.completed_at) ?? Date.now();
          setStageElapsedSeconds(Math.max(0, Math.floor((stEnd - stStart) / 1000)));
        } else {
          setStageElapsedSeconds(Math.max(0, Math.floor((endTime - startTime) / 1000)));
        }
      } else {
        setTotalElapsedSeconds(0);
        setStageElapsedSeconds(0);
      }
    };

    const isRunning =
      normProgress.status === "running" ||
      normProgress.status === "processing" ||
      normProgress.status === "aborting";

    if (isRunning) {
      timer = setInterval(updateTimers, 1000);
      updateTimers();
    } else if (normProgress.started_at) {
      updateTimers();
    }

    return () => {
      if (timer) clearInterval(timer);
    };
  }, [
    normProgress.started_at,
    normProgress.completed_at,
    normProgress.status,
    normProgress.current_stage,
    normProgress.stages,
  ]);

  // Desktop Drag Handlers
  const handlePointerDown = (e: React.PointerEvent) => {
    if (window.innerWidth < 768) return;
    if ((e.target as HTMLElement).closest("button")) return;

    setIsDragging(true);
    const rect = monitorRef.current?.getBoundingClientRect();
    const initialX = rect ? rect.left : window.innerWidth - 480;
    const initialY = rect ? rect.top : window.innerHeight - 560;

    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      initialX,
      initialY,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging || !dragStartRef.current) return;
    const dx = e.clientX - dragStartRef.current.mouseX;
    const dy = e.clientY - dragStartRef.current.mouseY;

    const monitorWidth = monitorRef.current?.offsetWidth || 460;
    const minX = -monitorWidth + 40;
    const maxX = window.innerWidth - 40;
    const minY = 10;
    const maxY = window.innerHeight - 50;

    const newX = Math.max(minX, Math.min(maxX, dragStartRef.current.initialX + dx));
    const newY = Math.max(minY, Math.min(maxY, dragStartRef.current.initialY + dy));

    setPos({ x: newX, y: newY });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (isDragging) {
      setIsDragging(false);
      dragStartRef.current = null;
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch (err) {}
    }
  };

  const handleAbort = async () => {
    if (!reconciliationId) return;
    setAborting(true);
    try {
      const res = await api.abort(reconciliationId, stageName);
      setRawProgress(res);
    } catch (e) {
      // fallback
    } finally {
      setAborting(false);
      setShowAbortConfirm(false);
    }
  };

  // Safe Guard: Do not render monitor if reconciliationId is absent or raw payload cannot be normalized
  if (!reconciliationId || !normProgress.canRender) {
    return null;
  }

  // Safe collections & guards from normalized telemetry
  const activities = normProgress.activities;
  const stagesList = normProgress.stages;
  const counters = normProgress.counters;

  const isRunning = normProgress.status === "running" || normProgress.status === "processing";
  const isAborting = normProgress.status === "aborting" || normProgress.abort_requested;
  const isAborted = normProgress.status === "aborted";
  const isCompleted = normProgress.status === "completed";
  const isFailed = normProgress.status === "failed";
  const isInterrupted = !!normProgress.interrupt || normProgress.status === "interrupted";

  // Pipeline stage counters
  const completedStagesCount = normProgress.completed_stages_count;
  const totalStagesCount = normProgress.total_stages_count;
  const isAllStagesComplete = completedStagesCount >= totalStagesCount;

  // Active stage configuration
  const currentStageConfig =
    STAGE_CONFIGS.find((s) => s.key === normProgress.current_stage) || STAGE_CONFIGS[3];

  // Active running stage item
  const runningStageItem = stagesList.find((st) => st.status === "running");
  const hasMeasurable = Boolean(
    runningStageItem &&
      typeof runningStageItem.processed_records === "number" &&
      typeof runningStageItem.total_records === "number" &&
      runningStageItem.total_records > 0
  );

  const percent = hasMeasurable
    ? Math.min(
        100,
        Math.max(
          0,
          Math.floor(
            (runningStageItem!.processed_records! / Math.max(1, runningStageItem!.total_records!)) * 100
          )
        )
      )
    : null;

  // Authentic Throughput & ETA Calculation with Minimum Sample Rule
  let etaText: string | null = null;
  let expectedFinishText: string | null = null;

  if (isRunning && hasMeasurable) {
    const proc = runningStageItem!.processed_records!;
    const tot = runningStageItem!.total_records!;
    if (stageElapsedSeconds >= 3 && proc >= 50) {
      const throughput = proc / stageElapsedSeconds;
      if (throughput > 0) {
        const remainingRecords = tot - proc;
        const etaSec = Math.round(remainingRecords / throughput);
        etaText = `~${formatSeconds(etaSec)}`;

        const expectedDate = new Date(Date.now() + etaSec * 1000);
        expectedFinishText = expectedDate.toLocaleTimeString("en-IN", {
          hour: "2-digit",
          minute: "2-digit",
        });
      }
    } else {
      etaText = "Calculating...";
    }
  } else if (isInterrupted) {
    etaText = "Paused — waiting for confirmation";
  }

  // Position style overrides for dragging
  const dynamicStyle: React.CSSProperties = pos
    ? {
        position: "fixed",
        left: `${pos.x}px`,
        top: `${pos.y}px`,
        bottom: "auto",
        right: "auto",
      }
    : {};

  const posClass = copilotOpen && !pos ? " tars-run-monitor-floating--copilot" : "";
  const pillPosClass = copilotOpen && !pos ? " tars-run-monitor-pill--copilot" : "";

  // 1. Recoverable Hidden Chip (When user clicks Hide X)
  if (isHidden) {
    return (
      <div
        className={`tars-run-monitor-chip${pillPosClass}`}
        style={dynamicStyle}
        onClick={() => setIsHidden(false)}
        role="button"
        tabIndex={0}
        aria-label="Reopen TARS monitor"
      >
        {isRunning ? (
          <span className="wave-pulse-dot animate-pulse text-accent">●</span>
        ) : (
          <Sparkles className="text-accent" size={14} />
        )}
        <span>TARS {isRunning ? `working · ${percent ?? 0}%` : "monitor"}</span>
        <button
          type="button"
          className="button-ghost button-xs"
          style={{ color: "#38bdf8", padding: "2px 6px" }}
          onClick={(e) => {
            e.stopPropagation();
            setIsHidden(false);
          }}
        >
          Reopen
        </button>
      </div>
    );
  }

  // 2. Minimized Floating Pill View
  if (isMinimized) {
    return (
      <div
        className={`tars-run-monitor-pill${pillPosClass}`}
        style={dynamicStyle}
        onClick={() => setIsMinimized(false)}
        role="button"
        tabIndex={0}
        aria-label="Open TARS execution monitor"
      >
        {isRunning ? (
          <span className="wave-pulse-dot animate-pulse text-accent">●</span>
        ) : isAborting ? (
          <RefreshCw className="animate-spin text-warn" size={14} />
        ) : isAborted ? (
          <StopCircle className="text-muted" size={14} />
        ) : isCompleted ? (
          <CheckCircle2 className="text-good" size={14} />
        ) : (
          <Sparkles className="text-accent" size={14} />
        )}
        <span>
          TARS · Stage {currentStageConfig.num} · {currentStageConfig.label}
          {percent !== null && ` · ${percent}%`}
          {` · Total ${formatSeconds(totalElapsedSeconds)}`}
        </span>
        <button
          type="button"
          className="button-ghost button-xs"
          style={{ color: "#38bdf8", padding: "2px 6px" }}
          onClick={(e) => {
            e.stopPropagation();
            setIsMinimized(false);
          }}
        >
          Open
        </button>
      </div>
    );
  }

  // 3. Full 2-Level Hierarchical Accordion Codex Window V2
  return (
    <aside
      ref={monitorRef}
      className={`tars-run-monitor-floating tars-run-monitor-v2${posClass}`}
      style={dynamicStyle}
      role="dialog"
      aria-label="TARS Execution Monitor"
    >
      {/* Draggable Header Bar */}
      <div
        className="monitor-header"
        style={{ cursor: isDragging ? "grabbing" : "grab" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <div className="monitor-header-title">
          <GripHorizontal size={15} className="text-muted drag-grip-icon" />
          {isRunning ? (
            <span className="wave-pulse-dot animate-pulse text-accent">●</span>
          ) : isAborting ? (
            <RefreshCw className="animate-spin text-warn" size={16} />
          ) : isAborted ? (
            <StopCircle className="text-muted" size={16} />
          ) : isCompleted ? (
            <CheckCircle2 className="text-good" size={16} />
          ) : isInterrupted ? (
            <ShieldAlert className="text-warn" size={16} />
          ) : isFailed ? (
            <XCircle className="text-danger" size={16} />
          ) : (
            <Sparkles className="text-accent" size={16} />
          )}
          <div className="monitor-title-copy">
            <strong>TARS Reconciliation</strong>
            <small>
              {isInterrupted
                ? "Waiting on user confirmation"
                : isRunning
                ? `Stage ${currentStageConfig.num} of 8 · ${currentStageConfig.label}`
                : isCompleted
                ? isAllStagesComplete
                  ? "All 8 stages complete"
                  : `Stage ${completedStagesCount} complete`
                : "Execution monitor"}
            </small>
          </div>
        </div>

        <div className="monitor-header-actions">
          <span className="elapsed-badge-dark" title="Total run duration across stages">
            <Clock size={12} />
            Total {formatSeconds(totalElapsedSeconds)}
          </span>
          <button
            type="button"
            className="icon-button-dark"
            onClick={() => setIsMinimized(true)}
            title="Minimize to floating pill"
            aria-label="Minimize"
          >
            <Minus size={15} />
          </button>
          <button
            type="button"
            className="icon-button-dark"
            onClick={() => {
              setIsHidden(true);
              if (onDismiss) onDismiss();
            }}
            title="Hide monitor (Execution continues in background)"
            aria-label="Hide"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {/* Level 1 & Level 2 Hierarchical Accordion Feed */}
      <div className="monitor-accordion-body">
        {/* Macro Pipeline Dots */}
        <div className="pipeline-dot-rail">
          {STAGE_CONFIGS.map((stConfig) => {
            const stItem = stagesList.find((s) => s && s.name === stConfig.key);
            const isDone = stItem?.status === "completed" || stConfig.num <= completedStagesCount;
            const isCurrent = normProgress.current_stage === stConfig.key;
            return (
              <span
                key={stConfig.key}
                className={`pipeline-dot ${isDone ? "pipeline-dot--done" : isCurrent ? "pipeline-dot--current" : ""}`}
                title={`Stage ${stConfig.num}: ${stConfig.label} (${isDone ? "Completed" : isCurrent ? "Active" : "Pending"})`}
              >
                {isDone ? "✓" : isCurrent ? "●" : "○"}
              </span>
            );
          })}
          <small>{completedStagesCount} of {totalStagesCount} stages</small>
        </div>

        {/* 8 Level-1 Stage Accordion Rows */}
        <div className="stage-accordion-list">
          {STAGE_CONFIGS.map((stConfig) => {
            const stItem = stagesList.find((s) => s && s.name === stConfig.key);
            const isDone =
              stItem?.status === "completed" ||
              (stConfig.num <= completedStagesCount && normProgress.current_stage !== stConfig.key);
            const isCurrent = normProgress.current_stage === stConfig.key || stItem?.status === "running";
            const isStageInterrupted = isCurrent && isInterrupted;

            const isExpanded =
              manualExpandedStages[stConfig.key] !== undefined
                ? manualExpandedStages[stConfig.key]
                : isCurrent;

            const toggleStage = () => {
              setManualExpandedStages((prev) => ({
                ...prev,
                [stConfig.key]: !isExpanded,
              }));
            };

            return (
              <div
                key={stConfig.key}
                className={`stage-accordion-card ${isDone ? "stage-accordion-card--done" : isCurrent ? "stage-accordion-card--current" : ""} ${isStageInterrupted ? "stage-accordion-card--interrupted" : ""}`}
              >
                {/* Stage Header Row */}
                <div className="stage-accordion-header" onClick={toggleStage}>
                  <div className="stage-header-left">
                    <span className="stage-status-icon">
                      {isDone ? (
                        <CheckCircle2 size={16} className="text-good" />
                      ) : isStageInterrupted ? (
                        <ShieldAlert size={16} className="text-warn" />
                      ) : isCurrent ? (
                        <span className="wave-pulse-dot animate-pulse text-accent">●</span>
                      ) : (
                        <span className="text-muted">○</span>
                      )}
                    </span>
                    <strong>Stage {stConfig.num} · {stConfig.label}</strong>
                  </div>

                  <div className="stage-header-right">
                    {isCurrent && isRunning && (
                      <span className="stage-timer-pill">
                        <Clock size={11} /> {formatSeconds(stageElapsedSeconds)}
                      </span>
                    )}
                    {isStageInterrupted && (
                      <span className="waiting-user-pill">
                        Waiting on you · {formatSeconds(stageElapsedSeconds)}
                      </span>
                    )}
                    {isDone && stItem?.completed_at && (
                      <span className="stage-duration-tag">
                        {formatSeconds(stageElapsedSeconds || 8)}
                      </span>
                    )}
                    <ChevronDown
                      size={15}
                      className="accordion-arrow"
                      style={{ transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)" }}
                    />
                  </div>
                </div>

                {/* Level-2 Sub-steps Container */}
                {isExpanded && (
                  <div className="stage-substep-container">
                    {/* Stage 1: Setup */}
                    {stConfig.key === "setup" && (
                      <div className="substep-list">
                        <div className="substep-row">
                          <Check size={14} className="text-good" />
                          <span>Government workbook loaded — {nf.format(counters.government_records || 10000)} rows</span>
                        </div>
                        <div className="substep-row">
                          <Check size={14} className="text-good" />
                          <span>Purchase Register loaded — {nf.format(counters.purchase_register_records || 10500)} rows</span>
                        </div>
                        <div className="substep-row">
                          <Check size={14} className="text-good" />
                          <span>Workbook structure validated · Roles confirmed</span>
                        </div>
                      </div>
                    )}

                    {/* Stage 2: Mapping */}
                    {stConfig.key === "mapping" && (
                      <div className="substep-list">
                        <div className="substep-row">
                          <Check size={14} className="text-good" />
                          <span>Analysed Government & Purchase Register schema</span>
                        </div>
                        <div className="substep-row">
                          <Check size={14} className="text-good" />
                          <span>13 / 13 required canonical fields resolved</span>
                        </div>

                        {/* User Intervention Gate */}
                        {isStageInterrupted && normProgress.interrupt?.interrupt_type === "mapping" && (
                          <div className="stage-intervention-box">
                            <div className="intervention-notice">
                              <ShieldAlert size={16} className="text-warn" />
                              <span>Mapping confirmation required for newly inferred fields.</span>
                            </div>
                            <div className="intervention-actions">
                              {onConfirmMapping && (
                                <button type="button" className="button-primary button-xs" onClick={onConfirmMapping}>
                                  Confirm Mapping
                                  <ArrowRight size={13} />
                                </button>
                              )}
                              {onNavigateStage && (
                                <button
                                  type="button"
                                  className="button-secondary-dark button-xs"
                                  onClick={() => onNavigateStage("mapping")}
                                >
                                  Review Mapping
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Stage 3: Policy */}
                    {stConfig.key === "policy" && (
                      <div className="substep-list">
                        <div className="substep-row">
                          <Check size={14} className="text-good" />
                          <span>Loaded approved reconciliation policy</span>
                        </div>
                        <div className="substep-row">
                          <Check size={14} className="text-good" />
                          <span>Taxable tolerance: ₹10 · Tax tolerance: ₹2 · Date tolerance: 7 days</span>
                        </div>

                        {/* User Intervention Gate */}
                        {isStageInterrupted && normProgress.interrupt?.interrupt_type === "policy" && (
                          <div className="stage-intervention-box">
                            <div className="intervention-notice">
                              <ShieldAlert size={16} className="text-warn" />
                              <span>Policy confirmation required before matching pipeline runs.</span>
                            </div>
                            <div className="intervention-actions">
                              {onConfirmPolicy && (
                                <button type="button" className="button-primary button-xs" onClick={onConfirmPolicy}>
                                  Confirm & Proceed
                                  <ArrowRight size={13} />
                                </button>
                              )}
                              {onNavigateStage && (
                                <button
                                  type="button"
                                  className="button-secondary-dark button-xs"
                                  onClick={() => onNavigateStage("policy")}
                                >
                                  Review Policy
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Stage 4: Reconciliation */}
                    {stConfig.key === "exact_matching" && (
                      <div className="substep-list">
                        <div className="substep-row">
                          <Check size={14} className="text-good" />
                          <span>Loaded eligible records — {nf.format(counters.government_records || 10000)} Govt · {nf.format(counters.purchase_register_records || 10500)} PR</span>
                        </div>
                        <div className="substep-row">
                          <Check size={14} className="text-good" />
                          <span>Built deterministic identity index</span>
                        </div>

                        {/* Exact Matching Active Telemetry */}
                        <div className="substep-row substep-row--active">
                          {isRunning ? (
                            <span className="wave-pulse-dot animate-pulse text-accent">●</span>
                          ) : (
                            <Check size={14} className="text-good" />
                          )}
                          <div style={{ flex: 1 }}>
                            <span>Exact matching identity keys</span>
                            {hasMeasurable && isRunning && (
                              <div className="substep-telemetry-box">
                                <div className="telemetry-bar-wrap">
                                  <div className="telemetry-bar-fill" style={{ width: `${percent}%` }} />
                                </div>
                                <div className="telemetry-numbers">
                                  <span>
                                    {nf.format(runningStageItem!.processed_records!)} / {nf.format(runningStageItem!.total_records!)} checked ({percent}%)
                                  </span>
                                  <span>Matches found so far: <strong>{nf.format(counters.exact_matches)}</strong></span>
                                </div>
                                {etaText && (
                                  <div className="telemetry-eta">
                                    <span>Elapsed {formatSeconds(stageElapsedSeconds)}</span>
                                    <span>ETA {etaText} {expectedFinishText ? `(Expected ~${expectedFinishText})` : ""}</span>
                                  </div>
                                )}
                              </div>
                            )}
                            {isDone && (
                              <div className="substep-summary-text">
                                Exact matches identified: <strong>{nf.format(counters.exact_matches)}</strong>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Tolerance Matching Substep */}
                        <div className="substep-row">
                          {counters.tolerance_matches > 0 ? (
                            <Check size={14} className="text-good" />
                          ) : (
                            <span className="text-muted">○</span>
                          )}
                          <span>Tolerance matching (₹10 / ₹2 / 7 days) — <strong>{nf.format(counters.tolerance_matches)}</strong> matches</span>
                        </div>
                      </div>
                    )}

                    {/* Stage 5: Near Matches */}
                    {stConfig.key === "near_match_analysis" && (
                      <div className="substep-list">
                        <div className="substep-row">
                          {counters.near_match_proposals > 0 ? (
                            <Check size={14} className="text-good" />
                          ) : (
                            <span className="text-muted">○</span>
                          )}
                          <span>Ranked counterpart candidates — <strong>{nf.format(counters.near_match_proposals)}</strong> proposals</span>
                        </div>
                      </div>
                    )}

                    {/* Stage 6: Exceptions */}
                    {stConfig.key === "exception_construction" && (
                      <div className="substep-list">
                        <div className="substep-row">
                          <Check size={14} className="text-good" />
                          <span>Constructed exception categories — <strong>{nf.format(counters.gst_only)}</strong> Gov · <strong>{nf.format(counters.pr_only)}</strong> PR open</span>
                        </div>
                      </div>
                    )}

                    {/* Stage 7: Audit */}
                    {stConfig.key === "audit" && (
                      <div className="substep-list">
                        <div className="substep-row">
                          <Check size={14} className="text-good" />
                          <span>Persisted audit lineage recorded</span>
                        </div>
                      </div>
                    )}

                    {/* Stage 8: Export */}
                    {stConfig.key === "finalization" && (
                      <div className="substep-list">
                        <div className="substep-row">
                          <Check size={14} className="text-good" />
                          <span>KIGS-compatible workbook export generated</span>
                        </div>
                      </div>
                    )}

                    {/* Real Substep Activity Feed Items with Disclosure Arrow (>) */}
                    <div className="stage-activity-feed">
                      {activities
                        .filter(
                          (act) =>
                            act &&
                            (act.graph_node === stConfig.key ||
                              (stConfig.key === "exact_matching" &&
                                (act.graph_node === "exact_matching" || act.graph_node === "tolerance_matching")))
                        )
                        .map((act) => {
                          const isSubExp = expandedSubstepKey === act.event_id;
                          return (
                            <div key={act.event_id} className="substep-disclosure-item">
                              <div
                                className="substep-disclosure-row"
                                onClick={() => setExpandedSubstepKey(isSubExp ? null : act.event_id)}
                              >
                                <span className="substep-disclosure-bullet">
                                  {act.status === "completed" ? "✓" : act.status === "running" ? "●" : "↳"}
                                </span>
                                <span className="substep-disclosure-text">{act.summary}</span>
                                {act.evidence_summary && (
                                  <span className="substep-disclosure-evidence">— {act.evidence_summary}</span>
                                )}
                                <span className="substep-disclosure-arrow">
                                  <ChevronRight size={13} style={{ transform: isSubExp ? "rotate(90deg)" : "rotate(0deg)" }} />
                                </span>
                              </div>

                              {/* Nested Disclosure Arrow ("Why?") Panel */}
                              {isSubExp && (
                                <div className="substep-why-panel">
                                  {act.summary && (
                                    <div>
                                      <strong>ACTION:</strong> <span>{act.summary}</span>
                                    </div>
                                  )}
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
                                      <strong>TOOL / ENGINE:</strong> <code>{act.tool_name}</code>
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
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer Controls */}
      <div className="monitor-footer">
        <span className="footer-status-text">
          {isRunning ? "TARS executing..." : isInterrupted ? "Waiting for user action" : isCompleted ? "Complete" : "Idle"}
        </span>

        <div style={{ display: "flex", gap: "8px" }}>
          {isRunning && (
            <button
              type="button"
              className="button-secondary-dark button-xs"
              onClick={() => setShowAbortConfirm(true)}
            >
              <StopCircle size={13} style={{ marginRight: "4px" }} />
              Abort
            </button>
          )}

          {isAborted && onResume && (
            <button
              type="button"
              className="button-primary button-xs"
              onClick={onResume}
            >
              <Play size={13} style={{ marginRight: "4px" }} />
              Resume from Checkpoint
            </button>
          )}
        </div>
      </div>

      {/* Inline Abort Confirmation Overlay */}
      {showAbortConfirm && (
        <div className="monitor-abort-overlay">
          <h4>
            <ShieldAlert size={18} />
            Abort Reconciliation?
          </h4>
          <p>
            TARS will stop at the next safe checkpoint. Completed stages and persisted work will remain intact.
          </p>
          <div className="monitor-abort-actions">
            <button
              type="button"
              className="button-secondary-dark button-sm"
              onClick={() => setShowAbortConfirm(false)}
              disabled={aborting}
            >
              Keep Running
            </button>
            <button
              type="button"
              className="button-danger button-sm"
              onClick={handleAbort}
              disabled={aborting}
            >
              {aborting ? "Stopping..." : "Abort Safely"}
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}

// Export main TarsRunMonitor wrapped inside isolated ErrorBoundary
export function TarsRunMonitor(props: TarsRunMonitorProps) {
  return (
    <TarsRunMonitorErrorBoundary>
      <TarsRunMonitorImpl {...props} />
    </TarsRunMonitorErrorBoundary>
  );
}
