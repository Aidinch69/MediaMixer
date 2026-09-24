"""Orchestrator: wires up the db/session-manager/web layer and runs the engine."""
from __future__ import annotations

import argparse
import logging
import threading
from dataclasses import replace

from . import library
from .config import Config, load_config
from .context import AppContext
from .db import Database
from .network import get_lan_ip, get_tailscale_https_url
from .session import SessionManager
from .web.app import create_app

log = logging.getLogger(__name__)


class MediaMixerApp:
    def __init__(self, config: Config | None = None):
        self.config = config or load_config()
        self.db = Database(self.config)
        self.sessions = SessionManager(self.db, self.config)
        self.ctx = AppContext(self.config, self.db, self.sessions)
        self.flask_app = create_app(self.ctx)
        self._stopped = threading.Event()

    def run(self):
        library.sync_library(self.db, self.config)

        threading.Thread(
            target=lambda: self.flask_app.run(
                host=self.config.host, port=self.config.port, threaded=True, use_reloader=False
            ),
            name="web",
            daemon=True,
        ).start()

        tailscale_url = get_tailscale_https_url(self.config.port)

        log.info("=" * 60)
        log.info("MediaMixer engine online -> http://localhost:%s", self.config.port)
        log.info("Same-network devices (e.g. your phone) -> http://%s:%s", get_lan_ip(), self.config.port)
        if tailscale_url:
            log.info("Tailscale (installable, HTTPS) -> %s", tailscale_url)
        log.info("Each device gets its own independent playback session")
        log.info("=" * 60)

        try:
            self.sessions.run_scheduler()
        except KeyboardInterrupt:
            pass
        finally:
            self.shutdown()

    def shutdown(self):
        if self._stopped.is_set():
            return
        self._stopped.set()
        log.info("shutting down...")
        self.sessions.stop()
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
