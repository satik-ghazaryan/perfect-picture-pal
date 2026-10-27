from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any, Literal, TypedDict

from dotenv import load_dotenv
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from langgraph.graph import END, START, StateGraph
from pydantic import ValidationError

from agent.admin_copy import search_status_note
from agent.distance import has_stop_outside_armavir, one_way_route_km
from agent.place_discovery import discover_place
from agent.onewaytour import UNAVAILABLE as ONEWAYTOUR_UNAVAILABLE
from agent.pricing import (
    GROUP_SIZE,
    GUIDE_FEE_GROUP_AMD,
    MIN_MARGIN_PCT,
    apply_unit_economics,
    apply_yerevan_transfer,
    tag_budget_fit,
)
from agent.quality import (
    attach_review_flag,
    classify_itinerary_stops,
    collect_quality_issues,
    ensure_armavir_bookends,
    ground_idea,
    hy_copy_ok,
    mark_hy_review,
    rewrite_copy_from_numbers,
)
from agent.search import distance_cross_check_snippet, run_market_search
from schemas import GenerateIdeasRequest, TourIdea

load_dotenv(Path(__file__).resolve().parent.parent / ".env")
load_dotenv()


class State(TypedDict):
    inputs: dict[str, Any]
    place_discovery: str
    market_research: str
    research_data: str
    ideas_raw: list[dict[str, Any]]
    evaluated_ideas: list[dict[str, Any]]
    quality_issues: list[str]
    refine_pass: int
    final_report: list[dict[str, Any]]


SYSTEM = (
    "You are the commercial tour desk for «Արի Գնանք» (Ari Gnank). "
    "ALWAYS prioritize tours that start and end in Armavir, Armenia. "
    "Place names, attractions, roads, and factual claims MUST appear in the provided "
    "SEARCH RESULTS JSON, especially place_candidates[]. If a name is not in that JSON, do not use it. "
    "Armavir as departure is always allowed. "
    "If search results are empty, say so; do not invent destinations; set verify to include "
    "'No live web results; places and prices need human research'. "
    "Competitor prices are MARKET REFERENCE only — never confirmed. "
    "Never name Ari Gnank / Արի Գնանք as a competitor; that is this operator. "
    "Name another company only if it appears in SEARCH RESULTS with a URL. "
    "If no competitor offers exist, say that no competitor data was found. "
    "Every uncertain item goes in verify[] (short English strings). Do not silently guess. "
    "Do not write AMD / ֏ / ₽ selling prices, cost breakdowns, or profit in customer copy. "
    "Leave breakdown numbers at 0 and do not write 'Python will fill' or 'source of truth' anywhere. "
    f"GROUP_SIZE is {GROUP_SIZE} (not 18). Guide fee is {GUIDE_FEE_GROUP_AMD} AMD for the whole group. "
    "Python computes one-way route_km × AMD/km and cost/person = (transport_group + guide) / group_size. "
    f"Minimum price is cost per person × {MIN_MARGIN_PCT}%. "
    "Itinerary: at least four timed stops (Armavir start, two or more sourced places, Armavir return). "
    "Each stop needs a short reason and a source_url copied from SEARCH RESULTS. "
    "No vague 'adventure activities'. Never claim previous participants, reviews, awards, or Quality n/10 in customer text. "
    "quality_score is an internal field only. "
    "State: Meals and entrance fees are not included. "
    "Travel times must be realistic (Armavir to Lori at least 2.5–3 hours). "
    "In this generation step write English and Russian copy; Armenian fields may be brief HY placeholders. "
    "Each idea must have a distinct concept. Return JSON only when asked for JSON."
)


def _llm(temperature: float = 0.45) -> ChatOpenAI:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is missing.")
    model = os.getenv("OPENAI_MODEL", "gpt-4o-mini").strip() or "gpt-4o-mini"
    return ChatOpenAI(model=model, temperature=temperature, api_key=api_key, timeout=120)


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


def _invoke_json(prompt: str, temperature: float = 0.45) -> Any:
    response = _llm(temperature).invoke(
        [
            SystemMessage(content=SYSTEM),
            HumanMessage(content=prompt),
        ]
    )
    content = response.content
    if not isinstance(content, str) or not content.strip():
        raise RuntimeError("The language model returned an empty response.")
    return _extract_json(content)


