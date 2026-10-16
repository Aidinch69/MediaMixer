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


class JackpotTier(NamedTuple):
    name: str
    weight: int  # relative weight, picked out of the sum of all tiers' weights
    tile_count: Tuple[int, int]  # how many screens swap when this tier lands
    jackpot_picks: int  # how many of those screens get a top-ranked ("favorite") pick instead of a normal explore pick - capped to tile_count
    speed_range: Tuple[float, float]  # per-screen randomized hype speed-up target
    hype_ticks: Tuple[int, int]  # 0.5s ticks the hype window runs before the reveal


def _env_path(name: str, default: str) -> str:
    return os.path.abspath(os.environ.get(name, default))


@dataclass(frozen=True)
class Config:
    # -- storage locations --
    media_dir: str = field(default_factory=lambda: _env_path("MEDIAMIXER_MEDIA_DIR", "./media_assets"))
    audio_dir: str = field(default_factory=lambda: _env_path("MEDIAMIXER_AUDIO_DIR", "./Audios"))
    overlay_fx_dir: str = field(default_factory=lambda: _env_path("MEDIAMIXER_OVERLAY_FX_DIR", "./overlay_fx"))
    spirals_dir: str = field(default_factory=lambda: _env_path("MEDIAMIXER_SPIRALS_DIR", "./Spirals"))
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
        LayoutPreset("grid6x6", 36, 6, "6x6 Grid"),
        LayoutPreset("grid8x8", 64, 8, "8x8 Grid"),
    )
    default_layout: str = "dual"
    default_preload_enabled: bool = True

    # -- low-res proxy for dense grids --
    # Source clips are full 1080p+ at several Mbps - every layout now uses
    # the cached, cheaper-to-decode proxy when one exists (see
    # mediamixer/web/app.py's media() route and mediamixer/cache_warmer.py,
    # which keeps the whole library covered in the background), not just
    # dense grids - a real cost even at 2 simultaneous screens, not only
    # at 16-25.
    proxy_max_dimension: int = 640
    proxy_bitrate_kbps: int = 1200

    # -- barrage / jackpot events --
    # A barrage no longer forces a cascade of rapid-fire, never-buffered
    # clip swaps across however many screens happen to expire next (that
    # was the actual cause of "everything flashes and reswaps" - a real
    # content-rotation storm, not just a visual effect). Instead it swaps
    # a small, bounded number of screens once immediately, then runs a
    # speed-up "hype" window on already-buffered content for everyone -
    # see RotationEngine._start_barrage/_tick_barrage.
    barrage_probability: float = 0.05
    barrage_check_every_ticks: int = 6  # how often (in 0.5s ticks) to roll for a new barrage - every ~3s

    # Each barrage rolls one of these tiers, weighted - the tier isn't just
    # a bigger flash on the same effect, it changes what actually happens:
    # how many screens change, how many of those land a top-ranked
    # "favorite" pick (library.pick_video_jackpot) instead of a normal
    # explore pick, how hard playback speeds up, and how long the build-up
    # runs. The client mirrors this tier name for the matching visual/audio
    # celebration (see dashboard.js's JACKPOT_TIERS) so what you see always
    # matches what actually happened, instead of an independent random
    # guess at the same time.
    jackpot_tiers: Tuple[JackpotTier, ...] = (
        # speed_range tapered per direct feedback; hype_ticks (0.5s each)
        # raised so even "small" holds at least 10s - per feedback that
        # the hold itself needed a real floor, not just a faster fade.
        JackpotTier("small", weight=65, tile_count=(1, 2), jackpot_picks=1,
                    speed_range=(1.08, 1.45), hype_ticks=(20, 24)),
        JackpotTier("medium", weight=28, tile_count=(2, 3), jackpot_picks=2,
                    speed_range=(1.15, 1.55), hype_ticks=(24, 30)),
        JackpotTier("mega", weight=7, tile_count=(3, 4), jackpot_picks=4,
                    speed_range=(1.25, 1.8), hype_ticks=(28, 36)),
    )
    jackpot_probability: float = 0.12
    jackpot_hold_seconds: float = 60.0

    # -- tension / time-dilation curve --
    tension_window_s: float = 5.0
    tension_max_drag: float = 0.35

    # -- reward-weighted bandit --
    reward_ema_alpha: float = 0.30
    # Raised from 0.45/0.15 - a handful of early-rated favorites were
    # dominating selection against the much larger pool of never-rated
    # clips (an unrated clip's score of just the exploration bonus vs. a
    # favorite's ~0.8 reward was enough of a gap, at the old temperature,
    # to make the favorite roughly 4x more likely to be picked every
    # time - that's "the same ones keep coming up," working as designed
    # but tuned too conservatively for a library this size).
    softmax_temp: float = 0.60
    decay_halflife_s: float = 1800.0
    exploration_bonus_c: float = 0.50  # UCB-style bonus so rarely-played clips stay in rotation - nudged up for a bit more default discovery

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
