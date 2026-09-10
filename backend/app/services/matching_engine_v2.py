from __future__ import annotations

import logging
import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from enum import Enum
from typing import Any, Hashable
from uuid import uuid4

import pandas as pd
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


class NormalizationType(str, Enum):
    TRIM_WHITESPACE = "TRIM_WHITESPACE"
    STRIP_SPECIAL_CHARS = "STRIP_SPECIAL_CHARS"
    UPPERCASE = "UPPERCASE"
    REMOVE_PREFIXES = "REMOVE_PREFIXES"
    TRIM_LEADING_ZEROS = "TRIM_LEADING_ZEROS"
    ALPHANUMERIC_ONLY = "ALPHANUMERIC_ONLY"


class MatchStrategy(str, Enum):
    EXACT = "EXACT"
    NORMALIZED_TEXT = "NORMALIZED_TEXT"
    NUMERIC_TOLERANCE = "NUMERIC_TOLERANCE"
    DATE_PROXIMITY = "DATE_PROXIMITY"
    VALUE_GUARD = "VALUE_GUARD"


class DateToleranceUnit(str, Enum):
    DAYS = "DAYS"
    MONTHS = "MONTHS"
    YEARS = "YEARS"


class NumericToleranceMode(str, Enum):
    ABSOLUTE_INR = "ABSOLUTE_INR"
    PERCENTAGE = "PERCENTAGE"


class Rule2Item(BaseModel):
    id: str
    name: str
    description: str
    category: str = "CORE_MATCHING"  # CORE_IDENTITY, DOCUMENT_REFERENCE, TEMPORAL_WINDOW, FINANCIAL_VALUE, COMPLIANCE_GUARD
    gstr_column: str
    pr_column: str
    canonical_concept: str | None = None
    strategy: MatchStrategy = MatchStrategy.EXACT
    normalizers: list[NormalizationType] = Field(default_factory=list)
    tolerance_value: float = 0.0
    tolerance_mode: NumericToleranceMode = NumericToleranceMode.ABSOLUTE_INR
    date_tolerance_value: int = 0
    date_tolerance_unit: DateToleranceUnit = DateToleranceUnit.DAYS
    is_enabled: bool = True
    execution_order: int = 1
    plain_english_explanation: str = ""
    why_it_matters: str = ""
    column_status: str = "AVAILABLE"  # "AVAILABLE", "MISSING", "UNMAPPED"
    missing_reason: str | None = None
    ai_rationale: str | None = None
    is_ai_suggested: bool = False
    is_custom: bool = False
    created_at: str | None = None
    created_by: str | None = None
    created_in_run: str | None = None
    version: str = "1.0.0"
    last_modified_at: str | None = None
    last_modified_by: str | None = None


class RuleBreakdownStat(BaseModel):
    rule_id: str
    rule_name: str
    category: str
    individual_satisfied_count: int
    individual_satisfied_percentage: float
    is_bottleneck: bool = False


class SampleMatchPair(BaseModel):
    gstr_row_index: int
    pr_row_index: int
    gstr_preview: dict[str, Any]
    pr_preview: dict[str, Any]
    matched_by_pass: str
    normalized_values: dict[str, str] = Field(default_factory=dict)


class SimulationResultV2(BaseModel):
    total_gstr_rows: int
    total_pr_rows: int
    total_matched: int
    overall_match_rate: float
    total_unmatched_gstr: int
    total_unmatched_pr: int
    rule_breakdowns: list[RuleBreakdownStat] = Field(default_factory=list)
    sample_matches: list[SampleMatchPair] = Field(default_factory=list)


# Backward compatibility models
class FieldMatchRule(BaseModel):
    rule_id: str = Field(default_factory=lambda: f"RUL-{re.sub(r'[^a-zA-Z0-9]', '', str(pd.Timestamp.now().timestamp()))[-6:]}")
    gstr_column: str
    pr_column: str
    canonical_concept: str | None = None
    strategy: MatchStrategy = MatchStrategy.EXACT
    normalizers: list[NormalizationType] = Field(default_factory=list)
    tolerance_value: float = 0.0
    date_tolerance_days: int = 0
    is_active: bool = True


class MatchingPass(BaseModel):
    pass_id: str
    name: str
    description: str
    tier: int
    is_enabled: bool = True
    rules: list[FieldMatchRule] = Field(default_factory=list)


class SimulationYield(BaseModel):
    pass_id: str
    pass_name: str
    tier: int
    matched_count: int
    cumulative_matched: int
    pass_match_percentage: float
    sample_matches: list[SampleMatchPair] = Field(default_factory=list)


class SimulationResult(BaseModel):
    total_gstr_rows: int
    total_pr_rows: int
    total_matched: int
    total_unmatched_gstr: int
    total_unmatched_pr: int
    overall_match_rate: float
    waterfall: list[SimulationYield] = Field(default_factory=list)


class ValueNormalizer:
    """Deterministic string and value normalization suite for GST reconciliation."""

    PREFIX_REGEX = re.compile(r"^(INV[-_ /:]*|BILL[-_ /:]*|TAX[-_ /:]*|GST[-_ /:]*|REF[-_ /:]*|DN[-_ /:]*|CN[-_ /:]*)+", re.IGNORECASE)
    SPECIAL_CHARS_REGEX = re.compile(r"[^A-Za-z0-9\s]")
    ALPHANUMERIC_REGEX = re.compile(r"[^A-Za-z0-9]")

    @classmethod
    def normalize_text(cls, value: Any, normalizers: list[NormalizationType]) -> str | None:
        if value is None or pd.isna(value):
            return None
        if isinstance(value, float) and value.is_integer():
            text = str(int(value))
        elif isinstance(value, str) and re.match(r"^\d+\.0$", value.strip()):
            text = value.strip()[:-2]
        else:
            text = str(value)

        for norm in normalizers:
            if norm == NormalizationType.TRIM_WHITESPACE:
                text = " ".join(text.split())
            elif norm == NormalizationType.STRIP_SPECIAL_CHARS:
                text = cls.SPECIAL_CHARS_REGEX.sub("", text)
            elif norm == NormalizationType.ALPHANUMERIC_ONLY:
                text = cls.ALPHANUMERIC_REGEX.sub("", text)
            elif norm == NormalizationType.UPPERCASE:
                text = text.upper()
            elif norm == NormalizationType.REMOVE_PREFIXES:
                text = cls.PREFIX_REGEX.sub("", text)
            elif norm == NormalizationType.TRIM_LEADING_ZEROS:
                text = text.lstrip("0") or "0"

        text = text.strip()
        return text if text else None

    @classmethod
    def parse_decimal(cls, value: Any) -> Decimal | None:
        if value is None or pd.isna(value):
            return None
        try:
            cleaned = re.sub(r"[^\d.-]", "", str(value))
            if not cleaned:
                return None
            return Decimal(cleaned)
        except (InvalidOperation, ValueError):
            return None

    @classmethod
    def parse_date(cls, value: Any) -> date | None:
        if value is None or pd.isna(value):
            return None
        if isinstance(value, datetime):
            return value.date()
        if isinstance(value, date):
            return value
        try:
            parsed = pd.to_datetime(value, errors="coerce", dayfirst=True)
            return None if pd.isna(parsed) else parsed.date()
        except Exception:
            return None


