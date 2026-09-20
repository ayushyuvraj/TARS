import pytest
from app.services.matching_engine_v3 import (
    evaluate_ambiguity_recommendation,
    evaluate_target_category_policy,
)


def test_evaluate_ambiguity_recommendation_exact():
    record = {
        "source_gstin": "27AABCU9603R1ZM",
        "target_gstin": "27AABCU9603R1ZM",
        "source_doc_num": "INV-2024-001",
        "target_doc_num": "INV-2024-001",
        "source_taxable": 50000.0,
        "target_taxable": 50000.0,
        "taxable_diff": 0.0,
    }
    recom = evaluate_ambiguity_recommendation(record)
    assert recom.recommended_bucket == "EXACT_MATCH"
    assert recom.confidence >= 95.0
    assert "Section 16(2)(aa)" in recom.accounting_rationale
    assert recom.policy_verdict == "OKAY"
    assert "EXACT_MATCH" in recom.category_policies
    assert recom.category_policies["EXACT_MATCH"]["verdict"] == "OKAY"


def test_evaluate_ambiguity_recommendation_tolerance():
    record = {
        "source_gstin": "27AABCU9603R1ZM",
        "target_gstin": "27AABCU9603R1ZM",
        "source_doc_num": "INV-2024-002",
        "target_doc_num": "INV-2024-002",
        "source_taxable": 50000.0,
        "target_taxable": 50004.50,
        "taxable_diff": 4.50,
    }
    recom = evaluate_ambiguity_recommendation(record)
    assert recom.recommended_bucket == "TOLERANCE_MATCH"
    assert recom.confidence >= 90.0
    assert "tolerance margin" in recom.accounting_rationale
    assert recom.category_policies["TOLERANCE_MATCH"]["verdict"] == "OKAY"
    # Exact Match for this record must be NOT_OKAY due to difference
    assert recom.category_policies["EXACT_MATCH"]["verdict"] == "NOT_OKAY"
    assert "Discrepancies detected" in recom.category_policies["EXACT_MATCH"]["message"]


def test_evaluate_ambiguity_recommendation_chasing():
    record = {
        "source_gstin": "27AABCU9603R1ZM",
        "target_gstin": "",
        "source_doc_num": "INV-2024-003",
        "target_doc_num": "",
        "source_taxable": 12000.0,
        "target_taxable": 0.0,
        "taxable_diff": 12000.0,
    }
    recom = evaluate_ambiguity_recommendation(record)
    assert recom.recommended_bucket == "GSTR_ONLY"
    assert "Chasing" in recom.recommended_label
    assert recom.category_policies["GSTR_ONLY"]["verdict"] == "OKAY"


def test_evaluate_ambiguity_recommendation_pr_match():
    record = {
        "source_gstin": "",
        "target_gstin": "27AABCU9603R1ZM",
        "source_doc_num": "",
        "target_doc_num": "INV-2024-004",
        "source_taxable": 0.0,
        "target_taxable": 15000.0,
        "taxable_diff": 15000.0,
    }
    recom = evaluate_ambiguity_recommendation(record)
    assert recom.recommended_bucket == "PR_ONLY"
    assert "PR Match" in recom.recommended_label
    assert "DRC-01C" in recom.accounting_rationale


def test_evaluate_target_category_policy_not_okay():
    record = {
        "source_gstin": "27AABCU9603R1ZM",
        "target_gstin": "27AABCU9603R1ZM",
        "source_doc_num": "INV-100",
        "target_doc_num": "INV-200",
        "source_taxable": 10000.0,
        "target_taxable": 10500.0,
        "taxable_diff": 500.0,
    }
    v_exact, msg_exact = evaluate_target_category_policy(record, "EXACT_MATCH")
    assert v_exact == "NOT_OKAY"
    assert "Taxable difference is ₹500.00" in msg_exact

    v_tol, msg_tol = evaluate_target_category_policy(record, "TOLERANCE_MATCH")
    assert v_tol == "NOT_OKAY"
    assert "exceeds allowable enterprise tolerance threshold" in msg_tol
