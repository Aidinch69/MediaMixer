"""Thread-safe mutable engine state shared by the audio, rotation and web threads.

All mutation goes through methods that take the lock internally, so callers
never have to remember to hold `state.lock` themselves (a common source of
races in the original single-file version).

The engine supports an arbitrary number of independently-timed screens
(`ScreenState`), resized on the fly by `set_layout()` when the user swaps
between layout presets (e.g. dual screen <-> 4x4 grid).
"""
from __future__ import annotations

import math
import random
import threading
import time
from dataclasses import dataclass
from typing import List

from .config import Config, LayoutPreset


@dataclass
class ScreenState:
    current: str = ""
    next: str = ""
    expires_at: float = 0.0
    tension: float = 1.0
    speed: float = 1.0
    hype_speed_target: float = 1.0


def _find_preset(config: Config, name: str) -> LayoutPreset:
    for preset in config.layout_presets:
        if preset.name == name:
            return preset
    return config.layout_presets[0]


class RuntimeState:
    def __init__(self, config: Config):
        self._lock = threading.RLock()
        self._config = config

        self.tone_index = 0
        self.binaural_knob = 0.30
        self.isochronic_pulse = 0.0

        self.layout = config.default_layout
        self.screens: List[ScreenState] = [
            ScreenState() for _ in range(_find_preset(config, self.layout).tile_count)
        ]

        self.pace_idx = config.default_pace_idx
        self.current_folder = ""
        self.videos_in_folder = 0

        # Adjustable per-session (default from config), so e.g. an auto-pilot
        # mode can ramp how often barrage/jackpot events happen over time.
        self.barrage_probability = config.barrage_probability
        self.jackpot_probability = config.jackpot_probability
        self.exploration_bonus = config.exploration_bonus_c

        self.locked = False
        self.is_jackpot = False
        # barrage_count: ticks remaining in the current speed-up "hype"
        # window (0.5s each), not a count of screens left to force-rotate -
        # see RotationEngine._tick_barrage. barrage_hype_total is the
        # window's starting tick count, needed to compute how far through
        # it we are for the speed-ramp envelope.
        self.barrage_count = 0
        self.barrage_hype_total = 0
        self.barrage_tile_indexes: List[int] = []
        self.barrage_tier_name = ""

        self.want_skip = False
        self.want_lock = False

        self.preload_enabled = config.default_preload_enabled

    def set_preload_enabled(self, enabled: bool):
        with self._lock:
            self.preload_enabled = enabled

    # -- layout --
    def set_layout(self, name: str) -> LayoutPreset:
        preset = _find_preset(self._config, name)
        with self._lock:
            self.layout = preset.name
            count = preset.tile_count
            if count > len(self.screens):
                self.screens.extend(ScreenState() for _ in range(count - len(self.screens)))
            else:
                del self.screens[count:]
            self.locked = False
            self.is_jackpot = False
            self.barrage_count = 0
            self.barrage_hype_total = 0
            self.barrage_tile_indexes = []
            self.barrage_tier_name = ""
        return preset

    # -- binaural synth parameters (the tone itself is generated client-side via Web Audio) --
    def synth_params(self):
        with self._lock:
            carrier = self._config.tone_modes[self.tone_index]
            max_tension = max((s.tension for s in self.screens), default=1.0)
            beat = (4.0 + self.binaural_knob * 6.0) * max_tension
            return carrier, beat, self.isochronic_pulse

    def cycle_tone(self):
        with self._lock:
            self.tone_index = (self.tone_index + 1) % len(self._config.tone_modes)

    def set_binaural(self, value: float):
        with self._lock:
            self.binaural_knob = max(0.0, min(1.0, value))

    def set_intensity(self, barrage_probability: float, jackpot_probability: float):
        with self._lock:
            self.barrage_probability = max(0.0, min(1.0, barrage_probability))
            self.jackpot_probability = max(0.0, min(1.0, jackpot_probability))

    def event_probabilities(self):
        with self._lock:
            return self.barrage_probability, self.jackpot_probability

    def set_exploration_bonus(self, value: float):
        with self._lock:
            self.exploration_bonus = max(0.0, min(2.0, value))

    def get_exploration_bonus(self) -> float:
        with self._lock:
            return self.exploration_bonus

    # -- skip/lock flags (set from the web thread, consumed by the control loop) --
    def request_skip(self):
        with self._lock:
            self.want_skip = True

    def request_lock(self):
        with self._lock:
            self.want_lock = True

    def consume_flags(self):
        with self._lock:
            skip, lock = self.want_skip, self.want_lock
            self.want_skip = self.want_lock = False
            return skip, lock

    def apply_lock(self, hold_seconds: float):
        with self._lock:
            now = time.time()
            for screen in self.screens:
                screen.expires_at = now + hold_seconds
            self.locked = True

    def current_paths(self) -> List[str]:
        with self._lock:
            return [s.current for s in self.screens]

    def current_path(self, index: int) -> str:
        with self._lock:
            if 0 <= index < len(self.screens):
                return self.screens[index].current
            return ""

    # -- rotation --
    def rotation_context(self):
        with self._lock:
            return (
                self.pace_idx,
                self.current_folder,
                self.videos_in_folder,
                [s.current for s in self.screens],
                [s.next for s in self.screens],
            )

    def set_screen(self, index: int, current: str, nxt: str, expires_at: float):
        with self._lock:
            if not (0 <= index < len(self.screens)):
                return
            screen = self.screens[index]
            screen.current = current
            screen.next = nxt
            screen.expires_at = expires_at
            screen.tension = 1.0
            screen.speed = 1.0

    def finish_rotation(self, folder: str, played: int, is_jackpot: bool = False):
        with self._lock:
            self.current_folder = folder
            self.videos_in_folder = played
            self.locked = False
            self.is_jackpot = is_jackpot

    # -- barrage hype window (speed-up build-up, decoupled from content swaps) --
    def barrage_active(self) -> bool:
        with self._lock:
            return self.barrage_count > 0

    def start_barrage_hype(self, ticks: int, speed_range, tile_indexes: List[int], tier_name: str):
        with self._lock:
            self.barrage_count = ticks
            self.barrage_hype_total = ticks
            self.barrage_tile_indexes = list(tile_indexes)
            self.barrage_tier_name = tier_name
            selected = set(tile_indexes)
            # Only the screens actually named by this barrage get a real
            # speed-up target - every other screen keeps its neutral 1.0 so
            # _tick_tension's hype blend leaves it untouched, instead of the
            # whole grid speeding up for a reveal that only highlights a
            # handful of tiles (which read as the untouched ones stuttering/
            # loading, not as "these are the ones being showcased").
            for idx, screen in enumerate(self.screens):
                screen.hype_speed_target = random.uniform(*speed_range) if idx in selected else 1.0

    def tick_barrage_hype(self) -> bool:
        """Advance the hype countdown by one tick. Returns True exactly once -
        on the tick the countdown reaches zero, the moment to reveal the
        jackpot payoff."""
        with self._lock:
            if self.barrage_count <= 0:
                return False
            self.barrage_count -= 1
            return self.barrage_count == 0

    def barrage_hype_fraction(self) -> float:
        """0 when no hype window is active, otherwise a smooth envelope
        (sine, 0 -> 1 -> 0) over its lifetime so the speed-up ramps in and
        back out instead of snapping to a flat value and back."""
        with self._lock:
            if self.barrage_hype_total <= 0 or self.barrage_count <= 0:
                return 0.0
            progress = 1 - (self.barrage_count / self.barrage_hype_total)
            return math.sin(math.pi * max(0.0, min(1.0, progress)))

    def hype_speed_targets(self) -> List[float]:
        with self._lock:
            return [s.hype_speed_target for s in self.screens]

    def set_is_jackpot(self, value: bool):
        with self._lock:
            self.is_jackpot = value

    def set_pace(self, idx: int, lo: int, hi: int):
        with self._lock:
            now = time.time()
            self.pace_idx = idx
            for screen in self.screens:
                screen.expires_at = now + random.randint(lo, hi)
            self.locked = False

    def screen_timers(self, now: float):
        with self._lock:
            lefts = [max(0.0, s.expires_at - now) for s in self.screens]
            return lefts, self.locked, self.barrage_count

    def update_tension(self, tensions: List[float], speeds: List[float]):
        with self._lock:
            for screen, tension, speed in zip(self.screens, tensions, speeds):
                screen.tension = tension
                screen.speed = speed

    # -- read-only view for the web layer --
    def snapshot(self) -> dict:
        with self._lock:
            return {
                "layout": self.layout,
                "folder": self.current_folder,
                "screens": [
                    {"path": s.current, "next_path": s.next, "tension": s.tension, "speed": s.speed}
                    for s in self.screens
                ],
                "played": self.videos_in_folder,
                "locked": self.locked,
                "jackpot": self.is_jackpot,
                "barrage": self.barrage_count,
                "barrage_tiles": list(self.barrage_tile_indexes),
                "barrage_tier": self.barrage_tier_name,
                "pace_idx": self.pace_idx,
                "tone_index": self.tone_index,
                "binaural_knob": self.binaural_knob,
                "preload_enabled": self.preload_enabled,
            }
