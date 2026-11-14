from __future__ import annotations

import setup_check


class Response:
    def __init__(self, status_code: int):
        self.status_code = status_code


class Http:
    def __init__(self, missing: set[str]):
        self.missing = missing
        self.calls: list[str] = []

    def get(self, url, params=None, headers=None, timeout=None):
        self.calls.append(url)
        return Response(404 if any(part in url for part in self.missing) else 200)

    def post(self, url, json=None, headers=None, timeout=None):
        self.calls.append(url)
        return Response(404 if any(part in url for part in self.missing) else 200)


ALL = [
    "OPENAI_API_KEY",
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_WEBHOOK_SECRET",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "CHAT_INTENT_API_SECRET",
    "IDEAS_API_SECRET",
]


def configure(monkeypatch):
    for name in ALL:
        monkeypatch.setenv(name, "value-0123456789-abcdefghij")
    monkeypatch.setenv("SUPABASE_URL", "https://project.supabase.co")
    setup_check._cache.clear()


def test_everything_in_place(monkeypatch):
    configure(monkeypatch)
    status = setup_check.setup_status(http=Http(set()), now=1.0)
    assert status["ok"] is True
    assert all(status["database"].values())


def test_missing_migration_and_setting_are_reported_without_values(monkeypatch):
    configure(monkeypatch)
    monkeypatch.delenv("IDEAS_API_SECRET")
    status = setup_check.setup_status(http=Http({"claim_guest_booking"}), now=1.0)
    assert status["ok"] is False
    assert status["settings"]["ideas_api"] is False
    assert status["database"]["link_guest_bookings_function"] is False
    assert status["database"]["telegram_chats_table"] is True
    assert "value-0123456789" not in str(status)


def test_without_database_settings_nothing_is_called(monkeypatch):
    configure(monkeypatch)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY")
    http = Http(set())
    status = setup_check.setup_status(http=http, now=1.0)
    assert http.calls == []
    assert not any(status["database"].values())


def test_result_is_cached_for_a_minute(monkeypatch):
    configure(monkeypatch)
    http = Http(set())
    setup_check.setup_status(http=http, now=1.0)
    setup_check.setup_status(http=http, now=30.0)
    assert len(http.calls) == 3
    setup_check.setup_status(http=http, now=100.0)
    assert len(http.calls) == 6
