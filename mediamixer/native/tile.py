"""One grid tile: a QWidget hosting a dedicated libmpv instance embedded
via its native window handle - the native equivalent of a browser's
<video> element, but without Chromium's per-element overhead (this is
the whole point of the native rewrite; see the Phase 0 spike result).

Each clip's own embedded audio plays unmuted, same as the browser's
unmuted <video> tags - the synthesized binaural tone and one-shot SFX
layer is separate (see mediamixer/native/audio_engine.py).
"""
from __future__ import annotations

import os
import time

_NATIVE_DEPS = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "native_deps")
if os.path.isdir(_NATIVE_DEPS):
    os.add_dll_directory(_NATIVE_DEPS)
    os.environ["PATH"] = _NATIVE_DEPS + os.pathsep + os.environ["PATH"]

import mpv  # noqa: E402
from PySide6.QtCore import Qt, Signal  # noqa: E402
from PySide6.QtWidgets import QWidget, QLabel, QPushButton  # noqa: E402

from .anticipation_fx import GlowOverlay  # noqa: E402


class VideoTile(QWidget):
    rated = Signal(int, str)  # (tile index, "up"/"down") - shell.py uses this for combo/XP bookkeeping

    def __init__(self, index: int, controls, parent=None):
        super().__init__(parent)
        self.index = index
        self.controls = controls
        self.current_path: str | None = None
        self._player: mpv.MPV | None = None
        self._volume_pct = 100.0

        self.setMinimumSize(80, 60)
        self.setStyleSheet("background-color: black;")

        # mpv embeds into this dedicated child widget's native window
        # handle, not VideoTile's own - a native video window always
        # paints above regular (non-native) Qt sibling widgets within the
        # same parent, so the rating buttons/label have to live on a
        # separate layer and get explicitly raised above it, or the video
        # covers them the moment it starts rendering.
        self.video_surface = QWidget(self)
        self.video_surface.setStyleSheet("background-color: black;")
        self.video_surface.setGeometry(self.rect())

        # Build-up tension pulse and bonus-window highlight both use this
        # one overlay (a tile rarely needs both at once) - raised above
        # the video surface but kept below the label/buttons.
        self.glow = GlowOverlay(self)
        self.glow.setGeometry(self.rect())

        # Mystery tile: a pure curiosity-gap hit. True CSS-style blur
        # can't apply to mpv's native embedded surface (same reason the
        # rating buttons needed manual z-order fixing - a native child
        # window bypasses Qt's own graphics-effect pipeline entirely), so
        # this covers the tile solidly instead of blurring it.
        self.mystery_label = QLabel("?", self)
        self.mystery_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.mystery_label.setStyleSheet(
            "color: white; background-color: rgba(10,5,20,235); font-size: 28px; font-weight: bold;"
        )
        self.mystery_label.setGeometry(self.rect())
        self.mystery_label.hide()

        self.label = QLabel("", self)
        self.label.setStyleSheet(
            "color: white; background: rgba(0,0,0,153); font-size: 11px; font-family: monospace;"
            "padding: 2px 6px; border-radius: 4px;"
        )
        self.label.move(4, 4)

        self.up_btn = QPushButton("\U0001F44D", self)
        self.down_btn = QPushButton("\U0001F44E", self)
        self.up_btn.setStyleSheet(
            "QPushButton { background-color: #1a0a29; border: 1px solid #3d1e4c; border-radius: 4px; }"
            "QPushButton:hover { background-color: #2a1040; border-color: #c866ff; }"
        )
        self.down_btn.setStyleSheet(
            "QPushButton { background-color: #2d0a16; border: 1px solid #4c1e22; border-radius: 4px; }"
            "QPushButton:hover { background-color: #401020; border-color: #ff668c; }"
        )
        for btn in (self.up_btn, self.down_btn):
            btn.setFixedSize(26, 26)
        self.up_btn.clicked.connect(lambda: self._on_rate("up"))
        self.down_btn.clicked.connect(lambda: self._on_rate("down"))

    def _on_rate(self, direction: str) -> None:
        self.controls.rate(self.index, direction)
        self.rated.emit(self.index, direction)

    def resizeEvent(self, event):
        super().resizeEvent(event)
        self.video_surface.setGeometry(0, 0, self.width(), self.height())
        self.glow.setGeometry(0, 0, self.width(), self.height())
        self.mystery_label.setGeometry(0, 0, self.width(), self.height())
        self.down_btn.move(self.width() - 30, self.height() - 30)
        self.up_btn.move(self.width() - 60, self.height() - 30)
        # Re-assert z-order on every resize too, since some platforms
        # re-raise native child windows to the top as a side effect of
        # a resize/geometry change.
        self._raise_overlays()

    def _raise_overlays(self) -> None:
        self.glow.raise_()
        self.mystery_label.raise_()
        self.label.raise_()
        self.up_btn.raise_()
        self.down_btn.raise_()

    def show_mystery(self) -> None:
        self.mystery_label.show()
        self.mystery_label.raise_()

    def hide_mystery(self) -> None:
        self.mystery_label.hide()

    def ensure_player(self) -> None:
        if self._player is not None:
            return
        self._player = mpv.MPV(wid=int(self.video_surface.winId()), vid="auto", hwdec="auto", loop_file="no")
        self._player.volume = self._volume_pct
        self._raise_overlays()

        @self._player.property_observer("eof-reached")
        def _on_eof(_name, value):
            # Only a natural end-of-clip, not a manual stop/reload from
            # set_source() picking a new path - mirrors the browser's
            # <video>'s "ended" event, which has the same property.
            if value:
                self.controls.rotate(self.index)

        # Diagnostic only, for tracking down the reported "goes black and
        # stays black for a while" - prints when mpv itself reports it's
        # stalled waiting on data, so the next occurrence can be
        # correlated with real evidence instead of guessing again.
        @self._player.property_observer("paused-for-cache")
        def _on_buffering(_name, value):
            if value:
                print(f"[tile {self.index}] buffering (paused-for-cache) at {time.strftime('%H:%M:%S')}", flush=True)
            else:
                print(f"[tile {self.index}] resumed at {time.strftime('%H:%M:%S')}", flush=True)

    def set_volume(self, pct: float) -> None:
        self._volume_pct = pct
        if self._player is not None:
            try:
                self._player.volume = pct
            except Exception:
                pass

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

    def aspect_ratio(self) -> float:
        if self._player is not None:
            try:
                w, h = self._player.width, self._player.height
                if w and h:
                    return w / h
            except Exception:
                pass
        return 16 / 9
