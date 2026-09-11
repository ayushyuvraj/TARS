from pathlib import Path
import pytest
from fastapi.testclient import TestClient

from app.domain.models import DatasetRole
from app.main import create_app
from app.services.direct_schema_correlator import DirectSchemaCorrelator
from app.services.fast_excel_parser import FastExcelParser
from app.services.audit_v2_service import audit_v2_service


def test_fast_excel_parser():
    parser = FastExcelParser()
    gov_path = Path("sample_data/POC_Government_GST_Aug2026.xlsx")
    profile = parser.parse_fast_profile(gov_path, DatasetRole.GOVERNMENT)

    assert profile.column_count == 17
    assert profile.role == DatasetRole.GOVERNMENT
    assert profile.extraction_time_ms < 1000  # Should be under 1 second
    assert len(profile.columns) == 17

    col_names = [c.name for c in profile.columns]
    assert "Counterparty_GSTIN" in col_names
    assert "Counterparty_Document_Number" in col_names
    assert "Taxable_Value" in col_names


def test_fast_excel_parser_streaming_large():
    parser = FastExcelParser()
    large_path = Path("sample_data/TARS_Government_GSTR2B_223cols_10000rows.xlsx")
    if large_path.exists():
        import time
        t0 = time.perf_counter()
        profile = parser.parse_fast_profile(large_path, DatasetRole.GOVERNMENT)
        t1 = time.perf_counter()
        # Even for 10,000 rows x 223 cols, streaming probe must finish in under 1 second!
        assert (t1 - t0) < 1.0
        assert profile.column_count > 0
        assert profile.detected_row_count_estimate == 10000 or profile.detected_row_count_estimate is None


def test_direct_schema_correlator_deterministic():
    parser = FastExcelParser()
    gov_path = Path("sample_data/POC_Government_GST_Aug2026.xlsx")
    pr_path = Path("sample_data/POC_Purchase_Register_Aug2026.xlsx")

    gov_prof = parser.parse_fast_profile(gov_path, DatasetRole.GOVERNMENT)
    pr_prof = parser.parse_fast_profile(pr_path, DatasetRole.PURCHASE_REGISTER)

    correlator = DirectSchemaCorrelator(llm_provider=None)
    result = correlator.correlate("test-session", gov_prof, pr_prof)

    assert result.total_gstr_columns == 17
    assert result.total_pr_columns == 17
    assert len(result.correlations) == 17
    assert len(result.agent_thoughts) >= 3

    # Primary GST fields should be deterministically matched
    gstin_corr = next((c for c in result.correlations if "gstin" in c.gstr_column.lower()), None)
    assert gstin_corr is not None
    assert gstin_corr.engine == "deterministic"
    assert gstin_corr.confidence >= 0.90


