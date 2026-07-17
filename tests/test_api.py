"""API contract tests. The LLM agent is stubbed out so these run offline/without
Ollama — see eval/evaluate.py for tests that exercise the real model."""
import pytest
from fastapi.testclient import TestClient

import src.api as api


class _StubAgent:
    def ask(self, message, profile, chat_history=None):
        return {"answer": f"stub reply to: {message}", "sources": ["hkrf_ht.pdf"]}


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(api, "get_medical_agent", lambda: _StubAgent())
    return TestClient(api.app)


def test_health(client):
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}


def test_profile(client):
    res = client.get("/api/profile")
    assert res.status_code == 200
    assert "name" in res.json()


def test_chat_returns_reply_and_sources(client):
    res = client.post("/api/chat", json={"message": "血壓好高點算", "history": []})
    assert res.status_code == 200
    body = res.json()
    assert body["reply"].startswith("stub reply to:")
    assert body["sources"] == ["hkrf_ht.pdf"]


def test_chat_rejects_empty_message(client):
    res = client.post("/api/chat", json={"message": "   ", "history": []})
    assert res.status_code == 400


def test_chat_with_history(client):
    history = [{"role": "user", "text": "你好"}, {"role": "agent", "text": "你好！"}]
    res = client.post("/api/chat", json={"message": "血糖偏低", "history": history})
    assert res.status_code == 200


def test_log_reading_roundtrip(client, tmp_path, monkeypatch):
    monkeypatch.setattr(api, "save_health_log", lambda bp=0, glucose=0: {"bp": bp, "glucose": glucose})
    res = client.post("/api/log", json={"bp": 130, "glucose": 6.0})
    assert res.status_code == 200
    assert res.json() == {"bp": 130, "glucose": 6.0}


def test_medication_log(client, monkeypatch):
    monkeypatch.setattr(api, "save_event_log", lambda t, p: {"type": t, **p})
    res = client.post("/api/medications/log", json={"name": "Metformin", "taken": True})
    assert res.status_code == 200
    assert res.json() == {"type": "medication", "name": "Metformin", "taken": True}


def test_wellness_submission(client, monkeypatch):
    monkeypatch.setattr(api, "save_event_log", lambda t, p: {"type": t, **p})
    res = client.post("/api/wellness", json={"answers": {"1": "良好"}})
    assert res.status_code == 200
    assert res.json()["type"] == "wellness"
