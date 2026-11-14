"""Booking a seat directly in the Telegram chat.

The bot asks, one message at a time: date, name, phone, adults, children, then shows a
summary to confirm. The seat is saved by the database function book_departure_telegram,
which only the backend's service key may call. Nothing is charged here: the booking is
saved with payment "PENDING" and the team settles payment with the passenger.
"""

from __future__ import annotations

import html
import os
import re
import secrets
from datetime import datetime, timedelta, timezone

import httpx

BOOK = "🎫 Ամրագրել"
CANCEL = "Չեղարկել"
CONFIRM = "✅ Հաստատել"
SHARE_PHONE = "📱 Ուղարկել իմ համարը"
MAX_SEATS = 10
_TOUR_ID = re.compile(r"^[a-z0-9-]{1,64}$")
_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_KEY = re.compile(r"^[A-Za-z0-9_-]{16,80}$")
_STEPS = {"date", "name", "phone", "adults", "children", "confirm"}
YEREVAN = timezone(timedelta(hours=4))
ARMENIAN_MONTHS = [
    "հունվարի", "փետրվարի", "մարտի", "ապրիլի", "մայիսի", "հունիսի",
    "հուլիսի", "օգոստոսի", "սեպտեմբերի", "հոկտեմբերի", "նոյեմբերի", "դեկտեմբերի",
]

Reply = tuple[str, dict]


def supabase_target() -> tuple[str, str] | None:
    raw = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not raw or len(key) < 20:
        return None
    try:
        parsed = httpx.URL(raw)
    except Exception:
        return None
    if parsed.scheme != "https" or not parsed.host:
        return None
    return f"https://{parsed.host}", key


def _headers(key: str) -> dict[str, str]:
    return {"apikey": key, "authorization": f"Bearer {key}", "content-type": "application/json"}


def format_amd(value: int) -> str:
    return f"{value:,}".replace(",", " ") + " ֏"


def date_label(value: str) -> str:
    try:
        day = datetime.strptime(value, "%Y-%m-%d")
    except ValueError:
        return value
    return f"{day.day} {ARMENIAN_MONTHS[day.month - 1]}"


def clean_booking(value: object) -> dict | None:
    """Only the fields the flow uses, with the expected types; anything else is dropped."""
    if not isinstance(value, dict) or value.get("step") not in _STEPS:
        return None
    tour_id = value.get("tour_id")
    key = value.get("key")
    if not isinstance(tour_id, str) or not _TOUR_ID.fullmatch(tour_id):
        return None
    if not isinstance(key, str) or not _KEY.fullmatch(key):
        return None
    out: dict = {"step": value["step"], "tour_id": tour_id, "key": key}
    for name in ("title", "time", "name", "phone"):
        item = value.get(name)
        if isinstance(item, str) and item.strip():
            out[name] = item.strip()[:120]
    for name in ("price", "adults", "children", "seats_left"):
        item = value.get(name)
        if isinstance(item, int) and not isinstance(item, bool) and 0 <= item <= 10_000_000:
            out[name] = item
    departure = value.get("departure_id")
    if isinstance(departure, str) and _UUID.fullmatch(departure):
        out["departure_id"] = departure
    date = value.get("date")
    if isinstance(date, str) and _DATE.fullmatch(date):
        out["date"] = date
    options = []
    for option in value.get("options") or []:
        if (
            isinstance(option, dict)
            and isinstance(option.get("id"), str)
            and _UUID.fullmatch(option["id"])
            and isinstance(option.get("date"), str)
            and _DATE.fullmatch(option["date"])
            and isinstance(option.get("seats"), int)
        ):
            options.append({"id": option["id"], "date": option["date"], "seats": option["seats"]})
    out["options"] = options[:6]
    return out


def flow_keyboard(rows: list[list[str]], contact: bool = False) -> dict:
    keyboard = []
    for row in rows:
        keyboard.append([{"text": item} for item in row])
    if contact:
        keyboard.insert(0, [{"text": SHARE_PHONE, "request_contact": True}])
    keyboard.append([{"text": CANCEL}])
    return {"keyboard": keyboard, "resize_keyboard": True, "is_persistent": True}


def option_text(option: dict) -> str:
    return f"{date_label(option['date'])} · {option['seats']} ազատ տեղ"


