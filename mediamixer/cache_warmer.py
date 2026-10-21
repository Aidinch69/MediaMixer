"""Background library prep: `mediamixer.prepare --watch` with no console,
logging to cache_warmer.log in the project root. Started at login by the
Startup-folder shortcut that Setup.bat (mediamixer/install_cache_warmer.ps1)
installs, so clips dropped into any source folder get their proxy and Clip
DNA within one scan interval, whether or not the dashboard is open.

Usage: pythonw -m mediamixer.cache_warmer [--workers N] [--interval-s N]
"""
from __future__ import annotations

import os
import sys

from . import prepare

LOG_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "cache_warmer.log")


def main() -> None:
    sys.exit(prepare.main(["--watch", "--log-file", LOG_PATH] + sys.argv[1:]))


if __name__ == "__main__":
    main()
