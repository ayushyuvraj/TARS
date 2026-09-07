from __future__ import annotations

from pathlib import Path
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status

from app.domain.models import (
    AgentEvent,
    CandidateMatch,
    CanonicalFieldDefinition,
    ConfirmedMappingSet,
    DatasetRole,
    HumanMappingDecision,
    HumanPolicyDecision,
    NaturalLanguagePolicyProposal,
    NaturalLanguagePolicyRequest,
    MatchingThresholds,
    NearMatchAnalysis,
    NearMatchBulkApprovalResult,
    NearMatchDecision,
    NearMatchReconciliationSummary,
    PolicyValidationResult,
    ReconciliationPolicy,
    ReconciliationListItem,
    ReconciliationResults,
    ReconciliationSession,
    ReconciliationSummary,
    ToleranceReconciliationSummary,
    SchemaMappingProposal,
    UploadedFile,
    AmbiguousSelectionRequest,
    CopilotConversation,
    CopilotRequest,
    CopilotResponse,
    ExceptionBreakdown,
    ExceptionRecord,
    ExceptionSearchRequest,
    ExceptionSearchResult,
    PolicySimulationRequest,
    PolicySimulationResult,
    SemanticBatchRequest,
    SemanticBatchResult,
    SemanticAvailability,
    SemanticClassification,
    SemanticDecision,
    VarianceAnalysis,
    AIInvestigationAvailability,
    AIInvestigationRecord,
    QuickReconcileInterrupt,
    QuickReconcileResponse,
    RoleDetectionResult,
)
from app.services.excel_parser import ExcelParseError
from app.services.reconciliation import (
    MappingInvalidError,
    PolicyInvalidError,
    ReconciliationNotFoundError,
    ReconciliationNotReadyError,
    ReconciliationService,
)
from app.services.canonical_schema import CANONICAL_FIELD_DEFINITIONS
from app.services.schema_mapping import SchemaProviderUnavailable
from app.workflows.exact_match import ExactMatchWorkflow
from app.workflows.schema_mapping import SchemaMappingWorkflow
from app.workflows.policy import PolicyWorkflow
from app.workflows.near_match import NearMatchWorkflow
from app.services.exception_tools import ExceptionToolError, ExceptionToolService
from app.services.semantic import SemanticExceptionService, SemanticProviderUnavailable
from app.services.copilot import CopilotService
from app.services.governance import GovernanceService
from app.api.governance import get_governance_service
from app.services.investigation import AIInvestigationService, AIInvestigationUnavailable
from app.providers.base import ProviderError

router = APIRouter(prefix="/reconciliations", tags=["reconciliations"])
schema_router = APIRouter(prefix="/schema", tags=["schema"])


def get_service() -> ReconciliationService:
    raise RuntimeError("Application dependency not configured")


def get_workflow() -> ExactMatchWorkflow:
    raise RuntimeError("Application dependency not configured")


def get_mapping_workflow() -> SchemaMappingWorkflow:
    raise RuntimeError("Application dependency not configured")


def get_policy_workflow() -> PolicyWorkflow:
    raise RuntimeError("Application dependency not configured")


def get_near_workflow() -> NearMatchWorkflow:
    raise RuntimeError("Application dependency not configured")


def get_exception_tools() -> ExceptionToolService:
    raise RuntimeError("Application dependency not configured")


def get_semantic_service() -> SemanticExceptionService:
    raise RuntimeError("Application dependency not configured")


def get_copilot_service() -> CopilotService:
    raise RuntimeError("Application dependency not configured")


def get_investigation_service() -> AIInvestigationService:
    raise RuntimeError("Application dependency not configured")


@schema_router.get("/canonical-fields", response_model=list[CanonicalFieldDefinition])
def get_canonical_fields() -> tuple[CanonicalFieldDefinition, ...]:
    return CANONICAL_FIELD_DEFINITIONS


def _not_found(exc: Exception) -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reconciliation not found")


@router.post("", response_model=ReconciliationSession, status_code=status.HTTP_201_CREATED)
def create_reconciliation(
    service: Annotated[ReconciliationService, Depends(get_service)],
) -> ReconciliationSession:
    return service.create()


@router.get("", response_model=list[ReconciliationListItem])
def list_reconciliations(
    service: Annotated[ReconciliationService, Depends(get_service)],
) -> list[ReconciliationListItem]:
    return service.list_sessions()


