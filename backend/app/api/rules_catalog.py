from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.governance import get_governance_service
from app.domain.models import (
    ActionAuthority,
    AIRuleCompileRequest,
    ExecutionStageInfo,
    ReusableRuleVersion,
    RuleAction,
    RuleCatalogItem,
    RuleCatalogResponse,
    RuleCatalogSummary,
    RuleCondition,
    RuleDraftCreateRequest,
    RuleDraftUpdateRequest,
    RuleHistoryResponse,
    RuleProvenance,
    RuleProvenanceType,
    RuleStatus,
    RuleType,
    RuleValidationIssue,
    RuleValidationResult,
    RuleVersionDetailResponse,
)
from app.services.governance import (
    LOCKED_GUARDRAIL_IDS,
    GovernanceError,
    GovernanceService,
    LockedGuardrailError,
)

logger = logging.getLogger(__name__)

rules_catalog_router = APIRouter(prefix="/rules", tags=["rules-catalog"])


def _find_inventory_file() -> Path:
    current = Path(__file__).resolve().parent
    for _ in range(5):
        candidate = current / "docs" / "rules_inventory.json"
        if candidate.exists():
            return candidate
        current = current.parent
    raise FileNotFoundError("docs/rules_inventory.json could not be located")


def _human_friendly_if(rule_id: str, raw_if: str) -> str:
    friendly_map = {
        "EXACT-D001": "Supplier GSTIN, Invoice Number, Invoice Date, Invoice Type, Taxable Value, GST Rate, IGST, CGST, SGST, and Cess are 100% identical after standard string case & decimal quantization.",
        "EXACT-D002": "Monetary field value is provided in financial record.",
        "TOL-D001": "Absolute variance in Taxable Value between Government and PR invoice is <= confirmed policy limit (Default: ₹10.00).",
        "TOL-D002": "Difference in invoice document dates is <= confirmed policy limit (Default: 5 days).",
        "TOL-D003": "Government record has multiple PR candidates OR PR candidate is claimed by multiple Government records during tolerance matching.",
        "NEAR-D001": "Same GSTIN, same invoice type, invoice date diff <= 30 days, taxable value diff <= max(₹20,000, 50%), and invoice similarity >= 0.55.",
        "NEAR-D002": "Candidate pair satisfies candidate generation search window filters.",
        "NEAR-D003": "Multiple candidates score >= 0.92 OR gap between top candidate and second candidate is <= 0.05.",
        "NEAR-D004": "Candidate PR record ranks #1 for the Government record AND reciprocally the Government record ranks #1 for that PR record.",
        "NEAR-D005": "Normalized invoice numbers match exactly but taxable variance > ₹10.00 or tax variance > ₹2.00.",
        "NEAR-D006": "Match score >= 0.92, taxable variance <= ₹10.00, tax variance <= ₹2.00, and reciprocal best match.",
        "GOV-D001": "Learned or reusable rule has action authority PROPOSE_ONLY.",
        "GOV-D002": "Observed >= 5 human-approved near matches with >= 80% human acceptance ratio for a consistent pattern.",
        "GOV-D003": "Draft rule collides with known past human rejections or causes duplicate PR record consumption.",
        "R-001": "Supplier GSTIN matches exactly AND invoice numbers become identical after separator normalization (removing slashes, dashes, dots).",
        "R-002": "Supplier GSTIN matches exactly AND invoice numbers become identical after separator normalization.",
        "SAFE-D001": "Record ID is present in consumed matches set.",
        "SAFE-D002": "Any governance, matching, or export state transition occurs.",
        "SAFE-D003": "Export cell string starts with '=', '+', '@', or '-'.",
        "SAFE-D004": "Policy contains rules for mandatory identifier fields (gstin, document_number).",
        "DATA-D001": "Column header matches known canonical alias or lexical similarity >= 0.84.",
        "DATA-D002": "Multiple source columns are proposed for the same canonical field.",
        "EXCEPT-D001": "Government invoice has no candidate PR pair after all matching stages.",
        "EXCEPT-D002": "Purchase Register invoice has no candidate GST pair after all matching stages.",
        "EXEC-D001": "Executing TARS reconciliation workflow pipeline.",
    }
    return friendly_map.get(rule_id, raw_if)


