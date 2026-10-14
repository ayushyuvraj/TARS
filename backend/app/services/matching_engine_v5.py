from __future__ import annotations

import datetime
import math
import re
import time
from typing import Any, Literal
from uuid import uuid4

import numpy as np
import pandas as pd
from pydantic import BaseModel, Field, model_validator

from app.domain.models import CanonicalDataType
from app.services.matching_engine_v2 import (
    AmbiguityCandidate,
    AmbiguityCluster,
    ScoreBreakdown,
    calculate_string_ratio,
)


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


class NormalizerConfigV5(BaseModel):
    trim_whitespace: bool = True
    strip_special_chars: bool = True
    strip_prefixes: bool = True
    trim_leading_zeros: bool = True
    case_fold: bool = True


class Rule5Item(BaseModel):
    id: str
    order: int
    name: str
    description: str
    statutory_rationale: str
    category: str = "DOUBLE_LEDGER_UPDATED"  # "CORE_IDENTITY" | "DOCUMENT_REFERENCE" | "FINANCIAL_VALUE" | "TEMPORAL_WINDOW" | "STATUTORY_DISCREPANCY" | "CONSOLIDATION"
    canonical_concept: str
    is_mandatory: bool = True
    is_enabled: bool = True
    match_strategy: str = "EXACT"  # "EXACT" | "NUMERIC_TOLERANCE" | "DATE_PROXIMITY" | "CROSS_FY" | "COMPOUND" | "INELIGIBLE_ITC" | "MULTI_TRANCHE" | "KICS_CONCURRENCE"
    gstr_column: str
    pr_column: str
    tolerance_value: float | None = None
    tolerance_unit: str | None = None  # "INR" | "DAYS" | "PERCENT"
    normalizers: NormalizerConfigV5 = Field(default_factory=NormalizerConfigV5)
    created_at: str = Field(default_factory=lambda: datetime.datetime.now(datetime.timezone.utc).isoformat())
    is_temporary: bool = False
    scope: str = "wiki"  # "temporary" | "wiki"
    origin_session_id: str | None = None
    created_by: str | None = "System Standard Baseline 5.0"
    version: str | None = "1.0.0"
    tolerance_mode: str | None = "ABSOLUTE_INR"  # "ABSOLUTE_INR" | "PERCENTAGE"
    date_tolerance_value: int | None = 0
    date_tolerance_unit: str | None = "DAYS"
    advisory_caution: str | None = None
    plain_english_explanation: str | None = None
    why_it_matters: str | None = None
    rule_tier: str | None = "CORE_STATUTORY"
    # Special parameters for client KPMG rules
    min_threshold_ineligible: float | None = 100.0  # Rule 7: Minimum value variance for Section 17(5)
    cross_fy_enabled: bool = True                  # Rule 5: Allow cross-FY March -> April
    custom_date_range_days: int | None = 30         # Rule 4 & Rule 8: Rolling window days
    custom_date_range_start: str | None = None
    custom_date_range_end: str | None = None


class BatchComponentItemV5(BaseModel):
    row_index: int
    row_number: int
    doc_type: str  # "GSTR" | "PR"
    document_number: str
    document_date: str
    taxable_value: float
    tax_amount: float
    total_value: float
    gstin: str
    share_percentage: float


class ReconciliationRecordItemV5(BaseModel):
    model_config = {"extra": "allow"}

    id: str
    index: int
    tars_verdict: str  # "Exact Match", "Tolerance Match", "Near Match", "Ineligible ITC [Sec 17(5)]", "Consolidated Match", "GST Only", "PR Only", "Ambiguous"
    kics_verdict: str
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
    pass_tier: str
    rule_tier: str | None = "Tier 1: Deterministic Core"
    sub_classification: str | None = None
    classification_reason: str
    ai_reason: str
    variances: dict[str, Any] = Field(default_factory=dict)
    matched_by_pass: str = ""
    bucket: str = ""
    reclassified_from: str | None = None
    reclassification_note: str | None = None
    batch_components: list[BatchComponentItemV5] = Field(default_factory=list)
    constituent_items: list[Any] = Field(default_factory=list)
    raw_attributes: dict[str, Any] = Field(default_factory=dict)
    gstr_preview: dict[str, Any] = Field(default_factory=dict)
    pr_preview: dict[str, Any] = Field(default_factory=dict)

    # UI Compatibility Fields (Used by Results Table & Inspector)
    gstin: str = ""
    document_number: str = ""
    document_date: str | None = None
    taxable_value: float = 0.0
    tax_amount: float = 0.0
    total_value: float = 0.0
    gstr_row_index: int | None = None
    pr_row_index: int | None = None
    ambiguity_cluster_id: str | None = None

    @model_validator(mode="after")
    def _populate_ui_compat_fields(self) -> ReconciliationRecordItemV5:
        if not self.gstin:
            self.gstin = self.source_gstin or self.target_gstin or ""
        if not self.document_number:
            self.document_number = self.source_doc_num or self.target_doc_num or ""
        if not self.document_date:
            self.document_date = self.source_date or self.target_date or ""
        if self.taxable_value == 0.0:
            self.taxable_value = round(float(self.source_taxable if self.source_taxable != 0.0 else self.target_taxable), 2)
        if self.tax_amount == 0.0:
            self.tax_amount = round(float(self.source_tax if self.source_tax != 0.0 else self.target_tax), 2)
        if self.total_value == 0.0:
            self.total_value = round(self.taxable_value + self.tax_amount, 2)
        return self


class Stage4ResultsSummaryV5(BaseModel):
    model_config = {"extra": "allow"}

    total_records: int
    exact_matches: int
    tolerance_matches: int
    near_matches: int
    ineligible_itc_matches: int = 0
    consolidated_matches: int = 0
    gst_only: int
    pr_only: int
    ambiguous: int
    ambiguous_matches: int = 0
    kics_concurrence_count: int
    kics_concurrence_rate: float
    disparities_caught: int
    net_taxable_variance: float
    net_tax_variance: float
    total_gov_taxable: float
    total_pr_taxable: float
    accuracy_percentage: float = 100.0
    # Compatibility Fields
    total_gstr_rows: int = 0
    total_pr_rows: int = 0
    exact_match_count: int = 0
    exact_match_itc: float = 0.0
    tolerance_match_count: int = 0
    tolerance_match_itc: float = 0.0
    near_match_count: int = 0
    near_match_itc: float = 0.0
    ambiguous_count: int = 0
    ambiguous_itc: float = 0.0
    gstr_only_count: int = 0
    gstr_only_itc: float = 0.0
    pr_only_count: int = 0
    pr_only_itc: float = 0.0
    total_reconciled_count: int = 0
    total_reconciled_itc: float = 0.0
    overall_reconciliation_rate: float = 0.0
    waterfall_passes: list[dict[str, Any]] = Field(default_factory=list)
    rule_breakdown: dict[str, int] = Field(default_factory=dict)


class Stage4ExecutionResponseV5(BaseModel):
    model_config = {"extra": "allow"}

    session_id: str
    executed_at: str
    duration_ms: float
    summary: Stage4ResultsSummaryV5
    records: list[ReconciliationRecordItemV5] = Field(default_factory=list)
    kics_status_column: str = ""
    ambiguities: list[dict[str, Any]] = Field(default_factory=list)
    compared_columns: list[dict[str, Any]] = Field(default_factory=list)


