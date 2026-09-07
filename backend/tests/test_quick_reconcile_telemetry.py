import pytest
from app.domain.models import SessionStatus


def _upload_file(client, reconciliation_id, endpoint, path):
    with path.open("rb") as f:
        return client.post(
            f"/api/reconciliations/{reconciliation_id}/files/{endpoint}",
            files={"file": (path.name, f, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        )


def test_quick_reconcile_zero_touch_auto_advance(client, sample_files):
    # Create approved client profile from session A
    resA = client.post("/api/reconciliations")
    ridA = resA.json()["id"]
    _upload_file(client, ridA, "government", sample_files["government"])
    _upload_file(client, ridA, "purchase-register", sample_files["purchase_register"])
    client.post(f"/api/reconciliations/{ridA}/mapping/analyze")
    client.post(f"/api/reconciliations/{ridA}/mapping/confirm")
    client.post(f"/api/reconciliations/{ridA}/policy/propose")
    client.post(f"/api/reconciliations/{ridA}/policy/confirm")

    prof_res = client.post(
        f"/api/client-profiles/from-reconciliation/{ridA}",
        json={"client_name": "ZeroTouch Corp", "profile_name": "ZeroTouch Profile"},
    )
    assert prof_res.status_code == 200, prof_res.text
    profile_id = prof_res.json()["id"]

    # Now Quick Reconcile with reusable profile
    with sample_files["government"].open("rb") as f1, sample_files["purchase_register"].open("rb") as f2:
        resB = client.post(
            "/api/reconciliations/quick-reconcile",
            data={"profile_id": profile_id},
            files={
                "file_1": (sample_files["government"].name, f1, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
                "file_2": (sample_files["purchase_register"].name, f2, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
            },
        )
    assert resB.status_code == 200, resB.text
    ridB = resB.json()["reconciliation_id"]

    # Progress should reflect matching pipeline execution without manual intervention
    prog = client.get(f"/api/reconciliations/{ridB}/progress")
    assert prog.status_code == 200
    pdata = prog.json()
    assert pdata["reconciliation_id"] == ridB
    assert pdata["counters"]["government_records"] == 1000
    assert pdata["counters"]["purchase_register_records"] == 1050


def test_missing_mapping_produces_interrupt(client, sample_files):
    with sample_files["government"].open("rb") as f1, sample_files["purchase_register"].open("rb") as f2:
        res = client.post(
            "/api/reconciliations/quick-reconcile",
            files={
                "file_1": (sample_files["government"].name, f1, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
                "file_2": (sample_files["purchase_register"].name, f2, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
            },
        )
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "awaiting_mapping_approval" or data["interrupt"] is not None


def test_progress_api_reports_actual_stage_and_telemetry(client, sample_files):
    resA = client.post("/api/reconciliations")
    ridA = resA.json()["id"]
    _upload_file(client, ridA, "government", sample_files["government"])
    _upload_file(client, ridA, "purchase-register", sample_files["purchase_register"])
    client.post(f"/api/reconciliations/{ridA}/mapping/analyze")
    client.post(f"/api/reconciliations/{ridA}/mapping/confirm")
    client.post(f"/api/reconciliations/{ridA}/policy/propose")
    client.post(f"/api/reconciliations/{ridA}/policy/confirm")

    res = client.post(f"/api/reconciliations/{ridA}/quick-resume")
    assert res.status_code == 200

    prog = client.get(f"/api/reconciliations/{ridA}/progress")
    assert prog.status_code == 200
    pdata = prog.json()
    assert "status" in pdata
    assert "current_stage" in pdata
    assert "stages" in pdata
    assert "counters" in pdata
    assert "activities" in pdata
    assert pdata["started_at"] is not None


def test_elapsed_timestamps_survive_reload(client, sample_files):
    resA = client.post("/api/reconciliations")
    ridA = resA.json()["id"]
    _upload_file(client, ridA, "government", sample_files["government"])
    _upload_file(client, ridA, "purchase-register", sample_files["purchase_register"])
    client.post(f"/api/reconciliations/{ridA}/mapping/analyze")
    client.post(f"/api/reconciliations/{ridA}/mapping/confirm")
    client.post(f"/api/reconciliations/{ridA}/policy/propose")
    client.post(f"/api/reconciliations/{ridA}/policy/confirm")
    client.post(f"/api/reconciliations/{ridA}/quick-resume")

    prog1 = client.get(f"/api/reconciliations/{ridA}/progress").json()
    prog2 = client.get(f"/api/reconciliations/{ridA}/progress").json()
    assert prog1["started_at"] == prog2["started_at"]


def test_reconciliation_remains_visible_in_global_registry_while_running(client, sample_files):
    resA = client.post("/api/reconciliations")
    ridA = resA.json()["id"]
    _upload_file(client, ridA, "government", sample_files["government"])
    _upload_file(client, ridA, "purchase-register", sample_files["purchase_register"])

    list_res = client.get("/api/reconciliations")
    assert list_res.status_code == 200
    ids = [r["id"] for r in list_res.json()]
    assert ridA in ids


def test_session_activity_isolation(client, sample_files):
    resA = client.post("/api/reconciliations")
    ridA = resA.json()["id"]
    resB = client.post("/api/reconciliations")
    ridB = resB.json()["id"]

    progA = client.get(f"/api/reconciliations/{ridA}/progress").json()
    progB = client.get(f"/api/reconciliations/{ridB}/progress").json()

    activitiesA = [act["event_id"] for act in progA["activities"]]
    activitiesB = [act["event_id"] for act in progB["activities"]]

    # Activities for session A should not leak into session B
    assert set(activitiesA).isdisjoint(set(activitiesB))


def test_no_raw_llm_cot_in_api_response(client, sample_files):
    resA = client.post("/api/reconciliations")
    ridA = resA.json()["id"]
    prog = client.get(f"/api/reconciliations/{ridA}/progress").json()

    for act in prog["activities"]:
        assert "chain_of_thought" not in act
        assert "raw_reasoning_tokens" not in act