@router.post("/detect-roles", response_model=RoleDetectionResult)
async def detect_roles(
    file_1: Annotated[UploadFile, File(...)],
    file_2: Annotated[UploadFile, File(...)],
    service: Annotated[ReconciliationService, Depends(get_service)],
) -> RoleDetectionResult:
    if not file_1.filename or not file_2.filename:
        raise HTTPException(status_code=400, detail="Both files must have valid filenames")
    temp_dir = service.settings.upload_dir / "temp-role-detection"
    temp_dir.mkdir(parents=True, exist_ok=True)
    temp_1 = temp_dir / f"temp1-{uuid4().hex}.xlsx"
    temp_2 = temp_dir / f"temp2-{uuid4().hex}.xlsx"
    try:
        with temp_1.open("wb") as t1:
            while chunk := await file_1.read(1024 * 1024):
                t1.write(chunk)
        with temp_2.open("wb") as t2:
            while chunk := await file_2.read(1024 * 1024):
                t2.write(chunk)
        return service.parser.detect_roles(temp_1, temp_2)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Could not parse uploaded files for role detection: {exc}")
    finally:
        temp_1.unlink(missing_ok=True)
        temp_2.unlink(missing_ok=True)
        await file_1.close()
        await file_2.close()


@router.post("/quick-reconcile", response_model=QuickReconcileResponse)
async def quick_reconcile(
    file_1: Annotated[UploadFile, File(...)],
    file_2: Annotated[UploadFile, File(...)],
    service: Annotated[ReconciliationService, Depends(get_service)],
    governance: Annotated[GovernanceService, Depends(get_governance_service)],
    mapping_wf: Annotated[SchemaMappingWorkflow, Depends(get_mapping_workflow)],
    policy_wf: Annotated[PolicyWorkflow, Depends(get_policy_workflow)],
    near_wf: Annotated[NearMatchWorkflow, Depends(get_near_workflow)],
    instruction: Annotated[str | None, Form()] = None,
    profile_id: Annotated[UUID | None, Form()] = None,
    file_1_role: Annotated[DatasetRole | None, Form()] = None,
    file_2_role: Annotated[DatasetRole | None, Form()] = None,
) -> QuickReconcileResponse:
    if not file_1.filename or Path(file_1.filename).suffix.lower() != ".xlsx":
        raise HTTPException(status_code=415, detail="Only .xlsx workbooks are supported (File 1 invalid)")
    if not file_2.filename or Path(file_2.filename).suffix.lower() != ".xlsx":
        raise HTTPException(status_code=415, detail="Only .xlsx workbooks are supported (File 2 invalid)")

    # Pre-validate readability & determine roles BEFORE persisting session to prevent orphan sessions
    temp_dir = service.settings.upload_dir / "pre-validation"
    temp_dir.mkdir(parents=True, exist_ok=True)
    t1 = temp_dir / f"val1-{uuid4().hex}.xlsx"
    t2 = temp_dir / f"val2-{uuid4().hex}.xlsx"
    try:
        content1 = await file_1.read()
        content2 = await file_2.read()
        t1.write_bytes(content1)
        t2.write_bytes(content2)
        await file_1.seek(0)
        await file_2.seek(0)

        role1 = file_1_role
        role2 = file_2_role
        if not role1 or not role2:
            detected = service.parser.detect_roles(t1, t2)
            role1 = detected.file_1_role
            role2 = detected.file_2_role
    except ExcelParseError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Workbook validation failed: {exc}") from exc
    finally:
        t1.unlink(missing_ok=True)
        t2.unlink(missing_ok=True)

    # Session is created ONLY after workbooks pass pre-validation
    session = service.create()
    reconciliation_id = session.id

    await _save_and_register(reconciliation_id, role1, file_1, service)
    await _save_and_register(reconciliation_id, role2, file_2, service)

    return service.quick_reconcile(
        reconciliation_id=reconciliation_id,
        instruction=instruction,
        profile_id=profile_id,
        governance_service=governance,
        mapping_workflow=mapping_wf,
        policy_workflow=policy_wf,
        near_workflow=near_wf,
    )


@router.post("/{reconciliation_id}/quick-resume", response_model=QuickReconcileResponse)
def quick_resume(
    reconciliation_id: UUID,
    service: Annotated[ReconciliationService, Depends(get_service)],
    governance: Annotated[GovernanceService, Depends(get_governance_service)],
    mapping_wf: Annotated[SchemaMappingWorkflow, Depends(get_mapping_workflow)],
    policy_wf: Annotated[PolicyWorkflow, Depends(get_policy_workflow)],
    near_wf: Annotated[NearMatchWorkflow, Depends(get_near_workflow)],
    instruction: Annotated[str | None, Query()] = None,
    profile_id: Annotated[UUID | None, Query()] = None,
) -> QuickReconcileResponse:
    try:
        return service.quick_reconcile(
            reconciliation_id=reconciliation_id,
            instruction=instruction,
            profile_id=profile_id,
            governance_service=governance,
            mapping_workflow=mapping_wf,
            policy_workflow=policy_wf,
            near_workflow=near_wf,
        )
    except ReconciliationNotFoundError as exc:
        raise _not_found(exc) from exc



