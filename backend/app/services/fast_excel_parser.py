from __future__ import annotations

import csv
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path
import re
from typing import Any

from openpyxl import load_workbook

from app.domain.models import CanonicalDataType, DatasetRole


class FastExcelParseError(ValueError):
    pass


@dataclass
class FastColumnSummary:
    name: str
    inferred_dtype: CanonicalDataType
    sample_values: list[str] = field(default_factory=list)
    null_count_sample: int = 0
    non_null_count_sample: int = 0
    pattern_hints: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "inferred_dtype": self.inferred_dtype.value,
            "sample_values": self.sample_values,
            "null_count_sample": self.null_count_sample,
            "non_null_count_sample": self.non_null_count_sample,
            "pattern_hints": self.pattern_hints,
        }


@dataclass
class FastFileProfile:
    role: DatasetRole
    filename: str
    sheet_name: str
    header_row: int
    column_count: int
    columns: list[FastColumnSummary] = field(default_factory=list)
    detected_row_count_estimate: int | None = None
    extraction_time_ms: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "role": self.role.value,
            "filename": self.filename,
            "sheet_name": self.sheet_name,
            "header_row": self.header_row,
            "column_count": self.column_count,
            "columns": [col.to_dict() for col in self.columns],
            "detected_row_count_estimate": self.detected_row_count_estimate,
            "extraction_time_ms": round(self.extraction_time_ms, 2),
        }


