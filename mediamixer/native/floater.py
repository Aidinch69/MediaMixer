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
from PySide6.QtCore import Qt, QEasingCurve, QPoint, QPropertyAnimation  # noqa: E402
from PySide6.QtWidgets import QApplication, QGraphicsOpacityEffect, QWidget  # noqa: E402


class FloaterSprite(QWidget):
    def __init__(
        self, url: str, size: int, start: tuple, end: tuple, duration_ms: int, on_finished,
        parent=None, opacity: float = 0.6,
    ):
        super().__init__(parent)
        self._on_finished = on_finished
        self.setFixedSize(size, size)

        # mpv embeds into this dedicated child, not self - same reason
        # VideoTile does it this way: a native embedded window always
        # paints above regular Qt sibling widgets, so the vignette/fade
        # cover have to live on separate layers raised above it.
        self.video_surface = QWidget(self)
        self.video_surface.setGeometry(0, 0, size, size)
        self.video_surface.setStyleSheet("background-color: black;")

        # Vignette: a radial gradient fading from transparent at the
        # center to the grid's background color at the edge. Qt can't
        # alpha-mask a native embedded window directly (no equivalent of
        # the browser's CSS mask-image on this content), so this
        # approximates the same soft-edge look by blending into the
        # background color behind it instead of true alpha transparency.
        self.vignette = QWidget(self)
        self.vignette.setGeometry(0, 0, size, size)
        self.vignette.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents)
        self.vignette.setStyleSheet(
            "background: qradialgradient(cx:0.5, cy:0.5, radius:0.5, fx:0.5, fy:0.5,"
            " stop:0 rgba(0,0,0,0), stop:0.6 rgba(0,0,0,0), stop:1 rgba(5,2,10,255));"
        )

        # Fade in/out: a QGraphicsOpacityEffect on self (or any ancestor
        # of video_surface) renders solid black instead of the video -
        # Qt can't capture a native embedded window's pixels into its
        # own offscreen compositing buffer for an effect, so wrapping
        # the native content in one just blanks it. Fading a separate
        # covering widget (no native descendant) up/down instead gets
        # the same "appears, drifts, disappears" feel by covering and
        # uncovering the video rather than truly blending it with
        # whatever's behind - an approximation, not pixel-identical to
        # the browser's continuously-translucent sprite, but this is a
        # genuine limitation of embedding a native video window, not a
        # setting to tune further.
        self.fade_cover = QWidget(self)
        self.fade_cover.setGeometry(0, 0, size, size)
        self.fade_cover.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents)
        self.fade_cover.setStyleSheet("background-color: #05020a;")
        self._cover_effect = QGraphicsOpacityEffect(self.fade_cover)
        self._cover_effect.setOpacity(1.0)
        self.fade_cover.setGraphicsEffect(self._cover_effect)

        self.move(*start)
        self.show()
        self.raise_()
        QApplication.processEvents()  # realize the native window handle before embedding mpv into it

        self._player = None
        try:
            self._player = mpv.MPV(wid=int(self.video_surface.winId()), vid="auto", hwdec="auto", mute=True, loop_file="inf")
            self._player.play(url)
            self.vignette.raise_()  # mpv's own native window can reset z-order on creation
            self.fade_cover.raise_()
        except Exception:
            self._player = None

        self._pos_anim = QPropertyAnimation(self, b"pos")
        self._pos_anim.setDuration(duration_ms)
        self._pos_anim.setStartValue(QPoint(*start))
        self._pos_anim.setEndValue(QPoint(*end))
        self._pos_anim.setEasingCurve(QEasingCurve.Type.InOutSine)

        self._opacity_anim = QPropertyAnimation(self._cover_effect, b"opacity")
        self._opacity_anim.setDuration(duration_ms)
        self._opacity_anim.setKeyValueAt(0.0, 1.0)
        self._opacity_anim.setKeyValueAt(0.15, 1.0 - opacity)
        self._opacity_anim.setKeyValueAt(0.85, 1.0 - opacity)
        self._opacity_anim.setKeyValueAt(1.0, 1.0)
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
