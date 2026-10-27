from __future__ import annotations

import os
import re
import threading
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import httpx

from agent.distance import armavir_distance_km, is_nominatim_region, nominatim_coord, nominatim_lookup

USER_AGENT = "AriGnank/1.0 (tour planner; https://arignank.example)"
OVERPASS_ENDPOINTS = (
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
)
OVERPASS_QUERY_TIMEOUT_SEC = 15
OVERPASS_BUDGET_SEC = 25.0
OVERPASS_ATTEMPTS = 2
OVERPASS_BACKOFF_SEC = 1.5
WIKI_TIMEOUT_SEC = 12.0
WIKI_API = "https://en.wikipedia.org/w/api.php"
CANDIDATE_CAP = 15
REGION_CANDIDATE_CAP = 20
WIKI_GEO_RADIUS_M = 10_000
CACHE_TTL_SEC = 24 * 60 * 60
PLACE_DATA_UNAVAILABLE = "Place data sources unavailable"
SIGHT_WORDS = (
    "monastery",
    "church",
    "fortress",
    "museum",
    "park",
    "waterfall",
    "lake",
    "castle",
    "bridge",
    "cave",
    "cathedral",
    "fort",
    "chapel",
)
TOURISM_TYPES = {"attraction", "museum", "viewpoint"}
HISTORIC_TYPES = {"monastery", "church", "castle", "fort", "ruins", "monument", "archaeological_site"}

_CACHE: dict[str, tuple[float, Any]] = {}
_CACHE_LOCK = threading.Lock()


def clear_place_cache() -> None:
    with _CACHE_LOCK:
        _CACHE.clear()


def _cache_get(key: str) -> Any | None:
    with _CACHE_LOCK:
        row = _CACHE.get(key)
        if not row:
            return None
        stamped, value = row
        if time.time() - stamped > CACHE_TTL_SEC:
            _CACHE.pop(key, None)
            return None
        return value


def _cache_set(key: str, value: Any) -> None:
    with _CACHE_LOCK:
        _CACHE[key] = (time.time(), value)


def _norm_name(name: str) -> str:
    return " ".join(str(name or "").lower().replace("—", " ").replace("-", " ").split())


def _element_lat_lon(element: dict[str, Any]) -> tuple[float, float] | None:
    if "lat" in element and "lon" in element:
        try:
            return float(element["lat"]), float(element["lon"])
        except (TypeError, ValueError):
            return None
    center = element.get("center")
    if isinstance(center, dict):
        try:
            return float(center["lat"]), float(center["lon"])
        except (TypeError, ValueError, KeyError):
            return None
    return None


def _element_name(tags: dict[str, Any]) -> str:
    for key in ("name:en", "name:en-US", "name"):
        value = str(tags.get(key) or "").strip()
        if value:
            return value
    return ""


def _element_type(tags: dict[str, Any]) -> str:
    historic = str(tags.get("historic") or "").strip()
    if historic in HISTORIC_TYPES:
        return historic
    tourism = str(tags.get("tourism") or "").strip()
    if tourism in TOURISM_TYPES:
        return tourism
    if str(tags.get("amenity") or "") == "place_of_worship":
        return "place_of_worship"
    return "attraction"


def osm_url(element: dict[str, Any]) -> str:
    kind = str(element.get("type") or "node")
    if kind not in {"node", "way", "relation"}:
        kind = "node"
    ident = element.get("id")
    if ident is None:
        return ""
    return f"https://www.openstreetmap.org/{kind}/{ident}"


def parse_overpass_elements(payload: Any, *, cap: int = CANDIDATE_CAP) -> list[dict[str, Any]]:
    if isinstance(payload, dict):
        rows = payload.get("elements") or []
    elif isinstance(payload, list):
        rows = payload
    else:
        rows = []
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for element in rows:
        if not isinstance(element, dict):
            continue
        tags = element.get("tags") if isinstance(element.get("tags"), dict) else {}
        name = _element_name(tags)
        if not name:
            continue
        key = _norm_name(name)
        if key in seen:
            continue
        coord = _element_lat_lon(element)
        if coord is None:
            continue
        seen.add(key)
        url = osm_url(element)
        out.append(
            {
                "name_en": name,
                "type": _element_type(tags),
                "lat": round(coord[0], 6),
                "lon": round(coord[1], 6),
                "source_url": url,
                "osm_url": url,
                "wiki_url": "",
                "description": "",
                "coord_source": "OSM",
                "source": "overpass",
            }
        )
        if len(out) >= cap:
            break
    return out


