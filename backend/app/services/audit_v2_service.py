from __future__ import annotations

import datetime
import json
import logging
from pathlib import Path
from typing import Any
from uuid import uuid4

try:
    import orjson
    _HAS_ORJSON = True
except ImportError:
    orjson = None  # type: ignore
    _HAS_ORJSON = False

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parents[3]
AUDIT_V2_DIR = PROJECT_ROOT / "data" / "audit_v2"
SESSIONS_FILE = AUDIT_V2_DIR / "sessions_v2.json"
RUNS_FILE = AUDIT_V2_DIR / "runs_v2.json"
STEPS_FILE = AUDIT_V2_DIR / "steps_v2.json"


class V2LogEntry(BaseModel):
    timestamp_ms: float
    level: str = "INFO"  # TRACE, DEBUG, INFO, WARN, ERROR
    message: str
    data: dict[str, Any] | None = None


class V2StepErrorDetail(BaseModel):
    error_code: str
    severity: str = "ERROR"  # CRITICAL, ERROR, WARNING, INFO
    message: str
    offending_entities: list[str] = Field(default_factory=list)
    stack_trace: str | None = None
    root_cause_category: str = "BUSINESS_RULE"  # SYNTAX, TYPE_MISMATCH, BUSINESS_RULE, LLM_TIMEOUT, FILE_CORRUPTION
    suggested_remediation: str
    remediation_action: dict[str, Any] | None = None


class V2AuditStep(BaseModel):
    step_id: str
    run_id: str
    session_id: str
    stage_key: str  # setup, mapping, rules, results, near-matches, exceptions, export
    step_order: int
    name: str
    description: str
    component: str
    actor: str = "SYSTEM"  # SYSTEM, AI_AGENT, USER
    status: str = "COMPLETED"  # RUNNING, COMPLETED, FAILED, SKIPPED
    duration_ms: float = 0.0
    started_at: str
    completed_at: str | None = None
    input_summary: dict[str, Any] = Field(default_factory=dict)
    output_summary: dict[str, Any] = Field(default_factory=dict)
    logs: list[V2LogEntry] = Field(default_factory=list)
    error_capture: V2StepErrorDetail | None = None


class V2RunRecord(BaseModel):
    run_id: str
    session_id: str
    session_title: str
    run_type: str = "FAST_INGESTION"  # FULL_PIPELINE, FAST_INGESTION, RULE_SIMULATION, NEAR_MATCH_EVAL, MANUAL_RETRY
    status: str = "COMPLETED"  # QUEUED, RUNNING, COMPLETED, COMPLETED_WITH_WARNINGS, FAILED, ABORTED
    started_at: str
    completed_at: str | None = None
    duration_ms: float = 0.0
    triggered_by: str = "USER: manual"
    stages_executed: list[str] = Field(default_factory=list)
    current_stage: str = "setup"
    kpi_snapshot: dict[str, Any] = Field(default_factory=dict)
    steps: list[V2AuditStep] = Field(default_factory=list)
    error_count: int = 0
    warning_count: int = 0
    error_summary: str | None = None


class V2SessionRecord(BaseModel):
    id: str
    title: str = "GST Reconciliation 2.0"
    status: str = "setup"
    current_stage: str = "setup"
    created_at: str
    updated_at: str
    gstr_filename: str | None = None
    pr_filename: str | None = None
    gstr_path: str | None = None
    pr_path: str | None = None
    correlation: dict[str, Any] | None = None
    selected_rule_ids: list[str] = Field(default_factory=list)
    rule_execution_order: list[str] = Field(default_factory=list)
    waterfall_passes: list[dict[str, Any]] = Field(default_factory=list)
    rules_v2: list[dict[str, Any]] = Field(default_factory=list)
    runs: list[str] = Field(default_factory=list)


