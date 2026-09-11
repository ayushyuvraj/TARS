import React, { useState, useEffect, useRef } from "react";
import {
  apiV2,
  ExportPreviewResponse,
  ExportColumnDescriptor,
  ActiveExportColumn,
  ConditionalFormattingRule,
  ExportPreset,
  CustomExportRequest,
} from "./api_v2";
import { ReconciliationV2ActionBar } from "./ReconciliationV2ActionBar";
import { ExcelColorPicker } from "./ExcelColorPicker";
import "./summary_export_v2.css";
import {
  Sparkles,
  FileSpreadsheet,
  Download,
  AlertTriangle,
  FileCode,
  FileText,
  Palette,
  Eye,
  RefreshCw,
  Search,
  Plus,
  Trash2,
  MoveUp,
  MoveDown,
  Bookmark,
  BookmarkCheck,
  Check,
  CheckCircle2,
  ChevronDown,
  Filter,
  Layers,
  Sliders,
} from "lucide-react";

interface ReconciliationV2ExportStageProps {
  sessionId: string;
  onBack: () => void;
  onComplete?: () => void;
}

export const ReconciliationV2ExportStage: React.FC<ReconciliationV2ExportStageProps> = ({
  sessionId,
  onBack,
  onComplete,
}) => {
  const [isCompleting, setIsCompleting] = useState<boolean>(false);
  // State: Export Format & Dropdown
  const [isExportMenuOpen, setIsExportMenuOpen] = useState<boolean>(false);
  const [dsvDelimiter, setDsvDelimiter] = useState<string>("|");
  const [isDownloading, setIsDownloading] = useState<boolean>(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const handleComplete = async () => {
    setIsCompleting(true);
    try {
      if (sessionId) {
        await apiV2.completeSession(sessionId);
      }
    } catch (err: any) {
      console.warn("Error marking session complete:", err);
    } finally {
      setIsCompleting(false);
      if (onComplete) {
        onComplete();
      }
    }
  };

  // State: Columns Catalog & Active Designer
  const [availableColumns, setAvailableColumns] = useState<{
    CALCULATED: ExportColumnDescriptor[];
    GSTR: ExportColumnDescriptor[];
    PR: ExportColumnDescriptor[];
  }>({
    CALCULATED: [],
    GSTR: [],
    PR: [],
  });
  const [activeColumns, setActiveColumns] = useState<ActiveExportColumn[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedFamily, setSelectedFamily] = useState<"ALL" | "CALCULATED" | "GSTR" | "PR">("ALL");

  // State: Conditional Formatting Rules
  const [conditionalRules, setConditionalRules] = useState<ConditionalFormattingRule[]>([]);
  const [showRuleModal, setShowRuleModal] = useState<boolean>(false);
  const [isEntireColumn, setIsEntireColumn] = useState<boolean>(false);
  const [newRule, setNewRule] = useState<ConditionalFormattingRule>({
    id: "",
    column_id: "calc_tax_variance",
    operator: "GREATER_THAN",
    value1: "100",
    bg_color: "#FEE2E2",
    text_color: "#991B1B",
    is_bold: true,
  });

  // State: Presets
  const [presets, setPresets] = useState<ExportPreset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState<string>("preset_kpmg_statutory");
  const [isSavingPreset, setIsSavingPreset] = useState<boolean>(false);
  const [newPresetName, setNewPresetName] = useState<string>("");

  // State: Preview Table & Loading
  const [previewData, setPreviewData] = useState<ExportPreviewResponse | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState<boolean>(true);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [includeSummarySheet, setIncludeSummarySheet] = useState<boolean>(true);
  const [includeAuditSheet, setIncludeAuditSheet] = useState<boolean>(true);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsExportMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Initial Data Fetching: Columns, Presets, and Preview
  useEffect(() => {
    let isMounted = true;
    const initStage6 = async () => {
      setIsLoadingPreview(true);
      setPreviewError(null);
      try {
        const [colsRes, presetsRes, prevRes] = await Promise.all([
          apiV2.getExportColumns(sessionId).catch(() => null),
          apiV2.listExportPresets().catch(() => []),
          apiV2.getExportPreview(sessionId, 50).catch(() => null),
        ]);

        if (!isMounted) return;

        if (colsRes && colsRes.families) {
          setAvailableColumns(colsRes.families);
        }

        if (presetsRes && presetsRes.length > 0) {
          setPresets(presetsRes);
          // Apply initial default preset (e.g. KPMG Statutory)
          const defaultPreset = presetsRes.find((p) => p.id === "preset_kpmg_statutory") || presetsRes[0];
          if (defaultPreset) {
            setSelectedPresetId(defaultPreset.id);
            setActiveColumns(defaultPreset.columns);
            setConditionalRules(defaultPreset.conditional_rules || []);
          }
        } else if (colsRes && colsRes.families) {
          // Fallback to all default selected
          const defaultActive: ActiveExportColumn[] = [
            ...colsRes.families.CALCULATED.filter((c) => c.default_selected).map((c) => ({
              id: c.id,
              alias: c.label,
            })),
            ...colsRes.families.GSTR.filter((c) => c.default_selected).map((c) => ({
              id: c.id,
              alias: c.label,
            })),
            ...colsRes.families.PR.filter((c) => c.default_selected).map((c) => ({
              id: c.id,
              alias: c.label,
            })),
          ];
          setActiveColumns(defaultActive);
        }

        if (prevRes) {
          setPreviewData(prevRes);
        }
      } catch (err: any) {
        if (isMounted) {
          setPreviewError(err?.message || "Failed to load live export preview.");
        }
      } finally {
        if (isMounted) setIsLoadingPreview(false);
      }
    };

    initStage6();
    return () => {
      isMounted = false;
    };
  }, [sessionId]);

  // Preset Selection Handler
  const handleSelectPreset = (presetId: string) => {
    setSelectedPresetId(presetId);
    const found = presets.find((p) => p.id === presetId);
    if (found) {
      setActiveColumns(found.columns);
      setConditionalRules(found.conditional_rules || []);
    }
  };

  // Save Current Layout as Preset
  const handleSavePreset = async () => {
    if (!newPresetName.trim()) return;
    const newP: ExportPreset = {
      id: `preset_custom_${Date.now()}`,
      name: newPresetName.trim(),
      description: "User customized export layout template",
      columns: activeColumns,
      conditional_rules: conditionalRules,
    };
    try {
      const updatedPresets = await apiV2.saveExportPreset(newP);
      setPresets(updatedPresets);
      setSelectedPresetId(newP.id);
      setIsSavingPreset(false);
      setNewPresetName("");
    } catch (err: any) {
      alert(`Failed to save preset: ${err.message}`);
    }
  };

  // Column Canvas Reordering
  const moveColumn = (index: number, direction: "up" | "down") => {
    const newIdx = direction === "up" ? index - 1 : index + 1;
    if (newIdx < 0 || newIdx >= activeColumns.length) return;
    const copy = [...activeColumns];
    const [moved] = copy.splice(index, 1);
    copy.splice(newIdx, 0, moved);
    setActiveColumns(copy);
  };

  const removeColumn = (colId: string) => {
    setActiveColumns((prev) => prev.filter((c) => c.id !== colId));
  };

  const addColumn = (col: ExportColumnDescriptor) => {
    if (activeColumns.some((c) => c.id === col.id)) return;
    setActiveColumns((prev) => [...prev, { id: col.id, alias: col.label }]);
  };

  const updateColumnAlias = (colId: string, alias: string) => {
    setActiveColumns((prev) =>
      prev.map((c) => (c.id === colId ? { ...c, alias } : c))
    );
  };

  const updateColumnColor = (colId: string, header_color: string) => {
    setActiveColumns((prev) =>
      prev.map((c) => (c.id === colId ? { ...c, header_color } : c))
    );
  };

  // Conditional Formatting Rules
  const handleAddRule = () => {
    const ruleToAdd: ConditionalFormattingRule = {
      ...newRule,
      operator: isEntireColumn ? "ENTIRE_COLUMN" : newRule.operator,
      value1: isEntireColumn ? "ALL" : newRule.value1,
      id: `rule_${Date.now()}`,
    };
    setConditionalRules((prev) => [...prev, ruleToAdd]);
    if (isEntireColumn) {
      setActiveColumns((prev) =>
        prev.map((c) =>
          c.id === newRule.column_id ? { ...c, fill_color: newRule.bg_color } : c
        )
      );
    }
    setShowRuleModal(false);
  };

  const removeRule = (ruleId: string) => {
    const ruleToRemove = conditionalRules.find((r) => r.id === ruleId);
    if (ruleToRemove && ruleToRemove.operator === "ENTIRE_COLUMN") {
      setActiveColumns((prev) =>
        prev.map((c) =>
          c.id === ruleToRemove.column_id ? { ...c, fill_color: undefined } : c
        )
      );
    }
    setConditionalRules((prev) => prev.filter((r) => r.id !== ruleId));
  };

  // Export Dispatcher (Native File Stream)
  const handleCustomExport = async (format: "xlsx" | "csv" | "dsv" | "json") => {
    setIsDownloading(true);
    setIsExportMenuOpen(false);

    const exportReq: CustomExportRequest = {
      columns: activeColumns,
      conditional_rules: conditionalRules,
      export_format: format,
      delimiter: dsvDelimiter,
      color_coded: true,
      include_summary_sheet: includeSummarySheet,
      include_audit_sheet: includeAuditSheet,
    };

    try {
      const blob = await apiV2.downloadCustomExport(sessionId, exportReq);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const ext = format === "dsv" ? "dsv" : format;
      a.download = `TARS_Reconciliation_${sessionId.substring(0, 8)}_${Date.now()}.${ext}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err: any) {
      alert(`Export dispatch failed: ${err?.message || "Unknown error"}`);
    } finally {
      setIsDownloading(false);
    }
  };

  // Filter available columns
  const allAvailableList: ExportColumnDescriptor[] = [
    ...availableColumns.CALCULATED,
    ...availableColumns.GSTR,
    ...availableColumns.PR,
  ];

  const filteredCatalog = allAvailableList.filter((col) => {
    const matchesQuery =
      col.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
      col.id.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFamily =
      selectedFamily === "ALL" || col.family === selectedFamily;
    return matchesQuery && matchesFamily;
  });

  // Check conditional formatting match for live preview table cells
  const evaluateCellHighlight = (colId: string, cellVal: any) => {
    for (const rule of conditionalRules) {
      if (rule.column_id === colId) {
        if (rule.operator === "ENTIRE_COLUMN" || rule.operator === "ALWAYS") {
          return { backgroundColor: rule.bg_color, color: rule.text_color, fontWeight: rule.is_bold ? "bold" : "normal" };
        }
        const valStr = String(cellVal ?? "");
        const numVal = parseFloat(valStr.replace(/[^0-9.-]+/g, ""));
        const targetNum = parseFloat(rule.value1);

        if (rule.operator === "CONTAINS" && valStr.toLowerCase().includes(rule.value1.toLowerCase())) {
          return { backgroundColor: rule.bg_color, color: rule.text_color, fontWeight: rule.is_bold ? "bold" : "normal" };
        }
        if (rule.operator === "EQUALS" && valStr.trim().toLowerCase() === rule.value1.trim().toLowerCase()) {
          return { backgroundColor: rule.bg_color, color: rule.text_color, fontWeight: rule.is_bold ? "bold" : "normal" };
        }
        if (rule.operator === "GREATER_THAN" && !isNaN(numVal) && !isNaN(targetNum) && numVal > targetNum) {
          return { backgroundColor: rule.bg_color, color: rule.text_color, fontWeight: rule.is_bold ? "bold" : "normal" };
        }
        if (rule.operator === "LESS_THAN" && !isNaN(numVal) && !isNaN(targetNum) && numVal < targetNum) {
          return { backgroundColor: rule.bg_color, color: rule.text_color, fontWeight: rule.is_bold ? "bold" : "normal" };
        }
      }
    }
    return null;
  };

  return (
    <div className="v2-export-container">
      {/* Top Header Card */}
      <header className="v2-stage-header-card">
        <span className="v2-stage-eyebrow">
          <Sparkles size={13} />
          Stage 6 of 6: Visual Export Studio & Ledger Designer
        </span>
        <h1 className="v2-stage-title">Custom Export Studio & Financial Ledger Designer</h1>
        <p className="v2-stage-desc">
          Select, reorder, style, and apply conditional formatting across all GSTR portal columns, ERP purchase
          register columns, and computed reconciliation metrics. Save designs as reusable presets.
        </p>
      </header>

      {/* Action Bar */}
      <ReconciliationV2ActionBar
        position="top"
        stageNumber={6}
        backLabel="Back to Summary Dashboard"
        onBack={onBack}
        nextLabel={isDownloading ? "Exporting..." : "Quick Export (.xlsx)"}
        onNext={() => handleCustomExport("xlsx")}
        extraRight={
          <button
            type="button"
            className="v2-btn-complete-kpmg"
            onClick={handleComplete}
            disabled={isCompleting}
            title="Complete Reconciliation & Return to Reconciliation 2.0"
          >
            {isCompleting ? <RefreshCw className="animate-spin" size={15} /> : <CheckCircle2 size={16} />}
            <span>Complete</span>
          </button>
        }
      />

      {/* TOP BAR CONTROLS: Presets + Format Dropdown */}
      <section className="v2-export-studio-topbar">
        {/* Left: Preset Selector */}
        <div className="v2-export-studio-topbar__left">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Bookmark size={16} color="#00338D" />
            <span style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>Layout Preset:</span>
            <select
              value={selectedPresetId}
              onChange={(e) => handleSelectPreset(e.target.value)}
              style={{
                fontSize: 12,
                fontWeight: 600,
                padding: "6px 12px",
                borderRadius: 6,
                border: "1px solid #cbd5e1",
                background: "#f8fafc",
                color: "#0f172a",
                cursor: "pointer",
              }}
            >
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.is_system ? `[Standard] ${p.name}` : `[Custom] ${p.name}`}
                </option>
              ))}
            </select>
          </div>

          {isSavingPreset ? (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                type="text"
                placeholder="Preset Name (e.g. KPMG Tax File)"
                value={newPresetName}
                onChange={(e) => setNewPresetName(e.target.value)}
                style={{
                  fontSize: 12,
                  padding: "5px 10px",
                  borderRadius: 6,
                  border: "1px solid #00338d",
                  outline: "none",
                }}
              />
              <button
                onClick={handleSavePreset}
                style={{
                  background: "#00338d",
                  color: "#fff",
                  border: "none",
                  borderRadius: 6,
                  padding: "5px 10px",
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Save
              </button>
              <button
                onClick={() => setIsSavingPreset(false)}
                style={{
                  background: "#e2e8f0",
                  color: "#475569",
                  border: "none",
                  borderRadius: 6,
                  padding: "5px 8px",
                  fontSize: 11,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setIsSavingPreset(true)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                background: "#f1f5f9",
                color: "#0f172a",
                border: "1px solid #cbd5e1",
                borderRadius: 6,
                padding: "6px 10px",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              <BookmarkCheck size={14} color="#00338D" />
              Save As New Preset
            </button>
          )}
        </div>

        {/* Right: Sleek Unified Top-Right Export Dropdown */}
        <div className="v2-export-studio-topbar__right" ref={dropdownRef}>
          <button
            className="v2-download-btn"
            onClick={() => setIsExportMenuOpen((prev) => !prev)}
            disabled={isDownloading}
            style={{ opacity: isDownloading ? 0.7 : 1 }}
          >
            {isDownloading ? <RefreshCw className="animate-spin" size={16} /> : <Download size={16} />}
            {isDownloading ? "Generating Ledger..." : "Export"}
            <ChevronDown size={14} style={{ marginLeft: 4 }} />
          </button>

          {/* Real-time Export Dropdown Menu */}
          {isExportMenuOpen && (
            <div className="v2-export-dropdown-menu">
              <div
                className="v2-export-dropdown-item"
                onClick={() => handleCustomExport("xlsx")}
              >
                <div className="v2-export-dropdown-item__icon">
                  <FileSpreadsheet size={18} />
                </div>
                <div className="v2-export-dropdown-item__text">
                  <span className="v2-export-dropdown-item__title">Microsoft Excel (.xlsx)</span>
                  <span className="v2-export-dropdown-item__sub">Embedded colors, rules, multi-sheet</span>
                </div>
              </div>

              <div
                className="v2-export-dropdown-item"
                onClick={() => handleCustomExport("csv")}
              >
                <div className="v2-export-dropdown-item__icon">
                  <FileText size={18} />
                </div>
                <div className="v2-export-dropdown-item__text">
                  <span className="v2-export-dropdown-item__title">Enriched CSV (.csv)</span>
                  <span className="v2-export-dropdown-item__sub">High-throughput comma-separated</span>
                </div>
              </div>

              <div
                className="v2-export-dropdown-item"
                onClick={() => handleCustomExport("dsv")}
              >
                <div className="v2-export-dropdown-item__icon">
                  <Sliders size={18} />
                </div>
                <div className="v2-export-dropdown-item__text">
                  <span className="v2-export-dropdown-item__title">Delimiter DSV ({dsvDelimiter})</span>
                  <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                    {["|", "\t", ";"].map((del) => (
                      <span
                        key={del}
                        onClick={(e) => {
                          e.stopPropagation();
                          setDsvDelimiter(del);
                        }}
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: "2px 6px",
                          borderRadius: 4,
                          background: dsvDelimiter === del ? "#00338D" : "#e2e8f0",
                          color: dsvDelimiter === del ? "#ffffff" : "#475569",
                          cursor: "pointer",
                        }}
                      >
                        {del === "\t" ? "TAB" : del === "|" ? "PIPE |" : "SEMICOLON ;"}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <div
                className="v2-export-dropdown-item"
                onClick={() => handleCustomExport("json")}
              >
                <div className="v2-export-dropdown-item__icon">
                  <FileCode size={18} />
                </div>
                <div className="v2-export-dropdown-item__text">
                  <span className="v2-export-dropdown-item__title">Machine JSON (.json)</span>
                  <span className="v2-export-dropdown-item__sub">Structured schema for ERP integrations</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* TWO-PANEL INTERACTIVE DESIGNER: Left Catalog & Right Canvas */}
      <section className="v2-export-designer-grid">
        {/* Left Panel: Available Columns Catalog */}
        <div className="v2-export-sidebar-card">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: "#0f172a" }}>
              Available Column Universe
            </h3>
            <span className="v2-panel-tag">{filteredCatalog.length} columns</span>
          </div>

          {/* Search Filter */}
          <div style={{ position: "relative" }}>
            <Search size={14} color="#94a3b8" style={{ position: "absolute", left: 10, top: 10 }} />
            <input
              type="text"
              placeholder="Search all columns..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: "100%",
                padding: "7px 10px 7px 30px",
                fontSize: 12,
                borderRadius: 6,
                border: "1px solid #cbd5e1",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>

          {/* Family Filters */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {(["ALL", "CALCULATED", "GSTR", "PR"] as const).map((fam) => (
              <button
                key={fam}
                onClick={() => setSelectedFamily(fam)}
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "4px 8px",
                  borderRadius: 4,
                  border: "none",
                  background: selectedFamily === fam ? "#00338D" : "#f1f5f9",
                  color: selectedFamily === fam ? "#ffffff" : "#475569",
                  cursor: "pointer",
                }}
              >
                {fam === "CALCULATED" ? "Reconciliation Intel" : fam === "GSTR" ? "2B Portal" : fam === "PR" ? "Purchase Reg" : "All"}
              </button>
            ))}
          </div>

          {/* Catalog List */}
          <div className="v2-column-catalog-list">
            {filteredCatalog.map((col) => {
              const isAdded = activeColumns.some((c) => c.id === col.id);
              return (
                <div
                  key={col.id}
                  className={`v2-column-catalog-item ${isAdded ? "active" : ""}`}
                  onClick={() => (!isAdded ? addColumn(col) : removeColumn(col.id))}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6, overflow: "hidden" }}>
                    <span className={`v2-badge-${col.family}`}>
                      {col.family === "CALCULATED" ? "CALC" : col.family === "GSTR" ? "2B" : "PR"}
                    </span>
                    <span
                      style={{
                        fontWeight: 600,
                        color: "#1e293b",
                        textOverflow: "ellipsis",
                        overflow: "hidden",
                        whiteSpace: "nowrap",
                      }}
                      title={col.label}
                    >
                      {col.label}
                    </span>
                  </div>
                  {isAdded ? (
                    <Check size={14} color="#166534" />
                  ) : (
                    <Plus size={14} color="#00338D" />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Panel: Active Export Canvas & Ordering */}
        <div className="v2-export-canvas-card">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <h3 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 2px 0", color: "#0f172a" }}>
                Active Export Layout & Ordering ({activeColumns.length} Selected)
              </h3>
              <p style={{ fontSize: 11, color: "#64748b", margin: 0 }}>
                Drag or use arrows to change column order. Click header name to edit alias. Pick header accent color.
              </p>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => {
                  setIsEntireColumn(false);
                  setShowRuleModal(true);
                }}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  background: "#f0f5ff",
                  color: "#00338d",
                  border: "1px solid #bfdbfe",
                  borderRadius: 6,
                  padding: "6px 12px",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                <Palette size={14} />
                + Conditional Rule ({conditionalRules.length})
              </button>
            </div>
          </div>

          {/* Conditional Rules Tray (if any exist) */}
          {conditionalRules.length > 0 && (
            <div className="v2-conditional-rules-tray">
              <span style={{ fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase" }}>
                Active Conditional Highlights (Live on preview & baked into XLSX)
              </span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {conditionalRules.map((rule) => (
                  <div key={rule.id} className="v2-conditional-rule-row">
                    <span style={{ fontWeight: 700, color: "#00338d" }}>{rule.column_id}</span>
                    <span style={{ color: "#64748b" }}>
                      {rule.operator === "ENTIRE_COLUMN" ? "Entire Column" : rule.operator}
                    </span>
                    {rule.operator !== "ENTIRE_COLUMN" && (
                      <strong style={{ color: "#0f172a" }}>"{rule.value1}"</strong>
                    )}
                    <div
                      style={{
                        padding: "2px 8px",
                        borderRadius: 4,
                        backgroundColor: rule.bg_color,
                        color: rule.text_color,
                        fontWeight: rule.is_bold ? 700 : 400,
                        fontSize: 10,
                      }}
                    >
                      Sample Highlight
                    </div>
                    <Trash2
                      size={13}
                      color="#ef4444"
                      style={{ cursor: "pointer", marginLeft: 4 }}
                      onClick={() => removeRule(rule.id)}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Active Canvas List */}
          <div className="v2-canvas-columns-wrap">
            {activeColumns.map((col, idx) => (
              <div key={col.id} className="v2-canvas-column-card">
                <div className="v2-canvas-column-card__left">
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: "#64748b",
                      width: 22,
                    }}
                  >
                    #{idx + 1}
                  </span>

                  {/* Header Color Picker Pill */}
                  <input
                    type="color"
                    value={col.header_color || "#00338D"}
                    onChange={(e) => updateColumnColor(col.id, e.target.value)}
                    title="Choose Column Header Accent Color"
                    style={{
                      width: 20,
                      height: 20,
                      border: "none",
                      borderRadius: 4,
                      cursor: "pointer",
                      padding: 0,
                    }}
                  />

                  {/* Editable Alias Input */}
                  <input
                    type="text"
                    value={col.alias ?? col.id}
                    onChange={(e) => updateColumnAlias(col.id, e.target.value)}
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: "#0f172a",
                      border: "1px solid transparent",
                      background: "transparent",
                      padding: "4px 8px",
                      borderRadius: 4,
                      outline: "none",
                    }}
                    onFocus={(e) => (e.target.style.border = "1px solid #93c5fd")}
                    onBlur={(e) => (e.target.style.border = "1px solid transparent")}
                  />
                  <span style={{ fontSize: 10, color: "#94a3b8" }}>({col.id})</span>
                </div>

                <div className="v2-canvas-column-card__right">
                  <button
                    disabled={idx === 0}
                    onClick={() => moveColumn(idx, "up")}
                    style={{
                      border: "none",
                      background: "#f1f5f9",
                      padding: 4,
                      borderRadius: 4,
                      cursor: idx === 0 ? "not-allowed" : "pointer",
                      opacity: idx === 0 ? 0.3 : 1,
                    }}
                  >
                    <MoveUp size={13} color="#0f172a" />
                  </button>
                  <button
                    disabled={idx === activeColumns.length - 1}
                    onClick={() => moveColumn(idx, "down")}
                    style={{
                      border: "none",
                      background: "#f1f5f9",
                      padding: 4,
                      borderRadius: 4,
                      cursor: idx === activeColumns.length - 1 ? "not-allowed" : "pointer",
                      opacity: idx === activeColumns.length - 1 ? 0.3 : 1,
                    }}
                  >
                    <MoveDown size={13} color="#0f172a" />
                  </button>
                  <button
                    onClick={() => removeColumn(col.id)}
                    style={{
                      border: "none",
                      background: "#fee2e2",
                      padding: 4,
                      borderRadius: 4,
                      cursor: "pointer",
                    }}
                  >
                    <Trash2 size={13} color="#991b1b" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Workbook Options Toggle */}
          <div style={{ display: "flex", gap: 16, paddingTop: 10, borderTop: "1px solid #f1f5f9", fontSize: 12 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={includeSummarySheet}
                onChange={(e) => setIncludeSummarySheet(e.target.checked)}
              />
              <span style={{ fontWeight: 600 }}>Include Executive Summary Tab (.xlsx)</span>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={includeAuditSheet}
                onChange={(e) => setIncludeAuditSheet(e.target.checked)}
              />
              <span style={{ fontWeight: 600 }}>Include Audit & Provenance Tab (.xlsx)</span>
            </label>
          </div>
        </div>
      </section>

      {/* LIVE SYNCHRONIZED PREVIEW TABLE */}
      <section className="v2-preview-panel">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Eye size={18} color="#00338D" />
            <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0, color: "#0f172a" }}>
              Live Synchronized Ledger Preview
            </h3>
            {previewData && (
              <span className="v2-panel-tag">
                Showing sample rows in your exact custom column order & colors
              </span>
            )}
          </div>
          <span style={{ fontSize: 11, color: "#64748b" }}>
            Updates in real-time as you reorder columns, change aliases, or add conditional formatting
          </span>
        </div>

        {isLoadingPreview ? (
          <div style={{ padding: "40px 0", textAlign: "center", color: "#64748b" }}>
            <RefreshCw className="animate-spin" size={24} style={{ margin: "0 auto 8px auto" }} />
            <div>Generating live export table preview...</div>
          </div>
        ) : previewError ? (
          <div style={{ padding: 16, background: "#fef2f2", color: "#991b1b", borderRadius: 8, fontSize: 12 }}>
            <AlertTriangle size={16} style={{ display: "inline", marginRight: 6 }} />
            {previewError}
          </div>
        ) : (
          <div className="v2-table-scroll-wrap">
            <table className="v2-export-preview-table">
              <thead>
                <tr>
                  {activeColumns.map((col) => (
                    <th
                      key={col.id}
                      style={{
                        backgroundColor: col.header_color || "#00338D",
                        color: "#ffffff",
                      }}
                    >
                      {col.alias || col.id}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(previewData?.preview_records || []).map((row: any) => (
                  <tr key={row.id}>
                    {activeColumns.map((col) => {
                      // Resolve cell value dynamically from preview row
                      let cellVal: any = "";
                      if (col.id === "calc_id") cellVal = row.id;
                      else if (col.id === "calc_bucket") cellVal = row.bucket;
                      else if (col.id === "calc_matched_by_pass") cellVal = row.matched_by_pass || "Pass 1 - Strict Exact";
                      else if (col.id === "calc_taxable_variance") cellVal = `₹${Math.abs(Number(row.gstr_taxable || 0) - Number(row.pr_taxable || 0)).toFixed(2)}`;
                      else if (col.id === "calc_tax_variance") cellVal = `₹${Number(row.tax_diff || 0).toFixed(2)}`;
                      else if (col.id === "calc_date_delta_days") cellVal = "0d";
                      else if (col.id === "calc_ai_reason") cellVal = row.ai_reason;
                      else if (col.id === "calc_lifecycle_provenance") cellVal = row.provenance;
                      else if (col.id === "gstr_gstin") cellVal = row.gstin;
                      else if (col.id === "gstr_document_number") cellVal = row.gstr_doc;
                      else if (col.id === "gstr_document_date") cellVal = row.gstr_date;
                      else if (col.id === "gstr_taxable_value") cellVal = `₹${Number(row.gstr_taxable || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
                      else if (col.id === "gstr_tax_amount") cellVal = `₹${Number(row.gstr_tax || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
                      else if (col.id === "pr_document_number") cellVal = row.pr_doc;
                      else if (col.id === "pr_document_date") cellVal = row.pr_date;
                      else if (col.id === "pr_taxable_value") cellVal = `₹${Number(row.pr_taxable || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
                      else if (col.id === "pr_tax_amount") cellVal = `₹${Number(row.pr_tax || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
                      else cellVal = "—";

                      const highlight = evaluateCellHighlight(col.id, cellVal);

                      return (
                        <td
                          key={col.id}
                          style={{
                            ...highlight,
                            backgroundColor: highlight ? highlight.backgroundColor : col.fill_color || undefined,
                          }}
                        >
                          {cellVal}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* CONDITIONAL FORMATTING RULE CREATION MODAL */}
      {showRuleModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            overflowY: "auto",
            padding: "30px 16px",
          }}
        >
          <div
            style={{
              background: "#ffffff",
              padding: 24,
              borderRadius: 12,
              width: 440,
              boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1)",
              display: "flex",
              flexDirection: "column",
              gap: 14,
            }}
          >
            <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: "#0f172a" }}>
              Add Conditional Formatting Rule
            </h3>
            <p style={{ fontSize: 12, color: "#64748b", margin: 0 }}>
              Highlight cells on-screen and bake native rules into Microsoft Excel (.xlsx).
            </p>

            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: "#475569" }}>Apply to Column</label>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 600, color: "#0f172a", cursor: "pointer", userSelect: "none" }}>
                  <input
                    type="checkbox"
                    checked={isEntireColumn}
                    onChange={(e) => setIsEntireColumn(e.target.checked)}
                    style={{ cursor: "pointer" }}
                  />
                  Entire Column
                </label>
              </div>
              <select
                value={newRule.column_id}
                onChange={(e) => setNewRule({ ...newRule, column_id: e.target.value })}
                style={{ width: "100%", padding: 8, fontSize: 12, borderRadius: 6, border: "1px solid #cbd5e1" }}
              >
                {activeColumns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.alias || c.id}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, opacity: isEntireColumn ? 0.45 : 1 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: "#475569" }}>Condition</label>
                <select
                  disabled={isEntireColumn}
                  value={newRule.operator}
                  onChange={(e: any) => setNewRule({ ...newRule, operator: e.target.value })}
                  style={{ width: "100%", padding: 8, fontSize: 12, borderRadius: 6, border: "1px solid #cbd5e1", marginTop: 4, cursor: isEntireColumn ? "not-allowed" : "pointer" }}
                >
                  <option value="CONTAINS">Contains Text</option>
                  <option value="EQUALS">Exact Equal</option>
                  <option value="GREATER_THAN">Greater Than (&gt;)</option>
                  <option value="LESS_THAN">Less Than (&lt;)</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: "#475569" }}>Match Value</label>
                <input
                  type="text"
                  disabled={isEntireColumn}
                  value={isEntireColumn ? "All cells (Entire Column)" : newRule.value1}
                  onChange={(e) => setNewRule({ ...newRule, value1: e.target.value })}
                  placeholder="e.g. 100 or EXACT"
                  style={{
                    width: "100%",
                    padding: 8,
                    fontSize: 12,
                    borderRadius: 6,
                    border: "1px solid #cbd5e1",
                    marginTop: 4,
                    boxSizing: "border-box",
                    cursor: isEntireColumn ? "not-allowed" : "text",
                    backgroundColor: isEntireColumn ? "#f1f5f9" : "#ffffff",
                    color: isEntireColumn ? "#64748b" : "#0f172a",
                  }}
                />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: "#475569", display: "block", marginBottom: 6 }}>
                  Background Fill
                </label>
                <ExcelColorPicker
                  label="Background Fill"
                  color={newRule.bg_color}
                  onChange={(c) => setNewRule({ ...newRule, bg_color: c })}
                  allowNoFill
                />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: "#475569", display: "block", marginBottom: 6 }}>
                  Text Color
                </label>
                <ExcelColorPicker
                  label="Text Color"
                  color={newRule.text_color}
                  onChange={(c) => setNewRule({ ...newRule, text_color: c })}
                />
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
              <button
                onClick={() => setShowRuleModal(false)}
                style={{ padding: "8px 16px", background: "#00338D", color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer" }}
              >
                Cancel
              </button>
              <button
                onClick={handleAddRule}
                style={{ padding: "8px 16px", background: "#00338D", color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer" }}
              >
                Add Rule
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bottom Action Bar */}
      <ReconciliationV2ActionBar
        position="bottom"
        stageNumber={6}
        backLabel="Back to Summary Dashboard"
        onBack={onBack}
        nextLabel={isDownloading ? "Exporting..." : "Export Excel Ledger"}
        onNext={() => handleCustomExport("xlsx")}
        extraRight={
          <button
            type="button"
            className="v2-btn-complete-kpmg"
            onClick={handleComplete}
            disabled={isCompleting}
            title="Complete Reconciliation & Return to Reconciliation 2.0"
          >
            {isCompleting ? <RefreshCw className="animate-spin" size={15} /> : <CheckCircle2 size={16} />}
            <span>Complete</span>
          </button>
        }
      />
    </div>
  );
};

