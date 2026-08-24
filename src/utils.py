from __future__ import annotations

import json
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

from src.config import DATA_DIR, MODEL_SETTINGS_PATH, PROFILE_PATH, PROJECT_ROOT
from src.providers import DEFAULT_MODEL, DEFAULT_PROVIDER, PROVIDERS

EVENTS_LOG_PATH = DATA_DIR / "events_log.jsonl"
ENV_PATH = PROJECT_ROOT / ".env"


def load_profile() -> dict:
    with open(PROFILE_PATH, encoding="utf-8") as f:
        return json.load(f)


def load_model_selection() -> dict:
    """Which (provider, model) the chat agent should use — see src/providers.py.
    Falls back to the local Ollama default if nothing has been selected yet."""
    if not MODEL_SETTINGS_PATH.exists():
        return {"provider": DEFAULT_PROVIDER, "model": DEFAULT_MODEL}
    with open(MODEL_SETTINGS_PATH, encoding="utf-8") as f:
        return json.load(f)


def save_model_selection(provider: str, model: str) -> dict:
    selection = {"provider": provider, "model": model}
    with open(MODEL_SETTINGS_PATH, "w", encoding="utf-8") as f:
        json.dump(selection, f, ensure_ascii=False, indent=2)
    return selection


def set_api_key(provider: str, api_key: str) -> None:
    """Persists an API key for a cloud provider (ANTHROPIC_API_KEY /
    GOOGLE_API_KEY / DEEPSEEK_API_KEY — see src/providers.py PROVIDERS) so a
    key entered once in Settings survives a backend restart, using the same
    env var each provider's SDK already reads via os.getenv. Written to .env,
    which is gitignored (see .gitignore) — never committed, never echoed back
    to the frontend afterwards, only whether the provider is `available`.

    Sets os.environ immediately too, so the key works for the rest of this
    process without waiting for a restart to pick up the .env change.
    """
    if provider not in PROVIDERS:
        raise ValueError(f"unknown provider: {provider!r}")
    env_var = PROVIDERS[provider]["needs_key"]
    if not env_var:
        raise ValueError(f"provider {provider!r} does not use an API key")

    api_key = api_key.strip()
    if not api_key:
        raise ValueError("api_key must not be empty")

    os.environ[env_var] = api_key

    lines = ENV_PATH.read_text(encoding="utf-8").splitlines() if ENV_PATH.exists() else []
    pattern = re.compile(rf"^{re.escape(env_var)}=")
    for i, line in enumerate(lines):
        if pattern.match(line):
            lines[i] = f"{env_var}={api_key}"
            break
    else:
        lines.append(f"{env_var}={api_key}")
    ENV_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")


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
