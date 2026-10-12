import pandas as pd
import pytest

from app.services.matching_engine_v4 import (
    WaterfallMatchingEngineV4,
    build_default_rules_v4,
)


def test_rule1_banking_multi_tranche_consolidation():
    """Client Rule 1: Bank charges consolidated into single accounting journal entry."""
    df = pd.DataFrame([
        {
            "CPGstin": "27AAACB1234M1Z1",
            "PRGstin": "27AAACB1234M1Z1",
            "CPDocumentNumber": "INV/06/2026/001",
            "PRDocumentNumber": "Voucher BANK-CHG/JUN-26",
            "CPDocumentDate": "05-Jun-2026",
            "PRDocumentDate": "30-Jun-2026",
            "CPTaxableValue": 1000.0,
            "PRTaxableValue": 1800.0,
            "CPIgstAmount": 90.0,
            "PRIgstAmount": 162.0,
        },
        {
            "CPGstin": "27AAACB1234M1Z1",
            "PRGstin": "27AAACB1234M1Z1",
            "CPDocumentNumber": "INV/06/2026/002",
            "PRDocumentNumber": "Voucher BANK-CHG/JUN-26",
            "CPDocumentDate": "15-Jun-2026",
            "PRDocumentDate": "30-Jun-2026",
            "CPTaxableValue": 500.0,
            "PRTaxableValue": 1800.0,
            "CPIgstAmount": 45.0,
            "PRIgstAmount": 162.0,
        },
    ])
    engine = WaterfallMatchingEngineV4()
    res = engine.execute_waterfall(df, session_id="test-r1")
    assert res.summary.consolidated_matches >= 1
    assert any(r.tars_verdict == "Consolidated Match" for r in res.records)


def test_rule2_ineligible_itc_section_17_5():
    """Client Rule 2: Full invoice reported on portal, only eligible portion booked in books."""
    df = pd.DataFrame([
        {
            "CPGstin": "06AAACF7654L1Z8",
            "PRGstin": "06AAACF7654L1Z8",
            "CPDocumentNumber": "INV-4410",
            "PRDocumentNumber": "INV-4410",
            "CPDocumentDate": "10-Jul-2026",
            "PRDocumentDate": "10-Jul-2026",
            "CPTaxableValue": 10000.0,
            "PRTaxableValue": 1000.0,
            "CPIgstAmount": 1800.0,
            "PRIgstAmount": 180.0,
        }
    ])
    engine = WaterfallMatchingEngineV4()
    res = engine.execute_waterfall(df, session_id="test-r2")
    assert res.summary.ineligible_itc_matches == 1
    rec = res.records[0]
    assert rec.tars_verdict == "Ineligible ITC [Sec 17(5)]"
    assert rec.sub_classification == "INELIGIBLE_ITC_17_5"


def test_rule3_document_date_variation_month_shift():
    """Client Rule 3: Invoice booked 3 days late across month boundary (28-Feb vs 03-Mar)."""
    df = pd.DataFrame([
        {
            "CPGstin": "24AAGCS1234N1ZP",
            "PRGstin": "24AAGCS1234N1ZP",
            "CPDocumentNumber": "SUP/2026/0456",
            "PRDocumentNumber": "SUP/2026/0456",
            "CPDocumentDate": "28-Feb-2026",
            "PRDocumentDate": "03-Mar-2026",
            "CPTaxableValue": 50000.0,
            "PRTaxableValue": 50000.0,
            "CPIgstAmount": 4500.0,
            "PRIgstAmount": 4500.0,
        }
    ])
    engine = WaterfallMatchingEngineV4()
    res = engine.execute_waterfall(df, session_id="test-r3")
    assert res.summary.tolerance_matches == 1
    rec = res.records[0]
    assert rec.tars_verdict == "Tolerance Match"
    assert rec.sub_classification == "DATE_OPERATIONAL_SHIFT"


