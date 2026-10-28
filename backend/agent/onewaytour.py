from __future__ import annotations

import json
import os
import re
import threading
import time
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse
from urllib.robotparser import RobotFileParser

from agent.distance import armavir_distance_km, names_fuzzy_match, nominatim_coord
from agent.place_discovery import is_login_or_booking_url, is_public_http_url
from agent.search import conversion_rate

USER_AGENT = "Mozilla/5.0 (compatible; AriGnank/1.0; +https://arignank.example)"
BASE = "https://onewaytour.com"
ROBOTS_URL = f"{BASE}/robots.txt"
GROUP_TOURS_URL = f"{BASE}/group-tours"
TOUR_XML_URL = f"{BASE}/tour.xml"
TIMEOUT_SEC = 8.0
MAX_PAGES = 6
MIN_INTERVAL_SEC = 1.0
CACHE_TTL_SEC = 24 * 60 * 60
MAX_BYTES = 400 * 1024
UNAVAILABLE = "OneWayTour data unavailable"
COMPANY = "OneWayTour"
SKIP_PLACE = {
    "lunch",
    "hotel pickup",
    "pickup",
    "drop-off",
    "drop off",
    "yerevan",
    "free time",
    "lavash baking",
    "master class",
}
MULTI_DAY_RE = re.compile(
    r"\b(?:two|three|four|five|six|seven|eight|nine|ten|[2-9]|[1-9]\d)\s*-?\s*days?\b",
    re.I,
)
DAY_TOUR_RE = re.compile(r"(?<![0-9-])\bday tour\b|\bone[- ]day\b|\b1[- ]day\b", re.I)
DURATION_ISO_RE = re.compile(r"PT(?:(\d+)H)?(?:(\d+)M)?", re.I)
DURATION_PERIOD_RE = re.compile(r"\bP(\d+)D\b", re.I)
NIGHTS_RE = re.compile(r"\bovernight\b|\b([2-9]|[1-9]\d)\s*-?\s*nights?\b", re.I)
PLACE_SPLIT_RE = re.compile(r"\s*,\s*|\s*&\s*|\s+and\s+", re.I)
TITLE_JUNK_RE = re.compile(
    r"\b(day tour|group tour|private tour|tour|experience|package)\b",
    re.I,
)
FOREIGN_RE = re.compile(r"\b(tbilisi|georgia|signagi|mtskheta|iran|tehran)\b", re.I)
LOC_RE = re.compile(r"<loc>\s*([^<]+)\s*</loc>", re.I)
LANG_PATH_RE = re.compile(r"^/(hy|ru|fr|es|de|it|ar|zh|hi|pl)/")
GENERIC_TOKENS = {
    "tour",
    "tours",
    "day",
    "group",
    "private",
    "the",
    "and",
    "with",
    "from",
    "armenia",
    "armenian",
    "package",
    "packages",
    "experience",
    "monastery",
    "church",
    "temple",
    "fortress",
    "museum",
    "lake",
    "waterfall",
}

_MEM: dict[str, tuple[float, Any]] = {}
_MEM_LOCK = threading.Lock()
_RATE_LOCK = threading.Lock()
_LAST_REQUEST = 0.0
_DISK_PATH = Path(__file__).resolve().parent.parent / ".onewaytour_cache.json"


class _TitleParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._in_h1 = False
        self.h1 = ""

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "h1":
            self._in_h1 = True

    def handle_endtag(self, tag: str) -> None:
        if tag == "h1":
            self._in_h1 = False

    def handle_data(self, data: str) -> None:
        if self._in_h1:
            self.h1 += data


def clear_onewaytour_cache() -> None:
    with _MEM_LOCK:
        _MEM.clear()


def _cache_get(key: str) -> Any | None:
    now = time.time()
    with _MEM_LOCK:
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
    if now - stamped > CACHE_TTL_SEC:
        return None
    value = item.get("value")
    with _MEM_LOCK:
        _MEM[key] = (stamped, value)
    return value


def _cache_set(key: str, value: Any) -> None:
    now = time.time()
    with _MEM_LOCK:
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


def _wait_slot() -> None:
    global _LAST_REQUEST
    with _RATE_LOCK:
        now = time.monotonic()
        wait = MIN_INTERVAL_SEC - (now - _LAST_REQUEST)
        if wait > 0:
            time.sleep(wait)
        _LAST_REQUEST = time.monotonic()


