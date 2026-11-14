import os
from datetime import UTC

from telegram_bot import (
    DIRECTIONS,
    START_TEXT,
    UPCOMING,
    ChatMemory,
    ChatStore,
    UpdateLedger,
    answer_for,
    main_keyboard,
    plan_message,
    render_reply,
    site_body,
    webhook_authorized,
)


def test_webhook_secret_and_duplicate_updates(monkeypatch):
    monkeypatch.setenv("TELEGRAM_WEBHOOK_SECRET", "webhook-secret-16")
    assert webhook_authorized("webhook-secret-16") is True
    assert webhook_authorized("webhook-secret-99") is False
    assert webhook_authorized(None) is False
    ledger = UpdateLedger()
    assert ledger.once(7) is True
    assert ledger.once(7) is False
    assert ledger.once(8) is True


def test_start_buttons_and_private_context():
    store = ChatStore()
    first = store.get(10)
    second = store.get(20)
    calls = []

    def ask(body, chat_id):
        calls.append((chat_id, body))
        if body["message"] == "Սյունիք ունե՞ք":
            return {
                "reply": "«Արմավիր – Տաթևի վանք»\n[Բացել տուրի էջը](/tours/tatev)",
                "selectedTourId": "tatev",
                "understood": "openai",
                "interest": {"tourId": "tatev", "label": "Տաթև"},
            }
        return {
            "reply": "Տաթևի տուրի գինը դեռ հրապարակված չէ։",
            "selectedTourId": "tatev",
            "understood": "openai",
            "interest": {"tourId": "tatev", "label": "Տաթև"},
        }

    assert plan_message(first, "/start")["kind"] == "start"
    greeting, source = answer_for(first, "/start", 10, ask)
    assert greeting == START_TEXT
    assert source == "rules"
    assert calls == []
    labels = [button["text"] for row in main_keyboard()["keyboard"] for button in row]
    assert labels == [UPCOMING, DIRECTIONS]

    upcoming = plan_message(first, UPCOMING)
    assert upcoming["section"] == "upcoming"
    directions = plan_message(first, DIRECTIONS)
    assert directions["section"] == "directions"

    reply, source = answer_for(first, "Սյունիք ունե՞ք", 10, ask)
    assert source == "openai"
    assert "https://arignanq.vercel.app/tours/tatev" in reply
    assert "Գրանցել հետաքրքրություն" in reply
    price, _source = answer_for(first, "իսկ գինը՞", 10, ask)
    assert "դեռ հրապարակված չէ" in price
    assert calls[1][1]["selectedTourId"] == "tatev"
    assert calls[1][1]["history"][0]["text"] == "Սյունիք ունե՞ք"

    answer_for(second, "Լոռի", 20, lambda _body, _chat: {
        "reply": "Լոռի",
        "selectedTourId": "lori",
        "understood": "openai",
        "choices": [{"id": "lori", "title": "Լոռի՝ Արմավիրից"}],
    })
    assert first.selected == "tatev"
    assert second.selected == "lori"
    lori = render_reply("Ընտրիր ուղղությունը։", "https://arignanq.vercel.app", {
        "choices": [{"id": "lori", "title": "Լոռի՝ Արմավիրից"}],
    })
    assert lori == 'Ընտրիր ուղղությունը։\n<a href="https://arignanq.vercel.app/tours/lori">Լոռի՝ Արմավիրից</a>'
    assert site_body(second, plan_message(second, "Լոռի՝ Արմավիրից"))["section"] == "tour"


def test_missing_secret_is_rejected(monkeypatch):
    monkeypatch.delenv("TELEGRAM_WEBHOOK_SECRET", raising=False)
    os.environ.pop("TELEGRAM_WEBHOOK_SECRET", None)
    assert webhook_authorized("webhook-secret-16") is False


class _Response:
    def __init__(self, payload=None, status=200):
        self._payload = payload
        self.status_code = status

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError("http error")

    def json(self):
        return self._payload