def test_rule4_cross_financial_year_cutoff():
    """Client Rule 4: Invoice dated 31-Mar (FY 2025-26) booked 02-Apr (FY 2026-27)."""
    df = pd.DataFrame([
        {
            "CPGstin": "27AAFCX5678P1Z2",
            "PRGstin": "27AAFCX5678P1Z2",
            "CPDocumentNumber": "XYZ/998",
            "PRDocumentNumber": "XYZ/998",
            "CPDocumentDate": "31-Mar-2026",
            "PRDocumentDate": "02-Apr-2026",
            "CPTaxableValue": 20000.0,
            "PRTaxableValue": 20000.0,
            "CPIgstAmount": 3600.0,
            "PRIgstAmount": 3600.0,
        }
    ])
    engine = WaterfallMatchingEngineV4()
    res = engine.execute_waterfall(df, session_id="test-r4")
    assert res.summary.tolerance_matches == 1
    rec = res.records[0]
    assert rec.tars_verdict == "Tolerance Match"
    assert rec.sub_classification == "CROSS_FY_TIMING"


def test_rule5_document_number_prefix_dropped():
    """Client Rule 5: Prefix dropped during manual entry ('INV/2026/00123' vs '00123')."""
    df = pd.DataFrame([
        {
            "CPGstin": "07AACCK3456Q1Z6",
            "PRGstin": "07AACCK3456Q1Z6",
            "CPDocumentNumber": "INV/2026/00123",
            "PRDocumentNumber": "00123",
            "CPDocumentDate": "12-Aug-2026",
            "PRDocumentDate": "12-Aug-2026",
            "CPTaxableValue": 75000.0,
            "PRTaxableValue": 75000.0,
            "CPIgstAmount": 13500.0,
            "PRIgstAmount": 13500.0,
        }
    ])
    engine = WaterfallMatchingEngineV4()
    res = engine.execute_waterfall(df, session_id="test-r5")
    assert res.summary.near_matches == 1
    rec = res.records[0]
    assert rec.tars_verdict == "Near Match"
    assert rec.sub_classification == "DOC_PREFIX_NORMALIZED"


def test_rule6_compound_doc_number_and_date_variation():
    """Client Rule 6: Both hyphen stripped ('SUPP-4521' vs 'SUPP4521') AND 5 days date displacement."""
    df = pd.DataFrame([
        {
            "CPGstin": "29AAJCM7890R1Z4",
            "PRGstin": "29AAJCM7890R1Z4",
            "CPDocumentNumber": "SUPP-4521",
            "PRDocumentNumber": "SUPP4521",
            "CPDocumentDate": "15-Jan-2026",
            "PRDocumentDate": "20-Jan-2026",
            "CPTaxableValue": 75000.0,
            "PRTaxableValue": 75000.0,
            "CPIgstAmount": 6750.0,
            "PRIgstAmount": 6750.0,
        }
    ])
    engine = WaterfallMatchingEngineV4()
    res = engine.execute_waterfall(df, session_id="test-r6")
    assert res.summary.near_matches == 1
    rec = res.records[0]
    assert rec.tars_verdict == "Near Match"
    assert rec.sub_classification in ("COMPOUND_DOC_DATE_VARIATION", "DOC_PREFIX_NORMALIZED")


def test_rule1_true_n_to_1_repeated_voucher():
    """Client Rule 1 True N:1: 3 GSTR supplier invoices totaling ₹1,800 matching 1 consolidated PR journal voucher."""
    df = pd.DataFrame([
        {
            "CPGstin": "27AAACB1234M1Z1",
            "PRGstin": "27AAACB1234M1Z1",
            "CPDocumentNumber": "INV/06/2026/001",
            "PRDocumentNumber": "Voucher BANK-CHG/JUN-26",
            "CPDocumentDate": "05-Jun-2026",
            "PRDocumentDate": "30-Jun-2026",
            "CPTaxableValue": 1000.0,
            "PRTaxableValue": 1800.0,
            "CPIgstAmount": 90.0,
            "PRIgstAmount": 162.0,
        },
        {
            "CPGstin": "27AAACB1234M1Z1",
            "PRGstin": "27AAACB1234M1Z1",
            "CPDocumentNumber": "INV/06/2026/002",
            "PRDocumentNumber": "Voucher BANK-CHG/JUN-26",
            "CPDocumentDate": "15-Jun-2026",
            "PRDocumentDate": "30-Jun-2026",
            "CPTaxableValue": 500.0,
            "PRTaxableValue": 1800.0,
            "CPIgstAmount": 45.0,
            "PRIgstAmount": 162.0,
        },
        {
            "CPGstin": "27AAACB1234M1Z1",
            "PRGstin": "27AAACB1234M1Z1",
            "CPDocumentNumber": "INV/06/2026/003",
            "PRDocumentNumber": "Voucher BANK-CHG/JUN-26",
            "CPDocumentDate": "25-Jun-2026",
            "PRDocumentDate": "30-Jun-2026",
            "CPTaxableValue": 300.0,
            "PRTaxableValue": 1800.0,
            "CPIgstAmount": 27.0,
            "PRIgstAmount": 162.0,
        },
    ])
    engine = WaterfallMatchingEngineV4()
    res = engine.execute_waterfall(df, session_id="test-r1-n1")
    assert res.summary.consolidated_matches == 3
    for r in res.records:
        assert r.tars_verdict == "Consolidated Match"
        assert r.sub_classification == "BANKING_MULTI_TRANCHE"
        assert r.taxable_diff == 0.0
        assert "N:1" in r.classification_reason
        assert r.variances.get("batch_type") == "N:1"
        assert r.variances.get("batch_sum") == 1800.0


