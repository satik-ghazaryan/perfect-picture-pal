"""A quick look at whether the live server is set up: settings present and database up to date.

Only yes/no answers leave the server: never a key, a URL or a row.
"""

from __future__ import annotations

import os
import time

import httpx

from telegram_booking import supabase_target

SETTINGS = {
    "openai": ("OPENAI_API_KEY",),
    "telegram_bot": ("TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET"),
    "database": ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"),
    "chat_api": ("CHAT_INTENT_API_SECRET",),
    "ideas_api": ("IDEAS_API_SECRET",),
}

# Each probe is harmless: invalid input is rejected before anything is written.
DATABASE_PROBES = {
    "telegram_chats_table": ("get", "/rest/v1/telegram_chats", {"select": "chat_id,booking", "limit": "0"}, None),
    "telegram_booking_function": (
        "post",
        "/rest/v1/rpc/book_departure_telegram",
        None,
        {
            "p_departure_id": "00000000-0000-0000-0000-000000000000",
            "p_chat_id": 0,
            "p_passenger_name": "",
            "p_phone": "",
            "p_adults": 0,
            "p_children": 0,
            "p_request_key": "setup-check",
            "p_expected_price": 0,
        },
    ),
    "link_guest_bookings_function": (
        "post",
        "/rest/v1/rpc/claim_guest_booking",
        None,
        {"p_ticket_code": "", "p_phone": ""},
    ),
}

CACHE_SEC = 60
_cache: dict[str, object] = {}


def _database_checks(http=httpx) -> dict[str, bool]:
    target = supabase_target()
    if not target:
        return dict.fromkeys(DATABASE_PROBES, False)
    base, key = target
    headers = {"apikey": key, "authorization": f"Bearer {key}", "content-type": "application/json"}
    results: dict[str, bool] = {}
    for name, (method, path, params, body) in DATABASE_PROBES.items():
        try:
            if method == "get":
                response = http.get(f"{base}{path}", params=params, headers=headers, timeout=6)
            else:
                response = http.post(f"{base}{path}", json=body, headers=headers, timeout=6)
            results[name] = response.status_code < 400
        except Exception:
            results[name] = False
    return results


def setup_status(http=httpx, now: float | None = None) -> dict[str, object]:
    moment = time.monotonic() if now is None else now
    cached = _cache.get("value")
    if cached is not None and moment - float(_cache.get("at", 0.0)) < CACHE_SEC:
        return cached  # type: ignore[return-value]
    settings = {
        name: all(os.getenv(variable, "").strip() for variable in variables)
        for name, variables in SETTINGS.items()
    }
    database = _database_checks(http)
    value = {
        "ok": all(settings.values()) and all(database.values()),
        "settings": settings,
        "database": database,
    }
    _cache.update(value=value, at=moment)
    return value
