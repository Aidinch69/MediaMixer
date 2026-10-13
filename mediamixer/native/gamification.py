"""Native port of the browser's core jackpot/streak/XP/milestone loop
(dashboard.js's JACKPOT_TIERS / registerJackpotStreak / XP system /
combo multiplier / personal bests). Pure Python state + logic, no Qt
dependency - mediamixer/native/shell.py wires this to visuals.

Persisted to a local JSON file - the native equivalent of the browser's
localStorage (mm_xp_state/mm_stats).
"""
from __future__ import annotations

import json
import os
import random
import time

STATE_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "native_state.json")

JACKPOT_TIERS = [
    {"name": "small", "weight": 65, "flash": 1.0},
    {"name": "medium", "weight": 28, "flash": 1.3},
    {"name": "mega", "weight": 7, "flash": 1.7},
]
MILESTONE_TIER = {"name": "milestone", "flash": 2.2}
MILESTONE_COUNTS = {5, 10, 25, 50, 100, 200, 500, 1000}
STREAK_RESET_S = 180  # 3 minutes without a jackpot resets the streak
STREAK_WARNING_S = 30  # "at risk" countdown in the last 30s before that reset
XP_PER_TIER = {"small": 10, "medium": 20, "mega": 40, "milestone": 60}
RATE_XP_BASE = 2
COMBO_WINDOW_S = 4
PRESTIGE_LEVEL_CAP = 20
CHAIN_BASE_PROBABILITY = 0.3
MAX_CHAIN_DEPTH = 2
PUSH_LUCK_BONUS_BASE = 25

# Rotating color themes: each real jackpot shifts the flash color for the
# next payoff - partly variety (a long session's payoff flash doesn't go
# visually stale), matching dashboard.js's COLOR_THEMES/rotateColorTheme().
COLOR_THEME_FLASH = ["#ffdc78", "#dca0ff", "#a0ffc8", "#a0d2ff", "#ffaac8"]


def _decide_chain(tier_name: str, chain_depth: int) -> bool:
    if chain_depth >= MAX_CHAIN_DEPTH:
        return False
    if tier_name not in ("mega", "milestone"):
        return False
    return random.random() < CHAIN_BASE_PROBABILITY * (0.5 ** chain_depth)


def xp_for_level(level: int) -> int:
    # Gentle escalating curve: level N needs 100*N^1.4 cumulative XP.
    return round(100 * level ** 1.4)


