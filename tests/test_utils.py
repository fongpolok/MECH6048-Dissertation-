"""Smoke tests for src/utils.py logging helpers. No Ollama/network required."""
import src.config as config
import src.utils as utils


def test_save_event_log_records_type(tmp_path, monkeypatch):
    events_path = tmp_path / "events_log.jsonl"
    monkeypatch.setattr(utils, "EVENTS_LOG_PATH", events_path)

    utils.save_event_log("medication", {"name": "Metformin", "taken": True})
    logs = utils.load_event_logs()

    assert len(logs) == 1
    assert logs[0]["type"] == "medication"
    assert logs[0]["name"] == "Metformin"
    assert logs[0]["taken"] is True


def test_save_event_log_assigns_unique_id(tmp_path, monkeypatch):
    events_path = tmp_path / "events_log.jsonl"
    monkeypatch.setattr(utils, "EVENTS_LOG_PATH", events_path)

    a = utils.save_event_log("bp_reading", {"date": "2026-07-17", "sys": 130, "dia": 82})
    b = utils.save_event_log("bp_reading", {"date": "2026-07-16", "sys": 128, "dia": 80})

    assert a["id"] and b["id"]
    assert a["id"] != b["id"]


def test_update_event_log_amends_matching_entry(tmp_path, monkeypatch):
    events_path = tmp_path / "events_log.jsonl"
    monkeypatch.setattr(utils, "EVENTS_LOG_PATH", events_path)

    entry = utils.save_event_log("bp_reading", {"date": "2026-07-17", "sys": 130, "dia": 82})
    other = utils.save_event_log("bp_reading", {"date": "2026-07-16", "sys": 128, "dia": 80})

    updated = utils.update_event_log(entry["id"], {"sys": 135, "dia": 85})

    assert updated is not None
    assert updated["sys"] == 135 and updated["dia"] == 85
    assert updated["id"] == entry["id"]
    assert "edited_at" in updated

    logs = utils.load_event_logs()
    assert len(logs) == 2  # amending doesn't create a new row
    amended = next(e for e in logs if e["id"] == entry["id"])
    assert amended["sys"] == 135
    untouched = next(e for e in logs if e["id"] == other["id"])
    assert untouched["sys"] == 128


def test_update_event_log_returns_none_for_unknown_id(tmp_path, monkeypatch):
    events_path = tmp_path / "events_log.jsonl"
    monkeypatch.setattr(utils, "EVENTS_LOG_PATH", events_path)

    utils.save_event_log("bp_reading", {"date": "2026-07-17", "sys": 130, "dia": 82})
    assert utils.update_event_log("does-not-exist", {"sys": 999}) is None


def test_update_event_log_on_empty_log_returns_none(tmp_path, monkeypatch):
    events_path = tmp_path / "events_log.jsonl"
    monkeypatch.setattr(utils, "EVENTS_LOG_PATH", events_path)
    assert utils.update_event_log("anything", {"sys": 130}) is None


def test_load_profile_reads_real_file():
    profile = utils.load_profile()
    assert "name" in profile
    assert "conditions" in profile


def test_config_paths_exist():
    assert config.PROJECT_ROOT.exists()
    assert config.PROFILE_PATH.exists()
