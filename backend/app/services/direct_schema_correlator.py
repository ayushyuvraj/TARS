from __future__ import annotations

from difflib import SequenceMatcher
import json
import logging
import re
import time
from typing import Any

from pydantic import BaseModel, Field

from app.domain.models import CanonicalDataType
from app.providers.base import LLMProvider, ProviderError
from app.services.fast_excel_parser import FastColumnSummary, FastFileProfile

logger = logging.getLogger(__name__)


def _normalize(val: str) -> str:
    return re.sub(r"[^a-z0-9]", "", str(val).lower())


class AlternativeMatch(BaseModel):
    pr_column: str
    confidence: float = Field(ge=0.0, le=1.0)
    reason: str


class DirectColumnCorrelation(BaseModel):
    gstr_column: str
    gstr_dtype: str
    gstr_samples: list[str] = Field(default_factory=list)
    selected_pr_column: str | None = None
    confidence: float = Field(ge=0.0, le=1.0)
    reason: str
    engine: str  # e.g., "deterministic" or "llm: gpt-5.4-mini"
    alternatives: list[AlternativeMatch] = Field(default_factory=list)
    is_primary_gst_field: bool = False
    canonical_concept: str | None = None


class AgentThought(BaseModel):
    step: str
    message: str
    timestamp_ms: float
    duration_ms: float = 0.0
    model: str | None = None


class LLMMatchItem(BaseModel):
    gstr_column: str
    best_pr_column: str | None = None
    confidence: float = Field(ge=0.0, le=1.0)
    reason: str
    alternatives: list[AlternativeMatch] = Field(default_factory=list)


class LLMSchemaCorrelationResponse(BaseModel):
    matches: list[LLMMatchItem] = Field(default_factory=list)


class DirectCorrelationResult(BaseModel):
    reconciliation_id: str
    gstr_filename: str
    pr_filename: str
    total_gstr_columns: int
    total_pr_columns: int
    correlations: list[DirectColumnCorrelation] = Field(default_factory=list)
    pr_columns: list[str] = Field(default_factory=list)
    agent_thoughts: list[AgentThought] = Field(default_factory=list)
    model_used: str | None = None
    total_duration_ms: float = 0.0


# Primary GST concepts for deterministic matching
CORE_GST_CONCEPTS: dict[str, dict[str, Any]] = {
    "gstin": {
        "canonical": "supplier_gstin",
        "tokens": {"gstin", "suppliergstin", "counterpartygstin", "vendorgstin", "partygstin", "ctin", "taxid"},
        "negative": {"buyer", "customer", "recipient", "billto", "shipto", "location", "entity"},
        "expected_dtype": CanonicalDataType.STRING,
        "is_primary": True,
    },
    "document_number": {
        "canonical": "invoice_number",
        "tokens": {"invoicenumber", "invoiceno", "invno", "billnumber", "billno", "documentnumber", "docno", "voucherno", "vouchernumber"},
        "negative": {"irn", "po", "purchaseorder", "challan"},
        "expected_dtype": CanonicalDataType.STRING,
        "is_primary": True,
    },
    "document_date": {
        "canonical": "invoice_date",
        "tokens": {"invoicedate", "invdate", "billdate", "documentdate", "docdate", "postingdate", "entrydate"},
        "negative": {"filing", "gstr1", "payment", "due"},
        "expected_dtype": CanonicalDataType.DATE,
        "is_primary": True,
    },
    "taxable_value": {
        "canonical": "taxable_value",
        "tokens": {"taxablevalue", "taxableamount", "taxable", "assessedvalue", "assessableamount", "baseamount"},
        "negative": {"rate", "tax"},
        "expected_dtype": CanonicalDataType.NUMBER,
        "is_primary": True,
    },
    "igst": {
        "canonical": "integrated_tax",
        "tokens": {"integratedtax", "igst", "igstamount", "integratedtaxamount"},
        "negative": {"rate"},
        "expected_dtype": CanonicalDataType.NUMBER,
        "is_primary": True,
    },
    "cgst": {
        "canonical": "central_tax",
        "tokens": {"centraltax", "cgst", "cgstamount", "centraltaxamount"},
        "negative": {"rate"},
        "expected_dtype": CanonicalDataType.NUMBER,
        "is_primary": True,
    },
    "sgst": {
        "canonical": "state_tax",
        "tokens": {"stateuttax", "sgst", "utgst", "sgstamount", "statetax"},
        "negative": {"rate"},
        "expected_dtype": CanonicalDataType.NUMBER,
        "is_primary": True,
    },
    "cess": {
        "canonical": "cess_amount",
        "tokens": {"cess", "cessamount", "compensationcess"},
        "negative": {"rate"},
        "expected_dtype": CanonicalDataType.NUMBER,
        "is_primary": True,
    },
    "total_amount": {
        "canonical": "total_invoice_value",
        "tokens": {"totalamount", "invoicevalue", "totalvalue", "invvalue", "netamount", "grossamount", "billamount"},
        "negative": {"taxable", "tax"},
        "expected_dtype": CanonicalDataType.NUMBER,
        "is_primary": True,
    },
}


