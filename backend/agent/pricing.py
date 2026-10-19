from __future__ import annotations

from typing import Any

from schemas import parse_amd

DEFAULT_PARTICIPANTS = 18
DEFAULT_GUIDE_FEE = 15000  # AMD
DEFAULT_TRANSPORT_BASELINE = 55000  # AMD (Armavir–Lori group return)
GROUP_SIZE = DEFAULT_PARTICIPANTS
GUIDE_FEE_GROUP_AMD = DEFAULT_GUIDE_FEE
DEFAULT_TRANSPORT_GROUP_AMD = DEFAULT_TRANSPORT_BASELINE
ARMAVIR_YEREVAN_KM = 45
ARMAVIR_YEREVAN_TRANSFER_AMD = 1000
YEREVAN_MARKERS = ("yerevan", "երևան", "ереван")
TRANSFER_NOTE = (
    f"Armavir–Yerevan transfer (~{ARMAVIR_YEREVAN_KM} km): "
    f"+{ARMAVIR_YEREVAN_TRANSFER_AMD} AMD per person. Needs verification of vehicle."
)


def _blob(idea: dict[str, Any]) -> str:
    parts = [
        idea.get("title_hy"),
        idea.get("title_en"),
        idea.get("title_ru"),
        idea.get("location_hy"),
        idea.get("location_en"),
        idea.get("location_ru"),
        idea.get("description_en"),
        idea.get("description_hy"),
        idea.get("notes"),
        " ".join(str(item) for item in idea.get("highlights") or []),
    ]
    for stop in idea.get("itinerary") or []:
        if isinstance(stop, dict):
            parts.append(stop.get("title"))
            parts.append(stop.get("description"))
    return " ".join(str(part or "") for part in parts).lower()


def mentions_yerevan(idea: dict[str, Any]) -> bool:
    text = _blob(idea)
    return any(marker in text for marker in YEREVAN_MARKERS)


def apply_yerevan_transfer(idea: dict[str, Any]) -> dict[str, Any]:
    next_idea = dict(idea)
    breakdown = dict(next_idea.get("breakdown") or {})
    already = parse_amd(breakdown.get("yerevan_transfer_amd"))
    needs_transfer = mentions_yerevan(next_idea)
    if not needs_transfer:
        breakdown.setdefault("yerevan_transfer_amd", 0)
        next_idea["breakdown"] = breakdown
        return next_idea
    if already == ARMAVIR_YEREVAN_TRANSFER_AMD:
        next_idea["breakdown"] = breakdown
        return next_idea
    transport = parse_amd(breakdown.get("transport_amd"))
    price = parse_amd(next_idea.get("price"))
    breakdown["yerevan_transfer_amd"] = ARMAVIR_YEREVAN_TRANSFER_AMD
    breakdown["transport_amd"] = transport + ARMAVIR_YEREVAN_TRANSFER_AMD
    notes = str(breakdown.get("notes") or "").strip()
    if TRANSFER_NOTE not in notes:
        breakdown["notes"] = f"{notes} {TRANSFER_NOTE}".strip()
    next_idea["price"] = price + ARMAVIR_YEREVAN_TRANSFER_AMD
    next_idea["breakdown"] = breakdown
    flag = (
        f"Base tour + {ARMAVIR_YEREVAN_TRANSFER_AMD} AMD Armavir–Yerevan transfer "
        f"(~{ARMAVIR_YEREVAN_KM} km). Estimated."
    )
    highlights = [str(item) for item in next_idea.get("highlights") or [] if str(item).strip()]
    if not any(
        "1000" in item and ("yerevan" in item.lower() or "երևան" in item.lower())
        for item in highlights
    ):
        highlights.append(
            f"Տրանսպորտ՝ բազա + {ARMAVIR_YEREVAN_TRANSFER_AMD} ֏ Երևան փոխադրում "
            f"(~{ARMAVIR_YEREVAN_KM} կմ, գնահատված)"
        )
    next_idea["highlights"] = highlights
    extra = str(next_idea.get("notes") or "")
    if flag not in extra:
        next_idea["notes"] = f"{extra} {flag}".strip()
    return next_idea


