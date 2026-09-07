from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
import re

import pandas as pd
from openpyxl import load_workbook

from app.domain.models import CanonicalDataType, ColumnProfile, DatasetProfile, DatasetRole, RoleDetectionResult


class ExcelParseError(ValueError):
    pass


@dataclass(frozen=True)
class ParsedDataset:
    dataframe: pd.DataFrame
    profile: DatasetProfile


class ExcelParser:
    GSTIN_PATTERN = re.compile(r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$")

    GOV_DISCRIMINATORS = {
        "gstr15filingdate", "gstr1filingdate", "filingdate",
        "gstr15filingperiod", "gstr1filingperiod", "filingperiod",
        "itcavailability", "itceligibility", "itcavailable", "reasonforitcunavailability",
        "supplierfilingstatus", "gstr3bfilingstatus", "cancellationdate", "gstr2b", "gstr2a"
    }

    PR_DISCRIMINATORS = {
        "vendorcode", "vendorname", "partyname", "ponumber", "purchaseorder",
        "vouchernumber", "voucherno", "vouchertype", "postingdate", "billnumber",
        "billno", "purchaseaccount", "costcenter", "ledgername", "internalref",
        "entrydate", "documentno", "companycode", "grnnumber", "materialcode", "itemcode"
    }

    def detect_header_row(self, path: Path, role: DatasetRole = DatasetRole.GOVERNMENT) -> tuple[str, int]:
        try:
            workbook = load_workbook(path, read_only=True, data_only=True)
        except Exception as exc:
            raise ExcelParseError("The uploaded file is not a readable Excel workbook") from exc
        try:
            worksheet = workbook.worksheets[0]
            candidates: list[tuple[int, int]] = []
            for row_number, row in enumerate(
                worksheet.iter_rows(min_row=1, max_row=30, values_only=True), start=1
            ):
                values = [str(value).strip() for value in row if value is not None and str(value).strip()]
                unique_values = set(values)
                if len(values) >= 2 and len(unique_values) == len(values):
                    candidates.append((len(values), row_number))
            if candidates:
                _, header_row = max(candidates, key=lambda candidate: (candidate[0], -candidate[1]))
                return worksheet.title, header_row
        finally:
            workbook.close()
        raise ExcelParseError("Could not locate a tabular header in the first 30 rows")

    def _header_scores(
        self,
        path: Path,
        original_filename: str | None = None,
        shared_headers: set[str] | None = None,
    ) -> tuple[float, float, list[str], list[str]]:
        gov_evidence: list[str] = []
        pr_evidence: list[str] = []
        gov_score = 0.0
        pr_score = 0.0

        try:
            sheet_name, header_row = self.detect_header_row(path)
            frame = pd.read_excel(path, sheet_name=sheet_name, header=header_row - 1, nrows=5)
            headers = [re.sub(r"[^a-z0-9]", "", str(c).lower()) for c in frame.columns]

            # Signal Priority A: Sheet Title (Weight: 5.0)
            sheet_clean = re.sub(r"[^a-z0-9]", "", sheet_name.lower())
            if any(s in sheet_clean for s in ("gstr2b", "gstr2", "govt", "government", "2b")):
                gov_score += 5.0
                gov_evidence.append("Sheet title indicates GSTR-2B")
            elif any(p in sheet_name.lower() for p in ("purchase register", "purchase_register", "purchaseregister", "pr register", "pr_data", "pr data")):
                pr_score += 5.0
                pr_evidence.append("Sheet title indicates Purchase Register")

            # Signal Priority B: Source-Specific Header Discriminators (Weight: 2.0 per unique discriminator)
            # Shared headers present in BOTH workbooks are strictly NEUTRAL (0 weight)
            unique_gov_matches = 0
            unique_pr_matches = 0

            for h in headers:
                if shared_headers and h in shared_headers:
                    continue  # Overlapping header in both workbooks -> Neutral
                if any(m in h for m in self.GOV_DISCRIMINATORS):
                    gov_score += 2.0
                    unique_gov_matches += 1
                if any(m in h for m in self.PR_DISCRIMINATORS):
                    pr_score += 2.0
                    unique_pr_matches += 1

            if unique_gov_matches > 0:
                gov_evidence.append("Government portal fields detected")
            if unique_pr_matches > 0:
                pr_evidence.append("ERP/vendor accounting fields detected")

            # Signal Priority D: Safe Filename Hints (Weight: 2.0)
            fname = (original_filename or path.name).lower()
            if fname and not fname.startswith("temp1-") and not fname.startswith("temp2-") and not fname.startswith("val1-") and not fname.startswith("val2-"):
                if any(k in fname for k in ("gstr2b", "gstr-2b", "gstr_2b", "government", "govt")):
                    gov_score += 2.0
                    gov_evidence.append("Filename supports Government source")
                if any(p in fname for p in ("purchase_register", "purchase-register", "purchase register", "purchaseregister", "pr_register", "pr-register")):
                    pr_score += 2.0
                    pr_evidence.append("Filename supports Purchase Register source")

            return gov_score, pr_score, gov_evidence, pr_evidence
        except Exception as exc:
            return 0.0, 0.0, [], [f"Parsing error: {exc}"]

    def _get_normalized_headers(self, path: Path) -> set[str]:
        try:
            sheet_name, header_row = self.detect_header_row(path)
            frame = pd.read_excel(path, sheet_name=sheet_name, header=header_row - 1, nrows=5)
            return {re.sub(r"[^a-z0-9]", "", str(c).lower()) for c in frame.columns if c is not None and str(c).strip()}
        except Exception:
            return set()

    def detect_roles(
        self,
        file1_path: Path,
        file2_path: Path,
        file1_name: str | None = None,
        file2_name: str | None = None,
    ) -> RoleDetectionResult:
        # Pre-extract normalized headers to identify shared/overlapping columns between BOTH workbooks
        h1 = self._get_normalized_headers(file1_path)
        h2 = self._get_normalized_headers(file2_path)
        shared_headers = h1.intersection(h2)

        g1, p1, gov_ev1, pr_ev1 = self._header_scores(file1_path, file1_name, shared_headers)
        g2, p2, gov_ev2, pr_ev2 = self._header_scores(file2_path, file2_name, shared_headers)

        diff1 = g1 - p1
        diff2 = g2 - p2

        # Conflict: Both workbooks strongly match Government
        if g1 > p1 and g2 > p2 and g1 >= 3.0 and g2 >= 3.0:
            return RoleDetectionResult(
                file_1_role=DatasetRole.GOVERNMENT,
                file_2_role=DatasetRole.PURCHASE_REGISTER,
                confidence=0.50,
                confidence_level="Low",
                is_confident=False,
                reason="Both workbooks contain Government GSTR-2B markers. Please confirm role assignments.",
                file_1_evidence=gov_ev1 + pr_ev1,
                file_2_evidence=gov_ev2 + pr_ev2,
            )

        # Conflict: Both workbooks strongly match Purchase Register
        if p1 > g1 and p2 > g2 and p1 >= 3.0 and p2 >= 3.0:
            return RoleDetectionResult(
                file_1_role=DatasetRole.GOVERNMENT,
                file_2_role=DatasetRole.PURCHASE_REGISTER,
                confidence=0.50,
                confidence_level="Low",
                is_confident=False,
                reason="Both workbooks contain Purchase Register markers. Please confirm role assignments.",
                file_1_evidence=gov_ev1 + pr_ev1,
                file_2_evidence=gov_ev2 + pr_ev2,
            )

        # Standard differential evaluation
        if diff1 > diff2:
            assigned_1 = DatasetRole.GOVERNMENT
            assigned_2 = DatasetRole.PURCHASE_REGISTER
            ev1 = gov_ev1 if g1 >= p1 else pr_ev1
            ev2 = pr_ev2 if p2 >= g2 else gov_ev2
            
            has_absolute_evidence = (g1 >= 3.0 or p2 >= 3.0)
            has_margin = (diff1 >= 2.0) and (g1 >= p1) and (p2 >= g2)
            is_coherent = (g1 >= p1) and (p2 >= g2)

            if has_absolute_evidence and has_margin and is_coherent:
                conf = 0.95
                clevel = "High"
                is_conf = True
                reason = "Smart identification confident (High confidence): File 1 is Government GSTR-2B, File 2 is Purchase Register."
            else:
                conf = 0.50
                clevel = "Low"
                is_conf = False
                reason = "Header semantics are ambiguous. Please confirm file role assignment."

            return RoleDetectionResult(
                file_1_role=assigned_1,
                file_2_role=assigned_2,
                confidence=conf,
                confidence_level=clevel,
                is_confident=is_conf,
                reason=reason,
                file_1_evidence=ev1,
                file_2_evidence=ev2,
            )
        else:
            assigned_1 = DatasetRole.PURCHASE_REGISTER
            assigned_2 = DatasetRole.GOVERNMENT
            ev1 = pr_ev1 if p1 >= g1 else gov_ev1
            ev2 = gov_ev2 if g2 >= p2 else pr_ev2

            has_absolute_evidence = (p1 >= 3.0 or g2 >= 3.0)
            has_margin = (diff2 >= 2.0) and (p1 >= g1) and (g2 >= p2)
            is_coherent = (p1 >= g1) and (g2 >= p2)

            if has_absolute_evidence and has_margin and is_coherent:
                conf = 0.95
                clevel = "High"
                is_conf = True
                reason = "Smart identification confident (High confidence): File 1 is Purchase Register, File 2 is Government GSTR-2B."
            else:
                conf = 0.50
                clevel = "Low"
                is_conf = False
                reason = "Header semantics are ambiguous. Please confirm file role assignment."

            return RoleDetectionResult(
                file_1_role=assigned_1,
                file_2_role=assigned_2,
                confidence=conf,
                confidence_level=clevel,
                is_confident=is_conf,
                reason=reason,
                file_1_evidence=ev1,
                file_2_evidence=ev2,
            )





    @staticmethod
    def _stringify(value: object) -> str:
        if isinstance(value, (datetime, date)):
            return value.isoformat()
        return str(value)[:80]

    def _infer_dtype(self, series: pd.Series) -> CanonicalDataType:
        non_null = series.dropna()
        if pd.api.types.is_datetime64_any_dtype(series):
            return CanonicalDataType.DATE
        if pd.api.types.is_numeric_dtype(series):
            return CanonicalDataType.NUMBER
        if non_null.empty:
            return CanonicalDataType.STRING
        parsed_dates = pd.to_datetime(non_null.astype(str), errors="coerce", format="mixed")
        if float(parsed_dates.notna().mean()) >= 0.9:
            return CanonicalDataType.DATE
        parsed_numbers = pd.to_numeric(non_null.astype(str), errors="coerce")
        if float(parsed_numbers.notna().mean()) >= 0.95:
            return CanonicalDataType.NUMBER
        return CanonicalDataType.STRING

    def _profile_column(self, name: str, series: pd.Series, row_count: int) -> ColumnProfile:
        non_null = series.dropna()
        non_null_count = int(non_null.size)
        inferred = self._infer_dtype(series)
        samples = [self._stringify(value) for value in non_null.drop_duplicates().head(5).tolist()]
        minimum: str | None = None
        maximum: str | None = None
        if non_null_count and inferred == CanonicalDataType.NUMBER:
            numeric = pd.to_numeric(non_null, errors="coerce").dropna()
            if not numeric.empty:
                minimum, maximum = self._stringify(numeric.min()), self._stringify(numeric.max())
        elif non_null_count and inferred == CanonicalDataType.DATE:
            dates = pd.to_datetime(non_null, errors="coerce", format="mixed").dropna()
            if not dates.empty:
                minimum, maximum = dates.min().date().isoformat(), dates.max().date().isoformat()

        string_values = non_null.astype(str).str.strip().str.upper()
        hints: list[str] = []
        if non_null_count and float(string_values.str.match(self.GSTIN_PATTERN).mean()) >= 0.8:
            hints.append("gstin")
        if inferred == CanonicalDataType.DATE:
            hints.append("date")
        if inferred == CanonicalDataType.NUMBER:
            hints.append("numeric")
            numeric = pd.to_numeric(non_null, errors="coerce").dropna()
            if not numeric.empty and float(numeric.between(0, 100).mean()) >= 0.95:
                hints.append("percentage_range")

        non_null_percentage = 0.0 if row_count == 0 else round(non_null_count * 100 / row_count, 2)
        return ColumnProfile(
            column_name=name,
            inferred_dtype=inferred,
            pandas_dtype=str(series.dtype),
            non_null_count=non_null_count,
            non_null_percentage=non_null_percentage,
            null_percentage=round(100 - non_null_percentage, 2),
            unique_count=int(non_null.nunique(dropna=True)),
            sample_values=samples,
            minimum=minimum,
            maximum=maximum,
            pattern_hints=hints,
        )

    def parse(self, path: Path, role: DatasetRole) -> ParsedDataset:
        sheet_name, header_row = self.detect_header_row(path, role)
        try:
            frame = pd.read_excel(path, sheet_name=sheet_name, header=header_row - 1)
        except Exception as exc:
            raise ExcelParseError("Failed to parse the Excel worksheet") from exc
        frame = frame.dropna(how="all").reset_index(drop=True)
        frame.columns = [str(column).strip() for column in frame.columns]
        if len(frame.columns) < 2:
            raise ExcelParseError("The worksheet must contain at least two columns")
        if len(set(frame.columns)) != len(frame.columns):
            raise ExcelParseError("Duplicate source column names are not supported")
        column_profiles = [
            self._profile_column(column, frame[column], len(frame)) for column in frame.columns
        ]
        profile = DatasetProfile(
            role=role,
            sheet_name=sheet_name,
            header_row=header_row,
            row_count=len(frame),
            column_count=len(frame.columns),
            columns=list(frame.columns),
            inferred_types={column: str(dtype) for column, dtype in frame.dtypes.items()},
            null_counts={column: int(count) for column, count in frame.isna().sum().items()},
            column_profiles=column_profiles,
        )
        return ParsedDataset(dataframe=frame, profile=profile)
