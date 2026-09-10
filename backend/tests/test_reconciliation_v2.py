from pathlib import Path
import pytest
from fastapi.testclient import TestClient

from app.domain.models import DatasetRole
from app.main import create_app
from app.services.direct_schema_correlator import DirectSchemaCorrelator
from app.services.fast_excel_parser import FastExcelParser


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
    assert data2["date_tolerance_unit"] == "days"

    # 3. Compile empty prompt returns 400
    res3 = client.post(
        "/api/reconciliations-v2/rules-v2/compile-ai",
        json={"prompt": "   ", "available_columns": []},
    )
    assert res3.status_code == 400