def test_rule1_true_1_to_n_repeated_invoice():
    """Client Rule 1 True 1:N: 1 GSTR supplier invoice (₹10,000) matching 3 partial PR vouchers (₹3,000 + ₹3,000 + ₹4,000)."""
    df = pd.DataFrame([
        {
            "CPGstin": "27BBBCB5678M1Z2",
            "PRGstin": "27BBBCB5678M1Z2",
            "CPDocumentNumber": "MASTER-INV-100",
            "PRDocumentNumber": "GRN-01-PARTIAL",
            "CPDocumentDate": "10-Jul-2026",
            "PRDocumentDate": "12-Jul-2026",
            "CPTaxableValue": 10000.0,
            "PRTaxableValue": 3000.0,
            "CPIgstAmount": 1800.0,
            "PRIgstAmount": 540.0,
        },
        {
            "CPGstin": "27BBBCB5678M1Z2",
            "PRGstin": "27BBBCB5678M1Z2",
            "CPDocumentNumber": "MASTER-INV-100",
            "PRDocumentNumber": "GRN-02-PARTIAL",
            "CPDocumentDate": "10-Jul-2026",
            "PRDocumentDate": "18-Jul-2026",
            "CPTaxableValue": 10000.0,
            "PRTaxableValue": 3000.0,
            "CPIgstAmount": 1800.0,
            "PRIgstAmount": 540.0,
        },
        {
            "CPGstin": "27BBBCB5678M1Z2",
            "PRGstin": "27BBBCB5678M1Z2",
            "CPDocumentNumber": "MASTER-INV-100",
            "PRDocumentNumber": "GRN-03-FINAL",
            "CPDocumentDate": "10-Jul-2026",
            "PRDocumentDate": "25-Jul-2026",
            "CPTaxableValue": 10000.0,
            "PRTaxableValue": 4000.0,
            "CPIgstAmount": 1800.0,
            "PRIgstAmount": 720.0,
        },
    ])
    engine = WaterfallMatchingEngineV4()
    res = engine.execute_waterfall(df, session_id="test-r1-1n")
    assert res.summary.consolidated_matches == 3
    for r in res.records:
        assert r.tars_verdict == "Consolidated Match"
        assert r.sub_classification == "BANKING_MULTI_TRANCHE"
        assert r.taxable_diff == 0.0
        assert "1:N" in r.classification_reason
        assert r.variances.get("batch_type") == "1:N"
        assert r.variances.get("batch_sum") == 10000.0


