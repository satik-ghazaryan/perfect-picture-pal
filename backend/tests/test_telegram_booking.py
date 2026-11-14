from __future__ import annotations

from telegram_bot import ChatMemory, booking_reply, load_memory, main_keyboard, save_memory
from telegram_booking import BOOK, CANCEL, CONFIRM, clean_booking

DEPARTURE = "b3f34215-fe83-4766-ac5f-7e484db26655"


class FakeResponse:
    def __init__(self, data, status=200):
        self._data = data
        self.status_code = status

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(str(self.status_code))

    def json(self):
        return self._data


class FakeHttp:
    def __init__(self, rpc_results=None):
        self.calls = []
        self.rpc_results = list(rpc_results or [])

    def get(self, url, params=None, headers=None, timeout=None):
        self.calls.append(("get", url, params))
        if url.endswith("/tours"):
            return FakeResponse([{"id": "dil", "title_hy": "Դիլիջան", "price": 8000, "departure_time": "08:00:00"}])
        return FakeResponse([{"id": DEPARTURE, "departure_date": "2026-11-24", "available_seats": 3}])

    def post(self, url, json=None, headers=None, timeout=None, params=None):
        self.calls.append(("post", url, json))
        return FakeResponse(self.rpc_results.pop(0))


def configure(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://project.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key-0123456789")


def test_full_booking_in_the_chat(monkeypatch):
    configure(monkeypatch)
    ok = {
        "ok": True, "ticket_code": "AG-1234ABCD", "seat_numbers": [4, 5], "payable": 16000,
        "tour_id": "dil", "tour_title": "Դիլիջան", "departure_date": "2026-11-24", "departure_time": "08:00",
    }
    http = FakeHttp([ok])
    memory = ChatMemory(selected="dil")
    text, keyboard = booking_reply(memory, BOOK, None, 42, http=http)
    assert "Դիլիջան" in text
    date_button = keyboard["keyboard"][0][0]["text"]
    assert "24 նոյեմբերի" in date_button and "3 ազատ տեղ" in date_button

    booking_reply(memory, date_button, None, 42, http=http)
    _, keyboard = booking_reply(memory, "Սաթիկ Ղազարյան", None, 42, http=http)
    assert keyboard["keyboard"][0][0].get("request_contact") is True
    booking_reply(memory, "", "37494369900", 42, http=http)
    _, keyboard = booking_reply(memory, "4", None, 42, http=http)
    assert "Գրիր թիվ 1-ից 3" in booking_reply(memory, "4", None, 42, http=http)[0]
    booking_reply(memory, "2", None, 42, http=http)
    assert "Գրիր թիվ 0-ից 1" in booking_reply(memory, "2", None, 42, http=http)[0]
    summary, keyboard = booking_reply(memory, "0", None, 42, http=http)
    assert "16 000 ֏" in summary and keyboard["keyboard"][0][0]["text"] == CONFIRM

    done, keyboard = booking_reply(memory, CONFIRM, None, 42, http=http)
    assert "AG-1234ABCD" in done and "ticket=AG-1234ABCD" in done
    assert memory.booking is None and keyboard == {}
    rpc = [call for call in http.calls if call[0] == "post"][0]
    assert rpc[1].endswith("/rest/v1/rpc/book_departure_telegram")
    assert rpc[2]["p_departure_id"] == DEPARTURE
    assert rpc[2]["p_chat_id"] == 42 and rpc[2]["p_adults"] == 2 and rpc[2]["p_children"] == 0
    assert rpc[2]["p_phone"] == "+37494369900" and rpc[2]["p_expected_price"] == 8000


def test_cancel_and_start_end_the_booking(monkeypatch):
    configure(monkeypatch)
    memory = ChatMemory(selected="dil")
    booking_reply(memory, BOOK, None, 1, http=FakeHttp())
    assert memory.booking is not None
    text, _ = booking_reply(memory, CANCEL, None, 1, http=FakeHttp())
    assert "չեղարկվեց" in text and memory.booking is None
    booking_reply(memory, BOOK, None, 1, http=FakeHttp())
    assert booking_reply(memory, "/start", None, 1, http=FakeHttp()) is None
    assert memory.booking is None


def test_without_a_selected_tour_or_database(monkeypatch):
    memory = ChatMemory()
    assert "Նախ ընտրիր տուրը" in booking_reply(memory, BOOK, None, 1, http=FakeHttp())[0]
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    memory.selected = "dil"
    text, _ = booking_reply(memory, BOOK, None, 1, http=FakeHttp())
    assert "/tours/dil#book" in text and memory.booking is None
    assert booking_reply(memory, "Բարև", None, 1, http=FakeHttp()) is None


def test_sold_out_returns_to_the_dates(monkeypatch):
    configure(monkeypatch)
    http = FakeHttp([{"ok": False, "code": "sold_out", "message": "Ազատ տեղերը չեն բավարարում։"}])
    memory = ChatMemory(selected="dil")
    _, keyboard = booking_reply(memory, BOOK, None, 1, http=http)
    for step in (keyboard["keyboard"][0][0]["text"], "Անուն", "094123456", "1", "0"):
        booking_reply(memory, step, None, 1, http=http)
    text, _ = booking_reply(memory, CONFIRM, None, 1, http=http)
    assert "չեն բավարարում" in text and memory.booking["step"] == "date"


def test_booking_state_is_saved_and_cleaned(monkeypatch):
    configure(monkeypatch)
    memory = ChatMemory(selected="dil")
    booking_reply(memory, BOOK, None, 1, http=FakeHttp())
    stored = {}

    class Store(FakeHttp):
        def post(self, url, json=None, headers=None, timeout=None, params=None):
            stored.update(json)
            return FakeResponse(None, 201)

        def get(self, url, params=None, headers=None, timeout=None):
            return FakeResponse([{**stored, "updated_at": stored["updated_at"]}])

    assert save_memory(1, memory, http=Store())
    assert stored["booking"]["step"] == "date"
    loaded = load_memory(1, http=Store())
    assert loaded.booking == memory.booking
    assert clean_booking({"step": "date", "tour_id": "x;drop", "key": "k" * 20}) is None


def test_saving_still_works_before_the_migration(monkeypatch):
    configure(monkeypatch)
    sent = []

    class OldTable(FakeHttp):
        def post(self, url, json=None, headers=None, timeout=None, params=None):
            sent.append(json)
            return FakeResponse(None, 400 if "booking" in json else 201)

    assert save_memory(1, ChatMemory(), http=OldTable())
    assert "booking" not in sent[-1]


def test_book_button_shows_only_with_a_tour():
    assert main_keyboard([])["keyboard"][0][0]["text"] != BOOK
    assert main_keyboard([], can_book=True)["keyboard"][0][0]["text"] == BOOK


def test_only_the_senders_own_contact_is_used():
    from main import _own_contact_phone

    own = {"from": {"id": 7}, "contact": {"user_id": 7, "phone_number": "+37494111111"}}
    other = {"from": {"id": 7}, "contact": {"user_id": 8, "phone_number": "+37494222222"}}
    unknown = {"from": {"id": 7}, "contact": {"phone_number": "+37494333333"}}
    assert _own_contact_phone(own) == "+37494111111"
    assert _own_contact_phone(other) is None
    assert _own_contact_phone(unknown) is None
