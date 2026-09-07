from __future__ import annotations

import argparse
import tempfile
from pathlib import Path

import pandas as pd
from fastapi.testclient import TestClient

from app.config import Settings
from app.evaluation.near_match import NearMatchEvaluator
from app.main import create_app


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate deterministic near matching against workbook ground truth.")
    parser.add_argument("--government", required=True, type=Path)
    parser.add_argument("--purchase-register", required=True, type=Path)
    parser.add_argument("--ground-truth", required=True, type=Path)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="gst-near-eval-") as temporary:
        root = Path(temporary)
        app = create_app(Settings(database_path=root / "evaluation.db", upload_dir=root / "uploads"))
        with TestClient(app) as client:
            reconciliation_id = client.post("/api/reconciliations").json()["id"]
            for endpoint, workbook in (("government", args.government), ("purchase-register", args.purchase_register)):
                with workbook.open("rb") as stream:
                    response = client.post(
                        f"/api/reconciliations/{reconciliation_id}/files/{endpoint}",
                        files={"file": (workbook.name, stream, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
                    )
                response.raise_for_status()
            for endpoint in ("mapping/analyze", "mapping/confirm", "policy/propose", "policy/confirm",
                             "run/exact-match", "run/tolerance-match", "near-match/analyze"):
                response = client.post(f"/api/reconciliations/{reconciliation_id}/{endpoint}")
                response.raise_for_status()
            analysis = app.state.reconciliation_service.get_near_analysis(reconciliation_id)
            report = NearMatchEvaluator().evaluate(analysis, pd.read_excel(args.ground_truth))
            print(report.model_dump_json(indent=2))


if __name__ == "__main__":
    main()
