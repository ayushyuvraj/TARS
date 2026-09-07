from __future__ import annotations

import argparse
import json
from pathlib import Path

from app.config import get_settings
from app.domain.models import DatasetRole
from app.evaluation.schema_mapping import SchemaMappingEvaluator
from app.providers.factory import create_llm_provider
from app.services.excel_parser import ExcelParser


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate a configured LLM schema mapper")
    parser.add_argument("--workbook", required=True, type=Path)
    parser.add_argument("--role", required=True, choices=[role.value for role in DatasetRole])
    parser.add_argument("--expected-json", required=True, type=Path)
    args = parser.parse_args()

    settings = get_settings()
    role = DatasetRole(args.role)
    profile = ExcelParser().parse(args.workbook, role).profile
    raw_expected = json.loads(args.expected_json.read_text(encoding="utf-8"))
    expected = {(role, source): canonical for source, canonical in raw_expected.items()}
    report = SchemaMappingEvaluator().evaluate(
        [profile], expected, create_llm_provider(settings), settings.llm_model
    )
    print(report.model_dump_json(indent=2))


if __name__ == "__main__":
    main()

