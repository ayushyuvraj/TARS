import pytest
from app.domain.models import SessionStatus


def _upload_file(client, reconciliation_id, endpoint, path):
    with path.open("rb") as f:
        return client.post(
            f"/api/reconciliations/{reconciliation_id}/files/{endpoint}",
            files={"file": (path.name, f, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        )


def test_stage_progress_and_abort_contract(client, sample_files):
    # Setup session
    resA = client.post("/api/reconciliations")
    rid = resA.json()["id"]
    _upload_file(client, rid, "government", sample_files["government"])
    _upload_file(client, rid, "purchase-register", sample_files["purchase_register"])

    # 1. Progress endpoint returns stage state
    prog = client.get(f"/api/reconciliations/{rid}/progress")
    assert prog.status_code == 200
    pdata = prog.json()
    assert pdata["reconciliation_id"] == rid
    assert "current_action" in pdata
    assert "estimated_remaining_text" in pdata

    # 2. Abort request updates session status to aborted without deleting session
    abort_res = client.post(f"/api/reconciliations/{rid}/abort")
    assert abort_res.status_code == 200
    adata = abort_res.json()
    assert adata["status"] == "aborted"
    assert adata["abort_requested"] is True

    # 3. Session remains intact in registry after abort
    rec_res = client.get("/api/reconciliations")
    assert rec_res.status_code == 200
    ids = [r["id"] for r in rec_res.json()]
    assert rid in ids


def test_stage_abort_preserves_completed_stages(client, sample_files):
    resA = client.post("/api/reconciliations")
    rid = resA.json()["id"]
    _upload_file(client, rid, "government", sample_files["government"])
    _upload_file(client, rid, "purchase-register", sample_files["purchase_register"])

    client.post(f"/api/reconciliations/{rid}/mapping/analyze")
    client.post(f"/api/reconciliations/{rid}/mapping/confirm")

    # Issue abort
    abort_res = client.post(f"/api/reconciliations/{rid}/stages/exact_matching/abort")
    assert abort_res.status_code == 200

    # Confirmed mapping stage remains completed
    prog = client.get(f"/api/reconciliations/{rid}/progress").json()
    mapping_stage = next((st for st in prog["stages"] if st["name"] == "mapping"), None)
    assert mapping_stage is not None
    assert mapping_stage["status"] == "completed"


def test_resume_after_abort(client, sample_files):
    resA = client.post("/api/reconciliations")
    rid = resA.json()["id"]
    _upload_file(client, rid, "government", sample_files["government"])
    _upload_file(client, rid, "purchase-register", sample_files["purchase_register"])
    client.post(f"/api/reconciliations/{rid}/mapping/analyze")
    client.post(f"/api/reconciliations/{rid}/mapping/confirm")
    client.post(f"/api/reconciliations/{rid}/policy/propose")
    client.post(f"/api/reconciliations/{rid}/policy/confirm")

    # Abort then quick-resume
    client.post(f"/api/reconciliations/{rid}/abort")
    resume_res = client.post(f"/api/reconciliations/{rid}/quick-resume")
    assert resume_res.status_code == 200


def test_eta_and_action_fields_in_progress(client, sample_files):
    resA = client.post("/api/reconciliations")
    rid = resA.json()["id"]
    prog = client.get(f"/api/reconciliations/{rid}/progress").json()
    assert "current_action" in prog
    assert "estimated_remaining_seconds" in prog
    assert "estimated_remaining_text" in prog
    assert "abort_requested" in prog
    assert "completed_stages_count" in prog
    assert "total_stages_count" in prog
    assert prog["total_stages_count"] == 8
