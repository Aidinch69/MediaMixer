"""End-to-end smoke test: load the dashboard in headless Chrome, walk a few
layouts, and fail on any JS exception or console error.

The engine must already be running (python Engine.py). The headless browser
gets its own session cookie, so this never changes the layout or ratings of a
session you have open. It does not rate clips or trigger Fresh Drop debuts.

    python tools/smoke.py                 # default http://127.0.0.1:5000
    python tools/smoke.py --shots out/    # also save a screenshot per layout
"""
from __future__ import annotations

import argparse
import os
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp import Browser  # noqa: E402

LAYOUTS = ("dual", "grid2x3", "grid3x3", "dual")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--url", default="http://127.0.0.1:5000")
    parser.add_argument("--shots", help="directory to save one screenshot per layout")
    parser.add_argument("--settle", type=float, default=6, help="seconds to let each layout run")
    args = parser.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")

    try:
        urllib.request.urlopen(args.url + "/api/status", timeout=5)
    except Exception as exc:
        print(f"FAIL engine not reachable at {args.url}: {exc}")
        return 1
    if args.shots:
        os.makedirs(args.shots, exist_ok=True)

    failures: list[str] = []
    with Browser() as b:
        # Dynamic Mosaic is on by default and would change the tile count
        # under the layout checks below - switch it off in this profile only.
        b.navigate(args.url + "/")
        b.ev("localStorage.setItem('mm_dynamic_mosaic', JSON.stringify({zoneMode: false, driftMode: false})), 1")
        b.navigate(args.url + "/")
        b.pump(args.settle)
        for layout in LAYOUTS:
            status = b.ev(f"fetch('/api/layout?mode={layout}').then(r => r.json())")
            if not status or not status.get("ok"):
                failures.append(f"{layout}: /api/layout returned {status}")
                continue
            b.pump(args.settle)
            want = status["tile_count"]
            tiles = b.ev("tileElements.length")
            playing = b.ev("tileElements.filter((t, i) => { const v = getTileVideo(i); return v && v.readyState >= 2; }).length")
            print(f"{layout:8} tiles={tiles}/{want} ready={playing}")
            if tiles != want:
                failures.append(f"{layout}: rendered {tiles} tiles, expected {want}")
            if playing == 0:
                failures.append(f"{layout}: no tile video reached a playable state")
            if args.shots:
                b.screenshot(os.path.join(args.shots, f"{layout}.png"))
        failures += b.errors

    if failures:
        print("FAIL")
        for f in failures:
            print("  " + f)
        return 1
    print("PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
