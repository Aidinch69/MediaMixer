"""Orchestrator: wires up the db/session-manager/web layer and runs the engine."""
from __future__ import annotations

import argparse
import logging
import threading
import webbrowser
from dataclasses import replace

from waitress import serve

from . import library
from .clip_dna import DnaWorker
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
        self.dna = DnaWorker(self.db, self.config)
        self.ctx = AppContext(self.config, self.db, self.sessions, self.dna)
        self.flask_app = create_app(self.ctx)
        self._stopped = threading.Event()

    def run(self, open_browser: bool = False):
        library.sync_library(self.db, self.config)
        self.dna.start()

        # Werkzeug's dev server (Flask's default .run()) is explicitly not
        # built for this: several simultaneous video streams plus a
        # long-lived SSE connection per viewer is real concurrent I/O load,
        # and the dev server's own docs say not to use it for that. Waitress
        # is a mature, pure-Python production WSGI server (no C extensions
        # to fight with on Windows) with a real worker thread pool sized
        # for actual concurrent request handling - a straight swap, since
        # any WSGI-compliant app (Flask included) runs under it unchanged.
        threading.Thread(
            target=lambda: serve(
                self.flask_app, host=self.config.host, port=self.config.port, threads=16,
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
        if open_browser:
            threading.Timer(1.0, webbrowser.open, args=(f"http://localhost:{self.config.port}",)).start()

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
        self.dna.stop()
        self.db.close()


def _configure_logging(level: str):
    logging.basicConfig(level=level, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    # Browsers drop video requests constantly (seeking, tile swaps, preload
    # aborts); waitress logs each one, which buried real errors in the log.
    logging.getLogger("waitress").addFilter(
        lambda record: not record.getMessage().startswith("Client disconnected")
    )


def main():
    parser = argparse.ArgumentParser(description="MediaMixer biometric loop engine")
    parser.add_argument("--host", default=None, help="override the web server bind address")
    parser.add_argument("--port", type=int, default=None, help="override the web server port")
    parser.add_argument("--log-level", default="INFO")
    parser.add_argument("--open", action="store_true", help="open the dashboard in the default browser once it's up")
    args = parser.parse_args()

    _configure_logging(args.log_level)

    config = load_config()
    if args.host:
        config = replace(config, host=args.host)
    if args.port:
        config = replace(config, port=args.port)

    MediaMixerApp(config).run(open_browser=args.open)


if __name__ == "__main__":
    main()
