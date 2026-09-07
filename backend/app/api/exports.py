from pathlib import Path
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from app.domain.models import ExportRecord, FinalReview
from app.services.export import ExportError, KigsExportService
from app.services.reconciliation import ReconciliationNotReadyError

router = APIRouter(prefix="/reconciliations/{reconciliation_id}", tags=["exports"])


def get_export_service() -> KigsExportService:
    raise RuntimeError("Application dependency not configured")


@router.get("/final-review", response_model=FinalReview)
def final_review(reconciliation_id: UUID, service: Annotated[KigsExportService, Depends(get_export_service)]):
    return service.review(reconciliation_id)


@router.get("/exports", response_model=list[ExportRecord])
def export_history(reconciliation_id: UUID, service: Annotated[KigsExportService, Depends(get_export_service)]):
    return service.history(reconciliation_id)


@router.post("/exports", response_model=ExportRecord)
def generate_export(reconciliation_id: UUID, service: Annotated[KigsExportService, Depends(get_export_service)]):
    try:
        return service.generate(reconciliation_id)
    except ExportError as exc:
        raise HTTPException(status_code=409, detail={
            "message": str(exc), "validation": exc.validation.model_dump(mode="json")
        }) from exc


@router.get("/exports/{export_id}/download")
def download_export(reconciliation_id: UUID, export_id: UUID,
                    service: Annotated[KigsExportService, Depends(get_export_service)]):
    try:
        record = service.get(export_id)
    except ReconciliationNotReadyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if record.reconciliation_id != reconciliation_id:
        raise HTTPException(status_code=404, detail="Export not found for this reconciliation")
    path = Path(record.file_path)
    if not path.is_file():
        raise HTTPException(status_code=410, detail="Historical export file is unavailable")
    return FileResponse(path, filename=path.name,
                        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
