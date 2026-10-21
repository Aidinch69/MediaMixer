"""Opens the dashboard - in a normal browser tab, or (--app) in its own
app window: Chrome or Edge with no tabs or address bar, the way the
MediaMixer desktop/Start-menu shortcut runs it. Used by Run.bat when the
engine is already running, and by `Engine.py --open/--app` once it starts.

    python -m mediamixer.launch [--app]
"""
from __future__ import annotations

import argparse
import os
import subprocess
import webbrowser


def _app_browser() -> str | None:
    """Chrome first, then Edge (always present on Windows 10/11)."""
    candidates = []
    for base in (os.environ.get("PROGRAMFILES"), os.environ.get("PROGRAMFILES(X86)"), os.environ.get("LOCALAPPDATA")):
        if base:
            candidates.append(os.path.join(base, "Google", "Chrome", "Application", "chrome.exe"))
    for base in (os.environ.get("PROGRAMFILES(X86)"), os.environ.get("PROGRAMFILES")):
        if base:
            candidates.append(os.path.join(base, "Microsoft", "Edge", "Application", "msedge.exe"))
    return next((c for c in candidates if os.path.isfile(c)), None)


def open_dashboard(url: str, app: bool = False) -> None:
    if app:
        exe = _app_browser()
        if exe:
            subprocess.Popen([exe, f"--app={url}"], close_fds=True)
            return
    webbrowser.open(url)


def main(argv=None) -> None:
    from .config import load_config

    parser = argparse.ArgumentParser(description="Open the MediaMixer dashboard")
    parser.add_argument("--app", action="store_true", help="open in its own app window (Chrome/Edge)")
    args, _unknown = parser.parse_known_args(argv)  # Run.bat passes its arguments straight through
    open_dashboard(f"http://localhost:{load_config().port}", app=args.app)


if __name__ == "__main__":
    main()
