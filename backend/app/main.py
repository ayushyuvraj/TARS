from __future__ import annotations

import logging

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from app.api.reconciliations import (
    get_mapping_workflow,
    get_policy_workflow,
    get_near_workflow,
    get_exception_tools,
    get_semantic_service,
    get_copilot_service,
    get_investigation_service,
    get_service,
    get_workflow,
    router,
    schema_router,
)
from app.api.reconciliations_v2 import router_v2
from app.api.reconciliations_v3 import router_v3
from app.api.reconciliations_v4 import router_v4
from app.api.reconciliations_v5 import router_v5
from app.config import Settings, get_settings
from app.domain.models import HealthResponse
from app.repositories.sqlite import SQLiteReconciliationRepository
from app.providers.factory import create_llm_provider
from app.providers.base import ProviderError
from app.services.exact_match import ExactMatchEngine
from app.services.excel_parser import ExcelParser
from app.services.reconciliation import ReconciliationService
from app.services.schema_mapping import DeterministicSchemaMapper, MappingValidator
from app.services.policy import PolicyValidator
from app.services.tolerance_match import ToleranceMatchEngine
from app.services.near_match import NearMatchEngine
from app.workflows.exact_match import ExactMatchWorkflow
from app.workflows.schema_mapping import SchemaMappingWorkflow
from app.workflows.policy import PolicyWorkflow
from app.workflows.near_match import NearMatchWorkflow
from app.services.exception_tools import ExceptionToolService
from app.services.semantic import SemanticExceptionService
from app.services.copilot import CopilotService
from app.services.governance import GovernanceService
from app.services.export import KigsExportService
from app.api.exports import get_export_service, router as export_router
from app.api.governance import (
    get_governance_service, governance_reconciliation_router, profile_router, rule_router,
)
from app.api.rules_catalog import rules_catalog_router
from app.providers.investigation import OpenAIInvestigationModel

from app.services.investigation_tools import InvestigationToolService
from app.services.investigation import AIInvestigationService
from app.workflows.exception_investigation import ExceptionInvestigationWorkflow

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")


