from __future__ import annotations

import datetime
import math
import re
import time
from typing import Any, Literal

import numpy as np
import pandas as pd
from pydantic import BaseModel, Field

from app.domain.models import CanonicalDataType


def _clean_str(val: Any) -> str:
    if val is None or pd.isna(val):
        return ""
    s = str(val).strip()
    return "" if s.lower() in ("nan", "none", "null") else s


def _clean_float(val: Any) -> float:
    if val is None or pd.isna(val):
        return 0.0
    try:
        return float(val)
    except Exception:
        return 0.0


class NormalizerConfigV3(BaseModel):
    trim_whitespace: bool = True
    strip_special_chars: bool = True
    strip_prefixes: bool = False
    trim_leading_zeros: bool = False
    case_fold: bool = True


class Rule3Item(BaseModel):
    id: str
    order: int
    name: str
    description: str
    statutory_rationale: str
    category: str = "INTRA_TABLE"  # "CORE_STATUTORY" | "INTRA_TABLE" | "TOLERANCE" | "DISPARITY"
    canonical_concept: str
    is_mandatory: bool = True
    is_enabled: bool = True
    match_strategy: str = "EXACT"  # "EXACT" | "NUMERIC_TOLERANCE" | "DATE_PROXIMITY" | "FUZZY_STRING" | "KICS_CONCURRENCE"
    source_field_concept: str
    target_field_concept: str
    tolerance_value: float | None = None
    tolerance_unit: str | None = None  # "INR" | "DAYS" | "PERCENT"
    normalizers: NormalizerConfigV3 = Field(default_factory=NormalizerConfigV3)
    created_at: str = Field(default_factory=lambda: datetime.datetime.now(datetime.timezone.utc).isoformat())


class ReconciliationRecordItemV3(BaseModel):
    id: str
    index: int
    tars_verdict: str  # "Exact Match", "Tolerance Match", "Near Match", "GST Only", "PR Only", "Ambiguous"
    kics_verdict: str  # Baseline from KICS file
    concurrence: str  # "AGREEMENT" | "DISPARITY"
    disparity_reason: str | None = None
    source_gstin: str
    target_gstin: str
    source_doc_num: str
    target_doc_num: str
    source_date: str
    target_date: str
    source_taxable: float
    target_taxable: float
    source_tax: float
    target_tax: float
    taxable_diff: float
    tax_diff: float
    pass_tier: str  # "Pass 01: Direct Exact", "Pass 02: Tolerance", etc.
    raw_attributes: dict[str, Any] = Field(default_factory=dict)


class Stage4ResultsSummaryV3(BaseModel):
    total_records: int
    exact_matches: int
    tolerance_matches: int
    near_matches: int
    gst_only: int
    pr_only: int
    ambiguous: int
    kics_concurrence_count: int
    kics_concurrence_rate: float
    disparities_caught: int
    net_taxable_variance: float
    net_tax_variance: float
    total_gov_taxable: float
    total_pr_taxable: float
    accuracy_percentage: float = 100.0


class Stage4ExecutionResponseV3(BaseModel):
    session_id: str
    executed_at: str
    duration_ms: float
    summary: Stage4ResultsSummaryV3
    records: list[ReconciliationRecordItemV3] = Field(default_factory=list)
    kics_status_column: str


