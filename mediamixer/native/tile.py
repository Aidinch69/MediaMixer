"""One grid tile: a QWidget hosting a dedicated libmpv instance embedded
via its native window handle - the native equivalent of a browser's
<video> element, but without Chromium's per-element overhead (this is
the whole point of the native rewrite; see the Phase 0 spike result).

Audio is muted here deliberately - the full audio layer (overlay tracks,
binaural synth, SFX) is explicitly Phase 2, not part of this grid build.
"""
from __future__ import annotations

import os

_NATIVE_DEPS = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "native_deps")
if os.path.isdir(_NATIVE_DEPS):
    os.add_dll_directory(_NATIVE_DEPS)
    os.environ["PATH"] = _NATIVE_DEPS + os.pathsep + os.environ["PATH"]

import mpv  # noqa: E402
from PySide6.QtWidgets import QWidget, QLabel, QPushButton  # noqa: E402


class VideoTile(QWidget):
    def __init__(self, index: int, controls, parent=None):
        super().__init__(parent)
        self.index = index
        self.controls = controls
        self.current_path: str | None = None
        self._player: mpv.MPV | None = None

        self.setMinimumSize(80, 60)
        self.setStyleSheet("background-color: black;")

        self.label = QLabel("", self)
        self.label.setStyleSheet("color: white; background: rgba(0,0,0,150); font-size: 10px; padding: 2px;")
        self.label.move(2, 2)

        self.up_btn = QPushButton("\U0001F44D", self)
        self.down_btn = QPushButton("\U0001F44E", self)
        for btn in (self.up_btn, self.down_btn):
            btn.setFixedSize(24, 24)
        self.up_btn.clicked.connect(lambda: self.controls.rate(self.index, "up"))
        self.down_btn.clicked.connect(lambda: self.controls.rate(self.index, "down"))

    def resizeEvent(self, event):
        super().resizeEvent(event)
        self.down_btn.move(self.width() - 26, self.height() - 26)
        self.up_btn.move(self.width() - 52, self.height() - 26)

    def ensure_player(self) -> None:
        if self._player is not None:
            return
        self._player = mpv.MPV(wid=int(self.winId()), vid="auto", hwdec="auto", mute=True, loop_file="no")

        @self._player.property_observer("eof-reached")
        def _on_eof(_name, value):
            # Only a natural end-of-clip, not a manual stop/reload from
            # set_source() picking a new path - mirrors the browser's
            # <video>'s "ended" event, which has the same property.
            if value:
                self.controls.rotate(self.index)

    def set_source(self, path: str, url: str, name: str) -> None:
        self.label.setText(name or "")
        if path == self.current_path:
            return
        self.current_path = path
        self.ensure_player()
        try:
            self._player.play(url)
        except Exception:
            pass

    def shutdown(self) -> None:
        if self._player is not None:
            try:
                self._player.terminate()
            except Exception:
                pass
            self._player = None