def create_app(settings: Settings | None = None) -> FastAPI:
    resolved = settings or get_settings()
    repository = SQLiteReconciliationRepository(resolved.database_path)
    repository.initialize()
    llm_provider = None
    if resolved.llm_provider != "openai" or resolved.effective_openai_api_key:
        try:
            llm_provider = create_llm_provider(resolved)
        except ProviderError:
            logging.getLogger(__name__).warning("Configured LLM provider is unavailable")
    service = ReconciliationService(
        repository,
        ExcelParser(),
        ExactMatchEngine(),
        resolved,
        DeterministicSchemaMapper(resolved.mapping_high_confidence_threshold),
        MappingValidator(),
        llm_provider,
        PolicyValidator(),
        ToleranceMatchEngine(),
        NearMatchEngine(),
    )
    workflow = ExactMatchWorkflow(service)
    mapping_workflow = SchemaMappingWorkflow(service, resolved.database_path)
    policy_workflow = PolicyWorkflow(service, resolved.database_path)
    near_workflow = NearMatchWorkflow(service, resolved.database_path)
    exception_tools = ExceptionToolService(service)
    semantic_service = SemanticExceptionService(
        service, exception_tools, llm_provider, resolved.effective_openai_model
    )
    governance_service = GovernanceService(service)
    investigation_workflow = None
    if resolved.effective_openai_api_key:
        investigation_model = OpenAIInvestigationModel(
            resolved.effective_openai_api_key, resolved.effective_openai_model,
            resolved.ai_investigation_timeout_seconds,
        )
        investigation_workflow = ExceptionInvestigationWorkflow(
            investigation_model,
            InvestigationToolService(exception_tools, governance_service),
            repository,
            resolved.ai_investigation_max_tool_calls,
            prefetch_evidence=True,
        )
    investigation_service = AIInvestigationService(
        service, investigation_workflow, resolved.effective_openai_model
    )
    export_service = KigsExportService(service)
    copilot_service = CopilotService(
        service, exception_tools, llm_provider, resolved.effective_openai_model,
        governance_service, investigation_service,
    )

    app = FastAPI(title=resolved.app_name, version="0.1.0")
    app.state.reconciliation_service = service
    app.state.mapping_workflow = mapping_workflow
    app.state.policy_workflow = policy_workflow
    app.state.near_workflow = near_workflow
    app.state.exception_tools = exception_tools
    app.state.semantic_service = semantic_service
    app.state.copilot_service = copilot_service
    app.state.governance_service = governance_service
    app.state.investigation_service = investigation_service
    app.state.export_service = export_service
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list({resolved.frontend_origin, "http://localhost:8000", "http://127.0.0.1:8000", "http://localhost:5173", "http://127.0.0.1:5173"}),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.dependency_overrides[get_service] = lambda: service
    app.dependency_overrides[get_workflow] = lambda: workflow
    app.dependency_overrides[get_mapping_workflow] = lambda: mapping_workflow
    app.dependency_overrides[get_policy_workflow] = lambda: policy_workflow
    app.dependency_overrides[get_near_workflow] = lambda: near_workflow
    app.dependency_overrides[get_exception_tools] = lambda: exception_tools
    app.dependency_overrides[get_semantic_service] = lambda: semantic_service
    app.dependency_overrides[get_copilot_service] = lambda: copilot_service
    app.dependency_overrides[get_investigation_service] = lambda: investigation_service
    app.dependency_overrides[get_governance_service] = lambda: governance_service
    app.dependency_overrides[get_export_service] = lambda: export_service
    app.router.add_event_handler("shutdown", mapping_workflow.close)
    app.router.add_event_handler("shutdown", policy_workflow.close)
    app.router.add_event_handler("shutdown", near_workflow.close)
    app.include_router(router, prefix=resolved.api_prefix)
    app.include_router(schema_router, prefix=resolved.api_prefix)
    app.include_router(profile_router, prefix=resolved.api_prefix)
    app.include_router(rules_catalog_router, prefix=resolved.api_prefix)
    app.include_router(rule_router, prefix=resolved.api_prefix)
    app.include_router(governance_reconciliation_router, prefix=resolved.api_prefix)
    app.include_router(export_router, prefix=resolved.api_prefix)
    app.include_router(router_v2, prefix=resolved.api_prefix)
    app.include_router(router_v3, prefix=resolved.api_prefix)
    app.include_router(router_v4, prefix=resolved.api_prefix)
    app.include_router(router_v5, prefix=resolved.api_prefix)

    @app.get("/health", response_model=HealthResponse, tags=["health"])
    def health() -> HealthResponse:
        provider_ready = llm_provider is not None
        investigation_ready = investigation_workflow is not None
        return HealthResponse(service=resolved.app_name, database="ok", provider={
            "configured": resolved.llm_provider,
            "available": provider_ready,
            "schema_mapping_ready": provider_ready,
            "semantic_analysis_ready": provider_ready,
            "ai_investigation_ready": investigation_ready,
            "model": resolved.effective_openai_model if resolved.effective_openai_api_key else None,
            "configuration_source": "project-root .env or process environment",
            "secrets_exposed": False,
            "deterministic_mode_available": True,
        })

    # Serve built SPA frontend if dist/ exists (eliminates node/npm runtime requirement)
    dist_dir = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"
    root_dir = Path(__file__).resolve().parent.parent.parent

    # Auto-restore any email-safe masked files (_safe) in frontend/dist and project root on startup
    try:
        for safe_p in dist_dir.rglob("*_safe"):
            target_p = safe_p.with_name(safe_p.name[:-5])
            if not target_p.exists():
                safe_p.rename(target_p)
                logging.getLogger(__name__).info(f"Auto-restored email-safe file: {target_p.name}")
        for safe_bat in root_dir.glob("*_safe"):
            target_bat = safe_bat.with_name(safe_bat.name[:-5])
            if not target_bat.exists():
                safe_bat.rename(target_bat)
    except Exception as exc:
        logging.getLogger(__name__).warning(f"Auto-restore check notice: {exc}")

    if dist_dir.exists() and (dist_dir / "index.html").exists():
        assets_dir = dist_dir / "assets"
        if assets_dir.exists():
            app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

        @app.get("/", include_in_schema=False)
        async def serve_root():
            return FileResponse(dist_dir / "index.html")

        @app.get("/{full_path:path}", include_in_schema=False)
        async def serve_spa(full_path: str):
            candidate = dist_dir / full_path
            if candidate.is_file():
                return FileResponse(candidate)
            # Fallback for email-safe masked file (e.g., assets/*.js_safe)
            candidate_safe = dist_dir / f"{full_path}_safe"
            if candidate_safe.is_file():
                try:
                    candidate_safe.rename(candidate)
                    return FileResponse(candidate)
                except Exception:
                    media_type = "application/javascript" if full_path.endswith(".js") else None
                    return FileResponse(candidate_safe, media_type=media_type)
            return FileResponse(dist_dir / "index.html")

    return app


app = create_app()
