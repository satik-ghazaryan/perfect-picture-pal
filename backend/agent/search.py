from __future__ import annotations

import json
import re
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError, as_completed
from datetime import datetime, timezone
from typing import Any, Callable

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
REGION_WORDS = (
    "lori",
    "tavush",
    "syunik",
    "gegharkunik",
    "kotayk",
    "aragatsotn",
    "shirak",
    "vayots",
    "armavir",
    "yerevan",
    "dsegh",
    "tsover",
    "akhtala",
    "garni",
    "geghard",
    "sevan",
    "dilijan",
    "tatev",
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
    import os

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
        )
    except TypeError:
        payload = client.search(query, max_results=max_results, search_depth="basic")
    rows: list[dict[str, str]] = []
    for item in payload.get("results") or []:
        if not isinstance(item, dict):
            continue
        rows.append(
            {
                "title": _clip(item.get("title") or "", 160),
                "url": str(item.get("url") or ""),
                "snippet": _clip(item.get("content") or item.get("snippet") or ""),
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
        for item in client.text(query, max_results=max_results) or []:
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
    extra = str(inputs.get("preferences") or "")
    tour_type = str(inputs.get("tour_type") or "").strip()
    bits = re.split(r"[\s,/|]+", extra)
    found: list[str] = []
    for bit in bits:
        token = re.sub(r"[^A-Za-z\u0531-\u0587-]", "", bit).strip()
        if len(token) < 4:
            continue
        if token.lower() in QUERY_NOISE:
            continue
        found.append(token)
    keywords = list(dict.fromkeys(found))
    if tour_type and tour_type.lower() not in {item.lower() for item in keywords}:
        keywords.append(tour_type)
    return keywords[:8]


def build_queries(inputs: dict[str, Any]) -> list[str]:
    places = place_keywords(inputs)
    region = next((item for item in places if item.lower() in REGION_WORDS), "")
    queries: list[str] = []
    for place in places[:4]:
        loc = f"{place} {region}".strip() if region and place.lower() != region.lower() else place
        queries.append(f"{loc} Armenia tour")
        queries.append(f"{place} Lori Armenia" if not region else f"{place} {region} Armenia")
    if not queries:
        tour_type = str(inputs.get("tour_type") or "cultural")
        queries.append(f"Armenia {tour_type} day tour from Yerevan price")
    market = [
        "Akhtala monastery day tour from Yerevan price",
        "Armenia one day tour Lori price AMD tripadvisor",
        "Armenia one day tour getyourguide viator price",
    ]
    unique = list(dict.fromkeys(queries[:5] + market))
    return unique[:8]


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


def extract_offer_price(text: str) -> int:
    matches = PRICE_RE.findall(text or "")
    amounts = [parse_amd(item) for item in matches]
    usable = [item for item in amounts if 2000 <= item <= 200_000]
    return usable[0] if usable else 0


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
        offers.append(
            {
                "title": title[:240],
                "url": url,
                "observed_price_amd": extract_offer_price(blob),
                "found_on": found_on,
                "label": "market_reference",
                "snippet": str(row.get("snippet") or "")[:240],
            }
        )
    return offers


def result_is_useful(row: dict[str, str], keywords: list[str]) -> bool:
    title = str(row.get("title") or "").strip()
    url = str(row.get("url") or "").lower()
    snippet = str(row.get("snippet") or "")
    blob = f"{title} {snippet} {url}".lower()
    title_key = re.sub(r"[^a-z]+", " ", title.lower()).strip()
    if "wikipedia" in url and (title_key in GENERIC_WIKI_TITLES or title_key.split(" ")[0:1] == [title_key] and title_key in GENERIC_WIKI_TITLES):
        return False
    if title_key in GENERIC_WIKI_TITLES:
        return False
    has_armenia = "armenia" in blob or "հայաստան" in blob or "armenian" in blob
    keys = [item.lower() for item in keywords if len(item) >= 4 and item.lower() not in QUERY_NOISE]
    has_place = any(key in blob for key in keys)
    if not has_armenia and not has_place:
        return False
    if "wikipedia.org" in url and not has_place:
        return False
    return True


def _tavily_key_present() -> bool:
    import os

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


def run_market_search(inputs: dict[str, Any], max_results: int = 5) -> dict[str, Any]:
    queries = build_queries(inputs)
    keywords = place_keywords(inputs)
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
    if len(unique) < 2:
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