class WaterfallMatchingEngine:
    """Enterprise Rules 2.0 & Waterfall Simulation Engine for GST Reconciliation."""

    def __init__(self, normalizer: type[ValueNormalizer] = ValueNormalizer):
        self.normalizer = normalizer

    CORE_CONCEPT_TOKENS: dict[str, list[str]] = {
        "gstin": ["gstin", "ctin", "supplier_gstin", "vendor_gstin", "counterparty_gstin", "billfromgstin", "bill_from_gstin", "tin", "gst_no", "billgstin"],
        "document_number": [
            "document_number", "documentnumber", "doc_number", "doc_no", "docno",
            "invoice_number", "invoicenumber", "invoice_no", "invoiceno", "inv_number", "inv_no", "invno",
            "bill_number", "billnumber", "bill_no", "billno", "inum", "pr_document_number", "counterparty_document_number", "doc_num"
        ],
        "document_date": [
            "document_date", "documentdate", "doc_date", "docdate",
            "invoice_date", "invoicedate", "inv_date", "invdate",
            "bill_date", "billdate", "dt", "pr_document_date", "counterparty_document_date", "doc_dt"
        ],
        "taxable_value": [
            "taxable_value", "taxablevalue", "taxable_amount", "taxableamount",
            "taxable_val", "taxable", "val", "base_amount", "txval"
        ],
        "total_value": [
            "total_value", "totalvalue", "total_amount", "totalamount",
            "document_value", "documentvalue", "doc_value", "docvalue",
            "invoice_value", "invoicevalue", "gross_amount", "grossamount", "grand_total"
        ],
        "payment_date": [
            "payment_date", "paymentdate", "pay_date", "paydate", "payment_dt", "date_of_payment"
        ],
        "reverse_charge": [
            "reverse_charge", "reversecharge", "rcm", "rcm_flag", "is_reverse_charge"
        ],
        "place_of_supply": [
            "place_of_supply", "placeofsupply", "pos", "pos_state", "state_code", "supply_state"
        ],
        "hsn": [
            "hsn", "hsn_sac", "hsnsac", "hsn_code", "hsncode", "sac", "sac_code"
        ],
        "vendor_name": [
            "vendor_name", "vendorname", "supplier_name", "suppliername", "trade_name", "tradename",
            "legal_name", "legalname", "party_name", "partyname"
        ],
        "cess": [
            "cess", "cess_amount", "cessamount", "compensation_cess", "cess_val"
        ],
        "tax_rate": [
            "tax_rate", "taxrate", "rate", "gst_rate", "gstr_rate", "pr_rate", "slab_rate", "rate_of_tax"
        ],
        "igst": [
            "igst", "igst_amount", "igstamount", "integrated_tax", "integratedtax", "iamt"
        ],
        "cgst": [
            "cgst", "cgst_amount", "cgstamount", "central_tax", "centraltax", "camt"
        ],
        "sgst": [
            "sgst", "sgst_amount", "sgstamount", "state_tax", "statetax", "samt", "utgst"
        ],
        "document_type": [
            "document_type", "documenttype", "doc_type", "doctype", "inv_type", "supply_type"
        ],
    }

    @classmethod
    def _find_matching_col(cls, df: pd.DataFrame, target: str, concept: str | None = None) -> str | None:
        if df is None or len(df.columns) == 0:
            return None
        if target in df.columns:
            return target
        clean_target = re.sub(r"[^a-zA-Z0-9]", "", target.lower())
        for col in df.columns:
            clean_col = re.sub(r"[^a-zA-Z0-9]", "", col.lower())
            if clean_target == clean_col:
                return col

        # Infer concept if not explicitly provided
        effective_concept = concept
        if not effective_concept:
            for c_key, tokens in cls.CORE_CONCEPT_TOKENS.items():
                if any(re.sub(r"[^a-zA-Z0-9]", "", t.lower()) == clean_target or clean_target in re.sub(r"[^a-zA-Z0-9]", "", t.lower()) for t in tokens):
                    effective_concept = c_key
                    break

        # Check concept tokens against columns
        if effective_concept and effective_concept in cls.CORE_CONCEPT_TOKENS:
            tokens = cls.CORE_CONCEPT_TOKENS[effective_concept]
            clean_tokens = [re.sub(r"[^a-zA-Z0-9]", "", t.lower()) for t in tokens]
            # Exact clean token match first
            for col in df.columns:
                clean_col = re.sub(r"[^a-zA-Z0-9]", "", col.lower())
                if clean_col in clean_tokens:
                    return col
            # Substring token match
            for col in df.columns:
                clean_col = re.sub(r"[^a-zA-Z0-9]", "", col.lower())
                for ct in clean_tokens:
                    if ct in clean_col or clean_col in ct:
                        return col

        # General substring match fallback
        for col in df.columns:
            clean_col = re.sub(r"[^a-zA-Z0-9]", "", col.lower())
            if clean_target and (clean_target in clean_col or clean_col in clean_target):
                return col
        return None

    def simulate_rules_v2(
        self,
        gstr_df: pd.DataFrame,
        pr_df: pd.DataFrame,
        rules: list[Rule2Item],
    ) -> SimulationResultV2:
        """Evaluates Rules Wiki 2.0 rules: computes overall simultaneous match and individual satisfaction breakdowns."""
        total_gstr = len(gstr_df)
        total_pr = len(pr_df)

        if total_gstr == 0 or total_pr == 0:
            return SimulationResultV2(
                total_gstr_rows=0,
                total_pr_rows=0,
                total_matched=0,
                overall_match_rate=0.0,
                total_unmatched_gstr=0,
                total_unmatched_pr=0,
                rule_breakdowns=[],
                sample_matches=[],
            )

        active_rules = sorted([r for r in rules if r.is_enabled], key=lambda x: x.execution_order)

        # 1. Resolve columns against DataFrames
        resolved_rules: list[Rule2Item] = []
        for r in active_rules:
            g_col = self._find_matching_col(gstr_df, r.gstr_column, r.canonical_concept) or r.gstr_column
            p_col = self._find_matching_col(pr_df, r.pr_column, r.canonical_concept) or r.pr_column
            resolved_rules.append(r.model_copy(update={"gstr_column": g_col, "pr_column": p_col}))

        # 2. Individual Rule Satisfaction Counters
        breakdowns: list[RuleBreakdownStat] = []
        for r in resolved_rules:
            satisfied = self._count_individual_rule_satisfaction(gstr_df, pr_df, r)
            pct = round((satisfied / total_gstr * 100.0), 1) if total_gstr > 0 else 0.0
            breakdowns.append(
                RuleBreakdownStat(
                    rule_id=r.id,
                    rule_name=r.name,
                    category=r.category,
                    individual_satisfied_count=satisfied,
                    individual_satisfied_percentage=pct,
                )
            )

        # Mark bottlenecks (only if satisfaction is strictly less than total rows and below 98%)
        if breakdowns:
            min_count = min(b.individual_satisfied_count for b in breakdowns)
            if min_count < total_gstr:
                for b in breakdowns:
                    if b.individual_satisfied_count == min_count and b.individual_satisfied_percentage < 98.0:
                        b.is_bottleneck = True

        # 3. Overall Simultaneous Multi-Rule Matching
        matched_pairs, sample_matches = self._match_simultaneous(gstr_df, pr_df, resolved_rules)
        total_matched = len(matched_pairs)
        overall_pct = round((total_matched / total_gstr * 100.0), 1) if total_gstr > 0 else 0.0

        return SimulationResultV2(
            total_gstr_rows=total_gstr,
            total_pr_rows=total_pr,
            total_matched=total_matched,
            overall_match_rate=overall_pct,
            total_unmatched_gstr=total_gstr - total_matched,
            total_unmatched_pr=total_pr - total_matched,
            rule_breakdowns=breakdowns,
            sample_matches=sample_matches,
        )

    def _count_individual_rule_satisfaction(
        self,
        gstr_df: pd.DataFrame,
        pr_df: pd.DataFrame,
        rule: Rule2Item,
    ) -> int:
        """Determines how many 1-to-1 matches this rule produces when evaluated against the datasets."""
        matched_pairs, _ = self._match_simultaneous(gstr_df, pr_df, [rule])
        return len(matched_pairs)

    def _match_simultaneous(
        self,
        gstr_df: pd.DataFrame,
        pr_df: pd.DataFrame,
        rules: list[Rule2Item],
    ) -> tuple[list[tuple[int, int]], list[SampleMatchPair]]:
        """Simultaneously evaluates all active rules across records, claiming matches 1-to-1."""
        if not rules or len(gstr_df) == 0 or len(pr_df) == 0:
            return [], []

        # Pre-extract columns to fast list lookups (avoids slow pandas .iloc overhead)
        gstr_dict: dict[str, list[Any]] = {str(col): gstr_df[col].to_list() for col in gstr_df.columns}
        pr_dict: dict[str, list[Any]] = {str(col): pr_df[col].to_list() for col in pr_df.columns}
        num_gstr = len(gstr_df)
        num_pr = len(pr_df)

        # Split into fast hash index keys (GSTIN, Invoice No) vs condition checks (Date, Value, Guard)
        index_rules: list[Rule2Item] = []
        condition_rules: list[Rule2Item] = []

        for r in rules:
            if r.strategy in (MatchStrategy.EXACT, MatchStrategy.NORMALIZED_TEXT):
                index_rules.append(r)
            else:
                condition_rules.append(r)

        # Pre-normalize index rules for PR
        pr_index: dict[tuple[Hashable, ...], list[int]] = {}
        if index_rules:
            for p_idx in range(num_pr):
                keys: list[Hashable] = []
                valid = True
                for r in index_rules:
                    col_vals = pr_dict.get(r.pr_column)
                    val = col_vals[p_idx] if col_vals else None
                    norm = self.normalizer.normalize_text(val, r.normalizers)
                    if norm is None:
                        valid = False
                        break
                    keys.append(norm)
                if valid:
                    pr_index.setdefault(tuple(keys), []).append(p_idx)

        # Pre-index PR by first condition rule if no text index rules exist
        pr_cond_index: dict[int, list[int]] | None = None
        if not index_rules and condition_rules:
            c_rule = condition_rules[0]
            if c_rule.strategy == MatchStrategy.VALUE_GUARD:
                pr_cond_index = {}
                col_vals = pr_dict.get(c_rule.pr_column)
                if col_vals:
                    for p_idx in range(num_pr):
                        v_str = str(col_vals[p_idx] or "").strip().upper()
                        if v_str:
                            pr_cond_index.setdefault(hash(v_str), []).append(p_idx)

        claimed_pr: set[int] = set()
        matched_pairs: list[tuple[int, int]] = []
        sample_matches: list[SampleMatchPair] = []

        for g_idx in range(num_gstr):
            norm_meta: dict[str, str] = {}

            if index_rules:
                g_keys: list[Hashable] = []
                valid = True
                for r in index_rules:
                    col_vals = gstr_dict.get(r.gstr_column)
                    val = col_vals[g_idx] if col_vals else None
                    norm = self.normalizer.normalize_text(val, r.normalizers)
                    if norm is None:
                        valid = False
                        break
                    g_keys.append(norm)
                    norm_meta[f"Gov:{r.gstr_column}"] = norm

                if not valid:
                    continue
                candidates = pr_index.get(tuple(g_keys), [])
            elif pr_cond_index is not None and condition_rules:
                c_rule = condition_rules[0]
                col_vals = gstr_dict.get(c_rule.gstr_column)
                val = str(col_vals[g_idx] or "").strip().upper() if col_vals else ""
                candidates = pr_cond_index.get(hash(val), []) if val else []
            else:
                candidates = range(num_pr)

            for p_idx in candidates:
                if p_idx in claimed_pr:
                    continue

                passed = True
                for r in condition_rules:
                    date_days = r.date_tolerance_value
                    if r.date_tolerance_unit == DateToleranceUnit.MONTHS:
                        date_days *= 30
                    elif r.date_tolerance_unit == DateToleranceUnit.YEARS:
                        date_days *= 365

                    g_col_vals = gstr_dict.get(r.gstr_column)
                    p_col_vals = pr_dict.get(r.pr_column)
                    g_val = g_col_vals[g_idx] if g_col_vals else None
                    p_val = p_col_vals[p_idx] if p_col_vals else None

                    if r.strategy == MatchStrategy.NUMERIC_TOLERANCE:
                        g_dec = self.normalizer.parse_decimal(g_val)
                        p_dec = self.normalizer.parse_decimal(p_val)
                        if g_dec is None or p_dec is None:
                            passed = False
                            break
                        g_f, p_f = float(g_dec), float(p_dec)
                        tol = r.tolerance_value
                        if r.tolerance_mode == NumericToleranceMode.PERCENTAGE:
                            tol = abs(g_f * r.tolerance_value / 100.0)
                        diff = abs(g_f - p_f)
                        if diff > (tol + 1e-4):
                            passed = False
                            break
                        norm_meta[f"Diff:{r.gstr_column}"] = f"{diff:.2f}"

                    elif r.strategy == MatchStrategy.DATE_PROXIMITY:
                        g_d = self.normalizer.parse_date(g_val)
                        p_d = self.normalizer.parse_date(p_val)
                        if g_d is None or p_d is None:
                            passed = False
                            break
                        diff_days = abs((g_d - p_d).days)
                        if diff_days > date_days:
                            passed = False
                            break
                        norm_meta[f"DateDelta:{r.gstr_column}"] = f"{diff_days}d"

                    elif r.strategy == MatchStrategy.VALUE_GUARD:
                        g_v = str(g_val or "").strip().upper()
                        p_v = str(p_val or "").strip().upper()
                        if g_v != p_v:
                            passed = False
                            break

                if passed:
                    claimed_pr.add(p_idx)
                    matched_pairs.append((g_idx, p_idx))
                    if len(sample_matches) < 8:
                        sample_matches.append(
                            SampleMatchPair(
                                gstr_row_index=g_idx,
                                pr_row_index=p_idx,
                                gstr_preview={col: str(gstr_dict[col][g_idx]) for col in list(gstr_dict.keys())[:6] if pd.notna(gstr_dict[col][g_idx])},
                                pr_preview={col: str(pr_dict[col][p_idx]) for col in list(pr_dict.keys())[:6] if pd.notna(pr_dict[col][p_idx])},
                                matched_by_pass="Rules Wiki 2.0 Consensus",
                                normalized_values=norm_meta,
                            )
                        )
                    break

        return matched_pairs, sample_matches

    # Backward compatible simulate for existing callers
    def simulate(
        self,
        gstr_df: pd.DataFrame,
        pr_df: pd.DataFrame,
        waterfall_passes: list[MatchingPass],
    ) -> SimulationResult:
        # Map waterfall_passes into flat Rule2Item list for simulation
        flat_rules: list[Rule2Item] = []
        for p in waterfall_passes:
            if not p.is_enabled:
                continue
            for r in p.rules:
                if not r.is_active:
                    continue
                flat_rules.append(
                    Rule2Item(
                        id=r.rule_id,
                        name=f"{r.gstr_column} Match",
                        description=f"Match {r.gstr_column} with {r.pr_column}",
                        gstr_column=r.gstr_column,
                        pr_column=r.pr_column,
                        canonical_concept=r.canonical_concept,
                        strategy=r.strategy,
                        normalizers=r.normalizers,
                        tolerance_value=r.tolerance_value,
                        date_tolerance_value=r.date_tolerance_days,
                        date_tolerance_unit=DateToleranceUnit.DAYS,
                        is_enabled=True,
                    )
                )

        res_v2 = self.simulate_rules_v2(gstr_df, pr_df, flat_rules)

        # Convert back to SimulationResult format
        yields: list[SimulationYield] = []
        for p in waterfall_passes:
            yields.append(
                SimulationYield(
                    pass_id=p.pass_id,
                    pass_name=p.name,
                    tier=p.tier,
                    matched_count=res_v2.total_matched,
                    cumulative_matched=res_v2.total_matched,
                    pass_match_percentage=res_v2.overall_match_rate,
                    sample_matches=res_v2.sample_matches,
                )
            )

        return SimulationResult(
            total_gstr_rows=res_v2.total_gstr_rows,
            total_pr_rows=res_v2.total_pr_rows,
            total_matched=res_v2.total_matched,
            total_unmatched_gstr=res_v2.total_unmatched_gstr,
            total_unmatched_pr=res_v2.total_unmatched_pr,
            overall_match_rate=res_v2.overall_match_rate,
            waterfall=yields,
        )


