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

    def _resolve_record_id(self, reconciliation_id: UUID, conversation_id: UUID | None, message: str, selected: str | None) -> str | None:
        match = re.search(r"\b(?:GST|PR)-\d{5}\b", message, re.IGNORECASE)
        if match:
            return match.group(0).upper()
        row_match = re.search(r"\b(?:row\s*)?(\d{1,5})\b", message, re.IGNORECASE)
        if row_match and "row" in message.lower():
            return f"row {row_match.group(1)}"
        if selected:
            return selected
        if conversation_id:
            recent = self.reconciliation.repository.list_copilot_messages(reconciliation_id, conversation_id, limit=5)
            for msg in reversed(recent):
                if msg.selected_record_id:
                    return msg.selected_record_id
                m = re.search(r"\b(?:GST|PR)-\d{5}\b", msg.content, re.IGNORECASE)
                if m:
                    return m.group(0).upper()
        return None

    @staticmethod
    def _currency(message: str) -> float | None:
        explicit = re.findall(r"(?:₹|INR\s*)([\d,]+(?:\.\d+)?)", message, re.IGNORECASE)
        return float(explicit[-1].replace(",", "")) if explicit else None

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
                      "selected_record_id": request.selected_record_id},
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

        # AI Availability Check - Universal Copilot requires ready LLM provider
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

        calls, evidence, actions = [], [], []
        message = request.message.lower()
        record_id = self._resolve_record_id(reconciliation_id, conversation_id, request.message, request.selected_record_id)
        
        try:
            ai_intent = record_id and not record_id.startswith("row ") and (
                "investigate" in message or
                ("why" in message and "ambiguous" in message)
            )
            rule_match = re.search(r"\bR-\d{3}\b", request.message, re.IGNORECASE)
            provenance_rule = None
            if ai_intent and self.investigation:
                investigation = self.investigation.investigate(reconciliation_id, record_id)
                conclusion = investigation.conclusion
                if conclusion is None:
                    raise RuntimeError("AI investigation did not return a validated conclusion")
                answer = conclusion.conclusion_summary + " " + " ".join(conclusion.reasoning_summary)
                evidence = [self.tools.evidence(
                    "ai_investigation_evidence", item.reference_id,
                    {"tool_name": item.tool_name, "fact_paths": item.fact_paths},
                ) for item in conclusion.evidence]
                calls = [self.tools.traced(step.name, "AI investigation evidence tool", perf_counter(), 1)
                         for step in investigation.execution_trace if step.stage == "tool"]
                actions = [SuggestedAction.REVIEW]
            elif self.governance and "rule" in message and ("why" in message or "exist" in message):
                if rule_match:
                    provenance_rule = self.governance.get_rule(rule_match.group(0).upper())
                else:
                    profile_id = self.reconciliation.get(reconciliation_id).client_profile_id
                    provenance_rule = next(
                        (item for item in self.governance.list_rules(profile_id)
                         if item.name.lower() in message or len({
                             word for word in re.findall(r"[a-z0-9]+", item.name.lower())
                             if len(word) > 3 and word in message
                         }) >= 2), None,
                    )
            if self.governance and "rule" in message and ("active" in message or "never triggered" in message or "human decision" in message):
                started = perf_counter()
                profile_id = self.reconciliation.get(reconciliation_id).client_profile_id
                rules = self.governance.list_rules(profile_id)
                if "active" in message:
                    rules = [item for item in rules if item.status.value == "ACTIVE"]
                if "never triggered" in message:
                    rules = [item for item in rules if item.effectiveness.times_triggered == 0]
                if "human decision" in message:
                    rules = [item for item in rules if item.provenance.type.value == "HUMAN_DECISION_PATTERN"]
                calls.append(self.tools.traced("list_rules", "Retrieve governed profile rules", started, len(rules)))
                evidence.append(self.tools.evidence("rule_library", str(profile_id or reconciliation_id),
                                {"rules": [{"rule_id": r.rule_id, "version": r.version, "name": r.name,
                                            "status": r.status.value, "action_authority": r.action_authority,
                                            "times_triggered": r.effectiveness.times_triggered}
                                           for r in rules]}))
                answer = ("No governed rules match that request." if not rules else
                          "Governed rules: " + "; ".join(
                              f"{r.rule_id} v{r.version} — {r.name} ({r.status.value}, {r.action_authority})"
                              for r in rules
                          ) + ". PROPOSE_ONLY rules cannot reconcile transactions automatically.")
            elif provenance_rule is not None:
                started = perf_counter(); rule = provenance_rule
                calls.append(self.tools.traced("get_rule_provenance", "Retrieve persisted rule provenance", started, 1))
                facts = rule.provenance.model_dump(mode="json")
                facts["action_authority"] = rule.action_authority
                evidence.append(self.tools.evidence("rule_provenance", rule.rule_id, facts))
                answer = (f"{rule.rule_id} v{rule.version} exists because {rule.provenance.summary} "
                          f"It is currently {rule.status.value} with {rule.action_authority} authority, "
                          "so it cannot reconcile transactions automatically.")
            elif self.governance and rule_match and ("simulate" in message or "disabl" in message or "affect" in message):
                started = perf_counter(); simulation = self.governance.simulate(rule_match.group(0).upper(), reconciliation_id)
                calls.append(self.tools.traced("simulate_rule", "Run read-only governed rule simulation", started, 1))
                evidence.append(self.tools.evidence("rule_simulation", simulation.rule_id, simulation.model_dump(mode="json")))
                answer = (f"A read-only simulation of {simulation.rule_id} v{simulation.rule_version} would propose "
                          f"{simulation.would_propose} records, with {simulation.conflicts} known conflicts. No rule state was changed.")
            elif self.governance and "profile" in message:
                started = perf_counter(); profile_id = self.reconciliation.get(reconciliation_id).client_profile_id
                if not profile_id:
                    answer = "This reconciliation is not attached to a client profile."
                else:
                    profile = self.governance.get_profile(profile_id)
                    calls.append(self.tools.traced("get_client_profile", "Retrieve saved profile assets", started, 1))
                    evidence.append(self.tools.evidence("client_profile", str(profile.id), {
                        "profile_name": profile.profile_name, "version": profile.version,
                        "mapping_datasets": len(profile.saved_mapping.datasets),
                        "policy_revision": profile.saved_policy.revision, "active_rule_ids": profile.active_rule_ids,
                    }))
                    answer = (f"This session uses {profile.profile_name} v{profile.version}, with a saved mapping, "
                              f"policy revision {profile.saved_policy.revision}, and {len(profile.active_rule_ids)} active rules.")
            elif ("pattern" in message or "signature" in message or "trend" in message) and not record_id:
                started = perf_counter()
                patterns = self.tools.get_pattern_summary(reconciliation_id)
                calls.append(self.tools.traced("get_pattern_summary", "Analyze exception population patterns", started, len(patterns)))
                evidence.append(self.tools.evidence("pattern_summary", str(reconciliation_id), patterns))
                answer = (f"Factual pattern summary across unresolved exceptions: "
                          f"{patterns['status_counts']['material_mismatch']} material mismatches, {patterns['status_counts']['ambiguous']} ambiguous, {patterns['status_counts']['gst_only']} GST-only. "
                          f"Taxable value variance breakdown: {patterns['taxable_variance_bands']['under_100']} under ₹100, "
                          f"{patterns['taxable_variance_bands']['100_to_1000']} between ₹100–₹1,000, and {patterns['taxable_variance_bands']['over_1000']} over ₹1,000. "
                          f"{patterns['document_format_signature_mismatches']} candidates show invoice formatting differences.")
            elif ("largest" in message or "biggest" in message or "top" in message) and ("mismatch" in message or "variance" in message or "exception" in message):
                started = perf_counter()
                top_items = self.tools.get_top_mismatches(reconciliation_id, limit=5)
                calls.append(self.tools.traced("get_top_mismatches", "Fetch top material mismatches by variance", started, len(top_items)))
                evidence.append(self.tools.evidence("top_mismatches", str(reconciliation_id), {"top_mismatches": top_items}))
                if not top_items:
                    answer = "No material mismatches with candidate variance were found in the current reconciliation."
                else:
                    items_str = "; ".join(f"{item['record_id']} vs {item['candidate_id']} (variance: ₹{item['taxable_variance']:,.2f})" for item in top_items)
                    answer = f"The largest material mismatches by taxable value variance are: {items_str}."
            elif ("what is" in message or "how to" in message or "how does" in message or "how do i" in message) and any(term in message for term in ["near match", "tolerance", "gst only", "pr only", "exceptions", "export"]):
                started = perf_counter()
                help_data = self.tools.get_product_help(message, reconciliation_id)
                calls.append(self.tools.traced("get_product_help", "Retrieve official TARS documentation context", started, 1))
                evidence.append(self.tools.evidence("product_documentation", help_data["topic"], help_data))
                answer = f"{help_data['topic']}: {help_data['summary']} {help_data['details']}"
            elif record_id and (record_id.startswith("row ") or "row" in message):
                started = perf_counter()
                lookup_res = self.tools.lookup_record(reconciliation_id, record_id)
                calls.append(self.tools.traced("lookup_record", f"Lookup record for {record_id}", started, 1))
                evidence.append(self.tools.evidence("record_lookup", record_id, lookup_res))
                if "error" in lookup_res:
                    answer = lookup_res["error"]
                else:
                    st = lookup_res["status"]
                    rec = lookup_res["record_id"]
                    vals = lookup_res.get("values", {})
                    sem = lookup_res.get("row_semantics", "")
                    answer = (f"Record {rec} ({lookup_res['dataset']}) identified for '{record_id}' ({sem}) has status: {st}. "
                              f"Document: {vals.get('document_number', 'N/A')}, Taxable Value: ₹{vals.get('taxable_value', 0):,.2f}. "
                              f"{'It was matched as an ' + st if 'MATCHED' in st else 'It remains an unresolved exception: ' + st}.")
            elif ("candidate" in message or "ambiguous" in message) and record_id and not record_id.startswith("row "):
                started = perf_counter()
                candidates = self.tools.get_ranked_candidates(reconciliation_id, record_id)
                calls.append(self.tools.traced("get_ranked_candidates", "Retrieve actual ranked candidates", started, len(candidates)))
                facts = [{"purchase_register_record_id": item.purchase_register_record_id,
                          "match_score": item.match_score, "rank": item.rank,
                          "score_gap": item.score_gap} for item in candidates[:2]]
                evidence.append(self.tools.evidence("ranked_candidates", record_id, {"candidates": facts}))
                if not candidates:
                    answer = f"I don't have enough evidence to identify a candidate for {record_id}."
                elif len(candidates) > 1:
                    gap = candidates[0].match_score - candidates[1].match_score
                    answer = (f"{record_id} is ambiguous because {len(candidates)} candidates passed blocking. "
                              f"The top candidates are {candidates[0].purchase_register_record_id} at {candidates[0].match_score * 100:.1f}% "
                              f"and {candidates[1].purchase_register_record_id} at {candidates[1].match_score * 100:.1f}%. "
                              f"Their {gap * 100:.1f}-point gap is within the configured ambiguity margin, so automatic selection was blocked.")
                    actions = [SuggestedAction.SELECT_CANDIDATE, SuggestedAction.LEAVE_UNRESOLVED]
                else:
                    answer = (f"The strongest candidate for {record_id} is {candidates[0].purchase_register_record_id} "
                              f"with a deterministic candidate score of {candidates[0].match_score * 100:.1f}%.")
            elif ("would" in message or "increas" in message or "simulate" in message) and record_id and not record_id.startswith("row "):
                amount = self._currency(request.message)
                if amount is None:
                    answer = "I need a hypothetical taxable-value tolerance to run that simulation."
                else:
                    started = perf_counter()
                    result = self.tools.simulate_policy_change(
                        reconciliation_id, record_id,
                        PolicySimulationRequest(taxable_value_tolerance=amount),
                    )
                    calls.append(self.tools.traced("simulate_policy_change", "Run a read-only policy what-if", started, 1))
                    evidence.append(self.tools.evidence("policy_simulation", record_id, result.model_dump(mode="json")))
                    answer = (f"A read-only simulation with taxable-value tolerance ₹{amount:,.2f} "
                              f"{'would satisfy the tested checks' if result.would_satisfy else 'would not resolve every blocker'}. "
                              + ("Remaining blockers: " + "; ".join(result.blockers) + ". " if result.blockers else "")
                              + "The confirmed policy was not changed.")
            elif record_id and not record_id.startswith("row ") and ("why" in message or "differ" in message or "variance" in message or "unresolved" in message):
                started = perf_counter()
                variance = self.tools.get_variance_analysis(reconciliation_id, record_id)
                calls.append(self.tools.traced("get_variance_analysis", "Calculate deterministic exception evidence", started, 1))
                evidence.append(self.tools.evidence("variance_analysis", record_id, variance.model_dump(mode="json")))
                if not variance.variances:
                    answer = f"{record_id} remains {variance.status}. {variance.blockers[0] if variance.blockers else 'I do not have enough evidence to determine a counterpart.'}"
                else:
                    answer = (f"{record_id} remains {variance.status.replace('_', ' ').lower()}. "
                              f"Its best candidate is {variance.candidate_record_id}. "
                              f"Taxable-value variance is ₹{variance.variances['taxable_value']:,.2f} against the configured ₹{variance.allowed_tolerances['taxable_value']:,.2f} tolerance. "
                              + ("Blockers: " + "; ".join(variance.blockers) + "." if variance.blockers else "No material variance blocker was found."))
                    actions = [SuggestedAction.INVESTIGATE_VALUE_VARIANCE]
            elif "gst-only" in message or "gst only" in message:
                started = perf_counter()
                results = self.tools.search_records(
                    reconciliation_id, ExceptionSearchRequest(statuses=["GST_ONLY"], limit=50)
                )
                calls.append(self.tools.traced("search_records", "Filter actual GST-only exceptions", started, len(results.records)))
                ids = [item.record_id for item in results.records]
                evidence.append(self.tools.evidence("exception_search", "GST_ONLY", {"total": results.total, "record_ids": ids}))
                answer = f"There are {results.total} GST-only Government transactions. The first {len(ids)} are: {', '.join(ids[:10])}."
            elif "prior" in message and "adjust" in message:
                started = perf_counter()
                results = self.tools.search_records(reconciliation_id, ExceptionSearchRequest(
                    semantic_category=SemanticCategory.PRIOR_PERIOD_ADJUSTMENT, limit=50,
                ))
                calls.append(self.tools.traced("search_records", "Filter persisted semantic classifications", started, len(results.records)))
                evidence.append(self.tools.evidence("semantic_search", "PRIOR_PERIOD_ADJUSTMENT",
                                                    {"total": results.total, "record_ids": [item.record_id for item in results.records]}))
                answer = (f"{results.total} unresolved transactions currently carry the persisted prior-period adjustment classification."
                          if results.total else "No unresolved transactions have a persisted prior-period adjustment classification yet. Run semantic analysis first.")
            elif ("exact" in message or "reconciled" in message or "unresolved" in message or "summary" in message or "percentage" in message or "how many" in message) and not record_id:
                started = perf_counter()
                summary = self.tools.get_reconciliation_summary(reconciliation_id)
                breakdown = self.tools.get_exception_breakdown(reconciliation_id)
                calls.append(self.tools.traced("get_reconciliation_summary", "Retrieve actual reconciliation totals", started, 10))
                facts = summary.model_dump(mode="json")
                facts["breakdown"] = breakdown.model_dump(mode="json")
                evidence.append(self.tools.evidence("reconciliation_summary", str(reconciliation_id), facts))
                reco_pct = (summary.resolved_records / summary.government_records * 100) if summary.government_records > 0 else 0
                answer = (f"Reconciliation session status: {summary.status.value}. "
                          f"Government population (Total: {summary.government_records}): {summary.resolved_records} resolved ({reco_pct:.1f}% reconciled) including {summary.exact_matches} exact matches and {summary.tolerance_matches} tolerance matches. "
                          f"Remaining Government unresolved records: {summary.remaining_government_records} ({breakdown.ambiguous} ambiguous, {breakdown.material_mismatch} material mismatch, {breakdown.gst_only} GST-only). "
                          f"Purchase Register population (Total: {summary.purchase_register_records}): {summary.resolved_records} consumed/resolved, {summary.remaining_purchase_register_records} remaining PR-only records.")
            else:
                started = perf_counter()
                breakdown = self.tools.get_exception_breakdown(reconciliation_id)
                calls.append(self.tools.traced("get_exception_breakdown", "Retrieve actual unresolved counts", started, 4))
                facts = breakdown.model_dump(mode="json")
                evidence.append(self.tools.evidence("exception_breakdown", str(reconciliation_id), facts))
                answer = (f"Government population unresolved: {breakdown.remaining_government} records ({breakdown.ambiguous} ambiguous, {breakdown.material_mismatch} material mismatches, {breakdown.gst_only} GST-only). "
                          f"Purchase Register population unresolved: {breakdown.remaining_purchase_register} remaining PR-only records.")

            for call in calls:
                self.reconciliation.repository.add_event(AgentEvent(
                    event_type="copilot.tool_called", reconciliation_id=reconciliation_id,
                    actor_type=ActorType.AGENT, component="copilot_orchestrator", result=call.status,
                    output_count=call.result_count, metadata={"tool_name": call.tool_name,
                                                             "purpose": call.purpose,
                                                             "duration_ms": call.duration_ms},
                ))

            provider_name = "deterministic"
            if self.provider is not None and evidence:
                try:
                    grounded, usage = self.provider.invoke_with_result([
                        {"role": "system", "content": "You are TARS Copilot. Rewrite the draft clearly using only the supplied facts. Explicitly separate Government population totals/unresolved from Purchase Register totals/unresolved. Do not invent numbers, IDs, conclusions, or actions."},
                        {"role": "user", "content": json.dumps({"draft": answer, "facts": [item.model_dump(mode="json") for item in evidence]}, default=str)},
                    ])
                    if grounded.strip():
                        answer, provider_name = grounded.strip(), self.provider.provider_name
                except ProviderError:
                    answer = ("AI Copilot is currently unavailable because the configured LLM provider failed to respond. "
                              "Deterministic reconciliation results remain unaffected.")
                    provider_name = "unavailable"

            response = CopilotResponse(
                conversation_id=conversation_id, answer=answer, evidence=evidence if provider_name != "unavailable" else [],
                tool_calls=calls if provider_name != "unavailable" else [], suggested_actions=actions if provider_name != "unavailable" else [],
                requires_human_action=bool(actions) if provider_name != "unavailable" else False, provider=provider_name,
                model=self.model_name if provider_name not in ("deterministic", "unavailable") else None,
            )
            self.reconciliation.repository.save_copilot_message(CopilotMessage(
                conversation_id=conversation_id, reconciliation_id=reconciliation_id,
                role="assistant", content=response.answer,
                selected_record_id=request.selected_record_id, response=response,
            ))
            self.reconciliation.repository.add_event(AgentEvent(
                event_type="copilot.response_completed", reconciliation_id=reconciliation_id,
                actor_type=ActorType.AGENT, component="copilot_orchestrator", result="grounded" if provider_name != "unavailable" else "unavailable",
                output_count=len(evidence), model_provider=provider_name, model_name=response.model,
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



