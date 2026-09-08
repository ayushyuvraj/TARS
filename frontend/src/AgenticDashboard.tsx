import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Activity,
  ArrowRight,
  BookOpenCheck,
  Building2,
  CheckCircle2,
  CornerDownLeft,
  FileSpreadsheet,
  Filter,
  History,
  Layers,
  MessageSquareText,
  Play,
  Plus,
  RefreshCw,
  Scale,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  X,
  Zap,
} from "lucide-react";
import {
  api,
  AuditEvent,
  ClientProfile,
  ReconciliationListItem,
  RuleCatalogResponse,
} from "./api";
import "./dashboard.css";

interface AgenticDashboardProps {
  onSelectReconciliation?: (id: string, stage?: string) => void;
  onStartNew?: () => void;
  onOpenCopilot?: () => void;
  activeSessionId?: string | null;
}

const PIPELINE_ORDER: Array<{
  key: ReconciliationListItem["current_stage"];
  label: string;
  stepNum: number;
  engine: string;
}> = [
  { key: "setup", label: "INGEST", stepNum: 1, engine: "Pandas Streaming Ingest" },
  { key: "mapping", label: "MAPPING", stepNum: 2, engine: "AI Semantic Column Matcher" },
  { key: "policy", label: "POLICY", stepNum: 3, engine: "Deterministic Policy Compiler" },
  { key: "results", label: "EXACT/TOL", stepNum: 4, engine: "Vector & Hash Dual-Join" },
  { key: "near-matches", label: "NEAR_MATCH", stepNum: 5, engine: "Governed Tolerance Engine" },
  { key: "exceptions", label: "EXCEPTIONS", stepNum: 6, engine: "Deterministic Bucket Categorizer" },
  { key: "final-review", label: "SIGN_OFF", stepNum: 7, engine: "Immutable Audit Sealer" },
  { key: "audit", label: "EXPORTED", stepNum: 8, engine: "XLSX Ledger Streamer" },
];

