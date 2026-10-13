"""Local UI preference persistence - native equivalent of the browser's
localStorage prefs (mm_sfx_vol, mm_binaural_vol, mm_fx_enabled/count/
opacity/source, mm_anticipation_enabled, mm_near_miss_enabled,
mm_autopilot_minutes, etc.). Loaded once at startup, saved on change.
"""
from __future__ import annotations

import json
import os

PREFS_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "native_prefs.json")

DEFAULTS = {
    "sfx_volume": 0.7,
    "binaural_volume": 0.4,
    "tile_volume": 100.0,  # mpv's own volume scale is 0-100, not 0-1
    "mosaic_enabled": False,
    "floater_enabled": False,
    "floater_count": 3,
    "floater_opacity": 0.6,
    "floater_source": "dedicated",
    "anticipation_fx_enabled": True,
    "near_miss_enabled": False,
    "autopilot_enabled": False,
    "autopilot_minutes": 6.0,
    "session_timer_enabled": False,
}


def load() -> dict:
    data = dict(DEFAULTS)
    try:
        with open(PREFS_PATH, "r", encoding="utf-8") as f:
            saved = json.load(f)
        data.update({k: v for k, v in saved.items() if k in DEFAULTS})
    except (OSError, json.JSONDecodeError):
        pass
    return data


def save(data: dict) -> None:
    try:
        with open(PREFS_PATH, "w", encoding="utf-8") as f:
            json.dump({k: data[k] for k in DEFAULTS if k in data}, f)
    except OSError:
        pass
