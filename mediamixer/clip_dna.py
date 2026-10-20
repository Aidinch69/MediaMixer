"""Clip DNA: a one-time look at each clip - brightness, motion, dominant
colour, duration - so the engine can pick and pair clips by what they look
like, not just by how they've been rated.

Analysis samples ~20s of the clip at 2 frames a second, scaled down to a
48x27 thumbnail, via ffmpeg (the same binary the proxies use, and the small
proxy file when one exists, so it's quick). It runs in a background thread
at below-normal priority, one clip at a time, and results are kept in the
clip_dna table - each clip is analysed once (or again after DNA_VERSION
changes).
"""
from __future__ import annotations

import colorsys
import logging
import math
import os
import subprocess
import threading
import time
from typing import Optional

from .proxy import _find_ffmpeg

log = logging.getLogger(__name__)

DNA_VERSION = 1
SAMPLE_W, SAMPLE_H = 48, 27
SAMPLE_FPS = 2
SAMPLE_SECONDS = 20
HUE_BINS = 24
# Skin tones sit around 345-50 degrees and dominate clips of people, so a
# plain "dominant hue" is orange for nearly everything. The accent hue is
# the strongest colour outside that band - lighting, backgrounds, outfits.
SKIN_HUE_RANGE = (345.0, 50.0)
ACCENT_MIN_STRENGTH = 0.02  # below this share of the frame, a clip has no real accent colour


def _is_skin_bin(k: int) -> bool:
    centre = (k + 0.5) / HUE_BINS * 360
    lo, hi = SKIN_HUE_RANGE
    return centre >= lo or centre <= hi


def _circular_peak(bins, allowed) -> tuple:
    """(hue degrees, weight) around the strongest allowed bin, or (None, 0)."""
    candidates = [k for k in range(HUE_BINS) if allowed(k)]
    if not candidates or max(bins[k] for k in candidates) <= 0:
        return None, 0.0
    peak = max(candidates, key=lambda k: bins[k])
    x = y = weight = 0.0
    for k in range(peak - 2, peak + 3):
        kk = k % HUE_BINS
        if not allowed(kk):
            continue
        w = bins[kk]
        ang = (kk + 0.5) / HUE_BINS * 2 * math.pi
        x += w * math.cos(ang)
        y += w * math.sin(ang)
        weight += w
    return (math.degrees(math.atan2(y, x)) + 360) % 360, weight
_LOW_PRIORITY = getattr(subprocess, "BELOW_NORMAL_PRIORITY_CLASS", 0)
_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def _proxy_for(path: str, config) -> Optional[str]:
    try:
        rel = os.path.relpath(path, config.media_dir)
    except ValueError:
        return None
    proxy = os.path.join(config.proxy_dir, os.path.splitext(rel)[0] + ".proxy.mp4")
    return proxy if os.path.isfile(proxy) else None


