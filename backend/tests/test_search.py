from __future__ import annotations

import time
import unittest
from unittest.mock import patch

from agent import search


def _hit(query: str, slug: str, source: str = "tavily") -> dict[str, str]:
    return {
        "title": f"Armenia {slug} day tour",
        "url": f"https://example.com/{slug}",
        "snippet": "Armenia hiking tour 12000 AMD from Yerevan",
        "query": query,
        "source": source,
    }


class SearchResilienceTests(unittest.TestCase):
    def test_queries_are_short_and_place_specific(self) -> None:
        queries = search.build_queries({"season": "autumn", "tour_type": "hiking", "preferences": "Dsegh Tsover Lori"})
        joined = " ".join(queries)
        self.assertTrue(any("Dsegh" in item for item in queries))
        self.assertTrue(any("Tsover" in item or "Lori" in item for item in queries))
        self.assertNotIn("tripadvisor", joined.lower())
        self.assertNotIn("Akhtala", joined)
        self.assertFalse(any("from Yerevan" in item for item in queries))
        self.assertFalse(any(len(item) > 90 for item in queries))
        for query in queries:
            self.assertTrue(search.query_is_armenia_scoped(query), query)

    def test_hy_place_preferences_need_place_en_from_discovery(self) -> None:
        self.assertFalse(hasattr(search, "HY_TO_LATIN_PLACES"))
        self.assertEqual(search.place_keywords({"preferences": "Գյումրի"}), ["Գյումրի"])
        queries = search.build_queries(
            {"season": "autumn", "tour_type": "cultural", "preferences": "Գյումրի", "place_en": "Gyumri"}
        )
        joined = " ".join(queries)
        self.assertTrue(any(item.startswith("Gyumri") for item in queries))
        self.assertIn("Gyumri Armenia day tour", queries)
        self.assertIn("Gyumri attractions Armenia", queries)
        self.assertIn("Gyumri day tour from Armavir price", queries)
        self.assertNotIn("Lori", joined)
        self.assertNotIn("Akhtala", joined)
        self.assertNotIn("tripadvisor", joined.lower())
        self.assertEqual(
            search.discovery_queries("Gyumri"),
            [
                "Gyumri Armenia top attractions to visit",
                "Gyumri Armenia things to see monastery museum",
                "Gyumri Armenia day tour from Armavir",
                "Gyumri Armenia site:onewaytour.com",
            ],
        )
        row = {"title": "Gyumri city walking tour Armenia", "url": "https://example.com/gyumri", "snippet": ""}
        self.assertTrue(search.result_is_useful(row, search.place_keywords({"preferences": "Գյումրի", "place_en": "Gyumri"})))

    def test_empty_preferences_keep_market_fallbacks(self) -> None:
        queries = search.build_queries({"season": "autumn", "tour_type": "cultural", "preferences": ""})
        joined = " ".join(queries).lower()
        self.assertIn("yerevan", joined)
        self.assertIn("akhtala", joined)
        self.assertIn("tripadvisor", joined)

    def test_exact_foreign_titles_dropped_and_armenia_titles_kept(self) -> None:
        dropped = [
            "AllTrails: Trail Guides & Maps for Hiking, Camping, and Running",
            "Best Hiking Trails Near Dallas & Fort Worth, Texas",
            "DFW Hiking: The Best of DFW! - North Texas Trails",
            "THE BEST 10 Hiking in FORT WORTH, TX - Updated 2026 - Yelp",
            "Best Hiking Trails in Fort Worth: Scenic Trails Worth Your Time...",
        ]
        kept = [
            "THE 15 BEST Lori Province Private Tours (2026) - Tripadvisor",
            "THE 10 BEST Armenia Tours for 2026 (with Prices) - Tripadvisor",
            "THE 10 BEST Lori Province Tours for 2025 (with Prices) - Tripadvisor",
        ]
        for title in dropped:
            self.assertFalse(search.result_is_useful({"title": title, "url": "", "snippet": ""}, ["hiking", "Lori"]), title)
        for title in kept:
            self.assertTrue(search.result_is_useful({"title": title, "url": "https://www.tripadvisor.com/", "snippet": ""}, ["Lori"]), title)
        rows = [{"title": title, "url": "", "snippet": "", "query": "q", "source": "tavily"} for title in dropped + kept]
        with patch.object(search, "_tavily_one", lambda *_: rows), patch.object(search, "_ddg_one", lambda *_: []):
            payload = search.run_market_search({"season": "autumn", "tour_type": "hiking", "preferences": "Lori"})
        titles = {row["title"] for row in payload["results"]}
        for title in dropped:
            self.assertNotIn(title, titles)
        for title in kept:
            self.assertIn(title, titles)
        self.assertEqual(payload["useful_result_count"], len(payload["results"]))
        self.assertEqual(payload["useful_result_count"], 3)

    def test_timeout_does_not_drop_other_query_hits(self) -> None:
        def fake_tavily(query: str, _max: int):
            if "tripadvisor" in query.lower():
                time.sleep(0.05)
                raise TimeoutError("slow")
            slug = "ggy" if "getyourguide" in query.lower() else query.split()[0].lower()
            return [_hit(query, slug)]

        with patch.object(search, "_tavily_one", fake_tavily), patch.object(search, "_ddg_one", lambda *_: []):
            payload = search.run_market_search({"season": "summer", "tour_type": "hiking", "preferences": "Lori Dsegh"})
        self.assertGreaterEqual(payload["useful_result_count"], 2)
        self.assertTrue(payload["live"])
        self.assertIn(payload["search_status"], {"partial", "ok"})
        self.assertIn(payload["provider_status"]["tavily"], {"ok", "partial"})

    def test_tavily_fail_falls_back_to_ddg(self) -> None:
        def boom(*_args, **_kwargs):
            raise TimeoutError("tavily down")

        def ddg(query: str, _max: int):
            slug = "ddg-" + "-".join(query.lower().split())
            return [_hit(query, slug, "duckduckgo")]

        with patch.object(search, "_tavily_one", boom), patch.object(search, "_ddg_one", ddg):
            payload = search.run_market_search({"season": "summer", "tour_type": "hiking", "preferences": "Lori"})
        self.assertTrue(payload["live"])
        self.assertEqual(payload["provider"], "duckduckgo")
        self.assertEqual(payload["provider_status"]["tavily"], "timeout")
        self.assertTrue(any(row["source"] == "duckduckgo" for row in payload["results"]))

    def test_empty_search_exposes_reason_code(self) -> None:
        with patch.object(search, "_tavily_one", lambda *_: (_ for _ in ()).throw(TimeoutError("x"))), patch.object(
            search, "_ddg_one", lambda *_: (_ for _ in ()).throw(TimeoutError("y"))
        ):
            payload = search.run_market_search({"season": "summer", "tour_type": "cultural", "preferences": ""})
        self.assertFalse(payload["live"])
        self.assertEqual(payload["results"], [])
        self.assertIn(payload["search_status"], {"tavily_timeout", "ddg_timeout", "empty", "too_few_results"})
        self.assertEqual(payload["error"], payload["search_status"])

    def test_texas_hiking_pages_are_not_useful(self) -> None:
        texas = {
            "title": "Best Dallas Fort Worth Hiking",
            "url": "https://www.alltrails.com/us/texas/dallas",
            "snippet": "hiking trails near Dallas",
            "query": "hiking",
            "source": "tavily",
        }
        lori = {
            "title": "Lori province day tour",
            "url": "https://www.tripadvisor.com/Attraction_Review-g323855-Lori.html",
            "snippet": "Hiking in Lori, Armenia from Yerevan. From $45 per person.",
            "query": "Lori",
            "source": "tavily",
        }
        dsegh = {
            "title": "Dsegh village Armenia",
            "url": "https://www.tripadvisor.com/dsegh",
            "snippet": "Dsegh in Lori, Armenia",
            "query": "Dsegh",
            "source": "tavily",
        }
        keywords = search.place_keywords({"preferences": "Lori hiking", "tour_type": "hiking"})
        self.assertNotIn("hiking", [item.lower() for item in keywords])
        self.assertFalse(search.result_is_useful(texas, keywords + ["hiking"]))
        self.assertTrue(search.result_is_useful(lori, keywords))
        with patch.object(search, "_tavily_one", lambda *_: [texas, lori, dsegh]), patch.object(
            search, "_ddg_one", lambda *_: []
        ):
            payload = search.run_market_search({"season": "autumn", "tour_type": "hiking", "preferences": "Lori Dsegh"})
        self.assertTrue(all("dallas" not in row["title"].lower() for row in payload["results"]))
        self.assertGreaterEqual(payload["useful_result_count"], 2)
        self.assertEqual(payload["useful_result_count"], len(payload["results"]))
        self.assertLess(payload["useful_result_count"], 9)

    def test_extracts_usd_and_amd_competitor_prices(self) -> None:
        usd = search.extract_offer("Lori day tour from $45 per person Armenia")
        self.assertEqual(usd["observed_currency"], "USD")
        self.assertEqual(usd["observed_amount"], 45)
        self.assertGreaterEqual(usd["observed_price_amd"], 45 * 300)
        self.assertTrue(usd["conversion_estimated"])
        eur = search.extract_offer("Guided hike €30 including transfer")
        self.assertEqual(eur["observed_currency"], "EUR")
        amd = search.extract_offer("Tripadvisor 15,000 AMD per person")
        self.assertEqual(amd["observed_currency"], "AMD")
        self.assertEqual(amd["observed_price_amd"], 15000)
        offers = search.market_offers_from_results(
            [
                {
                    "title": "Lori tour",
                    "url": "https://www.tripadvisor.com/lori",
                    "snippet": "from $45 Armenia hiking",
                }
            ],
            "2026-10-26",
        )
        self.assertEqual(len(offers), 1)
        self.assertEqual(offers[0]["url"], "https://www.tripadvisor.com/lori")
        self.assertGreater(offers[0]["observed_price_amd"], 0)

    def test_generic_wikipedia_pages_are_dropped(self) -> None:
        junk = [
            {"title": "Autumn", "url": "https://en.wikipedia.org/wiki/Autumn", "snippet": "season", "query": "q", "source": "tavily"},
            {"title": "Day", "url": "https://en.wikipedia.org/wiki/Day", "snippet": "time", "query": "q", "source": "tavily"},
            {"title": "Armenia", "url": "https://en.wikipedia.org/wiki/Armenia", "snippet": "country", "query": "q", "source": "tavily"},
        ]

        with patch.object(search, "_tavily_one", lambda *_: junk), patch.object(search, "_ddg_one", lambda *_: junk):
            payload = search.run_market_search({"season": "autumn", "tour_type": "hiking", "preferences": "Lori"})
        self.assertEqual(payload["results"], [])
        self.assertFalse(payload["live"])
        self.assertEqual(payload["search_status"], "too_few_results")
        self.assertIn(payload["provider_status"]["tavily"], {"empty", "ok", "partial"})


if __name__ == "__main__":
    unittest.main()
