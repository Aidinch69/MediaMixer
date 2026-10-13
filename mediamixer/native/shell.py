"""Native desktop shell: a grid of VideoTile widgets mirroring the
current session's layout, fed by the existing Flask backend's live
status stream - the native equivalent of dashboard.js's render()/
ensureTiles(), reading the exact same snapshot shape over the wire.
"""
from __future__ import annotations

import math

from PySide6.QtGui import QAction
from PySide6.QtWidgets import QApplication, QGridLayout, QMainWindow, QToolBar, QWidget

from .controls import Controls
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

        self._build_toolbar()
        client.status_received.connect(self.on_status)

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

    def _rebuild_grid(self, tile_count: int, columns: int) -> None:
        for tile in self.tiles:
            tile.shutdown()
            self.grid_layout.removeWidget(tile)
            tile.deleteLater()
        self.tiles = []

        for i in range(tile_count):
            tile = VideoTile(i, self.controls)
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

    def closeEvent(self, event) -> None:
        for tile in self.tiles:
            tile.shutdown()
        self.client.stop()
        super().closeEvent(event)
