from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

from agent.distance import english_stop_name, one_way_route_km
from agent.graph import _preserve_stop_english, refinement_node
from agent.onewaytour import (
    COMPANY,
    UNAVAILABLE,
    collect_onewaytour,
    extract_english_tour_urls,
    is_one_day_tour,
    parse_group_list_html,
    parse_robots,
    parse_tour_html,
    partition_tours,
    tour_matches_names,
)
from agent.pricing import apply_unit_economics, choose_suggested_price, min_price_amd

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
        assert suggested == min_price_amd(5000)
        assert position == "below_market"

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

    def test_place_overlap_not_hardcoded_region_list(self) -> None:
        garni = {
            "name": "Garni, Geghard, Lake Sevan & Dilijan Day Tour",
            "url": "https://onewaytour.com/group-tours/garni-geghard-lake-sevan-dilijan-day-tour",
            "places": ["Garni Temple", "Geghard Monastery", "Lake Sevan"],
            "duration_days": 1,
            "price_amd": 11500,
        }
        haghpat = {
            "name": "Haghpat and Sanahin day tour",
            "url": "https://onewaytour.com/private-tours/haghpat-sanahin-day-tour",
            "places": ["Haghpat Monastery", "Sanahin Monastery"],
            "duration_days": 1,
            "price_amd": 18000,
        }
        multi = {
            "name": "Classic tour in Armenia 9 days",
            "url": "https://onewaytour.com/private-tours/classic-tour-in-armenia-9-days-8-nights",
            "places": ["Haghpat Monastery"],
            "duration_days": 9,
            "price_amd": 400000,
        }
        assert tour_matches_names(haghpat, ["Lori", "Haghpat Monastery"])
        assert not tour_matches_names(garni, ["Lori", "Haghpat Monastery", "Sanahin Monastery"])
        matched, other, reasons = partition_tours([garni, haghpat, multi], ["Lori", "Haghpat Monastery"])
        assert [row["name"] for row in matched] == [haghpat["name"]]
        assert garni in other
        assert any("duration>1" in item for item in reasons)
        offer = choose_suggested_price(8000, [
            {
                "title": haghpat["name"],
                "url": haghpat["url"],
                "observed_price_amd": 18000,
                "company": COMPANY,
                "duration_days": 1,
            }
        ])
        assert offer[2]["offer_count"] == 1

    def test_sitemap_urls_filter_language_and_match_place(self) -> None:
        xml = """
        <urlset>
          <loc>https://onewaytour.com/private-tours/haghpat-sanahin-day-tour</loc>
          <loc>https://onewaytour.com/hy/private-tours/haghpat-sanahin-day-tour</loc>
          <loc>https://onewaytour.com/group-tours/garni-geghard-lake-sevan-dilijan-day-tour</loc>
        </urlset>
        """
        urls = extract_english_tour_urls(xml)
        assert "https://onewaytour.com/private-tours/haghpat-sanahin-day-tour" in urls
        assert not any("/hy/" in url for url in urls)
        from agent.onewaytour import urls_matching_names

        matched = urls_matching_names(urls, ["Haghpat Monastery", "Lori"])
        assert matched == ["https://onewaytour.com/private-tours/haghpat-sanahin-day-tour"]

    def test_lori_collect_uses_sitemap_when_group_list_has_no_overlap(self, monkeypatch) -> None:
        haghpat_html = """
        <html><head>
        <script type="application/ld+json">
        {"@type":"TouristTrip","name":"Haghpat and Sanahin day tour","url":"https://onewaytour.com/private-tours/haghpat-sanahin-day-tour","duration":"PT10H","offers":{"price":18000,"priceCurrency":"AMD"},"itinerary":{"@type":"ItemList","itemListElement":[{"name":"Haghpat Monastery","item":{"@type":"Place","name":"Haghpat Monastery"}},{"name":"Sanahin Monastery","item":{"@type":"Place","name":"Sanahin Monastery"}}]}}
        </script>
        </head><body><h1>Haghpat and Sanahin day tour</h1></body></html>
        """

        def fake_fetch(url: str, *, robots=None, budget=None, force: bool = False) -> str:
            if "robots.txt" in url:
                return ROBOTS_ALLOW
            if url.endswith("/group-tours"):
                return LIST_HTML
            if "haghpat" in url:
                return haghpat_html
            if "garni" in url:
                return FIXTURE.read_text(encoding="utf-8")
            return ""

        monkeypatch.setattr("agent.onewaytour.fetch_url", fake_fetch)
        monkeypatch.setattr(
            "agent.onewaytour.fetch_sitemap_locs",
            lambda robots, budget: ["https://onewaytour.com/private-tours/haghpat-sanahin-day-tour"],
        )
        with patch("agent.onewaytour.nominatim_coord", return_value=(41.09, 44.71)):
            payload = collect_onewaytour("Lori", "Lori", match_names=["Haghpat Monastery", "Sanahin Monastery"])
        assert payload["debug"]["matched"] >= 1
        assert any("Haghpat" in str(offer["title"]) for offer in payload["offers"])
        assert any(not tour.get("matched") for tour in payload["tours"])
        assert payload["debug"]["other_one_day"] >= 1

    def test_unlabeled_private_tour_counts_as_one_day(self) -> None:
        unlabeled = {
            "name": "Haghpat and Sanahin monastic complexes",
            "url": "https://onewaytour.com/private-tours/haghpat-sanahin",
            "places": ["Haghpat Monastery", "Sanahin Monastery"],
            "duration": "",
            "duration_days": None,
            "price_amd": 52000,
        }
        garni = {
            "name": "Garni, Geghard, Lake Sevan & Dilijan Day Tour",
            "url": "https://onewaytour.com/group-tours/garni-geghard-lake-sevan-dilijan-day-tour",
            "places": ["Garni Temple", "Geghard Monastery"],
            "duration_days": 1,
            "price_amd": 11500,
        }
        multi = {
            "name": "Classic tour in Armenia 9 days",
            "url": "https://onewaytour.com/private-tours/classic-tour-in-armenia-9-days-8-nights",
            "places": ["Haghpat Monastery"],
            "duration_days": 9,
            "price_amd": 400000,
        }
        assert is_one_day_tour(unlabeled)
        assert not is_one_day_tour(multi)
        two_day = {
            "name": "Two-Day Tour to Syunik | Meghri",
            "url": "https://onewaytour.com/group-tours/two-day-tour-to-syunik-meghri",
            "places": ["Meghri"],
            "duration_days": 1,
            "price_amd": 31000,
        }
        assert not is_one_day_tour(two_day)
        matched, other, reasons = partition_tours(
            [unlabeled, garni, multi],
            ["Lori", "Haghpat Monastery", "Sanahin Monastery"],
        )
        assert matched == [unlabeled]
        assert garni in other
        assert any("duration>1" in item for item in reasons)
        html = """
        <html><head>
        <script type="application/ld+json">
        {"@type":"TouristTrip","name":"Haghpat and Sanahin monastic complexes","url":"https://onewaytour.com/private-tours/haghpat-sanahin","offers":{"price":52000,"priceCurrency":"AMD"},"itinerary":{"@type":"ItemList","itemListElement":[{"item":{"@type":"Place","name":"Haghpat Monastery"}},{"item":{"@type":"Place","name":"Sanahin Monastery"}}]}}
        </script>
        </head><body><h1>Haghpat and Sanahin monastic complexes</h1></body></html>
        """
        parsed = parse_tour_html(html, "https://onewaytour.com/private-tours/haghpat-sanahin")
        assert parsed is not None
        assert parsed["price_amd"] == 52000
        assert is_one_day_tour(parsed)

    def test_lori_collect_unlabeled_private_html_feeds_offers(self, monkeypatch) -> None:
        haghpat_html = """
        <html><head>
        <script type="application/ld+json">
        {"@type":"TouristTrip","name":"Haghpat and Sanahin monastic complexes","url":"https://onewaytour.com/private-tours/haghpat-sanahin","offers":{"price":52000,"priceCurrency":"AMD"},"itinerary":{"@type":"ItemList","itemListElement":[{"item":{"@type":"Place","name":"Haghpat Monastery"}}]}}
        </script>
        </head><body><h1>Haghpat and Sanahin monastic complexes</h1></body></html>
        """

        def fake_fetch(url: str, *, robots=None, budget=None, force: bool = False) -> str:
            if "robots.txt" in url:
                return ROBOTS_ALLOW
            if url.endswith("/group-tours"):
                return LIST_HTML
            if "haghpat" in url:
                return haghpat_html
            if "garni" in url:
                return FIXTURE.read_text(encoding="utf-8")
            return ""

        monkeypatch.setattr("agent.onewaytour.fetch_url", fake_fetch)
        monkeypatch.setattr(
            "agent.onewaytour.fetch_sitemap_locs",
            lambda robots, budget: ["https://onewaytour.com/private-tours/haghpat-sanahin"],
        )
        with patch("agent.onewaytour.nominatim_coord", return_value=(41.09, 44.71)):
            payload = collect_onewaytour("Lori", "Lori", match_names=["Haghpat Monastery", "Sanahin"])
        assert payload["debug"]["matched"] >= 1
        assert payload["debug"]["offers"] >= 1
        assert any(offer["observed_price_amd"] == 52000 for offer in payload["offers"])
        assert any(not tour.get("matched") for tour in payload["tours"])
