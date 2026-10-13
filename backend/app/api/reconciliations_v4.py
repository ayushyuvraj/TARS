from __future__ import annotations

import datetime
import json
import logging
import threading
from collections.abc import AsyncGenerator
from pathlib import Path
from typing import Annotated, Any
from uuid import uuid4

import numpy as np
import pandas as pd
from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.config import Settings, get_settings
from app.services.audit_v2_service import (
    V2AuditStep,
    V2RunRecord,
    TokenUsageBreakdown,
    RunTokenConsumption,
    calculate_token_cost,
    audit_v2_service,
)
from app.services.direct_schema_correlator_v3 import (
    AgentThoughtV3,
    DirectColumnCorrelationV3,
    DirectCorrelationResultV3,
    DirectSchemaCorrelatorV3,
)
from app.services.matching_engine_v4 import (
    ReconciliationRecordItemV4,
    Rule4Item,
    Stage4ExecutionResponseV4,
    Stage4ResultsSummaryV4,
    WaterfallMatchingEngineV4,
    build_default_rules_v4,
)
from app.services.matching_engine_v2 import (
    AmbiguityCluster,
    AmbiguityCandidate,
    ScoreBreakdown,
    reclassify_ambiguity_candidate,
)
from app.services.matching_engine_v3 import (
    AmbiguityRecommendation,
    evaluate_ambiguity_recommendation,
    evaluate_target_category_policy,
)
from app.services.export_v2_service import (
    ActiveExportColumn,
    ConditionalFormattingRule,
    CustomExportRequest,
    ExportColumnDescriptor,
    ExportPreset,
    export_v2_service,
)

logger = logging.getLogger(__name__)

router_v4 = APIRouter(prefix="/reconciliations-v4", tags=["reconciliations-v4"])


class ReclassifyRecordRequestV4(BaseModel):
    target_bucket: str  # EXACT_MATCH, TOLERANCE_MATCH, NEAR_MATCH, GSTR_ONLY, PR_ONLY
    reviewer_note: str | None = None
    override_policy: bool = False


class ResolveAmbiguityRequestV4(BaseModel):
    cluster_id: str
    chosen_candidate_id: str | None = None
    action: str = "CHOOSE"  # CHOOSE, REJECT


PROJECT_ROOT = Path(__file__).resolve().parents[3]
CACHE_DIR_V4 = PROJECT_ROOT / "data" / "cache_v4"
CACHE_DIR_V4.mkdir(parents=True, exist_ok=True)
SAMPLE_RECON_MULTI_FILE = PROJECT_ROOT / "sample_data" / "TARS_KIGS_RECON_60000_Rows_Multi_Tranche_Scenarios.xlsx"
SAMPLE_RECON_LEGACY_FILE = PROJECT_ROOT / "sample_data" / "TARS_KIGS_RECON_20000_Rows_All_Scenarios.xlsx"
SAMPLE_RECON_FILE = SAMPLE_RECON_MULTI_FILE if SAMPLE_RECON_MULTI_FILE.exists() else SAMPLE_RECON_LEGACY_FILE
MASTER_RULES_V4_FILE = PROJECT_ROOT / "data" / "audit_v2" / "rules_v4_catalog.json"

_V4_SESSIONS: dict[str, dict[str, Any]] = {}
_V4_CACHE_EVENTS: dict[str, Any] = {}


# =========================================================================
# MODELS FOR V4
# =========================================================================

class ReconciliationV4SessionCreate(BaseModel):
    title: str = "Reconciliation 4.0 • Single Ledger Updated"
    client_name: str | None = "Enterprise Client"
    financial_year: str | None = "2026-27"


class ReconciliationV4Session(BaseModel):
    id: str
    recon_type: str = "v4"
    title: str
    status: str
    current_stage: str
    created_at: str
    recon_filename: str | None = None
    sheet_name: str | None = None
    total_rows: int = 0
    total_columns: int = 0
    correlation: DirectCorrelationResultV3 | None = None
    selected_rule_ids: list[str] = Field(default_factory=list)
    rule_execution_order: list[str] = Field(default_factory=list)
    rules_v4: list[Rule4Item] = Field(default_factory=list)
    is_completed: bool = False
    completed_stages_count: int = 0


class UserCorrelationUpdateRequestV4(BaseModel):
    correlations: list[DirectColumnCorrelationV3]
    sheet_name: str | None = None


class UserRulesUpdateRequestV4(BaseModel):
    selected_rule_ids: list[str]
    rule_execution_order: list[str] = Field(default_factory=list)
    rules: list[Rule4Item] | None = None


# =========================================================================
# MASTER CATALOG & DISK UTILITIES
# =========================================================================

def load_master_rules_v4_catalog() -> list[Rule4Item]:
    if MASTER_RULES_V4_FILE.exists():
        try:
            with open(MASTER_RULES_V4_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, list) and data:
                return [Rule4Item(**r) if isinstance(r, dict) else r for r in data]
        except Exception as exc:
            logger.warning(f"Failed to load Master Rules V4 Catalog from disk: {exc}")
    defaults = build_default_rules_v4()
    save_master_rules_v4_catalog(defaults)
    return defaults


def save_master_rules_v4_catalog(rules: list[Rule4Item]) -> None:
    try:
        MASTER_RULES_V4_FILE.parent.mkdir(parents=True, exist_ok=True)
        serialized = [r.model_dump() if hasattr(r, "model_dump") else r for r in rules]
        with open(MASTER_RULES_V4_FILE, "w", encoding="utf-8") as f:
            json.dump(serialized, f, indent=2, default=str)
    except Exception as exc:
        logger.warning(f"Failed to save Master Rules V4 Catalog: {exc}")


def _compute_fast_file_fingerprint_v4(path: Path, sheet_name: str | None = None) -> str:
    import hashlib
    try:
        stat = path.stat()
        h = hashlib.sha256()
        h.update(f"{stat.st_size}_{int(stat.st_mtime)}_{sheet_name or ''}".encode())
        with open(path, "rb") as f:
            h.update(f.read(65536))
            if stat.st_size > 131072:
                f.seek(-65536, 2)
                h.update(f.read(65536))
        return f"recon_v4_{h.hexdigest()[:20]}.pkl"
    except Exception:
        stat = path.stat()
        return f"{path.stem}_{stat.st_size}_{int(stat.st_mtime)}.pkl"


