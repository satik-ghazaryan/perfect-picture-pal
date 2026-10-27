from __future__ import annotations

import re
from difflib import SequenceMatcher
from typing import Any

from agent.distance import is_activity_stop, is_armavir_stop, place_from_stop_title
from agent.place_discovery import log_discovery
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
    dests = [
        stop
        for stop in stops
        if isinstance(stop, dict) and _text(stop.get("title")) and not _is_armavir_title(_text(stop.get("title")))
    ]
    if len(stops) < 4:
        issues.append("itinerary needs at least four timed stops including departure and return")
    if len(dests) < 2:
        issues.append("itinerary is too thin; need at least two sourced stops besides Armavir")
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
                "title": "Արմավիր — մեկնում",
                "title_en": "Armavir — departure",
                "title_ru": "Армавир — отправление",
                "description": "Արմավիրից մեկնում։ Հաստատել հավաքի կետը գործարկման օրը։",
                "description_en": "Estimated departure from Armavir; confirm meeting point. Needs verification.",
                "description_ru": "Отправление из Армавира. Нужна проверка.",
            },
        )
        last_time = _text(stops[-1].get("time")) if stops else "18:30"
        minutes = parse_hhmm(last_time) or (18 * 60 + 30)
        return_minutes = min(22 * 60, minutes + 40)
        hour, minute = divmod(return_minutes, 60)
        stops.append(
            {
                "time": f"{hour:02d}:{minute:02d}",
                "title": "Արմավիր — վերադարձ",
                "title_en": "Armavir — return",
                "title_ru": "Армавир — возвращение",
                "description": "Վերադարձ Արմավիր։ Ճանապարհի ժամանակը գնահատված է։",
                "description_en": "Estimated return to Armavir. Road time needs verification.",
                "description_ru": "Возвращение в Армавир. Нужна проверка.",
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
    return is_armavir_stop(title)


GENERIC_STOP_PHRASES = (
    "cultural sites",
    "cultural site",
    "sightseeing",
)
GENERIC_STOP_WORDS = {
    "attractions",
    "attraction",
    "sightseeing",
    "visit",
    "explore",
    "arrive",
    "arriving",
    "tour",
    "tours",
}
GENERIC_STOP_NOTE = "Generic stop, no concrete place:"
NOT_ENOUGH_PLACES = "Not enough concrete places found; needs human research"


def is_lunch_stop(title: str) -> bool:
    text = _text(title).lower()
    if "lunch" in text or "meal" in text:
        return True
    return is_activity_stop(title) and not is_armavir_stop(title)


def is_generic_stop_title(title: str) -> bool:
    if is_armavir_stop(title) or is_lunch_stop(title):
        return False
    text = _text(title).lower()
    if any(phrase in text for phrase in GENERIC_STOP_PHRASES):
        return True
    tokens = re.findall(r"[A-Za-z\u0531-\u0587]+", text)
    lowered = [token.lower() for token in tokens]
    if any(word in GENERIC_STOP_WORDS for word in lowered):
        leftover = [
            word
            for word in lowered
            if word not in GENERIC_STOP_WORDS and word not in {"in", "the", "and", "of", "to", "a", "an", "at", "on"}
        ]
        if len(leftover) <= 1:
            return True
    place = place_from_stop_title(title)
    return not place


def _candidate_rows(research: dict[str, Any]) -> list[dict[str, Any]]:
    rows = research.get("place_candidates") or []
    return [item for item in rows if isinstance(item, dict) and _text(item.get("name_en"))]


def match_place_candidate(title: str, research: dict[str, Any]) -> dict[str, Any] | None:
    hay = " ".join([_text(title), place_from_stop_title(title)]).lower()
    best: dict[str, Any] | None = None
    best_len = 0
    for row in _candidate_rows(research):
        name = _text(row.get("name_en"))
        key = name.lower()
        if len(key) < 3:
            continue
        if key in hay or hay in key:
            if len(key) > best_len:
                best = row
                best_len = len(key)
    return best


def _search_mentions_stop(title: str, research: dict[str, Any]) -> bool:
    corpus = _search_corpus(research)
    if not corpus.strip():
        return False
    place = place_from_stop_title(title) or _text(title)
    tokens = [token for token in re.split(r"[\s,;:/|—.()\-]+", place) if len(token) > 3]
    return bool(tokens) and any(token.lower() in corpus for token in tokens)


def classify_itinerary_stops(idea: dict[str, Any], research: dict[str, Any]) -> dict[str, Any]:
    """Keep Armavir/lunch; geocode only concrete candidate (or search-backed) names."""
    verify = [str(item) for item in (idea.get("verify") or []) if str(item).strip()]
    candidates = _candidate_rows(research)
    accepted: list[dict[str, Any]] = []
    dropped: list[str] = []
    for stop in idea.get("itinerary") or []:
        if not isinstance(stop, dict):
            continue
        title = _text(stop.get("title_en") or stop.get("title"))
        if not title or _is_armavir_title(title) or is_lunch_stop(title):
            continue
        matched = match_place_candidate(title, research)
        if matched:
            geo_stop = dict(stop)
            geo_stop["title_en"] = _text(matched.get("name_en"))
            geo_stop["source_url"] = _text(matched.get("source_url") or geo_stop.get("source_url"))
            accepted.append(geo_stop)
            continue
        generic = is_generic_stop_title(title)
        allowed = (not candidates) and (not generic) and _search_mentions_stop(title, research)
        if allowed:
            accepted.append(dict(stop))
            continue
        dropped.append(title)
        flag = f"{GENERIC_STOP_NOTE} {title}"
        if flag not in verify:
            verify.append(flag)
    if len(accepted) < 2 and NOT_ENOUGH_PLACES not in verify:
        verify.append(NOT_ENOUGH_PLACES)
    idea["verify"] = verify
    idea["needs_verification"] = bool(verify)
    log_discovery(
        str(research.get("place_en") or ""),
        int(research.get("pages_fetched") or 0),
        len(candidates),
        accepted=[_text(item.get("title_en") or item.get("title")) for item in accepted],
        dropped=dropped,
    )
    return {"idea": idea, "accepted": accepted, "dropped": dropped}


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


HY_REVIEW_FLAG = "Armenian text needs review"
FORBIDDEN_CUSTOMER_PHRASES = (
    "Python-ը կլրացնի տրանսպորտը ըստ կմ",
    "Transport costs will be filled by Python based on km",
    "Транспортные расходы будут заполнены Python на основе километража",
    "Estimated based on transport and guide fees",
    "Potential for good revenue with group size",
    "Computed figures (source of truth)",
)
INTERNAL_OPS_RE = re.compile(
    r"Python-ը կլրացնի[^.։]*[։.]?|"
    r"will be filled by Python[^.]*\.?|"
    r"Python fills[^.]*\.?|"
    r"Computed figures \(source of truth\)[:\s]*[^.]*\.?|"
    r"source of truth|"
    r"Հաշվարկված թվեր՝[^։.]*[։.]?|"
    r"Расчётные цифры:[^.]*\.?",
    re.IGNORECASE,
)
INVENTED_CLAIM_RE = re.compile(
    r"Positive feedback from previous participants\.?|"
    r"previous participants|"
    r"Quality\s+\d+(?:\.\d+)?\s*/\s*10|"
    r"որակ[`՝:]?\s*\d+(?:\.\d+)?\s*/\s*10|"
    r"Որակի գնահատական\s*\d+(?:\.\d+)?\s*/\s*10|"
    r"оценка качества\s*\d+(?:\.\d+)?\s*/\s*10",
    re.IGNORECASE,
)
LATIN_SENTENCE_RE = re.compile(r"\b[A-Z][A-Za-z]+(?:\s+[A-Za-z]{2,}){3,}[.]?")
PAREN_CHUNK_RE = re.compile(r"\([^)]*\)")

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


def strip_internal_ops(text: str) -> str:
    cleaned = str(text or "")
    for phrase in FORBIDDEN_CUSTOMER_PHRASES:
        cleaned = re.sub(re.escape(phrase), "", cleaned, flags=re.IGNORECASE)
    cleaned = INTERNAL_OPS_RE.sub("", cleaned)
    return re.sub(r"\s{2,}", " ", cleaned).strip()


def strip_invented_claims(text: str) -> str:
    cleaned = INVENTED_CLAIM_RE.sub("", str(text or ""))
    return re.sub(r"\s{2,}", " ", cleaned).strip()


def strip_customer_ops_text(text: str) -> str:
    return strip_invented_claims(strip_internal_ops(strip_money_figures(text)))


def strip_latin_sentences_from_hy(text: str) -> str:
    without_paren = text
    cleaned = LATIN_SENTENCE_RE.sub("", without_paren)
    return re.sub(r"\s{2,}", " ", cleaned).strip()


def hy_text_ok(value: str) -> bool:
    text = _text(value)
    if not text:
        return False
    if not ARMENIAN_RE.search(text):
        return False
    remainder = PAREN_CHUNK_RE.sub(" ", text)
    remainder = LATIN_SENTENCE_RE.sub(" ", remainder)
    latin = LATIN_WORD_RE.findall(remainder)
    return len(latin) <= 3


def hy_copy_ok(idea: dict[str, Any]) -> bool:
    if not hy_text_ok(_text(idea.get("title_hy"))) or not hy_text_ok(_text(idea.get("description_hy"))):
        return False
    location = _text(idea.get("location_hy"))
    if location and not hy_text_ok(location):
        return False
    for stop in idea.get("itinerary") or []:
        if not isinstance(stop, dict):
            continue
        title = _text(stop.get("title"))
        if title and not hy_text_ok(title):
            return False
        description = _text(stop.get("description"))
        if description and ARMENIAN_RE.search(description) is None and LATIN_WORD_RE.search(description):
            return False
    return True


def mark_hy_review(idea: dict[str, Any]) -> dict[str, Any]:
    verify = [str(item) for item in (idea.get("verify") or []) if str(item).strip()]
    if HY_REVIEW_FLAG not in verify:
        verify.append(HY_REVIEW_FLAG)
    idea["verify"] = verify
    idea["needs_verification"] = True
    return idea


def flag_thin_itinerary(idea: dict[str, Any], research: dict[str, Any] | None = None) -> dict[str, Any]:
    verify = [str(item) for item in (idea.get("verify") or []) if str(item).strip()]
    for item in itinerary_issues(idea):
        if item not in verify:
            verify.append(item)
    research = research or {}
    corpus = _search_corpus(research)
    for stop in idea.get("itinerary") or []:
        if not isinstance(stop, dict) or _is_armavir_title(_text(stop.get("title"))):
            continue
        reason = _text(stop.get("description") or stop.get("why"))
        if not reason:
            flag = f"Stop needs a reason: {_text(stop.get('title'))}"
            if flag not in verify:
                verify.append(flag)
        source = _text(stop.get("source_url"))
        title = _text(stop.get("title_en") or stop.get("title"))
        tokens = [token for token in re.split(r"[\s,;:/|—.()\-]+", title) if len(token) > 3]
        if tokens and corpus and not any(token.lower() in corpus for token in tokens):
            flag = f"Place not in search results: {title}"
            if flag not in verify:
                verify.append(flag)
        if not source and tokens and corpus:
            # keep existing ground_idea flags; add sourced-fact reminder
            fact_flag = f"Needs sourced fact URL: {title}"
            if fact_flag not in verify:
                verify.append(fact_flag)
    idea["verify"] = verify
    idea["needs_verification"] = bool(verify)
    return idea


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
        cleaned_description = transform(original_description)
        row["description"] = cleaned_description or "Needs verification."
        if row.get("title_en"):
            row["title_en"] = transform(str(row["title_en"])) or row["title_en"]
        if row.get("title_ru"):
            row["title_ru"] = transform(str(row["title_ru"])) or row["title_ru"]
        if row.get("description_en"):
            row["description_en"] = transform(str(row["description_en"])) or "Needs verification."
        if row.get("description_ru"):
            row["description_ru"] = transform(str(row["description_ru"])) or "Needs verification."
        stops.append(row)
    if stops:
        next_idea["itinerary"] = stops
    breakdown = dict(next_idea.get("breakdown") or {})
    if breakdown.get("notes"):
        breakdown["notes"] = strip_internal_ops(str(breakdown["notes"]))
        next_idea["breakdown"] = breakdown
    profitability = dict(next_idea.get("profitability") or {})
    if profitability.get("assumptions"):
        profitability["assumptions"] = strip_internal_ops(str(profitability["assumptions"]))
        next_idea["profitability"] = profitability
    return next_idea


def strip_idea_money_figures(idea: dict[str, Any]) -> dict[str, Any]:
    return _walk_text_fields(idea, strip_customer_ops_text)


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
    offers = [
        item
        for item in (research.get("market_offers") or [])
        if isinstance(item, dict) and str(item.get("url") or "").strip() and int(item.get("observed_price_amd") or 0) > 0
    ]
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
    verify = [str(item) for item in (next_idea.get("verify") or []) if str(item).strip()]
    if not has_offers and "No competitor data was found" not in " ".join(verify):
        verify.append("No competitor data was found")
    next_idea["verify"] = verify
    next_idea["needs_verification"] = bool(verify)
    return next_idea


def rewrite_copy_from_numbers(idea: dict[str, Any], research: dict[str, Any] | None = None) -> dict[str, Any]:
    next_idea = strip_idea_money_figures(idea)
    next_idea = sanitize_competitors(next_idea, research)
    next_idea = flag_thin_itinerary(next_idea, research)
    if _text(next_idea.get("description_hy")):
        next_idea["description_hy"] = strip_latin_sentences_from_hy(_text(next_idea.get("description_hy")))
    if _text(next_idea.get("title_hy")):
        next_idea["title_hy"] = strip_latin_sentences_from_hy(_text(next_idea.get("title_hy")))
    if not hy_copy_ok(next_idea):
        next_idea = mark_hy_review(next_idea)
    raw_price = next_idea.get("price")
    breakdown = dict(next_idea.get("breakdown") or {})
    prior_notes = str((idea.get("breakdown") or {}).get("notes") or "")
    if raw_price is None:
        breakdown["notes"] = (
            f"Estimated. Meals and entrance fees are not included. {PRICE_NEEDS_DISTANCE}."
        )
    elif prior_notes:
        breakdown["notes"] = strip_internal_ops(prior_notes) or (
            "Estimated. Meals and entrance fees are not included."
        )
    next_idea["breakdown"] = breakdown
    profitability = dict(next_idea.get("profitability") or {})
    if profitability:
        profitability["assumptions"] = breakdown.get("notes") or profitability.get("assumptions") or ""
        next_idea["profitability"] = profitability
    next_idea["notes"] = strip_customer_ops_text(_text(next_idea.get("notes")))
    return next_idea