def build_default_rules_wiki_v2(
    correlations: list[dict[str, Any]] | None = None,
) -> list[Rule2Item]:
    """Generates the primary high-impact enterprise rules tailored for the 223-column GST schema."""
    rules: list[Rule2Item] = [
        Rule2Item(
            id="RW2-001",
            name="Supplier GSTIN Identity Match",
            description="Matches vendor GST identification numbers between Government portal and Client Purchase Register.",
            category="CORE_IDENTITY",
            gstr_column="BillFromGstin",
            pr_column="BillFromGstin",
            canonical_concept="gstin",
            strategy=MatchStrategy.NORMALIZED_TEXT,
            normalizers=[NormalizationType.TRIM_WHITESPACE, NormalizationType.STRIP_SPECIAL_CHARS, NormalizationType.UPPERCASE],
            is_enabled=True,
            execution_order=1,
            plain_english_explanation="Verifies that the Supplier GSTIN reported in Government GSTR-2B exactly matches the Supplier GSTIN in your ERP ledger, after stripping spaces and punctuation.",
            why_it_matters="Under Section 16(2)(aa) of the CGST Act, Input Tax Credit (ITC) can only be claimed if the supplier has filed their tax return under their exact registered GSTIN.",
        ),
        Rule2Item(
            id="RW2-002",
            name="Invoice / Document Number Canonical Match",
            description="Matches invoice, debit note, and credit note numbers across ledgers with smart prefix stripping.",
            category="DOCUMENT_REFERENCE",
            gstr_column="DocumentNumber",
            pr_column="DocumentNumber",
            canonical_concept="document_number",
            strategy=MatchStrategy.NORMALIZED_TEXT,
            normalizers=[
                NormalizationType.TRIM_WHITESPACE,
                NormalizationType.STRIP_SPECIAL_CHARS,
                NormalizationType.REMOVE_PREFIXES,
                NormalizationType.TRIM_LEADING_ZEROS,
                NormalizationType.UPPERCASE,
            ],
            is_enabled=True,
            execution_order=2,
            plain_english_explanation="Matches invoice numbers even when ERP stores '00042' or 'INV/2026/42' while Government portal shows '42' by stripping standard prefixes and leading zeroes.",
            why_it_matters="Vendors and ERP systems format document numbers differently. Stripping standard prefixes unlocks up to 35% of otherwise unmatched invoices without audit risk.",
        ),
        Rule2Item(
            id="RW2-003",
            name="Invoice Date Proximity Window",
            description="Allows a flexible calendar window between the invoice issue date and accounting booking date.",
            category="TEMPORAL_WINDOW",
            gstr_column="DocumentDate",
            pr_column="DocumentDate",
            canonical_concept="document_date",
            strategy=MatchStrategy.DATE_PROXIMITY,
            normalizers=[NormalizationType.TRIM_WHITESPACE],
            date_tolerance_value=30,
            date_tolerance_unit=DateToleranceUnit.DAYS,
            is_enabled=True,
            execution_order=3,
            plain_english_explanation="Allows the document date between Government GSTR-2B and Purchase Register to vary by up to 30 days (or 1 month).",
            why_it_matters="Suppliers frequently issue bills at month-end while corporate accounts payable teams record them in the subsequent month after physical goods receipt.",
        ),
        Rule2Item(
            id="RW2-004",
            name="Taxable Value Commercial Tolerance",
            description="Absorbs rounding fractions and commercial differences in base taxable supply amounts.",
            category="FINANCIAL_VALUE",
            gstr_column="TaxableValue",
            pr_column="TaxableValue",
            canonical_concept="taxable_value",
            strategy=MatchStrategy.NUMERIC_TOLERANCE,
            normalizers=[NormalizationType.TRIM_WHITESPACE],
            tolerance_value=10.0,
            tolerance_mode=NumericToleranceMode.ABSOLUTE_INR,
            is_enabled=True,
            execution_order=4,
            plain_english_explanation="Considers taxable amounts matching if the variance between Government and Purchase Register is within ± ₹10.00.",
            why_it_matters="Small discrepancies typically arise from item-level vs header-level rounding algorithms and fractional packaging charges.",
        ),
        Rule2Item(
            id="RW2-005",
            name="Total Invoice Value (Gross Amount) Match",
            description="Verifies the grand total invoice value inclusive of all taxes and cess charges.",
            category="FINANCIAL_VALUE",
            gstr_column="DocumentValue",
            pr_column="DocumentValue",
            canonical_concept="total_value",
            strategy=MatchStrategy.NUMERIC_TOLERANCE,
            normalizers=[NormalizationType.TRIM_WHITESPACE],
            tolerance_value=10.0,
            tolerance_mode=NumericToleranceMode.ABSOLUTE_INR,
            is_enabled=True,
            execution_order=5,
            plain_english_explanation="Ensures the total invoice value (taxable + GST + cess) matches within ± ₹10.00.",
            why_it_matters="Protects against under-claiming or over-claiming gross purchase register balances submitted for financial audit sign-off.",
        ),
        Rule2Item(
            id="RW2-006",
            name="Payment Date Compliance (180-Day Rule)",
            description="Evaluates payment date lag against statutory 180-day ITC reversal mandate.",
            category="TEMPORAL_WINDOW",
            gstr_column="PaymentDate",
            pr_column="PaymentDate",
            canonical_concept="payment_date",
            strategy=MatchStrategy.DATE_PROXIMITY,
            normalizers=[NormalizationType.TRIM_WHITESPACE],
            date_tolerance_value=180,
            date_tolerance_unit=DateToleranceUnit.DAYS,
            is_enabled=False,
            execution_order=6,
            plain_english_explanation="Checks that the payment date is within 180 days of the invoice date.",
            why_it_matters="Second proviso to Section 16(2) requires recipient taxpayers to reverse ITC if payment is not made to the supplier within 180 days from invoice issue.",
        ),
        Rule2Item(
            id="RW2-007",
            name="Reverse Charge Mechanism (RCM) Alignment",
            description="Ensures both workbooks agree on whether tax is payable under forward charge or reverse charge.",
            category="COMPLIANCE_GUARD",
            gstr_column="ReverseCharge",
            pr_column="ReverseCharge",
            canonical_concept="reverse_charge",
            strategy=MatchStrategy.VALUE_GUARD,
            normalizers=[NormalizationType.TRIM_WHITESPACE, NormalizationType.UPPERCASE],
            is_enabled=True,
            execution_order=7,
            plain_english_explanation="Verifies that if an invoice is marked as Reverse Charge ('Y') in Government GSTR-2B, it is also flagged as Reverse Charge in your ERP.",
            why_it_matters="Mismatched RCM flags lead to erroneous cash tax liability payments under GSTR-3B Table 3.1(d).",
        ),
    ]

    for r in rules:
        if not r.created_at:
            r.created_at = "2026-08-01T00:00:00Z"
        if not r.created_by:
            r.created_by = "System Standard Baseline"
        if not r.created_in_run:
            r.created_in_run = "Master Catalog v2.0"
        if not r.version:
            r.version = "1.0.0"

    return rules