def _probe_duration(ffmpeg: str, path: str) -> Optional[float]:
    ext = os.path.splitext(ffmpeg)[1]  # ".exe"/".EXE" on Windows, "" elsewhere
    ffprobe = os.path.join(os.path.dirname(ffmpeg), "ffprobe" + ext)
    if not os.path.isfile(ffprobe):
        return None
    try:
        out = subprocess.run(
            [ffprobe, "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path],
            capture_output=True, text=True, timeout=30, creationflags=_LOW_PRIORITY | _NO_WINDOW,
        ).stdout.strip()
        return float(out) if out else None
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return None


def analyze(path: str, config) -> Optional[dict]:
    """DNA for one clip, or None if it can't be decoded."""
    ffmpeg = _find_ffmpeg()
    if not ffmpeg or not os.path.isfile(path):
        return None
    source = _proxy_for(path, config) or path
    cmd = [
        ffmpeg, "-v", "error", "-t", str(SAMPLE_SECONDS), "-i", source,
        "-vf", f"fps={SAMPLE_FPS},scale={SAMPLE_W}:{SAMPLE_H}:flags=area",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
    ]
    try:
        raw = subprocess.run(cmd, capture_output=True, timeout=120, creationflags=_LOW_PRIORITY | _NO_WINDOW).stdout
    except (OSError, subprocess.TimeoutExpired):
        return None
    frame_bytes = SAMPLE_W * SAMPLE_H * 3
    frames = [raw[i:i + frame_bytes] for i in range(0, len(raw) - frame_bytes + 1, frame_bytes)]
    if not frames:
        return None

    lumas = []
    hue_bins = [0.0] * HUE_BINS
    sat_total = 0.0
    warm_total = 0.0
    px_total = 0
    for f in frames:
        luma = []
        for i in range(0, frame_bytes, 3):
            r, g, b = f[i], f[i + 1], f[i + 2]
            luma.append(0.2126 * r + 0.7152 * g + 0.0722 * b)
            h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            sat_total += s
            warm_total += (r - b) / 255
            px_total += 1
            # Colourful, reasonably lit pixels decide the dominant hue.
            w = s * v
            if w > 0.08:
                hue_bins[int(h * HUE_BINS) % HUE_BINS] += w
        lumas.append(luma)

    brightness = sum(sum(l) for l in lumas) / (len(lumas) * len(lumas[0]) * 255)
    # Motion: mean absolute luma change between consecutive samples (0.5s apart).
    diffs = [sum(abs(a - b) for a, b in zip(l1, l2)) / (len(l1) * 255) for l1, l2 in zip(lumas, lumas[1:])]
    motion = sum(diffs) / len(diffs) if diffs else 0.0
    hue, _ = _circular_peak(hue_bins, lambda k: True)
    accent_hue, accent_weight = _circular_peak(hue_bins, lambda k: not _is_skin_bin(k))
    accent_strength = accent_weight / max(1, px_total)
    if accent_strength < ACCENT_MIN_STRENGTH:
        accent_hue = None
    colour_weight = sum(hue_bins)
    return {
        "brightness": round(brightness, 4),
        "motion": round(motion, 4),
        "hue": round(hue, 1) if hue is not None else None,
        "saturation": round(sat_total / max(1, px_total), 4),
        "hue_strength": round(colour_weight / max(1, px_total), 4),  # how colourful the frame is overall
        "accent_hue": round(accent_hue, 1) if accent_hue is not None else None,
        "accent_strength": round(accent_strength, 4),
        "warmth": round(warm_total / max(1, px_total), 4),  # >0 warm (red/orange), <0 cool (blue)
        "duration": _probe_duration(ffmpeg, path),
        "frames": len(frames),
    }


class DnaWorker:
    """Analyses every clip without DNA, one at a time, then rechecks for new
    clips every `idle_s`. Daemon thread; safe to stop at any point."""

    def __init__(self, db, config, idle_s: float = 300.0, gap_s: float = 0.15):
        self._db, self._config = db, config
        self._idle_s, self._gap_s = idle_s, gap_s
        self._stop = threading.Event()
        self.done = 0
        self.failed = 0
        self.current: Optional[str] = None
        self._thread = threading.Thread(target=self._run, name="clip-dna", daemon=True)

    def start(self):
        if _find_ffmpeg():
            self._thread.start()
        else:
            log.warning("ffmpeg not found - Clip DNA analysis disabled")

    def stop(self):
        self._stop.set()

    def _run(self):
        self._stop.wait(20)  # let startup and the first page load settle first
        while not self._stop.is_set():
            todo = self._db.paths_missing_dna(DNA_VERSION)
            if not todo:
                self._stop.wait(self._idle_s)
                continue
            log.info("Clip DNA: %d clip(s) to analyse", len(todo))
            for path in todo:
                if self._stop.is_set():
                    return
                self.current = os.path.basename(path)
                started = time.time()
                dna = analyze(path, self._config)
                if dna:
                    self._db.save_dna(path, dna, DNA_VERSION)
                    self.done += 1
                else:
                    self._db.save_dna(path, None, DNA_VERSION)  # don't retry a broken file forever
                    self.failed += 1
                self.current = None
                # Pace ourselves: rest at least as long as the analysis took.
                self._stop.wait(max(self._gap_s, (time.time() - started) * 0.5))
