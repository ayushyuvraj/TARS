from __future__ import annotations

import json
import re
from time import perf_counter
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from app.domain.models import (
    ActorType, AgentEvent, CopilotConversation, CopilotMessage, CopilotRequest,
    CopilotResponse, ExceptionSearchRequest, PolicySimulationRequest,
    SemanticCategory, SuggestedAction,
)
from app.providers.base import LLMProvider, ProviderError
from app.services.exception_tools import ExceptionToolError, ExceptionToolService
from app.services.reconciliation import ReconciliationService

if TYPE_CHECKING:
    from app.services.governance import GovernanceService
    from app.services.investigation import AIInvestigationService


class CopilotService:
    """Bounded tool orchestrator; tools establish facts before any prose is generated."""

    def __init__(self, reconciliation: ReconciliationService, tools: ExceptionToolService,
                 provider: LLMProvider | None, model_name: str | None,
                 governance: "GovernanceService | None" = None,
                 investigation: "AIInvestigationService | None" = None) -> None:
        self.reconciliation = reconciliation
        self.tools = tools
        self.provider = provider
        self.model_name = model_name
        self.governance = governance
        self.investigation = investigation

    def conversation(
        self, reconciliation_id: UUID, conversation_id: UUID, limit: int = 40,
    ) -> CopilotConversation:
        self.reconciliation.get(reconciliation_id)
        return CopilotConversation(
            conversation_id=conversation_id, reconciliation_id=reconciliation_id,
            messages=self.reconciliation.repository.list_copilot_messages(
                reconciliation_id, conversation_id, min(limit, 40)
            ),
        )

    @classmethod
    def _is_independent_intent(cls, message: str) -> bool:
        msg = message.lower().strip()
        if any(term in msg for term in [
            "what can this app do", "what can tars do", "what does this app do", "what is tars",
            "app capabilities", "how to use tars", "how does tars work", "what is near match",
            "what is tolerance", "how to export", "how do i export"
        ]):
            return True
        if any(phrase in msg for phrase in ["what can", "what does", "how to", "how do i", "how does", "what is", "tell me about", "help with"]) and \
           any(term in msg for term in ["app", "tars", "workbench", "system", "capability", "capabilities", "do", "near match", "tolerance", "gst only", "pr only", "exception", "exceptions", "export", "workflow", "feature", "help"]):
            return True

        if any(phrase in msg for phrase in [
            "population breakdown", "population summary", "reconciliation summary", "reconciliation breakdown",
            "reconciliation status", "exact matches", "tolerance matches", "near matches", "unresolved records",
            "total records", "how many exact", "how many unresolved", "how many records", "how many items",
            "how many matched", "reconciliation overview", "reconciliation population"
        ]) or ("how many" in msg and ("reconcil" in msg or "match" in msg or "unresolved" in msg or "record" in msg or "item" in msg)):
            return True

        if "rule" in msg or "profile" in msg:
            return True

        if "pattern" in msg or "signature" in msg or "trend" in msg or "largest" in msg or "top" in msg or "biggest" in msg:
            return True

        if re.search(r"\b(?:GST|PR)-\d{5}\b", message, re.IGNORECASE) or (re.search(r"\b(?:row\s*)?(\d{1,5})\b", message, re.IGNORECASE) and "row" in msg):
            return True

        return False

    @classmethod
    def _is_referential_followup(cls, message: str) -> bool:
        msg = message.lower().strip()
        if cls._is_independent_intent(message):
            return False
        referential_phrases = [
            "its candidate", "the candidate", "that candidate", "what about candidate", "candidate",
            "why is that", "explain that", "explain this", "explain that simply", "explain simply",
            "simplify", "which one", "which candidate", "what should i do", "show me the difference",
            "tell me more", "elaborate", "can you simplify", "what does that mean"
        ]
        if any(phrase in msg for phrase in referential_phrases):
            return True
        if msg in ["why", "why?", "why is it", "how so", "how so?"]:
            return True
        words = msg.split()
        if len(words) <= 5 and any(w in words for w in ["it", "this", "that", "why", "candidate", "candidates", "they", "them"]):
            return True
        return False

    def _resolve_record_id(self, reconciliation_id: UUID, conversation_id: UUID | None, message: str, selected: str | None) -> str | None:
        match = re.search(r"\b(?:GST|PR)-\d{5}\b", message, re.IGNORECASE)
        if match:
            return match.group(0).upper()
        row_match = re.search(r"\b(?:row\s*)?(\d{1,5})\b", message, re.IGNORECASE)
        if row_match and "row" in message.lower():
            return f"row {row_match.group(1)}"
        if selected and not self._is_independent_intent(message):
            return selected
        if conversation_id and self._is_referential_followup(message):
            recent = self.reconciliation.repository.list_copilot_messages(reconciliation_id, conversation_id, limit=5)
            for msg in reversed(recent):
                if msg.selected_record_id:
                    return msg.selected_record_id
                m = re.search(r"\b(?:GST|PR)-\d{5}\b", msg.content, re.IGNORECASE)
                if m:
                    return m.group(0).upper()
        return None

    @staticmethod
    def _clean_formatting(text: str) -> str:
        if not text:
            return text
        return (
            text.replace(r"\*\*", "**")
            .replace(r"\-", "-")
            .replace("&#x20;", " ")
            .replace("&amp;", "&")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
        )

    @staticmethod
    def _is_out_of_domain(message: str) -> bool:
        msg = message.lower().strip()
        unrelated_patterns = [
            r"\bpizza\b", r"\brecipe\b", r"\bcook(?:ing)?\b", r"\bingredients\b",
            r"\bmovie\b", r"\bweather\b", r"\bsports?\b", r"\bfootball\b", r"\bcricket\b",
            r"\bjoke\b", r"\bpoem\b", r"\bsong\b", r"\bstory\b",
        ]
        if any(re.search(pat, msg) for pat in unrelated_patterns):
            if not any(k in msg for k in ["tars", "gst", "reconciliation", "invoice", "register"]):
                return True
        if re.search(r"\bwrite\b.*\bcode\b.*\bgame\b", msg) or re.search(r"\bpython\b.*\bgame\b", msg):
            return True
        return False

    def _get_dialogue_history(self, reconciliation_id: UUID, conversation_id: UUID, limit: int = 8) -> list[dict[str, Any]]:
        recent = self.reconciliation.repository.list_copilot_messages(reconciliation_id, conversation_id, limit=limit)
        history = []
        for msg in recent:
            item = {"role": msg.role, "content": msg.content}
            if msg.role == "assistant" and msg.response and msg.response.evidence:
                item["evidence_summary"] = [f"{e.reference_type}:{e.reference_id}" for e in msg.response.evidence[:3]]
            history.append(item)
        return history

    def ask(self, reconciliation_id: UUID, request: CopilotRequest) -> CopilotResponse:
        conversation_id = request.conversation_id or uuid4()
        self.reconciliation.repository.save_copilot_message(CopilotMessage(
            conversation_id=conversation_id, reconciliation_id=reconciliation_id,
            role="user", content=request.message, selected_record_id=request.selected_record_id,
        ))
        self.reconciliation.repository.add_event(AgentEvent(
            event_type="copilot.request_received", reconciliation_id=reconciliation_id,
            actor_type=ActorType.USER, component="copilot_orchestrator", result="received",
            metadata={"conversation_id": str(conversation_id),
                      "selected_record_id": request.selected_record_id,
                      "current_page": request.current_page},
        ))

        # Domain Boundary Check
        if self._is_out_of_domain(request.message):
            answer = ("I am TARS Copilot, a specialized assistant for TARS GST reconciliation, data analysis, rules, and workflow guidance. "
                      "I am limited to TARS, GST reconciliation, loaded reconciliation data, rules, workflow, and product assistance.")
            response = CopilotResponse(
                conversation_id=conversation_id, answer=answer, evidence=[],
                tool_calls=[], suggested_actions=[], requires_human_action=False,
                provider="domain_blocked", model=None,
            )
            self.reconciliation.repository.save_copilot_message(CopilotMessage(
                conversation_id=conversation_id, reconciliation_id=reconciliation_id,
                role="assistant", content=response.answer,
                selected_record_id=request.selected_record_id, response=response,
            ))
            return response

        # AI Availability Check
        if self.provider is None:
            answer = ("AI Copilot is currently unavailable because the configured LLM provider is not ready. "
                      "Deterministic reconciliation results remain unaffected.")
            response = CopilotResponse(
                conversation_id=conversation_id, answer=answer, evidence=[],
                tool_calls=[], suggested_actions=[], requires_human_action=False,
                provider="unavailable", model=None,
            )
            self.reconciliation.repository.save_copilot_message(CopilotMessage(
                conversation_id=conversation_id, reconciliation_id=reconciliation_id,
                role="assistant", content=response.answer,
                selected_record_id=request.selected_record_id, response=response,
            ))
            return response

        message_lower = request.message.lower().strip()
        history = self._get_dialogue_history(reconciliation_id, conversation_id, limit=8)
        calls, evidence, actions = [], [], []

        # Tool Decision Prompting & Intent Resolution
        tool_decision_prompt = f"""You are the Tool Orchestrator for TARS Copilot.
Your job is to inspect the user's message and recent dialogue history, resolve any conversational references, and decide which read-only TARS tools (up to 4) to run.

Recent Dialogue History:
{json.dumps(history[:-1], default=str)}

Current Context:
- User Question: "{request.message}"
- Selected Record ID: {request.selected_record_id or 'None'}
- Current Page: {request.current_page or 'None'}

Available Read-Only Tools:
1. "get_product_help": Use for product questions, UI navigation ("where can I see audit", "how to start new reconciliation", "where are these records"), workflow questions ("how to use this app"), or explaining specific concepts like "PR Only", "2452 records", "Near Match", "Tolerance Match". Parameter: {{"topic": "<specific_topic>"}}
2. "get_reconciliation_summary": Use ONLY when user explicitly asks for overall reconciliation totals, population breakdown, or exact match counts. Parameter: {{}}
3. "get_exception_breakdown": Use ONLY when user explicitly asks for exception queue breakdown (Ambiguous, Material Mismatch, GST Only, PR Only counts). Parameter: {{}}
4. "get_record": Use when user asks about a specific record ID (e.g. GST-00761). Parameter: {{"record_id": "<record_id>"}}
5. "lookup_record": Use when user asks about a row index (e.g. row 776). Parameter: {{"record_id": "row 776"}}
6. "get_variance_analysis": Use when user asks why a specific record is a mismatch or has variance. Parameter: {{"record_id": "<record_id>"}}
7. "get_ranked_candidates": Use when user asks about candidate matches for a record or "what about its candidate?". Parameter: {{"record_id": "<record_id>"}}
8. "search_records": Use when user asks to search or list records of a status (e.g. GST_ONLY, PR_ONLY). Parameter: {{"status": "<status>", "limit": 10}}
9. "get_pattern_summary": Use when user asks for exception population patterns/trends. Parameter: {{}}
10. "get_top_mismatches": Use when user asks for top/largest material mismatches. Parameter: {{"limit": 5}}

Conversational Reference Resolution Rules:
- If user mentions a number or phrase from prior turns (e.g. "these 2452 records", "those records"), resolve it to the concept discussed (e.g. PR Only records).
- If user asks "what about its candidate?" or "why is it mismatched?", resolve the record ID from dialogue history or selected_record_id.
- If user asks "why?" after a count query (e.g. "How many exact matches?"), set needs_clarification=True.

Return ONLY a valid JSON object matching:
{{
  "resolved_intent": "<brief summary of question and resolved references>",
  "needs_clarification": false,
  "clarification_prompt": null,
  "tools": [
    {{"tool_name": "<name>", "arguments": {{...}}, "purpose": "<brief purpose>"}}
  ]
}}"""

        try:
            decision_raw, _ = self.provider.invoke_with_result([
                {"role": "system", "content": "You are a precise JSON tool decision orchestrator for TARS Copilot. Output ONLY valid JSON."},
                {"role": "user", "content": tool_decision_prompt},
            ])

            # Parse LLM Tool Decision safely
            decision_json = {}
            try:
                json_match = re.search(r"\{.*\}", decision_raw, re.DOTALL)
                if json_match:
                    decision_json = json.loads(json_match.group(0))
            except Exception:
                decision_json = {}

            if decision_json.get("needs_clarification") and decision_json.get("clarification_prompt"):
                answer = decision_json["clarification_prompt"]
                response = CopilotResponse(
                    conversation_id=conversation_id, answer=answer, evidence=[], tool_calls=[],
                    suggested_actions=[], requires_human_action=False, provider=self.provider.provider_name,
                    model=self.model_name,
                )
                self.reconciliation.repository.save_copilot_message(CopilotMessage(
                    conversation_id=conversation_id, reconciliation_id=reconciliation_id,
                    role="assistant", content=response.answer, selected_record_id=request.selected_record_id,
                    response=response,
                ))
                return response

            tool_list = decision_json.get("tools", [])
            
            # Execute selected tools deterministically
            for tool_spec in tool_list[:4]:
                name = tool_spec.get("tool_name")
                args = tool_spec.get("arguments", {})
                purpose = tool_spec.get("purpose", f"Execute {name}")
                started = perf_counter()

                try:
                    if name == "get_product_help":
                        topic = args.get("topic", request.message)
                        help_data = self.tools.get_product_help(topic, reconciliation_id)
                        calls.append(self.tools.traced("get_product_help", purpose, started, 1))
                        evidence.append(self.tools.evidence("product_documentation", help_data["topic"], help_data))
                    elif name == "get_reconciliation_summary":
                        summary = self.tools.get_reconciliation_summary(reconciliation_id)
                        breakdown = self.tools.get_exception_breakdown(reconciliation_id)
                        calls.append(self.tools.traced("get_reconciliation_summary", purpose, started, 10))
                        facts = summary.model_dump(mode="json")
                        facts["breakdown"] = breakdown.model_dump(mode="json")
                        evidence.append(self.tools.evidence("reconciliation_summary", str(reconciliation_id), facts))
                    elif name == "get_exception_breakdown":
                        breakdown = self.tools.get_exception_breakdown(reconciliation_id)
                        calls.append(self.tools.traced("get_exception_breakdown", purpose, started, 4))
                        evidence.append(self.tools.evidence("exception_breakdown", str(reconciliation_id), breakdown.model_dump(mode="json")))
                    elif name == "get_record":
                        rec_id = args.get("record_id")
                        if rec_id:
                            record_data = self.tools.get_record(reconciliation_id, rec_id)
                            calls.append(self.tools.traced("get_record", purpose, started, 1))
                            evidence.append(self.tools.evidence("exception_record", rec_id, record_data.model_dump(mode="json")))
                    elif name == "lookup_record":
                        rec_id = args.get("record_id") or args.get("row_query")
                        if rec_id:
                            lookup_res = self.tools.lookup_record(reconciliation_id, rec_id)
                            calls.append(self.tools.traced("lookup_record", purpose, started, 1))
                            evidence.append(self.tools.evidence("record_lookup", rec_id, lookup_res))
                    elif name == "get_variance_analysis":
                        rec_id = args.get("record_id")
                        if rec_id:
                            variance = self.tools.get_variance_analysis(reconciliation_id, rec_id)
                            calls.append(self.tools.traced("get_variance_analysis", purpose, started, 1))
                            evidence.append(self.tools.evidence("variance_analysis", rec_id, variance.model_dump(mode="json")))
                            actions = [SuggestedAction.INVESTIGATE_VALUE_VARIANCE]
                    elif name == "get_ranked_candidates":
                        rec_id = args.get("record_id")
                        if rec_id:
                            candidates = self.tools.get_ranked_candidates(reconciliation_id, rec_id)
                            calls.append(self.tools.traced("get_ranked_candidates", purpose, started, len(candidates)))
                            facts = []
                            for item in candidates[:2]:
                                cand_fact = {
                                    "purchase_register_record_id": item.purchase_register_record_id,
                                    "match_score": float(item.match_score),
                                    "rank": item.rank,
                                    "score_gap": float(item.score_gap) if item.score_gap is not None else None,
                                    "supplier_gstin_pr": str(item.purchase_register_values.get("supplier_gstin") or ""),
                                    "supplier_gstin_govt": str(item.government_values.get("supplier_gstin") or ""),
                                    "document_number_pr": str(item.purchase_register_values.get("document_number") or ""),
                                    "document_number_govt": str(item.government_values.get("document_number") or ""),
                                    "taxable_value_govt": float(item.government_values.get("taxable_value") or 0.0),
                                    "taxable_value_pr": float(item.purchase_register_values.get("taxable_value") or 0.0),
                                    "taxable_value_difference": float(item.features.taxable_value_difference),
                                    "igst_difference": float(item.features.igst_difference),
                                    "cgst_difference": float(item.features.cgst_difference),
                                    "sgst_difference": float(item.features.sgst_difference),
                                    "document_date_difference_days": float(item.features.document_date_difference_days),
                                }
                                facts.append(cand_fact)
                            evidence.append(self.tools.evidence("ranked_candidates", rec_id, {"candidates": facts}))
                            if len(candidates) > 1:
                                actions = [SuggestedAction.SELECT_CANDIDATE, SuggestedAction.LEAVE_UNRESOLVED]
                    elif name == "search_records":
                        st = args.get("status")
                        lim = args.get("limit", 10)
                        if st:
                            search_res = self.tools.search_records(reconciliation_id, ExceptionSearchRequest(statuses=[st], limit=lim))
                            calls.append(self.tools.traced("search_records", purpose, started, len(search_res.records)))
                            ids = [item.record_id for item in search_res.records]
                            evidence.append(self.tools.evidence("exception_search", st, {"total": search_res.total, "record_ids": ids}))
                    elif name == "get_pattern_summary":
                        patterns = self.tools.get_pattern_summary(reconciliation_id)
                        calls.append(self.tools.traced("get_pattern_summary", purpose, started, len(patterns)))
                        evidence.append(self.tools.evidence("pattern_summary", str(reconciliation_id), patterns))
                    elif name == "get_top_mismatches":
                        lim = args.get("limit", 5)
                        top_items = self.tools.get_top_mismatches(reconciliation_id, limit=lim)
                        calls.append(self.tools.traced("get_top_mismatches", purpose, started, len(top_items)))
                        evidence.append(self.tools.evidence("top_mismatches", str(reconciliation_id), {"top_mismatches": top_items}))
                except Exception as tool_err:
                    calls.append(self.tools.traced(name or "unknown_tool", f"Failed: {tool_err}", started, 0))

            # Final Answer Synthesis Prompt
            synthesis_prompt = f"""You are TARS Copilot, a grounded assistant for GST Reconciliation Workbench.

User's Question: "{request.message}"

Resolved Intent & Context:
{json.dumps(decision_json.get('resolved_intent', request.message))}

Verified Tool Evidence / Facts (CURRENT_TURN_EVIDENCE):
{json.dumps([e.model_dump(mode='json') for e in evidence], default=str)}

CRITICAL RESPONSE QUALITY & GROUNDING INVARIANTS:
1. The FIRST sentence of your answer MUST DIRECTLY answer the user's current question.
2. STRICT GROUNDING: Any factual statement (amounts, variances, scores, GSTINs, document numbers, dates, status, counts) MUST be derived strictly from the CURRENT_TURN_EVIDENCE above.
3. Dialogue history may ONLY be used to resolve references (e.g. what 'it' or 'its candidate' refers to). Conversation text MUST NOT authorize financial evidence.
4. Do NOT dump an entire reconciliation summary or exception breakdown unless specifically requested.
5. Clean plain text or standard Markdown formatting only. NEVER output escaped syntax (no \\*\\*, no \\-, no &#x20;)."""

            raw_answer, usage = self.provider.invoke_with_result([
                {"role": "system", "content": "You are TARS Copilot. Write a direct, clear, grounded response matching the specified invariants strictly."},
                {"role": "user", "content": synthesis_prompt},
            ])

            answer = self._clean_formatting(raw_answer.strip())
            if not answer:
                answer = "I have processed your request using TARS verified data tools."

            for call in calls:
                self.reconciliation.repository.add_event(AgentEvent(
                    event_type="copilot.tool_called", reconciliation_id=reconciliation_id,
                    actor_type=ActorType.AGENT, component="copilot_orchestrator", result=call.status,
                    output_count=call.result_count, metadata={"tool_name": call.tool_name,
                                                             "purpose": call.purpose,
                                                             "duration_ms": call.duration_ms},
                ))

            response = CopilotResponse(
                conversation_id=conversation_id, answer=answer, evidence=evidence,
                tool_calls=calls, suggested_actions=actions,
                requires_human_action=bool(actions), provider=self.provider.provider_name,
                model=self.model_name,
            )
            self.reconciliation.repository.save_copilot_message(CopilotMessage(
                conversation_id=conversation_id, reconciliation_id=reconciliation_id,
                role="assistant", content=response.answer,
                selected_record_id=request.selected_record_id, response=response,
            ))
            self.reconciliation.repository.add_event(AgentEvent(
                event_type="copilot.response_completed", reconciliation_id=reconciliation_id,
                actor_type=ActorType.AGENT, component="copilot_orchestrator", result="grounded",
                output_count=len(evidence), model_provider=response.provider, model_name=response.model,
                metadata={"conversation_id": str(conversation_id), "tool_count": len(calls)},
            ))
            return response

        except Exception:
            self.reconciliation.repository.add_event(AgentEvent(
                event_type="copilot.failed", reconciliation_id=reconciliation_id,
                actor_type=ActorType.AGENT, component="copilot_orchestrator", result="failed",
                metadata={"conversation_id": str(conversation_id)},
            ))
            raise