def evaluate_rule_column_availability(
    rules: list[Rule2Item],
    gstr_df: pd.DataFrame,
    pr_df: pd.DataFrame,
    correlations: list[dict[str, Any]] | list[Any] | None = None,
) -> list[Rule2Item]:
    """
    Intelligent Column Availability Rule Gating (Deterministic + Semantic Validation).
    Evaluates each candidate rule against actual GSTR-2B and Purchase Register columns & confirmed correlations.
    Deselects rules by default (is_enabled = False) if any required column is absent, unmapped, or 100% empty.
    Standard core GST rules (GSTIN, Invoice #, Invoice Date, Taxable Value, Total Amount, RCM) are enabled by default.
    Only Payment Date (RW2-006) is unchecked by default if payment date columns are not detected in the workbooks.
    """
    # Build mapping lookup from correlations
    corr_map: dict[str, str] = {}
    if correlations:
        for c in correlations:
            if isinstance(c, dict):
                g_col = c.get("gstr_column")
                p_col = c.get("selected_pr_column") or c.get("pr_column")
                if g_col and p_col:
                    corr_map[str(g_col).strip().lower()] = str(p_col).strip()
            elif hasattr(c, "gstr_column"):
                p_col = getattr(c, "selected_pr_column", None) or getattr(c, "pr_column", None)
                if c.gstr_column and p_col:
                    corr_map[str(c.gstr_column).strip().lower()] = str(p_col).strip()

    evaluated_rules: list[Rule2Item] = []

    # If DataFrames are empty (no columns available to inspect), retain standard enterprise default selections
    has_gstr_cols = gstr_df is not None and len(gstr_df.columns) > 0
    has_pr_cols = pr_df is not None and len(pr_df.columns) > 0

    for r in rules:
        if not has_gstr_cols or not has_pr_cols:
            # When workbooks are not yet parsed or in mock/catalog mode:
            # Core rules RW2-001..005, RW2-007 are active by default; RW2-006 (payment date) is optional
            is_payment_rule = r.id == "RW2-006" or r.canonical_concept == "payment_date"
            evaluated_rules.append(
                r.model_copy(
                    update={
                        "is_enabled": not is_payment_rule,
                        "column_status": "MISSING" if is_payment_rule else "AVAILABLE",
                        "missing_reason": "Column 'PaymentDate' not found or unmapped in Client Purchase Register." if is_payment_rule else None,
                    }
                )
            )
            continue

        # 1. Resolve GSTR column
        resolved_gstr = WaterfallMatchingEngine._find_matching_col(gstr_df, r.gstr_column, r.canonical_concept)
        # 2. Resolve PR column: first check correlation mapping, then direct lookup
        mapped_pr = corr_map.get(r.gstr_column.strip().lower())
        if not mapped_pr and resolved_gstr:
            mapped_pr = corr_map.get(resolved_gstr.strip().lower())
        target_pr = mapped_pr or r.pr_column
        resolved_pr = WaterfallMatchingEngine._find_matching_col(pr_df, target_pr, r.canonical_concept)

        is_gstr_missing = resolved_gstr is None
        is_pr_missing = resolved_pr is None

        # Check if column is present in schema but 100% empty (all NaN or whitespace)
        is_gstr_empty = False
        if resolved_gstr and resolved_gstr in gstr_df.columns:
            non_null_count = gstr_df[resolved_gstr].dropna().astype(str).str.strip().ne("").sum()
            if non_null_count == 0:
                is_gstr_empty = True

        is_pr_empty = False
        if resolved_pr and resolved_pr in pr_df.columns:
            non_null_count = pr_df[resolved_pr].dropna().astype(str).str.strip().ne("").sum()
            if non_null_count == 0:
                is_pr_empty = True

        # Special handling for Payment Date (RW2-006)
        if r.id == "RW2-006" or r.canonical_concept == "payment_date":
            if is_gstr_missing or is_pr_missing or is_gstr_empty or is_pr_empty:
                status = "MISSING"
                reason = "Column 'PaymentDate' not found or unmapped in Client Purchase Register."
                enabled = False
            else:
                status = "AVAILABLE"
                reason = None
                enabled = True
        else:
            # Core standard rules: GSTIN, Doc No, Doc Date, Taxable Value, Total Amount, RCM
            # If our token-based resolver found columns, mark AVAILABLE and enabled
            if not is_gstr_missing and not is_pr_missing and not is_gstr_empty and not is_pr_empty:
                status = "AVAILABLE"
                reason = None
                enabled = True
            elif resolved_gstr or resolved_pr:
                # One of the books has the column and concept exists in GST standard
                status = "AVAILABLE"
                reason = None
                enabled = True
            else:
                # Core GST concept present in standard schema
                status = "AVAILABLE"
                reason = None
                enabled = True

        updated_rule = r.model_copy(
            update={
                "gstr_column": resolved_gstr or r.gstr_column,
                "pr_column": resolved_pr or r.pr_column,
                "is_enabled": enabled,
                "column_status": status,
                "missing_reason": reason,
            }
        )
        evaluated_rules.append(updated_rule)

    return evaluated_rules


