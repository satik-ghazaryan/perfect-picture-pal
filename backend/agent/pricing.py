from __future__ import annotations

import os
from statistics import median
from typing import Any, Literal

from schemas import parse_amd

GROUP_SIZE = 17
GUIDE_FEE_GROUP_AMD = 15000
RATE_PER_KM_AMD = 600
MIN_MARGIN_PCT = 25
MarketPosition = Literal["below_market", "in_range", "above_market", "unknown"]

# Former add-on (+1000 AMD if Yerevan appeared in copy). Route km already
# includes a Yerevan stop when it is on the itinerary, so that fee is gone.
# ARMAVIR_YEREVAN_TRANSFER_AMD = 1000

DEFAULT_PARTICIPANTS = GROUP_SIZE
DEFAULT_GUIDE_FEE = GUIDE_FEE_GROUP_AMD


def transport_rate_per_km() -> int:
    raw = os.getenv("TRANSPORT_RATE_PER_KM_AMD", "").strip()
    if raw.isdigit():
        value = int(raw)
        if value > 0:
            return value
    return RATE_PER_KM_AMD


def transport_group_amd(route_km: float) -> int:
    return int(round(max(0.0, float(route_km)) * transport_rate_per_km()))


def cost_per_person_amd(transport_group: int) -> int:
    return int(round((int(transport_group) + GUIDE_FEE_GROUP_AMD) / GROUP_SIZE))


def min_price_amd(cost_pp: int) -> int:
    return (int(cost_pp) * (100 + MIN_MARGIN_PCT)) // 100


def apply_yerevan_transfer(idea: dict[str, Any]) -> dict[str, Any]:
    next_idea = dict(idea)
    breakdown = dict(next_idea.get("breakdown") or {})
    breakdown["yerevan_transfer_amd"] = 0
    next_idea["breakdown"] = breakdown
    return next_idea


def _usable_prices(offers: list[dict[str, Any]]) -> list[int]:
    prices: list[int] = []
    for offer in offers:
        if not isinstance(offer, dict):
            continue
        amount = parse_amd(offer.get("observed_price_amd") or offer.get("price"))
        if amount > 0:
            prices.append(amount)
    return prices


def choose_suggested_price(cost_pp: int, offers: list[dict[str, Any]]) -> tuple[int, MarketPosition, dict[str, Any]]:
    floor = min_price_amd(cost_pp)
    prices = _usable_prices(offers)
    market: dict[str, Any] = {
        "label": "market_reference",
        "offer_count": len(prices),
        "price_min_amd": min(prices) if prices else None,
        "price_median_amd": int(round(median(prices))) if prices else None,
        "price_max_amd": max(prices) if prices else None,
        "offers": offers,
    }
    if not prices:
        market["difference_amd"] = 0
        return floor, "unknown", market
    band_min = min(prices)
    band_max = max(prices)
    mid = int(round(median(prices)))
    if floor > band_max:
        suggested = floor
        position: MarketPosition = "above_market"
    else:
        suggested = min(band_max, max(floor, mid, band_min))
        suggested = max(suggested, floor)
        if suggested < band_min:
            position = "below_market"
        elif suggested > band_max:
            position = "above_market"
        else:
            position = "in_range"
    market["difference_amd"] = suggested - (market["price_median_amd"] or suggested)
    return suggested, position, market


PRICE_NEEDS_DISTANCE = "price needs route distance"


