"""Library prep, without the dashboard: scans the source folders, builds any
missing proxies, then runs Clip DNA on anything not analysed yet.

    python -m mediamixer.prepare            one pass, with progress, then exit
    python -m mediamixer.prepare --watch    keep going, rescanning every few minutes

Safe alongside a running engine: proxies are written to a .tmp file and
renamed (and anything already mid-transcode is skipped), and while the
engine is up its own DNA worker handles analysis, so this leaves DNA to it.
Safe to stop at any time - the next run picks up where this one left off.
The background cache warmer (mediamixer/cache_warmer.py) is this in --watch
mode with no console.
"""
from __future__ import annotations

import argparse
import logging
import os
import signal
import socket
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

from . import library, proxy, sources
from .clip_dna import DNA_VERSION, analyze
from .config import load_config
from .db import Database
from .proxy import _find_ffmpeg, _generate

log = logging.getLogger("mediamixer.prepare")

PROXY_KINDS = ("tiles", "spirals")
_stop = False


def _handle_stop(_signum, _frame) -> None:
    global _stop
    _stop = True


def engine_running(config) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", config.port), timeout=0.5):
            return True
    except OSError:
        return False


def missing_proxies(config) -> list:
    """(source, proxy) pairs for every Tile/Spiral Source clip without a proxy."""
    src = sources.get(config)
    src.reload()  # pick up folders changed in the menu since the last pass
    out = []
    for kind in PROXY_KINDS:
        for _root, full in src.iter_files(kind, config.video_exts):
            proxy_path = src.proxy_path(full, kind)
            # Skip clips another process is mid-transcode on, and clips
            # ffmpeg has already failed to convert.
            if (proxy_path and not os.path.isfile(proxy_path)
                    and not proxy.in_progress(proxy_path) and not proxy.failed_before(proxy_path)):
                out.append((full, proxy_path))
    return out


def build_proxies(config, ffmpeg: str, workers: int) -> int:
    if os.path.isdir(config.proxy_dir):
        removed = proxy.recheck_old_proxies(ffmpeg, config, stop=lambda: _stop)
        if removed:
            log.info("Proxies: %d made with older settings will be rebuilt", removed)
    pending = missing_proxies(config)
    if not pending:
        log.info("Proxies: all up to date")
        return 0
    log.info("Proxies: %d to build (%d at a time)", len(pending), workers)
    done = 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(_generate, ffmpeg, s, p, config): s for s, p in pending}
        for future in as_completed(futures):
            if _stop:
                pool.shutdown(wait=False, cancel_futures=True)
                break
            future.result()
            done += 1
            log.info("Proxies: %d/%d  %s", done, len(pending), os.path.basename(futures[future]))
    return done


def run_dna(config, db) -> int:
    todo = db.paths_missing_dna(DNA_VERSION)
    if not todo:
        log.info("Clip DNA: all up to date")
        return 0
    log.info("Clip DNA: %d to analyse", len(todo))
    for n, path in enumerate(todo, 1):
        if _stop:
            break
        dna = analyze(path, config)
        db.save_dna(path, dna, DNA_VERSION)  # None marks a broken file so it isn't retried forever
        log.info("Clip DNA: %d/%d  %s%s", n, len(todo), os.path.basename(path), "" if dna else "  (unreadable, skipped)")
    return len(todo)


def run_pass(config, ffmpeg: str, workers: int, do_proxies: bool, do_dna: bool) -> None:
    db = Database(config)
    try:
        folders = library.sync_library(db, config)
        counts = db.dna_counts(DNA_VERSION)
        log.info("Library: %d clips in %d categories", counts["total"], len(folders))
        if do_proxies and not _stop:
            build_proxies(config, ffmpeg, workers)
        if do_dna and not _stop:
            if engine_running(config):
                log.info("Clip DNA: the engine is running and analyses clips itself - leaving it to that")
            else:
                run_dna(config, db)
    finally:
        db.close()


class LibraryWatcher:
    """Library prep inside the engine: rescans the source folders every
    `interval_s` (or straight away when woken - e.g. a folder was just added
    in the menu), nudges the Clip DNA worker when there's anything to
    analyse, and builds missing proxies one at a time at low priority - so
    new clips get ready without waiting for Prepare.bat or a clip to play."""

    def __init__(self, db, config, dna=None, interval_s: float = 60.0):
        self._db, self._config, self._dna = db, config, dna
        self._interval_s = interval_s
        self._wake = threading.Event()
        self._stopped = threading.Event()
        self.current: str | None = None
        self._thread = threading.Thread(target=self._run, name="library-watcher", daemon=True)

    def start(self):
        self._thread.start()

    def wake(self):
        self._wake.set()

    def stop(self):
        self._stopped.set()
        self._wake.set()

    def _run(self):
        self._wake.wait(15)  # let startup and the first page load settle first
        while not self._stopped.is_set():
            self._wake.clear()
            try:
                self._pass()
            except Exception:
                log.exception("library watcher pass failed")
            self._wake.wait(self._interval_s)

    def _pass(self):
        library.sync_library(self._db, self._config)
        if self._dna is not None and self._db.paths_missing_dna(DNA_VERSION):
            self._dna.wake()
        ffmpeg = _find_ffmpeg()
        if not ffmpeg:
            return
        proxy.recheck_old_proxies(ffmpeg, self._config, stop=self._stopped.is_set)
        for source, proxy_path in missing_proxies(self._config):
            if self._stopped.is_set() or self._wake.is_set():
                return  # woken mid-way (e.g. folders changed): rescan first
            self.current = os.path.basename(source)
            _generate(ffmpeg, source, proxy_path, self._config)
            self.current = None


def configure_logging(log_file: str | None) -> None:
    handlers = []
    if sys.stdout is not None:  # pythonw has no console at all
        handlers.append(logging.StreamHandler(sys.stdout))
    if log_file:
        handlers.append(logging.FileHandler(log_file, encoding="utf-8"))
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", datefmt="%H:%M:%S", handlers=handlers)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Build proxies and Clip DNA for the MediaMixer library")
    parser.add_argument("--watch", action="store_true", help="keep running, rescanning every --interval-s")
    parser.add_argument("--interval-s", type=int, default=600, help="seconds between scans in --watch mode (default 600)")
    parser.add_argument("--workers", type=int, default=2, help="concurrent proxy transcodes (default 2)")
    parser.add_argument("--no-proxies", action="store_true", help="skip building proxies")
    parser.add_argument("--no-dna", action="store_true", help="skip Clip DNA analysis")
    parser.add_argument("--log-file", default=None, help="also write progress to this file")
    args = parser.parse_args(argv)

    configure_logging(args.log_file)
    signal.signal(signal.SIGINT, _handle_stop)
    signal.signal(signal.SIGTERM, _handle_stop)

    config = load_config()
    ffmpeg = _find_ffmpeg()
    if not ffmpeg:
        log.error("ffmpeg not found. Install it (Setup.bat offers to), or put ffmpeg.exe and ffprobe.exe "
                  "in an 'ffmpeg' folder in the project root, or set MEDIAMIXER_FFMPEG to its path.")
        return 1

    while True:
        run_pass(config, ffmpeg, args.workers, not args.no_proxies, not args.no_dna)
        if not args.watch or _stop:
            break
        log.info("Done - checking again in %ds", args.interval_s)
        for _ in range(args.interval_s):
            if _stop:
                break
            time.sleep(1)
        if _stop:
            break
    log.info("Stopped" if _stop else "All done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
