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


class NormalizerConfigV4(BaseModel):
    trim_whitespace: bool = True
    strip_special_chars: bool = True
    strip_prefixes: bool = True
    trim_leading_zeros: bool = True
    case_fold: bool = True


class Rule4Item(BaseModel):
    id: str
    order: int
    name: str
    description: str
    statutory_rationale: str
    category: str = "INTRA_TABLE_UPDATED"  # "CORE_IDENTITY" | "DOCUMENT_REFERENCE" | "FINANCIAL_VALUE" | "TEMPORAL_WINDOW" | "STATUTORY_DISCREPANCY" | "CONSOLIDATION"
    canonical_concept: str
    is_mandatory: bool = True
    is_enabled: bool = True
    match_strategy: str = "EXACT"  # "EXACT" | "NUMERIC_TOLERANCE" | "DATE_PROXIMITY" | "CROSS_FY" | "COMPOUND" | "INELIGIBLE_ITC" | "MULTI_TRANCHE" | "KICS_CONCURRENCE"
    source_field_concept: str
    target_field_concept: str
    tolerance_value: float | None = None
    tolerance_unit: str | None = None  # "INR" | "DAYS" | "PERCENT"
    normalizers: NormalizerConfigV4 = Field(default_factory=NormalizerConfigV4)
    created_at: str = Field(default_factory=lambda: datetime.datetime.now(datetime.timezone.utc).isoformat())
    is_temporary: bool = False
    scope: str = "wiki"  # "temporary" | "wiki"
    origin_session_id: str | None = None
    created_by: str | None = "System Standard Baseline 4.0"
    version: str | None = "1.0.0"
    tolerance_mode: str | None = "ABSOLUTE_INR"  # "ABSOLUTE_INR" | "PERCENTAGE"
    date_tolerance_value: int | None = 0
    date_tolerance_unit: str | None = "DAYS"
    advisory_caution: str | None = None
    plain_english_explanation: str | None = None
    why_it_matters: str | None = None
    rule_tier: str | None = "CORE_STATUTORY"
    # Special parameters for client KPMG rules
    min_threshold_ineligible: float | None = 100.0  # Rule 2: Minimum value variance for Section 17(5)
    cross_fy_enabled: bool = True                  # Rule 4: Allow cross-FY March -> April
    custom_date_range_days: int | None = 30         # Rule 1 & Rule 3: Rolling window days
    custom_date_range_start: str | None = None
    custom_date_range_end: str | None = None


class ReconciliationRecordItemV4(BaseModel):
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
    pass_tier: str  # "Tier 1: Exact Match", "Tier 2: Tolerance & Cross-FY", "Tier 3: Normalized & Compound", "Tier 4: Statutory & Batch", "Tier 5: Residuals"
    raw_attributes: dict[str, Any] = Field(default_factory=dict)
    bucket: str = "AMBIGUOUS"
    sub_classification: str | None = None  # e.g., "INELIGIBLE_ITC_17_5", "CROSS_FY_TIMING", "BANKING_CONSOLIDATED"
    reclassified_from: str | None = None
    reclassification_note: str | None = None
    classification_reason: str | None = None
    ai_reason: str | None = None
    # V2 UI Compatibility Fields
    gstr_row_index: int | None = None
    pr_row_index: int | None = None
    gstin: str = ""
    document_number: str = ""
    document_date: str | None = None
    taxable_value: float = 0.0
    tax_amount: float = 0.0
    total_value: float = 0.0
    gstr_preview: dict[str, Any] = Field(default_factory=dict)
    pr_preview: dict[str, Any] = Field(default_factory=dict)
    variances: dict[str, Any] = Field(default_factory=dict)
    matched_by_pass: str = ""
    batch_components: list[dict[str, Any]] = Field(default_factory=list)
    ambiguity_cluster_id: str | None = None


class Stage4ResultsSummaryV4(BaseModel):
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
    kics_concurrence_count: int
    kics_concurrence_rate: float
    disparities_caught: int
    net_taxable_variance: float
    net_tax_variance: float
    total_gov_taxable: float
    total_pr_taxable: float
    accuracy_percentage: float = 100.0
    # V2 UI Compatibility Fields
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


class Stage4ExecutionResponseV4(BaseModel):
    model_config = {"extra": "allow"}

    session_id: str
    executed_at: str
    duration_ms: float
    summary: Stage4ResultsSummaryV4
    records: list[ReconciliationRecordItemV4] = Field(default_factory=list)
    kics_status_column: str = ""
    ambiguities: list[dict[str, Any]] = Field(default_factory=list)
    compared_columns: list[dict[str, Any]] = Field(default_factory=list)


def build_default_rules_v4() -> list[Rule4Item]:
    """Authoritative Master Rules V4 Catalog pre-configured with the 6 KPMG client rules."""
    return [
        Rule4Item(
            id="R4-01",
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
            source_field_concept="CPGstin",
            target_field_concept="PRGstin",
            tolerance_value=0.0,
            tolerance_unit="INR",
            tolerance_mode="ABSOLUTE_INR",
            date_tolerance_value=0,
            date_tolerance_unit="DAYS",
            normalizers=NormalizerConfigV4(trim_whitespace=True, strip_special_chars=True, case_fold=True),
            created_by="System Standard Baseline 4.0",
            version="1.0.0",
            advisory_caution="Word of Caution: Primary statutory anchor under Section 16(2)(aa). Cannot be disabled.",
            plain_english_explanation="Verifies that the Supplier GSTIN in portal records exactly matches the Supplier GSTIN in books records.",
            why_it_matters="Input Tax Credit cannot legally be claimed if supplier GSTIN does not match.",
        ),
        Rule4Item(
            id="R4-02",
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
            source_field_concept="CPDocumentNumber",
            target_field_concept="PRDocumentNumber",
            tolerance_value=0.0,
            tolerance_unit="INR",
            tolerance_mode="ABSOLUTE_INR",
            date_tolerance_value=0,
            date_tolerance_unit="DAYS",
            normalizers=NormalizerConfigV4(trim_whitespace=True, strip_special_chars=True, strip_prefixes=True, trim_leading_zeros=True, case_fold=True),
            created_by="KPMG Client Rule 5",
            version="1.0.0",
            advisory_caution="Standardizes document entry variations across accounting software.",
            plain_english_explanation="Strips 'INV/2026/', 'BILL-', hyphens, and leading zeroes so 'INV/2026/00123' matches '00123' cleanly.",
            why_it_matters="Prevents valid purchases from failing reconciliation due to manual ERP formatting.",
        ),
        Rule4Item(
            id="R4-03",
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
            source_field_concept="CPTaxableValue",
            target_field_concept="PRTaxableValue",
            tolerance_value=10.0,
            tolerance_unit="INR",
            tolerance_mode="ABSOLUTE_INR",
            date_tolerance_value=0,
            date_tolerance_unit="DAYS",
            normalizers=NormalizerConfigV4(trim_whitespace=True),
            created_by="System Standard Baseline 4.0",
            version="1.0.0",
            advisory_caution="Absorbs line-item vs invoice-level penny rounding.",
            plain_english_explanation="Treats financial values as matching if the variance between portal and books is within ± ₹10.00.",
            why_it_matters="Eliminates false rejections caused by minor rounding discrepancies.",
        ),
        Rule4Item(
            id="R4-04",
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
            source_field_concept="CPDocumentDate",
            target_field_concept="PRDocumentDate",
            tolerance_value=0.0,
            tolerance_unit="DAYS",
            tolerance_mode="ABSOLUTE_INR",
            date_tolerance_value=30,
            date_tolerance_unit="DAYS",
            custom_date_range_days=30,
            normalizers=NormalizerConfigV4(trim_whitespace=True),
            created_by="KPMG Client Rule 3",
            version="1.0.0",
            advisory_caution="Configurable calendar window for accounts payable booking delays.",
            plain_english_explanation="Allows invoice dates between portal and books to vary by up to 30 days without failing the match.",
            why_it_matters="Vendors often date invoices at month-end while buyers book them upon physical receipt in the following month.",
        ),
        Rule4Item(
            id="R4-05",
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
            source_field_concept="CPDocumentDate",
            target_field_concept="PRDocumentDate",
            tolerance_value=0.0,
            tolerance_unit="DAYS",
            tolerance_mode="ABSOLUTE_INR",
            date_tolerance_value=60,
            date_tolerance_unit="DAYS",
            cross_fy_enabled=True,
            normalizers=NormalizerConfigV4(trim_whitespace=True),
            created_by="KPMG Client Rule 4",
            version="1.0.0",
            advisory_caution="Breaks strict FY sandboxes to capture year-end transit invoices.",
            plain_english_explanation="Permits matching between March year-end supplier filings and April new-year purchase register entries.",
            why_it_matters="Critical for year-end corporate audit closing and preventing missed ITC claims across financial years.",
        ),
        Rule4Item(
            id="R4-06",
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
            source_field_concept="CPDocumentNumber",
            target_field_concept="PRDocumentNumber",
            tolerance_value=10.0,
            tolerance_unit="INR",
            tolerance_mode="ABSOLUTE_INR",
            date_tolerance_value=15,
            date_tolerance_unit="DAYS",
            normalizers=NormalizerConfigV4(trim_whitespace=True, strip_special_chars=True, strip_prefixes=True, case_fold=True),
            created_by="KPMG Client Rule 6",
            version="1.0.0",
            advisory_caution="Recovers transactions that would otherwise fail both exact and single-tolerance passes.",
            plain_english_explanation="Matches invoices like 'SUPP-4521' (15-Jan) with 'SUPP4521' (20-Jan) when vendor GSTIN and tax amounts match.",
            why_it_matters="Prevents compound clerical entry variations from creating duplicate un-reconciled exceptions.",
        ),
        Rule4Item(
            id="R4-07",
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
            source_field_concept="CPTaxableValue",
            target_field_concept="PRTaxableValue",
            tolerance_value=0.0,
            tolerance_unit="INR",
            tolerance_mode="ABSOLUTE_INR",
            min_threshold_ineligible=100.0,
            normalizers=NormalizerConfigV4(trim_whitespace=True),
            created_by="KPMG Client Rule 2",
            version="1.0.0",
            advisory_caution="Categorizes intentional Section 17(5) non-bookings as verified rather than audit failures.",
            plain_english_explanation="When GSTIN, Doc No, and Date match but Books Tax < Portal Tax, classifies the gap as Ineligible ITC u/s 17(5).",
            why_it_matters="Protects statutory audit integrity by recognizing intentional blocked credit exclusions instead of flagging errors.",
        ),
        Rule4Item(
            id="R4-08",
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
            source_field_concept="CPTaxableValue",
            target_field_concept="PRTaxableValue",
            tolerance_value=5.0,
            tolerance_unit="INR",
            tolerance_mode="ABSOLUTE_INR",
            custom_date_range_days=31,
            normalizers=NormalizerConfigV4(trim_whitespace=True),
            created_by="KPMG Client Rule 1",
            version="1.0.0",
            advisory_caution="Enables N:1 batch aggregation matching across a custom monthly date window.",
            plain_english_explanation="Matches 3 bank invoices totaling ₹1,800 against 1 monthly journal voucher for ₹1,800 under the bank's GSTIN.",
            why_it_matters="Eliminates the persistent issue where bank service charges show up as missing on both sides.",
        ),
    ]


