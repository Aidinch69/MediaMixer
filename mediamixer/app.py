"""Orchestrator: wires up state/db/audio/rotation/web and runs the engine."""
from __future__ import annotations

import argparse
import logging
import threading
from dataclasses import replace

from . import library
from .audio.overlay import OverlayAudio
from .config import Config, load_config
from .context import AppContext
from .db import Database
from .network import get_lan_ip
from .rotation import RotationEngine
from .state import RuntimeState
from .web.app import create_app

log = logging.getLogger(__name__)


class MediaMixerApp:
    def __init__(self, config: Config | None = None):
        self.config = config or load_config()
        self.db = Database(self.config)
        self.state = RuntimeState(self.config)
        self.overlay = OverlayAudio(self.config)
        self.rotation = RotationEngine(self.state, self.db, self.config)
        self.ctx = AppContext(self.config, self.db, self.state, self.overlay, self.rotation)
        self.flask_app = create_app(self.ctx)
        self._stopped = threading.Event()

    def _bootstrap_playback(self):
        library.sync_library(self.db, self.config)
        folder = library.pick_folder(self.db, self.config)
        if folder:
            self.rotation.rotate(override_folder=folder, side="all")

    def run(self):
        self._bootstrap_playback()

        threading.Thread(
            target=lambda: self.flask_app.run(
                host=self.config.host, port=self.config.port, threaded=True, use_reloader=False
            ),
            name="web",
            daemon=True,
        ).start()

        log.info("=" * 60)
        log.info("MediaMixer engine online -> http://localhost:%s", self.config.port)
        log.info("Same-network devices (e.g. your phone) -> http://%s:%s", get_lan_ip(), self.config.port)
        log.info("=" * 60)

        try:
            self.rotation.run()
        except KeyboardInterrupt:
            pass
        finally:
            self.shutdown()

    def shutdown(self):
        if self._stopped.is_set():
            return
        self._stopped.set()
        log.info("shutting down...")
        self.rotation.stop()
        self.db.close()


def _configure_logging(level: str):
    logging.basicConfig(level=level, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


def main():
    parser = argparse.ArgumentParser(description="MediaMixer biometric loop engine")
    parser.add_argument("--host", default=None, help="override the web server bind address")
    parser.add_argument("--port", type=int, default=None, help="override the web server port")
    parser.add_argument("--log-level", default="INFO")
    args = parser.parse_args()

    _configure_logging(args.log_level)

    config = load_config()
    if args.host:
        config = replace(config, host=args.host)
    if args.port:
        config = replace(config, port=args.port)

    MediaMixerApp(config).run()


if __name__ == "__main__":
    main()
