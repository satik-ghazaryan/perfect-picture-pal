from __future__ import annotations

import ipaddress
import json
import logging
import os
import re
import socket
from html.parser import HTMLParser
from typing import Any
from urllib.parse import urljoin, urlparse

from agent.search import discovery_queries, run_place_attraction_search

LOGGER = logging.getLogger("ari.gnank.place_discovery")

PLACE_EXTRACT_SYSTEM = (
    "You extract geographic place names from tour preference text. "
    "Reply with JSON only. No markdown. "
    'Schema: {"place_en": string or null, "region_en": string or null}. '
    "place_en is the English name of the place or region the user asked for. "
    "region_en is the English region or province if it is stated, otherwise null. "
    "If the text has no place or region, both fields are null. "
    "Do not invent a destination. Do not list candidate places."
)
CANDIDATE_EXTRACT_SYSTEM = (
    "You extract CONCRETE named visitable places from page text. "
    "Reply with JSON only. No markdown. "
    'Schema: {"places": [{"name_en": "...", "type": "monastery|museum|fortress|park|church|village|other", "source_url": "..."}]}. '
    "A name is allowed only if it appears literally in the provided PAGE TEXT. "
    "Do not invent names. Do not use generic labels such as attractions, cultural sites, sightseeing, or tour. "
    "Max 12 places. If none, return {\"places\": []}."
)
USER_AGENT = "Mozilla/5.0 (compatible; AriGnankBot/1.0; +https://arignank.example)"
FETCH_TIMEOUT_SEC = 8.0
FETCH_MAX_BYTES = 300 * 1024
FETCH_URL_LIMIT = 4
CANDIDATE_LIMIT = 12
SKIP_PATH_RE = re.compile(
    r"(login|log-in|signin|sign-in|signup|sign-up|register|checkout|cart|booking|book-now|account|password|subscribe)",
    re.IGNORECASE,
)
NULL_NAMES = {"null", "none", "n/a", "-"}


class _HTMLTextParser(HTMLParser):
    _SKIP = {"script", "style", "noscript", "svg", "template", "iframe"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._skip = 0
        self._chunks: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in self._SKIP:
            self._skip += 1
        elif tag in {"p", "div", "br", "li", "tr", "h1", "h2", "h3", "h4", "section"}:
            self._chunks.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in self._SKIP and self._skip:
            self._skip -= 1
        elif tag in {"p", "div", "li", "tr", "h1", "h2", "h3", "h4"}:
            self._chunks.append("\n")

    def handle_data(self, data: str) -> None:
        if self._skip:
            return
        text = " ".join(data.split())
        if text:
            self._chunks.append(text)

    def text(self) -> str:
        return " ".join(" ".join(self._chunks).split())


def html_to_text(html: str) -> str:
    parser = _HTMLTextParser()
    try:
        parser.feed(str(html or ""))
        parser.close()
    except Exception:  # noqa: BLE001
        stripped = re.sub(r"(?is)<(script|style|noscript).*?>.*?</\1>", " ", str(html or ""))
        stripped = re.sub(r"(?s)<[^>]+>", " ", stripped)
        return " ".join(stripped.split())
    return parser.text()


def parse_place_json(data: Any) -> dict[str, str | None]:
    if not isinstance(data, dict):
        return {"place_en": None, "region_en": None}
    place = str(data.get("place_en") or "").strip() or None
    region = str(data.get("region_en") or "").strip() or None
    if place and place.lower() in NULL_NAMES:
        place = None
    if region and region.lower() in NULL_NAMES:
        region = None
    return {"place_en": place, "region_en": region}


def _extract_json(text: str) -> Any:
    raw = text.strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r"(\{[\s\S]*\}|\[[\s\S]*\])", raw)
        if not match:
            raise
        return json.loads(match.group(1))


def _ip_is_blocked(ip_text: str) -> bool:
    ip = ipaddress.ip_address(ip_text)
    return bool(
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    )


