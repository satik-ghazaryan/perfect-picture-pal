from __future__ import annotations

from agent.hy_labels import fallback_title_hy, hy_labels_for_candidates


def test_fallback_armavir_and_lunch() -> None:
    start = fallback_title_hy(
        {"time": "07:30", "place_name": "Armavir", "activity": "departure", "title_en": "Armavir — departure"},
        {},
    )
    assert start["title_hy"] == "Արմավիր — մեկնում"
    assert start["activity_hy"] == "մեկնում"
    back = fallback_title_hy(
        {"time": "18:00", "place_name": "Armavir", "activity": "return", "title_en": "Armavir — return"},
        {},
    )
    assert back["title_hy"] == "Արմավիր — վերադարձ"
    lunch = fallback_title_hy(
        {"time": "13:00", "place_name": None, "activity": "lunch", "title_en": "Lunch", "title": "Lunch"},
        {},
    )
    assert lunch["title_hy"] == "Ճաշի ընդմիջում"


def test_fallback_uses_wikipedia_hy_label(monkeypatch) -> None:
    monkeypatch.setattr(
        "agent.hy_labels._langlinks_hy",
        lambda titles: {"Haghpat Monastery": "Հաղպատի վանք"},
    )
    monkeypatch.setattr("agent.hy_labels._wikidata_hy", lambda title: "")
    candidates = [{"name_en": "Haghpat Monastery", "wiki_url": "https://en.wikipedia.org/wiki/Haghpat_Monastery"}]
    labels = hy_labels_for_candidates(candidates)
    assert labels["Haghpat Monastery"] == "Հաղպատի վանք"
    stop = fallback_title_hy(
        {
            "time": "11:00",
            "place_name": "Haghpat Monastery",
            "activity": "visit",
            "title_en": "Haghpat Monastery — visit",
        },
        labels,
    )
    assert stop["title_hy"] == "Հաղպատի վանք — այց"
    assert stop["activity_hy"] == "այց"


def test_fallback_keeps_latin_place_if_no_hy_label() -> None:
    stop = fallback_title_hy(
        {"place_name": "Odzun Church", "activity": "visit", "title_en": "Odzun Church — visit"},
        {},
    )
    assert stop["title_hy"] == "Odzun Church — այց"


def test_english_title_hy_is_replaced() -> None:
    stop = fallback_title_hy(
        {
            "place_name": "Haghpat Monastery",
            "activity": "visit",
            "title_en": "Haghpat Monastery — visit",
            "title_hy": "Haghpat Monastery — visit",
        },
        {"Haghpat Monastery": "Հաղպատի վանք"},
    )
    assert stop["title_hy"] == "Հաղպատի վանք — այց"


def test_hywiki_search_used_when_langlinks_empty(monkeypatch) -> None:
    monkeypatch.setattr("agent.hy_labels._langlinks_hy", lambda titles: {})
    monkeypatch.setattr("agent.hy_labels._wikidata_hy", lambda title: "")
    monkeypatch.setattr("agent.hy_labels._hywiki_search", lambda title: "Հաղպատի վանք")
    labels = hy_labels_for_candidates(
        [{"name_en": "Haghpat Monastery", "wiki_url": "https://en.wikipedia.org/wiki/Haghpat_Monastery"}]
    )
    assert labels["Haghpat Monastery"] == "Հաղպատի վանք"
