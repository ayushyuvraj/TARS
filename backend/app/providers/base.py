from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, TypeVar

from pydantic import BaseModel

StructuredOutput = TypeVar("StructuredOutput", bound=BaseModel)


class ProviderError(RuntimeError):
    """Safe provider boundary failure without leaking vendor exceptions upstream."""


class LLMProvider(ABC):
    @property
    @abstractmethod
    def provider_name(self) -> str: ...

    @abstractmethod
    def invoke(self, messages: list[dict[str, str]], **kwargs: Any) -> str: ...

    @abstractmethod
    def invoke_structured(
        self,
        messages: list[dict[str, str]],
        output_schema: type[StructuredOutput],
        **kwargs: Any,
    ) -> StructuredOutput: ...

    @abstractmethod
    def healthcheck(self) -> bool: ...

    def invoke_with_result(
        self, messages: list[dict[str, str]], **kwargs: Any
    ) -> tuple[str, dict[str, int] | None]:
        return self.invoke(messages, **kwargs), None

    def stream_invoke(
        self, messages: list[dict[str, str]], **kwargs: Any
    ) -> Any:
        yield self.invoke(messages, **kwargs)