def overpass_query(lat: float, lon: float, radius_m: int) -> str:
    return (
        f"[out:json][timeout:{OVERPASS_QUERY_TIMEOUT_SEC}];\n"
        "(\n"
        f'  nwr(around:{int(radius_m)},{lat:.6f},{lon:.6f})["tourism"~"attraction|museum|viewpoint"];\n'
        f'  nwr(around:{int(radius_m)},{lat:.6f},{lon:.6f})["historic"~"monastery|church|castle|fort|ruins|monument|archaeological_site"];\n'
        f'  nwr(around:{int(radius_m)},{lat:.6f},{lon:.6f})["amenity"="place_of_worship"]["name"];\n'
        ");\n"
        "out center 40;\n"
    )


def overpass_bbox_query(south: float, west: float, north: float, east: float) -> str:
    box = f"{south:.6f},{west:.6f},{north:.6f},{east:.6f}"
    return (
        f"[out:json][timeout:{OVERPASS_QUERY_TIMEOUT_SEC}];\n"
        "(\n"
        f'  nwr({box})["tourism"~"attraction|museum|viewpoint"];\n'
        f'  nwr({box})["historic"~"monastery|church|castle|fort|ruins|monument|archaeological_site"];\n'
        f'  nwr({box})["amenity"="place_of_worship"]["name"];\n'
        ");\n"
        "out center 40;\n"
    )


def region_sample_points(bbox: tuple[float, float, float, float] | list[float]) -> list[tuple[float, float]]:
    south, north, west, east = (float(bbox[0]), float(bbox[1]), float(bbox[2]), float(bbox[3]))
    lat_c = (south + north) / 2.0
    lon_c = (west + east) / 2.0
    return [
        (lat_c, lon_c),
        (north, lon_c),
        (south, lon_c),
        (lat_c, west),
        (lat_c, east),
    ]


def _overpass_post(endpoint: str, query: str, timeout: float) -> list[dict[str, Any]] | None:
    with httpx.Client(timeout=timeout, headers={"user-agent": USER_AGENT}) as client:
        response = client.post(endpoint, data={"data": query})
    if response.status_code >= 400:
        return None
    return parse_overpass_elements(response.json())


def fetch_overpass(lat: float, lon: float, radius_m: int = 10_000, *, budget_sec: float | None = None) -> tuple[list[dict[str, Any]], bool]:
    cache_key = f"overpass:{lat:.4f}:{lon:.4f}:{int(radius_m)}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return list(cached), True
    query = overpass_query(lat, lon, radius_m)
    deadline = time.monotonic() + (OVERPASS_BUDGET_SEC if budget_sec is None else budget_sec)
    last_error = False
    for endpoint in OVERPASS_ENDPOINTS:
        for attempt in range(OVERPASS_ATTEMPTS):
            remaining = deadline - time.monotonic()
            if remaining < 2:
                return [], False
            timeout = max(2.0, min(8.0, remaining - 0.4))
            try:
                parsed = _overpass_post(endpoint, query, timeout)
            except Exception:  # noqa: BLE001
                parsed = None
                last_error = True
            else:
                if parsed is not None:
                    _cache_set(cache_key, parsed)
                    return parsed, True
                last_error = True
            remaining = deadline - time.monotonic()
            if attempt + 1 < OVERPASS_ATTEMPTS and remaining > OVERPASS_BACKOFF_SEC + 2:
                time.sleep(min(OVERPASS_BACKOFF_SEC, remaining / 3))
    return [], not last_error


