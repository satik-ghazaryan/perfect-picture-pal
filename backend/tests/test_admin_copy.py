from __future__ import annotations

import unittest

from agent.admin_copy import format_verify_note_hy, search_status_note


class AdminCopyTests(unittest.TestCase):
    def test_partial_is_not_failed(self) -> None:
        self.assertEqual(search_status_note("ok", 5), "")
        self.assertEqual(search_status_note("", 5), "")
        self.assertEqual(search_status_note("tavily_no_key", 5), "")
        self.assertEqual(search_status_note("partial", 5), "Որոնումը մասնակի է (օգտակար արդյունքներ՝ 5)")
        self.assertNotIn("failed", search_status_note("partial", 5).lower())

    def test_real_errors_keep_failed_prefix(self) -> None:
        for code in (
            "tavily_error",
            "ddg_error",
            "tavily_timeout",
            "ddg_timeout",
            "too_few_results",
            "empty",
        ):
            self.assertEqual(search_status_note(code, 0), f"search failed: {code}")

    def test_verify_notes_map_to_armenian(self) -> None:
        self.assertEqual(
            format_verify_note_hy("price needs route distance"),
            "Անհրաժեշտ է երթուղու հեռավորությունը",
        )
        self.assertEqual(
            format_verify_note_hy("No live web results; places and prices need human research"),
            "Կենդանի որոնման արդյունքներ չկան. վայրերն ու գները հարկավոր է ստուգել ձեռքով",
        )
        self.assertEqual(
            format_verify_note_hy("No competitor data was found"),
            "Մրցակցային տվյալներ չեն գտնվել",
        )
        self.assertEqual(
            format_verify_note_hy("Place not in search results: Lunch break"),
            "Վայրը որոնման արդյունքներում չկա: Lunch break",
        )
        self.assertEqual(
            format_verify_note_hy("Needs sourced fact URL: Gyumri"),
            "Հարկավոր է աղբյուրի URL: Gyumri",
        )
        self.assertEqual(
            format_verify_note_hy("Could not geocode stop: Gyumri — arrival; stop skipped"),
            "Չհաջողվեց գեոկոդավորել կանգառը: Gyumri — arrival; stop skipped",
        )
        self.assertEqual(
            format_verify_note_hy("Not enough concrete places found; needs human research"),
            "Բավարար կոնկրետ վայրեր չեն գտնվել. հարկավոր է ձեռքով ստուգում",
        )
        self.assertEqual(format_verify_note_hy("Route km is an estimate"), "Երթուղու կմ-ը գնահատական է")
        self.assertEqual(
            format_verify_note_hy("Route km is a rough estimate; confirm"),
            "Երթուղու կմ-ը կոպիտ գնահատական է. հաստատեք",
        )
        self.assertEqual(format_verify_note_hy("OneWayTour data unavailable"), "OneWayTour տվյալները անհասանելի են")
        self.assertTrue(
            format_verify_note_hy("Web distance cross-check (not used for price): 120 km").startswith(
                "Հեռավորության համացանցային ստուգում (գնի համար չի օգտագործվում):"
            )
        )
        self.assertEqual(format_verify_note_hy("Armenian text needs review"), "Հայերեն տեքստը հարկավոր է վերանայել")
        self.assertEqual(
            format_verify_note_hy("No destination stops after Armavir; route km is 0"),
            "Արմավիրից հետո նշանակման կանգառներ չկան. երթուղու կմ-ը 0 է",
        )
        self.assertEqual(
            format_verify_note_hy("No usable competitor offers; price is cost+margin only"),
            "Գինը՝ ծախս × 1.25. մրցակիցների գները միայն տեղեկատվական են",
        )
        self.assertEqual(
            format_verify_note_hy("price = cost x 1.25; competitor prices are shown for reference only"),
            "Գինը՝ ծախս × 1.25. մրցակիցների գները միայն տեղեկատվական են",
        )
        self.assertEqual(
            format_verify_note_hy("No competitor data found for similar tours."),
            "Նման տուրերի համար մրցակցային տվյալներ չեն գտնվել։",
        )
        self.assertEqual(
            format_verify_note_hy("Meals and entrance fees are not included."),
            "Սնունդը և մուտքի տոմսերը ներառված չեն։",
        )
        self.assertEqual(format_verify_note_hy("Web search returned few results"), "Որոնումը քիչ արդյունք է տվել")
        self.assertEqual(
            format_verify_note_hy("Route km is an estimate; confirm driving distance"),
            "Երթուղու կմ-ը գնահատական է. հաստատեք վարման հեռավորությունը",
        )
