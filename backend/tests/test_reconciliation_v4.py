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
    assert res.summary.consolidated_matches == len(df)
    assert len(res.records) == len(df)
    r = res.records[0]
    assert r.tars_verdict == "Consolidated Match"
    assert r.sub_classification == "BANKING_MULTI_TRANCHE"
    assert r.taxable_diff == 0.0
    assert "N:1" in r.classification_reason
    assert r.variances.get("batch_type") == "N:1"
    assert r.variances.get("batch_sum") == 1800.0
    assert len(r.batch_components) == 3


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
    assert res.summary.consolidated_matches == len(df)
    assert len(res.records) == len(df)
    r = res.records[0]
    assert r.tars_verdict == "Consolidated Match"
    assert r.sub_classification == "BANKING_MULTI_TRANCHE"
    assert r.taxable_diff == 0.0
    assert "1:N" in r.classification_reason
    assert r.variances.get("batch_type") == "1:N"
    assert r.variances.get("batch_sum") == 10000.0
    assert len(r.batch_components) == 3


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
    assert res.summary.consolidated_matches == len(df)
    assert len(res.records) == len(df)
    master_records = [rec for rec in res.records if len(rec.batch_components) > 0]
    assert len(master_records) == 1
    r = master_records[0]
    assert r.tars_verdict == "Consolidated Match"
    assert r.sub_classification == "BANKING_MULTI_TRANCHE"
    assert r.taxable_diff == 0.0
    assert len(r.batch_components) == 3


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
    assert res.summary.consolidated_matches == len(df)
    assert len(res.records) == len(df)
    master_records = [rec for rec in res.records if len(rec.batch_components) > 0]
    assert len(master_records) == 1
    r = master_records[0]
    assert r.tars_verdict == "Consolidated Match"
    assert r.sub_classification == "BANKING_MULTI_TRANCHE"
    assert r.taxable_diff == 0.0
    assert len(r.batch_components) == 3


def test_ambiguity_cluster_generation_and_api():
    """Verify that ambiguous records generate ambiguity clusters with >= 2 candidates, AI top pick, and can be resolved or reclassified via V4 endpoints."""
    from fastapi.testclient import TestClient
    from app.main import app

    client = TestClient(app)
    df = pd.DataFrame([
        {
            "CPGstin": "27AAACB9999M1Z9",
            "PRGstin": "27AAACB9999M1Z9",
            "CPDocumentNumber": "INV-CONFLICT-01",
            "PRDocumentNumber": "INV-CONFLICT-99",
            "CPDocumentDate": "01-Oct-2026",
            "PRDocumentDate": "20-Oct-2026",
            "CPTaxableValue": 5000.0,
            "PRTaxableValue": 4500.0,
            "CPIgstAmount": 900.0,
            "PRIgstAmount": 810.0,
        },
        {
            "CPGstin": "27AAACB9999M1Z9",
            "PRGstin": "27AAACB9999M1Z9",
            "CPDocumentNumber": "INV-CONFLICT-02",
            "PRDocumentNumber": "INV-CONFLICT-01-ALT",
            "CPDocumentDate": "01-Oct-2026",
            "PRDocumentDate": "03-Oct-2026",
            "CPTaxableValue": 1000.0,
            "PRTaxableValue": 4980.0,
            "CPIgstAmount": 180.0,
            "PRIgstAmount": 896.4,
        },
    ])
    engine = WaterfallMatchingEngineV4()
    res = engine.execute_waterfall(df, session_id="test-ambig-sess")
    assert res.summary.ambiguous >= 1
    assert len(res.ambiguities) >= 1
    cluster = res.ambiguities[0]
    assert cluster["cluster_id"].startswith("CLUST-V4-")
    assert len(cluster["candidates"]) >= 2
    assert cluster["candidates"][0]["confidence_score"] >= cluster["candidates"][1]["confidence_score"]
    assert "AI Top Pick" in cluster["candidates"][0]["ai_reason"]
    assert "Close Call" in cluster["candidates"][1]["ai_reason"]
    assert "AI Top Pick" in cluster["ai_justification"]

    # Test API endpoints
    sess_id = "V4-TEST-AMBIG-API"
    from app.api.reconciliations_v4 import _V4_SESSIONS
    _V4_SESSIONS[sess_id] = {
        "id": sess_id,
        "recon_type": "v4",
        "title": "Test V4 Session",
        "status": "reconciled",
        "current_stage": "results",
        "created_at": "2026-10-12T00:00:00Z",
        "rules_v4": [],
        "stage4_results": res.model_dump(),
    }
    rec_id = res.records[0].id

    # 1. Test recommend endpoint
    recom_res = client.post(f"/api/reconciliations-v4/{sess_id}/records/{rec_id}/recommend")
    assert recom_res.status_code == 200
    recom_data = recom_res.json()
    assert "recommended_bucket" in recom_data
    assert "confidence" in recom_data
    assert "category_policies" in recom_data

    # 2. Test reclassify endpoint with direct id
    reclass_res = client.post(
        f"/api/reconciliations-v4/{sess_id}/records/{rec_id}/reclassify",
        json={"target_bucket": "TOLERANCE_MATCH", "reviewer_note": "Approved manual tolerance override"}
    )
    assert reclass_res.status_code == 200
    reclass_data = reclass_res.json()
    target_rec = next(r for r in reclass_data["records"] if r["id"] == rec_id)
    assert target_rec["bucket"] == "TOLERANCE_MATCH"
    assert target_rec["reclassified_from"] == "AMBIGUOUS"

    # 3. Test reclassify endpoint with row index string "0"
    reclass_res2 = client.post(
        f"/api/reconciliations-v4/{sess_id}/records/0/reclassify",
        json={"target_bucket": "EXACT_MATCH", "reviewer_note": "Override to Exact Match by row index"}
    )
    assert reclass_res2.status_code == 200
    reclass_data2 = reclass_res2.json()
    target_rec2 = next(r for r in reclass_data2["records"] if r["id"] == rec_id)
    assert target_rec2["bucket"] == "EXACT_MATCH"

    # 4. Test reclassify endpoint with lowercase id
    reclass_res3 = client.post(
        f"/api/reconciliations-v4/{sess_id}/records/{rec_id.lower()}/reclassify",
        json={"target_bucket": "NEAR_MATCH", "reviewer_note": "Override to Near Match by lowercase id"}
    )
    assert reclass_res3.status_code == 200
    reclass_data3 = reclass_res3.json()
    target_rec3 = next(r for r in reclass_data3["records"] if r["id"] == rec_id)
    assert target_rec3["bucket"] == "NEAR_MATCH"

    # 5. Test resolve-ambiguity endpoint choosing Candidate #1
    clust_id = cluster["cluster_id"]
    cand_id = cluster["candidates"][0]["candidate_id"]
    resolve_res = client.post(
        f"/api/reconciliations-v4/{sess_id}/results/resolve-ambiguity",
        json={"cluster_id": clust_id, "chosen_candidate_id": cand_id, "action": "CHOOSE"}
    )
    assert resolve_res.status_code == 200
    resolve_data = resolve_res.json()
    resolved_cluster = next(c for c in resolve_data["ambiguities"] if c["cluster_id"] == clust_id)
    assert resolved_cluster["status"] == "RESOLVED"
    assert resolved_cluster["resolved_pr_record_id"] == cluster["candidates"][0]["pr_record_id"]


