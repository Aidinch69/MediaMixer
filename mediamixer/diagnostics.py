"""The /debug "Export diagnostics" bundle: everything needed to work out a
playback problem on someone else's machine, in one JSON file - the engine
and PC, source/proxy state, how fast the drives read, the event log for the
chosen session, the clips that stalled (probed with ffprobe, original and
proxy), and the end of the engine and background-prep logs.

Contains clip file names and folder paths, nothing else from the library.
"""
from __future__ import annotations

import ctypes
import json
import os
import platform
import random
import subprocess
import sys
import time
from collections import Counter

from . import proxy, sources
from .config import PROJECT_ROOT

STALLED_CLIPS_MAX = 12
SPEED_TEST_BYTES = 32 * 1024 * 1024


def _git_commit() -> str | None:
    try:
        head = open(os.path.join(PROJECT_ROOT, ".git", "HEAD"), encoding="utf-8").read().strip()
        if head.startswith("ref: "):
            ref = os.path.join(PROJECT_ROOT, ".git", *head[5:].split("/"))
            if os.path.isfile(ref):
                return open(ref, encoding="utf-8").read().strip()[:10]
            packed = os.path.join(PROJECT_ROOT, ".git", "packed-refs")
            for line in open(packed, encoding="utf-8"):
                if line.strip().endswith(head[5:]):
                    return line.split()[0][:10]
        return head[:10]
    except OSError:
        return None  # a ZIP download has no .git


def _ram_gb() -> float | None:
    if os.name != "nt":
        return None

    class MemoryStatus(ctypes.Structure):
        _fields_ = [("length", ctypes.c_ulong), ("load", ctypes.c_ulong), ("total", ctypes.c_ulonglong),
                    ("avail", ctypes.c_ulonglong), ("total_page", ctypes.c_ulonglong), ("avail_page", ctypes.c_ulonglong),
                    ("total_virtual", ctypes.c_ulonglong), ("avail_virtual", ctypes.c_ulonglong), ("ext", ctypes.c_ulonglong)]

    status = MemoryStatus()
    status.length = ctypes.sizeof(MemoryStatus)
    if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
        return round(status.total / 2 ** 30, 1)
    return None


def _cpu_name() -> str | None:
    if os.name == "nt":
        try:
            import winreg
            key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"HARDWARE\DESCRIPTION\System\CentralProcessor\0")
            return winreg.QueryValueEx(key, "ProcessorNameString")[0].strip()
        except OSError:
            pass
    return platform.processor() or None


def _ffmpeg_info() -> dict:
    ffmpeg = proxy._find_ffmpeg()
    if not ffmpeg:
        return {"found": False}
    try:
        line = subprocess.run([ffmpeg, "-hide_banner", "-version"], capture_output=True, text=True, timeout=10,
                              creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)).stdout.splitlines()[0]
    except (OSError, subprocess.TimeoutExpired, IndexError):
        line = None
    return {"found": True, "path": ffmpeg, "version": line}


