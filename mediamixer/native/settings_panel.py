"""Settings panel: a dockable side panel mirroring dashboard.html's
browser panel - grouped toggles/sliders for every FX system plus audio
controls, instead of those only being reachable as toolbar buttons with
no way to tune anything.

Takes the MainShell instance directly and wires controls straight to
its methods/attributes - tighter coupling than a signal-based design,
but this panel exists purely to drive that one shell, so it keeps the
wiring short and readable.
"""
from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QCheckBox, QComboBox, QDockWidget, QGroupBox, QHBoxLayout, QLabel,
    QPushButton, QScrollArea, QSlider, QVBoxLayout, QWidget,
)

LAYOUT_LABELS = {
    "dual": "Dual", "grid2x2": "2x2", "grid2x3": "2x3",
    "grid3x3": "3x3", "grid4x4": "4x4", "grid5x5": "5x5",
}

_PANEL_QSS = """
QGroupBox { color: #c999ff; font-weight: bold; border: 1px solid #1a0f26;
    border-radius: 6px; margin-top: 10px; padding-top: 8px; }
QGroupBox::title { subcontrol-origin: margin; left: 8px; padding: 0 4px; }
QWidget#panelContent { background-color: #0a0515; }
QLabel { color: #d1d1d6; }
QCheckBox { color: #d1d1d6; }
QPushButton { background-color: #150a28; color: #fff; border: 1px solid #2d163f;
    border-radius: 6px; padding: 6px; font-weight: bold; }
QPushButton:hover { background-color: #251538; border-color: #b84dff; }
QPushButton:checked { background-color: #2f1d4f; border-color: #d699ff; }
QComboBox { background-color: #150a28; color: #fff; border: 1px solid #2d163f; border-radius: 4px; padding: 3px; }
"""


def _row(label_text: str) -> tuple:
    row = QHBoxLayout()
    label = QLabel(label_text)
    row.addWidget(label)
    return row, label


def _slider(minimum: int, maximum: int, value: int) -> QSlider:
    s = QSlider(Qt.Orientation.Horizontal)
    s.setRange(minimum, maximum)
    s.setValue(value)
    return s


