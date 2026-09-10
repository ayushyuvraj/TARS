from __future__ import annotations

import pandas as pd
import pytest

from app.services.matching_engine_v2 import (
    FieldMatchRule,
    MatchingPass,
    MatchStrategy,
    NormalizationType,
    ValueNormalizer,
    WaterfallMatchingEngine,
    build_default_waterfall,
)


def test_value_normalizer():
    # 1. Whitespace
    assert ValueNormalizer.normalize_text("  27AAAAA0000A1Z5   ", [NormalizationType.TRIM_WHITESPACE]) == "27AAAAA0000A1Z5"

    # 2. Special Characters
    assert ValueNormalizer.normalize_text("INV/2026-08/99", [NormalizationType.STRIP_SPECIAL_CHARS]) == "INV20260899"

    # 3. Prefixes & Leading Zeros
    assert (
        ValueNormalizer.normalize_text(
            "INV-000452",
            [
                NormalizationType.STRIP_SPECIAL_CHARS,
                NormalizationType.REMOVE_PREFIXES,
                NormalizationType.TRIM_LEADING_ZEROS,
            ],
        )
        == "452"
    )

    # 4. Uppercase
    assert ValueNormalizer.normalize_text("gstin_test", [NormalizationType.UPPERCASE]) == "GSTIN_TEST"


def test_waterfall_matching_engine_simulation():
    # Setup test datasets
    gstr_data = {
        "ctin": [
            "27AAAAA0000A1Z5",  # Row 0: Exact match
            "27BBBBB1111B1Z2",  # Row 1: Normalized invoice match (INV-0099 vs 99)
            "27CCCCC2222C1Z8",  # Row 2: Tolerance match (+/- 5 INR, +/- 10 days)
            "27DDDDD3333D1Z0",  # Row 3: Unmatched row
        ],
        "inum": ["INV-101", "INV/0099", "BILL-300", "INV-999"],
        "val": [1000.00, 2500.00, 5000.00, 100.00],
        "dt": ["2026-08-01", "2026-08-05", "2026-08-10", "2026-08-12"],
    }

    pr_data = {
        "Supplier_GSTIN": [
            "27AAAAA0000A1Z5",  # Matches Row 0 exactly
            "27BBBBB1111B1Z2",  # Matches Row 1 after normalization
            "27CCCCC2222C1Z8",  # Matches Row 2 under tolerance
            "27EEEEE4444E1Z9",  # PR only
        ],
        "Invoice_No": ["INV-101", "99", "300", "PO-777"],
        "Taxable_Amount": [1000.00, 2500.00, 5004.50, 100.00],  # Row 2 has 4.50 INR diff
        "Invoice_Date": ["2026-08-01", "2026-08-05", "2026-08-18", "2026-08-12"],  # Row 2 has 8 days diff
    }

    gstr_df = pd.DataFrame(gstr_data)
    pr_df = pd.DataFrame(pr_data)

    correlations = [
        {"gstr_column": "ctin", "selected_pr_column": "Supplier_GSTIN", "canonical_concept": "gstin"},
        {"gstr_column": "inum", "selected_pr_column": "Invoice_No", "canonical_concept": "document_number"},
        {"gstr_column": "val", "selected_pr_column": "Taxable_Amount", "canonical_concept": "taxable_value"},
        {"gstr_column": "dt", "selected_pr_column": "Invoice_Date", "canonical_concept": "document_date"},
    ]

    waterfall = build_default_waterfall(correlations)
    assert len(waterfall) == 3

    engine = WaterfallMatchingEngine()
    result = engine.simulate(gstr_df, pr_df, waterfall)

    assert result.total_gstr_rows == 4
    assert result.total_pr_rows == 4
    assert result.total_matched == 3
    assert result.total_unmatched_gstr == 1
    assert result.total_unmatched_pr == 1
    assert result.overall_match_rate == 75.0

    # Verify breakdown per tier
    # Tier 1 (Exact) should claim Row 0
    t1 = next(w for w in result.waterfall if w.pass_id == "PASS-1-EXACT")
    assert t1.matched_count == 1
    assert t1.sample_matches[0].gstr_row_index == 0

    # Tier 2 (Normalized) should claim Row 1 (INV/0099 matched to 99)
    t2 = next(w for w in result.waterfall if w.pass_id == "PASS-2-NORMALIZED")
    assert t2.matched_count == 1
    assert t2.sample_matches[0].gstr_row_index == 1

    # Tier 3 (Tolerance) should claim Row 2 (diff 4.50 INR <= 10.00 and 8d <= 30d)
    t3 = next(w for w in result.waterfall if w.pass_id == "PASS-3-TOLERANCE")
    assert t3.matched_count == 1
    assert t3.sample_matches[0].gstr_row_index == 2


