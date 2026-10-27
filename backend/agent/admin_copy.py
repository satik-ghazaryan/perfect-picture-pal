from __future__ import annotations

SEARCH_FAILURE_STATUSES = frozenset(
    {
        "tavily_error",
        "ddg_error",
        "tavily_timeout",
        "ddg_timeout",
        "too_few_results",
        "empty",
    }
)
SEARCH_QUIET_STATUSES = frozenset({"", "ok", "tavily_no_key"})

VERIFY_NOTE_HY_EXACT = {
    "price needs route distance": "Անհրաժեշտ է երթուղու հեռավորությունը",
    "Route km is an estimate": "Երթուղու կմ-ը գնահատական է",
    "No live web results; places and prices need human research": (
        "Կենդանի որոնման արդյունքներ չկան. վայրերն ու գները հարկավոր է ստուգել ձեռքով"
    ),
    "No competitor data was found": "Մրցակցային տվյալներ չեն գտնվել",
}
VERIFY_NOTE_HY_PREFIXES = (
    ("Place not in search results:", "Վայրը որոնման արդյունքներում չկա:"),
    ("Needs sourced fact URL:", "Հարկավոր է աղբյուրի URL:"),
    ("Could not geocode stop:", "Չհաջողվեց գեոկոդավորել կանգառը:"),
    ("Web distance cross-check (not used for price):", "Հեռավորության համացանցային ստուգում (գնի համար չի օգտագործվում):"),
)


def search_status_note(status: str, useful_count: int = 0) -> str:
    code = str(status or "").strip()
    if code in SEARCH_QUIET_STATUSES:
        return ""
    if code == "partial":
        return f"Որոնումը մասնակի է (օգտակար արդյունքներ՝ {int(useful_count or 0)})"
    return f"search failed: {code}"


def format_verify_note_hy(note: str) -> str:
    text = str(note or "")
    mapped = VERIFY_NOTE_HY_EXACT.get(text)
    if mapped:
        return mapped
    for english, armenian in VERIFY_NOTE_HY_PREFIXES:
        if text.startswith(english):
            return armenian + text[len(english) :]
    return text
