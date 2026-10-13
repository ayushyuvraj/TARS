import pandas as pd
import pytest

from app.services.matching_engine_v5 import (
    WaterfallMatchingEngineV5,
    build_default_rules_v5,
    simulate_rules_v5,
)


def test_v5_rule1_banking_multi_tranche_consolidation():
    """Client Rule 1 (Recon 5.0): Two GSTR banking charge rows matching one PR accounting journal entry."""
    gstr_df = pd.DataFrame([
        {
            "SupplierGstin": "27AAACB1234M1Z1",
            "InvoiceNumber": "INV/06/2026/001",
            "InvoiceDate": "05-Jun-2026",
            "TaxableValue": 1000.0,
            "IgstAmount": 90.0,
            "CgstAmount": 0.0,
            "SgstAmount": 0.0,
        },
        {
            "SupplierGstin": "27AAACB1234M1Z1",
            "InvoiceNumber": "INV/06/2026/002",
            "InvoiceDate": "15-Jun-2026",
            "TaxableValue": 500.0,
            "IgstAmount": 45.0,
            "CgstAmount": 0.0,
            "SgstAmount": 0.0,
        },
    ])
    pr_df = pd.DataFrame([
        {
            "SupplierGstin": "27AAACB1234M1Z1",
            "InvoiceNumber": "Voucher BANK-CHG/JUN-26",
            "InvoiceDate": "30-Jun-2026",
            "TaxableValue": 1500.0,
            "IgstAmount": 135.0,
            "CgstAmount": 0.0,
            "SgstAmount": 0.0,
        }
    ])

    engine = WaterfallMatchingEngineV5()
    res = engine.execute_waterfall(gstr_df, pr_df, session_id="test-v5-r1")
    assert res.summary.consolidated_matches >= 1
    assert any(r.tars_verdict == "Consolidated Match" for r in res.records)
    # Check that constituent items are preserved
    consolidated_recs = [r for r in res.records if r.tars_verdict == "Consolidated Match"]
    assert len(consolidated_recs) > 0
    assert len(consolidated_recs[0].constituent_items) >= 1


def test_v5_rule2_ineligible_itc_section_17_5():
    """Client Rule 2 (Recon 5.0): Portal has full 10,000, PR books only eligible 1,000."""
    gstr_df = pd.DataFrame([
        {
            "SupplierGstin": "06AAACF7654L1Z8",
            "InvoiceNumber": "INV-4410",
            "InvoiceDate": "10-Jul-2026",
            "TaxableValue": 10000.0,
            "IgstAmount": 1800.0,
            "CgstAmount": 0.0,
            "SgstAmount": 0.0,
        }
    ])
    pr_df = pd.DataFrame([
        {
            "SupplierGstin": "06AAACF7654L1Z8",
            "InvoiceNumber": "INV-4410",
            "InvoiceDate": "10-Jul-2026",
            "TaxableValue": 1000.0,
            "IgstAmount": 180.0,
            "CgstAmount": 0.0,
            "SgstAmount": 0.0,
        }
    ])

    engine = WaterfallMatchingEngineV5()
    res = engine.execute_waterfall(gstr_df, pr_df, session_id="test-v5-r2")
    assert res.summary.ineligible_itc_matches == 1
    rec = res.records[0]
    assert rec.tars_verdict == "Ineligible ITC [Sec 17(5)]"
    assert rec.sub_classification == "INELIGIBLE_ITC_17_5"


def test_v5_rule3_document_date_variation_month_shift():
    """Client Rule 3 (Recon 5.0): Invoice booked 3 days late across month boundary (28-Feb vs 03-Mar)."""
    gstr_df = pd.DataFrame([
        {
            "SupplierGstin": "24AAGCS1234N1ZP",
            "InvoiceNumber": "SUP/2026/0456",
            "InvoiceDate": "28-Feb-2026",
            "TaxableValue": 50000.0,
            "IgstAmount": 4500.0,
            "CgstAmount": 0.0,
            "SgstAmount": 0.0,
        }
    ])
    pr_df = pd.DataFrame([
        {
            "SupplierGstin": "24AAGCS1234N1ZP",
            "InvoiceNumber": "SUP/2026/0456",
            "InvoiceDate": "03-Mar-2026",
            "TaxableValue": 50000.0,
            "IgstAmount": 4500.0,
            "CgstAmount": 0.0,
            "SgstAmount": 0.0,
        }
    ])

    engine = WaterfallMatchingEngineV5()
    res = engine.execute_waterfall(gstr_df, pr_df, session_id="test-v5-r3")
    assert res.summary.tolerance_matches == 1
    rec = res.records[0]
    assert rec.tars_verdict == "Tolerance Match"
    assert rec.sub_classification == "DATE_OPERATIONAL_SHIFT"