class GamificationState:
    def __init__(self):
        self.xp_total = 0
        self.xp_level = 1
        self.prestige_count = 0
        self.jackpot_streak = 0
        self.last_jackpot_at = 0.0
        self.total_jackpot_count = 0
        self.best_streak = 0
        self.lifetime_jackpots = 0
        self.best_milestone_seconds: dict[int, int] = {}
        self.combo_count = 0
        self.combo_expire_at = 0.0
        self.color_theme_index = 0  # not persisted - resets each session, matching the browser
        self.session_started_at = time.time()
        self._load()

    # ---- persistence ----
    def _load(self) -> None:
        try:
            with open(STATE_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
        except (OSError, json.JSONDecodeError):
            return
        self.xp_total = data.get("xp_total", 0)
        self.prestige_count = data.get("prestige_count", 0)
        self.best_streak = data.get("best_streak", 0)
        self.lifetime_jackpots = data.get("lifetime_jackpots", 0)
        self.best_milestone_seconds = {int(k): v for k, v in data.get("best_milestone_seconds", {}).items()}
        self._recompute_level()

    def _save(self) -> None:
        data = {
            "xp_total": self.xp_total,
            "prestige_count": self.prestige_count,
            "best_streak": self.best_streak,
            "lifetime_jackpots": self.lifetime_jackpots,
            "best_milestone_seconds": self.best_milestone_seconds,
        }
        try:
            with open(STATE_PATH, "w", encoding="utf-8") as f:
                json.dump(data, f)
        except OSError:
            pass

    # ---- XP / leveling / prestige ----
    def _recompute_level(self) -> None:
        level = 1
        while self.xp_total >= xp_for_level(level):
            level += 1
        self.xp_level = level

    def award_xp(self, amount: int) -> bool:
        """Returns True if this crossed a level-up."""
        before = self.xp_level
        self.xp_total += amount
        self._recompute_level()
        self._save()
        return self.xp_level > before

    def can_prestige(self) -> bool:
        return self.xp_level >= PRESTIGE_LEVEL_CAP

    def prestige(self) -> None:
        if not self.can_prestige():
            return
        self.prestige_count += 1
        self.xp_total = 0
        self._recompute_level()
        self._save()

    # ---- rating combo ----
    def register_combo(self) -> float:
        now = time.time()
        self.combo_count = self.combo_count + 1 if now < self.combo_expire_at else 1
        self.combo_expire_at = now + COMBO_WINDOW_S
        return self.combo_multiplier()

    def combo_multiplier(self) -> float:
        return min(3.0, 1 + (self.combo_count - 1) * 0.25) if time.time() < self.combo_expire_at else 1.0

    # ---- press-your-luck ----
    def push_luck(self) -> dict:
        won = random.random() < 0.5
        if won:
            bonus = round(PUSH_LUCK_BONUS_BASE * self.combo_multiplier())
            self.award_xp(bonus)
            return {"won": True, "bonus": bonus}
        self.jackpot_streak = 0
        return {"won": False}

    # ---- color theme ----
    def rotate_theme(self) -> None:
        self.color_theme_index += 1

    def current_flash_color(self) -> str:
        return COLOR_THEME_FLASH[self.color_theme_index % len(COLOR_THEME_FLASH)]

    # ---- jackpot / streak / milestone ----
    def _pick_tier(self) -> dict:
        total = sum(t["weight"] for t in JACKPOT_TIERS)
        r = random.random() * total
        for t in JACKPOT_TIERS:
            if r < t["weight"]:
                return t
            r -= t["weight"]
        return JACKPOT_TIERS[0]

    def streak_remaining_s(self) -> float | None:
        if self.jackpot_streak <= 1:
            return None
        return STREAK_RESET_S - (time.time() - self.last_jackpot_at)

    def process_jackpot(self, chain_depth: int = 0) -> dict:
        """Call when the backend reports a real jackpot (snapshot["jackpot"]
        flips True), or again from a chain re-trigger. Returns a result
        dict describing what happened, for the shell to render - mirrors
        runPayoff() in dashboard.js."""
        now = time.time()
        was_at_risk = self.jackpot_streak > 1 and (now - self.last_jackpot_at) >= (STREAK_RESET_S - STREAK_WARNING_S)
        self.rotate_theme()

        self.total_jackpot_count += 1
        milestone = self.total_jackpot_count if self.total_jackpot_count in MILESTONE_COUNTS else None
        tier = MILESTONE_TIER if milestone else self._pick_tier()

        if now - self.last_jackpot_at > STREAK_RESET_S:
            self.jackpot_streak = 0
        self.jackpot_streak += 1
        self.last_jackpot_at = now
        streak = self.jackpot_streak

        leveled_up = self.award_xp(XP_PER_TIER.get(tier["name"], 10) * (3 if milestone else 1))

        self.lifetime_jackpots += 1
        if streak > self.best_streak:
            self.best_streak = streak
        new_milestone_record = False
        if milestone:
            elapsed = int(now - self.session_started_at)
            prev = self.best_milestone_seconds.get(milestone)
            if prev is None or elapsed < prev:
                self.best_milestone_seconds[milestone] = elapsed
                new_milestone_record = True
        self._save()

        return {
            "tier": tier,
            "streak": streak,
            "milestone": milestone,
            "was_at_risk": was_at_risk,
            "leveled_up": leveled_up,
            "new_milestone_record": new_milestone_record,
            "milestone_elapsed_s": self.best_milestone_seconds.get(milestone) if milestone else None,
            "will_chain": _decide_chain(tier["name"], chain_depth),
        }
