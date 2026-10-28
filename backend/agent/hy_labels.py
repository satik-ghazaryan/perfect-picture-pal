from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

ARMENIAN_RE = re.compile(r"[\u0531-\u0587]")
ACTIVITY_HY = {
    "departure": "մեկնում",
    "depart": "մեկնում",
    "arrival": "ժամանում",
    "arrive": "ժամանում",
    "visit": "այց",
    "visiting": "այց",
    "return": "վերադարձ",
    "returning": "վերադարձ",
    "lunch": "ճաշ",
    "meal": "ճաշ",
    "explore": "այց",
    "exploration": "այց",
}
ARMAVIR_HY = "Արմավիր"
LUNCH_TITLE_HY = "Ճաշի ընդմիջում"
CACHE_TTL_SEC = 24 * 60 * 60
_DISK_PATH = Path(
    os.getenv("ARI_HY_LABEL_CACHE", str(Path(__file__).resolve().parent.parent / ".hy_label_cache.json"))
)
_MEM: dict[str, tuple[float, str]] = {}


def clear_hy_label_cache() -> None:
    _MEM.clear()


def _cache_get(key: str) -> str | None:
    now = time.time()
    row = _MEM.get(key)
    if row and now - row[0] <= CACHE_TTL_SEC:
        return row[1]
    try:
        raw = json.loads(_DISK_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, TypeError):
        return None
    if not isinstance(raw, dict):
        return None
    item = raw.get(key)
    if not isinstance(item, dict):
        return None
    stamped = float(item.get("ts") or 0)
    value = str(item.get("value") or "")
    if now - stamped > CACHE_TTL_SEC or not value:
        return None
    _MEM[key] = (stamped, value)
    return value