async def _save_and_register(
    reconciliation_id: UUID,
    role: DatasetRole,
    upload: UploadFile,
    service: ReconciliationService,
) -> UploadedFile:
    if not upload.filename or Path(upload.filename).suffix.lower() != ".xlsx":
        raise HTTPException(status_code=415, detail="Only .xlsx workbooks are supported")
    try:
        service.get(reconciliation_id)
    except ReconciliationNotFoundError as exc:
        raise _not_found(exc) from exc
    destination_dir = service.settings.upload_dir / str(reconciliation_id)
    destination_dir.mkdir(parents=True, exist_ok=True)
    destination = destination_dir / f"{role.value}-{uuid4().hex}.xlsx"
    total = 0
    try:
        with destination.open("wb") as target:
            while chunk := await upload.read(1024 * 1024):
                total += len(chunk)
                if total > service.settings.max_upload_bytes:
                    raise HTTPException(status_code=413, detail="Workbook exceeds upload limit")
                target.write(chunk)
        safe_original_name = Path(upload.filename).name
        return service.register_upload(
            reconciliation_id, role, safe_original_name, destination, total
        )
    except ExcelParseError as exc:
        destination.unlink(missing_ok=True)
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception:
        destination.unlink(missing_ok=True)
        raise
    finally:
        await upload.close()


@router.post("/{reconciliation_id}/files/government", response_model=UploadedFile)
async def upload_government_file(
    reconciliation_id: UUID,
    file: Annotated[UploadFile, File(...)],
    service: Annotated[ReconciliationService, Depends(get_service)],
) -> UploadedFile:
    return await _save_and_register(reconciliation_id, DatasetRole.GOVERNMENT, file, service)


@router.post("/{reconciliation_id}/files/purchase-register", response_model=UploadedFile)
async def upload_purchase_register_file(
    reconciliation_id: UUID,
    file: Annotated[UploadFile, File(...)],
    service: Annotated[ReconciliationService, Depends(get_service)],
) -> UploadedFile:
    return await _save_and_register(
        reconciliation_id, DatasetRole.PURCHASE_REGISTER, file, service
    )


@router.post("/{reconciliation_id}/run/exact-match", response_model=ReconciliationSummary)
def run_exact_match(
    reconciliation_id: UUID,
    workflow: Annotated[ExactMatchWorkflow, Depends(get_workflow)],
) -> ReconciliationSummary:
    try:
        return workflow.run(reconciliation_id)
    except ReconciliationNotFoundError as exc:
        raise _not_found(exc) from exc
    except ReconciliationNotReadyError as exc:
        raise HTTPException(
            status_code=409,
            detail={"code": "reconciliation_not_ready", "message": str(exc)},
        ) from exc


@router.post("/{reconciliation_id}/mapping/analyze", response_model=SchemaMappingProposal)
def analyze_mapping(
    reconciliation_id: UUID,
    workflow: Annotated[SchemaMappingWorkflow, Depends(get_mapping_workflow)],
) -> SchemaMappingProposal:
    try:
        return workflow.start(reconciliation_id)
    except ReconciliationNotFoundError as exc:
        raise _not_found(exc) from exc
    except ReconciliationNotReadyError as exc:
        raise HTTPException(status_code=409, detail={"code": "files_required", "message": str(exc)}) from exc
    except SchemaProviderUnavailable as exc:
        raise HTTPException(
            status_code=503,
            detail={"code": "schema_provider_unavailable", "message": str(exc), "retryable": True},
        ) from exc


@router.get("/{reconciliation_id}/mapping", response_model=SchemaMappingProposal)
def get_mapping(
    reconciliation_id: UUID,
    service: Annotated[ReconciliationService, Depends(get_service)],
) -> SchemaMappingProposal:
    try:
        return service.get_mapping(reconciliation_id)
    except ReconciliationNotFoundError as exc:
        raise _not_found(exc) from exc
    except ReconciliationNotReadyError as exc:
        raise HTTPException(status_code=409, detail={"code": "mapping_not_ready", "message": str(exc)}) from exc