IDEA_JSON_SHAPE = """
{
  "ideas": [
    {
      "id": "kebab-case-id",
      "title_hy": "specific memorable Armenian title, not a formula prefix",
      "title_en": "natural English title",
      "title_ru": "natural Russian title",
      "description_hy": "Հայերեն պարբերություն՝ հայեցակարգ, լսարան, արժեք, տարբերակում, սեզոն, ռիսկեր։ Առանց գների և առանց Python հիշատակման։",
      "description_en": "Fluent English covering concept, audience, value, differentiation, season, risks. No prices, no Python, no quality n/10, no previous participants.",
      "description_ru": "Связный русский текст по тем же разделам. Без цен, без Python, без оценок n/10.",
      "location_hy": "",
      "location_en": "",
      "location_ru": "",
      "price": 0,
      "duration_hours": 10,
      "quality_score": 8,
      "breakdown": {
        "transport_amd": 0,
        "meals_amd": 0,
        "entrance_fees_amd": 0,
        "guide_amd": 15000,
        "other_amd": 0,
        "yerevan_transfer_amd": 0,
        "notes": "Meals and entrance fees are not included. Estimated."
      },
      "budget_fit": "within",
      "profitability": {
        "group_size": 17,
        "revenue_per_person_amd": 0,
        "expense_per_person_amd": 0,
        "profit_per_person_amd": 0,
        "assumptions": "Estimated occupancy and costs. Needs verification.",
        "confidence": "estimated"
      },
      "highlights": [
        "Հայեցակարգ՝ …",
        "Թիրախային լսարան՝ …",
        "Հաճախորդի արժեք՝ …",
        "Մրցակցային տարբերակում՝ …",
        "Սեզոնայնություն՝ …",
        "Արժեքի բաշխում՝ սնունդը և մուտքի տոմսերը ներառված չեն։",
        "Ռիսկեր՝ …"
      ],
      "itinerary": [
        {"time": "07:30", "place_name": "Armavir", "activity": "departure", "title": "Armavir — departure", "title_en": "Armavir — departure", "title_ru": "Армавир — отправление", "description": "Why this stop, sourced from SEARCH RESULTS.", "description_en": "Why this stop.", "description_ru": "Зачем эта остановка.", "source_url": ""},
        {"time": "11:00", "place_name": "Haghpat Monastery", "activity": "visit", "title": "Haghpat Monastery — visit", "title_en": "Haghpat Monastery — visit", "title_ru": "Монастырь Ахпат — посещение", "description": "Sourced stop.", "description_en": "Sourced stop.", "description_ru": "Остановка.", "source_url": ""},
        {"time": "13:00", "place_name": null, "activity": "lunch", "title": "Lunch", "title_en": "Lunch", "title_ru": "Обед", "description": "Meal stop; not a place.", "description_en": "Meal stop; not a place.", "description_ru": "Обед.", "source_url": ""}
      ],
      "budget_score": 0,
      "logistics_score": 0,
      "appeal_score": 0,
      "verify": [],
      "source_urls": [],
      "notes": "Remaining uncertainties. All figures Estimated unless sourced. No quality n/10 in customer copy."
    }
  ]
}
"""


def _discovery_payload(state: State) -> dict[str, Any]:
    try:
        payload = json.loads(state.get("place_discovery") or "{}")
    except json.JSONDecodeError:
        payload = {}
    return payload if isinstance(payload, dict) else {}


def place_discovery_node(state: State) -> dict[str, Any]:
    prefs = str((state.get("inputs") or {}).get("preferences") or "")
    payload = discover_place(prefs)
    return {"place_discovery": json.dumps(payload, ensure_ascii=False)}


