"""Bundles the wired-up engine components the web layer needs access to."""
from __future__ import annotations

from dataclasses import dataclass

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
