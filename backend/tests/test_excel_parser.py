from app.domain.models import DatasetRole
from app.services.excel_parser import ExcelParser


def test_both_workbooks_parse_with_expected_profiles(sample_files):
    parser = ExcelParser()
    government = parser.parse(sample_files["government"], DatasetRole.GOVERNMENT)
    purchase_register = parser.parse(
        sample_files["purchase_register"], DatasetRole.PURCHASE_REGISTER
    )

    assert government.profile.row_count == 1_000
    assert purchase_register.profile.row_count == 1_050
    assert government.profile.header_row == 4
    assert purchase_register.profile.header_row == 4
    assert "Counterparty_GSTIN" in government.dataframe.columns
    assert "Vendor_GSTIN" in purchase_register.dataframe.columns

