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
    "arrive",
    "arriving",
    "departure",
    "depart",
    "return",
    "returning",
    "visit",
    "visiting",
    "explore",
    "exploration",
    "exploring",
    "lunch",
    "break",
    "stop",
    "drive",
    "transfer",
    "free",
    "time",
    "walk",
    "walking",
}
LUNCH_HINTS = ("lunch", "meal", "rest")
ROUTE_KM_ESTIMATE_NOTE = "Route km is an estimate"
ROUTE_KM_ROUGH_NOTE = "Route km is a rough estimate; confirm"
NO_DESTINATION_STOPS_NOTE = "No destination stops after Armavir; route km is 0"
_LOOKUP_MEM: dict[str, dict[str, Any] | None] = {}


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


def _activity_only_name(name: str) -> bool:
    tokens = [token.lower().strip(".,;!") for token in str(name or "").split() if token.strip(".,;!")]
    if not tokens:
        return True
    return all(token in ACTIVITY_WORDS for token in tokens)


def stop_place_name(stop: dict[str, Any] | None) -> str:
    display = ""
    if isinstance(stop, dict):
        display = str(stop.get("title_en") or stop.get("title") or "").strip()
    derived = place_from_stop_title(display)
    if not isinstance(stop, dict):
        return derived
    if "place_name" not in stop:
        return derived
    raw = stop.get("place_name")
    if raw is None or not str(raw).strip() or _activity_only_name(str(raw)):
        return derived
    return str(raw).strip()


def stop_activity(stop: dict[str, Any] | None) -> str:
    if not isinstance(stop, dict):
        return ""
    if str(stop.get("activity") or "").strip():
        return str(stop.get("activity")).strip()
    display = str(stop.get("title_en") or stop.get("title") or "").strip()
    if not display:
        return ""
    parts = PLACE_CUT_RE.split(display, maxsplit=1)
    if len(parts) < 2:
        return ""
    return parts[1].strip()


def is_lunch_or_rest_stop(stop: dict[str, Any] | str | None) -> bool:
    if isinstance(stop, str):
        text = stop.lower()
        if is_armavir_stop(stop):
            return False
        if any(hint in text for hint in LUNCH_HINTS):
            return True
        return is_activity_stop(stop)
    if not isinstance(stop, dict):
        return False
    title = str(stop.get("title_en") or stop.get("title") or "")
    if is_armavir_stop(title) or is_armavir_stop(stop_place_name(stop)):
        return False
    place = stop_place_name(stop)
    if place:
        return False
    activity = stop_activity(stop).lower()
    blob = f"{activity} {title}".lower()
    if any(hint in blob for hint in LUNCH_HINTS):
        return True
    return is_activity_stop(title)


def names_fuzzy_match(left: str, right: str) -> bool:
    a = _norm(left)
    b = _norm(right)
    if len(a) < 3 or len(b) < 3:
        return False
    return a == b or a in b or b in a


def is_nominatim_region(lookup: dict[str, Any] | None) -> bool:
    if not lookup:
        return False
    cls = str(lookup.get("osm_class") or "").lower()
    typ = str(lookup.get("place_type") or "").lower()
    if cls in {"boundary", "place"} and typ in {"administrative", "state", "county"}:
        return True
    bbox = lookup.get("boundingbox")
    if isinstance(bbox, (list, tuple)) and len(bbox) == 4:
        try:
            south, north, west, east = (float(bbox[0]), float(bbox[1]), float(bbox[2]), float(bbox[3]))
        except (TypeError, ValueError):
            return False
        return abs(north - south) > 0.3 or abs(east - west) > 0.3
    return False


def parse_nominatim_item(item: dict[str, Any]) -> dict[str, Any] | None:
    try:
        lat = float(item["lat"])
        lon = float(item["lon"])
    except (KeyError, TypeError, ValueError):
        return None
    bbox_raw = item.get("boundingbox")
    bbox = None
    if isinstance(bbox_raw, (list, tuple)) and len(bbox_raw) == 4:
        try:
            bbox = (float(bbox_raw[0]), float(bbox_raw[1]), float(bbox_raw[2]), float(bbox_raw[3]))
        except (TypeError, ValueError):
            bbox = None
    return {
        "lat": lat,
        "lon": lon,
        "osm_class": str(item.get("class") or ""),
        "place_type": str(item.get("type") or ""),
        "boundingbox": bbox,
        "display_name": str(item.get("display_name") or ""),
    }


