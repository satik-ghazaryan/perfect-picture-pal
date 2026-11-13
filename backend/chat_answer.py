from __future__ import annotations

import difflib
import json
import os
import re
from datetime import datetime, timedelta, timezone

from openai import OpenAI
from pydantic import BaseModel, Field

_PRIVATE = re.compile(r"\+?\d[\d\s-]{6,}\d")
_TOUR_ID = re.compile(r"^[a-z0-9-]{1,64}$")


class CatalogTour(BaseModel):
    id: str = Field(max_length=64)
    title: str = Field(max_length=120)
    location: str | None = Field(default=None, max_length=80)
    aliases: list[str] = Field(default_factory=list, max_length=24)
    price: int | None = None
    priceMissing: str = Field(max_length=180)
    departureLine: str = Field(max_length=400)
    seatLine: str = Field(max_length=400)
    programLine: str = Field(max_length=900)
    link: str = Field(max_length=80)


HISTORY_TURNS = 16


class ChatTurnIn(BaseModel):
    role: str
    text: str = Field(max_length=2000)


class ChatAnswerRequest(BaseModel):
    message: str = Field(min_length=1, max_length=500)
    history: list[ChatTurnIn] = Field(default_factory=list, max_length=40)
    selectedTourId: str | None = Field(default=None, max_length=64)
    tours: list[CatalogTour] = Field(default_factory=list, max_length=30)


def _clean(value: str) -> str:
    return _PRIVATE.sub(" ", value).strip()[:500]


def _norm(value: str) -> str:
    return re.sub(r"[^\w\s-]", " ", value.lower(), flags=re.UNICODE)


def _find(catalog: list[dict], tour_id: str) -> dict | None:
    if not _TOUR_ID.fullmatch(tour_id or ""):
        return None
    for tour in catalog:
        if tour["id"] == tour_id:
            return tour
    return None


def _close(word: str, name: str) -> bool:
    if len(word) < 5 or len(name) < 5:
        return False
    return difflib.SequenceMatcher(None, word, name[: len(word) + 2]).ratio() >= 0.8


def _search(catalog: list[dict], query: str) -> dict:
    needle = _norm(_clean(query))
    words = [word for word in needle.split() if len(word) >= 3]
    found = []
    loose = []
    for tour in catalog:
        names = [_norm(tour["title"]), _norm(tour.get("location") or "")]
        names.extend(_norm(alias) for alias in tour.get("aliases") or [])
        names = [name.strip() for name in names if name and len(name.strip()) >= 3]
        row = {"id": tour["id"], "title": tour["title"], "location": tour.get("location")}
        if any(name in needle or (len(needle.strip()) >= 3 and needle.strip() in name) for name in names):
            found.append(row)
            continue
        parts = [part for name in names for part in name.split()]
        if any(_close(word, part) for word in words for part in parts):
            loose.append(row)
    return {"tours": (found or loose)[:8]}


def _price(catalog: list[dict], tour_id: str, party: int | None) -> dict:
    tour = _find(catalog, tour_id)
    if not tour:
        return {"error": "missing"}
    unit = tour.get("price")
    if not isinstance(unit, int) or unit <= 0:
        return {"id": tour["id"], "missing": True, "unit": None, "total": None, "sentence": tour["priceMissing"], "link": tour["link"]}
    total = None
    sentence = f"{unit} դրամ՝ մեկ անձի համար։"
    if isinstance(party, int) and 2 <= party <= 12:
        total = unit * party
        people = "Երկու հոգու համար" if party == 2 else f"{party} հոգու համար"
        sentence = f"{people}՝ {total} դրամ ({unit} դրամ՝ մեկ անձի համար)։"
    return {"id": tour["id"], "missing": False, "unit": unit, "total": total, "sentence": sentence, "link": tour["link"]}


def _line(catalog: list[dict], tour_id: str, key: str) -> dict:
    tour = _find(catalog, tour_id)
    if not tour:
        return {"error": "missing"}
    return {"id": tour["id"], "title": tour["title"], "sentence": tour[key], "link": tour["link"]}


