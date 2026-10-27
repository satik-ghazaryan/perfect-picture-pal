from __future__ import annotations

import json
import math
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# Operator origin only (not a destination gazetteer). Destinations come from Nominatim.
ARMAVIR_COORD = (40.1544, 44.0385)

OSRM_URL = "https://router.project-osrm.org/route/v1/driving/{lon1},{lat1};{lon2},{lat2}?overview=false"
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search?{qs}"
HAVERSINE_FACTOR = 1.6
NOMINATIM_MIN_INTERVAL_SEC = 1.1
NOMINATIM_TIMEOUT_SEC = 8
_CACHE: dict[str, float] = {}
_GEO_CACHE: dict[str, tuple[float, float] | None] = {}
_NOMINATIM_LOCK = threading.Lock()
_NOMINATIM_LAST_CALL = 0.0
_DISK_LOADED = False
_DISK_CACHE_PATH = Path(
    os.getenv("ARI_GEO_CACHE", str(Path(__file__).resolve().parent.parent / ".nominatim_cache.json"))
)
LATIN_RE = re.compile(r"[A-Za-z]{3,}")
ARMENIAN_RE = re.compile(r"[\u0531-\u0587]")
PAREN_EN_RE = re.compile(r"\(([A-Za-z][A-Za-z0-9 .,'-]{1,80})\)")
SPLIT_RE = re.compile(r"\s*/\s*|\s*\|\s*|;")
PLACE_CUT_RE = re.compile(r"\s*[—–]\s*|\s+-\s*|\s*:\s*|\s*\(")
ACTIVITY_WORDS = {
    "arrival",
    "departure",
    "return",
    "visit",
    "lunch",
    "break",
    "stop",
    "drive",
    "transfer",
    "free",
    "time",
}
ROUTE_KM_ESTIMATE_NOTE = "Route km is an estimate"


@dataclass
class RouteKm:
    km: float
    sourced: bool
    notes: list[str]
    km_source: str = ""
    geocoded_stops: list[dict[str, Any]] = field(default_factory=list)

    def __iter__(self):
        yield self.km
        yield self.sourced
        yield self.notes


def _norm(name: str) -> str:
    return " ".join(name.lower().replace("—", " ").replace("-", " ").split())


def is_armavir_stop(title: str) -> bool:
    text = _norm(title)
    return "armavir" in text or "արմավիր" in text


def place_from_stop_title(title: str) -> str:
    text = " ".join(str(title or "").split())
    if not text:
        return ""
    head = PLACE_CUT_RE.split(text, maxsplit=1)[0].strip()
    kept = [token for token in head.split() if token.lower().strip(".,;!") not in ACTIVITY_WORDS]
    return " ".join(kept).strip()


def is_activity_stop(title: str) -> bool:
    return not place_from_stop_title(title)


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
            name = place_from_stop_title(_latin_name(part) or part)
            if name and not is_armavir_stop(name) and not is_activity_stop(name):
                titles.append(name)
    return titles


def has_stop_outside_armavir(itinerary: list[Any]) -> bool:
    return bool(destination_titles(itinerary))


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


def _wait_nominatim_slot() -> None:
    """Hold the Nominatim lock when calling. Cache hits never enter here."""
    global _NOMINATIM_LAST_CALL
    now = time.monotonic()
    wait = NOMINATIM_MIN_INTERVAL_SEC - (now - _NOMINATIM_LAST_CALL)
    if wait > 0:
        time.sleep(wait)
    _NOMINATIM_LAST_CALL = time.monotonic()


def _ensure_disk_loaded() -> None:
    global _DISK_LOADED
    if _DISK_LOADED:
        return
    _DISK_LOADED = True
    try:
        raw = json.loads(_DISK_CACHE_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, TypeError):
        return
    if not isinstance(raw, dict):
        return
    for key, value in raw.items():
        if isinstance(value, list) and len(value) == 2:
            try:
                _GEO_CACHE[str(key)] = (float(value[0]), float(value[1]))
            except (TypeError, ValueError):
                continue
        elif value is None:
            _GEO_CACHE[str(key)] = None


def _persist_geo_cache() -> None:
    try:
        serializable = {key: list(value) if isinstance(value, tuple) else value for key, value in _GEO_CACHE.items()}
        _DISK_CACHE_PATH.write_text(json.dumps(serializable, ensure_ascii=False), encoding="utf-8")
    except OSError:
        return


