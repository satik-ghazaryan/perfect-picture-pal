from __future__ import annotations

import html
import hmac
import json
import os
import re
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

import httpx

from telegram_booking import BOOK, booking_step, clean_booking, start_booking

START_TEXT = "Բարև՜ 👋 Ո՞ւր գնանք այս անգամ։"
UPCOMING = "Առաջիկա տուրեր"
DIRECTIONS = "Մեր ուղղությունները"
SITE_ORIGIN = "https://perfect-picture-pal-beige.vercel.app"
_TOUR_ID = re.compile(r"^[a-z0-9-]{1,64}$")
_LINK = re.compile(r"\[([^\]]+)\]\((/tours/[a-z0-9-]+)\)")
_PRIVATE = re.compile(r"\+?\d[\d\s-]{6,}\d")
_SEEN_LIMIT = 500


def _secret_matches(given: str | None, expected: str) -> bool:
    incoming = (given or "").encode("utf-8")
    wanted = expected.encode("utf-8")
    if len(incoming) != len(wanted) or len(wanted) < 16:
        hmac.compare_digest(wanted or b"x", wanted or b"x")
        return False
    return hmac.compare_digest(incoming, wanted)


def webhook_authorized(header: str | None) -> bool:
    return _secret_matches(header, os.getenv("TELEGRAM_WEBHOOK_SECRET", "").strip())


def site_origin() -> str:
    raw = os.getenv("PUBLIC_SITE_URL", SITE_ORIGIN).strip() or SITE_ORIGIN
    try:
        parsed = httpx.URL(raw)
    except Exception:
        return SITE_ORIGIN
    if parsed.scheme != "https" or not parsed.host:
        return SITE_ORIGIN
    return f"https://{parsed.host}"


def clean_text(value: str) -> str:
    return _PRIVATE.sub(" ", value).strip()[:500]


class UpdateLedger:
    def __init__(self) -> None:
        self._ids: deque[int] = deque()
        self._seen: set[int] = set()

    def once(self, update_id: int) -> bool:
        if update_id in self._seen:
            return False
        self._seen.add(update_id)
        self._ids.append(update_id)
        while len(self._ids) > _SEEN_LIMIT:
            self._seen.discard(self._ids.popleft())
        return True


@dataclass
class ChatMemory:
    history: list[dict[str, str]] = field(default_factory=list)
    selected: str | None = None
    choices: list[dict[str, str]] = field(default_factory=list)
    booking: dict | None = None

    def reset(self) -> None:
        self.history.clear()
        self.selected = None
        self.choices.clear()
        self.booking = None


MEMORY_TURNS = 16
MEMORY_DAYS = 7
_TABLE = "telegram_chats"


def _turns(value: object) -> list[dict[str, str]]:
    turns: list[dict[str, str]] = []
    for item in value if isinstance(value, list) else []:
        if not isinstance(item, dict):
            continue
        role = item.get("role")
        text = item.get("text")
        if role in {"user", "assistant"} and isinstance(text, str) and text.strip():
            turns.append({"role": role, "text": clean_text(text)})
    return turns[-MEMORY_TURNS:]


def _choices(value: object) -> list[dict[str, str]]:
    choices: list[dict[str, str]] = []
    for item in value if isinstance(value, list) else []:
        if not isinstance(item, dict):
            continue
        tour_id = item.get("id")
        title = item.get("title")
        if isinstance(tour_id, str) and isinstance(title, str) and _TOUR_ID.fullmatch(tour_id) and title.strip():
            choices.append({"id": tour_id, "title": title.strip()[:120]})
    return choices[:8]


def _database() -> tuple[str, str] | None:
    """Supabase REST address and service key, when the server is allowed to keep chats."""
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
    return f"https://{parsed.host}/rest/v1/{_TABLE}", key


def _headers(key: str) -> dict[str, str]:
    return {"apikey": key, "authorization": f"Bearer {key}", "content-type": "application/json"}


