"""Visual building block for the anticipation build-up and bonus-window
glow: a colored, opacity-settable overlay. Timing/animation logic lives
in the caller (shell.py's per-frame-ish QTimer), mirroring how
dashboard.js drives its box-shadow-turned-opacity glow from its own
tick loop rather than baking the curve into the widget itself.
"""
from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtWidgets import QGraphicsOpacityEffect, QWidget


class GlowOverlay(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents)
        self._effect = QGraphicsOpacityEffect(self)
        self._effect.setOpacity(0.0)
        self.setGraphicsEffect(self._effect)
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
