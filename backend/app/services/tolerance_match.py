from __future__ import annotations

from collections import Counter, defaultdict
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

import pandas as pd

from app.domain.models import (
    ConfirmedMappingSet,
    DatasetRole,
    MatchConflict,
    MatchOperator,
    MatchResult,
    ReconciliationPolicy,
)


class ToleranceMatchEngine:
    """Provider-independent, one-to-one tolerance matching over unmatched rows only."""

    @staticmethod
    def _mapping(confirmed: ConfirmedMappingSet) -> dict[DatasetRole, dict[str, str]]:
        return {
            dataset.source_dataset: {
                item.canonical_field: item.source_column
                for item in dataset.mappings
                if item.canonical_field
            }
            for dataset in confirmed.datasets
        }

    @staticmethod
    def _null(value: object) -> bool:
        try:
            return bool(pd.isna(value))
        except (TypeError, ValueError):
            return value is None

    @classmethod
    def _text(cls, value: object, field: str) -> str | None:
        if cls._null(value):
            return None
        text = str(value).strip()
        return text.upper() if field == "gstin" else text

    @classmethod
    def _decimal(cls, value: object) -> Decimal | None:
        if cls._null(value):
            return None
        try:
            return Decimal(str(value))
        except InvalidOperation:
            return None

    @classmethod
    def _date(cls, value: object) -> date | None:
        if cls._null(value):
            return None
        if isinstance(value, datetime):
            return value.date()
        if isinstance(value, date):
            return value
        parsed = pd.to_datetime(value, errors="coerce")
        return None if pd.isna(parsed) else parsed.date()

    def _evaluate(
        self,
        government: pd.Series,
        purchase: pd.Series,
        policy: ReconciliationPolicy,
        mappings: dict[DatasetRole, dict[str, str]],
    ) -> tuple[dict[str, float], dict[str, float], list[str], dict[str, Any], dict[str, Any]] | None:
        variances: dict[str, float] = {}
        allowed: dict[str, float] = {}
        satisfied: list[str] = []
        government_values: dict[str, Any] = {}
        purchase_values: dict[str, Any] = {}
        for rule in sorted((item for item in policy.rules if item.enabled), key=lambda item: item.priority):
            field = rule.canonical_field
            government_value = government[mappings[DatasetRole.GOVERNMENT][field]]
            purchase_value = purchase[mappings[DatasetRole.PURCHASE_REGISTER][field]]
            government_values[field] = self._json_value(government_value)
            purchase_values[field] = self._json_value(purchase_value)
            if rule.operator == MatchOperator.EXACT:
                left, right = self._text(government_value, field), self._text(purchase_value, field)
                if left is None or right is None or left != right:
                    return None
                satisfied.append(f"{field}_exact")
            elif rule.operator == MatchOperator.ABSOLUTE_TOLERANCE:
                left, right = self._decimal(government_value), self._decimal(purchase_value)
                if left is None or right is None or rule.tolerance is None:
                    return None
                variance = abs(left - right)
                if variance > rule.tolerance.value:
                    return None
                variances[field] = float(variance)
                allowed[field] = float(rule.tolerance.value)
                satisfied.append(f"{field}_tolerance")
            elif rule.operator == MatchOperator.DATE_TOLERANCE:
                left, right = self._date(government_value), self._date(purchase_value)
                if left is None or right is None or rule.tolerance is None:
                    return None
                variance = abs((left - right).days)
                if Decimal(variance) > rule.tolerance.value:
                    return None
                variance_key = f"{field}_days"
                variances[variance_key] = float(variance)
                allowed[variance_key] = float(rule.tolerance.value)
                satisfied.append(f"{field}_tolerance")
        return variances, allowed, satisfied, government_values, purchase_values

    @staticmethod
    def _json_value(value: object) -> Any:
        if pd.isna(value):
            return None
        if isinstance(value, pd.Timestamp):
            return value.date().isoformat()
        if hasattr(value, "item"):
            value = value.item()
        return value

    def match(
        self,
        government: pd.DataFrame,
        purchase_register: pd.DataFrame,
        confirmed_mapping: ConfirmedMappingSet,
        policy: ReconciliationPolicy,
        exact_matches: list[MatchResult],
    ) -> tuple[list[MatchResult], list[MatchConflict]]:
        mappings = self._mapping(confirmed_mapping)
        gov_id_column = mappings[DatasetRole.GOVERNMENT]["record_id"]
        pr_id_column = mappings[DatasetRole.PURCHASE_REGISTER]["record_id"]
        consumed_government = {item.government_record_id for item in exact_matches}
        consumed_purchase = {item.purchase_register_record_id for item in exact_matches}
        gov_rows = government[~government[gov_id_column].astype(str).isin(consumed_government)]
        pr_rows = purchase_register[~purchase_register[pr_id_column].astype(str).isin(consumed_purchase)]

        exact_fields = [
            rule.canonical_field
            for rule in policy.rules
            if rule.enabled and rule.operator == MatchOperator.EXACT
        ]
        purchase_buckets: dict[tuple[str, ...], list[dict]] = defaultdict(list)
        pr_records = pr_rows.to_dict("records")
        pr_mapping = mappings[DatasetRole.PURCHASE_REGISTER]
        for pr_row in pr_records:
            key_values = [
                self._text(pr_row[pr_mapping[field]], field)
                for field in exact_fields
            ]
            if all(value is not None for value in key_values):
                purchase_buckets[tuple(key_values)].append(pr_row)

        candidates: dict[str, list[tuple[str, tuple]]] = defaultdict(list)
        pr_claims: Counter[str] = Counter()
        gov_records = gov_rows.to_dict("records")
        gov_mapping = mappings[DatasetRole.GOVERNMENT]

        for gov_row in gov_records:
            gov_id = str(gov_row[gov_id_column]).strip()
            key_values = [
                self._text(gov_row[gov_mapping[field]], field)
                for field in exact_fields
            ]
            if not all(value is not None for value in key_values):
                continue
            for pr_row in purchase_buckets.get(tuple(key_values), []):
                evidence = self._evaluate(gov_row, pr_row, policy, mappings)
                if evidence is None:
                    continue
                pr_id = str(pr_row[pr_id_column]).strip()
                candidates[gov_id].append((pr_id, evidence))
                pr_claims[pr_id] += 1


        matches: list[MatchResult] = []
        conflicts: list[MatchConflict] = []
        for gov_id, options in candidates.items():
            if len(options) != 1 or pr_claims[options[0][0]] != 1:
                conflicts.append(
                    MatchConflict(
                        government_record_id=gov_id,
                        purchase_register_record_ids=[item[0] for item in options],
                    )
                )
                continue
            pr_id, evidence = options[0]
            variances, allowed, satisfied, government_values, purchase_values = evidence
            matches.append(
                MatchResult(
                    government_record_id=gov_id,
                    purchase_register_record_id=pr_id,
                    match_type="tolerance",
                    matched_fields=[rule.canonical_field for rule in policy.rules if rule.enabled],
                    variances=variances,
                    allowed_tolerances=allowed,
                    rules_satisfied=satisfied,
                    government_values=government_values,
                    purchase_register_values=purchase_values,
                    policy_revision=policy.revision,
                )
            )
        return matches, conflicts
