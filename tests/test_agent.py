"""Constructs the real MedicalAgent (needs a reachable Ollama server, but makes
no chat calls) to check configuration is wired correctly. See eval/evaluate.py
for tests that actually exercise the model."""
from src.agent import MedicalAgent
from src.config import OLLAMA_NUM_CTX


def test_llm_configured_with_num_ctx():
    """Regression test: an empty-reply bug was traced to Ollama's default
    context window (~4096) being too small for a thinking model (qwen3.5) once
    system prompt + profile + RAG context are added — it silently burns the
    whole budget on invisible <think> reasoning and hits the ceiling before
    emitting any answer (done_reason="length", empty content). See
    src/config.py OLLAMA_NUM_CTX for the reproduction notes."""
    agent = MedicalAgent()
    assert agent.llm.num_ctx == OLLAMA_NUM_CTX
    assert agent.llm.num_ctx >= 8192  # the smallest value confirmed to fix the repro case
