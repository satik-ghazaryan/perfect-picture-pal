from __future__ import annotations

import json
import os
import re
from typing import Any

from agent.search import discovery_queries, run_place_attraction_search


PLACE_EXTRACT_SYSTEM = (
    "You extract geographic place names from tour preference text. "
    "Reply with JSON only. No markdown. "
    'Schema: {"place_en": string or null, "region_en": string or null}. '
    "place_en is the English name of the place or region the user asked for. "
    "region_en is the English region or province if it is stated, otherwise null. "
    "If the text has no place or region, both fields are null. "
    "Do not invent a destination. Do not list candidate places."
)


def parse_place_json(data: Any) -> dict[str, str | None]:
    if not isinstance(data, dict):
        return {"place_en": None, "region_en": None}
    place = str(data.get("place_en") or "").strip() or None
    region = str(data.get("region_en") or "").strip() or None
    if place and place.lower() in {"null", "none", "n/a", "-"}:
        place = None
    if region and region.lower() in {"null", "none", "n/a", "-"}:
        region = None
    return {"place_en": place, "region_en": region}


def _extract_json(text: str) -> Any:
    raw = text.strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r"(\{[\s\S]*\}|\[[\s\S]*\])", raw)
        if not match:
            raise
        return json.loads(match.group(1))


def invoke_place_llm(preferences: str) -> dict[str, str | None]:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        return {"place_en": None, "region_en": None}
    from langchain_core.messages import HumanMessage, SystemMessage
    from langchain_openai import ChatOpenAI

    model = os.getenv("OPENAI_PLACE_MODEL", "").strip() or os.getenv("OPENAI_MODEL", "gpt-4o-mini").strip() or "gpt-4o-mini"
    llm = ChatOpenAI(model=model, temperature=0, api_key=api_key, timeout=45)
    response = llm.invoke(
        [
            SystemMessage(content=PLACE_EXTRACT_SYSTEM),
            HumanMessage(
                content=(
                    "Preference text:\n"
                    f"{preferences}\n\n"
                    'Return JSON only: {"place_en": "...", "region_en": "..."} '
                    "or nulls if no place is mentioned."
                )
            ),
        ]
    )
    content = response.content
    if not isinstance(content, str) or not content.strip():
        return {"place_en": None, "region_en": None}
    return parse_place_json(_extract_json(content))


def discover_place(preferences: str) -> dict[str, Any]:
    prefs = str(preferences or "").strip()
    if not prefs:
        return {
            "place_en": None,
            "region_en": None,
            "queries": [],
            "results": [],
            "skipped": "no_preferences",
        }
    try:
        extracted = invoke_place_llm(prefs)
    except Exception:  # noqa: BLE001
        extracted = {"place_en": None, "region_en": None}
    place_en = extracted.get("place_en")
    region_en = extracted.get("region_en")
    if not place_en:
        return {
            "place_en": None,
            "region_en": region_en,
            "queries": [],
            "results": [],
            "skipped": "no_place",
        }
    search_payload = run_place_attraction_search(place_en)
    return {
        "place_en": place_en,
        "region_en": region_en,
        "queries": search_payload.get("queries") or discovery_queries(place_en),
        "results": search_payload.get("results") or [],
        "search_status": search_payload.get("search_status") or "",
        "skipped": "",
    }
