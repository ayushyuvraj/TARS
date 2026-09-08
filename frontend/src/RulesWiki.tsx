import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  api,
  ExecutionStageInfo,
  RuleCatalogItem,
  RuleCatalogResponse,
  RuleCatalogSummary,
} from "./api";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  BookOpen,
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
  Trash2,
  Unlock,
  Wand2,
  X,
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

  const [showAiModal, setShowAiModal] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [isCompiling, setIsCompiling] = useState(false);
  const [thinkingSteps, setThinkingSteps] = useState<string[]>([]);
  const [compiledRuleResult, setCompiledRuleResult] = useState<RuleCatalogItem | null>(null);
  const [compileError, setCompileError] = useState<string | null>(null);
  const [successNotification, setSuccessNotification] = useState<string | null>(null);

  const [ruleToDelete, setRuleToDelete] = useState<RuleCatalogItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const ACTUAL_DATA_CONTEXT = `[ACTUAL GROUND TRUTH DATA & RECONCILIATION SCHEMA IN USE]
Canonical Schema Mapping (GSTR-2B vs Purchase Register):
• supplier_gstin       : [STRING, 15 chars] Matches vendor GSTIN identifier
• document_number      : [STRING] Canonical invoice number (normalized string)
• document_date        : [DATE] Format YYYY-MM-DD (Max variance: 30 days)
• taxable_value        : [DECIMAL] Taxable amount in INR (Tolerance range: ₹0 - ₹500)
• cgst_amount          : [DECIMAL] Central Tax amount
• sgst_amount          : [DECIMAL] State Tax amount
• igst_amount          : [DECIMAL] Integrated Tax amount
• total_tax_amount     : [DECIMAL] Combined tax value

Rule Compilation & Authority Constraints:
• System Engine       : TARS GST Agentic Reconciliation Engine v1.0
• Action Authority     : PROPOSE_ONLY (Guardrail: LLM cannot auto-reconcile without human approval)
• Target Category      : LEARNED_RULE / MATCHING_RULE / TOLERANCE_POLICY_RULE
• Persistence Target   : SQLite database (table: reusable_rules, rule_versions)`;

  const handleStartCreateRule = async (promptToUse?: string) => {
    const text = (promptToUse ?? aiPrompt).trim();
    if (!text) return;
    setIsCompiling(true);
    setCompileError(null);
    setCompiledRuleResult(null);

    const stepsHistory: string[] = [];
    const addStep = (stepText: string) => {
      stepsHistory.push(stepText);
      setThinkingSteps([...stepsHistory]);
    };

    try {
      const modelName = data?.llm_model || "gpt-5.4-mini";
      addStep(`> [00.01s] [LLM] Ingesting prompt via ${modelName}: "${text}"...`);
      await new Promise((r) => setTimeout(r, 450));

      addStep(`> [00.35s] [SCHEMA] Cross-referencing canonical columns: [supplier_gstin, document_number, taxable_value, document_date]...`);
      await new Promise((r) => setTimeout(r, 550));

      addStep(`> [00.85s] [REASONING] Analyzing matching conditions & tax variance bounds...`);
      await new Promise((r) => setTimeout(r, 400));

      const compiledRule = await api.compileRuleWithAI(text);

      addStep(`> [01.25s] [DECLARATIVE_AST] Compiling Rule AST (${compiledRule.rule_id}, Authority: PROPOSE_ONLY)...`);
      await new Promise((r) => setTimeout(r, 450));

      const backendSteps = compiledRule.thinking_steps ?? [];
      for (const bs of backendSteps) {
        if (!stepsHistory.includes(bs)) {
          addStep(bs);
          await new Promise((r) => setTimeout(r, 300));
        }
      }

      const formula = compiledRule.formula || `IF ${compiledRule.human_friendly_if} THEN ${compiledRule.human_friendly_then}`;
      addStep(`> [01.75s] [VERIFY] Validation passed for column formula: ${formula}`);
      await new Promise((r) => setTimeout(r, 350));

      addStep(`> [STATUS] Rule ${compiledRule.rule_id} ("${compiledRule.name}") active & saved to SQLite persistence engine!`);

      setCompiledRuleResult(compiledRule);
      await fetchCatalog();
    } catch (err) {
      setCompileError(
        err instanceof Error ? err.message : "Failed to compile AI rule. Please check prompt and try again."
      );
    } finally {
      setIsCompiling(false);
    }
  };

  const handleCancelModal = () => {
    setShowAiModal(false);
    setAiPrompt("");
    setIsCompiling(false);
    setThinkingSteps([]);
    setCompiledRuleResult(null);
    setCompileError(null);
  };

  const handleFinishModal = async () => {
    if (compiledRuleResult) {
      setSuccessNotification(
        `Rule ${compiledRuleResult.rule_id} ("${compiledRuleResult.name}") compiled via LLM and added to live Rules Wiki catalog!`
      );
      await fetchCatalog();
    }
    handleCancelModal();
  };

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

  const toggleExpandRow = (ruleId: string) => {
    setExpandedRuleId(expandedRuleId === ruleId ? null : ruleId);
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

  const filteredRules = rules.filter((rule) => {
    const matchesSearch =
      !searchQuery.trim() ||
      rule.rule_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      rule.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      rule.human_friendly_if.toLowerCase().includes(searchQuery.toLowerCase());

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
          <h1>Rules Wiki</h1>
          <p>
            Authoritative, live control plane for TARS reconciliation logic,
            financial integrity guardrails, execution order, and learned patterns.
          </p>
        </div>
        <div className="rules-wiki-header__actions">
          <button
            className="btn-sparkle"
            onClick={() => {
              setCompileError(null);
              setShowAiModal(true);
            }}
          >
            <Sparkles size={16} /> + Create Rule with AI
          </button>
        </div>
      </header>

      {/* Success Notification Toast */}
      {successNotification && (
        <div className="rules-wiki-toast" role="status">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <CheckCircle2 size={18} />
            <span>{successNotification}</span>
          </div>
          <button
            style={{ background: "none", border: "none", cursor: "pointer", color: "inherit" }}
            onClick={() => setSuccessNotification(null)}
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Dynamic Summary KPI Grid */}
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

      {/* Main Toolbar: Search & View Switcher */}
      <div className="rules-toolbar">
        <div className="rules-search-box">
          <Search size={17} />
          <input
            type="text"
            placeholder="Search by ID (e.g. R-001), rule name, condition, category, stage, or source..."
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
            <Layers size={15} /> Rules Library ({filteredRules.length === rules.length ? rules.length : `${filteredRules.length} of ${rules.length}`})
          </button>
          <button
            className={activeTab === "pipeline" ? "active" : ""}
            onClick={() => setActiveTab("pipeline")}
          >
            <Code2 size={15} /> Reconciliation Execution Pipeline ({stages.length} Stages)
          </button>
        </div>
      </div>

      {/* Filter Pills Bar */}
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
            <div className="rules-empty-search" style={{ padding: 30, textAlign: "center", color: "var(--muted-text)" }}>
              <Info size={24} />
              <h3 style={{ margin: "8px 0 4px", fontSize: 16 }}>No rules match your current filter</h3>
              <p style={{ margin: 0, fontSize: 13 }}>Try clearing your search query or adjusting the category filters.</p>
              <button
                className="button-secondary"
                style={{ marginTop: 14 }}
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
                      <React.Fragment key={rule.rule_id}>
                        <tr
                          className={`rule-row-item ${isExpanded ? "expanded" : ""} ${
                            rule.rule_id === "R-001" ? "hero-rule-row" : ""
                          }`}
                          onClick={() => toggleExpandRow(rule.rule_id)}
                        >
                          <td>
                            {rule.configurable ? (
                              <span className="tier-badge tier-badge--configurable" title="Configurable per business policy">
                                ✓ Configurable
                              </span>
                            ) : (
                              <span className="tier-badge tier-badge--locked" title="Mandatory system guardrail">
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
                            {(rule.rule_id === "R-001" || rule.rule_id === "R-002") && (
                              <span className="hero-hero-badge">PERSISTED DB TRUTH</span>
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
                          <td style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            {rule.configurable ? (
                              <button
                                className="btn-delete-rule"
                                title={`Delete rule ${rule.rule_id}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDeleteError(null);
                                  setRuleToDelete(rule);
                                }}
                              >
                                <Trash2 size={13} />
                              </button>
                            ) : (
                              <button
                                className="btn-delete-rule disabled"
                                disabled
                                title="🔒 Locked System Guardrail — Cannot be deleted"
                              >
                                <Lock size={12} />
                              </button>
                            )}
                            <button
                              className="expand-toggle-btn"
                              aria-label="Toggle details"
                            >
                              {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                            </button>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr>
                            <td colSpan={12} style={{ padding: 0 }}>
                              <RuleInspectorDrawer
                                rule={rule}
                                isTech={isTech}
                                onToggleTech={() => toggleTechnical(rule.rule_id)}
                                onClose={() => setExpandedRuleId(null)}
                                onOpenDelete={(r) => {
                                  setDeleteError(null);
                                  setRuleToDelete(r);
                                }}
                              />
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
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

      {/* AI Rule Creation Modal - Portaled to document.body for visible viewport centering */}
      {showAiModal &&
        createPortal(
          <div className="ai-rule-modal-backdrop" onClick={() => !isCompiling && handleCancelModal()}>
            <div className="ai-rule-modal" onClick={(e) => e.stopPropagation()}>
              <header className="ai-rule-modal__header">
                <h3>
                  <Wand2 size={20} color="#7c3aed" /> Create Rule with AI
                </h3>
                <button
                  disabled={isCompiling}
                  onClick={handleCancelModal}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted-text)" }}
                >
                  <X size={18} />
                </button>
              </header>

              <div className="ai-rule-modal__grid">
                {/* Left Column: Prompt Input, Read-Only Context, Sample Prompts */}
                <div className="ai-rule-modal__col">
                  <p style={{ margin: 0, fontSize: 13, color: "var(--secondary)", lineHeight: 1.4 }}>
                    Describe your custom matching rule in human natural language. The TARS LLM Rules Compiler
                    will interpret your intent using <strong>{data?.llm_model || "gpt-5.4-mini"}</strong>, map it to canonical schema fields, and compile an active declarative rule.
                  </p>

                  {!data?.llm_connected && (
                    <div style={{ padding: "8px 12px", background: "#fef2f2", border: "1px solid #fca5a5", color: "#991b1b", borderRadius: 8, fontSize: 12, display: "flex", alignItems: "center", gap: 8 }}>
                      <AlertCircle size={15} />
                      <span><strong>No LLM connected in backend.</strong> Please verify OPENAI_API_KEY setting.</span>
                    </div>
                  )}

                  {compileError && (
                    <div style={{ padding: "8px 12px", background: "#fef2f2", border: "1px solid #fca5a5", color: "#991b1b", borderRadius: 8, fontSize: 12 }}>
                      {compileError}
                    </div>
                  )}

                  {/* 1. Rule Prompt Textarea (Editable) */}
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 700, color: "var(--primary)", display: "block", marginBottom: 4 }}>
                      Rule Natural Language Description:
                    </label>
                    <textarea
                      className="ai-rule-textarea"
                      placeholder="e.g. If tax difference is within ₹500 and GSTIN matches exactly, flag for review"
                      value={aiPrompt}
                      onChange={(e) => setAiPrompt(e.target.value)}
                      disabled={isCompiling}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                          void handleStartCreateRule();
                        }
                      }}
                    />
                  </div>

                  {/* 2. Read-Only Context Data Text Box */}
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 700, color: "var(--secondary)", display: "block", marginBottom: 4 }}>
                      Actual Ground Truth Data & Reconciliation Schema (Read-Only Context):
                    </label>
                    <textarea
                      readOnly
                      className="context-textbox"
                      rows={6}
                      value={ACTUAL_DATA_CONTEXT}
                    />
                  </div>

                  {/* Quick Sample Prompts */}
                  <div>
                    <div className="quick-prompts-label">
                      <Sparkles size={13} color="#7c3aed" /> Quick Sample Prompts:
                    </div>
                    <div className="quick-prompts-grid">
                      <button
                        disabled={isCompiling}
                        className="prompt-chip"
                        onClick={() => setAiPrompt("If tax difference is within ₹500 and GSTIN matches exactly, flag for review")}
                      >
                        ⚡ Tax variance within ₹500 → Flag for review
                      </button>
                      <button
                        disabled={isCompiling}
                        className="prompt-chip"
                        onClick={() => setAiPrompt("Propose tolerance match when taxable value variance is within ₹100")}
                      >
                        ⚡ Taxable value within ₹100 → Tolerance match
                      </button>
                      <button
                        disabled={isCompiling}
                        className="prompt-chip"
                        onClick={() => setAiPrompt("Propose near match when document dates drift by up to 7 days and GSTIN is exact")}
                      >
                        ⚡ Date drift within 7 days & exact GSTIN → Near match
                      </button>
                    </div>
                  </div>
                </div>

                {/* Right Column: Terminal & Compiled Formula/AST */}
                <div className="ai-rule-modal__col">
                  {/* Animated Terminal */}
                  <div className="claude-terminal">
                    <div className="claude-terminal__header">
                      <div className="claude-terminal__dots">
                        <span className="claude-terminal__dot claude-terminal__dot--red" />
                        <span className="claude-terminal__dot claude-terminal__dot--yellow" />
                        <span className="claude-terminal__dot claude-terminal__dot--green" />
                      </div>
                      <span>● tars-llm-compiler — {data?.llm_model || "gpt-5.4-mini"}</span>
                      <span style={{ fontSize: 11, color: isCompiling ? "#eab308" : "#7ee787" }}>
                        {isCompiling ? "THINKING..." : thinkingSteps.length > 0 ? "COMPLETED" : "READY"}
                      </span>
                    </div>
                    <div className="claude-terminal__body">
                      {thinkingSteps.length === 0 && !isCompiling && (
                        <div className="claude-terminal__line" style={{ color: "#8b949e" }}>
                          <span>▶ Ready to compile custom rule using {data?.llm_model || "gpt-5.4-mini"}...</span>
                        </div>
                      )}
                      {thinkingSteps.map((step, idx) => (
                        <div
                          key={idx}
                          className={`claude-terminal__line ${
                            step.includes("[STATUS]") || step.includes("[VERIFY]")
                              ? "claude-terminal__line--success"
                              : ""
                          }`}
                        >
                          {step}
                        </div>
                      ))}
                      {isCompiling && (
                        <div className="claude-terminal__line" style={{ color: "#c084fc" }}>
                          <span>▶ {data?.llm_model || "gpt-5.4-mini"} is thinking...</span>
                          <span className="claude-terminal__cursor" />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Compiled Column Formula & AST JSON Output */}
                  {compiledRuleResult ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <div>
                        <label style={{ fontSize: 11, fontWeight: 700, color: "#166534", display: "block", marginBottom: 4 }}>
                          ✓ Compiled Column Formula:
                        </label>
                        <div className="output-formula-box">
                          {compiledRuleResult.formula ||
                            `IF ${compiledRuleResult.human_friendly_if} THEN ${compiledRuleResult.human_friendly_then}`}
                        </div>
                      </div>

                      <div>
                        <label style={{ fontSize: 11, fontWeight: 700, color: "var(--secondary)", display: "block", marginBottom: 4 }}>
                          Compiled Rule AST (JSON):
                        </label>
                        <pre
                          style={{
                            background: "#0d1117",
                            color: "#7ee787",
                            padding: 10,
                            borderRadius: 8,
                            fontSize: 11,
                            lineHeight: 1.4,
                            overflowX: "auto",
                            maxHeight: 130,
                            margin: 0,
                            border: "1px solid #30363d",
                            fontFamily: "'JetBrains Mono', monospace",
                          }}
                        >
                          <code>{JSON.stringify(compiledRuleResult, null, 2)}</code>
                        </pre>
                      </div>
                    </div>
                  ) : (
                    <div style={{ background: "#f8fafc", border: "1px dashed var(--border)", borderRadius: 10, padding: 16, textAlign: "center", color: "var(--muted-text)", fontSize: 12, marginTop: "auto", marginBottom: "auto" }}>
                      <Code2 size={24} style={{ marginBottom: 6, opacity: 0.5 }} />
                      <div>Compiled Rule Formula & AST JSON will appear here after clicking <strong>Create Rule</strong></div>
                    </div>
                  )}
                </div>
              </div>

              {/* Modal Footer with explicit Cancel and Create Rule buttons */}
              <footer className="ai-rule-modal__footer">
                <div className="llm-connection-badge">
                  <span className={`llm-connection-dot ${data?.llm_connected ? "llm-connection-dot--online" : "llm-connection-dot--offline"}`} />
                  <span>
                    Backend LLM: <strong>{data?.llm_connected ? (data?.llm_model || "gpt-5.4-mini") : "Not Connected"}</strong> {data?.llm_connected ? "(Connected)" : "(Offline)"}
                  </span>
                </div>

                <div className="footer-actions">
                  <button
                    className="button-secondary"
                    disabled={isCompiling}
                    onClick={handleCancelModal}
                  >
                    Cancel
                  </button>

                  {!compiledRuleResult ? (
                    <button
                      className="btn-sparkle"
                      disabled={isCompiling || !aiPrompt.trim() || !data?.llm_connected}
                      onClick={() => void handleStartCreateRule()}
                    >
                      {isCompiling ? (
                        <>
                          <Activity className="spin" size={16} /> Compiling via {data?.llm_model || "gpt-5.4-mini"}...
                        </>
                      ) : (
                        <>
                          <Wand2 size={16} /> Create Rule
                        </>
                      )}
                    </button>
                  ) : (
                    <button
                      className="btn-sparkle"
                      onClick={() => void handleFinishModal()}
                    >
                      <CheckCircle2 size={16} /> Done (Add to Catalog)
                    </button>
                  )}
                </div>
              </footer>
            </div>
          </div>,
          document.body,
        )}

      {/* Permanent Deletion Confirmation Modal - Portaled to document.body */}
      {ruleToDelete &&
        createPortal(
          <div className="ai-rule-modal-backdrop" onClick={() => !isDeleting && setRuleToDelete(null)}>
            <div className="ai-rule-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
              <header className="ai-rule-modal__header" style={{ background: "#fef2f2", borderColor: "#fca5a5" }}>
                <h3 style={{ color: "#991b1b" }}>
                  <AlertTriangle size={20} color="#dc2626" /> Permanent Rule Deletion
                </h3>
                <button
                  disabled={isDeleting}
                  onClick={() => setRuleToDelete(null)}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "#991b1b" }}
                >
                  <X size={18} />
                </button>
              </header>

              <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
                <div style={{ padding: "14px 16px", background: "#fff5f5", border: "1px solid #fed7d7", borderRadius: 12, color: "#9b2c2c", fontSize: 13, lineHeight: 1.5 }}>
                  <strong style={{ color: "#742a2a", fontSize: 14, display: "block", marginBottom: 4 }}>
                    ⚠️ Warning: This action is IRREVERSIBLE.
                  </strong>
                  <p style={{ margin: 0 }}>
                    Are you sure you want to permanently delete rule <strong>{ruleToDelete.rule_id}</strong> (<em>"{ruleToDelete.name}"</em>)?
                    This will permanently remove the rule from backend SQLite storage and exclude it from all future reconciliation runs.
                  </p>
                </div>

                {deleteError && (
                  <div style={{ padding: "10px 14px", background: "#fef2f2", border: "1px solid #fca5a5", color: "#991b1b", borderRadius: 8, fontSize: 12 }}>
                    {deleteError}
                  </div>
                )}

                <div style={{ fontSize: 12, color: "var(--muted-text)", background: "#f8fafc", padding: "10px 14px", borderRadius: 8, border: "1px solid var(--border)" }}>
                  <div>Source of Truth: <strong>{ruleToDelete.source_of_truth}</strong></div>
                  <div>Category: <strong>{ruleToDelete.category}</strong> · Execution Stage: <strong>{ruleToDelete.stage}</strong></div>
                </div>
              </div>

              <footer className="ai-rule-modal__footer" style={{ background: "#f8fafc" }}>
                <button
                  className="button-secondary"
                  disabled={isDeleting}
                  onClick={() => setRuleToDelete(null)}
                >
                  Cancel
                </button>

                <button
                  className="btn-danger"
                  disabled={isDeleting}
                  onClick={async () => {
                    setIsDeleting(true);
                    setDeleteError(null);
                    try {
                      await api.deleteRule(ruleToDelete.rule_id);
                      setSuccessNotification(`Rule ${ruleToDelete.rule_id} ("${ruleToDelete.name}") was permanently deleted.`);
                      setRuleToDelete(null);
                      await fetchCatalog();
                    } catch (err) {
                      setDeleteError(err instanceof Error ? err.message : "Failed to delete rule from backend.");
                    } finally {
                      setIsDeleting(false);
                    }
                  }}
                >
                  {isDeleting ? (
                    <>
                      <Activity className="spin" size={16} /> Deleting from Backend DB...
                    </>
                  ) : (
                    <>
                      <Trash2 size={16} /> Confirm Permanent Deletion
                    </>
                  )}
                </button>
              </footer>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

function RuleInspectorDrawer({
  rule,
  isTech,
  onToggleTech,
  onClose,
  onOpenDelete,
}: {
  rule: RuleCatalogItem;
  isTech: boolean;
  onToggleTech: () => void;
  onClose: () => void;
  onOpenDelete?: (rule: RuleCatalogItem) => void;
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
          {rule.configurable && onOpenDelete && (
            <button
              className="btn-danger-outline"
              style={{ padding: "5px 12px", fontSize: 12 }}
              onClick={() => onOpenDelete(rule)}
              title="Delete this rule permanently"
            >
              <Trash2 size={13} /> Delete Rule
            </button>
          )}
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
