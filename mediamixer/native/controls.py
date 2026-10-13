"""Thin wrappers around the existing control API endpoints - mirrors
dashboard.js's fetch() calls 1:1, just as plain requests.get() calls
through the same session the backend client already authenticated.
"""
from __future__ import annotations

import requests


class Controls:
    def __init__(self, session: requests.Session, base_url: str):
        self.session = session
        self.base_url = base_url

    def _get(self, path: str, **params) -> None:
        try:
            self.session.get(f"{self.base_url}{path}", params=params, timeout=5)
        except requests.RequestException:
            pass

    def list_folders(self) -> list[str]:
        try:
            r = self.session.get(f"{self.base_url}/api/folders", timeout=5)
            if r.status_code == 200:
                return r.json().get("folders", [])
        except requests.RequestException:
            pass
        return []

    def skip(self) -> None:
        self._get("/api/skip")

    def lock(self) -> None:
        self._get("/api/lock")

    def rotate(self, screen: int) -> None:
        self._get("/api/rotate", screen=screen)

    def set_folder(self, folder: str) -> None:
        self._get("/api/folder", folder=folder)

    def set_layout(self, mode: str) -> None:
        self._get("/api/layout", mode=mode)

    def set_pace(self, mode: int) -> None:
        self._get("/api/pace", mode=mode)

    def set_vector(self, key: str, val: float) -> None:
        self._get("/api/vector", key=key, val=val)

    def cycle_tone(self) -> None:
        self._get("/api/cycle_tone")

    def rate(self, screen: int, direction: str) -> None:
        self._get("/api/rate", screen=screen, dir=direction)

    def set_preload(self, enabled: bool) -> None:
        self._get("/api/preload", enabled=str(enabled).lower())

    def set_intensity(self, barrage: float, jackpot: float) -> None:
        self._get("/api/intensity", barrage=barrage, jackpot=jackpot)

    def set_novelty(self, bonus: float) -> None:
        self._get("/api/novelty", bonus=bonus)
