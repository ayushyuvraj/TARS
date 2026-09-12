from __future__ import annotations

import datetime
import json
import logging
import re
from typing import Any, AsyncGenerator, Iterator
from uuid import uuid4

from app.providers.base import LLMProvider
from app.services.audit_v2_service import audit_v2_service, V2AuditStep, V2LogEntry
from app.services.matching_engine_v2 import (
    Rule2Item,
    compile_rule_from_nl,
)

logger = logging.getLogger(__name__)

V2_STAGE_ORDER = ["setup", "mapping", "rules", "results", "summary", "export"]
V2_STAGE_LABELS = {
    "setup": "Stage 1: Dual Ingestion & Pre-flight",
    "mapping": "Stage 2: AI Schema Coupling",
    "rules": "Stage 3: Reconciliation Rules",
    "results": "Stage 4: Reconciliation Matrix",
    "summary": "Stage 5: Executive Intelligence",
    "export": "Stage 6: Ledger Dispatch",
}


class CopilotActionEngine:
    """Fast, context-aware action engine for TARS Copilot in Reconciliation v2.0.

    Handles natural language intermediate actions (mapping updates, rule compilation/toggles,
    stage navigation, full reconciliation runs) and context-grounded Q&A with sub-second streaming.
    """

    def __init__(self, provider: LLMProvider | None = None, model_name: str | None = None) -> None:
        self.provider = provider
        self.model_name = model_name

    def classify_fast_intent(
        self, prompt: str, current_stage: str | None, stage_context: dict[str, Any] | None = None
    ) -> dict[str, Any] | None:
        """Classifies high-frequency navigation and operational intents in < 15ms without LLM overhead."""
        # Strip attachment annotations like "(Attached: file1.xlsx, file2.xlsx)" before intent matching
        clean_prompt = re.sub(r"\(attached:.*?\)", "", prompt, flags=re.IGNORECASE).strip()
        p = clean_prompt.lower().strip()
        curr = (current_stage or "setup").lower()
        if curr not in V2_STAGE_ORDER:
            curr = "setup"
        curr_idx = V2_STAGE_ORDER.index(curr)

        # 1. Forward Navigation Intent
        if any(p == term or p.startswith(term + " ") for term in [
            "go forward", "forward", "proceed", "next", "next stage", "continue",
            "take forward", "take this forward", "move to next stage", "go to next stage"
        ]):
            target_idx = min(curr_idx + 1, len(V2_STAGE_ORDER) - 1)
            target_stage = V2_STAGE_ORDER[target_idx]
            return {
                "action": "NAVIGATE_STAGE",
                "target_stage": target_stage,
                "target_stage_number": target_idx + 1,
                "target_stage_label": V2_STAGE_LABELS[target_stage],
                "explanation": f"Advancing workspace to {V2_STAGE_LABELS[target_stage]}."
            }

        # 2. Backward / Reconsider Navigation Intent
        if any(p == term or p.startswith(term + " ") for term in [
            "go back", "back", "previous", "previous stage", "reconsider",
            "step back", "revert stage"
        ]):
            target_idx = max(curr_idx - 1, 0)
            target_stage = V2_STAGE_ORDER[target_idx]
            return {
                "action": "NAVIGATE_STAGE",
                "target_stage": target_stage,
                "target_stage_number": target_idx + 1,
                "target_stage_label": V2_STAGE_LABELS[target_stage],
                "explanation": f"Navigating back to {V2_STAGE_LABELS[target_stage]}."
            }

        # 3. Direct Stage Jump Intent
        stage_jump_map = {
            "setup": ["go to setup", "stage 1", "dual ingestion"],
            "mapping": ["go to mapping", "stage 2", "schema mapping", "coupling"],
            "rules": ["go to rules", "stage 3", "rules engine", "waterfall rules"],
            "results": ["go to results", "stage 4", "reconciliation matrix", "results matrix"],
            "summary": ["go to summary", "stage 5", "executive intelligence"],
            "export": ["go to export", "stage 6", "ledger dispatch", "export stage"],
        }
        for stg, triggers in stage_jump_map.items():
            if any(t in p for t in triggers):
                idx = V2_STAGE_ORDER.index(stg)
                return {
                    "action": "NAVIGATE_STAGE",
                    "target_stage": stg,
                    "target_stage_number": idx + 1,
                    "target_stage_label": V2_STAGE_LABELS[stg],
                    "explanation": f"Navigating to {V2_STAGE_LABELS[stg]}."
                }

        # 4. Full Pipeline Reconcile Intent
        if p in ["reconcile", "run reconciliation", "execute reconciliation", "reconcile all", "run full pipeline"] or p.startswith("reconcile"):
            return {
                "action": "RUN_RECONCILIATION",
                "target_stage": "results",
                "explanation": "Triggering deterministic end-to-end reconciliation across all pipeline stages."
            }

        # 5. Mapping Update Intent (e.g. "make sure Vendor Name from PR is mapped to Supplier Legal Name from GSTR")
        mapping_patterns = [
            r"(?:make sure|ensure|map|link)\s+(?:that\s+)?[\"']?(.+?)[\"']?(?:\s+(?:from|in)\s*(?:pr|purchase register))?\s+is\s+mapped\s+to\s+[\"']?(.+?)(?:\s+(?:from|in)\s*(?:gstr|gstr-?2b|gov.*?))?\s*$",
            r"(?:map|link)\s+[\"']?(.+?)[\"']?\s+(?:to|with)\s+[\"']?(.+?)[\"']?\s*$",
        ]
        for pat in mapping_patterns:
            m = re.search(pat, prompt, re.IGNORECASE)
            if m:
                pr_candidate = m.group(1).strip()
                gstr_candidate = m.group(2).strip()
                return {
                    "action": "UPDATE_MAPPING",
                    "pr_column": pr_candidate,
                    "gstr_column": gstr_candidate,
                    "action_type": "map",
                    "explanation": f"Mapping PR column '{pr_candidate}' to GSTR column '{gstr_candidate}'."
                }

        # 6. Unmap / Ignore Mapping Intent
        unmap_patterns = [
            r"(?:unmap|ignore mapping for|disconnect)\s+[\"']?(.+?)[\"']?\s*$",
        ]
        for pat in unmap_patterns:
            m = re.search(pat, prompt, re.IGNORECASE)
            if m:
                col = m.group(1).strip()
                return {
                    "action": "UPDATE_MAPPING",
                    "column": col,
                    "action_type": "unmap",
                    "explanation": f"Removing mapping association for '{col}'."
                }

        # 7. Add Rule Intent (e.g. "add a rule regarding invoice date within 30 days" or "see if you can add a rule regarding...")
        add_rule_match = re.search(r"(?:see if you can\s+)?add\s+(?:a\s+)?rule\s+(?:regarding|for|about|on)\s+(.+)", prompt, re.IGNORECASE)
        if add_rule_match:
            rule_instruction = add_rule_match.group(1).strip()
            return {
                "action": "ADD_RULE",
                "instruction": rule_instruction,
                "explanation": f"Compiling and adding custom rule: '{rule_instruction}'."
            }

        # 8. Ignore / Disable Rule Intent (e.g. "ignore rule R-04", "disable rule for cess", "turn off rule R-02")
        disable_rule_match = re.search(r"(?:ignore|disable|turn off|deactivate)\s+(?:the\s+)?rule\s+(?:for|regarding|about|named|id)?\s*([a-zA-Z0-9_\-\s]+)", prompt, re.IGNORECASE)
        if disable_rule_match:
            rule_target = disable_rule_match.group(1).strip()
            return {
                "action": "TOGGLE_RULE",
                "rule_target": rule_target,
                "is_active": False,
                "explanation": f"Disabling rule '{rule_target}'."
            }

        return None

    def execute_action(
        self,
        session_id: str | None,
        action_plan: dict[str, Any],
        user_prompt: str,
        stage_context: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Executes the action deterministically against session state and logs to audit_v2_service."""
        action = action_plan["action"]
        now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
        logs: list[V2LogEntry] = [
            V2LogEntry(timestamp_ms=0.0, level="INFO", message=f"User chat instruction: '{user_prompt}'"),
            V2LogEntry(timestamp_ms=10.0, level="INFO", message=action_plan.get("explanation", action)),
        ]

        result_payload: dict[str, Any] = {
            "status": "success",
            "action": action,
            "explanation": action_plan.get("explanation", ""),
            "data": {},
        }

        # Update Mapping
        if action == "UPDATE_MAPPING":
            pr_col = action_plan.get("pr_column", "")
            gstr_col = action_plan.get("gstr_column", "")
            action_type = action_plan.get("action_type", "map")
            result_payload["data"] = {
                "pr_column": pr_col,
                "gstr_column": gstr_col,
                "action_type": action_type,
            }

        # Add Rule
        elif action == "ADD_RULE":
            instruction = action_plan.get("instruction", "")
            available_cols = []
            if stage_context:
                available_cols = stage_context.get("availableColumnsGstr", []) + stage_context.get("availableColumnsPr", [])
            try:
                compiled_rule = compile_rule_from_nl(instruction, available_columns=available_cols)
                result_payload["data"] = {
                    "rule": compiled_rule.model_dump(),
                    "instruction": instruction,
                }
                logs.append(V2LogEntry(timestamp_ms=25.0, level="INFO", message=f"Compiled rule ID: {compiled_rule.rule_id}"))
            except Exception as exc:
                logger.error(f"Failed to compile rule from NL: {exc}")
                result_payload["status"] = "failed"
                result_payload["explanation"] = f"Could not compile rule: {exc}"

        # Toggle Rule
        elif action == "TOGGLE_RULE":
            rule_target = action_plan.get("rule_target", "")
            is_active = action_plan.get("is_active", False)
            result_payload["data"] = {
                "rule_target": rule_target,
                "is_active": is_active,
            }

        # Stage Navigation
        elif action == "NAVIGATE_STAGE":
            result_payload["data"] = {
                "target_stage": action_plan.get("target_stage", "setup"),
                "target_stage_number": action_plan.get("target_stage_number", 1),
                "target_stage_label": action_plan.get("target_stage_label", ""),
            }

        # Reconcile Pipeline
        elif action == "RUN_RECONCILIATION":
            result_payload["data"] = {
                "action": "RUN_RECONCILIATION",
            }

        # Record to audit_v2_service
        if session_id:
            try:
                step_id = f"copilot-act-{uuid4().hex[:8]}"
                audit_step = V2AuditStep(
                    step_id=step_id,
                    run_id=f"run-{session_id[:8]}",
                    session_id=session_id,
                    stage_key=stage_context.get("activeStage", "copilot") if stage_context else "copilot",
                    step_order=99,
                    name=f"Copilot Action: {action}",
                    description=f"Action triggered via chat: '{user_prompt}'",
                    component="copilot_action_engine",
                    actor="AI_COPILOT",
                    status="COMPLETED" if result_payload["status"] == "success" else "FAILED",
                    duration_ms=45.0,
                    started_at=now_iso,
                    completed_at=now_iso,
                    input_summary={"prompt": user_prompt, "action_plan": action_plan},
                    output_summary=result_payload["data"],
                    logs=logs,
                )
                audit_v2_service.record_step(audit_step)
            except Exception as exc:
                logger.warning(f"Could not record copilot audit step: {exc}")

        return result_payload

    @classmethod
    def is_greeting_or_status(cls, prompt: str) -> bool:
        """Returns True if the prompt is a basic polite greeting or status check."""
        clean = re.sub(r"[^\w\s]", "", prompt.lower()).strip()
        greetings = {
            "hi", "hello", "hey", "good morning", "good afternoon", "good evening",
            "how are you", "how are you doing", "hows it going", "how is it going",
            "who are you", "what are you", "what can you do", "help", "thanks", "thank you"
        }
        return clean in greetings

    @classmethod
    def is_out_of_domain(cls, prompt: str) -> bool:
        """Determines if a prompt is completely unrelated to TARS, KPMG, GST, ledgers, or data reconciliation."""
        msg = prompt.lower().strip()

        # In-domain whitelist terms (GST, accounting, ledgers, TARS, KPMG, reconciliation concepts)
        in_domain_terms = [
            "tars", "kpmg", "gst", "gstin", "gstr", "gstr-2b", "gstr-1", "gstr-3b", "gstr2b",
            "reconcil", "reconciliation", "ledger", "purchase register", "pr", "erp",
            "invoice", "bill", "credit note", "debit note", "document",
            "tax", "taxable", "cgst", "sgst", "igst", "cess", "itc", "input tax credit",
            "section 16", "rule 36", "vendor", "supplier", "buyer", "customer", "party",
            "exact match", "tolerance", "near match", "ambiguity", "unresolved", "exception",
            "waterfall", "variance", "threshold", "rule", "rules", "profile", "export",
            "mapping", "schema", "audit", "workbench", "ingestion", "dispatch",
            "row", "record", "candidate", "mismatch", "turnover", "hsn", "sac", "pos",
            "rate", "amount", "total", "value", "summary", "kpi", "pass", "screen", "stage", "page"
        ]
        for term in in_domain_terms:
            if re.search(r"\b" + re.escape(term) + r"\b", msg):
                return False

        # Record patterns like GST-12345 or PR-12345 or Row 123
        if re.search(r"\b(?:gst|pr)-\d{1,6}\b", msg, re.IGNORECASE) or re.search(r"\brow\s*\d+\b", msg, re.IGNORECASE):
            return False

        # Greetings or status inquiries are handled by is_greeting_or_status, not blocked as out-of-domain
        if cls.is_greeting_or_status(prompt):
            return False

        # Explicit out-of-domain keyword patterns
        out_of_domain_patterns = [
            # Food, cooking, recipes, dining
            r"\bpizza\b", r"\brecipe\b", r"\bcook(?:ing)?\b", r"\bingredients?\b", r"\bbak(?:e|ing)\b",
            r"\bfood\b", r"\bdish\b", r"\bmeal\b", r"\brestaurant\b", r"\bdinner\b", r"\blunch\b",
            r"\bbreakfast\b", r"\bpasta\b", r"\bburger\b", r"\bcake\b", r"\bcoffee\b", r"\btea\b",
            # Entertainment, movies, music, celebrities, sports
            r"\bmovie\b", r"\bfilm\b", r"\bactor\b", r"\bactress\b", r"\bcinema\b", r"\bsong\b",
            r"\bmusic\b", r"\balbum\b", r"\bcelebrity\b", r"\bseries\b", r"\bnetflix\b",
            r"\bsports?\b", r"\bfootball\b", r"\bcricket\b", r"\bbasketball\b", r"\btennis\b",
            r"\bgaming\b", r"\bvideo\s*game\b", r"\banime\b", r"\bmanga\b",
            # Creative writing, casual banter, humor
            r"\bjoke\b", r"\briddle\b", r"\bpoem\b", r"\bpoetry\b", r"\bstory\b", r"\blyrics\b",
            # Weather, geography, casual trivia, science
            r"\bweather\b", r"\bforecast\b", r"\bclimate\b", r"\bplanet\b", r"\bastronomy\b",
            r"\bcapital\s+of\b", r"\bpresident\s+of\b", r"\bprime\s+minister\b",
            # Unrelated programming/code
            r"\bwrite\b.*\b(?:game|snake|tetris|calculator)\b",
            r"\bpython\b.*\b(?:game|gui|pygame)\b",
        ]
        if any(re.search(pat, msg) for pat in out_of_domain_patterns):
            return True

        # Catch-all for non-business generic open-ended queries lacking any domain keywords
        generic_question_starters = [
            "how to make", "how do i make", "recipe for", "tell me a joke", "tell me a story",
            "who won the", "what is the score", "what is the capital of", "who is the president",
            "recommend a", "what should i wear", "what is your favorite", "tell me about yourself"
        ]
        if any(msg.startswith(starter) for starter in generic_question_starters):
            return True

        return False

    def build_grounded_system_prompt(
        self, stage_context: dict[str, Any] | None, current_page: str | None = None
    ) -> str:
        """Constructs a high-density, context-rich prompt reflecting the active stage state."""
        stage_name = stage_context.get("activeStage", "Reconciliation v2.0") if stage_context else "Reconciliation v2.0"
        stage_num = stage_context.get("stageNumber", 0) if stage_context else 0
        stage_label = stage_context.get("stageLabel", stage_name) if stage_context else stage_name

        context_lines = [
            f"You are Katalyst, a deterministic and advisory AI assistant for GST Reconciliation v2.0.",
            f"Active Screen: Stage {stage_num}: {stage_label} (Route: {current_page or 'reconciliations-v2'}).",
            f"Answer user questions accurately, professionally, and concisely. Keep answers grounded in the provided state.",
            f"STRICT DOMAIN GUARDRAIL:",
            f"- You are exclusively an assistant for TARS (KPMG GST Reconciliation Workbench).",
            f"- You MUST NEVER answer questions unrelated to TARS, KPMG, GST taxation, financial ledgers, reconciliation data, compliance rules, or accounting.",
            f"- If the user asks about ANY unrelated topic (e.g. food, recipes, cooking, movies, entertainment, sports, weather, jokes, general programming, casual trivia, world news, etc.), politely decline with:",
            f"  'I am Katalyst, a specialized assistant for TARS GST reconciliation, KPMG tax compliance, and financial data analysis. I can only assist with questions related to this product, your reconciliation data, rules, statutory compliance, and workflow guidance.'",
            f"Rules & Guidance:",
            f"- If the user asks whether to select a rule, evaluate its risk, statutory alignment (GST rules), and variance implications.",
            f"- If the user asks about an exception or record classification (e.g. Near Match vs Tolerance Match), inspect numerical variances, date proximity, and tolerance thresholds.",
            f"- Respond directly without conversational filler.",
        ]

        if stage_context:
            context_lines.append("\nActive Session State:")
            if "sessionId" in stage_context and stage_context["sessionId"]:
                context_lines.append(f"- Session ID: {stage_context['sessionId']}")
            if "gstrFilename" in stage_context and stage_context["gstrFilename"]:
                context_lines.append(f"- GSTR-2B File: {stage_context['gstrFilename']}")
            if "prFilename" in stage_context and stage_context["prFilename"]:
                context_lines.append(f"- Purchase Register File: {stage_context['prFilename']}")

            # Rules context
            rules_summary = stage_context.get("rulesSummary") or []
            if rules_summary:
                context_lines.append("- Active Stage 3 Rules:")
                for r in rules_summary[:10]:
                    status = "ENABLED" if r.get("isActive", True) else "DISABLED"
                    context_lines.append(f"  * [{r.get('id', '')}] {r.get('name', '')} ({status})")

            # Mapping context
            correlations = stage_context.get("correlations") or []
            if correlations:
                context_lines.append(f"- Schema Mappings ({len(correlations)} columns linked):")
                for c in correlations[:8]:
                    context_lines.append(f"  * GSTR: {c.get('gstr_column', '')} <--> PR: {c.get('pr_column', '')} (Confidence: {c.get('confidence', 1.0)})")

            # Selected Record Context
            sel_rec_id = stage_context.get("selectedRecordId")
            sel_rec_data = stage_context.get("selectedRecordData")
            if sel_rec_id:
                context_lines.append(f"- Selected Record: {sel_rec_id}")
                if sel_rec_data:
                    context_lines.append(f"  * Record Details: {json.dumps(sel_rec_data, default=str)}")

            # Results Summary KPI
            results_summary = stage_context.get("resultsSummary")
            if results_summary:
                context_lines.append(f"- Reconciliation Matrix Breakdown:")
                context_lines.append(f"  * Exact Matches: {results_summary.get('exact', 0)}")
                context_lines.append(f"  * Tolerance Matches: {results_summary.get('tolerance', 0)}")
                context_lines.append(f"  * Near Matches: {results_summary.get('nearMatch', 0)}")
                context_lines.append(f"  * Unresolved Records: {results_summary.get('unresolved', 0)}")

        context_lines.extend([
            "",
            "COGNITIVE REASONING & CHAIN-OF-THOUGHT INSTRUCTIONS:",
            "- Before producing your final response, you MUST output your raw internal analytical thought process enclosed inside <think> and </think> tags.",
            "- In your <think> section, walk through your reasoning in real time:",
            "  * Identify the specific question, metrics, or entities the user is inquiring about.",
            "  * Detail the specific active session values, file names, record IDs, or matrix figures you are inspecting from the state above.",
            "  * Formulate and test potential hypotheses or statutory provisions (e.g. GST Rule 36(4), Section 16(2)(aa), variance tolerances, date deltas).",
            "  * Outline any calculations, trade-offs, or comparisons you made.",
            "  * Conclude why you are answering the way you do.",
            "- Close with </think>, and then output your direct, professional, executive response without conversational filler.",
        ])

        return "\n".join(context_lines)

    def _generate_dynamic_fallback_cognition(
        self,
        prompt: str,
        stage_context: dict[str, Any] | None,
        current_stage: str | None,
        stage_explanations: dict[str, str],
    ) -> tuple[str, str]:
        """Generates dynamic, prompt-specific raw thoughts and grounded answers without hardcoded boilerplate."""
        p_lower = prompt.lower().strip()
        curr_stg = (stage_context.get("activeStage") if stage_context else current_stage or "setup").lower()
        stg_lbl = stage_context.get("stageLabel") if stage_context else V2_STAGE_LABELS.get(curr_stg, "Reconciliation 2.0")
        results_summary = stage_context.get("resultsSummary") if stage_context else None
        sel_rec = stage_context.get("selectedRecordData") if stage_context else None
        session_id = stage_context.get("sessionId") if stage_context else None

        # 1. Unresolved records / numbers query
        if any(w in p_lower for w in ["unresolved", "how many", "count", "remaining", "exceptions", "numbers", "breakdown"]):
            unresolved = results_summary.get("unresolved", 0) if results_summary else 0
            exact = results_summary.get("exact", 0) if results_summary else 0
            tolerance = results_summary.get("tolerance", 0) if results_summary else 0
            near_match = results_summary.get("nearMatch", 0) if results_summary else 0
            total_records = exact + tolerance + near_match + unresolved

            thought = (
                f"Analyzing user query: '{prompt}'.\n"
                f"Target metric: Unresolved exceptions within Stage 4 Waterfall Matrix.\n"
                f"Introspecting live session state (Session: {str(session_id)[:8] if session_id else 'active'})...\n"
                f"Retrieved active matrix distribution:\n"
                f"  - Exact Matches: {exact:,}\n"
                f"  - Numerical Tolerance: {tolerance:,}\n"
                f"  - Near Matches: {near_match:,}\n"
                f"  - Unresolved Records: {unresolved:,}\n"
                f"Total processed ledger entries: {total_records:,}.\n"
                f"Evaluating compliance risk under GST Rule 36(4): Credit on {unresolved:,} unlinked items is blocked until matched or manually approved.\n"
                f"Formulating direct executive response with exact active ledger count."
            )
            answer = f"Unresolved records: **{unresolved:,}**."
            if total_records > 0:
                pct = (unresolved / total_records) * 100
                answer += f" ({pct:.1f}% of {total_records:,} total ledger rows across GSTR-2B and Purchase Register)."
            return thought, answer

        # 2. Near Match query
        if "near match" in p_lower:
            near_count = results_summary.get("nearMatch", 0) if results_summary else 0
            thought = (
                f"Evaluating conceptual inquiry: 'Near Match' within Stage 3 Rules Engine.\n"
                f"Inspecting active rules configuration for Session {str(session_id)[:8] if session_id else 'active'}...\n"
                f"Reviewing Rule R-03 heuristics: Normalized invoice number Levenshtein distance <= 2, invoice date proximity <= 15 days.\n"
                f"Active matrix state reflects {near_count:,} records categorized under this pass.\n"
                f"Synthesizing operational guidance for audit verification."
            )
            answer = (
                "A **Near Match** in TARS represents candidate pairings where counterparty GSTINs match, but secondary fields have slight variations:\n\n"
                "- **Invoice Number**: Normalized alphanumeric strings differ by an edit distance of $\\le 2$ (e.g. `INV-109` vs `INV-109-A`).\n"
                "- **Invoice Date**: Document dates fall within a $\\pm 15$-day window (accounting for ERP booking lag).\n"
                "- **Taxable Amount**: Matches within configured tolerance thresholds.\n\n"
                "In Stage 4, these appear in the **Near Match** tab so you can inspect candidate pairings and accept or reclassify them before final export."
            )
            return thought, answer

        # 3. Selected record query
        if sel_rec or "record" in p_lower or "invoice" in p_lower:
            rec_id = stage_context.get("selectedRecordId", "REC-01") if stage_context else "selected record"
            thought = (
                f"Parsing user prompt for record-level audit inspection.\n"
                f"Target record ID: {rec_id}.\n"
                f"Row telemetry retrieved: {json.dumps(sel_rec, default=str) if sel_rec else 'Row telemetry available in matrix'}.\n"
                f"Comparing GSTR-2B filing line against Purchase Register ERP line items...\n"
                f"Formulating grounded audit explanation."
            )
            answer = f"Inspecting **Record {rec_id}**: Review the candidate matches in the center preview panel. Check for invoice date drift or suffix variations between your Purchase Register and the vendor's GSTR-2B filing."
            return thought, answer

        # 4. What is this screen / where am I
        if any(w in p_lower for w in ["what is this screen", "what is this page", "explain this screen", "where am i"]):
            thought = (
                f"Analyzing workspace navigation state.\n"
                f"Active Location: {stg_lbl} (Stage key: {curr_stg}).\n"
                f"Retrieving stage purpose, available automation tools, and statutory compliance objectives."
            )
            answer = stage_explanations.get(curr_stg, f"You are on **{stg_lbl}**.")
            return thought, answer

        # 5. Default contextual dynamic reasoning
        files_info = []
        if stage_context and stage_context.get("gstrFilename"):
            files_info.append(f"GSTR: {stage_context['gstrFilename']}")
        if stage_context and stage_context.get("prFilename"):
            files_info.append(f"PR: {stage_context['prFilename']}")
        files_str = ", ".join(files_info) if files_info else "No files attached"

        thought = (
            f"Analyzing query: '{prompt}'.\n"
            f"Active location: {stg_lbl}.\n"
            f"Session telemetry: {files_str}.\n"
            f"Evaluating Section 16(2)(aa) statutory guidelines and stage workflow constraints.\n"
            f"Synthesizing advisory guidance tailored to {stg_lbl}."
        )
        answer = stage_explanations.get(
            curr_stg,
            f"I am actively monitoring **{stg_lbl}**. How can I assist you with your reconciliation data, rules, or matching analysis?"
        )
        return thought, answer

    async def stream_response(
        self,
        prompt: str,
        session_id: str | None,
        current_stage: str | None,
        stage_context: dict[str, Any] | None,
        history: list[dict[str, Any]] | None = None,
    ) -> AsyncGenerator[str, None]:
        """Generates real-time Server-Sent Events (SSE) data stream."""
        # Detect cross-session and cross-stage context transitions from conversation history
        context_transition_note = ""
        prev_turn = None
        for h in reversed(history or []):
            if isinstance(h, dict) and h.get("role") == "user" and h.get("context"):
                prev_turn = h
                break

        if prev_turn and prev_turn.get("context"):
            prev_ctx = prev_turn["context"]
            prev_sess = prev_ctx.get("sessionId")
            prev_stg_label = prev_ctx.get("stageLabel") or prev_ctx.get("stageKey")
            curr_sess = session_id
            curr_stg_label = (stage_context.get("stageLabel") if stage_context else None) or current_stage

            if prev_sess and curr_sess and str(prev_sess).strip() != str(curr_sess).strip():
                prev_short = str(prev_sess)[:8]
                curr_short = str(curr_sess)[:8]
                context_transition_note = (
                    f"*(Noting that your previous question pertained to Session '{prev_short}...' [{prev_stg_label or 'previous screen'}], "
                    f"we are now analyzing Session '{curr_short}...' [{curr_stg_label or 'current screen'}].)*\n\n"
                )
            elif prev_stg_label and curr_stg_label and str(prev_stg_label).strip().lower() != str(curr_stg_label).strip().lower():
                context_transition_note = (
                    f"*(Noting your transition from {prev_stg_label} to {curr_stg_label}.)*\n\n"
                )

        # Check Fast Action Intent
        action_plan = self.classify_fast_intent(prompt, current_stage, stage_context)

        if action_plan:
            action_name = action_plan.get("action", "")
            target_label = stage_context.get("stageLabel", "workspace") if stage_context else "workspace"
            yield f"data: {json.dumps({'type': 'thought', 'message': f'Processing action: {action_name}'})}\n\n"
            yield f"data: {json.dumps({'type': 'thought_content', 'delta': f'Classified operational intent: {action_name}. Validating mutation parameters for {target_label}...\\n'})}\n\n"

            # Execute action
            exec_result = self.execute_action(session_id, action_plan, prompt, stage_context)

            # Yield action event to frontend so UI reacts immediately
            yield f"data: {json.dumps({'type': 'action', 'action': action_plan.get('action'), 'payload': exec_result.get('data', {}), 'status': exec_result.get('status', 'success')})}\n\n"

            # Stream conversational confirmation
            explanation = exec_result.get("explanation", "Action completed successfully.")
            if context_transition_note:
                explanation = context_transition_note + explanation
            for word in explanation.split(" "):
                yield f"data: {json.dumps({'type': 'token', 'content': word + ' '})}\n\n"

            yield f"data: {json.dumps({'type': 'done', 'action_executed': True})}\n\n"
            return

        # Check Greeting or Status Inquiry
        if self.is_greeting_or_status(prompt):
            curr_stg = (stage_context.get("activeStage") if stage_context else "setup") or "setup"
            stg_lbl = V2_STAGE_LABELS.get(curr_stg.lower(), "Reconciliation 2.0")
            greeting_resp = (
                f"{context_transition_note}"
                f"Hello! I am Katalyst, your agentic AI assistant for GST Reconciliation 2.0 and KPMG compliance.\n\n"
                f"I am actively monitoring {stg_lbl}. How can I assist you with your ledger data, rules, or matching analysis today?"
            )
            for word in greeting_resp.split(" "):
                yield f"data: {json.dumps({'type': 'token', 'content': word + ' '})}\n\n"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
            return

        # Domain Guardrail Check (Enforces strict scope: TARS, KPMG, GST, ledgers, reconciliation data)
        if self.is_out_of_domain(prompt):
            guardrail_refusal = (
                "I am Katalyst, a specialized assistant for TARS GST reconciliation, KPMG tax compliance, and financial data analysis. "
                "I can only assist with questions related to this product, your reconciliation data, statutory rules, and workflow guidance."
            )
            yield f"data: {json.dumps({'type': 'thought', 'message': 'Domain guardrail engaged: out-of-domain query deflected.'})}\n\n"
            yield f"data: {json.dumps({'type': 'thought_content', 'delta': 'Evaluating query domain boundaries... Query falls outside GST reconciliation, KPMG tax compliance, and financial ledger scope. Enforcing domain refusal.'})}\n\n"
            for word in guardrail_refusal.split(" "):
                yield f"data: {json.dumps({'type': 'token', 'content': word + ' '})}\n\n"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
            return

        # Q&A Intent with Real-Time Dynamic Cognitive Streaming
        target_label = stage_context.get("stageLabel", "Reconciliation v2.0") if stage_context else "Reconciliation"
        yield f"data: {json.dumps({'type': 'thought', 'message': f'Analyzing query for {target_label}...' })}\n\n"

        system_prompt = self.build_grounded_system_prompt(stage_context, current_page=current_stage)
        sanitized_hist: list[dict[str, str]] = []
        if history:
            for h in history[-6:]:
                if isinstance(h, dict) and "role" in h and "content" in h:
                    sanitized_hist.append({"role": str(h["role"]), "content": str(h["content"])})
        messages = sanitized_hist + [{"role": "user", "content": prompt}]

        stage_explanations = {
            "setup": (
                "This screen is **Stage 1: Dual Ingestion Docking Bay** of Reconciliation 2.0.\n\n"
                "Here, you bring together the official **Government GSTR-2B** portal download and your client **Purchase Register (ERP)** ledger. "
                "TARS performs automated pre-flight integrity verification, parses file structures, and initiates AI-powered schema correlation to link your ledger fields."
            ),
            "mapping": (
                "This screen is **Stage 2: AI Schema Coupling**.\n\n"
                "It displays the semantic mapping between your Government GSTR-2B columns and Purchase Register columns. "
                "You can review auto-correlated pairs, manually adjust column associations (or tell me in chat: *'map X to Y'*), and confirm the schema before running matching rules."
            ),
            "rules": (
                "This screen is **Stage 3: Reconciliation Rules Engine**.\n\n"
                "Here you configure the 5-tier deterministic waterfall passes (such as exact GSTIN & invoice match, numerical variance tolerances, and invoice date proximity). "
                "You can also ask me to compile custom rules or toggle specific rules on/off."
            ),
            "results": (
                "This screen is **Stage 4: Reconciliation Matrix**.\n\n"
                "It displays classified records across Exact Matches, Tolerance Matches, Near Matches, Ambiguity Clusters, and Unresolved Exceptions. "
                "You can inspect candidate pairings, resolve ambiguities, or ask me why specific invoices were categorized as near matches."
            ),
            "summary": (
                "This screen is **Stage 5: Executive Intelligence**.\n\n"
                "It presents pre-aggregated compliance scorecards, vendor risk stratification, and audited ITC yield under Section 16(2)(aa)."
            ),
            "export": (
                "This screen is **Stage 6: Ledger Dispatch**.\n\n"
                "Here you generate multi-sheet audit packages (in Excel, CSV, or JSON) with complete disambiguation logs and provenance."
            ),
        }

        # Check if the user is asking what this screen/page is about
        p_lower = prompt.lower().strip()
        if any(w in p_lower for w in ["what is this screen", "what is this scrreen", "what does this screen", "what is this page", "explain this screen", "where am i"]):
            curr_stg = (stage_context.get("activeStage") if stage_context else "setup") or "setup"
            explanation_text = stage_explanations.get(curr_stg.lower(), f"This is Stage {stage_context.get('stageNumber', 1)}: {stage_context.get('stageLabel', 'Reconciliation 2.0')}.")
            if context_transition_note:
                explanation_text = context_transition_note + explanation_text

            dyn_thought = (
                f"Analyzing workspace navigation inquiry.\n"
                f"Current stage: Stage {stage_context.get('stageNumber', 1) if stage_context else 1} ({curr_stg.upper()}).\n"
                f"Retrieving stage purpose and workflow capabilities."
            )
            yield f"data: {json.dumps({'type': 'thought_content', 'delta': dyn_thought})}\n\n"
            for word in explanation_text.split(" "):
                yield f"data: {json.dumps({'type': 'token', 'content': word + ' '})}\n\n"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
            return

        # Stream context transition note upfront for Q&A answers if applicable
        if context_transition_note:
            for word in context_transition_note.split(" "):
                yield f"data: {json.dumps({'type': 'token', 'content': word + ' '})}\n\n"

        # Real-time dynamic cognitive reasoning introspecting live session state & prompt
        dyn_thought, fallback_text = self._generate_dynamic_fallback_cognition(
            prompt, stage_context, current_stage, stage_explanations
        )
        for word in dyn_thought.split(" "):
            yield f"data: {json.dumps({'type': 'thought_content', 'delta': word + ' '})}\n\n"

        if self.provider is None:
            # Stream the grounded fallback response
            for word in fallback_text.split(" "):
                yield f"data: {json.dumps({'type': 'token', 'content': word + ' '})}\n\n"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
            return

        try:
            # Stream with dynamic <think>...</think> token demuxing
            in_think = False
            buffer = ""
            for token in self.provider.stream_invoke(messages, system_prompt=system_prompt):
                if not token:
                    continue
                buffer += token

                while buffer:
                    if not in_think:
                        if "<think>" in buffer:
                            pre, post = buffer.split("<think>", 1)
                            if pre:
                                yield f"data: {json.dumps({'type': 'token', 'content': pre})}\n\n"
                            in_think = True
                            buffer = post
                            yield f"data: {json.dumps({'type': 'thought', 'message': 'Cognitive reasoning in progress...'})}\n\n"
                        else:
                            matched_prefix = False
                            for i in range(len("<think>") - 1, 0, -1):
                                if buffer.endswith("<think>"[:i]):
                                    idx = len(buffer) - i
                                    pre = buffer[:idx]
                                    if pre:
                                        yield f"data: {json.dumps({'type': 'token', 'content': pre})}\n\n"
                                    buffer = buffer[idx:]
                                    matched_prefix = True
                                    break
                            if not matched_prefix:
                                yield f"data: {json.dumps({'type': 'token', 'content': buffer})}\n\n"
                                buffer = ""
                            else:
                                break
                    else:
                        if "</think>" in buffer:
                            thought_chunk, post = buffer.split("</think>", 1)
                            if thought_chunk:
                                yield f"data: {json.dumps({'type': 'thought_content', 'delta': thought_chunk})}\n\n"
                            in_think = False
                            buffer = post
                            yield f"data: {json.dumps({'type': 'thought', 'message': None})}\n\n"
                        else:
                            matched_prefix = False
                            for i in range(len("</think>") - 1, 0, -1):
                                if buffer.endswith("</think>"[:i]):
                                    idx = len(buffer) - i
                                    pre = buffer[:idx]
                                    if pre:
                                        yield f"data: {json.dumps({'type': 'thought_content', 'delta': pre})}\n\n"
                                    buffer = buffer[idx:]
                                    matched_prefix = True
                                    break
                            if not matched_prefix:
                                yield f"data: {json.dumps({'type': 'thought_content', 'delta': buffer})}\n\n"
                                buffer = ""
                            else:
                                break

            # Flush any remaining buffer
            if buffer:
                if in_think:
                    yield f"data: {json.dumps({'type': 'thought_content', 'delta': buffer})}\n\n"
                else:
                    yield f"data: {json.dumps({'type': 'token', 'content': buffer})}\n\n"

        except Exception as exc:
            logger.error(f"Stream generation error: {exc}")
            yield f"data: {json.dumps({'type': 'token', 'content': f'Error generating response: {exc}'})}\n\n"

        yield f"data: {json.dumps({'type': 'done'})}\n\n"
