from __future__ import annotations

import logging
from typing import Any

from openai import OpenAI
from pydantic import BaseModel

from app.providers.base import LLMProvider, ProviderError, StructuredOutput

logger = logging.getLogger(__name__)


class OpenAIProvider(LLMProvider):
    def __init__(self, api_key: str, model: str, max_repair_attempts: int = 1, timeout: float = 5.0) -> None:
        self._client = OpenAI(api_key=api_key, timeout=timeout)
        self._model = model
        self._max_repair_attempts = max_repair_attempts


    @property
    def provider_name(self) -> str:
        return "openai"

    def invoke(self, messages: list[dict[str, str]], **kwargs: Any) -> str:
        text, _ = self.invoke_with_result(messages, **kwargs)
        return text

    def invoke_with_result(
        self, messages: list[dict[str, str]], **kwargs: Any
    ) -> tuple[str, dict[str, int] | None]:
        try:
            response = self._client.responses.create(
                model=self._model, input=messages, store=False, **kwargs
            )
            usage = None
            if getattr(response, "usage", None) is not None:
                raw = response.usage.model_dump()
                usage = {
                    key: int(value) for key, value in raw.items()
                    if isinstance(value, int) and ("token" in key or key.endswith("tokens"))
                }
            return response.output_text or "", usage
        except Exception as exc:  # vendor exceptions remain behind this adapter
            raise ProviderError("OpenAI invocation failed") from exc


    def invoke_structured(
        self,
        messages: list[dict[str, str]],
        output_schema: type[StructuredOutput],
        **kwargs: Any,
    ) -> StructuredOutput:
        attempts = self._max_repair_attempts + 1
        current_messages = list(messages)
        for attempt in range(attempts):
            try:
                response = self._client.responses.parse(
                    model=self._model, input=current_messages,
                    text_format=output_schema, store=False, **kwargs,
                )
                if response.output_parsed is None:
                    raise ProviderError("Structured output was empty")
                return response.output_parsed
            except Exception as exc:
                logger.warning(
                    "Structured output validation failed",
                    extra={"provider": self.provider_name, "attempt": attempt + 1},
                )
                if attempt == attempts - 1:
                    raise ProviderError("Structured output validation failed") from exc
                current_messages.append({
                    "role": "user",
                    "content": "Return a valid structured result matching the supplied schema exactly.",
                })
        raise ProviderError("Structured output validation failed")

    def healthcheck(self) -> bool:
        try:
            self._client.models.retrieve(self._model)
            return True
        except Exception:
            return False
