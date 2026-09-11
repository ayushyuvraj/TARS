from __future__ import annotations

import json
import pytest
from app.services.copilot_action_engine import CopilotActionEngine
from app.services.audit_v2_service import audit_v2_service


def test_classify_fast_intent_navigation():
    engine = CopilotActionEngine()

    # Forward
    res = engine.classify_fast_intent("go forward", "setup")
    assert res is not None
    assert res["action"] == "NAVIGATE_STAGE"
    assert res["target_stage"] == "mapping"

    # Forward from mapping
    res2 = engine.classify_fast_intent("proceed", "mapping")
    assert res2 is not None
    assert res2["target_stage"] == "rules"

    # Backward / reconsider
    res3 = engine.classify_fast_intent("reconsider", "rules")
    assert res3 is not None
    assert res3["action"] == "NAVIGATE_STAGE"
    assert res3["target_stage"] == "mapping"

    # Direct jump
    res4 = engine.classify_fast_intent("go to results", "mapping")
    assert res4 is not None
    assert res4["target_stage"] == "results"


def test_classify_fast_intent_mapping():
    engine = CopilotActionEngine()

    res = engine.classify_fast_intent(
        "Make sure that Vendor Name from PR is mapped to Supplier Legal Name from GSTR",
        "mapping",
    )
    assert res is not None
    assert res["action"] == "UPDATE_MAPPING"
    assert res["action_type"] == "map"
    assert "Vendor Name" in res["pr_column"]
    assert "Supplier Legal Name" in res["gstr_column"]

    # Unmap
    res_unmap = engine.classify_fast_intent("ignore mapping for Cess Amount", "mapping")
    assert res_unmap is not None
    assert res_unmap["action"] == "UPDATE_MAPPING"
    assert res_unmap["action_type"] == "unmap"
    assert "Cess Amount" in res_unmap["column"]


def test_classify_fast_intent_rules():
    engine = CopilotActionEngine()

    # Add rule
    res_add = engine.classify_fast_intent(
        "See if you can add a rule regarding invoice date within 30 days",
        "rules",
    )
    assert res_add is not None
    assert res_add["action"] == "ADD_RULE"
    assert "invoice date within 30 days" in res_add["instruction"]

    # Disable / ignore rule
    res_ignore = engine.classify_fast_intent("ignore rule R-04", "rules")
    assert res_ignore is not None
    assert res_ignore["action"] == "TOGGLE_RULE"
    assert "R-04" in res_ignore["rule_target"]
    assert res_ignore["is_active"] is False


def test_classify_fast_intent_reconcile():
    engine = CopilotActionEngine()

    res = engine.classify_fast_intent("reconcile", "setup")
    assert res is not None
    assert res["action"] == "RUN_RECONCILIATION"


def test_execute_action_and_audit():
    engine = CopilotActionEngine()
    session_id = "test-session-copilot-123"

    plan = {
        "action": "UPDATE_MAPPING",
        "pr_column": "Vendor Name",
        "gstr_column": "Supplier Legal Name",
        "action_type": "map",
        "explanation": "Mapping PR Vendor Name to GSTR Supplier Legal Name.",
    }

    result = engine.execute_action(
        session_id=session_id,
        action_plan=plan,
        user_prompt="map vendor name to supplier legal name",
        stage_context={"activeStage": "mapping"},
    )

    assert result["status"] == "success"
    assert result["action"] == "UPDATE_MAPPING"

    # Verify audit step was logged with AI_COPILOT actor
    steps = audit_v2_service.get_session_steps(session_id)
    copilot_steps = [s for s in steps if s.get("actor") == "AI_COPILOT"]
    assert len(copilot_steps) > 0
    assert copilot_steps[-1]["component"] == "copilot_action_engine"


def test_stream_response_action():
    import asyncio

    async def _run():
        engine = CopilotActionEngine()
        chunks = []
        async for chunk in engine.stream_response(
            prompt="go forward",
            session_id="test-session-copilot-123",
            current_stage="rules",
            stage_context={"activeStage": "rules", "stageNumber": 3, "stageLabel": "Stage 3: Rules"},
        ):
            chunks.append(chunk)

        full_output = "".join(chunks)
        assert "NAVIGATE_STAGE" in full_output
        assert "results" in full_output
        assert "done" in full_output

    asyncio.run(_run())
