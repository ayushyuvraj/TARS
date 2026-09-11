import { ChangeEvent, ReactNode, useEffect, useRef, useState } from "react";
import {
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  BookOpenCheck,
  Building2,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  ClipboardCheck,
  FileSearch,
  FileSpreadsheet,
  History,
  LayoutDashboard,
  Menu,
  MessageSquareText,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Plus,
  Scale,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Terminal,
  X,
  Zap,
} from "lucide-react";
import {
  api,
  ApiError,
  AuditEvent,
  CanonicalFieldDefinition,
  DatasetMappingProposal,
  DatasetProfile,
  DatasetRole,
  ExportRecord,
  NearMatchAnalysis,
  NearMatchSummary,
  PolicyProposal,
  ReconciliationListItem,
  ReconciliationResults,
  ReconciliationSummary,
  ResultItem,
  ResultStatus,
  SchemaMappingProposal,
  ToleranceSummary,
} from "./api";
import { MappingEditor } from "./MappingEditor";
import { PolicyBuilder, PolicyPreview } from "./PolicyBuilder";
import { NearMatchWorkspace } from "./NearMatchWorkspace";
import { ExceptionWorkspace } from "./ExceptionWorkspace";
import { CopilotDisplayMode, CopilotPanel } from "./CopilotPanel";
import { copilotV2Bridge, V2WorkspaceContext } from "./copilot_v2_bridge";
import "./copilot_agentic.css";
import { GovernanceWorkspace } from "./GovernanceWorkspace";
import { AuditTimeline } from "./AuditTimeline";
import { FinalReviewWorkspace } from "./FinalReviewWorkspace";
import { QuickReconcile } from "./QuickReconcile";
import { RulesWiki } from "./RulesWiki";
import { RulesWikiV2 } from "./RulesWikiV2";
import { AgenticDashboard } from "./AgenticDashboard";
import { ReconciliationV2Workspace } from "./ReconciliationV2Workspace";
import { Audit2Workspace } from "./Audit2Workspace";

type BusyState =
  | "idle"
  | "restoring"
  | "creating"
  | "uploading"
  | "analyzing"
  | "saving"
  | "confirming"
  | "policy"
  | "matching"
  | "near";
type StageKey =
  | "setup"
  | "mapping"
  | "policy"
  | "results"
  | "near-matches"
  | "exceptions"
  | "audit"
  | "final-review";
const nf = new Intl.NumberFormat("en-IN");
const money = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});
const SESSION_KEY = "gst-reconciliation-session";
const SIDEBAR_KEY = "tars-sidebar-collapsed";
const stages: { key: StageKey; label: string }[] = [
  { key: "setup", label: "Setup" },
  { key: "mapping", label: "Mapping" },
  { key: "policy", label: "Policy" },
  { key: "results", label: "Results" },
  { key: "near-matches", label: "Near matches" },
  { key: "exceptions", label: "Exceptions" },
  { key: "audit", label: "Audit" },
  { key: "final-review", label: "Export" },
];

function FileField({
  id,
  label,
  hint,
  file,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  hint: string;
  file: File | null;
  onChange: (f: File | null) => void;
  disabled: boolean;
}) {
  const change = (e: ChangeEvent<HTMLInputElement>) =>
    onChange(e.target.files?.[0] ?? null);
  return (
    <label
      className={`upload-zone${file ? " upload-zone--ready" : ""}`}
      htmlFor={id}
    >
      <input
        id={id}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        onChange={change}
        disabled={disabled}
      />
      <span className="upload-zone__icon">
        <FileSpreadsheet size={22} />
      </span>
      <strong>{label}</strong>
      <span>{file?.name ?? hint}</span>
      <small>{file ? "Workbook ready" : "XLSX · up to 25 MB"}</small>
    </label>
  );
}
function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "good" | "warn";
}) {
  return (
    <article className={`metric-tile${tone ? ` metric-tile--${tone}` : ""}`}>
      <span>{label}</span>
      <strong>{nf.format(value)}</strong>
    </article>
  );
}
function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions && <div className="page-heading__actions">{actions}</div>}
    </header>
  );
}
function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span>{icon}</span>
      <h2>{title}</h2>
      <p>{body}</p>
      {action}
    </div>
  );
}

