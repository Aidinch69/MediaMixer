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
from PySide6.QtWidgets import QApplication, QGridLayout, QLabel, QMainWindow, QToolBar, QWidget

from .anticipation import (
    AnticipationState, BONUS_WINDOW_CHECK_S, BONUS_WINDOW_DURATION_S, FAKE_NEAR_MISS_BUILD_S,
    FAKE_NEAR_MISS_CHECK_S, HONEST_BUILD_SAFETY_S, SURGE_CHECK_S, XP_PER_BONUS_CLAIM,
)
from .anticipation_fx import GlowOverlay
from .autopilot import AutoPilotState
from .controls import Controls
from .gamification import GamificationState, RATE_XP_BASE, STREAK_WARNING_S
from .payoff_fx import PayoffOverlay, PushLuckPrompt, TierRevealLabel, Toast
from .quests import QuestState
from .tile import VideoTile

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
        self.grid_layout = QGridLayout(central)
        self.grid_layout.setSpacing(2)
        self.grid_layout.setContentsMargins(2, 2, 2, 2)
        self.setCentralWidget(central)

        self.tiles: list[VideoTile] = []
        self.current_columns: int | None = None
        self.current_tile_count: int | None = None

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
        self.statusBar().hide()  # replaced by the floating toast, which is what the browser actually had

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
            self.grid_layout.removeWidget(tile)
            tile.deleteLater()
        self.tiles = []

        for i in range(tile_count):
            tile = VideoTile(i, self.controls)
            tile.rated.connect(self._on_rated)
            self.grid_layout.addWidget(tile, i // columns, i % columns)
            tile.show()
            self.tiles.append(tile)

        self.current_tile_count = tile_count
        self.current_columns = columns
        # Make sure every tile's native window handle is realized before
        # on_status() goes on to call ensure_player() on it (same pattern
        # the validated Phase 0 spike used: show() then processEvents()
        # before embedding mpv into the widget).
        QApplication.processEvents()
        self.theater_glow.raise_()
        self.payoff_overlay.raise_()
        self.tier_reveal.raise_()
        self.toast.raise_()
        self.push_luck_prompt.raise_()

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
        self.build_up_timer.start(33)

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

    def resizeEvent(self, event) -> None:
        super().resizeEvent(event)
        self._sync_overlay_geometry()

    def closeEvent(self, event) -> None:
        for tile in self.tiles:
            tile.shutdown()
        self.client.stop()
        super().closeEvent(event)
