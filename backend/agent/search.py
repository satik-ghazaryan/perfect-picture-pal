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
)


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


def build_queries(inputs: dict[str, Any]) -> list[str]:
    season = str(inputs.get("season") or "summer")
    season_words = SEASON_LABELS.get(season, season)
    tour_type = str(inputs.get("tour_type") or "cultural")
    extra = str(inputs.get("preferences") or "").strip()
    queries = [
        "day tours departing from Armavir Armenia price itinerary",
        "Armavir Armenia one day tour advertised 2026",
        f"{season_words} one day group tours Armenia price AMD",
        f"Armenia {tour_type} day tour from Armavir or Yerevan price dram",
    ]
    if extra:
        queries.append(f"{extra} day tour Armavir Armenia price")
    return queries[:5]


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
    return "empty"


def run_market_search(inputs: dict[str, Any], max_results: int = 5) -> dict[str, Any]:
    queries = build_queries(inputs)
    found_on = datetime.now(timezone.utc).date().isoformat()
    tavily_rows, tavily_reasons = _search_all(queries, max_results, _tavily_one, "tavily")
    ddg_rows: list[dict[str, str]] = []
    ddg_reasons: list[str] = []
    if not tavily_rows or tavily_reasons:
        ddg_rows, ddg_reasons = _search_all(queries, max_results, _ddg_one, "ddg")
    results = tavily_rows + ddg_rows
    reasons = tavily_reasons + ddg_reasons
    unique: list[dict[str, str]] = []
    seen: set[str] = set()
    for row in results:
        key = row.get("url") or row.get("title") or json.dumps(row, ensure_ascii=False)
        if key in seen:
            continue
        seen.add(key)
        tagged = dict(row)
        tagged["kind"] = _kind_for(tagged)
        unique.append(tagged)
        if len(unique) >= 12:
            break
    offers = market_offers_from_results(unique, found_on)
    if tavily_rows and not ddg_rows:
        provider = "tavily"
    elif ddg_rows and not tavily_rows:
        provider = "duckduckgo"
    elif tavily_rows and ddg_rows:
        provider = "tavily+duckduckgo"
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
    }