def search_node(state: State) -> dict[str, Any]:
    inputs = dict(state["inputs"])
    discovery = _discovery_payload(state)
    place_en = str(discovery.get("place_en") or "").strip()
    region_en = str(discovery.get("region_en") or "").strip()
    if place_en:
        inputs["place_en"] = place_en
    if region_en:
        inputs["region_en"] = region_en
    payload = run_market_search(inputs)
    disc_results = [row for row in (discovery.get("results") or []) if isinstance(row, dict)]
    merged: list[dict[str, Any]] = []
    seen: set[str] = set()
    for row in list(payload.get("results") or []) + disc_results:
        key = str(row.get("url") or row.get("title") or "")
        if not key or key in seen:
            continue
        seen.add(key)
        merged.append(row)
        if len(merged) >= 12:
            break
    payload["results"] = merged
    payload["useful_result_count"] = len(merged)
    payload["live"] = bool(merged)
    if len(merged) >= 2 and payload.get("search_status") in {"too_few_results", "empty"}:
        payload["search_status"] = "ok"
        payload["error"] = ""
    payload["discovery_queries"] = discovery.get("queries") or []
    payload["place_en"] = place_en or None
    payload["region_en"] = region_en or None
    payload["place_candidates"] = [
        item for item in (discovery.get("place_candidates") or []) if isinstance(item, dict)
    ]
    payload["pages_fetched"] = int(discovery.get("pages_fetched") or 0)
    payload["place_data_unavailable"] = bool(discovery.get("place_data_unavailable"))
    payload["place_data_note"] = str(discovery.get("place_data_note") or "")
    payload["onewaytour_unavailable"] = bool(discovery.get("onewaytour_unavailable"))
    payload["onewaytour_tours"] = [item for item in (discovery.get("onewaytour_tours") or []) if isinstance(item, dict)]
    payload["queries"] = list(dict.fromkeys(list(discovery.get("queries") or []) + list(payload.get("queries") or [])))
    owt_offers = [item for item in (discovery.get("onewaytour_offers") or []) if isinstance(item, dict)]
    existing_offers = [item for item in (payload.get("market_offers") or []) if isinstance(item, dict)]
    seen_offer = {str(item.get("url") or item.get("title") or "") for item in existing_offers}
    merged_offers = list(existing_offers)
    for offer in owt_offers:
        key = str(offer.get("url") or offer.get("title") or "")
        if not key or key in seen_offer:
            continue
        seen_offer.add(key)
        merged_offers.append(offer)
    payload["market_offers"] = merged_offers
    if discovery.get("onewaytour_verify"):
        payload["onewaytour_verify"] = discovery.get("onewaytour_verify")
    return {"market_research": json.dumps(payload, ensure_ascii=False)}


def research_node(state: State) -> dict[str, Any]:
    payload = state["inputs"]
    market = state.get("market_research") or "{}"
    prompt = f"""
Synthesize a research briefing for Արի Գնանք one-day tours that start and end in
{payload.get("departure_location") or "Armavir"}, Armenia.

Use this live web-search JSON as market observation only (not confirmed bookings):
{market}

Operator: Արի Գնանք. ALWAYS prioritize Armavir-based departures. Group size is {GROUP_SIZE}.
If a comparable product is sold from Yerevan, note the extra driving km as market context only; Python prices by one-way route km.
Armavir to Lori driving time is at least 2.5–3 hours (07:30 departure → ~10:30 arrival).
List market benchmarks ONLY when the company name and URL appear in the search JSON. Never list Ari Gnank or Արի Գնանք as a competitor. If fewer than 2 useful search hits, say so and do not invent villages, lakes, or companies.

Criteria from the admin form:
- season: {payload.get("season")}
- audience: {payload.get("target_audience")}
- tour type: {payload.get("tour_type")}
- duration_days: {payload.get("duration_days")}
- budget_amd per person (ceiling, includes transport): {payload.get("budget_amd")}
- preferences: {payload.get("preferences") or "none"}

Prefer distinct Armavir-realistic arcs. Reject overnight or Yerevan-nightlife products.

Return JSON:
{{
  "summary": "English briefing. State whether live snippets were available. If search_status is not ok, quote that reason code. Quote observed AMD ranges as Estimated / Needs verification. Transport is one-way km × rate, not a Yerevan add-on.",
  "research_mode": "web_search",
  "market_observations": [{{"company": "", "offer": "", "url": "", "observed_price_amd": 0, "depart_from": "", "notes": "Only fill when the company appears in search results with a URL. Never Ari Gnank."}}],
  "destinations": [{{"name": "", "why": "", "drive_hours_from_armavir": 0, "confidence": "estimated"}}],
  "seasonal_notes": "",
  "logistics": "If Yerevan is a stop, its driving km is already in the one-way route. Needs verification.",
  "cost_assumptions": "{GROUP_SIZE} participants. Guide {GUIDE_FEE_GROUP_AMD} AMD group. Meals and entrance fees are not included. Transport is one-way km × rate (Python). Cost/person = (transport+guide)/{GROUP_SIZE}.",
  "risks": []
}}
"""
    data = _invoke_json(prompt, temperature=0.3)
    if not isinstance(data, dict):
        data = {"summary": str(data), "research_mode": "web_search"}
    data.setdefault("research_mode", "web_search")
    return {"research_data": json.dumps(data, ensure_ascii=False)}


