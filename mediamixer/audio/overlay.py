"""Overlay-track selection.

Actual playback happens client-side now (an <audio> element in the browser,
so it plays on whichever device has the dashboard open - including a phone).
This class only tracks which ambient track is selected and lets it be
cycled; it never touches local audio hardware.
"""
from __future__ import annotations

import logging
import os
import random
from typing import List, Optional

from ..config import Config

log = logging.getLogger(__name__)


class OverlayAudio:
    def __init__(self, config: Config):
        self._config = config
        self.tracks: List[str] = []
        self.index = 0
        self.refresh()

    def refresh(self):
        os.makedirs(self._config.audio_dir, exist_ok=True)
        self.tracks = sorted(
            f for f in os.listdir(self._config.audio_dir) if f.lower().endswith(self._config.audio_exts)
        )
        if self.tracks:
            self.index = random.randrange(len(self.tracks))

    def next_track(self):
        if not self.tracks:
            return
        self.index = (self.index + 1) % len(self.tracks)

    def current_name(self) -> str:
        if not self.tracks:
            return "NO AUDIO LOADED"
        return os.path.basename(self.tracks[self.index])

    def current_path(self) -> Optional[str]:
        if not self.tracks:
            return None
        return os.path.join(self._config.audio_dir, self.tracks[self.index])
