import pytest
from app.domain.models import (
    ReconciliationProgress,
    StageProgressItem,
    ReconciliationProgressCounters,
    AgentActivityEvent,
)

def test_reconciliation_progress_legacy_payload_compatibility():
    """Verify that legacy reconciliation progress payloads missing optional fields construct safely without error."""
    progress = ReconciliationProgress(
        reconciliation_id="test-legacy-id-123",
        status="completed",
        started_at="2026-09-01T10:00:00Z",
        updated_at="2026-09-01T10:05:00Z",
        completed_at="2026-09-01T10:05:00Z",
        current_stage="finalization",
        stages=[
            StageProgressItem(
                name="setup",
                status="completed",
                started_at="2026-09-01T10:00:00Z",
                completed_at="2026-09-01T10:01:00Z",
                processed_records=None,
                total_records=None,
            )
        ],
        counters=ReconciliationProgressCounters(),
        activities=[],
        interrupt=None,
        error=None,
    )

    dump = progress.model_dump()
    assert dump["reconciliation_id"] == "test-legacy-id-123"
    assert dump["completed_stages_count"] == 1
    assert dump["total_stages_count"] == 8
    assert dump["stages"][0]["processed_records"] is None

def test_reconciliation_progress_partial_telemetry():
    """Verify partial telemetry objects with null dates and empty activities parse without exception."""
    progress = ReconciliationProgress(
        reconciliation_id="test-partial-id",
        status="running",
        started_at=None,
        updated_at=None,
        completed_at=None,
        current_stage="exact_matching",
        stages=[],
        counters=ReconciliationProgressCounters(government_records=500, purchase_register_records=500),
        activities=[],
    )
    assert progress.completed_stages_count == 0
    assert progress.total_stages_count == 8
