"""A single Floating Overlay FX sprite: a small muted mpv-backed window
that drifts across the grid, then destroys itself. Native port of
dashboard.js's drifting video sprites.

A genuine top-level window, owned by the main shell - not a child
widget of the grid. A nested native child window (mpv's embedded
surface) stacked *above other native child windows* (the grid tiles
underneath, which are native for the same reason) rendered solid black
every time, confirmed via screenshot debugging: mpv itself reported
fully healthy playback (correct dimensions, not idle, no EOF) the
whole time, so the decode pipeline was never the problem - the frames
just never reached the screen. VideoTile never hits this because tiles
never overlap each other; a floater's whole purpose is to overlap them.
An owned top-level window is just ordinary window-over-window
compositing (stacks above its owner, not above unrelated applications),
which Windows handles natively regardless of content.

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
from PySide6.QtCore import Qt, QEasingCurve, QPoint, QPropertyAnimation, QTimer  # noqa: E402
from PySide6.QtWidgets import QWidget  # noqa: E402


class FloaterSprite(QWidget):
    def __init__(
        self, url: str, size: int, start: tuple, end: tuple, duration_ms: int, on_finished,
        parent=None, opacity: float = 0.6,
    ):
        # Owned top-level window (see module docstring for why) -
        # start/end are expected in GLOBAL screen coordinates, not
        # relative to any grid widget, since this is its own window now.
        super().__init__(parent, Qt.WindowType.FramelessWindowHint | Qt.WindowType.Tool)
        self._on_finished = on_finished
        self.setFixedSize(size, size)

        self.video_surface = QWidget(self)
        self.video_surface.setGeometry(0, 0, size, size)
        self.video_surface.setStyleSheet("background-color: black;")

        # Vignette: a radial gradient fading from transparent at the
        # center to the grid's background color at the edge - the
        # native embedded window can't be alpha-masked directly (no
        # equivalent of the browser's CSS mask-image), so this
        # approximates the soft-edge look by blending into the
        # background color instead.
        edge_alpha = max(40, min(255, int(opacity * 255)))
        self.vignette = QWidget(self)
        self.vignette.setGeometry(0, 0, size, size)
        self.vignette.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents)
        self.vignette.setStyleSheet(
            "background: qradialgradient(cx:0.5, cy:0.5, radius:0.5, fx:0.5, fy:0.5,"
            f" stop:0 rgba(0,0,0,0), stop:0.6 rgba(0,0,0,0), stop:1 rgba(5,2,10,{edge_alpha}));"
        )

        self._url = url
        self._duration_ms = duration_ms
        self._start = start
        self._end = end
        self._player = None

        self.move(*start)
        self.show()
        self.raise_()

        # Still deferred a tick, same reasoning as VideoTile embedding
        # asynchronously rather than in the same call stack as show().
        QTimer.singleShot(50, self._start_playback)

    def _start_playback(self) -> None:
        try:
            self._player = mpv.MPV(wid=int(self.video_surface.winId()), vid="auto", hwdec="auto", mute=True, loop_file="inf")
            self._player.play(self._url)
            self.vignette.raise_()
        except Exception as e:
            print(f"[floater] mpv embed failed: {e}", flush=True)
            self._player = None

        self._pos_anim = QPropertyAnimation(self, b"pos")
        self._pos_anim.setDuration(self._duration_ms)
        self._pos_anim.setStartValue(QPoint(*self._start))
        self._pos_anim.setEndValue(QPoint(*self._end))
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