def test_v2_api_session_lifecycle():
    app = create_app()
    client = TestClient(app)

    # 1. Create V2 Session
    create_res = client.post("/api/reconciliations-v2")
    assert create_res.status_code == 201
    session_data = create_res.json()
    session_id = session_data["id"]
    assert session_data["status"] == "setup"

    # 2. Get V2 Session
    get_res = client.get(f"/api/reconciliations-v2/{session_id}")
    assert get_res.status_code == 200
    assert get_res.json()["id"] == session_id

    # 3. Fast upload & correlation
    gov_path = Path("sample_data/POC_Government_GST_Aug2026.xlsx")
    pr_path = Path("sample_data/POC_Purchase_Register_Aug2026.xlsx")

    with gov_path.open("rb") as f1, pr_path.open("rb") as f2:
        upload_res = client.post(
            f"/api/reconciliations-v2/{session_id}/fast-upload-and-correlate",
            files={
                "government_file": (gov_path.name, f1, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
                "purchase_file": (pr_path.name, f2, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
            },
        )
    assert upload_res.status_code == 200
    corr_data = upload_res.json()
    assert corr_data["total_gstr_columns"] == 17
    assert corr_data["total_pr_columns"] == 17
    assert len(corr_data["agent_thoughts"]) >= 3

    # 4. Confirm mapping
    confirm_res = client.post(
        f"/api/reconciliations-v2/{session_id}/mapping/confirm",
        json={"correlations": corr_data["correlations"]},
    )
    assert confirm_res.status_code == 200
    assert confirm_res.json()["status"] == "mapping_confirmed"


def test_v2_api_fast_upload_10k_benchmark():
    gov_path = Path("sample_data/TARS_Government_GSTR2B_223cols_10000rows.xlsx")
    pr_path = Path("sample_data/TARS_Purchase_Register_223cols_10500rows.xlsx")
    if not (gov_path.exists() and pr_path.exists()):
        return

    import time
    app = create_app()
    client = TestClient(app)

    create_res = client.post("/api/reconciliations-v2")
    assert create_res.status_code == 201
    session_id = create_res.json()["id"]

    t0 = time.perf_counter()
    with gov_path.open("rb") as f1, pr_path.open("rb") as f2:
        upload_res = client.post(
            f"/api/reconciliations-v2/{session_id}/fast-upload-and-correlate",
            files={
                "government_file": (gov_path.name, f1, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
                "purchase_file": (pr_path.name, f2, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
            },
        )
    t1 = time.perf_counter()
    assert upload_res.status_code == 200
    corr = upload_res.json()
    assert corr["total_gstr_columns"] == 223
    assert corr["total_pr_columns"] == 223
    assert len(corr["correlations"]) == 223
    print(f"\n[BENCHMARK] 10,000 rows x 223 cols fast upload & correlation total time: {t1 - t0:.2f}s")


def test_compile_ai_rule_endpoint():
    app = create_app()
    client = TestClient(app)

    # 1. Compile exact payment match
    res = client.post(
        "/api/reconciliations-v2/rules-v2/compile-ai",
        json={"prompt": "Payment amount must match exactly in both tables", "available_columns": ["PaymentAmount", "DocumentDate"]},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["name"] == "Payment Amount Match"
    assert data["canonical_concept"] == "payment_amount"
    assert data["strategy"] == "NUMERIC_TOLERANCE"
    assert data["tolerance_value"] == 0.0

    # 2. Compile date tolerance rule
    res2 = client.post(
        "/api/reconciliations-v2/rules-v2/compile-ai",
        json={"prompt": "Allow invoice date variance of 15 days", "available_columns": []},
    )
    assert res2.status_code == 200
    data2 = res2.json()
    assert data2["strategy"] == "DATE_PROXIMITY"
    assert data2["date_tolerance_value"] == 15
    assert data2["date_tolerance_unit"] in ("DAYS", "days")

    # 3. Compile empty prompt returns 400
    res3 = client.post(
        "/api/reconciliations-v2/rules-v2/compile-ai",
        json={"prompt": "   ", "available_columns": []},
    )
    assert res3.status_code == 400


def test_reclassify_ambiguity_candidate_unit():
    """Unit test for reclassify_ambiguity_candidate condition logic and plain-English AI narrative."""
    from app.services.matching_engine_v2 import reclassify_ambiguity_candidate, AmbiguityCandidate, ScoreBreakdown

    gstr_preview = {
        "document_number": "INV/2026/00100",
        "taxable_value": 50000.0,
        "tax_amount": 9000.0,
        "document_date": "2026-02-15",
    }

    # 1. Exact Match Candidate (Zero variance)
    cand_exact = AmbiguityCandidate(
        candidate_id="CAND-001",
        pr_row_index=10,
        pr_record_id="PR-00011",
        confidence_score=99.0,
        score_breakdown=ScoreBreakdown(invoice_similarity=100.0, amount_score=100.0, date_score=100.0, tax_score=100.0),
        detected_differences=[],
        ai_reason="Identical match",
        pr_preview={
            "document_number": "INV-2026-00100",
            "taxable_value": 50000.0,
            "tax_amount": 9000.0,
            "document_date": "2026-02-15",
        },
    )
    res_exact = reclassify_ambiguity_candidate(gstr_preview, cand_exact, candidate_count=3, action="CHOOSE")
    assert res_exact["bucket"] == "EXACT_MATCH"
    assert res_exact["reclassified_from"] == "AMBIGUOUS"
    assert "Exact Match" in res_exact["reclassification_note"]
    assert "Reclassified from Ambiguous (Pass 4) to Exact Match" in res_exact["classification_reason"]
    assert "Candidate PR-00011" in res_exact["classification_reason"]

    # 2. Tolerance Match Candidate (₹4.50 difference within ±₹10.00, 2 days delta)
    cand_tol = AmbiguityCandidate(
        candidate_id="CAND-002",
        pr_row_index=12,
        pr_record_id="PR-00013",
        confidence_score=94.0,
        score_breakdown=ScoreBreakdown(invoice_similarity=100.0, amount_score=95.0, date_score=95.0, tax_score=95.0),
        detected_differences=["Taxable diff ₹4.50"],
        ai_reason="Close match within tolerance",
        pr_preview={
            "document_number": "INV/2026/00100",
            "taxable_value": 50004.50,
            "tax_amount": 9000.81,
            "document_date": "2026-02-17",
        },
    )
    res_tol = reclassify_ambiguity_candidate(gstr_preview, cand_tol, candidate_count=3, action="CHOOSE")
    assert res_tol["bucket"] == "TOLERANCE_MATCH"
    assert res_tol["reclassified_from"] == "AMBIGUOUS"
    assert "Tolerance Match" in res_tol["reclassification_note"]
    assert "Reclassified from Ambiguous (Pass 4) to Tolerance Match" in res_tol["classification_reason"]
    assert "Taxable variance: ₹4.50" in res_tol["classification_reason"]

    # 3. Rejection (GSTR-2B Only)
    res_reject = reclassify_ambiguity_candidate(gstr_preview, None, candidate_count=3, action="REJECT")
    assert res_reject["bucket"] == "GSTR_ONLY"
    assert res_reject["reclassified_from"] == "AMBIGUOUS"
    assert "GSTR-2B Only" in res_reject["reclassification_note"]
    assert "rejected all of them as non-matching" in res_reject["classification_reason"]


def test_resolve_ambiguity_api_endpoint_lifecycle():
    """End-to-end API test verifying that resolved records are reclassified into canonical buckets without RESOLVED_MANUALLY."""
    from app.main import create_app
    from app.services.audit_v2_service import audit_v2_service
    from fastapi.testclient import TestClient

    app = create_app()
    client = TestClient(app)

    # Initialize a test session
    res = client.post("/api/reconciliations-v2", json={"client_name": "Reclassification Test Corp"})
    session_id = res.json()["id"]

    # Mock stage 4 results containing an ambiguity cluster and a PR_ONLY record
    mock_cluster = {
        "cluster_id": "CLUST-TEST01",
        "gstr_row_index": 5,
        "gstr_record_id": "GSTR-00006",
        "anchor_preview": {
            "document_number": "INV-777",
            "taxable_value": 10000.0,
            "tax_amount": 1800.0,
            "document_date": "2026-03-01",
        },
        "candidates": [
            {
                "candidate_id": "CAND-T01",
                "pr_row_index": 20,
                "pr_record_id": "PR-00021",
                "confidence_score": 96.5,
                "score_breakdown": {
                    "invoice_similarity": 100.0,
                    "amount_score": 98.0,
                    "date_score": 100.0,
                    "tax_score": 98.0,
                },
                "detected_differences": [],
                "ai_reason": "High confidence test match",
                "pr_preview": {
                    "document_number": "INV-777",
                    "taxable_value": 10003.0,
                    "tax_amount": 1800.54,
                    "document_date": "2026-03-01",
                },
            }
        ],
        "ai_justification": "Ambiguity test cluster",
        "status": "PENDING_REVIEW",
    }

    mock_rec_ambiguous = {
        "id": "REC-AMB-01",
        "bucket": "AMBIGUOUS",
        "gstr_row_index": 5,
        "pr_row_index": None,
        "gstr_record_id": "GSTR-00006",
        "pr_record_id": None,
        "gstin": "27AAAC1234Z1Z1",
        "document_number": "INV-777",
        "document_date": "2026-03-01",
        "taxable_value": 10000.0,
        "tax_amount": 1800.0,
        "total_value": 11800.0,
        "gstr_preview": {"document_number": "INV-777", "taxable_value": 10000.0, "tax_amount": 1800.0, "document_date": "2026-03-01"},
        "pr_preview": {},
        "variances": {"candidate_count": 1},
        "matched_by_pass": "Pass 4: Ambiguity Quarantined",
        "ambiguity_cluster_id": "CLUST-TEST01",
        "classification_reason": "Quarantined in Ambiguity",
        "ai_reason": "Quarantined in Ambiguity",
    }

    mock_rec_pr_only = {
        "id": "REC-PR-21",
        "bucket": "PR_ONLY",
        "gstr_row_index": None,
        "pr_row_index": 20,
        "gstr_record_id": None,
        "pr_record_id": "PR-00021",
        "gstin": "27AAAC1234Z1Z1",
        "document_number": "INV-777",
        "document_date": "2026-03-01",
        "taxable_value": 10003.0,
        "tax_amount": 1800.54,
        "total_value": 11803.54,
        "gstr_preview": {},
        "pr_preview": {"document_number": "INV-777", "taxable_value": 10003.0, "tax_amount": 1800.54, "document_date": "2026-03-01"},
        "variances": {},
        "matched_by_pass": "Pass 5: In Books Only",
        "classification_reason": "PR Only",
        "ai_reason": "PR Only",
    }

    mock_summary = {
        "total_gstr_rows": 10,
        "total_pr_rows": 10,
        "exact_match_count": 5,
        "exact_match_itc": 50000.0,
        "tolerance_match_count": 2,
        "tolerance_match_itc": 20000.0,
        "near_match_count": 1,
        "near_match_itc": 10000.0,
        "ambiguous_count": 1,
        "ambiguous_itc": 1800.0,
        "gstr_only_count": 1,
        "gstr_only_itc": 5000.0,
        "pr_only_count": 1,
        "pr_only_itc": 1800.54,
        "total_reconciled_count": 8,
        "total_reconciled_itc": 80000.0,
        "overall_reconciliation_rate": 80.0,
        "waterfall_passes": [
            {"tier": 1, "name": "Pass 1", "matched_count": 5, "matched_itc": 50000.0, "retention_percentage": 50.0},
            {"tier": 2, "name": "Pass 2", "matched_count": 2, "matched_itc": 20000.0, "retention_percentage": 20.0},
            {"tier": 3, "name": "Pass 3", "matched_count": 1, "matched_itc": 10000.0, "retention_percentage": 10.0},
            {"tier": 4, "name": "Pass 4", "matched_count": 1, "matched_itc": 1800.0, "retention_percentage": 10.0},
            {"tier": 5, "name": "Pass 5", "matched_count": 2, "matched_itc": 6800.54, "retention_percentage": 20.0},
        ],
    }

    cached_results = {
        "session_id": session_id,
        "ambiguities": [mock_cluster],
        "records": [mock_rec_ambiguous, mock_rec_pr_only],
        "summary": mock_summary,
        "compared_columns": [],
    }

    audit_v2_service.save_stage4_results(session_id, cached_results)

    # 1. Resolve candidate CAND-T01
    res_resolve = client.post(
        f"/api/reconciliations-v2/{session_id}/results/resolve-ambiguity",
        json={
            "cluster_id": "CLUST-TEST01",
            "chosen_candidate_id": "CAND-T01",
            "action": "CHOOSE",
        },
    )
    assert res_resolve.status_code == 200
    data = res_resolve.json()

    # Verify no RESOLVED_MANUALLY exists
    buckets = [r["bucket"] for r in data["records"]]
    assert "RESOLVED_MANUALLY" not in buckets

    # Verify the target record is reclassified into TOLERANCE_MATCH (diff is ₹3.00)
    resolved_rec = next(r for r in data["records"] if r["id"] == "REC-AMB-01")
    assert resolved_rec["bucket"] == "TOLERANCE_MATCH"
    assert resolved_rec["reclassified_from"] == "AMBIGUOUS"
    assert "Tolerance Match" in resolved_rec["reclassification_note"]
    assert "Reclassified from Ambiguous (Pass 4) to Tolerance Match" in resolved_rec["classification_reason"]
    assert "Candidate PR-00021" in resolved_rec["classification_reason"]

    # Verify that the PR_ONLY record for row index 20 was retired from records
    pr_row_indices = [r["pr_row_index"] for r in data["records"] if r["bucket"] == "PR_ONLY"]
    assert 20 not in pr_row_indices

    # Verify Summary counts
    assert data["summary"]["ambiguous_count"] == 0
    assert data["summary"]["tolerance_match_count"] == 3  # increased from 2 to 3
    assert data["summary"]["pr_only_count"] == 0         # decreased from 1 to 0
    assert data["summary"]["total_reconciled_count"] == 9  # increased from 8 to 9


def test_v2_export_endpoints():
    app = create_app()
    client = TestClient(app)

    # 1. Create V2 Session
    create_res = client.post("/api/reconciliations-v2")
    assert create_res.status_code == 201
    session_id = create_res.json()["id"]

    # 2. Mock Stage 4 results
    mock_record = {
        "id": "REC-EXP-01",
        "bucket": "EXACT_MATCH",
        "matched_by_pass": "Pass 1 - Strict Exact",
        "gstr_row_index": 1,
        "pr_row_index": 1,
        "gstin": "27AABCT3518Q1Z6",
        "document_number": "INV-2026-001",
        "document_date": "2026-08-15",
        "taxable_value": 50000.0,
        "tax_amount": 9000.0,
        "total_value": 59000.0,
        "pr_preview": {
            "document_number": "INV-2026-001",
            "document_date": "2026-08-15",
            "taxable_value": 50000.0,
            "tax_amount": 9000.0,
            "total_value": 59000.0,
        },
        "gstr_preview": {
            "BillFromGstin": "27AABCT3518Q1Z6",
            "DocumentNumber": "INV-2026-001",
            "DocumentDate": "2026-08-15",
            "TaxableValue": 50000.0,
            "TotalTaxAmount": 9000.0,
            "TotalValue": 59000.0,
        },
        "classification_reason": "Deterministic identity satisfied across GSTIN, Invoice, Date, and Tax Amount.",
        "reclassification_note": "Reclassified from Ambiguous (Pass 4) to Exact Match.",
    }

    mock_summary = {
        "total_gstr_rows": 1,
        "total_pr_rows": 1,
        "exact_match_count": 1,
        "exact_match_itc": 9000.0,
        "tolerance_match_count": 0,
        "tolerance_match_itc": 0.0,
        "near_match_count": 0,
        "near_match_itc": 0.0,
        "ambiguous_count": 0,
        "ambiguous_itc": 0.0,
        "gstr_only_count": 0,
        "gstr_only_itc": 0.0,
        "pr_only_count": 0,
        "pr_only_itc": 0.0,
        "total_reconciled_count": 1,
        "total_reconciled_itc": 9000.0,
        "overall_reconciliation_rate": 100.0,
        "waterfall_passes": [
            {"tier": 1, "name": "Pass 1 - Strict Exact", "matched_count": 1, "matched_itc": 9000.0, "retention_percentage": 100.0},
        ],
    }

    cached_results = {
        "session_id": session_id,
        "ambiguities": [],
        "records": [mock_record],
        "summary": mock_summary,
        "compared_columns": [
            {"gstr_column": "BillFromGstin", "pr_column": "Vendor_GSTIN", "match_strategy": "DETERMINISTIC"},
            {"gstr_column": "DocumentNumber", "pr_column": "Invoice_Number", "match_strategy": "DETERMINISTIC"},
        ],
    }
    audit_v2_service.save_stage4_results(session_id, cached_results)

    # 3. Test Preview endpoint
    preview_res = client.get(f"/api/reconciliations-v2/{session_id}/export/preview")
    assert preview_res.status_code == 200
    preview_data = preview_res.json()
    assert preview_data["total_records"] == 1
    assert len(preview_data["preview_records"]) == 1
    assert preview_data["preview_records"][0]["bucket"] == "EXACT_MATCH"
    assert preview_data["preview_records"][0]["provenance"] == "Reclassified from Ambiguous (Pass 4) to Exact Match."

    # 4. Test Excel Download
    xlsx_res = client.get(f"/api/reconciliations-v2/{session_id}/export/download?format=xlsx&color_coded=true")
    assert xlsx_res.status_code == 200
    assert "spreadsheetml.sheet" in xlsx_res.headers["content-type"]
    assert len(xlsx_res.content) > 1000  # Valid binary Excel file

    # 5. Test CSV Download
    csv_res = client.get(f"/api/reconciliations-v2/{session_id}/export/download?format=csv")
    assert csv_res.status_code == 200
    assert "text/csv" in csv_res.headers["content-type"]
    csv_text = csv_res.content.decode("utf-8")
    assert "Reconciliation_ID" in csv_text
    assert "Classification_Bucket" in csv_text
    assert "AI_Classification_Rationale" in csv_text
    assert "Lifecycle_Provenance_Trace" in csv_text
    assert "REC-EXP-01" in csv_text

    # 6. Test JSON Download
    json_res = client.get(f"/api/reconciliations-v2/{session_id}/export/download?format=json")
    assert json_res.status_code == 200
    assert "application/json" in json_res.headers["content-type"]
    json_data = json_res.json()
    assert json_data["session_id"] == session_id
    assert len(json_data["records"]) == 1

    # 7. Test Columns Catalog endpoint (Stage 6)
    cols_res = client.get(f"/api/reconciliations-v2/{session_id}/export/columns")
    assert cols_res.status_code == 200
    cols_data = cols_res.json()
    assert "families" in cols_data
    assert "CALCULATED" in cols_data["families"]
    assert "GSTR" in cols_data["families"]
    assert "PR" in cols_data["families"]
    assert len(cols_data["families"]["CALCULATED"]) >= 8

    # 8. Test Presets list and CRUD (Stage 6)
    presets_res = client.get("/api/reconciliations-v2/export/presets")
    assert presets_res.status_code == 200
    presets = presets_res.json()
    assert len(presets) >= 4
    preset_names = [p["name"] for p in presets]
    assert "KPMG Statutory Audit Package" in preset_names
    assert "360° Dual Ledger Complete Dump" in preset_names

    # 9. Test Custom Export endpoint with conditional formatting & column styling (XLSX, DSV)
    custom_payload = {
        "columns": [
            {"id": "calc_id", "alias": "Custom_Rec_ID", "header_color": "#00338D"},
            {"id": "calc_bucket", "alias": "Status_Badge"},
            {"id": "gstr_gstin", "alias": "Supplier_GSTIN"},
            {"id": "calc_tax_variance", "alias": "Tax_Disparity_INR"},
        ],
        "conditional_rules": [
            {
                "id": "cr_1",
                "column_id": "calc_tax_variance",
                "operator": "GREATER_THAN",
                "value1": "0",
                "bg_color": "#FEE2E2",
                "text_color": "#991B1B",
                "is_bold": True,
            }
        ],
        "export_format": "xlsx",
        "color_coded": True,
        "include_summary_sheet": True,
        "include_audit_sheet": False,
    }
    custom_res = client.post(f"/api/reconciliations-v2/{session_id}/export/custom", json=custom_payload)
    assert custom_res.status_code == 200
    assert "spreadsheetml.sheet" in custom_res.headers["content-type"]
    assert len(custom_res.content) > 1000

    # 10. Test Custom DSV Pipe Export
    custom_payload["export_format"] = "dsv"
    custom_payload["delimiter"] = "|"
    dsv_res = client.post(f"/api/reconciliations-v2/{session_id}/export/custom", json=custom_payload)
    assert dsv_res.status_code == 200
    dsv_text = dsv_res.content.decode("utf-8")
    assert "Custom_Rec_ID|Status_Badge|Supplier_GSTIN|Tax_Disparity_INR" in dsv_text