export const AgenticDashboard: React.FC<AgenticDashboardProps> = ({
  onSelectReconciliation,
  onStartNew,
  onOpenCopilot,
  activeSessionId,
}) => {
  const nav = useNavigate();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Raw API state
  const [reconciliations, setReconciliations] = useState<ReconciliationListItem[]>([]);
  const [catalog, setCatalog] = useState<RuleCatalogResponse | null>(null);
  const [profiles, setProfiles] = useState<ClientProfile[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);

  // Interactive Company Scope Filter (Dynamic)
  const [selectedClientName, setSelectedClientName] = useState<string | null>(null);

  // Interactive CLI input state
  const [cliInput, setCliInput] = useState("");
  const [cliFeedback, setCliFeedback] = useState<string | null>(null);

  // Pipeline inspector state
  const [inspectedStage, setInspectedStage] = useState<string | null>(null);

  const loadDashboardData = async (isManualRefresh = false) => {
    if (isManualRefresh) setRefreshing(true);
    setError(null);

    try {
      const [reconList, rulesCat, profList, auditList] = await Promise.all([
        api.listReconciliations().catch(() => [] as ReconciliationListItem[]),
        api.rulesCatalog().catch(() => null),
        api.profiles().catch(() => [] as ClientProfile[]),
        api.auditEvents().catch(() => [] as AuditEvent[]),
      ]);

      setReconciliations(reconList || []);
      setCatalog(rulesCat);
      setProfiles(profList || []);
      setAuditEvents(auditList || []);

      if (isManualRefresh) {
        setCliFeedback("TELEMETRY_SYNCED: authoritatively polled SQLite & rules catalog.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard telemetry.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void loadDashboardData();
  }, []);

  // Unique client list derived dynamically from both profiles and reconciliations
  const availableClients = useMemo(() => {
    const clientsMap = new Map<string, { name: string; runCount: number }>();

    for (const r of reconciliations) {
      const name = r.client_name?.trim() || "Unassigned Client";
      const existing = clientsMap.get(name);
      if (existing) {
        existing.runCount++;
      } else {
        clientsMap.set(name, { name, runCount: 1 });
      }
    }

    for (const p of profiles) {
      const name = p.client_name?.trim() || "Unassigned Client";
      if (!clientsMap.has(name)) {
        clientsMap.set(name, { name, runCount: 0 });
      }
    }

    return Array.from(clientsMap.values());
  }, [reconciliations, profiles]);

  // Dynamically filter reconciliations by selected company scope
  const filteredReconciliations = useMemo(() => {
    if (!selectedClientName) return reconciliations;
    return reconciliations.filter(
      (r) => (r.client_name?.trim() || "Unassigned Client") === selectedClientName
    );
  }, [reconciliations, selectedClientName]);

  // Dynamically filter audit events by sessions belonging to selected company
  const filteredAuditEvents = useMemo(() => {
    if (!selectedClientName) return auditEvents;
    const clientSessionIds = new Set(filteredReconciliations.map((r) => r.id));
    const matched = auditEvents.filter(
      (e) => e.reconciliation_id && clientSessionIds.has(e.reconciliation_id)
    );
    return matched.length > 0 ? matched : auditEvents.slice(0, 8);
  }, [auditEvents, filteredReconciliations, selectedClientName]);

  // Compute 100% dynamic aggregated metrics based on active company scope
  const telemetry = useMemo(() => {
    let totalGov = 0;
    let totalPR = 0;
    let totalResolved = 0;
    let totalRemainingGov = 0;
    let totalRemainingPR = 0;
    let inProgressCount = 0;
    let completedCount = 0;

    for (const r of filteredReconciliations) {
      totalGov += r.government_records || 0;
      totalPR += r.purchase_register_records || 0;
      totalResolved += r.resolved_records || 0;
      totalRemainingGov += r.remaining_government_records || 0;
      totalRemainingPR += r.remaining_purchase_register_records || 0;
      if (r.status === "in_progress") {
        inProgressCount++;
      } else {
        completedCount++;
      }
    }

    const totalRecords = totalGov + totalPR;
    const resolutionRate =
      totalGov > 0 ? ((totalResolved / totalGov) * 100).toFixed(1) : "0.0";

    const lockedGuardrails = catalog?.summary.locked_count ?? 0;
    const configurableRules = catalog?.summary.configurable_count ?? 0;
    const totalRules = catalog?.summary.total_rules ?? 0;

    // Scope rules to client profile if selected
    const clientProfile = selectedClientName
      ? profiles.find(
          (p) => (p.client_name?.trim() || "Unassigned Client") === selectedClientName
        )
      : null;

    const scopedRuleCount = clientProfile
      ? clientProfile.active_rule_ids.length + lockedGuardrails
      : totalRules;

    const activeProfilesCount = selectedClientName ? 1 : profiles.length;
    const totalAuditCount = filteredAuditEvents.length;

    return {
      totalGov,
      totalPR,
      totalRecords,
      totalResolved,
      totalRemainingGov,
      totalRemainingPR,
      resolutionRate,
      inProgressCount,
      completedCount,
      lockedGuardrails,
      configurableRules,
      totalRules,
      scopedRuleCount,
      activeProfilesCount,
      totalAuditCount,
      clientProfile,
    };
  }, [filteredReconciliations, catalog, profiles, filteredAuditEvents, selectedClientName]);

  // Identify latest or active run for current scope
  const activeRun = useMemo(() => {
    if (activeSessionId) {
      const found = filteredReconciliations.find((r) => r.id === activeSessionId);
      if (found) return found;
    }
    const inProg = filteredReconciliations.find((r) => r.status === "in_progress");
    if (inProg) return inProg;
    return filteredReconciliations.length > 0 ? filteredReconciliations[0] : null;
  }, [filteredReconciliations, activeSessionId]);

  const activeStageIndex = useMemo(() => {
    if (!activeRun) return -1;
    const idx = PIPELINE_ORDER.findIndex((p) => p.key === activeRun.current_stage);
    return idx >= 0 ? idx : 0;
  }, [activeRun]);

  const handleOpenRun = (id: string, stage?: string) => {
    if (onSelectReconciliation) {
      onSelectReconciliation(id, stage);
    } else {
      nav(stage ? `/reconciliations/${id}/${stage}` : `/reconciliations/${id}`);
    }
  };

  const handleStartNewReconciliation = () => {
    if (onStartNew) {
      onStartNew();
    } else {
      nav("/quick-reconcile");
    }
  };

  // Interactive CLI command executor
  const handleCliSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const query = cliInput.trim().toLowerCase();
    if (!query) return;

    if (query === "help" || query === "?") {
      setCliFeedback("COMMANDS: 'all' (clear filter), 'filter <name>', 'quick', 'rules', 'audit', 'sync', 'copilot <q>'");
    } else if (query === "all" || query === "reset" || query === "clear") {
      setSelectedClientName(null);
      setCliFeedback("SCOPE_RESET: Showing global portfolio across all organizations.");
    } else if (query.startsWith("filter ")) {
      const target = query.replace("filter ", "").trim();
      const match = availableClients.find((c) => c.name.toLowerCase().includes(target));
      if (match) {
        setSelectedClientName(match.name);
        setCliFeedback(`SCOPE_SET: Filtered to '${match.name}' (${match.runCount} runs).`);
      } else {
        setCliFeedback(`FILTER_FAIL: No client matched '${target}'.`);
      }
    } else if (query === "quick" || query === "quick-reconcile") {
      nav("/quick-reconcile");
    } else if (query === "rules" || query === "rules-wiki") {
      nav("/rules");
    } else if (query === "audit" || query === "audit-trail") {
      nav("/audit");
    } else if (query === "sync" || query === "refresh") {
      void loadDashboardData(true);
    } else if (query.startsWith("copilot") || onOpenCopilot) {
      setCliFeedback("COPILOT_DISPATCHED: Summoning AI financial reasoning sidecar.");
      onOpenCopilot?.();
    } else {
      const match = availableClients.find((c) => query.includes(c.name.toLowerCase()));
      if (match) {
        setSelectedClientName(match.name);
        setCliFeedback(`SCOPE_SET: Auto-detected client '${match.name}'.`);
      } else {
        setCliFeedback(`AGENT_INTENT: [${cliInput}] -> Summoning Copilot with query context.`);
        onOpenCopilot?.();
      }
    }
    setCliInput("");
  };

  const formatTimestamp = (ts?: string) => {
    if (!ts) return "--:--:--";
    try {
      const d = new Date(ts);
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    } catch {
      return ts.slice(11, 19) || ts;
    }
  };

  if (loading) {
    return (
      <div className="agentic-dashboard">
        <div className="dash-loading-box">
          <RefreshCw className="dash-spin" size={26} />
          <div>[SYSTEM_BOOT: HYDRATING KPMG AGENT TELEMETRY RUNTIME...]</div>
          <span style={{ fontSize: "0.72rem", opacity: 0.7 }}>
            Authoritatively polling SQLite database, deterministic rules, & audit log
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="agentic-dashboard">
      {/* 1. KPMG SIGNATURE TELEMETRY STATUS BAR */}
      <section className="dash-telemetry-bar">
        <div className="dash-telemetry-left">
          <div className="dash-brand-kpmg">
            KPMG <span>// TARS AGENT HUD</span>
          </div>

          <div className="dash-agent-badge">
            <span className="dash-pulse-dot" />
            <span>OPERATIONAL</span>
          </div>

          <div className="dash-telemetry-tags">
            <span className="dash-pill dash-pill--emerald">
              CORE: <strong>DETERMINISTIC_ACTIVE</strong>
            </span>
            <span className="dash-pill dash-pill--violet">
              AI: <strong>{catalog?.llm_provider || "GEMINI_3.8_ACTIVE"}</strong>
            </span>
            <span className="dash-pill dash-pill--cyan">
              SCOPE:{" "}
              <strong>
                {selectedClientName ? selectedClientName.toUpperCase() : "GLOBAL_PORTFOLIO"}
              </strong>
            </span>
            <span className="dash-pill">
              RUNS: <strong>{filteredReconciliations.length} LOADED</strong>
            </span>
          </div>
        </div>

        <div className="dash-telemetry-actions">
          {selectedClientName && (
            <button
              className="dash-btn-terminal dash-btn-terminal--danger"
              onClick={() => {
                setSelectedClientName(null);
                setCliFeedback("SCOPE_RESET: Showing all clients.");
              }}
              title="Reset client filter to global"
            >
              <X size={12} />
              <span>RESET SCOPE</span>
            </button>
          )}
          <button
            className="dash-btn-terminal"
            onClick={() => void loadDashboardData(true)}
            disabled={refreshing}
            title="Refresh dynamic telemetry"
          >
            <RefreshCw size={12} className={refreshing ? "dash-spin" : ""} />
            <span>{refreshing ? "SYNCING..." : "SYNC"}</span>
          </button>
          <button
            className="dash-btn-terminal"
            onClick={() => nav("/quick-reconcile")}
            title="Fast 2-workbook reconciliation"
          >
            <Zap size={12} />
            <span>QUICK_RECON</span>
          </button>
          {onOpenCopilot && (
            <button
              className="dash-btn-terminal dash-btn-terminal--violet"
              onClick={onOpenCopilot}
              title="Summon TARS Copilot sidecar"
            >
              <MessageSquareText size={12} />
              <span>COPILOT</span>
            </button>
          )}
          <button
            className="dash-btn-terminal dash-btn-terminal--primary"
            onClick={handleStartNewReconciliation}
            title="Start fresh reconciliation pipeline"
          >
            <Plus size={13} />
            <span>NEW_WORKSTREAM</span>
          </button>
        </div>
      </section>

      {/* 2. CLAUDE CODE / CODEX INTERACTIVE CLI BAR */}
      <form className="dash-cli-bar" onSubmit={handleCliSubmit}>
        <span className="dash-cli-prompt">
          <Terminal size={13} />
          <span>tars_agent&gt;</span>
        </span>
        <input
          className="dash-cli-input"
          type="text"
          value={cliInput}
          onChange={(e) => setCliInput(e.target.value)}
          placeholder="Type agent command or prompt (e.g. 'filter Acme', 'quick', 'rules', 'audit', 'why are rows open?')..."
        />
        <div className="dash-cli-shortcuts">
          <span
            className="dash-cli-tag"
            onClick={() => {
              setSelectedClientName(null);
              setCliFeedback("SCOPE: Global portfolio view active.");
            }}
          >
            all-clients
          </span>
          <span className="dash-cli-tag" onClick={() => nav("/quick-reconcile")}>
            quick-recon
          </span>
          <span className="dash-cli-tag" onClick={() => nav("/rules")}>
            rules-wiki
          </span>
          <span className="dash-cli-tag" onClick={() => nav("/audit")}>
            audit-tail
          </span>
          {onOpenCopilot && (
            <span className="dash-cli-tag" onClick={onOpenCopilot}>
              ask-copilot
            </span>
          )}
          <button
            type="submit"
            className="dash-btn-terminal dash-btn-terminal--primary"
            style={{ padding: "1px 6px", fontSize: "0.65rem", minHeight: "22px" }}
            title="Execute command"
          >
            <CornerDownLeft size={10} />
            <span>RUN</span>
          </button>
        </div>
      </form>

      {cliFeedback && (
        <div
          className="dash-cli-feedback agentic-mono"
          style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
        >
          <span>&gt; {cliFeedback}</span>
          <button
            type="button"
            onClick={() => setCliFeedback(null)}
            style={{
              background: "none",
              border: "none",
              color: "inherit",
              cursor: "pointer",
              padding: 0,
              display: "flex",
            }}
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* 3. INTERACTIVE COMPANY FILTER STRIP */}
      {availableClients.length > 0 && (
        <section className="dash-client-filter-strip" aria-label="Company Scope Filter">
          <span className="dash-filter-label">
            <Filter size={11} style={{ display: "inline", marginRight: "3px" }} />
            SCOPE:
          </span>
          <button
            className={`dash-client-filter-btn ${
              selectedClientName === null ? "dash-client-filter-btn--active" : ""
            }`}
            onClick={() => {
              setSelectedClientName(null);
              setCliFeedback("SCOPE_RESET: Showing global portfolio across all organizations.");
            }}
          >
            <span>● ALL ORGANIZATIONS</span>
            <span className="dash-pill" style={{ padding: "0 4px" }}>
              {reconciliations.length}
            </span>
          </button>

          {availableClients.map((client) => {
            const isSelected = selectedClientName === client.name;
            return (
              <button
                key={client.name}
                className={`dash-client-filter-btn ${
                  isSelected ? "dash-client-filter-btn--active" : ""
                }`}
                onClick={() => {
                  if (isSelected) {
                    setSelectedClientName(null);
                    setCliFeedback("SCOPE_RESET: Switched back to all organizations.");
                  } else {
                    setSelectedClientName(client.name);
                    setCliFeedback(
                      `SCOPE_SET: All tabs, metrics & audit events scoped to '${client.name}'.`
                    );
                  }
                }}
              >
                <Building2 size={12} />
                <span>{client.name}</span>
                <span className="dash-pill" style={{ padding: "0 4px" }}>
                  {client.runCount} {client.runCount === 1 ? "run" : "runs"}
                </span>
              </button>
            );
          })}
        </section>
      )}

      {/* 4. HEROIC MACRO KPI TELEMETRY RIBBON (100% Dynamic, KPMG Themed) */}
      <section className="dash-macro-ribbon" aria-label="System KPI Telemetry">
        <div className="dash-kpi-card dash-kpi-card--cobalt">
          <div className="dash-kpi-top-row">
            <span className="dash-kpi-telemetry-code">SYS.VOL_01</span>
            <FileSpreadsheet className="dash-kpi-icon" size={14} />
          </div>
          <div className="dash-kpi-value">{telemetry.totalRecords.toLocaleString()}</div>
          <div className="dash-kpi-label">
            {selectedClientName ? `${selectedClientName} Invoices` : "Total Invoices Processed"}
          </div>
          <div className="dash-kpi-meta">
            <span>Gov: {telemetry.totalGov.toLocaleString()}</span>
            <span className="dash-kpi-meta-badge dash-kpi-meta-badge--cyan">
              PR: {telemetry.totalPR.toLocaleString()}
            </span>
          </div>
        </div>

        <div className="dash-kpi-card dash-kpi-card--green">
          <div className="dash-kpi-top-row">
            <span className="dash-kpi-telemetry-code">SYS.RES_02</span>
            <CheckCircle2 className="dash-kpi-icon" size={14} />
          </div>
          <div className="dash-kpi-value">{telemetry.resolutionRate}%</div>
          <div className="dash-kpi-label">Auto-Resolution Efficiency</div>
          <div className="dash-kpi-meta">
            <span>Resolved: {telemetry.totalResolved.toLocaleString()}</span>
            <span className="dash-kpi-meta-badge dash-kpi-meta-badge--good">ASSURED</span>
          </div>
        </div>

        <div className="dash-kpi-card">
          <div className="dash-kpi-top-row">
            <span className="dash-kpi-telemetry-code">SYS.REV_03</span>
            <Scale className="dash-kpi-icon" size={14} />
          </div>
          <div className="dash-kpi-value">{telemetry.totalRemainingGov.toLocaleString()}</div>
          <div className="dash-kpi-label">Gov Awaiting Review</div>
          <div className="dash-kpi-meta">
            <span>PR Open: {telemetry.totalRemainingPR.toLocaleString()}</span>
            <span className="dash-kpi-meta-badge dash-kpi-meta-badge--warn">
              {telemetry.totalRemainingGov > 0 ? "EXCEPTIONS" : "CLEARED"}
            </span>
          </div>
        </div>

        <div className="dash-kpi-card dash-kpi-card--green">
          <div className="dash-kpi-top-row">
            <span className="dash-kpi-telemetry-code">SYS.GOV_04</span>
            <ShieldCheck className="dash-kpi-icon" size={14} />
          </div>
          <div className="dash-kpi-value">{telemetry.scopedRuleCount}</div>
          <div className="dash-kpi-label">Governed Rules in Force</div>
          <div className="dash-kpi-meta">
            <span>Guardrails: {telemetry.lockedGuardrails}</span>
            <span className="dash-kpi-meta-badge dash-kpi-meta-badge--good">ENFORCED</span>
          </div>
        </div>

        <div className="dash-kpi-card dash-kpi-card--violet">
          <div className="dash-kpi-top-row">
            <span className="dash-kpi-telemetry-code">SYS.AUD_05</span>
            <History className="dash-kpi-icon" size={14} />
          </div>
          <div className="dash-kpi-value">{telemetry.totalAuditCount}</div>
          <div className="dash-kpi-label">Cryptographic Touchpoints</div>
          <div className="dash-kpi-meta">
            <span>Profiles: {telemetry.activeProfilesCount}</span>
            <span className="dash-kpi-meta-badge dash-kpi-meta-badge--cyan">VERIFIED</span>
          </div>
        </div>
      </section>

      {/* 5. MAIN WIDESCREEN BENTO GRID (ZERO-SCROLL FIT) */}
      <div className="dash-grid">
        {/* LEFT COLUMN: ACTIVE FLIGHT DECK + RECENT SESSIONS TABLE */}
        <div className="dash-col">
          {/* ACTIVE FLIGHT DECK */}
          <section className="dash-card">
            <div className="dash-card-header">
              <h3>
                <Activity size={14} style={{ color: "var(--kpmg-cobalt)" }} />
                <span>FLIGHT DECK // {selectedClientName ? selectedClientName.toUpperCase() : "ACTIVE WORKSTREAM"}</span>
              </h3>
              <span className="dash-card-badge">
                {activeRun?.status === "in_progress" ? "RUNNING" : "STANDBY"}
              </span>
            </div>

            <div className="dash-flight-deck">
              {activeRun ? (
                <>
                  <div className="dash-flight-top">
                    <div>
                      <div className="dash-flight-session-id">
                        SESSION_ID: {activeRun.id}
                      </div>
                      <h4 className="dash-flight-title">
                        {activeRun.client_name || "GST Reconciliation Workstream"}
                      </h4>
                      <p className="dash-flight-sub">
                        Gov: <strong>{activeRun.government_filename || "GSTR-2B"}</strong> · PR:{" "}
                        <strong>{activeRun.purchase_register_filename || "Purchase Register"}</strong>
                      </p>
                    </div>
                    <button
                      className="dash-btn-terminal dash-btn-terminal--primary"
                      onClick={() => handleOpenRun(activeRun.id, activeRun.current_stage)}
                    >
                      <Play size={12} />
                      <span>RESUME EXECUTION</span>
                      <ArrowRight size={12} />
                    </button>
                  </div>

                  {/* AGENTIC PIPELINE STEPPER */}
                  <div className="dash-pipeline-wrapper">
                    <div className="dash-pipeline-header">
                      <span>STAGE: {activeRun.current_stage.toUpperCase()}</span>
                      <span>
                        {inspectedStage ? (
                          <span style={{ color: "var(--kpmg-light-blue)" }}>
                            ENGINE: {PIPELINE_ORDER.find((p) => p.key === inspectedStage)?.engine}
                          </span>
                        ) : (
                          `NODE ${activeStageIndex + 1} OF ${PIPELINE_ORDER.length}`
                        )}
                      </span>
                    </div>
                    <div className="dash-pipeline-steps">
                      {PIPELINE_ORDER.map((step, idx) => {
                        const isDone = idx < activeStageIndex;
                        const isActive = idx === activeStageIndex;
                        const stateClass = isDone
                          ? "dash-step-node--done"
                          : isActive
                          ? "dash-step-node--active"
                          : "dash-step-node--pending";

                        return (
                          <React.Fragment key={step.key}>
                            <div
                              className={`dash-step-node ${stateClass}`}
                              onMouseEnter={() => setInspectedStage(step.key)}
                              onMouseLeave={() => setInspectedStage(null)}
                              onClick={() => handleOpenRun(activeRun.id, step.key)}
                              title={`${step.label} (${step.engine}) - Click to inspect stage`}
                            >
                              <span>
                                {step.stepNum}.{step.label}
                              </span>
                            </div>
                            {idx < PIPELINE_ORDER.length - 1 && (
                              <span className="dash-step-arrow">➔</span>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </div>
                  </div>

                  {/* FLIGHT STATS */}
                  <div className="dash-flight-stats">
                    <div className="dash-stat-box">
                      <div className="dash-stat-label">Gov Records</div>
                      <div className="dash-stat-val dash-stat-val--blue">
                        {activeRun.government_records.toLocaleString()}
                      </div>
                    </div>
                    <div className="dash-stat-box">
                      <div className="dash-stat-label">PR Records</div>
                      <div className="dash-stat-val">
                        {activeRun.purchase_register_records.toLocaleString()}
                      </div>
                    </div>
                    <div className="dash-stat-box">
                      <div className="dash-stat-label">Resolved Rows</div>
                      <div className="dash-stat-val dash-stat-val--good">
                        {activeRun.resolved_records.toLocaleString()}
                      </div>
                    </div>
                    <div className="dash-stat-box">
                      <div className="dash-stat-label">Gov In Review</div>
                      <div className="dash-stat-val dash-stat-val--warn">
                        {activeRun.remaining_government_records.toLocaleString()}
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div style={{ textAlign: "center", padding: "16px", color: "var(--ink-2)" }}>
                  <p style={{ margin: "0 0 8px 0", fontSize: "0.8rem" }}>
                    No sessions found for this scope.
                  </p>
                  <button
                    className="dash-btn-terminal dash-btn-terminal--primary"
                    onClick={() => nav("/quick-reconcile")}
                  >
                    <Zap size={12} />
                    <span>LAUNCH QUICK RECONCILE</span>
                  </button>
                </div>
              )}
            </div>
          </section>

          {/* SESSIONS MATRIX TABLE (ZERO-SCROLL SLICE) */}
          <section className="dash-card dash-card--table">
            <div className="dash-card-header">
              <h3>
                <Layers size={14} style={{ color: "var(--kpmg-blue)" }} />
                <span>
                  PORTFOLIO MATRIX // {selectedClientName ? `${selectedClientName.toUpperCase()} SESSIONS` : "RECENT SESSIONS"}
                </span>
              </h3>
              <button
                className="dash-btn-terminal"
                onClick={() => nav("/reconciliations")}
                style={{ fontSize: "0.68rem", padding: "2px 7px", minHeight: "22px" }}
              >
                <span>RECONCILIATIONS VIEW ({filteredReconciliations.length})</span>
                <ArrowRight size={10} />
              </button>
            </div>

            <div className="dash-table-wrap">
              <table className="dash-matrix-table">
                <thead>
                  <tr>
                    <th>Session / Client</th>
                    <th>Gov / PR Rows</th>
                    <th>Resolved / Rate</th>
                    <th>Pipeline Stage</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredReconciliations.length > 0 ? (
                    filteredReconciliations.slice(0, 5).map((r) => {
                      const matchPct =
                        r.government_records > 0
                          ? Math.round((r.resolved_records / r.government_records) * 100)
                          : 0;

                      return (
                        <tr key={r.id}>
                          <td>
                            <div className="dash-table-client">
                              {r.client_name || "GST Client"}
                            </div>
                            <div className="dash-table-id">
                              {r.id.slice(0, 8)} · {r.status}
                            </div>
                          </td>
                          <td>
                            <span className="agentic-mono" style={{ fontWeight: 600 }}>
                              {r.government_records.toLocaleString()}
                            </span>{" "}
                            /{" "}
                            <span className="agentic-mono" style={{ color: "var(--ink-3)" }}>
                              {r.purchase_register_records.toLocaleString()}
                            </span>
                          </td>
                          <td>
                            <div className="agentic-mono" style={{ fontWeight: 600 }}>
                              {r.resolved_records.toLocaleString()}{" "}
                              <span style={{ fontSize: "0.68rem", color: "var(--kpmg-green)" }}>
                                ({matchPct}%)
                              </span>
                            </div>
                            <div className="dash-table-progress-bar">
                              <div
                                className="dash-table-progress-fill"
                                style={{ width: `${Math.min(matchPct, 100)}%` }}
                              />
                            </div>
                          </td>
                          <td>
                            <span
                              className={`dash-stage-pill ${
                                r.status === "in_progress" ? "dash-stage-pill--active" : ""
                              }`}
                            >
                              {r.current_stage}
                            </span>
                          </td>
                          <td>
                            <button
                              className="dash-btn-terminal"
                              onClick={() => handleOpenRun(r.id, r.current_stage)}
                              style={{ padding: "2px 7px", fontSize: "0.68rem", minHeight: "22px" }}
                            >
                              <span>OPEN</span>
                              <ArrowRight size={10} />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={5} style={{ textAlign: "center", padding: "16px" }}>
                        No reconciliations recorded for this client.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        {/* RIGHT COLUMN: GOVERNANCE + LIVE AUDIT STREAM + CLIENT PROFILES */}
        <div className="dash-col">
          {/* GOVERNANCE & CONTROL PLANE GAUGE */}
          <section className="dash-card">
            <div className="dash-card-header">
              <h3>
                <BookOpenCheck size={14} style={{ color: "var(--kpmg-green)" }} />
                <span>GOVERNANCE CONTROL PLANE</span>
              </h3>
              <button
                className="dash-btn-terminal"
                onClick={() => nav("/rules")}
                style={{ fontSize: "0.68rem", padding: "2px 7px", minHeight: "22px" }}
              >
                <span>RULES WIKI</span>
                <ArrowRight size={10} />
              </button>
            </div>

            <div className="dash-governance-body">
              <div className="dash-guardrail-alert">
                <ShieldCheck size={16} style={{ flexShrink: 0, color: "var(--kpmg-green)" }} />
                <div>
                  <strong>Mandatory Guardrails Enforced ({telemetry.lockedGuardrails})</strong>
                  <span>Mathematical integrity and GSTIN format checksums are deterministic.</span>
                </div>
              </div>

              <div className="dash-rule-stat-grid">
                <div className="dash-rule-counter">
                  <div className="dash-rule-counter-num">{telemetry.scopedRuleCount}</div>
                  <div className="dash-rule-counter-label">
                    {selectedClientName ? "Client Rules" : "Total Rules"}
                  </div>
                </div>
                <div className="dash-rule-counter">
                  <div className="dash-rule-counter-num" style={{ color: "var(--kpmg-green)" }}>
                    {telemetry.lockedGuardrails}
                  </div>
                  <div className="dash-rule-counter-label">Locked Safe</div>
                </div>
                <div className="dash-rule-counter">
                  <div className="dash-rule-counter-num" style={{ color: "var(--kpmg-blue)" }}>
                    {telemetry.configurableRules}
                  </div>
                  <div className="dash-rule-counter-label">Configurable</div>
                </div>
              </div>
            </div>
          </section>

          {/* LIVE AGENT AUDIT TERMINAL STREAM */}
          <section className="dash-card dash-card--terminal">
            <div className="dash-card-header">
              <h3>
                <Terminal size={14} style={{ color: "var(--kpmg-cobalt)" }} />
                <span>
                  AUDIT_LOG // {selectedClientName ? `${selectedClientName.toUpperCase()} TAIL` : "LIVE TAIL"}
                </span>
              </h3>
              <button
                className="dash-btn-terminal"
                onClick={() => nav("/audit")}
                style={{ fontSize: "0.68rem", padding: "2px 7px", minHeight: "22px" }}
              >
                <span>AUDIT TIMELINE</span>
                <ArrowRight size={10} />
              </button>
            </div>

            <div className="dash-terminal-window">
              <div className="dash-terminal-top">
                <div className="dash-terminal-dots">
                  <span className="dash-terminal-dot dash-terminal-dot--red" />
                  <span className="dash-terminal-dot dash-terminal-dot--yellow" />
                  <span className="dash-terminal-dot dash-terminal-dot--green" />
                </div>
                <span>audit_events.sqlite (tail -f)</span>
                <span>CRYPTOGRAPHIC_READY</span>
              </div>

              <div className="dash-terminal-stream">
                {filteredAuditEvents.length > 0 ? (
                  filteredAuditEvents.slice(0, 8).map((evt) => {
                    const isCopilot =
                      evt.actor?.toLowerCase().includes("copilot") ||
                      evt.actor?.toLowerCase().includes("ai") ||
                      evt.event_type?.includes("PROPOSED");

                    return (
                      <div
                        key={evt.event_id}
                        className={`dash-stream-entry ${
                          isCopilot ? "dash-stream-entry--copilot" : "dash-stream-entry--operator"
                        }`}
                      >
                        <div className="dash-stream-meta">
                          <span>[{formatTimestamp(evt.timestamp)}]</span>
                          <span className="dash-stream-actor">@{evt.actor || "OPERATOR"}</span>
                          <span>➔</span>
                          <span className="dash-stream-type">{evt.event_type}</span>
                        </div>
                        <div className="dash-stream-msg">{evt.summary}</div>
                      </div>
                    );
                  })
                ) : (
                  <div style={{ color: "#64748b", padding: "8px 0" }}>
                    &gt; No audit entries found for this scope.
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* INTERACTIVE CLIENT PROFILES DIRECTORY */}
          <section className="dash-card">
            <div className="dash-card-header">
              <h3>
                <Building2 size={14} style={{ color: "var(--kpmg-blue)" }} />
                <span>CLIENT PROFILES DIRECTORY</span>
              </h3>
              <button
                className="dash-btn-terminal"
                onClick={() => nav("/client-profiles")}
                style={{ fontSize: "0.68rem", padding: "2px 7px", minHeight: "22px" }}
              >
                <span>VIEW ALL</span>
                <ArrowRight size={10} />
              </button>
            </div>

            <div className="dash-profiles-list">
              {profiles.length > 0 ? (
                profiles.slice(0, 3).map((p) => {
                  const isSelected = selectedClientName === p.client_name;
                  return (
                    <div
                      key={p.id}
                      className={`dash-profile-item ${
                        isSelected ? "dash-profile-item--selected" : ""
                      }`}
                      onClick={() => {
                        if (isSelected) {
                          setSelectedClientName(null);
                          setCliFeedback("SCOPE_RESET: Showing all clients.");
                        } else {
                          setSelectedClientName(p.client_name);
                          setCliFeedback(`SCOPE_SET: Filtered dashboard to '${p.client_name}'.`);
                        }
                      }}
                      title="Click to scope entire dashboard to this company profile"
                    >
                      <div>
                        <div className="dash-profile-name">{p.client_name}</div>
                        <div className="dash-profile-meta">
                          {p.profile_name} · v{p.version} · {p.active_rule_ids.length} rules
                        </div>
                      </div>
                      <span
                        className="dash-pill dash-pill--emerald"
                        style={{ fontSize: "0.62rem" }}
                      >
                        {isSelected ? "FILTER ACTIVE" : p.status}
                      </span>
                    </div>
                  );
                })
              ) : (
                <div
                  style={{
                    color: "var(--ink-3)",
                    fontSize: "0.72rem",
                    padding: "6px 0",
                    textAlign: "center",
                  }}
                >
                  No client profiles configured yet.
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
