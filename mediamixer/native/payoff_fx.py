"""Visual side of the jackpot payoff loop - a translucent flash overlay
and a reel-stop tier-reveal label, both laid over the video grid. Native
equivalent of dashboard.js's payoff-flash/afterglow CSS classes and
revealTier()'s flicker animation, using QPropertyAnimation/QTimer instead
of CSS keyframes/requestAnimationFrame.
"""
from __future__ import annotations

from PySide6.QtCore import Qt, QTimer, QPropertyAnimation
from PySide6.QtWidgets import QGraphicsOpacityEffect, QHBoxLayout, QLabel, QPushButton, QWidget

TIER_LABELS = {"small": "JACKPOT", "medium": "BIG JACKPOT", "mega": "MEGA JACKPOT", "milestone": "MILESTONE"}
TIER_COLORS = {"small": "#d6a3ff", "medium": "#ffa94d", "mega": "#ffd43b", "milestone": "#ffd43b"}
_REVEAL_ORDER = ["small", "medium", "mega"]
_REVEAL_DELAYS_MS = [70, 70, 80, 90, 110, 140, 180, 230, 320]


class PayoffOverlay(QWidget):
    """A full-grid colored flash that fades out - the afterglow is just a
    slower, dimmer version of the same flash() call."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents)
        self._effect = QGraphicsOpacityEffect(self)
        self._effect.setOpacity(0.0)
        self.setGraphicsEffect(self._effect)
        self._anim = QPropertyAnimation(self._effect, b"opacity")
        self._anim.finished.connect(self.hide)
        self.hide()

    def flash(self, color: str, peak_opacity: float, duration_ms: int) -> None:
        self.setStyleSheet(f"background-color: {color};")
        self._anim.stop()
        self.show()
        self.raise_()
        self._anim.setDuration(duration_ms)
        self._anim.setStartValue(peak_opacity)
        self._anim.setEndValue(0.0)
        self._anim.start()


class TierRevealLabel(QLabel):
    """Rolling small/medium/MEGA readout that flickers and settles before
    the payoff fires - mirrors revealTier() in dashboard.js."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.setStyleSheet("font-size: 36px; font-weight: bold; background: transparent;")
        self.hide()

    def reveal(self, tier_name: str, on_done) -> None:
        self.setStyleSheet(
            f"font-size: 36px; font-weight: bold; background: transparent; color: {TIER_COLORS.get(tier_name, '#ffd43b')};"
        )
        self.show()
        self.raise_()
        state = {"i": 0}

        def step(n: int) -> None:
            is_last = n >= len(_REVEAL_DELAYS_MS)
            name = tier_name if is_last else _REVEAL_ORDER[state["i"] % len(_REVEAL_ORDER)]
            state["i"] += 1
            self.setText(TIER_LABELS.get(name, name.upper()))
            if not is_last:
                QTimer.singleShot(_REVEAL_DELAYS_MS[n], lambda: step(n + 1))
            else:
                QTimer.singleShot(500, lambda: self._finish(on_done))

        step(0)

    def _finish(self, on_done) -> None:
        self.hide()
        on_done()


_TOAST_STYLE_NORMAL = (
    "background-color:#2d1445; color:#c999ff; border:1px solid #b84dff;"
    "border-radius:8px; padding:10px 20px; font-weight:bold; font-size:13px;"
)
_TOAST_STYLE_NEGATIVE = (
    "background-color:#2d1445; color:#ff9a9a; border:1px solid #ff4d4d;"
    "border-radius:8px; padding:10px 20px; font-weight:bold; font-size:13px;"
)


class Toast(QLabel):
    """Floating bottom-left notice, same spot/behavior as dashboard.css's
    #toast - a fast, hard-to-miss confirmation that something just
    happened, instead of relying on a readout the eye has to go find."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setStyleSheet(_TOAST_STYLE_NORMAL)
        self.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents)
        self.hide()
        self._timer = QTimer(self)
        self._timer.setSingleShot(True)
        self._timer.timeout.connect(self.hide)

    def show_message(self, text: str, negative: bool = False, duration_ms: int = 1800) -> None:
        self.setStyleSheet(_TOAST_STYLE_NEGATIVE if negative else _TOAST_STYLE_NORMAL)
        self.setText(text)
        self.adjustSize()
        parent_rect = self.parentWidget().rect()
        self.move(25, parent_rect.height() - self.height() - 25)
        self.show()
        self.raise_()
        self._timer.start(duration_ms)


class PushLuckPrompt(QWidget):
    """A short voluntary window after a payoff settles: bank the win as-is,
    or push for a second roll that can grant a bonus or cost the streak.
    Doing nothing auto-banks - mirrors dashboard.js's showPushLuckPrompt().
    """

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setStyleSheet(
            "background-color:#150a28; border:1px solid #b84dff; border-radius:8px;"
        )
        layout = QHBoxLayout(self)
        layout.setContentsMargins(14, 10, 14, 10)
        layout.setSpacing(10)
        label = QLabel("Push your luck?")
        label.setStyleSheet("color:white; font-weight:bold; background:transparent; border:none;")
        self.bank_btn = QPushButton("\U0001F3E6 Bank")
        self.push_btn = QPushButton("\U0001F3B2 Push")
        layout.addWidget(label)
        layout.addWidget(self.bank_btn)
        layout.addWidget(self.push_btn)

        self._on_bank = None
        self._on_push = None
        self.bank_btn.clicked.connect(self._resolve_bank)
        self.push_btn.clicked.connect(self._resolve_push)
        self._timer = QTimer(self)
        self._timer.setSingleShot(True)
        self._timer.timeout.connect(self._resolve_bank)
        self.hide()

    def show_prompt(self, on_bank, on_push, window_ms: int = 6000) -> None:
        if self.isVisible():
            self._resolve_bank()  # settle any prior prompt quietly first
        self._on_bank = on_bank
        self._on_push = on_push
        self.adjustSize()
        parent_rect = self.parentWidget().rect()
        self.move((parent_rect.width() - self.width()) // 2, int(parent_rect.height() * 0.58))
        self.show()
        self.raise_()
        self._timer.start(window_ms)

    def _resolve_bank(self) -> None:
        self.hide()
        self._timer.stop()
        cb, self._on_bank, self._on_push = self._on_bank, None, None
        if cb:
            cb()

    def _resolve_push(self) -> None:
        self.hide()
        self._timer.stop()
        cb, self._on_bank, self._on_push = self._on_push, None, None
        if cb:
            cb()
