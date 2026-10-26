from __future__ import annotations

import re
from difflib import SequenceMatcher
from typing import Any

from agent.pricing import PRICE_NEEDS_DISTANCE

ARMENIAN_RE = re.compile(r"[\u0531-\u0587]")
CYRILLIC_RE = re.compile(r"[\u0400-\u04FF]")
LATIN_WORD_RE = re.compile(r"[A-Za-z]{3,}")
TIME_RE = re.compile(r"^(\d{1,2}):(\d{2})$")

GENERIC_TITLE_FRAGMENTS = (
    "beautiful armenia",
    "discover armenia",
    "unforgettable",
    "best of armenia",
    "one day tour",
    "մեկօրյա տուր",
    "գեղեցիկ հայաստան",
    "լավագույն տուր",
)

SECTION_MARKERS_HY = (
    "հայեցակարգ",
    "լսարան",
    "արժեք",
    "սեզոն",
    "տարբերակում",
    "արժեքի բաշխում",
    "գին",
    "շահութ",
    "ռիսկ",
    "որակ",
)


def _text(value: Any) -> str:
    return str(value or "").strip()


def parse_hhmm(value: str) -> int | None:
    match = TIME_RE.match(value.strip())
    if not match:
        return None
    hour, minute = int(match.group(1)), int(match.group(2))
    if hour > 23 or minute > 59:
        return None
    return hour * 60 + minute


def armenian_script_ok(value: str) -> bool:
    text = _text(value)
    if not ARMENIAN_RE.search(text):
        return False
    return len(LATIN_WORD_RE.findall(text)) <= 3


def english_script_ok(value: str) -> bool:
    text = _text(value)
    if not LATIN_WORD_RE.search(text):
        return False
    return not ARMENIAN_RE.search(text) and len(CYRILLIC_RE.findall(text)) <= 2


def russian_script_ok(value: str) -> bool:
    text = _text(value)
    if not CYRILLIC_RE.search(text):
        return False
    return not ARMENIAN_RE.search(text)


def titles_too_similar(ideas: list[dict[str, Any]]) -> bool:
    titles = [_text(item.get("title_en")).lower() for item in ideas if _text(item.get("title_en"))]
    for index, left in enumerate(titles):
        for right in titles[index + 1 :]:
            if SequenceMatcher(None, left, right).ratio() >= 0.72:
                return True
    return False


def itinerary_issues(idea: dict[str, Any]) -> list[str]:
    issues: list[str] = []
    stops = idea.get("itinerary") if isinstance(idea.get("itinerary"), list) else []
    if len(stops) < 4:
        issues.append("itinerary needs at least four timed stops including departure and return")
    previous: int | None = None
    joined = " ".join(_text(stop.get("title")) + " " + _text(stop.get("description")) for stop in stops if isinstance(stop, dict)).lower()
    if "armavir" not in joined and "արմավիր" not in joined:
        issues.append("itinerary must start and end in Armavir")
    for stop in stops:
        if not isinstance(stop, dict):
            continue
        minutes = parse_hhmm(_text(stop.get("time")))
        if minutes is None:
            issues.append(f"invalid stop time: {stop.get('time')}")
            continue
        if previous is not None and minutes < previous:
            issues.append("itinerary times are not chronological")
            break
        previous = minutes
    duration = float(idea.get("duration_hours") or 0)
    if duration < 7 or duration > 14:
        issues.append("one-day duration_hours should stay between 7 and 14")
    return issues


def description_completeness_issues(idea: dict[str, Any]) -> list[str]:
    blob = " ".join(
        [
            _text(idea.get("description_hy")),
            _text(idea.get("notes")),
            " ".join(_text(item) for item in idea.get("highlights") or [] if isinstance(item, str)),
        ]
    ).lower()
    missing = [marker for marker in SECTION_MARKERS_HY if marker not in blob]
    if len(missing) >= 5:
        return ["business analysis sections are missing from Armenian copy"]
    return []


