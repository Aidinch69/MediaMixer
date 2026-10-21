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


def _generate(ffmpeg: str, source_path: str, proxy_path: str, config) -> None:
    try:
        os.makedirs(os.path.dirname(proxy_path), exist_ok=True)
        tmp_path = proxy_path + ".tmp"
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
            subprocess.run(cmd, check=True, capture_output=True, timeout=180, **popen_kwargs)
            os.replace(tmp_path, proxy_path)
        except Exception:
            log.exception("Proxy transcode failed for %s", source_path)
            if os.path.isfile(tmp_path):
                os.remove(tmp_path)
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

    ffmpeg = _find_ffmpeg()
    if not ffmpeg:
        return None

    with _pending_lock:
        if source_path not in _pending:
            _pending.add(source_path)
            _executor.submit(_generate, ffmpeg, source_path, proxy_path, config)
    return None
