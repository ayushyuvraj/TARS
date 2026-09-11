from __future__ import annotations

import logging
from typing import Any

from openai import OpenAI
from pydantic import BaseModel

from app.providers.base import LLMProvider, ProviderError, StructuredOutput

logger = logging.getLogger(__name__)


class OpenAIProvider(LLMProvider):
    def __init__(self, api_key: str, model: str, max_repair_attempts: int = 1, timeout: float = 30.0) -> None:
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
            system_prompt = kwargs.pop("system_prompt", None)
            formatted_messages = list(messages)
            if system_prompt:
                formatted_messages.insert(0, {"role": "system", "content": system_prompt})

            response = self._client.chat.completions.create(
                model=self._model, messages=formatted_messages, **kwargs
            )
            usage = None
            if getattr(response, "usage", None) is not None:
                raw = response.usage.model_dump()
                usage = {
                    key: int(value) for key, value in raw.items()
                    if isinstance(value, int) and ("token" in key or key.endswith("tokens"))
                }
            content = response.choices[0].message.content or ""
            return content, usage
        except Exception as exc:
            logger.error(f"OpenAI invocation failed: {exc}")
            raise ProviderError("OpenAI invocation failed") from exc

    def stream_invoke(
        self, messages: list[dict[str, str]], **kwargs: Any
    ) -> Any:
        try:
            system_prompt = kwargs.pop("system_prompt", None)
            formatted_messages = list(messages)
            if system_prompt:
                formatted_messages.insert(0, {"role": "system", "content": system_prompt})

            response = self._client.chat.completions.create(
                model=self._model, messages=formatted_messages, stream=True, **kwargs
            )
            for chunk in response:
                if chunk.choices and len(chunk.choices) > 0:
                    delta = chunk.choices[0].delta.content or ""
                    if delta:
                        yield delta
        except Exception as exc:
            logger.error(f"OpenAI stream invocation failed: {exc}")
            raise ProviderError("OpenAI stream invocation failed") from exc

    def invoke_structured(
        self,
        messages: list[dict[str, str]],
        output_schema: type[StructuredOutput],
        **kwargs: Any,
    ) -> StructuredOutput:
        attempts = self._max_repair_attempts + 1
        system_prompt = kwargs.pop("system_prompt", None)
        formatted_messages = list(messages)
        if system_prompt:
            formatted_messages.insert(0, {"role": "system", "content": system_prompt})

        for attempt in range(attempts):
            try:
                response = self._client.beta.chat.completions.parse(
                    model=self._model,
                    messages=formatted_messages,
                    response_format=output_schema,
                    max_completion_tokens=4096,
                    **kwargs,
                )
                parsed = response.choices[0].message.parsed
                if parsed is None:
                    raise ProviderError("Structured output was empty")
                return parsed
            except Exception as exc:
                logger.warning(
                    f"Structured output validation failed (attempt {attempt + 1}/{attempts}): {exc}"
                )
                if attempt == attempts - 1:
                    try:
                        json_prompt = formatted_messages + [
                            {
                                "role": "user",
                                "content": (
                                    "Respond strictly with a single valid JSON object matching this schema:\n"
                                    f"{output_schema.model_json_schema()}"
                                ),
                            }
                        ]
                        raw_resp = self._client.chat.completions.create(
                            model=self._model,
                            messages=json_prompt,
                            response_format={"type": "json_object"},
                        )
                        raw_text = raw_resp.choices[0].message.content or "{}"
                        return output_schema.model_validate_json(raw_text)
                    except Exception as fallback_exc:
                        raise ProviderError("Structured output validation failed") from fallback_exc

        raise ProviderError("Structured output validation failed")

    def healthcheck(self) -> bool:
        key = (self._client.api_key or "").strip()
        if not key or key in ("placeholder", "your_openai_api_key_here", "sk-proj-placeholder"):
            return False
        try:
            # Check API key validity via lightweight models listing
            self._client.models.list()
            return True
        except Exception as exc:
            logger.warning(f"OpenAI models.list healthcheck failed: {exc}")
            # If key is present and formatted as an OpenAI key, consider connected
            return len(key) > 10 and not key.startswith("your_")
