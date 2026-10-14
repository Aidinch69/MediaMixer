"""Standalone background service: keeps the proxy cache filled for the
whole library, forever, independent of Engine.py. Scans for any source
clip missing a proxy, transcodes it (a few workers, OS-deprioritized so
it never competes with foreground use), then sleeps and repeats - so
new clips dropped into media_assets/ get a proxy automatically within
one scan interval instead of waiting on mediamixer.proxy's on-demand
path (which only fires when something actually tries to play that
clip at a dense layout).

Meant to run continuously in the background, started once at login via
Task Scheduler (see mediamixer/install_cache_warmer.ps1) - not
something you run by hand each time. Safe to interrupt/kill any time;
nothing it writes is ever half-finished (atomic write-then-rename,
same as mediamixer/proxy.py), and it just picks up where it left off
on the next scan.

Usage: pythonw -m mediamixer.cache_warmer [--workers N] [--interval-s N]
"""
from __future__ import annotations

import argparse
import logging
import os
import signal
import sys
import time
from concurrent.futures import ThreadPoolExecutor

from .config import load_config
from .proxy import _find_ffmpeg, _generate

log = logging.getLogger(__name__)

_stop = False


def _handle_stop(_signum, _frame) -> None:
    global _stop
    _stop = True


def _iter_source_files(media_dir: str):
    for root, _dirs, files in os.walk(media_dir):
        for name in files:
            if name.lower().endswith((".mp4", ".webm", ".mov", ".m4v")):
                yield os.path.join(root, name)


def _find_missing(config) -> list[tuple[str, str]]:
    media_dir = os.path.realpath(config.media_dir)
    missing = []
    for source_path in _iter_source_files(media_dir):
        rel = os.path.relpath(source_path, media_dir)
        proxy_path = os.path.join(config.proxy_dir, os.path.splitext(rel)[0] + ".proxy.mp4")
        # Skip anything another process (this same tool, or Engine.py's
        # own on-demand path) is already mid-transcode on - both target
        # the identical .tmp filename, and two ffmpegs writing the same
        # file at once is a real collision, not just wasted work.
        if not os.path.isfile(proxy_path) and not os.path.isfile(proxy_path + ".tmp"):
            missing.append((source_path, proxy_path))
    return missing


def main() -> None:
    parser = argparse.ArgumentParser(description="Continuously keep the proxy cache filled in the background")
    parser.add_argument("--workers", type=int, default=2, help="concurrent ffmpeg transcodes (default 2)")
    parser.add_argument("--interval-s", type=int, default=600, help="seconds between scans when idle (default 600)")
    args = parser.parse_args()

    # pythonw.exe (used so this never flashes a console window on login)
    # has no stdout/stderr handle at all, so logging has to go straight
    # to a file rather than relying on shell redirection.
    log_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "cache_warmer.log")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s",
                         handlers=[logging.FileHandler(log_path, encoding="utf-8")])
    signal.signal(signal.SIGINT, _handle_stop)
    signal.signal(signal.SIGTERM, _handle_stop)

    config = load_config()
    ffmpeg = _find_ffmpeg()
    if not ffmpeg:
        print("ffmpeg not found - exiting", file=sys.stderr)
        sys.exit(1)

    log.info("cache warmer started (workers=%d, interval=%ds)", args.workers, args.interval_s)
    while not _stop:
        pending = _find_missing(config)
        if pending:
            log.info("found %d clip(s) needing a proxy", len(pending))
            with ThreadPoolExecutor(max_workers=args.workers) as pool:
                futures = [pool.submit(_generate, ffmpeg, src, dst, config) for src, dst in pending]
                for future in futures:
                    if _stop:
                        break
                    future.result()
            log.info("caught up")
        for _ in range(args.interval_s):
            if _stop:
                break
            time.sleep(1)

    log.info("cache warmer stopped")


if __name__ == "__main__":
    main()
