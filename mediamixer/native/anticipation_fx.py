"""Visual building block for the anticipation build-up and bonus-window
glow: a colored, opacity-settable overlay. Timing/animation logic lives
in the caller (shell.py's per-frame-ish QTimer), mirroring how
dashboard.js drives its box-shadow-turned-opacity glow from its own
tick loop rather than baking the curve into the widget itself.
"""
from __future__ import annotations

from PySide6.QtCore import Qt, QPropertyAnimation
from PySide6.QtWidgets import QGraphicsOpacityEffect, QWidget


class GlowOverlay(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents)
        self._effect = QGraphicsOpacityEffect(self)
        self._effect.setOpacity(0.0)
        self.setGraphicsEffect(self._effect)
        self._pulse_anim: QPropertyAnimation | None = None
        self.hide()

    def set_color(self, color: str) -> None:
        self.setStyleSheet(f"background-color: {color};")

    def set_opacity(self, value: float) -> None:
        if value <= 0.001:
            self.hide()
            self._effect.setOpacity(0.0)
            return
        if not self.isVisible():
            self.show()
            self.raise_()
        self._effect.setOpacity(min(1.0, value))

    def pulse(self, color: str, low: float, high: float, period_ms: int) -> None:
        """A slow, continuous back-and-forth opacity pulse - for the
        "due" tile aura, which needs to idle visibly rather than drive
        a one-shot animation."""
        self.set_color(color)
        self.show()
        self.raise_()
        self._pulse_anim = QPropertyAnimation(self._effect, b"opacity")
        self._pulse_anim.setDuration(period_ms)
        self._pulse_anim.setStartValue(low)
        self._pulse_anim.setKeyValueAt(0.5, high)
        self._pulse_anim.setEndValue(low)
        self._pulse_anim.setLoopCount(-1)
        self._pulse_anim.start()

    def stop_pulse(self) -> None:
        if self._pulse_anim is not None:
            self._pulse_anim.stop()
            self._pulse_anim = None
        self.set_opacity(0.0)


class MeterBar(QWidget):
    """Always-on charge bar - fixed 4px strip overlaid at the very top of
    the grid (not pushing content down), filling based on how long it's
    been since the last jackpot. Purely cosmetic; doesn't affect odds."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents)
        self.setFixedHeight(4)
        self.setStyleSheet("background-color: rgba(255,255,255,13);")  # Qt QSS alpha is 0-255, not 0-1
        self._fill = QWidget(self)
        self._fill.setStyleSheet("background-color: #ff8040;")
        self._fill.setGeometry(0, 0, 0, 4)

    def set_progress(self, pct: float) -> None:
        pct = max(0.0, min(100.0, pct))
        self._fill.setGeometry(0, 0, round(self.width() * pct / 100), self.height())
