from __future__ import annotations

import re
from difflib import SequenceMatcher
from typing import Any

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
    if int(idea.get("price") or 0) <= 0:
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
