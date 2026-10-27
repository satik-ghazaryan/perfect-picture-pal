from __future__ import annotations

import json
import re
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError, as_completed
from datetime import datetime, timezone
from typing import Any, Callable

import os

from schemas import parse_amd

SEASON_LABELS = {
    "spring": "spring April May",
    "summer": "summer June July August",
    "autumn": "autumn September October",
    "winter": "winter December January",
}

PRICE_RE = re.compile(
    r"(\d[\d\s,]{2,8})\s*(?:amd|dram|֏|amd\.|դրամ)",
    re.IGNORECASE,
)
USD_PRICE_RE = re.compile(
    r"(?:from\s+)?(?:usd|us\$|\$)\s*(\d{2,4}(?:[.,]\d{1,2})?)|from\s+\$(\d{2,4})",
    re.IGNORECASE,
)
EUR_PRICE_RE = re.compile(
    r"€\s*(\d{2,4}(?:[.,]\d{1,2})?)|(\d{2,4}(?:[.,]\d{1,2})?)\s*(?:eur|euros?)",
    re.IGNORECASE,
)
DEFAULT_USD_TO_AMD = 400
DEFAULT_EUR_TO_AMD = 430
TOUR_TYPE_WORDS = {"hiking", "cultural", "extreme", "mixed"}
ARMENIA_MARKERS = {
    "armenia",
    "armenian",
    "հայաստան",
    "հայկական",
    "армения",
    "армян",
    "lori",
    "լոռի",
    "yerevan",
    "երևան",
    "ереван",
    "armavir",
    "արմավիր",
    "армавир",
    "dilijan",
    "դիլիջան",
    "дилижан",
    "sevan",
    "սևան",
    "севан",
    "tsaghkadzor",
    "ծաղկաձոր",
    "цахкадзор",
    "dsegh",
    "դսեղ",
    "tsover",
    "akhtala",
    "garni",
    "geghard",
    "tatev",
    "haghpat",
    "sanahin",
    "goris",
    "khor virap",
    "khorvirap",
    "gyumri",
    "ejmiatsin",
    "echmiadzin",
    "noravank",
    "jermuk",
    "debed",
    "tavush",
    "syunik",
    "gegharkunik",
    "kotayk",
    "aragatsotn",
    "shirak",
}
FOREIGN_MARKERS = (
    "texas",
    "dallas",
    "fort worth",
    "fortworth",
    "dfw",
    "florida",
    "india",
    "california",
    "colorado",
    "utah",
    "arizona",
    "nevada",
    "houston",
    "austin",
    "atlanta",
    "miami",
    "thailand",
    "philippines",
    "nepal",
    "peru",
    "patagonia",
    "scotland",
    "switzerland",
    "norway",
    "united kingdom",
    "great britain",
    "north texas",
)
ARMENIA_QUERY_TOKENS = (
    "armenia",
    "armenian",
    "lori",
    "yerevan",
    "armavir",
    "gyumri",
    "dilijan",
    "sevan",
    "vanadzor",
    "հայաստան",
    "երևան",
    "արմավիր",
    "լոռի",
    "գյումրի",
)
SEARCH_CALL_TIMEOUT_SEC = 18
REASON_CODES = (
    "tavily_no_key",
    "tavily_timeout",
    "tavily_error",
    "ddg_timeout",
    "ddg_error",
    "empty",
    "partial",
    "ok",
    "too_few_results",
)
GENERIC_WIKI_TITLES = {
    "autumn",
    "summer",
    "winter",
    "spring",
    "day",
    "armenia",
    "tour",
    "hiking",
}
MARKET_FALLBACK_QUERIES = (
    "Akhtala monastery day tour from Yerevan price",
    "Armenia one day tour Lori price AMD tripadvisor",
    "Armenia one day tour getyourguide viator price",
)
OPERATOR_SITE_QUERIES = (
    "onewaytour.com",
)
QUERY_NOISE = {
    "the",
    "and",
    "from",
    "with",
    "tour",
    "tours",
    "day",
    "one",
    "price",
    "amd",
    "group",
    "please",
    "a",
    "an",
    "of",
    "for",
    "in",
}


def _clip(text: str, limit: int = 420) -> str:
    compact = " ".join(str(text or "").split())
    if len(compact) <= limit:
        return compact
    return compact[: limit - 1].rstrip() + "…"


