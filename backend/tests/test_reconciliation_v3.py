from pathlib import Path
import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.services.direct_schema_correlator_v3 import DirectSchemaCorrelatorV3
from app.services.matching_engine_v3 import (
    WaterfallMatchingEngineV3,
    build_default_rules_v3,
)

SAMPLE_FILE = Path("sample_data/TARS_KIGS_RECON_20000_Rows_All_Scenarios.xlsx")


def test_correlator_v3_single_file():
    if not SAMPLE_FILE.exists():
        pytest.skip("Sample file not present on disk")

    correlator = DirectSchemaCorrelatorV3()
    result = correlator.correlate_single_file(SAMPLE_FILE, session_id="test-v3-corr")

    assert result.sheet_name == "KIGS GSTR 2B Reco"
    assert result.total_columns >= 160
    assert result.kics_status_column == "ReconciliationSection"
    assert len(result.correlations) >= 5

    pairs = {c.source_column: c.selected_target_column for c in result.correlations if c.selected_target_column}
    assert "CPGstin" in pairs
    assert pairs["CPGstin"] == "PRGstin"
    assert "CPDocumentNumber" in pairs
    assert pairs["CPDocumentNumber"] == "PRDocumentNumber"
    assert "CPTaxableValue" in pairs
    assert pairs["CPTaxableValue"] == "PRTaxableValue"


def test_matching_engine_v3_execution():
    if not SAMPLE_FILE.exists():
        pytest.skip("Sample file not present on disk")

    import pandas as pd
    df = pd.read_excel(SAMPLE_FILE, sheet_name="KIGS GSTR 2B Reco", nrows=1000)
    rules = build_default_rules_v3()
    engine = WaterfallMatchingEngineV3()

    result = engine.execute_waterfall(
        df=df,
        rules=rules,
        session_id="test-v3-sim",
        kics_status_col="ReconciliationSection",
    )

    assert result.summary.total_records == 1000
    assert result.summary.kics_concurrence_count > 0
    assert result.summary.kics_concurrence_rate > 50.0
    assert len(result.records) > 0


def test_reconciliation_v3_api_lifecycle():
    app = create_app()
    client = TestClient(app)

    # 1. Create session
    create_res = client.post("/api/reconciliations-v3")
    assert create_res.status_code == 200
    session = create_res.json()
    session_id = session["id"]
    assert session["recon_type"] == "v3"
    assert session["status"] == "setup"

    # 2. Upload/probe sample file
    upload_res = client.post(f"/api/reconciliations-v3/{session_id}/upload-single?use_sample=true")
    assert upload_res.status_code == 200
    corr = upload_res.json()
    assert corr["total_columns"] >= 160
    assert corr["kics_status_column"] == "ReconciliationSection"

    # 3. Confirm mapping
    map_confirm = client.post(
        f"/api/reconciliations-v3/{session_id}/mapping/confirm",
        json={"correlations": corr["correlations"], "kics_status_column": corr["kics_status_column"]},
    )
    assert map_confirm.status_code == 200
    sess_mapped = map_confirm.json()
    assert sess_mapped["status"] == "mapping_confirmed"
    assert sess_mapped["current_stage"] == "rules"

    # 4. Get rules & confirm rules
    rules_res = client.get(f"/api/reconciliations-v3/{session_id}/rules")
    assert rules_res.status_code == 200
    rules = rules_res.json()
    assert len(rules) >= 5

    rules_confirm = client.post(
        f"/api/reconciliations-v3/{session_id}/rules/confirm",
        json={
            "selected_rule_ids": [r["id"] for r in rules],
            "rule_execution_order": [r["id"] for r in rules],
            "rules": rules,
        },
    )
    assert rules_confirm.status_code == 200
    sess_rules = rules_confirm.json()
    assert sess_rules["status"] == "rules_confirmed"
    assert sess_rules["current_stage"] == "results"

    # 5. Execute Stage 4 Waterfall
    exec_res = client.post(f"/api/reconciliations-v3/{session_id}/results/execute")
    assert exec_res.status_code == 200
    s4_result = exec_res.json()
    assert s4_result["summary"]["total_records"] == 20000
    assert s4_result["summary"]["kics_concurrence_rate"] >= 80.0

    # 6. Stage 5 Summary
    summary_res = client.get(f"/api/reconciliations-v3/{session_id}/summary")
    assert summary_res.status_code == 200
    s5_data = summary_res.json()
    assert s5_data["kics_benchmark"]["concurrence_rate"] >= 80.0
    assert len(s5_data["vendor_stratification"]) > 0

    # 7. Complete Session
    complete_res = client.post(f"/api/reconciliations-v3/{session_id}/complete")
    assert complete_res.status_code == 200
    assert complete_res.json()["status"] == "completed"
