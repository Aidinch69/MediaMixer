"""Daily quests: a couple of lightweight checklist items, re-rolled once
per real day, claimed automatically for XP the moment a counter hits its
target. Native port of dashboard.js's QUEST_DEFS/incrementQuestMetric -
scoped down to metrics the native app can actually track so far (rating
and real jackpots; bonus-window-based quests are skipped until the
bonus-window system itself gets ported).

Persisted to its own local JSON file, the native equivalent of the
browser's mm_quests localStorage key.
"""
from __future__ import annotations

import datetime
import json
import os
import random

QUEST_STATE_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "native_quests.json")

QUEST_DEFS = [
    {"id": "rate15", "desc": "Rate 15 clips", "target": 15, "metric": "rates", "xp": 30},
    {"id": "rate40", "desc": "Rate 40 clips", "target": 40, "metric": "rates", "xp": 70},
    {"id": "jackpot2", "desc": "Land 2 jackpots", "target": 2, "metric": "jackpots", "xp": 50},
    {"id": "jackpot5", "desc": "Land 5 jackpots", "target": 5, "metric": "jackpots", "xp": 90},
]


class QuestState:
    def __init__(self):
        self.day = ""
        self.quests: list[dict] = []  # [{"id":..., "progress": 0, "claimed": False}]
        self.counters = {"rates": 0, "jackpots": 0}
        self._load()

    def _load(self) -> None:
        today = datetime.date.today().isoformat()
        data = {}
        try:
            with open(QUEST_STATE_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
        except (OSError, json.JSONDecodeError):
            pass

        if data.get("day") == today and data.get("quests"):
            self.day = today
            self.quests = data["quests"]
            self.counters = data.get("counters", {"rates": 0, "jackpots": 0})
            return

        self.day = today
        chosen = random.sample(QUEST_DEFS, 2)
        self.quests = [{"id": q["id"], "progress": 0, "claimed": False} for q in chosen]
        self.counters = {"rates": 0, "jackpots": 0}
        self._save()

    def _save(self) -> None:
        try:
            with open(QUEST_STATE_PATH, "w", encoding="utf-8") as f:
                json.dump({"day": self.day, "quests": self.quests, "counters": self.counters}, f)
        except OSError:
            pass

    def increment(self, metric: str, award_xp) -> list[str]:
        """Bumps a counter, auto-claims any quest that just hit its
        target (calling award_xp(amount) for each), and returns a list of
        human-readable completion messages for the caller to show."""
        self.counters[metric] = self.counters.get(metric, 0) + 1
        messages = []
        for entry in self.quests:
            if entry["claimed"]:
                continue
            definition = next((q for q in QUEST_DEFS if q["id"] == entry["id"]), None)
            if not definition or definition["metric"] != metric:
                continue
            entry["progress"] = self.counters[metric]
            if entry["progress"] >= definition["target"]:
                entry["claimed"] = True
                award_xp(definition["xp"])
                messages.append(f"✅ Quest complete: {definition['desc']}")
        self._save()
        return messages

    def summary_text(self) -> str:
        lines = []
        for entry in self.quests:
            definition = next((q for q in QUEST_DEFS if q["id"] == entry["id"]), None)
            if not definition:
                continue
            mark = "✅" if entry["claimed"] else "▫️"
            progress = min(entry["progress"], definition["target"])
            lines.append(f"{mark} {definition['desc']} ({progress}/{definition['target']})")
        return "   ".join(lines)
