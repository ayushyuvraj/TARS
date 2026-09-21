from __future__ import annotations

from pathlib import Path
import pytest
import pandas as pd

from app.services.autonomous_recon_orchestrator import (
    ReconTopology,
    classify_workbooks,
    extract_sheet_headers_fast,
)

PROJECT_ROOT = Path(__file__).resolve().parents[2]
SAMPLE_V3_FILE = PROJECT_ROOT / "sample_data" / "TARS_KIGS_RECON_20000_Rows_All_Scenarios.xlsx"
SAMPLE_V2_GOV = PROJECT_ROOT / "sample_data" / "POC_Government_GST_Aug2026.xlsx"
SAMPLE_V2_PR = PROJECT_ROOT / "sample_data" / "POC_Purchase_Register_Aug2026.xlsx"


def test_classify_no_files():
    res = classify_workbooks([])
    assert res.topology == ReconTopology.NO_FILES
    assert "No files" in res.diagnostic_reason


def test_classify_single_ledger_v3():
    if not SAMPLE_V3_FILE.exists():
        pytest.skip("Sample V3 file not found")

    res = classify_workbooks([SAMPLE_V3_FILE])
    assert res.topology == ReconTopology.SINGLE_LEDGER_V3
    assert res.selected_sheet == "KIGS GSTR 2B Reco"
    assert len(res.sheets) >= 2


def test_classify_duplicate_identical_files():
    if not SAMPLE_V3_FILE.exists():
        pytest.skip("Sample V3 file not found")

    # Pass the exact same file twice
    res = classify_workbooks([SAMPLE_V3_FILE, SAMPLE_V3_FILE])
    assert res.topology == ReconTopology.SINGLE_LEDGER_V3
    assert res.selected_sheet == "KIGS GSTR 2B Reco"
    assert len(res.sheets) >= 2


def test_classify_dual_ledger_v2():
    if not SAMPLE_V2_GOV.exists() or not SAMPLE_V2_PR.exists():
        pytest.skip("Sample V2 files not found")

    res = classify_workbooks([SAMPLE_V2_GOV, SAMPLE_V2_PR])
    assert res.topology == ReconTopology.DUAL_LEDGER_V2
    assert res.gov_file is not None
    assert res.pr_file is not None
    assert "Government" in res.gov_file.name
    assert "Purchase" in res.pr_file.name


def test_classify_incomplete_single_sided(tmp_path: Path):
    # Create a dummy CSV that has only pure Purchase Register columns
    pr_csv = tmp_path / "my_erp_purchases.csv"
    df = pd.DataFrame({
        "Vendor Code": ["V001", "V002"],
        "Vendor Name": ["Supplier A", "Supplier B"],
        "Invoice Number": ["INV-1", "INV-2"],
        "Invoice Date": ["2026-08-01", "2026-08-02"],
        "Taxable Value": [1000.0, 2000.0],
        "CGST Amount": [90.0, 180.0],
        "SGST Amount": [90.0, 180.0],
        "Cost Center": ["CC-01", "CC-02"],
        "Voucher No": ["VCH-1", "VCH-2"],
    })
    df.to_csv(pr_csv, index=False)

    res = classify_workbooks([pr_csv])
    assert res.topology == ReconTopology.INCOMPLETE_SINGLE_SIDED
    assert res.single_sided_role == "Purchase Register"
    assert "Missing counterpart ledger" in res.diagnostic_reason


def test_classify_unrecognized_non_gst(tmp_path: Path):
    # Create an unrelated spreadsheet (e.g. employee payroll)
    dummy_csv = tmp_path / "employee_payroll.csv"
    df = pd.DataFrame({
        "EmpID": ["E01", "E02"],
        "Employee Name": ["Alice", "Bob"],
        "Department": ["HR", "Engineering"],
        "Salary": [50000, 75000],
    })
    df.to_csv(dummy_csv, index=False)

    res = classify_workbooks([dummy_csv])
    assert res.topology == ReconTopology.UNRECOGNIZED_NON_GST
    assert "does not contain recognized GST reconciliation fields" in res.diagnostic_reason


def test_classify_incompatible_dual_files(tmp_path: Path):
    f1 = tmp_path / "inventory.csv"
    pd.DataFrame({"Item": ["Widget A"], "Stock": [100]}).to_csv(f1, index=False)

    f2 = tmp_path / "roster.csv"
    pd.DataFrame({"Shift": ["Day"], "Worker": ["Charlie"]}).to_csv(f2, index=False)

    res = classify_workbooks([f1, f2])
    assert res.topology == ReconTopology.INCOMPATIBLE_DUAL_FILES
    assert "Zero semantic GST match" in res.diagnostic_reason


def test_execute_autonomous_dual_ledger():
    if not SAMPLE_V2_GOV.exists() or not SAMPLE_V2_PR.exists():
        pytest.skip("Sample V2 files not found")

    import asyncio
    from app.config import get_settings
    from app.services.autonomous_recon_orchestrator import execute_autonomous_reconciliation

    async def _run():
        settings = get_settings()
        events = []
        async for event in execute_autonomous_reconciliation([SAMPLE_V2_GOV, SAMPLE_V2_PR], "reconcile", settings):
            events.append(event)
        return "".join(events)

    all_stream = asyncio.run(_run())
    assert "AUTO_RECONCILE_SUCCESS" in all_stream
    assert '"recon_type": "v2"' in all_stream
    assert '"target_stage": "results"' in all_stream
    assert "rec_v2_" in all_stream


def test_execute_autonomous_single_ledger_v3():
    if not SAMPLE_V3_FILE.exists():
        pytest.skip("Sample V3 file not found")

    import asyncio
    from app.config import get_settings
    from app.services.autonomous_recon_orchestrator import execute_autonomous_reconciliation

    async def _run():
        settings = get_settings()
        events = []
        async for event in execute_autonomous_reconciliation([SAMPLE_V3_FILE], "reconcile", settings):
            events.append(event)
        return "".join(events)

    all_stream = asyncio.run(_run())
    assert "AUTO_RECONCILE_SUCCESS" in all_stream
    assert '"recon_type": "v3"' in all_stream
    assert '"target_stage": "results"' in all_stream
    assert "rec_v3_" in all_stream



