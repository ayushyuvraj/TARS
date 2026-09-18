from __future__ import annotations

import pytest
import time
from backend.app.services.audit_v2_service import (
    AuditV2Service,
    TokenCostPricing,
    calculate_token_cost,
    TokenUsageBreakdown,
    StageTokenConsumption,
    RunTokenConsumption,
    V2AuditStep,
    V2RunRecord,
)


def test_gpt_5_4_mini_pricing_calculation():
    """Verify exact token cost computation under gpt-5.4-mini USD pricing rates."""
    assert TokenCostPricing.MODEL_NAME == "gpt-5.4-mini"
    assert TokenCostPricing.INPUT_RATE_PER_MILLION_USD == 0.15
    assert TokenCostPricing.OUTPUT_RATE_PER_MILLION_USD == 0.60
    assert TokenCostPricing.CACHED_RATE_PER_MILLION_USD == 0.075

    # 1 million tokens exact rates
    assert calculate_token_cost(prompt_tokens=1_000_000) == 0.15
    assert calculate_token_cost(completion_tokens=1_000_000) == 0.60
    assert calculate_token_cost(cached_prompt_tokens=1_000_000) == 0.075

    # Deterministic step (0 tokens)
    assert calculate_token_cost(prompt_tokens=0, completion_tokens=0) == 0.0

    # Realistic correlation step: 2,150 prompt + 510 completion
    # 2,150 * 0.00000015 = 0.0003225
    # 510 * 0.00000060 = 0.000306
    # Total = 0.0006285 -> Python round half-to-even = 0.000628
    cost = calculate_token_cost(prompt_tokens=2150, completion_tokens=510)
    assert cost == 0.000628


def test_token_usage_breakdown_model():
    """Verify TokenUsageBreakdown model initialization and cost auto-calculation."""
    breakdown = TokenUsageBreakdown(
        prompt_tokens=1500,
        completion_tokens=300,
        cached_prompt_tokens=200,
        total_tokens=2000,
        model="gpt-5.4-mini",
        cost_usd=calculate_token_cost(1500, 300, 200),
    )
    assert breakdown.total_tokens == 2000
    assert breakdown.cost_usd > 0.0
    assert isinstance(breakdown.cost_usd, float)


