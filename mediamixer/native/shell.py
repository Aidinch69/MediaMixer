"""Native desktop shell: a grid of VideoTile widgets mirroring the
current session's layout, fed by the existing Flask backend's live
status stream - the native equivalent of dashboard.js's render()/
ensureTiles(), reading the exact same snapshot shape over the wire.
"""
from __future__ import annotations

from PySide6.QtCore import QTimer
from PySide6.QtGui import QAction
from PySide6.QtWidgets import QApplication, QGridLayout, QLabel, QMainWindow, QToolBar, QWidget

from .controls import Controls
from .gamification import GamificationState, RATE_XP_BASE, STREAK_WARNING_S
from .payoff_fx import PayoffOverlay, TierRevealLabel, Toast
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
        self.last_known_jackpot = False
        self.payoff_overlay = PayoffOverlay(central)
        self.tier_reveal = TierRevealLabel(central)
        self.toast = Toast(central)
        self.statusBar().hide()  # replaced by the floating toast, which is what the browser actually had

        self._build_toolbar()
        self._sync_overlay_geometry()
        self._update_readouts()
        client.status_received.connect(self.on_status)

        self.streak_timer = QTimer(self)
        self.streak_timer.timeout.connect(self._tick_streak_warning)
        self.streak_timer.start(1000)

    def _build_toolbar(self) -> None:
        bar = QToolBar("Controls")
        self.addToolBar(bar)

        skip_action = QAction("Skip All", self)
        skip_action.triggered.connect(self.controls.skip)
        bar.addAction(skip_action)

        lock_action = QAction("Lock 60s", self)
        lock_action.triggered.connect(self.controls.lock)
        bar.addAction(lock_action)

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
        self.payoff_overlay.raise_()
        self.tier_reveal.raise_()
        self.toast.raise_()

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

        jackpot = bool(snapshot.get("jackpot"))
        if jackpot and not self.last_known_jackpot:
            self._on_jackpot()
        self.last_known_jackpot = jackpot

    def _on_jackpot(self) -> None:
        result = self.gamification.process_jackpot()
        tier = result["tier"]
        self.payoff_overlay.flash("#ffd166", min(0.75, 0.45 * tier["flash"]), int(650 * min(1.3, tier["flash"])))
        self.tier_reveal.reveal(tier["name"], lambda: None)
        self._update_readouts()

        if result["milestone"]:
            label = f"\U0001F3C6 MILESTONE: {result['milestone']} JACKPOTS!"
        else:
            label = {"small": "Jackpot!", "medium": "Big Jackpot!", "mega": "MEGA JACKPOT!"}[tier["name"]]
        prefix = "\U0001F525 SAVED! " if result["was_at_risk"] else ""
        suffix = f" (streak {result['streak']})" if result["streak"] > 1 else ""
        self.toast.show_message(prefix + label + suffix, duration_ms=3000)
        if result["leveled_up"]:
            self.toast.show_message(f"⭐ Level {self.gamification.xp_level}!", duration_ms=3000)
        if result["new_milestone_record"]:
            self.toast.show_message(
                f"\U0001F3C5 New best: {result['milestone']}th jackpot in {result['milestone_elapsed_s']}s!",
                duration_ms=3000,
            )

    def _on_rated(self, _index: int, direction: str) -> None:
        mult = self.gamification.register_combo()
        self.gamification.award_xp(round(RATE_XP_BASE * mult))
        self._update_readouts()
        if direction == "up":
            self.toast.show_message("\U0001F44D Reinforced")
        else:
            self.toast.show_message("\U0001F44E Penalized", negative=True)

    def _on_prestige(self) -> None:
        self.gamification.prestige()
        self._update_readouts()

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

    def _sync_overlay_geometry(self) -> None:
        rect = self.centralWidget().rect()
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