def _load_df_safely_v4(path: Path, sheet_name: str | None = None) -> pd.DataFrame:
    try:
        stat = path.stat()
        fp_key = _compute_fast_file_fingerprint_v4(path, sheet_name)
        fp_cache = CACHE_DIR_V4 / fp_key
        stem_cache = CACHE_DIR_V4 / f"{path.stem}_{stat.st_size}_{int(stat.st_mtime)}.pkl"

        # 1. Fast cache check
        target_cache = fp_cache if fp_cache.exists() else (stem_cache if stem_cache.exists() else None)
        if target_cache and target_cache.exists():
            try:
                full_df = pd.read_pickle(target_cache)
                if not fp_cache.exists():
                    try:
                        full_df.to_pickle(fp_cache)
                    except Exception:
                        pass
                return full_df
            except Exception:
                pass

        # 2. Size-based cache probe
        try:
            for existing_pkl in CACHE_DIR_V4.glob(f"*_{stat.st_size}_*.pkl"):
                try:
                    full_df = pd.read_pickle(existing_pkl)
                    try:
                        full_df.to_pickle(fp_cache)
                    except Exception:
                        pass
                    return full_df
                except Exception:
                    continue
        except Exception:
            pass

        # 3. Source read
        if path.suffix.lower() == ".csv":
            df = pd.read_csv(path, low_memory=False)
        else:
            df = None
            # Fast path A: Rust Calamine (~2.3s cold parse)
            try:
                from python_calamine import CalamineWorkbook
                wb = CalamineWorkbook.from_path(path)
                target = None
                if sheet_name and sheet_name in wb.sheet_names:
                    target = sheet_name
                elif sheet_name:
                    for s in wb.sheet_names:
                        if sheet_name.lower() in s.lower():
                            target = s
                            break
                if not target:
                    for s in wb.sheet_names:
                        if any(k in s.lower() for k in ["reco", "2b", "kigs", "pr", "gstr", "recon"]):
                            target = s
                            break
                if not target:
                    target = wb.sheet_names[0]

                sheet = wb.get_sheet_by_name(target)
                data = sheet.to_python()
                # Find best header row (most non-empty text cells in first 10 rows)
                header = None
                rows = []
                best_idx = 0
                max_non_empty = 0
                for idx, r in enumerate(data[:10]):
                    cnt = sum(1 for c in r if c is not None and str(c).strip() != "")
                    if cnt > max_non_empty:
                        max_non_empty = cnt
                        best_idx = idx

                if max_non_empty > 0:
                    raw_header = [str(c) if c is not None and str(c).strip() != "" else f"Column_{i+1}" for i, c in enumerate(data[best_idx])]
                    seen_h: dict[str, int] = {}
                    header = []
                    for i, c in enumerate(raw_header):
                        if c in seen_h:
                            seen_h[c] += 1
                            header.append(f"{c}_{seen_h[c]}")
                        else:
                            seen_h[c] = 1
                            header.append(c)
                    rows = data[best_idx + 1 :]

                if header:
                    df = pd.DataFrame(rows, columns=header)
            except Exception as e_cal:
                logger.info(f"V4 Calamine direct loader fallback for {path.name}: {e_cal}")

            # Fast path B: pandas read_excel with calamine engine
            if df is None:
                try:
                    sheet_to_read = sheet_name or "KIGS GSTR 2B Reco"
                    df = pd.read_excel(path, sheet_name=sheet_to_read, engine="calamine")
                except Exception as e_pd_cal:
                    logger.info(f"V4 Pandas calamine fallback for {path.name}: {e_pd_cal}")

            # Fast path C: openpyxl with ragged row padding
            if df is None:
                try:
                    from openpyxl import load_workbook
                    wb = load_workbook(path, read_only=True, data_only=True)
                    actual_sheet = sheet_name if sheet_name and sheet_name in wb.sheetnames else (
                        "KIGS GSTR 2B Reco" if "KIGS GSTR 2B Reco" in wb.sheetnames else wb.sheetnames[0]
                    )
                    ws = wb[actual_sheet]
                    row_iter = ws.iter_rows(values_only=True)
                    header = None
                    data = []
                    n_cols = 0
                    for row in row_iter:
                        if header is None:
                            if any(v is not None and str(v).strip() != "" for v in row):
                                raw_header = [str(c) if c is not None and str(c).strip() != "" else f"Column_{i+1}" for i, c in enumerate(row)]
                                seen_h = {}
                                header = []
                                for i, c in enumerate(raw_header):
                                    if c in seen_h:
                                        seen_h[c] += 1
                                        header.append(f"{c}_{seen_h[c]}")
                                    else:
                                        seen_h[c] = 1
                                        header.append(c)
                                n_cols = len(header)
                        else:
                            r_list = list(row)
                            if len(r_list) < n_cols:
                                r_list.extend([None] * (n_cols - len(r_list)))
                            elif len(r_list) > n_cols:
                                r_list = r_list[:n_cols]
                            data.append(r_list)
                    wb.close()
                    if header:
                        df = pd.DataFrame(data, columns=header)
                except Exception as e_openpyxl:
                    logger.info(f"V4 Openpyxl fallback for {path.name}: {e_openpyxl}")

            # Fast path D: standard pandas read_excel fallback
            if df is None:
                try:
                    excel_file = pd.ExcelFile(path)
                    sheet_to_read = sheet_name if sheet_name and sheet_name in excel_file.sheet_names else excel_file.sheet_names[0]
                    df = pd.read_excel(excel_file, sheet_name=sheet_to_read)
                except Exception:
                    df = pd.read_excel(path)

        if df is not None and not df.empty:
            seen_final: dict[str, int] = {}
            unique_final: list[str] = []
            for i, c in enumerate(df.columns):
                c_clean = str(c).strip() if str(c).strip() != "" else f"Column_{i+1}"
                if c_clean in seen_final:
                    seen_final[c_clean] += 1
                    unique_final.append(f"{c_clean}_{seen_final[c_clean]}")
                else:
                    seen_final[c_clean] = 1
                    unique_final.append(c_clean)
            df.columns = unique_final

        try:
            df.to_pickle(fp_cache)
            df.to_pickle(stem_cache)
        except Exception:
            pass

        return df
    except Exception as exc:
        logger.warning(f"Failed to load single recon DataFrame from {path}: {exc}")
        return pd.DataFrame()