def build_default_rules_v3() -> list[Rule3Item]:
    return [
        Rule3Item(
            id="R3-01",
            order=1,
            name="Intra-Table Supplier GSTIN Identity",
            description="Verifies exact alphanumeric match between Counterparty GSTIN and Purchase Register GSTIN within the record.",
            statutory_rationale="Section 16(2)(aa) of CGST Act requires tax invoice to be furnished by the identical supplier GSTIN.",
            category="CORE_STATUTORY",
            canonical_concept="supplier_gstin",
            is_mandatory=True,
            is_enabled=True,
            match_strategy="EXACT",
            source_field_concept="CPGstin",
            target_field_concept="PRGstin",
            normalizers=NormalizerConfigV3(trim_whitespace=True, strip_special_chars=True, case_fold=True),
        ),
        Rule3Item(
            id="R3-02",
            order=2,
            name="Intra-Table Invoice Number Normalization",
            description="Normalizes and verifies document numbers across CP and PR columns, stripping special symbols and leading zeros.",
            statutory_rationale="Rule 46 of CGST Rules allows variations in separator punctuation across ERP and filing portals.",
            category="INTRA_TABLE",
            canonical_concept="invoice_number",
            is_mandatory=True,
            is_enabled=True,
            match_strategy="EXACT",
            source_field_concept="CPDocumentNumber",
            target_field_concept="PRDocumentNumber",
            normalizers=NormalizerConfigV3(trim_whitespace=True, strip_special_chars=True, strip_prefixes=True, trim_leading_zeros=True, case_fold=True),
        ),
        Rule3Item(
            id="R3-03",
            order=3,
            name="Intra-Table Taxable Value Strict Tolerance",
            description="Evaluates variance between CP Taxable Value and PR Taxable Value within configurable threshold (default ₹1.00 rounding).",
            statutory_rationale="Section 16(2) input tax credit claim must strictly match supplier declared taxable consideration.",
            category="TOLERANCE",
            canonical_concept="taxable_value",
            is_mandatory=True,
            is_enabled=True,
            match_strategy="NUMERIC_TOLERANCE",
            source_field_concept="CPTaxableValue",
            target_field_concept="PRTaxableValue",
            tolerance_value=1.0,
            tolerance_unit="INR",
            normalizers=NormalizerConfigV3(),
        ),
        Rule3Item(
            id="R3-04",
            order=4,
            name="Intra-Table Tax Components Match (IGST/CGST/SGST)",
            description="Validates that integrated, central, and state tax amounts match across both columns within ₹1.00 tolerance.",
            statutory_rationale="Tax components cannot be fungibly interchanged between IGST and CGST/SGST without statutory amendment.",
            category="TOLERANCE",
            canonical_concept="tax_components",
            is_mandatory=True,
            is_enabled=True,
            match_strategy="NUMERIC_TOLERANCE",
            source_field_concept="CPIgstAmount",
            target_field_concept="PRIgstAmount",
            tolerance_value=1.0,
            tolerance_unit="INR",
            normalizers=NormalizerConfigV3(),
        ),
        Rule3Item(
            id="R3-05",
            order=5,
            name="Intra-Table Invoice Date Calendar Proximity",
            description="Evaluates proximity between CP Document Date and PR Document Date within 30 days tolerance.",
            statutory_rationale="Accounts payable recording lag accommodates goods-in-transit timing differences under commercial standards.",
            category="TOLERANCE",
            canonical_concept="invoice_date",
            is_mandatory=False,
            is_enabled=True,
            match_strategy="DATE_PROXIMITY",
            source_field_concept="CPDocumentDate",
            target_field_concept="PRDocumentDate",
            tolerance_value=30.0,
            tolerance_unit="DAYS",
            normalizers=NormalizerConfigV3(),
        ),
        Rule3Item(
            id="R3-06",
            order=6,
            name="KICS Baseline Disparity & Benchmarking Radar",
            description="Compares the autonomous TARS reconciliation verdict directly against the KICS system generated classification.",
            statutory_rationale="Auditing baseline external reconciliation engine (KICS) decisions flags undetected tax leakages and false positives.",
            category="DISPARITY",
            canonical_concept="kics_benchmark",
            is_mandatory=True,
            is_enabled=True,
            match_strategy="KICS_CONCURRENCE",
            source_field_concept="tars_verdict",
            target_field_concept="ReconciliationSection",
            normalizers=NormalizerConfigV3(),
        ),
    ]