def apply_unit_economics(
    idea: dict[str, Any],
    *,
    route_km: float = 0.0,
    km_sourced: bool = False,
    km_notes: list[str] | None = None,
    offers: list[dict[str, Any]] | None = None,
    has_away_stop: bool = False,
) -> dict[str, Any]:
    next_idea = dict(idea)
    breakdown = dict(next_idea.get("breakdown") or {})
    rate = transport_rate_per_km()
    transport_group = transport_group_amd(route_km)
    verify = [str(item) for item in (next_idea.get("verify") or []) if str(item).strip()]
    if km_notes:
        verify.extend(item for item in km_notes if item not in verify)
    blocked = has_away_stop and transport_group <= 0
    if blocked:
        if PRICE_NEEDS_DISTANCE not in verify:
            verify.append(PRICE_NEEDS_DISTANCE)
        cost_pp = 0
        min_price = 0
        suggested: int | None = None
        position: MarketPosition = "unknown"
        _, _, market = choose_suggested_price(0, [])
        profit_pp = 0
        total_fixed = GUIDE_FEE_GROUP_AMD
        unit_note = (
            f"Estimated. Meals and entrance fees are not included. "
            f"GROUP_SIZE={GROUP_SIZE}. Guide {GUIDE_FEE_GROUP_AMD} AMD for the group. "
            f"{PRICE_NEEDS_DISTANCE}. No selling price until driving km is known."
        )
    else:
        cost_pp = cost_per_person_amd(transport_group)
        min_price = min_price_amd(cost_pp)
        suggested, position, market = choose_suggested_price(cost_pp, offers or [])
        if suggested < min_price:
            suggested = min_price
        profit_pp = suggested - cost_pp
        total_fixed = transport_group + GUIDE_FEE_GROUP_AMD
        if position == "unknown" and "No usable competitor offers" not in verify:
            verify.append("No usable competitor offers; price is cost+margin only")
        if not km_sourced and "Route km is an estimate" not in verify:
            verify.append("Route km is an estimate; confirm driving distance")
        unit_note = (
            f"Estimated. Meals and entrance fees are not included. "
            f"GROUP_SIZE={GROUP_SIZE}. Guide {GUIDE_FEE_GROUP_AMD} AMD for the group. "
            f"route_km={route_km:.1f} one-way (Armavir to last stop; no return leg; "
            f"{rate} AMD/km covers the day's vehicle). "
            f"transport_group={transport_group} AMD. "
            f"Cost per person = ({transport_group}+{GUIDE_FEE_GROUP_AMD})/{GROUP_SIZE} = {cost_pp} AMD. "
            f"Minimum price (cost x {MIN_MARGIN_PCT}%) = {min_price} AMD. "
            f"Suggested price = {suggested} AMD. Profit per person = {profit_pp} AMD."
        )
    breakdown["guide_amd"] = GUIDE_FEE_GROUP_AMD
    breakdown["transport_amd"] = transport_group if not blocked else 0
    breakdown["meals_amd"] = 0
    breakdown["entrance_fees_amd"] = 0
    breakdown["yerevan_transfer_amd"] = 0
    breakdown["notes"] = unit_note
    next_idea["breakdown"] = breakdown
    next_idea["price"] = suggested
    next_idea["route_km"] = round(float(route_km), 1)
    next_idea["transport_rate_per_km_amd"] = rate
    next_idea["cost_per_person_amd"] = cost_pp
    next_idea["min_price_amd"] = min_price
    next_idea["market_position"] = position
    next_idea["market"] = market
    next_idea["verify"] = verify
    next_idea["needs_verification"] = bool(verify)
    profitability = {
        "group_size": GROUP_SIZE,
        "revenue_per_person_amd": suggested or 0,
        "expense_per_person_amd": cost_pp,
        "profit_per_person_amd": profit_pp,
        "revenue_per_group_amd": (suggested or 0) * GROUP_SIZE,
        "expense_per_group_amd": total_fixed,
        "profit_per_group_amd": profit_pp * GROUP_SIZE,
        "assumptions": unit_note,
        "confidence": "needs_verification" if verify else "estimated",
    }
    next_idea["profitability"] = profitability
    extra = str(next_idea.get("notes") or "")
    if unit_note not in extra:
        next_idea["notes"] = f"{extra} {unit_note}".strip()
    highlights = [str(item) for item in next_idea.get("highlights") or [] if str(item).strip()]
    exclusion = "Meals and entrance fees are not included."
    if exclusion not in highlights:
        highlights.append(exclusion)
    next_idea["highlights"] = highlights
    return next_idea


def tag_budget_fit(ideas: list[dict[str, Any]], budget_amd: int) -> list[dict[str, Any]]:
    tagged: list[dict[str, Any]] = []
    over_indexes: list[int] = []
    for idea in ideas:
        current = dict(idea)
        price = parse_amd(current.get("price"))
        if budget_amd > 0 and price > budget_amd:
            current["budget_fit"] = "over"
            over_indexes.append(len(tagged))
        else:
            current["budget_fit"] = "within"
        tagged.append(current)
    if len(over_indexes) <= 1:
        return tagged
    closest = min(over_indexes, key=lambda index: parse_amd(tagged[index].get("price")) - budget_amd)
    for index in over_indexes:
        if index == closest:
            continue
        notes = str(tagged[index].get("notes") or "")
        extra = "Additional over-budget option; primary premium slot is the closest over-budget idea."
        if extra not in notes:
            tagged[index]["notes"] = f"{notes} {extra}".strip()
    return tagged
