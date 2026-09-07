from __future__ import annotations

from test_phase5 import _phase5_session


def test_exception_route_payloads_are_bounded_and_lazy(client, sample_files, monkeypatch):
    reconciliation_id = _phase5_session(client, sample_files)

    session = client.get(
        f"/api/reconciliations/{reconciliation_id}?include_near_analysis=false"
    )
    assert session.status_code == 200
    assert session.json()["near_match_analysis"] is None
    assert session.json()["near_match_summary"]["material_mismatch_records"] == 80

    def unexpected_workbook_parse(*_args, **_kwargs):
        raise AssertionError("A bounded exception list must not parse source workbooks")

    monkeypatch.setattr(
        client.app.state.reconciliation_service.parser, "parse", unexpected_workbook_parse
    )
    first = client.get(
        f"/api/reconciliations/{reconciliation_id}/exceptions/records",
        params={"category": "MATERIAL_MISMATCH", "offset": 0, "limit": 50},
    )
    second = client.get(
        f"/api/reconciliations/{reconciliation_id}/exceptions/records",
        params={"category": "MATERIAL_MISMATCH", "offset": 50, "limit": 50},
    )

    assert first.status_code == second.status_code == 200
    assert first.json()["total"] == second.json()["total"] == 80
    assert len(first.json()["records"]) == 50
    assert len(second.json()["records"]) == 30
    assert first.json()["records"][0]["record_id"] != second.json()["records"][0]["record_id"]
    assert all(record["best_candidate"] is None for record in first.json()["records"])

    selected_id = first.json()["records"][0]["record_id"]
    detail = client.get(
        f"/api/reconciliations/{reconciliation_id}/records/{selected_id}",
        params={"include_source_values": "false"},
    )
    assert detail.status_code == 200
    assert detail.json()["record_id"] == selected_id
    assert detail.json()["best_candidate"] is not None

    unmatched_detail = client.get(
        f"/api/reconciliations/{reconciliation_id}/records/GST-00881",
        params={"include_source_values": "false"},
    )
    assert unmatched_detail.status_code == 200
    assert unmatched_detail.json()["status"] == "GST_ONLY"
    assert unmatched_detail.json()["values"]["gstin"]
    assert unmatched_detail.json()["values"]["document_number"]


def test_exception_list_enforces_limit_and_supports_search(client, sample_files):
    reconciliation_id = _phase5_session(client, sample_files)
    oversized = client.get(
        f"/api/reconciliations/{reconciliation_id}/exceptions/records",
        params={"limit": 101},
    )
    assert oversized.status_code == 422

    result = client.get(
        f"/api/reconciliations/{reconciliation_id}/exceptions/records",
        params={"category": "GST_ONLY", "search": "GST-00881", "limit": 10},
    )
    assert result.status_code == 200
    assert [record["record_id"] for record in result.json()["records"]] == ["GST-00881"]