def _probe(path: str) -> dict | None:
    ffmpeg = proxy._find_ffmpeg()
    if not ffmpeg or not path or not os.path.isfile(path):
        return None
    ffprobe = os.path.join(os.path.dirname(ffmpeg), "ffprobe" + os.path.splitext(ffmpeg)[1])
    try:
        out = subprocess.run(
            [ffprobe, "-v", "error", "-select_streams", "v:0", "-show_entries",
             "stream=codec_name,profile,pix_fmt,width,height,r_frame_rate,bit_rate:format=duration,bit_rate",
             "-of", "json", path],
            capture_output=True, text=True, timeout=20, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        data = json.loads(out.stdout or "{}")
    except (OSError, subprocess.TimeoutExpired, ValueError):
        return {"probe_failed": True}
    stream = (data.get("streams") or [{}])[0]
    fmt = data.get("format") or {}
    return {**stream, "duration": fmt.get("duration"), "total_bit_rate": fmt.get("bit_rate"),
            "size_mb": round(os.path.getsize(path) / 2 ** 20, 1)}


def _read_speed(folder: str, exts) -> dict | None:
    """MB/s reading one of the larger files in `folder` (sampled, not the
    whole tree). Windows may serve a recently played file from memory, so a
    very high number can mean 'cached' rather than 'fast drive'."""
    candidates = []
    for dirpath, _dirs, files in os.walk(folder):
        candidates += [os.path.join(dirpath, f) for f in files if f.lower().endswith(exts)]
        if len(candidates) > 400:
            break
    if not candidates:
        return None
    sized = sorted(random.sample(candidates, min(40, len(candidates))), key=os.path.getsize, reverse=True)
    path = sized[0]
    started = time.perf_counter()
    read = 0
    try:
        with open(path, "rb", buffering=0) as f:
            while read < SPEED_TEST_BYTES:
                chunk = f.read(1024 * 1024)
                if not chunk:
                    break
                read += len(chunk)
    except OSError as exc:
        return {"error": str(exc)}
    elapsed = max(time.perf_counter() - started, 1e-6)
    return {"file": os.path.basename(path), "read_mb": round(read / 2 ** 20, 1), "mb_per_s": round(read / 2 ** 20 / elapsed, 1)}


def _drive(path: str) -> dict:
    try:
        import shutil
        usage = shutil.disk_usage(path)
        return {"drive": os.path.splitdrive(os.path.abspath(path))[0] or "/", "free_gb": round(usage.free / 2 ** 30, 1)}
    except OSError:
        return {}


def _log_tail(path: str, lines: int) -> list:
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            content = f.readlines()
    except OSError:
        return []
    # Everything that isn't routine, plus the most recent lines regardless.
    notable = [l.rstrip() for l in content[-3000:] if " WARNING " in l or " ERROR " in l or "Traceback" in l]
    return notable[-80:] + ["--- last lines ---"] + [l.rstrip() for l in content[-lines:]]


def build(ctx, events: list, prep_status: dict) -> dict:
    config, src = ctx.config, sources.get(ctx.config)

    counts = Counter()
    for e in events:
        if e.get("k") in ("video.stall", "video.error", "video.idle") and isinstance(e.get("d"), dict) and e["d"].get("clip"):
            counts[e["d"]["clip"]] += 1
    clips = []
    for rel, n in counts.most_common(STALLED_CLIPS_MAX):
        path = src.to_abs("tiles", rel)
        pp = src.proxy_path(path, "tiles") if path else None
        clips.append({
            "clip": rel, "problems": n, "source": _probe(path),
            "proxy": _probe(pp), "proxy_failed": bool(pp and proxy.failed_before(pp)),
        })

    drives = {}
    for root in src.roots("tiles"):
        drives["tiles: " + root.path] = {**_drive(root.path), "read": _read_speed(root.path, config.video_exts)}
    drives["proxies: " + config.proxy_dir] = {**_drive(config.proxy_dir), "read": _read_speed(config.proxy_dir, (".mp4",))}

    overrides_path = os.path.join(PROJECT_ROOT, "config_overrides.json")
    try:
        overrides = json.load(open(overrides_path, encoding="utf-8"))
    except (OSError, ValueError):
        overrides = None

    return {
        "exported_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "engine": {
            "commit": _git_commit(), "python": sys.version.split()[0], "os": platform.platform(),
            "cpu": _cpu_name(), "cores": os.cpu_count(), "ram_gb": _ram_gb(), "ffmpeg": _ffmpeg_info(),
            "port": config.port, "proxy": {"max_dimension": config.proxy_max_dimension, "kbps": config.proxy_bitrate_kbps,
                                          "format": proxy.PROXY_FORMAT},
            "engine_overrides": overrides,
        },
        "sources": src.describe(),
        "prep": prep_status,
        "drives": drives,
        "stalled_clips": clips,
        "events": events,
        "engine_log": _log_tail(os.path.join(PROJECT_ROOT, "engine_stderr.log"), 60),
        "background_prep_log": _log_tail(os.path.join(PROJECT_ROOT, "cache_warmer.log"), 30),
    }