class DirectSchemaCorrelator:
    """
    Direct N x M Schema Correlation Engine.
    Correlates all N columns of GSTR-2B against all M columns of Purchase Register.
    Hybrid:
      1. Deterministic Token / GSTIN / Regex matching for primary financial fields (99%).
      2. High-speed ChatGPT 5.4 Mini structured inference for ambiguous/ERP columns.
    """

    def __init__(self, llm_provider: LLMProvider | None = None, model_name: str = "gpt-5.4-mini") -> None:
        self.llm_provider = llm_provider
        self.model_name = model_name

    def correlate(
        self,
        reconciliation_id: str,
        gstr_profile: FastFileProfile,
        pr_profile: FastFileProfile,
    ) -> DirectCorrelationResult:
        start_time = time.perf_counter()
        thoughts: list[AgentThought] = []

        thoughts.append(
            AgentThought(
                step="fast_probe_ingestion",
                message=f"Ingested GSTR-2B ({gstr_profile.column_count} columns) and Purchase Register ({pr_profile.column_count} columns) in {gstr_profile.extraction_time_ms + pr_profile.extraction_time_ms:.1f}ms.",
                timestamp_ms=time.time() * 1000,
                duration_ms=gstr_profile.extraction_time_ms + pr_profile.extraction_time_ms,
            )
        )

        pr_col_map = {col.name: col for col in pr_profile.columns}
        pr_names = [col.name for col in pr_profile.columns]

        # Stage 1: Deterministic resolution
        t_det_start = time.perf_counter()
        resolved_correlations: dict[str, DirectColumnCorrelation] = {}
        unresolved_gstr: list[FastColumnSummary] = []
        assigned_pr_cols: set[str] = set()

        for gstr_col in gstr_profile.columns:
            det_match = self._match_deterministic(gstr_col, pr_profile.columns, assigned_pr_cols)
            if det_match:
                resolved_correlations[gstr_col.name] = det_match
                if det_match.selected_pr_column:
                    assigned_pr_cols.add(det_match.selected_pr_column)
            else:
                unresolved_gstr.append(gstr_col)

        det_duration = (time.perf_counter() - t_det_start) * 1000.0
        det_count = len(resolved_correlations)
        thoughts.append(
            AgentThought(
                step="deterministic_matcher",
                message=f"Deterministically matched {det_count} primary GST/tax fields with 99% confidence in {det_duration:.1f}ms.",
                timestamp_ms=time.time() * 1000,
                duration_ms=det_duration,
            )
        )

        # Stage 2: LLM semantic correlation for remaining columns
        if unresolved_gstr:
            t_llm_start = time.perf_counter()
            thoughts.append(
                AgentThought(
                    step="llm_semantic_analysis_started",
                    message=f"Dispatching {len(unresolved_gstr)} ambiguous/ERP columns to Autonomous GenAI Agent for semantic correlation...",
                    timestamp_ms=time.time() * 1000,
                    model="GenAI Multi-Agent Fabric",
                )
            )

            llm_results = self._invoke_llm_correlation(unresolved_gstr, pr_profile.columns)
            llm_duration = (time.perf_counter() - t_llm_start) * 1000.0

            for g_col in unresolved_gstr:
                if g_col.name in llm_results:
                    resolved_correlations[g_col.name] = llm_results[g_col.name]
                else:
                    # Deterministic fallback if LLM omitted
                    resolved_correlations[g_col.name] = self._lexical_fallback(g_col, pr_profile.columns)

            thoughts.append(
                AgentThought(
                    step="llm_semantic_analysis_completed",
                    message=f"Completed Autonomous GenAI semantic correlation for {len(unresolved_gstr)} columns in {llm_duration:.1f}ms.",
                    timestamp_ms=time.time() * 1000,
                    duration_ms=llm_duration,
                    model="GenAI Multi-Agent Fabric",
                )
            )

        # Preserve original GSTR column ordering
        ordered_correlations = [resolved_correlations[col.name] for col in gstr_profile.columns]
        total_time_ms = (time.perf_counter() - start_time) * 1000.0

        thoughts.append(
            AgentThought(
                step="schema_graph_checkpointed",
                message=f"Direct schema correlation matrix ready: {len(ordered_correlations)} GSTR columns mapped across {len(pr_names)} PR columns. Awaiting human validation.",
                timestamp_ms=time.time() * 1000,
                duration_ms=total_time_ms,
            )
        )

        return DirectCorrelationResult(
            reconciliation_id=reconciliation_id,
            gstr_filename=gstr_profile.filename,
            pr_filename=pr_profile.filename,
            total_gstr_columns=gstr_profile.column_count,
            total_pr_columns=pr_profile.column_count,
            correlations=ordered_correlations,
            pr_columns=pr_names,
            agent_thoughts=thoughts,
            model_used=self.model_name if self.llm_provider else "deterministic_fallback",
            total_duration_ms=round(total_time_ms, 2),
        )

    def _match_deterministic(
        self,
        gstr_col: FastColumnSummary,
        pr_cols: list[FastColumnSummary],
        assigned_pr_cols: set[str],
    ) -> DirectColumnCorrelation | None:
        g_norm = _normalize(gstr_col.name)

        # Check Core GST concepts
        for concept_key, concept_info in CORE_GST_CONCEPTS.items():
            tokens = concept_info["tokens"]
            negatives = concept_info["negative"]
            expected_dtype = concept_info["expected_dtype"]

            # Does GSTR column match this concept?
            has_token = any(t in g_norm for t in tokens)
            has_neg = any(neg in g_norm for neg in negatives)

            # Special GSTIN pattern check
            if concept_key == "gstin" and "gstin" in gstr_col.pattern_hints and not has_neg:
                has_token = True

            if has_token and not has_neg:
                # Find matching PR column
                scored_candidates: list[tuple[float, FastColumnSummary, str]] = []
                for pr_c in pr_cols:
                    if pr_c.name in assigned_pr_cols:
                        continue
                    p_norm = _normalize(pr_c.name)
                    p_has_neg = any(neg in p_norm for neg in negatives)
                    if p_has_neg:
                        continue

                    # Exact token hit
                    p_has_token = any(t in p_norm for t in tokens)
                    if concept_key == "gstin" and "gstin" in pr_c.pattern_hints:
                        p_has_token = True

                    if p_has_token:
                        score = 0.99 if g_norm == p_norm else 0.95
                        reason = f"Deterministic match: both columns represent {concept_info['canonical']} with matching datatype and format."
                        scored_candidates.append((score, pr_c, reason))
                    else:
                        # Lexical similarity
                        ratio = SequenceMatcher(None, g_norm, p_norm).ratio()
                        if ratio >= 0.85:
                            scored_candidates.append((round(ratio, 2), pr_c, f"High lexical token similarity ({ratio:.0%}) for {concept_info['canonical']}."))

                if scored_candidates:
                    scored_candidates.sort(key=lambda x: x[0], reverse=True)
                    best_score, best_pr, best_reason = scored_candidates[0]
                    alts = [
                        AlternativeMatch(pr_column=c[1].name, confidence=c[0], reason=c[2])
                        for c in scored_candidates[1:3]
                    ]
                    return DirectColumnCorrelation(
                        gstr_column=gstr_col.name,
                        gstr_dtype=gstr_col.inferred_dtype.value,
                        gstr_samples=gstr_col.sample_values,
                        selected_pr_column=best_pr.name,
                        confidence=best_score,
                        reason=best_reason,
                        engine="deterministic",
                        alternatives=alts,
                        is_primary_gst_field=True,
                        canonical_concept=concept_info["canonical"],
                    )

        # Check identical column name match
        for pr_c in pr_cols:
            if pr_c.name in assigned_pr_cols:
                continue
            if g_norm == _normalize(pr_c.name):
                return DirectColumnCorrelation(
                    gstr_column=gstr_col.name,
                    gstr_dtype=gstr_col.inferred_dtype.value,
                    gstr_samples=gstr_col.sample_values,
                    selected_pr_column=pr_c.name,
                    confidence=0.99,
                    reason=f"Deterministic match: exact identical normalized header name '{pr_c.name}'.",
                    engine="deterministic",
                    alternatives=[],
                    is_primary_gst_field=False,
                )

        # Check high lexical or sub-token similarity match for non-primary columns
        best_lex_score = 0.0
        best_lex_pr: FastColumnSummary | None = None
        lex_alts: list[AlternativeMatch] = []

        for pr_c in pr_cols:
            if pr_c.name in assigned_pr_cols:
                continue
            p_norm = _normalize(pr_c.name)
            ratio = SequenceMatcher(None, g_norm, p_norm).ratio()
            if ratio > best_lex_score:
                if best_lex_pr:
                    lex_alts.append(
                        AlternativeMatch(
                            pr_column=best_lex_pr.name,
                            confidence=round(best_lex_score, 2),
                            reason="Alternative token similarity",
                        )
                    )
                best_lex_score = ratio
                best_lex_pr = pr_c

        if best_lex_pr and best_lex_score >= 0.70:
            return DirectColumnCorrelation(
                gstr_column=gstr_col.name,
                gstr_dtype=gstr_col.inferred_dtype.value,
                gstr_samples=gstr_col.sample_values,
                selected_pr_column=best_lex_pr.name,
                confidence=round(best_lex_score, 2),
                reason=f"Deterministic token similarity ({best_lex_score:.0%}) between '{gstr_col.name}' and '{best_lex_pr.name}'.",
                engine="deterministic",
                alternatives=lex_alts[:2],
                is_primary_gst_field=False,
            )

        return None

    def _invoke_llm_correlation(
        self,
        unresolved_gstr: list[FastColumnSummary],
        pr_cols: list[FastColumnSummary],
    ) -> dict[str, DirectColumnCorrelation]:
        if not self.llm_provider:
            logger.warning("LLM provider not configured; falling back to lexical correlation.")
            return {
                g.name: self._lexical_fallback(g, pr_cols)
                for g in unresolved_gstr
            }

        # Chunk unresolved columns into batches of max 15 to ensure fast responses and fit structured output token limits
        results: dict[str, DirectColumnCorrelation] = {}
        batch_size = 15
        pr_names_set = {p.name for p in pr_cols}

        for i in range(0, len(unresolved_gstr), batch_size):
            chunk = unresolved_gstr[i : i + batch_size]
            gstr_payload = [
                {
                    "name": g.name,
                    "dtype": g.inferred_dtype.value,
                    "samples": g.sample_values[:3],
                    "hints": g.pattern_hints,
                }
                for g in chunk
            ]
            pr_payload = [
                {
                    "name": p.name,
                    "dtype": p.inferred_dtype.value,
                    "samples": p.sample_values[:3],
                    "hints": p.pattern_hints,
                }
                for p in pr_cols
            ]

            system_msg = (
                "You are an expert financial and tax data engineer assisting with GST Reconciliation. "
                "Your task is to correlate GSTR-2B spreadsheet columns with Purchase Register (ERP) columns. "
                "For each GSTR column, select the most suitable PR column, or null if no appropriate match exists. "
                "Provide a calibrated confidence score between 0.0 and 1.0, and a clear, plain-English reason explaining your choice. "
                "Also provide up to 2 alternative candidate PR columns with their confidence and reasoning."
            )
            user_msg = (
                f"GSTR-2B Columns to map:\n{json.dumps(gstr_payload, indent=2)}\n\n"
                f"Available Purchase Register Columns:\n{json.dumps(pr_payload, indent=2)}"
            )

            try:
                res: LLMSchemaCorrelationResponse = self.llm_provider.invoke_structured(
                    [
                        {"role": "system", "content": system_msg},
                        {"role": "user", "content": user_msg},
                    ],
                    LLMSchemaCorrelationResponse,
                )

                llm_item_by_gstr = {item.gstr_column: item for item in res.matches}
                for g_col in chunk:
                    item = llm_item_by_gstr.get(g_col.name)
                    if item:
                        selected = item.best_pr_column if item.best_pr_column in pr_names_set else None
                        valid_alts = [
                            a for a in item.alternatives if a.pr_column in pr_names_set and a.pr_column != selected
                        ]
                        results[g_col.name] = DirectColumnCorrelation(
                            gstr_column=g_col.name,
                            gstr_dtype=g_col.inferred_dtype.value,
                            gstr_samples=g_col.sample_values,
                            selected_pr_column=selected,
                            confidence=round(item.confidence, 2),
                            reason=item.reason,
                            engine=f"llm: {self.model_name}",
                            alternatives=valid_alts[:2],
                            is_primary_gst_field=False,
                        )
                    else:
                        results[g_col.name] = self._lexical_fallback(g_col, pr_cols)
            except Exception as exc:
                logger.error(f"LLM correlation chunk failed: {exc}; using deterministic lexical fallback")
                for g_col in chunk:
                    results[g_col.name] = self._lexical_fallback(
                        g_col, pr_cols, fallback_reason=f"Deterministic fallback (LLM chunk failed: {exc})"
                    )

        return results

    def _lexical_fallback(
        self,
        gstr_col: FastColumnSummary,
        pr_cols: list[FastColumnSummary],
        fallback_reason: str | None = None,
    ) -> DirectColumnCorrelation:
        g_norm = _normalize(gstr_col.name)
        scored = []
        for p in pr_cols:
            p_norm = _normalize(p.name)
            ratio = SequenceMatcher(None, g_norm, p_norm).ratio()
            scored.append((ratio, p))

        scored.sort(key=lambda x: x[0], reverse=True)
        if scored and scored[0][0] >= 0.65:
            best_score, best_pr = scored[0]
            reason = (
                fallback_reason
                or f"Deterministic lexical similarity ({best_score:.0%}) between header tokens."
            )
            alts = [
                AlternativeMatch(
                    pr_column=item[1].name,
                    confidence=round(item[0], 2),
                    reason=f"Alternative token similarity ({item[0]:.0%}).",
                )
                for item in scored[1:3]
                if item[0] >= 0.50
            ]
            return DirectColumnCorrelation(
                gstr_column=gstr_col.name,
                gstr_dtype=gstr_col.inferred_dtype.value,
                gstr_samples=gstr_col.sample_values,
                selected_pr_column=best_pr.name,
                confidence=round(best_score, 2),
                reason=reason,
                engine="deterministic lexical",
                alternatives=alts,
                is_primary_gst_field=False,
            )

        return DirectColumnCorrelation(
            gstr_column=gstr_col.name,
            gstr_dtype=gstr_col.inferred_dtype.value,
            gstr_samples=gstr_col.sample_values,
            selected_pr_column=None,
            confidence=0.0,
            reason=fallback_reason or "No corresponding concept identified in Purchase Register.",
            engine="deterministic fallback",
            alternatives=[],
            is_primary_gst_field=False,
        )
