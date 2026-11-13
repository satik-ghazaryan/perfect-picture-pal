from __future__ import annotations

import html
import hmac
import os
import re
from collections import deque
from dataclasses import dataclass, field

import httpx

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

    def reset(self) -> None:
        self.history.clear()
        self.selected = None
        self.choices.clear()


class ChatStore:
    def __init__(self) -> None:
        self._chats: dict[int, ChatMemory] = {}

    def get(self, chat_id: int) -> ChatMemory:
        memory = self._chats.get(chat_id)
        if memory is None:
            memory = ChatMemory()
            self._chats[chat_id] = memory
        return memory


def main_keyboard(choices: list[dict[str, str]] | None = None) -> dict:
    rows = [[UPCOMING], [DIRECTIONS]]
    for choice in (choices or [])[:6]:
        title = choice.get("title", "").strip()
        if title and title not in {UPCOMING, DIRECTIONS}:
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
            extra.append(f"Ամրագրել՝ {url}")
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
        "history": memory.history[-16:],
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
    memory.history = memory.history[-16:]
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


def send_message(chat_id: int, text: str, choices: list[dict[str, str]] | None = None) -> None:
    token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
    if len(token) < 20:
        raise RuntimeError("Telegram bot token is not configured.")
    response = httpx.post(
        f"https://api.telegram.org/bot{token}/sendMessage",
        json={
            "chat_id": chat_id,
            "text": text,
            "parse_mode": "HTML",
            "reply_markup": main_keyboard(choices),
            "disable_web_page_preview": True,
        },
        timeout=10,
    )
    response.raise_for_status()


def answer_for(memory: ChatMemory, text: str, chat_id: int, ask=ask_site) -> tuple[str, str]:
    plan = plan_message(memory, text)
    if plan["kind"] == "start":
        return START_TEXT, "rules"
    payload = ask(site_body(memory, plan), chat_id)
    remember(memory, text, payload)
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
    if not ok:
        return
    try:
        me = httpx.get(f"https://api.telegram.org/bot{token}/getMe", timeout=10)
        username = me.json().get("result", {}).get("username")
    except Exception:
        username = None
    if isinstance(username, str) and re.fullmatch(r"[A-Za-z0-9_]{4,32}", username):
        print(f"telegram bot: {username}", flush=True)
