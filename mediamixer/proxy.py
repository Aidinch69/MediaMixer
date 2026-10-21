"""On-demand, cached low-res/low-bitrate proxies for dense grid layouts.

Source clips are full 1080p+ H.264 at several Mbps - fine to decode one or
two at a time, wasteful to decode 16-25x simultaneously into a tile that's
rendering at a fraction of that resolution. ensure_proxy() kicks off a
background transcode the first time a clip is needed for a dense layout and
caches it to disk under config.proxy_dir, mirroring its source folder's
structure - but it never blocks the request that triggered it. A clip always
plays immediately: full-res on the first pick (while its proxy transcodes
in the background), the lighter cached proxy on every pick after that.
"""
from __future__ import annotations

import glob
import logging
import os
import shutil
import subprocess
import threading
import time
from concurrent.futures import ThreadPoolExecutor

from . import sources

log = logging.getLogger(__name__)

# One at a time: a cold cache (many distinct clips needed at once for a
# freshly opened dense grid) must not launch several simultaneous ffmpeg
# processes - even one "fast"-preset x264 encode is real CPU, and that's
# competing directly with the live playback decode we're trying to protect.
_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="proxy-transcode")
_pending: set[str] = set()
_pending_lock = threading.Lock()
_ffmpeg_path_cache: str | None = None


def _find_ffmpeg() -> str | None:
    global _ffmpeg_path_cache
    if _ffmpeg_path_cache:
        return _ffmpeg_path_cache
    # An explicit path, or a copy dropped into <project>/ffmpeg/ (or its
    # bin/ subfolder, as the zip builds unpack), wins over PATH.
    project = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    exe = "ffmpeg.exe" if os.name == "nt" else "ffmpeg"
    for candidate in (os.environ.get("MEDIAMIXER_FFMPEG"),
                      os.path.join(project, "ffmpeg", exe), os.path.join(project, "ffmpeg", "bin", exe)):
        if candidate and os.path.isfile(candidate):
            _ffmpeg_path_cache = candidate
            return candidate
    found = shutil.which("ffmpeg")
    if not found:
        # The engine process may have started before ffmpeg was installed
        # (e.g. via winget) and so won't see the updated PATH until it's
        # restarted - fall back to the well-known winget install location.
        candidates = glob.glob(os.path.expandvars(
            r"%LOCALAPPDATA%\Microsoft\WinGet\Packages\Gyan.FFmpeg*\ffmpeg-*\bin\ffmpeg.exe"
        ))
        found = candidates[0] if candidates else None
    _ffmpeg_path_cache = found
    return found


# A .tmp proxy younger than this belongs to a transcode still running (in
# this process or another one); an older one was left by a crash.
TMP_STALE_S = 1800
TRANSCODE_TIMEOUT_S = 1500


def in_progress(proxy_path: str) -> bool:
    try:
        return time.time() - os.path.getmtime(proxy_path + ".tmp") < TMP_STALE_S
    except OSError:
        return False


def failed_before(proxy_path: str) -> bool:
    """A clip ffmpeg couldn't convert is marked so it isn't retried on
    every scan forever (delete the .failed file to try again)."""
    return os.path.isfile(proxy_path + ".failed")


# Bumped when proxies made by older settings need replacing; see
# recheck_old_proxies. 2 = always 8-bit 4:2:0 (older ones could be 10-bit).
PROXY_FORMAT = "2"
_PLAYABLE_PIX_FMTS = ("yuv420p", "yuvj420p")