class WaterfallMatchingEngineV4:
    """Supercharged 5-tier vectorized matching engine implementing Option B with all 6 KPMG client rules."""

    def __init__(self, rules: list[Rule4Item] | None = None) -> None:
        self.rules = rules or build_default_rules_v4()

    def _resolve_col(self, df: pd.DataFrame, mapped_pairs: dict[str, str], candidates: list[str]) -> str | None:
        cols_lower = {str(c).strip().lower(): str(c) for c in df.columns}
        for cand in candidates:
            if cand.lower() in cols_lower:
                return cols_lower[cand.lower()]
            if cand in mapped_pairs and mapped_pairs[cand] in df.columns:
                return mapped_pairs[cand]
            for s, t in mapped_pairs.items():
                if cand.lower() in s.lower() and t in df.columns:
                    return t
                if cand.lower() in t.lower() and s in df.columns:
                    return s
        for c_lower, orig in cols_lower.items():
            for cand in candidates:
                if cand.lower() in c_lower:
                    return orig
        return None

    @staticmethod
    def _find_subset_sum_indices(
        items: list[tuple[int, float]],
        target: float,
        tolerance: float,
        min_k: int = 2,
        max_k: int = 10,
    ) -> tuple[list[int], float] | None:
        """
        Finds a subset of items (between min_k and max_k items) whose sum is within tolerance of target.
        Returns (list_of_indices, sum_amount) or None if no valid subset exists.
        Uses branch-and-bound pruning with early stopping.
        """
        if not items or target <= 0.0:
            return None

        candidates = [(idx, round(amt, 2)) for idx, amt in items if 0.0 < amt <= target + tolerance + 1e-4]
        if len(candidates) < min_k:
            return None

        total_avail = round(sum(amt for _, amt in candidates), 2)
        if total_avail < target - tolerance - 1e-4:
            return None

        # Check if entire group matches
        if abs(total_avail - target) <= tolerance and len(candidates) <= max_k:
            return [idx for idx, _ in candidates], total_avail

        # Sort descending for aggressive branch pruning
        candidates.sort(key=lambda x: x[1], reverse=True)
        # Cap candidate pool to top 60 relevant entries to ensure high throughput on 50k+ datasets
        candidates = candidates[:60]

        best_subset: list[int] | None = None
        best_sum: float = 0.0
        min_diff: float = float("inf")
        iterations = 0
        max_iterations = 500

        def backtrack(start_idx: int, current_sum: float, chosen: list[int]):
            nonlocal best_subset, best_sum, min_diff, iterations
            iterations += 1
            if iterations > max_iterations:
                return False

            diff = abs(current_sum - target)
            if len(chosen) >= min_k:
                if diff <= tolerance + 1e-4:
                    if diff < min_diff:
                        min_diff = diff
                        best_subset = list(chosen)
                        best_sum = round(current_sum, 2)
                    if diff < 0.01:  # Exact penny match
                        return True

            if len(chosen) >= max_k or start_idx >= len(candidates):
                return False

            for i in range(start_idx, len(candidates)):
                idx, amt = candidates[i]
                if current_sum + amt > target + tolerance + 1e-4:
                    continue

                chosen.append(idx)
                if backtrack(i + 1, current_sum + amt, chosen):
                    return True
                chosen.pop()

            return False

        backtrack(0, 0.0, [])
        if best_subset is not None:
            return best_subset, best_sum
        return None

    def _detect_batch_consolidations(
        self,
        n_rows: int,
        unmatched_mask: pd.Series,
        cp_gstin: pd.Series,
        pr_gstin: pd.Series,
        cp_doc: pd.Series,
        pr_doc: pd.Series,
        cp_doc_clean: pd.Series,
        pr_doc_clean: pd.Series,
        cp_dates: pd.Series,
        pr_dates: pd.Series,
        cp_taxable: pd.Series,
        pr_taxable: pd.Series,
        cp_igst: pd.Series,
        pr_igst: pd.Series,
        is_bank_voucher: pd.Series,
        gstin_match: pd.Series,
        date_proximate: pd.Series,
        tolerance: float = 5.0,
        window_days: int = 31,
    ) -> tuple[pd.Series, dict[int, dict[str, Any]]]:
        """
        Executes N:1 and 1:N batch consolidation detection:
        1. Repeated target voucher/invoice grouping (same vendor, same target doc, sum matches target)
        2. Disjoint subset-sum aggregation across unrolled/residual items (same vendor, date window)
        3. Legacy bank voucher keyword heuristic fallback.
        """
        consolidation_mask = pd.Series(False, index=range(n_rows))
        consolidation_meta: dict[int, dict[str, Any]] = {}
        absorbed_indices: set[int] = set()

        unmatched_indices = set(np.where(unmatched_mask.values)[0])
        if not unmatched_indices:
            return consolidation_mask, consolidation_meta, absorbed_indices

        # Effective GSTIN series
        eff_gstin = cp_gstin.copy()
        mask_empty_cp = eff_gstin.isin(["", "NAN", "NONE"])
        eff_gstin[mask_empty_cp] = pr_gstin[mask_empty_cp]

        # Precompute integer epoch days for O(1) date arithmetic
        cp_days_arr = np.where(cp_dates.notna(), (cp_dates.values.astype("datetime64[D]").astype(np.int64)), -999999)
        pr_days_arr = np.where(pr_dates.notna(), (pr_dates.values.astype("datetime64[D]").astype(np.int64)), -999999)

        cp_dates_lst = cp_dates.tolist()
        pr_dates_lst = pr_dates.tolist()
        cp_taxable_arr = cp_taxable.values
        pr_taxable_arr = pr_taxable.values
        cp_igst_arr = cp_igst.values
        pr_igst_arr = pr_igst.values
        cp_doc_lst = cp_doc.tolist()
        pr_doc_lst = pr_doc.tolist()
        cp_gstin_lst = cp_gstin.tolist()
        pr_gstin_lst = pr_gstin.tolist()
        eff_gstin_lst = eff_gstin.tolist()
        cp_clean_lst = cp_doc_clean.tolist()
        pr_clean_lst = pr_doc_clean.tolist()
        cp_date_lst = [str(x) if x is not None and not pd.isna(x) else "" for x in cp_dates_lst]
        pr_date_lst = [str(x) if x is not None and not pd.isna(x) else "" for x in pr_dates_lst]

        def _dates_within_window(idx1: int, idx2: int) -> bool:
            d1 = cp_days_arr[idx1] if cp_days_arr[idx1] != -999999 else pr_days_arr[idx1]
            d2 = pr_days_arr[idx2] if pr_days_arr[idx2] != -999999 else cp_days_arr[idx2]
            if d1 == -999999 or d2 == -999999:
                return True
            return abs(int(d1 - d2)) <= window_days

        def _try_match_group(grp: list[int]) -> bool:
            nonlocal unmatched_indices
            if len(grp) < 2 or not all(k in unmatched_indices for k in grp):
                return False

            base_idx = grp[0]
            if not all(_dates_within_window(k, base_idx) for k in grp):
                return False

            cp_vals = [float(cp_taxable_arr[k]) for k in grp]
            pr_vals = [float(pr_taxable_arr[k]) for k in grp]
            pos_cp = [v for v in cp_vals if v > 0.0]
            pos_pr = [v for v in pr_vals if v > 0.0]

            # 1. Check 1:N (1 CP master target, N PR components)
            if len(pos_pr) >= 2 and len(pos_cp) >= 1:
                unique_cp = set(round(v, 2) for v in pos_cp)
                if len(unique_cp) == 1:
                    cp_target = next(iter(unique_cp))
                    pr_sum = round(sum(pos_pr), 2)
                    var = round(abs(pr_sum - cp_target), 2)
                    if var <= tolerance:
                        cp_tax_vals = [float(cp_igst_arr[k]) for k in grp if float(cp_taxable_arr[k]) > 0.0]
                        cp_tax_val = cp_tax_vals[0] if cp_tax_vals else 0.0
                        pr_tax_sum = round(sum(float(pr_igst_arr[k]) for k in grp), 2)
                        t_doc = next((str(cp_doc_lst[k]) for k in grp if str(cp_doc_lst[k]) not in ("", "NAN", "NONE")), str(pr_doc_lst[base_idx]))

                        cp_cands = [k for k in grp if float(cp_taxable_arr[k]) > 0.0]
                        master_idx = cp_cands[0] if cp_cands else grp[0]
                        child_indices = [k for k in grp if k != master_idx]
                        absorbed_indices.update(child_indices)

                        components = []
                        pr_rows = [k for k in grp if float(pr_taxable_arr[k]) > 0.0]
                        for k in pr_rows:
                            p_taxable = float(pr_taxable_arr[k])
                            p_tax = float(pr_igst_arr[k])
                            share = round((p_taxable / pr_sum * 100.0), 1) if pr_sum > 0 else 0.0
                            components.append({
                                "row_index": int(k),
                                "row_number": int(k) + 1,
                                "doc_type": "PR",
                                "document_number": str(pr_doc_lst[k]),
                                "document_date": str(pr_date_lst[k]),
                                "taxable_value": round(p_taxable, 2),
                                "tax_amount": round(p_tax, 2),
                                "total_value": round(p_taxable + p_tax, 2),
                                "gstin": str(pr_gstin_lst[k]),
                                "share_percentage": float(share),
                            })

                        for k in grp:
                            if k in unmatched_indices:
                                unmatched_indices.remove(k)

                        consolidation_mask.iloc[master_idx] = True
                        for c_idx in child_indices:
                            consolidation_mask.iloc[c_idx] = True
                            consolidation_meta[c_idx] = {
                                "is_master": False,
                                "master_index": master_idx,
                                "mode": "1:N",
                                "target_doc": t_doc,
                                "target_amount": cp_target,
                            }
                        comp_docs = [str(c["document_number"]) for c in components]
                        doc_summary = f"{len(components)} Vouchers: {', '.join(comp_docs[:2])}{'...' if len(components) > 2 else ''}"

                        consolidation_meta[master_idx] = {
                            "is_master": True,
                            "mode": "1:N",
                            "batch_count": len(components),
                            "batch_sum": pr_sum,
                            "target_amount": cp_target,
                            "target_doc": t_doc,
                            "variance": var,
                            "tax_variance": round(abs(pr_tax_sum - cp_tax_val), 2),
                            "component_docs": comp_docs,
                            "components": components,
                            "source_taxable": cp_target,
                            "source_tax": cp_tax_val,
                            "target_taxable": pr_sum,
                            "target_tax": pr_tax_sum,
                            "source_doc_num": t_doc,
                            "target_doc_num": doc_summary,
                            "source_date": str(cp_dates_lst[master_idx]) if master_idx < len(cp_dates_lst) else "",
                            "target_date": str(pr_dates_lst[base_idx]) if base_idx < len(pr_dates_lst) else "",
                            "source_gstin": str(eff_gstin_lst[master_idx]),
                            "target_gstin": str(eff_gstin_lst[master_idx]),
                        }
                        return True

            # 2. Check N:1 (N CP components, 1 PR target)
            if len(pos_cp) >= 2 and len(pos_pr) >= 1:
                unique_pr = set(round(v, 2) for v in pos_pr)
                if len(unique_pr) == 1:
                    pr_target = next(iter(unique_pr))
                    cp_sum = round(sum(pos_cp), 2)
                    var = round(abs(cp_sum - pr_target), 2)
                    if var <= tolerance:
                        pr_tax_vals = [float(pr_igst_arr[k]) for k in grp if float(pr_taxable_arr[k]) > 0.0]
                        pr_tax_val = pr_tax_vals[0] if pr_tax_vals else 0.0
                        cp_tax_sum = round(sum(float(cp_igst_arr[k]) for k in grp), 2)
                        t_doc = next((str(pr_doc_lst[k]) for k in grp if str(pr_doc_lst[k]) not in ("", "NAN", "NONE")), str(cp_doc_lst[base_idx]))

                        pr_cands = [k for k in grp if float(pr_taxable_arr[k]) > 0.0]
                        master_idx = pr_cands[0] if pr_cands else grp[0]
                        child_indices = [k for k in grp if k != master_idx]
                        absorbed_indices.update(child_indices)

                        components = []
                        cp_rows = [k for k in grp if float(cp_taxable_arr[k]) > 0.0]
                        for k in cp_rows:
                            c_taxable = float(cp_taxable_arr[k])
                            c_tax = float(cp_igst_arr[k])
                            share = round((c_taxable / cp_sum * 100.0), 1) if cp_sum > 0 else 0.0
                            components.append({
                                "row_index": int(k),
                                "row_number": int(k) + 1,
                                "doc_type": "GSTR",
                                "document_number": str(cp_doc_lst[k]),
                                "document_date": str(cp_date_lst[k]),
                                "taxable_value": round(c_taxable, 2),
                                "tax_amount": round(c_tax, 2),
                                "total_value": round(c_taxable + c_tax, 2),
                                "gstin": str(cp_gstin_lst[k]),
                                "share_percentage": float(share),
                            })

                        for k in grp:
                            if k in unmatched_indices:
                                unmatched_indices.remove(k)

                        consolidation_mask.iloc[master_idx] = True
                        for c_idx in child_indices:
                            consolidation_mask.iloc[c_idx] = True
                            consolidation_meta[c_idx] = {
                                "is_master": False,
                                "master_index": master_idx,
                                "mode": "N:1",
                                "target_doc": t_doc,
                                "target_amount": pr_target,
                            }
                        comp_docs = [str(c["document_number"]) for c in components]
                        doc_summary = f"{len(components)} Invoices: {', '.join(comp_docs[:2])}{'...' if len(components) > 2 else ''}"

                        consolidation_meta[master_idx] = {
                            "is_master": True,
                            "mode": "N:1",
                            "batch_count": len(components),
                            "batch_sum": cp_sum,
                            "target_amount": pr_target,
                            "target_doc": t_doc,
                            "variance": var,
                            "tax_variance": round(abs(cp_tax_sum - pr_tax_val), 2),
                            "component_docs": comp_docs,
                            "components": components,
                            "source_taxable": cp_sum,
                            "source_tax": cp_tax_sum,
                            "target_taxable": pr_target,
                            "target_tax": pr_tax_val,
                            "source_doc_num": doc_summary,
                            "target_doc_num": t_doc,
                            "source_date": str(cp_dates_lst[base_idx]) if base_idx < len(cp_dates_lst) else "",
                            "target_date": str(pr_dates_lst[master_idx]) if master_idx < len(pr_dates_lst) else "",
                            "source_gstin": str(eff_gstin_lst[master_idx]),
                            "target_gstin": str(eff_gstin_lst[master_idx]),
                        }
                        return True

            return False

        # PHASE 1A: Group by shared PR document number
        pr_groups: dict[tuple[str, str], list[int]] = {}
        for idx in list(unmatched_indices):
            g = eff_gstin_lst[idx]
            p_d = pr_doc_lst[idx]
            if g and g not in ("NAN", "NONE") and p_d and p_d not in ("NAN", "NONE"):
                pr_groups.setdefault((g, p_d), []).append(idx)
        for grp in pr_groups.values():
            _try_match_group(grp)

        # PHASE 1B: Group by shared CP document number
        cp_groups: dict[tuple[str, str], list[int]] = {}
        for idx in list(unmatched_indices):
            g = eff_gstin_lst[idx]
            c_d = cp_doc_lst[idx]
            if g and g not in ("NAN", "NONE") and c_d and c_d not in ("NAN", "NONE"):
                cp_groups.setdefault((g, c_d), []).append(idx)
        for grp in cp_groups.values():
            _try_match_group(grp)

        # PHASE 1C: Group by normalized clean doc numbers
        clean_groups: dict[tuple[str, str], list[int]] = {}
        for idx in list(unmatched_indices):
            g = eff_gstin_lst[idx]
            c_doc = cp_clean_lst[idx] if cp_clean_lst[idx] not in ("", "NAN", "NONE") else pr_clean_lst[idx]
            if g and g not in ("NAN", "NONE") and c_doc and c_doc not in ("NAN", "NONE"):
                clean_groups.setdefault((g, c_doc), []).append(idx)
        for grp in clean_groups.values():
            _try_match_group(grp)

        # PHASE 2: General Disjoint Subset-Sum across Vendor Partitions
        gstin_partitions: dict[str, list[int]] = {}
        for idx in list(unmatched_indices):
            g = eff_gstin_lst[idx]
            if g and g not in ("NAN", "NONE"):
                gstin_partitions.setdefault(g, []).append(idx)

        for g, rows_in_gstin in gstin_partitions.items():
            if len(rows_in_gstin) < 2:
                continue
            active_rows = [k for k in rows_in_gstin if k in unmatched_indices]
            if len(active_rows) < 2:
                continue

            # 2A: Check N:1
            pr_targets = [k for k in active_rows if float(pr_taxable_arr[k]) > 0.0 and float(cp_taxable_arr[k]) == 0.0]
            cp_candidates = [k for k in active_rows if float(cp_taxable_arr[k]) > 0.0 and float(pr_taxable_arr[k]) == 0.0]
            for pr_idx in pr_targets:
                if pr_idx not in unmatched_indices:
                    continue
                t_val = float(pr_taxable_arr[pr_idx])
                valid_cps = [
                    (c_idx, float(cp_taxable_arr[c_idx]))
                    for c_idx in cp_candidates
                    if c_idx in unmatched_indices and c_idx != pr_idx and _dates_within_window(c_idx, pr_idx)
                ]
                res = self._find_subset_sum_indices(valid_cps, t_val, tolerance)
                if res is not None:
                    matched_cp_indices, batch_sum = res
                    var = round(abs(batch_sum - t_val), 2)
                    all_batch = [pr_idx] + matched_cp_indices
                    target_doc = str(pr_doc_lst[pr_idx]) or f"Voucher-{pr_idx+1}"
                    cp_tax_sum = round(sum(float(cp_igst_arr[x]) for x in matched_cp_indices), 2)
                    pr_tax_val = float(pr_igst_arr[pr_idx])

                    master_idx = pr_idx
                    absorbed_indices.update(matched_cp_indices)

                    components = []
                    for c_idx in matched_cp_indices:
                        c_taxable = float(cp_taxable_arr[c_idx])
                        c_tax = float(cp_igst_arr[c_idx])
                        share = round((c_taxable / batch_sum * 100.0), 1) if batch_sum > 0 else 0.0
                        components.append({
                            "row_index": int(c_idx),
                            "row_number": int(c_idx) + 1,
                            "doc_type": "GSTR",
                            "document_number": str(cp_doc_lst[c_idx]),
                            "document_date": str(cp_date_lst[c_idx]),
                            "taxable_value": round(c_taxable, 2),
                            "tax_amount": round(c_tax, 2),
                            "total_value": round(c_taxable + c_tax, 2),
                            "gstin": str(cp_gstin_lst[c_idx]),
                            "share_percentage": float(share),
                        })

                    for k in all_batch:
                        if k in unmatched_indices:
                            unmatched_indices.remove(k)

                    consolidation_mask.iloc[master_idx] = True
                    for c_idx in matched_cp_indices:
                        consolidation_mask.iloc[c_idx] = True
                        consolidation_meta[c_idx] = {
                            "is_master": False,
                            "master_index": master_idx,
                            "mode": "N:1",
                            "target_doc": target_doc,
                            "target_amount": t_val,
                        }
                    comp_docs = [str(c["document_number"]) for c in components]
                    doc_summary = f"{len(components)} Invoices: {', '.join(comp_docs[:2])}{'...' if len(components) > 2 else ''}"

                    consolidation_meta[master_idx] = {
                        "is_master": True,
                        "mode": "N:1",
                        "batch_count": len(components),
                        "batch_sum": batch_sum,
                        "target_amount": t_val,
                        "target_doc": target_doc,
                        "variance": var,
                        "tax_variance": round(abs(cp_tax_sum - pr_tax_val), 2),
                        "component_docs": comp_docs,
                        "components": components,
                        "source_taxable": batch_sum,
                        "source_tax": cp_tax_sum,
                        "target_taxable": t_val,
                        "target_tax": pr_tax_val,
                        "source_doc_num": doc_summary,
                        "target_doc_num": target_doc,
                        "source_date": str(cp_date_lst[matched_cp_indices[0]]) if matched_cp_indices else "",
                        "target_date": str(pr_date_lst[pr_idx]),
                        "source_gstin": str(eff_gstin_lst[pr_idx]),
                        "target_gstin": str(pr_gstin_lst[pr_idx]),
                    }

            # 2B: Check 1:N
            active_rows = [k for k in rows_in_gstin if k in unmatched_indices]
            cp_targets = [k for k in active_rows if float(cp_taxable_arr[k]) > 0.0 and float(pr_taxable_arr[k]) == 0.0]
            pr_candidates = [k for k in active_rows if float(pr_taxable_arr[k]) > 0.0 and float(cp_taxable_arr[k]) == 0.0]
            for cp_idx in cp_targets:
                if cp_idx not in unmatched_indices:
                    continue
                t_val = float(cp_taxable_arr[cp_idx])
                valid_prs = [
                    (p_idx, float(pr_taxable_arr[p_idx]))
                    for p_idx in pr_candidates
                    if p_idx in unmatched_indices and p_idx != cp_idx and _dates_within_window(p_idx, cp_idx)
                ]
                res = self._find_subset_sum_indices(valid_prs, t_val, tolerance)
                if res is not None:
                    matched_pr_indices, batch_sum = res
                    var = round(abs(batch_sum - t_val), 2)
                    all_batch = [cp_idx] + matched_pr_indices
                    target_doc = str(cp_doc_lst[cp_idx]) or f"Invoice-{cp_idx+1}"
                    pr_tax_sum = round(sum(float(pr_igst_arr[x]) for x in matched_pr_indices), 2)
                    cp_tax_val = float(cp_igst_arr[cp_idx])

                    master_idx = cp_idx
                    absorbed_indices.update(matched_pr_indices)

                    components = []
                    for p_idx in matched_pr_indices:
                        p_taxable = float(pr_taxable_arr[p_idx])
                        p_tax = float(pr_igst_arr[p_idx])
                        share = round((p_taxable / batch_sum * 100.0), 1) if batch_sum > 0 else 0.0
                        components.append({
                            "row_index": int(p_idx),
                            "row_number": int(p_idx) + 1,
                            "doc_type": "PR",
                            "document_number": str(pr_doc_lst[p_idx]),
                            "document_date": str(pr_date_lst[p_idx]),
                            "taxable_value": round(p_taxable, 2),
                            "tax_amount": round(p_tax, 2),
                            "total_value": round(p_taxable + p_tax, 2),
                            "gstin": str(pr_gstin_lst[p_idx]),
                            "share_percentage": float(share),
                        })

                    for k in all_batch:
                        if k in unmatched_indices:
                            unmatched_indices.remove(k)

                    consolidation_mask.iloc[master_idx] = True
                    for p_idx in matched_pr_indices:
                        consolidation_mask.iloc[p_idx] = True
                        consolidation_meta[p_idx] = {
                            "is_master": False,
                            "master_index": master_idx,
                            "mode": "1:N",
                            "target_doc": target_doc,
                            "target_amount": t_val,
                        }
                    comp_docs = [str(c["document_number"]) for c in components]
                    doc_summary = f"{len(components)} Vouchers: {', '.join(comp_docs[:2])}{'...' if len(components) > 2 else ''}"

                    consolidation_meta[master_idx] = {
                        "is_master": True,
                        "mode": "1:N",
                        "batch_count": len(components),
                        "batch_sum": batch_sum,
                        "target_amount": t_val,
                        "target_doc": target_doc,
                        "variance": var,
                        "tax_variance": round(abs(pr_tax_sum - cp_tax_val), 2),
                        "component_docs": comp_docs,
                        "components": components,
                        "source_taxable": t_val,
                        "source_tax": cp_tax_val,
                        "target_taxable": batch_sum,
                        "target_tax": pr_tax_sum,
                        "source_doc_num": target_doc,
                        "target_doc_num": doc_summary,
                        "source_date": str(cp_date_lst[cp_idx]),
                        "target_date": str(pr_date_lst[matched_pr_indices[0]]) if matched_pr_indices else "",
                        "source_gstin": str(cp_gstin_lst[cp_idx]),
                        "target_gstin": str(eff_gstin_lst[cp_idx]),
                    }

        # PHASE 3: Keyword Heuristic Fallback (Preserving Existing Rule 1 Test Heuristic)
        for idx in list(unmatched_indices):
            if is_bank_voucher.iloc[idx] and gstin_match.iloc[idx] and date_proximate.iloc[idx]:
                consolidation_mask.iloc[idx] = True
                unmatched_indices.remove(idx)
                consolidation_meta[idx] = {
                    "is_master": True,
                    "mode": "BANKING_HEURISTIC",
                    "batch_count": 1,
                    "batch_sum": float(cp_taxable_arr[idx]),
                    "target_amount": float(pr_taxable_arr[idx]),
                    "target_doc": str(pr_doc_lst[idx]),
                    "variance": round(abs(float(cp_taxable_arr[idx]) - float(pr_taxable_arr[idx])), 2),
                    "tax_variance": round(abs(float(cp_igst_arr[idx]) - float(pr_igst_arr[idx])), 2),
                    "component_docs": [str(cp_doc_lst[idx])],
                    "components": [],
                }

        return consolidation_mask, consolidation_meta, absorbed_indices

    def execute_waterfall(
        self,
        df: pd.DataFrame,
        session_id: str = "v4_session",
        rules: list[Rule4Item] | None = None,
        mapped_pairs: dict[str, str] | None = None,
        kics_status_col: str | None = "ReconciliationSection",
        **kwargs: Any,
    ) -> Stage4ExecutionResponseV4:
        if rules is not None:
            self.rules = rules

        mapped_pairs = mapped_pairs or {}
        kics_status_col = kics_status_col or "ReconciliationSection"
        start_time = time.time()
        n_rows = len(df)

        if n_rows == 0:
            summary = Stage4ResultsSummaryV4(
                total_records=0, exact_matches=0, tolerance_matches=0, near_matches=0,
                ineligible_itc_matches=0, consolidated_matches=0, gst_only=0, pr_only=0,
                ambiguous=0, kics_concurrence_count=0, kics_concurrence_rate=100.0,
                disparities_caught=0, net_taxable_variance=0.0, net_tax_variance=0.0,
                total_gov_taxable=0.0, total_pr_taxable=0.0, accuracy_percentage=100.0,
            )
            return Stage4ExecutionResponseV4(
                session_id=session_id, executed_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),
                duration_ms=0.0, summary=summary, records=[], kics_status_column=kics_status_col or "",
            )

        # 1. Resolve columns
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

        # 2. Extract series
        cp_gstin = df[cp_gstin_col].astype(str).str.strip().str.upper() if cp_gstin_col else pd.Series([""] * n_rows)
        pr_gstin = df[pr_gstin_col].astype(str).str.strip().str.upper() if pr_gstin_col else pd.Series([""] * n_rows)

        cp_doc = df[cp_doc_col].astype(str).str.strip().str.upper() if cp_doc_col else pd.Series([""] * n_rows)
        pr_doc = df[pr_doc_col].astype(str).str.strip().str.upper() if pr_doc_col else pd.Series([""] * n_rows)

        # Normalize doc numbers: strip non-alphanumeric, multi-part prefixes (INV, 2026, FY26), and leading zeros
        prefix_pattern = r"^((INV|BILL|TAX|GST|REF|DN|CN|PO|VCH|\d{4}|FY\d{2})[/_ \-:]*)+"
        cp_doc_clean = cp_doc.str.replace(prefix_pattern, "", regex=True).str.replace(r"[^A-Z0-9]", "", regex=True).str.lstrip("0")
        pr_doc_clean = pr_doc.str.replace(prefix_pattern, "", regex=True).str.replace(r"[^A-Z0-9]", "", regex=True).str.lstrip("0")

        # Fallback if entirely stripped
        cp_doc_clean = cp_doc_clean.where(cp_doc_clean != "", cp_doc)
        pr_doc_clean = pr_doc_clean.where(pr_doc_clean != "", pr_doc)

        # Dates extraction and parsing
        cp_date_str = df[cp_date_col].astype(str).str.strip() if cp_date_col else pd.Series([""] * n_rows)
        pr_date_str = df[pr_date_col].astype(str).str.strip() if pr_date_col else pd.Series([""] * n_rows)

        cp_dates = pd.to_datetime(cp_date_str, errors="coerce", dayfirst=True)
        pr_dates = pd.to_datetime(pr_date_str, errors="coerce", dayfirst=True)
        date_diff_days = (cp_dates - pr_dates).abs().dt.days.fillna(999.0)

        # Detect cross-FY: March (month 3) vs April (month 4) of sequential years
        cross_fy_mask = (
            ((cp_dates.dt.month == 3) & (pr_dates.dt.month == 4) & (pr_dates.dt.year == cp_dates.dt.year)) |
            ((pr_dates.dt.month == 3) & (cp_dates.dt.month == 4) & (cp_dates.dt.year == pr_dates.dt.year))
        ) & (date_diff_days <= 60)

        # Financial values
        cp_taxable = pd.to_numeric(df[cp_taxable_col], errors="coerce").fillna(0.0) if cp_taxable_col else pd.Series([0.0] * n_rows)
        pr_taxable = pd.to_numeric(df[pr_taxable_col], errors="coerce").fillna(0.0) if pr_taxable_col else pd.Series([0.0] * n_rows)
        taxable_diff = (cp_taxable - pr_taxable).abs()

        cp_igst = pd.to_numeric(df[cp_igst_col], errors="coerce").fillna(0.0) if cp_igst_col else pd.Series([0.0] * n_rows)
        pr_igst = pd.to_numeric(df[pr_igst_col], errors="coerce").fillna(0.0) if pr_igst_col else pd.Series([0.0] * n_rows)
        igst_diff = (cp_igst - pr_igst).abs()

        kics_series = df[kics_col].astype(str).str.strip() if kics_col else pd.Series(["Exact Match"] * n_rows)

        # Single-sided / blank checks
        cp_blank = cp_gstin.isin(["", "NAN", "NONE"]) & cp_doc.isin(["", "NAN", "NONE"])
        pr_blank = pr_gstin.isin(["", "NAN", "NONE"]) & pr_doc.isin(["", "NAN", "NONE"])

        is_pr_only = cp_blank & (~pr_blank)
        is_gst_only = (~cp_blank) & pr_blank
        both_present = (~cp_blank) & (~pr_blank)

        gstin_match = both_present & (cp_gstin == pr_gstin)
        doc_exact_match = both_present & (cp_doc == pr_doc)

        # Suffix matching for dropped prefixes (e.g. 00123 matching INV/2026/00123)
        raw_cp_alphanum = cp_doc.str.replace(r"[^A-Z0-9]", "", regex=True)
        raw_pr_alphanum = pr_doc.str.replace(r"[^A-Z0-9]", "", regex=True)
        def _check_suffix(s1: str, s2: str) -> bool:
            if not s1 or not s2 or len(s1) < 3 or len(s2) < 3:
                return False
            return s1.endswith(s2) or s2.endswith(s1)

        suffix_match = pd.Series(
            [_check_suffix(c, p) for c, p in zip(raw_cp_alphanum, raw_pr_alphanum)],
            index=df.index
        )
        doc_clean_match = both_present & (
            (cp_doc_clean == pr_doc_clean) |
            (raw_cp_alphanum == raw_pr_alphanum) |
            suffix_match
        )

        date_exact = both_present & (cp_date_str == pr_date_str)
        date_proximate = both_present & (date_diff_days <= 30.0)

        taxable_exact = taxable_diff < 0.01
        taxable_penny_tol = (taxable_diff >= 0.01) & (taxable_diff <= 10.0)
        igst_exact = igst_diff < 0.01
        igst_penny_tol = (igst_diff >= 0.01) & (igst_diff <= 10.0)

        # =========================================================================
        # 5-TIER SUPERCHARGED WATERFALL (OPTION B)
        # =========================================================================

        # TIER 1: Exact Match (Zero Variance)
        tier1_exact = gstin_match & doc_exact_match & (date_exact | (date_diff_days == 0)) & taxable_exact & igst_exact

        # TIER 2: Commercial Tolerance Match (Requires exact document number with date/FY/penny variances)
        rule3_date_drift = gstin_match & doc_exact_match & date_proximate & (date_diff_days > 0) & (taxable_exact | taxable_penny_tol) & (igst_exact | igst_penny_tol)
        rule4_cross_fy = gstin_match & doc_exact_match & cross_fy_mask & (taxable_exact | taxable_penny_tol) & (igst_exact | igst_penny_tol)
        tier2_tolerance = (~tier1_exact) & doc_exact_match & (
            rule3_date_drift | rule4_cross_fy | taxable_penny_tol | igst_penny_tol
        )

        # TIER 3: Normalized Near Match (Rule 5 Prefix & Rule 6 Compound)
        rule5_prefix = gstin_match & doc_clean_match & (~doc_exact_match) & (taxable_exact | taxable_penny_tol) & (date_diff_days <= 1.0)
        rule6_compound = gstin_match & doc_clean_match & (~doc_exact_match) & (date_diff_days > 1.0) & (date_diff_days <= 30.0) & (taxable_exact | taxable_penny_tol)
        tier3_near = (~tier1_exact) & (~tier2_tolerance) & (
            rule5_prefix | rule6_compound |
            (gstin_match & doc_clean_match & (taxable_diff <= 50.0))
        )

        # TIER 4: Statutory & Consolidated Discrepancies (Client Rule 1 Banking & Client Rule 2 Ineligible ITC)
        # Rule 1: Multi-tranche / Banking batch consolidation (N:1 and 1:N subset aggregation)
        rule1_obj = next((r for r in self.rules if r.id == "R4-08" or r.match_strategy == "MULTI_TRANCHE" or "banking" in r.name.lower()), None)
        rule1_tolerance = float(rule1_obj.tolerance_value) if (rule1_obj and rule1_obj.tolerance_value is not None) else 5.0
        rule1_window_days = int(rule1_obj.custom_date_range_days) if (rule1_obj and rule1_obj.custom_date_range_days is not None) else 31

        is_bank_voucher = pr_doc.str.contains(r"BANK|CHG|CONSOL|VOUCHER|JV", regex=True, na=False) | pr_doc_clean.str.contains(r"BANK", regex=True, na=False)
        unmatched_mask_for_batch = (~tier1_exact) & (~tier2_tolerance) & (~tier3_near)
        rule1_banking, consolidation_meta, absorbed_indices = self._detect_batch_consolidations(
            n_rows=n_rows,
            unmatched_mask=unmatched_mask_for_batch,
            cp_gstin=cp_gstin,
            pr_gstin=pr_gstin,
            cp_doc=cp_doc,
            pr_doc=pr_doc,
            cp_doc_clean=cp_doc_clean,
            pr_doc_clean=pr_doc_clean,
            cp_dates=cp_dates,
            pr_dates=pr_dates,
            cp_taxable=cp_taxable,
            pr_taxable=pr_taxable,
            cp_igst=cp_igst,
            pr_igst=pr_igst,
            is_bank_voucher=is_bank_voucher,
            gstin_match=gstin_match,
            date_proximate=date_proximate,
            tolerance=rule1_tolerance,
            window_days=rule1_window_days,
        )

        # Rule 2: Ineligible ITC u/s 17(5) (GSTIN, Doc No, Date match; Books Taxable < Portal Taxable by >= ₹100 threshold; not part of multi-tranche batch)
        rule2_ineligible_itc = (
            (~tier1_exact) & (~tier2_tolerance) & (~tier3_near) & (~rule1_banking) &
            gstin_match & (doc_exact_match | doc_clean_match) &
            (date_exact | (date_diff_days <= 15.0)) &
            (pr_taxable < cp_taxable) & ((cp_taxable - pr_taxable) >= 100.0)
        )

        # Update taxable_diff and igst_diff for consolidated batch records to net batch variance
        if consolidation_meta:
            taxable_diff = taxable_diff.copy()
            igst_diff = igst_diff.copy()
            for b_idx, b_m in consolidation_meta.items():
                if b_m.get("is_master"):
                    taxable_diff.iloc[b_idx] = float(b_m.get("variance", 0.0))
                    igst_diff.iloc[b_idx] = float(b_m.get("tax_variance", 0.0))
                else:
                    taxable_diff.iloc[b_idx] = 0.0
                    igst_diff.iloc[b_idx] = 0.0

        # TIER 5: Residuals & Ambiguities
        # Ensure batch consolidations take precedence over single-sided residual classification
        is_pr_only_final = is_pr_only & (~rule1_banking)
        is_gst_only_final = is_gst_only & (~rule1_banking)
        tier5_ambiguous = both_present & (~tier1_exact) & (~tier2_tolerance) & (~tier3_near) & (~rule1_banking) & (~rule2_ineligible_itc)

        # Form TARS verdicts
        conditions = [
            tier1_exact,
            rule1_banking,
            rule2_ineligible_itc,
            tier2_tolerance,
            tier3_near,
            is_pr_only_final,
            is_gst_only_final,
            tier5_ambiguous,
        ]
        choices = [
            "Exact Match",
            "Consolidated Match",
            "Ineligible ITC [Sec 17(5)]",
            "Tolerance Match",
            "Near Match",
            "PR Only",
            "GST Only",
            "Ambiguous",
        ]
        tars_verdicts = np.select(conditions, choices, default="Ambiguous")

        sub_classes = np.select(
            [
                tier1_exact,
                rule1_banking,
                rule2_ineligible_itc,
                rule4_cross_fy,
                rule3_date_drift,
                rule5_prefix,
                rule6_compound,
                tier2_tolerance,
                tier3_near,
                is_pr_only_final,
                is_gst_only_final,
            ],
            [
                "EXACT_ZERO_VARIANCE",
                "BANKING_MULTI_TRANCHE",
                "INELIGIBLE_ITC_17_5",
                "CROSS_FY_TIMING",
                "DATE_OPERATIONAL_SHIFT",
                "DOC_PREFIX_NORMALIZED",
                "COMPOUND_DOC_DATE_VARIATION",
                "COMMERCIAL_TOLERANCE",
                "NEAR_MATCH",
                "PR_ONLY",
                "GST_ONLY",
            ],
            default="AMBIGUOUS_COLLISION",
        )

        pass_tiers = np.select(
            [
                tier1_exact,
                tier2_tolerance,
                tier3_near,
                rule2_ineligible_itc | rule1_banking,
                is_pr_only_final | is_gst_only_final,
            ],
            [
                "Tier 1: Exact Match (Zero Variance)",
                "Tier 2: Commercial Tolerance & Cross-FY",
                "Tier 3: Normalized & Compound Matches",
                "Tier 4: Statutory Discrepancies & Batches",
                "Tier 5: Single-Sided Residuals",
            ],
            default="Tier 5: Ambiguity Quarantines",
        )

        # Concurrence against KICS
        kics_clean = kics_series.values
        concurrence_arr = np.where(
            (tars_verdicts == kics_clean) | (
                (tars_verdicts == "Exact Match") & np.isin(kics_clean, ["Exact Match", "Exact", "EXACT"])
            ) | (
                (tars_verdicts == "Tolerance Match") & np.isin(kics_clean, ["Tolerance Match", "Tolerance", "TOLERANCE"])
            ) | (
                (tars_verdicts == "Near Match") & np.isin(kics_clean, ["Near Match", "Near", "NEAR"])
            ) | (
                np.isin(tars_verdicts, ["Ineligible ITC [Sec 17(5)]", "Consolidated Match"]) & np.isin(kics_clean, ["Exact Match", "Tolerance Match", "Near Match", "Matched", "MATCHED"])
            ),
            "AGREEMENT",
            "DISPARITY",
        )

        # Convert Series/Arrays to native Python lists for ultra-fast vectorized iteration across all records
        cp_gstin_lst = cp_gstin.astype(str).tolist()
        pr_gstin_lst = pr_gstin.astype(str).tolist()
        cp_doc_lst = cp_doc.astype(str).tolist()
        pr_doc_lst = pr_doc.astype(str).tolist()
        cp_date_lst = cp_date_str.astype(str).tolist()
        pr_date_lst = pr_date_str.astype(str).tolist()
        cp_taxable_lst = cp_taxable.tolist()
        pr_taxable_lst = pr_taxable.tolist()
        cp_igst_lst = cp_igst.tolist()
        pr_igst_lst = pr_igst.tolist()
        taxable_diff_lst = taxable_diff.tolist()
        igst_diff_lst = igst_diff.tolist()
        tars_verdicts_lst = [str(x) for x in tars_verdicts]
        kics_clean_lst = [str(x) for x in kics_clean]
        concurrence_lst = [str(x) for x in concurrence_arr]
        sub_classes_lst = [str(x) for x in sub_classes]
        pass_tiers_lst = [str(x) for x in pass_tiers]
        date_diff_lst = date_diff_days.tolist() if hasattr(date_diff_days, "tolist") else list(date_diff_days)

        # Build records preview with comprehensive statutory comments across ALL records
        records: list[ReconciliationRecordItemV4] = []
        for i in range(n_rows):
            if i in consolidation_meta and consolidation_meta[i].get("is_master") and consolidation_meta[i].get("mode") in ("1:N", "N:1"):
                b_meta = consolidation_meta[i]
                mode = b_meta["mode"]
                tv = "Consolidated Match"
                sub_c = "BANKING_MULTI_TRANCHE"
                bucket_val = "TOLERANCE_MATCH"
                p_tier = "Tier 4: Statutory Discrepancies & Batches"

                s_taxable = float(b_meta.get("source_taxable", cp_taxable_lst[i]))
                tg_taxable = float(b_meta.get("target_taxable", pr_taxable_lst[i]))
                s_tax = float(b_meta.get("source_tax", cp_igst_lst[i]))
                tg_tax = float(b_meta.get("target_tax", pr_igst_lst[i]))
                s_doc = str(b_meta.get("source_doc_num", cp_doc_lst[i]))
                tg_doc = str(b_meta.get("target_doc_num", pr_doc_lst[i]))
                s_date = str(b_meta.get("source_date", cp_date_lst[i]))
                tg_date = str(b_meta.get("target_date", pr_date_lst[i]))
                s_gstin = str(b_meta.get("source_gstin", cp_gstin_lst[i]))
                tg_gstin = str(b_meta.get("target_gstin", pr_gstin_lst[i]))
                t_diff = float(b_meta.get("variance", 0.0))
                tx_diff = float(b_meta.get("tax_variance", 0.0))
                b_components = b_meta.get("components", [])

                c_gstin = s_gstin if s_gstin and s_gstin not in ("NAN", "NONE") else tg_gstin
                c_doc = s_doc if mode == "1:N" else tg_doc
                c_date = s_date if mode == "1:N" else tg_date
                c_taxable = s_taxable if mode == "1:N" else tg_taxable
                c_tax = s_tax if mode == "1:N" else tg_tax
                c_total = round(c_taxable + c_tax, 2)

                if mode == "N:1":
                    client_comment = (
                        f"Consolidated Batch Match (N:1): {b_meta['batch_count']} Portal invoices totaling "
                        f"₹{b_meta['batch_sum']:,.2f} aggregate to Books Voucher '{b_meta['target_doc']}' "
                        f"(₹{b_meta['target_amount']:,.2f}) with net variance ₹{b_meta['variance']:.2f}."
                    )
                    ai_audit_reason = (
                        f"Rule 1 Batch Consolidation: Symmetrical GSTIN and temporal window validated. "
                        f"Verified N:1 subset aggregation across {b_meta['batch_count']} supplier invoices."
                    )
                else:
                    client_comment = (
                        f"Consolidated Batch Match (1:N): {b_meta['batch_count']} Books vouchers totaling "
                        f"₹{b_meta['batch_sum']:,.2f} aggregate to Portal Invoice '{b_meta['target_doc']}' "
                        f"(₹{b_meta['target_amount']:,.2f}) with net variance ₹{b_meta['variance']:.2f}."
                    )
                    ai_audit_reason = (
                        f"Rule 1 Batch Consolidation: Symmetrical GSTIN and temporal window validated. "
                        f"Verified 1:N subset aggregation across {b_meta['batch_count']} ERP vouchers."
                    )
                conc = "AGREEMENT"
                disp_reason = None
            elif i in absorbed_indices:
                c_meta = consolidation_meta.get(i, {})
                mode = c_meta.get("mode", "Batch")
                master_idx = c_meta.get("master_index", i)
                t_doc = c_meta.get("target_doc", "")
                t_amt = c_meta.get("target_amount", 0.0)

                tv = "Consolidated Match"
                sub_c = "BANKING_MULTI_TRANCHE"
                bucket_val = "TOLERANCE_MATCH"
                p_tier = "Tier 4: Statutory Discrepancies & Batches"

                s_taxable = float(cp_taxable_lst[i])
                tg_taxable = float(pr_taxable_lst[i])
                s_tax = float(cp_igst_lst[i])
                tg_tax = float(pr_igst_lst[i])
                s_doc = cp_doc_lst[i]
                tg_doc = pr_doc_lst[i]
                s_date = cp_date_lst[i]
                tg_date = pr_date_lst[i]
                s_gstin = cp_gstin_lst[i]
                tg_gstin = pr_gstin_lst[i]
                t_diff = 0.0
                tx_diff = 0.0
                b_components = []

                c_gstin = cp_gstin_lst[i] if cp_gstin_lst[i] not in ("", "NAN", "NONE") else pr_gstin_lst[i]
                c_doc = cp_doc_lst[i] if cp_doc_lst[i] not in ("", "NAN", "NONE") else pr_doc_lst[i]
                c_date = cp_date_lst[i] if cp_date_lst[i] not in ("", "NAN", "NONE") else pr_date_lst[i]
                c_taxable = float(cp_taxable_lst[i]) if float(cp_taxable_lst[i]) != 0.0 else float(pr_taxable_lst[i])
                c_tax = float(cp_igst_lst[i]) if float(cp_igst_lst[i]) != 0.0 else float(pr_igst_lst[i])
                c_total = round(c_taxable + c_tax, 2)

                client_comment = (
                    f"Consolidated Batch Item ({mode}): Constituent line item linked to master batch voucher "
                    f"'{t_doc}' (₹{t_amt:,.2f})."
                )
                ai_audit_reason = (
                    f"Rule 1 Batch Constituent: Verified line item belonging to consolidated {mode} tranche "
                    f"aggregated at master row REC-V4-{master_idx+1:06d}."
                )
                conc = "AGREEMENT"
                disp_reason = None
            else:
                tv = tars_verdicts_lst[i]
                bucket_val = (
                    "EXACT_MATCH" if tv == "Exact Match"
                    else "TOLERANCE_MATCH" if tv in ("Tolerance Match", "Ineligible ITC [Sec 17(5)]", "Consolidated Match")
                    else "NEAR_MATCH" if tv == "Near Match"
                    else "PR_ONLY" if tv == "PR Only"
                    else "GSTR_ONLY" if tv == "GST Only"
                    else "AMBIGUOUS"
                )
                s_taxable = float(cp_taxable_lst[i])
                tg_taxable = float(pr_taxable_lst[i])
                s_tax = float(cp_igst_lst[i])
                tg_tax = float(pr_igst_lst[i])
                s_doc = cp_doc_lst[i]
                tg_doc = pr_doc_lst[i]
                s_date = cp_date_lst[i]
                tg_date = pr_date_lst[i]
                s_gstin = cp_gstin_lst[i]
                tg_gstin = pr_gstin_lst[i]
                t_diff = float(consolidation_meta[i].get("variance", taxable_diff_lst[i])) if i in consolidation_meta else float(taxable_diff_lst[i])
                tx_diff = float(consolidation_meta[i].get("tax_variance", igst_diff_lst[i])) if i in consolidation_meta else float(igst_diff_lst[i])
                b_components = []

                c_gstin = cp_gstin_lst[i] if cp_gstin_lst[i] != "" else pr_gstin_lst[i]
                c_doc = cp_doc_lst[i] if cp_doc_lst[i] != "" else pr_doc_lst[i]
                c_date = cp_date_lst[i] if cp_date_lst[i] != "" else pr_date_lst[i]
                c_taxable = float(cp_taxable_lst[i]) if float(cp_taxable_lst[i]) != 0.0 else float(pr_taxable_lst[i])
                c_tax = float(cp_igst_lst[i]) if float(cp_igst_lst[i]) != 0.0 else float(pr_igst_lst[i])
                c_total = round(c_taxable + c_tax, 2)

                sub_c = sub_classes_lst[i]
                if sub_c == "BANKING_MULTI_TRANCHE":
                    client_comment = "Consolidated Multi-Tranche Entry: Multiple supplier invoices consolidated into single PR voucher within rolling window (e.g. Bank charges / vendor tranche)"
                    ai_audit_reason = "Rule 1 Match: Client books consolidate multiple monthly supplier/bank debits into a single accounting JV. Symmetrical GSTIN and temporal window validated."
                elif sub_c == "INELIGIBLE_ITC_17_5":
                    diff_ineligible = round(float(cp_taxable_lst[i]) - float(pr_taxable_lst[i]), 2)
                    client_comment = f"Section 17(5) Ineligible ITC / Rejected Goods: Full invoice reported in GSTR-2B; only eligible portion booked in PR (₹{diff_ineligible:,.2f} ineligible/blocked credit u/s 17(5) not booked in books)"
                    ai_audit_reason = f"Rule 2 Statutory Discrepancy: Statutory blocked credit under Section 17(5) (e.g., motor vehicle / food / rent-a-cab). Value variance of ₹{diff_ineligible:,.2f} verified."
                elif sub_c == "CROSS_FY_TIMING":
                    client_comment = "Cross-Financial Year Boundary Timing Difference: Invoice dated in previous FY (March 31) and booked/received in subsequent FY (April 2)"
                    ai_audit_reason = "Rule 4 Timing Match: Symmetrical GSTIN, invoice number, and values confirmed across March-April financial year rollover."
                elif sub_c == "DATE_OPERATIONAL_SHIFT":
                    drift_days = int(date_diff_lst[i]) if i < len(date_diff_lst) else 5
                    client_comment = f"Document Date Proximity: Document booked {drift_days} days later due to operational dispatch delay (within allowable ±30-day window)"
                    ai_audit_reason = f"Rule 3 Operational Shift: Legitimate supplier transit delay ({drift_days} days drift). Invoice numbers and financial values match exactly."
                elif sub_c == "DOC_PREFIX_NORMALIZED":
                    client_comment = f"Document Number Normalization: Invoice prefix/formatting dropped during manual booking ('{cp_doc_lst[i]}' in Portal vs '{pr_doc_lst[i]}' in Books)"
                    ai_audit_reason = "Rule 5 Text Normalization: Punctuation/prefix stripping resolved typographical difference without altering financial invoice identity."
                elif sub_c == "COMPOUND_DOC_DATE_VARIATION":
                    drift_days = int(date_diff_lst[i]) if i < len(date_diff_lst) else 5
                    client_comment = f"Compound Variation Match: Simultaneous prefix formatting variation ('{cp_doc_lst[i]}' vs '{pr_doc_lst[i]}') and {drift_days}-day document date delay"
                    ai_audit_reason = "Rule 6 Compound Variation: Multi-parameter operational discrepancy resolved via joint fuzzy normalization and rolling date tolerance."
                elif sub_c == "EXACT_ZERO_VARIANCE":
                    client_comment = "Exact Statutory Identity: Zero variance across GSTIN, Invoice Number, Date, and ITC Financials"
                    ai_audit_reason = "Rule 0 Statutory Direct Match: Strict Section 16(2)(aa) compliance verified."
                elif sub_c == "PR_ONLY":
                    client_comment = "Internal Books Voucher Only (Unmatched in Portal): Missing in GSTR-2B; DRC-01C compliance notice risk if claimed without vendor filing"
                    ai_audit_reason = "Residual Single-Sided: Voucher exists in Client PR but supplier has not yet uploaded or filed GSTR-1."
                elif sub_c == "GST_ONLY":
                    client_comment = "Portal Credit Available (Unrecorded in Books): Supplier filed in GSTR-1/2B but voucher missing or not entered in Purchase Register"
                    ai_audit_reason = "Residual Single-Sided: Unclaimed credit opportunity. Ensure invoice receipt before statutory cutoff."
                else:
                    client_comment = f"Ambiguity / Tolerance Collision: Quarantined for review ({tv})"
                    ai_audit_reason = "Multi-candidate collision or tolerance boundary case requiring accountant verification."

                conc = concurrence_lst[i]
                disp_reason = None if conc == "AGREEMENT" else f"TARS classified '{tv}' vs KICS '{kics_clean_lst[i]}'"
                p_tier = pass_tiers_lst[i]

            records.append(
                ReconciliationRecordItemV4(
                    id=f"REC-V4-{i+1:06d}",
                    index=i,
                    tars_verdict=tv,
                    kics_verdict=kics_clean_lst[i],
                    concurrence=conc,
                    disparity_reason=disp_reason,
                    source_gstin=s_gstin,
                    target_gstin=tg_gstin,
                    source_doc_num=s_doc,
                    target_doc_num=tg_doc,
                    source_date=s_date,
                    target_date=tg_date,
                    source_taxable=s_taxable,
                    target_taxable=tg_taxable,
                    source_tax=s_tax,
                    target_tax=tg_tax,
                    taxable_diff=t_diff,
                    tax_diff=tx_diff,
                    pass_tier=p_tier,
                    sub_classification=sub_c,
                    bucket=bucket_val,
                    classification_reason=client_comment,
                    ai_reason=ai_audit_reason,
                    # Compatibility fields
                    gstr_row_index=i,
                    pr_row_index=i,
                    gstin=c_gstin,
                    document_number=c_doc,
                    document_date=c_date,
                    taxable_value=c_taxable,
                    tax_amount=c_tax,
                    total_value=c_total,
                    gstr_preview={
                        "gstin": s_gstin,
                        "document_number": s_doc,
                        "invoice_number": s_doc,
                        "document_date": s_date,
                        "invoice_date": s_date,
                        "taxable_value": s_taxable,
                        "tax_amount": s_tax,
                        "igst": s_tax,
                        "total_value": round(s_taxable + s_tax, 2),
                        "GSTIN": s_gstin,
                        "Invoice": s_doc,
                        "Date": s_date,
                        "Taxable": s_taxable,
                        "Tax": s_tax,
                        "Remarks": client_comment,
                        **(
                            {
                                "batch_consolidation_type": consolidation_meta[i]["mode"],
                                "batch_sum": consolidation_meta[i]["batch_sum"],
                                "target_amount": consolidation_meta[i]["target_amount"],
                            }
                            if i in consolidation_meta and consolidation_meta[i].get("is_master") and consolidation_meta[i].get("mode") in ("N:1", "1:N")
                            else {}
                        ),
                    },
                    pr_preview={
                        "gstin": tg_gstin,
                        "document_number": tg_doc,
                        "invoice_number": tg_doc,
                        "document_date": tg_date,
                        "invoice_date": tg_date,
                        "taxable_value": tg_taxable,
                        "tax_amount": tg_tax,
                        "igst": tg_tax,
                        "total_value": round(tg_taxable + tg_tax, 2),
                        "GSTIN": tg_gstin,
                        "Invoice": tg_doc,
                        "Date": tg_date,
                        "Taxable": tg_taxable,
                        "Tax": tg_tax,
                        "Remarks": client_comment,
                        **(
                            {
                                "batch_consolidation_type": consolidation_meta[i]["mode"],
                                "batch_sum": consolidation_meta[i]["batch_sum"],
                                "target_amount": consolidation_meta[i]["target_amount"],
                            }
                            if i in consolidation_meta and consolidation_meta[i].get("is_master") and consolidation_meta[i].get("mode") in ("N:1", "1:N")
                            else {}
                        ),
                    },
                    variances={
                        "taxable_diff": t_diff,
                        "tax_diff": tx_diff,
                        **(
                            {
                                "batch_type": consolidation_meta[i]["mode"],
                                "batch_count": consolidation_meta[i]["batch_count"],
                                "batch_sum": consolidation_meta[i]["batch_sum"],
                                "target_amount": consolidation_meta[i]["target_amount"],
                                "target_document": consolidation_meta[i]["target_doc"],
                                "net_batch_variance": f"₹{consolidation_meta[i]['variance']:.2f}",
                            }
                            if i in consolidation_meta and consolidation_meta[i].get("is_master") and consolidation_meta[i].get("mode") in ("N:1", "1:N")
                            else {
                                "is_batch_constituent": True,
                                "batch_type": consolidation_meta[i]["mode"],
                                "target_document": consolidation_meta[i].get("target_doc"),
                                "target_amount": consolidation_meta[i].get("target_amount"),
                            }
                            if i in consolidation_meta and not consolidation_meta[i].get("is_master") and consolidation_meta[i].get("mode") in ("N:1", "1:N")
                            else {}
                        ),
                    },
                    matched_by_pass=p_tier,
                    batch_components=b_components,
                )
            )

        # Build Ambiguity Clusters for records flagged as AMBIGUOUS
        ambiguities: list[dict[str, Any]] = []
        for r in records:
            if r.bucket == "AMBIGUOUS":
                clust_id = f"CLUST-V4-{r.index:06d}"
                r.ambiguity_cluster_id = clust_id

                cand_diffs = []
                if r.taxable_diff > 0.01:
                    cand_diffs.append(f"Taxable Variance: ₹{r.taxable_diff:,.2f}")
                if r.tax_diff > 0.01:
                    cand_diffs.append(f"Tax Variance: ₹{r.tax_diff:,.2f}")
                if r.source_doc_num.strip().upper() != r.target_doc_num.strip().upper():
                    cand_diffs.append(f"Document # Mismatch: '{r.source_doc_num}' vs '{r.target_doc_num}'")
                if r.source_date and r.target_date and r.source_date != r.target_date:
                    cand_diffs.append(f"Date Variance: '{r.source_date}' vs '{r.target_date}'")

                doc_ratio = calculate_string_ratio(r.source_doc_num, r.target_doc_num)
                doc_sim = round(doc_ratio * 100.0, 1)

                t_max = max(r.source_taxable, r.target_taxable, 1.0)
                amt_score = round(max(0.0, 100.0 - (r.taxable_diff / t_max * 100.0)), 1)

                tx_max = max(r.source_tax, r.target_tax, 1.0)
                tax_score = round(max(0.0, 100.0 - (r.tax_diff / tx_max * 100.0)), 1)

                date_score = 90.0 if r.source_date == r.target_date else 70.0
                conf = round((doc_sim * 0.35 + amt_score * 0.35 + tax_score * 0.15 + date_score * 0.15), 1)

                cand1 = AmbiguityCandidate(
                    candidate_id=f"CAND-{r.index}-1",
                    pr_row_index=r.pr_row_index if r.pr_row_index is not None else (r.index - 1),
                    pr_record_id=f"PR-VOUCHER-{r.index:06d}",
                    confidence_score=conf,
                    score_breakdown=ScoreBreakdown(
                        invoice_similarity=doc_sim,
                        amount_score=amt_score,
                        date_score=date_score,
                        tax_score=tax_score,
                    ),
                    detected_differences=cand_diffs or ["Minor formatting variance"],
                    ai_reason=(
                        f"Primary ERP Ledger Voucher for counterparty GSTIN {r.source_gstin}. "
                        f"Financial variance ₹{r.taxable_diff:.2f} with {doc_sim}% document string correlation."
                    ),
                    pr_preview=r.pr_preview,
                )

                clust = AmbiguityCluster(
                    cluster_id=clust_id,
                    gstr_row_index=r.gstr_row_index if r.gstr_row_index is not None else (r.index - 1),
                    gstr_record_id=r.id,
                    anchor_preview=r.gstr_preview,
                    candidates=[cand1],
                    ai_justification=(
                        f"Ambiguous collision for Portal Document #{r.source_doc_num} (GSTIN: {r.source_gstin}). "
                        f"Potential variance requires accountant disambiguation or manual statutory reclassification."
                    ),
                    status="PENDING_REVIEW",
                    ambiguity_category="PROBABLE_EXACT_MATCH" if conf >= 85.0 else "SPLIT_BATCH_DELIVERY",
                    category_label="High-Confidence Probable Match" if conf >= 85.0 else "Multi-Candidate Collision",
                    recommended_action="Confirm dominant candidate or reclassify category",
                    priority="ROUTINE" if conf >= 85.0 else "REVIEW",
                )
                ambiguities.append(clust.model_dump())

        # Compute accurate summary metrics strictly based on all emitted records (1:1 with workbook rows)
        total_records_count = n_rows
        exact_count = sum(1 for r in records if r.tars_verdict == "Exact Match")
        tol_count = sum(1 for r in records if r.tars_verdict == "Tolerance Match")
        near_count = sum(1 for r in records if r.tars_verdict == "Near Match")
        ineligible_count = sum(1 for r in records if r.tars_verdict == "Ineligible ITC [Sec 17(5)]")
        consolidated_count = sum(1 for r in records if r.tars_verdict == "Consolidated Match")
        pr_count = sum(1 for r in records if r.tars_verdict == "PR Only")
        gst_count = sum(1 for r in records if r.tars_verdict == "GST Only")
        amb_count = sum(1 for r in records if r.tars_verdict == "Ambiguous")
        concurrence_count = sum(1 for r in records if r.concurrence == "AGREEMENT")
        concurrence_rate = round((concurrence_count / total_records_count * 100.0), 1) if total_records_count > 0 else 0.0
        tot_reconciled = exact_count + tol_count + near_count + ineligible_count + consolidated_count

        cross_fy_count = sum(1 for r in records if r.sub_classification == "CROSS_FY_TIMING")
        date_shift_count = sum(1 for r in records if r.sub_classification == "DATE_OPERATIONAL_SHIFT")
        ineligible_itc_count = sum(1 for r in records if r.sub_classification == "INELIGIBLE_ITC_17_5")
        banking_count = sum(1 for r in records if r.sub_classification == "BANKING_MULTI_TRANCHE")
        prefix_count = sum(1 for r in records if r.sub_classification == "DOC_PREFIX_NORMALIZED")
        compound_count = sum(1 for r in records if r.sub_classification == "COMPOUND_DOC_DATE_VARIATION")
        comm_tol_count = sum(1 for r in records if r.sub_classification == "COMMERCIAL_TOLERANCE")

        rule_breakdown = {
            "CROSS_FY_TIMING": cross_fy_count,
            "DATE_OPERATIONAL_SHIFT": date_shift_count,
            "INELIGIBLE_ITC_17_5": ineligible_itc_count,
            "BANKING_MULTI_TRANCHE": banking_count,
            "DOC_PREFIX_NORMALIZED": prefix_count,
            "COMPOUND_DOC_DATE_VARIATION": compound_count,
            "COMMERCIAL_TOLERANCE": comm_tol_count,
            "EXACT_ZERO_VARIANCE": exact_count,
            "AMBIGUOUS_COLLISION": amb_count,
            "GST_ONLY": gst_count,
            "PR_ONLY": pr_count,
        }

        exact_itc = round(sum(float(cp_taxable_lst[i]) for i in range(n_rows) if tars_verdicts_lst[i] == "Exact Match"), 2)
        tol_itc = round(sum(float(cp_taxable_lst[i]) for i in range(n_rows) if tars_verdicts_lst[i] == "Tolerance Match"), 2)
        near_itc = round(sum(float(cp_taxable_lst[i]) for i in range(n_rows) if tars_verdicts_lst[i] == "Near Match"), 2)
        tier4_itc = round(sum(float(cp_taxable_lst[i]) for i in range(n_rows) if tars_verdicts_lst[i] in ("Ineligible ITC [Sec 17(5)]", "Consolidated Match")), 2)
        tier5_itc = round(sum(float(cp_taxable_lst[i]) for i in range(n_rows) if tars_verdicts_lst[i] in ("GST Only", "PR Only", "Ambiguous")), 2)

        summary = Stage4ResultsSummaryV4(
            total_records=total_records_count,
            exact_matches=exact_count,
            tolerance_matches=tol_count + ineligible_count + consolidated_count,
            near_matches=near_count,
            ineligible_itc_matches=ineligible_count,
            consolidated_matches=consolidated_count,
            gst_only=gst_count,
            pr_only=pr_count,
            ambiguous=amb_count,
            kics_concurrence_count=concurrence_count,
            kics_concurrence_rate=concurrence_rate,
            disparities_caught=total_records_count - concurrence_count,
            net_taxable_variance=round(sum(r.taxable_diff for r in records), 2),
            net_tax_variance=round(sum(r.tax_diff for r in records), 2),
            total_gov_taxable=round(float(cp_taxable.sum()), 2),
            total_pr_taxable=round(float(pr_taxable.sum()), 2),
            accuracy_percentage=round((tot_reconciled / total_records_count * 100.0), 1) if total_records_count > 0 else 0.0,
            # V2 UI Compatibility fields
            total_gstr_rows=total_records_count,
            total_pr_rows=total_records_count,
            exact_match_count=exact_count,
            exact_match_itc=exact_itc,
            tolerance_match_count=tol_count + ineligible_count + consolidated_count,
            tolerance_match_itc=round(sum(float(cp_taxable_lst[i]) for i in range(n_rows) if tars_verdicts_lst[i] in ("Tolerance Match", "Ineligible ITC [Sec 17(5)]", "Consolidated Match")), 2),
            near_match_count=near_count,
            near_match_itc=near_itc,
            ambiguous_count=amb_count,
            ambiguous_itc=round(sum(float(cp_taxable_lst[i]) for i in range(n_rows) if tars_verdicts_lst[i] == "Ambiguous"), 2),
            gstr_only_count=gst_count,
            gstr_only_itc=round(sum(float(cp_taxable_lst[i]) for i in range(n_rows) if tars_verdicts_lst[i] == "GST Only"), 2),
            pr_only_count=pr_count,
            pr_only_itc=round(sum(float(pr_taxable_lst[i]) for i in range(n_rows) if tars_verdicts_lst[i] == "PR Only"), 2),
            total_reconciled_count=tot_reconciled,
            total_reconciled_itc=round(sum(float(cp_taxable_lst[i]) for i in range(n_rows) if tars_verdicts_lst[i] in ("Exact Match", "Tolerance Match", "Near Match", "Ineligible ITC [Sec 17(5)]", "Consolidated Match")), 2),
            overall_reconciliation_rate=concurrence_rate,
            waterfall_passes=[
                {"tier": 1, "name": "Tier 1: Exact Statutory Identity", "matched_count": exact_count, "matched_itc": exact_itc, "retention_percentage": round(exact_count / total_records_count * 100, 1) if total_records_count else 0.0},
                {"tier": 2, "name": "Tier 2: Commercial Tolerances & Cross-FY", "matched_count": tol_count, "matched_itc": tol_itc, "retention_percentage": round(tol_count / total_records_count * 100, 1) if total_records_count else 0.0},
                {"tier": 3, "name": "Tier 3: Normalized & Compound Matches", "matched_count": near_count, "matched_itc": near_itc, "retention_percentage": round(near_count / total_records_count * 100, 1) if total_records_count else 0.0},
                {"tier": 4, "name": "Tier 4: Statutory Discrepancies & Batches", "matched_count": ineligible_count + consolidated_count, "matched_itc": tier4_itc, "retention_percentage": round((ineligible_count + consolidated_count) / total_records_count * 100, 1) if total_records_count else 0.0},
                {"tier": 5, "name": "Tier 5: Single-Sided Residuals & Ambiguities", "matched_count": pr_count + gst_count + amb_count, "matched_itc": tier5_itc, "retention_percentage": round((pr_count + gst_count + amb_count) / total_records_count * 100, 1) if total_records_count else 0.0},
            ],
            rule_breakdown=rule_breakdown,
        )

        duration_ms = round((time.time() - start_time) * 1000.0, 1)

        return Stage4ExecutionResponseV4(
            session_id=session_id,
            executed_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),
            duration_ms=duration_ms,
            summary=summary,
            records=records,
            kics_status_column=kics_col or "ReconciliationSection",
            ambiguities=ambiguities,
        )