def test_rule1_true_n_to_1_disjoint_unrolled():
    """Client Rule 1 Disjoint N:1: 3 single-sided GSTR lines aggregating to 1 single-sided PR journal voucher."""
    df = pd.DataFrame([
        {
            "CPGstin": "27CCCCB9999M1Z9",
            "PRGstin": "",
            "CPDocumentNumber": "INV-A",
            "PRDocumentNumber": "",
            "CPDocumentDate": "01-Aug-2026",
            "PRDocumentDate": "",
            "CPTaxableValue": 1000.0,
            "PRTaxableValue": 0.0,
            "CPIgstAmount": 180.0,
            "PRIgstAmount": 0.0,
        },
        {
            "CPGstin": "27CCCCB9999M1Z9",
            "PRGstin": "",
            "CPDocumentNumber": "INV-B",
            "PRDocumentNumber": "",
            "CPDocumentDate": "05-Aug-2026",
            "PRDocumentDate": "",
            "CPTaxableValue": 500.0,
            "PRTaxableValue": 0.0,
            "CPIgstAmount": 90.0,
            "PRIgstAmount": 0.0,
        },
        {
            "CPGstin": "27CCCCB9999M1Z9",
            "PRGstin": "",
            "CPDocumentNumber": "INV-C",
            "PRDocumentNumber": "",
            "CPDocumentDate": "12-Aug-2026",
            "PRDocumentDate": "",
            "CPTaxableValue": 300.0,
            "PRTaxableValue": 0.0,
            "CPIgstAmount": 54.0,
            "PRIgstAmount": 0.0,
        },
        {
            "CPGstin": "",
            "PRGstin": "27CCCCB9999M1Z9",
            "CPDocumentNumber": "",
            "PRDocumentNumber": "JV-CONSOL-AUG",
            "CPDocumentDate": "",
            "PRDocumentDate": "31-Aug-2026",
            "CPTaxableValue": 0.0,
            "PRTaxableValue": 1800.0,
            "CPIgstAmount": 0.0,
            "PRIgstAmount": 324.0,
        },
    ])
    engine = WaterfallMatchingEngineV4()
    res = engine.execute_waterfall(df, session_id="test-r1-n1-disjoint")
    assert res.summary.consolidated_matches == 4
    for r in res.records:
        assert r.tars_verdict == "Consolidated Match"
        assert r.sub_classification == "BANKING_MULTI_TRANCHE"
        assert r.taxable_diff == 0.0


def test_rule1_true_1_to_n_disjoint_unrolled():
    """Client Rule 1 Disjoint 1:N: 1 single-sided GSTR line aggregating from 3 single-sided PR lines."""
    df = pd.DataFrame([
        {
            "CPGstin": "27DDDCB8888M1Z8",
            "PRGstin": "",
            "CPDocumentNumber": "INV-MASTER",
            "PRDocumentNumber": "",
            "CPDocumentDate": "01-Sep-2026",
            "PRDocumentDate": "",
            "CPTaxableValue": 6000.0,
            "PRTaxableValue": 0.0,
            "CPIgstAmount": 1080.0,
            "PRIgstAmount": 0.0,
        },
        {
            "CPGstin": "",
            "PRGstin": "27DDDCB8888M1Z8",
            "CPDocumentNumber": "",
            "PRDocumentNumber": "PR-TRANCHE-1",
            "CPDocumentDate": "",
            "PRDocumentDate": "05-Sep-2026",
            "CPTaxableValue": 0.0,
            "PRTaxableValue": 2000.0,
            "CPIgstAmount": 0.0,
            "PRIgstAmount": 360.0,
        },
        {
            "CPGstin": "",
            "PRGstin": "27DDDCB8888M1Z8",
            "CPDocumentNumber": "",
            "PRDocumentNumber": "PR-TRANCHE-2",
            "CPDocumentDate": "",
            "PRDocumentDate": "12-Sep-2026",
            "CPTaxableValue": 0.0,
            "PRTaxableValue": 2000.0,
            "CPIgstAmount": 0.0,
            "PRIgstAmount": 360.0,
        },
        {
            "CPGstin": "",
            "PRGstin": "27DDDCB8888M1Z8",
            "CPDocumentNumber": "",
            "PRDocumentNumber": "PR-TRANCHE-3",
            "CPDocumentDate": "",
            "PRDocumentDate": "20-Sep-2026",
            "CPTaxableValue": 0.0,
            "PRTaxableValue": 2000.0,
            "CPIgstAmount": 0.0,
            "PRIgstAmount": 360.0,
        },
    ])
    engine = WaterfallMatchingEngineV4()
    res = engine.execute_waterfall(df, session_id="test-r1-1n-disjoint")
    assert res.summary.consolidated_matches == 4
    for r in res.records:
        assert r.tars_verdict == "Consolidated Match"
        assert r.sub_classification == "BANKING_MULTI_TRANCHE"
        assert r.taxable_diff == 0.0

