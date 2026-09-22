"""Screen rotation, barrage/jackpot events, and the tension/time-dilation control loop.

Works over an arbitrary number of screens (`state.screens`), so the same
logic drives both the dual-screen and grid layouts without caring which one
is active.
"""
from __future__ import annotations

import logging
import random
import threading
import time
from typing import Optional, Union

from . import library
from .config import Config
from .db import Database
from .state import RuntimeState

log = logging.getLogger(__name__)

Side = Union[int, str]  # a screen index, or "all"


class RotationEngine:
    def __init__(self, state: RuntimeState, db: Database, config: Config):
        self._state = state
        self._db = db
        self._config = config
        self._stop_event = threading.Event()

    def stop(self):
        self._stop_event.set()

    def rotate(self, override_folder: Optional[str] = None, side: Side = "all"):
        cfg = self._config
        pace_idx, folder, played, barrage, current_paths = self._state.rotation_context()

        target = override_folder or folder
        if override_folder:
            played = 0
        elif not target or played >= cfg.folder_rotation_limit or pace_idx == 3:
            target = library.pick_folder(self._db, cfg)
            played = 0

        if not target:
            library.sync_library(self._db, cfg)
            return

        is_jackpot, event_expires_in, barrage = self._roll_event(barrage, pace_idx)
        indexes = range(len(current_paths)) if side == "all" else [side]

        for index in indexes:
            if barrage > 0 or is_jackpot:
                expires_in = event_expires_in
            else:
                lo, hi, _label = cfg.pace_presets[pace_idx]
                expires_in = random.randint(lo, hi)
            exclude = current_paths[index] if index < len(current_paths) else None
            self._swap_screen(index, target, exclude, is_jackpot, offset=index, expires_in=expires_in)

        self._state.finish_rotation(
            folder=target,
            played=played + (1 if side == "all" else 0),
            is_jackpot=is_jackpot,
            barrage=barrage,
        )

    def _roll_event(self, barrage: int, pace_idx: int):
        cfg = self._config
        is_jackpot = False

        if barrage > 0:
            barrage -= 1
            expires_in = random.uniform(*cfg.barrage_clip_seconds)
            if barrage == 0:
                is_jackpot = True
                expires_in = cfg.jackpot_hold_seconds
            return is_jackpot, expires_in, barrage

        if random.random() < cfg.barrage_probability:
            barrage = random.randint(cfg.barrage_min, cfg.barrage_max)
            return False, cfg.barrage_clip_seconds[0], barrage

        is_jackpot = random.random() < cfg.jackpot_probability
        lo, hi, _label = cfg.pace_presets[pace_idx]
        return is_jackpot, random.randint(lo, hi), barrage

    def _swap_screen(self, index: int, folder: str, exclude: Optional[str], is_jackpot: bool, offset: int, expires_in: float):
        cfg = self._config
        picked = (
            library.pick_video_jackpot(self._db, folder, offset=offset)
            if is_jackpot
            else library.pick_video(self._db, cfg, folder, exclude=exclude)
        )
        if not picked:
            return
        library.reward_video(self._db, cfg, picked, 0.0, played=True)
        nxt = library.pick_video(self._db, cfg, folder, exclude=picked) or picked
        self._state.set_screen(index, picked, nxt, time.time() + expires_in)

    def run(self):
        """Blocking control loop: ticks tension/time-dilation and drives expiry-based rotation."""
        while not self._stop_event.is_set():
            now = time.time()
            want_skip, want_lock = self._state.consume_flags()
            self._tick_tension(now)

            if want_lock:
                self._state.apply_lock(self._config.jackpot_hold_seconds)
                for path in self._state.current_paths():
                    library.reward_video(self._db, self._config, path, self._config.lock_reward)

            if want_skip:
                for path in self._state.current_paths():
                    library.reward_video(self._db, self._config, path, self._config.skip_penalty)
                self.rotate(side="all")
                continue

            lefts, _locked, _barrage = self._state.screen_timers(now)
            for index, time_left in enumerate(lefts):
                if time_left <= 0.5:
                    self.rotate(side=index)

            self._stop_event.wait(0.5)

    def _tick_tension(self, now: float):
        cfg = self._config
        lefts, locked, barrage = self._state.screen_timers(now)

        def tension_speed(time_left: float):
            if barrage > 0:
                return 1.0, cfg.barrage_speed
            if time_left < cfg.tension_window_s and not locked:
                ratio = (cfg.tension_window_s - time_left) / cfg.tension_window_s
                return 1.0 + ratio, 1.0 - (cfg.tension_max_drag * ratio)
            return 1.0, 1.0

        tensions, speeds = [], []
        for time_left in lefts:
            tension, speed = tension_speed(time_left)
            tensions.append(tension)
            speeds.append(speed)
        self._state.update_tension(tensions, speeds)
