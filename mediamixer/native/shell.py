"""Native desktop shell: a grid of VideoTile widgets mirroring the
current session's layout, fed by the existing Flask backend's live
status stream - the native equivalent of dashboard.js's render()/
ensureTiles(), reading the exact same snapshot shape over the wire.
"""
from __future__ import annotations

import math
import random
import time

from PySide6.QtCore import QTimer
from PySide6.QtGui import QAction
from PySide6.QtWidgets import QApplication, QLabel, QMainWindow, QToolBar, QWidget

from .anticipation import (
    AnticipationState, ANTICIPATION_METER_FULL_S, BONUS_WINDOW_CHECK_S, BONUS_WINDOW_DURATION_S,
    DUE_AURA_THRESHOLD_S, FAKE_NEAR_MISS_BUILD_S, FAKE_NEAR_MISS_CHECK_S, HONEST_BUILD_SAFETY_S,
    MYSTERY_TILE_CHECK_S, MYSTERY_TILE_PROBABILITY, MYSTERY_TILE_DURATION_S,
    SESSION_PRIMER_MIN_S, SESSION_PRIMER_MAX_S, SURGE_CHECK_S, XP_PER_BONUS_CLAIM,
)
from .anticipation_fx import GlowOverlay, MeterBar
from .autopilot import AutoPilotState
from .controls import Controls
from .gamification import COLOR_THEME_FLASH, GamificationState, RATE_XP_BASE, STREAK_WARNING_S
from .mosaic import compute_mosaic_layout, uniform_layout
from .payoff_fx import PayoffOverlay, PushLuckPrompt, TierRevealLabel, Toast
from .quests import QuestState
from .tile import VideoTile

MOSAIC_REFLOW_INTERVAL_MS = 4000

LAYOUT_LABELS = {
    "dual": "Dual", "grid2x2": "2x2", "grid2x3": "2x3",
    "grid3x3": "3x3", "grid4x4": "4x4", "grid5x5": "5x5",
}


