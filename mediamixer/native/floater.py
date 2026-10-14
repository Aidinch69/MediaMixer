"""A single Floating Overlay FX sprite: a small muted video that drifts
across the grid, then destroys itself. Native port of dashboard.js's
drifting video sprites.

Deliberately NOT mpv-native-window-embedded like VideoTile. A floater
must render stacked *above* the grid tiles' own native embedded mpv
windows - and on this Qt/Windows combination, one native child window
layered above another native child window renders solid black 100% of
the time, confirmed repeatedly via isolated screenshot debugging across
many variants (nested child, owned top-level, unowned+always-on-top
top-level) and with mpv diagnostics proving the decode pipeline itself
was always perfectly healthy (correct dimensions, not idle, no EOF, no
warnings) even while zero pixels reached the screen. The frames
decoded fine; they just never composited. VideoTile never hits this
because grid tiles never overlap each other.

So floaters use OpenCV to decode frames directly in a background
thread and paint them as plain QImages via a normal QWidget paintEvent
- ordinary Qt-rendered content, the same pipeline the vignette and the
rest of the UI already use successfully, with no native window
involved at all. Heavier on CPU per-floater than mpv, but there are
only a handful of floaters on screen at once (unlike the full grid),
and it sidesteps the compositing bug entirely instead of fighting it.

Muted deliberately - floaters are a decorative layer; the grid tiles
and binaural tone already carry the session's primary audio.
"""
from __future__ import annotations

import threading
import time

import cv2
from PySide6.QtCore import Qt, QEasingCurve, QPoint, QPropertyAnimation, Signal
from PySide6.QtGui import QImage, QPainter
from PySide6.QtWidgets import QWidget


class _FrameReader(threading.Thread):
    """Background thread: decodes frames from `url`, loops forever,
    paces itself to the source's own fps so it doesn't spin the CPU."""

    def __init__(self, url: str, on_frame):
        super().__init__(daemon=True)
        self._url = url
        self._on_frame = on_frame
        self._stop = threading.Event()

    def stop(self) -> None:
        self._stop.set()

    def run(self) -> None:
        cap = cv2.VideoCapture(self._url)
        if not cap.isOpened():
            return
        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        if fps <= 1 or fps > 120:
            fps = 30.0
        frame_interval = 1.0 / fps
        try:
            while not self._stop.is_set():
                start = time.monotonic()
                ok, frame = cap.read()
                if not ok:
                    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                    continue
                self._on_frame(frame)
                elapsed = time.monotonic() - start
                remaining = frame_interval - elapsed
                if remaining > 0:
                    self._stop.wait(remaining)
        finally:
            cap.release()


class FloaterSprite(QWidget):
    _frame_ready = Signal(object)

    def __init__(
        self, url: str, size: int, start: tuple, end: tuple, duration_ms: int, on_finished,
        parent=None, opacity: float = 0.6,
    ):
        super().__init__(parent)
        self.setAttribute(Qt.WidgetAttribute.WA_OpaquePaintEvent, False)
        self._on_finished = on_finished
        self.setFixedSize(size, size)
        self._size = size

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
        self._image: QImage | None = None
        self._reader: _FrameReader | None = None

        self._frame_ready.connect(self._on_frame_ready)

        self.move(*start)
        self.show()
        self.raise_()
        self.vignette.raise_()

        self._reader = _FrameReader(url, self._emit_frame)
        self._reader.start()

        self._pos_anim = QPropertyAnimation(self, b"pos")
        self._pos_anim.setDuration(duration_ms)
        self._pos_anim.setStartValue(QPoint(*start))
        self._pos_anim.setEndValue(QPoint(*end))
        self._pos_anim.setEasingCurve(QEasingCurve.Type.InOutSine)
        self._pos_anim.finished.connect(self._finish)
        self._pos_anim.start()

    def _emit_frame(self, frame) -> None:
        # Runs on the reader thread - hand the raw ndarray to the Qt
        # thread via the signal/slot queued-connection, don't touch
        # any QWidget state here.
        self._frame_ready.emit(frame)

    def _on_frame_ready(self, frame) -> None:
        h, w = frame.shape[:2]
        # BGR (OpenCV) -> RGB888, center-cropped to a square so it
        # fills the circular vignette without stretching.
        side = min(w, h)
        x0 = (w - side) // 2
        y0 = (h - side) // 2
        cropped = frame[y0:y0 + side, x0:x0 + side]
        rgb = cv2.cvtColor(cropped, cv2.COLOR_BGR2RGB)
        image = QImage(rgb.data, side, side, rgb.strides[0], QImage.Format.Format_RGB888).copy()
        self._image = image
        self.update()

    def paintEvent(self, event) -> None:
        painter = QPainter(self)
        if self._image is not None:
            scaled = self._image.scaled(
                self._size, self._size,
                Qt.AspectRatioMode.KeepAspectRatioByExpanding,
                Qt.TransformationMode.SmoothTransformation,
            )
            painter.drawImage(0, 0, scaled)
        else:
            painter.fillRect(self.rect(), Qt.GlobalColor.black)

    def _finish(self) -> None:
        self.shutdown()
        if self._on_finished:
            self._on_finished(self)

    def shutdown(self) -> None:
        if self._reader is not None:
            self._reader.stop()
            self._reader = None
        self.hide()
        self.deleteLater()