def _ensure_session_v4(session_id: str) -> dict[str, Any]:
    if session_id in _V4_SESSIONS:
        return _V4_SESSIONS[session_id]

    saved = audit_v2_service.get_session(session_id)
    if saved and saved.get("recon_type") == "v4":
        if saved.get("correlation") and isinstance(saved["correlation"], dict):
            try:
                saved["correlation"] = DirectCorrelationResultV3(**saved["correlation"])
            except Exception:
                pass
        if saved.get("rules_v4"):
            parsed_rules = []
            for r in saved["rules_v4"]:
                if isinstance(r, dict):
                    try:
                        parsed_rules.append(Rule4Item(**r))
                    except Exception:
                        pass
                elif isinstance(r, Rule4Item):
                    parsed_rules.append(r)
            saved["rules_v4"] = parsed_rules or load_master_rules_v4_catalog()
        else:
            saved["rules_v4"] = load_master_rules_v4_catalog()

        s4_saved = saved.get("stage4_results")
        if not s4_saved or not isinstance(s4_saved, dict) or not s4_saved.get("records"):
            disk_s4 = audit_v2_service.get_stage4_results(session_id)
            if disk_s4 and disk_s4.get("records"):
                saved["stage4_results"] = disk_s4

        _V4_SESSIONS[session_id] = saved
        return saved

    # Create new session
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    default_filename = SAMPLE_RECON_FILE.name if SAMPLE_RECON_FILE.exists() else "TARS_KIGS_RECON_60000_Rows_Multi_Tranche_Scenarios.xlsx"
    default_path = str(SAMPLE_RECON_FILE) if SAMPLE_RECON_FILE.exists() else None
    tot_rows = 60000 if "60000" in default_filename else 20000

    session_data: dict[str, Any] = {
        "id": session_id,
        "recon_type": "v4",
        "title": "Reconciliation 4.0 • Single Ledger Updated",
        "status": "setup",
        "current_stage": "setup",
        "created_at": now,
        "updated_at": now,
        "recon_filename": default_filename,
        "recon_path": default_path,
        "sheet_name": "KIGS GSTR 2B Reco",
        "total_rows": tot_rows,
        "total_columns": 165,
        "correlation": None,
        "selected_rule_ids": [r.id for r in build_default_rules_v4() if r.is_enabled],
        "rule_execution_order": [r.id for r in build_default_rules_v4()],
        "rules_v4": build_default_rules_v4(),
    }
    _V4_SESSIONS[session_id] = session_data
    try:
        session_to_save = dict(session_data)
        session_to_save["rules_v4"] = [r.model_dump() for r in session_data["rules_v4"]]
        audit_v2_service.save_session(session_to_save)
    except Exception as exc:
        logger.warning(f"Could not persist session {session_id} to audit: {exc}")

    return _V4_SESSIONS[session_id]