def load_memory(chat_id: int, now: datetime | None = None, http=httpx) -> ChatMemory | None:
    """The saved conversation, or None when nothing usable is stored."""
    target = _database()
    if not target:
        return None
    url, key = target
    rows = None
    for columns in ("history,selected,choices,booking,updated_at", "history,selected,choices,updated_at"):
        try:
            response = http.get(
                url,
                params={"chat_id": f"eq.{chat_id}", "select": columns},
                headers=_headers(key),
                timeout=4,
            )
            response.raise_for_status()
            rows = response.json()
            break
        except Exception:
            continue
    if rows is None:
        return None
    row = rows[0] if isinstance(rows, list) and rows and isinstance(rows[0], dict) else None
    if not row:
        return None
    try:
        saved = datetime.fromisoformat(str(row.get("updated_at") or "").replace("Z", "+00:00"))
    except ValueError:
        return None
    if saved.tzinfo is None:
        saved = saved.replace(tzinfo=timezone.utc)
    if (now or datetime.now(timezone.utc)) - saved > timedelta(days=MEMORY_DAYS):
        return None
    selected = row.get("selected")
    return ChatMemory(
        history=_turns(row.get("history")),
        selected=selected if isinstance(selected, str) and _TOUR_ID.fullmatch(selected) else None,
        choices=_choices(row.get("choices")),
        booking=clean_booking(row.get("booking")),
    )


def save_memory(chat_id: int, memory: ChatMemory, now: datetime | None = None, http=httpx) -> bool:
    target = _database()
    if not target:
        return False
    url, key = target
    row = {
        "chat_id": chat_id,
        "history": _turns(memory.history),
        "selected": memory.selected,
        "choices": _choices(memory.choices),
        "booking": clean_booking(memory.booking),
        "updated_at": (now or datetime.now(timezone.utc)).isoformat(),
    }
    # Without the booking column (migration not run yet) the chat is still kept.
    for body in (row, {k: v for k, v in row.items() if k != "booking"}):
        try:
            response = http.post(
                url,
                params={"on_conflict": "chat_id"},
                headers={**_headers(key), "prefer": "resolution=merge-duplicates,return=minimal"},
                json=body,
                timeout=4,
            )
            response.raise_for_status()
            return True
        except Exception:
            continue
    return False


class ChatStore:
    """Conversations by Telegram chat. Kept in memory and, when configured, in Supabase,
    so a restart or a sleeping server does not make the bot forget what was being discussed."""

    def __init__(self, load=load_memory, save=save_memory) -> None:
        self._chats: dict[int, ChatMemory] = {}
        self._load = load
        self._save = save

    def get(self, chat_id: int) -> ChatMemory:
        memory = self._chats.get(chat_id)
        if memory is None:
            memory = self._load(chat_id) or ChatMemory()
            self._chats[chat_id] = memory
            while len(self._chats) > 2000:
                self._chats.pop(next(iter(self._chats)))
        return memory

    def save(self, chat_id: int) -> bool:
        memory = self._chats.get(chat_id)
        return self._save(chat_id, memory) if memory is not None else False


def main_keyboard(choices: list[dict[str, str]] | None = None, can_book: bool = False) -> dict:
    rows = [[BOOK]] if can_book else []
    rows += [[UPCOMING], [DIRECTIONS]]
    for choice in (choices or [])[:6]:
        title = choice.get("title", "").strip()
        if title and title not in {UPCOMING, DIRECTIONS, BOOK}:
            rows.append([title])
    return {
        "keyboard": [[{"text": item} for item in row] for row in rows],
        "resize_keyboard": True,
        "is_persistent": True,
    }


def tour_url(origin: str, tour_id: str) -> str | None:
    if not _TOUR_ID.fullmatch(tour_id):
        return None
    return f"{origin}/tours/{tour_id}"