_BLOCKED_PATHS = (
    "/search-results",
    "/ai-search",
    "/login",
    "/register",
    "/admin",
    "/profile",
    "/orders/",
    "/leave-review",
    "/telcell",
)


def _robots_url(url: str) -> str:
    parsed = urlparse(url)
    return parsed._replace(query="", fragment="").geturl()


def _path_blocked(url: str) -> bool:
    path = (urlparse(url).path or "").lower()
    return any(path == item or path.startswith(item.rstrip("/") + "/") or path.startswith(item) for item in _BLOCKED_PATHS)


def _can_fetch(robots: RobotFileParser | None, url: str) -> bool:
    if robots is None:
        return False
    if _path_blocked(url):
        return False
    try:
        return bool(robots.can_fetch(USER_AGENT, _robots_url(url)))
    except Exception:  # noqa: BLE001
        return False


def fetch_url(url: str, *, robots: RobotFileParser | None, budget: dict[str, int], force: bool = False) -> str:
    if budget["used"] >= budget["max"]:
        return ""
    if not is_public_http_url(url) or is_login_or_booking_url(url):
        return ""
    if not force and not _can_fetch(robots, url):
        return ""
    cached = _cache_get(f"body:{url}")
    if isinstance(cached, str):
        budget["used"] += 1
        return cached
    try:
        import httpx
    except ImportError:
        return ""
    _wait_slot()
    budget["used"] += 1
    try:
        with httpx.Client(timeout=TIMEOUT_SEC, follow_redirects=False, headers={"user-agent": USER_AGENT}) as client:
            current = url
            for _hop in range(4):
                if not is_public_http_url(current) or is_login_or_booking_url(current):
                    return ""
                if not force and current != url and not _can_fetch(robots, current):
                    return ""
                response = client.get(current)
                if response.status_code in {301, 302, 303, 307, 308}:
                    location = str(response.headers.get("location") or "").strip()
                    if not location:
                        return ""
                    current = urljoin(current, location)
                    continue
                if response.status_code >= 400:
                    return ""
                body = (response.content or b"")[:MAX_BYTES].decode("utf-8", errors="replace")
                _cache_set(f"body:{url}", body)
                return body
    except Exception:  # noqa: BLE001
        return ""
    return ""


def parse_robots(text: str) -> RobotFileParser:
    parser = RobotFileParser()
    parser.parse(str(text or "").splitlines())
    return parser


def extract_english_tour_urls(xml: str) -> list[str]:
    urls: list[str] = []
    seen: set[str] = set()
    for loc in LOC_RE.findall(xml or ""):
        url = str(loc).strip()
        if not url.startswith(f"{BASE}/"):
            continue
        path = urlparse(url).path or ""
        if LANG_PATH_RE.match(path):
            continue
        if _path_blocked(url) or is_login_or_booking_url(url):
            continue
        if url in seen:
            continue
        seen.add(url)
        urls.append(url)
    return urls


def urls_matching_names(urls: list[str], names: list[str] | None) -> list[str]:
    tokens = match_tokens(names)
    if not tokens:
        return []
    matched: list[str] = []
    for url in urls:
        path_tokens = match_tokens([str(url).replace("-", " ").replace("/", " ")])
        if path_tokens & tokens:
            matched.append(url)
    return matched


def fetch_sitemap_locs(robots: RobotFileParser | None, budget: dict[str, int]) -> list[str]:
    cached = _cache_get(f"locs:{TOUR_XML_URL}")
    if isinstance(cached, list):
        return [str(item) for item in cached]
    if budget["used"] >= budget["max"] or not _can_fetch(robots, TOUR_XML_URL):
        return []
    try:
        import httpx
    except ImportError:
        return []
    _wait_slot()
    budget["used"] += 1
    chunks: list[str] = []
    total = 0
    try:
        with httpx.Client(timeout=TIMEOUT_SEC, follow_redirects=True, headers={"user-agent": USER_AGENT}) as client:
            with client.stream("GET", TOUR_XML_URL) as response:
                if response.status_code >= 400:
                    return []
                for piece in response.iter_text():
                    chunks.append(piece)
                    total += len(piece)
                    if total > 6_000_000:
                        break
    except Exception:  # noqa: BLE001
        return []
    urls = extract_english_tour_urls("".join(chunks))
    _cache_set(f"locs:{TOUR_XML_URL}", urls)
    return urls