def _candidate_brief(market_json: str) -> str:
    try:
        payload = json.loads(market_json or "{}")
    except json.JSONDecodeError:
        payload = {}
    rows = payload.get("place_candidates") if isinstance(payload, dict) else None
    if not isinstance(rows, list) or not rows:
        return "(none)"
    lines: list[str] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        name = str(row.get("name_en") or "").strip()
        if not name:
            continue
        kind = str(row.get("type") or "sight").strip() or "sight"
        dist = row.get("distance_from_armavir_km")
        extra = f", {dist} km from Armavir" if isinstance(dist, (int, float)) else ""
        lines.append(f"- {name} ({kind}{extra})")
    return "\n".join(lines) or "(none)"


def generation_node(state: State) -> dict[str, Any]:
    payload = state["inputs"]
    count = int(payload.get("count") or 3)
    market = state.get("market_research") or "{}"
    prompt = f"""
SEARCH RESULTS (snippets are market context only):
{market}

PLACE CANDIDATES (the only allowed visitable stop names; choose from this list):
{_candidate_brief(market)}

Research briefing (not live-verified):
{state.get("research_data") or "{}"}

Generate exactly {count} ORIGINAL one-day tour products departing from {payload.get("departure_location") or "Armavir"}.
Season={payload.get("season")}; audience={payload.get("target_audience")};
type={payload.get("tour_type")}; duration_days={payload.get("duration_days")};
budget_amd ceiling per person (includes transport)={payload.get("budget_amd")}; preferences={payload.get("preferences")}.

Budget mix:
- If {count} == 1: keep that idea within budget after transport.
- If {count} >= 2: ALL ideas except one must strictly fit the budget after transport; include EXACTLY ONE premium idea whose final price is slightly over budget (about 5–15%).
- Set budget_fit to "within" or "over" accordingly.

Rules:
- ALWAYS depart from Armavir and return to Armavir.
- Each itinerary stop MUST have place_name and activity as separate fields. title_en is display only: "{{place_name}} — {{activity}}".
- place_name MUST be copied exactly from PLACE CANDIDATES name_en, or be "Armavir". Do not invent names. Do not pick places that are not on that list.
- Choose 2–3 candidates that are geographically sensible for a one-day round trip from Armavir (total one-way km <= about 220). Prefer clustered sights.
- activity is free text (arrival, lunch, walk, visit, cultural exploration). Never put activity words into place_name.
- Lunch/rest stops: place_name must be null; they are not places and are never geocoded.
- Name at least four timed stops: Armavir departure, two or more CONCRETE places from PLACE CANDIDATES, optional lunch, Armavir return. Copy source_url from that candidate.
- Do not use generic place_name values such as Lori, Cultural Sites, attractions, sightseeing, or tour.
- If PLACE CANDIDATES is empty or has fewer than 2 names, do not invent monasteries or villages; still return Armavir bookends and put remaining uncertainty in verify.
- State explicitly: Meals and entrance fees are not included. Do not mention Python or internal scoring.
- Armavir→Lori legs: at least 2.5–3 hours (07:30 depart → 10:30 arrive).
- Competitive differentiation may name a company ONLY if it is in SEARCH RESULTS with a URL. Never name Ari Gnank as a competitor. If there are no competitor offers, write that no competitor data was found.
- Use market observations from research when discussing the market, still label Estimated / Needs verification.
- Each idea must differ in core concept, target audience slice, and customer experience.
- Do not start every Armenian title with "Արմավիր –".
- Do not invent AMD figures or write 15000 AMD in descriptions. Do not write that Python will fill transport.
- Write full EN and RU; HY may be a short placeholder for a later translation step. Keep itinerary title_en in English.

Return JSON exactly in this shape:
{IDEA_JSON_SHAPE}
"""
    data = _invoke_json(prompt, temperature=0.55)
    ideas = data.get("ideas") if isinstance(data, dict) else data
    if not isinstance(ideas, list):
        raise RuntimeError("Generation node did not return an ideas array.")
    return {"ideas_raw": [item for item in ideas if isinstance(item, dict)], "refine_pass": 0}


