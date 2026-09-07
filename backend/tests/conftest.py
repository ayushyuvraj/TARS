from __future__ import annotations

import shutil
import sys
from pathlib import Path

import pytest
import pandas as pd
from fastapi.testclient import TestClient

BACKEND_ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = BACKEND_ROOT.parent
sys.path.insert(0, str(BACKEND_ROOT))

from app.config import Settings  # noqa: E402
from app.main import create_app  # noqa: E402


@pytest.fixture(scope="session")
def sample_files() -> dict[str, Path]:
    return {
        "government": PROJECT_ROOT / "sample_data" / "POC_Government_GST_Aug2026.xlsx",
        "purchase_register": PROJECT_ROOT
        / "sample_data"
        / "POC_Purchase_Register_Aug2026.xlsx",
        "ground_truth": PROJECT_ROOT
        / "sample_data"
        / "POC_Reconciliation_Ground_Truth.xlsx",
    }


@pytest.fixture
def client(tmp_path: Path) -> TestClient:
    settings = Settings(
        database_path=tmp_path / "test.db",
        upload_dir=tmp_path / "uploads",
        export_dir=tmp_path / "exports",
        frontend_origin="http://localhost:5173",
        openai_api_key=None,
        llm_api_key=None,
        _env_file=None,
    )
    with TestClient(create_app(settings)) as test_client:
        yield test_client


@pytest.fixture
def uploaded_workbooks(tmp_path: Path, sample_files: dict[str, Path]) -> dict[str, Path]:
    paths: dict[str, Path] = {}
    for role in ("government", "purchase_register"):
        destination = tmp_path / sample_files[role].name
        shutil.copy2(sample_files[role], destination)
        paths[role] = destination
    return paths


def _renamed_pair(tmp_path: Path, sample_files: dict[str, Path], hard: bool) -> dict[str, Path]:
    government = pd.read_excel(sample_files["government"], header=3)
    purchase = pd.read_excel(sample_files["purchase_register"], header=3)
    if hard:
        government_rename = {
            "Government_Record_ID": "Source_Row_Key",
            "Counterparty_GSTIN": "Party_Reg_No",
            "Counterparty_Document_Number": "Voucher_Ref",
            "Counterparty_Document_Date": "Voucher_Dt",
            "Document_Type": "Txn_Category",
            "Taxable_Value": "Assessable_Amt",
            "GST_Rate": "Tax_Pct",
            "IGST_Amount": "Integrated_Tax",
            "CGST_Amount": "Central_Tax",
            "SGST_Amount": "State_Tax",
            "Cess_Amount": "Compensation_Levy",
        }
        purchase_rename = {
            "PR_Record_ID": "Source_Row_Key",
            "Vendor_GSTIN": "Party_Reg_No",
            "PR_Document_Number": "External_Ref",
            "PR_Document_Date": "Accounting_Dt",
            "Document_Type": "Txn_Category",
            "Taxable_Value": "Net_Assessable",
            "GST_Rate": "Tax_Pct",
            "IGST_Amount": "Integrated_Tax",
            "CGST_Amount": "Central_Tax",
            "SGST_Amount": "State_Tax",
            "Cess_Amount": "Compensation_Levy",
        }
        suffix = "hard"
    else:
        government_rename = {
            "Counterparty_GSTIN": "ctin",
            "Counterparty_Document_Number": "inum",
            "Counterparty_Document_Date": "idt",
            "Taxable_Value": "txval",
            "IGST_Amount": "iamt",
            "CGST_Amount": "camt",
            "SGST_Amount": "samt",
        }
        purchase_rename = {
            "Vendor_GSTIN": "Supplier_Tax_ID",
            "PR_Document_Number": "Ref_No",
            "PR_Document_Date": "Posting_Dt",
            "Taxable_Value": "Base_Amt",
            "IGST_Amount": "Input_IGST",
            "CGST_Amount": "Input_CGST",
            "SGST_Amount": "Input_SGST",
        }
        suffix = "erp"
    government_path = tmp_path / f"government_{suffix}.xlsx"
    purchase_path = tmp_path / f"purchase_{suffix}.xlsx"
    government.rename(columns=government_rename).to_excel(
        government_path, index=False, sheet_name="Government_GST"
    )
    purchase.rename(columns=purchase_rename).to_excel(
        purchase_path, index=False, sheet_name="Purchase_Register"
    )
    return {
        "government": government_path,
        "purchase_register": purchase_path,
        "ground_truth": sample_files["ground_truth"],
    }


@pytest.fixture
def renamed_workbooks(tmp_path: Path, sample_files: dict[str, Path]) -> dict[str, Path]:
    return _renamed_pair(tmp_path, sample_files, hard=False)


@pytest.fixture
def hard_renamed_workbooks(tmp_path: Path, sample_files: dict[str, Path]) -> dict[str, Path]:
    return _renamed_pair(tmp_path, sample_files, hard=True)