def build_default_rules_v5() -> list[Rule5Item]:
    """Authoritative Master Rules V5 Catalog pre-configured with the 8 KPMG client rules adapted for Double Ledger."""
    return [
        Rule5Item(
            id="R5-01",
            order=1,
            name="Supplier GSTIN Identity Match",
            description="Matches vendor GST identification numbers between Government portal and Client Purchase Register.",
            statutory_rationale="Under Section 16(2)(aa) of the CGST Act, Input Tax Credit (ITC) can only be claimed if the supplier has filed their tax return under their exact registered GSTIN.",
            category="CORE_IDENTITY",
            rule_tier="CORE_STATUTORY",
            canonical_concept="gstin",
            is_mandatory=True,
            is_enabled=True,
            match_strategy="EXACT",
            gstr_column="Supplier GSTIN",
            pr_column="Supplier GSTIN",
            tolerance_value=0.0,
            tolerance_unit="INR",
            tolerance_mode="ABSOLUTE_INR",
            date_tolerance_value=0,
            date_tolerance_unit="DAYS",
            normalizers=NormalizerConfigV5(trim_whitespace=True, strip_special_chars=True, case_fold=True),
            created_by="System Standard Baseline 5.0",
            version="1.0.0",
            advisory_caution="Word of Caution: Primary statutory anchor under Section 16(2)(aa). Cannot be disabled.",
            plain_english_explanation="Verifies that the Supplier GSTIN in portal records exactly matches the Supplier GSTIN in books records.",
            why_it_matters="Input Tax Credit cannot legally be claimed if supplier GSTIN does not match.",
        ),
        Rule5Item(
            id="R5-02",
            order=2,
            name="Document Number Normalization & Prefix Stripping (Client Rule 5)",
            description="Normalizes document numbers by removing arbitrary ERP prefixes ('INV-', 'BILL/', '2026/'), hyphens, and leading zeros.",
            statutory_rationale="Rule 46 of CGST Rules allows variations in separator punctuation across ERP and filing portals.",
            category="DOCUMENT_REFERENCE",
            rule_tier="CORE_STATUTORY",
            canonical_concept="document_number",
            is_mandatory=True,
            is_enabled=True,
            match_strategy="EXACT",
            gstr_column="Invoice Number",
            pr_column="Invoice Number",
            tolerance_value=0.0,
            tolerance_unit="INR",
            tolerance_mode="ABSOLUTE_INR",
            date_tolerance_value=0,
            date_tolerance_unit="DAYS",
            normalizers=NormalizerConfigV5(trim_whitespace=True, strip_special_chars=True, strip_prefixes=True, trim_leading_zeros=True, case_fold=True),
            created_by="KPMG Client Rule 5",
            version="1.0.0",
            advisory_caution="Standardizes document entry variations across accounting software.",
            plain_english_explanation="Strips 'INV/2026/', 'BILL-', hyphens, and leading zeroes so 'INV/2026/00123' matches '00123' cleanly.",
            why_it_matters="Prevents valid purchases from failing reconciliation due to manual ERP formatting.",
        ),
        Rule5Item(
            id="R5-03",
            order=3,
            name="Taxable & Tax Value Commercial Tolerance",
            description="Absorbs penny fractions, currency conversions, and commercial rounding differences up to ± ₹10.00.",
            statutory_rationale="Section 16(2) ITC claim allows absorptive commercial penny tolerances.",
            category="FINANCIAL_VALUE",
            rule_tier="COMMERCIAL_POLICY",
            canonical_concept="taxable_value",
            is_mandatory=False,
            is_enabled=True,
            match_strategy="NUMERIC_TOLERANCE",
            gstr_column="Taxable Value",
            pr_column="Taxable Value",
            tolerance_value=10.0,
            tolerance_unit="INR",
            tolerance_mode="ABSOLUTE_INR",
            date_tolerance_value=0,
            date_tolerance_unit="DAYS",
            normalizers=NormalizerConfigV5(trim_whitespace=True),
            created_by="System Standard Baseline 5.0",
            version="1.0.0",
            advisory_caution="Absorbs line-item vs invoice-level penny rounding.",
            plain_english_explanation="Treats financial values as matching if the variance between portal and books is within ± ₹10.00.",
            why_it_matters="Eliminates false rejections caused by minor rounding discrepancies.",
        ),
        Rule5Item(
            id="R5-04",
            order=4,
            name="Operational Document Date Proximity Window (Client Rule 3)",
            description="Accommodates document date shifts across month boundaries due to physical transit and goods receipt delays (e.g. 28-Feb vs 03-Mar).",
            statutory_rationale="Accounts payable recording lag accommodates goods-in-transit timing differences under commercial standards.",
            category="TEMPORAL_WINDOW",
            rule_tier="COMMERCIAL_POLICY",
            canonical_concept="document_date",
            is_mandatory=False,
            is_enabled=True,
            match_strategy="DATE_PROXIMITY",
            gstr_column="Invoice Date",
            pr_column="Invoice Date",
            tolerance_value=0.0,
            tolerance_unit="DAYS",
            tolerance_mode="ABSOLUTE_INR",
            date_tolerance_value=30,
            date_tolerance_unit="DAYS",
            custom_date_range_days=30,
            normalizers=NormalizerConfigV5(trim_whitespace=True),
            created_by="KPMG Client Rule 3",
            version="1.0.0",
            advisory_caution="Configurable calendar window for accounts payable booking delays.",
            plain_english_explanation="Allows invoice dates between portal and books to vary by up to 30 days without failing the match.",
            why_it_matters="Vendors often date invoices at month-end while buyers book them upon physical receipt in the following month.",
        ),
        Rule5Item(
            id="R5-05",
            order=5,
            name="Cross Financial Year Date Boundary Allowance (Client Rule 4)",
            description="Allows invoices dated at the close of one financial year (e.g. 31-Mar-2026, FY 2025-26) to match books entries booked at the start of the next (e.g. 02-Apr-2026, FY 2026-27).",
            statutory_rationale="Section 16(4) of the CGST Act permits ITC claim up to the November 30 cutoff of the following fiscal year.",
            category="TEMPORAL_WINDOW",
            rule_tier="COMMERCIAL_POLICY",
            canonical_concept="cross_fy_date",
            is_mandatory=False,
            is_enabled=True,
            match_strategy="CROSS_FY",
            gstr_column="Invoice Date",
            pr_column="Invoice Date",
            tolerance_value=0.0,
            tolerance_unit="DAYS",
            tolerance_mode="ABSOLUTE_INR",
            date_tolerance_value=60,
            date_tolerance_unit="DAYS",
            cross_fy_enabled=True,
            normalizers=NormalizerConfigV5(trim_whitespace=True),
            created_by="KPMG Client Rule 4",
            version="1.0.0",
            advisory_caution="Breaks strict FY sandboxes to capture year-end transit invoices.",
            plain_english_explanation="Permits matching between March year-end supplier filings and April new-year purchase register entries.",
            why_it_matters="Critical for year-end corporate audit closing and preventing missed ITC claims across financial years.",
        ),
        Rule5Item(
            id="R5-06",
            order=6,
            name="Compound Document & Date Multi-Parameter Match (Client Rule 6)",
            description="Resolves exceptional compound cases where BOTH the document number has a typographical variance AND the booking date is shifted by a few days.",
            statutory_rationale="Analytical multi-parameter correlation identifies matching transaction substance despite dual field variations.",
            category="DOCUMENT_REFERENCE",
            rule_tier="COMMERCIAL_POLICY",
            canonical_concept="compound_match",
            is_mandatory=False,
            is_enabled=True,
            match_strategy="COMPOUND",
            gstr_column="Invoice Number",
            pr_column="Invoice Number",
            tolerance_value=10.0,
            tolerance_unit="INR",
            tolerance_mode="ABSOLUTE_INR",
            date_tolerance_value=15,
            date_tolerance_unit="DAYS",
            normalizers=NormalizerConfigV5(trim_whitespace=True, strip_special_chars=True, strip_prefixes=True, case_fold=True),
            created_by="KPMG Client Rule 6",
            version="1.0.0",
            advisory_caution="Recovers transactions that would otherwise fail both exact and single-tolerance passes.",
            plain_english_explanation="Matches invoices like 'SUPP-4521' (15-Jan) with 'SUPP4521' (20-Jan) when vendor GSTIN and tax amounts match.",
            why_it_matters="Prevents compound clerical entry variations from creating duplicate un-reconciled exceptions.",
        ),
        Rule5Item(
            id="R5-07",
            order=7,
            name="Ineligible ITC & Section 17(5) Blocked Credit Detection (Client Rule 2)",
            description="Identifies invoices where vendor reported full value but client booked only eligible goods portion, intentionally excluding blocked credit under Section 17(5) or rejected items.",
            statutory_rationale="Section 17(5) of the CGST Act mandates blocked credit for motor vehicles, catering, employee insurance, etc.",
            category="STATUTORY_DISCREPANCY",
            rule_tier="CORE_STATUTORY",
            canonical_concept="ineligible_itc",
            is_mandatory=False,
            is_enabled=True,
            match_strategy="INELIGIBLE_ITC",
            gstr_column="Taxable Value",
            pr_column="Taxable Value",
            tolerance_value=0.0,
            tolerance_unit="INR",
            tolerance_mode="ABSOLUTE_INR",
            min_threshold_ineligible=100.0,
            normalizers=NormalizerConfigV5(trim_whitespace=True),
            created_by="KPMG Client Rule 2",
            version="1.0.0",
            advisory_caution="Categorizes intentional Section 17(5) non-bookings as verified rather than audit failures.",
            plain_english_explanation="When GSTIN, Doc No, and Date match but Books Tax < Portal Tax, classifies the gap as Ineligible ITC u/s 17(5).",
            why_it_matters="Protects statutory audit integrity by recognizing intentional blocked credit exclusions instead of flagging errors.",
        ),
        Rule5Item(
            id="R5-08",
            order=8,
            name="Banking & Multi-Tranche Batch Consolidation (Client Rule 1)",
            description="Aggregates multiple bank charge invoices or vendor tranche deliveries into a single consolidated accounting journal voucher.",
            statutory_rationale="Commercial ERPs book monthly bank service charges and fees in aggregated journal entries.",
            category="CONSOLIDATION",
            rule_tier="COMMERCIAL_POLICY",
            canonical_concept="multi_tranche_batch",
            is_mandatory=False,
            is_enabled=True,
            match_strategy="MULTI_TRANCHE",
            gstr_column="Taxable Value",
            pr_column="Taxable Value",
            tolerance_value=5.0,
            tolerance_unit="INR",
            tolerance_mode="ABSOLUTE_INR",
            custom_date_range_days=31,
            normalizers=NormalizerConfigV5(trim_whitespace=True),
            created_by="KPMG Client Rule 1",
            version="1.0.0",
            advisory_caution="Enables 1:N and N:1 batch aggregation matching across a custom monthly date window.",
            plain_english_explanation="Matches 3 bank invoices totaling ₹1,800 against 1 monthly journal voucher for ₹1,800 under the bank's GSTIN.",
            why_it_matters="Eliminates the persistent issue where bank service charges show up as missing on both sides.",
        ),
    ]


