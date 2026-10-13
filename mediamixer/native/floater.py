"""A single Floating Overlay FX sprite: a small muted mpv-backed widget
that drifts across the grid, then destroys itself. Native port of
dashboard.js's drifting video sprites.

No fade in/out: two prior attempts (a QGraphicsOpacityEffect on an
ancestor of the native embedded window, then a translucent covering
widget) both failed to render the video correctly - Qt's effect/
translucency compositing doesn't reliably blend with a native embedded
child window (mpv's surface), only with other Qt-rendered content.
Rather than keep guessing at workarounds, the floater just appears at
full visibility and disappears outright; only position animates.

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
from PySide6.QtCore import Qt, QEasingCurve, QPoint, QPropertyAnimation  # noqa: E402
from PySide6.QtWidgets import QApplication, QWidget  # noqa: E402


class FloaterSprite(QWidget):
    def __init__(
        self, url: str, size: int, start: tuple, end: tuple, duration_ms: int, on_finished,
        parent=None, opacity: float = 0.6,
    ):
        super().__init__(parent)
        self._on_finished = on_finished
        self.setFixedSize(size, size)

        # mpv embeds into this dedicated child, not self - a native
        # embedded window always paints above regular Qt sibling
        # widgets, so the vignette has to live on a separate layer
        # raised above it, same pattern as VideoTile.
        self.video_surface = QWidget(self)
        self.video_surface.setGeometry(0, 0, size, size)
        self.video_surface.setStyleSheet("background-color: black;")

        # Vignette: a radial gradient fading from transparent at the
        # center to the grid's background color at the edge - the
        # native embedded window can't be alpha-masked directly (no
        # equivalent of the browser's CSS mask-image), so this
        # approximates the soft-edge look by blending into the
        # background color instead. `opacity` scales how solid the
        # outer ring gets, since the sprite no longer fades as a whole.
        edge_alpha = max(40, min(255, int(opacity * 255)))
        self.vignette = QWidget(self)
        self.vignette.setGeometry(0, 0, size, size)
        self.vignette.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents)
        self.vignette.setStyleSheet(
            "background: qradialgradient(cx:0.5, cy:0.5, radius:0.5, fx:0.5, fy:0.5,"
            f" stop:0 rgba(0,0,0,0), stop:0.6 rgba(0,0,0,0), stop:1 rgba(5,2,10,{edge_alpha}));"
        )

        self.move(*start)
        self.show()
        self.raise_()
        QApplication.processEvents()  # realize the native window handle before embedding mpv into it

        self._player = None
        try:
            self._player = mpv.MPV(wid=int(self.video_surface.winId()), vid="auto", hwdec="auto", mute=True, loop_file="inf")
            self._player.play(url)
            self.vignette.raise_()  # mpv's own native window can reset z-order on creation
        except Exception as e:
            print(f"[floater] mpv embed failed: {e}", flush=True)
            self._player = None

        self._pos_anim = QPropertyAnimation(self, b"pos")
        self._pos_anim.setDuration(duration_ms)
        self._pos_anim.setStartValue(QPoint(*start))
        self._pos_anim.setEndValue(QPoint(*end))
        self._pos_anim.setEasingCurve(QEasingCurve.Type.InOutSine)
        self._pos_anim.finished.connect(self._finish)
        self._pos_anim.start()

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