def evaluation_node(state: State) -> dict[str, Any]:
    payload = state["inputs"]
    source = state.get("evaluated_ideas") or state.get("ideas_raw") or []
    prompt = f"""
Quality-control these tour ideas for Արի Գնանք.

Admin constraints: budget ceiling {payload.get("budget_amd")} AMD/person including transport; audience {payload.get("target_audience")}; season {payload.get("season")}.

Check each idea for:
1) originality and specificity
2) practical Armavir same-day itinerary
3) completeness of concept, audience, value, differentiation, seasonality, cost breakdown, price, profitability, risks, quality score
4) language purity and fluent HY/EN/RU
5) financial arithmetic is computed later in Python; flag invented AMD numbers
5b) 3–4 named stops from SEARCH RESULTS only; Armavir start; Lori drives 2.5–3 hours if Lori is in the results
6) budget mix: all but exactly one idea within budget; exactly one slightly over if count>=2
7) verified vs assumption labels
8) actionable remaining uncertainties

Ideas JSON:
{json.dumps(source, ensure_ascii=False)}

Return JSON:
{{
  "issues": ["short actionable feedback, empty if all pass"],
  "ideas": [
    {{
      "...keep and improve all original fields...",
      "budget_score": 0,
      "logistics_score": 0,
      "appeal_score": 0,
      "quality_score": 0,
      "price": 0,
      "notes": "Rationale for quality_score, list Estimated vs Needs verification items."
    }}
  ]
}}
Do not lower a realistic Estimated price just to fit the budget; instead score budget lower and explain.
"""
    data = _invoke_json(prompt, temperature=0.2)
    ideas = data.get("ideas") if isinstance(data, dict) else source
    if not isinstance(ideas, list):
        raise RuntimeError("Evaluation node did not return an ideas array.")
    cleaned = [item for item in ideas if isinstance(item, dict)]
    model_issues = data.get("issues") if isinstance(data, dict) else []
    issues = [str(item) for item in model_issues if str(item).strip()] if isinstance(model_issues, list) else []
    issues.extend(collect_quality_issues(cleaned))
    unique_issues = list(dict.fromkeys(issues))
    return {"evaluated_ideas": cleaned, "quality_issues": unique_issues}


def refine_llm_node(state: State) -> dict[str, Any]:
    payload = state["inputs"]
    issues = state.get("quality_issues") or []
    prompt = f"""
Refine these tour ideas ONCE. Fix the listed issues. Do not spawn extra ideas.
Keep language-pure HY / EN / RU. Keep Armavir start/end. Keep figures Estimated.

Issues to fix:
{json.dumps(issues, ensure_ascii=False)}

Admin brief: season={payload.get("season")}; audience={payload.get("target_audience")};
type={payload.get("tour_type")}; budget_amd={payload.get("budget_amd")};
preferences={payload.get("preferences")}.

Current ideas:
{json.dumps(state.get("evaluated_ideas") or state.get("ideas_raw") or [], ensure_ascii=False)}

Return JSON in this shape:
{IDEA_JSON_SHAPE}
"""
    data = _invoke_json(prompt, temperature=0.35)
    ideas = data.get("ideas") if isinstance(data, dict) else data
    if not isinstance(ideas, list):
        return {"refine_pass": 1}
    return {
        "evaluated_ideas": [item for item in ideas if isinstance(item, dict)],
        "refine_pass": 1,
        "quality_issues": [],
    }


def route_after_evaluation(state: State) -> Literal["refine", "hy_adapt"]:
    if (state.get("quality_issues") or []) and int(state.get("refine_pass") or 0) == 0:
        return "refine"
    return "hy_adapt"


_HY_RE = re.compile(r"[\u0531-\u0587]")
_STRUCTURED_STOP_KEYS = ("time", "place_name", "activity", "title_en", "source_url", "lat", "lon")


def _preserve_stop_english(original: list[dict[str, Any]], adapted: list[dict[str, Any]]) -> list[dict[str, Any]]:
    adapted_by_time = {
        str(stop.get("time") or ""): stop
        for stop in adapted
        if isinstance(stop, dict) and str(stop.get("time") or "")
    }
    merged: list[dict[str, Any]] = []
    for index, orig in enumerate(original):
        if not isinstance(orig, dict):
            continue
        row = dict(orig)
        matched: dict[str, Any] | None = None
        if index < len(adapted) and isinstance(adapted[index], dict):
            matched = adapted[index]
        orig_time = str(orig.get("time") or "")
        if orig_time and (matched is None or str(matched.get("time") or "") not in {"", orig_time}):
            matched = adapted_by_time.get(orig_time, matched)
        if not isinstance(matched, dict):
            matched = {}
        for key in _STRUCTURED_STOP_KEYS:
            if key in orig:
                row[key] = orig.get(key)
        title_hy = str(matched.get("title_hy") or "").strip()
        adapted_title = str(matched.get("title") or "").strip()
        if not title_hy and _HY_RE.search(adapted_title):
            title_hy = adapted_title
        activity_hy = str(matched.get("activity_hy") or "").strip()
        adapted_activity = str(matched.get("activity") or "").strip()
        if not activity_hy and _HY_RE.search(adapted_activity):
            activity_hy = adapted_activity
        reason_hy = str(matched.get("reason_hy") or "").strip()
        adapted_desc = str(matched.get("description") or "").strip()
        if not reason_hy and _HY_RE.search(adapted_desc):
            reason_hy = adapted_desc
        if title_hy:
            row["title_hy"] = title_hy
        if activity_hy:
            row["activity_hy"] = activity_hy
        if reason_hy:
            row["reason_hy"] = reason_hy
        place = str(row.get("place_name") or "").strip()
        activity = str(row.get("activity") or "").strip()
        if place:
            display = f"{place} — {activity}" if activity else place
            row["title"] = display
            if not str(row.get("title_en") or "").strip():
                row["title_en"] = display
        elif orig.get("title"):
            row["title"] = orig.get("title")
        merged.append(row)
    return merged