def _host_is_blocked(host: str, *, resolve: bool = True) -> bool:
    hostname = (host or "").strip().strip("[]").lower()
    if not hostname or hostname == "localhost" or hostname.endswith(".localhost"):
        return True
    try:
        return _ip_is_blocked(hostname)
    except ValueError:
        pass
    if not resolve:
        return False
    try:
        infos = socket.getaddrinfo(hostname, None)
    except OSError:
        return True
    addresses = {info[4][0] for info in infos if info and info[4]}
    if not addresses:
        return True
    try:
        return any(_ip_is_blocked(addr) for addr in addresses)
    except ValueError:
        return True


def is_public_http_url(url: str, *, resolve: bool = True) -> bool:
    parsed = urlparse(str(url or "").strip())
    if parsed.scheme not in {"http", "https"}:
        return False
    if parsed.username or parsed.password:
        return False
    host = parsed.hostname or ""
    if not host:
        return False
    return not _host_is_blocked(host, resolve=resolve)


def is_login_or_booking_url(url: str) -> bool:
    parsed = urlparse(str(url or ""))
    blob = f"{parsed.path or ''}?{parsed.query or ''}"
    return bool(SKIP_PATH_RE.search(blob))


def select_fetch_urls(results: list[dict[str, Any]], place_en: str = "") -> list[str]:
    place = place_en.lower().strip()
    picked: list[str] = []
    seen: set[str] = set()
    for row in results or []:
        if not isinstance(row, dict):
            continue
        url = str(row.get("url") or "").strip()
        if not url or url in seen:
            continue
        if not is_public_http_url(url, resolve=False) or is_login_or_booking_url(url):
            continue
        blob = f"{row.get('title') or ''} {row.get('snippet') or ''} {url}".lower()
        if place and place not in blob and "armenia" not in blob and "armenian" not in blob:
            continue
        seen.add(url)
        picked.append(url)
        if len(picked) >= FETCH_URL_LIMIT:
            break
    return picked