def render_reply(text: str, origin: str, payload: dict | None = None) -> str:
    links: list[tuple[str, str]] = []

    def replace(match: re.Match[str]) -> str:
        url = f"{origin}{match.group(2)}"
        links.append((match.group(1), url))
        return f"\x00{len(links) - 1}\x00"

    body = _LINK.sub(replace, text or "")
    record = payload or {}
    extra: list[str] = []
    interest = record.get("interest") if isinstance(record.get("interest"), dict) else None
    booking = record.get("booking") if isinstance(record.get("booking"), dict) else None
    if interest and interest.get("tourId"):
        url = tour_url(origin, str(interest["tourId"]))
        if url and url not in body:
            extra.append(f"Գրանցել հետաքրքրություն՝ {url}")
    if booking and booking.get("tourId"):
        url = tour_url(origin, str(booking["tourId"]))
        if url and url not in body and url not in " ".join(extra):
            extra.append(
                f"Կարող ես ամրագրել հենց այստեղ՝ սեղմիր «{BOOK}», կամ կայքում՝ {url}#book"
            )
    if extra:
        body = f"{body}\n" + "\n".join(extra)
    for choice in record.get("choices") or []:
        if not isinstance(choice, dict):
            continue
        url = tour_url(origin, str(choice.get("id") or ""))
        title = str(choice.get("title") or "").strip()
        if url and title and url not in body:
            links.append((title, url))
            body += f"\n\x00{len(links) - 1}\x00"
    escaped = html.escape(body)
    for index, (label, url) in enumerate(links):
        anchor = f'<a href="{html.escape(url, quote=True)}">{html.escape(label)}</a>'
        escaped = escaped.replace(f"\x00{index}\x00", anchor)
    return escaped.strip()


def plan_message(memory: ChatMemory, text: str) -> dict:
    if text == "/start":
        memory.reset()
        return {"kind": "start"}
    if text == UPCOMING:
        return {"kind": "section", "section": "upcoming", "message": text}
    if text == DIRECTIONS:
        return {"kind": "section", "section": "directions", "message": text}
    for choice in memory.choices:
        if choice.get("title") == text and _TOUR_ID.fullmatch(choice.get("id") or ""):
            return {"kind": "section", "section": "tour", "message": text, "tourId": choice["id"]}
    return {"kind": "text", "message": text}


def site_body(memory: ChatMemory, plan: dict) -> dict:
    body: dict = {
        "message": plan["message"],
        "history": memory.history[-MEMORY_TURNS:],
        "selectedTourId": memory.selected,
    }
    if plan["kind"] == "section":
        body["action"] = "open-section"
        body["section"] = plan["section"]
        if plan.get("tourId"):
            body["selectedTourId"] = plan["tourId"]
    return body


def remember(memory: ChatMemory, user_text: str, payload: dict) -> None:
    memory.history.append({"role": "user", "text": clean_text(user_text)})
    reply = payload.get("reply") if isinstance(payload.get("reply"), str) else ""
    if reply:
        memory.history.append({"role": "assistant", "text": clean_text(reply)})
    memory.history = memory.history[-MEMORY_TURNS:]
    selected = payload.get("selectedTourId")
    if isinstance(selected, str) and _TOUR_ID.fullmatch(selected):
        memory.selected = selected
    choices = []
    for choice in payload.get("choices") or []:
        if not isinstance(choice, dict):
            continue
        tour_id = choice.get("id")
        title = choice.get("title")
        if isinstance(tour_id, str) and isinstance(title, str) and _TOUR_ID.fullmatch(tour_id) and title.strip():
            choices.append({"id": tour_id, "title": title.strip()[:120]})
    memory.choices = choices[:8]


def ask_site(body: dict, chat_id: int) -> dict:
    origin = site_origin()
    secret = os.getenv("CHAT_INTENT_API_SECRET", "").strip()
    response = httpx.post(
        f"{origin}/api/tour-chat",
        json=body,
        headers={
            "content-type": "application/json",
            "x-chat-client": "telegram",
            "x-chat-id": str(chat_id),
            "x-api-secret": secret,
        },
        timeout=25,
    )
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict):
        raise RuntimeError("Chat response was not an object.")
    return payload


def send_message(
    chat_id: int,
    text: str,
    choices: list[dict[str, str]] | None = None,
    keyboard: dict | None = None,
    can_book: bool = False,
) -> None:
    token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
    if len(token) < 20:
        raise RuntimeError("Telegram bot token is not configured.")
    response = httpx.post(
        f"https://api.telegram.org/bot{token}/sendMessage",
        json={
            "chat_id": chat_id,
            "text": text,
            "parse_mode": "HTML",
            "reply_markup": keyboard or main_keyboard(choices, can_book),
            "disable_web_page_preview": True,
        },
        timeout=10,
    )
    response.raise_for_status()


