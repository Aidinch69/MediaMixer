"""Native port of dashboard.js's anticipation/near-miss/bonus-window
system - probability and timing state for the build-up mechanic layered
on real barrage/jackpot signals from the backend, plus client-only fake
near-misses, golden bonus tiles, and the Golden Hour/Surge odds boosts.
Pure logic; mediamixer/native/shell.py wires this to visuals/timers.
"""
from __future__ import annotations

import datetime
import random
import time

FAKE_NEAR_MISS_CHECK_S = 15
FAKE_NEAR_MISS_PROBABILITY = 0.25
FAKE_NEAR_MISS_BUILD_S = 2.5
NEAR_MISS_COOLDOWN_S = 20  # even at max odds, leave breathing room between fake near-misses
HONEST_BUILD_SAFETY_S = 8  # if a real jackpot never arrives after a barrage build-up, fizzle anyway

BONUS_WINDOW_CHECK_S = 25
BONUS_WINDOW_PROBABILITY = 0.3
BONUS_WINDOW_DURATION_S = 5
XP_PER_BONUS_CLAIM = 15

GOLDEN_HOUR_DURATION_S = 20 * 60
GOLDEN_HOUR_MULTIPLIER = 2.5
SURGE_CHECK_S = 20
SURGE_PROBABILITY = 0.08
SURGE_DURATION_RANGE_S = (60, 90)
SURGE_MULTIPLIER = 2.0
ENGAGEMENT_RAMP_S = 30 * 60


class AnticipationState:
    def __init__(self):
        self.session_started_at = time.time()
        self.last_near_miss_at = 0.0
        self.golden_hour_start = self._schedule_golden_hour()
        self.surge_expire_at = 0.0

    def _schedule_golden_hour(self) -> float:
        now = datetime.datetime.now()
        day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        day_end = day_start + datetime.timedelta(days=1)
        earliest = max(now, day_start)
        latest = day_end - datetime.timedelta(seconds=GOLDEN_HOUR_DURATION_S)
        if latest <= earliest:
            return now.timestamp()
        span = (latest - earliest).total_seconds()
        return earliest.timestamp() + random.random() * span

    def is_golden_hour_active(self) -> bool:
        now = time.time()
        return self.golden_hour_start <= now < self.golden_hour_start + GOLDEN_HOUR_DURATION_S

    def maybe_trigger_surge(self) -> None:
        if time.time() < self.surge_expire_at:
            return
        if random.random() < SURGE_PROBABILITY:
            lo, hi = SURGE_DURATION_RANGE_S
            self.surge_expire_at = time.time() + lo + random.random() * (hi - lo)

    def is_surge_active(self) -> bool:
        return time.time() < self.surge_expire_at

    def engagement_multiplier(self) -> float:
        elapsed = time.time() - self.session_started_at
        return 1 + min(1.0, elapsed / ENGAGEMENT_RAMP_S)

    def odds_multiplier(self, combo_multiplier: float = 1.0) -> float:
        # Capped so Golden Hour/Surge/engagement/combo stacking can't push
        # the trigger chance near-guaranteed - same lesson learned the
        # hard way in the browser version (an uncapped stack there caused
        # near-misses to fire back-to-back and stall playback).
        raw = (
            self.engagement_multiplier()
            * (GOLDEN_HOUR_MULTIPLIER if self.is_golden_hour_active() else 1)
            * (SURGE_MULTIPLIER if self.is_surge_active() else 1)
            * combo_multiplier
        )
        return min(3.0, raw)

    def maybe_fake_near_miss(self, combo_multiplier: float = 1.0) -> bool:
        now = time.time()
        if now - self.last_near_miss_at < NEAR_MISS_COOLDOWN_S:
            return False
        if random.random() < FAKE_NEAR_MISS_PROBABILITY * self.odds_multiplier(combo_multiplier):
            self.last_near_miss_at = now
            return True
        return False

    def maybe_bonus_window(self, combo_multiplier: float = 1.0) -> bool:
        return random.random() < BONUS_WINDOW_PROBABILITY * self.odds_multiplier(combo_multiplier)
