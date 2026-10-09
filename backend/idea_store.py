from __future__ import annotations

import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

_STORE_PATH = Path(__file__).resolve().parent / "data" / "generated_ideas.json"
_LOCK = threading.Lock()


def _empty() -> dict[str, Any]:
    return {"runs": {}, "ideas": {}}


def _read() -> dict[str, Any]:
    if not _STORE_PATH.exists():
        return _empty()
    try:
        payload = json.loads(_STORE_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return _empty()
    if not isinstance(payload, dict):
        return _empty()
    runs = payload.get("runs") if isinstance(payload.get("runs"), dict) else {}
    ideas = payload.get("ideas") if isinstance(payload.get("ideas"), dict) else {}
    return {"runs": runs, "ideas": ideas}


def _write(payload: dict[str, Any]) -> None:
    _STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = _STORE_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(_STORE_PATH)


def save_run(inputs: dict[str, Any], ideas: list[dict[str, Any]], research_summary: str) -> dict[str, Any]:
    run_id = str(uuid4())
    record = {
        "id": run_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "inputs": inputs,
        "research_summary": research_summary,
        "ideas": ideas,
    }
    with _LOCK:
        payload = _read()
        payload["runs"][run_id] = record
        for idea in ideas:
            idea_id = str(idea.get("id") or "").strip()
            if not idea_id:
                continue
            payload["ideas"][idea_id] = {**idea, "run_id": run_id}
        _write(payload)
    return record


def get_run(run_id: str) -> dict[str, Any] | None:
    with _LOCK:
        record = _read()["runs"].get(run_id)
    return record if isinstance(record, dict) else None


def get_idea(idea_id: str) -> dict[str, Any] | None:
    with _LOCK:
        record = _read()["ideas"].get(idea_id)
    return record if isinstance(record, dict) else None