def choose_nominatim_hit(items: list[dict[str, Any]]) -> dict[str, Any] | None:
    parsed = [row for row in (parse_nominatim_item(item) for item in items if isinstance(item, dict)) if row]
    if not parsed:
        return None
    regions = [row for row in parsed if is_nominatim_region(row)]
    if regions:
        def area(row: dict[str, Any]) -> float:
            bbox = row.get("boundingbox") or (0, 0, 0, 0)
            return abs(float(bbox[1]) - float(bbox[0])) * abs(float(bbox[3]) - float(bbox[2]))

        return max(regions, key=area)
    return parsed[0]


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


def _latin_if_not_armenian(value: str) -> str:
    text = str(value or "").strip()
    if not text or ARMENIAN_RE.search(text):
        return ""
    return _latin_name(text)


def english_stop_name(stop: dict[str, Any], extra_names: list[str] | None = None) -> str:
    if isinstance(stop, dict):
        place = str(stop.get("place_name") or "").strip()
        if place and not ARMENIAN_RE.search(place) and not _activity_only_name(place):
            return place
        title_en = _latin_if_not_armenian(str(stop.get("title_en") or ""))
        if title_en:
            return title_en
        title = _latin_if_not_armenian(str(stop.get("title") or ""))
        if title:
            return title
        description = _latin_if_not_armenian(str(stop.get("description") or ""))
        if description:
            return description
    for extra in extra_names or []:
        latin = _latin_if_not_armenian(str(extra or ""))
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
        if is_lunch_or_rest_stop(stop):
            continue
        place = stop_place_name(stop)
        display = str(stop.get("title_en") or stop.get("title") or "").strip()
        if is_armavir_stop(place or display) or is_armavir_stop(str(stop.get("title") or "")):
            continue
        if place:
            for part in split_place_names(place):
                name = place_from_stop_title(_latin_name(part) or part) or part
                if name and not is_armavir_stop(name):
                    titles.append(name)
            continue
        if not display:
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
        elif isinstance(value, dict) and "lat" in value and "lon" in value:
            try:
                row = dict(value)
                row["lat"] = float(value["lat"])
                row["lon"] = float(value["lon"])
                _GEO_CACHE[str(key)] = row
            except (TypeError, ValueError):
                continue
        elif value is None:
            _GEO_CACHE[str(key)] = None


def _persist_geo_cache() -> None:
    try:
        serializable = {}
        for key, value in _GEO_CACHE.items():
            if isinstance(value, tuple):
                serializable[key] = list(value)
            elif isinstance(value, dict):
                serializable[key] = value
            else:
                serializable[key] = value
        _DISK_CACHE_PATH.write_text(json.dumps(serializable, ensure_ascii=False), encoding="utf-8")
    except OSError:
        return


def _lookup_has_meta(row: dict[str, Any] | None) -> bool:
    if not row:
        return False
    return bool(row.get("osm_class") or row.get("place_type") or row.get("boundingbox"))


def _coord_from_cache(cached: Any) -> dict[str, Any] | None:
    if cached is None:
        return None
    if isinstance(cached, dict) and "lat" in cached:
        return cached
    if isinstance(cached, (tuple, list)) and len(cached) == 2:
        return {
            "lat": float(cached[0]),
            "lon": float(cached[1]),
            "osm_class": "",
            "place_type": "",
            "boundingbox": None,
        }
    return None


