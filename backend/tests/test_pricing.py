from __future__ import annotations

import json
import unittest
from unittest.mock import patch

from agent import distance
from agent.distance import destination_titles, one_way_route_km
from agent.pricing import (
    GROUP_SIZE,
    GUIDE_FEE_GROUP_AMD,
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
        self.assertGreaterEqual(suggested, 9997)
        self.assertLessEqual(suggested, 14000)
        self.assertEqual(position, "in_range")
        self.assertEqual(market["offer_count"], 2)

    def test_min_price_above_market_band(self) -> None:
        offers = [{"observed_price_amd": 5000, "title": "Cheap", "url": "https://example.com/c", "found_on": "2026-10-26"}]
        suggested, position, _market = choose_suggested_price(7998, offers)
        self.assertEqual(suggested, 9997)
        self.assertEqual(position, "above_market")

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

    def test_akhtala_itinerary_skips_return_leg(self) -> None:
        titles = destination_titles(
            [
                {"title": "Armavir — departure"},
                {"title": "Akhtala monastery"},
                {"title": "Armavir — return"},
            ]
        )
        self.assertEqual(titles, ["Akhtala monastery"])

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

    def test_away_stop_with_zero_km_has_no_price(self) -> None:
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
        self.assertIsNone(idea["price"])
        self.assertEqual(idea["market_position"], "unknown")
        self.assertGreater(idea["breakdown"]["guide_amd"], 0)
        self.assertEqual(idea["breakdown"]["transport_amd"], 0)

    def test_known_akhtala_route_uses_one_way(self) -> None:
        km, _sourced, _notes = one_way_route_km(
            [
                {"title": "Armavir departure"},
                {"title": "Akhtala"},
                {"title": "Armavir return"},
            ]
        )
        self.assertGreater(km, 100)
        self.assertLess(km, 280)


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


if __name__ == "__main__":
    unittest.main()