def _human_friendly_then(rule_id: str, raw_then: str) -> str:
    friendly_map = {
        "EXACT-D001": "Mark pair as EXACT match and consume both records from subsequent matching stages.",
        "EXACT-D002": "Quantize value to Decimal('0.01') using standard ROUND_HALF_UP rounding.",
        "TOL-D001": "Satisfy Taxable Amount Tolerance requirement for candidate matching.",
        "TOL-D002": "Satisfy Invoice Date Tolerance requirement for candidate matching.",
        "TOL-D003": "Emit MatchConflict and require human review; do NOT auto-match.",
        "NEAR-D001": "Pass record pair to 6-feature scoring engine.",
        "NEAR-D002": "Calculate 6-feature weighted composite score: 35% Invoice + 25% Taxable Value + 20% Tax Amounts + 10% Date + 5% Rate + 5% Type.",
        "NEAR-D003": "Classify Government record as AMBIGUOUS and force human review.",
        "NEAR-D004": "Mark candidate pair as reciprocal best match.",
        "NEAR-D005": "Classify record as MATERIAL_MISMATCH exception.",
        "NEAR-D006": "Mark candidate pair as eligible for fast-track human bulk approval.",
        "GOV-D001": "Set automatic reconciliations = 0; create candidate proposals requiring human confirmation.",
        "GOV-D002": "Generate a governed PatternSuggestion for client profile review.",
        "GOV-D003": "Set activation_blocked = True and reject rule activation.",
        "R-001": "Propose Near Match (Authority: PROPOSE_ONLY — Performs 0 automatic reconciliations without human confirmation).",
        "R-002": "Propose Near Match (Draft Status — Currently inactive).",
        "SAFE-D001": "Block re-pairing to prevent double-counting an invoice.",
        "SAFE-D002": "Insert append-only immutable record into DB audit_events.",
        "SAFE-D003": "Neutralize formula injection by prefixing cell string with a single quote (').",
        "SAFE-D004": "Enforce operator EXACT and required = True.",
        "DATA-D001": "Propose canonical field mapping with confidence score.",
        "DATA-D002": "Select candidate with highest selection score and clear lower-scoring mapping.",
        "EXCEPT-D001": "Classify into GST_ONLY exception queue.",
        "EXCEPT-D002": "Classify into PR_ONLY exception queue.",
        "EXEC-D001": "Enforce strict stage prerequisite dependencies.",
    }
    return friendly_map.get(rule_id, raw_then)