def load_departures(tour_id: str, http=httpx, today: str | None = None) -> tuple[dict, list[dict]] | None:
    """The tour and its next bookable dates. None when the database cannot be reached."""
    target = supabase_target()
    if not target or not _TOUR_ID.fullmatch(tour_id):
        return None
    base, key = target
    day = today or datetime.now(YEREVAN).date().isoformat()
    try:
        tours = http.get(
            f"{base}/rest/v1/tours",
            params={"id": f"eq.{tour_id}", "select": "id,title,title_hy,price,departure_time,is_virtual_only"},
            headers=_headers(key),
            timeout=6,
        )
        tours.raise_for_status()
        rows = tours.json()
        departures = http.get(
            f"{base}/rest/v1/departures",
            params={
                "tour_id": f"eq.{tour_id}",
                "departure_date": f"gte.{day}",
                "available_seats": "gt.0",
                "order": "departure_date.asc",
                "limit": "6",
                "select": "id,departure_date,available_seats",
            },
            headers=_headers(key),
            timeout=6,
        )
        departures.raise_for_status()
        dates = departures.json()
    except Exception:
        return None
    if not isinstance(rows, list) or not rows or not isinstance(rows[0], dict):
        return {}, []
    tour = rows[0]
    if tour.get("is_virtual_only") is True:
        return tour, []
    options = []
    for row in dates if isinstance(dates, list) else []:
        if not isinstance(row, dict):
            continue
        departure_id = str(row.get("id") or "")
        date = str(row.get("departure_date") or "")
        seats = row.get("available_seats")
        if _UUID.fullmatch(departure_id) and _DATE.fullmatch(date) and isinstance(seats, int) and seats > 0:
            options.append({"id": departure_id, "date": date, "seats": seats})
    return tour, options


def call_booking(booking: dict, chat_id: int, http=httpx) -> dict:
    target = supabase_target()
    if not target:
        return {"ok": False, "code": "unavailable"}
    base, key = target
    try:
        response = http.post(
            f"{base}/rest/v1/rpc/book_departure_telegram",
            json={
                "p_departure_id": booking["departure_id"],
                "p_chat_id": chat_id,
                "p_passenger_name": booking["name"],
                "p_phone": booking["phone"],
                "p_adults": booking["adults"],
                "p_children": booking["children"],
                "p_request_key": booking["key"],
                "p_expected_price": booking["price"],
            },
            headers=_headers(key),
            timeout=10,
        )
        response.raise_for_status()
        data = response.json()
    except Exception:
        return {"ok": False, "code": "unavailable"}
    return data if isinstance(data, dict) else {"ok": False, "code": "unavailable"}


def _date_prompt(booking: dict, intro: str = "") -> Reply:
    title = html.escape(booking.get("title", ""))
    text = (intro + "\n\n" if intro else "") + f"🎫 <b>{title}</b>\nԸնտրիր մեկնման օրը։"
    rows = [[option_text(option)] for option in booking["options"]]
    return text.strip(), flow_keyboard(rows)


def start_booking(memory, tour_id: str | None, site_url: str, http=httpx, today: str | None = None) -> Reply | None:
    """Begin booking the selected tour. None means: show the normal menu with this text instead."""
    if not tour_id or not _TOUR_ID.fullmatch(tour_id):
        memory.booking = None
        return None
    loaded = load_departures(tour_id, http=http, today=today)
    if loaded is None:
        memory.booking = None
        return (
            "Ամրագրումն այստեղ հիմա հասանելի չէ։ Կարող ես ամրագրել կայքում՝ "
            f'<a href="{html.escape(site_url, quote=True)}">{html.escape(site_url)}</a>',
            {},
        )
    tour, options = loaded
    title = str(tour.get("title_hy") or tour.get("title") or tour_id).strip()
    price = tour.get("price")
    time = str(tour.get("departure_time") or "").strip()[:5]
    if not options or not isinstance(price, int) or not re.fullmatch(r"\d{2}:\d{2}", time):
        memory.booking = None
        return (f"«{html.escape(title)}» տուրի համար ազատ մեկնում հիմա չկա։", {})
    memory.booking = {
        "step": "date",
        "tour_id": tour_id,
        "key": secrets.token_urlsafe(18),
        "title": title[:120],
        "price": price,
        "time": time,
        "options": options,
    }
    return _date_prompt(memory.booking)


def _number(text: str) -> int | None:
    digits = text.strip()
    return int(digits) if re.fullmatch(r"\d{1,2}", digits) else None


def _summary(booking: dict) -> str:
    seats = booking["adults"] + booking["children"]
    total = booking["price"] * seats
    return "\n".join(
        [
            "Ստուգիր տվյալները՝",
            f"🎫 <b>{html.escape(booking['title'])}</b>",
            f"📅 {date_label(booking['date'])}, մեկնում Արմավիրից՝ {booking['time']}",
            f"👤 {html.escape(booking['name'])} · {html.escape(booking['phone'])}",
            f"🪑 {booking['adults']} մեծ · {booking['children']} երեխա",
            f"💳 Ընդամենը՝ {format_amd(total)}",
            "",
            "Վճարումը այստեղ չի կատարվում. մեր թիմը կկապվի քեզ հետ վճարման համար։",
        ]
    )