def idea_quality_issues(idea: dict[str, Any], index: int) -> list[str]:
    label = _text(idea.get("id")) or f"idea-{index + 1}"
    issues: list[str] = []
    if not armenian_script_ok(_text(idea.get("title_hy"))) or not armenian_script_ok(_text(idea.get("description_hy"))):
        issues.append(f"{label}: Armenian fields mix scripts or are not natural HY")
    if not english_script_ok(_text(idea.get("title_en"))) or not english_script_ok(_text(idea.get("description_en"))):
        issues.append(f"{label}: English fields mix languages")
    if not russian_script_ok(_text(idea.get("title_ru"))) or not russian_script_ok(_text(idea.get("description_ru"))):
        issues.append(f"{label}: Russian fields mix languages")
    title_blob = " ".join([_text(idea.get("title_hy")), _text(idea.get("title_en")), _text(idea.get("title_ru"))]).lower()
    if any(fragment in title_blob for fragment in GENERIC_TITLE_FRAGMENTS):
        issues.append(f"{label}: title is too generic")
    if idea.get("price") is None:
        if PRICE_NEEDS_DISTANCE not in " ".join(_text(item) for item in idea.get("verify") or []):
            issues.append(f"{label}: {PRICE_NEEDS_DISTANCE}")
    elif int(idea.get("price") or 0) <= 0:
        issues.append(f"{label}: suggested selling price is missing")
    issues.extend(f"{label}: {item}" for item in itinerary_issues(idea))
    issues.extend(f"{label}: {item}" for item in description_completeness_issues(idea))
    return issues


def collect_quality_issues(ideas: list[dict[str, Any]]) -> list[str]:
    issues: list[str] = []
    if titles_too_similar(ideas):
        issues.append("ideas are too similar to each other; each needs a distinct concept")
    for index, idea in enumerate(ideas):
        if isinstance(idea, dict):
            issues.extend(idea_quality_issues(idea, index))
    return issues


def ensure_armavir_bookends(idea: dict[str, Any], departure: str) -> dict[str, Any]:
    stops = [dict(stop) for stop in idea.get("itinerary") or [] if isinstance(stop, dict)]
    place = departure.strip() or "Արմավիր"
    joined = " ".join(_text(stop.get("title")) for stop in stops).lower()
    if stops and "արմավիր" not in joined and "armavir" not in joined:
        stops.insert(
            0,
            {
                "time": "08:00",
                "title": f"{place} — մեկնում",
                "description": "Estimated departure from Armavir; confirm meeting point and vehicle on the operation day. Needs verification.",
            },
        )
        last_time = _text(stops[-1].get("time")) if stops else "18:30"
        minutes = parse_hhmm(last_time) or (18 * 60 + 30)
        return_minutes = min(22 * 60, minutes + 40)
        hour, minute = divmod(return_minutes, 60)
        stops.append(
            {
                "time": f"{hour:02d}:{minute:02d}",
                "title": f"{place} — վերադարձ",
                "description": "Estimated return to Armavir. Road time is an assumption and needs verification.",
            },
        )
    idea["itinerary"] = stops
    return idea


def attach_review_flag(idea: dict[str, Any], flag: str) -> dict[str, Any]:
    notes = _text(idea.get("notes"))
    if flag.lower() not in notes.lower():
        idea["notes"] = f"{notes} {flag}".strip()
    return idea


def _search_corpus(research: dict[str, Any]) -> str:
    parts: list[str] = []
    for row in research.get("results") or []:
        if isinstance(row, dict):
            parts.append(str(row.get("title") or ""))
            parts.append(str(row.get("snippet") or ""))
    return " ".join(parts).lower()


def _is_armavir_title(title: str) -> bool:
    text = title.lower()
    return "armavir" in text or "արմավիր" in text


def ground_idea(idea: dict[str, Any], research: dict[str, Any]) -> dict[str, Any]:
    verify = [str(item) for item in (idea.get("verify") or []) if str(item).strip()]
    live = bool(research.get("live"))
    corpus = _search_corpus(research)
    useful = int(research.get("useful_result_count") or len(research.get("results") or []))
    if useful < 2:
        flag = "Fewer than 2 useful search results after filtering"
        if flag not in verify:
            verify.append(flag)
    if not live or not corpus.strip() or useful < 2:
        flag = "No live web results; places and prices need human research"
        if flag not in verify:
            verify.append(flag)
        idea["verify"] = verify
        idea["needs_verification"] = True
        idea["source_urls"] = []
        return idea
    for stop in idea.get("itinerary") or []:
        if not isinstance(stop, dict):
            continue
        title = _text(stop.get("title"))
        if not title or _is_armavir_title(title):
            continue
        tokens = [token for token in re.split(r"[\s,;:/|—.()\-]+", title) if len(token) > 3]
        if tokens and not any(token.lower() in corpus for token in tokens):
            flag = f"Place not in search results: {title}"
            if flag not in verify:
                verify.append(flag)
    urls: list[str] = []
    blob = " ".join(
        [
            _text(idea.get("title_en")),
            _text(idea.get("location_en")),
            " ".join(_text(stop.get("title")) for stop in idea.get("itinerary") or [] if isinstance(stop, dict)),
        ]
    ).lower()
    for row in research.get("results") or []:
        if not isinstance(row, dict):
            continue
        url = str(row.get("url") or "").strip()
        hay = f"{row.get('title') or ''} {row.get('snippet') or ''}".lower()
        if url and any(token in hay for token in blob.split() if len(token) > 4):
            urls.append(url)
    idea["source_urls"] = list(dict.fromkeys(urls))[:8]
    idea["verify"] = verify
    idea["needs_verification"] = bool(verify)
    return idea


