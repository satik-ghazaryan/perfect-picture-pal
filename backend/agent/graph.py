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

from agent.distance import one_way_route_km
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
    collect_quality_issues,
    ensure_armavir_bookends,
    ground_idea,
    rewrite_copy_from_numbers,
)
from agent.search import run_market_search
from schemas import GenerateIdeasRequest, TourIdea

load_dotenv(Path(__file__).resolve().parent.parent / ".env")
load_dotenv()


class State(TypedDict):
    inputs: dict[str, Any]
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
    "SEARCH RESULTS JSON (title, snippet, or URL). If a name is not in that JSON, do not use it. "
    "Armavir as departure is always allowed. "
    "If search results are empty, say so; do not invent destinations; set verify to include "
    "'No live web results; places and prices need human research'. "
    "Competitor prices are MARKET REFERENCE only — never confirmed. "
    "Every uncertain item goes in verify[] (short English strings). Do not silently guess. "
    f"GROUP_SIZE is {GROUP_SIZE} (not 18). Guide fee is {GUIDE_FEE_GROUP_AMD} AMD for the whole group. "
    "Do not invent transport AMD or profit. Leave breakdown numbers at 0; Python computes "
    "one-way route_km × AMD/km and cost/person = (transport_group + guide) / group_size. "
    f"Minimum price is cost per person × {MIN_MARGIN_PCT}%. "
    "Itinerary: 3–4 timed stops including Armavir departure. No vague 'adventure activities'. "
    "State: Meals and entrance fees are not included. "
    "Travel times must be realistic (Armavir to Lori at least 2.5–3 hours). "
    "In this generation step write English and Russian copy; Armenian fields may be brief placeholders. "
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
      "description_hy": "One flowing Armenian paragraph covering: Հայեցակարգ. … Թիրախային լսարան. … Հաճախորդի արժեք. … Մրցակցային տարբերակում. … Սեզոնայնություն. … Արժեքի բաշխում (գնահատված). … Առաջարկվող գին (գնահատված). … Շահութաբերություն (գնահատված, ենթադրություններով). … Ռիսկեր և սահմանափակումներ. … Որակի գնահատական n/10 — … Ստուգման դրոշներ. …",
      "description_en": "Fluent English covering the same sections with Estimated / Needs verification labels. No Armenian script.",
      "description_ru": "Fluent Russian covering the same sections. No Armenian script.",
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
        "notes": "Meals and entrance fees are not included. Python fills transport from one-way km × rate. Estimated."
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
        "Արժեքի բաշխում (գնահատված)՝ Python-ը կլրացնի տրանսպորտը ըստ կմ։ Meals and entrance fees are not included.",
        "Առաջարկվող գին (գնահատված)՝ … ֏ / անձ",
        "Շահութաբերություն (գնահատված)՝ եկամուտ, ծախս, շահույթ մեկ անձի կամ խմբի համար, ենթադրությունները նշված",
        "Ռիսկեր՝ …",
        "Որակ՝ n/10 — …"
      ],
      "itinerary": [
        {"time": "07:30", "title": "Արմավիր — մեկնում", "description": "Armavir departure. Lori-bound legs need 2.5–3 hours (arrive ~10:30). Needs verification."}
      ],
      "budget_score": 0,
      "logistics_score": 0,
      "appeal_score": 0,
      "verify": [],
      "source_urls": [],
      "notes": "Quality-score rationale and remaining uncertainties. All figures Estimated unless sourced."
    }
  ]
}
"""


def search_node(state: State) -> dict[str, Any]:
    payload = run_market_search(state["inputs"])
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
MANDATORY: list at least 5 seasonal market benchmarks with company name and price (prefer Armavir departures: Ari Gnank, ArmGeo, One Way Tour, and similar). Observed AMD only.

Criteria from the admin form:
- season: {payload.get("season")}
- audience: {payload.get("target_audience")}
- tour type: {payload.get("tour_type")}
- duration_days: {payload.get("duration_days")}
- budget_amd per person (ceiling, includes transfer): {payload.get("budget_amd")}
- preferences: {payload.get("preferences") or "none"}

Prefer distinct Armavir-realistic arcs. Reject overnight or Yerevan-nightlife products.

Return JSON:
{{
  "summary": "English briefing. State whether live snippets were available. Quote observed AMD ranges as Estimated / Needs verification. Mention the +1000 AMD Yerevan transfer rule.",
  "research_mode": "web_search",
  "market_observations": [{{"company": "Ari Gnank", "offer": "", "observed_price_amd": 0, "depart_from": "Armavir preferred", "notes": "Needs verification"}}, {{"company": "ArmGeo", "offer": "", "observed_price_amd": 0, "depart_from": "", "notes": "Needs verification"}}, {{"company": "One Way Tour", "offer": "", "observed_price_amd": 0, "depart_from": "", "notes": "Needs verification"}}, {{"company": "", "offer": "", "observed_price_amd": 0, "depart_from": "", "notes": "Needs verification"}}, {{"company": "", "offer": "", "observed_price_amd": 0, "depart_from": "", "notes": "Needs verification"}}],
  "destinations": [{{"name": "", "why": "", "drive_hours_from_armavir": 0, "confidence": "estimated"}}],
  "seasonal_notes": "",
  "logistics": "Include Armavir–Yerevan shuttle when Yerevan is the hub. Needs verification.",
  "cost_assumptions": "{GROUP_SIZE} participants. Guide {GUIDE_FEE_GROUP_AMD} AMD group. Meals and entrance fees are not included. Transport is one-way km × rate (Python). Cost/person = (transport+guide)/{GROUP_SIZE}.",
  "risks": []
}}
"""
    data = _invoke_json(prompt, temperature=0.3)
    if not isinstance(data, dict):
        data = {"summary": str(data), "research_mode": "web_search"}
    data.setdefault("research_mode", "web_search")
    return {"research_data": json.dumps(data, ensure_ascii=False)}


