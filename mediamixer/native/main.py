"""Entrypoint for the native desktop viewer.

Run with: python -m mediamixer.native.main
Assumes the Flask engine (Engine.py) is already running - connects to it
over loopback HTTP exactly like a browser tab would, becoming its own
independent session (per mediamixer.session's existing multi-viewer
design). Flask keeps serving the browser/phone UI unchanged alongside
this.
"""
from __future__ import annotations

import sys

from PySide6.QtWidgets import QApplication, QMessageBox

from .client import BackendClient
from .shell import MainShell

BASE_URL = "http://127.0.0.1:5000"


def main() -> None:
    app = QApplication(sys.argv)

    client = BackendClient(BASE_URL)
    if not client.connect_blocking(retries=5, delay=1.0):
        QMessageBox.critical(
            None, "MediaMixer",
            f"Couldn't reach the engine at {BASE_URL}.\nStart Engine.py first, then relaunch.",
        )
        sys.exit(1)

    shell = MainShell(client, BASE_URL)
    shell.show()
    client.start_stream()  # start only after the window exists, so tile widgets realize their native handles on time

    sys.exit(app.exec())


if __name__ == "__main__":
    main()
