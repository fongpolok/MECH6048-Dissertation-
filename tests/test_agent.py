"""Constructs the real MedicalAgent (needs a reachable Ollama server, but makes
no chat calls) to check configuration is wired correctly. See eval/evaluate.py
for tests that actually exercise the model."""
from src.agent import MedicalAgent
from src.config import OLLAMA_NUM_CTX
from src.providers import DEFAULT_MODEL, DEFAULT_PROVIDER


def test_llm_configured_with_num_ctx():
    """Regression test: an empty-reply bug was traced to Ollama's default
    context window (~4096) being too small for a thinking model (qwen3.5) once
    system prompt + profile + RAG context are added — it silently burns the
    whole budget on invisible <think> reasoning and hits the ceiling before
    emitting any answer (done_reason="length", empty content). See
    src/config.py OLLAMA_NUM_CTX for the reproduction notes."""
    agent = MedicalAgent(DEFAULT_PROVIDER, DEFAULT_MODEL)
    assert agent.llm.num_ctx == OLLAMA_NUM_CTX
    assert agent.llm.num_ctx >= 8192  # the smallest value confirmed to fix the repro case


def test_alert_caregiver_reply_always_mentions_999(monkeypatch):
    """Regression test: eval found a live case (severe_breathlessness, qwen3.5)
    where the model called alert_caregiver, emitted no closing text, and the
    empty-reply fallback then surfaced only the tool's own confirmation string
    ("已通知照顧者...") as the whole answer — with no instruction for the user
    to call 999 themselves. A caregiver notification is not a substitute for
    that (the caregiver may not see it in time), so this must be enforced
    deterministically rather than left to the model to remember every time."""
    agent = MedicalAgent(DEFAULT_PROVIDER, DEFAULT_MODEL)

    class _FakeToolStep:
        def __init__(self, tool, observation):
            self.tool = tool
            self.observation = observation

    class _FakeRetriever:
        def invoke(self, query):
            return []

    class _FakeExecutor:
        def invoke(self, inputs):
            return {
                "output": "",  # the empty-final-text failure mode
                "intermediate_steps": [
                    (_FakeToolStep("alert_caregiver", "已通知照顧者（電話：91234567）：陳太情況緊急"), "已通知照顧者（電話：91234567）：陳太情況緊急"),
                ],
            }

    # retriever/executor are pydantic Runnables — can't monkeypatch attributes
    # onto the instances directly, so swap in plain stand-in objects instead.
    monkeypatch.setattr(agent, "retriever", _FakeRetriever())
    monkeypatch.setattr(agent, "executor", _FakeExecutor())

    result = agent.ask("我突然間好嚴重咁喘唔到氣", {"name": "陳太", "age": "72", "conditions": [], "medications": []})

    assert "alert_caregiver" in result["tool_calls"]
    assert "999" in result["answer"]
