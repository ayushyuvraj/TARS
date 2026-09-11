from __future__ import annotations

import io
import json
import logging
from datetime import datetime, timezone
from typing import Any

import pandas as pd
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

from app.services.audit_v2_service import audit_v2_service
from pydantic import BaseModel, Field
from openpyxl.formatting.rule import CellIsRule, FormulaRule
from openpyxl.styles.differential import DifferentialStyle

logger = logging.getLogger(__name__)

# =========================================================================
# EXPORT STUDIO MODELS (STAGE 6)
# =========================================================================

class ExportColumnDescriptor(BaseModel):
    id: str
    label: str
    family: str  # "CALCULATED" | "GSTR" | "PR"
    source_field: str
    dtype: str = "string"  # "string" | "number" | "date" | "currency"
    default_selected: bool = True
    description: str | None = None


class ActiveExportColumn(BaseModel):
    id: str
    alias: str | None = None
    header_color: str | None = None  # Hex (e.g., "#00338D")
    fill_color: str | None = None    # Hex (e.g., "#F0FDF4")
    number_format: str | None = None  # e.g., "₹#,##0.00"


class ConditionalFormattingRule(BaseModel):
    id: str
    column_id: str
    operator: str  # "CONTAINS" | "EQUALS" | "GREATER_THAN" | "LESS_THAN" | "BETWEEN" | "IS_EMPTY"
    value1: str
    value2: str | None = None
    bg_color: str = "#FEF2F2"
    text_color: str = "#991B1B"
    is_bold: bool = True


class ExportPreset(BaseModel):
    id: str
    name: str
    description: str
    is_system: bool = False
    columns: list[ActiveExportColumn]
    conditional_rules: list[ConditionalFormattingRule] = Field(default_factory=list)
    created_at: str | None = None


class CustomExportRequest(BaseModel):
    columns: list[ActiveExportColumn]
    conditional_rules: list[ConditionalFormattingRule] = Field(default_factory=list)
    export_format: str = "xlsx"  # "xlsx" | "csv" | "dsv" | "json"
    delimiter: str = "|"         # for dsv: "|", "\t", ";"
    color_coded: bool = True
    include_summary_sheet: bool = True
    include_audit_sheet: bool = True


# Corporate KPMG Navy & Status Color Palette
NAVY_HEADER_FILL = PatternFill(start_color="00338D", end_color="00338D", fill_type="solid")
NAVY_HEADER_FONT = Font(name="Calibri", size=11, bold=True, color="FFFFFF")

SECTION_HEADER_FILL = PatternFill(start_color="F1F5F9", end_color="F1F5F9", fill_type="solid")
SECTION_HEADER_FONT = Font(name="Calibri", size=11, bold=True, color="0F172A")

STATUS_STYLES = {
    "EXACT_MATCH": {
        "badge_fill": PatternFill(start_color="DCFCE7", end_color="DCFCE7", fill_type="solid"),
        "badge_font": Font(name="Calibri", size=10, bold=True, color="166534"),
        "row_fill": PatternFill(start_color="F0FDF4", end_color="F0FDF4", fill_type="solid"),
    },
    "TOLERANCE_MATCH": {
        "badge_fill": PatternFill(start_color="DBEAFE", end_color="DBEAFE", fill_type="solid"),
        "badge_font": Font(name="Calibri", size=10, bold=True, color="1E40AF"),
        "row_fill": PatternFill(start_color="F8FAFC", end_color="F8FAFC", fill_type="solid"),
    },
    "NEAR_MATCH": {
        "badge_fill": PatternFill(start_color="EDE9FE", end_color="EDE9FE", fill_type="solid"),
        "badge_font": Font(name="Calibri", size=10, bold=True, color="5B21B6"),
        "row_fill": PatternFill(start_color="FAF5FF", end_color="FAF5FF", fill_type="solid"),
    },
    "AMBIGUOUS": {
        "badge_fill": PatternFill(start_color="FEF3C7", end_color="FEF3C7", fill_type="solid"),
        "badge_font": Font(name="Calibri", size=10, bold=True, color="92400E"),
        "row_fill": PatternFill(start_color="FFFDF5", end_color="FFFDF5", fill_type="solid"),
    },
    "GSTR_ONLY": {
        "badge_fill": PatternFill(start_color="FEE2E2", end_color="FEE2E2", fill_type="solid"),
        "badge_font": Font(name="Calibri", size=10, bold=True, color="991B1B"),
        "row_fill": PatternFill(start_color="FEF2F2", end_color="FEF2F2", fill_type="solid"),
    },
    "PR_ONLY": {
        "badge_fill": PatternFill(start_color="FFE4E6", end_color="FFE4E6", fill_type="solid"),
        "badge_font": Font(name="Calibri", size=10, bold=True, color="9F1239"),
        "row_fill": PatternFill(start_color="FFF1F2", end_color="FFF1F2", fill_type="solid"),
    },
}

THIN_BORDER = Border(
    left=Side(style="thin", color="E2E8F0"),
    right=Side(style="thin", color="E2E8F0"),
    top=Side(style="thin", color="E2E8F0"),
    bottom=Side(style="thin", color="E2E8F0"),
)


