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

    # With attachment annotation appended by chat UI
    res2 = engine.classify_fast_intent(
        "Reconcile (Attached: TARS_Government_GSTR2B_223cols_10000Rows.xlsx, TARS_Purchase_Register_223cols_10500Rows.xlsx)",
        "setup",
    )
    assert res2 is not None
    assert res2["action"] == "RUN_RECONCILIATION"


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


def test_fast_excel_parser_preflight_sanity():
    from pathlib import Path
    from app.domain.models import DatasetRole
    from app.services.fast_excel_parser import FastExcelParser

    root = Path(__file__).resolve().parents[2]
    gov_file = root / "sample_data" / "POC_Government_GST_Aug2026.xlsx"
    pr_file = root / "sample_data" / "POC_Purchase_Register_Aug2026.xlsx"

    parser = FastExcelParser()
    prof_gov = parser.parse_fast_profile(gov_file, DatasetRole.GOVERNMENT, sample_size=10)
    assert len(prof_gov.columns) > 0
    cols_gov = " ".join([c.name.lower() for c in prof_gov.columns])
    assert any(k in cols_gov for k in ["gst", "tax", "inv", "bill", "doc"])

    prof_pr = parser.parse_fast_profile(pr_file, DatasetRole.PURCHASE_REGISTER, sample_size=10)
    assert len(prof_pr.columns) > 0
    cols_pr = " ".join([c.name.lower() for c in prof_pr.columns])
    assert any(k in cols_pr for k in ["gst", "tax", "inv", "bill", "doc"])


def test_copilot_auto_reconcile_stream_execution():
    import asyncio
    from app.api.reconciliations_v2 import copilot_auto_reconcile_stream, get_v2_workflow
    from app.config import get_settings

    async def _test():
        settings = get_settings()
        workflow = get_v2_workflow(settings)
        resp = await copilot_auto_reconcile_stream(
            settings=settings,
            workflow=workflow,
            government_file=None,
            purchase_file=None,
            session_id="test-copilot-auto-rec",
            prompt="reconcile",
        )
        chunks = []
        async for chunk in resp.body_iterator:
            chunks.append(chunk)

        full = "".join(chunks)
        assert ": keepalive" in full
        assert "AUTO_RECONCILE_SUCCESS" in full
        assert "**Exact" in full
        assert '"action_executed": true' in full

    asyncio.run(_test())


def test_copilot_v2_domain_guardrail_refusal():
    """Verify that out-of-domain queries (cooking, sports, entertainment, general trivia) are deflected by guardrail."""
    engine = CopilotActionEngine()

    out_of_domain_queries = [
        "how to make pizza",
        "Give me a recipe for chocolate cake",
        "who won the cricket world cup?",
        "tell me a funny joke",
        "what is the weather like today?",
        "write a python script for a snake game",
        "who is the president of France?",
        "recommend a good movie on Netflix",
    ]

    for q in out_of_domain_queries:
        assert engine.is_out_of_domain(q) is True, f"Failed to detect out-of-domain query: {q}"

    # Test SSE stream deflection directly
    import asyncio

    async def _test_stream():
        chunks = []
        async for chunk in engine.stream_response(
            prompt="how to make pizza",
            session_id="test-guardrail-1",
            current_stage="results",
            stage_context={"activeStage": "results", "stageNumber": 4, "stageLabel": "Stage 4: Results"},
        ):
            chunks.append(chunk)

        full = "".join(chunks)
        tokens = "".join(
            json.loads(line[6:])["content"]
            for line in full.split("\n\n")
            if line.startswith("data: ") and json.loads(line[6:]).get("type") == "token"
        )
        assert "Domain guardrail engaged" in full
        assert "TARS Copilot" in tokens
        assert "specialized assistant for TARS GST reconciliation" in tokens
        assert "done" in full

    asyncio.run(_test_stream())


def test_copilot_v2_in_domain_acceptance():
    """Verify that legitimate GST, accounting, reconciliation, and KPMG queries are NOT blocked."""
    engine = CopilotActionEngine()

    in_domain_queries = [
        "why is GSTIN 27AAAPL1234C1ZV mismatched?",
        "what is Section 16(2)(aa) compliance?",
        "how many tolerance matches were found in Stage 4?",
        "explain near match vs exact match thresholds",
        "how do I export the reconciled ledger to Excel?",
        "what is the variance on invoice INV-2026-081?",
        "is supplier ITC eligible under Rule 36(4)?",
        "what does this screen do?",
        "show me candidate row 5 details",
    ]

    for q in in_domain_queries:
        assert engine.is_out_of_domain(q) is False, f"In-domain query incorrectly blocked: {q}"


