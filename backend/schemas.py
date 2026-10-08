from typing import Literal

from pydantic import BaseModel, Field, field_validator

Season = Literal["spring", "summer", "autumn", "winter"]
Audience = Literal["families", "couples", "friends", "seniors", "mixed"]
TourType = Literal["cultural", "hiking", "extreme", "mixed"]


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
    title: str = Field(..., min_length=1, max_length=160)
    description: str = Field(..., min_length=1, max_length=400)


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
    budget_score: float = Field(default=0, ge=0, le=10)
    logistics_score: float = Field(default=0, ge=0, le=10)
    appeal_score: float = Field(default=0, ge=0, le=10)
    notes: str = Field(default="", max_length=500)


class GenerateIdeasResponse(BaseModel):
    ideas: list[TourIdea]
    research_summary: str = ""


class HealthResponse(BaseModel):
    status: Literal["ok"]
