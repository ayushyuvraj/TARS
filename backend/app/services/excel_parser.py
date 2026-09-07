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

    GOV_MARKERS = {
        "gstinofsupplier", "suppliergstin", "ctin", "tradelegalname", "legalname",
        "gstr15filingdate", "gstr15filingperiod", "invoicetype", "placeofsupply",
        "reversecharge", "integratedtax", "centraltax", "stateuttax", "taxablevalue",
        "invoicevalue", "invoicenumber", "invoicedate", "itcavailability", "itc",
    }
    PR_MARKERS = {
        "vendorcode", "vendorname", "partyname", "ponumber", "vouchernumber",
        "voucherno", "postingdate", "billnumber", "billno", "purchaseaccount",
        "businessunit", "costcenter", "ledgername", "internalref", "entrydate",
        "documentno", "companycode", "purchaseorder",
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

    def _header_scores(self, path: Path) -> tuple[int, int]:
        try:
            sheet_name, header_row = self.detect_header_row(path)
            frame = pd.read_excel(path, sheet_name=sheet_name, header=header_row - 1, nrows=5)
            headers = [re.sub(r"[^a-z0-9]", "", str(c).lower()) for c in frame.columns]
            fname = path.name.lower()
            gov_score = sum(1 for h in headers if any(m in h for m in self.GOV_MARKERS))
            pr_score = sum(1 for h in headers if any(m in h for m in self.PR_MARKERS))
            if any(k in fname for k in ("2b", "gstr", "govt", "government")):
                gov_score += 3
            if any(k in fname for k in ("pr", "purchase", "register", "books")):
                pr_score += 3
            return gov_score, pr_score
        except Exception:
            return 0, 0

    def detect_roles(self, file1_path: Path, file2_path: Path) -> RoleDetectionResult:
        g1, p1 = self._header_scores(file1_path)
        g2, p2 = self._header_scores(file2_path)
        score1 = g1 - p1
        score2 = g2 - p2

        # Dual Government-like files
        if (g1 > p1 and g2 > p2) or (g1 > 0 and g2 > 0 and p1 == 0 and p2 == 0):
            return RoleDetectionResult(
                file_1_role=DatasetRole.GOVERNMENT,
                file_2_role=DatasetRole.PURCHASE_REGISTER,
                confidence=0.50,
                is_confident=False,
                reason="Both files appear to be Government GSTR-2B workbooks. Please confirm file role assignment.",
            )

        # Dual Purchase Register-like files
        if (p1 > g1 and p2 > g2) or (p1 > 0 and p2 > 0 and g1 == 0 and g2 == 0):
            return RoleDetectionResult(
                file_1_role=DatasetRole.GOVERNMENT,
                file_2_role=DatasetRole.PURCHASE_REGISTER,
                confidence=0.50,
                is_confident=False,
                reason="Both files appear to be Purchase Register workbooks. Please confirm file role assignment.",
            )

        if score1 > score2 and (g1 > 0 or p2 > 0):
            conf = min(0.98, round(0.70 + (g1 + p2) * 0.05, 2))
            return RoleDetectionResult(
                file_1_role=DatasetRole.GOVERNMENT,
                file_2_role=DatasetRole.PURCHASE_REGISTER,
                confidence=conf,
                is_confident=conf >= 0.80,
                reason=f"File 1 identified as Government GSTR-2B (confidence {conf:.0%}).",
            )
        elif score2 > score1 and (g2 > 0 or p1 > 0):
            conf = min(0.98, round(0.70 + (g2 + p1) * 0.05, 2))
            return RoleDetectionResult(
                file_1_role=DatasetRole.PURCHASE_REGISTER,
                file_2_role=DatasetRole.GOVERNMENT,
                confidence=conf,
                is_confident=conf >= 0.80,
                reason=f"File 2 identified as Government GSTR-2B (confidence {conf:.0%}).",
            )
        else:
            return RoleDetectionResult(
                file_1_role=DatasetRole.GOVERNMENT,
                file_2_role=DatasetRole.PURCHASE_REGISTER,
                confidence=0.50,
                is_confident=False,
                reason="File header semantics are ambiguous. Please confirm file role assignment.",
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
