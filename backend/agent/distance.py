from __future__ import annotations

import json
import math
import re
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

# lat, lon
ARMAVIR_COORD = (40.1544, 44.0385)
KNOWN_COORDS: dict[str, tuple[float, float]] = {
    "armavir": ARMAVIR_COORD,
    "արմավիր": ARMAVIR_COORD,
    "akhtala": (41.1500, 44.7580),
    "ախթալա": (41.1500, 44.7580),
    "dsegh": (40.9610, 44.6510),
    "դսեղ": (40.9610, 44.6510),
    "tsover": (40.9530, 44.6680),
    "ծովեր": (40.9530, 44.6680),
    "տսովեր": (40.9530, 44.6680),
}

OSRM_URL = "https://router.project-osrm.org/route/v1/driving/{lon1},{lat1};{lon2},{lat2}?overview=false"
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search?{qs}"
HAVERSINE_FACTOR = 1.6
_CACHE: dict[str, float] = {}
_GEO_CACHE: dict[str, tuple[float, float] | None] = {}
LATIN_RE = re.compile(r"[A-Za-z]{3,}")
ARMENIAN_RE = re.compile(r"[\u0531-\u0587]")
PAREN_EN_RE = re.compile(r"\(([A-Za-z][A-Za-z0-9 .,'-]{1,80})\)")
SPLIT_RE = re.compile(r"\s*/\s*|\s*\|\s*|;")


def _norm(name: str) -> str:
    return " ".join(name.lower().replace("—", " ").replace("-", " ").split())


def is_armavir_stop(title: str) -> bool:
    text = _norm(title)
    return "armavir" in text or "արմավիր" in text


def _latin_name(value: str) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    paren = PAREN_EN_RE.search(text)
    if paren:
        return paren.group(1).strip()
    if LATIN_RE.search(text) and not ARMENIAN_RE.search(text):
        return text
    chunks = LATIN_RE.findall(text)
    if chunks:
        return " ".join(chunks)
    return ""


def english_stop_name(stop: dict[str, Any], extra_names: list[str] | None = None) -> str:
    title_en = _latin_name(str(stop.get("title_en") or ""))
    if title_en:
        return title_en
    title = _latin_name(str(stop.get("title") or ""))
    if title:
        return title
    description = _latin_name(str(stop.get("description") or ""))
    if description:
        return description
    for extra in extra_names or []:
        latin = _latin_name(str(extra or ""))
        if latin and not is_armavir_stop(latin):
            return latin
    return ""


def split_place_names(title: str) -> list[str]:
    parts = [part.strip() for part in SPLIT_RE.split(str(title or "")) if part.strip()]
    return parts or ([title.strip()] if title.strip() else [])


def destination_titles(itinerary: list[Any], extra_names: list[str] | None = None) -> list[str]:
    titles: list[str] = []
    for stop in itinerary or []:
        if not isinstance(stop, dict):
            continue
        display = str(stop.get("title_en") or stop.get("title") or "").strip()
        if not display:
            continue
        if is_armavir_stop(display) or is_armavir_stop(str(stop.get("title") or "")):
            continue
        english = english_stop_name(stop, extra_names)
        for part in split_place_names(english or display):
            name = _latin_name(part) or part
            if name and not is_armavir_stop(name):
                titles.append(name)
    return titles


def has_stop_outside_armavir(itinerary: list[Any]) -> bool:
    return bool(destination_titles(itinerary))


def lookup_coord(title: str) -> tuple[float, float] | None:
    key = _norm(title)
    for known, coord in KNOWN_COORDS.items():
        if known in key or key in known:
            return coord
    for token, coord in KNOWN_COORDS.items():
        if token in key:
            return coord
    return None


def _haversine_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    r = 6371.0
    lat1, lon1 = math.radians(a[0]), math.radians(a[1])
    lat2, lon2 = math.radians(b[0]), math.radians(b[1])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def _osrm_km(a: tuple[float, float], b: tuple[float, float]) -> float | None:
    cache_key = f"{a[0]:.4f},{a[1]:.4f}->{b[0]:.4f},{b[1]:.4f}"
    if cache_key in _CACHE:
        return _CACHE[cache_key]
    url = OSRM_URL.format(lon1=a[1], lat1=a[0], lon2=b[1], lat2=b[0])
    try:
        request = urllib.request.Request(url, headers={"user-agent": "ari-gnank-distance/1.0"})
        with urllib.request.urlopen(request, timeout=8) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ValueError, OSError):
        return None
    routes = payload.get("routes") if isinstance(payload, dict) else None
    if not isinstance(routes, list) or not routes:
        return None
    meters = routes[0].get("distance") if isinstance(routes[0], dict) else None
    if not isinstance(meters, (int, float)):
        return None
    km = float(meters) / 1000.0
    _CACHE[cache_key] = km
    return km


