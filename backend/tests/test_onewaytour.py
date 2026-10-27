from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

from agent.distance import english_stop_name, one_way_route_km
from agent.graph import _preserve_stop_english, refinement_node
from agent.onewaytour import (
    COMPANY,
    UNAVAILABLE,
    collect_onewaytour,
    parse_group_list_html,
    parse_robots,
    parse_tour_html,
)
from agent.pricing import apply_unit_economics, choose_suggested_price

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "onewaytour_day_tour.html"

ROBOTS_ALLOW = """User-agent: *
Allow: /
Disallow: /search-results
Disallow: /login
"""

ROBOTS_BLOCK_GROUP = """User-agent: *
Disallow: /group-tours
Allow: /
"""

LIST_HTML = """
<html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"CollectionPage","url":"https://onewaytour.com/group-tours","mainEntity":{"@type":"ItemList","itemListElement":[{"@type":"ListItem","position":1,"url":"https://onewaytour.com/group-tours/garni-geghard-lake-sevan-dilijan-day-tour","item":{"@type":["Product","TouristTrip"],"name":"Garni, Geghard, Lake Sevan & Dilijan Day Tour","url":"https://onewaytour.com/group-tours/garni-geghard-lake-sevan-dilijan-day-tour","offers":{"@type":"Offer","price":11500,"priceCurrency":"AMD"}}},{"@type":"ListItem","position":2,"url":"https://onewaytour.com/group-tours/secret","item":{"@type":"Product","name":"Hidden","url":"https://onewaytour.com/search-results?q=secret","offers":{"@type":"Offer","price":9000,"priceCurrency":"AMD"}}}]}}
</script>
</head><body></body></html>
"""


