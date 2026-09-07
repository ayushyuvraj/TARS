import pandas as pd

from app.domain.models import DatasetRole
from app.services.exact_match import ExactMatchEngine
from app.services.excel_parser import ExcelParser


def test_exact_match_equals_ground_truth_and_never_double_consumes_pr(sample_files):
    parser = ExcelParser()
    government = parser.parse(sample_files["government"], DatasetRole.GOVERNMENT)
    purchase_register = parser.parse(
        sample_files["purchase_register"], DatasetRole.PURCHASE_REGISTER
    )
    matches = ExactMatchEngine().match(government.dataframe, purchase_register.dataframe)

    ground_truth = pd.read_excel(sample_files["ground_truth"], sheet_name="Expected_Results")
    expected = {
        (row.Government_Record_ID, row.Expected_PR_Record_IDs)
        for row in ground_truth[ground_truth["Scenario"] == "EXACT"].itertuples()
    }
    calculated = {
        (match.government_record_id, match.purchase_register_record_id) for match in matches
    }

    assert len(matches) == 520
    assert calculated == expected
    assert len({match.government_record_id for match in matches}) == len(matches)
    assert len({match.purchase_register_record_id for match in matches}) == len(matches)