STAGES_DEFINITION = [
    {
        "stage_id": "UPLOAD_PROFILING",
        "stage_name": "1. File Upload & Profiling",
        "description": "Workbook ingestion, structure analysis, and sheet profiling.",
        "execution_order": 1,
        "reorderability": "FIXED_ORDER",
        "rule_ids": ["EXEC-D001"],
    },
    {
        "stage_id": "SCHEMA_MAPPING",
        "stage_name": "2. Schema Mapping Proposal",
        "description": "Deterministic alias matching and canonical column arbitration.",
        "execution_order": 2,
        "reorderability": "FIXED_ORDER",
        "rule_ids": ["DATA-D001", "DATA-D002"],
    },
    {
        "stage_id": "SCHEMA_CONFIRMATION",
        "stage_name": "3. Human Schema Confirmation",
        "description": "User reviews and locks column mapping assignments.",
        "execution_order": 3,
        "reorderability": "FIXED_ORDER",
        "rule_ids": [],
    },
    {
        "stage_id": "POLICY_CONFIRMATION",
        "stage_name": "4. Policy Proposal & Confirmation",
        "description": "Validation of mandatory identity fields and tolerance limits.",
        "execution_order": 4,
        "reorderability": "FIXED_ORDER",
        "rule_ids": ["SAFE-D004"],
    },
    {
        "stage_id": "EXACT_MATCHING",
        "stage_name": "5. Stage 1: Exact Matching Engine",
        "description": "10-field exact identity matching and monetary quantization.",
        "execution_order": 5,
        "reorderability": "FIXED_ORDER",
        "rule_ids": ["EXACT-D001", "EXACT-D002"],
    },
    {
        "stage_id": "TOLERANCE_MATCHING",
        "stage_name": "6. Stage 2: Tolerance Matching Engine",
        "description": "Policy-based taxable amount and date tolerance evaluation with reciprocal uniqueness check.",
        "execution_order": 6,
        "reorderability": "FIXED_ORDER",
        "rule_ids": ["TOL-D001", "TOL-D002", "TOL-D003"],
    },
    {
        "stage_id": "NEAR_CANDIDATE_GEN",
        "stage_name": "7. Stage 3: Near Match Candidate Generation",
        "description": "Search window filtering over unmatched records.",
        "execution_order": 7,
        "reorderability": "FIXED_ORDER",
        "rule_ids": ["NEAR-D001"],
    },
    {
        "stage_id": "NEAR_SCORING",
        "stage_name": "8. Stage 4: Feature Scoring & Ranking",
        "description": "6-feature weighted composite scoring formula.",
        "execution_order": 8,
        "reorderability": "ORDER_WITHIN_STAGE",
        "rule_ids": ["NEAR-D002"],
    },
    {
        "stage_id": "AMBIGUITY_SAFETY",
        "stage_name": "9. Stage 5: Ambiguity & Reciprocal Best Evaluation",
        "description": "Score gap ambiguity detection, reciprocal best verification, and single-consumption guard.",
        "execution_order": 9,
        "reorderability": "FIXED_ORDER",
        "rule_ids": ["NEAR-D003", "NEAR-D004", "SAFE-D001"],
    },
    {
        "stage_id": "HUMAN_REVIEW",
        "stage_name": "10. Stage 6: Human Review & Bulk Approval",
        "description": "Human decision review and high-confidence bulk approval gate.",
        "execution_order": 10,
        "reorderability": "FIXED_ORDER",
        "rule_ids": ["NEAR-D006"],
    },
    {
        "stage_id": "GOVERNANCE_REVIEW",
        "stage_name": "11. Stage 7: Governance & Pattern Learning",
        "description": "Execution of active client profile learned rules with PROPOSE_ONLY authority.",
        "execution_order": 11,
        "reorderability": "ORDER_WITHIN_STAGE",
        "rule_ids": ["GOV-D001", "GOV-D002", "GOV-D003", "R-001", "R-002"],
    },
    {
        "stage_id": "EXCEPTION_CLASSIFICATION",
        "stage_name": "12. Stage 8: Exception Classification",
        "description": "Classification into Material Mismatch, GST Only, and PR Only queues.",
        "execution_order": 12,
        "reorderability": "FIXED_ORDER",
        "rule_ids": ["NEAR-D005", "EXCEPT-D001", "EXCEPT-D002"],
    },
    {
        "stage_id": "EXPORT_GENERATION",
        "stage_name": "13. Stage 9: Audit & KIGS Export Generation",
        "description": "Audit logging and 5-sheet KIGS Excel workbook export.",
        "execution_order": 13,
        "reorderability": "FIXED_ORDER",
        "rule_ids": ["SAFE-D002", "SAFE-D003"],
    },
]