def _cache_set(key: str, value: str) -> None:
    if not value:
        return
    now = time.time()
    _MEM[key] = (now, value)
    try:
        raw: dict[str, Any] = {}
        if _DISK_PATH.exists():
            loaded = json.loads(_DISK_PATH.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                raw = loaded
        raw[key] = {"ts": now, "value": value}
        _DISK_PATH.write_text(json.dumps(raw, ensure_ascii=False), encoding="utf-8")
    except OSError:
        return


def _wiki_title(name: str, wiki_url: str = "") -> str:
    if wiki_url:
        path = unquote(urlparse(wiki_url).path or "")
        slug = path.rsplit("/", 1)[-1].replace("_", " ")
        if slug:
            return slug
    return " ".join(str(name or "").split())


def _langlinks_hy(titles: list[str]) -> dict[str, str]:
    if not titles:
        return {}
    try:
        import httpx
    except ImportError:
        return {}
    params = {
        "action": "query",
        "titles": "|".join(titles[:20]),
        "prop": "langlinks",
        "lllang": "hy",
        "format": "json",
        "redirects": "1",
    }
    try:
        with httpx.Client(timeout=8.0, headers={"user-agent": "AriGnank/1.0 (tour planner; https://arignank.example)"}) as client:
            response = client.get("https://en.wikipedia.org/w/api.php", params=params)
        if response.status_code >= 400:
            return {}
        payload = response.json()
    except Exception:  # noqa: BLE001
        return {}
    pages = ((payload.get("query") or {}).get("pages") or {}) if isinstance(payload, dict) else {}
    out: dict[str, str] = {}
    for page in pages.values() if isinstance(pages, dict) else []:
        if not isinstance(page, dict):
            continue
        title = str(page.get("title") or "")
        links = page.get("langlinks") or []
        hy = ""
        for link in links:
            if isinstance(link, dict) and str(link.get("lang") or "") == "hy":
                hy = str(link.get("title") or link.get("*") or "").strip()
                break
        if title and hy and ARMENIAN_RE.search(hy):
            out[title] = hy
    return out


def _hywiki_search(title: str) -> str:
    query = " ".join(str(title or "").split())
    if not query:
        return ""
    try:
        import httpx
    except ImportError:
        return ""
    params = {
        "action": "query",
        "list": "search",
        "srsearch": query,
        "srlimit": "1",
        "format": "json",
    }
    try:
        with httpx.Client(timeout=8.0, headers={"user-agent": "AriGnank/1.0 (tour planner; https://arignank.example)"}) as client:
            response = client.get("https://hy.wikipedia.org/w/api.php", params=params)
        if response.status_code >= 400:
            return ""
        payload = response.json()
    except Exception:  # noqa: BLE001
        return ""
    hits = ((payload.get("query") or {}).get("search") or []) if isinstance(payload, dict) else []
    if not hits or not isinstance(hits[0], dict):
        return ""
    value = str(hits[0].get("title") or "").strip()
    return value if value and ARMENIAN_RE.search(value) else ""


def _wikidata_hy(title: str) -> str:
    try:
        import httpx
    except ImportError:
        return ""
    params = {
        "action": "wbgetentities",
        "sites": "enwiki",
        "titles": title,
        "props": "labels",
        "languages": "hy",
        "format": "json",
    }
    try:
        with httpx.Client(timeout=8.0, headers={"user-agent": "AriGnank/1.0 (tour planner; https://arignank.example)"}) as client:
            response = client.get("https://www.wikidata.org/w/api.php", params=params)
        if response.status_code >= 400:
            return ""
        payload = response.json()
    except Exception:  # noqa: BLE001
        return ""
    entities = payload.get("entities") if isinstance(payload, dict) else {}
    if not isinstance(entities, dict):
        return ""
    for entity in entities.values():
        if not isinstance(entity, dict):
            continue
        labels = entity.get("labels") if isinstance(entity.get("labels"), dict) else {}
        hy = labels.get("hy") if isinstance(labels, dict) else None
        if isinstance(hy, dict):
            value = str(hy.get("value") or "").strip()
            if ARMENIAN_RE.search(value):
                return value
    return ""


def armenian_place_label(name_en: str, wiki_url: str = "") -> str:
    name = " ".join(str(name_en or "").split())
    if not name:
        return ""
    if ARMENIAN_RE.search(name):
        return name
    cached = _cache_get(name.lower())
    if cached:
        return cached
    title = _wiki_title(name, wiki_url)
    mapped = _langlinks_hy([title]).get(title) or ""
    if not mapped:
        mapped = _wikidata_hy(title)
    if not mapped:
        mapped = _hywiki_search(title)
    if mapped:
        _cache_set(name.lower(), mapped)
        return mapped
    return ""


def hy_labels_for_candidates(candidates: list[dict[str, Any]]) -> dict[str, str]:
    pending: list[tuple[str, str]] = []
    out: dict[str, str] = {}
    for row in candidates or []:
        if not isinstance(row, dict):
            continue
        name = str(row.get("name_en") or "").strip()
        if not name:
            continue
        existing = str(row.get("name_hy") or "").strip()
        if existing and ARMENIAN_RE.search(existing):
            out[name] = existing
            continue
        cached = _cache_get(name.lower())
        if cached:
            out[name] = cached
            row["name_hy"] = cached
            continue
        pending.append((name, str(row.get("wiki_url") or row.get("source_url") or "")))
    titles = [_wiki_title(name, url) for name, url in pending]
    linked = _langlinks_hy([title for title in titles if title])
    for name, url in pending:
        title = _wiki_title(name, url)
        label = linked.get(title) or ""
        if not label:
            label = _wikidata_hy(title)
        if not label:
            label = _hywiki_search(title)
        if label:
            out[name] = label
            _cache_set(name.lower(), label)
    for row in candidates or []:
        if not isinstance(row, dict):
            continue
        name = str(row.get("name_en") or "").strip()
        if name in out:
            row["name_hy"] = out[name]
    return out


def activity_hy(activity: str) -> str:
    text = str(activity or "").strip().lower()
    if not text:
        return "այց"
    head = text.split()[0].strip(".,;!")
    return ACTIVITY_HY.get(head) or ACTIVITY_HY.get(text) or (activity if ARMENIAN_RE.search(activity) else "այց")


def fallback_title_hy(
    stop: dict[str, Any],
    labels: dict[str, str] | None = None,
) -> dict[str, Any]:
    from agent.distance import is_armavir_stop, is_lunch_or_rest_stop, stop_activity, stop_place_name

    row = dict(stop)
    labels = labels or {}
    current = str(row.get("title_hy") or "").strip()
    if current and ARMENIAN_RE.search(current) and "—" in current:
        if not str(row.get("activity_hy") or "").strip():
            row["activity_hy"] = activity_hy(stop_activity(row))
        return row
    if is_lunch_or_rest_stop(row):
        row["title_hy"] = LUNCH_TITLE_HY
        row["activity_hy"] = "ճաշ"
        return row
    place = stop_place_name(row)
    activity = stop_activity(row) or str(row.get("activity") or "visit")
    act = activity_hy(activity)
    row["activity_hy"] = act
    if is_armavir_stop(place or str(row.get("title_en") or row.get("title") or "")):
        place_hy = ARMAVIR_HY
    else:
        place_hy = labels.get(place) or place or "Կանգառ"
    row["title_hy"] = f"{place_hy} — {act}"
    return row
