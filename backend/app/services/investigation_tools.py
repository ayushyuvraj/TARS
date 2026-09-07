from __future__ import annotations

from typing import Any
from uuid import UUID

from app.services.exception_tools import ExceptionToolService
from app.services.governance import GovernanceService


class InvestigationToolService:
    """The only model-callable tools. Every operation is read-only and record scoped."""

    NAMES = {
        "get_exception_context", "compare_financials", "get_candidates",
        "search_related_records", "get_governance_context",
    }
    VALUE_ALLOWLIST = {
        "record_id", "gstin", "document_number", "document_date", "document_type",
        "taxable_value", "gst_rate", "igst", "cgst", "sgst", "cess", "counterparty_name",
    }

    def __init__(self, exceptions: ExceptionToolService, governance: GovernanceService) -> None:
        self.exceptions = exceptions
        self.governance = governance

    def execute(self, name: str, reconciliation_id: UUID, record_id: str) -> dict[str, Any]:
        if name not in self.NAMES:
            raise ValueError(f"Tool {name} is not permitted")
        if name == "get_exception_context":
            record = self.exceptions.get_record(
                reconciliation_id, record_id, include_source_values=False,
            )
            values = {k: v for k, v in record.values.items() if k in self.VALUE_ALLOWLIST}
            return {
                "record_id": record.record_id,
                "source_dataset": record.source_dataset.value,
                "status": record.status,
                "candidate_count": record.candidate_count,
                **values,
            }
        if name == "compare_financials":
            return self.exceptions.get_variance_analysis(reconciliation_id, record_id).model_dump(mode="json")
        if name == "get_candidates":
            candidates = self.exceptions.get_ranked_candidates(reconciliation_id, record_id)[:5]
            return {"record_id": record_id, "candidates": [
                {
                    "purchase_register_record_id": item.purchase_register_record_id,
                    "rank": item.rank,
                    "match_score": item.match_score,
                    "score_gap": item.score_gap,
                    "reciprocal_best": item.reciprocal_best,
                    "features": item.features.model_dump(mode="json"),
                } for item in candidates
            ]}
        if name == "search_related_records":
            record = self.exceptions.get_record(
                reconciliation_id, record_id, include_source_values=False,
            )
            gstin = str(record.values.get("gstin") or "").strip()
            if not gstin:
                return {
                    "query": {"gstin": None}, "scope": "candidate_backed_exceptions",
                    "total": 0, "records": [],
                }
            analysis = self.exceptions._session(reconciliation_id).near_match_analysis
            related: dict[str, dict[str, Any]] = {}
            for candidate in analysis.candidates:
                pairs = (
                    (candidate.government_record_id, candidate.government_values),
                    (candidate.purchase_register_record_id, candidate.purchase_register_values),
                )
                for candidate_record_id, values in pairs:
                    if candidate_record_id == record_id or candidate_record_id in related:
                        continue
                    if str(values.get("gstin") or "").strip() != gstin:
                        continue
                    classified = self.exceptions._exception_status(analysis, candidate_record_id)
                    if classified is None:
                        continue
                    related[candidate_record_id] = {
                        "record_id": candidate_record_id,
                        "status": classified[0],
                        "taxable_value": values.get("taxable_value"),
                    }
            records = [related[key] for key in sorted(related)[:9]]
            return {
                "query": {"gstin": gstin}, "scope": "candidate_backed_exceptions",
                "total": len(related), "records": records,
            }
        session = self.exceptions.reconciliation.get(reconciliation_id)
        policy = self.exceptions.get_policy(reconciliation_id)
        profile_id = session.client_profile_id
        rules = self.governance.list_rules(profile_id) if profile_id else []
        tolerances = {
            rule.canonical_field: rule.tolerance.model_dump(mode="json")
            for rule in policy.rules if rule.tolerance is not None
        }
        return {
            "policy_revision": policy.revision,
            "tolerances": tolerances,
            "near_match_thresholds": session.near_match_analysis.thresholds.model_dump(mode="json"),
            "client_profile_id": str(profile_id) if profile_id else None,
            "rules": [{"rule_id": rule.rule_id, "version": rule.version,
                       "status": rule.status.value, "action_authority": rule.action_authority}
                      for rule in rules],
            "human_approval_required": True,
        }
