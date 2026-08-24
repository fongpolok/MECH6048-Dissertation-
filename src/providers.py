"""Maps a (provider, model) pair to a LangChain chat model instance, so the
same agent (tools, RAG, system prompt — src/agent.py) can run on any of them,
and the eval harnesses can compare providers head-to-head.

Model IDs below were verified against each provider's own docs on 2026-07-29
rather than recalled from training data, since these churn — e.g. DeepSeek
retired the deepseek-chat/deepseek-reasoner aliases on 2026-07-24 in favor of
deepseek-v4-flash/deepseek-v4-pro; using a stale remembered ID would silently
404 or route to the wrong model.
"""
from __future__ import annotations

import os

from langchain_core.language_models.chat_models import BaseChatModel

from src.config import OLLAMA_HOST, OLLAMA_NUM_CTX

# needs_key: the env var an SDK reads for auth, or None for the local model
# that needs no credential. Every SDK below reads its key from the environment
# itself (ANTHROPIC_API_KEY / GOOGLE_API_KEY / DEEPSEEK_API_KEY are each
# library's own documented convention) — we never pass a key through code.
PROVIDERS: dict[str, dict] = {
    "ollama": {
        "label": "本機 Ollama（免費・私隱優先）",
        "needs_key": None,
        "models": [
            {"id": "qwen3.5:9b", "label": "Qwen3.5 9B（本機，預設）"},
            {"id": "qwen3:32b", "label": "Qwen3 32B（本機，較大）"},
        ],
    },
    "anthropic": {
        "label": "Claude (Anthropic)",
        "needs_key": "ANTHROPIC_API_KEY",
        "models": [
            {"id": "claude-opus-4-8", "label": "Claude Opus 4.8（最強）"},
            {"id": "claude-sonnet-5", "label": "Claude Sonnet 5（平衡）"},
            {"id": "claude-haiku-4-5", "label": "Claude Haiku 4.5（最快）"},
        ],
    },
    "google": {
        "label": "Gemini (Google)",
        "needs_key": "GOOGLE_API_KEY",
        "models": [
            {"id": "gemini-2.5-flash", "label": "Gemini 2.5 Flash（平衡）"},
            {"id": "gemini-2.5-pro", "label": "Gemini 2.5 Pro（最強）"},
        ],
    },
    "deepseek": {
        "label": "DeepSeek",
        "needs_key": "DEEPSEEK_API_KEY",
        "models": [
            {"id": "deepseek-v4-flash", "label": "DeepSeek V4-Flash（平衡）"},
            {"id": "deepseek-v4-pro", "label": "DeepSeek V4-Pro（最強）"},
        ],
    },
}

DEFAULT_PROVIDER = "ollama"
DEFAULT_MODEL = "qwen3.5:9b"


class ProviderKeyMissing(Exception):
    """Raised when a provider is selected but its API key env var isn't set."""


def is_provider_available(provider: str) -> bool:
    needs_key = PROVIDERS[provider]["needs_key"]
    return needs_key is None or bool(os.getenv(needs_key))


def list_providers() -> list[dict]:
    """Catalog for the Settings dropdown: every provider/model with whether
    it's actually usable right now (key present), so the UI can grey out
    options instead of letting the user pick one that will 502."""
    out = []
    for pid, cfg in PROVIDERS.items():
        out.append(
            {
                "id": pid,
                "label": cfg["label"],
                "available": is_provider_available(pid),
                "needs_key": cfg["needs_key"],
                "models": cfg["models"],
            }
        )
    return out


def build_chat_model(provider: str, model: str, temperature: float) -> BaseChatModel:
    if provider not in PROVIDERS:
        raise ValueError(f"unknown provider: {provider!r}")
    if not is_provider_available(provider):
        raise ProviderKeyMissing(
            f"{PROVIDERS[provider]['needs_key']} is not set — cannot use provider {provider!r}"
        )

    if provider == "ollama":
        from langchain_ollama import ChatOllama

        return ChatOllama(model=model, temperature=temperature, base_url=OLLAMA_HOST, num_ctx=OLLAMA_NUM_CTX)

    if provider == "anthropic":
        from langchain_anthropic import ChatAnthropic

        return ChatAnthropic(model=model, temperature=temperature)

    if provider == "google":
        from langchain_google_genai import ChatGoogleGenerativeAI

        return ChatGoogleGenerativeAI(model=model, temperature=temperature)

    if provider == "deepseek":
        from langchain_deepseek import ChatDeepSeek

        return ChatDeepSeek(model=model, temperature=temperature)

    raise ValueError(f"unhandled provider: {provider!r}")