class AuditV2Service:
    def __init__(self) -> None:
        AUDIT_V2_DIR.mkdir(parents=True, exist_ok=True)
        self._ensure_seed_data()

    def _read_json(self, path: Path) -> dict[str, Any]:
        if not path.exists():
            return {}
        try:
            if _HAS_ORJSON:
                with open(path, "rb") as f:
                    return orjson.loads(f.read())
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as exc:
            logger.warning(f"Error reading JSON from {path}: {exc}")
            return {}

    def _write_json(self, path: Path, data: dict[str, Any]) -> None:
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            if _HAS_ORJSON:
                raw_bytes = orjson.dumps(data, default=str, option=orjson.OPT_INDENT_2)
                with open(path, "wb") as f:
                    f.write(raw_bytes)
            else:
                with open(path, "w", encoding="utf-8") as f:
                    json.dump(data, f, indent=2, default=str)
        except Exception as exc:
            logger.error(f"Failed to write JSON to {path}: {exc}")

    # =========================================================================
    # SESSIONS
    # =========================================================================
    def get_session(self, session_id: str) -> dict[str, Any] | None:
        sessions = self._read_json(SESSIONS_FILE)
        return sessions.get(session_id)

    def save_session(self, session_dict: dict[str, Any]) -> dict[str, Any]:
        sessions = self._read_json(SESSIONS_FILE)
        session_id = session_dict["id"]
        now = datetime.datetime.now(datetime.timezone.utc).isoformat()
        if session_id not in sessions:
            session_dict.setdefault("created_at", now)
        session_dict["updated_at"] = now
        sessions[session_id] = session_dict
        self._write_json(SESSIONS_FILE, sessions)
        return session_dict

    def list_sessions(self) -> list[dict[str, Any]]:
        sessions = self._read_json(SESSIONS_FILE)
        return sorted(sessions.values(), key=lambda s: s.get("updated_at", ""), reverse=True)

    # =========================================================================
    # RUNS
    # =========================================================================
    def record_run(self, run: V2RunRecord) -> V2RunRecord:
        runs = self._read_json(RUNS_FILE)
        runs[run.run_id] = run.model_dump()
        self._write_json(RUNS_FILE, runs)

        # Update session runs array
        sess = self.get_session(run.session_id)
        if sess:
            if "runs" not in sess:
                sess["runs"] = []
            if run.run_id not in sess["runs"]:
                sess["runs"].append(run.run_id)
            sess["current_stage"] = run.current_stage
            self.save_session(sess)
        return run

    def get_run(self, run_id: str) -> dict[str, Any] | None:
        runs = self._read_json(RUNS_FILE)
        return runs.get(run_id)

    def list_runs(self) -> list[dict[str, Any]]:
        runs = self._read_json(RUNS_FILE)
        return sorted(runs.values(), key=lambda r: r.get("started_at", ""), reverse=True)

    def get_audit_stats(self) -> dict[str, Any]:
        runs = self.list_runs()
        sessions = self.list_sessions()
        total_runs = len(runs)
        completed_runs = [r for r in runs if r.get("status") in ("COMPLETED", "COMPLETED_WITH_WARNINGS")]
        failed_runs = [r for r in runs if r.get("status") == "FAILED"]
        success_rate = round((len(completed_runs) / max(total_runs, 1)) * 100, 1)

        durations = [r.get("duration_ms", 0) for r in completed_runs if r.get("duration_ms", 0) > 0]
        avg_duration_ms = round(sum(durations) / max(len(durations), 1), 0) if durations else 165.0

        all_steps = []
        for r in runs:
            all_steps.extend(r.get("steps", []))

        total_steps = len(all_steps)
        errors_captured = sum(r.get("error_count", 0) for r in runs)

        return {
            "total_runs": total_runs,
            "total_sessions": len(sessions),
            "success_rate": success_rate,
            "failed_runs": len(failed_runs),
            "avg_duration_ms": avg_duration_ms,
            "total_steps": total_steps,
            "errors_captured": errors_captured,
            "reconciled_volume_cr": 14.85,
        }

    # =========================================================================
    # SEED DATA (Historical Runs & Demos for Rich Initial State)
    # =========================================================================
    def _ensure_seed_data(self) -> None:
        sessions = self._read_json(SESSIONS_FILE)
        runs = self._read_json(RUNS_FILE)
        now_dt = datetime.datetime.now(datetime.timezone.utc)

        # If demo session not present, seed it
        if "demo-v2-session" not in sessions:
            demo_session = {
                "id": "demo-v2-session",
                "title": "August 2026 Statutory Reconciliation (POC Master)",
                "status": "rules",
                "current_stage": "rules",
                "created_at": (now_dt - datetime.timedelta(hours=2)).isoformat(),
                "updated_at": now_dt.isoformat(),
                "gstr_filename": "POC_Government_GST_Aug2026.xlsx",
                "pr_filename": "POC_Purchase_Register_Aug2026.xlsx",
                "gstr_path": str(PROJECT_ROOT / "sample_data" / "POC_Government_GST_Aug2026.xlsx"),
                "pr_path": str(PROJECT_ROOT / "sample_data" / "POC_Purchase_Register_Aug2026.xlsx"),
                "selected_rule_ids": ["R-INV-EXACT", "R-DATE-PROX-3D", "R-TAX-TOLERANCE-10INR"],
                "rule_execution_order": ["R-INV-EXACT", "R-DATE-PROX-3D", "R-TAX-TOLERANCE-10INR"],
                "runs": ["RUN-20260910-001", "RUN-20260910-002", "RUN-20260910-003"],
            }
            sessions["demo-v2-session"] = demo_session
            self._write_json(SESSIONS_FILE, sessions)

        # Seed realistic historical runs if empty
        if not runs:
            # RUN 1: Fast Ingestion & Dual Coupling
            run1_start = (now_dt - datetime.timedelta(hours=2)).isoformat()
            run1_end = (now_dt - datetime.timedelta(hours=2) + datetime.timedelta(seconds=5)).isoformat()
            run1 = V2RunRecord(
                run_id="RUN-20260910-001",
                session_id="demo-v2-session",
                session_title="August 2026 Statutory Reconciliation (POC Master)",
                run_type="FAST_INGESTION",
                status="COMPLETED",
                started_at=run1_start,
                completed_at=run1_end,
                duration_ms=5240,
                triggered_by="USER: auto-drag-and-drop",
                stages_executed=["setup", "mapping"],
                current_stage="mapping",
                kpi_snapshot={
                    "gstr_rows": 10000,
                    "pr_rows": 10500,
                    "correlated_columns": 18,
                    "confidence_score": 0.985,
                },
                steps=[
                    V2AuditStep(
                        step_id="STEP-001-FAST-HEADER-PROBE",
                        run_id="RUN-20260910-001",
                        session_id="demo-v2-session",
                        stage_key="setup",
                        step_order=1,
                        name="Fast Header & Stream Ingestion",
                        description="Stream-probed 'POC_Government_GST_Aug2026.xlsx' (10,000 rows) and 'POC_Purchase_Register_Aug2026.xlsx' (10,500 rows) into in-memory chunks.",
                        component="FastExcelParser",
                        actor="SYSTEM",
                        status="COMPLETED",
                        duration_ms=165,
                        started_at=run1_start,
                        completed_at=run1_start,
                        input_summary={"files": ["POC_Government_GST_Aug2026.xlsx", "POC_Purchase_Register_Aug2026.xlsx"]},
                        output_summary={"gstr_columns": 24, "pr_columns": 28, "sample_rows_probed": 50},
                        logs=[
                            V2LogEntry(timestamp_ms=12, level="INFO", message="Opened binary XLSX stream without full DOM overhead."),
                            V2LogEntry(timestamp_ms=98, level="INFO", message="Detected header offsets at row index 0 with 100% column name resolution."),
                            V2LogEntry(timestamp_ms=165, level="INFO", message="Fast file probe complete: GSTR (10,000 rows), PR (10,500 rows)."),
                        ],
                    ),
                    V2AuditStep(
                        step_id="STEP-002-DETERMINISTIC-RULES",
                        run_id="RUN-20260910-001",
                        session_id="demo-v2-session",
                        stage_key="mapping",
                        step_order=2,
                        name="Deterministic Statutory Field Resolution",
                        description="Direct algorithmic matching on GSTIN, Invoice Number, Taxable Value, and IGST/CGST/SGST.",
                        component="DirectSchemaCorrelator",
                        actor="SYSTEM",
                        status="COMPLETED",
                        duration_ms=290,
                        started_at=run1_start,
                        completed_at=run1_start,
                        input_summary={"candidate_fields": 24},
                        output_summary={"exact_canonical_correlations": 14, "confidence": 1.0},
                        logs=[
                            V2LogEntry(timestamp_ms=190, level="INFO", message="Resolved 'Supplier GSTIN' <-> 'GSTIN_UIN' with 1.0 confidence."),
                            V2LogEntry(timestamp_ms=230, level="INFO", message="Resolved 'Invoice Number' <-> 'Doc_No' with 1.0 confidence."),
                            V2LogEntry(timestamp_ms=290, level="INFO", message="Statutory core fields established under strict deterministic pass."),
                        ],
                    ),
                    V2AuditStep(
                        step_id="STEP-003-SEMANTIC-ERP-MATCHING",
                        run_id="RUN-20260910-001",
                        session_id="demo-v2-session",
                        stage_key="mapping",
                        step_order=3,
                        name="Multi-Agent Semantic Coupling",
                        description="Resolved custom ERP abbreviations (e.g. 'TX_VAL', 'CESS_AMT', 'BILL_DT') using domain embedding vectors.",
                        component="SchemaMappingV2Workflow",
                        actor="AI_AGENT: gpt-5.4-mini",
                        status="COMPLETED",
                        duration_ms=4785,
                        started_at=run1_start,
                        completed_at=run1_end,
                        input_summary={"unresolved_columns": 4},
                        output_summary={"semantic_correlations": 4, "overall_coupling_percentage": 100.0},
                        logs=[
                            V2LogEntry(timestamp_ms=410, level="DEBUG", message="Querying domain synonym ontology for 'TX_VAL' -> 'Taxable Value'."),
                            V2LogEntry(timestamp_ms=2100, level="INFO", message="High-confidence semantic alignment validated for 'BILL_DT' -> 'Invoice Date' (97.4%)."),
                            V2LogEntry(timestamp_ms=5240, level="INFO", message="Dual ingestion & schema coupling completed in 5,240ms."),
                        ],
                    ),
                ],
                error_count=0,
                warning_count=0,
            )
            runs[run1.run_id] = run1.model_dump()

            # RUN 2: Waterfall Rule Simulation with Bottleneck Warning
            run2_start = (now_dt - datetime.timedelta(minutes=45)).isoformat()
            run2_end = (now_dt - datetime.timedelta(minutes=45) + datetime.timedelta(seconds=3)).isoformat()
            run2 = V2RunRecord(
                run_id="RUN-20260910-002",
                session_id="demo-v2-session",
                session_title="August 2026 Statutory Reconciliation (POC Master)",
                run_type="RULE_SIMULATION",
                status="COMPLETED_WITH_WARNINGS",
                started_at=run2_start,
                completed_at=run2_end,
                duration_ms=2840,
                triggered_by="USER: simulate-rules-button",
                stages_executed=["rules"],
                current_stage="rules",
                kpi_snapshot={
                    "total_matched": 6919,
                    "match_rate_pct": 69.19,
                    "unmatched_gstr": 3081,
                    "unmatched_pr": 3581,
                },
                steps=[
                    V2AuditStep(
                        step_id="STEP-004-TIER1-IDENTITY",
                        run_id="RUN-20260910-002",
                        session_id="demo-v2-session",
                        stage_key="rules",
                        step_order=1,
                        name="Tier 1: Strict Identity Pass",
                        description="Executed exact match on normalized GSTIN, Invoice Number, and exact financial values.",
                        component="WaterfallMatchingEngine",
                        actor="SYSTEM",
                        status="COMPLETED",
                        duration_ms=640,
                        started_at=run2_start,
                        completed_at=run2_start,
                        input_summary={"total_records": 10000},
                        output_summary={"matched": 5200, "yield_percentage": 52.0},
                        logs=[
                            V2LogEntry(timestamp_ms=40, level="INFO", message="Building composite hash index on (GSTIN + Doc_No)."),
                            V2LogEntry(timestamp_ms=640, level="INFO", message="Strict identity matches locked: 5,200 records."),
                        ],
                    ),
                    V2AuditStep(
                        step_id="STEP-005-TIER2-NORMALIZATION",
                        run_id="RUN-20260910-002",
                        session_id="demo-v2-session",
                        stage_key="rules",
                        step_order=2,
                        name="Tier 2: Progressive Normalization Pass",
                        description="Applied whitespace trimming, special character stripping, and prefix strip on invoice keys.",
                        component="WaterfallMatchingEngine",
                        actor="SYSTEM",
                        status="COMPLETED",
                        duration_ms=890,
                        started_at=run2_start,
                        completed_at=run2_start,
                        input_summary={"remaining_records": 4800},
                        output_summary={"matched": 1000, "cumulative_matched": 6200},
                        logs=[
                            V2LogEntry(timestamp_ms=710, level="INFO", message="Stripped prefix 'INV/' and leading zeros from vendor invoice keys."),
                            V2LogEntry(timestamp_ms=890, level="INFO", message="Recovered 1,000 matches via normalization rules."),
                        ],
                    ),
                    V2AuditStep(
                        step_id="STEP-006-TIER3-TOLERANCE",
                        run_id="RUN-20260910-002",
                        session_id="demo-v2-session",
                        stage_key="rules",
                        step_order=3,
                        name="Tier 3: Commercial Tolerance Window",
                        description="Evaluated date displacement (+/- 3 days) and INR +/- 10 rounding variance.",
                        component="WaterfallMatchingEngine",
                        actor="SYSTEM",
                        status="COMPLETED",
                        duration_ms=1310,
                        started_at=run2_start,
                        completed_at=run2_end,
                        input_summary={"remaining_records": 3800},
                        output_summary={"matched": 719, "cumulative_matched": 6919},
                        logs=[
                            V2LogEntry(timestamp_ms=950, level="WARN", message="Notice: 382 records flagged with invoice date difference > 7 days."),
                            V2LogEntry(timestamp_ms=1310, level="INFO", message="Tolerance pass matched 719 records within configured policy window."),
                        ],
                        error_capture=V2StepErrorDetail(
                            error_code="DATE_TOLERANCE_BOTTLENECK",
                            severity="WARNING",
                            message="382 vendor invoices have date discrepancies between 4 and 14 days, exceeding current 3-day window.",
                            offending_entities=["rule: R-DATE-PROX-3D", "column: Invoice Date"],
                            root_cause_category="BUSINESS_RULE",
                            suggested_remediation="Consider expanding Date Tolerance rule from 3 days to 7 days to absorb weekend/month-end processing lag.",
                            remediation_action={
                                "action_type": "EXPAND_RULE_TOLERANCE",
                                "rule_id": "R-DATE-PROX-3D",
                                "new_value": 7,
                            },
                        ),
                    ),
                ],
                error_count=0,
                warning_count=1,
                error_summary="1 Warning: Date tolerance window bottleneck (382 candidate invoices near-boundary).",
            )
            runs[run2.run_id] = run2.model_dump()

            # RUN 3: Simulated Exception in Ingestion (Historical Failure Capture Example)
            run3_start = (now_dt - datetime.timedelta(days=1, hours=3)).isoformat()
            run3_end = (now_dt - datetime.timedelta(days=1, hours=3) + datetime.timedelta(seconds=1)).isoformat()
            run3 = V2RunRecord(
                run_id="RUN-20260909-094",
                session_id="legacy-client-run-aug26",
                session_title="July 2026 Ledger Re-Audit — Fast Corp",
                run_type="FAST_INGESTION",
                status="FAILED",
                started_at=run3_start,
                completed_at=run3_end,
                duration_ms=1150,
                triggered_by="SYSTEM: scheduled_batch_worker",
                stages_executed=["setup"],
                current_stage="setup",
                kpi_snapshot={"gstr_rows": 0, "pr_rows": 0},
                steps=[
                    V2AuditStep(
                        step_id="STEP-001-CORRUPT-HEADER",
                        run_id="RUN-20260909-094",
                        session_id="legacy-client-run-aug26",
                        stage_key="setup",
                        step_order=1,
                        name="Dual Ingestion & Parsing",
                        description="Reading vendor purchase register workbook with non-standard encrypted sheets.",
                        component="FastExcelParser",
                        actor="SYSTEM",
                        status="FAILED",
                        duration_ms=1150,
                        started_at=run3_start,
                        completed_at=run3_end,
                        input_summary={"file": "PR_JULY2026_ENCRYPTED.xlsx"},
                        output_summary={"parsed_rows": 0},
                        logs=[
                            V2LogEntry(timestamp_ms=15, level="INFO", message="Initiating streaming unpack of workbook."),
                            V2LogEntry(timestamp_ms=1140, level="ERROR", message="Workbook is password-protected or contains DRM sheet security (ErrorCode: XLS_PASSWORD_REQUIRED)."),
                        ],
                        error_capture=V2StepErrorDetail(
                            error_code="XLS_PROTECTED_WORKBOOK",
                            severity="CRITICAL",
                            message="Failed to parse sheet: Workbook 'PR_JULY2026_ENCRYPTED.xlsx' requires an enterprise decryption token or export unprotection.",
                            offending_entities=["file: PR_JULY2026_ENCRYPTED.xlsx"],
                            stack_trace="Traceback (most recent call last):\n  File 'excel_parser.py', line 104, in open_workbook\n    raise ExcelSecurityError('Password protection detected')\nExcelSecurityError: Password protection detected",
                            root_cause_category="FILE_CORRUPTION",
                            suggested_remediation="Provide unprotected XLSX or supply vendor sheet password in Client Profile configuration.",
                            remediation_action={"action_type": "REQUEST_UNPROTECTED_FILE"},
                        ),
                    )
                ],
                error_count=1,
                warning_count=0,
                error_summary="Critical Parsing Error: Workbook password protection prevented stream ingestion.",
            )
            runs[run3.run_id] = run3.model_dump()

            self._write_json(RUNS_FILE, runs)


# Global singleton instance
audit_v2_service = AuditV2Service()
