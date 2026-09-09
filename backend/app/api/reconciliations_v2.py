from __future__ import annotations

import logging
from pathlib import Path
from typing import Annotated, Any
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel, Field

import pandas as pd
from app.config import Settings, get_settings
from app.domain.models import DatasetRole
from app.providers.base import LLMProvider
from app.providers.factory import create_llm_provider
from app.services.direct_schema_correlator import (
    AgentThought,
    DirectColumnCorrelation,
    DirectCorrelationResult,
)
from app.services.matching_engine_v2 import (
    MatchingPass,
    Rule2Item,
    SimulationResult,
    SimulationResultV2,
    WaterfallMatchingEngine,
    build_default_rules_wiki_v2,
    build_default_waterfall,
    compile_rule_from_nl,
)
from app.workflows.schema_mapping_v2 import SchemaMappingV2Workflow

logger = logging.getLogger(__name__)

router_v2 = APIRouter(prefix="/reconciliations-v2", tags=["reconciliations-v2"])

# In-memory session registry for V2 (isolated from V1)
_V2_SESSIONS: dict[str, dict[str, Any]] = {}
_V2_WORKFLOW: SchemaMappingV2Workflow | None = None


def get_v2_workflow(settings: Annotated[Settings, Depends(get_settings)]) -> SchemaMappingV2Workflow:
    global _V2_WORKFLOW
    if _V2_WORKFLOW is None:
        llm: LLMProvider | None = None
        try:
            llm = create_llm_provider(settings)
        except Exception as exc:
            logger.warning(f"V2 Workflow LLM provider initialization skipped: {exc}")
        _V2_WORKFLOW = SchemaMappingV2Workflow(
            database_path=settings.database_path,
            llm_provider=llm,
            model_name=settings.effective_openai_model,
        )
    return _V2_WORKFLOW


class ReconciliationV2Session(BaseModel):
    id: str
    status: str
    created_at: str
    gstr_filename: str | None = None
    pr_filename: str | None = None
    correlation: DirectCorrelationResult | None = None
    selected_rule_ids: list[str] = Field(default_factory=list)
    rule_execution_order: list[str] = Field(default_factory=list)
    waterfall_passes: list[MatchingPass] = Field(default_factory=list)
    rules_v2: list[Rule2Item] = Field(default_factory=list)


class UserMappingUpdateRequest(BaseModel):
    correlations: list[DirectColumnCorrelation]


class UserRulesUpdateRequest(BaseModel):
    selected_rule_ids: list[str]
    rule_execution_order: list[str] = Field(default_factory=list)


class SimulateWaterfallRequest(BaseModel):
    passes: list[MatchingPass]


class ConfirmWaterfallRequest(BaseModel):
    passes: list[MatchingPass]


class SimulateRules2Request(BaseModel):
    rules: list[Rule2Item]


class ConfirmRules2Request(BaseModel):
    rules: list[Rule2Item]


class CompileAiRuleRequest(BaseModel):
    prompt: str
    available_columns: list[str] = Field(default_factory=list)


@router_v2.post("", response_model=ReconciliationV2Session, status_code=status.HTTP_201_CREATED)
def create_v2_session() -> ReconciliationV2Session:
    import datetime

    session_id = str(uuid4())
    session_data = {
        "id": session_id,
        "status": "setup",
        "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "gstr_filename": None,
        "pr_filename": None,
        "gstr_path": None,
        "pr_path": None,
        "correlation": None,
    }
    _V2_SESSIONS[session_id] = session_data
    return ReconciliationV2Session(
        id=session_id,
        status="setup",
        created_at=session_data["created_at"],
    )


PROJECT_ROOT = Path(__file__).resolve().parents[3]
SAMPLE_GOV = PROJECT_ROOT / "sample_data" / "POC_Government_GST_Aug2026.xlsx"
SAMPLE_PR = PROJECT_ROOT / "sample_data" / "POC_Purchase_Register_Aug2026.xlsx"
SAMPLE_223_GOV = PROJECT_ROOT / "sample_data" / "TARS_Government_GSTR2B_223cols_1k_rows.xlsx"
SAMPLE_223_PR = PROJECT_ROOT / "sample_data" / "TARS_Purchase_Register_223cols_1500_rows.xlsx"