def fetch_page(url: str) -> str:
    if not is_public_http_url(url) or is_login_or_booking_url(url):
        return ""
    try:
        import httpx
    except ImportError:
        return ""
    current = url
    try:
        with httpx.Client(timeout=FETCH_TIMEOUT_SEC, follow_redirects=False, headers={"user-agent": USER_AGENT}) as client:
            for _hop in range(4):
                if not is_public_http_url(current) or is_login_or_booking_url(current):
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
                content_type = str(response.headers.get("content-type") or "").lower()
                if content_type and "html" not in content_type and "text" not in content_type:
                    return ""
                return (response.content or b"")[:FETCH_MAX_BYTES].decode("utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        return ""
    return ""


def fetch_attraction_pages(results: list[dict[str, Any]], place_en: str) -> list[dict[str, str]]:
    pages: list[dict[str, str]] = []
    for url in select_fetch_urls(results, place_en):
        html = fetch_page(url)
        text = html_to_text(html)[:12_000]
        if not text:
            continue
        pages.append({"url": url, "text": text})
    return pages


def _literal_in_text(name: str, blob: str) -> bool:
    needle = " ".join(str(name or "").split()).lower()
    if len(needle) < 3:
        return False
    return needle in blob


def parse_candidate_places(data: Any, pages: list[dict[str, str]]) -> list[dict[str, str]]:
    if isinstance(data, dict):
        rows = data.get("places") or data.get("candidates") or []
    else:
        rows = data
    if not isinstance(rows, list):
        return []
    blob_by_url = {str(page.get("url") or ""): str(page.get("text") or "").lower() for page in pages}
    combined = " ".join(blob_by_url.values())
    allowed_urls = set(blob_by_url)
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for row in rows:
        if not isinstance(row, dict):
            continue
        name = " ".join(str(row.get("name_en") or row.get("name") or "").split())
        if not name or name.lower() in seen or name.lower() in NULL_NAMES:
            continue
        if not _literal_in_text(name, combined):
            continue
        source = str(row.get("source_url") or "").strip()
        if source not in allowed_urls:
            source = next((url for url, text in blob_by_url.items() if _literal_in_text(name, text)), "")
        if not source:
            continue
        kind = str(row.get("type") or "other").strip() or "other"
        seen.add(name.lower())
        out.append({"name_en": name, "type": kind, "source_url": source})
        if len(out) >= CANDIDATE_LIMIT:
            break
    return out


def invoke_place_llm(preferences: str) -> dict[str, str | None]:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        return {"place_en": None, "region_en": None}
    from langchain_core.messages import HumanMessage, SystemMessage
    from langchain_openai import ChatOpenAI

    model = os.getenv("OPENAI_PLACE_MODEL", "").strip() or os.getenv("OPENAI_MODEL", "gpt-4o-mini").strip() or "gpt-4o-mini"
    llm = ChatOpenAI(model=model, temperature=0, api_key=api_key, timeout=45)
    response = llm.invoke(
        [
            SystemMessage(content=PLACE_EXTRACT_SYSTEM),
            HumanMessage(
                content=(
                    "Preference text:\n"
                    f"{preferences}\n\n"
                    'Return JSON only: {"place_en": "...", "region_en": "..."} '
                    "or nulls if no place is mentioned."
                )
            ),
        ]
    )
    content = response.content
    if not isinstance(content, str) or not content.strip():
        return {"place_en": None, "region_en": None}
    return parse_place_json(_extract_json(content))


def invoke_candidate_llm(place_en: str, pages: list[dict[str, str]]) -> list[dict[str, str]]:
    if not pages:
        return []
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        return []
    from langchain_core.messages import HumanMessage, SystemMessage
    from langchain_openai import ChatOpenAI

    model = os.getenv("OPENAI_PLACE_MODEL", "").strip() or os.getenv("OPENAI_MODEL", "gpt-4o-mini").strip() or "gpt-4o-mini"
    packed = []
    for page in pages:
        packed.append({"url": page.get("url"), "text": str(page.get("text") or "")[:4000]})
    llm = ChatOpenAI(model=model, temperature=0, api_key=api_key, timeout=60)
    response = llm.invoke(
        [
            SystemMessage(content=CANDIDATE_EXTRACT_SYSTEM),
            HumanMessage(
                content=(
                    f"Place/region: {place_en}\n"
                    "Extract visitable places in or near that place. Names MUST appear in PAGE TEXT.\n"
                    f"PAGE TEXT JSON:\n{json.dumps(packed, ensure_ascii=False)}"
                )
            ),
        ]
    )
    content = response.content
    if not isinstance(content, str) or not content.strip():
        return []
    try:
        parsed = _extract_json(content)
    except (json.JSONDecodeError, ValueError):
        return []
    return parse_candidate_places(parsed, pages)


def extract_place_candidates(place_en: str, pages: list[dict[str, str]]) -> list[dict[str, str]]:
    try:
        return invoke_candidate_llm(place_en, pages)
    except Exception:  # noqa: BLE001
        return []


def log_discovery(place_en: str, pages: int, candidates: int, accepted: list[str] | None = None, dropped: list[str] | None = None) -> None:
    accepted = accepted or []
    dropped = dropped or []
    line = (
        f"place_discovery place_en={place_en!r} pages={pages} candidates={candidates} "
        f"accepted={accepted} dropped={dropped}"
    )
    LOGGER.info(line)
    print(line, flush=True)


def discover_place(preferences: str) -> dict[str, Any]:
    prefs = str(preferences or "").strip()
    empty = {
        "place_en": None,
        "region_en": None,
        "queries": [],
        "results": [],
        "place_candidates": [],
        "pages_fetched": 0,
        "skipped": "no_preferences",
    }
    if not prefs:
        log_discovery("", 0, 0)
        return empty
    try:
        extracted = invoke_place_llm(prefs)
    except Exception:  # noqa: BLE001
        extracted = {"place_en": None, "region_en": None}
    place_en = extracted.get("place_en")
    region_en = extracted.get("region_en")
    if not place_en:
        log_discovery("", 0, 0)
        return {
            **empty,
            "region_en": region_en,
            "skipped": "no_place",
        }
    search_payload = run_place_attraction_search(place_en)
    results = [row for row in (search_payload.get("results") or []) if isinstance(row, dict)]
    pages = fetch_attraction_pages(results, place_en)
    candidates = extract_place_candidates(place_en, pages)
    log_discovery(str(place_en), len(pages), len(candidates))
    return {
        "place_en": place_en,
        "region_en": region_en,
        "queries": search_payload.get("queries") or discovery_queries(place_en),
        "results": results,
        "search_status": search_payload.get("search_status") or "",
        "place_candidates": candidates,
        "pages_fetched": len(pages),
        "skipped": "",
    }
