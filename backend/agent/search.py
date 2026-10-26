from __future__ import annotations

import json
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Any

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


def _clip(text: str, limit: int = 420) -> str:
    compact = " ".join(str(text or "").split())
    if len(compact) <= limit:
        return compact
    return compact[: limit - 1].rstrip() + "…"


def _tavily_one(query: str, max_results: int) -> list[dict[str, str]]:
    import os

    api_key = os.getenv("TAVILY_API_KEY", "").strip()
    if not api_key:
        return []
    from tavily import TavilyClient

    client = TavilyClient(api_key=api_key)
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
    with DDGS() as client:
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


def _search_all(queries: list[str], max_results: int, fn) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    with ThreadPoolExecutor(max_workers=min(5, len(queries) or 1)) as pool:
        futures = [pool.submit(fn, query, max_results) for query in queries]
        for future in as_completed(futures):
            try:
                rows.extend(future.result())
            except Exception:  # noqa: BLE001
                continue
    return rows


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


def run_market_search(inputs: dict[str, Any], max_results: int = 5) -> dict[str, Any]:
    queries = build_queries(inputs)
    found_on = datetime.now(timezone.utc).date().isoformat()
    results: list[dict[str, str]] = []
    provider = "none"
    error = ""
    try:
        results = _search_all(queries, max_results, _tavily_one)
        if results:
            provider = "tavily"
    except Exception as exc:  # noqa: BLE001
        error = str(exc)
    if not results:
        try:
            results = _search_all(queries, max_results, _ddg_one)
            if results:
                provider = "duckduckgo"
                error = ""
        except Exception as exc:  # noqa: BLE001
            error = f"{error}; {exc}".strip("; ")
    unique: list[dict[str, str]] = []
    seen: set[str] = set()
    for row in results:
        key = row.get("url") or row.get("title") or json.dumps(row, ensure_ascii=False)
        if key in seen:
            continue
        seen.add(key)
        row = dict(row)
        row["kind"] = _kind_for(row)
        unique.append(row)
        if len(unique) >= 12:
            break
    offers = market_offers_from_results(unique, found_on)
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
        "error": error,
        "live": bool(unique),
    }
