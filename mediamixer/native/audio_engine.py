"""Numpy-synthesized one-shot SFX, played via sounddevice - there's no
Web Audio API natively, so this is a from-scratch synthesis engine, not
a port. Mirrors dashboard.js's playChimeSound/playBassDropSound/
playClutchSting/playRiserSound in trigger and feel, not DSP technique -
the browser's riser used filtered noise; this uses a fully vectorized
rising sine sweep instead (no per-sample Python loop, which would be
slow enough to notice) for the same "building tension" cue.

All play_*() calls are non-blocking (sounddevice.play() starts a
background stream and returns immediately).
"""
from __future__ import annotations

import numpy as np
import sounddevice as sd

SAMPLE_RATE = 44100


def _play(buf: np.ndarray) -> None:
    try:
        sd.play(np.clip(buf, -1.0, 1.0).astype(np.float32), samplerate=SAMPLE_RATE)
    except Exception:
        pass


def _toned_segment(freq: float, duration_s: float, attack_s: float = 0.02, decay_rate: float = 3.0) -> np.ndarray:
    n = int(duration_s * SAMPLE_RATE)
    t = np.arange(n) / SAMPLE_RATE
    tone = np.sin(2 * np.pi * freq * t)
    attack_n = max(1, int(attack_s * SAMPLE_RATE))
    env = np.ones(n)
    env[:attack_n] = np.linspace(0, 1, attack_n)
    env *= np.exp(-decay_rate * t)
    return tone * env


def play_chime(scale: float = 1.0) -> None:
    notes = [523.25, 659.25, 783.99, 1046.5, 1318.5] if scale >= 1.3 else [523.25, 659.25, 783.99, 1046.5]
    note_gap_s = 0.09
    note_len_s = 0.5
    total_len = int((note_gap_s * len(notes) + note_len_s) * SAMPLE_RATE)
    mix = np.zeros(total_len)
    amp = min(0.45, 0.255 * scale)
    for i, freq in enumerate(notes):
        seg = _toned_segment(freq, note_len_s) * amp
        start = int(i * note_gap_s * SAMPLE_RATE)
        end = start + len(seg)
        mix[start:end] += seg
    _play(mix)


def play_bass_drop(scale: float = 1.0) -> None:
    duration_s = 0.5
    n = int(duration_s * SAMPLE_RATE)
    t = np.arange(n) / SAMPLE_RATE
    freq = 150 * np.exp(-6 * t / duration_s) + 35
    phase = 2 * np.pi * np.cumsum(freq) / SAMPLE_RATE
    env = np.exp(-4.0 * t / duration_s)
    _play(np.sin(phase) * env * min(0.6, 0.4 * scale))


def play_clutch_sting() -> None:
    gap_s = 0.07
    note_len_s = 0.2
    total_len = int((gap_s * 2 + note_len_s) * SAMPLE_RATE)
    mix = np.zeros(total_len)
    for i, freq in enumerate([880.0, 1174.66]):
        n = int(note_len_s * SAMPLE_RATE)
        t = np.arange(n) / SAMPLE_RATE
        square = np.sign(np.sin(2 * np.pi * freq * t))
        env = np.exp(-20.0 * t)
        start = int(i * gap_s * SAMPLE_RATE)
        end = start + n
        mix[start:end] += square[: end - start] * env[: end - start] * 0.18
    _play(mix)


def play_riser(duration_s: float) -> None:
    duration_s = max(0.3, duration_s)
    n = int(duration_s * SAMPLE_RATE)
    t = np.arange(n) / SAMPLE_RATE
    progress = t / duration_s
    freq = 80 + progress * 400
    phase = 2 * np.pi * np.cumsum(freq) / SAMPLE_RATE
    env = (progress ** 2) * 0.35
    _play(np.sin(phase) * env)


class BinauralPlayer:
    """Continuous binaural/isochronic tone, driven by the same shared
    carrier/beat state the server already tracks (snapshot["synth"],
    the same values dashboard.js's updateSynthParams() reads) - a
    persistent sounddevice.OutputStream fed by a callback, since this is
    an always-on background tone rather than a one-shot cue."""

    def __init__(self, volume: float = 0.4):
        self.carrier_hz = 136.1
        self.beat_hz = 0.0
        self.iso = False
        self.volume = volume
        self._phase_l = 0.0
        self._phase_r = 0.0
        self._iso_phase = 0.0
        self._stream = None
        try:
            self._stream = sd.OutputStream(
                channels=2, samplerate=SAMPLE_RATE, callback=self._callback, blocksize=1024
            )
            self._stream.start()
        except Exception:
            self._stream = None

    def update(self, carrier_hz: float, beat_hz: float, iso: bool) -> None:
        self.carrier_hz = carrier_hz
        self.beat_hz = beat_hz
        self.iso = iso

    def _callback(self, outdata, frames, time_info, status) -> None:
        t = np.arange(frames) / SAMPLE_RATE
        if self.iso:
            left_freq = right_freq = self.carrier_hz
        else:
            left_freq = self.carrier_hz - self.beat_hz / 2
            right_freq = self.carrier_hz + self.beat_hz / 2

        left = np.sin(2 * np.pi * left_freq * t + self._phase_l)
        right = np.sin(2 * np.pi * right_freq * t + self._phase_r)
        self._phase_l = (self._phase_l + 2 * np.pi * left_freq * frames / SAMPLE_RATE) % (2 * np.pi)
        self._phase_r = (self._phase_r + 2 * np.pi * right_freq * frames / SAMPLE_RATE) % (2 * np.pi)

        if self.iso:
            pulse = 0.5 + 0.5 * np.sin(2 * np.pi * self.beat_hz * t + self._iso_phase)
            self._iso_phase = (self._iso_phase + 2 * np.pi * self.beat_hz * frames / SAMPLE_RATE) % (2 * np.pi)
            left = left * pulse
            right = right * pulse

        outdata[:, 0] = (left * self.volume).astype(np.float32)
        outdata[:, 1] = (right * self.volume).astype(np.float32)

    def stop(self) -> None:
        if self._stream is not None:
            try:
                self._stream.stop()
                self._stream.close()
            except Exception:
                pass
            self._stream = None
