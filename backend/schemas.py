from __future__ import annotations

import re
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

Season = Literal["spring", "summer", "autumn", "winter"]
Audience = Literal["families", "couples", "friends", "seniors", "mixed"]
TourType = Literal["cultural", "hiking", "extreme", "mixed"]


def parse_amd(value: Any) -> int:
    if isinstance(value, bool) or value is None:
        return 0
    if isinstance(value, (int, float)):
        return max(0, int(round(value)))
    if isinstance(value, str):
        digits = re.sub(r"[^\d]", "", value)
        return int(digits) if digits else 0
    if isinstance(value, dict):
        for key in ("amd", "amount", "value", "price", "total"):
            if key in value:
                return parse_amd(value[key])
    return 0


class GenerateIdeasRequest(BaseModel):
    season: str = Field(..., min_length=2, max_length=32)
    target_audience: str = Field(..., min_length=2, max_length=64)
    tour_type: str = Field(..., min_length=2, max_length=64)
    duration_days: int = Field(default=1, ge=1, le=3)
    budget_amd: int = Field(..., ge=0, le=1_000_000)
    departure_location: str = Field(default="Armavir", min_length=2, max_length=80)
    preferences: str = Field(default="", max_length=800)
    count: int = Field(default=3, ge=1, le=8)

    model_config = {"populate_by_name": True}

    @field_validator("season", "target_audience", "tour_type", "departure_location", "preferences")
    @classmethod
    def strip_text(cls, value: str) -> str:
        return value.strip()


class ItineraryStop(BaseModel):
    time: str = Field(..., min_length=1, max_length=16)
    title: str = Field(..., min_length=1, max_length=240)
    description: str = Field(..., min_length=1, max_length=800)


class CostBreakdown(BaseModel):
    transport_amd: int = 0
    meals_amd: int = 0
    entrance_fees_amd: int = 0
    guide_amd: int = 0
    other_amd: int = 0
    notes: str = "Estimated. Needs verification."

    @model_validator(mode="before")
    @classmethod
    def coerce(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            return value
        return {
            "transport_amd": parse_amd(value.get("transport_amd", value.get("transport"))),
            "meals_amd": parse_amd(value.get("meals_amd", value.get("meals"))),
            "entrance_fees_amd": parse_amd(value.get("entrance_fees_amd", value.get("entrance_fees", value.get("tickets")))),
            "guide_amd": parse_amd(value.get("guide_amd", value.get("guide"))),
            "other_amd": parse_amd(value.get("other_amd", value.get("other"))),
            "notes": str(value.get("notes") or "Estimated. Needs verification."),
        }


class Profitability(BaseModel):
    group_size: int = 12
    revenue_per_person_amd: int = 0
    expense_per_person_amd: int = 0
    profit_per_person_amd: int = 0
    revenue_per_group_amd: int = 0
    expense_per_group_amd: int = 0
    profit_per_group_amd: int = 0
    assumptions: str = "Estimated. Needs verification."
    confidence: Literal["estimated", "needs_verification"] = "estimated"

    @model_validator(mode="before")
    @classmethod
    def coerce(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            return value
        group_size = parse_amd(value.get("group_size") or 12) or 12
        revenue_pp = parse_amd(value.get("revenue_per_person_amd", value.get("revenue_per_person")))
        expense_pp = parse_amd(value.get("expense_per_person_amd", value.get("expense_per_person")))
        profit_pp = parse_amd(value.get("profit_per_person_amd", value.get("profit_per_person")))
        if profit_pp == 0 and (revenue_pp or expense_pp):
            profit_pp = max(0, revenue_pp - expense_pp)
        return {
            "group_size": group_size,
            "revenue_per_person_amd": revenue_pp,
            "expense_per_person_amd": expense_pp,
            "profit_per_person_amd": profit_pp,
            "revenue_per_group_amd": parse_amd(value.get("revenue_per_group_amd")) or revenue_pp * group_size,
            "expense_per_group_amd": parse_amd(value.get("expense_per_group_amd")) or expense_pp * group_size,
            "profit_per_group_amd": parse_amd(value.get("profit_per_group_amd")) or profit_pp * group_size,
            "assumptions": str(value.get("assumptions") or "Estimated. Needs verification."),
            "confidence": "needs_verification" if value.get("confidence") == "needs_verification" else "estimated",
        }


class TourIdea(BaseModel):
    id: str = Field(..., min_length=2, max_length=80)
    title_hy: str
    title_en: str
    title_ru: str
    description_hy: str
    description_en: str
    description_ru: str
    location_hy: str
    location_en: str
    location_ru: str
    price: int = Field(..., ge=0)
    duration_hours: float = Field(..., gt=0, le=24)
    highlights: list[str] = Field(default_factory=list)
    itinerary: list[ItineraryStop] = Field(default_factory=list)
    breakdown: CostBreakdown = Field(default_factory=CostBreakdown)
    profitability: Profitability = Field(default_factory=Profitability)
    budget_score: float = Field(default=0, ge=0, le=10)
    logistics_score: float = Field(default=0, ge=0, le=10)
    appeal_score: float = Field(default=0, ge=0, le=10)
    quality_score: float = Field(default=0, ge=0, le=10)
    notes: str = Field(default="", max_length=4000)

    @model_validator(mode="before")
    @classmethod
    def coerce_money(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            return value
        data = dict(value)
        data["price"] = parse_amd(
            data.get("price", data.get("suggested_price", data.get("selling_price"))),
        )
        if "cost_breakdown" in data and "breakdown" not in data:
            data["breakdown"] = data.get("cost_breakdown")
        if "costs" in data and "breakdown" not in data:
            data["breakdown"] = data.get("costs")
        return data


class GenerateIdeasResponse(BaseModel):
    run_id: str = ""
    ideas: list[TourIdea]
    research_summary: str = ""


class HealthResponse(BaseModel):
    status: Literal["ok"]
