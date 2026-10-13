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

# Same dark/purple palette as dashboard.css, so the native window reads
# as "the same app" rather than a generic gray Qt window.
_THEME_QSS = """
QMainWindow { background-color: #05020a; }
QToolBar { background-color: #0a0515; border: none; spacing: 6px; padding: 6px; }
QToolBar QLabel { color: #d6a3ff; font-weight: bold; padding: 0 6px; }
QToolButton { background-color: #1a0f2b; color: #d6a3ff; border: 1px solid #361e52;
    border-radius: 6px; padding: 6px 10px; font-weight: bold; }
QToolButton:hover { background-color: #251538; border-color: #b84dff; color: white; }
"""


def main() -> None:
    app = QApplication(sys.argv)
    app.setStyleSheet(_THEME_QSS)

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