@router.put("/{reconciliation_id}/mapping", response_model=SchemaMappingProposal)
def update_mapping(
    reconciliation_id: UUID,
    decision: HumanMappingDecision,
    service: Annotated[ReconciliationService, Depends(get_service)],
) -> SchemaMappingProposal:
    try:
        return service.edit_mapping(reconciliation_id, decision)
    except ReconciliationNotFoundError as exc:
        raise _not_found(exc) from exc
    except ReconciliationNotReadyError as exc:
        raise HTTPException(status_code=409, detail={"code": "mapping_not_ready", "message": str(exc)}) from exc


@router.post("/{reconciliation_id}/mapping/confirm", response_model=ConfirmedMappingSet)
def confirm_mapping(
    reconciliation_id: UUID,
    service: Annotated[ReconciliationService, Depends(get_service)],
    workflow: Annotated[SchemaMappingWorkflow, Depends(get_mapping_workflow)],
) -> ConfirmedMappingSet:
    try:
        confirmed = service.confirm_mapping(reconciliation_id)
        workflow.resume_after_confirmation(reconciliation_id)
        return confirmed
    except ReconciliationNotFoundError as exc:
        raise _not_found(exc) from exc
    except MappingInvalidError as exc:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "invalid_mapping",
                "message": "Resolve mapping validation errors before confirmation.",
                "validation": exc.validation.model_dump(mode="json"),
            },
        ) from exc
    except ReconciliationNotReadyError as exc:
        raise HTTPException(status_code=409, detail={"code": "mapping_not_ready", "message": str(exc)}) from exc


@router.get("/{reconciliation_id}", response_model=ReconciliationSession)
def get_reconciliation(
    reconciliation_id: UUID,
    service: Annotated[ReconciliationService, Depends(get_service)],
    include_near_analysis: Annotated[bool, Query()] = True,
) -> ReconciliationSession:
    try:
        session = service.get(reconciliation_id)
        return session if include_near_analysis else session.model_copy(
            update={"near_match_analysis": None}
        )
    except ReconciliationNotFoundError as exc:
        raise _not_found(exc) from exc


@router.get("/{reconciliation_id}/summary", response_model=ReconciliationSummary)
def get_summary(
    reconciliation_id: UUID,
    service: Annotated[ReconciliationService, Depends(get_service)],
) -> ReconciliationSummary:
    try:
        session = service.get(reconciliation_id)
    except ReconciliationNotFoundError as exc:
        raise _not_found(exc) from exc
    if session.summary is None:
        raise HTTPException(status_code=409, detail="Exact reconciliation has not completed")
    return session.summary