class TestOneWayTour:
    def test_parse_saved_tour_page(self) -> None:
        html = FIXTURE.read_text(encoding="utf-8")
        parsed = parse_tour_html(html, "https://onewaytour.com/group-tours/garni-geghard-lake-sevan-dilijan-day-tour")
        assert parsed is not None
        assert parsed["name"] == "Garni, Geghard, Lake Sevan & Dilijan Day Tour"
        assert parsed["price_amd"] == 11500
        assert parsed["duration_days"] == 1.0
        assert parsed["departure_city"] == "Yerevan"
        assert "Geghard Monastery" in parsed["places"]
        assert "Garni Temple" in parsed["places"]
        assert "Lake Sevan" in parsed["places"]

    def test_robots_respected(self, monkeypatch) -> None:
        fetched: list[str] = []

        def fake_fetch(url: str, *, robots=None, budget=None, force: bool = False) -> str:
            fetched.append(url)
            if "robots.txt" in url:
                return ROBOTS_ALLOW
            if url.endswith("/group-tours"):
                return LIST_HTML
            if "search-results" in url:
                raise AssertionError("disallowed URL fetched")
            return FIXTURE.read_text(encoding="utf-8")

        monkeypatch.setattr("agent.onewaytour.fetch_url", fake_fetch)
        with patch("agent.onewaytour.nominatim_coord", return_value=(40.11, 44.73)):
            payload = collect_onewaytour("Garni", "Kotayk")
        assert payload["unavailable"] is False
        assert all("search-results" not in url for url in fetched)
        assert any(offer["company"] == COMPANY for offer in payload["offers"])
        assert payload["offers"][0]["observed_price_amd"] == 11500

    def test_robots_block_skips_site(self, monkeypatch) -> None:
        def fake_fetch(url: str, *, robots=None, budget=None, force: bool = False) -> str:
            if "robots.txt" in url:
                return ROBOTS_BLOCK_GROUP
            raise AssertionError(f"should not fetch {url}")

        monkeypatch.setattr("agent.onewaytour.fetch_url", fake_fetch)
        payload = collect_onewaytour("Garni", "")
        assert payload["unavailable"] is True
        assert payload["verify"] == UNAVAILABLE

    def test_list_parser_skips_disallowed_like_urls(self) -> None:
        tours = parse_group_list_html(LIST_HTML)
        urls = [row["url"] for row in tours]
        assert "https://onewaytour.com/group-tours/garni-geghard-lake-sevan-dilijan-day-tour" in urls

    def test_competitor_offers_feed_market_band(self) -> None:
        offers = [
            {
                "title": "Garni day tour",
                "url": "https://onewaytour.com/group-tours/garni-geghard-lake-sevan-dilijan-day-tour",
                "observed_price_amd": 11500,
                "company": COMPANY,
                "duration_days": 1,
                "label": "market_reference",
            }
        ]
        suggested, position, market = choose_suggested_price(5000, offers)
        assert market["offer_count"] == 1
        assert market["price_min_amd"] == 11500
        assert suggested >= 5000
        assert position in {"below_market", "in_range", "above_market"}

    def test_hy_adapt_mangle_still_yields_km(self) -> None:
        original = [
            {
                "time": "08:00",
                "place_name": "Armavir",
                "activity": "departure",
                "title_en": "Armavir — departure",
                "title": "Armavir — departure",
                "source_url": "https://example.com/a",
            },
            {
                "time": "11:00",
                "place_name": "Haghpat Monastery",
                "activity": "visit",
                "title_en": "Haghpat Monastery — visit",
                "title": "Haghpat Monastery — visit",
                "source_url": "https://en.wikipedia.org/wiki/Haghpat_Monastery",
                "lat": 41.0936,
                "lon": 44.7119,
            },
            {
                "time": "13:00",
                "place_name": None,
                "activity": "lunch",
                "title_en": "Lunch",
                "title": "Lunch",
            },
        ]
        adapted = [
            {
                "time": "08:00",
                "title": "Արմավիր — մեկնում",
                "place_name": None,
            },
            {
                "time": "11:00",
                "title": "Ախպատ (Akhtala) Մոնաստեր — այցելություն",
                "title_en": "Akhtala Monastery — visit",
                "place_name": None,
            },
            {
                "time": "13:00",
                "title": "Ձեռնարկություն",
                "activity": "lunch",
            },
        ]
        restored = _preserve_stop_english(original, adapted)
        assert restored[1]["place_name"] == "Haghpat Monastery"
        assert restored[1]["source_url"].endswith("Haghpat_Monastery")
        assert restored[1]["lat"] == 41.0936
        assert restored[2]["activity"] == "lunch"
        assert "Akhtala" not in str(restored[1]["place_name"])
        armenian = "Ախպատ (Akhtala) Մոնաստեր — այցելություն"
        assert english_stop_name({"title": armenian, "place_name": restored[1]["place_name"]}) == "Haghpat Monastery"
        assert english_stop_name({"title": armenian}) == ""
        with patch("agent.distance._osrm_km", return_value=None):
            route = one_way_route_km(
                restored,
                region="Lori",
                coords_by_name={"Haghpat Monastery": (41.0936, 44.7119)},
            )
        assert route.km > 0
        names = [row["name"] for row in route.geocoded_stops]
        assert "Lunch" not in names
        assert not any("lunch" in str(name).lower() for name in names)

    def test_price_never_null_when_candidates_exist(self) -> None:
        candidates = [
            {"name_en": "Haghpat Monastery", "lat": 41.0936, "lon": 44.7119, "coord_source": "OSM"},
            {"name_en": "Sanahin Monastery", "lat": 41.0872, "lon": 44.6661, "coord_source": "OSM"},
        ]
        with patch("agent.distance._osrm_km", return_value=None), patch(
            "agent.distance.nominatim_coord", return_value=None
        ):
            route = one_way_route_km(
                [{"time": "11:00", "title": "Mystery stop", "title_en": "Mystery stop", "place_name": None}],
                place_candidates=candidates,
                region="Lori",
            )
        assert route.km > 0
        idea = apply_unit_economics(
            {"id": "x", "title_en": "Lori", "itinerary": [{"title": "Mystery stop"}]},
            route_km=route.km,
            km_sourced=False,
            km_notes=route.notes,
            has_away_stop=True,
            km_source=route.km_source,
        )
        assert idea["price"] is not None
        assert idea["price"] > 0
        assert "rough estimate" in " ".join(idea["verify"])

    def test_lunch_never_geocoded(self) -> None:
        with patch("agent.distance._osrm_km", return_value=80.0):
            route = one_way_route_km(
                [
                    {"time": "08:00", "place_name": "Armavir", "activity": "departure", "title_en": "Armavir — departure"},
                    {"time": "13:00", "place_name": None, "activity": "lunch", "title_en": "Lunch", "title": "Lunch"},
                    {
                        "time": "15:00",
                        "place_name": "Haghpat Monastery",
                        "activity": "visit",
                        "title_en": "Haghpat Monastery — visit",
                        "lat": 41.0936,
                        "lon": 44.7119,
                    },
                ]
            )
        assert route.km > 0
        assert all("lunch" not in str(row["name"]).lower() for row in route.geocoded_stops)

    def test_robots_parser_disallow(self) -> None:
        robots = parse_robots(ROBOTS_ALLOW)
        from agent.onewaytour import USER_AGENT, _can_fetch

        assert robots.can_fetch(USER_AGENT, "https://onewaytour.com/group-tours")
        assert not _can_fetch(robots, "https://onewaytour.com/search-results?q=x")

    def test_unreachable_does_not_fail_refinement(self) -> None:
        state = {
            "inputs": {
                "count": 1,
                "departure_location": "Armavir",
                "budget_amd": 20000,
            },
            "market_research": '{"onewaytour_unavailable": true, "place_candidates": [{"name_en": "Haghpat Monastery", "lat": 41.0936, "lon": 44.7119}], "market_offers": []}',
            "evaluated_ideas": [
                {
                    "id": "lori-day",
                    "title_hy": "Լոռի",
                    "title_en": "Lori",
                    "title_ru": "Лори",
                    "description_hy": "Մեկօրյա տուր հայեցակարգ լսարան արժեք տարբերակում սեզոն ռիսկեր։",
                    "description_en": "Lori day tour covering concept audience value differentiation season risks.",
                    "description_ru": "Однодневный тур в Лори.",
                    "location_hy": "Լոռի",
                    "location_en": "Lori",
                    "location_ru": "Лори",
                    "duration_hours": 10,
                    "highlights": ["Հայեցակարգ"],
                    "itinerary": [
                        {"time": "07:30", "place_name": "Armavir", "activity": "departure", "title": "Armavir — departure", "title_en": "Armavir — departure", "description": "Start"},
                        {"time": "11:00", "place_name": "Haghpat Monastery", "activity": "visit", "title": "Haghpat Monastery — visit", "title_en": "Haghpat Monastery — visit", "description": "Visit"},
                        {"time": "13:00", "place_name": None, "activity": "lunch", "title": "Lunch", "title_en": "Lunch", "description": "Meal"},
                        {"time": "18:00", "place_name": "Armavir", "activity": "return", "title": "Armavir — return", "title_en": "Armavir — return", "description": "Return"},
                    ],
                    "verify": [],
                    "breakdown": {"guide_amd": 15000, "notes": "Estimated."},
                }
            ],
        }
        with patch("agent.distance._osrm_km", return_value=90.0):
            out = refinement_node(state)
        idea = out["final_report"][0]
        assert UNAVAILABLE in idea["verify"]
        assert idea["price"] is not None
        assert idea["route_km"] > 0