@rules_catalog_router.get("/catalog", response_model=RuleCatalogResponse)
def get_rule_catalog(
    governance_service: Annotated[GovernanceService, Depends(get_governance_service)],
) -> RuleCatalogResponse:
    try:
        inventory_path = _find_inventory_file()
        with open(inventory_path, "r", encoding="utf-8") as f:
            raw_discovery = json.load(f)
    except Exception as exc:
        logger.error(f"Failed to load rules inventory: {exc}")
        raise HTTPException(status_code=500, detail="Failed to load rule inventory discovery metadata") from exc

    # Load live persisted rules from authoritative database
    try:
        db_rules = {r.rule_id: r for r in governance_service.list_rules()}
    except Exception as exc:
        logger.warning(f"Could not load DB rules: {exc}")
        db_rules = {}

    catalog_items: list[RuleCatalogItem] = []

    for item in raw_discovery:
        rule_id = item["rule_id"]
        currently_toggleable = item.get("currently_toggleable", False)
        toggle_safety = item.get("toggle_safety", "MANDATORY_SAFETY_RULE")

        # Determine configurable vs locked
        configurable = currently_toggleable and (toggle_safety in ("SAFE_TO_TOGGLE", "CONDITIONALLY_TOGGLEABLE"))
        locked = not configurable

        source_of_truth = item.get("source_of_truth", "HARDCODED_PYTHON")
        status = "ACTIVE" if item.get("currently_active", True) else "INACTIVE"
        version: int | str = 1
        authority = item.get("authority", "SYSTEM")
        approval_meta = None
        provenance_meta = None
        effectiveness_meta = None
        conditions_data = None
        action_data = None

        # Check if live database has an authoritative persisted version
        if rule_id in db_rules:
            db_rule = db_rules[rule_id]
            source_of_truth = "DATABASE"
            status = db_rule.status.value if hasattr(db_rule.status, "value") else str(db_rule.status)
            version = db_rule.version
            authority = db_rule.action_authority.value if hasattr(db_rule.action_authority, "value") else str(db_rule.action_authority)
            if db_rule.approval:
                approval_meta = db_rule.approval.model_dump()
            if db_rule.provenance:
                provenance_meta = db_rule.provenance.model_dump()
            if db_rule.effectiveness:
                effectiveness_meta = db_rule.effectiveness.model_dump()
            if db_rule.conditions:
                conditions_data = [c.model_dump() for c in db_rule.conditions]
            if db_rule.action:
                action_data = db_rule.action.model_dump()

        raw_if = item.get("if_condition", "")
        raw_then = item.get("then_result", "")
        h_if = _human_friendly_if(rule_id, raw_if)
        h_then = _human_friendly_then(rule_id, raw_then)

        catalog_item = RuleCatalogItem(
            rule_id=rule_id,
            name=item.get("current_name", rule_id),
            suggested_human_friendly_name=item.get("suggested_human_friendly_name", item.get("current_name", rule_id)),
            category=item.get("category", "BUSINESS_RULE"),
            description=item.get("description", ""),
            stage=item.get("stage", "UNKNOWN"),
            execution_order=item.get("current_execution_order", 99),
            enabled=item.get("currently_active", True) if rule_id not in db_rules else (status == "ACTIVE"),
            configurable=configurable,
            locked=locked,
            if_condition=raw_if,
            then_result=raw_then,
            human_friendly_if=h_if,
            human_friendly_then=h_then,
            authority=authority,
            source_of_truth=source_of_truth,
            version=version,
            status=status,
            parameters=item.get("thresholds_parameters"),
            dependencies=item.get("depends_on", []),
            conflicts_with=item.get("conflicts_with", []),
            side_effects=item.get("side_effects"),
            audit_event_produced=item.get("audit_event_produced", True),
            safe_to_disable=item.get("safe_to_disable", False),
            toggle_safety=toggle_safety,
            execution_sequencing=item.get("execution_sequencing", "FIXED_ORDER"),
            file_function_db_location=item.get("file_function_db_location", ""),
            notes=item.get("notes"),
            approval=approval_meta,
            provenance=provenance_meta,
            effectiveness=effectiveness_meta,
            conditions=conditions_data,
            action=action_data,
        )
        catalog_items.append(catalog_item)

    # Include database-persisted rules that were not present in raw_discovery inventory
    inventory_rule_ids = {item["rule_id"] for item in raw_discovery}
    for rule_id, db_rule in db_rules.items():
        if rule_id not in inventory_rule_ids:
            cond_str_list = []
            if db_rule.conditions:
                for c in db_rule.conditions:
                    if c.operator == "EXACT":
                        cond_str_list.append(f"{c.field} matches exactly")
                    elif c.operator == "NORMALIZED_EXACT":
                        cond_str_list.append(f"{c.field} matches after normalization")
                    elif c.operator == "ABSOLUTE_TOLERANCE":
                        cond_str_list.append(f"{c.field} variance <= ₹{c.value}")
                    elif c.operator == "DATE_TOLERANCE":
                        cond_str_list.append(f"{c.field} drift <= {c.value} days")
                    else:
                        cond_str_list.append(f"{c.field} {c.operator} {c.value or ''}")
            h_if = f"IF {' AND '.join(cond_str_list)}" if cond_str_list else (db_rule.description or db_rule.name)

            action_type = db_rule.action.type if db_rule.action else "PROPOSE_NEAR_MATCH"
            h_then = f"THEN {action_type.replace('_', ' ')} (Authority: {db_rule.action_authority.value if hasattr(db_rule.action_authority, 'value') else db_rule.action_authority})"

            status_str = db_rule.status.value if hasattr(db_rule.status, "value") else str(db_rule.status)
            authority_str = db_rule.action_authority.value if hasattr(db_rule.action_authority, "value") else str(db_rule.action_authority)
            rule_type_val = db_rule.rule_type.value if hasattr(db_rule.rule_type, "value") else str(db_rule.rule_type)

            db_catalog_item = RuleCatalogItem(
                rule_id=rule_id,
                name=db_rule.name,
                suggested_human_friendly_name=db_rule.name,
                category="LEARNED_RULE" if rule_type_val == "LEARNED" else "MATCHING_RULE",
                description=db_rule.description or f"AI-compiled rule {rule_id}",
                stage="GOVERNANCE_REVIEW",
                execution_order=11,
                enabled=(status_str == "ACTIVE"),
                configurable=True,
                locked=False,
                if_condition=h_if,
                then_result=h_then,
                human_friendly_if=h_if,
                human_friendly_then=h_then,
                authority=authority_str,
                source_of_truth="DATABASE",
                version=db_rule.version,
                status=status_str,
                parameters=None,
                dependencies=[],
                conflicts_with=[],
                side_effects=None,
                audit_event_produced=True,
                safe_to_disable=True,
                toggle_safety="SAFE_TO_TOGGLE",
                execution_sequencing="ORDER_WITHIN_STAGE",
                file_function_db_location="SQLite table: reusable_rules",
                notes="AI-compiled DB rule",
                approval=db_rule.approval.model_dump() if db_rule.approval else None,
                provenance=db_rule.provenance.model_dump() if db_rule.provenance else None,
                effectiveness=db_rule.effectiveness.model_dump() if db_rule.effectiveness else None,
                conditions=[c.model_dump() for c in db_rule.conditions] if db_rule.conditions else None,
                action=db_rule.action.model_dump() if db_rule.action else None,
            )
            catalog_items.append(db_catalog_item)

    # Sort rules by execution_order
    catalog_items.sort(key=lambda r: r.execution_order)

    # Dynamically compute summary statistics from catalog items
    total_rules = len(catalog_items)
    configurable_count = sum(1 for r in catalog_items if r.configurable)
    locked_count = sum(1 for r in catalog_items if r.locked)
    active_count = sum(1 for r in catalog_items if r.status in ("ACTIVE", "SYSTEM", "AUTOMATIC", "SYSTEM_ENFORCED"))
    learned_count = sum(1 for r in catalog_items if r.category == "LEARNED_RULE")

    summary = RuleCatalogSummary(
        total_rules=total_rules,
        configurable_count=configurable_count,
        locked_count=locked_count,
        active_count=active_count,
        learned_count=learned_count,
    )

    stage_map = {s["stage_id"]: list(s["rule_ids"]) for s in STAGES_DEFINITION}
    for item in catalog_items:
        stg = item.stage
        if stg in stage_map and item.rule_id not in stage_map[stg]:
            stage_map[stg].append(item.rule_id)

    stages = [
        ExecutionStageInfo(
            stage_id=s["stage_id"],
            stage_name=s["stage_name"],
            description=s["description"],
            execution_order=s["execution_order"],
            reorderability=s["reorderability"],
            rule_ids=stage_map.get(s["stage_id"], s["rule_ids"]),
        )
        for s in STAGES_DEFINITION
    ]

    from app.config import get_settings
    from app.providers.factory import create_llm_provider
    settings = get_settings()
    llm_model = settings.effective_openai_model
    llm_provider = settings.llm_provider
    llm_connected = False
    try:
        provider = create_llm_provider(settings)
        llm_connected = provider.healthcheck()
    except Exception:
        llm_connected = False

    return RuleCatalogResponse(
        rules=catalog_items,
        summary=summary,
        stages=stages,
        llm_connected=llm_connected,
        llm_model=llm_model,
        llm_provider=llm_provider,
    )