def fetch_overpass_bbox(
    south: float, west: float, north: float, east: float, *, budget_sec: float | None = None
) -> tuple[list[dict[str, Any]], bool]:
    cache_key = f"overpass-bbox:{south:.3f}:{west:.3f}:{north:.3f}:{east:.3f}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return list(cached), True
    query = overpass_bbox_query(south, west, north, east)
    deadline = time.monotonic() + (OVERPASS_BUDGET_SEC if budget_sec is None else budget_sec)
    last_error = False
    for endpoint in OVERPASS_ENDPOINTS:
        for attempt in range(OVERPASS_ATTEMPTS):
            remaining = deadline - time.monotonic()
            if remaining < 2:
                return [], False
            timeout = max(2.0, min(8.0, remaining - 0.4))
            try:
                parsed = _overpass_post(endpoint, query, timeout)
            except Exception:  # noqa: BLE001
                parsed = None
                last_error = True
            else:
                if parsed is not None:
                    _cache_set(cache_key, parsed)
                    return parsed, True
                last_error = True
            remaining = deadline - time.monotonic()
            if attempt + 1 < OVERPASS_ATTEMPTS and remaining > OVERPASS_BACKOFF_SEC + 2:
                time.sleep(min(OVERPASS_BACKOFF_SEC, remaining / 3))
    return [], not last_error


def fetch_overpass_resilient(lat: float, lon: float) -> tuple[list[dict[str, Any]], bool]:
    deadline = time.monotonic() + OVERPASS_BUDGET_SEC
    named, ok = fetch_overpass(lat, lon, 10_000, budget_sec=max(2.0, deadline - time.monotonic()))
    if ok and len(named) >= 3:
        return named, True
    remaining = deadline - time.monotonic()
    if remaining < 3:
        return named, ok
    wider, wide_ok = fetch_overpass(lat, lon, 25_000, budget_sec=remaining)
    if wide_ok:
        return merge_candidates(named, wider), True
    return named, ok or wide_ok


def parse_wikipedia_geosearch(geo_payload: Any, extract_payload: Any | None = None) -> list[dict[str, Any]]:
    geo_rows = []
    if isinstance(geo_payload, dict):
        query = geo_payload.get("query") if isinstance(geo_payload.get("query"), dict) else {}
        geo_rows = query.get("geosearch") or []
    extracts: dict[str, dict[str, Any]] = {}
    if isinstance(extract_payload, dict):
        pages = (extract_payload.get("query") or {}).get("pages") if isinstance(extract_payload.get("query"), dict) else {}
        if isinstance(pages, dict):
            for page in pages.values():
                if isinstance(page, dict) and page.get("title"):
                    extracts[str(page.get("title"))] = page
                    extracts[str(page.get("pageid") or "")] = page
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for row in geo_rows:
        if not isinstance(row, dict):
            continue
        title = str(row.get("title") or "").strip()
        if not title or _wiki_title_hard_drop(title):
            continue
        key = _norm_name(title)
        if key in seen:
            continue
        try:
            lat = float(row.get("lat"))
            lon = float(row.get("lon"))
        except (TypeError, ValueError):
            continue
        extra = extracts.get(title) or extracts.get(str(row.get("pageid") or "")) or {}
        extract = str(extra.get("extract") or extra.get("description") or "").strip()
        wiki_url = str(extra.get("fullurl") or extra.get("canonicalurl") or "").strip()
        if not wiki_url:
            wiki_url = "https://en.wikipedia.org/wiki/" + urllib.parse.quote(title.replace(" ", "_"))
        if str(extra.get("description") or "").lower() == "disambiguation page":
            continue
        seen.add(key)
        out.append(
            {
                "name_en": title,
                "type": "",
                "lat": round(lat, 6),
                "lon": round(lon, 6),
                "source_url": wiki_url,
                "osm_url": "",
                "wiki_url": wiki_url,
                "description": extract,
                "coord_source": "Wikipedia",
                "source": "wikipedia",
            }
        )
        if len(out) >= 30:
            break
    return out


def _wiki_title_hard_drop(title: str) -> bool:
    text = title.strip()
    lowered = text.lower()
    if lowered.startswith("list of "):
        return True
    if "disambiguation" in lowered:
        return True
    if lowered.endswith(" province") or lowered.endswith(" region"):
        return True
    return False


