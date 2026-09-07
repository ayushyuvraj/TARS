"""Deterministic Phase 7A scale benchmark; writes a reproducible JSON report."""
from __future__ import annotations

import json
import sys
import tracemalloc
from datetime import date
from pathlib import Path
from time import perf_counter
from uuid import uuid4

import pandas as pd

BACKEND_ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = BACKEND_ROOT.parent
sys.path.insert(0, str(BACKEND_ROOT))

from app.domain.models import (  # noqa: E402
    ColumnMappingCandidate, ConfirmedDatasetMapping, ConfirmedMappingSet,
    DatasetRole, ProposedBy,
)
from app.services.exact_match import ExactMatchEngine  # noqa: E402
from app.services.mapping import CANONICAL_MAPPINGS  # noqa: E402
from app.services.near_match import NearMatchEngine  # noqa: E402


def row(role: DatasetRole, index: int, near: bool = False) -> dict[str, object]:
    mapping = CANONICAL_MAPPINGS[role]
    prefix = "GST" if role == DatasetRole.GOVERNMENT else "PR"
    invoice = f"INV-{index:06d}"
    if near and role == DatasetRole.PURCHASE_REGISTER:
        invoice = f"inv/{index:06d}"
    return {
        mapping["record_id"]: f"{prefix}-{index:06d}",
        mapping["gstin"]: f"27AA{index:011d}",
        mapping["document_number"]: invoice,
        mapping["document_date"]: date(2026, 8, 1),
        mapping["document_type"]: "Invoice",
        mapping["taxable_value"]: 1000 + index,
        mapping["gst_rate"]: 18,
        mapping["igst"]: 180,
        mapping["cgst"]: 0,
        mapping["sgst"]: 0,
        mapping["cess"]: 0,
    }


def confirmed_mapping() -> ConfirmedMappingSet:
    datasets = []
    for role, mapping in CANONICAL_MAPPINGS.items():
        datasets.append(ConfirmedDatasetMapping(
            source_dataset=role,
            mappings=[ColumnMappingCandidate(
                source_dataset=role, source_column=source, canonical_field=canonical,
                confidence=1, rationale="Benchmark canonical mapping",
                proposed_by=ProposedBy.DETERMINISTIC,
            ) for canonical, source in mapping.items()],
        ))
    return ConfirmedMappingSet(reconciliation_id=uuid4(), datasets=datasets)


def main() -> None:
    government = pd.DataFrame([row(DatasetRole.GOVERNMENT, i, near=i >= 8000) for i in range(10_000)])
    purchase = pd.DataFrame([row(DatasetRole.PURCHASE_REGISTER, i, near=i >= 8000) for i in range(10_500)])
    tracemalloc.start()
    exact_started = perf_counter()
    matches = ExactMatchEngine().match(government, purchase)
    exact_ms = round((perf_counter() - exact_started) * 1000, 2)
    near = NearMatchEngine().analyze(uuid4(), government, purchase, confirmed_mapping(), matches)
    _, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    report = {
        "dataset": {"government_records": 10_000, "purchase_register_records": 10_500},
        "exact": {"matches": len(matches), "runtime_ms": exact_ms},
        "near": {"candidate_count": near.summary.candidate_count,
                 "high_confidence_proposals": near.summary.high_confidence_proposals,
                 "runtime_ms": near.summary.runtime_ms},
        "total_runtime_ms": round(exact_ms + near.summary.runtime_ms, 2),
        "peak_memory_mb": round(peak / 1024 / 1024, 2),
        "notes": ["Synthetic deterministic benchmark, not a production SLA.",
                  "Unique GSTIN blocking bounds the remaining candidate set after 8,000 exact matches."],
    }
    output = PROJECT_ROOT / "reports" / "phase7a_performance.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
