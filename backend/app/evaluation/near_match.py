from __future__ import annotations

import pandas as pd

from app.domain.models import CandidateStatus, NearMatchAnalysis, NearMatchEvaluationReport


class NearMatchEvaluator:
    """Ground-truth evaluation kept independent from candidate generation and scoring."""

    def evaluate(self, analysis: NearMatchAnalysis, ground_truth: pd.DataFrame) -> NearMatchEvaluationReport:
        near_rows = ground_truth[ground_truth["Scenario"] == "NEAR"]
        expected = {
            (str(row.Government_Record_ID), str(row.Expected_PR_Record_IDs))
            for row in near_rows.itertuples()
        }
        all_pairs = {
            (item.government_record_id, item.purchase_register_record_id)
            for item in analysis.candidates
        }
        top_pairs = {
            (item.government_record_id, item.purchase_register_record_id)
            for item in analysis.candidates if item.rank == 1
        }
        safe_candidates = [
            item for item in analysis.candidates
            if item.status in {CandidateStatus.NEAR_MATCH_PROPOSED, CandidateStatus.NEAR_MATCH_APPROVED}
        ]
        safe_pairs = {(item.government_record_id, item.purchase_register_record_id) for item in safe_candidates}
        ambiguous_ids = set(ground_truth[ground_truth["Scenario"] == "AMBIGUOUS"]["Government_Record_ID"].dropna().astype(str))
        material_ids = set(ground_truth[ground_truth["Scenario"] == "MISMATCH"]["Government_Record_ID"].dropna().astype(str))
        gst_only_ids = set(ground_truth[ground_truth["Scenario"] == "GST_ONLY"]["Government_Record_ID"].dropna().astype(str))
        pr_only_ids = set(ground_truth[ground_truth["Scenario"] == "PR_ONLY"]["Expected_PR_Record_IDs"].dropna().astype(str))
        safe_government = [government for government, _ in safe_pairs]
        safe_purchase = [purchase for _, purchase in safe_pairs]
        true_scores = [item.match_score for item in safe_candidates if (item.government_record_id, item.purchase_register_record_id) in expected]
        true_positive = len(safe_pairs & expected)
        return NearMatchEvaluationReport(
            expected_near_pairs=len(expected),
            candidate_recall=len(all_pairs & expected) / len(expected) if expected else 1,
            top_1_accuracy=len(top_pairs & expected) / len(expected) if expected else 1,
            safe_proposal_precision=true_positive / len(safe_pairs) if safe_pairs else 1,
            safe_proposal_recall=true_positive / len(expected) if expected else 1,
            false_positive_count=len(safe_pairs - expected),
            ambiguous_auto_match_count=sum(item in ambiguous_ids for item in safe_government),
            duplicate_consumption_count=(len(safe_government) - len(set(safe_government)) +
                                         len(safe_purchase) - len(set(safe_purchase))),
            material_mismatch_false_matches=sum(item in material_ids for item in safe_government),
            gst_only_false_matches=sum(item in gst_only_ids for item in safe_government),
            pr_only_false_consumption=sum(item in pr_only_ids for item in safe_purchase),
            candidate_count=analysis.summary.candidate_count,
            runtime_ms=analysis.summary.runtime_ms,
            true_near_score_min=min(true_scores) if true_scores else None,
            true_near_score_max=max(true_scores) if true_scores else None,
        )
