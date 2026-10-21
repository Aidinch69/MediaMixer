"""Bundles the wired-up engine components the web layer needs access to."""
from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field

from .config import Config
from .db import Database
from .session import SessionManager


@dataclass
class AppContext:
    config: Config
    db: Database
    sessions: SessionManager
    dna: object = None  # clip_dna.DnaWorker, when running
    watcher: object = None  # prepare.LibraryWatcher, when running
    # Open dashboard live streams (/api/stream) - one per open dashboard.
    # Lets the app-window launch shut the engine down once it's closed.
    open_streams: int = 0
    streams_ever: bool = False
    streams_changed_at: float = field(default_factory=time.time)
    _streams_lock: threading.Lock = field(default_factory=threading.Lock)

    def stream_opened(self):
        with self._streams_lock:
            self.open_streams += 1
            self.streams_ever = True
            self.streams_changed_at = time.time()

    def stream_closed(self):
        with self._streams_lock:
            self.open_streams = max(0, self.open_streams - 1)
            self.streams_changed_at = time.time()