@router.get("/audit-events", response_model=list[AgentEvent])
def get_global_audit_events(
    service: Annotated[ReconciliationService, Depends(get_service)],
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> list[AgentEvent]:
    return service.repository.list_events(None, limit)


@router.get("/{reconciliation_id}/audit-events", response_model=list[AgentEvent])
def get_audit_events(
    reconciliation_id: UUID,
    service: Annotated[ReconciliationService, Depends(get_service)],
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> list[AgentEvent]:
    try:
        service.get(reconciliation_id)
    except ReconciliationNotFoundError as exc:
        raise _not_found(exc) from exc
    return service.repository.list_events(reconciliation_id, limit)


@router.post("/{reconciliation_id}/policy/propose", response_model=NaturalLanguagePolicyProposal)
def propose_policy(
    reconciliation_id: UUID,
    workflow: Annotated[PolicyWorkflow, Depends(get_policy_workflow)],
    request: NaturalLanguagePolicyRequest | None = None,
) -> NaturalLanguagePolicyProposal:
    try:
        return workflow.start(reconciliation_id, request.instruction if request else None)
    except ReconciliationNotFoundError as exc:
        raise _not_found(exc) from exc
    except ReconciliationNotReadyError as exc:
        raise HTTPException(status_code=409, detail={"code": "mapping_not_confirmed", "message": str(exc)}) from exc


@router.get("/{reconciliation_id}/policy", response_model=NaturalLanguagePolicyProposal)
def get_policy(
    reconciliation_id: UUID,
    service: Annotated[ReconciliationService, Depends(get_service)],
) -> NaturalLanguagePolicyProposal:
    try:
        return service.get_policy(reconciliation_id)
    except ReconciliationNotFoundError as exc:
        raise _not_found(exc) from exc
    except ReconciliationNotReadyError as exc:
        raise HTTPException(status_code=409, detail={"code": "policy_not_ready", "message": str(exc)}) from exc


@router.put("/{reconciliation_id}/policy", response_model=NaturalLanguagePolicyProposal)
def update_policy(
    reconciliation_id: UUID,
    decision: HumanPolicyDecision,
    service: Annotated[ReconciliationService, Depends(get_service)],
) -> NaturalLanguagePolicyProposal:
    try:
        return service.edit_policy(reconciliation_id, decision)
    except ReconciliationNotFoundError as exc:
        raise _not_found(exc) from exc
    except ReconciliationNotReadyError as exc:
        raise HTTPException(status_code=409, detail={"code": "policy_not_ready", "message": str(exc)}) from exc


@router.post("/{reconciliation_id}/policy/validate", response_model=PolicyValidationResult)
def validate_policy(
    reconciliation_id: UUID,
    service: Annotated[ReconciliationService, Depends(get_service)],
) -> PolicyValidationResult:
    try:
        return service.validate_policy(reconciliation_id)
    except ReconciliationNotFoundError as exc:
        raise _not_found(exc) from exc
    except ReconciliationNotReadyError as exc:
        raise HTTPException(status_code=409, detail={"code": "policy_not_ready", "message": str(exc)}) from exc


@router.post("/{reconciliation_id}/policy/confirm", response_model=ReconciliationPolicy)
def confirm_policy(
    reconciliation_id: UUID,
    service: Annotated[ReconciliationService, Depends(get_service)],
    workflow: Annotated[PolicyWorkflow, Depends(get_policy_workflow)],
) -> ReconciliationPolicy:
    try:
        policy = service.confirm_policy(reconciliation_id)
        workflow.resume_after_confirmation(reconciliation_id)
        return policy
    except ReconciliationNotFoundError as exc:
        raise _not_found(exc) from exc
    except PolicyInvalidError as exc:
        raise HTTPException(status_code=422, detail={
            "code": "invalid_policy", "message": "Resolve policy validation errors before confirmation.",
            "policy_validation": exc.validation.model_dump(mode="json"),
        }) from exc
    except ReconciliationNotReadyError as exc:
        raise HTTPException(status_code=409, detail={"code": "policy_not_ready", "message": str(exc)}) from exc


@router.post("/{reconciliation_id}/run/tolerance-match", response_model=ToleranceReconciliationSummary)
def run_tolerance_match(
    reconciliation_id: UUID,
    service: Annotated[ReconciliationService, Depends(get_service)],
) -> ToleranceReconciliationSummary:
    try:
        return service.run_tolerance_match(reconciliation_id)
    except ReconciliationNotFoundError as exc:
        raise _not_found(exc) from exc
    except PolicyInvalidError as exc:
        raise HTTPException(status_code=422, detail={
            "code": "invalid_policy", "message": str(exc),
            "policy_validation": exc.validation.model_dump(mode="json"),
        }) from exc
    except ReconciliationNotReadyError as exc:
        raise HTTPException(status_code=409, detail={"code": "reconciliation_not_ready", "message": str(exc)}) from exc


@router.post("/{reconciliation_id}/near-match/analyze", response_model=NearMatchAnalysis)
def analyze_near_matches(
    reconciliation_id: UUID,
    workflow: Annotated[NearMatchWorkflow, Depends(get_near_workflow)],
    governance: Annotated[GovernanceService, Depends(get_governance_service)],
    thresholds: MatchingThresholds | None = None,
) -> NearMatchAnalysis:
    try:
        analysis = workflow.start(reconciliation_id, thresholds)
        governance.execute_available_rules(reconciliation_id)
        return analysis
    except ReconciliationNotFoundError as exc:
        raise _not_found(exc) from exc
    except ReconciliationNotReadyError as exc:
        raise HTTPException(status_code=409, detail={"code": "near_match_not_ready", "message": str(exc)}) from exc


@router.get("/{reconciliation_id}/near-match", response_model=NearMatchAnalysis)
def get_near_matches(
    reconciliation_id: UUID,
    service: Annotated[ReconciliationService, Depends(get_service)],
) -> NearMatchAnalysis:
    try:
        return service.get_near_analysis(reconciliation_id)
    except ReconciliationNotFoundError as exc:
        raise _not_found(exc) from exc
    except ReconciliationNotReadyError as exc:
        raise HTTPException(status_code=409, detail={"code": "near_match_not_ready", "message": str(exc)}) from exc


@router.get("/{reconciliation_id}/near-match/summary", response_model=NearMatchReconciliationSummary)
def get_near_match_summary(
    reconciliation_id: UUID,
    service: Annotated[ReconciliationService, Depends(get_service)],
) -> NearMatchReconciliationSummary:
    try:
        session = service.get(reconciliation_id)
    except ReconciliationNotFoundError as exc:
        raise _not_found(exc) from exc
    if session.near_match_summary is None:
        raise HTTPException(status_code=409, detail={"code": "near_match_not_ready", "message": "Near-match analysis has not completed"})
    return session.near_match_summary


@router.post("/{reconciliation_id}/near-match/{candidate_id}/decision", response_model=NearMatchReconciliationSummary)
def decide_near_match(
    reconciliation_id: UUID,
    candidate_id: UUID,
    decision: NearMatchDecision,
    service: Annotated[ReconciliationService, Depends(get_service)],
    workflow: Annotated[NearMatchWorkflow, Depends(get_near_workflow)],
) -> NearMatchReconciliationSummary:
    try:
        summary = service.decide_near_candidate(reconciliation_id, candidate_id, decision.action)
        if summary.near_match_proposals == 0:
            workflow.resume_after_review(reconciliation_id)
        return summary
    except ReconciliationNotFoundError as exc:
        raise _not_found(exc) from exc
    except ReconciliationNotReadyError as exc:
        raise HTTPException(status_code=409, detail={"code": "candidate_not_actionable", "message": str(exc)}) from exc


@router.post("/{reconciliation_id}/near-match/bulk-approve", response_model=NearMatchBulkApprovalResult)
def bulk_approve_near_matches(
    reconciliation_id: UUID,
    service: Annotated[ReconciliationService, Depends(get_service)],
    workflow: Annotated[NearMatchWorkflow, Depends(get_near_workflow)],
) -> NearMatchBulkApprovalResult:
    try:
        result = service.bulk_approve_near_matches(reconciliation_id)
        if result.summary.near_match_proposals == 0:
            workflow.resume_after_review(reconciliation_id)
        return result
    except ReconciliationNotFoundError as exc:
        raise _not_found(exc) from exc
    except ReconciliationNotReadyError as exc:
        raise HTTPException(status_code=409, detail={"code": "near_match_not_ready", "message": str(exc)}) from exc


@router.get("/{reconciliation_id}/results", response_model=ReconciliationResults)
def get_results(
    reconciliation_id: UUID,
    service: Annotated[ReconciliationService, Depends(get_service)],
    result_status: Annotated[str | None, Query(alias="status")] = None,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=1000)] = 500,
) -> ReconciliationResults:
    try:
        if result_status and result_status not in {"EXACT_MATCHED", "TOLERANCE_MATCHED", "NEAR_MATCH_PROPOSED", "NEAR_MATCHED", "HUMAN_SELECTED", "AMBIGUOUS", "MATERIAL_MISMATCH", "GST_ONLY", "PR_ONLY", "UNRESOLVED"}:
            raise HTTPException(status_code=422, detail={"code": "invalid_result_status", "message": "Unsupported result status filter."})
        results = service.get_results(reconciliation_id, result_status)
    except ReconciliationNotFoundError as exc:
        raise _not_found(exc) from exc
    except ReconciliationNotReadyError as exc:
        raise HTTPException(status_code=409, detail={"code": "results_not_ready", "message": str(exc)}) from exc
    total = len(results.records)
    return results.model_copy(update={
        "records": results.records[offset:offset + limit],
        "total_records": total,
        "offset": offset,
        "limit": limit,
    })