@rules_catalog_router.get("/{rule_id}/history", response_model=RuleHistoryResponse)
def get_rule_history(
    rule_id: str,
    governance_service: Annotated[GovernanceService, Depends(get_governance_service)],
) -> RuleHistoryResponse:
    try:
        db_history = governance_service.history(rule_id)
    except Exception as exc:
        logger.warning(f"Error fetching rule history for {rule_id}: {exc}")
        db_history = []

    try:
        inventory_path = _find_inventory_file()
        with open(inventory_path, "r", encoding="utf-8") as f:
            inventory = json.load(f)
        cat_rule = next((r for r in inventory if r["rule_id"] == rule_id), None)
    except Exception:
        cat_rule = None

    if not db_history and not cat_rule:
        raise HTTPException(status_code=404, detail=f"Rule '{rule_id}' not found in catalog or history persistence.")

    is_locked = rule_id in LOCKED_GUARDRAIL_IDS
    is_configurable = not is_locked if cat_rule else True
    rule_name = db_history[0].name if db_history else (cat_rule.get("current_name") if cat_rule else rule_id)

    versions = db_history
    if not versions and cat_rule:
        virtual_rule = ReusableRuleVersion(
            rule_id=rule_id,
            version=1,
            name=cat_rule.get("current_name", rule_id),
            description=cat_rule.get("description", ""),
            rule_type=RuleType.DETERMINISTIC,
            status=RuleStatus.ACTIVE if cat_rule.get("currently_active", True) else RuleStatus.DISABLED,
            conditions=[RuleCondition(field="document_number", operator="EXACT")],
            action=RuleAction(type="PROPOSE_NEAR_MATCH"),
            action_authority=ActionAuthority.PROPOSE_ONLY if cat_rule.get("authority") == "PROPOSE_ONLY" else ActionAuthority.AUTO_EXECUTE,
            governance_tier="LOCKED_SYSTEM_GUARDRAIL" if is_locked else "CONFIGURABLE_BUSINESS_RULE",
            provenance=RuleProvenance(type=RuleProvenanceType.MIGRATED, summary=cat_rule.get("description", "Discovered system rule.")),
        )
        versions = [virtual_rule]

    cur_ver = versions[0].version if versions else 1
    draft_ver = next((v.version for v in versions if v.status == RuleStatus.DRAFT), None)
    active_ver = next((v.version for v in versions if v.status == RuleStatus.ACTIVE), None)

    return RuleHistoryResponse(
        rule_id=rule_id,
        name=rule_name,
        configurable=is_configurable,
        locked=is_locked,
        versions=versions,
        current_version=cur_ver,
        draft_version=draft_ver,
        active_version=active_ver,
    )