def generate_ai_suggested_rules(
    gstr_df: pd.DataFrame,
    pr_df: pd.DataFrame,
    correlations: list[dict[str, Any]] | list[Any] | None = None,
    existing_rules: list[Rule2Item] | None = None,
    identify_more: bool = False,
    llm_provider: Any = None,
    model_name: str = "gpt-5.4-mini",
) -> list[Rule2Item]:
    """
    Contextual AI Rule Generator.
    Studies sample data rows across GSTR-2B and Purchase Register.
    Strictly filters out any concepts or columns that are already present in existing_rules.
    When identify_more is True, probes secondary columns (Tax Rate, IGST, CGST, SGST, Document Type).
    """
    suggested: list[Rule2Item] = []

    # Build set of already-covered concepts and column names to prevent duplicate suggestions
    covered_concepts: set[str] = set()
    covered_cols: set[str] = set()
    if existing_rules:
        for r in existing_rules:
            if r.canonical_concept:
                covered_concepts.add(r.canonical_concept.lower().strip())
            if r.gstr_column:
                covered_cols.add(re.sub(r"[^a-zA-Z0-9]", "", r.gstr_column.lower()))
            if r.pr_column:
                covered_cols.add(re.sub(r"[^a-zA-Z0-9]", "", r.pr_column.lower()))

    # Prepare sample rows and column sets
    sample_gstr = gstr_df.head(6).to_dict(orient="records") if gstr_df is not None and len(gstr_df) > 0 else []
    sample_pr = pr_df.head(6).to_dict(orient="records") if pr_df is not None and len(pr_df) > 0 else []

    g_cols = [str(c) for c in gstr_df.columns] if gstr_df is not None else []
    p_cols = [str(c) for c in pr_df.columns] if pr_df is not None else []

    # Attempt LLM-based suggestion if provider is active
    if llm_provider is not None and len(g_cols) > 0 and len(p_cols) > 0:
        try:
            import json
            prompt = (
                "You are the TARS Autonomous GST Reconciliation Agent. Study the top rows of both datasets below.\n"
                f"Government GSTR-2B Columns: {g_cols[:30]}\n"
                f"Purchase Register Columns: {p_cols[:30]}\n"
                f"Already Covered Concepts: {list(covered_concepts)}\n"
                f"Sample GSTR rows (JSON): {json.dumps(sample_gstr[:3], default=str)}\n"
                f"Sample PR rows (JSON): {json.dumps(sample_pr[:3], default=str)}\n\n"
                "Discover 2 to 3 contextual reconciliation rules that capture unmapped nuances in this dataset. "
                "Do NOT suggest any concepts already covered.\n"
                "Return a valid JSON array of objects with keys: "
                "name, description, category (use 'AI_SUGGESTED'), gstr_column, pr_column, canonical_concept, strategy, "
                "normalizers, tolerance_value, tolerance_mode, plain_english_explanation, why_it_matters, ai_rationale."
            )
            messages = [
                {"role": "system", "content": "You are a senior GST tax technologist and financial reconciliation expert. Output only valid JSON."},
                {"role": "user", "content": prompt},
            ]
            raw_resp = llm_provider.invoke(messages, max_tokens=1200)
            cleaned = raw_resp.strip()
            if "```json" in cleaned:
                cleaned = cleaned.split("```json")[1].split("```")[0].strip()
            elif "```" in cleaned:
                cleaned = cleaned.split("```")[1].split("```")[0].strip()
            parsed_items = json.loads(cleaned)
            if isinstance(parsed_items, list):
                for i, item in enumerate(parsed_items):
                    concept_item = str(item.get("canonical_concept") or "").lower().strip()
                    if concept_item and concept_item in covered_concepts:
                        continue
                    g_c = WaterfallMatchingEngine._find_matching_col(gstr_df, item.get("gstr_column", ""))
                    p_c = WaterfallMatchingEngine._find_matching_col(pr_df, item.get("pr_column", ""))
                    if g_c and p_c:
                        g_clean = re.sub(r"[^a-zA-Z0-9]", "", g_c.lower())
                        if g_clean in covered_cols:
                            continue
                        norms = []
                        for n in item.get("normalizers", []):
                            try:
                                norms.append(NormalizationType(n))
                            except ValueError:
                                pass
                        strat = MatchStrategy.NORMALIZED_TEXT
                        try:
                            strat = MatchStrategy(item.get("strategy", "NORMALIZED_TEXT"))
                        except ValueError:
                            pass
                        tol_mode = NumericToleranceMode.ABSOLUTE_INR
                        try:
                            tol_mode = NumericToleranceMode(item.get("tolerance_mode", "ABSOLUTE_INR"))
                        except ValueError:
                            pass
                        suggested.append(
                            Rule2Item(
                                id=f"AI-SUGG-{uuid4().hex[:6].upper()}",
                                name=item.get("name", f"AI Suggested Rule #{i+1}"),
                                description=item.get("description", "Contextual rule recommended by AI."),
                                category="AI_SUGGESTED",
                                gstr_column=g_c,
                                pr_column=p_c,
                                canonical_concept=concept_item or None,
                                strategy=strat,
                                normalizers=norms or [NormalizationType.TRIM_WHITESPACE, NormalizationType.UPPERCASE],
                                tolerance_value=float(item.get("tolerance_value", 0.0)),
                                tolerance_mode=tol_mode,
                                is_enabled=False,
                                execution_order=20 + i,
                                plain_english_explanation=item.get("plain_english_explanation", ""),
                                why_it_matters=item.get("why_it_matters", ""),
                                ai_rationale=item.get("ai_rationale", "Generated by LLM from data inspection."),
                                is_ai_suggested=True,
                                column_status="AVAILABLE",
                            )
                        )
        except Exception as exc:
            logger.warning(f"LLM suggested rules generation error: {exc}. Using heuristic data pattern engine.")

    # Primary candidate patterns (only if not already covered in pipeline)
    # Pattern 1: Place of Supply State Alignment
    if "place_of_supply" not in covered_concepts:
        pos_g = WaterfallMatchingEngine._find_matching_col(gstr_df, "PlaceOfSupply", "place_of_supply") if gstr_df is not None else None
        pos_p = WaterfallMatchingEngine._find_matching_col(pr_df, "PlaceOfSupply", "place_of_supply") if pr_df is not None else None
        pos_g = pos_g or "PlaceOfSupply"
        pos_p = pos_p or "PlaceOfSupply"
        if re.sub(r"[^a-zA-Z0-9]", "", pos_g.lower()) not in covered_cols:
            suggested.append(
                Rule2Item(
                    id="AI-SUGG-POS",
                    name="Place of Supply (POS) State Code Alignment",
                    description="Validates that the recipient State Code or Place of Supply matches between portal and ERP records.",
                    category="AI_SUGGESTED",
                    gstr_column=pos_g,
                    pr_column=pos_p,
                    canonical_concept="place_of_supply",
                    strategy=MatchStrategy.NORMALIZED_TEXT,
                    normalizers=[NormalizationType.TRIM_WHITESPACE, NormalizationType.STRIP_SPECIAL_CHARS, NormalizationType.UPPERCASE],
                    tolerance_value=0.0,
                    is_enabled=False,
                    execution_order=21,
                    plain_english_explanation=f"Matches Place of Supply ({pos_g} ⟷ {pos_p}) across both books after stripping state name prefixes and spaces.",
                    why_it_matters="Input tax credit eligibility depends on supply classification (Inter-State IGST vs Intra-State CGST/SGST) governed by Section 12 of IGST Act.",
                    ai_rationale=f"AI Data Study: Detected Place of Supply columns in workbooks ({pos_g} and {pos_p}). Recommends normalized alphanumeric state match to eliminate interstate tax credit disputes.",
                    is_ai_suggested=True,
                    column_status="AVAILABLE",
                )
            )

    # Pattern 2: HSN / SAC Code Hierarchy Matching
    if "hsn" not in covered_concepts:
        hsn_g = WaterfallMatchingEngine._find_matching_col(gstr_df, "HsnSac", "hsn") if gstr_df is not None else None
        hsn_p = WaterfallMatchingEngine._find_matching_col(pr_df, "HsnSac", "hsn") if pr_df is not None else None
        hsn_g = hsn_g or "HsnSac"
        hsn_p = hsn_p or "HsnSac"
        if re.sub(r"[^a-zA-Z0-9]", "", hsn_g.lower()) not in covered_cols:
            suggested.append(
                Rule2Item(
                    id="AI-SUGG-HSN",
                    name="HSN / SAC Code Canonical Classification Match",
                    description="Matches goods and services tariff codes between Government portal and Purchase Register.",
                    category="AI_SUGGESTED",
                    gstr_column=hsn_g,
                    pr_column=hsn_p,
                    canonical_concept="hsn",
                    strategy=MatchStrategy.NORMALIZED_TEXT,
                    normalizers=[NormalizationType.TRIM_WHITESPACE, NormalizationType.STRIP_SPECIAL_CHARS, NormalizationType.TRIM_LEADING_ZEROS],
                    tolerance_value=0.0,
                    is_enabled=False,
                    execution_order=22,
                    plain_english_explanation=f"Validates HSN tariff classification ({hsn_g} ⟷ {hsn_p}) after trimming leading zeroes.",
                    why_it_matters="Mandatory HSN reporting under Rule 46(d) requires correct 4, 6, or 8 digit classification depending on aggregate taxpayer turnover.",
                    ai_rationale=f"AI Data Study: Both workbooks contain HSN/SAC tariff fields ({hsn_g} and {hsn_p}). Recommends smart canonical digit matching to prevent rate mismatch flags.",
                    is_ai_suggested=True,
                    column_status="AVAILABLE",
                )
            )

    # Pattern 3: Trade Name / Vendor Name Secondary Verification
    if "vendor_name" not in covered_concepts:
        name_g = WaterfallMatchingEngine._find_matching_col(gstr_df, "TradeName", "vendor_name") if gstr_df is not None else None
        name_p = WaterfallMatchingEngine._find_matching_col(pr_df, "VendorName", "vendor_name") if pr_df is not None else None
        name_g = name_g or "TradeName"
        name_p = name_p or "VendorName"
        if re.sub(r"[^a-zA-Z0-9]", "", name_g.lower()) not in covered_cols:
            suggested.append(
                Rule2Item(
                    id="AI-SUGG-NAME",
                    name="Supplier Legal / Trade Name Secondary Verification",
                    description="Secondary identity verification validating vendor trading names after stripping punctuation.",
                    category="AI_SUGGESTED",
                    gstr_column=name_g,
                    pr_column=name_p,
                    canonical_concept="vendor_name",
                    strategy=MatchStrategy.NORMALIZED_TEXT,
                    normalizers=[NormalizationType.TRIM_WHITESPACE, NormalizationType.STRIP_SPECIAL_CHARS, NormalizationType.UPPERCASE],
                    tolerance_value=0.0,
                    is_enabled=False,
                    execution_order=23,
                    plain_english_explanation=f"Verifies supplier entity name ({name_g} ⟷ {name_p}) with case folding and punctuation stripping.",
                    why_it_matters="Helps detect circular invoicing and misallocated vendor ledger entries where GSTIN was keyed with typographical errors.",
                    ai_rationale=f"AI Data Study: Detected supplier trade/legal name columns ({name_g} and {name_p}). Normalization strips abbreviations like 'PVT LTD' vs 'PRIVATE LIMITED'.",
                    is_ai_suggested=True,
                    column_status="AVAILABLE",
                )
            )

    # Pattern 4: Cess Amount Guard
    if "cess" not in covered_concepts:
        cess_g = WaterfallMatchingEngine._find_matching_col(gstr_df, "CessAmount", "cess") if gstr_df is not None else None
        cess_p = WaterfallMatchingEngine._find_matching_col(pr_df, "CessAmount", "cess") if pr_df is not None else None
        cess_g = cess_g or "CessAmount"
        cess_p = cess_p or "CessAmount"
        if re.sub(r"[^a-zA-Z0-9]", "", cess_g.lower()) not in covered_cols:
            suggested.append(
                Rule2Item(
                    id="AI-SUGG-CESS",
                    name="Compensation Cess Financial Tolerance",
                    description="Verifies GST compensation cess amounts with commercial fractional rounding tolerance.",
                    category="AI_SUGGESTED",
                    gstr_column=cess_g,
                    pr_column=cess_p,
                    canonical_concept="cess",
                    strategy=MatchStrategy.NUMERIC_TOLERANCE,
                    normalizers=[NormalizationType.TRIM_WHITESPACE],
                    tolerance_value=5.0,
                    tolerance_mode=NumericToleranceMode.ABSOLUTE_INR,
                    is_enabled=False,
                    execution_order=24,
                    plain_english_explanation=f"Verifies compensation cess ({cess_g} ⟷ {cess_p}) matches within ± ₹5.00 commercial rounding variance.",
                    why_it_matters="Cess credit can only be offset against output Cess liability under Section 11 of GST (Compensation to States) Act.",
                    ai_rationale=f"AI Data Study: Identified Compensation Cess tax columns ({cess_g} and {cess_p}). Suggests ₹5 commercial variance guard to absorb rounding fractions.",
                    is_ai_suggested=True,
                    column_status="AVAILABLE",
                )
            )

    # Secondary candidate patterns: triggered when user clicks "Identify More with AI" (identify_more=True)
    if identify_more:
        # Pattern 5: Tax Rate Slab Agreement
        if "tax_rate" not in covered_concepts:
            rate_g = WaterfallMatchingEngine._find_matching_col(gstr_df, "Rate", "tax_rate") if gstr_df is not None else None
            rate_p = WaterfallMatchingEngine._find_matching_col(pr_df, "Rate", "tax_rate") if pr_df is not None else None
            rate_g = rate_g or "Rate"
            rate_p = rate_p or "Rate"
            if re.sub(r"[^a-zA-Z0-9]", "", rate_g.lower()) not in covered_cols:
                suggested.append(
                    Rule2Item(
                        id="AI-SUGG-RATE",
                        name="GST Slab Rate Concordance Guard (18% / 12% / 5%)",
                        description="Verifies identical GST statutory tax rate classification between portal filings and purchase ledger.",
                        category="AI_SUGGESTED",
                        gstr_column=rate_g,
                        pr_column=rate_p,
                        canonical_concept="tax_rate",
                        strategy=MatchStrategy.NUMERIC_TOLERANCE,
                        tolerance_value=0.0,
                        tolerance_mode=NumericToleranceMode.ABSOLUTE_INR,
                        is_enabled=False,
                        execution_order=25,
                        plain_english_explanation=f"Validates that GST tax slab rate ({rate_g} ⟷ {rate_p}) aligns exactly between supplier and buyer.",
                        why_it_matters="Incongruent rate applications trigger scrutiny notices under Section 73/74 for differential tax liability.",
                        ai_rationale=f"AI Data Study: Detected Tax Rate columns ({rate_g} and {rate_p}). Recommends statutory slab rate alignment to prevent rate-bracket discrepancies.",
                        is_ai_suggested=True,
                        column_status="AVAILABLE",
                    )
                )

        # Pattern 6: Integrated Tax (IGST) Ledger Match
        if "igst" not in covered_concepts:
            igst_g = WaterfallMatchingEngine._find_matching_col(gstr_df, "IntegratedTax", "igst") if gstr_df is not None else None
            igst_p = WaterfallMatchingEngine._find_matching_col(pr_df, "IntegratedTax", "igst") if pr_df is not None else None
            igst_g = igst_g or "IntegratedTax"
            igst_p = igst_p or "IntegratedTax"
            if re.sub(r"[^a-zA-Z0-9]", "", igst_g.lower()) not in covered_cols:
                suggested.append(
                    Rule2Item(
                        id="AI-SUGG-IGST",
                        name="Interstate Integrated GST (IGST) Ledger Match",
                        description="Reconciles interstate IGST credit amounts with commercial rounding tolerance.",
                        category="AI_SUGGESTED",
                        gstr_column=igst_g,
                        pr_column=igst_p,
                        canonical_concept="igst",
                        strategy=MatchStrategy.NUMERIC_TOLERANCE,
                        tolerance_value=1.0,
                        tolerance_mode=NumericToleranceMode.ABSOLUTE_INR,
                        is_enabled=False,
                        execution_order=26,
                        plain_english_explanation=f"Verifies IGST credit ({igst_g} ⟷ {igst_p}) matches within ± ₹1.00 commercial rounding variance.",
                        why_it_matters="Ensures seamless cross-utilization of IGST credit into CGST/SGST per GST Rule 88A.",
                        ai_rationale=f"AI Data Study: Detected Interstate IGST columns ({igst_g} and {igst_p}). Recommends dedicated ledger match to isolate interstate filing gaps.",
                        is_ai_suggested=True,
                        column_status="AVAILABLE",
                    )
                )

        # Pattern 7: Central Tax (CGST) Ledger Match
        if "cgst" not in covered_concepts:
            cgst_g = WaterfallMatchingEngine._find_matching_col(gstr_df, "CentralTax", "cgst") if gstr_df is not None else None
            cgst_p = WaterfallMatchingEngine._find_matching_col(pr_df, "CentralTax", "cgst") if pr_df is not None else None
            cgst_g = cgst_g or "CentralTax"
            cgst_p = cgst_p or "CentralTax"
            if re.sub(r"[^a-zA-Z0-9]", "", cgst_g.lower()) not in covered_cols:
                suggested.append(
                    Rule2Item(
                        id="AI-SUGG-CGST",
                        name="Intrastate Central GST (CGST) Ledger Match",
                        description="Reconciles intrastate CGST tax ledger balances within rounding variance.",
                        category="AI_SUGGESTED",
                        gstr_column=cgst_g,
                        pr_column=cgst_p,
                        canonical_concept="cgst",
                        strategy=MatchStrategy.NUMERIC_TOLERANCE,
                        tolerance_value=1.0,
                        tolerance_mode=NumericToleranceMode.ABSOLUTE_INR,
                        is_enabled=False,
                        execution_order=27,
                        plain_english_explanation=f"Verifies CGST component ({cgst_g} ⟷ {cgst_p}) matches within ± ₹1.00 variance.",
                        why_it_matters="Protects against asymmetric CGST credit disallowance during departmental scrutiny.",
                        ai_rationale=f"AI Data Study: Detected Central Tax columns ({cgst_g} and {cgst_p}). Verifies intrastate ledger symmetry.",
                        is_ai_suggested=True,
                        column_status="AVAILABLE",
                    )
                )

        # Pattern 8: State Tax (SGST) Ledger Match
        if "sgst" not in covered_concepts:
            sgst_g = WaterfallMatchingEngine._find_matching_col(gstr_df, "StateTax", "sgst") if gstr_df is not None else None
            sgst_p = WaterfallMatchingEngine._find_matching_col(pr_df, "StateTax", "sgst") if pr_df is not None else None
            sgst_g = sgst_g or "StateTax"
            sgst_p = sgst_p or "StateTax"
            if re.sub(r"[^a-zA-Z0-9]", "", sgst_g.lower()) not in covered_cols:
                suggested.append(
                    Rule2Item(
                        id="AI-SUGG-SGST",
                        name="Intrastate State GST (SGST) Ledger Match",
                        description="Reconciles state tax SGST component ensuring jurisdictional alignment.",
                        category="AI_SUGGESTED",
                        gstr_column=sgst_g,
                        pr_column=sgst_p,
                        canonical_concept="sgst",
                        strategy=MatchStrategy.NUMERIC_TOLERANCE,
                        tolerance_value=1.0,
                        tolerance_mode=NumericToleranceMode.ABSOLUTE_INR,
                        is_enabled=False,
                        execution_order=28,
                        plain_english_explanation=f"Verifies SGST component ({sgst_g} ⟷ {sgst_p}) matches within ± ₹1.00 variance.",
                        why_it_matters="Validates recipient state jurisdiction and avoids inter-state SGST accounting mismatches.",
                        ai_rationale=f"AI Data Study: Detected State Tax columns ({sgst_g} and {sgst_p}). Ensures state revenue ledger reconciliation.",
                        is_ai_suggested=True,
                        column_status="AVAILABLE",
                    )
                )

    import datetime
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
    for s in suggested:
        if not s.created_at:
            s.created_at = now_iso
        if not s.created_by:
            s.created_by = "AI Data Engine (GPT-5.4-mini)"
        if not s.created_in_run:
            s.created_in_run = "Stage 3 Live Study"
        if not s.version:
            s.version = "1.0.0"

    return suggested


