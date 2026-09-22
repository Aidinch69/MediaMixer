"""Bundles the wired-up engine components the web layer needs access to."""
from __future__ import annotations

from dataclasses import dataclass

from .audio.overlay import OverlayAudio
from .audio.synth import BinauralSynth
from .config import Config
from .db import Database
from .rotation import RotationEngine
from .state import RuntimeState


@dataclass
class AppContext:
    config: Config
    db: Database
    state: RuntimeState
    overlay: OverlayAudio
    synth: BinauralSynth
    rotation: RotationEngine