MONEY_FIGURE_RE = re.compile(
    r"(?:price\s+around\s+)?(?:\d{1,3}(?:[.,\s]\d{3})+|\d{3,7})\s*(?:AMD|amd|֏|դրամ|₽|руб(?:\.|лей)?)"
    r"(?:\s*/\s*(?:անձ|чел(?:овек)?|person))?"
    r"|(?:AMD|amd|֏|₽)\s*(?:\d{1,3}(?:[.,\s]\d{3})+|\d{3,7})",
    re.IGNORECASE,
)

OWN_BRAND_RE = re.compile(r"ari\s*gnank|արի\s*գնանք|ари\s*гнанк", re.IGNORECASE)
NO_COMPETITOR_LINE = "No competitor data was found."
DIFF_MARKERS = ("մրցակցային", "differentiation", "competitor", "конкурент")


def strip_money_figures(text: str) -> str:
    cleaned = MONEY_FIGURE_RE.sub("", str(text or ""))
    return re.sub(r"\s{2,}", " ", cleaned).strip()


def _walk_text_fields(idea: dict[str, Any], transform) -> dict[str, Any]:
    next_idea = dict(idea)
    for key in (
        "description_hy",
        "description_en",
        "description_ru",
        "notes",
        "location_hy",
        "location_en",
        "location_ru",
        "title_hy",
        "title_en",
        "title_ru",
    ):
        if key in next_idea and next_idea[key] is not None:
            next_idea[key] = transform(str(next_idea[key]))
    highlights = []
    for item in next_idea.get("highlights") or []:
        highlights.append(transform(str(item)))
    if highlights:
        next_idea["highlights"] = [item for item in highlights if item]
    stops = []
    for stop in next_idea.get("itinerary") or []:
        if not isinstance(stop, dict):
            continue
        row = dict(stop)
        original_title = str(row.get("title") or "")
        row["title"] = transform(original_title) or original_title
        original_description = str(row.get("description") or "")
        row["description"] = transform(original_description) or original_description
        if row.get("title_en"):
            row["title_en"] = transform(str(row["title_en"])) or row["title_en"]
        stops.append(row)
    if stops:
        next_idea["itinerary"] = stops
    breakdown = dict(next_idea.get("breakdown") or {})
    if breakdown.get("notes"):
        breakdown["notes"] = transform(str(breakdown["notes"]))
        next_idea["breakdown"] = breakdown
    profitability = dict(next_idea.get("profitability") or {})
    if profitability.get("assumptions"):
        profitability["assumptions"] = transform(str(profitability["assumptions"]))
        next_idea["profitability"] = profitability
    return next_idea


def strip_idea_money_figures(idea: dict[str, Any]) -> dict[str, Any]:
    return _walk_text_fields(idea, strip_money_figures)


def _search_blob(research: dict[str, Any]) -> str:
    parts = [_search_corpus(research)]
    for row in research.get("results") or []:
        if isinstance(row, dict):
            parts.append(str(row.get("url") or ""))
    for offer in research.get("market_offers") or []:
        if isinstance(offer, dict):
            parts.append(str(offer.get("title") or ""))
            parts.append(str(offer.get("url") or ""))
            parts.append(str(offer.get("snippet") or ""))
    return " ".join(parts).lower()


def _named_in_results(name: str, blob: str) -> bool:
    token = name.lower().strip()
    if len(token) < 4:
        return False
    return token in blob


