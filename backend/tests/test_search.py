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
        self.assertIn("tripadvisor", joined.lower())
        self.assertFalse(any(len(item) > 90 for item in queries))

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
            slug = "ddg-" + query.split()[0].lower()
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
