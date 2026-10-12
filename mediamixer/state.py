"""Thread-safe mutable engine state shared by the audio, rotation and web threads.

All mutation goes through methods that take the lock internally, so callers
never have to remember to hold `state.lock` themselves (a common source of
races in the original single-file version).

The engine supports an arbitrary number of independently-timed screens
(`ScreenState`), resized on the fly by `set_layout()` when the user swaps
between layout presets (e.g. dual screen <-> 4x4 grid).
"""
from __future__ import annotations

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

        self.locked = False
        self.is_jackpot = False
        self.barrage_count = 0

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
                self.barrage_count,
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

    def finish_rotation(self, folder: str, played: int, is_jackpot: bool, barrage: int):
        with self._lock:
            self.current_folder = folder
            self.videos_in_folder = played
            self.locked = False
            self.is_jackpot = is_jackpot
            self.barrage_count = barrage

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
                "jackpot": self.is_jackpot,
                "barrage": self.barrage_count,
                "pace_idx": self.pace_idx,
                "tone_index": self.tone_index,
                "binaural_knob": self.binaural_knob,
                "preload_enabled": self.preload_enabled,
            }
