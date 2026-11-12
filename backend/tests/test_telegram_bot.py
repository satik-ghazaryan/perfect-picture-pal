import os

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
    assert "https://perfect-picture-pal-beige.vercel.app/tours/tatev" in reply
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
    lori = render_reply("Ընտրիր ուղղությունը։", "https://perfect-picture-pal-beige.vercel.app", {
        "choices": [{"id": "lori", "title": "Լոռի՝ Արմավիրից"}],
    })
    assert lori == 'Ընտրիր ուղղությունը։\n<a href="https://perfect-picture-pal-beige.vercel.app/tours/lori">Լոռի՝ Արմավիրից</a>'
    assert site_body(second, plan_message(second, "Լոռի՝ Արմավիրից"))["section"] == "tour"


def test_missing_secret_is_rejected(monkeypatch):
    monkeypatch.delenv("TELEGRAM_WEBHOOK_SECRET", raising=False)
    os.environ.pop("TELEGRAM_WEBHOOK_SECRET", None)
    assert webhook_authorized("webhook-secret-16") is False