def booking_reply(memory: ChatMemory, text: str, contact_phone: str | None, chat_id: int, http=httpx) -> tuple[str, dict] | None:
    """The bot's own booking flow. None when the message is not part of a booking."""
    if text == "/start":
        memory.booking = None
        return None
    origin = site_origin()
    if memory.booking:
        return booking_step(memory, text, contact_phone, chat_id, origin, http=http)
    if text == BOOK:
        if not memory.selected:
            return ("Նախ ընտրիր տուրը, հետո սեղմիր «Ամրագրել»։", {})
        return start_booking(memory, memory.selected, f"{origin}/tours/{memory.selected}#book", http=http)
    return None


def answer_for(memory: ChatMemory, text: str, chat_id: int, ask=ask_site) -> tuple[str, str]:
    plan = plan_message(memory, text)
    if plan["kind"] == "start":
        return START_TEXT, "rules"
    payload = ask(site_body(memory, plan), chat_id)
    remember(memory, text, payload)
    booking = payload.get("booking") if isinstance(payload.get("booking"), dict) else None
    if booking and isinstance(booking.get("tourId"), str) and _TOUR_ID.fullmatch(booking["tourId"]):
        memory.selected = booking["tourId"]
    reply = payload.get("reply") if isinstance(payload.get("reply"), str) else ""
    if not reply:
        reply = "Չաթը հիմա չկարողացավ պատասխանել։ Կարող ես բացել կատալոգը։"
    source = payload.get("understood") if payload.get("understood") in {"openai", "rules"} else "rules"
    return render_reply(reply, site_origin(), payload), source


def register_webhook() -> None:
    token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
    secret = os.getenv("TELEGRAM_WEBHOOK_SECRET", "").strip()
    if len(token) < 20 or len(secret) < 16:
        print("telegram configured: false", flush=True)
        return
    backend = os.getenv("PUBLIC_BACKEND_URL", "https://perfect-picture-pal.onrender.com").strip().rstrip("/")
    try:
        response = httpx.post(
            f"https://api.telegram.org/bot{token}/setWebhook",
            json={
                "url": f"{backend}/api/telegram/webhook",
                "secret_token": secret,
                "allowed_updates": ["message"],
            },
            timeout=10,
        )
        ok = response.status_code == 200 and response.json().get("ok") is True
    except Exception:
        ok = False
    print(f"telegram webhook registered: {str(ok).lower()}", flush=True)
    print(f"telegram database configured: {str(_database() is not None).lower()}", flush=True)
    if not ok:
        return
    try:
        me = httpx.get(f"https://api.telegram.org/bot{token}/getMe", timeout=10)
        username = me.json().get("result", {}).get("username")
    except Exception:
        username = None
    if isinstance(username, str) and re.fullmatch(r"[A-Za-z0-9_]{4,32}", username):
        print(f"telegram bot: {username}", flush=True)
    print(f"telegram webhook status: {webhook_status(token, backend)}", flush=True)


def webhook_status(token: str, backend: str, http=httpx) -> str:
    """What Telegram itself says about delivering updates to this server, without any secret.

    The server log only shows updates that arrive. When none arrive, this line says why:
    Telegram keeps the last delivery error and the number of updates still waiting.
    """
    try:
        response = http.get(f"https://api.telegram.org/bot{token}/getWebhookInfo", timeout=10)
        info = response.json().get("result")
    except Exception:
        return "unavailable"
    if not isinstance(info, dict):
        return "unavailable"
    url = str(info.get("url") or "")
    status = {
        "points_here": url == f"{backend}/api/telegram/webhook",
        "host": httpx.URL(url).host if url.startswith("https://") else "",
        "pending": info.get("pending_update_count") if isinstance(info.get("pending_update_count"), int) else None,
        "last_error_at": info.get("last_error_date") if isinstance(info.get("last_error_date"), int) else None,
        "last_error": clean_text(str(info.get("last_error_message") or ""))[:160],
    }
    return json.dumps(status, ensure_ascii=False, separators=(",", ":"))