def test_simulation_on_poc_sample_files():
    from pathlib import Path

    sample_gov = Path("sample_data/POC_Government_GST_Aug2026.xlsx")
    sample_pr = Path("sample_data/POC_Purchase_Register_Aug2026.xlsx")

    if not (sample_gov.exists() and sample_pr.exists()):
        pytest.skip("Sample files not present")

    gov_df = pd.read_excel(sample_gov)
    pr_df = pd.read_excel(sample_pr)

    correlations = [
        {"gstr_column": "Counterparty_GSTIN", "selected_pr_column": "Vendor_GSTIN", "canonical_concept": "gstin"},
        {"gstr_column": "Counterparty_Document_Number", "selected_pr_column": "PR_Document_Number", "canonical_concept": "document_number"},
        {"gstr_column": "Taxable_Value", "selected_pr_column": "Taxable_Value", "canonical_concept": "taxable_value"},
        {"gstr_column": "Counterparty_Document_Date", "selected_pr_column": "PR_Document_Date", "canonical_concept": "document_date"},
    ]

    waterfall = build_default_waterfall(correlations)
    engine = WaterfallMatchingEngine()
    result = engine.simulate(gov_df, pr_df, waterfall)

    assert result.total_gstr_rows > 0
    assert result.total_pr_rows > 0
    assert result.total_matched > 0
    assert result.overall_match_rate > 50.0