def nominatim_lookup(name: str, region: str = "", *, require_meta: bool = False) -> dict[str, Any] | None:
    query = ", ".join(part for part in (name.strip(), region.strip(), "Armenia") if part)
    if not query:
        return None
    _ensure_disk_loaded()
    if query in _LOOKUP_MEM:
        mem = _LOOKUP_MEM.get(query)
        if mem is None or not require_meta or _lookup_has_meta(mem):
            return mem
    if query in _GEO_CACHE:
        cached = _GEO_CACHE.get(query)
        if cached is None:
            _LOOKUP_MEM[query] = None
            return None
        synthetic = _coord_from_cache(cached)
        if synthetic is not None and (not require_meta or _lookup_has_meta(synthetic)):
            _LOOKUP_MEM[query] = synthetic
            return synthetic
    with _NOMINATIM_LOCK:
        _ensure_disk_loaded()
        if query in _LOOKUP_MEM:
            mem = _LOOKUP_MEM.get(query)
            if mem is None or not require_meta or _lookup_has_meta(mem):
                return mem
        if query in _GEO_CACHE:
            cached = _GEO_CACHE.get(query)
            if cached is None:
                _LOOKUP_MEM[query] = None
                return None
            synthetic = _coord_from_cache(cached)
            if synthetic is not None and (not require_meta or _lookup_has_meta(synthetic)):
                _LOOKUP_MEM[query] = synthetic
                return synthetic
        _wait_nominatim_slot()
        qs = urllib.parse.urlencode({"q": query, "format": "json", "limit": "5"})
        url = NOMINATIM_URL.format(qs=qs)
        try:
            request = urllib.request.Request(url, headers={"user-agent": "ari-gnank-distance/1.0"})
            with urllib.request.urlopen(request, timeout=NOMINATIM_TIMEOUT_SEC) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ValueError, OSError):
            _GEO_CACHE[query] = None
            _LOOKUP_MEM[query] = None
            _persist_geo_cache()
            return None
        rows = payload if isinstance(payload, list) else []
        chosen = choose_nominatim_hit([item for item in rows if isinstance(item, dict)])
        if chosen is None:
            _GEO_CACHE[query] = None
            _LOOKUP_MEM[query] = None
            _persist_geo_cache()
            return None
        _GEO_CACHE[query] = chosen
        _LOOKUP_MEM[query] = chosen
        _persist_geo_cache()
        return chosen


def nominatim_coord(name: str, region: str = "") -> tuple[float, float] | None:
    lookup = nominatim_lookup(name, region)
    if lookup is None:
        return None
    try:
        return float(lookup["lat"]), float(lookup["lon"])
    except (KeyError, TypeError, ValueError):
        return None


def resolve_coord(name: str, region: str = "") -> tuple[tuple[float, float] | None, str]:
    geo = nominatim_coord(name, region)
    if geo is not None:
        return geo, "Nominatim"
    return None, "missing"


def armavir_distance_km(lat: float, lon: float) -> float:
    return round(_haversine_km(ARMAVIR_COORD, (lat, lon)), 1)


def pair_km(start: tuple[float, float], end: tuple[float, float]) -> tuple[float, bool]:
    sourced = _osrm_km(start, end)
    if sourced is not None:
        return sourced, True
    return _haversine_km(start, end) * HAVERSINE_FACTOR, False


def _lookup_named_coord(title: str, coords_by_name: dict[str, tuple[float, float]]) -> tuple[float, float] | None:
    if not title:
        return None
    for name, coord in coords_by_name.items():
        if names_fuzzy_match(title, name):
            return coord
    return None


def _stop_coord(
    title: str,
    stop: dict[str, Any] | None,
    region: str,
    coords_by_name: dict[str, tuple[float, float]],
) -> tuple[tuple[float, float] | None, str]:
    if isinstance(stop, dict):
        try:
            lat = float(stop.get("lat"))
            lon = float(stop.get("lon"))
            if lat != 0.0 or lon != 0.0:
                return (lat, lon), str(stop.get("coord_source") or "OSM")
        except (TypeError, ValueError):
            pass
    known = _lookup_named_coord(title, coords_by_name)
    if known is not None:
        return known, "OSM"
    return resolve_coord(title, region)


def _candidate_coord(row: dict[str, Any], region: str) -> tuple[tuple[float, float] | None, str]:
    try:
        lat = float(row.get("lat"))
        lon = float(row.get("lon"))
        if lat != 0.0 or lon != 0.0:
            return (lat, lon), str(row.get("coord_source") or "OSM")
    except (TypeError, ValueError):
        pass
    name = str(row.get("name_en") or "").strip()
    if not name:
        return None, "missing"
    return resolve_coord(name, region)


def _itinerary_blob(itinerary: list[Any]) -> str:
    parts: list[str] = []
    for stop in itinerary or []:
        if not isinstance(stop, dict):
            continue
        parts.extend(
            str(stop.get(key) or "")
            for key in ("place_name", "title_en", "title", "activity", "description")
        )
    return " ".join(parts).lower()


