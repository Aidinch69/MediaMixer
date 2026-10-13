"""All tunable constants for the engine, in one place.

Paths default to the same locations the original Engine.py used, but can be
overridden with environment variables so the engine can be pointed at a
different media library without editing code.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import NamedTuple, Tuple


class PacePreset(NamedTuple):
    min_seconds: int
    max_seconds: int
    label: str


class LayoutPreset(NamedTuple):
    name: str
    tile_count: int
    columns: int
    label: str


def _env_path(name: str, default: str) -> str:
    return os.path.abspath(os.environ.get(name, default))


@dataclass(frozen=True)
class Config:
    # -- storage locations --
    media_dir: str = field(default_factory=lambda: _env_path("MEDIAMIXER_MEDIA_DIR", "./media_assets"))
    audio_dir: str = field(default_factory=lambda: _env_path("MEDIAMIXER_AUDIO_DIR", "./Audios"))
    overlay_fx_dir: str = field(default_factory=lambda: _env_path("MEDIAMIXER_OVERLAY_FX_DIR", "./overlay_fx"))
    proxy_dir: str = field(default_factory=lambda: _env_path("MEDIAMIXER_PROXY_DIR", "./media_proxies"))
    db_path: str = field(default_factory=lambda: os.environ.get("MEDIAMIXER_DB_PATH", "system_memory.db"))

    video_exts: Tuple[str, ...] = (".mp4", ".mkv", ".avi", ".mov", ".webm")
    audio_exts: Tuple[str, ...] = (".mp3", ".wav", ".ogg")
    overlay_fx_image_exts: Tuple[str, ...] = (".jpg", ".jpeg", ".png", ".gif", ".webp")

    # -- binaural / isochronic synth --
    sample_rate: int = 44100
    tone_modes: Tuple[float, ...] = (136.1, 432.0, 528.0)

    # -- rotation pacing --
    pace_presets: Tuple[PacePreset, ...] = (
        PacePreset(10, 10, "10s Hard Switching"),
        PacePreset(5, 30, "5s - 30s (Rapid)"),
        PacePreset(30, 120, "30s - 120s (Balanced)"),
        PacePreset(999_999, 999_999, "Full Video (Continuous)"),
    )
    default_pace_idx: int = 2
    folder_rotation_limit: int = 10

    # -- screen layout --
    layout_presets: Tuple[LayoutPreset, ...] = (
        LayoutPreset("dual", 2, 1, "Dual Screen"),
        LayoutPreset("grid2x2", 4, 2, "2x2 Grid"),
        LayoutPreset("grid2x3", 6, 3, "2x3 Grid"),
        LayoutPreset("grid3x3", 9, 3, "3x3 Grid"),
        LayoutPreset("grid4x4", 16, 4, "4x4 Grid"),
        LayoutPreset("grid5x5", 25, 5, "5x5 Grid"),
    )
    default_layout: str = "dual"
    default_preload_enabled: bool = True

    # -- low-res proxy for dense grids --
    # Source clips are full 1080p+ at several Mbps - fine decoded one or two
    # at a time, wasteful decoded 16-25x at once into a tile a fraction of
    # that size. Layouts past this tile count get a cached, cheaper-to-decode
    # proxy instead of the original; matches grid4x4/grid5x5 (16/25 tiles).
    proxy_tile_threshold: int = 9
    proxy_max_dimension: int = 640
    proxy_bitrate_kbps: int = 1200

    # -- barrage / jackpot events --
    barrage_probability: float = 0.05
    barrage_min: int = 3
    barrage_max: int = 5
    barrage_clip_seconds: Tuple[float, float] = (1.2, 2.5)
    barrage_speed: float = 1.3
    jackpot_probability: float = 0.12
    jackpot_hold_seconds: float = 60.0

    # -- tension / time-dilation curve --
    tension_window_s: float = 5.0
    tension_max_drag: float = 0.20

    # -- reward-weighted bandit --
    reward_ema_alpha: float = 0.30
    softmax_temp: float = 0.45
    decay_halflife_s: float = 1800.0
    exploration_bonus_c: float = 0.15  # UCB-style bonus so rarely-played clips stay in rotation

    skip_penalty: float = -0.25
    lock_reward: float = 0.8
    rate_up_reward: float = 0.8
    rate_down_reward: float = -0.4

    # -- web server --
    host: str = "0.0.0.0"
    port: int = 5000

    # -- per-viewer sessions (each device gets its own independent playback state) --
    session_cookie_name: str = "mm_session"
    session_timeout_s: float = 1800.0  # drop a session's in-memory state after this long unseen


def load_config() -> Config:
    return Config()