def _persist_session_disk_v4(session: dict[str, Any]) -> None:
    try:
        to_save = dict(session)
        to_save.pop("_cached_df", None)
        if "correlation" in to_save and hasattr(to_save["correlation"], "model_dump"):
            to_save["correlation"] = to_save["correlation"].model_dump()
        if "rules_v4" in to_save and isinstance(to_save["rules_v4"], list):
            to_save["rules_v4"] = [r.model_dump() if hasattr(r, "model_dump") else r for r in to_save["rules_v4"]]
        to_save["recon_type"] = "v4"
        to_save["updated_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        audit_v2_service.save_session(to_save)
    except Exception as exc:
        logger.warning(f"Could not persist V4 session {session.get('id')}: {exc}")


# =========================================================================
# ROUTE ENDPOINTS
# =========================================================================

@router_v4.post("", response_model=ReconciliationV4Session, status_code=status.HTTP_201_CREATED)
def create_v4_session(req: ReconciliationV4SessionCreate | None = None) -> ReconciliationV4Session:
    session_id = f"V4-{uuid4().hex[:8].upper()}"
    session = _ensure_session_v4(session_id)
    if req and req.title:
        session["title"] = req.title
    _persist_session_disk_v4(session)
    return get_v4_session(session_id)


@router_v4.get("/{session_id}", response_model=ReconciliationV4Session)
def get_v4_session(session_id: str) -> ReconciliationV4Session:
    data = _ensure_session_v4(session_id)
    lifecycle = audit_v2_service.get_session_lifecycle(session_id)
    is_completed = False
    completed_stages_count = 0
    if lifecycle:
        is_completed = lifecycle.get("is_completed", False)
        completed_stages_count = lifecycle.get("completed_stages_count", 0)
    if is_completed or data.get("status") in ["completed", "exported"]:
        is_completed = True
        data["status"] = "completed"
        data["is_completed"] = True
        completed_stages_count = 6

    return ReconciliationV4Session(
        id=data["id"],
        recon_type="v4",
        title=data["title"],
        status=data["status"],
        current_stage=data["current_stage"],
        created_at=data["created_at"],
        recon_filename=data.get("recon_filename"),
        sheet_name=data.get("sheet_name"),
        total_rows=data.get("total_rows", 0),
        total_columns=data.get("total_columns", 0),
        correlation=data.get("correlation"),
        selected_rule_ids=data.get("selected_rule_ids", []),
        rule_execution_order=data.get("rule_execution_order", []),
        rules_v4=data.get("rules_v4") or build_default_rules_v4(),
        is_completed=is_completed,
        completed_stages_count=completed_stages_count,
    )


# STAGE 1: UPLOAD & CORRELATION
@router_v4.post("/{session_id}/upload-single", response_model=DirectCorrelationResultV3)
async def upload_single_recon_file_v4(
    session_id: str,
    settings: Annotated[Settings, Depends(get_settings)],
    recon_file: Annotated[UploadFile | None, File()] = None,
    use_sample: bool = False,
) -> DirectCorrelationResultV3:
    session = _ensure_session_v4(session_id)
    upload_dir = settings.upload_dir / "v4" / session_id
    upload_dir.mkdir(parents=True, exist_ok=True)

    target_path: Path
    filename: str

    if recon_file and not use_sample:
        ext = Path(recon_file.filename or "recon.xlsx").suffix or ".xlsx"
        target_path = upload_dir / f"recon_{uuid4().hex[:6]}{ext}"
        filename = recon_file.filename or target_path.name
        try:
            with target_path.open("wb") as f_out:
                while chunk := await recon_file.read(1024 * 1024):
                    f_out.write(chunk)
        finally:
            await recon_file.close()
    else:
        if not SAMPLE_RECON_FILE.exists():
            raise HTTPException(status_code=404, detail="Sample recon file not found on server.")
        target_path = SAMPLE_RECON_FILE
        filename = SAMPLE_RECON_FILE.name

    correlator = DirectSchemaCorrelatorV3()
    correlation = correlator.correlate_single_file(target_path, session_id=session_id)

    session["recon_filename"] = filename
    session["recon_path"] = str(target_path)
    session["gstr_filename"] = f"{filename} (CP)"
    session["pr_filename"] = f"{filename} (PR)"
    session["gstr_path"] = str(target_path)
    session["pr_path"] = str(target_path)
    session["sheet_name"] = correlation.sheet_name
    session["total_columns"] = correlation.total_columns
    session["correlation"] = correlation
    session["status"] = "mapped"
    session["current_stage"] = "mapping"

    # Background pre-cache with event synchronization
    cache_evt = threading.Event()
    _V4_CACHE_EVENTS[session_id] = cache_evt

    def _bg_cache(sid: str, p: Path, sheet: str, evt: threading.Event):
        try:
            df = _load_df_safely_v4(p, sheet_name=sheet)
            if sid in _V4_SESSIONS:
                _V4_SESSIONS[sid]["_cached_df"] = df
                _V4_SESSIONS[sid]["total_rows"] = len(df)
            logger.info(f"Recon 4.0 dataframe pre-cached successfully ({len(df)} rows, {len(df.columns)} columns)")
        except Exception as e:
            logger.warning(f"Recon 4.0 background pre-cache error: {e}")
        finally:
            evt.set()

    threading.Thread(target=_bg_cache, args=(session_id, target_path, correlation.sheet_name, cache_evt), daemon=True).start()

    _persist_session_disk_v4(session)
    return correlation


# STAGE 2: MAPPING CONFIRMATION
@router_v4.post("/{session_id}/mapping/confirm", response_model=ReconciliationV4Session)
def confirm_mapping_v4(
    session_id: str,
    req: UserCorrelationUpdateRequestV4,
) -> ReconciliationV4Session:
    session = _ensure_session_v4(session_id)
    corr = session.get("correlation")
    if corr:
        if hasattr(corr, "correlations"):
            corr.correlations = req.correlations
            if req.sheet_name:
                corr.sheet_name = req.sheet_name
        elif isinstance(corr, dict):
            corr["correlations"] = [c.model_dump() if hasattr(c, "model_dump") else c for c in req.correlations]
            if req.sheet_name:
                corr["sheet_name"] = req.sheet_name
        session["correlation"] = corr

    if req.sheet_name:
        session["sheet_name"] = req.sheet_name

    session["status"] = "mapping_confirmed"
    session["current_stage"] = "rules"
    _persist_session_disk_v4(session)
    return get_v4_session(session_id)


# STAGE 3: RULES
@router_v4.get("/{session_id}/rules", response_model=list[Rule4Item])
def get_v4_session_rules(session_id: str) -> list[Rule4Item]:
    session = _ensure_session_v4(session_id)
    rules = session.get("rules_v4")
    if not rules:
        rules = load_master_rules_v4_catalog()
        session["rules_v4"] = rules
    return rules


@router_v4.post("/{session_id}/rules/confirm", response_model=ReconciliationV4Session)
def confirm_rules_v4(
    session_id: str,
    req: UserRulesUpdateRequestV4,
) -> ReconciliationV4Session:
    session = _ensure_session_v4(session_id)
    session["selected_rule_ids"] = req.selected_rule_ids
    session["rule_execution_order"] = req.rule_execution_order
    if req.rules:
        session["rules_v4"] = req.rules
    session["status"] = "rules_confirmed"
    session["current_stage"] = "results"
    _persist_session_disk_v4(session)
    return get_v4_session(session_id)


@router_v4.get("/rules-v4/catalog", response_model=list[Rule4Item])
def get_master_rules_v4_catalog() -> list[Rule4Item]:
    return load_master_rules_v4_catalog()


@router_v4.post("/rules-v4/catalog", response_model=list[Rule4Item])
def update_master_rules_v4_catalog(rules: list[Rule4Item]) -> list[Rule4Item]:
    save_master_rules_v4_catalog(rules)
    return load_master_rules_v4_catalog()


# STAGE 4: WATERFALL RESULTS
def _execute_stage4_v4_internal(session_id: str) -> Stage4ExecutionResponseV4:
    session = _ensure_session_v4(session_id)

    # 1. Fetch dataframe
    df = session.get("_cached_df")
    if not isinstance(df, pd.DataFrame) or df.empty:
        evt = _V4_CACHE_EVENTS.get(session_id)
        if evt and not evt.is_set():
            logger.info(f"Recon 4.0: waiting for in-flight background cache for session {session_id}...")
            evt.wait(timeout=15.0)
            df = session.get("_cached_df")

        if not isinstance(df, pd.DataFrame) or df.empty:
            file_path_str = session.get("recon_path")
            file_path = Path(file_path_str) if file_path_str and Path(file_path_str).exists() else SAMPLE_RECON_FILE
            sheet_name = session.get("sheet_name", "KIGS GSTR 2B Reco")
            df = _load_df_safely_v4(file_path, sheet_name=sheet_name)
            session["_cached_df"] = df

    if df.empty:
        raise HTTPException(status_code=400, detail="Recon file contains no records or could not be parsed.")

    session["total_rows"] = len(df)

    # 2. Extract mappings
    mapped_pairs: dict[str, str] = {}
    kics_status_col: str | None = None
    corr = session.get("correlation")
    if corr:
        if hasattr(corr, "correlations"):
            for c in corr.correlations:
                if c.selected_target_column:
                    mapped_pairs[c.source_column] = c.selected_target_column
            kics_status_col = getattr(corr, "kics_status_column", None)
        elif isinstance(corr, dict):
            for c in corr.get("correlations", []):
                s = c.get("source_column")
                t = c.get("selected_target_column")
                if s and t:
                    mapped_pairs[s] = t
            kics_status_col = corr.get("kics_status_column")

    # 3. Extract rules
    rules = session.get("rules_v4") or load_master_rules_v4_catalog()

    # 4. Execute supercharged V4 waterfall
    engine = WaterfallMatchingEngineV4(rules=rules)
    result = engine.execute_waterfall(
        df=df,
        session_id=session_id,
        rules=rules,
        mapped_pairs=mapped_pairs,
        kics_status_col=kics_status_col,
    )
    result.compared_columns = [
        {"gstr_column": s, "pr_column": t, "match_strategy": "Intra-Table Coupling"}
        for s, t in mapped_pairs.items()
    ]

    # 5. Persist results
    session["stage4_results"] = result.model_dump()
    session["status"] = "reconciled"
    session["current_stage"] = "results"
    _persist_session_disk_v4(session)
    try:
        audit_v2_service.save_stage4_results(session_id, result.model_dump())
    except Exception as exc:
        logger.warning(f"Could not persist stage4 results to audit storage: {exc}")

    # Record Audit 2.0 Run
    try:
        now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
        run_id = f"RUN-V4-{datetime.datetime.now().strftime('%Y%m%d')}-{uuid4().hex[:4].upper()}"
        step = V2AuditStep(
            step_id="STEP-V4-WATERFALL",
            run_id=run_id,
            session_id=session_id,
            stage_key="results",
            step_order=1,
            name="Supercharged Intra-Table Waterfall Matching Engine V4",
            description=f"Processed {result.summary.total_records:,} records with 6 KPMG client rules in {result.duration_ms:.1f}ms ({result.summary.accuracy_percentage}% match rate).",
            component="WaterfallMatchingEngineV4",
            actor="SYSTEM",
            status="COMPLETED",
            duration_ms=result.duration_ms,
            started_at=now_iso,
            completed_at=now_iso,
            output_summary={
                "exact_matches": result.summary.exact_matches,
                "tolerance_matches": result.summary.tolerance_matches,
                "near_matches": result.summary.near_matches,
                "ineligible_itc_matches": result.summary.ineligible_itc_matches,
                "consolidated_matches": result.summary.consolidated_matches,
                "gst_only": result.summary.gst_only,
                "pr_only": result.summary.pr_only,
                "ambiguous": result.summary.ambiguous,
            },
            token_usage=TokenUsageBreakdown(model="rust/calamine-vectorized", cost_usd=0.0),
        )
        rec_run = V2RunRecord(
            run_id=run_id,
            session_id=session_id,
            session_title="Reconciliation 4.0 • Single Ledger Updated",
            run_type="SINGLE_FILE_INTRA_TABLE_UPDATED",
            status="COMPLETED",
            started_at=now_iso,
            completed_at=now_iso,
            duration_ms=result.duration_ms,
            triggered_by="USER: execute_v4_waterfall",
            stages_executed=["rules", "results"],
            current_stage="results",
            kpi_snapshot=result.summary.model_dump(),
            steps=[step],
        )
        audit_v2_service.record_run(rec_run)
    except Exception as exc:
        logger.warning(f"Failed to log V4 audit run: {exc}")

    return result


@router_v4.post("/{session_id}/results/execute", response_model=Stage4ExecutionResponseV4)
def execute_stage4_results_v4(session_id: str) -> Stage4ExecutionResponseV4:
    return _execute_stage4_v4_internal(session_id)


@router_v4.get("/{session_id}/results", response_model=Stage4ExecutionResponseV4)
def get_stage4_results_v4(session_id: str) -> Stage4ExecutionResponseV4:
    session = _ensure_session_v4(session_id)
    cached = session.get("stage4_results")
    if cached and isinstance(cached, dict):
        return Stage4ExecutionResponseV4(**cached)
    raise HTTPException(status_code=404, detail="Reconciliation engine has not been executed yet for this session.")


@router_v4.post("/{session_id}/records/{record_id}/recommend", response_model=AmbiguityRecommendation)
def get_record_recommendation_v4(
    session_id: str,
    record_id: str,
    body: dict[str, Any] | None = None,
) -> AmbiguityRecommendation:
    session = _ensure_session_v4(session_id)
    cached = session.get("stage4_results")
    record_data = None
    if cached and isinstance(cached, dict):
        records = cached.get("records", [])
        for r in records:
            r_dict = r if isinstance(r, dict) else (r.model_dump() if hasattr(r, "model_dump") else dict(r))
            if str(r_dict.get("id")) == str(record_id) or str(r_dict.get("gstr_row_index")) == str(record_id) or str(r_dict.get("index")) == str(record_id):
                record_data = r_dict
                break

    if not record_data and body and isinstance(body, dict):
        record_data = body.get("record") or body

    if not record_data:
        raise HTTPException(status_code=404, detail=f"Record '{record_id}' not found in session results.")

    return evaluate_ambiguity_recommendation(record_data)


@router_v4.post("/{session_id}/records/{record_id}/reclassify", response_model=Stage4ExecutionResponseV4)
def reclassify_record_v4(
    session_id: str,
    record_id: str,
    req: ReclassifyRecordRequestV4,
) -> Stage4ExecutionResponseV4:
    session = _ensure_session_v4(session_id)
    cached = session.get("stage4_results")
    if not cached or not isinstance(cached, dict) or not cached.get("records"):
        disk_s4 = audit_v2_service.get_stage4_results(session_id)
        if disk_s4 and disk_s4.get("records"):
            cached = disk_s4
            session["stage4_results"] = cached

    if not cached or not isinstance(cached, dict) or not cached.get("records"):
        raise HTTPException(status_code=404, detail="No reconciliation results found for this session.")

    records = cached.get("records", [])
    summary = cached.get("summary", {})

    target_rec = None
    target_idx = -1
    clean_rec_id = str(record_id).strip()
    digits_in_req = "".join(filter(str.isdigit, clean_rec_id))

    for i, r in enumerate(records):
        r_dict = r if isinstance(r, dict) else (r.model_dump() if hasattr(r, "model_dump") else dict(r))
        r_id = str(r_dict.get("id") or "").strip()
        r_idx = str(r_dict.get("gstr_row_index") if r_dict.get("gstr_row_index") is not None else "")
        r_v3_idx = str(r_dict.get("index") if r_dict.get("index") is not None else "")
        r_pr_idx = str(r_dict.get("pr_row_index") if r_dict.get("pr_row_index") is not None else "")
        r_clust = str(r_dict.get("ambiguity_cluster_id") or "").strip()
        r_doc = str(r_dict.get("document_number") or r_dict.get("source_doc_num") or "").strip()

        # 1. Direct equality (case-insensitive)
        if clean_rec_id.lower() in (r_id.lower(), r_idx, r_v3_idx, r_pr_idx, r_clust.lower(), r_doc.lower()):
            target_rec = r_dict
            target_idx = i
            break

        # 2. Match by numeric row number
        if digits_in_req:
            req_int = int(digits_in_req)
            if (
                (r_idx and int(r_idx) == req_int)
                or (r_idx and int(r_idx) + 1 == req_int)
                or (r_v3_idx and int(r_v3_idx) == req_int)
                or (r_v3_idx and int(r_v3_idx) + 1 == req_int)
            ):
                target_rec = r_dict
                target_idx = i
                break

    if not target_rec or target_idx < 0:
        raise HTTPException(status_code=404, detail=f"Record '{record_id}' not found.")

    old_bucket = target_rec.get("bucket") or "AMBIGUOUS"
    new_bucket = req.target_bucket

    verdict, policy_msg = evaluate_target_category_policy(target_rec, new_bucket)

    target_rec["reclassified_from"] = old_bucket
    target_rec["bucket"] = new_bucket
    target_rec["matched_by_pass"] = f"Manual Reclassification → {new_bucket}"
    target_rec["reclassification_note"] = req.reviewer_note or f"Manually classified to {new_bucket} ({verdict}): {policy_msg}"
    target_rec["classification_reason"] = f"Accountant Manual Disposition: {policy_msg}"

    verdict_labels = {
        "EXACT_MATCH": "Exact Match",
        "TOLERANCE_MATCH": "Tolerance Match",
        "NEAR_MATCH": "Near Match",
        "GSTR_ONLY": "GST Only",
        "PR_ONLY": "PR Only",
        "AMBIGUOUS": "Ambiguous",
    }
    target_rec["tars_verdict"] = verdict_labels.get(new_bucket, "Ambiguous")
    if new_bucket in ("EXACT_MATCH", "TOLERANCE_MATCH", "NEAR_MATCH"):
        target_rec["concurrence"] = "AGREEMENT"

    records[target_idx] = target_rec
    cached["records"] = records

    # Update summary counts safely
    v4_bucket_map = {
        "EXACT_MATCH": ("exact_matches", "exact_match_count"),
        "TOLERANCE_MATCH": ("tolerance_matches", "tolerance_match_count"),
        "NEAR_MATCH": ("near_matches", "near_match_count"),
        "AMBIGUOUS": ("ambiguous", "ambiguous_count"),
        "GSTR_ONLY": ("gst_only", "gstr_only_count"),
        "PR_ONLY": ("pr_only", "pr_only_count"),
    }
    old_fields = v4_bucket_map.get(old_bucket)
    new_fields = v4_bucket_map.get(new_bucket)
    if old_fields:
        for fld in old_fields:
            if summary.get(fld, 0) > 0:
                summary[fld] -= 1
    if new_fields:
        for fld in new_fields:
            summary[fld] = summary.get(fld, 0) + 1

    # Recalculate reconciled totals
    tot_rec = (
        summary.get("exact_matches", 0)
        + summary.get("tolerance_matches", 0)
        + summary.get("near_matches", 0)
        + summary.get("ineligible_itc_matches", 0)
        + summary.get("consolidated_matches", 0)
    )
    summary["total_reconciled_count"] = tot_rec
    tot_all = summary.get("total_records", len(records)) or 1
    summary["accuracy_percentage"] = round((tot_rec / tot_all) * 100.0, 1)
    summary["overall_reconciliation_rate"] = summary["accuracy_percentage"]

    # Mark ambiguity cluster as resolved if attached
    cluster_id = target_rec.get("ambiguity_cluster_id")
    if cluster_id and "ambiguities" in cached:
        for cl in cached["ambiguities"]:
            c_dict = cl if isinstance(cl, dict) else (cl.model_dump() if hasattr(cl, "model_dump") else dict(cl))
            if c_dict.get("cluster_id") == cluster_id:
                c_dict["status"] = "RESOLVED"
                c_dict["resolved_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()

    cached["summary"] = summary
    session["stage4_results"] = cached
    _persist_session_disk_v4(session)
    try:
        audit_v2_service.save_stage4_results(session_id, cached)
    except Exception as exc:
        logger.warning(f"Error persisting stage4 results to audit storage: {exc}")

    return Stage4ExecutionResponseV4(**cached)


@router_v4.post("/{session_id}/results/resolve-ambiguity", response_model=Stage4ExecutionResponseV4)
def resolve_ambiguity_v4(
    session_id: str,
    req: ResolveAmbiguityRequestV4,
) -> Stage4ExecutionResponseV4:
    session = _ensure_session_v4(session_id)
    cached = session.get("stage4_results")
    if not cached or not isinstance(cached, dict) or not cached.get("records"):
        disk_s4 = audit_v2_service.get_stage4_results(session_id)
        if disk_s4 and disk_s4.get("records"):
            cached = disk_s4
            session["stage4_results"] = cached

    if not cached or not isinstance(cached, dict):
        raise HTTPException(status_code=404, detail="No reconciliation results found for this session.")

    ambiguities = cached.get("ambiguities", [])
    records = cached.get("records", [])
    summary = cached.get("summary", {})

    target_cluster = next((c for c in ambiguities if c.get("cluster_id") == req.cluster_id), None)
    if not target_cluster:
        raise HTTPException(status_code=404, detail=f"Ambiguity cluster '{req.cluster_id}' not found.")

    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
    candidate_count = len(target_cluster.get("candidates", []))

    if req.action == "CHOOSE" and req.chosen_candidate_id:
        chosen_cand = next((c for c in target_cluster.get("candidates", []) if c.get("candidate_id") == req.chosen_candidate_id), None)
        if not chosen_cand:
            raise HTTPException(status_code=404, detail=f"Candidate '{req.chosen_candidate_id}' not found in cluster.")

        target_cluster["status"] = "RESOLVED"
        target_cluster["resolved_pr_record_id"] = chosen_cand.get("pr_record_id")
        target_cluster["resolved_pr_row_index"] = chosen_cand.get("pr_row_index")
        target_cluster["resolved_at"] = now_iso

        # Locate the record
        target_rec = next((r for r in records if r.get("ambiguity_cluster_id") == req.cluster_id or str(r.get("id")) == str(target_cluster.get("gstr_record_id"))), None)
        gstr_preview = target_rec.get("gstr_preview", {}) if target_rec else target_cluster.get("anchor_preview", {})

        reclass_result = reclassify_ambiguity_candidate(
            gstr_preview=gstr_preview,
            chosen_cand=chosen_cand,
            candidate_count=candidate_count,
            action="CHOOSE",
            rules=session.get("rules_v4", []),
        )

        chosen_pr_row_idx = chosen_cand.get("pr_row_index")
        if target_rec:
            target_rec["bucket"] = reclass_result["bucket"]
            target_rec["tars_verdict"] = (
                "Exact Match" if reclass_result["bucket"] == "EXACT_MATCH"
                else "Tolerance Match" if reclass_result["bucket"] == "TOLERANCE_MATCH"
                else "Near Match" if reclass_result["bucket"] == "NEAR_MATCH"
                else "Ambiguous"
            )
            target_rec["pr_row_index"] = chosen_pr_row_idx
            target_rec["pr_record_id"] = chosen_cand.get("pr_record_id")
            target_rec["pr_preview"] = chosen_cand.get("pr_preview", {})
            target_rec["matched_by_pass"] = reclass_result["matched_by_pass"]
            target_rec["classification_reason"] = reclass_result["classification_reason"]
            target_rec["ai_reason"] = reclass_result["ai_reason"]
            target_rec["reclassified_from"] = reclass_result["reclassified_from"]
            target_rec["reclassification_note"] = reclass_result["reclassification_note"]
            target_rec["variances"] = {
                **reclass_result.get("variances", {}),
                "resolved_by": "Senior Tax Accountant",
                "confidence_at_resolution": chosen_cand.get("confidence_score"),
                "resolved_at": now_iso,
                "candidate_count": candidate_count,
            }

        cand_tax = float(chosen_cand.get("pr_preview", {}).get("tax_amount") or (target_rec.get("tax_amount", 0.0) if target_rec else 0.0))
        target_bucket = reclass_result["bucket"]

        summary["ambiguous"] = max(0, summary.get("ambiguous", 1) - 1)
        summary["ambiguous_count"] = max(0, summary.get("ambiguous_count", 1) - 1)
        summary["ambiguous_itc"] = max(0.0, round(summary.get("ambiguous_itc", 0.0) - cand_tax, 2))

        if target_bucket == "EXACT_MATCH":
            summary["exact_matches"] = summary.get("exact_matches", 0) + 1
            summary["exact_match_count"] = summary.get("exact_match_count", 0) + 1
            summary["exact_match_itc"] = round(summary.get("exact_match_itc", 0.0) + cand_tax, 2)
        elif target_bucket == "TOLERANCE_MATCH":
            summary["tolerance_matches"] = summary.get("tolerance_matches", 0) + 1
            summary["tolerance_match_count"] = summary.get("tolerance_match_count", 0) + 1
            summary["tolerance_match_itc"] = round(summary.get("tolerance_match_itc", 0.0) + cand_tax, 2)
        elif target_bucket == "NEAR_MATCH":
            summary["near_matches"] = summary.get("near_matches", 0) + 1
            summary["near_match_count"] = summary.get("near_match_count", 0) + 1
            summary["near_match_itc"] = round(summary.get("near_match_itc", 0.0) + cand_tax, 2)

        tot_rec = summary.get("exact_matches", 0) + summary.get("tolerance_matches", 0) + summary.get("near_matches", 0)
        summary["total_reconciled_count"] = tot_rec
        tot_all = summary.get("total_records", len(records)) or 1
        summary["accuracy_percentage"] = round((tot_rec / tot_all) * 100.0, 1)

    elif req.action == "REJECT":
        target_cluster["status"] = "REJECTED"
        target_cluster["resolved_at"] = now_iso

        target_rec = next((r for r in records if r.get("ambiguity_cluster_id") == req.cluster_id or str(r.get("id")) == str(target_cluster.get("gstr_record_id"))), None)
        gstr_preview = target_rec.get("gstr_preview", {}) if target_rec else target_cluster.get("anchor_preview", {})

        reclass_result = reclassify_ambiguity_candidate(
            gstr_preview=gstr_preview,
            chosen_cand=None,
            candidate_count=candidate_count,
            action="REJECT",
            rules=session.get("rules_v4", []),
        )

        if target_rec:
            target_rec["bucket"] = "GSTR_ONLY"
            target_rec["tars_verdict"] = "GST Only"
            target_rec["matched_by_pass"] = reclass_result["matched_by_pass"]
            target_rec["classification_reason"] = reclass_result["classification_reason"]
            target_rec["ai_reason"] = reclass_result["ai_reason"]
            target_rec["reclassified_from"] = reclass_result["reclassified_from"]
            target_rec["reclassification_note"] = reclass_result["reclassification_note"]
            target_rec["variances"] = reclass_result.get("variances", {})

        g_tax = float(target_rec.get("tax_amount", 0.0) if target_rec else 0.0)
        summary["ambiguous"] = max(0, summary.get("ambiguous", 1) - 1)
        summary["ambiguous_count"] = max(0, summary.get("ambiguous_count", 1) - 1)
        summary["ambiguous_itc"] = max(0.0, round(summary.get("ambiguous_itc", 0.0) - g_tax, 2))
        summary["gst_only"] = summary.get("gst_only", 0) + 1
        summary["gstr_only_count"] = summary.get("gstr_only_count", 0) + 1
        summary["gstr_only_itc"] = round(summary.get("gstr_only_itc", 0.0) + g_tax, 2)

    cached["ambiguities"] = ambiguities
    cached["records"] = records
    cached["summary"] = summary
    session["stage4_results"] = cached
    _persist_session_disk_v4(session)
    try:
        audit_v2_service.save_stage4_results(session_id, cached)
    except Exception as exc:
        logger.warning(f"Error persisting ambiguity resolution results to audit storage: {exc}")

    return Stage4ExecutionResponseV4(**cached)



# STAGE 5: SUMMARY & DISPATCH
@router_v4.get("/{session_id}/summary")
def get_v4_summary(session_id: str) -> dict[str, Any]:
    session = _ensure_session_v4(session_id)
    cached_s4 = session.get("stage4_results")
    if not cached_s4:
        s4_res = _execute_stage4_v4_internal(session_id)
        cached_s4 = s4_res.model_dump()

    summary = cached_s4.get("summary", {})
    return {
        "session_id": session_id,
        "title": session.get("title"),
        "summary": summary,
        "records_count": summary.get("total_records", 0),
        "concurrence_rate": summary.get("kics_concurrence_rate", 100.0),
        "accuracy_percentage": summary.get("accuracy_percentage", 100.0),
        "status": session.get("status", "reconciled"),
    }


# =========================================================================
# EXPORT 4.0 REST ENDPOINTS (STAGE 6)
# =========================================================================

@router_v4.get("/export/presets")
def list_v4_export_presets():
    """Returns all built-in and user-saved export presets."""
    try:
        return export_v2_service.get_presets()
    except Exception as exc:
        logger.error(f"Error listing export presets: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to list export presets: {exc}") from exc


@router_v4.post("/export/presets")
def save_v4_export_preset(preset: ExportPreset):
    """Persists a user-defined export preset layout and rules to disk."""
    try:
        return export_v2_service.save_preset(preset)
    except Exception as exc:
        logger.error(f"Error saving export preset: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to save export preset: {exc}") from exc


@router_v4.delete("/export/presets/{preset_id}")
def delete_v4_export_preset(preset_id: str):
    """Deletes a custom user preset."""
    try:
        return export_v2_service.delete_preset(preset_id)
    except Exception as exc:
        logger.error(f"Error deleting export preset {preset_id}: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to delete export preset: {exc}") from exc


@router_v4.get("/{session_id}/export/columns")
def get_v4_export_columns(session_id: str):
    """Returns the complete universe of columns across CALCULATED, GSTR, and PR families."""
    try:
        session = _ensure_session_v4(session_id)
        cached_s4 = session.get("stage4_results")
        if not cached_s4:
            s4_res = _execute_stage4_v4_internal(session_id)
            cached_s4 = s4_res.model_dump()
        return export_v2_service.get_available_columns(session_id, stage4_data=cached_s4, session_dict=session)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        logger.error(f"Error fetching export columns for session {session_id}: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to inspect export columns: {exc}") from exc


@router_v4.get("/{session_id}/export/preview")
def get_v4_export_preview(session_id: str, limit: int = 50) -> dict[str, Any]:
    """Returns preview records and summary stats for Stage 6 Export Studio."""
    try:
        session = _ensure_session_v4(session_id)
        cached_s4 = session.get("stage4_results")
        if not cached_s4:
            s4_res = _execute_stage4_v4_internal(session_id)
            cached_s4 = s4_res.model_dump()
        return export_v2_service.get_preview(session_id, limit=limit, stage4_data=cached_s4)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        logger.error(f"Error fetching export preview for session {session_id}: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to generate export preview: {exc}") from exc


@router_v4.post("/{session_id}/export/custom")
def download_v4_custom_export(session_id: str, req: CustomExportRequest):
    """Streams a user-designed export file in XLSX, CSV, DSV, or JSON with custom order and formatting."""
    try:
        session = _ensure_session_v4(session_id)
        cached_s4 = session.get("stage4_results")
        if not cached_s4:
            s4_res = _execute_stage4_v4_internal(session_id)
            cached_s4 = s4_res.model_dump()

        content, filename, media_type = export_v2_service.build_custom_export(
            session_id=session_id,
            request=req,
            stage4_data=cached_s4,
            session_dict=session,
        )
        try:
            audit_v2_service.record_export_event(
                session_id=session_id,
                request=req.model_dump() if hasattr(req, "model_dump") else dict(req),
                filename=filename,
                filesize=len(content) if content else 0,
            )
        except Exception as e_err:
            logger.warning(f"Failed to record export event to audit_v2_service: {e_err}")

        return Response(
            content=content,
            media_type=media_type,
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
                "Access-Control-Expose-Headers": "Content-Disposition",
            },
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        logger.error(f"Error compiling custom export package for session {session_id}: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to compile custom export: {exc}") from exc


@router_v4.get("/{session_id}/export/download")
def download_v4_export(
    session_id: str,
    format: str = "xlsx",
    color_coded: bool = True,
    include_auxiliary: bool = True,
):
    """Streams the compiled reconciliation ledger workbook (XLSX), flat CSV, or JSON."""
    try:
        session = _ensure_session_v4(session_id)
        cached_s4 = session.get("stage4_results")
        if not cached_s4:
            s4_res = _execute_stage4_v4_internal(session_id)
            cached_s4 = s4_res.model_dump()

        content, filename, media_type = export_v2_service.build_export(
            session_id=session_id,
            export_format=format,
            color_coded=color_coded,
            include_auxiliary=include_auxiliary,
            stage4_data=cached_s4,
            session_dict=session,
        )
        return Response(
            content=content,
            media_type=media_type,
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
                "Access-Control-Expose-Headers": "Content-Disposition",
            },
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        logger.error(f"Error generating export package for session {session_id}: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to generate export package: {exc}") from exc


@router_v4.post("/{session_id}/complete")
def complete_v4_session(session_id: str) -> dict[str, Any]:
    session = _ensure_session_v4(session_id)
    session["status"] = "completed"
    session["is_completed"] = True
    session["current_stage"] = "export"
    _persist_session_disk_v4(session)
    return {
        "id": session_id,
        "status": "completed",
        "current_stage": "export",
        "created_at": session.get("created_at", ""),
        "recon_filename": session.get("recon_filename"),
    }
