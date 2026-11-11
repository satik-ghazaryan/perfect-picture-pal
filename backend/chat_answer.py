from __future__ import annotations

import json
import os
import re

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


class ChatTurnIn(BaseModel):
    role: str
    text: str = Field(max_length=500)


class ChatAnswerRequest(BaseModel):
    message: str = Field(min_length=1, max_length=500)
    history: list[ChatTurnIn] = Field(default_factory=list, max_length=8)
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


def _search(catalog: list[dict], query: str) -> dict:
    needle = _norm(_clean(query))
    found = []
    for tour in catalog:
        names = [_norm(tour["title"]), _norm(tour.get("location") or "")]
        names.extend(_norm(alias) for alias in tour.get("aliases") or [])
        if any(name and len(name) >= 3 and (name in needle or needle in name) for name in names):
            found.append({"id": tour["id"], "title": tour["title"], "location": tour.get("location")})
    return {"tours": found[:8]}


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


def answer_public_chat(body: ChatAnswerRequest) -> dict:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is missing.")
    catalog = [tour.model_dump() for tour in body.tours]
    selected = _find(catalog, body.selectedTourId or "")
    history = []
    for turn in body.history[-8:]:
        if turn.role not in {"user", "assistant"}:
            continue
        text = _clean(turn.text)
        if text:
            history.append({"role": turn.role, "content": text})
    messages: list[dict] = [
        {
            "role": "system",
            "content": (
                "You answer for Ari Gnank, one-day tours from Armavir. "
                "The visitor writes conversational Armenian, with typos and follow-up questions. "
                "Use the recent messages and the selected tour to understand them. "
                "Call a tool before stating any price, date, time, seat count, program, or link. "
                "Use search_tours for a place or region. Use get_price for cost and pass party for a group. "
                "The server calculates the total. Copy prices, times, seat counts, and links only from tool results. "
                "If the price tool says it is missing, tell the visitor the price is not published yet, using the tool sentence. "
                "If the departure tool says there is no open departure, say that. "
                "If search finds nothing, say that direction is not published. "
                "Write natural, short Armenian. The first line must answer the question. "
                "Do not ask for a name, phone, or payment. "
                "Call suggest_action with interest when a tour has no open departure, booking when they want to book an open departure, and choices when several tours match."
            ),
        },
        *history,
        {
            "role": "user",
            "content": json.dumps(
                {
                    "question": _clean(body.message),
                    "selected_tour": {"id": selected["id"], "title": selected["title"]} if selected else None,
                },
                ensure_ascii=False,
            ),
        },
    ]
    client = OpenAI(api_key=api_key, timeout=12)
    model = os.getenv("OPENAI_MODEL", "gpt-4o-mini").strip() or "gpt-4o-mini"
    calls: list[dict] = []
    reply = ""
    for _ in range(4):
        response = client.chat.completions.create(
            model=model,
            temperature=0,
            messages=messages,
            tools=_TOOLS,
        )
        message = response.choices[0].message
        tool_calls = message.tool_calls or []
        if not tool_calls:
            reply = (message.content or "").strip()[:1200]
            break
        messages.append(message.model_dump())
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
    suggest = "none"
    for call in calls:
        if call.get("name") == "suggest_action" and call.get("action") in {"booking", "interest", "choices"}:
            suggest = call["action"]
    return {"reply": reply, "calls": calls[:8], "suggest": suggest}
