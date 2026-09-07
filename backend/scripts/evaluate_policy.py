from __future__ import annotations

import argparse
import json
from pathlib import Path

from app.config import get_settings
from app.domain.models import (
    ColumnMappingCandidate, ConfirmedDatasetMapping, ConfirmedMappingSet, DatasetRole,
    PolicyFieldRule, ProposedBy,
)
from app.evaluation.policy import PolicyEvaluationCase, PolicyInterpretationEvaluator
from app.providers.factory import create_llm_provider


def main() -> None:
    parser = argparse.ArgumentParser(description="Run provider-agnostic policy interpretation evaluation.")
    parser.add_argument("--cases", required=True, type=Path, help="JSON list of policy evaluation cases")
    args = parser.parse_args()
    settings = get_settings()
    provider = create_llm_provider(settings)
    raw_cases = json.loads(args.cases.read_text(encoding="utf-8"))
    cases = [PolicyEvaluationCase.model_validate(item) for item in raw_cases]
    fields = sorted({rule.canonical_field for case in cases for rule in case.expected_rules} | {"record_id"})
    mapping = ConfirmedMappingSet(
        reconciliation_id="00000000-0000-0000-0000-000000000001",
        datasets=[ConfirmedDatasetMapping(
            source_dataset=role,
            mappings=[ColumnMappingCandidate(
                source_dataset=role, source_column=field, canonical_field=field,
                confidence=1, rationale="Evaluation fixture", proposed_by=ProposedBy.HUMAN,
            ) for field in fields],
        ) for role in DatasetRole],
    )
    report = PolicyInterpretationEvaluator(provider, settings.llm_model).evaluate(cases, mapping)
    print(report.model_dump_json(indent=2))


if __name__ == "__main__":
    main()