function ToleranceDetail({
  item,
  onClose,
}: {
  item: ResultItem;
  onClose: () => void;
}) {
  const m = item.match!;
  return (
    <div className="sheet-backdrop" onMouseDown={onClose}>
      <aside
        className="evidence-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="match-detail-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header>
          <div>
            <span className="eyebrow">Tolerance evidence</span>
            <h2 id="match-detail-title">Record comparison</h2>
            <p>
              {m.government_record_id} ↔ {m.purchase_register_record_id}
            </p>
          </div>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Close evidence"
          >
            <X size={19} />
          </button>
        </header>
        <div className="record-pair">
          <div>
            <span>Government record</span>
            {Object.entries(m.government_values).map(([k, v]) => (
              <p key={k}>
                <small>{k.replaceAll("_", " ")}</small>
                <strong>{String(v ?? "—")}</strong>
              </p>
            ))}
          </div>
          <div>
            <span>Purchase Register</span>
            {Object.entries(m.purchase_register_values).map(([k, v]) => (
              <p key={k}>
                <small>{k.replaceAll("_", " ")}</small>
                <strong>{String(v ?? "—")}</strong>
              </p>
            ))}
          </div>
        </div>
        <dl className="evidence-list">
          {Object.entries(m.variances).map(([k, v]) => (
            <div key={k}>
              <dt>{k.replaceAll("_", " ")}</dt>
              <dd>
                {k.includes("date") ? `${v} days` : money.format(v)}{" "}
                <small>allowed {m.allowed_tolerances[k] ?? 0}</small>
              </dd>
            </div>
          ))}
        </dl>
        <div className="match-verdict">
          <Check size={18} />
          <div>
            <strong>Tolerance matched</strong>
            <small>
              Policy revision {m.policy_revision} mechanically satisfied
            </small>
          </div>
        </div>
      </aside>
    </div>
  );
}
function Progress({
  id,
  current,
  complete,
  finalState,
}: {
  id: string;
  current: StageKey;
  complete: number;
  finalState: "none" | "current" | "stale";
}) {
  return (
    <nav className="progress-rail" aria-label="Reconciliation progress">
      <div className="progress-rail__label">
        <span>Reconciliation</span>
        <code>{id.slice(0, 8)}</code>
      </div>
      <ol>
        {stages.map((s, i) => {
          const open =
            i <= complete + 1 ||
            s.key === "audit" ||
            (s.key === "final-review" && complete >= 5);
          const state =
            current === s.key
              ? "current"
              : s.key === "final-review" && finalState === "stale"
                ? "stale"
              : i <= complete
                ? "complete"
                : open
                  ? "available"
                  : "blocked";
          return (
            <li key={s.key} data-state={state}>
              {open ? (
                <NavLink
                  to={`/reconciliations/${id}/${s.key}`}
                  aria-current={current === s.key ? "step" : undefined}
                >
                  <span>
                    {state === "complete" ? <Check size={13} /> : i + 1}
                  </span>
                  <b>{s.label}</b>
                </NavLink>
              ) : (
                <span className="progress-locked">
                  <span>{i + 1}</span>
                  <b>{s.label}</b>
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export default function App() {
  const nav = useNavigate(),
    loc = useLocation();
  const routeId =
    loc.pathname.match(/^\/reconciliations\/([^/]+)/)?.[1] ?? null;
  const [governmentFile, setGovernmentFile] = useState<File | null>(null),
    [purchaseFile, setPurchaseFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<BusyState>("idle"),
    [sessionId, setSessionId] = useState<string | null>(
      routeId === "new" ? null : routeId,
    );
  const [profileId, setProfileId] = useState<string | null>(null),
    [profileNotice, setProfileNotice] = useState<string | null>(null),
    [profiles, setProfiles] = useState<
      Partial<Record<DatasetRole, DatasetProfile>>
    >({});
  const [proposal, setProposal] = useState<SchemaMappingProposal | null>(null),
    [canonicalFields, setCanonicalFields] = useState<
      CanonicalFieldDefinition[]
    >([]);
  const [mappingConfirmed, setMappingConfirmed] = useState(false),
    [policyProposal, setPolicyProposal] = useState<PolicyProposal | null>(null),
    [policyConfirmed, setPolicyConfirmed] = useState(false);
  const [instruction, setInstruction] = useState(
    "GSTIN and invoice number must match exactly. Allow ₹10 variance in taxable value and 5 days in invoice date.",
  );
  const [, setExactSummary] = useState<ReconciliationSummary | null>(null),
    [summary, setSummary] = useState<ToleranceSummary | null>(null);
  const [results, setResults] = useState<ReconciliationResults | null>(null),
    [filter, setFilter] = useState<ResultStatus>("TOLERANCE_MATCHED"),
    [selected, setSelected] = useState<ResultItem | null>(null);
  const [nearAnalysis, setNearAnalysis] = useState<NearMatchAnalysis | null>(
      null,
    ),
    [nearSummary, setNearSummary] = useState<NearMatchSummary | null>(null);
  const [selectedException, setSelectedException] = useState<string | null>(
      null,
    ),
    [showDetailedResults, setShowDetailedResults] = useState(false),
    [page, setPage] = useState(0),
    [events, setEvents] = useState<AuditEvent[]>([]);
  const [error, setError] = useState<string | null>(null),
    [navOpen, setNavOpen] = useState(false),
    [copilotMode, setCopilotMode] = useState<CopilotDisplayMode>(() => {
      const saved = localStorage.getItem("tars_copilot_mode_v2");
      if (saved === "floating" || saved === "fullscreen") return saved as CopilotDisplayMode;
      return "closed";
    });
  const copilotOpen = copilotMode !== "closed";
  const setCopilotOpen = (open: boolean) => setCopilotMode(open ? "floating" : "closed");
  const [v2BridgeContext, setV2BridgeContext] = useState<V2WorkspaceContext | null>(() =>
    copilotV2Bridge.getContext()
  );

  useEffect(() => {
    return copilotV2Bridge.subscribe((ctx) => {
      setV2BridgeContext(ctx);
    });
  }, []);

  useEffect(() => {
    localStorage.setItem("tars_copilot_mode_v2", copilotMode);
  }, [copilotMode]);

  useEffect(() => {
    const handleGlobalKeys = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K" || e.key === "/")) {
        e.preventDefault();
        setCopilotMode((prev) => (prev === "closed" ? "floating" : "closed"));
      } else if (e.key === "Escape") {
        setCopilotMode((prev) => {
          if (prev === "fullscreen") return "floating";
          if (prev === "floating") return "closed";
          return prev;
        });
      }
    };
    window.addEventListener("keydown", handleGlobalKeys);
    return () => window.removeEventListener("keydown", handleGlobalKeys);
  }, []);
  const [exportHistory, setExportHistory] = useState<ExportRecord[]>([]);
  const [reconciliations, setReconciliations] = useState<ReconciliationListItem[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem(SIDEBAR_KEY) === "true",
  );
  const mappingErrorRef = useRef<HTMLDivElement>(null),
    policyErrorRef = useRef<HTMLDivElement>(null),
    copilotTriggerRef = useRef<HTMLButtonElement>(null),
    copilotDialogRef = useRef<HTMLDivElement>(null),
    isBusy = busy !== "idle";
  const loadEvents = async (id: string) => setEvents(await api.auditEvents(id));
  const loadReconciliations = async () =>
    setReconciliations(await api.listReconciliations());
  const loadResults = async (id: string, status: ResultStatus) => {
    const r = await api.results(id, status);
    setResults(r);
    setSummary(r.summary);
    setSelected(null);
  };
  const focusErrors = (k: "mapping" | "policy") =>
    requestAnimationFrame(() =>
      (k === "mapping" ? mappingErrorRef : policyErrorRef).current?.focus(),
    );
  const remember = (id: string) => {
    localStorage.setItem(SESSION_KEY, id);
    setSessionId(id);
  };
  const resetWorkspace = () => {
    setSessionId(null);
    setProfileId(null);
    setProfileNotice(null);
    setGovernmentFile(null);
    setPurchaseFile(null);
    setProfiles({});
    setProposal(null);
    setMappingConfirmed(false);
    setPolicyProposal(null);
    setPolicyConfirmed(false);
    setSummary(null);
    setNearAnalysis(null);
    setNearSummary(null);
    setResults(null);
    setEvents([]);
    setExportHistory([]);
    setError(null);
    setCopilotOpen(false);
  };
  const hydrate = async (id: string, lightweight = false) => {
    const s = await api.getSession(id, !lightweight);
    setSessionId(id);
    setProfileId(s.client_profile_id);
    setProfiles({
      ...(s.government_file ? { government: s.government_file.profile } : {}),
      ...(s.purchase_register_file
        ? { purchase_register: s.purchase_register_file.profile }
        : {}),
    });
    setProposal(s.mapping_proposal);
    setMappingConfirmed(Boolean(s.confirmed_mapping));
    setPolicyProposal(s.policy_proposal);
    setPolicyConfirmed(Boolean(s.confirmed_policy));
    setExactSummary(s.summary);
    setSummary(s.tolerance_summary);
    setNearAnalysis(s.near_match_analysis);
    setNearSummary(s.near_match_summary);
    if (s.tolerance_summary && !lightweight) {
      const f: ResultStatus = s.near_match_summary
        ? "NEAR_MATCHED"
        : "TOLERANCE_MATCHED";
      setFilter(f);
      await loadResults(id, f);
    }
    const supporting = Promise.all([
      api.auditEvents(id),
      api.exports(id),
    ]);
    if (lightweight) {
      void supporting.then(([nextEvents, nextExports]) => {
        setEvents(nextEvents);
        setExportHistory(nextExports);
      }).catch(() => undefined);
      return;
    }
    const [nextEvents, nextExports] = await supporting;
    setEvents(nextEvents);
    setExportHistory(nextExports);
  };
  useEffect(() => {
    localStorage.setItem(SIDEBAR_KEY, String(sidebarCollapsed));
  }, [sidebarCollapsed]);
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [fields] = await Promise.all([
          api.canonicalFields(),
          loadReconciliations(),
        ]);
        if (!active) return;
        setCanonicalFields(fields);
        const q = new URLSearchParams(loc.search).get("reconciliation");
        const targetId = routeId && routeId !== "new" ? routeId : q;
        if (targetId) {
          setBusy("restoring");
          await hydrate(targetId, loc.pathname.endsWith("/exceptions"));
          remember(targetId);
          if (q && loc.pathname === "/")
            nav(`/reconciliations/${targetId}/final-review`, { replace: true });
        }
      } catch (r) {
        if (active)
          setError(
            r instanceof Error
              ? `Saved session could not be restored: ${r.message}`
              : "Saved session could not be restored.",
          );
      } finally {
        setBusy("idle");
      }
    })();
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (routeId === "new") {
      resetWorkspace();
      setBusy("idle");
    } else if (routeId && routeId !== sessionId) {
      setBusy("restoring");
      hydrate(routeId, loc.pathname.endsWith("/exceptions"))
        .then(() => remember(routeId))
        .catch((r) =>
          setError(
            r instanceof Error ? r.message : "Could not load reconciliation.",
          ),
        )
        .finally(() => setBusy("idle"));
    } else if (!routeId) {
      setBusy("idle");
    }
    if (loc.pathname === "/reconciliations") {
      void loadReconciliations().catch((r) =>
        setError(r instanceof Error ? r.message : "Could not load reconciliations."),
      );
    }
    if (loc.pathname === "/audit") {
      void api.auditEvents(sessionId ?? undefined)
        .then(setEvents)
        .catch(() => setEvents([]));
    }
    setNavOpen(false);
  }, [routeId, loc.pathname]);
  useEffect(() => {
    requestAnimationFrame(() => {
      const heading = document.querySelector<HTMLElement>("#workspace h1");
      heading?.setAttribute("tabindex", "-1");
      heading?.focus();
    });
    const label = stages.find((item) => item.key === loc.pathname.split("/").pop())?.label;
    document.title = `${label ?? (loc.pathname === "/dashboard" ? "Dashboard" : loc.pathname === "/overview" ? "Overview" : loc.pathname === "/rules" ? "Rules Wiki" : "GST reconciliation")} · TARS`;
  }, [loc.pathname]);
  useEffect(() => {
    if (copilotMode === "pill") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (copilotMode === "fullscreen") {
          setCopilotMode("parallel");
        } else {
          setCopilotMode("pill");
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [copilotMode]);
  const go = (stage: StageKey, id = sessionId) =>
    id && nav(`/reconciliations/${id}/${stage}`);
  const startAnalysis = async () => {
    if (!governmentFile || !purchaseFile) return;
    let id = sessionId && !proposal ? sessionId : null;
    setError(null);
    setProfileNotice(null);
    try {
      if (!id) {
        setBusy("creating");
        const c = await api.create();
        id = c.id;
        remember(id);
        setProfileId(c.client_profile_id);
      }
      setBusy("uploading");
      const [g, p] = await Promise.all([
        api.upload(id, "government", governmentFile),
        api.upload(id, "purchase-register", purchaseFile),
      ]);
      setProfiles({ government: g.profile, purchase_register: p.profile });
      setBusy("analyzing");
      if (profileId) {
        const compatibility = await api.profileCompatibility(
          profileId,
          id,
          true,
        );
        if (compatibility.status === "PROFILE_COMPATIBLE") {
          const restored = await api.getSession(id);
          setProposal(restored.mapping_proposal);
          setMappingConfirmed(true);
          setPolicyProposal(restored.policy_proposal);
          setPolicyConfirmed(true);
          setProfileNotice(
            "Saved mapping and policy applied after an exact schema compatibility check.",
          );
        } else {
          setProposal(await api.analyzeMapping(id));
          setMappingConfirmed(false);
          setPolicyConfirmed(false);
          setProfileNotice(
            `Profile compatibility is ${compatibility.status.replace("PROFILE_", "").toLowerCase()}. Review and reconfirm the mapping before reuse.`,
          );
        }
      } else {
        setProposal(await api.analyzeMapping(id));
        setMappingConfirmed(false);
      }
      await loadEvents(id);
      go("mapping", id);
    } catch (r) {
      if (
        r instanceof ApiError &&
        r.code === "schema_provider_unavailable" &&
        id
      )
        setProposal(await api.getMapping(id));
      setError(r instanceof Error ? r.message : "Schema analysis failed.");
    } finally {
      setBusy("idle");
    }
  };
  const saveMapping = async () => {
    if (!sessionId || !proposal) return;
    setBusy("saving");
    try {
      const s = await api.updateMapping(sessionId, proposal.datasets);
      setProposal(s);
      if (!s.validation.valid) focusErrors("mapping");
      await loadEvents(sessionId);
    } catch (r) {
      setError(r instanceof Error ? r.message : "Mapping could not be saved.");
    } finally {
      setBusy("idle");
    }
  };
  const confirmMapping = async () => {
    if (!sessionId || !proposal) return;
    setBusy("confirming");
    try {
      const s = await api.updateMapping(sessionId, proposal.datasets);
      setProposal(s);
      if (!s.validation.valid) return focusErrors("mapping");
      await api.confirmMapping(sessionId);
      setMappingConfirmed(true);
      if (profileId) {
        await api.profileCompatibility(profileId, sessionId, true);
        const restored = await api.getSession(sessionId);
        setPolicyProposal(restored.policy_proposal);
        setPolicyConfirmed(Boolean(restored.confirmed_policy));
        setProfileNotice(
          "Remapped schema confirmed; the compatible saved profile policy is now available.",
        );
      }
      await loadEvents(sessionId);
      go("policy");
    } catch (r) {
      if (r instanceof ApiError && r.validation)
        setProposal({ ...proposal, validation: r.validation });
      setError(
        r instanceof Error ? r.message : "Mapping could not be confirmed.",
      );
    } finally {
      setBusy("idle");
    }
  };
  const generatePolicy = async () => {
    if (!sessionId) return;
    setBusy("policy");
    setError(null);
    try {
      const p = await api.proposePolicy(
        sessionId,
        instruction.trim() || undefined,
      );
      setPolicyProposal(p);
      setPolicyConfirmed(false);
      if (!p.validation.valid) focusErrors("policy");
      await loadEvents(sessionId);
    } catch (r) {
      setError(r instanceof Error ? r.message : "Policy generation failed.");
    } finally {
      setBusy("idle");
    }
  };
  const savePolicy = async () => {
    if (!sessionId || !policyProposal) return;
    setBusy("saving");
    try {
      const p = await api.updatePolicy(sessionId, policyProposal.policy);
      setPolicyProposal(p);
      if (!p.validation.valid) focusErrors("policy");
      await loadEvents(sessionId);
    } catch (r) {
      setError(r instanceof Error ? r.message : "Policy could not be saved.");
    } finally {
      setBusy("idle");
    }
  };
  const confirmPolicy = async () => {
    if (!sessionId || !policyProposal) return;
    setBusy("confirming");
    try {
      const p = await api.updatePolicy(sessionId, policyProposal.policy);
      setPolicyProposal(p);
      if (!p.validation.valid) return focusErrors("policy");
      setPolicyProposal({ ...p, policy: await api.confirmPolicy(sessionId) });
      setPolicyConfirmed(true);
      await loadEvents(sessionId);
      go("results");
    } catch (r) {
      if (r instanceof ApiError && r.policyValidation)
        setPolicyProposal({
          ...policyProposal,
          validation: r.policyValidation,
        });
      setError(
        r instanceof Error ? r.message : "Policy could not be confirmed.",
      );
    } finally {
      setBusy("idle");
    }
  };
  const runRecon = async () => {
    if (!sessionId) return;
    setBusy("matching");
    setError(null);
    try {
      setExactSummary(await api.runExact(sessionId));
      const s = await api.runTolerance(sessionId);
      setSummary(s);
      await loadResults(sessionId, "TOLERANCE_MATCHED");
      await loadEvents(sessionId);
    } catch (r) {
      setError(r instanceof Error ? r.message : "Reconciliation failed.");
    } finally {
      setBusy("idle");
    }
  };
  const analyzeNear = async () => {
    if (!sessionId) return;
    setBusy("near");
    try {
      setNearAnalysis(await api.analyzeNearMatches(sessionId));
      const s = await api.getSession(sessionId);
      setNearSummary(s.near_match_summary);
      await loadEvents(sessionId);
    } catch (r) {
      setError(r instanceof Error ? r.message : "Near-match analysis failed.");
    } finally {
      setBusy("idle");
    }
  };
  const decideNear = async (id: string, action: "approve" | "reject") => {
    if (!sessionId) return;
    setBusy("near");
    try {
      setNearSummary(await api.decideNearMatch(sessionId, id, action));
      setNearAnalysis((currentAnalysis) => currentAnalysis ? {
        ...currentAnalysis,
        candidates: currentAnalysis.candidates.map((candidate) =>
          candidate.id === id
            ? {
                ...candidate,
                status: action === "approve" ? "NEAR_MATCH_APPROVED" : "REJECTED_CANDIDATE",
                eligible_for_bulk_approval: false,
              }
            : candidate,
        ),
      } : currentAnalysis);
      await loadEvents(sessionId);
    } finally {
      setBusy("idle");
    }
  };
  const bulkNear = async () => {
    if (!sessionId) throw new Error("No reconciliation is open.");
    setBusy("near");
    setError(null);
    try {
      const result = await api.bulkApproveNearMatches(sessionId);
      setNearSummary(result.summary);
      const skipped = new Set(result.skip_reasons.map((item) => item.candidate_id));
      setNearAnalysis((currentAnalysis) => currentAnalysis ? {
        ...currentAnalysis,
        candidates: currentAnalysis.candidates.map((candidate) =>
          candidate.status === "NEAR_MATCH_PROPOSED" && !skipped.has(candidate.id)
            ? { ...candidate, status: "NEAR_MATCH_APPROVED", eligible_for_bulk_approval: false }
            : candidate,
        ),
      } : currentAnalysis);
      await loadEvents(sessionId);
      return result;
    } catch (r) {
      setError(r instanceof Error ? r.message : "Bulk approval failed. No batch changes were committed.");
      throw r;
    } finally {
      setBusy("idle");
    }
  };
  const changeFilter = async (f: ResultStatus) => {
    setFilter(f);
    setPage(0);
    if (sessionId && summary) {
      setBusy("restoring");
      try {
        await loadResults(sessionId, f);
      } finally {
        setBusy("idle");
      }
    }
  };
  const startNew = () => {
    resetWorkspace();
    nav("/reconciliations/new/setup");
  };
  const hasCurrentExport = exportHistory.some((item) => !item.stale),
    hasStaleExport = !hasCurrentExport && exportHistory.some((item) => item.stale),
    canExceptions = Boolean(nearSummary?.near_match_proposals === 0);
  const complete =
    canExceptions
      ? hasCurrentExport
        ? 7
        : 5
      : nearAnalysis
        ? 4
        : summary
          ? 3
          : policyConfirmed
            ? 2
            : mappingConfirmed
              ? 1
              : proposal
                ? 0
                : -1;
  const current = (loc.pathname.split("/").pop() as StageKey) || "setup";
  const nextStage: StageKey = hasCurrentExport
    ? "final-review"
    : canExceptions
      ? "exceptions"
      : summary
        ? "near-matches"
        : proposal
          ? "mapping"
          : "setup";
  const booting =
    busy === "restoring" && !proposal && Boolean(routeId && routeId !== "new");

  const setup = (
    <>
      <PageHeader
        eyebrow="New reconciliation"
        title="Bring the two ledgers together"
        description="Upload the government GST extract and purchase register. We profile both locally before proposing any mapping."
      />
      <section className="surface upload-surface">
        <div className="upload-grid">
          <FileField
            id="government-file"
            label="Government GST / GSTR-2B"
            hint="Choose the government-issued workbook"
            file={governmentFile}
            onChange={setGovernmentFile}
            disabled={isBusy}
          />
          <div className="upload-connector">
            <Scale size={18} />
          </div>
          <FileField
            id="purchase-file"
            label="Purchase Register / ERP"
            hint="Choose the client accounting workbook"
            file={purchaseFile}
            onChange={setPurchaseFile}
            disabled={isBusy}
          />
        </div>
        {error && (
          <div className="inline-alert" role="alert">
            <CircleAlert size={17} />
            {error}
          </div>
        )}
        <footer className="surface-actions">
          <p>
            {isBusy
              ? `Currently ${busy}…`
              : governmentFile && purchaseFile
                ? "Both workbooks are ready for schema analysis."
                : "Your workbooks remain unchanged."}
          </p>
          <button
            onClick={startAnalysis}
            disabled={!governmentFile || !purchaseFile || isBusy}
          >
            {isBusy ? (
              <Activity className="spin" size={17} />
            ) : (
              <Sparkles size={17} />
            )}
            Analyze schemas
          </button>
        </footer>
      </section>
    </>
  );
  const mapping = proposal ? (
    <>
      <PageHeader
        eyebrow="Stage 2 of 8"
        title="Confirm the shared data language"
        description="Review proposed source-to-canonical mappings. Required fields and rationale remain visible."
        actions={
          <button className="button-secondary" onClick={() => go("setup")}>
            <ArrowLeft size={16} />
            Source files
          </button>
        }
      />
      {!proposal.validation.valid && (
        <div
          className="validation-summary"
          role="alert"
          tabIndex={-1}
          ref={mappingErrorRef}
        >
          <h3>Resolve {proposal.validation.issues.length} mapping issues</h3>
          <ul>
            {proposal.validation.issues.map((x, i) => (
              <li key={i}>{x.message}</li>
            ))}
          </ul>
        </div>
      )}
      <MappingEditor
        proposal={proposal}
        profiles={profiles}
        canonicalFields={canonicalFields}
        disabled={isBusy || mappingConfirmed}
        onChange={(datasets: DatasetMappingProposal[]) =>
          setProposal({ ...proposal, datasets })
        }
      />
      <div className="sticky-action">
        <div>
          <strong>
            {mappingConfirmed
              ? "Mapping confirmed"
              : proposal.validation.valid
                ? "Ready for confirmation"
                : "Mapping needs attention"}
          </strong>
          <span>
            {proposal.datasets.reduce(
              (n, d) => n + d.mappings.filter((m) => m.canonical_field).length,
              0,
            )}{" "}
            source fields mapped
          </span>
        </div>
        {mappingConfirmed ? (
          <button onClick={() => go("policy")}>
            Continue to policy
            <ArrowRight size={16} />
          </button>
        ) : (
          <>
            <button
              className="button-secondary"
              onClick={saveMapping}
              disabled={isBusy}
            >
              Save & validate
            </button>
            <button onClick={confirmMapping} disabled={isBusy}>
              Confirm mapping
              <ArrowRight size={16} />
            </button>
          </>
        )}
      </div>
    </>
  ) : (
    <EmptyState
      icon={<FileSearch />}
      title="Analyze source schemas first"
      body="Mapping becomes available after both workbooks are profiled."
      action={<button onClick={() => go("setup")}>Go to setup</button>}
    />
  );
  const policy = mappingConfirmed ? (
    <>
      <PageHeader
        eyebrow="Stage 3 of 8"
        title="Set the boundaries for a match"
        description="Start in plain language, then inspect the exact operators and tolerances the engine will enforce."
      />
      <section className="surface language-builder">
        <div>
          <label htmlFor="policy-instruction">
            Describe the matching policy
          </label>
          <p>The structured policy remains the execution contract.</p>
        </div>
        <textarea
          id="policy-instruction"
          rows={3}
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          disabled={isBusy || policyConfirmed}
        />
        <button onClick={generatePolicy} disabled={isBusy || policyConfirmed}>
          <Sparkles size={17} />
          {policyProposal ? "Regenerate" : "Generate policy"}
        </button>
      </section>
      {policyProposal && (
        <>
          <PolicyPreview policy={policyProposal.policy} />
          {!policyProposal.validation.valid && (
            <div
              className="validation-summary"
              role="alert"
              tabIndex={-1}
              ref={policyErrorRef}
            >
              <h3>
                Resolve {policyProposal.validation.issues.length} policy issues
              </h3>
            </div>
          )}
          <PolicyBuilder
            proposal={policyProposal}
            canonicalFields={canonicalFields}
            disabled={isBusy || policyConfirmed}
            onChange={(p) =>
              setPolicyProposal({ ...policyProposal, policy: p })
            }
          />
          <div className="sticky-action">
            <div>
              <strong>
                {policyConfirmed
                  ? "Policy confirmed"
                  : policyProposal.validation.valid
                    ? "Policy is mechanically valid"
                    : "Policy needs attention"}
              </strong>
              <span>
                Revision {policyProposal.policy.revision} · human confirmation
                required
              </span>
            </div>
            {policyConfirmed ? (
              <button onClick={() => go("results")}>
                Continue to results
                <ArrowRight size={16} />
              </button>
            ) : (
              <>
                <button
                  className="button-secondary"
                  onClick={savePolicy}
                  disabled={isBusy}
                >
                  Save & validate
                </button>
                <button onClick={confirmPolicy} disabled={isBusy}>
                  Confirm policy
                  <Check size={16} />
                </button>
              </>
            )}
          </div>
        </>
      )}
    </>
  ) : (
    <EmptyState
      icon={<SlidersHorizontal />}
      title="Confirm schema mapping first"
      body="A policy can only use canonical fields from the confirmed mapping."
      action={<button onClick={() => go("mapping")}>Review mapping</button>}
    />
  );
  const resultTable = results && (
    <section className="surface table-surface">
      <div className="table-toolbar">
        <div className="segmented" role="group">
          {(
            [
              "EXACT_MATCHED",
              "TOLERANCE_MATCHED",
              ...(nearSummary ? ["NEAR_MATCHED" as ResultStatus] : []),
              "UNRESOLVED",
            ] as ResultStatus[]
          ).map((s) => (
            <button
              key={s}
              className={filter === s ? "active" : ""}
              aria-pressed={filter === s}
              onClick={() => changeFilter(s)}
            >
              {s.replaceAll("_", " ")}
            </button>
          ))}
        </div>
        <span>{nf.format(results.records.length)} records</span>
      </div>
      <div className="results-table-wrap">
        <table className="results-table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Government record</th>
              <th>Purchase record</th>
              <th>Evidence</th>
            </tr>
          </thead>
          <tbody>
            {results.records.slice(page * 50, page * 50 + 50).map((x, i) => (
              <tr key={i}>
                <td>
                  <span
                    className={`result-status result-status--${x.status.toLowerCase()}`}
                  >
                    {x.status.replaceAll("_", " ")}
                  </span>
                </td>
                <td>
                  <code>{x.government_record_id ?? "—"}</code>
                </td>
                <td>
                  <code>{x.purchase_register_record_id ?? "—"}</code>
                </td>
                <td>
                  {x.status === "TOLERANCE_MATCHED" ? (
                    <button
                      className="detail-link"
                      onClick={() => setSelected(x)}
                    >
                      View variances
                      <ChevronRight size={14} />
                    </button>
                  ) : x.status === "EXACT_MATCHED" ? (
                    "All required fields equal"
                  ) : x.status === "NEAR_MATCHED" ? (
                    "Human-approved evidence"
                  ) : (
                    "No confirmed match"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="table-pagination">
        <p>
          Showing {results.records.length ? page * 50 + 1 : 0}–
          {Math.min(page * 50 + 50, results.records.length)} of{" "}
          {nf.format(results.records.length)}
        </p>
        <div>
          <button
            className="button-secondary"
            disabled={page === 0}
            onClick={() => setPage((v) => v - 1)}
          >
            Previous
          </button>
          <button
            className="button-secondary"
            disabled={(page + 1) * 50 >= results.records.length}
            onClick={() => setPage((v) => v + 1)}
          >
            Next
          </button>
        </div>
      </div>
    </section>
  );
  const resultsPage = policyConfirmed ? (
    <>
      <PageHeader
        eyebrow="Stage 4 of 8"
        title={
          summary
            ? "The ledgers are reconciled"
            : "Run deterministic reconciliation"
        }
        description={
          summary
            ? "Every count below comes from persisted reconciliation results."
            : "Exact matching runs first, followed by the confirmed tolerance policy."
        }
        actions={
          !summary && (
            <button onClick={runRecon} disabled={isBusy}>
              <Play size={17} />
              Run reconciliation
            </button>
          )
        }
      />
      {summary ? (
        <>
          <div className="metric-grid">
            <Metric
              label="Government records"
              value={summary.government_records}
            />
            <Metric
              label="Purchase records"
              value={summary.purchase_register_records}
            />
            <Metric
              label="Exact matches"
              value={summary.exact_matches}
              tone="good"
            />
            <Metric
              label="Tolerance matches"
              value={summary.tolerance_matches}
              tone="good"
            />
            <Metric
              label="Resolved"
              value={nearSummary?.resolved_records ?? summary.resolved_records}
              tone="good"
            />
            <Metric
              label="Open on Government"
              value={
                nearSummary?.remaining_government_records ??
                summary.remaining_government_records
              }
              tone="warn"
            />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", margin: "12px 0" }}>
            <button
              type="button"
              className="button-secondary button-sm"
              onClick={() => setShowDetailedResults((v) => !v)}
            >
              {showDetailedResults ? "Collapse detailed record table" : "View detailed record table"}
              <ChevronDown
                size={14}
                style={{ transform: showDetailedResults ? "rotate(180deg)" : "rotate(0deg)", marginLeft: "4px" }}
              />
            </button>
          </div>
          {showDetailedResults && resultTable}
          <div className="next-step">
            <div>
              <strong>Deterministic pass complete</strong>
              <span>Review ranked near-match candidates next.</span>
            </div>
            <button onClick={() => go("near-matches")}>
              Review near matches
              <ArrowRight size={16} />
            </button>
          </div>
        </>
      ) : (
        <div className="run-state">
          <Play size={25} />
          <h2>Ready to run</h2>
          <p>No matches are made until you start the run.</p>
        </div>
      )}
    </>
  ) : (
    <EmptyState
      icon={<Play />}
      title="Confirm the policy first"
      body="Reconciliation is gated by explicit human approval."
      action={<button onClick={() => go("policy")}>Review policy</button>}
    />
  );

  const stage =
    current === "setup" ? (
      setup
    ) : current === "mapping" ? (
      mapping
    ) : current === "policy" ? (
      policy
    ) : current === "results" ? (
      resultsPage
    ) : current === "near-matches" ? (
      summary ? (
        <>
          <PageHeader
            eyebrow="Stage 5 of 8"
            title="Review likely pairs"
            description="Candidates are ranked from deterministic evidence. Safe proposals still require approval."
          />
          <NearMatchWorkspace
            analysis={nearAnalysis}
            summary={nearSummary}
            busy={isBusy}
            onAnalyze={analyzeNear}
            onDecision={decideNear}
            onBulkApprove={bulkNear}
          />
          {canExceptions && (
            <div className="next-step">
              <div>
                <strong>Near-match review complete</strong>
                <span>Continue to unresolved and ambiguous exceptions.</span>
              </div>
              <button onClick={() => go("exceptions")}>
                Open exceptions
                <ArrowRight size={16} />
              </button>
            </div>
          )}
        </>
      ) : (
        <EmptyState
          icon={<Search />}
          title="Run reconciliation first"
          body="Near-match analysis starts from unresolved results."
          action={<button onClick={() => go("results")}>Go to results</button>}
        />
      )
    ) : current === "exceptions" ? (
      canExceptions && sessionId ? (
        <>
          <PageHeader
            eyebrow="Stage 6 of 8"
            title="Resolve what remains"
            description="Inspect evidence, compare ambiguous candidates, and preserve human decisions."
          />
          <ExceptionWorkspace
            reconciliationId={sessionId}
            onContext={setSelectedException}
            onSummary={setNearSummary}
          />
          <div className="next-step">
            <div>
              <strong>Decisions are persisted</strong>
              <span>Audit the lineage or continue to final review.</span>
            </div>
            <button onClick={() => go("final-review")}>
              Final review
              <ArrowRight size={16} />
            </button>
          </div>
        </>
      ) : (
        <EmptyState
          icon={<CircleAlert />}
          title="Complete near-match review first"
          body="Exceptions unlock once the safe proposal queue is cleared."
          action={
            <button onClick={() => go("near-matches")}>
              Review near matches
            </button>
          }
        />
      )
    ) : current === "audit" ? (
      sessionId ? (
        <>
          <PageHeader
            eyebrow="Stage 7 of 8"
            title="Follow every decision"
            description="A chronological record of system activity, proposals, approvals, and governed changes."
          />
          <AuditTimeline events={events} />
        </>
      ) : null
    ) : current === "final-review" ? (
      canExceptions && sessionId ? (
        <>
          <PageHeader
            eyebrow="Stage 8 of 8"
            title="Close with evidence"
            description="Verify counts, lineage, and rule authority before generating a versioned workbook."
          />
          <FinalReviewWorkspace
            reconciliationId={sessionId}
            onAuditChanged={() => {
              void loadEvents(sessionId);
              void api.exports(sessionId).then(setExportHistory);
            }}
          />
        </>
      ) : (
        <EmptyState
          icon={<ClipboardCheck />}
          title="Final review is not ready"
          body="Complete candidate review before generating the export."
          action={
            <button onClick={() => go("near-matches")}>Continue review</button>
          }
        />
      )
    ) : (
      <Navigate to="results" replace />
    );

  return (
    <div className={`tars-app${sidebarCollapsed ? " tars-app--sidebar-collapsed" : ""}`}>
      <a className="skip-link" href="#workspace">
        Skip to content
      </a>
      <aside className={`app-sidebar${navOpen ? " app-sidebar--open" : ""}`}>
        <div className="brand">
          <img src="/kpmg-logo.png" alt="KPMG" className="brand-logo" />
          <div className="brand-copy">
            <strong>TARS</strong>
            <small>GST Reconciliation</small>
          </div>
          <button
            className="icon-button mobile-only"
            onClick={() => setNavOpen(false)}
            aria-label="Close navigation"
          >
            <X size={18} />
          </button>
        </div>
        <button
          className="sidebar-collapse"
          onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
          aria-label={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"}
          aria-expanded={!sidebarCollapsed}
          title={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"}
        >
          {sidebarCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          <span>{sidebarCollapsed ? "Expand" : "Collapse sidebar"}</span>
        </button>
        <nav aria-label="Primary navigation">
          <NavLink to="/dashboard" data-tooltip="Dashboard" title={sidebarCollapsed ? "Dashboard" : undefined}>
            <Terminal />
            <span>Dashboard</span>
          </NavLink>
          <NavLink to="/overview" data-tooltip="Overview" title={sidebarCollapsed ? "Overview" : undefined}>
            <LayoutDashboard />
            <span>Overview</span>
          </NavLink>
          <NavLink to="/quick-reconcile" data-tooltip="Quick Reconcile" title={sidebarCollapsed ? "Quick Reconcile" : undefined}>
            <Zap />
            <span>Quick Reconcile</span>
          </NavLink>
          <NavLink to="/reconciliations" data-tooltip="Reconciliations" title={sidebarCollapsed ? "Reconciliations" : undefined}>
            <Scale />
            <span>Reconciliations</span>
          </NavLink>
          <NavLink to="/reconciliations-v2" data-tooltip="Reconciliation 2.0" title={sidebarCollapsed ? "Reconciliation 2.0" : undefined}>
            <Sparkles className="text-purple-400" />
            <span>Reconciliation 2.0</span>
          </NavLink>
          <NavLink to="/client-profiles" data-tooltip="Client Profiles" title={sidebarCollapsed ? "Client Profiles" : undefined}>
            <Building2 />
            <span>Client Profiles</span>
          </NavLink>
          <NavLink to="/rules" data-tooltip="Rules Wiki" title={sidebarCollapsed ? "Rules Wiki" : undefined}>
            <BookOpenCheck />
            <span>Rules Wiki</span>
          </NavLink>
          <NavLink to="/rules-v2" data-tooltip="Rules Wiki 2.0" title={sidebarCollapsed ? "Rules Wiki 2.0" : undefined}>
            <SlidersHorizontal className="text-blue-400" />
            <span>Rules Wiki 2.0</span>
          </NavLink>
          <NavLink to="/audit" data-tooltip="Audit" title={sidebarCollapsed ? "Audit" : undefined}>
            <History />
            <span>Audit</span>
          </NavLink>
          <NavLink to="/audit-v2" data-tooltip="Audit 2.0" title={sidebarCollapsed ? "Audit 2.0" : undefined}>
            <History className="text-emerald-400" />
            <span>Audit 2.0</span>
          </NavLink>
        </nav>
        <div className="sidebar-foot">
          <ShieldCheck size={16} />
          <span>
            Human-governed<small>Evidence preserved</small>
          </span>
        </div>
      </aside>
      <div className="app-frame">
        <header className="app-topbar">
          <button
            className="icon-button nav-trigger"
            onClick={() => setNavOpen(true)}
            aria-label="Open navigation"
          >
            <Menu size={19} />
          </button>
          <div className="crumbs">
            <span>Finance operations</span>
            <ChevronRight size={14} />
            <strong>
              {loc.pathname.startsWith("/reconciliations-v2")
                ? "Reconciliation 2.0"
                : loc.pathname.includes("reconciliations")
                ? "Reconciliation workspace"
                : loc.pathname === "/rules"
                ? "Rules Wiki"
                : loc.pathname === "/rules-v2"
                ? "Rules Wiki 2.0"
                : loc.pathname.split("/")[1]?.replaceAll("-", " ") ||
                  "Overview"}
            </strong>
          </div>
          <div className="topbar-actions">
            {isBusy && (
              <span className="sync-state">
                <Activity className="spin" size={14} />
                {busy}
              </span>
            )}
            <button
              className="copilot-trigger"
              ref={copilotTriggerRef}
              onClick={() => setCopilotMode((m) => (m === "closed" ? "floating" : "closed"))}
              aria-haspopup="dialog"
              aria-expanded={copilotMode !== "closed"}
              title="Toggle TARS Copilot (Ctrl+K)"
            >
              <Sparkles size={16} />
              Copilot
            </button>
            <div className="avatar">PO</div>
          </div>
        </header>
        <div className="app-viewport-layout">
          <main
            id="workspace"
          className={
            loc.pathname === "/dashboard"
              ? "workspace workspace--dashboard"
              : loc.pathname.startsWith("/reconciliations-v2")
              ? "workspace workspace--v2"
              : loc.pathname.startsWith("/audit-v2")
              ? "workspace workspace--audit-v2"
              : "workspace"
          }
        >
          <Routes>
            <Route
              path="/"
              element={
                <Navigate
                  to={
                    sessionId
                      ? `/reconciliations/${sessionId}/${nextStage}`
                      : "/overview"
                  }
                  replace
                />
              }
            />
            <Route
              path="/dashboard"
              element={
                <AgenticDashboard
                  onSelectReconciliation={(id, stage) => nav(`/reconciliations/${id}/${stage || "setup"}`)}
                  onStartNew={startNew}
                  onOpenCopilot={() => setCopilotOpen(true)}
                  activeSessionId={sessionId}
                />
              }
            />
            <Route
              path="/overview"
              element={
                <>
                  <PageHeader
                    eyebrow="Finance operations"
                    title="GST reconciliation, under control"
                    description="A clear view of current work and the governed configuration behind it."
                    actions={
                      <div style={{ display: "flex", gap: "0.5rem" }}>
                        <button className="button-secondary" onClick={() => nav("/quick-reconcile")}>
                          <Zap size={16} />
                          Quick reconcile
                        </button>
                        <button onClick={startNew}>
                          <Plus size={17} />
                          New reconciliation
                        </button>
                      </div>
                    }
                  />
                  <div className="overview-grid">
                    <section className="hero-panel">
                      <span className="eyebrow">Current work</span>
                      {sessionId ? (
                        <>
                          <div className="hero-panel__title">
                            <div>
                              <h2>August 2026 GST reconciliation</h2>
                              <p>
                                Session {sessionId.slice(0, 8)} ·{" "}
                                {hasCurrentExport
                                  ? "Export current"
                                  : canExceptions
                                    ? "Exception review ready"
                                  : summary
                                    ? "Reconciliation complete"
                                    : "In progress"}
                              </p>
                            </div>
                            <span className="health">
                              <span />
                              On track
                            </span>
                          </div>
                          <div className="hero-metrics">
                            <Metric
                              label="Resolved Government"
                              value={
                                nearSummary?.resolved_records ??
                                summary?.resolved_records ??
                                0
                              }
                              tone="good"
                            />
                            <Metric
                              label="Government requires review"
                              value={nearSummary?.remaining_government_records ?? summary?.remaining_government_records ?? 0}
                              tone="warn"
                            />
                            <Metric
                              label="PR-only outcome rows"
                              value={nearSummary?.pr_only_records ?? 0}
                              tone="warn"
                            />
                          </div>
                          <button
                            onClick={() =>
                              go(nextStage)
                            }
                          >
                            Continue reconciliation
                            <ArrowRight size={16} />
                          </button>
                        </>
                      ) : (
                        <EmptyState
                          icon={<Scale />}
                          title="No reconciliation in progress"
                          body="Start with two workbooks. TARS guides each governed checkpoint."
                          action={
                            <button onClick={startNew}>
                              <Plus size={16} />
                              New reconciliation
                            </button>
                          }
                        />
                      )}
                    </section>
                    <section className="quiet-panel">
                      <h2>Control posture</h2>
                      <ul>
                        <li>
                          <ShieldCheck />
                          <span>
                            <strong>Human approval gates</strong>
                            <small>
                              Mappings, policy, and ambiguous matches
                            </small>
                          </span>
                        </li>
                        <li>
                          <History />
                          <span>
                            <strong>Immutable lineage</strong>
                            <small>
                              {events.length} persisted events in the current
                              trail
                            </small>
                          </span>
                        </li>
                        <li>
                          <Activity />
                          <span>
                            <strong>Deterministic core</strong>
                            <small>
                              AI proposes context; financial logic stays
                              mechanical
                            </small>
                          </span>
                        </li>
                      </ul>
                    </section>
                  </div>
                </>
              }
            />
            <Route
              path="/reconciliations"
              element={
                <>
                  <PageHeader
                    eyebrow="Work queue"
                    title="Reconciliations"
                    description="Resume active work or begin a new governed reconciliation."
                    actions={
                      <div style={{ display: "flex", gap: "0.5rem" }}>
                        <button className="button-secondary" onClick={() => nav("/quick-reconcile")}>
                          <Zap size={16} />
                          Quick reconcile
                        </button>
                        <button onClick={startNew}>
                          <Plus size={17} />
                          New reconciliation
                        </button>
                      </div>
                    }
                  />
                  <section className="surface list-surface">
                    {error ? (
                      <div className="inline-alert" role="alert" style={{ margin: "1.5rem" }}>
                        <CircleAlert size={17} />
                        <div style={{ flex: 1 }}>
                          <strong>Could not load reconciliations</strong>
                          <p style={{ margin: 0, fontSize: "0.85rem", opacity: 0.9 }}>{error}</p>
                        </div>
                        <button
                          className="button-secondary"
                          onClick={() => {
                            setError(null);
                            void loadReconciliations().catch((r) =>
                              setError(r instanceof Error ? r.message : "Could not load reconciliations."),
                            );
                          }}
                        >
                          Retry
                        </button>
                      </div>
                    ) : reconciliations.length ? (
                      <>
                        <div className="recon-list-header" aria-hidden="true">
                          <span>Client / reconciliation</span>
                          <span>Government</span>
                          <span>PR</span>
                          <span>Current stage</span>
                          <span>Resolved / open</span>
                          <span>Last updated</span>
                          <span />
                        </div>
                        {reconciliations.map((item) => (
                          <article className="recon-row" key={item.id}>
                            <span className="recon-identity">
                              <span className="recon-icon"><FileSpreadsheet /></span>
                              <span>
                                <strong>{item.client_name ?? "GST reconciliation"}</strong>
                                <small>Session {item.id.slice(0, 8)} · {item.status.replaceAll("_", " ")}</small>
                              </span>
                            </span>
                            <span data-label="Government"><b>{nf.format(item.government_records)}</b></span>
                            <span data-label="PR"><b>{nf.format(item.purchase_register_records)}</b></span>
                            <span data-label="Current stage"><b>{stages.find((stage) => stage.key === item.current_stage)?.label ?? item.current_stage}</b></span>
                            <span data-label="Resolved / open">
                              <b>{nf.format(item.resolved_records)} resolved</b>
                              <small>{nf.format(item.remaining_government_records)} Gov · {nf.format(item.remaining_purchase_register_records)} PR open</small>
                            </span>
                            <span data-label="Last updated">
                              <b>{new Date(item.updated_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</b>
                              <small>{new Date(item.updated_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</small>
                            </span>
                            <button
                              className="recon-continue"
                              onClick={() => nav(`/reconciliations/${item.id}/${item.current_stage}`)}
                              aria-label={`Continue reconciliation ${item.id.slice(0, 8)}`}
                            >
                              Continue <ChevronRight size={15} />
                            </button>
                          </article>
                        ))}
                      </>
                    ) : (
                      <EmptyState
                        icon={<FileSearch />}
                        title="No recent reconciliations"
                        body="Your next reconciliation will appear here."
                      />
                    )}
                  </section>
                </>
              }
            />
            <Route path="/reconciliations/new/setup" element={setup} />
            <Route path="/reconciliations-v2" element={<ReconciliationV2Workspace />} />
            <Route path="/reconciliations-v2/:id" element={<ReconciliationV2Workspace />} />
            <Route path="/reconciliations-v2/:id/:stage" element={<ReconciliationV2Workspace />} />
            <Route
              path="/quick-reconcile"
              element={
                <QuickReconcile
                  onSessionCreated={(id, targetStage) => {
                    setSessionId(id);
                    void hydrate(id);
                    void loadEvents(id);
                    if (targetStage && targetStage !== "final-review") {
                      nav(`/reconciliations/${id}/${targetStage}`);
                    }
                  }}
                  onOpenCopilot={(id) => {
                    setSessionId(id);
                    setCopilotOpen(true);
                  }}
                />
              }
            />
            <Route
              path="/reconciliations/:id/:stage"
              element={
                <div className="reconciliation-layout">
                  <Progress
                    id={sessionId ?? "new"}
                    current={current}
                    complete={complete}
                    finalState={hasCurrentExport ? "current" : hasStaleExport ? "stale" : "none"}
                  />
                  <div className="stage-content">
                    {profileNotice && (
                      <div className="context-note" role="status">
                        <ShieldCheck size={17} />
                        {profileNotice}
                      </div>
                    )}
                    {booting ? (
                      <>
                        <PageHeader
                          eyebrow="Reconciliation workspace"
                          title="Restoring your work"
                          description="Loading the persisted configuration, results, and audit lineage for this session."
                        />
                        <div className="loading-state" role="status">
                          <Activity className="spin" size={20} />
                          <span>Retrieving verified session state…</span>
                        </div>
                      </>
                    ) : (
                      stage
                    )}
                  </div>
                </div>
              }
            />
            <Route
              path="/client-profiles"
              element={
                <>
                  <PageHeader
                    eyebrow="Reusable configuration"
                    title="Client Profiles"
                    description="Reuse approved mappings and policies only after schema compatibility checks."
                  />
                  <GovernanceWorkspace
                    reconciliationId={sessionId ?? undefined}
                    onAuditChanged={() => void api.auditEvents(sessionId ?? undefined).then(setEvents)}
                  />
                </>
              }
            />
            <Route
              path="/rules"
              element={<RulesWiki />}
            />
            <Route
              path="/rules-v2"
              element={<RulesWikiV2 />}
            />
            <Route
              path="/audit"
              element={
                <>
                  <PageHeader
                    eyebrow="Enterprise evidence"
                    title="Audit"
                    description="Review persisted events without exposing model chain-of-thought."
                  />
                  {events.length ? (
                    <AuditTimeline events={events} />
                  ) : (
                    <EmptyState
                      icon={<History />}
                      title="No audit events yet"
                      body="Events appear as reconciliation work is performed."
                    />
                  )}
                </>
              }
            />
            <Route path="/audit-v2" element={<Audit2Workspace />} />
            <Route path="/audit-v2/:runId" element={<Audit2Workspace />} />
            <Route
              path="*"
              element={
                <EmptyState
                  icon={<FileSearch />}
                  title="This page does not exist"
                  body="Return to the overview."
                  action={
                    <button onClick={() => nav("/overview")}>
                      Go to overview
                    </button>
                  }
                />
              }
            />
          </Routes>
        </main>
      </div>
    </div>

    {/* Mode A: Floating Overlapping Card Window (OpenAI Support Style) */}
    {copilotMode === "floating" && (
      <CopilotPanel
        reconciliationId={sessionId}
        selectedRecordId={selectedException}
        currentPage={loc.pathname}
        mode="floating"
        onModeChange={setCopilotMode}
        onClose={() => setCopilotMode("closed")}
      />
    )}

    {/* Mode B: Maximized Fullscreen Console Workstation */}
    {copilotMode === "fullscreen" && (
      <CopilotPanel
        reconciliationId={sessionId}
        selectedRecordId={selectedException}
        currentPage={loc.pathname}
        mode="fullscreen"
        onModeChange={setCopilotMode}
        onClose={() => setCopilotMode("closed")}
      />
    )}

    {/* Mode C: Circular Floating Trigger Button (OpenAI Help Style) */}
    {copilotMode === "closed" && (
      <button
        type="button"
        className="tars-copilot-fab-launcher"
        onClick={() => setCopilotMode("floating")}
        title="Open TARS Copilot (Ctrl+K)"
        aria-label="Open TARS Copilot"
      >
        <span className="tars-copilot-fab-pulse" />
        <MessageSquareText size={24} />
      </button>
    )}
      {selected && (
        <ToleranceDetail item={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