def sanitize_competitors(idea: dict[str, Any], research: dict[str, Any] | None = None) -> dict[str, Any]:
    research = research or {}
    blob = _search_blob(research)
    offers = [item for item in (research.get("market_offers") or []) if isinstance(item, dict) and str(item.get("url") or "").strip()]
    has_offers = bool(offers)

    def scrub(text: str) -> str:
        out = OWN_BRAND_RE.sub("", text)
        if not _named_in_results("armgeo", blob):
            out = re.sub(r"armgeo", "", out, flags=re.IGNORECASE)
        if not _named_in_results("one way tour", blob):
            out = re.sub(r"one\s*way\s*tour", "", out, flags=re.IGNORECASE)
        return re.sub(r"\s{2,}", " ", out).replace(" and .", ".").strip()

    next_idea = _walk_text_fields(idea, scrub)
    if not has_offers:
        highlights = []
        replaced = False
        for item in next_idea.get("highlights") or []:
            low = str(item).lower()
            if any(marker in low for marker in DIFF_MARKERS):
                highlights.append(NO_COMPETITOR_LINE)
                replaced = True
            else:
                highlights.append(item)
        if not replaced:
            highlights.append(NO_COMPETITOR_LINE)
        next_idea["highlights"] = highlights
        for key in ("description_en", "description_hy", "description_ru", "notes"):
            value = _text(next_idea.get(key))
            if NO_COMPETITOR_LINE not in value:
                next_idea[key] = f"{value} {NO_COMPETITOR_LINE}".strip()
    verify = [str(item) for item in (next_idea.get("verify") or []) if str(item).strip()]
    if not has_offers and "No competitor data was found" not in " ".join(verify):
        verify.append("No competitor data was found")
    next_idea["verify"] = verify
    next_idea["needs_verification"] = bool(verify)
    return next_idea


def rewrite_copy_from_numbers(idea: dict[str, Any], research: dict[str, Any] | None = None) -> dict[str, Any]:
    next_idea = strip_idea_money_figures(idea)
    next_idea = sanitize_competitors(next_idea, research)
    cost = int(next_idea.get("cost_per_person_amd") or 0)
    raw_price = next_idea.get("price")
    profit = int((next_idea.get("profitability") or {}).get("profit_per_person_amd") or 0)
    group = int((next_idea.get("profitability") or {}).get("group_size") or 17)
    if raw_price is None:
        line_en = f"Computed figures (source of truth): group {group}; {PRICE_NEEDS_DISTANCE}. Estimated."
        line_hy = f"Հաշվարկված թվեր՝ խումբ {group} հոգի. {PRICE_NEEDS_DISTANCE}."
        line_ru = f"Расчётные цифры: группа {group}; {PRICE_NEEDS_DISTANCE}."
    else:
        price = int(raw_price)
        line_en = (
            f"Computed figures (source of truth): group {group}; cost per person {cost} AMD; "
            f"suggested price {price} AMD; profit per person {profit} AMD. Estimated."
        )
        line_hy = (
            f"Հաշվարկված թվեր՝ խումբ {group} հոգի, արժեք/անձ {cost} ֏, "
            f"առաջարկվող գին {price} ֏, շահույթ/անձ {profit} ֏։ Գնահատված։"
        )
        line_ru = (
            f"Расчётные цифры: группа {group}; себестоимость {cost} AMD/чел; "
            f"цена {price} AMD; прибыль {profit} AMD/чел. Оценка."
        )
    next_idea["description_en"] = (_text(next_idea.get("description_en")) + " " + line_en).strip()
    next_idea["description_hy"] = (_text(next_idea.get("description_hy")) + " " + line_hy).strip()
    next_idea["description_ru"] = (_text(next_idea.get("description_ru")) + " " + line_ru).strip()
    breakdown = dict(next_idea.get("breakdown") or {})
    prior_notes = str((idea.get("breakdown") or {}).get("notes") or "")
    if raw_price is None:
        breakdown["notes"] = (
            f"Estimated. Meals and entrance fees are not included. {PRICE_NEEDS_DISTANCE}."
        )
    elif prior_notes:
        breakdown["notes"] = prior_notes
    next_idea["breakdown"] = breakdown
    profitability = dict(next_idea.get("profitability") or {})
    if profitability:
        profitability["assumptions"] = breakdown.get("notes") or profitability.get("assumptions") or ""
        next_idea["profitability"] = profitability
    extra = _text(next_idea.get("notes"))
    if line_en not in extra:
        next_idea["notes"] = f"{extra} {line_en}".strip()
    return next_idea
