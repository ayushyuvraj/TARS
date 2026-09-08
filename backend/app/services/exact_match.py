from __future__ import annotations

from collections import defaultdict, deque
from datetime import date, datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Hashable

import pandas as pd

from app.domain.models import DatasetRole, MatchResult
from app.services.mapping import CANONICAL_MAPPINGS

MATCH_FIELDS = (
    "gstin",
    "document_number",
    "document_date",
    "document_type",
    "taxable_value",
    "gst_rate",
    "igst",
    "cgst",
    "sgst",
    "cess",
)
MONEY_FIELDS = {"taxable_value", "gst_rate", "igst", "cgst", "sgst", "cess"}


class ExactMatchEngine:
    """Deterministic one-to-one exact matching over canonicalized fields."""

    @staticmethod
    def _is_null(value: object) -> bool:
        try:
            return bool(pd.isna(value))
        except (TypeError, ValueError):
            return value is None

    def _normalize(self, field: str, value: object) -> Hashable | None:
        if value is None or self._is_null(value):
            return None
        if field in MONEY_FIELDS:
            try:
                return Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            except (InvalidOperation, ValueError) as exc:
                raise ValueError(f"Invalid numeric value for {field}: {value!r}") from exc
        if field == "document_date":
            if isinstance(value, datetime):
                return value.date().isoformat()
            if isinstance(value, date):
                return value.isoformat()
            parsed = pd.to_datetime(value, errors="coerce")
            return None if pd.isna(parsed) else parsed.date().isoformat()
        text = str(value).strip()
        if not text:
            return None
        if field in {"gstin", "document_type"}:
            return text.upper()
        # Invoice-number case is material to Phase 1 exactness. Fuzzy/case-insensitive
        # comparison belongs to the later near-match engine.
        return text

    def _record_key(
        self,
        row: dict,
        field_cols: list[tuple[str, str]],
    ) -> tuple[Hashable, ...] | None:
        values = []
        for field, col in field_cols:
            val = self._normalize(field, row.get(col))
            if val is None:
                return None
            values.append(val)
        return tuple(values)

    def _key(
        self,
        row: pd.Series,
        role: DatasetRole,
        mappings: dict[DatasetRole, dict[str, str]],
    ) -> tuple[Hashable, ...] | None:
        mapping = mappings[role]
        values = tuple(self._normalize(field, row[mapping[field]]) for field in MATCH_FIELDS)
        return None if any(value is None for value in values) else values  # type: ignore[return-value]

    def match(
        self,
        government: pd.DataFrame,
        purchase_register: pd.DataFrame,
        mappings: dict[DatasetRole, dict[str, str]] | None = None,
    ) -> list[MatchResult]:
        resolved_mappings = mappings or CANONICAL_MAPPINGS
        pr_mapping = resolved_mappings[DatasetRole.PURCHASE_REGISTER]
        pr_field_cols = [(field, pr_mapping[field]) for field in MATCH_FIELDS]
        pr_id_col = pr_mapping["record_id"]

        pr_index: dict[tuple[Hashable, ...], deque[str]] = defaultdict(deque)
        for row in purchase_register.to_dict("records"):
            key = self._record_key(row, pr_field_cols)
            if key is not None:
                pr_index[key].append(str(row[pr_id_col]).strip())

        government_mapping = resolved_mappings[DatasetRole.GOVERNMENT]
        gov_field_cols = [(field, government_mapping[field]) for field in MATCH_FIELDS]
        gov_id_col = government_mapping["record_id"]

        matches: list[MatchResult] = []
        for row in government.to_dict("records"):
            key = self._record_key(row, gov_field_cols)
            if key is None or not pr_index[key]:
                continue
            matches.append(
                MatchResult(
                    government_record_id=str(row[gov_id_col]).strip(),
                    purchase_register_record_id=pr_index[key].popleft(),
                    matched_fields=list(MATCH_FIELDS),
                )
            )
        return matches

