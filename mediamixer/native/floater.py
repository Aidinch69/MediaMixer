"""A single Floating Overlay FX sprite: a small muted mpv-backed widget
that drifts across the grid and fades in/out, then destroys itself.
Native port of dashboard.js's drifting video sprites, using
QPropertyAnimation for the drift/fade instead of CSS transitions.

Muted deliberately - floaters are a decorative layer; the grid tiles
and binaural tone already carry the session's primary audio.
"""
from __future__ import annotations

import os

_NATIVE_DEPS = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "native_deps")
if os.path.isdir(_NATIVE_DEPS):
    os.add_dll_directory(_NATIVE_DEPS)
    os.environ["PATH"] = _NATIVE_DEPS + os.pathsep + os.environ["PATH"]

import mpv  # noqa: E402
from PySide6.QtCore import QEasingCurve, QPoint, QPropertyAnimation  # noqa: E402
from PySide6.QtWidgets import QApplication, QGraphicsOpacityEffect, QWidget  # noqa: E402


class FloaterSprite(QWidget):
    def __init__(self, url: str, size: int, start: tuple, end: tuple, duration_ms: int, on_finished, parent=None):
        super().__init__(parent)
        self._on_finished = on_finished
        self.setFixedSize(size, size)
        self.setStyleSheet("background-color: black; border-radius: 6px;")

        self._effect = QGraphicsOpacityEffect(self)
        self._effect.setOpacity(0.0)
        self.setGraphicsEffect(self._effect)

        self.move(*start)
        self.show()
        self.raise_()
        QApplication.processEvents()  # realize the native window handle before embedding mpv into it

        self._player = None
        try:
            self._player = mpv.MPV(wid=int(self.winId()), vid="auto", hwdec="auto", mute=True, loop_file="inf")
            self._player.play(url)
            self.raise_()  # mpv's own native window can reset z-order on creation
        except Exception:
            self._player = None

        self._pos_anim = QPropertyAnimation(self, b"pos")
        self._pos_anim.setDuration(duration_ms)
        self._pos_anim.setStartValue(QPoint(*start))
        self._pos_anim.setEndValue(QPoint(*end))
        self._pos_anim.setEasingCurve(QEasingCurve.Type.InOutSine)

        self._opacity_anim = QPropertyAnimation(self._effect, b"opacity")
        self._opacity_anim.setDuration(duration_ms)
        self._opacity_anim.setKeyValueAt(0.0, 0.0)
        self._opacity_anim.setKeyValueAt(0.15, 0.6)
        self._opacity_anim.setKeyValueAt(0.85, 0.6)
        self._opacity_anim.setKeyValueAt(1.0, 0.0)
        self._opacity_anim.finished.connect(self._finish)

        self._pos_anim.start()
        self._opacity_anim.start()

    def _finish(self) -> None:
        self.shutdown()
        if self._on_finished:
            self._on_finished(self)

    def shutdown(self) -> None:
        if self._player is not None:
            try:
                self._player.terminate()
            except Exception:
                pass
            self._player = None
        self.hide()
        self.deleteLater()
