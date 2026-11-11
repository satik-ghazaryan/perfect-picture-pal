from __future__ import annotations

import json
import os
import re

from openai import OpenAI
from pydantic import BaseModel, Field

INTENTS = (
    "price",
    "departure",
    "seats",
    "place",
    "included",
    "contact",
    "summary",
    "full",
    "notice",
    "booking",
    "greeting",
    "upcoming",
    "directions",
    "unknown",
)


class ChatIntentRequest(BaseModel):
    message: str = Field(min_length=1, max_length=500)
    direction: str | None = Field(default=None, max_length=80)
    tour: str | None = Field(default=None, max_length=80)


class ChatIntentResult(BaseModel):
    intent: str
    direction: str | None = None
    party: int | None = None


def _clip(value: str | None) -> str:
    text = re.sub(r"\+?\d[\d\s-]{6,}\d", "", (value or "")).strip()
    return text[:80]


def classify_chat_intent(body: ChatIntentRequest) -> ChatIntentResult:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is missing.")
    model = os.getenv("OPENAI_MODEL", "gpt-4o-mini").strip() or "gpt-4o-mini"
    message = _clip(body.message)
    direction = _clip(body.direction)
    tour = _clip(body.tour)
    client = OpenAI(api_key=api_key, timeout=8)
    response = client.chat.completions.create(
        model=model,
        temperature=0,
        response_format={"type": "json_object"},
        messages=[
            {
                "role": "system",
                "content": (
                    "Classify one Armenian tour question. Return JSON with keys intent, direction, party. "
                    "intent is one of: price, departure, seats, place, included, contact, summary, full, "
                    "notice, booking, greeting, upcoming, directions, unknown. "
                    "direction is the place or tour the user means, or null. "
                    "Use the supplied last direction only when this question continues that subject. "
                    "party is how many people they ask about, or null. "
                    "Do not add prices, dates, phone numbers, or names of people."
                ),
            },
            {
                "role": "user",
                "content": json.dumps(
                    {"question": message, "last_direction": direction or None, "selected_tour": tour or None},
                    ensure_ascii=False,
                ),
            },
        ],
    )
    content = response.choices[0].message.content or "{}"
    parsed = json.loads(content)
    intent = parsed.get("intent") if isinstance(parsed, dict) else None
    if intent not in INTENTS:
        intent = "unknown"
    raw_direction = parsed.get("direction") if isinstance(parsed, dict) else None
    direction_out = raw_direction.strip()[:40] if isinstance(raw_direction, str) and raw_direction.strip() else None
    raw_party = parsed.get("party") if isinstance(parsed, dict) else None
    party = raw_party if isinstance(raw_party, int) and 1 <= raw_party <= 12 else None
    return ChatIntentResult(intent=intent, direction=direction_out, party=party)