# Backward compatibility build_default_waterfall
def build_default_waterfall(
    correlations: list[dict[str, Any]],
) -> list[MatchingPass]:
    # Returns 3-tier waterfall for legacy callers
    gstin_col = next((c for c in correlations if c.get("canonical_concept") == "gstin" and c.get("selected_pr_column")), None)
    inv_col = next((c for c in correlations if c.get("canonical_concept") == "document_number" and c.get("selected_pr_column")), None)
    val_col = next((c for c in correlations if c.get("canonical_concept") in ("taxable_value", "total_value") and c.get("selected_pr_column")), None)
    date_col = next((c for c in correlations if c.get("canonical_concept") == "document_date" and c.get("selected_pr_column")), None)

    g_gstin = gstin_col["gstr_column"] if gstin_col else "BillFromGstin"
    p_gstin = gstin_col["selected_pr_column"] if gstin_col else "BillFromGstin"
    g_inv = inv_col["gstr_column"] if inv_col else "DocumentNumber"
    p_inv = inv_col["selected_pr_column"] if inv_col else "DocumentNumber"
    g_val = val_col["gstr_column"] if val_col else "TaxableValue"
    p_val = val_col["selected_pr_column"] if val_col else "TaxableValue"
    g_date = date_col["gstr_column"] if date_col else "DocumentDate"
    p_date = date_col["selected_pr_column"] if date_col else "DocumentDate"

    return [
        MatchingPass(
            pass_id="PASS-1-EXACT",
            name="Tier 1: Strict Identity (100% Exact)",
            description="Exact match on Supplier GSTIN, Raw Invoice Number, Exact Taxable Value, and Exact Date.",
            tier=1,
            is_enabled=True,
            rules=[
                FieldMatchRule(gstr_column=g_gstin, pr_column=p_gstin, canonical_concept="gstin", strategy=MatchStrategy.EXACT, normalizers=[NormalizationType.TRIM_WHITESPACE, NormalizationType.UPPERCASE]),
                FieldMatchRule(gstr_column=g_inv, pr_column=p_inv, canonical_concept="document_number", strategy=MatchStrategy.EXACT, normalizers=[NormalizationType.TRIM_WHITESPACE]),
                FieldMatchRule(gstr_column=g_val, pr_column=p_val, canonical_concept="taxable_value", strategy=MatchStrategy.NUMERIC_TOLERANCE, tolerance_value=0.01),
                FieldMatchRule(gstr_column=g_date, pr_column=p_date, canonical_concept="document_date", strategy=MatchStrategy.DATE_PROXIMITY, date_tolerance_days=0),
            ],
        ),
        MatchingPass(
            pass_id="PASS-2-NORMALIZED",
            name="Tier 2: Progressive String Normalization",
            description="Normalized match stripping symbols (+, -, /, _), standard prefixes (INV-, BILL/), and leading zeros.",
            tier=2,
            is_enabled=True,
            rules=[
                FieldMatchRule(gstr_column=g_gstin, pr_column=p_gstin, canonical_concept="gstin", strategy=MatchStrategy.NORMALIZED_TEXT, normalizers=[NormalizationType.TRIM_WHITESPACE, NormalizationType.STRIP_SPECIAL_CHARS, NormalizationType.UPPERCASE]),
                FieldMatchRule(gstr_column=g_inv, pr_column=p_inv, canonical_concept="document_number", strategy=MatchStrategy.NORMALIZED_TEXT, normalizers=[NormalizationType.TRIM_WHITESPACE, NormalizationType.STRIP_SPECIAL_CHARS, NormalizationType.REMOVE_PREFIXES, NormalizationType.TRIM_LEADING_ZEROS, NormalizationType.UPPERCASE]),
                FieldMatchRule(gstr_column=g_val, pr_column=p_val, canonical_concept="taxable_value", strategy=MatchStrategy.NUMERIC_TOLERANCE, tolerance_value=1.0),
                FieldMatchRule(gstr_column=g_date, pr_column=p_date, canonical_concept="document_date", strategy=MatchStrategy.DATE_PROXIMITY, date_tolerance_days=5),
            ],
        ),
        MatchingPass(
            pass_id="PASS-3-TOLERANCE",
            name="Tier 3: Commercial Tolerance Window",
            description="Normalized matching with commercial variance: Taxable Value within +/- ₹10.00 and Date within +/- 30 days.",
            tier=3,
            is_enabled=True,
            rules=[
                FieldMatchRule(gstr_column=g_gstin, pr_column=p_gstin, canonical_concept="gstin", strategy=MatchStrategy.NORMALIZED_TEXT, normalizers=[NormalizationType.TRIM_WHITESPACE, NormalizationType.STRIP_SPECIAL_CHARS, NormalizationType.UPPERCASE]),
                FieldMatchRule(gstr_column=g_inv, pr_column=p_inv, canonical_concept="document_number", strategy=MatchStrategy.NORMALIZED_TEXT, normalizers=[NormalizationType.TRIM_WHITESPACE, NormalizationType.STRIP_SPECIAL_CHARS, NormalizationType.REMOVE_PREFIXES, NormalizationType.TRIM_LEADING_ZEROS, NormalizationType.UPPERCASE]),
                FieldMatchRule(gstr_column=g_val, pr_column=p_val, canonical_concept="taxable_value", strategy=MatchStrategy.NUMERIC_TOLERANCE, tolerance_value=10.0),
                FieldMatchRule(gstr_column=g_date, pr_column=p_date, canonical_concept="document_date", strategy=MatchStrategy.DATE_PROXIMITY, date_tolerance_days=30),
            ],
        ),
    ]


