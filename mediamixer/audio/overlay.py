"""VLC-backed looping overlay-audio track player (ambient/background audio)."""
from __future__ import annotations

import logging
import os
import random
import time

try:
    import vlc
except Exception:  # pragma: no cover - depends on libvlc being installed
    vlc = None

from ..config import Config
from ..state import RuntimeState

log = logging.getLogger(__name__)


class OverlayAudio:
    def __init__(self, state: RuntimeState, config: Config):
        self._state = state
        self._config = config
        self.tracks: list[str] = []
        self.index = 0
        self._player = None
        self._instance = None

        if vlc is None:
            log.warning("python-vlc is not installed — overlay audio disabled")
        else:
            try:
                self._instance = vlc.Instance("--no-video --quiet")
            except Exception:
                log.exception("failed to initialize libvlc — overlay audio disabled")

        self._state.set_audio_available(self._instance is not None)
        self.refresh()

    def refresh(self):
        os.makedirs(self._config.audio_dir, exist_ok=True)
        self.tracks = sorted(
            f for f in os.listdir(self._config.audio_dir) if f.lower().endswith(self._config.audio_exts)
        )
        if self.tracks:
            self.index = random.randrange(len(self.tracks))

    def play(self):
        if not self.tracks or self._instance is None:
            return
        if self._player is not None:
            try:
                self._player.stop()
            except Exception:
                log.debug("ignoring error stopping previous overlay track", exc_info=True)

        path = os.path.join(self._config.audio_dir, self.tracks[self.index])
        self._player = self._instance.media_player_new()
        media = self._instance.media_new_path(path)
        media.add_option("input-repeat=9999")
        self._player.set_media(media)
        self._player.play()
        time.sleep(0.15)  # libvlc needs the player briefly running before volume takes effect
        self._player.audio_set_volume(self._state.get_overlay_volume())

    def next_track(self):
        if not self.tracks:
            return
        self.index = (self.index + 1) % len(self.tracks)
        self.play()

    def current_name(self) -> str:
        if self._instance is None:
            return "AUDIO OFFLINE"
        if not self.tracks:
            return "NO AUDIO LOADED"
        return os.path.basename(self.tracks[self.index])

    def set_volume(self, vol: int):
        vol = self._state.set_overlay_volume(vol)
        if self._player is not None:
            self._player.audio_set_volume(vol)

    def stop(self):
        if self._player is not None:
            try:
                self._player.stop()
            except Exception:
                log.debug("ignoring error stopping overlay track on shutdown", exc_info=True)
