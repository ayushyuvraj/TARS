from __future__ import annotations

import logging
import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from enum import Enum
from typing import Any, Hashable

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


class FieldMatchRule(BaseModel):
    rule_id: str = Field(default_factory=lambda: f"RUL-{re.sub(r'[^a-zA-Z0-9]', '', str(pd.Timestamp.now().timestamp()))[-6:]}")
    gstr_column: str
    pr_column: str
    canonical_concept: str | None = None  # e.g., 'gstin', 'document_number', 'taxable_value', 'document_date'
    strategy: MatchStrategy = MatchStrategy.EXACT
    normalizers: list[NormalizationType] = Field(default_factory=list)
    tolerance_value: float = 0.0  # e.g., +/- 10.00 INR
    date_tolerance_days: int = 0  # e.g., +/- 30 days
    is_active: bool = True


class MatchingPass(BaseModel):
    pass_id: str
    name: str
    description: str
    tier: int
    is_enabled: bool = True
    rules: list[FieldMatchRule] = Field(default_factory=list)


class SampleMatchPair(BaseModel):
    gstr_row_index: int
    pr_row_index: int
    gstr_preview: dict[str, Any]
    pr_preview: dict[str, Any]
    matched_by_pass: str
    normalized_values: dict[str, str] = Field(default_factory=dict)


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

    # Common invoice prefix patterns
    PREFIX_REGEX = re.compile(r"^(INV[-_ /:]*|BILL[-_ /:]*|TAX[-_ /:]*|GST[-_ /:]*|REF[-_ /:]*|DN[-_ /:]*|CN[-_ /:]*)+", re.IGNORECASE)
    # Special character stripping regex
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
                # e.g., '000123' -> '123' (keeping single '0' if all zeroes)
                text = text.lstrip("0") or "0"

        text = text.strip()
        return text if text else None

    @classmethod
    def parse_decimal(cls, value: Any) -> Decimal | None:
        if value is None or pd.isna(value):
            return None
        try:
            # Clean possible currency symbols, commas or whitespace
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
    """Progressive waterfall matching engine for GSTR-2B vs Purchase Register."""

    def __init__(self, normalizer: type[ValueNormalizer] = ValueNormalizer):
        self.normalizer = normalizer

    def simulate(
        self,
        gstr_df: pd.DataFrame,
        pr_df: pd.DataFrame,
        waterfall_passes: list[MatchingPass],
    ) -> SimulationResult:
        total_gstr = len(gstr_df)
        total_pr = len(pr_df)

        unmatched_gstr_indices = set(range(total_gstr))
        unmatched_pr_indices = set(range(total_pr))

        waterfall_yields: list[SimulationYield] = []
        cumulative_matched = 0

        # Run through enabled passes in sequential waterfall order
        for m_pass in waterfall_passes:
            if not m_pass.is_enabled:
                continue

            pass_matches: list[tuple[int, int, dict[str, str]]] = self._run_pass(
                gstr_df=gstr_df,
                pr_df=pr_df,
                gstr_indices=unmatched_gstr_indices,
                pr_indices=unmatched_pr_indices,
                rules=m_pass.rules,
            )

            matched_count = len(pass_matches)
            cumulative_matched += matched_count

            # Extract sample matched rows for auditing preview
            sample_pairs: list[SampleMatchPair] = []
            for g_idx, p_idx, norm_meta in pass_matches[:8]:  # Up to 8 visual inspection samples
                sample_pairs.append(
                    SampleMatchPair(
                        gstr_row_index=g_idx,
                        pr_row_index=p_idx,
                        gstr_preview={col: str(gstr_df.iloc[g_idx][col]) for col in gstr_df.columns[:8] if not pd.isna(gstr_df.iloc[g_idx][col])},
                        pr_preview={col: str(pr_df.iloc[p_idx][col]) for col in pr_df.columns[:8] if not pd.isna(pr_df.iloc[p_idx][col])},
                        matched_by_pass=m_pass.name,
                        normalized_values=norm_meta,
                    )
                )

            # Retire matched rows from subsequent passes
            for g_idx, p_idx, _ in pass_matches:
                unmatched_gstr_indices.discard(g_idx)
                unmatched_pr_indices.discard(p_idx)

            pct = (matched_count / total_gstr * 100.0) if total_gstr > 0 else 0.0
            waterfall_yields.append(
                SimulationYield(
                    pass_id=m_pass.pass_id,
                    pass_name=m_pass.name,
                    tier=m_pass.tier,
                    matched_count=matched_count,
                    cumulative_matched=cumulative_matched,
                    pass_match_percentage=round(pct, 2),
                    sample_matches=sample_pairs,
                )
            )

        overall_pct = (cumulative_matched / total_gstr * 100.0) if total_gstr > 0 else 0.0

        return SimulationResult(
            total_gstr_rows=total_gstr,
            total_pr_rows=total_pr,
            total_matched=cumulative_matched,
            total_unmatched_gstr=len(unmatched_gstr_indices),
            total_unmatched_pr=len(unmatched_pr_indices),
            overall_match_rate=round(overall_pct, 2),
            waterfall=waterfall_yields,
        )

    @staticmethod
    def _find_matching_col(df: pd.DataFrame, target: str, concept: str | None = None) -> str | None:
        if target in df.columns:
            return target
        clean_target = re.sub(r"[^a-zA-Z0-9]", "", target.lower())
        for col in df.columns:
            clean_col = re.sub(r"[^a-zA-Z0-9]", "", col.lower())
            if clean_target == clean_col:
                return col
        # Check concept tokens
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

    def _run_pass(
        self,
        gstr_df: pd.DataFrame,
        pr_df: pd.DataFrame,
        gstr_indices: set[int],
        pr_indices: set[int],
        rules: list[FieldMatchRule],
    ) -> list[tuple[int, int, dict[str, str]]]:
        """Execute a single pass over unmatched rows."""
        active_rules = [r for r in rules if r.is_active]
        if not active_rules or not gstr_indices or not pr_indices:
            return []

        # Resolve column names against actual DataFrames
        resolved_rules: list[FieldMatchRule] = []
        for r in active_rules:
            g_col = self._find_matching_col(gstr_df, r.gstr_column, r.canonical_concept) or r.gstr_column
            p_col = self._find_matching_col(pr_df, r.pr_column, r.canonical_concept) or r.pr_column
            resolved_rules.append(
                r.model_copy(update={"gstr_column": g_col, "pr_column": p_col})
            )

        # Split rules into exact/normalized text keys (hashable for fast indexing) vs tolerance rules
        index_rules: list[FieldMatchRule] = []
        tolerance_rules: list[FieldMatchRule] = []

        for r in resolved_rules:
            if r.strategy in (MatchStrategy.EXACT, MatchStrategy.NORMALIZED_TEXT):
                index_rules.append(r)
            else:
                tolerance_rules.append(r)

        # Build indexed hash lookup for PR rows
        pr_index: dict[tuple[Hashable, ...], list[int]] = {}
        pr_norm_cache: dict[int, dict[str, str]] = {}

        for p_idx in pr_indices:
            p_row = pr_df.iloc[p_idx]
            keys: list[Hashable] = []
            norm_meta: dict[str, str] = {}
            valid = True

            for r in index_rules:
                val = p_row.get(r.pr_column)
                norm_val = self.normalizer.normalize_text(val, r.normalizers)
                if norm_val is None:
                    valid = False
                    break
                keys.append(norm_val)
                norm_meta[f"PR:{r.pr_column}"] = norm_val

            if valid:
                k = tuple(keys)
                pr_index.setdefault(k, []).append(p_idx)
                pr_norm_cache[p_idx] = norm_meta

        matches: list[tuple[int, int, dict[str, str]]] = []
        claimed_pr: set[int] = set()

        # Iterate over GSTR candidate rows
        for g_idx in sorted(gstr_indices):
            g_row = gstr_df.iloc[g_idx]
            g_keys: list[Hashable] = []
            norm_meta: dict[str, str] = {}
            valid = True

            for r in index_rules:
                val = g_row.get(r.gstr_column)
                norm_val = self.normalizer.normalize_text(val, r.normalizers)
                if norm_val is None:
                    valid = False
                    break
                g_keys.append(norm_val)
                norm_meta[f"Gov:{r.gstr_column}"] = norm_val

            if not valid:
                continue

            # Lookup candidates in PR
            candidate_pr_indices = pr_index.get(tuple(g_keys), [])
            for p_idx in candidate_pr_indices:
                if p_idx in claimed_pr:
                    continue

                # Now verify tolerance rules (Numeric / Date / Guard)
                p_row = pr_df.iloc[p_idx]
                passed_tolerances = True

                for r in tolerance_rules:
                    if r.strategy == MatchStrategy.NUMERIC_TOLERANCE:
                        g_num = self.normalizer.parse_decimal(g_row.get(r.gstr_column))
                        p_num = self.normalizer.parse_decimal(p_row.get(r.pr_column))
                        if g_num is None or p_num is None:
                            passed_tolerances = False
                            break
                        diff = abs(float(g_num - p_num))
                        if diff > (r.tolerance_value + 1e-4):
                            passed_tolerances = False
                            break
                        norm_meta[f"Diff:{r.gstr_column}"] = f"{diff:.2f}"

                    elif r.strategy == MatchStrategy.DATE_PROXIMITY:
                        g_dt = self.normalizer.parse_date(g_row.get(r.gstr_column))
                        p_dt = self.normalizer.parse_date(p_row.get(r.pr_column))
                        if g_dt is None or p_dt is None:
                            passed_tolerances = False
                            break
                        diff_days = abs((g_dt - p_dt).days)
                        if diff_days > r.date_tolerance_days:
                            passed_tolerances = False
                            break
                        norm_meta[f"DateDelta:{r.gstr_column}"] = f"{diff_days}d"

                if passed_tolerances:
                    claimed_pr.add(p_idx)
                    all_meta = {**norm_meta, **pr_norm_cache.get(p_idx, {})}
                    matches.append((g_idx, p_idx, all_meta))
                    break  # Claim 1-to-1 match

        return matches