@router.get("/{reconciliation_id}/exceptions", response_model=ExceptionBreakdown)
def exception_breakdown(
    reconciliation_id: UUID,
    tools: Annotated[ExceptionToolService, Depends(get_exception_tools)],
) -> ExceptionBreakdown:
    try:
        return tools.get_exception_breakdown(reconciliation_id)
    except ReconciliationNotFoundError as exc:
        raise _not_found(exc) from exc
    except ReconciliationNotReadyError as exc:
        raise HTTPException(status_code=409, detail={"code": "exceptions_not_ready", "message": str(exc)}) from exc


@router.get("/{reconciliation_id}/exceptions/records", response_model=ExceptionSearchResult)
def list_exceptions(
    reconciliation_id: UUID,
    tools: Annotated[ExceptionToolService, Depends(get_exception_tools)],
    category: Annotated[str | None, Query()] = None,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    search: Annotated[str | None, Query(max_length=120)] = None,
) -> ExceptionSearchResult:
    allowed = {"AMBIGUOUS", "MATERIAL_MISMATCH", "GST_ONLY", "PR_ONLY"}
    if category and category not in allowed:
        raise HTTPException(status_code=422, detail={
            "code": "invalid_exception_category", "message": "Unsupported exception category.",
        })
    try:
        return tools.search_records(reconciliation_id, ExceptionSearchRequest(
            statuses=[category] if category else None,
            record_id=search,
            offset=offset,
            limit=limit,
        ))
    except (ReconciliationNotReadyError, ExceptionToolError) as exc:
        raise HTTPException(status_code=409, detail={"code": "exception_tool_error", "message": str(exc)}) from exc