def _load_df_safely(path: Path) -> pd.DataFrame:
    try:
        if path.suffix.lower() == ".csv":
            return pd.read_csv(path)
        df = pd.read_excel(path)
        unnamed = [c for c in df.columns if str(c).startswith("Unnamed")]
        if len(unnamed) > len(df.columns) / 2:
            df_h1 = pd.read_excel(path, header=1)
            unnamed_h1 = [c for c in df_h1.columns if str(c).startswith("Unnamed")]
            if len(unnamed_h1) < len(unnamed):
                return df_h1
        return df
    except Exception as exc:
        logger.warning(f"Failed to load DataFrame from {path}: {exc}")
        return pd.DataFrame()


def _ensure_session(session_id: str) -> dict[str, Any]:
    if session_id not in _V2_SESSIONS:
        import datetime
        default_gov = str(SAMPLE_223_GOV) if SAMPLE_223_GOV.exists() else str(SAMPLE_GOV)
        default_pr = str(SAMPLE_223_PR) if SAMPLE_223_PR.exists() else str(SAMPLE_PR)
        gov_name = SAMPLE_223_GOV.name if SAMPLE_223_GOV.exists() else "POC_Government_GST_Aug2026.xlsx"
        pr_name = SAMPLE_223_PR.name if SAMPLE_223_PR.exists() else "POC_Purchase_Register_Aug2026.xlsx"

        _V2_SESSIONS[session_id] = {
            "id": session_id,
            "status": "setup",
            "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "selected_rule_ids": [],
            "rule_execution_order": [],
            "waterfall_passes": [],
            "rules_v2": build_default_rules_wiki_v2(),
            "gstr_filename": gov_name,
            "pr_filename": pr_name,
            "gstr_path": default_gov,
            "pr_path": default_pr,
        }
    return _V2_SESSIONS[session_id]


@router_v2.get("/{session_id}", response_model=ReconciliationV2Session)
def get_v2_session(session_id: str) -> ReconciliationV2Session:
    data = _ensure_session(session_id)
    return ReconciliationV2Session(
        id=data["id"],
        status=data["status"],
        created_at=data["created_at"],
        gstr_filename=data.get("gstr_filename"),
        pr_filename=data.get("pr_filename"),
        correlation=data.get("correlation"),
        selected_rule_ids=data.get("selected_rule_ids", []),
        rule_execution_order=data.get("rule_execution_order", []),
        waterfall_passes=data.get("waterfall_passes", []),
        rules_v2=data.get("rules_v2") or build_default_rules_wiki_v2(),
    )


@router_v2.post("/{session_id}/fast-upload-and-correlate", response_model=DirectCorrelationResult)
async def fast_upload_and_correlate(
    session_id: str,
    government_file: Annotated[UploadFile, File(...)],
    purchase_file: Annotated[UploadFile, File(...)],
    settings: Annotated[Settings, Depends(get_settings)],
    workflow: Annotated[SchemaMappingV2Workflow, Depends(get_v2_workflow)],
) -> DirectCorrelationResult:
    session = _ensure_session(session_id)

    upload_dir = settings.upload_dir / "v2" / session_id
    upload_dir.mkdir(parents=True, exist_ok=True)

    gov_ext = Path(government_file.filename or "gstr.xlsx").suffix or ".xlsx"
    pr_ext = Path(purchase_file.filename or "pr.xlsx").suffix or ".xlsx"

    gov_path = upload_dir / f"government_{uuid4().hex[:6]}{gov_ext}"
    pr_path = upload_dir / f"purchase_{uuid4().hex[:6]}{pr_ext}"

    # Stream save files
    try:
        with gov_path.open("wb") as target:
            while chunk := await government_file.read(1024 * 1024):
                target.write(chunk)
        with pr_path.open("wb") as target:
            while chunk := await purchase_file.read(1024 * 1024):
                target.write(chunk)
    finally:
        await government_file.close()
        await purchase_file.close()

    try:
        import asyncio
        correlation = await asyncio.to_thread(workflow.run_initial_correlation, session_id, gov_path, pr_path)
        session["gstr_filename"] = government_file.filename
        session["pr_filename"] = purchase_file.filename
        session["gstr_path"] = str(gov_path)
        session["pr_path"] = str(pr_path)
        session["correlation"] = correlation
        session["status"] = "mapped"
        return correlation
    except Exception as exc:
        logger.error(f"Reconciliation 2.0 correlation error: {exc}", exc_info=True)
        raise HTTPException(status_code=422, detail=f"Schema correlation failed: {exc}") from exc


