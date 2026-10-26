from __future__ import annotations

import unittest
from unittest.mock import patch

from agent.distance import one_way_route_km
from agent.pricing import PRICE_NEEDS_DISTANCE, apply_unit_economics
from agent.quality import rewrite_copy_from_numbers, sanitize_competitors, strip_money_figures


def _idea_with_copy() -> dict:
    return {
        "id": "lori-hike",
        "title_hy": "Լոռի",
        "title_en": "Lori hiking",
        "title_ru": "Лори",
        "description_hy": "Արժեքի բաշխում տրանսպորտ և ուղեցույց 15000 AMD / անձ",
        "description_en": "price around 15000 AMD. Ari Gnank and ArmGeo are competitors.",
        "description_ru": "цена 15000 AMD или 15000 ₽",
        "location_hy": "Լոռի",
        "location_en": "Lori",
        "location_ru": "Лори",
        "duration_hours": 10,
        "highlights": ["Արժեքի բաշխում ... 15000 AMD / անձ", "Մրցակցային տարբերակում՝ Ari Gnank and ArmGeo"],
        "notes": "price around 15000 AMD",
        "itinerary": [
            {"time": "08:00", "title": "Armavir", "description": "Depart"},
            {"time": "11:00", "title": "Դսեղ գյուղ / Տսովեր լիճ / Գրիգոր Մոնաստեր", "title_en": "Dsegh village / Tsover lake / Grigor Monastery", "description": "Visit costs 15,000 ֏"},
        ],
        "verify": [],
        "breakdown": {"notes": "old 15000 AMD"},
    }


class QualityFixTests(unittest.TestCase):
    def test_armenian_slash_stop_uses_english_names_not_zero_km(self) -> None:
        km, _sourced, notes = one_way_route_km(
            [
                {"time": "08:00", "title": "Արմավիր — մեկնում"},
                {
                    "time": "11:00",
                    "title": "Դսեղ գյուղ / Տսովեր լիճ / Գրիգոր Մոնաստեր",
                    "title_en": "Dsegh village / Tsover lake / Grigor Monastery",
                    "description": "Lori",
                },
            ]
        )
        self.assertGreater(km, 50)
        self.assertFalse(any(item == "price needs route distance" for item in notes))

    def test_failed_geocode_does_not_price_guide_only(self) -> None:
        with patch("agent.distance.lookup_coord", return_value=None), patch(
            "agent.distance.nominatim_coord", return_value=None
        ):
            km, sourced, notes = one_way_route_km(
                [{"time": "11:00", "title": "Mystery gorge", "title_en": "Mystery gorge", "description": "x"}],
                extra_names=["Mystery gorge"],
            )
        self.assertEqual(km, 0)
        self.assertFalse(sourced)
        self.assertTrue(any(PRICE_NEEDS_DISTANCE in item for item in notes))
        idea = apply_unit_economics(
            _idea_with_copy(),
            route_km=km,
            km_sourced=sourced,
            km_notes=notes,
            has_away_stop=True,
        )
        self.assertIsNone(idea["price"])
        self.assertEqual(idea["market_position"], "unknown")
        self.assertEqual(idea["breakdown"]["transport_amd"], 0)
        self.assertNotEqual(idea["cost_per_person_amd"], 882)
        self.assertIn(PRICE_NEEDS_DISTANCE, idea["verify"])

    def test_evidence_money_strings_are_stripped(self) -> None:
        idea = apply_unit_economics(_idea_with_copy(), route_km=201.6, km_sourced=True, has_away_stop=True)
        updated = rewrite_copy_from_numbers(idea, {"live": True, "results": [], "market_offers": []})
        blob = " ".join(
            [
                updated["description_en"],
                updated["description_hy"],
                updated["description_ru"],
                updated["notes"],
                " ".join(updated["highlights"]),
                updated["itinerary"][1]["description"],
            ]
        )
        self.assertNotIn("price around 15000 AMD", blob)
        self.assertNotIn("15000 AMD / անձ", blob)
        self.assertNotIn("15,000 ֏", blob)
        self.assertNotIn("15000 ₽", blob)
        self.assertIn(str(updated["price"]), updated["description_en"])
        self.assertNotIn("Ari Gnank", updated["description_en"])
        self.assertIn("No competitor data was found.", updated["description_en"])

    def test_own_brand_never_competitor_even_with_offers(self) -> None:
        research = {
            "live": True,
            "results": [{"title": "ArmGeo Lori hike", "url": "https://example.com/armgeo", "snippet": "Armenia tour"}],
            "market_offers": [{"title": "ArmGeo", "url": "https://example.com/armgeo", "observed_price_amd": 12000}],
        }
        idea = sanitize_competitors(
            {
                "description_en": "Ari Gnank and ArmGeo compete",
                "description_hy": "Արի Գնանք",
                "description_ru": "Ари Гнанк",
                "highlights": ["Մրցակցային տարբերակում՝ Ari Gnank"],
                "notes": "",
                "itinerary": [],
                "verify": [],
            },
            research,
        )
        self.assertNotRegex(idea["description_en"], r"Ari\s*Gnank")
        self.assertNotRegex(idea["description_hy"], r"Արի\s*Գնանք")
        self.assertIn("ArmGeo", idea["description_en"])

    def test_strip_money_helper_on_evidence(self) -> None:
        self.assertNotIn("15000", strip_money_figures("price around 15000 AMD"))
        self.assertNotIn("15000", strip_money_figures("Արժեքի բաշխում ... 15000 AMD / անձ"))


if __name__ == "__main__":
    unittest.main()