def _estimate_from_candidates(
    itinerary: list[Any],
    region: str,
    candidates: list[dict[str, Any]],
) -> tuple[float, list[dict[str, Any]], str]:
    blob = _itinerary_blob(itinerary)
    mentioned: list[dict[str, Any]] = []
    usable: list[tuple[dict[str, Any], tuple[float, float], str, float]] = []
    for row in candidates:
        if not isinstance(row, dict):
            continue
        name = str(row.get("name_en") or "").strip()
        if not name or is_armavir_stop(name):
            continue
        coord, how = _candidate_coord(row, region)
        if coord is None:
            continue
        dist = armavir_distance_km(coord[0], coord[1])
        usable.append((row, coord, how, dist))
        if name.lower() in blob:
            mentioned.append(row)
    if mentioned:
        ranked = [item for item in usable if str(item[0].get("name_en") or "") in {str(row.get("name_en") or "") for row in mentioned}]
        if ranked:
            nearest = min(ranked, key=lambda item: item[3])
            geo = {
                "name": str(nearest[0].get("name_en") or ""),
                "lat": round(nearest[1][0], 6),
                "lon": round(nearest[1][1], 6),
                "coord_source": nearest[2],
            }
            return round(nearest[3] * HAVERSINE_FACTOR, 1), [geo], "itinerary candidate"
    if region.strip() and (blob.strip() or usable):
        coord = nominatim_coord(region.strip(), "")
        if coord is not None:
            km = round(armavir_distance_km(coord[0], coord[1]) * HAVERSINE_FACTOR, 1)
            geo = {
                "name": region.strip(),
                "lat": round(coord[0], 6),
                "lon": round(coord[1], 6),
                "coord_source": "Nominatim",
            }
            return km, [geo], "region center"
    if usable:
        distances = sorted(item[3] for item in usable)
        mid = distances[len(distances) // 2]
        km = round(mid * HAVERSINE_FACTOR, 1)
        sample = usable[len(usable) // 2]
        geo = {
            "name": str(sample[0].get("name_en") or ""),
            "lat": round(sample[1][0], 6),
            "lon": round(sample[1][1], 6),
            "coord_source": sample[2],
        }
        return km, [geo], "median candidates"
    return 0.0, [], ""


def one_way_route_km(
    itinerary: list[Any],
    extra_names: list[str] | None = None,
    region: str = "",
    coords_by_name: dict[str, tuple[float, float]] | None = None,
    place_candidates: list[dict[str, Any]] | None = None,
) -> RouteKm:
    """Armavir -> each non-Armavir stop in order. No return leg. Never treats a failed geocode as 0 km of travel."""
    notes: list[str] = []
    geocoded_stops: list[dict[str, Any]] = []
    lookup = {str(key): value for key, value in (coords_by_name or {}).items() if value}
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
        km, geo_rows, how = _estimate_from_candidates(itinerary, region, list(place_candidates or []))
        if km > 0:
            if ROUTE_KM_ROUGH_NOTE not in notes:
                notes.append(ROUTE_KM_ROUGH_NOTE)
            if how:
                notes.append(f"Used {how} for route km")
            return RouteKm(km, False, notes, km_source="estimate", geocoded_stops=geo_rows)
        notes.append(NO_DESTINATION_STOPS_NOTE)
        return RouteKm(0.0, True, notes, km_source="", geocoded_stops=[])
    points: list[tuple[float, float]] = [ARMAVIR_COORD]
    last_ok = ARMAVIR_COORD
    used_osm = True
    stops_by_title = {}
    for stop in itinerary or []:
        if not isinstance(stop, dict) or is_lunch_or_rest_stop(stop):
            continue
        display = str(stop.get("title_en") or stop.get("title") or "").strip()
        name = stop_place_name(stop) or place_from_stop_title(_latin_name(display) or display)
        if name:
            stops_by_title[name] = stop
    for title in dests:
        coord, how = _stop_coord(title, stops_by_title.get(title), region, lookup)
        if coord is None:
            notes.append(f"Could not geocode stop: {title}; stop skipped")
            used_osm = False
            continue
        if how not in {"OSM", "OSM/Wikipedia"}:
            used_osm = False
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
            place_from_stop_title(_latin_if_not_armenian(str(item or "")) or str(item or ""))
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
        km, geo_rows, how = _estimate_from_candidates(itinerary, region, list(place_candidates or []))
        if km > 0:
            if ROUTE_KM_ROUGH_NOTE not in notes:
                notes.append(ROUTE_KM_ROUGH_NOTE)
            if how:
                notes.append(f"Used {how} for route km")
            return RouteKm(km, False, notes, km_source="estimate", geocoded_stops=geo_rows)
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
