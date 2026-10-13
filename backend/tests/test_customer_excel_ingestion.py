import io
import pandas as pd
from pathlib import Path
from tempfile import NamedTemporaryFile

from app.services.direct_schema_correlator_v3 import DirectSchemaCorrelatorV3
from app.api.reconciliations_v4 import _load_df_safely_v4


def test_correlate_file_with_duplicate_columns_and_title_row():
    """Verify that customer workbooks with duplicate column headers and title banners do not raise AttributeError."""
    # Create a synthetic customer Excel workbook with:
    # Row 0: Title banner ('KPMG Monthly GST Reco', '', '', ...)
    # Row 1: Headers with duplicate names (e.g., Portal 'Taxable Value' and PR 'Taxable Value')
    # Row 2+: Data rows
    data = [
        ["KPMG Client Reconciliation Report", None, None, None, None, None],
        ["GSTIN", "Invoice No", "Taxable Value", "GSTIN", "Invoice No", "Taxable Value"],
        ["27ABCDE1234F1Z5", "INV-001", 1000.0, "27ABCDE1234F1Z5", "INV-001", 1000.0],
        ["27ABCDE1234F1Z5", "INV-002", 2500.0, "27ABCDE1234F1Z5", "INV-002", 2500.0],
        ["29XYZAB5678C2Z1", "INV-003", 500.0, "29XYZAB5678C2Z1", "INV-003", 500.0],
    ]
    
    with NamedTemporaryFile(suffix=".xlsx", delete=False) as tmp:
        tmp_path = Path(tmp.name)
        with pd.ExcelWriter(tmp_path, engine="openpyxl") as writer:
            pd.DataFrame(data).to_excel(writer, sheet_name="GST_Data", header=False, index=False)

    try:
        correlator = DirectSchemaCorrelatorV3()
        # This was previously raising AttributeError: 'DataFrame' object has no attribute 'tolist'
        res = correlator.correlate_single_file(tmp_path, session_id="test_customer_session")
        
        assert res is not None
        assert res.total_columns == 6

        # Verify full dataframe loader also deduplicates columns
        df_loaded = _load_df_safely_v4(tmp_path, sheet_name="GST_Data")
        assert df_loaded is not None
        assert len(df_loaded.columns) == 6
        assert len(set(df_loaded.columns)) == len(df_loaded.columns)
        assert len(df_loaded) >= 3
    finally:
        if tmp_path.exists():
            tmp_path.unlink()
