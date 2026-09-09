from __future__ import annotations

import logging
from pathlib import Path
from typing import Annotated, Any
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel, Field

from app.config import Settings, get_settings
from app.domain.models import DatasetRole
from app.providers.base import LLMProvider
from app.providers.factory import create_llm_provider
from app.services.direct_schema_correlator import (
    AgentThought,
    DirectColumnCorrelation,
    DirectCorrelationResult,
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


class UserMappingUpdateRequest(BaseModel):
    correlations: list[DirectColumnCorrelation]


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


@router_v2.get("/{session_id}", response_model=ReconciliationV2Session)
def get_v2_session(session_id: str) -> ReconciliationV2Session:
    if session_id not in _V2_SESSIONS:
        raise HTTPException(status_code=404, detail="Reconciliation 2.0 session not found")
    data = _V2_SESSIONS[session_id]
    return ReconciliationV2Session(
        id=data["id"],
        status=data["status"],
        created_at=data["created_at"],
        gstr_filename=data.get("gstr_filename"),
        pr_filename=data.get("pr_filename"),
        correlation=data.get("correlation"),
    )


@router_v2.post("/{session_id}/fast-upload-and-correlate", response_model=DirectCorrelationResult)
async def fast_upload_and_correlate(
    session_id: str,
    government_file: Annotated[UploadFile, File(...)],
    purchase_file: Annotated[UploadFile, File(...)],
    settings: Annotated[Settings, Depends(get_settings)],
    workflow: Annotated[SchemaMappingV2Workflow, Depends(get_v2_workflow)],
) -> DirectCorrelationResult:
    if session_id not in _V2_SESSIONS:
        # Auto-create if not pre-initialized
        import datetime

        _V2_SESSIONS[session_id] = {
            "id": session_id,
            "status": "setup",
            "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        }

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
        correlation = workflow.run_initial_correlation(session_id, gov_path, pr_path)
        _V2_SESSIONS[session_id]["gstr_filename"] = government_file.filename
        _V2_SESSIONS[session_id]["pr_filename"] = purchase_file.filename
        _V2_SESSIONS[session_id]["gstr_path"] = str(gov_path)
        _V2_SESSIONS[session_id]["pr_path"] = str(pr_path)
        _V2_SESSIONS[session_id]["correlation"] = correlation
        _V2_SESSIONS[session_id]["status"] = "mapped"
        return correlation
    except Exception as exc:
        logger.error(f"Reconciliation 2.0 correlation error: {exc}", exc_info=True)
        raise HTTPException(status_code=422, detail=f"Schema correlation failed: {exc}") from exc


@router_v2.post("/{session_id}/mapping/confirm", response_model=ReconciliationV2Session)
def confirm_v2_mapping(
    session_id: str,
    update_req: UserMappingUpdateRequest,
) -> ReconciliationV2Session:
    if session_id not in _V2_SESSIONS:
        raise HTTPException(status_code=404, detail="Reconciliation 2.0 session not found")

    session = _V2_SESSIONS[session_id]
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
    )
