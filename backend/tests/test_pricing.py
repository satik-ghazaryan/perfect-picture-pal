from __future__ import annotations

import json
import unittest
from unittest.mock import patch

from agent import distance
from agent.distance import destination_titles, has_stop_outside_armavir, one_way_route_km, place_from_stop_title
from agent.pricing import (
    GROUP_SIZE,
    GUIDE_FEE_GROUP_AMD,
    PRICE_REFERENCE_NOTE,
    apply_unit_economics,
    apply_yerevan_transfer,
    choose_suggested_price,
    cost_per_person_amd,
    min_price_amd,
    transport_group_amd,
)
from agent.quality import ground_idea


class PricingTests(unittest.TestCase):
    def test_akhtala_one_way_numbers(self) -> None:
        self.assertEqual(GROUP_SIZE, 17)
        self.assertEqual(GUIDE_FEE_GROUP_AMD, 15000)
        transport = transport_group_amd(201.6)
        self.assertEqual(transport, 120960)
        cost = cost_per_person_amd(transport)
        self.assertEqual(cost, 7998)
        self.assertEqual(min_price_amd(cost), 9997)

    def test_no_competitor_offers_uses_min_price(self) -> None:
        suggested, position, market = choose_suggested_price(7998, [])
        self.assertEqual(suggested, 9997)
        self.assertEqual(position, "unknown")
        self.assertEqual(market["offer_count"], 0)

    def test_competitor_band_above_floor(self) -> None:
        offers = [
            {"observed_price_amd": 12000, "title": "A", "url": "https://example.com/a", "found_on": "2026-10-26"},
            {"observed_price_amd": 14000, "title": "B", "url": "https://example.com/b", "found_on": "2026-10-26"},
        ]
        suggested, position, market = choose_suggested_price(7998, offers)
        self.assertEqual(suggested, 9997)
        self.assertEqual(position, "below_market")
        self.assertEqual(market["offer_count"], 2)
        self.assertEqual(market["price_min_amd"], 12000)
        self.assertEqual(market["price_max_amd"], 14000)

    def test_min_price_above_market_band(self) -> None:
        offers = [{"observed_price_amd": 5000, "title": "Cheap", "url": "https://example.com/c", "found_on": "2026-10-26"}]
        suggested, position, market = choose_suggested_price(7998, offers)
        self.assertEqual(suggested, 9997)
        self.assertEqual(position, "above_market")
        self.assertEqual(market["price_min_amd"], 5000)

    def test_offers_do_not_change_final_price(self) -> None:
        high = [
            {"observed_price_amd": 52000, "title": "High", "url": "https://example.com/h", "found_on": "2026-10-26"},
            {"observed_price_amd": 56000, "title": "Higher", "url": "https://example.com/i", "found_on": "2026-10-26"},
        ]
        low = [{"observed_price_amd": 4000, "title": "Low", "url": "https://example.com/l", "found_on": "2026-10-26"}]
        floor = min_price_amd(7998)
        high_price, high_pos, high_market = choose_suggested_price(7998, high)
        low_price, low_pos, low_market = choose_suggested_price(7998, low)
        none_price, none_pos, none_market = choose_suggested_price(7998, [])
        self.assertEqual(high_price, floor)
        self.assertEqual(low_price, floor)
        self.assertEqual(none_price, floor)
        self.assertEqual(high_pos, "below_market")
        self.assertEqual(low_pos, "above_market")
        self.assertEqual(none_pos, "unknown")
        _mid_price, mid_pos, _mid_market = choose_suggested_price(
            7998,
            [
                {"observed_price_amd": 9000, "title": "MidA", "url": "https://example.com/m", "found_on": "2026-10-26"},
                {"observed_price_amd": 11000, "title": "MidB", "url": "https://example.com/n", "found_on": "2026-10-26"},
            ],
        )
        self.assertEqual(_mid_price, floor)
        self.assertEqual(mid_pos, "in_range")
        self.assertEqual(high_market["offer_count"], 2)
        self.assertEqual(none_market["offer_count"], 0)
        with_high = apply_unit_economics(
            {"id": "lori", "title_en": "Lori", "itinerary": [{"title": "Haghpat"}]},
            route_km=201.6,
            km_sourced=True,
            offers=high,
            has_away_stop=True,
        )
        with_low = apply_unit_economics(
            {"id": "lori", "title_en": "Lori", "itinerary": [{"title": "Haghpat"}]},
            route_km=201.6,
            km_sourced=True,
            offers=low,
            has_away_stop=True,
        )
        self.assertEqual(with_high["price"], with_low["price"])
        self.assertEqual(with_high["price"], with_high["min_price_amd"])
        self.assertNotEqual(with_high["market_position"], with_low["market_position"])
        self.assertIn(PRICE_REFERENCE_NOTE, with_high["verify"])
        self.assertFalse(any("No usable competitor offers" in item for item in with_high["verify"]))
        self.assertIn(PRICE_REFERENCE_NOTE, with_high["breakdown"]["notes"])

    def test_yerevan_addon_does_not_change_price(self) -> None:
        idea = {
            "title_en": "Yerevan day",
            "price": 10000,
            "breakdown": {"transport_amd": 50000, "yerevan_transfer_amd": 0},
        }
        updated = apply_yerevan_transfer(idea)
        self.assertEqual(updated["price"], 10000)
        self.assertEqual(updated["breakdown"]["transport_amd"], 50000)
        self.assertEqual(updated["breakdown"]["yerevan_transfer_amd"], 0)

    def test_empty_search_flags_verify(self) -> None:
        idea = {
            "title_en": "Mystery gorge",
            "itinerary": [{"time": "11:00", "title": "Invented Monastery", "description": "Guess"}],
            "verify": [],
        }
        grounded = ground_idea(idea, {"live": False, "results": []})
        self.assertTrue(grounded["needs_verification"])
        self.assertTrue(any("No live web results" in item for item in grounded["verify"]))

    def test_live_candidates_do_not_get_empty_web_note(self) -> None:
        idea = {
            "title_en": "Lori",
            "itinerary": [{"time": "11:00", "title": "Haghpat Monastery", "place_name": "Haghpat Monastery", "description": "Visit"}],
            "verify": ["No live web results; places and prices need human research"],
        }
        grounded = ground_idea(
            idea,
            {
                "live": True,
                "useful_result_count": 1,
                "results": [{"title": "Haghpat", "url": "https://en.wikipedia.org/wiki/Haghpat_Monastery"}],
                "place_candidates": [{"name_en": "Haghpat Monastery", "wiki_url": "https://en.wikipedia.org/wiki/Haghpat_Monastery"}],
            },
        )
        self.assertFalse(any("No live web results" in item for item in grounded["verify"]))
        self.assertTrue(any("Web search returned few results" in item for item in grounded["verify"]))

    def test_akhtala_itinerary_skips_return_leg(self) -> None:
        titles = destination_titles(
            [
                {"title": "Armavir — departure"},
                {"title": "Akhtala monastery"},
                {"title": "Armavir — return"},
            ]
        )
        self.assertEqual(titles, ["Akhtala monastery"])

    def test_place_extracted_and_activity_stops_skipped(self) -> None:
        self.assertEqual(place_from_stop_title("Gyumri — arrival"), "Gyumri")
        self.assertEqual(place_from_stop_title("Lunch break"), "")
        self.assertEqual(place_from_stop_title("Visit the Red Church"), "the Red Church")
        titles = destination_titles(
            [
                {"title": "Armavir — departure", "title_en": "Armavir — departure"},
                {"title": "Գյումրի — ժամանում", "title_en": "Gyumri — arrival"},
                {"title": "Ճաշ", "title_en": "Lunch break"},
                {"title": "Կարմիր եկեղեցի", "title_en": "Visit the Red Church"},
                {"title": "Free time", "title_en": "Free time"},
                {"title": "Armavir — return", "title_en": "Armavir — return"},
            ]
        )
        self.assertEqual(titles, ["Gyumri", "the Red Church"])
        self.assertFalse(
            has_stop_outside_armavir(
                [
                    {"title": "Armavir — departure", "title_en": "Armavir — departure"},
                    {"title": "Lunch break", "title_en": "Lunch break"},
                    {"title": "Armavir — return", "title_en": "Armavir — return"},
                ]
            )
        )
        self.assertTrue(
            has_stop_outside_armavir(
                [{"title": "Gyumri — arrival", "title_en": "Gyumri — arrival"}]
            )
        )
        with patch.object(distance, "nominatim_coord", return_value=(40.7942, 43.8453)), patch.object(
            distance, "_osrm_km", return_value=None
        ):
            km, _sourced, notes = one_way_route_km(
                [
                    {"title": "Armavir — departure", "title_en": "Armavir — departure"},
                    {"title": "Gyumri — arrival", "title_en": "Gyumri — arrival"},
                    {"title": "Lunch break", "title_en": "Lunch break"},
                    {"title": "Armavir — return", "title_en": "Armavir — return"},
                ]
            )
        self.assertGreater(km, 40)
        self.assertFalse(any("straight-line fallback" in item for item in notes))
        self.assertFalse(any("Lunch" in item for item in notes))
        self.assertIn("Route km is an estimate", notes)

    def test_failed_geocode_note_says_skipped(self) -> None:
        with patch.object(distance, "nominatim_coord", return_value=None):
            km, sourced, notes = one_way_route_km(
                [{"title": "Mystery gorge", "title_en": "Mystery gorge"}],
                extra_names=["Mystery gorge"],
            )
        self.assertEqual(km, 0)
        self.assertFalse(sourced)
        self.assertTrue(any("Could not geocode stop: Mystery gorge; stop skipped" in item for item in notes))
        self.assertFalse(any("straight-line fallback" in item for item in notes))

    def test_apply_unit_economics_akhtala(self) -> None:
        idea = apply_unit_economics(
            {
                "id": "akhtala-day",
                "title_hy": "Ախթալա",
                "title_en": "Akhtala",
                "title_ru": "Ахтала",
                "description_hy": "Տուր",
                "description_en": "Tour",
                "description_ru": "Тур",
                "location_hy": "Ախթալա",
                "location_en": "Akhtala",
                "location_ru": "Ахтала",
                "duration_hours": 10,
                "itinerary": [{"time": "11:00", "title": "Akhtala", "description": "Visit"}],
            },
            route_km=201.6,
            km_sourced=True,
            offers=[],
        )
        self.assertEqual(idea["breakdown"]["transport_amd"], 120960)
        self.assertEqual(idea["cost_per_person_amd"], 7998)
        self.assertEqual(idea["min_price_amd"], 9997)
        self.assertEqual(idea["price"], 9997)
        self.assertEqual(idea["market_position"], "unknown")
        self.assertIn("no return leg", idea["breakdown"]["notes"])

    def test_away_stop_with_zero_km_still_has_price(self) -> None:
        idea = apply_unit_economics(
            {
                "id": "bad-km",
                "title_en": "Lori",
                "description_en": "Tour",
                "itinerary": [{"time": "11:00", "title": "Dsegh", "description": "Visit"}],
            },
            route_km=0,
            km_sourced=False,
            km_notes=["Could not geocode stop: Dsegh"],
            has_away_stop=True,
        )
        self.assertIsNotNone(idea["price"])
        self.assertGreater(idea["price"], 0)
        self.assertGreater(idea["breakdown"]["guide_amd"], 0)
        self.assertEqual(idea["breakdown"]["transport_amd"], 0)

    def test_nominatim_akhtala_route_uses_one_way(self) -> None:
        self.assertFalse(hasattr(distance, "KNOWN_COORDS"))
        with patch.object(distance, "nominatim_coord", return_value=(41.1500, 44.7580)), patch.object(
            distance, "_osrm_km", return_value=None
        ):
            route = one_way_route_km(
                [
                    {"title": "Armavir departure"},
                    {"title": "Akhtala"},
                    {"title": "Armavir return"},
                ]
            )
        self.assertGreater(route.km, 100)
        self.assertLess(route.km, 280)
        self.assertEqual(route.km_source, "estimate")
        self.assertEqual(route.geocoded_stops[0]["coord_source"], "Nominatim")