def test_stage4_dynamic_multicolumn_waterfall():
    from app.services.matching_engine_v2 import WaterfallMatchingEngine

    # Test datasets with 4 rows each, including an extra commercial column "POS" / "PlaceOfSupply"
    gstr_df = pd.DataFrame({
        "Counterparty_GSTIN": ["27AAAAA0000A1Z5", "27BBBBB1111B1Z2", "27CCCCC2222C1Z8", "27DDDDD3333D1Z0"],
        "Counterparty_Document_Number": ["INV-101", "INV/0099", "BILL-300", "INV-999"],
        "Taxable_Value": [1000.00, 2500.00, 5000.00, 100.00],
        "Tax_Amount": [180.00, 450.00, 900.00, 18.00],
        "Total_Value": [1180.00, 2950.00, 5900.00, 118.00],
        "Counterparty_Document_Date": ["2026-08-01", "2026-08-05", "2026-08-10", "2026-08-12"],
        "POS": ["27-Maharashtra", "27-Maharashtra", "29-Karnataka", "27-Maharashtra"],
    })

    pr_df = pd.DataFrame({
        "Vendor_GSTIN": ["27AAAAA0000A1Z5", "27BBBBB1111B1Z2", "27CCCCC2222C1Z8", "27EEEEE4444E1Z9"],
        "PR_Document_Number": ["INV-101", "99", "BILL-300", "PO-777"],
        "Taxable_Value": [1000.00, 2500.00, 5004.50, 100.00],  # Row 2 has 4.50 INR variance
        "Tax_Amount": [180.00, 450.00, 900.00, 18.00],
        "Total_Value": [1180.00, 2950.00, 5904.50, 118.00],
        "PR_Document_Date": ["2026-08-01", "2026-08-05", "2026-09-20", "2026-08-12"],  # Row 2 date is 41 days off
        "PlaceOfSupply": ["27-Maharashtra", "27-Maharashtra", "29-Karnataka", "27-Maharashtra"],
    })

    # Test configuration:
    # 1. Active core rules (GSTIN, Doc#, Taxable Value, Tax Amount)
    # 2. Document Date is intentionally DISABLED by user sovereignty
    # 3. Extra Commercial Policy rule "Place of Supply" is ENABLED
    active_rules = [
        {
            "rule_id": "rule_gstin",
            "rule_name": "Supplier GSTIN",
            "gstr_column": "Counterparty_GSTIN",
            "pr_column": "Vendor_GSTIN",
            "canonical_concept": "gstin",
            "strategy": "EXACT",
            "is_enabled": True,
            "rule_tier": "CORE_STATUTORY",
        },
        {
            "rule_id": "rule_doc",
            "rule_name": "Document Number",
            "gstr_column": "Counterparty_Document_Number",
            "pr_column": "PR_Document_Number",
            "canonical_concept": "document_number",
            "strategy": "NORMALIZED_TEXT",
            "is_enabled": True,
            "rule_tier": "CORE_STATUTORY",
        },
        {
            "rule_id": "rule_date",
            "rule_name": "Document Date",
            "gstr_column": "Counterparty_Document_Date",
            "pr_column": "PR_Document_Date",
            "canonical_concept": "document_date",
            "strategy": "DATE_PROXIMITY",
            "date_tolerance_value": 30,
            "is_enabled": False,  # DISABLED BY USER - ENGINE MUST OBEY AND NOT REJECT ROW 2 ON DATE!
            "rule_tier": "CORE_STATUTORY",
        },
        {
            "rule_id": "rule_taxable",
            "rule_name": "Taxable Value",
            "gstr_column": "Taxable_Value",
            "pr_column": "Taxable_Value",
            "canonical_concept": "taxable_value",
            "strategy": "NUMERIC_TOLERANCE",
            "tolerance_value": 10.0,
            "tolerance_mode": "ABSOLUTE_INR",
            "is_enabled": True,
            "rule_tier": "CORE_STATUTORY",
        },
        {
            "rule_id": "rule_pos",
            "rule_name": "Place of Supply",
            "gstr_column": "POS",
            "pr_column": "PlaceOfSupply",
            "strategy": "EXACT",
            "is_enabled": True,
            "rule_tier": "COMMERCIAL_POLICY",
        },
    ]

    engine = WaterfallMatchingEngine()
    resp = engine.execute_stage4_waterfall(gstr_df, pr_df, rules=active_rules, session_id="test-session")

    # 1. Assert response structure
    assert resp.summary.total_gstr_rows == 4
    assert resp.summary.total_pr_rows == 4
    assert len(resp.compared_columns) == 4  # 4 enabled rules (date was disabled)

    # Check compared columns metadata contains POS
    pos_col = next((c for c in resp.compared_columns if c.rule_name == "Place of Supply"), None)
    assert pos_col is not None
    assert pos_col.gstr_column == "POS"
    assert pos_col.pr_column == "PlaceOfSupply"

    # 2. Check records classifications
    records = {r.gstr_row_index: r for r in resp.records if r.gstr_row_index is not None}

    # Row 0: Exact Match
    rec0 = records[0]
    assert rec0.bucket == "EXACT_MATCH"
    assert "Exact" in rec0.classification_reason
    assert "Place of Supply" in rec0.classification_reason
    assert rec0.gstr_preview.get("POS") == "27-Maharashtra"
    assert rec0.pr_preview.get("PlaceOfSupply") == "27-Maharashtra"

    # Row 1: Normalized Near Match (INV/0099 vs 99)
    rec1 = records[1]
    assert rec1.bucket == "NEAR_MATCH"
    assert "Document" in rec1.classification_reason or "normalization" in rec1.classification_reason

    # Row 2: Tolerance Match (+4.50 INR diff, date 41d diff ignored because date rule was disabled!)
    rec2 = records[2]
    assert rec2.bucket == "TOLERANCE_MATCH"
    assert "Taxable Value" in rec2.classification_reason
    assert "4.50" in rec2.classification_reason

    # Row 3: Single-sided GSTR Only
    rec3 = records[3]
    assert rec3.bucket == "GSTR_ONLY"
    assert "GSTR-2B Only" in rec3.classification_reason or "Unclaimed Credit" in rec3.classification_reason

