"""Binaural-beat / isochronic-pulse stereo tone generator.

Runs on its own thread. If no audio output device is available (or
sounddevice isn't installed) it degrades gracefully instead of crashing the
whole process, and reports that fact through `state.synth_available`.
"""
from __future__ import annotations

import logging
import threading

import numpy as np

try:
    import sounddevice as sd
except Exception:  # pragma: no cover - depends on host audio stack
    sd = None

from ..config import Config
from ..state import RuntimeState

log = logging.getLogger(__name__)

VOLUME = 0.15


class BinauralSynth:
    def __init__(self, state: RuntimeState, config: Config):
        self._state = state
        self._config = config
        self._sample_index = 0
        self._stop_event = threading.Event()

    def _callback(self, outdata, frames, time_info, status):
        if status:
            log.debug("audio callback status: %s", status)
        t = (self._sample_index + np.arange(frames)) / self._config.sample_rate
        self._sample_index += frames

        carrier, beat, iso = self._state.synth_params()
        left = np.sin(2 * np.pi * carrier * t)
        right = np.sin(2 * np.pi * (carrier + beat) * t)
        pulse = 0.5 + 0.5 * np.sin(2 * np.pi * beat * t)
        gate = (1.0 - iso) + iso * pulse

        outdata[:, 0] = left * VOLUME * gate
        outdata[:, 1] = right * VOLUME * gate

    def run(self):
        """Blocking; run on a dedicated daemon thread."""
        if sd is None:
            log.warning("sounddevice is not installed — binaural synth disabled")
            self._state.set_synth_available(False)
            return
        try:
            with sd.OutputStream(
                channels=2,
                callback=self._callback,
                samplerate=self._config.sample_rate,
                blocksize=1024,
            ):
                self._state.set_synth_available(True)
                self._stop_event.wait()
        except Exception:
            log.exception("failed to open an audio output device — running without binaural synth")
            self._state.set_synth_available(False)

    def stop(self):
        self._stop_event.set()