def nominatim_coord(name: str, region: str = "") -> tuple[float, float] | None:
    query = ", ".join(part for part in (name.strip(), region.strip(), "Armenia") if part)
    if not query:
        return None
    _ensure_disk_loaded()
    if query in _GEO_CACHE:
        return _GEO_CACHE.get(query)
    with _NOMINATIM_LOCK:
        _ensure_disk_loaded()
        if query in _GEO_CACHE:
            return _GEO_CACHE.get(query)
        _wait_nominatim_slot()
        qs = urllib.parse.urlencode({"q": query, "format": "json", "limit": "1"})
        url = NOMINATIM_URL.format(qs=qs)
        try:
            request = urllib.request.Request(url, headers={"user-agent": "ari-gnank-distance/1.0"})
            with urllib.request.urlopen(request, timeout=NOMINATIM_TIMEOUT_SEC) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ValueError, OSError):
            _GEO_CACHE[query] = None
            _persist_geo_cache()
            return None
        if not isinstance(payload, list) or not payload or not isinstance(payload[0], dict):
            _GEO_CACHE[query] = None
            _persist_geo_cache()
            return None
        try:
            coord = (float(payload[0]["lat"]), float(payload[0]["lon"]))
        except (KeyError, TypeError, ValueError):
            _GEO_CACHE[query] = None
            _persist_geo_cache()
            return None
        _GEO_CACHE[query] = coord
        _persist_geo_cache()
        return coord


def resolve_coord(name: str, region: str = "") -> tuple[tuple[float, float] | None, str]:
    geo = nominatim_coord(name, region)
    if geo is not None:
        return geo, "Nominatim"
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
) -> RouteKm:
    """Armavir -> each non-Armavir stop in order. No return leg. Never treats a failed geocode as 0 km of travel."""
    notes: list[str] = []
    geocoded_stops: list[dict[str, Any]] = []
    dests = destination_titles(itinerary, extra_names)
    if not dests:
        for extra in extra_names or []:
            latin = place_from_stop_title(_latin_name(str(extra or "")) or str(extra or ""))
            if latin and not is_armavir_stop(latin) and not is_activity_stop(latin):
                dests.extend(split_place_names(latin))
        dests = [
            place_from_stop_title(item)
            for item in dests
            if item and not is_armavir_stop(item) and not is_activity_stop(item)
        ]
        dests = [item for item in dests if item]
    if not dests:
        notes.append("No destination stops after Armavir; route km is 0")
        return RouteKm(0.0, True, notes, km_source="", geocoded_stops=[])
    points: list[tuple[float, float]] = [ARMAVIR_COORD]
    last_ok = ARMAVIR_COORD
    for title in dests:
        coord, how = resolve_coord(title, region)
        if coord is None:
            notes.append(f"Could not geocode stop: {title}; stop skipped")
            continue
        geocoded_stops.append(
            {
                "name": title,
                "lat": round(coord[0], 6),
                "lon": round(coord[1], 6),
                "coord_source": how,
            }
        )
        points.append(coord)
        last_ok = coord
    if len(points) < 2:
        extras = [
            place_from_stop_title(_latin_name(str(item or "")) or str(item or ""))
            for item in (extra_names or [])
        ]
        extras = [item for item in extras if item and not is_armavir_stop(item) and not is_activity_stop(item)]
        for extra in extras:
            coord, how = resolve_coord(extra, region)
            if coord is None:
                continue
            points.append(coord)
            geocoded_stops.append(
                {
                    "name": extra,
                    "lat": round(coord[0], 6),
                    "lon": round(coord[1], 6),
                    "coord_source": how,
                }
            )
            notes.append(f"Used location fallback {extra} ({how}); confirm driving distance")
            last_ok = coord
            break
    if len(points) < 2:
        notes.append("price needs route distance")
        return RouteKm(0.0, False, notes, km_source="", geocoded_stops=geocoded_stops)
    skipped = len(dests) - (len(points) - 1)
    if skipped > 0 and last_ok != ARMAVIR_COORD:
        notes.append("Unmapped stops were skipped; km uses mapped stops plus haversine x 1.6 when OSRM is missing")
    total = 0.0
    osrm_ok = True
    for index in range(len(points) - 1):
        km, ok = pair_km(points[index], points[index + 1])
        total += km
        osrm_ok = osrm_ok and ok
    km_source = "OSRM" if osrm_ok else "estimate"
    if not osrm_ok and ROUTE_KM_ESTIMATE_NOTE not in notes:
        notes.append(ROUTE_KM_ESTIMATE_NOTE)
    return RouteKm(round(total, 1), osrm_ok, notes, km_source=km_source, geocoded_stops=geocoded_stops)
