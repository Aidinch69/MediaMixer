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
        self._rotate_lock = threading.Lock()

    def stop(self):
        self._stop_event.set()

    def rotate(self, override_folder: Optional[str] = None, side: Side = "all", force: bool = True):
        """Pick fresh video(s) for one screen or all of them.

        `force=False` is used by the automatic expiry check in `run()`: since a
        layout switch or another rotation can resize/repopulate screens between
        when that check reads timers and when it gets the rotation lock, this
        re-verifies the screen is still actually due before touching it, so two
        rotations can't race to pick different videos for the same screen (or
        pick the same video for two different ones).
        """
        with self._rotate_lock:
            if not force and isinstance(side, int):
                lefts, _locked, _barrage = self._state.screen_timers(time.time())
                if side >= len(lefts) or lefts[side] > 0.5:
                    return
            self._rotate_locked(override_folder, side)

    def set_layout_and_rotate(self, name: str):
        """Resize to a new layout and repopulate every screen as one atomic
        step. Doing the resize and the repopulating rotate() as two separate
        calls left a window where the scheduler's own expiry-driven rotation
        could see the freshly-added (and therefore already-"expired") blank
        screens and rotate them itself in between - racing with this method's
        own repopulation and occasionally handing two screens the same clip.
        """
        with self._rotate_lock:
            preset = self._state.set_layout(name)
            self._rotate_locked(None, "all")
            return preset

    def _rotate_locked(self, override_folder: Optional[str], side: Side):
        cfg = self._config
        pace_idx, folder, played, barrage, current_paths, next_paths = self._state.rotation_context()

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

        # Every video currently visible on any screen is off-limits for a new pick,
        # so the same clip never ends up playing in two tiles at once. Paths picked
        # earlier in this same batch are added in as we go, too.
        in_use = {p for p in current_paths if p}

        # A folder switch invalidates whatever was preloaded (it was picked from
        # the old folder), so only honor each screen's preloaded "next" pick when
        # we're staying in the same folder - that's what makes it actually show
        # up without a fresh fetch.
        use_preload = override_folder is None

        for index in indexes:
            if barrage > 0 or is_jackpot:
                expires_in = event_expires_in
            else:
                lo, hi, _label = cfg.pace_presets[pace_idx]
                expires_in = random.randint(lo, hi)
            preferred = next_paths[index] if use_preload and index < len(next_paths) else None
            picked = self._swap_screen(
                index, target, set(in_use), is_jackpot, offset=index, expires_in=expires_in, preferred=preferred
            )
            if picked:
                in_use.add(picked)

        self._state.finish_rotation(
            folder=target,
            played=played + (1 if side == "all" else 0),
            is_jackpot=is_jackpot,
            barrage=barrage,
        )

    def _roll_event(self, barrage: int, pace_idx: int):
        cfg = self._config
        barrage_probability, jackpot_probability = self._state.event_probabilities()
        is_jackpot = False

        if barrage > 0:
            barrage -= 1
            expires_in = random.uniform(*cfg.barrage_clip_seconds)
            if barrage == 0:
                is_jackpot = True
                expires_in = cfg.jackpot_hold_seconds
            return is_jackpot, expires_in, barrage

        if random.random() < barrage_probability:
            barrage = random.randint(cfg.barrage_min, cfg.barrage_max)
            return False, cfg.barrage_clip_seconds[0], barrage

        is_jackpot = random.random() < jackpot_probability
        lo, hi, _label = cfg.pace_presets[pace_idx]
        return is_jackpot, random.randint(lo, hi), barrage

    def _swap_screen(
        self,
        index: int,
        folder: str,
        exclude: set,
        is_jackpot: bool,
        offset: int,
        expires_in: float,
        preferred: Optional[str] = None,
    ) -> Optional[str]:
        cfg = self._config
        if is_jackpot:
            picked = library.pick_video_jackpot(self._db, folder, offset=offset, exclude=exclude)
        elif preferred and preferred not in exclude:
            # Already picked last rotation and preloaded by the browser since -
            # use it so the swap is instant instead of starting a cold fetch.
            picked = preferred
        else:
            picked = library.pick_video(self._db, cfg, folder, exclude=exclude)
        if not picked:
            return None
        library.reward_video(self._db, cfg, picked, 0.0, played=True)
        nxt = library.pick_video(self._db, cfg, folder, exclude=exclude | {picked}) or picked
        self._state.set_screen(index, picked, nxt, time.time() + expires_in)
        return picked

    def tick(self):
        """One control-loop iteration: tension/time-dilation plus expiry-based rotation.

        Called on a shared cadence by whatever's driving this engine - either
        this class's own `run()` loop for standalone use, or a SessionManager
        ticking many sessions' engines in turn.
        """
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
            return

        lefts, _locked, _barrage = self._state.screen_timers(now)
        for index, time_left in enumerate(lefts):
            if time_left <= 0.5:
                self.rotate(side=index, force=False)

    def run(self):
        """Blocking control loop for standalone use: ticks this engine every 0.5s."""
        while not self._stop_event.is_set():
            self.tick()
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
