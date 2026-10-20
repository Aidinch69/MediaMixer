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
        self._ticks_since_barrage_check = 0
        self._barrage_last_active_at = 0.0

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
        """Resize to a new layout and fill any new screens as one atomic
        step. Doing the resize and the fill as two separate calls left a
        window where the scheduler's own expiry-driven rotation could see the
        freshly-added (and therefore already-"expired") blank screens and
        rotate them itself in between - racing with this method and
        occasionally handing two screens the same clip.

        Screens that survive the resize keep their clip and timer: this used
        to re-roll every screen, so Dynamic Mosaic drifting every 30s cut
        every clip on screen every 30s regardless of pace.
        """
        with self._rotate_lock:
            preset = self._state.set_layout(name)
            for index, path in enumerate(self._state.current_paths()):
                if not path:
                    self._rotate_locked(None, index)
            return preset

    def _rotate_locked(self, override_folder: Optional[str], side: Side):
        cfg = self._config
        pace_idx, folder, played, current_paths, next_paths = self._state.rotation_context()

        target = override_folder or folder
        if override_folder:
            played = 0
        elif not target or played >= cfg.folder_rotation_limit or pace_idx == 3:
            target = library.pick_folder(self._db, cfg)
            played = 0

        if not target:
            library.sync_library(self._db, cfg)
            return

        is_jackpot, event_expires_in = self._roll_event(pace_idx)
        # Pinned tiles keep their clip through everything except their own
        # swipe (which unpins first) and filling an empty slot.
        pinned = self._state.busy_indexes()  # pinned or held
        indexes = range(len(current_paths)) if side == "all" else [side]
        indexes = [i for i in indexes if i not in pinned or not current_paths[i]]

        # Every video currently visible on any screen is off-limits for a new pick,
        # so the same clip never ends up playing in two tiles at once - and so is
        # anything shown in the last few minutes (pickers fall back to the full
        # pool if that would leave nothing). Paths picked earlier in this same
        # batch are added in as we go, too.
        in_use = {p for p in current_paths if p} | self._state.recent_paths(cfg.recent_repeat_window_s)

        # A folder switch invalidates whatever was preloaded (it was picked from
        # the old folder), so only honor each screen's preloaded "next" pick when
        # we're staying in the same folder - that's what makes it actually show
        # up without a fresh fetch.
        use_preload = override_folder is None

        for index in indexes:
            if is_jackpot:
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
        )

    def _roll_event(self, pace_idx: int):
        """A plain, unannounced jackpot roll for whichever single screen
        happens to be naturally rotating right now - a "surprise" flavor,
        distinct from the built-up-then-revealed barrage jackpot below.
        No longer threads barrage state through here at all: that's now
        handled once per control-loop tick in _tick_barrage, independent
        of any particular screen's rotation."""
        cfg = self._config
        _barrage_probability, jackpot_probability = self._state.event_probabilities()
        is_jackpot = random.random() < jackpot_probability
        lo, hi, _label = cfg.pace_presets[pace_idx]
        expires_in = cfg.jackpot_hold_seconds if is_jackpot else random.randint(lo, hi)
        return is_jackpot, expires_in

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
            bonus = self._state.get_exploration_bonus()
            picked = library.pick_video(self._db, cfg, folder, exclude=exclude, exploration_bonus=bonus, energy=self._state.get_energy())
        if not picked:
            return None
        library.mark_played(self._db, picked)
        bonus = self._state.get_exploration_bonus()
        nxt = library.pick_video(self._db, cfg, folder, exclude=exclude | {picked}, exploration_bonus=bonus, energy=self._state.get_energy()) or picked
        self._state.set_screen(index, picked, nxt, time.time() + expires_in)
        return picked

    def force_screen(self, index: int, path: str, hold_s: float = None) -> bool:
        """Directly place `path` on `index`, bypassing the normal bandit
        pick entirely - used by True Mystery Tile to show one specific,
        deliberately-chosen clip (a never-before-played one) instead of
        whatever reward-weighted selection would have picked. Still goes
        through the same lock and leaves the same trail (a play_count
        bump, a real preloaded `next`) as an ordinary rotation,
        so nothing downstream has to treat this as a special case."""
        with self._rotate_lock:
            cfg = self._config
            pace_idx, folder, _played, current_paths, _next_paths = self._state.rotation_context()
            if path in current_paths:
                return False  # already showing somewhere else - don't duplicate it
            if hold_s is None and index in self._state.busy_indexes():
                return False  # pinned or mid-moment (e.g. a Gradient) - leave it be
            lo, hi, _label = cfg.pace_presets[pace_idx]
            expires_in = hold_s if hold_s is not None else random.randint(lo, hi)
            library.mark_played(self._db, path)
            bonus = self._state.get_exploration_bonus()
            nxt = library.pick_video(self._db, cfg, folder, exclude={path}, exploration_bonus=bonus, energy=self._state.get_energy()) or path
            self._state.set_screen(index, path, nxt, time.time() + expires_in)
            self._state.hold_screen(index, time.time() + hold_s if hold_s is not None else 0)
            return True

    def trigger_double_feature(self, index_a: int, index_b: int) -> Optional[list]:
        """Places two favorited videos on index_a/index_b together - paired
        by shared Favorites membership, not folder, so it works without
        the viewer having to organize anything. Returns the pair on
        success so the caller (the /api/double_feature route) can tell
        the client which two screens to highlight; None if there aren't
        at least 2 favorites free to pair up right now."""
        with self._rotate_lock:
            cfg = self._config
            pace_idx, folder, _played, current_paths, _next_paths = self._state.rotation_context()
            if {index_a, index_b} & self._state.busy_indexes():
                return None  # one of the two is pinned or mid-moment
            exclude = {p for p in current_paths if p}
            pair = library.pick_double_feature_pair(self._db, exclude)
            if not pair:
                return None
            lo, hi, _label = cfg.pace_presets[pace_idx]
            for index, path in zip((index_a, index_b), pair):
                library.mark_played(self._db, path)
                bonus = self._state.get_exploration_bonus()
                nxt = library.pick_video(self._db, cfg, folder, exclude=exclude | set(pair), exploration_bonus=bonus, energy=self._state.get_energy()) or path
                self._state.set_screen(index, path, nxt, time.time() + random.randint(lo, hi))
            return pair

    def tick(self):
        """One control-loop iteration: barrage hype, tension/time-dilation,
        plus expiry-based rotation.

        Called on a shared cadence by whatever's driving this engine - either
        this class's own `run()` loop for standalone use, or a SessionManager
        ticking many sessions' engines in turn.
        """
        now = time.time()
        want_skip, want_lock = self._state.consume_flags()
        self._tick_barrage(now)
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
        pinned = self._state.busy_indexes()  # pinned or held
        for index, time_left in enumerate(lefts):
            if time_left <= 0.5 and index not in pinned:
                self.rotate(side=index, force=False)

    def run(self):
        """Blocking control loop for standalone use: ticks this engine every 0.5s."""
        while not self._stop_event.is_set():
            self.tick()
            self._stop_event.wait(0.5)

    def _tick_barrage(self, now: float):
        """Advance an in-progress hype window, or roll for a new one.

        Deliberately independent of any particular screen's expiry timer -
        this is what stops a barrage from cascading into a rapid-fire
        content-swap storm across however many screens happen to rotate
        next. The content swap (a handful of screens, picked directly
        below) happens exactly once, atomically, right when the barrage
        starts; everything after that is pure speed/visual build-up on
        already-buffered video.
        """
        cfg = self._config
        if self._state.tick_barrage_hype():
            self._state.set_is_jackpot(True)
            self._barrage_last_active_at = now
            return
        if self._state.barrage_active():
            self._barrage_last_active_at = now
            return
        if now - self._barrage_last_active_at < cfg.barrage_cooldown_s:
            return
        self._ticks_since_barrage_check += 1
        if self._ticks_since_barrage_check < cfg.barrage_check_every_ticks:
            return
        self._ticks_since_barrage_check = 0
        barrage_probability, _jackpot_probability = self._state.event_probabilities()
        if random.random() < barrage_probability:
            self._start_barrage(now)

    def _pick_tier(self):
        cfg = self._config
        total = sum(t.weight for t in cfg.jackpot_tiers)
        roll = random.uniform(0, total)
        upto = 0.0
        for tier in cfg.jackpot_tiers:
            upto += tier.weight
            if roll <= upto:
                return tier
        return cfg.jackpot_tiers[-1]

    def _start_barrage(self, now: float):
        cfg = self._config
        with self._rotate_lock:
            pace_idx, folder, played, current_paths, next_paths = self._state.rotation_context()
            target = folder or library.pick_folder(self._db, cfg)
            if not target:
                return

            tier = self._pick_tier()
            count = min(random.randint(*tier.tile_count), len(current_paths))
            if count <= 0:
                return
            pinned = self._state.busy_indexes()  # pinned or held
            free = [i for i in range(len(current_paths)) if i not in pinned]
            count = min(count, len(free))
            if count <= 0:
                return
            indexes = random.sample(free, count)
            # Bigger tiers don't just look bigger - more of the screens
            # they touch land a genuine top-ranked favorite instead of a
            # normal explore pick, so a mega jackpot is a different grid,
            # not just a louder one.
            jackpot_count = min(tier.jackpot_picks, count)
            jackpot_indexes = set(random.sample(indexes, jackpot_count))
            in_use = {p for p in current_paths if p}
            lo, hi, _label = cfg.pace_presets[pace_idx]

            for index in indexes:
                is_jackpot_pick = index in jackpot_indexes
                expires_in = cfg.jackpot_hold_seconds if is_jackpot_pick else random.randint(lo, hi)
                preferred = next_paths[index] if index < len(next_paths) else None
                picked = self._swap_screen(
                    index, target, set(in_use), is_jackpot_pick, offset=index, expires_in=expires_in,
                    preferred=preferred,
                )
                if picked:
                    in_use.add(picked)

            self._state.finish_rotation(folder=target, played=played)
            ticks = random.randint(*tier.hype_ticks)
            self._state.start_barrage_hype(ticks, tier.speed_range, indexes, tier.name)

    def _tick_tension(self, now: float):
        cfg = self._config
        lefts, locked, _hype_ticks_left = self._state.screen_timers(now)
        hype_fraction = self._state.barrage_hype_fraction()
        hype_targets = self._state.hype_speed_targets() if hype_fraction > 0 else None

        def tension_speed(time_left: float, idx: int):
            if time_left < cfg.tension_window_s and not locked:
                ratio = (cfg.tension_window_s - time_left) / cfg.tension_window_s
                tension, speed = 1.0 + ratio, 1.0 - (cfg.tension_max_drag * ratio)
            else:
                tension, speed = 1.0, 1.0
            if hype_targets is not None:
                speed += (hype_targets[idx] - 1.0) * hype_fraction
                tension = max(tension, 1.0 + hype_fraction * 0.5)
            return tension, speed

        tensions, speeds = [], []
        for idx, time_left in enumerate(lefts):
            tension, speed = tension_speed(time_left, idx)
            tensions.append(tension)
            speeds.append(speed)
        self._state.update_tension(tensions, speeds)