def generation_node(state: State) -> dict[str, Any]:
    payload = state["inputs"]
    count = int(payload.get("count") or 3)
    prompt = f"""
SEARCH RESULTS (only allowed place names and competitor prices):
{state.get("market_research") or "{}"}

Research briefing (not live-verified):
{state.get("research_data") or "{}"}

Generate exactly {count} ORIGINAL one-day tour products departing from {payload.get("departure_location") or "Armavir"}.
Season={payload.get("season")}; audience={payload.get("target_audience")};
type={payload.get("tour_type")}; duration_days={payload.get("duration_days")};
budget_amd ceiling per person (MUST include transfer)={payload.get("budget_amd")}; preferences={payload.get("preferences")}.

Budget mix:
- If {count} == 1: keep that idea within budget after transfer.
- If {count} >= 2: ALL ideas except one must strictly fit the budget after transport; include EXACTLY ONE premium idea whose final price is slightly over budget (about 5–15%).
- Set budget_fit to "within" or "over" accordingly.

Rules:
- ALWAYS depart from Armavir and return to Armavir.
- Name 3–4 CONCRETE stops (e.g. Dsegh village, Tsover Lake, Bardzrakash St. Grigor Monastery, Debed Canyon). No vague 'adventure activities'.
- State explicitly: Meals and entrance fees are not included.
- Armavir→Lori legs: at least 2.5–3 hours (07:30 depart → 10:30 arrive).
- Include at least 5 seasonal market benchmarks (company + price), preferring Armavir departures (Ari Gnank, ArmGeo, One Way Tour).
- Use market observations from research when pricing, still label Estimated / Needs verification.
- Each idea must differ in core concept, target audience slice, and customer experience.
- Do not start every Armenian title with "Արմավիր –".
- Do not invent AMD figures. Python sets transport from one-way driving km and GROUP_SIZE={GROUP_SIZE}.
- Place names only from SEARCH RESULTS. If none, do not invent monasteries or villages.
- Write full EN and RU; HY may be a short placeholder for a later translation step.

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

Admin constraints: budget ceiling {payload.get("budget_amd")} AMD/person including Armavir–Yerevan transfer; audience {payload.get("target_audience")}; season {payload.get("season")}.

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


def hy_adapt_node(state: State) -> dict[str, Any]:
    ideas = [item for item in (state.get("evaluated_ideas") or state.get("ideas_raw") or []) if isinstance(item, dict)]
    market = state.get("market_research") or "{}"
    prompt = f"""
Translate/adapt ONLY title_hy, description_hy, location_hy, and itinerary stop title/description
into natural Armenian. Do not add places, prices, or facts.
Keep every place name exactly as in the SEARCH RESULTS; if the Armenian spelling is uncertain,
write the Armenian attempt and the original English spelling in parentheses, e.g. Ախթալա (Akhtala).
Do not change EN/RU fields or numeric values. Do not add itinerary stops.

SEARCH RESULTS:
{market}

IDEAS JSON:
{json.dumps(ideas, ensure_ascii=False)}

Return JSON: {{ "ideas": [ ... same objects with HY fields filled ] }}
"""
    try:
        data = _invoke_json(prompt, temperature=0.2)
        adapted = data.get("ideas") if isinstance(data, dict) else data
        if isinstance(adapted, list) and adapted:
            return {"evaluated_ideas": [item for item in adapted if isinstance(item, dict)]}
    except Exception:  # noqa: BLE001
        pass
    return {"evaluated_ideas": ideas}


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
    for raw in leftover_source:
        candidate = ensure_armavir_bookends(dict(raw), departure)
        candidate = ground_idea(candidate, research)
        route_km, sourced, km_notes = one_way_route_km(candidate.get("itinerary") or [])
        candidate = apply_yerevan_transfer(candidate)
        candidate = apply_unit_economics(
            candidate,
            route_km=route_km,
            km_sourced=sourced,
            km_notes=km_notes,
            offers=offers,
        )
        candidate = rewrite_copy_from_numbers(candidate)
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
        if not str(candidate.get("description_hy") or "").strip():
            candidate["description_hy"] = str(candidate.get("description_en") or "")
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
    graph.add_node("search_node", search_node)
    graph.add_node("research_node", research_node)
    graph.add_node("generation_node", generation_node)
    graph.add_node("evaluation_node", evaluation_node)
    graph.add_node("refine_llm_node", refine_llm_node)
    graph.add_node("hy_adapt_node", hy_adapt_node)
    graph.add_node("refinement_node", refinement_node)
    graph.add_edge(START, "search_node")
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
    if not research.get("live"):
        empty = "No live web results; places and prices need human research."
        if empty not in research_summary:
            research_summary = f"{empty} {research_summary}".strip()
    return ideas, research_summary, research