def _run_tool(catalog: list[dict], name: str, arguments: dict) -> tuple[dict, dict]:
    tour_id = arguments.get("tour_id") if isinstance(arguments.get("tour_id"), str) else None
    party = arguments.get("party") if isinstance(arguments.get("party"), int) and 1 <= arguments["party"] <= 12 else None
    query = arguments.get("query") if isinstance(arguments.get("query"), str) else ""
    action = arguments.get("action") if arguments.get("action") in {"none", "booking", "interest", "choices"} else None
    if name == "search_tours":
        return _search(catalog, query), {"name": name, "tourId": None, "party": None, "query": _clean(query)[:80], "action": None}
    if name == "get_price":
        return _price(catalog, tour_id or "", party), {"name": name, "tourId": tour_id, "party": party, "query": None, "action": None}
    if name == "get_departures":
        return _line(catalog, tour_id or "", "departureLine"), {"name": name, "tourId": tour_id, "party": None, "query": None, "action": None}
    if name == "get_seats":
        return _line(catalog, tour_id or "", "seatLine"), {"name": name, "tourId": tour_id, "party": party, "query": None, "action": None}
    if name == "get_program":
        return _line(catalog, tour_id or "", "programLine"), {"name": name, "tourId": tour_id, "party": None, "query": None, "action": None}
    if name == "suggest_action":
        return {"ok": True}, {"name": name, "tourId": tour_id, "party": None, "query": None, "action": action or "none"}
    return {"error": "unknown"}, {"name": "suggest_action", "tourId": None, "party": None, "query": None, "action": "none"}


