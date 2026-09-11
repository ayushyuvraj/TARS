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
        p = prompt.lower().strip()
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
        if p in ["reconcile", "run reconciliation", "execute reconciliation", "reconcile all", "run full pipeline"]:
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

    def build_grounded_system_prompt(
        self, stage_context: dict[str, Any] | None, current_page: str | None = None
    ) -> str:
        """Constructs a high-density, context-rich prompt reflecting the active stage state."""
        stage_name = stage_context.get("activeStage", "Reconciliation v2.0") if stage_context else "Reconciliation v2.0"
        stage_num = stage_context.get("stageNumber", 0) if stage_context else 0
        stage_label = stage_context.get("stageLabel", stage_name) if stage_context else stage_name

        context_lines = [
            f"You are TARS Copilot, a deterministic and advisory AI assistant for GST Reconciliation v2.0.",
            f"Active Screen: Stage {stage_num}: {stage_label} (Route: {current_page or 'reconciliations-v2'}).",
            f"Answer user questions accurately, professionally, and concisely. Keep answers grounded in the provided state.",
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

        return "\n".join(context_lines)

    async def stream_response(
        self,
        prompt: str,
        session_id: str | None,
        current_stage: str | None,
        stage_context: dict[str, Any] | None,
        history: list[dict[str, str]] | None = None,
    ) -> AsyncGenerator[str, None]:
        """Generates real-time Server-Sent Events (SSE) data stream."""
        # Check Fast Action Intent
        action_plan = self.classify_fast_intent(prompt, current_stage, stage_context)

        if action_plan:
            # Yield thinking badge
            action_name = action_plan.get("action", "")
            yield f"data: {json.dumps({'type': 'thought', 'message': f'Processing action: {action_name}'})}\n\n"

            # Execute action
            exec_result = self.execute_action(session_id, action_plan, prompt, stage_context)

            # Yield action event to frontend so UI reacts immediately
            yield f"data: {json.dumps({'type': 'action', 'action': action_plan.get('action'), 'payload': exec_result.get('data', {}), 'status': exec_result.get('status', 'success')})}\n\n"

            # Stream conversational confirmation
            explanation = exec_result.get("explanation", "Action completed successfully.")
            for word in explanation.split(" "):
                yield f"data: {json.dumps({'type': 'token', 'content': word + ' '})}\n\n"

            yield f"data: {json.dumps({'type': 'done', 'action_executed': True})}\n\n"
            return

        # Q&A Intent with Direct Context Injection
        target_label = stage_context.get("stageLabel", "Reconciliation v2.0") if stage_context else "Reconciliation"
        yield f"data: {json.dumps({'type': 'thought', 'message': f'Analyzing context for {target_label}'})}\n\n"

        system_prompt = self.build_grounded_system_prompt(stage_context, current_page=current_stage)
        messages = [{"role": "user", "content": prompt}]
        if history:
            messages = history[-6:] + messages

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
            for word in explanation_text.split(" "):
                yield f"data: {json.dumps({'type': 'token', 'content': word + ' '})}\n\n"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
            return

        if self.provider is None:
            # Deterministic intelligent fallback when LLM provider is not configured
            curr_stg = (stage_context.get("activeStage") if stage_context else "setup") or "setup"
            fallback_text = stage_explanations.get(
                curr_stg.lower(),
                f"I am actively monitoring **{stage_context.get('stageLabel', 'Reconciliation v2.0') if stage_context else 'the workspace'}**."
            )
            for word in fallback_text.split(" "):
                yield f"data: {json.dumps({'type': 'token', 'content': word + ' '})}\n\n"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
            return

        try:
            # Native sub-second stream
            for token in self.provider.stream_invoke(messages, system_prompt=system_prompt):
                if token:
                    yield f"data: {json.dumps({'type': 'token', 'content': token})}\n\n"
        except Exception as exc:
            logger.error(f"Stream generation error: {exc}")
            yield f"data: {json.dumps({'type': 'token', 'content': f'Error generating response: {exc}'})}\n\n"

        yield f"data: {json.dumps({'type': 'done'})}\n\n"