def booking_step(
    memory,
    text: str,
    contact_phone: str | None,
    chat_id: int,
    site_origin: str,
    http=httpx,
    today: str | None = None,
) -> Reply | None:
    """Advance the booking. None means the booking ended and the normal menu should return."""
    booking = memory.booking
    if not booking:
        return None
    if text == CANCEL:
        memory.booking = None
        return ("Ամրագրումը չեղարկվեց։", {})
    step = booking["step"]

    if step == "date":
        for option in booking.get("options", []):
            if text == option_text(option) or text == option["date"]:
                booking.update(departure_id=option["id"], date=option["date"], seats_left=option["seats"], step="name")
                return ("Ինչպե՞ս է քո անունը և ազգանունը։", flow_keyboard([]))
        return _date_prompt(booking, "Ընտրիր օրերից մեկը ներքևի կոճակներով։")

    if step == "name":
        name = re.sub(r"\s+", " ", text).strip()
        if len(name) < 2 or len(name) > 80 or re.search(r"\d{3,}", name):
            return ("Գրիր անունդ (առնվազն 2 տառ)։", flow_keyboard([]))
        booking.update(name=name, step="phone")
        return (
            "Ո՞ր հեռախոսահամարով կապվենք։ Սեղմիր «📱 Ուղարկել իմ համարը» կամ գրիր համարը։",
            flow_keyboard([], contact=True),
        )

    if step == "phone":
        raw = contact_phone or text
        digits = re.sub(r"\D", "", raw or "")
        if len(digits) < 8 or len(digits) > 15:
            return ("Գրիր գործող հեռախոսահամար, օրինակ՝ +374 94 123456։", flow_keyboard([], contact=True))
        phone = "+" + digits if (raw or "").strip().startswith("+") or len(digits) > 10 else digits
        booking.update(phone=phone, step="adults")
        limit = min(MAX_SEATS, booking.get("seats_left", MAX_SEATS))
        return ("Քանի՞ մեծահասակ։", flow_keyboard([[str(n) for n in range(1, min(limit, 5) + 1)]]))

    if step == "adults":
        limit = min(MAX_SEATS, booking.get("seats_left", MAX_SEATS))
        count = _number(text)
        if count is None or count < 1 or count > limit:
            return (f"Գրիր թիվ 1-ից {limit}։", flow_keyboard([[str(n) for n in range(1, min(limit, 5) + 1)]]))
        booking.update(adults=count, step="children")
        room = limit - count
        return ("Քանի՞ երեխա։", flow_keyboard([[str(n) for n in range(0, min(room, 4) + 1)]]))

    if step == "children":
        room = min(MAX_SEATS, booking.get("seats_left", MAX_SEATS)) - booking.get("adults", 1)
        count = _number(text)
        if count is None or count < 0 or count > room:
            return (f"Գրիր թիվ 0-ից {room}։", flow_keyboard([[str(n) for n in range(0, min(room, 4) + 1)]]))
        booking.update(children=count, step="confirm")
        return (_summary(booking), flow_keyboard([[CONFIRM]]))

    if step == "confirm":
        if text != CONFIRM:
            return (_summary(booking), flow_keyboard([[CONFIRM]]))
        result = call_booking(booking, chat_id, http=http)
        if result.get("ok") is True:
            memory.booking = None
            return (booked_text(result, site_origin), {})
        code = result.get("code")
        if code in {"stale", "sold_out", "closed"}:
            reason = html.escape(str(result.get("message") or "Տվյալները փոխվել են։"))
            site_url = f"{site_origin}/tours/{booking['tour_id']}#book"
            restarted = start_booking(memory, booking["tour_id"], site_url, http=http, today=today)
            if memory.booking:
                return _date_prompt(memory.booking, f"{reason} Ընտրիր նորից։")
            return (f"{reason}\n{restarted[0]}" if restarted else reason, {})
        if code == "unavailable" and result.get("message"):
            memory.booking = None
            return (html.escape(str(result["message"])), {})
        return (
            "Ամրագրումը հիմա չպահպանվեց։ Փորձիր կրկին «✅ Հաստատել»-ով կամ ամրագրիր կայքում։",
            flow_keyboard([[CONFIRM]]),
        )

    memory.booking = None
    return None


def booked_text(result: dict, site_origin: str) -> str:
    code = str(result.get("ticket_code") or "")
    tour_id = str(result.get("tour_id") or "")
    seats = result.get("seat_numbers")
    seat_text = ", ".join(str(n) for n in seats) if isinstance(seats, list) else ""
    lines = [
        "✅ Ամրագրված է։",
        f"🎫 <b>{html.escape(str(result.get('tour_title') or ''))}</b>",
        f"📅 {date_label(str(result.get('departure_date') or ''))}, մեկնում Արմավիրից՝ "
        f"{html.escape(str(result.get('departure_time') or ''))}",
        f"Ամրագրման կոդ՝ <code>{html.escape(code)}</code>",
    ]
    if seat_text:
        lines.append(f"Նստատեղ՝ {html.escape(seat_text)}")
    payable = result.get("payable")
    if isinstance(payable, int) and payable > 0:
        lines.append(f"Վճարման ենթակա՝ {format_amd(payable)}. մեր թիմը կկապվի քեզ հետ։")
    if code and _TOUR_ID.fullmatch(tour_id):
        url = f"{site_origin}/tours/{tour_id}?ticket={code}"
        lines.append(f'<a href="{html.escape(url, quote=True)}">Թվային տոմս (QR)</a>')
    return "\n".join(lines)
