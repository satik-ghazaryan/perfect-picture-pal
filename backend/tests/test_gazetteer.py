from __future__ import annotations

import json
from unittest.mock import patch

from agent import graph
from agent.gazetteer import all_places, places_for
from agent.place_discovery import discover_place
from agent.pricing import apply_unit_economics


def test_every_listed_place_is_in_armenia_and_within_a_day_trip():
    rows = all_places()
    assert len(rows) >= 40
    names = [row["name_en"] for row in rows]
    assert len(names) == len(set(names))
    for row in rows:
        assert 38.8 <= row["lat"] <= 41.4 and 43.4 <= row["lon"] <= 46.7, row["name_en"]
        assert 0 < row["distance_from_armavir_km"] <= 160, row["name_en"]
        assert row["name_hy"] and row["source_url"].startswith("https://www.openstreetmap.org/")


def test_asking_for_a_town_brings_the_sights_of_its_region():
    names = [row["name_en"] for row in places_for("Dilijan")]
    assert {"Dilijan Old Town", "Haghartsin Monastery", "Goshavank", "Lake Parz"} <= set(names)
    assert [row["region_en"] for row in places_for(None, "Lori")] == ["Lori"] * 6
    assert places_for("Atlantis") == []


def test_ideas_without_a_named_place_still_get_real_candidates():
    payload = discover_place("")
    assert len(payload["place_candidates"]) >= 40
    with patch("agent.place_discovery.invoke_place_llm", return_value={"place_en": None, "region_en": None}):
        vague = discover_place("հանգիստ օր տարեցների համար")
    assert len(vague["place_candidates"]) >= 40


def test_generation_prompt_offers_real_places_and_no_copyable_example():
    market = json.dumps({"place_candidates": places_for("Lori")}, ensure_ascii=False)
    brief = graph._candidate_brief(market)
    assert "Haghpat Monastery (monastery, Lori" in brief
    assert "UNESCO" in brief
    for leaked in ("Haghpat", "Alaverdi", "Sanahin"):
        assert leaked not in graph.IDEA_JSON_SHAPE
    assert "Armenian fields may be brief" not in graph.SYSTEM


def test_armenian_step_is_told_the_season_and_the_place_names():
    market = json.dumps({"place_candidates": places_for("Lori")}, ensure_ascii=False)
    prompt = graph._hy_adapt_prompt([{"id": "a"}], market, False, {"season": "autumn", "target_audience": "seniors"})
    assert "աշուն" in prompt and "ավագ սերունդ" in prompt
    assert "Haghpat Monastery = Հաղպատի վանք" in prompt
    assert "SEARCH RESULTS" not in prompt


def test_a_route_between_listed_places_gets_a_real_price():
    idea = apply_unit_economics({"id": "x", "itinerary": []}, route_km=190.0, km_sourced=True, has_away_stop=True)
    assert idea["price"] and idea["price"] > 5000


def test_armenian_step_cannot_lose_english_text_or_a_whole_idea():
    originals = {
        "a": {
            "id": "a",
            "title_en": "Sardarapat and Metsamor",
            "title_hy": "x",
            "description_en": "A day west of Armavir.",
            "duration_hours": 8,
            "highlights": ["Bulls of Sardarapat"],
            "itinerary": [{"time": "09:00", "place_name": "Sardarapat Memorial", "activity": "visit", "title_en": "Sardarapat Memorial — visit"}],
        },
        "b": {"id": "b", "title_en": "Second idea", "itinerary": []},
    }
    partial = [
        {
            "id": "a",
            "title_hy": "Սարդարապատ և Մեծամոր",
            "description_hy": "Օրը սկսում ենք Սարդարապատի հուշահամալիրից։",
            "location_hy": "Արմավիր",
            "highlights": ["Սարդարապատի ցուլերը"],
            "itinerary": [{"time": "09:00", "title_hy": "Սարդարապատի հուշահամալիր — այցելություն"}],
        }
    ]
    merged = graph._merge_hy_ideas(originals, partial)
    assert [item["id"] for item in merged] == ["a", "b"]
    first = merged[0]
    assert first["title_en"] == "Sardarapat and Metsamor" and first["duration_hours"] == 8
    assert first["title_hy"] == "Սարդարապատ և Մեծամոր"
    assert first["highlights"] == ["Սարդարապատի ցուլերը"]
    assert first["itinerary"][0]["title_hy"] == "Սարդարապատի հուշահամալիր — այցելություն"
    assert first["itinerary"][0]["place_name"] == "Sardarapat Memorial"
    assert merged[1]["title_en"] == "Second idea"
    english = graph._merge_hy_ideas(originals, [{"id": "a", "title_hy": "Still English", "highlights": ["English point"]}])
    assert english[0]["title_hy"] == "x" and english[0]["highlights"] == ["Bulls of Sardarapat"]


def test_odd_model_output_is_tidied_instead_of_losing_the_idea():
    from schemas import TourIdea

    idea = graph.tidy_idea(
        {
            "id": "Sardarapat & Metsamor!",
            "title_en": "Sardarapat and Metsamor",
            "description_en": "A day west of Armavir.",
            "notes": {"Հայեցակարգ": "պատմության օր", "Ռիսկեր": ["շոգ", "քամի"]},
            "highlights": "- Bulls of Sardarapat\n- Bronze Age observatory",
            "duration_hours": "ten",
            "appeal_score": 85,
            "verify": None,
        },
        {"region_en": "Armavir"},
    )
    parsed = TourIdea.model_validate(idea)
    assert parsed.id == "sardarapat-metsamor"
    assert parsed.notes == "Հայեցակարգ՝ պատմության օր Ռիսկեր՝ շոգ քամի"
    assert parsed.highlights == ["Bulls of Sardarapat", "Bronze Age observatory"]
    assert parsed.duration_hours == 10 and parsed.appeal_score == 10
    assert parsed.location_en == "Armavir" and parsed.title_hy == "Sardarapat and Metsamor"