class FastExcelParser:
    """
    Sub-second streaming schema extractor.
    Reads ONLY the header row + first 50 rows using openpyxl read_only stream.
    Never loads millions of rows into Python memory.
    """

    GSTIN_REGEX = re.compile(r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$")
    PAN_REGEX = re.compile(r"^[A-Z]{5}[0-9]{4}[A-Z]$")
    IRN_REGEX = re.compile(r"^[a-fA-F0-9]{64}$")
    DATE_REGEXES = [
        re.compile(r"^\d{4}-\d{2}-\d{2}$"),
        re.compile(r"^\d{2}[-/]\d{2}[-/]\d{4}$"),
        re.compile(r"^\d{2}-[A-Za-z]{3}-\d{2,4}$"),
    ]

    def parse_fast_profile(
        self, path: Path, role: DatasetRole, sample_size: int = 50
    ) -> FastFileProfile:
        suffix = path.suffix.lower()
        if suffix == ".csv":
            return self._parse_csv_fast(path, role, sample_size)
        elif suffix in (".xlsx", ".xlsm", ".xltx"):
            return self._parse_xlsx_fast(path, role, sample_size)
        else:
            raise FastExcelParseError(f"Unsupported workbook extension: {suffix}. Expected .xlsx or .csv")

    def _parse_xlsx_fast(self, path: Path, role: DatasetRole, sample_size: int = 50) -> FastFileProfile:
        import time

        t0 = time.perf_counter()
        try:
            wb = load_workbook(path, read_only=True, data_only=True)
        except Exception as exc:
            raise FastExcelParseError(f"Failed to read workbook structure: {exc}") from exc

        try:
            ws = wb.worksheets[0]
            sheet_name = ws.title or "Sheet1"

            # 1. Detect header row in top 30 rows
            header_row = 1
            header_candidates: list[tuple[int, int, list[str]]] = []
            
            # Read first 30 rows for header detection
            scan_rows = list(ws.iter_rows(min_row=1, max_row=30, values_only=True))
            for idx, r in enumerate(scan_rows, start=1):
                if not r:
                    continue
                non_empty = [str(cell).strip() for cell in r if cell is not None and str(cell).strip()]
                unique = set(non_empty)
                if len(non_empty) >= 2 and len(unique) == len(non_empty):
                    header_candidates.append((len(non_empty), idx, non_empty))

            if header_candidates:
                # Pick row with highest number of unique non-empty columns (earliest on tie)
                _, header_row, raw_headers = max(header_candidates, key=lambda c: (c[0], -c[1]))
            elif scan_rows:
                header_row = 1
                raw_headers = [str(cell).strip() if cell is not None else f"Column_{i+1}" for i, cell in enumerate(scan_rows[0])]
            else:
                raise FastExcelParseError("Worksheet appears completely empty.")

            # Clean header column names
            headers: list[str] = []
            seen: set[str] = set()
            for i, h in enumerate(raw_headers):
                cleaned = str(h).strip() if h is not None and str(h).strip() else f"Col_{i+1}"
                # Deduplicate if necessary
                base = cleaned
                counter = 1
                while cleaned in seen:
                    cleaned = f"{base}_{counter}"
                    counter += 1
                seen.add(cleaned)
                headers.append(cleaned)

            # 2. Stream next 50 rows for fast sampling
            data_rows = list(
                ws.iter_rows(min_row=header_row + 1, max_row=header_row + sample_size, values_only=True)
            )

            # 3. Profile each column
            col_summaries: list[FastColumnSummary] = []
            for col_idx, col_name in enumerate(headers):
                sample_cells = []
                null_count = 0
                for row in data_rows:
                    if col_idx < len(row):
                        val = row[col_idx]
                        if val is None or str(val).strip() == "":
                            null_count += 1
                        else:
                            sample_cells.append(val)
                    else:
                        null_count += 1

                dtype, sample_strs, hints = self._inspect_sample(col_name, sample_cells)
                col_summaries.append(
                    FastColumnSummary(
                        name=col_name,
                        inferred_dtype=dtype,
                        sample_values=sample_strs[:5],
                        null_count_sample=null_count,
                        non_null_count_sample=len(sample_cells),
                        pattern_hints=hints,
                    )
                )

            # Fast estimate row count from worksheet dimensions without triggering openpyxl full XML scan
            est_rows = None
            if hasattr(ws, "dimensions") and ws.dimensions:
                dim_match = re.search(r"\d+$", str(ws.dimensions))
                if dim_match:
                    est_rows = int(dim_match.group())
            if not est_rows and hasattr(ws, "_max_row") and ws._max_row:
                est_rows = ws._max_row

            duration_ms = (time.perf_counter() - t0) * 1000.0
            return FastFileProfile(
                role=role,
                filename=path.name,
                sheet_name=sheet_name,
                header_row=header_row,
                column_count=len(headers),
                columns=col_summaries,
                detected_row_count_estimate=est_rows,
                extraction_time_ms=duration_ms,
            )
        finally:
            wb.close()

    def _parse_csv_fast(self, path: Path, role: DatasetRole, sample_size: int = 50) -> FastFileProfile:
        import time

        t0 = time.perf_counter()
        try:
            with path.open("r", encoding="utf-8", errors="replace") as f:
                reader = csv.reader(f)
                rows: list[list[str]] = []
                for idx, row in enumerate(reader):
                    if idx > sample_size + 30:
                        break
                    rows.append(row)
        except Exception as exc:
            raise FastExcelParseError(f"Failed to read CSV file: {exc}") from exc

        if not rows:
            raise FastExcelParseError("CSV file is empty.")

        header_row = 1
        headers = [c.strip() or f"Col_{i+1}" for i, c in enumerate(rows[0])]
        data_rows = rows[1 : sample_size + 1]

        col_summaries: list[FastColumnSummary] = []
        for col_idx, col_name in enumerate(headers):
            sample_cells = []
            null_count = 0
            for r in data_rows:
                if col_idx < len(r) and r[col_idx].strip():
                    sample_cells.append(r[col_idx].strip())
                else:
                    null_count += 1

            dtype, sample_strs, hints = self._inspect_sample(col_name, sample_cells)
            col_summaries.append(
                FastColumnSummary(
                    name=col_name,
                    inferred_dtype=dtype,
                    sample_values=sample_strs[:5],
                    null_count_sample=null_count,
                    non_null_count_sample=len(sample_cells),
                    pattern_hints=hints,
                )
            )

        duration_ms = (time.perf_counter() - t0) * 1000.0
        return FastFileProfile(
            role=role,
            filename=path.name,
            sheet_name="Default",
            header_row=header_row,
            column_count=len(headers),
            columns=col_summaries,
            detected_row_count_estimate=None,
            extraction_time_ms=duration_ms,
        )

    def _inspect_sample(self, col_name: str, values: list[Any]) -> tuple[CanonicalDataType, list[str], list[str]]:
        if not values:
            return CanonicalDataType.STRING, [], []

        stringified = []
        for v in values:
            if isinstance(v, (datetime, date)):
                stringified.append(v.isoformat())
            else:
                stringified.append(str(v).strip())

        unique_sample = list(dict.fromkeys(stringified))
        hints: list[str] = []

        # Check GSTIN hint
        if any(self.GSTIN_REGEX.match(s.upper()) for s in unique_sample):
            hints.append("gstin")
        elif any(self.PAN_REGEX.match(s.upper()) for s in unique_sample):
            hints.append("pan")
        elif any(self.IRN_REGEX.match(s) for s in unique_sample):
            hints.append("irn")

        # Check datetime
        date_hits = 0
        for v in values:
            if isinstance(v, (datetime, date)):
                date_hits += 1
            elif any(r.match(str(v).strip()) for r in self.DATE_REGEXES):
                date_hits += 1

        if date_hits / len(values) >= 0.7:
            return CanonicalDataType.DATE, unique_sample, hints

        # Check numeric
        num_hits = 0
        for v in values:
            if isinstance(v, (int, float)):
                num_hits += 1
            else:
                s = str(v).strip().replace(",", "").replace("$", "").replace("₹", "")
                try:
                    float(s)
                    num_hits += 1
                except ValueError:
                    pass

        if num_hits / len(values) >= 0.8:
            return CanonicalDataType.NUMBER, unique_sample, hints

        return CanonicalDataType.STRING, unique_sample, hints
