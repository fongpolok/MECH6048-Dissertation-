"""API contract tests. The LLM agent is stubbed out so these run offline/without
Ollama — see eval/evaluate.py for tests that exercise the real model."""
import json

import pytest
from fastapi.testclient import TestClient

import src.api as api


class _StubAgent:
    def ask(self, message, profile, chat_history=None):
        return {"answer": f"stub reply to: {message}", "sources": ["hkrf_ht.pdf"]}


class _EmergencyStubAgent:
    def ask(self, message, profile, chat_history=None):
        return {"answer": "呢個係緊急情況，請立即致電999！", "sources": ["hkrf_ht.pdf"]}


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


def test_chat_flags_non_emergency_reply(client):
    res = client.post("/api/chat", json={"message": "血糖偏低", "history": []})
    assert res.status_code == 200
    assert res.json()["is_emergency"] is False


def test_chat_flags_emergency_reply(monkeypatch):
    monkeypatch.setattr(api, "get_medical_agent", lambda: _EmergencyStubAgent())
    client = TestClient(api.app)
    res = client.post("/api/chat", json={"message": "胸口好痛", "history": []})
    assert res.status_code == 200
    assert res.json()["is_emergency"] is True


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


def test_log_bp_record(client, monkeypatch):
    monkeypatch.setattr(api, "save_event_log", lambda t, p: {"type": t, **p})
    res = client.post("/api/records/bp", json={"date": "7月", "sys": 130, "dia": 82})
    assert res.status_code == 200
    assert res.json() == {"type": "bp_reading", "date": "7月", "sys": 130, "dia": 82}


def test_get_bp_records_filters_by_type(client, monkeypatch):
    events = [
        {"type": "bp_reading", "date": "6月", "sys": 128, "dia": 80},
        {"type": "medication", "name": "Metformin", "taken": True},
        {"type": "bp_reading", "date": "7月", "sys": 130, "dia": 82},
    ]
    monkeypatch.setattr(api, "load_event_logs", lambda limit=1000: events)
    res = client.get("/api/records/bp")
    assert res.status_code == 200
    assert res.json() == [
        {"type": "bp_reading", "date": "6月", "sys": 128, "dia": 80},
        {"type": "bp_reading", "date": "7月", "sys": 130, "dia": 82},
    ]


def test_log_hba1c_record(client, monkeypatch):
    monkeypatch.setattr(api, "save_event_log", lambda t, p: {"type": t, **p})
    res = client.post("/api/records/hba1c", json={"date": "7月", "value": 7.1})
    assert res.status_code == 200
    assert res.json() == {"type": "hba1c_reading", "date": "7月", "value": 7.1}


def test_get_hba1c_records_filters_by_type(client, monkeypatch):
    events = [
        {"type": "hba1c_reading", "date": "5月", "value": 7.4},
        {"type": "bp_reading", "date": "6月", "sys": 128, "dia": 80},
    ]
    monkeypatch.setattr(api, "load_event_logs", lambda limit=1000: events)
    res = client.get("/api/records/hba1c")
    assert res.status_code == 200
    assert res.json() == [{"type": "hba1c_reading", "date": "5月", "value": 7.4}]


def test_log_glucose_record(client, monkeypatch):
    monkeypatch.setattr(api, "save_event_log", lambda t, p: {"type": t, **p})
    res = client.post("/api/records/glucose", json={"date": "2026-07-17", "value": 6.2})
    assert res.status_code == 200
    assert res.json() == {"type": "glucose_reading", "date": "2026-07-17", "value": 6.2}


def test_get_glucose_records_filters_by_type(client, monkeypatch):
    events = [
        {"type": "glucose_reading", "date": "2026-07-16", "value": 5.8},
        {"type": "bp_reading", "date": "2026-07-16", "sys": 128, "dia": 80},
    ]
    monkeypatch.setattr(api, "load_event_logs", lambda limit=2000: events)
    res = client.get("/api/records/glucose")
    assert res.status_code == 200
    assert res.json() == [{"type": "glucose_reading", "date": "2026-07-16", "value": 5.8}]


def test_amend_bp_record(client, monkeypatch):
    monkeypatch.setattr(
        api, "update_event_log",
        lambda entry_id, patch: {"id": entry_id, "type": "bp_reading", "date": "2026-07-17", "sys": 135, "dia": 85, **patch},
    )
    res = client.patch("/api/records/bp/abc123", json={"sys": 135, "dia": 85})
    assert res.status_code == 200
    body = res.json()
    assert body["sys"] == 135 and body["dia"] == 85


def test_amend_missing_record_returns_404(client, monkeypatch):
    monkeypatch.setattr(api, "update_event_log", lambda entry_id, patch: None)
    res = client.patch("/api/records/hba1c/does-not-exist", json={"value": 7.0})
    assert res.status_code == 404


def test_amend_glucose_record_only_sends_provided_fields(client, monkeypatch):
    captured = {}

    def fake_update(entry_id, patch):
        captured["entry_id"] = entry_id
        captured["patch"] = patch
        return {"id": entry_id, "type": "glucose_reading", **patch}

    monkeypatch.setattr(api, "update_event_log", fake_update)
    res = client.patch("/api/records/glucose/xyz", json={"value": 5.5})
    assert res.status_code == 200
    assert captured["patch"] == {"value": 5.5}  # date wasn't sent, so it's omitted, not nulled out


def test_eval_report_missing_returns_404(client, tmp_path, monkeypatch):
    monkeypatch.setattr(api, "EVAL_REPORT_PATH", tmp_path / "does_not_exist.json")
    res = client.get("/api/eval/latest")
    assert res.status_code == 404


def test_eval_report_returns_saved_json(client, tmp_path, monkeypatch):
    report = {"summary": {"overall_pass_rate": 0.75}, "cases": []}
    report_path = tmp_path / "latest.json"
    report_path.write_text(json.dumps(report), encoding="utf-8")
    monkeypatch.setattr(api, "EVAL_REPORT_PATH", report_path)
    res = client.get("/api/eval/latest")
    assert res.status_code == 200
    assert res.json() == report