def test_stage6_export_universe_and_custom_dispatch():
    """Verify that Stage 6 Export Studio introspects the full Column Universe and supports custom export."""
    from uuid import uuid4
    from fastapi.testclient import TestClient
    from app.main import app
    from app.api.reconciliations_v4 import _V4_SESSIONS

    client = TestClient(app)
    sess_id = f"test-export-v4-{uuid4().hex[:6]}"

    # Setup session with synthetic records
    raw_df = pd.DataFrame([
        {
            "CPGstin": "27AABCU9603R1ZM",
            "PRGstin": "27AABCU9603R1ZM",
            "CPDocumentNumber": "INV-100",
            "PRDocumentNumber": "INV-100",
            "CPDocumentDate": "2026-06-01",
            "PRDocumentDate": "2026-06-01",
            "CPTaxableValue": 50000.0,
            "PRTaxableValue": 50000.0,
            "CPIgstAmount": 9000.0,
            "PRIgstAmount": 9000.0,
        }
    ])
    engine = WaterfallMatchingEngineV4()
    s4_res = engine.execute_waterfall(raw_df, session_id=sess_id)
    _V4_SESSIONS[sess_id] = {
        "id": sess_id,
        "recon_type": "v4",
        "title": "Test V4 Export Session",
        "status": "reconciled",
        "current_stage": "results",
        "created_at": "2026-10-13T00:00:00Z",
        "_cached_df": raw_df,
        "stage4_results": s4_res.model_dump(),
    }

    # 1. Test /export/columns endpoint
    cols_res = client.get(f"/api/reconciliations-v4/{sess_id}/export/columns")
    assert cols_res.status_code == 200, f"Expected 200, got {cols_res.status_code}: {cols_res.text}"
    cols_data = cols_res.json()
    assert "families" in cols_data
    assert cols_data["total_available_columns"] > 0
    assert len(cols_data["families"]["CALCULATED"]) >= 9
    assert len(cols_data["families"]["GSTR"]) >= 6
    assert len(cols_data["families"]["PR"]) >= 6

    # Verify key statutory and intel fields exist in the Column Universe
    calc_ids = [c["id"] for c in cols_data["families"]["CALCULATED"]]
    assert "calc_id" in calc_ids
    assert "calc_bucket" in calc_ids
    assert "calc_tars_verdict" in calc_ids
    assert "calc_concurrence" in calc_ids
    assert "calc_tax_variance" in calc_ids

    # 2. Test /export/presets endpoint
    presets_res = client.get("/api/reconciliations-v4/export/presets")
    assert presets_res.status_code == 200
    presets = presets_res.json()
    assert len(presets) >= 4
    preset_ids = [p["id"] for p in presets]
    assert "preset_kpmg_statutory" in preset_ids

    # 3. Test /export/preview endpoint
    prev_res = client.get(f"/api/reconciliations-v4/{sess_id}/export/preview?limit=10")
    assert prev_res.status_code == 200
    prev_data = prev_res.json()
    assert prev_data["total_records"] >= 1
    assert len(prev_data["preview_records"]) >= 1
    row = prev_data["preview_records"][0]
    assert "gstr_doc" in row
    assert "pr_doc" in row
    assert "gstr_taxable" in row
    assert "pr_taxable" in row

    # 4. Test /export/custom endpoint
    custom_req = {
        "export_format": "csv",
        "columns": [
            {"id": "calc_id", "alias": "Reconciliation ID"},
            {"id": "calc_bucket", "alias": "Status"},
            {"id": "gstr_document_number", "alias": "Invoice # (2B)"},
        ],
        "conditional_rules": [],
    }
    custom_res = client.post(f"/api/reconciliations-v4/{sess_id}/export/custom", json=custom_req)
    assert custom_res.status_code == 200
    assert "Reconciliation ID" in custom_res.text
    assert "INV-100" in custom_res.text

    # 5. Test /complete endpoint
    comp_res = client.post(f"/api/reconciliations-v4/{sess_id}/complete")
    assert comp_res.status_code == 200
    assert comp_res.json()["status"] == "completed"