@router_v2.post("/{session_id}/mapping/confirm", response_model=ReconciliationV2Session)
def confirm_v2_mapping(
    session_id: str,
    update_req: UserMappingUpdateRequest,
) -> ReconciliationV2Session:
    session = _ensure_session(session_id)
    if session.get("correlation"):
        session["correlation"].correlations = update_req.correlations
    session["status"] = "mapping_confirmed"
    return ReconciliationV2Session(
        id=session["id"],
        status=session["status"],
        created_at=session["created_at"],
        gstr_filename=session.get("gstr_filename"),
        pr_filename=session.get("pr_filename"),
        correlation=session.get("correlation"),
        selected_rule_ids=session.get("selected_rule_ids", []),
        rule_execution_order=session.get("rule_execution_order", []),
        waterfall_passes=session.get("waterfall_passes", []),
    )


@router_v2.get("/{session_id}/rules/waterfall", response_model=list[MatchingPass])
def get_v2_waterfall(session_id: str) -> list[MatchingPass]:
    session = _ensure_session(session_id)
    if session.get("waterfall_passes"):
        first_pass = session["waterfall_passes"][0] if session["waterfall_passes"] else None
        if first_pass and first_pass.rules and any("Vendor_GSTIN" in r.pr_column or (session.get("correlation") and r.pr_column) for r in first_pass.rules):
            return session["waterfall_passes"]

    # Generate default recommended waterfall from detected correlation
    correlations_dicts: list[dict[str, Any]] = []
    if session.get("correlation"):
        for c in session["correlation"].correlations:
            correlations_dicts.append({
                "gstr_column": c.gstr_column,
                "selected_pr_column": c.selected_pr_column,
                "canonical_concept": c.canonical_concept,
            })
    else:
        # Default sample GST column names (matching POC sample files)
        correlations_dicts = [
            {"gstr_column": "Counterparty_GSTIN", "selected_pr_column": "Vendor_GSTIN", "canonical_concept": "gstin"},
            {"gstr_column": "Counterparty_Document_Number", "selected_pr_column": "PR_Document_Number", "canonical_concept": "document_number"},
            {"gstr_column": "Taxable_Value", "selected_pr_column": "Taxable_Value", "canonical_concept": "taxable_value"},
            {"gstr_column": "Counterparty_Document_Date", "selected_pr_column": "PR_Document_Date", "canonical_concept": "document_date"},
        ]

    waterfall = build_default_waterfall(correlations_dicts)
    session["waterfall_passes"] = waterfall
    return waterfall


@router_v2.post("/{session_id}/rules/simulate", response_model=SimulationResult)
def simulate_v2_rules(
    session_id: str,
    req: SimulateWaterfallRequest,
) -> SimulationResult:
    session = _ensure_session(session_id)
    gov_path_str = session.get("gstr_path")
    pr_path_str = session.get("pr_path")

    def _resolve_file(p_str: str | None, fallback: Path) -> Path:
        if p_str:
            p = Path(p_str)
            if p.exists():
                return p
            p_rel = PROJECT_ROOT / p_str
            if p_rel.exists():
                return p_rel
        return fallback

    gov_path = _resolve_file(gov_path_str, SAMPLE_GOV)
    pr_path = _resolve_file(pr_path_str, SAMPLE_PR)

    try:
        if gov_path.suffix.lower() == ".csv":
            gstr_df = pd.read_csv(gov_path)
        else:
            gstr_df = pd.read_excel(gov_path)

        if pr_path.suffix.lower() == ".csv":
            pr_df = pd.read_csv(pr_path)
        else:
            pr_df = pd.read_excel(pr_path)
    except Exception as exc:
        logger.warning(f"Failed to read session data files for simulation: {exc}")
        gstr_df = pd.DataFrame()
        pr_df = pd.DataFrame()

    engine = WaterfallMatchingEngine()
    return engine.simulate(gstr_df, pr_df, req.passes)


@router_v2.post("/{session_id}/rules/confirm-waterfall", response_model=ReconciliationV2Session)
def confirm_v2_waterfall(
    session_id: str,
    req: ConfirmWaterfallRequest,
) -> ReconciliationV2Session:
    if session_id not in _V2_SESSIONS:
        raise HTTPException(status_code=404, detail="Reconciliation 2.0 session not found")

    session = _V2_SESSIONS[session_id]
    session["waterfall_passes"] = req.passes
    session["status"] = "rules_confirmed"
    return ReconciliationV2Session(
        id=session["id"],
        status=session["status"],
        created_at=session["created_at"],
        gstr_filename=session.get("gstr_filename"),
        pr_filename=session.get("pr_filename"),
        correlation=session.get("correlation"),
        selected_rule_ids=session.get("selected_rule_ids", []),
        rule_execution_order=session.get("rule_execution_order", []),
        waterfall_passes=session.get("waterfall_passes", []),
        rules_v2=session.get("rules_v2", []),
    )