def _reason_from_exc(exc: BaseException, prefix: str) -> str:
    name = type(exc).__name__.lower()
    if "timeout" in name or "timedout" in name or "timed out" in str(exc).lower():
        return f"{prefix}_timeout"
    return f"{prefix}_error"


def _tavily_one(query: str, max_results: int) -> list[dict[str, str]]:
    api_key = os.getenv("TAVILY_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("tavily_no_key")
    from tavily import TavilyClient

    client = TavilyClient(api_key=api_key)
    try:
        payload = client.search(
            query,
            max_results=max_results,
            search_depth="basic",
            timeout=SEARCH_CALL_TIMEOUT_SEC,
            country="armenia",
            include_raw_content=True,
        )
    except TypeError:
        try:
            payload = client.search(
                query,
                max_results=max_results,
                search_depth="basic",
                timeout=SEARCH_CALL_TIMEOUT_SEC,
                country="armenia",
            )
        except TypeError:
            payload = client.search(query, max_results=max_results, search_depth="basic")
    rows: list[dict[str, str]] = []
    for item in payload.get("results") or []:
        if not isinstance(item, dict):
            continue
        content = item.get("raw_content") or item.get("content") or item.get("snippet") or ""
        rows.append(
            {
                "title": _clip(item.get("title") or "", 160),
                "url": str(item.get("url") or ""),
                "snippet": _clip(content, 1500),
                "query": query,
                "source": "tavily",
            }
        )
    return rows


def _ddg_one(query: str, max_results: int) -> list[dict[str, str]]:
    try:
        from ddgs import DDGS
    except ImportError:
        from duckduckgo_search import DDGS  # type: ignore[no-redef]

    rows: list[dict[str, str]] = []
    try:
        client_cm = DDGS(timeout=SEARCH_CALL_TIMEOUT_SEC)
    except TypeError:
        client_cm = DDGS()
    with client_cm as client:
        try:
            hits = client.text(query, max_results=max_results, region="am-en") or []
        except TypeError:
            hits = client.text(query, max_results=max_results) or []
        for item in hits:
            if not isinstance(item, dict):
                continue
            rows.append(
                {
                    "title": _clip(item.get("title") or "", 160),
                    "url": str(item.get("href") or item.get("url") or ""),
                    "snippet": _clip(item.get("body") or item.get("snippet") or ""),
                    "query": query,
                    "source": "duckduckgo",
                }
            )
    return rows


def place_keywords(inputs: dict[str, Any]) -> list[str]:
    found: list[str] = []
    for key in ("place_en", "region_en"):
        token = str(inputs.get(key) or "").strip()
        if token:
            found.append(token)
    extra = str(inputs.get("preferences") or "")
    bits = re.split(r"[\s,/|]+", extra)
    for bit in bits:
        token = re.sub(r"[^A-Za-z\u0531-\u0587-]", "", bit).strip()
        if len(token) < 4:
            continue
        if token.lower() in QUERY_NOISE or token.lower() in TOUR_TYPE_WORDS:
            continue
        found.append(token)
    keywords = list(dict.fromkeys(item for item in found if item))
    return keywords[:8]


def discovery_queries(place_en: str) -> list[str]:
    place = " ".join(str(place_en or "").split())
    if not place:
        return []
    queries = [
        f"{place} Armenia top attractions to visit",
        f"{place} Armenia things to see monastery museum",
        f"{place} Armenia day tour from Armavir",
    ]
    queries.extend(f"{place} Armenia site:{host}" for host in OPERATOR_SITE_QUERIES)
    scoped = [scope_query_to_armenia(item) for item in queries]
    return [item for item in scoped if query_is_armenia_scoped(item)][:8]


def build_queries(inputs: dict[str, Any]) -> list[str]:
    place_en = str(inputs.get("place_en") or "").strip()
    places = [place_en] if place_en else place_keywords(inputs)
    tour_type = str(inputs.get("tour_type") or "cultural").strip()
    if tour_type and tour_type.lower() not in TOUR_TYPE_WORDS:
        tour_type = "cultural"
    queries: list[str] = []
    if places:
        for place in places[:4]:
            queries.append(f"{place} Armenia day tour")
            queries.append(f"{place} attractions Armenia")
            queries.append(f"{place} day tour from Armavir price")
            queries.extend(f"{place} Armenia site:{host}" for host in OPERATOR_SITE_QUERIES)
        unique = list(dict.fromkeys(queries))
    else:
        queries.append(f"Armenia {tour_type or 'cultural'} day tour from Yerevan price")
        unique = list(dict.fromkeys(queries + list(MARKET_FALLBACK_QUERIES)))
    scoped = [scope_query_to_armenia(item) for item in unique]
    return [item for item in scoped if query_is_armenia_scoped(item)][:8]


def query_is_armenia_scoped(query: str) -> bool:
    blob = _norm_search_text(query)
    return any(token in blob for token in ARMENIA_QUERY_TOKENS)


def scope_query_to_armenia(query: str) -> str:
    text = " ".join(str(query or "").split())
    if query_is_armenia_scoped(text):
        return text
    return f"{text} Armenia".strip()


def _norm_search_text(*parts: str) -> str:
    blob = " ".join(str(part or "") for part in parts).lower()
    blob = blob.replace("&", " and ")
    blob = re.sub(r"[-_/.,]+", " ", blob)
    return " ".join(blob.split())


def _call_with_timeout(
    fn: Callable[[str, int], list[dict[str, str]]],
    query: str,
    max_results: int,
    prefix: str,
) -> tuple[list[dict[str, str]], str | None]:
    pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix=f"{prefix}-q")
    future = pool.submit(fn, query, max_results)
    try:
        return future.result(timeout=SEARCH_CALL_TIMEOUT_SEC), None
    except FuturesTimeoutError:
        future.cancel()
        return [], f"{prefix}_timeout"
    except RuntimeError as exc:
        if str(exc) == "tavily_no_key":
            return [], "tavily_no_key"
        return [], _reason_from_exc(exc, prefix)
    except Exception as exc:  # noqa: BLE001
        return [], _reason_from_exc(exc, prefix)
    finally:
        pool.shutdown(wait=False, cancel_futures=True)