def keyword_keep_visitable(row: dict[str, Any]) -> bool:
    blob = f"{row.get('name_en') or ''} {row.get('description') or ''}".lower()
    return any(word in blob for word in SIGHT_WORDS)


def filter_visitable_heuristic(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    kept: list[dict[str, Any]] = []
    for row in rows:
        title = str(row.get("name_en") or "")
        if _wiki_title_hard_drop(title):
            continue
        if keyword_keep_visitable(row):
            item = dict(row)
            if not item.get("type"):
                item["type"] = next((word for word in SIGHT_WORDS if word in f"{title} {item.get('description')}".lower()), "attraction")
            kept.append(item)
    def rank(item: dict[str, Any]) -> int:
        blob = str(item.get("name_en") or "").lower()
        if any(word in blob for word in ("monastery", "church", "fortress", "castle", "museum", "cathedral")):
            return 0
        return 1

    kept.sort(key=rank)
    return kept[:REGION_CANDIDATE_CAP]


def parse_visitable_llm_json(data: Any, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    allowed = {_norm_name(str(row.get("name_en") or "")): row for row in rows}
    items = data.get("items") if isinstance(data, dict) else data
    if not isinstance(items, list):
        return []
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in items:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title") or item.get("name_en") or "").strip()
        key = _norm_name(title)
        if not key or key not in allowed or key in seen:
            continue
        visitable = item.get("visitable")
        if visitable is False or str(visitable).lower() in {"no", "false", "0"}:
            continue
        if visitable is not True and str(visitable).lower() not in {"yes", "true", "1"}:
            continue
        row = dict(allowed[key])
        kind = str(item.get("type") or row.get("type") or "attraction").strip() or "attraction"
        row["type"] = kind
        seen.add(key)
        out.append(row)
        if len(out) >= CANDIDATE_CAP:
            break
    return out


def invoke_visitable_llm(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key or not rows:
        raise RuntimeError("no_llm")
    import json as json_lib
    from langchain_core.messages import HumanMessage, SystemMessage
    from langchain_openai import ChatOpenAI

    payload = [{"title": row.get("name_en"), "extract": (row.get("description") or "")[:400]} for row in rows]
    llm = ChatOpenAI(
        model=os.getenv("OPENAI_PLACE_MODEL", "").strip() or os.getenv("OPENAI_MODEL", "gpt-4o-mini").strip() or "gpt-4o-mini",
        temperature=0,
        api_key=api_key,
        timeout=30,
    )
    response = llm.invoke(
        [
            SystemMessage(
                content=(
                    "Classify Wikipedia places. JSON only. "
                    'Schema: {"items":[{"title":"...","visitable":true,"type":"monastery|museum|fortress|church|park|other"}]}. '
                    "visitable=true only for a concrete sight a tourist can visit. "
                    "false for people, lists, disambiguation, river lists, empty villages. "
                    "Use only the given titles. Do not add names."
                )
            ),
            HumanMessage(content=json_lib.dumps(payload, ensure_ascii=False)),
        ]
    )
    content = response.content
    if not isinstance(content, str) or not content.strip():
        raise RuntimeError("empty_llm")
    raw = content.strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
    parsed = json_lib.loads(raw)
    classified = parse_visitable_llm_json(parsed, rows)
    if not classified:
        raise RuntimeError("empty_classify")
    return classified


def classify_visitable(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    try:
        return invoke_visitable_llm(rows)
    except Exception:  # noqa: BLE001
        return filter_visitable_heuristic(rows)


def fetch_wikipedia_extracts(pageids: list[int]) -> dict[str, Any]:
    if not pageids:
        return {}
    params = {
        "action": "query",
        "prop": "extracts|info",
        "exintro": "1",
        "explaintext": "1",
        "exlimit": "max",
        "inprop": "url",
        "pageids": "|".join(str(item) for item in pageids[:30]),
        "format": "json",
    }
    with httpx.Client(timeout=WIKI_TIMEOUT_SEC, headers={"user-agent": USER_AGENT, "accept": "application/json"}) as client:
        response = client.get(WIKI_API, params=params)
    if response.status_code >= 400:
        return {}
    payload = response.json()
    return payload if isinstance(payload, dict) else {}


def fetch_wikipedia_geosearch(lat: float, lon: float, radius_m: int = 10_000) -> tuple[list[dict[str, Any]], bool]:
    cache_key = f"wiki:{lat:.4f}:{lon:.4f}:{int(radius_m)}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return list(cached), True
    params = {
        "action": "query",
        "list": "geosearch",
        "gscoord": f"{lat}|{lon}",
        "gsradius": str(int(radius_m)),
        "gslimit": "30",
        "format": "json",
    }
    try:
        with httpx.Client(timeout=WIKI_TIMEOUT_SEC, headers={"user-agent": USER_AGENT, "accept": "application/json"}) as client:
            response = client.get(WIKI_API, params=params)
        if response.status_code >= 400:
            return [], False
        geo_payload = response.json()
        geo_rows = []
        if isinstance(geo_payload, dict):
            geo_rows = ((geo_payload.get("query") or {}).get("geosearch") or []) if isinstance(geo_payload.get("query"), dict) else []
        pageids = [int(row["pageid"]) for row in geo_rows if isinstance(row, dict) and str(row.get("pageid") or "").isdigit()]
        extracts = fetch_wikipedia_extracts(pageids)
        parsed = parse_wikipedia_geosearch(geo_payload, extracts)
        _cache_set(cache_key, parsed)
        return parsed, True
    except Exception:  # noqa: BLE001
        return [], False


def fetch_wikipedia_geosearch_multi(points: list[tuple[float, float]]) -> tuple[list[dict[str, Any]], bool]:
    if not points:
        return [], False
    rows: list[dict[str, Any]] = []
    any_ok = False
    with ThreadPoolExecutor(max_workers=min(5, len(points)), thread_name_prefix="wiki-geo") as pool:
        futures = [pool.submit(fetch_wikipedia_geosearch, lat, lon, WIKI_GEO_RADIUS_M) for lat, lon in points]
        for future in futures:
            try:
                chunk, ok = future.result()
            except Exception:  # noqa: BLE001
                continue
            any_ok = any_ok or ok
            rows.extend(chunk)
    return merge_candidates(rows, cap=40), any_ok


def parse_wikipedia_coordinate_pages(payload: Any) -> list[dict[str, Any]]:
    pages = {}
    if isinstance(payload, dict):
        query = payload.get("query") if isinstance(payload.get("query"), dict) else {}
        raw_pages = query.get("pages") or {}
        if isinstance(raw_pages, dict):
            pages = raw_pages
        elif isinstance(raw_pages, list):
            pages = {str(index): item for index, item in enumerate(raw_pages)}
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for page in pages.values():
        if not isinstance(page, dict):
            continue
        title = str(page.get("title") or "").strip()
        if not title or _wiki_title_hard_drop(title):
            continue
        coords = page.get("coordinates") or []
        if not isinstance(coords, list) or not coords or not isinstance(coords[0], dict):
            continue
        try:
            lat = float(coords[0].get("lat"))
            lon = float(coords[0].get("lon"))
        except (TypeError, ValueError):
            continue
        key = _norm_name(title)
        if key in seen:
            continue
        wiki_url = str(page.get("fullurl") or page.get("canonicalurl") or "").strip()
        if not wiki_url:
            wiki_url = "https://en.wikipedia.org/wiki/" + urllib.parse.quote(title.replace(" ", "_"))
        extract = str(page.get("extract") or "").strip()
        seen.add(key)
        out.append(
            {
                "name_en": title,
                "type": "",
                "lat": round(lat, 6),
                "lon": round(lon, 6),
                "source_url": wiki_url,
                "osm_url": "",
                "wiki_url": wiki_url,
                "description": extract,
                "coord_source": "Wikipedia",
                "source": "wikipedia",
            }
        )
    return out


def fetch_wikipedia_text_search(place_en: str) -> tuple[list[dict[str, Any]], bool]:
    name = " ".join(str(place_en or "").split())
    if not name:
        return [], False
    cache_key = f"wiki-search:{_norm_name(name)}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return list(cached), True
    queries = [
        f"{name} province monastery church fortress",
        f"{name} Armenia attractions",
        f"{name} monastery",
        f"{name} church",
        f"{name} fortress",
    ]
    titles: list[str] = []
    seen: set[str] = set()
    ok = False
    try:
        with httpx.Client(timeout=WIKI_TIMEOUT_SEC, headers={"user-agent": USER_AGENT, "accept": "application/json"}) as client:
            for query in queries:
                response = client.get(
                    WIKI_API,
                    params={
                        "action": "query",
                        "list": "search",
                        "srsearch": query,
                        "srlimit": "20",
                        "format": "json",
                    },
                )
                if response.status_code >= 400:
                    continue
                ok = True
                payload = response.json()
                hits = ((payload.get("query") or {}).get("search") or []) if isinstance(payload, dict) else []
                for hit in hits:
                    if not isinstance(hit, dict):
                        continue
                    title = str(hit.get("title") or "").strip()
                    key = _norm_name(title)
                    if not title or key in seen or _wiki_title_hard_drop(title):
                        continue
                    seen.add(key)
                    titles.append(title)
            if not titles:
                _cache_set(cache_key, [])
                return [], ok
            chosen = titles[:30]
            coords = client.get(
                WIKI_API,
                params={
                    "action": "query",
                    "titles": "|".join(chosen),
                    "prop": "coordinates",
                    "colimit": "max",
                    "format": "json",
                    "redirects": "1",
                },
            )
            if coords.status_code >= 400:
                return [], ok
            parsed = parse_wikipedia_coordinate_pages(coords.json())
            with_coords = [row["name_en"] for row in parsed]
            if with_coords:
                extracts = fetch_wikipedia_extracts_by_title(with_coords, client)
                by_title = {str(item.get("title") or ""): item for item in extracts.values() if isinstance(item, dict)}
                for row in parsed:
                    extra = by_title.get(row["name_en"]) or {}
                    extract = str(extra.get("extract") or "").strip()
                    wiki_url = str(extra.get("fullurl") or extra.get("canonicalurl") or row.get("wiki_url") or "")
                    if extract:
                        row["description"] = extract
                    if wiki_url:
                        row["wiki_url"] = wiki_url
                        row["source_url"] = wiki_url
            _cache_set(cache_key, parsed)
            return parsed, True
    except Exception:  # noqa: BLE001
        return [], False


def fetch_wikipedia_extracts_by_title(titles: list[str], client: httpx.Client | None = None) -> dict[str, Any]:
    if not titles:
        return {}
    params = {
        "action": "query",
        "titles": "|".join(titles[:30]),
        "prop": "extracts|info",
        "exintro": "1",
        "explaintext": "1",
        "exlimit": "max",
        "inprop": "url",
        "format": "json",
        "redirects": "1",
    }
    try:
        if client is None:
            with httpx.Client(timeout=WIKI_TIMEOUT_SEC, headers={"user-agent": USER_AGENT, "accept": "application/json"}) as owned:
                response = owned.get(WIKI_API, params=params)
        else:
            response = client.get(WIKI_API, params=params)
        if response.status_code >= 400:
            return {}
        payload = response.json()
        pages = ((payload.get("query") or {}).get("pages") or {}) if isinstance(payload, dict) else {}
        return pages if isinstance(pages, dict) else {}
    except Exception:  # noqa: BLE001
        return {}


def wikipedia_summary(title: str) -> dict[str, str] | None:
    name = " ".join(str(title or "").split())
    if not name:
        return None
    path = urllib.parse.quote(name.replace(" ", "_"))
    url = f"https://en.wikipedia.org/api/rest_v1/page/summary/{path}"
    try:
        with httpx.Client(timeout=WIKI_TIMEOUT_SEC, headers={"user-agent": USER_AGENT, "accept": "application/json"}) as client:
            response = client.get(url)
        if response.status_code >= 400:
            return None
        payload = response.json()
    except Exception:  # noqa: BLE001
        return None
    if not isinstance(payload, dict) or str(payload.get("type") or "") == "disambiguation":
        return None
    extract = str(payload.get("extract") or payload.get("description") or "").strip()
    desktop = payload.get("content_urls") if isinstance(payload.get("content_urls"), dict) else {}
    desktop_page = desktop.get("desktop") if isinstance(desktop, dict) else {}
    wiki_url = str((desktop_page or {}).get("page") or "")
    if not wiki_url:
        wiki_url = f"https://en.wikipedia.org/wiki/{path}"
    if not extract and not wiki_url:
        return None
    return {"description": extract, "wiki_url": wiki_url}


def merge_candidates(*groups: list[dict[str, Any]], cap: int | None = None) -> list[dict[str, Any]]:
    by_key: dict[str, dict[str, Any]] = {}
    order: list[str] = []
    for group in groups:
        for row in group:
            if not isinstance(row, dict):
                continue
            name = str(row.get("name_en") or "").strip()
            if not name:
                continue
            key = _norm_name(name)
            existing = by_key.get(key)
            if existing is None:
                by_key[key] = dict(row)
                order.append(key)
                continue
            new_has_wiki = bool(row.get("wiki_url") or (str(row.get("source_url") or "").find("wikipedia.org") >= 0))
            old_has_wiki = bool(existing.get("wiki_url") or (str(existing.get("source_url") or "").find("wikipedia.org") >= 0))
            if new_has_wiki and not old_has_wiki:
                merged = dict(existing)
                merged.update({k: v for k, v in row.items() if v not in ("", None)})
                if existing.get("osm_url") and not merged.get("osm_url"):
                    merged["osm_url"] = existing.get("osm_url")
                by_key[key] = merged
            elif existing.get("osm_url") and not row.get("osm_url"):
                pass
            elif row.get("osm_url") and not existing.get("osm_url"):
                existing["osm_url"] = row.get("osm_url")
    out = [by_key[key] for key in order]
    limit = CANDIDATE_CAP if cap is None else cap
    return out[:limit]


def filter_rows_to_bbox(
    rows: list[dict[str, Any]], bbox: tuple[float, float, float, float] | list[float] | None, pad: float = 0.12
) -> list[dict[str, Any]]:
    if not bbox or len(bbox) != 4:
        return rows
    south, north, west, east = (float(bbox[0]), float(bbox[1]), float(bbox[2]), float(bbox[3]))
    kept: list[dict[str, Any]] = []
    for row in rows:
        try:
            lat = float(row.get("lat"))
            lon = float(row.get("lon"))
        except (TypeError, ValueError):
            continue
        if south - pad <= lat <= north + pad and west - pad <= lon <= east + pad:
            kept.append(row)
    return kept


def _attach_armavir_km(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for row in rows:
        item = dict(row)
        try:
            lat = float(item.get("lat"))
            lon = float(item.get("lon"))
        except (TypeError, ValueError):
            out.append(item)
            continue
        item["distance_from_armavir_km"] = armavir_distance_km(lat, lon)
        out.append(item)
    return out


def _place_lookup(name: str, region_en: str) -> dict[str, Any] | None:
    try:
        lookup = nominatim_lookup(name, region_en, require_meta=True)
    except Exception:  # noqa: BLE001
        lookup = None
    if lookup:
        return lookup
    try:
        coord = nominatim_coord(name, region_en)
    except Exception:  # noqa: BLE001
        return None
    if coord is None:
        return None
    return {
        "lat": coord[0],
        "lon": coord[1],
        "osm_class": "",
        "place_type": "",
        "boundingbox": None,
    }


def collect_structured_bundle(place_en: str, region_en: str = "") -> dict[str, Any]:
    name = " ".join(str(place_en or "").split())
    empty = {
        "candidates": [],
        "ok": False,
        "coord": None,
        "is_region": False,
        "bbox": None,
        "osm_class": "",
        "place_type": "",
        "sample_points": 0,
        "wikipedia_count": 0,
        "overpass_count": 0,
        "wikipedia_ok": False,
        "overpass_ok": False,
    }
    if not name:
        return {**empty, "ok": True}
    cache_key = f"merged:{_norm_name(name)}:{_norm_name(region_en)}:region"
    cached = _cache_get(cache_key)
    if isinstance(cached, dict) and cached.get("candidates") is not None:
        return cached
    lookup = _place_lookup(name, region_en)
    if lookup is None:
        return empty
    coord = (float(lookup["lat"]), float(lookup["lon"]))
    bbox = lookup.get("boundingbox")
    region = is_nominatim_region(lookup)
    cap = REGION_CANDIDATE_CAP if region else CANDIDATE_CAP
    if region and isinstance(bbox, (list, tuple)) and len(bbox) == 4:
        south, north, west, east = (float(bbox[0]), float(bbox[1]), float(bbox[2]), float(bbox[3]))
        points = region_sample_points((south, north, west, east))
        with ThreadPoolExecutor(max_workers=7, thread_name_prefix="place-src") as pool:
            geo_futures = [pool.submit(fetch_wikipedia_geosearch, lat, lon, WIKI_GEO_RADIUS_M) for lat, lon in points]
            wiki_text_f = pool.submit(fetch_wikipedia_text_search, name)
            osm_f = pool.submit(fetch_overpass_bbox, south, west, north, east)
            wiki_geo_chunks: list[dict[str, Any]] = []
            wiki_geo_ok = False
            for future in geo_futures:
                try:
                    chunk, ok = future.result()
                except Exception:  # noqa: BLE001
                    continue
                wiki_geo_ok = wiki_geo_ok or ok
                wiki_geo_chunks.extend(chunk)
            wiki_geo = merge_candidates(wiki_geo_chunks, cap=40)
            try:
                wiki_text, wiki_text_ok = wiki_text_f.result()
            except Exception:  # noqa: BLE001
                wiki_text, wiki_text_ok = [], False
            try:
                osm_rows, osm_ok = osm_f.result()
            except Exception:  # noqa: BLE001
                osm_rows, osm_ok = [], False
        wiki_raw = filter_rows_to_bbox(merge_candidates(wiki_text, wiki_geo, cap=40), (south, north, west, east))
        osm_rows = filter_rows_to_bbox(osm_rows, (south, north, west, east))
        wiki_ok = wiki_geo_ok or wiki_text_ok
        sample_points = len(points)
    else:
        with ThreadPoolExecutor(max_workers=2, thread_name_prefix="place-src") as pool:
            wiki_future = pool.submit(fetch_wikipedia_geosearch, coord[0], coord[1], WIKI_GEO_RADIUS_M)
            osm_future = pool.submit(fetch_overpass_resilient, coord[0], coord[1])
            wiki_raw, wiki_ok = wiki_future.result()
            osm_rows, osm_ok = osm_future.result()
        sample_points = 1
    wiki_rows = classify_visitable(wiki_raw) if wiki_raw else []
    merged = _attach_armavir_km(merge_candidates(wiki_rows, osm_rows, cap=cap))
    ok = bool(merged)
    bundle = {
        "candidates": merged,
        "ok": ok,
        "coord": coord,
        "is_region": region,
        "bbox": tuple(bbox) if isinstance(bbox, (list, tuple)) and len(bbox) == 4 else None,
        "osm_class": str(lookup.get("osm_class") or ""),
        "place_type": str(lookup.get("place_type") or ""),
        "sample_points": sample_points,
        "wikipedia_count": len(wiki_rows),
        "overpass_count": len(osm_rows),
        "wikipedia_ok": wiki_ok,
        "overpass_ok": osm_ok,
    }
    if ok:
        _cache_set(cache_key, bundle)
    return bundle


def collect_structured_candidates(place_en: str, region_en: str = "") -> tuple[list[dict[str, Any]], bool]:
    bundle = collect_structured_bundle(place_en, region_en)
    return list(bundle.get("candidates") or []), bool(bundle.get("ok"))
