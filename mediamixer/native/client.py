"""Loopback HTTP client: the native app is just another viewer, exactly
like a browser tab or phone - it gets its own independent Session from
the existing Flask backend via the same /api/status + /api/stream the
browser uses. No server-side changes.
"""
from __future__ import annotations

import json
import threading
import time

import requests
from PySide6.QtCore import QObject, Signal


class BackendClient(QObject):
    status_received = Signal(dict)
    connection_lost = Signal()

    def __init__(self, base_url: str):
        super().__init__()
        self.base_url = base_url
        self.session = requests.Session()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def connect_blocking(self, retries: int = 5, delay: float = 1.0) -> bool:
        """Block until /api/status answers (this also establishes the
        session cookie the stream/control calls below will reuse), or
        give up after `retries` attempts."""
        for _ in range(retries):
            try:
                r = self.session.get(f"{self.base_url}/api/status", timeout=3)
                if r.status_code == 200:
                    return True
            except requests.RequestException:
                pass
            time.sleep(delay)
        return False

    def start_stream(self) -> None:
        self._thread = threading.Thread(target=self._stream_loop, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def _stream_loop(self) -> None:
        while not self._stop.is_set():
            try:
                resp = self.session.get(f"{self.base_url}/api/stream", stream=True, timeout=10)
                for raw_line in resp.iter_lines(decode_unicode=True):
                    if self._stop.is_set():
                        return
                    if not raw_line or not raw_line.startswith("data: "):
                        continue  # blank line between events, or a ": keep-alive" comment
                    try:
                        snapshot = json.loads(raw_line[len("data: "):])
                    except json.JSONDecodeError:
                        continue
                    self.status_received.emit(snapshot)
            except requests.RequestException:
                self.connection_lost.emit()
                if self._stop.is_set():
                    return
                time.sleep(2)  # brief backoff before the outer while loop reconnects