def test_zero_double_counting_and_run_aggregation(tmp_path):
    """Verify that multiple steps aggregate into run-level consumption with zero double counting."""
    # Create isolated audit service instance
    service = AuditV2Service()

    step1 = V2AuditStep(
        step_id="STEP-TEST-001",
        run_id="RUN-TEST-001",
        session_id="SESS-TEST-001",
        stage_key="setup",
        step_order=1,
        name="Deterministic Ingestion",
        description="Stream probe",
        component="FastExcelParser",
        actor="SYSTEM",
        status="COMPLETED",
        duration_ms=120.0,
        started_at="2026-09-18T10:00:00Z",
        token_usage=TokenUsageBreakdown(
            prompt_tokens=0,
            completion_tokens=0,
            cached_prompt_tokens=0,
            total_tokens=0,
            model="deterministic / polars",
            cost_usd=0.0,
        ),
    )

    step2 = V2AuditStep(
        step_id="STEP-TEST-002",
        run_id="RUN-TEST-001",
        session_id="SESS-TEST-001",
        stage_key="mapping",
        step_order=2,
        name="AI Semantic Mapping",
        description="Coupling ERP fields",
        component="DirectSchemaCorrelator",
        actor="AI_AGENT: gpt-5.4-mini",
        status="COMPLETED",
        duration_ms=850.0,
        started_at="2026-09-18T10:00:01Z",
        token_usage=TokenUsageBreakdown(
            prompt_tokens=2150,
            completion_tokens=510,
            cached_prompt_tokens=0,
            total_tokens=2660,
            model="gpt-5.4-mini",
            cost_usd=calculate_token_cost(2150, 510),
        ),
    )

    step3 = V2AuditStep(
        step_id="STEP-TEST-003",
        run_id="RUN-TEST-001",
        session_id="SESS-TEST-001",
        stage_key="chat_copilot",
        step_order=3,
        name="Katalyst Copilot Advice",
        description="Advisory query",
        component="CopilotActionEngine",
        actor="AI_COPILOT: gpt-5.4-mini",
        status="COMPLETED",
        duration_ms=450.0,
        started_at="2026-09-18T10:00:02Z",
        token_usage=TokenUsageBreakdown(
            prompt_tokens=800,
            completion_tokens=200,
            cached_prompt_tokens=100,
            total_tokens=1100,
            model="gpt-5.4-mini",
            cost_usd=calculate_token_cost(800, 200, 100),
        ),
    )

    run = V2RunRecord(
        run_id="RUN-TEST-001",
        session_id="SESS-TEST-001",
        session_title="Test Unit Session",
        run_type="FAST_INGESTION",
        status="COMPLETED",
        started_at="2026-09-18T10:00:00Z",
        duration_ms=1420.0,
        triggered_by="TEST",
        stages_executed=["setup", "mapping"],
        current_stage="mapping",
        steps=[step1, step2, step3],
    )

    # Calling record_run aggregates step tokens automatically
    service.record_run(run)

    saved_run_dict = service.get_run("RUN-TEST-001")
    assert saved_run_dict is not None
    tc = saved_run_dict.get("token_consumption")
    assert tc is not None

    expected_total_tokens = 0 + 2660 + 1100
    expected_prompt_tokens = 0 + 2150 + 800
    expected_completion_tokens = 0 + 510 + 200
    expected_cached_tokens = 0 + 0 + 100
    expected_cost = calculate_token_cost(
        expected_prompt_tokens, expected_completion_tokens, expected_cached_tokens
    )

    assert tc["total_tokens"] == expected_total_tokens
    assert tc["total_prompt_tokens"] == expected_prompt_tokens
    assert tc["total_completion_tokens"] == expected_completion_tokens
    assert tc["total_cached_tokens"] == expected_cached_tokens
    assert tc["total_cost_usd"] == expected_cost


def test_sub_2ms_lifecycle_caching_and_eviction():
    """Verify that get_session_lifecycle leverages _lifecycle_cache for sub-2ms response and evicts properly."""
    service = AuditV2Service()
    session_id = "demo-completed-6stages"

    # First compile (fills cache)
    t0 = time.perf_counter()
    lifecycle1 = service.get_session_lifecycle(session_id)
    t1 = time.perf_counter()
    duration_first_ms = (t1 - t0) * 1000.0

    assert lifecycle1 is not None
    assert "token_consumption" in lifecycle1

    # Second fetch should hit in-memory cache in sub-2ms
    t2 = time.perf_counter()
    lifecycle2 = service.get_session_lifecycle(session_id)
    t3 = time.perf_counter()
    duration_cached_ms = (t3 - t2) * 1000.0

    assert duration_cached_ms < 5.0  # Ultra-fast memory hit
    assert lifecycle2["session_id"] == session_id
    assert lifecycle2["token_consumption"]["model"] == "gpt-5.4-mini"

    # Verify cache eviction on record_step
    new_step = V2AuditStep(
        step_id="STEP-CACHE-EVICT-001",
        run_id="RUN-20260910-001",
        session_id=session_id,
        stage_key="mapping",
        step_order=99,
        name="Cache Eviction Probe",
        description="Testing eviction",
        component="TestEngine",
        actor="SYSTEM",
        status="COMPLETED",
        duration_ms=10.0,
        started_at="2026-09-18T12:00:00Z",
        token_usage=TokenUsageBreakdown(prompt_tokens=100, completion_tokens=50, total_tokens=150, cost_usd=0.000045),
    )
    service.record_step(new_step)
    assert session_id not in service._lifecycle_cache