@rules_catalog_router.get("/{rule_id}/versions/{version}", response_model=RuleVersionDetailResponse)
def get_rule_version_detail(
    rule_id: str,
    version: int,
    governance_service: Annotated[GovernanceService, Depends(get_governance_service)],
) -> RuleVersionDetailResponse:
    rule = governance_service.repository.get_rule(rule_id, version)
    try:
        history = governance_service.history(rule_id)
    except Exception:
        history = []

    if not rule:
        if version == 1:
            try:
                hist_resp = get_rule_history(rule_id, governance_service)
                if hist_resp.versions:
                    rule = hist_resp.versions[0]
            except Exception:
                pass

    if not rule:
        raise HTTPException(status_code=404, detail=f"Version {version} of rule '{rule_id}' not found.")

    validation = governance_service.validate_rule_definition(
        rule_id=rule.rule_id,
        name=rule.name,
        description=rule.description,
        conditions=rule.conditions,
        action=rule.action,
        version=rule.version,
    )

    is_latest = history[0].version == rule.version if history else True
    is_editable_draft = (rule.status == RuleStatus.DRAFT) and (rule_id not in LOCKED_GUARDRAIL_IDS)

    return RuleVersionDetailResponse(
        rule=rule,
        validation=validation,
        history_count=len(history) if history else 1,
        is_latest=is_latest,
        is_editable_draft=is_editable_draft,
    )


@rules_catalog_router.post("/compile-ai", response_model=ReusableRuleVersion, status_code=201)
def compile_rule_with_ai(
    request: AIRuleCompileRequest,
    governance_service: Annotated[GovernanceService, Depends(get_governance_service)],
) -> ReusableRuleVersion:
    try:
        return governance_service.compile_rule_from_ai(
            prompt=request.prompt,
            reconciliation_id=request.reconciliation_id,
            client_profile_id=request.client_profile_id,
            actor=request.actor,
        )
    except GovernanceError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.error(f"Failed to compile AI rule: {exc}")
        raise HTTPException(status_code=500, detail=f"Rule compilation failed: {str(exc)}")