_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "search_tours",
            "description": "Find published tours by place, region, or title, including typos.",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_price",
            "description": "Read the published price. The server calculates the group total.",
            "parameters": {
                "type": "object",
                "properties": {
                    "tour_id": {"type": "string"},
                    "party": {"type": "integer"},
                },
                "required": ["tour_id"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_departures",
            "description": "Read the next published departure, time, and whether it is open.",
            "parameters": {
                "type": "object",
                "properties": {"tour_id": {"type": "string"}},
                "required": ["tour_id"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_seats",
            "description": "Read free seats for the next open departure.",
            "parameters": {
                "type": "object",
                "properties": {
                    "tour_id": {"type": "string"},
                    "party": {"type": "integer"},
                },
                "required": ["tour_id"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_program",
            "description": "Read the public route, included items, and excluded items.",
            "parameters": {
                "type": "object",
                "properties": {"tour_id": {"type": "string"}},
                "required": ["tour_id"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "suggest_action",
            "description": "Suggest a site button. interest when no departure is open, booking when the visitor wants to book an open departure, choices when several tours match.",
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["none", "booking", "interest", "choices"]},
                    "tour_id": {"type": "string"},
                },
                "required": ["action"],
                "additionalProperties": False,
            },
        },
    },
]


_WEEKDAYS = ("երկուշաբթի", "երեքշաբթի", "չորեքշաբթի", "հինգշաբթի", "ուրբաթ", "շաբաթ", "կիրակի")
_YEREVAN = timezone(timedelta(hours=4))

_RULES = """You are the chat assistant of «Արի Գնանք» (Ari Gnank), a small company that runs one-day group tours departing from Armavir, Armenia. You talk with visitors on the website and in Telegram.

HOW TO TALK
- Write the way a friendly, competent person from the team would write in a messenger: warm, plain, modern Eastern Armenian, informal «դու». No bureaucratic or translated-sounding phrasing.
- Answer the question that was asked, in the first sentence. Usually 1-3 short sentences. Do not recite the whole program, price and dates when the visitor asked about one thing.
- This is one continuous conversation. Read the earlier messages before answering. A follow-up such as «իսկ գի՞նը», «քանի՞սն ենք գնում», «երեխայով կարելի՞ է», «իսկ մյուսը՞» refers to the tour you were just discussing. Never ask the visitor to repeat something they already told you (which tour, how many people, which date).
- If the visitor changes the subject to another tour, follow them and treat that tour as the current one from then on.
- Do not greet again after the first message. Do not start every message the same way. Do not repeat a sentence you already sent.
- If the question is genuinely ambiguous between tours, ask one short clarifying question instead of guessing.
- After answering you may add ONE short, relevant next step (for example offering to check free seats, or asking how many people are coming), but only when it moves the conversation forward. Not in every message.
- Small talk, thanks and goodbyes get a short human reply with no tool call.
- If asked about something the tools do not cover (weather, visas, other companies), say briefly that you do not have that information and offer what you can help with.

FACTS
- Every price, date, time, seat count, program detail and link must come from a tool result in this turn. Call the tool even if a number appears earlier in the conversation, because seats and departures change.
- You already know which tours exist from the TOURS list below, so call get_price / get_departures / get_seats / get_program directly with the tour id. Use search_tours only when the visitor names a place that you cannot match to the list yourself.
- For questions across tours («ի՞նչ տուրեր ունեք», «ամենաէժանը ո՞րն է», «այս շաբաթ-կիրակի ի՞նչ կա») call the needed tool for each relevant tour, then compare and answer. Never claim something about a tour you did not look up.
- Pass party to get_price or get_seats when the visitor said how many people are coming. The server calculates the total; never do price arithmetic yourself.
- Write numbers exactly as the tool gives them, digits only, without thousands separators (16000, not 16,000 or 16 000).
- When you mention a tour for the first time, include its link exactly as the tool returned it.
- If get_price says the price is missing, tell the visitor so, and the reply must contain the words «դեռ հրապարակված չէ».
- If a tool says there is no open departure, the reply must contain the words «բաց մեկնում դեռ չկա». Then offer to note their interest.
- If the place is not in the TOURS list and search_tours finds nothing, say that this direction is not published yet and mention what is available.
- Never ask for a name, phone number or payment in the chat. Booking happens through the site button.

BUTTONS
- Call suggest_action with booking when the visitor wants to book a tour that has an open departure, interest when the tour has no open departure, choices when several tours fit and the visitor should pick one."""


def _today_line() -> str:
    now = datetime.now(_YEREVAN)
    return f"Today is {_WEEKDAYS[now.weekday()]}, {now.strftime('%Y-%m-%d')} (Yerevan time)."


def _system_prompt(catalog: list[dict], selected: dict | None) -> str:
    lines = []
    for tour in catalog:
        place = f" | {tour['location']}" if tour.get("location") else ""
        lines.append(f"- {tour['id']} | {tour['title']}{place}")
    listing = "\n".join(lines) or "(no published tours right now)"
    current = (
        f"The visitor is currently looking at / talking about: {selected['title']} (id {selected['id']}). "
        "Unless they name another tour, questions are about this one."
        if selected
        else "No tour has been picked yet in this conversation."
    )
    return f"{_RULES}\n\n{_today_line()}\n\nTOURS (id | title | place)\n{listing}\n\n{current}"


def _temperature() -> float:
    try:
        value = float(os.getenv("CHAT_TEMPERATURE", "0.4"))
    except ValueError:
        return 0.4
    return min(max(value, 0.0), 1.0)


def _chat_model() -> str:
    return (
        os.getenv("CHAT_MODEL", "").strip()
        or os.getenv("OPENAI_MODEL", "").strip()
        or "gpt-4o-mini"
    )


def build_chat_messages(body: ChatAnswerRequest) -> tuple[list[dict], list[dict]]:
    catalog = [tour.model_dump() for tour in body.tours]
    selected = _find(catalog, body.selectedTourId or "")
    history = []
    for turn in body.history[-HISTORY_TURNS:]:
        if turn.role not in {"user", "assistant"}:
            continue
        text = _PRIVATE.sub(" ", turn.text).strip()[:1200]
        if text:
            history.append({"role": turn.role, "content": text})
    messages: list[dict] = [
        {"role": "system", "content": _system_prompt(catalog, selected)},
        *history,
        {"role": "user", "content": _clean(body.message)},
    ]
    return messages, catalog


def _complete(client: OpenAI, **kwargs):
    """Some newer models only accept their default temperature. Ask again without it."""
    try:
        return client.chat.completions.create(**kwargs)
    except Exception as error:  # noqa: BLE001
        if "temperature" not in str(error).lower() or "temperature" not in kwargs:
            raise
        kwargs.pop("temperature")
        return client.chat.completions.create(**kwargs)


def answer_public_chat(body: ChatAnswerRequest) -> dict:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is missing.")
    messages, catalog = build_chat_messages(body)
    client = OpenAI(api_key=api_key, timeout=15)
    model = _chat_model()
    temperature = _temperature()
    calls: list[dict] = []
    reply = ""
    for _ in range(4):
        response = _complete(
            client,
            model=model,
            temperature=temperature,
            messages=messages,
            tools=_TOOLS,
        )
        message = response.choices[0].message
        tool_calls = message.tool_calls or []
        if not tool_calls:
            reply = (message.content or "").strip()[:1200]
            break
        messages.append(message.model_dump(exclude_none=True))
        for call in tool_calls:
            try:
                arguments = json.loads(call.function.arguments or "{}")
            except json.JSONDecodeError:
                arguments = {}
            if not isinstance(arguments, dict):
                arguments = {}
            result, recorded = _run_tool(catalog, call.function.name, arguments)
            calls.append(recorded)
            messages.append({
                "role": "tool",
                "tool_call_id": call.id,
                "content": json.dumps(result, ensure_ascii=False),
            })
    if not reply and calls:
        # The model kept looking things up. Ask once more for the answer itself.
        response = _complete(
            client,
            model=model,
            temperature=temperature,
            messages=messages,
            tools=_TOOLS,
            tool_choice="none",
        )
        reply = (response.choices[0].message.content or "").strip()[:1200]
    suggest = "none"
    for call in calls:
        if call.get("name") == "suggest_action" and call.get("action") in {"booking", "interest", "choices"}:
            suggest = call["action"]
    return {"reply": reply, "calls": calls[:8], "suggest": suggest}