def _json_ld_blocks(html: str) -> list[Any]:
    blocks: list[Any] = []
    text = html or ""
    lower = text.lower()
    idx = 0
    marker = "application/ld+json"
    while True:
        pos = lower.find(marker, idx)
        if pos < 0:
            break
        gt = text.find(">", pos)
        if gt < 0:
            break
        end = lower.find("</script>", gt)
        if end < 0:
            break
        raw = text[gt + 1 : end].strip()
        idx = end + 9
        if not raw:
            continue
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if isinstance(data, list):
            blocks.extend(item for item in data if isinstance(item, dict))
        elif isinstance(data, dict):
            blocks.append(data)
    return blocks


def _as_list(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


def _type_set(value: Any) -> set[str]:
    if isinstance(value, list):
        return {str(item) for item in value}
    return {str(value or "")}


def _offer_price(offer: Any) -> tuple[float, str, int]:
    if not isinstance(offer, dict):
        return 0.0, "", 0
    amount = offer.get("price")
    try:
        numeric = float(str(amount).replace(",", "").replace(" ", ""))
    except (TypeError, ValueError):
        numeric = 0.0
    currency = str(offer.get("priceCurrency") or offer.get("currency") or "AMD").upper()
    rate, estimated = conversion_rate(currency)
    if rate <= 0 or numeric <= 0:
        return numeric, currency, 0
    amd = int(round(numeric * rate)) if currency != "AMD" else int(round(numeric))
    return numeric, currency, amd


def _duration_days(blob: str, extra: Any = None) -> float | None:
    text = str(blob or "")
    iso = extra if extra is not None else ""
    if not isinstance(iso, str):
        iso = json.dumps(iso, ensure_ascii=False)
    hay = f"{text} {iso}"
    period = DURATION_PERIOD_RE.search(iso) or DURATION_PERIOD_RE.search(text)
    if period:
        try:
            days = float(period.group(1))
        except (TypeError, ValueError):
            days = None
        if days is not None:
            return days
    match = DURATION_ISO_RE.search(iso)
    if match:
        hours = int(match.group(1) or 0) + int(match.group(2) or 0) / 60.0
        if hours:
            return 1.0 if hours <= 16 else round(hours / 8.0, 1)
    multi = MULTI_DAY_RE.search(hay)
    if multi:
        try:
            return float(multi.group(1))
        except (TypeError, ValueError):
            return None
    if NIGHTS_RE.search(hay):
        return 2.0
    if DAY_TOUR_RE.search(hay) or "/group-tours/" in hay:
        return 1.0
    return None


def _places_from_title(name: str) -> list[str]:
    cleaned = TITLE_JUNK_RE.sub(" ", str(name or ""))
    parts = [part.strip(" .") for part in PLACE_SPLIT_RE.split(cleaned) if part.strip(" .")]
    out: list[str] = []
    seen: set[str] = set()
    for part in parts:
        key = part.lower()
        if len(part) < 3 or key in seen or key in SKIP_PLACE:
            continue
        seen.add(key)
        out.append(part)
    return out


def _places_from_itinerary(node: Any) -> list[str]:
    names: list[str] = []
    seen: set[str] = set()

    def add(name: str) -> None:
        text = " ".join(str(name or "").split())
        key = text.lower()
        if not text or key in seen or key in SKIP_PLACE or "lunch" in key or "pickup" in key:
            return
        seen.add(key)
        names.append(text)

    for item in _as_list(node):
        if not isinstance(item, dict):
            continue
        if "itemListElement" in item:
            names.extend(_places_from_itinerary(item.get("itemListElement")))
            continue
        place = item.get("item") if isinstance(item.get("item"), dict) else None
        if isinstance(place, dict) and "Place" in str(place.get("@type") or "Place"):
            add(str(place.get("name") or ""))
        add(str(item.get("name") or ""))
    return names


def _h1(html: str) -> str:
    parser = _TitleParser()
    try:
        parser.feed(html)
        parser.close()
    except Exception:  # noqa: BLE001
        return ""
    return " ".join(parser.h1.split())


def parse_tour_html(html: str, url: str) -> dict[str, Any] | None:
    blocks = _json_ld_blocks(html)
    trip: dict[str, Any] = {}
    product: dict[str, Any] = {}
    for block in blocks:
        types = _type_set(block.get("@type"))
        if "TouristTrip" in types:
            trip = block
        elif "Product" in types:
            product = block
    source = trip or product
    if not source:
        name = _h1(html)
        if not name:
            return None
        source = {"name": name, "url": url}
    name = str(source.get("name") or _h1(html) or "").strip()
    page_url = str(source.get("url") or url).strip() or url
    amount, currency, amd = _offer_price(source.get("offers") or product.get("offers"))
    duration_raw = source.get("duration") or ""
    duration_days = _duration_days(f"{name} {page_url}", duration_raw)
    departure = "Yerevan"
    itinerary_places = _places_from_itinerary(source.get("itinerary"))
    places = itinerary_places or _places_from_title(name)
    if FOREIGN_RE.search(f"{name} {page_url}"):
        return None
    return {
        "name": name,
        "url": page_url,
        "price_amd": amd or None,
        "observed_amount": amount,
        "observed_currency": currency,
        "duration": str(duration_raw or ("1 day" if duration_days == 1 else "")),
        "duration_days": duration_days,
        "departure_city": departure,
        "places": places,
    }


def parse_group_list_html(html: str) -> list[dict[str, Any]]:
    tours: list[dict[str, Any]] = []
    seen: set[str] = set()
    for block in _json_ld_blocks(html):
        types = _type_set(block.get("@type"))
        if "CollectionPage" not in types and "ItemList" not in types:
            continue
        entity = block.get("mainEntity") if isinstance(block.get("mainEntity"), dict) else block
        for item in _as_list(entity.get("itemListElement") if isinstance(entity, dict) else []):
            if not isinstance(item, dict):
                continue
            node = item.get("item") if isinstance(item.get("item"), dict) else item
            if not isinstance(node, dict):
                continue
            url = str(node.get("url") or item.get("url") or "").strip()
            name = str(node.get("name") or "").strip()
            if not url or url in seen:
                continue
            parsed = urlparse(url)
            if parsed.netloc and parsed.netloc != "onewaytour.com":
                continue
            if FOREIGN_RE.search(f"{name} {url}"):
                continue
            amount, currency, amd = _offer_price(node.get("offers"))
            duration_days = _duration_days(f"{name} {url}")
            seen.add(url)
            tours.append(
                {
                    "name": name,
                    "url": url,
                    "price_amd": amd or None,
                    "observed_amount": amount,
                    "observed_currency": currency,
                    "duration": "1 day" if duration_days == 1 else "",
                    "duration_days": duration_days,
                    "departure_city": "Yerevan",
                    "places": _places_from_title(name),
                }
            )
    return tours


def match_tokens(names: list[str] | tuple[str, ...] | None) -> set[str]:
    tokens: set[str] = set()
    for name in names or []:
        for part in re.split(r"[^a-zA-Z]+", str(name or "").lower()):
            if len(part) >= 4 and part not in GENERIC_TOKENS:
                tokens.add(part)
    return tokens


def is_one_day_tour(tour: dict[str, Any]) -> bool:
    url = str(tour.get("url") or "")
    name = str(tour.get("name") or "")
    blob = f"{name} {url} {tour.get('duration') or ''}"
    if MULTI_DAY_RE.search(blob) or NIGHTS_RE.search(blob):
        return False
    days = tour.get("duration_days")
    if days is not None:
        try:
            return float(days) <= 1.0
        except (TypeError, ValueError):
            pass
    return True


def tour_matches_names(tour: dict[str, Any], names: list[str] | None) -> bool:
    needles = [str(item).strip() for item in (names or []) if str(item).strip()]
    if not needles:
        return False
    hay_parts = [str(tour.get("name") or "")] + [str(item) for item in (tour.get("places") or [])] + [str(tour.get("url") or "")]
    hay_tokens = match_tokens(hay_parts)
    if match_tokens(needles) & hay_tokens:
        return True
    for needle in needles:
        for part in hay_parts:
            if names_fuzzy_match(needle, part):
                return True
    return False


def partition_tours(
    tours: list[dict[str, Any]],
    names: list[str] | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[str]]:
    matched: list[dict[str, Any]] = []
    other: list[dict[str, Any]] = []
    reasons: list[str] = []
    for tour in tours or []:
        if not isinstance(tour, dict):
            continue
        title = str(tour.get("name") or tour.get("url") or "")[:80]
        if not is_one_day_tour(tour):
            reasons.append(f"duration>1 day: {title}")
            continue
        if tour_matches_names(tour, names):
            matched.append(tour)
        else:
            other.append(tour)
            reasons.append(f"no place overlap: {title}")
    return matched, other, reasons


def idea_match_names(idea: dict[str, Any] | None, research: dict[str, Any] | None) -> list[str]:
    names: list[str] = []
    if isinstance(research, dict):
        names.extend(str(research.get("place_en") or "").strip().split("\n")[:1])
        names.append(str(research.get("region_en") or ""))
        for row in research.get("place_candidates") or []:
            if isinstance(row, dict):
                names.append(str(row.get("name_en") or ""))
    if isinstance(idea, dict):
        names.append(str(idea.get("location_en") or ""))
        for stop in idea.get("itinerary") or []:
            if not isinstance(stop, dict):
                continue
            names.append(str(stop.get("place_name") or ""))
            names.append(str(stop.get("title_en") or ""))
    return [item for item in names if item.strip()]


def _relevant(tour: dict[str, Any], place_en: str, region_en: str, extra_names: list[str] | None = None) -> bool:
    return tour_matches_names(tour, [place_en, region_en, *(extra_names or [])])


def _offer_from_tour(tour: dict[str, Any], retrieved_at: str) -> dict[str, Any] | None:
    amd = int(tour.get("price_amd") or 0)
    if amd <= 0:
        return None
    if not is_one_day_tour(tour):
        return None
    currency = str(tour.get("observed_currency") or "AMD")
    amount = tour.get("observed_amount") or amd
    rate, estimated = conversion_rate(currency)
    return {
        "title": str(tour.get("name") or "")[:240],
        "url": str(tour.get("url") or ""),
        "observed_price_amd": amd,
        "observed_amount": amount,
        "observed_currency": currency,
        "conversion_rate": rate,
        "conversion_estimated": estimated and currency != "AMD",
        "found_on": retrieved_at,
        "label": "market_reference",
        "snippet": "Market reference. Competitor price is not confirmed.",
        "company": COMPANY,
        "retrieved_at": retrieved_at,
        "duration_days": 1,
    }


def _resolve_place_coords(names: list[str], region: str, source_url: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for name in names:
        key = name.lower()
        if key in seen:
            continue
        seen.add(key)
        coord = nominatim_coord(name, region)
        row: dict[str, Any] = {
            "name_en": name,
            "type": "other",
            "source_url": source_url,
            "coord_source": "",
        }
        if coord is not None:
            row["lat"] = coord[0]
            row["lon"] = coord[1]
            row["coord_source"] = "Nominatim"
            row["distance_from_armavir_km"] = armavir_distance_km(coord[0], coord[1])
        out.append(row)
        if len(out) >= 12:
            break
    return out


def _public_tour(tour: dict[str, Any], *, matched: bool) -> dict[str, Any]:
    return {
        "name": tour.get("name"),
        "url": tour.get("url"),
        "price_amd": tour.get("price_amd"),
        "duration": tour.get("duration"),
        "departure_city": tour.get("departure_city"),
        "places": list(tour.get("places") or []),
        "matched": matched,
        "duration_days": tour.get("duration_days"),
    }


def collect_onewaytour(
    place_en: str = "",
    region_en: str = "",
    match_names: list[str] | None = None,
) -> dict[str, Any]:
    retrieved_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    empty = {
        "unavailable": True,
        "tours": [],
        "offers": [],
        "place_candidates": [],
        "verify": UNAVAILABLE,
        "retrieved_at": retrieved_at,
        "pages_fetched": 0,
        "debug": {"fetched": 0, "one_day": 0, "matched": 0, "offers": 0, "reasons": ["unreachable"]},
    }
    needles = [item for item in [place_en, region_en, *(match_names or [])] if str(item).strip()]
    budget = {"used": 0, "max": MAX_PAGES}
    robots_text = fetch_url(ROBOTS_URL, robots=None, budget=budget, force=True)
    if not robots_text:
        return empty
    robots = parse_robots(robots_text)
    if not _can_fetch(robots, GROUP_TOURS_URL):
        return empty
    list_html = fetch_url(GROUP_TOURS_URL, robots=robots, budget=budget)
    if not list_html:
        return empty
    tours = parse_group_list_html(list_html)
    ranked = sorted(
        tours,
        key=lambda row: (0 if tour_matches_names(row, needles) else 1, row.get("name") or ""),
    )
    picked: list[dict[str, Any]] = []
    seen_urls: set[str] = set()

    def _take_detail(url: str, fallback: dict[str, Any] | None = None) -> None:
        if not url or url in seen_urls or not _can_fetch(robots, url):
            return
        if budget["used"] >= budget["max"]:
            if fallback:
                picked.append(fallback)
                seen_urls.add(url)
            return
        html = fetch_url(url, robots=robots, budget=budget)
        seen_urls.add(url)
        if not html:
            if fallback:
                picked.append(fallback)
            return
        parsed = parse_tour_html(html, url)
        picked.append(parsed or fallback or {"name": url, "url": url, "places": []})

    for tour in ranked:
        if not tour_matches_names(tour, needles):
            continue
        if len([row for row in picked if tour_matches_names(row, needles)]) >= 4:
            break
        _take_detail(str(tour.get("url") or ""), tour)
    if needles and not any(tour_matches_names(row, needles) for row in picked) and budget["used"] < budget["max"]:
        locs = fetch_sitemap_locs(robots, budget)
        for url in urls_matching_names(locs, needles):
            if budget["used"] >= budget["max"]:
                break
            if len([row for row in picked if tour_matches_names(row, needles)]) >= 3:
                break
            _take_detail(url, {"name": url.rsplit("/", 1)[-1].replace("-", " "), "url": url, "places": []})
    for tour in tours:
        url = str(tour.get("url") or "")
        if url and url not in seen_urls:
            picked.append(tour)
            seen_urls.add(url)
    one_day = [tour for tour in picked if is_one_day_tour(tour)]
    matched, other, reasons = partition_tours(picked, needles)
    if not needles:
        other = list(one_day)
        matched = []
        reasons = ["no match names supplied"]
    offers = []
    seen_offer: set[str] = set()
    skipped_price = 0
    for tour in matched:
        offer = _offer_from_tour(tour, retrieved_at)
        key = str((offer or {}).get("url") or "")
        if not offer:
            skipped_price += 1
            reasons.append(f"no price: {str(tour.get('name') or '')[:80]}")
            continue
        if not key or key in seen_offer:
            continue
        seen_offer.add(key)
        offers.append(offer)
    candidates: list[dict[str, Any]] = []
    seen_place: set[str] = set()
    region = region_en or place_en
    for tour in matched:
        url = str(tour.get("url") or "")
        for row in _resolve_place_coords(list(tour.get("places") or []), region, url):
            key = str(row.get("name_en") or "").lower()
            if not key or key in seen_place:
                continue
            seen_place.add(key)
            candidates.append(row)
    public_tours = [_public_tour(tour, matched=True) for tour in matched] + [
        _public_tour(tour, matched=False) for tour in other
    ]
    debug = {
        "fetched": len(picked),
        "one_day": len(one_day),
        "matched": len(matched),
        "offers": len(offers),
        "other_one_day": len(other),
        "skipped_no_price": skipped_price,
        "reasons": reasons[:12],
        "pages_fetched": budget["used"],
    }
    if os.getenv("DEBUG_IDEAS", "").strip() == "1":
        print(
            f"onewaytour_debug fetched={debug['fetched']} one_day={debug['one_day']} "
            f"matched={debug['matched']} offers={debug['offers']} other={debug['other_one_day']} "
            f"reasons={debug['reasons']}",
            flush=True,
        )
    return {
        "unavailable": False,
        "tours": public_tours,
        "offers": offers,
        "place_candidates": candidates,
        "verify": "",
        "retrieved_at": retrieved_at,
        "pages_fetched": budget["used"],
        "debug": debug,
    }
