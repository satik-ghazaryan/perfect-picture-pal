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

from agent.pricing import ARMAVIR_YEREVAN_TRANSFER_AMD, apply_yerevan_transfer, tag_budget_fit
from agent.quality import attach_review_flag, collect_quality_issues, ensure_armavir_bookends
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
    "You design original one-day group tours that always start and end in Armavir, Armenia. "
    "Armenian is the primary language of the business. "
    "Web snippets are market observations only: never treat listed AMD figures as confirmed "
    "tariffs, opening hours, or booking conditions. Label money as Estimated or Needs verification. "
    "Armavir–Yerevan rule: if the product uses Yerevan as a hub, meeting point, or destination "
    f"cluster, add exactly +{ARMAVIR_YEREVAN_TRANSFER_AMD} AMD per person for the ~45 km "
    "Armavir→Yerevan shuttle and show it as base transport + 1,000 AMD transfer. "
    "Keep HY, EN, and RU fields language-pure. Each idea must have a distinct concept. "
    "Return JSON only when asked for JSON."
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
        "guide_amd": 0,
        "other_amd": 0,
        "yerevan_transfer_amd": 0,
        "notes": "Estimated. Needs verification. If Yerevan is used, include +1000 AMD Armavir transfer in transport_amd and yerevan_transfer_amd=1000."
      },
      "budget_fit": "within",
      "profitability": {
        "group_size": 12,
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
        "Արժեքի բաշխում (գնահատված)՝ տրանսպորտ, սնունդ, մուտքեր, զբոսավար, այլ",
        "Առաջարկվող գին (գնահատված)՝ … ֏ / անձ",
        "Շահութաբերություն (գնահատված)՝ եկամուտ, ծախս, շահույթ մեկ անձի կամ խմբի համար, ենթադրությունները նշված",
        "Ռիսկեր՝ …",
        "Որակ՝ n/10 — …"
      ],
      "itinerary": [
        {"time": "08:00", "title": "Արմավիր — մեկնում", "description": "Purpose of this stop and estimated drive time. Needs verification."}
      ],
      "budget_score": 0,
      "logistics_score": 0,
      "appeal_score": 0,
      "notes": "Quality-score rationale, remaining uncertainties, and translation-review flags. All figures Estimated unless verified."
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

Operator: Արի Գնանք. Typical group assumption: 10–16 guests in a minibus unless noted as Estimated.
If a comparable product is sold from Yerevan, include Armavir→Yerevan ~45 km and +{ARMAVIR_YEREVAN_TRANSFER_AMD} AMD/person.

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
  "market_observations": [{{"name": "", "observed_price_amd": 0, "depart_from": "Yerevan or Armavir", "notes": "Needs verification"}}],
  "destinations": [{{"name": "", "why": "", "drive_hours_from_armavir": 0, "confidence": "estimated"}}],
  "seasonal_notes": "",
  "logistics": "Include Armavir–Yerevan shuttle when Yerevan is the hub. Needs verification.",
  "cost_assumptions": "List assumptions. Always add +1000 AMD/person when Yerevan transfer is required.",
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
Using this research JSON (not live-verified):
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
- Use market observations from research when pricing, still label Estimated / Needs verification.
- Each idea must differ in core concept, target audience slice, and customer experience.
- Do not start every Armenian title with "Արմավիր –".
- Itinerary must be clock-time realistic and return to Armavir the same day.
- If the day uses Yerevan as hub or destination, price MUST be base + {ARMAVIR_YEREVAN_TRANSFER_AMD} AMD transfer. Set yerevan_transfer_amd={ARMAVIR_YEREVAN_TRANSFER_AMD} and mention "base transport + 1,000 AMD transfer" in highlights and breakdown.notes.
- price = suggested selling price per participant in AMD including that transfer.
- HY / EN / RU must stay consistent.

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
5) financial arithmetic: Yerevan products include +{ARMAVIR_YEREVAN_TRANSFER_AMD} AMD transfer
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


def route_after_evaluation(state: State) -> Literal["refine", "finalize"]:
    if (state.get("quality_issues") or []) and int(state.get("refine_pass") or 0) == 0:
        return "refine"
    return "finalize"


def refinement_node(state: State) -> dict[str, Any]:
    payload = state["inputs"]
    wanted = int(payload.get("count") or 3)
    departure = str(payload.get("departure_location") or "Արմավիր")
    budget = int(payload.get("budget_amd") or 0)
    priced = [
        apply_yerevan_transfer(dict(raw))
        for raw in (state.get("evaluated_ideas") or state.get("ideas_raw") or [])
        if isinstance(raw, dict)
    ]
    priced = tag_budget_fit(priced, budget)
    leftover_issues = collect_quality_issues(priced)
    cleaned: list[dict[str, Any]] = []
    for index, raw in enumerate(priced):
        candidate = ensure_armavir_bookends(dict(raw), departure)
        candidate.setdefault("id", f"idea-{index + 1}")
        candidate["id"] = re.sub(r"[^a-z0-9-]+", "-", str(candidate["id"]).lower()).strip("-") or f"idea-{index + 1}"
        for score_key in ("budget_score", "logistics_score", "appeal_score", "quality_score"):
            raw_score = candidate.get(score_key)
            if isinstance(raw_score, str):
                match = re.search(r"(\d+(?:\.\d+)?)", raw_score)
                candidate[score_key] = float(match.group(1)) if match else 0
        if isinstance(candidate.get("price"), str):
            digits = re.sub(r"[^\d]", "", str(candidate["price"]))
            candidate["price"] = int(digits) if digits else 0
        if leftover_issues:
            candidate = attach_review_flag(
                candidate,
                "Needs verification. Remaining QC notes: " + "; ".join(leftover_issues[:6]),
            )
        candidate.setdefault("quality_score", candidate.get("appeal_score") or 0)
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
    graph.add_node("refinement_node", refinement_node)
    graph.add_edge(START, "search_node")
    graph.add_edge("search_node", "research_node")
    graph.add_edge("research_node", "generation_node")
    graph.add_edge("generation_node", "evaluation_node")
    graph.add_conditional_edges(
        "evaluation_node",
        route_after_evaluation,
        {"refine": "refine_llm_node", "finalize": "refinement_node"},
    )
    graph.add_edge("refine_llm_node", "refinement_node")
    graph.add_edge("refinement_node", END)
    return graph.compile()


_GRAPH = None


def get_graph():
    global _GRAPH
    if _GRAPH is None:
        _GRAPH = build_graph()
    return _GRAPH


def run_idea_workflow(request: GenerateIdeasRequest) -> tuple[list[dict[str, Any]], str]:
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
    research_summary = ""
    try:
        briefing = json.loads(result.get("research_data") or "{}")
        if isinstance(briefing, dict):
            research_summary = str(briefing.get("summary") or "")
    except json.JSONDecodeError:
        research_summary = ""
    return ideas, research_summary
