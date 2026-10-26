from __future__ import annotations

import time
import unittest
from unittest.mock import patch

from agent import search


class SearchResilienceTests(unittest.TestCase):
    def test_timeout_does_not_drop_other_query_hits(self) -> None:
        def fake_tavily(query: str, _max: int):
            if "Armavir Armenia one day" in query:
                time.sleep(0.05)
                raise TimeoutError("slow")
            return [{"title": "Hit", "url": "https://example.com/tours", "snippet": "12000 AMD day tour", "query": query, "source": "tavily"}]

        with patch.object(search, "_tavily_one", fake_tavily), patch.object(search, "_ddg_one", lambda *_: []):
            payload = search.run_market_search({"season": "summer", "tour_type": "cultural", "preferences": ""})
        self.assertTrue(payload["live"])
        self.assertGreaterEqual(len(payload["results"]), 1)
        self.assertIn(payload["search_status"], {"partial", "ok"})

    def test_tavily_fail_falls_back_to_ddg(self) -> None:
        def boom(*_args, **_kwargs):
            raise TimeoutError("tavily down")

        def ddg(query: str, _max: int):
            return [{"title": "DDG", "url": "https://example.com/ddg", "snippet": "Armavir tour 15000 AMD", "query": query, "source": "duckduckgo"}]

        with patch.object(search, "_tavily_one", boom), patch.object(search, "_ddg_one", ddg):
            payload = search.run_market_search({"season": "summer", "tour_type": "cultural", "preferences": ""})
        self.assertTrue(payload["live"])
        self.assertEqual(payload["provider"], "duckduckgo")
        self.assertTrue(any(row["source"] == "duckduckgo" for row in payload["results"]))

    def test_empty_search_exposes_reason_code(self) -> None:
        with patch.object(search, "_tavily_one", lambda *_: (_ for _ in ()).throw(TimeoutError("x"))), patch.object(
            search, "_ddg_one", lambda *_: (_ for _ in ()).throw(TimeoutError("y"))
        ):
            payload = search.run_market_search({"season": "summer", "tour_type": "cultural", "preferences": ""})
        self.assertFalse(payload["live"])
        self.assertEqual(payload["results"], [])
        self.assertIn(payload["search_status"], {"tavily_timeout", "ddg_timeout", "empty"})
        self.assertEqual(payload["error"], payload["search_status"])


if __name__ == "__main__":
    unittest.main()