class ExportV2Service:
    """Generates auditable, multi-sheet, color-coded reconciliation packages in XLSX, CSV, or JSON."""

    def build_export(
        self,
        session_id: str,
        export_format: str = "xlsx",
        color_coded: bool = True,
        include_auxiliary: bool = True,
    ) -> tuple[bytes, str, str]:
        """
        Builds the reconciliation export package.
        Returns: (file_bytes, filename, media_type)
        """
        stage4_data = audit_v2_service.get_stage4_results(session_id)
        if not stage4_data or not isinstance(stage4_data, dict):
            raise ValueError(f"No completed reconciliation matrix found for session {session_id}.")

        session = audit_v2_service.get_session(session_id) or {}
        client_name = session.get("client_name") or "Enterprise Client"
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")

        if export_format == "csv":
            csv_bytes = self._build_csv(stage4_data, include_auxiliary)
            filename = f"TARS_Reconciliation_Ledger_{session_id[:8]}_{timestamp}.csv"
            return csv_bytes, filename, "text/csv"

        if export_format == "json":
            json_bytes = self._build_json(session_id, client_name, stage4_data)
            filename = f"TARS_Reconciliation_Payload_{session_id[:8]}_{timestamp}.json"
            return json_bytes, filename, "application/json"

        # Default: Excel (.xlsx)
        xlsx_bytes = self._build_excel(session_id, client_name, stage4_data, color_coded, include_auxiliary)
        filename = f"TARS_Reconciliation_Executive_Package_{session_id[:8]}_{timestamp}.xlsx"
        return xlsx_bytes, filename, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

    def _build_excel(
        self,
        session_id: str,
        client_name: str,
        data: dict[str, Any],
        color_coded: bool,
        include_auxiliary: bool,
    ) -> bytes:
        wb = openpyxl.Workbook()
        summary = data.get("summary", {})
        records = data.get("records", [])
        ambiguities = data.get("ambiguities", [])
        compared_cols = data.get("compared_columns", [])

        # -------------------------------------------------------------
        # SHEET 1: EXECUTIVE SUMMARY & AUDIT SCORECARD
        # -------------------------------------------------------------
        ws_sum = wb.active
        ws_sum.title = "Executive Summary"
        ws_sum.views.sheetView[0].showGridLines = True

        # Header Title
        ws_sum.merge_cells("A1:F1")
        top_cell = ws_sum["A1"]
        top_cell.value = "TARS RECONCILIATION 2.0 — EXECUTIVE COMPLIANCE & AUDIT REPORT"
        top_cell.font = Font(name="Calibri", size=14, bold=True, color="FFFFFF")
        top_cell.fill = NAVY_HEADER_FILL
        top_cell.alignment = Alignment(horizontal="center", vertical="center")
        ws_sum.row_dimensions[1].height = 36

        # Meta rows
        meta_items = [
            ("Client Entity:", client_name, "Session ID:", session_id),
            ("Generated At (UTC):", datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC"), "Reconciliation Accuracy:", f"{summary.get('overall_reconciliation_rate', 0.0)}%"),
            ("Total GSTR-2B Invoices:", f"{summary.get('total_gstr_rows', 0):,}", "Total Purchase Invoices:", f"{summary.get('total_pr_rows', 0):,}"),
        ]
        for r_idx, row in enumerate(meta_items, start=3):
            ws_sum.cell(row=r_idx, column=1, value=row[0]).font = Font(name="Calibri", size=10, bold=True, color="475569")
            ws_sum.cell(row=r_idx, column=2, value=row[1]).font = Font(name="Calibri", size=10, bold=True, color="0F172A")
            ws_sum.cell(row=r_idx, column=4, value=row[2]).font = Font(name="Calibri", size=10, bold=True, color="475569")
            ws_sum.cell(row=r_idx, column=5, value=row[3]).font = Font(name="Calibri", size=10, bold=True, color="0F172A")

        # KPI Table
        start_row = 7
        ws_sum.cell(row=start_row, column=1, value="STATUTORY MATCHING TIER BREAKDOWN").font = Font(name="Calibri", size=11, bold=True, color="00338D")
        start_row += 1

        kpi_headers = ["Tier / Pass Classification", "Matched Invoices", "Matched ITC (₹)", "Retention (%)", "Statutory Compliance Risk"]
        for c_idx, h in enumerate(kpi_headers, start=1):
            cell = ws_sum.cell(row=start_row, column=c_idx, value=h)
            cell.font = NAVY_HEADER_FONT
            cell.fill = NAVY_HEADER_FILL
            cell.alignment = Alignment(horizontal="center" if c_idx in (2, 3, 4) else "left", vertical="center")
            cell.border = THIN_BORDER
        ws_sum.row_dimensions[start_row].height = 24

        passes_data = summary.get("waterfall_passes", [])
        total_gstr = max(1, summary.get("total_gstr_rows", 1))

        risk_notes = {
            1: "Zero Risk • Clean GSTR-3B Auto-Drafted Claim",
            2: "Low Risk • Within Confirmed Section 16 Tolerances",
            3: "Moderate Risk • Semantic & Prefix Resolved Discrepancies",
            4: "Quarantined • Multi-Match Consensus Applied",
            5: "High Audit Exposure • Unclaimed / DRC-01C Notice Risk",
        }

        row_ptr = start_row + 1
        for p in passes_data:
            tier = p.get("tier", 1)
            name = p.get("name", f"Tier {tier}")
            count = p.get("matched_count", 0)
            itc = p.get("matched_itc", 0.0)
            pct = p.get("retention_percentage", round((count / total_gstr) * 100.0, 1))

            ws_sum.cell(row=row_ptr, column=1, value=name).font = Font(name="Calibri", size=10, bold=True)
            ws_sum.cell(row=row_ptr, column=2, value=count).number_format = "#,##0"
            ws_sum.cell(row=row_ptr, column=3, value=itc).number_format = "₹#,##0.00"
            ws_sum.cell(row=row_ptr, column=4, value=f"{pct}%").alignment = Alignment(horizontal="right")
            ws_sum.cell(row=row_ptr, column=5, value=risk_notes.get(tier, "Evaluated")).font = Font(name="Calibri", size=9.5, italic=True, color="64748B")

            for c_i in range(1, 6):
                ws_sum.cell(row=row_ptr, column=c_i).border = THIN_BORDER
            row_ptr += 1

        # Total Reconciled Summary
        ws_sum.cell(row=row_ptr, column=1, value="TOTAL RECONCILED / AUDIT YIELD").font = Font(name="Calibri", size=10, bold=True, color="00338D")
        ws_sum.cell(row=row_ptr, column=2, value=summary.get("total_reconciled_count", 0)).number_format = "#,##0"
        ws_sum.cell(row=row_ptr, column=3, value=summary.get("total_reconciled_itc", 0.0)).number_format = "₹#,##0.00"
        ws_sum.cell(row=row_ptr, column=4, value=f"{summary.get('overall_reconciliation_rate', 0.0)}%").alignment = Alignment(horizontal="right")
        ws_sum.cell(row=row_ptr, column=5, value="Legally Claimable in GSTR-3B").font = Font(name="Calibri", size=9.5, bold=True, color="166534")
        for c_i in range(1, 6):
            c = ws_sum.cell(row=row_ptr, column=c_i)
            c.border = THIN_BORDER
            c.fill = PatternFill(start_color="F1F5F9", end_color="F1F5F9", fill_type="solid")
            c.font = Font(name="Calibri", size=10, bold=True)

        row_ptr += 3

        # Active Rules Table
        if compared_cols:
            ws_sum.cell(row=row_ptr, column=1, value="STAGE 3 RULES EVALUATION MATRIX").font = Font(name="Calibri", size=11, bold=True, color="00338D")
            row_ptr += 1

            rule_headers = ["Rule Name", "Category", "Matching Strategy", "Government Column", "ERP Column", "Tolerance Bound"]
            for c_idx, h in enumerate(rule_headers, start=1):
                cell = ws_sum.cell(row=row_ptr, column=c_idx, value=h)
                cell.font = NAVY_HEADER_FONT
                cell.fill = NAVY_HEADER_FILL
                cell.alignment = Alignment(horizontal="center" if c_idx in (4, 5, 6) else "left", vertical="center")
                cell.border = THIN_BORDER
            row_ptr += 1

            for col_info in compared_cols:
                ws_sum.cell(row=row_ptr, column=1, value=col_info.get("rule_name", "Rule")).font = Font(name="Calibri", size=10, bold=True)
                ws_sum.cell(row=row_ptr, column=2, value=col_info.get("category", "COMMERCIAL"))
                ws_sum.cell(row=row_ptr, column=3, value=col_info.get("strategy", "EXACT"))
                ws_sum.cell(row=row_ptr, column=4, value=col_info.get("gstr_column", "—"))
                ws_sum.cell(row=row_ptr, column=5, value=col_info.get("pr_column", "—"))
                ws_sum.cell(row=row_ptr, column=6, value=col_info.get("tolerance_summary", "Zero Variance"))
                for c_i in range(1, 7):
                    ws_sum.cell(row=row_ptr, column=c_i).border = THIN_BORDER
                row_ptr += 1

        for c_idx in range(1, 7):
            ws_sum.column_dimensions[get_column_letter(c_idx)].width = 28

        # -------------------------------------------------------------
        # SHEET 2: RECONCILED LEDGER MATRIX
        # -------------------------------------------------------------
        ws_ledger = wb.create_sheet(title="Reconciled Ledger")
        ws_ledger.views.sheetView[0].showGridLines = True

        ledger_headers = [
            "Reconciliation ID",
            "Classification Category",
            "Matching Waterfall Pass",
            "Supplier GSTIN (2B)",
            "Document Number (2B)",
            "Invoice Date (2B)",
            "Taxable Value (2B)",
            "Tax Amount / ITC (2B)",
            "Total Value (2B)",
            "ERP Document # (PR)",
            "ERP Invoice Date (PR)",
            "ERP Taxable Value (PR)",
            "ERP Tax Amount (PR)",
            "ERP Total Value (PR)",
            "Taxable Variance (INR)",
            "Tax Amount Variance (INR)",
            "Date Delta (Days)",
            "AI & Deterministic Classification Rationale",
            "Lifecycle Provenance Trace",
        ]

        # Add auxiliary columns if present
        aux_names: list[str] = []
        if include_auxiliary and compared_cols:
            for c in compared_cols:
                fa = c.get("gstr_column")
                if fa and fa not in ("BillFromGstin", "DocumentNumber", "DocumentDate", "TaxableValue", "TotalValue", "TotalTaxAmount", "gstin", "document_number", "document_date", "taxable_value", "total_value", "tax_amount"):
                    aux_names.append(fa)
            for an in aux_names:
                ledger_headers.append(f"Tested Column ({an})")

        for c_idx, h in enumerate(ledger_headers, start=1):
            cell = ws_ledger.cell(row=1, column=c_idx, value=h)
            cell.font = NAVY_HEADER_FONT
            cell.fill = NAVY_HEADER_FILL
            cell.alignment = Alignment(horizontal="center", vertical="center")
            cell.border = THIN_BORDER
        ws_ledger.row_dimensions[1].height = 28

        for r_idx, rec in enumerate(records, start=2):
            bucket = rec.get("bucket", "UNMATCHED")
            g_prev = rec.get("gstr_preview", {})
            p_prev = rec.get("pr_preview", {})

            g_taxable = float(rec.get("taxable_value") or 0.0)
            g_tax = float(rec.get("tax_amount") or 0.0)
            g_total = float(rec.get("total_value") or 0.0)

            p_doc = p_prev.get("document_number") or p_prev.get("DocumentNumber") or ""
            p_date = p_prev.get("document_date") or p_prev.get("DocumentDate") or ""
            p_taxable = float(p_prev.get("taxable_value") or p_prev.get("TaxableValue") or 0.0)
            p_tax = float(p_prev.get("tax_amount") or p_prev.get("TotalTaxAmount") or 0.0)
            p_total = float(p_prev.get("total_value") or p_prev.get("TotalValue") or 0.0)

            taxable_diff = round(abs(g_taxable - p_taxable), 2) if (g_taxable > 0 and p_taxable > 0) else 0.0
            tax_diff = round(abs(g_tax - p_tax), 2) if (g_tax > 0 and p_tax > 0) else 0.0

            # Date delta
            diff_days = 0
            if rec.get("document_date") and p_date:
                try:
                    dt_g = pd.to_datetime(str(rec.get("document_date"))[:10], errors="coerce")
                    dt_p = pd.to_datetime(str(p_date)[:10], errors="coerce")
                    if pd.notna(dt_g) and pd.notna(dt_p):
                        diff_days = abs((dt_g - dt_p).days)
                except Exception:
                    diff_days = 0

            reason = rec.get("classification_reason") or rec.get("ai_reason") or "Reconciled"
            prov_note = rec.get("reclassification_note") or ("Reclassified from Ambiguous (Pass 4)" if rec.get("reclassified_from") else "Original Waterfall Classification")

            row_data = [
                rec.get("id", f"REC-{r_idx}"),
                bucket.replace("_", " ").title(),
                rec.get("matched_by_pass", bucket),
                rec.get("gstin", ""),
                rec.get("document_number", ""),
                rec.get("document_date", ""),
                g_taxable,
                g_tax,
                g_total,
                p_doc,
                p_date,
                p_taxable if p_taxable > 0 else "—",
                p_tax if p_tax > 0 else "—",
                p_total if p_total > 0 else "—",
                taxable_diff if (g_taxable > 0 and p_taxable > 0) else "—",
                tax_diff if (g_tax > 0 and p_tax > 0) else "—",
                f"{diff_days}d" if diff_days > 0 else "0d",
                reason,
                prov_note,
            ]

            for an in aux_names:
                g_val = g_prev.get(an) or "—"
                p_val = p_prev.get(an) or "—"
                row_data.append(f"GSTR: {g_val} | PR: {p_val}")

            st_info = STATUS_STYLES.get(bucket, {})
            row_fill = st_info.get("row_fill") if color_coded else None
            badge_fill = st_info.get("badge_fill") if color_coded else None
            badge_font = st_info.get("badge_font") if color_coded else None

            for c_idx, val in enumerate(row_data, start=1):
                cell = ws_ledger.cell(row=r_idx, column=c_idx, value=val)
                cell.border = THIN_BORDER
                if row_fill:
                    cell.fill = row_fill

                # Format category badge column specifically
                if c_idx == 2 and badge_fill and badge_font:
                    cell.fill = badge_fill
                    cell.font = badge_font
                    cell.alignment = Alignment(horizontal="center", vertical="center")
                elif c_idx in (7, 8, 9) and isinstance(val, (int, float)):
                    cell.number_format = "₹#,##0.00"
                    cell.alignment = Alignment(horizontal="right", vertical="center")
                elif c_idx in (12, 13, 14) and isinstance(val, (int, float)):
                    cell.number_format = "₹#,##0.00"
                    cell.alignment = Alignment(horizontal="right", vertical="center")
                elif c_idx in (15, 16) and isinstance(val, (int, float)):
                    cell.number_format = "₹#,##0.00"
                    cell.alignment = Alignment(horizontal="right", vertical="center")

            ws_ledger.row_dimensions[r_idx].height = 20

        # Adjust column widths
        col_widths = {
            1: 18, 2: 20, 3: 32, 4: 18, 5: 22, 6: 14,
            7: 18, 8: 18, 9: 18, 10: 22, 11: 14, 12: 18,
            13: 18, 14: 18, 15: 18, 16: 18, 17: 15,
            18: 60, 19: 40,
        }
        for c_idx, w in col_widths.items():
            ws_ledger.column_dimensions[get_column_letter(c_idx)].width = w

        # -------------------------------------------------------------
        # SHEET 3: DISAMBIGUATION & PROVENANCE AUDIT LOG
        # -------------------------------------------------------------
        ws_audit = wb.create_sheet(title="Audit & Provenance Log")
        ws_audit.views.sheetView[0].showGridLines = True

        audit_headers = [
            "Cluster ID",
            "Portal Document #",
            "Portal Taxable (₹)",
            "Candidate Count",
            "Resolution Status",
            "Selected ERP Candidate",
            "Resolution Timestamp",
            "AI Disambiguation Justification",
        ]
        for c_idx, h in enumerate(audit_headers, start=1):
            cell = ws_audit.cell(row=1, column=c_idx, value=h)
            cell.font = NAVY_HEADER_FONT
            cell.fill = NAVY_HEADER_FILL
            cell.alignment = Alignment(horizontal="center", vertical="center")
            cell.border = THIN_BORDER
        ws_audit.row_dimensions[1].height = 24

        for r_idx, clust in enumerate(ambiguities, start=2):
            anchor = clust.get("anchor_preview", {})
            cands = clust.get("candidates", [])
            row_items = [
                clust.get("cluster_id", f"CLUST-{r_idx}"),
                anchor.get("document_number") or anchor.get("DocumentNumber") or "—",
                float(anchor.get("taxable_value") or 0.0),
                len(cands),
                clust.get("status", "RESOLVED"),
                clust.get("resolved_pr_record_id") or "Reviewer Selected Candidate",
                clust.get("resolved_at") or datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"),
                clust.get("ai_justification") or "Quarantined for Human Review to prevent duplicate ITC claims.",
            ]
            for c_idx, val in enumerate(row_items, start=1):
                cell = ws_audit.cell(row=r_idx, column=c_idx, value=val)
                cell.border = THIN_BORDER
                if c_idx == 3 and isinstance(val, (int, float)):
                    cell.number_format = "₹#,##0.00"
                if c_idx in (4, 5):
                    cell.alignment = Alignment(horizontal="center", vertical="center")
            ws_audit.row_dimensions[r_idx].height = 20

        for c_idx, w in enumerate([18, 22, 18, 16, 18, 24, 24, 55], start=1):
            ws_audit.column_dimensions[get_column_letter(c_idx)].width = w

        out_stream = io.BytesIO()
        wb.save(out_stream)
        return out_stream.getvalue()

    def _build_csv(self, data: dict[str, Any], include_auxiliary: bool) -> bytes:
        records = data.get("records", [])
        compared_cols = data.get("compared_columns", [])

        aux_names: list[str] = []
        if include_auxiliary and compared_cols:
            for c in compared_cols:
                fa = c.get("gstr_column")
                if fa and fa not in ("BillFromGstin", "DocumentNumber", "DocumentDate", "TaxableValue", "TotalValue", "TotalTaxAmount", "gstin", "document_number", "document_date", "taxable_value", "total_value", "tax_amount"):
                    aux_names.append(fa)

        rows = []
        for rec in records:
            p_prev = rec.get("pr_preview", {})
            g_prev = rec.get("gstr_preview", {})

            row = {
                "Reconciliation_ID": rec.get("id"),
                "Classification_Bucket": rec.get("bucket"),
                "Matching_Pass": rec.get("matched_by_pass"),
                "Supplier_GSTIN_2B": rec.get("gstin"),
                "Document_Number_2B": rec.get("document_number"),
                "Invoice_Date_2B": rec.get("document_date"),
                "Taxable_Value_2B": rec.get("taxable_value"),
                "Tax_Amount_2B": rec.get("tax_amount"),
                "Total_Value_2B": rec.get("total_value"),
                "ERP_Document_Number_PR": p_prev.get("document_number") or p_prev.get("DocumentNumber") or "",
                "ERP_Invoice_Date_PR": p_prev.get("document_date") or p_prev.get("DocumentDate") or "",
                "ERP_Taxable_Value_PR": p_prev.get("taxable_value") or p_prev.get("TaxableValue") or 0.0,
                "ERP_Tax_Amount_PR": p_prev.get("tax_amount") or p_prev.get("TotalTaxAmount") or 0.0,
                "ERP_Total_Value_PR": p_prev.get("total_value") or p_prev.get("TotalValue") or 0.0,
                "AI_Classification_Rationale": rec.get("classification_reason") or rec.get("ai_reason") or "",
                "Lifecycle_Provenance_Trace": rec.get("reclassification_note") or "",
            }
            for an in aux_names:
                row[f"GSTR_{an}"] = g_prev.get(an, "")
                row[f"PR_{an}"] = p_prev.get(an, "")
            rows.append(row)

        df = pd.DataFrame(rows)
        return df.to_csv(index=False, encoding="utf-8").encode("utf-8")

    def _build_json(self, session_id: str, client_name: str, data: dict[str, Any]) -> bytes:
        payload = {
            "session_id": session_id,
            "client_name": client_name,
            "exported_at": datetime.now(timezone.utc).isoformat(),
            "summary": data.get("summary", {}),
            "records": data.get("records", []),
            "ambiguities": data.get("ambiguities", []),
            "compared_columns": data.get("compared_columns", []),
        }
        return json.dumps(payload, indent=2, ensure_ascii=False).encode("utf-8")

    def get_preview(self, session_id: str, limit: int = 50) -> dict[str, Any]:
        stage4_data = audit_v2_service.get_stage4_results(session_id)
        if not stage4_data or not isinstance(stage4_data, dict):
            raise ValueError(f"No completed reconciliation matrix found for session {session_id}.")
        records = stage4_data.get("records", [])
        summary = stage4_data.get("summary", {})
        compared_cols = stage4_data.get("compared_columns", [])

        preview_rows = []
        for rec in records[:limit]:
            p_prev = rec.get("pr_preview", {})
            g_prev = rec.get("gstr_preview", {})
            g_tax = float(rec.get("tax_amount") or 0.0)
            p_tax = float(p_prev.get("tax_amount") or p_prev.get("TotalTaxAmount") or 0.0)
            preview_rows.append({
                "id": rec.get("id"),
                "bucket": rec.get("bucket"),
                "matched_by_pass": rec.get("matched_by_pass"),
                "gstin": rec.get("gstin"),
                "gstr_doc": rec.get("document_number"),
                "pr_doc": p_prev.get("document_number") or p_prev.get("DocumentNumber") or "",
                "gstr_date": rec.get("document_date"),
                "pr_date": p_prev.get("document_date") or p_prev.get("DocumentDate") or "",
                "gstr_taxable": rec.get("taxable_value"),
                "pr_taxable": p_prev.get("taxable_value") or p_prev.get("TaxableValue") or 0.0,
                "gstr_tax": g_tax,
                "pr_tax": p_tax,
                "tax_diff": round(abs(g_tax - p_tax), 2),
                "ai_reason": rec.get("classification_reason") or rec.get("ai_reason") or "",
                "provenance": rec.get("reclassification_note") or "",
            })

        return {
            "total_records": len(records),
            "preview_records": preview_rows,
            "compared_columns": compared_cols,
            "summary": summary,
        }

    # =========================================================================
    # DYNAMIC COLUMN CATALOGUE & METADATA INTROSPECTION
    # =========================================================================

    def get_available_columns(self, session_id: str) -> dict[str, Any]:
        """
        Dynamically introspects and returns all available columns across 3 families:
        1. CALCULATED (Reconciliation Intelligence, Variances, AI Remarks, Provenance)
        2. GSTR (All original columns from the uploaded Government Excel)
        3. PR (All original columns from the uploaded Purchase Register Excel)
        Handles arbitrary column volumes (15 to 1,500+ cols) dynamically.
        """
        stage4_data = audit_v2_service.get_stage4_results(session_id) or {}
        records = stage4_data.get("records", [])
        session = audit_v2_service.get_session(session_id) or {}

        # 1. Calculated Family (Standard + Derived)
        calc_columns: list[ExportColumnDescriptor] = [
            ExportColumnDescriptor(
                id="calc_id",
                label="Reconciliation ID",
                family="CALCULATED",
                source_field="id",
                dtype="string",
                default_selected=True,
                description="Unique identifier for the reconciled transaction row",
            ),
            ExportColumnDescriptor(
                id="calc_bucket",
                label="Classification Bucket",
                family="CALCULATED",
                source_field="bucket",
                dtype="string",
                default_selected=True,
                description="Statutory outcome (EXACT_MATCH, TOLERANCE_MATCH, NEAR_MATCH, AMBIGUOUS, GSTR_ONLY, PR_ONLY)",
            ),
            ExportColumnDescriptor(
                id="calc_matched_by_pass",
                label="Matching Waterfall Pass",
                family="CALCULATED",
                source_field="matched_by_pass",
                dtype="string",
                default_selected=True,
                description="Tier & rule strategy that verified the match (e.g., Tier 1 - Strict Exact)",
            ),
            ExportColumnDescriptor(
                id="calc_taxable_variance",
                label="Taxable Variance (INR)",
                family="CALCULATED",
                source_field="taxable_variance",
                dtype="currency",
                default_selected=True,
                description="Absolute difference between 2B Taxable and PR Taxable value",
            ),
            ExportColumnDescriptor(
                id="calc_tax_variance",
                label="Tax Amount Variance (INR)",
                family="CALCULATED",
                source_field="tax_variance",
                dtype="currency",
                default_selected=True,
                description="Discrepancy in ITC claimed vs auto-drafted portal tax",
            ),
            ExportColumnDescriptor(
                id="calc_date_delta_days",
                label="Invoice Date Delta (Days)",
                family="CALCULATED",
                source_field="date_delta_days",
                dtype="number",
                default_selected=True,
                description="Calendar day disparity between vendor invoice date and ERP booking date",
            ),
            ExportColumnDescriptor(
                id="calc_ai_reason",
                label="AI & Deterministic Classification Rationale",
                family="CALCULATED",
                source_field="ai_reason",
                dtype="string",
                default_selected=True,
                description="Deterministic audit explanation or LLM cognitive reasoning justification",
            ),
            ExportColumnDescriptor(
                id="calc_lifecycle_provenance",
                label="Lifecycle Provenance Trace",
                family="CALCULATED",
                source_field="lifecycle_provenance",
                dtype="string",
                default_selected=True,
                description="Human-in-the-loop decision history, reclassifications, and audit trail",
            ),
            ExportColumnDescriptor(
                id="calc_reconciled_itc",
                label="Statutory Claimable ITC (INR)",
                family="CALCULATED",
                source_field="reconciled_itc",
                dtype="currency",
                default_selected=False,
                description="Audited ITC eligible to claim in GSTR-3B under Section 16(2)(aa)",
            ),
        ]

        # 2. Extract Government GSTR Columns dynamically from cached DF or preview records
        gstr_columns: list[ExportColumnDescriptor] = []
        seen_gstr_keys: set[str] = set()

        # Primary GSTR fields first
        primary_gstr = [
            ("gstr_gstin", "Supplier GSTIN [2B]", "gstin", "string"),
            ("gstr_document_number", "Document Number [2B]", "document_number", "string"),
            ("gstr_document_date", "Invoice Date [2B]", "document_date", "date"),
            ("gstr_taxable_value", "Taxable Value [2B]", "taxable_value", "currency"),
            ("gstr_tax_amount", "Tax Amount [2B]", "tax_amount", "currency"),
            ("gstr_total_value", "Total Invoice Value [2B]", "total_value", "currency"),
        ]
        for col_id, lbl, src, dt in primary_gstr:
            gstr_columns.append(
                ExportColumnDescriptor(
                    id=col_id,
                    label=lbl,
                    family="GSTR",
                    source_field=src,
                    dtype=dt,
                    default_selected=True,
                )
            )
            seen_gstr_keys.add(src.lower())

        # Probe auxiliary & raw GSTR columns from gstr_preview in records
        for rec in records[:100]:
            g_prev = rec.get("gstr_preview", {})
            for k, val in g_prev.items():
                k_clean = str(k).strip()
                k_low = k_clean.lower()
                if k_low not in seen_gstr_keys and k_clean:
                    seen_gstr_keys.add(k_low)
                    # Determine dtype heuristic
                    dt = "string"
                    if isinstance(val, (int, float)):
                        dt = "currency" if "amount" in k_low or "tax" in k_low or "val" in k_low else "number"
                    elif "date" in k_low:
                        dt = "date"
                    gstr_columns.append(
                        ExportColumnDescriptor(
                            id=f"gstr_raw_{k_clean}",
                            label=f"{k_clean} [2B]",
                            family="GSTR",
                            source_field=k_clean,
                            dtype=dt,
                            default_selected=False,
                        )
                    )

        # 3. Extract Purchase Register PR Columns dynamically from preview records
        pr_columns: list[ExportColumnDescriptor] = []
        seen_pr_keys: set[str] = set()

        # Primary PR fields first
        primary_pr = [
            ("pr_document_number", "ERP Document # [PR]", "document_number", "string"),
            ("pr_document_date", "ERP Invoice Date [PR]", "document_date", "date"),
            ("pr_taxable_value", "ERP Taxable Value [PR]", "taxable_value", "currency"),
            ("pr_tax_amount", "ERP Tax Amount [PR]", "tax_amount", "currency"),
            ("pr_total_value", "ERP Total Value [PR]", "total_value", "currency"),
        ]
        for col_id, lbl, src, dt in primary_pr:
            pr_columns.append(
                ExportColumnDescriptor(
                    id=col_id,
                    label=lbl,
                    family="PR",
                    source_field=src,
                    dtype=dt,
                    default_selected=True,
                )
            )
            seen_pr_keys.add(src.lower())

        for rec in records[:100]:
            p_prev = rec.get("pr_preview", {})
            for k, val in p_prev.items():
                k_clean = str(k).strip()
                k_low = k_clean.lower()
                if k_low not in seen_pr_keys and k_clean:
                    seen_pr_keys.add(k_low)
                    dt = "string"
                    if isinstance(val, (int, float)):
                        dt = "currency" if "amount" in k_low or "tax" in k_low or "val" in k_low else "number"
                    elif "date" in k_low:
                        dt = "date"
                    pr_columns.append(
                        ExportColumnDescriptor(
                            id=f"pr_raw_{k_clean}",
                            label=f"{k_clean} [PR]",
                            family="PR",
                            source_field=k_clean,
                            dtype=dt,
                            default_selected=False,
                        )
                    )

        return {
            "session_id": session_id,
            "total_available_columns": len(calc_columns) + len(gstr_columns) + len(pr_columns),
            "families": {
                "CALCULATED": calc_columns,
                "GSTR": gstr_columns,
                "PR": pr_columns,
            },
        }

    # =========================================================================
    # CUSTOM EXPORT COMPILER (XLSX, CSV, DSV, JSON)
    # =========================================================================

    def _extract_cell_value(self, rec: dict[str, Any], col_id: str) -> tuple[Any, str]:
        """
        Helper extracting value and default formatting type for any column ID.
        Returns: (raw_value, dtype)
        """
        p_prev = rec.get("pr_preview", {})
        g_prev = rec.get("gstr_preview", {})

        g_taxable = float(rec.get("taxable_value") or 0.0)
        g_tax = float(rec.get("tax_amount") or 0.0)
        p_taxable = float(p_prev.get("taxable_value") or p_prev.get("TaxableValue") or 0.0)
        p_tax = float(p_prev.get("tax_amount") or p_prev.get("TotalTaxAmount") or 0.0)

        # 1. Calculated Family
        if col_id == "calc_id":
            return rec.get("id", ""), "string"
        if col_id == "calc_bucket":
            return rec.get("bucket", "UNMATCHED").replace("_", " "), "string"
        if col_id == "calc_matched_by_pass":
            return rec.get("matched_by_pass", ""), "string"
        if col_id == "calc_taxable_variance":
            diff = round(abs(g_taxable - p_taxable), 2) if (g_taxable > 0 and p_taxable > 0) else 0.0
            return diff, "currency"
        if col_id == "calc_tax_variance":
            diff = round(abs(g_tax - p_tax), 2) if (g_tax > 0 and p_tax > 0) else 0.0
            return diff, "currency"
        if col_id == "calc_date_delta_days":
            p_date = p_prev.get("document_date") or p_prev.get("DocumentDate") or ""
            diff_days = 0
            if rec.get("document_date") and p_date:
                try:
                    dt_g = pd.to_datetime(str(rec.get("document_date"))[:10], errors="coerce")
                    dt_p = pd.to_datetime(str(p_date)[:10], errors="coerce")
                    if pd.notna(dt_g) and pd.notna(dt_p):
                        diff_days = abs((dt_g - dt_p).days)
                except Exception:
                    diff_days = 0
            return diff_days, "number"
        if col_id == "calc_ai_reason":
            return rec.get("classification_reason") or rec.get("ai_reason") or "Deterministic match verified.", "string"
        if col_id == "calc_lifecycle_provenance":
            return rec.get("reclassification_note") or ("Reclassified from Ambiguous" if rec.get("reclassified_from") else "Original Waterfall Classification"), "string"
        if col_id == "calc_reconciled_itc":
            bucket = rec.get("bucket", "")
            return (g_tax if bucket in ("EXACT_MATCH", "TOLERANCE_MATCH", "NEAR_MATCH") else 0.0), "currency"

        # 2. GSTR Primary
        if col_id == "gstr_gstin":
            return rec.get("gstin", ""), "string"
        if col_id == "gstr_document_number":
            return rec.get("document_number", ""), "string"
        if col_id == "gstr_document_date":
            return rec.get("document_date", ""), "date"
        if col_id == "gstr_taxable_value":
            return g_taxable, "currency"
        if col_id == "gstr_tax_amount":
            return g_tax, "currency"
        if col_id == "gstr_total_value":
            return float(rec.get("total_value") or 0.0), "currency"

        # 3. PR Primary
        if col_id == "pr_document_number":
            return p_prev.get("document_number") or p_prev.get("DocumentNumber") or "", "string"
        if col_id == "pr_document_date":
            return p_prev.get("document_date") or p_prev.get("DocumentDate") or "", "date"
        if col_id == "pr_taxable_value":
            return p_taxable, "currency"
        if col_id == "pr_tax_amount":
            return p_tax, "currency"
        if col_id == "pr_total_value":
            return float(p_prev.get("total_value") or p_prev.get("TotalValue") or 0.0), "currency"

        # 4. Raw dynamic auxiliary GSTR columns
        if col_id.startswith("gstr_raw_"):
            raw_k = col_id.replace("gstr_raw_", "")
            return g_prev.get(raw_k, ""), "string"

        # 5. Raw dynamic auxiliary PR columns
        if col_id.startswith("pr_raw_"):
            raw_k = col_id.replace("pr_raw_", "")
            return p_prev.get(raw_k, ""), "string"

        # Direct fallback check in preview dicts
        if col_id in g_prev:
            return g_prev.get(col_id, ""), "string"
        if col_id in p_prev:
            return p_prev.get(col_id, ""), "string"
        return rec.get(col_id, ""), "string"

    def build_custom_export(
        self,
        session_id: str,
        request: CustomExportRequest,
    ) -> tuple[bytes, str, str]:
        """
        Builds a custom user-designed export file in XLSX, CSV, DSV, or JSON.
        Returns: (file_bytes, filename, media_type)
        """
        stage4_data = audit_v2_service.get_stage4_results(session_id)
        if not stage4_data or not isinstance(stage4_data, dict):
            raise ValueError(f"No completed reconciliation matrix found for session {session_id}.")

        session = audit_v2_service.get_session(session_id) or {}
        client_name = session.get("client_name") or "Enterprise Client"
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        fmt = (request.export_format or "xlsx").lower().strip()

        if fmt == "csv":
            content = self._build_custom_delimited(stage4_data, request.columns, delimiter=",")
            return content, f"TARS_Custom_Ledger_{session_id[:8]}_{timestamp}.csv", "text/csv"

        if fmt == "dsv":
            sep = request.delimiter or "|"
            content = self._build_custom_delimited(stage4_data, request.columns, delimiter=sep)
            return content, f"TARS_Custom_Ledger_{session_id[:8]}_{timestamp}.dsv", "text/plain"

        if fmt == "json":
            content = self._build_custom_json(session_id, client_name, stage4_data, request.columns)
            return content, f"TARS_Custom_Payload_{session_id[:8]}_{timestamp}.json", "application/json"

        # Default: Excel (.xlsx) with embedded openpyxl styles and conditional formatting
        xlsx_bytes = self._build_custom_excel(session_id, client_name, stage4_data, request)
        filename = f"TARS_Custom_Ledger_{session_id[:8]}_{timestamp}.xlsx"
        return xlsx_bytes, filename, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

    def _build_custom_delimited(
        self,
        data: dict[str, Any],
        columns: list[ActiveExportColumn],
        delimiter: str = ",",
    ) -> bytes:
        records = data.get("records", [])
        if not columns:
            # Fallback to standard
            return self._build_csv(data, include_auxiliary=True)

        rows = []
        headers = [col.alias or col.id for col in columns]

        for rec in records:
            row_dict = {}
            for col, h in zip(columns, headers):
                val, _ = self._extract_cell_value(rec, col.id)
                row_dict[h] = val
            rows.append(row_dict)

        df = pd.DataFrame(rows)
        return df.to_csv(index=False, sep=delimiter, encoding="utf-8").encode("utf-8")

    def _build_custom_json(
        self,
        session_id: str,
        client_name: str,
        data: dict[str, Any],
        columns: list[ActiveExportColumn],
    ) -> bytes:
        records = data.get("records", [])
        extracted_records = []
        headers = [col.alias or col.id for col in columns]

        for rec in records:
            row_obj = {}
            for col, h in zip(columns, headers):
                val, _ = self._extract_cell_value(rec, col.id)
                row_obj[h] = val
            extracted_records.append(row_obj)

        payload = {
            "session_id": session_id,
            "client_name": client_name,
            "exported_at": datetime.now(timezone.utc).isoformat(),
            "total_records": len(extracted_records),
            "columns": [c.model_dump() for c in columns],
            "records": extracted_records,
            "summary": data.get("summary", {}),
        }
        return json.dumps(payload, indent=2, ensure_ascii=False).encode("utf-8")

    def _build_custom_excel(
        self,
        session_id: str,
        client_name: str,
        data: dict[str, Any],
        request: CustomExportRequest,
    ) -> bytes:
        wb = openpyxl.Workbook()
        records = data.get("records", [])
        summary = data.get("summary", {})
        active_cols = request.columns

        # -------------------------------------------------------------
        # SHEET 1: EXECUTIVE SUMMARY (OPTIONAL)
        # -------------------------------------------------------------
        if request.include_summary_sheet:
            ws_sum = wb.active
            ws_sum.title = "Executive Summary"
            ws_sum.views.sheetView[0].showGridLines = True

            ws_sum.merge_cells("A1:F1")
            top_cell = ws_sum["A1"]
            top_cell.value = "TARS RECONCILIATION 2.0 — EXECUTIVE COMPLIANCE & AUDIT REPORT"
            top_cell.font = Font(name="Calibri", size=14, bold=True, color="FFFFFF")
            top_cell.fill = NAVY_HEADER_FILL
            top_cell.alignment = Alignment(horizontal="center", vertical="center")
            ws_sum.row_dimensions[1].height = 36

            meta_items = [
                ("Client Entity:", client_name, "Session ID:", session_id),
                ("Generated At (UTC):", datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC"), "Reconciliation Accuracy:", f"{summary.get('overall_reconciliation_rate', 0.0)}%"),
                ("Total GSTR-2B Invoices:", f"{summary.get('total_gstr_rows', 0):,}", "Total Purchase Invoices:", f"{summary.get('total_pr_rows', 0):,}"),
            ]
            for r_idx, row in enumerate(meta_items, start=3):
                ws_sum.cell(row=r_idx, column=1, value=row[0]).font = Font(name="Calibri", size=10, bold=True, color="475569")
                ws_sum.cell(row=r_idx, column=2, value=row[1]).font = Font(name="Calibri", size=10, bold=True, color="0F172A")
                ws_sum.cell(row=r_idx, column=4, value=row[2]).font = Font(name="Calibri", size=10, bold=True, color="475569")
                ws_sum.cell(row=r_idx, column=5, value=row[3]).font = Font(name="Calibri", size=10, bold=True, color="0F172A")

            passes_data = summary.get("waterfall_passes", [])
            start_row = 7
            ws_sum.cell(row=start_row, column=1, value="STATUTORY MATCHING TIER BREAKDOWN").font = Font(name="Calibri", size=11, bold=True, color="00338D")
            start_row += 1
            kpi_headers = ["Tier / Pass Classification", "Matched Invoices", "Matched ITC (₹)", "Retention (%)", "Statutory Compliance Risk"]
            for c_idx, h in enumerate(kpi_headers, start=1):
                cell = ws_sum.cell(row=start_row, column=c_idx, value=h)
                cell.font = NAVY_HEADER_FONT
                cell.fill = NAVY_HEADER_FILL
                cell.alignment = Alignment(horizontal="center" if c_idx in (2, 3, 4) else "left", vertical="center")
                cell.border = THIN_BORDER
            ws_sum.row_dimensions[start_row].height = 24

            row_ptr = start_row + 1
            for p in passes_data:
                ws_sum.cell(row=row_ptr, column=1, value=p.get("name", "Tier")).font = Font(name="Calibri", size=10, bold=True)
                ws_sum.cell(row=row_ptr, column=2, value=p.get("matched_count", 0)).number_format = "#,##0"
                ws_sum.cell(row=row_ptr, column=3, value=p.get("matched_itc", 0.0)).number_format = "₹#,##0.00"
                ws_sum.cell(row=row_ptr, column=4, value=f"{p.get('retention_percentage', 0.0)}%").alignment = Alignment(horizontal="right")
                ws_sum.cell(row=row_ptr, column=5, value="Legally claimable in GSTR-3B").font = Font(name="Calibri", size=9.5, italic=True, color="64748B")
                for c_i in range(1, 6):
                    ws_sum.cell(row=row_ptr, column=c_i).border = THIN_BORDER
                row_ptr += 1

            for c_idx in range(1, 7):
                ws_sum.column_dimensions[get_column_letter(c_idx)].width = 28

            ws_ledger = wb.create_sheet(title="Custom Ledger")
        else:
            ws_ledger = wb.active
            ws_ledger.title = "Custom Ledger"

        ws_ledger.views.sheetView[0].showGridLines = True

        # -------------------------------------------------------------
        # SHEET 2: USER-DESIGNED CUSTOM ORDERED LEDGER
        # -------------------------------------------------------------
        headers = [c.alias or c.id for c in active_cols]

        # Write custom header row
        for c_idx, col_cfg in enumerate(active_cols, start=1):
            cell = ws_ledger.cell(row=1, column=c_idx, value=col_cfg.alias or col_cfg.id)
            cell.border = THIN_BORDER

            # Custom header color if configured
            if col_cfg.header_color:
                clean_hex = col_cfg.header_color.replace("#", "").upper()
                cell.fill = PatternFill(start_color=clean_hex, end_color=clean_hex, fill_type="solid")
                cell.font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
            else:
                cell.fill = NAVY_HEADER_FILL
                cell.font = NAVY_HEADER_FONT

            cell.alignment = Alignment(horizontal="center", vertical="center")

        ws_ledger.row_dimensions[1].height = 28

        # Write data rows
        for r_idx, rec in enumerate(records, start=2):
            bucket = rec.get("bucket", "UNMATCHED")
            st_info = STATUS_STYLES.get(bucket, {})
            status_row_fill = st_info.get("row_fill") if request.color_coded else None

            for c_idx, col_cfg in enumerate(active_cols, start=1):
                val, dtype = self._extract_cell_value(rec, col_cfg.id)
                cell = ws_ledger.cell(row=r_idx, column=c_idx, value=val)
                cell.border = THIN_BORDER

                # Column-level custom fill or global status row fill
                if col_cfg.fill_color:
                    clean_fill = col_cfg.fill_color.replace("#", "").upper()
                    cell.fill = PatternFill(start_color=clean_fill, end_color=clean_fill, fill_type="solid")
                elif status_row_fill:
                    cell.fill = status_row_fill

                # Number formatting
                if col_cfg.number_format:
                    cell.number_format = col_cfg.number_format
                    cell.alignment = Alignment(horizontal="right", vertical="center")
                elif dtype == "currency" and isinstance(val, (int, float)):
                    cell.number_format = "₹#,##0.00"
                    cell.alignment = Alignment(horizontal="right", vertical="center")
                elif dtype == "number" and isinstance(val, (int, float)):
                    cell.number_format = "#,##0"
                    cell.alignment = Alignment(horizontal="right", vertical="center")

            ws_ledger.row_dimensions[r_idx].height = 20

        # Adjust column widths automatically
        for c_idx, h in enumerate(headers, start=1):
            col_letter = get_column_letter(c_idx)
            max_len = max(len(str(h)) + 4, 16)
            ws_ledger.column_dimensions[col_letter].width = min(max_len, 45)

        # -------------------------------------------------------------
        # INJECT CONDITIONAL FORMATTING RULES INTO OPENPYXL
        # -------------------------------------------------------------
        if request.conditional_rules and records:
            last_row = len(records) + 1
            col_id_to_idx = {c.id: idx for idx, c in enumerate(active_cols, start=1)}

            for cr in request.conditional_rules:
                if cr.column_id in col_id_to_idx:
                    c_idx = col_id_to_idx[cr.column_id]
                    col_letter = get_column_letter(c_idx)
                    cell_range = f"{col_letter}2:{col_letter}{last_row}"

                    bg_clean = cr.bg_color.replace("#", "").upper()
                    tx_clean = cr.text_color.replace("#", "").upper()
                    rule_fill = PatternFill(start_color=bg_clean, end_color=bg_clean, fill_type="solid")
                    rule_font = Font(color=tx_clean, bold=cr.is_bold)

                    try:
                        op = cr.operator.upper()
                        if op == "CONTAINS":
                            # openpyxl FormulaRule for substring contains
                            formula = [f'ISNUMBER(SEARCH("{cr.value1}",{col_letter}2))']
                            rule = FormulaRule(formula=formula, stopIfTrue=True, fill=rule_fill, font=rule_font)
                            ws_ledger.conditional_formatting.add(cell_range, rule)
                        elif op == "EQUALS":
                            rule = CellIsRule(operator="equal", formula=[f'"{cr.value1}"'], stopIfTrue=True, fill=rule_fill, font=rule_font)
                            ws_ledger.conditional_formatting.add(cell_range, rule)
                        elif op == "GREATER_THAN":
                            rule = CellIsRule(operator="greaterThan", formula=[str(cr.value1)], stopIfTrue=True, fill=rule_fill, font=rule_font)
                            ws_ledger.conditional_formatting.add(cell_range, rule)
                        elif op == "LESS_THAN":
                            rule = CellIsRule(operator="lessThan", formula=[str(cr.value1)], stopIfTrue=True, fill=rule_fill, font=rule_font)
                            ws_ledger.conditional_formatting.add(cell_range, rule)
                        elif op == "BETWEEN" and cr.value2:
                            rule = CellIsRule(operator="between", formula=[str(cr.value1), str(cr.value2)], stopIfTrue=True, fill=rule_fill, font=rule_font)
                            ws_ledger.conditional_formatting.add(cell_range, rule)
                    except Exception as rule_err:
                        logger.warning(f"Could not compile conditional rule {cr.id} into openpyxl: {rule_err}")

        # -------------------------------------------------------------
        # SHEET 3: AUDIT & PROVENANCE (OPTIONAL)
        # -------------------------------------------------------------
        if request.include_audit_sheet:
            ambiguities = data.get("ambiguities", [])
            ws_audit = wb.create_sheet(title="Audit & Provenance Log")
            ws_audit.views.sheetView[0].showGridLines = True

            audit_headers = ["Cluster ID", "Portal Document #", "Portal Taxable (₹)", "Candidate Count", "Resolution Status", "Selected ERP Candidate", "Resolution Timestamp", "AI Disambiguation Justification"]
            for c_idx, h in enumerate(audit_headers, start=1):
                cell = ws_audit.cell(row=1, column=c_idx, value=h)
                cell.font = NAVY_HEADER_FONT
                cell.fill = NAVY_HEADER_FILL
                cell.alignment = Alignment(horizontal="center", vertical="center")
                cell.border = THIN_BORDER
            ws_audit.row_dimensions[1].height = 24

            for r_idx, clust in enumerate(ambiguities, start=2):
                anchor = clust.get("anchor_preview", {})
                cands = clust.get("candidates", [])
                row_items = [
                    clust.get("cluster_id", f"CLUST-{r_idx}"),
                    anchor.get("document_number") or anchor.get("DocumentNumber") or "—",
                    float(anchor.get("taxable_value") or 0.0),
                    len(cands),
                    clust.get("status", "RESOLVED"),
                    clust.get("resolved_pr_record_id") or "Reviewer Selected Candidate",
                    clust.get("resolved_at") or datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"),
                    clust.get("ai_justification") or "Quarantined for Human Review to prevent duplicate ITC claims.",
                ]
                for c_idx, val in enumerate(row_items, start=1):
                    cell = ws_audit.cell(row=r_idx, column=c_idx, value=val)
                    cell.border = THIN_BORDER
                    if c_idx == 3 and isinstance(val, (int, float)):
                        cell.number_format = "₹#,##0.00"
                    if c_idx in (4, 5):
                        cell.alignment = Alignment(horizontal="center", vertical="center")
                ws_audit.row_dimensions[r_idx].height = 20

            for c_idx, w in enumerate([18, 22, 18, 16, 18, 24, 24, 55], start=1):
                ws_audit.column_dimensions[get_column_letter(c_idx)].width = w

        out_stream = io.BytesIO()
        wb.save(out_stream)
        return out_stream.getvalue()

    # =========================================================================
    # PRESETS & TEMPLATES PERSISTENCE
    # =========================================================================

    def _get_presets_path(self) -> Path:
        from app.services.audit_v2_service import AUDIT_V2_DIR
        presets_dir = AUDIT_V2_DIR
        presets_dir.mkdir(parents=True, exist_ok=True)
        return presets_dir / "export_presets.json"

    def get_presets(self) -> list[ExportPreset]:
        """Returns all system built-in presets plus user saved presets from disk."""
        path = self._get_presets_path()
        system_presets = self._build_default_system_presets()
        if not path.exists():
            return system_presets

        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            user_presets = [ExportPreset(**p) for p in data]
            # Merge system and user presets
            return system_presets + user_presets
        except Exception as exc:
            logger.warning(f"Could not read custom export presets from {path}: {exc}")
            return system_presets

    def save_preset(self, preset: ExportPreset) -> list[ExportPreset]:
        """Saves a user preset to disk."""
        path = self._get_presets_path()
        existing_user: list[dict[str, Any]] = []
        if path.exists():
            try:
                with open(path, "r", encoding="utf-8") as f:
                    existing_user = json.load(f)
            except Exception:
                existing_user = []

        # Update or append
        updated = False
        preset_dict = preset.model_dump()
        preset_dict["is_system"] = False
        preset_dict["created_at"] = datetime.now(timezone.utc).isoformat()

        for idx, item in enumerate(existing_user):
            if item.get("id") == preset.id or item.get("name") == preset.name:
                existing_user[idx] = preset_dict
                updated = True
                break
        if not updated:
            existing_user.append(preset_dict)

        with open(path, "w", encoding="utf-8") as f:
            json.dump(existing_user, f, indent=2)

        return self.get_presets()

    def delete_preset(self, preset_id: str) -> list[ExportPreset]:
        """Deletes a custom preset by ID."""
        path = self._get_presets_path()
        if not path.exists():
            return self.get_presets()
        try:
            with open(path, "r", encoding="utf-8") as f:
                existing = json.load(f)
            filtered = [p for p in existing if p.get("id") != preset_id]
            with open(path, "w", encoding="utf-8") as f:
                json.dump(filtered, f, indent=2)
        except Exception as exc:
            logger.error(f"Error deleting preset {preset_id}: {exc}")
        return self.get_presets()

    def _build_default_system_presets(self) -> list[ExportPreset]:
        """Generates 4 industry-standard default presets."""
        return [
            ExportPreset(
                id="preset_kpmg_statutory",
                name="KPMG Statutory Audit Package",
                description="Audited ledger with primary GSTR vs PR columns, variance analytics, and classification rationale",
                is_system=True,
                columns=[
                    ActiveExportColumn(id="calc_id", alias="Reconciliation ID", header_color="#00338D"),
                    ActiveExportColumn(id="calc_bucket", alias="Classification Category", header_color="#00338D"),
                    ActiveExportColumn(id="calc_matched_by_pass", alias="Matching Pass Tier", header_color="#00338D"),
                    ActiveExportColumn(id="gstr_gstin", alias="Supplier GSTIN (2B)"),
                    ActiveExportColumn(id="gstr_document_number", alias="Document Number (2B)"),
                    ActiveExportColumn(id="gstr_document_date", alias="Invoice Date (2B)"),
                    ActiveExportColumn(id="gstr_taxable_value", alias="Taxable Value (2B)"),
                    ActiveExportColumn(id="gstr_tax_amount", alias="Tax Amount / ITC (2B)"),
                    ActiveExportColumn(id="pr_document_number", alias="ERP Document # (PR)"),
                    ActiveExportColumn(id="pr_document_date", alias="ERP Invoice Date (PR)"),
                    ActiveExportColumn(id="pr_taxable_value", alias="ERP Taxable Value (PR)"),
                    ActiveExportColumn(id="pr_tax_amount", alias="ERP Tax Amount (PR)"),
                    ActiveExportColumn(id="calc_taxable_variance", alias="Taxable Variance (INR)"),
                    ActiveExportColumn(id="calc_tax_variance", alias="Tax Variance (INR)"),
                    ActiveExportColumn(id="calc_date_delta_days", alias="Date Delta (Days)"),
                    ActiveExportColumn(id="calc_ai_reason", alias="AI & Deterministic Rationale"),
                    ActiveExportColumn(id="calc_lifecycle_provenance", alias="Lifecycle Provenance"),
                ],
                conditional_rules=[
                    ConditionalFormattingRule(
                        id="rule_tax_diff",
                        column_id="calc_tax_variance",
                        operator="GREATER_THAN",
                        value1="100",
                        bg_color="#FEE2E2",
                        text_color="#991B1B",
                        is_bold=True,
                    ),
                    ConditionalFormattingRule(
                        id="rule_bucket_exact",
                        column_id="calc_bucket",
                        operator="CONTAINS",
                        value1="EXACT",
                        bg_color="#DCFCE7",
                        text_color="#166534",
                        is_bold=True,
                    ),
                ],
            ),
            ExportPreset(
                id="preset_dual_ledger_dump",
                name="360° Dual Ledger Complete Dump",
                description="Side-by-side reconciliation including all computed fields, raw GSTR columns, and raw PR columns",
                is_system=True,
                columns=[
                    ActiveExportColumn(id="calc_id", alias="Rec ID"),
                    ActiveExportColumn(id="calc_bucket", alias="Status"),
                    ActiveExportColumn(id="gstr_gstin", alias="2B Supplier GSTIN"),
                    ActiveExportColumn(id="gstr_document_number", alias="2B Doc #"),
                    ActiveExportColumn(id="pr_document_number", alias="PR Doc #"),
                    ActiveExportColumn(id="gstr_taxable_value", alias="2B Taxable"),
                    ActiveExportColumn(id="pr_taxable_value", alias="PR Taxable"),
                    ActiveExportColumn(id="calc_taxable_variance", alias="Taxable Disparity"),
                    ActiveExportColumn(id="gstr_tax_amount", alias="2B Tax"),
                    ActiveExportColumn(id="pr_tax_amount", alias="PR Tax"),
                    ActiveExportColumn(id="calc_tax_variance", alias="Tax Disparity"),
                ],
                conditional_rules=[],
            ),
            ExportPreset(
                id="preset_itc_variance_focus",
                name="ITC Discrepancy & Variance Focus",
                description="Tailored for tax teams to investigate DRC-01C mismatches and tax delta exposures",
                is_system=True,
                columns=[
                    ActiveExportColumn(id="calc_id", alias="Reconciliation Ref"),
                    ActiveExportColumn(id="calc_bucket", alias="Audit Bucket"),
                    ActiveExportColumn(id="gstr_gstin", alias="Vendor GSTIN"),
                    ActiveExportColumn(id="calc_tax_variance", alias="Net Tax Discrepancy (INR)", header_color="#991B1B"),
                    ActiveExportColumn(id="calc_taxable_variance", alias="Taxable Discrepancy (INR)", header_color="#991B1B"),
                    ActiveExportColumn(id="calc_ai_reason", alias="AI Discrepancy Root Cause"),
                ],
                conditional_rules=[
                    ConditionalFormattingRule(
                        id="rule_high_tax_discrepancy",
                        column_id="calc_tax_variance",
                        operator="GREATER_THAN",
                        value1="0",
                        bg_color="#FEF2F2",
                        text_color="#991B1B",
                        is_bold=True,
                    )
                ],
            ),
            ExportPreset(
                id="preset_erp_pipe_dsv",
                name="ERP Ingestion Pipe-DSV Format",
                description="Pipe-separated ledger format with essential fields optimized for SAP and Oracle automated loaders",
                is_system=True,
                columns=[
                    ActiveExportColumn(id="calc_id", alias="REC_ID"),
                    ActiveExportColumn(id="calc_bucket", alias="STATUS"),
                    ActiveExportColumn(id="gstr_gstin", alias="VENDOR_GSTIN"),
                    ActiveExportColumn(id="pr_document_number", alias="ERP_DOC_NUM"),
                    ActiveExportColumn(id="pr_document_date", alias="ERP_DOC_DATE"),
                    ActiveExportColumn(id="pr_taxable_value", alias="ERP_TAXABLE"),
                    ActiveExportColumn(id="pr_tax_amount", alias="ERP_TAX"),
                    ActiveExportColumn(id="calc_tax_variance", alias="TAX_VARIANCE"),
                ],
                conditional_rules=[],
            ),
        ]


export_v2_service = ExportV2Service()

