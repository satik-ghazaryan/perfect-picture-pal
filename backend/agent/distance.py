from __future__ import annotations

import json
import math
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
}

OSRM_URL = "https://router.project-osrm.org/route/v1/driving/{lon1},{lat1};{lon2},{lat2}?overview=false"
_CACHE: dict[str, float] = {}


def _norm(name: str) -> str:
    return " ".join(name.lower().replace("—", " ").replace("-", " ").split())


def is_armavir_stop(title: str) -> bool:
    text = _norm(title)
    return "armavir" in text or "արմավիր" in text


def destination_titles(itinerary: list[Any]) -> list[str]:
    titles: list[str] = []
    for stop in itinerary or []:
        if not isinstance(stop, dict):
            continue
        title = str(stop.get("title") or "").strip()
        if not title or is_armavir_stop(title):
            continue
        titles.append(title)
    return titles


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


def pair_km(start: tuple[float, float], end: tuple[float, float]) -> tuple[float, bool]:
    sourced = _osrm_km(start, end)
    if sourced is not None:
        return sourced, True
    return _haversine_km(start, end) * 1.6, False


def one_way_route_km(itinerary: list[Any]) -> tuple[float, bool, list[str]]:
    """Armavir -> each non-Armavir stop in order. No return leg."""
    notes: list[str] = []
    dests = destination_titles(itinerary)
    if not dests:
        notes.append("No destination stops after Armavir; route km is 0")
        return 0.0, True, notes
    points: list[tuple[float, float]] = [ARMAVIR_COORD]
    sourced = True
    for title in dests:
        coord = lookup_coord(title)
        if coord is None:
            notes.append(f"Could not geocode stop: {title}")
            sourced = False
            continue
        points.append(coord)
    if len(points) < 2:
        notes.append("Route km is an estimate; confirm driving distance")
        return 0.0, False, notes
    total = 0.0
    for index in range(len(points) - 1):
        km, ok = pair_km(points[index], points[index + 1])
        total += km
        sourced = sourced and ok
    if not sourced:
        notes.append("Route km used a fallback estimate; confirm driving distance")
    return round(total, 1), sourced, notes