class MainShell(QMainWindow):
    def __init__(self, client, base_url: str):
        super().__init__()
        self.setWindowTitle("MediaMixer (native)")
        self.resize(1400, 1000)
        self.client = client
        self.controls = Controls(client.session, base_url)

        central = QWidget()
        central.setStyleSheet("background-color: #05020a;")
        self.setCentralWidget(central)

        self.tiles: list[VideoTile] = []
        self.current_columns: int | None = None
        self.current_tile_count: int | None = None
        self.mosaic_enabled = False

        self.gamification = GamificationState()
        self.quests = QuestState()
        self.anticipation = AnticipationState()
        self.last_known_jackpot = False
        self.last_known_barrage = 0
        self.payoff_overlay = PayoffOverlay(central)
        self.tier_reveal = TierRevealLabel(central)
        self.toast = Toast(central)
        self.push_luck_prompt = PushLuckPrompt(central)
        self.theater_glow = GlowOverlay(central)
        self.anticipation_meter = MeterBar(central)
        self.statusBar().hide()  # replaced by the floating toast, which is what the browser actually had

        self.tile_last_rated_at: dict[int, float] = {}
        self.due_aura_tile_index = -1
        self.mystery_tile_index = -1

        self.build_up_run_id = 0
        self.build_up_active = False
        self.build_up_is_real = False
        self._build_up_start = 0.0
        self._build_up_duration = 1.0
        self.build_up_timer = QTimer(self)
        self.build_up_timer.timeout.connect(self._tick_buildup)

        self.bonus_tile_index = -1
        self.bonus_expire_at = 0.0

        self.autopilot = AutoPilotState()
        self.autopilot_timer = QTimer(self)
        self.autopilot_timer.timeout.connect(self._tick_autopilot)
        self.autopilot_timer.start(5000)

        self._build_toolbar()
        self._sync_overlay_geometry()
        self._update_readouts()
        client.status_received.connect(self.on_status)

        self.streak_timer = QTimer(self)
        self.streak_timer.timeout.connect(self._tick_streak_warning)
        self.streak_timer.start(1000)

        self.near_miss_timer = QTimer(self)
        self.near_miss_timer.timeout.connect(self._maybe_near_miss)
        self.near_miss_timer.start(int(FAKE_NEAR_MISS_CHECK_S * 1000))

        self.bonus_check_timer = QTimer(self)
        self.bonus_check_timer.timeout.connect(self._maybe_bonus_window)
        self.bonus_check_timer.start(int(BONUS_WINDOW_CHECK_S * 1000))

        self.surge_timer = QTimer(self)
        self.surge_timer.timeout.connect(self.anticipation.maybe_trigger_surge)
        self.surge_timer.start(int(SURGE_CHECK_S * 1000))

        self.mosaic_timer = QTimer(self)
        self.mosaic_timer.timeout.connect(self._layout_tiles)
        self.mosaic_timer.start(MOSAIC_REFLOW_INTERVAL_MS)

        self.anticipation_meter_timer = QTimer(self)
        self.anticipation_meter_timer.timeout.connect(self._tick_anticipation_meter)
        self.anticipation_meter_timer.start(1000)

        self.due_aura_timer = QTimer(self)
        self.due_aura_timer.timeout.connect(self._tick_due_aura)
        self.due_aura_timer.start(5000)

        self.mystery_tile_timer = QTimer(self)
        self.mystery_tile_timer.timeout.connect(self._maybe_mystery_tile)
        self.mystery_tile_timer.start(int(MYSTERY_TILE_CHECK_S * 1000))

        # Session-opening primer: guarantee a near-miss within the first
        # ~15-25s of opening the window, so a session never starts cold
        # waiting for the random checks to land one.
        QTimer.singleShot(int(random.uniform(SESSION_PRIMER_MIN_S, SESSION_PRIMER_MAX_S) * 1000), self._session_primer)

    def _build_toolbar(self) -> None:
        bar = QToolBar("Controls")
        self.addToolBar(bar)

        skip_action = QAction("Skip All", self)
        skip_action.triggered.connect(self.controls.skip)
        bar.addAction(skip_action)

        lock_action = QAction("Lock 60s", self)
        lock_action.triggered.connect(self.controls.lock)
        bar.addAction(lock_action)

        self.autopilot_action = QAction("Auto-Pilot: OFF", self)
        self.autopilot_action.triggered.connect(self._toggle_autopilot)
        bar.addAction(self.autopilot_action)

        self.mosaic_action = QAction("Mosaic Fit: OFF", self)
        self.mosaic_action.triggered.connect(self._toggle_mosaic)
        bar.addAction(self.mosaic_action)

        bar.addSeparator()
        for name, label in LAYOUT_LABELS.items():
            action = QAction(label, self)
            action.triggered.connect(lambda checked=False, n=name: self.controls.set_layout(n))
            bar.addAction(action)

        bar.addSeparator()
        for folder in self.controls.list_folders():
            action = QAction(folder, self)
            action.triggered.connect(lambda checked=False, f=folder: self.controls.set_folder(f))
            bar.addAction(action)

        bar.addSeparator()
        self.level_label = QLabel("")
        self.streak_label = QLabel("")
        self.combo_label = QLabel("")
        self.bests_label = QLabel("")
        for label in (self.level_label, self.streak_label, self.combo_label, self.bests_label):
            label.setStyleSheet("padding: 0 8px; font-weight: bold;")
            bar.addWidget(label)

        self.prestige_action = QAction("⭐ Prestige", self)
        self.prestige_action.triggered.connect(self._on_prestige)
        self.prestige_action.setVisible(False)
        bar.addAction(self.prestige_action)

        bar.addSeparator()
        self.quest_label = QLabel("")
        self.quest_label.setStyleSheet("padding: 0 8px;")
        bar.addWidget(self.quest_label)

    def _rebuild_grid(self, tile_count: int, columns: int) -> None:
        for tile in self.tiles:
            tile.shutdown()
            tile.deleteLater()
        self.tiles = []

        central = self.centralWidget()
        for i in range(tile_count):
            tile = VideoTile(i, self.controls, central)
            tile.rated.connect(self._on_rated)
            tile.show()
            self.tiles.append(tile)

        self.current_tile_count = tile_count
        self.current_columns = columns
        self._layout_tiles()
        # Make sure every tile's native window handle is realized before
        # on_status() goes on to call ensure_player() on it (same pattern
        # the validated Phase 0 spike used: show() then processEvents()
        # before embedding mpv into the widget).
        QApplication.processEvents()
        self.theater_glow.raise_()
        self.anticipation_meter.raise_()
        self.payoff_overlay.raise_()
        self.tier_reveal.raise_()
        self.toast.raise_()
        self.push_luck_prompt.raise_()

    def _layout_tiles(self) -> None:
        central = self.centralWidget()
        width, height = central.width(), central.height()
        if not self.tiles or width <= 0 or height <= 0:
            return
        if self.mosaic_enabled:
            aspect_ratios = [tile.aspect_ratio() for tile in self.tiles]
            target_rows = max(1, round(math.sqrt(len(self.tiles) * height / width)))
            geometry = compute_mosaic_layout(aspect_ratios, width, height, height / target_rows)
        else:
            geometry = uniform_layout(len(self.tiles), self.current_columns or 1, width, height)
        for tile, geo in zip(self.tiles, geometry):
            tile.setGeometry(round(geo["x"]), round(geo["y"]), round(geo["width"]), round(geo["height"]))

    def _toggle_mosaic(self) -> None:
        self.mosaic_enabled = not self.mosaic_enabled
        self.mosaic_action.setText(f"Mosaic Fit: {'ON' if self.mosaic_enabled else 'OFF'}")
        self._layout_tiles()

    def on_status(self, snapshot: dict) -> None:
        screens = snapshot.get("screens") or []
        if not screens:
            return
        columns = snapshot.get("columns", 1)
        if len(screens) != self.current_tile_count or columns != self.current_columns:
            self._rebuild_grid(len(screens), columns)

        for i, s in enumerate(screens):
            if i >= len(self.tiles):
                break
            path = s.get("path")
            if not path:
                continue
            url = f"{self.controls.base_url}/media/{path}?tiles={len(screens)}"
            name = path.rsplit("/", 1)[-1]
            self.tiles[i].set_source(path, url, name)

        barrage = int(snapshot.get("barrage") or 0)
        jackpot = bool(snapshot.get("jackpot"))

        if barrage > 0 and not self.build_up_active:
            self._start_build_up(max(1.5, barrage * 1.8), True)
        if jackpot and not self.last_known_jackpot:
            self._on_jackpot()

        self.last_known_barrage = barrage
        self.last_known_jackpot = jackpot

    # ---- anticipation build-up (real barrage or fake near-miss) ----
    def _start_build_up(self, duration_s: float, is_real: bool) -> None:
        self.build_up_run_id += 1
        self.build_up_active = True
        self.build_up_is_real = is_real
        self._build_up_start = time.time()
        self._build_up_duration = duration_s
        color = self.gamification.current_flash_color()
        self.theater_glow.set_color(color)
        for tile in self.tiles:
            tile.glow.set_color(color)
        self._tease_next_theme()
        self.build_up_timer.start(33)

    def _tease_next_theme(self) -> None:
        # A sub-second glimpse of the *next* theme in the rotation, right
        # as a build-up starts - a coming-attractions sting. Safe even if
        # a real jackpot later rotates the theme differently; this is
        # purely a one-off flash, not persisted state.
        next_color = COLOR_THEME_FLASH[(self.gamification.color_theme_index + 1) % len(COLOR_THEME_FLASH)]
        self.payoff_overlay.flash(next_color, 0.3, 150)

    def _tick_buildup(self) -> None:
        elapsed = time.time() - self._build_up_start
        progress = min(1.0, elapsed / self._build_up_duration)
        intensity = progress * progress
        pulse = 0.5 + 0.5 * math.sin(elapsed * (2 + intensity * 10))
        theater_alpha = min(1.0, (0.15 + intensity * 0.65) * (0.6 + 0.4 * pulse))
        tile_alpha = min(1.0, (0.15 + intensity * 0.5) * (0.65 + 0.35 * pulse))
        self.theater_glow.set_opacity(theater_alpha)
        for tile in self.tiles:
            tile.glow.set_opacity(tile_alpha)

        if progress >= 1.0:
            self.build_up_timer.stop()
            if self.build_up_is_real:
                # Peak reached before the real jackpot landed yet - hold,
                # then a safety net in case it never actually arrives.
                run_id = self.build_up_run_id
                QTimer.singleShot(int(HONEST_BUILD_SAFETY_S * 1000), lambda: self._safety_fizzle(run_id))
            else:
                self._clear_build_up_glow()
                self.build_up_active = False

    def _safety_fizzle(self, run_id: int) -> None:
        if run_id != self.build_up_run_id or not self.build_up_active:
            return
        self._clear_build_up_glow()
        self.build_up_active = False

    def _clear_build_up_glow(self) -> None:
        self.theater_glow.set_opacity(0.0)
        for tile in self.tiles:
            tile.glow.set_opacity(0.0)

    def _maybe_near_miss(self) -> None:
        if self.build_up_active or self.last_known_barrage > 0 or self.last_known_jackpot:
            return
        if self.anticipation.maybe_fake_near_miss(self.gamification.combo_multiplier()):
            self._start_build_up(FAKE_NEAR_MISS_BUILD_S, False)

    # ---- bonus window ----
    def _maybe_bonus_window(self) -> None:
        if self.bonus_tile_index >= 0 or not self.tiles:
            return
        if self.anticipation.maybe_bonus_window(self.gamification.combo_multiplier()):
            idx = random.randrange(len(self.tiles))
            self.bonus_tile_index = idx
            self.bonus_expire_at = time.time() + BONUS_WINDOW_DURATION_S
            tile = self.tiles[idx]
            tile.glow.set_color("#ffd43b")
            tile.glow.set_opacity(0.6)
            QTimer.singleShot(int(BONUS_WINDOW_DURATION_S * 1000), lambda: self._clear_bonus_window(idx))

    def _clear_bonus_window(self, idx: int) -> None:
        if self.bonus_tile_index != idx:
            return
        if idx < len(self.tiles):
            self.tiles[idx].glow.set_opacity(0.0)
        self.bonus_tile_index = -1

    # ---- mystery tile / due aura / anticipation meter / session primer ----
    def _maybe_mystery_tile(self) -> None:
        if self.mystery_tile_index >= 0 or not self.tiles:
            return
        if random.random() < MYSTERY_TILE_PROBABILITY:
            idx = random.randrange(len(self.tiles))
            self.mystery_tile_index = idx
            self.tiles[idx].show_mystery()
            QTimer.singleShot(int(MYSTERY_TILE_DURATION_S * 1000), lambda: self._clear_mystery_tile(idx))

    def _clear_mystery_tile(self, idx: int) -> None:
        if self.mystery_tile_index != idx:
            return
        if idx < len(self.tiles):
            self.tiles[idx].hide_mystery()
        self.mystery_tile_index = -1

    def _tick_due_aura(self) -> None:
        # Only ever the single most-idle tile, not every tile past the
        # threshold - an earlier version of this in the browser build
        # animated every idle tile at once and that was heavy enough to
        # visibly stall video playback.
        now = time.time()
        most_idle_tile = -1
        most_idle_s = DUE_AURA_THRESHOLD_S
        for i in range(len(self.tiles)):
            idle_s = now - self.tile_last_rated_at.get(i, self.anticipation.session_started_at)
            if idle_s > most_idle_s:
                most_idle_s = idle_s
                most_idle_tile = i
        if most_idle_tile == self.due_aura_tile_index:
            return
        if self.due_aura_tile_index >= 0 and self.due_aura_tile_index < len(self.tiles):
            self.tiles[self.due_aura_tile_index].glow.stop_pulse()
        self.due_aura_tile_index = most_idle_tile
        if most_idle_tile >= 0 and most_idle_tile != self.bonus_tile_index and not self.build_up_active:
            self.tiles[most_idle_tile].glow.pulse("#7878ff", 0.25, 0.6, 3000)

    def _tick_anticipation_meter(self) -> None:
        last_payoff = self.gamification.last_jackpot_at or self.anticipation.session_started_at
        elapsed = time.time() - last_payoff
        effective = elapsed * self.anticipation.odds_multiplier(self.gamification.combo_multiplier())
        self.anticipation_meter.set_progress(min(100.0, effective / ANTICIPATION_METER_FULL_S * 100))

    def _session_primer(self) -> None:
        if not self.build_up_active and self.last_known_barrage == 0 and not self.last_known_jackpot:
            self._start_build_up(FAKE_NEAR_MISS_BUILD_S, False)

    def _on_jackpot(self, chain_depth: int = 0) -> None:
        self.build_up_run_id += 1  # invalidate any in-flight build-up loop (real or fake)
        self.build_up_active = False
        self.build_up_timer.stop()
        self._clear_build_up_glow()
        result = self.gamification.process_jackpot(chain_depth)
        self._update_readouts()
        tier = result["tier"]
        self.tier_reveal.reveal(tier["name"], lambda: self._after_reveal(result, chain_depth))

    def _after_reveal(self, result: dict, chain_depth: int) -> None:
        tier = result["tier"]
        flash_color = self.gamification.current_flash_color()
        self.payoff_overlay.flash(flash_color, min(0.75, 0.45 * tier["flash"]), int(650 * min(1.3, tier["flash"])))

        if result["milestone"]:
            label = f"\U0001F3C6 MILESTONE: {result['milestone']} JACKPOTS!"
        else:
            label = {"small": "Jackpot!", "medium": "Big Jackpot!", "mega": "MEGA JACKPOT!"}[tier["name"]]
        prefix = ("⛓ CHAIN! " if chain_depth > 0 else "") + ("\U0001F525 SAVED! " if result["was_at_risk"] else "")
        suffix = f" (streak {result['streak']})" if result["streak"] > 1 else ""
        self.toast.show_message(prefix + label + suffix, duration_ms=3000)
        if result["leveled_up"]:
            self.toast.show_message(f"⭐ Level {self.gamification.xp_level}!", duration_ms=3000)
        if result["new_milestone_record"]:
            self.toast.show_message(
                f"\U0001F3C5 New best: {result['milestone']}th jackpot in {result['milestone_elapsed_s']}s!",
                duration_ms=3000,
            )
        for msg in self.quests.increment("jackpots", self.gamification.award_xp):
            self.toast.show_message(msg, duration_ms=3000)
        self._update_readouts()

        if result["will_chain"]:
            QTimer.singleShot(900, lambda: self._on_jackpot(chain_depth + 1))
        else:
            self.push_luck_prompt.show_prompt(self._bank_win, self._push_luck)

    def _bank_win(self) -> None:
        self.toast.show_message("\U0001F3E6 Banked.")

    def _push_luck(self) -> None:
        result = self.gamification.push_luck()
        if result["won"]:
            self.toast.show_message(f"\U0001F389 Pushed and won +{result['bonus']}xp!")
        else:
            self.toast.show_message("\U0001F4A5 Pushed and lost the streak!", negative=True)
        self._update_readouts()

    def _on_rated(self, index: int, direction: str) -> None:
        self.tile_last_rated_at[index] = time.time()
        if direction == "up" and index == self.bonus_tile_index and time.time() < self.bonus_expire_at:
            self._clear_bonus_window(index)
            self.gamification.award_xp(XP_PER_BONUS_CLAIM)
            self.toast.show_message("✨ Bonus!")

        mult = self.gamification.register_combo()
        self.gamification.award_xp(round(RATE_XP_BASE * mult))
        quest_msgs = self.quests.increment("rates", self.gamification.award_xp)
        self._update_readouts()
        if direction == "up":
            self.toast.show_message("\U0001F44D Reinforced")
        else:
            self.toast.show_message("\U0001F44E Penalized", negative=True)
        for msg in quest_msgs:
            self.toast.show_message(msg, duration_ms=3000)

    def _on_prestige(self) -> None:
        self.gamification.prestige()
        self._update_readouts()

    def _toggle_autopilot(self) -> None:
        if self.autopilot.enabled:
            self.autopilot.disable()
            self.autopilot_action.setText("Auto-Pilot: OFF")
        else:
            self.autopilot.enable(time.time())
            self.autopilot_action.setText("Auto-Pilot: ON")

    def _tick_autopilot(self) -> None:
        self.autopilot.tick(time.time(), self.controls)

    def _tick_streak_warning(self) -> None:
        remaining = self.gamification.streak_remaining_s()
        if remaining is None:
            return
        if remaining <= 0:
            self.gamification.jackpot_streak = 0
            self._update_readouts()
        elif remaining <= STREAK_WARNING_S:
            self.streak_label.setStyleSheet("padding: 0 8px; font-weight: bold; color: #ff6b6b;")
            self.streak_label.setText(f"⚠️ resets in {int(remaining)}s!")

    def _update_readouts(self) -> None:
        g = self.gamification
        stars = "⭐" * min(g.prestige_count, 5)
        self.level_label.setText(f"{stars} LV {g.xp_level} · {g.xp_total}xp")
        if g.jackpot_streak > 1:
            self.streak_label.setStyleSheet("padding: 0 8px; font-weight: bold; color: #ffcc55;")
            self.streak_label.setText(f"\U0001F525 {g.jackpot_streak}")
        else:
            self.streak_label.setText("")
        mult = g.combo_multiplier()
        self.combo_label.setText(f"x{mult:.2f} combo" if mult > 1 else "")
        self.bests_label.setText(f"Best streak: {g.best_streak} · Lifetime jackpots: {g.lifetime_jackpots}")
        self.prestige_action.setVisible(g.can_prestige())
        self.quest_label.setText(self.quests.summary_text())

    def _sync_overlay_geometry(self) -> None:
        rect = self.centralWidget().rect()
        self.theater_glow.setGeometry(rect)
        self.payoff_overlay.setGeometry(rect)
        self.tier_reveal.setGeometry(rect)
        self.anticipation_meter.setGeometry(0, 0, rect.width(), 4)

    def resizeEvent(self, event) -> None:
        super().resizeEvent(event)
        self._sync_overlay_geometry()
        self._layout_tiles()

    def closeEvent(self, event) -> None:
        for tile in self.tiles:
            tile.shutdown()
        self.client.stop()
        super().closeEvent(event)
