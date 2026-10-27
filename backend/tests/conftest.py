from __future__ import annotations

from pathlib import Path

import pytest


@pytest.fixture(autouse=True)
def nominatim_disk_cache_tmp(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from agent import distance

    path = tmp_path / "nominatim_cache.json"
    monkeypatch.setattr(distance, "_DISK_CACHE_PATH", path)
    monkeypatch.setattr(distance, "_DISK_LOADED", False)