def _search_all(
    queries: list[str],
    max_results: int,
    fn: Callable[[str, int], list[dict[str, str]]],
    prefix: str,
) -> tuple[list[dict[str, str]], list[str]]:
    rows: list[dict[str, str]] = []
    reasons: list[str] = []
    workers = min(5, len(queries) or 1)
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(_call_with_timeout, fn, query, max_results, prefix) for query in queries]
        for future in as_completed(futures):
            try:
                part, reason = future.result(timeout=SEARCH_CALL_TIMEOUT_SEC + 2)
            except Exception as exc:  # noqa: BLE001
                reasons.append(_reason_from_exc(exc, prefix))
                continue
            rows.extend(part)
            if reason:
                reasons.append(reason)
    return rows, reasons


def _kind_for(row: dict[str, str]) -> str:
    blob = f"{row.get('title', '')} {row.get('snippet', '')} {row.get('query', '')}".lower()
    if "armavir" in blob or "արմավիր" in blob or "price" in blob or "tour" in blob:
        return "market_reference"
    return "place"


def _env_rate(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    if raw.isdigit():
        value = int(raw)
        if value > 0:
            return value
    return default


def conversion_rate(currency: str) -> tuple[int, bool]:
    code = currency.upper()
    if code == "AMD":
        return 1, False
    if code == "USD":
        return _env_rate("USD_TO_AMD", DEFAULT_USD_TO_AMD), True
    if code == "EUR":
        return _env_rate("EUR_TO_AMD", DEFAULT_EUR_TO_AMD), True
    return 0, True


def _first_amount(match: re.Match[str] | None) -> float:
    if not match:
        return 0.0
    for group in match.groups():
        if group:
            return float(str(group).replace(",", "").replace(" ", ""))
    return 0.0


def extract_offer(text: str) -> dict[str, Any]:
    blob = text or ""
    amd_matches = [parse_amd(item) for item in PRICE_RE.findall(blob)]
    amd_usable = [item for item in amd_matches if 2000 <= item <= 200_000]
    if amd_usable:
        return {
            "observed_amount": amd_usable[0],
            "observed_currency": "AMD",
            "observed_price_amd": amd_usable[0],
            "conversion_rate": 1,
            "conversion_estimated": False,
        }
    usd = _first_amount(USD_PRICE_RE.search(blob))
    if 15 <= usd <= 500:
        rate, estimated = conversion_rate("USD")
        amd = int(round(usd * rate))
        if 2000 <= amd <= 200_000:
            return {
                "observed_amount": usd,
                "observed_currency": "USD",
                "observed_price_amd": amd,
                "conversion_rate": rate,
                "conversion_estimated": estimated,
            }
    eur = _first_amount(EUR_PRICE_RE.search(blob))
    if 15 <= eur <= 500:
        rate, estimated = conversion_rate("EUR")
        amd = int(round(eur * rate))
        if 2000 <= amd <= 200_000:
            return {
                "observed_amount": eur,
                "observed_currency": "EUR",
                "observed_price_amd": amd,
                "conversion_rate": rate,
                "conversion_estimated": estimated,
            }
    return {
        "observed_amount": 0,
        "observed_currency": "",
        "observed_price_amd": 0,
        "conversion_rate": 0,
        "conversion_estimated": False,
    }


def extract_offer_price(text: str) -> int:
    return int(extract_offer(text).get("observed_price_amd") or 0)


def market_offers_from_results(results: list[dict[str, str]], found_on: str) -> list[dict[str, Any]]:
    offers: list[dict[str, Any]] = []
    seen: set[str] = set()
    for row in results:
        url = str(row.get("url") or "").strip()
        title = str(row.get("title") or "").strip()
        key = url or title
        if not key or key in seen:
            continue
        seen.add(key)
        blob = f"{title} {row.get('snippet') or ''}"
        parsed = extract_offer(blob)
        if int(parsed.get("observed_price_amd") or 0) <= 0:
            continue
        offers.append(
            {
                "title": title[:240],
                "url": url,
                "observed_price_amd": int(parsed["observed_price_amd"]),
                "observed_amount": parsed.get("observed_amount") or 0,
                "observed_currency": str(parsed.get("observed_currency") or ""),
                "conversion_rate": int(parsed.get("conversion_rate") or 0),
                "conversion_estimated": bool(parsed.get("conversion_estimated")),
                "found_on": found_on,
                "label": "market_reference",
                "snippet": str(row.get("snippet") or "")[:240],
            }
        )
    return offers


def result_is_useful(row: dict[str, str], keywords: list[str] | None = None) -> bool:
    title = str(row.get("title") or "").strip()
    url = str(row.get("url") or "")
    snippet = str(row.get("snippet") or "")
    blob = _norm_search_text(title, snippet, url)
    tokens = set(blob.split())
    title_key = re.sub(r"[^a-z]+", " ", title.lower()).strip()
    if "wikipedia" in url.lower() and title_key in GENERIC_WIKI_TITLES:
        return False
    if title_key in GENERIC_WIKI_TITLES:
        return False
    if any(marker in blob for marker in FOREIGN_MARKERS) or "tx" in tokens:
        return False
    places = [
        _norm_search_text(item)
        for item in (keywords or [])
        if len(item) >= 4 and item.lower() not in QUERY_NOISE and item.lower() not in TOUR_TYPE_WORDS
    ]
    has_armenia = any(marker in blob for marker in ARMENIA_MARKERS) or any(place and place in blob for place in places)
    if not has_armenia:
        return False
    if "wikipedia.org" in url.lower() and "armenia" not in blob and "armenian" not in blob:
        return False
    return True


def _tavily_key_present() -> bool:
    return bool(os.getenv("TAVILY_API_KEY", "").strip())


def _provider_flag(rows: list[dict[str, str]], reasons: list[str], prefix: str, ran: bool) -> str:
    if not ran:
        return "skipped"
    if f"{prefix}_no_key" in reasons:
        return "no_key"
    if rows and reasons:
        return "partial"
    if rows:
        return "ok"
    if f"{prefix}_timeout" in reasons:
        return "timeout"
    if f"{prefix}_error" in reasons:
        return "error"
    return "empty"


def _pick_status(results: list[dict[str, str]], reasons: list[str]) -> str:
    unique_reasons = list(dict.fromkeys(item for item in reasons if item in REASON_CODES or item.endswith("_timeout") or item.endswith("_error") or item.endswith("_no_key")))
    if results and unique_reasons:
        return "partial"
    if results:
        return "ok"
    if "tavily_no_key" in unique_reasons and not any(item.startswith("ddg_") for item in unique_reasons):
        return "tavily_no_key"
    for code in ("tavily_timeout", "ddg_timeout", "tavily_error", "ddg_error", "tavily_no_key"):
        if code in unique_reasons:
            return code
    if "too_few_results" in unique_reasons:
        return "too_few_results"
    return "empty"


def run_queries_search(
    queries: list[str],
    keywords: list[str] | None = None,
    max_results: int = 5,
    *,
    require_min_unique: bool = True,
) -> dict[str, Any]:
    found_on = datetime.now(timezone.utc).date().isoformat()
    tavily_ran = True
    tavily_rows, tavily_reasons = _search_all(queries, max_results, _tavily_one, "tavily")
    useful_tavily = [row for row in tavily_rows if result_is_useful(row, keywords)]
    ddg_rows: list[dict[str, str]] = []
    ddg_reasons: list[str] = []
    ddg_ran = False
    if not useful_tavily or tavily_reasons or len(useful_tavily) < 2:
        ddg_ran = True
        ddg_rows, ddg_reasons = _search_all(queries, max_results, _ddg_one, "ddg")
    results = tavily_rows + ddg_rows
    reasons = tavily_reasons + ddg_reasons
    unique: list[dict[str, str]] = []
    seen: set[str] = set()
    for row in results:
        if not result_is_useful(row, keywords):
            continue
        key = row.get("url") or row.get("title") or json.dumps(row, ensure_ascii=False)
        if key in seen:
            continue
        seen.add(key)
        tagged = dict(row)
        tagged["kind"] = _kind_for(tagged)
        unique.append(tagged)
        if len(unique) >= 12:
            break
    if require_min_unique and len(unique) < 2:
        unique = []
        if "too_few_results" not in reasons:
            reasons.append("too_few_results")
    offers = market_offers_from_results(unique, found_on)
    tavily_status = _provider_flag(useful_tavily, tavily_reasons, "tavily", tavily_ran)
    ddg_status = _provider_flag(
        [row for row in ddg_rows if result_is_useful(row, keywords)],
        ddg_reasons,
        "ddg",
        ddg_ran,
    )
    if useful_tavily and ddg_rows:
        provider = "tavily+duckduckgo"
    elif useful_tavily:
        provider = "tavily"
    elif ddg_rows and unique:
        provider = "duckduckgo"
    else:
        provider = "none"
    status = _pick_status(unique, reasons)
    return {
        "provider": provider,
        "queries": queries,
        "results": unique,
        "market_offers": offers,
        "retrieved_at": found_on,
        "disclaimer": (
            "Web snippets are market reference only. Prices, dates, and availability "
            "are not verified booking conditions and need verification."
        ),
        "error": "" if status == "ok" else status,
        "search_status": status,
        "live": bool(unique),
        "tavily_key_present": _tavily_key_present(),
        "useful_result_count": len(unique),
        "provider_status": {
            "tavily": tavily_status,
            "ddg": ddg_status,
            "tavily_key_present": _tavily_key_present(),
        },
    }


def run_market_search(inputs: dict[str, Any], max_results: int = 5) -> dict[str, Any]:
    queries = build_queries(inputs)
    keywords = place_keywords(inputs)
    return run_queries_search(queries, keywords, max_results)


def run_place_attraction_search(place_en: str, max_results: int = 5) -> dict[str, Any]:
    queries = discovery_queries(place_en)
    keywords = [place_en] if place_en else []
    return run_queries_search(queries, keywords, max_results, require_min_unique=False)


KM_IN_TEXT_RE = re.compile(r"\b\d+(?:[.,]\d+)?\s*km\b", re.IGNORECASE)
DISTANCE_BOILERPLATE = (
    "distance calculator",
    "calculating mileage",
    "helps in calculating",
    "enter location",
    "calculate the distance",
)


def usable_web_distance_snippet(snippet: str, place_en: str, origin: str = "Armavir") -> str:
    text = " ".join(str(snippet or "").split())
    if not text:
        return ""
    lowered = text.lower()
    if any(item in lowered for item in DISTANCE_BOILERPLATE):
        return ""
    if not KM_IN_TEXT_RE.search(text):
        return ""
    place = " ".join(str(place_en or "").split()).lower()
    start = " ".join(str(origin or "Armavir").split()).lower()
    if not place or start not in lowered or place not in lowered:
        return ""
    note = f"Web distance cross-check (not used for price): {text}"
    return note[:120]


def distance_cross_check_snippet(place_en: str) -> str:
    place = " ".join(str(place_en or "").split())
    if not place:
        return ""
    query = scope_query_to_armenia(f"distance Armavir to {place} km")
    rows, _reasons = _search_all([query], 3, _tavily_one, "tavily")
    if not rows:
        rows, _reasons = _search_all([query], 3, _ddg_one, "ddg")
    for row in rows:
        snippet = str(row.get("snippet") or row.get("title") or "")
        usable = usable_web_distance_snippet(snippet, place)
        if usable:
            return usable
    return ""