def calculate_unit_economics(
    suggested_price: float,
    transport_cost: float = DEFAULT_TRANSPORT_BASELINE,
    guide_fee: float = DEFAULT_GUIDE_FEE,
    participants: int = DEFAULT_PARTICIPANTS,
) -> dict:
    effective_transport = max(transport_cost, DEFAULT_TRANSPORT_BASELINE)
    total_fixed_cost = effective_transport + guide_fee
    cost_per_person = round(total_fixed_cost / participants, 2)
    profit_per_person = round(suggested_price - cost_per_person, 2)
    return {
        "participants": participants,
        "total_fixed_cost": total_fixed_cost,
        "cost_per_person": cost_per_person,
        "suggested_price": suggested_price,
        "profit_per_person": profit_per_person,
        "meals_included": False,
        "entrance_fees_included": False,
    }


def apply_unit_economics(idea: dict[str, Any]) -> dict[str, Any]:
    next_idea = dict(idea)
    breakdown = dict(next_idea.get("breakdown") or {})
    price = parse_amd(next_idea.get("price"))
    unit = calculate_unit_economics(
        suggested_price=float(price),
        transport_cost=float(parse_amd(breakdown.get("transport_amd"))),
        guide_fee=float(DEFAULT_GUIDE_FEE),
        participants=DEFAULT_PARTICIPANTS,
    )
    transport_group = int(max(parse_amd(breakdown.get("transport_amd")), DEFAULT_TRANSPORT_BASELINE))
    total_fixed = unit["total_fixed_cost"]
    cost_per_person = unit["cost_per_person"]
    profit_per_person = unit["profit_per_person"]
    breakdown["guide_amd"] = DEFAULT_GUIDE_FEE
    breakdown["transport_amd"] = transport_group
    breakdown["meals_amd"] = 0
    breakdown["entrance_fees_amd"] = 0
    unit_note = (
        f"Meals and entrance fees are not included. "
        f"{DEFAULT_PARTICIPANTS} participants. Total fixed cost = guide {DEFAULT_GUIDE_FEE} AMD + transport {transport_group} AMD "
        f"(Armavir–Lori return baseline {DEFAULT_TRANSPORT_BASELINE} AMD). "
        f"Cost per person = {total_fixed}/{DEFAULT_PARTICIPANTS} = {cost_per_person} AMD. "
        f"Profit per person = suggested price {price} − cost per person {cost_per_person} = {profit_per_person} AMD."
    )
    notes = str(breakdown.get("notes") or "").strip()
    if "Meals and entrance fees are not included" not in notes:
        breakdown["notes"] = f"{notes} {unit_note}".strip()
    else:
        breakdown["notes"] = unit_note
    next_idea["breakdown"] = breakdown
    profitability = dict(next_idea.get("profitability") or {})
    profitability["group_size"] = DEFAULT_PARTICIPANTS
    profitability["revenue_per_person_amd"] = int(round(price))
    profitability["expense_per_person_amd"] = int(round(cost_per_person))
    profitability["profit_per_person_amd"] = int(round(profit_per_person))
    profitability["revenue_per_group_amd"] = int(round(price * DEFAULT_PARTICIPANTS))
    profitability["expense_per_group_amd"] = int(round(total_fixed))
    profitability["profit_per_group_amd"] = int(round(profit_per_person * DEFAULT_PARTICIPANTS))
    profitability["assumptions"] = unit_note
    next_idea["profitability"] = profitability
    extra = str(next_idea.get("notes") or "")
    if "Meals and entrance fees are not included" not in extra:
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
        tagged[index]["budget_fit"] = "over"
        notes = str(tagged[index].get("notes") or "")
        extra = "Additional over-budget option; primary premium slot is the closest over-budget idea."
        if extra not in notes:
            tagged[index]["notes"] = f"{notes} {extra}".strip()
    return tagged
