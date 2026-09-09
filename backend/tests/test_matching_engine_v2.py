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