def test_copilot_v2_greeting_handling():
    """Verify that polite greetings and status questions receive warm domain-anchored responses."""
    engine = CopilotActionEngine()

    greetings = ["hello", "hi", "hey", "good morning", "how are you?", "how are you doing", "help"]
    for g in greetings:
        assert engine.is_greeting_or_status(g) is True, f"Failed to detect greeting: {g}"

    import asyncio

    async def _test_greeting():
        chunks = []
        async for chunk in engine.stream_response(
            prompt="how are you?",
            session_id="test-greeting-1",
            current_stage="results",
            stage_context={"activeStage": "results", "stageNumber": 4, "stageLabel": "Stage 4: Results"},
        ):
            chunks.append(chunk)

        full = "".join(chunks)
        tokens = "".join(
            json.loads(line[6:])["content"]
            for line in full.split("\n\n")
            if line.startswith("data: ") and json.loads(line[6:]).get("type") == "token"
        )
        assert "TARS Copilot" in tokens
        assert "GST Reconciliation 2.0 and KPMG compliance" in tokens
        assert "done" in full

    asyncio.run(_test_greeting())


def test_copilot_v2_cross_session_transition():
    """Verify that Copilot detects when a user switches reconciliation sessions and acknowledges the transition."""
    import asyncio
    engine = CopilotActionEngine()

    history = [
        {
            "role": "user",
            "content": "What is the unresolved count?",
            "context": {
                "sessionId": "sess-alpha-12345678",
                "stageKey": "results",
                "stageLabel": "Stage 4: Results Matrix",
                "timestamp": "2026-09-12T01:00:00Z",
            },
        },
        {
            "role": "assistant",
            "content": "There are 12 unresolved records in Session Alpha.",
            "context": {
                "sessionId": "sess-alpha-12345678",
                "stageKey": "results",
                "stageLabel": "Stage 4: Results Matrix",
                "timestamp": "2026-09-12T01:00:05Z",
            },
        },
    ]

    async def _test_cross_session():
        chunks = []
        async for chunk in engine.stream_response(
            prompt="Hello, what can you do here?",
            session_id="sess-beta-87654321",
            current_stage="rules",
            stage_context={
                "sessionId": "sess-beta-87654321",
                "activeStage": "rules",
                "stageNumber": 3,
                "stageLabel": "Stage 3: Rules Engine",
            },
            history=history,
        ):
            chunks.append(chunk)

        full = "".join(chunks)
        tokens = "".join(
            json.loads(line[6:])["content"]
            for line in full.split("\n\n")
            if line.startswith("data: ") and json.loads(line[6:]).get("type") == "token"
        )
        assert "sess-alp" in tokens or "sess-alpha" in tokens
        assert "sess-bet" in tokens or "sess-beta" in tokens
        assert "Noting that your previous question pertained to Session" in tokens

    asyncio.run(_test_cross_session())


def test_copilot_v2_cross_stage_transition():
    """Verify that Copilot detects stage changes within the same session and notes the navigation."""
    import asyncio
    engine = CopilotActionEngine()

    history = [
        {
            "role": "user",
            "content": "Map vendor name to supplier legal name",
            "context": {
                "sessionId": "sess-common-9999",
                "stageKey": "mapping",
                "stageLabel": "Stage 2: Schema Mapping",
                "timestamp": "2026-09-12T01:05:00Z",
            },
        },
    ]

    async def _test_cross_stage():
        chunks = []
        async for chunk in engine.stream_response(
            prompt="what is this screen?",
            session_id="sess-common-9999",
            current_stage="rules",
            stage_context={
                "sessionId": "sess-common-9999",
                "activeStage": "rules",
                "stageNumber": 3,
                "stageLabel": "Stage 3: Rules Engine",
            },
            history=history,
        ):
            chunks.append(chunk)

        full = "".join(chunks)
        tokens = "".join(
            json.loads(line[6:])["content"]
            for line in full.split("\n\n")
            if line.startswith("data: ") and json.loads(line[6:]).get("type") == "token"
        )
        assert "Noting your transition from Stage 2: Schema Mapping to Stage 3: Rules Engine" in tokens

    asyncio.run(_test_cross_stage())