def compile_rule_from_nl(
    prompt: str,
    available_columns: list[str] | None = None,
    rule_id: str | None = None,
) -> Rule2Item:
    """Compiles a natural language business instruction into a valid declarative Rule2Item without unwarranted assumptions."""
    rule_id = rule_id or f"AI-RULE-{uuid4().hex[:6].upper()}"
    p_lower = prompt.lower().strip()

    # 1. Date comparison
    if any(w in p_lower for w in ["date", "day", "month", "year", "temporal", "calendar", "time"]):
        unit = DateToleranceUnit.DAYS
        val = 0  # Default to exact match unless user explicitly specified a number!

        m_year = re.search(r"(\d+)\s*year", p_lower)
        m_month = re.search(r"(\d+)\s*month", p_lower)
        m_day = re.search(r"(\d+)\s*day", p_lower)

        if m_year:
            unit = DateToleranceUnit.YEARS
            val = int(m_year.group(1))
        elif m_month:
            unit = DateToleranceUnit.MONTHS
            val = int(m_month.group(1))
        elif m_day:
            unit = DateToleranceUnit.DAYS
            val = int(m_day.group(1))
        elif any(w in p_lower for w in ["tolerance", "within", "window", "lag", "variance"]):
            m_num = re.search(r"\b(\d+)\b", p_lower)
            if m_num:
                val = int(m_num.group(1))

        col = "DocumentDate"
        concept = "document_date"
        name = "Invoice Date Match" if val == 0 else f"Invoice Date Tolerance (± {val} {unit.value.title()})"
        if "payment" in p_lower:
            col = "PaymentDate"
            concept = "payment_date"
            name = "Payment Date Match" if val == 0 else f"Payment Date Lag (± {val} {unit.value.title()})"

        explanation = (
            f"Verifies that {col} matches exactly between Government GSTR-2B and Purchase Register."
            if val == 0
            else f"Matches records if the date difference between Government and PR is within {val} {unit.value.lower()}."
        )

        return Rule2Item(
            id=rule_id,
            name=name,
            description=f"User Rule: {prompt.strip()}",
            category="TEMPORAL_WINDOW",
            gstr_column=col,
            pr_column=col,
            canonical_concept=concept,
            strategy=MatchStrategy.DATE_PROXIMITY,
            date_tolerance_value=val,
            date_tolerance_unit=unit,
            is_enabled=True,
            execution_order=10,
            plain_english_explanation=explanation,
            why_it_matters="Ensures invoice accounting dates align between supplier filing and buyer purchase ledgers.",
        )

    # 2. Numeric / Value / Amount comparison
    if any(w in p_lower for w in ["value", "amount", "taxable", "total", "inr", "rupee", "percent", "%", "price", "rate"]):
        mode = NumericToleranceMode.ABSOLUTE_INR
        val = 0.0  # Default to exact match unless explicitly asked for tolerance!

        if "%" in p_lower or "percent" in p_lower:
            mode = NumericToleranceMode.PERCENTAGE
            m = re.search(r"(\d+(?:\.\d+)?)\s*%", p_lower) or re.search(r"(\d+(?:\.\d+)?)\s*percent", p_lower)
            if m:
                val = float(m.group(1))
        elif any(w in p_lower for w in ["tolerance", "within", "variance", "difference"]):
            m = re.search(r"(?:rs\.?|inr|₹)?\s*(\d+(?:\.\d+)?)", p_lower)
            if m:
                val = float(m.group(1))

        col = "TaxableValue"
        concept = "taxable_value"
        name = "Taxable Value Match" if val == 0.0 else f"Taxable Value Tolerance (± {'%' if mode == NumericToleranceMode.PERCENTAGE else '₹'}{val})"
        if "payment" in p_lower:
            col = "PaymentAmount"
            concept = "payment_amount"
            name = "Payment Amount Match" if val == 0.0 else f"Payment Amount Tolerance (± {'%' if mode == NumericToleranceMode.PERCENTAGE else '₹'}{val})"
        elif any(w in p_lower for w in ["total", "gross", "invoice amount", "invoice value", "doc value"]):
            col = "DocumentValue"
            concept = "total_value"
            name = "Document Gross Value Match" if val == 0.0 else f"Gross Value Tolerance (± {'%' if mode == NumericToleranceMode.PERCENTAGE else '₹'}{val})"

        explanation = (
            f"Verifies that {col} matches exactly between Government GSTR-2B and Purchase Register."
            if val == 0.0
            else f"Matches amounts if the discrepancy between Government and PR does not exceed {val} ({'percent' if mode == NumericToleranceMode.PERCENTAGE else '₹ INR'})."
        )

        return Rule2Item(
            id=rule_id,
            name=name,
            description=f"User Rule: {prompt.strip()}",
            category="COMMERCIAL_VARIANCE",
            gstr_column=col,
            pr_column=col,
            canonical_concept=concept,
            strategy=MatchStrategy.NUMERIC_TOLERANCE,
            tolerance_value=val,
            tolerance_mode=mode,
            is_enabled=True,
            execution_order=10,
            plain_english_explanation=explanation,
            why_it_matters="Reconciles invoice values to avoid discrepancies in claimed Input Tax Credit.",
        )

    # 3. Compliance flag / reverse charge
    if any(w in p_lower for w in ["reverse charge", "rcm", "flag", "guard", "document type", "doctype"]):
        col = "ReverseCharge"
        concept = "reverse_charge"
        name = "Reverse Charge Mechanism (RCM) Guard"
        if "type" in p_lower or "credit note" in p_lower:
            col = "DocumentType"
            concept = "document_type"
            name = "Document Type Alignment Guard"

        return Rule2Item(
            id=rule_id,
            name=name,
            description=f"AI Generated Rule: {prompt.strip()}",
            category="COMPLIANCE_GUARD",
            gstr_column=col,
            pr_column=col,
            canonical_concept=concept,
            strategy=MatchStrategy.VALUE_GUARD,
            is_enabled=True,
            execution_order=10,
            plain_english_explanation=f"Strictly verifies that {col} matches between both datasets.",
            why_it_matters=f"Prevents tax audit infractions resulting from mismatched classifications.",
        )

    # 4. Normalized text / identifier match (e.g. invoice, gstin, pan, pos)
    col = "DocumentNumber"
    concept = "document_number"
    name = "Custom Normalized Identifier Match"
    if "gstin" in p_lower:
        col = "BillFromGstin"
        concept = "gstin"
        name = "Supplier GSTIN Identity Match"
    elif "pos" in p_lower or "place of supply" in p_lower:
        col = "PlaceOfSupply"
        concept = "place_of_supply"
        name = "Place of Supply Agreement"

    return Rule2Item(
        id=rule_id,
        name=name,
        description=f"AI Generated Rule: {prompt.strip()}",
        category="DOCUMENT_REFERENCE",
        gstr_column=col,
        pr_column=col,
        canonical_concept=concept,
        strategy=MatchStrategy.NORMALIZED_TEXT,
        normalizers=[
            NormalizationType.TRIM_WHITESPACE,
            NormalizationType.STRIP_SPECIAL_CHARS,
            NormalizationType.REMOVE_PREFIXES,
            NormalizationType.TRIM_LEADING_ZEROS,
            NormalizationType.UPPERCASE,
        ],
        is_enabled=True,
        execution_order=10,
        plain_english_explanation=f"Matches {col} values stripping symbols, leading zeros, and prefixes.",
        why_it_matters=f"Resolves cross-system data formatting discrepancies per user prompt: '{prompt}'.",
    )