def nominatim_coord(name: str, region: str = "") -> tuple[float, float] | None:
    query = ", ".join(part for part in (name.strip(), region.strip(), "Armenia") if part)
    if not query or query in _GEO_CACHE:
        return _GEO_CACHE.get(query)
    qs = urllib.parse.urlencode({"q": query, "format": "json", "limit": "1"})
    url = NOMINATIM_URL.format(qs=qs)
    try:
        request = urllib.request.Request(url, headers={"user-agent": "ari-gnank-distance/1.0"})
        with urllib.request.urlopen(request, timeout=8) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ValueError, OSError):
        _GEO_CACHE[query] = None
        return None
    if not isinstance(payload, list) or not payload or not isinstance(payload[0], dict):
        _GEO_CACHE[query] = None
        return None
    try:
        coord = (float(payload[0]["lat"]), float(payload[0]["lon"]))
    except (KeyError, TypeError, ValueError):
        _GEO_CACHE[query] = None
        return None
    _GEO_CACHE[query] = coord
    return coord


def resolve_coord(name: str, region: str = "") -> tuple[tuple[float, float] | None, str]:
    known = lookup_coord(name)
    if known is not None:
        return known, "known"
    geo = nominatim_coord(name, region)
    if geo is not None:
        return geo, "nominatim"
    return None, "missing"


def pair_km(start: tuple[float, float], end: tuple[float, float]) -> tuple[float, bool]:
    sourced = _osrm_km(start, end)
    if sourced is not None:
        return sourced, True
    return _haversine_km(start, end) * HAVERSINE_FACTOR, False


def one_way_route_km(
    itinerary: list[Any],
    extra_names: list[str] | None = None,
    region: str = "",
) -> tuple[float, bool, list[str]]:
    """Armavir -> each non-Armavir stop in order. No return leg. Never treats a failed geocode as 0 km of travel."""
    notes: list[str] = []
    dests = destination_titles(itinerary, extra_names)
    if not dests:
        for extra in extra_names or []:
            latin = _latin_name(str(extra or ""))
            if latin and not is_armavir_stop(latin):
                dests.extend(split_place_names(latin))
        dests = [item for item in dests if item and not is_armavir_stop(item)]
    if not dests:
        notes.append("No destination stops after Armavir; route km is 0")
        return 0.0, True, notes
    points: list[tuple[float, float]] = [ARMAVIR_COORD]
    sourced = True
    last_ok = ARMAVIR_COORD
    for title in dests:
        coord, how = resolve_coord(title, region)
        if coord is None:
            notes.append(f"Could not geocode stop: {title}; using straight-line fallback from last known stop")
            sourced = False
            continue
        if how != "known":
            sourced = False
            notes.append(f"Geocoded {title} via {how}; confirm driving distance")
        points.append(coord)
        last_ok = coord
    if len(points) < 2:
        extras = [_latin_name(str(item or "")) for item in (extra_names or [])]
        extras = [item for item in extras if item and not is_armavir_stop(item)]
        for extra in extras:
            coord, how = resolve_coord(extra, region)
            if coord is None:
                continue
            points.append(coord)
            sourced = False
            notes.append(f"Used location fallback {extra} ({how}); confirm driving distance")
            last_ok = coord
            break
    if len(points) < 2:
        notes.append("price needs route distance")
        return 0.0, False, notes
    skipped = len(dests) - (len(points) - 1)
    if skipped > 0 and last_ok != ARMAVIR_COORD:
        notes.append("Unmapped stops were skipped; km uses mapped stops plus haversine x 1.6 when OSRM is missing")
    total = 0.0
    for index in range(len(points) - 1):
        km, ok = pair_km(points[index], points[index + 1])
        total += km
        sourced = sourced and ok
    if not sourced:
        notes.append("Route km used a fallback estimate; confirm driving distance")
    return round(total, 1), sourced, notes
