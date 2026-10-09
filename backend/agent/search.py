from __future__ import annotations

import json
from typing import Any

SEASON_LABELS = {
    "spring": "spring April May",
    "summer": "summer June July August",
    "autumn": "autumn September October",
    "winter": "winter December January",
}


def _clip(text: str, limit: int = 420) -> str:
    compact = " ".join(str(text or "").split())
    if len(compact) <= limit:
        return compact
    return compact[: limit - 1].rstrip() + "…"


def _tavily_search(queries: list[str], max_results: int) -> list[dict[str, str]]:
    import os

    api_key = os.getenv("TAVILY_API_KEY", "").strip()
    if not api_key:
        return []
    from tavily import TavilyClient

    client = TavilyClient(api_key=api_key)
    rows: list[dict[str, str]] = []
    for query in queries:
        payload = client.search(query, max_results=max_results, search_depth="basic")
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


def _ddg_search(queries: list[str], max_results: int) -> list[dict[str, str]]:
    try:
        from ddgs import DDGS
    except ImportError:
        from duckduckgo_search import DDGS  # type: ignore[no-redef]

    rows: list[dict[str, str]] = []
    with DDGS() as client:
        for query in queries:
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
        f"{season_words} day tours from Yerevan Armenia price AMD",
        "one day group tours from Armavir Armenia",
        f"Yerevan Armenia {tour_type} day tour price dram",
        "Armenia Garni Geghard Khor Virap tour price AMD",
    ]
    if extra:
        queries.append(f"{extra} tour Armenia Yerevan Armavir price")
    return queries[:5]


def run_market_search(inputs: dict[str, Any], max_results: int = 5) -> dict[str, Any]:
    queries = build_queries(inputs)
    results: list[dict[str, str]] = []
    provider = "none"
    error = ""
    try:
        results = _tavily_search(queries, max_results)
        if results:
            provider = "tavily"
    except Exception as exc:  # noqa: BLE001 — search must never crash the graph
        error = str(exc)
    if not results:
        try:
            results = _ddg_search(queries, max_results)
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
        unique.append(row)
        if len(unique) >= 12:
            break
    return {
        "provider": provider,
        "queries": queries,
        "results": unique,
        "disclaimer": (
            "Web snippets are market observations only. Prices, dates, and availability "
            "are not verified booking conditions and need verification."
        ),
        "error": error,
        "live": bool(unique),
    }
