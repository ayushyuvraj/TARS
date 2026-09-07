from __future__ import annotations

from app.config import Settings
from app.providers.base import LLMProvider, ProviderError
from app.providers.openai_provider import OpenAIProvider
from app.providers.stubs import AnthropicProvider, GeminiProvider


def create_llm_provider(settings: Settings) -> LLMProvider:
    provider = settings.llm_provider.lower().strip()
    if provider == "openai":
        if not settings.effective_openai_api_key:
            raise ProviderError("OPENAI_API_KEY is required for the OpenAI provider")
        return OpenAIProvider(
            api_key=settings.effective_openai_api_key,
            model=settings.effective_openai_model,
            max_repair_attempts=settings.llm_max_repair_attempts,
        )
    if provider == "anthropic":
        return AnthropicProvider()
    if provider == "gemini":
        return GeminiProvider()
    raise ProviderError(f"Unsupported LLM provider: {provider}")