def _hy_adapt_prompt(ideas: list[dict[str, Any]], market: str, retry: bool) -> str:
    extra = (
        "RETRY: previous HY fields still contained English sentences or Latin place names in parentheses. "
        if retry
        else ""
    )
    return f"""
{extra}
Translate customer copy into natural Armenian.
Fill idea-level title_hy, description_hy, location_hy.
For each itinerary stop fill ONLY title_hy, activity_hy, and reason_hy.
Do not change place names, stop order, or times.
Do not change place_name, activity, title_en, source_url, lat, or lon.
Put the Armenian place name only inside title_hy. Do not put Latin names in parentheses.
Lunch / meal stops must use title_hy «Ճաշի ընդմիջում».
Keep itinerary title, title_en, description_en in English. Fill title_ru and description_ru in Russian.
Do not add places, prices, Python notes, quality scores, or new facts.
Do not change numeric values. Do not add or reorder itinerary stops.

SEARCH RESULTS:
{market}

IDEAS JSON:
{json.dumps(ideas, ensure_ascii=False)}

Return JSON: {{ "ideas": [ ... same objects with HY fields filled ] }}
"""


def _merge_hy_ideas(originals: dict[str, dict[str, Any]], adapted: list[Any]) -> list[dict[str, Any]]:
    merged_ideas: list[dict[str, Any]] = []
    for item in adapted:
        if not isinstance(item, dict):
            continue
        original = originals.get(str(item.get("id") or "")) or {}
        structured = [row for row in (original.get("itinerary") or []) if isinstance(row, dict)]
        item["itinerary"] = _preserve_stop_english(
            structured,
            [row for row in (item.get("itinerary") or []) if isinstance(row, dict)],
        )
        item["_structured_stops"] = structured
        merged_ideas.append(item)
    return merged_ideas


def _debug_idea_line(
    idea: dict[str, Any],
    accepted: list[dict[str, Any]],
    dropped: list[str],
) -> None:
    if os.getenv("DEBUG_IDEAS", "").strip() != "1":
        return
    stops = []
    for stop in idea.get("itinerary") or []:
        if not isinstance(stop, dict):
            continue
        stops.append((stop.get("place_name"), stop.get("activity"), stop.get("title_en")))
    verify = [str(item)[:80] for item in (idea.get("verify") or [])[:8]]
    line = (
        f"idea_debug {idea.get('id')} stops={stops} "
        f"accepted={[item.get('place_name') or item.get('title_en') for item in accepted]} "
        f"dropped={dropped} route_km={idea.get('route_km')} km_source={idea.get('km_source')} "
        f"price={idea.get('price')} verify={verify}"
    )
    print(line, flush=True)


def hy_adapt_node(state: State) -> dict[str, Any]:
    ideas = [item for item in (state.get("evaluated_ideas") or state.get("ideas_raw") or []) if isinstance(item, dict)]
    for item in ideas:
        item["_structured_stops"] = [row for row in (item.get("itinerary") or []) if isinstance(row, dict)]
    originals = {str(item.get("id") or index): item for index, item in enumerate(ideas)}
    market = state.get("market_research") or "{}"
    merged = ideas
    try:
        data = _invoke_json(_hy_adapt_prompt(ideas, market, False), temperature=0.2)
        adapted = data.get("ideas") if isinstance(data, dict) else data
        if isinstance(adapted, list) and adapted:
            merged = _merge_hy_ideas(originals, adapted)
    except Exception:  # noqa: BLE001
        merged = ideas
    if merged and not all(hy_copy_ok(item) for item in merged):
        try:
            data = _invoke_json(_hy_adapt_prompt(merged, market, True), temperature=0.15)
            adapted = data.get("ideas") if isinstance(data, dict) else data
            if isinstance(adapted, list) and adapted:
                merged = _merge_hy_ideas(originals, adapted)
        except Exception:  # noqa: BLE001
            pass
    flagged: list[dict[str, Any]] = []
    for item in merged:
        if not hy_copy_ok(item):
            flagged.append(mark_hy_review(item))
        else:
            flagged.append(item)
    return {"evaluated_ideas": flagged}


