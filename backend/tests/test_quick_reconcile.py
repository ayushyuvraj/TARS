import pytest
from app.domain.models import DatasetRole, SessionStatus


def _upload_file(client, reconciliation_id, endpoint, path):
    with path.open("rb") as f:
        return client.post(
            f"/api/reconciliations/{reconciliation_id}/files/{endpoint}",
            files={"file": (path.name, f, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        )


def test_detect_file_roles_endpoint(client, sample_files):
    with sample_files["government"].open("rb") as f1, sample_files["purchase_register"].open("rb") as f2:
        res = client.post(
            "/api/reconciliations/detect-roles",
            files={
                "file_1": (sample_files["government"].name, f1, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
                "file_2": (sample_files["purchase_register"].name, f2, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
            },
        )
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["file_1_role"] == "government"
    assert data["file_2_role"] == "purchase_register"
    assert data["confidence"] >= 0.80
    assert data["is_confident"] is True


def test_quick_reconcile_interrupt_on_new_schema(client, sample_files):
    with sample_files["government"].open("rb") as f1, sample_files["purchase_register"].open("rb") as f2:
        res = client.post(
            "/api/reconciliations/quick-reconcile",
            files={
                "file_1": (sample_files["government"].name, f1, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
                "file_2": (sample_files["purchase_register"].name, f2, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
            },
        )
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["status"] == "awaiting_mapping_approval"
    assert data["interrupt"]["interrupt_type"] == "mapping"
    assert data["interrupt"]["action_label"] == "Review Mapping"
    assert data["government_records"] == 1000
    assert data["purchase_register_records"] == 1050


def test_quick_reconcile_resume_flow(client, sample_files):
    with sample_files["government"].open("rb") as f1, sample_files["purchase_register"].open("rb") as f2:
        res = client.post(
            "/api/reconciliations/quick-reconcile",
            files={
                "file_1": (sample_files["government"].name, f1, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
                "file_2": (sample_files["purchase_register"].name, f2, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
            },
        )
    data = res.json()
    rid = data["reconciliation_id"]

    # Human confirms mapping
    conf_map = client.post(f"/api/reconciliations/{rid}/mapping/confirm")
    assert conf_map.status_code == 200

    # Resume -> interrupts for policy
    resume1 = client.post(f"/api/reconciliations/{rid}/quick-resume")
    assert resume1.status_code == 200
    data1 = resume1.json()
    assert data1["status"] == "awaiting_policy_approval"
    assert data1["interrupt"]["interrupt_type"] == "policy"

    # Human confirms policy
    conf_pol = client.post(f"/api/reconciliations/{rid}/policy/confirm")
    assert conf_pol.status_code == 200

    # Resume -> completes pipeline
    resume2 = client.post(f"/api/reconciliations/{rid}/quick-resume")
    assert resume2.status_code == 200
    data2 = resume2.json()
    assert data2["status"] == "completed"
    assert data2["summary"]["exact_matches"] == 520


def test_quick_reconcile_reuse_approved_profile(client, sample_files):
    # Setup session A and create profile
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
        json={"client_name": "Acme Corp", "profile_name": "Standard Policy"},
    )
    assert prof_res.status_code == 200, prof_res.text
    profile_id = prof_res.json()["id"]

    # Run quick reconcile passing profile_id
    with sample_files["government"].open("rb") as f1, sample_files["purchase_register"].open("rb") as f2:
        quick = client.post(
            "/api/reconciliations/quick-reconcile",
            data={"profile_id": profile_id},
            files={
                "file_1": (sample_files["government"].name, f1, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
                "file_2": (sample_files["purchase_register"].name, f2, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
            },
        )
    assert quick.status_code == 200, quick.text
    qdata = quick.json()
    assert qdata["status"] == "completed"
    assert qdata["profile_reused"] is True
    assert qdata["profile_name"] == "Standard Policy"
    assert qdata["summary"]["exact_matches"] == 520


def test_instruction_governance_no_silent_policy_approval(client, sample_files):
    # Natural language instruction without approved profile MUST interrupt for policy review
    with sample_files["government"].open("rb") as f1, sample_files["purchase_register"].open("rb") as f2:
        quick = client.post(
            "/api/reconciliations/quick-reconcile",
            data={"instruction": "allow ₹50 taxable difference"},
            files={
                "file_1": (sample_files["government"].name, f1, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
                "file_2": (sample_files["purchase_register"].name, f2, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
            },
        )
    qdata = quick.json()
    rid = qdata["reconciliation_id"]
    client.post(f"/api/reconciliations/{rid}/mapping/confirm")

    # Resume with instruction -> MUST interrupt for policy review (no silent policy approval!)
    resume = client.post(f"/api/reconciliations/{rid}/quick-resume", params={"instruction": "allow ₹50 taxable difference"})
    rdata = resume.json()
    assert rdata["status"] == "awaiting_policy_approval"
    assert rdata["interrupt"]["interrupt_type"] == "policy"
    assert rdata["interrupt"]["action_label"] == "Review Policy"


def test_resume_without_human_approval_cannot_bypass_governance(client, sample_files):
    # Calling quick-resume without mapping confirmation MUST remain paused at mapping
    with sample_files["government"].open("rb") as f1, sample_files["purchase_register"].open("rb") as f2:
        quick = client.post(
            "/api/reconciliations/quick-reconcile",
            files={
                "file_1": (sample_files["government"].name, f1, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
                "file_2": (sample_files["purchase_register"].name, f2, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
            },
        )
    data = quick.json()
    rid = data["reconciliation_id"]

    # Resume immediately without human confirming mapping
    resume = client.post(f"/api/reconciliations/{rid}/quick-resume")
    rdata = resume.json()
    assert rdata["status"] == "awaiting_mapping_approval"
    assert rdata["interrupt"]["interrupt_type"] == "mapping"


def test_dual_government_and_dual_pr_role_detection_safety(client, sample_files):
    # Uploading two Government files must trigger ambiguous role alert (is_confident = False)
    with sample_files["government"].open("rb") as f1, sample_files["government"].open("rb") as f2:
        res = client.post(
            "/api/reconciliations/detect-roles",
            files={
                "file_1": ("gov1.xlsx", f1, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
                "file_2": ("gov2.xlsx", f2, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
            },
        )
    data = res.json()
    assert data["is_confident"] is False
    assert "Both files appear to be Government" in data["reason"]


def test_orphan_session_prevention_on_invalid_file(client):
    before_sessions = len(client.get("/api/reconciliations").json())
    # Upload invalid file format
    res = client.post(
        "/api/reconciliations/quick-reconcile",
        files={
            "file_1": ("test.txt", b"invalid text content", "text/plain"),
            "file_2": ("test2.txt", b"invalid text content", "text/plain"),
        },
    )
    assert res.status_code == 415
    after_sessions = len(client.get("/api/reconciliations").json())
    # Verify no orphan dead session was persisted
    assert after_sessions == before_sessions