class _Database:
    def __init__(self):
        self.rows = {}
        self.fail = False

    def get(self, url, params, headers, timeout):
        assert url == "https://project.supabase.co/rest/v1/telegram_chats"
        assert headers["apikey"] == "service-role-key-0123456789"
        if self.fail:
            return _Response(status=500)
        chat_id = int(params["chat_id"].removeprefix("eq."))
        return _Response([self.rows[chat_id]] if chat_id in self.rows else [])

    def post(self, url, params, headers, json, timeout):
        assert params == {"on_conflict": "chat_id"}
        assert "merge-duplicates" in headers["prefer"]
        if self.fail:
            return _Response(status=500)
        self.rows[json["chat_id"]] = json
        return _Response()


def test_chat_memory_survives_a_restart(monkeypatch):
    from datetime import datetime, timedelta
    from functools import partial

    from telegram_bot import load_memory, remember, save_memory

    monkeypatch.setenv("SUPABASE_URL", "https://project.supabase.co/")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key-0123456789")
    database = _Database()
    now = datetime(2026, 11, 13, 9, 0, tzinfo=UTC)
    load = partial(load_memory, http=database, now=now)
    save = partial(save_memory, http=database, now=now)

    first = ChatStore(load=load, save=save)
    memory = first.get(42)
    remember(
        memory,
        "Դիլիջանի տուրը ինչ արժե, համարս +374 94 123456",
        {
            "reply": "8000 դրամ՝ մեկ անձի համար։",
            "selectedTourId": "dilijan-autumn",
            "choices": [{"id": "garni", "title": "Գառնի"}],
        },
    )
    assert first.save(42) is True
    assert "123456" not in str(database.rows[42])

    restarted = ChatStore(load=load, save=save)
    again = restarted.get(42)
    assert again.selected == "dilijan-autumn"
    assert again.choices == [{"id": "garni", "title": "Գառնի"}]
    assert [turn["role"] for turn in again.history] == ["user", "assistant"]
    assert restarted.get(7).history == []

    later = partial(load_memory, http=database, now=now + timedelta(days=8))
    assert ChatStore(load=later, save=save).get(42).history == []

    database.fail = True
    broken = ChatStore(load=load, save=save)
    assert broken.get(42).history == []
    assert broken.save(42) is False


def test_chat_memory_stays_local_without_a_database(monkeypatch):
    from telegram_bot import load_memory, save_memory

    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    assert load_memory(1) is None
    assert save_memory(1, ChatMemory()) is False
    store = ChatStore()
    assert store.get(1) is store.get(1)


def test_webhook_status_reports_what_telegram_says_without_secrets():
    import json as _json

    from telegram_bot import webhook_status

    token = "123456:secret-token-value-abcdefgh"

    class _Http:
        def __init__(self, payload):
            self.payload = payload

        def get(self, url, timeout):
            assert url.endswith("/getWebhookInfo")
            return _Response(self.payload)

    backend = "https://perfect-picture-pal.onrender.com"
    status = webhook_status(
        token,
        backend,
        http=_Http(
            {
                "ok": True,
                "result": {
                    "url": f"{backend}/api/telegram/webhook",
                    "pending_update_count": 3,
                    "last_error_date": 1794580000,
                    "last_error_message": "Wrong response from the webhook: 401 Unauthorized",
                },
            }
        ),
    )
    parsed = _json.loads(status)
    assert parsed == {
        "points_here": True,
        "host": "perfect-picture-pal.onrender.com",
        "pending": 3,
        "last_error_at": 1794580000,
        "last_error": "Wrong response from the webhook: 401 Unauthorized",
    }
    assert token not in status and "secret" not in status
    elsewhere = _json.loads(webhook_status(token, backend, http=_Http({"result": {"url": "https://other.example/hook"}})))
    assert elsewhere["points_here"] is False and elsewhere["host"] == "other.example"
    assert webhook_status(token, backend, http=_Http({"ok": False})) == "unavailable"


def test_booking_reply_sends_people_to_the_booking_form_instead_of_claiming_a_booking():
    from telegram_bot import render_reply

    text = render_reply(
        "Ազատ է 17 տեղ։",
        "https://arignanq.vercel.app",
        {"booking": {"tourId": "dilijan-autumn"}},
    )
    assert "https://arignanq.vercel.app/tours/dilijan-autumn#book" in text
    assert "«🎫 Ամրագրել»" in text
    assert "արված է" not in text


def test_chat_rules_forbid_claiming_a_booking():
    import chat_answer

    assert "cannot make, hold or confirm a booking" in chat_answer._RULES