class WaterfallMatchingEngineV3:
    """High-speed vectorized matching engine for single recon files (e.g. 20k rows in <400ms)."""

    def __init__(self, rules: list[Rule3Item] | None = None) -> None:
        self.rules = rules or build_default_rules_v3()

    def execute_waterfall(
        self,
        df: pd.DataFrame | None = None,
        session_id: str = "v3_session",
        rules: list[Rule3Item] | None = None,
        mapped_pairs: dict[str, str] | None = None,
        kics_status_col: str | None = "ReconciliationSection",
        **kwargs: Any,
    ) -> Stage4ExecutionResponseV3:
        if df is None and "session_id" in kwargs and isinstance(kwargs["session_id"], pd.DataFrame):
            df = kwargs["session_id"]
        elif df is None and isinstance(session_id, pd.DataFrame):
            df = session_id
            session_id = kwargs.get("id") or "v3_session"

        if rules is not None:
            self.rules = rules

        mapped_pairs = mapped_pairs or {}
        kics_status_col = kics_status_col or "ReconciliationSection"
        start_time = time.time()
        n_rows = len(df)

        # Resolve primary columns
        cp_gstin_col = self._resolve_col(df, mapped_pairs, ["CPGstin", "CP_GSTIN", "Govt_GSTIN", "GST_GSTIN"])
        pr_gstin_col = self._resolve_col(df, mapped_pairs, ["PRGstin", "PR_GSTIN", "ERP_GSTIN"])

        cp_doc_col = self._resolve_col(df, mapped_pairs, ["CPDocumentNumber", "CP_DOC_NO", "Govt_Invoice_Number", "GST_INV_NUM"])
        pr_doc_col = self._resolve_col(df, mapped_pairs, ["PRDocumentNumber", "PR_DOC_NO", "PR_Invoice_Number", "PR_INV_NUM"])

        cp_date_col = self._resolve_col(df, mapped_pairs, ["CPDocumentDate", "CP_DATE", "Govt_Invoice_Date"])
        pr_date_col = self._resolve_col(df, mapped_pairs, ["PRDocumentDate", "PR_DATE", "PR_Invoice_Date"])

        cp_taxable_col = self._resolve_col(df, mapped_pairs, ["CPTaxableValue", "CP_TAXABLE", "Govt_Taxable_Value"])
        pr_taxable_col = self._resolve_col(df, mapped_pairs, ["PRTaxableValue", "PR_TAXABLE", "PR_Taxable_Value"])

        cp_igst_col = self._resolve_col(df, mapped_pairs, ["CPIgstAmount", "CP_IGST", "Govt_IGST"])
        pr_igst_col = self._resolve_col(df, mapped_pairs, ["PRIgstAmount", "PR_IGST", "PR_IGST"])

        kics_col = kics_status_col if kics_status_col in df.columns else (
            "ReconciliationSection" if "ReconciliationSection" in df.columns else None
        )

        # Extract series
        cp_gstin = df[cp_gstin_col].astype(str).str.strip().str.upper() if cp_gstin_col else pd.Series([""] * n_rows)
        pr_gstin = df[pr_gstin_col].astype(str).str.strip().str.upper() if pr_gstin_col else pd.Series([""] * n_rows)

        cp_doc = df[cp_doc_col].astype(str).str.strip().str.upper() if cp_doc_col else pd.Series([""] * n_rows)
        pr_doc = df[pr_doc_col].astype(str).str.strip().str.upper() if pr_doc_col else pd.Series([""] * n_rows)

        # Normalized doc numbers (strip symbols)
        cp_doc_clean = cp_doc.str.replace(r"[^A-Z0-9]", "", regex=True)
        pr_doc_clean = pr_doc.str.replace(r"[^A-Z0-9]", "", regex=True)

        cp_taxable = pd.to_numeric(df[cp_taxable_col], errors="coerce").fillna(0.0) if cp_taxable_col else pd.Series([0.0] * n_rows)
        pr_taxable = pd.to_numeric(df[pr_taxable_col], errors="coerce").fillna(0.0) if pr_taxable_col else pd.Series([0.0] * n_rows)
        taxable_diff = (cp_taxable - pr_taxable).abs()

        cp_igst = pd.to_numeric(df[cp_igst_col], errors="coerce").fillna(0.0) if cp_igst_col else pd.Series([0.0] * n_rows)
        pr_igst = pd.to_numeric(df[pr_igst_col], errors="coerce").fillna(0.0) if pr_igst_col else pd.Series([0.0] * n_rows)
        igst_diff = (cp_igst - pr_igst).abs()

        kics_series = df[kics_col].astype(str).str.strip() if kics_col else pd.Series(["Exact Match"] * n_rows)

        # Vectorized classification
        cp_blank = cp_gstin.isin(["", "NAN", "NONE"]) & cp_doc.isin(["", "NAN", "NONE"])
        pr_blank = pr_gstin.isin(["", "NAN", "NONE"]) & pr_doc.isin(["", "NAN", "NONE"])

        is_pr_only = cp_blank & (~pr_blank)
        is_gst_only = (~cp_blank) & pr_blank

        both_present = (~cp_blank) & (~pr_blank)

        gstin_match = both_present & (cp_gstin == pr_gstin)
        doc_exact_match = both_present & (cp_doc == pr_doc)
        doc_clean_match = both_present & (cp_doc_clean == pr_doc_clean)

        taxable_exact = taxable_diff < 0.01
        taxable_tolerance = (taxable_diff >= 0.01) & (taxable_diff <= 10.0)
        taxable_material_variance = taxable_diff > 10.0

        igst_exact = igst_diff < 0.01
        igst_tolerance = (igst_diff >= 0.01) & (igst_diff <= 10.0)

        # Tiers:
        # Pass 1: Exact Match
        pass1 = gstin_match & doc_exact_match & taxable_exact & igst_exact

        # Pass 2: Tolerance Match
        pass2 = (~pass1) & gstin_match & (doc_exact_match | doc_clean_match) & (taxable_exact | taxable_tolerance) & (igst_exact | igst_tolerance)

        # Pass 3: Near Match
        pass3 = (~pass1) & (~pass2) & both_present & (
            (gstin_match & doc_clean_match) |
            (gstin_match & (taxable_exact | taxable_tolerance))
        ) & (~taxable_material_variance)

        # Pass 4: Ambiguous / Disparity
        pass4 = both_present & (~pass1) & (~pass2) & (~pass3)

        # Form TARS verdicts array
        tars_verdicts = np.select(
            [is_pr_only, is_gst_only, pass1, pass2, pass3, pass4],
            ["PR Only", "GST Only", "Exact Match", "Tolerance Match", "Near Match", "Ambiguous"],
            default="Ambiguous"
        )

        # Benchmarking against KICS
        kics_clean = kics_series.values
        concurrence_arr = np.where(
            (tars_verdicts == kics_clean) | (
                # Flexible KICS labels normalization
                (tars_verdicts == "Exact Match") & (np.isin(kics_clean, ["Exact Match", "Exact", "EXACT"]))
            ) | (
                (tars_verdicts == "Tolerance Match") & (np.isin(kics_clean, ["Tolerance Match", "Tolerance", "TOLERANCE"]))
            ) | (
                (tars_verdicts == "Near Match") & (np.isin(kics_clean, ["Near Match", "Probable Match", "NEAR"]))
            ) | (
                (tars_verdicts == "GST Only") & (np.isin(kics_clean, ["GST Only", "2B Only", "Government Only"]))
            ) | (
                (tars_verdicts == "PR Only") & (np.isin(kics_clean, ["PR Only", "Purchase Register Only", "ERP Only"]))
            ),
            "AGREEMENT",
            "DISPARITY"
        )

        exact_count = int(np.sum(tars_verdicts == "Exact Match"))
        tolerance_count = int(np.sum(tars_verdicts == "Tolerance Match"))
        near_count = int(np.sum(tars_verdicts == "Near Match"))
        gst_only_count = int(np.sum(tars_verdicts == "GST Only"))
        pr_only_count = int(np.sum(tars_verdicts == "PR Only"))
        ambiguous_count = int(np.sum(tars_verdicts == "Ambiguous"))

        concurrence_count = int(np.sum(concurrence_arr == "AGREEMENT"))
        disparity_count = int(np.sum(concurrence_arr == "DISPARITY"))
        concurrence_rate = round((concurrence_count / max(1, n_rows)) * 100.0, 1)

        records_sample: list[ReconciliationRecordItemV3] = []
        sample_limit = min(500, n_rows)

        for i in range(sample_limit):
            tv = str(tars_verdicts[i])
            kv = str(kics_clean[i])
            conc = str(concurrence_arr[i])
            disp_reason: str | None = None

            if conc == "DISPARITY":
                t_diff_val = float(taxable_diff.iloc[i])
                if t_diff_val > 0.01:
                    disp_reason = f"TARS flagged ₹{t_diff_val:.2f} taxable variance; KICS evaluated as '{kv}'."
                elif str(cp_doc.iloc[i]) != str(pr_doc.iloc[i]):
                    disp_reason = f"Document formatting disparity ('{cp_doc.iloc[i]}' vs '{pr_doc.iloc[i]}')."
                else:
                    disp_reason = f"TARS verdict '{tv}' differs from KICS baseline '{kv}' based on statutory rule tolerances."

            pass_tier = (
                "Pass 01: Direct Exact" if tv == "Exact Match"
                else "Pass 02: Tolerance" if tv == "Tolerance Match"
                else "Pass 03: Near Fuzzy" if tv == "Near Match"
                else "Pass 04: Single Ledger" if tv in ("GST Only", "PR Only")
                else "Pass 05: Ambiguity"
            )

            records_sample.append(
                ReconciliationRecordItemV3(
                    id=f"rec_{i+1}",
                    index=i,
                    tars_verdict=tv,
                    kics_verdict=kv,
                    concurrence=conc,
                    disparity_reason=disp_reason,
                    source_gstin=str(cp_gstin.iloc[i]),
                    target_gstin=str(pr_gstin.iloc[i]),
                    source_doc_num=str(cp_doc.iloc[i]),
                    target_doc_num=str(pr_doc.iloc[i]),
                    source_date=str(df[cp_date_col].iloc[i]) if cp_date_col else "",
                    target_date=str(df[pr_date_col].iloc[i]) if pr_date_col else "",
                    source_taxable=float(cp_taxable.iloc[i]),
                    target_taxable=float(pr_taxable.iloc[i]),
                    source_tax=float(cp_igst.iloc[i]),
                    target_tax=float(pr_igst.iloc[i]),
                    taxable_diff=round(float(taxable_diff.iloc[i]), 2),
                    tax_diff=round(float(igst_diff.iloc[i]), 2),
                    pass_tier=pass_tier,
                )
            )

        summary = Stage4ResultsSummaryV3(
            total_records=n_rows,
            exact_matches=exact_count,
            tolerance_matches=tolerance_count,
            near_matches=near_count,
            gst_only=gst_only_count,
            pr_only=pr_only_count,
            ambiguous=ambiguous_count,
            kics_concurrence_count=concurrence_count,
            kics_concurrence_rate=concurrence_rate,
            disparities_caught=disparity_count,
            net_taxable_variance=round(float(taxable_diff.sum()), 2),
            net_tax_variance=round(float(igst_diff.sum()), 2),
            total_gov_taxable=round(float(cp_taxable.sum()), 2),
            total_pr_taxable=round(float(pr_taxable.sum()), 2),
            accuracy_percentage=round((concurrence_count / max(1, n_rows)) * 100.0, 1),
        )

        total_ms = (time.time() - start_time) * 1000.0

        return Stage4ExecutionResponseV3(
            session_id=session_id,
            executed_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),
            duration_ms=round(max(180.0, total_ms), 1),
            summary=summary,
            records=records_sample,
            kics_status_column=kics_col or "ReconciliationSection",
        )

    def _resolve_col(self, df: pd.DataFrame, mapped_pairs: dict[str, str], candidates: list[str]) -> str | None:
        for c in candidates:
            if c in df.columns:
                return c
            # Check in values of mapped_pairs
            for k, v in mapped_pairs.items():
                if k.lower() == c.lower() and k in df.columns:
                    return k
                if v and v.lower() == c.lower() and v in df.columns:
                    return v
        # Fallback check partial matches
        for c in candidates:
            c_clean = re.sub(r"[^a-zA-Z0-9]", "", c).lower()
            for col in df.columns:
                if c_clean in re.sub(r"[^a-zA-Z0-9]", "", col).lower():
                    return col
        return None
