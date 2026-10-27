from __future__ import annotations

from pathlib import Path

import pytest


@pytest.fixture(autouse=True)
def nominatim_disk_cache_tmp(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from agent import distance
    from agent.osm_places import clear_place_cache
    from agent.onewaytour import clear_onewaytour_cache

    path = tmp_path / "nominatim_cache.json"
    monkeypatch.setattr(distance, "_DISK_CACHE_PATH", path)
    monkeypatch.setattr(distance, "_DISK_LOADED", False)
    distance._LOOKUP_MEM.clear()
    clear_place_cache()
    clear_onewaytour_cache()
    monkeypatch.setattr("agent.onewaytour._DISK_PATH", tmp_path / "onewaytour_cache.json")
