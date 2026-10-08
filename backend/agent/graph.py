from __future__ import annotations

import json
import os
import re
from typing import Any, TypedDict

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from langgraph.graph import END, START, StateGraph
from pydantic import ValidationError

from schemas import GenerateIdeasRequest, TourIdea


class State(TypedDict):
    inputs: dict[str, Any]
    research_data: str
    ideas_raw: list[dict[str, Any]]
    evaluated_ideas: list[dict[str, Any]]
    final_report: list[dict[str, Any]]


SYSTEM = (
    "You are the tour-planning desk for «Արի Գնանք» (Ari Gnank): one-day group tours "
    "that always depart from Armavir, Armenia. Prefer realistic road times, family-safe "
    "stops, and HY/EN/RU copy. Armenian is the primary language. Never invent roads that "
    "cannot be driven in a day from Armavir. Return JSON only when asked for JSON."
)


def _llm() -> ChatOpenAI:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is missing.")
    model = os.getenv("OPENAI_MODEL", "gpt-4o-mini").strip() or "gpt-4o-mini"
    return ChatOpenAI(model=model, temperature=0.4, api_key=api_key, timeout=60)


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


def _invoke_json(prompt: str) -> Any:
    response = _llm().invoke(
        [
            SystemMessage(content=SYSTEM),
            HumanMessage(content=prompt),
        ]
    )
    content = response.content
    if not isinstance(content, str) or not content.strip():
        raise RuntimeError("The language model returned an empty response.")
    return _extract_json(content)


def research_node(state: State) -> dict[str, Any]:
    payload = state["inputs"]
    prompt = f"""
Research one-day tourism options that can realistically start and end in {payload.get("departure_location") or "Armavir"}, Armenia.

Criteria:
- season: {payload.get("season")}
- audience: {payload.get("target_audience")}
- tour type: {payload.get("tour_type")}
- duration_days: {payload.get("duration_days")}
- budget_amd per person: {payload.get("budget_amd")}
- preferences: {payload.get("preferences") or "none"}

Return JSON object:
{{
  "summary": "short briefing in English",
  "destinations": [{{"name": "", "why": "", "drive_hours_from_armavir": 0}}],
  "seasonal_notes": "",
  "logistics": "",
  "risks": []
}}
"""
    data = _invoke_json(prompt)
    if not isinstance(data, dict):
        data = {"summary": str(data)}
    return {"research_data": json.dumps(data, ensure_ascii=False)}


def generation_node(state: State) -> dict[str, Any]:
    payload = state["inputs"]
    count = int(payload.get("count") or 3)
    prompt = f"""
Using this research JSON:
{state.get("research_data") or "{}"}

Generate exactly {count} one-day tour ideas departing from {payload.get("departure_location") or "Armavir"}.
Season={payload.get("season")}; audience={payload.get("target_audience")};
type={payload.get("tour_type")}; duration_days={payload.get("duration_days")};
budget_amd={payload.get("budget_amd")}; preferences={payload.get("preferences")}.

Each idea MUST include localized copy. Titles should start with "Արմավիր –" in Armenian.

Return JSON:
{{
  "ideas": [
    {{
      "id": "kebab-case-id",
      "title_hy": "",
      "title_en": "",
      "title_ru": "",
      "description_hy": "",
      "description_en": "",
      "description_ru": "",
      "location_hy": "",
      "location_en": "",
      "location_ru": "",
      "price": 0,
      "duration_hours": 10,
      "highlights": ["", ""],
      "itinerary": [
        {{"time": "08:30", "title": "", "description": ""}}
      ]
    }}
  ]
}}
"""
    data = _invoke_json(prompt)
    ideas = data.get("ideas") if isinstance(data, dict) else data
    if not isinstance(ideas, list):
        raise RuntimeError("Generation node did not return an ideas array.")
    return {"ideas_raw": [item for item in ideas if isinstance(item, dict)]}


def evaluation_node(state: State) -> dict[str, Any]:
    payload = state["inputs"]
    prompt = f"""
Evaluate each tour idea for a group leaving Armavir. Scores are 0-10.
Budget ceiling: {payload.get("budget_amd")} AMD per person.
Audience: {payload.get("target_audience")}. Season: {payload.get("season")}.

Ideas JSON:
{json.dumps(state.get("ideas_raw") or [], ensure_ascii=False)}

Return JSON:
{{
  "ideas": [
    {{
      "...keep all original idea fields...",
      "budget_score": 0,
      "logistics_score": 0,
      "appeal_score": 0,
      "notes": "one sentence",
      "price": 0
    }}
  ]
}}
If price exceeds budget, lower price only when still operationally realistic, otherwise keep price and score budget lower.
"""
    data = _invoke_json(prompt)
    ideas = data.get("ideas") if isinstance(data, dict) else data
    if not isinstance(ideas, list):
        raise RuntimeError("Evaluation node did not return an ideas array.")
    return {"evaluated_ideas": [item for item in ideas if isinstance(item, dict)]}


def refinement_node(state: State) -> dict[str, Any]:
    payload = state["inputs"]
    wanted = int(payload.get("count") or 3)
    cleaned: list[dict[str, Any]] = []
    for index, raw in enumerate(state.get("evaluated_ideas") or state.get("ideas_raw") or []):
        if not isinstance(raw, dict):
            continue
        candidate = dict(raw)
        candidate.setdefault("id", f"idea-{index + 1}")
        candidate["id"] = re.sub(r"[^a-z0-9-]+", "-", str(candidate["id"]).lower()).strip("-") or f"idea-{index + 1}"
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
    graph.add_node("research_node", research_node)
    graph.add_node("generation_node", generation_node)
    graph.add_node("evaluation_node", evaluation_node)
    graph.add_node("refinement_node", refinement_node)
    graph.add_edge(START, "research_node")
    graph.add_edge("research_node", "generation_node")
    graph.add_edge("generation_node", "evaluation_node")
    graph.add_edge("evaluation_node", "refinement_node")
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
        "research_data": "",
        "ideas_raw": [],
        "evaluated_ideas": [],
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
