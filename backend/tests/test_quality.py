from __future__ import annotations

import unittest
from unittest.mock import patch

from agent.distance import one_way_route_km
from agent.pricing import PRICE_NEEDS_DISTANCE, apply_unit_economics
from agent.quality import (
    FORBIDDEN_CUSTOMER_PHRASES,
    GENERIC_STOP_NOTE,
    HY_REVIEW_FLAG,
    NOT_ENOUGH_PLACES,
    classify_itinerary_stops,
    hy_copy_ok,
    is_generic_stop_title,
    mark_hy_review,
    rewrite_copy_from_numbers,
    sanitize_competitors,
    strip_customer_ops_text,
    strip_invented_claims,
    strip_internal_ops,
    strip_money_figures,
)


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
        coords = {
            "Dsegh village": (40.9610, 44.6510),
            "Tsover lake": (40.9530, 44.6680),
            "Grigor Monastery": (40.97, 44.64),
        }

        def fake_nominatim(name: str, region: str = ""):
            return coords.get(name) or (40.96, 44.65)

        with patch("agent.distance.nominatim_coord", side_effect=fake_nominatim), patch(
            "agent.distance._osrm_km", return_value=None
        ):
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
        with patch("agent.distance.nominatim_coord", return_value=None):
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
        self.assertNotIn("source of truth", blob.lower())
        self.assertNotIn("Computed figures", blob)
        self.assertNotIn("will be filled by Python", blob)
        self.assertNotIn("Ari Gnank", updated["description_en"])
        self.assertIn("No competitor data was found.", " ".join(updated["highlights"]))
        self.assertIn(str(updated["price"]), updated["breakdown"]["notes"])

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

    def test_exact_internal_phrases_do_not_survive(self) -> None:
        hy, en, ru, fees, revenue, computed = FORBIDDEN_CUSTOMER_PHRASES
        idea = rewrite_copy_from_numbers(
            {
                "title_hy": "Լոռի",
                "title_en": "Lori",
                "description_hy": f"Հայեցակարգ։ {hy}։",
                "description_en": f"A hike. {en} {computed}: group 17; cost per person 882 AMD.",
                "description_ru": f"Поход. {ru}",
                "notes": f"{fees} {revenue}",
                "highlights": [hy, en, ru, fees, revenue, computed],
                "itinerary": [
                    {"time": "08:00", "title": "Արմավիր — մեկնում", "description": en},
                    {"time": "11:00", "title": "Դսեղ", "title_en": "Dsegh", "description": ru},
                ],
                "breakdown": {"notes": en},
                "verify": [],
                "price": 9997,
            },
            {"live": True, "results": [], "market_offers": []},
        )
        blob = " ".join(
            [
                idea["description_hy"],
                idea["description_en"],
                idea["description_ru"],
                idea["notes"],
                " ".join(idea["highlights"]),
                idea["itinerary"][0]["description"],
                idea["itinerary"][1]["description"],
                str((idea.get("breakdown") or {}).get("notes") or ""),
            ]
        )
        for phrase in FORBIDDEN_CUSTOMER_PHRASES:
            self.assertNotIn(phrase, blob)
        self.assertNotIn("cost per person 882 AMD", idea["description_en"])

    def test_internal_python_prose_is_stripped(self) -> None:
        blob = strip_internal_ops(
            "Python-ը կլրացնի տրանսպորտը ըստ կմ։ Transport costs will be filled by Python based on km. "
            "Computed figures (source of truth): group 17."
        )
        self.assertNotIn("Python", blob)
        self.assertNotIn("source of truth", blob.lower())
        cleaned = strip_customer_ops_text(
            "Հայեցակարգ։ Python-ը կլրացնի տրանսպորտը ըստ կմ։ Unique experience with local culture."
        )
        self.assertNotIn("կլրացնի", cleaned)

    def test_invented_social_proof_and_quality_score_removed(self) -> None:
        text = strip_invented_claims("Positive feedback from previous participants. Quality 8/10. Autumn hiking.")
        self.assertNotIn("previous participants", text.lower())
        self.assertNotIn("8/10", text)

    def test_hy_english_sentences_are_flagged(self) -> None:
        idea = {
            "title_hy": "Lori hiking",
            "description_hy": "Unique experience with local culture. Autumn is ideal for hiking. Estimated based on transport and guide fees.",
            "location_hy": "Lori",
            "itinerary": [{"time": "08:00", "title": "Armavir — departure", "description": "Dsegh Village Visit"}],
            "verify": [],
        }
        self.assertFalse(hy_copy_ok(idea))
        flagged = mark_hy_review(idea)
        self.assertIn(HY_REVIEW_FLAG, flagged["verify"])

    def test_thin_itinerary_is_flagged(self) -> None:
        idea = rewrite_copy_from_numbers(
            {
                "description_en": "A walk.",
                "description_hy": "Զբոսանք Լոռիում։",
                "description_ru": "Прогулка.",
                "title_hy": "Լոռի",
                "title_en": "Lori",
                "itinerary": [
                    {"time": "08:00", "title": "Արմավիր — մեկնում", "description": "Մեկնում"},
                    {"time": "11:00", "title": "Dsegh Village Visit", "description": ""},
                ],
                "highlights": [],
                "verify": [],
                "price": 9997,
                "breakdown": {"notes": "GROUP_SIZE=17. Suggested price = 9997 AMD."},
            },
            {"live": True, "results": [{"title": "Lori Armenia", "snippet": "province", "url": "https://example.com/lori"}], "market_offers": []},
        )
        joined = " ".join(idea["verify"])
        self.assertIn("too thin", joined)

    def test_activity_suffix_does_not_reject_named_sights(self) -> None:
        self.assertFalse(is_generic_stop_title("Odzun Church — arrival"))
        self.assertFalse(is_generic_stop_title("Haghpat Monastery — cultural exploration"))
        idea = {
            "itinerary": [
                {"title": "Armavir — departure", "title_en": "Armavir — departure", "place_name": "Armavir", "activity": "departure"},
                {
                    "title": "Odzun Church — arrival",
                    "title_en": "Odzun Church — arrival",
                    "place_name": "Odzun Church",
                    "activity": "arrival",
                },
                {
                    "title": "Haghpat Monastery — cultural exploration",
                    "title_en": "Haghpat Monastery — cultural exploration",
                    "place_name": "Haghpat",
                    "activity": "cultural exploration",
                },
                {"title": "Lunch", "title_en": "Lunch", "place_name": None, "activity": "lunch"},
            ],
            "verify": [],
        }
        research = {
            "place_en": "Lori",
            "place_candidates": [
                {"name_en": "Odzun Church", "type": "church", "lat": 41.05, "lon": 44.61, "source_url": "https://example.com/o"},
                {"name_en": "Haghpat Monastery", "type": "monastery", "lat": 41.09, "lon": 44.71, "source_url": "https://example.com/h"},
            ],
        }
        classified = classify_itinerary_stops(idea, research)
        self.assertEqual(
            [stop["place_name"] for stop in classified["accepted"]],
            ["Odzun Church", "Haghpat Monastery"],
        )
        self.assertEqual(classified["dropped"], [])
        self.assertEqual(classified["accepted"][1]["lat"], 41.09)
        with patch("agent.distance._osrm_km", return_value=90.0):
            km, _sourced, _notes = one_way_route_km(classified["accepted"], extra_names=[], region="Lori")
        self.assertGreater(km, 0)

    def test_generic_stops_are_detected_and_skipped_for_geocode(self) -> None:
        self.assertTrue(is_generic_stop_title("Arrive in Lori"))
        self.assertTrue(is_generic_stop_title("Cultural Sites"))
        self.assertTrue(is_generic_stop_title("Cultural Sites Visit"))
        self.assertFalse(is_generic_stop_title("Haghpat Monastery"))
        idea = {
            "itinerary": [
                {"time": "08:00", "title": "Armavir — departure", "title_en": "Armavir — departure"},
                {"time": "11:00", "title": "Arrive in Lori", "title_en": "Arrive in Lori"},
                {"time": "12:30", "title": "Cultural Sites", "title_en": "Cultural Sites"},
                {"time": "13:30", "title": "Lunch break", "title_en": "Lunch break"},
                {"time": "18:00", "title": "Armavir — return", "title_en": "Armavir — return"},
            ],
            "verify": [],
        }
        research = {
            "place_en": "Lori",
            "pages_fetched": 2,
            "place_candidates": [
                {"name_en": "Haghpat Monastery", "type": "monastery", "source_url": "https://example.com/haghpat"},
                {"name_en": "Sanahin Monastery", "type": "monastery", "source_url": "https://example.com/sanahin"},
            ],
            "results": [],
        }
        classified = classify_itinerary_stops(idea, research)
        self.assertEqual(classified["accepted"], [])
        self.assertTrue(any(item.startswith(GENERIC_STOP_NOTE) for item in idea["verify"]))
        self.assertIn(NOT_ENOUGH_PLACES, idea["verify"])
        km, _sourced, _notes = one_way_route_km(classified["accepted"], extra_names=[], region="Lori")
        self.assertEqual(km, 0)

    def test_candidate_names_are_the_only_geocode_stops(self) -> None:
        idea = {
            "itinerary": [
                {"title": "Armavir — departure", "title_en": "Armavir — departure"},
                {"title": "Haghpat Monastery", "title_en": "Haghpat Monastery"},
                {"title": "Visit Sanahin Monastery", "title_en": "Visit Sanahin Monastery"},
                {"title": "Arrive in Lori", "title_en": "Arrive in Lori"},
                {"title": "Armavir — return", "title_en": "Armavir — return"},
            ],
            "verify": [],
        }
        research = {
            "place_en": "Lori",
            "pages_fetched": 1,
            "place_candidates": [
                {"name_en": "Haghpat Monastery", "type": "monastery", "source_url": "https://example.com/h"},
                {"name_en": "Sanahin Monastery", "type": "monastery", "source_url": "https://example.com/s"},
            ],
        }
        classified = classify_itinerary_stops(idea, research)
        self.assertEqual(
            [stop["title_en"] for stop in classified["accepted"]],
            ["Haghpat Monastery", "Sanahin Monastery"],
        )
        self.assertIn("Arrive in Lori", classified["dropped"])
        self.assertNotIn(NOT_ENOUGH_PLACES, idea["verify"])


if __name__ == "__main__":
    unittest.main()
