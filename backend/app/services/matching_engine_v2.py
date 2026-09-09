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

    @staticmethod
    def _find_matching_col(df: pd.DataFrame, target: str, concept: str | None = None) -> str | None:
        if target in df.columns:
            return target
        clean_target = re.sub(r"[^a-zA-Z0-9]", "", target.lower())
        for col in df.columns:
            clean_col = re.sub(r"[^a-zA-Z0-9]", "", col.lower())
            if clean_target == clean_col:
                return col
        if concept:
            clean_concept = re.sub(r"[^a-zA-Z0-9]", "", concept.lower())
            for col in df.columns:
                clean_col = re.sub(r"[^a-zA-Z0-9]", "", col.lower())
                if clean_concept in clean_col or clean_col in clean_concept:
                    return col
        for col in df.columns:
            clean_col = re.sub(r"[^a-zA-Z0-9]", "", col.lower())
            if clean_target in clean_col or clean_col in clean_target:
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
            is_enabled=True,
            execution_order=7,
            plain_english_explanation="Verifies that if an invoice is marked as Reverse Charge ('Y') in Government GSTR-2B, it is also flagged as Reverse Charge in your ERP.",
            why_it_matters="Mismatched RCM flags lead to erroneous cash tax liability payments under GSTR-3B Table 3.1(d).",
        ),
    ]

    return rules


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
        if any(w in p_lower for w in ["total", "gross", "invoice amount", "invoice value", "doc value"]):
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
