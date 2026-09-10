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

logger = logging.getLogger(__name__)

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


export_v2_service = ExportV2Service()