def test_v5_rule4_cross_financial_year_cutoff():
    """Client Rule 4 (Recon 5.0): Invoice dated 31-Mar (FY 2025-26) booked 02-Apr (FY 2026-27)."""
    gstr_df = pd.DataFrame([
        {
            "SupplierGstin": "27AAFCX5678P1Z2",
            "InvoiceNumber": "XYZ/998",
            "InvoiceDate": "31-Mar-2026",
            "TaxableValue": 75000.0,
            "IgstAmount": 13500.0,
            "CgstAmount": 0.0,
            "SgstAmount": 0.0,
        }
    ])
    pr_df = pd.DataFrame([
        {
            "SupplierGstin": "27AAFCX5678P1Z2",
            "InvoiceNumber": "XYZ/998",
            "InvoiceDate": "02-Apr-2026",
            "TaxableValue": 75000.0,
            "IgstAmount": 13500.0,
            "CgstAmount": 0.0,
            "SgstAmount": 0.0,
        }
    ])

    engine = WaterfallMatchingEngineV5()
    res = engine.execute_waterfall(gstr_df, pr_df, session_id="test-v5-r4")
    assert res.summary.tolerance_matches == 1
    rec = res.records[0]
    assert rec.tars_verdict == "Tolerance Match"
    assert rec.sub_classification == "CROSS_FY_TIMING_LAG"


def test_v5_rule5_tax_head_interchange_igst_cgst_sgst():
    """Client Rule 5 (Recon 5.0): GSTR has IGST 1800, PR has CGST 900 + SGST 900 (same total tax)."""
    gstr_df = pd.DataFrame([
        {
            "SupplierGstin": "29AABCU9876Q1ZM",
            "InvoiceNumber": "DEL/INV/012",
            "InvoiceDate": "14-Aug-2026",
            "TaxableValue": 10000.0,
            "IgstAmount": 1800.0,
            "CgstAmount": 0.0,
            "SgstAmount": 0.0,
        }
    ])
    pr_df = pd.DataFrame([
        {
            "SupplierGstin": "29AABCU9876Q1ZM",
            "InvoiceNumber": "DEL/INV/012",
            "InvoiceDate": "14-Aug-2026",
            "TaxableValue": 10000.0,
            "IgstAmount": 0.0,
            "CgstAmount": 900.0,
            "SgstAmount": 900.0,
        }
    ])

    engine = WaterfallMatchingEngineV5()
    res = engine.execute_waterfall(gstr_df, pr_df, session_id="test-v5-r5")
    assert res.summary.near_matches == 1
    rec = res.records[0]
    assert rec.tars_verdict == "Probable Near Match"
    assert rec.sub_classification == "TAX_HEAD_INTERCHANGE"


def test_v5_rule7_strict_exact_match():
    """Client Rule 7 (Recon 5.0): Strict 1-to-1 exact equality across all parameters."""
    gstr_df = pd.DataFrame([
        {
            "SupplierGstin": "27AAACB1234M1Z1",
            "InvoiceNumber": "INV-2026-001",
            "InvoiceDate": "12-May-2026",
            "TaxableValue": 25000.0,
            "IgstAmount": 4500.0,
            "CgstAmount": 0.0,
            "SgstAmount": 0.0,
        }
    ])
    pr_df = pd.DataFrame([
        {
            "SupplierGstin": "27AAACB1234M1Z1",
            "InvoiceNumber": "INV-2026-001",
            "InvoiceDate": "12-May-2026",
            "TaxableValue": 25000.0,
            "IgstAmount": 4500.0,
            "CgstAmount": 0.0,
            "SgstAmount": 0.0,
        }
    ])

    engine = WaterfallMatchingEngineV5()
    res = engine.execute_waterfall(gstr_df, pr_df, session_id="test-v5-r7")
    assert res.summary.exact_matches == 1
    rec = res.records[0]
    assert rec.tars_verdict == "Exact Match"
    assert rec.rule_tier == "Tier 1: Deterministic Core"


def test_v5_rule8_multi_candidate_ambiguity():
    """Client Rule 8 (Recon 5.0): GSTR invoice matches multiple PR candidates with same value."""
    gstr_df = pd.DataFrame([
        {
            "SupplierGstin": "27AAACB1234M1Z1",
            "InvoiceNumber": "BATCH-001",
            "InvoiceDate": "15-May-2026",
            "TaxableValue": 10000.0,
            "IgstAmount": 1800.0,
            "CgstAmount": 0.0,
            "SgstAmount": 0.0,
        }
    ])
    pr_df = pd.DataFrame([
        {
            "SupplierGstin": "27AAACB1234M1Z1",
            "InvoiceNumber": "CAND-A",
            "InvoiceDate": "15-May-2026",
            "TaxableValue": 10000.0,
            "IgstAmount": 1800.0,
            "CgstAmount": 0.0,
            "SgstAmount": 0.0,
        },
        {
            "SupplierGstin": "27AAACB1234M1Z1",
            "InvoiceNumber": "CAND-B",
            "InvoiceDate": "16-May-2026",
            "TaxableValue": 10000.0,
            "IgstAmount": 1800.0,
            "CgstAmount": 0.0,
            "SgstAmount": 0.0,
        },
    ])

    engine = WaterfallMatchingEngineV5()
    res = engine.execute_waterfall(gstr_df, pr_df, session_id="test-v5-r8")
    assert res.summary.ambiguous_matches >= 1 or len(res.ambiguities) >= 1
    assert any(r.tars_verdict == "Ambiguous Match" for r in res.records)


def test_v5_simulation_telemetry():
    """Verify simulate_rules_v5 returns proper synthetic dataset telemetry."""
    rules = build_default_rules_v5()
    res = simulate_rules_v5(rules, sample_size=30)
    assert res["status"] == "success"
    assert res["sample_size"] == 30
    assert "total_matched" in res
    assert "overall_match_rate" in res
    assert len(res["rule_breakdowns"]) == 8
