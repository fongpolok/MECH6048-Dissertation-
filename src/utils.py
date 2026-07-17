import json
from datetime import datetime, timezone
from pathlib import Path

from src.config import DATA_DIR, HEALTH_LOG_PATH, PROFILE_PATH

EVENTS_LOG_PATH = DATA_DIR / "events_log.jsonl"


def load_profile() -> dict:
    with open(PROFILE_PATH, encoding="utf-8") as f:
        return json.load(f)


def _append_jsonl(path: Path, entry: dict) -> dict:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    return entry


def _read_jsonl(path: Path, limit: int) -> list[dict]:
    if not path.exists():
        return []
    with open(path, encoding="utf-8") as f:
        lines = [json.loads(line) for line in f if line.strip()]
    return lines[-limit:]


def save_health_log(bp: float = 0, glucose: float = 0) -> dict:
    """Append a health reading to data/health_logs.jsonl so caregivers/doctors can review trends."""
    entry = {"timestamp": datetime.now(timezone.utc).isoformat(), "bp": bp, "glucose": glucose}
    return _append_jsonl(HEALTH_LOG_PATH, entry)


def load_health_logs(limit: int = 50) -> list[dict]:
    return _read_jsonl(HEALTH_LOG_PATH, limit)


def save_event_log(event_type: str, payload: dict) -> dict:
    """Append a non-vitals event (medication taken, wellness questionnaire, etc.)."""
    entry = {"timestamp": datetime.now(timezone.utc).isoformat(), "type": event_type, **payload}
    return _append_jsonl(EVENTS_LOG_PATH, entry)


def load_event_logs(limit: int = 50) -> list[dict]:
    return _read_jsonl(EVENTS_LOG_PATH, limit)
