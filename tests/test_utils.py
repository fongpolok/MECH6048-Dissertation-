"""Smoke tests for src/utils.py logging helpers. No Ollama/network required."""
import json

import src.config as config
import src.utils as utils


def test_save_and_load_health_log(tmp_path, monkeypatch):
    log_path = tmp_path / "health_logs.jsonl"
    monkeypatch.setattr(utils, "HEALTH_LOG_PATH", log_path)

    utils.save_health_log(bp=135, glucose=6.2)
    utils.save_health_log(bp=128, glucose=5.8)

    logs = utils.load_health_logs()
    assert len(logs) == 2
    assert logs[-1]["bp"] == 128
    assert logs[-1]["glucose"] == 5.8
    assert "timestamp" in logs[-1]


def test_save_event_log_records_type(tmp_path, monkeypatch):
    events_path = tmp_path / "events_log.jsonl"
    monkeypatch.setattr(utils, "EVENTS_LOG_PATH", events_path)

    utils.save_event_log("medication", {"name": "Metformin", "taken": True})
    logs = utils.load_event_logs()

    assert len(logs) == 1
    assert logs[0]["type"] == "medication"
    assert logs[0]["name"] == "Metformin"
    assert logs[0]["taken"] is True


def test_load_profile_reads_real_file():
    profile = utils.load_profile()
    assert "name" in profile
    assert "conditions" in profile


def test_config_paths_exist():
    assert config.PROJECT_ROOT.exists()
    assert config.PROFILE_PATH.exists()
