from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query

from app.domain.models import (
    ClientProfile, PatternSuggestion, ProfileCompatibility, ProfileCreateRequest,
    ReconciliationSession, ReusableRuleVersion, RuleCreateRequest, RuleDecisionRequest,
    RuleSimulation,
)
from app.services.governance import GovernanceError, GovernanceService
from app.services.reconciliation import ReconciliationNotReadyError

profile_router = APIRouter(prefix="/client-profiles", tags=["client-profiles"])
rule_router = APIRouter(prefix="/rules", tags=["rules"])
governance_reconciliation_router = APIRouter(prefix="/reconciliations", tags=["governance"])


def get_governance_service() -> GovernanceService:
    raise RuntimeError("Application dependency not configured")


def _call(action):
    try:
        return action()
    except GovernanceError as exc:
        raise HTTPException(status_code=409, detail={"message": str(exc)}) from exc
    except ReconciliationNotReadyError as exc:
        raise HTTPException(status_code=409, detail={"message": str(exc)}) from exc


@profile_router.get("", response_model=list[ClientProfile])
def list_profiles(service: Annotated[GovernanceService, Depends(get_governance_service)]):
    return service.list_profiles()


@profile_router.post("/from-reconciliation/{reconciliation_id}", response_model=ClientProfile)
def create_profile(reconciliation_id: UUID, request: ProfileCreateRequest,
                   service: Annotated[GovernanceService, Depends(get_governance_service)]):
    return _call(lambda: service.create_profile(reconciliation_id, request))


@profile_router.get("/{profile_id}", response_model=ClientProfile)
def get_profile(profile_id: UUID, service: Annotated[GovernanceService, Depends(get_governance_service)]):
    return _call(lambda: service.get_profile(profile_id))


@profile_router.post("/{profile_id}/reconciliations", response_model=ReconciliationSession)
def new_from_profile(profile_id: UUID, service: Annotated[GovernanceService, Depends(get_governance_service)]):
    return _call(lambda: service.create_session_from_profile(profile_id))


@profile_router.post("/{profile_id}/reconciliations/{reconciliation_id}/compatibility", response_model=ProfileCompatibility)
def compatibility(profile_id: UUID, reconciliation_id: UUID,
                  service: Annotated[GovernanceService, Depends(get_governance_service)],
                  apply_if_compatible: bool = Query(False)):
    return _call(lambda: service.compatibility(profile_id, reconciliation_id, apply_if_compatible))


@profile_router.get("/{profile_id}/rules", response_model=list[ReusableRuleVersion])
def profile_rules(profile_id: UUID, service: Annotated[GovernanceService, Depends(get_governance_service)]):
    return service.list_rules(profile_id)


@profile_router.post("/{profile_id}/rules", response_model=ReusableRuleVersion)
def create_rule(profile_id: UUID, request: RuleCreateRequest,
                service: Annotated[GovernanceService, Depends(get_governance_service)]):
    return _call(lambda: service.create_draft(profile_id, request))


@rule_router.get("", response_model=list[ReusableRuleVersion])
def list_rules(service: Annotated[GovernanceService, Depends(get_governance_service)]):
    return service.list_rules()


@rule_router.get("/{rule_id}", response_model=ReusableRuleVersion)
def get_rule(rule_id: str, service: Annotated[GovernanceService, Depends(get_governance_service)]):
    return _call(lambda: service.get_rule(rule_id))


@rule_router.get("/{rule_id}/history", response_model=list[ReusableRuleVersion])
def history(rule_id: str, service: Annotated[GovernanceService, Depends(get_governance_service)]):
    return service.history(rule_id)


@rule_router.post("/{rule_id}/simulate", response_model=RuleSimulation)
def simulate(rule_id: str, service: Annotated[GovernanceService, Depends(get_governance_service)],
             reconciliation_id: UUID | None = None):
    return _call(lambda: service.simulate(rule_id, reconciliation_id))


@rule_router.post("/{rule_id}/approve", response_model=ReusableRuleVersion)
def approve(rule_id: str, request: RuleDecisionRequest,
            service: Annotated[GovernanceService, Depends(get_governance_service)]):
    return _call(lambda: service.approve(rule_id, request))


@rule_router.post("/{rule_id}/activate", response_model=ReusableRuleVersion)
def activate(rule_id: str, request: RuleDecisionRequest,
             service: Annotated[GovernanceService, Depends(get_governance_service)]):
    raise HTTPException(status_code=403, detail="Rule activation is not permitted in Phase 2A.")


@rule_router.post("/{rule_id}/disable", response_model=ReusableRuleVersion)
def disable(rule_id: str, request: RuleDecisionRequest,
            service: Annotated[GovernanceService, Depends(get_governance_service)]):
    return _call(lambda: service.disable(rule_id, request))


@rule_router.post("/{rule_id}/versions", response_model=ReusableRuleVersion)
def new_version(rule_id: str, request: RuleCreateRequest,
                service: Annotated[GovernanceService, Depends(get_governance_service)]):
    return _call(lambda: service.new_version(rule_id, request))


@governance_reconciliation_router.post("/{reconciliation_id}/patterns/detect", response_model=list[PatternSuggestion])
def detect(reconciliation_id: UUID, service: Annotated[GovernanceService, Depends(get_governance_service)]):
    return _call(lambda: service.detect_patterns(reconciliation_id))


@governance_reconciliation_router.get("/{reconciliation_id}/patterns", response_model=list[PatternSuggestion])
def patterns(reconciliation_id: UUID, service: Annotated[GovernanceService, Depends(get_governance_service)]):
    return service.repository.list_pattern_suggestions(reconciliation_id)  # type: ignore[attr-defined]


@governance_reconciliation_router.post("/{reconciliation_id}/patterns/{pattern_id}/dismiss", response_model=PatternSuggestion)
def dismiss_pattern(reconciliation_id: UUID, pattern_id: UUID,
                    service: Annotated[GovernanceService, Depends(get_governance_service)]):
    return _call(lambda: service.dismiss_pattern(reconciliation_id, pattern_id))


@governance_reconciliation_router.post("/{reconciliation_id}/patterns/{pattern_id}/create-rule", response_model=ReusableRuleVersion)
def pattern_rule(reconciliation_id: UUID, pattern_id: UUID, profile_id: UUID,
                 service: Annotated[GovernanceService, Depends(get_governance_service)]):
    return _call(lambda: service.create_rule_from_pattern(reconciliation_id, pattern_id, profile_id))
