"""Per-viewer playback sessions.

Each connected browser (identified by a cookie) gets its own independent
RuntimeState/RotationEngine/OverlayAudio: its own screens, layout, pace,
current category, and tone/beat settings. This is what lets a phone and a
PC watch at the same time without either one's skip/layout/category change
stomping on what the other is doing.

The reward-weighted video/folder database (`Database`) is intentionally
*not* part of a session - it's shared, so a rating from any device improves
what every device gets recommended.
"""
from __future__ import annotations

import logging
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from . import library
from .audio.overlay import OverlayAudio
from .config import Config
from .db import Database
from .rotation import RotationEngine
from .state import RuntimeState

log = logging.getLogger(__name__)


@dataclass
class Session:
    id: str
    state: RuntimeState
    rotation: RotationEngine
    overlay: OverlayAudio
    last_seen: float = field(default_factory=time.time)

    def touch(self):
        self.last_seen = time.time()


class SessionManager:
    def __init__(self, db: Database, config: Config):
        self._db = db
        self._config = config
        self._sessions: Dict[str, Session] = {}
        self._lock = threading.Lock()
        self._stop_event = threading.Event()

    def get(self, session_id: Optional[str]) -> Optional[Session]:
        if not session_id:
            return None
        with self._lock:
            session = self._sessions.get(session_id)
        if session is not None:
            session.touch()
        return session

    def create(self) -> Session:
        session_id = uuid.uuid4().hex
        state = RuntimeState(self._config)
        overlay = OverlayAudio(self._config)
        rotation = RotationEngine(state, self._db, self._config)
        session = Session(id=session_id, state=state, rotation=rotation, overlay=overlay)

        folder = library.pick_folder(self._db, self._config)
        if folder:
            rotation.rotate(override_folder=folder, side="all")

        with self._lock:
            self._sessions[session_id] = session
        log.info("new viewer session %s (%d active)", session_id[:8], len(self._sessions))
        return session

    def all(self) -> List[Session]:
        with self._lock:
            return list(self._sessions.values())

    def get_or_create(self, session_id: Optional[str]) -> Session:
        return self.get(session_id) or self.create()

    def stop(self):
        self._stop_event.set()

    def run_scheduler(self):
        """Blocking: ticks every active session's rotation engine on a shared
        cadence, and prunes sessions nobody's requested from in a while."""
        while not self._stop_event.is_set():
            with self._lock:
                sessions = list(self._sessions.values())
            for session in sessions:
                try:
                    session.rotation.tick()
                except Exception:
                    log.exception("error ticking viewer session %s", session.id[:8])
            self._expire_stale(sessions)
            self._stop_event.wait(0.5)

    def _expire_stale(self, sessions: List[Session]):
        now = time.time()
        stale_ids = [s.id for s in sessions if now - s.last_seen > self._config.session_timeout_s]
        if not stale_ids:
            return
        with self._lock:
            for session_id in stale_ids:
                self._sessions.pop(session_id, None)
        for session_id in stale_ids:
            log.info("expired idle viewer session %s", session_id[:8])
