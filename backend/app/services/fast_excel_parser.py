from __future__ import annotations

import csv
from dataclasses import dataclass, field
from datetime import date, datetime
import logging
from pathlib import Path
import re
from typing import Any

from openpyxl import load_workbook

from app.domain.models import CanonicalDataType, DatasetRole

logger = logging.getLogger(__name__)


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

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> FastColumnSummary:
        return cls(
            name=data["name"],
            inferred_dtype=CanonicalDataType(data["inferred_dtype"]),
            sample_values=data.get("sample_values", []),
            null_count_sample=data.get("null_count_sample", 0),
            non_null_count_sample=data.get("non_null_count_sample", 0),
            pattern_hints=data.get("pattern_hints", []),
        )


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

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> FastFileProfile:
        return cls(
            role=DatasetRole(data["role"]),
            filename=data["filename"],
            sheet_name=data.get("sheet_name", "Sheet1"),
            header_row=data.get("header_row", 1),
            column_count=data.get("column_count", len(data.get("columns", []))),
            columns=[FastColumnSummary.from_dict(c) for c in data.get("columns", [])],
            detected_row_count_estimate=data.get("detected_row_count_estimate"),
            extraction_time_ms=data.get("extraction_time_ms", 0.0),
        )


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
        try:
            return self._parse_xlsx_stream(path, role, sample_size)
        except Exception as exc:
            logger.warning(f"Fast XLSX stream parser failed for {path.name}: {exc}; falling back to openpyxl reader")
            return self._parse_xlsx_openpyxl(path, role, sample_size)

    def _parse_xlsx_stream(self, path: Path, role: DatasetRole, sample_size: int = 50) -> FastFileProfile:
        import time
        import zipfile
        import xml.etree.ElementTree as ET

        t0 = time.perf_counter()
        with zipfile.ZipFile(path, "r") as zf:
            namelist = set(zf.namelist())
            sheet_target = "xl/worksheets/sheet1.xml"
            if sheet_target not in namelist:
                candidates = [n for n in namelist if n.startswith("xl/worksheets/sheet") and n.endswith(".xml")]
                if not candidates:
                    raise FastExcelParseError("No worksheet XML found in workbook.")
                sheet_target = candidates[0]

            sheet_name = "Sheet1"
            if "xl/workbook.xml" in namelist:
                try:
                    wb_root = ET.fromstring(zf.read("xl/workbook.xml"))
                    for sheet_el in wb_root.iter():
                        if sheet_el.tag.endswith("sheet") and "name" in sheet_el.attrib:
                            sheet_name = sheet_el.attrib["name"]
                            break
                except Exception:
                    pass

            # Fast estimate rows from dimension tag in header chunk (<2ms)
            est_rows = None
            try:
                with zf.open(sheet_target) as f_dim:
                    header_chunk = f_dim.read(2048).decode("utf-8", errors="ignore")
                    m = re.search(r'ref="[A-Z0-9]+:([A-Z]+)(\d+)"', header_chunk)
                    if m:
                        est_rows = int(m.group(2))
            except Exception:
                pass

            # Stream only top (sample_size + 35) rows directly from XML
            raw_rows: list[dict[int, tuple[str, str | None]]] = []
            needed_shared_strings: set[int] = set()

            def _col_str_to_idx(col_str: str) -> int:
                idx = 0
                for ch in col_str:
                    idx = idx * 26 + (ord(ch.upper()) - ord("A") + 1)
                return idx - 1

            max_scan = sample_size + 35
            with zf.open(sheet_target) as sheet_f:
                row_idx = 0
                for event, elem in ET.iterparse(sheet_f, events=("end",)):
                    if elem.tag.endswith("row"):
                        row_idx += 1
                        row_cells: dict[int, tuple[str, str | None]] = {}
                        for c in elem:
                            if not c.tag.endswith("c"):
                                continue
                            cell_ref = c.attrib.get("r", "")
                            col_m = re.match(r"^([A-Za-z]+)", cell_ref)
                            if not col_m:
                                continue
                            col_i = _col_str_to_idx(col_m.group(1))
                            c_type = c.attrib.get("t")
                            val_el = None
                            for child in c:
                                if child.tag.endswith("v") or child.tag.endswith("is"):
                                    val_el = child
                                    break
                            val_str = ""
                            if val_el is not None:
                                if c_type == "inlineStr":
                                    val_str = "".join(val_el.itertext()).strip()
                                else:
                                    val_str = (val_el.text or "").strip()

                            if c_type == "s" and val_str.isdigit():
                                s_idx = int(val_str)
                                needed_shared_strings.add(s_idx)
                                row_cells[col_i] = (str(s_idx), "s")
                            elif val_str:
                                row_cells[col_i] = (val_str, c_type)

                        raw_rows.append(row_cells)
                        elem.clear()
                        if row_idx >= max_scan:
                            break

            # Resolve only the required shared strings (break early once all needed are resolved)
            shared_strings: dict[int, str] = {}
            if needed_shared_strings and "xl/sharedStrings.xml" in namelist:
                max_s = max(needed_shared_strings)
                s_counter = 0
                with zf.open("xl/sharedStrings.xml") as s_f:
                    for event, elem in ET.iterparse(s_f, events=("end",)):
                        if elem.tag.endswith("si"):
                            if s_counter in needed_shared_strings:
                                shared_strings[s_counter] = "".join(elem.itertext()).strip()
                            s_counter += 1
                            elem.clear()
                            if s_counter > max_s:
                                break

            if not raw_rows:
                raise FastExcelParseError("Worksheet appears completely empty.")

            max_cols = max(max(r.keys(), default=0) for r in raw_rows) + 1
            grid: list[list[str]] = []
            for r_dict in raw_rows:
                row_vals = [""] * max_cols
                for col_i, (v, c_t) in r_dict.items():
                    if col_i < max_cols:
                        if c_t == "s":
                            row_vals[col_i] = shared_strings.get(int(v), "")
                        else:
                            row_vals[col_i] = v
                grid.append(row_vals)

            # 1. Detect header row in top 30 rows
            header_row = 1
            header_candidates: list[tuple[int, int, list[str]]] = []
            for idx, r in enumerate(grid[:30], start=1):
                non_empty = [c.strip() for c in r if c and c.strip()]
                unique = set(non_empty)
                if len(non_empty) >= 2 and len(unique) == len(non_empty):
                    header_candidates.append((len(non_empty), idx, non_empty))

            if header_candidates:
                _, header_row, raw_headers = max(header_candidates, key=lambda c: (c[0], -c[1]))
            elif grid:
                header_row = 1
                raw_headers = [c if c else f"Column_{i+1}" for i, c in enumerate(grid[0])]
            else:
                raise FastExcelParseError("No valid rows found in worksheet.")

            # Clean header column names (fully dynamic for any column count)
            headers: list[str] = []
            seen: set[str] = set()
            for i, h in enumerate(raw_headers):
                cleaned = str(h).strip() if h and str(h).strip() else f"Col_{i+1}"
                base = cleaned
                counter = 1
                while cleaned in seen:
                    cleaned = f"{base}_{counter}"
                    counter += 1
                seen.add(cleaned)
                headers.append(cleaned)

            # 2. Extract sample data rows
            data_rows = grid[header_row : header_row + sample_size]

            # 3. Profile each column
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
                sheet_name=sheet_name,
                header_row=header_row,
                column_count=len(headers),
                columns=col_summaries,
                detected_row_count_estimate=max(0, est_rows - header_row) if est_rows is not None else None,
                extraction_time_ms=duration_ms,
            )

    def _parse_xlsx_openpyxl(self, path: Path, role: DatasetRole, sample_size: int = 50) -> FastFileProfile:
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
                detected_row_count_estimate=max(0, est_rows - header_row) if est_rows is not None else None,
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