@rules_catalog_router.post("/draft", response_model=ReusableRuleVersion, status_code=201)
def create_rule_draft(
    request: RuleDraftCreateRequest,
    governance_service: Annotated[GovernanceService, Depends(get_governance_service)],
) -> ReusableRuleVersion:
    try:
        return governance_service.create_rule_draft(request)
    except LockedGuardrailError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    except GovernanceError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@rules_catalog_router.put("/draft/{rule_id}", response_model=ReusableRuleVersion)
def update_rule_draft(
    rule_id: str,
    request: RuleDraftUpdateRequest,
    governance_service: Annotated[GovernanceService, Depends(get_governance_service)],
    version: int | None = None,
) -> ReusableRuleVersion:
    try:
        return governance_service.update_rule_draft(rule_id, request, version=version)
    except LockedGuardrailError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    except GovernanceError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@rules_catalog_router.post("/draft/{rule_id}/validate", response_model=RuleValidationResult)
def validate_rule_draft(
    rule_id: str,
    request: RuleDraftUpdateRequest,
    governance_service: Annotated[GovernanceService, Depends(get_governance_service)],
    version: int | None = None,
) -> RuleValidationResult:
    if rule_id in LOCKED_GUARDRAIL_IDS:
        return RuleValidationResult(
            valid=False,
            rule_id=rule_id,
            version=version,
            issues=[RuleValidationIssue(code="LOCKED_GUARDRAIL", message=f"Rule '{rule_id}' is a locked system guardrail and cannot be modified.", severity="error")],
        )

    existing = governance_service.repository.get_rule(rule_id, version)
    name = request.name if request.name is not None else (existing.name if existing else rule_id)
    desc = request.description if request.description is not None else (existing.description if existing else "Draft rule")
    conds = request.conditions if request.conditions is not None else (existing.conditions if existing else [RuleCondition(field="document_number", operator="EXACT")])
    action = request.action if request.action is not None else (existing.action if existing else RuleAction(type="PROPOSE_NEAR_MATCH"))

    return governance_service.validate_rule_definition(
        rule_id=rule_id,
        name=name,
        description=desc,
        conditions=conds,
        action=action,
        version=version or (existing.version if existing else 1),
    )


@rules_catalog_router.delete("/{rule_id}")
def delete_rule(
    rule_id: str,
    governance_service: Annotated[GovernanceService, Depends(get_governance_service)],
) -> dict[str, Any]:
    if rule_id in LOCKED_GUARDRAIL_IDS:
        raise HTTPException(
            status_code=403,
            detail=f"Rule '{rule_id}' is a mandatory system guardrail and cannot be deleted.",
        )
    try:
        governance_service.delete_rule(rule_id)
        return {
            "success": True,
            "message": f"Rule '{rule_id}' has been permanently deleted from backend database storage.",
            "rule_id": rule_id,
        }
    except LockedGuardrailError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    except Exception as exc:
        logger.error(f"Failed to delete rule {rule_id}: {exc}")
        raise HTTPException(status_code=500, detail=f"Failed to delete rule {rule_id}: {str(exc)}")


class BulkDeleteRulesRequest(BaseModel):
    rule_ids: list[str]


@rules_catalog_router.post("/bulk-delete")
def bulk_delete_rules(
    request: BulkDeleteRulesRequest,
    governance_service: Annotated[GovernanceService, Depends(get_governance_service)],
) -> dict[str, Any]:
    locked_selected = [rid for rid in request.rule_ids if rid in LOCKED_GUARDRAIL_IDS]
    if locked_selected:
        raise HTTPException(
            status_code=403,
            detail=f"Cannot delete mandatory system guardrails: {', '.join(locked_selected)}",
        )
    deleted: list[str] = []
    for rid in request.rule_ids:
        try:
            governance_service.delete_rule(rid)
            deleted.append(rid)
        except Exception as exc:
            logger.warning(f"Error deleting rule {rid} in bulk operation: {exc}")
    return {"success": True, "deleted_count": len(deleted), "rule_ids": deleted}
