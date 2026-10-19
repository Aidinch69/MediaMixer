"""Live-editable engine settings: a validated allow-list of numeric Config
fields that the dashboard's Tuning tab can change while the engine runs.

Changes are applied in place to the one shared Config instance (every read
site already does plain `config.X` on it), and persisted to a JSON file so
they survive a restart until they're copied into config.py for good.
"""
from __future__ import annotations

import json
import logging
import os
import threading
from dataclasses import fields
from typing import Dict, NamedTuple

log = logging.getLogger(__name__)

OVERRIDES_PATH = os.environ.get("MEDIAMIXER_CONFIG_OVERRIDES", "config_overrides.json")


class LiveField(NamedTuple):
    lo: float
    hi: float
    step: float
    group: str
    label: str


LIVE_FIELDS: Dict[str, LiveField] = {
    "barrage_probability": LiveField(0.0, 0.5, 0.005, "Barrage / Jackpot", "Barrage chance per check"),
    "barrage_check_every_ticks": LiveField(1, 40, 1, "Barrage / Jackpot", "Barrage check interval (0.5s ticks)"),
    "jackpot_probability": LiveField(0.0, 1.0, 0.01, "Barrage / Jackpot", "Jackpot chance per rotation"),
    "jackpot_hold_seconds": LiveField(5, 300, 5, "Barrage / Jackpot", "Jackpot / lock hold (s)"),
    "tension_window_s": LiveField(0, 20, 0.5, "Tension Curve", "Tension window before a swap (s)"),
    "tension_max_drag": LiveField(0, 0.9, 0.01, "Tension Curve", "Max slow-down at the end of a clip"),
    "softmax_temp": LiveField(0.05, 3.0, 0.05, "Selection (Bandit)", "Softmax temperature (higher = more random)"),
    "decay_halflife_s": LiveField(3600, 2592000, 3600, "Selection (Bandit)", "Reward decay half-life (s)"),
    "reward_ema_alpha": LiveField(0.01, 1.0, 0.01, "Selection (Bandit)", "Reward learning rate"),
    "rate_up_reward": LiveField(0, 3, 0.05, "Selection (Bandit)", "Heart reward"),
    "rate_down_reward": LiveField(-3, 0, 0.05, "Selection (Bandit)", "Thumbs-down reward"),
    "lock_reward": LiveField(0, 3, 0.05, "Selection (Bandit)", "Lock reward"),
    "skip_penalty": LiveField(-3, 0, 0.05, "Selection (Bandit)", "Skip penalty"),
}

# Each viewer session copies these at creation, so changes must be pushed into
# live sessions too (config field -> RuntimeState attribute).
SESSION_MIRRORED = {
    "barrage_probability": "barrage_probability",
    "jackpot_probability": "jackpot_probability",
}


class LiveConfig:
    def __init__(self, config):
        self._config = config
        self._defaults = {f.name: getattr(config, f.name) for f in fields(config) if f.name in LIVE_FIELDS}
        self._overrides: Dict[str, float] = {}
        self._lock = threading.Lock()
        self._load()

    def _coerce(self, name: str, value) -> float:
        spec = LIVE_FIELDS[name]
        value = float(value)
        if not spec.lo <= value <= spec.hi:
            raise ValueError(f"{name} must be between {spec.lo} and {spec.hi}")
        return int(round(value)) if isinstance(self._defaults[name], int) else value

    def _load(self):
        if not os.path.exists(OVERRIDES_PATH):
            return
        try:
            with open(OVERRIDES_PATH, "r", encoding="utf-8") as f:
                saved = json.load(f)
        except (OSError, ValueError):
            log.exception("couldn't read %s - ignoring saved engine overrides", OVERRIDES_PATH)
            return
        for name, value in saved.items():
            if name not in LIVE_FIELDS:
                continue
            try:
                self._apply(name, self._coerce(name, value))
            except ValueError:
                log.warning("dropping out-of-range saved override %s=%r", name, value)
        if self._overrides:
            log.info("applied %d saved engine override(s) from %s", len(self._overrides), OVERRIDES_PATH)

    def _save(self):
        tmp = OVERRIDES_PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(self._overrides, f, indent=2, sort_keys=True)
        os.replace(tmp, OVERRIDES_PATH)

    def _apply(self, name: str, value):
        object.__setattr__(self._config, name, value)
        if value == self._defaults[name]:
            self._overrides.pop(name, None)
        else:
            self._overrides[name] = value

    def set(self, name: str, value) -> float:
        if name not in LIVE_FIELDS:
            raise KeyError(name)
        coerced = self._coerce(name, value)
        with self._lock:
            self._apply(name, coerced)
            self._save()
        return coerced

    def reset(self):
        with self._lock:
            for name, value in self._defaults.items():
                object.__setattr__(self._config, name, value)
            self._overrides.clear()
            self._save()

    def snapshot(self) -> dict:
        return {
            name: {
                "value": getattr(self._config, name),
                "default": self._defaults[name],
                "min": spec.lo,
                "max": spec.hi,
                "step": spec.step,
                "group": spec.group,
                "label": spec.label,
            }
            for name, spec in LIVE_FIELDS.items()
        }
