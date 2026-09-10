import React, { useState, useEffect } from "react";
import {
  apiV2,
  ExportPreviewResponse,
  ExportPreviewItem,
} from "./api_v2";
import { ReconciliationV2ActionBar } from "./ReconciliationV2ActionBar";
import "./summary_export_v2.css";
import {
  Sparkles,
  FileSpreadsheet,
  Download,
  CheckCircle2,
  AlertTriangle,
  Layers,
  Settings2,
  FileCode,
  FileText,
  Palette,
  Eye,
  Check,
  RefreshCw,
} from "lucide-react";

interface ReconciliationV2ExportStageProps {
  sessionId: string;
  onBack: () => void;
}

export const ReconciliationV2ExportStage: React.FC<ReconciliationV2ExportStageProps> = ({
  sessionId,
  onBack,
}) => {
  const [selectedFormat, setSelectedFormat] = useState<"xlsx" | "csv" | "json">("xlsx");
  const [colorCoded, setColorCoded] = useState<boolean>(true);
  const [includeAuxiliary, setIncludeAuxiliary] = useState<boolean>(true);

  const [previewData, setPreviewData] = useState<ExportPreviewResponse | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState<boolean>(true);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState<boolean>(false);

  useEffect(() => {
    let isMounted = true;
    const fetchPreview = async () => {
      setIsLoadingPreview(true);
      setPreviewError(null);
      try {
        const res = await apiV2.getExportPreview(sessionId, 50);
        if (isMounted) setPreviewData(res);
      } catch (err: any) {
        if (isMounted) {
          setPreviewError(err?.message || "Failed to load live export preview.");
        }
      } finally {
        if (isMounted) setIsLoadingPreview(false);
      }
    };

    fetchPreview();
    return () => {
      isMounted = false;
    };
  }, [sessionId]);

  const handleDownload = () => {
    setIsDownloading(true);
    const downloadUrl = apiV2.getExportDownloadUrl(sessionId, selectedFormat, colorCoded, includeAuxiliary);
    
    // Trigger native browser download
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.target = "_blank";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setTimeout(() => {
      setIsDownloading(false);
    }, 1500);
  };

  const getBucketColorClass = (bucket: string) => {
    if (!colorCoded) return "";
    return `v2-row-${bucket}`;
  };

  return (
    <div className="v2-export-container">
      {/* Header Info */}
      <header className="v2-stage-header-card">
        <span className="v2-stage-eyebrow">
          <Sparkles size={13} />
          Stage 6 of 6: Multi-Format Ledger Dispatch
        </span>
        <h1 className="v2-stage-title">Export Reconciled Financial Package</h1>
        <p className="v2-stage-desc">
          Generate production-ready reconciliation workbooks with side-by-side rule comparisons, AI classification
          rationales, and complete human-in-the-loop audit traces.
        </p>
      </header>

      {/* Top Action Bar */}
      <ReconciliationV2ActionBar
        position="top"
        stageNumber={6}
        backLabel="Back to Summary Dashboard"
        onBack={onBack}
        nextLabel={isDownloading ? "Generating Package..." : "Dispatch & Export Package"}
        onNext={handleDownload}
      />

      {/* Export Configuration Controls */}
      <section className="v2-export-control-card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 4px 0", color: "#0f172a" }}>
              1. Choose Export Package Format
            </h3>
            <p style={{ fontSize: 12, color: "#64748b", margin: 0 }}>
              Select target structure for tax filing, ERP ingestion, or executive audit committees.
            </p>
          </div>
          <button
            className="v2-download-btn"
            onClick={handleDownload}
            disabled={isDownloading}
            style={{ opacity: isDownloading ? 0.7 : 1 }}
          >
            {isDownloading ? <RefreshCw className="animate-spin" size={16} /> : <Download size={16} />}
            {isDownloading ? "Compiling..." : `Download .${selectedFormat.toUpperCase()} Package`}
          </button>
        </div>

        {/* Format Selector Grid */}
        <div className="v2-export-formats-grid">
          {/* XLSX */}
          <div
            className={`v2-format-option-card ${selectedFormat === "xlsx" ? "selected" : ""}`}
            onClick={() => setSelectedFormat("xlsx")}
          >
            <div className="v2-format-option-card__icon">
              <FileSpreadsheet size={20} />
            </div>
            <div className="v2-format-option-card__info">
              <h4>Microsoft Excel (.xlsx)</h4>
              <p>
                Multi-sheet workbook with Executive Summary, color-coded Reconciled Ledger, and Audit Governance logs.
              </p>
            </div>
          </div>

          {/* CSV */}
          <div
            className={`v2-format-option-card ${selectedFormat === "csv" ? "selected" : ""}`}
            onClick={() => setSelectedFormat("csv")}
          >
            <div className="v2-format-option-card__icon">
              <FileText size={20} />
            </div>
            <div className="v2-format-option-card__info">
              <h4>Enriched CSV (.csv)</h4>
              <p>
                Flat high-throughput format including all rule variance comparisons and AI reasoning remarks.
              </p>
            </div>
          </div>

          {/* JSON */}
          <div
            className={`v2-format-option-card ${selectedFormat === "json" ? "selected" : ""}`}
            onClick={() => setSelectedFormat("json")}
          >
            <div className="v2-format-option-card__icon">
              <FileCode size={20} />
            </div>
            <div className="v2-format-option-card__info">
              <h4>Machine JSON (.json)</h4>
              <p>
                Complete hierarchical payload optimized for ERP webhooks, SAP/Oracle loaders, and automated pipelines.
              </p>
            </div>
          </div>
        </div>

        {/* Toggles Row */}
        <div className="v2-export-toggles-row">
          <label className="v2-toggle-item">
            <input
              type="checkbox"
              checked={colorCoded}
              onChange={(e) => setColorCoded(e.target.checked)}
              disabled={selectedFormat !== "xlsx"}
            />
            <Palette size={16} color="#00338D" />
            <span className="v2-toggle-label">
              Apply Statutory Status Color Coding
              <span className="v2-toggle-hint">(Colors matching rows green, near-match purple, unmatched red)</span>
            </span>
          </label>

          <label className="v2-toggle-item">
            <input
              type="checkbox"
              checked={includeAuxiliary}
              onChange={(e) => setIncludeAuxiliary(e.target.checked)}
            />
            <Layers size={16} color="#00338D" />
            <span className="v2-toggle-label">
              Include Auxiliary Testing Rule Columns
              <span className="v2-toggle-hint">(Appends PO, HSN, and Place of Supply comparisons)</span>
            </span>
          </label>
        </div>
      </section>

      {/* Live On-Screen Preview Panel */}
      <section className="v2-preview-panel">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Eye size={18} color="#00338D" />
            <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0, color: "#0f172a" }}>
              Live Export Ledger Preview
            </h3>
            {previewData && (
              <span className="v2-panel-tag">
                Showing first {previewData.preview_records.length} of {previewData.total_records} rows
              </span>
            )}
          </div>
          <span style={{ fontSize: 11, color: "#64748b" }}>
            All tested Stage 3 rule columns, variances, and AI remarks included
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
                  <th>Status Bucket</th>
                  <th>Pass Tier</th>
                  <th>Supplier GSTIN</th>
                  <th>2B Doc #</th>
                  <th>PR Doc #</th>
                  <th>2B Date</th>
                  <th>PR Date</th>
                  <th>2B Taxable (₹)</th>
                  <th>PR Taxable (₹)</th>
                  <th>2B Tax (₹)</th>
                  <th>PR Tax (₹)</th>
                  <th>Tax Variance (₹)</th>
                  <th>Deterministic AI Audit Remark</th>
                  <th>Lifecycle Provenance</th>
                </tr>
              </thead>
              <tbody>
                {(previewData?.preview_records || []).map((row) => (
                  <tr key={row.id} className={getBucketColorClass(row.bucket)}>
                    <td>
                      <span
                        className="v2-panel-tag"
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          background:
                            row.bucket === "EXACT_MATCH"
                              ? "#dcfce7"
                              : row.bucket === "TOLERANCE_MATCH"
                              ? "#dbeafe"
                              : row.bucket === "NEAR_MATCH"
                              ? "#ede9fe"
                              : row.bucket === "AMBIGUOUS"
                              ? "#fef3c7"
                              : "#fee2e2",
                          color:
                            row.bucket === "EXACT_MATCH"
                              ? "#166534"
                              : row.bucket === "TOLERANCE_MATCH"
                              ? "#1e40af"
                              : row.bucket === "NEAR_MATCH"
                              ? "#5b21b6"
                              : row.bucket === "AMBIGUOUS"
                              ? "#92400e"
                              : "#991b1b",
                        }}
                      >
                        {row.bucket.replace("_", " ")}
                      </span>
                    </td>
                    <td>
                      <span style={{ fontSize: 10, color: "#475569" }}>{row.matched_by_pass || "UNLINKED"}</span>
                    </td>
                    <td>
                      <strong>{row.gstin}</strong>
                    </td>
                    <td>{row.gstr_doc || "—"}</td>
                    <td>{row.pr_doc || "—"}</td>
                    <td>{row.gstr_date || "—"}</td>
                    <td>{row.pr_date || "—"}</td>
                    <td>₹{Number(row.gstr_taxable || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                    <td>₹{Number(row.pr_taxable || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                    <td style={{ fontWeight: 600 }}>
                      ₹{Number(row.gstr_tax || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </td>
                    <td style={{ fontWeight: 600 }}>
                      ₹{Number(row.pr_tax || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </td>
                    <td
                      style={{
                        fontWeight: 700,
                        color: row.tax_diff > 0.05 ? "#991b1b" : "#166534",
                      }}
                    >
                      ₹{row.tax_diff.toFixed(2)}
                    </td>
                    <td style={{ maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", color: "#334155" }}>
                      {row.ai_reason || "Deterministic match verified."}
                    </td>
                    <td style={{ color: "#00338D", fontWeight: 600 }}>{row.provenance || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Bottom Action Bar */}
      <ReconciliationV2ActionBar
        position="bottom"
        stageNumber={6}
        backLabel="Back to Summary Dashboard"
        onBack={onBack}
        nextLabel={isDownloading ? "Generating Package..." : "Dispatch & Export Package"}
        onNext={handleDownload}
      />
    </div>
  );
};