@router.post("/{reconciliation_id}/exceptions/search", response_model=ExceptionSearchResult)
def search_exceptions(
    reconciliation_id: UUID, filters: ExceptionSearchRequest,
    tools: Annotated[ExceptionToolService, Depends(get_exception_tools)],
) -> ExceptionSearchResult:
    try:
        return tools.search_records(reconciliation_id, filters)
    except (ReconciliationNotReadyError, ExceptionToolError) as exc:
        raise HTTPException(status_code=409, detail={"code": "exception_tool_error", "message": str(exc)}) from exc


@router.get("/{reconciliation_id}/records/{record_id}", response_model=ExceptionRecord)
def get_exception_record(
    reconciliation_id: UUID, record_id: str,
    tools: Annotated[ExceptionToolService, Depends(get_exception_tools)],
    include_source_values: Annotated[bool, Query()] = True,
) -> ExceptionRecord:
    try:
        return tools.get_record(
            reconciliation_id, record_id, include_source_values=include_source_values,
        )
    except ExceptionToolError as exc:
        raise HTTPException(status_code=404, detail={"code": "record_not_found", "message": str(exc)}) from exc


@router.get("/{reconciliation_id}/records/{record_id}/explanation", response_model=VarianceAnalysis)
def explain_exception_record(
    reconciliation_id: UUID, record_id: str,
    tools: Annotated[ExceptionToolService, Depends(get_exception_tools)],
) -> VarianceAnalysis:
    try:
        return tools.get_variance_analysis(reconciliation_id, record_id)
    except ExceptionToolError as exc:
        raise HTTPException(status_code=404, detail={"code": "record_not_found", "message": str(exc)}) from exc


@router.get("/{reconciliation_id}/records/{record_id}/candidates", response_model=list[CandidateMatch])
def ranked_candidates(
    reconciliation_id: UUID, record_id: str,
    tools: Annotated[ExceptionToolService, Depends(get_exception_tools)],
) -> list[CandidateMatch]:
    return tools.get_ranked_candidates(reconciliation_id, record_id)


@router.post("/{reconciliation_id}/records/{record_id}/simulate-policy", response_model=PolicySimulationResult)
def simulate_policy(
    reconciliation_id: UUID, record_id: str, request: PolicySimulationRequest,
    tools: Annotated[ExceptionToolService, Depends(get_exception_tools)],
) -> PolicySimulationResult:
    try:
        return tools.simulate_policy_change(reconciliation_id, record_id, request)
    except ExceptionToolError as exc:
        raise HTTPException(status_code=404, detail={"code": "record_not_found", "message": str(exc)}) from exc


@router.post("/{reconciliation_id}/exceptions/semantic-analysis", response_model=SemanticBatchResult)
def semantic_analysis(
    reconciliation_id: UUID, request: SemanticBatchRequest,
    service: Annotated[SemanticExceptionService, Depends(get_semantic_service)],
) -> SemanticBatchResult:
    try:
        return service.analyze_batch(reconciliation_id, request)
    except SemanticProviderUnavailable as exc:
        raise HTTPException(status_code=503, detail={"code": "semantic_provider_unavailable", "message": str(exc)}) from exc


@router.get("/{reconciliation_id}/exceptions/semantic-status", response_model=SemanticAvailability)
def semantic_status(
    reconciliation_id: UUID,
    semantic: Annotated[SemanticExceptionService, Depends(get_semantic_service)],
    reconciliation: Annotated[ReconciliationService, Depends(get_service)],
) -> SemanticAvailability:
    reconciliation.get(reconciliation_id)
    return SemanticAvailability(
        available=semantic.available,
        provider=semantic.provider.provider_name if semantic.provider else None,
        model=semantic.model_name if semantic.provider else None,
    )


@router.get("/{reconciliation_id}/exceptions/semantic-classifications", response_model=list[SemanticClassification])
def semantic_classifications(
    reconciliation_id: UUID,
    service: Annotated[SemanticExceptionService, Depends(get_semantic_service)],
) -> list[SemanticClassification]:
    return service.list(reconciliation_id)


@router.post("/{reconciliation_id}/records/{record_id}/semantic-decision", response_model=SemanticClassification)
def decide_semantic_classification(
    reconciliation_id: UUID, record_id: str, decision: SemanticDecision,
    service: Annotated[SemanticExceptionService, Depends(get_semantic_service)],
) -> SemanticClassification:
    try:
        return service.decide(reconciliation_id, record_id, decision)
    except ReconciliationNotReadyError as exc:
        raise HTTPException(status_code=409, detail={"code": "classification_not_ready", "message": str(exc)}) from exc


