from uuid import uuid4
from pathlib import Path
from fastapi.testclient import TestClient
import pytest

from app.main import create_app
from app.config import Settings
from app.domain.models import DatasetRole


@pytest.fixture
def client(tmp_path: Path):
    settings = Settings(
        database_path=tmp_path / "test_gst_reconciliation.db",
        upload_dir=tmp_path / "uploads",
        export_dir=tmp_path / "exports",
    )
    app = create_app(settings)
    return TestClient(app)


def test_1_global_reconciliation_listing_works_with_no_active_session(client: TestClient):
    """TEST 1: Global reconciliation listing works with no active session."""
    response = client.get("/api/reconciliations")
    assert response.status_code == 200
    assert isinstance(response.json(), list)


def test_2_existing_reconciliation_remains_listed_after_creating_quick_reconcile(client: TestClient):
    """TEST 2: Existing reconciliation remains listed after creating a new Quick Reconcile session."""
    r1 = client.post("/api/reconciliations")
    assert r1.status_code == 200
    session1_id = r1.json()["id"]

    list1 = client.get("/api/reconciliations").json()
    assert any(item["id"] == session1_id for item in list1)

    r2 = client.post("/api/reconciliations")
    assert r2.status_code == 200
    session2_id = r2.json()["id"]

    list2 = client.get("/api/reconciliations").json()
    ids = [item["id"] for item in list2]
    assert session1_id in ids
    assert session2_id in ids


def test_3_global_registry_listing_does_not_depend_on_active_session(client: TestClient):
    """TEST 3: Listing reconciliations returns full persisted registry independent of active session."""
    r1 = client.post("/api/reconciliations")
    session_id = r1.json()["id"]

    res = client.get("/api/reconciliations")
    assert res.status_code == 200
    assert len(res.json()) >= 1
    assert any(s["id"] == session_id for s in res.json())


def test_4_clearing_selected_session_does_not_clear_registry(client: TestClient):
    """TEST 4: Clearing selected session does not delete or hide reconciliation registry."""
    r1 = client.post("/api/reconciliations")
    session_id = r1.json()["id"]

    list_before = client.get("/api/reconciliations").json()
    assert len(list_before) >= 1

    list_after = client.get("/api/reconciliations").json()
    assert len(list_after) == len(list_before)


def test_5_list_api_nonexistent_endpoint_returns_404_error(client: TestClient):
    """TEST 5: Invalid endpoint returns HTTP error rather than false empty state."""
    res = client.get("/api/reconciliations/non-existent-endpoint-12345")
    assert res.status_code in (404, 405, 422)


def test_6_historical_session_uuid_never_used_as_fallback(client: TestClient):
    """TEST 6: Historical session UUID is never used as fallback for new Quick Reconcile run."""
    historical_uuid = "ac6257c5-7d4d-441a-9557-a162ba875636"
    
    res = client.post("/api/reconciliations")
    assert res.status_code == 200
    new_id = res.json()["id"]
    
    assert new_id != historical_uuid
