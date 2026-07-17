from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

from src.config import DATA_DIR, PROFILE_PATH

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


def save_event_log(event_type: str, payload: dict) -> dict:
    """Append an event (medication taken, BP/glucose/HbA1c reading, wellness answers, etc.).

    Every entry gets a unique id so it can later be amended via update_event_log —
    readings are often mistyped or backdated, so "log once, never touch again"
    isn't good enough for a health-tracking log.
    """
    entry = {
        "id": str(uuid.uuid4()),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "type": event_type,
        **payload,
    }
    return _append_jsonl(EVENTS_LOG_PATH, entry)


def load_event_logs(limit: int = 50) -> list[dict]:
    return _read_jsonl(EVENTS_LOG_PATH, limit)


def update_event_log(entry_id: str, patch: dict) -> dict | None:
    """Amend an existing event in place (e.g. correcting a mistyped BP reading).

    JSONL is an append log, so an edit means: read everything, patch the matching
    entry, rewrite the file. Fine at this scale (a single user's personal health
    log, not a high-volume store). Returns the updated entry, or None if no event
    with that id exists.
    """
    if not EVENTS_LOG_PATH.exists():
        return None
    with open(EVENTS_LOG_PATH, encoding="utf-8") as f:
        entries = [json.loads(line) for line in f if line.strip()]

    updated = None
    for entry in entries:
        if entry.get("id") == entry_id:
            entry.update(patch)
            entry["edited_at"] = datetime.now(timezone.utc).isoformat()
            updated = entry
            break
    if updated is None:
        return None

    with open(EVENTS_LOG_PATH, "w", encoding="utf-8") as f:
        for entry in entries:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    return updated
