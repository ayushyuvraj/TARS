from __future__ import annotations

import unicodedata
from collections import Counter, defaultdict
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from time import perf_counter
from typing import Any

import pandas as pd
from rapidfuzz import fuzz

from app.domain.models import (
    CandidateFeatures,
    CandidateMatch,
    CandidateScoreComponents,
    CandidateStatus,
    ConfirmedMappingSet,
    DatasetRole,
    MatchResult,
    MatchingThresholds,
    NearMatchAmbiguity,
    NearMatchAnalysis,
    NearMatchAnalysisSummary,
)


FEATURE_FIELDS = (
    "gstin", "document_number", "document_date", "document_type", "taxable_value",
    "gst_rate", "igst", "cgst", "sgst", "cess",
)
TAX_FIELDS = ("igst", "cgst", "sgst", "cess")


def normalize_invoice_number(value: object) -> str:
    """NFKC, uppercase, and retain only meaningful alphanumeric content."""
    if value is None or bool(pd.isna(value)):
        return ""
    normalized = unicodedata.normalize("NFKC", str(value)).strip().upper()
    return "".join(character for character in normalized if character.isalnum())


class NearMatchEngine:
    def __init__(self, thresholds: MatchingThresholds | None = None) -> None:
        self.thresholds = thresholds or MatchingThresholds()

    @staticmethod
    def _mapping(confirmed: ConfirmedMappingSet) -> dict[DatasetRole, dict[str, str]]:
        return {
            dataset.source_dataset: {
                item.canonical_field: item.source_column
                for item in dataset.mappings if item.canonical_field
            }
            for dataset in confirmed.datasets
        }

    @staticmethod
    def _text(value: object) -> str:
        return "" if value is None or bool(pd.isna(value)) else str(value).strip()

    @staticmethod
    def _decimal(value: object) -> Decimal:
        if value is None or bool(pd.isna(value)):
            return Decimal("0")
        try:
            return Decimal(str(value))
        except InvalidOperation:
            return Decimal("0")

    @staticmethod
    def _date(value: object) -> date | None:
        if value is None or bool(pd.isna(value)):
            return None
        if isinstance(value, datetime):
            return value.date()
        if isinstance(value, date):
            return value
        parsed = pd.to_datetime(value, errors="coerce")
        return None if pd.isna(parsed) else parsed.date()

    @staticmethod
    def _json_value(value: object) -> Any:
        if value is None or bool(pd.isna(value)):
            return None
        if isinstance(value, pd.Timestamp):
            return value.date().isoformat()
        return value.item() if hasattr(value, "item") else value

    def candidate_generation(
        self,
        government: pd.DataFrame,
        purchase_register: pd.DataFrame,
        mappings: dict[DatasetRole, dict[str, str]],
        consumed_government: set[str],
        consumed_purchase: set[str],
    ) -> list[tuple[dict, dict]]:
        gov_map, pr_map = mappings[DatasetRole.GOVERNMENT], mappings[DatasetRole.PURCHASE_REGISTER]
        pr_by_gstin: dict[str, list[dict]] = defaultdict(list)
        for row in purchase_register.to_dict("records"):
            if self._text(row[pr_map["record_id"]]) in consumed_purchase:
                continue
            pr_by_gstin[self._text(row[pr_map["gstin"]]).upper()].append(row)

        pairs: list[tuple[dict, dict]] = []
        for government_row in government.to_dict("records"):
            if self._text(government_row[gov_map["record_id"]]) in consumed_government:
                continue
            gstin = self._text(government_row[gov_map["gstin"]]).upper()
            for purchase_row in pr_by_gstin.get(gstin, []):
                if self._text(government_row[gov_map["document_type"]]).upper() != self._text(purchase_row[pr_map["document_type"]]).upper():
                    continue
                left_date, right_date = self._date(government_row[gov_map["document_date"]]), self._date(purchase_row[pr_map["document_date"]])
                if left_date is None or right_date is None or abs((left_date - right_date).days) > self.thresholds.date_window_days:
                    continue
                left_amount, right_amount = self._decimal(government_row[gov_map["taxable_value"]]), self._decimal(purchase_row[pr_map["taxable_value"]])
                amount_limit = max(self.thresholds.amount_window_absolute, abs(left_amount) * Decimal(str(self.thresholds.amount_window_relative)))
                if abs(left_amount - right_amount) > amount_limit:
                    continue
                left_invoice = self._text(government_row[gov_map["document_number"]])
                right_invoice = self._text(purchase_row[pr_map["document_number"]])
                similarity = fuzz.ratio(normalize_invoice_number(left_invoice), normalize_invoice_number(right_invoice)) / 100
                if similarity < self.thresholds.minimum_invoice_similarity:
                    continue
                pairs.append((government_row, purchase_row))
        return pairs


    def calculate_features(
        self, government_row: pd.Series, purchase_row: pd.Series,
        mappings: dict[DatasetRole, dict[str, str]],
    ) -> CandidateFeatures:
        gov_map, pr_map = mappings[DatasetRole.GOVERNMENT], mappings[DatasetRole.PURCHASE_REGISTER]
        raw_government = self._text(government_row[gov_map["document_number"]])
        raw_purchase = self._text(purchase_row[pr_map["document_number"]])
        normalized_government, normalized_purchase = normalize_invoice_number(raw_government), normalize_invoice_number(raw_purchase)
        government_date, purchase_date = self._date(government_row[gov_map["document_date"]]), self._date(purchase_row[pr_map["document_date"]])
        government_amount, purchase_amount = self._decimal(government_row[gov_map["taxable_value"]]), self._decimal(purchase_row[pr_map["taxable_value"]])
        difference = abs(government_amount - purchase_amount)
        return CandidateFeatures(
            gstin_exact=self._text(government_row[gov_map["gstin"]]).upper() == self._text(purchase_row[pr_map["gstin"]]).upper(),
            document_number_raw_equal=raw_government == raw_purchase,
            document_number_government_raw=raw_government,
            document_number_purchase_raw=raw_purchase,
            document_number_government_normalized=normalized_government,
            document_number_purchase_normalized=normalized_purchase,
            document_number_normalized_equal=bool(normalized_government and normalized_government == normalized_purchase),
            document_number_similarity=fuzz.ratio(normalized_government, normalized_purchase) / 100,
            document_date_difference_days=abs((government_date - purchase_date).days) if government_date and purchase_date else self.thresholds.date_window_days + 1,
            taxable_value_difference=difference,
            taxable_value_relative_difference=float(difference / max(abs(government_amount), Decimal("0.01"))),
            igst_difference=abs(self._decimal(government_row[gov_map["igst"]]) - self._decimal(purchase_row[pr_map["igst"]])),
            cgst_difference=abs(self._decimal(government_row[gov_map["cgst"]]) - self._decimal(purchase_row[pr_map["cgst"]])),
            sgst_difference=abs(self._decimal(government_row[gov_map["sgst"]]) - self._decimal(purchase_row[pr_map["sgst"]])),
            cess_difference=abs(self._decimal(government_row[gov_map["cess"]]) - self._decimal(purchase_row[pr_map["cess"]])),
            gst_rate_match=self._decimal(government_row[gov_map["gst_rate"]]) == self._decimal(purchase_row[pr_map["gst_rate"]]),
            document_type_match=self._text(government_row[gov_map["document_type"]]).upper() == self._text(purchase_row[pr_map["document_type"]]).upper(),
        )

    def score_candidate(self, features: CandidateFeatures) -> tuple[float, CandidateScoreComponents]:
        amount_scale = max(self.thresholds.material_amount_tolerance, Decimal("0.01"))
        amount_score = max(0.0, 1 - float(features.taxable_value_difference / amount_scale))
        tax_differences = [features.igst_difference, features.cgst_difference, features.sgst_difference, features.cess_difference]
        tax_scale = max(self.thresholds.material_tax_tolerance, Decimal("0.01"))
        tax_score = sum(max(0.0, 1 - float(value / tax_scale)) for value in tax_differences) / len(tax_differences)
        date_score = max(0.0, 1 - features.document_date_difference_days / max(self.thresholds.date_window_days, 1))
        components = CandidateScoreComponents(
            invoice=features.document_number_similarity,
            taxable_value=amount_score,
            tax_amounts=tax_score,
            date=date_score,
            gst_rate=1.0 if features.gst_rate_match else 0.0,
            document_type=1.0 if features.document_type_match else 0.0,
        )
        score = (
            components.invoice * 0.35 + components.taxable_value * 0.25 +
            components.tax_amounts * 0.20 + components.date * 0.10 +
            components.gst_rate * 0.05 + components.document_type * 0.05
        )
        return round(score, 6), components

    def analyze(
        self, reconciliation_id, government: pd.DataFrame, purchase_register: pd.DataFrame,
        confirmed_mapping: ConfirmedMappingSet, previous_matches: list[MatchResult],
    ) -> NearMatchAnalysis:
        started = perf_counter()
        mappings = self._mapping(confirmed_mapping)
        gov_map, pr_map = mappings[DatasetRole.GOVERNMENT], mappings[DatasetRole.PURCHASE_REGISTER]
        consumed_government = {item.government_record_id for item in previous_matches}
        consumed_purchase = {item.purchase_register_record_id for item in previous_matches}
        blocked_pairs = self.candidate_generation(government, purchase_register, mappings, consumed_government, consumed_purchase)
        candidates_by_government: dict[str, list[CandidateMatch]] = defaultdict(list)
        for government_row, purchase_row in blocked_pairs:
            features = self.calculate_features(government_row, purchase_row, mappings)
            score, components = self.score_candidate(features)
            if score < self.thresholds.candidate_generation_min_score:
                continue
            government_id = self._text(government_row[gov_map["record_id"]])
            purchase_id = self._text(purchase_row[pr_map["record_id"]])
            reasons = ["GSTIN exact", f"Invoice similarity {score_percentage(features.document_number_similarity)}"]
            if features.document_number_normalized_equal:
                reasons.append("Normalized invoice exact")
            reasons.append(f"Taxable value variance {features.taxable_value_difference}")
            candidates_by_government[government_id].append(CandidateMatch(
                government_record_id=government_id, purchase_register_record_id=purchase_id,
                match_score=score, status=CandidateStatus.MATERIAL_MISMATCH,
                features=features, component_scores=components, reasons=reasons,
                government_values={field: self._json_value(government_row[gov_map[field]]) for field in FEATURE_FIELDS},
                purchase_register_values={field: self._json_value(purchase_row[pr_map[field]]) for field in FEATURE_FIELDS},
            ))
        for items in candidates_by_government.values():
            items.sort(key=lambda item: (-item.match_score, item.purchase_register_record_id))
            for rank, item in enumerate(items, 1):
                item.rank = rank
                item.score_gap = round(items[0].match_score - items[1].match_score, 6) if len(items) > 1 else 1.0

        all_candidates = [item for items in candidates_by_government.values() for item in items]
        candidates_by_purchase: dict[str, list[CandidateMatch]] = defaultdict(list)
        for item in all_candidates:
            candidates_by_purchase[item.purchase_register_record_id].append(item)
        best_government_by_purchase: dict[str, list[str]] = {}
        for purchase_id, items in candidates_by_purchase.items():
            best_score = max(item.match_score for item in items)
            best_government_by_purchase[purchase_id] = [
                item.government_record_id for item in items if item.match_score == best_score
            ]

        ambiguities: list[NearMatchAmbiguity] = []
        proposals: list[CandidateMatch] = []
        material_ids: list[str] = []
        for government_id, items in candidates_by_government.items():
            credible = [item for item in items if item.match_score >= self.thresholds.near_match_threshold]
            top = items[0]
            gap = top.match_score - items[1].match_score if len(items) > 1 else 1.0
            is_ambiguous = len(credible) >= 2 or (len(items) > 1 and items[1].match_score >= self.thresholds.near_match_threshold - self.thresholds.ambiguity_margin and gap <= self.thresholds.ambiguity_margin)
            if is_ambiguous:
                for item in items:
                    item.status = CandidateStatus.AMBIGUOUS
                ambiguities.append(NearMatchAmbiguity(
                    government_record_id=government_id,
                    candidate_ids=[item.id for item in items], candidate_count=len(items),
                    top_candidate_score=top.match_score, second_candidate_score=items[1].match_score,
                    score_gap=round(gap, 6),
                ))
                continue
            material_agreement = (
                top.features.taxable_value_difference <= self.thresholds.material_amount_tolerance and
                all(getattr(top.features, f"{field}_difference") <= self.thresholds.material_tax_tolerance for field in TAX_FIELDS)
            )
            reciprocal = best_government_by_purchase.get(top.purchase_register_record_id) == [government_id]
            top.reciprocal_best = reciprocal
            if top.match_score >= self.thresholds.near_match_threshold and material_agreement and reciprocal:
                top.status = CandidateStatus.NEAR_MATCH_PROPOSED
                top.eligible_for_bulk_approval = True
                proposals.append(top)
            elif any(
                item.features.document_number_normalized_equal and (
                    item.features.taxable_value_difference > self.thresholds.material_amount_tolerance or
                    any(getattr(item.features, f"{field}_difference") > self.thresholds.material_tax_tolerance for field in TAX_FIELDS)
                )
                for item in items
            ):
                material_ids.append(government_id)

        unresolved_government_ids = {
            self._text(val) for val in government[gov_map["record_id"]]
            if self._text(val) not in consumed_government
        }
        classified_government = set(candidates_by_government) & ({item.government_record_id for item in proposals} | {item.government_record_id for item in ambiguities} | set(material_ids))
        gst_only_ids = sorted(unresolved_government_ids - classified_government)
        linked_purchase = {
            item.purchase_register_record_id for item in all_candidates
            if item.features.document_number_normalized_equal or item.match_score >= self.thresholds.near_match_threshold - self.thresholds.ambiguity_margin
        }
        unresolved_purchase_ids = {
            self._text(val) for val in purchase_register[pr_map["record_id"]]
            if self._text(val) not in consumed_purchase
        }
        pr_only_ids = sorted(unresolved_purchase_ids - linked_purchase)

        runtime_ms = round((perf_counter() - started) * 1000, 2)
        return NearMatchAnalysis(
            reconciliation_id=reconciliation_id, thresholds=self.thresholds,
            candidates=all_candidates, ambiguities=ambiguities,
            material_mismatch_government_ids=sorted(set(material_ids)),
            gst_only_government_ids=gst_only_ids,
            pr_only_purchase_register_ids=pr_only_ids,
            summary=NearMatchAnalysisSummary(
                candidate_count=len(all_candidates), high_confidence_proposals=len(proposals),
                ambiguous_government_records=len(ambiguities), material_mismatch_records=len(set(material_ids)),
                gst_only_records=len(gst_only_ids), pr_only_records=len(pr_only_ids), runtime_ms=runtime_ms,
            ),
        )


def score_percentage(value: float) -> str:
    return f"{round(value * 100)}%"
