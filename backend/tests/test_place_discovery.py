from __future__ import annotations

import json
import unittest
from unittest.mock import patch

from agent import distance, search
from agent.graph import place_discovery_node, search_node
from agent.place_discovery import discover_place, parse_place_json
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
        snippet = "Web distance cross-check (not used for price): about 120 km"
        with patch.object(search, "distance_cross_check_snippet", return_value=snippet):
            note = search.distance_cross_check_snippet("Gyumri")
        idea = apply_unit_economics(
            {"title_en": "Gyumri"},
            route_km=100.0,
            km_sourced=True,
            km_notes=[note],
            km_source="OSRM",
            geocoded_stops=[{"name": "Gyumri", "lat": 40.79, "lon": 43.84, "coord_source": "Nominatim"}],
            has_away_stop=True,
        )
        self.assertEqual(idea["route_km"], 100.0)
        self.assertEqual(idea["km_source"], "OSRM")
        self.assertIn(snippet, idea["verify"])


if __name__ == "__main__":
    unittest.main()