def _research_payload(state: State) -> dict[str, Any]:
    try:
        payload = json.loads(state.get("market_research") or "{}")
    except json.JSONDecodeError:
        payload = {}
    return payload if isinstance(payload, dict) else {}


def refinement_node(state: State) -> dict[str, Any]:
    payload = state["inputs"]
    wanted = int(payload.get("count") or 3)
    departure = str(payload.get("departure_location") or "Արմավիր")
    budget = int(payload.get("budget_amd") or 0)
    research = _research_payload(state)
    offers = [item for item in (research.get("market_offers") or []) if isinstance(item, dict)]
    priced: list[dict[str, Any]] = []
    leftover_source = [item for item in (state.get("evaluated_ideas") or state.get("ideas_raw") or []) if isinstance(item, dict)]
    band_offers = []
    for offer in offers:
        if offer.get("company") == "OneWayTour" and offer.get("duration_days") not in (None, 1, 1.0):
            continue
        band_offers.append(offer)
    for raw in leftover_source:
        candidate = ensure_armavir_bookends(dict(raw), departure)
        structured = [row for row in (candidate.pop("_structured_stops", None) or candidate.get("itinerary") or []) if isinstance(row, dict)]
        geo_idea = dict(candidate)
        geo_idea["itinerary"] = structured
        classified = classify_itinerary_stops(geo_idea, research)
        candidate["verify"] = list(geo_idea.get("verify") or [])
        candidate = ground_idea(candidate, research)
        if research.get("onewaytour_unavailable") or research.get("onewaytour_verify"):
            if ONEWAYTOUR_UNAVAILABLE not in candidate["verify"]:
                candidate["verify"].append(ONEWAYTOUR_UNAVAILABLE)
        region = str(research.get("region_en") or research.get("place_en") or "")
        geo_stops = classified["accepted"]
        coords_by_name: dict[str, tuple[float, float]] = {}
        candidates_rows = [row for row in (research.get("place_candidates") or []) if isinstance(row, dict)]
        for row in candidates_rows:
            name = str(row.get("name_en") or "").strip()
            try:
                lat = float(row.get("lat"))
                lon = float(row.get("lon"))
            except (TypeError, ValueError):
                continue
            if name and (lat != 0.0 or lon != 0.0):
                coords_by_name[name] = (lat, lon)
        route = one_way_route_km(
            geo_stops,
            extra_names=[],
            region=region,
            coords_by_name=coords_by_name,
            place_candidates=candidates_rows,
        )
        km_notes = list(route.notes)
        place_en = str(research.get("place_en") or candidate.get("location_en") or "").strip()
        if place_en:
            cross = distance_cross_check_snippet(place_en)
            if cross and cross not in km_notes:
                km_notes.append(cross)
        away = bool(classified["accepted"] or classified["dropped"]) or has_stop_outside_armavir(
            structured
        )
        candidate = apply_yerevan_transfer(candidate)
        candidate = apply_unit_economics(
            candidate,
            route_km=route.km,
            km_sourced=route.sourced,
            km_notes=km_notes,
            offers=band_offers,
            has_away_stop=away,
            km_source=route.km_source,
            geocoded_stops=route.geocoded_stops,
        )
        candidate = rewrite_copy_from_numbers(candidate, research)
        _debug_idea_line(candidate, classified["accepted"], classified["dropped"])
        priced.append(candidate)
    priced = tag_budget_fit(priced, budget)
    leftover_issues = collect_quality_issues(priced)
    cleaned: list[dict[str, Any]] = []
    for index, raw in enumerate(priced):
        candidate = dict(raw)
        candidate.setdefault("id", f"idea-{index + 1}")
        candidate["id"] = re.sub(r"[^a-z0-9-]+", "-", str(candidate["id"]).lower()).strip("-") or f"idea-{index + 1}"
        for score_key in ("budget_score", "logistics_score", "appeal_score", "quality_score"):
            raw_score = candidate.get(score_key)
            if isinstance(raw_score, str):
                match = re.search(r"(\d+(?:\.\d+)?)", raw_score)
                candidate[score_key] = float(match.group(1)) if match else 0
        if leftover_issues:
            candidate = attach_review_flag(
                candidate,
                "Needs verification. Remaining QC notes: " + "; ".join(leftover_issues[:6]),
            )
        candidate.setdefault("quality_score", candidate.get("appeal_score") or 0)
        if not str(candidate.get("title_hy") or "").strip():
            candidate["title_hy"] = str(candidate.get("title_en") or candidate["id"])
            candidate = mark_hy_review(candidate)
        if not str(candidate.get("description_hy") or "").strip():
            candidate["description_hy"] = str(candidate.get("description_en") or "")
            candidate = mark_hy_review(candidate)
        if not str(candidate.get("location_hy") or "").strip():
            candidate["location_hy"] = str(candidate.get("location_en") or "Armavir")
        try:
            idea = TourIdea.model_validate(candidate)
        except ValidationError:
            continue
        cleaned.append(idea.model_dump())
        if len(cleaned) >= wanted:
            break
    if not cleaned:
        raise RuntimeError("Refinement produced no valid tour ideas.")
    return {"final_report": cleaned}