class SettingsPanel(QDockWidget):
    def __init__(self, shell, parent=None):
        super().__init__("Settings", parent)
        self.shell = shell
        self.setAllowedAreas(Qt.DockWidgetArea.RightDockWidgetArea | Qt.DockWidgetArea.LeftDockWidgetArea)

        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        content = QWidget()
        content.setObjectName("panelContent")
        content.setStyleSheet(_PANEL_QSS)
        layout = QVBoxLayout(content)
        layout.setSpacing(10)

        layout.addWidget(self._build_layout_group())
        layout.addWidget(self._build_anticipation_group())
        layout.addWidget(self._build_floater_group())
        layout.addWidget(self._build_autopilot_group())
        layout.addWidget(self._build_audio_group())
        layout.addWidget(self._build_categories_group())
        layout.addWidget(self._build_progress_group())
        layout.addWidget(self._build_overrides_group())
        layout.addStretch(1)

        scroll.setWidget(content)
        self.setWidget(scroll)

    # ---- sections ----
    def _build_layout_group(self) -> QGroupBox:
        box = QGroupBox("Layout")
        v = QVBoxLayout(box)
        for name, label in LAYOUT_LABELS.items():
            btn = QPushButton(label)
            btn.clicked.connect(lambda checked=False, n=name: self.shell.controls.set_layout(n))
            v.addWidget(btn)

        self.mosaic_check = QCheckBox("Mosaic Fit")
        self.mosaic_check.setChecked(self.shell.mosaic_enabled)
        self.mosaic_check.toggled.connect(self.shell.set_mosaic_enabled)
        v.addWidget(self.mosaic_check)
        return box

    def _build_anticipation_group(self) -> QGroupBox:
        box = QGroupBox("Anticipation FX")
        v = QVBoxLayout(box)

        self.anticipation_check = QCheckBox("Build-up && payoff FX")
        self.anticipation_check.setChecked(self.shell.anticipation_fx_enabled)
        self.anticipation_check.toggled.connect(self.shell.set_anticipation_fx_enabled)
        v.addWidget(self.anticipation_check)

        self.near_miss_check = QCheckBox("Fake near-misses")
        self.near_miss_check.setChecked(self.shell.near_miss_enabled)
        self.near_miss_check.toggled.connect(self.shell.set_near_miss_enabled)
        v.addWidget(self.near_miss_check)

        row, _ = _row("SFX Volume")
        self.sfx_label = QLabel(f"{int(self.shell.sfx_volume * 100)}%")
        row.addWidget(self.sfx_label)
        v.addLayout(row)
        self.sfx_slider = _slider(0, 100, int(self.shell.sfx_volume * 100))
        self.sfx_slider.valueChanged.connect(self._on_sfx_volume)
        v.addWidget(self.sfx_slider)
        return box

    def _build_floater_group(self) -> QGroupBox:
        box = QGroupBox("Floating Overlay FX")
        v = QVBoxLayout(box)

        self.floater_check = QCheckBox("Enabled")
        self.floater_check.setChecked(self.shell.floating_fx_enabled)
        self.floater_check.toggled.connect(self.shell.set_floater_enabled)
        v.addWidget(self.floater_check)

        row, _ = _row("Source")
        self.floater_source_combo = QComboBox()
        self.floater_source_combo.addItems(["dedicated", "library", "both"])
        self.floater_source_combo.setCurrentText(self.shell.floater_source)
        self.floater_source_combo.currentTextChanged.connect(self.shell.set_floater_source)
        row.addWidget(self.floater_source_combo)
        v.addLayout(row)

        row, _ = _row("Count")
        self.floater_count_label = QLabel(str(self.shell.floater_target_count))
        row.addWidget(self.floater_count_label)
        v.addLayout(row)
        self.floater_count_slider = _slider(0, 10, self.shell.floater_target_count)
        self.floater_count_slider.valueChanged.connect(self._on_floater_count)
        v.addWidget(self.floater_count_slider)

        row, _ = _row("Opacity")
        self.floater_opacity_label = QLabel(f"{int(self.shell.floater_opacity * 100)}%")
        row.addWidget(self.floater_opacity_label)
        v.addLayout(row)
        self.floater_opacity_slider = _slider(10, 100, int(self.shell.floater_opacity * 100))
        self.floater_opacity_slider.valueChanged.connect(self._on_floater_opacity)
        v.addWidget(self.floater_opacity_slider)
        return box

    def _build_autopilot_group(self) -> QGroupBox:
        box = QGroupBox("Auto-Pilot")
        v = QVBoxLayout(box)

        self.autopilot_check = QCheckBox("Enabled")
        self.autopilot_check.setChecked(self.shell.autopilot.enabled)
        self.autopilot_check.toggled.connect(self.shell.set_autopilot_enabled)
        v.addWidget(self.autopilot_check)

        row, _ = _row("Cycle Length")
        self.autopilot_label = QLabel(f"{self.shell.autopilot.cycle_minutes:.0f} min")
        row.addWidget(self.autopilot_label)
        v.addLayout(row)
        self.autopilot_slider = _slider(2, 15, int(self.shell.autopilot.cycle_minutes))
        self.autopilot_slider.valueChanged.connect(self._on_autopilot_minutes)
        v.addWidget(self.autopilot_slider)

        self.session_timer_check = QCheckBox("Session timer")
        self.session_timer_check.setChecked(self.shell.session_timer_enabled)
        self.session_timer_check.toggled.connect(self.shell.set_session_timer_enabled)
        v.addWidget(self.session_timer_check)
        return box

    def _build_audio_group(self) -> QGroupBox:
        box = QGroupBox("Audio")
        v = QVBoxLayout(box)

        row, _ = _row("Binaural Tone")
        self.binaural_label = QLabel(f"{int(self.shell.binaural.volume * 100)}%")
        row.addWidget(self.binaural_label)
        v.addLayout(row)
        self.binaural_slider = _slider(0, 100, int(self.shell.binaural.volume * 100))
        self.binaural_slider.valueChanged.connect(self._on_binaural_volume)
        v.addWidget(self.binaural_slider)

        row, _ = _row("Clip Volume")
        self.tile_volume_label = QLabel(f"{int(self.shell.tile_volume_pct)}%")
        row.addWidget(self.tile_volume_label)
        v.addLayout(row)
        self.tile_volume_slider = _slider(0, 100, int(self.shell.tile_volume_pct))
        self.tile_volume_slider.valueChanged.connect(self._on_tile_volume)
        v.addWidget(self.tile_volume_slider)

        cycle_btn = QPushButton("Cycle Carrier Frequency")
        cycle_btn.clicked.connect(self.shell.controls.cycle_tone)
        v.addWidget(cycle_btn)

        row, _ = _row("Binaural Beat")
        row.addWidget(QLabel(""))
        v.addLayout(row)
        self.beat_slider = _slider(0, 100, 0)
        self.beat_slider.valueChanged.connect(lambda v: self.shell.controls.set_vector("binaural", v / 100))
        v.addWidget(self.beat_slider)
        return box

    def _build_categories_group(self) -> QGroupBox:
        box = QGroupBox("Categories")
        v = QVBoxLayout(box)
        for folder in self.shell.controls.list_folders():
            btn = QPushButton(folder)
            btn.clicked.connect(lambda checked=False, f=folder: self.shell.controls.set_folder(f))
            v.addWidget(btn)
        return box

    def _build_progress_group(self) -> QGroupBox:
        box = QGroupBox("Progress && Challenges")
        v = QVBoxLayout(box)
        self.bests_label = QLabel("")
        self.bests_label.setWordWrap(True)
        v.addWidget(self.bests_label)
        self.quest_label = QLabel("")
        self.quest_label.setWordWrap(True)
        v.addWidget(self.quest_label)
        self.prestige_btn = QPushButton("⭐ Prestige")
        self.prestige_btn.clicked.connect(self.shell._on_prestige)
        self.prestige_btn.setVisible(False)
        v.addWidget(self.prestige_btn)
        return box

    def _build_overrides_group(self) -> QGroupBox:
        box = QGroupBox("Overrides")
        v = QVBoxLayout(box)
        skip_btn = QPushButton("Skip All")
        skip_btn.clicked.connect(self.shell.controls.skip)
        v.addWidget(skip_btn)
        lock_btn = QPushButton("Lock 60s")
        lock_btn.clicked.connect(self.shell.controls.lock)
        v.addWidget(lock_btn)
        return box

    # ---- slider handlers (keep the % label in sync) ----
    def _on_sfx_volume(self, value: int) -> None:
        self.sfx_label.setText(f"{value}%")
        self.shell.set_sfx_volume(value / 100)

    def _on_binaural_volume(self, value: int) -> None:
        self.binaural_label.setText(f"{value}%")
        self.shell.set_binaural_volume(value / 100)

    def _on_tile_volume(self, value: int) -> None:
        self.tile_volume_label.setText(f"{value}%")
        self.shell.set_tile_volume(value)

    def _on_floater_count(self, value: int) -> None:
        self.floater_count_label.setText(str(value))
        self.shell.set_floater_count(value)

    def _on_floater_opacity(self, value: int) -> None:
        self.floater_opacity_label.setText(f"{value}%")
        self.shell.set_floater_opacity(value / 100)

    def _on_autopilot_minutes(self, value: int) -> None:
        self.autopilot_label.setText(f"{value} min")
        self.shell.set_autopilot_minutes(value)

    # ---- called by the shell whenever readouts change ----
    def update_readouts(self, bests_text: str, quest_text: str, can_prestige: bool) -> None:
        self.bests_label.setText(bests_text)
        self.quest_label.setText(quest_text)
        self.prestige_btn.setVisible(can_prestige)
