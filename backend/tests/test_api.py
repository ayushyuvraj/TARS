def _upload(client, reconciliation_id, endpoint, path):
    with path.open("rb") as workbook:
        return client.post(
            f"/api/reconciliations/{reconciliation_id}/files/{endpoint}",
            files={
                "file": (
                    path.name,
                    workbook,
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                )
            },
        )


def test_reconciliation_list_returns_persisted_sessions_without_creating_one(client, sample_files):
    first_id = client.post("/api/reconciliations").json()["id"]
    _upload(client, first_id, "government", sample_files["government"])
    _upload(client, first_id, "purchase-register", sample_files["purchase_register"])
    second_id = client.post("/api/reconciliations").json()["id"]

    listed = client.get("/api/reconciliations")

    assert listed.status_code == 200
    assert [item["id"] for item in listed.json()] == [second_id, first_id]
    assert listed.json()[0]["current_stage"] == "setup"
    assert listed.json()[1]["government_records"] == 1000
    assert listed.json()[1]["purchase_register_records"] == 1050
    assert listed.json()[1]["remaining_government_records"] == 1000
    assert listed.json()[1]["remaining_purchase_register_records"] == 1050
    assert client.get("/api/reconciliations").json() == listed.json()


def test_api_summary_matches_engine_and_audit_event_is_emitted(client, sample_files):
    created = client.post("/api/reconciliations")
    assert created.status_code == 201
    reconciliation_id = created.json()["id"]

    government = _upload(
        client, reconciliation_id, "government", sample_files["government"]
    )
    purchase_register = _upload(
        client,
        reconciliation_id,
        "purchase-register",
        sample_files["purchase_register"],
    )
    assert government.status_code == 200, government.text
    assert purchase_register.status_code == 200, purchase_register.text

    ready = client.get(f"/api/reconciliations/{reconciliation_id}")
    assert ready.status_code == 200
    assert ready.json()["status"] == "ready"

    blocked = client.post(f"/api/reconciliations/{reconciliation_id}/run/exact-match")
    assert blocked.status_code == 409
    assert blocked.json()["detail"]["code"] == "reconciliation_not_ready"

    analyzed = client.post(f"/api/reconciliations/{reconciliation_id}/mapping/analyze")
    assert analyzed.status_code == 200, analyzed.text
    assert analyzed.json()["validation"]["valid"] is True
    paused = client.get(f"/api/reconciliations/{reconciliation_id}")
    assert paused.json()["status"] == "awaiting_mapping_approval"

    confirmed = client.post(f"/api/reconciliations/{reconciliation_id}/mapping/confirm")
    assert confirmed.status_code == 200, confirmed.text

    run = client.post(f"/api/reconciliations/{reconciliation_id}/run/exact-match")
    assert run.status_code == 200, run.text
    assert run.json() == {
        "reconciliation_id": reconciliation_id,
        "status": "completed",
        "government_records": 1000,
        "purchase_register_records": 1050,
        "exact_matches": 520,
        "remaining_government_records": 480,
        "remaining_purchase_register_records": 530,
    }

    summary = client.get(f"/api/reconciliations/{reconciliation_id}/summary")
    assert summary.status_code == 200
    assert summary.json() == run.json()

    audit = client.get(f"/api/reconciliations/{reconciliation_id}/audit-events")
    assert audit.status_code == 200
    event_types = [event["event_type"] for event in audit.json()]
    assert "exact_match.completed" in event_types
    assert "dataset.profile.completed" in event_types
    assert "schema_mapping.approval_required" in event_types
    assert "schema_mapping.confirmed" in event_types
    assert "exact_match.started" in event_types
    exact_event = next(
        event for event in audit.json() if event["event_type"] == "exact_match.completed"
    )
    assert exact_event["output_count"] == 520
    assert exact_event["metadata"]["one_to_one"] is True
