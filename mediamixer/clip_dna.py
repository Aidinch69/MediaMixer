"""Clip DNA: a one-time look at each clip - brightness, motion, dominant
colour, duration - so the engine can pick and pair clips by what they look
like, not just by how they've been rated.

Analysis samples the whole clip (up to SAMPLE_SECONDS) at 2 frames a second,
scaled down to a 48x27 thumbnail, via ffmpeg (the same binary the proxies
use, and the small proxy file when one exists, so it's quick). Version 2
adds a motion track - every TRACK_STEP_S, how much moves and where in the
frame (for Smart Framing) - and the clip's strongest stretch (peak_at, for
best-moment starts). Version 3 decodes at 10 frames a second for the
clip's own pulse: a 4 Hz motion curve, its motion peaks, its tempo (the
rhythm of repeated movement, overall and per 8s window) and its hook (the
strongest repeating stretch). The v2 fields still come from every 5th
frame, so their values mean the same as before. It runs in a background thread
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

from . import sources
from .proxy import _find_ffmpeg

log = logging.getLogger(__name__)

DNA_VERSION = 3
SAMPLE_W, SAMPLE_H = 48, 27
DECODE_FPS = 10  # fine motion, for the pulse and tempo
SAMPLE_FPS = 2  # the v2 fields: every DECODE_FPS // SAMPLE_FPS-th frame
SAMPLE_SECONDS = 240
COLOUR_EVERY = 4  # colour stats from every 4th sample - plenty, and much quicker
PULSE_HZ = 4
TEMPO_WINDOW_S = 8.0
TEMPO_HOP_S = 4.0
TEMPO_BPM_RANGE = (40.0, 150.0)
TEMPO_MIN_CONF = 0.25  # autocorrelation below this isn't a rhythm
HOOK_S = 2.5
PEAK_MIN_GAP_S = 3.0
TRACK_STEP_S = 2.0
PEAK_WINDOW_S = 6.0
MOTION_NOISE = 6  # per-pixel luma change below this is compression noise, not movement
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
    proxy = sources.get(config).proxy_path(path, "tiles")
    return proxy if proxy and os.path.isfile(proxy) else None


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
        "-vf", f"fps={DECODE_FPS},scale={SAMPLE_W}:{SAMPLE_H}:flags=area",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
    ]
    try:
        raw = subprocess.run(cmd, capture_output=True, timeout=120, creationflags=_LOW_PRIORITY | _NO_WINDOW).stdout
    except (OSError, subprocess.TimeoutExpired):
        return None
    frame_bytes = SAMPLE_W * SAMPLE_H * 3
    fine_frames = [raw[i:i + frame_bytes] for i in range(0, len(raw) - frame_bytes + 1, frame_bytes)]
    if not fine_frames:
        return None
    fine_lumas = [[0.2126 * f[i] + 0.7152 * f[i + 1] + 0.0722 * f[i + 2] for i in range(0, frame_bytes, 3)] for f in fine_frames]
    step = DECODE_FPS // SAMPLE_FPS
    frames = fine_frames[::step]

    lumas = []
    hue_bins = [0.0] * HUE_BINS
    sat_total = 0.0
    warm_total = 0.0
    px_total = 0
    for n, f in enumerate(frames):
        lumas.append(fine_lumas[n * step])
        if n % COLOUR_EVERY:
            continue
        for i in range(0, frame_bytes, 3):
            r, g, b = f[i], f[i + 1], f[i + 2]
            h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            sat_total += s
            warm_total += (r - b) / 255
            px_total += 1
            # Colourful, reasonably lit pixels decide the dominant hue.
            w = s * v
            if w > 0.08:
                hue_bins[int(h * HUE_BINS) % HUE_BINS] += w

    brightness = sum(sum(l) for l in lumas) / (len(lumas) * len(lumas[0]) * 255)
    # Motion between consecutive samples (0.5s apart): how much changed, and
    # where - the change-weighted centre of the frame (0..1 across, 0..1 down).
    pairs = []
    for l1, l2 in zip(lumas, lumas[1:]):
        total = wx = wy = amount = 0.0
        for k, (a, b) in enumerate(zip(l1, l2)):
            d = abs(a - b)
            amount += d
            if d > MOTION_NOISE:
                total += d
                wx += d * (k % SAMPLE_W)
                wy += d * (k // SAMPLE_W)
        cx = (wx / total + 0.5) / SAMPLE_W if total else 0.5
        cy = (wy / total + 0.5) / SAMPLE_H if total else 0.5
        pairs.append((amount / (len(l1) * 255), cx, cy))
    motion = sum(p[0] for p in pairs) / len(pairs) if pairs else 0.0
    track = _motion_track(pairs)
    peak_at = _peak_start(track)
    hue, _ = _circular_peak(hue_bins, lambda k: True)
    accent_hue, accent_weight = _circular_peak(hue_bins, lambda k: not _is_skin_bin(k))
    accent_strength = accent_weight / max(1, px_total)
    if accent_strength < ACCENT_MIN_STRENGTH:
        accent_hue = None
    colour_weight = sum(hue_bins)
    fine = _fine_motion(fine_lumas)
    pulse = _pulse(fine)
    tempo, tempo_conf, tempo_track = _tempo(fine)
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
        "track": track,
        "peak_at": peak_at,
        "pulse": pulse,
        "peaks": _peaks(pulse),
        "tempo": tempo,
        "tempo_conf": tempo_conf,
        "tempo_track": tempo_track,
        "hook_at": _hook_start(fine, tempo_track),
    }


# ---- v3: the clip's own pulse ----
def _fine_motion(lumas) -> list:
    """Mean absolute luma change between consecutive frames (1/DECODE_FPS apart)."""
    n = len(lumas[0]) * 255 if lumas else 1
    raw = [sum(abs(a - b) for a, b in zip(l1, l2)) / n for l1, l2 in zip(lumas, lumas[1:])]
    # Many clips repeat frames (shot at a lower rate, padded to 30 fps), so
    # consecutive values alternate high/low - a fake 5 Hz "rhythm". A [1,2,1]
    # smoothing cancels exactly that alternation and leaves real movement.
    if len(raw) < 3:
        return raw
    return [raw[0]] + [(raw[i - 1] + 2 * raw[i] + raw[i + 1]) / 4 for i in range(1, len(raw) - 1)] + [raw[-1]]


def _pulse(fine) -> Optional[str]:
    """PULSE_HZ motion curve, scaled to the clip's own range (its 95th
    percentile = 255), as a hex string - two characters per sample."""
    if len(fine) < DECODE_FPS:
        return None
    series, i = [], 0.0  # 10 fps -> 4 Hz: 2.5 frames per sample, so chunks alternate 2 and 3
    while int(i) < len(fine):
        a, b = int(i), int(i + DECODE_FPS / PULSE_HZ)
        chunk = fine[a:max(a + 1, b)]
        series.append(sum(chunk) / len(chunk))
        i += DECODE_FPS / PULSE_HZ
    top = sorted(series)[int(len(series) * 0.95) - 1 if len(series) > 20 else -1] or 1e-9
    return "".join(f"{min(255, int(v / top * 255)):02x}" for v in series)


def decode_pulse(hexstr: Optional[str]) -> list:
    return [int(hexstr[i:i + 2], 16) for i in range(0, len(hexstr or ""), 2)]


def _peaks(pulse_hex: Optional[str]) -> list:
    """Times (s) of the clip's motion peaks: local maxima of the smoothed
    pulse in its top 30%, at least PEAK_MIN_GAP_S apart."""
    p = decode_pulse(pulse_hex)
    if len(p) < PULSE_HZ * 4:
        return []
    w = PULSE_HZ  # 1s smoothing
    smooth = [sum(p[max(0, i - w // 2):i + w // 2 + 1]) / len(p[max(0, i - w // 2):i + w // 2 + 1]) for i in range(len(p))]
    cut = sorted(smooth)[int(len(smooth) * 0.7)]
    gap = int(PEAK_MIN_GAP_S * PULSE_HZ)
    cands = [i for i in range(1, len(smooth) - 1) if smooth[i] >= cut and smooth[i] >= smooth[i - 1] and smooth[i] > smooth[i + 1]]
    chosen = []
    for i in sorted(cands, key=lambda i: -smooth[i]):
        if all(abs(i - j) >= gap for j in chosen):
            chosen.append(i)
    return [round(i / PULSE_HZ, 2) for i in sorted(chosen)][:60]


def _autocorr_tempo(x) -> tuple:
    """(bpm, confidence) of the strongest repetition in a fine-motion window."""
    n = len(x)
    if n < DECODE_FPS * 3:
        return None, 0.0
    # Remove the slow trend (a 2s moving average) so only repetition remains.
    w = DECODE_FPS
    detr = [x[i] - sum(x[max(0, i - w):i + w + 1]) / len(x[max(0, i - w):i + w + 1]) for i in range(n)]
    r0 = sum(v * v for v in detr)
    if r0 <= 1e-12:
        return None, 0.0
    lo = max(2, int(DECODE_FPS * 60 / TEMPO_BPM_RANGE[1]))
    hi = min(n // 2, int(math.ceil(DECODE_FPS * 60 / TEMPO_BPM_RANGE[0])))
    if hi <= lo + 1:
        return None, 0.0
    r = {lag: sum(detr[i] * detr[i + lag] for i in range(n - lag)) / r0 for lag in range(lo - 1, hi + 2)}
    best = max(range(lo, hi + 1), key=lambda lag: r[lag])
    if r[best] <= 0 or r[best] < r[best - 1] or r[best] < r[best + 1]:
        return None, max(0.0, r[best])
    # Parabolic interpolation between lags - at 10 fps whole lags are coarse.
    a, b, c = r[best - 1], r[best], r[best + 1]
    denom = a - 2 * b + c
    shift = 0.5 * (a - c) / denom if denom else 0.0
    lag = best + max(-0.5, min(0.5, shift))
    return 60.0 * DECODE_FPS / lag, b


def _tempo(fine) -> tuple:
    """(overall bpm or None, confidence, [[t, bpm, conf], ...] per window)."""
    win, hop = int(TEMPO_WINDOW_S * DECODE_FPS), int(TEMPO_HOP_S * DECODE_FPS)
    track = []
    for start in range(0, max(1, len(fine) - win + 1), hop):
        bpm, conf = _autocorr_tempo(fine[start:start + win])
        track.append([round(start / DECODE_FPS, 1), round(bpm, 1) if bpm and conf >= TEMPO_MIN_CONF else None, round(conf, 3)])
    rhythmic = [(b, c) for _t, b, c in track if b]
    if len(rhythmic) < max(2, math.ceil(len(track) / 3)):  # a rhythm that holds, not one lucky window
        return None, round(max((c for _t, _b, c in track), default=0.0), 3), track
    # Confidence-weighted median.
    rhythmic.sort()
    half, acc = sum(c for _b, c in rhythmic) / 2, 0.0
    for b, c in rhythmic:
        acc += c
        if acc >= half:
            return round(b, 1), round(sum(c for _b, c in rhythmic) / len(track), 3), track
    return None, 0.0, track


def _hook_start(fine, tempo_track) -> Optional[float]:
    """Start of the HOOK_S stretch with the most movement, favouring
    stretches inside a rhythmic window - the bit worth repeating."""
    span = int(HOOK_S * DECODE_FPS)
    if len(fine) < span * 2:
        return None
    conf_at = lambda t: max((c for s, b, c in tempo_track if b and s <= t <= s + TEMPO_WINDOW_S), default=0.0)
    sums = [sum(fine[:span])]
    for i in range(1, len(fine) - span + 1):
        sums.append(sums[-1] - fine[i - 1] + fine[i + span - 1])
    best = max(range(0, len(sums), 2), key=lambda i: sums[i] * (1 + conf_at(i / DECODE_FPS)))
    return round(best / DECODE_FPS, 1)


def _motion_track(pairs) -> list:
    """[[t, motion, cx, cy], ...] every TRACK_STEP_S seconds."""
    per = max(1, int(TRACK_STEP_S * SAMPLE_FPS))
    track = []
    for start in range(0, len(pairs), per):
        chunk = pairs[start:start + per]
        w = sum(p[0] for p in chunk)
        m = w / len(chunk)
        w = w or 1.0
        cx = sum(p[0] * p[1] for p in chunk) / w
        cy = sum(p[0] * p[2] for p in chunk) / w
        track.append([round(start / SAMPLE_FPS, 1), round(m, 4), round(cx, 3), round(cy, 3)])
    return track


def _peak_start(track) -> Optional[float]:
    """Start (seconds) of the PEAK_WINDOW_S stretch with the most movement."""
    span = max(1, int(PEAK_WINDOW_S / TRACK_STEP_S))
    if len(track) < span:
        return None
    best = max(range(len(track) - span + 1), key=lambda i: sum(t[1] for t in track[i:i + span]))
    return track[best][0]


class DnaWorker:
    """Analyses every clip without DNA, one at a time, then rechecks for new
    clips every `idle_s`. Daemon thread; safe to stop at any point."""

    def __init__(self, db, config, idle_s: float = 300.0, gap_s: float = 0.15):
        self._db, self._config = db, config
        self._idle_s, self._gap_s = idle_s, gap_s
        self._stop = threading.Event()
        self._wake = threading.Event()
        self.done = 0
        self.failed = 0
        self.current: Optional[str] = None
        self._thread = threading.Thread(target=self._run, name="clip-dna", daemon=True)

    def start(self):
        if _find_ffmpeg():
            self._thread.start()
        else:
            log.warning("ffmpeg not found - Clip DNA analysis disabled")

    def wake(self):
        """Check for clips to analyse now rather than at the next idle recheck."""
        self._wake.set()

    def stop(self):
        self._stop.set()
        self._wake.set()

    def _run(self):
        self._stop.wait(20)  # let startup and the first page load settle first
        while not self._stop.is_set():
            todo = self._db.paths_missing_dna(DNA_VERSION)
            if not todo:
                self._wake.wait(self._idle_s)
                self._wake.clear()
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