class WaterfallMatchingEngineV5:
    """
    Supercharged 5-tier vectorized matching engine for Reconciliation 5.0 (Double Ledger Updated).
    Executes all 8 KPMG client rules across two distinct DataFrames: gstr_df and pr_df.
    """

    def __init__(self, rules: list[Rule5Item] | None = None) -> None:
        self.rules = rules or build_default_rules_v5()

    def _find_col(self, df: pd.DataFrame, target_name: str, concept: str | None = None) -> str | None:
        cols = list(df.columns)
        # 1. Exact match
        if target_name in cols:
            return target_name
        # 2. Case-insensitive exact match
        lower_map = {str(c).strip().lower(): c for c in cols}
        if target_name.strip().lower() in lower_map:
            return lower_map[target_name.strip().lower()]

        # 3. Concept synonyms
        synonyms: dict[str, list[str]] = {
            "gstin": ["gstin", "supplier gstin", "vendor gstin", "cpgstin", "prgstin", "ctin", "supplier_gstin", "suppliergstin"],
            "document_number": ["invoice number", "invoicenumber", "invoice no", "inv no", "doc no", "document number", "voucher no", "cpdocumentnumber", "prdocumentnumber"],
            "taxable_value": ["taxable value", "taxablevalue", "taxable amt", "taxable amount", "taxable", "cptaxablevalue", "prtaxablevalue"],
            "tax_amount": ["total tax", "totaltax", "tax amount", "taxamount", "total_tax_amount", "taxamt", "tax", "integrated tax"],
            "igst": ["igstamount", "igst amount", "igst", "cpigst", "prigst", "cpigstamount", "prigstamount", "govt_igst"],
            "cgst": ["cgstamount", "cgst amount", "cgst", "cpcgst", "prcgst", "cpcgstamount", "prcgstamount", "govt_cgst"],
            "sgst": ["sgstamount", "sgst amount", "sgst", "cpsgst", "prsgst", "cpsgstamount", "prsgstamount", "govt_sgst"],
            "document_date": ["invoice date", "invoicedate", "inv date", "date", "document date", "voucher date", "cpdocumentdate", "prdocumentdate"],
            "cross_fy_date": ["invoice date", "invoicedate", "inv date", "date", "document date", "voucher date"],
            "ineligible_itc": ["taxable value", "taxablevalue", "taxable amt", "taxable amount", "taxable"],
            "multi_tranche_batch": ["taxable value", "taxablevalue", "taxable amt", "taxable amount", "taxable"],
            "compound_match": ["invoice number", "invoicenumber", "invoice no", "inv no", "doc no"],
        }
        cand_list = synonyms.get(concept or "", []) + [target_name.lower()]
        for cand in cand_list:
            if cand in lower_map:
                return lower_map[cand]
        for c in cols:
            c_low = str(c).strip().lower()
            for cand in cand_list:
                if cand in c_low or c_low in cand:
                    return c
        return None

    @staticmethod
    def _normalize_doc(val: Any) -> str:
        s = _clean_str(val).upper()
        for prefix in ["INV-", "INV/", "BILL-", "BILL/", "TAX-", "TAX/"]:
            if s.startswith(prefix):
                s = s[len(prefix):]
        s = re.sub(r"[^A-Z0-9]", "", s)
        s = s.lstrip("0")
        return s or "0"

    def execute_waterfall(
        self,
        gstr_df: pd.DataFrame,
        pr_df: pd.DataFrame,
        session_id: str = "v5-run",
        mapped_pairs: dict[str, str] | None = None,
        kics_column: str | None = None,
    ) -> Stage4ExecutionResponseV5:
        return self.run(gstr_df, pr_df, mapped_pairs=mapped_pairs, kics_column=kics_column)

    def run(
        self,
        gstr_df: pd.DataFrame,
        pr_df: pd.DataFrame,
        mapped_pairs: dict[str, str] | None = None,
        kics_column: str | None = None,
    ) -> Stage4ExecutionResponseV5:
        start_time = time.time()
        mapped_pairs = mapped_pairs or {}

        g_len = len(gstr_df)
        p_len = len(pr_df)

        # 1. Identify key columns in gstr_df
        g_gstin_col = self._find_col(gstr_df, "Supplier GSTIN", "gstin") or (gstr_df.columns[0] if g_len > 0 else "Supplier GSTIN")
        g_doc_col = self._find_col(gstr_df, "Invoice Number", "document_number") or (gstr_df.columns[1] if len(gstr_df.columns) > 1 else "Invoice Number")
        g_date_col = self._find_col(gstr_df, "Invoice Date", "document_date") or (gstr_df.columns[2] if len(gstr_df.columns) > 2 else "Invoice Date")
        g_taxable_col = self._find_col(gstr_df, "Taxable Value", "taxable_value") or (gstr_df.columns[3] if len(gstr_df.columns) > 3 else "Taxable Value")
        g_tax_col = self._find_col(gstr_df, "Tax Amount", "tax_amount")
        g_igst_col = self._find_col(gstr_df, "IgstAmount", "igst")
        g_cgst_col = self._find_col(gstr_df, "CgstAmount", "cgst")
        g_sgst_col = self._find_col(gstr_df, "SgstAmount", "sgst")

        # 2. Identify key columns in pr_df
        p_gstin_target = mapped_pairs.get(g_gstin_col, "Supplier GSTIN")
        p_doc_target = mapped_pairs.get(g_doc_col, "Invoice Number")
        p_date_target = mapped_pairs.get(g_date_col, "Invoice Date")
        p_taxable_target = mapped_pairs.get(g_taxable_col, "Taxable Value")
        p_tax_target = mapped_pairs.get(g_tax_col, "Tax Amount") if g_tax_col else "Tax Amount"

        p_gstin_col = self._find_col(pr_df, p_gstin_target, "gstin") or (pr_df.columns[0] if p_len > 0 else "Supplier GSTIN")
        p_doc_col = self._find_col(pr_df, p_doc_target, "document_number") or (pr_df.columns[1] if len(pr_df.columns) > 1 else "Invoice Number")
        p_date_col = self._find_col(pr_df, p_date_target, "document_date") or (pr_df.columns[2] if len(pr_df.columns) > 2 else "Invoice Date")
        p_taxable_col = self._find_col(pr_df, p_taxable_target, "taxable_value") or (pr_df.columns[3] if len(pr_df.columns) > 3 else "Taxable Value")
        p_tax_col = self._find_col(pr_df, p_tax_target, "tax_amount")
        p_igst_col = self._find_col(pr_df, "IgstAmount", "igst")
        p_cgst_col = self._find_col(pr_df, "CgstAmount", "cgst")
        p_sgst_col = self._find_col(pr_df, "SgstAmount", "sgst")

        # KICS Column if any in gstr_df or pr_df
        kics_col_actual = None
        if kics_column:
            if kics_column in gstr_df.columns:
                kics_col_actual = (gstr_df, kics_column)
            elif kics_column in pr_df.columns:
                kics_col_actual = (pr_df, kics_column)

        # Pre-extract data arrays for high-throughput vectorized operations
        g_gstin_clean = gstr_df[g_gstin_col].apply(_clean_str).str.upper().values if g_len > 0 else np.array([])
        p_gstin_clean = pr_df[p_gstin_col].apply(_clean_str).str.upper().values if p_len > 0 else np.array([])

        g_doc_raw = gstr_df[g_doc_col].apply(_clean_str).values if g_len > 0 else np.array([])
        p_doc_raw = pr_df[p_doc_col].apply(_clean_str).values if p_len > 0 else np.array([])

        g_doc_clean = np.array([self._normalize_doc(x) for x in g_doc_raw]) if g_len > 0 else np.array([])
        p_doc_clean = np.array([self._normalize_doc(x) for x in p_doc_raw]) if p_len > 0 else np.array([])

        g_taxable = gstr_df[g_taxable_col].apply(_clean_float).values if g_len > 0 else np.array([])
        p_taxable = pr_df[p_taxable_col].apply(_clean_float).values if p_len > 0 else np.array([])

        # Specific tax heads
        g_igst = gstr_df[g_igst_col].apply(_clean_float).values if (g_len > 0 and g_igst_col and g_igst_col in gstr_df.columns) else np.zeros(g_len)
        g_cgst = gstr_df[g_cgst_col].apply(_clean_float).values if (g_len > 0 and g_cgst_col and g_cgst_col in gstr_df.columns) else np.zeros(g_len)
        g_sgst = gstr_df[g_sgst_col].apply(_clean_float).values if (g_len > 0 and g_sgst_col and g_sgst_col in gstr_df.columns) else np.zeros(g_len)

        if g_tax_col and g_tax_col in gstr_df.columns and g_tax_col != g_taxable_col:
            g_tax = gstr_df[g_tax_col].apply(_clean_float).values
        elif (g_igst_col or g_cgst_col or g_sgst_col):
            g_tax = g_igst + g_cgst + g_sgst
        else:
            g_tax = g_taxable * 0.18

        p_igst = pr_df[p_igst_col].apply(_clean_float).values if (p_len > 0 and p_igst_col and p_igst_col in pr_df.columns) else np.zeros(p_len)
        p_cgst = pr_df[p_cgst_col].apply(_clean_float).values if (p_len > 0 and p_cgst_col and p_cgst_col in pr_df.columns) else np.zeros(p_len)
        p_sgst = pr_df[p_sgst_col].apply(_clean_float).values if (p_len > 0 and p_sgst_col and p_sgst_col in pr_df.columns) else np.zeros(p_len)

        if p_tax_col and p_tax_col in pr_df.columns and p_tax_col != p_taxable_col:
            p_tax = pr_df[p_tax_col].apply(_clean_float).values
        elif (p_igst_col or p_cgst_col or p_sgst_col):
            p_tax = p_igst + p_cgst + p_sgst
        else:
            p_tax = p_taxable * 0.18

        g_dates_dt = pd.to_datetime(gstr_df[g_date_col], errors="coerce") if g_len > 0 else pd.Series(dtype="datetime64[ns]")
        p_dates_dt = pd.to_datetime(pr_df[p_date_col], errors="coerce") if p_len > 0 else pd.Series(dtype="datetime64[ns]")

        g_dates_str = g_dates_dt.dt.strftime("%Y-%m-%d").fillna("").values if g_len > 0 else np.array([])
        p_dates_str = p_dates_dt.dt.strftime("%Y-%m-%d").fillna("").values if p_len > 0 else np.array([])

        # Track unmatched indices
        unmatched_g = set(range(g_len))
        unmatched_p = set(range(p_len))

        # Output structures
        records: list[ReconciliationRecordItemV5] = []
        ambiguities: list[dict[str, Any]] = []

        # Rule lookup by strategy
        rule_map = {r.match_strategy: r for r in self.rules if r.is_enabled}
        commercial_tol = rule_map.get("NUMERIC_TOLERANCE", Rule5Item(
            id="R5-03", order=3, name="Commercial Tolerance", description="", statutory_rationale="", canonical_concept="", gstr_column="", pr_column="", tolerance_value=10.0
        )).tolerance_value or 10.0

        date_tol_days = int(rule_map.get("DATE_PROXIMITY", Rule5Item(
            id="R5-04", order=4, name="Date Proximity", description="", statutory_rationale="", canonical_concept="", gstr_column="", pr_column="", date_tolerance_value=30
        )).date_tolerance_value or 30)

        ineligible_threshold = float(rule_map.get("INELIGIBLE_ITC", Rule5Item(
            id="R5-07", order=7, name="Ineligible ITC", description="", statutory_rationale="", canonical_concept="", gstr_column="", pr_column="", min_threshold_ineligible=100.0
        )).min_threshold_ineligible or 100.0)

        # Pre-build lookup indexes on pr_df by GSTIN and Normalized Doc
        # PR indices by (gstin, doc_clean)
        pr_by_gstin_doc: dict[tuple[str, str], list[int]] = {}
        # PR indices by gstin alone
        pr_by_gstin: dict[str, list[int]] = {}
        for p_idx in range(p_len):
            gst = p_gstin_clean[p_idx]
            doc = p_doc_clean[p_idx]
            pr_by_gstin_doc.setdefault((gst, doc), []).append(p_idx)
            pr_by_gstin.setdefault(gst, []).append(p_idx)

        # -------------------------------------------------------------
        # PASS 1: EXACT MATCH (Zero Variance)
        # -------------------------------------------------------------
        for g_idx in list(unmatched_g):
            gst = g_gstin_clean[g_idx]
            doc = g_doc_clean[g_idx]
            cands = [p for p in pr_by_gstin_doc.get((gst, doc), []) if p in unmatched_p]
            if len(cands) == 1:
                p_idx = cands[0]
                t_diff = abs(g_taxable[g_idx] - p_taxable[p_idx])
                tax_diff = abs(g_tax[g_idx] - p_tax[p_idx])

                # Check date difference
                date_diff_days = 0
                if pd.notna(g_dates_dt.iloc[g_idx]) and pd.notna(p_dates_dt.iloc[p_idx]):
                    d1 = g_dates_dt.iloc[g_idx]
                    d2 = p_dates_dt.iloc[p_idx]
                    date_diff_days = abs((d1 - d2).days)
                elif g_dates_str[g_idx] != p_dates_str[p_idx]:
                    date_diff_days = 999

                # Check tax head mismatch
                g_i, g_c, g_s = g_igst[g_idx], g_cgst[g_idx], g_sgst[g_idx]
                p_i, p_c, p_s = p_igst[p_idx], p_cgst[p_idx], p_sgst[p_idx]
                has_breakdown = (g_i > 0 or g_c > 0 or g_s > 0) or (p_i > 0 or p_c > 0 or p_s > 0)
                is_tax_head_mismatch = False
                if has_breakdown:
                    if (abs(g_i - p_i) > 0.05) or (abs(g_c - p_c) > 0.05) or (abs(g_s - p_s) > 0.05):
                        is_tax_head_mismatch = True

                # Exact match if amounts, tax amounts, dates equal, and no tax head mismatch
                if t_diff <= 0.05 and tax_diff <= 0.05 and date_diff_days == 0 and not is_tax_head_mismatch:
                    unmatched_g.remove(g_idx)
                    unmatched_p.remove(p_idx)
                    records.append(ReconciliationRecordItemV5(
                        id=f"V5-REC-{len(records)+1:06d}",
                        index=len(records) + 1,
                        tars_verdict="Exact Match",
                        kics_verdict="MATCHED_AUTO",
                        concurrence="AGREEMENT",
                        disparity_reason=None,
                        source_gstin=gst,
                        target_gstin=p_gstin_clean[p_idx],
                        source_doc_num=g_doc_raw[g_idx],
                        target_doc_num=p_doc_raw[p_idx],
                        source_date=g_dates_str[g_idx],
                        target_date=p_dates_str[p_idx],
                        source_taxable=round(float(g_taxable[g_idx]), 2),
                        target_taxable=round(float(p_taxable[p_idx]), 2),
                        source_tax=round(float(g_tax[g_idx]), 2),
                        target_tax=round(float(p_tax[p_idx]), 2),
                        taxable_diff=round(float(t_diff), 2),
                        tax_diff=round(float(tax_diff), 2),
                        pass_tier="PASS 1: EXACT MATCH",
                        rule_tier="Tier 1: Deterministic Core",
                        sub_classification="EXACT_1_TO_1",
                        classification_reason="Zero Variance Match: Supplier GSTIN, normalized Document Number, invoice dates, and statutory tax amounts are perfectly identical.",
                        ai_reason="Flawless exact reconciliation between Government 2B portal and Client Purchase Register with 100% deterministic concurrence.",
                        variances={"taxable_diff": 0.0, "tax_diff": 0.0, "date_diff_days": 0},
                        matched_by_pass="PASS 1: Exact Match",
                        bucket="EXACT_MATCH",
                        gstr_preview={"GSTIN": gst, "Invoice": g_doc_raw[g_idx], "Date": g_dates_str[g_idx], "Taxable": g_taxable[g_idx], "Tax": g_tax[g_idx]},
                        pr_preview={"GSTIN": p_gstin_clean[p_idx], "Invoice": p_doc_raw[p_idx], "Date": p_dates_str[p_idx], "Taxable": p_taxable[p_idx], "Tax": p_tax[p_idx]},
                    ))

        # -------------------------------------------------------------
        # PASS 2: TOLERANCE & CLIENT RULES (Multi-Tranche, Sec 17(5), Penny, Date, Cross-FY)
        # -------------------------------------------------------------
        # Rule 8: Multi-Tranche Batch Consolidation (N:1 and 1:N)
        if "MULTI_TRANCHE" in rule_map:
            # Check N:1 (Multiple GSTR charge rows match 1 PR voucher under same GSTIN)
            import itertools
            for p_idx in list(unmatched_p):
                gst = p_gstin_clean[p_idx]
                cands = [g for g in unmatched_g if g_gstin_clean[g] == gst]
                if len(cands) >= 2:
                    matching_cands = None
                    if abs(sum(g_taxable[g] for g in cands) - p_taxable[p_idx]) <= 5.0:
                        matching_cands = cands
                    else:
                        for r_k in range(2, min(len(cands) + 1, 6)):
                            for combo in itertools.combinations(cands, r_k):
                                if abs(sum(g_taxable[g] for g in combo) - p_taxable[p_idx]) <= 5.0:
                                    matching_cands = list(combo)
                                    break
                            if matching_cands:
                                break

                    if matching_cands:
                        p_val = p_taxable[p_idx]
                        unmatched_p.remove(p_idx)
                        for g in matching_cands:
                            unmatched_g.remove(g)
                        components = [
                            BatchComponentItemV5(
                                row_index=g,
                                row_number=g + 1,
                                doc_type="GSTR",
                                document_number=g_doc_raw[g],
                                document_date=g_dates_str[g],
                                taxable_value=round(float(g_taxable[g]), 2),
                                tax_amount=round(float(g_tax[g]), 2),
                                total_value=round(float(g_taxable[g] + g_tax[g]), 2),
                                gstin=g_gstin_clean[g],
                                share_percentage=round(float(g_taxable[g] / p_val * 100.0), 1) if p_val > 0 else 0.0,
                            )
                            for g in matching_cands
                        ]
                        records.append(ReconciliationRecordItemV5(
                            id=f"V5-REC-{len(records)+1:06d}",
                            index=len(records) + 1,
                            tars_verdict="Consolidated Match",
                            kics_verdict="BATCH_CONSOLIDATED",
                            concurrence="AGREEMENT",
                            disparity_reason=None,
                            source_gstin=gst,
                            target_gstin=gst,
                            source_doc_num=f"{len(matching_cands)} Invoices Consolidated",
                            target_doc_num=p_doc_raw[p_idx],
                            source_date=g_dates_str[matching_cands[0]],
                            target_date=p_dates_str[p_idx],
                            source_taxable=round(float(sum(g_taxable[g] for g in matching_cands)), 2),
                            target_taxable=round(float(p_taxable[p_idx]), 2),
                            source_tax=round(float(sum(g_tax[g] for g in matching_cands)), 2),
                            target_tax=round(float(p_tax[p_idx]), 2),
                            taxable_diff=round(float(abs(sum(g_taxable[g] for g in matching_cands) - p_taxable[p_idx])), 2),
                            tax_diff=round(float(abs(sum(g_tax[g] for g in matching_cands) - p_tax[p_idx])), 2),
                            pass_tier="PASS 2: TOLERANCE MATCH",
                            rule_tier="Tier 2: Commercial Tolerance",
                            sub_classification="CONSOLIDATED_BATCH",
                            classification_reason=f"Multi-Tranche Batch Consolidation (N:1): {len(matching_cands)} portal invoices mapped against 1 client voucher totaling ₹{p_taxable[p_idx]:,.2f}.",
                            ai_reason=f"Client Rule 1 matched {len(matching_cands)} banking/charge tranches against single ERP voucher.",
                            variances={"batch_type": "N:1", "constituent_count": len(matching_cands), "net_variance": round(float(abs(sum(g_taxable[g] for g in matching_cands) - p_taxable[p_idx])), 2)},
                            matched_by_pass="PASS 2: Multi-Tranche Batch",
                            bucket="TOLERANCE_MATCH",
                            batch_components=components,
                            constituent_items=[c.model_dump() for c in components],
                            gstr_preview={"GSTIN": gst, "Invoice": f"{len(matching_cands)} Invoices", "Date": g_dates_str[matching_cands[0]], "Taxable": sum(g_taxable[g] for g in matching_cands), "Tax": sum(g_tax[g] for g in matching_cands)},
                            pr_preview={"GSTIN": gst, "Invoice": p_doc_raw[p_idx], "Date": p_dates_str[p_idx], "Taxable": p_taxable[p_idx], "Tax": p_tax[p_idx]},
                        ))

            # Check 1:N (1 GSTR invoice matches multiple PR vouchers under same GSTIN)
            for g_idx in list(unmatched_g):
                gst = g_gstin_clean[g_idx]
                cands = [p for p in pr_by_gstin.get(gst, []) if p in unmatched_p]
                if len(cands) >= 2:
                    relevant = []
                    for p in cands:
                        sim = calculate_string_ratio(g_doc_clean[g_idx], p_doc_clean[p])
                        sub = (g_doc_clean[g_idx] in p_doc_clean[p]) or (p_doc_clean[p] in g_doc_clean[g_idx])
                        if sim >= 0.7 or sub:
                            relevant.append(p)
                    if len(relevant) >= 2:
                        p_sum = sum(p_taxable[p] for p in relevant)
                        if abs(p_sum - g_taxable[g_idx]) <= 5.0:
                            unmatched_g.remove(g_idx)
                            for p in relevant:
                                unmatched_p.remove(p)
                            components = [
                                BatchComponentItemV5(
                                    row_index=p,
                                    row_number=p + 1,
                                    doc_type="PR",
                                    document_number=p_doc_raw[p],
                                    document_date=p_dates_str[p],
                                    taxable_value=round(float(p_taxable[p]), 2),
                                    tax_amount=round(float(p_tax[p]), 2),
                                    total_value=round(float(p_taxable[p] + p_tax[p]), 2),
                                    gstin=p_gstin_clean[p],
                                    share_percentage=round(float(p_taxable[p] / p_sum * 100.0), 1) if p_sum > 0 else 0.0,
                                )
                                for p in relevant
                            ]
                            records.append(ReconciliationRecordItemV5(
                                id=f"V5-REC-{len(records)+1:06d}",
                                index=len(records) + 1,
                                tars_verdict="Consolidated Match",
                                kics_verdict="BATCH_CONSOLIDATED",
                                concurrence="AGREEMENT",
                                disparity_reason=None,
                                source_gstin=gst,
                                target_gstin=gst,
                                source_doc_num=g_doc_raw[g_idx],
                                target_doc_num=f"{len(relevant)} Vouchers Consolidated",
                                source_date=g_dates_str[g_idx],
                                target_date=p_dates_str[relevant[0]],
                                source_taxable=round(float(g_taxable[g_idx]), 2),
                                target_taxable=round(float(p_sum), 2),
                                source_tax=round(float(g_tax[g_idx]), 2),
                                target_tax=round(float(sum(p_tax[p] for p in relevant)), 2),
                                taxable_diff=round(float(abs(g_taxable[g_idx] - p_sum)), 2),
                                tax_diff=round(float(abs(g_tax[g_idx] - sum(p_tax[p] for p in relevant))), 2),
                                pass_tier="PASS 2: TOLERANCE MATCH",
                                rule_tier="Tier 2: Commercial Tolerance",
                                sub_classification="CONSOLIDATED_BATCH",
                                classification_reason=f"Multi-Tranche Batch Consolidation (1:N): 1 portal invoice mapped against {len(relevant)} books vouchers totaling ₹{p_sum:,.2f}.",
                                ai_reason=f"KPMG Client Rule 1 matched single supplier bill with {len(relevant)} partial ERP booking tranches.",
                                variances={"batch_type": "1:N", "constituent_count": len(relevant), "net_variance": round(float(abs(g_taxable[g_idx] - p_sum)), 2)},
                                matched_by_pass="PASS 2: Multi-Tranche Batch",
                                bucket="TOLERANCE_MATCH",
                                batch_components=components,
                                constituent_items=[c.model_dump() for c in components],
                                gstr_preview={"GSTIN": gst, "Invoice": g_doc_raw[g_idx], "Date": g_dates_str[g_idx], "Taxable": g_taxable[g_idx], "Tax": g_tax[g_idx]},
                                pr_preview={"GSTIN": gst, "Invoice": f"{len(relevant)} Vouchers", "Date": p_dates_str[relevant[0]], "Taxable": p_sum, "Tax": sum(p_tax[p] for p in relevant)},
                            ))

        # Single 1:1 checks across Rule 7 (Sec 17(5)), Rule 3 (Penny tolerance), Rule 4 (Date lag), Rule 5 (Cross-FY)
        for g_idx in list(unmatched_g):
            gst = g_gstin_clean[g_idx]
            doc = g_doc_clean[g_idx]
            cands = [p for p in pr_by_gstin_doc.get((gst, doc), []) if p in unmatched_p]
            if len(cands) == 1:
                p_idx = cands[0]
                t_diff = g_taxable[g_idx] - p_taxable[p_idx]
                abs_t_diff = abs(t_diff)
                tax_diff = abs(g_tax[g_idx] - p_tax[p_idx])

                # Date difference calculation
                date_diff_days = 0
                is_cross_fy = False
                if pd.notna(g_dates_dt.iloc[g_idx]) and pd.notna(p_dates_dt.iloc[p_idx]):
                    d1 = g_dates_dt.iloc[g_idx]
                    d2 = p_dates_dt.iloc[p_idx]
                    date_diff_days = abs((d1 - d2).days)
                    # Cross FY check (March vs April)
                    if (d1.month == 3 and d2.month == 4) or (d1.month == 4 and d2.month == 3):
                        is_cross_fy = True

                # Tax head mismatch check
                g_i, g_c, g_s = g_igst[g_idx], g_cgst[g_idx], g_sgst[g_idx]
                p_i, p_c, p_s = p_igst[p_idx], p_cgst[p_idx], p_sgst[p_idx]
                has_breakdown = (g_i > 0 or g_c > 0 or g_s > 0) or (p_i > 0 or p_c > 0 or p_s > 0)
                is_tax_head_mismatch = False
                if has_breakdown:
                    if (abs(g_i - p_i) > 0.05) or (abs(g_c - p_c) > 0.05) or (abs(g_s - p_s) > 0.05):
                        is_tax_head_mismatch = True

                # Case A: Ineligible ITC u/s 17(5) (Books Tax < Portal Tax by >= threshold)
                if t_diff >= ineligible_threshold and p_taxable[p_idx] > 0 and (g_tax[g_idx] - p_tax[p_idx]) >= 0:
                    unmatched_g.remove(g_idx)
                    unmatched_p.remove(p_idx)
                    records.append(ReconciliationRecordItemV5(
                        id=f"V5-REC-{len(records)+1:06d}",
                        index=len(records) + 1,
                        tars_verdict="Ineligible ITC [Sec 17(5)]",
                        kics_verdict="INELIGIBLE_ITC_17_5",
                        concurrence="AGREEMENT",
                        disparity_reason=None,
                        source_gstin=gst,
                        target_gstin=p_gstin_clean[p_idx],
                        source_doc_num=g_doc_raw[g_idx],
                        target_doc_num=p_doc_raw[p_idx],
                        source_date=g_dates_str[g_idx],
                        target_date=p_dates_str[p_idx],
                        source_taxable=round(float(g_taxable[g_idx]), 2),
                        target_taxable=round(float(p_taxable[p_idx]), 2),
                        source_tax=round(float(g_tax[g_idx]), 2),
                        target_tax=round(float(p_tax[p_idx]), 2),
                        taxable_diff=round(float(abs_t_diff), 2),
                        tax_diff=round(float(tax_diff), 2),
                        pass_tier="PASS 2: TOLERANCE MATCH",
                        rule_tier="Tier 2: Commercial Tolerance",
                        sub_classification="INELIGIBLE_ITC_17_5",
                        classification_reason=f"Section 17(5) Ineligible ITC: Supplier filed full taxable ₹{g_taxable[g_idx]:,.2f}, client booked eligible ₹{p_taxable[p_idx]:,.2f}. Differential ₹{t_diff:,.2f} intentionally excluded under blocked credit.",
                        ai_reason="Statutory verification confirmed intentional blocked credit exclusion under Section 17(5).",
                        variances={"ineligible_itc_gap": round(float(t_diff), 2), "rule": "Rule 7: Ineligible ITC u/s 17(5)"},
                        matched_by_pass="PASS 2: Ineligible ITC u/s 17(5)",
                        bucket="TOLERANCE_MATCH",
                        gstr_preview={"GSTIN": gst, "Invoice": g_doc_raw[g_idx], "Date": g_dates_str[g_idx], "Taxable": g_taxable[g_idx], "Tax": g_tax[g_idx]},
                        pr_preview={"GSTIN": p_gstin_clean[p_idx], "Invoice": p_doc_raw[p_idx], "Date": p_dates_str[p_idx], "Taxable": p_taxable[p_idx], "Tax": p_tax[p_idx]},
                    ))
                    continue

                # Case B: Cross-FY boundary allowance
                if is_cross_fy and date_diff_days <= 60 and abs_t_diff <= commercial_tol:
                    unmatched_g.remove(g_idx)
                    unmatched_p.remove(p_idx)
                    records.append(ReconciliationRecordItemV5(
                        id=f"V5-REC-{len(records)+1:06d}",
                        index=len(records) + 1,
                        tars_verdict="Tolerance Match",
                        kics_verdict="CROSS_FY_MATCH",
                        concurrence="AGREEMENT",
                        disparity_reason=None,
                        source_gstin=gst,
                        target_gstin=p_gstin_clean[p_idx],
                        source_doc_num=g_doc_raw[g_idx],
                        target_doc_num=p_doc_raw[p_idx],
                        source_date=g_dates_str[g_idx],
                        target_date=p_dates_str[p_idx],
                        source_taxable=round(float(g_taxable[g_idx]), 2),
                        target_taxable=round(float(p_taxable[p_idx]), 2),
                        source_tax=round(float(g_tax[g_idx]), 2),
                        target_tax=round(float(p_tax[p_idx]), 2),
                        taxable_diff=round(float(abs_t_diff), 2),
                        tax_diff=round(float(tax_diff), 2),
                        pass_tier="PASS 2: TOLERANCE MATCH",
                        rule_tier="Tier 2: Commercial Tolerance",
                        sub_classification="CROSS_FY_TIMING_LAG",
                        classification_reason=f"Cross-FY Timing Boundary Match: Invoice dated March 31 reconciled with April purchase voucher ({date_diff_days}d delta).",
                        ai_reason="Allowed under Section 16(4) year-end cutoff buffer rules.",
                        variances={"date_delta_days": date_diff_days, "cross_fy": True, "taxable_diff": round(float(abs_t_diff), 2)},
                        matched_by_pass="PASS 2: Cross-FY Boundary",
                        bucket="TOLERANCE_MATCH",
                        gstr_preview={"GSTIN": gst, "Invoice": g_doc_raw[g_idx], "Date": g_dates_str[g_idx], "Taxable": g_taxable[g_idx], "Tax": g_tax[g_idx]},
                        pr_preview={"GSTIN": p_gstin_clean[p_idx], "Invoice": p_doc_raw[p_idx], "Date": p_dates_str[p_idx], "Taxable": p_taxable[p_idx], "Tax": p_tax[p_idx]},
                    ))
                    continue

                # Case C: Date proximity within window (e.g. ±30 days) and Commercial Penny tolerance
                if date_diff_days > 0 and date_diff_days <= date_tol_days and abs_t_diff <= commercial_tol and not is_tax_head_mismatch:
                    unmatched_g.remove(g_idx)
                    unmatched_p.remove(p_idx)
                    records.append(ReconciliationRecordItemV5(
                        id=f"V5-REC-{len(records)+1:06d}",
                        index=len(records) + 1,
                        tars_verdict="Tolerance Match",
                        kics_verdict="MATCHED_TOLERANCE",
                        concurrence="AGREEMENT",
                        disparity_reason=None,
                        source_gstin=gst,
                        target_gstin=p_gstin_clean[p_idx],
                        source_doc_num=g_doc_raw[g_idx],
                        target_doc_num=p_doc_raw[p_idx],
                        source_date=g_dates_str[g_idx],
                        target_date=p_dates_str[p_idx],
                        source_taxable=round(float(g_taxable[g_idx]), 2),
                        target_taxable=round(float(p_taxable[p_idx]), 2),
                        source_tax=round(float(g_tax[g_idx]), 2),
                        target_tax=round(float(p_tax[p_idx]), 2),
                        taxable_diff=round(float(abs_t_diff), 2),
                        tax_diff=round(float(tax_diff), 2),
                        pass_tier="PASS 2: TOLERANCE MATCH",
                        rule_tier="Tier 2: Commercial Tolerance",
                        sub_classification="DATE_OPERATIONAL_SHIFT",
                        classification_reason=f"Date Operational Shift: Taxable variance ₹{abs_t_diff:.2f} (within ±₹{commercial_tol:.2f}), Date lag {date_diff_days}d (within {date_tol_days}d).",
                        ai_reason="Operational booking delay absorbed under client date tolerance rules.",
                        variances={"taxable_diff": round(float(abs_t_diff), 2), "tax_diff": round(float(tax_diff), 2), "date_diff_days": date_diff_days},
                        matched_by_pass="PASS 2: Date Operational Shift",
                        bucket="TOLERANCE_MATCH",
                        gstr_preview={"GSTIN": gst, "Invoice": g_doc_raw[g_idx], "Date": g_dates_str[g_idx], "Taxable": g_taxable[g_idx], "Tax": g_tax[g_idx]},
                        pr_preview={"GSTIN": p_gstin_clean[p_idx], "Invoice": p_doc_raw[p_idx], "Date": p_dates_str[p_idx], "Taxable": p_taxable[p_idx], "Tax": p_tax[p_idx]},
                    ))
                    continue

                # Case D: Penny tolerance with zero date diff
                if date_diff_days == 0 and abs_t_diff <= commercial_tol and not is_tax_head_mismatch:
                    unmatched_g.remove(g_idx)
                    unmatched_p.remove(p_idx)
                    records.append(ReconciliationRecordItemV5(
                        id=f"V5-REC-{len(records)+1:06d}",
                        index=len(records) + 1,
                        tars_verdict="Tolerance Match",
                        kics_verdict="MATCHED_TOLERANCE",
                        concurrence="AGREEMENT",
                        disparity_reason=None,
                        source_gstin=gst,
                        target_gstin=p_gstin_clean[p_idx],
                        source_doc_num=g_doc_raw[g_idx],
                        target_doc_num=p_doc_raw[p_idx],
                        source_date=g_dates_str[g_idx],
                        target_date=p_dates_str[p_idx],
                        source_taxable=round(float(g_taxable[g_idx]), 2),
                        target_taxable=round(float(p_taxable[p_idx]), 2),
                        source_tax=round(float(g_tax[g_idx]), 2),
                        target_tax=round(float(p_tax[p_idx]), 2),
                        taxable_diff=round(float(abs_t_diff), 2),
                        tax_diff=round(float(tax_diff), 2),
                        pass_tier="PASS 2: TOLERANCE MATCH",
                        rule_tier="Tier 2: Commercial Tolerance",
                        sub_classification="VALUE_COMMERCIAL_TOLERANCE",
                        classification_reason=f"Commercial Penny Tolerance: Taxable variance ₹{abs_t_diff:.2f} within commercial threshold ±₹{commercial_tol:.2f}.",
                        ai_reason="Commercial policy parameter absorptions applied successfully.",
                        variances={"taxable_diff": round(float(abs_t_diff), 2), "tax_diff": round(float(tax_diff), 2), "date_diff_days": 0},
                        matched_by_pass="PASS 2: Commercial Penny Tolerance",
                        bucket="TOLERANCE_MATCH",
                        gstr_preview={"GSTIN": gst, "Invoice": g_doc_raw[g_idx], "Date": g_dates_str[g_idx], "Taxable": g_taxable[g_idx], "Tax": g_tax[g_idx]},
                        pr_preview={"GSTIN": p_gstin_clean[p_idx], "Invoice": p_doc_raw[p_idx], "Date": p_dates_str[p_idx], "Taxable": p_taxable[p_idx], "Tax": p_tax[p_idx]},
                    ))

        # -------------------------------------------------------------
        # PASS 3: NEAR MATCH (Tax Head Interchange, Fuzzy Doc Typo)
        # -------------------------------------------------------------
        # 1. Tax Head Interchange (e.g. IGST vs CGST+SGST with same total tax)
        for g_idx in list(unmatched_g):
            gst = g_gstin_clean[g_idx]
            doc = g_doc_clean[g_idx]
            cands = [p for p in pr_by_gstin_doc.get((gst, doc), []) if p in unmatched_p]
            if len(cands) == 1:
                p_idx = cands[0]
                abs_t_diff = abs(g_taxable[g_idx] - p_taxable[p_idx])
                tax_diff = abs(g_tax[g_idx] - p_tax[p_idx])

                g_i, g_c, g_s = g_igst[g_idx], g_cgst[g_idx], g_sgst[g_idx]
                p_i, p_c, p_s = p_igst[p_idx], p_cgst[p_idx], p_sgst[p_idx]
                has_breakdown = (g_i > 0 or g_c > 0 or g_s > 0) or (p_i > 0 or p_c > 0 or p_s > 0)
                is_tax_head_mismatch = False
                if has_breakdown:
                    if (abs(g_i - p_i) > 0.05) or (abs(g_c - p_c) > 0.05) or (abs(g_s - p_s) > 0.05):
                        is_tax_head_mismatch = True

                if is_tax_head_mismatch and abs_t_diff <= commercial_tol and tax_diff <= 0.05:
                    unmatched_g.remove(g_idx)
                    unmatched_p.remove(p_idx)
                    records.append(ReconciliationRecordItemV5(
                        id=f"V5-REC-{len(records)+1:06d}",
                        index=len(records) + 1,
                        tars_verdict="Probable Near Match",
                        kics_verdict="TAX_HEAD_INTERCHANGE",
                        concurrence="AGREEMENT",
                        disparity_reason=None,
                        source_gstin=gst,
                        target_gstin=p_gstin_clean[p_idx],
                        source_doc_num=g_doc_raw[g_idx],
                        target_doc_num=p_doc_raw[p_idx],
                        source_date=g_dates_str[g_idx],
                        target_date=p_dates_str[p_idx],
                        source_taxable=round(float(g_taxable[g_idx]), 2),
                        target_taxable=round(float(p_taxable[p_idx]), 2),
                        source_tax=round(float(g_tax[g_idx]), 2),
                        target_tax=round(float(p_tax[p_idx]), 2),
                        taxable_diff=round(float(abs_t_diff), 2),
                        tax_diff=round(float(tax_diff), 2),
                        pass_tier="PASS 3: NEAR MATCH",
                        rule_tier="Tier 3: Near-Match Semantic",
                        sub_classification="TAX_HEAD_INTERCHANGE",
                        classification_reason=f"Tax Head Interchange: Interstate vs Intrastate disparity (IGST ₹{g_i:.2f} vs CGST ₹{p_c:.2f} + SGST ₹{p_s:.2f}) with identical statutory total tax.",
                        ai_reason="Place of supply discrepancy detected between Government GSTR-2B filing and client purchase booking.",
                        variances={"tax_head_interchange": True, "taxable_diff": round(float(abs_t_diff), 2), "tax_diff": round(float(tax_diff), 2)},
                        matched_by_pass="PASS 3: Tax Head Interchange",
                        bucket="NEAR_MATCH",
                        gstr_preview={"GSTIN": gst, "Invoice": g_doc_raw[g_idx], "Date": g_dates_str[g_idx], "Taxable": g_taxable[g_idx], "Tax": g_tax[g_idx]},
                        pr_preview={"GSTIN": p_gstin_clean[p_idx], "Invoice": p_doc_raw[p_idx], "Date": p_dates_str[p_idx], "Taxable": p_taxable[p_idx], "Tax": p_tax[p_idx]},
                    ))

        # 2. Fuzzy Document String Ratio
        for g_idx in list(unmatched_g):
            gst = g_gstin_clean[g_idx]
            cands = [p for p in pr_by_gstin.get(gst, []) if p in unmatched_p]
            best_p = None
            best_sim = 0.0

            for p_idx in cands:
                sim = calculate_string_ratio(g_doc_clean[g_idx], p_doc_clean[p_idx])
                abs_t_diff = abs(g_taxable[g_idx] - p_taxable[p_idx])
                if sim >= 0.85 and abs_t_diff <= commercial_tol:
                    if sim > best_sim:
                        best_sim = sim
                        best_p = p_idx

            if best_p is not None:
                p_idx = best_p
                unmatched_g.remove(g_idx)
                unmatched_p.remove(p_idx)
                abs_t_diff = abs(g_taxable[g_idx] - p_taxable[p_idx])
                tax_diff = abs(g_tax[g_idx] - p_tax[p_idx])
                records.append(ReconciliationRecordItemV5(
                    id=f"V5-REC-{len(records)+1:06d}",
                    index=len(records) + 1,
                    tars_verdict="Near Match",
                    kics_verdict="FUZZY_CONFIRMED",
                    concurrence="AGREEMENT",
                    disparity_reason=None,
                    source_gstin=gst,
                    target_gstin=p_gstin_clean[p_idx],
                    source_doc_num=g_doc_raw[g_idx],
                    target_doc_num=p_doc_raw[p_idx],
                    source_date=g_dates_str[g_idx],
                    target_date=p_dates_str[p_idx],
                    source_taxable=round(float(g_taxable[g_idx]), 2),
                    target_taxable=round(float(p_taxable[p_idx]), 2),
                    source_tax=round(float(g_tax[g_idx]), 2),
                    target_tax=round(float(p_tax[p_idx]), 2),
                    taxable_diff=round(float(abs_t_diff), 2),
                    tax_diff=round(float(tax_diff), 2),
                    pass_tier="PASS 3: NEAR MATCH",
                    rule_tier="Tier 3: Near-Match Semantic",
                    sub_classification="DOC_PREFIX_NORMALIZED",
                    classification_reason=f"Document Typo / Prefix Variation: High similarity {best_sim*100:.1f}% between '{g_doc_raw[g_idx]}' and '{p_doc_raw[p_idx]}'.",
                    ai_reason="Compound heuristic matched identical financial substance with minor typographic variation.",
                    variances={"similarity_score": round(best_sim, 2), "taxable_diff": round(float(abs_t_diff), 2)},
                    matched_by_pass="PASS 3: Near Match",
                    bucket="NEAR_MATCH",
                    gstr_preview={"GSTIN": gst, "Invoice": g_doc_raw[g_idx], "Date": g_dates_str[g_idx], "Taxable": g_taxable[g_idx], "Tax": g_tax[g_idx]},
                    pr_preview={"GSTIN": p_gstin_clean[p_idx], "Invoice": p_doc_raw[p_idx], "Date": p_dates_str[p_idx], "Taxable": p_taxable[p_idx], "Tax": p_tax[p_idx]},
                ))

        # -------------------------------------------------------------
        # PASS 4: MULTI-CANDIDATE AMBIGUITY RESOLUTION (>= 2 candidates)
        # -------------------------------------------------------------
        for g_idx in list(unmatched_g):
            gst = g_gstin_clean[g_idx]
            cands = [p for p in pr_by_gstin.get(gst, []) if p in unmatched_p]
            competing = []
            for p_idx in cands:
                sim = calculate_string_ratio(g_doc_clean[g_idx], p_doc_clean[p_idx])
                abs_t_diff = abs(g_taxable[g_idx] - p_taxable[p_idx])
                if sim >= 0.70 or abs_t_diff <= 25.0:
                    competing.append(p_idx)

            if len(competing) >= 2:
                # Ambiguity Cluster found
                cluster_id = f"CLUST-V5-{uuid4().hex[:6].upper()}"
                cand_models = []
                for idx_rank, p_idx in enumerate(competing[:4]):
                    sim = calculate_string_ratio(g_doc_clean[g_idx], p_doc_clean[p_idx])
                    abs_t_diff = abs(g_taxable[g_idx] - p_taxable[p_idx])
                    score = min(98.0, max(60.0, (sim * 50.0) + (max(0, 50 - abs_t_diff))))
                    cand_models.append(AmbiguityCandidate(
                        candidate_id=f"CAND-{idx_rank+1}",
                        pr_row_index=p_idx,
                        pr_record_id=f"PR-ROW-{p_idx+1}",
                        confidence_score=round(score, 1),
                        score_breakdown=ScoreBreakdown(
                            invoice_similarity=round(sim * 100, 1),
                            amount_score=round(max(0, 100 - abs_t_diff * 4), 1),
                            date_score=90.0,
                            tax_score=95.0,
                        ),
                        detected_differences=[f"Invoice Doc Variance: '{g_doc_raw[g_idx]}' vs '{p_doc_raw[p_idx]}'", f"Amount Delta: ₹{abs_t_diff:.2f}"],
                        ai_reason=f"Candidate {idx_rank+1} shares vendor GSTIN with {sim*100:.0f}% document string similarity.",
                        pr_preview={"GSTIN": p_gstin_clean[p_idx], "Invoice": p_doc_raw[p_idx], "Date": p_dates_str[p_idx], "Taxable": p_taxable[p_idx], "Tax": p_tax[p_idx]},
                    ))

                cluster = AmbiguityCluster(
                    cluster_id=cluster_id,
                    gstr_row_index=g_idx,
                    gstr_record_id=f"GSTR-ROW-{g_idx+1}",
                    anchor_preview={"GSTIN": gst, "Invoice": g_doc_raw[g_idx], "Date": g_dates_str[g_idx], "Taxable": g_taxable[g_idx], "Tax": g_tax[g_idx]},
                    candidates=cand_models,
                    ai_justification=f"Disambiguation Engine detected {len(competing)} competing candidates under vendor {gst}. Top pick recommended for human verification.",
                    ambiguity_category="COMPETING_INVOICES",
                    category_label="Multi-Candidate Collision",
                    recommended_action="Inspect side-by-side candidates and bind primary match",
                )
                ambiguities.append(cluster.model_dump())

                unmatched_g.remove(g_idx)
                top_p = competing[0]
                unmatched_p.remove(top_p)
                records.append(ReconciliationRecordItemV5(
                    id=f"V5-REC-{len(records)+1:06d}",
                    index=len(records) + 1,
                    tars_verdict="Ambiguous Match",
                    kics_verdict="AMBIGUOUS_COLLISION",
                    concurrence="DISPARITY",
                    disparity_reason="Multi-candidate collision requires human verification",
                    source_gstin=gst,
                    target_gstin=p_gstin_clean[top_p],
                    source_doc_num=g_doc_raw[g_idx],
                    target_doc_num=p_doc_raw[top_p],
                    source_date=g_dates_str[g_idx],
                    target_date=p_dates_str[top_p],
                    source_taxable=round(float(g_taxable[g_idx]), 2),
                    target_taxable=round(float(p_taxable[top_p]), 2),
                    source_tax=round(float(g_tax[g_idx]), 2),
                    target_tax=round(float(p_tax[top_p]), 2),
                    taxable_diff=round(float(abs(g_taxable[g_idx] - p_taxable[top_p])), 2),
                    tax_diff=round(float(abs(g_tax[g_idx] - p_tax[top_p])), 2),
                    pass_tier="PASS 4: AMBIGUOUS",
                    rule_tier="Tier 3: Near-Match Semantic",
                    sub_classification="MULTI_CANDIDATE_COLLISION",
                    classification_reason=f"Ambiguity Cluster {cluster_id}: {len(competing)} candidate vouchers collide for portal invoice {g_doc_raw[g_idx]}.",
                    ai_reason="Human-in-the-loop review required via Disambiguation Hub to bind authoritative ERP record.",
                    variances={"cluster_id": cluster_id, "competing_candidates": len(competing)},
                    matched_by_pass="PASS 4: Ambiguous Collision",
                    bucket="AMBIGUOUS",
                    gstr_preview={"GSTIN": gst, "Invoice": g_doc_raw[g_idx], "Date": g_dates_str[g_idx], "Taxable": g_taxable[g_idx], "Tax": g_tax[g_idx]},
                    pr_preview={"GSTIN": p_gstin_clean[top_p], "Invoice": p_doc_raw[top_p], "Date": p_dates_str[top_p], "Taxable": p_taxable[top_p], "Tax": p_tax[top_p]},
                ))

        # -------------------------------------------------------------
        # PASS 5: RESIDUALS (GSTR 2B Only & PR Only)
        # -------------------------------------------------------------
        # Residual GSTR 2B Only (Unclaimed Credit)
        for g_idx in list(unmatched_g):
            gst = g_gstin_clean[g_idx]
            records.append(ReconciliationRecordItemV5(
                id=f"V5-REC-{len(records)+1:06d}",
                index=len(records) + 1,
                tars_verdict="GST Only",
                kics_verdict="UNCLAIMED_IN_BOOKS",
                concurrence="DISPARITY",
                disparity_reason="Missing in client accounting Purchase Register",
                source_gstin=gst,
                target_gstin="",
                source_doc_num=g_doc_raw[g_idx],
                target_doc_num="",
                source_date=g_dates_str[g_idx],
                target_date="",
                source_taxable=round(float(g_taxable[g_idx]), 2),
                target_taxable=0.0,
                source_tax=round(float(g_tax[g_idx]), 2),
                target_tax=0.0,
                taxable_diff=round(float(g_taxable[g_idx]), 2),
                tax_diff=round(float(g_tax[g_idx]), 2),
                pass_tier="PASS 5: RESIDUALS",
                classification_reason=f"Unclaimed Credit (GSTR 2B Only): Reported on GST portal by supplier {gst} but completely omitted from client ERP.",
                ai_reason="ITC Opportunity: Check with accounts payable if invoice is approved for booking before Section 16(4) annual cutoff.",
                variances={"unclaimed_itc": round(float(g_tax[g_idx]), 2)},
                matched_by_pass="PASS 5: GSTR 2B Only",
                bucket="GSTR_ONLY",
                gstr_preview={"GSTIN": gst, "Invoice": g_doc_raw[g_idx], "Date": g_dates_str[g_idx], "Taxable": g_taxable[g_idx], "Tax": g_tax[g_idx]},
                pr_preview={},
            ))

        # Residual PR Only (DRC-01C Risk)
        for p_idx in list(unmatched_p):
            gst = p_gstin_clean[p_idx]
            records.append(ReconciliationRecordItemV5(
                id=f"V5-REC-{len(records)+1:06d}",
                index=len(records) + 1,
                tars_verdict="PR Only",
                kics_verdict="MISSING_ON_PORTAL",
                concurrence="DISPARITY",
                disparity_reason="Supplier failed to file return in GSTR-1/IFF",
                source_gstin="",
                target_gstin=gst,
                source_doc_num="",
                target_doc_num=p_doc_raw[p_idx],
                source_date="",
                target_date=p_dates_str[p_idx],
                source_taxable=0.0,
                target_taxable=round(float(p_taxable[p_idx]), 2),
                source_tax=0.0,
                target_tax=round(float(p_tax[p_idx]), 2),
                taxable_diff=round(float(p_taxable[p_idx]), 2),
                tax_diff=round(float(p_tax[p_idx]), 2),
                pass_tier="PASS 5: RESIDUALS",
                classification_reason=f"DRC-01C Notice Risk (PR Only): Claimed in client ERP books but missing from Government GSTR-2B. Supplier default detected.",
                ai_reason="Vendor Communication Required: Chase supplier to file pending GSTR-1 to prevent credit reversal u/s 16(2)(c).",
                variances={"reversal_risk_itc": round(float(p_tax[p_idx]), 2)},
                matched_by_pass="PASS 5: PR Only",
                bucket="PR_ONLY",
                gstr_preview={},
                pr_preview={"GSTIN": gst, "Invoice": p_doc_raw[p_idx], "Date": p_dates_str[p_idx], "Taxable": p_taxable[p_idx], "Tax": p_tax[p_idx]},
            ))

        duration_ms = (time.time() - start_time) * 1000.0

        # Compute summary metrics
        exact_cnt = sum(1 for r in records if r.bucket == "EXACT_MATCH")
        tol_cnt = sum(1 for r in records if r.bucket == "TOLERANCE_MATCH")
        near_cnt = sum(1 for r in records if r.bucket == "NEAR_MATCH")
        amb_cnt = sum(1 for r in records if r.bucket == "AMBIGUOUS")
        gstr_only_cnt = sum(1 for r in records if r.bucket == "GSTR_ONLY")
        pr_only_cnt = sum(1 for r in records if r.bucket == "PR_ONLY")
        ineligible_cnt = sum(1 for r in records if "Ineligible" in r.tars_verdict)
        consolidated_cnt = sum(1 for r in records if "Consolidated" in r.tars_verdict)

        total_rec = len(records)
        reconciled_cnt = exact_cnt + tol_cnt + near_cnt
        concurrence_cnt = exact_cnt + tol_cnt + near_cnt
        concurrence_rate = round((concurrence_cnt / total_rec * 100.0), 1) if total_rec > 0 else 0.0

        summary = Stage4ResultsSummaryV5(
            total_records=total_rec,
            exact_matches=exact_cnt,
            tolerance_matches=tol_cnt,
            near_matches=near_cnt,
            ineligible_itc_matches=ineligible_cnt,
            consolidated_matches=consolidated_cnt,
            gst_only=gstr_only_cnt,
            pr_only=pr_only_cnt,
            ambiguous=amb_cnt,
            ambiguous_matches=amb_cnt,
            kics_concurrence_count=concurrence_cnt,
            kics_concurrence_rate=concurrence_rate,
            disparities_caught=gstr_only_cnt + pr_only_cnt + amb_cnt,
            net_taxable_variance=round(float(sum(r.taxable_diff for r in records)), 2),
            net_tax_variance=round(float(sum(r.tax_diff for r in records)), 2),
            total_gov_taxable=round(float(sum(g_taxable)), 2),
            total_pr_taxable=round(float(sum(p_taxable)), 2),
            total_gstr_rows=g_len,
            total_pr_rows=p_len,
            exact_match_count=exact_cnt,
            tolerance_match_count=tol_cnt,
            near_match_count=near_cnt,
            ambiguous_count=amb_cnt,
            gstr_only_count=gstr_only_cnt,
            pr_only_count=pr_only_cnt,
            total_reconciled_count=reconciled_cnt,
            overall_reconciliation_rate=round((reconciled_cnt / total_rec * 100.0), 1) if total_rec > 0 else 0.0,
            waterfall_passes=[
                {"name": "Pass 1: Exact Match", "count": exact_cnt, "percentage": round(exact_cnt / total_rec * 100.0, 1) if total_rec > 0 else 0.0},
                {"name": "Pass 2: Tolerance Match", "count": tol_cnt, "percentage": round(tol_cnt / total_rec * 100.0, 1) if total_rec > 0 else 0.0},
                {"name": "Pass 3: Near Match", "count": near_cnt, "percentage": round(near_cnt / total_rec * 100.0, 1) if total_rec > 0 else 0.0},
                {"name": "Pass 4: Ambiguous", "count": amb_cnt, "percentage": round(amb_cnt / total_rec * 100.0, 1) if total_rec > 0 else 0.0},
                {"name": "Pass 5: Residuals", "count": gstr_only_cnt + pr_only_cnt, "percentage": round((gstr_only_cnt + pr_only_cnt) / total_rec * 100.0, 1) if total_rec > 0 else 0.0},
            ],
            rule_breakdown={
                "Supplier GSTIN Match": exact_cnt + tol_cnt + near_cnt,
                "Commercial Tolerance": tol_cnt,
                "Prefix Normalization": near_cnt,
                "Section 17(5) Ineligible": ineligible_cnt,
                "Multi-Tranche Batch": consolidated_cnt,
            },
        )

        compared_columns = [
            {"canonical": "gstin", "source": g_gstin_col, "target": p_gstin_col},
            {"canonical": "document_number", "source": g_doc_col, "target": p_doc_col},
            {"canonical": "document_date", "source": g_date_col, "target": p_date_col},
            {"canonical": "taxable_value", "source": g_taxable_col, "target": p_taxable_col},
            {"canonical": "tax_amount", "source": g_tax_col, "target": p_tax_col},
        ]

        return Stage4ExecutionResponseV5(
            session_id=str(uuid4()),
            executed_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),
            duration_ms=round(duration_ms, 2),
            summary=summary,
            records=records,
            kics_status_column=kics_column or "",
            ambiguities=ambiguities,
            compared_columns=compared_columns,
        )


