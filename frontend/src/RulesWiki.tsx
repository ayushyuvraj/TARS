import { useEffect, useState } from "react";
import {
  api,
  ExecutionStageInfo,
  RuleCatalogItem,
  RuleCatalogResponse,
  RuleCatalogSummary,
} from "./api";
import {
  Activity,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Code2,
  Database,
  FileCode2,
  Filter,
  Info,
  Layers,
  Lock,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  SlidersHorizontal,
} from "lucide-react";

type LibraryView = "table" | "pipeline";
type CategoryFilter = "ALL" | string;
type SecurityFilter = "ALL" | "CONFIGURABLE" | "LOCKED" | "LEARNED" | "POLICY";

export function RulesWiki() {
  const [data, setData] = useState<RuleCatalogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("ALL");
  const [securityFilter, setSecurityFilter] = useState<SecurityFilter>("ALL");
  const [activeTab, setActiveTab] = useState<LibraryView>("table");
  const [expandedRuleId, setExpandedRuleId] = useState<string | null>("R-001");
  const [showTechnicalConditions, setShowTechnicalConditions] = useState<Record<string, boolean>>({});

  const fetchCatalog = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.rulesCatalog();
      setData(res);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to load Rules Wiki catalog.",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchCatalog();
  }, []);

  const toggleTechnical = (ruleId: string) => {
    setShowTechnicalConditions((prev) => ({
      ...prev,
      [ruleId]: !prev[ruleId],
    }));
  };

  if (loading) {
    return (
      <div className="rules-wiki-loading" role="status">
        <Activity className="spin" size={24} />
        <span>Loading TARS Rules Wiki catalog from live system truth…</span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rules-wiki-error" role="alert">
        <ShieldAlert size={28} />
        <h2>Unable to load Rules Wiki</h2>
        <p>{error ?? "The backend rules catalog service could not be reached."}</p>
        <button className="button-secondary" onClick={() => void fetchCatalog()}>
          <RefreshCw size={15} /> Retry loading rules
        </button>
      </div>
    );
  }

  const { rules, summary, stages } = data;

  // Filter rules based on search query, category, and security filter
  const filteredRules = rules.filter((rule) => {
    const matchesSearch =
      !searchQuery.trim() ||
      rule.rule_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      rule.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      rule.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      rule.human_friendly_if.toLowerCase().includes(searchQuery.toLowerCase()) ||
      rule.human_friendly_then.toLowerCase().includes(searchQuery.toLowerCase()) ||
      rule.category.toLowerCase().includes(searchQuery.toLowerCase()) ||
      rule.stage.toLowerCase().includes(searchQuery.toLowerCase()) ||
      rule.source_of_truth.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesCategory =
      categoryFilter === "ALL" ||
      rule.category.toUpperCase() === categoryFilter.toUpperCase();

    let matchesSecurity = true;
    if (securityFilter === "CONFIGURABLE") {
      matchesSecurity = rule.configurable;
    } else if (securityFilter === "LOCKED") {
      matchesSecurity = rule.locked;
    } else if (securityFilter === "LEARNED") {
      matchesSecurity = rule.category === "LEARNED_RULE";
    } else if (securityFilter === "POLICY") {
      matchesSecurity = rule.source_of_truth === "POLICY_OBJECT";
    }

    return matchesSearch && matchesCategory && matchesSecurity;
  });

  const categories = [
    { key: "ALL", label: "All Categories" },
    { key: "MATCHING_RULE", label: "Matching" },
    { key: "TOLERANCE_POLICY_RULE", label: "Tolerance" },
    { key: "ELIGIBILITY_RULE", label: "Eligibility" },
    { key: "SCORING_RULE", label: "Scoring" },
    { key: "AMBIGUITY_SAFETY_RULE", label: "Safety & Ambiguity" },
    { key: "GOVERNANCE_RULE", label: "Governance" },
    { key: "LEARNED_RULE", label: "Learned" },
    { key: "DATA_SCHEMA_RULE", label: "Data & Schema" },
    { key: "EXCEPTION_CLASSIFICATION_RULE", label: "Exceptions" },
    { key: "WORKFLOW_SEQUENCING_RULE", label: "Sequencing" },
    { key: "EXPORT_OUTPUT_RULE", label: "Export & Output" },
  ];

  return (
    <div className="rules-wiki-container">
      {/* Header Bar */}
      <header className="rules-wiki-header">
        <div className="rules-wiki-header__title">
          <span className="eyebrow">Governed Rules Control Plane</span>
          <h1>TARS Rules Wiki</h1>
          <p>
            Authoritative, live control plane for TARS reconciliation logic,
            financial integrity guardrails, execution order, and learned patterns.
          </p>
        </div>
        <div className="rules-wiki-header__actions">
          <div className="action-with-badge">
            <button disabled className="button-secondary action-disabled">
              <Sparkles size={15} /> + Create Rule with AI
            </button>
            <span className="badge-coming-soon">Coming in Phase 2</span>
          </div>
          <div className="action-with-badge">
            <button disabled className="button-secondary action-disabled">
              <SlidersHorizontal size={15} /> Manage Execution Order
            </button>
            <span className="badge-coming-soon">Coming in Phase 2</span>
          </div>
        </div>
      </header>

      {/* Dynamic Summary KPI Tiles */}
      <section className="rules-summary-grid" aria-label="Rule Catalog Summary">
        <article className="summary-card">
          <span>Total Discovered Rules</span>
          <strong>{summary.total_rules}</strong>
          <small>100% indexed from system truth</small>
        </article>

        <article className="summary-card summary-card--configurable">
          <span>✓ Configurable Business Rules</span>
          <strong>{summary.configurable_count}</strong>
          <small>Safe to adjust per business policy</small>
        </article>

        <article className="summary-card summary-card--locked">
          <span>🔒 Locked System Guardrails</span>
          <strong>{summary.locked_count}</strong>
          <small>Required for financial integrity</small>
        </article>

        <article className="summary-card summary-card--active">
          <span>Active Pipeline Rules</span>
          <strong>{summary.active_count}</strong>
          <small>Currently executing in engine</small>
        </article>

        <article className="summary-card summary-card--learned">
          <span>Learned Decision Patterns</span>
          <strong>{summary.learned_count}</strong>
          <small>PROPOSE_ONLY human-learned rules</small>
        </article>
      </section>

      {/* Main Toolbar: Search & Filters & View Switcher */}
      <div className="rules-toolbar">
        <div className="rules-search-box">
          <Search size={17} />
          <input
            type="text"
            placeholder="Search by ID, rule name, condition, category, stage, or source..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              className="clear-search"
              onClick={() => setSearchQuery("")}
              aria-label="Clear search"
            >
              ×
            </button>
          )}
        </div>

        <div className="rules-view-tabs">
          <button
            className={activeTab === "table" ? "active" : ""}
            onClick={() => setActiveTab("table")}
          >
            <Layers size={15} /> Rules Library ({filteredRules.length})
          </button>
          <button
            className={activeTab === "pipeline" ? "active" : ""}
            onClick={() => setActiveTab("pipeline")}
          >
            <Code2 size={15} /> Reconciliation Execution Pipeline ({stages.length} Stages)
          </button>
        </div>
      </div>

      {/* Filter Pills */}
      {activeTab === "table" && (
        <div className="rules-filters-bar">
          <div className="filter-group">
            <span className="filter-label">Category:</span>
            <div className="filter-pills">
              {categories.map((c) => (
                <button
                  key={c.key}
                  className={categoryFilter === c.key ? "pill active" : "pill"}
                  onClick={() => setCategoryFilter(c.key)}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <div className="filter-group">
            <span className="filter-label">Governance Tier:</span>
            <div className="filter-pills">
              <button
                className={securityFilter === "ALL" ? "pill active" : "pill"}
                onClick={() => setSecurityFilter("ALL")}
              >
                All Rules
              </button>
              <button
                className={securityFilter === "CONFIGURABLE" ? "pill active pill--configurable" : "pill"}
                onClick={() => setSecurityFilter("CONFIGURABLE")}
              >
                ✓ Configurable
              </button>
              <button
                className={securityFilter === "LOCKED" ? "pill active pill--locked" : "pill"}
                onClick={() => setSecurityFilter("LOCKED")}
              >
                🔒 Locked Guardrails
              </button>
              <button
                className={securityFilter === "LEARNED" ? "pill active" : "pill"}
                onClick={() => setSecurityFilter("LEARNED")}
              >
                Learned Patterns
              </button>
              <button
                className={securityFilter === "POLICY" ? "pill active" : "pill"}
                onClick={() => setSecurityFilter("POLICY")}
              >
                Policy Controlled
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TAB 1: Rules Library Table View */}
      {activeTab === "table" && (
        <section className="rules-library-section">
          {filteredRules.length === 0 ? (
            <div className="rules-empty-search">
              <Info size={24} />
              <h3>No rules match your current filter</h3>
              <p>Try clearing your search query or adjusting the category filters.</p>
              <button
                className="button-secondary"
                onClick={() => {
                  setSearchQuery("");
                  setCategoryFilter("ALL");
                  setSecurityFilter("ALL");
                }}
              >
                Reset Filters
              </button>
            </div>
          ) : (
            <div className="rules-table-wrapper">
              <table className="rules-table">
                <thead>
                  <tr>
                    <th style={{ width: "160px" }}>Governance Tier</th>
                    <th style={{ width: "60px" }}>Order</th>
                    <th style={{ width: "110px" }}>Rule ID</th>
                    <th style={{ width: "220px" }}>Rule Name</th>
                    <th>Stage</th>
                    <th>Category</th>
                    <th>IF Condition</th>
                    <th>THEN Action</th>
                    <th style={{ width: "130px" }}>Authority</th>
                    <th style={{ width: "110px" }}>Source</th>
                    <th style={{ width: "60px" }}>Ver</th>
                    <th style={{ width: "40px" }}></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRules.map((rule) => {
                    const isExpanded = expandedRuleId === rule.rule_id;
                    const isTech = Boolean(showTechnicalConditions[rule.rule_id]);

                    return (
                      <tr
                        key={rule.rule_id}
                        className={`rule-row-item ${isExpanded ? "expanded" : ""} ${
                          rule.rule_id === "R-001" ? "hero-rule-row" : ""
                        }`}
                        onClick={() =>
                          setExpandedRuleId(isExpanded ? null : rule.rule_id)
                        }
                      >
                        {/* Governance Tier Badge */}
                        <td>
                          {rule.configurable ? (
                            <span className="tier-badge tier-badge--configurable" title="This rule is configurable per business policy">
                              ✓ Configurable
                            </span>
                          ) : (
                            <span
                              className="tier-badge tier-badge--locked"
                              title="This rule cannot be disabled because it protects reconciliation integrity."
                            >
                              <Lock size={12} /> Guardrail
                            </span>
                          )}
                        </td>

                        <td><code>{rule.execution_order}</code></td>
                        <td>
                          <span className={`rule-id-tag ${rule.rule_id.startsWith("R-") ? "hero-tag" : ""}`}>
                            {rule.rule_id}
                          </span>
                        </td>
                        <td>
                          <strong>{rule.name}</strong>
                          {rule.rule_id === "R-001" && (
                            <span className="hero-hero-badge">HERO RULE</span>
                          )}
                        </td>
                        <td><small>{rule.stage.replaceAll("_", " ")}</small></td>
                        <td><small className="category-pill">{rule.category.replaceAll("_", " ")}</small></td>
                        <td className="condition-cell">
                          <span>{isTech ? rule.if_condition : rule.human_friendly_if}</span>
                        </td>
                        <td className="action-cell">
                          <span>{isTech ? rule.then_result : rule.human_friendly_then}</span>
                        </td>
                        <td>
                          <span className={`authority-pill authority-pill--${rule.authority.toLowerCase()}`}>
                            {rule.authority.replaceAll("_", " ")}
                          </span>
                        </td>
                        <td>
                          <span className={`source-pill source-pill--${rule.source_of_truth.toLowerCase()}`}>
                            {rule.source_of_truth}
                          </span>
                        </td>
                        <td><code>v{rule.version}</code></td>
                        <td>
                          <button
                            className="expand-toggle-btn"
                            aria-label={`Toggle details for ${rule.rule_id}`}
                          >
                            {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* Accordion Rule Inspector Drawer */}
              {expandedRuleId && (
                <RuleInspectorDrawer
                  rule={rules.find((r) => r.rule_id === expandedRuleId)!}
                  isTech={Boolean(showTechnicalConditions[expandedRuleId])}
                  onToggleTech={() => toggleTechnical(expandedRuleId)}
                  onClose={() => setExpandedRuleId(null)}
                />
              )}
            </div>
          )}
        </section>
      )}

      {/* TAB 2: Reconciliation Execution Pipeline View */}
      {activeTab === "pipeline" && (
        <section className="pipeline-view-section">
          <header className="pipeline-heading">
            <Layers size={20} />
            <div>
              <h2>Reconciliation Execution Pipeline</h2>
              <p>
                The complete 13-stage execution pipeline sequence from workbook upload and schema mapping confirmation through matching engines, human review, governance, and KIGS export generation.
              </p>
            </div>
          </header>

          <div className="pipeline-stages-list">
            {stages.map((stage) => {
              const stageRules = rules.filter((r) => stage.rule_ids.includes(r.rule_id));
              const isFixed = stage.reorderability === "FIXED_ORDER";

              return (
                <div key={stage.stage_id} className="pipeline-stage-card">
                  <header className="pipeline-stage-header">
                    <div className="stage-title-wrap">
                      <span className="stage-order-badge">{stage.execution_order}</span>
                      <div>
                        <h3>{stage.stage_name}</h3>
                        <p>{stage.description}</p>
                      </div>
                    </div>
                    <div className="stage-reorder-badge">
                      {isFixed ? (
                        <span className="badge-fixed" title="Macro stage order is dependency-controlled and cannot be altered.">
                          <Lock size={13} /> Fixed stage order
                        </span>
                      ) : (
                        <span className="badge-reorderable" title="Ordering within this stage may be configurable in future.">
                          ↕ Order within stage
                        </span>
                      )}
                    </div>
                  </header>

                  <div className="pipeline-stage-body">
                    {stageRules.length === 0 ? (
                      <p className="no-stage-rules">
                        <em>Human decision & policy confirmation gate (no automated rules executed in background).</em>
                      </p>
                    ) : (
                      <div className="stage-rules-grid">
                        {stageRules.map((rule) => (
                          <article key={rule.rule_id} className="stage-rule-item">
                            <div className="stage-rule-head">
                              <span className="rule-id-tag">{rule.rule_id}</span>
                              <strong>{rule.name}</strong>
                              <span className={`authority-pill authority-pill--${rule.authority.toLowerCase()}`}>
                                {rule.authority.replaceAll("_", " ")}
                              </span>
                            </div>
                            <p>{rule.human_friendly_if}</p>
                            <small className="stage-rule-location">
                              Source: {rule.source_of_truth} · {rule.file_function_db_location}
                            </small>
                          </article>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

{/* Detailed Rule Inspector Component */}
function RuleInspectorDrawer({
  rule,
  isTech,
  onToggleTech,
  onClose,
}: {
  rule: RuleCatalogItem;
  isTech: boolean;
  onToggleTech: () => void;
  onClose: () => void;
}) {
  return (
    <div className="rule-inspector-panel">
      <header className="inspector-header">
        <div>
          <span className="eyebrow">Rule Inspector</span>
          <h2>
            <code>{rule.rule_id}</code> — {rule.name}
          </h2>
          <small>{rule.description}</small>
        </div>
        <div className="inspector-header-meta">
          <span className={`status-pill status-pill--${rule.status.toLowerCase()}`}>
            Status: {rule.status}
          </span>
          <span className="version-pill">Version {rule.version}</span>
          <button className="button-secondary close-inspector" onClick={onClose}>
            Done
          </button>
        </div>
      </header>

      {/* Hero Rule persisted details for R-001 or R-002 */}
      {(rule.rule_id === "R-001" || rule.rule_id === "R-002") && (
        <div className="hero-persisted-banner">
          <div className="hero-banner-head">
            <ShieldCheck size={18} />
            <strong>Authoritative Persisted Database Truth ({rule.rule_id})</strong>
          </div>
          <p>
            Loaded dynamically from SQLite table <code>reusable_rules</code> and <code>rule_versions</code> at runtime.
          </p>
          <div className="hero-banner-grid">
            <div>
              <small>Status</small>
              <strong>{rule.status}</strong>
            </div>
            <div>
              <small>Action Authority</small>
              <strong>{rule.authority}</strong>
            </div>
            <div>
              <small>Automatic Reconciliations</small>
              <strong>0 (Mandatory Guardrail)</strong>
            </div>
            <div>
              <small>Approved By</small>
              <strong>{rule.approval?.approved_by ?? "Pending Approval (Draft)"}</strong>
            </div>
            <div>
              <small>Evidence Base</small>
              <strong>{rule.provenance?.decision_count ?? 0} Human Decisions</strong>
            </div>
          </div>
        </div>
      )}

      <div className="inspector-grid">
        {/* Left Column: Logic & Conditions */}
        <div className="inspector-card">
          <div className="inspector-card-title">
            <FileCode2 size={16} />
            <span>RULE LOGIC & EXPRESSIONS</span>
            <button className="toggle-tech-link" onClick={onToggleTech}>
              {isTech ? "Show Human Language" : "View Technical Definition"}
            </button>
          </div>

          <div className="rule-clause">
            <span className="clause-label">IF (Condition):</span>
            <p className="clause-body">
              {isTech ? (
                <code>{rule.if_condition}</code>
              ) : (
                rule.human_friendly_if
              )}
            </p>
          </div>

          <div className="rule-clause">
            <span className="clause-label">THEN (Action):</span>
            <p className="clause-body">
              {isTech ? (
                <code>{rule.then_result}</code>
              ) : (
                rule.human_friendly_then
              )}
            </p>
          </div>

          {rule.parameters !== null && rule.parameters !== undefined && (
            <div className="rule-clause">
              <span className="clause-label">PARAMETERS & THRESHOLDS:</span>
              <p className="clause-body">
                <code>{typeof rule.parameters === "object" ? JSON.stringify(rule.parameters, null, 2) : String(rule.parameters)}</code>
              </p>
            </div>
          )}
        </div>

        {/* Right Column: Metadata & Governance */}
        <div className="inspector-card">
          <div className="inspector-card-title">
            <ShieldCheck size={16} />
            <span>GOVERNANCE & SOURCE OF TRUTH</span>
          </div>

          <dl className="inspector-meta-list">
            <div>
              <dt>Execution Stage</dt>
              <dd>Stage {rule.execution_order} · {rule.stage.replaceAll("_", " ")}</dd>
            </div>
            <div>
              <dt>Action Authority</dt>
              <dd>
                <strong>{rule.authority}</strong>
                {rule.authority === "PROPOSE_ONLY" && (
                  <p className="authority-warning-note">
                    Cannot automatically reconcile records. Generates proposals for human review.
                  </p>
                )}
              </dd>
            </div>
            <div>
              <dt>Source of Truth</dt>
              <dd>{rule.source_of_truth}</dd>
            </div>
            <div>
              <dt>Code / Database Location</dt>
              <dd><code>{rule.file_function_db_location}</code></dd>
            </div>
            <div>
              <dt>Can User Disable?</dt>
              <dd>
                {rule.configurable ? (
                  <span className="text-good">✓ Yes (Configurable Business Rule)</span>
                ) : (
                  <span className="text-warn">🔒 No — Required for financial integrity ({rule.toggle_safety.replaceAll("_", " ")})</span>
                )}
              </dd>
            </div>
            <div>
              <dt>Can User Reorder?</dt>
              <dd>
                {rule.execution_sequencing === "ORDER_WITHIN_STAGE" ? (
                  <span>Yes (Positionable within Stage execution order)</span>
                ) : (
                  <span>No (Macro stage sequence is dependency-fixed)</span>
                )}
              </dd>
            </div>
          </dl>

          {rule.dependencies.length > 0 && (
            <div className="rule-dependencies-wrap">
              <strong>Prerequisite Dependencies:</strong>
              <ul>
                {rule.dependencies.map((dep, idx) => (
                  <li key={idx}>{dep}</li>
                ))}
              </ul>
            </div>
          )}

          {rule.provenance && (
            <div className="rule-provenance-wrap">
              <strong>Why This Rule Exists:</strong>
              <p>{rule.provenance.summary}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