def build_default_waterfall(
    correlations: list[dict[str, Any]],
) -> list[MatchingPass]:
    """Generates the recommended 3-tier GST reconciliation waterfall based on confirmed column mappings."""
    # Find primary columns
    gstin_col = next((c for c in correlations if c.get("canonical_concept") == "gstin" and c.get("selected_pr_column")), None)
    inv_col = next((c for c in correlations if c.get("canonical_concept") == "document_number" and c.get("selected_pr_column")), None)
    val_col = next((c for c in correlations if c.get("canonical_concept") in ("taxable_value", "total_value") and c.get("selected_pr_column")), None)
    date_col = next((c for c in correlations if c.get("canonical_concept") == "document_date" and c.get("selected_pr_column")), None)

    # Fallback to names if concept missing
    if not gstin_col:
        gstin_col = next((c for c in correlations if "gstin" in str(c.get("gstr_column", "")).lower() and c.get("selected_pr_column")), None)
    if not inv_col:
        inv_col = next((c for c in correlations if ("inv" in str(c.get("gstr_column", "")).lower() or "bill" in str(c.get("gstr_column", "")).lower()) and c.get("selected_pr_column")), None)
    if not val_col:
        val_col = next((c for c in correlations if ("value" in str(c.get("gstr_column", "")).lower() or "amount" in str(c.get("gstr_column", "")).lower() or "taxable" in str(c.get("gstr_column", "")).lower()) and c.get("selected_pr_column")), None)
    if not date_col:
        date_col = next((c for c in correlations if "date" in str(c.get("gstr_column", "")).lower() and c.get("selected_pr_column")), None)

    passes: list[MatchingPass] = []

    # TIER 1: STRICT 100% EXACT MATCH
    tier1_rules: list[FieldMatchRule] = []
    if gstin_col:
        tier1_rules.append(
            FieldMatchRule(
                gstr_column=gstin_col["gstr_column"],
                pr_column=gstin_col["selected_pr_column"],
                canonical_concept="gstin",
                strategy=MatchStrategy.EXACT,
                normalizers=[NormalizationType.TRIM_WHITESPACE, NormalizationType.UPPERCASE],
            )
        )
    if inv_col:
        tier1_rules.append(
            FieldMatchRule(
                gstr_column=inv_col["gstr_column"],
                pr_column=inv_col["selected_pr_column"],
                canonical_concept="document_number",
                strategy=MatchStrategy.EXACT,
                normalizers=[NormalizationType.TRIM_WHITESPACE],
            )
        )
    if val_col:
        tier1_rules.append(
            FieldMatchRule(
                gstr_column=val_col["gstr_column"],
                pr_column=val_col["selected_pr_column"],
                canonical_concept="taxable_value",
                strategy=MatchStrategy.NUMERIC_TOLERANCE,
                tolerance_value=0.01,
            )
        )
    if date_col:
        tier1_rules.append(
            FieldMatchRule(
                gstr_column=date_col["gstr_column"],
                pr_column=date_col["selected_pr_column"],
                canonical_concept="document_date",
                strategy=MatchStrategy.DATE_PROXIMITY,
                date_tolerance_days=0,
            )
        )

    passes.append(
        MatchingPass(
            pass_id="PASS-1-EXACT",
            name="Tier 1: Strict Identity (100% Exact)",
            description="Exact match on Supplier GSTIN, Raw Invoice Number, Exact Taxable Value, and Exact Date.",
            tier=1,
            is_enabled=True,
            rules=tier1_rules,
        )
    )

    # TIER 2: PROGRESSIVE NORMALIZATION (Special characters + prefixes + leading zeroes)
    tier2_rules: list[FieldMatchRule] = []
    if gstin_col:
        tier2_rules.append(
            FieldMatchRule(
                gstr_column=gstin_col["gstr_column"],
                pr_column=gstin_col["selected_pr_column"],
                canonical_concept="gstin",
                strategy=MatchStrategy.NORMALIZED_TEXT,
                normalizers=[NormalizationType.TRIM_WHITESPACE, NormalizationType.STRIP_SPECIAL_CHARS, NormalizationType.UPPERCASE],
            )
        )
    if inv_col:
        tier2_rules.append(
            FieldMatchRule(
                gstr_column=inv_col["gstr_column"],
                pr_column=inv_col["selected_pr_column"],
                canonical_concept="document_number",
                strategy=MatchStrategy.NORMALIZED_TEXT,
                normalizers=[
                    NormalizationType.TRIM_WHITESPACE,
                    NormalizationType.STRIP_SPECIAL_CHARS,
                    NormalizationType.REMOVE_PREFIXES,
                    NormalizationType.TRIM_LEADING_ZEROS,
                    NormalizationType.UPPERCASE,
                ],
            )
        )
    if val_col:
        tier2_rules.append(
            FieldMatchRule(
                gstr_column=val_col["gstr_column"],
                pr_column=val_col["selected_pr_column"],
                canonical_concept="taxable_value",
                strategy=MatchStrategy.NUMERIC_TOLERANCE,
                tolerance_value=1.00,
            )
        )
    if date_col:
        tier2_rules.append(
            FieldMatchRule(
                gstr_column=date_col["gstr_column"],
                pr_column=date_col["selected_pr_column"],
                canonical_concept="document_date",
                strategy=MatchStrategy.DATE_PROXIMITY,
                date_tolerance_days=5,
            )
        )

    passes.append(
        MatchingPass(
            pass_id="PASS-2-NORMALIZED",
            name="Tier 2: Progressive String Normalization",
            description="Normalized match stripping symbols (+, -, /, _), standard prefixes (INV-, BILL/), and leading zeros.",
            tier=2,
            is_enabled=True,
            rules=tier2_rules,
        )
    )

    # TIER 3: COMMERCIAL TOLERANCE WINDOW (Date drift & Value variance)
    tier3_rules: list[FieldMatchRule] = []
    if gstin_col:
        tier3_rules.append(
            FieldMatchRule(
                gstr_column=gstin_col["gstr_column"],
                pr_column=gstin_col["selected_pr_column"],
                canonical_concept="gstin",
                strategy=MatchStrategy.NORMALIZED_TEXT,
                normalizers=[NormalizationType.TRIM_WHITESPACE, NormalizationType.STRIP_SPECIAL_CHARS, NormalizationType.UPPERCASE],
            )
        )
    if inv_col:
        tier3_rules.append(
            FieldMatchRule(
                gstr_column=inv_col["gstr_column"],
                pr_column=inv_col["selected_pr_column"],
                canonical_concept="document_number",
                strategy=MatchStrategy.NORMALIZED_TEXT,
                normalizers=[
                    NormalizationType.TRIM_WHITESPACE,
                    NormalizationType.STRIP_SPECIAL_CHARS,
                    NormalizationType.REMOVE_PREFIXES,
                    NormalizationType.TRIM_LEADING_ZEROS,
                    NormalizationType.UPPERCASE,
                ],
            )
        )
    if val_col:
        tier3_rules.append(
            FieldMatchRule(
                gstr_column=val_col["gstr_column"],
                pr_column=val_col["selected_pr_column"],
                canonical_concept="taxable_value",
                strategy=MatchStrategy.NUMERIC_TOLERANCE,
                tolerance_value=10.00,
            )
        )
    if date_col:
        tier3_rules.append(
            FieldMatchRule(
                gstr_column=date_col["gstr_column"],
                pr_column=date_col["selected_pr_column"],
                canonical_concept="document_date",
                strategy=MatchStrategy.DATE_PROXIMITY,
                date_tolerance_days=30,
            )
        )

    passes.append(
        MatchingPass(
            pass_id="PASS-3-TOLERANCE",
            name="Tier 3: Commercial Tolerance Window",
            description="Normalized matching with commercial variance: Taxable Value within +/- ₹10.00 and Date within +/- 30 days.",
            tier=3,
            is_enabled=True,
            rules=tier3_rules,
        )
    )

    return passes