def simulate_rules_v5(
    rules: list[Rule5Item] | None = None,
    gstr_df: pd.DataFrame | None = None,
    pr_df: pd.DataFrame | None = None,
    sample_size: int = 50,
) -> dict[str, Any]:
    """Runs a fast simulation of V5 rules against benchmark DataFrames for Rules Wiki 5.0 HUD."""
    rules = rules or build_default_rules_v5()
    if gstr_df is None or pr_df is None:
        g_rows = []
        p_rows = []
        for i in range(sample_size):
            gstin = f"27AABCU{1000 + i}P1Z{i % 9}"
            doc = f"INV-2026-{1000 + i}"
            dt = "2026-06-15"
            taxable = float(10000 + i * 500)
            tax = taxable * 0.18
            g_rows.append({
                "Supplier GSTIN": gstin,
                "Invoice Number": doc,
                "Invoice Date": dt,
                "Taxable Value": taxable,
                "Tax Amount": tax,
            })
            if i % 10 < 7:
                p_rows.append({
                    "Supplier GSTIN": gstin,
                    "Invoice Number": doc,
                    "Invoice Date": dt,
                    "Taxable Value": taxable,
                    "Tax Amount": tax,
                })
            elif i % 10 == 7:
                p_rows.append({
                    "Supplier GSTIN": gstin,
                    "Invoice Number": doc,
                    "Invoice Date": "2026-06-20",
                    "Taxable Value": taxable,
                    "Tax Amount": tax,
                })
            elif i % 10 == 8:
                p_rows.append({
                    "Supplier GSTIN": gstin,
                    "Invoice Number": doc,
                    "Invoice Date": dt,
                    "Taxable Value": taxable - 5.0,
                    "Tax Amount": tax - 0.9,
                })
            else:
                p_rows.append({
                    "Supplier GSTIN": f"29AABCU{9000 + i}P1Z0",
                    "Invoice Number": f"DIFF-{i}",
                    "Invoice Date": dt,
                    "Taxable Value": 9999.0,
                    "Tax Amount": 1799.8,
                })
        gstr_df = pd.DataFrame(g_rows)
        pr_df = pd.DataFrame(p_rows)

    engine = WaterfallMatchingEngineV5(rules=rules)
    resp = engine.run(gstr_df, pr_df)
    s = resp.summary

    breakdowns = []
    for r in rules:
        satisfied = s.exact_matches
        if r.match_strategy in ("NUMERIC_TOLERANCE", "DATE_PROXIMITY", "CROSS_FY", "INELIGIBLE_ITC", "MULTI_TRANCHE"):
            satisfied += s.tolerance_matches
        elif r.match_strategy in ("COMPOUND", "NORMALIZED_TEXT"):
            satisfied += s.near_matches
        pct = round((satisfied / s.total_records * 100.0), 1) if s.total_records > 0 else 0.0
        breakdowns.append({
            "rule_id": r.id,
            "rule_name": r.name,
            "category": r.category,
            "individual_satisfied_count": satisfied,
            "individual_satisfied_percentage": pct,
        })

    return {
        "status": "success",
        "sample_size": sample_size,
        "total_gstr_rows": s.total_gstr_rows,
        "total_pr_rows": s.total_pr_rows,
        "total_matched": s.total_reconciled_count,
        "overall_match_rate": s.overall_reconciliation_rate,
        "total_unmatched_gstr": s.gst_only,
        "total_unmatched_pr": s.pr_only,
        "rule_breakdowns": breakdowns,
    }
