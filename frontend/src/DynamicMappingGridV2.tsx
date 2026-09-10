import React, { useState, useMemo } from "react";
import { DirectColumnCorrelation, AgentThought } from "./api_v2";
import { SearchableColumnSelect } from "./SearchableColumnSelect";
import { MappingInspectorDrawer } from "./MappingInspectorDrawer";
import { AgentThinkingConsole } from "./AgentThinkingConsole";
import {
  CheckCircle2,
  Sparkles,
  AlertTriangle,
  Search,
  ArrowRight,
  ShieldCheck,
  Edit3,
  X,
  SlidersHorizontal,
  FileSpreadsheet,
  ArrowLeft,
  Check
} from "lucide-react";
import { ReconciliationV2ActionBar } from "./ReconciliationV2ActionBar";

interface DynamicMappingGridV2Props {
  correlations: DirectColumnCorrelation[];
  prColumns: string[];
  gstrFileName?: string;
  prFileName?: string;
  agentThoughts?: AgentThought[];
  totalDurationMs?: number;
  isConfirmed?: boolean;
  disabled?: boolean;
  onChange: (updated: DirectColumnCorrelation[]) => void;
  onConfirmMapping?: () => void;
  onBackToSetup?: () => void;
}

export const DynamicMappingGridV2: React.FC<DynamicMappingGridV2Props> = ({
  correlations = [],
  prColumns = [],
  gstrFileName = "Government GSTR-2B.xlsx",
  prFileName = "Purchase Register ERP.xlsx",
  agentThoughts = [],
  totalDurationMs,
  isConfirmed = false,
  disabled = false,
  onChange,
  onConfirmMapping,
  onBackToSetup,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<"all" | "deterministic" | "llm" | "attention" | "unmapped">("all");
  const [inspectedCorrelation, setInspectedCorrelation] = useState<DirectColumnCorrelation | null>(null);

  const handlePrColumnChange = (gstrColName: string, newPrCol: string | null) => {
    const updated = correlations.map((c) => {
      if (c.gstr_column === gstrColName) {
        return {
          ...c,
          selected_pr_column: newPrCol || null,
          user_edited: true,
          confidence: newPrCol ? 1.0 : 0.0,
          reason: newPrCol
            ? `User manually selected '${newPrCol}'.`
            : "User marked this column as unmapped."
        };
      }
      return c;
    });
    onChange(updated);

    if (inspectedCorrelation && inspectedCorrelation.gstr_column === gstrColName) {
      setInspectedCorrelation(updated.find((c) => c.gstr_column === gstrColName) || null);
    }
  };

  const filteredCorrelations = useMemo(() => {
    return correlations.filter((item) => {
      if (filterType === "deterministic" && item.engine !== "deterministic") return false;
      if (filterType === "llm" && !item.engine.startsWith("llm") && item.engine !== "agent_ai") return false;
      if (filterType === "attention" && item.confidence >= 0.80 && item.selected_pr_column !== null) return false;
      if (filterType === "unmapped" && item.selected_pr_column !== null) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const gstrMatch = item.gstr_column.toLowerCase().includes(q);
        const prMatch = (item.selected_pr_column || "").toLowerCase().includes(q);
        const reasonMatch = (item.reason || "").toLowerCase().includes(q);
        const sampleMatch = (item.gstr_samples || []).some((s) => s.toLowerCase().includes(q));
        return gstrMatch || prMatch || reasonMatch || sampleMatch;
      }
      return true;
    });
  }, [correlations, filterType, searchQuery]);

  const stats = useMemo(() => {
    const total = correlations.length;
    const mapped = correlations.filter((c) => !!c.selected_pr_column).length;
    const deterministic = correlations.filter((c) => c.engine === "deterministic").length;
    const llm = correlations.filter((c) => c.engine.startsWith("llm") || c.engine === "agent_ai").length;
    const attention = correlations.filter((c) => c.confidence < 0.80 || !c.selected_pr_column).length;
    const unmapped = correlations.filter((c) => !c.selected_pr_column).length;
    return { total, mapped, deterministic, llm, attention, unmapped };
  }, [correlations]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* 1. TOP FLIGHT CONTROL HEADER BAR */}
      <div className="v2-mapping-action-header">
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {onBackToSetup && (
            <button
              type="button"
              onClick={onBackToSetup}
              className="v2-btn-back"
              title="Return to Ingestion Setup"
            >
              <ArrowLeft size={14} />
              <span>Back</span>
            </button>
          )}

          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="v2-stage-kicker">STAGE 2 OF 8</span>
              <span className="v2-status-chip green">
                <Check size={11} />
                Schema Correlation Active
              </span>
            </div>
            <h2 className="v2-mapping-head-title">Direct Schema Coupling Matrix</h2>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div className="v2-file-badge-pill">
            <FileSpreadsheet size={13} style={{ color: "#0091da" }} />
            <span>{gstrFileName}</span>
            <span style={{ color: "#94a3b8" }}>⟷</span>
            <FileSpreadsheet size={13} style={{ color: "#6d2077" }} />
            <span>{prFileName}</span>
          </div>

          {onConfirmMapping && (
            <button
              type="button"
              disabled={disabled || isConfirmed}
              onClick={onConfirmMapping}
              className="v2-btn-confirm-mapping"
            >
              <span>{isConfirmed ? "Mapping Confirmed" : "Confirm Schema & Proceed"}</span>
              <ArrowRight size={15} />
            </button>
          )}
        </div>
      </div>

      {/* Top Stage Action Bar */}
      <ReconciliationV2ActionBar
        position="top"
        stageNumber={2}
        backLabel="Back to Ingestion Setup"
        onBack={onBackToSetup}
        nextLabel={isConfirmed ? "Mapping Confirmed" : "Confirm Schema & Proceed"}
        onNext={onConfirmMapping}
        nextDisabled={disabled || isConfirmed}
      />

      {/* 2. AGENT OBSERVABLE TELEMETRY CONSOLE */}
      {agentThoughts && agentThoughts.length > 0 && (
        <AgentThinkingConsole
          thoughts={agentThoughts}
          modelUsed="Autonomous AgentAI"
          totalDurationMs={totalDurationMs}
        />
      )}

      {/* 3. MAIN INTERACTIVE N x M SCHEMA STREAM CARD */}
      <div className="v2-grid-card">
        {/* Toolbar & KPI bar */}
        <div className="v2-grid-toolbar">
          <div className="v2-toolbar-header">
            <div>
              <h3 className="v2-toolbar-title">
                <span>Direct Field Linkages</span>
                <span className="v2-linkage-rate-badge">
                  {stats.mapped} / {stats.total} Linked ({((stats.mapped / Math.max(1, stats.total)) * 100).toFixed(0)}%)
                </span>
              </h3>
              <p className="v2-toolbar-desc">
                Review and calibrate field associations between your GSTR-2B extract and Purchase Register.
              </p>
            </div>

            {/* Search Box */}
            <div className="v2-search-box">
              <Search size={14} className="v2-search-icon" />
              <input
                type="text"
                className="v2-search-input"
                placeholder="Search column names, sample values..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery("")} className="v2-search-clear">
                  <X size={13} />
                </button>
              )}
            </div>
          </div>

          {/* Filter Navigation Tabs */}
          <div className="v2-filter-tabs">
            <button
              type="button"
              className={`v2-filter-tab ${filterType === "all" ? "is-active" : ""}`}
              onClick={() => setFilterType("all")}
            >
              All Fields ({stats.total})
            </button>
            <button
              type="button"
              className={`v2-filter-tab ${filterType === "deterministic" ? "is-active" : ""}`}
              onClick={() => setFilterType("deterministic")}
            >
              <CheckCircle2 size={13} />
              <span>Deterministic ({stats.deterministic})</span>
            </button>
            <button
              type="button"
              className={`v2-filter-tab ${filterType === "llm" ? "is-active" : ""}`}
              onClick={() => setFilterType("llm")}
            >
              <Sparkles size={13} />
              <span>AgentAI Correlated ({stats.llm})</span>
            </button>
            <button
              type="button"
              className={`v2-filter-tab ${filterType === "attention" ? "is-active" : ""}`}
              onClick={() => setFilterType("attention")}
            >
              <AlertTriangle size={13} />
              <span>Attention Needed ({stats.attention})</span>
            </button>
            {stats.unmapped > 0 && (
              <button
                type="button"
                className={`v2-filter-tab ${filterType === "unmapped" ? "is-active" : ""}`}
                onClick={() => setFilterType("unmapped")}
              >
                Unmapped ({stats.unmapped})
              </button>
            )}
          </div>
        </div>

        {/* Stream Column Headers */}
        <div className="v2-stream-header">
          <div>Government GSTR-2B Column ({stats.total} Fields)</div>
          <div style={{ textAlign: "center" }}>Inference & Confidence</div>
          <div>Matched Purchase Register Field ({prColumns.length} Columns)</div>
        </div>

        {/* Visual Source-to-Target Mapping Stream */}
        <div className="v2-stream-body">
          {filteredCorrelations.length === 0 ? (
            <div style={{ padding: "48px 24px", textAlign: "center", color: "#94a3b8", fontSize: 13 }}>
              <SlidersHorizontal size={24} style={{ margin: "0 auto 8px auto", opacity: 0.5 }} />
              No columns match your search or filter criteria.
            </div>
          ) : (
            filteredCorrelations.map((row) => {
              const isDeterministic = row.engine === "deterministic";
              const isLLM = row.engine.startsWith("llm") || row.engine === "agent_ai";
              const isUserEdited = row.user_edited;

              return (
                <div key={row.gstr_column} className="v2-stream-row">
                  {/* 1. Left: Source Column (GSTR-2B) */}
                  <div style={{ minWidth: 0 }}>
                    <div className="v2-col-name">
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {row.gstr_column}
                      </span>
                      {row.is_primary_gst_field && (
                        <span className="v2-tag-core" title="Essential field for exact reconciliation">
                          <ShieldCheck size={11} style={{ display: "inline", verticalAlign: "middle", marginRight: 2 }} />
                          Core GST
                        </span>
                      )}
                    </div>

                    <div className="v2-col-meta">
                      <span className="v2-tag-dtype">{row.gstr_dtype}</span>
                      {row.gstr_samples && row.gstr_samples.length > 0 && (
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          Sample: <code style={{ color: "#334155" }}>{row.gstr_samples[0]}</code>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* 2. Center: Visual Directional Connector & Confidence Pill */}
                  <div className="v2-center-connector">
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      {isUserEdited ? (
                        <span className="v2-confidence-pill deterministic">
                          <Edit3 size={11} />
                          100% User
                        </span>
                      ) : isDeterministic ? (
                        <span className="v2-confidence-pill deterministic">
                          <CheckCircle2 size={11} />
                          {(row.confidence * 100).toFixed(0)}%
                        </span>
                      ) : isLLM ? (
                        <span className="v2-confidence-pill llm">
                          <Sparkles size={11} />
                          {(row.confidence * 100).toFixed(0)}% AgentAI
                        </span>
                      ) : (
                        <span className="v2-confidence-pill attention">
                          <AlertTriangle size={11} />
                          {(row.confidence * 100).toFixed(0)}%
                        </span>
                      )}
                      <ArrowRight size={13} style={{ color: "#cbd5e1" }} />
                    </div>

                    {/* Inspect Button */}
                    <button
                      type="button"
                      onClick={() => setInspectedCorrelation(row)}
                      className="v2-btn-inspect"
                    >
                      Inspect Evidence
                    </button>
                  </div>

                  {/* 3. Right: Custom Searchable Combobox for PR Column */}
                  <div>
                    <SearchableColumnSelect
                      value={row.selected_pr_column}
                      prColumns={prColumns}
                      suggestedColumn={row.selected_pr_column}
                      alternatives={row.alternatives}
                      disabled={disabled}
                      onChange={(newVal) => handlePrColumnChange(row.gstr_column, newVal)}
                    />
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Side-by-Side Contextual Inspector Drawer */}
        <MappingInspectorDrawer
          correlation={inspectedCorrelation}
          prColumns={prColumns}
          isOpen={inspectedCorrelation !== null}
          onClose={() => setInspectedCorrelation(null)}
          onSelectColumn={handlePrColumnChange}
        />
      </div>

      {/* Bottom Stage Action Bar */}
      <ReconciliationV2ActionBar
        position="bottom"
        stageNumber={2}
        backLabel="Back to Ingestion Setup"
        onBack={onBackToSetup}
        nextLabel={isConfirmed ? "Mapping Confirmed" : "Confirm Schema & Proceed"}
        onNext={onConfirmMapping}
        nextDisabled={disabled || isConfirmed}
      />
    </div>
  );
};