@router_v2.post("/{session_id}/rules/confirm", response_model=ReconciliationV2Session)
def confirm_v2_rules(
    session_id: str,
    update_req: UserRulesUpdateRequest,
) -> ReconciliationV2Session:
    if session_id not in _V2_SESSIONS:
        raise HTTPException(status_code=404, detail="Reconciliation 2.0 session not found")

    session = _V2_SESSIONS[session_id]
    session["selected_rule_ids"] = update_req.selected_rule_ids
    session["rule_execution_order"] = update_req.rule_execution_order
    session["status"] = "rules_confirmed"
    return ReconciliationV2Session(
        id=session["id"],
        status=session["status"],
        created_at=session["created_at"],
        gstr_filename=session.get("gstr_filename"),
        pr_filename=session.get("pr_filename"),
        correlation=session.get("correlation"),
        selected_rule_ids=session.get("selected_rule_ids", []),
        rule_execution_order=session.get("rule_execution_order", []),
        waterfall_passes=session.get("waterfall_passes", []),
        rules_v2=session.get("rules_v2", []),
    )


# --- Rules Wiki 2.0 Endpoints ---

@router_v2.get("/rules-v2/catalog", response_model=list[Rule2Item])
def get_rules_wiki_v2_catalog() -> list[Rule2Item]:
    """Returns the master Rules Wiki 2.0 catalog tailored for 223-column enterprise reconciliations."""
    return build_default_rules_wiki_v2()


@router_v2.post("/rules-v2/compile-ai", response_model=Rule2Item)
def compile_ai_rule_endpoint(
    req: CompileAiRuleRequest,
    settings: Annotated[Settings, Depends(get_settings)],
) -> Rule2Item:
    """Compiles a user natural language rule specification into an executable declarative Rule2Item."""
    return compile_rule_from_nl(req.prompt, req.available_columns)


@router_v2.post("/{session_id}/rules-v2/simulate", response_model=SimulationResultV2)
def simulate_rules_v2_endpoint(
    session_id: str,
    req: SimulateRules2Request,
) -> SimulationResultV2:
    """Simulates simultaneous match rate and individual satisfaction breakdowns for Rules 2.0."""
    session = _ensure_session(session_id)
    gov_path_str = session.get("gstr_path")
    pr_path_str = session.get("pr_path")

    pref_gov = SAMPLE_223_GOV if SAMPLE_223_GOV.exists() else SAMPLE_GOV
    pref_pr = SAMPLE_223_PR if SAMPLE_223_PR.exists() else SAMPLE_PR

    def _resolve_file(p_str: str | None, fallback: Path) -> Path:
        if p_str:
            p = Path(p_str)
            if p.exists():
                return p
            p_rel = PROJECT_ROOT / p_str
            if p_rel.exists():
                return p_rel
        return fallback

    gov_path = _resolve_file(gov_path_str, pref_gov)
    pr_path = _resolve_file(pr_path_str, pref_pr)

    gstr_df = _load_df_safely(gov_path)
    pr_df = _load_df_safely(pr_path)

    engine = WaterfallMatchingEngine()
    return engine.simulate_rules_v2(gstr_df, pr_df, req.rules)


@router_v2.post("/{session_id}/rules-v2/confirm", response_model=ReconciliationV2Session)
def confirm_rules_v2_endpoint(
    session_id: str,
    req: ConfirmRules2Request,
) -> ReconciliationV2Session:
    """Saves confirmed Rules 2.0 configuration into session state."""
    session = _ensure_session(session_id)
    session["rules_v2"] = req.rules
    session["status"] = "rules_confirmed"
    return ReconciliationV2Session(
        id=session["id"],
        status=session["status"],
        created_at=session["created_at"],
        gstr_filename=session.get("gstr_filename"),
        pr_filename=session.get("pr_filename"),
        correlation=session.get("correlation"),
        selected_rule_ids=[r.id for r in req.rules if r.is_enabled],
        rule_execution_order=[r.id for r in sorted(req.rules, key=lambda x: x.execution_order)],
        waterfall_passes=session.get("waterfall_passes", []),
        rules_v2=session.get("rules_v2", []),
    )