def build_graph():
    graph = StateGraph(State)
    graph.add_node("place_discovery_node", place_discovery_node)
    graph.add_node("search_node", search_node)
    graph.add_node("research_node", research_node)
    graph.add_node("generation_node", generation_node)
    graph.add_node("evaluation_node", evaluation_node)
    graph.add_node("refine_llm_node", refine_llm_node)
    graph.add_node("hy_adapt_node", hy_adapt_node)
    graph.add_node("refinement_node", refinement_node)
    graph.add_edge(START, "place_discovery_node")
    graph.add_edge("place_discovery_node", "search_node")
    graph.add_edge("search_node", "research_node")
    graph.add_edge("research_node", "generation_node")
    graph.add_edge("generation_node", "evaluation_node")
    graph.add_conditional_edges(
        "evaluation_node",
        route_after_evaluation,
        {"refine": "refine_llm_node", "hy_adapt": "hy_adapt_node"},
    )
    graph.add_edge("refine_llm_node", "hy_adapt_node")
    graph.add_edge("hy_adapt_node", "refinement_node")
    graph.add_edge("refinement_node", END)
    return graph.compile()


_GRAPH = None


def get_graph():
    global _GRAPH
    if _GRAPH is None:
        _GRAPH = build_graph()
    return _GRAPH


def run_idea_workflow(request: GenerateIdeasRequest) -> tuple[list[dict[str, Any]], str, dict[str, Any]]:
    initial: State = {
        "inputs": request.model_dump(),
        "place_discovery": "",
        "market_research": "",
        "research_data": "",
        "ideas_raw": [],
        "evaluated_ideas": [],
        "quality_issues": [],
        "refine_pass": 0,
        "final_report": [],
    }
    result = get_graph().invoke(initial)
    ideas = result.get("final_report") or []
    if not ideas:
        raise RuntimeError("The agent finished without a final report.")
    research = _research_payload(result)
    research_summary = ""
    try:
        briefing = json.loads(result.get("research_data") or "{}")
        if isinstance(briefing, dict):
            research_summary = str(briefing.get("summary") or "")
    except json.JSONDecodeError:
        research_summary = ""
    status = str(research.get("search_status") or research.get("error") or "").strip()
    providers = research.get("provider_status") if isinstance(research.get("provider_status"), dict) else {}
    tavily_flag = str(providers.get("tavily") or "")
    ddg_flag = str(providers.get("ddg") or "")
    key_flag = "yes" if research.get("tavily_key_present") or providers.get("tavily_key_present") else "no"
    provider_line = f"providers tavily={tavily_flag or 'n/a'} (key={key_flag}) ddg={ddg_flag or 'n/a'}"
    if provider_line not in research_summary:
        research_summary = f"{provider_line}. {research_summary}".strip()
    useful = int(research.get("useful_result_count") or len(research.get("results") or []))
    status_note = search_status_note(status, useful)
    if status_note and status_note not in research_summary:
        research_summary = f"{status_note}. {research_summary}".strip()
    if useful < 2:
        few = "Fewer than 2 useful search results after filtering; do not treat snippets as market proof."
        if few not in research_summary:
            research_summary = f"{few} {research_summary}".strip()
    if not research.get("live"):
        empty = "No live web results; places and prices need human research."
        if empty not in research_summary:
            research_summary = f"{empty} {research_summary}".strip()
    return ideas, research_summary, research
