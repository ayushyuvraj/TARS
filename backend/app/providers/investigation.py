from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Protocol

from openai import OpenAI
from openai.lib._pydantic import to_strict_json_schema

from app.domain.models import InvestigationConclusion
from app.providers.base import ProviderError


@dataclass
class InvestigationToolCall:
    call_id: str
    name: str
    arguments: dict[str, Any] = field(default_factory=dict)


@dataclass
class InvestigationModelTurn:
    response_id: str
    tool_calls: list[InvestigationToolCall]
    conclusion: InvestigationConclusion | None = None
    token_usage: dict[str, int] | None = None


class InvestigationModel(Protocol):
    provider_name: str
    model_name: str

    def invoke(
        self,
        input_items: str | list[dict[str, Any]],
        previous_response_id: str | None,
        instructions: str,
        tools: list[dict[str, Any]],
    ) -> InvestigationModelTurn: ...


class OpenAIInvestigationModel:
    provider_name = "openai"

    def __init__(self, api_key: str, model: str, timeout_seconds: float) -> None:
        self.model_name = model
        self._timeout_seconds = timeout_seconds
        # The workflow owns retry semantics. SDK-level retries multiply the per-turn
        # timeout and can leave the UI waiting for several minutes.
        self._client = OpenAI(api_key=api_key, max_retries=0)

    def invoke(
        self,
        input_items: str | list[dict[str, Any]],
        previous_response_id: str | None,
        instructions: str,
        tools: list[dict[str, Any]],
    ) -> InvestigationModelTurn:
        try:
            response = self._client.responses.create(
                model=self.model_name,
                instructions=instructions,
                input=input_items,
                tools=tools,
                tool_choice="required",
                parallel_tool_calls=True,
                max_tool_calls=5,
                reasoning={"effort": "low"},
                max_output_tokens=1200,
                store=False,
                timeout=self._timeout_seconds,
            )
            calls: list[InvestigationToolCall] = []
            conclusion = None
            for item in response.output:
                if getattr(item, "type", None) != "function_call":
                    continue
                arguments = json.loads(item.arguments or "{}")
                if item.name == "submit_investigation":
                    conclusion = InvestigationConclusion.model_validate(arguments)
                else:
                    calls.append(InvestigationToolCall(item.call_id, item.name, arguments))
            usage = None
            if response.usage is not None:
                raw = response.usage.model_dump()
                usage = {
                    key: int(value) for key, value in raw.items()
                    if isinstance(value, int) and ("token" in key or key.endswith("tokens"))
                }
            if conclusion is None and not calls:
                raise ProviderError("OpenAI returned neither a tool call nor a structured conclusion")
            return InvestigationModelTurn(response.id, calls, conclusion, usage)
        except ProviderError:
            raise
        except Exception as exc:
            raise ProviderError("OpenAI investigation request failed") from exc


def investigation_tool_schemas() -> list[dict[str, Any]]:
    no_args = {"type": "object", "properties": {}, "additionalProperties": False}
    tool_help = {
        "get_exception_context": "Read the scoped exception identity and allowlisted source values.",
        "compare_financials": "Calculate authoritative variances and approved tolerances.",
        "get_candidates": "Read ranked candidate evidence for the scoped exception.",
        "search_related_records": "Search a small, scoped set of related unresolved records.",
        "get_governance_context": "Read policy, threshold, profile, and rule-authority context.",
    }
    schemas = [
        {
            "type": "function",
            "name": name,
            "description": description,
            "parameters": no_args,
            "strict": True,
        }
        for name, description in tool_help.items()
    ]
    schemas.append({
        "type": "function",
        "name": "submit_investigation",
        "description": "Submit the final concise, evidence-linked investigation conclusion.",
        "parameters": to_strict_json_schema(InvestigationConclusion),
        "strict": True,
    })
    return schemas
