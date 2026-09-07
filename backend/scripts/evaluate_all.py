"""One command for deterministic backend acceptance and scale checks."""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]


def run(command: list[str]) -> None:
    completed = subprocess.run(command, cwd=BACKEND_ROOT, check=False)
    if completed.returncode:
        raise SystemExit(completed.returncode)


if __name__ == "__main__":
    run([sys.executable, "-m", "pytest", "-q"])
    sample_root = BACKEND_ROOT.parent / "sample_data"
    run([
        sys.executable, str(BACKEND_ROOT / "scripts" / "evaluate_near_match.py"),
        "--government", str(sample_root / "POC_Government_GST_Aug2026.xlsx"),
        "--purchase-register", str(sample_root / "POC_Purchase_Register_Aug2026.xlsx"),
        "--ground-truth", str(sample_root / "POC_Reconciliation_Ground_Truth.xlsx"),
    ])
    run([sys.executable, str(BACKEND_ROOT / "scripts" / "benchmark_phase7a.py")])
