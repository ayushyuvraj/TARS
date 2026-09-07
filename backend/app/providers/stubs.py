from __future__ import annotations

from typing import Any

from app.providers.base import LLMProvider, ProviderError, StructuredOutput


class _UnimplementedProvider(LLMProvider):
    name = "unimplemented"

    @property
    def provider_name(self) -> str:
        return self.name

    def invoke(self, messages: list[dict[str, str]], **kwargs: Any) -> str:
        raise ProviderError(f"{self.name} provider adapter is not implemented in Phase 1")

    def invoke_structured(
        self,
        messages: list[dict[str, str]],
        output_schema: type[StructuredOutput],
        **kwargs: Any,
    ) -> StructuredOutput:
        raise ProviderError(f"{self.name} provider adapter is not implemented in Phase 1")

    def healthcheck(self) -> bool:
        return False


class AnthropicProvider(_UnimplementedProvider):
    name = "anthropic"


class GeminiProvider(_UnimplementedProvider):
    name = "gemini"

