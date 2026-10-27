from __future__ import annotations

import json
import unittest
from pathlib import Path
from unittest.mock import patch

from agent import distance, search
from agent.graph import place_discovery_node, search_node
from agent.place_discovery import (
    discover_place,
    html_to_text,
    is_login_or_booking_url,
    is_public_http_url,
    parse_candidate_places,
    parse_place_json,
    select_fetch_urls,
)
from agent.search import usable_web_distance_snippet
from agent.pricing import apply_unit_economics


class PlaceDiscoveryTests(unittest.TestCase):
    def test_parse_place_json_nulls(self) -> None:
        self.assertEqual(
            parse_place_json({"place_en": "null", "region_en": "none"}),
            {"place_en": None, "region_en": None},
        )
        self.assertEqual(
            parse_place_json({"place_en": "Gyumri", "region_en": "Shirak"}),
            {"place_en": "Gyumri", "region_en": "Shirak"},
        )

    def test_empty_preferences_skip_llm_and_search(self) -> None:
        with patch("agent.place_discovery.invoke_place_llm") as invoke:
            payload = discover_place("  ")
        invoke.assert_not_called()
        self.assertEqual(payload["skipped"], "no_preferences")
        self.assertEqual(payload["queries"], [])

    def test_llm_place_en_drives_discovery_queries(self) -> None:
        hits = [
            {
                "title": "Gyumri Black Fortress Armenia",
                "url": "https://example.com/gyumri-fortress",
                "snippet": "Visit Gyumri museums in Armenia",
                "query": "Gyumri Armenia top attractions to visit",
                "source": "tavily",
                "kind": "place",
            },
            {
                "title": "Holy Saviour Church Gyumri",
                "url": "https://example.com/gyumri-church",
                "snippet": "The restored cathedral in Gyumri, Armenia",
                "query": "Gyumri Armenia things to see monastery museum",
                "source": "tavily",
                "kind": "place",
            },
        ]
        with patch("agent.place_discovery.invoke_place_llm", return_value={"place_en": "Gyumri", "region_en": "Shirak"}), patch(
            "agent.place_discovery.run_place_attraction_search",
            return_value={"queries": search.discovery_queries("Gyumri"), "results": hits, "search_status": "ok"},
        ), patch("agent.place_discovery.fetch_attraction_pages", return_value=[]), patch(
            "agent.place_discovery.extract_place_candidates", return_value=[]
        ), patch(
            "agent.place_discovery.collect_structured_bundle",
            return_value={"candidates": [], "ok": True, "is_region": False},
        ):
            payload = discover_place("Գյումրի")
        self.assertEqual(payload["place_en"], "Gyumri")
        self.assertIn("Gyumri Armenia top attractions to visit", payload["queries"])
        self.assertIn("Gyumri Armenia things to see monastery museum", payload["queries"])
        self.assertIn("Gyumri Armenia day tour from Armavir", payload["queries"])
        self.assertEqual(len(payload["results"]), 2)

    def test_graph_search_merges_discovery_into_market(self) -> None:
        discovery = {
            "place_en": "Gyumri",
            "region_en": "Shirak",
            "queries": search.discovery_queries("Gyumri"),
            "results": [
                {
                    "title": "Gyumri walking tour Armenia",
                    "url": "https://example.com/gyumri-walk",
                    "snippet": "Armenia city walk",
                    "kind": "place",
                }
            ],
        }
        market = {
            "queries": ["Gyumri Armenia day tour"],
            "results": [
                {
                    "title": "Gyumri day tour from Armavir",
                    "url": "https://example.com/gyumri-tour",
                    "snippet": "Armenia tour price",
                    "kind": "market_reference",
                }
            ],
            "search_status": "ok",
            "live": True,
            "useful_result_count": 1,
        }
        with patch("agent.graph.run_market_search", return_value=market):
            out = search_node(
                {
                    "inputs": {"preferences": "Գյումրի", "season": "autumn", "tour_type": "cultural"},
                    "place_discovery": json.dumps(discovery, ensure_ascii=False),
                    "market_research": "",
                    "research_data": "",
                    "ideas_raw": [],
                    "evaluated_ideas": [],
                    "quality_issues": [],
                    "refine_pass": 0,
                    "final_report": [],
                }
            )
        bundled = json.loads(out["market_research"])
        self.assertEqual(bundled["place_en"], "Gyumri")
        self.assertEqual(bundled.get("place_candidates"), [])
        urls = {row["url"] for row in bundled["results"]}
        self.assertIn("https://example.com/gyumri-walk", urls)
        self.assertIn("https://example.com/gyumri-tour", urls)

    def test_place_discovery_node_uses_discover_place(self) -> None:
        with patch(
            "agent.graph.discover_place",
            return_value={"place_en": "Gyumri", "region_en": None, "queries": [], "results": [], "skipped": ""},
        ) as mocked:
            out = place_discovery_node(
                {
                    "inputs": {"preferences": "Գյումրի"},
                    "place_discovery": "",
                    "market_research": "",
                    "research_data": "",
                    "ideas_raw": [],
                    "evaluated_ideas": [],
                    "quality_issues": [],
                    "refine_pass": 0,
                    "final_report": [],
                }
            )
        mocked.assert_called_once_with("Գյումրի")
        self.assertEqual(json.loads(out["place_discovery"])["place_en"], "Gyumri")

    def test_osrm_and_estimate_km_source(self) -> None:
        gyumri = (40.7942, 43.8453)
        with patch.object(distance, "nominatim_coord", return_value=gyumri), patch.object(
            distance, "_osrm_km", return_value=118.0
        ):
            osrm = distance.one_way_route_km(
                [
                    {"title": "Armavir — departure", "title_en": "Armavir — departure"},
                    {"title": "Gyumri — arrival", "title_en": "Gyumri — arrival"},
                    {"title": "Armavir — return", "title_en": "Armavir — return"},
                ]
            )
        self.assertEqual(osrm.km_source, "OSRM")
        self.assertTrue(osrm.sourced)
        self.assertEqual(osrm.geocoded_stops[0]["name"], "Gyumri")
        self.assertEqual(osrm.geocoded_stops[0]["coord_source"], "Nominatim")
        self.assertNotIn("Route km is an estimate", osrm.notes)

        with patch.object(distance, "nominatim_coord", return_value=gyumri), patch.object(
            distance, "_osrm_km", return_value=None
        ):
            estimate = distance.one_way_route_km(
                [{"title": "Gyumri — arrival", "title_en": "Gyumri — arrival"}]
            )
        self.assertEqual(estimate.km_source, "estimate")
        self.assertFalse(estimate.sourced)
        self.assertGreater(estimate.km, 40)
        self.assertIn("Route km is an estimate", estimate.notes)

        priced = apply_unit_economics(
            {"title_en": "Gyumri", "itinerary": []},
            route_km=estimate.km,
            km_sourced=estimate.sourced,
            km_notes=estimate.notes,
            km_source=estimate.km_source,
            geocoded_stops=estimate.geocoded_stops,
            has_away_stop=True,
        )
        self.assertEqual(priced["km_source"], "estimate")
        self.assertEqual(priced["geocoded_stops"][0]["coord_source"], "Nominatim")
        self.assertNotIn("Web distance", " ".join(priced["verify"]))

    def test_distance_cross_check_never_sets_price(self) -> None:
        snippet = "Web distance cross-check (not used for price): Armavir to Gyumri 120 km"
        idea = apply_unit_economics(
            {"title_en": "Gyumri"},
            route_km=100.0,
            km_sourced=True,
            km_notes=[snippet],
            km_source="OSRM",
            geocoded_stops=[{"name": "Gyumri", "lat": 40.79, "lon": 43.84, "coord_source": "Nominatim"}],
            has_away_stop=True,
        )
        self.assertEqual(idea["route_km"], 100.0)
        self.assertEqual(idea["km_source"], "OSRM")
        self.assertIn(snippet, idea["verify"])

    def test_html_to_text_strips_scripts(self) -> None:
        html = "<html><head><script>secret()</script></head><body><h1>Haghpat Monastery</h1><p>Visit Sanahin.</p></body></html>"
        text = html_to_text(html)
        self.assertIn("Haghpat Monastery", text)
        self.assertIn("Sanahin", text)
        self.assertNotIn("secret()", text)

    def test_ssrf_guard_rejects_private_urls(self) -> None:
        self.assertFalse(is_public_http_url("http://127.0.0.1/secret"))
        self.assertFalse(is_public_http_url("http://localhost/admin"))
        self.assertFalse(is_public_http_url("http://192.168.1.10/page"))
        self.assertFalse(is_public_http_url("http://10.0.0.5/page"))
        self.assertFalse(is_public_http_url("http://169.254.169.254/latest"))
        self.assertFalse(is_public_http_url("file:///etc/passwd"))
        self.assertTrue(is_login_or_booking_url("https://www.tripadvisor.com/Login"))
        self.assertTrue(is_login_or_booking_url("https://www.getyourguide.com/checkout"))
        self.assertFalse(is_login_or_booking_url("https://www.tripadvisor.com/Attractions-g293932-Lori.html"))
        urls = select_fetch_urls(
            [
                {"title": "Login", "url": "https://www.tripadvisor.com/Login", "snippet": "Armenia"},
                {"title": "Lori attractions Armenia", "url": "https://www.tripadvisor.com/Attractions-g293932-Lori.html", "snippet": "Armenia"},
            ],
            "Lori",
        )
        self.assertEqual(urls, ["https://www.tripadvisor.com/Attractions-g293932-Lori.html"])

    def test_candidates_must_appear_in_fetched_text(self) -> None:
        pages = [{"url": "https://example.com/lori", "text": "Haghpat Monastery and Sanahin Monastery in Lori, Armenia."}]
        parsed = parse_candidate_places(
            {
                "places": [
                    {"name_en": "Haghpat Monastery", "type": "monastery", "source_url": "https://example.com/lori"},
                    {"name_en": "Invented Gorge", "type": "park", "source_url": "https://example.com/lori"},
                ]
            },
            pages,
        )
        names = [item["name_en"] for item in parsed]
        self.assertEqual(names, ["Haghpat Monastery"])

    def test_web_distance_boilerplate_is_dropped(self) -> None:
        junk = "Distance calculator helps in calculating mileage between cities"
        self.assertEqual(usable_web_distance_snippet(junk, "Lori"), "")
        good = "Driving distance from Armavir to Lori is 140 km via the M3."
        note = usable_web_distance_snippet(good, "Lori")
        self.assertTrue(note.startswith("Web distance cross-check"))
        self.assertIn("140 km", note)
        self.assertLessEqual(len(note), 120)

    def test_overpass_parse_dedupe_and_cap(self) -> None:
        from agent.osm_places import CANDIDATE_CAP, merge_candidates, parse_overpass_elements

        sample = json.loads((Path(__file__).parent / "data" / "overpass_sample.json").read_text(encoding="utf-8"))
        parsed = parse_overpass_elements(sample)
        names = [item["name_en"] for item in parsed]
        self.assertEqual(names, ["Akhtala Monastery", "Akhtala Fortress", "Holy Mother of God Church"])
        self.assertTrue(parsed[0]["osm_url"].endswith("/way/109234567"))
        self.assertEqual(parsed[0]["type"], "monastery")
        extras = [{"name_en": f"Place {index}", "lat": 40.0, "lon": 44.0} for index in range(20)]
        self.assertEqual(len(merge_candidates(parsed, extras)), CANDIDATE_CAP)

    def test_osrm_from_osm_coordinates_skips_nominatim(self) -> None:
        with patch.object(distance, "nominatim_coord", side_effect=AssertionError("nominatim should be skipped")), patch.object(
            distance, "_osrm_km", return_value=201.6
        ):
            route = distance.one_way_route_km(
                [
                    {
                        "title": "Akhtala Monastery",
                        "title_en": "Akhtala Monastery",
                        "lat": 41.1502,
                        "lon": 44.7581,
                        "coord_source": "OSM",
                    }
                ],
                extra_names=[],
                coords_by_name={"Akhtala Monastery": (41.1502, 44.7581)},
            )
        self.assertEqual(route.km, 201.6)
        self.assertTrue(route.sourced)
        self.assertEqual(route.km_source, "OSRM from OSM coordinates")
        self.assertEqual(route.geocoded_stops[0]["coord_source"], "OSM")

    def test_structured_sources_failure_is_caught(self) -> None:
        from agent.osm_places import PLACE_DATA_UNAVAILABLE, collect_structured_candidates

        with patch("agent.osm_places.nominatim_lookup", return_value=None), patch(
            "agent.osm_places.nominatim_coord", return_value=None
        ):
            rows, ok = collect_structured_candidates("Akhtala")
        self.assertEqual(rows, [])
        self.assertFalse(ok)
        self.assertEqual(PLACE_DATA_UNAVAILABLE, "Place data sources unavailable")

    def test_wikipedia_geosearch_parse_and_heuristic_filter(self) -> None:
        from agent.osm_places import filter_visitable_heuristic, parse_wikipedia_geosearch

        data = Path(__file__).parent / "data"
        geo = json.loads((data / "wikipedia_geosearch.json").read_text(encoding="utf-8"))
        extracts = json.loads((data / "wikipedia_extracts.json").read_text(encoding="utf-8"))
        parsed = parse_wikipedia_geosearch(geo, extracts)
        names = [item["name_en"] for item in parsed]
        self.assertIn("Black Fortress", names)
        self.assertIn("Cathedral of the Holy Mother of God, Gyumri", names)
        self.assertNotIn("List of people from Gyumri", names)
        self.assertNotIn("Gyumri (disambiguation)", names)
        kept = filter_visitable_heuristic(parsed)
        kept_names = [item["name_en"] for item in kept]
        self.assertIn("Black Fortress", kept_names)
        self.assertNotIn("Akhuryan River", kept_names)

    def test_merge_prefers_wikipedia_url(self) -> None:
        from agent.osm_places import merge_candidates

        osm = [
            {
                "name_en": "Black Fortress",
                "type": "fort",
                "source_url": "https://www.openstreetmap.org/way/1",
                "osm_url": "https://www.openstreetmap.org/way/1",
                "wiki_url": "",
            }
        ]
        wiki = [
            {
                "name_en": "Black Fortress",
                "type": "fortress",
                "source_url": "https://en.wikipedia.org/wiki/Black_Fortress",
                "wiki_url": "https://en.wikipedia.org/wiki/Black_Fortress",
                "osm_url": "",
            }
        ]
        merged = merge_candidates(osm, wiki)
        self.assertEqual(len(merged), 1)
        self.assertIn("wikipedia.org", merged[0]["source_url"])
        self.assertTrue(merged[0]["osm_url"].startswith("https://www.openstreetmap.org/"))

    def test_overpass_endpoint_fallback(self) -> None:
        from agent.osm_places import fetch_overpass

        sample = json.loads((Path(__file__).parent / "data" / "overpass_sample.json").read_text(encoding="utf-8"))
        calls: list[str] = []

        def fake_post(endpoint: str, query: str, timeout: float):
            calls.append(endpoint)
            if "overpass-api.de" in endpoint or "kumi.systems" in endpoint:
                raise TimeoutError("busy")
            if "private.coffee" in endpoint:
                from agent.osm_places import parse_overpass_elements

                return parse_overpass_elements(sample)
            raise AssertionError(f"unexpected {endpoint}")

        with patch("agent.osm_places._overpass_post", side_effect=fake_post), patch("agent.osm_places.time.sleep", return_value=None):
            rows, ok = fetch_overpass(41.15, 44.76, 10_000, budget_sec=25)
        self.assertTrue(ok)
        self.assertTrue(any(item["name_en"] == "Akhtala Monastery" for item in rows))
        self.assertTrue(any("overpass-api.de" in item for item in calls))
        self.assertTrue(any("private.coffee" in item for item in calls))

    def test_llm_classify_never_adds_names(self) -> None:
        from agent.osm_places import parse_visitable_llm_json

        rows = [
            {"name_en": "Black Fortress", "description": "A fortress in Gyumri."},
            {"name_en": "Cathedral of the Holy Mother of God, Gyumri", "description": "A church."},
        ]
        parsed = parse_visitable_llm_json(
            {
                "items": [
                    {"title": "Black Fortress", "visitable": True, "type": "fortress"},
                    {"title": "Invented Gorge", "visitable": True, "type": "park"},
                    {"title": "Cathedral of the Holy Mother of God, Gyumri", "visitable": False, "type": "church"},
                ]
            },
            rows,
        )
        self.assertEqual([item["name_en"] for item in parsed], ["Black Fortress"])

    def test_wiki_success_overpass_fail_still_ok(self) -> None:
        from agent.osm_places import collect_structured_candidates

        wiki = [
            {
                "name_en": "Akhtala Monastery",
                "type": "monastery",
                "lat": 41.15,
                "lon": 44.76,
                "source_url": "https://en.wikipedia.org/wiki/Akhtala_Monastery",
                "wiki_url": "https://en.wikipedia.org/wiki/Akhtala_Monastery",
                "description": "A monastery.",
            }
        ]
        with patch(
            "agent.osm_places.nominatim_lookup",
            return_value={
                "lat": 41.15,
                "lon": 44.76,
                "osm_class": "place",
                "place_type": "village",
                "boundingbox": (41.14, 41.16, 44.75, 44.77),
            },
        ), patch("agent.osm_places.fetch_wikipedia_geosearch", return_value=(wiki, True)
        ), patch("agent.osm_places.fetch_overpass_resilient", return_value=([], False)), patch(
            "agent.osm_places.classify_visitable", side_effect=lambda rows: rows
        ):
            rows, ok = collect_structured_candidates("Akhtala")
        self.assertTrue(ok)
        self.assertEqual(rows[0]["name_en"], "Akhtala Monastery")

    def test_region_bbox_sampling_and_overpass_bbox(self) -> None:
        from agent.osm_places import collect_structured_candidates, region_sample_points

        bbox = (40.70, 41.30, 44.00, 44.90)
        points = region_sample_points(bbox)
        self.assertEqual(len(points), 5)
        geo_calls: list[tuple[float, float]] = []

        def fake_geo(lat: float, lon: float, radius_m: int = 10_000):
            geo_calls.append((round(lat, 4), round(lon, 4)))
            return (
                [
                    {
                        "name_en": "Haghpat Monastery",
                        "type": "monastery",
                        "lat": 41.09,
                        "lon": 44.71,
                        "description": "A monastery.",
                        "wiki_url": "https://en.wikipedia.org/wiki/Haghpat_Monastery",
                    }
                ],
                True,
            )

        wiki_search = [
            {
                "name_en": "Odzun Church",
                "type": "church",
                "lat": 41.05,
                "lon": 44.61,
                "description": "A church.",
                "wiki_url": "https://en.wikipedia.org/wiki/Odzun_Church",
            }
        ]

        with patch(
            "agent.osm_places.nominatim_lookup",
            return_value={
                "lat": 41.0,
                "lon": 44.43,
                "osm_class": "boundary",
                "place_type": "administrative",
                "boundingbox": bbox,
            },
        ), patch("agent.osm_places.fetch_wikipedia_geosearch", side_effect=fake_geo), patch(
            "agent.osm_places.fetch_wikipedia_text_search", return_value=(wiki_search, True)
        ), patch(
            "agent.osm_places.fetch_overpass_bbox",
            return_value=(
                [{"name_en": "Sanahin Monastery", "type": "monastery", "lat": 41.087, "lon": 44.666, "osm_url": "https://www.openstreetmap.org/way/1"}],
                True,
            ),
        ), patch("agent.osm_places.fetch_overpass_resilient", side_effect=AssertionError("around must not run for regions")), patch(
            "agent.osm_places.classify_visitable", side_effect=lambda rows: rows
        ):
            rows, ok = collect_structured_candidates("Lori")
        self.assertTrue(ok)
        self.assertEqual(len(geo_calls), 5)
        names = {item["name_en"] for item in rows}
        self.assertIn("Haghpat Monastery", names)
        self.assertIn("Odzun Church", names)
        self.assertIn("Sanahin Monastery", names)
        self.assertLessEqual(len(rows), 20)

    def test_place_activity_split_and_lunch_skipped(self) -> None:
        itinerary = [
            {"place_name": "Armavir", "activity": "departure", "title_en": "Armavir — departure"},
            {
                "place_name": "Odzun Church",
                "activity": "arrival",
                "title_en": "Odzun Church — arrival",
                "lat": 41.05,
                "lon": 44.61,
                "coord_source": "Wikipedia",
            },
            {"place_name": None, "activity": "lunch", "title_en": "Lunch"},
            {
                "place_name": "Haghpat",
                "activity": "cultural exploration",
                "title_en": "Haghpat Monastery — cultural exploration",
                "lat": 41.09,
                "lon": 44.71,
                "coord_source": "Wikipedia",
            },
            {"place_name": "Armavir", "activity": "return", "title_en": "Armavir — return"},
        ]
        dests = distance.destination_titles(itinerary)
        self.assertEqual(dests, ["Odzun Church", "Haghpat"])
        with patch.object(distance, "nominatim_coord", side_effect=AssertionError("nominatim should be skipped")), patch.object(
            distance, "_osrm_km", return_value=80.0
        ):
            route = distance.one_way_route_km(
                itinerary,
                coords_by_name={"Odzun Church": (41.05, 44.61), "Haghpat Monastery": (41.09, 44.71)},
            )
        self.assertGreater(route.km, 0)
        self.assertNotIn("Lunch", [item["name"] for item in route.geocoded_stops])

    def test_schema_backward_compatible_without_place_name(self) -> None:
        from schemas import ItineraryStop, TourIdea

        old = ItineraryStop.model_validate(
            {"time": "11:00", "title": "Haghpat Monastery — arrival", "description": "Visit the monastery."}
        )
        self.assertEqual(old.place_name, None)
        self.assertEqual(old.title, "Haghpat Monastery — arrival")
        new = ItineraryStop.model_validate(
            {
                "time": "11:00",
                "place_name": "Haghpat Monastery",
                "activity": "arrival",
                "description": "Visit the monastery.",
            }
        )
        self.assertEqual(new.title_en, "Haghpat Monastery — arrival")
        idea = TourIdea.model_validate(
            {
                "id": "lori-day",
                "title_hy": "Լոռի",
                "title_en": "Lori",
                "title_ru": "Лори",
                "description_hy": "Տուր Լոռիում",
                "description_en": "A Lori day tour.",
                "description_ru": "Тур в Лори.",
                "location_hy": "Լոռի",
                "location_en": "Lori",
                "location_ru": "Лори",
                "duration_hours": 10,
                "itinerary": [
                    {"time": "08:00", "title": "Armavir — departure", "description": "Go."},
                    {
                        "time": "11:00",
                        "place_name": "Haghpat Monastery",
                        "activity": "visit",
                        "description": "See the monastery.",
                    },
                ],
            }
        )
        self.assertEqual(idea.itinerary[1].place_name, "Haghpat Monastery")


if __name__ == "__main__":
    unittest.main()