def playable(ffmpeg: str, proxy_path: str) -> bool:
    """Whether a proxy is a readable 8-bit 4:2:0 video - what browsers
    decode in hardware. Unreadable or 10-bit/4:4:4 files are not."""
    ffprobe = os.path.join(os.path.dirname(ffmpeg), "ffprobe" + os.path.splitext(ffmpeg)[1])
    try:
        out = subprocess.run(
            [ffprobe, "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=pix_fmt", "-of", "csv=p=0", proxy_path],
            capture_output=True, text=True, timeout=30,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except (OSError, subprocess.TimeoutExpired):
        return True  # can't tell - never delete on a hunch
    return out.returncode == 0 and out.stdout.strip().split(",")[0] in _PLAYABLE_PIX_FMTS


def recheck_old_proxies(ffmpeg: str, config, stop=None) -> int:
    """Once per proxy folder (per PROXY_FORMAT): delete proxies made with
    older settings that browsers can't decode in hardware, so they get
    rebuilt. Returns how many were removed."""
    marker = os.path.join(config.proxy_dir, ".proxy_format")
    try:
        with open(marker, encoding="utf-8") as f:
            if f.read().strip() == PROXY_FORMAT:
                return 0
    except OSError:
        pass
    removed = 0
    for dirpath, _dirs, files in os.walk(config.proxy_dir):
        for name in files:
            if stop is not None and stop():
                return removed  # no marker yet - picks up again next time
            path = os.path.join(dirpath, name)
            if name.endswith(".proxy.mp4") and not in_progress(path) and not playable(ffmpeg, path):
                try:
                    os.remove(path)
                    removed += 1
                except OSError:
                    pass
    if removed:
        log.info("Replacing %d proxies made with older settings", removed)
    os.makedirs(config.proxy_dir, exist_ok=True)
    with open(marker, "w", encoding="utf-8") as f:
        f.write(PROXY_FORMAT)
    return removed


def _claim(tmp_path: str) -> bool:
    """Create the .tmp exclusively, so the engine, background prep and
    Prepare.bat can never transcode the same clip at the same time."""
    for _ in range(2):
        try:
            os.close(os.open(tmp_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY))
            return True
        except FileExistsError:
            if time.time() - os.path.getmtime(tmp_path) < TMP_STALE_S:
                return False
            os.remove(tmp_path)  # left behind by a crash
    return False


def _generate(ffmpeg: str, source_path: str, proxy_path: str, config) -> None:
    try:
        os.makedirs(os.path.dirname(proxy_path), exist_ok=True)
        tmp_path = proxy_path + ".tmp"
        if not _claim(tmp_path):
            return
        dim = config.proxy_max_dimension
        kbps = config.proxy_bitrate_kbps
        cmd = [
            ffmpeg, "-y", "-i", source_path,
            "-vf", f"scale={dim}:{dim}:force_original_aspect_ratio=decrease:force_divisible_by=2",
            # ultrafast trades compression efficiency for much lower CPU use
            # during the encode itself - this runs alongside live playback,
            # so the transcode's own CPU footprint matters more than how
            # tightly the output is packed.
            "-c:v", "libx264", "-preset", "ultrafast",
            # 8-bit 4:2:0 always: a 10-bit/HDR or 4:4:4 source would otherwise
            # give a High 10 / 4:4:4 H.264 file that Chrome can't decode.
            "-pix_fmt", "yuv420p",
            # A keyframe every 2s keeps seeks (random starts, hooks,
            # replays) quick, and 60fps sources drop to 30 - tiles are small.
            "-g", "60", "-fpsmax", "30",
            "-b:v", f"{kbps}k", "-maxrate", f"{int(kbps * 1.3)}k", "-bufsize", f"{kbps * 2}k",
            "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart",
            # ffmpeg infers the container from the output filename's extension;
            # the .tmp suffix (for an atomic write-then-rename) defeats that,
            # so name the muxer explicitly.
            "-f", "mp4", tmp_path,
        ]
        # Run the transcode at below-normal OS scheduling priority so it
        # never wins CPU time away from the Flask server or the browser's
        # own video decode - it's background cache-warming, not something
        # anything else should ever be waiting on. CREATE_NO_WINDOW matters
        # specifically for cache_warmer.py, which runs under pythonw.exe
        # (no console of its own) - without it, Windows pops up a brand
        # new, visible console for every single ffmpeg invocation, since a
        # console-subsystem child process spawned from a console-less
        # parent gets allocated one automatically.
        popen_kwargs = {}
        creationflags = 0
        if hasattr(subprocess, "BELOW_NORMAL_PRIORITY_CLASS"):
            creationflags |= subprocess.BELOW_NORMAL_PRIORITY_CLASS
        if hasattr(subprocess, "CREATE_NO_WINDOW"):
            creationflags |= subprocess.CREATE_NO_WINDOW
        if creationflags:
            popen_kwargs["creationflags"] = creationflags
        try:
            subprocess.run(cmd, check=True, capture_output=True, timeout=TRANSCODE_TIMEOUT_S, **popen_kwargs)
            os.replace(tmp_path, proxy_path)
        except Exception as exc:
            detail = exc.stderr.decode("utf-8", "replace")[-300:] if getattr(exc, "stderr", None) else exc
            log.warning("Proxy transcode failed for %s: %s", source_path, detail)
            if os.path.isfile(tmp_path):
                os.remove(tmp_path)
            if not isinstance(exc, subprocess.TimeoutExpired):
                with open(proxy_path + ".failed", "w", encoding="utf-8") as f:
                    f.write(str(detail))
    finally:
        with _pending_lock:
            _pending.discard(source_path)


def ensure_proxy(source_path: str, config, kind: str = "tiles") -> str | None:
    """Return the path to a cached proxy for source_path if one already
    exists. If not, kick off a background transcode (unless one's already
    in flight for this file) and return None immediately - the caller falls
    back to the original for this request. Never blocks; a missing or slow
    proxy must never be the reason a clip won't play.

    Proxies live under config.proxy_dir/<root id>/, mirroring the layout of
    the source folder the clip came from (see mediamixer.sources)."""
    proxy_path = sources.get(config).proxy_path(source_path, kind)
    if not proxy_path or not os.path.isfile(source_path):
        return None
    if os.path.isfile(proxy_path):
        return proxy_path
    if failed_before(proxy_path) or in_progress(proxy_path):
        return None

    ffmpeg = _find_ffmpeg()
    if not ffmpeg:
        return None

    with _pending_lock:
        if source_path not in _pending:
            _pending.add(source_path)
            _executor.submit(_generate, ffmpeg, source_path, proxy_path, config)
    return None