class FakeClock:
    def __init__(self, start: float = 1000.0) -> None:
        self.now = start
        self.sleeps: list[float] = []

    def monotonic(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.now += seconds


class FakeNominatimResponse:
    def __init__(self, lat: str, lon: str) -> None:
        self._body = json.dumps([{"lat": lat, "lon": lon}]).encode("utf-8")

    def read(self) -> bytes:
        return self._body

    def __enter__(self) -> FakeNominatimResponse:
        return self

    def __exit__(self, *_exc: object) -> bool:
        return False


class NominatimRateTests(unittest.TestCase):
    def setUp(self) -> None:
        self._geo = dict(distance._GEO_CACHE)
        self._last = distance._NOMINATIM_LAST_CALL
        distance._GEO_CACHE.clear()
        distance._NOMINATIM_LAST_CALL = 0.0
        distance._DISK_LOADED = False

    def tearDown(self) -> None:
        distance._GEO_CACHE.clear()
        distance._GEO_CACHE.update(self._geo)
        distance._NOMINATIM_LAST_CALL = self._last

    def test_cache_misses_are_spaced_and_hits_skip_wait(self) -> None:
        clock = FakeClock()
        http_calls: list[str] = []

        def fake_urlopen(request, timeout=None):
            http_calls.append(str(getattr(request, "full_url", request)))
            self.assertEqual(timeout, 8)
            return FakeNominatimResponse("40.9000", "44.6000")

        with patch.object(distance.time, "monotonic", clock.monotonic), patch.object(
            distance.time, "sleep", clock.sleep
        ), patch.object(distance.urllib.request, "urlopen", fake_urlopen):
            first = distance.nominatim_coord("RateLimit PlaceA")
            after_first = list(clock.sleeps)
            second = distance.nominatim_coord("RateLimit PlaceB")
            sleeps_after_misses = list(clock.sleeps)
            hit = distance.nominatim_coord("RateLimit PlaceA")
            sleeps_after_hit = list(clock.sleeps)

        self.assertEqual(first, (40.9, 44.6))
        self.assertEqual(second, (40.9, 44.6))
        self.assertEqual(hit, (40.9, 44.6))
        self.assertEqual(len(http_calls), 2)
        self.assertEqual(after_first, [])
        self.assertEqual(len(sleeps_after_misses), 1)
        self.assertGreaterEqual(sleeps_after_misses[0], 1.0)
        self.assertGreaterEqual(sleeps_after_misses[0], distance.NOMINATIM_MIN_INTERVAL_SEC - 0.0001)
        self.assertEqual(sleeps_after_hit, sleeps_after_misses)

    def test_nominatim_disk_cache_roundtrip(self) -> None:
        distance._GEO_CACHE.clear()
        distance._DISK_LOADED = False
        distance._DISK_CACHE_PATH.write_text(
            json.dumps({"Gyumri, Armenia": [40.7942, 43.8453]}),
            encoding="utf-8",
        )
        with patch.object(distance.urllib.request, "urlopen", side_effect=AssertionError("network")):
            coord = distance.nominatim_coord("Gyumri")
        self.assertEqual(coord, (40.7942, 43.8453))


if __name__ == "__main__":
    unittest.main()