@router.post("/{reconciliation_id}/ambiguous/{record_id}/select", response_model=NearMatchReconciliationSummary)
def select_ambiguous_candidate(
    reconciliation_id: UUID, record_id: str, decision: AmbiguousSelectionRequest,
    tools: Annotated[ExceptionToolService, Depends(get_exception_tools)],
) -> NearMatchReconciliationSummary:
    try:
        return tools.select_ambiguous_candidate(reconciliation_id, record_id, decision)
    except (ExceptionToolError, ReconciliationNotReadyError) as exc:
        raise HTTPException(status_code=409, detail={"code": "ambiguous_selection_invalid", "message": str(exc)}) from exc


@router.post("/copilot/messages", response_model=CopilotResponse)
def global_copilot_message(
    request: CopilotRequest,
    service: Annotated[CopilotService, Depends(get_copilot_service)],
) -> CopilotResponse:
    try:
        return service.ask(request.reconciliation_id, request)
    except (ExceptionToolError, ReconciliationNotReadyError) as exc:
        raise HTTPException(status_code=409, detail={"code": "copilot_tool_error", "message": str(exc)}) from exc
    except AIInvestigationUnavailable as exc:
        raise HTTPException(status_code=503, detail={"code": "ai_investigation_unavailable", "message": str(exc)}) from exc
    except ProviderError as exc:
        raise HTTPException(status_code=502, detail={"code": "ai_provider_failure", "message": str(exc)}) from exc


@router.get("/copilot/conversation", response_model=CopilotConversation)
def global_copilot_conversation(
    conversation_id: UUID,
    service: Annotated[CopilotService, Depends(get_copilot_service)],
    reconciliation_id: UUID | None = None,
) -> CopilotConversation:
    return service.conversation(reconciliation_id, conversation_id)


@router.post("/{reconciliation_id}/copilot/messages", response_model=CopilotResponse)
def copilot_message(
    reconciliation_id: UUID, request: CopilotRequest,
    service: Annotated[CopilotService, Depends(get_copilot_service)],
) -> CopilotResponse:
    try:
        return service.ask(reconciliation_id, request)
    except (ExceptionToolError, ReconciliationNotReadyError) as exc:
        raise HTTPException(status_code=409, detail={"code": "copilot_tool_error", "message": str(exc)}) from exc
    except AIInvestigationUnavailable as exc:
        raise HTTPException(status_code=503, detail={"code": "ai_investigation_unavailable", "message": str(exc)}) from exc
    except ProviderError as exc:
        raise HTTPException(status_code=502, detail={"code": "ai_provider_failure", "message": str(exc)}) from exc


@router.get("/{reconciliation_id}/copilot/conversation", response_model=CopilotConversation)
def copilot_conversation(
    reconciliation_id: UUID, conversation_id: UUID,
    service: Annotated[CopilotService, Depends(get_copilot_service)],
) -> CopilotConversation:
    return service.conversation(reconciliation_id, conversation_id)


@router.get("/{reconciliation_id}/ai-investigation/status", response_model=AIInvestigationAvailability)
def ai_investigation_status(
    reconciliation_id: UUID,
    service: Annotated[AIInvestigationService, Depends(get_investigation_service)],
) -> AIInvestigationAvailability:
    service.reconciliation.get(reconciliation_id)
    return service.availability


@router.post("/{reconciliation_id}/records/{record_id}/ai-investigations", response_model=AIInvestigationRecord)
def investigate_exception(
    reconciliation_id: UUID, record_id: str,
    service: Annotated[AIInvestigationService, Depends(get_investigation_service)],
) -> AIInvestigationRecord:
    try:
        return service.investigate(reconciliation_id, record_id)
    except AIInvestigationUnavailable as exc:
        raise HTTPException(status_code=503, detail={"code": "ai_investigation_unavailable", "message": str(exc)}) from exc
    except ProviderError as exc:
        raise HTTPException(status_code=502, detail={"code": "ai_provider_failure", "message": str(exc)}) from exc
    except Exception as exc:
        raise HTTPException(status_code=422, detail={"code": "ai_investigation_failed", "message": str(exc)}) from exc


@router.get("/{reconciliation_id}/records/{record_id}/ai-investigations", response_model=list[AIInvestigationRecord])
def list_ai_investigations(
    reconciliation_id: UUID, record_id: str,
    service: Annotated[AIInvestigationService, Depends(get_investigation_service)],
) -> list[AIInvestigationRecord]:
    return service.list(reconciliation_id, record_id)
